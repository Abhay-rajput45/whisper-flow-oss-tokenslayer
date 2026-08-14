import { checkAccessibility, runOsascript } from "./permissions";

/**
 * Paste clipboard into the focused app via Cmd+V.
 * Requires Accessibility permission for Electron/Terminal host.
 */
export async function activateApp(appName?: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const name = appName?.trim();
  if (!name || name === "Unknown") return;
  const safe = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  try {
    await runOsascript(`tell application "${safe}" to activate`);
  } catch {
    /* best-effort */
  }
}

export async function pasteViaAccessibility(opts?: {
  /** Bundle id or app name to activate before paste */
  activateAppName?: string;
  delayMs?: number;
}): Promise<boolean> {
  if (process.platform !== "darwin") {
    console.warn("Paste is only implemented for macOS in this MVP");
    return false;
  }
  if (!checkAccessibility(true)) {
    console.warn("Accessibility not granted — cannot synthesize Cmd+V");
    return false;
  }
  try {
    await activateApp(opts?.activateAppName);
    // Give the target app time to take focus (DevTools/overlay can steal it)
    await new Promise((r) => setTimeout(r, opts?.delayMs ?? 180));
    await runOsascript(
      'tell application "System Events" to keystroke "v" using command down',
    );
    return true;
  } catch (err) {
    console.error("paste failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
