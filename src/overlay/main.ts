import { startMic, type MicHandle } from "../audio/mic";
import { polishText } from "../polish/polish";
import {
  createSession,
  markSpeechStart,
  onPartial,
  onFinal,
  committedText,
  displayCommitted,
} from "../state/session";
import { acquireHear, parkHear } from "../hear/warm";
import type { PttStartPayload } from "../../electron/preload";

const els = {
  committed: document.getElementById("committed")!,
  pending: document.getElementById("pending")!,
  meta: document.getElementById("meta")!,
  root: document.getElementById("root")!,
};

let session = createSession();
let hear: Awaited<ReturnType<typeof acquireHear>> | null = null;
let mic: MicHandle | null = null;
let payload: PttStartPayload | null = null;
let finishing = false;

function paint(): void {
  els.committed.textContent = displayCommitted(session);
  els.pending.textContent = session.pending;
  const parts: string[] = [];
  if (session.listening) parts.push("listening");
  if (session.firstPartialMs != null) {
    parts.push(`first partial ${session.firstPartialMs} ms`);
  }
  if (payload) parts.push(`${payload.appName} · ${payload.toneHint}`);
  els.meta.textContent = parts.join(" · ");
  window.whisperFlow.resizeOverlay(els.root.scrollHeight + 24);
}

async function startSession(p: PttStartPayload): Promise<void> {
  if (finishing) return;
  await stopCaptureOnly();
  payload = p;
  session = createSession();
  markSpeechStart(session);
  paint();

  try {
    hear = await acquireHear(p.apiKey, {
      onPartial: (text) => {
        onPartial(session, text);
        paint();
      },
      onFinal: (text) => {
        onFinal(session, text);
        paint();
      },
      onError: (code, message) => {
        els.meta.textContent = `error: ${code}`;
        console.error("hear-stream error:", code, message);
      },
    });
    mic = await startMic((buf) => hear?.sendPcm16(buf));
  } catch (err) {
    els.meta.textContent =
      err instanceof Error ? err.message : "Failed to start capture";
    session.listening = false;
    paint();
  }
}

async function stopCaptureOnly(): Promise<void> {
  mic?.stop();
  mic = null;
}

async function finishSession(): Promise<void> {
  if (finishing) return;
  finishing = true;
  session.listening = false;
  paint();

  try {
    hear?.commit();
    // Brief wait for final flush after commit
    await new Promise((r) => setTimeout(r, 280));
    await stopCaptureOnly();

    let raw = committedText(session);
    if (!raw && session.pending.trim()) raw = session.pending.trim();

    if (!raw || !payload) {
      els.meta.textContent = "nothing to paste";
      paint();
      window.whisperFlow.hideOverlay();
      parkHear(hear);
      hear = null;
      return;
    }

    els.meta.textContent = "polishing…";
    paint();

    const result = await polishText({
      text: raw,
      apiKey: payload.apiKey,
      tone: payload.toneHint,
      dictionary: payload.dictionary ?? [],
      timeoutMs: payload.polishTimeoutMs ?? 400,
    });

    els.committed.textContent = result.text;
    els.pending.textContent = "";
    els.meta.textContent = result.polished
      ? `pasted · polished in ${Math.round(result.ms)} ms`
      : `pasted · raw fallback (${Math.round(result.ms)} ms)`;
    paint();

    await window.whisperFlow.pasteText(result.text);
    parkHear(hear);
    hear = null;
  } catch {
    hear?.close();
    hear = null;
  } finally {
    payload = null;
    finishing = false;
  }
}

window.whisperFlow.onPttStart((p) => {
  void startSession(p);
});
window.whisperFlow.onPttStop(() => {
  void finishSession();
});

paint();
