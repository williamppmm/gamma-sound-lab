// Planificación y verificación de exportaciones. Funciones puras: se prueban en Node y el
// exportador del navegador las usa para programar el render y comprobar el resultado.
import { countClipped, estimateModulation, peakAbs, toDbfs } from '../audio/dsp.js';
import { MAX_MASTER_GAIN } from '../audio/limits.js';

export const EXPORT_DURATIONS_SEC = Object.freeze([30, 60, 120, 300]);
export const EXPORT_SAMPLE_RATE = 48000;
export const ANALYSIS_WINDOW = 32768;
const RENDER_QUANTUM = 128;

/**
 * Plan de render: longitud exacta y envolvente de fundidos (entrada y salida).
 * El fundido es el de la sesión, limitado a un cuarto de la duración.
 */
export function planExport(params, seconds, sampleRate = EXPORT_SAMPLE_RATE) {
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600) {
    throw new Error('La duración de la exportación debe estar entre 5 s y 10 min');
  }
  const length = Math.round(seconds * sampleRate);
  const fade = Math.min(params.fadeSec, seconds / 4);
  const envelope = [
    { time: 0, value: 0, ramp: false },
    { time: fade, value: 1, ramp: true },
    { time: seconds - fade, value: 1, ramp: false },
    { time: seconds, value: 0, ramp: true },
  ];
  // Instante para leer los analizadores: con la ventana completa dentro de la meseta.
  const windowSec = ANALYSIS_WINDOW / sampleRate;
  const ideal = fade + windowSec + 0.5;
  const latest = seconds - fade;
  const raw = Math.min(Math.max(ideal, seconds / 2), latest);
  const analysisTime = (Math.floor((raw * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM) / sampleRate;
  return { seconds, sampleRate, length, fade, envelope, analysisTime, windowSec };
}

/** Modulación que debería aplicar el modulador según los parámetros. */
export function expectedModulation(params) {
  const depth = params.source === 'tone-rain' ? params.depth : params.chordsDepth;
  const on = params.modulationOn && depth > 0;
  return { modRateHz: params.modRateHz, depth: on ? depth : 0, active: on };
}

/** Promedio de canales (para analizar la salida estéreo como una señal). */
export function mixDown(channels) {
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * Comprueba que lo renderizado coincide con los parámetros.
 * @param input.channels     canales renderizados (Float32Array[])
 * @param input.probe        muestras de la sonda del modulador en la meseta (o null)
 * @param input.params       parámetros saneados
 * @param input.plan         resultado de planExport
 * @returns {{ ok: boolean, checks: { id, label, ok, detail }[], measured }}
 */
export function verifyExport({ channels, probe, params, plan }) {
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok, detail });
  const { sampleRate } = plan;

  const frames = channels[0]?.length ?? 0;
  add('length', 'Duración exacta', frames === plan.length, `${(frames / sampleRate).toFixed(3)} s (${frames} muestras)`);

  const peak = Math.max(...channels.map(peakAbs));
  const ceiling = MAX_MASTER_GAIN * 1.001;
  add('peak', 'Pico dentro del límite (−6 dBFS)', peak <= ceiling, `${toDbfs(peak).toFixed(2)} dBFS`);
  const clipped = channels.reduce((n, ch) => n + countClipped(ch), 0);
  add('clipping', 'Sin clipping', clipped === 0, clipped ? `${clipped} muestras` : 'ninguna muestra a escala completa');

  const expected = expectedModulation(params);
  let probeResult = null;
  if (probe) {
    probeResult = estimateModulation(probe, sampleRate);
    if (expected.active) {
      const ok =
        probeResult.status === 'ok' &&
        Math.abs(probeResult.frequency - expected.modRateHz) < 0.2 &&
        Math.abs(probeResult.depth - expected.depth) < 0.02;
      add(
        'modulator',
        `Modulador a ${expected.modRateHz} Hz · ${Math.round(expected.depth * 100)} %`,
        ok,
        probeResult.status === 'ok'
          ? `medido ${probeResult.frequency.toFixed(2)} Hz · ${(probeResult.depth * 100).toFixed(1)} %`
          : `lectura: ${probeResult.status}`,
      );
    } else {
      add('modulator', 'Modulador inactivo (A/B o profundidad 0)', probeResult.status !== 'ok', `lectura: ${probeResult.status}`);
    }
  } else {
    add('modulator', 'Sonda del modulador', false, 'sin datos de la sonda');
  }

  // La salida solo es medible con tono puro (en música y lluvia hay fluctuaciones propias).
  let outputResult = null;
  const toneOnly = params.source === 'tone-rain' && params.toneLevel > 0 && params.rainLevel === 0;
  if (toneOnly) {
    const start = Math.round(plan.analysisTime * sampleRate) - ANALYSIS_WINDOW;
    const segment = mixDown(channels).subarray(Math.max(0, start), Math.max(0, start) + ANALYSIS_WINDOW);
    outputResult = estimateModulation(segment, sampleRate);
    if (expected.active) {
      const ok =
        outputResult.status === 'ok' &&
        Math.abs(outputResult.frequency - expected.modRateHz) < 0.2 &&
        Math.abs(outputResult.depth - expected.depth) < 0.03;
      add(
        'output',
        'Modulación presente en el audio exportado',
        ok,
        outputResult.status === 'ok'
          ? `medido ${outputResult.frequency.toFixed(2)} Hz · ${(outputResult.depth * 100).toFixed(1)} %`
          : `lectura: ${outputResult.status}`,
      );
    } else {
      add('output', 'Audio exportado sin modulación', outputResult.status !== 'ok', `lectura: ${outputResult.status}`);
    }
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    measured: { peak, clipped, probe: probeResult, output: outputResult },
  };
}

/** Nombre de archivo descriptivo para el WAV exportado. */
export function exportFileName(params, seconds, date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const src = { bruma: 'bruma', generative: `generativa-${params.genSeed}`, 'tone-rain': 'tono-lluvia' }[params.source];
  const mod = expectedModulation(params);
  const am = mod.active ? `am${mod.modRateHz}hz-${Math.round(mod.depth * 100)}` : 'sin-am';
  return `gamma-sound-lab_${src}_${am}_${seconds}s_${stamp}.wav`;
}
