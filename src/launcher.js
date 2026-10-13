import { formatPercent, getLang, localize, pick, setLang, t } from './shared/i18n.js';
import { gameArt } from './shared/game-art.js';
import { createLogo, setLogoHaze, setLogoProgress } from './shared/logo.js';
import { createStore, exportAll, importAll, isSaveFile } from './shared/storage.js';
import {
  applyUpdate,
  checkForUpdate,
  countCached,
  downloadPacks,
  dropBrowserCopy,
  ensurePersisted,
  getManifest,
  isStandalone,
  probeHost,
  registerSW,
  watchForUpdates,
  watchOfflineStatus,
} from './shared/sw-client.js';
import { blurLayers, confirmDialog, openSheet, setupSheet } from './shared/ui.js';

const $ = (id) => document.getElementById(id);
const HOST_POLL_MS = 15000;
const appStore = createStore('app');

let registry = [];
let reg = null;
let offline = { state: 'checking' };
let persisted;
let manifest = null; // the active worker's packs
let host = 'unknown'; // 'online' | 'offline' | 'unknown': does the host answer right now?
const onDevice = new Set(); // games whose every file is cached
const progress = new Map(); // id -> { done, total, started } while downloading or queued
const failed = new Set(); // ids whose last download failed
let batch = null; // ids of the downloads running now, for the overall percentage
let bulk = false; // "Download all" is running
let heroId = null;
let updateWaiting = false; // a new worker is installed and waits for a reload

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

/* ---------- Play counter: the suggested game is the one played most ---------- */

function plays() {
  const p = appStore.load('plays', 1);
  return p && typeof p === 'object' ? p : {};
}

/** Counted when a game is opened from the launcher. */
function countPlay(id) {
  const p = plays();
  p[id] = (Number(p[id]) || 0) + 1;
  appStore.save('plays', 1, p);
}

/* ---------- Games ---------- */

/**
 * ready: on this device, playable. downloading: in progress or queued. remote: downloadable
 * now. unavailable: not on this device and the host is out of reach. waiting: not known yet.
 */
function stateOf(game) {
  if (!reg && offline.state !== 'checking') return 'ready'; // no service worker: plain online play
  if (!manifest || !manifest.games[game.id]) return 'waiting';
  if (onDevice.has(game.id)) return 'ready';
  if (progress.has(game.id)) return 'downloading';
  if (host === 'online') return 'remote';
  return host === 'offline' ? 'unavailable' : 'waiting';
}

const fraction = (id) => {
  const p = progress.get(id);
  return p && p.total ? p.done / p.total : 0;
};

function hasSession(id) {
  return !!createStore(id).peek('session')?.summary;
}

/** The most played game on this device; ties and no history go by registry order. */
function suggested() {
  const p = plays();
  const ready = registry.filter((g) => stateOf(g) === 'ready');
  ready.sort((a, b) => (Number(p[b.id]) || 0) - (Number(p[a.id]) || 0) || registry.indexOf(a) - registry.indexOf(b));
  return ready[0] || null;
}

function tileLabel(game, state) {
  const name = pick(game.name);
  if (state === 'ready') return t(hasSession(game.id) ? 'launcher.resumeGame' : 'launcher.playGame', { name });
  if (state === 'downloading') {
    const p = progress.get(game.id);
    return p.started ? t('launcher.downloadingGame', { name, p: formatPercent(fraction(game.id)) }) : t('launcher.queuedGame', { name });
  }
  if (state === 'remote') return t(failed.has(game.id) ? 'launcher.retryGame' : 'launcher.downloadGame', { name });
  if (state === 'unavailable') return t('launcher.needsHostGame', { name });
  return name;
}

function renderTile(game) {
  const state = stateOf(game);
  let tile;
  if (state === 'ready') {
    tile = el('a', 'game-tile');
    tile.href = game.path;
    tile.dataset.play = game.id;
  } else if (state === 'remote' || state === 'downloading') {
    tile = el('button', 'game-tile');
    tile.type = 'button';
    tile.dataset.download = game.id;
    if (state === 'downloading') tile.setAttribute('aria-disabled', 'true');
  } else {
    tile = el('div', 'game-tile');
    tile.setAttribute('role', 'img');
  }
  tile.classList.add(`is-${state}`);
  tile.dataset.id = game.id;
  tile.setAttribute('aria-label', tileLabel(game, state));
  if (state === 'downloading') tile.style.setProperty('--haze', `${((1 - fraction(game.id)) * 8).toFixed(1)}px`);

  const art = el('span', 'game-tile-art');
  art.append(gameArt(game.id, 'tile'));
  tile.append(art, blurLayers('tile'));
  if (state === 'remote' || state === 'unavailable' || state === 'waiting') {
    const icon = el('span', 'game-tile-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.append(svgIcon('i-download'));
    tile.append(icon);
  }
  const name = el('span', 'game-tile-name', pick(game.name));
  name.setAttribute('aria-hidden', 'true');
  tile.append(name);
  const li = el('li');
  li.append(tile);
  return li;
}

function renderSuggest(game) {
  $('suggest').hidden = !game;
  if (game !== null && heroId !== game?.id) {
    heroId = game.id;
    $('hero').replaceChildren(gameArt(game.id, 'hero'));
  } else if (!game) {
    heroId = null;
    $('hero').replaceChildren();
  }
  if (!game) return;
  $('suggestName').textContent = pick(game.name);
  const btn = $('suggestBtn');
  btn.href = game.path;
  btn.dataset.play = game.id;
  btn.textContent = t(hasSession(game.id) ? 'launcher.resume' : 'launcher.play');
  // One primary per screen: while an update waits, the white Update pill is the one.
  btn.classList.toggle('btn-primary', $('reloadBtn').hidden);
}

function missingGames() {
  return manifest ? registry.filter((g) => manifest.games[g.id] && !onDevice.has(g.id)) : [];
}

function renderGames() {
  if (document.body.dataset.view !== 'home') return renderStatus();
  const top = suggested();
  renderSuggest(top);
  const rows = registry.filter((g) => g !== top).map((game, i) => ({ game, i, state: stateOf(game) }));
  // Out of reach of the host, the games on this device come first and the rest wait below.
  if (host === 'offline') rows.sort((a, b) => (a.state === 'unavailable') - (b.state === 'unavailable') || a.i - b.i);
  $('games').replaceChildren(...rows.map((r) => renderTile(r.game)));
  $('gamesSection').hidden = !registry.length;
  renderDownloadAll();
  renderNote();
  renderStatus();
}

/** Updates one tile's focus in place, so the grid doesn't flicker while downloading. */
function renderProgress(id) {
  const tile = $('games').querySelector(`[data-id="${CSS.escape(id)}"]`);
  const game = registry.find((g) => g.id === id);
  if (tile && game) {
    tile.style.setProperty('--haze', `${((1 - fraction(id)) * 8).toFixed(1)}px`);
    tile.setAttribute('aria-label', tileLabel(game, 'downloading'));
  }
  renderStatus();
}

function renderDownloadAll() {
  const missing = missingGames();
  const btn = $('downloadAllBtn');
  btn.hidden = !isStandalone() || !manifest || !missing.length;
  // Dimmed, not removed, while the host is out of reach or something is downloading.
  btn.disabled = host !== 'online' || bulk || progress.size > 0;
}

function renderNote() {
  let note = '';
  if (!reg && offline.state !== 'checking') note = t('status.unsupportedHint');
  else if (manifest && reg) {
    if ([...failed].some((id) => !onDevice.has(id) && !progress.has(id))) note = t('launcher.downloadFailed');
    else if (missingGames().length && host === 'offline') note = t('status.hostOffline');
  }
  $('homeNote').textContent = note;
}

async function loadRegistry() {
  try {
    const res = await fetch('/registry.json');
    registry = await res.json();
  } catch {
    registry = [];
  }
  renderGhosts();
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
}

/** Everything the running downloads have fetched so far, from 0 to 1. */
function batchProgress() {
  if (!batch || !manifest) return 1;
  let done = 0;
  let total = 0;
  for (const id of batch) {
    const files = manifest.games[id].files.length;
    total += files;
    if (onDevice.has(id)) done += files;
    else if (progress.has(id)) done += progress.get(id).done;
  }
  return total ? done / total : 1;
}

async function download(ids) {
  ids = ids.filter((id) => manifest && manifest.games[id] && !onDevice.has(id) && !progress.has(id));
  if (!ids.length || !reg) return;
  for (const id of ids) {
    failed.delete(id);
    progress.set(id, { done: 0, total: manifest.games[id].files.length, started: false });
  }
  batch = [...(batch || []), ...ids];
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
      renderGames();
    }
  });
  for (const id of ids) progress.delete(id);
  // Trust the cache, not the messages.
  await refreshPacks();
  for (const id of ids) if (!onDevice.has(id)) failed.add(id);
  if (!progress.size) batch = null;
  // A newer version may be installed and waiting for a reload: it gets the same games,
  // so taking the update doesn't drop them.
  for (const worker of [reg.waiting, reg.installing]) worker?.postMessage({ type: 'DOWNLOAD', ids });
  renderGames();
  if (ids.some((id) => failed.has(id))) checkHost();
}

async function downloadAll() {
  const ids = missingGames().map((g) => g.id);
  if (!ids.length || bulk) return;
  bulk = true;
  renderDownloadAll();
  try {
    await download(ids);
  } finally {
    bulk = false;
    renderGames();
  }
}

$('games').addEventListener('click', (event) => {
  const tile = event.target.closest('[data-download]');
  if (tile && tile.getAttribute('aria-disabled') !== 'true') download([tile.dataset.download]);
});

// Opening a game from the launcher counts towards the suggestion.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-play]');
  if (link) countPlay(link.dataset.play);
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
  renderGames();
}

/* ---------- Status: the header line, the logo, first launch ---------- */

const barLogo = createLogo();
$('barLogo').append(barLogo);

const prepareLogo = createLogo({ size: 'lg' });
$('prepareMark').querySelector('.intro-logo').append(createLogo({ size: 'lg', glow: true }), prepareLogo);
prepareLogo.setAttribute('role', 'progressbar');
prepareLogo.removeAttribute('aria-hidden');

function statusText() {
  const s = offline;
  if (s.state === 'checking') return t('status.checking');
  if (s.state === 'unsupported' || (s.state === 'failed' && !reg)) return t('status.unsupported');
  if (s.state === 'failed') return t('status.failed');
  if (s.state === 'downloading') return t('status.preparing', { done: s.done ?? 0, total: s.total ?? '…' });
  if (batch) return t('status.line.downloading', { p: formatPercent(batchProgress()) });
  const n = registry.filter((g) => onDevice.has(g.id)).length;
  if (manifest && n === registry.length) return t('status.line.all');
  const counts = { n, total: registry.length };
  return host === 'offline' ? t('status.line.offline', counts) : t('status.line.ready', counts);
}

function renderStatus() {
  const s = offline;
  $('statusLine').textContent = isStandalone() ? statusText() : '';
  // The logo comes into focus as the app and its games download.
  const shellDone = s.state === 'ready' || s.state === 'checking' || !reg;
  setLogoProgress(barLogo, shellDone ? batchProgress() : (s.done ?? 0) / (s.total || 1));

  if (document.body.dataset.view === 'prepare') {
    const total = s.total || 0;
    const p = s.state === 'ready' ? 1 : total ? (s.done ?? 0) / total : 0;
    setLogoProgress(prepareLogo, p);
    prepareLogo.setAttribute('aria-label', t('status.preparingTitle'));
    prepareLogo.setAttribute('aria-valuemin', '0');
    prepareLogo.setAttribute('aria-valuemax', String(total));
    prepareLogo.setAttribute('aria-valuenow', String(s.done ?? 0));
    const failedNow = s.state === 'failed';
    $('prepareCount').textContent = !failedNow && total ? t('status.files', { done: s.done ?? 0, total }) : '';
    $('prepareTitle').textContent = failedNow ? t('status.failed') : t('status.preparingTitle');
    $('prepareText').textContent = failedNow ? t('status.failedHint') : t('status.downloadingHint');
  }

  $('factVersion').textContent = s.version || '—';
  $('factOffline').textContent = s.state === 'ready' ? t('settings.offlineReady') : statusText();
  $('factGames').textContent = manifest ? `${onDevice.size} / ${registry.length}` : '—';
  $('factPersisted').textContent =
    persisted == null ? t('settings.unsupported') : persisted ? t('common.yes') : t('common.no');
}

function renderGhosts() {
  $('ghostTiles').replaceChildren(...registry.map(() => el('span')));
}

/* ---------- Browser tab, first launch or home ---------- */

function viewOf() {
  if (!isStandalone()) return 'install';
  if (reg && (offline.state === 'downloading' || offline.state === 'failed')) return 'prepare';
  return 'home';
}

function renderInstall() {
  const ios = isIOS();
  const steps = ios
    ? [['i-share', 'install.step.share'], ['i-add', 'install.step.add'], [null, 'install.step.open']]
    : [['i-dots', 'install.step.menu'], ['i-add', 'install.step.install'], [null, 'install.step.open']];
  $('installSteps').replaceChildren(
    ...steps.map(([icon, key], i) => {
      const li = el('li', 'glass-row');
      li.append(el('span', 'eyebrow', String(i + 1)), icon ? svgIcon(icon) : createLogo({ size: 'xs' }), el('span', '', t(key)));
      return li;
    }),
  );
}

const installLogo = createLogo({ size: 'lg' });
setLogoHaze(installLogo);
$('installMark').querySelector('.intro-logo').append(createLogo({ size: 'lg', glow: true }), installLogo);

function renderView() {
  const view = viewOf();
  const changed = document.body.dataset.view !== view;
  document.body.dataset.view = view;
  $('install').hidden = view !== 'install';
  $('prepare').hidden = view !== 'prepare';
  $('barActions').hidden = view === 'install';
  renderUpdate();
  if (view !== 'home') {
    $('suggest').hidden = true;
    $('gamesSection').hidden = true;
    $('hero').replaceChildren();
    heroId = null;
  }
  if (view === 'install') renderInstall();
  if (changed && view === 'home') renderGames();
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
  renderView();
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
  renderStatus();
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
  const file = new File([JSON.stringify(blob, null, 2)], `cache-only-saves-${stamp}.json`, {
    type: 'application/json',
  });
  // Share sheet first (iOS: "Save to Files", AirDrop…), download as a fallback.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Cache Only saves' });
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
    if (!isSaveFile(blob)) throw new Error();
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
    setLang(appStore.peek('lang') || getLang());
    heroId = null;
    renderAll();
  } catch {
    savesMessage(t('settings.importError'), true);
  }
});

/** The settings button grows to the left into an Update pill while a new version waits. */
function renderUpdate() {
  const show = updateWaiting && document.body.dataset.view === 'home';
  $('reloadBtn').hidden = !show;
  $('barActions').classList.toggle('has-update', show);
}

function showUpdate() {
  updateWaiting = true;
  renderUpdate();
  renderGames();
}

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
  if (result === 'available') showUpdate();
  checkHost();
});

$('reloadBtn').addEventListener('click', () => applyUpdate(reg));

/* ---------- Boot ---------- */

renderAll();
loadRegistry();

// Coming back from a game (bfcache or app switch): refresh the suggestion, art and downloads.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  heroId = null;
  renderGames();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  await refreshPacks();
  heroId = null;
  renderGames();
  checkHost();
  if (reg) reg.update().catch(() => {});
});
window.addEventListener('online', checkHost);
window.addEventListener('offline', checkHost);
setInterval(() => {
  if (document.visibilityState === 'visible') checkHost();
}, HOST_POLL_MS);
// Chrome can turn this very tab into the app window when it installs.
matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
  renderAll();
  checkHost();
  startApp();
});

let started = false;

/** The offline machinery: only in the installed app, never in a browser tab. */
async function startApp() {
  if (started || !isStandalone()) return;
  started = true;
  reg = await registerSW();
  watchOfflineStatus(reg, (status) => {
    offline = status;
    renderView();
    renderStatus();
    if (status.state === 'ready') loadPacks();
  });
  watchForUpdates(reg, showUpdate);
  // Quiet update check: fails silently while offline, which is a normal state.
  if (reg && navigator.serviceWorker.controller) reg.update().catch(() => {});

  persisted = await ensurePersisted();
  renderView();
  renderStatus();
  renderGames();
}

checkHost();
if (await dropBrowserCopy()) location.reload();
else startApp();
