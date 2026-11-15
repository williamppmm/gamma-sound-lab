// Dobles de prueba para SessionManager: reloj de audio controlable y un AudioParam
// que modela la automatización (set / rampa lineal / cancelar / congelar) para poder
// preguntar "¿qué ganancia habrá en el instante t?".
import { vi } from 'vitest';

export class FakeParam {
  constructor(value = 0) {
    this.initial = value;
    this.events = []; // { type: 'set' | 'linear', time, value }, ordenados por tiempo
  }

  #insert(ev) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > ev.time) i--;
    this.events.splice(i, 0, ev);
  }

  setValueAtTime(value, time) {
    this.#insert({ type: 'set', time, value });
  }
  linearRampToValueAtTime(value, time) {
    this.#insert({ type: 'linear', time, value });
  }
  setTargetAtTime() {
    throw new Error('FakeParam: setTargetAtTime no modelado (SessionManager no debería usarlo en el fade)');
  }
  cancelScheduledValues(time) {
    this.events = this.events.filter((e) => e.time < time);
  }
  cancelAndHoldAtTime(time) {
    const v = this.valueAt(time);
    this.cancelScheduledValues(time);
    this.setValueAtTime(v, time);
  }

  /** Valor de la automatización en el instante t (semántica de Web Audio para set + rampa lineal). */
  valueAt(t) {
    let prevTime = 0;
    let prevValue = this.initial;
    for (const e of this.events) {
      if (e.time > t) {
        if (e.type === 'linear') {
          const span = e.time - prevTime;
          return span <= 0 ? e.value : prevValue + ((e.value - prevValue) * (t - prevTime)) / span;
        }
        return prevValue;
      }
      prevTime = e.time;
      prevValue = e.value;
    }
    return prevValue;
  }
}

export function makeFakeEngine() {
  const engine = {
    context: null,
    fadeGain: null,
    input: { fake: 'input' },
    contextsCreated: 0,
    ensureRunning: vi.fn(async () => {
      if (!engine.context) {
        engine.context = { currentTime: 0, state: 'running', sampleRate: 48000 };
        engine.fadeGain = new FakeParam(0);
        engine.contextsCreated++;
      }
      engine.context.state = 'running';
    }),
    suspend: vi.fn(async () => {
      if (engine.context) engine.context.state = 'suspended';
    }),
    close: vi.fn(async () => {
      engine.context = null;
      engine.fadeGain = null;
    }),
    setMasterGain: vi.fn(),
    /** Ganancia del fade en el instante actual del reloj de audio. */
    fadeNow() {
      return engine.fadeGain ? engine.fadeGain.valueAt(engine.context.currentTime) : 0;
    },
  };
  return engine;
}

export function makeVoiceFactory() {
  const voices = [];
  const createVoice = () => {
    const v = {
      disposed: false,
      connect: vi.fn(),
      start: vi.fn(),
      set: vi.fn(),
      dispose: vi.fn(() => {
        v.disposed = true;
      }),
    };
    voices.push(v);
    return v;
  };
  return { voices, createVoice, live: () => voices.filter((v) => !v.disposed).length };
}

/**
 * Avanza el reloj de audio (solo si el contexto está "running", igual que en Web Audio)
 * y los temporizadores de JS, en pasos pequeños para que el ticker de 250 ms lo observe.
 */
export async function advance(engine, seconds, step = 0.05) {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) {
    if (engine.context?.state === 'running') engine.context.currentTime += step;
    await vi.advanceTimersByTimeAsync(step * 1000);
  }
}
