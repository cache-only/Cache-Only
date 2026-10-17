// Ktan (KTAN.md): its screens and how a game is reached. The start: your name, a new room for
// several phones, a game on this phone passed round, the rooms on this Wi-Fi, a room by its code,
// or this device as the table. A room's screen: its code, who is in (letting newcomers in), your
// colour, and Start for the host. Then the game (game.js) or, on the table, the island for
// everyone (table.js). What this device needs to come back to its game is saved as gh:ktan:session.
import { localize, t } from '../../shared/i18n.js';
import * as Star from '../../shared/star.js';
import { createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { closeSheet, confirmDialog, openSheet, setupSheet, setupSideMenu } from '../../shared/ui.js';
import * as R from './rules.js';
import { MARKS, MAX_PLAYERS, MIN_PLAYERS, PALETTE, hostSession, localSession, memberSession } from './session.js';
import { createGame, el, markEl } from './game.js';
import { createTable } from './table.js';

const GAME = 'ktan';
const SCHEMA = 1;
const NEARBY_MS = 4000;
const $ = (id) => document.getElementById(id);
const store = createStore(GAME);
const prefs = { name: '', players: null, island: 'starter', ...(store.load('prefs', 1) || {}) };
const savePrefs = () => store.save('prefs', 1, prefs);

localize();
registerSW();


let session = null; // the game's session (session.js)
let screen = null; // the game's or the table's screen
let room = null; // the Star room, for a room
let nearbyTimer = 0;
let wakeLock = null;

function setScreen(name) {
  document.body.dataset.screen = name;
  $('roomStat').hidden = !(room && (name === 'game' || name === 'room'));
  if (room) $('roomCode').textContent = room.code || '';
  if (name !== 'start') clearTimeout(nearbyTimer);
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return t('ktan.player');
}
const myName = () => ($('nameInput').value.trim().slice(0, 16) || prefs.name || deviceName());

/* ---------- Saving and coming back ---------- */

const summaryOf = (state) => (state ? { players: state.players.length, turn: state.turn, over: state.phase === 'over' } : { lobby: true });
function saveSession(data) {
  if (!data) return store.remove('session');
  store.save('session', SCHEMA, { ...data, summary: summaryOf(data.state || null) });
}

/* ---------- The start ---------- */

$('nameInput').value = prefs.name || '';
$('nameInput').placeholder = deviceName();
$('nameInput').addEventListener('change', () => {
  prefs.name = $('nameInput').value.trim().slice(0, 16);
  savePrefs();
});
$('codeInput').addEventListener('input', () => {
  const input = $('codeInput');
  input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  $('joinBtn').disabled = input.value.length !== 4;
});
$('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !$('joinBtn').disabled) $('joinBtn').click();
});
const startMsg = (text) => ($('startMsg').textContent = text || '');
const REASON = { offline: 'ktan.r.offline', room: 'ktan.r.room', game: 'ktan.r.game', token: 'ktan.r.token', started: 'ktan.r.started', full: 'ktan.r.full', busy: 'ktan.r.busy', refused: 'ktan.r.refused', ended: 'ktan.r.ended', replaced: 'ktan.r.replaced', flood: 'ktan.r.flood', left: 'ktan.r.left' };
const reasonText = (r) => t(REASON[r] || 'ktan.r.bad');

let busy = false;
async function withBusy(fn) {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll('#startScreen .btn')) b.disabled = true;
  try {
    await fn();
  } finally {
    busy = false;
    for (const b of document.querySelectorAll('#startScreen .btn')) b.disabled = false;
    $('joinBtn').disabled = $('codeInput').value.length !== 4;
  }
}

$('newRoomBtn').addEventListener('click', () => withBusy(async () => {
  prefs.name = myName();
  savePrefs();
  startMsg(t('ktan.opening'));
  try {
    const r = await Star.create({ game: GAME, name: prefs.name });
    startMsg('');
    hostRoom(r, { name: prefs.name });
  } catch (err) {
    startMsg(reasonText(err?.reason));
  }
}));

$('tableBtn').addEventListener('click', () => withBusy(async () => {
  startMsg(t('ktan.opening'));
  try {
    const r = await Star.create({ game: GAME, seat: false, name: t('ktan.table') });
    startMsg('');
    hostRoom(r, { table: true });
  } catch (err) {
    startMsg(reasonText(err?.reason));
  }
}));

async function joinCode(code) {
  prefs.name = myName();
  savePrefs();
  startMsg(t('ktan.joining'));
  try {
    const r = await Star.join(code, { game: GAME, name: prefs.name });
    startMsg('');
    memberRoom(r);
  } catch (err) {
    startMsg(reasonText(err?.reason));
  }
}
$('joinBtn').addEventListener('click', () => withBusy(() => joinCode($('codeInput').value)));

async function lookNearby() {
  clearTimeout(nearbyTimer);
  if (document.body.dataset.screen !== 'start' || document.hidden) return;
  const rooms = await Star.nearby({ game: GAME });
  const list = $('nearbyList');
  list.replaceChildren(...rooms.map((r) => {
    const row = el('div', 'ktan-row');
    const text = el('div', 'ktan-row-text');
    text.append(el('span', 'ktan-row-name', t('ktan.roomOf', { name: r.name || '?' })), el('span', 'eyebrow', r.code));
    const b = el('button', 'btn', t('ktan.join'));
    b.type = 'button';
    b.addEventListener('click', () => withBusy(() => joinCode(r.code)));
    row.append(text, b);
    return row;
  }));
  $('nearbyEmpty').hidden = rooms.length > 0;
  nearbyTimer = setTimeout(lookNearby, NEARBY_MS);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.body.dataset.screen === 'start') lookNearby();
});

/* ---------- A game on this phone ---------- */

function defaultPlayers() {
  const names = [myName(), t('ktan.player2'), t('ktan.player3')];
  return names.map((name, i) => ({ name, color: PALETTE[i][1], mark: MARKS[i] }));
}
let localPlayers = prefs.players?.length ? prefs.players.map((p) => ({ ...p })) : null;

$('localBtn').addEventListener('click', () => {
  if (!localPlayers) localPlayers = defaultPlayers();
  localPlayers[0].name = localPlayers[0].name || myName();
  renderLocal();
  setScreen('local');
});
$('localBack').addEventListener('click', () => {
  setScreen('start');
  lookNearby();
});
$('localAdd').addEventListener('click', () => {
  if (localPlayers.length >= MAX_PLAYERS) return;
  const used = localPlayers.map((p) => p.color);
  const free = PALETTE.find(([, c]) => !used.includes(c));
  localPlayers.push({ name: t('ktan.playerN', { n: localPlayers.length + 1 }), color: free[1], mark: MARKS.find((m) => !localPlayers.some((p) => p.mark === m)) });
  renderLocal();
});

function renderLocal() {
  const list = $('localPlayers');
  list.replaceChildren(...localPlayers.map((p, i) => {
    const row = el('div', 'ktan-row');
    const swatch = el('button', 'btn-small');
    swatch.type = 'button';
    swatch.setAttribute('aria-label', t('ktan.changeColour', { name: p.name }));
    swatch.append(markEl(p, 30));
    swatch.addEventListener('click', () => {
      // the next colour nobody else has
      const used = localPlayers.filter((x) => x !== p).map((x) => x.color);
      const at = PALETTE.findIndex(([, c]) => c === p.color);
      for (let k = 1; k <= PALETTE.length; k++) {
        const c = PALETTE[(at + k) % PALETTE.length][1];
        if (!used.includes(c)) {
          p.color = c;
          break;
        }
      }
      renderLocal();
    });
    const name = el('input', 'field is-line');
    name.type = 'text';
    name.maxLength = 16;
    name.value = p.name;
    name.setAttribute('aria-label', t('ktan.playerName', { n: i + 1 }));
    name.addEventListener('input', () => (p.name = name.value));
    row.append(swatch, name);
    if (localPlayers.length > MIN_PLAYERS) {
      const x = el('button', 'icon-btn');
      x.type = 'button';
      x.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
      x.setAttribute('aria-label', t('ktan.removePlayer', { name: p.name }));
      x.addEventListener('click', () => {
        localPlayers.splice(i, 1);
        renderLocal();
      });
      row.append(x);
    }
    return row;
  }));
  $('localAdd').disabled = localPlayers.length >= MAX_PLAYERS;
  segmented($('localIsland'), [['starter', t('ktan.starter')], ['random', t('ktan.random')]], localPlayers.length > 4 ? 'random' : prefs.island, (v) => {
    prefs.island = v;
    savePrefs();
    renderLocal();
  }, localPlayers.length > 4 ? ['starter'] : []);
  $('localIslandNote').textContent = localPlayers.length > 4 ? t('ktan.bigIsland') : prefs.island === 'starter' ? t('ktan.starterNote') : t('ktan.randomNote');
}

function segmented(box, options, value, onPick, off = []) {
  box.replaceChildren(...options.map(([v, label]) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.disabled = off.includes(v);
    b.addEventListener('click', () => onPick(v));
    return b;
  }));
}

$('localStart').addEventListener('click', () => {
  const players = localPlayers.map((p, i) => ({ name: p.name.trim().slice(0, 16) || t('ktan.playerN', { n: i + 1 }), color: p.color, mark: p.mark }));
  prefs.players = players;
  savePrefs();
  const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
  const state = R.newGame(seed, players, { island: players.length > 4 || prefs.island === 'random' ? 'random' : 'starter' });
  playLocal(state, 0);
});

function playLocal(state, holder) {
  const s = localSession(state, {
    save: (st, h) => saveSession({ mode: 'local', state: st, holder: h }),
    restart: () => {
      const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
      const players = s.state.players.map(({ name, color, mark }) => ({ name, color, mark }));
      teardown();
      playLocal(R.newGame(seed, players, { island: 'random' }), 0);
    },
  });
  if (holder !== null && holder !== undefined) s.hold(holder);
  saveSession({ mode: 'local', state, holder: s.me });
  session = s;
  setScreen('game');
  screen = createGame(s, { onLeave: leaveGame });
  menuFor('local');
}

/* ---------- A room ---------- */

function hostRoom(r, { name = '', table = false, restore = null } = {}) {
  room = r;
  const s = hostSession(r, {
    name, table, restore,
    save: (data) => saveSession({ mode: table ? 'table' : 'host', ...data }),
    onKnock: () => renderRoom(),
    onClosed: (reason) => roomClosed(reason),
  });
  session = s;
  keepScreenOn();
  if (s.started) return enterGame();
  saveSession({ mode: table ? 'table' : 'host', ...{ lobby: s.lobby, state: null, seats: {}, code: r.code, token: r.token } });
  if (table) {
    setScreen('table');
    screen = createTable(s, { onLeave: leaveGame });
    menuFor('table');
    return;
  }
  setScreen('room');
  s.onLobby(() => renderRoom());
  r.on('members', () => renderRoom());
  menuFor('room');
}

function memberRoom(r) {
  room = r;
  const s = memberSession(r, {
    name: prefs.name,
    onVersion: ({ older }) => {
      // whoever has the older Ktan updates: this phone, or the one hosting the room
      const text = older === 'me' ? t('ktan.updateApp') : t('ktan.hostUpdate');
      roomMsg(text);
      startMsg(text);
    },
    onClosed: (reason) => roomClosed(reason),
    onPromoted: (backup) => promoted(backup),
  });
  session = s;
  saveSession({ mode: 'member', code: r.code, token: r.token });
  keepScreenOn();
  setScreen('room');
  s.onLobby(() => {
    if (!s.started) renderRoom();
  });
  r.on('members', () => !s.started && renderRoom());
  r.on('admitted', () => renderRoom());
  const unsub = s.subscribe(({ view }) => {
    if (view && !screen) enterGame();
    void unsub;
  });
  menuFor('room');
  renderRoom();
}

/** This phone became the host (the old one was lost, or handed over): it takes the game on. */
function promoted(backup) {
  const r = room;
  teardown({ keepRoom: true });
  hostRoom(r, { name: prefs.name, restore: backup || null });
}

const roomMsg = (text) => ($('roomMsg').textContent = text || '');

function renderRoom() {
  if (!session || document.body.dataset.screen !== 'room') return;
  const r = room;
  const isHost = session.kind === 'host';
  const L = session.lobby;
  $('roomBig').textContent = r.code || '';
  $('roomNote').textContent = isHost ? t('ktan.codeNote') : '';
  const waiting = !r.admitted;
  $('roomWait').hidden = !waiting && !(!isHost && L);
  const hostName = L?.players?.find((p) => p.seat === L.host)?.name || r.members.find((m) => m.host)?.name || '';
  $('roomWait').textContent = waiting ? t('ktan.waitingIn', { name: hostName }) : !isHost ? t('ktan.waitingStart', { name: hostName }) : '';
  $('roomOptions').hidden = !isHost;
  $('roomStart').hidden = !isHost;
  $('roomLeave').textContent = isHost ? t('ktan.endRoom') : t('ktan.leaveRoom');
  const table = !!L?.table;
  $('seatSection').hidden = !table || waiting;
  $('colourSection').hidden = waiting || !L;
  // players, and newcomers at the door
  const list = $('roomPlayers');
  const rows = [];
  for (const p of L?.players || []) {
    const row = el('div', 'ktan-row');
    row.append(markEl(p, 30));
    const text = el('div', 'ktan-row-text');
    const mine = p.seat === r.seat;
    text.append(el('span', 'ktan-row-name', mine ? `${p.name} · ${t('ktan.you')}` : p.name));
    const link = p.seat === L.host ? t('ktan.hostsRoom') : p.link === 'direct' ? t('ktan.direct') : p.link === 'relayed' ? t('ktan.relayed') : t('ktan.awayNow');
    text.append(el('span', 'eyebrow', table ? (p.at ? t('ktan.seated') : t('ktan.choosingSeat')) : link));
    row.append(text);
    rows.push(row);
  }
  if (isHost) {
    for (const m of r.members.filter((x) => !x.admitted)) {
      const row = el('div', 'ktan-row');
      const text = el('div', 'ktan-row-text');
      text.append(el('span', 'ktan-row-name', m.name || '?'), el('span', 'eyebrow', t('ktan.wantsIn')));
      const no = el('button', 'btn', t('ktan.turnAway'));
      no.type = 'button';
      no.addEventListener('click', () => session.refuse(m.seat));
      const yes = el('button', 'btn btn-primary', t('ktan.letIn'));
      yes.type = 'button';
      yes.addEventListener('click', () => session.admit(m.seat));
      row.append(text, no, yes);
      rows.push(row);
    }
  }
  list.replaceChildren(...rows);
  // colours: a taken one shows its taker's mark and name, and can't be picked
  const me = L?.players?.find((p) => p.seat === r.seat);
  const grid = $('colourGrid');
  grid.replaceChildren(...PALETTE.map(([key, c]) => {
    const taker = L?.players?.find((p) => p.color === c);
    const b = el('button', 'ktan-swatch');
    b.type = 'button';
    const dot = el('span', 'ktan-swatch-dot');
    dot.style.setProperty('--c', c);
    dot.style.setProperty('--mk', luma(c) > 0.7 ? '#2b2824' : '#f6efe0');
    if (taker) dot.innerHTML = markEl(taker).innerHTML;
    b.append(dot, el('span', '', taker && taker !== me ? taker.name : t(`ktan.colour.${key}`)));
    b.disabled = !!taker && taker !== me;
    b.setAttribute('aria-pressed', String(taker === me && !!me));
    b.setAttribute('aria-label', taker && taker !== me ? t('ktan.colourTaken', { colour: t(`ktan.colour.${key}`), name: taker.name }) : t(`ktan.colour.${key}`));
    b.addEventListener('click', () => session.pick(c));
    return b;
  }));
  $('colourNote').textContent = me ? t('ktan.colourNote', { colour: t(`ktan.colour.${PALETTE.find(([, c]) => c === me.color)?.[0] || 'ivory'}`) }) : '';
  if (isHost) {
    const big = (L?.players?.length || 0) > 4;
    segmented($('roomIsland'), [['starter', t('ktan.starter')], ['random', t('ktan.random')]], big ? 'random' : L.options.island, (v) => session.setOption('island', v), big ? ['starter'] : []);
    segmented($('roomAway'), [['wait', t('ktan.awayWait')], ['skip', t('ktan.awaySkip')]], L.options.away, (v) => session.setOption('away', v));
    const n = L.players.length;
    $('roomStart').disabled = n < MIN_PLAYERS || (table && L.players.some((p) => !p.at));
    $('roomStart').textContent = n < MIN_PLAYERS ? t('ktan.needPlayers', { n: MIN_PLAYERS }) : t('ktan.startWith', { n });
  }
  if (table && !waiting) renderSeatPick(L, me);
}
const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
};

// Where you sit at the table: the iPad drawn in its real proportions, everyone seated so far round
// it, and a tap on the edge in front of you takes your seat (it shows on the table at once).
function renderSeatPick(L, me) {
  const box = $('seatPick');
  let cv = box.querySelector('canvas');
  if (!cv) {
    cv = document.createElement('canvas');
    box.append(cv);
    box.addEventListener('pointerdown', (e) => {
      const r = box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const at = seatAt(box.lobbyFrame, x, y);
      if (at) session.sit(at);
    });
  }
  const W = box.clientWidth, H = box.clientHeight, dpr = devicePixelRatio || 1;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const aspect = L.screen?.w && L.screen?.h ? L.screen.w / L.screen.h : 1180 / 820;
  let pw = W * 0.7, ph = pw / aspect;
  if (ph > H * 0.62) {
    ph = H * 0.62;
    pw = ph * aspect;
  }
  const px = (W - pw) / 2, py = (H - ph) / 2;
  box.lobbyFrame = { px, py, pw, ph };
  // the iPad: a dark slab with its screen, the camera dot on the side where it really is
  g.fillStyle = '#2a2a2c';
  roundRect(g, px - 9, py - 9, pw + 18, ph + 18, 22);
  g.fill();
  g.fillStyle = '#0b0b0b';
  roundRect(g, px, py, pw, ph, 13);
  g.fill();
  g.fillStyle = '#0b0b0b';
  const cam = L.screen?.camera || 'left';
  const cx = cam === 'left' ? px - 5 : cam === 'right' ? px + pw + 5 : px + pw / 2, cy = cam === 'top' ? py - 5 : cam === 'bottom' ? py + ph + 5 : py + ph / 2;
  g.beginPath();
  g.arc(cx, cy, 2.5, 0, Math.PI * 2);
  g.fill();
  for (const p of L.players) {
    if (!p.at) continue;
    const [x, y, horiz] = edgePoint(box.lobbyFrame, p.at);
    g.fillStyle = p.color;
    g.shadowColor = p.color;
    g.shadowBlur = 10;
    if (horiz) g.fillRect(x - 26, y - 1.5, 52, 3);
    else g.fillRect(x - 1.5, y - 26, 3, 52);
    g.shadowBlur = 0;
    // their mark beside the edge, outside the iPad
    const o = { bottom: [0, 26], top: [0, -26], left: [-26, 0], right: [26, 0] }[p.at.side];
    g.beginPath();
    g.arc(x + o[0], y + o[1], 14, 0, Math.PI * 2);
    g.fill();
  }
  $('seatNote').textContent = me?.at ? t(`ktan.sitting.${me.at.side}`) : t('ktan.tapEdge');
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function edgePoint(f, at) {
  if (at.side === 'bottom') return [f.px + at.pos * f.pw, f.py + f.ph, true];
  if (at.side === 'top') return [f.px + at.pos * f.pw, f.py, true];
  if (at.side === 'left') return [f.px, f.py + at.pos * f.ph, false];
  return [f.px + f.pw, f.py + at.pos * f.ph, false];
}
function seatAt(f, x, y) {
  if (!f) return null;
  const d = { bottom: Math.abs(y - (f.py + f.ph)), top: Math.abs(y - f.py), left: Math.abs(x - f.px), right: Math.abs(x - (f.px + f.pw)) };
  const side = Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
  const pos = side === 'bottom' || side === 'top' ? (x - f.px) / f.pw : (y - f.py) / f.ph;
  return { side, pos: Math.max(0.05, Math.min(0.95, pos)) };
}

$('roomStart').addEventListener('click', () => {
  if (session?.kind !== 'host') return;
  const r = session.start();
  if (r.error) roomMsg(t(`ktan.err.${r.error}`));
  else enterGame();
});
$('roomLeave').addEventListener('click', async () => {
  if (!session) return;
  if (session.kind === 'host') {
    if (!(await confirmDialog(t('ktan.endAsk'), { ok: t('ktan.endRoom') }))) return;
    session.end();
  } else session.leave?.();
  teardown();
  saveSession(null);
  setScreen('start');
  lookNearby();
});

function enterGame() {
  if (screen) screen.destroy();
  screen = null;
  if (session.kind === 'table') {
    setScreen('table');
    screen = createTable(session, { onLeave: leaveGame });
    menuFor('table');
    return;
  }
  setScreen('game');
  // at a table the hand comes first; the island is on the phone only when its board button is on
  // (each phone keeps its own choice)
  const atTable = !!session.lobby?.table || !!session.table;
  screen = createGame(session, {
    onLeave: leaveGame, onRoom: openRoomSheet,
    table: atTable ? { board: prefs.board === true, setBoard: (on) => { prefs.board = !!on; savePrefs(); } } : null,
  });
  menuFor(session.kind);
}

function roomClosed(reason) {
  if (['left', 'ended', 'refused', 'replaced', 'room', 'token', 'started', 'full', 'busy'].includes(reason)) saveSession(null);
  if (reason === 'closed') return;
  teardown();
  setScreen('start');
  startMsg(reasonText(reason));
  lookNearby();
}

function teardown({ keepRoom = false } = {}) {
  screen?.destroy();
  screen = null;
  if (!keepRoom) {
    try {
      session?.close?.();
    } catch {
      /* gone */
    }
    room = null;
  }
  session = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

async function leaveGame() {
  if (!session) return;
  const local = session.kind === 'local';
  const host = session.kind === 'host' || session.kind === 'table';
  const ask = local ? t('ktan.leaveLocalAsk') : host ? t('ktan.endAsk') : t('ktan.leaveAsk');
  if (!(await confirmDialog(ask, { ok: local ? t('ktan.leave') : host ? t('ktan.endRoom') : t('ktan.leaveRoom') }))) return;
  if (host) session.end();
  else if (!local) session.leave?.();
  teardown();
  saveSession(null);
  setScreen('start');
  lookNearby();
}

/** Keeps the screen on while in a room or at the table, so it going dark doesn't count as leaving (A3). */
async function keepScreenOn() {
  if (wakeLock || !navigator.wakeLock || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    /* refused: fine */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  room?.wake?.();
  if (room) keepScreenOn();
  if (session?.kind === 'member') session.sync?.();
});

/* ---------- The side menu ---------- */

const menu = setupSideMenu($('sideMenu'), $('homeBtn'));
$('resumeBtn').addEventListener('click', () => menu.close());
function menuFor(kind) {
  const inGame = kind !== 'room';
  $('logBtn').hidden = !inGame || kind === 'table';
  $('rulesBtn').hidden = false;
  $('roomBtn').hidden = kind === 'local' || !room;
  $('leaveBtn').hidden = false;
  $('leaveLabel').textContent = kind === 'local' ? t('ktan.leave') : kind === 'host' || kind === 'table' ? t('ktan.endRoom') : t('ktan.leaveRoom');
}
menuFor('start');
$('leaveBtn').hidden = true;
$('roomBtn').hidden = true;
$('logBtn').hidden = true;
$('logBtn').addEventListener('click', () => {
  menu.close();
  screen?.openLog?.();
});
$('rulesBtn').addEventListener('click', () => {
  menu.close();
  openRules();
});
$('roomBtn').addEventListener('click', () => {
  menu.close();
  openRoomSheet();
});
$('leaveBtn').addEventListener('click', () => {
  menu.close();
  if (document.body.dataset.screen === 'room') $('roomLeave').click();
  else leaveGame();
});

const sheet2 = $('sheet2');
setupSheet(sheet2);
function simpleSheet(title, nodes) {
  const inner = el('div', 'sheet-inner');
  const h = el('div', 'sheet-head');
  h.append(el('h2', 't-heading', title));
  const x = el('button', 'icon-btn');
  x.type = 'button';
  x.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
  x.setAttribute('aria-label', t('common.close'));
  x.addEventListener('click', () => closeSheet(sheet2));
  h.append(x);
  inner.append(h, ...nodes);
  sheet2.replaceChildren(inner);
  openSheet(sheet2);
}

function openRules() {
  const box = el('div', 'ktan-rules');
  const parts = ['goal', 'setup', 'turn', 'build', 'trade', 'seven', 'dev', 'awards', 'win'];
  for (const k of parts) {
    box.append(el('h3', 't-heading', t(`ktan.rules.${k}.h`)));
    for (const line of t(`ktan.rules.${k}`).split('\n')) box.append(el('p', '', line));
  }
  simpleSheet(t('ktan.rules'), [box]);
}

function openRoomSheet() {
  if (!room || !session) return;
  const facts = el('dl', 'facts');
  facts.append(el('dt', '', t('ktan.roomCode')), el('dd', 'is-num', room.code || ''));
  const list = el('div', 'ktan-players');
  const L = session.lobby;
  for (const m of room.members) {
    if (m.table && session.kind !== 'table') continue;
    const row = el('div', 'ktan-row');
    const p = L?.players?.find((x) => x.seat === m.seat) || { name: m.name || (m.table ? t('ktan.table') : '?'), color: '#4a4a4a', mark: 'circle' };
    row.append(markEl(p, 26));
    const text = el('div', 'ktan-row-text');
    const link = m.host ? t('ktan.hostsRoom') : m.link === 'direct' ? t('ktan.direct') : m.link === 'relayed' ? t('ktan.relayed') : t('ktan.awayNow');
    text.append(el('span', 'ktan-row-name', m.you ? `${p.name} · ${t('ktan.you')}` : p.name), el('span', 'eyebrow', link));
    row.append(text);
    if (session.kind === 'host' && !m.you && m.link !== 'away' && m.admitted) {
      const b = el('button', 'btn', t('ktan.makeHost'));
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (!(await confirmDialog(t('ktan.makeHostAsk', { name: p.name }), { ok: t('ktan.makeHost') }))) return;
        session.handOver(m.seat);
        closeSheet(sheet2);
      });
      row.append(b);
    }
    list.append(row);
  }
  const nodes = [facts, el('p', 'eyebrow', t('ktan.inRoom')), list];
  if (session.kind === 'host') {
    const seg = el('div', 'segmented');
    const opts = session.lobby?.options || {};
    segmented(seg, [['wait', t('ktan.awayWait')], ['skip', t('ktan.awaySkip')]], opts.away || 'wait', (v) => {
      opts.away = v;
      openRoomSheet();
    });
    nodes.push(el('p', 'eyebrow', t('ktan.away')), seg);
  }
  simpleSheet(t('ktan.roomMenu'), nodes);
}

/* ---------- Coming back ---------- */

async function resume() {
  const saved = store.load('session', SCHEMA);
  if (!saved) {
    setScreen('start');
    lookNearby();
    return;
  }
  if (saved.mode === 'local' && saved.state) {
    playLocal(saved.state, saved.holder);
    return;
  }
  if (saved.code && saved.token) {
    setScreen('start');
    startMsg(t('ktan.comingBack', { code: saved.code }));
    try {
      const r = await Star.join(saved.code, { game: GAME, token: saved.token });
      startMsg('');
      if (r.isHost) hostRoom(r, { name: prefs.name, table: saved.mode === 'table', restore: saved.state || saved.lobby ? saved : null });
      else memberRoom(r);
      return;
    } catch (err) {
      startMsg(reasonText(err?.reason));
      if (err?.reason !== 'offline') saveSession(null);
    }
  }
  setScreen('start');
  lookNearby();
}
// For checks in a browser's console or a test: the game's session and its screen.
window.ktan = { get session() { return session; }, get screen() { return screen; } };
resume();
