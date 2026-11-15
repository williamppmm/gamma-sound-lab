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

Requiere Node.js 22.12+ o 24+ (lo exige Vitest 5) y un navegador Chromium.

## Fuentes de sonido

- **Bruma de cristal** es la fuente inicial. Pulsa **Iniciar** para escuchar la pieza en bucle con
  los acordes modulados a 40 Hz y una profundidad inicial del 20 %. Puedes ajustar por separado
  el nivel de la melodía y los acordes, cambiar la frecuencia o comparar con la modulación apagada.
- **Tono y lluvia** conserva el mezclador de tono y lluvia generada con semilla reproducible. Cambia
  de fuente con la sesión detenida.
- Portadora (100–1000 Hz, senoidal/triangular) con modulación de amplitud (1–100 Hz, por defecto 40 Hz)
- Profundidad regulable y conmutador A/B (modulado / sin modular)
- Volumen limitado (máx. −6 dBFS) + limitador de seguridad
- Sesiones con duración obligatoria, fundidos, pausa/reanudación y parada automática
- Osciloscopio, pico y clipping en ambas fuentes.
- **Modulador (medido)**: una sonda interna reproduce la ganancia que el modulador aplica y se
  mide en vivo; vale para cualquier fuente. **Modulación en la salida** solo se estima en Tono y
  lluvia: en música los batidos entre notas producen lecturas falsas.
- En Bruma, la interfaz indica que la melodía no se modula y qué parte de la energía de la mezcla
  pasan por el modulador (≈ 75 % con niveles 100/100). La pieza es un bucle de 27,3 s.
- La composición y la síntesis de Bruma de cristal se generaron con OpenAI Codex para Gamma Sound
  Lab. Las dos pistas FLAC se ofrecen bajo [CC0 1.0](src/assets/LICENSE-ASSETS.md).

## Estructura

```
src/
  assets/     pistas estéreo FLAC de Bruma de cristal
  audio/      motor (sin DOM): AudioEngine, SessionVoice, BrumaVoice, Mixer, Synthesizer, RainSource,
              Modulator, Analyzer, generators.js (PRNG + lluvia),
              dsp.js (funciones puras), limits.js (rangos y límites), params.js
  sessions/   SessionManager: único punto que la UI usa para controlar el audio
  ui/         Controls, Visualizer
  utils/      validators
tests/        Vitest (Node) sobre las funciones puras
docs/         decisiones técnicas y seguridad auditiva
```

Ver [docs/decisiones-tecnicas.md](docs/decisiones-tecnicas.md) y [docs/seguridad-auditiva.md](docs/seguridad-auditiva.md).
