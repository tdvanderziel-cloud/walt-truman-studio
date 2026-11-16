// Job storage. Every video gets its own folder: jobs/<date>-<short-name>/
// job.json in that folder holds the source info, status and a timed log.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountFromUrl, detectPlatform, isIsoDate, normalizeAccount, slugify, todayIso, type Platform } from "./source.ts";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const JOBS_DIR = process.env.JOBS_DIR ? path.resolve(process.env.JOBS_DIR) : path.join(ROOT_DIR, "jobs");

export type JobStatus =
  | "fetching" // trying to download the video with yt-dlp
  | "needs_upload" // download failed or was skipped: user uploads the file
  | "needs_source" // video is there, but account/date are missing
  | "ready"; // video + complete source: ready for analysis (step 2)

export interface SourceInfo {
  url: string;
  platform: Platform;
  account: string; // "@handle"
  accountName: string; // display name, optional
  postDate: string; // YYYY-MM-DD
  title: string; // caption / title of the post, optional
  retrievedVia: "yt-dlp" | "upload" | null;
  retrievedAt: string | null;
}

export interface LogEntry {
  at: string;
  step: string;
  message: string;
  durationMs?: number;
}

export type AnalysisState = "idle" | "running" | "done" | "failed";

export interface AnalysisInfo {
  state: AnalysisState;
  step: string | null; // current sub-step while running
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CostEntry {
  at: string;
  step: string; // "analyse", "factcheck", "stem", "video", ...
  service: string; // "Claude Opus 5.5", "ElevenLabs Scribe", ...
  detail: string; // e.g. "12.345 in / 2.100 uit tokens"
  usd: number;
}

export interface Job {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  error: string | null;
  source: SourceInfo;
  video: { file: string; durationSec: number; width?: number; height?: number; hasAudio: boolean } | null;
  log: LogEntry[];
  analysis?: AnalysisInfo;
  costs?: CostEntry[];
}

const JOB_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,60}$/;

export function isValidJobId(id: string): boolean {
  return JOB_ID_RE.test(id);
}

export function jobDir(id: string): string {
  if (!isValidJobId(id)) throw new Error("Ongeldige job-naam.");
  return path.join(JOBS_DIR, id);
}

/** Resolve a file name inside a job folder, refusing anything that escapes it. */
export function jobFile(id: string, name: string): string {
  const dir = jobDir(id);
  const full = path.resolve(dir, name);
  if (path.dirname(full) !== dir) throw new Error("Ongeldige bestandsnaam.");
  return full;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function missingSourceFields(s: SourceInfo): string[] {
  const missing: string[] = [];
  if (!s.url) missing.push("link");
  if (!s.account) missing.push("account");
  if (!isIsoDate(s.postDate)) missing.push("datum van de post");
  return missing;
}

/** Status follows from what we have: video file + complete source = ready. */
export function deriveStatus(job: Job): JobStatus {
  if (job.status === "fetching") return "fetching";
  if (!job.video) return "needs_upload";
  if (missingSourceFields(job.source).length > 0) return "needs_source";
  return "ready";
}

export async function createJob(url: string, nameHint?: string): Promise<Job> {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  const account = accountFromUrl(url);
  const base = `${todayIso()}-${slugify(nameHint || account || detectPlatform(url) + "-video", 30)}`;
  let id = base;
  for (let n = 2; await exists(path.join(JOBS_DIR, id)); n++) id = `${base}-${n}`;
  await fs.mkdir(path.join(JOBS_DIR, id));

  const now = new Date().toISOString();
  const job: Job = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "needs_upload",
    error: null,
    source: {
      url,
      platform: detectPlatform(url),
      account,
      accountName: "",
      postDate: "",
      title: "",
      retrievedVia: null,
      retrievedAt: null,
    },
    video: null,
    log: [{ at: now, step: "invoer", message: `Job aangemaakt voor ${url}` }],
  };
  await saveJob(job);
  return job;
}

// Writes are serialised per job so background work and user edits never clash.
const writeQueues = new Map<string, Promise<unknown>>();

export async function saveJob(job: Job): Promise<void> {
  job.updatedAt = new Date().toISOString();
  const file = jobFile(job.id, "job.json");
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(job, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

export async function loadJob(id: string): Promise<Job> {
  const raw = await fs.readFile(jobFile(id, "job.json"), "utf8");
  return JSON.parse(raw) as Job;
}

/** Load, change and save a job in one go, one change at a time per job. */
export function updateJob(id: string, change: (job: Job) => void | Promise<void>): Promise<Job> {
  const prev = writeQueues.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    const job = await loadJob(id);
    await change(job);
    job.status = deriveStatus(job);
    await saveJob(job);
    return job;
  });
  writeQueues.set(id, next);
  return next;
}

export async function listJobs(): Promise<Job[]> {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  const entries = await fs.readdir(JOBS_DIR, { withFileTypes: true });
  const jobs: Job[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isValidJobId(e.name)) continue;
    try {
      jobs.push(await loadJob(e.name));
    } catch {
      // Folder without a readable job.json: skip it.
    }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addLog(job: Job, step: string, message: string, durationMs?: number): void {
  job.log.push({ at: new Date().toISOString(), step, message, ...(durationMs != null ? { durationMs } : {}) });
}

export function addCost(job: Job, entry: Omit<CostEntry, "at">): void {
  (job.costs ??= []).push({ at: new Date().toISOString(), ...entry });
}

export function totalCostUsd(job: Job): number {
  return Math.round((job.costs ?? []).reduce((sum, c) => sum + c.usd, 0) * 10000) / 10000;
}

/** Apply user edits to the source fields (only known fields, trimmed). */
export function applySourceEdits(job: Job, edits: Partial<Record<keyof SourceInfo, unknown>>): void {
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 500) : undefined);
  const account = str(edits.account);
  if (account !== undefined) job.source.account = normalizeAccount(account);
  const accountName = str(edits.accountName);
  if (accountName !== undefined) job.source.accountName = accountName;
  const postDate = str(edits.postDate);
  if (postDate !== undefined) {
    if (postDate && !isIsoDate(postDate)) throw new Error("Datum moet de vorm JJJJ-MM-DD hebben.");
    job.source.postDate = postDate;
  }
  const title = str(edits.title);
  if (title !== undefined) job.source.title = title;
}
