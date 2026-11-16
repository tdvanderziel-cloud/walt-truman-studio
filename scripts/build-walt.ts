// "npm run build:walt": builds Walt's transparent mouth-position images from the
// green-screen reference photo (route A, "digital puppet").
//   1. chroma key: green -> transparent, remove green spill on the edges
//   2. jaw drop: everything below the mouth line moves down per mouth level,
//      the gap is filled with a dark mouth interior and a tongue
// Output: brand/walt/front-mouth-0.png ... front-mouth-3.png (+ preview sheet)

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ROOT_DIR } from "../server/jobs.ts";

interface RigPose {
  source: string;
  key: { green: [number, number, number]; tolerance: number; softness: number };
  mouthLine: [number, number][];
  jaw: { xMin: number; xMax: number; chinY: number; fadeEndY: number };
  levels: number[];
  crop: { top: number };
}

const rig = JSON.parse(await fs.readFile(path.join(ROOT_DIR, "brand/walt/rig.json"), "utf8")) as { front: RigPose };
const pose = rig.front;
const OUT = path.join(ROOT_DIR, "brand/walt");

const { data: src, info } = await sharp(path.join(ROOT_DIR, pose.source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const idx = (x: number, y: number) => (y * W + x) * 4;

// ---------- 1. chroma key ----------
const keyed = Buffer.from(src);
const [kr, kg, kb] = pose.key.green;
for (let i = 0; i < keyed.length; i += 4) {
  const r = keyed[i], g = keyed[i + 1], b = keyed[i + 2];
  // Distance to the key colour, plus how much green dominates.
  const dist = Math.hypot(r - kr, g - kg, b - kb);
  const greenness = g - Math.max(r, b);
  let alpha = 255;
  if (greenness > 20) {
    const t = (dist - pose.key.tolerance) / pose.key.softness;
    alpha = Math.round(255 * Math.min(1, Math.max(0, t)));
  }
  keyed[i + 3] = alpha;
  // Despill: green may not exceed the average of red and blue by much.
  const cap = Math.max(r, b) + 6;
  if (g > cap) keyed[i + 1] = cap;
}

// ---------- 2. jaw drop ----------
function mouthY(x: number): number {
  const pts = pose.mouthLine;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}
const mx0 = pose.mouthLine[0][0];
const mx1 = pose.mouthLine[pose.mouthLine.length - 1][0];

/** How far the jaw drops at column x: most in the middle, little at the corners (hinge). */
function dropAt(x: number, d: number): number {
  if (x < mx0 || x > mx1) return 0;
  const u = (x - mx0) / (mx1 - mx0);
  return d * Math.pow(Math.sin(Math.PI * u), 0.8);
}

/** Below the chin the shift fades out, so the neck stretches instead of tearing. */
function fade(y: number): number {
  const { chinY, fadeEndY } = pose.jaw;
  if (y <= chinY) return 1;
  if (y >= fadeEndY) return 0;
  return 1 - (y - chinY) / (fadeEndY - chinY);
}

/** Inside of the mouth: dark throat at the top/back, rounded pink tongue at the bottom. */
function mouthColour(x: number, depth: number, dCol: number): [number, number, number] {
  const v = depth / Math.max(1, dCol); // 0 = upper lip, 1 = jaw
  const u = (x - mx0) / (mx1 - mx0); // 0 = left corner, 1 = right corner
  const lightness = 0.55 + 0.45 * Math.sin(Math.PI * u); // darker towards the corners
  let r = (48 + 70 * v) * lightness, g = (6 + 8 * v) * lightness, b = (16 + 14 * v) * lightness;
  // Tongue: the top half of an ellipse resting on the jaw.
  const rv = Math.min(dCol * 0.6, 24);
  const tongue = ((u - 0.5) / 0.24) ** 2 + ((depth - dCol) / rv) ** 2;
  if (dCol > 12 && tongue < 1) {
    const edge = Math.min(1, (1 - tongue) * 5); // soft edge
    const shade = 0.78 + 0.22 * Math.min(1, (dCol - depth) / rv); // lighter on top
    r = r * (1 - edge) + 226 * shade * edge;
    g = g * (1 - edge) + 120 * shade * edge;
    b = b * (1 - edge) + 130 * shade * edge;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

const isPuppetSkinOrLip = (b: Buffer, i: number) => {
  const r = b[i], g = b[i + 1], bl = b[i + 2], a = b[i + 3];
  const navyBlazer = bl > r + 10 && r < 110;
  const whiteShirt = r > 185 && g > 185 && bl > 185;
  return a > 0 && !navyBlazer && !whiteShirt; // felt skin, purple lip, shadows
};

function mouthFrame(d: number): Buffer {
  const out = Buffer.from(keyed);
  if (d === 0) return out;
  const { xMin, xMax, fadeEndY } = pose.jaw;
  for (let x = xMin; x <= xMax; x++) {
    const top = Math.round(mouthY(x));
    const dCol = dropAt(x, d);
    if (dCol < 0.5) continue;
    // Destination rows: for each source row y, it lands at y + dCol*fade(y).
    // Inverse-map by walking down the source rows (the mapping only increases).
    let s = top;
    for (let y = top; y < fadeEndY; y++) {
      while (s < fadeEndY && s + dCol * fade(s) < y) s++;
      const di = idx(x, y);
      const gapEnd = top + dCol; // rows above this are the open mouth
      if (y < gapEnd + 1) {
        const [r, g, b] = mouthColour(x, y - top, dCol);
        // Soft (anti-aliased) edges at the top lip and the jaw.
        const topCov = Math.min(1, Math.max(0, y + 1 - mouthY(x)));
        const botCov = Math.min(1, Math.max(0, gapEnd - y));
        const cov = Math.min(topCov, botCov);
        if (cov <= 0) continue;
        out[di] = Math.round(r * cov + keyed[di] * (1 - cov));
        out[di + 1] = Math.round(g * cov + keyed[di + 1] * (1 - cov));
        out[di + 2] = Math.round(b * cov + keyed[di + 2] * (1 - cov));
        out[di + 3] = 255;
        if (cov >= 1) continue;
      }
      const si = idx(x, Math.min(H - 1, s));
      if (!isPuppetSkinOrLip(keyed, si)) continue; // only the felt jaw moves, not collar or blazer
      out[di] = keyed[si]; out[di + 1] = keyed[si + 1]; out[di + 2] = keyed[si + 2]; out[di + 3] = keyed[si + 3];
    }
  }
  return out;
}

// ---------- write ----------
const crop = { left: 0, top: pose.crop.top, width: W, height: H - pose.crop.top };
const files: string[] = [];
for (const [level, d] of pose.levels.entries()) {
  const file = path.join(OUT, `front-mouth-${level}.png`);
  await sharp(mouthFrame(d), { raw: { width: W, height: H, channels: 4 } }).extract(crop).png({ compressionLevel: 9 }).toFile(file);
  files.push(file);
  console.log("✓", path.relative(ROOT_DIR, file));
}

// Preview sheet on a grey background, for checking against the character sheet.
const thumbs = await Promise.all(
  files.map((f) => sharp(f).resize({ height: 900 }).flatten({ background: "#9aa0a6" }).toBuffer()),
);
const tw = (await sharp(thumbs[0]).metadata()).width!;
await sharp({ create: { width: tw * thumbs.length, height: 900, channels: 3, background: "#9aa0a6" } })
  .composite(thumbs.map((input, i) => ({ input, left: i * tw, top: 0 })))
  .jpeg({ quality: 85 })
  .toFile(path.join(OUT, "preview-mouths.jpg"));
console.log("✓ brand/walt/preview-mouths.jpg (controleer tegen het karakterblad)");
