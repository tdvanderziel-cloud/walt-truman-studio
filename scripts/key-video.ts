// "npm run key -- <input.mp4> <output.webm>": remove the green screen from a
// Walt clip and write a transparent video (VP9 + alpha) for the template.
// Uses ffmpeg's chromakey plus a despill step so no green halo stays on the felt.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { run, tools } from "../server/tools.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Gebruik: npm run key -- <input.mp4> <output.webm>");
  process.exit(1);
}

// Sample the background colour from the top-left corner of the first frame,
// so slightly different greens from different generators all work.
let hex = "0x32AF53";
try {
  const tmp = path.join(os.tmpdir(), `walt-key-${process.pid}.png`);
  await run(tools.ffmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", "crop=40:40:10:10", "-frames:v", "1", tmp], { timeoutMs: 60_000 });
  const { channels } = await sharp(tmp).stats();
  hex = "0x" + channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, "0")).join("");
  await fs.rm(tmp, { force: true });
} catch {
  /* keep the default green */
}

const filter = [
  `chromakey=color=${hex}:similarity=0.16:blend=0.06`,
  "despill=type=green:mix=0.6:expand=0.1",
  "format=yuva420p",
].join(",");

await run(tools.ffmpeg(), [
  "-hide_banner", "-y", "-i", input, "-vf", filter,
  "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
  "-c:a", "libopus", "-b:a", "96k",
  output,
], { timeoutMs: 15 * 60_000 });
console.log(`✓ ${path.basename(output)} (groen ${hex} verwijderd)`);
