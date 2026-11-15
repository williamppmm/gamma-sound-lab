# Seguridad auditiva

| Requisito | Implementación actual |
|---|---|
| Volumen inicial bajo | 20 % por defecto (≈ −20 dBFS de pico) |
| Techo de volumen | 100 % = −6 dBFS (`MAX_MASTER_GAIN = 0.5`), recortado en validadores **y** en el motor |
| Protección ante errores | Limitador (`DynamicsCompressorNode`, −3 dBFS, ratio 20:1) al final de la cadena, seguido de un `trim` que anula su ganancia de compensación automática (+1,71 dB); sin él, el techo real era −4,3 dBFS |
| Sin clics | Fundidos de entrada/salida (1–10 s), pausa (0,25 s) y parada manual (1 s); cambios de parámetros suavizados |
| Duración | Obligatoria (1–60 min), parada automática programada en el reloj de audio |
| Inicio | Solo por clic del usuario (el `AudioContext` se crea en ese momento) |
| Modulación | Profundidad 0–100 % y conmutador para desactivarla |
| Cierre de pestaña | `pagehide` detiene todo y cierra el contexto |
| Privacidad | Todo local; no hay peticiones de red |

## Limitación importante
Un límite en dBFS **no** garantiza un nivel seguro en dB SPL: depende de los auriculares, altavoces,
el volumen del sistema operativo y la ecualización. La interfaz lo advierte antes de iniciar.

Detener la sesión ante molestias, dolor, mareo o zumbido (tinnitus). Las personas con epilepsia
o sensibilidad a estímulos rítmicos deben consultar a un profesional antes de usar estímulos de 40 Hz.
