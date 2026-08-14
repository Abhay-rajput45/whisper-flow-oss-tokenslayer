/**
 * Polish dictation in the main process (no CORS).
 *
 * Local preClean + mishears + dictionary always run (never blocks paste).
 * Cloud polish is best-effort within timeout.
 *
 * This file owns the polish *pipeline*: local cleanup, prompt, post-processing
 * and fallback policy. The network call itself lives in core/providers/llm,
 * which is provider-neutral and configured entirely through TEXT_LLM_* env —
 * any OpenAI-compatible /chat/completions endpoint works.
 */

import {
  complete,
  missingEndpointFields,
  resolveLlmEndpoint,
  withTimeout,
  type LlmOverrides,
} from "../core/providers/llm";
import { getLogger } from "../core/logging/logger";
import {
  applyDictionary,
  applyMishears,
  cleanDictationLocal,
  normalizeDictionary,
} from "./dictation-clean";
import type { Tone } from "./tones";

export type { Tone };

const log = getLogger("polish");

const DEFAULT_POLISH_TIMEOUT_MS = 2000;
const MAX_POLISH_TIMEOUT_MS = 4000;
const MIN_POLISH_TIMEOUT_MS = 100;
const MAX_INPUT_CHARS = 8000;

/** Settings overrides; blank falls through to the TEXT_LLM_* env values. */
export type PolishOverrides = LlmOverrides;

/** Shown in Settings — the model that will actually be used. */
export function effectivePolishModel(overrides?: PolishOverrides): string {
  return (
    resolveLlmEndpoint({ overrides, timeoutMs: 0, env: process.env }).model ||
    "not configured"
  );
}

/** Config summary for startup diagnostics. */
export function polishStatus(overrides?: PolishOverrides): {
  model: string;
  ready: boolean;
  missing: string[];
} {
  const cfg = resolveLlmEndpoint({ overrides, timeoutMs: 0, env: process.env });
  const missing = missingEndpointFields(cfg);
  return {
    model: cfg.model || "not configured",
    ready: missing.length === 0,
    missing,
  };
}

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  casual:
    "Tone: casual chat (Slack/IM). Natural, concise, friendly. contractions OK. No corporate fluff. Light punctuation.",
  formal:
    "Tone: professional email/document. Clear sentences, proper grammar, no slang. Warm but polished. Complete sentences.",
  neutral:
    "Tone: clear everyday writing. Neutral register, correct punctuation, no fluff.",
};

export type PolishInput = {
  text: string;
  /**
   * Polish-provider overrides from Settings — NOT the PyAI/Hear key.
   * Blank/absent falls through to TEXT_LLM_* env values.
   */
  overrides?: PolishOverrides;
  tone: Tone;
  dictionary: string[];
  timeoutMs: number;
  appName?: string;
};

export type PolishResult = {
  text: string;
  polished: boolean;
  /** true when only local cleanup ran (cloud polish skipped/failed/timeout) */
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

function localOnlyResult(
  text: string,
  started: number,
  status: "partial" | "failed" = "partial",
): PolishResult {
  return {
    text,
    polished: false,
    localOnly: true,
    ms: Date.now() - started,
    status,
  };
}

export async function polishText(input: PolishInput): Promise<PolishResult> {
  const started = Date.now();
  const dictionary = normalizeDictionary(input.dictionary);
  const raw = String(input.text ?? "").trim().slice(0, MAX_INPUT_CHARS);
  if (!raw) {
    return localOnlyResult("", started, "failed");
  }

  // Always available even if the model is slow/down/missing key
  const cleaned = cleanDictationLocal(raw, dictionary);

  // Measured Gemini Flash-Lite latency ~780–1400ms; leave p99 room.
  const timeoutMs = clampTimeout(input.timeoutMs || DEFAULT_POLISH_TIMEOUT_MS);
  const cfg = resolveLlmEndpoint({
    // Settings values win; TEXT_LLM_* env is the default.
    overrides: input.overrides,
    timeoutMs,
    env: process.env,
  });

  const missing = missingEndpointFields(cfg);
  if (missing.length > 0) {
    log.warn("local cleanup only", { reason: "not_configured", missing });
    return localOnlyResult(cleaned || raw, started);
  }

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

  const messages = [
    {
      role: "system" as const,
      content:
        "You clean up voice dictation for paste-ready text. " +
        "Remove filler (um, uh, like, you know, er, ah, hmm). " +
        "Fix punctuation, capitalization, and mid-sentence self-corrections (keep the correction, drop the false start). " +
        "Preserve meaning and the speaker's intent. Do not invent facts or expand content. " +
        "Return ONLY the rewritten text — no quotes, no preamble, no markdown.",
    },
    {
      role: "user" as const,
      content: [TONE_INSTRUCTIONS[tone], dictLine, appLine, "", "Dictation:", cleaned]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  // Env config wins; these are this pipeline's request-shaping defaults.
  const requestCfg = {
    ...cfg,
    temperature: cfg.temperature ?? 0.1,
    maxTokens: cfg.maxTokens ?? scaledMaxTokens(cleaned.length),
  };

  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await complete(requestCfg, messages, signal);
    const ms = Date.now() - started;
    const modelText = res.ok ? stripModelChrome(res.text) : "";

    if (!modelText) {
      log.warn("local cleanup only", {
        reason: res.reason ?? "empty_content",
        status: res.status,
        mode: res.mode,
        duration_ms: ms,
        body: res.snippet,
      });
      return {
        text: cleaned || raw,
        polished: false,
        localOnly: true,
        ms,
        status: "partial",
      };
    }

    // Don't re-strip fillers on model output; still force mishears + dictionary.
    const finalText = applyDictionary(applyMishears(modelText), dictionary);
    log.info("polished", { chars: finalText.length, mode: res.mode, duration_ms: ms });
    return {
      text: finalText,
      polished: true,
      localOnly: false,
      ms,
      status: "shipped",
    };
  } catch (err) {
    log.warn("local cleanup only", {
      reason: signal.aborted ? "timeout" : "threw",
      timeoutMs,
      duration_ms: Date.now() - started,
      err,
    });
    return localOnlyResult(cleaned || raw, started);
  } finally {
    cancel();
  }
}
