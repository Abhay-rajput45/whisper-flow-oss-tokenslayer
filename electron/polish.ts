/**
 * Polish dictation in the main process (no CORS).
 */

export type Tone = "casual" | "formal" | "neutral";

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  casual:
    "Tone: casual chat (Slack/IM). Keep it natural, concise, friendly. Contractionsctions OK. No corporate fluff.",
  formal:
    "Tone: professional email/document. Clear sentences, proper grammar, no slang. Stay warm but polished.",
  neutral:
    "Tone: clear everyday writing. Neutral register, correct punctuation, no fluff.",
};

export type PolishInput = {
  text: string;
  apiKey: string;
  tone: Tone;
  dictionary: string[];
  timeoutMs: number;
};

export type PolishResult = {
  text: string;
  polished: boolean;
  ms: number;
};

export async function polishText(input: PolishInput): Promise<PolishResult> {
  const raw = String(input.text ?? "").trim().slice(0, 8000);
  if (!raw) return { text: "", polished: false, ms: 0 };

  const apiKey = String(input.apiKey ?? "").trim();
  if (!apiKey) return { text: raw, polished: false, ms: 0 };

  const started = Date.now();
  const timeoutMs = Math.min(2000, Math.max(100, input.timeoutMs || 400));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const dict =
    Array.isArray(input.dictionary) && input.dictionary.length > 0
      ? `Prefer these spellings/names when heard: ${input.dictionary
          .slice(0, 50)
          .map(String)
          .join(", ")}.`
      : "No custom dictionary.";

  const tone = (["casual", "formal", "neutral"].includes(input.tone)
    ? input.tone
    : "neutral") as Tone;

  const body = {
    model: "pyai-nfuse",
    temperature: 0.2,
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content:
          "You clean up voice dictation. Remove filler words (um, uh, like, you know, er, ah). " +
          "Fix punctuation and capitalization. Apply mid-sentence self-corrections (e.g. 'actually'). " +
          "Return ONLY the rewritten text — no quotes, no preamble, no markdown.",
      },
      {
        role: "user",
        content: `${TONE_INSTRUCTIONS[tone]}\n${dict}\n\nDictation:\n${raw}`,
      },
    ],
    pyai_nfuse: { tier: "auto" },
  };

  try {
    const res = await fetch("https://api.pyai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    const rawBody = await res.text();
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
    } = {};
    try {
      data = rawBody ? (JSON.parse(rawBody) as typeof data) : {};
    } catch {
      return { text: raw, polished: false, ms };
    }

    const out = data.choices?.[0]?.message?.content?.trim();
    const cleaned = out ? out.replace(/^["']|["']$/g, "") : "";
    if (!res.ok || !cleaned) return { text: raw, polished: false, ms };
    return { text: cleaned, polished: true, ms };
  } catch {
    return { text: raw, polished: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
