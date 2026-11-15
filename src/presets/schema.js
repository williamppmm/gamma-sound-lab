// Esquema versionado de presets. Funciones puras: validan, migran y serializan.
//
// Preset (versión 1):
//   { version: 1, id, name, createdAt, updatedAt, params: { ...PARAM_SPEC } }
// Paquete de exportación:
//   { format: 'gamma-sound-lab/presets', version: 1, exportedAt, presets: [preset, ...] }
//
// Compatibilidad: los parámetros pasan siempre por sanitizeParams(), así que los que falten
// toman su valor por defecto y los desconocidos se descartan. Los cambios incompatibles
// (p. ej. renombrar un parámetro) se resuelven con una migración en MIGRATIONS.
import { PARAM_SPEC } from '../audio/limits.js';
import { sanitizeParams } from '../utils/validators.js';

export const PRESET_VERSION = 1;
export const BUNDLE_FORMAT = 'gamma-sound-lab/presets';
export const NAME_MAX_LENGTH = 60;
export const BUNDLE_MAX_BYTES = 1_000_000;
export const BUNDLE_MAX_PRESETS = 500;

export class PresetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PresetError';
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Migraciones: MIGRATIONS[n] convierte un preset de la versión n a la n + 1.
 * Versión 0 = sin envoltorio: un objeto de parámetros suelto (o { name, params } sin versión),
 * de antes del esquema. En esas versiones la profundidad de los acordes se llamaba `brumaDepth`.
 */
const MIGRATIONS = {
  0: (raw) => {
    const params = { ...(isObject(raw.params) ? raw.params : raw) };
    if ('brumaDepth' in params && !('chordsDepth' in params)) params.chordsDepth = params.brumaDepth;
    delete params.brumaDepth;
    return { version: 1, name: raw.name ?? 'Preset importado', params };
  },
};

function versionOf(raw) {
  if (raw.version === undefined) return 0;
  if (!Number.isInteger(raw.version) || raw.version < 0) throw new PresetError('Versión de preset no válida');
  return raw.version;
}

export function sanitizeName(name) {
  if (typeof name !== 'string') throw new PresetError('El preset necesita un nombre');
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX_LENGTH);
  if (!clean) throw new PresetError('El nombre del preset está vacío');
  return clean;
}

const validDate = (v, fallback) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback);

/** Valida y lleva cualquier preset conocido a la versión actual. Lanza PresetError si no es válido. */
export function migratePreset(raw, { now = new Date() } = {}) {
  if (!isObject(raw)) throw new PresetError('El preset no es un objeto');
  let p = raw;
  let v = versionOf(p);
  if (v > PRESET_VERSION) {
    throw new PresetError(`El preset es de una versión más nueva (${v}); actualiza la aplicación`);
  }
  while (v < PRESET_VERSION) {
    p = MIGRATIONS[v](p);
    v = p.version;
  }
  if (!isObject(p.params)) throw new PresetError('El preset no tiene parámetros');
  const known = Object.keys(p.params).filter((k) => k in PARAM_SPEC);
  if (known.length === 0) throw new PresetError('El preset no contiene ningún parámetro reconocido');

  const iso = now.toISOString();
  const createdAt = validDate(p.createdAt, iso);
  return {
    version: PRESET_VERSION,
    id: typeof p.id === 'string' && p.id ? p.id : undefined,
    name: sanitizeName(p.name),
    createdAt,
    updatedAt: validDate(p.updatedAt, createdAt),
    params: { ...sanitizeParams(p.params) },
  };
}

export function createPreset(name, params, { id, now = new Date() } = {}) {
  const iso = now.toISOString();
  return migratePreset({ version: PRESET_VERSION, id, name, createdAt: iso, updatedAt: iso, params }, { now });
}

/** Serializa presets en un paquete JSON legible. */
export function serializeBundle(presets, { now = new Date() } = {}) {
  return JSON.stringify(
    {
      format: BUNDLE_FORMAT,
      version: PRESET_VERSION,
      exportedAt: now.toISOString(),
      presets: presets.map(({ version, id, name, createdAt, updatedAt, params }) => ({
        version,
        id,
        name,
        createdAt,
        updatedAt,
        params,
      })),
    },
    null,
    2,
  );
}

/**
 * Interpreta un JSON importado. Acepta un paquete, un preset suelto o una lista de presets.
 * Los presets inválidos no detienen la importación: se devuelven en `errors`.
 * @returns {{ presets: object[], errors: { index: number, message: string }[] }}
 */
export function parseBundle(text, { now = new Date() } = {}) {
  if (typeof text !== 'string') throw new PresetError('El archivo no es texto');
  if (text.length > BUNDLE_MAX_BYTES) throw new PresetError('El archivo es demasiado grande');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PresetError('El archivo no es un JSON válido');
  }

  let list;
  if (Array.isArray(data)) list = data;
  else if (isObject(data) && 'format' in data) {
    if (data.format !== BUNDLE_FORMAT) throw new PresetError('El archivo no es un paquete de presets de Gamma Sound Lab');
    if (Number.isInteger(data.version) && data.version > PRESET_VERSION) {
      throw new PresetError(`El paquete es de una versión más nueva (${data.version}); actualiza la aplicación`);
    }
    if (!Array.isArray(data.presets)) throw new PresetError('El paquete no contiene presets');
    list = data.presets;
  } else if (isObject(data)) list = [data];
  else throw new PresetError('El archivo no contiene presets');

  if (list.length > BUNDLE_MAX_PRESETS) throw new PresetError(`Demasiados presets (máximo ${BUNDLE_MAX_PRESETS})`);

  const presets = [];
  const errors = [];
  list.forEach((raw, index) => {
    try {
      presets.push(migratePreset(raw, { now }));
    } catch (err) {
      errors.push({ index, message: err.message });
    }
  });
  return { presets, errors };
}
