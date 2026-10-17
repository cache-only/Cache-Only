import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRS, RES, S3, STARTER, axial, cornerAt, geometry, harbourCorners, islandShape, makeIsland, tileIndex } from '../src/games/ktan/board.js';
import {
  COST,
  DEV_KINDS,
  PIECES,
  TARGET,
  apply,
  autoAction,
  canAfford,
  eventsFor,
  legalSpots,
  longestRoad,
  newGame,
  points,
  rateOf,
  view,
  waitingOn,
} from '../src/games/ktan/rules.js';

const SEATS = [
  { name: 'Pol', color: '#efefef', mark: 'diamond' },
  { name: 'Jordi', color: '#5b8cff', mark: 'circle' },
  { name: 'Marta', color: '#ff6b5b', mark: 'triangle' },
  { name: 'Anna', color: '#b07cff', mark: 'square' },
  { name: 'Laia', color: '#3fc9d6', mark: 'plus' },
  { name: 'Nil', color: '#ff8fd0', mark: 'star' },
];
const seats = (n) => SEATS.slice(0, n);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Applies an action that must be legal: { state, events }. */
function act(s, p, action) {
  const r = apply(s, p, action);
  assert.ok(!r.error, `${JSON.stringify(action)} by ${p} was refused: ${r.error}`);
  return r;
}
const run = (s, p, action) => act(s, p, action).state;
const refuse = (s, p, action, reason) => assert.equal(apply(s, p, action).error, reason, JSON.stringify(action));

/** A game past setup with nothing built: player 0's turn 1, rolled, in the main phase (starter island). */
function blank(n = 4, options = {}) {
  const s = newGame(7, seats(n), options);
  s.setup = null;
  s.phase = 'main';
  s.turn = 1;
  s.rolled = true;
  return s;
}

/** The same game before the roll. */
function unrolled(n = 4) {
  const s = blank(n);
  s.phase = 'roll';
  s.rolled = false;
  return s;
}

const geo = (s) => geometry(s.island.tiles);
const tileAt = (s, q, r) => tileIndex(geo(s), q, r);
const corner = (s, q, r, i) => geo(s).tiles[tileAt(s, q, r)].corners[i];
const edge = (s, q, r, e) => geo(s).tiles[tileAt(s, q, r)].edges[e];
const settle = (s, p, at, kind = 'settlement') => (s.buildings[at] = { p, kind });
const lay = (s, p, edges) => edges.forEach((e) => (s.roads[e] = p));

/** Moves cards from the bank to a hand, so the card totals stay right. */
function deal(s, p, cards) {
  for (const [r, n] of Object.entries(cards)) {
    s.bank[r] -= n;
    s.players[p].hand[r] += n;
  }
}
const handTotal = (h) => RES.reduce((n, r) => n + h[r], 0);
const holdsAll = (hand, cards) => Object.entries(cards).every(([r, n]) => hand[r] >= n);

/** The state with its random stream set so the next roll comes up `sum`. */
function rigged(s, sum) {
  for (let k = 1; k < 100000; k++) {
    const t = { ...s, rng: k };
    const r = apply(t, t.current, { type: 'roll' });
    if (r.state.dice[0] + r.state.dice[1] === sum) return t;
  }
  throw new Error('no roll found');
}

/* ---------- Geometry ---------- */

function checkGeometry(g) {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  g.tiles.forEach((t, i) => {
    const [x, y] = axial(t.q, t.r);
    assert.equal(t.x, x);
    assert.equal(t.y, y);
    assert.equal(new Set(t.corners).size, 6);
    assert.equal(new Set(t.edges).size, 6);
    t.corners.forEach((c, k) => {
      const [dx, dy] = cornerAt(k);
      assert.ok(near(g.corners[c].x, x + dx) && near(g.corners[c].y, y + dy), 'corner at its formula position');
      assert.ok(g.corners[c].tiles.includes(i));
    });
    t.edges.forEach((e, k) => {
      const ends = [t.corners[k], t.corners[(k + 1) % 6]].sort((a, b) => a - b);
      assert.deepEqual([g.edges[e].a, g.edges[e].b], ends, 'edge e runs from corner e to e + 1');
      const [dq, dr] = DIRS[k];
      const u = tileIndex(g, t.q + dq, t.r + dr);
      assert.equal(t.next[k], u);
      if (u >= 0) assert.equal(g.tiles[u].edges[(k + 3) % 6], t.edges[k], 'the neighbour shares the edge');
      else assert.ok(g.edges[e].coast);
    });
  });
  const key = (v) => Math.round(v * 1000);
  for (let i = 1; i < g.corners.length; i++) {
    const a = g.corners[i - 1];
    const b = g.corners[i];
    assert.ok(key(a.y) < key(b.y) || (key(a.y) === key(b.y) && key(a.x) < key(b.x)), 'corners sorted by y then x');
  }
  g.edges.forEach((e, i) => {
    assert.ok(e.a < e.b);
    if (i) assert.ok(g.edges[i - 1].a < e.a || (g.edges[i - 1].a === e.a && g.edges[i - 1].b < e.b), 'edges sorted');
    assert.ok(near(e.x, (g.corners[e.a].x + g.corners[e.b].x) / 2) && near(e.y, (g.corners[e.a].y + g.corners[e.b].y) / 2));
    assert.equal(e.coast, e.tiles.length === 1);
    assert.ok(g.corners[e.a].edges.includes(i) && g.corners[e.b].edges.includes(i));
    assert.ok(g.corners[e.a].corners.includes(e.b) && g.corners[e.b].corners.includes(e.a));
  });
  for (const c of g.corners) {
    assert.ok(c.tiles.length >= 1 && c.tiles.length <= 3);
    assert.ok(c.edges.length >= 2 && c.edges.length <= 3);
    assert.equal(c.corners.length, c.edges.length);
  }
  assert.deepEqual([...g.coast].sort((a, b) => a - b), g.edges.flatMap((e, i) => (e.coast ? [i] : [])));
  // Round the island: each coast edge shares a corner with the next one.
  g.coast.forEach((id, i) => {
    const a = g.edges[id];
    const b = g.edges[g.coast[(i + 1) % g.coast.length]];
    assert.ok([a.a, a.b].some((c) => c === b.a || c === b.b), 'coast order follows the coastline');
  });
  // Euler for a disc: corners - edges + tiles = 1; and every tile has 6 corners and 6 edges.
  assert.equal(g.corners.length - g.edges.length + g.tiles.length, 1);
  assert.equal(2 * g.edges.length - g.coast.length, 6 * g.tiles.length);
  assert.equal(g.corners.reduce((n, c) => n + c.tiles.length, 0), 6 * g.tiles.length);
}

test('geometry: the base island has 19 tiles, 54 corners, 72 edges and 30 coast edges', () => {
  const g = geometry(islandShape('base'));
  assert.equal(g.tiles.length, 19);
  assert.equal(g.corners.length, 54);
  assert.equal(g.edges.length, 72);
  assert.equal(g.coast.length, 30);
  checkGeometry(g);
  // Corner 0 of a tile is its top, and edge 1 its right side.
  const t = g.tiles[tileIndex(g, 0, 0)];
  assert.deepEqual([g.corners[t.corners[0]].x, g.corners[t.corners[0]].y].map((v) => Math.round(v * 1e6) / 1e6), [0, -1]);
  assert.ok(Math.abs(g.edges[t.edges[1]].x - S3 / 2) < 1e-9 && Math.abs(g.edges[t.edges[1]].y) < 1e-9);
});

test('geometry: the big island has 30 tiles in rows of 3 to 6, its corners and edges shared 6 a tile', () => {
  const shape = islandShape('big');
  assert.equal(shape.length, 30);
  const rows = {};
  for (const t of shape) (rows[t.r] ||= []).push(t);
  assert.deepEqual(Object.keys(rows).map(Number).sort((a, b) => a - b), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual([-3, -2, -1, 0, 1, 2, 3].map((r) => rows[r].length), [3, 4, 5, 6, 5, 4, 3]);
  // Every row centred on the same x.
  const mid = (r) => rows[r].reduce((n, t) => n + axial(t.q, t.r)[0], 0) / rows[r].length;
  for (const r of [-2, -1, 0, 1, 2, 3]) assert.ok(Math.abs(mid(r) - mid(-3)) < 1e-9);
  const g = geometry(shape);
  checkGeometry(g);
  assert.equal(g.corners.length, 80);
  assert.equal(g.edges.length, 109);
  assert.equal(g.coast.length, 38);
});

test('geometry is worked out once per shape and shared by every island of it', () => {
  const g = geometry(islandShape('base'));
  assert.equal(geometry(STARTER.tiles), g);
  assert.equal(geometry(makeIsland({ seed: 42 }).tiles), g);
  assert.notEqual(geometry(islandShape('big')), g);
});

/* ---------- Layouts ---------- */

const pipsOf = (n) => (n ? 6 - Math.abs(7 - n) : 0);

/** Checks an island against the rules for its size. */
function checkIsland(island, size) {
  const big = size === 'big';
  assert.equal(island.size, size);
  assert.deepEqual(island.tiles.map(({ q, r }) => ({ q, r })), islandShape(size));
  const g = geometry(island.tiles);
  const tally = (list) => list.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {});
  assert.deepEqual(
    tally(island.tiles.map((t) => t.res)),
    big ? { wood: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 } : { wood: 4, wool: 4, grain: 4, brick: 3, ore: 3, desert: 1 },
  );
  for (const t of island.tiles) assert.equal(t.num === 0, t.res === 'desert');
  const nums = tally(island.tiles.filter((t) => t.num).map((t) => t.num));
  assert.deepEqual(nums, big
    ? { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 }
    : { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 });
  // No 6 or 8 next to another 6 or 8.
  const red = (n) => n === 6 || n === 8;
  for (const e of g.edges) {
    if (e.tiles.length < 2) continue;
    const [a, b] = e.tiles.map((t) => island.tiles[t].num);
    assert.ok(!(red(a) && red(b)), `6/8 neighbours: ${a} and ${b}`);
  }
  // Harbours: the right types, on the coast, never two on one corner.
  assert.deepEqual(tally(island.harbours.map((h) => h.type)), big
    ? { any: 5, wool: 2, wood: 1, brick: 1, grain: 1, ore: 1 }
    : { any: 4, wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 });
  const used = new Set();
  for (const h of island.harbours) {
    const t = tileIndex(g, h.q, h.r);
    assert.ok(t >= 0 && h.e >= 0 && h.e < 6);
    assert.ok(g.edges[g.tiles[t].edges[h.e]].coast, 'a harbour sits on the coast');
    for (const c of harbourCorners(g, h)) {
      assert.ok(!used.has(c), 'two harbours on one corner');
      used.add(c);
    }
  }
}

test('the starter island is the fixed first-game layout', () => {
  const tiles = [
    [0, -2, 'ore', 10], [1, -2, 'wool', 2], [2, -2, 'wood', 9], [-1, -1, 'grain', 12], [0, -1, 'brick', 6], [1, -1, 'wool', 4],
    [2, -1, 'brick', 10], [-2, 0, 'grain', 9], [-1, 0, 'wood', 11], [0, 0, 'desert', 0], [1, 0, 'wood', 3], [2, 0, 'ore', 8],
    [-2, 1, 'wood', 8], [-1, 1, 'ore', 3], [0, 1, 'grain', 4], [1, 1, 'wool', 5], [-2, 2, 'brick', 5], [-1, 2, 'grain', 6],
    [0, 2, 'wool', 11],
  ];
  const harbours = [
    [-2, 0, 5, 'any'], [0, -2, 4, 'wool'], [1, -2, 0, 'any'], [2, -2, 1, 'ore'], [2, 0, 0, 'grain'], [1, 1, 2, 'any'],
    [0, 2, 3, 'brick'], [-2, 2, 2, 'wood'], [-2, 1, 4, 'any'],
  ];
  const want = {
    size: 'base',
    tiles: tiles.map(([q, r, res, num]) => ({ q, r, res, num })),
    harbours: harbours.map(([q, r, e, type]) => ({ q, r, e, type })),
  };
  assert.deepEqual(STARTER, want);
  assert.deepEqual(makeIsland({ starter: true }), want);
  assert.deepEqual(newGame(1, seats(3)).island, want);
  assert.deepEqual(newGame(1, seats(4)).island, want);
  checkIsland(STARTER, 'base');
  // A harbour serves corners e and e + 1 of its tile.
  const g = geometry(STARTER.tiles);
  const top = g.tiles[tileIndex(g, 0, -2)];
  assert.deepEqual(harbourCorners(g, { q: 0, r: -2, e: 4 }), [top.corners[4], top.corners[5]]);
  assert.deepEqual(harbourCorners(g, { q: 0, r: -2, e: 5 }), [top.corners[5], top.corners[0]]);
  assert.equal(tileIndex(g, 0, -2), 0);
  assert.equal(tileIndex(g, 3, 3), -1);
  // A copy, so a game can never change the starter.
  const copy = makeIsland({ starter: true });
  copy.tiles[0].num = 3;
  assert.equal(STARTER.tiles[0].num, 10);
});

test('generated islands keep the counts, the 6/8 rule and spread harbours, for many seeds', () => {
  for (const size of ['base', 'big']) {
    for (let seed = 1; seed <= 250; seed++) {
      const island = makeIsland({ size, seed });
      checkIsland(island, size);
      const g = geometry(island.tiles);
      // No three tiles of one terrain round a corner.
      for (const c of g.corners) {
        if (c.tiles.length === 3) assert.ok(new Set(c.tiles.map((t) => island.tiles[t].res)).size > 1, `clump at seed ${seed}`);
      }
      // Harbours spread round the coast: no stretch without one longer than twice the even step.
      const at = island.harbours.map((h) => g.coast.indexOf(g.tiles[tileIndex(g, h.q, h.r)].edges[h.e])).sort((a, b) => a - b);
      const gaps = at.map((k, i) => (i ? k - at[i - 1] : k + g.coast.length - at[at.length - 1]));
      assert.ok(Math.max(...gaps) <= (2 * g.coast.length) / island.harbours.length, `harbour gap at seed ${seed}`);
    }
  }
});

test('an island is the same for a seed and differs between seeds', () => {
  for (const size of ['base', 'big']) {
    assert.deepEqual(makeIsland({ size, seed: 9 }), makeIsland({ size, seed: 9 }));
    const layouts = new Set();
    for (let seed = 1; seed <= 20; seed++) layouts.add(JSON.stringify(makeIsland({ size, seed })));
    assert.equal(layouts.size, 20);
  }
  // A random game's island is makeIsland with the game's seed.
  assert.deepEqual(newGame(77, seats(4), { island: 'random' }).island, makeIsland({ size: 'base', seed: 77 }));
  assert.deepEqual(newGame(77, seats(5)).island, makeIsland({ size: 'big', seed: 77 }));
  assert.deepEqual(newGame(77, seats(6), { island: 'starter' }).island, makeIsland({ size: 'big', seed: 77 }));
});

/* ---------- A new game and setup ---------- */

test('a new game: snake setup order, the bank, the deck and the robber on the desert', () => {
  const s = newGame(3, seats(4));
  assert.equal(s.phase, 'setup');
  assert.equal(s.current, 0);
  assert.equal(s.turn, 0);
  assert.deepEqual(s.setup, { order: [0, 1, 2, 3, 3, 2, 1, 0], step: 0, need: 'settlement', last: null });
  assert.deepEqual(s.bank, { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 });
  assert.equal(s.deck.length, 25);
  const tally = (deck) => DEV_KINDS.map((k) => deck.filter((d) => d === k).length);
  assert.deepEqual(tally(s.deck), [14, 5, 2, 2, 2]);
  assert.equal(s.island.tiles[s.robber].res, 'desert');
  assert.equal(s.target, TARGET);
  assert.deepEqual(s.players[2], { ...SEATS[2], hand: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, dev: [], knights: 0, played: false });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'plain JSON');

  const big = newGame(3, seats(6));
  assert.equal(big.island.size, 'big');
  assert.equal(big.island.tiles.length, 30);
  assert.deepEqual(big.bank, { wood: 24, brick: 24, wool: 24, grain: 24, ore: 24 });
  assert.deepEqual(tally(big.deck), [20, 5, 3, 3, 3]);
  assert.deepEqual(big.setup.order, [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]);

  assert.equal(newGame(3, seats(2)).players.length, 2);
  assert.throws(() => newGame(3, seats(1)));
  assert.throws(() => newGame(3, [...SEATS, SEATS[0]]));
  assert.equal(newGame(3, seats(3), { target: 8 }).target, 8);
});

test('setup: snake order, a settlement then a road touching it, and the second settlement collects', () => {
  let s = newGame(11, seats(4));
  const order = [];
  while (s.phase === 'setup') {
    const p = s.current;
    const step = s.setup.step;
    order.push(p);
    const at = autoAction(s, p).at;
    refuse(s, p, { type: 'build', kind: 'road', at: 0 }, 'phase');
    refuse(s, (p + 1) % 4, { type: 'build', kind: 'settlement', at }, 'not-your-turn');
    refuse(s, p, { type: 'build', kind: 'city', at }, 'phase');
    const before = { ...s.players[p].hand };
    const r = act(s, p, { type: 'build', kind: 'settlement', at });
    s = r.state;
    const want = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    if (step >= 4) for (const t of geo(s).corners[at].tiles) if (RES.includes(s.island.tiles[t].res)) want[s.island.tiles[t].res] += 1;
    for (const res of RES) assert.equal(s.players[p].hand[res] - before[res], want[res], `step ${step}`);
    assert.equal(r.events.some((e) => e.t === 'gain'), step >= 4 && handTotal(want) > 0);
    assert.equal(s.setup.need, 'road');
    assert.equal(s.setup.last, at);
    refuse(s, p, { type: 'build', kind: 'settlement', at: legalSpots(s, p, 'settlement')[0] ?? 0 }, 'phase');
    const roads = legalSpots(s, p, 'road');
    assert.ok(roads.length >= 2);
    for (const e of roads) assert.ok(geo(s).edges[e].a === at || geo(s).edges[e].b === at);
    const far = geo(s).edges.findIndex((e) => e.a !== at && e.b !== at);
    refuse(s, p, { type: 'build', kind: 'road', at: far }, 'spot');
    s = run(s, p, { type: 'build', kind: 'road', at: roads[0] });
  }
  assert.deepEqual(order, [0, 1, 2, 3, 3, 2, 1, 0]);
  assert.equal(s.phase, 'roll');
  assert.equal(s.current, 0);
  assert.equal(s.turn, 1);
  assert.equal(s.setup, null);
  for (let p = 0; p < 4; p++) {
    assert.equal(Object.values(s.buildings).filter((b) => b.p === p).length, 2);
    assert.equal(Object.values(s.roads).filter((o) => o === p).length, 2);
  }
  assert.deepEqual(s.log.at(-1), { t: 'turn', p: 0, turn: 1 });
});

test('the distance rule: no settlement next to another building, in setup and after it', () => {
  let s = newGame(5, seats(3));
  const top = corner(s, 0, 0, 0);
  s = run(s, 0, { type: 'build', kind: 'settlement', at: top });
  s = run(s, 0, { type: 'build', kind: 'road', at: legalSpots(s, 0, 'road')[0] });
  const spots = legalSpots(s, 1, 'settlement');
  assert.ok(!spots.includes(top));
  for (const c of geo(s).corners[top].corners) {
    assert.ok(!spots.includes(c));
    refuse(s, 1, { type: 'build', kind: 'settlement', at: c }, 'spot');
  }
  refuse(s, 1, { type: 'build', kind: 'settlement', at: top }, 'spot');

  // After setup: a road out of a settlement, then the corners one and two along it.
  const b = blank(3);
  const t = geo(b).tiles[tileAt(b, 0, 0)];
  settle(b, 0, t.corners[0]);
  lay(b, 0, [t.edges[0], t.edges[1]]);
  deal(b, 0, { wood: 2, brick: 2, wool: 2, grain: 2 });
  refuse(b, 0, { type: 'build', kind: 'settlement', at: t.corners[1] }, 'spot');
  const r = act(b, 0, { type: 'build', kind: 'settlement', at: t.corners[2] });
  assert.deepEqual(r.events, [{ t: 'build', p: 0, kind: 'settlement', at: t.corners[2] }]);
  assert.deepEqual(r.state.buildings[t.corners[2]], { p: 0, kind: 'settlement' });
  // A settlement off your own roads is refused even when the corner is free.
  refuse(r.state, 0, { type: 'build', kind: 'settlement', at: t.corners[4] }, 'spot');
});

test('roads join your own road, settlement or city, never through another player\'s building', () => {
  const s = blank(3);
  const t = geo(s).tiles[tileAt(s, 0, 0)];
  const [a, b, c] = t.corners;
  settle(s, 0, a);
  lay(s, 0, [t.edges[0], t.edges[1]]); // a - b - c
  settle(s, 1, c);
  deal(s, 0, { wood: 5, brick: 5 });
  const spots = legalSpots(s, 0, 'road');
  // On from c is through player 1's settlement: no.
  const pastC = geo(s).corners[c].edges.filter((e) => e !== t.edges[1]);
  for (const e of pastC) {
    assert.ok(!spots.includes(e));
    refuse(s, 0, { type: 'build', kind: 'road', at: e }, 'spot');
  }
  // Out from b, and out of the settlement at a: yes.
  const fromB = geo(s).corners[b].edges.find((e) => !t.edges.includes(e));
  assert.ok(spots.includes(fromB));
  assert.ok(spots.includes(t.edges[5]));
  const done = run(s, 0, { type: 'build', kind: 'road', at: fromB });
  assert.equal(done.roads[fromB], 0);
  assert.deepEqual(done.players[0].hand, { wood: 4, brick: 4, wool: 0, grain: 0, ore: 0 });
  assert.equal(done.bank.wood, 15);
  // A road touching nothing of yours, or on a road already there.
  refuse(s, 0, { type: 'build', kind: 'road', at: edge(s, 2, -2, 0) }, 'spot');
  refuse(s, 0, { type: 'build', kind: 'road', at: t.edges[0] }, 'spot');
  // Player 1 may build out of its own settlement at c.
  s.current = 1;
  deal(s, 1, { wood: 1, brick: 1 });
  assert.ok(legalSpots(s, 1, 'road').includes(pastC[0]));
  run(s, 1, { type: 'build', kind: 'road', at: pastC[0] });
});

test('building: costs go to the bank, cities replace your own settlements, and pieces run out', () => {
  const s = blank(3);
  const t = geo(s).tiles[tileAt(s, 1, 0)];
  settle(s, 0, t.corners[0]);
  refuse(s, 0, { type: 'build', kind: 'city', at: t.corners[0] }, 'cost');
  deal(s, 0, { ore: 3, grain: 2 });
  refuse(s, 0, { type: 'build', kind: 'city', at: t.corners[3] }, 'spot');
  refuse(s, 1, { type: 'build', kind: 'city', at: t.corners[0] }, 'not-your-turn');
  const city = run(s, 0, { type: 'build', kind: 'city', at: t.corners[0] });
  assert.deepEqual(city.buildings[t.corners[0]], { p: 0, kind: 'city' });
  assert.equal(handTotal(city.players[0].hand), 0);
  assert.equal(city.bank.ore, 19);
  assert.equal(points(city, 0), 2);
  assert.deepEqual(view(city, 0).players[0].pieces, { road: 15, settlement: 5, city: 3 });
  // Four cities is the limit.
  const four = structuredClone(city);
  const far = [corner(four, -2, 0, 0), corner(four, 0, 2, 3), corner(four, 2, -2, 1)];
  for (const c of far) settle(four, 0, c, 'city');
  settle(four, 0, corner(four, -1, -1, 0));
  deal(four, 0, { ore: 3, grain: 2 });
  refuse(four, 0, { type: 'build', kind: 'city', at: corner(four, -1, -1, 0) }, 'pieces');
  // Fifteen roads, five settlements.
  const roads = structuredClone(s);
  lay(roads, 0, geo(roads).coast.slice(0, 15));
  deal(roads, 0, { wood: 1, brick: 1 });
  refuse(roads, 0, { type: 'build', kind: 'road', at: t.edges[0] }, 'pieces');
  assert.equal(view(roads, 0).players[0].pieces.road, 0);
  const five = structuredClone(s);
  for (const c of [corner(five, -2, 0, 0), corner(five, 0, 2, 3), corner(five, 2, -2, 1), corner(five, -1, -1, 0)]) settle(five, 0, c);
  lay(five, 0, [t.edges[0], t.edges[1]]);
  deal(five, 0, COST.settlement);
  refuse(five, 0, { type: 'build', kind: 'settlement', at: t.corners[2] }, 'pieces');
  assert.equal(PIECES.settlement, 5);
  // Not before the roll, malformed builds, and a place that isn't on the island.
  refuse(unrolled(3), 0, { type: 'build', kind: 'road', at: 0 }, 'phase');
  refuse(s, 0, { type: 'build', kind: 'castle', at: 0 }, 'action');
  refuse(s, 0, { type: 'build', kind: 'road', at: '3' }, 'action');
  const rich = structuredClone(s);
  deal(rich, 0, { wood: 1, brick: 1 });
  refuse(rich, 0, { type: 'build', kind: 'road', at: 9999 }, 'spot');
});

/* ---------- Rolling and producing ---------- */

test('a roll pays each settlement 1 and each city 2 from tiles with the number, except under the robber', () => {
  const s = unrolled(4);
  const wood3 = tileAt(s, 1, 0); // wood 3
  const ore3 = tileAt(s, -1, 1); // ore 3
  const g = geo(s);
  settle(s, 1, g.tiles[wood3].corners[0]);
  settle(s, 2, g.tiles[wood3].corners[3], 'city');
  settle(s, 3, g.tiles[ore3].corners[0]);
  s.robber = ore3;
  const r = act(rigged(s, 3), 0, { type: 'roll' });
  const after = r.state;
  assert.equal(after.phase, 'main');
  assert.equal(after.rolled, true);
  assert.equal(after.dice[0] + after.dice[1], 3);
  assert.equal(after.players[1].hand.wood, 1);
  assert.equal(after.players[2].hand.wood, 2);
  assert.equal(handTotal(after.players[3].hand), 0);
  assert.equal(after.bank.wood, 16);
  const produce = r.events.find((e) => e.t === 'produce');
  assert.deepEqual(produce.gains, [
    { p: 1, res: 'wood', n: 1, tile: wood3 },
    { p: 2, res: 'wood', n: 2, tile: wood3 },
  ]);
  assert.deepEqual(r.events[0], { t: 'roll', p: 0, dice: after.dice, sum: 3 });
  // Moving the robber away lets the ore tile pay.
  s.robber = tileAt(s, 0, 0);
  const free = act(rigged(s, 3), 0, { type: 'roll' }).state;
  assert.equal(free.players[3].hand.ore, 1);
  // Only the current player rolls, once.
  refuse(s, 1, { type: 'roll' }, 'not-your-turn');
  refuse(after, 0, { type: 'roll' }, 'phase');
});

test('a bank short of a resource pays nobody, unless only one player is owed it', () => {
  const s = unrolled(4);
  const wood3 = geo(s).tiles[tileAt(s, 1, 0)];
  const ore3 = geo(s).tiles[tileAt(s, -1, 1)];
  settle(s, 1, wood3.corners[0]);
  settle(s, 2, wood3.corners[3], 'city');
  settle(s, 3, ore3.corners[0], 'city');
  settle(s, 3, ore3.corners[3]);
  deal(s, 0, { wood: 17, ore: 17 }); // the bank keeps 2 of each
  const r = act(rigged(s, 3), 0, { type: 'roll' });
  // Wood: players 1 and 2 are owed 3 between them, so nobody gets any.
  assert.equal(r.state.players[1].hand.wood, 0);
  assert.equal(r.state.players[2].hand.wood, 0);
  assert.equal(r.state.bank.wood, 2);
  // Ore: only player 3 is owed (3), so it gets the 2 left.
  assert.equal(r.state.players[3].hand.ore, 2);
  assert.equal(r.state.bank.ore, 0);
  assert.deepEqual(r.events.filter((e) => e.t === 'shortage'), [{ t: 'shortage', res: 'wood' }, { t: 'shortage', res: 'ore' }]);
  const gains = r.events.find((e) => e.t === 'produce').gains;
  assert.ok(gains.every((g) => g.res === 'ore' && g.p === 3));
  assert.equal(gains.reduce((n, g) => n + g.n, 0), 2);
});

/* ---------- Sevens and the robber ---------- */

test('a seven: everyone over 7 cards gives back half at once, then the robber moves and steals', () => {
  const s = unrolled(4);
  deal(s, 0, { wood: 5, ore: 4 }); // 9: gives 4
  deal(s, 1, { grain: 7 }); // 7: keeps them
  deal(s, 2, { brick: 8 }); // 8: gives 4
  deal(s, 3, { wool: 1 });
  const seven = run(rigged(s, 7), 0, { type: 'roll' });
  assert.equal(seven.phase, 'discard');
  assert.deepEqual(seven.discard, { 0: 4, 2: 4 });
  assert.deepEqual(waitingOn(seven), [0, 2]);
  refuse(seven, 1, { type: 'discard', cards: { grain: 3 } }, 'not-your-turn');
  refuse(seven, 0, { type: 'discard', cards: { wood: 3 } }, 'hand');
  refuse(seven, 0, { type: 'discard', cards: { wood: 5 } }, 'hand');
  refuse(seven, 0, { type: 'discard', cards: { brick: 4 } }, 'hand');
  refuse(seven, 0, { type: 'discard', cards: { gold: 4 } }, 'action');
  refuse(seven, 0, { type: 'robber', tile: 1 }, 'phase');
  // In any order: player 2 first.
  const r2 = act(seven, 2, { type: 'discard', cards: { brick: 4 } });
  assert.equal(r2.state.phase, 'discard');
  assert.deepEqual(waitingOn(r2.state), [0]);
  assert.deepEqual(r2.events, [{ t: 'discard', p: 2, n: 4, cards: { brick: 4 } }]);
  assert.deepEqual(eventsFor(r2.events, 1), [{ t: 'discard', p: 2, n: 4 }]);
  refuse(r2.state, 2, { type: 'discard', cards: { brick: 4 } }, 'not-your-turn');
  const robber = run(r2.state, 0, { type: 'discard', cards: { wood: 2, ore: 2 } });
  assert.equal(robber.phase, 'robber');
  assert.equal(robber.discard, null);
  assert.deepEqual(robber.players[0].hand, { wood: 3, brick: 0, wool: 0, grain: 0, ore: 2 });
  assert.equal(robber.bank.brick, 19 - 4);

  // The robber must move, and steals from players with a building on its tile and a card.
  const g = geo(robber);
  const tile = tileAt(robber, 1, -1);
  refuse(robber, 0, { type: 'robber', tile: robber.robber }, 'tile');
  refuse(robber, 0, { type: 'robber', tile: 99 }, 'tile');
  refuse(robber, 1, { type: 'robber', tile }, 'not-your-turn');
  settle(robber, 1, g.tiles[tile].corners[0]);
  settle(robber, 2, g.tiles[tile].corners[2]);
  settle(robber, 3, g.tiles[tile].corners[4]);
  robber.players[3].hand.wool = 0;
  robber.bank.wool += 1;
  const steal = run(robber, 0, { type: 'robber', tile });
  assert.equal(steal.phase, 'steal');
  assert.deepEqual(steal.steal, [1, 2]);
  assert.equal(steal.robber, tile);
  assert.deepEqual(waitingOn(steal), [0]);
  refuse(steal, 0, { type: 'steal', victim: 3 }, 'victim');
  refuse(steal, 0, { type: 'steal', victim: 0 }, 'victim');
  const r = act(steal, 0, { type: 'steal', victim: 2 });
  assert.deepEqual(r.events, [{ t: 'steal', from: 2, to: 0, res: 'brick' }]);
  assert.equal(r.state.players[2].hand.brick, 3);
  assert.equal(r.state.players[0].hand.brick, 1);
  assert.equal(r.state.phase, 'main');
  assert.equal(r.state.steal, null);
  // Only thief and victim see what it was.
  assert.deepEqual(eventsFor(r.events, 1), [{ t: 'steal', from: 2, to: 0 }]);
  assert.deepEqual(eventsFor(r.events, null), [{ t: 'steal', from: 2, to: 0 }]);
  assert.deepEqual(eventsFor(r.events, 2), r.events);
  assert.deepEqual(eventsFor(r.events, 0), r.events);
});

test('a seven with nobody over 7 goes straight to the robber, which steals by itself from a lone victim', () => {
  const s = unrolled(3);
  deal(s, 1, { ore: 1, wool: 1 });
  deal(s, 2, { grain: 7 });
  const robber = run(rigged(s, 7), 0, { type: 'roll' });
  assert.equal(robber.phase, 'robber');
  assert.equal(robber.discard, null);
  const tile = tileAt(robber, 2, 0);
  settle(robber, 1, corner(robber, 2, 0, 0));
  settle(robber, 0, corner(robber, 2, 0, 3)); // your own building is never a victim
  const r = act(robber, 0, { type: 'robber', tile });
  assert.equal(r.state.phase, 'main');
  const steal = r.events.find((e) => e.t === 'steal');
  assert.equal(steal.from, 1);
  assert.equal(steal.to, 0);
  assert.equal(handTotal(r.state.players[1].hand), 1);
  assert.equal(r.state.players[0].hand[steal.res], 1);
  // Nobody with a card beside it: no steal at all.
  const empty = structuredClone(robber);
  empty.bank.ore += 1;
  empty.bank.wool += 1;
  empty.players[1].hand = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  const none = act(empty, 0, { type: 'robber', tile });
  assert.deepEqual(none.events, [{ t: 'robber', p: 0, tile }]);
  assert.equal(none.state.phase, 'main');
});

test('a steal takes one card at random, weighted by the cards held', () => {
  const s = blank(3);
  s.phase = 'steal';
  s.steal = [1, 2];
  s.after = 'main';
  deal(s, 1, { wood: 9, ore: 1 });
  const seen = { wood: 0, ore: 0 };
  for (let k = 1; k <= 400; k++) {
    const r = act({ ...s, rng: k }, 0, { type: 'steal', victim: 1 });
    seen[r.events[0].res] += 1;
    assert.equal(handTotal(r.state.players[1].hand), 9);
  }
  assert.ok(seen.wood > 300 && seen.ore > 10, JSON.stringify(seen));
});

/* ---------- Development cards ---------- */

test('development cards: bought with ore, wool and grain, never played the turn bought, one a turn', () => {
  const s = blank(3);
  deal(s, 0, { ore: 2, wool: 2, grain: 2 });
  s.deck.push('knight');
  const r = act(s, 0, { type: 'buy' });
  assert.deepEqual(r.events, [{ t: 'buy', p: 0, kind: 'knight' }]);
  assert.deepEqual(eventsFor(r.events, 1), [{ t: 'buy', p: 0 }]);
  assert.deepEqual(eventsFor(r.events, null), [{ t: 'buy', p: 0 }]);
  const bought = r.state;
  assert.deepEqual(bought.players[0].dev, [{ kind: 'knight', turn: 1 }]);
  assert.equal(bought.deck.length, 25);
  assert.deepEqual(view(bought, 0).players[0].dev, [{ kind: 'knight', fresh: true }]);
  refuse(bought, 0, { type: 'play', card: 'knight' }, 'card');
  refuse(bought, 1, { type: 'buy' }, 'not-your-turn');
  const broke = structuredClone(bought);
  broke.players[0].hand.ore = 0;
  refuse(broke, 0, { type: 'buy' }, 'cost');
  const empty = structuredClone(bought);
  empty.deck = [];
  refuse(empty, 0, { type: 'buy' }, 'deck');
  refuse(unrolled(3), 0, { type: 'buy' }, 'phase');

  // From an earlier turn: playable, but one card a turn, and victory points never.
  const later = blank(3);
  later.turn = 4;
  later.players[0].dev = [{ kind: 'knight', turn: 4 }, { kind: 'knight', turn: 2 }, { kind: 'vp', turn: 1 }, { kind: 'harvest', turn: 1 }];
  refuse(later, 0, { type: 'play', card: 'vp' }, 'card');
  refuse(later, 0, { type: 'play', card: 'tribute', res: 'ore' }, 'card');
  refuse(later, 1, { type: 'play', card: 'knight' }, 'not-your-turn');
  const k = act(later, 0, { type: 'play', card: 'knight' });
  assert.deepEqual(k.state.players[0].dev, [{ kind: 'knight', turn: 4 }, { kind: 'vp', turn: 1 }, { kind: 'harvest', turn: 1 }]);
  assert.equal(k.state.players[0].played, true);
  assert.equal(k.state.phase, 'robber');
  const back = run(k.state, 0, { type: 'robber', tile: 5 });
  assert.equal(back.phase, 'main');
  refuse(back, 0, { type: 'play', card: 'harvest', res: ['ore', 'ore'] }, 'card');
  // The next turn of that player it is playable again.
  const next = structuredClone(back);
  next.turn = 7;
  next.players[0].played = false;
  run(next, 0, { type: 'play', card: 'harvest', res: ['ore', 'ore'] });
});

test('a knight may be played before the roll: robber first, then back to rolling', () => {
  const s = unrolled(3);
  s.players[0].dev = [{ kind: 'knight', turn: 0 }];
  settle(s, 1, corner(s, 2, 0, 0));
  deal(s, 1, { wool: 1 });
  const k = run(s, 0, { type: 'play', card: 'knight' });
  assert.equal(k.phase, 'robber');
  assert.equal(k.after, 'roll');
  assert.equal(k.players[0].knights, 1);
  refuse(k, 0, { type: 'roll' }, 'phase');
  const r = act(k, 0, { type: 'robber', tile: tileAt(k, 2, 0) });
  assert.deepEqual(r.events.map((e) => e.t), ['robber', 'steal']);
  assert.equal(r.state.phase, 'roll');
  assert.equal(r.state.rolled, false);
  assert.equal(r.state.players[0].hand.wool, 1);
  const rolled = run(r.state, 0, { type: 'roll' });
  assert.equal(rolled.rolled, true);
});

test('largest army: 3 knights takes it, and only more knights than the holder takes it over', () => {
  const s = blank(3);
  s.players[0].knights = 2;
  s.players[0].dev = [{ kind: 'knight', turn: 0 }];
  const r = act(s, 0, { type: 'play', card: 'knight' });
  assert.deepEqual(r.events.filter((e) => e.t === 'award'), [{ t: 'award', kind: 'army', from: null, to: 0 }]);
  assert.equal(r.state.awards.army, 0);
  assert.equal(points(r.state, 0), 2);
  const p1 = run(r.state, 0, { type: 'robber', tile: 3 });
  p1.current = 1;
  p1.turn = 2;
  p1.players[1].knights = 2;
  p1.players[1].dev = [{ kind: 'knight', turn: 1 }, { kind: 'knight', turn: 1 }];
  const tie = act(p1, 1, { type: 'play', card: 'knight' });
  assert.equal(tie.state.awards.army, 0, 'a tie keeps it');
  assert.ok(!tie.events.some((e) => e.t === 'award'));
  const more = run(tie.state, 1, { type: 'robber', tile: 4 });
  more.turn = 3;
  more.players[1].played = false;
  const over = act(more, 1, { type: 'play', card: 'knight' });
  assert.deepEqual(over.events.filter((e) => e.t === 'award'), [{ t: 'award', kind: 'army', from: 0, to: 1 }]);
  assert.equal(points(over.state, 0), 0);
  assert.equal(points(over.state, 1), 2);
});

test('road building: two free roads, then back to where the turn was', () => {
  const s = blank(3);
  const t = geo(s).tiles[tileAt(s, 0, 0)];
  settle(s, 0, t.corners[0]);
  s.players[0].dev = [{ kind: 'roads', turn: 0 }];
  const r = act(s, 0, { type: 'play', card: 'roads' });
  assert.equal(r.state.phase, 'roads');
  assert.equal(r.state.free, 2);
  refuse(r.state, 0, { type: 'build', kind: 'settlement', at: t.corners[2] }, 'phase');
  refuse(r.state, 0, { type: 'end' }, 'phase');
  refuse(r.state, 0, { type: 'build', kind: 'road', at: t.edges[2] }, 'spot');
  const one = run(r.state, 0, { type: 'build', kind: 'road', at: t.edges[0] });
  assert.equal(one.phase, 'roads');
  assert.equal(one.free, 1);
  const two = run(one, 0, { type: 'build', kind: 'road', at: t.edges[1] });
  assert.equal(two.phase, 'main');
  assert.equal(two.free, 0);
  assert.deepEqual(two.players[0].hand, { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }, 'free');
  assert.deepEqual(two.bank, s.bank);
  // With one road piece left, one free road.
  const last = structuredClone(s);
  lay(last, 0, geo(last).coast.slice(0, 14));
  const single = run(last, 0, { type: 'play', card: 'roads' });
  assert.equal(single.free, 1);
  const done = run(single, 0, { type: 'build', kind: 'road', at: t.edges[0] });
  assert.equal(done.phase, 'main');
  // No road left to place, or nowhere to place one: the card stays in hand.
  const none = structuredClone(last);
  lay(none, 0, [geo(none).coast[20]]);
  refuse(none, 0, { type: 'play', card: 'roads' }, 'pieces');
  const nowhere = blank(3);
  nowhere.players[0].dev = [{ kind: 'roads', turn: 0 }];
  refuse(nowhere, 0, { type: 'play', card: 'roads' }, 'spot');
});

test('harvest takes any two from the bank, and tribute takes all of one resource from everyone', () => {
  const s = blank(4);
  s.players[0].dev = [{ kind: 'harvest', turn: 0 }, { kind: 'tribute', turn: 0 }];
  const h = act(s, 0, { type: 'play', card: 'harvest', res: ['ore', 'grain'] });
  assert.deepEqual(h.events, [
    { t: 'play', p: 0, card: 'harvest', res: ['ore', 'grain'] },
    { t: 'harvest', p: 0, res: ['ore', 'grain'] },
  ]);
  assert.equal(h.state.players[0].hand.ore, 1);
  assert.equal(h.state.players[0].hand.grain, 1);
  assert.equal(h.state.bank.ore, 18);
  const twice = run(s, 0, { type: 'play', card: 'harvest', res: ['brick', 'brick'] });
  assert.equal(twice.players[0].hand.brick, 2);
  refuse(s, 0, { type: 'play', card: 'harvest', res: ['brick'] }, 'action');
  refuse(s, 0, { type: 'play', card: 'harvest', res: ['brick', 'gold'] }, 'action');
  const thin = structuredClone(s);
  deal(thin, 2, { ore: 18 });
  refuse(thin, 0, { type: 'play', card: 'harvest', res: ['ore', 'ore'] }, 'bank');
  run(thin, 0, { type: 'play', card: 'harvest', res: ['ore', 'wool'] });

  const t = structuredClone(s);
  deal(t, 1, { wool: 3, ore: 1 });
  deal(t, 3, { wool: 2 });
  deal(t, 0, { wool: 1 });
  const r = act(t, 0, { type: 'play', card: 'tribute', res: 'wool' });
  assert.deepEqual(r.events, [
    { t: 'play', p: 0, card: 'tribute', res: 'wool' },
    { t: 'tribute', p: 0, res: 'wool', from: [{ p: 1, n: 3 }, { p: 3, n: 2 }] },
  ]);
  assert.equal(r.state.players[0].hand.wool, 6);
  assert.equal(r.state.players[1].hand.wool, 0);
  assert.equal(r.state.players[1].hand.ore, 1);
  assert.equal(r.state.players[3].hand.wool, 0);
  refuse(t, 0, { type: 'play', card: 'tribute', res: 'gold' }, 'action');
});

/* ---------- Longest road ---------- */

test('longest road: a chain, a loop, a branch, and a trail ended by another player\'s building', () => {
  const s = blank(3);
  const g = geo(s);
  lay(s, 0, g.coast.slice(0, 4));
  assert.equal(longestRoad(s, 0), 4);
  assert.equal(longestRoad(s, 1), 0);
  // A loop round a tile is 6, and a road off it makes 7.
  const loop = blank(3);
  const t = g.tiles[tileAt(loop, 0, 0)];
  lay(loop, 1, t.edges);
  assert.equal(longestRoad(loop, 1), 6);
  const spur = g.corners[t.corners[0]].edges.find((e) => !t.edges.includes(e));
  lay(loop, 1, [spur]);
  assert.equal(longestRoad(loop, 1), 7);
  // Another player's building on the loop: the trail can't pass it, so the spur can't join the
  // loop, but the loop still runs from that corner round to it again.
  settle(loop, 2, t.corners[3]);
  assert.equal(longestRoad(loop, 1), 6);
  delete loop.roads[spur];
  assert.equal(longestRoad(loop, 1), 6);
  lay(loop, 1, [spur]);
  settle(loop, 2, t.corners[0]);
  assert.equal(longestRoad(loop, 1), 3);
  // A branch: arms of 3, 2 and 1 from one corner make 5.
  const branch = blank(3);
  lay(branch, 0, [t.edges[0], t.edges[1], t.edges[2], t.edges[5], t.edges[4], spur]);
  assert.equal(longestRoad(branch, 0), 5);
  // Broken in the middle by someone else's settlement.
  const chain = blank(3);
  lay(chain, 0, g.coast.slice(0, 7));
  assert.equal(longestRoad(chain, 0), 7);
  const shared = (e1, e2) => [g.edges[e1].a, g.edges[e1].b].find((c) => c === g.edges[e2].a || c === g.edges[e2].b);
  settle(chain, 1, shared(g.coast[3], g.coast[4]));
  assert.equal(longestRoad(chain, 0), 4);
  // Your own settlement never breaks it.
  const own = blank(3);
  lay(own, 0, g.coast.slice(0, 7));
  settle(own, 0, shared(g.coast[3], g.coast[4]));
  assert.equal(longestRoad(own, 0), 7);
});

test('longest road award: 5 or more takes it, the holder keeps a tie, a break with a tie sets it aside', () => {
  const s = blank(3);
  const g = geo(s);
  const shared = (e1, e2) => [g.edges[e1].a, g.edges[e1].b].find((c) => c === g.edges[e2].a || c === g.edges[e2].b);
  // Player 0 builds its fifth road and takes it.
  lay(s, 0, g.coast.slice(0, 4));
  deal(s, 0, { wood: 1, brick: 1 });
  const five = act(s, 0, { type: 'build', kind: 'road', at: g.coast[4] });
  assert.deepEqual(five.events.filter((e) => e.t === 'award'), [{ t: 'award', kind: 'road', from: null, to: 0 }]);
  assert.equal(points(five.state, 0), 2);
  // Player 1 draws level at 5: player 0 keeps it. At 6 player 1 takes it over.
  const p1 = structuredClone(five.state);
  p1.current = 1;
  lay(p1, 1, g.coast.slice(10, 14));
  deal(p1, 1, { wood: 2, brick: 2 });
  const tie = act(p1, 1, { type: 'build', kind: 'road', at: g.coast[14] });
  assert.equal(tie.state.awards.road, 0);
  assert.ok(!tie.events.some((e) => e.t === 'award'));
  const six = act(tie.state, 1, { type: 'build', kind: 'road', at: g.coast[15] });
  assert.deepEqual(six.events.filter((e) => e.t === 'award'), [{ t: 'award', kind: 'road', from: 0, to: 1 }]);

  // Player 0 holds it with 7; players 1 and 2 have 5 each. Player 1 breaks player 0's road into 4
  // and 3: players 1 and 2 tie, so nobody has it.
  const brk = blank(3);
  lay(brk, 0, g.coast.slice(0, 7));
  lay(brk, 1, g.coast.slice(10, 15));
  lay(brk, 2, g.coast.slice(18, 23));
  brk.awards.road = 0;
  const at = shared(g.coast[3], g.coast[4]);
  const inland = g.corners[at].edges.find((e) => !g.edges[e].coast);
  lay(brk, 1, [inland]);
  brk.current = 1;
  deal(brk, 1, COST.settlement);
  const broken = act(brk, 1, { type: 'build', kind: 'settlement', at });
  assert.deepEqual(broken.events.filter((e) => e.t === 'award'), [{ t: 'award', kind: 'road', from: 0, to: null }]);
  assert.equal(broken.state.awards.road, null);
  assert.equal(longestRoad(broken.state, 0), 4);
  // If only player 1 had the longest after the break, it would have taken it.
  const solo = structuredClone(brk);
  for (const e of g.coast.slice(18, 23)) delete solo.roads[e];
  const taken = act(solo, 1, { type: 'build', kind: 'settlement', at });
  assert.deepEqual(taken.events.filter((e) => e.t === 'award'), [{ t: 'award', kind: 'road', from: 0, to: 1 }]);
  // And a holder broken but still level with the longest keeps it.
  const keep = structuredClone(solo);
  lay(keep, 0, g.coast.slice(24, 29)); // a second road of 5, apart from the first
  const kept = act(keep, 1, { type: 'build', kind: 'settlement', at });
  assert.equal(longestRoad(kept.state, 0), 5);
  assert.equal(longestRoad(kept.state, 1), 5);
  assert.equal(kept.state.awards.road, 0);
  assert.ok(!kept.events.some((e) => e.t === 'award'));
});

/* ---------- Harbours and the bank ---------- */

test('harbour rates: 3 at an any harbour, 2 at a resource\'s own, for settlements and cities', () => {
  const s = blank(4);
  const g = geo(s);
  const harbour = (type) => s.island.harbours.find((h) => h.type === type);
  const [w0] = harbourCorners(g, harbour('wool'));
  const [a0] = harbourCorners(g, harbour('any'));
  assert.equal(rateOf(s, 0, 'wool'), 4);
  settle(s, 0, w0);
  assert.equal(rateOf(s, 0, 'wool'), 2);
  assert.equal(rateOf(s, 0, 'ore'), 4);
  settle(s, 1, a0, 'city');
  for (const r of RES) assert.equal(rateOf(s, 1, r), 3);
  const both = harbourCorners(g, harbour('ore'))[1];
  settle(s, 0, both);
  assert.equal(rateOf(s, 0, 'ore'), 2);
  assert.equal(rateOf(s, 0, 'wool'), 2);
  assert.equal(rateOf(s, 0, 'grain'), 4);
  assert.equal(rateOf(view(s, 2), 0, 'wool'), 2, 'works on a view');
});

test('bank trades: in steps of your rate, mixed rates, and the refusals', () => {
  const s = blank(3);
  const g = geo(s);
  settle(s, 0, harbourCorners(g, s.island.harbours.find((h) => h.type === 'wool'))[0]);
  deal(s, 0, { wool: 5, ore: 8, grain: 1 });
  const r = act(s, 0, { type: 'bank', give: { wool: 2 }, want: { brick: 1 } });
  assert.deepEqual(r.events, [{ t: 'bank', p: 0, give: { wool: 2 }, want: { brick: 1 } }]);
  assert.equal(r.state.players[0].hand.wool, 3);
  assert.equal(r.state.players[0].hand.brick, 1);
  assert.equal(r.state.bank.wool, 16);
  assert.equal(r.state.bank.brick, 18);
  run(s, 0, { type: 'bank', give: { ore: 4 }, want: { wood: 1 } });
  const mixed = run(s, 0, { type: 'bank', give: { wool: 4, ore: 4 }, want: { wood: 2, brick: 1 } });
  assert.deepEqual(mixed.players[0].hand, { wood: 2, brick: 1, wool: 1, grain: 1, ore: 4 });
  run(s, 0, { type: 'bank', give: { ore: 8 }, want: { grain: 2 } });
  refuse(s, 0, { type: 'bank', give: { wool: 3 }, want: { brick: 1 } }, 'rate');
  refuse(s, 0, { type: 'bank', give: { ore: 3 }, want: { brick: 1 } }, 'rate');
  refuse(s, 0, { type: 'bank', give: { wool: 2 }, want: { brick: 2 } }, 'rate');
  refuse(s, 0, { type: 'bank', give: { wool: 4 }, want: { brick: 1 } }, 'rate');
  refuse(s, 0, { type: 'bank', give: { wool: 2 }, want: { wool: 1 } }, 'trade');
  refuse(s, 0, { type: 'bank', give: { wool: 2, ore: 4 }, want: { ore: 1, wood: 1 } }, 'trade');
  refuse(s, 0, { type: 'bank', give: {}, want: { brick: 1 } }, 'trade');
  refuse(s, 0, { type: 'bank', give: { wool: 2 }, want: {} }, 'trade');
  refuse(s, 0, { type: 'bank', give: { wool: -2 }, want: { brick: 1 } }, 'action');
  refuse(s, 0, { type: 'bank', give: { wool: 1.5 }, want: { brick: 1 } }, 'action');
  refuse(s, 0, { type: 'bank', give: 'wool', want: { brick: 1 } }, 'action');
  refuse(s, 0, { type: 'bank', give: { wool: 6 }, want: { brick: 3 } }, 'hand');
  refuse(s, 0, { type: 'bank', give: { grain: 4 }, want: { brick: 1 } }, 'hand');
  refuse(s, 1, { type: 'bank', give: { wool: 2 }, want: { brick: 1 } }, 'not-your-turn');
  const before = structuredClone(s);
  before.phase = 'roll';
  before.rolled = false;
  refuse(before, 0, { type: 'bank', give: { wool: 2 }, want: { brick: 1 } }, 'phase');
  // Running out: the bank pays only what it has.
  const dry = structuredClone(s);
  deal(dry, 2, { brick: 19 });
  refuse(dry, 0, { type: 'bank', give: { wool: 2 }, want: { brick: 1 } }, 'bank');
});

/* ---------- Player trades ---------- */

test('an offer to everyone: answers come in, the proposer picks a yes, and the offer closes', () => {
  const s = blank(4);
  deal(s, 0, { wood: 2 });
  deal(s, 1, { ore: 1 });
  deal(s, 3, { ore: 2 });
  refuse(s, 1, { type: 'offer', give: { ore: 1 }, want: { wood: 1 }, to: 'all' }, 'not-your-turn');
  refuse(unrolled(4), 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 }, to: 'all' }, 'phase');
  const o = act(s, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 }, to: 'all' });
  const offer = { id: 1, from: 0, to: 'all', give: { wood: 1 }, want: { ore: 1 }, answers: {} };
  assert.deepEqual(o.events, [{ t: 'offer', offer }]);
  assert.deepEqual(o.state.offers, [offer]);
  assert.deepEqual(view(o.state, 2).offers, [offer], 'everyone sees it');
  let t = o.state;
  refuse(t, 2, { type: 'answer', id: 1, yes: true }, 'hand');
  refuse(t, 0, { type: 'answer', id: 1, yes: true }, 'offer');
  refuse(t, 1, { type: 'answer', id: 9, yes: true }, 'offer');
  const yes = act(t, 1, { type: 'answer', id: 1, yes: true });
  assert.deepEqual(yes.events, [{ t: 'answer', id: 1, p: 1, yes: true }]);
  t = run(yes.state, 2, { type: 'answer', id: 1, yes: false });
  t = run(t, 3, { type: 'answer', id: 1, yes: true });
  assert.deepEqual(t.offers[0].answers, { 1: 'yes', 2: 'no', 3: 'yes' });
  assert.deepEqual(waitingOn(t), [0], 'answers never hold the game up');
  refuse(t, 0, { type: 'trade', id: 1, with: 2 }, 'offer');
  refuse(t, 1, { type: 'trade', id: 1, with: 3 }, 'offer');
  const done = act(t, 0, { type: 'trade', id: 1, with: 3 });
  assert.deepEqual(done.events, [{ t: 'trade', a: 0, b: 3, give: { wood: 1 }, want: { ore: 1 } }]);
  assert.deepEqual(done.state.offers, []);
  assert.equal(done.state.players[0].hand.wood, 1);
  assert.equal(done.state.players[0].hand.ore, 1);
  assert.equal(done.state.players[3].hand.wood, 1);
  assert.equal(done.state.players[3].hand.ore, 1);
  refuse(done.state, 0, { type: 'trade', id: 1, with: 1 }, 'offer');
});

test('an offer to one player trades the moment it is accepted; a no is recorded', () => {
  const s = blank(4);
  deal(s, 0, { grain: 2 });
  deal(s, 2, { brick: 1 });
  refuse(s, 0, { type: 'offer', give: { grain: 2 }, want: { brick: 1 }, to: 0 }, 'action');
  refuse(s, 0, { type: 'offer', give: { grain: 2 }, want: { brick: 1 }, to: 7 }, 'action');
  const o = run(s, 0, { type: 'offer', give: { grain: 2 }, want: { brick: 1 }, to: 2 });
  refuse(o, 1, { type: 'answer', id: 1, yes: true }, 'offer');
  const no = run(o, 2, { type: 'answer', id: 1, yes: false });
  assert.deepEqual(no.offers[0].answers, { 2: 'no' });
  const r = act(o, 2, { type: 'answer', id: 1, yes: true });
  assert.deepEqual(r.events, [
    { t: 'answer', id: 1, p: 2, yes: true },
    { t: 'trade', a: 0, b: 2, give: { grain: 2 }, want: { brick: 1 } },
  ]);
  assert.deepEqual(r.state.offers, []);
  assert.equal(r.state.players[2].hand.grain, 2);
  assert.equal(r.state.players[0].hand.brick, 1);
});

test('a counter: a no on the offer and a new offer back to the proposer, who can take it at once', () => {
  const s = blank(4);
  deal(s, 0, { wood: 3 });
  deal(s, 3, { grain: 1 });
  let t = run(s, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 }, to: 'all' });
  refuse(t, 0, { type: 'counter', id: 1, give: { wood: 1 }, want: { ore: 1 } }, 'offer');
  refuse(t, 3, { type: 'counter', id: 1, give: { ore: 1 }, want: { wood: 2 } }, 'hand');
  const c = act(t, 3, { type: 'counter', id: 1, give: { grain: 1 }, want: { wood: 2 } });
  const counter = { id: 2, from: 3, to: 0, give: { grain: 1 }, want: { wood: 2 }, answers: {} };
  assert.deepEqual(c.events, [{ t: 'answer', id: 1, p: 3, yes: false }, { t: 'offer', offer: counter }]);
  t = c.state;
  assert.deepEqual(t.offers[0].answers, { 3: 'no' });
  assert.deepEqual(t.offers[1], counter);
  refuse(t, 1, { type: 'answer', id: 2, yes: true }, 'offer');
  // Replacing the proposer's own offer leaves the counter standing.
  const replaced = act(t, 0, { type: 'offer', give: { wood: 1 }, want: { wool: 1 }, to: 'all' });
  assert.deepEqual(replaced.events.map((e) => e.t), ['withdraw', 'offer']);
  assert.deepEqual(replaced.state.offers.map((o) => o.id), [2, 3]);
  // The proposer takes the counter: 2 wood for 1 grain.
  const r = act(t, 0, { type: 'answer', id: 2, yes: true });
  assert.deepEqual(r.events.at(-1), { t: 'trade', a: 3, b: 0, give: { grain: 1 }, want: { wood: 2 } });
  assert.equal(r.state.players[0].hand.wood, 1);
  assert.equal(r.state.players[0].hand.grain, 1);
  assert.equal(r.state.players[3].hand.wood, 2);
  assert.deepEqual(r.state.offers.map((o) => o.id), [1]);
  // A counterer can withdraw its counter; nobody else can.
  refuse(t, 0, { type: 'withdraw', id: 2 }, 'offer');
  const w = act(t, 3, { type: 'withdraw', id: 2 });
  assert.deepEqual(w.events, [{ t: 'withdraw', id: 2 }]);
  assert.deepEqual(w.state.offers.map((o) => o.id), [1]);
});

test('trades: no gifts, never one resource both ways, and both hands checked at the moment of trade', () => {
  const s = blank(3);
  deal(s, 0, { wood: 2, ore: 1 });
  deal(s, 1, { ore: 1, brick: 1 });
  refuse(s, 0, { type: 'offer', give: { wood: 1 }, want: {}, to: 'all' }, 'trade');
  refuse(s, 0, { type: 'offer', give: {}, want: { ore: 1 }, to: 1 }, 'trade');
  refuse(s, 0, { type: 'offer', give: { wood: 1, ore: 1 }, want: { ore: 1 }, to: 'all' }, 'trade');
  refuse(s, 0, { type: 'offer', give: { wood: 3 }, want: { ore: 1 }, to: 'all' }, 'hand');
  refuse(s, 0, { type: 'offer', give: { wood: 1 }, want: { iron: 1 }, to: 'all' }, 'action');
  // Player 1 says yes, then player 0 spends the wood on a road: the trade is refused.
  const t = geo(s).tiles[tileAt(s, 0, 0)];
  settle(s, 0, t.corners[0]);
  let o = run(s, 0, { type: 'offer', give: { wood: 2 }, want: { brick: 1 }, to: 'all' });
  o = run(o, 1, { type: 'answer', id: 1, yes: true });
  deal(o, 0, { brick: 1 });
  const spent = run(o, 0, { type: 'build', kind: 'road', at: t.edges[0] });
  refuse(spent, 0, { type: 'trade', id: 1, with: 1 }, 'hand');
  // Or the answerer can no longer pay.
  const robbed = structuredClone(o);
  robbed.players[1].hand.brick = 0;
  robbed.players[2].hand.brick = 1;
  refuse(robbed, 0, { type: 'trade', id: 1, with: 1 }, 'hand');
  // A one-player offer accepted by someone without the cards.
  const one = run(s, 0, { type: 'offer', give: { ore: 1 }, want: { wool: 1 }, to: 1 });
  refuse(one, 1, { type: 'answer', id: 1, yes: true }, 'hand');
});

test('every offer closes when the turn ends', () => {
  const s = blank(3);
  deal(s, 0, { wood: 2 });
  deal(s, 1, { ore: 2 });
  let t = run(s, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 }, to: 'all' });
  t = run(t, 1, { type: 'counter', id: 1, give: { ore: 1 }, want: { wood: 2 } });
  assert.equal(t.offers.length, 2);
  const next = run(t, 0, { type: 'end' });
  assert.deepEqual(next.offers, []);
  assert.equal(next.current, 1);
  assert.equal(next.phase, 'roll');
  assert.equal(next.turn, 2);
  refuse(next, 1, { type: 'answer', id: 2, yes: true }, 'phase');
});

/* ---------- Turns, the special building phase and winning ---------- */

test('ending a turn passes to the next player; five or six players get a special building phase', () => {
  const s = blank(5);
  refuse(s, 1, { type: 'end' }, 'not-your-turn');
  refuse(unrolled(5), 0, { type: 'end' }, 'phase');
  const sbp = act(s, 0, { type: 'end' });
  assert.deepEqual(sbp.events, [{ t: 'sbp' }]);
  let t = sbp.state;
  assert.equal(t.phase, 'sbp');
  assert.deepEqual(waitingOn(t), [1, 2, 3, 4]);
  // Others build and buy; no trades, no bank, no cards played; the player whose turn ended waits.
  const g = geo(t);
  const tile = g.tiles[tileAt(t, 1, 0)];
  settle(t, 2, tile.corners[0]);
  deal(t, 2, { wood: 1, brick: 1, ore: 1, wool: 1, grain: 1 });
  t.players[2].dev = [{ kind: 'knight', turn: 0 }];
  deal(t, 0, { wood: 1, brick: 1 });
  settle(t, 0, corner(t, -2, 0, 0));
  refuse(t, 0, { type: 'build', kind: 'road', at: legalSpots(t, 0, 'road')[0] }, 'not-your-turn');
  refuse(t, 2, { type: 'bank', give: { wood: 4 }, want: { ore: 1 } }, 'not-your-turn');
  refuse(t, 2, { type: 'offer', give: { wood: 1 }, want: { ore: 1 }, to: 'all' }, 'not-your-turn');
  refuse(t, 2, { type: 'play', card: 'knight' }, 'not-your-turn');
  refuse(t, 2, { type: 'end' }, 'not-your-turn');
  refuse(t, 0, { type: 'pass' }, 'not-your-turn');
  t.deck.push('roads');
  t = run(t, 2, { type: 'build', kind: 'road', at: tile.edges[0] });
  t = run(t, 2, { type: 'buy' });
  assert.deepEqual(t.players[2].dev.at(-1), { kind: 'roads', turn: 1 });
  t = run(t, 2, { type: 'pass' });
  refuse(t, 2, { type: 'pass' }, 'not-your-turn');
  refuse(t, 2, { type: 'buy' }, 'not-your-turn');
  t = run(t, 4, { type: 'pass' });
  t = run(t, 1, { type: 'pass' });
  assert.deepEqual(waitingOn(t), [3]);
  const r = act(t, 3, { type: 'pass' });
  assert.deepEqual(r.events, [{ t: 'pass', p: 3 }, { t: 'turn', p: 1, turn: 2 }]);
  assert.equal(r.state.phase, 'roll');
  assert.equal(r.state.current, 1);
  assert.equal(r.state.sbp, null);
  refuse(r.state, 3, { type: 'pass' }, 'phase');
  // A card bought in that phase is playable in its buyer's next turn.
  assert.equal(view(r.state, 2).players[2].dev.at(-1).fresh, false);
  // Four players: straight to the next turn.
  const four = act(blank(4), 0, { type: 'end' });
  assert.deepEqual(four.events, [{ t: 'turn', p: 1, turn: 2 }]);
  const wrap = structuredClone(four.state);
  wrap.current = 3;
  wrap.phase = 'main';
  wrap.rolled = true;
  assert.equal(run(wrap, 3, { type: 'end' }).current, 0);
});

/** A corner free by the distance rule, with a road of p's leading to it. */
function openCorner(s, p) {
  const g = geo(s);
  const at = g.corners.findIndex((c, i) => !s.buildings[i] && c.corners.every((d) => !s.buildings[d]));
  s.roads[g.corners[at].edges[0]] = p;
  return at;
}

/** A game where player p has the given points showing from settlements spread round the island. */
function withPoints(s, p, n) {
  const g = geo(s);
  const free = (c) => !s.buildings[c] && g.corners[c].corners.every((d) => !s.buildings[d]);
  for (let c = 0; c < g.corners.length && n > 0; c++) {
    if (!free(c)) continue;
    const city = n >= 2 && Object.values(s.buildings).filter((b) => b.p === p && b.kind === 'city').length < 4;
    settle(s, p, c, city ? 'city' : 'settlement');
    n -= city ? 2 : 1;
  }
  return s;
}

test('winning: reaching the target during your own turn ends the game', () => {
  const s = withPoints(blank(3), 0, 9);
  assert.equal(points(s, 0), 9);
  const at = openCorner(s, 0);
  deal(s, 0, COST.settlement);
  const r = act(s, 0, { type: 'build', kind: 'settlement', at });
  assert.deepEqual(r.events.at(-1), { t: 'win', p: 0, points: 10 });
  assert.equal(r.state.phase, 'over');
  assert.equal(r.state.winner, 0);
  assert.deepEqual(waitingOn(r.state), []);
  assert.equal(autoAction(r.state, 0), null);
  refuse(r.state, 0, { type: 'end' }, 'over');
  refuse(r.state, 1, { type: 'roll' }, 'over');
});

test('winning: a victory point card counts the moment it is bought', () => {
  const s = withPoints(blank(3), 0, 9);
  deal(s, 0, COST.dev);
  s.deck.push('vp');
  const r = act(s, 0, { type: 'buy' });
  assert.deepEqual(r.events.map((e) => e.t), ['buy', 'win']);
  assert.equal(r.state.winner, 0);
  assert.equal(points(r.state, 0, { hidden: false }), 9);
  // At the end every hand and card shows, to every seat and to the table.
  for (const seat of [0, 1, null]) {
    const v = view(r.state, seat);
    assert.deepEqual(v.players[0].dev, [{ kind: 'vp', fresh: true }]);
    assert.equal(v.players[0].points, 10);
    assert.ok(v.players.every((pl) => pl.hand));
  }
});

test('winning only on your own turn: points reached in another\'s turn count at the start of yours', () => {
  const s = withPoints(blank(3), 1, 8);
  s.players[1].dev = [{ kind: 'vp', turn: 0 }, { kind: 'vp', turn: 0 }];
  assert.equal(points(s, 1), 10);
  // Player 0 plays on; player 1 doesn't win yet.
  deal(s, 0, { ore: 4 });
  const traded = act(s, 0, { type: 'bank', give: { ore: 4 }, want: { wool: 1 } });
  assert.ok(!traded.events.some((e) => e.t === 'win'));
  assert.equal(view(traded.state, 0).players[1].points, 8, 'hidden from the others');
  assert.equal(view(traded.state, 1).players[1].points, 10);
  const r = act(traded.state, 0, { type: 'end' });
  assert.deepEqual(r.events, [{ t: 'turn', p: 1, turn: 2 }, { t: 'win', p: 1, points: 10 }]);
  assert.equal(r.state.phase, 'over');
});

test('winning: nobody wins in the special building phase; its points count at the start of their turn', () => {
  const s = withPoints(blank(5), 1, 9);
  let t = run(s, 0, { type: 'end' });
  deal(t, 1, COST.dev);
  t.deck.push('vp');
  const r = act(t, 1, { type: 'buy' });
  assert.ok(!r.events.some((e) => e.t === 'win'));
  assert.equal(points(r.state, 1), 10);
  t = r.state;
  for (const p of [2, 3, 1]) t = run(t, p, { type: 'pass' });
  const start = act(t, 4, { type: 'pass' });
  assert.deepEqual(start.events, [{ t: 'pass', p: 4 }, { t: 'turn', p: 1, turn: 2 }, { t: 'win', p: 1, points: 10 }]);
  // Someone further round waits for their own turn.
  const later = withPoints(blank(5), 3, 10);
  let u = run(later, 0, { type: 'end' });
  for (const p of [1, 2, 3, 4]) u = run(u, p, { type: 'pass' });
  assert.equal(u.phase, 'roll');
  assert.equal(u.current, 1);
});

/* ---------- Views and events ---------- */

/** Plays a game up to a point with steals, buys and discards in its log. */
function midGame(seed = 5, n = 4, steps = 400) {
  return fuzzGame(seed, n, steps, { check: false }).state;
}

test('a view never shows another player\'s hand or cards, the seed, the random state or the deck order', () => {
  const s = midGame();
  assert.notEqual(s.phase, 'over');
  for (const seat of [0, 1, 2, 3, null]) {
    const v = view(s, seat);
    const text = JSON.stringify(v);
    assert.ok(!/"(rng|seed|nextOffer)"/.test(text));
    assert.equal(typeof v.deck, 'number');
    assert.equal(v.deck, s.deck.length);
    assert.equal(v.me, seat);
    v.players.forEach((pl, i) => {
      assert.equal(pl.cards, handTotal(s.players[i].hand));
      assert.equal(pl.devs, s.players[i].dev.length);
      if (i === seat) {
        assert.deepEqual(pl.hand, s.players[i].hand);
        assert.deepEqual(pl.dev.map((d) => d.kind), s.players[i].dev.map((d) => d.kind));
        assert.equal(pl.points, points(s, i));
      } else {
        assert.equal(pl.hand, undefined);
        assert.equal(pl.dev, undefined);
        assert.equal(pl.points, points(s, i, { hidden: false }));
      }
    });
    if (seat === null) assert.ok(!text.includes('"hand"'));
    for (const e of v.log) {
      if (e.t === 'steal') assert.equal('res' in e, seat !== null && (e.from === seat || e.to === seat));
      if (e.t === 'buy') assert.equal('kind' in e, e.p === seat);
      if (e.t === 'discard') assert.equal('cards' in e, e.p === seat);
    }
    assert.ok(v.log.length <= 50);
    // The helpers read a view as they read the state.
    if (seat !== null) {
      for (const kind of ['road', 'settlement', 'city']) assert.deepEqual(legalSpots(v, seat, kind), legalSpots(s, seat, kind));
      for (const what of ['road', 'settlement', 'city', 'dev']) assert.equal(canAfford(v, seat, what), canAfford(s, seat, what));
      assert.equal(canAfford(v, (seat + 1) % 4, 'road'), false);
      for (const r of RES) assert.equal(rateOf(v, seat, r), rateOf(s, seat, r));
      assert.deepEqual(waitingOn(v), waitingOn(s));
      assert.deepEqual(autoAction(v, seat), autoAction(s, seat));
    }
    for (let i = 0; i < 4; i++) assert.equal(v.players[i].road, longestRoad(s, i));
  }
  // A view is its own copy.
  const v = view(s, 0);
  const num = s.island.tiles[0].num;
  v.players[0].hand.wood = 99;
  v.island.tiles[0].num = num + 1;
  v.roads[0] = 99;
  assert.notEqual(s.players[0].hand.wood, 99);
  assert.equal(s.island.tiles[0].num, num);
  assert.notEqual(s.roads[0], 99);
});

test('a fresh card shows as fresh only to its owner, and the steal candidates and discards are public', () => {
  const s = blank(3);
  s.players[1].dev = [{ kind: 'vp', turn: 1 }, { kind: 'knight', turn: 0 }];
  assert.deepEqual(view(s, 1).players[1].dev, [{ kind: 'vp', fresh: true }, { kind: 'knight', fresh: false }]);
  assert.equal(view(s, 0).players[1].devs, 2);
  assert.equal(view(s, 0).players[1].dev, undefined);
  s.phase = 'discard';
  s.discard = { 1: 4 };
  assert.deepEqual(view(s, 2).discard, { 1: 4 });
});

test('eventsFor strips what a steal took, what a card bought was, and which cards a discard gave', () => {
  const events = [
    { t: 'steal', from: 1, to: 0, res: 'ore' },
    { t: 'buy', p: 2, kind: 'vp' },
    { t: 'discard', p: 3, n: 4, cards: { wood: 4 } },
    { t: 'roll', p: 0, dice: [3, 4], sum: 7 },
    { t: 'trade', a: 0, b: 1, give: { wood: 1 }, want: { ore: 1 } },
  ];
  const stripped = [
    { t: 'steal', from: 1, to: 0 },
    { t: 'buy', p: 2 },
    { t: 'discard', p: 3, n: 4 },
    events[3],
    events[4],
  ];
  assert.deepEqual(eventsFor(events, null), stripped);
  assert.deepEqual(eventsFor(events, 4), stripped);
  assert.deepEqual(eventsFor(events, 0), [events[0], ...stripped.slice(1)]);
  assert.deepEqual(eventsFor(events, 1), [events[0], ...stripped.slice(1)]);
  assert.deepEqual(eventsFor(events, 2), [stripped[0], events[1], ...stripped.slice(2)]);
  assert.deepEqual(eventsFor(events, 3), [stripped[0], stripped[1], events[2], ...stripped.slice(3)]);
  assert.deepEqual(events[0].res, 'ore', 'the events given are left as they were');
});

test('waitingOn and autoAction: who is due, and a minimal legal move for each', () => {
  let s = newGame(21, seats(4));
  assert.deepEqual(waitingOn(s), [0]);
  assert.equal(autoAction(s, 1), null);
  const pick = autoAction(s, 0);
  assert.equal(pick.kind, 'settlement');
  // The first corner chosen touches the best numbers.
  const g = geo(s);
  const score = (c) => g.corners[c].tiles.reduce((n, t) => n + pipsOf(s.island.tiles[t].num), 0);
  assert.equal(score(pick.at), Math.max(...legalSpots(s, 0, 'settlement').map(score)));
  while (s.phase === 'setup') s = run(s, s.current, autoAction(s, s.current));
  assert.deepEqual(autoAction(s, 0), { type: 'roll' });
  assert.equal(autoAction(s, 2), null);
  // Discards come off the biggest piles.
  const d = structuredClone(s);
  d.phase = 'discard';
  d.discard = { 2: 4 };
  d.players[2].hand = { wood: 1, brick: 4, wool: 3, grain: 0, ore: 1 };
  assert.deepEqual(autoAction(d, 2), { type: 'discard', cards: { brick: 3, wool: 1 } });
  assert.equal(autoAction(d, 0), null);
  // The robber goes where the others are, never beside your own buildings.
  const rob = structuredClone(s);
  rob.phase = 'robber';
  rob.after = 'main';
  const tile = autoAction(rob, 0).tile;
  const owners = geo(rob).tiles[tile].corners.map((c) => rob.buildings[c]?.p).filter((p) => p !== undefined);
  assert.ok(owners.length > 0 && !owners.includes(0));
  assert.notEqual(tile, rob.robber);
  // Main: the current player ends; someone offered to says no; the special building phase passes.
  const main = run(rigged(s, 8), 0, { type: 'roll' });
  assert.deepEqual(autoAction(main, 0), { type: 'end' });
  assert.equal(autoAction(main, 1), null);
  deal(main, 0, { wood: 1 });
  const offered = run(main, 0, { type: 'offer', give: { wood: 1 }, want: { ore: 1 }, to: 'all' });
  assert.deepEqual(autoAction(offered, 2), { type: 'answer', id: 1, yes: false });
  assert.equal(autoAction(run(offered, 2, autoAction(offered, 2)), 2), null);
  const five = run(blank(5), 0, { type: 'end' });
  assert.deepEqual(autoAction(five, 3), { type: 'pass' });
  assert.equal(autoAction(five, 0), null);
  // autoAction never draws from the game's randomness, and is the same every time.
  const before = JSON.stringify(main);
  assert.deepEqual(autoAction(main, 0), autoAction(main, 0));
  assert.equal(JSON.stringify(main), before);
});

test('apply refuses junk without throwing and never changes the state it is given', () => {
  const s = midGame(9, 3, 120);
  const before = JSON.stringify(s);
  const rnd = mulberry32(99);
  const values = [undefined, null, 0, 1, -1, 2.5, 99, 'all', 'wood', '__proto__', [], ['ore'], {}, { wood: 1 }, { wood: -1 }, { gold: 1 }, true];
  const types = ['roll', 'discard', 'robber', 'steal', 'build', 'buy', 'play', 'bank', 'offer', 'answer', 'trade', 'counter', 'withdraw', 'end', 'pass', 'nope', 'constructor', '__proto__', 'toString'];
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  for (let i = 0; i < 3000; i++) {
    const action = { type: pick(types) };
    for (const k of ['kind', 'at', 'tile', 'victim', 'card', 'res', 'give', 'want', 'to', 'id', 'yes', 'with', 'cards']) if (rnd() < 0.4) action[k] = pick(values);
    const p = pick([0, 1, 2, -1, 3, 0.5, null, '1']);
    const r = apply(s, p, rnd() < 0.02 ? pick([null, 5, 'x']) : action);
    assert.ok(r.error || r.state);
  }
  assert.equal(JSON.stringify(s), before);
  assert.equal(apply(s, 0, null).error, 'action');
  assert.equal(apply(s, 7, { type: 'roll' }).error, 'player');
  assert.equal(apply(s, 0, { type: 'toString' }).error, 'action');
});

/* ---------- Whole games ---------- */

/** A legal move for p now, chosen with the test's own random stream (or null). */
function randomMove(s, p, rnd) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const left = view(s, p).players[p].pieces;
  const pl = s.players[p];
  const hand = pl.hand;
  const moves = [];
  if (s.phase === 'main' || s.phase === 'sbp') {
    for (const kind of ['city', 'settlement', 'road']) {
      if (!left[kind] || !canAfford(s, p, kind)) continue;
      const spots = legalSpots(s, p, kind);
      if (spots.length) moves.push({ type: 'build', kind, at: pick(spots) });
    }
    if (canAfford(s, p, 'dev') && s.deck.length) moves.push({ type: 'buy' });
  }
  if (s.phase === 'sbp') return moves.length ? pick(moves) : null;
  // A card from an earlier turn, before the roll or after it.
  const plays = [];
  if (!pl.played) {
    for (const d of pl.dev) {
      if (d.turn === s.turn || d.kind === 'vp') continue;
      if (d.kind === 'knight') plays.push({ type: 'play', card: 'knight' });
      if (d.kind === 'tribute') plays.push({ type: 'play', card: 'tribute', res: pick(RES) });
      if (d.kind === 'harvest') {
        const res = [pick(RES), pick(RES)];
        if (res.every((r) => s.bank[r] >= res.filter((x) => x === r).length)) plays.push({ type: 'play', card: 'harvest', res });
      }
      if (d.kind === 'roads' && left.road && legalSpots(s, p, 'road').length) plays.push({ type: 'play', card: 'roads' });
    }
  }
  if (s.phase === 'roll') return plays.length && rnd() < 0.3 ? pick(plays) : null;
  moves.push(...plays);
  for (const r of RES) {
    const rate = rateOf(s, p, r);
    if (hand[r] < rate) continue;
    const want = RES.filter((x) => x !== r && s.bank[x] > 0);
    if (want.length) moves.push({ type: 'bank', give: { [r]: rate }, want: { [pick(want)]: 1 } });
  }
  const mine = RES.filter((r) => hand[r] > 0);
  if (mine.length && rnd() < 0.5) {
    const give = pick(mine);
    const others = s.players.map((_, i) => i).filter((i) => i !== p);
    moves.push({ type: 'offer', give: { [give]: 1 }, want: { [pick(RES.filter((r) => r !== give))]: 1 }, to: rnd() < 0.5 ? 'all' : pick(others) });
  }
  for (const o of s.offers) {
    if (o.from !== p) continue;
    if (rnd() < 0.2) moves.push({ type: 'withdraw', id: o.id });
    for (const [q, answer] of Object.entries(o.answers)) {
      if (answer === 'yes' && holdsAll(hand, o.give) && holdsAll(s.players[q].hand, o.want)) moves.push({ type: 'trade', id: o.id, with: Number(q) });
    }
  }
  return moves.length ? pick(moves) : null;
}

/** Someone answering an open offer: yes when they can pay (and a one-player offer's proposer still can), no, or a counter. */
function randomAnswer(s, rnd) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const o = pick(s.offers);
  const can = s.players.map((_, i) => i).filter((i) => i !== o.from && (o.to === 'all' || o.to === i) && !o.answers[i]);
  if (!can.length) return null;
  const p = pick(can);
  const hand = s.players[p].hand;
  const pays = holdsAll(hand, o.want) && (o.to === 'all' || holdsAll(s.players[o.from].hand, o.give));
  if (pays && rnd() < 0.6) return { p, action: { type: 'answer', id: o.id, yes: true } };
  const mine = RES.filter((r) => hand[r] > 0);
  if (mine.length && rnd() < 0.3) {
    const give = pick(mine);
    return { p, action: { type: 'counter', id: o.id, give: { [give]: 1 }, want: { [pick(RES.filter((r) => r !== give))]: 1 } } };
  }
  return { p, action: { type: 'answer', id: o.id, yes: false } };
}

/** Everything that must hold after every step of a game. */
function checkInvariants(s, start) {
  const g = geo(s);
  for (const r of RES) {
    assert.ok(Number.isInteger(s.bank[r]) && s.bank[r] >= 0, `bank ${r}`);
    let sum = s.bank[r];
    for (const pl of s.players) {
      assert.ok(Number.isInteger(pl.hand[r]) && pl.hand[r] >= 0, `hand ${r}`);
      sum += pl.hand[r];
    }
    assert.equal(sum, start.bank[r], `${r} cards kept`);
  }
  assert.equal(s.deck.length + s.players.reduce((n, pl) => n + pl.dev.length, 0) + start.played, start.deck.length, 'every card accounted for');
  const setupDone = s.phase !== 'setup';
  s.players.forEach((pl, p) => {
    const roads = Object.entries(s.roads).filter(([, o]) => o === p).map(([e]) => Number(e));
    const mine = Object.entries(s.buildings).filter(([, b]) => b.p === p);
    const cities = mine.filter(([, b]) => b.kind === 'city').length;
    assert.ok(roads.length <= PIECES.road && mine.length - cities <= PIECES.settlement && cities <= PIECES.city, 'pieces');
    // Every road joins the player's buildings through their own roads.
    const reached = new Set(mine.map(([c]) => Number(c)));
    const seen = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of roads) {
        if (seen.has(e) || !(reached.has(g.edges[e].a) || reached.has(g.edges[e].b))) continue;
        seen.add(e);
        reached.add(g.edges[e].a);
        reached.add(g.edges[e].b);
        grew = true;
      }
    }
    assert.equal(seen.size, roads.length, 'roads connected');
    if (setupDone) for (const [c] of mine) assert.ok(g.corners[c].edges.some((e) => s.roads[e] === p), 'a building on its own road');
    const vp = pl.dev.filter((d) => d.kind === 'vp').length;
    const want = mine.length + cities + (s.awards.road === p ? 2 : 0) + (s.awards.army === p ? 2 : 0) + vp;
    assert.equal(points(s, p), want, 'points add up');
    assert.equal(points(s, p, { hidden: false }), want - vp);
  });
  for (const c of Object.keys(s.buildings)) for (const d of g.corners[c].corners) assert.ok(!s.buildings[d], 'distance rule');
  // Awards: the longest road holder is at least level with the longest at 5 or more, and an empty
  // award means nobody is longest alone at 5 or more; the army holder has the most knights, 3 or more.
  const lengths = s.players.map((_, i) => longestRoad(s, i));
  const max = Math.max(...lengths);
  if (s.awards.road !== null) assert.ok(lengths[s.awards.road] >= 5 && lengths[s.awards.road] === max, 'road holder');
  else assert.ok(max < 5 || lengths.filter((n) => n === max).length > 1, 'road unclaimed');
  const knights = s.players.map((pl) => pl.knights);
  if (s.awards.army !== null) assert.ok(knights[s.awards.army] >= 3 && knights[s.awards.army] === Math.max(...knights), 'army holder');
  else assert.ok(Math.max(...knights) < 3, 'army unclaimed');
  if (s.phase === 'over') assert.ok(points(s, s.winner) >= s.target);
  else if (s.phase !== 'sbp') assert.ok(points(s, s.current) < s.target, 'the current player would have won');
}

/**
 * Plays a game: whoever the game waits for acts with autoAction, mixed with random legal builds,
 * buys, bank trades, cards and offers, and answers from the others.
 */
function fuzzGame(seed, n, cap, { check = true } = {}) {
  let s = newGame(seed, seats(n));
  const rnd = mulberry32(seed * 1000 + n);
  const start = { bank: { ...s.bank }, deck: s.deck.slice(), played: 0 };
  let steps = 0;
  for (; steps < cap && s.phase !== 'over'; steps++) {
    let p;
    let action = null;
    if (s.phase === 'main' && s.offers.length && rnd() < 0.3) {
      const a = randomAnswer(s, rnd);
      if (a) ({ p, action } = a);
    }
    if (!action) {
      const waiting = waitingOn(s);
      p = waiting[Math.floor(rnd() * waiting.length)];
      if (p === s.current ? ['main', 'roll'].includes(s.phase) : s.phase === 'sbp') action = rnd() < 0.85 ? randomMove(s, p, rnd) : null;
      if (!action) action = autoAction(s, p);
    }
    assert.ok(action, `nothing to do for ${p} in ${s.phase}`);
    const before = check ? JSON.stringify(s) : null;
    const r = apply(s, p, action);
    assert.ok(!r.error, `step ${steps}: ${JSON.stringify(action)} by ${p} in ${s.phase} refused: ${r.error}`);
    if (check) assert.equal(JSON.stringify(s), before, 'apply changed its input');
    start.played += r.events.filter((e) => e.t === 'play').length;
    s = r.state;
    if (check) {
      checkInvariants(s, start);
      if (steps % 25 === 0) {
        const seat = steps % (n + 1) === n ? null : steps % (n + 1);
        const text = JSON.stringify(view(s, seat));
        assert.ok(!/"(rng|seed)"/.test(text));
      }
    }
  }
  return { state: s, steps };
}

test('whole games for 3 to 6 players keep every rule after every step', () => {
  let finished = 0;
  let games = 0;
  for (const n of [3, 4, 5, 6]) {
    for (const seed of [1, 2, 3]) {
      const { state, steps } = fuzzGame(seed, n, 3000);
      games++;
      if (state.phase === 'over') {
        finished++;
        assert.ok(points(state, state.winner) >= state.target);
        assert.equal(state.log.at(-1).t, 'win');
      }
      assert.ok(steps > 50, `${n} players, seed ${seed}: ${steps} steps`);
    }
  }
  assert.ok(finished >= games - 2, `${finished} of ${games} games finished`);
});

test('the same seed and the same actions give the same game, to the byte', () => {
  for (const n of [3, 5]) {
    const a = fuzzGame(4, n, 600, { check: false }).state;
    const b = fuzzGame(4, n, 600, { check: false }).state;
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
  // A different seed deals a different game.
  assert.notEqual(JSON.stringify(newGame(1, seats(4)).deck), JSON.stringify(newGame(2, seats(4)).deck));
  assert.deepEqual(newGame(1, seats(4)), newGame(1, seats(4)));
});
