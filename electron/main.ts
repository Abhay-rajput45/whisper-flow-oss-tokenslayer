import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  shell,
  systemPreferences,
  screen,
  type NativeImage,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { pasteViaAccessibility } from "./paste";
import { getFrontmostApp } from "./frontmost";
import { loadSettings, saveSettings, type AppSettings } from "./settings-store";
import { checkAccessibility } from "./permissions";
import { polishText, type PolishInput } from "./polish";
import type { Tone } from "./tones";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(process.cwd(), ".env") });

const isDev = !app.isPackaged;
let quitting = false;

let overlayWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let pttHeld = false;
let settings: AppSettings = loadSettings();
/** Frontmost app at PTT start — used to restore focus before paste */
let targetAppName = "";

function resolveApiKey(): string {
  const fromSettings = settings.apiKey?.trim() ?? "";
  if (fromSettings) return fromSettings;
  return process.env.PYAI_API_KEY?.trim() ?? "";
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
    focusable: false,
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
  return overlayWin;
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 680,
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

function hideOverlaySoon(ms = 800): void {
  setTimeout(() => {
    if (pttHeld) return;
    if (!overlayWin || overlayWin.isDestroyed()) return;
    try {
      if (overlayWin.isVisible()) overlayWin.hide();
    } catch {
      /* ignore */
    }
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
        label: "Docs (PyAI Hear)",
        click: () => {
          void shell.openExternal(
            "https://docs.pyai.com/use-cases/build-your-own-wispr-flow",
          );
        },
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

function registerHotkey(): boolean {
  globalShortcut.unregisterAll();
  const accelerator = settings.hotkey || "Alt+Space";
  const ok = globalShortcut.register(accelerator, () => {
    void togglePtt();
  });
  if (!ok) console.error("Failed to register hotkey:", accelerator);
  return ok;
}

/** Tap to start / tap to finish (Electron globalShortcut has no keyup). */
async function togglePtt(): Promise<void> {
  try {
    if (!pttHeld) {
      const key = resolveApiKey();
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
      pttHeld = true;
      const front = await getFrontmostApp();
      targetAppName = front.name;
      const win = ensureOverlay();
      showOverlay();
      if (!win.isDestroyed()) {
        win.webContents.send("ptt-start", {
          apiKey: key,
          toneHint: front.tone,
          bundleId: front.bundleId,
          appName: front.name,
          dictionary: settings.dictionary,
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
    const { apiKey, ...rest } = settings;
    return {
      ...rest,
      apiKeySet: Boolean(apiKey || process.env.PYAI_API_KEY),
      apiKeyMasked: apiKey
        ? `${apiKey.slice(0, 8)}…`
        : process.env.PYAI_API_KEY
          ? "(from env)"
          : "",
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
    if (patch.dictionary) {
      patch.dictionary = patch.dictionary
        .map((d) => String(d).trim())
        .filter(Boolean)
        .slice(0, 200)
        .map((d) => d.slice(0, 64));
    }
    if (patch.hotkey) patch.hotkey = String(patch.hotkey).slice(0, 64);
    if (patch.polishTimeoutMs !== undefined) {
      const n = Number(patch.polishTimeoutMs);
      patch.polishTimeoutMs = Number.isFinite(n)
        ? Math.min(2000, Math.max(100, Math.round(n)))
        : 400;
    }
    settings = saveSettings({ ...settings, ...patch });
    registerHotkey();
    return { ok: true };
  });

  ipcMain.handle("get-frontmost", async () => getFrontmostApp());

  ipcMain.handle("polish-text", async (_e, input: PolishInput) => {
    const key = resolveApiKey();
    return polishText({
      text: String(input?.text ?? ""),
      apiKey: key,
      tone: (input?.tone as Tone) || "neutral",
      dictionary: Array.isArray(input?.dictionary)
        ? input.dictionary.map(String).slice(0, 200)
        : [],
      timeoutMs:
        typeof input?.timeoutMs === "number" ? input.timeoutMs : 400,
    });
  });

  ipcMain.handle("paste-text", async (_e, text: string) => {
    const plain = String(text ?? "").slice(0, 50_000);
    if (!plain) return { ok: false, reason: "empty" };

    // Hide overlay first so Cmd+V lands in the user's editor
    if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) {
      overlayWin.hide();
    }

    clipboard.writeText(plain);
    const pasted = await pasteViaAccessibility({
      activateAppName: targetAppName,
      delayMs: 200,
    });
    hideOverlaySoon(400);
    return { ok: pasted, chars: plain.length };
  });

  ipcMain.handle("hide-overlay", () => {
    hideOverlaySoon(0);
  });

  ipcMain.handle("check-permissions", async () => {
    const accessibility = checkAccessibility(false);
    let microphone = "unknown";
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      microphone = status;
      if (status !== "granted") {
        await systemPreferences.askForMediaAccess("microphone");
        microphone = systemPreferences.getMediaAccessStatus("microphone");
      }
    }
    return { accessibility, microphone };
  });

  ipcMain.on("overlay-resize", (_e, height: number) => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
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
  settingsWin = createSettingsWindow();
  createTray();
  wireIpc();
  registerHotkey();

  if (!resolveApiKey()) settingsWin.show();

  console.log(
    `WhisperFlow OSS ready. Hotkey: ${settings.hotkey || "Alt+Space"} (tap to start / tap to finish)`,
  );
});

app.on("will-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Stay alive in the tray on macOS; do not quit when settings/overlay hide.
});
