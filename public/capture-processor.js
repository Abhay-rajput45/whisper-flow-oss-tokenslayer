const FRAME = 320; // 20 ms @ 16 kHz
const OPEN_RMS = 0.014;
const CLOSE_RMS = 0.007;
const HANGOVER_FRAMES = 8;

/**
 * AudioWorklet: Float32 → Int16 PCM @ 16 kHz, with a noise gate.
 * Hear has no denoise API param — we still send silence frames so
 * endpointing keeps working. Hysteresis + hangover avoid clipping word ends.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Int16Array(FRAME);
    this._float = new Float32Array(FRAME);
    this._n = 0;
    this._phase = 0;
    this._step = Math.max(1, Math.round(sampleRate / 16000));
    this._open = false;
    this._hang = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      if (this._phase++ % this._step !== 0) continue;
      this._float[this._n] = ch[i];
      this._n++;
      if (this._n === FRAME) {
        this._emitFrame();
        this._n = 0;
      }
    }
    return true;
  }

  _emitFrame() {
    let sumSq = 0;
    for (let i = 0; i < FRAME; i++) sumSq += this._float[i] * this._float[i];
    const rms = Math.sqrt(sumSq / FRAME);

    if (this._open) {
      if (rms < CLOSE_RMS) {
        this._hang++;
        if (this._hang > HANGOVER_FRAMES) {
          this._open = false;
          this._hang = 0;
        }
      } else {
        this._hang = 0;
      }
    } else if (rms >= OPEN_RMS) {
      this._open = true;
      this._hang = 0;
    }

    const pass = this._open;
    for (let i = 0; i < FRAME; i++) {
      const s = pass ? Math.max(-1, Math.min(1, this._float[i])) : 0;
      this._buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const out = this._buf.slice();
    this.port.postMessage(out.buffer, [out.buffer]);
  }
}

registerProcessor("capture-processor", CaptureProcessor);
