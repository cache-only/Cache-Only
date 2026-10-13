import { formatNumber, localize, t } from '../../shared/i18n.js';
import { createSaver, createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { closeSheet, confirmDialog, fitBoard, modalOpen, openSheet, setupSideMenu } from '../../shared/ui.js';
import { SIZE, WIN, newGame, step, undo as undoState } from './logic.js';

const SCHEMA = 1;
const SLIDE_MS = 100;
const SWIPE_PX = 30;

const $ = (id) => document.getElementById(id);
const store = createStore('2048');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

localize();
registerSW();

/* ---------- State ---------- */

function isValidState(d) {
  return (
    d &&
    Array.isArray(d.grid) &&
    d.grid.length === SIZE * SIZE &&
    d.grid.every((v) => Number.isInteger(v) && v >= 0) &&
    Number.isFinite(d.score)
  );
}

function loadState() {
  const d = store.load('session', SCHEMA);
  if (!isValidState(d)) return newGame(Math.random, Number(d?.best) || 0);
  return {
    grid: d.grid,
    score: d.score,
    best: Math.max(Number(d.best) || 0, d.score),
    won: !!d.won,
    keepPlaying: !!d.keepPlaying,
    over: !!d.over,
    undo: d.undo && Array.isArray(d.undo.grid) && d.undo.grid.length === SIZE * SIZE ? d.undo : null,
  };
}

let state = loadState();

const saver = createSaver(store, 'session', SCHEMA, () => ({
  ...state,
  summary: state.over || (state.score === 0 && !state.undo) ? null : { score: state.score },
}));

/* ---------- Rendering ---------- */

const boardEl = $('board');
const tilesEl = $('tiles');
let els = new Array(SIZE * SIZE).fill(null);

function setPos(el, i) {
  el.style.setProperty('--r', Math.floor(i / SIZE));
  el.style.setProperty('--c', i % SIZE);
}

function makeTile(value, i, extra = '') {
  const el = document.createElement('div');
  el.className = `tile ${value <= WIN ? `t${value}` : 'tmax'} ${extra}`.trim();
  el.dataset.len = String(value).length;
  const face = document.createElement('span');
  face.className = 'face';
  face.textContent = value;
  el.append(face);
  setPos(el, i);
  tilesEl.append(el);
  return el;
}

function renderTiles() {
  tilesEl.replaceChildren();
  els = state.grid.map((v, i) => (v ? makeTile(v, i) : null));
  updateLabel();
}

function updateLabel() {
  // A compact text version of the board for screen readers.
  const rows = [];
  for (let r = 0; r < SIZE; r++) rows.push(state.grid.slice(r * SIZE, r * SIZE + SIZE).map((v) => v || '·').join(' '));
  boardEl.setAttribute('aria-description', rows.join(', '));
}

function renderScore(gained = 0) {
  $('score').textContent = formatNumber(state.score);
  $('best').textContent = formatNumber(state.best);
  $('undoBtn').disabled = !state.undo;
  $('overUndoBtn').disabled = !state.undo;
  if (gained > 0 && !reduceMotion.matches) {
    const tag = document.createElement('span');
    tag.className = 'score-gain';
    tag.textContent = `+${gained}`;
    $('score').parentElement.append(tag);
    setTimeout(() => tag.remove(), 650);
  }
}

// Results are docked sheets: the header and its menu still work around them.
const winSheet = $('winSheet');
const overSheet = $('overSheet');

function showOverlay(name) {
  if (name === 'over') $('overText').textContent = t('g2048.overText', { score: formatNumber(state.score) });
  if (name === 'win') openSheet(winSheet, { docked: true });
  else closeSheet(winSheet);
  if (name === 'over') openSheet(overSheet, { docked: true });
  else closeSheet(overSheet);
}

const overlayShown = () => winSheet.open || overSheet.open;

function checkEnd() {
  if (state.won && !state.keepPlaying) showOverlay('win');
  else if (state.over) showOverlay('over');
  else showOverlay(null);
}

/* ---------- Moves (queued during animation, never dropped) ---------- */

const queue = [];
let animating = false;
let epoch = 0; // bumped by reset() so a finishing animation can't touch a newer board

function animate(res) {
  const myEpoch = epoch;
  const next = new Array(SIZE * SIZE).fill(null);
  const dying = [];
  let consistent = true;
  for (const tr of res.transitions) {
    const el = els[tr.from];
    if (!el) {
      consistent = false;
      continue;
    }
    el.classList.remove('new', 'merged');
    setPos(el, tr.to);
    if (tr.merged) dying.push(el);
    else next[tr.to] = el;
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      if (myEpoch !== epoch) return resolve();
      for (const el of dying) el.remove();
      for (const i of new Set(res.transitions.filter((tr) => tr.merged).map((tr) => tr.to))) {
        next[i] = makeTile(state.grid[i], i, 'merged');
      }
      if (res.spawn.index >= 0) next[res.spawn.index] = makeTile(res.spawn.value, res.spawn.index, 'new');
      els = next;
      if (!consistent) renderTiles();
      updateLabel();
      resolve();
    }, SLIDE_MS);
  });
}

function pump() {
  while (queue.length && !animating) {
    if (overlayShown()) {
      queue.length = 0;
      return;
    }
    const res = step(state, queue.shift(), Math.random);
    if (!res.moved) continue;
    state = res.state;
    saver.schedule();
    renderScore(res.gained);
    if (reduceMotion.matches) {
      renderTiles();
      checkEnd();
      continue;
    }
    animating = true;
    const myEpoch = epoch;
    animate(res).then(() => {
      if (myEpoch !== epoch) return;
      animating = false;
      checkEnd();
      pump();
    });
  }
}

function input(dir) {
  if (overlayShown() || modalOpen() || menu.isOpen()) return;
  queue.push(dir);
  pump();
}

/* ---------- Actions ---------- */

function reset(next) {
  epoch++;
  animating = false;
  queue.length = 0;
  state = next;
  renderTiles();
  renderScore();
  checkEnd();
  saver.flush();
}

async function startNew() {
  const midGame = state.score > 0 && !state.over;
  if (midGame && !(await confirmDialog(t('g2048.confirmNew'), { ok: t('common.newGame') }))) return;
  reset(newGame(Math.random, state.best));
}

function undo() {
  if (!state.undo) return;
  reset(undoState(state));
}

/* ---------- Side menu: opening it holds the board ---------- */

const menu = setupSideMenu($('sideMenu'), $('homeBtn'), {
  onOpen() {
    queue.length = 0;
    swipe = null;
    saver.flush();
  },
  onClose() {
    document.activeElement?.blur?.();
  },
});

$('resumeBtn').addEventListener('click', () => menu.close());
$('newBtn').addEventListener('click', () => {
  menu.close();
  startNew();
});
$('winNewBtn').addEventListener('click', () => reset(newGame(Math.random, state.best)));
$('overNewBtn').addEventListener('click', () => reset(newGame(Math.random, state.best)));
$('undoBtn').addEventListener('click', undo);
$('overUndoBtn').addEventListener('click', undo);
$('keepBtn').addEventListener('click', () => {
  state = { ...state, keepPlaying: true };
  saver.flush();
  checkEnd();
});

/* ---------- Input: swipes on the board, arrow keys ---------- */

let swipe = null;

function direction(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

boardEl.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  boardEl.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

boardEl.addEventListener('pointermove', (event) => {
  if (!swipe || event.pointerId !== swipe.id) return;
  event.preventDefault();
  const dir = direction(event.clientX - swipe.x, event.clientY - swipe.y);
  if (dir) {
    swipe = null; // one move per gesture
    input(dir);
  }
});

boardEl.addEventListener('pointerup', (event) => {
  if (!swipe || event.pointerId !== swipe.id) return;
  const dir = direction(event.clientX - swipe.x, event.clientY - swipe.y);
  swipe = null;
  if (dir) input(dir);
});

boardEl.addEventListener('pointercancel', () => (swipe = null));

// iOS: never let a swipe on the board scroll, bounce or start a back gesture.
boardEl.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
boardEl.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });

const KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modalOpen()) {
    event.preventDefault();
    if (menu.isOpen()) menu.close();
    else menu.open();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
    return;
  }
  const dir = KEYS[event.key] || KEYS[event.key.toLowerCase?.()];
  if (!dir) return;
  event.preventDefault();
  input(dir);
});

/* ---------- Boot ---------- */

fitBoard($('boardWrap'), boardEl);
renderTiles();
renderScore();
checkEnd();
