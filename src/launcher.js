import { formatBytes, formatNumber, formatPercent, formatTime, getLang, localize, pick, setLang, t } from './shared/i18n.js';
import { createStore, exportAll, importAll } from './shared/storage.js';
import {
  applyUpdate,
  checkForUpdate,
  countCached,
  downloadPacks,
  ensurePersisted,
  getManifest,
  probeHost,
  registerSW,
  watchForUpdates,
  watchOfflineStatus,
} from './shared/sw-client.js';
import { confirmDialog, openSheet, setupSheet } from './shared/ui.js';

const $ = (id) => document.getElementById(id);
const HOST_POLL_MS = 15000;

let registry = [];
let reg = null;
let offline = { state: 'checking' };
let persisted;
let manifest = null; // the active worker's packs
let host = 'unknown'; // 'online' | 'offline' | 'unknown': does the host answer right now?
const onDevice = new Set(); // games whose every file is cached
const progress = new Map(); // id -> { done, total, started } while downloading or queued
const failed = new Set(); // ids whose last download failed
let bulk = null; // { done, total } while "Download all" runs

const isStandalone = () =>
  navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgIcon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/* ---------- Games list ---------- */

function sessionDetail(summary) {
  const parts = [];
  if (summary.difficulty) parts.push(t(`difficulty.${summary.difficulty}`));
  if (typeof summary.time === 'number') parts.push(formatTime(summary.time));
  if (typeof summary.score === 'number') parts.push(t('launcher.score', { score: formatNumber(summary.score) }));
  if (typeof summary.mission === 'number') parts.push(t('launcher.mission', { n: summary.mission }));
  return parts.join(' · ');
}

/**
 * ready: on this device, playable. downloading: in progress. remote: downloadable now.
 * unavailable: not on this device and the host is out of reach. waiting: not known yet.
 */
function stateOf(game) {
  if (!reg && offline.state !== 'checking') return 'ready'; // no service worker: plain online play
  if (!manifest || !manifest.games[game.id]) return 'waiting';
  if (onDevice.has(game.id)) return 'ready';
  if (progress.has(game.id)) return 'downloading';
  if (host === 'online') return 'remote';
  return host === 'offline' ? 'unavailable' : 'waiting';
}

function downloadPill(id) {
  const pill = el('span', 'flight-action');
  const p = progress.get(id);
  if (p) {
    const fraction = p.total ? p.done / p.total : 0;
    pill.textContent = formatPercent(fraction);
    pill.style.setProperty('--p', `${Math.round(fraction * 100)}%`);
  } else {
    pill.append(t('launcher.download'), svgIcon('i-download'));
  }
  return pill;
}

function renderRow({ game, i, state }) {
  const ready = state === 'ready';
  const summary = ready ? createStore(game.id).peek('session')?.summary : null;
  const pack = manifest && manifest.games[game.id];
  const li = el('li', `flight is-${state}${summary ? ' has-session' : ''}`);
  li.dataset.id = game.id;

  let row;
  if (ready) {
    row = el('a', 'flight-link');
    row.href = game.path;
  } else if (state === 'remote' || state === 'downloading') {
    row = el('button', 'flight-link');
    row.type = 'button';
    row.dataset.download = game.id;
    row.disabled = state === 'downloading';
    row.setAttribute('aria-label', t('launcher.downloadGame', { name: pick(game.name), size: formatBytes(pack.bytes) }));
  } else {
    row = el('div', 'flight-link');
    row.setAttribute('aria-disabled', 'true');
  }

  const code = el('span', 'flight-code', game.code || `GP ${String(i + 1).padStart(2, '0')}`);
  code.setAttribute('aria-hidden', 'true');
  const main = el('span', 'flight-main');
  main.append(el('span', 'flight-name', pick(game.name)), el('span', 'flight-desc', pick(game.description)));

  const status = el('span', 'flight-status');
  if (ready) {
    const action = el('span', 'flight-action', t(summary ? 'launcher.resume' : 'launcher.play'));
    action.append(svgIcon('i-arrow'));
    status.append(action);
    const detail = summary && sessionDetail(summary);
    if (detail) status.append(el('span', 'flight-detail', detail));
  } else if (state === 'remote' || state === 'downloading') {
    status.append(downloadPill(game.id));
    let note = formatBytes(pack.bytes);
    if (state === 'downloading') note = t(progress.get(game.id).started ? 'launcher.downloading' : 'launcher.queued');
    else if (failed.has(game.id)) note = t('launcher.downloadFailed');
    status.append(el('span', `flight-detail${failed.has(game.id) && state === 'remote' ? ' is-error' : ''}`, note));
  } else if (state === 'unavailable') {
    status.append(el('span', 'flight-detail', t('launcher.needsHost')));
  }

  row.append(code, main, status);
  li.append(row);
  return li;
}

function renderGames() {
  const rows = registry.map((game, i) => ({ game, i, state: stateOf(game) }));
  // Out of reach of the host, the games on this device come first and the rest wait below.
  if (host === 'offline') {
    rows.sort((a, b) => (a.state === 'unavailable') - (b.state === 'unavailable') || a.i - b.i);
  }
  $('games').replaceChildren(...rows.map(renderRow));
  renderDownloadAll();
  $('factGames').textContent = manifest ? `${onDevice.size} / ${registry.length}` : '—';
}

/** Updates one row's percentage in place, so the list doesn't flicker while downloading. */
function renderProgress(id) {
  const row = $('games').querySelector(`[data-id="${CSS.escape(id)}"]`);
  const pill = row && row.querySelector('.flight-action');
  if (pill) pill.replaceWith(downloadPill(id));
}

function missingGames() {
  return manifest ? registry.filter((g) => manifest.games[g.id] && !onDevice.has(g.id)) : [];
}

function renderDownloadAll() {
  const missing = missingGames();
  const show = isStandalone() && host === 'online' && missing.length > 0;
  $('downloadAll').hidden = !show;
  if (!show) return;
  const btn = $('downloadAllBtn');
  if (bulk) {
    btn.disabled = true;
    $('downloadAllText').textContent = t('launcher.downloadingAll', { done: Math.min(bulk.done + 1, bulk.total), total: bulk.total });
  } else {
    btn.disabled = progress.size > 0;
    const bytes = missing.reduce((n, g) => n + manifest.games[g.id].bytes, 0);
    $('downloadAllText').textContent = t('launcher.downloadAll', { size: formatBytes(bytes) });
  }
}

async function loadRegistry() {
  try {
    const res = await fetch('/registry.json');
    registry = await res.json();
  } catch {
    registry = [];
  }
  renderGames();
}

/* ---------- Downloads ---------- */

/** Checks every game's cache; a game counts only when every one of its files is there. */
async function refreshPacks() {
  if (!manifest) return;
  const checks = await Promise.all(
    Object.entries(manifest.games).map(async ([id, pack]) => [id, (await countCached(pack)) === pack.files.length]),
  );
  onDevice.clear();
  for (const [id, complete] of checks) if (complete) onDevice.add(id);
}

async function loadPacks() {
  try {
    manifest = await getManifest();
  } catch {
    manifest = null;
  }
  await refreshPacks();
  renderGames();
  renderStatus();
}

async function download(ids) {
  ids = ids.filter((id) => manifest && manifest.games[id] && !onDevice.has(id) && !progress.has(id));
  if (!ids.length || !reg) return;
  for (const id of ids) {
    failed.delete(id);
    progress.set(id, { done: 0, total: manifest.games[id].files.length, started: false });
  }
  renderGames();
  await downloadPacks(reg, ids, (msg) => {
    if (msg.type === 'progress' && progress.has(msg.id)) {
      const first = !progress.get(msg.id).started;
      progress.set(msg.id, { done: msg.done, total: msg.total, started: true });
      if (first) renderGames();
      else renderProgress(msg.id);
    } else if (msg.type === 'game') {
      progress.delete(msg.id);
      if (msg.ok) onDevice.add(msg.id);
      if (bulk) bulk.done++;
      renderGames();
    }
  });
  for (const id of ids) progress.delete(id);
  // Trust the cache, not the messages.
  await refreshPacks();
  for (const id of ids) if (!onDevice.has(id)) failed.add(id);
  // A newer version may be installed and waiting for a reload: it gets the same games,
  // so taking the update doesn't drop them.
  for (const worker of [reg.waiting, reg.installing]) worker?.postMessage({ type: 'DOWNLOAD', ids });
  renderGames();
  renderStatus();
  if (ids.some((id) => failed.has(id))) checkHost();
}

async function downloadAll() {
  const ids = missingGames().map((g) => g.id);
  if (!ids.length || bulk) return;
  bulk = { done: 0, total: ids.length };
  renderDownloadAll();
  try {
    await download(ids);
  } finally {
    bulk = null;
    renderGames();
  }
}

$('games').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-download]');
  if (btn && !btn.disabled) download([btn.dataset.download]);
});

$('downloadAllBtn').addEventListener('click', downloadAll);

/* ---------- Host ---------- */

let probing = null;

/** Downloads are only offered while the host actually answers. */
async function checkHost() {
  if (!isStandalone()) return;
  probing ??= probeHost().finally(() => {
    probing = null;
  });
  const next = (await probing) ? 'online' : 'offline';
  if (next === host) return;
  host = next;
  renderStatus();
  renderGames();
}

/* ---------- Offline status ---------- */

function renderStatus() {
  const s = offline;
  const box = $('status');
  box.hidden = !isStandalone();
  box.dataset.state = s.state;
  const text = {
    checking: t('status.checking'),
    downloading: t('status.preparing', { done: s.done ?? 0, total: s.total ?? '…' }),
    ready: t('status.ready'),
    failed: t('status.failed'),
    unsupported: t('status.unsupported'),
  }[s.state];
  let ready = '';
  if (host === 'offline') ready = t('status.hostOffline');
  else if (host === 'online') ready = manifest && !missingGames().length ? t('status.allReady') : t('status.hostOnline');
  const hint = {
    checking: '',
    downloading: t('status.downloadingHint'),
    ready,
    failed: t('status.failedHint'),
    unsupported: t('status.unsupportedHint'),
  }[s.state];
  $('statusText').textContent = text;
  $('statusVersion').textContent = s.state === 'ready' && s.version ? s.version : '';
  $('statusHint').textContent = hint;
  $('footVersion').textContent = s.version ? `v ${s.version}` : '';

  $('factVersion').textContent = s.version || '—';
  $('factOffline').textContent = text;
  $('factPersisted').textContent =
    persisted == null ? t('settings.unsupported') : persisted ? t('common.yes') : t('common.no');
}

/* ---------- Browser vs installed app ---------- */

// In a browser tab there is nothing to play or download: only how to install the app.
function renderMode() {
  const app = isStandalone();
  $('installCard').hidden = app;
  $('gamesSection').hidden = !app;
  $('openSettings').hidden = !app;
  if (!app) {
    $('updateBanner').hidden = true;
    $('installText').textContent = isIOS() ? t('install.ios') : t('install.other');
    $('installSteps').hidden = !isIOS();
  }
}

/* ---------- Language ---------- */

function renderLang() {
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  }
}

function renderAll() {
  localize();
  renderLang();
  renderMode();
  renderStatus();
  renderGames();
}

for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    setLang(b.dataset.lang);
    renderAll();
  });
}

/* ---------- Settings ---------- */

const settings = setupSheet($('settings'));
$('openSettings').addEventListener('click', () => {
  $('savesMsg').textContent = '';
  $('updateMsg').textContent = '';
  openSheet(settings);
});

function savesMessage(text, isError = false) {
  const msg = $('savesMsg');
  msg.textContent = text;
  msg.classList.toggle('is-error', isError);
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('exportBtn').addEventListener('click', async () => {
  const blob = exportAll();
  const n = Object.keys(blob.entries).length;
  if (!n) return savesMessage(t('settings.nothing'));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(blob, null, 2)], `gameplane-saves-${stamp}.json`, {
    type: 'application/json',
  });
  // Share sheet first (iOS: "Save to Files", AirDrop…), download as a fallback.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Gameplane saves' });
      savesMessage(t('settings.exported', { n }));
    } catch (err) {
      if (err.name !== 'AbortError') {
        saveFile(file);
        savesMessage(t('settings.exported', { n }));
      }
    }
    return;
  }
  saveFile(file);
  savesMessage(t('settings.exported', { n }));
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let blob;
  try {
    blob = JSON.parse(await file.text());
    if (blob?.format !== 'gameplane-saves' || typeof blob.entries !== 'object') throw new Error();
  } catch {
    return savesMessage(t('settings.importError'), true);
  }
  const n = Object.keys(blob.entries).filter((k) => k.startsWith('gh:')).length;
  const ok = await confirmDialog(t('settings.importConfirm', { n }), { ok: t('settings.import.do') });
  if (!ok) return;
  try {
    const written = importAll(blob);
    savesMessage(t('settings.imported', { n: written }));
    // The language may have come with the import.
    setLang(createStore('app').peek('lang') || getLang());
    renderAll();
  } catch {
    savesMessage(t('settings.importError'), true);
  }
});

$('checkUpdateBtn').addEventListener('click', async () => {
  const msg = $('updateMsg');
  const btn = $('checkUpdateBtn');
  btn.disabled = true;
  msg.textContent = t('settings.checking');
  const result = await checkForUpdate(reg);
  btn.disabled = false;
  msg.textContent = {
    available: t('settings.updateReady'),
    current: t('settings.upToDate'),
    unreachable: t('settings.unreachable'),
    failed: t('settings.updateFailed'),
  }[result];
  if (result === 'available') $('updateBanner').hidden = false;
  checkHost();
});

$('reloadBtn').addEventListener('click', () => applyUpdate(reg));

/* ---------- Boot ---------- */

renderAll();
loadRegistry();

// Coming back from a game (bfcache or app switch): refresh resume hints and downloads.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) renderGames();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  await refreshPacks();
  renderGames();
  checkHost();
  if (reg) reg.update().catch(() => {});
});
window.addEventListener('online', checkHost);
window.addEventListener('offline', checkHost);
setInterval(() => {
  if (document.visibilityState === 'visible') checkHost();
}, HOST_POLL_MS);
matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
  renderAll();
  checkHost();
});

checkHost();
reg = await registerSW();
watchOfflineStatus(reg, (status) => {
  offline = status;
  renderStatus();
  if (status.state === 'ready') loadPacks();
});
watchForUpdates(reg, () => {
  if (isStandalone()) $('updateBanner').hidden = false;
});
// Quiet update check: fails silently while offline, which is a normal state.
if (reg && navigator.serviceWorker.controller) reg.update().catch(() => {});

persisted = await ensurePersisted();
renderStatus();
renderGames();
