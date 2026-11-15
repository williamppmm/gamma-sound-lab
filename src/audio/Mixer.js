import { mixNormalization } from './dsp.js';
import { smoothSet } from './params.js';

/** Mezclador por canales con normalización automática (la suma nunca supera pico 1). */
export class Mixer {
  #channels;

  /** @param levels objeto { nombreCanal: nivel 0–1 } que define los canales y su nivel inicial */
  constructor(ctx, levels) {
    this.output = new GainNode(ctx, { gain: mixNormalization(Object.values(levels)) });
    this.#channels = new Map(
      Object.entries(levels).map(([name, level]) => {
        const g = new GainNode(ctx, { gain: level });
        g.connect(this.output);
        return [name, g];
      }),
    );
  }

  input(name) {
    const ch = this.#channels.get(name);
    if (!ch) throw new Error(`Canal desconocido: ${name}`);
    return ch;
  }

  setLevels(levels, time) {
    for (const [name, level] of Object.entries(levels)) smoothSet(this.input(name).gain, level, time);
    smoothSet(this.output.gain, mixNormalization(Object.values(levels)), time);
  }

  dispose() {
    for (const ch of this.#channels.values()) ch.disconnect();
    this.output.disconnect();
  }
}
