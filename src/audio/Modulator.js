import { amGains } from './dsp.js';
import { smoothSet } from './params.js';

/**
 * Modulación de amplitud: vca.gain = base + lfo·amount, con las ganancias de amGains()
 * (dsp.js). Modulada: oscila entre 1 − d y 1. Sin modular: ganancia fija (igualada en RMS
 * si abMatchLoudness).
 */
export class Modulator {
  constructor(ctx, params) {
    const { base, lfo } = amGains(params);
    this.vca = new GainNode(ctx, { gain: base });
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: params.modRateHz });
    this.amount = new GainNode(ctx, { gain: lfo });
    this.lfo.connect(this.amount).connect(this.vca.gain);
    this.input = this.vca;
    this.output = this.vca;
  }

  start(time) {
    this.lfo.start(time);
  }

  set(params, time) {
    const { base, lfo } = amGains(params);
    smoothSet(this.lfo.frequency, params.modRateHz, time);
    smoothSet(this.vca.gain, base, time);
    smoothSet(this.amount.gain, lfo, time);
  }

  dispose() {
    try {
      this.lfo.stop();
    } catch {
      /* ya detenido o no iniciado */
    }
    this.lfo.disconnect();
    this.amount.disconnect();
    this.vca.disconnect();
  }
}
