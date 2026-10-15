// Tanks arenas of every size (SCALES: 4:3, from 12 x 9 to 32 x 24) and the map generator
// (mapgen.js) behind the editor's Generate button.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathField } from '../src/games/tanks/ai.js';
import { createWorld, parseLevel, step } from '../src/games/tanks/engine.js';
import { checkMap, tightSpots } from '../src/games/tanks/mapcheck.js';
import { THEMES, generateMap, themeOf } from '../src/games/tanks/mapgen.js';
import { blankMap, isMapRows, mapReport, mapScale, mapWorld, paintCell, readMaps, resizeMap } from '../src/games/tanks/maps.js';
import { MISSIONS } from '../src/games/tanks/missions.js';
import { COLS, ENEMY_KINDS, ROWS, SCALE, SCALES, SPAWN_CODES, STEP, WALL, cellAt, gridSize, isArenaLength, sizeAt } from '../src/games/tanks/rules.js';
import { makeBot } from '../scripts/playtest.mjs';

const at = (rows, c, r) => rows[r][c];
const find = (rows, ch) => {
  const r = rows.findIndex((line) => line.includes(ch));
  return r < 0 ? null : [rows[r].indexOf(ch), r];
};

test('every arena is 4:3, and a grid says its own size', () => {
  assert.deepEqual(sizeAt(SCALE), [COLS, ROWS]);
  for (const k of SCALES) {
    const [cols, rows] = sizeAt(k);
    assert.equal(cols * 3, rows * 4);
    const grid = new Array(cols * rows).fill(0);
    assert.deepEqual(gridSize(grid), [cols, rows]);
    assert.ok(isArenaLength(grid.length));
    // Past every edge is wall; the far corner is still floor.
    assert.equal(cellAt(grid, cols, 0), WALL);
    assert.equal(cellAt(grid, 0, rows), WALL);
    assert.equal(cellAt(grid, cols - 1, rows - 1), 0);
  }
  assert.ok(!isArenaLength(20 * 16));
});

test('a map of any size parses; anything else is refused', () => {
  for (const k of SCALES) {
    const rows = blankMap(k);
    rows[1] = 'b' + rows[1].slice(1);
    const lv = parseLevel(rows);
    assert.equal(lv.grid.length, sizeAt(k)[0] * sizeAt(k)[1]);
    assert.equal(lv.enemies.length, 1);
  }
  assert.throws(() => parseLevel(Array(16).fill('.'.repeat(20))), /rows/);
  assert.throws(() => parseLevel(['..@'.padEnd(19, '.'), ...Array(14).fill('b'.padEnd(20, '.'))]), /cells/);
  assert.doesNotThrow(() => parseLevel(MISSIONS[0]));
});

test('blank maps, painting, mirroring and saved maps work at every size', () => {
  for (const k of SCALES) {
    const [cols, rows] = sizeAt(k);
    const map = blankMap(k);
    assert.equal(map.length, rows);
    assert.ok(map.every((line) => line.length === cols));
    assert.deepEqual(find(map, '@'), [2, Math.floor(rows / 2)]);
    assert.equal(mapScale(map), k);
    assert.ok(isMapRows(map));
    // The twin cell across the middle row, at this size.
    const painted = paintCell(map, cols - 1, 0, '#', { mirror: true });
    assert.equal(at(painted, cols - 1, rows - 1), '#');
    assert.equal(paintCell(map, cols, 0, '#'), map, 'off the map changes nothing');
    assert.equal(mapWorld(map).grid.length, cols * rows);
  }
  assert.ok(!isMapRows(Array(10).fill('.'.repeat(13))), 'not 4:3');
  const small = { id: 1, name: 'Small', rows: blankMap(3) };
  assert.deepEqual(readMaps({ next: 2, list: [small] }).list, [small]);
});

test('a new size cuts or widens a map round its middle, and never loses you', () => {
  const map = paintCell(paintCell(blankMap(5), 10, 7, '#'), 19, 0, 'b');
  const big = resizeMap(map, 8);
  assert.equal(mapScale(big), 8);
  // Widened by 6 columns each side and 4 rows each side: the wall moves with the middle.
  assert.equal(at(big, 16, 11), '#');
  assert.deepEqual(find(big, '@'), [8, 11]);
  assert.deepEqual(find(big, 'b'), [25, 4]);
  // Cut down to 12 x 9: the corner enemy is gone, you are kept at the nearest cell left.
  const small = resizeMap(map, 3);
  assert.equal(mapScale(small), 3);
  assert.equal(find(small, 'b'), null);
  assert.deepEqual(find(small, '@'), [0, 4]);
  assert.equal(small.join('').split('@').length, 2, 'one of you');
  assert.deepEqual(resizeMap(big, 5), map, 'and back again');
});

test('tight spots count each place a tank can only squeeze through once', () => {
  const open = blankMap(5);
  assert.deepEqual(tightSpots(open), { cells: 0, spots: 0 });
  // A wall across the arena with a one-cell gap: one spot.
  const wall = open.map((line, r) => (r === 5 ? '#'.repeat(9) + '.' + '#'.repeat(10) : line));
  assert.deepEqual(tightSpots(wall), { cells: 1, spots: 1 });
  // A gap two cells wide is roomy.
  const wide = open.map((line, r) => (r === 5 ? '#'.repeat(9) + '..' + '#'.repeat(9) : line));
  assert.deepEqual(tightSpots(wide), { cells: 0, spots: 0 });
  // A one-wide corridor three cells long, in a wall three thick: one spot of three cells.
  const corridor = open.map((line, r) => (r === 5 ? '#'.repeat(8) + '...' + '#'.repeat(9) : r === 4 || r === 6 ? '#'.repeat(20) : line));
  assert.deepEqual(tightSpots(corridor), { cells: 3, spots: 1 });
});

test("each kind's map suits it", () => {
  assert.equal(themeOf('pink'), 'banks');
  assert.equal(themeOf('green'), 'banks');
  assert.equal(themeOf('lime'), 'open');
  assert.equal(themeOf('olive'), 'open');
  assert.equal(themeOf('black'), 'open');
  assert.equal(themeOf('red'), 'corners');
  assert.equal(themeOf('yellow'), 'lanes');
  assert.equal(themeOf('brown'), 'pockets');
  for (const kind of ENEMY_KINDS) assert.ok(THEMES[themeOf(kind)], `${kind} has a theme`);
  const lime = generateMap({ seed: 3, lead: 'lime' });
  assert.equal(lime.theme, 'open');
  assert.ok(lime.kinds.filter((k) => k === 'lime').length > lime.kinds.length / 2, 'most of them are the lead');
});

test('every generated map can be played, at every size, with few tight spots', () => {
  for (const k of SCALES) {
    for (let seed = 1; seed <= 12; seed++) {
      const m = generateMap({ scale: k, seed });
      const where = `scale ${k}, seed ${seed}`;
      assert.ok(isMapRows(m.rows), where);
      assert.equal(mapScale(m.rows), k, where);
      assert.deepEqual(checkMap(m.rows).errors, [], where);
      assert.ok(mapReport(m.rows).ready, where);
      assert.ok(m.kinds.length >= 1 && m.kinds.length <= 8, where);
      assert.ok(m.kinds.every((kind) => Object.values(SPAWN_CODES).includes(kind)), where);
      assert.ok(tightSpots(m.rows).spots <= THEMES[m.theme].tight, `${where}: ${tightSpots(m.rows).spots} tight spots`);
    }
  }
});

test('the same seed makes the same map, and another seed another', () => {
  assert.deepEqual(generateMap({ scale: 6, seed: 42 }), generateMap({ scale: 6, seed: 42 }));
  assert.notDeepEqual(generateMap({ scale: 6, seed: 42 }).rows, generateMap({ scale: 6, seed: 43 }).rows);
});

test('enemies think and drive on the smallest and the largest arena', () => {
  for (const k of [3, 8]) {
    const { rows } = generateMap({ scale: k, seed: 5 });
    const [cols, height] = sizeAt(k);
    const s = createWorld(parseLevel(rows), { seed: 1 });
    assert.equal(pathField(s).length, cols * height);
    const bot = makeBot({ seed: 1 });
    for (let i = 0; i < 6 / STEP && s.phase === 'play'; i++) step(s, bot(s), STEP);
    for (const t of s.tanks) assert.ok(t.x > 0 && t.x < cols && t.y > 0 && t.y < height, `scale ${k}: ${t.type} stays on the field`);
  }
});
