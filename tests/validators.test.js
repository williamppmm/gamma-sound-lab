import { describe, expect, it } from 'vitest';
import { PARAM_SPEC } from '../src/audio/limits.js';
import { defaultParams, sanitizeParams } from '../src/utils/validators.js';

describe('sanitizeParams', () => {
  it('sin entrada devuelve los valores por defecto', () => {
    expect(sanitizeParams()).toEqual(defaultParams());
  });

  it('los valores por defecto están dentro de sus rangos', () => {
    for (const [key, spec] of Object.entries(PARAM_SPEC)) {
      if (spec.kind !== 'number') continue;
      expect(spec.default, key).toBeGreaterThanOrEqual(spec.min);
      expect(spec.default, key).toBeLessThanOrEqual(spec.max);
    }
  });

  it('recorta números fuera de rango', () => {
    const p = sanitizeParams({ volume: 9, carrierHz: 1, durationMin: 600 });
    expect(p.volume).toBe(PARAM_SPEC.volume.max);
    expect(p.carrierHz).toBe(PARAM_SPEC.carrierHz.min);
    expect(p.durationMin).toBe(PARAM_SPEC.durationMin.max);
  });

  it('valores inválidos conservan el valor base', () => {
    const base = sanitizeParams({ volume: 0.3 });
    const p = sanitizeParams({ volume: NaN, depth: '', waveform: 'sawtooth', modulationOn: 'yes' }, base);
    expect(p.volume).toBe(0.3);
    expect(p.depth).toBe(base.depth);
    expect(p.waveform).toBe(base.waveform);
    expect(p.modulationOn).toBe(base.modulationOn);
  });

  it('redondea parámetros enteros (semilla)', () => {
    expect(sanitizeParams({ rainSeed: 12.7 }).rainSeed).toBe(13);
  });

  it('acepta números como texto', () => {
    expect(sanitizeParams({ modRateHz: '40.5' }).modRateHz).toBe(40.5);
  });

  it('descarta claves desconocidas y devuelve un objeto inmutable', () => {
    const p = sanitizeParams({ hack: 1 });
    expect(p).not.toHaveProperty('hack');
    expect(Object.isFrozen(p)).toBe(true);
  });
});
