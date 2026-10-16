// The rooms Worker (KTAN.md, A8): one Durable Object per room, carrying messages between a room's
// host and its members. It never runs a game: the host does. The room only forwards what the host
// and the members send, keeps the seats and the host's last backup, and names a new host when the
// old one has gone for good. A second kind of object, one per network (Net), lists the rooms open
// on that network and counts how often it creates and joins rooms. Deployed by
// scripts/worker.mjs as cache-only-rooms on cache-only.workers.dev. It imports nothing, so the
// tests run it in Node with fake sockets and storage (tests/fake-rooms.mjs).
//
// Every room connection is a WebSocket:
//   /rooms/new?game=ktan&name=Anna[&table=1]   a new room, with this device as its host
//   /rooms/ABCD?game=ktan&name=Pol[&table=1]   knocks for a new seat, until the host starts
//   /rooms/ABCD?game=ktan&token=…              a seat coming back
// A new seat waits, unadmitted, until the host lets it in: by hand, or by itself once the seat
// links to it directly on the same network (star.js). Meanwhile it reaches the host only. A
// refusal still opens the socket, then closes it with a code from CLOSE, because a browser can't
// read why a handshake failed.
//
// Messages are JSON text. A member sends { msg } (always to the host); the host sends
// { to: seat | 'all', msg }; both receive { from: seat, msg }. 'all' means every admitted seat.
// Control messages carry ctl: the room sends welcome, seats and host; the host sends admit,
// refuse, backup, start, handover and end; a member sends leave. The text 'ping' gets 'pong'.
//
// GET /nearby?game=ktan lists the rooms whose host is on the asker's network: the same public
// IPv4 address, or the same IPv6 /64. Behind a privacy relay (iCloud Private Relay, WARP) the
// address the Worker sees is the relay's, shared with strangers, so it never stands for a network:
// a device then names its own with &at=<address>, which it learned from a STUN server (star.js).
// A device that isn't behind a relay may name more networks (its other address family) only if
// one of them is the one the Worker sees. A false claim shows no more than a room's name and code;
// getting in still takes the host or a direct link.

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, and no digits: nothing to misread
const MAX_SEATS = 12;
const MAX_WAITING = 6; // seats knocking at once, so strangers can't fill a room
const WAITING_PER_NET = 2; // from any one network but the host's, so one can't block the rest
const NAME_MAX = 24;
const BACKUP_MAX = 100 * 1024; // characters of JSON; a game's state is a few KB
const IDLE_MS = 24 * 60 * 60 * 1000; // a room deletes itself this long after its last activity
const HOST_GRACE_MS = 20 * 1000; // a host gone this long hands the room to the next seat online
const LISTED_MS = 6 * 60 * 60 * 1000; // a nearby listing older than this is stale

// The networks iCloud Private Relay leaves through (Cloudflare, Akamai, Fastly), Cloudflare's WARP
// too. Apple lists the addresses at mask-api.icloud.com/egress-ip-ranges.csv.
const RELAY_ASNS = new Set([13335, 36183, 54113]);

// What one network may do a minute: create rooms, knock for seats, ask what's nearby.
export const PER_MINUTE = { create: 10, join: 20, nearby: 120 };

// What one socket may send: bytes a message, and messages a second (with a burst twice that).
export const FLOOD = {
  host: { bytes: 128 * 1024, rate: 200 },
  member: { bytes: 16 * 1024, rate: 20 },
};

/** Close codes for a refusal or an ending; star.js reads them back. */
export const CLOSE = {
  replaced: 4000, bad: 4001, token: 4003, room: 4004, game: 4005, refused: 4006, full: 4008,
  started: 4009, ended: 4010, busy: 4011, flood: 4029,
};

// The app's origin and the dev servers' (npm run serve, npm run lan). Nothing else may connect.
const ORIGINS = [
  /^https:\/\/cache-only\.github\.io$/,
  /^http:\/\/(127\.0\.0\.1|localhost):8080$/,
  /^https:\/\/[a-z0-9-]+\.local:8443$/i,
  /^https:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))(\.\d{1,3}){2,3}:8443$/,
];

export function allowedOrigin(origin) {
  return !!origin && ORIGINS.some((re) => re.test(origin));
}

/**
 * The network an address belongs to: an IPv4 address as it is, an IPv6 address by its /64 (each
 * device on a network has its own IPv6 address, all under one /64).
 */
export function networkOf(address) {
  const ip = String(address || '').trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return `v4:${mapped[1]}`;
  if (!ip.includes(':')) return ip ? `v4:${ip}` : 'none';
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `v6:${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}`;
}

/** A public address a device reported, normalised, or null if it isn't one (private, local, junk). */
export function publicAddress(text) {
  const ip = String(text ?? '').trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (ip.split('.').some((n) => Number(n) > 255)) return null;
    const local = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
    return local ? null : ip;
  }
  if (!/^[0-9a-f:]{2,39}$/.test(ip) || !ip.includes(':')) return null;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return first >= 0x2000 && first < 0x4000 ? ip : null; // global unicast, 2000::/3
}

/**
 * The networks a request speaks for (KTAN.md, A8): the address the Worker sees, unless it's a
 * relay's; with it, the networks the device named, if one of them is that address's.
 */
export function networksFor(seen, relay, named = []) {
  const claimed = [...new Set(named.map(publicAddress).filter(Boolean).map(networkOf))].slice(0, 3);
  if (relay) return claimed;
  const own = networkOf(seen);
  if (own === 'none') return [];
  return claimed.includes(own) ? [own, ...claimed.filter((n) => n !== own)] : [own];
}

/** What the Workers runtime gives; the tests swap in fakes. */
export const platform = {
  now: () => Date.now(),
  asn: (request) => request.cf?.asn,
  pair() {
    const pair = new WebSocketPair();
    return [pair[0], pair[1]];
  },
  upgrade: (client) => new Response(null, { status: 101, webSocket: client }),
  code() {
    return [...crypto.getRandomValues(new Uint32Array(4))].map((n) => LETTERS[n % LETTERS.length]).join('');
  },
  token() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};

const text = (body, status = 200) => new Response(`${body}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));
const netStub = (env, net) => env.NETS.get(env.NETS.idFromName(net));
const netCall = (env, net, route, body) =>
  netStub(env, net).fetch(new Request(`https://net${route}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }));

function cors(origin, res) {
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Vary', 'Origin');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const seen = request.headers.get('CF-Connecting-IP');
    const nets = networksFor(seen, RELAY_ASNS.has(platform.asn(request)), url.searchParams.getAll('at'));
    // Limits count against the device's own network; behind a relay with none named, the relay's.
    const net = nets[0] ?? networkOf(seen);
    if (url.pathname === '/') return text('Cache Only rooms');

    if (url.pathname === '/nearby') {
      if (!allowedOrigin(origin)) return text('Origin not allowed', 403);
      const game = encodeURIComponent(url.searchParams.get('game') || '');
      const found = new Map();
      for (const n of nets) {
        const res = await netCall(env, n, `/nearby?game=${game}`);
        if (res.ok) for (const r of await res.json()) found.set(r.code, r);
      }
      return cors(origin, json([...found.values()]));
    }

    const match = /^\/rooms\/(new|[A-Za-z]{4})$/.exec(url.pathname);
    if (!match) return text('Not found', 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return text('A room is a WebSocket', 426);
    if (!allowedOrigin(origin)) return text('Origin not allowed', 403);

    // A seat coming back holds a token nobody can guess; anything else counts against its network.
    const coming = url.searchParams.has('token');
    if (!coming) {
      const allowed = await netCall(env, net, `/allow?kind=${match[1] === 'new' ? 'create' : 'join'}`);
      if (allowed.status !== 200) return text('Too many tries', 429);
    }
    const forward = (to, code) => {
      const req = new Request(to, request);
      req.headers.set('X-Net', nets.join(',')); // set here, so a device can't claim another network
      return roomStub(env, code).fetch(req);
    };
    if (match[1] !== 'new') return forward(url, match[1].toUpperCase());

    // A code already in use answers 409: try another.
    for (let i = 0; i < 8; i++) {
      const code = platform.code();
      const to = new URL(url);
      to.pathname = `/rooms/${code}`;
      to.searchParams.set('create', '1');
      const res = await forward(to, code);
      if (res.status !== 409) return res;
    }
    return text('No free room code', 503);
  },
};

const listedOn = (r) => (Array.isArray(r.listed) ? r.listed : r.listed ? [r.listed] : []);

const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);

/**
 * One network: the rooms whose host is on it, for /nearby, and how often it has created rooms,
 * knocked for seats and asked what's nearby in the last minute (kept in memory: a network busy
 * enough to matter keeps its object awake).
 */
export class Net {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.hits = new Map(); // kind -> times in the last minute
    this.rooms = undefined; // code -> { game, name, at }
  }

  allow(kind) {
    const now = platform.now();
    const recent = (this.hits.get(kind) || []).filter((at) => now - at < 60_000);
    const ok = recent.length < (PER_MINUTE[kind] ?? 0);
    if (ok) recent.push(now);
    this.hits.set(kind, recent);
    return ok;
  }

  async listed() {
    if (this.rooms === undefined) this.rooms = (await this.ctx.storage.get('rooms')) ?? {};
    return this.rooms;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = platform.now();
    if (url.pathname === '/allow') {
      const ok = this.allow(url.searchParams.get('kind'));
      return text(ok ? 'ok' : 'no', ok ? 200 : 429);
    }
    const rooms = await this.listed();
    if (url.pathname === '/nearby') {
      if (!this.allow('nearby')) return json([], 429);
      const game = url.searchParams.get('game');
      return json(
        Object.entries(rooms)
          .filter(([, r]) => r.game === game && now - r.at < LISTED_MS)
          .map(([code, r]) => ({ code, name: r.name })),
      );
    }
    const body = await request.json().catch(() => ({}));
    if (url.pathname === '/list' && /^[A-Z]{4}$/.test(body.code)) {
      rooms[body.code] = { game: String(body.game || ''), name: cleanName(body.name), at: now };
      for (const [code, r] of Object.entries(rooms)) if (now - r.at >= LISTED_MS) delete rooms[code];
    } else if (url.pathname === '/unlist') {
      if (!(body.code in rooms)) return text('ok');
      delete rooms[body.code];
    } else return text('Not found', 404);
    await this.ctx.storage.put('rooms', rooms);
    return text('ok');
  }
}

/**
 * One room. Its record (`room` in storage) holds the seats, their tokens, whether each is let in,
 * who hosts, when the host went away and where the room is listed; `backup` holds the host's last
 * copy of the game. Sockets are accepted with the Hibernation API, so a quiet room costs nothing,
 * and each one carries its seat as an attachment and as a tag (`s<seat>`), which outlive
 * hibernation.
 */
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = undefined; // read from storage on first use
    this.closing = null; // the socket webSocketClose is about, no longer counted as online
    this.buckets = new Map(); // seat -> { tokens, at }: what it may still send
    // Pings are answered by the runtime without waking the room.
    if (typeof WebSocketRequestResponsePair === 'function') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  async load() {
    if (this.room === undefined) this.room = (await this.ctx.storage.get('room')) ?? null;
    return this.room;
  }

  async save() {
    const r = this.room;
    await this.ctx.storage.put('room', r);
    // One alarm serves both timers: the room's expiry and, while it can still run out, the host's grace.
    const now = platform.now();
    const hostAt = r.hostAway && r.hostAway + HOST_GRACE_MS > now ? r.hostAway + HOST_GRACE_MS : Infinity;
    await this.ctx.storage.setAlarm(Math.min(r.last + IDLE_MS, hostAt));
  }

  async drop() {
    await this.unlist();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.room = null;
    return null;
  }

  /* ---------- Listing for /nearby: while the room takes seats and its host is in ---------- */

  /** Lists the room on its host's networks, and off any it was listed on before. */
  async list() {
    const r = this.room;
    const host = r.seats.find((s) => s.id === r.host);
    const want = r.started ? [] : host?.nets ?? [];
    for (const net of listedOn(r)) if (!want.includes(net)) await netCall(this.env, net, '/unlist', { code: r.code });
    for (const net of want) await netCall(this.env, net, '/list', { code: r.code, game: r.game, name: host.name });
    r.listed = want;
  }

  async unlist() {
    const r = this.room;
    if (!r) return;
    for (const net of listedOn(r)) await netCall(this.env, net, '/unlist', { code: r.code });
    r.listed = [];
  }

  /* ---------- Sockets ---------- */

  /** The open sockets of one seat (one at most, normally), or of every seat. */
  sockets(seat) {
    return this.ctx.getWebSockets(seat == null ? undefined : `s${seat}`).filter((ws) => {
      if (ws === this.closing) return false;
      const at = ws.deserializeAttachment();
      return at && !at.gone;
    });
  }

  online(seat) {
    return this.sockets(seat).length > 0;
  }

  post(ws, data) {
    try {
      ws.send(data);
    } catch {
      /* closed meanwhile */
    }
  }

  sendTo(seat, data) {
    for (const ws of this.sockets(seat)) this.post(ws, data);
  }

  announce() {
    const r = this.room;
    const data = JSON.stringify({
      ctl: 'seats',
      host: r.host,
      started: r.started,
      seats: r.seats.map((s) => ({ seat: s.id, name: s.name, table: s.table, admitted: s.admitted, online: this.online(s.id) })),
    });
    for (const ws of this.sockets()) this.post(ws, data);
  }

  addSeat(q, admitted) {
    const seat = { id: this.room.next++, name: cleanName(q.get('name')), table: q.get('table') === '1', admitted, token: platform.token(), net: '', nets: [] };
    this.room.seats.push(seat);
    return seat;
  }

  /** Lets a socket go: it no longer counts, and its seat is free to come back on another. */
  release(ws, code, reason) {
    try {
      ws.serializeAttachment({ ...ws.deserializeAttachment(), gone: true });
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  /** Lets a waiting seat go for good: refused, or the room started without it. */
  turnAway(seat, why) {
    this.room.seats = this.room.seats.filter((s) => s.id !== seat.id);
    for (const ws of this.sockets(seat.id)) this.release(ws, CLOSE[why], why);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const q = url.searchParams;
    const code = url.pathname.slice(url.pathname.lastIndexOf('/') + 1).toUpperCase();
    const game = q.get('game') || '';
    const now = platform.now();
    let room = await this.load();
    if (room && now - room.last >= IDLE_MS && !this.sockets().length) room = await this.drop();

    const [client, server] = platform.pair();
    const refuse = (why) => {
      server.accept();
      server.close(CLOSE[why], why);
      return platform.upgrade(client);
    };

    let seat;
    if (q.get('create') === '1') {
      if (room) return text('Taken', 409);
      if (!game) return refuse('bad');
      room = this.room = { code, game, created: now, last: now, started: false, host: 0, next: 0, hostAway: 0, listed: [], seats: [] };
      seat = this.addSeat(q, true);
    } else {
      if (!room) return refuse('room');
      if (room.game !== game) return refuse('game');
      const token = q.get('token');
      if (token) {
        seat = room.seats.find((s) => s.token === token);
        if (!seat) return refuse('token');
      } else {
        if (room.started) return refuse('started');
        if (room.seats.length >= MAX_SEATS) return refuse('full');
        const net = (request.headers.get('X-Net') || '').split(',')[0];
        const waiting = room.seats.filter((s) => !s.admitted);
        const hostNet = room.seats.find((s) => s.id === room.host)?.net;
        if (waiting.length >= MAX_WAITING) return refuse('busy');
        if (net !== hostNet && waiting.filter((s) => s.net === net).length >= WAITING_PER_NET) return refuse('busy');
        seat = this.addSeat(q, false);
      }
    }

    // One socket a seat: a newer one (the app came back before its old link was seen to drop) takes over.
    for (const ws of this.sockets(seat.id)) this.release(ws, CLOSE.replaced, 'replaced');
    this.ctx.acceptWebSocket(server, [`s${seat.id}`]);
    server.serializeAttachment({ seat: seat.id });
    this.buckets.delete(seat.id);
    seat.nets = (request.headers.get('X-Net') || '').split(',').filter(Boolean);
    seat.net = seat.nets[0] ?? '';
    room.last = now;
    if (seat.id === room.host) room.hostAway = 0;
    server.send(JSON.stringify({ ctl: 'welcome', code: room.code, seat: seat.id, token: seat.token, host: room.host, started: room.started, admitted: seat.admitted }));
    await this.checkHost(now);
    if (seat.id === room.host) await this.list();
    await this.save();
    this.announce();
    return platform.upgrade(client);
  }

  /**
   * A host gone longer than HOST_GRACE_MS hands the room to the next seat online after it, a table
   * before any phone (KTAN.md, A1 and A6). Only a seat that was let in can host. The new host gets
   * the last backup with the news.
   */
  async checkHost(now) {
    const r = this.room;
    if (!r.hostAway || now - r.hostAway < HOST_GRACE_MS) return false;
    const after = (s) => (s.id > r.host ? s.id - r.host : s.id + r.next);
    const next = r.seats
      .filter((s) => s.id !== r.host && s.admitted && this.online(s.id))
      .sort((a, b) => b.table - a.table || after(a) - after(b))[0];
    if (!next) return false;
    r.host = next.id;
    r.hostAway = 0;
    const backup = (await this.ctx.storage.get('backup')) ?? null;
    this.sendTo(next.id, JSON.stringify({ ctl: 'host', host: next.id, backup }));
    await this.list();
    return true;
  }

  /** Whether a seat may send this message now: under its size, and its rate (a token bucket). */
  withinLimits(seat, host, size) {
    const limit = host ? FLOOD.host : FLOOD.member;
    if (size > limit.bytes) return false;
    const now = platform.now();
    const b = this.buckets.get(seat) ?? { tokens: limit.rate * 2, at: now };
    b.tokens = Math.min(limit.rate * 2, b.tokens + ((now - b.at) / 1000) * limit.rate);
    b.at = now;
    this.buckets.set(seat, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  async webSocketMessage(ws, data) {
    if (data === 'ping') return this.post(ws, 'pong'); // the runtime answers this itself once deployed
    const at = ws.deserializeAttachment();
    const room = await this.load();
    if (!at || at.gone || !room) return;
    const host = at.seat === room.host;
    const size = typeof data === 'string' ? data.length : data.byteLength ?? Infinity;
    if (typeof data !== 'string' || !this.withinLimits(at.seat, host, size)) {
      this.release(ws, CLOSE.flood, 'flood');
      return this.webSocketClose(ws, true);
    }
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.ctl) return this.control(ws, at.seat, host, m);
    if (!('msg' in m)) return;

    const out = JSON.stringify({ from: at.seat, msg: m.msg });
    if (!host) this.sendTo(room.host, out); // a star: members only ever reach the host
    else if (m.to === 'all') {
      for (const s of room.seats) if (s.id !== room.host && s.admitted) this.sendTo(s.id, out);
    } else if (Number.isInteger(m.to) && m.to !== room.host) this.sendTo(m.to, out);
  }

  async control(ws, seat, host, m) {
    const r = this.room;
    const now = platform.now();
    if (m.ctl === 'leave' && !host) {
      // Before the start a seat that leaves is gone; after it, the seat waits for its token.
      if (!r.started) r.seats = r.seats.filter((s) => s.id !== seat);
      this.release(ws, 1000, 'left');
      r.last = now;
      await this.save();
      this.announce();
      return;
    }
    if (!host) return;
    const target = r.seats.find((s) => s.id === m.seat);
    if (m.ctl === 'admit') {
      if (!target || target.admitted) return;
      target.admitted = true;
      r.last = now;
      await this.save();
      this.announce();
    } else if (m.ctl === 'refuse') {
      if (!target || target.admitted) return;
      this.turnAway(target, 'refused');
      await this.save();
      this.announce();
    } else if (m.ctl === 'backup') {
      if (JSON.stringify(m.state ?? null).length > BACKUP_MAX) return;
      await this.ctx.storage.put('backup', m.state ?? null);
      r.last = now;
      await this.save();
    } else if (m.ctl === 'start') {
      r.started = true;
      for (const s of r.seats.filter((x) => !x.admitted)) this.turnAway(s, 'started');
      await this.unlist();
      r.last = now;
      await this.save();
      this.announce();
    } else if (m.ctl === 'handover') {
      if (m.seat === seat || !target?.admitted || !this.online(m.seat)) return;
      r.host = m.seat;
      r.last = now;
      await this.list();
      await this.save();
      this.announce();
    } else if (m.ctl === 'end') {
      for (const other of this.sockets()) this.release(other, CLOSE.ended, 'ended');
      await this.drop();
    }
  }

  /** gone: the room let this socket go itself (it flooded) and only needs the seat put right. */
  async webSocketClose(ws, gone = false) {
    if (gone !== true) {
      try {
        ws.close(1000, 'closed');
      } catch {
        /* already closed */
      }
    }
    const at = ws.deserializeAttachment();
    const room = await this.load();
    if (!at || (at.gone && gone !== true) || !room) return;
    this.closing = ws;
    try {
      if (this.online(at.seat)) return; // the seat already came back on another socket
      const seat = room.seats.find((s) => s.id === at.seat);
      if (seat && !seat.admitted) room.seats = room.seats.filter((s) => s !== seat); // a knock that walked away
      if (at.seat === room.host) {
        room.hostAway = platform.now();
        await this.unlist();
      }
      await this.save();
      this.announce();
    } finally {
      this.closing = null;
    }
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  async alarm() {
    const room = await this.load();
    if (!room) return;
    const now = platform.now();
    if (now - room.last >= IDLE_MS) {
      if (!this.sockets().length) return void (await this.drop());
      room.last = now; // still in use
    }
    if (await this.checkHost(now)) this.announce();
    await this.save();
  }
}
