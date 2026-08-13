import { startMic, type MicHandle } from "../audio/mic";
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

function buildPasteText(): string {
  const committed = committedText(session);
  const pending = session.pending.trim();
  if (committed && pending) return `${committed} ${pending}`.trim();
  return (committed || pending).trim();
}

/** After commit, keep mic open briefly so Hear can flush remaining finals. */
async function waitForFlush(maxMs = 1200): Promise<void> {
  const start = performance.now();
  let lastLen = buildPasteText().length;
  let stableFor = 0;
  while (performance.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 120));
    paint();
    const len = buildPasteText().length;
    if (len === lastLen && (!session.pending || session.pending.trim() === "")) {
      stableFor += 120;
      if (stableFor >= 240 && len > 0) break;
    } else {
      stableFor = 0;
      lastLen = len;
    }
  }
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
      onError: (code) => {
        els.meta.textContent = `error: ${code}`;
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
    els.meta.textContent = "finalizing…";
    paint();
    await waitForFlush(1200);
    await stopCaptureOnly();

    const raw = buildPasteText();

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

    const result = await window.whisperFlow.polishText({
      text: raw,
      tone: payload.toneHint,
      dictionary: payload.dictionary ?? [],
      timeoutMs: Math.max(payload.polishTimeoutMs ?? 400, 1200),
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
