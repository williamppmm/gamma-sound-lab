import { describe, expect, it } from 'vitest';
import { estimateModulation, amBaseGain, amLfoGain } from '../src/audio/dsp.js';
import { mulberry32, renderRain } from '../src/audio/generators.js';

const SR = 48000;
const rain = (seed, seconds = 4) => renderRain({ seed, sampleRate: SR, seconds, crossfadeSec: 0.5 });

describe('mulberry32', () => {
  it('es determinista y está en [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 10000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('renderRain', () => {
  it('misma semilla → misma señal; otra semilla → otra señal', () => {
    expect(rain(42)).toEqual(rain(42));
    expect(rain(42)).not.toEqual(rain(43));
  });

  it('tiene la duración pedida, sin NaN, pico exactamente 1', () => {
    const x = rain(1);
    expect(x.length).toBe(4 * SR);
    let peak = 0;
    for (const v of x) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(1, 6);
  });

  it('el bucle no tiene salto en la costura', () => {
    const x = rain(9);
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    const seam = Math.abs(x[0] - x[x.length - 1]);
    expect(seam).toBeLessThanOrEqual(maxStep);
  });

  it('modulada a 40 Hz, la medición detecta 40 Hz', () => {
    const x = rain(3, 2);
    const d = 0.8;
    const wm = (2 * Math.PI * 40) / SR;
    const y = x.map((v, i) => v * (amBaseGain(d) + amLfoGain(d) * Math.sin(wm * i)));
    const m = estimateModulation(y, SR);
    expect(Math.abs(m.frequency - 40)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(m.depth - d)).toBeLessThan(0.1); // ruido → estimación menos exacta que con tono
  });
});
