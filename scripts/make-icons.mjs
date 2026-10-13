// Renders the app icons (signal-yellow square, ink paper plane) to PNG with
// Node built-ins only. Run once with `npm run icons`; the PNGs are committed.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/icons');

const BG = [0xff, 0xc4, 0x00];
const INK = [0x16, 0x18, 0x1d];

// Same geometry as the #i-plane symbol (32-unit box).
const SHAPES = [
  { pts: [[28, 5], [3.5, 15.2], [13.2, 18.5]], alpha: 1 },
  { pts: [[28, 5], [14.6, 19.7], [18.6, 28]], alpha: 1 },
  { pts: [[13.2, 18.5], [14.6, 19.7], [13.7, 26]], alpha: 0.55 },
];
const CENTER = [15.75, 16.5];

function inTriangle(x, y, [a, b, c]) {
  const s = (p, q) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function render(size, planeWidthRatio) {
  const scale = (size * planeWidthRatio) / 24.5; // plane is 24.5 units wide
  const SS = 4;
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - size / 2) / scale + CENTER[0];
          const y = (py + (sy + 0.5) / SS - size / 2) / scale + CENTER[1];
          let c = BG;
          for (const shape of SHAPES) {
            if (!inTriangle(x, y, shape.pts)) continue;
            c = c.map((v, k) => v + (INK[k] - v) * shape.alpha);
          }
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const o = (py * size + px) * 3;
      rgb[o] = Math.round(r / (SS * SS));
      rgb[o + 1] = Math.round(g / (SS * SS));
      rgb[o + 2] = Math.round(b / (SS * SS));
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

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#ffc400"/>
  <g fill="#16181d" transform="translate(16 16) scale(.82) translate(-15.75 -16.5)">
    <path d="M28 5 3.5 15.2l9.7 3.3z"/>
    <path d="M28 5 14.6 19.7l4 8.3z"/>
    <path d="m13.2 18.5 1.4 1.2-.9 6.3z" opacity=".55"/>
  </g>
</svg>
`;

const jobs = [
  ['apple-touch-icon.png', 180, 0.62],
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  // Maskable: keep the plane inside the central 80% safe circle.
  ['icon-maskable-512.png', 512, 0.5],
];

for (const [name, size, ratio] of jobs) {
  await writeFile(path.join(OUT, name), render(size, ratio));
  console.log(`wrote src/icons/${name}`);
}
await writeFile(path.join(OUT, 'icon.svg'), SVG);
console.log('wrote src/icons/icon.svg');
