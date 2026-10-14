// Maps you draw yourself, in the map editor on the start sheet. A map is written exactly like a
// mission (missions.js): ROWS strings of COLS characters. Your maps don't have to pass every
// check a campaign mission does, only the ones that make them playable: your tank, 1 to
// MAX_ENEMIES enemies, and every enemy within reach (mapcheck.js). An enemy with a clear shot
// at your start is only a note. No DOM: tanks.js draws and saves them.
import { MAX_ENEMIES, checkMap } from './mapcheck.js';
import { COLS, CRATE, FLOOR, HOLE, ROWS, SPAWN_CODES, WALL } from './rules.js';

export { MAX_ENEMIES };

/** Every character a map can hold: floor, wall, crate, hole, you, then the enemy letters. */
export const MAP_CELLS = `.#xo@${Object.keys(SPAWN_CODES).join('')}`;
export const NAME_MAX = 24;
const START = [2, 7]; // where a new map puts you: column, row

/** A new map: open floor, with you on the left, halfway down. */
export function blankMap() {
  return Array.from({ length: ROWS }, (_, r) => (r === START[1] ? '@'.padStart(START[0] + 1, '.').padEnd(COLS, '.') : '.'.repeat(COLS)));
}

/** Whether rows is a map the editor can hold (it may still be unplayable). */
export function isMapRows(rows) {
  return (
    Array.isArray(rows) &&
    rows.length === ROWS &&
    rows.every((line) => typeof line === 'string' && line.length === COLS && [...line].every((ch) => MAP_CELLS.includes(ch))) &&
    rows.join('').split('@').length <= 2
  );
}

/** The saved maps, keeping only well-formed ones. */
export function readMaps(data) {
  const list = Array.isArray(data?.list) ? data.list : [];
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
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return rows;
  const next = rows.slice();
  const set = (cc, rr) => {
    next[rr] = next[rr].slice(0, cc) + ch + next[rr].slice(cc + 1);
  };
  if (ch === '@') next.forEach((line, y) => (next[y] = line.replace('@', '.')));
  set(c, r);
  const twin = ROWS - 1 - r;
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
  const grid = new Array(COLS * ROWS).fill(FLOOR);
  const tank = (type, c, r) => ({ type, x: c + 0.5, y: r + 0.5, body: 0, turret: 0, alive: true });
  let you = null;
  const enemies = [];
  rows.forEach((line, r) => {
    for (let c = 0; c < COLS; c++) {
      const ch = line[c];
      if (BLOCKS[ch]) grid[r * COLS + c] = BLOCKS[ch];
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
