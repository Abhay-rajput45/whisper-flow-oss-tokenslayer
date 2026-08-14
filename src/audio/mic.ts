export type MicHandle = {
  stop: () => void;
};

/**
 * Capture mic → AudioWorklet → PCM16 @ 16 kHz frames via onFrame.
 * PyAI Hear has no denoise query param; we use browser NS/AEC/AGC plus a
 * worklet energy gate (hysteresis + hangover) to cut room hiss.
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
      ...({
        googEchoCancellation: true,
        googNoiseSuppression: true,
        googAutoGainControl: true,
        googHighpassFilter: true,
      } as MediaTrackConstraints),
    },
  });

  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule(
      new URL("../../public/capture-processor.js", import.meta.url).href,
    );
  } catch {
    await ctx.audioWorklet.addModule("/capture-processor.js");
  }

  const source = ctx.createMediaStreamSource(stream);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 100;
  highpass.Q.value = 0.707;

  const node = new AudioWorkletNode(ctx, "capture-processor");
  node.port.onmessage = (e) => {
    onFrame(e.data as ArrayBuffer);
  };

  source.connect(highpass);
  highpass.connect(node);
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
        highpass.disconnect();
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
