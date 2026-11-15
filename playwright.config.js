import { defineConfig } from '@playwright/test';

// Pruebas E2E en el Chrome instalado (channel: 'chrome'): no descarga navegadores.
// Verifican la cadena de audio real (Web Audio, OfflineAudioContext, Worker, IndexedDB).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    channel: 'chrome',
    headless: true,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
