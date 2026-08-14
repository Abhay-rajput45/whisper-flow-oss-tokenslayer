import { contextBridge, ipcRenderer } from "electron";

export type FrontmostInfo = {
  name: string;
  bundleId: string;
  tone: "casual" | "formal" | "neutral";
};

export type PttStartPayload = {
  apiKey: string;
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
};

export type PolishResult = {
  text: string;
  polished: boolean;
  ms: number;
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
