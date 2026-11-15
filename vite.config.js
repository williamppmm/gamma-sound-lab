import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { cacheVersion, precacheList, renderServiceWorker } from './src/pwa/serviceWorkerSource.js';

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Emite dist/sw.js con la lista exacta de recursos del build (uso sin conexión). */
function serviceWorkerPlugin() {
  let publicDir;
  return {
    name: 'gamma-sound-lab:service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const publicFiles = publicDir ? listFiles(publicDir).map((f) => relative(publicDir, f)) : [];
      const assets = precacheList(Object.keys(bundle), publicFiles);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderServiceWorker(assets, cacheVersion(assets)) });
    },
  };
}

export default defineConfig({
  // Rutas relativas: el build funciona en cualquier subcarpeta, en file:// de Tauri, etc.
  base: './',
  plugins: [serviceWorkerPlugin()],
  test: {
    // Las pruebas E2E (Playwright, Chrome real) se ejecutan aparte con `npm run test:e2e`.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
