// Luz modulada (nivel 2, experimental). Funciones puras: toda la lógica de seguridad
// está aquí y se prueba en Node. Ver docs/estimulacion-visual.md.
//
// Criterio de diseño: quedar por debajo del umbral general de destellos de WCAG 2.x
// (un "destello" exige un cambio de luminancia relativa ≥ 0,1) y en área pequeña
// (≤ 10 % de la ventana), con frecuencias fuera de la banda más provocadora.
// Esto reduce el riesgo; no lo elimina.

export const LIGHT = Object.freeze({
  color: [223, 243, 238], // blanco verdoso de baja saturación (sin rojo saturado)
  background: [8, 10, 14], // fondo fijo bajo la lámpara (los cálculos de luminancia dependen de él)
  maxLuminance: 0.3, // luminancia relativa máxima del centro de la lámpara
  minDepth: 0.05,
  maxDepth: 0.3,
  defaultDepth: 0.15,
  minRateHz: 35, // fuera de la banda más provocadora (≈ 10–30 Hz)
  maxRateHz: 60,
  minFramesPerCycle: 3, // la pantalla debe dibujar ≥ 3 fotogramas por ciclo (sin aliasing a frecuencias bajas)
  maxJitterMs: 1, // variación máxima admitida en el intervalo entre fotogramas
  maxAreaFraction: 0.1,
  maxMinutes: 10,
  flashThreshold: 0.1, // WCAG: cambio de luminancia relativa que cuenta como destello
});

// ---- Luminancia (sRGB → relativa, WCAG) --------------------------------------------

export function srgbToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Luminancia relativa de la lámpara con opacidad `alpha` sobre su fondo. Los navegadores
 * componen la opacidad en espacio sRGB (no lineal), así que se calcula sobre el color mezclado.
 */
export function lampLuminanceAtOpacity(alpha) {
  const mix = LIGHT.background.map((bg, i) => bg + alpha * (LIGHT.color[i] - bg));
  return relativeLuminance(mix);
}

/** Opacidad que produce la luminancia pedida (bisección: la función es monótona). */
export function opacityForLuminance(target) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (lampLuminanceAtOpacity(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const clampDepth = (depth) => Math.min(LIGHT.maxDepth, Math.max(LIGHT.minDepth, depth));

/**
 * Luminancia en una fase del ciclo (0–1), con la misma forma que la AM del sonido:
 * L = Lmax·((1 − d/2) + (d/2)·sin 2πφ), entre Lmax·(1 − d) y Lmax. Senoidal: sin armónicos bruscos.
 */
export function lampLuminance(phase, depth) {
  const d = clampDepth(depth);
  return LIGHT.maxLuminance * (1 - d / 2 + (d / 2) * Math.sin(2 * Math.PI * phase));
}

/** Variación total de luminancia relativa con esa profundidad. */
export const luminanceSwing = (depth) => LIGHT.maxLuminance * clampDepth(depth);

// ---- Geometría ---------------------------------------------------------------------

/** Diámetro de la lámpara circular: como máximo maxAreaFraction de la ventana. */
export function lampDiameter({ width, height }) {
  const byArea = 2 * Math.sqrt((LIGHT.maxAreaFraction * width * height) / Math.PI);
  return Math.floor(Math.min(byArea, 0.6 * Math.min(width, height)));
}

// ---- Pantalla y compatibilidad ------------------------------------------------------

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Frecuencia de refresco a partir de intervalos entre fotogramas (ms). Periodo = media de los
 * intervalos típicos (a menos de 1 ms de la mediana; descarta fotogramas perdidos);
 * dispersión = desviación absoluta mediana (MAD).
 */
export function estimateRefreshRate(intervalsMs) {
  const valid = intervalsMs.filter((v) => Number.isFinite(v) && v > 0);
  if (valid.length < 20) return { hz: 0, jitterMs: Infinity, samples: valid.length };
  const med = median(valid);
  const typical = valid.filter((v) => Math.abs(v - med) < 1);
  const period = typical.reduce((a, v) => a + v, 0) / typical.length;
  const jitterMs = median(valid.map((v) => Math.abs(v - med)));
  return { hz: 1000 / period, jitterMs, samples: valid.length };
}

/**
 * ¿Se puede mostrar la luz a `rateHz` en esta pantalla?
 * @returns {{ ok, framesPerCycle, reason }}
 */
export function flickerCompatibility({ refreshHz, jitterMs, rateHz, reducedMotion = false }) {
  const fail = (reason) => ({ ok: false, framesPerCycle: refreshHz / rateHz || 0, reason });
  if (reducedMotion) return fail('El sistema pide reducir el movimiento: la luz modulada está desactivada.');
  if (!(rateHz >= LIGHT.minRateHz && rateHz <= LIGHT.maxRateHz)) {
    return fail(`La luz solo se ofrece entre ${LIGHT.minRateHz} y ${LIGHT.maxRateHz} Hz (fuera de la banda más provocadora).`);
  }
  if (!(refreshHz > 0) || !Number.isFinite(jitterMs)) return fail('No se pudo medir la frecuencia de la pantalla.');
  if (jitterMs > LIGHT.maxJitterMs) {
    return fail(`Los fotogramas de la pantalla son irregulares (±${jitterMs.toFixed(1)} ms): el parpadeo no sería estable.`);
  }
  const framesPerCycle = refreshHz / rateHz;
  if (framesPerCycle < LIGHT.minFramesPerCycle) {
    return fail(
      `Pantalla de ${Math.round(refreshHz)} Hz: no es compatible con ${rateHz} Hz (necesita al menos ` +
        `${Math.ceil(rateHz * LIGHT.minFramesPerCycle)} Hz; con menos aparecerían parpadeos a frecuencias más bajas y más provocadoras).`,
    );
  }
  return { ok: true, framesPerCycle, reason: '' };
}

/**
 * ¿Hay que apagar la luz activa? Se evalúa ante cualquier cambio (sesión, parámetros, ventana,
 * preferencias). Criterio conservador: cualquier cambio de las condiciones con las que se
 * comprobó la seguridad la apaga; volver a activarla repite consentimiento y medición.
 * @param start  condiciones al activarla { rateHz, viewport: { width, height } }
 * @param now    condiciones actuales { state, modulationOn, rateHz, reducedMotion, viewport, hidden }
 * @returns motivo (texto) o null si puede seguir
 */
export function lightStopReason(start, now) {
  if (now.reducedMotion) return 'Luz detenida: el sistema pide reducir el movimiento.';
  if (now.hidden) return 'Luz detenida: la ventana dejó de estar visible.';
  if (now.state !== 'playing') return 'Luz detenida: la sesión no está sonando.';
  if (!now.modulationOn) return 'Luz detenida: la modulación se desactivó (A/B).';
  if (now.rateHz !== start.rateHz) {
    return 'Luz detenida: cambió la frecuencia. Vuelve a activarla para comprobar de nuevo la pantalla.';
  }
  if (now.viewport.width !== start.viewport.width || now.viewport.height !== start.viewport.height) {
    return 'Luz detenida: cambió el tamaño de la ventana (la lámpara debe ocupar ≤ 10 % de la pantalla).';
  }
  return null;
}

/**
 * Vigila los fotogramas durante el parpadeo. Un fotograma perdido alarga el ciclo y crea
 * componentes de baja frecuencia: si pasa con frecuencia, hay que detener la luz.
 * @returns push(intervalMs) → 'ok' | 'irregular'
 */
export function createFrameGuard(expectedMs, { windowFrames = 120, maxIrregularFraction = 0.02 } = {}) {
  const recent = [];
  return (intervalMs) => {
    recent.push(intervalMs > expectedMs * 1.5);
    if (recent.length > windowFrames) recent.shift();
    if (recent.length < windowFrames / 4) return 'ok';
    const irregular = recent.filter(Boolean).length / recent.length;
    return irregular > maxIrregularFraction ? 'irregular' : 'ok';
  };
}

// ---- Medida de destellos (aproximación a la definición de WCAG) -----------------------

/**
 * Máximo de destellos en cualquier ventana de 1 s. Un destello es un par de cambios opuestos
 * de luminancia relativa ≥ threshold (con el estado más oscuro < 0,8).
 * @param luminances serie de luminancias relativas, una por fotograma
 */
export function maxFlashesPerSecond(luminances, fps, threshold = LIGHT.flashThreshold) {
  if (luminances.length < 2) return 0;
  // Extremos locales con histéresis: se ignoran oscilaciones menores que el umbral.
  const extremes = [];
  let dir = 0; // 0: aún sin dirección; 1: subiendo; −1: bajando
  let lo = { i: 0, v: luminances[0] };
  let hi = { i: 0, v: luminances[0] };
  let cand = null;
  for (let i = 1; i < luminances.length; i++) {
    const p = { i, v: luminances[i] };
    if (dir === 0) {
      if (p.v < lo.v) lo = p;
      if (p.v > hi.v) hi = p;
      if (p.v - lo.v >= threshold) {
        extremes.push(lo);
        dir = 1;
        cand = p;
      } else if (hi.v - p.v >= threshold) {
        extremes.push(hi);
        dir = -1;
        cand = p;
      }
    } else if (dir === 1) {
      if (p.v > cand.v) cand = p;
      else if (cand.v - p.v >= threshold) {
        extremes.push(cand);
        dir = -1;
        cand = p;
      }
    } else if (p.v < cand.v) cand = p;
    else if (p.v - cand.v >= threshold) {
      extremes.push(cand);
      dir = 1;
      cand = p;
    }
  }
  if (cand) extremes.push(cand);
  // Cambios entre extremos consecutivos que cumplen el criterio.
  const changes = [];
  for (let k = 1; k < extremes.length; k++) {
    const a = extremes[k - 1];
    const b = extremes[k];
    if (Math.abs(b.v - a.v) >= threshold && Math.min(a.v, b.v) < 0.8) changes.push(b.i);
  }
  let max = 0;
  let start = 0;
  for (let end = 0; end < changes.length; end++) {
    while (changes[end] - changes[start] >= fps) start++;
    max = Math.max(max, Math.floor((end - start + 1) / 2));
  }
  return max;
}
