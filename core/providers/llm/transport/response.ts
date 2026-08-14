/**
 * Header-driven response reading.
 *
 * We trust the response's Content-Type, not our own `stream` request flag:
 * gateways stream unprompted, and error bodies come back as JSON even on a
 * streaming request. Either mismatch silently yields no text otherwise.
 *
 * Transport-agnostic on purpose — takes any Response, so swapping fetch for an
 * SDK's `.asResponse()` needs no change here.
 */
import { getLogger } from "../../../logging/logger";
import type { FallbackReason, LlmReadMode } from "../types";
import { readSseText } from "./sse";

const log = getLogger("llm.transport");

const SNIPPET_CHARS = 300;

export type ReadResult = {
  text: string;
  ok: boolean;
  mode: LlmReadMode;
  reason?: FallbackReason;
  status?: number;
  snippet?: string;
};

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
};

function stripWrappingQuotes(text: string): string {
  return text.replace(/^["']|["']$/g, "");
}

function snippet(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat;
}

async function readJson(res: Response): Promise<ReadResult> {
  const rawBody = await res.text();
  let data: ChatCompletion = {};
  try {
    data = rawBody ? (JSON.parse(rawBody) as ChatCompletion) : {};
  } catch {
    return {
      text: "",
      ok: false,
      mode: "json",
      reason: "parse_error",
      status: res.status,
      snippet: snippet(rawBody),
    };
  }
  const out = data.choices?.[0]?.message?.content?.trim();
  const cleaned = out ? stripWrappingQuotes(out) : "";
  if (cleaned) return { text: cleaned, ok: true, mode: "json", status: res.status };
  return {
    text: "",
    ok: false,
    mode: "json",
    reason: "empty_content",
    status: res.status,
    snippet: snippet(rawBody),
  };
}

async function readSse(res: Response): Promise<ReadResult> {
  try {
    const cleaned = stripWrappingQuotes((await readSseText(res)).trim());
    if (cleaned) return { text: cleaned, ok: true, mode: "sse", status: res.status };
    return {
      text: "",
      ok: false,
      mode: "sse",
      reason: "empty_content",
      status: res.status,
    };
  } catch (err) {
    log.warn("sse read failed", { err });
    return {
      text: "",
      ok: false,
      mode: "sse",
      reason: "parse_error",
      status: res.status,
    };
  }
}

export async function readCompletion(res: Response): Promise<ReadResult> {
  const contentType = (res.headers.get("content-type") ?? "").trim();

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    const result: ReadResult = {
      text: "",
      ok: false,
      mode: "error",
      reason: "http_error",
      status: res.status,
      snippet: snippet(body),
    };
    log.warn("http error", {
      status: res.status,
      contentType,
      body: result.snippet,
    });
    return result;
  }

  const isSse = /^text\/event-stream/i.test(contentType);
  log.debug("response", { status: res.status, contentType, mode: isSse ? "sse" : "json" });

  const result = isSse ? await readSse(res) : await readJson(res);
  if (!result.ok) {
    log.warn("unusable body", {
      mode: result.mode,
      reason: result.reason,
      status: result.status,
      body: result.snippet,
    });
  }
  return result;
}
