import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/audio/generators.js';
import { AMBIENT, colorForLuminance, createAmbientState, musicFeatures, stepAmbient } from '../src/visual/ambient.js';
import {
  createFrameGuard,
  estimateRefreshRate,
  flickerCompatibility,
  lampDiameter,
  lampLuminance,
  lampLuminanceAtOpacity,
  LIGHT,
  luminanceSwing,
  maxFlashesPerSecond,
  opacityForLuminance,
  relativeLuminance,
} from '../src/visual/light.js';

const FPS = 120;

describe('medida de destellos (aproximación a WCAG)', () => {
  const square = (hz, amp, seconds = 2) =>
    Array.from({ length: FPS * seconds }, (_, i) => (Math.floor((2 * hz * i) / FPS) % 2 ? 0.1 + amp : 0.1));

  it('cuenta destellos de alto contraste', () => {
    expect(maxFlashesPerSecond(square(10, 0.5), FPS)).toBeGreaterThanOrEqual(9);
    expect(maxFlashesPerSecond(square(2, 0.5), FPS)).toBeLessThanOrEqual(2);
  });

  it('no cuenta oscilaciones por debajo del umbral de 0,1', () => {
    expect(maxFlashesPerSecond(square(20, 0.09), FPS)).toBe(0);
  });
});

describe('nivel 1: visual ambiental sin destellos', () => {
  function run(featureAt, seconds = 6) {
    let s = createAmbientState();
    const lum = [];
    for (let i = 0; i < FPS * seconds; i++) {
      s = stepAmbient(s, featureAt(i / FPS, i), 1 / FPS);
      lum.push(s.luminance);
    }
    return lum;
  }

  it.each([
    ['AM de 40 Hz a plena escala', (t) => ({ energy: Math.sin(2 * Math.PI * 40 * t) > 0 ? 1 : 0, brightness: 0.5 })],
    ['alternancia en cada fotograma', (_t, i) => ({ energy: i % 2, brightness: i % 2 })],
    ['ruido aleatorio', (() => { const r = mulberry32(3); return () => ({ energy: r(), brightness: r() }); })()],
    ['escalones cada 0,3 s', (t) => ({ energy: Math.floor(t / 0.3) % 2, brightness: 0 })],
    ['pulsos de 3 Hz', (t) => ({ energy: Math.sin(2 * Math.PI * 3 * t) > 0 ? 1 : 0, brightness: 1 })],
  ])('%s: ningún destello', (_name, featureAt) => {
    const lum = run(featureAt);
    expect(maxFlashesPerSecond(lum, FPS)).toBe(0);
    for (const v of lum) {
      expect(v).toBeGreaterThanOrEqual(AMBIENT.minLuminance - 1e-12);
      expect(v).toBeLessThanOrEqual(AMBIENT.maxLuminance + 1e-12);
    }
  });

  it('la velocidad de cambio nunca supera el límite', () => {
    const lum = run((_t, i) => ({ energy: i % 2, brightness: 0 }));
    for (let i = 1; i < lum.length; i++) {
      expect(Math.abs(lum[i] - lum[i - 1])).toBeLessThanOrEqual((AMBIENT.maxSlewPerSec / FPS) * (1 + 1e-9));
    }
  });

  it('sigue a la música: más energía → más brillo', () => {
    const quiet = run(() => ({ energy: 0.1, brightness: 0 })).at(-1);
    const loud = run(() => ({ energy: 0.9, brightness: 0 })).at(-1);
    expect(loud).toBeGreaterThan(quiet + 0.05);
  });

  it('colorForLuminance produce exactamente la luminancia pedida en cualquier tono', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const L of [AMBIENT.minLuminance, 0.05, 0.1, AMBIENT.maxLuminance]) {
        // ±0,5/255 de redondeo por canal → tolerancia pequeña
        expect(Math.abs(relativeLuminance(colorForLuminance(hue, L)) - L)).toBeLessThan(0.004);
      }
    }
  });

  it('musicFeatures normaliza energía y brillo espectral', () => {
    expect(musicFeatures({ rms: 0.05, centroidHz: 150 }, 0.1)).toEqual({ energy: 0.5, brightness: 0 });
    expect(musicFeatures({ rms: 1, centroidHz: 3000 }, 0.1).brightness).toBeCloseTo(1, 9);
    expect(musicFeatures({ rms: 0, centroidHz: 0 }, 0).energy).toBe(0);
  });
});

describe('nivel 2: luz modulada', () => {
  it('con cualquier profundidad permitida queda por debajo del umbral de destello de WCAG', () => {
    for (let d = LIGHT.minDepth; d <= LIGHT.maxDepth + 1e-9; d += 0.01) {
      expect(luminanceSwing(d)).toBeLessThan(LIGHT.flashThreshold);
      const series = Array.from({ length: FPS * 2 }, (_, i) => lampLuminance((40 * i) / FPS, d));
      expect(maxFlashesPerSecond(series, FPS)).toBe(0);
    }
  });

  it('la profundidad se recorta al rango permitido', () => {
    expect(luminanceSwing(5)).toBeCloseTo(LIGHT.maxLuminance * LIGHT.maxDepth, 12);
    expect(luminanceSwing(0)).toBeCloseTo(LIGHT.maxLuminance * LIGHT.minDepth, 12);
  });

  it('la luminancia sigue la misma forma que la AM del sonido', () => {
    expect(lampLuminance(0.25, 0.2)).toBeCloseTo(LIGHT.maxLuminance, 12);
    expect(lampLuminance(0.75, 0.2)).toBeCloseTo(LIGHT.maxLuminance * 0.8, 12);
  });

  it('el color no es rojo saturado y la opacidad reproduce la luminancia pedida', () => {
    const [r, g, b] = LIGHT.color;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40);
    expect(relativeLuminance(LIGHT.color)).toBeGreaterThan(LIGHT.maxLuminance); // alcanzable
    for (const target of [0.05, 0.2, LIGHT.maxLuminance]) {
      expect(lampLuminanceAtOpacity(opacityForLuminance(target))).toBeCloseTo(target, 6);
    }
  });

  it('la lámpara ocupa como máximo el 10 % de la ventana', () => {
    for (const [width, height] of [[375, 667], [1280, 720], [1920, 1080], [3840, 2160], [800, 800]]) {
      const d = lampDiameter({ width, height });
      expect((Math.PI * (d / 2) ** 2) / (width * height)).toBeLessThanOrEqual(LIGHT.maxAreaFraction);
      expect(d).toBeGreaterThan(0);
    }
  });

  describe('compatibilidad de pantalla', () => {
    const ok = (refreshHz, rateHz = 40, extra = {}) => flickerCompatibility({ refreshHz, jitterMs: 0.1, rateHz, ...extra });

    it('60 Hz no es compatible con 40 Hz (aparecerían componentes de 20 Hz)', () => {
      const r = ok(60);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/120 Hz/);
    });

    it('120, 144 y 240 Hz sí lo son', () => {
      expect(ok(120)).toMatchObject({ ok: true, framesPerCycle: 3 });
      expect(ok(144).ok).toBe(true);
      expect(ok(240)).toMatchObject({ ok: true, framesPerCycle: 6 });
    });

    it('rechaza frecuencias fuera de 35–60 Hz aunque la pantalla pueda', () => {
      expect(ok(240, 20).ok).toBe(false);
      expect(ok(240, 10).ok).toBe(false);
      expect(ok(240, 70).ok).toBe(false);
      expect(ok(240, 35).ok).toBe(true);
    });

    it('rechaza fotogramas irregulares, medidas fallidas y "reducir movimiento"', () => {
      expect(flickerCompatibility({ refreshHz: 120, jitterMs: 3, rateHz: 40 }).ok).toBe(false);
      expect(flickerCompatibility({ refreshHz: 0, jitterMs: Infinity, rateHz: 40 }).ok).toBe(false);
      expect(ok(240, 40, { reducedMotion: true }).reason).toMatch(/reducir el movimiento/);
    });

    it('estima la frecuencia de refresco con la mediana', () => {
      const intervals = Array.from({ length: 60 }, (_, i) => (i === 10 ? 40 : 1000 / 120 + (i % 2 ? 0.05 : -0.05)));
      const r = estimateRefreshRate(intervals);
      expect(r.hz).toBeCloseTo(120, 0);
      expect(r.jitterMs).toBeLessThan(0.1);
      expect(estimateRefreshRate([16, 17]).hz).toBe(0);
    });
  });

  it('el vigilante de fotogramas detecta pérdidas repetidas', () => {
    const expected = 1000 / 120;
    const guard = createFrameGuard(expected);
    let state = 'ok';
    for (let i = 0; i < 120; i++) state = guard(expected);
    expect(state).toBe('ok');
    for (let i = 0; i < 6; i++) state = guard(expected * 2);
    expect(state).toBe('irregular');
  });
});
