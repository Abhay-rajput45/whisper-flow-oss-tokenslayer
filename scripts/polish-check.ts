/**
 * Exercises the REAL electron/polish.ts against the live polish provider.
 * Run: npm run polish-check
 *
 * Imports the app's own module (not a copy) so a broken endpoint, model id, or
 * timeout clamp fails here instead of silently degrading to raw-text fallback
 * during a demo. polish.ts imports nothing from electron, so plain node works.
 */
import fs from "node:fs";
import path from "node:path";
import { polishText, polishModel, type Tone } from "../electron/polish.ts";

// Match how main.ts resolves the key: env first, then .env at the repo root.
function loadKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const envFile = path.join(process.cwd(), ".env");
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^GEMINI_API_KEY=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env */
  }
  return "";
}

const CASES: Array<{ name: string; tone: Tone; dictionary: string[]; text: string }> = [
  {
    name: "Slack → casual",
    tone: "casual",
    dictionary: [],
    text: "um hey so like can we uh push the tokenslayer demo to friday actually thursday works better i think um yeah",
  },
  {
    name: "Mail → formal",
    tone: "formal",
    dictionary: [],
    text: "um hey so like can we uh push the tokenslayer demo to friday actually thursday works better i think um yeah",
  },
  {
    name: "dictionary (Tokenslayer, Bhavesh)",
    tone: "neutral",
    dictionary: ["Tokenslayer", "Bhavesh"],
    text: "um can you ping bhavesh about the token slayer build",
  },
];

const TIMEOUT_MS = Number(process.env.POLISH_TIMEOUT_MS) || 2000;

async function main(): Promise<number> {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("No GEMINI_API_KEY in env or .env — cannot check polish.");
    return 1;
  }

  console.log(`model=${polishModel()} timeout=${TIMEOUT_MS}ms\n`);

  let polishedCount = 0;
  const timings: number[] = [];

  for (const c of CASES) {
    const res = await polishText({
      text: c.text,
      apiKey,
      tone: c.tone,
      dictionary: c.dictionary,
      timeoutMs: TIMEOUT_MS,
    });
    timings.push(res.ms);
    if (res.polished) polishedCount++;
    console.log(
      `── ${c.name} ── ${res.ms}ms · ${res.polished ? "polished" : "RAW FALLBACK"}`,
    );
    console.log(`   in : ${c.text}`);
    console.log(`   out: ${res.text}\n`);
  }

  const max = Math.max(...timings);
  console.log(
    `polish-check ${polishedCount === CASES.length ? "ok" : "DEGRADED"} — ` +
      `${polishedCount}/${CASES.length} polished, slowest ${max}ms`,
  );
  // A budget that barely clears the slowest call will fall back under load.
  if (polishedCount === CASES.length && max > TIMEOUT_MS * 0.8) {
    console.log(
      `warning: slowest call used >80% of the ${TIMEOUT_MS}ms budget — raise it.`,
    );
  }
  return polishedCount === CASES.length ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`polish-check threw: ${err?.message ?? err}`);
    process.exit(1);
  },
);
