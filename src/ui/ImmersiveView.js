import {
  colorForLuminance,
  createAmbientState,
  musicFeatures,
  nextReference,
  sanitizeAmbientOptions,
  stepAmbient,
} from '../visual/ambient.js';
import {
  clampDepth,
  createFrameGuard,
  estimateRefreshRate,
  flickerCompatibility,
  lampDiameter,
  lampLuminance,
  LIGHT,
  lightStopReason,
  luminanceSwing,
  opacityForLuminance,
} from '../visual/light.js';

const MEASURE_FRAMES = 90;
const IDLE_HINT =
  `La luz modulada solo se activa durante una sesión con la modulación encendida entre ${LIGHT.minRateHz} y ` +
  `${LIGHT.maxRateHz} Hz, en pantallas de al menos 120 Hz. Cualquier tecla, clic o toque la apaga.`;

/**
 * Vista inmersiva a pantalla completa.
 * - Nivel 1: campo de luz que respira con la música (sin destellos, ver visual/ambient.js).
 * - Nivel 2: lámpara con luz modulada en fase con el sonido, experimental, con consentimiento
 *   en cada activación y todas las salvaguardas de visual/light.js.
 * No guarda nada: ni la luz ni el consentimiento se conservan entre sesiones o en presets.
 */
export class ImmersiveView {
  #session;
  #getAnalyser;
  #el;
  #ctx2d;
  #raf = 0;
  #lastTs = 0;
  #ambient = createAmbientState();
  #reference = 1e-3;
  #time = 0;
  #buffers = null;
  #ambientOptions = loadAmbientOptions();
  // Luz modulada
  #light = null; // { phase, lastCtxTime, guard, expectedMs, timer }
  #measuring = null; // { intervals, resolve }
  #stopListeners = null;

  constructor(root, { session, getAnalyser, consentDialog }) {
    this.#session = session;
    this.#getAnalyser = getAnalyser;
    const $ = (sel) => root.querySelector(sel);
    this.#el = {
      root,
      canvas: $('.immersive__ambient'),
      backdrop: $('.immersive__lamp-backdrop'),
      lamp: $('.immersive__lamp'),
      sessionInfo: $('#immersive-session'),
      depth: $('#light-depth'),
      depthOut: $('#light-depth-out'),
      ambientColor: $('#ambient-color'),
      ambientBrightness: $('#ambient-brightness'),
      lightBtn: $('#btn-light'),
      closeBtn: $('#btn-immersive-close'),
      status: $('#light-status'),
      consent: consentDialog,
    };
    this.#ctx2d = this.#el.canvas.getContext('2d');
    const e = this.#el;
    e.depth.min = String(Math.round(LIGHT.minDepth * 100));
    e.depth.max = String(Math.round(LIGHT.maxDepth * 100));
    e.depth.value = String(Math.round(LIGHT.defaultDepth * 100));
    const showDepth = () => {
      const d = clampDepth(Number(e.depth.value) / 100);
      e.depthOut.textContent = `${Math.round(d * 100)} % (Δ luminancia ${luminanceSwing(d).toFixed(3)})`;
    };
    e.depth.addEventListener('input', showDepth);
    showDepth();
    e.ambientColor.value = this.#ambientOptions.color;
    e.ambientBrightness.value = this.#ambientOptions.brightness;
    const onAmbient = () => {
      this.#ambientOptions = sanitizeAmbientOptions({
        color: e.ambientColor.value,
        brightness: e.ambientBrightness.value,
      });
      saveAmbientOptions(this.#ambientOptions);
    };
    e.ambientColor.addEventListener('change', onAmbient);
    e.ambientBrightness.addEventListener('change', onAmbient);
    e.lightBtn.addEventListener('click', () => (this.#light ? this.#stopLight('Luz detenida.') : this.#requestLight()));
    e.closeBtn.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !this.#light) this.close();
    });
    session.addEventListener('change', (ev) => this.#onSessionChange(ev.detail));
  }

  get isOpen() {
    return !this.#el.root.hidden;
  }

  open() {
    this.#el.root.hidden = false;
    this.#say(IDLE_HINT);
    this.#lastTs = 0;
    if (!this.#raf) this.#raf = requestAnimationFrame(this.#frame);
    this.#el.closeBtn.focus();
  }

  close() {
    this.#stopLight();
    this.#el.root.hidden = true;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  // ---- Bucle de dibujo -----------------------------------------------------------

  #frame = (ts) => {
    const dt = this.#lastTs ? (ts - this.#lastTs) / 1000 : 1 / 60;
    if (this.#lastTs && this.#measuring) this.#measuring.intervals.push(ts - this.#lastTs);
    if (this.#lastTs && this.#light) {
      if (this.#light.guard(ts - this.#lastTs) === 'irregular') {
        this.#stopLight('Luz detenida: la pantalla perdió fotogramas y el parpadeo dejaría de ser estable.');
      }
    }
    this.#lastTs = ts;
    this.#time += dt;
    this.#drawAmbient(dt);
    if (this.#light) this.#drawLamp(ts);
    if (this.#measuring && this.#measuring.intervals.length >= MEASURE_FRAMES) {
      const { intervals, resolve } = this.#measuring;
      this.#measuring = null;
      resolve(intervals);
    }
    this.#raf = requestAnimationFrame(this.#frame);
  };

  #readFeatures(dt) {
    const node = this.#getAnalyser();
    if (!node || this.#session.state !== 'playing') return { energy: 0, brightness: 0 };
    if (!this.#buffers || this.#buffers.node !== node) {
      this.#buffers = {
        node,
        time: new Float32Array(node.fftSize),
        freq: new Float32Array(node.frequencyBinCount),
      };
    }
    const { time, freq } = this.#buffers;
    node.getFloatTimeDomainData(time);
    node.getFloatFrequencyData(freq);
    let sum = 0;
    for (const v of time) sum += v * v;
    const rms = Math.sqrt(sum / time.length);
    const binHz = node.context.sampleRate / node.fftSize;
    let num = 0;
    let den = 0;
    for (let i = 1; i < freq.length; i++) {
      const mag = 10 ** (freq[i] / 20);
      num += i * binHz * mag;
      den += mag;
    }
    this.#reference = nextReference(this.#reference, rms, dt);
    return musicFeatures({ rms, centroidHz: den > 0 ? num / den : 0 }, this.#reference);
  }

  #drawAmbient(dt) {
    const canvas = this.#el.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.#ambient = stepAmbient(this.#ambient, this.#readFeatures(dt), dt, this.#ambientOptions);
    const { luminance, hue } = this.#ambient;
    const c = this.#ctx2d;
    // Movimiento muy lento del centro (no cambia el brillo); desactivado con "reducir movimiento".
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const drift = still ? 0 : 0.08;
    const cx = w * (0.5 + drift * Math.sin(this.#time * 0.07));
    const cy = h * (0.5 + drift * Math.cos(this.#time * 0.05));
    const [r, g, b] = colorForLuminance(hue, luminance);
    const [r2, g2, b2] = colorForLuminance(hue + 40, luminance * 0.35);
    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.6);
    grad.addColorStop(0, `rgb(${r},${g},${b})`);
    grad.addColorStop(0.45, `rgb(${r2},${g2},${b2})`);
    grad.addColorStop(1, 'rgb(4,5,8)');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
  }

  // ---- Luz modulada (nivel 2) ------------------------------------------------------

  #preconditions() {
    const p = this.#session.params;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'El sistema pide reducir el movimiento: la luz modulada está desactivada.';
    }
    if (this.#session.state !== 'playing' || !this.#session.modulationClock) {
      return 'Inicia una sesión primero: la luz va en fase con la modulación del sonido.';
    }
    if (!p.modulationOn) return 'La modulación está desactivada (A/B): la luz también.';
    if (p.modRateHz < LIGHT.minRateHz || p.modRateHz > LIGHT.maxRateHz) {
      return `La luz solo se ofrece entre ${LIGHT.minRateHz} y ${LIGHT.maxRateHz} Hz; la modulación está en ${p.modRateHz} Hz.`;
    }
    return '';
  }

  async #requestLight() {
    const problem = this.#preconditions();
    if (problem) return this.#say(problem, true);

    if (!(await this.#askConsent())) return this.#say('Luz no activada.');

    this.#say('Midiendo la frecuencia de la pantalla…');
    this.#el.lightBtn.disabled = true;
    const intervals = await new Promise((resolve) => (this.#measuring = { intervals: [], resolve }));
    this.#el.lightBtn.disabled = false;
    const { hz, jitterMs } = estimateRefreshRate(intervals);

    const again = this.#preconditions(); // pudo cambiar mientras se medía
    if (again) return this.#say(again, true);
    const compat = flickerCompatibility({
      refreshHz: hz,
      jitterMs,
      rateHz: this.#session.params.modRateHz,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    if (!compat.ok) return this.#say(compat.reason, true);
    this.#startLight(1000 / hz, compat.framesPerCycle);
  }

  #askConsent() {
    const dialog = this.#el.consent;
    for (const box of dialog.querySelectorAll('input[type="checkbox"]')) box.checked = false;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true });
    });
  }

  #startLight(expectedMs, framesPerCycle) {
    const clock = this.#session.modulationClock;
    const t = audibleTime(clock.context, performance.now());
    const rate = this.#session.params.modRateHz;
    this.#light = {
      start: { rateHz: rate, viewport: viewportSize() }, // condiciones con las que se comprobó
      depth: clampDepth(Number(this.#el.depth.value) / 100),
      phase: (rate * (t - clock.startTime)) % 1,
      lastCtxTime: t,
      expectedMs,
      guard: createFrameGuard(expectedMs),
      timer: setTimeout(
        () => this.#stopLight(`Luz detenida: alcanzó el máximo de ${LIGHT.maxMinutes} minutos por activación.`),
        LIGHT.maxMinutes * 60_000,
      ),
    };
    const d = lampDiameter({ width: window.innerWidth, height: window.innerHeight });
    Object.assign(this.#el.backdrop.style, { width: `${d * 1.15}px`, height: `${d * 1.15}px` });
    Object.assign(this.#el.lamp.style, { width: `${d}px`, height: `${d}px` });
    this.#el.backdrop.hidden = false;
    this.#el.depth.disabled = true;
    this.#el.lightBtn.textContent = 'Detener luz';
    this.#el.root.dataset.light = 'on';
    this.#say(
      `Luz activa a ${rate} Hz (${framesPerCycle.toFixed(1)} fotogramas por ciclo). ` +
        'Cualquier tecla, clic o toque la apaga. Detenla ante cualquier molestia.',
    );

    // Cualquier interacción la detiene. Se registra en el siguiente ciclo para no capturar
    // el propio clic que la activó.
    const stop = () => this.#stopLight('Luz detenida.');
    const check = () => this.#checkLight();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    // Cambios de condiciones: se registran ya (no dependen del clic que la activó).
    window.addEventListener('resize', check);
    document.addEventListener('fullscreenchange', check);
    document.addEventListener('visibilitychange', check);
    motion.addEventListener('change', check);
    window.addEventListener('blur', stop, { once: true });
    let interactionListeners = false;
    this.#stopListeners = () => {
      window.removeEventListener('resize', check);
      document.removeEventListener('fullscreenchange', check);
      document.removeEventListener('visibilitychange', check);
      motion.removeEventListener('change', check);
      window.removeEventListener('blur', stop);
      if (interactionListeners) {
        window.removeEventListener('keydown', stop, { capture: true });
        window.removeEventListener('pointerdown', stop, { capture: true });
      }
    };
    // Teclas y toques: en el siguiente ciclo, para no capturar el propio clic que la activó.
    setTimeout(() => {
      if (!this.#light) return;
      window.addEventListener('keydown', stop, { capture: true, once: true });
      window.addEventListener('pointerdown', stop, { capture: true, once: true });
      interactionListeners = true;
    }, 0);
  }

  /** Apaga la luz si cualquier condición comprobada al activarla ha cambiado. */
  #checkLight() {
    if (!this.#light) return;
    const p = this.#session.params;
    const reason = lightStopReason(this.#light.start, {
      state: this.#session.state,
      modulationOn: p.modulationOn,
      rateHz: p.modRateHz,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      viewport: viewportSize(),
      hidden: document.hidden,
    });
    if (reason) this.#stopLight(reason);
  }

  #drawLamp(ts) {
    const clock = this.#session.modulationClock;
    if (!clock) return this.#stopLight('Luz detenida: la sesión terminó.');
    const t = audibleTime(clock.context, ts);
    const light = this.#light;
    // Fase integrada con el reloj de audio: sigue los cambios de frecuencia y se congela en pausa.
    light.phase = (light.phase + this.#session.params.modRateHz * Math.max(0, t - light.lastCtxTime)) % 1;
    light.lastCtxTime = t;
    this.#el.lamp.style.opacity = String(opacityForLuminance(lampLuminance(light.phase, light.depth)));
  }

  #stopLight(message) {
    if (this.#measuring) {
      this.#measuring.resolve([]);
      this.#measuring = null;
    }
    if (!this.#light) {
      if (message) this.#say(message);
      return;
    }
    clearTimeout(this.#light.timer);
    this.#light = null;
    this.#stopListeners?.();
    this.#stopListeners = null;
    this.#el.lamp.style.opacity = '0';
    this.#el.backdrop.hidden = true;
    this.#el.depth.disabled = false;
    this.#el.lightBtn.textContent = 'Luz modulada (experimental)…';
    delete this.#el.root.dataset.light;
    this.#say(message ?? 'Luz detenida.');
  }

  #onSessionChange({ state, params, remainingSec }) {
    if (this.isOpen) {
      const s = Math.ceil(remainingSec);
      const time = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      const label = { idle: 'Detenido', starting: 'Preparando…', playing: 'Reproduciendo', paused: 'En pausa', stopping: 'Finalizando…' }[state];
      this.#el.sessionInfo.textContent = `${label} · ${time}`;
    }
    this.#checkLight();
  }

  #say(message, isError = false) {
    this.#el.status.textContent = message;
    this.#el.status.dataset.error = String(isError);
  }
}

const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

// Preferencias del campo ambiental: solo comodidad de este navegador (nunca la luz modulada).
const AMBIENT_KEY = 'gamma-sound-lab:ambient';
function loadAmbientOptions() {
  try {
    return sanitizeAmbientOptions(JSON.parse(localStorage.getItem(AMBIENT_KEY)));
  } catch {
    return sanitizeAmbientOptions(null);
  }
}
function saveAmbientOptions(options) {
  try {
    localStorage.setItem(AMBIENT_KEY, JSON.stringify(options));
  } catch {
    /* sin almacenamiento: la opción dura hasta recargar */
  }
}

/** Tiempo del AudioContext que se está oyendo en el instante `perfNow` (ms de performance). */
function audibleTime(ctx, perfNow) {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.performanceTime > 0) return ts.contextTime + (perfNow - ts.performanceTime) / 1000;
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}
