import { countClipped, estimateCarrierHz, estimateModulation, peakAbs } from './dsp.js';

/** Lee la señal de salida real (post-limitador) y la mide con las mismas funciones que las pruebas. */
export class SignalAnalyzer {
  #node;
  #buf;

  constructor(analyserNode) {
    this.#node = analyserNode;
    this.#buf = new Float32Array(analyserNode.fftSize);
  }

  get node() {
    return this.#node;
  }

  read() {
    this.#node.getFloatTimeDomainData(this.#buf);
    return this.#buf;
  }

  measure() {
    const x = this.read();
    const sr = this.#node.context.sampleRate;
    return {
      ...estimateModulation(x, sr),
      carrierHz: estimateCarrierHz(x, sr),
      peak: peakAbs(x),
      clipped: countClipped(x),
    };
  }
}
