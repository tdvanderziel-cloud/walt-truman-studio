// "npm run key -- <input.mp4> <output.webm> [--black]": make a transparent Walt
// clip (VP9 + alpha) for the template.
//   default:  remove a green screen (chromakey + despill). Only works when the
//             green is flat and bright.
//   --black:  the input already had its background removed by an AI remover
//             and sits on pure black (e.g. Higgsfield remove_background). We turn
//             "not black" into the alpha mask. This is the reliable route.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { run, tools } from "../server/tools.ts";

const args = process.argv.slice(2);
const fromBlack = args.includes("--black");
const [input, output] = args.filter((a) => !a.startsWith("--"));
if (!input || !output) {
  console.error("Gebruik: npm run key -- <input.mp4> <output.webm>");
  process.exit(1);
}

// Sample the background colour from the top-left corner of the first frame,
// so slightly different greens from different generators all work.
if (fromBlack) {
  // Background is (almost) exactly 0; the darkest blazer folds start around 4.
  const graph = [
    "[0:v]split[c][m]",
    "[m]format=gray,lut=y='if(gte(val,3),255,val*60)',dilation,dilation,erosion,erosion,gblur=sigma=0.7[a]",
    "[c]format=yuv420p[cc]",
    "[cc][a]alphamerge,format=yuva420p[v]",
  ].join(";");
  await run(tools.ffmpeg(), [
    "-hide_banner", "-y", "-i", input, "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-row-mt", "1", "-c:a", "libopus", "-b:a", "96k", output,
  ], { timeoutMs: 15 * 60_000 });
  console.log(`✓ ${path.basename(output)} (zwarte achtergrond -> transparant)`);
  process.exit(0);
}

// Sample several patches along the left/right edges and pick the greenest one,
// so lamps or props in a corner don't fool us.
let hex = "0x32AF53";
try {
  const tmp = path.join(os.tmpdir(), `walt-key-${process.pid}.png`);
  await run(tools.ffmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", input, "-frames:v", "1", tmp], { timeoutMs: 60_000 });
  const { width = 0, height = 0 } = await sharp(tmp).metadata();
  let best = { score: -Infinity, rgb: [50, 175, 83] };
  for (const fx of [0.02, 0.9]) {
    for (const fy of [0.3, 0.45, 0.6, 0.75]) {
      // stats() reads the input, not the pipeline: crop to a buffer first.
      const patch = await sharp(tmp).extract({ left: Math.round(fx * width), top: Math.round(fy * height), width: Math.max(4, Math.round(width * 0.06)), height: Math.max(4, Math.round(height * 0.03)) }).png().toBuffer();
      const { channels } = await sharp(patch).stats();
      const [r, g, b] = channels.slice(0, 3).map((c) => c.mean);
      const score = g - Math.max(r, b);
      if (score > best.score) best = { score, rgb: [r, g, b] };
    }
  }
  hex = "0x" + best.rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  await fs.rm(tmp, { force: true });
} catch {
  /* keep the default green */
}

const filter = [
  `chromakey=color=${hex}:similarity=0.22:blend=0.08`,
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
