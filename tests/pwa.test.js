import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cacheVersion, precacheList, renderServiceWorker } from '../src/pwa/serviceWorkerSource.js';

describe('service worker', () => {
  it('precachea la raíz, el build y /public, sin el propio sw.js ni mapas', () => {
    const list = precacheList(
      ['index.html', 'assets/index-abc.js', 'assets/index-abc.js.map', 'sw.js', 'assets/pieceWorker-x.js'],
      ['manifest.webmanifest', 'icons\\icon-192.png'],
    );
    expect(list[0]).toBe('./');
    expect(list).toContain('index.html');
    expect(list).toContain('assets/pieceWorker-x.js');
    expect(list).toContain('icons/icon-192.png');
    expect(list).not.toContain('sw.js');
    expect(list.some((f) => f.endsWith('.map'))).toBe(false);
    expect(new Set(list).size).toBe(list.length);
  });

  it('la versión de caché cambia cuando cambia un recurso', () => {
    expect(cacheVersion(['./', 'a-1.js'])).toBe(cacheVersion(['./', 'a-1.js']));
    expect(cacheVersion(['./', 'a-1.js'])).not.toBe(cacheVersion(['./', 'a-2.js']));
  });

  it('genera JavaScript válido con la lista y la versión', () => {
    const code = renderServiceWorker(['./', 'index.html'], 'v123');
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain("'gamma-sound-lab-v123'");
    expect(code).toContain('"index.html"');
    // No se activa solo: espera a que el usuario pida actualizar.
    const installBlock = code.slice(code.indexOf("'install'"), code.indexOf("addEventListener('message'"));
    expect(installBlock).not.toContain('skipWaiting');
    expect(code).toContain("event.data === 'SKIP_WAITING'");
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

  it('tiene lo necesario para instalarse', () => {
    expect(manifest.name).toBe('Gamma Sound Lab');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  });

  it('los iconos existen y son PNG del tamaño declarado', () => {
    for (const icon of manifest.icons) {
      const png = readFileSync(new URL(`../public/${icon.src}`, import.meta.url));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      const [w] = icon.sizes.split('x').map(Number);
      expect(png.readUInt32BE(16)).toBe(w);
      expect(png.readUInt32BE(20)).toBe(w);
    }
  });
});
