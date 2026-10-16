// Guards the offline contract: the build output, the pack manifest (app shell plus one
// pack per game) and the server's no-redirect behaviour.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { createServer } from '../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

let info;
let packs;
let registry;
let server;
let base;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

before(async () => {
  info = await build({ quiet: true });
  const sw = await readFile(path.join(DIST, 'sw.js'), 'utf8');
  packs = JSON.parse(sw.match(/const PACKS = (\{[\s\S]*?\n\});/)[1]);
  registry = JSON.parse(await readFile(path.join(DIST, 'registry.json'), 'utf8'));
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const allPacks = () => [packs.core, ...Object.values(packs.games)];

test('sw.js has VERSION, RELEASE and PACKS inlined', async () => {
  const sw = await readFile(path.join(DIST, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('__VERSION__') && !sw.includes('__RELEASE__') && !sw.includes('__PACKS__'));
  assert.ok(sw.includes(`const VERSION = "${info.version}"`));
  assert.ok(!/importScripts/.test(sw), 'the manifest must live in sw.js itself');
  assert.match(info.version, /^[0-9a-f]{12}$/);
  // The version people see is package.json's, set by hand.
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(info.release, pkg.version);
  assert.ok(sw.includes(`const RELEASE = "${pkg.version}"`));
});

test('every shipped file belongs to exactly one pack', async () => {
  const shipped = (await walk(DIST))
    .map((f) => '/' + path.relative(DIST, f).split(path.sep).join('/'))
    .filter((u) => u !== '/sw.js' && u !== '/version.json');
  const owners = new Map();
  for (const [name, pack] of [['core', packs.core], ...Object.entries(packs.games)]) {
    for (const url of pack.files) {
      assert.ok(!owners.has(url), `${url} is in both ${owners.get(url)} and ${name}`);
      owners.set(url, name);
    }
  }
  for (const url of shipped) assert.ok(owners.has(url), `${url} is in no pack`);
  for (const url of owners.keys()) {
    const file = url.endsWith('/') ? `${url}index.html` : url;
    assert.ok(shipped.includes(file), `${url} is in a pack but not shipped`);
  }
  assert.ok(!owners.has('/sw.js') && !owners.has('/version.json'), 'sw.js and version.json are never cached');
  assert.equal(info.files, owners.size);
});

test('every pack file carries the content hash the worker checks downloads against', async () => {
  for (const pack of allPacks()) {
    assert.deepEqual(Object.keys(pack.hashes), pack.files);
    for (const url of pack.files) {
      const file = path.join(DIST, url.endsWith('/') ? `${url}index.html` : url);
      const want = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 16);
      assert.equal(pack.hashes[url], want, url);
    }
  }
});

test('the app shell holds everything the launcher needs to open offline', () => {
  const core = packs.core.files;
  for (const url of ['/', '/index.html', '/launcher.js', '/styles.css', '/manifest.json', '/registry.json', '/icons/apple-touch-icon.png']) {
    assert.ok(core.includes(url), `${url} missing from the app shell`);
  }
  for (const url of ['/shared/app.js', '/shared/i18n.js', '/shared/storage.js', '/shared/sw-client.js', '/shared/ui.js']) {
    assert.ok(core.includes(url), `${url} missing from the app shell`);
  }
  assert.ok(!core.some((u) => u.startsWith('/games/')), 'no game file is installed with the shell');
  assert.match(packs.core.cache, /^gamehost-core-[0-9a-f]{12}$/);
});

test('each game in the registry is one downloadable pack, and nothing else is', () => {
  assert.deepEqual(Object.keys(packs.games).sort(), registry.map((g) => g.id).sort());
  for (const game of registry) {
    const pack = packs.games[game.id];
    assert.match(game.path, /^\/games\/[^/]+\/$/);
    assert.ok(pack.files.includes(game.path), `${game.path} not in its pack`);
    assert.ok(pack.files.every((u) => u.startsWith(game.path)), `${game.id} pack reaches outside its folder`);
    assert.equal(pack.cache, `gamehost-game-${game.id}-${pack.version}`);
    assert.ok(pack.bytes > 0);
    assert.deepEqual(info.games[game.id], { version: pack.version, files: pack.files.length, bytes: pack.bytes });
  }
  assert.ok(packs.games.sudoku.files.includes('/games/sudoku/worker.js'), 'the Sudoku worker ships with Sudoku');
  assert.ok(packs.games.tanks.files.includes('/games/tanks/floor.js'), 'the Tanks floor worker ships with Tanks');
  for (const mod of ['tanks.js', 'engine.js', 'rules.js', 'ai.js', 'art.js', 'missions.js', 'render.js', 'audio.js', 'styles.css']) {
    assert.ok(packs.games.tanks.files.includes(`/games/tanks/${mod}`), `tanks ${mod} must be in the Tanks pack`);
  }
  assert.equal(info.bytes, allPacks().reduce((n, p) => n + p.bytes, 0));
});

test('nothing in dist/ points at another origin, but multiplayer at its rooms', async () => {
  const allowed = ['http://www.w3.org/2000/svg'];
  // Star's rooms Worker carries messages between devices, never files, and only star.js names it.
  const ROOMS = 'wss://cache-only-rooms.cache-only.workers.dev';
  for (const file of await walk(DIST)) {
    if (!/\.(html|js|css|json|svg)$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    const rel = path.relative(DIST, file);
    for (const url of text.match(/(?:https?|wss?):\/\/[^\s"'`)<>]+/g) || []) {
      if (url === ROOMS && rel === path.join('shared', 'star.js')) continue;
      assert.ok(allowed.includes(url), `${rel} references ${url}`);
    }
    // One STUN server, asked only by star.js for the network's address (never used in a link).
    for (const stun of text.match(/\bstuns?:[^\s"'`)<>]+/g) || []) {
      assert.ok(stun === 'stun:stun.cloudflare.com:3478' && rel === path.join('shared', 'star.js'), `${rel} names ${stun}`);
    }
    assert.ok(!/@import\s+url\(\s*['"]?\/\//.test(text), `${file} imports a protocol-relative URL`);
  }
});

test('the server never redirects', async () => {
  const get = (p, method = 'GET') => fetch(base + p, { method, redirect: 'manual' });

  for (const p of ['/', '/games/sudoku/', '/games/tanks/', '/sw.js', '/manifest.json']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
  }
  for (const p of ['/games/sudoku', '/games/tanks', '/games', '/nope.html', '/../package.json', '/%2e%2e/package.json']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
  }
  assert.equal((await get('/games/sudoku', 'HEAD')).status, 404);
  assert.equal((await get('/games/sudoku/', 'HEAD')).status, 200);
});

test('the server sends the right MIME types and cache headers', async () => {
  const cases = {
    '/': 'text/html',
    '/sw.js': 'text/javascript',
    '/launcher.js': 'text/javascript',
    '/styles.css': 'text/css',
    '/manifest.json': 'application/json',
    '/version.json': 'application/json',
    '/icons/icon-192.png': 'image/png',
    '/icons/icon.svg': 'image/svg+xml',
  };
  for (const [p, type] of Object.entries(cases)) {
    const res = await fetch(base + p);
    assert.ok(res.headers.get('content-type').startsWith(type), `${p}: ${res.headers.get('content-type')}`);
  }
  for (const p of ['/sw.js', '/', '/games/sudoku/', '/version.json']) {
    assert.equal((await fetch(base + p)).headers.get('cache-control'), 'no-cache', p);
  }
  // The launcher's "are we online?" check reads version.json with a cache-busting query,
  // and the worker downloads every file as ?v=<hash>.
  assert.equal((await fetch(base + '/games/sudoku/?v=0123456789abcdef')).status, 200);
  const probe = await fetch(base + '/version.json?probe=123');
  assert.equal(probe.status, 200);
  assert.equal((await probe.json()).version, info.version);
});

test('every page asks iOS for the default status bar, with no strip of its own', async () => {
  for (const file of (await walk(DIST)).filter((f) => f.endsWith('.html'))) {
    const html = await readFile(file, 'utf8');
    const name = path.relative(DIST, file);
    assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="default">/, name);
    assert.match(html, /<meta name="theme-color" content="#000000">/, name);
    assert.doesNotMatch(html, /status-tint/, name);
  }
});

test('every page gets the no-zoom viewport and the app script from the build', async () => {
  for (const file of (await walk(DIST)).filter((f) => f.endsWith('.html'))) {
    const html = await readFile(file, 'utf8');
    const name = path.relative(DIST, file);
    const viewports = html.match(/<meta name="viewport"[^>]*>/g) ?? [];
    assert.equal(viewports.length, 1, `${name} has one viewport meta`);
    assert.match(viewports[0], /maximum-scale=1, user-scalable=no, viewport-fit=cover/, name);
    assert.match(html, /<head>[\s\S]*<script type="module" src="\/shared\/app\.js"><\/script>[\s\S]*<\/head>/, name);
  }
});
