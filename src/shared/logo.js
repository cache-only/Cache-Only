// The Cache Only mark: a cent sign 11 x 13 rounded-square pixels big, drawn as a grid of spans so
// each pixel can come into focus on its own. Progress anywhere in the app is this logo going from
// blurred grey to sharp white, pixel by pixel, in a fixed pseudo-random order. Styles: .logo in
// styles.css. scripts/make-icons.mjs draws the app icons from the same grid and the field below.
export const MARK = [
  '.....##....',
  '..########.',
  '.##########',
  '###..##..##',
  '##...##....',
  '##...##....',
  '##...##....',
  '##...##....',
  '##...##....',
  '###..##..##',
  '.##########',
  '..########.',
  '.....##....',
];

export const COLS = MARK[0].length;

const FLAT = MARK.join('').split('');
const LIT = FLAT.map((ch, i) => (ch === '#' ? i : -1)).filter((i) => i >= 0);
// The order the pixels come into focus: scattered, the same every time.
const RANK = new Map(
  LIT.slice()
    .sort((a, b) => ((a * 37) % 101) - ((b * 37) % 101))
    .map((idx, r) => [idx, r]),
);

/** A logo element. size: 'xs' | 'sm' | 'md' | 'lg'. glow: all white, for the blurred glow. */
export function createLogo({ size = 'sm', glow = false } = {}) {
  const el = document.createElement('span');
  el.className = `logo${size === 'sm' ? '' : ` logo-${size}`}${glow ? ' logo-glow' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < FLAT.length; i++) {
    const px = document.createElement('i');
    if (FLAT[i] === '#') {
      px.className = 'lit';
      px.dataset.rank = RANK.get(i);
    }
    el.append(px);
  }
  return el;
}

/** Brings the first p (0..1) of the pixels into focus; the rest stay blurred grey. */
export function setLogoProgress(logo, p) {
  const sharp = Math.round(Math.max(0, Math.min(1, p)) * LIT.length);
  for (const px of logo.querySelectorAll('i.lit')) {
    px.classList.toggle('soft', Number(px.dataset.rank) >= sharp);
  }
}

/* ---------- The field around the mark ---------- */

// The app icons (scripts/make-icons.mjs) and the install page (shared/pixel-field.js) set the
// mark in a field: one empty cell around it and, past that, a scattered field of dim pixels at
// several greys (some left out). Cells count in the mark's grid and run past it both ways, so the
// page's field is the icons' field carried on.
export const FIELD_GREYS = [0x14, 0x1c, 0x26, 0x32, 0x40]; // darkest first
export const MARK_GREY = 0xff;

const ROWS = MARK.length;

// Smooth value noise (so pixels gather in patches) mixed with per-cell noise, seeded so every run
// draws the same field. Change SEED for a different scatter.
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

// Unlit cells walled in by the mark (the cent's bowl) take no field, except the ones that still
// clear the mark by one cell: a column of three between the C and its bar, always lit.
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
// Inside the mark's box only its open mouth (the mark above and below, or left and right) and its
// bowl get pixels, so nothing tucks into the curve of the C.
const inMouth = (i, j) =>
  (MARK.slice(0, j).some((row) => row[i] === '#') && MARK.slice(j + 1).some((row) => row[i] === '#')) ||
  (MARK[j].slice(0, i).includes('#') && MARK[j].slice(i + 1).includes('#'));

/** The grey of cell (i, j) in the mark's grid: MARK_GREY, one of FIELD_GREYS, or null if empty. */
export function fieldShade(i, j) {
  if (lit(i, j)) return MARK_GREY;
  if (inBox(i, j) && !enclosed(i, j) && !inMouth(i, j)) return null;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (lit(i + di, j + dj)) return null;
  const n = CLUSTER * noise(i / PATCH, j / PATCH, SEED) + (1 - CLUSTER) * hash(i, j, SEED + 1);
  // The bowl's column follows the same noise but is never left out, and skips the darkest grey,
  // which all but vanishes beside the mark.
  if (enclosed(i, j)) return FIELD_GREYS[1 + Math.min(FIELD_GREYS.length - 2, Math.floor(n * (FIELD_GREYS.length - 1)))];
  if (n < GAPS) return null;
  return FIELD_GREYS[Math.min(FIELD_GREYS.length - 1, Math.floor(((n - GAPS) / (1 - GAPS)) * FIELD_GREYS.length))];
}
