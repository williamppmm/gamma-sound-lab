// Fuente única de verdad para rangos de parámetros y límites de seguridad.
// La UI, los validadores, el motor y las pruebas leen de aquí.

export const PARAM_SPEC = Object.freeze({
  carrierHz: { kind: 'number', min: 100, max: 1000, default: 220 },
  waveform: { kind: 'enum', values: ['sine', 'triangle'], default: 'sine' },
  modRateHz: { kind: 'number', min: 1, max: 100, default: 40 },
  depth: { kind: 'number', min: 0, max: 1, default: 0.5 },
  modulationOn: { kind: 'boolean', default: true },
  volume: { kind: 'number', min: 0, max: 1, default: 0.2 },
  durationMin: { kind: 'number', min: 1, max: 60, default: 15 },
  fadeSec: { kind: 'number', min: 1, max: 10, default: 3 },
});

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
