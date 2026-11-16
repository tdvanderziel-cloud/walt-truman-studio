// Step 2: analyse the video.
//   audio -> transcript (ElevenLabs) -> frames (ffmpeg) -> description (Claude)
// Every intermediate result is saved in the job folder.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callClaudeJson, loadPrices, MODEL_LABEL, usageDetail, type ContentBlock } from "./claude.ts";
import { extractAudio, extractFrames, type Frame } from "./frames.ts";
import { addCost, addLog, jobDir, loadJob, updateJob, type Job } from "./jobs.ts";
import { buildSegments, fmtTime, segmentsToText, STT_MODEL, transcribeFile, type Segment } from "./transcribe.ts";

// ---------- what we ask Claude to return ----------

export const AnalysisSchema = z.object({
  spokenLanguage: z.string().describe("Language spoken in the video, in Dutch, e.g. 'Engels'. 'geen spraak' if none."),
  summary: z.string().describe("Neutral summary in Dutch, 2-4 sentences: what happens and what is said."),
  speakers: z
    .array(z.object({ label: z.string(), description: z.string() }))
    .describe("Who speaks, described by role/appearance. Only use a name if it is said aloud or shown on screen."),
  scenes: z
    .array(z.object({ start: z.number(), end: z.number(), description: z.string() }))
    .describe("Chronological scenes with start/end in seconds and a short Dutch description."),
  onScreenText: z
    .array(
      z.object({
        t: z.number(),
        text: z.string().describe("Text exactly as shown, original language."),
        kind: z.enum(["ondertitel", "titel", "bijschrift", "grafiek/cijfers", "logo/watermerk", "overig"]),
      }),
    )
    .describe("All readable on-screen text, deduplicated (same text across frames only once, at first appearance)."),
  manipulation: z.object({
    assessment: z.enum(["geen duidelijke aanwijzingen", "enkele aanwijzingen", "sterke aanwijzingen", "niet te beoordelen"]),
    signals: z
      .array(z.object({ t: z.number(), observation: z.string(), whyItMatters: z.string() }))
      .describe("Concrete visual signs of AI generation or editing, with timestamp. Empty if none."),
    explanation: z.string().describe("Short Dutch explanation of the assessment."),
  }),
  notes: z.array(z.string()).describe("Anything relevant for a fact-checker: bad audio, missing context, cut-off frames, etc. Dutch."),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const SYSTEM = `Je bent de analist van een onafhankelijke factcheckredactie. Je bekijkt een social-media-video zodat een factchecker daarna de beweringen kan controleren. Je beoordeelt in deze stap nog niets op waarheid.

Regels:
- Schrijf in het Nederlands. Tekst in beeld neem je letterlijk over in de originele taal.
- Beschrijf wat je ziet en hoort, neutraal en feitelijk. Geen oordeel over personen.
- Identificeer mensen niet op basis van hun gezicht. Noem een naam alleen als die in beeld staat of hardop gezegd wordt, en zeg dan waar die vandaan komt.
- Tijden zijn in seconden vanaf het begin van de video. Gebruik de tijden die bij de beelden en het transcript staan.
- AI-generatie of bewerking: geef alleen een inschatting op basis van concrete, zichtbare signalen (bijv. vervormde handen of tekst, onnatuurlijke overgangen, lipsync die niet klopt, inconsistente schaduwen, abrupte knippen midden in een zin). Noem ook signalen die juist op echtheid wijzen in de uitleg. Dit is nooit een zeker oordeel; bij twijfel of te weinig beeld kies je "niet te beoordelen". Losse stilstaande beelden om de paar seconden zijn beperkt bewijs: zeg dat als het relevant is.
- Het transcript is automatisch gemaakt en kan fouten bevatten (vooral namen en getallen). Wijs op plekken waar beeld en transcript elkaar tegenspreken.`;

// ---------- pipeline ----------

const running = new Set<string>();

export function isAnalysisRunning(jobId: string): boolean {
  return running.has(jobId);
}

async function setStep(jobId: string, step: string): Promise<void> {
  await updateJob(jobId, (j) => {
    j.analysis = { ...(j.analysis ?? { state: "running", error: null, startedAt: null, finishedAt: null }), step };
  });
}

export async function startAnalysis(jobId: string): Promise<Job> {
  const job = await loadJob(jobId);
  if (job.status !== "ready") throw new Error("Eerst moeten de video en de bron (account en datum) compleet zijn.");
  if (running.has(jobId)) throw new Error("De analyse loopt al.");
  running.add(jobId);
  const updated = await updateJob(jobId, (j) => {
    j.analysis = { state: "running", step: "voorbereiden", error: null, startedAt: new Date().toISOString(), finishedAt: null };
    addLog(j, "analyse", "Analyse gestart");
  });
  void runAnalysis(jobId).finally(() => running.delete(jobId));
  return updated;
}

async function timed<T>(jobId: string, label: string, fn: () => Promise<T>): Promise<T> {
  await setStep(jobId, label);
  const t0 = Date.now();
  const result = await fn();
  await updateJob(jobId, (j) => addLog(j, "analyse", `${label}: klaar`, Date.now() - t0));
  return result;
}

async function runAnalysis(jobId: string): Promise<void> {
  const t0 = Date.now();
  try {
    const job = await loadJob(jobId);
    if (!job.video) throw new Error("Geen video gevonden.");
    const dir = jobDir(jobId);
    const video = job.video;

    // 1. Transcript
    let segments: Segment[] = [];
    let language = "";
    if (video.hasAudio) {
      const audio = await timed(jobId, "geluid uit video halen", () => extractAudio(dir, video.file));
      const stt = await timed(jobId, "transcriberen (ElevenLabs)", () => transcribeFile(audio));
      segments = buildSegments(stt.words);
      language = stt.language_code ?? "";
      await fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify({ model: STT_MODEL(), ...stt, segments }, null, 2), "utf8");
      await fs.writeFile(path.join(dir, "transcript.txt"), segmentsToText(segments) + "\n", "utf8");
      const prices = loadPrices();
      await updateJob(jobId, (j) =>
        addCost(j, {
          step: "analyse",
          service: "ElevenLabs Scribe",
          detail: `${video.durationSec} sec audio (prijs is een schatting)`,
          usd: Math.round(((video.durationSec / 3600) * prices.elevenlabsSttPerHour) * 10000) / 10000,
        }),
      );
    } else {
      await fs.writeFile(path.join(dir, "transcript.txt"), "(Deze video heeft geen geluidsspoor.)\n", "utf8");
      await updateJob(jobId, (j) => addLog(j, "analyse", "Geen geluid: transcriptie overgeslagen"));
    }

    // 2. Frames
    const frames = await timed(jobId, "beelden uit video halen", () => extractFrames(dir, video.file, video.durationSec));

    // 3. Claude
    const content = await buildClaudeContent(dir, job, frames, segments, language);
    const result = await timed(jobId, `beschrijving door ${MODEL_LABEL}`, () =>
      callClaudeJson({ system: SYSTEM, content, schema: AnalysisSchema, effort: "high" }),
    );
    await fs.writeFile(path.join(dir, "analysis.json"), JSON.stringify(result.data, null, 2), "utf8");
    await fs.writeFile(path.join(dir, "analysis.md"), analysisToMarkdown(job, result.data, segments, frames), "utf8");

    await updateJob(jobId, (j) => {
      addCost(j, { step: "analyse", service: MODEL_LABEL, detail: usageDetail(result.usage), usd: result.costUsd });
      j.analysis = { ...j.analysis!, state: "done", step: null, error: null, finishedAt: new Date().toISOString() };
      addLog(j, "analyse", "Analyse klaar", Date.now() - t0);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, (j) => {
      j.analysis = { ...j.analysis!, state: "failed", error: message, finishedAt: new Date().toISOString() };
      addLog(j, "analyse", "Analyse mislukt: " + message, Date.now() - t0);
    });
  }
}

async function buildClaudeContent(dir: string, job: Job, frames: Frame[], segments: Segment[], language: string): Promise<ContentBlock[]> {
  const content: ContentBlock[] = [];
  const s = job.source;
  content.push({
    type: "text",
    text: [
      `Video van ${s.platform}, account ${s.account}${s.accountName ? ` (${s.accountName})` : ""}, gepost op ${s.postDate}.`,
      s.title ? `Bijschrift bij de post: "${s.title}"` : "Geen bijschrift bekend.",
      `Duur: ${job.video!.durationSec} seconden.`,
      "",
      segments.length
        ? `Automatisch transcript (taalcode ${language || "onbekend"}), met tijden:\n${segmentsToText(segments)}`
        : "Er is geen gesproken tekst (geen geluid of geen spraak).",
      "",
      `Hieronder volgen ${frames.length} stilstaande beelden uit de video, elk met de tijd waarop ze genomen zijn.`,
    ].join("\n"),
  });
  for (const f of frames) {
    const data = await fs.readFile(path.join(dir, f.file));
    content.push({ type: "text", text: `Beeld op ${f.t.toFixed(1)} s (${fmtTime(f.t)})${f.reason === "scene" ? ", scènewissel" : ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } });
  }
  content.push({ type: "text", text: "Analyseer de video volgens de instructies en geef het resultaat in het gevraagde formaat." });
  return content;
}

export function analysisToMarkdown(job: Job, a: Analysis, segments: Segment[], frames: Frame[]): string {
  const s = job.source;
  const lines = [
    `# Analyse: ${job.id}`,
    "",
    `- **Bron:** ${s.url}`,
    `- **Account:** ${s.account}${s.accountName ? ` (${s.accountName})` : ""}, gepost op ${s.postDate}`,
    `- **Duur:** ${job.video?.durationSec} sec · **Taal:** ${a.spokenLanguage} · **Beelden bekeken:** ${frames.length}`,
    "",
    "## Samenvatting",
    "",
    a.summary,
    "",
    "## Sprekers",
    "",
    ...(a.speakers.length ? a.speakers.map((p) => `- **${p.label}:** ${p.description}`) : ["- (geen)"]),
    "",
    "## Scènes",
    "",
    ...a.scenes.map((sc) => `- **${fmtTime(sc.start)}–${fmtTime(sc.end)}** ${sc.description}`),
    "",
    "## Tekst in beeld",
    "",
    ...(a.onScreenText.length ? a.onScreenText.map((t) => `- **${fmtTime(t.t)}** (${t.kind}) “${t.text}”`) : ["- (geen)"]),
    "",
    "## AI-gegenereerd of bewerkt? (inschatting, geen zeker oordeel)",
    "",
    `**${a.manipulation.assessment}**. ${a.manipulation.explanation}`,
    "",
    ...a.manipulation.signals.map((x) => `- **${fmtTime(x.t)}** ${x.observation} (${x.whyItMatters})`),
    "",
    "## Opmerkingen",
    "",
    ...(a.notes.length ? a.notes.map((n) => `- ${n}`) : ["- (geen)"]),
    "",
    "## Transcript",
    "",
    segments.length ? "```\n" + segmentsToText(segments) + "\n```" : "(geen gesproken tekst)",
    "",
  ];
  return lines.join("\n");
}

/** After a crash/restart, a job can be stuck on "running": mark it failed. */
export async function resetStaleAnalyses(jobs: Job[]): Promise<void> {
  for (const j of jobs) {
    if (j.analysis?.state === "running" && !running.has(j.id)) {
      await updateJob(j.id, (x) => {
        x.analysis = { ...x.analysis!, state: "failed", error: "Onderbroken (studio werd gestopt). Start de analyse opnieuw." };
      });
    }
  }
}
