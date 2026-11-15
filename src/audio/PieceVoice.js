import { Mixer } from './Mixer.js';
import { Modulator } from './Modulator.js';

const rmsCache = new WeakMap();

/** RMS de todos los canales de un AudioBuffer (se calcula una vez por búfer). */
function bufferRms(buffer) {
  if (!rmsCache.has(buffer)) {
    let sum = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    }
    rmsCache.set(buffer, Math.sqrt(sum / (buffer.length * buffer.numberOfChannels)));
  }
  return rmsCache.get(buffer);
}

const levelsOf = ({ melodyLevel, chordsLevel }) => ({ melody: melodyLevel, chords: chordsLevel });
const modulationOf = (params) => ({ ...params, depth: params.chordsDepth });

/**
 * Pieza de dos capas en bucle (Bruma de cristal o composición generativa): melodía sin
 * modular y acordes con AM, ambas en fase.
 *
 *   melodía ─────────────────► canal melody ─┐
 *                                            ├─► Mixer ─► salida
 *   acordes ─► Modulator (AM) ─► canal chords ┘
 */
export class PieceVoice {
  #info;

  /** @param tracks { melody: AudioBuffer, chords: AudioBuffer, title } */
  constructor(ctx, params, { melody, chords, title }) {
    if (melody.length !== chords.length) throw new Error('Las pistas de la pieza tienen duraciones diferentes');
    this.#info = Object.freeze({
      title,
      loopSec: melody.duration,
      melodyRms: bufferRms(melody),
      chordsRms: bufferRms(chords),
    });
    this.mixer = new Mixer(ctx, levelsOf(params));
    this.melody = new AudioBufferSourceNode(ctx, { buffer: melody, loop: true });
    this.chords = new AudioBufferSourceNode(ctx, { buffer: chords, loop: true });
    this.mod = new Modulator(ctx, modulationOf(params));
    this.melody.connect(this.mixer.input('melody'));
    this.chords.connect(this.mod.input);
    this.mod.output.connect(this.mixer.input('chords'));
  }

  /** AnalyserNode con la ganancia de modulación g(t) aplicada a los acordes (ver Modulator). */
  get modulationProbe() {
    return this.mod.probe;
  }

  /** Título, duración del bucle y RMS de cada pista, para la interfaz. */
  get info() {
    return this.#info;
  }

  connect(destination) {
    this.mixer.output.connect(destination);
  }

  start(time) {
    this.melody.start(time);
    this.chords.start(time);
    this.mod.start(time);
  }

  set(params, time) {
    this.mixer.setLevels(levelsOf(params), time);
    this.mod.set(modulationOf(params), time);
  }

  dispose() {
    for (const track of [this.melody, this.chords]) {
      try {
        track.stop();
      } catch {
        // Puede haberse cancelado la sesión antes de que arranque la pista.
      }
      track.disconnect();
    }
    this.mod.dispose();
    this.mixer.dispose();
  }
}
