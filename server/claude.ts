// Shared helper for calling Claude with a JSON schema (structured output)
// and turning token usage into a cost entry.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { ROOT_DIR } from "./jobs.ts";

export const MODEL = "claude-opus-5-5";
export const MODEL_LABEL = "Claude Opus 5.5";

interface Prices {
  claude: Record<string, { inputPerMTok: number; outputPerMTok: number; cacheWritePerMTok: number; cacheReadPerMTok: number }>;
  webSearchPer1000: number;
  elevenlabsSttPerHour: number;
  usdToEur: number;
}

export function loadPrices(): Prices {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "config", "prices.json"), "utf8")) as Prices;
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function claudeCostUsd(usage: UsageLike, model = MODEL, prices = loadPrices()): number {
  const p = prices.claude[model];
  if (!p) return 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const usd =
    (usage.input_tokens * p.inputPerMTok +
      usage.output_tokens * p.outputPerMTok +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWritePerMTok +
      (usage.cache_read_input_tokens ?? 0) * p.cacheReadPerMTok) /
      1_000_000 +
    (searches * prices.webSearchPer1000) / 1000;
  return Math.round(usd * 10000) / 10000;
}

export function usageDetail(usage: UsageLike): string {
  const nl = (n: number) => n.toLocaleString("nl-NL");
  const cached = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return [
    `${nl(usage.input_tokens + cached)} tokens in`,
    `${nl(usage.output_tokens)} tokens uit`,
    ...(searches ? [`${searches} zoekopdrachten`] : []),
  ].join(" / ");
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY ontbreekt in .env. Vul hem in en start de studio opnieuw.");
  }
  client ??= new Anthropic({ timeout: 15 * 60_000, maxRetries: 3 });
  return client;
}

export type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;

export interface JsonCallResult<T> {
  data: T;
  usage: UsageLike;
  costUsd: number;
}

/** One Claude call that must return JSON matching `schema`. */
export async function callClaudeJson<S extends z.ZodType>(opts: {
  system: string;
  content: ContentBlock[];
  schema: S;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}): Promise<JsonCallResult<z.infer<S>>> {
  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      // If Claude declines on safety grounds, the API retries on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(opts.schema) },
    });
  } catch (err) {
    throw friendlyApiError(err);
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claude weigerde deze video te analyseren (veiligheidsfilter). Bekijk de video zelf en beslis of je verder wilt.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Het antwoord van Claude werd afgekapt (te lang). Probeer opnieuw; meld het als het blijft gebeuren.");
  }
  if (response.parsed_output == null) throw new Error("Claude gaf geen geldig JSON-antwoord terug.");
  const usage = response.usage as UsageLike;
  return { data: response.parsed_output as z.infer<S>, usage, costUsd: claudeCostUsd(usage) };
}

export function friendlyApiError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Anthropic weigert de sleutel (401). Controleer ANTHROPIC_API_KEY in .env.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("Anthropic: geen toegang (403). Controleer je account en sleutel.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Anthropic: te veel verzoeken of tegoed op (429). Wacht even of controleer je tegoed.");
  if (err instanceof Anthropic.BadRequestError) return new Error("Anthropic weigerde het verzoek (400): " + err.message.slice(0, 300));
  if (err instanceof Anthropic.APIConnectionError) return new Error("Geen verbinding met Anthropic. Controleer je internet.");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic-fout (${err.status ?? "?"}): ${err.message.slice(0, 300)}`);
  return err instanceof Error ? err : new Error(String(err));
}
