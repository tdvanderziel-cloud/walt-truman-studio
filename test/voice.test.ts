import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadVoice, speak, WALT_VOICE_ID, WALT_VOICE_MODEL } from "../server/voice.ts";

test("voice settings use Walt's ElevenLabs voice and eleven_v3", async () => {
  const v = await loadVoice();
  assert.equal(v.voice_id, "p1FoEc0RLwqUICxhdqKb");
  assert.equal(v.voice_id, WALT_VOICE_ID);
  assert.equal(v.settings.model_id, WALT_VOICE_MODEL);
  for (const k of ["stability", "similarity_boost", "style", "speed"] as const) assert.equal(typeof v.settings[k], "number", k);
});

test("speak() calls the ElevenLabs API with Walt's voice_id and model", async () => {
  const realFetch = globalThis.fetch;
  const oldKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test";
  let calledUrl = "";
  let body: { model_id?: string } = {};
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calledUrl = String(url);
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ audio_base64: "", alignment: { characters: ["H", "i"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] } }));
  }) as typeof fetch;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wt-voice-"));
  try {
    const s = await speak("Hi", path.join(dir, "a.mp3"));
    assert.match(calledUrl, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/p1FoEc0RLwqUICxhdqKb\/with-timestamps/);
    assert.equal(body.model_id, "eleven_v3");
    assert.equal(s.words[0].text, "Hi");
  } finally {
    globalThis.fetch = realFetch;
    if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = oldKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
