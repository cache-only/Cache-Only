// Board art for the launcher: each game's tile, and the suggested game's board bleeding in
// behind the top of the screen. It lives in the app shell, not in the games' folders, so the
// launcher never depends on a file inside a game's pack. A game with a save shows its own board
// (2048's grid, Sudoku's puzzle); an id without art here gets a generic field of pixels.
// Styles: .art in styles.css.
import { createStore } from './storage.js';

const SAMPLE_SUDOKU = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const SAMPLE_SUDOKU_GRID = '534070000670195000098000060800760003400853001700020106060000280000419005000080079';
const SAMPLE_2048 = [2, 0, 0, 2, 4, 8, 0, 0, 16, 32, 4, 2, 128, 64, 8, 4];
const SAMPLE_ARENA = [
  '####################',
  '#..................#',
  '#..##........##..E.#',
  '#..#..........#....#',
  '#.......##.........#',
  '#.......##.....##..#',
  '#P.............##..#',
  '#....##.....E......#',
  '#....##............#',
  '#.........##.......#',
  '#..#......##..#....#',
  '#..##........##....#',
  '#...............E..#',
  '#..................#',
  '####################',
];

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

function tile2048Art() {
  const saved = createStore('2048').peek('session');
  const ok = saved && Array.isArray(saved.grid) && saved.grid.length === 16 && saved.grid.some((v) => v > 0);
  const grid = ok ? saved.grid : SAMPLE_2048;
  const art = span('art art-2048');
  for (const v of grid) {
    const cell = span(v ? `t${v <= 2048 ? v : 'max'}` : '', v ? String(v) : '');
    if (v) cell.dataset.len = String(v).length;
    art.append(cell);
  }
  return art;
}

function tanksArt() {
  const art = span('art art-tanks');
  const arena = span('art-arena');
  const kind = { '#': 'is-wall', P: 'is-you', E: 'is-enemy' };
  for (const row of SAMPLE_ARENA) for (const ch of row) arena.append(span(kind[ch] || ''));
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

const ART = { sudoku: sudokuArt, 2048: tile2048Art, tanks: tanksArt };

/** The board art for a game, as an element. variant: 'tile' | 'hero'. */
export function gameArt(id, variant = 'tile') {
  const art = (ART[id] || (() => genericArt(id)))();
  art.classList.add(`art-${variant}`);
  art.setAttribute('aria-hidden', 'true');
  return art;
}
