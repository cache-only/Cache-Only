// The Tanks field guide (guide/, published as an artifact) is built from the game's own
// sources. This fails when the game changes in a way the guide can't follow, such as an
// enemy kind with no text or scene in guide/enemies.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGuide } from '../scripts/guide.mjs';
import { ENEMY_KINDS, TYPES } from '../src/games/tanks/rules.js';
import { MISSIONS } from '../src/games/tanks/missions.js';

test('the field guide builds from the game and covers every enemy kind', async () => {
  const { html, data } = await buildGuide();
  assert.deepEqual(Object.keys(data.info), ENEMY_KINDS);
  assert.deepEqual(Object.keys(data.scenes).sort(), [...ENEMY_KINDS].sort());
  assert.deepEqual(data.types, TYPES);
  assert.equal(data.missions.length, MISSIONS.length);
  for (const k of ['player', ...ENEMY_KINDS]) assert.match(html, new RegExp(`--tk-${k}:\\s*#`), `colour for ${k}`);
  assert.doesNotMatch(html, /__DATA__|\/\*TK_(LIGHT|DARK)\*\/|\{\{\w+\}\}/);
  assert.ok(html.indexOf('<title>') < 8192, 'the title is in the first 8 KB');
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script), 'the page script parses');
});
