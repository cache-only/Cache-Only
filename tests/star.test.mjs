// Star (src/shared/star.js), the multiplayer client, against the real rooms Worker in memory.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Star from '../src/shared/star.js';
import { createCloud, createRadio } from './fake-rooms.mjs';

const TIMING = {
  open: 200, ping: 1e9, pong: 40, backoff: [5, 10, 20],
  gather: 50, direct: 300, directPing: 30, directPong: 40, directRetry: [20, 40],
};

/**
 * A cloud and a radio, and Star calls wired to them; every room opened is closed when the test
 * ends. { wifi: 'home' } puts a device on that Wi-Fi, { wifi: null } on mobile data only; without
 * wifi it has no WebRTC at all.
 */
function setup(t) {
  const cloud = createCloud();
  const radio = createRadio();
  const opened = [];
  const opts = ({ wifi, publicAddress, home, from, relay, ...o }) => ({
    url: 'wss://rooms.test',
    WebSocket: from ? cloud.device(from, { relay }).WebSocket : cloud.WebSocket,
    timing: TIMING,
    ...(wifi === undefined ? {} : { RTCPeerConnection: radio.device(wifi, { public: publicAddress, home }) }),
    ...o,
  });
  const keep = (room) => (opened.push(room), room);
  let host = null;
  t.after(() => opened.forEach((room) => room.close()));
  return {
    cloud,
    radio,
    create: async (o = {}) => (host = keep(await Star.create({ game: 'ktan', name: 'Host', ...opts(o) }))),
    /** Joins, and has the host let the seat in at once unless wait is set. */
    join: async (code, { wait = false, ...o } = {}) => {
      const room = keep(await Star.join(code, { game: 'ktan', ...opts(o) }));
      if (!wait && !room.admitted) {
        host.admit(room.seat);
        await until(() => room.admitted);
      }
      return room;
    },
  };
}

async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${fn}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Everything a room hears, by event. */
function listen(room) {
  const heard = { members: [], message: [], host: [], status: [], closed: [], link: [], knock: [], admitted: 0 };
  room.on('members', (m) => heard.members.push(m));
  room.on('message', (from, msg) => heard.message.push([from, msg]));
  room.on('host', (h) => heard.host.push(h));
  room.on('status', (s) => heard.status.push(s));
  room.on('closed', (r) => heard.closed.push(r));
  room.on('link', (seat, link, why) => heard.link.push([seat, link, why]));
  room.on('knock', (m) => heard.knock.push(m.name));
  room.on('admitted', () => heard.admitted++);
  return heard;
}

const names = (room) => room.members.map((m) => `${m.name}:${m.link}`);

test('a host creates a room and members join it by code', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  assert.match(host.code, /^[A-Z]{4}$/);
  assert.equal(host.isHost, true);
  assert.equal(host.status, 'open');

  const anna = await join(host.code.toLowerCase(), { name: 'Anna' });
  await cloud.settle();
  assert.equal(anna.isHost, false);
  assert.equal(anna.seat, 1);
  assert.deepEqual(names(host), ['Host:host', 'Anna:relayed']);
  assert.deepEqual(names(anna), ['Host:host', 'Anna:relayed']);
  assert.equal(anna.members.find((m) => m.you).seat, 1);
  assert.equal(host.local, false);
});

test('members talk to the host, and the host to one member or all', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const pol = await join(host.code, { name: 'Pol' });
  const [h, a, p] = [host, anna, pol].map(listen);

  anna.send({ act: 'roll' });
  host.sendTo(pol.seat, { view: 'yours' });
  host.broadcast({ event: 'dice', roll: 8 });
  await cloud.settle();
  assert.deepEqual(h.message, [[1, { act: 'roll' }]]);
  assert.deepEqual(a.message, [[0, { event: 'dice', roll: 8 }]]);
  assert.deepEqual(p.message, [[0, { view: 'yours' }], [0, { event: 'dice', roll: 8 }]]);

  assert.throws(() => anna.broadcast('x'), /only the host/);
  assert.throws(() => anna.sendTo(0, 'x'), /only the host/);
  assert.throws(() => anna.start(), /only the host/);
  assert.throws(() => host.send('x'), /sendTo or broadcast/);
  assert.throws(() => host.leave(), /ends the room/);
});

test('a failed join says why', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const reason = (promise) => promise.then(() => 'joined', (err) => err.reason);
  assert.equal(await reason(join('ZZZZ', { name: 'X' })), 'room');
  assert.equal(await reason(join('AB1', { name: 'X' })), 'room');
  assert.equal(await reason(join(host.code, { name: 'X', game: 'tanks' })), 'game');
  assert.equal(await reason(join(host.code, { token: 'nope' })), 'token');
  host.start();
  await cloud.settle();
  assert.equal(await reason(join(host.code, { name: 'Late' })), 'started');
  cloud.offline = true;
  assert.equal(await reason(create()), 'offline');
});

test('a dead link is found on wake and comes back to the same seat, with what was sent meanwhile', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const [h, a] = [host, anna].map(listen);

  cloud.drop(anna.ws); // iOS suspended the app: the room sees the link go, the page doesn't
  await cloud.settle();
  assert.deepEqual(names(host), ['Host:host', 'Anna:away']);
  assert.equal(anna.status, 'open');

  anna.wake(); // back in the foreground: the ping goes unanswered
  anna.send('lost'); // sent into the dead socket, before anyone knows
  await new Promise((r) => setTimeout(r, TIMING.pong + 10));
  anna.send('kept'); // queued while it reconnects
  await new Promise((r) => setTimeout(r, 50));
  await cloud.settle();
  assert.deepEqual(a.status, ['reconnecting', 'open']);
  assert.equal(anna.seat, 1);
  assert.deepEqual(names(host), ['Host:host', 'Anna:relayed']);
  assert.deepEqual(h.message, [[1, 'kept']]);
});

test('a link the room closes is tried again until it comes back', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const a = listen(anna);
  cloud.offline = true;
  cloud.drop(anna.ws);
  anna.ws.shut(1006, ''); // the network went
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(anna.status, 'reconnecting');
  cloud.offline = false;
  await new Promise((r) => setTimeout(r, 60));
  await cloud.settle();
  assert.equal(anna.status, 'open');
  assert.ok(a.status.filter((s) => s === 'reconnecting').length >= 1);
  assert.deepEqual(names(host), ['Host:host', 'Anna:relayed']);
});

test('a lost host is replaced, and the new host gets the backup; the old one comes back as a member', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const [h, a] = [host, anna].map(listen);
  host.backup({ turn: 3 });
  await cloud.settle();

  cloud.drop(host.ws);
  await cloud.settle();
  await cloud.advance(20_000);
  assert.equal(anna.isHost, true);
  assert.deepEqual(a.host, [{ host: 1, backup: { turn: 3 } }]);
  anna.broadcast('anna hosts now');

  host.wake();
  await new Promise((r) => setTimeout(r, TIMING.pong + 30));
  await cloud.settle();
  assert.equal(host.isHost, false);
  assert.deepEqual(h.host, [{ host: 1, backup: null }]);
  assert.deepEqual(names(anna), ['Host:relayed', 'Anna:host']);
  host.send('hi, host');
  await cloud.settle();
  assert.deepEqual(a.message, [[0, 'hi, host']]);
});

test('messages queued as host are dropped if the room changed hands meanwhile', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const a = listen(anna);
  cloud.drop(host.ws);
  await cloud.settle();
  await cloud.advance(20_000);
  host.wake();
  host.broadcast('stale'); // still believes it hosts
  await new Promise((r) => setTimeout(r, TIMING.pong + 30));
  await cloud.settle();
  assert.equal(host.isHost, false);
  assert.deepEqual(a.message, []);
});

test('the host hands over to a member', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const a = listen(anna);
  host.sendTo(anna.seat, { state: 'all of it' });
  host.handOver(anna.seat);
  await cloud.settle();
  assert.equal(anna.isHost, true);
  assert.equal(host.isHost, false);
  assert.deepEqual(a.message, [[0, { state: 'all of it' }]]);
  assert.deepEqual(a.host, [{ host: 1, backup: null }]);
});

test('a member leaves, the host ends the room, and a second copy of a seat replaces the first', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create();
  const anna = await join(host.code, { name: 'Anna' });
  const pol = await join(host.code, { name: 'Pol' });
  anna.leave();
  await cloud.settle();
  assert.equal(anna.status, 'closed');
  assert.deepEqual(names(host), ['Host:host', 'Pol:relayed']);

  const p = listen(pol);
  const copy = await join(host.code, { token: pol.token });
  await cloud.settle();
  assert.deepEqual(p.closed, ['replaced']);
  assert.equal(copy.seat, pol.seat);

  const c = listen(copy);
  host.end();
  await cloud.settle();
  assert.deepEqual(c.closed, ['ended']);
  assert.equal(host.status, 'closed');
});

test('a table hosts a room with no seat for a player', async (t) => {
  const { cloud, create, join } = setup(t);
  const table = await create({ seat: false, name: '' });
  const anna = await join(table.code, { name: 'Anna' });
  await cloud.settle();
  assert.equal(table.isHost, true);
  assert.deepEqual(anna.members.map((m) => [m.seat, m.table, m.host]), [[0, true, true], [1, false, false]]);
});

const appMessages = (sent) => sent.filter((m) => m.msg && 'a' in m.msg);

test('members on the same Wi-Fi link to the host directly, and their messages skip the room', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const anna = await join(host.code, { name: 'Anna', wifi: 'home' });
  const pol = await join(host.code, { name: 'Pol', wifi: null }); // on mobile data
  await until(() => anna.local);
  await until(() => names(pol).join() === 'Host:host,Anna:direct,Pol:relayed');
  assert.deepEqual(names(host), ['Host:host', 'Anna:direct', 'Pol:relayed']);
  assert.deepEqual(names(anna), ['Host:host', 'Anna:direct', 'Pol:relayed']);
  assert.equal(host.local, false, 'Pol still goes through the room');
  assert.equal(pol.local, false);

  const [h, a, p] = [host, anna, pol].map(listen);
  const before = cloud.sent.length;
  anna.send('over the wifi');
  host.sendTo(anna.seat, 'back over the wifi');
  host.broadcast('to all');
  await until(() => h.message.length === 1 && a.message.length === 2 && p.message.length === 1);
  assert.deepEqual(h.message, [[1, 'over the wifi']]);
  assert.deepEqual(a.message, [[0, 'back over the wifi'], [0, 'to all']]);
  assert.deepEqual(p.message, [[0, 'to all']]);
  assert.deepEqual(appMessages(cloud.sent.slice(before)), [{ to: 2, msg: { a: 'to all' } }], "only Pol's copy went through the room");
});

test('a room where every member is direct is local: the room sees no message at all', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const anna = await join(host.code, { name: 'Anna', wifi: 'home' });
  const pol = await join(host.code, { name: 'Pol', wifi: 'home' });
  await until(() => host.local && anna.local && pol.local);
  const [a, p] = [anna, pol].map(listen);
  const before = cloud.sent.length;
  host.broadcast({ view: 1 });
  pol.send({ act: 'roll' });
  await until(() => a.message.length === 1 && p.message.length === 1);
  await cloud.settle();
  assert.deepEqual(cloud.sent.slice(before), []);
});

test('a direct link that goes quiet falls back to the room, and comes back with the Wi-Fi', async (t) => {
  const { radio, create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const anna = await join(host.code, { name: 'Anna', wifi: 'home' });
  await until(() => anna.local && host.local);
  const [h, a] = [host, anna].map(listen);

  radio.cut('home'); // channels look open, nothing gets through
  await until(() => !anna.local && !host.local);
  assert.deepEqual(a.link[0], [0, 'relayed', 'silent']);
  assert.deepEqual(names(anna), ['Host:host', 'Anna:relayed']);
  anna.send('through the room');
  await until(() => h.message.length === 1);
  assert.deepEqual(h.message, [[1, 'through the room']]);

  radio.restore('home');
  await until(() => anna.local && host.local, 3000);
  assert.deepEqual(names(host), ['Host:host', 'Anna:direct']);
});

test('direct links carry on when the internet goes', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const anna = await join(host.code, { name: 'Anna', wifi: 'home' });
  await until(() => anna.local && host.local);
  const [h, a] = [host, anna].map(listen);
  cloud.offline = true;
  for (const room of [host, anna]) {
    cloud.drop(room.ws);
    room.ws.shut(1006, '');
  }
  await until(() => host.status === 'reconnecting' && anna.status === 'reconnecting');
  anna.send('still here');
  host.broadcast('so am I');
  await until(() => h.message.length === 1 && a.message.length === 1);
  assert.equal(anna.local, true);
  assert.equal(names(anna)[1], 'Anna:direct');
});

test('after a handover the members link directly to the new host', async (t) => {
  const { create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const anna = await join(host.code, { name: 'Anna', wifi: 'home' });
  const pol = await join(host.code, { name: 'Pol', wifi: 'home' });
  await until(() => host.local);
  host.handOver(anna.seat);
  await until(() => anna.isHost && anna.local && pol.local && host.local, 3000);
  assert.deepEqual(names(anna), ['Host:direct', 'Anna:host', 'Pol:direct']);
  assert.deepEqual(names(pol), ['Host:direct', 'Anna:host', 'Pol:direct']);
});

test('without WebRTC, or on another network, a member stays relayed', async (t) => {
  const { create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const anna = await join(host.code, { name: 'Anna' }); // no WebRTC
  const pol = await join(host.code, { name: 'Pol', wifi: 'office' });
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(names(host), ['Host:host', 'Anna:relayed', 'Pol:relayed']);
  const h = listen(host);
  pol.send('hello');
  await until(() => h.message.length === 1);
});

test('a seat on the same Wi-Fi is let in by itself', async (t) => {
  const { create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const h = listen(host);
  const anna = await join(host.code, { name: 'Anna', wifi: 'home', wait: true });
  const a = listen(anna);
  assert.equal(anna.admitted, false, 'it knocks first');
  await until(() => anna.admitted && anna.local);
  assert.deepEqual(h.knock, ['Anna']);
  assert.equal(a.admitted, 1);
  assert.deepEqual(host.members.map((m) => [m.name, m.admitted, m.link]), [['Host', true, 'host'], ['Anna', true, 'direct']]);
});

test('a seat from elsewhere waits for the host, which lets it in or turns it away', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create({ wifi: 'home' });
  const h = listen(host);
  const anna = await join(host.code, { name: 'Anna', wifi: null, from: '198.51.100.20', wait: true });
  const a = listen(anna);
  await new Promise((r) => setTimeout(r, 400)); // its direct tries fail
  assert.equal(anna.admitted, false);
  assert.deepEqual(h.knock, ['Anna']);
  assert.deepEqual(host.members.map((m) => [m.name, m.admitted]), [['Host', true], ['Anna', false]]);

  host.broadcast('game news'); // not for a seat still waiting
  anna.send('let me play'); // and the host doesn't take its game messages
  await cloud.settle();
  assert.deepEqual(a.message, []);
  assert.deepEqual(h.message, []);

  host.admit(anna.seat);
  await until(() => anna.admitted);
  assert.equal(a.admitted, 1);
  host.broadcast('welcome in');
  anna.send('thanks');
  await until(() => a.message.length === 1 && h.message.length === 1);

  const pol = await join(host.code, { name: 'Pol', from: '198.51.100.21', wait: true });
  const p = listen(pol);
  await until(() => host.members.some((m) => m.name === 'Pol'));
  host.refuse(pol.seat);
  await until(() => p.closed.length === 1);
  assert.deepEqual(p.closed, ['refused']);
  assert.deepEqual(host.members.map((m) => m.name), ['Host', 'Anna']);
});

test('an outsider who offers a public address never links, so it is never let in', async (t) => {
  const { cloud, radio, create } = setup(t);
  const host = await create({ wifi: 'home', publicAddress: '84.79.5.6' });
  const h = listen(host);
  // A client of its own, not star.js: it sends its public address and keeps the host's answer whole.
  const Evil = radio.device(null, { public: '198.51.100.66' });
  const pc = new Evil();
  pc.createDataChannel('star');
  await pc.setLocalDescription(await pc.createOffer());
  const evil = cloud.connect(`/rooms/${host.code}?game=ktan&name=Evil`, { from: '198.51.100.66' });
  await cloud.settle();
  evil.send(JSON.stringify({ msg: { s: 'offer', g: 1, sdp: pc.localDescription.sdp } }));
  await until(() => evil.messages.some((m) => m.msg?.s === 'answer'));
  const { sdp } = evil.messages.find((m) => m.msg?.s === 'answer').msg;
  assert.ok(!sdp.includes('84.79.5.6'), "the host doesn't hand out its public address");
  assert.ok(sdp.includes('.local'), 'only its local one');
  await pc.setRemoteDescription({ type: 'answer', sdp });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(radio.opened, 0, 'no link opened');
  assert.deepEqual(h.knock, ['Evil']);
  assert.equal(host.members.find((m) => m.name === 'Evil').admitted, false);
});

test('only local addresses survive in an offer', () => {
  const line = (address) => `a=candidate:1 1 udp 2122260223 ${address} 9 typ host`;
  const kept = ['4f2a1c0e-1111-2222-3333-444455556666.local', '192.168.1.20', '10.0.0.7', '172.20.10.2', '169.254.3.4', 'fe80::1', 'fd12:3456::9'];
  const dropped = ['84.79.5.6', '203.0.113.5', '172.32.0.1', '100.64.0.1', '2a0c:5a80::1', 'evil.example.com'];
  const sdp = ['v=0', ...[...kept, ...dropped].map(line), 'a=end-of-candidates', ''].join('\r\n');
  const out = Star.localOnly(sdp);
  assert.deepEqual(out.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.split(' ')[4]), kept);
  assert.ok(out.startsWith('v=0\r\n') && out.includes('a=end-of-candidates'));
});

test('rooms on this network can be listed and joined without a code', async (t) => {
  const { cloud, create, join } = setup(t);
  const host = await create({ name: 'Pol', from: '84.79.5.6' });
  const here = cloud.device('84.79.5.6');
  const elsewhere = cloud.device('192.0.2.1');
  const rooms = await Star.nearby({ game: 'ktan', url: 'wss://rooms.test', fetch: here.fetch });
  assert.deepEqual(rooms, [{ code: host.code, name: 'Pol' }]);
  assert.deepEqual(await Star.nearby({ game: 'ktan', url: 'wss://rooms.test', fetch: elsewhere.fetch }), []);
  cloud.offline = true;
  assert.deepEqual(await Star.nearby({ game: 'ktan', url: 'wss://rooms.test', fetch: here.fetch }), [], 'offline: none');
  cloud.offline = false;
  const anna = await join(rooms[0].code, { name: 'Anna', from: '84.79.5.6' });
  assert.equal(anna.code, host.code);
});

test("a STUN server's answer names the network, and never reaches a game link", async (t) => {
  const { radio, create, join } = setup(t);
  const Home = radio.device('home', { home: '84.79.5.6' });
  assert.deepEqual(await Star.networkHint({ RTCPeerConnection: Home }), ['84.79.5.6']);
  assert.deepEqual(await Star.networkHint({ RTCPeerConnection: undefined }), [], 'no WebRTC: no answer');
  assert.deepEqual(await Star.networkHint({ RTCPeerConnection: radio.device(null) }), [], 'a network that blocks STUN');

  const host = await create({ wifi: 'home', home: '84.79.5.6' });
  const anna = await join(host.code, { name: 'Anna', wifi: 'home', home: '84.79.5.6', wait: true });
  await until(() => anna.admitted && anna.local);
  for (const pc of radio.connections.values()) {
    for (const d of [pc.localDescription, pc.remoteDescription]) {
      if (d && !pc.stun) assert.ok(!d.sdp.includes('84.79.5.6'), 'a game link never offers the public address');
    }
  }
});

test('phones behind iCloud Private Relay find each other on the same Wi-Fi', async (t) => {
  const { cloud, radio, create, join } = setup(t);
  const host = await create({ name: 'Pol', wifi: 'home', home: '84.79.5.6', from: '2a09:bac3:3111:37d::59:61', relay: true });
  const phone = { wifi: 'home', home: '84.79.5.6', from: '2a09:bac3:3111:4c0::12', relay: true };
  const rooms = await Star.nearby({
    game: 'ktan',
    url: 'wss://rooms.test',
    fetch: cloud.device(phone.from, { relay: true }).fetch,
    RTCPeerConnection: radio.device(phone.wifi, { home: phone.home }),
  });
  assert.deepEqual(rooms, [{ code: host.code, name: 'Pol' }]);
  const anna = await join(rooms[0].code, { name: 'Anna', ...phone, wait: true });
  await until(() => anna.admitted && anna.local);

  const stranger = await Star.nearby({ game: 'ktan', url: 'wss://rooms.test', fetch: cloud.device('2a09:bac3:3111:37d::99', { relay: true }).fetch });
  assert.deepEqual(stranger, [], 'someone else on the same relay, without the home address');
});
