// The local studio: a small web server on http://localhost:<PORT>.
// Only listens on this laptop (127.0.0.1); there is no login.

import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { attachUpload, fetchWithYtdlp } from "./fetch-video.ts";
import fs from "node:fs/promises";
import { isAnalysisRunning, resetStaleAnalyses, startAnalysis } from "./analyze.ts";
import { applySourceEdits, createJob, isValidJobId, jobDir, jobFile, listJobs, loadJob, missingSourceFields, ROOT_DIR, totalCostUsd, updateJob, addLog } from "./jobs.ts";
import { isValidHttpUrl } from "./source.ts";
import { deleteClaim, editClaim, isApproved, isFactcheckRunning, loadFactcheck, readyForVideo, startFactcheck, VERDICT_EN } from "./factcheck.ts";

const PORT = Number(process.env.PORT || 4321);
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } }); // 1 GB

// Small wrapper so async errors become a JSON error response.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function jobView(job: Awaited<ReturnType<typeof loadJob>>) {
  return { ...job, missingSource: missingSourceFields(job.source), totalCostUsd: totalCostUsd(job) };
}

function requireJobId(req: Request): string {
  const id = String(req.params.id);
  if (!isValidJobId(id)) throw Object.assign(new Error("Job niet gevonden."), { status: 404 });
  return id;
}

app.get("/api/jobs", h(async (_req, res) => {
  res.json((await listJobs()).map(jobView));
}));

app.get("/api/jobs/:id", h(async (req, res) => {
  res.json(jobView(await loadJob(requireJobId(req))));
}));

// New job from a link. `skipDownload` = user will upload the file themselves.
app.post("/api/jobs", h(async (req, res) => {
  const url = String(req.body?.url ?? "").trim();
  if (!isValidHttpUrl(url)) {
    res.status(400).json({ error: "Plak een volledige link, beginnend met https://" });
    return;
  }
  const job = await createJob(url, String(req.body?.name ?? "").trim() || undefined);
  if (!req.body?.skipDownload) {
    job.status = "fetching";
    // Fire and forget: the page polls the job for progress.
    void fetchWithYtdlp(job.id);
  } else {
    await updateJob(job.id, (j) => addLog(j, "invoer", "Ophalen overgeslagen: gebruiker uploadt zelf"));
  }
  res.status(201).json(jobView(job));
}));

app.post("/api/jobs/:id/retry-download", h(async (req, res) => {
  const id = requireJobId(req);
  void fetchWithYtdlp(id);
  res.json({ ok: true });
}));

app.post("/api/jobs/:id/upload", upload.single("video"), h(async (req, res) => {
  const id = requireJobId(req);
  if (!req.file) {
    res.status(400).json({ error: "Geen bestand ontvangen." });
    return;
  }
  const job = await attachUpload(id, req.file.path, req.file.originalname);
  res.json(jobView(job));
}));

app.patch("/api/jobs/:id/source", h(async (req, res) => {
  const id = requireJobId(req);
  const job = await updateJob(id, (j) => {
    applySourceEdits(j, req.body ?? {});
    addLog(j, "invoer", "Broninformatie aangepast");
  });
  res.json(jobView(job));
}));

// Step 2: start the analysis (runs in the background; the page polls the job).
app.post("/api/jobs/:id/analyze", h(async (req, res) => {
  const job = await startAnalysis(requireJobId(req));
  res.json(jobView(job));
}));

// Everything the page needs to show the analysis result.
app.get("/api/jobs/:id/analysis", h(async (req, res) => {
  const id = requireJobId(req);
  const read = async (name: string) => {
    try {
      return JSON.parse(await fs.readFile(jobFile(id, name), "utf8"));
    } catch {
      return null;
    }
  };
  const transcript = await read("transcript.json");
  res.json({
    analysis: await read("analysis.json"),
    frames: (await read("frames.json")) ?? [],
    segments: transcript?.segments ?? [],
    running: isAnalysisRunning(id),
  });
}));

app.get("/api/jobs/:id/frames/:name", h(async (req, res) => {
  const name = String(req.params.name);
  if (!/^f-\d{3}\.jpg$/.test(name)) throw Object.assign(new Error("Niet gevonden."), { status: 404 });
  res.sendFile(path.join(jobDir(requireJobId(req)), "frames", name));
}));

// Step 3: fact-check (background) and step 4: review edits.
app.post("/api/jobs/:id/factcheck", h(async (req, res) => {
  res.json(jobView(await startFactcheck(requireJobId(req))));
}));

app.get("/api/jobs/:id/factcheck", h(async (req, res) => {
  const id = requireJobId(req);
  const file = await loadFactcheck(id);
  res.json({
    factcheck: file && { ...file, claims: file.claims.map((c) => ({ ...c, approved: isApproved(c), verdictEn: VERDICT_EN[c.verdict] })) },
    readyForVideo: readyForVideo(file),
    running: isFactcheckRunning(id),
  });
}));

app.put("/api/jobs/:id/claims/:claimId", h(async (req, res) => {
  const id = requireJobId(req);
  await editClaim(id, { ...req.body, id: String(req.params.claimId) });
  res.json({ ok: true });
}));

app.delete("/api/jobs/:id/claims/:claimId", h(async (req, res) => {
  await deleteClaim(requireJobId(req), String(req.params.claimId));
  res.json({ ok: true });
}));

// Overview of checked topics and political sides, across all jobs.
app.get("/api/coverage", h(async (_req, res) => {
  const rows = [];
  for (const job of await listJobs()) {
    const f = await loadFactcheck(job.id);
    for (const c of f?.claims ?? []) {
      rows.push({ jobId: job.id, date: job.createdAt.slice(0, 10), account: job.source.account, claim: c.claimNl, topic: c.topic, lean: c.politicalLean, verdict: c.verdict, approved: isApproved(c) });
    }
  }
  res.json(rows);
}));

// Stream the original video for the preview player (supports seeking).
app.get("/api/jobs/:id/video", h(async (req, res) => {
  const job = await loadJob(requireJobId(req));
  if (!job.video) {
    res.status(404).end();
    return;
  }
  res.sendFile(jobFile(job.id, job.video.file));
}));

app.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? (err.code === "ENOENT" ? 404 : 400);
  res.status(status).json({ error: status === 404 ? "Niet gevonden." : err.message });
});

// A studio restart interrupts running analyses; mark them so they can be restarted.
await resetStaleAnalyses(await listJobs());

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Walt Truman Factcheck Studio draait op  http://localhost:${PORT}\n  Stoppen: Ctrl+C\n`);
});
