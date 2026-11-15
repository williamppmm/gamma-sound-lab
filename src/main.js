import './styles/main.css';
import { AudioEngine } from './audio/AudioEngine.js';
import { SignalAnalyzer } from './audio/Analyzer.js';
import { MOD_DETECTION, toDbfs } from './audio/dsp.js';
import { MAX_MASTER_GAIN } from './audio/limits.js';
import { SessionManager } from './sessions/SessionManager.js';
import { Controls } from './ui/Controls.js';
import { WaveformVisualizer } from './ui/Visualizer.js';
import { defaultParams } from './utils/validators.js';

const $ = (sel) => document.querySelector(sel);

const engine = new AudioEngine();
const session = new SessionManager(engine, { ...defaultParams(), source: 'bruma' });
const controls = new Controls($('#controls'), (partial) => session.update(partial));
controls.write(session.params);

const SCOPE_SAMPLES = 4096;
let analyzer = null;
function getAnalyzer() {
  const node = engine.analyser;
  if (!node) return null;
  if (analyzer?.node !== node) {
    analyzer = new SignalAnalyzer(node);
    updateScopeCaption(node.context.sampleRate, node.fftSize);
  }
  return analyzer;
}

const scope = new WaveformVisualizer($('#scope'), () => getAnalyzer()?.read() ?? null, {
  viewSamples: SCOPE_SAMPLES,
});
scope.stop();

function updateScopeCaption(sampleRate, analysisSamples) {
  const viewMs = Math.round((SCOPE_SAMPLES / sampleRate) * 1000);
  const fullDb = (20 * Math.log10(MAX_MASTER_GAIN)).toFixed(0);
  $('#scope-caption').textContent =
    `Últimos ${viewMs} ms · borde = volumen 100 % (${fullDb} dBFS) · ` +
    `medición sobre ${(analysisSamples / sampleRate).toFixed(2)} s a ${sampleRate / 1000} kHz`;
}

const sourceSelect = $('#source');
sourceSelect.addEventListener('change', () => {
  sourceSelect.value = session.update({ source: sourceSelect.value }).source;
});
const btnStart = $('#btn-start');
const btnPause = $('#btn-pause');
const btnStop = $('#btn-stop');
btnStart.addEventListener('click', () => session.start());
btnPause.addEventListener('click', () => (session.state === 'paused' ? session.resume() : session.pause()));
btnStop.addEventListener('click', () => session.stop());
$('#btn-seed').addEventListener('click', () => {
  controls.write(session.update({ rainSeed: 1 + Math.floor(Math.random() * 999999) }));
});

// ---- Lectura de mediciones ---------------------------------------------------
const readout = {
  mod: $('#m-mod'),
  carrier: $('#m-carrier'),
  peak: $('#m-peak'),
  clip: $('#m-clip'),
};

// Solo se muestran cifras cuando la lectura es fiable (ver estimateModulation en dsp.js).
const MOD_STATUS_TEXT = {
  none: 'sin modulación clara',
  unstable: 'en transición…',
  short: 'demasiado lenta para medir',
};
const MOD_STATUS_HINT = {
  none: 'El pico del espectro no destaca del fondo. Con lluvia sola la medición no es fiable.',
  unstable: 'La energía cambia dentro de la ventana (fundido o cambio de parámetros).',
  short: `Caben menos de ${MOD_DETECTION.minCycles} ciclos en la ventana de análisis.`,
};

function showBrumaModulation({ modulationOn, chordsLevel, modRateHz, brumaDepth }) {
  readout.mod.dataset.status = '';
  readout.mod.title = 'Ajuste del modulador. La forma de onda y el pico se miden en la salida completa.';
  if (!modulationOn || brumaDepth === 0) {
    readout.mod.textContent = 'Desactivada';
  } else if (chordsLevel === 0) {
    readout.mod.textContent = 'Acordes silenciados';
  } else {
    readout.mod.textContent = `${modRateHz.toFixed(1)} Hz · ${Math.round(brumaDepth * 100)} %`;
  }
}

function showMeasurement(m) {
  const p = session.params;
  const isBruma = p.source === 'bruma';
  if (!m || m.silent) {
    for (const el of Object.values(readout)) el.textContent = '—';
    readout.mod.dataset.status = '';
    readout.mod.title = '';
    if (isBruma) showBrumaModulation(p);
    readout.clip.dataset.alert = 'false';
    return;
  }
  if (isBruma) {
    showBrumaModulation(p);
  } else {
    readout.mod.dataset.status = m.status;
    readout.mod.textContent =
      m.status === 'ok'
        ? `${m.frequency.toFixed(1)} Hz · ${Math.round(m.depth * 100)} %`
        : MOD_STATUS_TEXT[m.status];
    readout.mod.title = `${MOD_STATUS_HINT[m.status] ?? ''} Ventana de análisis: ${m.windowSec.toFixed(2)} s.`.trim();
  }
  // La portadora se mide por cruces por cero en el modo de tono puro.
  readout.carrier.textContent = !isBruma && p.toneLevel > 0 && p.rainLevel === 0
    ? `${m.carrierHz.toFixed(1)} Hz`
    : 'n/d (mezcla)';
  readout.peak.textContent = `${toDbfs(m.peak).toFixed(1)} dBFS`;
  readout.clip.textContent = m.clipped > 0 ? `SÍ (${m.clipped} muestras)` : 'no';
  readout.clip.dataset.alert = String(m.clipped > 0);
}

let measureTimer = 0;
function setMeasuring(on) {
  if (on && !measureTimer) {
    measureTimer = setInterval(() => {
      const estimateTone = session.params.source !== 'bruma';
      showMeasurement(getAnalyzer()?.measure({ estimateTone }));
    }, 1000);
  } else if (!on && measureTimer) {
    clearInterval(measureTimer);
    measureTimer = 0;
    showMeasurement(null);
  }
}

// ---- Render de estado ----------------------------------------------------------
const LABELS = { idle: 'Detenido', starting: 'Preparando audio…', playing: 'Reproduciendo', paused: 'En pausa', stopping: 'Finalizando…' };
const REASONS = { completed: 'Sesión completada', error: 'Error de audio — revisa la consola' };
const fmtTime = (sec) => {
  const s = Math.ceil(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let lastState = null;
let lastSource = null;
let lastParams = null;
function render({ state, remainingSec, reason, params }) {
  $('#remaining').textContent = fmtTime(remainingSec);
  if (params.source !== lastSource) {
    lastSource = params.source;
    const isBruma = lastSource === 'bruma';
    sourceSelect.value = lastSource;
    controls.showSource(lastSource);
    $('#mod-target').textContent = isBruma ? '(solo acordes)' : '(toda la mezcla)';
    $('#m-mod-label').textContent = isBruma ? 'Modulación de acordes (ajuste)' : 'Modulación medida';
    showMeasurement(null);
  }
  if (params !== lastParams) {
    lastParams = params;
    if (params.source === 'bruma') showBrumaModulation(params);
  }
  if (state === lastState && !reason) return;
  lastState = state;

  $('#status-label').textContent = (state === 'idle' && REASONS[reason]) || LABELS[state];
  document.body.dataset.state = state;
  btnStart.disabled = state !== 'idle';
  sourceSelect.disabled = state !== 'idle';
  btnPause.disabled = state !== 'playing' && state !== 'paused';
  btnPause.textContent = state === 'paused' ? 'Reanudar' : 'Pausar';
  btnStop.disabled = state === 'idle' || state === 'stopping';
  controls.lock(state !== 'idle');

  if (state === 'playing' || state === 'stopping') scope.start();
  else scope.stop();
  setMeasuring(state === 'playing');
}

session.addEventListener('change', (e) => render(e.detail));
render(session.snapshot());

// Errores: anuncio inmediato para tecnologías de asistencia (role="alert").
const alertBox = $('#alert');
session.addEventListener('error', (e) => {
  alertBox.textContent = `No se pudo reproducir el audio: ${e.detail?.message ?? 'error desconocido'}.`;
  alertBox.hidden = false;
});
btnStart.addEventListener('click', () => {
  alertBox.hidden = true;
  alertBox.textContent = '';
});

window.addEventListener('pagehide', () => {
  session.panic();
  analyzer = null; // no retener nodos del contexto cerrado
});
