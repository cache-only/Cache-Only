// Tanks rules shared by the engine, the AI and the renderer. No DOM.
// World units are grid cells and a block is 1 x 1. Every arena is 4:3, SCALE x 4 cells by
// SCALE x 3: the campaign's are COLS x ROWS, and a map of your own can be any of SCALES.

export const SCALES = [3, 4, 5, 6, 7, 8];
export const SCALE = 5;
export const COLS = SCALE * 4;
export const ROWS = SCALE * 3;

/** The columns and rows of an arena at a scale. */
export const sizeAt = (scale) => [scale * 4, scale * 3];

/**
 * A grid's columns and rows, read from its length: every arena is 4:3, so a grid of n cells is
 * sqrt(n * 4 / 3) wide (exact for every scale). A world needs nothing more to say its size.
 */
export function gridSize(grid) {
  const cols = Math.sqrt((grid.length * 4) / 3);
  return [cols, grid.length / cols];
}

/** Whether a grid of n cells is an arena of one of SCALES. */
export const isArenaLength = (n) => SCALES.some((k) => k * k * 12 === n);

export const FLOOR = 0;
export const WALL = 1;
export const CRATE = 2; // breakable: shells bounce off it, a mine blast clears it
export const HOLE = 3; // tanks can't cross it, shells fly over it

export const STEP = 1 / 120; // fixed simulation step, seconds
export const TANK_R = 0.38; // body radius against walls and other tanks
export const HIT_R = 0.36; // how close a shell or blast must get to destroy a tank
export const SHELL_R = 0.09;
export const MUZZLE = 0.56; // distance from a tank's centre to where its shells appear
export const POD = 0.11; // how far either side of its aim a missile tank's two launch pods sit
export const TWIN_SPREAD = 0.17; // radians either side of its aim a pair of missiles leaves at (Night Red)
export const MINE_R = 0.24;
export const MINE_FUSE = 10; // seconds
export const MINE_TRIGGER = 0.8; // a tank this close sets a mine off
export const BLAST_R = 1.5;
export const OPENING = 1.2; // seconds at the start of a mission before enemies open fire
export const TAP_RANGE = 6.5; // cells: a tap on the aim stick fires at an enemy in sight this close

export const MISSILE_TURN = 2.2; // radians per second a guided missile can turn
export const MISSILE_FUEL = 4; // seconds a missile steers; after that it flies straight
export const LOCK = Math.PI / 2; // a missile steers only while you are this close to its nose
export const BOMB_FLIGHT = 1.5; // seconds from launch to landing, whatever the distance
export const BOMB_R = 1; // blast radius of a landing bomb
export const BOMB_MIN = 3; // a mortar can't aim closer than this...
export const BOMB_MAX = 12; // ...or further than this
export const SPIN_UP = 1.2; // seconds a minigun's barrels take to come up to speed from rest
export const SPIN_DOWN = 2.5; // seconds they take to run down from full speed
export const SPRAY_TURN = 0.5; // radians per second its turret turns with the barrels at full speed
export const SPRAY_R = 0.6; // a minigun fires while its line passes this close to your centre
export const VEL_SMOOTH = 0.12; // seconds: how quickly the AI's read of your velocity follows you
export const LASER_CHARGE = 0.9; // seconds a laser shows its red line before it fires down it...
export const LASER_BEAM = 1; // ...and how long the beam then burns
export const LASER_W = 0.07; // half the beam's width: it burns whatever comes this close to its line

const SHELL = 4.6; // units per second
const ROCKET = 8.4;
const MISSILE = 3.2;
const ROUND = 6.4;

/**
 * What a tank fires. Shells and rockets fly straight, missiles steer, bombs are lobbed, a
 * minigun sprays rounds once its barrels are spinning, and a laser shows a red line for
 * LASER_CHARGE seconds, then burns down it for LASER_BEAM: through every tank, shot and mine on
 * the line, until a wall or crate stops it.
 */
export const WEAPONS = ['shell', 'rocket', 'missile', 'bomb', 'minigun', 'laser'];

/**
 * Every tank kind. speed 0 = stationary. turn and turret are radians per second.
 * weapon: see WEAPONS, shot: shell speed (bombs have a fixed flight time instead),
 * bounces: ricochets before the shell dies, bullets: shells (or bombs) in flight at once,
 * mines: mines on the ground at once, reload: seconds between shots.
 * AI only: aim ('sweep' | 'direct' | 'bank' | 'guided' | 'lob' | 'spray'), think (seconds between
 * decisions), react (delay before a new shot), spread (radians of inaccuracy), scatter
 * (cells a bomb may land from its aim point), dodge (0-1), range (preferred path distance
 * to the player, in cells), layRate (the chance a minelayer drops a mine when it thinks about
 * it), trap (lays mines by plan rather than by chance: on your way to it, then watches them),
 * detonate (shoots one of the mines on the ground when its blast would catch you), lead (0-1:
 * how much of your motion it aims ahead for). Yellow lays mines; so does its night version.
 * Every kind stands alone in its own colour. A kind's stronger version is its night version
 * (NIGHT, below), added here as <kind>Night.
 */
export const TYPES = {
  player: { speed: 1.9, turn: 7, weapon: 'shell', shot: SHELL, bounces: 1, bullets: 5, mines: 2, reload: 0.12 },
  brown: {
    speed: 0, turn: 0, turret: 0.9, weapon: 'shell', shot: SHELL, bounces: 1, bullets: 1, mines: 0, reload: 2.8,
    aim: 'sweep', think: 0.3, react: 0.6, spread: 0.08, dodge: 0,
  },
  ash: {
    speed: 1.0, turn: 4, turret: 1.6, weapon: 'shell', shot: SHELL, bounces: 1, bullets: 1, mines: 0, reload: 2.2,
    aim: 'direct', think: 0.25, react: 0.45, spread: 0.07, dodge: 0.2, range: [6, 11],
  },
  marine: {
    speed: 1.0, turn: 4, turret: 1.8, weapon: 'rocket', shot: ROCKET, bounces: 0, bullets: 1, mines: 0, reload: 2.4,
    aim: 'direct', think: 0.25, react: 0.4, spread: 0.035, dodge: 0.3, range: [7, 12], lead: 0.5,
  },
  yellow: {
    speed: 1.8, turn: 5, turret: 2, weapon: 'shell', shot: SHELL, bounces: 1, bullets: 1, mines: 2, reload: 2.6,
    aim: 'direct', think: 0.2, react: 0.45, spread: 0.07, dodge: 0.35, range: [3, 7], layRate: 0.45,
  },
  pink: {
    speed: 1.0, turn: 4, turret: 2.2, weapon: 'shell', shot: SHELL, bounces: 1, bullets: 3, mines: 0, reload: 0.6,
    aim: 'bank', think: 0.2, react: 0.35, spread: 0.045, dodge: 0.4, range: [4, 9], lead: 0.2,
  },
  green: {
    speed: 0, turn: 0, turret: 2.4, weapon: 'rocket', shot: ROCKET, bounces: 2, bullets: 2, mines: 0, reload: 1.7,
    aim: 'bank', think: 0.25, react: 0.35, spread: 0.02, dodge: 0,
  },
  // missileTurn and fuel: how fast its missiles turn (radians per second) and for how long.
  red: {
    speed: 1.0, turn: 4, turret: 2.0, weapon: 'missile', shot: MISSILE, bounces: 0, bullets: 1, mines: 0, reload: 3,
    missileTurn: MISSILE_TURN, fuel: MISSILE_FUEL,
    aim: 'guided', think: 0.2, react: 0.45, spread: 0.03, dodge: 0.3, range: [5, 10],
  },
  white: {
    speed: 1.8, turn: 6, turret: 2.6, weapon: 'shell', shot: SHELL, bounces: 1, bullets: 5, mines: 0, reload: 0.6,
    aim: 'bank', think: 0.15, react: 0.3, spread: 0.04, dodge: 0.5, range: [3, 8], lead: 0.3,
    invisible: true,
  },
  black: {
    speed: 2.4, turn: 8, turret: 3.2, weapon: 'rocket', shot: ROCKET, bounces: 0, bullets: 3, mines: 0, reload: 0.8,
    aim: 'direct', think: 0.12, react: 0.25, spread: 0.03, dodge: 0.85, range: [2, 6], lead: 0.6,
  },
  olive: {
    speed: 0, turn: 0, turret: 1.4, weapon: 'bomb', bounces: 0, bullets: 1, mines: 0, reload: 3.5,
    aim: 'lob', think: 0.3, react: 0.6, scatter: 0.45, dodge: 0, lead: 0.8,
  },
  lime: {
    speed: 1.2, turn: 4, turret: 1.5, weapon: 'minigun', shot: ROUND, bounces: 0, bullets: 10, mines: 0, reload: 0.1,
    aim: 'spray', think: 0.2, react: 0.4, spread: 0.1, dodge: 0.15, range: [4, 8],
  },
  // A laser: no shot speed (the beam is there at once); reload counts from the end of the beam.
  // track: how fast the beam turns after you while it burns, radians per second (0: it holds).
  indigo: {
    speed: 1.0, turn: 4, turret: 1.6, weapon: 'laser', bounces: 0, bullets: 1, mines: 0, reload: 2.6, track: 0,
    aim: 'direct', think: 0.25, react: 0.5, spread: 0.02, dodge: 0.25, range: [6, 12],
  },
};

/**
 * Night versions: a kind made stronger, the same tank (colour, weapon, shape) with better numbers
 * or a better behaviour, never worse on any (a test holds it). Each lists only what changes from
 * its day kind; null drops a stat. Each becomes TYPES.<kind>Night, with base (its day kind) and
 * night: true, so every lookup by type works as it is. It is drawn with a deep hull in its day
 * kind's colour (art.js), and its map letter is the day kind's in upper case.
 */
export const NIGHT = {
  // Faster, more shells in the air, quicker to react and dodge, and leads you further.
  pink: { speed: 1.8, turn: 6, turret: 2.6, bullets: 5, think: 0.15, react: 0.3, spread: 0.04, dodge: 0.6, range: [3, 7], lead: 0.3 },
  // Lays 4 mines by plan on your way to it, watches them, and shoots one as you pass.
  yellow: {
    turn: 6, turret: 2.2, mines: 4, reload: 2.4, think: 0.15, react: 0.35, spread: 0.06, dodge: 0.45, range: [4, 8],
    layRate: null, trap: true, detonate: true,
  },
  // Fires both pods at once, 10 degrees either side of its aim (pair); its missiles are faster,
  // turn tighter, steer longer, and follow the open way round walls to you (path).
  red: { bullets: 2, shot: 3.8, missileTurn: 3.2, fuel: 5, pair: true, path: true, think: 0.18, react: 0.4, dodge: 0.35 },
  // Dodges more and sooner, and walks its stream across where you would sidestep to: up to walk
  // cells either side of you.
  lime: { speed: 1.4, turn: 5, think: 0.12, react: 0.35, dodge: 0.5, walk: 1 },
  // Turns its beam after you as it burns, slower than you can run round it from 5 cells out.
  indigo: { speed: 1.2, turn: 5, turret: 2.0, track: 0.4, think: 0.2, react: 0.4, dodge: 0.4 },
};
for (const [base, over] of Object.entries(NIGHT)) {
  const t = { ...TYPES[base], ...over, base, night: true };
  for (const k of Object.keys(t)) if (t[k] === null) delete t[k];
  TYPES[`${base}Night`] = t;
}

/**
 * Enemy kinds in the order they first appear, for results screens. Lime and the night versions
 * after it, and Indigo and Night Indigo, are in no mission yet: the test range only.
 */
export const ENEMY_KINDS = ['brown', 'ash', 'marine', 'yellow', 'pink', 'green', 'pinkNight', 'red', 'white', 'black', 'olive', 'lime', 'yellowNight', 'redNight', 'limeNight', 'indigo', 'indigoNight'];

/**
 * Map letters for enemy spawns. "@" is the player, "#" wall, "x" crate, "o" hole. A night
 * version is its day kind's letter in upper case.
 */
export const SPAWN_CODES = {
  b: 'brown',
  a: 'ash',
  m: 'marine',
  y: 'yellow',
  p: 'pink',
  g: 'green',
  r: 'red',
  w: 'white',
  k: 'black',
  d: 'olive',
  l: 'lime',
  i: 'indigo',
  P: 'pinkNight',
  Y: 'yellowNight',
  R: 'redNight',
  L: 'limeNight',
  I: 'indigoNight',
};

/** Letters of kinds since retired, as saved maps may hold them: Violet is Night Pink, Hornet Night Yellow. */
export const OLD_CODES = { v: 'P', h: 'Y' };

const EPS = 1e-9;
export const TAU = Math.PI * 2;

/** Cell value; anything outside the arena is wall. */
export function cellAt(grid, c, r) {
  const cols = Math.sqrt((grid.length * 4) / 3); // gridSize, inlined: this runs for every cell a shot crosses
  return c < 0 || r < 0 || c >= cols || r * cols >= grid.length ? WALL : grid[r * cols + c];
}

export const blocksTank = (v) => v !== FLOOR;
export const blocksShell = (v) => v === WALL || v === CRATE;

/** How many of a tank's shells (or mines) are out. */
export function owned(list, t) {
  let n = 0;
  for (const o of list) if (o.owner === t.id) n++;
  return n;
}

/** Whether a tank may stand in cell (c, r). */
export function open(grid, c, r) {
  return cellAt(grid, c, r) === FLOOR;
}

/** Whether a hull of radius r centred on (x, y) overlaps a block tanks can't cross. */
export function hullBlocked(grid, x, y, r = TANK_R) {
  for (let row = Math.floor(y - r); row <= Math.floor(y + r); row++) {
    for (let col = Math.floor(x - r); col <= Math.floor(x + r); col++) {
      if (!blocksTank(cellAt(grid, col, row))) continue;
      const px = Math.max(col, Math.min(col + 1, x));
      const py = Math.max(row, Math.min(row + 1, y));
      if ((x - px) ** 2 + (y - py) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** a - b wrapped to (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

export const wrapAngle = (a) => angleDiff(a, 0);

/** mulberry32 on the world's seed, so a saved world replays the same dice. */
export function rand(s) {
  let t = (s.seed = (s.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Whether a box of half-size r centred on (x, y) overlaps a block shells can't pass. */
export function boxBlocked(grid, x, y, r = SHELL_R) {
  const c0 = Math.floor(x - r + EPS);
  const c1 = Math.floor(x + r - EPS);
  const r0 = Math.floor(y - r + EPS);
  const r1 = Math.floor(y + r - EPS);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) if (blocksShell(cellAt(grid, col, row))) return true;
  }
  return false;
}

function spanBlocked(grid, line, lo, hi, column) {
  const a = Math.floor(lo + EPS);
  const b = Math.floor(hi - EPS);
  for (let k = a; k <= b; k++) {
    if (blocksShell(column ? cellAt(grid, line, k) : cellAt(grid, k, line))) return true;
  }
  return false;
}

/**
 * First wall contact of a shell (a box of half-size r) moving from (x, y) along the unit
 * vector (ux, uy), within maxD. Walks the grid lines its leading edges cross, so it is
 * exact at any speed. Returns { d, x, y } where x / y say which velocity component flips
 * (both for a square corner hit), or null.
 */
export function nextContact(grid, x, y, ux, uy, r, maxD) {
  let lx = 0;
  let ly = 0;
  let dx = Infinity;
  let dy = Infinity;
  let stepX = 0;
  let stepY = 0;
  if (ux > EPS) {
    const e = x + r;
    lx = Math.floor(e - EPS) + 1;
    dx = (lx - e) / ux;
    stepX = 1 / ux;
  } else if (ux < -EPS) {
    const e = x - r;
    lx = Math.ceil(e + EPS) - 1;
    dx = (lx - e) / ux;
    stepX = -1 / ux;
  }
  if (uy > EPS) {
    const e = y + r;
    ly = Math.floor(e - EPS) + 1;
    dy = (ly - e) / uy;
    stepY = 1 / uy;
  } else if (uy < -EPS) {
    const e = y - r;
    ly = Math.ceil(e + EPS) - 1;
    dy = (ly - e) / uy;
    stepY = -1 / uy;
  }
  const col = () => (ux > 0 ? lx : lx - 1);
  const row = () => (uy > 0 ? ly : ly - 1);
  for (let guard = 0; guard < 256; guard++) {
    const d = Math.min(dx, dy);
    if (d > maxD) return null;
    const tie = Math.abs(dx - dy) < 1e-9;
    const crossX = dx <= dy || tie;
    const crossY = dy <= dx || tie;
    let hx = false;
    let hy = false;
    if (crossX) {
      const cy = y + uy * d;
      hx = spanBlocked(grid, col(), cy - r, cy + r, true);
    }
    if (crossY) {
      const cx = x + ux * d;
      hy = spanBlocked(grid, row(), cx - r, cx + r, false);
    }
    // Exactly through a corner: only the diagonal block is in the way.
    if (tie && !hx && !hy && blocksShell(cellAt(grid, col(), row()))) hx = hy = true;
    if (hx || hy) return { d: Math.max(0, d), x: hx, y: hy };
    if (crossX) {
      lx += ux > 0 ? 1 : -1;
      dx += stepX;
    }
    if (crossY) {
      ly += uy > 0 ? 1 : -1;
      dy += stepY;
    }
  }
  return null;
}

/**
 * Moves p ({ x, y, vx, vy }) `dist` units along its velocity, reflecting off walls.
 * onWall(p, contact) runs at each contact after the reflection; returning false stops
 * the shell there. Returns the distance travelled.
 */
export function advance(grid, p, dist, onWall, r = SHELL_R) {
  let travelled = 0;
  for (let guard = 0; guard < 32 && travelled < dist - EPS; guard++) {
    const speed = Math.hypot(p.vx, p.vy);
    if (!speed) return travelled;
    const ux = p.vx / speed;
    const uy = p.vy / speed;
    const left = dist - travelled;
    const hit = nextContact(grid, p.x, p.y, ux, uy, r, left);
    if (!hit) {
      p.x += ux * left;
      p.y += uy * left;
      return dist;
    }
    p.x += ux * hit.d;
    p.y += uy * hit.d;
    travelled += hit.d;
    if (hit.x) p.vx = -p.vx;
    if (hit.y) p.vy = -p.vy;
    if (onWall && onWall(p, hit) === false) return travelled;
  }
  return travelled;
}

/**
 * The path a shell would take from (x, y) heading `angle`, as a flat list of points
 * [x0, y0, x1, y1, ...]. It ends where the shell would die (a wall after its last
 * ricochet) or after maxLen units.
 */
export function tracePath(grid, x, y, angle, bounces, maxLen = 48) {
  const p = { x, y, vx: Math.cos(angle), vy: Math.sin(angle) };
  const pts = [x, y];
  let left = bounces;
  let ended = false;
  advance(grid, p, maxLen, (q) => {
    pts.push(q.x, q.y);
    if (left-- <= 0) {
      ended = true;
      return false;
    }
    return true;
  });
  if (!ended) pts.push(p.x, p.y);
  return pts;
}

/** Whether a shell fired from a tank at (x, y) toward `angle` would start inside a wall. */
export function muzzleBlocked(grid, x, y, angle) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (let d = 0.1; d < MUZZLE; d += 0.1) {
    if (blocksShell(cellAt(grid, Math.floor(x + ux * d), Math.floor(y + uy * d)))) return true;
  }
  return boxBlocked(grid, x + ux * MUZZLE, y + uy * MUZZLE);
}

/**
 * A laser's line from a tank at (x, y) aimed at `angle`: from its muzzle to the first wall or
 * crate. Holes don't stop it. { x0, y0, x1, y1 }.
 */
export function beamLine(grid, x, y, angle) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const x0 = x + ux * MUZZLE;
  const y0 = y + uy * MUZZLE;
  const hit = nextContact(grid, x0, y0, ux, uy, 0.02, 64);
  const d = hit ? hit.d + 0.02 : 64;
  return { x0, y0, x1: x0 + ux * d, y1: y0 + uy * d };
}

/**
 * Distance along the segment (ax, ay)-(bx, by) at which it first comes within `radius`
 * of (cx, cy), or -1 if it never does.
 */
export function segmentHit(ax, ay, bx, by, cx, cy, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  if (len < EPS) return -1;
  const ux = dx / len;
  const uy = dy / len;
  const b = fx * ux + fy * uy;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= len ? t : -1;
}
