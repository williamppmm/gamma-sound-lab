import { createPreset } from './schema.js';

const FIXED_DATE = new Date('2026-11-15T00:00:00Z');

/** Presets incluidos con la aplicación. Son de solo lectura (id con prefijo "builtin:"). */
export const BUILTIN_PRESETS = Object.freeze(
  [
    {
      id: 'builtin:bruma',
      name: 'Bruma de cristal · acordes a 40 Hz (20 %)',
      params: { source: 'bruma', modRateHz: 40, chordsDepth: 0.2, melodyLevel: 1, chordsLevel: 1 },
    },
    {
      id: 'builtin:generativa',
      name: 'Composición generativa · Re pentatónica',
      params: {
        source: 'generative',
        genSeed: 7,
        genMode: 'pentatonic',
        genRoot: 'D',
        genTempo: 68,
        modRateHz: 40,
        chordsDepth: 0.3,
      },
    },
    {
      id: 'builtin:tono-40',
      name: 'Laboratorio · tono 220 Hz con AM 40 Hz (50 %)',
      params: { source: 'tone-rain', carrierHz: 220, modRateHz: 40, depth: 0.5, toneLevel: 1, rainLevel: 0 },
    },
    {
      id: 'builtin:tono-lluvia',
      name: 'Tono y lluvia · AM 40 Hz sobre la mezcla',
      params: { source: 'tone-rain', carrierHz: 196, modRateHz: 40, depth: 0.5, toneLevel: 0.6, rainLevel: 0.5 },
    },
    {
      id: 'builtin:ab-control',
      name: 'Control A/B · tono sin modulación (sonoridad igualada)',
      params: { source: 'tone-rain', carrierHz: 220, depth: 0.5, modulationOn: false, abMatchLoudness: true },
    },
  ].map(({ id, name, params }) => Object.freeze({ ...createPreset(name, params, { id, now: FIXED_DATE }), builtin: true })),
);

export const isBuiltinId = (id) => typeof id === 'string' && id.startsWith('builtin:');
