// Namespaced saves in localStorage: keys are gh:<gameId>:<key>, values are
// { schema, data } JSON so each game can migrate its own format later.
const PREFIX = 'gh:';
const EXPORT_FORMAT = 'gameplane-saves';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn('Save failed', key, err);
    return false;
  }
}

/**
 * A store for one game. load(key, schema, migrate?) returns the data or null.
 * migrate(oldData, oldSchema) may upgrade older saves; return null to discard.
 */
export function createStore(gameId) {
  const ns = `${PREFIX}${gameId}:`;
  return {
    load(key, schema, migrate) {
      const raw = safeGet(ns + key);
      if (!raw) return null;
      try {
        const env = JSON.parse(raw);
        if (!env || typeof env !== 'object' || !('data' in env)) return null;
        if (env.schema === schema) return env.data;
        return migrate ? migrate(env.data, env.schema) : null;
      } catch {
        return null;
      }
    },
    /** Data regardless of schema; for read-only peeks such as the launcher's resume hint. */
    peek(key) {
      try {
        return JSON.parse(safeGet(ns + key))?.data ?? null;
      } catch {
        return null;
      }
    },
    save(key, schema, data) {
      return safeSet(ns + key, JSON.stringify({ schema, data }));
    },
    remove(key) {
      try {
        localStorage.removeItem(ns + key);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Debounced writer: schedule() after every move, flush() to write now.
 * Flushes automatically when the page is hidden (iOS kills background apps silently).
 * snapshot() returns the data to save, or null to delete the key.
 */
export function createSaver(store, key, schema, snapshot, delay = 250) {
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const data = snapshot();
    if (data == null) store.remove(key);
    else store.save(key, schema, data);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return { schedule, flush };
}

/** All gh:* keys as one JSON-friendly object. */
export function exportAll() {
  const entries = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        entries[key] = JSON.parse(localStorage.getItem(key));
      } catch {
        /* not ours if it isn't JSON; skip it */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return { format: EXPORT_FORMAT, schema: 1, exportedAt: new Date().toISOString(), entries };
}

/** Validates an export blob and writes its gh:* keys. Returns the number written. */
export function importAll(blob) {
  if (!blob || typeof blob !== 'object' || blob.format !== EXPORT_FORMAT || typeof blob.entries !== 'object') {
    throw new Error('not-a-save-file');
  }
  const pairs = Object.entries(blob.entries).filter(([k]) => typeof k === 'string' && k.startsWith(PREFIX));
  let written = 0;
  for (const [key, value] of pairs) {
    if (safeSet(key, JSON.stringify(value))) written++;
  }
  return written;
}

export function countSaves() {
  return Object.keys(exportAll().entries).length;
}
