import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type AppSettings = {
  /** PyAI key — streaming STT (Hear) only. */
  apiKey: string;
  /** Gemini key — polish only. Separate so one bad key can't break both legs. */
  geminiApiKey: string;
  hotkey: string;
  dictionary: string[];
  polishTimeoutMs: number;
};

const DEFAULTS: AppSettings = {
  apiKey: "",
  geminiApiKey: "",
  hotkey: "Alt+Space",
  dictionary: [],
  polishTimeoutMs: 2000,
};

function settingsPath(): string {
  // Prefer Electron userData; fall back for early import
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

export function loadSettings(): AppSettings {
  const file = settingsPath();
  try {
    if (!fs.existsSync(file)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppSettings>;
    return {
      ...DEFAULTS,
      ...raw,
      dictionary: Array.isArray(raw.dictionary)
        ? raw.dictionary.map(String).slice(0, 200)
        : [],
      polishTimeoutMs:
        typeof raw.polishTimeoutMs === "number"
          ? raw.polishTimeoutMs
          : DEFAULTS.polishTimeoutMs,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const file = settingsPath();
  ensureDir(file);
  const toWrite: AppSettings = {
    apiKey: String(next.apiKey ?? "").slice(0, 256),
    geminiApiKey: String(next.geminiApiKey ?? "").slice(0, 256),
    hotkey: String(next.hotkey ?? DEFAULTS.hotkey).slice(0, 64),
    dictionary: (next.dictionary ?? []).map(String).slice(0, 200),
    polishTimeoutMs: next.polishTimeoutMs ?? DEFAULTS.polishTimeoutMs,
  };
  fs.writeFileSync(file, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
  return toWrite;
}
