// The game on a phone (KTAN.md B3, and the proposals page's "Every phone is the table" and "The
// phone at a table"): the island on top (drawn by island.js, laid on the screen by gl.js), then the
// players' chips, your hand and your development cards, and the moves along the bottom: Build,
// Trade and the next step of your turn, the one primary. Build grows up out of its button into a
// panel that stays open; picking a piece lights where it can go on the board, a tap puts a ghost
// there and Build builds it. Trades, offers, the robber's choices and the rest come as sheets.
// Everything the host sends is a view (rules.js view) and the events that led to it, which play
// out here: the dice shaking in the board's corner, the number popping up, cards flying off the
// tiles into your hand or onto the others' chips.
//
// session: { kind, me, view, act(action, as?), subscribe(fn), ... } (session.js). A game on one
// phone passed round the table (kind 'local') covers the screen between players.
import { t } from '../../shared/i18n.js';
import { closeSheet, confirmDialog, openSheet, setupSheet } from '../../shared/ui.js';
import * as A from './art.js';
import { RES } from './board.js';
import { COST, canAfford, legalSpots, rateOf } from './rules.js';
import { createIsland } from './island.js';
import { createGL, create2D } from './gl.js';
import { createFx, createCornerDice } from './fx.js';
import { createInspect } from './inspect.js';
import { createAudio } from './audio.js';
import { markSvg, iconSvg } from './marks.js';

export const DEV_ORDER = ['knight', 'roads', 'harvest', 'tribute', 'vp'];
const BUILDS = ['road', 'settlement', 'city', 'dev'];
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduce = () => reduceQuery.matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const total = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce() ? Math.min(ms, 60) : ms));
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const button = (cls, text, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

/** A player's mark on their colour, as an element. */
export function markEl(player, size = 26) {
  const m = el('span', 'ktan-mark');
  m.style.setProperty('--c', player.color);
  m.style.setProperty('--mk', A.markInk(player.color));
  m.style.setProperty('--mark', `${size}px`);
  m.innerHTML = markSvg(player.mark);
  m.setAttribute('aria-hidden', 'true');
  return m;
}

/** Card names in the language being read, printed on the cards. */
export function nameCards() {
  A.setCardNames(Object.fromEntries([...RES, ...DEV_ORDER, 'longest', 'army'].map((k) => [k, t(`ktan.card.${k}`)])));
}

export const resName = (res, n = 1) => t(n === 1 ? `ktan.res.${res}` : `ktan.res.${res}.n`);
/** "2 wool and 1 ore". */
export const listCards = (cards) => RES.filter((r) => cards?.[r] > 0).map((r) => `${cards[r]} ${resName(r, cards[r])}`).join(t('ktan.and'));

/** A card painted for the DOM: a canvas w CSS px wide (its count coin hanging off its corner). */
export function cardEl(kind, w, { count, tag, dim = false, small = false, square = false } = {}) {
  const dpr = A.getDPR();
  const h = square ? w : w * 1.4, pad = count !== undefined ? w * 0.1 : 0;
  const c = document.createElement('canvas');
  c.width = Math.round((w + pad) * dpr);
  c.height = Math.round((h + pad) * dpr);
  c.style.width = `${w + pad}px`;
  c.style.height = `${h + pad}px`;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (square) A.drawAwardAt(g, kind, 0, 0, w);
  else A.drawCardAt(g, kind, 0, 0, w, { count, tag, dim, small });
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** A piece in a player's colour, drawn small: road, settlement, city (or a card's back for 'dev'). */
export function pieceEl(kind, w, h, player) {
  const dpr = A.getDPR();
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (kind === 'dev') A.drawCardAt(g, 'back', w / 2 - h * 0.3, h * 0.06, h * 0.6);
  else A.pieceAt(g, kind, w / 2, h * (kind === 'road' ? 0.62 : 0.84), kind === 'road' ? h * 1.25 : kind === 'city' ? h * 1.15 : h * 1.3, player.color, player.mark);
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** The game's screen on this phone. table: this phone sits at a table (an iPad shows the island). */
export function createGame(session, { onLeave, onRoom, table = null } = {}) {
  const dom = {
    screen: $('gameScreen'), boardBox: $('boardBox'), boardCv: $('boardCv'), boardHit: $('boardHit'), dice: $('dice'),
    chips: $('chips'), hand: $('hand'), shelf: $('shelf'), moves: $('moves'), throwBox: $('throw'),
    moveA: $('moveA'), moveB: $('moveB'), moveC: $('moveC'), brow: $('statusBrow'), line: $('statusLine'),
    guideBtn: $('guideBtn'), boardBtn: $('boardBtn'), sheet: $('sheet'), sheet2: $('sheet2'), fx: $('fx'),
    cover: $('cover'), announce: $('announce'),
  };
  setupSheet(dom.sheet);
  setupSheet(dom.sheet2);
  nameCards();
  A.setDPR(Math.min(devicePixelRatio || 1, 3));
  const audio = createAudio();
  const fx = createFx(dom.fx, { reduce });
  const dice = createCornerDice(dom.dice, { reduce });
  let gl = null;
  const inspect = createInspect($('inspect'), { reduce, info: (card) => cardInfo(card) });

  let view = session.view;
  let me = session.me;
  let isle = null;
  let isleReady = false;
  let L = null;
  let fit = null;
  // the island faces you: from the seat you sit at, at a table
  let phi = (table && Number.isFinite(session.phi) ? session.phi : 0) || 0;
  const ui = {
    pick: null, // the build picked to place: 'road' | 'settlement' | 'city'
    at: null, // where its ghost stands (a corner or an edge)
    robberAt: null, // the tile picked for the robber
    sheet: null, // what the sheet shows: 'build' | 'trade' | 'waiting' | 'offer' | 'ask' | 'steal' | 'discard' | 'harvest' | 'tribute' | 'end'
    trade: null, // the offer being put together: { give, want, to }
    seenOffers: new Set(), // offers to this phone already shown (a closed one stays closed)
    pendingPlay: null, // a development card being played that needs a choice first
    showBoard: !table || !!table.board, // at a table, only while this phone's board button is on
    rollLine: '', // what the last roll gave you, for the status line
    busy: false, // an action on its way to the host
  };
  const flying = { hand: Object.fromEntries(RES.map((r) => [r, 0])), chips: {}, dev: 0 };
  const show = { lit: 0, robber: undefined, hide: null, fadeMs: 320 };
  let shown = null;
  let picKey = null;
  let slot = 0;
  let fade = null;
  let overlay = [];
  let boardRaf = 0;
  let pictureRaf = 0;
  let destroyed = false;
  let animating = Promise.resolve();
  let coverFor = null; // a game on one phone: whose hand the screen is waiting to show
  const atTable = !!table; // an iPad in the middle shows the island
  let tablePlacing = null; // at a table: the piece this phone is placing there, and its ghost
  let placedKind = null; // what this phone last told the table it is placing
  // the pieces you have left, under your cards at a table
  const piecesBox = el('div', 'ktan-pieces');
  dom.screen.append(piecesBox);

  /* ---------- Layout ---------- */

  const probe = el('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const safe = () => {
    const cs = getComputedStyle(probe);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  };
  const place = (node, r) => {
    if (!r) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    Object.assign(node.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };

  function layout() {
    if (destroyed) return;
    const W = dom.screen.clientWidth || innerWidth, H = dom.screen.clientHeight || innerHeight;
    const s = safe();
    const land = W > H * 1.08;
    const n = view.players.length;
    const chipCols = n > 4 ? 3 : n, chipRows = n > 4 ? 2 : 1;
    const board = ui.showBoard;
    const next = { W, H, land, s, chipCols, chipRows, board };
    if (!land) {
      const top = Math.max(s.t, 8) + 8 + 44;
      const x0 = s.l + 16, x1 = W - s.r - 16, cw = x1 - x0;
      const movesY = H - Math.max(s.b, 12) - 48;
      const chipH = chipRows > 1 ? 46 : 54, chipsH = chipRows * chipH + (chipRows - 1) * 6;
      if (!board) {
        tableLayout(next, { top, x0, cw, movesY, chipH, chipsH });
        return finishLayout(next);
      }
      let bh = board ? Math.round(W * 0.7) : 0, k = Math.min(1.25, cw / 358);
      const need = () => (board ? bh + 6 : 10) + chipsH + 12 + 64 * k * 1.58 + 16 + 56 * k * 1.48 + 18 + 12;
      const room = movesY - top;
      while (need() > room && board && bh > W * 0.56) bh -= 4;
      while (need() > room && k > 0.7) k -= 0.02;
      while (need() < room - 24 && board && bh < W * 0.8) bh += 4;
      while (need() < room - 20 && k < (board ? 1.2 : 1.6)) k += 0.02;
      const spare = Math.max(0, room - need());
      let y = board ? top - 6 : top + 4;
      next.board = board ? { x: 0, y, w: W, h: bh + 6 } : null;
      y += board ? bh + 10 + spare * 0.2 : 6;
      next.chips = { x: x0, y, w: cw, h: chipsH, chipH };
      y += chipsH + 12 + spare * 0.25;
      const handW = Math.round(64 * k);
      next.hand = { x: x0, y, w: cw, h: Math.round(handW * 1.58), cw: handW };
      y += next.hand.h + 14 + spare * 0.25;
      const devW = Math.round(56 * k);
      next.shelf = { x: x0, y, w: cw, h: Math.round(devW * 1.48) + 18, cw: devW };
      next.moves = { x: x0, y: movesY, w: cw, h: 48 };
    } else {
      // with no board on the phone (at a table), the column is the whole screen's middle
      const panelW = board ? clamp(Math.round(W * 0.42), 300, 460) : Math.min(600, W - s.l - s.r - 32);
      const x1 = board ? W - s.r - 16 : Math.round((W + panelW) / 2), x0 = x1 - panelW;
      const top = Math.max(s.t, 16);
      const movesY = H - Math.max(s.b, 12) - 48;
      const chipH = chipRows > 1 ? 44 : 52, chipsH = chipRows * chipH + (chipRows - 1) * 6;
      next.status = { x: x0, y: top, w: panelW - 52, h: 44 };
      let y = top + 52;
      next.chips = { x: x0, y, w: panelW, h: chipsH, chipH };
      y += chipsH + 10;
      const room = movesY - 10 - y;
      let k = Math.min(1.2, panelW / 358);
      while (64 * k * 1.58 + 14 + 56 * k * 1.48 + 18 > room && k > 0.55) k -= 0.02;
      const handW = Math.round(64 * k);
      next.hand = { x: x0, y, w: panelW, h: Math.round(handW * 1.58), cw: handW };
      y += next.hand.h + 12;
      const devW = Math.round(56 * k);
      next.shelf = { x: x0, y, w: panelW, h: Math.round(devW * 1.48) + 18, cw: devW };
      next.moves = { x: x0, y: movesY, w: panelW, h: 48 };
      next.board = board ? { x: 0, y: 0, w: x0 - 12, h: H } : null;
      document.body.style.setProperty('--status-top', `${next.status.y}px`);
      document.body.style.setProperty('--status-left', `${next.status.x}px`);
      document.body.style.setProperty('--status-w', `${next.status.w}px`);
    }
    finishLayout(next);
  }

  // At a table, with no board on the phone, the hand comes first (the proposals page's phone at a
  // table): the chips, your resources large in two rows, your development cards beside the square
  // cards you hold, then the pieces you have left, and the moves.
  function tableLayout(next, { top, x0, cw, movesY, chipH, chipsH }) {
    let k = Math.min(1.25, cw / 358);
    const need = () => 8 + chipsH + 14 + 18 + 96 * k * (1.56 + 1.62) + 14 + 18 + 56 * k * 1.48 + 16 + 18 + 44 + 10;
    while (need() > movesY - top && k > 0.6) k -= 0.02;
    const spare = Math.max(0, movesY - top - need());
    let y = top + 8 + spare * 0.15;
    next.board = null;
    next.chips = { x: x0, y, w: cw, h: chipsH, chipH };
    y += chipsH + 14 + spare * 0.2;
    const handW = Math.round(96 * k);
    next.hand = { x: x0, y, w: cw, h: Math.round(18 + handW * (1.56 + 1.62)), cw: handW, rows: 2, label: true };
    y += next.hand.h + 14 + spare * 0.2;
    const devW = Math.round(56 * k);
    next.shelf = { x: x0, y, w: cw, h: Math.round(devW * 1.48) + 18, cw: devW };
    y += next.shelf.h + 16 + spare * 0.2;
    next.pieces = { x: x0, y, w: cw, h: 18 + 44 };
    next.moves = { x: x0, y: movesY, w: cw, h: 48 };
  }

  function finishLayout(next) {
    L = next;
    place(dom.boardBox, L.board);
    place(dom.chips, L.chips);
    place(dom.hand, L.hand);
    place(dom.shelf, L.shelf);
    place(piecesBox, L.pieces || null);
    place(dom.moves, L.moves);
    // a new layout puts the stacks in their places at once: nothing slides a frame later
    dom.hand.classList.add('is-instant');
    requestAnimationFrame(() => requestAnimationFrame(() => dom.hand.classList.remove('is-instant')));
    dom.chips.style.setProperty('--chip-cols', String(L.chipCols));
    dom.chips.style.setProperty('--chip-h', `${L.chips.chipH}px`);
    if (L.board) {
      if (!gl) {
        gl = createGL(dom.boardCv, { onRestored: () => { picKey = null; dirtyPicture(); } }) || create2D(dom.boardCv);
      }
      dice.resize(clamp(Math.round(L.board.w / 14), 24, 40));
      Object.assign(dom.dice.style, { right: `${(L.land ? 12 : L.s.r + 14)}px`, bottom: '12px' });
      gl.resize(L.board.w, L.board.h, devicePixelRatio || 1);
      refit();
    }
    renderAll();
  }

  function refit() {
    if (!isleReady || !L?.board) return;
    const b = L.board;
    fit = isle.fit(phi, b.w, b.h, { fill: L.land ? [0.95, 0.9] : [0.995, 0.93] });
    picKey = null;
    dirtyPicture();
  }

  /* ---------- The board's picture ---------- */

  // The island's tiles and sprites are painted once, at the largest size this screen lays them (the
  // board in landscape is as tall as the screen's short side), so a turn of the phone paints nothing
  // new; then it comes into focus.
  // At a table with no board on the phone, only the island's shape is made (where its corners and
  // edges are); its pictures are painted once the board is shown.
  let building = false;
  function build(island) {
    const dpr = Math.min(devicePixelRatio || 1, 3), short = Math.min(innerWidth, innerHeight);
    const sc = Math.round(Math.min(260, clamp(short / 7.2, 34, 120) * dpr));
    if (!isle) isle = createIsland(island, { sc });
    if (!L?.board || building) return;
    building = true;
    isle.build().then(async () => {
      if (destroyed) return;
      await isle.prewarm(view, phi);
      if (destroyed) return;
      isleReady = true;
      refit();
      dom.boardCv.classList.add('blur-in');
    });
  }

  const litOf =(v) => (v.dice && v.rolled && v.phase !== 'roll' && v.phase !== 'setup' && v.dice[0] + v.dice[1] !== 7 ? v.dice[0] + v.dice[1] : 0);

  function dirtyPicture() {
    if (pictureRaf) return;
    pictureRaf = requestAnimationFrame(() => {
      pictureRaf = 0;
      paintPicture();
    });
  }

  function paintPicture() {
    if (!isleReady || !fit || !L?.board || destroyed) return;
    const b = L.board, dpr = devicePixelRatio || 1;
    const key = JSON.stringify([view.roads, view.buildings, view.robber, show.lit, show.robber, show.hide, b.w, b.h, view.players.map((p) => p.color)]);
    if (key === picKey) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(b.w * dpr);
    canvas.height = Math.round(b.h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = A.SEA.deep;
    g.fillRect(0, 0, b.w, b.h);
    const hide = show.hide;
    isle.paint(g, fit, view, {
      lit: show.lit, dim: show.lit ? 1 : 0, sea: true, t: 7.3, robber: show.robber,
      skip: hide ? (it) => (it.t === 'settlement' || it.t === 'city') && Math.hypot(it.x - hide.x, it.y - hide.y) < 1e-4 : undefined,
    });
    // the waves fade out where the board ends, so the sea never stops on a line
    const e = 12;
    const edge = (x0, y0, x1, y1, x, y, w, h) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, A.SEA.deep);
      gr.addColorStop(1, 'rgba(11,11,11,0)');
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
    };
    edge(0, 0, 0, e, 0, 0, b.w, e);
    edge(0, b.h, 0, b.h - e, 0, b.h - e, b.w, e);
    if (L.land) edge(b.w, 0, b.w - e, 0, b.w - e, 0, e, b.h);
    slot = 1 - slot;
    const next = slot ? 'pic:a' : 'pic:b';
    gl.texture(next, canvas, true);
    fade = shown && !reduce() && show.fadeMs > 0 ? { from: shown, to: next, t0: performance.now(), dur: show.fadeMs } : null;
    show.fadeMs = 320;
    picKey = key;
    shown = next;
    drawBoard();
  }

  /** A board frame: the picture (giving way to the next), then what animations lay on it. */
  function drawBoard() {
    cancelAnimationFrame(boardRaf);
    boardRaf = 0;
    if (!L?.board || !gl || destroyed) return;
    const now = performance.now();
    if (!gl.begin(11)) return;
    const b = L.board;
    let alive = false;
    if (fade) {
      const f = clamp((now - fade.t0) / fade.dur, 0, 1);
      gl.pic(fade.from, 0, 0, b.w, b.h);
      gl.pic(fade.to, 0, 0, b.w, b.h, { a: A.easeInOut(f) });
      if (f >= 1) fade = null;
      else alive = true;
    } else if (shown) gl.pic(shown, 0, 0, b.w, b.h);
    overlay = overlay.filter((draw) => {
      const keep = draw(gl, now / 1000);
      alive = alive || keep;
      return keep;
    });
    if (drawChoices(now / 1000)) alive = true;
    gl.end();
    if (alive) boardRaf = requestAnimationFrame(drawBoard);
  }
  const boardLoop = () => {
    if (!boardRaf) boardRaf = requestAnimationFrame(drawBoard);
  };

  // Points on the board, in the board's px and on the screen.
  const origin = () => {
    const r = dom.boardBox.getBoundingClientRect();
    return [r.left, r.top];
  };
  const onScreen = ([x, y]) => {
    const [ox, oy] = origin();
    return [ox + x, oy + y];
  };
  const tileAt = (tile) => onScreen(isle.tilePx(fit, tile));
  const cornerAt = (id) => onScreen(isle.cornerPx(fit, id));
  const edgeMid = (id) => {
    const [a, b] = isle.edgePx(fit, id);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const bankAt = () => (L?.board ? onScreen([L.board.w / 2, L.board.h * 0.48]) : [innerWidth / 2, innerHeight * 0.3]);

  /* ---------- What can be chosen on the board: places, tiles, ghosts ---------- */

  const col = (p) => A.rgbOf(view.players[p]?.color || '#efefef');
  function choosing() {
    if (me === null || me === undefined) return null;
    if (view.phase === 'setup' && setupTurn() === me) return { kind: view.setup.need, free: true };
    if (view.phase === 'roads' && view.current === me) return { kind: 'road', free: true };
    if (view.phase === 'robber' && view.current === me) return { kind: 'robber' };
    if (ui.pick && ui.pick !== 'dev') return { kind: ui.pick };
    return null;
  }
  const setupTurn = () => (view.setup ? view.setup.order[view.setup.step] : null);
  function spotsFor(kind) {
    if (kind === 'robber') return view.island.tiles.map((_, i) => i).filter((i) => i !== view.robber);
    try {
      return legalSpots(view, me, kind) || [];
    } catch {
      return [];
    }
  }

  /** Draws the places a piece may go (breathing in your colour) and its ghost; true while drawn. */
  function drawChoices(t) {
    const c = choosing();
    if (!c || !isleReady || !fit) return false;
    const S = fit.S, mine = col(me);
    const b = reduce() ? 1 : 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1.2);
    const spots = spotsFor(c.kind);
    if (c.kind === 'robber') {
      const ring = reduce() ? 0.85 : 0.7 + 0.3 * Math.sin((t * Math.PI * 2) / 1.1);
      for (const i of spots) {
        if (i === ui.robberAt) continue;
        const [x, y] = isle.tilePx(fit, i);
        gl.ring(x, y, A.RC * S, A.RC * S * A.K, 0, 3, [243, 236, 220, 0.85 * ring], { dash: 9, gap: 6 });
      }
      if (ui.robberAt !== null) drawRobberGhost(ui.robberAt, t);
      return true;
    }
    if (c.kind === 'road') {
      for (const id of spots) {
        if (id === ui.at) continue;
        const [a, z] = isle.edgePx(fit, id), d = [z[0] - a[0], z[1] - a[1]], l = Math.hypot(...d) || 1, u = [d[0] / l, d[1] / l];
        gl.line(a[0] + u[0] * 0.2 * S, a[1] + u[1] * 0.2 * S, z[0] - u[0] * 0.2 * S, z[1] - u[1] * 0.2 * S, 0.075 * S, [...mine, 0.4 + 0.6 * b], { dash: 0.05 * S, gap: 0.08 * S });
      }
    } else {
      for (const id of spots) {
        if (id === ui.at) continue;
        const [x, y] = isle.cornerPx(fit, id), r = 0.16 * S * (0.92 + 0.1 * b), a = 0.5 + 0.5 * b;
        gl.ellipse(x, y, r * 1.35, r * 1.35 * A.K, 0, [...mine, 0.45 * a], 9);
        gl.ring(x, y, r, r * A.K, 0, 3, [...mine, a]);
        gl.ellipse(x, y, r * 0.26, r * 0.26 * A.K, 0, [...mine, a]);
      }
    }
    if (ui.at !== null && spots.includes(ui.at)) drawGhost(c.kind, ui.at, t);
    return true;
  }

  const ghostA = (t) => (reduce() ? 0.7 : 0.6 + 0.22 * Math.sin((t * Math.PI * 2) / 1.4));
  function drawGhost(kind, at, t) {
    const S = fit.S, P = view.players[me], c = A.rgbOf(P.color);
    if (kind === 'road') {
      const [a, z] = isle.edgePx(fit, at), d = [z[0] - a[0], z[1] - a[1]], l = Math.hypot(...d) || 1, u = [d[0] / l, d[1] / l];
      gl.ellipse((a[0] + z[0]) / 2, (a[1] + z[1]) / 2, 0.5 * S, 0.22 * S, Math.atan2(d[1], d[0]), [...c, 0.35], 0.12 * S);
      gl.line(a[0] + u[0] * 0.15 * S, a[1] + u[1] * 0.15 * S, z[0] - u[0] * 0.15 * S, z[1] - u[1] * 0.15 * S, 0.12 * S, [...c, ghostA(t)], { dash: 0.07 * S, gap: 0.06 * S });
      return;
    }
    const [x, y] = isle.cornerPx(fit, at);
    gl.ellipse(x, y, 0.24 * S, 0.24 * S * A.K, 0, [...c, 0.6], 0.1 * S);
    drawSprite({ t: kind, x: isle.corners[at][0], y: isle.corners[at][1], lift: A.SLAB, yaw: 0, col: P.color, mark: P.mark, key: kind + P.color + P.mark }, { a: ghostA(t), shadow: false });
  }
  function drawRobberGhost(tile, t) {
    const [x, y] = isle.robberAt(tile, phi), S = fit.S;
    const up = 0.16 * S + (reduce() ? 0 : 3 * Math.sin((t * Math.PI * 2) / 1.3));
    const [px, py] = isle.toScreen(fit, x, y, A.SLAB);
    gl.ellipse(px + up * 0.35, py + up * 0.18, 0.1 * S, 0.1 * S * A.K, 0, [10, 8, 22, 0.35], 0.04 * S);
    drawSprite({ t: 'robber', x, y, lift: A.SLAB, key: 'robber' }, { up, a: 0.9, shadow: false });
  }

  /** A standing thing's kept sprite on the GPU, at its place on the board (raised up px, grown sc). */
  function drawSprite(it, { a = 1, up = 0, sc = 1, shadow = true, at = null } = {}) {
    const { body, shadow: sh } = isle.sprite(it, phi);
    const S = fit.S;
    const [X, Y] = at || isle.toScreen(fit, it.x, it.y, it.lift ?? A.SLAB);
    const key = `sp:${it.t}:${it.key}:${Math.round(phi * 100)}`;
    if (!gl.has(key)) gl.texture(key, body.c);
    if (shadow && sh) {
      const sk = key + ':sh';
      if (!gl.has(sk)) gl.texture(sk, sh.c);
      gl.pic(sk, X - sh.ax * S * sc, Y - sh.ay * S * sc, sh.w * S * sc, sh.h * S * sc, { a: a * clamp(1 - up / (0.5 * S), 0.15, 1) });
    }
    gl.pic(key, X - body.ax * S * sc, Y - up - body.ay * S * sc, body.w * S * sc, body.h * S * sc, { a });
  }

  // Taps on the board: the nearest place to the finger, if it's one the piece may go to.
  let downAt = null;
  dom.boardHit.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  dom.boardHit.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 14) return;
    downAt = null;
    const c = choosing();
    if (!c || !fit) return;
    audio.unlock();
    const r = dom.boardBox.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const spots = spotsFor(c.kind);
    const reach = fit.S * 1.1;
    const id = c.kind === 'robber' ? isle.nearest(fit, 'tile', spots, px, py, fit.S * 1.2) : isle.nearest(fit, c.kind === 'road' ? 'edge' : 'corner', spots, px, py, reach);
    if (id === null) return;
    audio.play('tap');
    if (c.kind === 'robber') ui.robberAt = id;
    else {
      ui.at = id;
      if (atTable) session.place?.(c.kind, id);
    }
    renderAll();
    boardLoop();
  });

  /* ---------- Chips: every player, you first, the one whose turn it is ringed in brass ---------- */

  function chipOrder() {
    const n = view.players.length, start = me === null || me === undefined ? 0 : me;
    return Array.from({ length: n }, (_, i) => (start + i) % n);
  }
  const chipNodes = new Map();
  function renderChips() {
    if (!L) return;
    const order = chipOrder();
    const turn = whoseTurn();
    dom.chips.replaceChildren(...order.map((p) => {
      const P = view.players[p];
      const chip = el('div', 'ktan-chip');
      chip.style.setProperty('--c', P.color);
      if (p === turn) chip.classList.add('is-turn');
      if (session.away?.(p)) chip.classList.add('is-away');
      chip.append(markEl(P, 16));
      const name = el('span', 'ktan-chip-name');
      name.append(el('span', '', p === me ? t('ktan.you') : P.name));
      if (view.awards?.road === p) name.append(medal('longest'));
      if (view.awards?.army === p) name.append(medal('army'));
      chip.append(name);
      const stats = el('span', 'ktan-chip-stats');
      const pts = el('span', 'ktan-chip-pts', String(P.points ?? 0));
      pts.append(el('small', '', t('ktan.pt')));
      const cards = Math.max(0, (P.cards ?? 0) - (flying.chips[p] || 0));
      stats.append(pts, el('span', 'ktan-chip-cards', String(cards)));
      chip.append(stats);
      const answer = answerOf(p);
      if (answer) {
        const badge = el('span', `ktan-chip-badge is-${answer}`);
        badge.innerHTML = iconSvg(answer === 'yes' ? 'check' : answer === 'no' ? 'cross' : 'wait');
        chip.append(badge);
      }
      const label = [p === me ? t('ktan.you') : P.name, t('ktan.points', { n: P.points ?? 0 }), t('ktan.cardsN', { n: P.cards ?? 0 })];
      if (p === turn) label.push(t('ktan.theirTurn'));
      chip.setAttribute('aria-label', label.join(', '));
      chip.setAttribute('role', 'img');
      chipNodes.set(p, chip);
      return chip;
    }));
  }
  function medal(kind) {
    const c = document.createElement('canvas'), dpr = A.getDPR();
    c.width = c.height = Math.round(12 * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    A.awardMedal(g, kind === 'army' ? 'army' : 'road', 6, 6, 6);
    return c;
  }
  const chipAt = (p) => {
    const n = chipNodes.get(p);
    if (!n?.isConnected) return [innerWidth / 2, innerHeight / 2];
    const r = n.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  function flash(p) {
    const n = chipNodes.get(p);
    if (!n) return;
    n.classList.remove('is-flash');
    void n.offsetWidth;
    n.classList.add('is-flash');
  }
  function answerOf(p) {
    const mine = view.offers?.find((o) => o.from === me);
    if (!mine || p === me || (mine.to !== 'all' && mine.to !== p)) return null;
    const a = mine.answers?.[p];
    return a === 'yes' ? 'yes' : a === 'no' ? 'no' : 'wait';
  }
  function whoseTurn() {
    if (view.phase === 'setup') return setupTurn();
    if (view.phase === 'over') return view.winner;
    return view.current;
  }

  /* ---------- Your hand: five fanned stacks, and the development cards on a shelf ---------- */

  const stacks = new Map(); // res -> { btn, canvas, n, anim }
  function myHand() {
    return me !== null && me !== undefined ? view.players[me]?.hand || {} : {};
  }
  const shownHand = (res) => Math.max(0, (myHand()[res] || 0) - (flying.hand[res] || 0));

  // Where each stack stands: in a row of five, or (at a table, with no board on the phone) large in
  // two rows, three over two, as the proposals page lays them.
  const BIG = [[0.168, 0], [0.5, 0], [0.832, 0], [0.334, 1], [0.666, 1]];
  const handLabel = el('div', 'ktan-hand-label');
  function renderHand() {
    if (!L) return;
    const h = L.hand;
    if (me === null || me === undefined) {
      dom.hand.replaceChildren();
      return;
    }
    const two = h.rows === 2, slotW = h.w / 5;
    const cw = two ? h.cw : Math.min(h.cw, Math.round(slotW * 0.88));
    const top0 = h.label ? 18 : 0;
    if (h.label) {
      const n = RES.reduce((a, r) => a + shownHand(r), 0);
      handLabel.replaceChildren(el('span', 'eyebrow', t('ktan.yourHand')), el('span', 'eyebrow', t(n === 1 ? 'ktan.oneCard' : 'ktan.nCards', { n })));
      if (!handLabel.isConnected) dom.hand.append(handLabel);
    } else handLabel.remove();
    RES.forEach((res, i) => {
      let s = stacks.get(res);
      if (!s) {
        const btn = button('ktan-stack');
        const canvas = document.createElement('canvas');
        btn.append(canvas);
        btn.addEventListener('click', () => {
          audio.unlock();
          inspect.show({ kind: res }, btn);
        });
        s = { btn, canvas, open: 0, age: 9, close: 1, gone: 0 };
        stacks.set(res, s);
      }
      if (!s.btn.isConnected) dom.hand.append(s.btn);
      const W = cw * 1.5, H = cw * 1.62;
      const cx = two ? BIG[i][0] * h.w : slotW * (i + 0.5);
      const top = top0 + (two ? BIG[i][1] * cw * 1.56 : 0);
      Object.assign(s.btn.style, { left: `${cx - W / 2}px`, top: `${top}px`, width: `${W}px`, height: `${H}px`, zIndex: String(5 - i) });
      s.W = W;
      s.H = H;
      s.cw = cw;
      s.btn.setAttribute('aria-label', t('ktan.pickUp', { name: t(`ktan.card.${res}`), n: shownHand(res) }));
      paintStack(res);
    });
  }

  /** The pieces you have left, at a table: a road, a camp and a town in your colour, with how many. */
  function renderPieces() {
    if (!L?.pieces || me === null || me === undefined) {
      piecesBox.replaceChildren();
      piecesBox.dataset.key = '';
      return;
    }
    const P = view.players[me];
    const key = JSON.stringify([P.pieces, P.color, P.mark, L.pieces.w]);
    if (piecesBox.dataset.key === key) return;
    piecesBox.dataset.key = key;
    const row = el('div', 'ktan-pieces-row');
    // the kind's name where there is room for it; the piece says it anyway
    const words = L.pieces.w / 3 >= 150;
    for (const kind of ['road', 'settlement', 'city']) {
      const tile = el('div', 'ktan-piece');
      tile.append(pieceEl(kind, 34, 30, P), el('b', '', String(P.pieces?.[kind] ?? 0)));
      if (words) tile.append(el('span', '', t(`ktan.pieces.${kind}`)));
      tile.setAttribute('aria-label', `${P.pieces?.[kind] ?? 0} ${t(`ktan.pieces.${kind}`)}`);
      row.append(tile);
    }
    piecesBox.replaceChildren(el('span', 'eyebrow', t('ktan.piecesLeft')), row);
  }
  function paintStack(res) {
    const s = stacks.get(res);
    if (!s || !s.W) return;
    const dpr = A.getDPR(), c = s.canvas;
    const pw = Math.round(s.W * dpr), ph = Math.round(s.H * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
      // it fills its button, so a stack gliding to a new size scales on its way there
      c.style.width = '100%';
      c.style.height = '100%';
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, s.W, s.H);
    A.fanStack(g, 1, res, shownHand(res), s.W / 2, s.cw * 0.06, s.cw, { open: flying.hand[res] > 0 ? s.open : 0, age: s.age, close: s.close, gone: s.gone, still: reduce() });
  }
  /** Where a card meets a stack (its top card's middle and turn), on the screen, holding c cards. */
  function stackTop(res, c) {
    const s = stacks.get(res);
    if (!s?.btn.isConnected) return bankAt();
    // the hand may be shrunk for an open panel: its stacks are scaled, not laid out again
    const r = s.btn.getBoundingClientRect(), k = r.width / s.W || 1;
    const [x, y, rot] = A.fanTop(s.W / 2, s.cw * 0.06, s.cw, c ?? shownHand(res) + 1);
    return [r.left + x * k, r.top + y * k, rot];
  }
  /** How wide a card in that stack shows on the screen right now. */
  function handW(res) {
    const s = stacks.get(res);
    if (!s?.btn.isConnected) return L?.hand.cw || 60;
    return s.cw * (s.btn.getBoundingClientRect().width / s.W || 1);
  }
  // A stack takes a card with a little give (the fan breathes out and back), opening first for it.
  function stackLand(res) {
    const s = stacks.get(res);
    if (!s) return;
    s.age = 0;
    s.open = 0;
    const t0 = performance.now();
    const step = (now) => {
      s.age = (now - t0) / 1000;
      paintStack(res);
      if (s.age < 0.9 && !reduce()) requestAnimationFrame(step);
      else {
        s.age = 9;
        paintStack(res);
      }
    };
    requestAnimationFrame(step);
  }
  function stackOpen(res, ms) {
    const s = stacks.get(res);
    if (!s || reduce()) return;
    const t0 = performance.now();
    const step = (now) => {
      if (!(flying.hand[res] > 0)) return;
      s.open = A.easeInOut(clamp((now - t0) / ms, 0, 1));
      paintStack(res);
      if (s.open < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function devGroups() {
    const P = me !== null && me !== undefined ? view.players[me] : null;
    const groups = [];
    if (!P?.dev) return groups;
    for (const kind of DEV_ORDER) {
      const old = P.dev.filter((d) => d.kind === kind && !d.fresh).length;
      const fresh = P.dev.filter((d) => d.kind === kind && d.fresh).length;
      if (old) groups.push({ kind, n: old, fresh: false });
      if (fresh) groups.push({ kind, n: fresh, fresh: true });
    }
    return groups;
  }
  function renderShelf() {
    if (!L) return;
    const s = L.shelf, cw = s.cw;
    dom.shelf.replaceChildren();
    if (me === null || me === undefined) return;
    const groups = devGroups();
    const awards = [view.awards?.road === me && 'longest', view.awards?.army === me && 'army'].filter(Boolean);
    const label = el('p', 'eyebrow ktan-shelf-label', groups.length ? t('ktan.development') : t('ktan.noDevelopment'));
    label.style.left = '0px';
    label.style.top = '0px';
    dom.shelf.append(label);
    if (awards.length) {
      const al = el('p', 'eyebrow ktan-shelf-label', t('ktan.worth2'));
      al.style.right = '0px';
      al.style.top = '0px';
      dom.shelf.append(al);
    }
    const aw = Math.round(cw * 1.05);
    const awardsW = awards.length * (aw + 8);
    const room = s.w - awardsW;
    const step = Math.min(cw + 10, groups.length > 1 ? (room - cw * 1.2) / (groups.length - 1) : cw + 10);
    groups.forEach((gp, i) => {
      const btn = button('ktan-stack');
      const W = cw * 1.4, H = cw * 1.62;
      Object.assign(btn.style, { left: `${i * step - cw * 0.2}px`, top: '18px', width: `${W}px`, height: `${H}px` });
      const canvas = document.createElement('canvas'), dpr = A.getDPR();
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const shown = Math.min(gp.n, 3);
      for (let j = 0; j < shown; j++) {
        const kk = j - (shown - 1) / 2;
        A.drawCardAt(g, gp.kind, cw * 0.2 + kk * cw * 0.045, cw * 0.06, cw, { tag: gp.fresh && j === shown - 1 ? t('ktan.new') : undefined, count: j === shown - 1 && gp.n > 1 ? gp.n : undefined }, (kk * 4 * Math.PI) / 180);
      }
      btn.append(canvas);
      btn.setAttribute('aria-label', t('ktan.pickUp', { name: t(`ktan.card.${gp.kind}`), n: gp.n }) + (gp.fresh ? `, ${t('ktan.boughtNow')}` : ''));
      btn.addEventListener('click', () => {
        audio.unlock();
        inspect.show({ kind: gp.kind, fresh: gp.fresh }, btn);
      });
      dom.shelf.append(btn);
    });
    awards.forEach((kind, i) => {
      const btn = button('ktan-stack');
      Object.assign(btn.style, { left: `${s.w - awardsW + i * (aw + 8) + 4}px`, top: '18px', width: `${aw * 1.1}px`, height: `${aw * 1.1}px` });
      btn.append(cardEl(kind, aw, { square: true }));
      btn.setAttribute('aria-label', t('ktan.pickUpSquare', { name: t(`ktan.card.${kind}`) }));
      btn.addEventListener('click', () => inspect.show({ kind, square: true }, btn));
      dom.shelf.append(btn);
    });
  }
  const shelfAt = () => {
    const r = dom.shelf.getBoundingClientRect();
    return [r.left + (L?.shelf.cw || 50) * 0.5, r.top + 18 + (L?.shelf.cw || 50) * 0.75];
  };

  /* ---------- Status and moves ---------- */

  /** Where a ghost stands, in words: "Wood 6, Brick 8, Wool 10". */
  function placeLine(kind, at) {
    const tiles = kind === 'road' ? isle?.geo.edges[at]?.tiles : isle?.geo.corners[at]?.tiles;
    if (!tiles) return '';
    return tiles.map((i) => {
      const tl = view.island.tiles[i];
      return tl.res === 'desert' ? t('ktan.desert') : `${t(`ktan.card.${tl.res}`)} ${tl.num}`;
    }).join(', ');
  }

  const nameOf = (p) => (p === me ? t('ktan.you') : view.players[p]?.name ?? '?');
  function status() {
    const turn = whoseTurn(), mine = turn === me && me !== null && me !== undefined;
    const who = view.players[turn]?.name || '';
    let brow = mine ? t('ktan.yourTurn') : t('ktan.turnOf', { name: who });
    let line = '';
    switch (view.phase) {
      case 'setup':
        brow = t('ktan.setup');
        line = mine ? t(view.setup.need === 'road' ? 'ktan.placeRoad' : 'ktan.placeSettlement') : t(view.setup.need === 'road' ? 'ktan.isPlacingRoad' : 'ktan.isPlacingSettlement', { name: who });
        // at a table with no board here: placed with a tap on the table, then said here where it stands
        if (mine && !L?.board) line = ui.at !== null ? placeLine(view.setup.need, ui.at) : t(view.setup.need === 'road' ? 'ktan.placeRoadTable' : 'ktan.placeSettlementTable');
        break;
      case 'roll':
        line = mine ? t('ktan.rollOrPlay') : t('ktan.waitRoll', { name: who });
        break;
      case 'discard': {
        const owe = view.discard?.[me] || 0;
        line = owe ? t('ktan.giveBackN', { n: owe }) : t('ktan.waitDiscard');
        break;
      }
      case 'robber':
        line = mine ? t(L?.board ? 'ktan.moveRobber' : 'ktan.moveRobberTable') : t('ktan.isMovingRobber', { name: who });
        break;
      case 'steal':
        line = mine ? t('ktan.pickSteal') : t('ktan.isStealing', { name: who });
        break;
      case 'roads':
        line = mine ? (ui.at !== null && !L?.board ? placeLine('road', ui.at) : t('ktan.freeRoads', { n: view.free })) : t('ktan.isBuildingRoads', { name: who });
        break;
      case 'sbp':
        brow = t('ktan.specialBuild');
        line = view.sbp?.done?.includes(me) || turn === me ? t('ktan.waitSpecial') : t('ktan.specialNow');
        break;
      case 'over':
        brow = t('ktan.gameOver');
        line = view.winner === me ? t('ktan.youWin') : t('ktan.wins', { name: view.players[view.winner]?.name });
        break;
      default: {
        const seven = view.dice && view.dice[0] + view.dice[1] === 7;
        const roll = seven ? '' : ui.rollLine;
        line = mine ? roll || t('ktan.mainNow') : roll || t('ktan.isPlaying', { name: who });
        // placing a piece: what it is, and where its ghost stands
        if (mine && ui.pick) {
          brow = t(`ktan.build.${ui.pick}`);
          line = ui.at !== null ? placeLine(ui.pick, ui.at) : L?.board ? t('ktan.tapWhere') : t('ktan.tapTable');
        }
      }
    }
    return { brow, line };
  }

  // The moves along the bottom: Roll alone across the whole row while your turn waits for it, then
  // Build and Trade (each opening a sheet) and End turn, in red. Placing a piece: Cancel and Build.
  function moves() {
    const turn = whoseTurn(), mine = turn === me && me !== null && me !== undefined;
    const ph = view.phase;
    const off = { label: '', hidden: true };
    const c = choosing();
    if (ph === 'over') return [off, off, { label: t('ktan.results'), primary: true, on: () => openEnd() }];
    if (c && c.kind === 'robber' && !L?.board) return [off, off, { label: t('ktan.onTheTable'), primary: true, disabled: true }];
    if (c && c.kind === 'robber') return [off, off, { label: t('ktan.moveRobberBtn'), primary: true, disabled: ui.robberAt === null, on: () => act({ type: 'robber', tile: ui.robberAt }).then((r) => r.ok && (ui.robberAt = null)) }];
    if (c) {
      const cancel = c.free ? off : { label: t('common.cancel'), on: () => { ui.pick = null; ui.at = null; renderAll(); } };
      return [cancel, off, { label: t('ktan.buildBtn'), primary: true, disabled: ui.at === null, on: () => confirmBuild(c.kind) }];
    }
    if (ph === 'sbp' && me !== view.current && !view.sbp?.done?.includes(me)) {
      return [{ label: t('ktan.build'), on: () => openBuild() }, off, { label: t('ktan.done'), primary: true, on: () => act({ type: 'pass' }) }];
    }
    if (ph === 'roll' && mine) return [off, off, { label: t('ktan.roll'), primary: true, on: () => roll() }];
    const build = { label: t('ktan.build'), on: () => openBuild(), disabled: !mine || ph !== 'main' };
    const trade = { label: t('ktan.trade'), on: () => openTrade(), disabled: !mine || ph !== 'main' };
    return [build, trade, { label: t('ktan.endTurn'), red: true, disabled: !mine || ph !== 'main', on: () => endTurn() }];
  }

  function renderMoves() {
    const list = moves();
    [dom.moveA, dom.moveB, dom.moveC].forEach((b, i) => {
      const m = list[i];
      b.hidden = !!m.hidden;
      if (m.hidden) return;
      b.textContent = m.label;
      b.className = `btn${m.primary ? ' btn-primary' : m.red ? ' btn-red' : ''}`;
      b.disabled = !!m.disabled || ui.busy;
      b.onclick = () => {
        audio.unlock();
        if (!b.disabled) m.on?.();
      };
    });
  }

  function renderStatus() {
    const { brow, line } = status();
    dom.brow.textContent = brow;
    dom.line.textContent = line;
  }

  // At a table, what this phone is placing is lit on the table, where a tap puts its ghost down; the
  // phone hears where (tablePlacing) and builds it there. The robber is moved with a tap on the
  // table itself, so it isn't placed from here.
  function syncPlacing() {
    if (!atTable || me === null || me === undefined) return;
    const c = choosing();
    const kind = c && c.kind !== 'robber' ? c.kind : null;
    if (kind !== placedKind) {
      placedKind = kind;
      session.place?.(kind, kind && ui.at !== null ? ui.at : null);
    }
    if (kind && tablePlacing?.p === me && tablePlacing.kind === kind && tablePlacing.at !== null && tablePlacing.at !== undefined && tablePlacing.at !== ui.at) {
      if (spotsFor(kind).includes(tablePlacing.at)) ui.at = tablePlacing.at;
    }
  }

  function throwCheck() {
    if (!atTable) return;
    const due = view.phase === 'roll' && view.current === me && me !== null && me !== undefined;
    if (!due) closeThrow();
    else if (!thr.open && thr.turn !== view.turn && !ui.sheet && dom.cover.hidden) openThrow();
  }

  function renderAll() {
    if (destroyed || !L) return;
    syncPlacing();
    throwCheck();
    renderStatus();
    renderChips();
    renderHand();
    renderShelf();
    renderPieces();
    renderMoves();
    boardLoop();
  }

  /** Why a build is off, or null if it can be built now. */
  function buildBlock(kind) {
    const P = view.players[me];
    if (!P) return 'turn';
    const sbp = view.phase === 'sbp';
    if (!sbp && (view.current !== me || view.phase !== 'main')) return 'turn';
    if (kind === 'dev') {
      if (!view.deck) return 'deck';
      return canAfford(view, me, 'dev') ? null : 'cost';
    }
    if ((P.pieces?.[kind] ?? 1) <= 0) return 'pieces';
    if (!canAfford(view, me, kind)) return 'cost';
    if (!spotsFor(kind).length) return 'spot';
    return null;
  }
  function lacks(kind) {
    const hand = myHand(), out = [];
    for (const [res, n] of Object.entries(COST[kind])) if ((hand[res] || 0) < n) out.push(res);
    return out;
  }

  // ----- Build: a sheet of four tiles; a piece then goes on the board (or the table) -----

  /** The build sheet: the four tiles, each lit when you can build it now; Card asks before buying. */
  function openBuild(buy = false) {
    if (me === null || me === undefined) return;
    ui.sheet = 'build';
    const P = view.players[me];
    if (buy) {
      // a development card is drawn face down from the deck: it asks first
      const go = button('btn btn-primary btn-block', t('ktan.buy'), async () => {
        const r = await act({ type: 'buy' });
        if (r.ok) closeTheSheet();
      });
      go.disabled = !!buildBlock('dev');
      const cost = el('span', 'ktan-sum-cards');
      for (const [res, n] of Object.entries(COST.dev)) for (let i = 0; i < n; i++) cost.append(cardEl(res, 22, { small: true }));
      const row = el('div', 'ktan-place');
      const text = el('div', 'ktan-place-text');
      text.append(el('p', 't-body', t('ktan.devNote')), cost);
      row.append(pieceEl('dev', 64, 64, P), text);
      sheet([head(t('ktan.build.dev'), { brow: t('ktan.left', { n: view.deck }) }), row, go], { label: t('ktan.build.dev') });
      return;
    }
    const grid = el('div', 'ktan-builds is-big');
    grid.style.setProperty('--tile-h', '156px');
    const brow = el('span', 'eyebrow', L?.board ? t('ktan.tapBoard') : t('ktan.tapTable'));
    for (const kind of BUILDS) {
      const why = buildBlock(kind);
      const reason = why && (why === 'cost' ? t('ktan.needs', { what: lacks(kind).map((x) => resName(x)).join(', ') }) : t(`ktan.why.${why}`));
      const b = button(`ktan-build${why ? ' is-off' : ''}`);
      b.setAttribute('aria-disabled', String(!!why));
      const left = kind === 'dev' ? view.deck : P.pieces?.[kind];
      b.append(el('span', 'ktan-build-left', why ? reason : left !== undefined ? t('ktan.left', { n: left }) : ''));
      b.append(pieceEl(kind, 140, 66, P));
      b.append(el('span', 'ktan-build-name', t(`ktan.build.${kind}`)));
      const cost = el('span', 'ktan-sum-cards');
      for (const [res, n] of Object.entries(COST[kind])) for (let i = 0; i < n; i++) cost.append(cardEl(res, 15, { small: true }));
      b.append(cost);
      b.setAttribute('aria-label', `${t(`ktan.build.${kind}`)}${why ? `: ${reason}` : left !== undefined ? `: ${t('ktan.left', { n: left })}` : ''}`);
      b.addEventListener('click', () => {
        audio.unlock();
        if (why) {
          audio.play('no');
          say(reason);
          return;
        }
        if (kind === 'dev') return openBuild(true);
        // the piece goes where it can: lit on the board, or on the table
        ui.pick = kind;
        ui.at = null;
        closeTheSheet();
        renderAll();
      });
      grid.append(b);
    }
    const h = head(t('ktan.build'));
    h.insertBefore(brow, h.lastElementChild);
    sheet([h, grid], { label: t('ktan.build') });
  }

  /** The tiles a corner (or an edge) touches, as their resource and number: "Wood 6, Brick 8". */
  function touchesEl(kind, at) {
    const box = el('div', 'ktan-touches');
    const tiles = kind === 'road' ? isle.geo.edges[at].tiles : isle.geo.corners[at].tiles;
    for (const i of tiles) {
      const tl = view.island.tiles[i];
      const s = el('span');
      const dot = el('i');
      dot.style.setProperty('--c', tl.res === 'desert' ? '#b49a69' : A.RES_COL[tl.res]);
      s.append(dot, tl.res === 'desert' ? t('ktan.desert') : `${t(`ktan.card.${tl.res}`)} ${tl.num}`);
      box.append(s);
    }
    if (kind !== 'road') {
      const h = view.island.harbours.find((hb) => isle.harbourCornersOf(hb).includes(at));
      if (h) box.append(el('span', '', h.type === 'any' ? t('ktan.port3') : t('ktan.port2', { res: resName(h.type) })));
    }
    return box;
  }

  async function confirmBuild(kind) {
    if (ui.at === null) return;
    const at = ui.at;
    const r = await act({ type: 'build', kind, at });
    if (r.ok) {
      ui.at = null;
      if (view.phase === 'main') ui.pick = null;
      renderAll();
    }
  }

  /* ---------- Acting ---------- */

  async function act(action, as, extra) {
    if (ui.busy) return { error: 'busy' };
    ui.busy = true;
    renderMoves();
    let r;
    try {
      r = await (extra ? session.act(action, extra) : session.act(action, as));
    } catch (err) {
      r = { error: err?.message || 'failed' };
    }
    ui.busy = false;
    if (r?.error) {
      say(t(`ktan.err.${r.error}`) === `ktan.err.${r.error}` ? t('ktan.err.any') : t(`ktan.err.${r.error}`));
      audio.play('no');
    }
    renderAll();
    return r || { error: 'failed' };
  }
  function say(text) {
    dom.announce.textContent = '';
    requestAnimationFrame(() => (dom.announce.textContent = text));
  }

  function roll() {
    audio.unlock();
    if (atTable) return openThrow();
    act({ type: 'roll' });
  }

  /* ---------- Throwing the dice, at a table ---------- */

  // On your turn to roll the phone shows only the two dice, large, with a light in your colour along
  // its top edge, where the table is; now and then they hop toward it. They follow your thumb,
  // rattling as they go; let go while moving up and they fly off the top of the phone (a slow push
  // springs back) and come out of your glow on the table, further for a harder push.
  const thr = { open: false, turn: -1, els: null, drag: null, fly: null, back: null, raf: 0, t0: 0, faces: [5, 3], rot: [-0.1, 0.08], painted: [] };
  function throwRest(i) {
    const W = dom.screen.clientWidth || innerWidth, H = dom.screen.clientHeight || innerHeight;
    return [W / 2 + (i ? 1 : -1) * W * 0.164, H * 0.536];
  }
  const throwSize = () => Math.min((dom.screen.clientWidth || innerWidth) * 0.27, 130);
  function openThrow() {
    if (thr.open || destroyed || me === null || me === undefined) return;
    thr.open = true;
    thr.turn = view.turn;
    const box = dom.throwBox;
    if (!thr.els) {
      const glow = el('div', 'ktan-throw-glow');
      const dice2 = [0, 1].map(() => {
        const c = document.createElement('canvas');
        c.className = 'ktan-throw-die';
        return c;
      });
      const hint = el('p', 'ktan-throw-hint eyebrow', t('ktan.pushDice'));
      const back = button('btn ktan-throw-back', t('ktan.yourHandBack'), () => closeThrow());
      box.replaceChildren(glow, ...dice2, hint, back);
      thr.els = { glow, dice: dice2, hint, back };
      box.addEventListener('pointerdown', throwDown);
      box.addEventListener('pointermove', throwMove);
      box.addEventListener('pointerup', throwUp);
      box.addEventListener('pointercancel', throwUp);
    }
    const P = view.players[me];
    thr.els.glow.style.setProperty('--c', P.color);
    thr.els.glow.style.setProperty('--c3', A.css(A.rgbOf(P.color), 0.3));
    thr.faces = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    thr.pos = [throwRest(0), throwRest(1)];
    thr.drag = thr.fly = thr.back = null;
    thr.t0 = performance.now();
    thr.painted = [];
    box.hidden = false;
    dom.guideBtn.hidden = true;
    say(t('ktan.pushDice'));
    throwLoop();
  }
  function closeThrow() {
    if (!thr.open) return;
    thr.open = false;
    cancelAnimationFrame(thr.raf);
    dom.throwBox.hidden = true;
    dom.guideBtn.hidden = false;
  }
  function paintDie(i, lift) {
    const c = thr.els.dice[i], ds = throwSize(), size = Math.round(ds * 1.9), dpr = A.getDPR();
    const key = `${thr.faces[i]}|${thr.rot[i].toFixed(2)}|${lift.toFixed(2)}|${size}`;
    if (thr.painted[i] === key) return;
    thr.painted[i] = key;
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
      c.style.width = c.style.height = `${size}px`;
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    A.drawDie(g, size / 2, size / 2, ds, thr.faces[i], 'dark', thr.rot[i], lift);
  }
  function throwLoop() {
    cancelAnimationFrame(thr.raf);
    const step = (now) => {
      if (!thr.open) return;
      const size = Math.round(throwSize() * 1.9);
      let lift = 0, hopY = 0;
      if (thr.fly) {
        // off the top of the phone, the way they were thrown
        const f = (now - thr.fly.t0) / 300;
        thr.pos = thr.fly.from.map(([x, y]) => [x + thr.fly.v[0] * f * 0.3, y + thr.fly.v[1] * f * 0.3]);
        lift = 0.25;
        if (f >= 1) {
          thr.fly.done();
          return;
        }
      } else if (thr.back) {
        // a slow push springs back to where they rest
        const f = clamp((now - thr.back.t0) / 380, 0, 1), e = 1 + 2.70158 * Math.pow(f - 1, 3) + 1.70158 * Math.pow(f - 1, 2);
        thr.pos = thr.back.from.map(([x, y], i) => {
          const [rx, ry] = throwRest(i);
          return [x + (rx - x) * e, y + (ry - y) * e];
        });
        if (f >= 1) thr.back = null;
      } else if (!thr.drag && !reduce()) {
        // now and then they hop toward the table
        const a = ((now - thr.t0) / 1000) % 3.2;
        if (a > 2.6) {
          const f = (a - 2.6) / 0.6;
          hopY = -Math.sin(Math.PI * f) * 18;
          lift = Math.sin(Math.PI * f) * 0.3;
        }
      }
      thr.els.dice.forEach((c, i) => {
        paintDie(i, thr.drag ? 0.18 : lift);
        const [x, y] = thr.pos[i];
        c.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2 + hopY).toFixed(1)}px)`;
      });
      thr.raf = requestAnimationFrame(step);
    };
    thr.raf = requestAnimationFrame(step);
  }
  function throwDown(e) {
    if (e.target.closest('button') || thr.fly) return;
    dom.throwBox.setPointerCapture?.(e.pointerId);
    thr.back = null;
    thr.drag = { x0: e.clientX, y0: e.clientY, from: thr.pos.map((p) => p.slice()), samples: [[performance.now(), e.clientX, e.clientY]], shook: 0 };
  }
  function throwMove(e) {
    const d = thr.drag;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, now = performance.now();
    // they follow the thumb, the second a little behind, rattling as they go
    thr.pos = d.from.map(([x, y], i) => [x + dx * (i ? 0.94 : 1), y + dy * (i ? 0.94 : 1)]);
    d.samples.push([now, e.clientX, e.clientY]);
    while (d.samples.length > 2 && now - d.samples[0][0] > 120) d.samples.shift();
    if (now - d.shook > 70 && Math.hypot(dx, dy) > 8) {
      d.shook = now;
      thr.faces = thr.faces.map(() => 1 + Math.floor(Math.random() * 6));
      thr.rot = thr.rot.map(() => (Math.random() - 0.5) * 0.6);
    }
  }
  function throwUp(e) {
    const d = thr.drag;
    if (!d) return;
    thr.drag = null;
    const [t0, x0, y0] = d.samples[0], dt = Math.max(16, performance.now() - t0) / 1000;
    const vx = (e.clientX - x0) / dt, vy = (e.clientY - y0) / dt;
    const moved = e.clientY - d.y0;
    if (vy < -600 && moved < -30) {
      const W = dom.screen.clientWidth || innerWidth;
      audio.play('dice');
      thr.fly = {
        t0: performance.now(), from: thr.pos.map((p) => p.slice()), v: [vx, Math.min(vy, -1400)],
        done: async () => {
          closeThrow();
          const r = await act({ type: 'roll' }, undefined, { throw: { vx: Math.round(vx), vy: Math.round(vy), exitX: clamp(e.clientX / W, 0, 1) } });
          if (!r.ok && view.phase === 'roll' && view.current === me) openThrow();
        },
      };
    } else thr.back = { t0: performance.now(), from: thr.pos.map((p) => p.slice()) };
  }
  async function endTurn() {
    if (['build', 'trade', 'waiting'].includes(ui.sheet)) closeTheSheet();
    ui.pick = null;
    ui.at = null;
    const r = await act({ type: 'end' });
    if (r.ok) ui.rollLine = '';
  }

  /* ---------- Sheets ---------- */

  function sheet(nodes, { docked = false, label = '', onClose } = {}) {
    const d = dom.sheet;
    const form = el('div', 'sheet-inner');
    form.append(...nodes.filter(Boolean));
    d.replaceChildren(form);
    d.setAttribute('aria-label', label);
    d.onclose = () => {
      const was = ui.sheet;
      ui.sheet = null;
      onClose?.(was);
    };
    openSheet(d, { docked });
  }
  function closeTheSheet() {
    if (dom.sheet.open) {
      dom.sheet.onclose = null;
      closeSheet(dom.sheet);
    }
    ui.sheet = null;
  }
  function head(title, { brow, close = true, mark = null } = {}) {
    const h = el('div', 'sheet-head');
    const left = el('div', 'ktan-row-text');
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px';
    if (mark) row.append(markEl(mark, 30));
    row.append(el('h2', 't-heading', title));
    left.append(row);
    h.append(left);
    if (brow) h.append(el('span', 'eyebrow', brow));
    if (close) {
      const x = button('icon-btn');
      x.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
      x.setAttribute('aria-label', t('common.close'));
      x.addEventListener('click', () => closeTheSheet());
      h.append(x);
    }
    return h;
  }
  const actions = (...btns) => {
    const a = el('div', 'sheet-actions');
    a.append(...btns.filter(Boolean));
    return a;
  };

  /** Five resources each with − and + under them (and how many you hold), for picking cards. */
  function picker(pick, { max = () => 99, label, note = () => '', onChange, rate, w = 50 } = {}) {
    const box = el('div', 'sheet-section');
    const lab = el('div', 'ktan-label');
    const count = el('span', 'eyebrow is-ink');
    lab.append(el('span', 'eyebrow', label), count);
    const cells = el('div', 'ktan-cells');
    const refresh = () => {
      const n = total(pick);
      count.textContent = t(n === 1 ? 'ktan.oneCard' : 'ktan.nCards', { n });
      cells.replaceChildren(...RES.map((res) => {
        const v = pick[res] || 0;
        const cell = el('div', `ktan-cell${v ? '' : ' is-none'}`);
        cell.append(cardEl(res, w, { count: v }));
        const step = el('div', 'ktan-step');
        const by = rate ? rate(res) : 1;
        const minus = button('', '−', () => {
          pick[res] = Math.max(0, v - by);
          onChange?.(res, -1);
          refresh();
        });
        minus.disabled = v === 0;
        minus.setAttribute('aria-label', t('ktan.fewer', { name: resName(res) }));
        const plus = button('', '+', () => {
          pick[res] = v + by;
          onChange?.(res, 1);
          refresh();
        });
        plus.disabled = v + by > max(res);
        plus.setAttribute('aria-label', t('ktan.more', { name: resName(res) }));
        step.append(minus, plus);
        cell.append(step);
        const nt = note(res);
        if (nt) cell.append(el('span', 'eyebrow', nt));
        return cell;
      }));
      box.dispatchEvent(new Event('change'));
    };
    box.append(lab, cells);
    refresh();
    box.refresh = refresh;
    return box;
  }

  // ----- Trade: give, want, to whom; then the answers as they come, all in the Trade panel -----

  /** A new offer: preset fills it, or a likely one (two of what you hold most for one you lack). */
  function newTrade(preset = {}) {
    const hand = myHand();
    let give = preset.give, want = preset.want;
    if (!give) {
      const most = RES.reduce((a, b) => ((hand[b] || 0) > (hand[a] || 0) ? b : a), RES[0]);
      const least = RES.filter((r) => r !== most).reduce((a, b) => ((hand[b] || 0) < (hand[a] || 0) ? b : a));
      give = hand[most] ? { [most]: hand[most] >= 3 ? 2 : 1 } : {};
      want = { [least]: 1 };
      if (preset.res) give = { [preset.res]: Math.min(hand[preset.res] || 0, 1) };
    }
    const others = view.players.map((_, i) => i).filter((i) => i !== me);
    // on one phone an offer goes to one player, who answers it right there
    const to = preset.to ?? (session.kind === 'local' ? others[0] : 'all');
    return { give: { ...give }, want: { ...(want || {}) }, to, counter: preset.counter ?? null };
  }

  /** Opens Trade: your open offer with its answers, or a new offer (preset fills it). */
  function openTrade(preset = {}) {
    if (me === null || me === undefined) return;
    const mineOpen = view.offers?.find((o) => o.from === me);
    if (mineOpen && preset.counter == null) return showWaiting(mineOpen);
    ui.trade = newTrade(preset);
    composeTrade();
  }

  // The trade sheet: give, want (side by side on a phone on its side), to whom, and send.
  function composeTrade() {
    const T = ui.trade;
    ui.sheet = 'trade';
    const hand = myHand();
    const others = view.players.map((_, i) => i).filter((i) => i !== me);
    const bank = T.to === 'bank';
    const rate = (res) => (bank ? rateOf(view, me, res) : 1);
    const wide = innerWidth > innerHeight && innerHeight < 560, cardW = wide ? 40 : 50;
    const go = button('btn btn-primary');
    const fix = () => {
      for (const res of RES) if (T.give[res] && T.want[res]) T.want[res] = 0;
      if (bank) {
        // the bank pays a card for every full rate given
        const buys = RES.reduce((n, res) => n + Math.floor((T.give[res] || 0) / rate(res)), 0);
        let w = total(T.want);
        for (const res of [...RES].reverse()) while (w > buys && T.want[res] > 0) { T.want[res]--; w--; }
      }
    };
    const giveBox = picker(T.give, {
      label: t('ktan.give'),
      w: cardW,
      max: (res) => hand[res] || 0,
      note: (res) => (bank ? `${rate(res)}:1` : t('ktan.ofN', { n: hand[res] || 0 })),
      rate,
      onChange: (res, d) => {
        if (d > 0) T.want[res] = 0;
        fix();
        wantBox.refresh();
        check();
      },
    });
    const wantBox = picker(T.want, {
      label: t('ktan.want'),
      w: cardW,
      max: (res) => {
        if (T.give[res]) return 0;
        if (bank) {
          const buys = RES.reduce((n, x) => n + Math.floor((T.give[x] || 0) / rate(x)), 0);
          return Math.min(view.bank?.[res] ?? 19, (T.want[res] || 0) + Math.max(0, buys - total(T.want)));
        }
        return 9;
      },
      onChange: (res, d) => {
        if (d > 0) T.give[res] = 0;
        giveBox.refresh();
        check();
      },
    });
    const to = el('div', 'segmented');
    to.setAttribute('role', 'group');
    to.setAttribute('aria-label', t('ktan.to'));
    const choices = T.counter !== null ? [T.to] : session.kind === 'local' ? [...others, 'bank'] : ['all', ...others, 'bank'];
    for (const c of choices) {
      const b = button('', c === 'all' ? t('ktan.everyone') : c === 'bank' ? t('ktan.bank') : view.players[c].name, () => {
        T.to = c;
        if (c === 'bank') {
          for (const res of RES) T.give[res] = Math.floor((T.give[res] || 0) / rateOf(view, me, res)) * rateOf(view, me, res);
        }
        composeTrade();
      });
      b.setAttribute('aria-pressed', String(T.to === c));
      to.append(b);
    }
    const h = head(T.counter !== null ? t('ktan.counter') : t('ktan.trade'), { brow: ' ' });
    const brow = h.querySelector('.eyebrow');
    const check = () => {
      fix();
      go.disabled = !total(T.give) || !total(T.want);
      go.textContent = bank ? t('ktan.tradeBank') : T.counter !== null ? t('ktan.sendCounter') : t('ktan.sendOffer');
      if (brow) brow.textContent = bank ? t('ktan.withBank') : T.to === 'all' ? t('ktan.toEveryone') : t('ktan.toName', { name: view.players[T.to]?.name });
    };
    go.addEventListener('click', async () => {
      audio.unlock();
      const give = Object.fromEntries(RES.filter((x) => T.give[x] > 0).map((x) => [x, T.give[x]]));
      const want = Object.fromEntries(RES.filter((x) => T.want[x] > 0).map((x) => [x, T.want[x]]));
      if (bank) {
        const res = await act({ type: 'bank', give, want });
        if (res.ok) closeTheSheet();
        return;
      }
      if (T.counter !== null) {
        const res = await act({ type: 'counter', id: T.counter, give, want });
        if (res.ok) closeTheSheet();
        return;
      }
      const res = await act({ type: 'offer', give, want, to: T.to });
      if (res.ok) {
        // the sheet turns to your offer and its answers; on one phone, the player answers right here
        const mine = view.offers?.find((o) => o.from === me);
        if (session.kind === 'local' && mine && mine.to !== 'all') askLocal(mine);
        else if (mine) showWaiting(mine);
        else closeTheSheet();
      }
    });
    check();
    const pickRow = el('div', `ktan-trade-pick${wide ? ' is-two' : ''}`);
    pickRow.append(giveBox, wantBox);
    const foot = el('div', 'ktan-trade-foot is-row');
    foot.append(...[choices.length > 1 ? to : null, go].filter(Boolean));
    sheet([h, pickRow, foot], { label: t('ktan.trade') });
  }

  function summary(give, want, { mine = true } = {}) {
    const box = el('div', 'ktan-sum');
    const side = (title, cards) => {
      const s = el('div', 'ktan-sum-side');
      s.append(el('span', 'eyebrow', title));
      const row = el('div', 'ktan-sum-cards');
      for (const r of RES) if (cards[r]) row.append(cardEl(r, 52, { count: cards[r] }));
      s.append(row);
      return s;
    };
    const coin = el('span', 'ktan-coin');
    coin.innerHTML = iconSvg('trade');
    box.append(side(mine ? t('ktan.youGive') : t('ktan.youGet'), give), coin, side(mine ? t('ktan.youGet') : t('ktan.youGive'), want));
    return box;
  }

  // Your offer, waiting: each player it went to, thinking, saying no, or a yes to trade with; offers
  // made back to you; and Withdraw, which opens the offer again as you left it.
  function showWaiting(offer) {
    ui.sheet = 'waiting';
    const list = el('div', 'ktan-players');
    const others = view.players.map((_, i) => i).filter((i) => i !== me && (offer.to === 'all' || offer.to === i));
    for (const p of others) {
      const a = offer.answers?.[p];
      const yes = a === 'yes';
      const row = el(yes ? 'button' : 'div', `ktan-who${a === 'no' ? ' is-no' : a ? '' : ' is-wait'}`);
      if (yes) row.type = 'button';
      row.append(markEl(view.players[p], 22), el('span', '', view.players[p].name), el('span', 'ktan-who-sub', t('ktan.cardsN', { n: view.players[p].cards })));
      row.append(el('span', 'ktan-who-st eyebrow', yes ? t('ktan.tradeWith') : a === 'no' ? t('ktan.no') : t('ktan.thinking')));
      if (yes) {
        row.setAttribute('aria-label', t('ktan.saysYes', { name: view.players[p].name }));
        row.addEventListener('click', async () => {
          const r = await act({ type: 'trade', id: offer.id, with: p });
          if (r.ok) closeTheSheet();
        });
      }
      list.append(row);
    }
    // counters to you, each a one-player offer you can take at once
    for (const o of view.offers.filter((x) => x.to === me && x.from !== me)) {
      const row = el('div', 'ktan-who');
      row.append(markEl(view.players[o.from], 22), el('span', '', t('ktan.counters', { name: view.players[o.from].name, give: listCards(o.give), want: listCards(o.want) })));
      const take = button('btn btn-small', '', async () => {
        const r = await act({ type: 'answer', id: o.id, yes: true });
        if (r.ok) closeTheSheet();
      });
      take.append(el('span', '', t('ktan.accept')));
      row.append(take);
      list.append(row);
    }
    const all = others.map((p) => offer.answers?.[p]);
    const none = others.length && all.every((a) => a === 'no');
    const back = button('btn btn-block', t('ktan.withdraw'), async () => {
      const r = await act({ type: 'withdraw', id: offer.id });
      if (r.ok) openTrade({ give: offer.give, want: offer.want, to: offer.to });
    });
    sheet([head(t('ktan.yourOffer'), { brow: t('ktan.forLine', { give: listCards(offer.give), want: listCards(offer.want) }) }), list, none ? el('p', 't-note', t('ktan.nobodyTakes')) : null, back], { label: t('ktan.yourOffer') });
  }

  // An offer to this phone: what you get, what you give; Decline, Counter, Accept.
  function showOffer(offer) {
    ui.sheet = 'offer';
    ui.offerId = offer.id;
    const from = view.players[offer.from];
    const answered = offer.answers?.[me];
    const canPay = RES.every((r) => (myHand()[r] || 0) >= (offer.want[r] || 0));
    const toAll = offer.to === 'all';
    const note = el('p', 't-body', t('ktan.offerLine', { name: from.name, give: listCards(offer.give), want: listCards(offer.want) }) + ' ' + (canPay ? '' : t('ktan.cantPay')));
    note.style.textAlign = 'center';
    let foot;
    if (answered === 'yes' && toAll) {
      foot = el('div', 'notice');
      foot.append(el('p', 't-heading', t('ktan.accepted', { name: from.name })));
    } else {
      const decline = button('btn', t('ktan.decline'), async () => {
        const r = await act({ type: 'answer', id: offer.id, yes: false });
        if (r.ok) closeTheSheet();
      });
      const counter = button('btn', t('ktan.counter'), () => {
        closeTheSheet();
        openTrade({ give: { ...offer.want }, want: { ...offer.give }, to: offer.from, counter: offer.id });
      });
      const accept = button('btn btn-primary', t('ktan.accept'), async () => {
        const r = await act({ type: 'answer', id: offer.id, yes: true });
        if (r.ok && !toAll) closeTheSheet();
      });
      accept.disabled = !canPay;
      foot = actions(decline, offer.from === view.current ? counter : null, accept);
    }
    sheet([head(t('ktan.offers', { name: from.name }), { brow: toAll ? t('ktan.toEveryone') : t('ktan.toYou'), close: false, mark: from }), summary(offer.give, offer.want, { mine: false }), note, foot], { docked: true, label: t('ktan.offers', { name: from.name }) });
  }

  // A game on one phone: a trade offered to one player is answered right here, by them, so it reads
  // from their side, as the offer would on their own phone.
  function askLocal(offer) {
    const to = view.players[offer.to], from = view.players[offer.from];
    ui.sheet = 'ask';
    const theirs = session.state?.players?.[offer.to]?.hand;
    const canPay = !theirs || RES.every((r) => (theirs[r] || 0) >= (offer.want[r] || 0));
    const decline = button('btn', t('ktan.decline'), async () => {
      const r = await act({ type: 'answer', id: offer.id, yes: false }, offer.to);
      if (r.ok) closeTheSheet();
    });
    const accept = button('btn btn-primary', t('ktan.accept'), async () => {
      const r = await act({ type: 'answer', id: offer.id, yes: true }, offer.to);
      if (r.ok) closeTheSheet();
    });
    accept.disabled = !canPay;
    const note = el('p', 't-body', t('ktan.offerLine', { name: from.name, give: listCards(offer.give), want: listCards(offer.want) }) + (canPay ? '' : ' ' + t('ktan.cantPayName', { name: to.name })));
    note.style.textAlign = 'center';
    sheet([head(t('ktan.offers', { name: from.name }), { brow: t('ktan.toName', { name: to.name }), close: false, mark: from }), summary(offer.give, offer.want, { mine: false }), note, el('p', 't-note', t('ktan.askLocalNote', { name: to.name })), actions(decline, accept)], { docked: true, label: t('ktan.offers', { name: from.name }) });
  }

  // ----- The robber's choices, giving back cards, development cards -----

  function showSteal() {
    ui.sheet = 'steal';
    const list = el('div', 'ktan-players');
    for (const p of view.steal || []) {
      const row = button('ktan-who', '', async () => {
        const r = await act({ type: 'steal', victim: p });
        if (r.ok) closeTheSheet();
      });
      row.append(markEl(view.players[p], 22), el('span', '', view.players[p].name), el('span', 'ktan-who-sub', t('ktan.cardsN', { n: view.players[p].cards })), el('span', 'ktan-who-st', t('ktan.take')));
      list.append(row);
    }
    sheet([head(t('ktan.takeFrom'), { brow: t('ktan.atRandom'), close: false }), list], { docked: true, label: t('ktan.takeFrom') });
  }

  function showDiscard() {
    ui.sheet = 'discard';
    const owe = view.discard?.[me] || 0;
    const pick = {};
    const hand = myHand();
    const go = button('btn btn-primary btn-block');
    const box = picker(pick, { label: t('ktan.giveBack'), max: (res) => hand[res] || 0, note: (res) => t('ktan.ofN', { n: hand[res] || 0 }), onChange: () => check() });
    const check = () => {
      const n = total(pick);
      go.disabled = n !== owe;
      go.textContent = t('ktan.giveBackBtn', { n: owe });
    };
    go.addEventListener('click', async () => {
      const r = await act({ type: 'discard', cards: Object.fromEntries(RES.filter((x) => pick[x] > 0).map((x) => [x, pick[x]])) });
      if (r.ok) closeTheSheet();
    });
    check();
    sheet([head(t('ktan.giveBackN', { n: owe }), { brow: t('ktan.sevenRolled'), close: false }), el('p', 't-note', t('ktan.giveBackNote', { n: owe })), box, go], { docked: true, label: t('ktan.giveBackN', { n: owe }) });
  }

  function showHarvest() {
    ui.sheet = 'harvest';
    const pick = {};
    const go = button('btn btn-primary btn-block', t('ktan.take'));
    const box = picker(pick, {
      label: t('ktan.fromBank'),
      max: (res) => Math.min(view.bank?.[res] ?? 19, (pick[res] || 0) + 2 - total(pick)),
      note: (res) => t('ktan.inBank', { n: view.bank?.[res] ?? 0 }),
      onChange: () => (go.disabled = total(pick) !== 2),
    });
    go.disabled = true;
    go.addEventListener('click', async () => {
      const res = RES.flatMap((r) => Array(pick[r] || 0).fill(r));
      const r = await act({ type: 'play', card: 'harvest', res });
      if (r.ok) closeTheSheet();
    });
    sheet([head(t('ktan.card.harvest'), { brow: t('ktan.takeTwo') }), box, go], { label: t('ktan.card.harvest') });
  }

  function showTribute() {
    ui.sheet = 'tribute';
    let chosen = null;
    const go = button('btn btn-primary btn-block', t('ktan.play'));
    go.disabled = true;
    const cells = el('div', 'ktan-cells');
    for (const res of RES) {
      const b = button('ktan-cell is-pick', '', () => {
        chosen = res;
        for (const x of cells.children) x.setAttribute('aria-pressed', String(x === b));
        go.disabled = false;
        go.textContent = t('ktan.tributeOf', { res: resName(res, 2) });
      });
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', resName(res, 2));
      b.append(cardEl(res, 54));
      cells.append(b);
    }
    go.addEventListener('click', async () => {
      const r = await act({ type: 'play', card: 'tribute', res: chosen });
      if (r.ok) closeTheSheet();
    });
    sheet([head(t('ktan.card.tribute'), { brow: t('ktan.nameOne') }), el('p', 't-note', t('ktan.tributeNote')), cells, go], { label: t('ktan.card.tribute') });
  }

  function playCard(kind) {
    if (kind === 'harvest') return showHarvest();
    if (kind === 'tribute') return showTribute();
    act({ type: 'play', card: kind });
  }
  const canPlay = (kind, fresh) =>
    kind !== 'vp' && !fresh && me === view.current && (view.phase === 'roll' || view.phase === 'main') && !view.players[me]?.played && (view.players[me]?.dev || []).some((d) => d.kind === kind && !d.fresh);

  // ----- What a card says when picked up (inspect.js) -----

  function earnedOn(res) {
    const out = [];
    view.island.tiles.forEach((tl, i) => {
      if (tl.res !== res) return;
      for (const c of isle?.geo.tiles[i].corners || []) {
        const b = view.buildings?.[c];
        if (b && b.p === me) out.push({ num: tl.num, n: b.kind === 'city' ? 2 : 1 });
      }
    });
    return out.sort((a, b) => a.num - b.num);
  }
  function cardInfo(card) {
    const kind = card.kind;
    if (card.square) {
      const holder = kind === 'longest' ? view.awards?.road : view.awards?.army;
      const facts = [[t('ktan.heldBy'), holder === null || holder === undefined ? t('ktan.nobody') : nameOf(holder)]];
      if (kind === 'longest') facts.push([t('ktan.yourRoad'), t('ktan.roadsN', { n: view.players[me]?.road ?? 0 })]);
      else facts.push([t('ktan.yourKnights'), t('ktan.knightsN', { n: view.players[me]?.knights ?? 0 })]);
      return { brow: t('ktan.worth2'), title: t(`ktan.card.${kind}`), text: t(`ktan.about.${kind}`), facts };
    }
    if (RES.includes(kind)) {
      const n = myHand()[kind] || 0;
      return {
        brow: t('ktan.resourceHeld', { n }), title: t(`ktan.card.${kind}`), text: t(`ktan.about.${kind}`),
        earned: earnedOn(kind), builds: BUILDS.filter((b) => COST[b][kind]), rate: me !== null && me !== undefined ? rateOf(view, me, kind) : 4,
        action: me === view.current && view.phase === 'main' ? { label: t('ktan.tradeRes', { res: resName(kind, 2) }), run: () => openTrade({ res: kind }) } : null,
      };
    }
    if (kind === 'back') return { brow: t('ktan.everyCard'), title: t('ktan.back'), text: t('ktan.about.back') };
    const playable = canPlay(kind, card.fresh);
    let why = '';
    if (kind !== 'vp' && !playable) {
      why = card.fresh ? t('ktan.why.fresh') : view.players[me]?.played ? t('ktan.why.played') : me !== view.current ? t('ktan.why.notTurn') : t('ktan.why.notNow');
    }
    const facts = [];
    if (kind === 'knight') facts.push([t('ktan.youPlayed'), t('ktan.knightsN', { n: view.players[me]?.knights ?? 0 })], [t('ktan.card.army'), view.awards?.army === null || view.awards?.army === undefined ? t('ktan.nobody') : nameOf(view.awards.army)]);
    if (kind === 'vp') facts.push([t('ktan.yourPoints'), String(view.players[me]?.points ?? 0)]);
    if (kind === 'roads') facts.push([t('ktan.roadsLeft'), String(view.players[me]?.pieces?.road ?? 0)]);
    if (kind === 'harvest') facts.push([t('ktan.inTheBank'), RES.map((r) => `${view.bank?.[r] ?? 0}`).join(' · ')]);
    return {
      brow: t('ktan.devCard'), title: t(`ktan.card.${kind}`), text: t(`ktan.about.${kind}`), facts, note: why,
      action: kind === 'vp' ? null : { label: t('ktan.playName', { name: t(`ktan.card.${kind}`) }), disabled: !playable, run: () => playCard(kind) },
    };
  }

  // ----- The guide, the end, the log, the rules -----

  function openGuide() {
    const P = view.players[me ?? 0];
    const rows = BUILDS.map((kind) => {
      const row = el('div', 'ktan-guide-row');
      row.append(pieceEl(kind, 44, 36, P));
      const text = el('div', 'ktan-guide-text');
      text.append(el('span', 't-heading', t(`ktan.build.${kind}`)), el('span', 't-note', t(`ktan.guide.${kind}`)));
      row.append(text);
      const cost = el('span', 'ktan-sum-cards');
      for (const [res, n] of Object.entries(COST[kind])) for (let i = 0; i < n; i++) cost.append(cardEl(res, 18));
      row.append(cost);
      return row;
    });
    const awards = ['longest', 'army'].map((kind) => {
      const row = el('div', 'ktan-guide-award');
      row.append(cardEl(kind, 70, { square: true }));
      const holder = kind === 'longest' ? view.awards?.road : view.awards?.army;
      const text = el('div', 'ktan-guide-text');
      text.append(el('strong', '', t(`ktan.card.${kind}`)), el('span', 't-note', t(`ktan.about.${kind}`)), el('span', 'eyebrow ktan-held', holder === null || holder === undefined ? t('ktan.heldByNobody') : t('ktan.heldByName', { name: nameOf(holder) })));
      row.append(text);
      return row;
    });
    const d = dom.sheet2;
    const inner = el('div', 'sheet-inner');
    const h = el('div', 'sheet-head');
    h.append(el('h2', 't-heading', t('ktan.guide')), el('span', 'eyebrow', t('ktan.whatCosts')));
    const x = button('icon-btn');
    x.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
    x.setAttribute('aria-label', t('common.close'));
    x.addEventListener('click', () => closeSheet(d));
    h.append(x);
    inner.append(h, ...rows, el('p', 'eyebrow', t('ktan.worth2')), ...awards);
    d.replaceChildren(inner);
    d.onclose = () => dom.guideBtn.setAttribute('aria-expanded', 'false');
    dom.guideBtn.setAttribute('aria-expanded', 'true');
    openSheet(d);
  }

  function openEnd() {
    ui.sheet = 'end';
    const order = view.players.map((_, i) => i).sort((a, b) => (view.players[b].points ?? 0) - (view.players[a].points ?? 0));
    const list = el('div', 'ktan-final');
    for (const p of order) {
      const P = view.players[p];
      const row = el('div', 'ktan-who');
      const vp = (P.dev || []).filter((d) => d.kind === 'vp').length;
      const bits = [];
      if (view.awards?.road === p) bits.push(t('ktan.card.longest'));
      if (view.awards?.army === p) bits.push(t('ktan.card.army'));
      if (vp) bits.push(t('ktan.vpCards', { n: vp }));
      row.append(markEl(P, 22), el('span', '', P.name), el('span', 'ktan-who-sub', bits.join(' · ')), el('span', 'ktan-who-st', String(P.points ?? 0)));
      list.append(row);
    }
    const winner = view.players[view.winner];
    const out = [head(view.winner === me ? t('ktan.youWin') : t('ktan.wins', { name: winner?.name }), { brow: t('ktan.finalPoints'), close: true, mark: winner }), list];
    const again = session.canRestart?.() ? button('btn btn-primary btn-block', t('ktan.newGame'), () => {
      closeTheSheet();
      session.restart();
    }) : null;
    const leave = el('a', 'btn btn-block', t('common.back'));
    leave.href = '/';
    out.push(actions(leave, again));
    sheet(out, { docked: true, label: t('ktan.gameOver') });
  }

  function openLog() {
    const list = el('ul', 'ktan-log');
    for (const e of [...(view.log || [])].reverse()) {
      const line = logLine(e);
      if (!line) continue;
      const li = el('li');
      const p = e.p ?? e.to ?? e.a ?? null;
      if (p !== null && p !== undefined && view.players[p]) li.append(markEl(view.players[p], 18));
      li.append(el('span', '', line));
      list.append(li);
    }
    sheet([head(t('ktan.log')), list.children.length ? list : el('p', 't-note', t('ktan.logEmpty'))], { label: t('ktan.log') });
  }
  function logLine(e) {
    const n = (p) => nameOf(p);
    switch (e.t) {
      case 'roll': return t('ktan.log.roll', { name: n(e.p), sum: e.sum });
      case 'build': case 'setup': return t(`ktan.log.build.${e.kind}`, { name: n(e.p) });
      case 'buy': return t('ktan.log.buy', { name: n(e.p) });
      case 'play': return t('ktan.log.play', { name: n(e.p), card: t(`ktan.card.${e.card}`) });
      case 'robber': return t('ktan.log.robber', { name: n(e.p), tile: tileName(e.tile) });
      case 'steal': return e.res ? t('ktan.log.stealRes', { name: n(e.to), from: n(e.from), res: resName(e.res) }) : t('ktan.log.steal', { name: n(e.to), from: n(e.from) });
      case 'trade': return t('ktan.log.trade', { a: n(e.a), b: n(e.b), give: listCards(e.give), want: listCards(e.want) });
      case 'bank': return t('ktan.log.bank', { name: n(e.p), give: listCards(e.give), want: listCards(e.want) });
      case 'discard': return t('ktan.log.discard', { name: n(e.p), n: e.n ?? total(e.cards) });
      case 'award': return t(`ktan.log.award.${e.kind}`, { name: n(e.to) });
      case 'tribute': return t('ktan.log.tribute', { name: n(e.p), res: resName(e.res, 2), n: (e.from || []).reduce((s, f) => s + f.n, 0) });
      case 'harvest': return t('ktan.log.harvest', { name: n(e.p), cards: (e.res || []).map((r) => resName(r)).join(t('ktan.and')) });
      case 'win': return t('ktan.log.win', { name: n(e.p) });
      default: return '';
    }
  }
  const tileName = (i) => {
    const tl = view.island.tiles[i];
    return tl.res === 'desert' ? t('ktan.desert') : `${t(`ktan.card.${tl.res}`)} ${tl.num}`;
  };

  /* ---------- What happened: events, played out ---------- */

  function play(events, prev) {
    const run = animating.then(() => playNow(events, prev)).catch((err) => console.error(err));
    animating = run;
    return run;
  }

  async function playNow(events, prev) {
    if (!events?.length || destroyed) return;
    const lastAt = {}; // where each player last built in these events: a setup's gain comes off its tiles
    for (const e of events) {
      if ((e.t === 'setup' || e.t === 'build') && e.kind === 'settlement') lastAt[e.p] = e.at;
      if (e.t === 'gain' && e.at === undefined) e.at = lastAt[e.p];
      switch (e.t) {
        case 'roll': await rolled(e); break;
        case 'produce': produced(e); break;
        case 'gain': gained(e, prev); break;
        case 'build': case 'setup': await built(e); break;
        case 'robber': await robbed(e, prev); break;
        case 'steal': stole(e); break;
        case 'discard': discarded(e); break;
        case 'buy': bought(e); break;
        case 'play': audio.play('card'); if (e.p !== me) fx.rise(t(`ktan.card.${e.card}`), ...chipAt(e.p), { size: 15 }); break;
        case 'harvest': harvested(e); break;
        case 'tribute': tributed(e); break;
        case 'trade': traded(e); break;
        case 'bank': banked(e); break;
        case 'award': awarded(e); break;
        case 'turn': turned(e); break;
        case 'win': audio.play('win'); break;
        default: break;
      }
    }
  }

  async function rolled(e) {
    say(t('ktan.log.roll', { name: nameOf(e.p), sum: e.sum }));
    show.lit = 0;
    dirtyPicture();
    if (tableIn()) {
      // the dice roll on the table, and their number shows there: about 2.8 s before the harvest
      await sleep(2800);
      if (e.sum === 7) ui.rollLine = t('ktan.rolledSeven');
      return;
    }
    audio.play('dice');
    await new Promise((resolve) => dice.roll(e.dice, resolve));
    if (L?.board) {
      const [x, y] = bankAt();
      fx.number(e.sum, x, y, clamp(Math.min(L.board.w * 0.1, L.board.h * 0.15), 28, 64), { life: 1.05 });
      await sleep(1050);
    }
    if (e.sum !== 7) {
      show.lit = e.sum;
      dirtyPicture();
    } else ui.rollLine = t('ktan.rolledSeven');
  }

  // At a table with no board here, cards cross the table and leave it by their player's edge: yours
  // then drop into the phone from the top, on the beat they leave the table (tableAt, s), and the
  // others' only count on their chips.
  const tableIn = () => atTable && !L?.board;
  function cardsTo(p, res, n, from, { delay = 0, turn = false, back = false, tableAt, tableGap = 0.13 } = {}) {
    for (let i = 0; i < n; i++) {
      const d = tableIn() && tableAt !== undefined ? tableAt + i * tableGap : delay + i * 0.13;
      if (tableIn()) {
        if (p === me && res) {
          flying.hand[res]++;
          const held = shownHand(res);
          setTimeout(() => stackOpen(res, 320), Math.max(0, (d + (turn ? 0.82 : 0.55) - 0.32) * 1000));
          fx.drop(res, stackTop(res, held + 1), handW(res), {
            delay: d, turn,
            done: () => {
              flying.hand[res] = Math.max(0, flying.hand[res] - 1);
              paintStack(res);
              stackLand(res);
              audio.play('deal');
              renderShelf();
            },
          });
        } else {
          flying.chips[p] = (flying.chips[p] || 0) + 1;
          setTimeout(() => {
            flying.chips[p] = Math.max(0, (flying.chips[p] || 0) - 1);
            flash(p);
            renderChips();
          }, (d + 0.5) * 1000);
        }
        continue;
      }
      if (p === me && res) {
        flying.hand[res]++;
        const held = shownHand(res);
        setTimeout(() => stackOpen(res, 320), Math.max(0, (d + 0.9 - 0.32) * 1000));
        fx.card(turn || back ? (back ? 'back' : res) : res, from, stackTop(res, held + 1), {
          w0: 22, w1: handW(res), delay: d, dur: 0.9, arc: 30, turn,
          done: () => {
            flying.hand[res] = Math.max(0, flying.hand[res] - 1);
            paintStack(res);
            stackLand(res);
            audio.play('deal');
            renderShelf();
          },
        });
      } else {
        flying.chips[p] = (flying.chips[p] || 0) + 1;
        fx.card(back || !res ? 'back' : res, from, chipAt(p), {
          w0: 24, w1: 20, delay: d, dur: 0.9, arc: 30,
          done: () => {
            flying.chips[p] = Math.max(0, (flying.chips[p] || 0) - 1);
            flash(p);
            renderChips();
          },
        });
      }
    }
    renderChips();
    if (p === me && res) paintStack(res);
  }
  function cardsFrom(p, res, n, to, { delay = 0, back = false } = {}) {
    // at a table yours leave over the top of the phone (toward the table), the others' only count
    if (tableIn() && p !== me) return setTimeout(() => flash(p), delay * 1000);
    for (let i = 0; i < n; i++) {
      const d = delay + i * 0.08;
      const from = p === me && res ? stackTop(res, shownHand(res) + n - i) : chipAt(p);
      const dest = tableIn() ? [from[0] + (i - (n - 1) / 2) * 12, -120, 0] : to;
      fx.card(back || !res ? 'back' : res, from, dest, { w0: p === me && res ? handW(res) : 20, w1: tableIn() ? handW(res) : 24, delay: d, dur: tableIn() ? 0.45 : 0.8, arc: tableIn() ? 0 : 40 });
    }
    if (p !== me) setTimeout(() => flash(p), delay * 1000);
  }

  function produced(e) {
    let mine = {};
    // the table deals by player, in the order they first earn, a card every 0.13 s, each leaving it
    // about 1.1 s after it lifts off its tile
    const groups = new Map();
    for (const g of e.gains || []) {
      if (!groups.has(g.p)) groups.set(g.p, []);
      groups.get(g.p).push(g);
    }
    const firstJ = new Map();
    let jj = 0;
    for (const list of groups.values()) for (const g of list) {
      firstJ.set(g, jj);
      jj += g.n;
    }
    (e.gains || []).forEach((g, j) => {
      cardsTo(g.p, g.res, g.n, tileAt(g.tile), { delay: j * 0.06, tableAt: 1.1 + firstJ.get(g) * 0.13 });
      if (g.p === me) mine[g.res] = (mine[g.res] || 0) + g.n;
    });
    const got = listCards(mine);
    const roll = view.dice ? view.dice[0] + view.dice[1] : '';
    ui.rollLine = got ? t('ktan.rolledGot', { n: roll, cards: got }) : t('ktan.rolledN', { n: roll });
    if (got) say(t('ktan.youTake', { cards: got }));
    renderStatus();
  }
  function gained(e) {
    // the second settlement of the setup: one of each resource round it, off its tiles
    const at = e.at ?? null;
    const tiles = at !== null && isle ? isle.geo.corners[at].tiles : [];
    let j = 0;
    for (const r of RES) {
      for (let k = 0; k < (e.cards?.[r] || 0); k++) {
        const tile = tiles.find((i) => view.island.tiles[i].res === r);
        cardsTo(e.p, r, 1, tile !== undefined && L?.board ? tileAt(tile) : bankAt(), { delay: 0.3 + j * 0.12, tableAt: 1.0 + j * 0.13 });
        j++;
      }
    }
  }

  async function built(e) {
    audio.play('build');
    const P = view.players[e.p];
    if (!isleReady || !fit || !L?.board) return;
    // your own build: its cost flies from your hand onto the board
    if (e.t === 'build' && e.p === me && COST[e.kind]) {
      const to = onScreen(e.kind === 'road' ? edgeMid(e.at) : isle.cornerPx(fit, e.at));
      let j = 0;
      for (const [res, n] of Object.entries(COST[e.kind])) for (let i = 0; i < n; i++) fx.card(res, stackTop(res, shownHand(res) + 1), to, { w0: handW(res), w1: 10, delay: j++ * 0.1, dur: 0.7, arc: 50 });
      await sleep(700 + j * 100);
    }
    // the piece is made where it stands: a swell of light, it grows from 55 % and settles, a ring of the colour
    const c = A.rgbOf(P.color), t0 = performance.now() / 1000;
    if (e.kind === 'road') {
      const [a, z] = isle.edgePx(fit, e.at);
      overlay.push((g, t) => {
        const f = (t - t0) / 0.8;
        if (f >= 1) return false;
        const S = fit.S;
        g.glow((a[0] + z[0]) / 2, (a[1] + z[1]) / 2, 0.55 * S, 0.3 * S, 0, [255, 236, 190, 0.55 * (1 - f)]);
        return true;
      });
    } else {
      const [x, y] = isle.cornerPx(fit, e.at), cx = isle.corners[e.at][0], cy = isle.corners[e.at][1];
      show.hide = { x: cx, y: cy };
      show.fadeMs = 0;
      paintPicture();
      const it = { t: e.kind, x: cx, y: cy, lift: A.SLAB, yaw: 0, col: P.color, mark: P.mark, key: e.kind + P.color + P.mark };
      overlay.push((g, t) => {
        const a = t - t0, S = fit.S;
        if (a > 0.9) return false;
        const fl = clamp(a / 0.14, 0, 1) * (1 - clamp((a - 0.14) / 0.46, 0, 1));
        g.glow(x, y - 0.12 * S, 0.42 * S, 0.42 * S * A.K + 0.1 * S, 0, [255, 236, 190, 0.75 * fl]);
        const sc = reduce() ? 1 : 0.55 + 0.45 * A.bezier(0.2, 0.9, 0.3, 1.3)(clamp(a / 0.36, 0, 1));
        drawSprite(it, { sc, up: reduce() ? 0 : 0.12 * S * (1 - A.easeOut(clamp(a / 0.3, 0, 1))) });
        if (!reduce() && a < 0.8) {
          const f = a / 0.8, r = (0.2 + 0.55 * A.easeOut(f)) * S;
          g.ring(x, y, r, r * A.K, 0, 3.5 * (1 - f) + 1, [...c, 0.9 * (1 - f)]);
        }
        return true;
      });
      boardLoop();
      await sleep(400);
      show.hide = null;
      show.fadeMs = 0;
      paintPicture();
    }
    boardLoop();
  }

  async function robbed(e, prev) {
    audio.play('robber');
    if (!isleReady || !fit || !L?.board) return;
    const from = prev?.robber ?? view.robber, to = e.tile;
    ui.robberAt = null;
    if (from === to || reduce()) return dirtyPicture();
    show.robber = -1;
    show.fadeMs = 0;
    paintPicture();
    const a0 = isle.robberAt(from, phi), a1 = isle.robberAt(to, phi), t0 = performance.now() / 1000, S = fit.S;
    await new Promise((resolve) => {
      overlay.push((g, t) => {
        const a = t - t0;
        let up, f;
        if (a < 0.45) { up = 0.32 * S * A.easeOut(a / 0.45); f = 0; }
        else { f = clamp((a - 0.45) / 0.85, 0, 1); up = 0.32 * S * (1 - Math.pow(clamp((f - 0.72) / 0.28, 0, 1), 3)) + 70 * Math.sin(Math.PI * f) * (1 - clamp((f - 0.72) / 0.28, 0, 1)); }
        const e2 = A.easeInOut(f), x = a0[0] + (a1[0] - a0[0]) * e2, y = a0[1] + (a1[1] - a0[1]) * e2;
        const [px, py] = isle.toScreen(fit, x, y, A.SLAB);
        g.ellipse(px + up * 0.35, py + up * 0.18, 0.1 * S, 0.1 * S * A.K, 0, [10, 8, 22, 0.45], 0.04 * S);
        drawSprite({ t: 'robber', x, y, lift: A.SLAB, key: 'robber' }, { up, shadow: false });
        if (a >= 1.3) {
          resolve();
          return false;
        }
        return true;
      });
      boardLoop();
    });
    show.robber = undefined;
    show.fadeMs = 0;
    paintPicture();
    // a ring of dust where he lands
    const [lx, ly] = isle.toScreen(fit, a1[0], a1[1], A.SLAB), t1 = performance.now() / 1000;
    overlay.push((g, t) => {
      const f = (t - t1) / 0.55;
      if (f >= 1) return false;
      const r = (0.1 + 0.22 * A.easeOut(f)) * S;
      g.ring(lx, ly, r, r * A.K, 0, 2, [232, 220, 192, 0.6 * (1 - f)]);
      return true;
    });
    boardLoop();
  }

  function stole(e) {
    audio.play('steal');
    if (e.to === me) cardsTo(me, e.res, 1, chipAt(e.from), { turn: true, tableAt: 1.0 });
    else if (e.from === me) cardsFrom(me, e.res, 1, chipAt(e.to));
    else cardsTo(e.to, null, 1, chipAt(e.from), { back: true });
  }
  function discarded(e) {
    if (e.p === me && e.cards) {
      for (const r of RES) if (e.cards[r]) cardsFrom(me, r, e.cards[r], bankAt());
    } else if (e.p !== me) {
      cardsFrom(e.p, null, e.n ?? 1, bankAt(), { back: true });
      fx.rise(`−${e.n ?? total(e.cards)}`, ...chipAt(e.p));
    }
  }
  function bought(e) {
    audio.play('card');
    if (e.p === me) {
      // the card you drew comes up off the deck (its tile in the panel), turns over for you to see,
      // and goes to your cards (under the panel while it's open)
      const deck = dom.sheet.open && ui.sheet === 'build' ? dom.sheet.querySelector('.ktan-place canvas') : null;
      const r = deck?.getBoundingClientRect();
      const from = r ? [r.left + r.width / 2, r.top + r.height / 2] : bankAt();
      const w = clamp(Math.round(Math.min(innerWidth, innerHeight) * 0.3), 96, 150);
      flying.dev++;
      if (e.kind) say(t('ktan.youDrew', { name: t(`ktan.card.${e.kind}`) }));
      fx.reveal(e.kind || 'back', from, bankAt(), shelfAt(), { w0: 26, w, w1: L?.shelf.cw || 50, done: () => { flying.dev--; renderShelf(); } });
      for (const [res, n] of Object.entries(COST.dev)) cardsFrom(me, res, n, from);
    } else {
      fx.card('back', bankAt(), chipAt(e.p), { w0: 30, w1: 20, dur: 0.9, arc: 40, done: () => flash(e.p) });
    }
  }
  function harvested(e) {
    (e.res || []).forEach((r, i) => cardsTo(e.p, r, 1, bankAt(), { delay: i * 0.15, tableAt: 1.6 + i * 0.15 }));
  }
  function tributed(e) {
    let j = 0;
    for (const f of e.from || []) {
      if (f.p === me) cardsFrom(me, e.res, f.n, e.p === me ? shelfAt() : chipAt(e.p));
      else cardsTo(e.p, e.p === me ? e.res : null, f.n, chipAt(f.p), { delay: j * 0.18, back: e.p !== me, tableAt: 1.5 + j * 0.12, tableGap: 0.12 });
      j += f.n;
      if (f.n) fx.rise(`−${f.n}`, ...chipAt(f.p), { delay: 0.1 });
    }
  }
  function traded(e) {
    audio.play('trade');
    const give = (a, b, cards) => {
      let i = 0;
      for (const r of RES) if (cards?.[r]) {
        // at a table both sets cross it 0.5 s after the deal, 1.5 s each, 0.12 s apart
        if (a === me) cardsFrom(me, r, cards[r], chipAt(b));
        else if (b === me) cardsTo(me, r, cards[r], chipAt(a), { delay: 0.2, tableAt: 1.55 + i * 0.12, tableGap: 0.12 });
        else cardsTo(b, null, cards[r], chipAt(a), { back: true, tableAt: 1.55 + i * 0.12, tableGap: 0.12 });
        i += cards[r];
      }
    };
    give(e.a, e.b, e.give);
    give(e.b, e.a, e.want);
    closeOfferSheets();
    if ((e.a === me || e.b === me) && ui.trade?.counter == null) ui.trade = null;
  }
  function banked(e) {
    audio.play('trade');
    for (const r of RES) if (e.give?.[r]) {
      if (e.p === me) cardsFrom(me, r, e.give[r], bankAt());
      else cardsFrom(e.p, r, e.give[r], bankAt());
    }
    let j = 0;
    const paid = RES.reduce((n, r) => n + (e.give?.[r] || 0), 0);
    for (const r of RES) if (e.want?.[r]) {
      // at a table: the paid cards sink into the bank first, then the bank's cross to the edge
      cardsTo(e.p, e.p === me ? r : null, e.want[r], bankAt(), { delay: 0.4 + j * 0.1, back: e.p !== me, tableAt: 0.95 + (paid - 1) * 0.12 + 0.5 + j * 0.12, tableGap: 0.12 });
      j += e.want[r];
    }
  }
  function awarded(e) {
    if (e.to === null || e.to === undefined) return;
    audio.play('award');
    fx.rise('+2', ...chipAt(e.to), { size: 24 });
    say(t(`ktan.log.award.${e.kind}`, { name: nameOf(e.to) }));
  }
  function turned(e) {
    show.lit = 0;
    dirtyPicture();
    ui.rollLine = '';
    ui.seenOffers.clear();
    if (e.p === me) {
      audio.play('turn');
      say(t('ktan.yourTurnNow'));
    }
  }
  function closeOfferSheets() {
    if (['offer', 'waiting', 'ask'].includes(ui.sheet)) closeTheSheet();
  }

  /* ---------- Taking a view ---------- */

  function sheetsFor() {
    if (me === null || me === undefined) return;
    const ph = view.phase;
    // the robber's choice and giving back cards come first, docked
    if (ph === 'discard' && view.discard?.[me] > 0) {
      if (ui.sheet !== 'discard') showDiscard();
      return;
    }
    if (ui.sheet === 'discard') closeTheSheet();
    if (ph === 'steal' && view.current === me) {
      if (ui.sheet !== 'steal') showSteal();
      return;
    }
    if (ui.sheet === 'steal') closeTheSheet();
    if (ph === 'over') {
      if (ui.sheet !== 'end') setTimeout(() => !destroyed && openEnd(), reduce() ? 0 : 1600);
      return;
    }
    // offers to you
    const offer = view.offers?.find((o) => o.from !== me && (o.to === me || o.to === 'all') && session.kind !== 'local');
    if (offer) {
      const answered = offer.answers?.[me];
      if (answered === 'no') return;
      if (ui.sheet === 'offer' && ui.offerId === offer.id) {
        if (answered === 'yes' && offer.to === 'all') showOffer(offer);
        return;
      }
      if (!ui.sheet || ui.sheet === 'offer') showOffer(offer);
      return;
    }
    if (ui.sheet === 'offer') closeTheSheet();
    // your own open offer: its answers come in; on one phone its player's sheet goes once they answer
    const mine = view.offers?.find((o) => o.from === me);
    if (ui.sheet === 'waiting') {
      if (mine) showWaiting(mine);
      else closeTheSheet();
    }
    if (ui.sheet === 'ask' && (!mine || mine.answers?.[mine.to])) closeTheSheet();
  }

  function update(next) {
    const prev = view;
    view = next.view;
    if (atTable && next.placing !== undefined) tablePlacing = next.placing;
    if (session.me !== me) {
      fx.clear();
      for (const r of RES) flying.hand[r] = 0;
      flying.chips = {};
      flying.dev = 0;
      for (const s of stacks.values()) Object.assign(s, { open: 0, age: 9, close: 1, gone: 0 });
      animating = Promise.resolve();
      ui.pick = null;
      ui.at = null;
      ui.trade = null;
      ui.robberAt = null;
    }
    me = session.me;
    if (atTable && Number.isFinite(session.phi) && session.phi !== phi) {
      phi = session.phi;
      refit();
    }
    if ((!isle || (!isleReady && L?.board)) && view.island) build(view.island);
    // pieces made while you chose, and turns that moved on, put the choosers back
    if (ui.pick && ui.pick !== 'dev' && !(view.phase === 'main' || view.phase === 'sbp')) ui.pick = null;
    if (view.phase !== 'robber') ui.robberAt = null;
    if (ui.at !== null) {
      const c = choosing();
      if (!c || !spotsFor(c.kind).includes(ui.at)) ui.at = null;
    }
    // Build and Trade close once the turn has moved past building and trading, or the offer being
    // countered has gone
    const counterGone = ui.sheet === 'trade' && ui.trade?.counter != null && !view.offers?.some((o) => o.id === ui.trade.counter);
    if ((['build', 'trade'].includes(ui.sheet) && !(view.phase === 'main' || view.phase === 'sbp')) || counterGone) closeTheSheet();
    if (prev.players.length !== view.players.length || !L) layout();
    if (next.events?.length) play(next.events, prev).then(() => !destroyed && renderAll());
    if (!next.events?.some((e) => e.t === 'roll')) {
      const lit = litOf(view);
      if (lit !== show.lit && !next.events?.some((e) => e.t === 'turn')) show.lit = lit;
    }
    dirtyPicture();
    renderAll();
    sheetsFor();
    coverCheck();
  }

  /* ---------- A game on one phone: handing it round ---------- */

  function coverCheck() {
    if (session.kind !== 'local') return;
    const who = session.whoActs();
    if (who === null || who === undefined || who === session.me) {
      dom.cover.hidden = true;
      return;
    }
    if (coverFor === who) return;
    coverFor = who;
    const P = view.players[who];
    const m = $('coverMark');
    m.replaceChildren(markEl(P, 64));
    $('coverBrow').textContent = view.phase === 'discard' ? t('ktan.sevenRolled') : view.phase === 'setup' ? t('ktan.setup') : t('ktan.nextPlayer');
    $('coverTitle').textContent = t('ktan.passTo', { name: P.name });
    $('coverNote').textContent = view.phase === 'discard' ? t('ktan.passDiscard', { name: P.name }) : t('ktan.passNote');
    const btn = $('coverBtn');
    btn.textContent = t('ktan.imName', { name: P.name });
    btn.onclick = () => {
      audio.unlock();
      coverFor = null;
      dom.cover.hidden = true;
      closeTheSheet();
      session.hold(who);
    };
    dom.cover.hidden = false;
    closeTheSheet();
  }

  /* ---------- Wiring ---------- */

  dom.guideBtn.hidden = false;
  dom.guideBtn.onclick = () => openGuide();
  // At a table a board button brings the island onto this phone (solid while it is); the table then
  // takes no taps for this player, and the choice is kept per phone.
  dom.boardBtn.hidden = !atTable;
  document.body.classList.toggle('has-board-btn', atTable);
  const syncBoard = () => dom.boardBtn.setAttribute('aria-pressed', String(!!ui.showBoard));
  if (atTable) {
    syncBoard();
    dom.boardBtn.onclick = () => {
      audio.unlock();
      ui.showBoard = !ui.showBoard;
      table.setBoard?.(ui.showBoard);
      session.board?.(ui.showBoard);
      syncBoard();
      layout();
      if (ui.showBoard && !isleReady && view.island) build(view.island);
    };
    session.board?.(ui.showBoard);
  }
  const unsub = session.subscribe((next) => update(next));
  const onResize = () => layout();
  addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  layout();
  update({ view, events: [] });

  function destroy() {
    destroyed = true;
    unsub?.();
    removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    probe.remove();
    document.body.classList.remove('has-board-btn');
    dom.boardBtn.hidden = true;
    closeThrow();
    piecesBox.remove();
    fx.clear();
    closeTheSheet();
    dom.cover.hidden = true;
    cancelAnimationFrame(boardRaf);
  }

  return {
    destroy, layout, openLog, openGuide,
    /** For checks in a browser: where each place the piece being placed may go is on the screen. */
    spots() {
      const c = choosing();
      if (!c || !isleReady || !fit) return [];
      return spotsFor(c.kind).map((id) => ({ id, at: c.kind === 'robber' ? tileAt(id) : c.kind === 'road' ? onScreen(edgeMid(id)) : cornerAt(id) }));
    },
    get ready() { return isleReady; },
    get ui() { return ui; },
    get me() { return me; },
    get view() { return view; },
    showBoard(on) {
      ui.showBoard = on;
      layout();
    },
    leave: onLeave, room: onRoom,
  };
}
