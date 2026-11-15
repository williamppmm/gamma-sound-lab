import { BUILTIN_PRESETS, isBuiltinId } from './defaultPresets.js';
import { createPreset, parseBundle, PresetError, serializeBundle } from './schema.js';

const byName = (a, b) => a.name.localeCompare(b.name, 'es');

/**
 * Biblioteca de presets: los incluidos (solo lectura) más los del usuario (en `store`).
 * `store` es un PresetStore (IndexedDB) o cualquier objeto con list/get/put/delete.
 */
export class PresetManager {
  #store;
  #now;
  #newId;

  constructor(store, { now = () => new Date(), newId = () => crypto.randomUUID() } = {}) {
    this.#store = store;
    this.#now = now;
    this.#newId = newId;
  }

  get hasStorage() {
    return Boolean(this.#store);
  }

  async list() {
    const user = this.#store ? (await this.#store.list()).sort(byName) : [];
    return [...BUILTIN_PRESETS, ...user];
  }

  async get(id) {
    return BUILTIN_PRESETS.find((p) => p.id === id) ?? (this.#store ? await this.#store.get(id) : null);
  }

  /**
   * Guarda los parámetros con un nombre. Si ya existe un preset del usuario con ese nombre,
   * lo actualiza (conserva id y fecha de creación); si no, crea uno nuevo.
   * @returns {{ preset, updated: boolean }}
   */
  async save(name, params) {
    this.#requireStorage();
    const now = this.#now();
    const draft = createPreset(name, params, { now });
    const existing = (await this.#store.list()).find((p) => p.name === draft.name);
    const preset = existing
      ? { ...draft, id: existing.id, createdAt: existing.createdAt }
      : { ...draft, id: this.#newId() };
    await this.#store.put(preset);
    return { preset, updated: Boolean(existing) };
  }

  async remove(id) {
    if (isBuiltinId(id)) throw new PresetError('Los presets incluidos no se pueden eliminar');
    this.#requireStorage();
    await this.#store.delete(id);
  }

  /** JSON con los presets del usuario (o los indicados por id, incluidos los de serie). */
  async exportJSON(ids) {
    const all = await this.list();
    const chosen = ids ? all.filter((p) => ids.includes(p.id)) : all.filter((p) => !p.builtin);
    return serializeBundle(chosen, { now: this.#now() });
  }

  /**
   * Importa un JSON. Cada preset recibe un id nuevo: importar nunca sobrescribe por id.
   * @returns {{ imported: object[], errors: { index, message }[] }}
   */
  async importJSON(text) {
    this.#requireStorage();
    const { presets, errors } = parseBundle(text, { now: this.#now() });
    const imported = [];
    for (const p of presets) {
      const preset = { ...p, id: this.#newId() };
      await this.#store.put(preset);
      imported.push(preset);
    }
    return { imported, errors };
  }

  #requireStorage() {
    if (!this.#store) throw new PresetError('El almacenamiento local no está disponible en este navegador');
  }
}
