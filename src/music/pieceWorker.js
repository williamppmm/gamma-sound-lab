// Web Worker: compone y sintetiza la pieza fuera del hilo principal (~1 s de cálculo).
import { renderPiece } from './synth.js';

self.onmessage = ({ data }) => {
  try {
    const { score, melody, chords } = renderPiece(data.params, data.sampleRate);
    self.postMessage({ ok: true, score, melody, chords }, [melody.buffer, chords.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, message: String(err?.message ?? err) });
  }
};
