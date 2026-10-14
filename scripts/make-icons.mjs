// Renders the app icons to PNG with Node built-ins only: the pixel logo in white on #070707, with
// one empty cell around it and, past that, a scattered field of dim pixels at several greys (some
// left out). Only the app icons get the field; the logo inside the app stays plain.
// Run once with `npm run icons`; the PNGs are committed.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { MARK } from '../src/shared/logo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/icons');

const BG = 0x07;
const INK = 0xff;
const DIM = [0x14, 0x1c, 0x26, 0x32, 0x40]; // the field's greys, darkest first

// The logo's 11 x 13 mark (shared/logo.js), centred.
const COLS = MARK[0].length;
const ROWS = MARK.length;
const DOT = 0.75; // dot size, as a share of the grid pitch
const ROUND = 0.34; // corner radius, as a share of the dot

// The field: smooth value noise (so pixels gather in patches) mixed with per-cell noise, seeded so
// every run draws the same icon. Change SEED for a different scatter.
const SEED = 3;
const PATCH = 2.5; // patch size, in cells
const CLUSTER = 0.55; // share of the noise that is patches rather than per cell
const GAPS = 0.3; // share of the noise range left empty

const lit = (i, j) => MARK[j]?.[i] === '#';

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (i, j, seed) => mulberry32((i * 374761393) ^ (j * 668265263) ^ seed)();

function noise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = (x - x0) ** 2 * (3 - 2 * (x - x0));
  const v = (y - y0) ** 2 * (3 - 2 * (y - y0));
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Unlit cells walled in by the mark (the cent's bowl) stay empty, like its margin.
const OPEN = new Set();
{
  const inside = (i, j) => i >= -1 && j >= -1 && i <= COLS && j <= ROWS;
  const stack = [[-1, -1]];
  OPEN.add('-1,-1');
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (!inside(a, b) || lit(a, b) || OPEN.has(`${a},${b}`)) continue;
      OPEN.add(`${a},${b}`);
      stack.push([a, b]);
    }
  }
}
const inBox = (i, j) => i >= 0 && j >= 0 && i < COLS && j < ROWS;
const enclosed = (i, j) => inBox(i, j) && !lit(i, j) && !OPEN.has(`${i},${j}`);
// Inside the mark's box only its open mouth (the mark above and below, or left and right) gets
// the field, so nothing tucks into the curve of the C.
const inMouth = (i, j) =>
  (MARK.slice(0, j).some((row) => row[i] === '#') && MARK.slice(j + 1).some((row) => row[i] === '#')) ||
  (MARK[j].slice(0, i).includes('#') && MARK[j].slice(i + 1).includes('#'));

/** The grey of cell (i, j) in the mark's grid (it runs past the mark both ways), or null if empty. */
function shade(i, j) {
  if (lit(i, j)) return INK;
  if (inBox(i, j) && (enclosed(i, j) || !inMouth(i, j))) return null;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (lit(i + di, j + dj)) return null;
  const n = CLUSTER * noise(i / PATCH, j / PATCH, SEED) + (1 - CLUSTER) * hash(i, j, SEED + 1);
  if (n < GAPS) return null;
  return DIM[Math.min(DIM.length - 1, Math.floor(((n - GAPS) / (1 - GAPS)) * DIM.length))];
}

// pitch is in pixels. A whole pitch snaps every dot to the pixel grid; a fractional one doesn't.
function render(size, pitch) {
  const snap = (v) => (Number.isInteger(pitch) ? Math.round(v) : v);
  const dot = snap(pitch * DOT);
  const r = dot * ROUND;
  const ox = snap((size - (COLS - 1) * pitch - dot) / 2);
  const oy = snap((size - (ROWS - 1) * pitch - dot) / 2);
  const cells = new Map();
  const cell = (i, j) => {
    const key = `${i},${j}`;
    if (!cells.has(key)) cells.set(key, shade(i, j));
    return cells.get(key);
  };
  const SS = 4;
  const rgb = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS - ox;
          const y = py + (sy + 0.5) / SS - oy;
          const i = Math.floor(x / pitch);
          const j = Math.floor(y / pitch);
          const lx = x - i * pitch;
          const ly = y - j * pitch;
          const grey = cell(i, j);
          let hit = grey !== null && lx <= dot && ly <= dot;
          if (hit) {
            const dx = Math.max(r - lx, 0, lx - (dot - r));
            const dy = Math.max(r - ly, 0, ly - (dot - r));
            hit = dx * dx + dy * dy <= r * r;
          }
          sum += hit ? grey : BG;
        }
      }
      const o = (py * size + px) * 3;
      rgb.fill(Math.round(sum / (SS * SS)), o, o + 3);
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

// Every cell whose dot shows in the size x size square, grouped by grey.
function svgDots(size, pitch) {
  const d = +(pitch * DOT).toFixed(2);
  const r = +(d * ROUND).toFixed(2);
  const c = size / 2;
  const at = (k, n) => c + (k - (n - 1) / 2) * pitch - d / 2;
  const groups = new Map();
  for (let j = Math.floor(-at(0, ROWS) / pitch) - 1; at(j, ROWS) < size; j++) {
    for (let i = Math.floor(-at(0, COLS) / pitch) - 1; at(i, COLS) < size; i++) {
      const grey = shade(i, j);
      if (grey === null || at(i, COLS) + d <= 0 || at(j, ROWS) + d <= 0) continue;
      const x = +at(i, COLS).toFixed(2);
      const y = +at(j, ROWS).toFixed(2);
      if (!groups.has(grey)) groups.set(grey, []);
      groups.get(grey).push(`<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="${r}"/>`);
    }
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([grey, rects]) => `  <g fill="${hex(grey)}">${rects.join('')}</g>`)
    .join('\n');
}

const hex = (grey) => `#${grey.toString(16).padStart(2, '0').repeat(3)}`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <clipPath id="c"><rect width="32" height="32" rx="7"/></clipPath>
  <g clip-path="url(#c)">
  <rect width="32" height="32" fill="${hex(BG)}"/>
${svgDots(32, 1.9)}
  </g>
</svg>
`;

// [file, size, pitch in pixels]: about 5% of the size, chosen so the field's outermost dots are
// cut by the edge. At 192 no whole pitch does that (10 leaves a clean 2 px margin), so it uses
// the exact 9.6 with soft dot edges.
const jobs = [
  ['apple-touch-icon.png', 180, 9],
  ['icon-192.png', 192, 9.6],
  ['icon-512.png', 512, 26],
  // Maskable: keep the glyph inside the central 80% safe circle.
  ['icon-maskable-512.png', 512, 23],
];

for (const [name, size, pitch] of jobs) {
  await writeFile(path.join(OUT, name), render(size, pitch));
  console.log(`wrote src/icons/${name}`);
}
await writeFile(path.join(OUT, 'icon.svg'), SVG);
console.log('wrote src/icons/icon.svg');
