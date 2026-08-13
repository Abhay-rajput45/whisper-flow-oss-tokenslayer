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

/**
 * Polish dictation via PyAI OpenAI-compatible chat completions (NFuse).
 * Hard timeout → returns original text so paste never blocks.
 * Never logs apiKey or full PII payloads.
 */
export async function polishText(input: PolishInput): Promise<{
  text: string;
  polished: boolean;
  ms: number;
}> {
  const raw = input.text.trim();
  if (!raw) return { text: "", polished: false, ms: 0 };

  const started = performance.now();
  const controller = new AbortController();
  const timeoutMs = Math.min(2000, Math.max(100, input.timeoutMs || 400));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const dict =
    input.dictionary.length > 0
      ? `Prefer these spellings/names when heard: ${input.dictionary.slice(0, 50).join(", ")}.`
      : "No custom dictionary.";

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
        content: `${TONE_INSTRUCTIONS[input.tone]}\n${dict}\n\nDictation:\n${raw.slice(0, 8000)}`,
      },
    ],
    pyai_nfuse: { tier: "auto" },
  };

  try {
    const res = await fetch("https://api.pyai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { text: raw, polished: false, ms: performance.now() - started };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const out = data.choices?.[0]?.message?.content?.trim();
    if (!out) {
      return { text: raw, polished: false, ms: performance.now() - started };
    }
    return {
      text: out.replace(/^["']|["']$/g, ""),
      polished: true,
      ms: performance.now() - started,
    };
  } catch {
    return { text: raw, polished: false, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
