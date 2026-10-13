// Enemy tank brains. Pure functions over the world state; every bit of memory lives in
// tank.ai so a saved world resumes exactly. Derived data (the path field) is cached in a
// WeakMap and keyed by state, so it never changes the outcome.
import {
  BLAST_R,
  BOMB_FLIGHT,
  BOMB_MAX,
  BOMB_MIN,
  BOMB_R,
  COLS,
  HIT_R,
  MUZZLE,
  OPENING,
  ROWS,
  SHELL_R,
  TANK_R,
  TAP_RANGE,
  TAU,
  TYPES,
  angleDiff,
  blocksShell,
  cellAt,
  hullBlocked,
  muzzleBlocked,
  nextContact,
  open,
  owned,
  rand,
  segmentHit,
  tracePath,
  wrapAngle,
} from './rules.js';

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const STUCK_T = 0.4; // a tank trying to move that covers less than STUCK_D in this long...
const STUCK_D = 0.1; // ...is stuck: it gives up on its cell, backs off and chooses again
const SHUN_T = 2; // seconds a stuck tank treats the cell it couldn't reach as closed
const BACK_T = 0.3; // seconds it backs off for
const YIELD_T = 4; // at most this long a tank gives way to one with right of way
const ALIGN = [0.03, 0.12]; // off a narrow way's centre line by this much, a tank lines up first

const fields = new WeakMap();
const faces = new WeakMap();

export function initBrain(s, t) {
  const T = TYPES[t.type];
  t.ai = {
    think: rand(s) * T.think,
    check: 0,
    aim: t.turret,
    planned: false,
    wait: OPENING + T.react * (1 + rand(s)),
    sweep: 0,
    goal: -1,
    goalT: 0,
    hold: false,
    hx: -1,
    hy: 0,
    mx: 0,
    my: 0,
    dodgeT: 0,
    lay: 2 + rand(s) * 3,
    sx: t.x, // where (and for which goal cell) the stuck check last measured from
    sy: t.y,
    sg: -1,
    st: 0,
    shun: -1, // a cell it couldn't reach, closed for shunT seconds
    shunT: 0,
    backT: 0,
    yieldT: 0, // giving way to tank yieldTo, travelling along (yx, yy), for yieldT seconds
    yieldTo: 0,
    yx: 0,
    yy: 0,
  };
}

/** Distance in steps from every open cell to the player's cell; -1 if unreachable. */
export function pathField(s) {
  const p = s.tanks[0];
  const pc = Math.floor(p.y) * COLS + Math.floor(p.x);
  const hit = fields.get(s);
  if (hit && hit.pc === pc && hit.ver === s.gridVer) return hit.f;
  const f = new Int16Array(COLS * ROWS).fill(-1);
  const queue = [pc];
  f[pc] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const c = i % COLS;
    const r = (i - c) / COLS;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!open(s.grid, nc, nr)) continue;
      if (dc && dr && (!open(s.grid, c + dc, r) || !open(s.grid, c, r + dr))) continue;
      const n = nr * COLS + nc;
      if (f[n] >= 0) continue;
      f[n] = f[i] + 1;
      queue.push(n);
    }
  }
  fields.set(s, { pc, ver: s.gridVer, f });
  return f;
}

/** Lines a shell centre reflects on: every wall face, pushed out by the shell radius. */
function reflectLines(s) {
  const hit = faces.get(s);
  if (hit && hit.ver === s.gridVer) return hit;
  const xs = new Set();
  const ys = new Set();
  const solid = (c, r) => blocksShell(cellAt(s.grid, c, r));
  for (let r = -1; r <= ROWS; r++) {
    for (let c = -1; c <= COLS; c++) {
      const here = solid(c, r);
      if (here !== solid(c + 1, r) && r >= 0 && r < ROWS) xs.add(here ? c + 1 + SHELL_R : c + 1 - SHELL_R);
      if (here !== solid(c, r + 1) && c >= 0 && c < COLS) ys.add(here ? r + 1 + SHELL_R : r + 1 - SHELL_R);
    }
  }
  const out = { ver: s.gridVer, xs: [...xs], ys: [...ys] };
  faces.set(s, out);
  return out;
}

/**
 * The first tank a shell fired by `shooter` at `angle` would hit, or null. The player
 * counts only if the shell would pass close to its centre; allies are given a wide berth.
 * A missile's curve isn't predicted: the check is the straight line it starts on.
 */
export function shotTarget(s, shooter, angle, bounces) {
  if (muzzleBlocked(s.grid, shooter.x, shooter.y, angle)) return null;
  const ox = shooter.x + Math.cos(angle) * MUZZLE;
  const oy = shooter.y + Math.sin(angle) * MUZZLE;
  const pts = tracePath(s.grid, ox, oy, angle, bounces, 40);
  const player = s.tanks[0];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    let best = Infinity;
    let target = null;
    for (const k of s.tanks) {
      if (!k.alive) continue;
      const radius = k === player ? 0.27 : k === shooter ? HIT_R : 0.55;
      const d = segmentHit(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], k.x, k.y, radius + SHELL_R);
      if (d >= 0 && d < best) {
        best = d;
        target = k;
      }
    }
    if (target) return target;
  }
  return null;
}

/** Whether a straight shell from tank a would reach tank b, d away, before any wall or crate. */
function inSight(grid, a, b, d) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (muzzleBlocked(grid, a.x, a.y, angle)) return false;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  // The shell hits once its centre comes within HIT_R + SHELL_R of the target's.
  const reach = d - MUZZLE - HIT_R - SHELL_R;
  return reach <= 0 || !nextContact(grid, a.x + ux * MUZZLE, a.y + uy * MUZZLE, ux, uy, SHELL_R, reach);
}

/**
 * Who a tap on the aim stick fires at: the nearest enemy within `range` cells that a straight
 * shell would reach. One behind a wall or crate is passed over for the next nearest in sight.
 * Invisible tanks are skipped, so the auto-aim can't give them away. Null if there is none.
 */
export function tapTarget(s, range = TAP_RANGE) {
  const p = s.tanks[0];
  const near = s.tanks
    .filter((t) => t.slot >= 0 && t.alive && !TYPES[t.type].invisible)
    .map((t) => ({ t, d: Math.hypot(t.x - p.x, t.y - p.y) }))
    .filter((o) => o.d <= range)
    .sort((a, b) => a.d - b.d);
  const seen = near.find((o) => inSight(s.grid, p, o.t, o.d));
  return seen ? seen.t : null;
}

/** Whether this tank ever notices this shell. Fixed per pair so a dull tank stays dull. */
function notices(bulletId, tankId, skill) {
  let h = Math.imul(bulletId ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(tankId + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296 < skill;
}

function openAt(grid, x, y) {
  return open(grid, Math.floor(x), Math.floor(y));
}

const cellOf = (x, y) => Math.floor(y) * COLS + Math.floor(x);

/* ---------- Reading the player ---------- */

/**
 * Where the player will be `ahead` seconds from now if it keeps its (smoothed) velocity.
 * It can't drive through a wall, so the prediction stops where its hull would meet one.
 */
export function predict(s, p, ahead) {
  const vx = p.svx || 0;
  const vy = p.svy || 0;
  const speed = Math.hypot(vx, vy);
  const dist = speed * ahead;
  if (!(dist > 1e-3)) return { x: p.x, y: p.y };
  const ux = vx / speed;
  const uy = vy / speed;
  // A hull sliding along a wall touches it, so test a slightly smaller one.
  const r = TANK_R - 0.06;
  let d = 0;
  while (d < dist) {
    const next = Math.min(dist, d + 0.1);
    if (hullBlocked(s.grid, p.x + ux * next, p.y + uy * next, r)) break;
    d = next;
  }
  return { x: p.x + ux * d, y: p.y + uy * d };
}

/**
 * Seconds until a shot fired now from tank t at speed w meets the player, if the player
 * keeps `lead` of its velocity: the exact intercept of a shell and a target at constant
 * speed, counting the muzzle the shell starts from.
 */
export function intercept(t, p, w, lead = 1) {
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  const vx = (p.svx || 0) * lead;
  const vy = (p.svy || 0) * lead;
  const plain = Math.max(0, Math.hypot(dx, dy) - MUZZLE) / w;
  // |D + V t| = w t + MUZZLE, squared: a t^2 + b t + c = 0, with a < 0 while the shell is faster.
  const a = vx * vx + vy * vy - w * w;
  const b = 2 * (dx * vx + dy * vy - w * MUZZLE);
  const c = dx * dx + dy * dy - MUZZLE * MUZZLE;
  if (c <= 0 || a > -1e-9) return plain;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return plain;
  const time = (-b - Math.sqrt(disc)) / (2 * a);
  return time >= 0 ? time : plain;
}

/* ---------- Aiming ---------- */

function planAim(s, t, T, player) {
  const ai = t.ai;
  if (T.aim === 'sweep') {
    if (ai.sweep <= 0) {
      ai.sweep = 1.4 + rand(s) * 2;
      const toward = Math.atan2(player.y - t.y, player.x - t.x);
      ai.aim = wrapAngle(rand(s) < 0.6 ? toward + (rand(s) - 0.5) * 1.4 : rand(s) * TAU);
    }
    return;
  }
  if (T.aim === 'lob') {
    planLob(s, t, T, player);
    return;
  }
  // Aim where the player will be when the shell arrives, if this kind leads its shots.
  let tx = player.x;
  let ty = player.y;
  if (T.lead) ({ x: tx, y: ty } = predict(s, player, intercept(t, player, T.shot, T.lead) * T.lead));
  const direct = Math.atan2(ty - t.y, tx - t.x);

  let best = null;
  const consider = (angle, bounces) => {
    if (shotTarget(s, t, angle, T.bounces) !== player) return;
    const cost = Math.abs(angleDiff(angle, t.turret)) + bounces * 0.5;
    if (!best || cost < best.cost) best = { angle, cost };
  };
  consider(direct, 0);
  if (T.aim === 'bank' && T.bounces > 0) {
    const lines = reflectLines(s);
    for (const x of lines.xs) consider(Math.atan2(ty - t.y, 2 * x - tx - t.x), 1);
    for (const y of lines.ys) consider(Math.atan2(2 * y - ty - t.y, tx - t.x), 1);
    if (T.bounces > 1 && !best) {
      const offset = rand(s) * (TAU / 160);
      for (let i = 0; i < 160; i++) consider(offset + (i * TAU) / 160, 2);
    }
  }
  if (best) {
    // A new line of fire takes a moment to react to.
    if (!ai.planned || Math.abs(angleDiff(best.angle, ai.aim)) > 0.3) ai.wait = Math.max(ai.wait, T.react * (0.6 + 0.8 * rand(s)));
    ai.aim = wrapAngle(best.angle);
    ai.planned = true;
  } else {
    ai.aim = direct;
    ai.planned = false;
  }
}

/** Whether any enemy (the mortar included) is too close to a spot for a bomb to land there. */
function nearAlly(s, x, y) {
  for (const o of s.tanks) {
    if (o.alive && o.slot >= 0 && Math.hypot(o.x - x, o.y - y) < BOMB_R + HIT_R + 0.6) return true;
  }
  return false;
}

/** A mortar can drop a bomb on (x, y): far enough, not too far, and clear of allies. */
function canLob(s, t, x, y) {
  const d = Math.hypot(x - t.x, y - t.y);
  return d >= BOMB_MIN && d <= BOMB_MAX && !nearAlly(s, x, y);
}

/** Bombs need no line of sight: the tube follows where you will be when one lands. */
function planLob(s, t, T, player) {
  const ai = t.ai;
  const p = predict(s, player, BOMB_FLIGHT * (T.lead || 0));
  const ok = canLob(s, t, p.x, p.y);
  if (ok && !ai.planned) ai.wait = Math.max(ai.wait, T.react * (0.6 + 0.8 * rand(s)));
  ai.planned = ok;
  ai.aim = Math.atan2(p.y - t.y, p.x - t.x);
}

/** Where to drop a bomb right now: your predicted spot plus a little scatter, or null. */
function lobTarget(s, t, T, player) {
  const p = predict(s, player, BOMB_FLIGHT * (T.lead || 0));
  const a = rand(s) * TAU;
  const r = Math.sqrt(rand(s)) * (T.scatter || 0);
  const x = Math.min(COLS - 0.5, Math.max(0.5, p.x + Math.cos(a) * r));
  const y = Math.min(ROWS - 0.5, Math.max(0.5, p.y + Math.sin(a) * r));
  return canLob(s, t, x, y) ? { x, y } : null;
}

/* ---------- Moving ---------- */

function fleeMines(s, t) {
  let fx = 0;
  let fy = 0;
  let near = false;
  for (const m of s.mines) {
    const dx = t.x - m.x;
    const dy = t.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d > BLAST_R + 0.9) continue;
    near = true;
    const w = (BLAST_R + 0.9 - d) / Math.max(d, 0.05);
    fx += d < 0.05 ? t.ai.hx : dx * w;
    fy += d < 0.05 ? t.ai.hy : dy * w;
  }
  return near ? bestOpenDirection(s, t, fx, fy) : null;
}

function dodgeShells(s, t, T) {
  if (!T.dodge) return null;
  const horizon = 0.35 + T.dodge * 0.9;
  let threat = null;
  for (const b of s.bullets) {
    if (b.owner === t.id && b.left === T.bounces) continue; // its own shell, still outbound
    if (!notices(b.id, t.id, T.dodge)) continue;
    const v2 = b.vx * b.vx + b.vy * b.vy;
    const rx = t.x - b.x;
    const ry = t.y - b.y;
    const tc = (rx * b.vx + ry * b.vy) / v2;
    if (tc < 0 || tc > horizon) continue;
    const px = b.x + b.vx * tc - t.x;
    const py = b.y + b.vy * tc - t.y;
    if (Math.hypot(px, py) > TANK_R + SHELL_R + 0.3) continue;
    const speed = Math.sqrt(v2);
    if (nextContact(s.grid, b.x, b.y, b.vx / speed, b.vy / speed, SHELL_R, speed * tc)) continue;
    if (!threat || tc < threat.tc) threat = { b, tc, px, py, speed };
  }
  if (!threat) return null;
  // Sidestep across the shell's line, toward the side the tank already leans to.
  let nx = -threat.b.vy / threat.speed;
  let ny = threat.b.vx / threat.speed;
  if (nx * -threat.px + ny * -threat.py < 0) {
    nx = -nx;
    ny = -ny;
  }
  if (!openAt(s.grid, t.x + nx * 0.75, t.y + ny * 0.75)) {
    nx = -nx;
    ny = -ny;
    if (!openAt(s.grid, t.x + nx * 0.75, t.y + ny * 0.75)) return null;
  }
  return { x: nx, y: ny };
}

/** The open neighbouring direction that best matches (fx, fy). */
function bestOpenDirection(s, t, fx, fy) {
  const len = Math.hypot(fx, fy) || 1;
  let best = null;
  let bestDot = -Infinity;
  for (const [dc, dr] of DIRS) {
    const l = Math.hypot(dc, dr);
    const ux = dc / l;
    const uy = dr / l;
    if (!openAt(s.grid, t.x + ux * 0.75, t.y + uy * 0.75)) continue;
    const dot = (ux * fx + uy * fy) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = { x: ux, y: uy };
    }
  }
  return best;
}

/**
 * Cells a mover may not pick, each with the tank in the way: where other tanks stand and
 * where other movers are heading. Claiming its next cell keeps two tanks from driving
 * into each other or both settling on the same spot.
 */
function takenCells(s, t) {
  const taken = new Map();
  for (const o of s.tanks) {
    if (o === t || !o.alive) continue;
    const at = cellOf(o.x, o.y);
    if (!taken.has(at)) taken.set(at, o);
    if (o.ai && TYPES[o.type].speed && o.ai.goal >= 0 && !taken.has(o.ai.goal)) taken.set(o.ai.goal, o);
  }
  return taken;
}

/** Whether another tank stands in cell n. */
function occupied(s, t, n) {
  for (const o of s.tanks) if (o !== t && o.alive && cellOf(o.x, o.y) === n) return true;
  return false;
}

/** Whether a mover is outside its preferred distance from you, so it has somewhere to be. */
function pressing(s, o) {
  const range = TYPES[o.type].range;
  if (!range) return false;
  const d = pathField(s)[cellOf(o.x, o.y)];
  return d >= 0 && (d < range[0] || d > range[1]);
}

/**
 * Right of way between two movers that want the same road: the one with somewhere to be
 * goes first; between two of a kind, the lower slot.
 */
function goesFirst(s, a, b) {
  const pa = pressing(s, a);
  const pb = pressing(s, b);
  return pa !== pb ? pa : a.slot < b.slot;
}

function chooseCell(s, t, T) {
  const ai = t.ai;
  const f = pathField(s);
  const hc = Math.floor(t.x);
  const hr = Math.floor(t.y);
  const here = hr * COLS + hc;
  const d0 = f[here];
  const [lo, hi] = T.range;
  const taken = takenCells(s, t);
  let away = ai.yieldT > 0 ? s.tanks.find((o) => o.id === ai.yieldTo && o.alive) : null;
  ai.hold = false;
  if (away) {
    const rx = t.x - away.x;
    const ry = t.y - away.y;
    if (rx * ai.yx + ry * ai.yy < -0.3 || Math.hypot(rx, ry) > 3) {
      // It has gone by, or gone elsewhere: back to business.
      ai.yieldT = 0;
      away = null;
    } else if (Math.abs(rx * ai.yy - ry * ai.yx) >= 0.8 && !taken.has(here)) {
      // Off its line already: wait here until it passes.
      ai.goal = here;
      ai.hold = true;
      ai.goalT = 0.25;
      return;
    }
  }
  // Sometimes hold position for a moment, like a tank sizing things up.
  if (!away && !taken.has(here) && d0 >= lo && d0 <= hi && rand(s) < 0.15) {
    ai.goal = here;
    ai.hold = true;
    ai.goalT = 0.4 + rand(s) * 0.5;
    return;
  }
  let best = here;
  let bestScore = -Infinity;
  let bestBase = -Infinity;
  let want = -1; // the cell it would pick if no tank were in the way
  let wantScore = -Infinity;
  for (const [dc, dr] of DIRS) {
    const c = hc + dc;
    const r = hr + dr;
    if (!open(s.grid, c, r)) continue;
    if (dc && dr && (!open(s.grid, hc + dc, hr) || !open(s.grid, hc, hr + dr))) continue;
    const n = r * COLS + c;
    if (n === ai.shun && ai.shunT > 0) continue;
    const l = Math.hypot(dc, dr);
    const cx = c + 0.5;
    const cy = r + 0.5;
    let score = rand(s);
    const dn = f[n];
    if (away) {
      // Giving way: step off the other tank's line of travel, or failing that keep ahead of it.
      const rx = cx - away.x;
      const ry = cy - away.y;
      score += Math.abs(rx * ai.yy - ry * ai.yx) * 2 + (rx * ai.yx + ry * ai.yy) * 0.8;
    } else if (d0 >= 0 && dn >= 0) {
      if (d0 > hi) score += (d0 - dn) * 1.6;
      else if (d0 < lo) score += (dn - d0) * 1.6;
    }
    score += ((dc * ai.hx + dr * ai.hy) / l) * 0.7;
    for (const m of s.mines) if ((cx - m.x) ** 2 + (cy - m.y) ** 2 < (BLAST_R + 0.8) ** 2) score -= 6;
    if (score > wantScore) {
      wantScore = score;
      want = n;
    }
    if (taken.has(n)) continue;
    const base = score;
    // Keep a little room from other tanks, but less than a step of progress is worth, so a
    // tank with somewhere to be still drives past another one.
    for (const o of s.tanks) {
      if (o !== t && o.alive && (cx - o.x) ** 2 + (cy - o.y) ** 2 < 1.2 * 1.2) score -= 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
      best = n;
    }
  }
  // Right of way: when a mover that should give way blocks the cell this one needs, and
  // the other ways are clearly worse, it is asked to make room.
  const blocker = taken.get(want);
  if (
    blocker &&
    !away &&
    d0 >= 0 &&
    (d0 < lo || d0 > hi) &&
    blocker.ai &&
    TYPES[blocker.type].speed &&
    !(blocker.ai.yieldT > 0) &&
    wantScore - bestBase > 1 &&
    goesFirst(s, t, blocker)
  ) {
    const wx = (want % COLS) + 0.5 - t.x;
    const wy = Math.floor(want / COLS) + 0.5 - t.y;
    const wl = Math.hypot(wx, wy) || 1;
    Object.assign(blocker.ai, { yieldT: YIELD_T, yieldTo: t.id, yx: wx / wl, yy: wy / wl, goal: -1 });
  }
  if (best !== here) {
    const dc = (best % COLS) - hc;
    const dr = Math.floor(best / COLS) - hr;
    const l = Math.hypot(dc, dr);
    ai.hx = dc / l;
    ai.hy = dr / l;
  }
  ai.goal = best;
  ai.goalT = 1.6;
}

/** Threats override the route: run from mines, sidestep shells. Checked on think ticks. */
function react(s, t, T) {
  const ai = t.ai;
  const away = fleeMines(s, t) || dodgeShells(s, t, T);
  if (!away) return;
  ai.mx = away.x;
  ai.my = away.y;
  ai.dodgeT = 0.3;
  ai.goal = -1;
}

/**
 * How far ahead to aim, given the distance ahead to the next cell's centre and how far off
 * its centre line the tank is: the whole way when nearly lined up, as far ahead as it is
 * off (a 45 degree approach) once it is off by enough to clip a corner.
 */
function lineUp(ahead, off) {
  const k = Math.min(1, Math.max(0, (off - ALIGN[0]) / (ALIGN[1] - ALIGN[0])));
  const w = k * k * (3 - 2 * k);
  return ahead * (1 - w) + Math.min(ahead, off) * w;
}

/** Drives toward the current goal cell's centre, picking the next cell on arrival. */
function steer(s, t, T) {
  const ai = t.ai;
  let gc = ai.goal % COLS;
  let gr = Math.floor(ai.goal / COLS);
  const here = cellOf(t.x, t.y);
  const arrived = !ai.hold && Math.hypot(gc + 0.5 - t.x, gr + 0.5 - t.y) < 0.2;
  if (
    ai.goal < 0 ||
    ai.goalT <= 0 ||
    arrived ||
    !open(s.grid, gc, gr) ||
    (ai.goal !== here && occupied(s, t, ai.goal))
  ) {
    chooseCell(s, t, T);
    gc = ai.goal % COLS;
    gr = Math.floor(ai.goal / COLS);
  }
  let tx = gc + 0.5;
  let ty = gr + 0.5;
  // Line up with a narrow way in before entering it, rather than clipping its corner: the
  // further off its centre line, the steeper it heads for the line first. The blend is
  // smooth, so the heading never flips back and forth across a threshold.
  const dc = gc - Math.floor(t.x);
  const dr = gr - Math.floor(t.y);
  if (dc && !dr) {
    const off = t.y - ty;
    if (off && !open(s.grid, gc, gr + Math.sign(off))) tx = t.x + dc * lineUp(Math.abs(tx - t.x), Math.abs(off));
  } else if (dr && !dc) {
    const off = t.x - tx;
    if (off && !open(s.grid, gc + Math.sign(off), gr)) ty = t.y + dr * lineUp(Math.abs(ty - t.y), Math.abs(off));
  }
  const dx = tx - t.x;
  const dy = ty - t.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.06) {
    ai.mx = 0;
    ai.my = 0;
  } else {
    ai.mx = dx / d;
    ai.my = dy / d;
  }
}

/**
 * A tank that keeps pushing without getting anywhere (into a corner it clips, or nose to
 * nose with another tank) gives up on that cell for a while, backs off a little and
 * chooses again, without the bonus for carrying on the way it was going.
 */
function checkStuck(s, t, T, dt) {
  const ai = t.ai;
  // Only pushing toward the same cell counts: turning back for another one is a choice.
  const trying = ai.dodgeT <= 0 && ai.backT <= 0 && ai.goal >= 0 && ai.goal === ai.sg && Math.hypot(t.vx, t.vy) > T.speed * 0.25;
  if (!trying) {
    ai.st = 0;
    ai.sx = t.x;
    ai.sy = t.y;
    ai.sg = ai.goal;
    return;
  }
  ai.st += dt;
  if (ai.st < STUCK_T) return;
  if (Math.hypot(t.x - ai.sx, t.y - ai.sy) < STUCK_D) {
    let bx = -Math.cos(t.body);
    let by = -Math.sin(t.body);
    if (ai.goal >= 0) {
      ai.shun = ai.goal;
      ai.shunT = SHUN_T;
      const gx = (ai.goal % COLS) + 0.5 - t.x;
      const gy = Math.floor(ai.goal / COLS) + 0.5 - t.y;
      const gl = Math.hypot(gx, gy);
      if (gl > 1e-6) {
        bx = -gx / gl;
        by = -gy / gl;
      }
    }
    ai.mx = bx;
    ai.my = by;
    ai.backT = BACK_T;
    ai.goal = -1;
    ai.hx = 0;
    ai.hy = 0;
  }
  ai.st = 0;
  ai.sx = t.x;
  ai.sy = t.y;
  ai.sg = ai.goal;
}

function wantsMine(s, t, T) {
  const ai = t.ai;
  ai.lay = 0.6 + rand(s) * 0.8;
  if (owned(s.mines, t) >= T.mines) return false;
  const f = pathField(s);
  const d = f[Math.floor(t.y) * COLS + Math.floor(t.x)];
  if (d < 2 || d > 9) return false;
  for (const o of s.tanks) {
    if (o !== t && o.alive && o.slot >= 0 && Math.hypot(o.x - t.x, o.y - t.y) < BLAST_R + 1.2) return false;
  }
  for (const m of s.mines) if (Math.hypot(m.x - t.x, m.y - t.y) < 2) return false;
  if (rand(s) > T.layRate) return false;
  ai.lay = 2.5 + rand(s) * 3;
  return true;
}

/**
 * One step of an enemy's brain. Turns the turret itself and returns the tank's intent:
 * { mx, my } (desired direction, world units), fire (angle or null), lob (a bomb's
 * landing spot { x, y } or null) and mine (boolean).
 */
export function updateBrain(s, t, dt) {
  const T = TYPES[t.type];
  const ai = t.ai;
  const player = s.tanks[0];
  ai.wait -= dt;
  ai.lay -= dt;
  ai.sweep -= dt;
  ai.goalT -= dt;
  ai.dodgeT -= dt;
  ai.think -= dt;
  ai.check -= dt;
  ai.shunT -= dt;
  ai.backT -= dt;
  ai.yieldT -= dt;

  const turn = T.turret * dt;
  const d = angleDiff(ai.aim, t.turret);
  t.turret = wrapAngle(t.turret + Math.max(-turn, Math.min(turn, d)));

  let mine = false;
  if (ai.think <= 0) {
    ai.think = T.think * (0.8 + 0.4 * rand(s));
    if (player.alive) {
      planAim(s, t, T, player);
      if (T.mines && ai.lay <= 0) mine = wantsMine(s, t, T);
    }
    if (T.speed) react(s, t, T);
  }
  if (T.speed) {
    if (ai.dodgeT <= 0 && ai.backT <= 0) steer(s, t, T);
    checkStuck(s, t, T, dt);
  }

  let fire = null;
  let lob = null;
  if (ai.check <= 0) {
    ai.check = 1 / 30;
    if (player.alive && t.reload <= 0 && ai.wait <= 0) {
      if (T.weapon === 'bomb') {
        // The tube turns to face where the bomb will go first: a tell you can watch for.
        if (ai.planned && owned(s.bombs, t) < T.bullets && Math.abs(angleDiff(ai.aim, t.turret)) < 0.3) {
          lob = lobTarget(s, t, T, player);
        }
      } else if (owned(s.bullets, t) < T.bullets && shotTarget(s, t, t.turret, T.bounces) === player) {
        fire = t.turret + (rand(s) - 0.5) * 2 * T.spread;
      }
    }
  }
  return { mx: T.speed ? ai.mx : 0, my: T.speed ? ai.my : 0, fire, lob, mine };
}
