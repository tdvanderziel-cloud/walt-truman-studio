// Step 1: try to download the video and its metadata with yt-dlp.
// If that fails, the job waits for a manual upload.

import fs from "node:fs/promises";
import path from "node:path";
import { addLog, jobDir, jobFile, updateJob, type Job } from "./jobs.ts";
import { normalizeAccount, ytdlpDateToIso } from "./source.ts";
import { probeVideo, run, tools } from "./tools.ts";

// Videos longer than this are almost never short-form posts; we still allow
// them via upload, but don't auto-download hours of footage.
const MAX_DOWNLOAD_SEC = 20 * 60;

interface YtdlpInfo {
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  creator?: string;
  upload_date?: string;
  title?: string;
  description?: string;
  duration?: number;
  webpage_url?: string;
}

/** Turn a yt-dlp error into a short Dutch explanation for a beginner. */
export function explainYtdlpError(stderr: string, notInstalled: boolean): string {
  if (notInstalled) {
    return "yt-dlp is niet geïnstalleerd op deze laptop (zie README). Upload het videobestand zelf.";
  }
  const s = stderr.toLowerCase();
  if (s.includes("login") || s.includes("cookies") || s.includes("sign in") || s.includes("private")) {
    return "Het platform vraagt om in te loggen, of de video is privé. Upload het videobestand zelf.";
  }
  if (s.includes("unable to connect") || s.includes("proxy") || s.includes("timed out") || s.includes("getaddrinfo") || s.includes("network is unreachable")) {
    return "Geen verbinding met het platform. Controleer je internet en probeer opnieuw, of upload het videobestand zelf.";
  }
  if (s.includes("unsupported url")) {
    return "Deze link wordt niet herkend. Controleer de link, of upload het videobestand zelf.";
  }
  if (s.includes("429") || s.includes("rate")) {
    return "Het platform blokkeert tijdelijk (te veel verzoeken). Probeer later opnieuw of upload zelf.";
  }
  if (s.includes("not available") || s.includes("removed") || s.includes("404")) {
    return "De video is niet (meer) beschikbaar. Upload het bestand zelf als je het hebt.";
  }
  return "Ophalen lukte niet. Upload het videobestand zelf.";
}

async function findDownloadedFile(dir: string): Promise<string | null> {
  const files = await fs.readdir(dir);
  const video = files.find((f) => /^original\.(mp4|mov|webm|mkv|m4v)$/i.test(f));
  return video ?? null;
}

/** Runs in the background after a job is created with a link. */
export async function fetchWithYtdlp(jobId: string): Promise<void> {
  const started = Date.now();
  const dir = jobDir(jobId);
  const job = await updateJob(jobId, (j) => {
    j.status = "fetching";
    j.error = null;
    addLog(j, "invoer", "Video ophalen met yt-dlp gestart");
  });

  try {
    // First metadata only, so we can refuse very long videos before downloading.
    const meta = await run(tools.ytdlp(), ["--no-playlist", "--dump-json", "--no-warnings", job.source.url], {
      timeoutMs: 90_000,
    });
    const info = JSON.parse(meta.stdout.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}") as YtdlpInfo;
    await fs.writeFile(jobFile(jobId, "source-info.json"), JSON.stringify(info, null, 2), "utf8");
    if ((info.duration ?? 0) > MAX_DOWNLOAD_SEC) {
      throw Object.assign(new Error("too long"), {
        friendly: `Deze video duurt ${Math.round((info.duration ?? 0) / 60)} minuten. Dat is te lang om automatisch op te halen; knip het stuk met de bewering eruit en upload dat.`,
      });
    }

    await run(
      tools.ytdlp(),
      [
        "--no-playlist",
        "--no-warnings",
        "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "-o", "original.%(ext)s",
        job.source.url,
      ],
      { cwd: dir, timeoutMs: 10 * 60_000 },
    );
    const file = await findDownloadedFile(dir);
    if (!file) throw new Error("yt-dlp gaf geen videobestand terug.");
    const probe = await probeVideo(path.join(dir, file));

    await updateJob(jobId, (j) => {
      const s = j.source;
      // Only fill fields the user hasn't filled in already.
      s.account ||= normalizeAccount(info.uploader_id || info.channel || info.uploader || info.creator);
      s.accountName ||= info.uploader || info.channel || "";
      s.postDate ||= ytdlpDateToIso(info.upload_date);
      s.title ||= (info.title || info.description || "").slice(0, 300);
      s.retrievedVia = "yt-dlp";
      s.retrievedAt = new Date().toISOString();
      j.video = { file, ...probe };
      j.status = "needs_source"; // re-derived on save
      addLog(j, "invoer", `Video opgehaald (${probe.durationSec}s)`, Date.now() - started);
    });
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: string | number; friendly?: string };
    const notInstalled = e.code === "ENOENT";
    const friendly = e.friendly ?? explainYtdlpError(e.stderr ?? e.message, notInstalled);
    await updateJob(jobId, (j) => {
      j.status = "needs_upload";
      j.error = friendly;
      addLog(j, "invoer", `Ophalen mislukt: ${friendly}`, Date.now() - started);
    });
  }
}

export const ALLOWED_UPLOAD_EXT = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];

/** Store an uploaded file as original.<ext> and read its duration. */
export async function attachUpload(jobId: string, tmpPath: string, originalName: string): Promise<Job> {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXT.includes(ext)) {
    await fs.rm(tmpPath, { force: true });
    throw new Error(`Bestandstype ${ext || "(onbekend)"} wordt niet ondersteund. Gebruik mp4, mov, webm of mkv.`);
  }
  const dir = jobDir(jobId);
  // Remove an earlier original, if any.
  const old = await findDownloadedFile(dir);
  if (old) await fs.rm(path.join(dir, old), { force: true });

  const file = "original" + ext;
  const dest = path.join(dir, file);
  try {
    await fs.rename(tmpPath, dest);
  } catch {
    // rename fails across disks; fall back to copy.
    await fs.copyFile(tmpPath, dest);
    await fs.rm(tmpPath, { force: true });
  }
  let probe;
  try {
    probe = await probeVideo(dest);
  } catch (err) {
    await fs.rm(dest, { force: true });
    throw new Error("Dit bestand kan niet als video gelezen worden. " + ((err as Error).message ?? ""));
  }
  return updateJob(jobId, (j) => {
    j.video = { file, ...probe };
    j.error = null;
    j.source.retrievedVia = "upload";
    j.source.retrievedAt = new Date().toISOString();
    addLog(j, "invoer", `Video geüpload (${probe.durationSec}s)`);
  });
}
