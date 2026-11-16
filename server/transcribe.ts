// Speech-to-text with ElevenLabs Scribe: word-level timestamps.
// Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert

import fs from "node:fs/promises";
import path from "node:path";

export interface SttWord {
  text: string;
  start: number; // seconds
  end: number; // seconds
  type: "word" | "spacing" | "audio_event" | string;
  speaker_id?: string;
}

export interface SttResult {
  language_code?: string;
  language_probability?: number;
  text: string;
  words: SttWord[];
}

export interface Segment {
  start: number;
  end: number;
  speaker?: string;
  text: string;
}

export const STT_MODEL = () => process.env.ELEVENLABS_STT_MODEL || "scribe_v1";
const STT_URL = () => process.env.ELEVENLABS_STT_URL || "https://api.elevenlabs.io/v1/speech-to-text";

export async function transcribeFile(audioFile: string): Promise<SttResult> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY ontbreekt in .env. Vul hem in en start de studio opnieuw.");

  const form = new FormData();
  form.append("model_id", STT_MODEL());
  form.append("timestamps_granularity", "word");
  form.append("diarize", "true"); // who speaks when
  form.append("tag_audio_events", "true"); // (laughter), (music) ...
  const bytes = await fs.readFile(audioFile);
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), path.basename(audioFile));

  let res: Response;
  try {
    res = await fetch(STT_URL(), { method: "POST", headers: { "xi-api-key": key }, body: form, signal: AbortSignal.timeout(10 * 60_000) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new Error(timedOut ? "ElevenLabs reageerde niet binnen 10 minuten. Probeer opnieuw." : "Geen verbinding met ElevenLabs. Controleer je internet en probeer opnieuw.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (/missing_permissions|missing the permission/i.test(body)) {
      throw new Error("Je ElevenLabs-sleutel mist de toestemming 'Speech to Text'. Zet die aan bij elevenlabs.io → Developers → API keys → sleutel bewerken (zie README).");
    }
    if (res.status === 401) throw new Error("ElevenLabs weigert de sleutel (401). Controleer ELEVENLABS_API_KEY in .env.");
    if (res.status === 402 || /quota|credits/i.test(body)) throw new Error("ElevenLabs: tegoed op of abonnement staat dit niet toe.");
    throw new Error(`ElevenLabs transcriptie mislukt (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as SttResult;
  if (!Array.isArray(data.words)) throw new Error("ElevenLabs gaf een onverwacht antwoord (geen woordenlijst).");
  return data;
}

/**
 * Group words into readable segments: break on sentence end, speaker change,
 * a pause longer than `maxPause` seconds, or when a segment gets too long.
 */
export function buildSegments(words: SttWord[], maxPause = 0.8, maxLen = 12): Segment[] {
  const segments: Segment[] = [];
  let cur: Segment | null = null;
  let prevEnd = 0;
  for (const w of words) {
    if (w.type === "spacing") continue;
    const text = w.type === "audio_event" ? w.text.trim() : w.text.trim();
    if (!text) continue;
    const breakHere =
      !cur ||
      (w.speaker_id && cur.speaker && w.speaker_id !== cur.speaker) ||
      w.start - prevEnd > maxPause ||
      w.end - cur.start > maxLen;
    if (breakHere) {
      if (cur) segments.push(cur);
      cur = { start: w.start, end: w.end, speaker: w.speaker_id, text };
    } else if (cur) {
      cur.text += " " + text;
      cur.end = w.end;
    }
    prevEnd = w.end;
    if (cur && /[.!?…]["')\]]?$/.test(text) && cur.end - cur.start > 1.5) {
      segments.push(cur);
      cur = null;
    }
  }
  if (cur) segments.push(cur);
  return segments.map((s) => ({ ...s, text: s.text.replace(/\s+([,.!?;:])/g, "$1") }));
}

/** 75.4 -> "01:15.4" */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function segmentsToText(segments: Segment[]): string {
  const multipleSpeakers = new Set(segments.map((s) => s.speaker).filter(Boolean)).size > 1;
  return segments
    .map((s) => `[${fmtTime(s.start)}–${fmtTime(s.end)}]${multipleSpeakers && s.speaker ? ` (${s.speaker})` : ""} ${s.text}`)
    .join("\n");
}
