# Decisiones técnicas

## 1. Motor separado de la interfaz
La UI (`src/ui`, `main.js`) nunca toca nodos de audio. Habla solo con `SessionManager`, que a su vez
usa `AudioEngine` y crea una voz por sesión según la fuente seleccionada.

```
UI ──► SessionManager ──► AudioEngine ──► AudioContext
           │                  master → fade → limitador → analizador → salida
           └─► SessionVoice: (Synthesizer + RainSource) → Mixer → Modulator
```

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

## 6. Pendiente / diferido
- Más ambientes y melodías (resto de Fase 2), `PresetManager` + IndexedDB (Fase 4), `AudioExporter` (Fase 5).
- `SafetyController` del plan original quedó repartido entre `limits.js`, `validators.js` y
  `SessionManager`; se extraerá a su propio módulo si crecen las reglas.
- AudioWorklet solo cuando haga falta procesamiento por muestra.

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

La pieza pasa por el mismo volumen maestro, fundidos, limitador y osciloscopio. El panel muestra
el ajuste del modulador de acordes y el pico de salida medido. El estimador de tono y portadora
se reserva para Tono y lluvia. Detener durante la preparación cancela la carga.
