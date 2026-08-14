import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  screen,
  type NativeImage,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { activateApp, pasteViaAccessibility } from "./paste";
import { getFrontmostApp } from "./frontmost";
import {
  loadSettings,
  saveSettings,
  learnIntoSettings,
  type AppSettings,
  DEFAULTS,
} from "./settings-store";
import { checkAccessibility, ensurePermissions } from "./permissions";
import { polishText, polishModel, type PolishInput } from "./polish";
import {
  extractLearnableTerms,
  effectiveDictionary,
  userDictionaryOnly,
} from "./dictation-clean";
import type { Tone } from "./tones";
import {
  setHearTarget,
  startHear,
  sendHearPcm,
  commitHear,
  parkHear,
  closeHear,
} from "./hear-session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(process.cwd(), ".env") });

const isDev = !app.isPackaged;
let quitting = false;

let overlayWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let pttHeld = false;
let settings: AppSettings = { ...DEFAULTS };
/** Frontmost app at PTT start — used to restore focus before paste */
let targetAppName = "";
let lastPttAt = 0;
const PTT_DEBOUNCE_MS = 180;

function sanitizeEnvKey(raw: string | undefined): string {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/** Prefer .env for local hackathon runs; Settings fills the gap. Never log the key. */
function resolveApiKeyInfo(): { key: string; source: "env" | "settings" | "none" } {
  const fromEnv = sanitizeEnvKey(process.env.PYAI_API_KEY);
  if (fromEnv) return { key: fromEnv, source: "env" };
  const fromSettings = settings.apiKey?.trim() ?? "";
  if (fromSettings) return { key: fromSettings, source: "settings" };
  return { key: "", source: "none" };
}

/** PyAI key — streaming STT (Hear) only. */
function resolveApiKey(): string {
  const fromSettings = settings.apiKey?.trim() ?? "";
  if (fromSettings) return fromSettings;
  return process.env.PYAI_API_KEY?.trim() ?? "";
}

/** Gemini key — polish only. Kept separate so one bad key can't break both. */
function resolvePolishKey(): string {
  const fromSettings = settings.geminiApiKey?.trim() ?? "";
  if (fromSettings) return fromSettings;
  return process.env.GEMINI_API_KEY?.trim() ?? "";
}

function preloadPath(): string {
  // vite-plugin-electron emits preload.mjs next to main
  return path.join(__dirname, "preload.mjs");
}

/** App icon: project assets/ (copied next to repo root jpeg). */
function appIconPath(): string {
  const candidates = [
    path.join(process.cwd(), "assets", "whisper-flow-icon.jpeg"),
    path.join(__dirname, "..", "assets", "whisper-flow-icon.jpeg"),
    path.join(process.cwd(), "whisper-flow-icon.jpeg"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

function loadAppIcon(size?: number): NativeImage {
  const img = nativeImage.createFromPath(appIconPath());
  if (img.isEmpty()) return nativeImage.createEmpty();
  if (size && size > 0) {
    return img.resize({ width: size, height: size, quality: "best" });
  }
  return img;
}

function pageUrl(page: "overlay" | "settings"): string {
  if (isDev) {
    const base = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
    return `${base}/${page}.html`;
  }
  return path.join(__dirname, "../dist", `${page}.html`);
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 120,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    acceptFirstMouse: true,
    hasShadow: false,
    type: "panel",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Don't destroy on close (Cmd+W / accidental) — tray app needs a live overlay
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (overlayWin === win) overlayWin = null;
  });

  if (isDev) {
    void win.loadURL(pageUrl("overlay"));
  } else {
    void win.loadFile(pageUrl("overlay"));
  }

  return win;
}

function ensureOverlay(): BrowserWindow {
  if (!overlayWin || overlayWin.isDestroyed()) {
    overlayWin = createOverlayWindow();
  }
  setHearTarget(overlayWin);
  return overlayWin;
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    show: false,
    title: "WhisperFlow OSS",
    icon: loadAppIcon(256),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    void win.loadURL(pageUrl("settings"));
  } else {
    void win.loadFile(pageUrl("settings"));
  }

  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (settingsWin === win) settingsWin = null;
  });

  return win;
}

function centerOverlay(): void {
  const win = ensureOverlay();
  if (win.isDestroyed()) return;
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const [ww, wh] = win.getSize();
    win.setPosition(
      Math.round((width - ww) / 2) + display.workArea.x,
      Math.round(height * 0.72) + display.workArea.y,
    );
  } catch {
    /* window may race-destroy between checks */
  }
}

function showOverlay(): void {
  const win = ensureOverlay();
  if (win.isDestroyed()) return;
  try {
    centerOverlay();
    win.showInactive();
  } catch {
    /* ignore */
  }
}

function hideOverlayNow(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  try {
    overlayWin.hide();
  } catch {
    /* ignore */
  }
}

function hideOverlaySoon(ms = 800): void {
  setTimeout(() => {
    if (pttHeld) return;
    hideOverlayNow();
  }, ms);
}

function createTray(): void {
  // Menu bar icons are small; 22px looks crisp on Retina when Electron scales
  const img = loadAppIcon(22);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("WhisperFlow OSS");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Settings…",
        click: () => {
          settingsWin ??= createSettingsWindow();
          settingsWin.show();
          settingsWin.focus();
        },
      },
      {
        label: "Check Accessibility…",
        click: () => checkAccessibility(true),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    settingsWin ??= createSettingsWindow();
    settingsWin.show();
    settingsWin.focus();
  });
}

function looksLikeAccelerator(raw: string): boolean {
  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => /^[A-Za-z0-9]+$/.test(p) || p.length === 1);
}

function registerHotkey(): boolean {
  const accelerator = settings.hotkey?.trim() || DEFAULTS.hotkey;
  if (!looksLikeAccelerator(accelerator)) return false;
  globalShortcut.unregisterAll();
  try {
    const ok = globalShortcut.register(accelerator, () => {
      void togglePtt();
    });
    if (!ok) {
      console.error("Failed to register hotkey:", accelerator);
    }
    return ok;
  } catch {
    console.error("Invalid hotkey:", accelerator);
    return false;
  }
}

/** Tap to start / tap to finish (Electron globalShortcut has no keyup). */
async function togglePtt(): Promise<void> {
  const now = Date.now();
  if (now - lastPttAt < PTT_DEBOUNCE_MS) return;
  lastPttAt = now;

  try {
    if (!pttHeld) {
      const { key, source } = resolveApiKeyInfo();
      if (!key) {
        settingsWin ??= createSettingsWindow();
        if (!settingsWin.isDestroyed()) {
          settingsWin.show();
          settingsWin.focus();
          settingsWin.webContents.send(
            "toast",
            "Set PYAI_API_KEY in Settings first.",
          );
        }
        return;
      }
      console.log(`Hear auth source: ${source}, length ${key.length}`);
      pttHeld = true;
      const front = await getFrontmostApp();
      targetAppName = front.name;
      const win = ensureOverlay();
      setHearTarget(win);
      showOverlay();

      // Wait for overlay load so ptt-start is not dropped
      if (!win.isDestroyed() && win.webContents.isLoading()) {
        await new Promise<void>((resolve) => {
          win.webContents.once("did-finish-load", () => resolve());
          setTimeout(resolve, 1500);
        });
      }

      if (!win.isDestroyed()) {
        // Never send the API key into the renderer — Hear runs in main.
        win.webContents.send("ptt-start", {
          toneHint: front.tone,
          bundleId: front.bundleId,
          appName: front.name,
          dictionary: effectiveDictionary(settings.dictionary),
          polishTimeoutMs: settings.polishTimeoutMs,
        });
      }
    } else {
      pttHeld = false;
      const win = overlayWin;
      if (win && !win.isDestroyed()) {
        win.webContents.send("ptt-stop");
      }
    }
  } catch (err) {
    pttHeld = false;
    console.error(
      "togglePtt failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

function wireIpc(): void {
  ipcMain.handle("get-settings", () => {
    // Never return raw keys to the renderer — only "is it set" + a masked hint.
    const { apiKey, geminiApiKey, ...rest } = settings;
    const envKey = sanitizeEnvKey(process.env.PYAI_API_KEY);
    return {
      ...rest,
      apiKeySet: Boolean(apiKey || envKey),
      apiKeyMasked: apiKey
        ? `${apiKey.slice(0, 8)}…`
        : envKey
          ? "(from env)"
          : "",
      geminiKeySet: Boolean(geminiApiKey || process.env.GEMINI_API_KEY),
      geminiKeyMasked: geminiApiKey
        ? `${geminiApiKey.slice(0, 8)}…`
        : process.env.GEMINI_API_KEY
          ? "(from env)"
          : "",
      polishModel: polishModel(),
    };
  });

  ipcMain.handle("save-settings", (_e, patch: Partial<AppSettings>) => {
    if (patch.apiKey !== undefined) {
      const k = String(patch.apiKey).trim();
      if (k.length > 0 && k.length < 8) {
        throw new Error("API key looks too short");
      }
      if (k.includes("…") || k === "(from env)") {
        delete patch.apiKey;
      }
    }
    if (patch.geminiApiKey !== undefined) {
      const k = String(patch.geminiApiKey).trim();
      if (k.length > 0 && k.length < 8) {
        throw new Error("Gemini API key looks too short");
      }
      // Guard against saving the masked placeholder back over the real key.
      if (k.includes("…") || k === "(from env)") {
        delete patch.geminiApiKey;
      }
    }
    if (patch.dictionary) {
      patch.dictionary = userDictionaryOnly(patch.dictionary);
    }
    if (patch.hotkey !== undefined) {
      patch.hotkey = String(patch.hotkey).trim().slice(0, 64);
    }
    if (patch.polishTimeoutMs !== undefined) {
      const n = Number(patch.polishTimeoutMs);
      patch.polishTimeoutMs = Number.isFinite(n)
        ? Math.min(4000, Math.max(100, Math.round(n)))
        : 2000;
    }
    const prevHotkey = settings.hotkey;
    const requestedHotkey = patch.hotkey;
    settings = saveSettings({ ...settings, ...patch });
    const hotkeyRegistered = registerHotkey();
    if (
      !hotkeyRegistered &&
      requestedHotkey &&
      requestedHotkey !== prevHotkey
    ) {
      settings = saveSettings({ ...settings, hotkey: prevHotkey });
      registerHotkey();
      const invalid = !looksLikeAccelerator(String(requestedHotkey));
      return {
        ok: false,
        hotkeyRegistered: false,
        error: invalid
          ? `Invalid hotkey “${requestedHotkey}”. Use Alt+Space, Command+Shift+Space, or F6.`
          : `Could not bind “${requestedHotkey}” (in use or reserved). Kept ${prevHotkey}.`,
        hotkey: prevHotkey,
        polishTimeoutMs: settings.polishTimeoutMs,
      };
    }
    return {
      ok: true,
      hotkeyRegistered,
      hotkey: settings.hotkey,
      polishTimeoutMs: settings.polishTimeoutMs,
    };
  });

  ipcMain.handle("get-frontmost", async () => getFrontmostApp());

  ipcMain.handle("learn-dictionary", (_e, blobs: unknown) => {
    const texts = Array.isArray(blobs)
      ? blobs.map((b) => String(b ?? "")).filter(Boolean)
      : [];
    const additions: string[] = [];
    const known = effectiveDictionary(settings.dictionary);
    for (const text of texts) {
      additions.push(...extractLearnableTerms(text, known));
    }
    if (additions.length === 0) return { ok: true, added: 0 };
    settings = learnIntoSettings(additions);
    return { ok: true, added: additions.length };
  });

  ipcMain.handle("polish-text", async (_e, input: PolishInput) => {
    const key = resolvePolishKey();
    const timeoutMs =
      typeof input?.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? input.timeoutMs
        : settings.polishTimeoutMs;
    const dictionary = effectiveDictionary(
      Array.isArray(input?.dictionary) && input.dictionary.length > 0
        ? input.dictionary
        : settings.dictionary,
    );
    const result = await polishText({
      text: String(input?.text ?? ""),
      apiKey: key,
      tone: (input?.tone as Tone) || "neutral",
      dictionary,
      timeoutMs,
      appName: String(input?.appName ?? "").slice(0, 64),
    });
    // Dev only — never log polished text in a packaged build.
    if (isDev) {
      const why = !key
        ? "NO KEY (local cleanup only)"
        : result.polished
          ? "polished"
          : `fell back to local cleanup (budget ${timeoutMs}ms)`;
      console.log(`[polish] ${why} in ${result.ms}ms via ${polishModel()}`);
    }
    return result;
  });

  ipcMain.handle("hear-start", async () => {
    const key = resolveApiKey();
    if (!key) return { ok: false as const, error: "Missing PYAI_API_KEY" };
    setHearTarget(overlayWin);
    return startHear(key);
  });

  ipcMain.on("hear-pcm", (_e, buf: unknown) => {
    sendHearPcm(buf);
  });

  ipcMain.on("hear-commit", () => {
    commitHear();
  });

  ipcMain.on("hear-park", () => {
    parkHear();
  });

  ipcMain.handle("paste-text", async (_e, text: string) => {
    const plain = String(text ?? "").slice(0, 50_000);
    if (!plain) return { ok: false, reason: "empty" };

    hideOverlayNow();

    clipboard.writeText(plain);
    const pasted = await pasteViaAccessibility({
      activateAppName: targetAppName,
      delayMs: 200,
    });
    hideOverlaySoon(400);
    return { ok: pasted, chars: plain.length };
  });

  ipcMain.handle("hide-overlay", () => {
    pttHeld = false;
    hideOverlayNow();
  });

  ipcMain.handle("end-listen", async (_e, action: unknown) => {
    pttHeld = false;
    hideOverlayNow();
    if (action === "cancel") {
      await activateApp(targetAppName);
    }
    return { ok: true };
  });

  ipcMain.handle("check-permissions", async () => {
    const result = await ensurePermissions();
    // Global shortcuts often start working only after Accessibility is granted
    registerHotkey();
    return result;
  });

  ipcMain.on("overlay-resize", (_e, height: number) => {
    if (!overlayWin || overlayWin.isDestroyed() || !overlayWin.isVisible())
      return;
    try {
      const h = Math.min(280, Math.max(80, Math.round(height)));
      overlayWin.setSize(720, h);
      centerOverlay();
    } catch {
      /* ignore */
    }
  });
}

app.whenReady().then(() => {
  const icon = loadAppIcon(512);
  if (!icon.isEmpty() && process.platform === "darwin") {
    app.dock?.setIcon(icon);
  }
  // Tray-first MVP: hide dock until Settings is opened (still uses our icon)
  if (process.platform === "darwin") app.dock?.hide();

  // Load settings after app ready so userData path resolves
  settings = loadSettings();

  overlayWin = createOverlayWindow();
  setHearTarget(overlayWin);
  settingsWin = createSettingsWindow();
  createTray();
  wireIpc();
  registerHotkey();

  if (!resolveApiKey()) settingsWin.show();

  console.log(
    `WhisperFlow OSS ready. Hotkey: ${settings.hotkey || "Alt+Space"} (tap to start / tap to finish)`,
  );
  console.log(
    `  STT    : PyAI Hear ${resolveApiKey() ? "(key set)" : "(NO KEY)"}\n` +
      `  polish : ${polishModel()} ` +
      `${resolvePolishKey() ? "(key set)" : "(NO KEY — will paste raw text)"}`,
  );
});

app.on("will-quit", () => {
  quitting = true;
  closeHear();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Stay alive in the tray on macOS; do not quit when settings/overlay hide.
});
