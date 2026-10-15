// Generated maps: blocks laid out to suit the enemies that fight on them, at any arena size
// (SCALES in rules.js), the same map for the same seed. The map editor's Generate button uses
// it. No DOM.
//
// The enemies come first: one kind leads, and what it does picks the map's theme (THEMES):
// bank shooters get long walls, minelayers two-wide lanes, mortars and miniguns open ground,
// missiles corners, turrets cover to dig into. The blocks go down one piece at a time (pillars,
// 2 x 2 blocks, bars, Ls, Ts, bays, crate lines, pits). A piece stays only if the map still has
// no more tight spots (mapcheck.js) than the theme allows and every cell can still be reached,
// and pieces keep apart unless the theme lets them join, so blocks read as shapes rather than
// rubble. Then you go on the left, and the enemies where their kind wants to be (turrets with
// cover round them, movers with room), each reachable and with no clear shot at your start.
import { MAX_ENEMIES, checkMap, tightSpots } from './mapcheck.js';
import { ENEMY_KINDS, SCALE, SPAWN_CODES, TYPES, rand, sizeAt } from './rules.js';

const LETTER = Object.fromEntries(Object.entries(SPAWN_CODES).map(([ch, kind]) => [kind, ch]));
const SOLID = '#xo';

/**
 * open: the share of floor to stop at. pieces: how often each piece is picked. bar: bar lengths
 * on a mission-sized map (they grow with the arena). tight: tight spots allowed. join: the
 * chance a piece may touch another. sym: chances of no symmetry, top to bottom, turned 180°.
 * lanes: every bar runs the same way.
 */
export const THEMES = {
  // Pink, Green and their kin: long straight faces to bank shots off.
  banks: { open: [0.78, 0.84], pieces: { bar: 6, L: 3, U: 1, block: 1 }, bar: [4, 8], tight: 1, join: 0.15, sym: [5, 2, 3] },
  // Mortars, miniguns and fast rockets: room to circle and dodge, a few things to break sight.
  open: { open: [0.87, 0.92], pieces: { pillar: 4, block: 4, bar: 2, L: 1, pit: 1 }, bar: [2, 4], tight: 0, join: 0.1, sym: [4, 3, 3] },
  // Missiles and plain shooters: corners and short walls to duck behind, which a missile breaks on.
  corners: { open: [0.8, 0.86], pieces: { L: 5, T: 2, block: 2, crate: 1 }, bar: [3, 5], tight: 1, join: 0.2, sym: [6, 2, 2] },
  // Minelayers: two-wide lanes where a mine counts.
  lanes: { open: [0.76, 0.82], pieces: { bar: 6, L: 2, crate: 1 }, bar: [6, 10], tight: 2, join: 0.15, sym: [4, 3, 3], lanes: true },
  // Turrets: cover to dig into, which you have to work round.
  pockets: { open: [0.82, 0.88], pieces: { block: 3, bar: 2, L: 2, U: 1, crate: 2 }, bar: [3, 5], tight: 1, join: 0.15, sym: [5, 3, 2] },
};

/** The theme a kind's map gets, from what it does, so a new kind gets one too. */
export function themeOf(kind) {
  const T = TYPES[kind];
  if (T.mines > 0) return 'lanes';
  if (T.aim === 'bank') return 'banks';
  if (T.weapon === 'missile') return 'corners';
  if (T.weapon === 'bomb' || T.weapon === 'minigun') return 'open';
  if (!T.speed) return 'pockets';
  if (T.weapon === 'rocket') return 'open';
  return 'corners';
}

/** How many enemies an arena of a scale gets: 2 on the smallest, 3 or 4 on a mission's, 6 on the largest. */
const enemiesAt = (scale, rnd) => Math.min(MAX_ENEMIES, Math.max(2, Math.round(scale * 0.75 - 0.5 + rnd() * 1.5)));

/** A roster: the lead kind (most of them) and a kind or two to back it up, lead first. */
function rosterFor(scale, rnd, lead) {
  const n = enemiesAt(scale, rnd);
  const kinds = [lead];
  const leads = Math.ceil(n * 0.6);
  while (kinds.length < leads) kinds.push(lead);
  const others = ENEMY_KINDS.filter((k) => k !== lead);
  const support = [others[Math.floor(rnd() * others.length)]];
  if (n - leads > 1 && rnd() < 0.5) support.push(others[Math.floor(rnd() * others.length)]);
  while (kinds.length < n) kinds.push(support[(kinds.length - leads) % support.length]);
  return kinds;
}

/** A piece's cells round (0, 0), and what it is made of. */
function piece(kind, rnd, barLen) {
  const n = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const turn = (cells) => {
    let out = cells;
    if (rnd() < 0.5) out = out.map(([c, r]) => [r, c]);
    if (rnd() < 0.5) out = out.map(([c, r]) => [-c, r]);
    if (rnd() < 0.5) out = out.map(([c, r]) => [c, -r]);
    return out;
  };
  const line = (len) => Array.from({ length: len }, (_, i) => [i, 0]);
  switch (kind) {
    case 'pillar':
      return { mat: '#', cells: [[0, 0]] };
    case 'block':
      return { mat: '#', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] };
    case 'bar':
      return { mat: '#', cells: turn(line(n(...barLen))) };
    case 'crate':
      return { mat: 'x', cells: turn(line(n(2, 4))) };
    case 'L': {
      const a = n(2, 4);
      const b = n(2, 4);
      return { mat: '#', cells: turn([...line(a), ...Array.from({ length: b - 1 }, (_, i) => [0, i + 1])]) };
    }
    case 'T': {
      const a = n(1, 2);
      return { mat: '#', cells: turn([...Array.from({ length: a * 2 + 1 }, (_, i) => [i - a, 0]), [0, 1], [0, 2]]) };
    }
    case 'U': {
      // A bay with a mouth 2 or 3 wide.
      const w = n(4, 5);
      const d = n(2, 3);
      const cells = line(w);
      for (let i = 1; i <= d; i++) cells.push([0, i], [w - 1, i]);
      return { mat: '#', cells: turn(cells) };
    }
    default: {
      const w = n(2, 3);
      const h = n(2, 3);
      return { mat: 'o', cells: Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)]) };
    }
  }
}

const openShare = (g) => g.reduce((n, line) => n + line.filter((ch) => !SOLID.includes(ch)).length, 0) / (g.length * g[0].length);

/** Steps from (c, r) to every cell a tank can drive to (crates count: a mine clears them); -1 where it can't. */
function steps(g, c0, r0) {
  const H = g.length;
  const W = g[0].length;
  const d = new Int16Array(W * H).fill(-1);
  d[r0 * W + c0] = 0;
  const queue = [[c0, r0]];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= W || nr >= H || g[nr][nc] === '#' || g[nr][nc] === 'o' || d[nr * W + nc] >= 0) continue;
      d[nr * W + nc] = d[r * W + c] + 1;
      queue.push([nc, nr]);
    }
  }
  return d;
}

/** Whether every cell a tank could stand on can be driven to from (c, r). */
function connected(g, c, r) {
  const d = steps(g, c, r);
  const W = g[0].length;
  return g.every((line, y) => line.every((ch, x) => ch === '#' || ch === 'o' || d[y * W + x] >= 0));
}

const rowsOf = (g) => g.map((line) => line.join(''));

/**
 * The blocks of a map: pieces placed until the floor is down to the theme's share, keeping the
 * cells round your start clear.
 */
function lay(g, theme, rnd, sym, start) {
  const H = g.length;
  const W = g[0].length;
  const grow = W / 20;
  const barLen = theme.bar.map((v) => Math.max(2, Math.round(v * grow)));
  const target = theme.open[0] + rnd() * (theme.open[1] - theme.open[0]);
  const keep = (c, r) => Math.abs(c - start[0]) <= 1 && Math.abs(r - start[1]) <= 1;
  const twin = (c, r) => (sym === 'mirror' ? [c, H - 1 - r] : [W - 1 - c, H - 1 - r]);
  const total = Object.values(theme.pieces).reduce((a, b) => a + b, 0);
  const pick = () => {
    let x = rnd() * total;
    for (const [kind, w] of Object.entries(theme.pieces)) if ((x -= w) < 0) return kind;
    return 'pillar';
  };
  let lanes = null; // with theme.lanes: 'h' or 'v', the way every bar runs
  const tries = Math.round((400 * W * H) / 300);
  for (let k = 0; k < tries && openShare(g) > target; k++) {
    const kind = pick();
    const p = piece(kind, rnd, barLen);
    if (theme.lanes && kind === 'bar') {
      lanes ??= rnd() < 0.5 ? 'h' : 'v';
      if ((lanes === 'h') !== p.cells.every(([, r]) => r === p.cells[0][1])) p.cells = p.cells.map(([c, r]) => [r, c]);
    }
    const ac = Math.floor(rnd() * W);
    const ar = Math.floor(rnd() * H);
    let cells = p.cells.map(([c, r]) => [c + ac, r + ar]);
    if (sym !== 'none') cells = [...cells, ...cells.map(([c, r]) => twin(c, r))];
    if (cells.some(([c, r]) => c < 0 || r < 0 || c >= W || r >= H || keep(c, r) || g[r][c] !== '.')) continue;
    const own = new Set(cells.map(([c, r]) => r * W + c));
    const touches = cells.some(([c, r]) =>
      [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(
        ([dc, dr]) => !own.has((r + dr) * W + c + dc) && SOLID.includes(g[r + dr]?.[c + dc] ?? '.'),
      ),
    );
    if (touches && rnd() > theme.join) continue;
    for (const [c, r] of cells) g[r][c] = p.mat;
    if (tightSpots(rowsOf(g)).spots > theme.tight || !connected(g, start[0], start[1])) {
      for (const [c, r] of cells) g[r][c] = '.';
    }
  }
}

/**
 * Puts the enemies down: on the far half, far from you along the way, apart from each other,
 * turrets where there is cover round them and movers where there is room, and each where it
 * is reachable and has no clear shot at your start. Returns how many it placed.
 */
function deploy(g, kinds, rnd, start) {
  const H = g.length;
  const W = g[0].length;
  const d = steps(g, start[0], start[1]);
  const placed = [];
  const withYou = () => {
    const rows = rowsOf(g);
    rows[start[1]] = rows[start[1]].slice(0, start[0]) + '@' + rows[start[1]].slice(start[0] + 1);
    return rows;
  };
  for (const kind of kinds) {
    const turret = !TYPES[kind].speed;
    const spots = [];
    for (let r = 0; r < H; r++) {
      for (let c = Math.floor(W / 2); c < W; c++) {
        if (g[r][c] !== '.' || d[r * W + c] < W * 0.55) continue;
        if (placed.some(([pc, pr]) => Math.max(Math.abs(pc - c), Math.abs(pr - r)) < 3)) continue;
        let cover = 0;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (SOLID.includes(g[r + dr]?.[c + dc] ?? '.')) cover++;
        const edge = c === W - 1 || r === 0 || r === H - 1 ? 3 : 0;
        spots.push({ c, r, score: (turret ? cover - edge : 6 - Math.abs(cover - 4)) + rnd() * 4 });
      }
    }
    spots.sort((a, b) => b.score - a.score);
    const spot = spots.slice(0, 12).find(({ c, r }) => {
      g[r][c] = LETTER[kind];
      if (!checkMap(withYou()).errors.length) return true;
      g[r][c] = '.';
      return false;
    });
    if (spot) placed.push([spot.c, spot.r]);
  }
  return placed.length;
}

/**
 * A map for an arena of `scale`, from `seed`. lead is the kind most of the enemies are (one at
 * random if not given), and the map suits it. Returns { rows, kinds, lead, theme }: the map,
 * the kinds on it, the lead and its theme. Every map can be played: your tank, enemies that can
 * be reached, none with a clear shot at your start.
 */
export function generateMap({ scale = SCALE, seed = 1, lead = null } = {}) {
  const dice = { seed: seed | 0 };
  const rnd = () => rand(dice);
  lead ??= ENEMY_KINDS[Math.floor(rnd() * ENEMY_KINDS.length)];
  const themeName = themeOf(lead);
  const theme = THEMES[themeName];
  let kinds = rosterFor(scale, rnd, lead);
  const [W, H] = sizeAt(scale);
  const symTotal = theme.sym.reduce((a, b) => a + b, 0);
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    // After a run of failures, one enemy fewer: a small arena can't always fit them all.
    if (attempt && attempt % 10 === 0 && kinds.length > 1) kinds = kinds.slice(0, -1);
    let x = rnd() * symTotal;
    const sym = ['none', 'mirror', 'point'].find((_, i) => (x -= theme.sym[i]) < 0) || 'none';
    const start = [rnd() < 0.5 ? 1 : 2, 1 + Math.floor(rnd() * (H - 2))];
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    lay(g, theme, rnd, sym, start);
    const n = deploy(g, kinds, rnd, start);
    if (n && (!best || n > best.n)) {
      g[start[1]][start[0]] = '@';
      best = { n, rows: rowsOf(g) };
    }
    if (n === kinds.length) break;
  }
  if (!best) {
    // Nowhere would do (it never happens on an open arena): open floor, you on the left, one
    // lead enemy across from you.
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    g[H >> 1][1] = '@';
    g[H >> 1][W - 2] = LETTER[lead];
    best = { rows: rowsOf(g) };
  }
  const on = [...best.rows.join('')].filter((ch) => SPAWN_CODES[ch]).map((ch) => SPAWN_CODES[ch]);
  return { rows: best.rows, kinds: on, lead, theme: themeName };
}
