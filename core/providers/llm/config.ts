/**
 * Vendor-neutral endpoint config. Nothing is hardcoded and nothing is defaulted
 * — every request field comes from the environment, and anything left unset is
 * omitted from the request body entirely (the server's own default then wins).
 *
 *   TEXT_LLM_URL          required. The COMPLETE endpoint, used verbatim, e.g.
 *                         https://integrate.api.nvidia.com/v1/chat/completions
 *   TEXT_LLM_MODEL        required
 *   TEXT_LLM_API_KEY      falls back to the key the app already resolved
 *   TEXT_LLM_TEMPERATURE  optional number  → temperature
 *   TEXT_LLM_MAX_TOKENS   optional number  → max_tokens
 *   TEXT_LLM_STREAM       optional bool    → stream
 *   TEXT_LLM_EXTRA_BODY   optional JSON object, merged last so it wins
 */
import type { EnvLike, LlmEndpointConfig } from "./types";

function readTrimmed(env: EnvLike, key: string): string {
  return String(env[key] ?? "").trim();
}

function readNumber(env: EnvLike, key: string): number | undefined {
  const raw = readTrimmed(env, key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function readBoolean(env: EnvLike, key: string): boolean | undefined {
  const raw = readTrimmed(env, key).toLowerCase();
  if (!raw) return undefined;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return undefined;
}

function parseExtraBody(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* malformed override — treated as absent */
  }
  return null;
}

/** Used exactly as given; no path is ever appended. */
export function resolveEndpointUrl(env: EnvLike): string {
  return readTrimmed(env, "TEXT_LLM_URL").replace(/\/+$/, "");
}

/** User-supplied values (from Settings). Blank/absent falls through to env. */
export type LlmOverrides = {
  url?: string;
  model?: string;
  apiKey?: string;
};

/** Settings wins when non-blank; env is the default. */
function pick(override: string | undefined, envValue: string): string {
  return String(override ?? "").trim() || envValue;
}

export function resolveLlmEndpoint(opts: {
  /** Settings values; these WIN over env when non-blank. */
  overrides?: LlmOverrides;
  timeoutMs: number;
  env: EnvLike;
}): LlmEndpointConfig {
  const { env, overrides } = opts;
  return {
    url: pick(overrides?.url, resolveEndpointUrl(env)).replace(/\/+$/, ""),
    model: pick(overrides?.model, readTrimmed(env, "TEXT_LLM_MODEL")),
    apiKey: pick(overrides?.apiKey, readTrimmed(env, "TEXT_LLM_API_KEY")),
    temperature: readNumber(env, "TEXT_LLM_TEMPERATURE"),
    maxTokens: readNumber(env, "TEXT_LLM_MAX_TOKENS"),
    stream: readBoolean(env, "TEXT_LLM_STREAM"),
    extraBody: parseExtraBody(readTrimmed(env, "TEXT_LLM_EXTRA_BODY")) ?? {},
    timeoutMs: opts.timeoutMs,
  };
}

/** Human-readable names of what's missing; empty array = good to call. */
export function missingEndpointFields(cfg: LlmEndpointConfig): string[] {
  const missing: string[] = [];
  if (!cfg.url) missing.push("Polish API URL (or TEXT_LLM_URL)");
  if (!cfg.model) missing.push("Polish API model (or TEXT_LLM_MODEL)");
  if (!cfg.apiKey) missing.push("Polish API key (or TEXT_LLM_API_KEY)");
  return missing;
}
