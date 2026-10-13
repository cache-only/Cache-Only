// Runs the built dist/sw.js in a sandbox with an in-memory Cache Storage and a fake host,
// to check the download model: the app shell installs, games download on request, stale CDN
// copies are refused, and updates keep whatever the device already had.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://cache-only.test';
const LEGACY = 'gamehost-0123456789ab'; // the old one-cache-for-everything layout

let source;
let packs;

before(async () => {
  await build({ quiet: true });
  source = await readFile(path.join(DIST, 'sw.js'), 'utf8');
  packs = JSON.parse(source.match(/const PACKS = (\{[\s\S]*?\n\});/)[1]);
});

const toUrl = (req) => new URL(typeof req === 'string' ? req : req.url, ORIGIN);
// postMessage structured-clones what it sends; this also brings the sandbox's objects home.
const clone = (value) => JSON.parse(JSON.stringify(value));

class FakeCache {
  entries = new Map();
  async put(req, res) {
    const url = toUrl(req);
    this.entries.set(url.href, { url, body: await res.arrayBuffer(), status: res.status });
  }
  async match(req, { ignoreSearch = false } = {}) {
    const url = toUrl(req);
    for (const e of this.entries.values()) {
      if (e.url.pathname === url.pathname && (ignoreSearch || e.url.search === url.search)) {
        return new Response(e.body, { status: e.status });
      }
    }
    return undefined;
  }
  async keys() {
    return [...this.entries.values()].map((e) => ({ url: e.url.href }));
  }
}

class FakeCaches {
  map = new Map();
  async open(name) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache());
    return this.map.get(name);
  }
  async has(name) {
    return this.map.has(name);
  }
  async delete(name) {
    return this.map.delete(name);
  }
  async keys() {
    return [...this.map.keys()];
  }
  async match(req, opts = {}) {
    if (opts.cacheName) return this.map.get(opts.cacheName)?.match(req, opts);
    for (const cache of this.map.values()) {
      const hit = await cache.match(req, opts);
      if (hit) return hit;
    }
    return undefined;
  }
  async count(name) {
    return this.map.has(name) ? (await this.map.get(name).keys()).length : 0;
  }
}

/**
 * The host: serves dist/ like GitHub Pages (query strings ignored), and can go offline, fail
 * one file, or serve a stale copy of one, as the CDN does right after a release.
 */
function makeHost() {
  const host = { online: true, fail: new Set(), stale: new Map(), requests: [] };
  host.fetch = async (input) => {
    const url = toUrl(input);
    host.requests.push(url.pathname);
    if (!host.online || host.fail.has(url.pathname)) throw new TypeError('Failed to fetch');
    if (host.stale.has(url.pathname)) return new Response(host.stale.get(url.pathname), { status: 200 });
    const file = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    try {
      return new Response(await readFile(path.join(DIST, file)), { status: 200 });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  };
  return host;
}

function loadWorker(caches, host) {
  const handlers = {};
  const broadcasts = [];
  const self = {
    location: new URL('/sw.js', ORIGIN),
    addEventListener: (type, fn) => (handlers[type] = fn),
    clients: { matchAll: async () => [{ postMessage: (m) => broadcasts.push(clone(m)) }], claim: async () => {} },
    skipWaiting: () => {},
  };
  vm.runInContext(source, vm.createContext({ self, caches, fetch: host.fetch, URL, Response, crypto }));
  const dispatch = (type, fields = {}) => {
    let pending = null;
    handlers[type]({ ...fields, waitUntil: (p) => (pending = p), respondWith: (p) => (pending = p) });
    return pending;
  };
  return {
    broadcasts,
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    fetch: (pathname, mode = 'no-cors') => dispatch('fetch', { request: { url: ORIGIN + pathname, method: 'GET', mode } }),
    async message(data, { port = true } = {}) {
      const replies = [];
      await dispatch('message', { data, ports: port ? [{ postMessage: (m) => replies.push(clone(m)) }] : [] });
      return replies;
    },
  };
}

async function installed() {
  const caches = new FakeCaches();
  const host = makeHost();
  const sw = loadWorker(caches, host);
  await sw.install();
  await sw.activate();
  return { caches, host, sw };
}

test('installing the app caches only the app shell, never a game', async () => {
  const { caches, host, sw } = await installed();
  assert.deepEqual(await caches.keys(), [packs.core.cache]);
  assert.equal(await caches.count(packs.core.cache), packs.core.files.length);
  assert.ok(!host.requests.some((p) => p.startsWith('/games/')), 'no game file is fetched at install');
  const last = sw.broadcasts.filter((m) => m.type === 'PRECACHE_PROGRESS').at(-1);
  assert.equal(last.done, last.total);
});

test('the launcher reads the shell and every game from the manifest', async () => {
  const { sw } = await installed();
  const [manifest] = await sw.message({ type: 'GET_MANIFEST' });
  assert.equal(manifest.core.cache, packs.core.cache);
  assert.deepEqual(Object.keys(manifest.games).sort(), Object.keys(packs.games).sort());
  assert.ok(manifest.games.tanks.bytes > 0);
});

test('a game downloads on request with progress, then plays with the host gone', async () => {
  const { caches, host, sw } = await installed();
  const replies = await sw.message({ type: 'DOWNLOAD', ids: ['tanks'] });
  const progress = replies.filter((m) => m.type === 'progress');
  assert.ok(progress.length > 2);
  assert.deepEqual(progress.at(-1), { type: 'progress', id: 'tanks', done: packs.games.tanks.files.length, total: packs.games.tanks.files.length });
  assert.deepEqual(replies.slice(-2), [{ type: 'game', id: 'tanks', ok: true }, { type: 'done', results: { tanks: true } }]);
  assert.equal(await caches.count(packs.games.tanks.cache), packs.games.tanks.files.length);

  host.online = false;
  assert.match(await (await sw.fetch('/games/tanks/', 'navigate')).text(), /<title>Tanks · Cache Only<\/title>/);
  assert.equal((await sw.fetch('/games/tanks/engine.js')).status, 200);
  assert.equal((await sw.fetch('/shared/storage.js')).status, 200, 'shared code comes with the shell');
  // A game that isn't on the device: its page falls back to the launcher, its files fail.
  assert.match(await (await sw.fetch('/games/sudoku/', 'navigate')).text(), /<body class="launcher">/);
  await assert.rejects(sw.fetch('/games/sudoku/sudoku.js'));
});

test('a download that breaks off reports failure, and the retry fetches only what is missing', async () => {
  const { caches, host, sw } = await installed();
  host.fail.add('/games/tanks/render.js');
  let replies = await sw.message({ type: 'DOWNLOAD', ids: ['tanks'] });
  assert.deepEqual(replies.at(-1), { type: 'done', results: { tanks: false } });
  await new Promise((resolve) => setTimeout(resolve, 20)); // let in-flight files land
  const have = await caches.count(packs.games.tanks.cache);
  assert.ok(have < packs.games.tanks.files.length);

  host.fail.clear();
  host.requests.length = 0;
  replies = await sw.message({ type: 'DOWNLOAD', ids: ['tanks'] });
  assert.deepEqual(replies.at(-1), { type: 'done', results: { tanks: true } });
  assert.equal(host.requests.length, packs.games.tanks.files.length - have);
});

test('every file is requested at its release hash, and a stale copy is refused', async () => {
  const { caches, host, sw } = await installed();
  const seen = [];
  const plain = host.fetch;
  host.fetch = async (input) => (seen.push(toUrl(input)), plain(input));
  const fresh = loadWorker(caches, host);
  host.stale.set('/games/tanks/engine.js', 'export const old = true;\n');
  let replies = await fresh.message({ type: 'DOWNLOAD', ids: ['tanks'] });
  assert.deepEqual(replies.at(-1), { type: 'done', results: { tanks: false } });
  for (const url of seen) assert.equal(url.search, `?v=${packs.games.tanks.hashes[url.pathname]}`, url.pathname);
  await new Promise((resolve) => setTimeout(resolve, 20)); // let in-flight files land
  const cache = await caches.open(packs.games.tanks.cache);
  assert.equal(await cache.match('/games/tanks/engine.js'), undefined, 'the stale copy never reaches the cache');

  // Once the CDN catches up, the retry completes the pack.
  host.stale.clear();
  replies = await sw.message({ type: 'DOWNLOAD', ids: ['tanks'] });
  assert.deepEqual(replies.at(-1), { type: 'done', results: { tanks: true } });
  assert.equal(await caches.count(packs.games.tanks.cache), packs.games.tanks.files.length);
});

test('downloading several games at once, and without a reply port', async () => {
  const { caches, sw } = await installed();
  const replies = await sw.message({ type: 'DOWNLOAD', ids: ['sudoku', '2048', 'nope'] });
  assert.deepEqual(replies.at(-1), { type: 'done', results: { sudoku: true, 2048: true } });
  await sw.message({ type: 'DOWNLOAD', ids: ['tanks'] }, { port: false });
  for (const id of ['sudoku', '2048', 'tanks']) {
    assert.equal(await caches.count(packs.games[id].cache), packs.games[id].files.length, id);
  }
});

test('an update keeps the games a device had in the old all-in-one cache, and nothing more', async () => {
  const caches = new FakeCaches();
  const host = makeHost();
  const legacy = await caches.open(LEGACY);
  for (const url of [...packs.core.files, ...packs.games.sudoku.files, ...packs.games['2048'].files]) {
    await legacy.put(url, new Response('old'));
  }
  const sw = loadWorker(caches, host);
  await sw.install();
  for (const id of ['sudoku', '2048']) {
    assert.equal(await caches.count(packs.games[id].cache), packs.games[id].files.length, `${id} carried over`);
  }
  assert.equal(await caches.has(packs.games.tanks.cache), false, 'a game the device never had waits for the player');
  assert.ok(await caches.has(LEGACY), 'the old version keeps serving until the reload');
  await sw.activate();
  assert.deepEqual((await caches.keys()).sort(), [packs.core.cache, packs.games.sudoku.cache, packs.games['2048'].cache].sort());
});

test('an update re-downloads only the games that changed', async () => {
  const caches = new FakeCaches();
  const host = makeHost();
  const oldTanks = await caches.open('gamehost-game-tanks-000000000000');
  for (const url of packs.games.tanks.files) await oldTanks.put(url, new Response('old tanks'));
  const sudoku = await caches.open(packs.games.sudoku.cache);
  for (const url of packs.games.sudoku.files) await sudoku.put(url, new Response('same sudoku'));
  const sw = loadWorker(caches, host);
  await sw.install();
  assert.ok(!host.requests.some((p) => p.startsWith('/games/sudoku/')), 'an unchanged game is not fetched again');
  assert.ok(host.requests.includes('/games/tanks/engine.js'), 'a changed game is fetched at its new version');
  await sw.activate();
  assert.equal(await caches.has('gamehost-game-tanks-000000000000'), false);
  assert.equal(await caches.count(packs.games.tanks.cache), packs.games.tanks.files.length);
});

test('an update that cannot finish fails as a whole and leaves the old version alone', async () => {
  const caches = new FakeCaches();
  const host = makeHost();
  const legacy = await caches.open(LEGACY);
  for (const url of [...packs.core.files, ...packs.games.tanks.files]) await legacy.put(url, new Response('old'));
  host.fail.add('/games/tanks/ai.js');
  const sw = loadWorker(caches, host);
  await assert.rejects(sw.install());
  assert.ok(sw.broadcasts.some((m) => m.type === 'PRECACHE_FAILED'));
  assert.equal(await caches.count(LEGACY), packs.core.files.length + packs.games.tanks.files.length);
});

test('version.json and unknown files always go to the host, never to a cache', async () => {
  const { host, sw } = await installed();
  host.requests.length = 0;
  assert.equal((await sw.fetch('/version.json')).status, 200);
  assert.deepEqual(host.requests, ['/version.json']);
  host.online = false;
  await assert.rejects(sw.fetch('/version.json'), 'with the host gone the probe fails');
  // Offline, the launcher still opens, with or without a query string.
  assert.match(await (await sw.fetch('/?source=pwa', 'navigate')).text(), /<body class="launcher">/);
});
