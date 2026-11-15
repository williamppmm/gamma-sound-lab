# Seguridad auditiva

| Requisito | Implementación actual |
|---|---|
| Volumen inicial bajo | 20 % por defecto (≈ −20 dBFS de pico) |
| Techo de volumen | 100 % = −6 dBFS (`MAX_MASTER_GAIN = 0.5`), recortado en validadores **y** en el motor |
| Protección ante errores | Limitador (`DynamicsCompressorNode`, −3 dBFS, ratio 20:1) al final de la cadena, seguido de un `trim` que anula su ganancia de compensación automática (+1,71 dB); sin él, el techo real era −4,3 dBFS |
| Sin clics | Fundidos de entrada/salida (1–10 s), pausa (0,25 s) y parada manual (1 s, nunca más allá del final programado); cambios de parámetros suavizados; cambio de forma de onda con fundido cruzado |
| Duración | Obligatoria (1–60 min), parada automática programada en el reloj de audio |
| Inicio | Solo por clic del usuario (el `AudioContext` se crea en ese momento) |
| Modulación | Profundidad 0–100 % y conmutador para desactivarla |
| Cierre de pestaña | `pagehide` detiene todo y cierra el contexto |
| Privacidad | El audio se procesa en el navegador. Las pistas de Bruma se cargan desde el mismo sitio; la composición generativa se sintetiza localmente; los presets se guardan solo en este navegador (IndexedDB). Sin peticiones a terceros. |

## Limitación importante
Un límite en dBFS **no** garantiza un nivel seguro en dB SPL: depende de los auriculares, altavoces,
el volumen del sistema operativo y la ecualización. La interfaz lo advierte antes de iniciar.

Detener la sesión ante molestias, dolor, mareo o zumbido (tinnitus). Las personas con epilepsia
o sensibilidad a estímulos rítmicos deben consultar a un profesional antes de usar estímulos de 40 Hz.

## Mezcla y comparación A/B
- La suma de canales del mezclador nunca supera pico 1, tampoco durante las transiciones.
- La comparación A/B iguala la sonoridad (RMS) por defecto, sin subir el pico.
- El indicador de clipping mide después del limitador: no detecta recortes previos ni picos
  entre muestras, y no dice nada del nivel acústico real (dB SPL).

## Archivos exportados
- El WAV exportado conserva el volumen elegido en la aplicación (pico ≤ −6 dBFS) y empieza y termina
  con fundidos. La exportación verifica pico y clipping antes de descargar.
- **Fuera de la aplicación no hay límites**: un reproductor externo puede subir el volumen o
  repetir el archivo sin fin. Aplican las mismas precauciones: volumen del sistema bajo y parar
  ante cualquier molestia.

## Presets
- Los presets importados pasan por la misma validación que la interfaz: un JSON manipulado no
  puede superar el techo de volumen, la duración máxima ni los rangos de frecuencia.
