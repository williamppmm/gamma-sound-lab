/**
 * Registra el service worker (solo en el build de producción) y avisa cuando hay una
 * versión nueva. La actualización nunca se aplica sola: podría cortar una sesión en curso.
 * @param onUpdate (apply: () => void) → void   se llama cuando hay una versión esperando
 */
export function registerServiceWorker({ onUpdate }) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // Solo se recarga si el usuario pidió actualizar: en la primera visita clients.claim()
      // también dispara controllerchange y no debe recargar (podría cortar una sesión).
      let userRequested = false;
      const offer = (worker) =>
        onUpdate(() => {
          userRequested = true;
          worker.postMessage('SKIP_WAITING');
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!userRequested) return;
        userRequested = false;
        window.location.reload();
      });
    } catch (err) {
      console.warn('No se pudo registrar el service worker:', err);
    }
  });
}
