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
  const id = bundleId.toLowerCase().trim();
  const name = appName.toLowerCase().trim();
  if (
    name === "electron" ||
    id.includes("electron") ||
    name.includes("whisper-flow")
  ) {
    return "neutral";
  }
  if (
    id === "com.tinyspeck.slackmacgap" ||
    id === "com.slack.slack" ||
    /slack|discord|telegram|whatsapp|messages|imessage/.test(name)
  ) {
    return "casual";
  }
  if (
    id === "com.apple.mail" ||
    /mail|outlook|gmail|word|pages|notion|docs/.test(name)
  ) {
    if (
      (id === "com.google.chrome" || /chrome|safari/.test(name)) &&
      !/mail|gmail|docs|document/.test(name)
    ) {
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
assert.equal(toneForBundleId("com.slack.Slack", "Slack"), "casual");
assert.equal(toneForBundleId("com.apple.mail", "Mail"), "formal");
assert.equal(toneForBundleId("com.apple.Safari", "Safari"), "neutral");
assert.equal(toneForBundleId("com.google.Chrome", "Google Chrome"), "neutral");
assert.equal(toneForBundleId("com.github.Electron", "Electron"), "neutral");
assert.equal(toneForBundleId("com.microsoft.VSCode", "Code"), "neutral");

// --- dictation clean ---
function preCleanDictation(text: string): string {
  let out = String(text ?? "").trim();
  out = out.replace(
    /\b(?:um+|uh+|erm+|ah+|eh+|hmm+|huh+|like|you know|i mean|sort of|kind of|basically|literally)\b/gi,
    " ",
  );
  out = out.replace(/\s+([,.;:!?])/g, "$1");
  out = out.replace(/\b(\w{2,})\s+\1\b/gi, "$1");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function applyDictionary(text: string, dictionary: string[]): string {
  let out = text;
  const sorted = [...dictionary].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), term);
  }
  return out;
}

assert.equal(preCleanDictation("um hello uh there"), "hello there");
assert.equal(
  applyDictionary("pyai and justcall rocks", ["PyAI", "JustCall"]),
  "PyAI and JustCall rocks",
);

function applyMishears(text: string): string {
  const pairs = [
    { alias: "pie ai", prefer: "PyAI" },
    { alias: "just call", prefer: "JustCall" },
    { alias: "sass labs", prefer: "SaaS Labs" },
  ];
  let out = text;
  for (const { alias, prefer } of pairs) {
    out = out.replace(new RegExp(`\\b${alias}\\b`, "gi"), prefer);
  }
  return out;
}

assert.equal(applyMishears("ship on pie ai for just call"), "ship on PyAI for JustCall");
assert.equal(applyMishears("sass labs demo"), "SaaS Labs demo");

console.log("self-check ok");
