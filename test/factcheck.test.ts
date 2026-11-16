import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wt-fc-"));
process.env.JOBS_DIR = tmp;
const fc = await import("../server/factcheck.ts");
const jobs = await import("../server/jobs.ts");
after(() => fs.rm(tmp, { recursive: true, force: true }));

const src = (url: string, publisher = "Pub") => ({
  url, title: "T", publisher, date: "2024", type: "nieuwsmedium" as const, stance: "weerspreekt" as const, finding: "f",
});
const verdict = (over: Partial<Parameters<typeof fc.applySafetyRules>[0]> = {}) => ({
  verdict: "Onjuist" as const, confidence: "hoog" as const, explanation: "x", sourcesDisagree: false, disagreementNote: "", isRecentNews: false,
  sources: [src("https://www.nasa.gov/a"), src("https://www.esa.int/b?utm_source=x")],
  ...over,
});

test("normalizeUrl ignores www, trailing slash, hash and tracking params", () => {
  assert.equal(fc.normalizeUrl("https://www.Nasa.gov/a/?utm_source=t#x"), fc.normalizeUrl("http://nasa.gov/a"));
  assert.notEqual(fc.normalizeUrl("https://nasa.gov/a?id=1"), fc.normalizeUrl("https://nasa.gov/a?id=2"));
});

test("safety: valid sources keep the verdict", () => {
  const found = new Set([fc.normalizeUrl("https://nasa.gov/a"), fc.normalizeUrl("https://esa.int/b")]);
  const { result, notes } = fc.applySafetyRules(verdict(), found);
  assert.equal(result.verdict, "Onjuist");
  assert.equal(result.sources.length, 2);
  assert.deepEqual(notes, []);
});

test("safety: invented URLs are dropped and verdict becomes Nog onbekend", () => {
  const found = new Set([fc.normalizeUrl("https://nasa.gov/a")]);
  const { result, notes } = fc.applySafetyRules(verdict(), found);
  assert.equal(result.sources.length, 1);
  assert.equal(result.verdict, "Nog onbekend");
  assert.equal(result.confidence, "laag");
  assert.ok(notes.some((n) => n.includes("niet in de zoekresultaten")));
});

test("safety: social media never counts as a source", () => {
  const v = verdict({ sources: [src("https://www.tiktok.com/@x/video/1"), src("https://reddit.com/r/x"), src("https://nasa.gov/a")] });
  const found = new Set(v.sources.map((s) => fc.normalizeUrl(s.url)));
  const { result } = fc.applySafetyRules(v, found);
  assert.deepEqual(result.sources.map((s) => s.url), ["https://nasa.gov/a"]);
  assert.equal(result.verdict, "Nog onbekend");
});

test("safety: recent news with low confidence becomes Nog onbekend", () => {
  const v = verdict({ isRecentNews: true, confidence: "laag" });
  const found = new Set(v.sources.map((s) => fc.normalizeUrl(s.url)));
  assert.equal(fc.applySafetyRules(v, found).result.verdict, "Nog onbekend");
});

async function jobWithFactcheck() {
  const job = await jobs.createJob("https://www.tiktok.com/@maker/video/1");
  const claim = {
    id: "c1", t: 1, tEnd: 5, quote: "q", claimNl: "Bewering", claimShortEn: "Short claim", topic: "ruimte",
    politicalLean: "niet politiek" as const, ...verdict(), safetyNotes: [], researchNotes: "notes", approvedHash: null,
  };
  await fc.saveFactcheck(job.id, { createdAt: "x", updatedAt: "x", model: "m", claims: [claim], skipped: [] }, job);
  return { job, claim };
}

const editBody = (claim: Record<string, unknown>, approve: boolean, over: Record<string, unknown> = {}) => ({
  id: "c1", claimNl: claim.claimNl, claimShortEn: claim.claimShortEn, topic: claim.topic, politicalLean: claim.politicalLean,
  verdict: claim.verdict, confidence: claim.confidence, explanation: claim.explanation, disagreementNote: "", t: 1, tEnd: 5,
  sources: claim.sources, approve, ...over,
});

test("approval: required for video, and lost after any later edit", async () => {
  const { job, claim } = await jobWithFactcheck();
  assert.equal(fc.readyForVideo(await fc.loadFactcheck(job.id)).ok, false);

  await fc.editClaim(job.id, editBody(claim, true));
  let file = await fc.loadFactcheck(job.id);
  assert.equal(fc.isApproved(file!.claims[0]), true);
  assert.equal(fc.readyForVideo(file).ok, true);

  // Changing the verdict on disk without re-approving invalidates approval.
  file!.claims[0].verdict = "Klopt";
  await fc.saveFactcheck(job.id, file!);
  file = await fc.loadFactcheck(job.id);
  assert.equal(fc.isApproved(file!.claims[0]), false);
  assert.equal(fc.readyForVideo(file).ok, false);

  const md = await fs.readFile(path.join(tmp, job.id, "factcheck.md"), "utf8");
  assert.match(md, /Oordeel: Klopt\*\* \(TRUE\)/);
  assert.match(md, /nog niet goedgekeurd/);
});

test("approval: refused with fewer than 2 sources unless Nog onbekend", async () => {
  const { job, claim } = await jobWithFactcheck();
  await assert.rejects(fc.editClaim(job.id, editBody(claim, true, { sources: [claim.sources[0]] })), /minstens 2 bronnen/);
  await fc.editClaim(job.id, editBody(claim, true, { sources: [claim.sources[0]], verdict: "Nog onbekend" }));
  assert.equal(fc.readyForVideo(await fc.loadFactcheck(job.id)).ok, true);
});

test("deleting all claims blocks the video", async () => {
  const { job } = await jobWithFactcheck();
  await fc.deleteClaim(job.id, "c1");
  assert.equal(fc.readyForVideo(await fc.loadFactcheck(job.id)).ok, false);
});
