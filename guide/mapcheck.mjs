// Checks for a Tanks mission map, beyond "does it parse". Errors are what the tests reject;
// warnings are nudges. tests/tanks.test.mjs runs them over every mission, and the field
// guide's map editor runs them live (scripts/guide.mjs bundles this file with the game's
// rules.js, ai.js and engine.js). No DOM.
import { parseLevel } from '../src/games/tanks/engine.js';
import { COLS, CRATE, FLOOR, HIT_R, MUZZLE, ROWS, SHELL_R, TYPES, cellAt, muzzleBlocked, tracePath } from '../src/games/tanks/rules.js';

export const MAX_ENEMIES = 8;
export const OPEN_WARN = 0.75; // more open floor than this earns a nudge

/** A map's blocks only (walls, crates and holes), as one string. */
export const blocksOf = (rows) => rows.map((line) => line.replace(/[^#xo]/g, '.')).join('\n');

/** Whether a map's blocks are the same top to bottom. */
export function isMirrored(rows) {
  const blocks = rows.map((line) => line.replace(/[^#xo]/g, '.'));
  return blocks.every((line, r) => line === blocks[rows.length - 1 - r]);
}

/** The share of cells with no block on them. */
export function openShare(rows) {
  let open = 0;
  for (const line of rows) for (const ch of line) if (!'#xo'.includes(ch)) open++;
  return open / (rows.length * (rows[0] || '').length || 1);
}

/** Cells you can drive to from your start, as "c,r" keys. Crates count: a mine clears them. */
function reachable(lv) {
  const passable = (c, r) => [FLOOR, CRATE].includes(cellAt(lv.grid, c, r));
  const start = [Math.floor(lv.player.x), Math.floor(lv.player.y)];
  const seen = new Set([start.join()]);
  const queue = [start];
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
  return seen;
}

/**
 * Whether enemy e has a clear straight shot at your start: its shot, leaving the muzzle
 * aimed at your centre, passes within a hit of you before meeting a wall or crate.
 * Mortars are left out: they lob over everything, so cover can't help against them.
 */
export function startShot(lv, e) {
  if (TYPES[e.type].weapon === 'bomb') return false;
  const p = lv.player;
  const angle = Math.atan2(p.y - e.y, p.x - e.x);
  if (muzzleBlocked(lv.grid, e.x, e.y, angle)) return false;
  const ox = e.x + Math.cos(angle) * MUZZLE;
  const oy = e.y + Math.sin(angle) * MUZZLE;
  const pts = tracePath(lv.grid, ox, oy, angle, 0);
  // The first leg of the path: does it pass the player before it ends?
  const [ax, ay, bx, by] = pts;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const k = len2 ? Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2)) : 0;
  return Math.hypot(ax + (bx - ax) * k - p.x, ay + (by - ay) * k - p.y) < HIT_R + SHELL_R;
}

/**
 * Checks a map (ROWS strings of COLS characters). `others` are other missions, as
 * { name, rows }, whose block layout it must not repeat. Returns { errors, warnings,
 * stats }, where each problem is { text, at } and at is [col, row] or null.
 */
export function checkMap(rows, { others = [] } = {}) {
  const errors = [];
  const warnings = [];
  let lv;
  try {
    lv = parseLevel(rows);
  } catch (err) {
    return { errors: [{ text: err.message, at: null }], warnings, stats: null };
  }
  const cellOf = (t) => [Math.floor(t.x), Math.floor(t.y)];
  if (lv.enemies.length > MAX_ENEMIES) errors.push({ text: `${lv.enemies.length} enemies: at most ${MAX_ENEMIES}`, at: null });

  // Every enemy can be reached: driven up to, or seen down a clear straight line from
  // somewhere you can drive (shells fly over holes, and crates can be mined away).
  const seen = reachable(lv);
  const clearOfCrates = lv.grid.map((v) => (v === CRATE ? FLOOR : v));
  for (const e of lv.enemies) {
    const [ec, er] = cellOf(e);
    const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => seen.has(`${ec + dc},${er + dr}`));
    const visible =
      near ||
      [...seen].some((key) => {
        const [c, r] = key.split(',').map(Number);
        const pts = tracePath(clearOfCrates, c + 0.5, r + 0.5, Math.atan2(e.y - r - 0.5, e.x - c - 0.5), 0);
        return Math.hypot(pts[2] - c - 0.5, pts[3] - r - 0.5) >= Math.hypot(e.x - c - 0.5, e.y - r - 0.5) - 0.5;
      });
    if (!visible) errors.push({ text: `${e.type} at ${ec},${er} can't be reached or shot`, at: [ec, er] });
  }

  // Nobody gets a free shot at you before you have moved.
  for (const e of lv.enemies) {
    if (startShot(lv, e)) errors.push({ text: `${e.type} at ${cellOf(e).join(',')} has a clear shot at your start`, at: cellOf(e) });
  }

  const blocks = blocksOf(rows);
  for (const o of others) {
    if (blocksOf(o.rows) === blocks) errors.push({ text: `same blocks as ${o.name}`, at: null });
  }

  const open = openShare(rows);
  const mirrored = isMirrored(rows);
  if (open > OPEN_WARN) warnings.push({ text: `${Math.round(open * 100)}% of the floor is open: more than ${Math.round(OPEN_WARN * 100)}% plays thin`, at: null });
  if (mirrored) warnings.push({ text: 'mirrored top to bottom: both flanks play the same', at: null });
  return { errors, warnings, stats: { enemies: lv.enemies.length, open, mirrored, start: cellOf(lv.player) } };
}
