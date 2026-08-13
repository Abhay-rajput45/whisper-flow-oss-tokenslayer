export type Tone = "casual" | "formal" | "neutral";

const CASUAL_BUNDLES = new Set([
  "com.tinyspeck.slackmacgap",
  "com.apple.iChat",
  "com.apple.MobileSMS",
  "com.hnc.Discord",
  "com.discordapp.Discord",
  "org.telegram.desktop",
  "com.tdesktop.Telegram",
  "net.whatsapp.WhatsApp",
  "com.apple.FaceTime",
]);

const FORMAL_BUNDLES = new Set([
  "com.apple.mail",
  "com.google.Chrome", // often Gmail — treated formal when name hints
  "com.microsoft.Outlook",
  "com.apple.Notes", // docs often formal
  "com.microsoft.Word",
  "com.apple.iWork.Pages",
  "md.obsidian",
]);

export function toneForBundleId(bundleId: string, appName = ""): Tone {
  const id = bundleId.toLowerCase();
  const name = appName.toLowerCase();
  if (CASUAL_BUNDLES.has(bundleId) || /slack|discord|telegram|whatsapp|messages|imessage/.test(name)) {
    return "casual";
  }
  if (
    FORMAL_BUNDLES.has(bundleId) ||
    /mail|outlook|gmail|word|pages|notion|docs/.test(name)
  ) {
    // Chrome alone is ambiguous — only formal if name suggests mail/docs
    if (id === "com.google.chrome" && !/mail|gmail|docs|document/.test(name)) {
      return "neutral";
    }
    return "formal";
  }
  return "neutral";
}
