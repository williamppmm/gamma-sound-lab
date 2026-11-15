import { amGains } from './dsp.js';
import { smoothSet } from './params.js';

export const PROBE_FFT_SIZE = 32768;

/**
 * Modulación de amplitud: vca.gain = base + lfo·amount, con las ganancias de amGains()
 * (dsp.js). Modulada: oscila entre 1 − d y 1. Sin modular: ganancia fija (igualada en RMS
 * si abMatchLoudness).
 *
 * Sonda de verificación: una señal constante 1 atraviesa `probeGain`, que recibe el mismo
 * valor base y el mismo LFO que `vca`. Su salida es exactamente g(t), la ganancia aplicada,
 * y se analiza en `probe` (AnalyserNode). Permite verificar la modulación sobre cualquier
 * material, incluida música con batidos propios donde medir la salida no es fiable.
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

    this.unity = new ConstantSourceNode(ctx, { offset: 1 });
    this.probeGain = new GainNode(ctx, { gain: base });
    this.probe = new AnalyserNode(ctx, { fftSize: PROBE_FFT_SIZE, smoothingTimeConstant: 0 });
    this.amount.connect(this.probeGain.gain);
    this.unity.connect(this.probeGain).connect(this.probe);
  }

  start(time) {
    this.lfo.start(time);
    this.unity.start(time);
  }

  set(params, time) {
    const { base, lfo } = amGains(params);
    smoothSet(this.lfo.frequency, params.modRateHz, time);
    smoothSet(this.vca.gain, base, time);
    smoothSet(this.probeGain.gain, base, time);
    smoothSet(this.amount.gain, lfo, time);
  }

  dispose() {
    for (const src of [this.lfo, this.unity]) {
      try {
        src.stop();
      } catch {
        /* ya detenido o no iniciado */
      }
      src.disconnect();
    }
    this.amount.disconnect();
    this.vca.disconnect();
    this.probeGain.disconnect();
    this.probe.disconnect();
  }
}
