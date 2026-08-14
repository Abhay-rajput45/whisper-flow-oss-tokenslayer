import { startMic, type MicHandle } from "../audio/mic";
import {
  createSession,
  markSpeechStart,
  onPartial,
  onFinal,
  committedText,
  displayCommitted,
} from "../state/session";
import type { PttStartPayload } from "../../electron/preload";

const FLUSH_MAX_MS = 420;
const FLUSH_POLL_MS = 60;
const FLUSH_STABLE_MS = 120;
const PCM_QUEUE_MAX = 80;
const DEFAULT_POLISH_TIMEOUT_MS = 2000;

const els = {
  committed: document.getElementById("committed")!,
  pending: document.getElementById("pending")!,
  meta: document.getElementById("meta")!,
  root: document.getElementById("root")!,
  cancelBtn: document.getElementById("cancelBtn") as HTMLButtonElement,
  saveBtn: document.getElementById("saveBtn") as HTMLButtonElement,
};

let session = createSession();
let mic: MicHandle | null = null;
let payload: PttStartPayload | null = null;
let finishing = false;
let banner = "";
let pcmQueue: ArrayBuffer[] = [];
let hearReady = false;

function setBanner(msg: string): void {
  banner = msg;
  paint();
}

function paint(): void {
  els.committed.textContent = displayCommitted(session);
  els.pending.textContent = session.pending;
  els.cancelBtn.disabled = finishing;
  els.saveBtn.disabled = finishing;
  if (banner) {
    els.meta.textContent = banner;
  } else {
    const parts: string[] = [];
    if (session.listening) parts.push("listening");
    if (session.firstPartialMs != null) {
      parts.push(`first partial ${session.firstPartialMs} ms`);
    }
    if (payload) parts.push(`${payload.appName} · ${payload.toneHint}`);
    els.meta.textContent = parts.join(" · ");
  }
  window.whisperFlow.resizeOverlay(els.root.scrollHeight + 24);
}

function buildPasteText(): string {
  const committed = committedText(session);
  const pending = session.pending.trim();
  if (committed && pending) return `${committed} ${pending}`.trim();
  return (committed || pending).trim();
}

function flushPcmQueue(): void {
  if (!hearReady) return;
  for (const frame of pcmQueue) {
    window.whisperFlow.hearSendPcm(frame);
  }
  pcmQueue = [];
}

function enqueuePcm(buf: ArrayBuffer): void {
  if (hearReady) {
    window.whisperFlow.hearSendPcm(buf);
    return;
  }
  if (pcmQueue.length >= PCM_QUEUE_MAX) pcmQueue.shift();
  pcmQueue.push(buf);
}

/** After commit, keep listening briefly so Hear can flush remaining finals. */
async function waitForFlush(maxMs = FLUSH_MAX_MS): Promise<void> {
  const start = performance.now();
  let lastLen = buildPasteText().length;
  let stableFor = 0;
  while (performance.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, FLUSH_POLL_MS));
    paint();
    const len = buildPasteText().length;
    if (len === lastLen && (!session.pending || session.pending.trim() === "")) {
      stableFor += FLUSH_POLL_MS;
      if (stableFor >= FLUSH_STABLE_MS && len > 0) break;
    } else {
      stableFor = 0;
      lastLen = len;
    }
  }
}

async function startSession(p: PttStartPayload): Promise<void> {
  finishing = false;
  await stopCaptureOnly();
  payload = p;
  session = createSession();
  markSpeechStart(session);
  banner = "";
  hearReady = false;
  pcmQueue = [];
  paint();

  try {
    const [hear] = await Promise.all([
      window.whisperFlow.hearStart(),
      startMic(enqueuePcm).then((handle) => {
        mic = handle;
      }),
    ]);

    if (!hear.ok) {
      setBanner(`error: ${hear.error}`);
      session.listening = false;
      await stopCaptureOnly();
      return;
    }

    hearReady = true;
    flushPcmQueue();
    paint();
  } catch (err) {
    setBanner(err instanceof Error ? err.message : "Failed to start capture");
    session.listening = false;
    paint();
  }
}

async function stopCaptureOnly(): Promise<void> {
  mic?.stop();
  mic = null;
  pcmQueue = [];
}

async function cancelSession(): Promise<void> {
  if (finishing) return;
  finishing = true;
  session = createSession();
  payload = null;
  els.committed.textContent = "";
  els.pending.textContent = "";
  els.meta.textContent = "";
  try {
    await window.whisperFlow.endListen("cancel");
    await stopCaptureOnly();
    window.whisperFlow.hearPark();
    hearReady = false;
  } finally {
    finishing = false;
  }
}

async function finishSession(): Promise<void> {
  if (finishing) return;
  finishing = true;
  session.listening = false;
  await window.whisperFlow.endListen("commit");

  try {
    window.whisperFlow.hearCommit();
    await waitForFlush(FLUSH_MAX_MS);
    await stopCaptureOnly();

    const raw = buildPasteText();
    if (!raw || !payload) {
      setBanner("nothing to paste");
      window.whisperFlow.hideOverlay();
      window.whisperFlow.hearPark();
      hearReady = false;
      return;
    }

    setBanner("polishing…");
    const timeoutMs = Math.min(
      4000,
      Math.max(100, payload.polishTimeoutMs ?? DEFAULT_POLISH_TIMEOUT_MS),
    );

    const result = await window.whisperFlow.polishText({
      text: raw,
      tone: payload.toneHint,
      dictionary: payload.dictionary ?? [],
      timeoutMs,
      appName: payload.appName,
    });

    els.committed.textContent = result.text;
    els.pending.textContent = "";
    const tag = result.polished
      ? `pasted · polished ${Math.round(result.ms)} ms`
      : result.localOnly
        ? `pasted · local cleanup (${Math.round(result.ms)} ms)`
        : `pasted · fallback (${Math.round(result.ms)} ms)`;
    setBanner(tag);

    await window.whisperFlow.pasteText(result.text);

    // Grow jargon dictionary from ProperCase / brands in the polished paste
    if (result.text) {
      void window.whisperFlow.learnDictionary([result.text]);
    }

    window.whisperFlow.hearPark();
    hearReady = false;
  } catch {
    window.whisperFlow.hearPark();
    hearReady = false;
  } finally {
    payload = null;
    finishing = false;
  }
}

window.whisperFlow.onHearPartial((text) => {
  onPartial(session, text);
  if (!banner.startsWith("error")) banner = "";
  paint();
});

window.whisperFlow.onHearFinal((text) => {
  onFinal(session, text);
  if (!banner.startsWith("error")) banner = "";
  paint();
});

window.whisperFlow.onHearError((code, message) => {
  setBanner(`error: ${code}${message ? ` · ${message.slice(0, 80)}` : ""}`);
});

window.whisperFlow.onPttStart((p) => {
  void startSession(p);
});
window.whisperFlow.onPttStop(() => {
  void finishSession();
});

els.cancelBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  void cancelSession();
});
els.saveBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  void finishSession();
});

paint();
