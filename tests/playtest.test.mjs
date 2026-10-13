// The Tanks playtest bot (scripts/playtest.mjs) drives the game's own engine, so an engine
// change can quietly break it. This keeps it working. Floating point differs in the last bit
// between platforms and a battle amplifies that, so it asks for wins most of the time rather
// than one exact outcome.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playtest, readMap } from '../scripts/playtest.mjs';
import { MISSIONS } from '../src/games/tanks/missions.js';

test('the expert playtest bot wins the first mission, and blasts its way into the crate vault', () => {
  const first = playtest(MISSIONS[0], { seeds: 3 });
  assert.ok(first.wins >= 2, `won ${first.wins} of 3`);
  // Crate gate: its turret is sealed in crates, so winning means mining them open.
  const vault = playtest(MISSIONS[3], { seeds: 3 });
  assert.ok(vault.wins >= 2, `won ${vault.wins} of 3`);
  assert.equal(vault.stalls, 0, 'no run ran out of time');
});

test('the casual bot plays a mission to the end and says what destroyed it', () => {
  const r = playtest(MISSIONS[19], { seeds: 2, casual: true });
  assert.equal(r.runs, 2);
  assert.ok(Number.isFinite(r.time) && r.time > 0);
  const losses = Object.values(r.killers).reduce((a, b) => a + b, 0);
  assert.equal(losses, r.deaths, 'every life lost has a cause');
});

test('a map reads from the editor’s copy or from plain rows', () => {
  const rows = MISSIONS[0];
  const copied = `  // My draft\n  [\n${rows.map((line) => `    '${line}',`).join('\n')}\n  ],\n`;
  assert.deepEqual(readMap(copied), rows);
  assert.deepEqual(readMap(rows.join('\n')), rows);
});
