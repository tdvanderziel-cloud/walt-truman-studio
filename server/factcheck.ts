// Step 3: fact-check.
//   A. extract 1-3 checkable claims (structured, no tools)
//   B. per claim: research with web search + web fetch (free text notes)
//   C. per claim: verdict + sources as JSON, based ONLY on the research notes
// Code-side safety rules (see applySafetyRules) can force "Nog onbekend".

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { callClaudeJson, claudeCostUsd, friendlyApiError, getClient, MODEL, MODEL_LABEL, usageDetail, type UsageLike } from "./claude.ts";
import { addCost, addLog, jobDir, jobFile, loadJob, updateJob, type Job } from "./jobs.ts";
import { fmtTime, segmentsToText, type Segment } from "./transcribe.ts";

// ---------- vocabulary ----------

export const VERDICTS = ["Klopt", "Mist context", "Misleidend", "Onjuist", "Nog onbekend"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_EN: Record<Verdict, string> = {
  Klopt: "TRUE",
  "Mist context": "MISSING CONTEXT",
  Misleidend: "MISLEADING",
  Onjuist: "FALSE",
  "Nog onbekend": "UNPROVEN",
};
export const LEANS = ["niet politiek", "links/progressief", "rechts/conservatief", "gemengd/anders"] as const;
export const SOURCE_TYPES = ["officiële instantie", "wetenschappelijk onderzoek", "nieuwsmedium", "factchecker", "overig"] as const;
export const SOURCE_STANCES = ["bevestigt", "weerspreekt", "nuanceert", "achtergrond"] as const;

// ---------- schemas ----------

const ExtractSchema = z.object({
  claims: z
    .array(
      z.object({
        t: z.number().describe("Start time in seconds where the claim is made."),
        tEnd: z.number().describe("End time in seconds of the part of the video that contains the claim."),
        quote: z.string().describe("Exact words from transcript or on-screen text, original language."),
        claimNl: z.string().describe("The claim as one neutral, checkable Dutch sentence."),
        claimShortEn: z.string().describe("The claim in max 8 English words, for the top bar of the video."),
        topic: z.string().describe("One or two Dutch words, e.g. 'gezondheid', 'klimaat', 'migratie'."),
        politicalLean: z.enum(LEANS).describe("Which political side the claim's message mostly supports, if any."),
        whyCheckable: z.string().describe("Dutch: why this is a factual, verifiable claim."),
      }),
    )
    .describe("1-3 most important checkable claims, most important first."),
  skipped: z
    .array(z.object({ quote: z.string(), reason: z.string() }))
    .describe("Statements deliberately skipped (opinions, jokes, predictions, unverifiable), Dutch reason."),
});

const VerdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.enum(["hoog", "middel", "laag"]),
  explanation: z.string().describe("Dutch, plain language, 3-6 short sentences: what the sources say and why this verdict."),
  sourcesDisagree: z.boolean(),
  disagreementNote: z.string().describe("Dutch: how sources disagree. Empty string if they don't."),
  isRecentNews: z.boolean().describe("True if the claim is about events from the last ~2 weeks."),
  sources: z
    .array(
      z.object({
        url: z.string().describe("Must be one of the URLs listed in the research results."),
        title: z.string(),
        publisher: z.string(),
        date: z.string().describe("YYYY-MM-DD, YYYY-MM or YYYY; empty string if unknown."),
        type: z.enum(SOURCE_TYPES),
        stance: z.enum(SOURCE_STANCES),
        finding: z.string().describe("Dutch, one sentence: what this source says about the claim."),
      }),
    )
    .describe("2-4 best sources, primary sources first."),
});

export type ExtractResult = z.infer<typeof ExtractSchema>;
export type VerdictResult = z.infer<typeof VerdictSchema>;
export type Source = VerdictResult["sources"][number];

export interface ClaimCheck {
  id: string; // "c1", "c2", ...
  t: number;
  tEnd: number;
  quote: string;
  claimNl: string;
  claimShortEn: string;
  topic: string;
  politicalLean: (typeof LEANS)[number];
  verdict: Verdict;
  confidence: "hoog" | "middel" | "laag";
  explanation: string;
  sourcesDisagree: boolean;
  disagreementNote: string;
  isRecentNews: boolean;
  sources: Source[];
  safetyNotes: string[]; // why code changed the verdict or dropped sources
  researchNotes: string; // Claude's research write-up (for the reviewer)
  approvedHash: string | null; // hash of the content at the moment of approval
}

export interface FactcheckFile {
  createdAt: string;
  updatedAt: string;
  model: string;
  claims: ClaimCheck[];
  skipped: ExtractResult["skipped"];
}

// ---------- prompts ----------

const RULES = `Je werkt voor een onafhankelijke factcheckredactie. Betrouwbaarheid gaat boven alles: een fout oordeel kost het merk zijn geloofwaardigheid. Liever eerlijk "Nog onbekend" dan gokken.
- We checken beweringen, nooit personen. Geen oordeel over de maker of over sprekers.
- Behandel beweringen van alle politieke kanten op precies dezelfde manier.
- Schrijf in gewone, neutrale Nederlandse taal.`;

const EXTRACT_SYSTEM = `${RULES}

Taak: kies uit een video de 1-3 belangrijkste beweringen die je met bronnen kunt controleren.
- Alleen feitelijke, controleerbare beweringen (cijfers, gebeurtenissen, wetenschappelijke uitspraken, citaten).
- Sla meningen, grappen, satire, retorische vragen en voorspellingen over; zet ze bij "skipped" met de reden.
- Kies de bewering die de kern van de video is als eerste.
- Formuleer de bewering eerlijk: zo sterk als de video hem doet, niet sterker en niet zwakker.
- Geen controleerbare bewering? Geef dan een lege lijst.`;

function researchSystem(today: string): string {
  return `${RULES}

Taak: onderzoek één bewering grondig met de zoek- en ophaaltools. Vandaag is het ${today}.
- Zoek eerst primaire bronnen: officiële instanties, wetenschappelijke onderzoeken (liefst overzichtsstudies), statistiekbureaus. Daarna gerenommeerde nieuwsmedia en erkende factcheckers (IFCN-leden).
- Forums, social media, blogs en contentfarms zijn nooit een hoofdbron.
- Open (fetch) de belangrijkste bronnen om te lezen wat er echt staat; vertrouw niet op alleen een zoekresultaat.
- Zoek actief naar bronnen die de bewering ondersteunen én naar bronnen die hem tegenspreken.
- Let op: is dit nieuws van de afgelopen dagen met nog weinig betrouwbare bronnen? Zeg dat.

Schrijf daarna een onderzoeksverslag in het Nederlands:
1. Wat de belangrijkste bronnen precies zeggen (met titel, uitgever, datum en URL).
2. Waar bronnen elkaar tegenspreken.
3. Je voorlopige oordeel op de schaal Klopt / Mist context / Misleidend / Onjuist / Nog onbekend, en waarom.
Betekenis van de schaal:
- Klopt: de bewering is juist en niet misleidend.
- Mist context: de kern klopt, maar belangrijke informatie ontbreekt waardoor een verkeerde indruk kan ontstaan.
- Misleidend: bevat iets wat klopt, maar wordt zo gebruikt dat de conclusie niet klopt.
- Onjuist: de bewering wordt door betrouwbare bronnen weerlegd.
- Nog onbekend: er zijn te weinig betrouwbare bronnen, bronnen spreken elkaar fundamenteel tegen, of het is te recent.`;
}

const VERDICT_SYSTEM = `${RULES}

Taak: zet een onderzoeksverslag om in een gestructureerd oordeel.
- Gebruik ALLEEN informatie uit het verslag. Voeg niets toe uit eigen geheugen.
- Gebruik als bron ALLEEN URL's uit de lijst "Gevonden bronnen". Verzin nooit een URL, titel of datum.
- 2-4 bronnen, primaire bronnen eerst. Geen social media of forums.
- Als het verslag onzeker is, te weinig goede bronnen heeft, of de bronnen elkaar fundamenteel tegenspreken: "Nog onbekend".
- Betrouwbaarheid "hoog" alleen als meerdere onafhankelijke, gezaghebbende bronnen hetzelfde zeggen.`;

// ---------- safety rules (code, not model) ----------

const NON_PRIMARY_HOSTS = [
  "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "reddit.com", "quora.com",
  "threads.net", "t.me", "telegram.org", "youtube.com", "youtu.be", "pinterest.com", "medium.com", "substack.com",
];

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(p)) u.searchParams.delete(p);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function isNonPrimaryHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return NON_PRIMARY_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return true;
  }
}

/**
 * Enforce the rules the model might break:
 * - sources must come from the actual research results (no invented URLs)
 * - social media / forums don't count as sources
 * - fewer than 2 valid sources -> "Nog onbekend"
 * - recent news with low confidence -> "Nog onbekend"
 */
export function applySafetyRules(v: VerdictResult, foundUrls: Set<string>): { result: VerdictResult; notes: string[] } {
  const notes: string[] = [];
  const kept: Source[] = [];
  for (const s of v.sources) {
    if (!foundUrls.has(normalizeUrl(s.url))) {
      notes.push(`Bron verwijderd omdat de link niet in de zoekresultaten stond: ${s.url}`);
    } else if (isNonPrimaryHost(s.url)) {
      notes.push(`Bron verwijderd (social media/forum telt niet als bron): ${s.url}`);
    } else if (!kept.some((k) => normalizeUrl(k.url) === normalizeUrl(s.url))) {
      kept.push(s);
    }
  }
  const result: VerdictResult = { ...v, sources: kept.slice(0, 4) };
  if (result.verdict !== "Nog onbekend" && kept.length < 2) {
    notes.push(`Oordeel "${v.verdict}" veranderd in "Nog onbekend": minder dan 2 bruikbare bronnen.`);
    result.verdict = "Nog onbekend";
    result.confidence = "laag";
  }
  if (result.verdict !== "Nog onbekend" && result.isRecentNews && result.confidence === "laag") {
    notes.push(`Oordeel "${v.verdict}" veranderd in "Nog onbekend": recent nieuws en lage betrouwbaarheid.`);
    result.verdict = "Nog onbekend";
  }
  return { result, notes };
}

/** Approval is tied to the exact content: any edit after approval removes it. */
export function claimHash(c: ClaimCheck): string {
  const content = {
    claimNl: c.claimNl, claimShortEn: c.claimShortEn, verdict: c.verdict, confidence: c.confidence,
    explanation: c.explanation, disagreementNote: c.disagreementNote, t: c.t, tEnd: c.tEnd,
    sources: c.sources.map((s) => [s.url, s.title, s.publisher, s.date, s.finding]),
  };
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
}

export function isApproved(c: ClaimCheck): boolean {
  return c.approvedHash != null && c.approvedHash === claimHash(c);
}

// ---------- research call (web search + fetch) ----------

interface ResearchResult {
  notes: string;
  found: Map<string, { url: string; title: string; pageAge: string | null }>;
  usage: UsageLike;
}

export interface ClaimContext {
  today: string;
  postDate: string;
  account: string;
  platform: string;
}

type ClaimInput = Pick<ExtractResult["claims"][number], "claimNl" | "quote" | "t">;

/** Research + verdict + safety rules for one claim. Used by the studio and the test set. */
export async function checkOneClaim(claim: ClaimInput, ctx: ClaimContext, onStep: (s: string) => Promise<void> | void = () => {}) {
  const t0 = Date.now();
  await onStep("bronnen zoeken en lezen");
  const r = await research(claim, ctx);
  await onStep("oordeel vormen");
  const foundList = [...r.found.values()].map((f) => `- ${f.title} | ${f.url}${f.pageAge ? ` | ${f.pageAge}` : ""}`).join("\n");
  const v = await callClaudeJson({
    system: VERDICT_SYSTEM,
    schema: VerdictSchema,
    effort: "high",
    content: [
      {
        type: "text",
        text: `Bewering: "${claim.claimNl}"\nVandaag: ${ctx.today}. Video gepost: ${ctx.postDate || "onbekend"}.\n\nOnderzoeksverslag:\n${r.notes}\n\nGevonden bronnen (alleen deze URL's mag je gebruiken):\n${foundList || "(geen)"}`,
      },
    ],
  });
  const safe = applySafetyRules(v.data, new Set(r.found.keys()));
  return {
    result: safe.result,
    safetyNotes: safe.notes,
    researchNotes: r.notes,
    foundCount: r.found.size,
    researchUsage: r.usage,
    researchCostUsd: claudeCostUsd(r.usage),
    verdictUsage: v.usage,
    verdictCostUsd: v.costUsd,
    ms: Date.now() - t0,
  };
}

async function research(claim: ClaimInput, ctx: ClaimContext): Promise<ResearchResult> {
  const today = ctx.today;
  const client = getClient();
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        `Bewering om te onderzoeken: "${claim.claimNl}"`,
        `Letterlijk in de video (${fmtTime(claim.t)}): "${claim.quote}"`,
        ctx.postDate ? `De video is gepost op ${ctx.postDate} door ${ctx.account} op ${ctx.platform}.` : "",
        "Onderzoek de bewering, niet de persoon. Schrijf daarna het onderzoeksverslag.",
      ].join("\n"),
    },
  ];
  const found = new Map<string, { url: string; title: string; pageAge: string | null }>();
  const usage: UsageLike = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0 } };
  let notes = "";

  for (let round = 0; round < 6; round++) {
    let msg;
    try {
      msg = await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: researchSystem(today),
          messages,
          tools: [
            { type: "web_search_20260209", name: "web_search", max_uses: 8 },
            { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
          ],
          output_config: { effort: "high" },
        })
        .finalMessage();
    } catch (err) {
      throw friendlyApiError(err);
    }
    const u = msg.usage as UsageLike;
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.cache_creation_input_tokens! += u.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens! += u.cache_read_input_tokens ?? 0;
    usage.server_tool_use!.web_search_requests! += u.server_tool_use?.web_search_requests ?? 0;

    for (const block of msg.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) found.set(normalizeUrl(r.url), { url: r.url, title: r.title, pageAge: r.page_age });
      } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
        const url = block.content.url;
        const title = block.content.content.title ?? url;
        found.set(normalizeUrl(url), { url, title, pageAge: block.content.retrieved_at ?? null });
      } else if (block.type === "text") {
        notes += block.text;
      }
    }
    if (msg.stop_reason === "refusal") throw new Error("Claude weigerde deze bewering te onderzoeken (veiligheidsfilter).");
    if (msg.stop_reason !== "pause_turn") break;
    // Long research turn was paused by the API: send it back to continue.
    messages.push({ role: "assistant", content: msg.content });
  }
  if (!notes.trim()) throw new Error("Het onderzoek leverde geen verslag op. Probeer opnieuw.");
  return { notes: notes.trim(), found, usage };
}

// ---------- pipeline ----------

const running = new Set<string>();
export const isFactcheckRunning = (id: string) => running.has(id);

export async function startFactcheck(jobId: string): Promise<Job> {
  const job = await loadJob(jobId);
  if (job.analysis?.state !== "done") throw new Error("Doe eerst de analyse (stap 2).");
  if (running.has(jobId)) throw new Error("De factcheck loopt al.");
  running.add(jobId);
  const updated = await updateJob(jobId, (j) => {
    j.factcheck = { state: "running", step: "beweringen zoeken", error: null, startedAt: new Date().toISOString(), finishedAt: null };
    addLog(j, "factcheck", "Factcheck gestart");
  });
  void runFactcheck(jobId).finally(() => running.delete(jobId));
  return updated;
}

async function setStep(jobId: string, step: string) {
  await updateJob(jobId, (j) => {
    j.factcheck = { ...j.factcheck!, step };
  });
}

async function runFactcheck(jobId: string): Promise<void> {
  const t0 = Date.now();
  try {
    const job = await loadJob(jobId);
    const dir = jobDir(jobId);
    const analysis = JSON.parse(await fs.readFile(jobFile(jobId, "analysis.json"), "utf8"));
    let segments: Segment[] = [];
    try {
      segments = JSON.parse(await fs.readFile(jobFile(jobId, "transcript.json"), "utf8")).segments ?? [];
    } catch {
      /* video without audio */
    }

    // A. extract claims
    const tA = Date.now();
    const extract = await callClaudeJson({
      system: EXTRACT_SYSTEM,
      schema: ExtractSchema,
      effort: "high",
      content: [
        {
          type: "text",
          text: [
            `Video van ${job.source.account} op ${job.source.platform}, gepost ${job.source.postDate}. Duur ${job.video?.durationSec} s.`,
            job.source.title ? `Bijschrift: "${job.source.title}"` : "",
            "",
            "Transcript:",
            segments.length ? segmentsToText(segments) : "(geen gesproken tekst)",
            "",
            "Analyse van het beeld (JSON):",
            JSON.stringify({ summary: analysis.summary, scenes: analysis.scenes, onScreenText: analysis.onScreenText, notes: analysis.notes }, null, 1),
          ].join("\n"),
        },
      ],
    });
    const claims = extract.data.claims.slice(0, 3);
    await updateJob(jobId, (j) => {
      addCost(j, { step: "factcheck", service: MODEL_LABEL, detail: "beweringen zoeken: " + usageDetail(extract.usage), usd: extract.costUsd });
      addLog(j, "factcheck", `${claims.length} bewering(en) gevonden`, Date.now() - tA);
    });

    const ctx: ClaimContext = { today: new Date().toISOString().slice(0, 10), postDate: job.source.postDate, account: job.source.account, platform: job.source.platform };
    const checks: ClaimCheck[] = [];
    for (const [i, c] of claims.entries()) {
      const label = `bewering ${i + 1} van ${claims.length}`;
      const checked = await checkOneClaim(c, ctx, (step) => setStep(jobId, `${label}: ${step}`));
      await fs.writeFile(path.join(dir, `research-c${i + 1}.md`), checked.researchNotes + "\n", "utf8");
      await updateJob(jobId, (j) => {
        addCost(j, { step: "factcheck", service: MODEL_LABEL + " + webzoeken", detail: `onderzoek ${label}: ` + usageDetail(checked.researchUsage), usd: checked.researchCostUsd });
        addCost(j, { step: "factcheck", service: MODEL_LABEL, detail: `oordeel ${label}: ` + usageDetail(checked.verdictUsage), usd: checked.verdictCostUsd });
        addLog(j, "factcheck", `${label} klaar: ${checked.result.verdict} (${checked.foundCount} bronnen gevonden)`, checked.ms);
      });
      const safe = { result: checked.result, notes: checked.safetyNotes };
      const r = { notes: checked.researchNotes };
      checks.push({
        id: `c${i + 1}`,
        t: c.t,
        tEnd: Math.max(c.tEnd, c.t),
        quote: c.quote,
        claimNl: c.claimNl,
        claimShortEn: c.claimShortEn,
        topic: c.topic,
        politicalLean: c.politicalLean,
        ...safe.result,
        safetyNotes: safe.notes,
        researchNotes: r.notes,
        approvedHash: null,
      });
    }

    const now = new Date().toISOString();
    const file: FactcheckFile = { createdAt: now, updatedAt: now, model: MODEL, claims: checks, skipped: extract.data.skipped };
    await saveFactcheck(jobId, file, job);
    await updateJob(jobId, (j) => {
      j.factcheck = { ...j.factcheck!, state: "done", step: null, error: null, finishedAt: new Date().toISOString() };
      addLog(j, "factcheck", "Factcheck klaar", Date.now() - t0);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, (j) => {
      j.factcheck = { ...j.factcheck!, state: "failed", error: message, finishedAt: new Date().toISOString() };
      addLog(j, "factcheck", "Factcheck mislukt: " + message, Date.now() - t0);
    });
  }
}

// ---------- storage ----------

export async function loadFactcheck(jobId: string): Promise<FactcheckFile | null> {
  try {
    return JSON.parse(await fs.readFile(jobFile(jobId, "factcheck.json"), "utf8")) as FactcheckFile;
  } catch {
    return null;
  }
}

export async function saveFactcheck(jobId: string, file: FactcheckFile, job?: Job): Promise<void> {
  file.updatedAt = new Date().toISOString();
  await fs.writeFile(jobFile(jobId, "factcheck.json"), JSON.stringify(file, null, 2) + "\n", "utf8");
  await fs.writeFile(jobFile(jobId, "factcheck.md"), factcheckToMarkdown(job ?? (await loadJob(jobId)), file), "utf8");
}

export function factcheckToMarkdown(job: Job, f: FactcheckFile): string {
  const out = [
    `# Factcheck: ${job.id}`,
    "",
    `- **Video:** ${job.source.url}`,
    `- **Maker:** ${job.source.account}, gepost op ${job.source.postDate}`,
    `- **Laatst bijgewerkt:** ${f.updatedAt.slice(0, 16).replace("T", " ")}`,
    "",
  ];
  for (const c of f.claims) {
    out.push(
      `## ${c.id.toUpperCase()}. ${c.claimNl}`,
      "",
      `> “${c.quote}” (${fmtTime(c.t)})`,
      "",
      `**Oordeel: ${c.verdict}** (${VERDICT_EN[c.verdict]}) · betrouwbaarheid: ${c.confidence} · ${isApproved(c) ? "✅ goedgekeurd" : "⏳ nog niet goedgekeurd"}`,
      "",
      c.explanation,
      "",
    );
    if (c.sourcesDisagree && c.disagreementNote) out.push(`**Bronnen spreken elkaar tegen:** ${c.disagreementNote}`, "");
    out.push("**Bronnen:**", "");
    for (const s of c.sources) out.push(`- [${s.title}](${s.url}), ${s.publisher}${s.date ? `, ${s.date}` : ""} (${s.type}, ${s.stance}): ${s.finding}`);
    if (c.safetyNotes.length) out.push("", "**Automatische controles:**", "", ...c.safetyNotes.map((n) => `- ${n}`));
    out.push("", `*Onderwerp: ${c.topic} · politieke lading: ${c.politicalLean} · balk in video: "${c.claimShortEn}"*`, "");
  }
  if (f.skipped.length) {
    out.push("## Overgeslagen uitspraken", "", ...f.skipped.map((s) => `- “${s.quote}”: ${s.reason}`), "");
  }
  return out.join("\n");
}

// ---------- review edits (step 4) ----------

const EditableSource = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  date: z.string(),
  type: z.enum(SOURCE_TYPES),
  stance: z.enum(SOURCE_STANCES),
  finding: z.string(),
});

export const ClaimEditSchema = z.object({
  id: z.string(),
  claimNl: z.string().min(1),
  claimShortEn: z.string().min(1),
  topic: z.string(),
  politicalLean: z.enum(LEANS),
  verdict: z.enum(VERDICTS),
  confidence: z.enum(["hoog", "middel", "laag"]),
  explanation: z.string().min(1),
  disagreementNote: z.string(),
  t: z.number().min(0),
  tEnd: z.number().min(0),
  sources: z.array(EditableSource).max(6),
  approve: z.boolean(),
});

export async function editClaim(jobId: string, raw: unknown): Promise<FactcheckFile> {
  const edit = ClaimEditSchema.parse(raw);
  const file = await loadFactcheck(jobId);
  if (!file) throw new Error("Er is nog geen factcheck.");
  const claim = file.claims.find((c) => c.id === edit.id);
  if (!claim) throw new Error("Bewering niet gevonden.");
  const { approve, id: _id, ...fields } = edit;
  Object.assign(claim, fields, { sourcesDisagree: fields.disagreementNote.trim().length > 0 || claim.sourcesDisagree });
  if (approve) {
    if (claim.sources.length < 2 && claim.verdict !== "Nog onbekend") {
      throw new Error("Goedkeuren kan pas met minstens 2 bronnen (of kies 'Nog onbekend').");
    }
    claim.approvedHash = claimHash(claim);
  } else {
    claim.approvedHash = null;
  }
  await saveFactcheck(jobId, file);
  await updateJob(jobId, (j) => addLog(j, "nakijken", `${claim.id}: ${approve ? "goedgekeurd" : "aangepast, niet goedgekeurd"} (${claim.verdict})`));
  return file;
}

export async function deleteClaim(jobId: string, claimId: string): Promise<FactcheckFile> {
  const file = await loadFactcheck(jobId);
  if (!file) throw new Error("Er is nog geen factcheck.");
  file.claims = file.claims.filter((c) => c.id !== claimId);
  await saveFactcheck(jobId, file);
  await updateJob(jobId, (j) => addLog(j, "nakijken", `${claimId} verwijderd`));
  return file;
}

/** A video may only be made when every remaining claim is approved. */
export function readyForVideo(f: FactcheckFile | null): { ok: boolean; reason: string } {
  if (!f || f.claims.length === 0) return { ok: false, reason: "Er is geen goedgekeurde bewering." };
  const open = f.claims.filter((c) => !isApproved(c));
  if (open.length) return { ok: false, reason: `Nog niet goedgekeurd: ${open.map((c) => c.id.toUpperCase()).join(", ")}.` };
  return { ok: true, reason: "" };
}
