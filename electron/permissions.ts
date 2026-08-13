import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { systemPreferences, shell } from "electron";

const execFileAsync = promisify(execFile);

/** Returns true if Accessibility is trusted (needed for Cmd+V paste). */
export function checkAccessibility(prompt: boolean): boolean {
  if (process.platform !== "darwin") return true;
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(prompt);
    if (!trusted && prompt) {
      void shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      );
    }
    return trusted;
  } catch {
    return false;
  }
}

export async function requestMicIfNeeded(): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
}

export async function runOsascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 3000,
    maxBuffer: 1024 * 64,
  });
  return stdout.trim();
}
