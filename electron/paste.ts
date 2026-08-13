import { checkAccessibility, runOsascript } from "./permissions.js";

/**
 * Paste clipboard into the focused app via Cmd+V.
 * Requires Accessibility permission for Electron/Terminal host.
 */
export async function pasteViaAccessibility(): Promise<boolean> {
  if (process.platform !== "darwin") {
    console.warn("Paste is only implemented for macOS in this MVP");
    return false;
  }
  if (!checkAccessibility(true)) {
    console.warn("Accessibility not granted — cannot synthesize Cmd+V");
    return false;
  }
  try {
    // Small delay so the previous frontmost app regains focus after our overlay
    await new Promise((r) => setTimeout(r, 60));
    await runOsascript(
      'tell application "System Events" to keystroke "v" using command down',
    );
    return true;
  } catch (err) {
    console.error("paste failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
