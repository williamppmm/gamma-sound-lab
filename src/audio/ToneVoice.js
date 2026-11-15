import { effectiveDepth } from './dsp.js';
import { Modulator } from './Modulator.js';
import { Synthesizer } from './Synthesizer.js';

/** Una voz completa: portadora → modulador AM. Se crea por sesión y se destruye al terminar. */
export class ToneVoice {
  constructor(ctx, params) {
    this.synth = new Synthesizer(ctx, params);
    this.mod = new Modulator(ctx, { modRateHz: params.modRateHz, depth: effectiveDepth(params) });
    this.synth.output.connect(this.mod.input);
  }

  connect(destination) {
    this.mod.output.connect(destination);
  }

  start(time) {
    this.synth.start(time);
    this.mod.start(time);
  }

  set(params, time) {
    this.synth.set(params, time);
    this.mod.set({ modRateHz: params.modRateHz, depth: effectiveDepth(params) }, time);
  }

  dispose() {
    this.synth.dispose();
    this.mod.dispose();
  }
}
