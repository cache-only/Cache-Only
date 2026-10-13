// Builds the Tanks field guide (guide/page.html) into guide/out/tanks-field-guide.html.
// Everything game-specific is read from the game itself: stats, kinds and spawn letters
// from rules.js, maps from missions.js, names from i18n.js, starting lives from tanks.js
// and colours from the game's styles.css. The guide is not part of the app and never
// ships in a pack. After building, republish the output to the artifact (see CLAUDE.md).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TANKS = path.join(ROOT, 'src/games/tanks');
const GUIDE = path.join(ROOT, 'guide');
export const OUT = path.join(GUIDE, 'out/tanks-field-guide.html');
export const ARTIFACT_URL = 'https://claude.ai/artifact/YKPsuThAVXPnPLm4Wwa5gN';

const load = (file) => import(pathToFileURL(file).href);

/** The first `--tk-*` declarations in the block that `opener` starts, as CSS text. */
function tokens(css, opener) {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`guide: "${opener}" not found in tanks/styles.css`);
  const body = css.slice(start + opener.length, css.indexOf('}', start + opener.length));
  const decls = body.match(/--tk-[\w-]+:\s*[^;]+;/g) || [];
  if (!decls.length) throw new Error('guide: no --tk-* tokens found in tanks/styles.css');
  return decls;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Builds the page and returns { html, data }. Throws if the game and the guide disagree. */
export async function buildGuide() {
  const R = await load(path.join(TANKS, 'rules.js'));
  const M = await load(path.join(TANKS, 'missions.js'));
  const { enemyText, SCENES } = await load(path.join(GUIDE, 'enemies.mjs'));
  const i18n = await readFile(path.join(ROOT, 'src/shared/i18n.js'), 'utf8');
  const tanksJs = await readFile(path.join(TANKS, 'tanks.js'), 'utf8');
  const css = await readFile(path.join(TANKS, 'styles.css'), 'utf8');
  const page = await readFile(path.join(GUIDE, 'page.html'), 'utf8');

  // English strings: the en block comes first in i18n.js.
  const english = (key) => {
    const m = i18n.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*(['"])(.*?)\\1`));
    if (!m) throw new Error(`guide: no English string "${key}" in i18n.js`);
    return m[2];
  };
  const lives = Number((tanksJs.match(/const LIVES = (\d+);/) || [])[1]);
  if (!lives) throw new Error('guide: const LIVES not found in tanks.js');

  const light = tokens(css, '.page-tanks {');
  const dark = tokens(css, '@media (prefers-color-scheme: dark) {\n  .page-tanks {');
  const color = Object.fromEntries(light.map((d) => d.match(/(--tk-[\w-]+):\s*([^;]+);/).slice(1)));

  const kinds = R.ENEMY_KINDS;
  const text = enemyText({
    T: R.TYPES,
    kinds,
    R: { blastR: R.BLAST_R, opening: R.OPENING },
    name: (k) => english(`tanks.type.${k}`),
    note: english,
  });
  const info = {};
  const ink = {};
  for (const k of ['player', ...kinds]) {
    const hex = color[`--tk-${k}`];
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) throw new Error(`guide: no hex colour --tk-${k} in tanks/styles.css`);
    // Dark text unless light text has more contrast on this tank colour.
    const L = luminance(hex);
    ink[k] = (L + 0.05) / (luminance('#16181d') + 0.05) >= 1.05 / (L + 0.05) ? 'dark' : 'light';
    if (k === 'player') continue;
    if (!text[k]) throw new Error(`guide: enemy kind "${k}" has no text in guide/enemies.mjs`);
    if (!SCENES[k]) throw new Error(`guide: enemy kind "${k}" has no scene in guide/enemies.mjs`);
    info[k] = { name: english(`tanks.type.${k}`), ...text[k](R.TYPES[k]) };
    const flat = JSON.stringify(info[k]);
    if (/undefined|NaN|Infinity/.test(flat)) throw new Error(`guide: text for "${k}" has a missing value: ${flat}`);
  }
  for (const k of Object.keys(SCENES)) if (!kinds.includes(k)) throw new Error(`guide: scene for unknown kind "${k}"`);

  const data = {
    types: R.TYPES,
    kinds,
    spawn: R.SPAWN_CODES,
    codes: Object.fromEntries(Object.entries(R.SPAWN_CODES).map(([ch, k]) => [k, ch])),
    missions: M.MISSIONS,
    checkpoints: M.CHECKPOINTS,
    bonusAfter: M.BONUS_AFTER,
    cols: R.COLS,
    rows: R.ROWS,
    muzzle: R.MUZZLE,
    opening: R.OPENING,
    blastR: R.BLAST_R,
    lives,
    info,
    scenes: SCENES,
    ink,
  };
  const cps = M.CHECKPOINTS.map(String);
  const fill = {
    MISSIONS: M.MISSIONS.length,
    KINDS: kinds.length,
    COLS: R.COLS,
    ROWS: R.ROWS,
    CHECKPOINTS: cps.length > 1 ? `${cps.slice(0, -1).join(', ')} and ${cps.at(-1)}` : cps.join(''),
  };
  let html = page
    .replace('/*TK_LIGHT*/', light.join('\n    '))
    .replaceAll('/*TK_DARK*/', dark.join(' '))
    .replace(/\{\{(\w+)\}\}/g, (m, key) => {
      if (!(key in fill)) throw new Error(`guide: unknown placeholder ${m}`);
      return String(fill[key]);
    });
  const slot = 'const DATA = __DATA__;';
  if (html.split(slot).length !== 2) throw new Error(`guide: page.html needs exactly one "${slot}"`);
  // JSON inside a <script>: keep "</" from closing it early.
  html = html.replace(slot, `const DATA = ${JSON.stringify(data).replace(/<\//g, '<\\/')};`);
  return { html, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { html } = await buildGuide();
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, html);
  console.log(`Field guide: ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)} KB)`);
  console.log(`Republish it to ${ARTIFACT_URL}`);
}
