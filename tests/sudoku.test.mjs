import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS, analyze, generate } from '../src/games/sudoku/generator.js';

const PER_LEVEL = 200;

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

for (const [level, [min, max]] of Object.entries(LEVELS)) {
  test(`${level}: ${PER_LEVEL} generated puzzles each have exactly one solution`, () => {
    for (let n = 0; n < PER_LEVEL; n++) {
      const seed = (n * 2654435761 + level.length) >>> 0;
      const { puzzle, solution, givens } = generate(level, seed);
      const p = Array.from(puzzle, Number);
      const s = Array.from(solution, Number);

      assert.equal(puzzle.length, 81);
      assert.equal(p.filter(Boolean).length, givens);
      assert.ok(givens >= min && givens <= max, `${level} seed ${seed}: ${givens} givens outside ${min}-${max}`);
      assert.ok(isCompleteValid(s), `seed ${seed}: solution is not a valid grid`);
      p.forEach((v, i) => v && assert.equal(v, s[i], `seed ${seed}: given disagrees with solution`));
      // Removals are symmetric pairs: cell i is empty iff cell 80 - i is.
      p.forEach((v, i) => assert.equal(!v, !p[80 - i], `seed ${seed}: not symmetric at ${i}`));
      assert.equal(countSolutionsNaive(p), 1, `${level} seed ${seed} is not unique`);
    }
  });
}

test('a seed reproduces the same puzzle', () => {
  for (const level of Object.keys(LEVELS)) {
    assert.deepEqual(generate(level, 12345), generate(level, 12345));
  }
  assert.notEqual(generate('medium', 1).puzzle, generate('medium', 2).puzzle);
});

test('analyze accepts a unique puzzle and rejects bad ones', () => {
  const { puzzle, solution } = generate('hard', 99);
  const ok = analyze(puzzle);
  assert.equal(ok.solution, solution);

  assert.equal(analyze(puzzle.replace(/0/g, '.')).solution, solution, 'dots mean empty');
  assert.equal(analyze(puzzle.match(/.{9}/g).join('\n')).solution, solution, 'whitespace is ignored');
  assert.deepEqual(analyze(puzzle.slice(0, 80)), { error: 'length', n: 80 });
  assert.deepEqual(analyze(puzzle.slice(0, 80) + 'x'), { error: 'chars' });
  assert.deepEqual(analyze('0'.repeat(81)), { error: 'multiple' });

  // Two 5s in the first row.
  assert.deepEqual(analyze('55' + '0'.repeat(79)), { error: 'conflict' });

  // Remove givens from a unique puzzle until it has several solutions.
  const loose = Array.from(puzzle);
  for (let i = 0; i < 81 && analyze(loose.join('')).error !== 'multiple'; i++) loose[i] = '0';
  assert.equal(analyze(loose.join('')).error, 'multiple');

  // No conflicting givens but no solution: row 0 needs a 9 in its last cell,
  // and column 8 already has a 9 further down.
  const dead = Array(81).fill(0);
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((d, i) => (dead[i] = d));
  dead[9 * 4 + 8] = 9;
  assert.deepEqual(analyze(dead.join('')), { error: 'none' });
});
