/**
 * Minimal SSE reader for OpenAI-compatible chat streams.
 *
 * Handles the things that actually bite in the wild:
 *  - frames split across read() boundaries
 *  - CRLF as well as LF line endings
 *  - multiple `data:` lines per frame (joined with \n, per the SSE spec)
 *  - `: keepalive` comments and `event:` / `id:` / `retry:` fields
 *  - termination on `data: [DONE]`
 */

import { getLogger } from "../../../logging/logger";

const log = getLogger("llm.sse");

type ChatChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
};

/** Pull the concatenated `data:` payload out of one SSE frame. */
function framePayload(frame: string): string | null {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue; // blank or comment/keepalive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") continue; // ignore event:, id:, retry:
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    data.push(value);
  }
  return data.length > 0 ? data.join("\n") : null;
}

/** Accumulate delta content; returns "" for a frame that carries none. */
function chunkText(payload: string): string {
  try {
    const chunk = JSON.parse(payload) as ChatChunk;
    return chunk.choices?.[0]?.delta?.content ?? "";
  } catch {
    return ""; // a frame we can't parse is not fatal to the stream
  }
}

export async function readSseText(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  let done = false;
  let frames = 0;

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      // Normalize CRLF up front so frame splitting stays a plain indexOf.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const payload = framePayload(frame);
        if (payload !== null) {
          if (payload === "[DONE]") {
            done = true;
            break;
          }
          frames++;
          out += chunkText(payload);
        }
        sep = buffer.indexOf("\n\n");
      }
    }

    // Trailing frame with no blank-line terminator.
    if (!done && buffer.trim()) {
      const payload = framePayload(buffer);
      if (payload !== null && payload !== "[DONE]") out += chunkText(payload);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }

  log.trace("stream read", { frames, sawDone: done, chars: out.length });
  return out;
}
