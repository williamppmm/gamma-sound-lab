import { smoothSet } from './params.js';

/** Oscilador portador. */
export class Synthesizer {
  constructor(ctx, { carrierHz, waveform }) {
    this.osc = new OscillatorNode(ctx, { type: waveform, frequency: carrierHz });
    this.output = this.osc;
  }

  start(time) {
    this.osc.start(time);
  }

  set({ carrierHz, waveform }, time) {
    smoothSet(this.osc.frequency, carrierHz, time);
    if (waveform && this.osc.type !== waveform) this.osc.type = waveform;
  }

  dispose() {
    try {
      this.osc.stop();
    } catch {
      /* ya detenido o no iniciado */
    }
    this.osc.disconnect();
  }
}
