import { Mixer } from './Mixer.js';
import { Modulator } from './Modulator.js';

const melodyUrl = new URL('../assets/bruma-melodia.flac', import.meta.url);
const chordsUrl = new URL('../assets/bruma-acordes.flac', import.meta.url);
const buffersByContext = new WeakMap();

async function decodeTrack(ctx, url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('No se pudo cargar Bruma de cristal');
  const encoded = await response.arrayBuffer();
  signal.throwIfAborted();
  return ctx.decodeAudioData(encoded);
}

const levelsOf = ({ melodyLevel, chordsLevel }) => ({ melody: melodyLevel, chords: chordsLevel });
const modulationOf = (params) => ({ ...params, depth: params.brumaDepth });

/** Reproduce las dos pistas estéreo de Bruma en fase, con AM solo en los acordes. */
export class BrumaVoice {
  static async load(ctx, params, signal) {
    let buffers = buffersByContext.get(ctx);
    if (!buffers) {
      buffers = await Promise.all([
        decodeTrack(ctx, melodyUrl, signal),
        decodeTrack(ctx, chordsUrl, signal),
      ]);
      signal.throwIfAborted();
      if (buffers[0].length !== buffers[1].length) {
        throw new Error('Las pistas de Bruma de cristal tienen duraciones diferentes');
      }
      buffersByContext.set(ctx, buffers);
    }
    return new BrumaVoice(ctx, params, buffers);
  }

  constructor(ctx, params, [melody, chords]) {
    this.mixer = new Mixer(ctx, levelsOf(params));
    this.melody = new AudioBufferSourceNode(ctx, { buffer: melody, loop: true });
    this.chords = new AudioBufferSourceNode(ctx, { buffer: chords, loop: true });
    this.mod = new Modulator(ctx, modulationOf(params));
    this.melody.connect(this.mixer.input('melody'));
    this.chords.connect(this.mod.input);
    this.mod.output.connect(this.mixer.input('chords'));
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
