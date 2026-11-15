// Generación del service worker en tiempo de build (lo usa el plugin de vite.config.js).
// Funciones puras para poder probarlas en Node.
import { createHash } from 'node:crypto';

/** Lista de recursos a precachear: la raíz, todo lo emitido por el build y /public. */
export function precacheList(bundleFiles, publicFiles) {
  const files = [...bundleFiles, ...publicFiles]
    .map((f) => f.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((f) => f && f !== 'sw.js' && !f.endsWith('.map'));
  return ['./', ...[...new Set(files)].sort()];
}

/** Versión de caché: cambia si cambia cualquier recurso (los nombres llevan hash de contenido). */
export function cacheVersion(entries) {
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12);
}

/**
 * Código del service worker.
 * - install: precachea todo; NO activa automáticamente (evita que una pestaña abierta
 *   pierda recursos de su versión). La página ofrece "Actualizar" y envía SKIP_WAITING.
 * - activate: borra cachés de versiones anteriores.
 * - fetch: navegación → red primero, con la copia en caché si no hay conexión;
 *   resto (mismo origen) → caché primero.
 */
export function renderServiceWorker(assets, version) {
  return `// Generado en el build. No editar.
const CACHE = 'gamma-sound-lab-${version}';
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gamma-sound-lab-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./', { cacheName: CACHE, ignoreVary: true })),
    );
    return;
  }

  // ignoreVary: los módulos se piden con cabecera Origin y el servidor responde "Vary: Origin";
  // el precacheo no envía Origin, así que sin esto la caché no coincidiría sin conexión.
  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreVary: true }).then((cached) => cached || fetch(request)),
  );
});
`;
}
