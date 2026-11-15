# Estimulación visual

La **vista inmersiva** (botón junto a Detener) ofrece dos niveles. Ninguno se guarda en presets:
un archivo importado nunca puede encender la luz.

## Contexto y evidencia

Los estudios de estimulación gamma más conocidos combinan luz y sonido a 40 Hz. En ratones
mostraron efectos llamativos en marcadores de Alzheimer; en humanos hay ensayos pequeños con
resultados preliminares, **no concluyentes**. Gamma Sound Lab no afirma ningún beneficio.

## Nivel 1 · Campo de luz ambiental (sin destellos)

Un campo de color que respira con la música: el brillo sigue la energía de la salida y el tono,
su brillo espectral (centroide).

- Brillo filtrado (constante de tiempo 0,6 s) y con velocidad limitada a 0,25 de luminancia
  relativa por segundo: **ninguna entrada puede producir destellos**, ni siquiera una AM de 40 Hz.
  Probado con la medida de destellos de WCAG frente a entradas adversas (40 Hz, alternancia por
  fotograma, ruido, escalones, pulsos de 3 Hz).
- Luminancia máxima 0,18 (relativa). El color se calcula para dar exactamente la luminancia
  controlada (`colorForLuminance`), desaturando si hace falta.
- Con "reducir movimiento" del sistema, el campo deja de desplazarse.

## Nivel 2 · Luz modulada (experimental, desactivada por defecto)

Una lámpara circular cuyo brillo varía en fase con la modulación del sonido.

### Riesgo

La luz que parpadea entre ~3 y 60 Hz puede provocar crisis en personas con epilepsia
fotosensible (≈ 1 de cada 4 000; más frecuente en jóvenes y a menudo sin diagnosticar), además de
migraña o malestar. Las pautas WCAG desaconsejan más de 3 destellos por segundo.

### Salvaguardas

| Medida | Valor | Motivo |
|---|---|---|
| Variación de brillo | ≤ 0,09 de luminancia relativa (Lmax 0,3 × profundidad ≤ 30 %) | Por debajo del umbral de destello de WCAG (0,1) |
| Área | ≤ 10 % de la ventana, bordes suaves | Área pequeña; WCAG considera el área afectada |
| Forma | Senoidal, misma forma que la AM del sonido | Sin transiciones bruscas ni armónicos de onda cuadrada |
| Color | Blanco verdoso poco saturado | El rojo saturado es el más provocador |
| Frecuencias | Solo 35–60 Hz | Fuera de la banda más provocadora (≈ 10–30 Hz) |
| Pantalla | ≥ 3 fotogramas por ciclo (≥ 120 Hz para 40 Hz) y fotogramas estables (dispersión ≤ 1 ms) | A 60 Hz, 40 Hz se dibujaría con componentes cerca de 20 Hz |
| Vigilancia | Se detiene si > 2 % de los fotogramas se pierden | Un fotograma perdido alarga el ciclo y crea parpadeo lento |
| Consentimiento | Diálogo con advertencias y dos casillas obligatorias en **cada** activación | No se recuerda |
| Parada | Cualquier tecla, clic o toque; cambiar de pestaña o ventana; pausa, fin o Detener; A/B; frecuencia fuera de rango | Detener debe ser inmediato y sin buscar un botón |
| Duración | 10 minutos por activación | Exposición acotada |
| Sistema | Bloqueada con "reducir movimiento" | Respeta la preferencia de accesibilidad |

Todo esto vive en funciones puras (`src/visual/light.js`) con pruebas en `tests/visual.test.js`;
el bloqueo en pantallas de 60 Hz, el consentimiento y las condiciones previas se prueban en Chrome
(`tests/e2e/visual.spec.js`).

**Estas medidas reducen el riesgo; no lo eliminan.** Por el mismo motivo el estímulo es más suave
que el de los estudios de laboratorio (que usan luz intensa a pantalla completa o gafas LED).

### Sincronía con el sonido

El LFO del modulador arranca con fase 0 en un instante conocido del reloj de audio
(`SessionManager.modulationClock`). En cada fotograma se calcula qué instante del audio se está
oyendo (`AudioContext.getOutputTimestamp`) y se integra la fase con la frecuencia actual, así que
la luz sigue los cambios de frecuencia y se congela en pausa. La sincronía es aproximada (unos
milisegundos): depende de la latencia de la pantalla, que el navegador no informa.

### Probarla

Necesitas una pantalla de 120 Hz o más (muchos portátiles y móviles recientes, monitores de juego).
En Windows: Configuración → Pantalla → Pantalla avanzada → frecuencia de actualización. Con 60 Hz
la aplicación lo detecta y no la activa.
