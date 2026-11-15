// Generadores puros (sin Web Audio): producen Float32Array deterministas a partir de una semilla.

/** PRNG Mulberry32: rápido, 32 bits, reproducible. Devuelve valores en [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lluvia sintética en bucle sin costuras.
 *  - Lecho: ruido rosa (filtro de Paul Kellet) con un paso bajo suave e intensidad que deriva lentamente.
 *  - Gotas: eventos de Poisson; cada gota es una senoide amortiguada breve de frecuencia aleatoria.
 *  - Bucle: se renderiza `seconds + crossfadeSec` y la cola se funde (potencia constante)
 *    sobre el inicio, de modo que el final enlaza con el principio.
 * Resultado normalizado a pico 1.
 */
export function renderRain({
  seed,
  sampleRate,
  seconds = 20,
  crossfadeSec = 1,
  dropsPerSec = 30,
}) {
  const rand = mulberry32(seed);
  const n = Math.round(sampleRate * seconds);
  const cf = Math.round(sampleRate * crossfadeSec);
  const total = n + cf;
  const x = new Float32Array(total);

  // Lecho de ruido rosa
  let b0 = 0, b1 = 0, b2 = 0, lp = 0;
  const lpCoef = 1 - Math.exp((-2 * Math.PI * 4500) / sampleRate);
  // Deriva lenta de intensidad: dos senoides lentas con fase aleatoria
  const p1 = rand() * 2 * Math.PI, p2 = rand() * 2 * Math.PI;
  const w1 = (2 * Math.PI * 0.07) / sampleRate, w2 = (2 * Math.PI * 0.19) / sampleRate;
  for (let i = 0; i < total; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = b0 + b1 + b2 + white * 0.1848;
    lp += lpCoef * (pink - lp);
    const drift = 0.8 + 0.12 * Math.sin(w1 * i + p1) + 0.08 * Math.sin(w2 * i + p2);
    x[i] = lp * 0.12 * drift;
  }

  // Gotas
  let t = 0;
  for (;;) {
    t += (-Math.log(1 - rand()) / dropsPerSec) * sampleRate;
    const start = Math.floor(t);
    if (start >= total) break;
    const freq = 1200 + rand() * 4200;
    const decay = (0.002 + rand() * 0.007) * sampleRate; // constante de tiempo en muestras
    const amp = 0.08 + 0.5 * rand() ** 3;
    const len = Math.min(Math.ceil(decay * 6), total - start);
    const w = (2 * Math.PI * freq) / sampleRate;
    for (let k = 0; k < len; k++) {
      x[start + k] += amp * Math.exp(-k / decay) * Math.sin(w * k);
    }
  }

  // Bucle: fundido de potencia constante de la cola sobre la cabeza
  const out = x.slice(0, n);
  for (let i = 0; i < cf; i++) {
    const th = (Math.PI / 2) * (i / cf);
    out[i] = x[i] * Math.sin(th) + x[n + i] * Math.cos(th);
  }

  // Normalizar a pico 1
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}
