// Saves: a game gone from the registry takes its saves with it, and nothing else goes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

class FakeStorage {
  map = new Map();
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

globalThis.localStorage = new FakeStorage();
const { dropSavesExcept } = await import('../src/shared/storage.js');

test('only the saves of games not listed are dropped', () => {
  const keys = ['gh:app:lang', 'gh:app:plays', 'gh:sudoku:session', 'gh:tanks:maps', 'gh:retired:session', 'gh:retired:best', 'other:key'];
  for (const k of keys) localStorage.setItem(k, '{"schema":1,"data":1}');
  dropSavesExcept(['sudoku', 'tanks']);
  assert.deepEqual([...localStorage.map.keys()], ['gh:app:lang', 'gh:app:plays', 'gh:sudoku:session', 'gh:tanks:maps', 'other:key']);
});
