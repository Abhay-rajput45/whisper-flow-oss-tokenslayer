import type { BrowserWindow } from "electron";
import { HearClient } from "./hear-client";

const MAX_PCM_BYTES = 64 * 1024;
/** Reuse Hear between utterances to skip handshake (~300–400 ms). */
const PARK_MS = 25_000;

let target: BrowserWindow | null = null;
let client: HearClient | null = null;
let parkTimer: ReturnType<typeof setTimeout> | null = null;
let activeKey: string | null = null;

function emit(channel: string, ...args: unknown[]): void {
  if (!target || target.isDestroyed()) return;
  try {
    target.webContents.send(channel, ...args);
  } catch {
    /* overlay gone */
  }
}

export function setHearTarget(win: BrowserWindow | null): void {
  target = win;
}

function toPcm(buf: unknown): ArrayBuffer | ArrayBufferView | null {
  if (buf instanceof ArrayBuffer) return buf;
  if (ArrayBuffer.isView(buf)) return buf;
  return null;
}

export async function startHear(
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Missing PYAI_API_KEY" };

  if (parkTimer) {
    clearTimeout(parkTimer);
    parkTimer = null;
  }

  if (client?.ready && activeKey === key) {
    client.beginUtterance();
    return { ok: true };
  }

  client?.close();
  client = null;
  activeKey = null;
  await new Promise((r) => setTimeout(r, 80));

  const next = new HearClient({
    onPartial: (text) => emit("hear-partial", text),
    onFinal: (text) => emit("hear-final", text),
    onError: (code, message) => emit("hear-error", code, message),
  });

  try {
    await next.connect(key);
    client = next;
    activeKey = key;
    console.log("Hear connected");
    return { ok: true };
  } catch (err) {
    next.close();
    const error = err instanceof Error ? err.message : "Hear connect failed";
    console.error("Hear connect failed:", error);
    return { ok: false, error };
  }
}

export function sendHearPcm(buf: unknown): void {
  if (!client?.ready) return;
  const pcm = toPcm(buf);
  if (!pcm) return;
  if (pcm.byteLength === 0 || pcm.byteLength > MAX_PCM_BYTES) return;
  client.sendPcm16(pcm);
}

export function commitHear(): void {
  client?.commit();
}

export function parkHear(): void {
  if (!client?.ready) {
    client?.close();
    client = null;
    activeKey = null;
    return;
  }
  if (parkTimer) clearTimeout(parkTimer);
  const parked = client;
  parkTimer = setTimeout(() => {
    if (client === parked) {
      parked.close();
      client = null;
      activeKey = null;
    }
    parkTimer = null;
  }, PARK_MS);
}

export function closeHear(): void {
  if (parkTimer) {
    clearTimeout(parkTimer);
    parkTimer = null;
  }
  client?.close();
  client = null;
  activeKey = null;
}
