// Star: the app's multiplayer layer (KTAN.md, Part A). One device hosts a room and is the only
// authority; every other device is a member and talks to the host alone. Each member reaches the
// host one of two ways: directly, over a WebRTC data channel on the local network (same Wi-Fi), or
// relayed through the room on Cloudflare (worker/rooms.js), the one origin besides the app's own
// that the app may reach, and only to carry messages: the games themselves are downloaded packs
// like any other. DOM-free, so the tests run it against an in-memory room and radio
// (tests/fake-rooms.mjs).
//
//   const room = await Star.create({ game: 'ktan', name });         // host
//   const room = await Star.create({ game: 'ktan', seat: false });  // a table: hosts, with no seat
//   const room = await Star.join(code, { game: 'ktan', name });     // a new seat
//   const room = await Star.join(code, { game: 'ktan', token });    // a seat coming back
//   const rooms = await Star.nearby({ game: 'ktan' });               // [{ code, name }] on this network
//
//   room.on('members', (members) => …)      // who's in, and how each reaches the host
//   room.on('message', (from, msg) => …)    // from a seat (members only ever hear the host)
//   room.on('host', ({ host, backup }) => …) // the host changed; backup is set for the new host
//   room.on('status', (status) => …)        // the room's connection: 'open' | 'reconnecting' | 'closed'
//   room.on('link', (seat, link, why) => …) // a direct link to that seat opened ('direct') or ended
//   room.on('knock', (member) => …)         // host: a new seat waits to be let in
//   room.on('admitted', () => …)            // member: the host let this seat in
//   room.on('closed', (reason) => …)        // 'left' | 'ended' | 'refused' | 'replaced' | 'room' | …
//   room.send(msg)  room.sendTo(seat, msg)  room.broadcast(msg)  room.backup(state)
//   room.admit(seat)  room.refuse(seat)  room.start()  room.handOver(seat)  room.end()
//   room.leave()  room.close()  room.wake()
//
// A failed create or join rejects with an Error whose reason is 'offline', 'room' (no such room),
// 'game', 'token', 'started' (it takes no new seats), 'full', 'busy' (too many waiting) or 'bad'.
//
// A new seat waits until the host lets it in (room.admitted is false meanwhile): by hand, with
// admit(), or by itself once the seat links to it directly, since a direct link only opens on the
// same network. To make sure of that, each side drops every address that isn't local, both from
// its own offer or answer before sending it and from the other's before using it, so nobody can
// link from outside by slipping in a public address or by reaching one of ours. While waiting, a seat can reach the host to link directly and nothing else: the host
// passes its game messages over, and broadcasts skip it.
//
// Each member tries a direct link to the host as soon as it is in, and again after one fails or
// ends (members offer, the host answers, both through the room: one offer and one answer, local
// addresses only, no STUN or TURN). While a link is direct, everything between the two goes over
// it, and the room only sees the pings that keep the seat. The room's connection stays up when it
// can, so a lost host is still noticed; if the internet goes, direct links carry on alone.
// Messages arrive at most once and in order on each way, but one sent just as a link changes way
// can overtake or be lost: games send whole views (with a revision) rather than changes.

export const ROOMS = 'wss://cache-only-rooms.cache-only.workers.dev';

// Asked once a minute at most, on a connection of its own that is closed at once, for the network's
// public address: the one thing a STUN server tells. iCloud Private Relay hides that address from
// the rooms Worker but doesn't carry WebRTC, so this is how phones behind it find rooms on their
// Wi-Fi. Game links never use it: they keep to local addresses (localOnly).
export const STUN = 'stun:stun.cloudflare.com:3478';

// The room's close codes (CLOSE in worker/rooms.js). Each one ends this device's part in the room.
const REASONS = {
  4000: 'replaced', 4001: 'bad', 4003: 'token', 4004: 'room', 4005: 'game', 4006: 'refused', 4008: 'full',
  4009: 'started', 4010: 'ended', 4011: 'busy', 4029: 'flood',
};

const TIMING = {
  open: 8000, // a room connection that hasn't been welcomed by then reads as offline
  ping: 20000, // a quiet room connection is checked this often
  pong: 4000, // and is dead if its 'pong' takes longer (iOS leaves dead sockets looking open)
  backoff: [250, 1000, 2000, 4000, 8000], // waits between tries to reach the room again
  gather: 2000, // longest wait for this device's local addresses
  direct: 6000, // a direct try whose channel hasn't opened by then has failed
  directPing: 5000, // a direct link is checked this often
  directPong: 3000, // and has ended if its pong takes longer
  directRetry: [2000, 5000, 15000, 30000, 60000], // waits between direct tries (the last repeats)
};
const OUTBOX_MAX = 200;

let where = null; // { at, RTC, addresses }: the last answer, kept a minute

/**
 * This network's public addresses, as a STUN server sees them (an IPv4 address, an IPv6 one, or
 * both), or [] without WebRTC, without an answer within timeout, or on a network that blocks it.
 */
export async function networkHint({ RTCPeerConnection = globalThis.RTCPeerConnection, timeout = 1500 } = {}) {
  if (!RTCPeerConnection) return [];
  if (where && where.RTC === RTCPeerConnection && Date.now() - where.at < 60_000) return where.addresses;
  const found = new Set();
  const take = (line) => {
    const p = String(line).replace(/^a=/, '').split(' ');
    if (p[7] === 'srflx' && p[4]) found.add(p[4]);
  };
  let pc = null;
  try {
    pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] });
    pc.addEventListener('icecandidate', (event) => event.candidate && take(event.candidate.candidate));
    pc.createDataChannel('where');
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, timeout);
    for (const line of (pc.localDescription?.sdp ?? '').split('\r\n')) if (line.startsWith('a=candidate:')) take(line);
  } catch {
    /* no answer: rooms are found by the address the Worker sees, or by code */
  } finally {
    try {
      pc?.close();
    } catch {
      /* closed */
    }
  }
  const addresses = [...found].slice(0, 3);
  where = { at: Date.now(), RTC: RTCPeerConnection, addresses };
  return addresses;
}

const withHints = (query, hints) => {
  for (const address of hints) query.append('at', address);
  return query;
};

/** The rooms open on this device's network (the same public address), for joining without a code. */
export async function nearby({ game, url = ROOMS, fetch = globalThis.fetch, RTCPeerConnection = globalThis.RTCPeerConnection, timeout = 4000 } = {}) {
  const hints = await networkHint({ RTCPeerConnection });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const query = withHints(new URLSearchParams({ game }), hints);
    const res = await fetch(`${url.replace(/^ws/, 'http')}/nearby?${query}`, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list)
      ? list.filter((r) => /^[A-Z]{4}$/.test(r?.code)).map((r) => ({ code: r.code, name: String(r.name ?? '').slice(0, 24) }))
      : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Addresses a direct link may use: mDNS names (what browsers offer for this device's own
// addresses), private IPv4, and link-local or unique-local IPv6. Nothing reachable from outside.
const LOCAL = /^(?:[0-9a-z-]+\.local|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|f[cd][0-9a-f]{0,2}:[0-9a-f:]*|fe[89ab][0-9a-f]:[0-9a-f:]*)$/i;

/** An offer or answer with every candidate that isn't a local address taken out. */
export function localOnly(sdp) {
  return String(sdp)
    .split('\r\n')
    .filter((line) => !line.startsWith('a=candidate:') || LOCAL.test(line.split(' ')[4] ?? ''))
    .join('\r\n');
}

// Every connection names this network's public addresses, so the Worker can list the room (and
// count the knocks) by network even behind Private Relay.
export async function create({ game, name = '', seat = true, ...opts } = {}) {
  const hints = await networkHint({ RTCPeerConnection: opts.RTCPeerConnection ?? globalThis.RTCPeerConnection });
  return new Room({ ...opts, game, code: null, hints, params: seat ? { name } : { name, table: '1' } }).ready;
}

export async function join(code, { game, name = '', token, seat = true, ...opts } = {}) {
  code = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) throw Object.assign(new Error('Star: room'), { reason: 'room' });
  const hints = await networkHint({ RTCPeerConnection: opts.RTCPeerConnection ?? globalThis.RTCPeerConnection });
  const params = token ? {} : seat ? { name } : { name, table: '1' };
  return new Room({ ...opts, game, code, token, hints, params }).ready;
}

/** Resolves once a connection has its local addresses, or after ms. */
function gathered(pc, ms) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

class Room {
  constructor({
    game, code, token = null, params, hints = [], url = ROOMS, timing = {}, admitLocal = true,
    WebSocket = globalThis.WebSocket, RTCPeerConnection = globalThis.RTCPeerConnection,
  }) {
    this.game = game;
    this.code = code;
    this.token = token;
    this.params = params;
    this.hints = hints;
    this.url = url;
    this.WS = WebSocket;
    this.RTC = RTCPeerConnection || null; // without WebRTC every link stays relayed
    this.timing = { ...TIMING, ...timing };
    this.admitLocal = admitLocal; // host: lets a waiting seat in once it links directly
    this.admitted = false;
    this.knocked = new Set(); // host: waiting seats already announced
    this.seat = null;
    this.host = null;
    this.started = false;
    this.seats = [];
    this.status = 'connecting';
    this.peers = new Map(); // seat -> its direct link: the host's, for a member; each member's, for the host
    this.links = {}; // seat -> 'direct' | 'relayed', as the host last said (members only)
    this.handlers = {};
    this.outbox = [];
    this.tries = 0;
    this.ws = null;
    this.timers = {};
    this.ready = new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    this.connect();
  }

  get isHost() {
    return this.seat !== null && this.seat === this.host;
  }

  /** Whether a seat has been let in (the host's view; a member only knows the list). */
  isIn(seat) {
    const s = this.seats.find((x) => x.seat === seat);
    return !!s && s.admitted !== false;
  }

  isDirect(seat) {
    const p = this.peers.get(seat);
    return p?.state === 'direct' && p.dc?.readyState === 'open';
  }

  /** How a seat reaches the host: 'host' (it is the host), 'direct', 'relayed' or 'away'. */
  linkOf(seat) {
    if (seat === this.host) return 'host';
    const s = this.seats.find((x) => x.seat === seat);
    if (seat === this.seat) return this.isDirect(this.host) ? 'direct' : this.status === 'open' ? 'relayed' : 'away';
    if (this.isHost) return this.isDirect(seat) ? 'direct' : s?.online ? 'relayed' : 'away';
    if (!s?.online && this.links[seat] !== 'direct') return 'away';
    return this.links[seat] ?? 'relayed';
  }

  get members() {
    return this.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      table: s.table,
      host: s.seat === this.host,
      you: s.seat === this.seat,
      admitted: s.admitted !== false,
      link: this.linkOf(s.seat),
    }));
  }

  /** True when no message of this device's goes through the room. */
  get local() {
    if (!this.isHost) return this.isDirect(this.host);
    const others = this.seats.filter((s) => s.seat !== this.seat && s.admitted !== false && (s.online || this.isDirect(s.seat)));
    return others.length > 0 && others.every((s) => this.isDirect(s.seat));
  }

  on(type, fn) {
    (this.handlers[type] ??= new Set()).add(fn);
    return () => this.handlers[type].delete(fn);
  }

  emit(type, ...args) {
    for (const fn of this.handlers[type] ?? []) {
      try {
        fn(...args);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  /* ---------- The room's connection ---------- */

  connect() {
    clearTimeout(this.timers.retry);
    const query = withHints(new URLSearchParams({ game: this.game, ...(this.token ? { token: this.token } : this.params) }), this.hints);
    const ws = new this.WS(`${this.url}/rooms/${this.token ? this.code : this.code ?? 'new'}?${query}`);
    this.ws = ws;
    ws.onmessage = (event) => ws === this.ws && this.receive(event.data);
    ws.onclose = (event) => ws === this.ws && this.dropped(event.code);
    ws.onerror = () => {}; // a close follows
    clearTimeout(this.timers.connecting);
    this.timers.connecting = setTimeout(() => {
      if (ws !== this.ws || this.status === 'open') return;
      if (this.pending) this.fail('offline');
      else this.retry();
    }, this.timing.open);
  }

  /** Lets go of the room's socket without hearing from it again. */
  abandon() {
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.timers.ping);
    clearTimeout(this.timers.pong);
    this.timers.pong = null;
    if (!ws) return;
    ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* never opened */
    }
  }

  receive(data) {
    if (data === 'pong') {
      clearTimeout(this.timers.pong);
      this.timers.pong = null;
      return;
    }
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.ctl === 'welcome') {
      const before = this.host;
      Object.assign(this, { code: m.code, seat: m.seat, token: m.token, started: m.started, tries: 0 });
      this.admitted = m.admitted !== false;
      this.setHost(m.host);
      clearTimeout(this.timers.connecting);
      this.setStatus('open');
      this.flush();
      clearInterval(this.timers.ping);
      this.timers.ping = setInterval(() => this.check(), this.timing.ping);
      if (this.pending) {
        this.pending.resolve(this);
        this.pending = null;
      } else if (before !== m.host) this.emit('host', { host: m.host, backup: null });
      this.tryDirect();
    } else if (m.ctl === 'seats') {
      const before = this.host;
      const hostWasOnline = this.seats.find((s) => s.seat === m.host)?.online;
      Object.assign(this, { seats: m.seats, started: m.started });
      this.setHost(m.host);
      const mine = m.seats.find((s) => s.seat === this.seat);
      if (mine && mine.admitted !== false && !this.admitted) {
        this.admitted = true;
        this.emit('admitted');
      }
      for (const seat of this.peers.keys()) if (!m.seats.some((s) => s.seat === seat)) this.dropPeer(seat);
      if (before !== null && before !== m.host) this.emit('host', { host: m.host, backup: null });
      // The host is back: try a direct link again now rather than at the next retry.
      if (!this.isHost && !hostWasOnline && m.seats.find((s) => s.seat === m.host)?.online) this.tryDirect(true);
      if (this.isHost) {
        this.shareLinks();
        for (const s of m.seats) {
          if (s.admitted !== false) this.knocked.delete(s.seat);
          else if (!this.knocked.has(s.seat)) {
            this.knocked.add(s.seat);
            this.emit('knock', this.members.find((x) => x.seat === s.seat));
            // Linked directly before the list said it was waiting: let it in now.
            if (this.admitLocal && this.isDirect(s.seat)) this.admit(s.seat);
          }
        }
      }
      this.emit('members', this.members);
    } else if (m.ctl === 'host') {
      this.setHost(m.host);
      this.emit('host', { host: m.host, backup: m.backup ?? null });
      this.emit('members', this.members);
    } else if ('from' in m) {
      this.fromSeat(m.from, m.msg);
    }
  }

  /** A new host means new direct links: the old ones were to or from the old host. */
  setHost(host) {
    if (this.host === host) return;
    this.host = host;
    for (const seat of [...this.peers.keys()]) this.dropPeer(seat);
    this.links = {};
    this.sharedLinks = undefined;
    this.knocked = new Set();
    if (!this.isHost) queueMicrotask(() => this.tryDirect(true));
  }

  dropped(code) {
    this.abandon();
    const reason = REASONS[code];
    if (this.pending) this.fail(reason || 'offline');
    else if (reason) this.finish(reason);
    else this.retry();
  }

  retry() {
    this.abandon();
    if (this.status === 'closed') return;
    this.setStatus('reconnecting');
    this.emit('members', this.members);
    const { backoff } = this.timing;
    clearTimeout(this.timers.retry);
    this.timers.retry = setTimeout(() => this.connect(), backoff[Math.min(this.tries++, backoff.length - 1)]);
  }

  /** Pings the room; a connection that doesn't answer is dropped and tried again. */
  check() {
    if (this.status !== 'open' || this.timers.pong) return;
    this.raw('ping');
    this.timers.pong = setTimeout(() => {
      this.timers.pong = null;
      this.retry();
    }, this.timing.pong);
  }

  /**
   * Call when the app comes back to the foreground: iOS drops a backgrounded app's sockets and
   * channels but can leave them looking open. Open ones are checked at once; a room connection
   * waiting to retry tries now, and so does a member without a direct link.
   */
  wake() {
    if (this.status === 'open') this.check();
    else if (this.status === 'reconnecting' && !this.ws) {
      this.tries = 0;
      this.connect();
    }
    for (const p of this.peers.values()) if (p.state === 'direct') this.checkDirect(p);
    if (!this.isHost && !this.isDirect(this.host)) this.tryDirect(true);
  }

  finish(reason) {
    if (this.status === 'closed') return;
    this.abandon();
    for (const seat of [...this.peers.keys()]) this.dropPeer(seat);
    for (const timer of Object.values(this.timers)) clearTimeout(timer);
    this.outbox = [];
    this.setStatus('closed');
    this.emit('closed', reason);
  }

  fail(reason) {
    const pending = this.pending;
    this.pending = null;
    this.finish(reason);
    pending?.reject(Object.assign(new Error(`Star: ${reason}`), { reason }));
  }

  /* ---------- Direct links ---------- */

  peer(seat) {
    let p = this.peers.get(seat);
    if (!p) {
      p = { seat, state: 'none', pc: null, dc: null, gen: 0, tries: 0, timer: 0, retry: 0, pinger: 0, pong: 0 };
      this.peers.set(seat, p);
    }
    return p;
  }

  /** Closes a peer's connection, if any, and forgets it was trying. */
  closeLink(p) {
    clearTimeout(p.timer);
    clearInterval(p.pinger);
    clearTimeout(p.pong);
    p.pong = 0;
    if (p.dc) p.dc.onopen = p.dc.onclose = p.dc.onmessage = null;
    if (p.pc) p.pc.ondatachannel = p.pc.onconnectionstatechange = null;
    try {
      p.dc?.close();
      p.pc?.close();
    } catch {
      /* already closed */
    }
    p.pc = p.dc = null;
    p.state = 'none';
  }

  dropPeer(seat) {
    const p = this.peers.get(seat);
    if (!p) return;
    clearTimeout(p.retry);
    this.closeLink(p);
    this.peers.delete(seat);
  }

  newConnection(p) {
    const pc = new this.RTC({ iceServers: [] });
    p.pc = pc;
    p.state = 'trying';
    pc.onconnectionstatechange = () => p.pc === pc && pc.connectionState === 'failed' && this.directEnded(p, 'failed');
    clearTimeout(p.timer);
    p.timer = setTimeout(() => p.pc === pc && this.directEnded(p, 'timeout'), this.timing.direct);
    return pc;
  }

  /** Member: offers the host a direct link, unless one is up or on its way. now: skip the wait. */
  async tryDirect(now = false) {
    if (!this.RTC || this.isHost || this.host === null || this.status === 'closed') return;
    const p = this.peer(this.host);
    if (p.state !== 'none') return;
    if (now) {
      p.tries = 0;
      clearTimeout(p.retry);
    }
    if (this.status !== 'open') return this.retryDirect(p); // the offer needs the room
    clearTimeout(p.retry);
    const gen = ++p.gen;
    const pc = this.newConnection(p);
    this.wireChannel(p, pc.createDataChannel('star'));
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc, this.timing.gather);
      if (p.pc === pc) this.signal(p.seat, { s: 'offer', g: gen, sdp: localOnly(pc.localDescription.sdp) });
    } catch {
      if (p.pc === pc) this.directEnded(p, 'offer');
    }
  }

  retryDirect(p) {
    if (this.isHost || this.status === 'closed' || p.seat !== this.host) return;
    const waits = this.timing.directRetry;
    clearTimeout(p.retry);
    p.retry = setTimeout(() => this.tryDirect(), waits[Math.min(p.tries++, waits.length - 1)]);
  }

  /** Host: answers a member's offer. */
  async answer(from, m) {
    if (!this.RTC || !this.isHost || typeof m.sdp !== 'string') return;
    const p = this.peer(from);
    const was = p.state;
    this.closeLink(p);
    if (was === 'direct') this.linkChanged(from, 'relayed', 'offered again');
    const pc = this.newConnection(p);
    pc.ondatachannel = (event) => p.pc === pc && this.wireChannel(p, event.channel);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: localOnly(m.sdp) });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc, this.timing.gather);
      if (p.pc === pc) this.signal(from, { s: 'answer', g: m.g, sdp: localOnly(pc.localDescription.sdp) });
    } catch {
      if (p.pc === pc) this.directEnded(p, 'answer');
    }
  }

  async answered(from, m) {
    const p = this.peers.get(from);
    if (this.isHost || from !== this.host || !p?.pc || p.state !== 'trying' || p.gen !== m.g || typeof m.sdp !== 'string') return;
    const pc = p.pc;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: localOnly(m.sdp) });
    } catch {
      if (p.pc === pc) this.directEnded(p, 'answer');
    }
  }

  wireChannel(p, dc) {
    p.dc = dc;
    // A channel from ondatachannel can be open already, and still fire open: count it once.
    dc.onopen = () => {
      if (p.dc !== dc || p.state === 'direct') return;
      clearTimeout(p.timer);
      p.state = 'direct';
      p.tries = 0;
      clearInterval(p.pinger);
      p.pinger = setInterval(() => this.checkDirect(p), this.timing.directPing);
      this.linkChanged(p.seat, 'direct');
    };
    dc.onclose = () => p.dc === dc && this.directEnded(p, 'closed');
    dc.onmessage = (event) => p.dc === dc && this.fromDirect(p, event.data);
    if (dc.readyState === 'open') dc.onopen();
  }

  /** Pings a direct link; one that doesn't answer has ended (the phone left the Wi-Fi, or slept). */
  checkDirect(p) {
    if (p.state !== 'direct' || p.pong) return;
    this.sendDirect(p, { s: 'ping' });
    p.pong = setTimeout(() => {
      p.pong = 0;
      this.directEnded(p, 'silent');
    }, this.timing.directPong);
  }

  directEnded(p, why) {
    const was = p.state;
    this.closeLink(p);
    if (was === 'direct') this.linkChanged(p.seat, this.status === 'open' ? 'relayed' : 'away', why);
    else this.emit('link', p.seat, 'relayed', why);
    this.retryDirect(p);
  }

  linkChanged(seat, link, why) {
    this.emit('link', seat, link, why);
    // On the same network: a seat that links directly is let in without asking.
    if (this.isHost && link === 'direct' && this.admitLocal && !this.isIn(seat)) this.admit(seat);
    if (this.isHost) this.shareLinks();
    this.emit('members', this.members);
  }

  /** Host: tells every member how each one reaches it, for their lists. */
  shareLinks() {
    const links = {};
    const others = this.seats.filter((s) => s.seat !== this.seat && s.admitted !== false);
    for (const s of others) links[s.seat] = this.isDirect(s.seat) ? 'direct' : 'relayed';
    const text = JSON.stringify(links);
    if (text === this.sharedLinks) return;
    this.sharedLinks = text;
    for (const s of others) this.deliver(s.seat, { s: 'links', links });
  }

  sendDirect(p, env) {
    try {
      p.dc.send(JSON.stringify(env));
      return true;
    } catch {
      this.directEnded(p, 'send');
      return false;
    }
  }

  fromDirect(p, data) {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m?.s === 'ping') this.sendDirect(p, { s: 'pong' });
    else if (m?.s === 'pong') {
      clearTimeout(p.pong);
      p.pong = 0;
    } else this.fromSeat(p.seat, m);
  }

  /** A message from a seat, by either way: a game's ({ a }) or Star's own ({ s }). */
  fromSeat(from, m) {
    if (!m || typeof m !== 'object') return;
    if ('a' in m) {
      if (this.isHost && !this.isIn(from)) return; // a seat still waiting only links
      return this.emit('message', from, m.a);
    }
    if (m.s === 'offer') this.answer(from, m);
    else if (m.s === 'answer') this.answered(from, m);
    else if (m.s === 'links' && from === this.host && !this.isHost && m.links && typeof m.links === 'object') {
      this.links = m.links;
      this.emit('members', this.members);
    }
  }

  /* ---------- Sending ---------- */

  raw(text) {
    try {
      this.ws?.send(text);
    } catch {
      /* closed meanwhile: the close handler takes over */
    }
  }

  /** Sends through the room now, or once it's back. Messages queued as host are dropped if the host changed. */
  post(obj, asHost) {
    if (this.status === 'open' && this.ws) this.raw(JSON.stringify(obj));
    else if (this.status !== 'closed') {
      this.outbox.push({ obj, asHost });
      if (this.outbox.length > OUTBOX_MAX) this.outbox.shift();
    }
  }

  flush() {
    const queued = this.outbox;
    this.outbox = [];
    for (const { obj, asHost } of queued) if (asHost === this.isHost) this.raw(JSON.stringify(obj));
  }

  /** Star's own messages go through the room only while it's there: a late offer is no use. */
  signal(seat, env) {
    if (this.status !== 'open') return;
    this.raw(JSON.stringify(this.isHost ? { to: seat, msg: env } : { msg: env }));
  }

  /** To one seat: straight there if the link is direct, else through the room. */
  deliver(seat, env) {
    const p = this.peers.get(seat);
    if (this.isDirect(seat) && this.sendDirect(p, env)) return;
    this.post(this.isHost ? { to: seat, msg: env } : { msg: env }, this.isHost);
  }

  mustHost() {
    if (!this.isHost) throw new Error('Star: only the host can do that');
  }

  /** Member: a message to the host. */
  send(msg) {
    if (this.isHost) throw new Error('Star: the host sends with sendTo or broadcast');
    this.deliver(this.host, { a: msg });
  }

  /** Host: a message to one seat. */
  sendTo(seat, msg) {
    this.mustHost();
    this.deliver(seat, { a: msg });
  }

  /** Host: a message to every seat but its own. */
  broadcast(msg) {
    this.mustHost();
    const others = this.seats.filter((s) => s.seat !== this.seat && s.admitted !== false);
    // Nobody direct: one message through the room reaches everyone let in.
    if (!others.some((s) => this.isDirect(s.seat))) return this.post({ to: 'all', msg: { a: msg } }, true);
    for (const s of others) this.deliver(s.seat, { a: msg });
  }

  /** Host: lets a waiting seat in. */
  admit(seat) {
    this.mustHost();
    this.post({ ctl: 'admit', seat }, true);
  }

  /** Host: turns a waiting seat away; it can't come back with its token. */
  refuse(seat) {
    this.mustHost();
    this.dropPeer(seat);
    this.post({ ctl: 'refuse', seat }, true);
  }

  /** Host: the game's state, kept by the room for whoever hosts next. */
  backup(state) {
    this.mustHost();
    this.post({ ctl: 'backup', state }, true);
  }

  /** Host: from now on the room takes no new seats, only seats coming back. */
  start() {
    this.mustHost();
    this.post({ ctl: 'start' }, true);
  }

  /** Host: makes another seat (online) the host. Send it the game's state first. */
  handOver(seat) {
    this.mustHost();
    this.post({ ctl: 'handover', seat }, true);
  }

  /** Host: closes the room for everyone. */
  end() {
    this.mustHost();
    this.raw(JSON.stringify({ ctl: 'end' }));
    this.finish('ended');
  }

  /** Member: gives up the seat (after the start, the seat stays and waits for its token). */
  leave() {
    if (this.isHost) throw new Error('Star: the host ends the room or hands it over');
    this.raw(JSON.stringify({ ctl: 'leave' }));
    this.finish('left');
  }

  /** Lets go of every link and keeps the seat, to come back with the token later. */
  close() {
    this.finish('closed');
  }
}
