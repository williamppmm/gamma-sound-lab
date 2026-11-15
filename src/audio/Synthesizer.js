import { PARAM_SPEC } from './limits.js';
import { smoothSet } from './params.js';

const WAVEFORMS = PARAM_SPEC.waveform.values;
const XFADE_TC = 0.01; // constante de tiempo del fundido cruzado entre formas de onda

/**
 * Oscilador portador. Mantiene un oscilador por forma de onda, todos en fase y con la
 * misma frecuencia, y cambia de forma con un fundido cruzado (sin clic). Las ganancias
 * siempre suman 1 y la salida es una combinación convexa de ondas de pico ≤ 1: pico ≤ 1.
 */
export class Synthesizer {
  #voices; // Map forma → { osc, gain }

  constructor(ctx, { carrierHz, waveform }) {
    this.output = new GainNode(ctx, { gain: 1 });
    this.#voices = new Map(
      WAVEFORMS.map((type) => {
        const osc = new OscillatorNode(ctx, { type, frequency: carrierHz });
        const gain = new GainNode(ctx, { gain: type === waveform ? 1 : 0 });
        osc.connect(gain).connect(this.output);
        return [type, { osc, gain }];
      }),
    );
  }

  start(time) {
    for (const { osc } of this.#voices.values()) osc.start(time);
  }

  set({ carrierHz, waveform }, time) {
    for (const [type, { osc, gain }] of this.#voices) {
      smoothSet(osc.frequency, carrierHz, time);
      smoothSet(gain.gain, type === waveform ? 1 : 0, time, XFADE_TC);
    }
  }

  dispose() {
    for (const { osc, gain } of this.#voices.values()) {
      try {
        osc.stop();
      } catch {
        /* ya detenido o no iniciado */
      }
      osc.disconnect();
      gain.disconnect();
    }
    this.output.disconnect();
  }
}
