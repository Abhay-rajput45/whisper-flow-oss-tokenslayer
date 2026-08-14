/**
 * OpenAI-compatible chat completions.
 *
 * Works against any server speaking that shape: PyAI NFuse, OpenAI, Gemini's
 * /openai route, NVIDIA NIM, Groq, Ollama/vLLM/LM Studio `/v1` routes.
 *
 * `request()` is the ONLY place that knows how the HTTP call is made. To move to
 * the official SDK, swap its body for
 *   `client.chat.completions.create(body).asResponse()`
 * — nothing else in this layer changes, because readCompletion() takes a Response.
 */
import { getLogger } from "../../../logging/logger";
import type { LlmEndpointConfig, LlmMessage, LlmResponse } from "../types";
import { postJson } from "../transport/http";
import { readCompletion } from "../transport/response";

const log = getLogger("llm.openai");

/**
 * Only what was actually configured is sent. Unset fields are omitted so the
 * server applies its own defaults; extraBody merges last and wins.
 */
export function buildBody(
  cfg: LlmEndpointConfig,
  messages: LlmMessage[],
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: cfg.model };
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
  if (cfg.maxTokens !== undefined) body.max_tokens = cfg.maxTokens;
  body.messages = messages;
  if (cfg.stream !== undefined) body.stream = cfg.stream;
  return Object.assign(body, cfg.extraBody);
}

export async function request(
  cfg: LlmEndpointConfig,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  return postJson(
    cfg.url,
    {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    signal,
  );
}

export async function complete(
  cfg: LlmEndpointConfig,
  messages: LlmMessage[],
  signal: AbortSignal,
): Promise<LlmResponse> {
  const started = Date.now();
  const body = buildBody(cfg, messages);
  const serialized = JSON.stringify(body);

  log.debug("request", {
    url: cfg.url,
    model: cfg.model,
    // effective value — extraBody can set stream too
    stream: body.stream,
    timeoutMs: cfg.timeoutMs,
    bodyBytes: serialized.length,
    extraBodyKeys: Object.keys(cfg.extraBody),
  });

  const res = await request(cfg, body, signal);
  const read = await readCompletion(res);
  const ms = Date.now() - started;

  log.info("completion", {
    status: read.status,
    mode: read.mode,
    ok: read.ok,
    reason: read.reason,
    chars: read.text.length,
    duration_ms: ms,
  });

  return {
    text: read.text,
    ok: read.ok,
    ms,
    mode: read.mode,
    reason: read.reason,
    status: read.status,
    snippet: read.snippet,
  };
}
