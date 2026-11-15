// Visual ambiental (nivel 1): un campo de luz que "respira" con la música, sin destellos.
// Funciones puras. Los cambios de brillo se filtran (paso bajo) y se limitan en velocidad,
// de modo que ninguna entrada (ni siquiera una AM de 40 Hz) puede producir parpadeo.

export const AMBIENT = Object.freeze({
  levelTauSec: 0.6, // constante de tiempo del brillo (corte ≈ 0,27 Hz)
  hueTauSec: 2.5, // el color cambia aún más despacio
  maxSlewPerSec: 0.25, // como mucho 0,25 de luminancia relativa por segundo
  minLuminance: 0.01, // reposo: casi oscuro
  maxLuminance: 0.18, // brillo máximo del campo (luminancia relativa)
  hueRange: [175, 285], // turquesa → violeta según el brillo espectral
});

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createAmbientState() {
  return { luminance: AMBIENT.minLuminance, hue: AMBIENT.hueRange[0] };
}

/**
 * Avanza el estado un fotograma.
 * @param features { energy: 0–1 (nivel relativo de la música), brightness: 0–1 (centroide espectral) }
 * @param dt segundos desde el fotograma anterior
 */
export function stepAmbient(state, { energy, brightness }, dt) {
  const t = Math.max(0, Math.min(dt, 0.25)); // tras una pausa larga no hay saltos
  const target = AMBIENT.minLuminance + clamp01(energy) * (AMBIENT.maxLuminance - AMBIENT.minLuminance);
  const smoothed = state.luminance + (1 - Math.exp(-t / AMBIENT.levelTauSec)) * (target - state.luminance);
  const maxStep = AMBIENT.maxSlewPerSec * t;
  const luminance = state.luminance + Math.max(-maxStep, Math.min(maxStep, smoothed - state.luminance));

  const [h0, h1] = AMBIENT.hueRange;
  const hueTarget = h0 + clamp01(brightness) * (h1 - h0);
  const hue = state.hue + (1 - Math.exp(-t / AMBIENT.hueTauSec)) * (hueTarget - state.hue);
  return { luminance, hue };
}

/**
 * Rasgos de la música a partir de un análisis por fotograma.
 * `reference` es un nivel de referencia que se adapta despacio (el brillo sigue la dinámica
 * de la pieza, no el volumen absoluto).
 */
export function musicFeatures({ rms, centroidHz }, reference) {
  const energy = reference > 1e-6 ? clamp01(rms / reference) : 0;
  // Centroide en escala logarítmica: 150 Hz → 0, 3 kHz → 1.
  const brightness = centroidHz > 0 ? clamp01(Math.log(centroidHz / 150) / Math.log(3000 / 150)) : 0;
  return { energy, brightness };
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Color sRGB (0–255) con el tono pedido y exactamente la luminancia relativa indicada
 * (si es alcanzable). Así el brillo que se ve es el que controla stepAmbient.
 */
export function colorForLuminance(hue, luminance) {
  // Tono base a saturación moderada, en luz lineal.
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = 0.55;
  const x = s * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = [
    [s, x, 0], [x, s, 0], [0, s, x], [0, x, s], [x, 0, s], [s, 0, x],
  ][Math.floor(h) % 6].map((c) => c + (1 - s) * 0.5);
  const lin = [r, g, b].map(toLinear);
  const baseLum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const L = Math.min(1, Math.max(0, luminance));
  const scaled = lin.map((c) => c * (L / baseLum));
  // Si algún canal pasa de 1, se mezcla con el gris de la misma luminancia (que la conserva)
  // lo justo para que quepa: se pierde algo de saturación, nunca la luminancia pedida.
  const t = Math.max(0, ...scaled.map((c) => (c > 1 ? (c - 1) / (c - L) : 0)));
  return scaled.map((c) => Math.round(255 * toSrgb(Math.min(1, (1 - t) * c + t * L))));
}

/** Referencia adaptativa: sube de inmediato y baja con constante de 8 s. */
export function nextReference(reference, rms, dt) {
  return Math.max(rms, reference * Math.exp(-dt / 8), 1e-5);
}
