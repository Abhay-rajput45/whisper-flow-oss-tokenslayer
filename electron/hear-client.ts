import { createRequire } from "node:module";
import type { ClientOptions } from "ws";

/**
 * Force the Node build of `ws`. Vite/Electron can otherwise resolve the
 * package "browser" stub, which immediately errors.
 */
const require = createRequire(import.meta.url);
type WsCtor = typeof import("ws").WebSocket;
const WS = require("ws") as WsCtor;

export type HearHandlers = {
  onPartial: (text: string, utteranceId?: string) => void;
  onFinal: (text: string, utteranceId?: string) => void;
  onError?: (code: string, message: string) => void;
  onOpen?: () => void;
  onClose?: (code: number) => void;
};

const HEAR_STREAM_URL =
  "wss://api.pyai.com/v1/audio/transcriptions/stream" +
  "?protocol=pyai-hear-v1&model=pyai-hear&language=en&sample_rate=16000&encoding=pcm16&interim_results=true&endpointing_ms=400&numerals=true";

const CONNECT_TIMEOUT_MS = 8000;
const RETRY_429_MS = 800;

function closeHint(code: number, reason: string): string {
  const extra = reason.trim() ? `: ${reason.trim().slice(0, 120)}` : "";
  switch (code) {
    case 1008:
      return `Hear auth failed (${code})${extra}. Check PYAI_API_KEY and hear:stream scope.`;
    case 4429:
      return `Hear concurrency limit (${code}). Close extra Electron windows and retry.`;
    case 1011:
      return `Hear engine error (${code})${extra}`;
    case 1006:
      return `Hear connection dropped (${code})`;
    default:
      return extra
        ? `Hear closed before open (${code})${extra}`
        : `Hear closed before open (${code})`;
  }
}

function toBuffer(buf: ArrayBuffer | ArrayBufferView): Buffer {
  if (Buffer.isBuffer(buf)) return buf;
  if (ArrayBuffer.isView(buf)) {
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return Buffer.from(buf);
}

function isRetryableBusy(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("4429") ||
    /concurrency/i.test(message)
  );
}

/**
 * PyAI Hear client (Electron main).
 * Auth: `?api_key=` on the upgrade URL (Bearer on WS upgrade can 401).
 * Never log the key or the socket URL.
 */
export class HearClient {
  private ws: InstanceType<typeof WS> | null = null;
  private committedUtterances = new Set<string>();
  private handlers: HearHandlers;
  private intentionalClose = false;

  constructor(handlers: HearHandlers) {
    this.handlers = handlers;
  }

  setHandlers(handlers: HearHandlers): void {
    this.handlers = handlers;
  }

  beginUtterance(): void {
    this.committedUtterances.clear();
  }

  get ready(): boolean {
    return this.ws?.readyState === WS.OPEN;
  }

  async connect(apiKey: string): Promise<void> {
    try {
      await this.connectOnce(apiKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isRetryableBusy(message)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_429_MS));
      await this.connectOnce(apiKey);
    }
  }

  private connectOnce(apiKey: string): Promise<void> {
    this.close();
    this.intentionalClose = false;
    this.committedUtterances.clear();

    return new Promise((resolve, reject) => {
      const key = apiKey.trim();
      if (!key) {
        reject(new Error("Missing API key"));
        return;
      }

      let settled = false;
      let ws: InstanceType<typeof WS>;
      try {
        const options: ClientOptions = {
          perMessageDeflate: false,
          handshakeTimeout: CONNECT_TIMEOUT_MS,
        };
        ws = new WS(
          `${HEAR_STREAM_URL}&api_key=${encodeURIComponent(key)}`,
          options,
        );
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error("Hear WebSocket construct failed"),
        );
        return;
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Hear connect timeout"));
          try {
            ws.close();
          } catch {
            /* noop */
          }
        }
      }, CONNECT_TIMEOUT_MS);

      ws.on("open", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.handlers.onOpen?.();
          resolve();
        }
      });

      ws.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const detail = err?.message ? err.message.slice(0, 180) : "unknown";
          reject(new Error(`Hear WebSocket error: ${detail}`));
        }
      });

      ws.on("close", (code: number, reasonBuf: Buffer) => {
        clearTimeout(timer);
        this.handlers.onClose?.(code);
        if (!settled && !this.intentionalClose) {
          settled = true;
          const reason = Buffer.isBuffer(reasonBuf)
            ? reasonBuf.toString("utf8")
            : String(reasonBuf ?? "");
          reject(new Error(closeHint(code, reason)));
        }
      });

      ws.on("message", (data: unknown) => {
        let text: string;
        if (typeof data === "string") text = data;
        else if (Buffer.isBuffer(data)) text = data.toString("utf8");
        else if (Array.isArray(data)) text = Buffer.concat(data).toString("utf8");
        else text = Buffer.from(data as ArrayBuffer).toString("utf8");
        try {
          this.handleFrame(JSON.parse(text) as Record<string, unknown>);
        } catch {
          /* ignore malformed */
        }
      });
    });
  }

  sendPcm16(buf: ArrayBuffer | ArrayBufferView): void {
    if (this.ws?.readyState !== WS.OPEN) return;
    this.ws.send(toBuffer(buf));
  }

  commit(): void {
    if (this.ws?.readyState === WS.OPEN) {
      this.ws.send(JSON.stringify({ type: "commit" }));
    }
  }

  close(): void {
    this.intentionalClose = true;
    if (this.ws) {
      try {
        this.ws.close(1000);
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private handleFrame(msg: Record<string, unknown>): void {
    const type = String(msg.type ?? "");
    const text = typeof msg.text === "string" ? msg.text : "";
    const utteranceId =
      typeof msg.utterance_id === "string" ? msg.utterance_id : undefined;

    switch (type) {
      case "config_ack":
        break;
      case "partial":
      case "partial_stable":
        this.handlers.onPartial(text, utteranceId);
        break;
      case "speech_final":
      case "final": {
        if (utteranceId && this.committedUtterances.has(utteranceId)) {
          if (type === "final") break;
        }
        if (utteranceId) this.committedUtterances.add(utteranceId);
        if (text) this.handlers.onFinal(text, utteranceId);
        break;
      }
      case "error":
        this.handlers.onError?.(
          String(msg.code ?? "error"),
          String(msg.message ?? "unknown"),
        );
        break;
      default:
        break;
    }
  }
}
