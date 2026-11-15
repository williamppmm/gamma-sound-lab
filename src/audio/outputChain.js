import { compressorMakeupDb } from './dsp.js';
import { LIMITER } from './limits.js';

export const ANALYSER_FFT_SIZE = 32768;

/**
 * Cadena de salida común a la reproducción en vivo y a la exportación:
 *
 *   fuentes → master (volumen) → fade (sesión) → limitador → trim → analizador → destino
 *
 * `trim` anula la ganancia de compensación automática del compresor, para que
 * el nivel de salida sea exactamente el programado (100 % = −6 dBFS).
 * Funciona con AudioContext y con OfflineAudioContext.
 */
export function buildOutputChain(ctx) {
  const master = new GainNode(ctx, { gain: 0 });
  const fade = new GainNode(ctx, { gain: 0 });
  const limiter = new DynamicsCompressorNode(ctx, LIMITER);
  const trim = new GainNode(ctx, { gain: 10 ** (-compressorMakeupDb(LIMITER) / 20) });
  const analyser = new AnalyserNode(ctx, { fftSize: ANALYSER_FFT_SIZE, smoothingTimeConstant: 0 });
  // Analizador pequeño para los visuales (se lee en cada fotograma; no va al destino).
  const visual = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.5 });
  master.connect(fade).connect(limiter).connect(trim).connect(analyser).connect(ctx.destination);
  trim.connect(visual);
  return { input: master, master, fade, limiter, trim, analyser, visual };
}
