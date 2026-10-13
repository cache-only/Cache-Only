// Gameplane service worker. scripts/build.mjs renders this into dist/sw.js with VERSION
// and PACKS inlined, so every release changes the bytes of sw.js itself.
// PACKS.core is the app shell, cached at install so the app always opens offline.
// PACKS.games has one pack per game, downloaded only when the player asks for it.
const VERSION = '__VERSION__';
const PACKS = __PACKS__;

const CORE = PACKS.core;
const GAMES = PACKS.games;
const CONCURRENCY = 6;

// The pack whose cache serves each URL.
const OWNER = new Map();
for (const url of CORE.files) OWNER.set(url, CORE);
for (const game of Object.values(GAMES)) for (const url of game.files) OWNER.set(url, game);

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function fetchStrict(url) {
  const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
  if (!res.ok || res.redirected) {
    throw new Error(`Download failed for ${url}: ${res.status}${res.redirected ? ' (redirected)' : ''}`);
  }
  return res;
}

async function cachedPaths(cache) {
  return new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
}

/**
 * Fetches whatever the pack is still missing into its cache, with a small worker pool.
 * Any failure rejects; files that already arrived stay, so a retry only fetches the rest.
 */
async function fillPack(pack, onProgress = () => {}) {
  const cache = await caches.open(pack.cache);
  const have = await cachedPaths(cache);
  const missing = pack.files.filter((url) => !have.has(url));
  const total = pack.files.length;
  let done = total - missing.length;
  onProgress(done, total);
  let next = 0;
  const run = async () => {
    while (next < missing.length) {
      const url = missing[next++];
      await cache.put(url, await fetchStrict(url));
      done++;
      onProgress(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, run));
}

/** Games this device already has, in any cache from this or an older version. */
async function gamesOnDevice() {
  const found = new Set();
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const path of await cachedPaths(cache)) {
      const m = /^\/games\/([^/]+)\/$/.exec(path);
      if (m && GAMES[m[1]]) found.add(m[1]);
    }
  }
  return [...found];
}

self.addEventListener('install', (event) => {
  // No skipWaiting() here: an update waits until the player chooses to reload.
  event.waitUntil(
    (async () => {
      try {
        await fillPack(CORE, (done, total) => broadcast({ type: 'PRECACHE_PROGRESS', version: VERSION, done, total }));
        // An update brings along every game the device already had, at its new version,
        // so nothing a player downloaded stops working offline.
        for (const id of await gamesOnDevice()) await fillPack(GAMES[id]);
      } catch (err) {
        broadcast({ type: 'PRECACHE_FAILED', version: VERSION, error: String(err) });
        throw err;
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CORE.cache, ...Object.values(GAMES).map((game) => game.cache)]);
      for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function handleNavigation(request) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.endsWith('/index.html')) path = path.slice(0, -'index.html'.length);
  if (!path.endsWith('/') && OWNER.has(path + '/')) path += '/';
  const pack = OWNER.get(path) || CORE;
  const hit = await caches.match(path, { cacheName: pack.cache, ignoreSearch: true });
  if (hit) return hit;
  try {
    // A game that isn't downloaded, while the host is up.
    return await fetch(request);
  } catch (err) {
    const home = await caches.match('/', { cacheName: CORE.cache });
    if (home) return home;
    throw err;
  }
}

async function handleAsset(request) {
  const pack = OWNER.get(new URL(request.url).pathname);
  const hit = pack && (await caches.match(request, { cacheName: pack.cache }));
  // On a miss, go to the network but never store the response: the packs are the single
  // source of truth, and only an explicit download fills them.
  return hit || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? handleNavigation(request) : handleAsset(request));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (msg) => port && port.postMessage(msg);

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_MANIFEST') {
    reply({ version: VERSION, core: CORE, games: GAMES });
  } else if (data.type === 'REPAIR') {
    // Re-fetch app-shell files that went missing (e.g. storage pressure).
    event.waitUntil(
      fillPack(CORE).then(
        () => reply({ ok: true }),
        (err) => reply({ ok: false, error: String(err) }),
      ),
    );
  } else if (data.type === 'DOWNLOAD') {
    // Download game packs one after another, reporting progress on the reply port.
    event.waitUntil(
      (async () => {
        const results = {};
        for (const id of [].concat(data.ids || [])) {
          if (!GAMES[id]) continue;
          try {
            await fillPack(GAMES[id], (done, total) => reply({ type: 'progress', id, done, total }));
            results[id] = true;
          } catch {
            results[id] = false;
          }
          reply({ type: 'game', id, ok: results[id] });
        }
        reply({ type: 'done', results });
      })(),
    );
  }
});
