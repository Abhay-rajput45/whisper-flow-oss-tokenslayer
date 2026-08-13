/**
 * ponytail: assert-based self-check for session + tone map (no test framework).
 * Run: node --experimental-strip-types scripts/self-check.ts
 * Or after build via npm run self-check
 */
import assert from "node:assert/strict";

// --- session logic (inlined mirror of src/state/session.ts for node) ---
type SessionState = {
  finals: string[];
  pending: string;
  speechStartedAt: number | null;
  firstPartialMs: number | null;
  listening: boolean;
};

function createSession(): SessionState {
  return {
    finals: [],
    pending: "",
    speechStartedAt: null,
    firstPartialMs: null,
    listening: false,
  };
}

function onPartial(s: SessionState, text: string): void {
  if (s.speechStartedAt != null && s.firstPartialMs == null && text.trim()) {
    s.firstPartialMs = 1;
  }
  s.pending = text;
}

function onFinal(s: SessionState, text: string): void {
  const t = text.trim();
  if (t) s.finals.push(t);
  s.pending = "";
}

// --- tone map (mirror of electron/tones.ts) ---
type Tone = "casual" | "formal" | "neutral";

function toneForBundleId(bundleId: string, appName = ""): Tone {
  const id = bundleId.toLowerCase();
  const name = appName.toLowerCase();
  if (
    bundleId === "com.tinyspeck.slackmacgap" ||
    /slack|discord|telegram|whatsapp|messages|imessage/.test(name)
  ) {
    return "casual";
  }
  if (
    bundleId === "com.apple.mail" ||
    /mail|outlook|gmail|word|pages|notion|docs/.test(name)
  ) {
    if (id === "com.google.chrome" && !/mail|gmail|docs|document/.test(name)) {
      return "neutral";
    }
    return "formal";
  }
  return "neutral";
}

const s = createSession();
s.speechStartedAt = Date.now();
onPartial(s, "hello");
onPartial(s, "hello there"); // replace, not append
assert.equal(s.pending, "hello there");
onFinal(s, "hello there");
assert.equal(s.pending, "");
assert.deepEqual(s.finals, ["hello there"]);
onPartial(s, "um next");
onFinal(s, "next phrase");
assert.equal(s.finals.join(" "), "hello there next phrase");

assert.equal(toneForBundleId("com.tinyspeck.slackmacgap", "Slack"), "casual");
assert.equal(toneForBundleId("com.apple.mail", "Mail"), "formal");
assert.equal(toneForBundleId("com.apple.Safari", "Safari"), "neutral");

console.log("self-check ok");
