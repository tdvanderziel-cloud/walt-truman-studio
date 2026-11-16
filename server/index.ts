// The local studio: a small web server on http://localhost:<PORT>.
// Only listens on this laptop (127.0.0.1); there is no login.

import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { attachUpload, fetchWithYtdlp } from "./fetch-video.ts";
import { applySourceEdits, createJob, isValidJobId, jobFile, listJobs, loadJob, missingSourceFields, ROOT_DIR, updateJob, addLog } from "./jobs.ts";
import { isValidHttpUrl } from "./source.ts";

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
  return { ...job, missingSource: missingSourceFields(job.source) };
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Walt Truman Factcheck Studio draait op  http://localhost:${PORT}\n  Stoppen: Ctrl+C\n`);
});
