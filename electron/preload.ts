import { contextBridge, ipcRenderer } from "electron";

export type FrontmostInfo = {
  name: string;
  bundleId: string;
  tone: "casual" | "formal" | "neutral";
};

export type PttStartPayload = {
  toneHint: "casual" | "formal" | "neutral";
  bundleId: string;
  appName: string;
  dictionary: string[];
  polishTimeoutMs: number;
};

export type PolishRequest = {
  text: string;
  tone: "casual" | "formal" | "neutral";
  dictionary: string[];
  timeoutMs: number;
  appName?: string;
};

export type PolishResult = {
  text: string;
  polished: boolean;
  localOnly: boolean;
  ms: number;
  status: "shipped" | "partial" | "failed";
};

const api = {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke("save-settings", patch),
  getFrontmost: (): Promise<FrontmostInfo> => ipcRenderer.invoke("get-frontmost"),
  polishText: (input: PolishRequest): Promise<PolishResult> =>
    ipcRenderer.invoke("polish-text", input),
  pasteText: (text: string) => ipcRenderer.invoke("paste-text", text),
  hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
  endListen: (action: "cancel" | "commit") =>
    ipcRenderer.invoke("end-listen", action),
  checkPermissions: () => ipcRenderer.invoke("check-permissions"),
  learnDictionary: (terms: string[]) =>
    ipcRenderer.invoke("learn-dictionary", terms),

  hearStart: (): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("hear-start"),
  hearSendPcm: (buf: ArrayBuffer) => {
    ipcRenderer.send("hear-pcm", buf);
  },
  hearCommit: () => ipcRenderer.send("hear-commit"),
  hearPark: () => ipcRenderer.send("hear-park"),

  onHearPartial: (cb: (text: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on("hear-partial", listener);
    return () => ipcRenderer.removeListener("hear-partial", listener);
  },
  onHearFinal: (cb: (text: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on("hear-final", listener);
    return () => ipcRenderer.removeListener("hear-final", listener);
  },
  onHearError: (cb: (code: string, message: string) => void) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      code: string,
      message: string,
    ) => cb(code, message);
    ipcRenderer.on("hear-error", listener);
    return () => ipcRenderer.removeListener("hear-error", listener);
  },

  onPttStart: (cb: (payload: PttStartPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: PttStartPayload) =>
      cb(payload);
    ipcRenderer.on("ptt-start", listener);
    return () => ipcRenderer.removeListener("ptt-start", listener);
  },
  onPttStop: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("ptt-stop", listener);
    return () => ipcRenderer.removeListener("ptt-stop", listener);
  },
  onToast: (cb: (msg: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on("toast", listener);
    return () => ipcRenderer.removeListener("toast", listener);
  },
  resizeOverlay: (height: number) => ipcRenderer.send("overlay-resize", height),
};

contextBridge.exposeInMainWorld("whisperFlow", api);

export type WhisperFlowApi = typeof api;
