import { renderPiece } from './synth.js';

const genParams = ({ genSeed, genMode, genRoot, genTempo }) => ({ genSeed, genMode, genRoot, genTempo });

/**
 * Compone y sintetiza la pieza en un Web Worker (o directamente si no hay Worker, p. ej. en Node).
 * Cancelable con `signal`: termina el worker y rechaza la promesa.
 * @returns {Promise<{ score, melody: Float32Array, chords: Float32Array }>}
 */
export function renderPieceAsync(params, sampleRate, signal) {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined') return Promise.resolve(renderPiece(genParams(params), sampleRate));

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pieceWorker.js', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Cancelado', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = ({ data }) => {
      cleanup();
      if (data.ok) resolve(data);
      else reject(new Error(data.message));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Error al generar la pieza'));
    };
    worker.postMessage({ params: genParams(params), sampleRate });
  });
}
