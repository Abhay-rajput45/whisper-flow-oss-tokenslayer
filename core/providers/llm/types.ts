/** Environment bag, injected — core never reads process.env itself. */
export type EnvLike = Record<string, string | undefined>;

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Optional fields are omitted from the request body when unset, so the server's
 * own defaults apply. Nothing here is defaulted by the app.
 */
export type LlmEndpointConfig = {
  /** The complete endpoint URL, used verbatim. */
  url: string;
  model: string;
  apiKey: string;
  /** Ask the server for SSE. Response handling is header-driven regardless. */
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Vendor-specific top-level body fields, merged last so they win. */
  extraBody: Record<string, unknown>;
  timeoutMs: number;
};

/** How the response body was actually read — decided by Content-Type. */
export type LlmReadMode = "json" | "sse" | "error";

/** Why polish fell back to raw dictation. */
export type FallbackReason =
  | "not_configured"
  | "http_error"
  | "parse_error"
  | "empty_content"
  | "timeout"
  | "threw";

export type LlmResponse = {
  text: string;
  ok: boolean;
  ms: number;
  mode: LlmReadMode;
  reason?: FallbackReason;
  status?: number;
  /** Truncated, redacted body excerpt kept for diagnostics only. */
  snippet?: string;
};
