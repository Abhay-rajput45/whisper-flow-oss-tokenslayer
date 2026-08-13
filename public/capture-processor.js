const FRAME = 320; // 20 ms @ 16 kHz

/**
 * AudioWorklet: Float32 (AudioContext rate) → Int16 PCM @ 16 kHz.
 * Decimates by integer ratio when context is 48 kHz (3:1).
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(FRAME);
    this._n = 0;
    this._phase = 0;
    // sampleRate is a worklet global
    this._step = Math.max(1, Math.round(sampleRate / 16000));
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this._phase++ % this._step !== 0) continue;
      const s = Math.max(-1, Math.min(1, ch[i]));
      this._buf[this._n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._n === FRAME) {
        const out = this._buf.slice();
        this.port.postMessage(out.buffer, [out.buffer]);
        this._n = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
