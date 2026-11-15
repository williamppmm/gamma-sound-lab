// Funciones puras de DSP: sin Web Audio, sin DOM. Se usan en el motor,
// en el analizador del navegador y en las pruebas (Node).
import { MAX_MASTER_GAIN } from './limits.js';

// ---- Modulación de amplitud ------------------------------------------------
// Ganancia AM: g(t) = (1 - d/2) + (d/2)·sin(2π·fm·t)  →  oscila entre 1-d y 1.
// El motor implementa exactamente esto con un GainNode (base) + LFO (amplitud).

export const amBaseGain = (depth) => 1 - depth / 2;
export const amLfoGain = (depth) => depth / 2;
export const outputGain = (volume) => Math.min(Math.max(volume, 0), 1) * MAX_MASTER_GAIN;

/** RMS de la ganancia AM g(t) con profundidad d: √((1 − d/2)² + (d/2)²/2). */
export const amRms = (depth) => Math.sqrt(amBaseGain(depth) ** 2 + amLfoGain(depth) ** 2 / 2);

/**
 * Ganancias del modulador. Con la modulación desactivada (lado B del A/B) y
 * abMatchLoudness, la ganancia fija es el RMS de la versión modulada, para que
 * A y B solo difieran en la modulación y no en sonoridad. Siempre ≤ 1: no sube el pico.
 */
export function amGains({ depth, modulationOn, abMatchLoudness }) {
  if (modulationOn) return { base: amBaseGain(depth), lfo: amLfoGain(depth) };
  return { base: abMatchLoudness ? amRms(depth) : 1, lfo: 0 };
}

/**
 * Ganancia de cada canal del mezclador: nivel / max(1, suma de niveles).
 * Como cada fuente tiene pico ≤ 1, la mezcla nunca pasa de 1. Se aplica por canal
 * (y no como un nodo de normalización aparte) para que, al suavizar los cambios,
 * la suma interpolada tampoco pueda superar 1 en ningún instante.
 */
export function channelGains(levels) {
  const total = Object.values(levels).reduce((a, b) => a + b, 0);
  const k = total > 1 ? 1 / total : 1;
  return Object.fromEntries(Object.entries(levels).map(([name, level]) => [name, level * k]));
}

/**
 * Fracción aproximada de la energía de la mezcla que pasa por el modulador, cuando solo
 * se modula un canal (p. ej. los acordes de Bruma). Usa el RMS de cada pista y los niveles
 * del mezclador; la normalización de channelGains afecta a todos los canales por igual.
 */
export function modulatedEnergyShare({ modulatedLevel, modulatedRms, otherLevel, otherRms }) {
  const em = (modulatedLevel * modulatedRms) ** 2;
  const eo = (otherLevel * otherRms) ** 2;
  return em + eo > 0 ? em / (em + eo) : 0;
}

const WAVES = {
  sine: (ph) => Math.sin(ph),
  triangle: (ph) => (2 / Math.PI) * Math.asin(Math.sin(ph)),
};

/** Renderiza en memoria la misma señal que produce el motor (sin fundidos). */
export function renderAmTone(params, sampleRate, seconds) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  const wave = WAVES[params.waveform] ?? WAVES.sine;
  const { base, lfo } = amGains(params);
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
 *
 * Fiabilidad: el máximo del espectro siempre existe, haya modulación o no. Por eso
 * la lectura solo se declara válida (status 'ok') si:
 *  - la energía es estable en la ventana (sin fundidos ni cambios bruscos): drift,
 *  - el pico destaca del fondo espectral: contrast = pico / mediana fuera del lóbulo,
 *  - la profundidad supera un mínimo, y
 *  - caben al menos MOD_DETECTION.minCycles ciclos en la ventana.
 * status: 'ok' | 'silent' | 'unstable' | 'none' | 'short'
 */
export function estimateModulation(x, sampleRate, { minHz = 1, maxHz = 100, stepHz = 0.25 } = {}) {
  const n = x.length;
  const windowSec = n / sampleRate;
  const result = (status, extra = {}) => ({
    frequency: 0,
    depth: 0,
    contrast: 0,
    drift: 0,
    ...extra,
    status,
    silent: status === 'silent',
    windowSec,
  });
  if (n < 16) return result('silent');

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
  if (dc < 1e-12) return result('silent');

  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) y[i] = w[i] * (z[i] - dc);

  const magAt = (f) => goertzelMagnitude(y, fs, f) / cicGain(f, d, sampleRate);
  const freqs = [];
  const mags = [];
  let bi = 0;
  for (let f = minHz; f <= maxHz + 1e-9; f += stepHz) {
    freqs.push(f);
    mags.push(magAt(f));
    if (mags[mags.length - 1] > mags[bi]) bi = mags.length - 1;
  }

  // Refinado parabólico del pico entre puntos de la rejilla.
  let frequency = freqs[bi];
  let peak = mags[bi];
  if (bi > 0 && bi < mags.length - 1) {
    const [a, b, c] = [mags[bi - 1], mags[bi], mags[bi + 1]];
    const den = a - 2 * b + c;
    if (den < 0) {
      const f = freqs[bi] + ((0.5 * (a - c)) / den) * stepHz;
      const mag = magAt(f);
      if (mag >= peak) [frequency, peak] = [f, mag];
    }
  }

  // Contraste: pico frente a la mediana del espectro fuera del lóbulo principal (Hann: ±2/T).
  const lobeHz = 3 / windowSec;
  const floor = median(mags.filter((_, i) => Math.abs(freqs[i] - frequency) > lobeHz));
  const contrast = floor > 0 ? peak / floor : Infinity;

  const r = (2 * peak) / sumW / dc;
  const k = r < 1e-9 ? 0 : (2 - Math.sqrt(Math.max(0, 4 - 2 * r * r))) / r;
  const depth = Math.min(1, (2 * k) / (1 + k));
  const drift = residualDrift(z, y, sumW, (2 * Math.PI * frequency) / fs);

  // Orden: primero "¿hay modulación clara?" (la lluvia tiene deriva propia y no debe
  // aparecer como transición), después estabilidad, y por último ciclos suficientes.
  const measured = { frequency, depth, contrast, drift };
  const D = MOD_DETECTION;
  if (contrast < D.minContrast || depth < D.minDepth) return result('none', measured);
  if (drift > D.maxDrift) return result('unstable', measured);
  if (frequency * windowSec < D.minCycles) return result('short', measured);
  return result('ok', measured);
}

/**
 * Deriva de la energía en la ventana: pendiente por mínimos cuadrados de z, relativa
 * a su media, tras restar la componente senoidal detectada (así una modulación lenta
 * con un ciclo incompleto no se confunde con un fundido).
 */
function residualDrift(z, y, sumW, omega) {
  const m = z.length;
  let xr = 0;
  let xi = 0;
  for (let i = 0; i < m; i++) {
    xr += y[i] * Math.cos(omega * i);
    xi -= y[i] * Math.sin(omega * i);
  }
  const ar = (2 / sumW) * xr;
  const ai = (2 / sumW) * xi;
  let mean = 0;
  const res = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    res[i] = z[i] - (ar * Math.cos(omega * i) - ai * Math.sin(omega * i));
    mean += res[i];
  }
  mean /= m;
  if (mean <= 1e-12) return 0;
  let sxy = 0;
  let sxx = 0;
  const ic = (m - 1) / 2;
  for (let i = 0; i < m; i++) {
    sxy += (i - ic) * (res[i] - mean);
    sxx += (i - ic) ** 2;
  }
  return Math.abs((sxy / sxx) * (m - 1)) / mean;
}

/** Umbrales de validez de la medición AM (calibrados con tono, lluvia, mezclas y fundidos a 48 y 96 kHz). */
export const MOD_DETECTION = Object.freeze({
  minContrast: 8,
  minDepth: 0.03,
  maxDrift: 0.2,
  minCycles: 3,
});

function median(values) {
  if (values.length === 0) return 0;
  const s = Float64Array.from(values).sort();
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
