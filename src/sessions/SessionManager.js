import { outputGain } from '../audio/dsp.js';
import { PAUSE_FADE_SEC, STOP_FADE_SEC } from '../audio/limits.js';
import { holdAt } from '../audio/params.js';
import { ToneVoice } from '../audio/ToneVoice.js';
import { sanitizeParams } from '../utils/validators.js';

const START_DELAY_SEC = 0.05;
const TICK_MS = 250;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Controlador entre la UI y el motor. Garantiza:
 *  - una sola voz activa (nunca osciladores duplicados),
 *  - operaciones serializadas (doble clic en "Iniciar" no crea dos sesiones),
 *  - fundidos en inicio, pausa y final,
 *  - parada automática al cumplirse la duración,
 *  - parámetros siempre validados.
 *
 * Estados: idle → playing ⇄ paused → stopping → idle
 * Emite 'change' (detail: { state, remainingSec, params, reason }) y 'error'.
 */
export class SessionManager extends EventTarget {
  #engine;
  #params;
  #voice = null;
  #state = 'idle';
  #endTime = 0;
  #ticker = 0;
  #queueTail = Promise.resolve();

  constructor(engine, params) {
    super();
    this.#engine = engine;
    this.#params = sanitizeParams(params);
  }

  get state() {
    return this.#state;
  }
  get params() {
    return this.#params;
  }
  get remainingSec() {
    const ctx = this.#engine.context;
    if (this.#state === 'idle' || !ctx) return this.#params.durationMin * 60;
    return Math.max(0, this.#endTime - ctx.currentTime);
  }
  snapshot() {
    return { state: this.#state, remainingSec: this.remainingSec, params: this.#params };
  }

  /** Cambia parámetros en caliente. Duración y fundido quedan fijos durante la sesión. */
  update(partial) {
    const prev = this.#params;
    let next = sanitizeParams(partial, prev);
    if (this.#state !== 'idle') {
      next = Object.freeze({ ...next, durationMin: prev.durationMin, fadeSec: prev.fadeSec });
    }
    this.#params = next;
    const ctx = this.#engine.context;
    if (this.#voice && ctx) {
      this.#voice.set(next, ctx.currentTime);
      this.#engine.setMasterGain(outputGain(next.volume));
    }
    this.#emit();
    return next;
  }

  start() {
    return this.#enqueue(() => this.#start());
  }
  pause() {
    return this.#enqueue(() => this.#pause());
  }
  resume() {
    return this.#enqueue(() => this.#resume());
  }
  stop() {
    return this.#enqueue(() => this.#stopGracefully());
  }

  /** Parada inmediata y sin esperas (cierre de pestaña). */
  panic() {
    clearInterval(this.#ticker);
    this.#voice?.dispose();
    this.#voice = null;
    this.#engine.close();
    this.#setState('idle', 'panic');
  }

  // ---- internos ---------------------------------------------------------------

  #enqueue(op) {
    const run = this.#queueTail.then(op).catch((err) => this.#fail(err));
    this.#queueTail = run;
    return run;
  }

  async #start() {
    if (this.#state !== 'idle') await this.#halt('restart');
    await this.#engine.ensureRunning();

    const ctx = this.#engine.context;
    const p = this.#params;
    const t0 = ctx.currentTime + START_DELAY_SEC;
    const fade = this.#engine.fadeGain;
    fade.cancelScheduledValues(0);
    fade.setValueAtTime(0, ctx.currentTime);
    this.#engine.setMasterGain(outputGain(p.volume), 0);

    this.#voice = new ToneVoice(ctx, p);
    this.#voice.connect(this.#engine.input);
    this.#voice.start(t0);

    this.#endTime = t0 + p.durationMin * 60;
    this.#scheduleEnvelope(p.fadeSec, t0);
    this.#startTicker();
    this.#setState('playing');
  }

  async #pause() {
    if (this.#state !== 'playing') return;
    const ctx = this.#engine.context;
    const g = this.#engine.fadeGain;
    const now = ctx.currentTime;
    holdAt(g, now);
    g.linearRampToValueAtTime(0, now + PAUSE_FADE_SEC);
    await wait(PAUSE_FADE_SEC * 1000 + 30);
    if (this.#state !== 'playing') return; // la sesión terminó durante el fundido
    await this.#engine.suspend(); // congela ctx.currentTime → el temporizador también se pausa
    this.#endTime += PAUSE_FADE_SEC;
    this.#setState('paused');
  }

  async #resume() {
    if (this.#state !== 'paused') return;
    await this.#engine.ensureRunning();
    this.#scheduleEnvelope(PAUSE_FADE_SEC, this.#engine.context.currentTime);
    this.#setState('playing');
  }

  async #stopGracefully() {
    if (this.#state === 'idle' || this.#state === 'stopping') return;
    if (this.#state === 'paused') return this.#halt('stopped');
    this.#setState('stopping');
    const g = this.#engine.fadeGain;
    const now = this.#engine.context.currentTime;
    holdAt(g, now);
    g.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
    await wait(STOP_FADE_SEC * 1000 + 50);
    await this.#halt('stopped');
  }

  /** Detiene y libera todo. El fade ya debe estar en 0 (o el contexto suspendido). */
  async #halt(reason) {
    clearInterval(this.#ticker);
    this.#ticker = 0;
    this.#voice?.dispose();
    this.#voice = null;
    const ctx = this.#engine.context;
    if (ctx) {
      const g = this.#engine.fadeGain;
      g.cancelScheduledValues(0);
      g.setValueAtTime(0, ctx.currentTime);
    }
    this.#setState('idle', reason);
    await this.#engine.suspend();
  }

  /** Programa: subida a 1 en `inSec`, meseta, y bajada a 0 que termina exactamente en endTime. */
  #scheduleEnvelope(inSec, from) {
    const g = this.#engine.fadeGain;
    const peakAt = from + inSec;
    const fadeOutStart = this.#endTime - this.#params.fadeSec;
    holdAt(g, from);
    if (fadeOutStart > peakAt) {
      g.linearRampToValueAtTime(1, peakAt);
      g.setValueAtTime(1, fadeOutStart);
    }
    g.linearRampToValueAtTime(0, this.#endTime);
  }

  #startTicker() {
    clearInterval(this.#ticker);
    this.#ticker = setInterval(() => this.#tick(), TICK_MS);
  }

  #tick() {
    if (this.#state === 'playing' && this.remainingSec <= 0) {
      this.#setState('stopping');
      this.#enqueue(() => this.#halt('completed'));
      return;
    }
    this.#emit();
  }

  #fail(err) {
    console.error(err);
    clearInterval(this.#ticker);
    this.#ticker = 0;
    try {
      this.#voice?.dispose();
    } catch {
      /* ignorar */
    }
    this.#voice = null;
    this.#setState('idle', 'error');
    this.dispatchEvent(new CustomEvent('error', { detail: err }));
  }

  #setState(state, reason) {
    this.#state = state;
    this.#emit(reason);
  }

  #emit(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { ...this.snapshot(), reason } }));
  }
}
