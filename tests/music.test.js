import { describe, expect, it } from 'vitest';
import { BARS, BEATS_PER_BAR, compose, MODES, NOTE_NAMES } from '../src/music/composer.js';
import { renderNotes, renderPiece } from '../src/music/synth.js';

const SR = 48000;
const base = { genSeed: 7, genMode: 'pentatonic', genRoot: 'D', genTempo: 68 };
const pc = (m) => ((m % 12) + 12) % 12;

describe('compose', () => {
  it('es determinista por semilla y cambia con otra semilla', () => {
    expect(compose(base)).toEqual(compose(base));
    expect(compose({ ...base, genSeed: 8 }).melody).not.toEqual(compose(base).melody);
  });

  it.each(Object.keys(MODES))('modo %s: melodía y acordes dentro de sus escalas', (genMode) => {
    for (const genRoot of NOTE_NAMES) {
      for (let genSeed = 1; genSeed <= 15; genSeed++) {
        const s = compose({ ...base, genMode, genRoot, genSeed });
        for (const n of s.melody) expect(s.allowedMelodyPitchClasses).toContain(pc(n.midi));
        for (const ch of s.chords) {
          for (const m of ch.notes) expect(s.allowedHarmonyPitchClasses).toContain(pc(m));
        }
      }
    }
  });

  it('respeta la forma: 16 compases, un acorde por compás, melodía dentro de cada compás', () => {
    for (let genSeed = 1; genSeed <= 30; genSeed++) {
      const s = compose({ ...base, genSeed });
      expect(s.chords).toHaveLength(BARS);
      for (const n of s.melody) {
        const bar = Math.floor(n.startBeat / BEATS_PER_BAR);
        expect(n.startBeat + n.beats).toBeLessThanOrEqual((bar + 1) * BEATS_PER_BAR + 1e-9);
        expect(n.midi).toBeGreaterThanOrEqual(62);
        expect(n.midi).toBeLessThanOrEqual(84);
      }
      // Melodía monofónica: sin solapes.
      for (let i = 1; i < s.melody.length; i++) {
        expect(s.melody[i].startBeat).toBeGreaterThanOrEqual(s.melody[i - 1].startBeat + s.melody[i - 1].beats - 1e-9);
      }
    }
  });

  it('la pieza termina en la tónica (el bucle resuelve)', () => {
    for (let genSeed = 1; genSeed <= 30; genSeed++) {
      for (const genRoot of ['C', 'D', 'A']) {
        const s = compose({ ...base, genSeed, genRoot });
        expect(pc(s.melody.at(-1).midi)).toBe(NOTE_NAMES.indexOf(genRoot));
      }
    }
  });

  it('saltos melódicos moderados (≤ una octava entre notas consecutivas)', () => {
    for (let genSeed = 1; genSeed <= 30; genSeed++) {
      const { melody } = compose({ ...base, genSeed, genMode: 'major' });
      for (let i = 1; i < melody.length; i++) {
        expect(Math.abs(melody[i].midi - melody[i - 1].midi)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('la duración del bucle sale del tempo', () => {
    expect(compose({ ...base, genTempo: 60 }).loopSec).toBeCloseTo(64, 9);
    expect(compose({ ...base, genTempo: 80 }).loopSec).toBeCloseTo(48, 9);
  });
});

describe('renderNotes / renderPiece', () => {
  it('normaliza a pico 0,9 sin NaN', () => {
    const x = renderNotes([{ time: 0, dur: 0.5, freq: 440, velocity: 1 }], { sampleRate: SR, loopSec: 2, instrument: 'keys' });
    let peak = 0;
    for (const v of x) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.9, 6);
  });

  it('las colas que pasan del final se suman al principio (bucle sin salto)', () => {
    // Nota que empieza 0,2 s antes del final: su cola debe aparecer al principio.
    const x = renderNotes([{ time: 1.8, dur: 0.4, freq: 220, velocity: 1 }], { sampleRate: SR, loopSec: 2, instrument: 'pad' });
    let headEnergy = 0;
    for (let i = 0; i < SR * 0.5; i++) headEnergy += x[i] * x[i];
    expect(headEnergy).toBeGreaterThan(1);
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(maxStep);
  });

  it('renderPiece es determinista y las pistas duran lo mismo que el bucle', () => {
    const p = { ...base, genTempo: 90 };
    const a = renderPiece(p, 16000);
    const b = renderPiece(p, 16000);
    expect(a.melody).toEqual(b.melody);
    expect(a.chords).toEqual(b.chords);
    expect(a.melody.length).toBe(Math.round(a.score.loopSec * 16000));
    expect(a.chords.length).toBe(a.melody.length);
  });

  it('se sintetiza en un tiempo razonable a 48 kHz', () => {
    const t0 = performance.now();
    renderPiece(base, SR);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
