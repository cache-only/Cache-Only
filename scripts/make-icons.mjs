// Renders the app icons (a pixel cent sign: white dots on #111) to PNG with
// Node built-ins only. Run once with `npm run icons`; the PNGs are committed.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/icons');

const BG = [0x11, 0x11, 0x11];
const INK = [0xff, 0xff, 0xff];

// Same grid as the #i-mark symbol in index.html. The stem is two dots wide.
const GLYPH = [
  '.....##...',
  '...######.',
  '..########',
  '.###.##.##',
  '###..##...',
  '##...##...',
  '##...##...',
  '##...##...',
  '###..##...',
  '.###.##.##',
  '..########',
  '...######.',
  '.....##...',
];
const COLS = GLYPH[0].length;
const ROWS = GLYPH.length;
// The C's open right side weighs less than its left, so centring the outline
// looks too far right. Shift left by this share of the grid pitch.
const NUDGE = 0.5;
const DOT = 0.85; // dot size, as a share of the grid pitch
const ROUND = 0.2; // corner radius, as a share of the dot

function inRoundRect(x, y, x0, y0, w, r) {
  const dx = Math.max(x0 + r - x, 0, x - (x0 + w - r));
  const dy = Math.max(y0 + r - y, 0, y - (y0 + w - r));
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + w) return false;
  return dx * dx + dy * dy <= r * r;
}

// Pitch and dot are whole pixels so every dot lands on the pixel grid.
function render(size, pitchRatio) {
  const pitch = Math.round(size * pitchRatio);
  const dot = Math.round(pitch * DOT);
  const r = dot * ROUND;
  const ox = Math.round((size - (COLS - 1) * pitch - dot) / 2 - NUDGE * pitch);
  const oy = Math.round((size - (ROWS - 1) * pitch - dot) / 2);
  const dots = [];
  GLYPH.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      if (ch === '#') dots.push([ox + i * pitch, oy + j * pitch]);
    });
  });
  const SS = 4;
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          if (dots.some(([x0, y0]) => inRoundRect(x, y, x0, y0, dot, r))) hits++;
        }
      }
      const a = hits / (SS * SS);
      const o = (py * size + px) * 3;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(BG[k] + (INK[k] - BG[k]) * a);
    }
  }
  return encodePng(size, size, rgb);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 8-bit RGB, no alpha (the apple-touch-icon must not be transparent).
function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svgDots(pitch, cx, cy) {
  const d = +(pitch * DOT).toFixed(2);
  const r = +(d * ROUND).toFixed(2);
  const out = [];
  GLYPH.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      if (ch !== '#') return;
      const x = +(cx + (i - (COLS - 1) / 2 - NUDGE) * pitch - d / 2).toFixed(2);
      const y = +(cy + (j - (ROWS - 1) / 2) * pitch - d / 2).toFixed(2);
      out.push(`<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="${r}"/>`);
    });
  });
  return out.join('');
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#111"/>
  <g fill="#fff">${svgDots(1.9, 16, 16)}</g>
</svg>
`;

const jobs = [
  ['apple-touch-icon.png', 180, 0.05],
  ['icon-192.png', 192, 0.05],
  ['icon-512.png', 512, 0.05],
  // Maskable: keep the glyph inside the central 80% safe circle.
  ['icon-maskable-512.png', 512, 0.045],
];

for (const [name, size, ratio] of jobs) {
  await writeFile(path.join(OUT, name), render(size, ratio));
  console.log(`wrote src/icons/${name}`);
}
await writeFile(path.join(OUT, 'icon.svg'), SVG);
console.log('wrote src/icons/icon.svg');
