import { channelGains } from './dsp.js';
import { smoothSet } from './params.js';

/**
 * Mezclador por canales. La normalización (la suma nunca supera pico 1) va incluida
 * en la ganancia de cada canal: ver channelGains() en dsp.js.
 */
export class Mixer {
  #channels;

  /** @param levels objeto { nombreCanal: nivel 0–1 } que define los canales y su nivel inicial */
  constructor(ctx, levels) {
    this.output = new GainNode(ctx, { gain: 1 });
    const gains = channelGains(levels);
    this.#channels = new Map(
      Object.keys(levels).map((name) => {
        const g = new GainNode(ctx, { gain: gains[name] });
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
    for (const [name, gain] of Object.entries(channelGains(levels))) {
      smoothSet(this.input(name).gain, gain, time);
    }
  }

  dispose() {
    for (const ch of this.#channels.values()) ch.disconnect();
    this.output.disconnect();
  }
}
