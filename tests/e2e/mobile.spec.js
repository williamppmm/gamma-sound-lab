// En un teléfono la app arranca en la vista de colores con controles básicos.
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('arranca en la vista de colores con controles básicos y aviso de seguridad', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#immersive')).toBeVisible();
  await expect(page.locator('#im-notice')).toBeVisible();
  await expect(page.locator('#im-notice')).toContainText('Baja el volumen');
  // Ajustes visuales y luz plegados.
  await expect(page.locator('.immersive__more')).not.toHaveAttribute('open', '');
  await expect(page.locator('#btn-light')).toBeHidden();
  // Sin desbordamiento horizontal.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reproduce, pausa y detiene desde la vista; el volumen se sincroniza con el laboratorio', async ({ page }) => {
  await page.goto('/');
  const info = page.locator('#immersive-session');
  await page.locator('#im-source').selectOption('generative');
  await page.locator('#im-play').tap();
  await expect(info).toContainText('Reproduciendo', { timeout: 20_000 });
  await expect(page.locator('#im-play')).toHaveText('Pausar');
  await expect(page.locator('#im-source')).toBeDisabled();
  await expect(page.locator('#im-notice')).toBeHidden();

  await page.locator('#im-volume').fill('30');
  await expect(page.locator('#im-volume-out')).toContainText('30 %');

  await page.locator('#im-play').tap();
  await expect(info).toContainText('En pausa', { timeout: 5_000 });
  await expect(page.locator('#im-play')).toHaveText('Reanudar');
  await page.locator('#im-play').tap();
  await expect(info).toContainText('Reproduciendo', { timeout: 5_000 });
  await page.locator('#im-stop').tap();
  await expect(info).toContainText('Detenido', { timeout: 10_000 });

  // El laboratorio refleja lo elegido en la vista.
  await page.locator('#btn-immersive-close').tap();
  await expect(page.locator('#immersive')).toBeHidden();
  await expect(page.locator('#source')).toHaveValue('generative');
  await expect(page.locator('input[name="volume"]')).toHaveValue('30');
});

test('la elección de vista se recuerda en el teléfono', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-immersive-close').tap();
  await page.reload();
  await expect(page.locator('#immersive')).toBeHidden(); // eligió el laboratorio

  await page.locator('#btn-immersive').tap();
  await page.reload();
  await expect(page.locator('#immersive')).toBeVisible(); // volvió a la vista de colores
});
