# Gamma Sound Lab

Laboratorio local de síntesis, modulación de amplitud y análisis de señales con Web Audio API.
Proyecto **experimental y educativo**: no diagnostica, previene ni trata ninguna enfermedad, y no
asume que una modulación de 40 Hz produzca un beneficio neurológico.

## Uso

```powershell
npm install
npm run dev      # http://localhost:5173
npm test         # pruebas del motor DSP y validadores
npm run build    # versión estática en dist/
```

Requiere Node.js 20+ y un navegador Chromium.

## Estado: MVP 1.0 + Fase 2a

- Mezclador: tono + lluvia generada con semilla reproducible
- Portadora (100–1000 Hz, senoidal/triangular) con modulación de amplitud (1–100 Hz, por defecto 40 Hz)
- Profundidad regulable y conmutador A/B (modulado / sin modular)
- Volumen limitado (máx. −6 dBFS) + limitador de seguridad
- Sesiones con duración obligatoria, fundidos, pausa/reanudación y parada automática
- Osciloscopio y medición en vivo de frecuencia de modulación, profundidad, portadora, pico y clipping

## Estructura

```
src/
  audio/      motor (sin DOM): AudioEngine, SessionVoice, Mixer, Synthesizer, RainSource,
              Modulator, Analyzer, generators.js (PRNG + lluvia),
              dsp.js (funciones puras), limits.js (rangos y límites), params.js
  sessions/   SessionManager: único punto que la UI usa para controlar el audio
  ui/         Controls, Visualizer
  utils/      validators
tests/        Vitest (Node) sobre las funciones puras
docs/         decisiones técnicas y seguridad auditiva
```

Ver [docs/decisiones-tecnicas.md](docs/decisiones-tecnicas.md) y [docs/seguridad-auditiva.md](docs/seguridad-auditiva.md).
