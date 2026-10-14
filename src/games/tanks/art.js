// Tanks art: everything drawn in world units (cells) on a 2D canvas context. The game's
// renderer and the field guide both draw with it, so the guide shows exactly the game's art.
// No DOM: the context, the palette and the state to draw are all passed in.
//
// A tank's shape tells you what it can do; its colour only tells you which kind it is:
//   barrel    the weapon: thin for shells, a muzzle brake (a wide double block across the
//             tip) for rockets, twin launch pods and a red light for missiles, a wide round
//             tube for mortar bombs, and a bundle of six barrels on a motor housing, which
//             spins up before it fires, for a minigun
//   treads    it moves; a bolted concrete pad instead means it never moves
//   rear deck one disc per mine it can lay, gone while that mine is on the ground
// Past about a dozen colours, a kind can reuse another's colour with a pattern on its hull
// (VARIANTS): Hornet is Yellow's colour with black hazard stripes.
import { BOMB_R, CRATE, HOLE, MUZZLE, TAU, TYPES, WALL } from './rules.js';

export const ART = 1.1; // tanks are drawn a little larger than their hit circle, like toys
const STRIPE_GAP = 0.27; // cells between a crate's stripes, across them
const STRIPE_W = 0.11;

/** Kinds that wear another kind's colour, told apart by stripes on the hull: kind -> base kind. */
export const VARIANTS = { hornet: 'yellow' };

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
  stripe: '--tk-stripe',
  hole: '--tk-hole',
  holeRim: '--tk-hole-rim',
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
  signal: '--signal',
};

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex, amount) {
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The palette, read through get(name) -> CSS value, with four tones per tank kind
 * (from the --tk-<kind> colours).
 */
export function makePalette(get) {
  const pal = {};
  for (const [key, name] of Object.entries(TOKENS)) pal[key] = get(name);
  pal.tanks = {};
  for (const type of Object.keys(TYPES)) {
    const base = get(`--tk-${type}`) || '#888888';
    pal.tanks[type] = { base, dark: shade(base, -0.32), light: shade(base, 0.22), deep: shade(base, -0.55) };
  }
  return pal;
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function disc(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

/** A square of half-size h with its corners cut by k: a stationary tank's pad. */
function pad(c, h, k) {
  c.beginPath();
  c.moveTo(-h + k, -h);
  c.lineTo(h - k, -h);
  c.lineTo(h, -h + k);
  c.lineTo(h, h - k);
  c.lineTo(h - k, h);
  c.lineTo(-h + k, h);
  c.lineTo(-h, h - k);
  c.lineTo(-h, -h + k);
  c.closePath();
}

/* ---------- Ground ---------- */

/**
 * Floor, slab joints, holes, block shadows, walls and crates for a cols x rows patch.
 * kindAt(c, r) returns a cell value (FLOOR, WALL, CRATE or HOLE). up is the world direction
 * that is up on screen: that side of a block is lit and its shadow falls the other way.
 * px is one device pixel in world units, so the joints stay crisp.
 */
export function drawGround(c, pal, { cols, rows, kindAt, up = { x: 0, y: -1 }, px = 0.03 }) {
  c.fillStyle = pal.floor;
  c.fillRect(0, 0, cols, rows);
  c.strokeStyle = pal.joint;
  c.lineWidth = Math.max(px, 0.03);
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

  const each = (type, fn) => {
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) if (kindAt(col, r) === type) fn(col, r);
  };
  const down = { x: -up.x, y: -up.y };
  // The shadow falls down and a little to the right on screen.
  const sh = { x: 0.1 * -up.y + 0.14 * down.x, y: 0.1 * up.x + 0.14 * down.y };
  const edge = (col, r, n, t) => {
    if (n.x === 1) return [col + 1 - t, r, t, 1];
    if (n.x === -1) return [col, r, t, 1];
    if (n.y === 1) return [col, r + 1 - t, 1, t];
    return [col, r, 1, t];
  };

  // Holes: dark pits with a rim on the edges that face the light.
  c.fillStyle = pal.hole;
  c.beginPath();
  each(HOLE, (col, r) => c.rect(col, r, 1, 1));
  c.fill();
  c.fillStyle = pal.holeRim;
  c.beginPath();
  each(HOLE, (col, r) => {
    if (kindAt(col + down.x, r + down.y) !== HOLE) c.rect(...edge(col, r, down, 0.1));
  });
  c.fill();

  // Hard shadows for walls and crates.
  c.save();
  c.beginPath();
  c.rect(0, 0, cols, rows);
  c.clip();
  c.fillStyle = pal.shadow;
  c.beginPath();
  for (const type of [WALL, CRATE]) each(type, (col, r) => c.rect(col + sh.x, r + sh.y, 1, 1));
  c.fill();
  c.restore();

  // Walls and crates: flat blocks, lit on the edge that faces up on screen and shaded on the
  // edge that faces down. Blocks of a kind that touch join into one, edged only outside.
  const block = (type, fill, lit, dark, inside) => {
    let n = 0;
    c.fillStyle = fill;
    c.beginPath();
    each(type, (col, r) => {
      c.rect(col, r, 1, 1);
      n++;
    });
    if (!n) return;
    c.fill();
    if (inside) {
      c.save();
      c.clip();
      inside();
      c.restore();
    }
    c.fillStyle = lit;
    c.beginPath();
    each(type, (col, r) => {
      if (kindAt(col + up.x, r + up.y) !== type) c.rect(...edge(col, r, up, 0.09));
    });
    c.fill();
    c.fillStyle = dark;
    c.beginPath();
    each(type, (col, r) => {
      if (kindAt(col + down.x, r + down.y) !== type) c.rect(...edge(col, r, down, 0.09));
    });
    c.fill();
  };
  block(WALL, pal.wall, pal.wallLit, pal.wallDark);

  // Crates: a lighter grey with diagonal stripes, anchored to the arena rather than to each
  // cell, so they run on unbroken across crates that touch. They rise to the right on screen
  // whichever way the arena is turned.
  const right = { x: -up.y, y: up.x };
  const along = { x: (right.x + up.x) / Math.SQRT2, y: (right.y + up.y) / Math.SQRT2 };
  const across = { x: (right.x - up.x) / Math.SQRT2, y: (right.y - up.y) / Math.SQRT2 };
  block(CRATE, pal.crate, pal.crateLit, pal.crateDark, () => {
    const spread = [0, cols].flatMap((x) => [0, rows].map((y) => x * across.x + y * across.y));
    const reach = cols + rows;
    c.strokeStyle = pal.stripe;
    c.lineWidth = STRIPE_W;
    c.beginPath();
    for (let k = Math.floor(Math.min(...spread) / STRIPE_GAP); k <= Math.ceil(Math.max(...spread) / STRIPE_GAP); k++) {
      const x = across.x * k * STRIPE_GAP;
      const y = across.y * k * STRIPE_GAP;
      c.moveTo(x - along.x * reach, y - along.y * reach);
      c.lineTo(x + along.x * reach, y + along.y * reach);
    }
    c.stroke();
  });
}

/* ---------- Tanks ---------- */

/** A tank's shadow, offset by `off` (world units), in the footprint of its treads or base plate. */
export function drawTankShadow(c, pal, t, off, alpha = 1) {
  c.globalAlpha = alpha;
  c.fillStyle = pal.shadow;
  c.save();
  c.translate(t.x + off.x, t.y + off.y);
  c.scale(ART, ART);
  c.rotate(t.body);
  if (TYPES[t.type].speed) roundRect(c, -0.43, -0.39, 0.86, 0.78, 0.08);
  else pad(c, 0.44, 0.13);
  c.fill();
  c.restore();
  c.globalAlpha = 1;
}

/** Where the mine discs sit on the rear deck, across the hull (hull units). */
function discSpots(n) {
  const gap = n > 2 ? 0.125 : 0.2;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
}

/**
 * A minigun's six barrels along +x in turret space, bound by a clamp. roll turns the bundle
 * on its axis: seen from above, the barrels slide across each other as it spins, the nearest
 * drawn last and lightest. Its motor housing sits on top of the turret (minigunHousing).
 */
function minigunBarrels(c, tone, roll) {
  const ring = 0.075;
  const half = 0.03;
  const from = 0.2;
  const barrels = Array.from({ length: 6 }, (_, i) => roll + (i * TAU) / 6)
    .map((a) => ({ y: ring * Math.sin(a), near: Math.cos(a) }))
    .sort((a, b) => a.near - b.near);
  c.lineWidth = 0.02;
  for (const b of barrels) {
    c.fillStyle = b.near > 0.5 ? tone.base : b.near > -0.5 ? tone.dark : tone.deep;
    c.beginPath();
    c.rect(from, b.y - half, MUZZLE - from, half * 2);
    c.fill();
    c.stroke();
  }
  c.lineWidth = 0.04;
  c.fillStyle = tone.dark;
  c.beginPath();
  c.rect(0.42, -0.125, 0.045, 0.25);
  c.fill();
  c.stroke();
}

/** The minigun's motor: a box bolted over the turret, where other tanks show a hatch. */
function minigunHousing(c, pal, tone) {
  c.fillStyle = tone.dark;
  roundRect(c, -0.08, -0.14, 0.36, 0.28, 0.06);
  c.fill();
  c.stroke();
  c.fillStyle = pal.ink;
  for (const y of [-0.075, 0.075]) {
    disc(c, -0.01, y, 0.03);
    c.fill();
  }
}

/**
 * A tank at (t.x, t.y), hull turned to t.body, turret to t.turret. opts: phase (how far its
 * tread cleats have rolled), mines (discs still on the rear deck; the rest are laid), lit
 * (a missile tank's light: one of its missiles is in the air), roll (how far a minigun's
 * barrels have turned on their axis), alpha.
 */
export function drawTank(c, pal, t, { phase = 0, mines = TYPES[t.type].mines, lit = false, roll = 0, alpha = 1 } = {}) {
  const T = TYPES[t.type];
  const tone = pal.tanks[t.type];
  c.globalAlpha = alpha;
  c.save();
  c.translate(t.x, t.y);
  c.scale(ART, ART);
  c.rotate(t.body);
  if (T.speed) {
    // Treads with cleats that roll as it drives.
    c.fillStyle = pal.tread;
    roundRect(c, -0.43, -0.39, 0.86, 0.21, 0.05);
    c.fill();
    roundRect(c, -0.43, 0.18, 0.86, 0.21, 0.05);
    c.fill();
    c.strokeStyle = tone.deep;
    c.lineWidth = 0.035;
    c.beginPath();
    for (let k = -0.42 + (phase % 0.14); k < 0.42; k += 0.14) {
      c.moveTo(k, -0.37);
      c.lineTo(k, -0.2);
      c.moveTo(k, 0.2);
      c.lineTo(k, 0.37);
    }
    c.stroke();
  } else {
    // A concrete pad bolted to the floor: this one never moves.
    c.fillStyle = pal.plate;
    pad(c, 0.44, 0.13);
    c.fill();
    c.strokeStyle = pal.ink;
    c.lineWidth = 0.04;
    c.stroke();
    c.fillStyle = pal.ink;
    for (const bx of [-0.33, 0.33]) for (const by of [-0.33, 0.33]) {
      disc(c, bx, by, 0.045);
      c.fill();
    }
  }
  // Hull.
  c.fillStyle = tone.base;
  roundRect(c, -0.37, -0.26, 0.74, 0.52, 0.09);
  c.fill();
  if (VARIANTS[t.type]) {
    // Hazard stripes across the hull, slanting back from the nose. The rear deck stays plain,
    // so its mine discs still read.
    c.save();
    c.clip();
    c.beginPath();
    c.rect(-0.21, -0.3, 0.6, 0.6);
    c.clip();
    c.strokeStyle = pal.ink;
    c.lineWidth = 0.075;
    c.beginPath();
    for (let x = -0.62; x < 0.5; x += 0.19) {
      c.moveTo(x, -0.3);
      c.lineTo(x + 0.3, 0.3);
    }
    c.stroke();
    c.restore();
    roundRect(c, -0.37, -0.26, 0.74, 0.52, 0.09);
  }
  c.strokeStyle = pal.ink;
  c.lineWidth = 0.045;
  c.stroke();
  c.fillStyle = tone.dark;
  c.fillRect(0.22, -0.2, 0.08, 0.4);
  if (T.mines) {
    // Mines on the rear deck: one disc each, an empty socket for each one laid.
    discSpots(T.mines).forEach((y, i) => {
      disc(c, -0.285, y, 0.06);
      if (i < mines) {
        c.fillStyle = pal.ink;
        c.fill();
        c.fillStyle = tone.light;
        disc(c, -0.285, y, 0.026);
        c.fill();
      } else {
        c.strokeStyle = tone.deep;
        c.lineWidth = 0.022;
        c.stroke();
      }
    });
  } else {
    c.fillRect(-0.3, -0.2, 0.08, 0.4);
  }
  c.restore();

  // Turret and weapon. A barrel reaches the real muzzle, where shots appear.
  c.save();
  c.translate(t.x, t.y);
  c.rotate(t.turret);
  c.strokeStyle = pal.ink;
  c.lineWidth = 0.04;
  c.fillStyle = tone.dark;
  if (T.weapon === 'shell') {
    c.beginPath();
    c.rect(0.08, -0.065, MUZZLE - 0.08, 0.13);
    c.fill();
    c.stroke();
  } else if (T.weapon === 'rocket') {
    // A heavy barrel ending in a muzzle brake: two wide baffles across the tip, so the gun
    // reads as a hammerhead, wide at the end where a shell barrel stays thin.
    c.beginPath();
    c.rect(0.08, -0.075, MUZZLE - 0.08, 0.15);
    c.fill();
    c.stroke();
    for (const x of [MUZZLE - 0.15, MUZZLE - 0.065]) {
      c.beginPath();
      c.rect(x, -0.14, 0.065, 0.28);
      c.fill();
      c.stroke();
    }
  } else if (T.weapon === 'minigun') {
    minigunBarrels(c, tone, roll);
  } else if (T.weapon === 'missile') {
    for (const side of [-1, 1]) {
      c.fillStyle = tone.dark;
      c.beginPath();
      c.rect(0.02, side * 0.11 - 0.065, 0.44, 0.13);
      c.fill();
      c.stroke();
      c.fillStyle = pal.ink;
      disc(c, 0.4, side * 0.11, 0.035);
      c.fill();
    }
  }
  c.fillStyle = tone.light;
  disc(c, 0, 0, 0.2 * ART);
  c.fill();
  c.stroke();
  if (T.weapon === 'bomb') {
    // A mortar tube seen from above, leaning a little toward its aim.
    c.fillStyle = tone.deep;
    disc(c, 0.035, 0, 0.15);
    c.fill();
    c.stroke();
    c.fillStyle = pal.ink;
    disc(c, 0.045, 0, 0.095);
    c.fill();
  } else if (T.weapon === 'minigun') {
    minigunHousing(c, pal, tone);
  } else if (T.weapon === 'missile') {
    // Its light is lit while one of its missiles is in the air.
    c.fillStyle = lit ? pal.flash : tone.deep;
    disc(c, -0.05 * ART, 0, 0.085);
    c.fill();
    c.fillStyle = lit ? pal.alarm : pal.ink;
    disc(c, -0.05 * ART, 0, 0.055);
    c.fill();
  } else {
    c.fillStyle = tone.dark;
    disc(c, -0.05 * ART, 0, 0.065 * ART);
    c.fill();
  }
  c.restore();
  c.globalAlpha = 1;
}

/**
 * One tank kind, facing right, filling a w x h box whose top-left corner is the origin,
 * on a patch of floor. For badges: the banner, the results and the guide.
 */
export function drawBadge(c, pal, kind, w, h) {
  c.fillStyle = pal.floor;
  c.fillRect(0, 0, w, h);
  const s = Math.min(w / 1.3, h / 1.05);
  c.save();
  c.translate(w / 2 - 0.065 * s, h / 2);
  c.scale(s, s);
  drawTank(c, pal, { type: kind, x: 0, y: 0, body: 0, turret: 0 });
  c.restore();
}

/* ---------- Mines, shells, missiles and bombs ---------- */

/**
 * A mine in its owner's colour. light: 'on', 'off' or 'urgent' (its last seconds). The
 * caller decides the blinking, and keeps the light steady under reduced motion.
 */
export function drawMine(c, pal, m, kind, light, shadowOff) {
  const tone = pal.tanks[kind] || pal.tanks.player;
  c.fillStyle = pal.shadow;
  disc(c, m.x + shadowOff.x, m.y + shadowOff.y, 0.24);
  c.fill();
  c.fillStyle = pal.ink;
  disc(c, m.x, m.y, 0.24);
  c.fill();
  c.fillStyle = tone.base;
  disc(c, m.x, m.y, 0.16);
  c.fill();
  if (light !== 'off') {
    c.fillStyle = light === 'urgent' ? pal.alarm : pal.signal;
    disc(c, m.x, m.y, 0.07);
    c.fill();
  }
}

/**
 * A shell, rocket, missile or minigun round, pointing along its velocity. flame (0-1) flickers a rocket's
 * flame; blink says whether a missile's light is on this frame.
 */
export function drawShot(c, pal, b, { flame = 0.5, blink = true } = {}) {
  c.save();
  c.translate(b.x, b.y);
  c.rotate(Math.atan2(b.vy, b.vx));
  if (b.weapon === 'rocket') {
    c.fillStyle = pal.fire;
    c.beginPath();
    c.moveTo(-0.13, -0.05);
    c.lineTo(-0.3 - flame * 0.08, 0);
    c.lineTo(-0.13, 0.05);
    c.fill();
  }
  c.fillStyle = pal.shell;
  if (b.weapon === 'minigun') {
    // A tracer round: a small slug with a fading streak behind it.
    c.globalAlpha *= 0.4;
    c.fillStyle = pal.flash;
    c.beginPath();
    c.moveTo(-0.32, 0);
    c.lineTo(-0.05, -0.03);
    c.lineTo(-0.05, 0.03);
    c.closePath();
    c.fill();
    c.globalAlpha /= 0.4;
    c.fillStyle = pal.shell;
    roundRect(c, -0.07, -0.035, 0.16, 0.07, 0.035);
    c.fill();
  } else if (b.weapon === 'missile') {
    c.fillStyle = pal.fire;
    c.beginPath();
    c.moveTo(-0.16, -0.035);
    c.lineTo(-0.24 - flame * 0.05, 0);
    c.lineTo(-0.16, 0.035);
    c.fill();
    c.fillStyle = pal.shell;
    // Fins, body, and the red light in its nose.
    c.beginPath();
    c.moveTo(-0.17, -0.11);
    c.lineTo(-0.07, -0.05);
    c.lineTo(-0.07, 0.05);
    c.lineTo(-0.17, 0.11);
    c.closePath();
    c.fill();
    roundRect(c, -0.17, -0.06, 0.34, 0.12, 0.06);
    c.fill();
    if (blink) {
      c.fillStyle = pal.alarm;
      disc(c, 0.09, 0, 0.042);
      c.fill();
    }
  } else {
    // A bullet: square-ish back with rounded corners, tapering to a point in front.
    const h = 0.065, r = 0.035;
    c.beginPath();
    c.moveTo(-0.14 + r, -h);
    c.lineTo(-0.01, -h);
    c.quadraticCurveTo(0.08, -h, 0.16, 0);
    c.quadraticCurveTo(0.08, h, -0.01, h);
    c.lineTo(-0.14 + r, h);
    c.arcTo(-0.14, h, -0.14, h - r, r);
    c.lineTo(-0.14, -h + r);
    c.arcTo(-0.14, -h, -0.14 + r, -h, r);
    c.closePath();
    c.fill();
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
  disc(c, b.tx, b.ty, BOMB_R);
  c.fill();
  c.globalAlpha = 0.85;
  c.strokeStyle = pal.alarm;
  c.lineWidth = 0.05;
  c.setLineDash([0.16, 0.1]);
  disc(c, b.tx, b.ty, BOMB_R);
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
    disc(c, b.tx, b.ty, BOMB_R + (1 - k) * 1.3);
    c.stroke();
  }
  c.restore();
}

/**
 * A bomb in the air, raised toward `up` (screen up, in world terms) above its shadow. It
 * looms a little larger at the top of its arc, and a pale rim keeps it visible over walls.
 */
export function drawBomb(c, pal, b, up) {
  const p = bombAt(b);
  const top = 0.35 + 0.08 * Math.hypot(b.tx - b.x0, b.ty - b.y0);
  const lift = top > 0 ? p.h / top : 0;
  c.fillStyle = pal.shadow;
  disc(c, p.x, p.y, 0.09 + 0.07 * (1 - lift));
  c.fill();
  const x = p.x + up.x * p.h;
  const y = p.y + up.y * p.h;
  const r = 0.14 + 0.06 * lift;
  c.fillStyle = pal.flash;
  disc(c, x, y, r + 0.035);
  c.fill();
  c.fillStyle = pal.ink;
  disc(c, x, y, r);
  c.fill();
  c.fillStyle = pal.flash;
  disc(c, x + up.x * r * 0.4, y + up.y * r * 0.4, r * 0.28);
  c.fill();
}
