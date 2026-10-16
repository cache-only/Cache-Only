// An in-memory Cloudflare for the rooms Worker (worker/rooms.js): Durable Object storage and
// alarms, the WebSocket pair a room accepts, and browser-like devices for star.js (a WebSocket and
// a fetch, each from a public address) that connect through the Worker's own fetch. Deliveries are
// asynchronous and in order, and each object handles one event at a time, as the runtime's input
// gates make it.
import worker, { Net, Room, platform } from '../worker/rooms.js';

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const tick = () => new Promise((resolve) => setImmediate(resolve));

let clouds = 0;

export function createCloud({ origin = 'https://cache-only.github.io' } = {}) {
  // Each cloud's devices share an address of their own unless given one, so one test's new rooms
  // don't count toward another's limits.
  const address = `203.0.113.${++clouds}`;
  // sent: every message a device sent a room (pings aside), to see what didn't go direct.
  const cloud = { clock: 1_000_000, objects: new Map(), nets: new Map(), pending: 0, offline: false, sent: [] };
  platform.now = () => cloud.clock;
  // A device behind a privacy relay says so with this header; the runtime would tell by its ASN.
  platform.asn = (request) => Number(request.headers.get('X-Test-ASN')) || undefined;

  const later = (fn) => {
    cloud.pending++;
    setImmediate(async () => {
      try {
        await fn();
      } finally {
        cloud.pending--;
      }
    });
  };

  const namespace = (objects, make, prop) => ({
    idFromName: (name) => name,
    get: (id) => ({ fetch: (request) => object(objects, make, prop, id).run((o) => o[prop].fetch(request)) }),
  });
  const env = {};
  env.ROOMS = namespace(cloud.objects, (ctx) => new Room(ctx, env), 'room');
  env.NETS = namespace(cloud.nets, (ctx) => new Net(ctx, env), 'net');

  function object(objects, make, prop, name) {
    let o = objects.get(name);
    if (o) return o;
    const data = new Map();
    const accepted = new Set(); // { ws, tags }
    o = {
      name,
      data,
      alarm: null,
      queue: Promise.resolve(),
      make,
      prop,
      /** One event at a time. */
      run(fn) {
        const result = o.queue.then(() => fn(o));
        o.queue = result.catch(() => {});
        return result;
      },
      ctx: {
        storage: {
          get: async (key) => clone(data.get(key)),
          put: async (key, value) => void data.set(key, clone(value)),
          delete: async (key) => data.delete(key),
          deleteAll: async () => data.clear(),
          setAlarm: async (at) => void (o.alarm = at),
          getAlarm: async () => o.alarm,
          deleteAlarm: async () => void (o.alarm = null),
        },
        acceptWebSocket(ws, tags = []) {
          ws.object = o;
          accepted.add({ ws, tags });
        },
        getWebSockets(tag) {
          return [...accepted].filter((a) => !a.ws.closed && (tag == null || a.tags.includes(tag))).map((a) => a.ws);
        },
      },
    };
    o[prop] = make(o.ctx);
    objects.set(name, o);
    return o;
  }

  /** The room's end of a socket. */
  class ServerSocket {
    constructor() {
      this.client = null;
      this.object = null;
      this.attachment = null;
      this.closed = false;
    }
    accept() {}
    send(data) {
      if (this.closed) throw new Error('closed');
      later(() => this.client?.deliver(data));
    }
    close(code = 1000, reason = '') {
      if (this.closed) return;
      this.closed = true;
      later(() => this.client?.shut(code, reason));
    }
    serializeAttachment(value) {
      this.attachment = clone(value);
    }
    deserializeAttachment() {
      return clone(this.attachment);
    }
  }

  platform.pair = () => {
    const server = new ServerSocket();
    const client = { server };
    return [client, server];
  };
  platform.upgrade = (client) => ({ status: 101, webSocket: client });

  const headers = (from, extra = {}, relay = false) => ({
    Origin: origin,
    'CF-Connecting-IP': from,
    ...(relay ? { 'X-Test-ASN': '13335' } : {}),
    ...extra,
  });

  /** What star.js gets for globalThis.WebSocket, on a device at that public address. */
  const socketFrom = (from, relay = false) =>
    class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.onopen = this.onmessage = this.onclose = this.onerror = null;
        this.server = null;
        later(async () => {
          if (cloud.offline) return this.shut(1006, '');
          const request = new Request(url.replace(/^ws/, 'http'), { headers: headers(from, { Upgrade: 'websocket' }, relay) });
          const res = await worker.fetch(request, env);
          if (res.status !== 101) return this.shut(1006, '');
          this.server = res.webSocket.server;
          this.server.client = this;
          this.readyState = 1;
          this.onopen?.({});
        });
      }
      deliver(data) {
        if (this.readyState === 1) this.onmessage?.({ data });
      }
      shut(code, reason) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({ code, reason });
      }
      send(data) {
        if (this.readyState !== 1) throw new Error('not open');
        if (data !== 'ping') {
          try {
            cloud.sent.push(JSON.parse(data));
          } catch {
            cloud.sent.push(data);
          }
        }
        // What was sent before a close still arrives, ahead of it.
        const server = this.server;
        if (server.closed) return;
        later(() => server.object?.run((o) => o.room.webSocketMessage(server, data)));
      }
      close(code = 1000, reason = '') {
        if (this.readyState === 3) return;
        const server = this.server;
        this.readyState = 3;
        later(() => this.onclose?.({ code, reason }));
        if (server && !server.closed) {
          server.closed = true;
          later(() => server.object?.run((o) => o.room.webSocketClose(server, code, reason, true)));
        }
      }
    };

  /** What star.js gets for fetch, on a device at that public address. */
  const fetchFrom = (from, relay = false) => async (url) => {
    if (cloud.offline) throw new TypeError('offline');
    return worker.fetch(new Request(url, { headers: headers(from, {}, relay) }), env);
  };

  return Object.assign(cloud, {
    env,
    address,
    WebSocket: socketFrom(address),
    fetch: fetchFrom(address),
    /** A device at its own public address; relay: seen through a privacy relay at that address. */
    device: (from, { relay = false } = {}) => ({ WebSocket: socketFrom(from, relay), fetch: fetchFrom(from, relay) }),
    /** Waits until nothing is on its way. */
    async settle() {
      for (let quiet = 0; quiet < 3; ) {
        await tick();
        quiet = cloud.pending ? 0 : quiet + 1;
      }
    },
    /** Moves the clock on and runs the alarms that are due. */
    async advance(ms) {
      cloud.clock += ms;
      for (const o of cloud.objects.values()) {
        if (o.alarm != null && o.alarm <= cloud.clock) {
          o.alarm = null;
          await o.run(() => o.room.alarm());
        }
      }
      await cloud.settle();
    },
    /** The link dies the way iOS kills a backgrounded app's: the room sees it close, the page doesn't. */
    drop(ws) {
      const server = ws.server;
      if (!server || server.closed) return;
      server.closed = true;
      server.client = null;
      ws.server = { closed: true, object: null };
      later(() => server.object.run((o) => o.room.webSocketClose(server, 1006, '', false)));
    },
    /** Every object forgets what it held in memory, as hibernation does. */
    hibernate() {
      for (const o of [...cloud.objects.values(), ...cloud.nets.values()]) o[o.prop] = o.make(o.ctx);
    },
    /** A raw socket to a room, for the Worker's own tests. */
    connect(path, { from = address, relay = false } = {}) {
      const ws = new (socketFrom(from, relay))(`wss://rooms.test${path}`);
      ws.messages = [];
      ws.closedWith = null;
      ws.onmessage = (e) => ws.messages.push(e.data === 'pong' ? 'pong' : JSON.parse(e.data));
      ws.onclose = (e) => (ws.closedWith = e.code);
      return ws;
    },
  });
}

/**
 * Networks for star.js's direct links. device(wifi, { public, home }) gives an RTCPeerConnection
 * class for a device on that Wi-Fi (null: none), optionally with a public address it offers too, as
 * an attacker could, and with the address a STUN server would see it at (home), offered only by a
 * connection made with iceServers. Offers and answers carry candidates: a device's Wi-Fi address appears as an
 * mDNS name (`home-3.local`), which only devices on that Wi-Fi can reach; a public address can be
 * reached from anywhere (an outgoing check gets through any NAT). Two connections link when either
 * side can reach a candidate in what it was given. cut(wifi) makes a Wi-Fi go quiet the way a phone
 * walking out of it does: its channels stay open but nothing gets through, and nothing new links
 * until restore(wifi).
 */
export function createRadio() {
  const radio = { connections: new Map(), next: 0, down: new Set(), opened: 0 };

  class FakeChannel {
    constructor(label, pc) {
      this.label = label;
      this.pc = pc;
      this.readyState = 'connecting';
      this.onopen = this.onclose = this.onmessage = null;
      this.twin = null;
      this.silent = false;
    }
    send(data) {
      if (this.readyState !== 'open') throw new Error('channel not open');
      const twin = this.twin;
      if (this.silent || !twin) return;
      setImmediate(() => twin.readyState === 'open' && !twin.silent && twin.onmessage?.({ data }));
    }
    close() {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      setImmediate(() => this.onclose?.({}));
      const twin = this.twin;
      if (twin && twin.readyState !== 'closed' && !this.silent) {
        twin.readyState = 'closed';
        setImmediate(() => twin.onclose?.({}));
      }
    }
  }

  function link(offerer, answerer) {
    if (offerer.closed || answerer.closed) return;
    for (const dc of offerer.channels) {
      const twin = new FakeChannel(dc.label, answerer);
      dc.twin = twin;
      twin.twin = dc;
      answerer.channels.push(twin);
      answerer.ondatachannel?.({ channel: twin });
      dc.readyState = twin.readyState = 'open';
      radio.opened++;
      dc.onopen?.({});
      twin.onopen?.({});
    }
  }

  const candidates = (sdp) =>
    String(sdp).split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.split(' ')[4]);
  const reaches = (pc, address) => {
    if (!address.endsWith('.local')) return true; // public: reachable from anywhere
    const wifi = address.slice(0, address.lastIndexOf('-'));
    return pc.wifi === wifi && !radio.down.has(wifi);
  };

  radio.device = (wifi, { public: publicAddress = null, home = null } = {}) =>
    class FakeRTCPeerConnection {
      constructor(config = {}) {
        this.stun = (config.iceServers ?? []).length > 0;
        this.id = ++radio.next;
        radio.connections.set(this.id, this);
        this.wifi = wifi;
        this.iceGatheringState = 'new';
        this.connectionState = 'new';
        this.channels = [];
        this.listeners = new Map();
        this.ondatachannel = this.onconnectionstatechange = null;
        this.closed = false;
      }
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(fn);
      }
      removeEventListener(type, fn) {
        this.listeners.get(type)?.delete(fn);
      }
      createDataChannel(label) {
        const dc = new FakeChannel(label, this);
        this.channels.push(dc);
        return dc;
      }
      describe(type) {
        const lines = ['v=0', `a=fake:${this.id}`];
        if (wifi) lines.push(`a=candidate:1 1 udp 2122260223 ${wifi}-${this.id}.local 9 typ host`);
        if (publicAddress) lines.push(`a=candidate:2 1 udp 1686052607 ${publicAddress} 9 typ host`);
        if (home && this.stun) lines.push(`a=candidate:3 1 udp 1677729535 ${home} 9 typ srflx raddr 0.0.0.0 rport 0`);
        return { type, sdp: `${lines.join('\r\n')}\r\n` };
      }
      async createOffer() {
        return this.describe('offer');
      }
      async createAnswer() {
        return this.describe('answer');
      }
      async setLocalDescription(description) {
        this.localDescription = description;
        setImmediate(() => {
          this.iceGatheringState = 'complete';
          for (const fn of this.listeners.get('icegatheringstatechange') ?? []) fn();
        });
      }
      async setRemoteDescription(description) {
        this.remoteDescription = description;
        if (description.type !== 'answer') return;
        const id = Number(/a=fake:(\d+)/.exec(description.sdp)?.[1]);
        const other = radio.connections.get(id);
        if (!other || other.closed) return;
        const mine = candidates(description.sdp).some((a) => reaches(this, a));
        const theirs = candidates(other.remoteDescription?.sdp ?? '').some((a) => reaches(other, a));
        if (mine || theirs) setTimeout(() => link(this, other), 5);
      }
      close() {
        this.closed = true;
        for (const dc of this.channels) dc.close();
      }
    };

  radio.cut = (wifi) => {
    radio.down.add(wifi);
    for (const pc of radio.connections.values()) {
      if (pc.wifi === wifi) for (const dc of pc.channels) dc.silent = true;
    }
  };
  radio.restore = (wifi) => radio.down.delete(wifi);
  return radio;
}
