// Builds the Tanks field guide (guide/page.html) into guide/out/tanks-field-guide.html.
// Everything game-specific is read from the game itself: stats, kinds and spawn letters
// from rules.js, maps from missions.js, names and briefings from i18n.js, starting lives
// from tanks.js and colours from the game's styles.css. The game's rules.js, ai.js,
// engine.js and art.js, and guide/mapcheck.mjs, are bundled into the page, so the guide
// draws with the game's own art and its map editor runs the same checks as the tests.
// The guide is not part of the app and never ships in a pack. After building, republish
// the output to the artifact (see CLAUDE.md).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TANKS = path.join(ROOT, 'src/games/tanks');
const GUIDE = path.join(ROOT, 'guide');
export const OUT = path.join(GUIDE, 'out/tanks-field-guide.html');
export const ARTIFACT_URL = 'https://claude.ai/artifact/YKPsuThAVXPnPLm4Wwa5gN';

/** The modules bundled into the page, in dependency order, by the name the page uses. */
export const MODULES = [
  ['rules', path.join(TANKS, 'rules.js')],
  ['ai', path.join(TANKS, 'ai.js')],
  ['engine', path.join(TANKS, 'engine.js')],
  ['art', path.join(TANKS, 'art.js')],
  ['mapcheck', path.join(GUIDE, 'mapcheck.mjs')],
];

const load = (file) => import(pathToFileURL(file).href);

/**
 * The modules as one classic script: `const MOD = {}`, then each module in its own
 * function scope, its imports read from MOD and its exports returned into MOD[name].
 * Handles the plain `import { a, b } from './x.js'` and `export const|function` forms
 * the game uses, and refuses anything else rather than guessing.
 */
export async function bundle(modules = MODULES) {
  const known = new Set(modules.map(([name]) => name));
  let out = 'const MOD = {};\n';
  for (const [name, file] of modules) {
    let src = await readFile(file, 'utf8');
    const imports = [];
    src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';[ \t]*$/gm, (m, names, from) => {
      const mod = path.basename(from).replace(/\.m?js$/, '');
      if (!known.has(mod)) throw new Error(`guide bundle: ${name} imports ${from}, which isn't bundled`);
      if (/\bas\b/.test(names)) throw new Error(`guide bundle: ${name} renames an import; not supported`);
      imports.push(`const {${names}} = MOD.${mod};`);
      return '';
    });
    if (/^\s*import\s/m.test(src)) throw new Error(`guide bundle: ${name} has an import the bundler can't read`);
    const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([\w$]+)/gm)].map((m) => m[1]);
    src = src.replace(/^export\s+(?=(?:async\s+)?(?:const|let|function|class)\b)/gm, '');
    if (/^\s*export\b/m.test(src)) throw new Error(`guide bundle: ${name} has an export the bundler can't read`);
    out += `MOD.${name} = (() => {\n'use strict';\n${imports.join('\n')}\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
  }
  return out;
}

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
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const CHIP_DARK = '#16181d'; // the page's --chip-dark and --chip-light
const CHIP_LIGHT = '#faf8f2';

/** Builds the page and returns { html, data }. Throws if the game and the guide disagree. */
export async function buildGuide() {
  const R = await load(path.join(TANKS, 'rules.js'));
  const M = await load(path.join(TANKS, 'missions.js'));
  const A = await load(path.join(TANKS, 'art.js'));
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

  // The game is dark only: one palette, drawn the same in the guide's light and dark themes.
  const light = tokens(css, '.page-tanks {');
  const pairs = (decls) => Object.fromEntries(decls.map((d) => d.match(/(--tk-[\w-]+):\s*([^;]+);/).slice(1)));
  const color = pairs(light);
  const darkColor = color;

  const kinds = R.ENEMY_KINDS;
  const consts = {
    blastR: R.BLAST_R,
    opening: R.OPENING,
    missileTurn: R.MISSILE_TURN,
    missileFuel: R.MISSILE_FUEL,
    lock: R.LOCK,
    bombFlight: R.BOMB_FLIGHT,
    bombR: R.BOMB_R,
    bombMin: R.BOMB_MIN,
    bombMax: R.BOMB_MAX,
    spinUp: R.SPIN_UP,
    spinDown: R.SPIN_DOWN,
    sprayTurn: R.SPRAY_TURN,
    sprayR: R.SPRAY_R,
    velSmooth: R.VEL_SMOOTH,
  };
  const text = enemyText({ T: R.TYPES, kinds, R: consts, name: (k) => english(`tanks.type.${k}`), note: english });
  const info = {};
  const ink = {};
  const colours = {};
  for (const k of ['player', ...kinds]) {
    const hex = color[`--tk-${k}`];
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) throw new Error(`guide: no hex colour --tk-${k} in tanks/styles.css`);
    // Chip text: whichever of the page's dark and light inks has more contrast on this colour.
    const L = luminance(hex);
    ink[k] = (L + 0.05) / (luminance(CHIP_DARK) + 0.05) >= (luminance(CHIP_LIGHT) + 0.05) / (L + 0.05) ? 'dark' : 'light';
    colours[k] = { light: hex, dark: darkColor[`--tk-${k}`] };
    if (k === 'player') continue;
    if (!text[k]) throw new Error(`guide: enemy kind "${k}" has no text in guide/enemies.mjs`);
    if (!SCENES[k]) throw new Error(`guide: enemy kind "${k}" has no scene in guide/enemies.mjs`);
    info[k] = { name: english(`tanks.type.${k}`), ...text[k](R.TYPES[k]) };
    const flat = JSON.stringify(info[k]);
    if (/undefined|NaN|Infinity/.test(flat)) throw new Error(`guide: text for "${k}" has a missing value: ${flat}`);
  }
  for (const k of Object.keys(SCENES)) if (!kinds.includes(k)) throw new Error(`guide: scene for unknown kind "${k}"`);
  const offLimits = { player: color['--tk-player'], fire: color['--tk-fire'], crate: color['--tk-crate'] };

  const data = {
    types: R.TYPES,
    kinds,
    spawn: R.SPAWN_CODES,
    codes: Object.fromEntries(Object.entries(R.SPAWN_CODES).map(([ch, k]) => [k, ch])),
    missions: M.MISSIONS,
    names: M.MISSIONS.map((_, i) => english(`tanks.name.${i + 1}`)),
    briefs: M.MISSIONS.map((_, i) => english(`tanks.brief.${i + 1}`)),
    notes: Object.fromEntries(kinds.filter((k) => i18n.includes(`'tanks.note.${k}'`)).map((k) => [k, english(`tanks.note.${k}`)])),
    checkpoints: M.CHECKPOINTS,
    bonusAfter: M.BONUS_AFTER,
    cols: R.COLS,
    rows: R.ROWS,
    muzzle: R.MUZZLE,
    ...consts,
    lives,
    info,
    scenes: SCENES,
    ink,
    colours,
    offLimits,
    variants: A.VARIANTS,
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
    .replaceAll('/*TK_DARK*/', '')
    .replace(/\{\{(\w+)\}\}/g, (m, key) => {
      if (!(key in fill)) throw new Error(`guide: unknown placeholder ${m}`);
      return String(fill[key]);
    });
  const modSlot = '/*__MODULES__*/';
  if (html.split(modSlot).length !== 2) throw new Error(`guide: page.html needs exactly one "${modSlot}"`);
  // Inside a <script>: keep "</" from closing it early.
  const code = (await bundle()).replace(/<\//g, '<\\/');
  html = html.replace(modSlot, () => code);
  const slot = 'const DATA = __DATA__;';
  if (html.split(slot).length !== 2) throw new Error(`guide: page.html needs exactly one "${slot}"`);
  html = html.replace(slot, () => `const DATA = ${JSON.stringify(data).replace(/<\//g, '<\\/')};`);
  return { html, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { html } = await buildGuide();
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, html);
  console.log(`Field guide: ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)} KB)`);
  console.log(`Republish it to ${ARTIFACT_URL}`);
}
