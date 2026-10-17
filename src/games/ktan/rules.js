// Ktan's rules: the classic base game (our own names) as one plain-JSON state and the actions that
// change it (KTAN.md, B2 and B6). DOM-free and deterministic: every random draw (the deck, the
// dice, steals) comes from a mulberry32 whose state lives in the game, so the same seed and the
// same actions always give the same game. The host runs apply(); every seat gets view() of the
// game, which never holds another player's hand or development cards, the seed or the deck order.
//
// Actions, { type, ... }:
//   setup and main: build { kind: 'road' | 'settlement' | 'city', at }  (a road or settlement in setup)
//   roll · discard { cards } · robber { tile } · steal { victim } · buy · play { card, res? }
//   bank { give, want } · offer { give, want, to: 'all' | p } · answer { id, yes } · trade { id, with }
//   counter { id, give, want } · withdraw { id } · end · pass (special building phase)
// apply() refuses with { error } and one of these reasons:
//   'action'        malformed: no such action, or a field missing or of the wrong kind
//   'player'        no such seat
//   'over'          the game has ended
//   'not-your-turn' someone else is to act
//   'phase'         not now (e.g. building before the roll, or a road while a settlement is due)
//   'cost'          you can't pay for it
//   'pieces'        none of those pieces left
//   'spot'          not a legal place for it
//   'deck'          no development cards left
//   'card'          that card can't be played (none, bought this turn, already played one, victory points)
//   'tile'          the robber must move to another tile
//   'victim'        not someone you can steal from
//   'hand'          you (or the other side) don't hold those cards, or a discard of the wrong size
//   'bank'          the bank doesn't have those cards
//   'rate'          a bank trade not in steps of your rate, or not wanting what it pays for
//   'trade'         no gifts (each side gives a card) and never one resource both ways
//   'offer'         no such open offer, or not one you can answer, take or withdraw
import { RES, geometry, harbourCorners, makeIsland } from './board.js';

export const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  dev: { ore: 1, wool: 1, grain: 1 },
};
export const PIECES = { road: 15, settlement: 5, city: 4 };
/** Development cards. Tribute is our Monopoly, Harvest our Year of Plenty, 'roads' Road building. */
export const DEV_KINDS = ['knight', 'vp', 'roads', 'harvest', 'tribute'];
export const TARGET = 10;

const LOG = 200; // events the state keeps
const VIEW_LOG = 50; // of which a view carries the last
const BUILDS = ['road', 'settlement', 'city'];
const PLAYABLE = ['knight', 'roads', 'harvest', 'tribute'];
const DECK = {
  base: { knight: 14, vp: 5, roads: 2, harvest: 2, tribute: 2 },
  big: { knight: 20, vp: 5, roads: 3, harvest: 3, tribute: 3 },
};
const BANK = { base: 19, big: 24 };
const NO_WIN = ['setup', 'sbp', 'over']; // nobody wins while these are on

/* ---------- Randomness ---------- */

// One mulberry32 step on the state's own 32-bit state.
function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// The game's stream starts from a hash of the seed, not the seed itself, so it never runs in step
// with the island's own generator (makeIsland, seeded with the same number).
function mix(seed) {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function shuffle(list, s) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// A deep copy of plain JSON: several times quicker than structuredClone for a game's small
// objects, and apply() makes one for every action.
function copy(v) {
  if (Array.isArray(v)) return v.map(copy);
  if (v === null || typeof v !== 'object') return v;
  const out = {};
  for (const k in v) out[k] = copy(v[k]);
  return out;
}

/* ---------- Cards ---------- */

const emptyHand = () => ({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
const isRes = (r) => RES.includes(r);
const count = (cards) => Object.values(cards).reduce((n, k) => n + k, 0);
const total = (hand) => RES.reduce((n, r) => n + (hand[r] || 0), 0);
const holds = (hand, cards) => Object.entries(cards).every(([r, n]) => (hand[r] || 0) >= n);

function move(from, to, cards) {
  for (const [r, n] of Object.entries(cards)) {
    from[r] -= n;
    to[r] += n;
  }
}

// Only the resources with a count, in RES order, so equal hands always serialise the same.
function tidy(cards) {
  const out = {};
  for (const r of RES) if (cards[r] > 0) out[r] = cards[r];
  return out;
}

/** A { res: n } from an action, or null when it isn't one: only resource names and whole counts. */
function cleanCards(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  for (const [r, n] of Object.entries(c)) if (!isRes(r) || !Number.isInteger(n) || n < 0) return null;
  return tidy(c);
}

// Both sides of a trade, or the reason it can't be one.
function cleanDeal(give, want) {
  const g = cleanCards(give);
  const w = cleanCards(want);
  if (!g || !w) return 'action';
  if (!count(g) || !count(w) || RES.some((r) => g[r] && w[r])) return 'trade';
  return { give: g, want: w };
}

/** Cards in a hand: known on a state, and on a view for the viewer; otherwise the view's count. */
const cardsHeld = (g, p) => (g.players[p].hand ? total(g.players[p].hand) : g.players[p].cards || 0);

// The dots under a number token: how often it comes up, out of 36.
const pips = (num) => (num >= 2 && num <= 12 && num !== 7 ? 6 - Math.abs(7 - num) : 0);

/* ---------- The board ---------- */

// The geometry of a state's island, kept per tiles array so repeated lookups on one state skip
// even building geometry()'s key.
const geos = new WeakMap();
function geoOf(g) {
  let geo = geos.get(g.island.tiles);
  if (!geo) {
    geo = geometry(g.island.tiles);
    geos.set(g.island.tiles, geo);
  }
  return geo;
}

/** Pieces a player has left: what isn't on the board (a city's settlement went back to supply). */
function piecesLeft(g, p) {
  let road = 0;
  let settlement = 0;
  let city = 0;
  for (const owner of Object.values(g.roads)) if (owner === p) road++;
  for (const b of Object.values(g.buildings)) {
    if (b.p !== p) continue;
    if (b.kind === 'city') city++;
    else settlement++;
  }
  return { road: PIECES.road - road, settlement: PIECES.settlement - settlement, city: PIECES.city - city };
}

// Whether p may put a piece of this kind at `at` now, by the placing rules alone (pieces and cost
// are checked apart). In setup only the piece the step needs, for the player placing.
function spotOk(g, p, kind, at, geo = geoOf(g)) {
  const setup = g.phase === 'setup';
  if (kind === 'road') {
    const e = geo.edges[at];
    if (!e || g.roads[at] !== undefined) return false;
    if (setup) return g.setup.need === 'road' && g.current === p && (e.a === g.setup.last || e.b === g.setup.last);
    // A road joins your own building, or your own road through a corner no one else has built on.
    return [e.a, e.b].some((c) => {
      const b = g.buildings[c];
      if (b) return b.p === p;
      return geo.corners[c].edges.some((x) => x !== at && g.roads[x] === p);
    });
  }
  const c = geo.corners[at];
  if (!c) return false;
  if (kind === 'city') return !setup && g.buildings[at]?.p === p && g.buildings[at].kind === 'settlement';
  if (kind !== 'settlement') return false;
  if (g.buildings[at] || c.corners.some((x) => g.buildings[x])) return false; // the distance rule
  if (setup) return g.setup.need === 'settlement' && g.current === p;
  return c.edges.some((x) => g.roads[x] === p);
}

/**
 * Where p may place a piece of this kind now: corner ids for 'settlement' and 'city', edge ids for
 * 'road'. Placement only: pieces left and cost are apart (canAfford, a view's pieces). Works on a
 * state and on a view.
 */
export function legalSpots(g, p, kind) {
  const geo = geoOf(g);
  const n = kind === 'road' ? geo.edges.length : geo.corners.length;
  const out = [];
  for (let id = 0; id < n; id++) if (spotOk(g, p, kind, id, geo)) out.push(id);
  return out;
}

/** Whether p's hand pays for 'road', 'settlement', 'city' or 'dev'. False on a view of someone else. */
export function canAfford(g, p, what) {
  const hand = g.players[p]?.hand;
  return !!hand && !!COST[what] && holds(hand, COST[what]);
}

/** p's bank rate for a resource: 2 at its own harbour, 3 at an 'any' harbour, otherwise 4. */
export function rateOf(g, p, res) {
  const geo = geoOf(g);
  let rate = 4;
  for (const h of g.island.harbours || []) {
    const [a, b] = harbourCorners(geo, h);
    if (g.buildings[a]?.p !== p && g.buildings[b]?.p !== p) continue;
    if (h.type === res) return 2;
    if (h.type === 'any') rate = 3;
  }
  return rate;
}

/**
 * p's longest trail of their own roads: no road twice, loops allowed, and a corner with another
 * player's building ends the trail there (the road into it still counts).
 */
export function longestRoad(g, p) {
  const geo = geoOf(g);
  const own = new Uint8Array(geo.edges.length);
  const starts = new Set();
  for (const id in g.roads) {
    if (g.roads[id] !== p) continue;
    own[id] = 1;
    starts.add(geo.edges[id].a);
    starts.add(geo.edges[id].b);
  }
  if (!starts.size) return 0;
  const blocked = new Uint8Array(geo.corners.length);
  for (const c in g.buildings) if (g.buildings[c].p !== p) blocked[c] = 1;
  const used = new Uint8Array(geo.edges.length);
  let depth = 0;
  const walk = (c) => {
    if (depth && blocked[c]) return 0;
    let best = 0;
    for (const e of geo.corners[c].edges) {
      if (!own[e] || used[e]) continue;
      const { a, b } = geo.edges[e];
      used[e] = 1;
      depth++;
      const n = 1 + walk(a === c ? b : a);
      used[e] = 0;
      depth--;
      if (n > best) best = n;
    }
    return best;
  };
  let longest = 0;
  for (const c of starts) longest = Math.max(longest, walk(c));
  return longest;
}

/** p's points: buildings, awards and, unless hidden is false, victory point cards. */
export function points(g, p, { hidden = true } = {}) {
  let n = 0;
  for (const b of Object.values(g.buildings)) if (b.p === p) n += b.kind === 'city' ? 2 : 1;
  if (g.awards.road === p) n += 2;
  if (g.awards.army === p) n += 2;
  if (hidden) for (const d of g.players[p].dev || []) if (d.kind === 'vp') n += 1;
  return n;
}

/* ---------- A new game ---------- */

/**
 * A game for 2 to 6 players, in turn order (players[0] goes first): [{ name, color, mark }].
 * options.island: 'starter' (the default up to 4 players) or 'random', from makeIsland({ size, seed })
 * with this seed; 5 to 6 players always play a random big island. An island object
 * ({ size, tiles, harbours }) is also taken as it is. options.target: the points that win (10).
 */
export function newGame(seed, players, options = {}) {
  const n = Array.isArray(players) ? players.length : 0;
  if (n < 2 || n > 6) throw new Error('Ktan takes 2 to 6 players');
  const big = n >= 5;
  const size = big ? 'big' : 'base';
  const s = {
    v: 1,
    seed: seed >>> 0,
    rng: mix(seed >>> 0),
    target: options.target ?? TARGET,
    island: pickIsland(seed >>> 0, size, options.island),
    robber: -1,
    players: players.map((pl) => ({
      name: String(pl?.name ?? ''),
      color: pl?.color ?? null,
      mark: pl?.mark ?? null,
      hand: emptyHand(),
      dev: [],
      knights: 0,
      played: false,
    })),
    roads: {},
    buildings: {},
    bank: Object.fromEntries(RES.map((r) => [r, BANK[size]])),
    deck: [],
    awards: { road: null, army: null },
    current: 0,
    turn: 0,
    phase: 'setup',
    setup: { order: [...Array(n).keys(), ...[...Array(n).keys()].reverse()], step: 0, need: 'settlement', last: null },
    rolled: false,
    dice: null,
    discard: null,
    steal: null,
    free: 0,
    after: null,
    offers: [],
    nextOffer: 1,
    sbp: null,
    winner: null,
    log: [],
  };
  s.robber = s.island.tiles.findIndex((t) => t.res === 'desert');
  s.deck = shuffle(Object.entries(DECK[size]).flatMap(([kind, k]) => Array(k).fill(kind)), s);
  return s;
}

function pickIsland(seed, size, choice) {
  if (choice && typeof choice === 'object') return copy(choice);
  if (size === 'big' || choice === 'random') return makeIsland({ size, seed });
  return makeIsland({ starter: true });
}

/* ---------- Applying an action ---------- */

/**
 * Applies seat p's action. Returns { state, events } (a new state: the one given is never changed)
 * or { error } with one of the reasons at the top of this file.
 */
export function apply(state, p, action) {
  if (!state || !Array.isArray(state.players)) return { error: 'action' };
  if (!Number.isInteger(p) || p < 0 || p >= state.players.length) return { error: 'player' };
  if (!action || typeof action !== 'object' || !Object.hasOwn(ACTIONS, action.type)) return { error: 'action' };
  if (state.phase === 'over') return { error: 'over' };
  const s = copy(state);
  const events = [];
  const error = ACTIONS[action.type](s, p, action, events);
  if (error) return { error };
  checkWin(s, p, events);
  s.log.push(...events);
  if (s.log.length > LOG) s.log.splice(0, s.log.length - LOG);
  return { state: s, events };
}

// The usual check: the current player, in one of these phases.
function yours(s, p, ...phases) {
  if (p !== s.current) return 'not-your-turn';
  if (!phases.includes(s.phase)) return 'phase';
  return null;
}

// You win by reaching the target during your own turn: after any action of yours in it, and at
// its start (for points that came while someone else was playing).
function checkWin(s, p, events) {
  if (p !== s.current || NO_WIN.includes(s.phase)) return;
  const pts = points(s, p);
  if (pts < s.target) return;
  s.phase = 'over';
  s.winner = p;
  s.discard = null;
  s.steal = null;
  s.free = 0;
  s.after = null;
  s.offers = [];
  events.push({ t: 'win', p, points: pts });
}

function startTurn(s, p, events) {
  s.current = p;
  s.turn += 1;
  s.phase = 'roll';
  s.rolled = false;
  s.offers = [];
  s.sbp = null;
  s.free = 0;
  s.after = null;
  for (const pl of s.players) pl.played = false;
  events.push({ t: 'turn', p, turn: s.turn });
  checkWin(s, p, events);
}

// Back from the robber, a steal or free roads to where the turn was.
function back(s) {
  s.phase = s.after;
  s.after = null;
  s.steal = null;
}

function place(s, p, kind, at) {
  if (kind === 'road') s.roads[at] = p;
  else s.buildings[at] = { p, kind };
}

// Longest road, again after any road or settlement: the holder keeps it while still the longest
// (a tie keeps it) at 5 or more; otherwise the one player longest at 5 or more takes it, or no one.
function updateRoad(s, events) {
  const lengths = s.players.map((_, i) => longestRoad(s, i));
  const max = Math.max(...lengths);
  const holder = s.awards.road;
  let to = holder;
  if (holder === null || lengths[holder] < 5 || lengths[holder] < max) {
    const top = lengths.flatMap((n, i) => (n === max && n >= 5 ? [i] : []));
    to = top.length === 1 ? top[0] : null;
  }
  if (to === holder) return;
  s.awards.road = to;
  events.push({ t: 'award', kind: 'road', from: holder, to });
}

// Largest army: 3 knights or more, and more than the holder.
function updateArmy(s, p, events) {
  const holder = s.awards.army;
  const k = s.players[p].knights;
  if (holder === p || k < 3 || (holder !== null && k <= s.players[holder].knights)) return;
  s.awards.army = p;
  events.push({ t: 'award', kind: 'army', from: holder, to: p });
}

function produce(s, sum, events) {
  const geo = geoOf(s);
  const owed = [];
  s.island.tiles.forEach((t, i) => {
    if (t.num !== sum || i === s.robber || !isRes(t.res)) return;
    for (const c of geo.tiles[i].corners) {
      const b = s.buildings[c];
      if (b) owed.push({ p: b.p, res: t.res, n: b.kind === 'city' ? 2 : 1, tile: i });
    }
  });
  // Per resource: when the bank can't pay everyone, nobody gets it, unless only one player is
  // owed it; that player gets what's left.
  const short = [];
  for (const res of RES) {
    const due = owed.filter((g) => g.res === res);
    const need = due.reduce((n, g) => n + g.n, 0);
    if (!due.length || need <= s.bank[res]) continue;
    short.push(res);
    let left = new Set(due.map((g) => g.p)).size === 1 ? s.bank[res] : 0;
    for (const g of due) {
      g.n = Math.min(g.n, left);
      left -= g.n;
    }
  }
  const gains = owed.filter((g) => g.n > 0);
  for (const g of gains) {
    s.bank[g.res] -= g.n;
    s.players[g.p].hand[g.res] += g.n;
  }
  events.push({ t: 'produce', gains });
  for (const res of short) events.push({ t: 'shortage', res });
}

function takeCard(s, from, to, events) {
  const hand = s.players[from].hand;
  let k = Math.floor(rand(s) * total(hand));
  let res = RES[0];
  for (const r of RES) {
    if (k < hand[r]) {
      res = r;
      break;
    }
    k -= hand[r];
  }
  hand[res] -= 1;
  s.players[to].hand[res] += 1;
  events.push({ t: 'steal', from, to, res });
}

// Who the robber can steal from on a tile: others with a building on it and a card in hand.
function victims(s, p, tile) {
  const geo = geoOf(s);
  const out = new Set();
  for (const c of geo.tiles[tile].corners) {
    const b = s.buildings[c];
    if (b && b.p !== p && total(s.players[b.p].hand) > 0) out.add(b.p);
  }
  return [...out].sort((a, b) => a - b);
}

// Opens an offer from `from`, replacing any earlier offer of theirs.
function openOffer(s, from, to, deal, events) {
  for (const o of s.offers) if (o.from === from) events.push({ t: 'withdraw', id: o.id });
  s.offers = s.offers.filter((o) => o.from !== from);
  const offer = { id: s.nextOffer++, from, to, give: deal.give, want: deal.want, answers: {} };
  s.offers.push(offer);
  events.push({ t: 'offer', offer: copy(offer) });
}

const findOffer = (s, id) => s.offers.find((o) => o.id === id);
const addressed = (o, p) => o.from !== p && (o.to === 'all' || o.to === p);

// a gives `give` to b and gets `want` back.
function swap(s, a, b, give, want, events) {
  move(s.players[a].hand, s.players[b].hand, give);
  move(s.players[b].hand, s.players[a].hand, want);
  events.push({ t: 'trade', a, b, give, want });
}

function setupBuild(s, p, kind, at, events) {
  if (p !== s.current) return 'not-your-turn';
  if (kind !== s.setup.need) return 'phase';
  if (!spotOk(s, p, kind, at)) return 'spot';
  place(s, p, kind, at);
  events.push({ t: 'setup', p, kind, at });
  if (kind === 'settlement') {
    // The second settlement collects a card from each tile round it.
    if (s.setup.step >= s.players.length) {
      const cards = {};
      for (const t of geoOf(s).corners[at].tiles) {
        const res = s.island.tiles[t].res;
        if (isRes(res) && s.bank[res] > (cards[res] || 0)) cards[res] = (cards[res] || 0) + 1;
      }
      const gain = tidy(cards);
      if (count(gain)) {
        move(s.bank, s.players[p].hand, gain);
        events.push({ t: 'gain', p, cards: gain, why: 'setup' });
      }
    }
    s.setup.need = 'road';
    s.setup.last = at;
  } else {
    s.setup.step += 1;
    s.setup.need = 'settlement';
    s.setup.last = null;
  }
  updateRoad(s, events);
  if (kind === 'road') {
    if (s.setup.step < s.setup.order.length) s.current = s.setup.order[s.setup.step];
    else {
      s.setup = null;
      startTurn(s, 0, events);
    }
  }
  return null;
}

const ACTIONS = {
  roll(s, p, a, events) {
    const no = yours(s, p, 'roll');
    if (no) return no;
    const dice = [1 + Math.floor(rand(s) * 6), 1 + Math.floor(rand(s) * 6)];
    const sum = dice[0] + dice[1];
    s.dice = dice;
    s.rolled = true;
    events.push({ t: 'roll', p, dice: [...dice], sum });
    if (sum !== 7) {
      produce(s, sum, events);
      s.phase = 'main';
      return null;
    }
    // A 7: everyone over 7 cards gives back half, all at once, then the robber moves.
    const owe = {};
    s.players.forEach((pl, i) => {
      const n = total(pl.hand);
      if (n > 7) owe[i] = Math.floor(n / 2);
    });
    s.after = 'main';
    if (Object.keys(owe).length) {
      s.discard = owe;
      s.phase = 'discard';
    } else s.phase = 'robber';
    return null;
  },

  discard(s, p, a, events) {
    if (s.phase !== 'discard') return 'phase';
    const owe = s.discard[p];
    if (!owe) return 'not-your-turn';
    const cards = cleanCards(a.cards);
    if (!cards) return 'action';
    if (count(cards) !== owe || !holds(s.players[p].hand, cards)) return 'hand';
    move(s.players[p].hand, s.bank, cards);
    delete s.discard[p];
    events.push({ t: 'discard', p, n: owe, cards });
    if (!Object.keys(s.discard).length) {
      s.discard = null;
      s.phase = 'robber';
    }
    return null;
  },

  robber(s, p, a, events) {
    const no = yours(s, p, 'robber');
    if (no) return no;
    const tile = a.tile;
    if (!Number.isInteger(tile) || tile < 0 || tile >= s.island.tiles.length || tile === s.robber) return 'tile';
    s.robber = tile;
    events.push({ t: 'robber', p, tile });
    const who = victims(s, p, tile);
    if (who.length > 1) {
      s.steal = who;
      s.phase = 'steal';
      return null;
    }
    if (who.length === 1) takeCard(s, who[0], p, events);
    back(s);
    return null;
  },

  steal(s, p, a, events) {
    const no = yours(s, p, 'steal');
    if (no) return no;
    if (!s.steal.includes(a.victim)) return 'victim';
    takeCard(s, a.victim, p, events);
    back(s);
    return null;
  },

  build(s, p, a, events) {
    const { kind, at } = a;
    if (!BUILDS.includes(kind) || !Number.isInteger(at)) return 'action';
    if (s.phase === 'setup') return setupBuild(s, p, kind, at, events);
    const free = s.phase === 'roads';
    if (s.phase === 'main' || free) {
      if (p !== s.current) return 'not-your-turn';
      if (free && kind !== 'road') return 'phase';
    } else if (s.phase === 'sbp') {
      if (p === s.current || s.sbp.done.includes(p)) return 'not-your-turn';
    } else return p === s.current ? 'phase' : 'not-your-turn';
    if (piecesLeft(s, p)[kind] <= 0) return 'pieces';
    if (!free && !canAfford(s, p, kind)) return 'cost';
    if (!spotOk(s, p, kind, at)) return 'spot';
    if (!free) move(s.players[p].hand, s.bank, COST[kind]);
    place(s, p, kind, at);
    events.push({ t: 'build', p, kind, at });
    if (kind !== 'city') updateRoad(s, events);
    if (free) {
      s.free -= 1;
      if (s.free <= 0 || piecesLeft(s, p).road <= 0 || !legalSpots(s, p, 'road').length) {
        s.free = 0;
        back(s);
      }
    }
    return null;
  },

  buy(s, p, a, events) {
    if (s.phase === 'sbp') {
      if (p === s.current || s.sbp.done.includes(p)) return 'not-your-turn';
    } else {
      const no = yours(s, p, 'main');
      if (no) return no;
    }
    if (!s.deck.length) return 'deck';
    if (!canAfford(s, p, 'dev')) return 'cost';
    move(s.players[p].hand, s.bank, COST.dev);
    const kind = s.deck.pop();
    s.players[p].dev.push({ kind, turn: s.turn });
    events.push({ t: 'buy', p, kind });
    return null;
  },

  play(s, p, a, events) {
    const no = yours(s, p, 'roll', 'main');
    if (no) return no;
    const pl = s.players[p];
    const card = a.card;
    if (!PLAYABLE.includes(card) || pl.played) return 'card';
    // Never a card bought this turn.
    const i = pl.dev.findIndex((d) => d.kind === card && d.turn !== s.turn);
    if (i < 0) return 'card';
    let res;
    if (card === 'harvest') {
      if (!Array.isArray(a.res) || a.res.length !== 2 || !a.res.every(isRes)) return 'action';
      res = [...a.res];
      const want = {};
      for (const r of res) want[r] = (want[r] || 0) + 1;
      if (!holds(s.bank, want)) return 'bank';
    } else if (card === 'tribute') {
      if (!isRes(a.res)) return 'action';
      res = a.res;
    } else if (card === 'roads') {
      if (piecesLeft(s, p).road <= 0) return 'pieces';
      if (!legalSpots(s, p, 'road').length) return 'spot';
    }
    pl.dev.splice(i, 1);
    pl.played = true;
    events.push(res === undefined ? { t: 'play', p, card } : { t: 'play', p, card, res });
    if (card === 'knight') {
      pl.knights += 1;
      updateArmy(s, p, events);
      s.after = s.rolled ? 'main' : 'roll';
      s.phase = 'robber';
    } else if (card === 'roads') {
      s.free = Math.min(2, piecesLeft(s, p).road);
      s.after = s.rolled ? 'main' : 'roll';
      s.phase = 'roads';
    } else if (card === 'harvest') {
      for (const r of res) {
        s.bank[r] -= 1;
        pl.hand[r] += 1;
      }
      events.push({ t: 'harvest', p, res: [...res] });
    } else {
      const from = [];
      s.players.forEach((o, q) => {
        if (q === p || !o.hand[res]) return;
        from.push({ p: q, n: o.hand[res] });
        pl.hand[res] += o.hand[res];
        o.hand[res] = 0;
      });
      events.push({ t: 'tribute', p, res, from });
    }
    return null;
  },

  bank(s, p, a, events) {
    const no = yours(s, p, 'main');
    if (no) return no;
    const deal = cleanDeal(a.give, a.want);
    if (typeof deal === 'string') return deal;
    let pays = 0;
    for (const [r, n] of Object.entries(deal.give)) {
      const rate = rateOf(s, p, r);
      if (n % rate) return 'rate';
      pays += n / rate;
    }
    if (pays !== count(deal.want)) return 'rate';
    if (!holds(s.players[p].hand, deal.give)) return 'hand';
    if (!holds(s.bank, deal.want)) return 'bank';
    move(s.players[p].hand, s.bank, deal.give);
    move(s.bank, s.players[p].hand, deal.want);
    events.push({ t: 'bank', p, give: deal.give, want: deal.want });
    return null;
  },

  offer(s, p, a, events) {
    const no = yours(s, p, 'main');
    if (no) return no;
    const to = a.to;
    if (to !== 'all' && !(Number.isInteger(to) && to >= 0 && to < s.players.length && to !== p)) return 'action';
    const deal = cleanDeal(a.give, a.want);
    if (typeof deal === 'string') return deal;
    if (!holds(s.players[p].hand, deal.give)) return 'hand';
    openOffer(s, p, to, deal, events);
    return null;
  },

  answer(s, p, a, events) {
    if (s.phase !== 'main') return 'phase';
    const o = findOffer(s, a.id);
    if (!o || !addressed(o, p)) return 'offer';
    const yes = a.yes === true;
    if (o.to === p && yes) {
      // An offer to one player trades the moment they accept, with both hands checked now.
      if (!holds(s.players[o.from].hand, o.give) || !holds(s.players[p].hand, o.want)) return 'hand';
      s.offers = s.offers.filter((x) => x !== o);
      events.push({ t: 'answer', id: o.id, p, yes });
      swap(s, o.from, p, o.give, o.want, events);
      return null;
    }
    if (yes && !holds(s.players[p].hand, o.want)) return 'hand';
    o.answers[p] = yes ? 'yes' : 'no';
    events.push({ t: 'answer', id: o.id, p, yes });
    return null;
  },

  trade(s, p, a, events) {
    if (s.phase !== 'main') return 'phase';
    const o = findOffer(s, a.id);
    const q = a.with;
    if (!o || o.from !== p || !Number.isInteger(q) || o.answers[q] !== 'yes') return 'offer';
    if (!holds(s.players[p].hand, o.give) || !holds(s.players[q].hand, o.want)) return 'hand';
    s.offers = s.offers.filter((x) => x !== o);
    swap(s, p, q, o.give, o.want, events);
    return null;
  },

  counter(s, p, a, events) {
    if (s.phase !== 'main') return 'phase';
    const o = findOffer(s, a.id);
    if (!o || !addressed(o, p)) return 'offer';
    const deal = cleanDeal(a.give, a.want);
    if (typeof deal === 'string') return deal;
    if (!holds(s.players[p].hand, deal.give)) return 'hand';
    o.answers[p] = 'no';
    events.push({ t: 'answer', id: o.id, p, yes: false });
    openOffer(s, p, o.from, deal, events);
    return null;
  },

  withdraw(s, p, a, events) {
    const o = findOffer(s, a.id);
    if (!o || o.from !== p) return 'offer';
    s.offers = s.offers.filter((x) => x !== o);
    events.push({ t: 'withdraw', id: o.id });
    return null;
  },

  end(s, p, a, events) {
    const no = yours(s, p, 'main');
    if (no) return no;
    s.offers = [];
    if (s.players.length >= 5) {
      // Five or six players: the others may build and buy before the next turn.
      s.phase = 'sbp';
      s.sbp = { done: [] };
      events.push({ t: 'sbp' });
      return null;
    }
    startTurn(s, (p + 1) % s.players.length, events);
    return null;
  },

  pass(s, p, a, events) {
    if (s.phase !== 'sbp') return 'phase';
    if (p === s.current || s.sbp.done.includes(p)) return 'not-your-turn';
    s.sbp.done.push(p);
    events.push({ t: 'pass', p });
    if (s.sbp.done.length >= s.players.length - 1) startTurn(s, (s.current + 1) % s.players.length, events);
    return null;
  },
};

/* ---------- What each seat sees ---------- */

/**
 * The same events with the secrets stripped for seat p (null: the table, which sees none): what a
 * steal took (only thief and victim), what a card bought was (only the buyer), and which cards a
 * discard gave back (only the discarder; everyone sees how many).
 */
export function eventsFor(events, p) {
  const seat = Number.isInteger(p) ? p : null;
  return events.map((e) => {
    if (e.t === 'steal' && (seat === null || (seat !== e.from && seat !== e.to))) {
      const { res, ...rest } = e;
      return rest;
    }
    if ((e.t === 'buy' || e.t === 'discard') && (seat === null || seat !== e.p)) {
      const { kind, cards, ...rest } = e;
      return rest;
    }
    return e;
  });
}

/**
 * What seat p may see (null: the table, which holds no hand at all). Everything public, with the
 * state's own field names, so legalSpots, canAfford, rateOf, longestRoad, points, autoAction and
 * waitingOn work on it too. Each player: name, color, mark, cards (how many), devs (how many),
 * knights, played, road (longest), points (without hidden victory points), pieces left; and for p
 * itself hand, dev ([{ kind, fresh }]) and its full points. At the end every hand and card shows.
 */
export function view(state, p) {
  const s = state;
  const me = Number.isInteger(p) && p >= 0 && p < s.players.length ? p : null;
  const over = s.phase === 'over';
  const out = {
    v: s.v,
    me,
    target: s.target,
    island: s.island,
    robber: s.robber,
    roads: s.roads,
    buildings: s.buildings,
    bank: s.bank,
    deck: s.deck.length,
    awards: s.awards,
    current: s.current,
    turn: s.turn,
    phase: s.phase,
    setup: s.setup,
    rolled: s.rolled,
    dice: s.dice,
    discard: s.discard,
    steal: s.steal,
    free: s.free,
    after: s.after,
    offers: s.offers,
    sbp: s.sbp,
    winner: s.winner,
    players: s.players.map((pl, i) => {
      const open = over || i === me;
      const seat = {
        name: pl.name,
        color: pl.color,
        mark: pl.mark,
        cards: total(pl.hand),
        devs: pl.dev.length,
        knights: pl.knights,
        played: pl.played,
        road: longestRoad(s, i),
        points: points(s, i, { hidden: open }),
        pieces: piecesLeft(s, i),
      };
      if (open) {
        seat.hand = { ...pl.hand };
        seat.dev = pl.dev.map((d) => ({ kind: d.kind, fresh: d.turn === s.turn }));
      }
      return seat;
    }),
    log: eventsFor(s.log.slice(-VIEW_LOG), me),
  };
  return copy(out);
}

/** Who the game is waiting for now. Answering an offer never holds the game up. */
export function waitingOn(g) {
  if (g.phase === 'over') return [];
  if (g.phase === 'discard') return Object.keys(g.discard || {}).map(Number).sort((a, b) => a - b);
  if (g.phase === 'sbp') return g.players.map((_, i) => i).filter((i) => i !== g.current && !g.sbp.done.includes(i));
  return [g.current];
}

/**
 * A sensible, legal and minimal action for p now, or null when p has nothing to do: for a timeout
 * or a player who has gone. Deterministic, and it never draws from the game's randomness. Works on
 * a state, and on a view for its own seat.
 */
export function autoAction(g, p) {
  const now = p === g.current;
  switch (g.phase) {
    case 'setup':
      if (!now) return null;
      if (g.setup.need === 'settlement') return { type: 'build', kind: 'settlement', at: bestCorner(g, p) };
      return { type: 'build', kind: 'road', at: legalSpots(g, p, 'road')[0] };
    case 'roll':
      return now ? { type: 'roll' } : null;
    case 'discard': {
      const n = g.discard?.[p];
      const hand = g.players[p]?.hand;
      return n && hand ? { type: 'discard', cards: fromLargest(hand, n) } : null;
    }
    case 'robber':
      return now ? { type: 'robber', tile: robberTile(g, p) } : null;
    case 'steal':
      return now ? { type: 'steal', victim: g.steal[0] } : null;
    case 'roads':
      return now ? { type: 'build', kind: 'road', at: legalSpots(g, p, 'road')[0] } : null;
    case 'main': {
      if (now) return { type: 'end' };
      const o = g.offers.find((x) => addressed(x, p) && !x.answers[p]);
      return o ? { type: 'answer', id: o.id, yes: false } : null;
    }
    case 'sbp':
      return !now && !g.sbp.done.includes(p) ? { type: 'pass' } : null;
    default:
      return null;
  }
}

// The legal corner touching the best numbers (then the most kinds of resource).
function bestCorner(g, p) {
  const geo = geoOf(g);
  let best;
  let bestScore = -Infinity;
  for (const id of legalSpots(g, p, 'settlement')) {
    const tiles = geo.corners[id].tiles.map((t) => g.island.tiles[t]);
    const kinds = new Set(tiles.filter((t) => isRes(t.res)).map((t) => t.res)).size;
    const score = tiles.reduce((n, t) => n + pips(t.num), 0) * 10 + kinds;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// n cards, one at a time from the biggest pile.
function fromLargest(hand, n) {
  const left = { ...hand };
  const out = {};
  for (let k = 0; k < n; k++) {
    let pick = null;
    for (const r of RES) if (left[r] > 0 && (pick === null || left[r] > left[pick])) pick = r;
    if (pick === null) break;
    left[pick] -= 1;
    out[pick] = (out[pick] || 0) + 1;
  }
  return tidy(out);
}

// A tile touching none of p's buildings, where the others' buildings (with cards to steal) and
// numbers count most.
function robberTile(g, p) {
  const geo = geoOf(g);
  let best = -1;
  let bestScore = -Infinity;
  g.island.tiles.forEach((t, i) => {
    if (i === g.robber) return;
    let score = pips(t.num);
    for (const c of geo.tiles[i].corners) {
      const b = g.buildings[c];
      if (!b) continue;
      if (b.p === p) score -= 1000;
      else score += (b.kind === 'city' ? 2 : 1) * (cardsHeld(g, b.p) > 0 ? 60 : 20);
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
