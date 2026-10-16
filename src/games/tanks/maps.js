// Maps you draw yourself, in the map editor on the start sheet. A map is written exactly like a
// mission (missions.js), one string per row, at any 4:3 size of SCALES (rules.js): 9 rows of 12
// characters up to 24 rows of 32, a mission's 15 of 20 by default. Your maps don't have to pass every
// check a campaign mission does, only the ones that make them playable: your tank, 1 to
// MAX_ENEMIES enemies, and every enemy within reach (mapcheck.js). An enemy with a clear shot
// at your start is only a note. No DOM: tanks.js draws and saves them.
import { MAX_ENEMIES, checkMap } from './mapcheck.js';
import { CRATE, FLOOR, HOLE, OLD_CODES, SCALE, SCALES, SPAWN_CODES, WALL, sizeAt } from './rules.js';

export { MAX_ENEMIES };

/** Every character a map can hold: floor, wall, crate, hole, you, then the enemy letters. */
export const MAP_CELLS = `.#xo@${Object.keys(SPAWN_CODES).join('')}`;
export const NAME_MAX = 24;
const START_COL = 2; // where a new map puts you: this column, halfway down

/** A map's scale (SCALES): 5 for a mission's 20 x 15. */
export const mapScale = (rows) => rows.length / 3;

/** A new map at a scale: open floor, with you on the left, halfway down. */
export function blankMap(scale = SCALE) {
  const [cols, height] = sizeAt(scale);
  const mid = Math.floor(height / 2);
  return Array.from({ length: height }, (_, r) => (r === mid ? '@'.padStart(START_COL + 1, '.').padEnd(cols, '.') : '.'.repeat(cols)));
}

/** Whether rows is a map the editor can hold (it may still be unplayable). */
export function isMapRows(rows) {
  if (!Array.isArray(rows) || !SCALES.includes(mapScale(rows))) return false;
  const [cols] = sizeAt(mapScale(rows));
  return (
    rows.every((line) => typeof line === 'string' && line.length === cols && [...line].every((ch) => MAP_CELLS.includes(ch))) &&
    rows.join('').split('@').length <= 2
  );
}

/**
 * The map at another scale, cut or widened evenly round its middle. Enemies cut off are gone;
 * you never are: cut off, you move to the nearest cell left.
 */
export function resizeMap(rows, scale) {
  const [cols, height] = sizeAt(scale);
  // trunc, not floor: an odd difference splits the same way growing and shrinking, so a map
  // taken to another size and back is the map it was.
  const dc = Math.trunc((cols - rows[0].length) / 2);
  const dr = Math.trunc((height - rows.length) / 2);
  const out = Array.from({ length: height }, (_, r) => {
    const line = rows[r - dr] || '';
    return Array.from({ length: cols }, (_, c) => line[c - dc] ?? '.');
  });
  const r0 = rows.findIndex((line) => line.includes('@'));
  if (r0 >= 0) {
    const c = Math.max(0, Math.min(cols - 1, rows[r0].indexOf('@') + dc));
    const r = Math.max(0, Math.min(height - 1, r0 + dr));
    for (const line of out) line.forEach((ch, i) => (line[i] = ch === '@' ? '.' : ch));
    out[r][c] = '@';
  }
  return out.map((line) => line.join(''));
}

/** A saved map's rows with retired letters turned into the kinds that replaced them (Violet: Night Pink). */
const renew = (rows) => (Array.isArray(rows) ? rows.map((line) => (typeof line === 'string' ? line.replace(/[vh]/g, (ch) => OLD_CODES[ch]) : line)) : rows);

/** The saved maps, keeping only well-formed ones. */
export function readMaps(data) {
  const list = Array.isArray(data?.list) ? data.list.map((m) => (m && typeof m === 'object' ? { ...m, rows: renew(m.rows) } : m)) : [];
  const maps = list.filter((m) => m && Number.isInteger(m.id) && typeof m.name === 'string' && isMapRows(m.rows));
  const next = Math.max(Number.isInteger(data?.next) ? data.next : 1, ...maps.map((m) => m.id + 1));
  return { next, list: maps };
}

/**
 * The map with ch painted at column c, row r. There is only ever one of you, so painting
 * you somewhere moves you. mirror also paints the twin cell across the middle row (the map's
 * other flank), except with you, and never over you.
 */
export function paintCell(rows, c, r, ch, { mirror = false } = {}) {
  if (c < 0 || r < 0 || c >= rows[0].length || r >= rows.length) return rows;
  const next = rows.slice();
  const set = (cc, rr) => {
    next[rr] = next[rr].slice(0, cc) + ch + next[rr].slice(cc + 1);
  };
  if (ch === '@') next.forEach((line, y) => (next[y] = line.replace('@', '.')));
  set(c, r);
  const twin = rows.length - 1 - r;
  if (mirror && ch !== '@' && twin !== r && next[twin][c] !== '@') set(c, twin);
  return next;
}

/** The cells on a straight line from (c0, r0) to (c1, r1), both ends included, so a quick drag leaves no gaps. */
export function cellsOnLine(c0, r0, c1, r1) {
  const cells = [];
  const dc = Math.abs(c1 - c0);
  const dr = -Math.abs(r1 - r0);
  const sc = c0 < c1 ? 1 : -1;
  const sr = r0 < r1 ? 1 : -1;
  let err = dc + dr;
  let c = c0;
  let r = r0;
  for (;;) {
    cells.push([c, r]);
    if (c === c1 && r === r1) return cells;
    const e2 = 2 * err;
    if (e2 >= dr) {
      err += dr;
      c += sc;
    }
    if (e2 <= dc) {
      err += dc;
      r += sr;
    }
  }
}

/**
 * Whether a map can be played, and what is wrong with it. Each problem is { code, blocking }
 * and maybe kind, n or at ([col, row]): player (no tank of yours), enemies (none), count (too
 * many), unreachable (an enemy you can't reach or shoot), startShot (an enemy with a clear
 * shot at your start, which doesn't block). ready: nothing blocks.
 */
export function mapReport(rows) {
  const flat = rows.join('');
  const enemies = [...flat].filter((ch) => SPAWN_CODES[ch]).length;
  const problems = [];
  if (!flat.includes('@')) problems.push({ code: 'player', blocking: true });
  if (!enemies) problems.push({ code: 'enemies', blocking: true });
  if (enemies > MAX_ENEMIES) problems.push({ code: 'count', n: enemies, blocking: true });
  if (flat.includes('@') && enemies) {
    for (const p of checkMap(rows).errors) {
      if (p.code === 'unreachable' || p.code === 'startShot') {
        problems.push({ code: p.code, kind: p.kind, at: p.at, blocking: p.code === 'unreachable' });
      }
    }
  }
  return { enemies, problems, ready: !problems.some((p) => p.blocking) };
}

const BLOCKS = { '#': WALL, x: CRATE, o: HOLE };

/**
 * The map as a world the renderer can draw, with every tank in place and the enemies facing
 * you, as at the start of a mission. Unlike parseLevel it takes a map that isn't ready yet.
 * gridVer changes whenever the blocks do, so the renderer redraws its floor.
 */
export function mapWorld(rows, gridVer = 0) {
  const cols = rows[0].length;
  const grid = new Array(cols * rows.length).fill(FLOOR);
  const tank = (type, c, r) => ({ type, x: c + 0.5, y: r + 0.5, body: 0, turret: 0, alive: true });
  let you = null;
  const enemies = [];
  rows.forEach((line, r) => {
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      if (BLOCKS[ch]) grid[r * cols + c] = BLOCKS[ch];
      else if (ch === '@') you = tank('player', c, r);
      else if (SPAWN_CODES[ch]) enemies.push(tank(SPAWN_CODES[ch], c, r));
    }
  });
  for (const e of enemies) {
    e.turret = you ? Math.atan2(you.y - e.y, you.x - e.x) : Math.PI;
    e.body = Math.abs(e.turret) > Math.PI / 2 ? Math.PI : 0;
  }
  const tanks = [...(you ? [{ ...you, slot: -1 }] : []), ...enemies.map((e, slot) => ({ ...e, slot }))].map((t, i) => ({ id: i + 1, ...t }));
  return { time: 0, gridVer, grid, tanks, bullets: [], bombs: [], mines: [] };
}
