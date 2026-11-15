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

/**
 * Ganancia de salida del mezclador: si la suma de niveles supera 1 se reduce
 * proporcionalmente. Como cada fuente tiene pico ≤ 1, la mezcla nunca pasa de 1.
 */
export const mixNormalization = (levels) => {
  const sum = levels.reduce((a, b) => a + b, 0);
  return sum > 1 ? 1 / sum : 1;
};

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

// Decimación CIC: CIC_ORDER medias móviles de longitud D y luego 1 de cada D muestras.
// Ceros de la respuesta en múltiplos de sampleRate/D → atenúa fuertemente lo que se replegaría.
const CIC_ORDER = 3;

function boxcarValid(x, d) {
  const n = x.length - d + 1;
  if (n <= 0) return new Float64Array(0);
  const y = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < d; i++) s += x[i];
  y[0] = s / d;
  for (let i = 1; i < n; i++) {
    s += x[i + d - 1] - x[i - 1];
    y[i] = s / d;
  }
  return y;
}

function decimate(x, d) {
  let y = x;
  for (let k = 0; k < CIC_ORDER; k++) y = boxcarValid(y, d);
  const m = Math.floor(y.length / d);
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) out[i] = y[i * d];
  return out;
}

/** Ganancia del filtro CIC a la frecuencia f (para compensar su caída en la banda útil). */
function cicGain(f, d, sampleRate) {
  if (d <= 1 || f === 0) return 1;
  const g = Math.sin((Math.PI * f * d) / sampleRate) / (d * Math.sin((Math.PI * f) / sampleRate));
  return Math.abs(g) ** CIC_ORDER;
}

/**
 * Estima frecuencia y profundidad de una modulación AM senoidal.
 *
 * Método: x² contiene la envolvente al cuadrado. Para A(t) = a + b·sin(ωm·t),
 * la parte de baja frecuencia de x² es A²/2, cuya media es (a² + b²/2)/2 y
 * cuya componente en fm tiene amplitud a·b. Con r = amplitud(fm) / media se
 * despeja k = b/a y de ahí la profundidad d = 2k / (1 + k).
 *
 * Rendimiento: solo interesa x² por debajo de maxHz, así que se decima con un
 * filtro CIC hasta ~8·maxHz (48 kHz → 800 Hz, factor 60) antes de buscar con
 * Goertzel. Se compensa la caída del CIC y se usa ventana de Hann para tolerar
 * ventanas sin ciclos enteros. Con 32768 muestras: ~25 ms → < 1 ms.
 */
export function estimateModulation(x, sampleRate, { minHz = 1, maxHz = 100, stepHz = 0.25 } = {}) {
  const n = x.length;
  if (n < 16) return { frequency: 0, depth: 0, silent: true };

  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) sq[i] = x[i] * x[i];

  let d = Math.max(1, Math.floor(sampleRate / (8 * maxHz)));
  if (n / d < 64) d = 1; // ventana demasiado corta para decimar
  const z = d > 1 ? decimate(sq, d) : sq;
  const fs = sampleRate / d;
  const m = z.length;

  let sumW = 0;
  let acc = 0;
  const w = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const wi = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (m - 1));
    w[i] = wi;
    sumW += wi;
    acc += wi * z[i];
  }
  const dc = acc / sumW;
  if (dc < 1e-12) return { frequency: 0, depth: 0, silent: true };

  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) y[i] = w[i] * (z[i] - dc);

  let bestF = minHz;
  let bestMag = -1;
  for (let f = minHz; f <= maxHz + 1e-9; f += stepHz) {
    const mag = goertzelMagnitude(y, fs, f) / cicGain(f, d, sampleRate);
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
