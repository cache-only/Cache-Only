// Ktan. For now only its room: a host creates one, others join with the code, and everyone sees
// who's in, whether each one reaches the host directly (same Wi-Fi) or through the room on
// Cloudflare, and how long a message takes there and back (shared/star.js). Waves test the star: a member's wave goes to the host, which
// passes it on to everyone. The game comes once this works on phones (KTAN.md, Part C).
import { getLang, localize } from '../../shared/i18n.js';
import * as Star from '../../shared/star.js';
import { createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { confirmDialog, setupSideMenu } from '../../shared/ui.js';

// Kept here rather than in i18n.js while the page is only a test; the game's strings go there.
const STRINGS = {
  en: {
    room: 'Room',
    title: 'Ktan',
    intro: 'The game is on its way. For now this tests rooms: start one on this phone, then join it from others on the same Wi-Fi, or from anywhere with its code.',
    yourName: 'Your name',
    create: 'New room',
    joinLabel: 'Join with a code',
    join: 'Join',
    code: 'Room code',
    codeNote: 'Others join with this code, from anywhere with internet.',
    members: 'In the room',
    wave: 'Wave',
    end: 'End the room',
    endAsk: 'End the room for everyone?',
    leave: 'Leave the room',
    log: 'Log',
    you: 'You',
    role: 'Role',
    host: 'Host',
    member: 'Member',
    table: 'Table',
    link: 'Link',
    relayed: 'Through the room',
    direct: 'Direct, same Wi-Fi',
    hostsRoom: 'Hosts the room',
    away: 'Away',
    reconnecting: 'Reconnecting…',
    server: 'Room server',
    connected: 'Connected',
    directCount: '{n} of {total} direct',
    roundTrip: 'Round trip',
    waves: 'Waves',
    screen: 'Screen kept on',
    yes: 'Yes',
    no: 'No',
    makeHost: 'Make host',
    seat: 'Seat {n}',
    joining: 'Joining…',
    comingBack: 'Coming back to room {code}…',
    offline: "Can't reach the rooms server. Check this phone is online.",
    roomGone: 'No room has that code.',
    game: 'That room is for another game.',
    token: 'That seat is gone.',
    started: 'That room has started and takes no new players.',
    full: 'That room is full.',
    bad: 'Something went wrong. Try again.',
    ended: 'The host ended the room.',
    replaced: 'This seat was opened on another screen.',
    left: 'You left the room.',
    nearbyTitle: 'On this Wi-Fi',
    nearbyEmpty: 'No rooms here yet. A room started on this Wi-Fi shows up here by itself.',
    roomOf: "{name}'s room",
    waiting: 'Waiting for {name} to let you in…',
    waitingNote: 'On the same Wi-Fi as the host you get in by yourself, in a moment.',
    knocking: 'Wants in',
    letIn: 'Let in',
    turnAway: 'Turn away',
    refused: 'The host turned you away.',
    busy: 'Too many are waiting to get in. Try again in a moment.',
    flood: 'This phone sent too much at once and was disconnected.',
    whereKnown: 'This Wi-Fi reaches the internet at {address}.',
    whereUnknown: "This phone can't tell which Wi-Fi it's on, so rooms here may not show up. Join with the code instead.",
  },
  ca: {
    room: 'Sala',
    title: 'Ktan',
    intro: "El joc és de camí. De moment això prova les sales: crea'n una en aquest telèfon i entra-hi des d'altres a la mateixa wifi, o des de qualsevol lloc amb el seu codi.",
    yourName: 'El teu nom',
    create: 'Sala nova',
    joinLabel: 'Entra amb un codi',
    join: 'Entra',
    code: 'Codi de la sala',
    codeNote: "Els altres hi entren amb aquest codi, des de qualsevol lloc amb internet.",
    members: 'A la sala',
    wave: 'Saluda',
    end: 'Tanca la sala',
    endAsk: 'Vols tancar la sala per a tothom?',
    leave: 'Surt de la sala',
    log: 'Registre',
    you: 'Tu',
    role: 'Paper',
    host: 'Amfitrió',
    member: 'Membre',
    table: 'Taula',
    link: 'Connexió',
    relayed: 'A través de la sala',
    direct: 'Directa, mateixa wifi',
    hostsRoom: 'Fa d’amfitrió',
    away: 'Fora',
    reconnecting: 'Tornant a connectar…',
    server: 'Servidor de sales',
    connected: 'Connectat',
    directCount: '{n} de {total} directes',
    roundTrip: 'Anada i tornada',
    waves: 'Salutacions',
    screen: 'Pantalla sempre encesa',
    yes: 'Sí',
    no: 'No',
    makeHost: 'Fes amfitrió',
    seat: 'Seient {n}',
    joining: 'Entrant…',
    comingBack: 'Tornant a la sala {code}…',
    offline: 'No es pot arribar al servidor de sales. Comprova que aquest telèfon té connexió.',
    roomGone: 'Cap sala té aquest codi.',
    game: 'Aquesta sala és per a un altre joc.',
    token: 'Aquest seient ja no hi és.',
    started: 'Aquesta sala ja ha començat i no admet jugadors nous.',
    full: 'Aquesta sala és plena.',
    bad: 'Alguna cosa ha fallat. Torna-ho a provar.',
    ended: "L'amfitrió ha tancat la sala.",
    replaced: "Aquest seient s'ha obert en una altra pantalla.",
    left: 'Has sortit de la sala.',
    nearbyTitle: 'En aquesta wifi',
    nearbyEmpty: 'Encara no hi ha cap sala. Una sala creada en aquesta wifi hi apareix sola.',
    roomOf: 'Sala de {name}',
    waiting: 'Esperant que {name} et deixi entrar…',
    waitingNote: "A la mateixa wifi que l'amfitrió entres sol, en un moment.",
    knocking: 'Vol entrar',
    letIn: 'Deixa entrar',
    turnAway: 'Rebutja',
    refused: "L'amfitrió no t'ha deixat entrar.",
    busy: "Massa gent espera per entrar. Torna-ho a provar d'aquí a una estona.",
    flood: "Aquest telèfon ha enviat massa coses de cop i s'ha desconnectat.",
    whereKnown: 'Aquesta wifi surt a internet per {address}.',
    whereUnknown: 'Aquest telèfon no pot saber a quina wifi és, així que potser no hi veus les sales. Entra-hi amb el codi.',
  },
};

const s = (key, params = {}) =>
  (STRINGS[getLang()]?.[key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');

const GAME = 'ktan';
const PING_MS = 3000;
const REASON_TEXT = { room: 'roomGone' };
const ENDS_SEAT = new Set(['left', 'ended', 'refused', 'replaced', 'room', 'token', 'game', 'started', 'full', 'busy', 'bad']);
const NEARBY_MS = 4000; // how often the lobby asks which rooms are on this Wi-Fi

const $ = (id) => document.getElementById(id);
const store = createStore('ktan');

localize();
for (const el of document.querySelectorAll('[data-n]')) el.textContent = s(el.dataset.n);
registerSW();

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Device';
}

/* ---------- State ---------- */

let room = null;
let busy = false;
let lobbyNote = '';
let lastFailure = '';
let pinger = 0;
let wakeLock = null;
let seen = new Map(); // seat -> link, as last shown, to log who comes and goes
let seenIn = new Map(); // seat -> whether it was let in, as last shown
const rtt = new Map(); // seat -> { last, min, max }: to each member (host), or to the host (member)
const waves = new Map(); // seat -> waves seen from it
const logLines = [];

function log(line) {
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  logLines.unshift(`${stamp}  ${line}`);
  logLines.length = Math.min(logLines.length, 60);
  console.log('[ktan]', line);
}

const nameOf = (m) => (m ? m.name || (m.table ? s('table') : s('seat', { n: m.seat })) : '?');
const memberAt = (seat) => room?.members.find((m) => m.seat === seat);

/* ---------- Joining ---------- */

function failed(err) {
  const reason = err?.reason || 'bad';
  lastFailure = reason;
  lobbyNote = s(REASON_TEXT[reason] ?? reason);
  log(`could not join: ${reason}`);
}

async function enterWith(promise) {
  busy = true;
  render();
  try {
    enter(await promise);
  } catch (err) {
    failed(err);
  } finally {
    busy = false;
    render();
  }
}

function enter(r) {
  room = r;
  lobbyNote = '';
  seen = new Map();
  seenIn = new Map();
  rtt.clear();
  waves.clear();
  store.save('seat', 1, { code: r.code, token: r.token });
  log(`${r.isHost ? 'hosting' : 'joined'} room ${r.code} as seat ${r.seat}`);

  r.on('members', (members) => {
    for (const m of members) {
      if (m.you) continue;
      const before = seen.get(m.seat);
      if (before === undefined) log(`${nameOf(m)} ${m.admitted ? 'is in' : 'is at the door'} (seat ${m.seat})`);
      else if (m.link === 'away' && before !== 'away') log(`${nameOf(m)} went away`);
      else if (before === 'away' && m.link !== 'away') log(`${nameOf(m)} is back`);
      if (seenIn.get(m.seat) === false && m.admitted) log(`${nameOf(m)} was let in`);
      seen.set(m.seat, m.link);
      seenIn.set(m.seat, m.admitted);
    }
    for (const seat of seen.keys()) {
      if (!members.some((m) => m.seat === seat)) {
        log(`seat ${seat} left`);
        seen.delete(seat);
      }
    }
    render();
  });
  r.on('message', onMessage);
  r.on('host', ({ host, backup }) => {
    rtt.clear();
    log(host === r.seat ? `you host now${backup ? ', with the last backup' : ''}` : `${nameOf(memberAt(host))} hosts now`);
    render();
  });
  r.on('status', (status) => {
    log(`room server ${status}`);
    render();
  });
  r.on('link', (seat, link, why) => {
    const name = nameOf(memberAt(seat));
    log(link === 'direct' ? `direct link with ${name} open` : `no direct link with ${name} (${why}): through the room`);
    render();
  });
  r.on('knock', (m) => {
    log(`${nameOf(m)} wants in`);
    $('announce').textContent = `${nameOf(m)}: ${s('knocking')}`;
    render();
  });
  r.on('admitted', () => {
    log('let in');
    render();
  });
  r.on('closed', (reason) => {
    log(`room closed: ${reason}`);
    if (ENDS_SEAT.has(reason)) store.remove('seat');
    if (room === r) {
      room = null;
      lobbyNote = reason === 'closed' ? '' : s(REASON_TEXT[reason] ?? reason);
      stopPinging();
      render();
      lookNearby();
    }
  });

  startPinging();
  keepScreenOn();
  render();
}

$('nameInput').value = store.load('name', 1) || deviceName();
$('nameInput').addEventListener('change', () => store.save('name', 1, $('nameInput').value.trim()));
$('codeInput').addEventListener('input', () => {
  const input = $('codeInput');
  input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  render();
});
$('codeInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !$('joinBtn').disabled) $('joinBtn').click();
});

const myName = () => $('nameInput').value.trim().slice(0, 24) || deviceName();

$('createBtn').addEventListener('click', () => {
  store.save('name', 1, myName());
  lobbyNote = '';
  enterWith(Star.create({ game: GAME, name: myName() }));
});

$('joinBtn').addEventListener('click', () => {
  store.save('name', 1, myName());
  lobbyNote = s('joining');
  enterWith(Star.join($('codeInput').value, { game: GAME, name: myName() }));
});

$('leaveBtn').addEventListener('click', async () => {
  if (!room) return;
  if (room.isHost) {
    if (!(await confirmDialog(s('endAsk'), { ok: s('end') }))) return;
    room.end();
  } else room.leave();
});

/* ---------- Pings and waves ---------- */

function onMessage(from, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'ping') {
    if (room.isHost) room.sendTo(from, { t: 'pong', at: msg.at });
    else room.send({ t: 'pong', at: msg.at });
  } else if (msg.t === 'pong') {
    const ms = performance.now() - msg.at;
    const r = rtt.get(from);
    rtt.set(from, { last: ms, min: Math.min(r?.min ?? ms, ms), max: Math.max(r?.max ?? ms, ms) });
    render();
  } else if (msg.t === 'wave' && room.isHost) {
    waved(from);
    room.broadcast({ t: 'waved', by: from });
  } else if (msg.t === 'waved') {
    waved(msg.by);
  }
}

function waved(seat) {
  waves.set(seat, (waves.get(seat) ?? 0) + 1);
  const name = seat === room.seat ? s('you') : nameOf(memberAt(seat));
  log(`${name} waved`);
  $('announce').textContent = `${name}: ${s('wave')}`;
  render();
  const row = document.querySelector(`[data-seat="${seat}"]`);
  if (row) {
    row.classList.remove('is-waved');
    void row.offsetWidth;
    row.classList.add('is-waved');
  }
}

$('waveBtn').addEventListener('click', () => {
  if (!room) return;
  if (room.isHost) {
    waved(room.seat);
    room.broadcast({ t: 'waved', by: room.seat });
  } else room.send({ t: 'wave' });
});

function ping() {
  if (!room || !room.admitted || document.hidden || (room.status !== 'open' && !room.local)) return;
  const at = performance.now();
  if (!room.isHost) return room.send({ t: 'ping', at });
  for (const m of room.members) if (!m.you && m.admitted && m.link !== 'away') room.sendTo(m.seat, { t: 'ping', at });
}

function startPinging() {
  stopPinging();
  ping();
  pinger = setInterval(ping, PING_MS);
}

function stopPinging() {
  clearInterval(pinger);
}

/** Keeps the screen on while in a room, so it going dark doesn't count as leaving (KTAN.md, A3). */
async function keepScreenOn() {
  if (!room || wakeLock || !navigator.wakeLock || document.hidden) return render();
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      render();
    });
    log('screen kept on');
  } catch (err) {
    log(`screen lock refused: ${err.name}`);
  }
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !room) return;
  log('back in the foreground');
  room.wake();
  keepScreenOn();
  ping();
});

/* ---------- Page ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function facts(dl, rows) {
  dl.replaceChildren(...rows.flatMap(([label, value, num]) => [el('dt', '', label), el('dd', num ? 'is-num' : '', value)]));
}

const roundTrip = (seat) => {
  const r = rtt.get(seat);
  return r ? `${Math.round(r.last)} ms (${Math.round(r.min)}–${Math.round(r.max)})` : '—';
};

const LINK_TEXT = { host: 'hostsRoom', direct: 'direct', relayed: 'relayed', away: 'away' };
const linkText = (m) => s(LINK_TEXT[m.link] ?? m.link);

function memberRow(m) {
  const row = el('section', 'ktan-member');
  row.dataset.seat = m.seat;
  const head = el('div', 'ktan-member-head');
  const tags = [m.you && s('you'), m.table ? s('table') : m.host && s('host'), !m.admitted && s('knocking')].filter(Boolean).join(' · ');
  head.append(el('h3', 't-heading', nameOf(m)), el('span', 'eyebrow', tags));
  const button = (label, fn) => {
    const btn = el('button', 'btn btn-small', label);
    btn.type = 'button';
    btn.addEventListener('click', fn);
    head.append(btn);
  };
  if (room.isHost && !m.you && !m.admitted) {
    button(s('turnAway'), () => room.refuse(m.seat));
    button(s('letIn'), () => room.admit(m.seat));
  } else if (room.isHost && !m.you && m.link !== 'away') button(s('makeHost'), () => room.handOver(m.seat));
  const dl = el('dl', 'facts');
  // A member measures only its way to the host; the host, its way to every member.
  const measured = !m.you && (room.isHost || m.host);
  facts(dl, [
    [s('link'), linkText(m)],
    [s('roundTrip'), measured ? roundTrip(m.seat) : '—', true],
    [s('waves'), String(waves.get(m.seat) ?? 0), true],
  ]);
  row.append(head, dl);
  return row;
}

function render() {
  $('lobby').hidden = !!room;
  $('inRoom').hidden = !room;
  $('roomStat').textContent = room?.code ?? '—';
  $('createBtn').disabled = busy;
  $('joinBtn').disabled = busy || $('codeInput').value.length !== 4;
  $('lobbyNote').textContent = lobbyNote;
  $('logList').replaceChildren(...logLines.map((line) => el('li', '', line)));
  if (!room) return;

  $('codeBig').textContent = room.code;
  const me = room.members.find((m) => m.you);
  const others = room.members.filter((m) => !m.you && m.link !== 'away');
  facts($('selfFacts'), [
    [s('you'), me ? nameOf(me) : myName()],
    [s('role'), room.isHost ? s('host') : s('member')],
    [s('link'), room.isHost
      ? s('directCount', { n: others.filter((m) => m.link === 'direct').length, total: others.length })
      : linkText(me ?? { link: 'away' })],
    [s('server'), room.status === 'open' ? s('connected') : s('reconnecting')],
    [s('screen'), wakeLock ? s('yes') : s('no')],
  ]);
  $('memberList').replaceChildren(...room.members.map(memberRow));
  $('leaveBtn').textContent = room.isHost ? s('end') : s('leave');
  // Direct links work with the room server out of reach.
  $('waveBtn').disabled = !room.admitted || (room.status !== 'open' && !room.local);
  $('waitNote').hidden = room.admitted;
  $('waitNote').textContent = room.admitted ? '' : s('waiting', { name: nameOf(memberAt(room.host)) });
  $('waitNote2').hidden = room.admitted;
}

/* ---------- Rooms on this Wi-Fi ---------- */

let nearbyRooms = [];
let lastHints = null;
let nearbyTimer = 0;

/** An address with its end hidden: enough to tell two networks apart on screen. */
const masked = (address) => (address.includes(':') ? `${address.split(':').slice(0, 2).join(':')}:…` : address.replace(/\.\d+\.\d+$/, '.x.x'));

async function lookNearby() {
  clearTimeout(nearbyTimer);
  if (room || document.hidden) return;
  nearbyRooms = await Star.nearby({ game: GAME });
  const hints = await Star.networkHint(); // the answer nearby() just used, kept a minute
  $('whereNote').textContent = hints.length ? s('whereKnown', { address: masked(hints[0]) }) : s('whereUnknown');
  if (hints.join() !== lastHints) log(hints.length ? `this Wi-Fi is ${hints.map(masked).join(' and ')}` : 'no STUN answer');
  lastHints = hints.join();
  renderNearby();
  nearbyTimer = setTimeout(lookNearby, NEARBY_MS);
}

function renderNearby() {
  const list = $('nearbyList');
  list.replaceChildren(
    ...nearbyRooms.map((r) => {
      const row = el('div', 'card ktan-near');
      const label = el('div', 'ktan-near-text');
      label.append(el('span', 't-heading', s('roomOf', { name: r.name || '?' })), el('span', 'eyebrow', r.code));
      const btn = el('button', 'btn', s('join'));
      btn.type = 'button';
      btn.disabled = busy;
      btn.addEventListener('click', () => {
        store.save('name', 1, myName());
        lobbyNote = s('joining');
        enterWith(Star.join(r.code, { game: GAME, name: myName() }));
      });
      row.append(label, btn);
      return row;
    }),
  );
  $('nearbyEmpty').hidden = nearbyRooms.length > 0;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !room) lookNearby();
});

const menu = setupSideMenu($('sideMenu'), $('homeBtn'));
$('resumeBtn').addEventListener('click', () => menu.close());

/* ---------- Start: back to the seat this phone had, if any ---------- */

const saved = store.load('seat', 1);
if (saved?.code && saved?.token) {
  lobbyNote = s('comingBack', { code: saved.code });
  // Offline, the seat is kept for another try; a room or seat that's gone is forgotten.
  enterWith(Star.join(saved.code, { game: GAME, token: saved.token })).then(() => {
    if (!room && lastFailure !== 'offline') store.remove('seat');
  });
} else render();
lookNearby();
