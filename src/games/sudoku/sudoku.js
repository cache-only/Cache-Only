import { formatTime, localize, t } from '../../shared/i18n.js';
import { createSaver, createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { closeSheet, confirmDialog, fitBoard, modalOpen, openSheet, setupSheet, setupSideMenu } from '../../shared/ui.js';
import { LEVELS, analyze, generate } from './generator.js';
import { BOX, COL, PEERS, ROW } from './solver.js';

const SCHEMA = 1;
const LEVEL_IDS = Object.keys(LEVELS);
const MIN_GENERATING_MS = 350;

const $ = (id) => document.getElementById(id);
const store = createStore('sudoku');

localize();
registerSW();

/* ---------- State ---------- */

// S is the saved session. grid/notes are arrays of 81 numbers; notes are 9-bit masks.
let S = null;
let prefs = store.load('prefs', 1) || { showConflicts: true };
let stats = store.load('stats', 1) || { best: {}, solved: {}, hints: 0 };

let running = false;
let startedAt = 0;
let paused = false;
let busy = false;

const elapsed = () => (S ? S.elapsed + (running ? performance.now() - startedAt : 0) : 0);

const saver = createSaver(store, 'session', SCHEMA, () =>
  S
    ? {
        difficulty: S.difficulty,
        seed: S.seed,
        puzzle: S.puzzle,
        solution: S.solution,
        grid: S.grid.join(''),
        notes: S.notes,
        undo: S.undo,
        redo: S.redo,
        elapsed: Math.round(elapsed()),
        hints: S.hints,
        selected: S.selected,
        notesMode: S.notesMode,
        completed: S.completed,
        newBest: S.newBest || false,
        summary: S.completed ? null : { difficulty: S.difficulty, time: Math.round(elapsed()) },
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
    d.notes.length === 81 &&
    Array.isArray(d.undo) &&
    Array.isArray(d.redo)
  );
}

function hydrate(d) {
  return {
    difficulty: d.difficulty in LEVELS ? d.difficulty : 'custom',
    seed: d.seed ?? null,
    puzzle: d.puzzle,
    solution: d.solution,
    grid: Array.from(d.grid, Number),
    notes: d.notes.map((n) => n & 0x1ff),
    undo: d.undo,
    redo: d.redo,
    elapsed: Number(d.elapsed) || 0,
    hints: Number(d.hints) || 0,
    selected: Number.isInteger(d.selected) ? d.selected : -1,
    notesMode: !!d.notesMode,
    completed: !!d.completed,
    newBest: !!d.newBest,
  };
}

const saveStats = () => store.save('stats', 1, stats);
const savePrefs = () => store.save('prefs', 1, prefs);

/* ---------- Clock ---------- */

function startClock() {
  if (running || !S || S.completed || paused || busy || document.hidden || modalOpen()) return;
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
const pending = new Map();

function runLocal(msg) {
  return new Promise((resolve, reject) => {
    // Let the "Generating…" overlay paint first.
    setTimeout(() => {
      try {
        resolve(msg.type === 'generate' ? generate(msg.difficulty, msg.seed) : analyze(msg.text));
      } catch (err) {
        reject(err);
      }
    }, 30);
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
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.error) job.reject(new Error(event.data.error));
    else job.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    workerBroken = true;
    worker.terminate();
    worker = null;
    for (const job of pending.values()) job.fallback();
    pending.clear();
  };
  return worker;
}

function runTask(msg) {
  const w = getWorker();
  if (!w) return runLocal(msg);
  return new Promise((resolve, reject) => {
    const id = ++taskId;
    pending.set(id, { resolve, reject, fallback: () => runLocal(msg).then(resolve, reject) });
    w.postMessage({ id, ...msg });
  });
}

/* ---------- Board ---------- */

const board = $('board');
const cells = new Array(81);

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
      cell.append(v, notes);
      box.append(cell);
      cells[i] = cell;
    }
    board.append(box);
  }
}

function conflicts() {
  const out = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const v = S.grid[i];
    if (!v) continue;
    for (const p of PEERS[i]) {
      if (S.grid[p] === v) {
        out[i] = 1;
        break;
      }
    }
  }
  return out;
}

function render() {
  const sel = S ? S.selected : -1;
  const selVal = sel >= 0 ? S.grid[sel] : 0;
  const bad = S && prefs.showConflicts ? conflicts() : null;
  const counts = new Array(10).fill(0);

  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const v = S ? S.grid[i] : 0;
    const notes = S && !v ? S.notes[i] : 0;
    counts[v]++;
    const cl = cell.classList;
    cl.toggle('given', !!S && S.puzzle[i] !== '0');
    cl.toggle('selected', i === sel);
    cl.toggle('peer', sel >= 0 && i !== sel && (ROW[i] === ROW[sel] || COL[i] === COL[sel] || BOX[i] === BOX[sel]));
    cl.toggle('same', selVal !== 0 && i !== sel && v === selVal);
    cl.toggle('conflict', !!bad && bad[i] === 1);
    cell.firstChild.textContent = v || '';
    const noteEls = cell.lastChild.children;
    for (let d = 1; d <= 9; d++) {
      const on = (notes & (1 << (d - 1))) !== 0;
      noteEls[d - 1].className = on ? (selVal === d ? 'on match' : 'on') : '';
    }
    let label = `${t('sudoku.cell', { r: ROW[i] + 1, c: COL[i] + 1 })}: `;
    if (v) label += v;
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
  $('pad').classList.toggle('is-notes', !!S?.notesMode);
  $('notesBtn').setAttribute('aria-pressed', String(!!S?.notesMode));
  const playing = !!S && !S.completed;
  $('undoBtn').disabled = !playing || !S.undo.length;
  $('redoBtn').disabled = !playing || !S.redo.length;
  $('hintBtn').disabled = !playing;
  $('notesBtn').disabled = !playing;
  $('eraseBtn').disabled = !playing;
  $('levelLabel').textContent = S ? t(`difficulty.${S.difficulty}`) : ' ';
  renderTimer();
}

function renderTimer() {
  $('timer').textContent = formatTime(elapsed());
}

/* ---------- Sheets: new puzzle, solved, enter, share ---------- */

const newSheet = setupSheet($('newSheet'));
const doneSheet = setupSheet($('doneSheet'));
const enterSheet = setupSheet($('enterSheet'));
const shareSheet = setupSheet($('shareSheet'));
const sheets = [newSheet, doneSheet, enterSheet, shareSheet];

function closeSheets() {
  for (const d of sheets) closeSheet(d);
}

for (const d of sheets) {
  // The clock stops while a sheet covers the game.
  d.addEventListener('close', () => setTimeout(startClock, 0));
}

let pickedLevel = 'medium';

function renderLevels() {
  $('levels').replaceChildren(
    ...LEVEL_IDS.map((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.level = id;
      btn.textContent = t(`difficulty.${id}`);
      btn.setAttribute('aria-pressed', String(id === pickedLevel));
      return btn;
    }),
  );
  const [min, max] = LEVELS[pickedLevel];
  const info = [t('sudoku.givens', { min, max })];
  if (stats.best[pickedLevel]) info.push(t('sudoku.bestTime', { time: formatTime(stats.best[pickedLevel]) }));
  $('levelInfo').textContent = info.join(' · ');
}

/** No puzzle going: the sheet is docked and can't be closed. Mid-puzzle: a modal sheet. */
function openNew() {
  menu.close();
  if (S && S.difficulty in LEVELS) pickedLevel = S.difficulty;
  renderLevels();
  const idle = !S || S.completed;
  $('newClose').hidden = idle;
  closeSheet(doneSheet);
  stopClock();
  openSheet(newSheet, { docked: idle });
}

function showDone() {
  $('doneLevel').textContent = t(`difficulty.${S.difficulty}`);
  $('doneTime').textContent = formatTime(S.elapsed);
  $('doneHints').textContent = String(S.hints);
  $('newBest').hidden = !S.newBest;
  openSheet(doneSheet, { docked: true });
}

function setGenerating(on) {
  board.classList.toggle('masked', on);
  $('genNote').hidden = !on;
}

/* ---------- Game flow ---------- */

function inProgress() {
  return !!S && !S.completed && (S.undo.length > 0 || elapsed() > 5000);
}

function firstEmpty(puzzle) {
  return puzzle.indexOf('0');
}

function startSession({ difficulty, seed, puzzle, solution }) {
  S = {
    difficulty,
    seed,
    puzzle,
    solution,
    grid: Array.from(puzzle, Number),
    notes: new Array(81).fill(0),
    undo: [],
    redo: [],
    elapsed: 0,
    hints: 0,
    selected: firstEmpty(puzzle),
    notesMode: false,
    completed: false,
    newBest: false,
  };
  running = false;
  paused = false;
  closeSheets();
  menu.close();
  render();
  saver.flush();
  startClock();
}

async function newGame(difficulty) {
  if (busy) return;
  closeSheets();
  stopClock();
  busy = true;
  setGenerating(true);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const t0 = performance.now();
  try {
    const result = await runTask({ type: 'generate', difficulty, seed });
    const wait = MIN_GENERATING_MS - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    busy = false;
    setGenerating(false);
    startSession({ difficulty, seed, puzzle: result.puzzle, solution: result.solution });
  } catch (err) {
    console.error(err);
    busy = false;
    setGenerating(false);
    if (!S || S.completed) openNew();
    startClock();
  }
}

async function chooseLevel(level) {
  if (inProgress() && !(await confirmDialog(t('sudoku.confirmNew'), { ok: t('sudoku.newPuzzle') }))) return;
  stats.lastLevel = level;
  saveStats();
  newGame(level);
}

function editable(i) {
  return S.puzzle[i] === '0';
}

// changes: Map(index -> [value, notes]). Records one undoable move.
function commit(changes, hint = false) {
  const entries = [];
  for (const [i, [v, n]] of changes) {
    const v0 = S.grid[i];
    const n0 = S.notes[i];
    if (v0 === v && n0 === n) continue;
    entries.push([i, v0, n0, v, n]);
    S.grid[i] = v;
    S.notes[i] = n;
  }
  if (!entries.length) return;
  S.undo.push(hint ? { c: entries, h: 1 } : { c: entries });
  S.redo = [];
  afterChange();
}

function afterChange() {
  render();
  saver.schedule();
  if (S.grid.every((v, i) => v === Number(S.solution[i]))) complete();
}

function canPlay() {
  return S && !S.completed && !paused && !busy;
}

function place(d) {
  if (!canPlay()) return;
  const i = S.selected;
  if (i < 0 || !editable(i)) return;
  const bit = 1 << (d - 1);
  const changes = new Map();
  if (S.notesMode) {
    if (S.grid[i]) return;
    changes.set(i, [0, S.notes[i] ^ bit]);
  } else {
    const v = S.grid[i] === d ? 0 : d;
    changes.set(i, [v, 0]);
    // Placing a digit clears it from the notes of every peer.
    if (v) for (const p of PEERS[i]) if (S.notes[p] & bit) changes.set(p, [S.grid[p], S.notes[p] & ~bit]);
  }
  commit(changes);
}

function erase() {
  if (!canPlay()) return;
  const i = S.selected;
  if (i < 0 || !editable(i)) return;
  commit(new Map([[i, [0, 0]]]));
}

function candidateCount(i) {
  let used = 0;
  for (const p of PEERS[i]) if (S.grid[p]) used |= 1 << (S.grid[p] - 1);
  let n = 0;
  for (let m = ~used & 0x1ff; m; m &= m - 1) n++;
  return n;
}

function hint() {
  if (!canPlay()) return;
  const correct = (i) => S.grid[i] === Number(S.solution[i]);
  let target = -1;
  if (S.selected >= 0 && editable(S.selected) && !correct(S.selected)) target = S.selected;
  if (target < 0) {
    // The empty cell with the fewest candidates: the most natural next step.
    let best = 10;
    for (let i = 0; i < 81; i++) {
      if (S.grid[i]) continue;
      const n = candidateCount(i);
      if (n < best) {
        best = n;
        target = i;
      }
    }
  }
  if (target < 0) target = S.grid.findIndex((v, i) => editable(i) && !correct(i));
  if (target < 0) return;

  const d = Number(S.solution[target]);
  const bit = 1 << (d - 1);
  const changes = new Map([[target, [d, 0]]]);
  for (const p of PEERS[target]) if (S.notes[p] & bit) changes.set(p, [S.grid[p], S.notes[p] & ~bit]);
  S.hints++;
  stats.hints = (stats.hints || 0) + 1;
  saveStats();
  S.selected = target;
  commit(changes, true);
}

function undo() {
  if (!canPlay()) return;
  const move = S.undo.pop();
  if (!move) return;
  for (const [i, v0, n0] of move.c) {
    S.grid[i] = v0;
    S.notes[i] = n0;
  }
  S.redo.push(move);
  S.selected = move.c[0][0];
  afterChange();
}

function redo() {
  if (!canPlay()) return;
  const move = S.redo.pop();
  if (!move) return;
  for (const [i, , , v1, n1] of move.c) {
    S.grid[i] = v1;
    S.notes[i] = n1;
  }
  S.undo.push(move);
  S.selected = move.c[0][0];
  afterChange();
}

function toggleNotes() {
  if (!canPlay()) return;
  S.notesMode = !S.notesMode;
  render();
  saver.schedule();
}

function select(i) {
  if (!S || S.completed || paused || busy) return;
  S.selected = i;
  render();
  saver.schedule();
}

function complete() {
  stopClock();
  S.completed = true;
  S.elapsed = Math.round(S.elapsed);
  S.newBest = false;
  if (S.difficulty in LEVELS) {
    const prev = stats.best[S.difficulty];
    if (!prev || S.elapsed < prev) {
      stats.best[S.difficulty] = S.elapsed;
      S.newBest = true;
    }
    stats.solved[S.difficulty] = (stats.solved[S.difficulty] || 0) + 1;
    saveStats();
  }
  saver.flush();
  render();
  showDone();
}

/* ---------- Side menu: opening it pauses ---------- */

function pause() {
  stopClock();
  if (S && !S.completed && !busy) paused = true;
  $('shareBtn').disabled = !S;
  $('conflictsToggle').checked = !!prefs.showConflicts;
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

function openEnter() {
  menu.close();
  closeSheets();
  stopClock();
  $('enterMsg').textContent = '';
  $('enterMsg').classList.remove('is-error');
  openSheet(enterSheet);
}

function openShare() {
  if (!S) return;
  menu.close();
  closeSheets();
  stopClock();
  $('shareCode').textContent = S.puzzle;
  $('sendBtn').hidden = !navigator.share;
  openSheet(shareSheet);
}

async function submitEntered() {
  const msg = $('enterMsg');
  msg.classList.remove('is-error');
  msg.textContent = t('sudoku.checking');
  let result;
  try {
    result = await runTask({ type: 'analyze', text: $('enterText').value });
  } catch {
    result = { error: 'none' };
  }
  if (result.error) {
    msg.textContent = t(`sudoku.err.${result.error}`, { n: result.n });
    msg.classList.add('is-error');
    return;
  }
  msg.textContent = '';
  enterSheet.close();
  if (inProgress() && !(await confirmDialog(t('sudoku.confirmNew'), { ok: t('sudoku.enterPlay') }))) {
    if (!S || S.completed) openNew();
    startClock();
    return;
  }
  $('enterText').value = '';
  startSession({ difficulty: 'custom', seed: null, puzzle: result.puzzle, solution: result.solution });
}

/* ---------- Input ---------- */

board.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.cell');
  if (cell) select(Number(cell.dataset.i));
});

$('pad').addEventListener('click', (event) => {
  const key = event.target.closest('.key');
  if (key) place(Number(key.dataset.d));
});

$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('notesBtn').addEventListener('click', toggleNotes);
$('hintBtn').addEventListener('click', hint);
$('eraseBtn').addEventListener('click', erase);
$('resumeBtn').addEventListener('click', () => menu.close());
$('menuNewBtn').addEventListener('click', openNew);
$('menuEnterBtn').addEventListener('click', openEnter);
$('shareBtn').addEventListener('click', openShare);
$('newEnterBtn').addEventListener('click', openEnter);
$('doneNewBtn').addEventListener('click', openNew);
$('startBtn').addEventListener('click', () => chooseLevel(pickedLevel));
$('levels').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-level]');
  if (!btn) return;
  pickedLevel = btn.dataset.level;
  renderLevels();
});
$('newSheet').addEventListener('close', () => {
  // Closing it with nothing to play would leave an empty board: it comes back.
  if (!S && !busy) setTimeout(() => !busy && !S && openNew(), 0);
});
$('enterSheet').addEventListener('close', () => {
  if ((!S || S.completed) && !busy && !newSheet.open) setTimeout(() => !busy && (!S || S.completed) && openNew(), 0);
});
$('enterGo').addEventListener('click', submitEntered);
$('enterForm').addEventListener('submit', (event) => {
  if (event.submitter && event.submitter.value === 'close') return;
  event.preventDefault();
  submitEntered();
});

$('conflictsToggle').addEventListener('change', (event) => {
  prefs.showConflicts = event.target.checked;
  savePrefs();
  render();
});

$('copyBtn').addEventListener('click', async () => {
  const label = $('copyBtn').querySelector('span');
  try {
    await navigator.clipboard.writeText(S.puzzle);
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('shareCode'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.execCommand?.('copy');
  }
  label.textContent = t('common.copied');
  setTimeout(() => (label.textContent = t('common.copy')), 1500);
});

$('sendBtn').addEventListener('click', async () => {
  try {
    await navigator.share({ text: S.puzzle });
  } catch {
    /* cancelled */
  }
});

document.addEventListener('keydown', (event) => {
  if (modalOpen() || busy) return;
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
  if (!S || S.completed || document.querySelector('dialog[open]')) return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && k.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  } else if (mod && k.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
  } else if (mod || event.altKey) {
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
  } else if (k === 'h' || k === 'H') {
    hint();
  } else if (k === ' ') {
    event.preventDefault();
    menu.open();
  }
});

// Leaving the app pauses the game; the player resumes deliberately.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (S && !S.completed && !busy) menu.open();
    else stopClock();
  } else {
    startClock();
  }
});

/* ---------- Boot ---------- */

buildBoard();
fitBoard($('boardWrap'), board);
if (stats.lastLevel in LEVELS) pickedLevel = stats.lastLevel;

const saved = store.load('session', SCHEMA);
if (isValidSession(saved)) {
  S = hydrate(saved);
  render();
  if (S.completed) showDone();
  else startClock();
} else {
  render();
  openNew();
}
