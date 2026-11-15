/**
 * Panel de presets: elegir, cargar, guardar, eliminar, exportar e importar JSON.
 * No conoce el motor: recibe callbacks para leer y aplicar parámetros.
 */
export class PresetPanel {
  #manager;
  #getParams;
  #applyParams;
  #el;
  #locked = false;

  constructor(root, manager, { getParams, applyParams }) {
    this.#manager = manager;
    this.#getParams = getParams;
    this.#applyParams = applyParams;
    const $ = (sel) => root.querySelector(sel);
    this.#el = {
      select: $('#preset-select'),
      load: $('#btn-preset-load'),
      remove: $('#btn-preset-delete'),
      name: $('#preset-name'),
      save: $('#btn-preset-save'),
      exportBtn: $('#btn-preset-export'),
      importInput: $('#preset-import'),
      importLabel: $('#preset-import-label'),
      status: $('#preset-status'),
    };
    const e = this.#el;
    e.load.addEventListener('click', () => this.#load());
    e.remove.addEventListener('click', () => this.#remove());
    e.save.addEventListener('click', () => this.#save());
    e.name.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.#save();
      }
    });
    e.exportBtn.addEventListener('click', () => this.#export());
    e.importInput.addEventListener('change', () => this.#import());
    e.select.addEventListener('change', () => this.#syncButtons());
    if (!manager.hasStorage) {
      this.#say('El almacenamiento local no está disponible: solo puedes usar los presets incluidos.');
    }
    this.refresh();
  }

  /** Durante una sesión no se pueden cargar presets (cambiarían parámetros bloqueados). */
  lock(locked) {
    this.#locked = locked;
    this.#syncButtons();
  }

  async refresh(selectId) {
    const list = await this.#manager.list();
    const { select } = this.#el;
    const previous = selectId ?? select.value;
    select.replaceChildren();
    const groups = [
      ['Incluidos', list.filter((p) => p.builtin)],
      ['Mis presets', list.filter((p) => !p.builtin)],
    ];
    for (const [label, items] of groups) {
      if (items.length === 0) continue;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const p of items) group.append(new Option(p.name, p.id));
      select.append(group);
    }
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
    this.#syncButtons();
  }

  #selectedId() {
    return this.#el.select.value;
  }

  #syncButtons() {
    const e = this.#el;
    const id = this.#selectedId();
    const storage = this.#manager.hasStorage;
    e.load.disabled = this.#locked || !id;
    e.remove.disabled = this.#locked || !id || id.startsWith('builtin:') || !storage;
    e.save.disabled = !storage;
    e.name.disabled = !storage;
    e.importInput.disabled = !storage || this.#locked;
    e.importLabel.toggleAttribute('aria-disabled', e.importInput.disabled);
  }

  #say(message, isError = false) {
    this.#el.status.textContent = message;
    this.#el.status.dataset.error = String(isError);
  }

  async #run(fn) {
    try {
      await fn();
    } catch (err) {
      this.#say(err.message ?? String(err), true);
    }
  }

  #load() {
    return this.#run(async () => {
      const preset = await this.#manager.get(this.#selectedId());
      if (!preset) throw new Error('No se encontró el preset');
      this.#applyParams(preset.params);
      this.#el.name.value = preset.builtin ? '' : preset.name;
      this.#say(`Cargado «${preset.name}».`);
    });
  }

  #save() {
    return this.#run(async () => {
      const name = this.#el.name.value;
      const { preset, updated } = await this.#manager.save(name, this.#getParams());
      await this.refresh(preset.id);
      this.#say(updated ? `Actualizado «${preset.name}».` : `Guardado «${preset.name}».`);
    });
  }

  #remove() {
    return this.#run(async () => {
      const id = this.#selectedId();
      const preset = await this.#manager.get(id);
      if (!preset) return;
      if (!window.confirm(`¿Eliminar el preset «${preset.name}»?`)) return;
      await this.#manager.remove(id);
      await this.refresh();
      this.#say(`Eliminado «${preset.name}».`);
    });
  }

  #export() {
    return this.#run(async () => {
      const own = (await this.#manager.list()).filter((p) => !p.builtin);
      // Sin presets propios, exporta el seleccionado (útil para compartir uno incluido).
      const json = own.length ? await this.#manager.exportJSON() : await this.#manager.exportJSON([this.#selectedId()]);
      const date = new Date().toISOString().slice(0, 10);
      downloadText(json, `gamma-sound-lab-presets-${date}.json`, 'application/json');
      this.#say(own.length ? `Exportados ${own.length} presets.` : 'Exportado el preset seleccionado.');
    });
  }

  #import() {
    const input = this.#el.importInput;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    return this.#run(async () => {
      const { imported, errors } = await this.#manager.importJSON(await file.text());
      await this.refresh(imported[0]?.id);
      const parts = [`Importados ${imported.length} presets.`];
      if (errors.length) parts.push(`${errors.length} no válidos: ${errors.map((e) => `#${e.index + 1} ${e.message}`).join('; ')}.`);
      this.#say(parts.join(' '), imported.length === 0);
    });
  }
}

export function downloadText(text, filename, type) {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
