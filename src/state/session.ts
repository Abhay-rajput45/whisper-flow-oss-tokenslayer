export type SessionState = {
  finals: string[];
  pending: string;
  speechStartedAt: number | null;
  firstPartialMs: number | null;
  listening: boolean;
};

export function createSession(): SessionState {
  return {
    finals: [],
    pending: "",
    speechStartedAt: null,
    firstPartialMs: null,
    listening: false,
  };
}

export function markSpeechStart(s: SessionState): void {
  s.speechStartedAt = performance.now();
  s.firstPartialMs = null;
  s.finals = [];
  s.pending = "";
  s.listening = true;
}

export function onPartial(s: SessionState, text: string): void {
  if (s.speechStartedAt != null && s.firstPartialMs == null && text.trim()) {
    s.firstPartialMs = Math.round(performance.now() - s.speechStartedAt);
  }
  s.pending = text; // replace, never append
}

export function onFinal(s: SessionState, text: string): void {
  const t = text.trim();
  if (t) s.finals.push(t);
  s.pending = "";
}

export function committedText(s: SessionState): string {
  return s.finals.join(" ").trim();
}

export function displayCommitted(s: SessionState): string {
  return s.finals.join(" ");
}
