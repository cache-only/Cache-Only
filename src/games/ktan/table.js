// The table (KTAN.md B4, and the proposals page's table): an iPad lying flat in the middle of the
// real table. It hosts the room and shows only what everyone may see: the island, drawn for whoever
// is playing and swinging round to the next player as the turn passes, the dice and the bank; never
// a hand, and no names. Each player is a glow on the edge in front of them. Cards cross the screen:
// a harvest flies off its tiles out over its owners' edges, a trade crosses from edge to edge, the
// bank is the middle of the island. A phone picks what to place; its places light here, a tap here
// puts its ghost down, and the phone builds it. The robber is moved with a tap here.
//
// Seats are kept in the iPad's own frame (its screen as it was when the room opened, lobby.screen):
// iPadOS turns a flat iPad's screen on its own, so each seat is laid out again on the same physical
// edge whatever the screen does (screen.orientation.angle).
//
// The island is drawn by the GPU (gl.js): the moving sea about 30 times a second, the island's
// picture over it (painted off the screen by island.js), and what happens on it. While the view
// swings round, the picture is painted again each frame at half the pixels, and the sharp one comes
// back as it settles. Glows, answers, the dice and the cards are small elements over it.
import { t } from '../../shared/i18n.js';
import * as A from './art.js';
import { RES } from './board.js';
import { legalSpots } from './rules.js';
import { createIsland } from './island.js';
import { createGL, create2D } from './gl.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { markSvg, iconSvg, signSvg } from './marks.js';
import { nameCards } from './game.js';

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reduce = () => reduceQuery.matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
const TAU = Math.PI * 2;
const wrapPi = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const $ = (id) => document.getElementById(id);
const flyEase = A.bezier(0.45, 0.05, 0.4, 1);
const later = (s) => new Promise((r) => setTimeout(r, reduce() ? Math.min(s, 0.3) * 1000 : s * 1000));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const css = (hex, a = 1) => {
  const [r, g, b] = A.rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// Table units: the proposals page drew the table 1180 x 820; here a unit is the short side / 820.
const CW = 58, CH = CW * 1.4, DIE = 60;
// After both dice stop (s from that moment): they pop, their sum takes their place, and a beat later
// it fades as the island comes back, the number lights and the harvest is dealt.
const REVEAL = { pop: 0.18, num: 0.22, hold: 1.45, out: 0.4, back: 0.5 };

/** How far the screen is turned from the iPad's own frame: 0, 90, 180 or 270. */
function angleNow() {
  const a = screen.orientation?.angle ?? (typeof window.orientation === 'number' ? window.orientation : 0);
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}
// A quarter turn of the screen (the iPad turned the other way) moves each side on to the next, and
// runs a place along it the other way where the side's own direction flips.
const TURN = { left: ['bottom', false], top: ['left', true], right: ['top', false], bottom: ['right', true] };
function turnSeat(at, quarters) {
  let side = at.side, pos = at.pos;
  for (let i = 0; i < quarters; i++) {
    const [next, flip] = TURN[side];
    side = next;
    if (flip) pos = 1 - pos;
  }
  return { side, pos };
}
// The view's angle for a seat on each side: the island drawn for someone sitting there.
const PHI = { bottom: 0, left: Math.PI / 2, top: Math.PI, right: -Math.PI / 2 };
// Where the iPad's camera is, in the frame it was in when the room opened: at the top of the screen
// held upright (most iPads), so a phone's drawing of the table is easy to turn the right way.
const CAMERA = { 0: 'top', 90: 'left', 180: 'bottom', 270: 'right' };

export function createTable(session, { onLeave } = {}) {
  const dom = {
    screen: $('tableScreen'), cv: $('tableCv'), hit: $('tableHit'), glows: $('glows'), lobby: $('tableLobby'),
    code: $('tableCode'), waiting: $('tableWaiting'), start: $('tableStart'), fx: $('fx'), announce: $('announce'),
  };
  nameCards();
  A.setDPR(Math.min(devicePixelRatio || 1, 2));
  A.setSpriteCap(9000);
  const audio = createAudio();
  const fx = createFx(dom.fx, { reduce });
  // the layers made here: the veil and the dice over the island; the glows, answers and lines above
  const veil = el('div', 'ktan-table-veil');
  const diceBox = el('div', 'ktan-table-dice');
  const glowLayer = el('div', 'ktan-table-layer');
  const bubbleLayer = el('div', 'ktan-table-layer');
  const hintLayer = el('div', 'ktan-table-layer');
  dom.screen.insertBefore(veil, dom.glows);
  dom.screen.insertBefore(diceBox, dom.glows);
  dom.glows.replaceChildren(glowLayer, bubbleLayer, hintLayer);

  let destroyed = false;
  let view = session.view;
  let placing = session.placing?.() || null;
  let W = 0, H = 0, u = 1, dpr = 1;
  let ref = session.lobby?.screen || null;
  let seats = [];
  let gl = null;
  let isle = null, isleReady = false, scLow = 60;
  let fit = null, phi = 0, viewSeat = null;
  let shown = null, shownFit = null, slot = 0, fade = null, picKey = null;
  let swing = null, plan = null;
  let raf = 0, lastFrame = 0, seaT0 = performance.now();
  let dice = null;
  let queue = Promise.resolve();
  // Animations under way, by the clock (not by frames, which stop while the page is hidden): until
  // they end the table takes no taps.
  let busyUntil = 0, holdTimer = 0;
  const hold = (s) => {
    busyUntil = Math.max(busyUntil, performance.now() + s * 1000);
    // once they end, the lines and choices they held back show again
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (destroyed) return;
      renderHints();
      renderBubbles();
      kick();
    }, busyUntil - performance.now() + 30);
  };
  const busyNow = () => performance.now() < busyUntil;
  const overlay = new Set(); // (gl, t) => whether it still draws
  // what the picture leaves out or changes while animations show it: pieces not made yet, the robber
  // in the air, the number lit
  const show = { lit: 0, robber: undefined, corners: new Map(), edges: new Set() };
  const glowEls = new Map();
  const bubbles = new Map();

  /* ---------- The frame: the screen, the iPad's own frame and the seats in it ---------- */

  function layout() {
    if (destroyed) return;
    W = dom.screen.clientWidth || innerWidth;
    H = dom.screen.clientHeight || innerHeight;
    u = Math.min(W, H) / 820;
    dpr = Math.min(devicePixelRatio || 1, 2);
    dom.screen.style.setProperty('--u', `${u}px`);
    if (!ref) {
      const a = angleNow();
      ref = { w: Math.round(W), h: Math.round(H), angle: a, camera: CAMERA[a] };
      session.setScreen?.(ref);
    }
    seats = seatsNow();
    tellSeats();
    if (gl) gl.resize(W, H, dpr);
    if (isleReady) {
      if (swing) endSwing(false);
      dropPlan();
      fit = fitFor(phi);
      picKey = null;
      paintRest(0);
      warmNext();
    }
    renderGlows();
    renderBubbles();
    kick();
  }

  /** The players' seats as laid out on the screen now: point on the edge, the view's angle, axes. */
  function seatsNow() {
    const q = ((((angleNow() - (ref?.angle || 0)) % 360) + 360) % 360) / 90;
    const L = session.lobby;
    return (L?.players || []).filter((pl) => pl.at).map((pl) => {
      const { side, pos } = turnSeat(pl.at, q);
      const x = side === 'left' ? 0 : side === 'right' ? W : pos * W;
      const y = side === 'top' ? 0 : side === 'bottom' ? H : pos * H;
      const ph = PHI[side];
      const p = view ? session.seats?.[pl.seat] : null;
      const P = view && p !== undefined && p !== null ? view.players[p] : pl;
      return {
        seat: pl.seat, p: p ?? null, color: P.color, mark: P.mark, side, pos, x, y, phi: ph,
        inward: [Math.sin(ph), -Math.cos(ph)], right: [Math.cos(ph), Math.sin(ph)],
      };
    });
  }
  const seatOf = (p) => seats.find((S) => S.p === p) || null;
  /** Each player's seat as a view angle, so the island on their phone (if they show it) faces them. */
  const tellSeats = () => {
    if (view) session.setSeatPhis?.(Object.fromEntries(seats.filter((S) => S.p !== null).map((S) => [S.p, S.phi])));
  };
  /** A point d units in from a seat's edge, m along it to that player's right (screen px). */
  const inAt = (S, d, m = 0) => [S.x + (S.inward[0] * d + S.right[0] * m) * u, S.y + (S.inward[1] * d + S.right[1] * m) * u];
  /** Out past a seat's edge, toward that player's phone, spread m along it. */
  const outAt = (S, m = 0) => inAt(S, -CH * 0.8, m * 30);
  const whoseTurn = () => (!view ? null : view.phase === 'setup' ? view.setup?.order?.[view.setup.step] ?? view.current : view.phase === 'over' ? view.winner : view.current);
  const seatPhi = (p) => seatOf(p)?.phi ?? 0;

  /* ---------- The island ---------- */

  function estimateS(island) {
    const pts = island.tiles.map(({ q, r }) => A.axial(q, r));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const wx = Math.max(...xs) - Math.min(...xs) + 4.8, wy = Math.max(...ys) - Math.min(...ys) + 4.8;
    // the largest it is laid at: across the long side for the top and bottom seats, or the short side
    const s0 = Math.min((W * 0.96) / wx, (H * 0.95) / (wy * A.K + 0.8));
    const s1 = Math.min((H * 0.96) / wx, (W * 0.95) / (wy * A.K + 0.8));
    return Math.max(s0, s1);
  }
  function build(island) {
    const sc = Math.round(clamp(estimateS(island) * dpr, 60, 300));
    scLow = Math.round(sc / 2);
    isle = createIsland(island, { sc });
    isle.build().then(async () => {
      if (destroyed) return;
      viewSeat = whoseTurn();
      phi = seatPhi(viewSeat);
      await isle.prewarm(view, phi);
      if (destroyed) return;
      isleReady = true;
      fit = fitFor(phi);
      paintRest(0);
      dom.cv.classList.add('blur-in');
      warmNext();
      kick();
    });
  }
  const fitFor = (ph) => isle.fit(ph, W, H, { table: true, fill: [0.96, 0.95] });
  const toScreen = (x, y, h = A.SLAB) => isle.toScreen(fit, x, y, h);
  const tileAt = (i) => isle.tilePx(fit, i);
  const cornerAt = (id) => isle.cornerPx(fit, id);
  const edgeMid = (id) => {
    const [a, b] = isle.edgePx(fit, id);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const bankAt = () => (fit ? toScreen(0, 0) : [W / 2, H / 2]);

  /** The view the picture shows: pieces animations haven't made yet left out (a city still a camp). */
  function pictureView() {
    if (!show.corners.size && !show.edges.size) return view;
    const buildings = {};
    for (const [id, b] of Object.entries(view.buildings || {})) {
      if (!show.corners.has(+id)) buildings[id] = b;
      else if (show.corners.get(+id) === 'settlement') buildings[id] = { ...b, kind: 'settlement' };
    }
    const roads = {};
    for (const [id, p] of Object.entries(view.roads || {})) if (!show.edges.has(+id)) roads[id] = p;
    return { ...view, buildings, roads };
  }

  /** The sharp picture for the view as it is, laid over the sea; it fades in over the last one. */
  function paintRest(fadeMs = 320) {
    if (!isleReady || !fit || !gl || destroyed) return;
    const v = pictureView();
    const key = JSON.stringify([v.roads, v.buildings, v.robber, show.lit, show.robber, W, H, Math.round(phi * 1000)]);
    if (key === picKey) return;
    picKey = key;
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    isle.paint(g, fit, v, { lit: show.lit, dim: show.lit ? 1 : 0, sea: false, robber: show.robber });
    slot = 1 - slot;
    const next = slot ? 'pic:a' : 'pic:b';
    gl.texture(next, c, true);
    fade = shown && !reduce() && fadeMs > 0 ? { from: shown, to: next, t0: performance.now(), dur: fadeMs } : null;
    shown = next;
    shownFit = fit;
    kick();
  }
  /* ---------- The swing: keyframes painted ahead, bent to each angle by the GPU ---------- */

  // A swing's keyframes are the view drawn every 15 degrees of the way (22.5 across the table) at
  // half the pixels, painted while the turn before it is played. Each frame of the swing lays the two
  // nearest, bent to the angle reached by the ground's own map (so the ground moves exactly) and the
  // nearer one stronger; what stands turns in those steps. A frame costs two pictures, nothing painted.
  const viewKey = () => JSON.stringify([view?.buildings, view?.roads, view?.robber, W, H]);
  function makePlan(target) {
    let delta = wrapPi(target - phi);
    if (Math.abs(Math.abs(delta) - Math.PI) < 1e-6) delta = Math.PI;
    if (Math.abs(delta) < 1e-6) return null;
    const step = Math.abs(delta) > 2 ? Math.PI / 8 : Math.PI / 12;
    const n = Math.max(1, Math.round(Math.abs(delta) / step));
    const frames = [];
    for (let i = 0; i <= n; i++) frames.push({ a: phi + (delta * i) / n, key: `kf:${i}`, fit: null, ready: false });
    return { from: phi, delta, target, frames, key: viewKey() };
  }
  function dropPlan() {
    if (!plan) return;
    for (const fr of plan.frames) if (fr.key.startsWith('kf:') && fr.ready) gl.drop(fr.key);
    plan = null;
  }
  function paintKey(fr) {
    if (!isleReady || destroyed) return;
    const k = 0.5, w = Math.max(1, Math.round(W * dpr * k)), h = Math.max(1, Math.round(H * dpr * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    fr.fit = fitFor(fr.a);
    isle.paint(g, fr.fit, view, { lit: 0, sea: false, sc: scLow });
    gl.texture(fr.key, c, true);
    fr.ready = true;
  }
  // Painting ahead waits while anything moves on the table, and goes a slice at a time.
  const idle = () => new Promise((resolve) => {
    const check = () => (destroyed ? resolve() : swing || dice || fade || busyNow() ? setTimeout(check, 250) : resolve());
    setTimeout(check, 80);
  });
  const nextPlayer = () => {
    if (!view) return null;
    if (view.phase === 'setup') return view.setup?.order?.[(view.setup.step ?? 0) + 1] ?? view.current;
    return (view.current + 1) % view.players.length;
  };
  /**
   * The next seat's swing, painted ahead: for each keyframe (the last first), the sprites of its
   * angle a slice at a time, then the keyframe; then the sprites of the sharp picture where it ends.
   */
  let warmTimer = 0;
  function warmNext() {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(async () => {
      if (!isleReady || !view || view.phase === 'over' || swing || destroyed) return;
      const next = nextPlayer();
      if (next === null || next === undefined) return;
      const target = seatPhi(next);
      if (plan && plan.target === target && Math.abs(plan.from - phi) < 1e-6 && plan.key === viewKey()) return;
      dropPlan();
      plan = makePlan(target);
      if (!plan) return;
      const mine = plan, keys = mine.frames.slice(1);
      for (const fr of [keys[keys.length - 1], ...keys.slice(0, -1)]) {
        await idle();
        if (plan !== mine || destroyed) return;
        await isle.prewarm(view, fr.a, scLow);
        await idle();
        if (plan !== mine || destroyed) return;
        if (!fr.ready) paintKey(fr);
      }
      await idle();
      if (plan === mine && !destroyed) await isle.prewarm(view, target);
    }, 900);
  }

  /**
   * The view swings round to a seat: the ground keeps its place on the table and is drawn for the new
   * seat as the angle eases round (0.9 s, 1.25 s across the table); what stands turns as it goes.
   */
  function swingTo(target) {
    if (!isleReady) {
      phi = target;
      return;
    }
    if (swing) {
      // a turn passed again mid-swing: the last one ends at once
      phi = wrapPi(swing.plan.from + swing.plan.delta);
      fit = fitFor(phi);
      endSwing(false);
    }
    if (!plan || plan.target !== target || Math.abs(plan.from - phi) > 1e-6 || plan.key !== viewKey()) {
      dropPlan();
      plan = makePlan(target);
    }
    if (!plan) return;
    if (reduce()) {
      phi = wrapPi(plan.from + plan.delta);
      fit = fitFor(phi);
      dropPlan();
      paintRest(0);
      return;
    }
    // the first keyframe is the picture on the screen; the last is painted now if the turn was too
    // quick to paint it ahead
    const P = plan;
    P.frames[0] = { a: P.from, key: shown, fit: shownFit, ready: !!shown };
    const last = P.frames[P.frames.length - 1];
    if (!last.ready) paintKey(last);
    swing = { plan: P, t0: performance.now(), dur: Math.abs(P.delta) > 2 ? 1250 : 900 };
    kick();
  }
  function endSwing(fadeIn = true) {
    const P = swing.plan, last = P.frames[P.frames.length - 1];
    swing = null;
    // the sharp picture comes back over the swing's last keyframe
    if (last.ready) {
      shown = last.key;
      shownFit = last.fit;
    }
    picKey = null;
    paintRest(fadeIn ? 260 : 0);
    // the keyframes go, but the one the sharp picture is fading in over stays until it has
    for (const fr of P.frames) if (fr.key.startsWith('kf:') && fr.ready && fr.key !== fade?.from) gl.drop(fr.key);
    if (plan === P) plan = null;
    warmNext();
  }
  // The ground's map from a keyframe's screen to the screen at the angle reached: M(a) M(a_k)^-1,
  // where M(x) turns the ground into seat x's frame, squeezes its depth by K and turns it back.
  const groundM = (x, k) => {
    const c = Math.cos(x), s = Math.sin(x);
    return [c * c + s * s * k, c * s * (1 - k), c * s * (1 - k), s * s + c * c * k];
  };
  const mul = (P, Q) => [P[0] * Q[0] + P[1] * Q[2], P[0] * Q[1] + P[1] * Q[3], P[2] * Q[0] + P[3] * Q[2], P[2] * Q[1] + P[3] * Q[3]];
  function layKey(fr, alpha) {
    if (!fr?.ready || !fr.fit) return;
    const M = mul(groundM(phi, A.K), groundM(fr.a, 1 / A.K)), r = fit.S / fr.fit.S;
    const a = M.map((v) => v * r);
    const o = [fit.cx - (a[0] * fr.fit.cx + a[1] * fr.fit.cy), fit.cy - (a[2] * fr.fit.cx + a[3] * fr.fit.cy)];
    gl.picA(fr.key, o, [a[0] * W, a[2] * W], [a[1] * H, a[3] * H], { a: alpha });
  }
  function drawSwing() {
    const P = swing.plan, n = P.frames.length - 1;
    const x = clamp(((phi - P.from) / P.delta) * n, 0, n);
    let lo = Math.floor(x), hi = Math.ceil(x);
    while (lo > 0 && !P.frames[lo].ready) lo--;
    while (hi < n && !P.frames[hi].ready) hi++;
    if (!P.frames[hi].ready) hi = lo;
    layKey(P.frames[lo], 1);
    if (hi !== lo) layKey(P.frames[hi], (x - lo) / (hi - lo));
  }

  /* ---------- Drawing: the sea, the picture, and what happens on it ---------- */

  function kick() {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    if (destroyed || document.hidden || !gl) return;
    const moving = swing || fade || dice || overlay.size || busyNow() || choice();
    // the sea alone is drawn about 30 times a second; anything moving on it, every frame
    if (!moving && now - lastFrame < 31) {
      if (!reduce()) raf = requestAnimationFrame(frame);
      return;
    }
    lastFrame = now;
    draw(now);
    if (moving || !reduce()) raf = requestAnimationFrame(frame);
  }
  function draw(now) {
    if (!fit) {
      if (gl.begin(11)) gl.end();
      return;
    }
    if (swing) {
      const k = clamp((now - swing.t0) / swing.dur, 0, 1);
      phi = swing.plan.from + swing.plan.delta * A.easeInOut(k);
      fit = fitFor(phi);
      if (k >= 1) {
        phi = wrapPi(swing.plan.from + swing.plan.delta);
        fit = fitFor(phi);
        endSwing();
      }
    }
    if (!gl.begin(11)) return;
    drawSea(now);
    if (swing) drawSwing();
    else if (fade) {
      const f = clamp((now - fade.t0) / fade.dur, 0, 1);
      gl.pic(fade.from, 0, 0, W, H);
      gl.pic(fade.to, 0, 0, W, H, { a: A.easeInOut(f) });
      if (f >= 1) {
        if (fade.from.startsWith('kf:')) gl.drop(fade.from);
        fade = null;
      }
    } else if (shown) gl.pic(shown, 0, 0, W, H);
    const ts = now / 1000;
    for (const o of [...overlay]) if (!o(gl, ts)) overlay.delete(o);
    drawChoice(ts);
    gl.end();
    if (dice) paintDice(now);
  }
  function drawSea(now) {
    const sea = isle?.base?.sea;
    if (!sea) return;
    const ts = reduce() ? 7.3 : (now - seaT0) / 1000;
    const c = Math.cos(phi), s = Math.sin(phi), S = fit.S, iK = 1 / A.K;
    // a screen px back to the ground: turned into the seat's frame, its depth stretched back by 1 / K
    const m00 = (c * c + s * s * iK) / S, m01 = (c * s * (1 - iK)) / S, m11 = (s * s + c * c * iK) / S;
    const toGround = [m00, m01, m01, m11];
    const ground0 = [-(m00 * fit.cx + m01 * fit.cy), -(m01 * fit.cx + m11 * fit.cy)];
    gl.sea(sea, ground0, toGround, ts, (g, tt) => {
      g.save();
      g.translate(fit.cx, fit.cy);
      g.rotate(phi);
      g.scale(S, S);
      A.onGround(g, A.makeView(phi), 0, () => A.paintSea(g, sea, tt));
      g.restore();
    });
  }

  /** A standing thing's sprite on the GPU where it stands (raised up px, grown sc, at alpha a). */
  function drawSprite(it, { a = 1, up = 0, sc = 1, shadow = true, at = null } = {}) {
    const { body, shadow: sh } = isle.sprite(it, phi);
    const S = fit.S;
    const [X, Y] = at || toScreen(it.x, it.y, it.lift ?? A.SLAB);
    const key = `sp:${it.t}:${it.key}:${Math.round(phi * 100)}`;
    if (!gl.has(key)) gl.texture(key, body.c);
    if (shadow && sh) {
      const sk = `${key}:sh`;
      if (!gl.has(sk)) gl.texture(sk, sh.c);
      gl.pic(sk, X - sh.ax * S * sc, Y - sh.ay * S * sc, sh.w * S * sc, sh.h * S * sc, { a: a * clamp(1 - up / (0.5 * S), 0.15, 1) });
    }
    // the picture is turned with the view (the table draws for a seat), so is every sprite on it
    gl.pic(key, X - body.ax * S * sc, Y - up - body.ay * S * sc, body.w * S * sc, body.h * S * sc, { a, rot: 0 });
  }
  const robberIt = (tile) => {
    const [x, y] = isle.robberAt(tile, phi);
    return { t: 'robber', x, y, lift: A.SLAB, key: 'robber' };
  };

  /* ---------- What a tap on the table chooses ---------- */

  // The table takes taps only while someone is placing (as theirs), and from the roller for the
  // robber, unless their phone shows the island: then their phone chooses.
  function choice() {
    if (!view || !isleReady || busyNow()) return null;
    if (view.phase === 'robber') return { kind: 'robber', p: view.current };
    if (placing?.kind && placing.kind !== 'dev') return { kind: placing.kind, p: placing.p, at: placing.at };
    return null;
  }
  function spotsFor(c) {
    if (c.kind === 'robber') return view.island.tiles.map((_, i) => i).filter((i) => i !== view.robber);
    try {
      return legalSpots(view, c.p, c.kind) || [];
    } catch {
      return [];
    }
  }
  function drawChoice(ts) {
    const c = choice();
    if (!c || !fit) return;
    const S = fit.S, col = A.rgbOf(view.players[c.p]?.color || '#efefef');
    const breathe = reduce() ? 1 : 0.5 + 0.5 * Math.sin((ts * TAU) / 1.2);
    const spots = spotsFor(c);
    if (c.kind === 'robber') {
      const ring = reduce() ? 0.85 : 0.7 + 0.3 * Math.sin((ts * TAU) / 1.1);
      for (const i of spots) {
        const [x, y] = tileAt(i);
        gl.ring(x, y, A.RC * S, A.RC * S * A.K, phi, 3.5 * u, [243, 236, 220, 0.85 * ring], { dash: 9 * u, gap: 6 * u, blur: 3 * u });
      }
      // he hovers over his tile, lifted 0.32 R
      const hover = 0.32 * S + (reduce() ? 0 : 4 * u * Math.sin((ts * TAU) / 1.3));
      if (view.robber >= 0) drawSprite(robberIt(view.robber), { up: hover });
      return;
    }
    if (c.kind === 'road') {
      for (const id of spots) {
        if (id === c.at) continue;
        const [a, z] = isle.edgePx(fit, id), d = [z[0] - a[0], z[1] - a[1]], l = Math.hypot(...d) || 1, e = [d[0] / l, d[1] / l];
        gl.line(a[0] + e[0] * 0.2 * S, a[1] + e[1] * 0.2 * S, z[0] - e[0] * 0.2 * S, z[1] - e[1] * 0.2 * S, 0.075 * S, [...col, 0.4 + 0.6 * breathe], { dash: 0.05 * S, gap: 0.08 * S });
      }
    } else {
      for (const id of spots) {
        if (id === c.at) continue;
        const [x, y] = cornerAt(id), r = 0.16 * S * (0.92 + 0.1 * breathe), a = 0.5 + 0.5 * breathe;
        gl.ellipse(x, y, r * 1.35, r * 1.35 * A.K, phi, [...col, 0.45 * a], 9 * u);
        gl.ring(x, y, r, r * A.K, phi, 3 * u, [...col, a]);
        gl.ellipse(x, y, r * 0.26, r * 0.26 * A.K, phi, [...col, a]);
      }
    }
    if (c.at !== null && c.at !== undefined && spots.includes(c.at)) drawGhost(c, ts);
  }
  const ghostA = (ts) => (reduce() ? 0.7 : 0.6 + 0.22 * Math.sin((ts * TAU) / 1.4));
  function drawGhost(c, ts) {
    const S = fit.S, P = view.players[c.p], col = A.rgbOf(P.color);
    const hop = ghostHop && ghostHop.at === c.at ? clamp((performance.now() - ghostHop.t0) / 450, 0, 1) : 1;
    const lift = Math.sin(Math.PI * hop) * 0.3 * S;
    if (c.kind === 'road') {
      const [a, z] = isle.edgePx(fit, c.at), d = [z[0] - a[0], z[1] - a[1]], l = Math.hypot(...d) || 1, e = [d[0] / l, d[1] / l];
      gl.ellipse((a[0] + z[0]) / 2, (a[1] + z[1]) / 2, 0.5 * S, 0.22 * S, Math.atan2(d[1], d[0]), [...col, 0.35], 0.12 * S);
      gl.line(a[0] + e[0] * 0.15 * S, a[1] + e[1] * 0.15 * S - lift, z[0] - e[0] * 0.15 * S, z[1] - e[1] * 0.15 * S - lift, 0.12 * S, [...col, ghostA(ts)], { dash: 0.07 * S, gap: 0.06 * S });
      return;
    }
    const [x, y] = cornerAt(c.at);
    gl.ellipse(x, y, 0.24 * S, 0.24 * S * A.K, phi, [...col, 0.6], 0.1 * S);
    drawSprite({ t: c.kind, x: isle.corners[c.at][0], y: isle.corners[c.at][1], lift: A.SLAB, yaw: 0, col: P.color, mark: P.mark, key: c.kind + P.color + P.mark }, { a: ghostA(ts), up: lift, shadow: false });
  }
  let ghostHop = null;

  let downAt = null;
  dom.hit.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  dom.hit.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 18) return;
    downAt = null;
    const r = dom.hit.getBoundingClientRect();
    tap(e.clientX - r.left, e.clientY - r.top);
  });
  function tap(x, y) {
    const c = choice();
    if (!c || !fit) return;
    audio.unlock();
    const S = seatOf(c.p);
    if (session.boardOn?.(c.p)) {
      // their phone shows the island: they choose there
      if (S) hint(S, t('ktan.usePhone'), 2200);
      return;
    }
    const spots = spotsFor(c);
    if (c.kind === 'robber') {
      const id = isle.nearest(fit, 'tile', spots, x, y, fit.S * 1.2);
      if (id === null) return;
      ripple(x, y);
      audio.play('tap');
      session.actFor(c.p, { type: 'robber', tile: id });
      return;
    }
    const id = isle.nearest(fit, c.kind === 'road' ? 'edge' : 'corner', spots, x, y, fit.S * 1.1);
    if (id === null) return;
    audio.play('tap');
    if (c.at !== null && c.at !== undefined && c.at !== id) ghostHop = { at: id, t0: performance.now() };
    session.ghost(id);
  }
  /** A finger's tap on the table: a soft dot, then a ring that spreads and fades. */
  function ripple(x, y) {
    const t0 = performance.now() / 1000;
    overlay.add((g, ts) => {
      const f = (ts - t0) / 0.6;
      if (f >= 1) return false;
      if (f < 0.35) g.ellipse(x, y, 17 * u, 17 * u, 0, [243, 236, 220, 0.45 * (1 - f / 0.35)]);
      g.ring(x, y, (15 + 34 * A.easeOut(f)) * u, (15 + 34 * A.easeOut(f)) * u, 0, 2.5 * u, [243, 236, 220, 0.85 * (1 - f)]);
      return true;
    });
    kick();
  }

  /* ---------- The seats: glows, answers, lines ---------- */

  function renderGlows() {
    const turn = whoseTurn();
    const over = view?.phase === 'over';
    const keep = new Set();
    for (const S of seats) {
      const key = S.seat;
      keep.add(key);
      let g = glowEls.get(key);
      if (!g) {
        g = el('div', 'ktan-glow');
        glowEls.set(key, g);
        glowLayer.append(g);
      }
      // at the end every glow turns to the winner's colour
      const col = over && view.winner !== undefined ? view.players[view.winner].color : S.color;
      g.style.setProperty('--c', col);
      g.style.setProperty('--c2', css(col, 0.42));
      Object.assign(g.style, {
        left: `${S.x}px`, top: `${S.y}px`, width: `${300 * u}px`, height: `${150 * u}px`,
        marginLeft: `${-150 * u}px`, marginTop: `${-150 * u}px`, transform: `rotate(${S.phi}rad)`,
      });
      g.classList.toggle('is-on', over || (S.p !== null && S.p === turn));
      // before the game, a seat carries its player's mark
      let disc = g.querySelector('.ktan-glow-disc');
      if (!view) {
        if (!disc) {
          disc = el('span', 'ktan-glow-disc');
          g.append(disc);
        }
        disc.style.setProperty('--mk', A.markInk(S.color));
        disc.innerHTML = markSvg(S.mark);
      } else disc?.remove();
    }
    for (const [key, g] of glowEls) {
      if (keep.has(key)) continue;
      g.remove();
      glowEls.delete(key);
    }
  }
  /** A seat's glow flares as cards leave the table past it. */
  function flare(S) {
    const g = S && glowEls.get(S.seat);
    if (!g) return;
    g.classList.add('is-flash');
    clearTimeout(g.flareT);
    g.flareT = setTimeout(() => g.classList.remove('is-flash'), 420);
  }

  // What each seat shows in its bubble, facing its player: the sign of what they are doing (a build,
  // an offer), their answer to an offer, their mark when they can be robbed, their phone when it
  // shows the island on their turn.
  function wantedBubbles() {
    const out = new Map();
    if (!view) return out;
    const offer = view.offers?.find((o) => o.from === view.current) || view.offers?.[0];
    if (offer) {
      out.set(offer.from, { kind: 'sign', icon: 'trade' });
      view.players.forEach((_, p) => {
        if (p === offer.from || (offer.to !== 'all' && offer.to !== p)) return;
        const a = offer.answers?.[p];
        out.set(p, { kind: a === 'yes' ? 'yes' : a === 'no' ? 'no' : 'wait' });
      });
      for (const o of view.offers) if (o !== offer && o.from !== offer.from) out.set(o.from, { kind: 'sign', icon: 'trade' });
    }
    if (placing?.kind && !out.has(placing.p)) out.set(placing.p, { kind: 'sign', icon: placing.kind === 'robber' ? null : placing.kind });
    if (view.phase === 'steal') for (const p of view.steal || []) out.set(p, { kind: 'mark' });
    const turn = whoseTurn();
    if (turn !== null && session.boardOn?.(turn) && !out.has(turn) && view.phase !== 'over') out.set(turn, { kind: 'phone' });
    return out;
  }
  function renderBubbles() {
    const want = wantedBubbles();
    for (const [p, b] of want) {
      const S = seatOf(p);
      if (!S) continue;
      let e = bubbles.get(p);
      const fresh = !e;
      if (!e) {
        e = el('div', 'ktan-bubble');
        bubbles.set(p, e);
        bubbleLayer.append(e);
      }
      const [x, y] = inAt(S, 88);
      Object.assign(e.style, { left: `${x}px`, top: `${y}px`, width: `${60 * u}px`, height: `${60 * u}px`, marginLeft: `${-30 * u}px`, marginTop: `${-30 * u}px` });
      e.style.setProperty('--r', `${S.phi}rad`);
      e.style.setProperty('--c', view.players[p].color);
      e.style.setProperty('--mk', A.markInk(view.players[p].color));
      const was = e.dataset.kind;
      e.dataset.kind = b.kind + (b.icon || '');
      e.className = `ktan-bubble${b.kind === 'sign' ? ' is-sign' : b.kind === 'mark' ? ' is-mark' : b.kind === 'wait' ? ' is-wait' : b.kind === 'yes' ? ' is-yes' : b.kind === 'no' ? ' is-no' : ''}`;
      if (was !== e.dataset.kind) {
        e.innerHTML = b.kind === 'sign' ? (b.icon ? signSvg(b.icon) : '') : b.kind === 'mark' ? markSvg(view.players[p].mark) : b.kind === 'phone' ? PHONE : iconSvg(b.kind === 'yes' ? 'check' : b.kind === 'no' ? 'cross' : 'wait');
        // a yes swells and sends out a ring of their colour; a no shakes along the seat's edge
        if (!fresh && !reduce() && (b.kind === 'yes' || b.kind === 'no')) {
          e.classList.add(b.kind === 'yes' ? 'is-pop' : 'is-shake');
          if (b.kind === 'yes') {
            const ring = el('span', 'ktan-bubble-ring');
            e.append(ring);
            setTimeout(() => ring.remove(), 820);
            flare(S);
          }
        }
      }
      if (fresh) requestAnimationFrame(() => requestAnimationFrame(() => e.classList.add('is-in')));
      else e.classList.add('is-in');
    }
    for (const [p, e] of bubbles) {
      if (want.has(p)) continue;
      bubbles.delete(p);
      e.classList.remove('is-in');
      setTimeout(() => e.remove(), 400);
    }
  }
  const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM8 5v12.5h8V5z"/></svg>';

  /** A line on the table facing a seat, in a glass pill, for ms (or until replaced). */
  const hints = new Map();
  function hint(S, text, ms = 0) {
    let h = hints.get(S.seat);
    if (!h) {
      h = el('div', 'ktan-table-hint');
      hints.set(S.seat, h);
      hintLayer.append(h);
    }
    h.textContent = text;
    const [x, y] = inAt(S, 170);
    Object.assign(h.style, { left: `${x}px`, top: `${y}px`, fontSize: `${19 * u}px` });
    h.style.setProperty('--r', `${S.phi}rad`);
    requestAnimationFrame(() => h.classList.add('is-in'));
    clearTimeout(h.timer);
    if (ms) h.timer = setTimeout(() => unhint(S), ms);
  }
  function unhint(S) {
    const h = S && hints.get(S.seat);
    if (!h) return;
    h.classList.remove('is-in');
  }
  function renderHints() {
    for (const S of seats) {
      if (view?.phase === 'robber' && S.p === view.current && !busyNow()) {
        if (!session.boardOn?.(S.p)) hint(S, t('ktan.moveRobber'));
        else unhint(S);
      } else if (placing?.kind && S.p === placing.p && placing.kind !== 'dev' && !session.boardOn?.(S.p)) hint(S, t('ktan.tapWhere'));
      else if (view?.phase === 'over' && S.p === view.winner) hint(S, t('ktan.tableWins', { name: view.players[view.winner].name }));
      else if (!hints.get(S.seat)?.timer) unhint(S);
    }
  }
  const say = (text) => {
    dom.announce.textContent = '';
    requestAnimationFrame(() => (dom.announce.textContent = text));
  };

  /* ---------- The room before the game ---------- */

  function renderLobby() {
    const L = session.lobby;
    dom.lobby.hidden = !!view;
    if (view || !L) return;
    dom.code.textContent = session.room?.code || '';
    const unseated = L.players.filter((p) => !p.at);
    dom.waiting.replaceChildren(...unseated.map((p) => {
      const m = el('span', 'ktan-mark');
      m.style.setProperty('--c', p.color);
      m.style.setProperty('--mk', A.markInk(p.color));
      m.innerHTML = markSvg(p.mark);
      m.setAttribute('aria-label', p.name);
      return m;
    }));
    const n = L.players.length, all = n > 0 && !unseated.length;
    dom.start.disabled = n < 2 || !all;
    dom.start.textContent = n < 2 ? t('ktan.needPlayers', { n: 2 }) : !all ? t('ktan.waitSeats') : t('ktan.startWith', { n });
  }
  dom.start.onclick = () => {
    audio.unlock();
    const r = session.start();
    if (r?.error) say(t(`ktan.err.${r.error}`));
  };

  /* ---------- The dice, thrown from the roller's phone ---------- */

  // They come out of the roller's glow, the way they were thrown, and roll three to ten quarter turns
  // across the island, further for a harder push, stopping at least 70 units from any edge, while the
  // island steps back under a veil. Each lands on its face of the roll.
  function rollDice(e) {
    const S0 = seatOf(e.p) || { x: W / 2, y: H, phi: 0, inward: [0, -1], right: [1, 0] };
    const th = e.throw || {};
    const vx = Number.isFinite(th.vx) ? th.vx : 0, vy = Number.isFinite(th.vy) ? th.vy : -1500, exitX = Number.isFinite(th.exitX) ? clamp(th.exitX, 0, 1) : 0.5;
    const c = Math.cos(S0.phi), s = Math.sin(S0.phi);
    const rot = (x, y) => [c * x - s * y, s * x + c * y];
    const inward = rot(0, -1), right = rot(1, 0);
    const base = Math.atan2(inward[1], inward[0]), d = rot(vx, vy);
    const ang = base + clamp(wrapPi(Math.atan2(d[1], d[0]) - base), -0.3, 0.3);
    const ds = DIE * u, across = Math.abs(inward[1]) > 0.5, depth = across ? H : W, len = across ? W : H;
    const power = clamp((Math.hypot(vx, vy) - 600) / 1600, 0, 1), r = rng((e.dice[0] * 7 + e.dice[1] * 13 + (session.view?.turn || 0) * 31) >>> 0 || 1);
    const reach = depth * (0.32 + 0.22 * power + r() * 0.05);
    const along = (across ? S0.x : S0.y) + (across ? right[0] : right[1]) * clamp((exitX - 0.5) * 140 * u, -70 * u, 70 * u);
    const mouth = clamp(along, 120 * u, len - 120 * u), at = across ? [mouth, S0.y] : [S0.x, mouth];
    const spread = 0.04 + r() * 0.08, side = [-Math.sin(ang), Math.cos(ang)], M = 70 * u;
    const list = [0, 1].map((k) => {
      const dir = ang + (k ? 1 : -1) * spread, off = (k ? 1 : -1) * ds * 0.7;
      const x = at[0] - inward[0] * ds * 0.7 + side[0] * off, y = at[1] - inward[1] * ds * 0.7 + side[1] * off;
      let n = clamp(Math.round(reach / ds) + (k === 0 && r() < 0.5 ? 1 : 0), 3, 10);
      const end = (m) => [x + Math.cos(dir) * m * ds, y + Math.sin(dir) * m * ds];
      const inside = ([X, Y]) => X > M && X < W - M && Y > M && Y < H - M;
      while (n > 3 && !inside(end(n))) n--;
      const cv = document.createElement('canvas');
      const size = ds * 3.2;
      cv.width = cv.height = Math.round(size * dpr);
      cv.style.width = cv.style.height = `${size}px`;
      diceBox.append(cv);
      return { x, y, dir, s: ds, n, D: n * ds, dur: reduce() ? 0.001 : 0.8 + n * 0.09, seq: A.faceChain(n, e.dice[k], r), tone: 'dark', delay: reduce() ? 0 : k * 0.07, end: end(n), cv, size };
    });
    const D = {
      t0: performance.now(), sum: e.dice[0] + e.dice[1], list, phi: S0.phi,
      T: Math.max(...list.map((dd) => dd.delay + dd.dur)),
      mid: [(list[0].end[0] + list[1].end[0]) / 2, (list[0].end[1] + list[1].end[1]) / 2],
    };
    dice = D;
    veil.classList.add('is-in');
    audio.play('dice');
    kick();
    return new Promise((resolve) => {
      // the sum where they stopped, facing the roller; a beat later the island comes back
      setTimeout(() => {
        if (destroyed) return resolve();
        fx.number(D.sum, D.mid[0], D.mid[1], 58 * u, { rot: D.phi, life: REVEAL.hold - REVEAL.num });
        say(t('ktan.rolledN', { name: view.players[e.p]?.name || '', n: D.sum }));
      }, (D.T + REVEAL.num) * 1000);
      setTimeout(() => {
        veil.classList.remove('is-in');
        resolve();
      }, (D.T + REVEAL.hold) * 1000);
      setTimeout(() => {
        if (dice === D) {
          dice = null;
          diceBox.replaceChildren();
        }
      }, (D.T + REVEAL.hold + 0.6) * 1000);
    });
  }
  function paintDice(now) {
    const D = dice;
    const ts = (now - D.t0) / 1000, rv = ts - D.T;
    D.list.forEach((d, i) => {
      const g = d.cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, d.size, d.size);
      if (ts < d.delay) return;
      const st = A.dieAt(d, reduce() ? 99 : ts - d.delay), p = rv - REVEAL.pop - i * 0.05, h = d.size / 2;
      d.cv.style.transform = `translate(${(st.x - h).toFixed(1)}px, ${(st.y - h).toFixed(1)}px)`;
      if (p <= 0) {
        if (st.alpha > 0.002) A.drawDieRoll(g, h, h, d.s, st.a, st.b, st.alpha, d.dir, d.tone, st.hop);
        else A.drawDie(g, h, h, d.s, st.a, d.tone, d.dir, st.hop);
        return;
      }
      // it pops: it swells and is gone, leaving a ring of brass where it lay
      if (reduce() || p >= 0.32) return;
      const sw = A.easeOut(clamp(p / 0.1, 0, 1)), gone = clamp((p - 0.08) / 0.22, 0, 1), q = p / 0.32;
      g.save();
      g.globalAlpha = 1 - gone * gone;
      A.drawDie(g, h, h, d.s * (1 + 0.22 * sw - 0.35 * gone), st.a, d.tone, d.dir, 0.25 * sw);
      g.restore();
      g.save();
      g.globalAlpha = 0.55 * (1 - q);
      g.strokeStyle = '#f2dca2';
      g.lineWidth = 2.5 * (1 - q) + 0.5;
      g.beginPath();
      g.arc(h, h, Math.min(h - 2, d.s * (0.55 + 0.6 * A.easeOut(q))), 0, TAU);
      g.stroke();
      g.restore();
    });
  }

  /* ---------- Cards crossing the table ---------- */

  /** One card on a curve from a to b (screen px), turning from r0 to r1, bowing bend px to its left. */
  function cross(kind, a, b, { r0 = 0, r1 = 0, dur = 1.5, delay = 0, bend = 0, back = false, flipAt = -1, w = CW * u, shrink = 1, fadeOut = false, glow = 0, done } = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const mid = [(a[0] + b[0]) / 2 - (dy / l) * bend, (a[1] + b[1]) / 2 + (dx / l) * bend];
    hold(delay + dur);
    const end = () => done?.();
    const run = fx.path(kind, w, {
      dur, delay, back,
      pose: (f) => {
        const e = flyEase(f), lift = Math.sin(Math.PI * f);
        const x = (1 - e) * (1 - e) * a[0] + 2 * (1 - e) * e * mid[0] + e * e * b[0];
        const y = (1 - e) * (1 - e) * a[1] + 2 * (1 - e) * e * mid[1] + e * e * b[1];
        const flip = flipAt >= 0 ? seg(f, flipAt, Math.min(1, flipAt + 0.3)) : back ? 0 : 1;
        return {
          x, y, rot: r0 + wrapPi(r1 - r0) * A.easeInOut(clamp(f * 1.15, 0, 1)), lift,
          sc: (1 + 0.1 * lift) * lerp(1, shrink, e), a: fadeOut ? 1 - seg(f, 0.7, 1) : 1, flip, glow: glow * (1 - f),
        };
      },
      done: end,
    });
    if (!run) setTimeout(end, (delay + Math.min(dur, 0.3)) * 1000);
  }

  // A harvest: each card lifts off its tile facing whoever rolled, then flies in one arc straight out
  // over its owner's edge, turning to face them; their glow flares as it leaves the table.
  async function deal(gains, why) {
    const RISE = 0.28, FLY = 0.85, groups = new Map();
    for (const g of gains) for (let k = 0; k < g.n; k++) {
      if (!groups.has(g.p)) groups.set(g.p, []);
      groups.get(g.p).push(g);
    }
    const up = [Math.sin(phi), -Math.cos(phi)];
    let j = 0, last = 0;
    for (const [p, list] of groups) {
      const S = seatOf(p);
      if (!S) continue;
      list.forEach((g, slotI) => {
        const m = slotI - (list.length - 1) / 2;
        const from = g.tile !== undefined ? tileAt(g.tile) : bankAt();
        const to = outAt(S, m), h0 = [from[0] + up[0] * 30 * u, from[1] + up[1] * 30 * u];
        const midP = [(h0[0] + to[0]) / 2 + up[0] * 60 * u, (h0[1] + to[1]) / 2 + up[1] * 60 * u];
        const rot0 = phi, rot1 = S.phi + m * 0.08, at = 0.35 + (j++) * 0.13;
        last = Math.max(last, at + RISE + FLY);
        hold(at + RISE + FLY);
        const run = fx.path(g.res, CW * u, {
          dur: RISE + FLY, delay: at,
          pose: (f, a) => {
            if (a < RISE) {
              const e = A.easeOut(a / RISE);
              return { x: lerp(from[0], h0[0], e), y: lerp(from[1], h0[1], e), rot: rot0, sc: 0.35 + 0.65 * e, a: e, glow: 1 };
            }
            const q = (a - RISE) / FLY, e = q * q * (1.5 - 0.5 * q);
            return {
              x: (1 - e) * (1 - e) * h0[0] + 2 * (1 - e) * e * midP[0] + e * e * to[0],
              y: (1 - e) * (1 - e) * h0[1] + 2 * (1 - e) * e * midP[1] + e * e * to[1],
              rot: rot0 + wrapPi(rot1 - rot0) * A.easeInOut(clamp(q * 1.25, 0, 1)),
              sc: 1 + 0.12 * Math.sin(Math.PI * q) - 0.08 * q, glow: 1 - q,
            };
          },
          done: () => flare(S),
        });
        if (!run) setTimeout(() => flare(S), at * 1000);
      });
    }
    if (why !== 'quiet') audio.play('deal');
    await later(Math.min(last, 4));
  }

  // Cards a player pays into the bank: in past their edge, into the middle of the island, fading.
  async function intoBank(S, cards, { back = false, rise = true } = {}) {
    const list = [];
    for (const r of RES) for (let k = 0; k < (cards?.[r] || 0); k++) list.push(r);
    if (!back && !list.length) return;
    const n = back ? cards : list.length;
    for (let i = 0; i < n; i++) {
      const m = i - (n - 1) / 2;
      cross(back ? 'back' : list[i], outAt(S, m), bankAt(), { r0: S.phi, r1: S.phi, dur: 0.95, delay: i * 0.12, shrink: 0.5, fadeOut: true, back });
    }
    setTimeout(() => flare(S), 120);
    if (rise) fx.rise(`−${n}`, ...inAt(S, 120), { rot: S.phi, size: 30 * u });
    await later(0.95 + (n - 1) * 0.12);
  }
  // Cards the bank pays: out of the middle, leaving by the player's edge.
  async function outOfBank(S, cards, { back = false } = {}) {
    const list = [];
    for (const r of RES) for (let k = 0; k < (cards?.[r] || 0); k++) list.push(r);
    list.forEach((r, i) => {
      const m = i - (list.length - 1) / 2;
      cross(back ? 'back' : r, bankAt(), outAt(S, m), { r0: phi, r1: S.phi, dur: 0.9, delay: i * 0.12, back, done: () => flare(S) });
    });
    await later(0.9 + Math.max(0, list.length - 1) * 0.12);
  }

  /* ---------- Pieces made on the island ---------- */

  // The cost leaves the player's edge and dives into the place, each card lighting it as it goes in;
  // then the piece is made: a swell of light, the piece growing from 55 % with a little overshoot, a
  // puff of dust and a ring of their colour over the ground. A road is laid from its end.
  async function made(e, { pay = true } = {}) {
    const S = seatOf(e.p), P = view.players[e.p];
    const col = A.rgbOf(P.color);
    const road = e.kind === 'road';
    const spot = road ? edgeMid(e.at) : cornerAt(e.at);
    if (pay && S && e.kind !== 'dev') {
      const cost = { road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, wool: 1, grain: 1 }, city: { grain: 2, ore: 3 } }[e.kind];
      const list = [];
      for (const r of RES) for (let k = 0; k < (cost[r] || 0); k++) list.push(r);
      list.forEach((r, i) => cross(r, outAt(S, i - (list.length - 1) / 2), spot, { r0: S.phi, r1: phi, dur: 0.8, delay: i * 0.1, shrink: 0.18, fadeOut: true }));
      setTimeout(() => flare(S), 100);
      await later(0.8 + (list.length - 1) * 0.1 + 0.14);
    }
    const t0 = performance.now() / 1000, S2 = fit.S;
    if (road) {
      const [a, z] = isle.edgePx(fit, e.at);
      overlay.add((g, ts) => {
        const f = clamp((ts - t0) / 0.65, 0, 1);
        if (ts - t0 > 0.9) return false;
        const x1 = lerp(a[0], z[0], A.easeOut(f)), y1 = lerp(a[1], z[1], A.easeOut(f));
        g.line(a[0], a[1], x1, y1, 0.1 * S2, [...col, 0.95], { dash: 0.06 * S2, gap: 0.015 * S2 });
        return true;
      });
      kick();
      await later(0.65);
      show.edges.delete(e.at);
      picKey = null;
      paintRest(0);
    } else {
      const it = { t: e.kind, x: isle.corners[e.at][0], y: isle.corners[e.at][1], lift: A.SLAB, yaw: 0, col: P.color, mark: P.mark, key: e.kind + P.color + P.mark };
      overlay.add((g, ts) => {
        const f = clamp((ts - t0) / 0.36, 0, 1);
        if (f >= 1) return false;
        // a little overshoot as it settles
        const grow = 0.55 + 0.45 * (1 + 2.70158 * Math.pow(f - 1, 3) + 1.70158 * Math.pow(f - 1, 2));
        g.glow(spot[0], spot[1], 0.55 * S2, 0.55 * S2 * A.K, phi, [255, 214, 140, 0.5 * (1 - f)]);
        drawSprite(it, { sc: grow });
        return true;
      });
      kick();
      await later(0.36);
      show.corners.delete(e.at);
      picKey = null;
      paintRest(0);
    }
    // dust and a ring of their colour spreading over the ground
    const t1 = performance.now() / 1000;
    overlay.add((g, ts) => {
      const f = (ts - t1) / 0.8;
      if (f >= 1) return false;
      const r = (0.15 + 0.5 * A.easeOut(f)) * S2;
      g.ring(spot[0], spot[1], r, r * A.K, phi, 3 * u, [...col, 0.8 * (1 - f)]);
      g.ring(spot[0], spot[1], r * 0.7, r * 0.7 * A.K, phi, 2 * u, [232, 220, 192, 0.5 * (1 - f)]);
      return true;
    });
    kick();
    audio.play('build');
    if (S && e.kind !== 'road') fx.rise('+1', ...inAt(S, 120), { rot: S.phi, size: 30 * u });
  }

  // A development card played: in past its player's edge, up to the middle of their side growing to
  // 2.2 times, a moment in warm light, then gone in a ring of brass.
  async function played(e) {
    const S = seatOf(e.p);
    if (!S) return;
    const a = outAt(S), b = inAt(S, 250), w = CW * u;
    hold(1.4);
    fx.path(e.card, w, {
      dur: 1.4,
      pose: (f, s) => {
        if (s < 0.6) {
          const q = A.easeOut(s / 0.6);
          return { x: lerp(a[0], b[0], q), y: lerp(a[1], b[1], q), rot: S.phi, sc: lerp(1, 2.2, q), glow: q, flip: e.card === 'vp' ? 0 : 1 };
        }
        if (s < 1.1) return { x: b[0], y: b[1], rot: S.phi, sc: 2.2, glow: 1, flip: e.card === 'vp' ? seg(s, 0.6, 0.96) : 1 };
        const q = seg(s, 1.1, 1.4);
        return { x: b[0], y: b[1], rot: S.phi, sc: 2.2 * (1 + 0.1 * q), a: 1 - q, glow: 1 - q };
      },
    });
    audio.play('card');
    await later(1.1);
    const t0 = performance.now() / 1000;
    overlay.add((g, ts) => {
      const f = (ts - t0) / 0.5;
      if (f >= 1) return false;
      const r = (40 + 90 * A.easeOut(f)) * u;
      g.ring(b[0], b[1], r, r, 0, 3 * u, [201, 169, 97, 0.8 * (1 - f)]);
      return true;
    });
    kick();
    await later(0.3);
  }

  /* ---------- Events, played out one after another ---------- */

  async function play(events, prev) {
    // pieces in this batch stay out of the picture until they are made
    for (const e of events) {
      if (e.t === 'build' || e.t === 'setup') {
        if (e.kind === 'road') show.edges.add(e.at);
        else if (e.kind === 'city') show.corners.set(e.at, 'settlement');
        else if (e.kind !== 'dev') show.corners.set(e.at, null);
      }
    }
    const robberMoves = events.find((e) => e.t === 'robber');
    if (robberMoves) show.robber = -1;
    picKey = null;
    paintRest(0);
    for (const e of events) {
      if (destroyed) return;
      try {
        await playOne(e, prev);
      } catch (err) {
        console.warn('ktan table: an event did not play', err);
      }
    }
    if (robberMoves) show.robber = undefined;
    show.corners.clear();
    show.edges.clear();
    picKey = null;
    paintRest(0);
  }
  async function playOne(e) {
    const S = e.p !== undefined ? seatOf(e.p) : null;
    switch (e.t) {
      case 'roll':
        show.lit = 0;
        picKey = null;
        paintRest(200);
        await rollDice(e);
        if (e.sum !== 7) {
          show.lit = e.sum;
          picKey = null;
          paintRest(320);
        }
        break;
      case 'produce':
        await deal(e.gains || []);
        break;
      case 'gain':
        if (e.why === 'setup' && e.cards) {
          const at = lastSetupAt.get(e.p);
          const tiles = at !== undefined ? isle.geo.corners[at].tiles : [];
          const gains = [];
          for (const r of RES) for (let k = 0; k < (e.cards[r] || 0); k++) {
            const ti = tiles.find((i) => view.island.tiles[i].res === r);
            gains.push({ p: e.p, res: r, n: 1, tile: ti });
          }
          await deal(gains);
        } else if (S && e.cards) await outOfBank(S, e.cards);
        break;
      case 'setup':
        if (e.kind === 'settlement') lastSetupAt.set(e.p, e.at);
        await made(e, { pay: false });
        break;
      case 'build':
        await made(e);
        break;
      case 'discard':
        // the table never sees which cards: they go into the bank face down
        if (S) await intoBank(S, e.cards || e.n || 1, { back: !e.cards });
        break;
      case 'robber':
        await robberFlies(e);
        break;
      case 'steal': {
        const A0 = seatOf(e.from), B0 = seatOf(e.to);
        if (A0 && B0) {
          cross('back', outAt(A0), outAt(B0), { r0: A0.phi, r1: B0.phi, dur: 1.5, back: true, done: () => flare(B0) });
          audio.play('steal');
          fx.rise('−1', ...inAt(A0, 120), { rot: A0.phi, size: 30 * u });
          await later(1.5);
        }
        break;
      }
      case 'trade': {
        const A0 = seatOf(e.a), B0 = seatOf(e.b);
        if (!A0 || !B0) break;
        audio.play('trade');
        const send = (cards, from, to, bend, d0) => {
          const all = [];
          for (const r of RES) for (let k = 0; k < (cards?.[r] || 0); k++) all.push(r);
          all.forEach((r, i) => {
            const m = i - (all.length - 1) / 2;
            cross(r, outAt(from, m), outAt(to, -m), { r0: from.phi + m * 0.06, r1: to.phi - m * 0.06, dur: 1.5, delay: d0 + i * 0.12, bend: bend * u, done: () => flare(to) });
          });
          return all.length;
        };
        const n1 = send(e.give, A0, B0, 64, 0.5), n2 = send(e.want, B0, A0, -64, 0.56);
        await later(0.5 + 1.5 + Math.max(n1, n2) * 0.12);
        break;
      }
      case 'bank':
        if (S) {
          audio.play('trade');
          await intoBank(S, e.give, { rise: false });
          await outOfBank(S, e.want);
        }
        break;
      case 'buy':
        if (S) {
          audio.play('card');
          await intoBank(S, { ore: 1, wool: 1, grain: 1 }, { rise: false });
          cross('back', bankAt(), outAt(S), { r0: phi, r1: S.phi, dur: 0.9, back: true, done: () => flare(S) });
          await later(0.9);
        }
        break;
      case 'play':
        await played(e);
        break;
      case 'harvest':
        if (S) await harvestArc(S, e.res || []);
        break;
      case 'tribute':
        if (S) await tribute(S, e);
        break;
      case 'award':
        await award(e);
        break;
      case 'turn':
        viewSeat = e.p;
        renderGlows();
        if (view.phase !== 'over') {
          show.lit = 0;
          swingTo(seatPhi(e.p));
          audio.play('turn');
          await later(0.5);
        }
        break;
      case 'win':
        audio.play('win');
        renderGlows();
        break;
      default:
        break;
    }
  }
  const lastSetupAt = new Map();

  // On a 7 or a knight he lifts off his tile and hovers; a tap on the table sends him in an arc to his
  // new tile, where he lands behind its number with a ring of dust and the number goes dark.
  async function robberFlies(e) {
    const from = prevRobber, to = e.tile;
    if (from === null || from === undefined || from < 0 || !fit) return;
    const S2 = fit.S, a = robberIt(from), b = robberIt(to);
    const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y), up0 = 0.32 * S2;
    const t0 = performance.now() / 1000;
    audio.play('robber');
    overlay.add((g, ts) => {
      const f = clamp((ts - t0) / 0.85, 0, 1);
      if (ts - t0 > 1.65) return false;
      if (f < 1) {
        const k = A.easeInOut(f), x = lerp(pa[0], pb[0], k), y = lerp(pa[1], pb[1], k);
        const up = up0 * (1 - Math.pow(seg(f, 0.72, 1), 3)) + 110 * u * Math.sin(Math.PI * f) * (1 - seg(f, 0.72, 1));
        drawSprite(b, { at: [x, y], up });
      } else {
        drawSprite(b);
        // the dust he raises landing
        const q = (ts - t0 - 0.85) / 0.8;
        if (q < 1) {
          const r = (0.1 + 0.22 * A.easeOut(q)) * S2;
          g.ring(pb[0], pb[1], r, r * A.K, phi, 2 * u, [232, 220, 192, 0.6 * (1 - q)]);
        }
      }
      return true;
    });
    kick();
    await later(0.85);
    show.robber = undefined;
    picKey = null;
    paintRest(0);
    await later(0.3);
  }
  let prevRobber = view?.robber ?? null;

  // Harvest: the bank opens in the middle as an arc of the five resources facing the player; the two
  // picked lift and fly to their edge, and the rest go back.
  async function harvestArc(S, picked) {
    const [cx, cy] = bankAt(), w = CW * u;
    const left = picked.slice();
    RES.forEach((r, i) => {
      const k = left.indexOf(r);
      if (k >= 0) left.splice(k, 1);
      const go = k >= 0;
      // in an arc facing the player: along their edge, the outer cards a little farther from them
      const m = i - 2, at = [cx + (S.right[0] * m * w * 1.15 + S.inward[0] * Math.abs(m) * 6 * u), cy + (S.right[1] * m * w * 1.15 + S.inward[1] * Math.abs(m) * 6 * u)];
      hold(2.0);
      const out = outAt(S, i - 2);
      fx.path(r, w, {
        dur: go ? 2.0 : 1.4,
        pose: (f, s) => {
          if (s < 0.4) {
            const q = A.easeOut(s / 0.4);
            return { x: lerp(cx, at[0], q), y: lerp(cy, at[1], q), rot: S.phi + m * 0.06, sc: 0.5 + 0.5 * q, a: q };
          }
          if (s < 1.0) return { x: at[0], y: at[1], rot: S.phi + m * 0.06, glow: go ? 1 : 0, sc: go ? 1.08 : 1 };
          if (!go) {
            const q = seg(s, 1.0, 1.4);
            return { x: lerp(at[0], cx, q), y: lerp(at[1], cy, q), rot: S.phi, sc: 1 - 0.5 * q, a: 1 - q };
          }
          const q = flyEase(seg(s, 1.0, 2.0));
          return { x: lerp(at[0], out[0], q), y: lerp(at[1], out[1], q), rot: S.phi, sc: 1.08 - 0.08 * q };
        },
        done: () => {
          if (go) flare(S);
        },
      });
    });
    audio.play('card');
    await later(2.0);
  }

  // Tribute: the named resource in the middle, then every player's cards of it come in from their own
  // edges and cross to the player's, −n at each seat and +n at theirs.
  async function tribute(S, e) {
    const [cx, cy] = bankAt(), w = CW * u;
    hold(1.6);
    fx.path(e.res, w * 1.6, {
      dur: 1.6,
      pose: (f, s) => ({ x: cx, y: cy, rot: S.phi, sc: 0.6 + 0.4 * A.easeOut(seg(s, 0, 0.3)), a: seg(s, 0, 0.2) * (1 - seg(s, 1.3, 1.6)), glow: 1 }),
    });
    await later(0.6);
    let total = 0, j = 0;
    for (const f of e.from || []) {
      const F = seatOf(f.p);
      if (!F || !f.n) continue;
      total += f.n;
      fx.rise(`−${f.n}`, ...inAt(F, 120), { rot: F.phi, size: 30 * u });
      for (let k = 0; k < f.n; k++) {
        const m = k - (f.n - 1) / 2;
        cross(e.res, outAt(F, m), outAt(S, m), { r0: F.phi, r1: S.phi, dur: 1.4, delay: (j++) * 0.12, bend: 40 * u, done: () => flare(S) });
      }
    }
    if (total) fx.rise(`+${total}`, ...inAt(S, 120), { rot: S.phi, size: 30 * u, delay: 1.2 });
    await later(1.4 + j * 0.12);
  }

  // Longest road or largest army changes hands: its card crosses from the old holder's seat (or out of
  // the middle) to the new one's.
  async function award(e) {
    const to = seatOf(e.to);
    if (!to) return;
    const from = e.from !== null && e.from !== undefined ? seatOf(e.from) : null;
    const a = from ? inAt(from, 120) : bankAt(), b = inAt(to, 120), kind = e.kind === 'army' ? 'army' : 'longest';
    const c = A.awardCanvas ? A.awardCanvas(kind, Math.round(80 * u * dpr)) : null;
    if (!c) return;
    const img = el('canvas');
    img.width = c.width;
    img.height = c.height;
    img.getContext('2d').drawImage(c, 0, 0);
    const size = 80 * u;
    Object.assign(img.style, { width: `${size}px`, height: `${size}px`, position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', zIndex: 3 });
    hintLayer.append(img);
    audio.play('award');
    const t0 = performance.now(), dur = reduce() ? 300 : 1500;
    await new Promise((resolve) => {
      const step = (now) => {
        const f = clamp((now - t0) / dur, 0, 1), k = flyEase(f), lift = Math.sin(Math.PI * f);
        const x = lerp(a[0], b[0], k), y = lerp(a[1], b[1], k), r = (from ? from.phi : phi) + wrapPi(to.phi - (from ? from.phi : phi)) * A.easeInOut(f);
        img.style.transform = `translate(${x}px, ${y}px) rotate(${r}rad) scale(${1 + 0.15 * lift}) translate(${-size / 2}px, ${-size / 2}px)`;
        img.style.opacity = String(f > 0.8 ? 1 - (f - 0.8) / 0.2 : 1);
        if (f < 1 && !destroyed) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    img.remove();
    flare(to);
  }

  /* ---------- Taking what the host says ---------- */

  function update(next) {
    if (destroyed) return;
    const prev = view;
    if (next.view) view = next.view;
    if (next.placing !== undefined) placing = next.placing;
    if (!view) {
      seats = seatsNow();
      renderLobby();
      renderGlows();
      return;
    }
    if (!prev) {
      // the game begins: the room's discs go, the island is painted
      dom.lobby.hidden = true;
      seats = seatsNow();
      tellSeats();
      build(view.island);
    }
    renderGlows();
    if (next.events?.length) {
      const events = next.events;
      queue = queue.then(() => play(events, prev)).then(() => {
        prevRobber = view.robber;
        afterPlay();
      });
    } else afterPlay();
    renderBubbles();
    renderHints();
    kick();
  }
  function afterPlay() {
    if (destroyed || !view) return;
    // the view faces whoever plays now (a turn that passed without its event, a table come back)
    const turn = whoseTurn();
    if (turn !== viewSeat && !swing) {
      viewSeat = turn;
      swingTo(seatPhi(turn));
    }
    const lit = view.dice && view.rolled && !['roll', 'setup'].includes(view.phase) && view.dice[0] + view.dice[1] !== 7 ? view.dice[0] + view.dice[1] : 0;
    const fadeMs = lit !== show.lit ? 320 : 0;
    show.lit = lit;
    // while the robber is being moved he hovers over his tile, out of the picture
    show.robber = view.phase === 'robber' ? -1 : undefined;
    paintRest(fadeMs);
    prevRobber = view.robber;
    warmNext();
    renderGlows();
    renderBubbles();
    renderHints();
    kick();
  }

  /* ---------- Wiring ---------- */

  if (!gl) gl = createGL(dom.cv, { onRestored: () => { picKey = null; paintRest(0); } }) || create2D(dom.cv, {});
  const unsub = session.subscribe((next) => update(next));
  const unsubLobby = session.onLobby?.(() => {
    if (view) return;
    seats = seatsNow();
    renderLobby();
    renderGlows();
  });
  const onResize = () => layout();
  addEventListener('resize', onResize);
  screen.orientation?.addEventListener?.('change', onResize);
  const onVisible = () => {
    if (!document.hidden) kick();
  };
  document.addEventListener('visibilitychange', onVisible);
  layout();
  renderLobby();
  if (view) {
    dom.lobby.hidden = true;
    build(view.island);
  }
  renderGlows();
  renderBubbles();
  renderHints();

  function destroy() {
    destroyed = true;
    clearTimeout(warmTimer);
    clearTimeout(holdTimer);
    unsub?.();
    unsubLobby?.();
    removeEventListener('resize', onResize);
    screen.orientation?.removeEventListener?.('change', onResize);
    document.removeEventListener('visibilitychange', onVisible);
    cancelAnimationFrame(raf);
    fx.clear();
    veil.remove();
    diceBox.remove();
    dom.glows.replaceChildren();
    dom.cv.classList.remove('blur-in');
  }

  return {
    destroy,
    openLog() {},
    leave: onLeave,
    /** For checks in a browser: the seats as laid out, and where each place being chosen is. */
    get seats() { return seats; },
    get ready() { return isleReady; },
    get phi() { return phi; },
    spots() {
      const c = choice();
      if (!c || !fit) return [];
      return spotsFor(c).map((id) => ({ id, at: c.kind === 'robber' ? tileAt(id) : c.kind === 'road' ? edgeMid(id) : cornerAt(id) }));
    },
  };
}
