// Fuente única de verdad para rangos de parámetros y límites de seguridad.
// La UI, los validadores, el motor y las pruebas leen de aquí.

export const PARAM_SPEC = Object.freeze({
  source: { kind: 'enum', values: ['tone-rain', 'bruma', 'generative'], default: 'tone-rain', sessionLocked: true },
  // Composición generativa: la partitura sale de estos cuatro valores (ver src/music/composer.js).
  genSeed: { kind: 'number', integer: true, min: 1, max: 999999, default: 7, sessionLocked: true },
  genMode: { kind: 'enum', values: ['pentatonic', 'major', 'minor'], default: 'pentatonic', sessionLocked: true },
  genRoot: {
    kind: 'enum',
    values: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    default: 'D',
    sessionLocked: true,
  },
  genTempo: { kind: 'number', integer: true, min: 50, max: 96, default: 68, sessionLocked: true },
  carrierHz: { kind: 'number', min: 100, max: 1000, default: 220 },
  waveform: { kind: 'enum', values: ['sine', 'triangle'], default: 'sine' },
  modRateHz: { kind: 'number', min: 1, max: 100, default: 40 },
  depth: { kind: 'number', min: 0, max: 1, default: 0.5 },
  modulationOn: { kind: 'boolean', default: true },
  abMatchLoudness: { kind: 'boolean', default: true },
  toneLevel: { kind: 'number', min: 0, max: 1, default: 1 },
  melodyLevel: { kind: 'number', min: 0, max: 1, default: 1 },
  chordsLevel: { kind: 'number', min: 0, max: 1, default: 1 },
  chordsDepth: { kind: 'number', min: 0, max: 1, default: 0.2 },
  rainLevel: { kind: 'number', min: 0, max: 1, default: 0 },
  rainSeed: { kind: 'number', integer: true, min: 1, max: 999999, default: 4040, sessionLocked: true },
  volume: { kind: 'number', min: 0, max: 1, default: 0.2 },
  durationMin: { kind: 'number', min: 1, max: 60, default: 15, sessionLocked: true },
  fadeSec: { kind: 'number', min: 1, max: 10, default: 3, sessionLocked: true },
});

/** Parámetros que no pueden cambiar mientras hay una sesión activa (sessionLocked en PARAM_SPEC). */
export const SESSION_LOCKED_KEYS = Object.freeze(
  Object.keys(PARAM_SPEC).filter((k) => PARAM_SPEC[k].sessionLocked),
);

// volume = 1 (100 % en la UI) equivale a esta ganancia lineal: -6 dBFS de pico.
export const MAX_MASTER_GAIN = 0.5;

// Limitador de seguridad al final de la cadena. Con MAX_MASTER_GAIN = 0.5
// la señal normal nunca lo activa; solo protege ante errores.
export const LIMITER = Object.freeze({
  threshold: -3,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.25,
});

export const PAUSE_FADE_SEC = 0.25;
export const STOP_FADE_SEC = 1;
