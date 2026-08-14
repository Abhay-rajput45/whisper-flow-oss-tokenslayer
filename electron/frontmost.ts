import { runOsascript, runJxa } from "./permissions";
import { isSelfApp, toneForBundleId, type Tone } from "./tones";

export type FrontmostApp = {
  name: string;
  bundleId: string;
  tone: Tone;
};

const UNKNOWN: FrontmostApp = {
  name: "Unknown",
  bundleId: "",
  tone: "neutral",
};

function toFrontmost(name: string, bundleId: string): FrontmostApp {
  const n = name.trim() || "Unknown";
  const b = bundleId.trim();
  return { name: n, bundleId: b, tone: toneForBundleId(b, n) };
}

/**
 * On-screen windows in z-order, skip our own app (overlay/settings steal
 * "frontmost"). No polling — one shot at listen-start / Detect now.
 */
const JXA_FRONTMOST = `
ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["uint32", "uint32"]]);
ObjC.import("AppKit");

function run() {
  var selfPid = $.NSProcessInfo.processInfo.processIdentifier;
  var selfApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(selfPid);
  var selfBundle = selfApp && selfApp.bundleIdentifier
    ? ObjC.unwrap(selfApp.bundleIdentifier)
    : "";
  var selfName = selfApp && selfApp.localizedName
    ? ObjC.unwrap(selfApp.localizedName)
    : "";

  function isSelf(pid, bundle, name) {
    if (pid === selfPid) return true;
    var b = (bundle || "").toLowerCase();
    var n = (name || "").toLowerCase();
    var sb = (selfBundle || "").toLowerCase();
    var sn = (selfName || "").toLowerCase();
    if (sb && b && b === sb) return true;
    if (sn && n && n === sn) return true;
    if (n === "electron" || n === "verbatim" || b.indexOf("electron") !== -1) return true;
    if (n.indexOf("verbatim") !== -1 || b.indexOf("verbatim") !== -1) return true;
    if (n.indexOf("whisper-flow") !== -1 || n.indexOf("whisperflow") !== -1) return true;
    if (b.indexOf("whisper-flow") !== -1 || b.indexOf("whisperflow") !== -1) return true;
    return false;
  }

  var list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0));
  if (!list) return "";
  var entries = Array.isArray(list) ? list : Object.keys(list).map(function (k) { return list[k]; });

  for (var i = 0; i < entries.length; i++) {
    var w = entries[i];
    if (!w) continue;
    if (w.kCGWindowLayer !== 0) continue;
    var alpha = w.kCGWindowAlpha;
    if (typeof alpha === "number" && alpha < 0.05) continue;
    var pid = w.kCGWindowOwnerPID;
    if (!pid) continue;
    var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    var bundle = "";
    var name = w.kCGWindowOwnerName || "";
    if (app) {
      if (app.bundleIdentifier) bundle = ObjC.unwrap(app.bundleIdentifier) || "";
      if (app.localizedName) name = ObjC.unwrap(app.localizedName) || name;
    }
    if (isSelf(pid, bundle, name)) continue;
    if (!name) continue;
    return name + String.fromCharCode(31) + (bundle || "");
  }
  return "";
}
`;

async function queryViaWindowList(): Promise<FrontmostApp | null> {
  try {
    const out = await runJxa(JXA_FRONTMOST);
    if (!out) return null;
    const sep = String.fromCharCode(31);
    const i = out.indexOf(sep);
    const name = (i === -1 ? out : out.slice(0, i)).trim();
    const bundleId = (i === -1 ? "" : out.slice(i + 1)).trim();
    if (!name || isSelfApp(name, bundleId)) return null;
    return toFrontmost(name, bundleId);
  } catch {
    return null;
  }
}

async function queryViaSystemEvents(): Promise<FrontmostApp | null> {
  try {
    const out = await runOsascript(`
tell application "System Events"
  set n to ""
  set b to ""
  try
    set p to first application process whose frontmost is true
    set n to name of p as text
    try
      set b to bundle identifier of p as text
    end try
  end try
  return n & character id 31 & b
end tell
`.trim());
    if (!out) return null;
    const sep = String.fromCharCode(31);
    const i = out.indexOf(sep);
    const name = (i === -1 ? out : out.slice(0, i)).trim();
    const bundleId = (i === -1 ? "" : out.slice(i + 1)).trim();
    if (!name || isSelfApp(name, bundleId)) return null;
    return toFrontmost(name, bundleId);
  } catch {
    return null;
  }
}

/** Frontmost *user* app at call time — skips Electron / this app. */
export async function getFrontmostApp(): Promise<FrontmostApp> {
  if (process.platform !== "darwin") return UNKNOWN;
  const fromWindows = await queryViaWindowList();
  if (fromWindows) return fromWindows;
  const fromEvents = await queryViaSystemEvents();
  if (fromEvents) return fromEvents;
  return UNKNOWN;
}
