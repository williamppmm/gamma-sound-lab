# Decisiones técnicas

## 1. Motor separado de la interfaz
La UI (`src/ui`, `main.js`) nunca toca nodos de audio. Habla solo con `SessionManager`, que a su vez
usa `AudioEngine` y crea/destruye una `SessionVoice` por sesión.

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
