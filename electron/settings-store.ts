import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  isDefaultDictionaryTerm,
  mergeDictionary,
  normalizeDictionary,
  userDictionaryOnly,
} from "./dictation-clean";

export type AppSettings = {
  /** PyAI key — streaming STT (Hear) only. */
  apiKey: string;
  /** Gemini key — polish only. Separate so one bad key can't break both legs. */
  geminiApiKey: string;
  hotkey: string;
  /** User-added terms only (built-in defaults live in code, not here). */
  dictionary: string[];
  polishTimeoutMs: number;
};

export const DEFAULTS: AppSettings = {
  apiKey: "",
  geminiApiKey: "",
  hotkey: "Alt+Space",
  dictionary: [],
  polishTimeoutMs: 2000,
};

function settingsPath(): string {
  try {
    return path.join(app.getPath("userData"), "settings.json");
  } catch {
    return path.join(process.env.HOME ?? ".", ".verbatim", "settings.json");
  }
}

function migrateSettingsIfNeeded(dest: string): void {
  if (fs.existsSync(dest)) return;
  const home = process.env.HOME ?? ".";
  const candidates: string[] = [];
  try {
    candidates.push(
      path.join(app.getPath("appData"), "whisper-flow-oss", "settings.json"),
    );
  } catch {
    /* app not ready */
  }
  candidates.push(path.join(home, ".whisper-flow", "settings.json"));
  for (const src of candidates) {
    try {
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o600);
      return;
    } catch {
      /* try next */
    }
  }
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function clampPolishTimeout(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return DEFAULTS.polishTimeoutMs;
  }
  return Math.min(4000, Math.max(100, Math.round(n)));
}

export function loadSettings(): AppSettings {
  const file = settingsPath();
  migrateSettingsIfNeeded(file);
  try {
    if (!fs.existsSync(file)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppSettings>;
    return {
      ...DEFAULTS,
      ...raw,
      // Strip built-in defaults if an older build saved them into settings.json
      dictionary: userDictionaryOnly(raw.dictionary),
      polishTimeoutMs: clampPolishTimeout(raw.polishTimeoutMs),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const file = settingsPath();
  ensureDir(file);
  const toWrite: AppSettings = {
    apiKey: String(next.apiKey ?? "").slice(0, 512),
    geminiApiKey: String(next.geminiApiKey ?? "").slice(0, 512),
    hotkey: String(next.hotkey ?? DEFAULTS.hotkey).slice(0, 64),
    dictionary: userDictionaryOnly(next.dictionary),
    polishTimeoutMs: clampPolishTimeout(next.polishTimeoutMs),
  };
  fs.writeFileSync(file, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
  return toWrite;
}

/** Merge new jargon into the saved dictionary (capped). Skips built-in defaults. */
export function learnIntoSettings(additions: string[]): AppSettings {
  const current = loadSettings();
  const custom = additions.filter((t) => !isDefaultDictionaryTerm(t));
  if (custom.length === 0) return current;
  const merged = mergeDictionary(current.dictionary, custom);
  const same =
    merged.length === current.dictionary.length &&
    merged.every((t, i) => t === current.dictionary[i]);
  if (same) return current;
  return saveSettings({ ...current, dictionary: merged });
}
