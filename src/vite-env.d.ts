/// <reference types="vite/client" />

import type { WhisperFlowApi } from "../electron/preload";

declare global {
  interface Window {
    whisperFlow: WhisperFlowApi;
  }
}

export {};
