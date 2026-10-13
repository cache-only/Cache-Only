// Pure 2048 rules, no DOM. Grid: array of 16 numbers, row-major, 0 = empty.
export const SIZE = 4;
export const WIN = 2048;
export const DIRECTIONS = ['up', 'down', 'left', 'right'];

/** Cell indexes per line, ordered from the edge the tiles move toward. */
export function lines(dir) {
  const out = [];
  for (let a = 0; a < SIZE; a++) {
    const line = [];
    for (let b = 0; b < SIZE; b++) {
      if (dir === 'left') line.push(a * SIZE + b);
      else if (dir === 'right') line.push(a * SIZE + (SIZE - 1 - b));
      else if (dir === 'up') line.push(b * SIZE + a);
      else if (dir === 'down') line.push((SIZE - 1 - b) * SIZE + a);
      else throw new Error(`Unknown direction: ${dir}`);
    }
    out.push(line);
  }
  return out;
}

/**
 * Slides one line toward index 0. Each tile merges at most once per move and
 * merges resolve from the leading edge: [2,2,2,2] -> [4,4,0,0], [2,2,2,0] -> [4,2,0,0].
 * Returns { values, gained, moves: [{ from, to, merged }] } with positions within the line.
 */
export function slideLine(values) {
  const out = new Array(values.length).fill(0);
  const moves = [];
  let gained = 0;
  let last = -1;
  let lastCanMerge = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!v) continue;
    if (lastCanMerge && out[last] === v) {
      out[last] = v * 2;
      gained += v * 2;
      lastCanMerge = false;
      moves[moves.length - 1].merged = true;
      moves.push({ from: i, to: last, merged: true });
    } else {
      last++;
      out[last] = v;
      lastCanMerge = true;
      moves.push({ from: i, to: last, merged: false });
    }
  }
  return { values: out, gained, moves };
}

/**
 * Applies a move to the whole grid without spawning.
 * Returns { grid, gained, moved, transitions: [{ from, to, merged }] } with grid indexes.
 */
export function move(grid, dir) {
  const next = grid.slice();
  const transitions = [];
  let gained = 0;
  for (const idx of lines(dir)) {
    const res = slideLine(idx.map((i) => grid[i]));
    res.values.forEach((v, k) => (next[idx[k]] = v));
    gained += res.gained;
    for (const m of res.moves) transitions.push({ from: idx[m.from], to: idx[m.to], merged: m.merged });
  }
  const moved = next.some((v, i) => v !== grid[i]);
  return { grid: next, gained, moved, transitions };
}

/** Adds a 2 (90%) or a 4 (10%) on a random empty cell. */
export function spawn(grid, rng = Math.random) {
  const empty = [];
  grid.forEach((v, i) => v || empty.push(i));
  if (!empty.length) return { grid, index: -1, value: 0 };
  const index = empty[Math.floor(rng() * empty.length)];
  const value = rng() < 0.9 ? 2 : 4;
  const next = grid.slice();
  next[index] = value;
  return { grid: next, index, value };
}

export function canMove(grid) {
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i]) return true;
    const c = i % SIZE;
    if (c < SIZE - 1 && grid[i] === grid[i + 1]) return true;
    if (i + SIZE < grid.length && grid[i] === grid[i + SIZE]) return true;
  }
  return false;
}

export function newGame(rng = Math.random, best = 0) {
  let grid = new Array(SIZE * SIZE).fill(0);
  grid = spawn(grid, rng).grid;
  grid = spawn(grid, rng).grid;
  return { grid, score: 0, best, won: false, keepPlaying: false, over: false, undo: null };
}

/**
 * One player move. A move that changes nothing returns the same state and spawns nothing.
 * Returns { state, moved, transitions?, spawn?, gained? }.
 */
export function step(state, dir, rng = Math.random) {
  const res = move(state.grid, dir);
  if (!res.moved) return { state, moved: false };
  const sp = spawn(res.grid, rng);
  const score = state.score + res.gained;
  return {
    moved: true,
    gained: res.gained,
    transitions: res.transitions,
    spawn: { index: sp.index, value: sp.value },
    state: {
      grid: sp.grid,
      score,
      best: Math.max(state.best, score),
      won: state.won || sp.grid.some((v) => v >= WIN),
      keepPlaying: state.keepPlaying,
      over: !canMove(sp.grid),
      undo: { grid: state.grid, score: state.score, won: state.won, keepPlaying: state.keepPlaying },
    },
  };
}

/** Single-step undo: restores the snapshot and drops it. Best score is kept. */
export function undo(state) {
  const u = state.undo;
  if (!u) return state;
  return { ...state, grid: u.grid.slice(), score: u.score, won: u.won, keepPlaying: u.keepPlaying, over: false, undo: null };
}
