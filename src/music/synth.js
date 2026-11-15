// Síntesis pura (sin Web Audio) de la partitura del compositor. Produce pistas en bucle:
// las colas de las notas que pasan del final se suman al principio, así la costura no salta.
import { compose, midiToHz } from './composer.js';

/**
 * Instrumentos aditivos. `partials`: [múltiplo, amplitud]. Las teclas decaen
 * exponencialmente; el pad tiene ataque lento y sostiene hasta el final de la nota.
 */
export const INSTRUMENTS = Object.freeze({
  keys: {
    partials: [[1, 1], [2, 0.4], [3, 0.15], [4, 0.06]],
    attack: 0.004,
    release: 0.3,
    decayTau: (freq) => Math.min(2.2, 1.1 * Math.sqrt(440 / freq)),
  },
  pad: {
    partials: [[1, 1], [2, 0.22], [3, 0.07]],
    attack: 0.6,
    release: 1.6,
    decayTau: () => Infinity,
  },
});

const TARGET_PEAK = 0.9;

/**
 * @param events [{ time, dur, freq, velocity }] en segundos y Hz
 * @returns Float32Array de longitud loopSec·sampleRate, normalizada a pico TARGET_PEAK
 */
export function renderNotes(events, { sampleRate, loopSec, instrument }) {
  const inst = INSTRUMENTS[instrument];
  const n = Math.round(loopSec * sampleRate);
  const out = new Float64Array(n);
  const attackN = Math.max(1, Math.round(inst.attack * sampleRate));
  const releaseN = Math.round(inst.release * sampleRate);
  const releaseK = Math.exp(Math.log(1e-3) / Math.max(1, releaseN)); // −60 dB al final del release

  for (const ev of events) {
    const start = Math.round(ev.time * sampleRate);
    const holdN = Math.max(attackN, Math.round(ev.dur * sampleRate));
    const total = holdN + releaseN;
    const tau = inst.decayTau(ev.freq);
    const partials = inst.partials
      .filter(([mult]) => ev.freq * mult < sampleRate * 0.45)
      .map(([mult, amp]) => {
        const w = (2 * Math.PI * ev.freq * mult) / sampleRate;
        // Los armónicos altos decaen antes, como en instrumentos reales.
        const k = Number.isFinite(tau) ? Math.exp(-1 / ((tau / Math.sqrt(mult)) * sampleRate)) : 1;
        return { c: Math.cos(w), s: Math.sin(w), re: 1, im: 0, amp, k, env: 1 };
      });

    let env = 0;
    for (let j = 0; j < total; j++) {
      if (j < attackN) env = j / attackN;
      else if (j < holdN) env = 1;
      else env *= releaseK;
      let v = 0;
      for (const p of partials) {
        // Fasor giratorio: evita llamar a sin() por muestra.
        const re = p.re * p.c - p.im * p.s;
        p.im = p.re * p.s + p.im * p.c;
        p.re = re;
        p.env *= p.k;
        v += p.amp * p.env * p.im;
      }
      out[(start + j) % n] += ev.velocity * env * v;
    }
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? TARGET_PEAK / peak : 0;
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) result[i] = out[i] * g;
  return result;
}

/** Convierte la partitura en eventos de síntesis para cada pista. */
export function scoreToEvents(score) {
  const spb = score.secondsPerBeat;
  const chords = score.chords.flatMap((ch) =>
    ch.notes.map((midi, i) => ({
      time: ch.startBeat * spb,
      dur: ch.beats * spb,
      freq: midiToHz(midi),
      velocity: i === 0 ? 0.8 : 0.55, // el bajo un poco más presente
    })),
  );
  const melody = score.melody.map((nt) => ({
    time: nt.startBeat * spb,
    dur: nt.beats * spb,
    freq: midiToHz(nt.midi),
    velocity: nt.velocity,
  }));
  return { chords, melody };
}

/** Compone y sintetiza la pieza completa. Devuelve pistas mono en bucle y la partitura. */
export function renderPiece(params, sampleRate) {
  const score = compose(params);
  const events = scoreToEvents(score);
  const opts = { sampleRate, loopSec: score.loopSec };
  return {
    score,
    melody: renderNotes(events.melody, { ...opts, instrument: 'keys' }),
    chords: renderNotes(events.chords, { ...opts, instrument: 'pad' }),
  };
}
