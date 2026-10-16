import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS, MAX_GIVENS, MIN_GIVENS, ladder, levelOf, rungs } from '../src/games/sudoku/generator.js';

// Independent, deliberately plain solver so the generator isn't checked with its own code.
function countSolutionsNaive(grid, limit = 2) {
  const g = grid.slice();
  const candidates = (i) => {
    const r = Math.floor(i / 9);
    const c = i % 9;
    const used = new Set();
    for (let k = 0; k < 9; k++) {
      used.add(g[r * 9 + k]);
      used.add(g[k * 9 + c]);
    }
    const br = r - (r % 3);
    const bc = c - (c % 3);
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) used.add(g[(br + dr) * 9 + bc + dc]);
    const out = [];
    for (let d = 1; d <= 9; d++) if (!used.has(d)) out.push(d);
    return out;
  };
  let count = 0;
  const rec = () => {
    let best = -1;
    let bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const cands = candidates(i);
      if (!bestCands || cands.length < bestCands.length) {
        best = i;
        bestCands = cands;
        if (cands.length < 2) break;
      }
    }
    if (best < 0) {
      count++;
      return count >= limit;
    }
    for (const d of bestCands) {
      g[best] = d;
      if (rec()) return true;
    }
    g[best] = 0;
    return false;
  };
  rec();
  return count;
}

function isCompleteValid(grid) {
  const ok = (cells) => cells.map((i) => grid[i]).sort().join('') === '123456789';
  for (let k = 0; k < 9; k++) {
    const row = [...Array(9)].map((_, j) => k * 9 + j);
    const col = [...Array(9)].map((_, j) => j * 9 + k);
    const box = [...Array(9)].map((_, j) => (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3));
    if (!ok(row) || !ok(col) || !ok(box)) return false;
  }
  return true;
}

const LADDERS = 200;

test(`${LADDERS} ladders: every difficulty has a rung, rungs nest, and each one has exactly one solution`, () => {
  for (let n = 0; n < LADDERS; n++) {
    const seed = (n * 2654435761 + 7) >>> 0;
    const lad = ladder(seed);
    const s = Array.from(lad.solution, Number);
    assert.ok(isCompleteValid(s), `seed ${seed}: solution is not a valid grid`);

    const list = rungs(lad);
    assert.ok(list.length >= 4, `seed ${seed}: only ${list.length} rungs`);
    let prev = null;
    for (const { givens, puzzle } of list) {
      const p = Array.from(puzzle, Number);
      assert.equal(puzzle.length, 81);
      assert.equal(p.filter(Boolean).length, givens);
      assert.ok(givens >= MIN_GIVENS && givens <= MAX_GIVENS, `seed ${seed}: ${givens} givens off the slider`);
      p.forEach((v, i) => v && assert.equal(v, s[i], `seed ${seed}: given disagrees with solution`));
      // Removals are symmetric pairs: cell i is empty iff cell 80 - i is.
      p.forEach((v, i) => assert.equal(!v, !p[80 - i], `seed ${seed}: not symmetric at ${i}`));
      if (prev) {
        // Easiest first: each rung keeps only givens the one before it had, one pair fewer.
        assert.ok(givens < prev.givens && prev.givens - givens <= 2, `seed ${seed}: ${prev.givens} -> ${givens}`);
        p.forEach((v, i) => v && assert.ok(prev.p[i], `seed ${seed}: rung ${givens} gives a cell rung ${prev.givens} hid`));
      }
      prev = { givens, p };
    }

    // A puzzle whose givens hold a unique puzzle's is unique too, so the sparsest rung of each
    // difficulty vouches for every rung above it. Checked with the independent solver.
    for (const [level, [min, max]] of Object.entries(LEVELS)) {
      const mine = list.filter((r) => r.givens >= min && r.givens <= max);
      assert.ok(mine.length, `seed ${seed}: no ${level} rung`);
      for (const r of mine) assert.equal(levelOf(r.givens), level);
      const hardest = Array.from(mine.at(-1).puzzle, Number);
      assert.equal(countSolutionsNaive(hardest), 1, `${level} seed ${seed} is not unique`);
    }
  }
});

test('the difficulty ranges meet, so every count on the slider has one', () => {
  for (let g = MIN_GIVENS; g <= MAX_GIVENS; g++) {
    const owners = Object.values(LEVELS).filter(([min, max]) => g >= min && g <= max);
    assert.equal(owners.length, 1, `${g} givens`);
  }
  assert.equal(levelOf(MAX_GIVENS + 5), 'easy');
  assert.equal(levelOf(MIN_GIVENS - 5), 'expert');
});

test('a seed reproduces the same ladder', () => {
  assert.deepEqual(ladder(12345), ladder(12345));
  assert.notEqual(ladder(1).solution, ladder(2).solution);
});
