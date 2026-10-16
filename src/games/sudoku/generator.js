// Puzzle generation: a random full grid, then symmetric pairs removed one by one while the puzzle
// keeps exactly one solution. Every step on the way down is a puzzle of its own, so one pass
// gives a ladder of them on one solution: an easier rung holds every given of a harder one plus
// a pair more. The difficulty slider walks that ladder, so where the numbers will be is known
// before the puzzle starts. Seeded, so a seed reproduces its ladder.
import { countSolutions, randomFullGrid, shuffle } from './solver.js';

/** Givens per difficulty, inclusive. The ranges meet, so every rung has a difficulty. */
export const LEVELS = {
  easy: [38, 42],
  medium: [32, 37],
  hard: [28, 31],
  expert: [24, 27],
};

/** The slider's ends: Expert's fewest givens and Easy's most. */
export const MIN_GIVENS = LEVELS.expert[0];
export const MAX_GIVENS = LEVELS.easy[1];

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
 * Returns { seed, solution, steps, attempts }: solution is an 81-character string and steps the
 * pairs of cells removed from it, in order. Removal stops short of MIN_GIVENS and always reaches
 * Expert, so every difficulty has at least one rung.
 */
export function ladder(seed) {
  const rng = mulberry32(seed);

  for (let attempt = 1; attempt <= 1000; attempt++) {
    const solution = randomFullGrid(rng);
    const puzzle = solution.slice();
    const steps = [];
    let givens = 81;

    for (const pair of shuffle(symmetricPairs(), rng)) {
      if (givens - pair.length < MIN_GIVENS) continue;
      for (const i of pair) puzzle[i] = 0;
      if (countSolutions(puzzle, 2) === 1) {
        givens -= pair.length;
        steps.push(pair);
      } else {
        for (const i of pair) puzzle[i] = solution[i];
      }
    }

    // A pair that can't go now never can (fewer givens only add solutions), so one pass ends at a
    // local minimum. When that is above Expert, try another grid.
    if (givens <= LEVELS.expert[1]) return { seed, solution: toString(solution), steps, attempts: attempt };
  }
  throw new Error(`Could not build a ladder for seed ${seed}`);
}

/**
 * The rungs the slider offers, easiest first: { givens, puzzle } for every step of the ladder
 * with MIN_GIVENS to MAX_GIVENS givens. puzzle is an 81-character string, 0 for empty.
 */
export function rungs({ solution, steps }) {
  const grid = Array.from(solution, Number);
  const out = [];
  let givens = 81;
  for (const pair of steps) {
    for (const i of pair) grid[i] = 0;
    givens -= pair.length;
    if (givens <= MAX_GIVENS && givens >= MIN_GIVENS) out.push({ givens, puzzle: toString(grid) });
  }
  return out;
}

/** The difficulty a puzzle with this many givens counts as. */
export function levelOf(givens) {
  for (const [id, [min, max]] of Object.entries(LEVELS)) if (givens >= min && givens <= max) return id;
  return givens > MAX_GIVENS ? 'easy' : 'expert';
}
