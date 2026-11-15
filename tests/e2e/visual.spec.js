// Vista inmersiva y luz modulada en Chrome. El Chrome sin interfaz de las pruebas dibuja a
// ~60 Hz (o irregular), así que la luz debe quedar BLOQUEADA: es justo la salvaguarda a probar.
import { expect, test } from '@playwright/test';

async function startSession(page, source = 'generative') {
  await page.goto('/');
  await page.selectOption('#source', source);
  await page.click('#btn-start');
  await expect(page.locator('#status-label')).toHaveText('Reproduciendo', { timeout: 20_000 });
}

test('la vista ambiental se ilumina con la música y se cierra con Escape', async ({ page }) => {
  await startSession(page);
  await page.click('#btn-immersive');
  const view = page.locator('#immersive');
  await expect(view).toBeVisible();
  await expect(page.locator('#immersive-session')).toContainText('Reproduciendo');
  await page.waitForTimeout(3000);
  const centerLuma = await page.evaluate(() => {
    const c = document.querySelector('.immersive__ambient');
    const [r, g, b] = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });
  expect(centerLuma).toBeGreaterThan(5); // no está negro: responde a la música
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
});

test('la luz exige sesión activa, consentimiento explícito y pantalla compatible', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-immersive');
  await page.click('#btn-light');
  await expect(page.locator('#light-status')).toContainText('Inicia una sesión');
  await expect(page.locator('#light-consent')).not.toBeVisible();
  await page.click('#btn-immersive-close');

  await page.click('#btn-start');
  await expect(page.locator('#status-label')).toHaveText('Reproduciendo', { timeout: 20_000 });
  await page.click('#btn-immersive');
  await page.click('#btn-light');
  const dialog = page.locator('#light-consent');
  await expect(dialog).toBeVisible();

  // Sin marcar las casillas no se puede activar.
  await dialog.getByRole('button', { name: 'Activar la luz' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#light-status')).toHaveText('Luz no activada.');

  // Con consentimiento: mide la pantalla y, a 60 Hz o con fotogramas irregulares, la bloquea.
  await page.click('#btn-light');
  for (const box of await dialog.locator('input[type="checkbox"]').all()) await box.check();
  await dialog.getByRole('button', { name: 'Activar la luz' }).click();
  const status = page.locator('#light-status');
  await expect(status).toHaveText(/Luz activa|no es compatible|irregulares|No se pudo medir/, { timeout: 10_000 });
  const text = await status.textContent();
  if (/Luz activa/.test(text)) {
    // Solo si el entorno dibuja a ≥ 120 Hz estables: cualquier tecla la detiene.
    await expect(page.locator('#immersive')).toHaveAttribute('data-light', 'on');
    await page.keyboard.press('Space');
    await expect(status).toHaveText('Luz detenida.');
  } else {
    expect(text).toMatch(/no es compatible|irregulares|No se pudo medir/);
  }
  await expect(page.locator('#immersive')).not.toHaveAttribute('data-light', 'on');
  await expect(page.locator('.immersive__lamp-backdrop')).toBeHidden();
});

test('fuera de 35–60 Hz o con la modulación apagada, la luz no se ofrece', async ({ page }) => {
  await startSession(page, 'tone-rain');
  await page.locator('input[name="modRateHz"]').fill('20');
  await page.click('#btn-immersive');
  await page.click('#btn-light');
  await expect(page.locator('#light-status')).toContainText('entre 35 y 60 Hz');
  await expect(page.locator('#light-consent')).not.toBeVisible();
  await page.click('#btn-immersive-close');

  await page.locator('input[name="modRateHz"]').fill('40');
  await page.locator('input[name="modulationOn"]').uncheck();
  await page.click('#btn-immersive');
  await page.click('#btn-light');
  await expect(page.locator('#light-status')).toContainText('modulación está desactivada');
});

test('con "reducir movimiento" la luz modulada está bloqueada', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startSession(page);
  await page.click('#btn-immersive');
  await page.click('#btn-light');
  await expect(page.locator('#light-status')).toContainText('reducir el movimiento');
  await expect(page.locator('#light-consent')).not.toBeVisible();
});
