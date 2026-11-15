import { renderRain } from './generators.js';

const CACHE_LIMIT = 4;
const cache = new Map();

/** AudioBuffer de lluvia para una semilla; se cachea porque generarlo cuesta ~decenas de ms. */
function rainBuffer(ctx, seed) {
  const key = `${seed}@${ctx.sampleRate}`;
  let buf = cache.get(key);
  if (!buf) {
    const data = renderRain({ seed, sampleRate: ctx.sampleRate });
    buf = new AudioBuffer({ length: data.length, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    buf.copyToChannel(data, 0);
    cache.set(key, buf);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  return buf;
}

/** Lluvia generada en bucle continuo. La semilla queda fija durante la sesión. */
export class RainSource {
  constructor(ctx, { rainSeed }) {
    this.node = new AudioBufferSourceNode(ctx, { buffer: rainBuffer(ctx, rainSeed), loop: true });
    this.output = this.node;
  }

  start(time) {
    this.node.start(time);
  }

  dispose() {
    try {
      this.node.stop();
    } catch {
      /* ya detenido o no iniciado */
    }
    this.node.disconnect();
  }
}
