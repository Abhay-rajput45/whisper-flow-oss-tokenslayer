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
    await window.whisperFlow.saveSettings(patch);
    apiKeyDirty = false;
    apiKeyEl.value = "";
    await load();
    showToast("Saved");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Save failed");
  }
});

document.getElementById("checkPerms")!.addEventListener("click", async () => {
  const perms = await window.whisperFlow.checkPermissions();
  permOut.textContent = JSON.stringify(perms, null, 2);
});

document.getElementById("refreshTone")!.addEventListener("click", async () => {
  const front = await window.whisperFlow.getFrontmost();
  toneOut.textContent = `${front.name} (${front.bundleId || "no bundle"}) → ${front.tone}`;
});

window.whisperFlow.onToast((msg) => showToast(msg));

void load();
