# Arquitectura

Principio rector: **el motor de audio no depende de la interfaz**. La UI solo habla con
`SessionManager` (reproducción) y con los gestores de presets y exportación; nunca crea ni
conecta nodos de audio.

## Capas

```
┌────────────────────────── Interfaz (src/ui, main.js) ──────────────────────────┐
│ Controls · Visualizer · PresetPanel · ExportPanel · aviso de actualización PWA │
└───────┬──────────────────────────┬───────────────────────────┬─────────────────┘
        │ update/start/stop        │ list/save/import          │ renderExport
┌───────▼────────┐        ┌────────▼────────┐        ┌─────────▼──────────┐
│ SessionManager │        │  PresetManager  │        │   AudioExporter    │
│ (estado, cola, │        │ schema + store  │        │ OfflineAudioContext│
│  fundidos)     │        │  (IndexedDB)    │        │ + verifyExport     │
└───────┬────────┘        └─────────────────┘        └─────────┬──────────┘
        │                                                      │
        │       sources.createVoice(ctx, params, signal)  ◄────┘  (mismo grafo)
        │                     │
┌───────▼────────┐   ┌────────▼───────────────────────────────────────────────┐
│  AudioEngine   │   │ Voces                                                  │
│  AudioContext  │   │  SessionVoice: Synthesizer + RainSource → Mixer → Mod  │
│  outputChain   │   │  PieceVoice:   melodía ───────────────► Mixer          │
└────────────────┘   │                acordes → Modulator(+sonda) ─┘          │
                     └────────────────────────────────────────────────────────┘

Funciones puras (Node y navegador): dsp.js · generators.js · music/composer.js · music/synth.js
                                    export/wav.js · export/exportPlan.js · presets/schema.js
```

## Cadena de salida (`audio/outputChain.js`)

```
voz → master (volumen ≤ −6 dBFS) → fade (sesión) → limitador (−3 dBFS, 20:1) → trim (−1,71 dB) → analizador → destino
```

La misma función construye la cadena del `AudioContext` en vivo y del `OfflineAudioContext`
de exportación. `trim` anula la ganancia de compensación automática del compresor.

## Módulos

| Ruta | Responsabilidad |
|---|---|
| `audio/limits.js` | Única fuente de verdad: rangos, valores por defecto, parámetros bloqueados en sesión, límites de seguridad |
| `utils/validators.js` | `sanitizeParams`: todo parámetro pasa por aquí (UI, presets, exportación) |
| `audio/dsp.js` | AM, normalización de mezcla, medición (Goertzel + CIC), pico, clipping |
| `audio/generators.js` | PRNG Mulberry32, lluvia en bucle |
| `audio/Modulator.js` | AM con `GainNode` + LFO, y sonda que reproduce g(t) para verificarla |
| `audio/Synthesizer.js`, `RainSource.js`, `Mixer.js` | Fuentes y mezcla del modo Tono y lluvia |
| `audio/PieceVoice.js` | Piezas de dos capas (Bruma, generativa) |
| `audio/sources.js` | Fábrica de voces y carga de recursos (FLAC, síntesis en Worker), con caché |
| `audio/AudioEngine.js` | Ciclo de vida del `AudioContext` |
| `sessions/SessionManager.js` | Máquina de estados: `idle → starting → playing ⇄ paused → stopping` |
| `music/composer.js`, `synth.js`, `pieceWorker.js` | Composición generativa y su síntesis en un Worker |
| `presets/` | Esquema versionado, migraciones, presets incluidos, gestor |
| `storage/Database.js` | IndexedDB sin dependencias |
| `export/` | Render offline, verificación, codificación WAV |
| `pwa/` | Service worker (generado en el build) y su registro |

## Flujo de una sesión

1. `start()` → estado `starting`; se crea o reanuda el `AudioContext` (gesto del usuario).
2. `createVoice()` carga o sintetiza la fuente (cancelable con Detener).
3. Se conecta la voz, se programa la envolvente completa (entrada, meseta, salida hasta `endTime`)
   en el reloj de audio y empieza el temporizador de la UI.
4. Los cambios de parámetros se aplican con transiciones suaves; los `sessionLocked` se ignoran.
5. Al terminar (o con Detener): fundido, liberación de la voz y suspensión del contexto.

## Extender el laboratorio

- **Nueva fuente**: una clase con `connect/start/set/dispose` y `modulationProbe`, registrada en
  `sources.createVoice`; sus parámetros en `PARAM_SPEC`; sus controles con `data-source`.
- **Nuevo parámetro**: añadirlo a `PARAM_SPEC` basta para validarlo y guardarlo en presets. Si se
  renombra o cambia de significado, añadir una migración en `presets/schema.js`.
- **Procesamiento por muestra**: AudioWorklet dentro de una voz; la cadena de salida no cambia.
