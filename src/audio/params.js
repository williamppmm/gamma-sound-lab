// Utilidades para automatizar AudioParams sin clics.

/** Congela el valor actual del parámetro en `time` y descarta lo programado después. */
export function holdAt(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
  } else {
    const v = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(v, time);
  }
}

/** Cambio suave (exponencial) hacia `value`; evita el "zipper noise". */
export function smoothSet(param, value, time, timeConstant = 0.03) {
  holdAt(param, time);
  param.setTargetAtTime(value, time, timeConstant);
}
