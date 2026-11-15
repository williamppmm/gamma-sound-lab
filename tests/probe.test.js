// Verificación del modulador frente a medir la salida, con material que tiene batidos propios
// (como los acordes de Bruma). La sonda del Modulator produce exactamente g(t) = base + lfo·sin;
// aquí se reproduce esa señal con amGains() y se comprueba que el mismo estimador la mide bien.
import { describe, expect, it } from 'vitest';
import { amGains, estimateModulation, modulatedEnergyShare } from '../src/audio/dsp.js';

const SR = 48000;
const WIN = 32768;

/** g(t) tal como sale de la sonda: constante 1 × (base + lfo·sin(2π·fm·t)). */
function probeSignal({ depth, modRateHz = 40, modulationOn = true, abMatchLoudness = true }) {
  const { base, lfo } = amGains({ depth, modulationOn, abMatchLoudness });
  const w = (2 * Math.PI * modRateHz) / SR;
  return Float32Array.from({ length: WIN }, (_, i) => base + lfo * Math.sin(w * i));
}

/** "Acorde" de dos notas cercanas: su envolvente late a |f1 − f2| (aquí 27 Hz). */
function beatingChord() {
  return Float32Array.from(
    { length: WIN },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 247 * i) / SR),
  );
}

describe('sonda del modulador', () => {
  it.each([0.05, 0.2, 0.5, 1])('mide exactamente 40 Hz y la profundidad %s', (depth) => {
    const m = estimateModulation(probeSignal({ depth }), SR);
    expect(m.status).toBe('ok');
    expect(Math.abs(m.frequency - 40)).toBeLessThan(0.1);
    expect(Math.abs(m.depth - depth)).toBeLessThan(0.01);
  });

  it('con la modulación desactivada (A/B) no indica modulación', () => {
    expect(estimateModulation(probeSignal({ depth: 0.2, modulationOn: false }), SR).status).toBe('none');
  });

  it('con profundidad 0 no indica modulación', () => {
    expect(estimateModulation(probeSignal({ depth: 0 }), SR).status).toBe('none');
  });
});

describe('por qué en música se mide la sonda y no la salida', () => {
  it('un acorde con batidos ya "parece" modulado sin ninguna AM añadida', () => {
    const m = estimateModulation(beatingChord(), SR);
    expect(m.status).toBe('ok'); // lectura falsa: es el batido del propio acorde
    expect(Math.abs(m.frequency - 27)).toBeLessThan(0.5);
  });

  it('con AM real de 40 Hz al 20 %, la salida sigue mostrando el batido y no la AM', () => {
    const { base, lfo } = amGains({ depth: 0.2, modulationOn: true });
    const w = (2 * Math.PI * 40) / SR;
    const x = beatingChord().map((v, i) => v * (base + lfo * Math.sin(w * i)));
    const out = estimateModulation(x, SR);
    expect(Math.abs(out.frequency - 40)).toBeGreaterThan(5);
    const probe = estimateModulation(probeSignal({ depth: 0.2 }), SR);
    expect(probe.frequency).toBeCloseTo(40, 0);
  });
});

describe('modulatedEnergyShare', () => {
  it('reparte la energía según niveles y RMS de las pistas', () => {
    expect(modulatedEnergyShare({ modulatedLevel: 1, modulatedRms: 1, otherLevel: 1, otherRms: 1 })).toBeCloseTo(0.5);
    expect(modulatedEnergyShare({ modulatedLevel: 1, modulatedRms: 0.2, otherLevel: 0, otherRms: 0.2 })).toBe(1);
    expect(modulatedEnergyShare({ modulatedLevel: 0, modulatedRms: 0.2, otherLevel: 1, otherRms: 0.2 })).toBe(0);
    expect(modulatedEnergyShare({ modulatedLevel: 0, modulatedRms: 0, otherLevel: 0, otherRms: 0 })).toBe(0);
  });

  it('con las pistas de Bruma a 100/100 los acordes son ~75 % de la energía', () => {
    // RMS medidos con ffmpeg astats (todos los canales): acordes −13,25 dBFS, melodía −18,07 dBFS
    const share = modulatedEnergyShare({
      modulatedLevel: 1,
      modulatedRms: 10 ** (-13.25 / 20),
      otherLevel: 1,
      otherRms: 10 ** (-18.07 / 20),
    });
    expect(share).toBeGreaterThan(0.74);
    expect(share).toBeLessThan(0.77);
  });
});
