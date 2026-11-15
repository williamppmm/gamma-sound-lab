import { describe, expect, it } from 'vitest';
import { amGains, amRms, channelGains, renderAmTone } from '../src/audio/dsp.js';
import { mulberry32 } from '../src/audio/generators.js';
import { defaultParams } from '../src/utils/validators.js';

const SR = 48000;
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

describe('channelGains (mezclador)', () => {
  it('no reduce mezclas con suma ≤ 1 y reparte proporcionalmente las que pasan de 1', () => {
    expect(channelGains({ tone: 1, rain: 0 })).toEqual({ tone: 1, rain: 0 });
    expect(channelGains({ tone: 0.4, rain: 0.5 })).toEqual({ tone: 0.4, rain: 0.5 });
    expect(channelGains({ tone: 1, rain: 1 })).toEqual({ tone: 0.5, rain: 0.5 });
  });

  it('durante cualquier transición suavizada la suma de ganancias nunca supera 1', () => {
    // Web Audio suaviza cada ganancia por separado con la misma constante de tiempo:
    // en cada instante todas han recorrido la misma fracción α del camino.
    const rand = mulberry32(1);
    let worst = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const a = channelGains({ tone: rand(), rain: rand() * 1.5 });
      const b = channelGains({ tone: rand(), rain: rand() * 1.5 });
      for (let alpha = 0; alpha <= 1; alpha += 0.05) {
        const s = (1 - alpha) * sum(a) + alpha * sum(b);
        worst = Math.max(worst, s);
      }
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('el caso de la auditoría (lluvia 0 → 1 con tono a 1) ya no sobrepasa 1', () => {
    const a = channelGains({ tone: 1, rain: 0 });
    const b = channelGains({ tone: 1, rain: 1 });
    const mid = 0.5 * sum(a) + 0.5 * sum(b);
    expect(mid).toBeLessThanOrEqual(1); // antes: 1,5 × 0,75 = 1,125
  });
});

describe('A/B con igual sonoridad', () => {
  const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  const base = { ...defaultParams(), volume: 1, carrierHz: 220, modRateHz: 40 };

  it.each([0.25, 0.5, 1])('con profundidad %s, modulado y sin modular tienen el mismo RMS', (depth) => {
    const on = rms(renderAmTone({ ...base, depth, modulationOn: true, abMatchLoudness: true }, SR, 1));
    const off = rms(renderAmTone({ ...base, depth, modulationOn: false, abMatchLoudness: true }, SR, 1));
    expect(Math.abs(20 * Math.log10(on / off))).toBeLessThan(0.05);
  });

  it('sin igualar, la diferencia es la teórica (≈ −2,3 dB a 50 %)', () => {
    const on = rms(renderAmTone({ ...base, depth: 0.5, modulationOn: true, abMatchLoudness: false }, SR, 1));
    const off = rms(renderAmTone({ ...base, depth: 0.5, modulationOn: false, abMatchLoudness: false }, SR, 1));
    expect(20 * Math.log10(on / off)).toBeCloseTo(20 * Math.log10(amRms(0.5)), 2);
    expect(20 * Math.log10(amRms(0.5))).toBeCloseTo(-2.26, 2);
  });

  it('igualar la sonoridad nunca sube el pico: la ganancia sin modular es ≤ 1', () => {
    for (let d = 0; d <= 1; d += 0.05) {
      const g = amGains({ depth: d, modulationOn: false, abMatchLoudness: true });
      expect(g.base).toBeLessThanOrEqual(1);
      expect(g.lfo).toBe(0);
    }
  });
});
