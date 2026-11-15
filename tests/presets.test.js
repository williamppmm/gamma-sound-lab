import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { PARAM_SPEC } from '../src/audio/limits.js';
import { BUILTIN_PRESETS } from '../src/presets/defaultPresets.js';
import { PresetManager } from '../src/presets/PresetManager.js';
import {
  BUNDLE_FORMAT,
  createPreset,
  migratePreset,
  parseBundle,
  PRESET_VERSION,
  PresetError,
  serializeBundle,
} from '../src/presets/schema.js';
import { openDatabase, PresetStore } from '../src/storage/Database.js';
import { defaultParams } from '../src/utils/validators.js';

const NOW = new Date('2026-11-15T12:00:00Z');

describe('esquema de presets', () => {
  it('createPreset valida y completa los parámetros', () => {
    const p = createPreset('  Mi preset  ', { volume: 7, source: 'bruma', hack: 1 }, { now: NOW });
    expect(p.version).toBe(PRESET_VERSION);
    expect(p.name).toBe('Mi preset');
    expect(p.params.volume).toBe(PARAM_SPEC.volume.max);
    expect(p.params.source).toBe('bruma');
    expect(p.params).not.toHaveProperty('hack');
    expect(Object.keys(p.params).sort()).toEqual(Object.keys(defaultParams()).sort());
  });

  it('migra parámetros sueltos de versiones anteriores (brumaDepth → chordsDepth)', () => {
    const p = migratePreset({ source: 'bruma', brumaDepth: 0.35, modRateHz: 38 }, { now: NOW });
    expect(p.version).toBe(1);
    expect(p.params.chordsDepth).toBe(0.35);
    expect(p.params).not.toHaveProperty('brumaDepth');
    expect(p.params.modRateHz).toBe(38);
    expect(p.name).toBe('Preset importado');
  });

  it('migra { name, params } sin versión', () => {
    const p = migratePreset({ name: 'Viejo', params: { brumaDepth: 0.1 } }, { now: NOW });
    expect(p.name).toBe('Viejo');
    expect(p.params.chordsDepth).toBe(0.1);
  });

  it('rechaza versiones futuras, objetos sin parámetros reconocibles y nombres vacíos', () => {
    expect(() => migratePreset({ version: 99, name: 'x', params: {} })).toThrow(/más nueva/);
    expect(() => migratePreset({ version: 1, name: 'x', params: { foo: 1 } })).toThrow(PresetError);
    expect(() => migratePreset({ version: 1, name: '   ', params: { volume: 0.1 } })).toThrow(/vacío/);
    expect(() => migratePreset('texto')).toThrow(PresetError);
  });

  it('los nombres se recortan y pierden caracteres de control', () => {
    const p = createPreset(`a\u0007b${'x'.repeat(100)}`, { volume: 0.1 });
    expect(p.name.startsWith('ab')).toBe(true);
    expect(p.name.length).toBe(60);
  });

  it('serializa y vuelve a leer un paquete sin pérdidas', () => {
    const presets = [createPreset('A', { volume: 0.1 }, { id: 'a', now: NOW }), createPreset('B', { source: 'generative', genSeed: 42 }, { id: 'b', now: NOW })];
    const text = serializeBundle(presets, { now: NOW });
    expect(JSON.parse(text).format).toBe(BUNDLE_FORMAT);
    const { presets: back, errors } = parseBundle(text, { now: NOW });
    expect(errors).toEqual([]);
    expect(back).toEqual(presets);
  });

  it('importa presets válidos aunque haya inválidos, y lo informa', () => {
    const text = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      presets: [{ version: 1, name: 'Bueno', params: { volume: 0.2 } }, { version: 1, name: 'Malo' }, 42],
    });
    const { presets, errors } = parseBundle(text);
    expect(presets.map((p) => p.name)).toEqual(['Bueno']);
    expect(errors.map((e) => e.index)).toEqual([1, 2]);
  });

  it('rechaza JSON roto, otros formatos y paquetes futuros', () => {
    expect(() => parseBundle('{no es json')).toThrow(/JSON/);
    expect(() => parseBundle(JSON.stringify({ format: 'otra-app', presets: [] }))).toThrow(/Gamma Sound Lab/);
    expect(() => parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 2, presets: [] }))).toThrow(/más nueva/);
    expect(() => parseBundle('x'.repeat(1_000_001))).toThrow(/grande/);
  });

  it('los presets incluidos son válidos y de solo lectura', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.builtin).toBe(true);
      expect(p.id.startsWith('builtin:')).toBe(true);
      expect(migratePreset(p).params).toEqual(p.params);
      expect(Object.isFrozen(p)).toBe(true);
    }
  });
});

describe('PresetManager sobre IndexedDB', () => {
  let counter = 0;
  const makeManager = async () => {
    const db = await openDatabase({ indexedDB: new IDBFactory(), name: `test-${++counter}` });
    return new PresetManager(new PresetStore(db), { now: () => NOW, newId: () => `id-${++counter}` });
  };

  it('lista los incluidos y guarda, actualiza y elimina presets del usuario', async () => {
    const m = await makeManager();
    expect((await m.list()).length).toBe(BUILTIN_PRESETS.length);

    const first = await m.save('Noche', { source: 'generative', genSeed: 11 });
    expect(first.updated).toBe(false);
    const again = await m.save('Noche', { source: 'generative', genSeed: 12 });
    expect(again.updated).toBe(true);
    expect(again.preset.id).toBe(first.preset.id);

    const list = await m.list();
    expect(list.length).toBe(BUILTIN_PRESETS.length + 1);
    expect((await m.get(first.preset.id)).params.genSeed).toBe(12);

    await m.remove(first.preset.id);
    expect(await m.get(first.preset.id)).toBeNull();
  });

  it('no permite borrar presets incluidos', async () => {
    const m = await makeManager();
    await expect(m.remove('builtin:bruma')).rejects.toThrow(PresetError);
  });

  it('exporta e importa entre bibliotecas, sin sobrescribir por id', async () => {
    const a = await makeManager();
    await a.save('Uno', { volume: 0.1 });
    await a.save('Dos', { source: 'bruma', chordsDepth: 0.4 });
    const text = await a.exportJSON();

    const b = await makeManager();
    await b.save('Uno', { volume: 0.3 });
    const { imported, errors } = await b.importJSON(text);
    expect(errors).toEqual([]);
    expect(imported).toHaveLength(2);
    const names = (await b.list()).filter((p) => !p.builtin).map((p) => p.name);
    expect(names.sort()).toEqual(['Dos', 'Uno', 'Uno']);
  });

  it('sin almacenamiento sigue ofreciendo los incluidos pero no guarda', async () => {
    const m = new PresetManager(null);
    expect((await m.list()).length).toBe(BUILTIN_PRESETS.length);
    await expect(m.save('x', {})).rejects.toThrow(/almacenamiento/);
  });
});
