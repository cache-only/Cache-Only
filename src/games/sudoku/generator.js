// Puzzle generation: random full grid, then remove symmetric pairs while the
// puzzle keeps exactly one solution. Seeded, so a seed reproduces its puzzle.
import { countSolutions, isValidGrid, randomFullGrid, shuffle } from './solver.js';

/** Target number of givens per difficulty, inclusive. */
export const LEVELS = {
  easy: [38, 42],
  medium: [32, 36],
  hard: [28, 31],
  expert: [24, 27],
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toString = (grid) => grid.join('');

// Cell i pairs with its 180° rotation 80 - i; the centre (40) is its own pair.
function symmetricPairs() {
  const pairs = [];
  for (let i = 0; i < 40; i++) pairs.push([i, 80 - i]);
  pairs.push([40]);
  return pairs;
}

/**
 * Returns { puzzle, solution, givens, difficulty, seed, attempts }.
 * puzzle and solution are 81-character strings with 0 for empty cells.
 */
export function generate(difficulty, seed) {
  const range = LEVELS[difficulty];
  if (!range) throw new Error(`Unknown difficulty: ${difficulty}`);
  const [min, max] = range;
  const rng = mulberry32(seed);

  for (let attempt = 1; attempt <= 1000; attempt++) {
    const solution = randomFullGrid(rng);
    const puzzle = solution.slice();
    const target = min + Math.floor(rng() * (max - min + 1));
    let givens = 81;

    for (const pair of shuffle(symmetricPairs(), rng)) {
      if (givens <= target) break;
      if (givens - pair.length < min) continue;
      for (const i of pair) puzzle[i] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        givens -= pair.length;
      } else {
        for (const i of pair) puzzle[i] = solution[i];
      }
    }

    // Removal can stall above the range on some grids (a local minimum); try another grid.
    if (givens >= min && givens <= max) {
      return { puzzle: toString(puzzle), solution: toString(solution), givens, difficulty, seed, attempts: attempt };
    }
  }
  throw new Error(`Could not generate a ${difficulty} puzzle for seed ${seed}`);
}

/**
 * Validates a shared puzzle string. Accepts 0 or . for empty cells and ignores whitespace.
 * Returns { puzzle, solution, givens } or { error: 'chars' | 'length' | 'conflict' | 'none' | 'multiple', n? }.
 */
export function analyze(text) {
  const cleaned = String(text ?? '').replace(/\s+/g, '');
  if (/[^0-9.]/.test(cleaned)) return { error: 'chars' };
  if (cleaned.length !== 81) return { error: 'length', n: cleaned.length };
  const grid = Array.from(cleaned, (ch) => (ch === '.' ? 0 : Number(ch)));
  if (!isValidGrid(grid)) return { error: 'conflict' };
  let solution = null;
  const count = countSolutions(grid, 2, (s) => (solution ??= s));
  if (count === 0) return { error: 'none' };
  if (count > 1) return { error: 'multiple' };
  return { puzzle: toString(grid), solution: toString(solution), givens: grid.filter(Boolean).length };
}
