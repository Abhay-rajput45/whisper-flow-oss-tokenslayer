const apiKeyEl = document.getElementById("apiKey") as HTMLInputElement;
const hotkeyEl = document.getElementById("hotkey") as HTMLInputElement;
const polishEl = document.getElementById("polishTimeout") as HTMLInputElement;
const dictInput = document.getElementById("dictInput") as HTMLInputElement;
const dictList = document.getElementById("dictList") as HTMLUListElement;
const keyStatus = document.getElementById("keyStatus")!;
const toast = document.getElementById("toast")!;
const permOut = document.getElementById("permOut")!;
const toneOut = document.getElementById("toneOut")!;

let dictionary: string[] = [];
let apiKeyDirty = false;

function showToast(msg: string): void {
  toast.textContent = msg;
  setTimeout(() => {
    if (toast.textContent === msg) toast.textContent = "";
  }, 2500);
}

function renderDict(): void {
  dictList.innerHTML = "";
  for (const term of dictionary) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = term;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      dictionary = dictionary.filter((t) => t !== term);
      renderDict();
    });
    li.append(span, btn);
    dictList.append(li);
  }
}

async function load(): Promise<void> {
  const s = (await window.whisperFlow.getSettings()) as {
    hotkey: string;
    dictionary: string[];
    polishTimeoutMs: number;
    apiKeySet: boolean;
    apiKeyMasked: string;
  };
  hotkeyEl.value = s.hotkey || "Alt+Space";
  polishEl.value = String(s.polishTimeoutMs ?? 400);
  dictionary = Array.isArray(s.dictionary) ? [...s.dictionary] : [];
  renderDict();
  keyStatus.textContent = s.apiKeySet
    ? `Key configured: ${s.apiKeyMasked}`
    : "No key set — paste one below or export PYAI_API_KEY";
  apiKeyEl.placeholder = s.apiKeySet ? "•••••••• (leave blank to keep)" : "pyai_…";
}

document.getElementById("dictAdd")!.addEventListener("click", () => {
  const term = dictInput.value.trim().slice(0, 64);
  if (!term) return;
  if (dictionary.length >= 200) {
    showToast("Dictionary cap is 200 terms");
    return;
  }
  if (!dictionary.includes(term)) dictionary.push(term);
  dictInput.value = "";
  renderDict();
});

dictInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("dictAdd")!.click();
  }
});

apiKeyEl.addEventListener("input", () => {
  apiKeyDirty = true;
});

document.getElementById("save")!.addEventListener("click", async () => {
  try {
    const patch: Record<string, unknown> = {
      hotkey: hotkeyEl.value.trim() || "Alt+Space",
      dictionary,
      polishTimeoutMs: Number(polishEl.value) || 400,
    };
    if (apiKeyDirty && apiKeyEl.value.trim()) {
      patch.apiKey = apiKeyEl.value.trim();
    }
    const result = (await window.whisperFlow.saveSettings(patch)) as {
      ok: boolean;
      hotkeyRegistered?: boolean;
      error?: string;
      hotkey?: string;
      polishTimeoutMs?: number;
    };
    apiKeyDirty = false;
    apiKeyEl.value = "";
    await load();
    if (!result.ok) {
      showToast(result.error || "Hotkey could not be registered");
      return;
    }
    showToast(
      result.hotkeyRegistered === false
        ? "Saved, but the hotkey could not be bound — check Accessibility"
        : "Saved — hotkey and timeout are live",
    );
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Save failed");
  }
});

let applyTimer: ReturnType<typeof setTimeout> | null = null;
function applyHotkeyAndTimeoutSoon(): void {
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(() => {
    void window.whisperFlow.saveSettings({
      hotkey: hotkeyEl.value.trim() || "Alt+Space",
      polishTimeoutMs: Number(polishEl.value) || 400,
    });
  }, 400);
}

hotkeyEl.addEventListener("change", applyHotkeyAndTimeoutSoon);
hotkeyEl.addEventListener("blur", applyHotkeyAndTimeoutSoon);
polishEl.addEventListener("change", applyHotkeyAndTimeoutSoon);
polishEl.addEventListener("blur", applyHotkeyAndTimeoutSoon);

document.getElementById("checkPerms")!.addEventListener("click", async () => {
  const perms = (await window.whisperFlow.checkPermissions()) as {
    accessibility: boolean;
    microphone: string;
    opened?: string[];
  };
  const lines = [
    `Microphone: ${perms.microphone}`,
    `Accessibility: ${perms.accessibility ? "granted" : "not granted"}`,
  ];
  if (perms.opened?.length) {
    lines.push(
      `Opened System Settings → Privacy & Security (${perms.opened.join(", ")}). Turn on WhisperFlow / Electron, then click Check again.`,
    );
    if (perms.opened.length === 1 && (!perms.accessibility || perms.microphone !== "granted")) {
      const still = [];
      if (!perms.accessibility && !perms.opened.includes("accessibility")) {
        still.push("Accessibility");
      }
      if (perms.microphone !== "granted" && !perms.opened.includes("microphone")) {
        still.push("Microphone");
      }
      if (still.length) {
        lines.push(`Still needed after that: ${still.join(", ")}.`);
      }
    }
  } else if (perms.accessibility && perms.microphone === "granted") {
    lines.push("Both permissions are granted.");
  }
  permOut.textContent = lines.join("\n");
});

document.getElementById("refreshTone")!.addEventListener("click", async () => {
  const front = await window.whisperFlow.getFrontmost();
  toneOut.textContent = `${front.name} (${front.bundleId || "no bundle"}) → ${front.tone}`;
});

window.whisperFlow.onToast((msg) => showToast(msg));

void load();
