import './styles/main.css';
import { AudioEngine } from './audio/AudioEngine.js';
import { SignalAnalyzer } from './audio/Analyzer.js';
import { toDbfs } from './audio/dsp.js';
import { SessionManager } from './sessions/SessionManager.js';
import { Controls } from './ui/Controls.js';
import { WaveformVisualizer } from './ui/Visualizer.js';
import { defaultParams } from './utils/validators.js';

const $ = (sel) => document.querySelector(sel);

const engine = new AudioEngine();
const session = new SessionManager(engine, defaultParams());
const controls = new Controls($('#controls'), (partial) => session.update(partial));
controls.write(session.params);

let analyzer = null;
function getAnalyzer() {
  const node = engine.analyser;
  if (!node) return null;
  if (analyzer?.node !== node) analyzer = new SignalAnalyzer(node);
  return analyzer;
}

const scope = new WaveformVisualizer($('#scope'), () => getAnalyzer()?.read() ?? null);
scope.stop();

const btnStart = $('#btn-start');
const btnPause = $('#btn-pause');
const btnStop = $('#btn-stop');
btnStart.addEventListener('click', () => session.start());
btnPause.addEventListener('click', () => (session.state === 'paused' ? session.resume() : session.pause()));
btnStop.addEventListener('click', () => session.stop());

// ---- Lectura de mediciones ---------------------------------------------------
const readout = {
  mod: $('#m-mod'),
  carrier: $('#m-carrier'),
  peak: $('#m-peak'),
  clip: $('#m-clip'),
};

function showMeasurement(m) {
  if (!m || m.silent) {
    for (const el of Object.values(readout)) el.textContent = '—';
    readout.clip.dataset.alert = 'false';
    return;
  }
  readout.mod.textContent =
    m.depth < 0.02 ? 'sin modulación detectable' : `${m.frequency.toFixed(2)} Hz · ${Math.round(m.depth * 100)} %`;
  readout.carrier.textContent = `${m.carrierHz.toFixed(1)} Hz`;
  readout.peak.textContent = `${toDbfs(m.peak).toFixed(1)} dBFS`;
  readout.clip.textContent = m.clipped > 0 ? `SÍ (${m.clipped} muestras)` : 'no';
  readout.clip.dataset.alert = String(m.clipped > 0);
}

let measureTimer = 0;
function setMeasuring(on) {
  if (on && !measureTimer) {
    measureTimer = setInterval(() => showMeasurement(getAnalyzer()?.measure()), 1000);
  } else if (!on && measureTimer) {
    clearInterval(measureTimer);
    measureTimer = 0;
    showMeasurement(null);
  }
}

// ---- Render de estado ----------------------------------------------------------
const LABELS = { idle: 'Detenido', playing: 'Reproduciendo', paused: 'En pausa', stopping: 'Finalizando…' };
const REASONS = { completed: 'Sesión completada', error: 'Error de audio — revisa la consola' };
const fmtTime = (sec) => {
  const s = Math.ceil(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let lastState = null;
function render({ state, remainingSec, reason }) {
  $('#remaining').textContent = fmtTime(remainingSec);
  if (state === lastState && !reason) return;
  lastState = state;

  $('#status-label').textContent = (state === 'idle' && REASONS[reason]) || LABELS[state];
  document.body.dataset.state = state;
  btnStart.disabled = state !== 'idle';
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

window.addEventListener('pagehide', () => session.panic());
