// "npm run check": tells you, in plain Dutch, whether this laptop is ready.
// It never prints the value of a key, only whether it is filled in.

import "dotenv/config";
import fs from "node:fs";
import { tools, toolVersion } from "../server/tools.ts";

let problems = 0;
const ok = (msg: string) => console.log("  ✅ " + msg);
const bad = (msg: string, fix: string) => {
  problems++;
  console.log("  ❌ " + msg + "\n     → " + fix);
};
const warn = (msg: string, fix: string) => console.log("  ⚠️  " + msg + "\n     → " + fix);

console.log("\nWalt Truman Studio – controle van deze laptop\n");

const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node.js ${process.versions.node}`);
else bad(`Node.js ${process.versions.node} is te oud`, "Installeer Node.js 20 of nieuwer (zie README).");

for (const [name, cmd, arg] of [
  ["ffmpeg", tools.ffmpeg(), "-version"],
  ["ffprobe", tools.ffprobe(), "-version"],
] as const) {
  const v = await toolVersion(cmd, arg);
  if (v) ok(`${name}: ${v.slice(0, 60)}`);
  else bad(`${name} niet gevonden`, "Installeer ffmpeg (zie README, stap 'Installeren').");
}

const yt = await toolVersion(tools.ytdlp(), "--version");
if (yt) ok(`yt-dlp ${yt}`);
else warn("yt-dlp niet gevonden", "Niet verplicht: zonder yt-dlp upload je video's zelf. Installeren: zie README.");

if (!fs.existsSync(".env")) {
  bad(".env bestaat nog niet", "Kopieer .env.example naar .env en vul je sleutels in.");
} else {
  for (const key of ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY"]) {
    if (process.env[key]?.trim()) ok(`${key} is ingevuld`);
    else warn(`${key} is nog leeg`, "Nodig vanaf stap 2. Vul hem in in .env.");
  }
}

console.log(problems === 0 ? "\nAlles klaar. Start de studio met:  npm run studio\n" : `\n${problems} probleem/problemen gevonden. Los ze op en draai opnieuw: npm run check\n`);
process.exit(problems === 0 ? 0 : 1);
