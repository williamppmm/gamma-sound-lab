import { describe, expect, it } from 'vitest';
import { initialView, isPhoneLike } from '../src/ui/viewMode.js';

describe('vista inicial', () => {
  const phone = { width: 390, height: 844, coarsePointer: true };
  const phoneLandscape = { width: 844, height: 390, coarsePointer: true };
  const tablet = { width: 820, height: 1180, coarsePointer: true };
  const desktopNarrow = { width: 400, height: 900, coarsePointer: false };
  const desktop = { width: 1440, height: 900, coarsePointer: false };

  it('teléfonos (también en horizontal) → vista de colores', () => {
    expect(initialView({ stored: null, ...phone })).toBe('simple');
    expect(initialView({ stored: null, ...phoneLandscape })).toBe('simple');
  });

  it('tablets, ordenadores y ventanas estrechas con ratón → laboratorio', () => {
    expect(initialView({ stored: null, ...tablet })).toBe('lab');
    expect(initialView({ stored: null, ...desktop })).toBe('lab');
    expect(initialView({ stored: null, ...desktopNarrow })).toBe('lab');
  });

  it('la elección guardada del usuario manda; valores desconocidos se ignoran', () => {
    expect(initialView({ stored: 'lab', ...phone })).toBe('lab');
    expect(initialView({ stored: 'simple', ...desktop })).toBe('simple');
    expect(initialView({ stored: 'otra', ...phone })).toBe('simple');
  });

  it('isPhoneLike exige pantalla táctil', () => {
    expect(isPhoneLike(phone)).toBe(true);
    expect(isPhoneLike({ ...phone, coarsePointer: false })).toBe(false);
  });
});
