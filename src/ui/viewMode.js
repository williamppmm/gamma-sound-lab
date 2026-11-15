// Vista inicial: en teléfonos, la vista de colores con controles básicos; en el resto, el
// laboratorio. Función pura (probada en Node); la preferencia explícita del usuario manda.

export const VIEW_KEY = 'gamma-sound-lab:view';
export const VIEWS = Object.freeze(['simple', 'lab']);
export const PHONE_MAX_SHORT_SIDE = 600;

/** ¿Parece un teléfono? Pantalla táctil y lado corto ≤ 600 px (vale también en horizontal). */
export function isPhoneLike({ width, height, coarsePointer }) {
  return Boolean(coarsePointer) && Math.min(width, height) <= PHONE_MAX_SHORT_SIDE;
}

/**
 * @param stored  preferencia guardada ('simple' | 'lab' | cualquier otra cosa = ninguna)
 * @returns 'simple' | 'lab'
 */
export function initialView({ stored, width, height, coarsePointer }) {
  if (VIEWS.includes(stored)) return stored;
  return isPhoneLike({ width, height, coarsePointer }) ? 'simple' : 'lab';
}

export function readStoredView() {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

/** Solo se recuerda en teléfonos: en un ordenador abrir la vista de colores es puntual. */
export function storeView(view, device) {
  if (!VIEWS.includes(view) || !isPhoneLike(device)) return;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* sin almacenamiento: se decide de nuevo al cargar */
  }
}

export function currentDevice() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
  };
}
