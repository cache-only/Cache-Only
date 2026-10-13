import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { intercept, pathField, predict } from '../src/games/tanks/ai.js';
import { createWorld, fire, isWorld, lob, parseLevel, step, survivors } from '../src/games/tanks/engine.js';
import { CHECKPOINTS, MISSIONS } from '../src/games/tanks/missions.js';
import {
  BLAST_R,
  BOMB_FLIGHT,
  BOMB_MIN,
  BOMB_R,
  COLS,
  CRATE,
  ENEMY_KINDS,
  FLOOR,
  HIT_R,
  LOCK,
  MINE_FUSE,
  MISSILE_TURN,
  MUZZLE,
  ROWS,
  SHELL_R,
  SPAWN_CODES,
  STEP,
  TANK_R,
  TYPES,
  WALL,
  WEAPONS,
  angleDiff,
  blocksShell,
  blocksTank,
  boxBlocked,
  cellAt,
  tracePath,
} from '../src/games/tanks/rules.js';

const IDLE = { mx: 0, my: 0, aim: null, fire: false, mine: false };

/** A level from a few rows of map text; missing rows and cells are floor. */
function level(rows) {
  const full = [];
  for (let r = 0; r < ROWS; r++) full.push((rows[r] || '').padEnd(COLS, '.'));
  return parseLevel(full);
}

/** Enemies that never shoot or lay mines, so a test controls everything. */
function inert(s) {
  for (const t of s.tanks) if (t.ai) t.ai.wait = t.ai.lay = Infinity;
  return s;
}

function run(s, seconds, input = IDLE) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / STEP) && s.phase === 'play'; i++) {
    events.push(...step(s, typeof input === 'function' ? input(s, i) : input, STEP));
  }
  return events;
}

const count = (events, type) => events.filter((e) => e.type === type).length;

function overlapsBlock(grid, t) {
  for (let r = Math.floor(t.y - TANK_R); r <= Math.floor(t.y + TANK_R); r++) {
    for (let c = Math.floor(t.x - TANK_R); c <= Math.floor(t.x + TANK_R); c++) {
      if (!blocksTank(cellAt(grid, c, r))) continue;
      const px = Math.max(c, Math.min(c + 1, t.x));
      const py = Math.max(r, Math.min(r + 1, t.y));
      if (Math.hypot(t.x - px, t.y - py) < TANK_R - 1e-6) return true;
    }
  }
  return false;
}

test('every mission map is well formed and winnable in principle', () => {
  assert.equal(MISSIONS.length, 20);
  assert.deepEqual(CHECKPOINTS, [1, 6, 11, 16]);
  for (const [i, map] of MISSIONS.entries()) {
    const lv = parseLevel(map);
    assert.ok(lv.enemies.length >= 1 && lv.enemies.length <= 8, `mission ${i + 1} enemy count`);
    // Cells the player can reach; crates count as open because a mine clears them.
    const passable = (c, r) => [FLOOR, CRATE].includes(cellAt(lv.grid, c, r));
    const seen = new Set();
    const queue = [[Math.floor(lv.player.x), Math.floor(lv.player.y)]];
    seen.add(queue[0].join());
    while (queue.length) {
      const [c, r] = queue.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${c + dc},${r + dr}`;
        if (!seen.has(key) && passable(c + dc, r + dr)) {
          seen.add(key);
          queue.push([c + dc, r + dr]);
        }
      }
    }
    for (const e of lv.enemies) {
      const ec = Math.floor(e.x);
      const er = Math.floor(e.y);
      const reachable = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => seen.has(`${ec + dc},${er + dr}`));
      // Or a clear straight shot from some reachable cell (shells fly over holes).
      const visible = [...seen].some((key) => {
        const [c, r] = key.split(',').map(Number);
        const pts = tracePath(lv.grid.map((v) => (v === CRATE ? FLOOR : v)), c + 0.5, r + 0.5, Math.atan2(e.y - r - 0.5, e.x - c - 0.5), 0);
        return Math.hypot(pts[2] - c - 0.5, pts[3] - r - 0.5) >= Math.hypot(e.x - c - 0.5, e.y - r - 0.5) - 0.5;
      });
      assert.ok(reachable || visible, `mission ${i + 1}: ${e.type} at ${ec},${er} can't be reached`);
    }
  }
});

test('a shell ricochets once, then dies on the next wall; a rocket dies on the first', () => {
  const s = inert(createWorld(level(['.........b'.padEnd(COLS, '.'), '', '', '', '', '', '', '..@'])));
  let events = run(s, 0.05, { ...IDLE, aim: 0.3, fire: true });
  events = events.concat(run(s, 8));
  assert.equal(count(events, 'shot'), 1);
  assert.equal(count(events, 'bounce'), 1);
  assert.equal(count(events, 'pop'), 1);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.tanks[1].alive, true);

  // Rockets have no ricochet.
  const r = inert(createWorld(level(['', '', '', '', '', '', '', '..@..............m'])));
  r.tanks[0].type = 'player';
  r.bullets.push({ id: 999, owner: r.tanks[1].id, x: 10, y: 3.5, vx: 0, vy: -8, left: TYPES.marine.bounces, weapon: 'rocket' });
  const ev = run(r, 2);
  assert.equal(count(ev, 'bounce'), 0);
  assert.equal(count(ev, 'pop'), 1);
});

test('a bank shot off a wall destroys a tank around a corner', () => {
  const s = inert(createWorld(level(['', '..b', '', '', '.####', '', '', '..@'])));
  const p = s.tanks[0];
  const e = s.tanks[1];
  // Mirror the target in the right-hand wall face, where the shell centre turns.
  const mirrorX = 2 * (COLS - SHELL_R) - e.x;
  const angle = Math.atan2(e.y - p.y, mirrorX - p.x);
  const events = run(s, 0.05, { ...IDLE, aim: angle, fire: true }).concat(run(s, 10));
  assert.equal(count(events, 'bounce'), 1);
  assert.equal(e.alive, false);
  assert.equal(s.phase, 'won');
  assert.deepEqual(s.kills, { brown: 1 });
});

test('your own shell can destroy you after its ricochet', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '', '', '..@'])));
  run(s, 0.05, { ...IDLE, aim: 0, fire: true });
  run(s, 12);
  assert.equal(s.tanks[0].alive, false);
  assert.equal(s.phase, 'lost');
  assert.deepEqual(survivors(s), [0]);
});

test('shells that meet cancel each other out', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '', '', '', '', '', '', '', '', '@'])));
  s.bullets.push({ id: 900, owner: 0, x: 4, y: 7.5, vx: 4.6, vy: 0, left: 1 });
  s.bullets.push({ id: 901, owner: 0, x: 16, y: 7.5, vx: -4.6, vy: 0, left: 1 });
  const events = run(s, 2);
  assert.equal(count(events, 'clash'), 1);
  assert.equal(s.bullets.length, 0);
});

test('five shells and two mines at most; a barrel inside a wall fizzles', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '', '', '..@#'])));
  // Fire upward-left at a long angle so the shells stay in flight.
  let events = [];
  for (let i = 0; i < 8; i++) events = events.concat(run(s, 0.15, { ...IDLE, aim: -2.2, fire: true }));
  assert.equal(count(events, 'shot'), 5);
  assert.equal(s.bullets.length, 5);

  const w = inert(createWorld(level(['.........b', '', '', '', '', '', '', '..@#'])));
  const ev = run(w, 0.05, { ...IDLE, aim: 0, fire: true });
  assert.equal(count(ev, 'fizzle'), 1);
  assert.equal(w.bullets.length, 0);

  const m = inert(createWorld(level(['.........b', '', '', '', '', '', '', '.....@'])));
  let laid = 0;
  for (let i = 0; i < 4; i++) {
    laid += count(run(m, 0.05, { ...IDLE, mine: true }), 'mine');
    run(m, 0.5, { ...IDLE, mx: -1 });
  }
  assert.equal(laid, 2);
  assert.equal(m.mines.length, 2);
});

test('a mine waits for its owner to leave, then clears nearby crates and spares walls', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '', '.....#', '.....@xx'])));
  run(s, 0.05, { ...IDLE, mine: true });
  assert.equal(s.mines.length, 1);
  run(s, 2); // sitting on it is safe
  assert.equal(s.mines.length, 1);
  assert.equal(s.tanks[0].alive, true);
  run(s, 2.5, { ...IDLE, mx: -1 }); // drive away to the left
  const events = run(s, MINE_FUSE);
  assert.equal(count(events, 'blast'), 1);
  assert.equal(s.tanks[0].alive, true);
  assert.equal(cellAt(s.grid, 6, 7), FLOOR, 'adjacent crate cleared');
  assert.equal(cellAt(s.grid, 7, 7), CRATE, 'crate two cells away survives');
  assert.equal(cellAt(s.grid, 5, 6), WALL, 'walls are indestructible');
  assert.equal(s.gridVer, 1);
});

test('driving back over your armed mine sets it off', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '', '', '.....@'])));
  run(s, 0.05, { ...IDLE, mine: true });
  run(s, 1.5, { ...IDLE, mx: -1 });
  const events = run(s, 3, { ...IDLE, mx: 1 });
  assert.equal(count(events, 'blast'), 1);
  assert.equal(s.tanks[0].alive, false);
  assert.equal(s.phase, 'lost');
});

test('blasts chain to nearby mines, and a shell sets a mine off', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '', '', '', '', '', '', '', '', '', '@'])));
  s.mines.push({ id: 800, owner: 0, x: 8, y: 7, fuse: 0.05, armed: true });
  s.mines.push({ id: 801, owner: 0, x: 8 + BLAST_R - 0.2, y: 7, fuse: 9, armed: true });
  s.mines.push({ id: 802, owner: 0, x: 15, y: 7, fuse: 9, armed: true });
  const events = run(s, 0.5);
  assert.equal(count(events, 'blast'), 2);
  assert.deepEqual(s.mines.map((m) => m.id), [802]);

  s.bullets.push({ id: 900, owner: 0, x: 12, y: 7, vx: 4.6, vy: 0, left: 1 });
  assert.equal(count(run(s, 1.5), 'blast'), 1);
  assert.equal(s.mines.length, 0);
});

test('tanks never drive into walls, crates or holes; shells fly over holes', () => {
  const s = inert(createWorld(level(['.........b', '', '', '', '', '...ooo', '...o#x', '...x@o', '...ooo'])));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (const [mx, my] of dirs) {
    for (let i = 0; i < 120; i++) {
      step(s, { ...IDLE, mx, my }, STEP);
      assert.ok(!overlapsBlock(s.grid, s.tanks[0]), `overlap moving ${mx},${my}`);
    }
  }
  const p = s.tanks[0];
  assert.ok(Math.abs(p.x - 4.5) < 0.2 && Math.abs(p.y - 7.5) < 0.2, 'boxed in, the tank stays put');

  const h = inert(createWorld(level(['.........b', '', '', '', '', '', '', '..@.oooo'])));
  const events = run(h, 0.05, { ...IDLE, aim: 0, fire: true }).concat(run(h, 5));
  assert.equal(count(events, 'bounce'), 1, 'the first contact is the far wall, not the hole');
});

test('a fired shell follows exactly the path tracePath predicts', () => {
  const s = inert(createWorld(level(['.........b', '', '...##', '', '..x', '', '', '..@', '', '.....#'])));
  const angle = -0.9;
  const p = s.tanks[0];
  run(s, 0.02, { ...IDLE, aim: angle, fire: true });
  const pts = tracePath(s.grid, p.x + Math.cos(angle) * MUZZLE, p.y + Math.sin(angle) * MUZZLE, angle, 1);
  const onPath = (x, y) => {
    let best = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, ay, bx, by] = pts.slice(i, i + 4);
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
      best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
    }
    return best;
  };
  let samples = 0;
  for (let i = 0; i < 1200 && s.bullets.length; i++) {
    step(s, IDLE, STEP);
    for (const b of s.bullets) {
      assert.ok(onPath(b.x, b.y) < 1e-6, `shell off its predicted path at ${b.x},${b.y}`);
      assert.ok(!boxBlocked(s.grid, b.x, b.y, SHELL_R - 1e-6), 'shell inside a wall');
      samples++;
    }
  }
  assert.ok(samples > 100);
});

test('a retry keeps the enemies already destroyed out of the mission', () => {
  const lv = parseLevel(MISSIONS[19]);
  const s = createWorld(lv, { alive: [1, 4] });
  assert.deepEqual(s.tanks.filter((t) => t.slot >= 0).map((t) => t.slot), [1, 4]);
  assert.deepEqual(survivors(s), [1, 4]);
});

test('a saved world resumes exactly where it was (plain JSON, deterministic)', () => {
  const lv = parseLevel(MISSIONS[8]);
  const script = (s, i) => ({ mx: Math.sin(i / 50), my: Math.cos(i / 70), aim: i / 40, fire: i % 45 === 0, mine: i === 30 });
  const a = createWorld(lv, { seed: 42 });
  run(a, 1, script);
  assert.equal(a.phase, 'play');
  const b = JSON.parse(JSON.stringify(a));
  assert.ok(isWorld(b));
  for (let i = 0; i < 120 * 8; i++) {
    step(a, script(a, i), STEP);
    step(b, script(b, i), STEP);
  }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('enemy AI runs every mission without leaving the open floor', () => {
  for (const [i, map] of MISSIONS.entries()) {
    for (const seed of [1, 2, 3]) {
      const s = createWorld(parseLevel(map), { seed });
      // Keep the player alive so the AI keeps working for the whole run.
      s.tanks[0].x = -100;
      for (let k = 0; k < 120 * 20; k++) {
        step(s, IDLE, STEP);
        if (s.phase !== 'play') break;
        for (const t of s.tanks) {
          if (t.slot < 0) continue;
          assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.turret), `mission ${i + 1}: NaN`);
          assert.ok(!overlapsBlock(s.grid, t), `mission ${i + 1}: ${t.type} inside a block`);
        }
        for (const b of s.bullets) assert.ok(!blocksShell(cellAt(s.grid, Math.floor(b.x), Math.floor(b.y))), `mission ${i + 1}: shell in a wall`);
      }
    }
  }
});

test('enemies shoot a player in their line of fire, even round a wall by ricochet', () => {
  // An ash tank with a clear line kills an idle player within a few seconds.
  const s = createWorld(level(['', '', '', '', '', '', '', '..@...........a']), { seed: 3 });
  run(s, 15);
  assert.equal(s.phase, 'lost');
  // A green tank banks a rocket around a wall it can't see past.
  const g = createWorld(level(['', '', '', '', '', '.......#', '.......#', '..@....#.......g', '.......#', '.......#']), { seed: 5 });
  const events = run(g, 15);
  assert.ok(count(events, 'bounce') >= 1);
  assert.equal(g.phase, 'lost');
});
