# Roadmap

Estado a 15 de noviembre de 2026. Detalle de cada decisión en [decisiones-tecnicas.md](decisiones-tecnicas.md).

| Fase | Estado | Entregado |
|---|---|---|
| 0 · Entorno | ✅ | Vite + Vitest, Git, estructura, documentación |
| 1 · Motor de audio | ✅ | AM configurable, volumen limitado, limitador, parada segura, medición verificada |
| 2 · Composición y ambientes | ✅ | Tono y lluvia con semilla · Bruma de cristal (CC0) · composición generativa por semilla (tónica, modo, tempo) · mezclador · A/B con sonoridad igualada |
| 3 · Reproductor | ✅ | Interfaz adaptable, temporizador, osciloscopio, sonda del modulador, estados accesibles |
| 4 · Presets | ✅ | IndexedDB, esquema versionado con migraciones, presets incluidos, exportar/importar JSON |
| 5 · Exportación y pruebas | ✅ | WAV 16/32 bits con `OfflineAudioContext`, verificación automática, E2E en Chrome |
| 6 · Escalabilidad | ✅ / evaluado | PWA instalable y sin conexión · Tauri evaluado ([escritorio-tauri.md](escritorio-tauri.md)) |
| 7 · Estimulación visual | ✅ | Vista inmersiva: campo ambiental sin destellos y luz modulada experimental con salvaguardas ([estimulacion-visual.md](estimulacion-visual.md)) |

## Pendiente fuera del plan original

Ideas surgidas durante el desarrollo, sin compromiso:

- **Verificación en más navegadores**: Firefox y Safari (Web Audio, `cancelAndHoldAtTime`,
  decodificación FLAC, service worker). Hoy las E2E solo cubren Chrome.
- **Sesión real de 60 minutos** con medición continua (hoy se comprueba con reloj simulado).
- **Más variedad generativa**: compases distintos de 4/4, más progresiones, instrumentos.
- **Vista de espectro** además del osciloscopio.
- **Empaquetado de escritorio** si se necesita (ver evaluación de Tauri).
- **Licencia del código fuente**: sin definir (los audios de Bruma son CC0).
