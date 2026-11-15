import { compressorMakeupDb } from './dsp.js';
import { LIMITER, MAX_MASTER_GAIN } from './limits.js';
import { smoothSet } from './params.js';

/**
 * Dueño del AudioContext y de la cadena de salida:
 *
 *   fuentes → master (volumen) → fade (sesión) → limitador → trim → analizador → altavoces
 *
 * `trim` anula la ganancia de compensación automática del compresor, para que
 * el nivel de salida sea exactamente el programado (100 % = −6 dBFS).
 *
 * No sabe nada de botones ni de sesiones. El contexto se crea perezosamente
 * (requiere un gesto del usuario) y se suspende cuando no hay sesión activa.
 */
export class AudioEngine {
  #ctx = null;
  #master = null;
  #fade = null;
  #limiter = null;
  #analyser = null;

  get context() {
    return this.#ctx;
  }
  /** Punto de entrada para las fuentes. */
  get input() {
    return this.#master;
  }
  get analyser() {
    return this.#analyser;
  }
  /** Ganancia reservada al SessionManager para fundidos de entrada/salida. */
  get fadeGain() {
    return this.#fade?.gain ?? null;
  }

  async ensureRunning() {
    if (!this.#ctx) this.#build();
    if (this.#ctx.state !== 'running') await this.#ctx.resume();
  }

  #build() {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.#master = new GainNode(ctx, { gain: 0 });
    this.#fade = new GainNode(ctx, { gain: 0 });
    this.#limiter = new DynamicsCompressorNode(ctx, LIMITER);
    const trim = new GainNode(ctx, { gain: 10 ** (-compressorMakeupDb(LIMITER) / 20) });
    this.#analyser = new AnalyserNode(ctx, { fftSize: 32768, smoothingTimeConstant: 0 });
    this.#master
      .connect(this.#fade)
      .connect(this.#limiter)
      .connect(trim)
      .connect(this.#analyser)
      .connect(ctx.destination);
    this.#ctx = ctx;
  }

  /** Ganancia lineal del master; nunca supera MAX_MASTER_GAIN. */
  setMasterGain(gain, timeConstant = 0.03) {
    if (!this.#ctx) return;
    const g = Math.min(Math.max(gain, 0), MAX_MASTER_GAIN);
    const p = this.#master.gain;
    const t = this.#ctx.currentTime;
    if (timeConstant <= 0) {
      p.cancelScheduledValues(0);
      p.setValueAtTime(g, t);
    } else {
      smoothSet(p, g, t, timeConstant);
    }
  }

  async suspend() {
    if (this.#ctx?.state === 'running') await this.#ctx.suspend();
  }

  async close() {
    const ctx = this.#ctx;
    this.#ctx = this.#master = this.#fade = this.#limiter = this.#analyser = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }
}
