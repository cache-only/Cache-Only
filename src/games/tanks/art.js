// Tanks art: everything drawn in world units (cells) on a 2D canvas context. The game's
// renderer and the field guide both draw with it, so the guide shows exactly the game's art.
// No DOM: the context, the palette, the state to draw and a kit of spare canvases (makeKit,
// from a function the caller gives it) are all passed in.
//
// One light lights everything. It comes from the top left of the screen (LIGHT, the screen
// angle it travels at) and stays there however the arena is turned. Every part is lit on the
// edges that face it and shaded on the edges that face away, and casts a soft shadow on what
// lies under it, as long as the part stands high. Nothing has an ink outline. Edges and
// shadows are canvas shadows, so their offsets are device pixels: the light stays on screen.
//
// A tank's shape tells you what it can do; its colour only tells you which kind it is:
//   barrel    the weapon: thin for shells, a muzzle brake (a wide double block across the
//             tip) for rockets, twin launch pods and a red light for missiles, a wide round
//             tube for mortar bombs, and a bundle of six barrels on a motor housing, which
//             spins up before it fires, for a minigun
//   treads    it moves; a bolted concrete pad instead means it never moves
//   rear deck one disc per mine it can lay, gone while that mine is on the ground
// Past about 14 colours, a kind can reuse another's colour with a pattern on its hull
// (VARIANTS): hazard stripes, the rear deck left plain so its mine discs still read.
import { BOMB_R, CRATE, FLOOR, HOLE, MUZZLE, TAU, TYPES, WALL } from './rules.js';

export const ART = 1.1; // tanks are drawn a little larger than their hit circle, like toys
/** The screen angle the light travels at: from the top left, down and to the right. */
export const LIGHT = Math.PI / 4;

/** Kinds that wear another kind's colour, told apart by stripes on the hull: kind -> base kind. None today. */
export const VARIANTS = {};

/** The CSS custom properties the art is painted with, by palette key. */
export const TOKENS = {
  frame: '--tk-frame',
  floor: '--tk-floor',
  joint: '--tk-joint',
  wall: '--tk-wall',
  wallLit: '--tk-wall-lit',
  wallDark: '--tk-wall-dark',
  shadow: '--tk-shadow',
  crate: '--tk-crate',
  crateLit: '--tk-crate-lit',
  crateDark: '--tk-crate-dark',
  hole: '--tk-hole',
  track: '--tk-track',
  scorch: '--tk-scorch',
  shell: '--tk-shell',
  aim: '--tk-aim',
  ink: '--tk-ink',
  tread: '--tk-tread',
  plate: '--tk-plate',
  flash: '--tk-flash',
  fire: '--tk-fire',
  smoke: '--tk-smoke',
  alarm: '--tk-alarm',
  signal: '--tk-signal',
};

/* ---------- Colour ---------- */

/** [r, g, b] of a #rrggbb or rgb()/rgba() colour. */
function rgbOf(col) {
  const s = String(col).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = s.match(/[\d.]+/g);
  return parts && parts.length >= 3 ? parts.slice(0, 3).map(Number) : [128, 128, 128];
}

/** Mixes a colour toward white (amount > 0) or black (amount < 0), as #rrggbb. */
export function shade(col, amount) {
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return `#${rgbOf(col).map((v) => Math.round(v + (target - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

const withAlpha = (col, a) => `rgba(${rgbOf(col).join(', ')}, ${a})`;
const tonesOf = (base) => ({ base, dark: shade(base, -0.32), light: shade(base, 0.22), deep: shade(base, -0.55) });

/**
 * The palette, read through get(name) -> CSS value, with four tones per tank kind (from the
 * --tk-<kind> colours).
 */
export function makePalette(get) {
  const pal = {};
  for (const [key, name] of Object.entries(TOKENS)) pal[key] = get(name);
  pal.tanks = {};
  for (const type of Object.keys(TYPES)) pal.tanks[type] = tonesOf(get(`--tk-${type}`) || '#888888');
  return pal;
}

/** Spare canvases for the soft light, made with create() (the caller's, so art.js has no DOM). */
export function makeKit(create) {
  return { scratch: create(), field: create(), floor: create(), small: create(), lit: create(), shade: create(), drop: create(), soft: create() };
}

/* ---------- The light ---------- */

const LIT = 'rgba(255, 255, 255, 0.34)';
const SHADE = 'rgba(0, 0, 0, 0.4)';
// Hard light lays each edge twice, the inner half in both passes, so it fades out like a blur.
const LIT_STEP = 'rgba(255, 255, 255, 0.24)';
const SHADE_STEP = 'rgba(0, 0, 0, 0.27)';
const DROP_STEP = 'rgba(0, 0, 0, 0.26)';
const BAND = 0.032; // cells: how far a lit or shaded edge reaches in
// Device px: no edge or layer shadow is ever narrower, or a phone-sized tank's light can't be seen.
const BAND_MIN = 2.6;
const DROP_MIN = 2.2;
const EDGE_BLUR = 0.03; // cells of blur on a part's soft edges
const DROP = 'rgba(0, 0, 0, 0.42)';
const DROP_BLUR = 0.05;
const CAST = 0.6; // a shadow on the floor reaches this much of its part's height along the light
const CAST_BLUR = 0.09;
// A blur under about a pixel and a half can't be seen, and a soft tank costs several times a
// hard one, so a small tank is lit hard, part by part.
const SOFT_FROM = 1.5;

/** The light for a context with transform M: its screen direction, device px per cell, softness. */
function lightOf(M, light = LIGHT, soft = 1) {
  return { x: Math.cos(light), y: Math.sin(light), unit: Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)), soft };
}

/** A device-space vector in world units, through the inverse of M. */
function toWorld(M, dx, dy) {
  const det = M.a * M.d - M.b * M.c;
  return { x: (M.d * dx - M.c * dy) / det, y: (-M.b * dx + M.a * dy) / det };
}

/** A screen direction (device x, y) as the nearest axis in the world: up, down, left or right. */
function axisOf(M, dx, dy) {
  const v = toWorld(M, dx, dy);
  return Math.abs(v.x) > Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };
}

// Shapes drawn just past the canvas's right edge, so only their shadows land on it. Not
// further: a canvas shadow costs as much as the span between a shape and its shadow.
const farOf = (c, unit) => c.canvas.width + 3 * unit + 64;

/**
 * Soft lit and shaded edges inside a shape. build(c) adds its sub-paths; near is painted on the
 * edges that face the light, far on the edges that face away (either may be null), d device px
 * in, blurred by blur. A frame round the shape (bounds, in the current units), drawn off the
 * canvas, throws its shadow back in, clipped to the shape.
 */
function innerLight(c, build, near, far, d, blur, L, bounds) {
  const M = c.getTransform();
  const FAR = farOf(c, L.unit);
  c.save();
  c.beginPath();
  build(c);
  c.clip();
  c.setTransform(M.a, M.b, M.c, M.d, M.e + FAR, M.f);
  c.beginPath();
  c.rect(...bounds);
  build(c);
  c.fillStyle = '#000';
  c.shadowBlur = blur;
  for (const [col, sign] of [[near, 1], [far, -1]]) {
    if (!col) continue;
    c.shadowColor = col;
    c.shadowOffsetX = sign * L.x * d - FAR;
    c.shadowOffsetY = sign * L.y * d;
    c.fill('evenodd');
  }
  c.restore();
}

/** Fills build(c) off the canvas so only its soft shadow lands, d device px along the light. */
function softShadow(c, build, col, d, blur, L) {
  const M = c.getTransform();
  const FAR = farOf(c, L.unit);
  c.save();
  c.setTransform(M.a, M.b, M.c, M.d, M.e + FAR, M.f);
  c.beginPath();
  build(c);
  c.fillStyle = '#000';
  c.shadowColor = col;
  c.shadowBlur = blur;
  c.shadowOffsetX = L.x * d - FAR;
  c.shadowOffsetY = L.y * d;
  c.fill();
  c.restore();
}

/** Light given off onto whatever is under it: added, so it brightens and never darkens. */
function glow(c, x, y, r, col, a) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(col, a));
  g.addColorStop(1, withAlpha(col, 0));
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.restore();
}

/* ---------- Paths: sub-paths only, all clockwise, so several fill as one union ---------- */

function rrPath(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** A rounded rectangle as a new path. */
export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  rrPath(c, x, y, w, h, r);
}

/** A rectangle from (x0, y0) to (x1, y1) with its own radius at each corner, clockwise from top left. */
function corners(c, x0, y0, x1, y1, tl, tr, br, bl) {
  c.moveTo(x0 + tl, y0);
  c.arcTo(x1, y0, x1, y1, tr);
  c.arcTo(x1, y1, x0, y1, br);
  c.arcTo(x0, y1, x0, y0, bl);
  c.arcTo(x0, y0, x1, y0, tl);
  c.closePath();
}

// A part's path carries its bounding box (x, y, w, h), so the frame that lights its edges can
// hug it.
const bound = (path, x, y, w, h) => Object.assign(path, { bounds: [x, y, w, h] });
const rr = (x, y, w, h, r) => bound((c) => rrPath(c, x, y, w, h, r), x, y, w, h);
const box = (x, y, w, h) => bound((c) => c.rect(x, y, w, h), x, y, w, h);
const disc = (x, y, r) => bound((c) => {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}, x - r, y - r, 2 * r, 2 * r);
/** A square of half-size h with its corners cut by k: a stationary tank's pad. */
const chamfer = (h, k) => bound((c) => {
  c.moveTo(-h + k, -h);
  c.lineTo(h - k, -h);
  c.lineTo(h, -h + k);
  c.lineTo(h, h - k);
  c.lineTo(h - k, h);
  c.lineTo(-h + k, h);
  c.lineTo(-h, h - k);
  c.lineTo(-h, -h + k);
  c.closePath();
}, -h, -h, 2 * h, 2 * h);

function dot(c, x, y, r, fill) {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

function fillPath(c, path, fill) {
  c.fillStyle = fill;
  c.beginPath();
  path(c);
  c.fill();
}

/* ---------- Ground ---------- */

/** A seeded 0-1 per cell, so a map always looks the same. */
function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const RAD = 0.08; // the outside corners of walls, crates and pits
const GAP = 0.04; // floor round each crate: crates are boxes, one a cell
const WALL_CAST = 0.3; // how high walls and crates stand, as their shadows tell it
const CRATE_CAST = 0.2;

/**
 * Floor, pits, shadows, walls and crates for a cols x rows patch under the light. kindAt(c, r)
 * returns a cell value (FLOOR, WALL, CRATE or HOLE). Each block keeps its cell and is made of
 * what it does: walls are brick and stay, crates are toy crates braced with an X, one a cell,
 * because a blast clears them a cell at a time, and a pit is a hole broken in the floor. The
 * floor has a slab tone per cell, dims into its corners, and darkens softly round every block.
 * light is the screen angle the light travels at.
 */
export function drawGround(c, pal, { cols, rows, kindAt, light = LIGHT }) {
  const M = c.getTransform();
  const L = lightOf(M, light);
  const u = L.unit;
  const lw = toWorld(M, L.x, L.y);
  const ln = Math.hypot(lw.x, lw.y);
  const right = axisOf(M, 1, 0);
  const down = axisOf(M, 0, 1);
  const bounds = [-2, -2, cols + 4, rows + 4];
  const is = (type, col, r) => kindAt(col, r) === type;
  const each = (type, fn) => {
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) if (is(type, col, r)) fn(col, r);
  };
  const lit = (build, near, far, d = 0.08, blur = 0.05) => innerLight(c, build, near, far, d * u, blur * u, L, bounds);
  const clipped = (build, fn) => {
    c.save();
    c.beginPath();
    build(c);
    c.clip();
    fn();
    c.restore();
  };

  // Floor: a tone per slab, the joints, and the light's falloff into the corners.
  c.fillStyle = pal.floor;
  c.fillRect(0, 0, cols, rows);
  each(FLOOR, (col, r) => {
    c.fillStyle = shade(pal.floor, (hash(col, r) - 0.5) * 0.075);
    c.fillRect(col, r, 1, 1);
  });
  {
    const cx = cols / 2;
    const cy = rows / 2;
    const D = Math.hypot(cols, rows) / 2;
    const g = c.createLinearGradient(cx - (lw.x / ln) * D, cy - (lw.y / ln) * D, cx + (lw.x / ln) * D, cy + (lw.y / ln) * D);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
    c.fillStyle = g;
    c.fillRect(0, 0, cols, rows);
    const v = c.createRadialGradient(cx, cy, D * 0.45, cx, cy, D * 1.05);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
    c.fillStyle = v;
    c.fillRect(0, 0, cols, rows);
  }
  c.strokeStyle = pal.joint;
  c.lineWidth = Math.max(1 / u, 0.03);
  c.beginPath();
  for (let x = 1; x < cols; x++) {
    c.moveTo(x, 0);
    c.lineTo(x, rows);
  }
  for (let y = 1; y < rows; y++) {
    c.moveTo(0, y);
    c.lineTo(cols, y);
  }
  c.stroke();

  // Pits: each open edge breaks away unevenly, a little past its cell. Inside, a recess: the
  // floor's near edge throws a deep shadow in, which fades toward the far side. Now and then a
  // crack runs off a corner.
  const SIDES = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  const hole = (cc) => each(HOLE, (col, r) => {
    const start = [[col, r], [col + 1, r], [col + 1, r + 1], [col, r + 1]];
    cc.moveTo(col, r);
    SIDES.forEach((n, side) => {
      const [sx, sy] = start[side];
      const [ex, ey] = start[(side + 1) % 4];
      if (!is(HOLE, col + n.x, r + n.y)) {
        for (let i = 1; i < 6; i++) {
          const h = hash(col * 13 + i * 7 + n.x * 3 + 40, r * 11 + i * 5 + n.y * 17 + 40);
          const k = i / 6 + (h - 0.5) * 0.06;
          const out = 0.012 + 0.05 * h * h;
          cc.lineTo(sx + (ex - sx) * k + n.x * out, sy + (ey - sy) * k + n.y * out);
        }
      }
      cc.lineTo(ex, ey);
    });
    cc.closePath();
  });
  fillPath(c, hole, pal.hole);
  lit(hole, 'rgba(0, 0, 0, 0.92)', null, 0.34, 0.24);
  lit(hole, 'rgba(0, 0, 0, 0.6)', 'rgba(255, 255, 255, 0.05)', 0.08, 0.06);
  c.fillStyle = 'rgba(0, 0, 0, 0.55)';
  c.beginPath();
  each(HOLE, (col, r) => {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      if (is(HOLE, col + sx, r) || is(HOLE, col, r + sy)) continue;
      if (hash(col * 31 + sx + 9, r * 17 + sy + 9) < 0.6) continue;
      let x = col + (sx > 0 ? 1 : 0);
      let y = r + (sy > 0 ? 1 : 0);
      let a = Math.atan2(sy, sx) + (hash(col + sx, r + sy * 3) - 0.5) * 0.6;
      for (let k = 0; k < 2; k++) {
        const len = 0.09 + 0.06 * hash(col + k, r * 2 + k);
        const w = 0.028 * (1 - k * 0.45);
        const nx = x + Math.cos(a) * len;
        const ny = y + Math.sin(a) * len;
        const px = -Math.sin(a) * w;
        const py = Math.cos(a) * w;
        c.moveTo(x + px, y + py);
        c.lineTo(nx + px * 0.5, ny + py * 0.5);
        c.lineTo(nx - px * 0.5, ny - py * 0.5);
        c.lineTo(x - px, y - py);
        c.closePath();
        x = nx;
        y = ny;
        a += (hash(col * 5 + k, r * 7 - k) - 0.5) * 0.9;
      }
    }
  });
  c.fill();

  // Walls: cells of wall as one shape, outside corners rounded. Crates: one box a cell.
  const walls = (cc) => each(WALL, (col, r) => {
    const s = (dx, dy) => is(WALL, col + dx, r + dy);
    const k = (sx, sy) => (!s(sx, 0) && !s(0, sy) ? RAD : 0);
    corners(cc, col, r, col + 1, r + 1, k(-1, -1), k(1, -1), k(1, 1), k(-1, 1));
  });
  const crates = (k = 0, rad = 0.07) => (cc) => each(CRATE, (col, r) => {
    corners(cc, col + GAP + k, r + GAP + k, col + 1 - GAP - k, r + 1 - GAP - k, rad, rad, rad, rad);
  });

  // Shadows: a soft halo where blocks meet the floor, then each kind's shadow along the light.
  c.save();
  c.beginPath();
  c.rect(0, 0, cols, rows);
  c.clip();
  {
    const FAR = farOf(c, u);
    c.save();
    c.setTransform(M.a, M.b, M.c, M.d, M.e + FAR, M.f);
    c.beginPath();
    walls(c);
    crates()(c);
    c.fillStyle = '#000';
    c.shadowColor = 'rgba(0, 0, 0, 0.5)';
    c.shadowBlur = 0.36 * u;
    c.shadowOffsetX = -FAR;
    c.fill();
    c.restore();
  }
  softShadow(c, walls, pal.shadow, WALL_CAST * u, 0.16 * u, L);
  softShadow(c, crates(), pal.shadow, CRATE_CAST * u, 0.1 * u, L);
  c.restore();

  // Brick: three courses a cell in running bond, laid along the screen and anchored to the arena,
  // so a wall's bricks run on from cell to cell, each brick its own shade.
  fillPath(c, walls, shade(pal.wall, -0.28));
  clipped(walls, () => {
    c.save();
    c.transform(right.x, right.y, down.x, down.y, 0, 0);
    const m = 0.0175;
    each(WALL, (col, r) => {
      // The cell in screen-aligned units: across (along right) and down.
      const u0 = Math.min(col * right.x + r * right.y, (col + 1) * right.x + (r + 1) * right.y);
      const v0 = Math.min(col * down.x + r * down.y, (col + 1) * down.x + (r + 1) * down.y);
      for (let k = 0; k < 3; k++) {
        const row = Math.round(v0 * 3) + k;
        const shift = (((row % 2) + 2) % 2) / 3;
        for (let j = -1; j <= 2; j++) {
          const x0 = Math.floor(u0 * 1.5) / 1.5 + j * (2 / 3) - shift;
          if (x0 + 2 / 3 < u0 || x0 > u0 + 1) continue;
          c.fillStyle = shade(pal.wall, (hash(Math.round(x0 * 3), row) - 0.5) * 0.12);
          c.fillRect(x0 + m, v0 + k / 3 + m, 2 / 3 - 2 * m, 1 / 3 - 2 * m);
        }
      }
    });
    c.restore();
  });
  lit(walls, pal.wallLit, pal.wallDark);

  // Crates: a frame round a sunken panel, braced with an X.
  const top = crates();
  const panel = crates(0.12, 0.04);
  fillPath(c, top, pal.crate);
  fillPath(c, panel, shade(pal.crate, -0.28));
  const brace = (cc) => each(CRATE, (col, r) => {
    const [x0, y0, x1, y1] = [col + GAP, r + GAP, col + 1 - GAP, r + 1 - GAP];
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y1], [x0, y1, x1, y0]]) {
      const a = Math.atan2(by - ay, bx - ax);
      const px = -Math.sin(a) * 0.06;
      const py = Math.cos(a) * 0.06;
      cc.moveTo(ax + px, ay + py);
      cc.lineTo(bx + px, by + py);
      cc.lineTo(bx - px, by - py);
      cc.lineTo(ax - px, ay - py);
      cc.closePath();
    }
  });
  clipped(panel, () => {
    fillPath(c, brace, pal.crate);
    lit(brace, pal.crateLit, 'rgba(0, 0, 0, 0.3)', 0.025, 0.02);
  });
  lit(panel, 'rgba(0, 0, 0, 0.35)', 'rgba(255, 255, 255, 0.14)', 0.035, 0.03);
  lit(top, pal.crateLit, pal.crateDark, 0.06);
}

/* ---------- Tanks ---------- */

const TREADS = [rr(-0.43, -0.39, 0.86, 0.21, 0.05), rr(-0.43, 0.18, 0.86, 0.21, 0.05)];
const PAD = chamfer(0.44, 0.13);
const HULL = rr(-0.37, -0.26, 0.74, 0.52, 0.09);
const FRONT = rr(0.22, -0.2, 0.08, 0.4, 0.03);
const REAR = rr(-0.3, -0.2, 0.08, 0.4, 0.03);
const TURRET_R = 0.2 * ART;

/** A variant's hazard stripes across the hull, slanting back from the nose, the rear deck plain. */
function stripes(c, pal) {
  c.save();
  c.beginPath();
  c.rect(-0.21, -0.3, 0.6, 0.6);
  c.clip();
  c.fillStyle = pal.ink;
  c.beginPath();
  for (let x = -0.62; x < 0.5; x += 0.19) {
    c.moveTo(x - 0.0375, -0.3);
    c.lineTo(x + 0.0375, -0.3);
    c.lineTo(x + 0.3375, 0.3);
    c.lineTo(x + 0.2625, 0.3);
    c.closePath();
  }
  c.fill();
  c.restore();
}

/** Where the mine discs sit on the rear deck, across the hull (hull units). */
function discSpots(n) {
  const gap = n > 2 ? 0.125 : 0.2;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
}

/**
 * A tank as a stack of layers, bottom first. Each layer: frame ('body' turns with the hull,
 * 'turret' with the turret), h (the height of its top, cells), drop (how far its shadow falls
 * on what is under it), solids ({ path, fill, decal?, bevel? }: a decal is drawn on its solid,
 * clipped to it, before the solid is lit) and decals (drawn on top, unlit).
 */
function model(pal, t, { phase = 0, mines, lit = false, roll = 0 }) {
  const T = TYPES[t.type];
  const tone = pal.tanks[t.type] || pal.tanks.player;
  const left = mines ?? T.mines;
  const layers = [];

  // Base: treads with cleats that run edge to edge and roll as it drives, or a concrete pad
  // bolted to the floor.
  if (T.speed) {
    const cleats = (y0) => (c) => {
      c.fillStyle = tone.deep;
      for (let k = -0.42 + (phase % 0.14); k < 0.46; k += 0.14) c.fillRect(k - 0.0175, y0, 0.035, 0.21);
    };
    layers.push({ frame: 'body', h: 0.1, solids: [
      { path: TREADS[0], fill: pal.tread, decal: cleats(-0.39) },
      { path: TREADS[1], fill: pal.tread, decal: cleats(0.18) },
    ], decals: [] });
  } else {
    layers.push({ frame: 'body', h: 0.08, solids: [{ path: PAD, fill: pal.plate, decal: (c) => {
      for (const bx of [-0.33, 0.33]) for (const by of [-0.33, 0.33]) dot(c, bx, by, 0.045, pal.ink);
    } }], decals: [] });
  }

  // Hull: a variant's stripes, plates with rounded corners at the front and back, or mine discs
  // on the rear deck, one each, a socket for each one laid.
  layers.push({ frame: 'body', h: 0.18, drop: 0.045, solids: [{ path: HULL, fill: tone.base, decal: (c) => {
    if (VARIANTS[t.type]) stripes(c, pal);
    fillPath(c, FRONT, tone.dark);
    if (!T.mines) {
      fillPath(c, REAR, tone.dark);
      return;
    }
    discSpots(T.mines).forEach((y, i) => {
      if (i < left) {
        dot(c, -0.285, y, 0.06, pal.ink);
        dot(c, -0.285, y, 0.026, tone.light);
      } else {
        dot(c, -0.285, y, 0.06, tone.dark);
        dot(c, -0.285, y, 0.036, tone.deep);
      }
    });
  } }], decals: [] });

  // Weapon, under the turret. A barrel reaches the real muzzle, where shots appear.
  const weapon = { frame: 'turret', h: 0.24, drop: 0.06, solids: [], decals: [] };
  const metal = (path, extra) => ({ path, fill: tone.dark, ...extra });
  if (T.weapon === 'shell') weapon.solids.push(metal(box(0.08, -0.065, MUZZLE - 0.08, 0.13)));
  else if (T.weapon === 'rocket') {
    // A heavy barrel ending in a muzzle brake: two wide baffles across the tip, so the gun
    // reads as a hammerhead, wide at the end where a shell barrel stays thin.
    weapon.solids.push(metal(box(0.08, -0.075, MUZZLE - 0.08, 0.15)));
    for (const x of [MUZZLE - 0.15, MUZZLE - 0.065]) weapon.solids.push(metal(box(x, -0.14, 0.065, 0.28)));
  } else if (T.weapon === 'missile') {
    for (const side of [-1, 1]) weapon.solids.push(metal(box(0.02, side * 0.11 - 0.065, 0.44, 0.13)));
    weapon.decals.push((c) => {
      for (const side of [-1, 1]) dot(c, 0.4, side * 0.11, 0.035, pal.ink);
    });
  } else if (T.weapon === 'minigun') {
    // Six barrels bound by a clamp. roll turns the bundle on its axis: seen from above, the
    // barrels slide across each other as it spins, the nearest drawn last and lightest.
    Array.from({ length: 6 }, (_, i) => roll + (i * TAU) / 6)
      .map((a) => ({ y: 0.075 * Math.sin(a), near: Math.cos(a) }))
      .sort((a, b) => a.near - b.near)
      .forEach((b) => {
        const fill = b.near > 0.5 ? tone.base : b.near > -0.5 ? tone.dark : tone.deep;
        weapon.solids.push({ path: box(0.2, b.y - 0.027, MUZZLE - 0.2, 0.054), fill, bevel: false });
      });
    weapon.solids.push(metal(box(0.42, -0.125, 0.045, 0.25), { bevel: false }));
  }

  // On top of the turret: a mortar tube leaning a little toward its aim, the minigun's motor
  // housing, a missile tank's light (lit while one of its missiles is in the air), or a hatch.
  const top = { frame: 'turret', h: 0.31, drop: 0.035, solids: [], decals: [] };
  if (T.weapon === 'bomb') {
    top.solids.push({ path: disc(0.035, 0, 0.15), fill: tone.deep, decal: (c) => dot(c, 0.045, 0, 0.095, pal.ink) });
  } else if (T.weapon === 'minigun') {
    top.solids.push({ path: rr(-0.08, -0.14, 0.36, 0.28, 0.06), fill: tone.dark, decal: (c) => {
      for (const y of [-0.075, 0.075]) dot(c, -0.01, y, 0.03, pal.ink);
    } });
  } else if (T.weapon === 'missile') {
    top.decals.push((c) => {
      dot(c, -0.05 * ART, 0, 0.085, lit ? pal.flash : tone.deep);
      dot(c, -0.05 * ART, 0, 0.055, lit ? pal.alarm : pal.ink);
    });
  } else top.decals.push((c) => dot(c, -0.05 * ART, 0, 0.065 * ART, tone.dark));

  layers.push(weapon);
  layers.push({ frame: 'turret', h: 0.27, drop: 0.06, solids: [{ path: disc(0, 0, TURRET_R), fill: tone.light }], decals: [] });
  layers.push(top);
  return layers;
}

const MARGIN = 0.12; // how far the frame that lights a part reaches past its bounds

const frameOf = (path) => {
  const [x, y, w, h] = path.bounds;
  return [x - MARGIN, y - MARGIN, w + 2 * MARGIN, h + 2 * MARGIN];
};

function enter(c, t, frame) {
  c.translate(t.x, t.y);
  if (frame === 'body') {
    c.scale(ART, ART);
    c.rotate(t.body);
  } else c.rotate(t.turret);
}

function union(c, solids) {
  c.beginPath();
  for (const s of solids) s.path(c);
}

/** Paints a solid and its decal on c, in the current units. */
function solid(c, s) {
  fillPath(c, s.path, s.fill);
  if (!s.decal) return;
  c.save();
  c.beginPath();
  s.path(c);
  c.clip();
  s.decal(c);
  c.restore();
}

/**
 * Fills the band of a part that faces away from (dx, dy), in device px: the part, less itself
 * moved by that much. Plain fills and a clip, so it draws the same in every browser.
 */
function edgeBand(c, path, dx, dy, fill) {
  const M = c.getTransform();
  c.save();
  c.beginPath();
  path(c);
  c.clip();
  c.setTransform(M.a, M.b, M.c, M.d, M.e + dx, M.f + dy);
  c.beginPath();
  c.rect(...frameOf(path));
  path(c);
  c.fillStyle = fill;
  c.fill('evenodd');
  c.restore();
}

/**
 * Hard light, part by part: each part's edges and each layer's shadow drawn straight on c, with
 * plain fills only (canvas shadows on spare canvases go missing on some iPhones). Each edge and
 * each layer shadow goes down in two steps, the inner half darker or lighter, so it reads as soft.
 */
function paintHard(c, t, layers, L) {
  const base = c.getTransform();
  const band = Math.max(BAND * L.unit, BAND_MIN);
  layers.forEach((layer, i) => {
    if (i > 0 && layer.solids.length) {
      // This layer's shadow, only on the layers already down, under the layer itself.
      const drop = Math.max(layer.drop * L.unit, DROP_MIN);
      c.save();
      c.beginPath();
      for (let j = 0; j < i; j++) {
        c.setTransform(base);
        enter(c, t, layers[j].frame);
        for (const sol of layers[j].solids) sol.path(c);
      }
      c.setTransform(base);
      c.clip();
      for (const k of [0.5, 1]) {
        c.setTransform(base.a, base.b, base.c, base.d, base.e + L.x * drop * k, base.f + L.y * drop * k);
        enter(c, t, layer.frame);
        union(c, layer.solids);
        c.fillStyle = DROP_STEP;
        c.fill();
      }
      c.restore();
    }
    c.save();
    enter(c, t, layer.frame);
    for (const s of layer.solids) {
      solid(c, s);
      if (s.bevel === false) continue;
      for (const k of [0.5, 1]) {
        edgeBand(c, s.path, L.x * band * k, L.y * band * k, LIT_STEP);
        edgeBand(c, s.path, -L.x * band * k, -L.y * band * k, SHADE_STEP);
      }
    }
    for (const d of layer.decals) d(c);
    c.restore();
  });
}

/**
 * Blurs the w x h corner of canvas src into canvas out, painted in col: drawn down to a small
 * canvas and back up, smoothing as it scales, about blur device px. No canvas shadows, which some
 * iPhones drop when one canvas is drawn onto another.
 */
function soften(small, src, out, w, h, blur, col) {
  const f = Math.max(1, Math.round(blur));
  const sw = Math.max(1, Math.ceil(w / f));
  const sh = Math.max(1, Math.ceil(h / f));
  if (small.width < sw || small.height < sh) {
    small.width = Math.max(small.width, sw);
    small.height = Math.max(small.height, sh);
  }
  if (out.width < w || out.height < h) {
    out.width = Math.max(out.width, w);
    out.height = Math.max(out.height, h);
  }
  const s = small.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, sw, sh);
  s.imageSmoothingEnabled = true;
  s.imageSmoothingQuality = 'high';
  s.drawImage(src, 0, 0, w, h, 0, 0, w / f, h / f);
  const o = out.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, w, h);
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.drawImage(small, 0, 0, w / f, h / f, 0, 0, w, h);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = col;
  o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * Soft light: the lit edges, the shaded edges and each layer's shadow on the layers under it are
 * drawn hard into three masks (kit.lit, kit.shade, kit.drop), then each mask is blurred once (by
 * scaling, soften) and laid on the tank. The masks are opaque: a part covers whatever lies under
 * it in a mask, then the part moved along the light erases all of it but its edge band.
 */
function paintSoft(c, t, layers, L, kit, size) {
  const base = c.getTransform();
  const u = L.unit;
  const band = Math.max(BAND * u, BAND_MIN);
  const mk = {};
  for (const key of ['lit', 'shade', 'drop']) {
    const cv = kit[key];
    if (cv.width < size || cv.height < size) {
      cv.width = Math.max(cv.width, size);
      cv.height = Math.max(cv.height, size);
    }
    const m = cv.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, size, size);
    m.fillStyle = '#000';
    mk[key] = m;
  }
  const fillIn = (m, frame, solids, dx = 0, dy = 0, op = 'source-over') => {
    m.setTransform(base.a, base.b, base.c, base.d, base.e + dx, base.f + dy);
    enter(m, t, frame);
    m.globalCompositeOperation = op;
    union(m, solids);
    m.fill();
    m.globalCompositeOperation = 'source-over';
  };
  layers.forEach((layer, i) => {
    if (layer.solids.length) {
      const drop = Math.max(layer.drop * u, DROP_MIN);
      if (i > 0) fillIn(mk.drop, layer.frame, layer.solids, L.x * drop, L.y * drop);
      fillIn(mk.drop, layer.frame, layer.solids, 0, 0, 'destination-out');
    }
    c.save();
    enter(c, t, layer.frame);
    for (const s of layer.solids) {
      solid(c, s);
      const one = [s];
      if (s.bevel !== false) {
        fillIn(mk.lit, layer.frame, one);
        fillIn(mk.lit, layer.frame, one, L.x * band, L.y * band, 'destination-out');
        fillIn(mk.shade, layer.frame, one);
        fillIn(mk.shade, layer.frame, one, -L.x * band, -L.y * band, 'destination-out');
      } else {
        fillIn(mk.lit, layer.frame, one, 0, 0, 'destination-out');
        fillIn(mk.shade, layer.frame, one, 0, 0, 'destination-out');
      }
    }
    for (const d of layer.decals) d(c);
    c.restore();
  });
  // Blur each mask, then lay it on the tank, only where the tank is painted.
  for (const [m, col, blur] of [[mk.lit, LIT, EDGE_BLUR], [mk.shade, SHADE, EDGE_BLUR], [mk.drop, DROP, DROP_BLUR]]) {
    const soft = soften(kit.small, m.canvas, kit.soft, size, size, L.soft * blur * u, col);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.drawImage(soft, 0, 0, size, size, 0, 0, size, size);
    c.restore();
  }
}

/**
 * Sets up canvas cv to paint tank t on: big enough for it and its light at M's scale, cleared,
 * with M's transform moved to put the tank in the middle. Returns its context, size and where it
 * goes on the target (device px).
 */
function stage(cv, M, t, unit) {
  const S = Math.ceil(2.4 * unit) + 8;
  if (cv.width < S || cv.height < S) {
    cv.width = Math.max(cv.width, S);
    cv.height = Math.max(cv.height, S);
  }
  const s = cv.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, S, S);
  const ox = Math.floor(M.a * t.x + M.c * t.y + M.e - S / 2);
  const oy = Math.floor(M.b * t.x + M.d * t.y + M.f - S / 2);
  s.setTransform(M.a, M.b, M.c, M.d, M.e - ox, M.f - oy);
  return { s, S, ox, oy };
}

/**
 * A tank at (t.x, t.y), hull turned to t.body, turret to t.turret. opts: phase (how far its
 * tread cleats have rolled), mines (discs still on the rear deck; the rest are laid), lit (a
 * missile tank's light: one of its missiles is in the air), roll (how far a minigun's barrels
 * have turned on their axis), alpha, light (the screen angle it travels at), kit (makeKit's
 * canvases: the tank is painted on one and laid down at once, so a fading tank fades as one
 * piece, and it gets the soft light; without one it is painted straight on c, lit hard).
 */
export function drawTank(c, pal, t, { phase = 0, mines, lit = false, roll = 0, alpha = 1, light = LIGHT, kit = null } = {}) {
  const M = c.getTransform();
  const L = lightOf(M, light);
  const layers = model(pal, t, { phase, mines, lit, roll });
  if (!kit) {
    c.save();
    c.globalAlpha *= alpha;
    paintHard(c, t, layers, L);
    c.restore();
    return;
  }
  const { s, S, ox, oy } = stage(kit.scratch, M, t, L.unit);
  if (EDGE_BLUR * L.unit < SOFT_FROM) paintHard(s, t, layers, L);
  else paintSoft(s, t, layers, L, kit, S);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha *= alpha;
  c.drawImage(kit.scratch, 0, 0, S, S, ox, oy, S, S);
  c.restore();
}

/** Fills tank t's parts into mask m (transform at), each moved along the light by its height. */
function castInto(m, at, M, pal, t, alpha, L) {
  const w = toWorld(M, L.x, L.y);
  m.globalAlpha = alpha;
  m.fillStyle = '#000';
  for (const layer of model(pal, t, {})) {
    if (!layer.solids.length) continue;
    const k = layer.h * CAST * L.unit;
    m.setTransform(at);
    m.translate(w.x * k, w.y * k);
    enter(m, t, layer.frame);
    union(m, layer.solids);
    m.fill();
  }
  m.globalAlpha = 1;
}

/**
 * Tanks' shadows on the floor: every part of each, moved along the light by its height, all
 * filled into one mask the size of c, blurred once by scaling and laid down. tanks: [{ t, alpha }]. Draw
 * them all before any tank, so no tank's shadow falls on another tank. Without a kit, each part
 * is laid down as it is, hard.
 */
export function drawShadows(c, pal, tanks, { light = LIGHT, kit = null } = {}) {
  if (!tanks.length) return;
  const M = c.getTransform();
  const L = lightOf(M, light);
  if (!kit) {
    c.save();
    for (const { t, alpha = 1 } of tanks) {
      c.setTransform(M);
      c.globalAlpha = alpha * 0.6;
      c.fillStyle = pal.shadow;
      castInto(c, M, M, pal, t, alpha * 0.6, L);
    }
    c.restore();
    return;
  }
  const W = c.canvas.width;
  const H = c.canvas.height;
  const field = kit.field;
  if (field.width !== W || field.height !== H) {
    field.width = W;
    field.height = H;
  }
  const m = field.getContext('2d');
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, W, H);
  for (const { t, alpha = 1 } of tanks) castInto(m, M, M, pal, t, alpha, L);
  const soft = soften(kit.small, field, kit.floor, W, H, CAST_BLUR * L.unit, pal.shadow);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(soft, 0, 0, W, H, 0, 0, W, H);
  c.restore();
}

/**
 * One tank kind, facing right, filling a w x h box whose top-left corner is the origin, on a
 * patch of floor, with its shadow. For badges: the banner, the results and the guide.
 */
export function drawBadge(c, pal, kind, w, h, kit = null) {
  c.fillStyle = pal.floor;
  c.fillRect(0, 0, w, h);
  const s = Math.min(w / 1.3, h / 1.05);
  c.save();
  c.translate(w / 2 - 0.065 * s, h / 2 - 0.02 * s);
  c.scale(s, s);
  const t = { type: kind, x: 0, y: 0, body: 0, turret: 0 };
  drawShadows(c, pal, [{ t }], { kit });
  drawTank(c, pal, t, { kit });
  c.restore();
}

/* ---------- Mines, shells, missiles and bombs ---------- */

/**
 * A mine in its owner's colour: a soft shadow, a dark casing lit at its edge, its owner's colour
 * as a raised cap, and its light, which glows on the floor (wider and red in its last seconds).
 * state: 'on', 'off' or 'urgent'. The caller decides the blinking, and keeps the light steady
 * under reduced motion.
 */
export function drawMine(c, pal, m, kind, state, { light = LIGHT } = {}) {
  const L = lightOf(c.getTransform(), light);
  const u = L.unit;
  const tone = pal.tanks[kind] || pal.tanks.player;
  const ring = (r) => (cc) => {
    cc.moveTo(m.x + r, m.y);
    cc.arc(m.x, m.y, r, 0, TAU);
  };
  const near = [m.x - 1, m.y - 1, 2, 2];
  softShadow(c, ring(0.24), pal.shadow, 0.06 * u, 0.07 * u, L);
  if (state !== 'off') glow(c, m.x, m.y, state === 'urgent' ? 0.85 : 0.5, state === 'urgent' ? pal.alarm : pal.signal, state === 'urgent' ? 0.32 : 0.16);
  fillPath(c, ring(0.24), pal.ink);
  innerLight(c, ring(0.24), 'rgba(255, 255, 255, 0.22)', null, 0.03 * u, 0.03 * u, L, near);
  softShadow(c, ring(0.16), 'rgba(0, 0, 0, 0.6)', 0.025 * u, 0.03 * u, L);
  fillPath(c, ring(0.16), tone.base);
  innerLight(c, ring(0.16), LIT, SHADE, 0.025 * u, 0.025 * u, L, near);
  if (state !== 'off') {
    dot(c, m.x, m.y, 0.07, state === 'urgent' ? pal.alarm : pal.signal);
    dot(c, m.x - 0.018, m.y - 0.018, 0.025, pal.flash);
  } else dot(c, m.x, m.y, 0.07, tone.deep);
}

// Shot shapes, pointing along +x, clockwise.
const SHELL = (c) => {
  // A bullet: square-ish back with rounded corners, tapering to a point in front.
  const h = 0.065;
  const r = 0.035;
  c.moveTo(-0.14 + r, -h);
  c.lineTo(-0.01, -h);
  c.quadraticCurveTo(0.08, -h, 0.16, 0);
  c.quadraticCurveTo(0.08, h, -0.01, h);
  c.lineTo(-0.14 + r, h);
  c.arcTo(-0.14, h, -0.14, h - r, r);
  c.lineTo(-0.14, -h + r);
  c.arcTo(-0.14, -h, -0.14 + r, -h, r);
  c.closePath();
};
const MISSILE_FINS = (c) => {
  c.moveTo(-0.17, -0.11);
  c.lineTo(-0.07, -0.05);
  c.lineTo(-0.07, 0.05);
  c.lineTo(-0.17, 0.11);
  c.closePath();
};
const MISSILE = (c) => rrPath(c, -0.17, -0.06, 0.34, 0.12, 0.06);
const SLUG = (c) => rrPath(c, -0.07, -0.035, 0.16, 0.07, 0.035);
const SHOT_H = { shell: 0.2, rocket: 0.22, missile: 0.24, minigun: 0.16 }; // cells above the floor
const SHOT_BOUNDS = [-0.5, -0.5, 1, 1];

/**
 * A shell, rocket, missile or minigun round, pointing along its velocity, lit like the tanks:
 * its own shape a little blurred on the floor below it, as far off along the light as it flies
 * high, and a shaded edge away from the light. A rocket keeps its flame. Only the missile glows:
 * its flame and nose light light the floor, and it wears its owner's colour (tone, the owner's
 * tones). flame (0-1) flickers a flame; blink says whether a missile's light is on this frame.
 */
export function drawShot(c, pal, b, { flame = 0.5, blink = true, tone = null, light = LIGHT } = {}) {
  const L = lightOf(c.getTransform(), light);
  const u = L.unit;
  const w = b.weapon;
  const body = w === 'missile' ? MISSILE : w === 'minigun' ? SLUG : SHELL;
  const parts = w === 'missile' ? [MISSILE_FINS, MISSILE] : [body];
  c.save();
  c.translate(b.x, b.y);
  c.rotate(Math.atan2(b.vy, b.vx));
  softShadow(c, (cc) => parts.forEach((p) => p(cc)), 'rgba(0, 0, 0, 0.5)', (SHOT_H[w] ?? 0.2) * CAST * u, 0.025 * u, L);
  const shaded = (path) => innerLight(c, path, null, 'rgba(0, 0, 0, 0.22)', 0.02 * u, 0.02 * u, L, SHOT_BOUNDS);
  if (w === 'missile') {
    const own = tone || pal.tanks.red;
    glow(c, -0.2, 0, 0.36, pal.fire, 0.22 + 0.1 * flame);
    if (blink) glow(c, 0.09, 0, 0.3, pal.alarm, 0.35);
    c.fillStyle = pal.fire;
    c.beginPath();
    c.moveTo(-0.16, -0.035);
    c.lineTo(-0.24 - flame * 0.05, 0);
    c.lineTo(-0.16, 0.035);
    c.fill();
    fillPath(c, MISSILE_FINS, own.dark);
    fillPath(c, MISSILE, pal.shell);
    c.save();
    c.beginPath();
    MISSILE(c);
    c.clip();
    c.fillStyle = own.base;
    c.fillRect(-0.17, -0.2, 0.07, 0.4);
    c.restore();
    shaded(MISSILE);
    // The red light in its nose.
    if (blink) {
      dot(c, 0.09, 0, 0.042, pal.alarm);
      dot(c, 0.08, -0.01, 0.015, pal.flash);
    } else dot(c, 0.09, 0, 0.042, own.deep);
  } else {
    if (w === 'rocket') {
      c.fillStyle = pal.fire;
      c.beginPath();
      c.moveTo(-0.13, -0.05);
      c.lineTo(-0.3 - flame * 0.08, 0);
      c.lineTo(-0.13, 0.05);
      c.fill();
    }
    fillPath(c, body, pal.shell);
    shaded(body);
  }
  c.restore();
}

/** Where a bomb is on its way down: its spot on the floor, and how high it is (cells). */
export function bombAt(b) {
  const k = Math.min(1, b.t / b.flight);
  const dist = Math.hypot(b.tx - b.x0, b.ty - b.y0);
  return {
    k,
    x: b.x0 + (b.tx - b.x0) * k,
    y: b.y0 + (b.ty - b.y0) * k,
    h: 4 * k * (1 - k) * (0.35 + 0.08 * dist),
  };
}

/**
 * The mark where a bomb will land: the blast area, a crosshair and, unless calm (reduced
 * motion), a ring that closes in as the bomb comes down.
 */
export function drawTarget(c, pal, b, { calm = false } = {}) {
  const { k } = bombAt(b);
  c.save();
  c.globalAlpha = calm ? 0.2 : 0.1 + 0.2 * k;
  c.fillStyle = pal.alarm;
  c.beginPath();
  c.arc(b.tx, b.ty, BOMB_R, 0, TAU);
  c.fill();
  c.globalAlpha = 0.85;
  c.strokeStyle = pal.alarm;
  c.lineWidth = 0.05;
  c.setLineDash([0.16, 0.1]);
  c.beginPath();
  c.arc(b.tx, b.ty, BOMB_R, 0, TAU);
  c.stroke();
  c.setLineDash([]);
  c.lineWidth = 0.06;
  c.beginPath();
  for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    c.moveTo(b.tx + ux * 0.18, b.ty + uy * 0.18);
    c.lineTo(b.tx + ux * 0.45, b.ty + uy * 0.45);
  }
  c.stroke();
  if (!calm) {
    c.globalAlpha = 0.25 + 0.65 * k;
    c.lineWidth = 0.07;
    c.beginPath();
    c.arc(b.tx, b.ty, BOMB_R + (1 - k) * 1.3, 0, TAU);
    c.stroke();
  }
  c.restore();
}

/**
 * A bomb in the air, raised toward up (screen up, in world terms) above its floor spot. It is
 * a dark ball, shaded round from the light with a soft highlight toward it, a soft pale glow
 * round its edge that keeps it visible over walls, and a little light caught on its far edge. It
 * looms a little larger at the top of its arc. Its shadow sits on the floor, pushed along the
 * light by its height, faint and soft while it is high and sharper as it comes down.
 */
export function drawBomb(c, pal, b, { up = { x: 0, y: -1 }, light = LIGHT } = {}) {
  const M = c.getTransform();
  const L = lightOf(M, light);
  const u = L.unit;
  const p = bombAt(b);
  const top = 0.35 + 0.08 * Math.hypot(b.tx - b.x0, b.ty - b.y0);
  const lift = top > 0 ? p.h / top : 0;
  const lw = toWorld(M, L.x, L.y);
  const ln = Math.hypot(lw.x, lw.y);
  const sx = p.x + (lw.x / ln) * p.h * CAST * 0.5;
  const sy = p.y + (lw.y / ln) * p.h * CAST * 0.5;
  c.save();
  c.globalAlpha *= 0.75 - 0.35 * lift;
  softShadow(c, (cc) => {
    cc.moveTo(sx + 0.2, sy);
    cc.arc(sx, sy, 0.09 + 0.07 * (1 - lift), 0, TAU);
  }, '#000', 0, (0.02 + 0.16 * lift) * u, L);
  c.restore();
  const x = p.x + up.x * p.h;
  const y = p.y + up.y * p.h;
  const r = 0.14 + 0.06 * lift;
  const halo = c.createRadialGradient(x, y, r - 0.01, x, y, r + 0.055);
  halo.addColorStop(0, withAlpha(pal.flash, 0.75));
  halo.addColorStop(0.45, withAlpha(pal.flash, 0.3));
  halo.addColorStop(1, withAlpha(pal.flash, 0));
  c.fillStyle = halo;
  c.beginPath();
  c.arc(x, y, r + 0.055, 0, TAU);
  c.fill();
  const hx = x - (lw.x / ln) * r * 0.4;
  const hy = y - (lw.y / ln) * r * 0.4;
  const g = c.createRadialGradient(hx, hy, r * 0.05, x, y, r);
  g.addColorStop(0, shade(pal.ink, 0.22));
  g.addColorStop(0.5, shade(pal.ink, 0.05));
  g.addColorStop(1, pal.ink);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  const rim = c.createRadialGradient(hx, hy, r * 0.9, x, y, r);
  rim.addColorStop(0, withAlpha(pal.flash, 0));
  rim.addColorStop(1, withAlpha(pal.flash, 0.16));
  c.fillStyle = rim;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  const spec = c.createRadialGradient(hx, hy, 0, hx, hy, r * 0.42);
  spec.addColorStop(0, withAlpha(pal.flash, 0.95));
  spec.addColorStop(0.35, withAlpha(pal.flash, 0.5));
  spec.addColorStop(1, withAlpha(pal.flash, 0));
  c.fillStyle = spec;
  c.beginPath();
  c.arc(hx, hy, r * 0.42, 0, TAU);
  c.fill();
}
