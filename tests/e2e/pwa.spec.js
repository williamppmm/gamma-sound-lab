// PWA: instalable y utilizable sin conexión (build de producción en Chrome).
import { expect, test } from '@playwright/test';

test('manifest e iconos se sirven correctamente', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(href);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
  }
});

test('funciona sin conexión: recarga, Bruma y la composición generativa', async ({ page, context }) => {
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.goto('/');
  // Esperar a que el service worker controle la página y termine de precachear.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find((k) => k.startsWith('gamma-sound-lab-')));
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached.some((p) => p.endsWith('.flac'))).toBe(true);
  expect(cached.some((p) => /pieceWorker-.*\.js$/.test(p))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Gamma Sound Lab');

  for (const source of ['bruma', 'generative']) {
    await page.selectOption('#source', source);
    await page.click('#btn-start');
    await expect(page.locator('#status-label')).toHaveText('Reproduciendo', { timeout: 20_000 });
    await page.click('#btn-stop');
    await expect(page.locator('#status-label')).toHaveText('Detenido', { timeout: 10_000 });
  }
  expect(failed, 'ningún recurso falla sin conexión').toEqual([]);
  await context.setOffline(false);
});
