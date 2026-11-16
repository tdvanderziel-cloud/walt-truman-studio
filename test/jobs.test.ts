import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wt-jobs-"));
process.env.JOBS_DIR = tmp;
const jobs = await import("../server/jobs.ts");

after(() => fs.rm(tmp, { recursive: true, force: true }));

test("createJob makes a dated folder with job.json", async () => {
  const job = await jobs.createJob("https://www.tiktok.com/@nos/video/1");
  assert.match(job.id, /^\d{4}-\d{2}-\d{2}-nos$/);
  assert.equal(job.source.account, "@nos");
  const again = await jobs.createJob("https://www.tiktok.com/@nos/video/2");
  assert.equal(again.id, job.id + "-2");
  const onDisk = JSON.parse(await fs.readFile(path.join(tmp, job.id, "job.json"), "utf8"));
  assert.equal(onDisk.source.url, "https://www.tiktok.com/@nos/video/1");
});

test("status: video + complete source = ready", async () => {
  const job = await jobs.createJob("https://www.instagram.com/reel/abc/");
  assert.deepEqual(jobs.missingSourceFields(job.source), ["account", "datum van de post"]);
  let j = await jobs.updateJob(job.id, (x) => { x.video = { file: "original.mp4", durationSec: 10, hasAudio: true }; });
  assert.equal(j.status, "needs_source");
  j = await jobs.updateJob(job.id, (x) => jobs.applySourceEdits(x, { account: "maker", postDate: "2026-11-01" }));
  assert.equal(j.status, "ready");
  assert.equal(j.source.account, "@maker");
});

test("applySourceEdits rejects bad dates", async () => {
  const job = await jobs.createJob("https://x.com/a/status/1");
  assert.throws(() => jobs.applySourceEdits(job, { postDate: "1 november" }), /JJJJ-MM-DD/);
});

test("job paths cannot escape the jobs folder", () => {
  assert.throws(() => jobs.jobDir("../etc"));
  assert.throws(() => jobs.jobFile("2026-01-01-ok", "../../secret"));
  assert.ok(!jobs.isValidJobId("2026-01-01-../x"));
});
