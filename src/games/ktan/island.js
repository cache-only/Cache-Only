// The island of a game as the board shows it: the scene made from the game's view (art.js: every
// tile planned and painted once, every standing thing a kept sprite per angle), fitted to a box for
// a seat, its projection to the box's px, and what lies under a finger. The pictures are painted
// off the screen here; gl.js lays them on the screen.
//
// Island units are R, a tile's corner radius, as in board.js; the scene is centred on the middle
// of the tiles (art.js islandScene), so a point's scene coordinates are its board.js ones less
// `offset`. A view's phi is the seat it is drawn for (0 the bottom edge, PI / 2 the left, PI the
// top, 3 PI / 2 the right): the ground turns into that seat's frame and its depth foreshortens by K.
import { geometry, harbourCorners } from './board.js';
import * as A from './art.js';

const SLICE_MS = 8; // painting ahead, a few milliseconds at a time, so a frame is never held up

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * island: a view's island ({ size, tiles: [{ q, r, res, num }], harbours: [{ q, r, e, type }] }).
 * sc: px per R that tiles and sprites are painted at (laid smaller where the board is smaller).
 */
export function createIsland(island, { sc }) {
  const geo = geometry(island.tiles);
  const at = island.tiles.map(({ q, r }) => A.axial(q, r));
  const offset = [at.reduce((s, p) => s + p[0], 0) / at.length, at.reduce((s, p) => s + p[1], 0) / at.length];
  const corners = geo.corners.map((c) => [c.x - offset[0], c.y - offset[1]]);
  const tilesAt = at.map(([x, y]) => [x - offset[0], y - offset[1]]);
  let base = null; // { tiles, sea, offset, sc }
  let scene = null;
  let piecesKey = '';
  let hull = null;
  const prewarmed = new Set(); // the angles (rounded) every sprite has been painted for

  /** Paints the tiles one by one and then the sea, letting frames through between them. */
  async function build(onProgress) {
    if (base) return base;
    const tiles = [];
    for (let i = 0; i < island.tiles.length; i++) {
      const { q, r, res, num } = island.tiles[i];
      tiles.push(A.makeTile(q, r, res, num, 1000 + i * 97, sc, tilesAt[i][0], tilesAt[i][1]));
      onProgress?.((i + 1) / (island.tiles.length + 2));
      await later();
    }
    const harbours = (island.harbours || []).map(({ q, r, e, type }) => {
      const [x, y] = A.axial(q, r);
      return { x: x - offset[0], y: y - offset[1], e, type };
    });
    const sea = A.seaOf(tiles, harbours, Math.min(sc, 160));
    base = { tiles, sea, offset, sc };
    onProgress?.(1);
    return base;
  }

  /** Scene coordinates of where the robber stands on tile t, seen from seat phi: behind its number. */
  function robberAt(t, phi) {
    const [x, y] = tilesAt[t];
    if (island.tiles[t].res === 'desert') return [x - Math.sin(phi) * 0.02, y + Math.cos(phi) * 0.02];
    return [x + Math.sin(phi) * 0.36, y - Math.cos(phi) * 0.36];
  }

  /** The pieces of a view as scene items: rebuilt only when something on the board changed. */
  function sceneFor(view, phi, o = {}) {
    if (!base) return null;
    const robber = o.robber === undefined ? view.robber : o.robber;
    const key = JSON.stringify([view.roads, view.buildings, o.extraBuildings || null, o.extraRoads || null, view.players.map((p) => p.color + p.mark), robber, Math.round(phi * 100)]);
    if (scene && key === piecesKey) return scene;
    piecesKey = key;
    const look = (p) => ({ col: view.players[p].color, mark: view.players[p].mark });
    const buildings = [];
    for (const [id, b] of Object.entries(view.buildings || {})) buildings.push({ x: corners[id][0], y: corners[id][1], kind: b.kind, ...look(b.p) });
    for (const b of o.extraBuildings || []) buildings.push({ x: corners[b.at][0], y: corners[b.at][1], kind: b.kind, ...look(b.p) });
    const roads = [];
    for (const [id, p] of [...Object.entries(view.roads || {}), ...(o.extraRoads || []).map((r) => [r.at, r.p])]) {
      const e = geo.edges[id];
      roads.push({ id: +id, a: corners[e.a], b: corners[e.b], col: view.players[p].color, owner: p });
    }
    const extra = [];
    if (robber !== null && robber !== undefined && robber >= 0) {
      const [x, y] = robberAt(robber, phi);
      extra.push({ t: 'robber', x, y, lift: A.SLAB, key: 'robber' });
    }
    scene = A.withPieces(base, buildings, roads, extra);
    return scene;
  }

  // The outline the island is fitted by: the beach, the coast with room above it for what stands
  // there, the jetties' heads and the plaques on them (the design page's Table frame).
  function hullPoints() {
    if (hull || !base) return hull;
    hull = [];
    base.sea.at(A.SEA.beach).forEach(([x, y], i) => { if (i % 4 === 0) hull.push([x, y, 0, 0]); });
    base.sea.ring.forEach(([x, y]) => hull.push([x, y, 0.75, 0]));
    base.sea.items.forEach((it) => {
      if (it.t === 'jetty') hull.push([it.x + it.span[0], it.y + it.span[1], 0.1, 0.22]);
      if (it.t === 'plaque') hull.push([it.x, it.y, 0.52, 0.27]);
    });
    return hull;
  }

  /**
   * The island fitted into a box w x h (px) for seat phi: { S (px per R), cx, cy, phi, table }.
   * table: the picture also turns so that seat's edge is at the bottom of the screen (the iPad);
   * fill: [the share of the width, of the height] it may take.
   */
  function fit(phi, w, h, { table = false, fill = [0.96, 0.95], nudge = 0 } = {}) {
    const pts = hullPoints() || corners.map(([x, y]) => [x, y, 0.6, 0]);
    const v = A.makeView(phi), c = Math.cos(table ? phi : 0), s = Math.sin(table ? phi : 0);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y, hh, ww] of pts) {
      const [px, py] = v.p(x, y);
      for (const [dx, dy] of [[-ww, 0], [ww, 0], [-ww, -hh], [ww, -hh]]) {
        const X = c * (px + dx) - s * (py + dy), Y = s * (px + dx) + c * (py + dy);
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
    }
    const S = Math.min((w * fill[0]) / (x1 - x0), (h * fill[1]) / (y1 - y0));
    return { S, cx: w / 2 - (S * (x0 + x1)) / 2, cy: h / 2 - (S * (y0 + y1)) / 2 + nudge, phi, table, w, h };
  }

  /** A scene point (x, y), raised h, in the fitted box's px. */
  function toScreen(f, x, y, h = A.SLAB) {
    const v = A.makeView(f.phi), [px, py0] = v.p(x, y), py = py0 - h;
    if (!f.table) return [f.cx + f.S * px, f.cy + f.S * py];
    const c = Math.cos(f.phi), s = Math.sin(f.phi);
    return [f.cx + f.S * (c * px - s * py), f.cy + f.S * (s * px + c * py)];
  }

  const cornerPx = (f, id, h = A.SLAB) => toScreen(f, corners[id][0], corners[id][1], h);
  const edgePx = (f, id, h = A.SLAB) => {
    const e = geo.edges[id];
    return [cornerPx(f, e.a, h), cornerPx(f, e.b, h)];
  };
  const tilePx = (f, t, h = A.SLAB + A.TOKEN_E) => toScreen(f, tilesAt[t][0], tilesAt[t][1], h);

  /** The nearest of ids to (px, py), within reach (px): corners, edges (by their middles) or tiles. */
  function nearest(f, kind, ids, px, py, reach) {
    let best = null, bd = reach * reach;
    for (const id of ids) {
      let q;
      if (kind === 'corner') q = cornerPx(f, id);
      else if (kind === 'edge') { const [a, b] = edgePx(f, id); q = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
      else q = tilePx(f, id);
      const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  /** Paints the island into ctx (already scaled to px) for the fit f. */
  function paint(ctx, f, view, o = {}) {
    const sc2 = sceneFor(view, f.phi, o);
    if (!sc2) return false;
    const blocked = view.robber >= 0 && (o.robber === undefined ? view.robber : o.robber) >= 0 ? base.tiles[o.robber === undefined ? view.robber : o.robber] : null;
    A.renderScene(ctx, sc2, f.phi, { cx: f.cx, cy: f.cy, S: f.S, sc: o.sc || sc, table: f.table, lit: o.lit || 0, dim: o.dim ?? (o.lit ? 1 : 0), sea: o.sea !== false, t: o.t ?? 7.3, skip: o.skip, blocked: o.dark === false ? null : blocked });
    return true;
  }

  /**
   * Paints ahead, a slice at a time, every sprite the scene needs at seat phi (and its shadow), at
   * px per R `at` (the island's own by default), so a picture never stalls. Resolves when done.
   */
  async function prewarm(view, phi, at = sc) {
    const k = `${Math.round(phi * 1000)}@${at}`;
    if (prewarmed.has(k)) return;
    const sc2 = sceneFor(view, phi);
    if (!sc2) return;
    const v = A.makeView(phi);
    let t0 = performance.now();
    for (const it of sc2.items) {
      A.spriteFor(it, v, at);
      A.shadowFor(it, v, at);
      if (performance.now() - t0 > SLICE_MS) {
        await later();
        t0 = performance.now();
      }
    }
    prewarmed.add(k);
  }

  return {
    geo, offset, corners, tilesAt, island,
    get base() { return base; },
    get ready() { return !!base; },
    build, sceneFor, fit, toScreen, cornerPx, edgePx, tilePx, nearest, paint, prewarm, robberAt,
    /** The two corners a harbour serves. */
    harbourCornersOf: (h) => harbourCorners(geo, h),
    /** The sprite and shadow of one standing thing (a piece or the robber) as drawn for seat phi. */
    sprite(it, phi) {
      const v = A.makeView(phi);
      return { body: A.spriteFor(it, v, sc), shadow: A.shadowFor(it, v, sc) };
    },
    sc,
  };
}
