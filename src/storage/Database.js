// Almacenamiento local en IndexedDB. Sin dependencias: envuelve la API nativa en promesas.

export const DB_NAME = 'gamma-sound-lab';
export const DB_VERSION = 1;
export const PRESET_STORE = 'presets';

const promisify = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Abre (o crea) la base de datos. `indexedDB` es inyectable para las pruebas.
 * Las actualizaciones de esquema futuras se añaden en `onupgradeneeded` según oldVersion.
 */
export function openDatabase({ indexedDB = globalThis.indexedDB, name = DB_NAME } = {}) {
  if (!indexedDB) return Promise.reject(new Error('IndexedDB no está disponible en este navegador'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) db.createObjectStore(PRESET_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña'));
  });
}

/** Almacén de presets del usuario. */
export class PresetStore {
  #db;

  /** @param db IDBDatabase o promesa de IDBDatabase */
  constructor(db) {
    this.#db = Promise.resolve(db);
  }

  async #run(mode, fn) {
    const db = await this.#db;
    const tx = db.transaction(PRESET_STORE, mode);
    const result = await promisify(fn(tx.objectStore(PRESET_STORE)));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada'));
    });
    return result;
  }

  list() {
    return this.#run('readonly', (s) => s.getAll());
  }
  async get(id) {
    return (await this.#run('readonly', (s) => s.get(id))) ?? null;
  }
  put(preset) {
    return this.#run('readwrite', (s) => s.put(preset));
  }
  delete(id) {
    return this.#run('readwrite', (s) => s.delete(id));
  }
}
