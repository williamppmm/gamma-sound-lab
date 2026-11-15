// Funciones puras de DSP: sin Web Audio, sin DOM. Se usan en el motor,
// en el analizador del navegador y en las pruebas (Node).
import { MAX_MASTER_GAIN } from './limits.js';

// ---- Modulación de amplitud ------------------------------------------------
// Ganancia AM: g(t) = (1 - d/2) + (d/2)·sin(2π·fm·t)  →  oscila entre 1-d y 1.
// El motor implementa exactamente esto con un GainNode (base) + LFO (amplitud).

export const effectiveDepth = ({ depth, modulationOn }) => (modulationOn ? depth : 0);
export const amBaseGain = (depth) => 1 - depth / 2;
export const amLfoGain = (depth) => depth / 2;
export const outputGain = (volume) => Math.min(Math.max(volume, 0), 1) * MAX_MASTER_GAIN;

const WAVES = {
  sine: (ph) => Math.sin(ph),
  triangle: (ph) => (2 / Math.PI) * Math.asin(Math.sin(ph)),
};

/** Renderiza en memoria la misma señal que produce el motor (sin fundidos). */
export function renderAmTone(params, sampleRate, seconds) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  const wave = WAVES[params.waveform] ?? WAVES.sine;
  const d = effectiveDepth(params);
  const base = amBaseGain(d);
  const lfo = amLfoGain(d);
  const g = outputGain(params.volume);
  const wc = (2 * Math.PI * params.carrierHz) / sampleRate;
  const wm = (2 * Math.PI * params.modRateHz) / sampleRate;
  for (let i = 0; i < n; i++) {
    out[i] = g * (base + lfo * Math.sin(wm * i)) * wave(wc * i);
  }
  return out;
}

// ---- Limitador -----------------------------------------------------------------

/**
 * Ganancia de compensación ("makeup") que DynamicsCompressorNode aplica siempre,
 * según la especificación de Web Audio: (1 / curva(1.0))^0.6.
 * Solo válido para knee = 0 (curva de rodilla dura). Devuelve dB (≥ 0).
 */
export function compressorMakeupDb({ threshold, ratio, knee }) {
  if (knee !== 0) throw new Error('compressorMakeupDb solo admite knee = 0');
  const fullRangeGainDb = threshold < 0 ? threshold + -threshold / ratio : 0;
  return -0.6 * fullRangeGainDb;
}

// ---- Medición ----------------------------------------------------------------

export function peakAbs(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export function countClipped(x, threshold = 1) {
  let c = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= threshold) c++;
  return c;
}

export const toDbfs = (amplitude) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);

/** Magnitud |X(f)| por el algoritmo de Goertzel (admite frecuencias no enteras). */
function goertzelMagnitude(y, sampleRate, freq) {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < y.length; i++) {
    const s = y[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2));
}

/**
 * Estima frecuencia y profundidad de una modulación AM senoidal.
 *
 * Método: x² contiene la envolvente al cuadrado. Para A(t) = a + b·sin(ωm·t),
 * la parte de baja frecuencia de x² es A²/2, cuya media es (a² + b²/2)/2 y
 * cuya componente en fm tiene amplitud a·b. Con r = amplitud(fm) / media se
 * despeja k = b/a y de ahí la profundidad d = 2k / (1 + k).
 * Se usa ventana de Hann para tolerar ventanas sin ciclos enteros.
 */
export function estimateModulation(x, sampleRate, { minHz = 1, maxHz = 100, stepHz = 0.25 } = {}) {
  const n = x.length;
  if (n < 16) return { frequency: 0, depth: 0, silent: true };

  const w = new Float64Array(n);
  let sumW = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const wi = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    w[i] = wi;
    sumW += wi;
    acc += wi * x[i] * x[i];
  }
  const dc = acc / sumW;
  if (dc < 1e-12) return { frequency: 0, depth: 0, silent: true };

  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = w[i] * (x[i] * x[i] - dc);

  let bestF = minHz;
  let bestMag = -1;
  for (let f = minHz; f <= maxHz + 1e-9; f += stepHz) {
    const mag = goertzelMagnitude(y, sampleRate, f);
    if (mag > bestMag) {
      bestMag = mag;
      bestF = f;
    }
  }

  const r = (2 * bestMag) / sumW / dc;
  const k = r < 1e-9 ? 0 : (2 - Math.sqrt(Math.max(0, 4 - 2 * r * r))) / r;
  const depth = Math.min(1, (2 * k) / (1 + k));
  return { frequency: bestF, depth, silent: false };
}

/** Frecuencia de la portadora por cruces ascendentes por cero (interpolados). */
export function estimateCarrierHz(x, sampleRate) {
  let first = -1;
  let last = -1;
  let count = 0;
  let prevSign = 0;
  let prevVal = 0;
  let prevIdx = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v === 0) continue; // ignora ceros exactos (p. ej. envolvente = 0)
    const sign = v > 0 ? 1 : -1;
    if (prevSign < 0 && sign > 0) {
      const pos = prevIdx + ((i - prevIdx) * -prevVal) / (v - prevVal);
      if (first < 0) first = pos;
      last = pos;
      count++;
    }
    prevSign = sign;
    prevVal = v;
    prevIdx = i;
  }
  if (count < 2 || last <= first) return 0;
  return ((count - 1) * sampleRate) / (last - first);
}
