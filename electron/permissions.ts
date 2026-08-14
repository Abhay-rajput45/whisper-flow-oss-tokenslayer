import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { systemPreferences, shell } from "electron";

const execFileAsync = promisify(execFile);

export type PrivacyPane = "accessibility" | "microphone";

const PANE_ANCHORS: Record<PrivacyPane, string[]> = {
  // macOS 13+ Settings first, then older System Preferences
  accessibility: [
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  ],
  microphone: [
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  ],
};

/** Open System Settings to the given Privacy pane so the user can grant access. */
export async function openPrivacyPane(pane: PrivacyPane): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  for (const url of PANE_ANCHORS[pane]) {
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      /* try next URL */
    }
  }
  return false;
}

/** Returns true if Accessibility is trusted (needed for Cmd+V paste). */
export function checkAccessibility(prompt: boolean): boolean {
  if (process.platform !== "darwin") return true;
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(prompt);
    if (!trusted && prompt) {
      void openPrivacyPane("accessibility");
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
  if (status === "not-determined") {
    return systemPreferences.askForMediaAccess("microphone");
  }
  return false;
}

export type PermissionCheck = {
  accessibility: boolean;
  microphone: string;
  opened: PrivacyPane[];
};

/**
 * Check mic + Accessibility. If either is missing, prompt (first time) and
 * open the matching System Settings Privacy pane so the user can grant it.
 */
export async function ensurePermissions(): Promise<PermissionCheck> {
  const opened: PrivacyPane[] = [];

  if (process.platform !== "darwin") {
    return { accessibility: true, microphone: "granted", opened };
  }

  let microphone = systemPreferences.getMediaAccessStatus("microphone");
  if (microphone === "not-determined") {
    const ok = await systemPreferences.askForMediaAccess("microphone");
    microphone = ok
      ? "granted"
      : systemPreferences.getMediaAccessStatus("microphone");
  }

  // prompt=false: we open Settings ourselves so both panes aren't stacked
  const accessibility = checkAccessibility(false);

  const missing: PrivacyPane[] = [];
  if (!accessibility) missing.push("accessibility");
  if (microphone !== "granted") missing.push("microphone");

  if (missing.length > 0) {
    await openPrivacyPane(missing[0]!);
    opened.push(missing[0]!);
  }

  return { accessibility, microphone, opened };
}

export async function runOsascript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 3000,
    maxBuffer: 1024 * 64,
  });
  return stdout.trim();
}
