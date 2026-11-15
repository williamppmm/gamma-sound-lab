# Gamma Sound Lab

Laboratorio local de síntesis, modulación de amplitud y análisis de señales con Web Audio API.
Proyecto **experimental y educativo**: no diagnostica, previene ni trata ninguna enfermedad, y no
asume que una modulación de 40 Hz produzca un beneficio neurológico.

## Uso

```powershell
npm install
npm run dev        # http://localhost:5173
npm test           # pruebas unitarias (Node)
npm run test:e2e   # pruebas E2E en el Chrome instalado (build de producción)
npm run build      # versión estática en dist/ (PWA instalable, funciona sin conexión)
```

Requiere Node.js 22.12+ o 24+ (lo exige Vitest 5) y Chrome o Edge. Las pruebas E2E usan el Chrome
instalado en el sistema; no descargan navegadores.

## Fuentes de sonido

- **Bruma de cristal**: pieza de dos capas en bucle (27,3 s). La modulación se aplica solo a los
  acordes; la melodía suena sin modular. Composición y síntesis generadas con OpenAI Codex para
  Gamma Sound Lab; las pistas se ofrecen bajo [CC0 1.0](src/assets/LICENSE-ASSETS.md).
- **Composición generativa**: acordes y melodía originales sintetizados en el navegador a partir de
  tónica, modo (pentatónica, mayor, menor), tempo y semilla. La misma combinación produce siempre
  la misma pieza (16 compases, forma AABA, 40–77 s en bucle).
- **Tono y lluvia**: portadora (100–1000 Hz, senoidal/triangular) y lluvia generada con semilla;
  la modulación se aplica a toda la mezcla.

## Modulación y medición

- Modulación de amplitud de 1–100 Hz (40 Hz por defecto), profundidad regulable, comparación A/B
  con la sonoridad igualada.
- **Modulador (medido)**: una sonda interna reproduce la ganancia que se aplica y se mide en vivo;
  vale para cualquier fuente. **Modulación en la salida** solo se estima con tono: en música los
  batidos entre notas producen lecturas falsas, y la app lo indica en lugar de inventar cifras.
- Osciloscopio, pico y clipping.

## Vista inmersiva

- **Campo de luz ambiental**: respira con la música (brillo y color), sin destellos.
- **Luz modulada (experimental, desactivada por defecto)**: una lámpara que varía de brillo en fase
  con la modulación del sonido. Solo entre 35 y 60 Hz, en pantallas de ≥ 120 Hz, por debajo del
  umbral de destello de WCAG, en ≤ 10 % de la pantalla, con consentimiento en cada activación y
  apagado con cualquier tecla o toque. **No la uses si tienes epilepsia o sensibilidad a luces
  parpadeantes.** Detalle en [docs/estimulacion-visual.md](docs/estimulacion-visual.md).

## Sesiones, presets y exportación

- Duración obligatoria, fundidos, pausa/reanudación y parada automática.
- **Presets**: incluidos y propios, guardados en el navegador (IndexedDB), exportables e
  importables como JSON con esquema versionado.
- **Exportar WAV** (30 s – 5 min, 16 bits o 32 bits float): se renderiza con el mismo grafo que en
  vivo y se verifica antes de descargar (duración, pico, clipping, modulación).

## Seguridad

Volumen inicial bajo, techo de −6 dBFS, limitador, fundidos, duración obligatoria, inicio solo por
acción del usuario. Un límite en dBFS **no** garantiza un nivel seguro en tus auriculares: ver
[docs/seguridad-auditiva.md](docs/seguridad-auditiva.md).

## Estructura

```
src/
  assets/     pistas FLAC de Bruma de cristal y su licencia
  audio/      motor (sin DOM): AudioEngine, outputChain, sources, SessionVoice, PieceVoice, Mixer,
              Synthesizer, RainSource, Modulator (con sonda), Analyzer, dsp.js, generators.js, limits.js
  music/      compositor generativo, síntesis aditiva y su Web Worker
  sessions/   SessionManager: único punto que la UI usa para reproducir
  presets/    esquema versionado, migraciones, presets incluidos, gestor
  storage/    IndexedDB
  export/     render offline, verificación y codificación WAV
  pwa/        service worker (generado en el build) y registro
  visual/     campo ambiental y luz modulada (funciones puras con las salvaguardas)
  ui/         Controls, Visualizer, PresetPanel, ExportPanel, ImmersiveView
tests/        Vitest (Node) · tests/e2e: Playwright (Chrome)
scripts/      generación de iconos
docs/         arquitectura, roadmap, decisiones técnicas, seguridad auditiva, estimulación visual, Tauri
```

Documentación: [arquitectura](docs/arquitectura.md) · [roadmap](docs/roadmap.md) ·
[decisiones técnicas](docs/decisiones-tecnicas.md) · [seguridad auditiva](docs/seguridad-auditiva.md) ·
[escritorio con Tauri](docs/escritorio-tauri.md)
