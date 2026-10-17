// Ktan's island: hex geometry and the layouts. DOM-free. Tiles are pointy-top hexes in axial
// coordinates (q, r). Corner and edge ids depend only on which tiles there are, so the engine, the
// renderer and every phone number them the same way (KTAN.md, B6). A layout is plain JSON:
// { size, tiles: [{ q, r, res, num }], harbours: [{ q, r, e, type }] }.

export const RES = ['wood', 'brick', 'wool', 'grain', 'ore'];
export const S3 = Math.sqrt(3);

/**
 * Pointy-top hexes, axial (q, r). A tile's corner radius is 1 (R). Corner i of a tile sits at
 * angle (-90 + 60 i) degrees from its centre: 0 at the top, then clockwise on screen (1 upper
 * right, 2 lower right, 3 bottom, 4 lower left, 5 upper left). Edge e of a tile runs from corner e
 * to corner (e + 1) % 6, and DIRS[e] is the neighbour across it.
 */
export const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];

/** A tile's centre in island units, y down. */
export function axial(q, r) {
  return [S3 * (q + r / 2), 1.5 * r];
}

/** Where corner i of a tile sits from its centre: [cos, sin] of (-90 + 60 i) degrees. */
export function cornerAt(i) {
  const a = ((-90 + 60 * i) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

const cache = new Map();

/**
 * The island's corners and edges, with every adjacency the rules need, worked out once per set of
 * tiles (every island of one shape shares it). Corners are numbered by position, top row first
 * and left to right; edges by their corners. Treat the result as read-only: it is shared.
 *   tiles:   [{ q, r, x, y, corners: [6 ids by corner index], edges: [6 ids by edge index], next: [6 tiles or -1] }]
 *   corners: [{ x, y, tiles, edges, corners }]
 *   edges:   [{ a, b, x, y, tiles, coast }]   (a < b; x, y the midpoint)
 *   coast:   edge ids with one land tile, round the island clockwise from the top
 */
export function geometry(tiles) {
  const key = tiles.map((t) => `${t.q},${t.r}`).join(' ');
  let geo = cache.get(key);
  if (!geo) {
    geo = buildGeometry(tiles);
    cache.set(key, geo);
  }
  return geo;
}

function buildGeometry(list) {
  // Neighbouring tiles compute a shared corner from different centres, so positions merge on a
  // 1e-3 grid; the position kept is the first tile's, exactly as the renderer works it out.
  const grid = (v) => Math.round(v * 1000);
  const spots = new Map();
  const tileKeys = list.map(({ q, r }) => {
    const [cx, cy] = axial(q, r);
    const keys = [];
    for (let i = 0; i < 6; i++) {
      const [dx, dy] = cornerAt(i);
      const x = cx + dx;
      const y = cy + dy;
      const k = `${grid(x)},${grid(y)}`;
      if (!spots.has(k)) spots.set(k, { x, y, gx: grid(x), gy: grid(y) });
      keys.push(k);
    }
    return keys;
  });
  const order = [...spots.keys()].sort((a, b) => spots.get(a).gy - spots.get(b).gy || spots.get(a).gx - spots.get(b).gx);
  const cornerId = new Map(order.map((k, i) => [k, i]));
  const corners = order.map((k) => ({ x: spots.get(k).x, y: spots.get(k).y, tiles: [], edges: [], corners: [] }));
  const tileCorners = tileKeys.map((keys) => keys.map((k) => cornerId.get(k)));

  const pairs = new Map();
  for (const cs of tileCorners) {
    for (let e = 0; e < 6; e++) {
      const a = Math.min(cs[e], cs[(e + 1) % 6]);
      const b = Math.max(cs[e], cs[(e + 1) % 6]);
      pairs.set(`${a},${b}`, [a, b]);
    }
  }
  const sorted = [...pairs.values()].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const edgeId = new Map(sorted.map(([a, b], i) => [`${a},${b}`, i]));
  const edges = sorted.map(([a, b]) => ({
    a,
    b,
    x: (corners[a].x + corners[b].x) / 2,
    y: (corners[a].y + corners[b].y) / 2,
    tiles: [],
    coast: false,
  }));

  const at = new Map(list.map((t, i) => [`${t.q},${t.r}`, i]));
  const tiles = list.map(({ q, r }, t) => {
    const [x, y] = axial(q, r);
    const cs = tileCorners[t];
    const es = cs.map((c, e) => {
      const d = cs[(e + 1) % 6];
      return edgeId.get(`${Math.min(c, d)},${Math.max(c, d)}`);
    });
    for (const c of cs) corners[c].tiles.push(t);
    for (const e of es) edges[e].tiles.push(t);
    const next = DIRS.map(([dq, dr]) => at.get(`${q + dq},${r + dr}`) ?? -1);
    return { q, r, x, y, corners: cs, edges: es, next };
  });

  edges.forEach((e, id) => {
    e.coast = e.tiles.length === 1;
    corners[e.a].edges.push(id);
    corners[e.b].edges.push(id);
    corners[e.a].corners.push(e.b);
    corners[e.b].corners.push(e.a);
  });
  for (const c of corners) c.corners.sort((a, b) => a - b);

  // Round the island by the angle of each coast edge's midpoint from the island's centre,
  // starting at the top and going clockwise on screen, so neighbours in the list share a corner.
  const cx = tiles.reduce((n, t) => n + t.x, 0) / (tiles.length || 1);
  const cy = tiles.reduce((n, t) => n + t.y, 0) / (tiles.length || 1);
  const turn = (e) => (Math.atan2(e.y - cy, e.x - cx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
  const coast = edges
    .map((e, id) => id)
    .filter((id) => edges[id].coast)
    .sort((a, b) => turn(edges[a]) - turn(edges[b]) || a - b);

  return { tiles, corners, edges, coast };
}

/** The index of the tile at (q, r), or -1. */
export function tileIndex(geo, q, r) {
  return geo.tiles.findIndex((t) => t.q === q && t.r === r);
}

/** The two corners a harbour { q, r, e } serves: corners e and e + 1 of its tile. */
export function harbourCorners(geo, h) {
  const t = geo.tiles[tileIndex(geo, h.q, h.r)];
  return [t.corners[h.e], t.corners[(h.e + 1) % 6]];
}

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};

/** The fixed island for a first game (3 to 4 players). */
export const STARTER = deepFreeze({
  size: 'base',
  tiles: [
    [0, -2, 'ore', 10], [1, -2, 'wool', 2], [2, -2, 'wood', 9], [-1, -1, 'grain', 12], [0, -1, 'brick', 6],
    [1, -1, 'wool', 4], [2, -1, 'brick', 10], [-2, 0, 'grain', 9], [-1, 0, 'wood', 11], [0, 0, 'desert', 0],
    [1, 0, 'wood', 3], [2, 0, 'ore', 8], [-2, 1, 'wood', 8], [-1, 1, 'ore', 3], [0, 1, 'grain', 4],
    [1, 1, 'wool', 5], [-2, 2, 'brick', 5], [-1, 2, 'grain', 6], [0, 2, 'wool', 11],
  ].map(([q, r, res, num]) => ({ q, r, res, num })),
  harbours: [
    [-2, 0, 5, 'any'], [0, -2, 4, 'wool'], [1, -2, 0, 'any'], [2, -2, 1, 'ore'], [2, 0, 0, 'grain'],
    [1, 1, 2, 'any'], [0, 2, 3, 'brick'], [-2, 2, 2, 'wood'], [-2, 1, 4, 'any'],
  ].map(([q, r, e, type]) => ({ q, r, e, type })),
});

// Rows of the big island (5 to 6 players), top to bottom: r and its first and last q. Every row
// is centred on the same x.
const BIG_ROWS = [[-3, 0, 2], [-2, -1, 2], [-1, -2, 2], [0, -3, 2], [1, -3, 1], [2, -3, 0], [3, -3, -1]];

/** The land tiles of an island: 'base' (19, for 3 to 4 players) or 'big' (30, for 5 to 6). */
export function islandShape(size = 'base') {
  const out = [];
  if (size === 'base') {
    for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) if (Math.abs(q + r) <= 2) out.push({ q, r });
  } else if (size === 'big') {
    for (const [r, from, to] of BIG_ROWS) for (let q = from; q <= to; q++) out.push({ q, r });
  } else {
    throw new Error(`Unknown island size "${size}"`);
  }
  return out;
}

// What goes on each island: terrain, number tokens and harbour types.
const BAGS = {
  base: {
    terrain: { wood: 4, wool: 4, grain: 4, brick: 3, ore: 3, desert: 1 },
    numbers: { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 },
    harbours: { any: 4, wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 },
    pairs: 1, // same-terrain neighbours a layout may keep
  },
  big: {
    terrain: { wood: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 },
    numbers: { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 },
    harbours: { any: 5, wool: 2, wood: 1, brick: 1, grain: 1, ore: 1 },
    pairs: 2,
  },
};

const TRIES = 400;

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

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const unpack = (bag) => Object.entries(bag).flatMap(([k, n]) => Array(n).fill(k));
const isRed = (n) => n === 6 || n === 8;

/**
 * An island: the starter layout (base only), or one generated from the seed, with its own
 * mulberry32 so a seed always gives the same island. Generated terrain avoids clumps, no 6 or 8
 * touches another 6 or 8, equal numbers rarely touch, and harbours are spread round the coast.
 */
export function makeIsland({ size = 'base', seed = 1, starter = false } = {}) {
  if (starter && size === 'base') return structuredClone(STARTER);
  const bag = BAGS[size];
  if (!bag) throw new Error(`Unknown island size "${size}"`);
  const rng = mulberry32(seed);
  const shape = islandShape(size);
  const geo = geometry(shape);
  const terrain = placeTerrain(geo, unpack(bag.terrain), bag.pairs, rng);
  const numbers = placeNumbers(geo, terrain, unpack(bag.numbers).map(Number), rng);
  const harbours = placeHarbours(geo, unpack(bag.harbours), rng);
  return {
    size,
    tiles: shape.map(({ q, r }, i) => ({ q, r, res: terrain[i], num: numbers[i] })),
    harbours,
  };
}

// Same-terrain clumps: three tiles round one corner weigh far more than a pair along an edge.
function clumps(geo, terrain) {
  let score = 0;
  for (const e of geo.edges) if (e.tiles.length === 2 && terrain[e.tiles[0]] === terrain[e.tiles[1]]) score += 1;
  for (const c of geo.corners) {
    const [a, b, d] = c.tiles;
    if (c.tiles.length === 3 && terrain[a] === terrain[b] && terrain[b] === terrain[d]) score += 100;
  }
  return score;
}

// A shuffle, then swaps of two tiles kept while they don't make it clumpier, until it is spread
// enough or the tries run out.
function placeTerrain(geo, bag, pairs, rng) {
  const terrain = shuffle(bag.slice(), rng);
  let score = clumps(geo, terrain);
  for (let i = 0; i < TRIES && score > pairs; i++) {
    const a = Math.floor(rng() * terrain.length);
    const b = Math.floor(rng() * terrain.length);
    if (terrain[a] === terrain[b]) continue;
    [terrain[a], terrain[b]] = [terrain[b], terrain[a]];
    const next = clumps(geo, terrain);
    if (next <= score) score = next;
    else [terrain[a], terrain[b]] = [terrain[b], terrain[a]];
  }
  return terrain;
}

const touching = (geo, a, b) => geo.tiles[a].next.includes(b);

function equalNeighbours(geo, nums) {
  let n = 0;
  for (const e of geo.edges) if (e.tiles.length === 2 && nums[e.tiles[0]] && nums[e.tiles[0]] === nums[e.tiles[1]]) n++;
  return n;
}

function placeNumbers(geo, terrain, bag, rng) {
  const land = terrain.flatMap((t, i) => (t === 'desert' ? [] : [i]));
  const reds = bag.filter(isRed);
  const rest = bag.filter((n) => !isRed(n));
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < TRIES && bestScore > 0; i++) {
    // The 6s and 8s go first, each away from the others; the rest fill in round them.
    const order = shuffle(land.slice(), rng);
    const redAt = [];
    for (const t of order) {
      if (redAt.length === reds.length) break;
      if (!redAt.some((u) => touching(geo, t, u))) redAt.push(t);
    }
    if (redAt.length < reds.length) continue;
    const nums = terrain.map(() => 0);
    shuffle(reds.slice(), rng).forEach((n, k) => (nums[redAt[k]] = n));
    const others = order.filter((t) => !redAt.includes(t));
    shuffle(rest.slice(), rng).forEach((n, k) => (nums[others[k]] = n));
    const score = equalNeighbours(geo, nums);
    if (score < bestScore) {
      best = nums;
      bestScore = score;
    }
  }
  return best || numbersByColour(geo, terrain, reds, rest);
}

// Never needed in practice, but it keeps the 6/8 rule unconditional: tiles with the same
// (q - r) mod 3 never touch, and the largest such class always has room for every 6 and 8.
function numbersByColour(geo, terrain, reds, rest) {
  const land = terrain.flatMap((t, i) => (t === 'desert' ? [] : [i]));
  const classes = [0, 1, 2].map((k) => land.filter((i) => (((geo.tiles[i].q - geo.tiles[i].r) % 3) + 3) % 3 === k));
  const roomy = classes.sort((a, b) => b.length - a.length)[0];
  const nums = terrain.map(() => 0);
  reds.forEach((n, k) => (nums[roomy[k]] = n));
  const others = land.filter((i) => !roomy.slice(0, reds.length).includes(i));
  rest.forEach((n, k) => (nums[others[k]] = n));
  return nums;
}

function placeHarbours(geo, types, rng) {
  const coast = geo.coast;
  const n = types.length;
  const start = Math.floor(rng() * coast.length);
  const used = new Set();
  const picked = [];
  for (let i = 0; i < n; i++) {
    const from = (start + Math.round((i * coast.length) / n)) % coast.length;
    // Evenly round the coast, sliding on past any edge that shares a corner with a harbour.
    for (let j = 0; j < coast.length; j++) {
      const id = coast[(from + j) % coast.length];
      const { a, b } = geo.edges[id];
      if (used.has(a) || used.has(b)) continue;
      used.add(a);
      used.add(b);
      picked.push(id);
      break;
    }
  }
  const kinds = shuffle(types.slice(), rng);
  return picked.map((id, i) => {
    const t = geo.edges[id].tiles[0];
    const { q, r } = geo.tiles[t];
    return { q, r, e: geo.tiles[t].edges.indexOf(id), type: kinds[i] };
  });
}
