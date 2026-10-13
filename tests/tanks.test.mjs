import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { intercept, predict } from '../src/games/tanks/ai.js';
import { MAX_ENEMIES, checkMap, isMirrored, openShare } from '../guide/mapcheck.mjs';
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

test('every mission map passes the map checks: well formed, winnable, no free shot at your start', () => {
  assert.equal(MISSIONS.length, 20);
  assert.deepEqual(CHECKPOINTS, [1, 6, 11, 16]);
  MISSIONS.forEach((rows, i) => {
    const others = MISSIONS.map((o, j) => ({ name: `mission ${j + 1}`, rows: o })).filter((_, j) => j !== i);
    const { errors, stats } = checkMap(rows, { others });
    assert.deepEqual(errors.map((e) => e.text), [], `mission ${i + 1}`);
    assert.ok(stats.enemies >= 1 && stats.enemies <= MAX_ENEMIES, `mission ${i + 1} enemy count`);
  });
});

test('the map checks catch an unreachable enemy, a free shot at your start and a copied layout', () => {
  const blank = Array.from({ length: ROWS }, () => '.'.repeat(COLS));
  const map = (edits) => blank.map((line, r) => (edits[r] ? edits[r].padEnd(COLS, '.') : line));
  // In plain sight down row 7: a free shot.
  const open = map({ 7: '..@..............b' });
  assert.match(checkMap(open).errors.map((e) => e.text).join(), /clear shot at your start/);
  // Behind a wall it's fine, and a mortar never counts: it lobs over everything.
  const covered = map({ 6: '.........#', 7: '..@......#.......b', 8: '.........#' });
  assert.deepEqual(checkMap(covered).errors, []);
  assert.deepEqual(checkMap(map({ 7: '..@..............d' })).errors, []);
  // Walled in on all sides with no line of sight: unreachable.
  const sealed = map({ 6: '...............###', 7: '..@............#b#', 8: '...............###' });
  assert.match(checkMap(sealed).errors.map((e) => e.text).join(), /can't be reached/);
  // Crates count as a way in: a mine clears them.
  const crated = map({ 6: '...............xxx', 7: '..@............xbx', 8: '...............xxx' });
  assert.deepEqual(checkMap(crated).errors, []);
  // The same blocks as another mission, even with the tanks moved.
  const twin = covered.map((line) => line.replace('b', '.')).map((line, r) => (r === 3 ? '.................b..' : line));
  assert.match(checkMap(twin, { others: [{ name: 'mission 1', rows: covered }] }).errors.map((e) => e.text).join(), /same blocks as mission 1/);
  // Nudges only: wide open and mirrored.
  const nudges = checkMap(covered).warnings.map((w) => w.text).join();
  assert.match(nudges, /open/);
  assert.match(nudges, /mirrored/);
  assert.equal(openShare(covered), (COLS * ROWS - 3) / (COLS * ROWS));
  assert.equal(isMirrored(covered), true);
});

test('every mission has a name and a one-line briefing in English and Catalan', async () => {
  const src = await readFile(new URL('../src/shared/i18n.js', import.meta.url), 'utf8');
  const en = src.slice(src.indexOf('  en: {'), src.indexOf('  ca: {'));
  const ca = src.slice(src.indexOf('  ca: {'));
  const keys = (block) => new Set([...block.matchAll(/'(tanks\.[\w.]+)':/g)].map((m) => m[1]));
  const [enKeys, caKeys] = [keys(en), keys(ca)];
  assert.deepEqual([...enKeys].filter((k) => !caKeys.has(k)), [], 'Tanks strings missing in Catalan');
  assert.deepEqual([...caKeys].filter((k) => !enKeys.has(k)), [], 'Tanks strings missing in English');
  for (let n = 1; n <= MISSIONS.length; n++) {
    for (const key of [`tanks.name.${n}`, `tanks.brief.${n}`]) assert.ok(enKeys.has(key), key);
  }
  for (const kind of ENEMY_KINDS) assert.ok(enKeys.has(`tanks.type.${kind}`), `name for ${kind}`);
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

/* ---------- R1: weapons ---------- */

test('every kind names its weapon, shots carry it, and nothing infers it from speed', async () => {
  for (const [kind, T] of Object.entries(TYPES)) assert.ok(WEAPONS.includes(T.weapon), `${kind} has a weapon`);
  for (const kind of ENEMY_KINDS) assert.ok(Object.values(SPAWN_CODES).includes(kind), `${kind} has a map letter`);
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@..........m'])));
  const events = [];
  assert.ok(fire(s, s.tanks[1], Math.PI, events));
  assert.equal(s.bullets[0].weapon, 'rocket');
  assert.equal(events[0].weapon, 'rocket');
  assert.equal('rocket' in s.bullets[0], false);
  const files = ['src/games/tanks/engine.js', 'src/games/tanks/render.js', 'src/games/tanks/art.js', 'src/games/tanks/audio.js', 'guide/page.html', 'guide/enemies.mjs'];
  for (const file of files) {
    const src = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /shot\s*>\s*6/, `${file} decides "rocket" by speed`);
  }
});

/* ---------- W1: guided missiles ---------- */

/** A missile owned by enemy slot 0 of world s. */
function missile(s, x, y, angle, fuel = 4) {
  const b = { id: 950 + s.bullets.length, owner: s.tanks[1].id, x, y, vx: Math.cos(angle) * TYPES.red.shot, vy: Math.sin(angle) * TYPES.red.shot, left: 0, weapon: 'missile', fuel };
  s.bullets.push(b);
  return b;
}

test('a missile turns toward you no faster than its limit, and only while you are in its lock cone', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@', '', '', '', '', '', '', '...................r'])));
  const p = s.tanks[0];
  const m = missile(s, 12, 3.5, Math.PI);
  let prev = Math.PI;
  let turned = 0;
  const events = [];
  for (let i = 0; i < 600 && s.phase === 'play'; i++) {
    events.push(...step(s, IDLE, STEP));
    if (!s.bullets.includes(m)) break;
    const heading = Math.atan2(m.vy, m.vx);
    const d = Math.abs(angleDiff(heading, prev));
    assert.ok(d <= MISSILE_TURN * STEP + 1e-9, `turned ${d} in one step`);
    turned += d;
    prev = heading;
  }
  assert.ok(turned > 0.2, 'it steered');
  assert.equal(p.alive, false, 'it found you');
  assert.ok(events.some((e) => e.type === 'destroyed' && e.tank === 'player' && e.cause === 'shell'));

  // Past you, it can't loop back: you are behind its nose, outside the lock cone.
  const w = inert(createWorld(level(['', '', '', '', '', '', '', '..@', '', '', '', '', '', '', '...................r'])));
  const away = missile(w, 8, 4, -0.3);
  assert.ok(Math.abs(angleDiff(Math.atan2(w.tanks[0].y - away.y, w.tanks[0].x - away.x), -0.3)) > LOCK);
  run(w, 0.5);
  assert.equal(Math.atan2(away.vy, away.vx), -0.3, 'no steering outside the cone');
});

test('a missile flies straight once its fuel runs out, and dies on the first wall', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@', '', '', '', '', '', '', '...................r'])));
  const m = missile(s, 13, 3.5, Math.PI, 0.25);
  run(s, 0.3);
  const heading = Math.atan2(m.vy, m.vx);
  assert.ok(Math.abs(angleDiff(heading, Math.PI)) > 0.1, 'it steered while it had fuel');
  run(s, 0.5);
  assert.equal(Math.atan2(m.vy, m.vx), heading, 'then straight');
  // No ricochet: the first wall ends it.
  const w = inert(createWorld(level(['', '', '', '', '', '', '', '..@', '', '', '', '', '', '', '...................r'])));
  missile(w, 10, 3, -Math.PI / 2, 0);
  const events = run(w, 3);
  assert.equal(count(events, 'bounce'), 0);
  assert.equal(count(events, 'pop'), 1);
  assert.equal(w.bullets.length, 0);
});

test('you can shoot a missile down', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@', '', '', '', '', '', '', '...................r'])));
  missile(s, 14, 7.5, Math.PI);
  const events = run(s, 0.05, { ...IDLE, aim: 0, fire: true }).concat(run(s, 3));
  assert.equal(count(events, 'clash'), 1);
  assert.equal(s.bullets.length, 0);
  assert.equal(s.tanks[0].alive, true);
});

test('a red tank fires missiles that follow you when you dodge sideways', () => {
  const s = createWorld(level(['', '', '', '', '', '', '', '..@..............r']), { seed: 4 });
  // Wait for its missile, then drive up out of the line it was fired on.
  let fired = false;
  const events = run(s, 12, (w) => {
    if (!fired && w.bullets.some((b) => b.weapon === 'missile')) fired = true;
    return fired ? { ...IDLE, my: -1 } : IDLE;
  });
  assert.ok(fired, 'it fired');
  assert.equal(s.phase, 'lost');
  assert.ok(events.some((e) => e.type === 'shot' && e.weapon === 'missile'));
});

/* ---------- W2: mortar bombs ---------- */

test('a bomb lands exactly where and when it was aimed, over walls and all', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '#########', '', '..@......#.....d', '', '#########'])));
  const mortar = s.tanks[1];
  const events = [];
  assert.ok(lob(s, mortar, 4.25, 3.75, events));
  assert.equal(lob(s, mortar, 4, 4, events), false, 'one bomb at a time, then the reload');
  assert.equal(events[0].type, 'lob');
  let landed = null;
  for (let i = 0; i < 400 && !landed; i++) {
    const ev = step(s, IDLE, STEP);
    landed = ev.find((e) => e.type === 'blast') || null;
    if (landed) landed.time = s.time;
  }
  assert.ok(landed, 'it landed');
  assert.equal(landed.cause, 'bomb');
  assert.equal(landed.r, BOMB_R);
  assert.deepEqual([landed.x, landed.y], [4.25, 3.75]);
  assert.ok(Math.abs(landed.time - BOMB_FLIGHT) < STEP / 2, `landed at ${landed.time}`);
  assert.equal(s.bombs.length, 0);
});

test('a landing bomb destroys tanks, shells and crates within its radius, and sets off mines', () => {
  // Stationary targets, so nothing drives out of the blast.
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@....#.bb.b...d', '.........x', '', '..........x'])));
  const [, near, far, out] = s.tanks;
  s.bullets.push({ id: 990, owner: s.tanks[0].id, x: 9.9, y: 6.8, vx: 0, vy: 0.01, left: 1, weapon: 'shell' });
  s.mines.push({ id: 991, owner: s.tanks[0].id, x: 9, y: 6.7, fuse: 9, armed: true });
  const events = [];
  lob(s, s.tanks.at(-1), 9.5, 7.5, events);
  events.push(...run(s, BOMB_FLIGHT + 0.05));
  assert.equal(near.alive, false, 'a tank 1 cell away is destroyed');
  assert.equal(far.alive, false, 'and one at the edge of the blast');
  assert.equal(out.alive, true, 'one 3 cells away survives');
  assert.ok(Math.hypot(far.x - 9.5, far.y - 7.5) < BOMB_R + HIT_R * 0.5);
  assert.equal(s.bullets.length, 0, 'shells in the blast are gone');
  assert.equal(cellAt(s.grid, 9, 8), FLOOR, 'a crate in reach is cleared');
  assert.equal(cellAt(s.grid, 10, 10), CRATE, 'one further away is not');
  assert.equal(cellAt(s.grid, 7, 7), WALL, 'walls never notice');
  run(s, 0.2);
  assert.equal(s.mines.length, 0, 'a mine in the blast goes off a beat later');
  assert.equal(count(events, 'blast'), 1);
});

test('a mortar never aims inside its minimum range or near an ally, and bombs you over a wall', () => {
  // Too close: no bombs at all.
  const close = createWorld(level(['', '', '', '', '', '', '', '...........@.d']), { seed: 2 });
  assert.ok(Math.hypot(close.tanks[0].x - close.tanks[1].x, close.tanks[0].y - close.tanks[1].y) < BOMB_MIN);
  assert.equal(count(run(close, 10), 'lob'), 0);

  // An ally beside you: no bombs either.
  const ally = createWorld(level(['', '', '', '', '', '', '', '..@b.........d']), { seed: 2 });
  ally.tanks[1].ai.wait = Infinity;
  assert.equal(count(run(ally, 10), 'lob'), 0);

  // In range behind a wall: it lobs over it and you are destroyed.
  const over = createWorld(level(['', '', '', '', '', '......#', '......#', '..@...#......d', '......#', '......#']), { seed: 2 });
  const events = run(over, 12);
  assert.ok(count(events, 'lob') >= 1);
  assert.equal(over.phase, 'lost');
  assert.ok(events.some((e) => e.type === 'destroyed' && e.tank === 'player' && e.cause === 'bomb'));
  for (const e of events.filter((q) => q.type === 'lob')) {
    assert.ok(Math.hypot(e.tx - e.x, e.ty - e.y) >= BOMB_MIN, 'never inside the minimum range');
  }
});

test('a world with missiles and bombs in the air resumes exactly (plain JSON, deterministic)', () => {
  const lv = level(['', '', '...#', '...#........r', '...#', '', '', '..@.........d', '', '', '...#', '...#........r', '...#']);
  const script = (s, i) => ({ mx: Math.sin(i / 60), my: Math.cos(i / 90), aim: i / 30, fire: i % 50 === 0, mine: false });
  const a = createWorld(lv, { seed: 9 });
  let i = 0;
  while (i < 120 * 1.5) step(a, script(a, i++), STEP);
  const [player, red, mortar] = a.tanks;
  red.reload = mortar.reload = 0;
  assert.ok(fire(a, red, Math.atan2(player.y - red.y, player.x - red.x), []));
  assert.ok(lob(a, mortar, player.x, player.y, []));
  for (let k = 0; k < 30; k++) step(a, script(a, i++), STEP);
  assert.ok(a.bombs.length && a.bullets.some((b) => b.weapon === 'missile'), 'a bomb and a missile are in the air');
  const b = JSON.parse(JSON.stringify(a));
  assert.ok(isWorld(b));
  for (let k = 0; k < 120 * 4; k++) {
    step(a, script(a, i + k), STEP);
    step(b, script(b, i + k), STEP);
  }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

/* ---------- A1: no jamming ---------- */

test('two tanks heading opposite ways pass each other in a corridor', () => {
  const walls = '#'.repeat(COLS);
  // A two-wide corridor with you at its left end. Black wants to close in to 2-6 cells,
  // teal to back off to 7-12: neither is happy until they have passed each other.
  assert.ok(TYPES.black.range[1] < TYPES.marine.range[0]);
  for (const seed of [1, 2, 3]) {
    const lanes = ['@..m................', '..................k.'];
    const s = inert(createWorld(level([walls, walls, walls, walls, walls, walls, ...lanes, walls, walls, walls, walls, walls, walls, walls]), { seed }));
    const black = s.tanks.find((t) => t.type === 'black');
    const teal = s.tanks.find((t) => t.type === 'marine');
    let passed = null;
    for (let i = 0; i < 120 * 12 && passed == null; i++) {
      step(s, IDLE, STEP);
      if (black.x < teal.x - 0.5) passed = s.time;
    }
    assert.ok(passed != null && passed < 10, `seed ${seed}: they passed after ${passed} s`);
  }
});

test('a tank pushing into a wall without getting anywhere gives up that cell and backs off', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.......a#..'])));
  const t = s.tanks[1];
  // Point it at a cell beyond the wall, which it can only push against.
  const goal = 7 * COLS + 12;
  Object.assign(t.ai, { goal, goalT: 30, hold: false, hx: 1, hy: 0 });
  t.ai.think = Infinity; // no new plans in the way of this one
  let backed = false;
  for (let i = 0; i < 120 * 2 && !backed; i++) {
    step(s, IDLE, STEP);
    backed = t.ai.backT > 0;
  }
  assert.ok(backed, 'it backed off');
  assert.equal(t.ai.shun, goal);
  assert.ok(t.ai.shunT > 1.5);
  assert.equal(t.ai.hx, 0, 'no bonus for carrying on the way it was going');
  run(s, 1);
  assert.notEqual(t.ai.goal, goal);
});

test('no enemy that wants to move stays pinned in one spot for more than 1.5 s', () => {
  for (const [i, map] of MISSIONS.entries()) {
    for (const seed of [1, 2, 3]) {
      const s = inert(createWorld(parseLevel(map), { seed }));
      const pin = new Map();
      // You drive a slow loop so the enemies keep re-planning.
      for (let k = 0; k < 120 * 20 && s.phase === 'play'; k++) {
        step(s, { ...IDLE, mx: Math.sin(k / 240), my: Math.cos(k / 170) }, STEP);
        for (const t of s.tanks) {
          if (t.slot < 0 || !t.alive || !TYPES[t.type].speed) continue;
          const wants = Math.hypot(t.ai.mx, t.ai.my) >= 0.12;
          const at = pin.get(t.id);
          if (!wants || !at || Math.hypot(t.x - at.x, t.y - at.y) > 0.2) pin.set(t.id, { x: t.x, y: t.y, since: s.time });
          else assert.ok(s.time - at.since <= 1.5, `mission ${i + 1} seed ${seed}: ${t.type} pinned at ${at.x.toFixed(2)},${at.y.toFixed(2)}`);
        }
      }
    }
  }
});

/* ---------- A2: leading shots ---------- */

test('the AI reads your velocity smoothed, and predicts you stop at walls', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.....#......a'])));
  const p = s.tanks[0];
  run(s, 1, { ...IDLE, mx: 1 });
  assert.ok(Math.abs(p.svx - TYPES.player.speed) < 0.03 && Math.abs(p.svy) < 1e-6, `svx ${p.svx}`);
  // One twitch of the stick barely moves the estimate.
  step(s, { ...IDLE, my: 1 }, STEP);
  assert.ok(Math.abs(p.svy) < 0.2);
  // Heading for the wall at column 8: the prediction stops at it.
  const q = predict(s, p, 5);
  assert.ok(q.x > p.x && q.x <= 8 - (TANK_R - 0.06) + 1e-9, `predicted x ${q.x}`);
  assert.ok(Math.abs(q.y - p.y) < 0.05);
});

test('a shot aimed at the exact intercept hits a target moving in a straight line; turning makes it miss', () => {
  for (const turn of [false, true]) {
    const s = inert(createWorld(level(['', '', '', '', '', '', '', '', '', '', '', '', '..@..........m'])));
    const [p, tank] = s.tanks;
    run(s, 1.2, { ...IDLE, my: -1 }); // get up to speed, heading up
    const time = intercept(tank, p, TYPES.marine.shot, 1);
    const at = predict(s, p, time);
    const events = [];
    fire(s, tank, Math.atan2(at.y - tank.y, at.x - tank.x), events);
    assert.equal(count(events, 'shot'), 1);
    events.push(...run(s, 3, { ...IDLE, my: turn ? 1 : -1 }));
    assert.equal(p.alive, turn, turn ? 'turning back made it miss' : 'driving straight on was fatal');
  }
});

test('tanks that lead aim ahead of you; the early ones aim straight at you', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '', '', '', '', '', '..@..........m', '', '.............a'])));
  const [p, teal, grey] = s.tanks;
  run(s, 2, { ...IDLE, my: -1 });
  const ahead = (t) => angleDiff(t.ai.aim, Math.atan2(p.y - t.y, p.x - t.x));
  assert.ok(TYPES.marine.lead > 0 && !TYPES.ash.lead);
  // You are moving up the screen (toward -y), to the left of both tanks: leading means aiming clockwise.
  assert.ok(ahead(teal) > 0.05, `teal aims ${ahead(teal)} ahead`);
  assert.ok(Math.abs(ahead(grey)) < 0.02, `grey aims ${ahead(grey)} off`);
});

/* ---------- R3: the colour plan ---------- */

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const linear = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (h) => hexRgb(h).map(linear).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Perceptual distance between two colours (OKLab, x100). About 10 is "clearly different". */
function distance(a, b) {
  const lab = (h) => {
    const [r, g, bl] = hexRgb(h).map(linear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const [x, y] = [lab(a), lab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

test('every kind has its own colour, clear of the off-limits ones, that chip text reads on', async () => {
  const css = await readFile(new URL('../src/games/tanks/styles.css', import.meta.url), 'utf8');
  const block = (opener) => {
    const at = css.indexOf(opener);
    return css.slice(at, css.indexOf('}', at + opener.length));
  };
  const colours = (text) => Object.fromEntries([...text.matchAll(/--tk-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = colours(block('.page-tanks {'));
  const dark = { ...light, ...colours(block('@media (prefers-color-scheme: dark)')) };
  const kinds = Object.keys(TYPES);
  const ink = { dark: '#16181d', light: '#faf8f2' }; // the field guide's chip text colours
  for (const [mode, set] of [['light', light], ['dark', dark]]) {
    for (const k of kinds) assert.match(set[k] || '', /^#[0-9a-f]{6}$/, `--tk-${k} (${mode})`);
    for (let i = 0; i < kinds.length; i++) {
      for (let j = i + 1; j < kinds.length; j++) {
        const d = distance(set[kinds[i]], set[kinds[j]]);
        assert.ok(d >= 10, `${mode}: ${kinds[i]} and ${kinds[j]} are too alike (${d.toFixed(1)})`);
      }
    }
    for (const k of kinds) {
      // The guide picks the chip text from the light colour and uses it in both modes.
      const text = contrast(light[k], ink.dark) >= contrast(light[k], ink.light) ? ink.dark : ink.light;
      assert.ok(contrast(set[k], text) >= 4.5, `${mode}: chip text on ${k} is ${contrast(set[k], text).toFixed(2)}:1`);
      if (k === 'player') continue;
      // Off limits: your blue, fire orange and crate yellow (the yellow tank was there first).
      for (const [name, c] of [['player', light.player], ['fire', light.fire], ['crate', light.crate]]) {
        if (name === 'crate' && k === 'yellow') continue;
        assert.ok(distance(set[k], c) >= 10, `${mode}: ${k} is too close to the ${name} colour`);
      }
    }
  }
});
