// Bitmask Sudoku solver with minimum-remaining-values search.
// Grids are arrays of 81 numbers, row-major, 0 = empty.

export const ROW = new Uint8Array(81);
export const COL = new Uint8Array(81);
export const BOX = new Uint8Array(81);
for (let i = 0; i < 81; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
}

/** The 20 cells sharing a row, column or box with each cell. */
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const peers = [];
  for (let j = 0; j < 81; j++) {
    if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) peers.push(j);
  }
  return peers;
});

const POP = new Uint8Array(512);
for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);

/** Fisher–Yates with an injected PRNG. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Returns null if the givens already break a rule or a value is out of range.
function setup(grid) {
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  const cells = new Uint8Array(81);
  const empties = [];
  for (let i = 0; i < 81; i++) {
    const v = grid[i] | 0;
    if (v < 0 || v > 9) return null;
    if (v === 0) {
      empties.push(i);
      continue;
    }
    const bit = 1 << (v - 1);
    if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & bit) return null;
    rows[ROW[i]] |= bit;
    cols[COL[i]] |= bit;
    boxes[BOX[i]] |= bit;
    cells[i] = v;
  }
  return { cells, rows, cols, boxes, empties };
}

// Depth-first search; stops once `limit` solutions are found.
// With an rng, candidate digits are tried in random order.
function search(state, limit, rng, onSolution) {
  const { cells, rows, cols, boxes, empties } = state;
  const n = empties.length;
  let count = 0;

  const rec = (k) => {
    if (k === n) {
      count++;
      if (onSolution) onSolution(cells);
      return count >= limit;
    }
    let best = k;
    let bestMask = 0;
    let bestCount = 10;
    for (let j = k; j < n; j++) {
      const i = empties[j];
      const mask = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 0x1ff;
      const c = POP[mask];
      if (c < bestCount) {
        best = j;
        bestMask = mask;
        bestCount = c;
        if (c <= 1) break;
      }
    }
    if (bestCount === 0) return false;
    // The order of empties[k..] doesn't matter, so the swap never needs undoing.
    const i = empties[best];
    empties[best] = empties[k];
    empties[k] = i;
    const r = ROW[i];
    const c = COL[i];
    const b = BOX[i];

    const bits = [];
    for (let m = bestMask; m; m &= m - 1) bits.push(m & -m);
    if (rng) shuffle(bits, rng);

    for (const bit of bits) {
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      cells[i] = 32 - Math.clz32(bit);
      const stop = rec(k + 1);
      rows[r] ^= bit;
      cols[c] ^= bit;
      boxes[b] ^= bit;
      cells[i] = 0;
      if (stop) return true;
    }
    return false;
  };

  rec(0);
  return count;
}

/** True when no two givens clash and every value is 0–9. */
export function isValidGrid(grid) {
  return grid.length === 81 && setup(grid) !== null;
}

/**
 * Number of solutions, counting stops at `limit` (default 2: "zero, one or many").
 * onSolution receives a copy of each solution found.
 */
export function countSolutions(grid, limit = 2, onSolution) {
  const state = setup(grid);
  if (!state) return 0;
  return search(state, limit, null, onSolution && ((cells) => onSolution(Array.from(cells))));
}

/** First solution, or null. */
export function solve(grid) {
  let solution = null;
  countSolutions(grid, 1, (s) => (solution = s));
  return solution;
}

/** A complete random grid via randomized backtracking. */
export function randomFullGrid(rng) {
  const state = setup(new Array(81).fill(0));
  let grid = null;
  search(state, 1, rng, (cells) => (grid = Array.from(cells)));
  return grid;
}
