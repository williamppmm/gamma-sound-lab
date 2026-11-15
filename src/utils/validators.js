import { PARAM_SPEC } from '../audio/limits.js';

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

export function sanitizeValue(key, value, fallback) {
  const spec = PARAM_SPEC[key];
  if (!spec) return undefined;
  switch (spec.kind) {
    case 'number': {
      const n = toNumber(value);
      if (!Number.isFinite(n)) return fallback;
      return clamp(spec.integer ? Math.round(n) : n, spec.min, spec.max);
    }
    case 'enum':
      return spec.values.includes(value) ? value : fallback;
    case 'boolean':
      return typeof value === 'boolean' ? value : fallback;
    default:
      return fallback;
  }
}

export function defaultParams() {
  return Object.fromEntries(Object.entries(PARAM_SPEC).map(([k, s]) => [k, s.default]));
}

/**
 * Devuelve un objeto de parámetros completo y válido.
 * Las claves de `input` se validan y recortan a su rango; las ausentes o
 * inválidas toman el valor de `base`. Las claves desconocidas se descartan.
 */
export function sanitizeParams(input = {}, base = defaultParams()) {
  const src = input ?? {};
  const out = {};
  for (const key of Object.keys(PARAM_SPEC)) {
    const fallback = base[key] ?? PARAM_SPEC[key].default;
    out[key] = Object.hasOwn(src, key) ? sanitizeValue(key, src[key], fallback) : fallback;
  }
  return Object.freeze(out);
}
