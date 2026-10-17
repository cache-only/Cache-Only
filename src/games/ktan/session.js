// How a game of Ktan runs on this device, behind one interface the screens use (game.js, table.js):
//   session.kind      'local' (one phone passed round the table), 'host', 'member' or 'table'
//   session.me        the player whose hand this screen shows (null on the table)
//   session.view      what that player may see now (rules.js view)
//   session.act(a)    asks for an action; resolves { ok } or { error }
//   session.subscribe(fn)  fn({ view, events }) after every change, events those that led to it
//
// The host is the only authority (KTAN.md A1): it runs the rules, sends every member its own view
// in full with a revision (no diffs to get wrong, A7) and the events with their secrets stripped,
// backs the game up to the room after every action (A6), and turns away a phone on another protocol
// of the game. A member sends what its player wants and shows what it is told. Messages ride on
// shared/star.js; a lost one costs nothing but an animation, since the next view says it all, and a
// member asks for the view again when it comes back or hears nothing for a while.
import * as R from './rules.js';

export const PROTOCOL = 1; // the game's messages and rules; a host and a member on different ones can't play
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
// Twelve colours to pick from, one per player (the proposals page's picker): spread round the wheel,
// all bright enough to glow on the table's black edge and to dye the ground under a piece.
export const PALETTE = [['ivory', '#efefef'], ['blue', '#5b8cff'], ['red', '#ff6b5b'], ['violet', '#b07cff'], ['teal', '#3fc9d6'], ['pink', '#ff8fd0'],
  ['orange', '#ff9a3d'], ['yellow', '#f2d44e'], ['green', '#2fbf71'], ['lime', '#a6e05a'], ['brown', '#b07a4f'], ['grey', '#8f9bb3']];
export const MARKS = ['diamond', 'circle', 'triangle', 'square', 'plus', 'star'];
const ACT_TIMEOUT = 9000;
const SYNC_MS = 15000;
const BACKUP_MS = 2500; // backups at most this often: each one writes rows in the room's storage
const AWAY_SKIP_MS = 60000;

const freeColour = (taken) => PALETTE.find(([, c]) => !taken.includes(c))?.[1] ?? PALETTE[0][1];
const freeMark = (taken) => MARKS.find((m) => !taken.includes(m)) ?? MARKS[0];

/** Who the screen is waiting on in a game on one phone: the first player the game waits for. */
function actor(s, holder) {
  const w = R.waitingOn(s);
  if (!w.length || w.includes(holder)) return holder;
  return w[0];
}

/** A game on one phone, passed round the table (KTAN.md B7). */
export function localSession(state, { save, restart } = {}) {
  let s = state;
  let holder = actor(s, s.current);
  const subs = new Set();
  const viewNow = () => R.view(s, holder);
  const emit = (events = []) => {
    const v = viewNow(), ev = R.eventsFor(events, holder);
    for (const fn of subs) fn({ view: v, events: ev });
  };
  return {
    kind: 'local',
    get me() { return holder; },
    get view() { return viewNow(); },
    get state() { return s; },
    whoActs: () => actor(s, holder),
    hold(p) {
      holder = p;
      save?.(s, holder);
      emit([]);
    },
    act(action, as = holder) {
      const r = R.apply(s, as, action);
      if (r.error) return Promise.resolve({ error: r.error });
      s = r.state;
      save?.(s, holder);
      emit(r.events);
      return Promise.resolve({ ok: true });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    canRestart: () => true,
    restart: () => restart?.(),
    away: () => false,
  };
}

/**
 * The host of a room (a phone that plays, or the table, which hosts with no seat). Before the game:
 * the lobby, who is in, their colours (and at a table their seats); then the game.
 * restore: { lobby, state, seats } from a save or the room's backup.
 */
export function hostSession(room, { name = '', table = false, restore = null, save, onLobby, onKnock, onClosed } = {}) {
  const lobby = restore?.lobby || { players: [], options: { island: 'starter', away: 'wait' }, table, started: false };
  let state = restore?.state || null;
  let seats = restore?.seats || {}; // Star seat -> player index, once started
  let rev = restore?.rev || 1;
  let pending = []; // events not yet sent (none: everything is sent at once)
  const subs = new Set();
  const lobbySubs = new Set();
  let backupTimer = 0;
  let lastBackup = 0;
  const awaySince = new Map(); // player -> when their seat went away
  const placing = { at: null }; // at a table: the piece a phone is placing and where its ghost stands
  const throws = new Map(); // at a table: a roll's push, from the phone that threw it
  const boards = new Set(); // at a table: the players whose phones show the island themselves
  let seatPhis = {}; // at a table: each player's seat as a view angle, for the island on their phone

  const meSeat = () => room.seat;
  const mePlayer = () => (table ? null : seats[room.seat] ?? null);
  const playerOf = (seat) => seats[seat];
  const seatOf = (p) => Number(Object.keys(seats).find((s) => seats[s] === p));

  if (!table && !lobby.players.some((p) => p.seat === room.seat) && !state) {
    lobby.players.push({ seat: room.seat, name: name || 'Host', color: PALETTE[0][1], mark: MARKS[0], at: null });
  }

  function snapshot() {
    return { lobby, state, seats, rev, code: room.code, token: room.token };
  }
  function persist() {
    save?.(snapshot());
    const now = Date.now();
    clearTimeout(backupTimer);
    const wait = Math.max(0, BACKUP_MS - (now - lastBackup));
    backupTimer = setTimeout(() => {
      lastBackup = Date.now();
      try {
        room.backup({ lobby, state, seats, rev });
      } catch {
        /* not the host any more */
      }
    }, wait);
  }

  /* ----- The lobby ----- */

  function lobbyView() {
    const online = new Map(room.members.map((m) => [m.seat, m]));
    return {
      ...lobby,
      players: lobby.players.map((p) => ({ ...p, link: online.get(p.seat)?.link ?? 'away' })),
      waiting: room.members.filter((m) => !m.admitted).map((m) => ({ seat: m.seat, name: m.name })),
      host: room.seat,
    };
  }
  function sendLobby() {
    if (state) return;
    const L = lobbyView();
    room.broadcast({ t: 'lobby', lobby: L });
    for (const fn of lobbySubs) fn(L);
    persist();
  }
  function join(seat, nm) {
    if (state) return;
    let p = lobby.players.find((x) => x.seat === seat);
    if (!p) {
      if (lobby.players.length >= MAX_PLAYERS) return;
      const taken = lobby.players.map((x) => x.color);
      p = { seat, name: String(nm || '').slice(0, 16) || `#${seat}`, color: freeColour(taken), mark: freeMark(lobby.players.map((x) => x.mark)), at: null };
      lobby.players.push(p);
    } else if (nm) p.name = String(nm).slice(0, 16);
  }
  function pick(seat, color) {
    const p = lobby.players.find((x) => x.seat === seat);
    if (!p || !PALETTE.some(([, c]) => c === color)) return;
    if (lobby.players.some((x) => x !== p && x.color === color)) return;
    p.color = color;
  }
  function sit(seat, at) {
    const p = lobby.players.find((x) => x.seat === seat);
    if (!p || !at || typeof at.side !== 'string' || !(at.pos >= 0 && at.pos <= 1)) return;
    p.at = { side: at.side, pos: at.pos };
  }

  /** Starts the game: turn order is the join order, or clockwise round the table from a random seat. */
  function start() {
    if (state || lobby.players.length < MIN_PLAYERS) return { error: 'players' };
    let order = lobby.players.slice();
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
    if (table) {
      if (order.some((p) => !p.at)) return { error: 'seats' };
      order.sort((a, b) => clockwise(a.at) - clockwise(b.at));
      const first = seed % order.length;
      order = [...order.slice(first), ...order.slice(0, first)];
    }
    const players = order.map(({ name: nm, color, mark }) => ({ name: nm, color, mark }));
    state = R.newGame(seed, players, { island: lobby.options.island === 'random' || players.length > 4 ? 'random' : 'starter' });
    seats = Object.fromEntries(order.map((p, i) => [p.seat, i]));
    lobby.started = true;
    lobby.order = order.map((p) => p.seat);
    room.start();
    rev++;
    persist();
    sendAll([]);
    return { ok: true };
  }

  /* ----- The game ----- */

  function sendAll(events) {
    rev++;
    for (const m of room.members) {
      if (m.you || !m.admitted) continue;
      const p = playerOf(m.seat);
      if (p === undefined) continue;
      room.sendTo(m.seat, { t: 'state', rev, view: R.view(state, p), events: R.eventsFor(events, p), placing: placingFor(p), table, phi: seatPhis[p] });
    }
    const p = mePlayer();
    const v = R.view(state, p);
    for (const fn of subs) fn({ view: v, events: R.eventsFor(events, p), placing: placing.at });
  }
  function sendTo(seat) {
    const p = playerOf(seat);
    if (p === undefined || !state) return;
    room.sendTo(seat, { t: 'state', rev, view: R.view(state, p), events: [], placing: placingFor(p), table, phi: seatPhis[p] });
  }
  const placingFor = (p) => (placing.at && placing.at.p === p ? placing.at : null);

  function apply(p, action, extra = {}) {
    if (!state) return { error: 'started' };
    const r = R.apply(state, p, action);
    if (r.error) return r;
    state = r.state;
    if (extra.throw) for (const e of r.events) if (e.t === 'roll') e.throw = extra.throw;
    if (placing.at && placing.at.p === p && action.type === 'build') placing.at = null;
    persist();
    sendAll(r.events);
    return { ok: true };
  }

  room.on('message', (from, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      // only the protocol has to match (it is raised by hand when the messages or the rules change):
      // a new picture or layout never keeps two phones apart
      if (msg.protocol !== PROTOCOL) {
        room.sendTo(from, { t: 'version', protocol: PROTOCOL });
        return;
      }
      if (!state) {
        join(from, msg.name);
        sendLobby();
      } else sendTo(from);
    } else if (msg.t === 'sync') {
      if (state) sendTo(from);
      else room.sendTo(from, { t: 'lobby', lobby: lobbyView() });
    } else if (msg.t === 'pick' && !state) {
      pick(from, msg.color);
      sendLobby();
    } else if (msg.t === 'sit' && !state) {
      sit(from, msg.at);
      sendLobby();
    } else if (msg.t === 'act') {
      const p = playerOf(from);
      const r = p === undefined ? { error: 'seat' } : apply(p, msg.action, { throw: msg.throw });
      room.sendTo(from, r.ok ? { t: 'ok', id: msg.id } : { t: 'reject', id: msg.id, reason: r.error });
    } else if (msg.t === 'place') {
      // at a table: a phone says which piece it is placing (or none), and where its ghost stands when
      // it was put down on the phone's own board; the table shows where it can go
      const p = playerOf(from);
      if (p === undefined || !state) return;
      const at = Number.isInteger(msg.at) ? msg.at : msg.kind && placing.at?.p === p && placing.at.kind === msg.kind ? placing.at.at : null;
      placing.at = msg.kind ? { p, kind: msg.kind, at } : null;
      for (const fn of subs) fn({ view: R.view(state, mePlayer()), events: [], placing: placing.at });
      sendTo(from);
    } else if (msg.t === 'board') {
      // at a table: this phone shows the island itself, so the table takes no taps for it
      const p = playerOf(from);
      if (p === undefined) return;
      if (msg.on) boards.add(p);
      else boards.delete(p);
      if (state) for (const fn of subs) fn({ view: R.view(state, mePlayer()), events: [], placing: placing.at });
    }
  });
  room.on('members', (members) => {
    const now = Date.now();
    for (const m of members) {
      const p = playerOf(m.seat);
      if (p === undefined) continue;
      if (m.link === 'away') {
        if (!awaySince.has(p)) awaySince.set(p, now);
      } else if (awaySince.has(p)) {
        awaySince.delete(p);
        sendTo(m.seat);
      }
    }
    if (!state) {
      // before the start, a seat that left is gone
      const there = new Set(members.map((m) => m.seat));
      lobby.players = lobby.players.filter((p) => there.has(p.seat) || p.seat === room.seat);
      sendLobby();
    }
    for (const fn of subs) fn({ view: state ? R.view(state, mePlayer()) : null, events: [], members: true });
  });
  room.on('knock', (m) => onKnock?.(m));
  room.on('closed', (reason) => onClosed?.(reason));

  // Away players' turns: with the room set to skip, a player away a minute has their turn played
  // for them as simply as it can be (rules.js autoAction), so the table never waits on a dead phone.
  const skipper = setInterval(() => {
    if (!state || state.phase === 'over' || lobby.options.away !== 'skip') return;
    const now = Date.now();
    for (const p of R.waitingOn(state)) {
      const since = awaySince.get(p);
      if (since === undefined || now - since < AWAY_SKIP_MS) continue;
      const a = R.autoAction(state, p);
      if (a) apply(p, a);
    }
  }, 4000);

  return {
    kind: table ? 'table' : 'host',
    room,
    get me() { return mePlayer(); },
    get view() { return state ? R.view(state, mePlayer()) : null; },
    get state() { return state; },
    get lobby() { return lobbyView(); },
    get started() { return !!state; },
    get seats() { return seats; },
    seatOf,
    act(action, as) {
      const p = as ?? mePlayer();
      if (p === null || p === undefined) return Promise.resolve({ error: 'seat' });
      return Promise.resolve(apply(p, action));
    },
    /** At a table: the table acts for the player placing there (a tap on the table is theirs). */
    actFor: (p, action, extra) => Promise.resolve(apply(p, action, extra)),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    onLobby(fn) {
      lobbySubs.add(fn);
      fn(lobbyView());
      return () => lobbySubs.delete(fn);
    },
    setOption(key, value) {
      if (state) return;
      lobby.options[key] = value;
      sendLobby();
    },
    pick: (color) => {
      pick(room.seat, color);
      sendLobby();
    },
    rename: (nm) => {
      join(room.seat, nm);
      sendLobby();
    },
    start,
    admit: (seat) => room.admit(seat),
    refuse: (seat) => room.refuse(seat),
    away: (p) => awaySince.has(p),
    placing: () => placing.at,
    /** At a table: the ghost of the piece being placed moved to `at` (a tap on the table). */
    ghost(at) {
      if (!placing.at) return;
      placing.at.at = at;
      const seat = seatOf(placing.at.p);
      if (!Number.isNaN(seat)) sendTo(seat);
      for (const fn of subs) fn({ view: R.view(state, mePlayer()), events: [], placing: placing.at });
    },
    throwOf: (p) => throws.get(p),
    /** At a table: whether p's phone shows the island itself (the table then takes no taps for p). */
    boardOn: (p) => boards.has(p),
    /** At a table: each player's seat as a view angle, so the island on their phone faces them. */
    setSeatPhis(map) {
      const was = JSON.stringify(seatPhis);
      seatPhis = map || {};
      if (state && JSON.stringify(seatPhis) !== was) for (const m of room.members) if (!m.you && m.admitted) sendTo(m.seat);
    },
    /** At a table: its screen as it was when the room opened (the frame seats are kept in). */
    setScreen(sc) {
      lobby.screen = sc;
      if (!state) sendLobby();
      else persist();
    },
    canRestart: () => !!state && state.phase === 'over',
    restart() {
      if (!state || state.phase !== 'over') return;
      const players = state.players.map(({ name: nm, color, mark }) => ({ name: nm, color, mark }));
      const seed = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
      state = R.newGame(seed, players, { island: 'random' });
      persist();
      sendAll([]);
    },
    /** Hands the room to another seat: it gets the whole game first (A6). */
    handOver(seat) {
      room.sendTo(seat, { t: 'takeover', backup: { lobby, state, seats, rev } });
      setTimeout(() => room.handOver(seat), 300);
    },
    end() {
      clearInterval(skipper);
      room.end();
    },
    close() {
      clearInterval(skipper);
      clearTimeout(backupTimer);
      room.close();
    },
  };

  // A seat's place clockwise round the table seen from above (the classic game passes to the left):
  // along the bottom edge right to left, up the left edge, along the top left to right, down the
  // right. pos runs left to right along the bottom and top, top to bottom along the sides.
  function clockwise(at) {
    const k = { bottom: 0, left: 1, top: 2, right: 3 }[at.side] ?? 0;
    const along = at.side === 'bottom' || at.side === 'left' ? 1 - at.pos : at.pos;
    return k + along;
  }
}

/** A member of a room: what it sends, and what it shows of what the host says. */
export function memberSession(room, { name = '', onLobby, onVersion, onClosed, onPromoted } = {}) {
  let view = null;
  let rev = 0;
  let lobby = null;
  let placing = null;
  let atTable = false; // an iPad in the middle shows the island: this phone keeps its hand first
  let seatPhi = null; // at a table: where this phone's player sits, as a view angle
  let id = 0;
  const waits = new Map();
  const subs = new Set();
  const lobbySubs = new Set();
  let heard = Date.now();

  const hello = () => room.send({ t: 'hello', name, protocol: PROTOCOL });
  room.on('message', (from, msg) => {
    if (!msg || typeof msg !== 'object') return;
    heard = Date.now();
    if (msg.t === 'state') {
      if (msg.rev < rev && msg.events?.length) return; // an old one overtaken on another way
      rev = msg.rev;
      view = msg.view;
      placing = msg.placing ?? null;
      atTable = !!msg.table;
      seatPhi = Number.isFinite(msg.phi) ? msg.phi : null;
      lobby = null;
      for (const fn of subs) fn({ view, events: msg.events || [], placing });
    } else if (msg.t === 'lobby') {
      lobby = msg.lobby;
      for (const fn of lobbySubs) fn(lobby);
    } else if (msg.t === 'ok' || msg.t === 'reject') {
      const w = waits.get(msg.id);
      if (!w) return;
      waits.delete(msg.id);
      clearTimeout(w.timer);
      w.resolve(msg.t === 'ok' ? { ok: true } : { error: msg.reason || 'rejected' });
    } else if (msg.t === 'version') onVersion?.({ host: msg.protocol, mine: PROTOCOL, older: (msg.protocol || 0) > PROTOCOL ? 'me' : 'host' });
    else if (msg.t === 'takeover') room.takeover = msg.backup;
  });
  room.on('admitted', () => hello());
  room.on('host', ({ host, backup }) => {
    // the host changed: this phone may be the new one (the old one went, or handed over)
    if (host === room.seat) onPromoted?.(backup || room.takeover || null);
    else hello();
  });
  room.on('closed', (reason) => onClosed?.(reason));
  if (room.admitted) hello();
  // a member that hears nothing for a while asks for the view again (a message lost as a link changed way)
  const syncer = setInterval(() => {
    if (Date.now() - heard > SYNC_MS && room.admitted) room.send({ t: 'sync', rev });
  }, SYNC_MS / 3);

  return {
    kind: 'member',
    room,
    get me() { return view ? view.me : null; },
    get view() { return view; },
    get lobby() { return lobby; },
    get started() { return !!view; },
    get table() { return atTable || !!lobby?.table; },
    get phi() { return seatPhi; },
    placing: () => placing,
    act(action, extra = {}) {
      const n = ++id;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waits.delete(n);
          room.send({ t: 'sync', rev });
          resolve({ error: 'timeout' });
        }, ACT_TIMEOUT);
        waits.set(n, { resolve, timer });
        room.send({ t: 'act', id: n, action, ...extra });
      });
    },
    place: (kind, at = null) => room.send({ t: 'place', kind, at }),
    board: (on) => room.send({ t: 'board', on: !!on }),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    onLobby(fn) {
      lobbySubs.add(fn);
      if (lobby) fn(lobby);
      return () => lobbySubs.delete(fn);
    },
    pick: (color) => room.send({ t: 'pick', color }),
    sit: (at) => room.send({ t: 'sit', at }),
    rename: (nm) => room.send({ t: 'hello', name: nm, protocol: PROTOCOL }),
    sync: () => room.send({ t: 'sync', rev }),
    away: () => false,
    canRestart: () => false,
    leave() {
      clearInterval(syncer);
      room.leave();
    },
    close() {
      clearInterval(syncer);
      room.close();
    },
  };
}
