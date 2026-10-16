import { formatTime, localize, t } from '../../shared/i18n.js';
import { createSaver, createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { blurIn, blurOut, closeSheet, confirmDialog, fitBoard, modalOpen, openSheet, setupSheet, setupSideMenu, setupSlider } from '../../shared/ui.js';
import { LEVELS, ladder, levelOf, rungs } from './generator.js';
import { BOX, COL, PEERS, ROW, shuffle } from './solver.js';

const SCHEMA = 1;
const DEFAULT_GIVENS = 34; // the slider's first place: Medium
const NOTE_AFTER_MS = 300; // "Generating…" shows only when a ladder takes longer than this
const REVEAL_MS = 600; // the givens come into focus one after another over this long
const LIVES = 3; // wrong numbers a puzzle forgives, less one
const WRONG_MS = 600; // how long a wrong number stays before it blurs away

const $ = (id) => document.getElementById(id);
const store = createStore('sudoku');

localize();
registerSW();

/* ---------- State ---------- */

// S is the saved session. grid/notes are arrays of 81 numbers; notes are 9-bit masks. The grid
// only ever holds right numbers: a wrong one costs a life and blurs away.
let S = null;
let prefs = store.load('prefs', 1) || {};
let stats = store.load('stats', 1) || { best: {}, solved: {} };

// prefs.givens is where the slider was when the last puzzle started (saves from before the slider
// kept a difficulty instead).
if (!Number.isInteger(prefs.givens)) {
  const band = LEVELS[stats.lastLevel];
  prefs.givens = band ? Math.round((band[0] + band[1]) / 2) : DEFAULT_GIVENS;
}
delete stats.lastLevel;
delete stats.hints;
delete prefs.showConflicts;

let running = false;
let startedAt = 0;
let paused = false;

// Choosing the next puzzle's difficulty: the board shows the ladder's rung under the slider.
let choosing = false;
let lad = null; // { seed, solution, steps } from the worker
let incoming = null; // the ladder on its way
let list = []; // rungs(lad), easiest first
let pickGivens = prefs.givens;
let chooseToken = 0;
let fading = 0; // the numbers of the puzzle before blurring out
let wrongAt = -1; // the cell showing a wrong number for a moment, and the number
let wrongDigit = 0;
let wrongTimer = 0;

const elapsed = () => (S ? S.elapsed + (running ? performance.now() - startedAt : 0) : 0);
/** Nothing to play: no puzzle, or it was solved or ran out of lives. */
const over = () => !S || S.completed || S.lost;

const saver = createSaver(store, 'session', SCHEMA, () =>
  S
    ? {
        difficulty: S.difficulty,
        seed: S.seed,
        puzzle: S.puzzle,
        solution: S.solution,
        grid: S.grid.join(''),
        notes: S.notes,
        lives: S.lives,
        elapsed: Math.round(elapsed()),
        selected: S.selected,
        notesMode: S.notesMode,
        completed: S.completed,
        lost: S.lost,
        newBest: S.newBest || false,
        summary: over() ? null : { difficulty: S.difficulty, time: Math.round(elapsed()) },
      }
    : null,
);

function isValidSession(d) {
  const digits = (s) => typeof s === 'string' && /^[0-9]{81}$/.test(s);
  return (
    d &&
    digits(d.puzzle) &&
    digits(d.solution) &&
    digits(d.grid) &&
    Array.isArray(d.notes) &&
    d.notes.length === 81
  );
}

function hydrate(d) {
  return {
    // A puzzle typed in before that was taken out counts by its givens.
    difficulty: d.difficulty in LEVELS ? d.difficulty : levelOf(d.puzzle.replace(/0/g, '').length),
    seed: d.seed ?? null,
    puzzle: d.puzzle,
    solution: d.solution,
    // Saves from before lives can hold wrong numbers: they go.
    grid: Array.from(d.grid, (ch, i) => (ch === d.solution[i] ? Number(ch) : 0)),
    notes: d.notes.map((n) => n & 0x1ff),
    lives: Number.isInteger(d.lives) ? Math.max(0, Math.min(LIVES, d.lives)) : LIVES,
    elapsed: Number(d.elapsed) || 0,
    selected: Number.isInteger(d.selected) ? d.selected : -1,
    notesMode: !!d.notesMode,
    completed: !!d.completed,
    lost: !!d.lost,
    newBest: !!d.newBest,
  };
}

const saveStats = () => store.save('stats', 1, stats);
const savePrefs = () => store.save('prefs', 1, prefs);

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A time token from styles.css (such as --t-blur) in ms, as el sees it. */
function cssMs(name, el = document.documentElement) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return parseFloat(v) * (v.endsWith('ms') ? 1 : 1000) || 0;
}

/* ---------- Clock ---------- */

function startClock() {
  if (running || over() || paused || choosing || document.hidden || modalOpen()) return;
  running = true;
  startedAt = performance.now();
}

function stopClock() {
  if (!running) return;
  S.elapsed += performance.now() - startedAt;
  running = false;
}

setInterval(() => {
  if (running) renderTimer();
}, 250);

/* ---------- Worker (with a main-thread fallback) ---------- */

let worker = null;
let workerBroken = false;
let taskId = 0;
const jobs = new Map();

function runLocal(seed) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(ladder(seed));
      } catch (err) {
        reject(err);
      }
    }, 0);
  });
}

function getWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker('/games/sudoku/worker.js', { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event) => {
    const job = jobs.get(event.data.id);
    if (!job) return;
    jobs.delete(event.data.id);
    if (event.data.error) job.reject(new Error(event.data.error));
    else job.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    workerBroken = true;
    worker.terminate();
    worker = null;
    for (const job of jobs.values()) job.fallback();
    jobs.clear();
  };
  return worker;
}

function buildLadder(seed) {
  const w = getWorker();
  if (!w) return runLocal(seed);
  return new Promise((resolve, reject) => {
    const id = ++taskId;
    jobs.set(id, { resolve, reject, fallback: () => runLocal(seed).then(resolve, reject) });
    w.postMessage({ id, seed });
  });
}

/** The next puzzle's ladder: the one ready, or a new one. */
function fetchLadder() {
  if (lad) return Promise.resolve(lad);
  if (!incoming) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    incoming = buildLadder(seed).then(
      (result) => {
        incoming = null;
        lad = result;
        return lad;
      },
      (err) => {
        incoming = null;
        throw err;
      },
    );
  }
  return incoming;
}

/* ---------- Board ---------- */

const board = $('board');
const cells = new Array(81);
const vals = new Array(81);
const noteBoxes = new Array(81);
const ghosts = new Array(81);
const ghostOn = new Uint8Array(81);

function buildBoard() {
  for (let b = 0; b < 9; b++) {
    const box = document.createElement('div');
    box.className = 'box';
    for (let k = 0; k < 9; k++) {
      const r = Math.floor(b / 3) * 3 + Math.floor(k / 3);
      const c = (b % 3) * 3 + (k % 3);
      const i = r * 9 + c;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.i = i;
      cell.setAttribute('role', 'button');
      const v = document.createElement('span');
      v.className = 'v';
      const notes = document.createElement('span');
      notes.className = 'notes';
      notes.setAttribute('aria-hidden', 'true');
      for (let d = 1; d <= 9; d++) {
        const n = document.createElement('span');
        n.textContent = d;
        notes.append(n);
      }
      const ghost = document.createElement('span');
      ghost.className = 'ghost';
      ghost.setAttribute('aria-hidden', 'true');
      cell.append(v, notes, ghost);
      box.append(cell);
      cells[i] = cell;
      vals[i] = v;
      noteBoxes[i] = notes;
      ghosts[i] = ghost;
    }
    board.append(box);
  }
}

function render() {
  // While choosing, the board belongs to the puzzle to come: empty squares and its ghosts (once the
  // numbers of the one before have blurred out).
  const P = choosing && !fading ? null : S;
  const sel = P ? P.selected : -1;
  const selVal = sel >= 0 ? P.grid[sel] : 0;
  const counts = new Array(10).fill(0);

  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const v = P ? P.grid[i] : 0;
    const wrong = !!P && i === wrongAt;
    const shown = wrong ? wrongDigit : v;
    const notes = P && !shown ? P.notes[i] : 0;
    counts[v]++;
    const cl = cell.classList;
    cl.toggle('given', !!P && P.puzzle[i] !== '0');
    cl.toggle('selected', i === sel);
    cl.toggle('peer', sel >= 0 && i !== sel && (ROW[i] === ROW[sel] || COL[i] === COL[sel] || BOX[i] === BOX[sel]));
    cl.toggle('same', selVal !== 0 && i !== sel && v === selVal);
    cl.toggle('wrong', wrong);
    vals[i].textContent = shown || '';
    const noteEls = noteBoxes[i].children;
    for (let d = 1; d <= 9; d++) {
      const on = (notes & (1 << (d - 1))) !== 0;
      noteEls[d - 1].className = on ? (selVal === d ? 'on match' : 'on') : '';
    }
    let label = `${t('sudoku.cell', { r: ROW[i] + 1, c: COL[i] + 1 })}: `;
    if (shown) label += shown;
    else if (notes) label += t('sudoku.notesList', { list: [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => notes & (1 << (d - 1))).join(' ') });
    else label += t('sudoku.empty');
    cell.setAttribute('aria-label', label);
    cell.setAttribute('aria-pressed', String(i === sel));
  }

  for (const key of document.querySelectorAll('.key[data-d]')) {
    const done = counts[Number(key.dataset.d)] >= 9;
    key.classList.toggle('is-done', done);
    key.setAttribute('aria-label', done ? t('sudoku.allPlaced', { d: key.dataset.d }) : key.dataset.d);
  }
  const playing = !!P && !over();
  $('pad').classList.toggle('is-notes', playing && P.notesMode);
  $('notesBtn').setAttribute('aria-pressed', String(playing && P.notesMode));
  $('notesBtn').disabled = !playing;
  $('eraseBtn').disabled = !playing;
  $('levelLabel').textContent = S ? t(`difficulty.${S.difficulty}`) : ' ';
  renderLives();
  renderTimer();
}

const lifeEls = [...$('lives').children];

/** The hearts: full while a life is left, hollow once it's spent. */
function renderLives() {
  const n = S ? S.lives : LIVES;
  lifeEls.forEach((el, k) => {
    el.classList.toggle('is-used', k >= n);
    if (k < n) el.classList.remove('is-breaking');
  });
  $('lives').setAttribute('aria-label', t('sudoku.livesLeft', { n }));
}

/** A heart breaking: it cracks, its halves fall away and the hollow heart blurs in. */
function breakLife(k) {
  const el = lifeEls[k];
  el.classList.remove('is-breaking');
  void el.offsetWidth; // start again if it was already breaking
  el.classList.add('is-used', 'is-breaking');
}

// Once the right half has fallen (the halves take the same time), the heart is just hollow.
for (const el of lifeEls) {
  el.addEventListener('animationend', (event) => {
    if (event.animationName === 'life-fall-right') el.classList.remove('is-breaking');
  });
}

function renderTimer() {
  $('timer').textContent = formatTime(elapsed());
}

/**
 * The givens of a puzzle string (null: none) as ghosts: each one its number, blurred past reading,
 * blurring in and out as they change.
 */
function showGhosts(puzzle, animate = true) {
  for (let i = 0; i < 81; i++) {
    const on = !!puzzle && puzzle[i] !== '0';
    if (on === !!ghostOn[i]) continue;
    ghostOn[i] = on ? 1 : 0;
    const ghost = ghosts[i];
    // Every rung shares one solution, so a square's number never changes; one going away keeps it.
    if (on) ghost.dataset.d = puzzle[i];
    ghost.classList.toggle('on', on);
    if (!animate) ghost.classList.remove('blur-in', 'blur-out');
    else if (on) blurIn(ghost);
    else blurOut(ghost);
  }
}

// Into choosing, and Try again, the board blurs out as it was and blurs back in as the other one:
// the puzzle to come, or the same one from the start. Until it has gone (while fading) it keeps
// its look.

/** Ends a swap under way, with the board in plain view. */
function settleBoard() {
  clearTimeout(fading);
  fading = 0;
  board.classList.remove('blur-out');
}

function swapBoard(animate, change) {
  settleBoard();
  if (!animate || calm()) {
    change();
    return;
  }
  blurOut(board);
  fading = setTimeout(() => {
    fading = 0;
    change();
    blurIn(board);
  }, cssMs('--t-blur'));
}

// Start: each ghost comes into focus where it is, one after another in a random order, the way
// the install page's pixels twinkle. Once all are sharp they hand over to the givens under them,
// which look the same.
let revealing = 0;

function endReveal() {
  clearTimeout(revealing);
  if (!board.classList.contains('is-revealing')) return;
  board.classList.remove('is-revealing');
  showGhosts(null, false);
  for (let i = 0; i < 81; i++) {
    ghosts[i].style.transitionDelay = '';
    cells[i].style.transitionDelay = '';
  }
}

function reveal() {
  const still = calm();
  const given = [];
  for (let i = 0; i < 81; i++) if (S.puzzle[i] !== '0') given.push(i);
  shuffle(given, Math.random);
  given.forEach((i, k) => {
    const delay = still ? '' : `${Math.round((k / given.length) * REVEAL_MS)}ms`;
    ghosts[i].style.transitionDelay = delay;
    cells[i].style.transitionDelay = delay;
  });
  board.classList.add('is-revealing');
  render();
  revealing = setTimeout(endReveal, REVEAL_MS + cssMs('--t-twinkle') + 50);
}

/* ---------- Choosing the difficulty ---------- */

const slider = setupSlider($('levelSlider'), {
  onInput(i) {
    pickGivens = list[i].givens;
    describePick();
    showGhosts(list[i].puzzle);
  },
});

// The rung nearest the givens last picked, staying in that difficulty on a tie.
function nearestRung(givens) {
  const cost = (r) => Math.abs(r.givens - givens) + (levelOf(r.givens) === levelOf(givens) ? 0 : 0.5);
  let best = 0;
  list.forEach((r, k) => {
    if (cost(r) < cost(list[best])) best = k;
  });
  return best;
}

function describePick() {
  const r = list[slider.value()];
  $('startBtn').disabled = !r;
  if (!r) {
    $('pickName').textContent = ' ';
    $('pickBest').textContent = '';
    return;
  }
  const level = levelOf(r.givens);
  const name = t(`difficulty.${level}`);
  $('pickName').textContent = name;
  $('pickBest').textContent = stats.best[level] ? t('sudoku.bestTime', { time: formatTime(stats.best[level]) }) : '';
  slider.describe(String(r.givens), t('sudoku.pickValue', { level: name, n: r.givens }));
}

// The moves and the chooser share one place: the one away is blurred out and inert. Without
// animation (opening the page into a phase) they just show or hide.
let chooserHiding = 0;

function away(el, animate) {
  el.inert = true;
  if (animate) blurOut(el);
  else el.style.visibility = 'hidden';
}

function back(el, animate) {
  el.inert = false;
  el.style.visibility = '';
  if (animate) blurIn(el);
  else el.classList.remove('blur-out');
}

function setPhase(choose, animate) {
  for (const el of [$('pad'), $('levelStat'), $('lives')]) {
    if (choose) away(el, animate);
    else back(el, animate);
  }
  const chooser = $('chooser');
  clearTimeout(chooserHiding);
  if (choose) {
    chooser.hidden = false;
    back(chooser, animate);
  } else {
    chooser.inert = true;
    if (!animate) {
      chooser.hidden = true;
      return;
    }
    blurOut(chooser);
    chooserHiding = setTimeout(() => {
      chooser.hidden = true;
      chooser.classList.remove('blur-out');
    }, cssMs('--t-blur'));
  }
}

/** Shows the chooser in the moves' place, with the board showing the puzzle to come. */
async function openNew(animate = true) {
  if (choosing) {
    menu.close();
    return;
  }
  choosing = true;
  const token = ++chooseToken;
  stopClock();
  endReveal();
  // Before the menu closes: closing it renders, and the board must keep its look as it blurs out.
  swapBoard(animate && !!S, render);
  settleWrong();
  menu.close();
  closeSheet(doneSheet);
  closeSheet(lostSheet);
  setPhase(true, animate);

  if (!lad) {
    list = [];
    slider.setSteps(0);
    describePick();
  }
  const note = setTimeout(() => ($('genNote').hidden = false), NOTE_AFTER_MS);
  for (let tries = 0; !lad && tries < 3; tries++) {
    try {
      await fetchLadder();
    } catch (err) {
      console.error(err);
    }
  }
  clearTimeout(note);
  $('genNote').hidden = true;
  if (!lad || token !== chooseToken) return;
  list = rungs(lad);
  slider.setSteps(list.length, nearestRung(pickGivens));
  describePick();
  showGhosts(list[slider.value()].puzzle);
}

function inProgress() {
  if (over()) return false;
  const entered = S.grid.some((v, i) => v && S.puzzle[i] === '0') || S.notes.some(Boolean);
  return entered || S.lives < LIVES || elapsed() > 5000;
}

/**
 * The side menu's Quit puzzle, as Tanks quits a campaign: asked first when there is anything to
 * lose, then the puzzle is gone and the chooser takes its place.
 */
async function quit() {
  if (over() || choosing) return;
  if (inProgress() && !(await confirmDialog(t('sudoku.confirmQuit'), { ok: t('sudoku.quit') }))) return;
  if (over() || choosing) return;
  openNew(); // the board blurs out as it was, so the puzzle goes only after
  S = null;
  saver.flush();
}

/** Starts the puzzle on the slider: its ghosts come into focus as its givens. */
function startPicked() {
  const r = list[slider.value()];
  if (!choosing || !lad || !r) return;
  pickGivens = prefs.givens = r.givens;
  savePrefs();
  S = {
    difficulty: levelOf(r.givens),
    seed: lad.seed,
    puzzle: r.puzzle,
    solution: lad.solution,
    grid: Array.from(r.puzzle, Number),
    notes: new Array(81).fill(0),
    lives: LIVES,
    elapsed: 0,
    selected: r.puzzle.indexOf('0'),
    notesMode: false,
    completed: false,
    lost: false,
    newBest: false,
  };
  lad = null;
  list = [];
  choosing = false;
  ++chooseToken;
  settleBoard();
  running = false;
  paused = false;
  setPhase(false, true);
  reveal();
  saver.flush();
  startClock();
  // The next ladder, ready for the next New puzzle.
  fetchLadder().catch(() => {});
}

/* ---------- Solved, or out of lives ---------- */

const doneSheet = setupSheet($('doneSheet'));
const lostSheet = setupSheet($('lostSheet'));

function showDone() {
  $('doneLevel').textContent = t(`difficulty.${S.difficulty}`);
  $('doneTime').textContent = formatTime(S.elapsed);
  $('newBest').hidden = !S.newBest;
  openSheet(doneSheet, { docked: true });
}

function showLost() {
  openSheet(lostSheet, { docked: true });
}

/** The same puzzle again from the start, with every life back. */
function retry() {
  if (!S || !S.lost) return;
  closeSheet(lostSheet);
  Object.assign(S, {
    grid: Array.from(S.puzzle, Number),
    notes: new Array(81).fill(0),
    lives: LIVES,
    elapsed: 0,
    selected: S.puzzle.indexOf('0'),
    notesMode: false,
    lost: false,
  });
  running = false;
  swapBoard(true, render);
  saver.flush();
  startClock();
}

/* ---------- Game flow ---------- */

function editable(i) {
  return S.puzzle[i] === '0';
}

function afterChange() {
  render();
  saver.schedule();
  if (S.grid.every((v, i) => v === Number(S.solution[i]))) complete();
}

function canPlay() {
  return !over() && !paused && !choosing;
}

/** A number into the selected cell: a note in notes mode, else right (it stays) or wrong (a life). */
function place(d) {
  if (!canPlay()) return;
  const i = S.selected;
  // Givens and right numbers stay put.
  if (i < 0 || !editable(i) || S.grid[i]) return;
  const bit = 1 << (d - 1);
  if (S.notesMode) {
    S.notes[i] ^= bit;
  } else if (d !== Number(S.solution[i])) {
    miss(i, d);
    return;
  } else {
    settleWrong();
    S.grid[i] = d;
    S.notes[i] = 0;
    // Placing a number clears it from the notes of every peer.
    for (const p of PEERS[i]) S.notes[p] &= ~bit;
  }
  afterChange();
}

/** Erase takes a cell's notes away (numbers that stay are right ones). */
function erase() {
  if (!canPlay()) return;
  const i = S.selected;
  if (i < 0 || !editable(i) || S.grid[i] || !S.notes[i]) return;
  S.notes[i] = 0;
  afterChange();
}

/** A wrong number: a life goes, the number shows a moment in red and blurs away. */
function miss(i, d) {
  settleWrong();
  S.lives -= 1;
  wrongAt = i;
  wrongDigit = d;
  if (S.lives <= 0) {
    S.lost = true;
    stopClock();
  }
  render();
  breakLife(S.lives);
  $('announce').textContent = t('sudoku.wrong', { n: S.lives });
  saver.flush();
  wrongTimer = setTimeout(() => {
    blurOut(vals[i]);
    wrongTimer = setTimeout(() => {
      settleWrong();
      render();
      if (S.lost) showLost();
    }, cssMs('--t-blur', vals[i]));
  }, WRONG_MS);
}

/** Ends a wrong number's moment at once. */
function settleWrong() {
  clearTimeout(wrongTimer);
  if (wrongAt >= 0) vals[wrongAt].classList.remove('blur-out');
  wrongAt = -1;
}

function toggleNotes() {
  if (!canPlay()) return;
  S.notesMode = !S.notesMode;
  render();
  saver.schedule();
}

function select(i) {
  if (over() || paused || choosing) return;
  S.selected = i;
  render();
  saver.schedule();
}

function complete() {
  stopClock();
  S.completed = true;
  S.elapsed = Math.round(S.elapsed);
  S.newBest = false;
  const prev = stats.best[S.difficulty];
  if (!prev || S.elapsed < prev) {
    stats.best[S.difficulty] = S.elapsed;
    S.newBest = true;
  }
  stats.solved[S.difficulty] = (stats.solved[S.difficulty] || 0) + 1;
  saveStats();
  saver.flush();
  render();
  showDone();
}

/* ---------- Side menu: opening it pauses ---------- */

function pause() {
  stopClock();
  if (!over() && !choosing) paused = true;
  $('quitBtn').hidden = over() || choosing;
  render();
  saver.flush();
}

function resume() {
  document.activeElement?.blur?.();
  paused = false;
  startClock();
  render();
}

const menu = setupSideMenu($('sideMenu'), $('homeBtn'), { onOpen: pause, onClose: resume });

/* ---------- Input ---------- */

board.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.cell');
  if (cell) select(Number(cell.dataset.i));
});

$('pad').addEventListener('click', (event) => {
  const key = event.target.closest('.key[data-d]');
  if (key) place(Number(key.dataset.d));
});

$('notesBtn').addEventListener('click', toggleNotes);
$('eraseBtn').addEventListener('click', erase);
$('resumeBtn').addEventListener('click', () => menu.close());
$('quitBtn').addEventListener('click', quit);
$('doneNewBtn').addEventListener('click', () => openNew());
$('lostNewBtn').addEventListener('click', () => openNew());
$('retryBtn').addEventListener('click', retry);
$('startBtn').addEventListener('click', startPicked);
doneSheet.addEventListener('close', () => setTimeout(startClock, 0));

document.addEventListener('keydown', (event) => {
  if (modalOpen()) return;
  const k = event.key;
  if (k === 'Escape' || k === 'p' || k === 'P') {
    event.preventDefault();
    if (menu.isOpen()) menu.close();
    else menu.open();
    return;
  }
  if (menu.isOpen()) {
    // Keys work the menu's own items; Space or Enter anywhere else closes it and plays on.
    if ((k === ' ' || k === 'Enter') && !event.target.closest?.('.side-menu')) {
      event.preventDefault();
      menu.close();
    }
    return;
  }
  if (over() || choosing || document.querySelector('dialog[open]')) return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod || event.altKey) {
    return;
  } else if (/^[1-9]$/.test(k)) {
    place(Number(k));
  } else if (k === 'Backspace' || k === 'Delete' || k === '0') {
    erase();
  } else if (k.startsWith('Arrow')) {
    event.preventDefault();
    const i = S.selected < 0 ? 40 : S.selected;
    let r = ROW[i];
    let c = COL[i];
    if (k === 'ArrowUp') r = (r + 8) % 9;
    if (k === 'ArrowDown') r = (r + 1) % 9;
    if (k === 'ArrowLeft') c = (c + 8) % 9;
    if (k === 'ArrowRight') c = (c + 1) % 9;
    select(r * 9 + c);
  } else if (k === 'n' || k === 'N') {
    toggleNotes();
  } else if (k === ' ') {
    event.preventDefault();
    menu.open();
  }
});

// Leaving the app pauses the game; the player resumes deliberately.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!over() && !choosing) menu.open();
    else stopClock();
  } else {
    startClock();
  }
});

/* ---------- Boot ---------- */

buildBoard();
fitBoard($('boardWrap'), board);

const saved = store.load('session', SCHEMA);
if (isValidSession(saved)) {
  S = hydrate(saved);
  render();
  if (S.completed) showDone();
  else if (S.lost) showLost();
  else startClock();
  // Have the next puzzle ready before New puzzle is pressed.
  setTimeout(() => fetchLadder().catch(() => {}), 1000);
} else {
  openNew(false);
}
