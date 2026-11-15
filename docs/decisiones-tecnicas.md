# Decisiones técnicas

## 1. Motor separado de la interfaz
La UI (`src/ui`, `main.js`) nunca toca nodos de audio. Habla solo con `SessionManager`, que a su vez
usa `AudioEngine` y crea/destruye una `ToneVoice` por sesión.

```
UI ──► SessionManager ──► AudioEngine ──► AudioContext
           │                  master → fade → limitador → analizador → salida
           └─► ToneVoice (Synthesizer → Modulator)
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
- `Mixer`, ambientes y melodías (Fase 2), `PresetManager` + IndexedDB (Fase 4), `AudioExporter` (Fase 5).
- `SafetyController` del plan original quedó repartido entre `limits.js`, `validators.js` y
  `SessionManager`; se extraerá a su propio módulo si crecen las reglas.
- AudioWorklet solo cuando haga falta procesamiento por muestra.

## 7. Entorno
El repositorio está en OneDrive. OneDrive no permite excluir solo `node_modules`; si la
sincronización se vuelve lenta o genera conflictos, mover el proyecto a una carpeta local
(p. ej. `C:\dev\audios_40hz`).
