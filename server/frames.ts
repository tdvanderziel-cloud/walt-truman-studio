// Extract still frames: one every N seconds plus one at every scene change.
// One ffmpeg pass; timestamps are read from the `showinfo` filter output.

import fs from "node:fs/promises";
import path from "node:path";
import { run, tools } from "./tools.ts";

export interface Frame {
  file: string; // relative to the job folder, e.g. "frames/f-003.jpg"
  t: number; // seconds
  reason: "interval" | "scene";
}

export const MAX_FRAMES = 60;

/** Interval grows for long videos so we stay around 50 interval frames. */
export function frameInterval(durationSec: number): number {
  return Math.max(2, Math.ceil(durationSec / 50));
}

/** Parse "pts_time:12.345" values from ffmpeg showinfo output, in order. */
export function parseShowinfoTimes(stderr: string): number[] {
  const times: number[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.includes("Parsed_showinfo")) continue;
    const m = line.match(/pts_time:\s*([\d.]+)/);
    if (m) times.push(Number(m[1]));
  }
  return times;
}

/** Keep at most `max` items, evenly spread, always keeping first and last. */
export function evenlyPick<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

export async function extractFrames(jobDirPath: string, videoFile: string, durationSec: number): Promise<Frame[]> {
  const outDir = path.join(jobDirPath, "frames");
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir);

  const interval = frameInterval(durationSec);
  // Select a frame if: it's the first, ≥interval s since the last pick, or a scene change.
  const select = `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${interval})+gt(scene\\,0.3)'`;
  const scale = "scale=1024:1024:force_original_aspect_ratio=decrease";
  const { stderr } = await run(
    tools.ffmpeg(),
    [
      "-hide_banner", "-nostats",
      "-i", path.join(jobDirPath, videoFile),
      "-vf", `${select},showinfo,${scale}`,
      "-fps_mode", "vfr",
      "-q:v", "4",
      path.join(outDir, "raw-%04d.jpg"),
    ],
    { timeoutMs: 10 * 60_000 },
  );
  const times = parseShowinfoTimes(stderr);
  const rawFiles = (await fs.readdir(outDir)).filter((f) => f.startsWith("raw-")).sort();

  let frames: (Frame & { raw: string })[] = rawFiles.map((raw, i) => {
    const t = Math.round((times[i] ?? i * interval) * 10) / 10;
    const prev = i > 0 ? times[i - 1] ?? 0 : -Infinity;
    return { raw, file: "", t, reason: i === 0 || t - prev >= interval - 0.05 ? "interval" : "scene" };
  });
  frames = evenlyPick(frames, MAX_FRAMES);

  // Rename to a clean numbered sequence and delete the ones we dropped.
  const keep = new Set(frames.map((f) => f.raw));
  for (const raw of rawFiles) if (!keep.has(raw)) await fs.rm(path.join(outDir, raw));
  const result: Frame[] = [];
  for (const [i, f] of frames.entries()) {
    const name = `f-${String(i + 1).padStart(3, "0")}.jpg`;
    await fs.rename(path.join(outDir, f.raw), path.join(outDir, name));
    result.push({ file: `frames/${name}`, t: f.t, reason: f.reason });
  }
  await fs.writeFile(path.join(jobDirPath, "frames.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

/** Mono 16 kHz mp3: small upload, plenty for speech recognition. */
export async function extractAudio(jobDirPath: string, videoFile: string): Promise<string> {
  const out = path.join(jobDirPath, "audio.mp3");
  await run(
    tools.ffmpeg(),
    ["-hide_banner", "-y", "-i", path.join(jobDirPath, videoFile), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out],
    { timeoutMs: 10 * 60_000 },
  );
  return out;
}
