// Fábrica de voces por fuente. La usan tanto la sesión en vivo (AudioContext) como la
// exportación (OfflineAudioContext), así ambas producen exactamente el mismo grafo.
import { renderPieceAsync } from '../music/renderPieceAsync.js';
import { PieceVoice } from './PieceVoice.js';
import { SessionVoice } from './SessionVoice.js';

export const SOURCE_LABELS = Object.freeze({
  bruma: 'Bruma de cristal',
  generative: 'Composición generativa',
  'tone-rain': 'Tono y lluvia',
});

const brumaUrls = {
  melody: new URL('../assets/bruma-melodia.flac', import.meta.url),
  chords: new URL('../assets/bruma-acordes.flac', import.meta.url),
};

// Los AudioBuffer no dependen del contexto: se cachean por frecuencia de muestreo.
const brumaBySampleRate = new Map();
const generativeCache = new Map();
const GENERATIVE_CACHE_LIMIT = 3;

async function decodeTrack(ctx, url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('No se pudo cargar Bruma de cristal');
  const encoded = await response.arrayBuffer();
  signal?.throwIfAborted();
  return ctx.decodeAudioData(encoded);
}

async function loadBruma(ctx, signal) {
  let tracks = brumaBySampleRate.get(ctx.sampleRate);
  if (!tracks) {
    const [melody, chords] = await Promise.all([
      decodeTrack(ctx, brumaUrls.melody, signal),
      decodeTrack(ctx, brumaUrls.chords, signal),
    ]);
    signal?.throwIfAborted();
    tracks = { melody, chords, title: 'Bruma de cristal' };
    brumaBySampleRate.set(ctx.sampleRate, tracks);
  }
  return tracks;
}

function toBuffer(data, sampleRate) {
  const buffer = new AudioBuffer({ length: data.length, sampleRate, numberOfChannels: 1 });
  buffer.copyToChannel(data, 0);
  return buffer;
}

async function loadGenerative(ctx, params, signal) {
  const key = [params.genSeed, params.genMode, params.genRoot, params.genTempo, ctx.sampleRate].join('|');
  let tracks = generativeCache.get(key);
  if (!tracks) {
    const piece = await renderPieceAsync(params, ctx.sampleRate, signal);
    signal?.throwIfAborted();
    tracks = {
      melody: toBuffer(piece.melody, ctx.sampleRate),
      chords: toBuffer(piece.chords, ctx.sampleRate),
      title: piece.score.title,
    };
    generativeCache.set(key, tracks);
    if (generativeCache.size > GENERATIVE_CACHE_LIMIT) generativeCache.delete(generativeCache.keys().next().value);
  }
  return tracks;
}

/** Crea la voz de la fuente seleccionada. Puede tardar (carga o síntesis): cancelable con `signal`. */
export async function createVoice(ctx, params, signal) {
  switch (params.source) {
    case 'bruma':
      return new PieceVoice(ctx, params, await loadBruma(ctx, signal));
    case 'generative':
      return new PieceVoice(ctx, params, await loadGenerative(ctx, params, signal));
    default:
      return new SessionVoice(ctx, params);
  }
}
