// Genera los iconos de la PWA (PNG) sin dependencias: dibuja una onda con modulación de
// amplitud sobre fondo oscuro y codifica PNG con zlib. Uso: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [13, 16, 21];
const ACCENT = [94, 234, 212];
const RING = [41, 49, 60];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param maskable  true: fondo a sangre y dibujo dentro de la zona segura (80 %)
 */
function drawIcon(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // supermuestreo para suavizar bordes
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.8 : 1;
  const inBox = (x, y) => {
    if (radius === 0) return true;
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const cx = size / 2;
  const cy = size / 2;
  const half = (size / 2) * scale;
  const ringR = half * 0.86;
  const ringW = Math.max(1, size * 0.018);
  const amp = half * 0.5;
  const thick = Math.max(1.2, size * 0.028);

  // Curva: portadora con envolvente AM, dentro del círculo.
  const wave = (u) => {
    const env = 0.55 + 0.45 * Math.sin(Math.PI * 2 * u * 2 - Math.PI / 2);
    return Math.sin(Math.PI * 2 * u * 7) * env * Math.sin(Math.PI * u);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (!inBox(fx, fy)) continue;
          let col = BG;
          const d = Math.hypot(fx - cx, fy - cy);
          if (Math.abs(d - ringR) < ringW) col = RING;
          const u = (fx - (cx - ringR * 0.92)) / (ringR * 1.84);
          if (u >= 0 && u <= 1) {
            // distancia vertical aproximada a la curva, corregida por la pendiente
            const du = 1e-3;
            const yc = cy - amp * wave(u);
            const slope = (amp * (wave(u + du) - wave(u - du))) / (2 * du * ringR * 1.84);
            const dist = Math.abs(fy - yc) / Math.sqrt(1 + slope * slope);
            if (dist < thick) col = ACCENT;
          }
          r += col[0];
          g += col[1];
          b += col[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round(a / n);
      // Desmultiplicar el color en bordes con transparencia parcial
      if (px[i + 3] > 0 && px[i + 3] < 255) {
        const k = 255 / px[i + 3];
        px[i] = Math.min(255, Math.round(px[i] * k));
        px[i + 1] = Math.min(255, Math.round(px[i + 1] * k));
        px[i + 2] = Math.min(255, Math.round(px[i + 2] * k));
      }
    }
  }
  return encodePng(size, px);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
  ['favicon-32.png', 32, false],
];
for (const [name, size, maskable] of targets) {
  writeFileSync(new URL(name, out), drawIcon(size, { maskable }));
  console.log('escrito', name);
}
