import { describe, expect, it } from 'vitest';
import {
  compressorMakeupDb,
  countClipped,
  estimateCarrierHz,
  estimateModulation,
  outputGain,
  peakAbs,
  renderAmTone,
} from '../src/audio/dsp.js';
import { LIMITER, MAX_MASTER_GAIN } from '../src/audio/limits.js';
import { defaultParams } from '../src/utils/validators.js';

const SR = 48000;
const params = (over = {}) => ({ ...defaultParams(), carrierHz: 220, modRateHz: 40, depth: 0.5, volume: 1, ...over });

describe('modulación de amplitud', () => {
  it('se mide a 40 Hz', () => {
    const m = estimateModulation(renderAmTone(params(), SR, 1), SR);
    expect(Math.abs(m.frequency - 40)).toBeLessThanOrEqual(0.25);
  });

  it.each([0.1, 0.25, 0.5, 0.8, 1])('recupera la profundidad %s', (depth) => {
    const m = estimateModulation(renderAmTone(params({ depth }), SR, 1), SR);
    expect(Math.abs(m.depth - depth)).toBeLessThan(0.02);
  });

  it.each([
    [40, 0.5, 220, 'sine'],
    [40, 1, 440, 'sine'],
    [37.5, 0.3, 750, 'triangle'], // 2·fc cerca de múltiplos de la tasa decimada
    [100, 0.6, 1000, 'sine'],
    [5, 0.5, 220, 'sine'], // ~3 ciclos en la ventana; por debajo de ~3 Hz no es medible con 0,68 s
  ])('ventana real del analizador (32768 muestras): %s Hz, d=%s, fc=%s %s', (modRateHz, depth, carrierHz, waveform) => {
    const x = renderAmTone(params({ modRateHz, depth, carrierHz, waveform }), SR, 32768 / SR);
    const m = estimateModulation(x, SR);
    expect(Math.abs(m.frequency - modRateHz)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(m.depth - depth)).toBeLessThan(0.03);
  });

  it('no está fija en 40 Hz', () => {
    const m = estimateModulation(renderAmTone(params({ modRateHz: 10 }), SR, 1), SR);
    expect(Math.abs(m.frequency - 10)).toBeLessThanOrEqual(0.25);
  });

  it('funciona con onda triangular', () => {
    const m = estimateModulation(renderAmTone(params({ waveform: 'triangle', depth: 0.7 }), SR, 1), SR);
    expect(Math.abs(m.frequency - 40)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(m.depth - 0.7)).toBeLessThan(0.03);
  });

  it('desactivada (A/B) no deja modulación', () => {
    const m = estimateModulation(renderAmTone(params({ modulationOn: false }), SR, 1), SR);
    expect(m.depth).toBeLessThan(0.01);
  });

  it('detecta silencio', () => {
    expect(estimateModulation(new Float32Array(SR), SR).silent).toBe(true);
  });
});

describe('portadora', () => {
  it.each([110, 220, 440, 997])('mide %s Hz', (carrierHz) => {
    const f = estimateCarrierHz(renderAmTone(params({ carrierHz }), SR, 1), SR);
    expect(Math.abs(f - carrierHz)).toBeLessThan(0.5);
  });

  it('no se confunde con profundidad 100 % (envolvente llega a 0)', () => {
    const f = estimateCarrierHz(renderAmTone(params({ depth: 1 }), SR, 1), SR);
    expect(Math.abs(f - 220)).toBeLessThan(0.5);
  });
});

describe('niveles y clipping', () => {
  it.each(['sine', 'triangle'])('volumen máximo (%s) no supera MAX_MASTER_GAIN ni recorta', (waveform) => {
    const x = renderAmTone(params({ waveform, depth: 1 }), SR, 1);
    expect(peakAbs(x)).toBeLessThanOrEqual(MAX_MASTER_GAIN + 1e-6);
    expect(countClipped(x)).toBe(0);
  });

  it('outputGain recorta valores fuera de rango', () => {
    expect(outputGain(5)).toBe(MAX_MASTER_GAIN);
    expect(outputGain(-1)).toBe(0);
  });

  it('compensa la ganancia automática del limitador (medido en Chrome: +1,7 dB)', () => {
    // threshold −3, ratio 20 → curva(0 dB) = −2,85 dB → makeup = 0,6·2,85 = 1,71 dB
    expect(compressorMakeupDb(LIMITER)).toBeCloseTo(1.71, 2);
    expect(compressorMakeupDb({ threshold: 0, ratio: 20, knee: 0 })).toBeCloseTo(0, 6);
  });

  it('countClipped detecta muestras saturadas', () => {
    expect(countClipped(Float32Array.from([0, 1, -1, 0.5, 1.2]))).toBe(3);
  });
});
