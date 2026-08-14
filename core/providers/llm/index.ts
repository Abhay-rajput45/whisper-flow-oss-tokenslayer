/**
 * Public entry for the text-LLM provider layer.
 *
 * This layer owns transport and configuration only — endpoint, model, key and
 * body fields from TEXT_LLM_* env, plus header-driven SSE/JSON response
 * reading. Prompt assembly, local cleanup and fallback policy belong to the
 * caller (see electron/polish.ts).
 */
export {
  missingEndpointFields,
  resolveEndpointUrl,
  resolveLlmEndpoint,
} from "./config";
export { buildBody, complete } from "./openai";
export { withTimeout } from "./transport/http";
export type {
  EnvLike,
  FallbackReason,
  LlmEndpointConfig,
  LlmMessage,
  LlmReadMode,
  LlmResponse,
} from "./types";
