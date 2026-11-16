// Walt's voice: ElevenLabs text-to-speech with character timestamps,
// turned into word timings for the word-by-word captions.

import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "./jobs.ts";

export interface VoiceSettings {
  voice_id: string;
  settings: {
    model_id: string;
    stability: number;
    similarity_boost: number;
    style: number;
    speed: number;
    use_speaker_boost: boolean;
    output_format: string;
  };
}

export interface Word {
  text: string;
  start: number; // seconds, relative to the start of this audio clip
  end: number;
}

export interface Speech {
  file: string; // absolute path to the mp3
  durationSec: number;
  words: Word[];
  characters: number; // billed characters
}

const readJson = async <T>(rel: string) => JSON.parse(await fs.readFile(path.join(ROOT_DIR, rel), "utf8")) as T;
export const loadVoice = () => readJson<VoiceSettings>("brand/voice-settings.json");
export const loadPronunciation = async () => (await readJson<{ replacements: Record<string, string> }>("brand/pronunciation.json")).replacements;

/** Apply the pronunciation list to the text the voice reads. */
export function toSpoken(text: string, replacements: Record<string, string>): string {
  let out = text;
  for (const [written, spoken] of Object.entries(replacements)) {
    if (written === spoken) continue;
    const re = new RegExp(`(?<![\\w.])${written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g");
    out = out.replace(re, spoken);
  }
  return out;
}

/** Character alignment -> words (split on whitespace). */
export function alignmentToWords(chars: string[], starts: number[], ends: number[]): Word[] {
  const words: Word[] = [];
  let cur: Word | null = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: ch, start: starts[i], end: ends[i] };
    else {
      cur.text += ch;
      cur.end = ends[i];
    }
  }
  if (cur) words.push(cur);
  return words;
}

/** Put the written form back in the captions ("E.S.A." -> "ESA"). */
export function restoreWritten(words: Word[], replacements: Record<string, string>): Word[] {
  let out = [...words];
  for (const [written, spoken] of Object.entries(replacements)) {
    if (written === spoken) continue;
    const parts = spoken.split(/\s+/);
    const next: Word[] = [];
    for (let i = 0; i < out.length; i++) {
      const run = out.slice(i, i + parts.length);
      const bare = (w: string) => w.replace(/[,!?;:"“”]+$/g, "");
      if (run.length === parts.length && run.every((w, k) => bare(w.text).toLowerCase() === parts[k].toLowerCase() || (k === parts.length - 1 && bare(w.text).toLowerCase().startsWith(parts[k].toLowerCase())))) {
        const trailing = run[run.length - 1].text.slice(bare(run[run.length - 1].text).length);
        next.push({ text: written + trailing, start: run[0].start, end: run[run.length - 1].end });
        i += parts.length - 1;
      } else next.push(out[i]);
    }
    out = next;
  }
  return out;
}

export async function speak(text: string, outFile: string): Promise<Speech> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY ontbreekt in .env.");
  const voice = await loadVoice();
  const repl = await loadPronunciation();
  const spoken = toSpoken(text, repl);
  const s = voice.settings;
  const url = `${process.env.ELEVENLABS_TTS_BASE || "https://api.elevenlabs.io/v1/text-to-speech"}/${voice.voice_id}/with-timestamps?output_format=${s.output_format}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spoken,
        model_id: s.model_id,
        voice_settings: { stability: s.stability, similarity_boost: s.similarity_boost, style: s.style, speed: s.speed, use_speaker_boost: s.use_speaker_boost },
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch {
    throw new Error("Geen verbinding met ElevenLabs. Controleer je internet en probeer opnieuw.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (/missing_permissions|missing the permission/i.test(body)) throw new Error("Je ElevenLabs-sleutel mist de toestemming 'Text to Speech' (zie README).");
    if (/quota|credits/i.test(body)) throw new Error("ElevenLabs: tegoed op.");
    throw new Error(`ElevenLabs stem mislukt (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    audio_base64: string;
    alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, Buffer.from(data.audio_base64, "base64"));
  const a = data.alignment;
  const words = a ? restoreWritten(alignmentToWords(a.characters, a.character_start_times_seconds, a.character_end_times_seconds), repl) : [];
  const durationSec = a?.character_end_times_seconds.at(-1) ?? 0;
  return { file: outFile, durationSec, words, characters: spoken.length };
}
