import { runOsascript } from "./permissions.js";
import { toneForBundleId, type Tone } from "./tones.js";

export type FrontmostApp = {
  name: string;
  bundleId: string;
  tone: Tone;
};

export async function getFrontmostApp(): Promise<FrontmostApp> {
  if (process.platform !== "darwin") {
    return { name: "Unknown", bundleId: "", tone: "neutral" };
  }
  try {
    const out = await runOsascript(
      'tell application "System Events" to get {name, bundle identifier} of first application process whose frontmost is true',
    );
    // osascript list → "Slack, com.tinyspeck.slackmacgap"
    const parts = out.split(",").map((s) => s.trim());
    const name = parts[0] || "Unknown";
    const bundleId = parts[1] || "";
    return { name, bundleId, tone: toneForBundleId(bundleId, name) };
  } catch {
    return { name: "Unknown", bundleId: "", tone: "neutral" };
  }
}