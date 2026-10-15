import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { intercept, pathField, predict, shotTarget, tapTarget } from '../src/games/tanks/ai.js';
import { VARIANTS, recoilAt } from '../src/games/tanks/art.js';
import { makeBot } from '../scripts/playtest.mjs';
import { MAX_ENEMIES, checkMap, isMirrored, openShare } from '../src/games/tanks/mapcheck.js';
import { createWorld, fire, isWorld, lob, parseLevel, step, survivors } from '../src/games/tanks/engine.js';
import { CHECKPOINTS, MISSIONS, TEST_MAX, testMap } from '../src/games/tanks/missions.js';
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
  LASER_BEAM,
  LASER_CHARGE,
  LOCK,
  MINE_FUSE,
  MISSILE_TURN,
  MUZZLE,
  POD,
  ROWS,
  SHELL_R,
  SPAWN_CODES,
  SPIN_DOWN,
  SPIN_UP,
  SPRAY_TURN,
  STEP,
  TANK_R,
  TWIN_SPREAD,
  TYPES,
  WALL,
  WEAPONS,
  angleDiff,
  beamLine,
  blocksShell,
  blocksTank,
  boxBlocked,
  cellAt,
  nextContact,
  segmentHit,
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
  const twin = covered.map((line) => line.replace('b', '.')).map((line, r) => (r === 3 ? '.................b'.padEnd(COLS, '.') : line));
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

test('a gun recoils fast, runs out slower, and is back at rest well within a second', () => {
  for (const weapon of ['shell', 'rocket', 'missile', 'minigun', 'bomb']) {
    assert.deepEqual([recoilAt(weapon, Infinity).slide, recoilAt(weapon, Infinity).jolt], [0, 0], `${weapon} at rest`);
    assert.equal(recoilAt(weapon, -0.1).slide, 0, `${weapon} before it fires`);
    const at = (s) => recoilAt(weapon, s);
    // Back fast: the spring (and a gun's slide) is at its peak within 40 ms.
    const first = Array.from({ length: 21 }, (_, i) => at(i * 0.002));
    assert.ok(Math.max(...first.map((r) => r.jolt)) >= 0.99, `${weapon} jolts at once`);
    if (weapon !== 'bomb') assert.ok(at(0.04).slide >= 0.99 || weapon === 'minigun', `${weapon} slides back at once`);
    // Out slower, never jumping forward: the slide only shrinks once it starts back.
    let last = 1;
    let low = 0;
    for (let s = 0.04; s < 1; s += 0.005) {
      const r = at(s);
      if (weapon !== 'minigun') assert.ok(r.slide <= last + 1e-9, `${weapon} slides out smoothly at ${s.toFixed(3)} s`);
      last = r.slide;
      low = Math.min(low, r.jolt);
    }
    assert.ok(low < 0 && low > -0.2, `${weapon}'s spring runs a little past rest (${low.toFixed(3)})`);
    const done = at(0.9);
    assert.deepEqual([done.slide, done.jolt], [0, 0], `${weapon} at rest by 0.9 s`);
  }
  // Big enough to see: still more than half way back 100 ms after a shell leaves.
  assert.ok(recoilAt('shell', 0.1).slide > 0.5);
});

test('wall contacts name the face they met, and shots the tank that fired them', () => {
  // Up and a little right: off the top edge, then down to die on the bottom one.
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@', '', '', '', '', '', '', '.................b'])));
  const events = run(s, 0.05, { ...IDLE, aim: -Math.PI / 2 + 0.3, fire: true }).concat(run(s, 8));
  const shot = events.find((e) => e.type === 'shot');
  assert.equal(shot.id, s.tanks[0].id);
  const bounce = events.find((e) => e.type === 'bounce');
  assert.deepEqual([bounce.nx, bounce.ny, bounce.weapon], [0, 1, 'shell']);
  assert.ok(Math.abs(bounce.y - SHELL_R) < 1e-6, 'the shell touches the face');
  const pop = events.find((e) => e.type === 'pop');
  assert.deepEqual([pop.nx, pop.ny], [0, -1]);
  assert.ok(Math.abs(pop.y - (ROWS - SHELL_R)) < 1e-6);

  // A barrel buried in a wall fizzles, and a mortar's lob says whose it is too.
  const f = inert(createWorld(level(['', '', '', '', '', '', '', '..@#', '', '', '', '', '', '', '.................b'])));
  const fizzle = run(f, 0.05, { ...IDLE, aim: 0, fire: true }).find((e) => e.type === 'fizzle');
  assert.equal(fizzle.id, f.tanks[0].id);
  const olive = Object.keys(SPAWN_CODES).find((ch) => SPAWN_CODES[ch] === 'olive');
  const m = inert(createWorld(level(['', '', '', '', '', '', '', `..@...............${olive}`])));
  const lobs = [];
  assert.ok(lob(m, m.tanks[1], 10, 7.5, lobs));
  assert.equal(lobs[0].id, m.tanks[1].id);
});

test('a bank shot off a wall destroys a tank around a corner', () => {
  const s = inert(createWorld(level(['', '..b', '', '', '.####', '', '', '..@'])));
  const p = s.tanks[0];
  const e = s.tanks[1];
  // Mirror the target in the right-hand wall face, where the shell centre turns.
  const mirrorX = 2 * (COLS - SHELL_R) - e.x;
  const angle = Math.atan2(e.y - p.y, mirrorX - p.x);
  const events = run(s, 0.05, { ...IDLE, aim: angle, fire: true }).concat(run(s, 14));
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

test('a night version is its day kind made stronger: same weapon and aim, never worse on any number', () => {
  const nights = Object.keys(TYPES).filter((k) => TYPES[k].night);
  assert.deepEqual(nights.sort(), ['indigoNight', 'limeNight', 'pinkNight', 'redNight', 'yellowNight']);
  for (const [k, t] of Object.entries(TYPES)) {
    assert.equal(t.upgrade ?? t.twin, undefined, `${k}: kinds stand alone, with no lines`);
    if (!t.night) {
      assert.equal(t.base, undefined, `${k} names a base but isn't a night version`);
      continue;
    }
    const day = TYPES[t.base];
    assert.ok(day && !day.night, `${k} is the night version of a day kind`);
    assert.equal(k, `${t.base}Night`);
    assert.ok(ENEMY_KINDS.includes(k), `${k} can be picked on the test range`);
    // Its map letter is the day kind's in upper case.
    const letter = (kind) => Object.keys(SPAWN_CODES).find((ch) => SPAWN_CODES[ch] === kind);
    assert.equal(letter(k), letter(t.base).toUpperCase());
    assert.equal(t.weapon, day.weapon);
    assert.equal(t.aim, day.aim);
    for (const stat of ['speed', 'turn', 'turret', 'shot', 'bounces', 'bullets', 'mines', 'dodge', 'lead', 'track', 'missileTurn', 'fuel', 'walk']) {
      assert.ok((t[stat] ?? 0) >= (day[stat] ?? 0), `${k} ${stat} ${t[stat]} is below ${t.base}'s ${day[stat]}`);
    }
    for (const stat of ['reload', 'think', 'react', 'spread']) {
      assert.ok(t[stat] <= day[stat], `${k} ${stat} ${t[stat]} is slower or looser than ${t.base}'s ${day[stat]}`);
    }
  }
  // Night Pink and Night Yellow play exactly as Violet and Hornet did, so the missions keep their balance.
  assert.equal(TYPES.pinkNight.bullets, 5);
  assert.equal(TYPES.yellowNight.trap, true);
  assert.equal(TYPES.yellowNight.layRate, undefined, 'Night Yellow lays by plan, not by chance');
});

test('Pink fires its shells spaced out and leads you, rather than in a burst of three', () => {
  assert.ok(TYPES.pink.reload >= 0.5, `reload ${TYPES.pink.reload}`);
  assert.ok(TYPES.pink.lead > 0);
});

test('Yellow and Night Yellow lay mines: Yellow 2 now and then, Night Yellow 4 by plan and far more often', () => {
  assert.deepEqual(ENEMY_KINDS.filter((kind) => TYPES[kind].mines > 0), ['yellow', 'yellowNight']);
  assert.equal(TYPES.yellow.mines, 2);
  assert.equal(TYPES.yellowNight.mines, 4);
  // Three of a kind on the test range against the casual playtest bot, nobody firing.
  const laid = (kind) => {
    let n = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const s = createWorld(parseLevel(testMap(kind, 3)), { seed });
      for (const t of s.tanks) if (t.ai) t.ai.wait = Infinity;
      const bot = makeBot({ casual: true, seed });
      n += run(s, 30, (w) => ({ ...bot(w), fire: false, mine: false })).filter((e) => e.type === 'mine' && !e.player).length;
    }
    return n;
  };
  const yellow = laid('yellow');
  const night = laid('yellowNight');
  assert.ok(night >= yellow * 1.5, `night yellow ${night}, yellow ${yellow}`);
});

test('a Night Yellow mines your way to it, watches each mine from no nearer you, and never blows itself up', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const s = createWorld(parseLevel(testMap('yellowNight', 3)), { seed });
    for (const t of s.tanks) if (t.ai) t.ai.wait = Infinity;
    const bot = makeBot({ casual: true, seed });
    let laid = 0;
    for (let i = 0; i < Math.round(40 / STEP) && s.phase === 'play'; i++) {
      const events = step(s, { ...bot(s), fire: false, mine: false }, STEP);
      for (const e of events) {
        assert.ok(!(e.type === 'destroyed' && e.tank === 'yellowNight'), `seed ${seed}: a Night Yellow blew up at ${s.time.toFixed(1)} s`);
        if (e.type !== 'mine' || e.player) continue;
        laid++;
        // The one that laid it is off to watch it from a cell at least as far from you.
        const layer = s.tanks.find((t) => t.alive && t.type === 'yellowNight' && Math.hypot(t.x - e.x, t.y - e.y) < 0.1);
        if (!layer || layer.ai.wc < 0) continue;
        const f = pathField(s);
        assert.ok(f[layer.ai.wc] >= f[Math.floor(e.y) * COLS + Math.floor(e.x)], `seed ${seed}: watches from nearer you than its mine`);
      }
    }
    assert.ok(laid >= 3, `seed ${seed}: ${laid} mines`);
  }
});

test('a Night Yellow shoots a mine you are beside, but never one whose blast would catch an ally', () => {
  const trial = (rows, mine, setup = () => {}) => {
    const s = createWorld(level(rows), { seed: 3 });
    for (const t of s.tanks) if (t.ai) t.ai.lay = Infinity;
    const brown = s.tanks.find((t) => t.type === 'brown');
    if (brown) brown.ai.wait = Infinity;
    const layer = s.tanks.find((t) => t.type === 'yellowNight');
    s.mines.push({ id: 900, owner: layer.id, armed: true, fuse: 9, ...mine });
    setup(s);
    return run(s, 6).find((e) => e.type === 'destroyed');
  };
  // You sit a cell from a mine it can see, off its line to you: it fires into the mine.
  const beside = trial({ 3: '..........#', 4: '..........#', 7: '..@...............Y', 9: '..........#' }, { x: 2.9, y: 6.2 });
  assert.equal(beside?.tank, 'player');
  assert.equal(beside.cause, 'mine');
  // A mine it can't see is left alone.
  const walled = { 5: '..........#', 6: '..........#', 7: '..@.......#.......Y', 8: '..........#', 9: '..........#' };
  assert.equal(trial(walled, { x: 2.9, y: 6.4 }), undefined);
  // An ally two cells from the mine: it shoots at you instead.
  const ally = trial({ 4: '...b', 7: '..@...............Y' }, { x: 2.9, y: 6.4 });
  assert.equal(ally?.tank, 'player');
  assert.equal(ally.cause, 'shell');
});

test('no enemy fires through a mine whose blast would reach an ally or itself', () => {
  // A Grey in a pocket, a mine at its mouth on the line to you: it holds fire.
  const rows = { 6: '.............####', 7: '..@...........a.#', 8: '.............####' };
  const s = createWorld(level(rows), { seed: 1 });
  s.mines.push({ id: 900, owner: 0, armed: true, fuse: 60, x: 12.6, y: 7.5 });
  assert.equal(count(run(s, 6), 'shot'), 0);
  assert.equal(s.mines.length, 1);
  // The same line with the mine beside you instead: a shot down it counts as a hit on you.
  const t = createWorld(level(rows), { seed: 1 });
  const grey = t.tanks[1];
  t.mines.push({ id: 900, owner: 0, armed: true, fuse: 60, x: 12.6, y: 7.5 });
  assert.notEqual(shotTarget(t, grey, Math.PI, 1), t.tanks[0]);
  t.mines[0].x = 3.6;
  assert.equal(shotTarget(t, grey, Math.PI, 1), t.tanks[0]);
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
  const events = run(h, 0.05, { ...IDLE, aim: 0, fire: true }).concat(run(h, 7));
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

test('a tap aims at the nearest enemy in sight within 6.5 cells, passing over one behind a wall', () => {
  const kinds = (rows) => {
    const t = tapTarget(createWorld(level(rows)));
    return t && t.type;
  };
  // Brown is nearest but behind a wall; ash is in the open, 4 cells away.
  assert.equal(kinds(['', '', '', '', '..b', '..#', '', '..@...a']), 'ash');
  // A crate hides it just the same; a hole doesn't (shells fly over holes).
  assert.equal(kinds(['', '', '', '', '..b', '..x', '', '..@...a']), 'ash');
  assert.equal(kinds(['', '', '', '', '..b', '..o', '', '..@...a']), 'brown');
  // 6 cells away is in range and 7 is not; across a diagonal, 6.3 is and 6.7 is not.
  assert.equal(kinds(['', '', '', '', '', '', '', '..@.....a']), 'ash');
  assert.equal(kinds(['', '', '', '', '', '', '', '..@......a']), null);
  assert.equal(kinds(['', '', '', '', '', '........a', '', '..@']), 'ash');
  assert.equal(kinds(['', '', '', '', '........a', '', '', '..@']), null);
  // With the near one hidden and the far one out of range, nothing is picked.
  assert.equal(kinds(['', '', '', '', '..b', '..#', '', '..@......a']), null);
  // An invisible tank is never picked, even in the open right next to you.
  assert.equal(kinds(['', '', '', '', '', '', '...w', '..@...a']), 'ash');
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
  // Compare with the heading it started on, not with -0.3: atan2(sin, cos) doesn't round-trip
  // exactly on every platform (it is off in the last bit on GitHub's Linux runners).
  const start = Math.atan2(away.vy, away.vx);
  run(w, 0.5);
  assert.equal(Math.atan2(away.vy, away.vx), start, 'no steering outside the cone');
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

test('a missile tank fires from its two pods in turn, left first, each missile leaving its own pod', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.......r'])));
  const red = s.tanks[1];
  const shots = [];
  for (let i = 0; i < 3; i++) {
    const events = [];
    red.reload = 0;
    s.bullets.length = 0;
    assert.ok(fire(s, red, Math.PI, events));
    shots.push(events.find((e) => e.type === 'shot'));
  }
  assert.deepEqual(shots.map((e) => e.side), [-1, 1, -1]);
  // Facing left across the screen, its left is down the screen (+y): the pod a cell-tenth off its aim.
  assert.ok(Math.abs(shots[0].y - red.y - POD) < 1e-9 && Math.abs(shots[1].y - red.y + POD) < 1e-9);
  assert.ok(Math.abs(shots[0].x - (red.x - MUZZLE)) < 1e-9);
  // Other weapons fire down the middle.
  const grey = inert(createWorld(level(['', '', '', '', '', '', '', '..@.......a'])));
  const events = [];
  fire(grey, grey.tanks[1], Math.PI, events);
  assert.equal(events[0].side, 0);
  assert.equal(events[0].y, grey.tanks[1].y);
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

/* ---------- W3: the minigun ---------- */

test('a minigun spins up for SPIN_UP s before its first round, then sprays round after round', () => {
  const s = createWorld(level(['', '', '', '', '', '', '', '..@.........l']), { seed: 7 });
  const lime = s.tanks[1];
  assert.equal(lime.spin, 0);
  let whine = null;
  let first = null;
  const shots = [];
  for (let i = 0; i < 120 * 6 && s.phase === 'play'; i++) {
    for (const e of step(s, IDLE, STEP)) {
      if (e.type === 'spin' && !whine) whine = { ...e, time: s.time };
      if (e.type !== 'shot') continue;
      shots.push(e);
      first ??= s.time;
    }
  }
  assert.ok(whine, 'its barrels whine as they start');
  assert.ok(Math.abs(whine.dur - SPIN_UP) < 1e-9, 'for the whole spin-up from rest');
  // The barrels started on the step before the whine's event time; the first round needs them at full speed.
  assert.ok(first - whine.time >= SPIN_UP - 2 * STEP, `first round ${(first - whine.time).toFixed(3)} s after the barrels started`);
  assert.ok(first - whine.time < SPIN_UP + 0.2);
  assert.ok(shots.length >= 5, `${shots.length} rounds`);
  assert.ok(shots.every((e) => e.weapon === 'minigun'));
  assert.equal(s.phase, 'lost');
});

test('fire() refuses a minigun whose barrels are not at full speed', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.........l'])));
  const lime = s.tanks[1];
  lime.spin = 0.99;
  assert.equal(fire(s, lime, Math.PI, []), false);
  lime.spin = 1;
  assert.ok(fire(s, lime, Math.PI, []));
  assert.equal(s.bullets[0].weapon, 'minigun');
  assert.equal(s.bullets[0].left, 0);
});

test('minigun rounds cancel out with shells and with each other, and die on the first wall', () => {
  const at = (rows) => inert(createWorld(level(rows)));
  // A round and your shell head-on: both gone.
  const s = at(['.........l', '', '', '', '', '', '', '', '', '', '', '', '', '@']);
  s.bullets.push({ id: 900, owner: s.tanks[1].id, x: 4, y: 7.5, vx: 6.4, vy: 0, left: 0, weapon: 'minigun' });
  s.bullets.push({ id: 901, owner: s.tanks[0].id, x: 8, y: 7.5, vx: -4.6, vy: 0, left: 1, weapon: 'shell' });
  assert.equal(count(run(s, 1), 'clash'), 1);
  assert.equal(s.bullets.length, 0);
  // Two rounds crossing: both gone.
  const r = at(['.........l', '', '', '', '', '', '', '', '', '', '', '', '', '@']);
  r.bullets.push({ id: 900, owner: r.tanks[1].id, x: 4, y: 7.5, vx: 6.4, vy: 0, left: 0, weapon: 'minigun' });
  r.bullets.push({ id: 902, owner: r.tanks[1].id, x: 6.5, y: 5, vx: 0, vy: 6.4, left: 0, weapon: 'minigun' });
  assert.equal(count(run(r, 1), 'clash'), 1);
  assert.equal(r.bullets.length, 0);
  // Alone, a round dies on the first wall it meets, with no ricochet.
  const w = at(['.........l', '', '', '', '', '', '', '', '', '', '', '', '', '@']);
  w.bullets.push({ id: 900, owner: w.tanks[1].id, x: 6, y: 5.5, vx: 0, vy: 6.4, left: 0, weapon: 'minigun' });
  const events = run(w, 3);
  assert.equal(count(events, 'bounce'), 0);
  assert.equal(count(events, 'pop'), 1);
  assert.equal(w.bullets.length, 0);
});

test('a minigun sprays round its line, and its turret drags while the barrels spin', () => {
  const s = createWorld(level(['', '', '', '', '', '', '', '..@.........l']), { seed: 3 });
  const lime = s.tanks[1];
  const angles = [];
  let prev = lime.turret;
  let fastest = 0;
  run(s, 6, (w) => {
    if (lime.spin >= 1) fastest = Math.max(fastest, Math.abs(angleDiff(lime.turret, prev)));
    prev = lime.turret;
    // Strafe up and down so the turret has to keep turning.
    return { ...IDLE, my: Math.sin(w.time * 3) };
  }).forEach((e) => {
    if (e.type === 'shot') angles.push(angleDiff(e.angle, Math.PI));
  });
  assert.ok(fastest > 0 && fastest <= SPRAY_TURN * STEP + 1e-9, `turret turned ${fastest} in a step at full spin`);
  assert.ok(angles.length >= 5);
  // Not every round on one line: the spread shows.
  assert.ok(new Set(angles.map((a) => a.toFixed(3))).size > angles.length / 2);
});

test("a minigun's barrels run down over SPIN_DOWN s once it stops driving them", () => {
  // inert: it never wants to fire, so it never drives its barrels.
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.........l'])));
  const lime = s.tanks[1];
  Object.assign(lime, { spin: 1, rev: true });
  run(s, 0.5);
  assert.equal(lime.rev, false);
  assert.ok(Math.abs(lime.spin - (1 - 0.5 / SPIN_DOWN)) < 1e-6, `spin ${lime.spin}`);
  run(s, SPIN_DOWN);
  assert.equal(lime.spin, 0);
});

test('a world with a minigun spinning resumes exactly (plain JSON, deterministic)', () => {
  const lv = level(['', '', '', '', '...........l', '', '', '..@', '', '', '...........l']);
  const script = (s, i) => ({ mx: Math.sin(i / 60), my: Math.cos(i / 90), aim: i / 30, fire: i % 50 === 0, mine: false });
  const a = createWorld(lv, { seed: 5 });
  let i = 0;
  while (i < 120 * 8 && a.phase === 'play' && !a.tanks.some((t) => t.spin > 0 && t.spin < 1)) step(a, script(a, i++), STEP);
  assert.ok(a.tanks.some((t) => t.spin > 0), 'a minigun is spinning');
  const b = JSON.parse(JSON.stringify(a));
  assert.ok(isWorld(b));
  const broken = JSON.parse(JSON.stringify(b));
  delete broken.tanks[1].spin;
  assert.equal(isWorld(broken), false, 'a minigun without its spin is not a world');
  for (let k = 0; k < 120 * 4; k++) {
    step(a, script(a, i + k), STEP);
    step(b, script(b, i + k), STEP);
  }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

/* ---------- Dodging ---------- */

test('beside walls a tank dodges a shell it notices without swinging back and forth, and nearly always lives', () => {
  // Black on open cells beside a wall in two missions, a shell coming at it from five directions.
  let noticed = 0;
  let died = 0;
  let swung = 0;
  for (const mi of [0, 2]) {
    const clean = MISSIONS[mi].map((line) => line.replace(/[^#xo]/g, '.'));
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const wall = (dc, dr) => !'.'.includes((clean[r + dr] || '')[c + dc] ?? '#');
        if (clean[r][c] !== '.' || (c + r) % 3 || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => wall(dc, dr))) continue;
        for (const [angle, off] of [[0, 0.1], [Math.PI / 2, -0.1], [Math.PI, 0.15], [-Math.PI / 2, 0.05], [Math.PI / 4, 0.1]]) {
          const map = clean.map((line, rr) => (rr === r ? `${line.slice(0, c)}k${line.slice(c + 1)}` : line));
          const far = map.findIndex((line, rr) => Math.abs(rr - r) > 6);
          map[far] = `@${map[far].slice(1)}`;
          if (clean[far][0] !== '.') continue;
          const s = inert(createWorld(parseLevel(map), { seed: 1 }));
          const k = s.tanks[1];
          const x = k.x - Math.cos(angle) * 4 - Math.sin(angle) * off;
          const y = k.y - Math.sin(angle) * 4 + Math.cos(angle) * off;
          if (cellAt(s.grid, Math.floor(x), Math.floor(y)) !== FLOOR) continue;
          if (nextContact(s.grid, x, y, Math.cos(angle), Math.sin(angle), SHELL_R, 3.6)) continue;
          s.bullets.push({ id: 901, owner: s.tanks[0].id, x, y, vx: Math.cos(angle) * 4.6, vy: Math.sin(angle) * 4.6, left: 0, weapon: 'shell' });
          let dodged = false;
          let swings = 0;
          let prev = null;
          for (let i = 0; i < Math.round(1.4 / STEP) && k.alive && s.phase === 'play'; i++) {
            step(s, IDLE, STEP);
            if (k.ai.dodgeT > 0) dodged = true;
            if (i % 15) continue;
            const v = Math.hypot(k.vx, k.vy);
            if (prev && prev.v > 0.3 && v > 0.3 && (prev.vx * k.vx + prev.vy * k.vy) / (prev.v * v) < -0.7) swings++;
            prev = { vx: k.vx, vy: k.vy, v };
          }
          if (!dodged) continue;
          noticed++;
          if (!k.alive) died++;
          if (swings) swung++;
        }
      }
    }
  }
  assert.ok(noticed >= 100, `${noticed} dodges`);
  assert.ok(died <= noticed * 0.02, `died in ${died} of ${noticed}`);
  // The old sidestep swung back across the line in about a third of these.
  assert.ok(swung <= noticed * 0.15, `swung back and forth in ${swung} of ${noticed}`);
});

/* ---------- N2, N3: Night Red and Night Lime ---------- */

test('Night Red fires a pair, one missile from each pod, 10 degrees either side of its aim, when both fit in the air', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.........R'])));
  const red = s.tanks[1];
  const events = [];
  assert.ok(fire(s, red, Math.PI, events));
  const shots = events.filter((e) => e.type === 'shot');
  assert.equal(shots.length, 2);
  assert.equal(s.bullets.length, 2);
  const angles = s.bullets.map((b) => angleDiff(Math.atan2(b.vy, b.vx), Math.PI)).sort((x, y) => x - y);
  assert.ok(Math.abs(angles[0] + TWIN_SPREAD) < 1e-9 && Math.abs(angles[1] - TWIN_SPREAD) < 1e-9);
  // Each leaves its own pod, either side of the aim.
  assert.deepEqual(s.bullets.map((b) => Math.sign(b.y - red.y)).sort(), [-1, 1]);
  assert.ok(s.bullets.every((b) => Math.abs(Math.hypot(b.vx, b.vy) - TYPES.redNight.shot) < 1e-9 && b.path));
  red.reload = 0;
  assert.equal(fire(s, red, Math.PI, []), false, 'no room for another pair');
  // The pair close in on each other as they steer for you, and never cancel each other out.
  const clear = inert(createWorld(level(['', '', '', '', '', '', '', '..@..........R'])));
  fire(clear, clear.tanks[1], Math.PI, []);
  const flight = run(clear, 4);
  assert.equal(count(flight, 'clash'), 0);
  assert.equal(flight.find((e) => e.type === 'destroyed')?.tank, 'player');
});

test('a Night Red missile finds its way round a wall to you; a plain one dies on it', () => {
  const rows = { 4: '.........#', 5: '.........#', 6: '.........#', 7: '.....@...#.......r', 8: '.........#', 9: '.........#', 10: '.........#' };
  const flight = (path) => {
    const s = inert(createWorld(level(rows), { seed: 1 }));
    s.bullets.push({ id: 900, owner: s.tanks[1].id, x: 16.5, y: 6.6, vx: -3.8, vy: 0, left: 0, weapon: 'missile', fuel: 5, turn: 3.2, path });
    return run(s, 6).find((e) => e.type === 'destroyed');
  };
  assert.equal(flight(false), undefined);
  assert.equal(flight(true)?.tank, 'player');
});

test('Night Red fires round a corner at you hiding behind a wall, and its missiles find you', () => {
  const rows = { 4: '.........#', 5: '.........#', 6: '.........#', 7: '.....@...#.......R', 8: '.........#', 9: '.........#', 10: '.........#' };
  const day = createWorld(level({ ...rows, 7: '.....@...#.......r' }), { seed: 1 });
  assert.equal(count(run(day, 10), 'shot'), 0, 'day Red needs a straight line');
  const s = createWorld(level(rows), { seed: 1 });
  const events = run(s, 10);
  assert.ok(count(events, 'shot') >= 2, 'it fired round the wall');
  assert.equal(events.find((e) => e.type === 'destroyed')?.tank, 'player');
});

test('a Night Red missile swerves round a tank in its way and hits you, not it', () => {
  const s = inert(createWorld(level({ 7: '..@......b.........' }), { seed: 1 }));
  s.bullets.push({ id: 900, owner: 99, x: 16.5, y: 7.5, vx: -3.8, vy: 0, left: 0, weapon: 'missile', fuel: 5, turn: 3.2, path: true });
  const hit = run(s, 6).find((e) => e.type === 'destroyed');
  assert.equal(hit?.tank, 'player');
  assert.ok(s.tanks[1].alive, 'the brown in its way lives');
});

test('Night Lime walks its stream across you; day Lime holds it on you', () => {
  const swing = (letter) => {
    const s = createWorld(level(['', '', '', '', '', '', '', `..@.......${letter}`]), { seed: 3 });
    const lime = s.tanks[1];
    const offs = [];
    run(s, 5, (w) => {
      offs.push(angleDiff(lime.turret, Math.atan2(w.tanks[0].y - lime.y, w.tanks[0].x - lime.x)));
      return IDLE;
    });
    const late = offs.slice(Math.round(2 / STEP));
    return Math.max(...late) - Math.min(...late);
  };
  assert.ok(swing('l') < 0.06, `day Lime swings ${swing('l')}`);
  const night = swing('L');
  assert.ok(night > 0.12, `Night Lime swings only ${night}`);
  assert.ok(night < 2 * Math.atan2(TYPES.limeNight.walk, 7.5) + 0.05, `and no further than a cell either side of you (${night})`);
});

/* ---------- W5: the laser ---------- */

/** The world's laser tank fires at `angle` by hand; returns the events. */
function laser(s, angle) {
  const events = [];
  assert.ok(fire(s, s.tanks.find((t) => TYPES[t.type].weapon === 'laser'), angle, events));
  return events;
}

test('a laser shows its line for LASER_CHARGE s, then burns down it for LASER_BEAM s, then reloads', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '..@.........i'])));
  const t = s.tanks[1];
  assert.equal(laser(s, Math.PI)[0].type, 'charge');
  assert.equal(t.beam.phase, 'charge');
  assert.equal(fire(s, t, 0, []), false, 'one beam at a time');
  // While it charges nothing burns, and the turret holds the line it showed.
  const charging = run(s, LASER_CHARGE - 0.05);
  assert.equal(count(charging, 'destroyed'), 0);
  assert.equal(t.turret, Math.PI);
  const burning = run(s, 0.1);
  assert.equal(count(burning, 'beam'), 1);
  const hit = burning.find((e) => e.type === 'destroyed');
  assert.equal(hit?.tank, 'player');
  assert.equal(hit.cause, 'laser');
  assert.ok(Math.abs(s.time - LASER_CHARGE) < 0.02, `fired at ${s.time}`);
  assert.ok(t.reload > TYPES.indigo.reload, 'reload counts from the end of the beam');
});

test('a beam burns through every tank on its line, stops at a wall or crate, and passes over holes', () => {
  const through = inert(createWorld(level(['', '', '', '', '', '', '', '..@...b..o..i'])));
  laser(through, Math.PI);
  const events = run(through, LASER_CHARGE + 0.1);
  assert.deepEqual(events.filter((e) => e.type === 'destroyed').map((e) => e.tank).sort(), ['brown', 'player']);
  for (const block of ['#', 'x']) {
    const s = inert(createWorld(level(['', '', '', '', '', '', '', `..@..${block}......i`])));
    laser(s, Math.PI);
    assert.equal(count(run(s, LASER_CHARGE + LASER_BEAM + 0.1), 'destroyed'), 0, `a ${block} stops it`);
    assert.equal(s.grid[7 * COLS + 5], block === '#' ? WALL : CRATE, 'and is still there');
  }
});

test('a beam burns shots that cross it and sets off a mine on its line', () => {
  const s = inert(createWorld(level(['', '', '', '', '', '', '', '.............i', '', '', '', '', '', '..@'])));
  laser(s, Math.PI);
  run(s, LASER_CHARGE + 0.02);
  // A shell crossing the line from below, and a mine on it.
  s.bullets.push({ id: 900, owner: s.tanks[0].id, x: 6.5, y: 8.4, vx: 0, vy: -4.6, left: 1, weapon: 'shell' });
  s.mines.push({ id: 901, owner: s.tanks[0].id, x: 9.5, y: 7.5, fuse: 9, armed: true });
  const events = run(s, 0.3);
  assert.equal(s.bullets.length, 0, 'the shell burned');
  assert.ok(events.some((e) => e.type === 'blast'), 'the mine went off');
});

test('a day laser holds its line as it burns; a night laser turns after you, no faster than its track', () => {
  const sweep = (kind) => {
    const s = inert(createWorld(level(['', '', '', '', '', '', '', `..@.........${kind === 'indigo' ? 'i' : 'I'}`])));
    laser(s, Math.PI);
    const t = s.tanks[1];
    const x = t.x;
    // You run down the screen, off the line, as soon as you see it.
    run(s, LASER_CHARGE + LASER_BEAM - 0.05, { ...IDLE, my: 1 });
    assert.equal(t.x, x, 'it stands still while it charges and burns');
    return angleDiff(t.turret, Math.PI);
  };
  assert.equal(sweep('indigo'), 0);
  const turned = sweep('indigoNight');
  assert.ok(turned < -0.05, `it turned ${turned} toward you`);
  assert.ok(Math.abs(turned) <= TYPES.indigoNight.track * LASER_BEAM + 1e-9, `no faster than its track (${turned})`);
});

test('a laser tank never fires with an ally anywhere on its line, and others keep off a line it shows', () => {
  const s = createWorld(level(['', '', '', '', '', '', '', '..@......b..i', '', '', '..........a']), { seed: 2 });
  const events = run(s, 8, (w) => {
    for (const e of w.tanks) {
      if (e.type !== 'indigo' || !e.beam || e.beam.phase !== 'charge' || e.beam.left < LASER_CHARGE - STEP * 1.5) continue;
      const L = beamLine(w.grid, e.x, e.y, e.beam.angle);
      for (const o of w.tanks) {
        if (o.slot >= 0 && o !== e && o.alive) assert.ok(segmentHit(L.x0, L.y0, L.x1, L.y1, o.x, o.y, HIT_R + 0.07) < 0, `${o.type} on the line`);
      }
    }
    return IDLE;
  });
  assert.ok(!events.some((e) => e.type === 'destroyed' && e.tank !== 'player' && e.cause === 'laser'), 'no ally burned');
});

test('a world with a laser charging resumes exactly (plain JSON, deterministic)', () => {
  const lv = level(['', '', '', '', '', '', '', '..@.........I']);
  const script = (s, i) => ({ mx: 0, my: Math.sin(i / 50), aim: null, fire: false, mine: false });
  const a = createWorld(lv, { seed: 4 });
  let i = 0;
  while (i < 120 * 10 && a.phase === 'play' && !a.tanks[1].beam) step(a, script(a, i++), STEP);
  assert.ok(a.tanks[1].beam, 'a laser is charging');
  const b = JSON.parse(JSON.stringify(a));
  assert.ok(isWorld(b));
  for (let k = 0; k < 120 * 3; k++) {
    step(a, script(a, i + k), STEP);
    step(b, script(b, i + k), STEP);
  }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

/* ---------- The test range ---------- */

test('the test range is four short walls, _|__|__ and __|__|_, with you on the left and 1 to 6 of one kind', () => {
  const rows = testMap('brown', 1);
  const walls = new Set();
  rows.forEach((line, r) => [...line].forEach((ch, c) => ch === '#' && walls.add(c)));
  assert.deepEqual([...walls].sort((a, b) => a - b), [2, 6, 13, 17]);
  // Side on, each half reads floor, wall, floor, wall, floor: 2-3-3 on your side, 3-3-2 on theirs.
  assert.equal(rows[7].slice(0, 10).replace(/[^#]/g, '.'), '..#...#...');
  assert.equal(rows[7].slice(10).replace(/[^#]/g, '.'), '...#...#..');
  for (const c of [2, 6, 13, 17]) {
    assert.deepEqual(rows.map((line) => line[c]).join(''), '....#######....', `wall ${c} runs down rows 4 to 10`);
  }
  assert.equal(rows[7][0], '@');
  for (const kind of ENEMY_KINDS) {
    for (let n = 1; n <= TEST_MAX; n++) {
      const map = testMap(kind, n);
      const lv = parseLevel(map);
      assert.equal(lv.enemies.length, n);
      assert.ok(lv.enemies.every((e) => e.type === kind && e.x > COLS / 2));
      assert.deepEqual(checkMap(map).errors, [], `${kind} × ${n}`);
    }
  }
  assert.equal(parseLevel(testMap('lime', 99)).enemies.length, TEST_MAX);
  assert.equal(parseLevel(testMap('lime', 0)).enemies.length, 1);
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

test('every kind has its own colour (a striped variant wears its base kind’s), clear of the off-limits ones, that chip text reads on', async () => {
  // The app is dark only, so the arena has one palette: the .page-tanks block.
  const css = await readFile(new URL('../src/games/tanks/styles.css', import.meta.url), 'utf8');
  const block = (opener) => {
    const at = css.indexOf(opener);
    return css.slice(at, css.indexOf('}', at + opener.length));
  };
  const colours = (text) => Object.fromEntries([...text.matchAll(/--tk-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  assert.ok(!css.includes('prefers-color-scheme'), 'the arena has no light-mode palette');
  const set = colours(block('.page-tanks {'));
  // A night version has no colour of its own: it wears its day kind's (art.js deepens its hull).
  for (const [k, t] of Object.entries(TYPES)) if (t.night) assert.equal(set[k], undefined, `${k} wears ${t.base}'s colour`);
  const kinds = Object.keys(TYPES).filter((k) => !TYPES[k].night);
  const ink = { dark: '#16181d', light: '#faf8f2' }; // the field guide's chip text colours
  for (const k of kinds) assert.match(set[k] || '', /^#[0-9a-f]{6}$/, `--tk-${k}`);
  // A variant wears exactly its base kind's colour; the stripes art.js draws tell them apart.
  for (const [k, base] of Object.entries(VARIANTS)) {
    assert.ok(TYPES[k] && TYPES[base], `variant ${k} of ${base}`);
    assert.equal(set[k], set[base], `${k} wears ${base}'s colour`);
  }
  const variantPair = (a, b) => VARIANTS[a] === b || VARIANTS[b] === a;
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      if (variantPair(kinds[i], kinds[j])) continue;
      const d = distance(set[kinds[i]], set[kinds[j]]);
      assert.ok(d >= 10, `${kinds[i]} and ${kinds[j]} are too alike (${d.toFixed(1)})`);
    }
  }
  for (const k of kinds) {
    // The guide picks whichever chip text reads better on the colour.
    const text = contrast(set[k], ink.dark) >= contrast(set[k], ink.light) ? ink.dark : ink.light;
    assert.ok(contrast(set[k], text) >= 4.5, `chip text on ${k} is ${contrast(set[k], text).toFixed(2)}:1`);
    if (k === 'player') continue;
    // Off limits: your blue, fire orange and crate grey (a tank must never pass for a crate).
    for (const name of ['player', 'fire', 'crate']) {
      assert.ok(distance(set[k], set[name]) >= 10, `${k} is too close to the ${name} colour`);
    }
  }
});

/* ---------- Your own maps: the map editor's model (maps.js) ---------- */

const MAPS = await import('../src/games/tanks/maps.js');

test('a new map is open floor with you on the left, and wants an enemy', () => {
  const rows = MAPS.blankMap();
  assert.ok(MAPS.isMapRows(rows));
  assert.equal(rows[7].indexOf('@'), 2);
  assert.equal(rows.join('').replace(/[.@]/g, ''), '');
  const report = MAPS.mapReport(rows);
  assert.equal(report.ready, false);
  assert.deepEqual(report.problems.map((p) => p.code), ['enemies']);
});

test('the editor paints one of you, mirrors the other flank on request, and never paints over you', () => {
  const rows = MAPS.blankMap();
  // Painting you somewhere moves you.
  const moved = MAPS.paintCell(rows, 5, 3, '@');
  assert.equal(moved.join('').split('@').length, 2);
  assert.equal(moved[3][5], '@');
  // Mirrored: the twin cell across the middle row too, but never a second you.
  const walls = MAPS.paintCell(rows, 9, 2, '#', { mirror: true });
  assert.equal(walls[2][9], '#');
  assert.equal(walls[ROWS - 1 - 2][9], '#');
  assert.equal(MAPS.paintCell(rows, 9, 2, '@', { mirror: true })[ROWS - 1 - 2][9], '.');
  // The middle row is its own twin, and the twin cell of your tank keeps you.
  assert.equal(MAPS.paintCell(rows, 9, 7, 'b', { mirror: true }).join('').split('b').length, 2);
  const guarded = MAPS.paintCell(MAPS.paintCell(rows, 4, 12, '@'), 4, 2, 'x', { mirror: true });
  assert.equal(guarded[12][4], '@');
  assert.equal(guarded[2][4], 'x');
  // Off the map: nothing changes.
  assert.equal(MAPS.paintCell(rows, COLS, 0, '#'), rows);
  assert.equal(MAPS.paintCell(rows, 0, -1, '#'), rows);
});

test('a quick drag paints every cell between two points', () => {
  const line = MAPS.cellsOnLine(0, 0, 7, 3);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line.at(-1), [7, 3]);
  for (let i = 1; i < line.length; i++) {
    assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 1 && Math.abs(line[i][1] - line[i - 1][1]) <= 1, 'no gaps');
  }
  assert.deepEqual(MAPS.cellsOnLine(4, 4, 4, 4), [[4, 4]]);
  assert.deepEqual(MAPS.cellsOnLine(3, 5, 3, 2), [[3, 5], [3, 4], [3, 3], [3, 2]]);
});

test('your maps must be playable: your tank, 1 to 8 enemies, every enemy within reach', () => {
  const blank = Array.from({ length: ROWS }, () => '.'.repeat(COLS));
  const map = (edits) => blank.map((line, r) => (edits[r] ? edits[r].padEnd(COLS, '.') : line));
  assert.deepEqual(MAPS.mapReport(map({ 3: '..........b' })).problems.map((p) => p.code), ['player']);
  const crowd = map({ 1: '@', 3: '...........bbbbbbbbb' });
  assert.deepEqual(MAPS.mapReport(crowd).problems.filter((p) => p.blocking).map((p) => p.code), ['count']);
  assert.equal(MAPS.mapReport(crowd).problems[0].n, 9);
  // Walled in with no line of sight: it blocks play, and says which tank and where.
  const sealed = MAPS.mapReport(map({ 6: '...............###', 7: '..@............#b#', 8: '...............###' }));
  assert.equal(sealed.ready, false);
  assert.deepEqual(sealed.problems.find((p) => p.code === 'unreachable'), { code: 'unreachable', kind: 'brown', at: [16, 7], blocking: true });
  // A clear shot at your start is only a note: the map can still be played.
  const open = MAPS.mapReport(map({ 7: '..@..............b' }));
  assert.equal(open.ready, true);
  assert.deepEqual(open.problems, [{ code: 'startShot', kind: 'brown', at: [17, 7], blocking: false }]);
  // Every campaign mission would pass the editor without a word.
  for (const rows of MISSIONS) assert.deepEqual(MAPS.mapReport(rows).problems, [], rows.join('\n'));
});

test('the editor draws a map exactly as a mission starts, even one not ready yet', () => {
  const pose = (t) => ({ type: t.type, x: t.x, y: t.y, body: t.body, turret: t.turret, alive: t.alive });
  for (const rows of [...MISSIONS, testMap('yellowNight', 6)]) {
    const s = MAPS.mapWorld(rows);
    assert.deepEqual(s.grid, parseLevel(rows).grid);
    assert.deepEqual(s.tanks.map(pose), createWorld(parseLevel(rows)).tanks.map(pose));
  }
  // With nowhere to face, enemies face your side of the map.
  const s = MAPS.mapWorld(MAPS.paintCell(MAPS.paintCell(MAPS.blankMap(), 2, 7, '.'), 12, 4, 'k'), 5);
  assert.equal(s.gridVer, 5);
  assert.deepEqual(s.tanks.map((t) => [t.type, t.turret]), [['black', Math.PI]]);
});

test('saved maps load only when well formed', () => {
  const good = MAPS.blankMap();
  assert.ok(MAPS.isMapRows(MISSIONS[19]));
  assert.ok(!MAPS.isMapRows(good.slice(1)), 'a row short');
  assert.ok(!MAPS.isMapRows(good.map((l, r) => (r ? l : `${l}.`))), 'a cell too many');
  assert.ok(!MAPS.isMapRows(MAPS.paintCell(good, 0, 0, '?')), 'an unknown cell');
  assert.ok(!MAPS.isMapRows(good.map((l, r) => (r === 0 ? `@${l.slice(1)}` : l))), 'two of you');
  const saved = MAPS.readMaps({ next: 2, list: [{ id: 1, name: 'A', rows: good }, { id: 6, name: 'B', rows: good }, { id: 3, name: 'C', rows: ['...'] }, null] });
  assert.deepEqual(saved.list.map((m) => m.id), [1, 6]);
  assert.equal(saved.next, 7, 'new ids never reuse a saved one');
  assert.deepEqual(MAPS.readMaps(null), { next: 1, list: [] });
  for (const ch of Object.keys(SPAWN_CODES)) assert.ok(MAPS.MAP_CELLS.includes(ch), `brush for ${SPAWN_CODES[ch]}`);
});
