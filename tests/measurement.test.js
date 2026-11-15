// Fiabilidad del indicador de modulación: nunca declarar "ok" sin modulación real,
// y sí declararla (con valores correctos) cuando la hay. Casos de la auditoría incluidos.
import { describe, expect, it } from 'vitest';
import { amGains, estimateModulation, renderAmTone } from '../src/audio/dsp.js';
import { renderRain } from '../src/audio/generators.js';
import { defaultParams } from '../src/utils/validators.js';

const WIN = 32768; // tamaño real del AnalyserNode
const tone = (sr, over, seconds = 3) =>
  renderAmTone({ ...defaultParams(), volume: 1, carrierHz: 220, ...over }, sr, seconds);

function windows(x, count) {
  const hop = Math.floor((x.length - WIN) / count);
  return Array.from({ length: count }, (_, i) => x.subarray(i * hop, i * hop + WIN));
}

function applyAm(x, sr, fm, depth) {
  const { base, lfo } = amGains({ depth, modulationOn: true });
  const w = (2 * Math.PI * fm) / sr;
  return x.map((v, i) => v * (base + lfo * Math.sin(w * i)));
}

const linearFade = (x) => x.map((v, i) => v * (i / x.length));
const statuses = (ws, sr) => ws.map((w) => estimateModulation(w, sr).status);

describe.each([48000, 96000])('a %i Hz', (sr) => {
  const rains = [1, 4040, 77].map((seed) => renderRain({ seed, sampleRate: sr, seconds: 6 }));

  describe('sin modulación real nunca hay lectura válida', () => {
    it('lluvia sola con A/B desactivado (auditoría: "16,75 Hz · 30 %")', () => {
      for (const x of rains) expect(statuses(windows(x, 12), sr)).not.toContain('ok');
    });

    it('tono sin AM', () => {
      expect(statuses(windows(tone(sr, { modulationOn: false }), 6), sr)).not.toContain('ok');
    });

    it('tono sin AM bajo un fundido lineal (auditoría: "1,50 Hz · 64 %")', () => {
      const x = linearFade(tone(sr, { modulationOn: false }));
      expect(statuses(windows(x, 8), sr)).not.toContain('ok');
    });
  });

  describe('con modulación real la lectura es válida y correcta', () => {
    it.each([
      [40, 0.5],
      [40, 0.05],
      [40, 1],
      [10, 0.2],
      [100, 0.5],
    ])('tono AM %s Hz, profundidad %s', (fm, depth) => {
      for (const w of windows(tone(sr, { modRateHz: fm, depth }), 5)) {
        const m = estimateModulation(w, sr);
        expect(m.status).toBe('ok');
        expect(Math.abs(m.frequency - fm)).toBeLessThan(0.15);
        expect(Math.abs(m.depth - depth)).toBeLessThan(0.03);
      }
    });

    it('tono + lluvia (50/50) con AM 40 Hz al 50 %', () => {
      const t = tone(sr, { modulationOn: false }, 6);
      for (const r of rains) {
        const mix = applyAm(
          r.map((v, i) => 0.5 * v + 0.5 * t[i] * 2),
          sr,
          40,
          0.5,
        );
        for (const w of windows(mix, 6)) {
          const m = estimateModulation(w, sr);
          expect(m.status).toBe('ok');
          expect(Math.abs(m.frequency - 40)).toBeLessThan(0.3);
          expect(Math.abs(m.depth - 0.5)).toBeLessThan(0.06);
        }
      }
    });
  });

  it('una modulación lenta con menos de 3 ciclos en la ventana no se da por válida', () => {
    const fm = sr === 48000 ? 3 : 5; // 0,68 s × 3 Hz ≈ 2 ciclos; 0,34 s × 5 Hz ≈ 1,7
    for (const w of windows(tone(sr, { modRateHz: fm, depth: 0.5 }), 5)) {
      expect(estimateModulation(w, sr).status).not.toBe('ok');
    }
  });

  it('informa la duración de la ventana', () => {
    expect(estimateModulation(tone(sr, {}).subarray(0, WIN), sr).windowSec).toBeCloseTo(WIN / sr, 6);
  });
});
