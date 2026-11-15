// Compositor generativo: produce una pieza original (acordes + melodía) a partir de una
// semilla. Función pura y determinista: misma entrada → misma partitura.
import { mulberry32 } from '../audio/generators.js';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_ES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/**
 * Modos disponibles. `harmony` es la escala de la que salen los acordes (siempre heptatónica),
 * `melody` la escala de la melodía y `progressions` progresiones de 4 acordes en grados (0 = I).
 */
export const MODES = Object.freeze({
  major: {
    label: 'mayor',
    harmony: MAJOR,
    melody: MAJOR,
    progressions: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 1, 4]],
  },
  minor: {
    label: 'menor',
    harmony: MINOR,
    melody: MINOR,
    progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [5, 6, 0, 0]],
  },
  pentatonic: {
    label: 'pentatónica',
    harmony: MAJOR,
    melody: [0, 2, 4, 7, 9],
    progressions: [[0, 5, 3, 4], [0, 3, 0, 4], [3, 4, 0, 5], [0, 4, 5, 3]],
  },
});

export const BEATS_PER_BAR = 4;
export const BARS = 16;
const MELODY_RANGE = [62, 84]; // Re4 – Do6
const CHORD_RANGE = [53, 67]; // Fa3 – Sol4 (sin incluir)
const BASS_RANGE = [40, 52]; // Mi2 – Mi3 (sin incluir)

// Patrones rítmicos de un compás (duraciones en tiempos; suman 4).
const RHYTHMS = [
  [1, 1, 1, 1],
  [2, 1, 1],
  [1, 1, 2],
  [1.5, 0.5, 2],
  [2, 2],
  [1, 0.5, 0.5, 2],
  [3, 1],
  [0.5, 0.5, 1, 2],
];
const CADENCE_RHYTHMS = [[2, 2], [1, 3], [4]];
const STEPS = [-2, -1, -1, -1, 0, 1, 1, 1, 2, -3, 3];

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Semitonos del grado `index` de la escala, con octavas para índices ≥ longitud. */
function degreeSemis(scale, index) {
  const n = scale.length;
  return scale[((index % n) + n) % n] + 12 * Math.floor(index / n);
}

/** Coloca cada clase de altura dentro de [lo, hi) y devuelve las notas ordenadas. */
function voiceInRange(pitchClasses, [lo, hi]) {
  return pitchClasses
    .map((pc) => {
      let m = lo + ((pc - lo) % 12 + 12) % 12;
      if (m >= hi) m -= 12;
      return m;
    })
    .sort((a, b) => a - b);
}

/**
 * @param params { genSeed, genMode, genRoot, genTempo }
 * @returns partitura { tempo, bars, loopSec, chords[], melody[], title, ... }
 */
export function compose({ genSeed, genMode, genRoot, genTempo }) {
  const rand = mulberry32(genSeed);
  const mode = MODES[genMode] ?? MODES.pentatonic;
  const root = Math.max(0, NOTE_NAMES.indexOf(genRoot));
  const secondsPerBeat = 60 / genTempo;

  // Forma AABA con dos progresiones distintas.
  const progA = pick(rand, mode.progressions);
  let progB = pick(rand, mode.progressions);
  if (progB === progA) progB = mode.progressions[(mode.progressions.indexOf(progA) + 1) % mode.progressions.length];
  const degrees = [...progA, ...progA, ...progB, ...progA];

  const chords = degrees.map((degree, bar) => {
    const triadPcs = [0, 2, 4].map((k) => pitchClass(root + degreeSemis(mode.harmony, degree + k)));
    const bass = voiceInRange([triadPcs[0]], BASS_RANGE)[0];
    return {
      bar,
      degree,
      startBeat: bar * BEATS_PER_BAR,
      beats: BEATS_PER_BAR,
      pitchClasses: triadPcs,
      notes: [bass, ...voiceInRange(triadPcs, CHORD_RANGE)],
    };
  });

  // Alturas disponibles para la melodía, ordenadas.
  const melodyPcs = new Set(mode.melody.map((s) => pitchClass(root + s)));
  const pitches = [];
  for (let m = MELODY_RANGE[0]; m <= MELODY_RANGE[1]; m++) if (melodyPcs.has(pitchClass(m))) pitches.push(m);
  const nearestIndex = (target, allowedPcs) => {
    let best = -1;
    for (let i = 0; i < pitches.length; i++) {
      if (allowedPcs && !allowedPcs.includes(pitchClass(pitches[i]))) continue;
      if (best < 0 || Math.abs(pitches[i] - target) < Math.abs(pitches[best] - target)) best = i;
    }
    return best;
  };

  let idx = nearestIndex(72, chords[0].pitchClasses);
  if (idx < 0) idx = nearestIndex(72);
  const melody = [];
  for (const chord of chords) {
    const cadence = chord.bar % 4 === 3;
    const last = chord.bar === BARS - 1;
    const rhythm = pick(rand, cadence ? CADENCE_RHYTHMS : RHYTHMS);
    let beat = 0;
    rhythm.forEach((beats, k) => {
      const isLastSlot = k === rhythm.length - 1;
      if (k === 0 || (cadence && isLastSlot)) {
        // Tiempo fuerte y final de frase: nota del acorde (al final de la pieza, la tónica).
        const allowed = last && isLastSlot ? [root] : chord.pitchClasses;
        const target = pitches[idx] + (cadence && isLastSlot ? -2 : 0);
        const found = nearestIndex(target, allowed.filter((pc) => melodyPcs.has(pc)));
        idx = found >= 0 ? found : idx;
      } else {
        let step = pick(rand, STEPS);
        if (pitches[idx] > 79 && step > 0) step = -step; // volver hacia el centro
        if (pitches[idx] < 65 && step < 0) step = -step;
        idx = Math.min(pitches.length - 1, Math.max(0, idx + step));
        if (rand() < 0.12) {
          beat += beats; // silencio
          return;
        }
      }
      melody.push({
        startBeat: chord.startBeat + beat,
        beats,
        midi: pitches[idx],
        velocity: k === 0 ? 1 : 0.7 + 0.25 * rand(),
      });
      beat += beats;
    });
  }

  const bars = BARS;
  const loopSec = bars * BEATS_PER_BAR * secondsPerBeat;
  return {
    seed: genSeed,
    mode: genMode,
    root,
    tempo: genTempo,
    bars,
    secondsPerBeat,
    loopSec,
    chords,
    melody,
    title: `${NOTE_NAMES_ES[root]} ${mode.label} · ${genTempo} ppm · semilla ${genSeed}`,
    allowedMelodyPitchClasses: [...melodyPcs],
    allowedHarmonyPitchClasses: mode.harmony.map((s) => pitchClass(root + s)),
  };
}
