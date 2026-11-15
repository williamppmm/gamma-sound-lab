# Evaluación: aplicación de escritorio con Tauri

**Conclusión: no es necesario hoy.** La PWA ya cubre instalación, ventana propia y uso sin
conexión en Chrome y Edge. Tauri se justifica solo si se necesita algo que el navegador no da.

## Qué aportaría

- Instalador `.msi`/`.exe` y presencia en el menú Inicio sin pasar por el navegador.
- Acceso al sistema de archivos (p. ej. guardar exportaciones directamente en una carpeta).
- Distribución a equipos donde no se quiere usar el navegador.

## Qué costaría

- Toolchain de Rust y las herramientas de compilación de C++ de Visual Studio en Windows.
- Firmar el instalador para evitar avisos de SmartScreen.
- **WebView2** (motor de Edge/Chromium) en Windows: el comportamiento de Web Audio sería el de
  Chromium, igual que ahora. En macOS/Linux usaría WebKit/WebKitGTK, con diferencias de Web Audio
  que habría que probar (las E2E actuales solo cubren Chrome).

## Compatibilidad del proyecto

El proyecto ya está preparado:

- `base: './'` en Vite: el build usa rutas relativas y funciona servido por Tauri.
- Sin backend ni red: todo el procesamiento es local.
- El service worker no hace falta dentro de Tauri (los archivos ya son locales); se puede omitir
  registrándolo solo cuando `window.__TAURI__` no existe.

## Pasos si se decide hacerlo

1. Instalar Rust (`rustup`) y los requisitos de Tauri para Windows.
2. `npm install -D @tauri-apps/cli` y `npx tauri init` con `frontendDist: ../dist` y
   `devUrl: http://localhost:5173`.
3. `npx tauri dev` para desarrollo y `npx tauri build` para el instalador.
4. Ejecutar las pruebas E2E contra la ventana de Tauri o, como mínimo, repetir manualmente la
   lista: reproducción, sonda, exportación, presets.
