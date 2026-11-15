import { describe, expect, it } from 'vitest';
import { amGains, outputGain, renderAmTone } from '../src/audio/dsp.js';
import { MAX_MASTER_GAIN } from '../src/audio/limits.js';
import { exportFileName, expectedModulation, planExport, verifyExport } from '../src/export/exportPlan.js';
import { decodeWav, encodeWav } from '../src/export/wav.js';
import { sanitizeParams } from '../src/utils/validators.js';

const SR = 48000;

describe('WAV', () => {
  const sine = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));

  it('escribe una cabecera PCM correcta', () => {
    const buf = encodeWav([sine, sine], SR);
    const v = new DataView(buf);
    const str = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(str(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(str(8)).toBe('WAVE');
    expect(str(12)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // canales
    expect(v.getUint32(24, true)).toBe(SR);
    expect(v.getUint32(28, true)).toBe(SR * 4); // byteRate
    expect(v.getUint16(32, true)).toBe(4); // blockAlign
    expect(v.getUint16(34, true)).toBe(16);
    expect(str(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(4800 * 4);
    expect(buf.byteLength).toBe(44 + 4800 * 4);
  });

  it('16 bits: ida y vuelta con error ≤ 2 LSB (dither TPDF)', () => {
    const back = decodeWav(encodeWav([sine], SR));
    expect(back.sampleRate).toBe(SR);
    expect(back.channels[0].length).toBe(sine.length);
    let maxErr = 0;
    for (let i = 0; i < sine.length; i++) maxErr = Math.max(maxErr, Math.abs(back.channels[0][i] - sine[i]));
    expect(maxErr).toBeLessThanOrEqual(2 / 32767 + 1e-9);
  });

  it('32 bits float: ida y vuelta exacta, con bloque fact', () => {
    const buf = encodeWav([sine, sine], SR, { bitDepth: 32 });
    expect(String.fromCharCode(...new Uint8Array(buf, 38, 4))).toBe('fact');
    const back = decodeWav(buf);
    expect(back.format).toBe(3);
    expect(back.channels[1]).toEqual(sine);
  });

  it('recorta valores fuera de ±1 en 16 bits y es determinista', () => {
    const loud = Float32Array.from([2, -2, 1, -1, 0]);
    const back = decodeWav(encodeWav([loud], SR));
    expect(back.channels[0][0]).toBeCloseTo(1, 3);
    expect(back.channels[0][1]).toBeLessThanOrEqual(-1);
    expect(encodeWav([sine], SR)).toEqual(encodeWav([sine], SR));
  });

  it('valida la entrada', () => {
    expect(() => encodeWav([], SR)).toThrow();
    expect(() => encodeWav([sine, sine.subarray(1)], SR)).toThrow(/longitudes/);
    expect(() => encodeWav([sine], 44100.5)).toThrow(/muestreo/);
    expect(() => encodeWav([sine], SR, { bitDepth: 24 })).toThrow(/bits/);
  });
});

describe('planExport', () => {
  const params = sanitizeParams({ fadeSec: 3 });

  it('longitud exacta y envolvente con fundidos', () => {
    const plan = planExport(params, 60);
    expect(plan.length).toBe(60 * SR);
    expect(plan.envelope.map((p) => [p.time, p.value])).toEqual([[0, 0], [3, 1], [57, 1], [60, 0]]);
  });

  it('el fundido nunca ocupa más de un cuarto de la duración', () => {
    expect(planExport(sanitizeParams({ fadeSec: 10 }), 20).fade).toBe(5);
  });

  it('el instante de análisis cae en la meseta, alineado a 128 muestras', () => {
    for (const s of [10, 30, 60, 300]) {
      const plan = planExport(params, s);
      const start = plan.analysisTime - plan.windowSec;
      expect(start).toBeGreaterThanOrEqual(plan.fade);
      expect(plan.analysisTime).toBeLessThanOrEqual(s - plan.fade);
      expect((plan.analysisTime * SR) % 128).toBe(0);
    }
  });

  it('rechaza duraciones fuera de rango', () => {
    expect(() => planExport(params, 2)).toThrow();
    expect(() => planExport(params, 3600)).toThrow();
  });
});

describe('verifyExport', () => {
  // Simula lo que devolvería el render: tono con AM y fundidos, y la sonda g(t).
  function simulate(over, seconds = 10) {
    const params = sanitizeParams({ source: 'tone-rain', volume: 1, rainLevel: 0, ...over });
    const plan = planExport(params, seconds);
    const x = renderAmTone(params, SR, seconds);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] *= Math.min(1, t / plan.fade, (seconds - t) / plan.fade);
    }
    const { base, lfo } = amGains(params);
    const w = (2 * Math.PI * params.modRateHz) / SR;
    const probe = Float32Array.from({ length: 32768 }, (_, i) => base + lfo * Math.sin(w * i));
    return { channels: [x, x], probe, params, plan };
  }

  it('acepta un render correcto', () => {
    const r = verifyExport(simulate({}));
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.measured.peak).toBeLessThanOrEqual(outputGain(1) + 1e-6);
  });

  it('acepta la variante sin modulación (A/B)', () => {
    expect(verifyExport(simulate({ modulationOn: false })).ok).toBe(true);
  });

  it('detecta longitud incorrecta, pico excesivo y modulación distinta de la pedida', () => {
    const sim = simulate({});
    const short = verifyExport({ ...sim, channels: sim.channels.map((c) => c.subarray(1)) });
    expect(short.checks.find((c) => c.id === 'length').ok).toBe(false);

    const loud = sim.channels.map((c) => c.map((v) => v * 1.5));
    expect(verifyExport({ ...sim, channels: loud }).checks.find((c) => c.id === 'peak').ok).toBe(false);

    const wrong = verifyExport({ ...sim, params: { ...sim.params, modRateHz: 30 } });
    expect(wrong.checks.find((c) => c.id === 'modulator').ok).toBe(false);
    expect(wrong.ok).toBe(false);
  });

  it('sin datos de la sonda la verificación no pasa', () => {
    expect(verifyExport({ ...simulate({}), probe: null }).ok).toBe(false);
  });
});

describe('utilidades', () => {
  it('expectedModulation según la fuente', () => {
    expect(expectedModulation(sanitizeParams({ source: 'bruma', chordsDepth: 0.2 }))).toMatchObject({ depth: 0.2, active: true });
    expect(expectedModulation(sanitizeParams({ source: 'tone-rain', depth: 0.5, modulationOn: false }))).toMatchObject({ depth: 0, active: false });
  });

  it('nombre de archivo descriptivo', () => {
    const name = exportFileName(sanitizeParams({ source: 'generative', genSeed: 42, chordsDepth: 0.3 }), 60, new Date('2026-11-15T10:20:30Z'));
    expect(name).toBe('gamma-sound-lab_generativa-42_am40hz-30_60s_2026-11-15-10-20-30.wav');
  });

  it('el límite de pico coincide con el máximo del motor', () => {
    expect(outputGain(1)).toBe(MAX_MASTER_GAIN);
  });
});
