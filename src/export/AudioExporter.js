// Exportación a WAV con OfflineAudioContext: el mismo grafo que la sesión en vivo
// (voz de la fuente + cadena de salida), renderizado más rápido que el tiempo real.
import { outputGain } from '../audio/dsp.js';
import { buildOutputChain } from '../audio/outputChain.js';
import { createVoice } from '../audio/sources.js';
import { sanitizeParams } from '../utils/validators.js';
import { planExport, verifyExport } from './exportPlan.js';
import { encodeWav } from './wav.js';

/**
 * Renderiza `seconds` de la configuración actual y verifica el resultado.
 * @returns {Promise<{ channels: Float32Array[], sampleRate, report, plan, params }>}
 */
export async function renderExport(rawParams, { seconds = 60, sampleRate, signal } = {}) {
  const params = sanitizeParams(rawParams);
  const plan = planExport(params, seconds, sampleRate);
  signal?.throwIfAborted();

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: plan.length, sampleRate: plan.sampleRate });
  const chain = buildOutputChain(ctx);
  const voice = await createVoice(ctx, params, signal);
  signal?.throwIfAborted();

  chain.master.gain.value = outputGain(params.volume);
  const fade = chain.fade.gain;
  for (const point of plan.envelope) {
    if (point.ramp) fade.linearRampToValueAtTime(point.value, point.time);
    else fade.setValueAtTime(point.value, point.time);
  }
  voice.connect(chain.input);
  voice.start(0);

  // Leer la sonda del modulador a mitad del render, con la ventana dentro de la meseta.
  let probe = null;
  const probeNode = voice.modulationProbe;
  ctx.suspend(plan.analysisTime).then(() => {
    if (probeNode) {
      probe = new Float32Array(probeNode.fftSize);
      probeNode.getFloatTimeDomainData(probe);
    }
    ctx.resume();
  });

  const rendered = await ctx.startRendering();
  voice.dispose();
  signal?.throwIfAborted();

  const channels = Array.from({ length: rendered.numberOfChannels }, (_, c) => rendered.getChannelData(c));
  const report = verifyExport({ channels, probe, params, plan });
  return { channels, sampleRate: rendered.sampleRate, report, plan, params };
}

/** WAV 16 bits listo para descargar. */
export function toWavBlob({ channels, sampleRate }, { bitDepth = 16 } = {}) {
  return new Blob([encodeWav(channels, sampleRate, { bitDepth })], { type: 'audio/wav' });
}
