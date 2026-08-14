/**
 * Polish dictation in the main process (no CORS).
 * Local preClean + dictionary always run; NFuse is best-effort within timeout.
 */

import {
  applyDictionary,
  applyMishears,
  cleanDictationLocal,
  normalizeDictionary,
} from "./dictation-clean";
import type { Tone } from "./tones";

export type { Tone };

const DEFAULT_POLISH_TIMEOUT_MS = 700;
const MAX_POLISH_TIMEOUT_MS = 2000;
const MIN_POLISH_TIMEOUT_MS = 100;
const MAX_INPUT_CHARS = 8000;
 *
 * Provider-agnostic: any OpenAI-compatible /chat/completions endpoint works.
 * Defaults to Gemini Flash-Lite via Google's OpenAI compat surface.
 */

/** Override to swap providers without touching code. */
const BASE_URL =
  process.env.POLISH_BASE_URL?.trim() ||
  "https://generativelanguage.googleapis.com/v1beta/openai";
const MODEL = process.env.POLISH_MODEL?.trim() || "gemini-flash-lite-latest";

export function polishModel(): string {
  return MODEL;
}

export type Tone = "casual" | "formal" | "neutral";

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  casual:
    "Tone: casual chat (Slack/IM). Keep it natural, concise, friendly. Contractions OK. No corporate fluff.",
  formal:
    "Tone: professional email/document. Clear sentences, proper grammar, no slang. Warm but polished. Complete sentences.",
  neutral:
    "Tone: clear everyday writing. Neutral register, correct punctuation, no fluff.",
};

export type PolishInput = {
  /** Polish-provider key (Gemini by default) — NOT the PyAI/Hear key. */
  text: string;
  apiKey: string;
  tone: Tone;
  dictionary: string[];
  timeoutMs: number;
  appName?: string;
};

export type PolishResult = {
  text: string;
  polished: boolean;
  /** true when only local cleanup ran (NFuse skipped/failed/timeout) */
  localOnly: boolean;
  ms: number;
  status: "shipped" | "partial" | "failed";
};

function clampTimeout(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_POLISH_TIMEOUT_MS;
  return Math.min(
    MAX_POLISH_TIMEOUT_MS,
    Math.max(MIN_POLISH_TIMEOUT_MS, Math.round(ms)),
  );
}

function scaledMaxTokens(charCount: number): number {
  return Math.min(512, Math.max(96, Math.ceil(charCount / 3) + 48));
}

function stripModelChrome(out: string): string {
  return out
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:here(?:'s| is)|cleaned|rewritten|output)\s*:\s*/i, "")
    .trim();
}

export async function polishText(input: PolishInput): Promise<PolishResult> {
  const started = Date.now();
  const dictionary = normalizeDictionary(input.dictionary);
  const raw = String(input.text ?? "").trim().slice(0, MAX_INPUT_CHARS);
  if (!raw) {
    return {
      text: "",
      polished: false,
      localOnly: true,
      ms: 0,
      status: "failed",
    };
  }

  const cleaned = cleanDictationLocal(raw, dictionary);
  const apiKey = String(input.apiKey ?? "").trim();
  if (!apiKey) return { text: raw, polished: false, ms: 0 };

  const started = Date.now();
  // Measured Gemini Flash-Lite latency for this prompt is ~780-1400ms, so the
  // spec's 400ms budget would abort every call. Ceiling raised to leave p99 room.
  const timeoutMs = Math.min(4000, Math.max(100, input.timeoutMs || 2000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const tone = (["casual", "formal", "neutral"].includes(input.tone)
    ? input.tone
    : "neutral") as Tone;

  const dictLine =
    dictionary.length > 0
      ? `Prefer these spellings/names/jargon exactly when heard: ${dictionary
          .slice(0, 50)
          .join(", ")}.`
      : "No custom dictionary.";

  const appLine = input.appName?.trim()
    ? `Target app: ${input.appName.trim().slice(0, 64)}.`
    : "";

  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content:
          "You clean up voice dictation for paste-ready text. " +
          "Remove filler (um, uh, like, you know, er, ah, hmm). " +
          "Fix punctuation, capitalization, and mid-sentence self-corrections (keep the correction, drop the false start). " +
          "Preserve meaning and the speaker's intent. Do not invent facts or expand content. " +
          "Return ONLY the rewritten text — no quotes, no preamble, no markdown.",
      },
      {
        role: "user",
        content: [TONE_INSTRUCTIONS[tone], dictLine, appLine, "", "Dictation:", cleaned]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    // No reasoning_effort / extra_body: Gemini's compat layer returns HTTP 400
    // for both, and the lite models don't over-think this prompt anyway.
  };

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    const rawBody = await res.text();
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
    } = {};
    try {
      data = rawBody ? (JSON.parse(rawBody) as typeof data) : {};
    } catch {
      return {
        text: cleaned || raw,
        polished: false,
        localOnly: true,
        ms,
        status: "partial",
      };
    }

    const out = data.choices?.[0]?.message?.content?.trim();
    const modelText = out ? stripModelChrome(out) : "";
    if (!res.ok || !modelText) {
      return {
        text: cleaned || raw,
        polished: false,
        localOnly: true,
        ms,
        status: "partial",
      };
    }

    // Don't re-strip fillers on model output (may be intentional words);
    // still force mishears + preferred dictionary spellings.
    const finalText = applyDictionary(applyMishears(modelText), dictionary);
    return {
      text: finalText,
      polished: true,
      localOnly: false,
      ms,
      status: "shipped",
    };
  } catch {
    return {
      text: cleaned || raw,
      polished: false,
      localOnly: true,
      ms: Date.now() - started,
      status: "partial",
    };
  } finally {
    clearTimeout(timer);
  }
}
