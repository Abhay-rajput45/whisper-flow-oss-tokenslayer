export type HearHandlers = {
  onPartial: (text: string, utteranceId?: string) => void;
  onFinal: (text: string, utteranceId?: string) => void;
  onError?: (code: string, message: string) => void;
  onOpen?: () => void;
  onClose?: (code: number) => void;
};

const HEAR_STREAM_URL =
  "wss://api.pyai.com/v1/audio/transcriptions/stream" +
  "?protocol=pyai-hear-v1&model=pyai-hear&language=en&sample_rate=16000&encoding=pcm16&interim_results=true&endpointing_ms=800&numerals=true";

/**
 * PyAI Hear streaming client.
 * Auth via Sec-WebSocket-Protocol: pyai-key.<API_KEY> (never log the key).
 */
export class HearClient {
  private ws: WebSocket | null = null;
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
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(apiKey: string): Promise<void> {
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
      const ws = new WebSocket(HEAR_STREAM_URL, [`pyai-key.${key}`]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Hear connect timeout"));
          ws.close();
        }
      }, 8000);

      ws.onopen = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.handlers.onOpen?.();
          resolve();
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Hear WebSocket error"));
        }
      };

      ws.onclose = (ev) => {
        clearTimeout(timer);
        // 1011 after commit-flushed final is benign per PyAI docs
        this.handlers.onClose?.(ev.code);
        if (!settled && !this.intentionalClose) {
          settled = true;
          reject(new Error(`Hear closed before open (${ev.code})`));
        }
      };

      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        try {
          this.handleFrame(JSON.parse(e.data) as Record<string, unknown>);
        } catch {
          // ignore malformed
        }
      };
    });
  }

  sendPcm16(buf: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
    }
  }

  commit(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
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
      case "config_ack": {
        const warnings = Array.isArray(msg.warnings) ? msg.warnings : [];
        if (warnings.length > 0) {
          console.warn("endpointing config warning:", warnings);
        }
        break;
      }
      case "partial":
      case "partial_stable":
        this.handlers.onPartial(text, utteranceId);
        break;
      case "speech_final":
      case "final": {
        if (utteranceId && this.committedUtterances.has(utteranceId)) {
          // Already committed from speech_final; skip duplicate final
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
