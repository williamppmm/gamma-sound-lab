// E2E sobre el build de producción en Chrome. Manejan la interfaz como un usuario.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { countClipped, estimateModulation, peakAbs } from '../../src/audio/dsp.js';
import { MAX_MASTER_GAIN } from '../../src/audio/limits.js';
import { decodeWav } from '../../src/export/wav.js';

const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (err) => errors.push(err.message));
  // Los 404 se registran por URL (el mensaje de consola no la incluye).
  page.on('response', (res) => res.status() >= 400 && errors.push(`${res.status()} ${res.url()}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text());
  });
  await page.goto('/');
});
test.afterEach(() => {
  expect(errors, 'sin errores de JavaScript').toEqual([]);
});

async function chooseSource(page, value) {
  await page.selectOption('#source', value);
}

test.describe('reproducción en vivo', () => {
  for (const [source, expected] of [
    ['bruma', /40\.0 Hz · 20 %/],
    ['generative', /40\.0 Hz · 20 %/],
    ['tone-rain', /40\.0 Hz · 50 %/],
  ]) {
    test(`${source}: la sonda mide la modulación pedida y la sesión se detiene`, async ({ page }) => {
      await chooseSource(page, source);
      await page.click('#btn-start');
      await expect(page.locator('#status-label')).toHaveText('Reproduciendo', { timeout: 20_000 });
      await expect(page.locator('#m-probe')).toHaveText(expected, { timeout: 15_000 });
      if (source === 'tone-rain') {
        // Tono puro: también se mide en la salida (tras el fundido de entrada de 3 s).
        await expect(page.locator('#m-mod')).toHaveText(/40\.0 Hz · 50 %/, { timeout: 15_000 });
        await expect(page.locator('#m-carrier')).toHaveText(/220\.\d Hz/);
      }
      await expect(page.locator('#m-clip')).toHaveText('no');

      // A/B: sin modulación la sonda deja de indicarla.
      await page.locator('input[name="modulationOn"]').uncheck();
      await expect(page.locator('#m-probe')).toHaveText('sin modulación', { timeout: 10_000 });

      await page.click('#btn-stop');
      await expect(page.locator('#status-label')).toHaveText('Detenido', { timeout: 10_000 });
    });
  }
});

test.describe('exportación WAV', () => {
  for (const source of ['tone-rain', 'generative', 'bruma']) {
    test(`${source}: exporta 30 s verificados y el WAV coincide con los parámetros`, async ({ page }) => {
      await chooseSource(page, source);
      await page.selectOption('#export-duration', '30');
      const download = page.waitForEvent('download', { timeout: 90_000 });
      await page.click('#btn-export');
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^gamma-sound-lab_.*_am40hz-\d+_30s_.*\.wav$/);
      await expect(page.locator('#export-status')).toContainText('Exportado y verificado');
      await expect(page.locator('#export-report li')).not.toHaveCount(0);
      await expect(page.locator('#export-report')).not.toContainText('✗');

      const wav = decodeWav((await readFile(await file.path())).buffer);
      expect(wav.sampleRate).toBe(48000);
      expect(wav.channels).toHaveLength(2);
      expect(wav.channels[0].length).toBe(30 * 48000);
      const peak = Math.max(...wav.channels.map(peakAbs));
      expect(peak).toBeLessThanOrEqual(MAX_MASTER_GAIN * 1.002 + 2 / 32767);
      expect(peak).toBeGreaterThan(0.01);
      expect(wav.channels.reduce((n, c) => n + countClipped(c), 0)).toBe(0);
      // Empieza y termina en silencio (fundidos).
      expect(peakAbs(wav.channels[0].subarray(0, 480))).toBeLessThan(0.01);
      expect(peakAbs(wav.channels[0].subarray(-480))).toBeLessThan(0.01);

      if (source === 'tone-rain') {
        const mid = wav.channels[0].subarray(15 * 48000, 15 * 48000 + 32768);
        const m = estimateModulation(mid, 48000);
        expect(m.status).toBe('ok');
        expect(Math.abs(m.frequency - 40)).toBeLessThan(0.2);
        expect(Math.abs(m.depth - 0.5)).toBeLessThan(0.03);
      }
    });
  }
});

test('presets: guardar, persistir tras recargar, cargar y eliminar', async ({ page }) => {
  await chooseSource(page, 'generative');
  await page.fill('#genSeed', '4242');
  await page.locator('#genSeed').blur();
  await page.fill('#preset-name', 'Prueba E2E');
  await page.click('#btn-preset-save');
  await expect(page.locator('#preset-status')).toHaveText('Guardado «Prueba E2E».');

  await page.reload();
  const option = page.locator('#preset-select option', { hasText: 'Prueba E2E' });
  await expect(option).toHaveCount(1);
  await page.selectOption('#preset-select', { label: 'Prueba E2E' });
  await page.click('#btn-preset-load');
  await expect(page.locator('#source')).toHaveValue('generative');
  await expect(page.locator('#genSeed')).toHaveValue('4242');

  const download = page.waitForEvent('download');
  await page.click('#btn-preset-export');
  const json = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(json.format).toBe('gamma-sound-lab/presets');
  expect(json.presets.map((p) => p.name)).toContain('Prueba E2E');

  page.once('dialog', (d) => d.accept());
  await page.click('#btn-preset-delete');
  await expect(page.locator('#preset-status')).toHaveText('Eliminado «Prueba E2E».');
  await expect(option).toHaveCount(0);
});
