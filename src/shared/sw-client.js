// Service worker registration, update prompt, the "Ready offline" check for the app
// shell, and the per-game downloads.

export function swSupported() {
  return 'serviceWorker' in navigator && 'caches' in window && window.isSecureContext;
}

/** The installed app (home screen or app window), as opposed to a browser tab. */
export const isStandalone = () =>
  navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

let registration = null;

/**
 * Registers /sw.js once per page. Resolves to the registration, or null. Only the installed
 * app gets a worker: a browser tab only shows how to install, so it keeps no offline copy.
 */
export function registerSW() {
  if (!swSupported() || !isStandalone()) return Promise.resolve(null);
  registration ??= navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch((err) => {
      console.warn('Service worker registration failed', err);
      return null;
    });
  return registration;
}

/**
 * In a browser tab, removes the worker and caches left by an earlier visit, so the tab shows
 * the current release and the app installed from it starts from the host, not from an old
 * copy. Leaves everything alone when any game file is cached: the tab then shares its storage
 * with an installed app (Chrome, Android) whose offline games matter more. Resolves to true
 * when the page itself came from the old copy and should reload once.
 */
export async function dropBrowserCopy() {
  if (!swSupported() || isStandalone()) return false;
  try {
    const names = await caches.keys();
    for (const name of names) {
      const keys = await (await caches.open(name)).keys();
      if (keys.some((r) => new URL(r.url).pathname.startsWith('/games/'))) return false;
    }
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch {
    return false;
  }
  if (!navigator.serviceWorker.controller) return false;
  // One reload per tab session, in case the browser keeps the old worker for it anyway.
  try {
    if (sessionStorage.getItem('gh-dropped')) return false;
    sessionStorage.setItem('gh-dropped', '1');
  } catch {
    return false;
  }
  return true;
}

/** postMessage with a reply port. Rejects after `timeout` ms. */
function ask(worker, message, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/** The active worker's packs: { version, release, core, games: { id: { cache, files, bytes } } }. */
export async function getManifest() {
  const worker = (await navigator.serviceWorker.ready).active;
  return ask(worker, { type: 'GET_MANIFEST' });
}

/** How many of a pack's files are in its cache. Never creates the cache. */
export async function countCached(pack) {
  if (!(await caches.has(pack.cache))) return 0;
  const cache = await caches.open(pack.cache);
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  return pack.files.filter((f) => have.has(f)).length;
}

/**
 * Reports whether the app itself (the shell) works offline, through
 * onStatus({ state, done, total, version, release }).
 * state is 'checking' | 'downloading' | 'ready' | 'failed' | 'unsupported'.
 * "ready" is only reported after every app-shell file of the active worker is
 * confirmed present in its cache.
 */
export function watchOfflineStatus(reg, onStatus) {
  if (!reg) {
    onStatus({ state: swSupported() ? 'failed' : 'unsupported' });
    return;
  }
  let settled = false;
  let total = null;

  // Progress while the first install runs. During an update the active
  // version stays ready, so these messages are ignored then.
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (settled || reg.active) return;
    if (msg.type === 'PRECACHE_PROGRESS') {
      total = msg.total;
      onStatus({ state: 'downloading', done: msg.done, total: msg.total });
    } else if (msg.type === 'PRECACHE_FAILED') {
      onStatus({ state: 'failed' });
    }
  });

  const verify = async (repairAllowed) => {
    const worker = (await navigator.serviceWorker.ready).active;
    try {
      const manifest = await ask(worker, { type: 'GET_MANIFEST' });
      const done = await countCached(manifest.core);
      const status = { done, total: manifest.core.files.length, version: manifest.version, release: manifest.release };
      if (done === manifest.core.files.length) {
        settled = true;
        onStatus({ state: 'ready', ...status });
        return;
      }
      onStatus({ state: 'downloading', ...status });
      if (!repairAllowed) throw new Error('incomplete');
      const result = await ask(worker, { type: 'REPAIR' }, 120000);
      if (!result.ok) throw new Error(result.error);
      await verify(false);
    } catch {
      settled = true;
      onStatus({ state: 'failed' });
    }
  };

  const installing = reg.installing || reg.waiting;
  if (!reg.active && installing) {
    onStatus({ state: 'downloading', done: 0, total });
    installing.addEventListener('statechange', () => {
      if (installing.state === 'redundant' && !reg.active) {
        settled = true;
        onStatus({ state: 'failed' });
      }
    });
  } else {
    onStatus({ state: 'checking' });
  }
  verify(true);
}

/**
 * Asks the active worker to download game packs, one after another. onEvent receives
 * { type: 'progress', id, done, total } and { type: 'game', id, ok }. Resolves to
 * { id: true | false }. Gives up after `stall` ms without news, e.g. when the app went
 * to the background or the host vanished mid-download.
 */
export function downloadPacks(reg, ids, onEvent = () => {}, stall = 20000) {
  return new Promise((resolve) => {
    const results = {};
    const worker = reg && reg.active;
    const channel = new MessageChannel();
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      channel.port1.onmessage = null;
      resolve(Object.fromEntries(ids.map((id) => [id, results[id] === true])));
    };
    if (!worker) return finish();
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, stall);
    };
    channel.port1.onmessage = (event) => {
      const msg = event.data || {};
      arm();
      if (msg.type === 'done') return finish();
      if (msg.type === 'game') results[msg.id] = msg.ok;
      onEvent(msg);
    };
    arm();
    worker.postMessage({ type: 'DOWNLOAD', ids }, [channel.port2]);
  });
}

/**
 * Whether the host (GitHub Pages) answers right now. navigator.onLine can claim a connection
 * that doesn't work, so this asks for real. version.json is never cached by the worker, and
 * the query string gets past the CDN's cache too.
 */
export async function probeHost(timeout = 5000) {
  if (navigator.onLine === false) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`/version.json?probe=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return false;
    const info = await res.json();
    return typeof info.version === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Calls onUpdate() when a new version is installed and waiting behind the current one. */
export function watchForUpdates(reg, onUpdate) {
  if (!reg) return;
  const check = () => {
    if (reg.waiting && navigator.serviceWorker.controller) onUpdate();
  };
  check();
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') check();
    });
  });
}

/**
 * Asks the host for a newer sw.js. Never throws. (GitHub's CDN can take up to 10 minutes
 * to serve a new release.)
 * Returns 'available' | 'current' | 'unreachable' | 'failed'.
 */
export async function checkForUpdate(reg) {
  if (!reg) return 'failed';
  try {
    await reg.update();
  } catch {
    return 'unreachable';
  }
  const pending = reg.installing;
  if (pending) {
    const final = await new Promise((resolve) => {
      const done = () => {
        if (pending.state !== 'installing') resolve(pending.state);
      };
      pending.addEventListener('statechange', done);
      done();
    });
    if (final === 'redundant') return 'failed';
  }
  return reg.waiting ? 'available' : 'current';
}

/** Only called from an explicit tap: activates the waiting worker, then reloads. */
export function applyUpdate(reg) {
  const waiting = reg && reg.waiting;
  if (!waiting) {
    location.reload();
    return;
  }
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Asks for persistent storage (once per launch) and returns true, false or null if unsupported. */
export async function ensurePersisted() {
  if (!navigator.storage || !navigator.storage.persisted) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
