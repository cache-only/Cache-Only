// The rooms Worker (worker/rooms.js), run in Node against an in-memory Cloudflare.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { CLOSE, FLOOD, PER_MINUTE, allowedOrigin, networkOf, networksFor, platform, publicAddress } from '../worker/rooms.js';
import { createCloud } from './fake-rooms.mjs';

const ctl = (ws, name) => ws.messages.filter((m) => m.ctl === name);
const last = (ws, name) => ctl(ws, name).at(-1);
const relayed = (ws) => ws.messages.filter((m) => m && 'from' in m);
const send = (ws, obj) => ws.send(JSON.stringify(obj));
const seatsOf = (ws) => last(ws, 'seats').seats.map((s) => `${s.seat}:${s.name}:${s.admitted ? 'in' : 'waiting'}:${s.online ? 'online' : 'away'}`);

/** A room with a host and the members named, all connected and let in. */
async function room(cloud, names = [], { game = 'ktan', host = 'Host', admit = true, from } = {}) {
  const h = cloud.connect(`/rooms/new?game=${game}&name=${host}`, { from });
  await cloud.settle();
  const { code } = last(h, 'welcome');
  const members = [];
  for (const name of names) {
    const m = cloud.connect(`/rooms/${code}?game=${game}&name=${name}`, { from });
    await cloud.settle();
    if (admit) send(h, { ctl: 'admit', seat: last(m, 'welcome').seat });
    members.push(m);
  }
  await cloud.settle();
  return { code, host: h, members };
}

test('only WebSockets from the app and the dev servers reach a room', async () => {
  const cloud = createCloud();
  const get = (path, headers = {}) => worker.fetch(new Request(`https://rooms.test${path}`, { headers }), cloud.env);
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/rooms/new', { Origin: 'https://cache-only.github.io' })).status, 426);
  assert.equal((await get('/rooms/new', { Upgrade: 'websocket', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await get('/rooms/new', { Upgrade: 'websocket' })).status, 403);
  assert.equal((await get('/nearby?game=ktan', { Origin: 'https://evil.example' })).status, 403);

  for (const origin of ['https://cache-only.github.io', 'http://127.0.0.1:8080', 'http://localhost:8080', 'https://pols-mac.local:8443', 'https://192.168.1.20:8443', 'https://10.0.0.5:8443', 'https://172.20.10.2:8443']) {
    assert.ok(allowedOrigin(origin), origin);
  }
  for (const origin of ['https://cache-only.github.io.evil.com', 'http://cache-only.github.io', 'https://pols-mac.local:9999', 'https://8.8.8.8:8443', 'https://172.32.0.1:8443', null, '']) {
    assert.ok(!allowedOrigin(origin), String(origin));
  }
});

test('a network is an IPv4 address, or an IPv6 /64', () => {
  assert.equal(networkOf('84.79.5.6'), 'v4:84.79.5.6');
  assert.equal(networkOf('::ffff:84.79.5.6'), 'v4:84.79.5.6');
  assert.equal(networkOf('2a0c:5a80:1234:ab00:1c2d:3e4f:5a6b:7c8d'), 'v6:2a0c:5a80:1234:ab00');
  assert.equal(networkOf('2a0c:5a80:1234:ab00::7'), 'v6:2a0c:5a80:1234:ab00');
  assert.equal(networkOf('2A0C:5A80:0:0AB0::1'), 'v6:2a0c:5a80:0:ab0');
  assert.equal(networkOf('2a0c::1'), 'v6:2a0c:0:0:0');
  assert.equal(networkOf(''), 'none');
});

test('a new room welcomes its host with a code, a seat and a token', async () => {
  const cloud = createCloud();
  const { code, host } = await room(cloud);
  const welcome = last(host, 'welcome');
  assert.match(code, /^[A-HJ-NP-Z]{4}$/, 'four letters, no I or O');
  assert.equal(welcome.seat, 0);
  assert.equal(welcome.host, 0);
  assert.equal(welcome.admitted, true);
  assert.match(welcome.token, /^[0-9a-f]{32}$/);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online']);
});

test('a code already taken gets another', async () => {
  const cloud = createCloud();
  const code = platform.code;
  const codes = ['ABCD', 'ABCD', 'EFGH'];
  platform.code = () => codes.shift();
  try {
    const first = await room(cloud);
    const second = await room(cloud);
    assert.equal(first.code, 'ABCD');
    assert.equal(second.code, 'EFGH');
  } finally {
    platform.code = code;
  }
});

test('a new seat waits until the host lets it in, and can be refused', async () => {
  const cloud = createCloud();
  const { code, host } = await room(cloud);
  const anna = cloud.connect(`/rooms/${code}?game=ktan&name=Anna`);
  await cloud.settle();
  assert.equal(last(anna, 'welcome').admitted, false);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '1:Anna:waiting:online']);

  // While waiting it reaches the host (to link directly), and hears only what is sent to it.
  send(anna, { msg: { s: 'offer' } });
  send(host, { to: 'all', msg: 'game news' });
  send(host, { to: 1, msg: { s: 'answer' } });
  await cloud.settle();
  assert.deepEqual(relayed(host), [{ from: 1, msg: { s: 'offer' } }]);
  assert.deepEqual(relayed(anna), [{ from: 0, msg: { s: 'answer' } }]);

  send(anna, { ctl: 'admit', seat: 1 }); // only the host lets seats in
  await cloud.settle();
  assert.equal(last(host, 'seats').seats[1].admitted, false);
  send(host, { ctl: 'admit', seat: 1 });
  await cloud.settle();
  assert.deepEqual(seatsOf(anna), ['0:Host:in:online', '1:Anna:in:online']);
  send(host, { to: 'all', msg: 'now you hear this' });
  await cloud.settle();
  assert.deepEqual(relayed(anna).at(-1), { from: 0, msg: 'now you hear this' });

  const pol = cloud.connect(`/rooms/${code}?game=ktan&name=Pol`);
  await cloud.settle();
  send(host, { ctl: 'refuse', seat: last(pol, 'welcome').seat });
  await cloud.settle();
  assert.equal(pol.closedWith, CLOSE.refused);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '1:Anna:in:online']);
  const back = cloud.connect(`/rooms/${code}?game=ktan&token=${last(pol, 'welcome').token}`);
  await cloud.settle();
  assert.equal(back.closedWith, CLOSE.token, 'a refused seat is gone, token and all');
});

test('at most 6 seats wait at once, 2 from any network but the host\'s; one that leaves is gone; the start turns the rest away', async () => {
  const cloud = createCloud();
  const { code, host } = await room(cloud, [], { from: '84.79.5.6' });
  const knock = (name, from = '84.79.5.6') => cloud.connect(`/rooms/${code}?game=ktan&name=${name}`, { from });
  const outside = ['X', 'Y', 'Z'].map((name) => knock(name, '192.0.2.10'));
  await cloud.settle();
  assert.equal(outside[2].closedWith, CLOSE.busy, 'a third from one outside network');
  outside[0].close();
  outside[1].close();
  await cloud.settle();
  const waiting = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => knock(name)); // the host's own Wi-Fi
  await cloud.settle();
  assert.ok(waiting.every((ws) => ws.closedWith === null));
  const seventh = knock('G');
  await cloud.settle();
  assert.equal(seventh.closedWith, CLOSE.busy);

  waiting[0].close();
  await cloud.settle();
  assert.deepEqual(seatsOf(host).map((s) => s.split(':')[1]), ['Host', 'B', 'C', 'D', 'E', 'F']);

  send(host, { ctl: 'start' });
  await cloud.settle();
  for (const ws of waiting.slice(1)) assert.equal(ws.closedWith, CLOSE.started);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online']);
});

test('members reach only the host; the host reaches one seat or all', async () => {
  const cloud = createCloud();
  const { host, members: [anna, pol] } = await room(cloud, ['Anna', 'Pol']);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '1:Anna:in:online', '2:Pol:in:online']);

  send(anna, { msg: { hi: 1 } });
  send(anna, { to: 2, msg: { sneaky: true } }); // a member can't address another member
  await cloud.settle();
  assert.deepEqual(relayed(host), [{ from: 1, msg: { hi: 1 } }, { from: 1, msg: { sneaky: true } }]);
  assert.deepEqual(relayed(pol), []);

  send(host, { to: 2, msg: 'just you' });
  send(host, { to: 'all', msg: 'everyone' });
  await cloud.settle();
  assert.deepEqual(relayed(anna), [{ from: 0, msg: 'everyone' }]);
  assert.deepEqual(relayed(pol), [{ from: 0, msg: 'just you' }, { from: 0, msg: 'everyone' }]);
  assert.deepEqual(relayed(host).length, 2, 'the host never hears itself');

  send(anna, 'not json');
  anna.send('ping');
  await cloud.settle();
  assert.equal(anna.messages.at(-1), 'pong');
});

test('a socket that floods the room is closed: too big, or too many', async () => {
  const cloud = createCloud();
  const { host, members: [anna, pol] } = await room(cloud, ['Anna', 'Pol']);
  anna.send(JSON.stringify({ msg: 'x'.repeat(FLOOD.member.bytes) }));
  await cloud.settle();
  assert.equal(anna.closedWith, CLOSE.flood);
  assert.deepEqual(seatsOf(host)[1], '1:Anna:in:away');

  for (let i = 0; i < FLOOD.member.rate * 2 + 5; i++) send(pol, { msg: i }); // all in the same instant
  await cloud.settle();
  assert.equal(pol.closedWith, CLOSE.flood);
  assert.equal(relayed(host).length, FLOOD.member.rate * 2, 'the burst gets through, then the socket goes');

  // The host may send far more, and bigger.
  const { host: busy, members: [m] } = await room(cloud, ['M']);
  for (let i = 0; i < 100; i++) send(busy, { to: 'all', msg: { view: i, pad: 'y'.repeat(20_000) } });
  await cloud.settle();
  assert.equal(busy.closedWith, null);
  assert.equal(relayed(m).length, 100);
});

test('refusals close the socket with a reason', async () => {
  const cloud = createCloud();
  const { code, host } = await room(cloud, ['Anna']);
  const closedWith = async (path) => {
    const ws = cloud.connect(path);
    await cloud.settle();
    return ws.closedWith;
  };
  assert.equal(await closedWith('/rooms/ZZZZ?game=ktan&name=X'), CLOSE.room);
  assert.equal(await closedWith(`/rooms/${code}?game=tanks&name=X`), CLOSE.game);
  assert.equal(await closedWith(`/rooms/${code}?game=ktan&token=nope`), CLOSE.token);
  assert.equal(await closedWith('/rooms/new?name=X'), CLOSE.bad);

  send(host, { ctl: 'start' });
  await cloud.settle();
  assert.equal(last(host, 'seats').started, true);
  assert.equal(await closedWith(`/rooms/${code}?game=ktan&name=Late`), CLOSE.started);
  assert.equal(cloud.objects.has('ZZZZ') && cloud.objects.get('ZZZZ').data.size, 0, 'an unknown code keeps nothing');
});

test('a room holds 12 seats', async () => {
  const cloud = createCloud();
  const { code } = await room(cloud, Array.from({ length: 11 }, (_, i) => `P${i}`), { from: '198.51.100.1' });
  const late = cloud.connect(`/rooms/${code}?game=ktan&name=Late`, { from: '198.51.100.2' });
  await cloud.settle();
  assert.equal(late.closedWith, CLOSE.full);
});

test('one network knocks for at most 20 seats and creates at most 10 rooms a minute; tokens come back freely', async () => {
  const cloud = createCloud();
  const { code, host } = await room(cloud, ['Anna'], { from: '198.51.100.7' });
  const { token } = last(host, 'welcome');
  const guesser = '192.0.2.66';
  const tries = [];
  for (let i = 0; i < PER_MINUTE.join + 1; i++) tries.push(cloud.connect(`/rooms/${code}?game=ktan&name=G${i}`, { from: guesser }));
  await cloud.settle();
  const last1 = tries.at(-1);
  assert.equal(last1.messages.length, 0);
  assert.equal(last1.closedWith, 1006, 'the 21st knock is refused before it reaches the room');

  assert.equal(tries.filter((ws) => last(ws, 'welcome')).length, 2, 'and only 2 of its knocks wait at the door');
  const neighbour = cloud.connect(`/rooms/${code}?game=ktan&name=Fine`, { from: '192.0.2.67' });
  await cloud.settle();
  assert.equal(last(neighbour, 'welcome')?.admitted, false, 'another network is not held back');

  for (let i = 0; i < 5; i++) cloud.connect(`/rooms/${code}?game=ktan&token=${token}`, { from: guesser });
  await cloud.settle();
  assert.equal(last(host, 'seats').seats[0].online, true);

  for (let i = 0; i < PER_MINUTE.create; i++) await room(cloud, [], { from: '192.0.2.99' });
  const eleventh = cloud.connect('/rooms/new?game=ktan&name=X', { from: '192.0.2.99' });
  await cloud.settle();
  assert.equal(eleventh.closedWith, 1006);
  cloud.clock += 60_000;
  await room(cloud, [], { from: '192.0.2.99' });
});

test('a seat comes back with its token, and a newer socket replaces an older one', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna] } = await room(cloud, ['Anna']);
  const { token } = last(anna, 'welcome');

  cloud.drop(anna);
  await cloud.settle();
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '1:Anna:in:away'], 'a seat let in keeps its place while away');

  const back = cloud.connect(`/rooms/${code}?game=ktan&token=${token}`);
  await cloud.settle();
  assert.equal(last(back, 'welcome').seat, 1);
  assert.equal(last(back, 'welcome').admitted, true);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '1:Anna:in:online']);

  // The app came back before the room saw the old link drop.
  const again = cloud.connect(`/rooms/${code}?game=ktan&token=${token}`);
  await cloud.settle();
  assert.equal(back.closedWith, CLOSE.replaced);
  assert.equal(again.closedWith, null);
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '1:Anna:in:online'], 'the replaced socket does not count as leaving');
  send(host, { to: 1, msg: 'still there?' });
  await cloud.settle();
  assert.deepEqual(relayed(again), [{ from: 0, msg: 'still there?' }]);
});

test('leaving before the start frees the seat; after it, the seat waits', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna, pol] } = await room(cloud, ['Anna', 'Pol']);
  send(anna, { ctl: 'leave' });
  await cloud.settle();
  assert.deepEqual(seatsOf(host).map((s) => s.split(':')[1]), ['Host', 'Pol']);

  send(host, { ctl: 'start' });
  const { token } = last(pol, 'welcome');
  send(pol, { ctl: 'leave' });
  await cloud.settle();
  assert.deepEqual(seatsOf(host), ['0:Host:in:online', '2:Pol:in:away']);
  const back = cloud.connect(`/rooms/${code}?game=ktan&token=${token}`);
  await cloud.settle();
  assert.equal(last(back, 'welcome').seat, 2);
});

test('a room survives hibernation', async () => {
  const cloud = createCloud();
  const { host, members: [anna] } = await room(cloud, ['Anna']);
  cloud.hibernate();
  send(anna, { msg: 'after a nap' });
  await cloud.settle();
  assert.deepEqual(relayed(host), [{ from: 1, msg: 'after a nap' }]);
});

test('the host hands over, or is replaced 20 s after it goes, with the last backup', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna, pol] } = await room(cloud, ['Anna', 'Pol']);
  send(host, { ctl: 'backup', state: { turn: 7 } });
  send(host, { ctl: 'handover', seat: 1 });
  await cloud.settle();
  assert.equal(last(pol, 'seats').host, 1);

  // Now Anna hosts. She goes away; for 20 s her seat is kept as host.
  send(anna, { ctl: 'backup', state: { turn: 8 } });
  await cloud.settle();
  cloud.drop(anna);
  await cloud.settle();
  await cloud.advance(19_000);
  assert.equal(last(pol, 'seats').host, 1);
  await cloud.advance(1_000);
  // The next seat after Anna that is online: Pol.
  assert.equal(last(pol, 'seats').host, 2);
  assert.deepEqual(last(pol, 'host'), { ctl: 'host', host: 2, backup: { turn: 8 } });
  assert.equal(ctl(host, 'host').length, 0, 'only the new host gets the backup');

  // Anna comes back as a member.
  const back = cloud.connect(`/rooms/${code}?game=ktan&token=${last(anna, 'welcome').token}`);
  await cloud.settle();
  assert.equal(last(back, 'welcome').host, 2);
});

test('a lost host is replaced by a table before any phone, and never by a seat still waiting', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna] } = await room(cloud, ['Anna']);
  const table = cloud.connect(`/rooms/${code}?game=ktan&table=1`);
  const stranger = cloud.connect(`/rooms/${code}?game=ktan&name=Stranger`);
  await cloud.settle();
  send(host, { ctl: 'admit', seat: last(table, 'welcome').seat });
  send(host, { ctl: 'handover', seat: last(stranger, 'welcome').seat }); // not let in: ignored
  await cloud.settle();
  assert.equal(last(anna, 'seats').host, 0);
  assert.equal(last(table, 'seats').seats[2].table, true);
  cloud.drop(host);
  await cloud.settle();
  await cloud.advance(20_000);
  assert.equal(last(anna, 'seats').host, 2);
});

test('a host that comes back in time keeps the room', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna] } = await room(cloud, ['Anna']);
  const { token } = last(host, 'welcome');
  cloud.drop(host);
  await cloud.settle();
  await cloud.advance(10_000);
  const back = cloud.connect(`/rooms/${code}?game=ktan&token=${token}`);
  await cloud.settle();
  await cloud.advance(30_000);
  assert.equal(last(anna, 'seats').host, 0);
  assert.equal(last(back, 'welcome').host, 0);
});

test('rooms are listed on their host\'s network while they take seats and the host is in', async () => {
  const cloud = createCloud();
  const nearby = async (from, game = 'ktan') => (await cloud.device(from).fetch(`https://rooms.test/nearby?game=${game}`)).json();
  const home = '2a0c:5a80:1234:ab00:1:2:3:4';
  const { code, host } = await room(cloud, [], { from: home, host: 'Pol' });
  const res = await cloud.device('2a0c:5a80:1234:ab00:9:9:9:9').fetch('https://rooms.test/nearby?game=ktan');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://cache-only.github.io');
  assert.deepEqual(await res.json(), [{ code, name: 'Pol' }], 'another device on the same /64 sees it');
  assert.deepEqual(await nearby('2a0c:5a80:1234:ab01::1'), [], 'the next /64 is another network');
  assert.deepEqual(await nearby(home, 'tanks'), [], 'only rooms of the game asked for');

  cloud.drop(host);
  await cloud.settle();
  assert.deepEqual(await nearby(home), [], 'gone while the host is away');
  const back = cloud.connect(`/rooms/${code}?game=ktan&token=${last(host, 'welcome').token}`, { from: home });
  await cloud.settle();
  assert.deepEqual(await nearby(home), [{ code, name: 'Pol' }]);
  send(back, { ctl: 'start' });
  await cloud.settle();
  assert.deepEqual(await nearby(home), [], 'a started room takes no seats');

  const second = await room(cloud, [], { from: '84.79.5.6', host: 'Anna' });
  assert.deepEqual(await nearby('84.79.5.6'), [{ code: second.code, name: 'Anna' }]);
  send(second.host, { ctl: 'end' });
  await cloud.settle();
  assert.deepEqual(await nearby('84.79.5.6'), []);
});

test('ending a room closes every socket and forgets it', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna] } = await room(cloud, ['Anna']);
  send(host, { ctl: 'end' });
  await cloud.settle();
  assert.equal(anna.closedWith, CLOSE.ended);
  assert.equal(host.closedWith, CLOSE.ended);
  assert.equal(cloud.objects.get(code).data.size, 0);
  const late = cloud.connect(`/rooms/${code}?game=ktan&name=Late`);
  await cloud.settle();
  assert.equal(late.closedWith, CLOSE.room);
});

test('a room deletes itself a day after its last activity, once nobody is in', async () => {
  const cloud = createCloud();
  const { code, host, members: [anna] } = await room(cloud, ['Anna']);
  host.close();
  anna.close();
  await cloud.settle();
  await cloud.advance(20_000); // the host's grace runs out with nobody to take over
  const o = cloud.objects.get(code);
  assert.ok(o.alarm > cloud.clock + 23 * 3600_000, 'the alarm is set for a day on');
  await cloud.advance(24 * 3600_000);
  assert.equal(o.data.size, 0);
  const late = cloud.connect(`/rooms/${code}?game=ktan&name=Late`);
  await cloud.settle();
  assert.equal(late.closedWith, CLOSE.room);
});

test('a backup over 100 KB is refused', async () => {
  const cloud = createCloud();
  const { code, host } = await room(cloud);
  send(host, { ctl: 'backup', state: { ok: true } });
  send(host, { ctl: 'backup', state: 'x'.repeat(100 * 1024) });
  await cloud.settle();
  assert.deepEqual(cloud.objects.get(code).data.get('backup'), { ok: true });
});

test('a reported address counts only if it is public', () => {
  for (const ip of ['84.79.5.6', '203.0.113.9', '2a0c:5a80:1234:ab00::7', '2a09:bac3:3111:37d::59:61']) assert.equal(publicAddress(ip), ip);
  for (const ip of ['10.1.2.3', '192.168.1.20', '172.20.10.2', '100.64.0.1', '127.0.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '256.1.1.1', 'fe80::1', 'fd00::1', '::1', 'ff02::1', 'x.local', '', null]) {
    assert.equal(publicAddress(ip), null, String(ip));
  }
});

test('a request speaks for the network it is seen from, or behind a relay for the one it names', () => {
  const home = 'v4:84.79.5.6';
  assert.deepEqual(networksFor('84.79.5.6', false, []), [home]);
  assert.deepEqual(networksFor('84.79.5.6', false, ['84.79.5.6', '2a0c:5a80:1234:ab00::7']), [home, 'v6:2a0c:5a80:1234:ab00'], 'its other family too');
  assert.deepEqual(networksFor('192.0.2.5', false, ['84.79.5.6']), ['v4:192.0.2.5'], "a claim that isn't the address seen is ignored");
  assert.deepEqual(networksFor('2a09:bac3:3111:37d::59:61', true, []), [], 'a relay address never stands for a network');
  assert.deepEqual(networksFor('2a09:bac3:3111:37d::59:61', true, ['84.79.5.6', '10.0.0.2']), [home]);
});

test('behind iCloud Private Relay, rooms are found by the address STUN saw, and never by the relay\'s', async () => {
  const cloud = createCloud();
  const near = async (from, relay, at = []) =>
    (await cloud.device(from, { relay }).fetch(`https://rooms.test/nearby?game=ktan${at.map((a) => `&at=${a}`).join('')}`)).json();
  // Pol's iPhone, at home on 84.79.5.6, seen through a Barcelona relay address.
  const host = cloud.connect('/rooms/new?game=ktan&name=Pol&at=84.79.5.6', { from: '2a09:bac3:3111:37d::59:61', relay: true });
  await cloud.settle();
  const { code } = last(host, 'welcome');
  assert.deepEqual(await near('2a09:bac3:3111:37d::59:4b', true, ['84.79.5.6']), [{ code, name: 'Pol' }], 'a phone at home, through another relay address');
  assert.deepEqual(await near('84.79.5.6', false), [{ code, name: 'Pol' }], 'a laptop at home, without the relay');
  assert.deepEqual(await near('2a09:bac3:3111:37d::77', true), [], 'a stranger on the same relay sees nothing');
  assert.deepEqual(await near('192.0.2.5', false, ['84.79.5.6']), [], 'nor does someone elsewhere claiming the address');

  // A host behind a relay with no STUN answer isn't listed anywhere.
  const hidden = cloud.connect('/rooms/new?game=ktan&name=Anna', { from: '2a09:bac3:3111:37d::88', relay: true });
  await cloud.settle();
  assert.ok(last(hidden, 'welcome'));
  assert.deepEqual(await near('2a09:bac3:3111:37d::88', true), []);
  assert.deepEqual((await near('2a09:bac3:3111:37d::59:4b', true, ['84.79.5.6'])).map((r) => r.name), ['Pol']);
});
