import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMove, move, newGame, slideLine, spawn, step, undo } from '../src/games/2048/logic.js';

const slide = (values) => slideLine(values).values;

// Fixed sequence PRNG for reproducible spawns.
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test('merge rules on a single line', () => {
  assert.deepEqual(slide([2, 2, 2, 2]), [4, 4, 0, 0], 'each pair merges once');
  assert.deepEqual(slide([2, 2, 2, 0]), [4, 2, 0, 0], 'merges resolve from the leading edge');
  assert.deepEqual(slide([4, 4, 8, 0]), [8, 8, 0, 0], 'a merged tile does not merge again');
  assert.deepEqual(slide([4, 4, 8, 8]), [8, 16, 0, 0]);
  assert.deepEqual(slide([2, 0, 0, 2]), [4, 0, 0, 0], 'merges across gaps');
  assert.deepEqual(slide([0, 0, 0, 2]), [2, 0, 0, 0]);
  assert.deepEqual(slide([2, 4, 2, 4]), [2, 4, 2, 4], 'no equal neighbours, no change');
  assert.deepEqual(slide([8, 8, 8, 0]), [16, 8, 0, 0]);
  assert.deepEqual(slide([2, 2, 4, 4]), [4, 8, 0, 0]);
  assert.deepEqual(slide([0, 0, 0, 0]), [0, 0, 0, 0]);
});

test('score gained equals the sum of merged tiles', () => {
  assert.equal(slideLine([2, 2, 2, 2]).gained, 8);
  assert.equal(slideLine([4, 4, 8, 0]).gained, 8);
  assert.equal(slideLine([2, 4, 8, 16]).gained, 0);
});

test('all four directions', () => {
  const row = (values) => [...values, ...Array(12).fill(0)];
  // [2,2,2] moving left -> [4,2]
  assert.deepEqual(move(row([2, 2, 2, 0]), 'left').grid.slice(0, 4), [4, 2, 0, 0]);
  // [2,2,2] moving right -> [_,_,2,4]: the merge happens at the right edge.
  assert.deepEqual(move(row([0, 2, 2, 2]), 'right').grid.slice(0, 4), [0, 0, 2, 4]);
  assert.deepEqual(move(row([2, 2, 2, 2]), 'right').grid.slice(0, 4), [0, 0, 4, 4]);

  const col = (values) => {
    const g = Array(16).fill(0);
    values.forEach((v, r) => (g[r * 4] = v));
    return g;
  };
  const column = (g) => [g[0], g[4], g[8], g[12]];
  assert.deepEqual(column(move(col([2, 2, 2, 0]), 'up').grid), [4, 2, 0, 0]);
  assert.deepEqual(column(move(col([2, 2, 2, 0]), 'down').grid), [0, 0, 2, 4]);
  assert.deepEqual(column(move(col([2, 2, 2, 2]), 'down').grid), [0, 0, 4, 4]);
});

test('transitions describe every tile for the animation', () => {
  const g = [2, 2, 0, 4, ...Array(12).fill(0)];
  const { transitions } = move(g, 'left');
  assert.deepEqual(
    transitions.sort((a, b) => a.from - b.from),
    [
      { from: 0, to: 0, merged: true },
      { from: 1, to: 0, merged: true },
      { from: 3, to: 1, merged: false },
    ],
  );
});

test('a move that changes nothing does not spawn a tile', () => {
  const grid = [2, 4, 8, 16, ...Array(12).fill(0)];
  const state = { grid, score: 10, best: 10, won: false, keepPlaying: false, over: false, undo: null };
  const res = step(state, 'left', seq(0, 0));
  assert.equal(res.moved, false);
  assert.equal(res.state, state);
  assert.equal(res.state.grid.filter(Boolean).length, 4);
});

test('a valid move spawns exactly one tile and records an undo snapshot', () => {
  const grid = [2, 2, 0, 0, ...Array(12).fill(0)];
  const state = { grid, score: 0, best: 0, won: false, keepPlaying: false, over: false, undo: null };
  const res = step(state, 'left', seq(0, 0.5));
  assert.equal(res.moved, true);
  assert.equal(res.state.score, 4);
  assert.equal(res.state.best, 4);
  assert.equal(res.state.grid.filter(Boolean).length, 2);
  assert.deepEqual(res.state.undo.grid, grid);
  const back = undo(res.state);
  assert.deepEqual(back.grid, grid);
  assert.equal(back.score, 0);
  assert.equal(back.best, 4, 'best survives undo');
  assert.equal(back.undo, null, 'undo is single-step');
});

test('spawn picks 2 at 90% and 4 at 10%', () => {
  const empty = Array(16).fill(0);
  assert.equal(spawn(empty, seq(0, 0.89)).value, 2);
  assert.equal(spawn(empty, seq(0, 0.9)).value, 4);
  let fours = 0;
  const rng = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  })();
  for (let i = 0; i < 20000; i++) if (spawn(empty, rng).value === 4) fours++;
  assert.ok(fours > 1600 && fours < 2400, `got ${fours} fours in 20000`);
});

test('reaching 2048 sets won; a full locked board is over', () => {
  const g = [1024, 1024, 0, 0, ...Array(12).fill(0)];
  const res = step({ grid: g, score: 0, best: 0, won: false, keepPlaying: false, over: false, undo: null }, 'left', seq(0.99, 0));
  assert.equal(res.state.won, true);

  const locked = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  assert.equal(canMove(locked), false);
  assert.equal(canMove([...locked.slice(0, 15), 0]), true);
  const almost = [...locked];
  almost[15] = 8;
  almost[14] = 8;
  assert.equal(canMove(almost), true);
});

test('a new game starts with two tiles', () => {
  const s = newGame(Math.random, 500);
  assert.equal(s.grid.filter(Boolean).length, 2);
  assert.equal(s.best, 500);
  assert.equal(s.score, 0);
});
