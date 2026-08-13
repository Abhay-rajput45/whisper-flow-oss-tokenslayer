/**
 * Polish runs in the Electron main process (`electron/polish.ts`) via IPC
 * to avoid browser CORS on api.pyai.com. This module is unused by the overlay.
 */
export type Tone = "casual" | "formal" | "neutral";
