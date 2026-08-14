/**
 * Local dictation cleanup — cheap, sync, never blocks paste.
 * Runs before NFuse so Hear filler/mishearings are fixed even on polish timeout.
 */

const FILLER_RE =
  /\b(?:um+|uh+|erm+|ah+|eh+|hmm+|huh+|like|you know|i mean|sort of|kind of|basically|literally)\b/gi;

const REPEAT_WORD_RE = /\b(\w{2,})\s+\1\b/gi;
const SPACE_RE = /\s+/g;
const SPACE_BEFORE_PUNCT_RE = /\s+([,.;:!?])/g;
const MULTI_PUNCT_RE = /([.!?]){2,}/g;

/** Hackathon / product defaults seeded into Settings on first run. */
export const DEFAULT_DICTIONARY: string[] = [
  "PyAI",
  "JustCall",
  "SaaS Labs",
  "Verbatim",
  "Hear",
  "NFuse",
  "Omni",
];

/**
 * Common Hear mis-hearings → preferred spelling.
 * Applied before exact dictionary replace (longer aliases first).
 */
const DEFAULT_MISHEARS: Array<{ prefer: string; aliases: string[] }> = [
  {
    prefer: "PyAI",
    aliases: ["pie ai", "py ai", "p y a i", "pai", "pyay", "pii"],
  },
  {
    prefer: "JustCall",
    aliases: ["just call", "justcall", "just cal"],
  },
  {
    prefer: "SaaS Labs",
    aliases: ["sass labs", "saas labs", "sauce labs", "saas lab"],
  },
  {
    prefer: "Verbatim",
    aliases: ["verbatim", "whisper flow", "whisperflow", "whisper flo"],
  },
  {
    prefer: "NFuse",
    aliases: ["n fuse", "enfuse", "in fuse", "n-fuse"],
  },
  {
    prefer: "Omni",
    aliases: ["omni"],
  },
];

const STOPWORDS = new Set(
  [
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "have",
    "will",
    "your",
    "about",
    "just",
    "into",
    "than",
    "then",
    "them",
    "they",
    "what",
    "when",
    "where",
    "which",
    "while",
    "would",
    "could",
    "should",
    "there",
    "their",
    "here",
    "okay",
    "please",
    "thanks",
    "hello",
    "slack",
    "email",
    "today",
    "tomorrow",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].map((w) => w.toLowerCase()),
);

const MAX_DICT_TERM_LEN = 64;
const MAX_LEARN_PER_UTTERANCE = 8;
const MAX_DICTIONARY_SIZE = 200;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip fillers / stutter doubles; keep meaning intact. */
export function preCleanDictation(text: string): string {
  let out = String(text ?? "").trim();
  if (!out) return "";

  out = out.replace(FILLER_RE, " ");
  out = out.replace(/\s+([,.;:!?])/g, "$1");
  out = out.replace(REPEAT_WORD_RE, "$1");
  out = out.replace(SPACE_RE, " ").trim();
  out = out.replace(SPACE_BEFORE_PUNCT_RE, "$1");
  out = out.replace(MULTI_PUNCT_RE, "$1");
  return out;
}

/** Replace known STT mishears with preferred product spellings. */
export function applyMishears(text: string): string {
  if (!text) return text;
  const pairs: Array<{ alias: string; prefer: string }> = [];
  for (const row of DEFAULT_MISHEARS) {
    for (const alias of row.aliases) {
      pairs.push({ alias, prefer: row.prefer });
    }
  }
  pairs.sort((a, b) => b.alias.length - a.alias.length);

  let out = text;
  for (const { alias, prefer } of pairs) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi");
    out = out.replace(re, prefer);
  }
  return out;
}

/**
 * Force preferred spellings from the user dictionary (case-insensitive whole words).
 * Longer terms win first so "SaaS Labs" beats "SaaS".
 */
export function applyDictionary(text: string, dictionary: string[]): string {
  const terms = normalizeDictionary(dictionary);
  if (!text || terms.length === 0) return text;

  const sorted = [...terms].sort((a, b) => b.length - a.length);
  let out = text;
  for (const term of sorted) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
    out = out.replace(re, term);
  }
  return out;
}

/** Full local cleanup path used before cloud polish (and as timeout fallback). */
export function cleanDictationLocal(
  text: string,
  dictionary: string[],
): string {
  const cleaned = preCleanDictation(text);
  const withMishears = applyMishears(cleaned);
  return applyDictionary(withMishears, dictionary);
}

export function normalizeDictionary(dictionary: unknown): string[] {
  if (!Array.isArray(dictionary)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of dictionary) {
    const term = String(raw ?? "")
      .trim()
      .slice(0, MAX_DICT_TERM_LEN);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_DICTIONARY_SIZE) break;
  }
  return out;
}

/**
 * Pull ProperCase / CamelCase / ALLCAPS jargon from polished text so the
 * dictionary grows with daily use (hackathon "learns your names" wedge).
 */
export function extractLearnableTerms(
  polished: string,
  existing: string[],
): string[] {
  const have = new Set(
    normalizeDictionary(existing).map((t) => t.toLowerCase()),
  );
  const candidates = polished.match(
    /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z]{2,}[a-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*|[A-Z][a-z]{3,})\b/g,
  );
  if (!candidates) return [];

  const learned: string[] = [];
  for (const raw of candidates) {
    const term = raw.trim().slice(0, MAX_DICT_TERM_LEN);
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (have.has(key) || STOPWORDS.has(key)) continue;
    if (/^(I|I'm|I've|I'd|I'll)$/i.test(term)) continue;
    have.add(key);
    learned.push(term);
    if (learned.length >= MAX_LEARN_PER_UTTERANCE) break;
  }
  return learned;
}

export function mergeDictionary(
  existing: string[],
  additions: string[],
): string[] {
  return normalizeDictionary([...existing, ...additions]);
}

/** Empty / missing dictionary → seed defaults; otherwise keep user terms. */
export function dictionaryOrDefault(dictionary: unknown): string[] {
  const normalized = normalizeDictionary(dictionary);
  if (normalized.length === 0) return [...DEFAULT_DICTIONARY];
  return normalized;
}

const DEFAULT_KEYS = new Set(
  DEFAULT_DICTIONARY.map((t) => t.toLowerCase()),
);

/** Persist/UI list — built-in defaults are excluded. */
export function userDictionaryOnly(dictionary: unknown): string[] {
  return normalizeDictionary(dictionary).filter(
    (t) => !DEFAULT_KEYS.has(t.toLowerCase()),
  );
}

/** Runtime cleanup/polish list — built-in defaults + user terms. */
export function effectiveDictionary(userDictionary: unknown): string[] {
  return mergeDictionary(DEFAULT_DICTIONARY, normalizeDictionary(userDictionary));
}

export function isDefaultDictionaryTerm(term: string): boolean {
  return DEFAULT_KEYS.has(String(term ?? "").trim().toLowerCase());
}
