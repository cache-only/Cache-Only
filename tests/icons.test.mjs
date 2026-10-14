// The pixel icons (shared/icons.js) and the pixel logo (shared/logo.js): every icon a page or
// script asks for exists and fits its rounded-square button, and the logo keeps its mark.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ICONS, SHAPES, iconMarkup } from '../src/shared/icons.js';
import { MARK } from '../src/shared/logo.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

test('every icon is 9 x 9 with its corner pixels dark', () => {
  for (const [name, rows] of Object.entries(ICONS)) {
    assert.equal(rows.length, 9, name);
    for (const row of rows) assert.match(row, /^[.#+]{9}$/, name);
    for (const [y, x] of [[0, 0], [0, 8], [8, 0], [8, 8]]) {
      assert.equal(rows[y][x], '.', `${name}: the corner pixel ${x},${y} falls outside an .icon-btn`);
    }
    assert.match(iconMarkup(rows), /^<path d="M[^"]+"\/>/, `${name} draws something`);
  }
});

test('every icon a page or script uses exists, and no page carries its own sprite', async () => {
  const files = (await walk(SRC)).filter((f) => /\.(html|js)$/.test(f) && !f.endsWith('shared/icons.js'));
  const used = new Set();
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/(?:#|['"])i-([a-z][a-z0-9-]*)/g)) used.add(m[1]);
    if (file.endsWith('.html')) assert.doesNotMatch(text, /<symbol\b/, `${path.relative(SRC, file)}: icons come from shared/icons.js`);
  }
  assert.ok(used.size > 10, 'found the icon references');
  for (const name of used) assert.ok(ICONS[name] || SHAPES[name], `#i-${name} is used but not in shared/icons.js`);
  for (const name of Object.keys(SHAPES)) assert.ok(!ICONS[name], `#i-${name} is both a pixel icon and a shape`);
});

test('the logo is the solid 11 x 13 cent sign', () => {
  assert.deepEqual(MARK, [
    '.....##....',
    '..########.',
    '.##########',
    '###..##..##',
    '##...##....',
    '##...##....',
    '##...##....',
    '##...##....',
    '##...##....',
    '###..##..##',
    '.##########',
    '..########.',
    '.....##....',
  ]);
});
