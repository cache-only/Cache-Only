// Tanks simulation: world creation and the fixed step. Pure and DOM-free. The world is
// plain JSON (numbers, strings, arrays) so a mission in progress saves and resumes exactly.
import { initBrain, routeTo, updateBrain } from './ai.js';
import {
  BLAST_R,
  BOMB_FLIGHT,
  BOMB_R,
  CRATE,
  FLOOR,
  HIT_R,
  HOLE,
  LASER_BEAM,
  LASER_CHARGE,
  LASER_W,
  LOCK,
  MINE_FUSE,
  MINE_R,
  MINE_TRIGGER,
  MISSILE_FUEL,
  MISSILE_TURN,
  MUZZLE,
  POD,
  SCALES,
  SHELL_R,
  SPAWN_CODES,
  SPIN_DOWN,
  SPIN_UP,
  TANK_R,
  PAIR_GAP,
  TWIN_SPREAD,
  TYPES,
  VEL_SMOOTH,
  WALL,
  advance,
  angleDiff,
  beamLine,
  blocksTank,
  boxBlocked,
  cellAt,
  gridSize,
  isArenaLength,
  muzzleBlocked,
  nextContact,
  owned,
  segmentHit,
  sizeAt,
  wrapAngle,
} from './rules.js';

// 2: bullets carry `weapon` (and missiles `fuel`), the world has `bombs`, and the player
// tank carries a smoothed velocity (svx, svy) that the AI aims with. Minigun tanks also carry
// their barrels' spin (0-1) and whether they are driving them (rev); no world saved before
// them has one, so older saves stay valid.
export const WORLD_VERSION = 2;

/**
 * Parses a map into grid and spawns: ROWS strings of COLS characters for a mission, or any
 * arena of SCALES (rules.js) for a map of your own, such as 9 strings of 12.
 */
export function parseLevel(rows) {
  const scale = Array.isArray(rows) && rows.length % 3 === 0 ? rows.length / 3 : 0;
  if (!SCALES.includes(scale)) throw new Error(`A map needs ${SCALES.map((k) => k * 3).join(', ')} rows`);
  const [cols] = sizeAt(scale);
  const grid = new Array(rows.length * cols).fill(FLOOR);
  let player = null;
  const enemies = [];
  rows.forEach((line, r) => {
    if (line.length !== cols) throw new Error(`Row ${r} has ${line.length} cells, not ${cols}`);
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      const at = { x: c + 0.5, y: r + 0.5 };
      if (ch === '#') grid[r * cols + c] = WALL;
      else if (ch === 'x') grid[r * cols + c] = CRATE;
      else if (ch === 'o') grid[r * cols + c] = HOLE;
      else if (ch === '@') {
        if (player) throw new Error('Two player spawns');
        player = at;
      } else if (SPAWN_CODES[ch]) enemies.push({ type: SPAWN_CODES[ch], ...at });
      else if (ch !== '.') throw new Error(`Unknown map cell "${ch}"`);
    }
  });
  if (!player) throw new Error('No player spawn');
  if (!enemies.length) throw new Error('No enemies');
  return { grid, player, enemies };
}

function makeTank(s, type, x, y, body, turret, slot) {
  const t = { id: s.nextId++, type, slot, x, y, vx: 0, vy: 0, body, turret, alive: true, reload: 0, mineCool: 0 };
  if (TYPES[type].weapon === 'minigun') {
    t.spin = 0;
    t.rev = false;
  }
  return t;
}

/**
 * A fresh world for a level. `alive` lists the enemy slots still in play (a retry
 * after the player is destroyed keeps the enemies it already took out).
 */
export function createWorld(level, { seed = 1, alive = null } = {}) {
  const s = {
    v: WORLD_VERSION,
    phase: 'play',
    time: 0,
    seed: seed | 0,
    nextId: 1,
    gridVer: 0,
    grid: level.grid.slice(),
    tanks: [],
    bullets: [],
    bombs: [],
    mines: [],
    kills: {},
  };
  const p = level.player;
  const player = makeTank(s, 'player', p.x, p.y, 0, 0, -1);
  player.svx = 0;
  player.svy = 0;
  s.tanks.push(player);
  level.enemies.forEach((e, slot) => {
    if (alive && !alive.includes(slot)) return;
    const toward = Math.atan2(p.y - e.y, p.x - e.x);
    const t = makeTank(s, e.type, e.x, e.y, Math.abs(toward) > Math.PI / 2 ? Math.PI : 0, toward, slot);
    initBrain(s, t);
    s.tanks.push(t);
  });
  return s;
}

/** Enemy slots still alive, for a retry. */
export function survivors(s) {
  return s.tanks.filter((t) => t.slot >= 0 && t.alive).map((t) => t.slot);
}

/* ---------- Tanks ---------- */

/**
 * Turns the hull toward (mx, my) and drives. A tank is symmetric, so it backs up
 * rather than turning more than 90 degrees, and it only gets up to speed once it is
 * roughly lined up with where it wants to go.
 */
function drive(t, mx, my, dt) {
  const T = TYPES[t.type];
  const mag = Math.min(1, Math.hypot(mx, my));
  if (!T.speed || mag < 0.12) {
    t.vx = 0;
    t.vy = 0;
    return;
  }
  let d = angleDiff(Math.atan2(my, mx), t.body);
  let reverse = false;
  if (d > Math.PI / 2) {
    d -= Math.PI;
    reverse = true;
  } else if (d < -Math.PI / 2) {
    d += Math.PI;
    reverse = true;
  }
  const turn = T.turn * dt;
  const step = Math.max(-turn, Math.min(turn, d));
  t.body = wrapAngle(t.body + step);
  const lined = Math.max(0, Math.min(1, (Math.cos(d - step) - 0.35) / 0.65));
  const speed = T.speed * mag * lined;
  const heading = t.body + (reverse ? Math.PI : 0);
  t.vx = Math.cos(heading) * speed;
  t.vy = Math.sin(heading) * speed;
}

/** Pushes a tank out of walls, crates, holes and the arena edge. */
function collideWalls(grid, t) {
  const R = TANK_R;
  for (let iter = 0; iter < 3; iter++) {
    let pushed = false;
    for (let r = Math.floor(t.y - R); r <= Math.floor(t.y + R); r++) {
      for (let c = Math.floor(t.x - R); c <= Math.floor(t.x + R); c++) {
        if (!blocksTank(cellAt(grid, c, r))) continue;
        const px = Math.max(c, Math.min(c + 1, t.x));
        const py = Math.max(r, Math.min(r + 1, t.y));
        const dx = t.x - px;
        const dy = t.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          t.x += (dx / d) * (R - d);
          t.y += (dy / d) * (R - d);
        } else {
          // Centre inside the block: leave by the nearest side.
          const exits = [
            [t.x - c, -1, 0],
            [c + 1 - t.x, 1, 0],
            [t.y - r, 0, -1],
            [r + 1 - t.y, 0, 1],
          ].sort((a, b) => a[0] - b[0]);
          const [depth, ex, ey] = exits[0];
          t.x += ex * (depth + R);
          t.y += ey * (depth + R);
        }
        pushed = true;
      }
    }
    if (!pushed) return;
  }
}

function collideTanks(s) {
  const live = s.tanks.filter((t) => t.alive);
  const min = TANK_R * 2;
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      const push = min - d;
      if (d < 1e-6) {
        dx = 1;
        dy = 0;
        d = 1;
      }
      // Stationary tanks don't get shoved around.
      const ma = TYPES[a.type].speed ? 1 : 0;
      const mb = TYPES[b.type].speed ? 1 : 0;
      if (!ma && !mb) continue;
      const share = ma / (ma + mb);
      a.x -= (dx / d) * push * share;
      a.y -= (dy / d) * push * share;
      b.x += (dx / d) * push * (1 - share);
      b.y += (dy / d) * push * (1 - share);
    }
  }
  for (const t of live) collideWalls(s.grid, t);
}

function destroy(s, t, cause, events) {
  if (!t.alive) return;
  t.alive = false;
  t.vx = 0;
  t.vy = 0;
  if (t.slot >= 0) s.kills[t.type] = (s.kills[t.type] || 0) + 1;
  events.push({ type: 'destroyed', id: t.id, tank: t.type, x: t.x, y: t.y, cause });
}

/* ---------- Shells, missiles, bombs and mines ---------- */

/**
 * Fires a shell, rocket, missile or minigun round if reloaded and under the limit. A minigun
 * fires only with its barrels at full speed. A barrel buried in a wall fizzles. Bombs are
 * lobbed with lob() instead.
 */
export function fire(s, t, angle, events) {
  const T = TYPES[t.type];
  if (!t.alive || T.weapon === 'bomb' || t.reload > 0 || owned(s.bullets, t) >= T.bullets) return false;
  if (T.weapon === 'laser') return chargeLaser(s, t, angle, events);
  if (T.pair) return firePair(s, t, angle, events);
  if (T.weapon === 'minigun' && !(t.spin >= 1)) return false;
  t.reload = T.reload;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  // A missile tank fires from its two pods in turn, left first: the missile leaves from the
  // side of the turret it was launched on (side -1 left, 1 right, across the aim).
  const side = T.weapon === 'missile' ? (t.pod === -1 ? 1 : -1) : 0;
  if (side) t.pod = side;
  const x = t.x + ux * MUZZLE - uy * side * POD;
  const y = t.y + uy * MUZZLE + ux * side * POD;
  if (muzzleBlocked(s.grid, t.x, t.y, angle) || (side && boxBlocked(s.grid, x, y))) {
    events.push({ type: 'fizzle', id: t.id, x, y, side, player: t.slot < 0 });
    return true;
  }
  const b = { id: s.nextId++, owner: t.id, x, y, vx: ux * T.shot, vy: uy * T.shot, left: T.bounces, weapon: T.weapon };
  if (T.weapon === 'missile') b.fuel = T.fuel ?? MISSILE_FUEL;
  s.bullets.push(b);
  events.push({ type: 'shot', id: t.id, x, y, angle, side, weapon: T.weapon, player: t.slot < 0 });
  return true;
}

/**
 * A pair of missiles, one from each pod: the left one now, the right one PAIR_GAP later
 * (updateSalvos), each TWIN_SPREAD to its side of the aim at the moment it leaves, so they come
 * at you from two sides. It needs room in the air for both.
 */
function firePair(s, t, angle, events) {
  const T = TYPES[t.type];
  if (t.salvo || owned(s.bullets, t) + 2 > T.bullets) return false;
  t.reload = T.reload;
  // The two of a pair steer for the same target, so they close in on each other: they never
  // cancel each other out (pair), though anything else they meet still cancels them.
  const pair = s.nextId;
  podMissile(s, t, angle, -1, pair, events);
  t.salvo = { left: PAIR_GAP, pair };
  return true;
}

/** One missile of a pair from the pod on `side` (-1 left, 1 right), its own pod kicking back. */
function podMissile(s, t, angle, side, pair, events) {
  const T = TYPES[t.type];
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const x = t.x + ux * MUZZLE - uy * side * POD;
  const y = t.y + uy * MUZZLE + ux * side * POD;
  if (muzzleBlocked(s.grid, t.x, t.y, angle) || boxBlocked(s.grid, x, y)) {
    events.push({ type: 'fizzle', id: t.id, x, y, side, player: false });
    return;
  }
  const a = angle + side * TWIN_SPREAD;
  s.bullets.push({ id: s.nextId++, owner: t.id, x, y, vx: Math.cos(a) * T.shot, vy: Math.sin(a) * T.shot, left: T.bounces, weapon: T.weapon, fuel: T.fuel, turn: T.missileTurn, path: !!T.path, pair });
  events.push({ type: 'shot', id: t.id, x, y, angle: a, side, weapon: T.weapon, player: false });
}

/** The second missile of a pair leaves its right pod PAIR_GAP after the first, down the turret's aim then. */
function updateSalvos(s, dt, events) {
  for (const t of s.tanks) {
    if (!t.salvo) continue;
    if (!t.alive) {
      t.salvo = null;
      continue;
    }
    t.salvo.left -= dt;
    if (t.salvo.left > 1e-9) continue;
    podMissile(s, t, t.turret, 1, t.salvo.pair, events);
    t.salvo = null;
  }
}

/**
 * A laser locks its turret on `angle` and shows its red line for LASER_CHARGE seconds before it
 * burns down it (updateLasers). Its reload runs from the end of the beam.
 */
function chargeLaser(s, t, angle, events) {
  if (t.beam) return false;
  const T = TYPES[t.type];
  t.reload = LASER_CHARGE + LASER_BEAM + T.reload;
  const a = wrapAngle(angle);
  if (muzzleBlocked(s.grid, t.x, t.y, a)) {
    events.push({ type: 'fizzle', id: t.id, x: t.x + Math.cos(a) * MUZZLE, y: t.y + Math.sin(a) * MUZZLE, side: 0, player: t.slot < 0 });
    return true;
  }
  t.turret = a;
  t.beam = { phase: 'charge', left: LASER_CHARGE, angle: a };
  events.push({ type: 'charge', id: t.id, x: t.x, y: t.y, angle: a, dur: LASER_CHARGE });
  return true;
}

/**
 * Lasers: while one charges its turret holds still on its line; then it burns for LASER_BEAM
 * seconds, destroying every tank its line passes (its own excepted) and every shot that crosses
 * it, and setting off any mine on it. A tank with track turns its beam toward you as it burns,
 * at most track radians a second; without, the beam holds its line. A wall or crate stops it.
 */
function updateLasers(s, dt, events) {
  for (const t of s.tanks) {
    const b = t.beam;
    if (!b) continue;
    if (!t.alive) {
      t.beam = null;
      continue;
    }
    const T = TYPES[t.type];
    b.left -= dt;
    if (b.phase === 'charge') {
      t.turret = b.angle;
      if (b.left > 1e-9) continue;
      b.phase = 'fire';
      b.left += LASER_BEAM;
      events.push({ type: 'beam', id: t.id, x: t.x, y: t.y, angle: b.angle, dur: LASER_BEAM });
    }
    const p = s.tanks[0];
    if (T.track && p.alive) {
      const turn = T.track * dt;
      b.angle = wrapAngle(b.angle + Math.max(-turn, Math.min(turn, angleDiff(Math.atan2(p.y - t.y, p.x - t.x), b.angle))));
    }
    t.turret = b.angle;
    burn(s, t, b.angle, events);
    if (b.left <= 1e-9) {
      t.beam = null;
      events.push({ type: 'beamEnd', id: t.id });
    }
  }
}

/** One step of a laser's beam along its line: tanks, shots and mines on it. */
function burn(s, t, angle, events) {
  const { x0, y0, x1, y1 } = beamLine(s.grid, t.x, t.y, angle);
  for (const o of s.tanks) {
    if (o !== t && o.alive && segmentHit(x0, y0, x1, y1, o.x, o.y, HIT_R + LASER_W) >= 0) destroy(s, o, 'laser', events);
  }
  for (const b of s.bullets) {
    if (segmentHit(x0, y0, x1, y1, b.x, b.y, SHELL_R + LASER_W) < 0) continue;
    b.dead = true;
    events.push({ type: 'pop', x: b.x, y: b.y, weapon: b.weapon, cause: 'laser' });
  }
  s.bullets = s.bullets.filter((b) => !b.dead);
  for (const m of s.mines) if (segmentHit(x0, y0, x1, y1, m.x, m.y, MINE_R + LASER_W) >= 0) m.fuse = Math.min(m.fuse, 0);
}

/**
 * Lobs a bomb at (tx, ty). It flies over everything and lands BOMB_FLIGHT seconds later,
 * wherever that is. Nothing can shoot it down.
 */
export function lob(s, t, tx, ty, events) {
  const T = TYPES[t.type];
  if (!t.alive || T.weapon !== 'bomb' || t.reload > 0 || owned(s.bombs, t) >= T.bullets) return false;
  t.reload = T.reload;
  s.bombs.push({ id: s.nextId++, owner: t.id, x0: t.x, y0: t.y, tx, ty, t: 0, flight: BOMB_FLIGHT });
  events.push({ type: 'lob', id: t.id, x: t.x, y: t.y, tx, ty, flight: BOMB_FLIGHT });
  return true;
}

/**
 * Spins a minigun's barrels up toward full speed while it drives them (SPIN_UP seconds from
 * rest), or lets them run down (SPIN_DOWN seconds from full). They whine as they start up.
 */
function revBarrels(t, on, dt, events) {
  if (on && !t.rev && t.spin < 1) events.push({ type: 'spin', id: t.id, x: t.x, y: t.y, dur: (1 - t.spin) * SPIN_UP });
  t.rev = on;
  t.spin = on ? Math.min(1, t.spin + dt / SPIN_UP) : Math.max(0, t.spin - dt / SPIN_DOWN);
}

export function layMine(s, t, events) {
  const T = TYPES[t.type];
  if (!t.alive || !T.mines || t.mineCool > 0 || owned(s.mines, t) >= T.mines) return false;
  if (s.mines.some((m) => Math.hypot(m.x - t.x, m.y - t.y) < MINE_R * 2.5)) return false;
  t.mineCool = 0.4;
  s.mines.push({ id: s.nextId++, owner: t.id, x: t.x, y: t.y, fuse: MINE_FUSE, armed: false });
  events.push({ type: 'mine', x: t.x, y: t.y, player: t.slot < 0 });
  return true;
}

/**
 * A blast of radius r at (x, y), from a mine or a landing bomb: it destroys tanks and
 * shells, clears striped crates and sets off nearby mines. Walls never notice.
 */
function blast(s, x, y, r, cause, events) {
  events.push({ type: 'blast', x, y, r, cause });
  for (const t of s.tanks) {
    if (t.alive && Math.hypot(t.x - x, t.y - y) < r + HIT_R * 0.5) destroy(s, t, cause, events);
  }
  s.bullets = s.bullets.filter((b) => Math.hypot(b.x - x, b.y - y) >= r);
  const reach = r + 0.2;
  for (let row = Math.floor(y - reach); row <= Math.floor(y + reach); row++) {
    for (let c = Math.floor(x - reach); c <= Math.floor(x + reach); c++) {
      if (cellAt(s.grid, c, row) !== CRATE) continue;
      if (Math.hypot(c + 0.5 - x, row + 0.5 - y) >= reach) continue;
      s.grid[row * gridSize(s.grid)[0] + c] = FLOOR;
      s.gridVer++;
      events.push({ type: 'crate', c, r: row });
    }
  }
  // Neighbouring mines go off a beat later, so chains ripple.
  for (const o of s.mines) if (Math.hypot(o.x - x, o.y - y) < r) o.fuse = Math.min(o.fuse, 0.1);
}

function updateMines(s, dt, events) {
  for (const m of s.mines) {
    m.fuse -= dt;
    const owner = s.tanks.find((t) => t.id === m.owner);
    if (!m.armed && (!owner || !owner.alive || Math.hypot(owner.x - m.x, owner.y - m.y) > MINE_TRIGGER + 0.05)) {
      m.armed = true;
    }
    if (m.fuse <= 0.12) continue;
    for (const t of s.tanks) {
      if (!t.alive || (t.id === m.owner && !m.armed)) continue;
      if (Math.hypot(t.x - m.x, t.y - m.y) < MINE_TRIGGER) {
        m.fuse = 0.12;
        break;
      }
    }
  }
  for (let guard = 0; guard < 64; guard++) {
    const i = s.mines.findIndex((m) => m.fuse <= 0);
    if (i < 0) break;
    const [m] = s.mines.splice(i, 1);
    blast(s, m.x, m.y, BLAST_R, 'mine', events);
  }
}

/**
 * Turns a missile toward the player by at most MISSILE_TURN per second, while it has fuel
 * and the player is within LOCK of its nose. Once past you, it can't loop back.
 */
function steerMissile(s, b, dt) {
  if (!(b.fuel > 0)) return;
  b.fuel = Math.max(0, b.fuel - dt);
  const p = s.tanks[0];
  if (!p.alive) return;
  const heading = Math.atan2(b.vy, b.vx);
  // A missile that finds its way steers for the next turn of the open way to you, and keeps
  // after you wherever you are; a plain one only while you are within LOCK of its nose.
  const to = b.path ? waypoint(s, b, p) : p;
  const off = angleDiff(Math.atan2(to.y - b.y, to.x - b.x), heading);
  if (!b.path && Math.abs(off) > LOCK) return;
  const turn = (b.turn ?? MISSILE_TURN) * dt;
  const a = heading + Math.max(-turn, Math.min(turn, off));
  const speed = Math.hypot(b.vx, b.vy);
  b.vx = Math.cos(a) * speed;
  b.vy = Math.sin(a) * speed;
}

/**
 * Where a missile that finds its way heads: along the open way to you (routeTo), swerving round
 * anything else ahead of it, a tank or a mine, so it reaches you and nothing on the way.
 */
function waypoint(s, b, p) {
  const to = routeTo(s, b.x, b.y);
  let ax = to.x - b.x;
  let ay = to.y - b.y;
  const l = Math.hypot(ax, ay) || 1;
  ax /= l;
  ay /= l;
  const speed = Math.hypot(b.vx, b.vy) || 1;
  const hx = b.vx / speed;
  const hy = b.vy / speed;
  const swerve = (x, y, r) => {
    const rx = x - b.x;
    const ry = y - b.y;
    const along = rx * hx + ry * hy;
    const side = rx * -hy + ry * hx; // how far off its nose, left (-) or right (+)
    if (along <= 0 || along > 1.8 || Math.abs(side) > r) return;
    const k = 2.4 * (1 - Math.abs(side) / r) * (1 - along / 1.8);
    const away = side >= 0 ? -1 : 1;
    ax += -hy * away * k;
    ay += hx * away * k;
  };
  for (const o of s.tanks) if (o.alive && o !== p) swerve(o.x, o.y, HIT_R + SHELL_R + 0.35);
  for (const m of s.mines) swerve(m.x, m.y, MINE_R + SHELL_R + 0.3);
  return { x: b.x + ax, y: b.y + ay };
}

function updateBullets(s, dt, events) {
  for (const b of s.bullets) {
    if (b.weapon === 'missile') steerMissile(s, b, dt);
    advance(s.grid, b, Math.hypot(b.vx, b.vy) * dt, (q, hit) => {
      // The face it met, as the normal pointing out of it (both axes at a corner): the
      // velocity is already reflected, so it points the way the shell now leaves (the renderer
      // tells a glancing hit from a square one by it).
      const at = { x: q.x, y: q.y, nx: hit.x ? Math.sign(q.vx) : 0, ny: hit.y ? Math.sign(q.vy) : 0, vx: q.vx, vy: q.vy, weapon: q.weapon };
      if (q.left <= 0) {
        q.dead = true;
        events.push({ type: 'pop', ...at });
        return false;
      }
      q.left--;
      events.push({ type: 'bounce', ...at });
      return true;
    });
  }
  // Shells that meet cancel out: rockets, missiles and minigun rounds too.
  const live = s.bullets.filter((b) => !b.dead);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.dead || b.dead || (a.pair && a.pair === b.pair)) continue;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (SHELL_R * 2.6) ** 2) {
        a.dead = b.dead = true;
        events.push({ type: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
  }
  for (const b of live) {
    if (b.dead) continue;
    for (const t of s.tanks) {
      if (t.alive && (t.x - b.x) ** 2 + (t.y - b.y) ** 2 < (HIT_R + SHELL_R) ** 2) {
        b.dead = true;
        destroy(s, t, 'shell', events);
        break;
      }
    }
    if (b.dead) continue;
    for (const m of s.mines) {
      if ((m.x - b.x) ** 2 + (m.y - b.y) ** 2 < (MINE_R + SHELL_R) ** 2) {
        b.dead = true;
        m.fuse = 0;
        break;
      }
    }
  }
  s.bullets = s.bullets.filter((b) => !b.dead);
}

function updateBombs(s, dt, events) {
  if (!s.bombs.length) return;
  for (const b of s.bombs) b.t += dt;
  // A hair of slack so float drift never costs a bomb a step: it lands on its planned step.
  const landed = s.bombs.filter((b) => b.t >= b.flight - 1e-9);
  if (!landed.length) return;
  s.bombs = s.bombs.filter((b) => b.t < b.flight - 1e-9);
  for (const b of landed) blast(s, b.tx, b.ty, BOMB_R, 'bomb', events);
}

/* ---------- Step ---------- */

/**
 * Advances the world by dt (use STEP). input drives the player:
 * { mx, my } desired direction (length up to 1), aim (angle or null), fire, mine.
 * Returns the events that happened, for sound and effects.
 */
export function step(s, input, dt) {
  const events = [];
  if (s.phase !== 'play') return events;
  s.time += dt;

  const player = s.tanks[0];
  const px = player.x;
  const py = player.y;
  if (player.alive) {
    drive(player, input.mx || 0, input.my || 0, dt);
    if (input.aim != null) player.turret = wrapAngle(input.aim);
    if (input.fire) fire(s, player, player.turret, events);
    if (input.mine) layMine(s, player, events);
  }

  for (const t of s.tanks) {
    if (!t.alive || t.slot < 0) continue;
    const intent = updateBrain(s, t, dt);
    // A laser stands still while it charges and burns.
    if (t.beam) drive(t, 0, 0, dt);
    else drive(t, intent.mx, intent.my, dt);
    if (TYPES[t.type].weapon === 'minigun') revBarrels(t, intent.spin, dt, events);
    if (intent.fire != null) fire(s, t, intent.fire, events);
    if (intent.lob) lob(s, t, intent.lob.x, intent.lob.y, events);
    if (intent.mine) layMine(s, t, events);
  }

  for (const t of s.tanks) {
    if (!t.alive) continue;
    t.reload = Math.max(0, t.reload - dt);
    t.mineCool = Math.max(0, t.mineCool - dt);
    if (t.vx || t.vy) {
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      collideWalls(s.grid, t);
    }
  }
  collideTanks(s);

  // What the AI knows of your velocity: how you actually moved, averaged over a moment,
  // so a twitchy stick doesn't throw its aim and zig-zagging stays a real counter.
  if (player.alive) {
    const k = 1 - Math.exp(-dt / VEL_SMOOTH);
    player.svx += ((player.x - px) / dt - player.svx) * k;
    player.svy += ((player.y - py) / dt - player.svy) * k;
  }

  updateSalvos(s, dt, events);
  updateLasers(s, dt, events);
  updateBullets(s, dt, events);
  updateBombs(s, dt, events);
  updateMines(s, dt, events);

  const enemiesLeft = s.tanks.some((t) => t.slot >= 0 && t.alive);
  if (!enemiesLeft || !player.alive) {
    s.phase = enemiesLeft ? 'lost' : 'won';
    events.push({ type: s.phase });
    // The battle is decided: shells and bombs still in the air fizzle out rather than hang there.
    for (const b of s.bullets) events.push({ type: 'pop', x: b.x, y: b.y });
    for (const b of s.bombs) {
      const k = b.t / b.flight;
      events.push({ type: 'pop', x: b.x0 + (b.tx - b.x0) * k, y: b.y0 + (b.ty - b.y0) * k });
    }
    s.bullets = [];
    s.bombs = [];
    // A laser's beam stays as it was, so you see what hit you; nothing steps any more.
  }
  return events;
}

/** Light structural check for a world loaded from storage. */
export function isWorld(s) {
  return (
    !!s &&
    s.v === WORLD_VERSION &&
    s.phase === 'play' &&
    Array.isArray(s.grid) &&
    isArenaLength(s.grid.length) &&
    Array.isArray(s.tanks) &&
    s.tanks.length > 1 &&
    s.tanks[0].type === 'player' &&
    Number.isFinite(s.tanks[0].svx) &&
    Number.isFinite(s.tanks[0].svy) &&
    s.tanks.every(
      (t) =>
        TYPES[t.type] &&
        Number.isFinite(t.x) &&
        Number.isFinite(t.y) &&
        (t.slot < 0 || t.ai) &&
        (TYPES[t.type].weapon !== 'minigun' || Number.isFinite(t.spin)),
    ) &&
    Array.isArray(s.bullets) &&
    Array.isArray(s.bombs) &&
    Array.isArray(s.mines) &&
    Number.isFinite(s.seed) &&
    Number.isFinite(s.time)
  );
}
