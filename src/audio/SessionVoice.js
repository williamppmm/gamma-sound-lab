import { effectiveDepth } from './dsp.js';
import { Mixer } from './Mixer.js';
import { Modulator } from './Modulator.js';
import { RainSource } from './RainSource.js';
import { Synthesizer } from './Synthesizer.js';

const levelsOf = (p) => ({ tone: p.toneLevel, rain: p.rainLevel });
const modOf = (p) => ({ modRateHz: p.modRateHz, depth: effectiveDepth(p) });

/**
 * Todo el sonido de una sesión. Se crea al iniciar y se destruye al terminar.
 *
 *   Synthesizer ─► canal tone ─┐
 *                              ├─► Mixer ─► Modulator (AM sobre la mezcla) ─► salida
 *   RainSource  ─► canal rain ─┘
 */
export class SessionVoice {
  constructor(ctx, params) {
    this.mixer = new Mixer(ctx, levelsOf(params));
    this.tone = new Synthesizer(ctx, params);
    this.rain = new RainSource(ctx, params);
    this.mod = new Modulator(ctx, modOf(params));

    this.tone.output.connect(this.mixer.input('tone'));
    this.rain.output.connect(this.mixer.input('rain'));
    this.mixer.output.connect(this.mod.input);
  }

  connect(destination) {
    this.mod.output.connect(destination);
  }

  start(time) {
    this.tone.start(time);
    this.rain.start(time);
    this.mod.start(time);
  }

  set(params, time) {
    this.tone.set(params, time);
    this.mixer.setLevels(levelsOf(params), time);
    this.mod.set(modOf(params), time);
  }

  dispose() {
    this.tone.dispose();
    this.rain.dispose();
    this.mixer.dispose();
    this.mod.dispose();
  }
}
