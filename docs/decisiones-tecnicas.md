# Decisiones técnicas

## 1. Motor separado de la interfaz
La UI (`src/ui`, `main.js`) nunca toca nodos de audio. Habla solo con `SessionManager`, que a su vez
usa `AudioEngine` y crea una voz por sesión según la fuente seleccionada.

```
UI ──► SessionManager ──► AudioEngine ──► AudioContext
           │                  outputChain: master → fade → limitador → trim → analizador → salida
           └─► sources.createVoice(): SessionVoice (tono + lluvia) | PieceVoice (Bruma, generativa)
```
Diagrama completo y responsabilidades de cada módulo en [arquitectura.md](arquitectura.md).

## 2. Una sola fuente de verdad para límites
`src/audio/limits.js` define rangos, valores por defecto, ganancia máxima y fundidos.
Los validadores, la UI (min/max de los inputs), el motor y las pruebas leen de ahí.

## 3. DSP puro y probado en Node
Vitest corre en Node, donde no existe Web Audio. Por eso la fórmula de modulación y las mediciones
viven en `src/audio/dsp.js` como funciones puras:

- `amBaseGain` / `amLfoGain`: la misma fórmula que usa `Modulator` para configurar sus nodos.
- `renderAmTone`: genera en memoria la señal equivalente al motor.
- `estimateModulation`: mide frecuencia y profundidad AM (Goertzel sobre x², ventana Hann).
- `estimateCarrierHz`, `peakAbs`, `countClipped`.

El analizador del navegador usa **las mismas funciones** sobre la salida real, de modo que lo que
se prueba en Node es lo que se muestra en pantalla.

## 4. Modulación de amplitud
`g(t) = (1 − d/2) + (d/2)·sin(2π·fm·t)`; la ganancia oscila entre `1 − d` y `1`, sin superar nunca 1.
Implementación: `GainNode` con valor base + LFO senoidal conectado a `gain` a través de otro `GainNode`.
Desactivar la modulación (A/B) equivale a `d = 0`, con transición suave.

## 5. Sesiones robustas
- Operaciones serializadas en cola: doble clic o pulsaciones rápidas no duplican osciladores.
- El final de la sesión se programa en el reloj de audio (`linearRamp` hasta `endTime`).
- Pausar = fundido corto + `AudioContext.suspend()`: el reloj de audio se congela y el temporizador también.
- Al terminar se destruye la voz y se suspende el contexto (no consume CPU en reposo).

## 6. Diferido a propósito
- `SafetyController` del plan original quedó repartido entre `limits.js`, `validators.js` y
  `SessionManager`; se extraerá a su propio módulo si crecen las reglas.
- AudioWorklet solo cuando haga falta procesamiento por muestra: las mediciones actuales no lo justifican.
- Estado de todas las fases en [roadmap.md](roadmap.md).

## 7. Entorno
El repositorio está en OneDrive. OneDrive no permite excluir solo `node_modules`; si la
sincronización se vuelve lenta o genera conflictos, mover el proyecto a una carpeta local
(p. ej. `C:\dev\audios_40hz`).

## 8. Mezclador y lluvia (Fase 2a)
- La modulación AM se aplica **a la mezcla completa**, no a cada fuente: el A/B compara todo el ambiente.
- `Mixer` normaliza: si la suma de niveles pasa de 1, la salida se reduce proporcionalmente
  (`mixNormalization`), así la mezcla nunca supera pico 1 antes del volumen maestro.
- La lluvia es una función pura (`renderRain` en `generators.js`) con PRNG Mulberry32:
  misma semilla → misma señal (requisito de generación reproducible). Se renderizan 20 s en
  memoria, con fundido de potencia constante en la costura del bucle, y se cachean por semilla.
- La semilla y la duración quedan bloqueadas durante la sesión; los niveles se cambian en caliente.

## 9. Revisión externa y correcciones
Hallazgos de una revisión estática, verificados con pruebas que fallaban antes del arreglo:

- **Reanudar durante el fundido de salida dejaba la sesión en silencio.** `#scheduleEnvelope`
  ahora sube solo hasta el nivel que la curva de salida tiene en ese instante y continúa desde ahí.
- **`panic()` no invalidaba operaciones encoladas**: un `start()` encolado (p. ej. detrás de un
  Detener) creaba un `AudioContext` nuevo tras cerrar la pestaña. Solución: contador de generación;
  `panic()` lo incrementa y las operaciones anteriores se descartan. No se usa una bandera de
  cierre definitivo para no romper la restauración desde la caché del navegador (bfcache).
- **Medición en el hilo principal: 25 ms por segundo.** Ahora x² se decima con un filtro CIC
  (orden 3, factor 60) antes de Goertzel, compensando la caída del filtro: **1,3 ms**, misma precisión.
- **Pruebas de sesión** (`tests/session.test.js`): motor simulado con reloj controlable y un
  `AudioParam` que modela la automatización, para comprobar la ganancia real en cada instante.

Limitación conocida: con la ventana de 0,68 s del analizador no se puede medir modulación por
debajo de ~3 Hz (menos de 2 ciclos en la ventana). Las pruebas cubren 5–100 Hz.

## 10. Auditoría técnica (segunda ronda)
Cada hallazgo confirmado tiene una prueba que fallaba antes del arreglo.

**Sesiones** (`tests/session.test.js`)
- `start()` es idempotente: con una sesión activa, en pausa o terminando, no hace nada.
- La pausa vuelve a comprobar la generación tras `await suspend()`: un `panic()` durante la
  suspensión ya no deja el estado en `paused`.
- Detener cerca del final acorta el fundido manual al plazo programado (antes quedaba 0,083
  de ganancia en el instante final).
- Los parámetros con `sessionLocked` en `PARAM_SPEC` (duración, fundido, semilla) no cambian
  durante la sesión aunque se llame a `update()` directamente.
- `#fail()` silencia y suspende el contexto si llegó a crearse.

**Nivel de salida** (`tests/levels.test.js`)
- La normalización del mezclador va dentro de la ganancia de cada canal (`channelGains`). Como
  todas las ganancias se suavizan con la misma constante, la suma interpolada nunca supera 1
  (antes: hasta 1,125 a mitad de una transición).
- Cambio de forma de onda con fundido cruzado entre dos osciladores en fase (sin clic; pico ≤ 1
  por ser combinación convexa).
- A/B con igual sonoridad (`abMatchLoudness`, activado por defecto): sin modulación, la ganancia
  fija es el RMS de la versión modulada, √((1−d/2)² + (d/2)²/2). Sin igualar, a d = 50 % el lado
  modulado suena 2,26 dB más bajo y eso contamina la comparación. Igualar nunca sube el pico.

**Medición** (`tests/measurement.test.js`)
- El máximo del espectro siempre existe; `estimateModulation` ahora devuelve `status`:
  `ok` | `none` (el pico no destaca: contraste < 8 frente a la mediana del espectro, o
  profundidad < 3 %) | `unstable` (deriva de energía > 20 % en la ventana, p. ej. un fundido,
  calculada tras restar la componente senoidal detectada) | `short` (< 3 ciclos en la ventana).
- La UI solo muestra cifras con `ok`, con un decimal, y explica el motivo en los demás casos.
- Calibración (48 y 96 kHz): sin modulación real nunca hay `ok` (lluvia, tono, fundidos);
  con tono modulado el contraste va de ~10³ a ~10⁵. **Con lluvia sola la medición no es fiable**:
  la lluvia ya fluctúa (≈ 28 % de "profundidad" aparente) y es indistinguible de una AM real
  ≤ 30 %. Con tono en la mezcla sí se mide bien.
- La ventana del analizador es de 32768 muestras: 0,68 s a 48 kHz, 0,34 s a 96 kHz. Se muestra
  en la UI; a 96 kHz el mínimo medible sube a ~9 Hz.

**Interfaz**: estado con `aria-live`, errores con `role="alert"`, leyenda de escala del
osciloscopio, y se libera la referencia al analizador tras `pagehide`.

## 11. Bruma de cristal

La fuente musical usa dos pistas estéreo FLAC de la pieza original, una para las teclas y otra
para los acordes. Se cargan al iniciar y se guardan como búferes por contexto. Las dos se programan
en el mismo instante y repiten juntas. El modulador se inserta solo en los acordes antes del
mezclador. El ajuste inicial es 40 Hz con una profundidad del 20 %.

La pieza pasa por el mismo volumen maestro, fundidos, limitador y osciloscopio. Detener durante
la preparación cancela la carga.

**Datos de las pistas** (medidos con ffmpeg): FLAC estéreo, 48 kHz, 16 bits, 27,26 s cada una,
misma longitud y costura de bucle sin salto. Pico por canal: acordes −0,9 dBFS, melodía −8,0 dBFS.
RMS: acordes −13,25 dBFS, melodía −18,07 dBFS → con niveles 100/100 los acordes (lo único
modulado) son ≈ 75 % de la energía de la mezcla.

OpenAI Codex generó la composición y la síntesis de Bruma de cristal para Gamma Sound Lab.
Las dos pistas FLAC se ofrecen bajo **CC0 1.0**. La [nota de procedencia y licencia](../src/assets/LICENSE-ASSETS.md)
detalla el alcance y las etiquetas de los archivos.

### Verificación de la modulación en música
Calibración con las pistas reales (ventanas de 32768 muestras, salto de 12000):
- Acordes **sin** AM añadida: el estimador de salida da 18 de 107 lecturas "válidas" entre
  27 y 98 Hz, con profundidades de 29–71 %. Son batidos entre notas del propio acorde.
- Acordes con AM de 40 Hz al 10, 20 o 30 %: resultados prácticamente idénticos a sin AM. La AM
  añadida no se distingue de la modulación natural de la música.

Conclusión: en material musical, medir la salida no verifica la modulación. Por eso el
`Modulator` incluye una **sonda**: un `ConstantSourceNode` (valor 1) atraviesa un `GainNode`
que recibe el mismo valor base y el mismo LFO que la ganancia real, y va a un `AnalyserNode`.
Su salida es exactamente g(t); el mismo `estimateModulation` la mide con precisión (pruebas en
`tests/probe.test.js`, que reproducen el caso con un acorde de dos notas que late a 27 Hz).
La sonda verifica la automatización (LFO, profundidad, A/B), no la multiplicación del
`GainNode`, que es trivial. En Tono y lluvia se muestran ambas: la sonda y la estimación de salida.

## 12. Composición generativa (Fase 2)
- `src/music/composer.js` es una función pura: `compose({ genSeed, genMode, genRoot, genTempo })`
  devuelve siempre la misma partitura. Modos: pentatónica (armonía mayor), mayor y menor natural.
- Forma AABA de 16 compases con dos progresiones de 4 acordes elegidas por la semilla; un acorde por
  compás (bajo + tríada en registro medio, colocadas dentro de un rango para que la conducción de voces
  sea suave). Melodía monofónica: tiempos fuertes en notas del acorde, paso a paso entre ellos
  (saltos ≤ octava), cadencias cada 4 compases y final en la tónica para que el bucle resuelva.
- `src/music/synth.js` sintetiza la partitura con síntesis aditiva: "teclas" (decaimiento exponencial,
  armónicos que se apagan antes) y "pad" (ataque lento). Fasor giratorio en lugar de `sin()` por muestra.
  Las colas que pasan del final se suman al principio: el bucle no tiene costura.
- Tarda ~1 s a 48 kHz, por eso corre en un **Web Worker** (`pieceWorker.js`), cancelable con Detener.
- Las dos pistas usan la misma `PieceVoice` que Bruma: melodía sin modular, acordes con AM y sonda.
- Pruebas (`tests/music.test.js`): determinismo, notas dentro de la escala en las 12 tónicas y 3 modos,
  forma, rango, saltos, final en la tónica, costura del bucle y tiempo de síntesis.

## 13. Presets (Fase 4)
- Esquema versionado en `src/presets/schema.js`: `{ version, id, name, createdAt, updatedAt, params }`.
  Los parámetros pasan siempre por `sanitizeParams` (faltantes → por defecto, desconocidos → fuera).
- Migraciones explícitas (`MIGRATIONS[n]` lleva de la versión n a la n + 1). La versión 0 cubre
  parámetros sueltos de antes del esquema, incluido el antiguo `brumaDepth` → `chordsDepth`.
- Versiones futuras se rechazan con un mensaje claro ("actualiza la aplicación").
- IndexedDB (`src/storage/Database.js`) sin dependencias; si no está disponible (modo privado
  estricto), la app sigue funcionando con los presets incluidos.
- Importar nunca sobrescribe por id: cada preset importado recibe uno nuevo. Los inválidos se
  informan uno a uno sin detener la importación. Límite de 1 MB y 500 presets por archivo.
- Pruebas con IndexedDB real en memoria (`fake-indexeddb`).

## 14. Exportación WAV (Fase 5)
- `OfflineAudioContext` con **el mismo grafo** que en vivo: `sources.createVoice()` y
  `buildOutputChain()` son compartidos con la sesión. Fundidos de entrada/salida en el archivo.
- Verificación automática (`verifyExport`, pura): duración exacta, pico ≤ −6 dBFS, sin clipping,
  sonda del modulador (frecuencia ±0,2 Hz, profundidad ±2 puntos) leída con `suspend()` a mitad del
  render, y en tono puro también la modulación del audio exportado. Si falla, no se descarga sin
  confirmar.
- WAV propio (`src/export/wav.js`): 16 bits con dither TPDF determinista, o 32 bits float con
  bloque `fact`. Ida y vuelta probada.
- E2E en Chrome (`tests/e2e/app.spec.js`): exporta las tres fuentes por la interfaz, decodifica el
  WAV descargado en Node y comprueba longitud, pico, clipping, fundidos y modulación.

## 15. PWA y sin conexión (Fase 6)
- Service worker generado en el build (plugin en `vite.config.js`) con la lista exacta de recursos
  (incluidos el worker de síntesis y los FLAC) y versión de caché derivada de sus nombres con hash.
- Navegación: red primero con copia en caché; recursos: caché primero. `ignoreVary` es necesario:
  los módulos se piden con cabecera `Origin` y el servidor responde `Vary: Origin` (detectado por la
  prueba E2E sin conexión, que fallaba sin esto).
- Una versión nueva **no se activa sola** (podría cortar una sesión o dejar a una pestaña sin sus
  recursos): la página muestra "Actualizar ahora" y solo entonces recarga.
- `base: './'` en Vite: el build funciona en cualquier subcarpeta y dentro de un empaquetado de escritorio.
- Iconos generados por `scripts/make-icons.mjs` (PNG con zlib, sin dependencias), incluido el maskable.
- Escritorio: evaluación de Tauri en [escritorio-tauri.md](escritorio-tauri.md).

## 16. Pruebas
- `npm test`: Vitest en Node (DSP, música, presets, exportación, sesiones con dobles, PWA).
- `npm run test:e2e`: Playwright con el Chrome instalado (sin descargar navegadores), sobre el build
  de producción: reproducción en vivo con la sonda, exportación de las tres fuentes, presets
  persistentes y funcionamiento sin conexión.

## 17. Estimulación visual
- Vista inmersiva con dos niveles; detalle de riesgos y salvaguardas en
  [estimulacion-visual.md](estimulacion-visual.md).
- Nivel 1 (campo ambiental): brillo filtrado y con velocidad limitada; probado sin destellos ante
  entradas adversas con una implementación de la medida de destellos de WCAG (`maxFlashesPerSecond`).
  Las pruebas encontraron dos defectos antes de publicar: el contador de destellos no registraba la
  primera oscilación (habría dado por seguro cualquier parpadeo) y el color perdía luminancia al
  recortar canales en tonos azules.
- Nivel 2 (luz modulada): por debajo del umbral de destello de WCAG, ≤ 10 % del área, 35–60 Hz,
  pantalla ≥ 3 fotogramas por ciclo con fotogramas estables, vigilancia de fotogramas perdidos,
  consentimiento en cada activación, parada con cualquier interacción, 10 min máximo.
- No forma parte de `PARAM_SPEC`: no se guarda en presets ni se puede activar desde un JSON.
- Un analizador pequeño (2048) en la cadena de salida alimenta los visuales sin cargar el grande.
- Revisión posterior: la luz no se apagaba si durante el parpadeo se activaba "reducir movimiento"
  o se redimensionaba la ventana (con una ventana más pequeña la lámpara podía superar el 10 % del
  área). Ahora `lightStopReason` (pura, probada) apaga la luz ante cualquier cambio de las
  condiciones comprobadas al activarla, incluido un cambio de frecuencia dentro del rango.
- El campo ambiental admite color fijo o reactivo y brillo suave o tenue (en `localStorage`,
  validado al leerlo); todas las combinaciones probadas sin destellos.
