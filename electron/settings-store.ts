import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_DICTIONARY,
  dictionaryOrDefault,
  mergeDictionary,
  normalizeDictionary,
} from "./dictation-clean";

export type AppSettings = {
  apiKey: string;
  hotkey: string;
  dictionary: string[];
  polishTimeoutMs: number;
};

export const DEFAULTS: AppSettings = {
  apiKey: "",
  hotkey: "Alt+Space",
  dictionary: [...DEFAULT_DICTIONARY],
  polishTimeoutMs: 700,
};

function settingsPath(): string {
  try {
    return path.join(app.getPath("userData"), "settings.json");
  } catch {
    return path.join(
      process.env.HOME ?? ".",
      ".whisper-flow",
      "settings.json",
    );
  }
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function clampPolishTimeout(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return DEFAULTS.polishTimeoutMs;
  }
  return Math.min(2000, Math.max(100, Math.round(n)));
}

export function loadSettings(): AppSettings {
  const file = settingsPath();
  try {
    if (!fs.existsSync(file)) return { ...DEFAULTS, dictionary: [...DEFAULT_DICTIONARY] };
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppSettings>;
    return {
      ...DEFAULTS,
      ...raw,
      // Empty array (or missing) seeds the hackathon defaults
      dictionary: dictionaryOrDefault(raw.dictionary),
      polishTimeoutMs: clampPolishTimeout(raw.polishTimeoutMs),
    };
  } catch {
    return { ...DEFAULTS, dictionary: [...DEFAULT_DICTIONARY] };
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const file = settingsPath();
  ensureDir(file);
  const toWrite: AppSettings = {
    apiKey: String(next.apiKey ?? "").slice(0, 512),
    hotkey: String(next.hotkey ?? DEFAULTS.hotkey).slice(0, 64),
    dictionary: normalizeDictionary(next.dictionary),
    polishTimeoutMs: clampPolishTimeout(next.polishTimeoutMs),
  };
  fs.writeFileSync(file, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
  return toWrite;
}

/** Merge new jargon into the saved dictionary (capped). */
export function learnIntoSettings(additions: string[]): AppSettings {
  const current = loadSettings();
  const merged = mergeDictionary(current.dictionary, additions);
  const same =
    merged.length === current.dictionary.length &&
    merged.every((t, i) => t === current.dictionary[i]);
  if (same) return current;
  return saveSettings({ ...current, dictionary: merged });
}
