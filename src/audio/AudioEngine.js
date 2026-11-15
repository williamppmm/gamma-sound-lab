import { MAX_MASTER_GAIN } from './limits.js';
import { buildOutputChain } from './outputChain.js';
import { smoothSet } from './params.js';

/**
 * Dueño del AudioContext y de la cadena de salida (ver outputChain.js, compartida con la
 * exportación). No sabe nada de botones ni de sesiones. El contexto se crea perezosamente
 * (requiere un gesto del usuario) y se suspende cuando no hay sesión activa.
 */
export class AudioEngine {
  #ctx = null;
  #master = null;
  #fade = null;
  #analyser = null;
  #visual = null;

  /** Analizador pequeño para los visuales (o null si el contexto aún no existe). */
  get visualAnalyser() {
    return this.#visual;
  }

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
    const chain = buildOutputChain(ctx);
    this.#master = chain.master;
    this.#fade = chain.fade;
    this.#analyser = chain.analyser;
    this.#visual = chain.visual;
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
    this.#ctx = this.#master = this.#fade = this.#analyser = this.#visual = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }
}
