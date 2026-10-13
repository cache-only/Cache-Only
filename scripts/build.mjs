// Build: src/ -> dist/, then write dist/sw.js with VERSION and PACKS inlined.
// PACKS splits every file into the app shell ("core", cached when the app installs) and
// one pack per game (downloaded when the player asks for it). Node built-ins only.
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const TEMPLATE = path.join(SRC, 'sw.template.js');
const WARN_BYTES = 25 * 1024 * 1024;

// Files that never ship: the SW template (rendered separately) and OS junk.
const EXCLUDED = new Set(['sw.template.js', '.DS_Store', 'Thumbs.db']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function toUrl(file) {
  return '/' + path.relative(DIST, file).split(path.sep).join('/');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const hex12 = (hash) => hash.digest('hex').slice(0, 12);

// Every page gets the same viewport and app script, so no screen can forget them: no zoom,
// app-like touch behaviour (see src/shared/app.js). Pages must not carry their own viewport.
const APP_HEAD = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
  '<script type="module" src="/shared/app.js"></script>',
];

/** Inserts APP_HEAD right after the page's charset meta, at the same indentation. */
function withAppHead(html, url) {
  if (/<meta\s+name="viewport"/i.test(html)) throw new Error(`${url}: remove its viewport meta, the build adds it`);
  const m = /^([ \t]*)<meta charset="utf-8">\r?\n/im.exec(html);
  if (!m) throw new Error(`${url}: needs <meta charset="utf-8"> on its own line in <head>`);
  const at = m.index + m[0].length;
  return html.slice(0, at) + APP_HEAD.map((tag) => m[1] + tag + '\n').join('') + html.slice(at);
}

/** A file's content hash: the worker downloads it as ?v=<hash> and checks what arrives. */
const fileHash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

/** URL list, per-URL content hashes, download size and content hash for a group of files. */
function describe(files) {
  const urls = [];
  const hashes = {};
  let bytes = 0;
  const hash = createHash('sha256');
  for (const f of files) {
    const fh = fileHash(f.content);
    // Navigations request the directory form, so index.html is cached under both URLs.
    if (f.url.endsWith('/index.html')) {
      const dir = f.url.slice(0, -'index.html'.length);
      urls.push(dir);
      hashes[dir] = fh;
      bytes += f.content.length;
    }
    urls.push(f.url);
    hashes[f.url] = fh;
    bytes += f.content.length;
    hash.update(f.url).update('\0').update(f.content).update('\0');
  }
  urls.sort();
  return { urls, hashes: Object.fromEntries(urls.map((u) => [u, hashes[u]])), bytes, version: hex12(hash) };
}

export async function build({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;

  // 1. Wipe dist/ and copy src/ into it, excluding the SW template. Every page gets APP_HEAD.
  await rm(DIST, { recursive: true, force: true });
  await cp(SRC, DIST, {
    recursive: true,
    filter: (source) => !EXCLUDED.has(path.basename(source)),
  });
  for (const full of await walk(DIST)) {
    if (full.endsWith('.html')) await writeFile(full, withAppHead(await readFile(full, 'utf8'), toUrl(full)));
  }

  // 2. Walk dist/ and sort every file into a pack: /games/<id>/ belongs to game <id>,
  //    everything else is the app shell. Every game folder needs a registry entry.
  const files = [];
  for (const full of await walk(DIST)) files.push({ url: toUrl(full), content: await readFile(full) });
  files.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

  const registry = JSON.parse(await readFile(path.join(DIST, 'registry.json'), 'utf8'));
  const groups = new Map([['core', []]]);
  for (const game of registry) groups.set(game.id, []);
  for (const f of files) {
    const m = /^\/games\/([^/]+)\//.exec(f.url);
    if (m && !groups.has(m[1])) throw new Error(`${f.url} is in a game folder missing from registry.json`);
    groups.get(m ? m[1] : 'core').push(f);
  }

  const core = describe(groups.get('core'));
  const PACKS = {
    core: { cache: `gamehost-core-${core.version}`, files: core.urls, hashes: core.hashes, bytes: core.bytes },
    games: {},
  };
  for (const game of registry) {
    if (game.path !== `/games/${game.id}/`) throw new Error(`registry.json: "${game.id}" must have path /games/${game.id}/`);
    const pack = describe(groups.get(game.id));
    if (!pack.urls.includes(game.path)) throw new Error(`src/games/${game.id}/index.html is missing`);
    PACKS.games[game.id] = {
      version: pack.version,
      cache: `gamehost-game-${game.id}-${pack.version}`,
      files: pack.urls,
      hashes: pack.hashes,
      bytes: pack.bytes,
    };
  }

  // 3. VERSION: SHA-256 over every file's path and content, sorted by path.
  //    The SW template is hashed too, so a worker logic change gets a new version.
  const hash = createHash('sha256');
  for (const f of files) hash.update(f.url).update('\0').update(f.content).update('\0');
  const template = await readFile(TEMPLATE, 'utf8');
  hash.update('/sw.template.js').update('\0').update(template);
  const VERSION = hex12(hash);

  // 4. Write dist/sw.js with VERSION and PACKS inlined as literals.
  const versionToken = "'__VERSION__'";
  const packsToken = '__PACKS__';
  for (const token of [versionToken, packsToken]) {
    if (template.split(token).length !== 2) {
      throw new Error(`sw.template.js must contain ${token} exactly once`);
    }
  }
  const sw = template
    .replace(versionToken, JSON.stringify(VERSION))
    .replace(packsToken, JSON.stringify(PACKS, null, 2));
  await writeFile(path.join(DIST, 'sw.js'), sw);

  // 5. Write dist/version.json (never cached: the launcher fetches it to see if it's online).
  const packs = [PACKS.core, ...Object.values(PACKS.games)];
  const entries = packs.reduce((n, p) => n + p.files.length, 0);
  const bytes = packs.reduce((n, p) => n + p.bytes, 0);
  const games = Object.fromEntries(
    Object.entries(PACKS.games).map(([id, p]) => [id, { version: p.version, files: p.files.length, bytes: p.bytes }]),
  );
  const info = {
    version: VERSION,
    builtAt: new Date().toISOString(),
    files: entries,
    bytes,
    core: { files: PACKS.core.files.length, bytes: PACKS.core.bytes },
    games,
  };
  await writeFile(path.join(DIST, 'version.json'), JSON.stringify(info, null, 2) + '\n');

  // 6. Report sizes: what installing costs, and what each game adds.
  const swBytes = (await stat(path.join(DIST, 'sw.js'))).size;
  const line = (name, p, note = '') =>
    `  ${name.padEnd(12)} ${String(p.files.length).padStart(3)} entries  ${formatBytes(p.bytes).padStart(9)}${note}`;
  log(`Built Cache Only ${VERSION}`);
  log(line('app shell', PACKS.core, '  (cached on install)'));
  for (const game of registry) log(line(game.id, PACKS.games[game.id]));
  log(line('everything', { files: { length: entries }, bytes }, `  (+ sw.js ${formatBytes(swBytes)})`));
  if (bytes > WARN_BYTES) {
    console.warn(`  WARNING: everything together is ${formatBytes(bytes)}, above the 25 MB budget. iOS may refuse or evict it.`);
  }
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
