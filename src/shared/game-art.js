// Board art for the launcher: each game's tile, and the suggested game's board bleeding in
// behind the top of the screen. It lives in the app shell, not in the games' folders, so the
// launcher never depends on a file inside a game's pack. A game with a save shows its own board
// (Sudoku's puzzle); an id without art here gets a generic field of pixels.
// Styles: .art in styles.css.
import { createStore } from './storage.js';

const SAMPLE_SUDOKU = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const SAMPLE_SUDOKU_GRID = '534070000670195000098000060800760003400853001700020106060000280000419005000080079';
const SAMPLE_ARENA = [
  '###############',
  '#.............#',
  '#..##.....#...#',
  '#..#......#...#',
  '#.............#',
  '#.............#',
  '#......##.....#',
  '#......##.....#',
  '#...........#.#',
  '#...........#.#',
  '#..##.........#',
  '#...#.........#',
  '#.......##....#',
  '#.............#',
  '###############',
];
// The tanks on it, in cells: centre, the way the hull faces (degrees, 0 = right) and the tank
// the turret aims at. They are drawn larger than in the game, so the shape reads on a tile.
const SAMPLE_TANKS = [
  { x: 3.5, y: 7, body: -8, aim: 1, you: true },
  { x: 12.5, y: 4.5, body: 195, aim: 0 },
  { x: 11.5, y: 11.5, body: -105, aim: 0 },
];
const TANK_SCALE = 2.6;
const SVG = 'http://www.w3.org/2000/svg';

function span(className, text) {
  const el = document.createElement('span');
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function sudokuArt() {
  const saved = createStore('sudoku').peek('session');
  const ok = (s) => typeof s === 'string' && /^[0-9]{81}$/.test(s);
  const puzzle = saved && ok(saved.puzzle) && ok(saved.grid) ? saved.puzzle : SAMPLE_SUDOKU;
  const grid = puzzle === SAMPLE_SUDOKU ? SAMPLE_SUDOKU_GRID : saved.grid;
  const art = span('art art-sudoku');
  for (let b = 0; b < 9; b++) {
    const box = span('art-box');
    for (let k = 0; k < 9; k++) {
      const i = (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3);
      const given = puzzle[i] !== '0';
      const d = grid[i] !== '0' ? grid[i] : '';
      box.append(span(given ? 'is-given' : d ? 'is-entered' : '', d));
    }
    art.append(box);
  }
  return art;
}

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** A tank seen from above, as the game draws it: treads, hull, turret and barrel. */
function tankShape(t, target) {
  const aim = (Math.atan2(target.y - t.y, target.x - t.x) * 180) / Math.PI;
  return svg('g', { class: t.you ? 'art-tank is-you' : 'art-tank', transform: `translate(${t.x} ${t.y}) scale(${TANK_SCALE})` },
    svg('g', { transform: `rotate(${t.body})` },
      svg('rect', { class: 'art-tread', x: -0.43, y: -0.39, width: 0.86, height: 0.21, rx: 0.05 }),
      svg('rect', { class: 'art-tread', x: -0.43, y: 0.18, width: 0.86, height: 0.21, rx: 0.05 }),
      svg('rect', { class: 'art-hull', x: -0.37, y: -0.26, width: 0.74, height: 0.52, rx: 0.09 })),
    svg('g', { transform: `rotate(${aim.toFixed(1)})` },
      svg('rect', { class: 'art-barrel', x: 0.08, y: -0.07, width: 0.5, height: 0.14 }),
      svg('circle', { class: 'art-turret', r: 0.22 })));
}

function tanksArt() {
  const art = span('art art-tanks');
  const arena = span('art-arena');
  for (const row of SAMPLE_ARENA) for (const ch of row) arena.append(span(ch === '#' ? 'is-wall' : ''));
  const tanks = svg('svg', { class: 'art-tanks-layer', viewBox: '0 0 15 15' });
  for (const t of SAMPLE_TANKS) tanks.append(tankShape(t, SAMPLE_TANKS[t.aim]));
  arena.append(tanks);
  art.append(arena);
  return art;
}

/** Any other game: a field of grey pixels, seeded by its id so it is always the same. */
function genericArt(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const art = span('art art-pixels');
  for (let i = 0; i < 36; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    art.append(span(`p${h % 5}`));
  }
  return art;
}

const ART = { sudoku: sudokuArt, tanks: tanksArt };

/** The board art for a game, as an element. variant: 'tile' | 'hero'. */
export function gameArt(id, variant = 'tile') {
  const art = (ART[id] || (() => genericArt(id)))();
  art.classList.add(`art-${variant}`);
  art.setAttribute('aria-hidden', 'true');
  return art;
}
