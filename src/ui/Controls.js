import { PARAM_SPEC } from '../audio/limits.js';
import { outputGain, toDbfs } from '../audio/dsp.js';

const FORMAT = {
  carrierHz: (v) => `${Math.round(v)} Hz`,
  modRateHz: (v) => `${v.toFixed(1)} Hz`,
  depth: (v) => `${Math.round(v * 100)} %`,
  volume: (v) => (v === 0 ? '0 %' : `${Math.round(v * 100)} % · ${toDbfs(outputGain(v)).toFixed(0)} dBFS`),
};

const scaleOf = (el) => Number(el.dataset.scale ?? 1);

/**
 * Enlaza el formulario con un callback de parámetros. No conoce el motor:
 * solo traduce entradas HTML ⇄ objeto de parámetros.
 * Los rangos min/max de los inputs se toman de PARAM_SPEC.
 */
export class Controls {
  #form;
  #onChange;

  constructor(form, onChange) {
    this.#form = form;
    this.#onChange = onChange;
    this.#applySpec();
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('input', (e) => this.#handle(e.target, false));
    form.addEventListener('change', (e) => this.#handle(e.target, true));
  }

  #fields() {
    return [...this.#form.elements].filter((el) => el.name in PARAM_SPEC);
  }

  #applySpec() {
    for (const el of this.#fields()) {
      const spec = PARAM_SPEC[el.name];
      if (spec.kind === 'number') {
        el.min = String(spec.min / scaleOf(el));
        el.max = String(spec.max / scaleOf(el));
      }
    }
  }

  #read(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.type === 'number') {
      return el.value.trim() === '' ? NaN : Number(el.value) * scaleOf(el);
    }
    return el.value;
  }

  #handle(el, committed) {
    if (!(el.name in PARAM_SPEC)) return;
    const params = this.#onChange({ [el.name]: this.#read(el) });
    // Al confirmar (blur/enter), refleja el valor recortado al rango.
    if (committed) this.write(params);
    else this.#writeOutput(el.name, params[el.name]);
  }

  #writeOutput(name, value) {
    const out = this.#form.querySelector(`output[data-for="${name}"]`);
    if (out && FORMAT[name]) out.textContent = FORMAT[name](value);
  }

  write(params) {
    for (const el of this.#fields()) {
      const v = params[el.name];
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else if (typeof v === 'number') el.value = String(+(v / scaleOf(el)).toFixed(4));
      else el.value = v;
      this.#writeOutput(el.name, v);
    }
  }

  /** Bloquea los campos marcados con data-lock (p. ej. duración) durante una sesión. */
  lock(locked) {
    for (const el of this.#form.querySelectorAll('[data-lock]')) el.disabled = locked;
  }
}
