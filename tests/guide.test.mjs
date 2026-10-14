// The Tanks field guide (guide/, published as an artifact) is built from the game's own
// sources. This fails when the game changes in a way the guide can't follow, such as an
// enemy kind with no text or scene in guide/enemies.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMap } from '../src/games/tanks/mapcheck.js';
import { buildGuide, bundle } from '../scripts/guide.mjs';
import { createWorld, parseLevel, step } from '../src/games/tanks/engine.js';
import { MISSIONS, testMap } from '../src/games/tanks/missions.js';
import { ENEMY_KINDS, STEP, TYPES } from '../src/games/tanks/rules.js';

test('the field guide builds from the game and covers every enemy kind', async () => {
  const { html, data } = await buildGuide();
  assert.deepEqual(Object.keys(data.info), ENEMY_KINDS);
  assert.deepEqual(Object.keys(data.scenes).sort(), [...ENEMY_KINDS].sort());
  assert.deepEqual(data.types, TYPES);
  assert.equal(data.missions.length, MISSIONS.length);
  assert.equal(data.names.length, MISSIONS.length);
  assert.ok(data.names.every(Boolean) && data.briefs.every(Boolean), 'every mission has a name and a briefing');
  for (const k of ['player', ...ENEMY_KINDS]) assert.match(html, new RegExp(`--tk-${k}:\\s*#`), `colour for ${k}`);
  assert.doesNotMatch(html, /__DATA__|\/\*__MODULES__\*\/|\/\*TK_(LIGHT|DARK)\*\/|\{\{\w+\}\}/);
  assert.ok(html.indexOf('<title>') < 8192, 'the title is in the first 8 KB');
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script), 'the page script parses');
});

test('the game code bundled into the guide behaves exactly like the game', async () => {
  const MOD = new Function(`${await bundle()}\nreturn MOD;`)();
  // A mission with missiles, mortars, mines and every AI path running: same seed, same world.
  const n = MISSIONS.length - 1;
  const script = (i) => ({ mx: Math.sin(i / 70), my: Math.cos(i / 50), aim: i / 35, fire: i % 40 === 0, mine: i === 60 });
  const a = createWorld(parseLevel(MISSIONS[n]), { seed: 11 });
  const b = MOD.engine.createWorld(MOD.engine.parseLevel(MISSIONS[n]), { seed: 11 });
  for (let i = 0; i < 120 * 8; i++) {
    step(a, script(i), STEP);
    MOD.engine.step(b, script(i), STEP);
  }
  assert.equal(JSON.stringify(b), JSON.stringify(a));
  // And the test range full of miniguns, whose barrels spin up and spray. You start above the
  // walls, in plain sight, so they get going at once.
  const range = testMap('lime', 6).map((line, r) => (r === 7 ? `.${line.slice(1)}` : r === 2 ? `@${line.slice(1)}` : line));
  const c = createWorld(parseLevel(range), { seed: 4 });
  const d = MOD.engine.createWorld(MOD.engine.parseLevel(range), { seed: 4 });
  // You drive without firing, so your own ricochets don't end it before they get going.
  const drive = (i) => ({ ...script(i), fire: false, mine: false });
  let spun = false;
  for (let i = 0; i < 120 * 8; i++) {
    step(c, drive(i), STEP);
    MOD.engine.step(d, drive(i), STEP);
    spun ||= c.tanks.some((t) => t.spin > 0);
  }
  assert.ok(spun, 'a minigun spun up');
  assert.equal(JSON.stringify(d), JSON.stringify(c));
  for (const rows of MISSIONS) assert.deepEqual(MOD.mapcheck.checkMap(rows), checkMap(rows));
  assert.deepEqual(Object.keys(MOD.art).sort(), Object.keys(await import('../src/games/tanks/art.js')).sort());
});
