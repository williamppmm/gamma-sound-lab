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

  it('Iniciar es idempotente: dos peticiones seguidas crean y arrancan una sola voz', async () => {
    await Promise.all([session.start(), session.start()]);
    expect(factory.voices).toHaveLength(1);
    expect(factory.voices[0].start).toHaveBeenCalledOnce();
    expect(session.state).toBe('playing');
  });

  it('Iniciar durante una sesión (o en pausa) no la reinicia', async () => {
    await session.start();
    await advance(engine, 5);
    const remaining = session.remainingSec;
    await session.start();
    expect(factory.voices).toHaveLength(1);
    expect(session.remainingSec).toBeCloseTo(remaining, 6);
    session.pause();
    await advance(engine, 0.5);
    await session.start();
    expect(session.state).toBe('paused');
    expect(factory.voices).toHaveLength(1);
  });

  it('carga Bruma antes de programar el audio y mantiene la fuente seleccionada', async () => {
    const loaded = Promise.withResolvers();
    const loading = Promise.withResolvers();
    const createVoice = vi.fn((_ctx, params) => {
      loading.resolve(params);
      return loaded.promise;
    });
    session = new SessionManager(engine, { ...PARAMS, source: 'bruma' }, { createVoice });

    const start = session.start();
    expect(await loading.promise).toMatchObject({ source: 'bruma', modRateHz: 40, brumaDepth: 0.2 });
    expect(session.state).toBe('starting');
    expect(session.remainingSec).toBe(60);
    expect(session.update({ source: 'tone-rain', chordsLevel: 0.4 }).source).toBe('bruma');
    await advance(engine, 1);
    const voice = factory.createVoice();
    loaded.resolve(voice);
    await start;

    expect(createVoice).toHaveBeenCalledOnce();
    expect(voice.set).toHaveBeenCalledWith(expect.objectContaining({ chordsLevel: 0.4 }), engine.context.currentTime);
    expect(voice.start.mock.calls[0][0]).toBeGreaterThan(engine.context.currentTime);
    expect(session.remainingSec).toBeCloseTo(60.05, 6);
    expect(session.state).toBe('playing');
  });

  it('Detener cancela la carga de Bruma y suspende el contexto', async () => {
    const loading = Promise.withResolvers();
    const onError = vi.fn();
    session = new SessionManager(engine, { ...PARAMS, source: 'bruma' }, {
      createVoice: (_ctx, _params, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        loading.resolve();
      }),
    });
    session.addEventListener('error', onError);
    const start = session.start();
    await loading.promise;
    await session.stop();
    await start;

    expect(session.state).toBe('idle');
    expect(engine.context.state).toBe('suspended');
    expect(onError).not.toHaveBeenCalled();
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

  it('un error tras crear el contexto lo suspende y no deja voces vivas', async () => {
    let calls = 0;
    session = new SessionManager(engine, PARAMS, {
      createVoice: (...args) => {
        if (++calls === 1) throw new Error('fallo al crear la voz');
        return factory.createVoice(...args);
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.state).toBe('idle');
    expect(engine.context.state).toBe('suspended');
    expect(engine.fadeNow()).toBe(0);
    // y la siguiente sesión funciona con normalidad
    await session.start();
    expect(session.state).toBe('playing');
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

  it('Detener en los últimos instantes no prolonga la señal más allá del plazo', async () => {
    await playUntilRemaining(0.5);
    const deadline = engine.context.currentTime + session.remainingSec;
    session.stop();
    await vi.advanceTimersByTimeAsync(0); // deja que la operación encolada programe su fundido
    expect(session.state).toBe('stopping');
    expect(engine.fadeGain.valueAt(deadline)).toBe(0);
    expect(engine.fadeGain.valueAt(deadline + 0.25)).toBe(0);
    await advance(engine, 1.5);
    expect(session.state).toBe('idle');
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

  it('duración, fundido y semilla no cambian durante la sesión (aunque se llame a update directamente)', async () => {
    await session.start();
    const seed = session.params.rainSeed;
    const p = session.update({ durationMin: 30, fadeSec: 8, rainSeed: seed + 1 });
    expect(p.durationMin).toBe(1);
    expect(p.fadeSec).toBe(3);
    expect(p.rainSeed).toBe(seed);
  });

  it('en reposo sí se pueden cambiar', async () => {
    const p = session.update({ durationMin: 30, rainSeed: 2 });
    expect(p.durationMin).toBe(30);
    expect(p.rainSeed).toBe(2);
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

  it('una pausa cuya suspensión termina después del cierre no deja el estado en "paused"', async () => {
    await session.start();
    await advance(engine, 5);
    let resolveSuspend;
    engine.suspend.mockImplementationOnce(() => new Promise((r) => (resolveSuspend = r)));
    session.pause();
    await advance(engine, PAUSE_FADE_SEC + 0.1); // la pausa queda esperando a suspend()
    expect(resolveSuspend).toBeTypeOf('function');
    session.panic();
    resolveSuspend();
    await vi.advanceTimersByTimeAsync(0);
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
