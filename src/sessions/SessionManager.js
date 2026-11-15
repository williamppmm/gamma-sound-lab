import { outputGain } from '../audio/dsp.js';
import { PAUSE_FADE_SEC, STOP_FADE_SEC } from '../audio/limits.js';
import { holdAt } from '../audio/params.js';
import { SessionVoice } from '../audio/SessionVoice.js';
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
  #generation = 0;
  #createVoice;

  /**
   * @param engine  AudioEngine (o un doble de pruebas con la misma interfaz)
   * @param params  parámetros iniciales
   * @param options.createVoice  fábrica (ctx, params) → voz; permite probar sin Web Audio
   */
  constructor(engine, params, { createVoice = (ctx, p) => new SessionVoice(ctx, p) } = {}) {
    super();
    this.#engine = engine;
    this.#params = sanitizeParams(params);
    this.#createVoice = createVoice;
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
    return this.#enqueue((gen) => this.#start(gen));
  }
  pause() {
    return this.#enqueue((gen) => this.#pause(gen));
  }
  resume() {
    return this.#enqueue((gen) => this.#resume(gen));
  }
  stop() {
    return this.#enqueue((gen) => this.#stopGracefully(gen));
  }

  /**
   * Parada inmediata y sin esperas (cierre de pestaña). Invalida todas las operaciones
   * encoladas o en vuelo (nueva generación), pero permite iniciar sesiones nuevas después,
   * p. ej. si el navegador restaura la página desde su caché al volver atrás.
   */
  panic() {
    this.#generation++;
    clearInterval(this.#ticker);
    this.#voice?.dispose();
    this.#voice = null;
    this.#engine.close();
    this.#setState('idle', 'panic');
  }

  // ---- internos ---------------------------------------------------------------

  /**
   * Serializa operaciones. Cada una recibe la generación vigente al encolarla; si `panic()`
   * la cambia, la operación se descarta (si aún no empezó) o se abandona tras su próximo await.
   */
  #enqueue(op) {
    const gen = this.#generation;
    const run = this.#queueTail
      .then(() => (this.#isCurrent(gen) ? op(gen) : undefined))
      .catch((err) => this.#isCurrent(gen) && this.#fail(err));
    this.#queueTail = run;
    return run;
  }

  #isCurrent(gen) {
    return gen === this.#generation;
  }

  async #start(gen) {
    if (this.#state !== 'idle') await this.#halt('restart');
    if (!this.#isCurrent(gen)) return;
    await this.#engine.ensureRunning();
    if (!this.#isCurrent(gen)) return;

    const ctx = this.#engine.context;
    const p = this.#params;
    const t0 = ctx.currentTime + START_DELAY_SEC;
    const fade = this.#engine.fadeGain;
    fade.cancelScheduledValues(0);
    fade.setValueAtTime(0, ctx.currentTime);
    this.#engine.setMasterGain(outputGain(p.volume), 0);

    this.#voice = this.#createVoice(ctx, p);
    this.#voice.connect(this.#engine.input);
    this.#voice.start(t0);

    this.#endTime = t0 + p.durationMin * 60;
    this.#scheduleEnvelope(p.fadeSec, t0);
    this.#startTicker();
    this.#setState('playing');
  }

  async #pause(gen) {
    if (this.#state !== 'playing') return;
    const ctx = this.#engine.context;
    const g = this.#engine.fadeGain;
    const now = ctx.currentTime;
    holdAt(g, now);
    g.linearRampToValueAtTime(0, now + PAUSE_FADE_SEC);
    await wait(PAUSE_FADE_SEC * 1000 + 30);
    // La sesión pudo terminar o cerrarse durante el fundido.
    if (!this.#isCurrent(gen) || this.#state !== 'playing') return;
    await this.#engine.suspend(); // congela ctx.currentTime → el temporizador también se pausa
    this.#endTime += PAUSE_FADE_SEC;
    this.#setState('paused');
  }

  async #resume(gen) {
    if (this.#state !== 'paused') return;
    await this.#engine.ensureRunning();
    if (!this.#isCurrent(gen)) return;
    this.#scheduleEnvelope(PAUSE_FADE_SEC, this.#engine.context.currentTime);
    this.#setState('playing');
  }

  async #stopGracefully(gen) {
    if (this.#state === 'idle' || this.#state === 'stopping') return;
    if (this.#state === 'paused') return this.#halt('stopped');
    this.#setState('stopping');
    const g = this.#engine.fadeGain;
    const now = this.#engine.context.currentTime;
    holdAt(g, now);
    g.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
    await wait(STOP_FADE_SEC * 1000 + 50);
    if (!this.#isCurrent(gen)) return;
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

  /**
   * Programa: subida en `inSec`, meseta a 1 y bajada a 0 que termina exactamente en endTime.
   * Si la subida acaba dentro del fundido de salida (reanudar en los últimos segundos),
   * sube solo hasta el nivel que la curva de salida tiene en ese instante y continúa desde ahí.
   */
  #scheduleEnvelope(inSec, from) {
    const g = this.#engine.fadeGain;
    const end = this.#endTime;
    const fadeOut = this.#params.fadeSec;
    const peakAt = from + inSec;
    const fadeOutStart = end - fadeOut;
    holdAt(g, from);
    if (fadeOutStart > peakAt) {
      g.linearRampToValueAtTime(1, peakAt);
      g.setValueAtTime(1, fadeOutStart);
    } else if (peakAt < end) {
      g.linearRampToValueAtTime((end - peakAt) / fadeOut, peakAt);
    }
    g.linearRampToValueAtTime(0, end);
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
