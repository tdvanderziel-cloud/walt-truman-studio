import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildSegments, fmtTime, segmentsToText, transcribeFile, type SttWord } from "../server/transcribe.ts";
import { evenlyPick, extractAudio, extractFrames, frameInterval, parseShowinfoTimes } from "../server/frames.ts";
import { claudeCostUsd } from "../server/claude.ts";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wt-analyze-"));
after(() => fs.rm(tmp, { recursive: true, force: true }));

const w = (text: string, start: number, end: number, speaker = "speaker_0"): SttWord => ({ text, start, end, type: "word", speaker_id: speaker });
const sp = (start: number): SttWord => ({ text: " ", start, end: start, type: "spacing" });

test("buildSegments splits on sentence end, pause and speaker", () => {
  const words = [
    w("Vaccines", 0, 0.4), sp(0.4), w("contain", 0.5, 0.9), sp(0.9), w("microchips.", 1.0, 1.8),
    w("That's", 2.0, 2.3), sp(2.3), w("false", 2.4, 2.9),
    w("Really?", 5.0, 5.5, "speaker_1"),
  ];
  const segs = buildSegments(words);
  assert.deepEqual(segs.map((s) => s.text), ["Vaccines contain microchips.", "That's false", "Really?"]);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[2].speaker, "speaker_1");
  assert.match(segmentsToText(segs), /^\[00:00\.0–00:01\.8\] \(speaker_0\) Vaccines/);
});

test("fmtTime", () => {
  assert.equal(fmtTime(0), "00:00.0");
  assert.equal(fmtTime(75.44), "01:15.4");
});

test("frame helpers", () => {
  assert.equal(frameInterval(30), 2);
  assert.equal(frameInterval(600), 12);
  assert.deepEqual(evenlyPick([1, 2, 3], 5), [1, 2, 3]);
  const picked = evenlyPick([...Array(100).keys()], 10);
  assert.equal(picked.length, 10);
  assert.equal(picked[0], 0);
  assert.equal(picked[9], 99);
  const log = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0       duration\n[Parsed_showinfo_1 @ 0x1] n:   1 pts:  30720 pts_time:2.0 x\nother line pts_time:9";
  assert.deepEqual(parseShowinfoTimes(log), [0, 2]);
});

test("claudeCostUsd uses the price table", () => {
  const usd = claudeCostUsd({ input_tokens: 100_000, output_tokens: 10_000, server_tool_use: { web_search_requests: 5 } }, "claude-opus-5-5", {
    claude: { "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 } },
    webSearchPer1000: 10, elevenlabsSttPerHour: 0.4, usdToEur: 0.9,
  });
  assert.equal(usd, 0.65);
});

test("extractFrames: interval frames plus scene changes, numbered, with times", async () => {
  // 3 s red, 3 s blue, 3 s green -> scene changes at 3 s and 6 s.
  const video = path.join(tmp, "scenes.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=red:s=360x640:r=30:d=3",
    "-f", "lavfi", "-i", "color=blue:s=360x640:r=30:d=3",
    "-f", "lavfi", "-i", "color=green:s=360x640:r=30:d=3",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=9",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
  const frames = await extractFrames(tmp, "scenes.mp4", 9);
  const times = frames.map((f) => f.t);
  assert.equal(times[0], 0);
  assert.ok(times.includes(3) || times.some((t) => Math.abs(t - 3) < 0.1), `scene at 3s missing: ${times}`);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]), "times must increase");
  assert.equal(frames[0].file, "frames/f-001.jpg");
  const files = await fs.readdir(path.join(tmp, "frames"));
  assert.equal(files.length, frames.length);
  assert.ok(files.every((f) => /^f-\d{3}\.jpg$/.test(f)));

  const audio = await extractAudio(tmp, "scenes.mp4");
  assert.ok((await fs.stat(audio)).size > 1000);
});

test("transcribeFile sends model, file and key; parses words", async () => {
  let seen: { key?: string; body: string } = { body: "" };
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("latin1");
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { key: req.headers["xi-api-key"] as string, body };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ language_code: "nld", text: "Hallo", words: [w("Hallo.", 0.1, 0.6)] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.ELEVENLABS_STT_URL = `http://127.0.0.1:${port}/v1/speech-to-text`;
  process.env.ELEVENLABS_API_KEY = "test-key";
  const file = path.join(tmp, "a.mp3");
  await fs.writeFile(file, "fake audio");
  try {
    const result = await transcribeFile(file);
    assert.equal(result.words[0].text, "Hallo.");
    assert.equal(seen.key, "test-key");
    assert.match(seen.body, /name="model_id"\r\n\r\nscribe_v1/);
    assert.match(seen.body, /name="file"; filename="a.mp3"/);
    assert.match(seen.body, /name="timestamps_granularity"\r\n\r\nword/);
  } finally {
    server.close();
    delete process.env.ELEVENLABS_STT_URL;
  }
});

test("transcribeFile explains a missing ElevenLabs permission", async () => {
  const server = http.createServer((_req, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission speech_to_text" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ELEVENLABS_STT_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  process.env.ELEVENLABS_API_KEY = "test-key";
  const file = path.join(tmp, "b.mp3");
  await fs.writeFile(file, "x");
  try {
    await assert.rejects(transcribeFile(file), /Speech to Text/);
  } finally {
    server.close();
    delete process.env.ELEVENLABS_STT_URL;
  }
});
