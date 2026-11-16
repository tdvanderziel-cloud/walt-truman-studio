// "npm run eval": run the 10 test claims through the same research + verdict
// route as the studio and report how many verdicts are correct.
// Costs real money (roughly $0.50-1 per claim). Use --only=id1,id2 to run a few.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { checkOneClaim } from "../server/factcheck.ts";
import { ROOT_DIR } from "../server/jobs.ts";

interface TestClaim {
  id: string;
  claimNl: string;
  quote: string;
  expected: string;
  alsoOk: string[];
}

const set = JSON.parse(await fs.readFile(path.join(ROOT_DIR, "eval", "claims.json"), "utf8")) as { claims: TestClaim[] };
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const claims = only ? set.claims.filter((c) => only.includes(c.id)) : set.claims;
const today = new Date().toISOString().slice(0, 10);

console.log(`\nTestset: ${claims.length} beweringen. Dit kost ongeveer $${Math.ceil(claims.length * 0.75)} en duurt een paar minuten per bewering.\n`);
const rows: string[] = [];
let correct = 0;
let totalUsd = 0;
for (const c of claims) {
  process.stdout.write(`- ${c.id} … `);
  try {
    const r = await checkOneClaim({ claimNl: c.claimNl, quote: c.quote, t: 0 }, { today, postDate: "", account: "", platform: "" });
    const ok = r.result.verdict === c.expected || c.alsoOk.includes(r.result.verdict);
    if (ok) correct++;
    const usd = r.researchCostUsd + r.verdictCostUsd;
    totalUsd += usd;
    console.log(`${ok ? "✅" : "❌"} ${r.result.verdict} (verwacht ${c.expected}) · ${r.result.sources.length} bronnen · $${usd.toFixed(2)}`);
    rows.push(`| ${c.id} | ${c.expected} | ${r.result.verdict} | ${ok ? "✅" : "❌"} | ${r.result.confidence} | ${r.result.sources.map((s) => s.publisher).join(", ")} | $${usd.toFixed(2)} |`);
  } catch (err) {
    console.log("⚠️ fout: " + (err as Error).message);
    rows.push(`| ${c.id} | ${c.expected} | (fout) | ❌ | | ${(err as Error).message.slice(0, 80)} | |`);
  }
}
const score = `${correct} van ${claims.length} goed`;
console.log(`\nScore: ${score} · totale kosten $${totalUsd.toFixed(2)}\n`);

const report = [
  `# Testset factcheck – ${today}`,
  "",
  `**Score: ${score}** · kosten $${totalUsd.toFixed(2)}`,
  "",
  "| Test | Verwacht | Studio | Goed? | Betrouwbaarheid | Bronnen | Kosten |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
].join("\n");
const out = path.join(ROOT_DIR, "eval", `results-${today}.md`);
await fs.writeFile(out, report, "utf8");
console.log(`Verslag opgeslagen: ${path.relative(ROOT_DIR, out)}\n`);
