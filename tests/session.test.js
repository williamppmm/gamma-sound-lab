import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSE_FADE_SEC, STOP_FADE_SEC } from '../src/audio/limits.js';
import { SessionManager } from '../src/sessions/SessionManager.js';
import { advance, makeFakeEngine, makeVoiceFactory } from './helpers/fakeAudio.js';

const PARAMS = { durationMin: 1, fadeSec: 3 };

let engine;
let factory;
let session;

beforeEach(() => {
  vi.useFakeTimers();
  engine = makeFakeEngine();
  factory = makeVoiceFactory();
  session = new SessionManager(engine, PARAMS, { createVoice: factory.createVoice });
});

afterEach(() => {
  session.panic();
  vi.useRealTimers();
});

/** Lleva la sesión hasta que queden `remaining` segundos. */
async function playUntilRemaining(remaining) {
  await session.start();
  await advance(engine, session.remainingSec - remaining);
}

describe('inicio', () => {
  it('crea una voz, la conecta y arranca con fundido de entrada', async () => {
    await session.start();
    expect(session.state).toBe('playing');
    expect(factory.voices).toHaveLength(1);
    expect(factory.voices[0].start).toHaveBeenCalledOnce();
    expect(engine.fadeNow()).toBe(0);
    await advance(engine, 1.5);
    expect(engine.fadeNow()).toBeGreaterThan(0.3);
    expect(engine.fadeNow()).toBeLessThan(0.7);
    await advance(engine, 2);
    expect(engine.fadeNow()).toBeCloseTo(1, 6);
  });

  it('doble clic en Iniciar nunca deja dos voces sonando', async () => {
    const a = session.start();
    const b = session.start();
    await Promise.all([a, b]);
    expect(factory.live()).toBe(1);
    expect(session.state).toBe('playing');
  });

  it('un error del motor deja la sesión detenida y emite "error"', async () => {
    engine.ensureRunning.mockRejectedValueOnce(new Error('sin dispositivo de audio'));
    const onError = vi.fn();
    session.addEventListener('error', onError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await session.start();
    expect(session.state).toBe('idle');
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('pausa y reanudación', () => {
  it('pausar baja el volumen, suspende el contexto y congela el temporizador', async () => {
    await session.start();
    await advance(engine, 10);
    session.pause();
    await advance(engine, PAUSE_FADE_SEC + 0.1);
    expect(session.state).toBe('paused');
    expect(engine.context.state).toBe('suspended');
    const frozen = session.remainingSec;
    await advance(engine, 30);
    expect(session.remainingSec).toBe(frozen);
  });

  it('reanudar en mitad de la sesión vuelve a volumen 1', async () => {
    await session.start();
    await advance(engine, 10);
    session.pause();
    await advance(engine, 0.5);
    await session.resume();
    await advance(engine, PAUSE_FADE_SEC + 0.1);
    expect(session.state).toBe('playing');
    expect(engine.fadeNow()).toBeCloseTo(1, 6);
  });

  it('reanudar durante el fundido de salida continúa la curva, no queda en silencio', async () => {
    await playUntilRemaining(2); // fundido de 3 s → la ganancia va por ~0,67
    session.pause();
    await advance(engine, 0.5);
    expect(session.state).toBe('paused');
    await session.resume();
    await advance(engine, PAUSE_FADE_SEC);
    // Quedan ~1,75 s de un fundido de 3 s → la ganancia debería rondar 0,58, no 0.
    expect(engine.fadeNow()).toBeGreaterThan(0.4);
    await advance(engine, 3);
    expect(session.state).toBe('idle');
  });
});

describe('final de sesión', () => {
  it('termina sola al cumplirse la duración, con fundido hasta 0', async () => {
    const reasons = [];
    session.addEventListener('change', (e) => e.detail.reason && reasons.push(e.detail.reason));
    await playUntilRemaining(1.5);
    expect(engine.fadeNow()).toBeCloseTo(0.5, 1);
    await advance(engine, 2);
    expect(session.state).toBe('idle');
    expect(reasons).toContain('completed');
    expect(factory.live()).toBe(0);
    expect(engine.context.state).toBe('suspended');
  });

  it('Detener hace fundido corto, libera la voz y suspende el contexto', async () => {
    await session.start();
    await advance(engine, 10);
    session.stop();
    await advance(engine, STOP_FADE_SEC / 2);
    expect(session.state).toBe('stopping');
    expect(engine.fadeNow()).toBeGreaterThan(0.3);
    expect(engine.fadeNow()).toBeLessThan(0.7);
    await advance(engine, STOP_FADE_SEC);
    expect(session.state).toBe('idle');
    expect(factory.live()).toBe(0);
    expect(engine.context.state).toBe('suspended');
  });

  it('Detener estando en pausa libera todo de inmediato', async () => {
    await session.start();
    session.pause();
    await advance(engine, 0.5);
    await session.stop();
    expect(session.state).toBe('idle');
    expect(factory.live()).toBe(0);
  });
});

describe('parámetros', () => {
  it('se aplican en caliente a la voz y al volumen', async () => {
    await session.start();
    session.update({ modRateHz: 10, volume: 0.5 });
    expect(factory.voices[0].set).toHaveBeenLastCalledWith(expect.objectContaining({ modRateHz: 10 }), expect.any(Number));
    expect(engine.setMasterGain).toHaveBeenLastCalledWith(0.25);
  });

  it('duración y fundido no cambian durante la sesión', async () => {
    await session.start();
    const p = session.update({ durationMin: 30, fadeSec: 8 });
    expect(p.durationMin).toBe(1);
    expect(p.fadeSec).toBe(3);
  });
});

describe('panic (cierre de pestaña)', () => {
  it('libera la voz y cierra el contexto', async () => {
    await session.start();
    session.panic();
    expect(factory.live()).toBe(0);
    expect(engine.close).toHaveBeenCalled();
    expect(session.state).toBe('idle');
  });

  it.each([
    ['resume', (s) => (s.pause(), s.resume())],
    ['start', (s) => (s.stop(), s.start())],
  ])('un %s encolado antes del cierre no crea un contexto nuevo ni suena', async (_name, enqueue) => {
    await session.start();
    await advance(engine, 5);
    enqueue(session); // la primera operación queda en vuelo (fundido); la segunda, encolada
    session.panic();
    await advance(engine, 3);
    expect(engine.contextsCreated).toBe(1);
    expect(engine.context).toBeNull();
    expect(factory.live()).toBe(0);
    expect(session.state).toBe('idle');
  });

  it('tras el cierre se puede iniciar una sesión nueva (vuelta atrás en el navegador)', async () => {
    await session.start();
    session.panic();
    await session.start();
    expect(session.state).toBe('playing');
    expect(factory.live()).toBe(1);
  });
});
