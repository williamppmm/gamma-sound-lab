import { MAX_MASTER_GAIN } from '../audio/limits.js';

/**
 * Osciloscopio: dibuja las últimas `viewSamples` muestras con min/max por
 * columna de píxel, así la envolvente de 40 Hz se ve aunque la portadora sea rápida.
 * Escala fija: el borde del lienzo = MAX_MASTER_GAIN (100 % de volumen).
 */
export class WaveformVisualizer {
  #canvas;
  #c2d;
  #getSamples;
  #viewSamples;
  #raf = 0;
  #colors = null;

  constructor(canvas, getSamples, { viewSamples = 4096 } = {}) {
    this.#canvas = canvas;
    this.#c2d = canvas.getContext('2d');
    this.#getSamples = getSamples;
    this.#viewSamples = viewSamples;
  }

  start() {
    if (this.#raf) return;
    this.#colors = null;
    this.#loop();
  }

  stop() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#draw(null);
  }

  #loop = () => {
    this.#draw(this.#getSamples());
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.#canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.#canvas.clientHeight * dpr));
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
    return { w, h, dpr };
  }

  #draw(samples) {
    const { w, h, dpr } = this.#resize();
    const c = this.#c2d;
    if (!this.#colors) {
      const s = getComputedStyle(this.#canvas);
      this.#colors = { grid: s.getPropertyValue('--grid').trim(), wave: s.getPropertyValue('--accent').trim() };
    }
    const mid = h / 2;
    c.clearRect(0, 0, w, h);
    c.lineWidth = dpr;
    c.strokeStyle = this.#colors.grid;
    c.beginPath();
    c.moveTo(0, mid);
    c.lineTo(w, mid);
    c.stroke();
    if (!samples) return;

    const n = Math.min(this.#viewSamples, samples.length);
    const start = samples.length - n;
    const per = n / w;
    const scale = (mid * 0.92) / MAX_MASTER_GAIN;
    c.strokeStyle = this.#colors.wave;
    c.beginPath();
    for (let x = 0; x < w; x++) {
      const from = start + Math.floor(x * per);
      const to = Math.max(from + 1, start + Math.floor((x + 1) * per));
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = from; i < to; i++) {
        const v = samples[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      c.moveTo(x + 0.5, mid - hi * scale);
      c.lineTo(x + 0.5, mid - lo * scale + 1);
    }
    c.stroke();
  }
}
