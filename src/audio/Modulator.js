import { amBaseGain, amLfoGain } from './dsp.js';
import { smoothSet } from './params.js';

/**
 * Modulación de amplitud: vca.gain = base + lfo·amount
 * con base = 1 - d/2 y amount = d/2 (ver dsp.js). La ganancia oscila entre 1-d y 1.
 */
export class Modulator {
  constructor(ctx, { modRateHz, depth }) {
    this.vca = new GainNode(ctx, { gain: amBaseGain(depth) });
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: modRateHz });
    this.amount = new GainNode(ctx, { gain: amLfoGain(depth) });
    this.lfo.connect(this.amount).connect(this.vca.gain);
    this.input = this.vca;
    this.output = this.vca;
  }

  start(time) {
    this.lfo.start(time);
  }

  set({ modRateHz, depth }, time) {
    smoothSet(this.lfo.frequency, modRateHz, time);
    smoothSet(this.vca.gain, amBaseGain(depth), time);
    smoothSet(this.amount.gain, amLfoGain(depth), time);
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
