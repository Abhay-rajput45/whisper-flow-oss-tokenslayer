export type Tone = "casual" | "formal" | "neutral";

const CASUAL_BUNDLES = new Set([
  "com.tinyspeck.slackmacgap",
  "com.slack.slack",
  "com.slack",
  "com.apple.ichat",
  "com.apple.mobilesms",
  "com.hnc.discord",
  "com.discordapp.discord",
  "org.telegram.desktop",
  "com.tdesktop.telegram",
  "net.whatsapp.whatsapp",
  "com.apple.facetime",
]);

const FORMAL_BUNDLES = new Set([
  "com.apple.mail",
  "com.microsoft.outlook",
  "com.apple.notes",
  "com.microsoft.word",
  "com.apple.iwork.pages",
  "md.obsidian",
  "notion.id",
  "com.salesforce.lightning",
  "com.salesforce.chatterdesktop",
  "com.hubspot.hubspot",
  "com.linear",
  "com.atlassian.jira",
  "com.tinyspeck.trello",
]);

const CODE_BUNDLES = new Set([
  "com.microsoft.vscode",
  "com.todesktop.230313mzl4w4u92",
  "com.jetbrains.intellij",
  "com.apple.dt.xcode",
  "com.github.githubclient",
]);

const BROWSER_BUNDLES = new Set([
  "com.google.chrome",
  "com.apple.safari",
  "org.mozilla.firefox",
  "company.thebrowser.browser",
  "com.brave.browser",
  "com.microsoft.edgemac",
]);

export function isSelfApp(name: string, bundleId: string): boolean {
  const n = name.toLowerCase();
  const b = bundleId.toLowerCase();
  return (
    n === "electron" ||
    n.includes("whisper-flow") ||
    n.includes("whisperflow") ||
    b.includes("electron") ||
    b.includes("whisper-flow") ||
    b.includes("whisperflow")
  );
}

export function toneForBundleId(bundleId: string, appName = ""): Tone {
  const id = bundleId.toLowerCase().trim();
  const name = appName.toLowerCase().trim();

  if (isSelfApp(name, id)) return "neutral";

  if (
    CASUAL_BUNDLES.has(id) ||
    /slack|discord|telegram|whatsapp|messages|imessage|signal/.test(name)
  ) {
    return "casual";
  }

  // IDEs / terminals stay neutral (code-friendly punctuation)
  if (
    CODE_BUNDLES.has(id) ||
    /code|cursor|terminal|iterm|warp|jetbrains|xcode|github/.test(name)
  ) {
    return "neutral";
  }

  const looksFormalName =
    /mail|outlook|gmail|word|pages|notion|docs|document|salesforce|hubspot|linear|jira|confluence|zendesk/.test(
      name,
    );
  if (FORMAL_BUNDLES.has(id) || looksFormalName) {
    if (
      (BROWSER_BUNDLES.has(id) || /chrome|safari|firefox|edge|arc|brave/.test(name)) &&
      !looksFormalName
    ) {
      return "neutral";
    }
    return "formal";
  }

  return "neutral";
}
