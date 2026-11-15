// Codificador/decodificador WAV puro (sin Web Audio).
import { mulberry32 } from '../audio/generators.js';

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Codifica canales Float32 en WAV.
 * - 16 bits PCM con dither TPDF (±1 LSB, determinista por `ditherSeed`) y recorte a ±1.
 * - 32 bits float IEEE sin pérdidas (para análisis).
 * @param channels Float32Array[] de igual longitud
 * @returns ArrayBuffer
 */
export function encodeWav(channels, sampleRate, { bitDepth = 16, ditherSeed = 1 } = {}) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 8) {
    throw new Error('Se necesitan entre 1 y 8 canales');
  }
  const length = channels[0].length;
  if (channels.some((c) => c.length !== length)) throw new Error('Los canales tienen longitudes distintas');
  if (!Number.isInteger(sampleRate) || sampleRate < 3000 || sampleRate > 768000) {
    throw new Error('Frecuencia de muestreo no válida');
  }
  if (bitDepth !== 16 && bitDepth !== 32) throw new Error('Profundidad de bits no soportada (16 o 32)');

  const isFloat = bitDepth === 32;
  const numChannels = channels.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = length * blockAlign;
  const fmtBytes = isFloat ? 18 : 16;
  const factBytes = isFloat ? 12 : 0; // los WAV float deben llevar un bloque "fact"
  const headerBytes = 12 + 8 + fmtBytes + factBytes + 8;
  if (headerBytes + dataBytes > 0xffffffff) throw new Error('El WAV superaría 4 GB');

  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);
  let o = 0;
  writeString(view, o, 'RIFF');
  view.setUint32(o + 4, headerBytes + dataBytes - 8, true);
  writeString(view, o + 8, 'WAVE');
  o += 12;
  writeString(view, o, 'fmt ');
  view.setUint32(o + 4, fmtBytes, true);
  view.setUint16(o + 8, isFloat ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(o + 10, numChannels, true);
  view.setUint32(o + 12, sampleRate, true);
  view.setUint32(o + 16, sampleRate * blockAlign, true);
  view.setUint16(o + 20, blockAlign, true);
  view.setUint16(o + 22, bitDepth, true);
  if (isFloat) view.setUint16(o + 24, 0, true); // cbSize
  o += 8 + fmtBytes;
  if (isFloat) {
    writeString(view, o, 'fact');
    view.setUint32(o + 4, 4, true);
    view.setUint32(o + 8, length, true);
    o += 12;
  }
  writeString(view, o, 'data');
  view.setUint32(o + 4, dataBytes, true);
  o += 8;

  if (isFloat) {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++, o += 4) view.setFloat32(o, channels[c][i], true);
    }
  } else {
    const rand = mulberry32(ditherSeed);
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++, o += 2) {
        const dither = rand() - rand(); // TPDF en (−1, 1) LSB
        const v = Math.round(channels[c][i] * 32767 + dither);
        view.setInt16(o, Math.max(-32768, Math.min(32767, v)), true);
      }
    }
  }
  return buffer;
}

/** Decodifica un WAV PCM 16 bits o float 32 bits (el formato que produce encodeWav). */
export function decodeWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(...new Uint8Array(arrayBuffer, o, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('No es un archivo WAV');
  let o = 12;
  let fmt = null;
  while (o + 8 <= view.byteLength) {
    const id = tag(o);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        numChannels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitDepth: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('Falta el bloque fmt');
      const bytes = fmt.bitDepth / 8;
      const frames = Math.floor(size / (bytes * fmt.numChannels));
      const channels = Array.from({ length: fmt.numChannels }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.numChannels; c++, p += bytes) {
          channels[c][i] = fmt.format === FORMAT_FLOAT ? view.getFloat32(p, true) : view.getInt16(p, true) / 32767;
        }
      }
      return { ...fmt, channels };
    }
    o = body + size + (size % 2);
  }
  throw new Error('Falta el bloque data');
}
