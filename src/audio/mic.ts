export type MicHandle = {
  stop: () => void;
};

/**
 * Capture mic → AudioWorklet → PCM16 @ 16 kHz frames via onFrame.
 */
export async function startMic(
  onFrame: (pcm16: ArrayBuffer) => void,
): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext();
  // Prefer 16 kHz if the browser honors it; worklet still decimates if not
  try {
    await ctx.audioWorklet.addModule(
      new URL("../../public/capture-processor.js", import.meta.url).href,
    );
  } catch {
    // Vite public assets served from root
    await ctx.audioWorklet.addModule("/capture-processor.js");
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture-processor");
  node.port.onmessage = (e) => {
    onFrame(e.data as ArrayBuffer);
  };
  source.connect(node);
  // Keep graph alive without audible feedback
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute);
  mute.connect(ctx.destination);

  if (ctx.state === "suspended") await ctx.resume();

  return {
    stop: () => {
      try {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        mute.disconnect();
        void ctx.close();
        for (const t of stream.getTracks()) t.stop();
      } catch {
        /* noop */
      }
    },
  };
}
