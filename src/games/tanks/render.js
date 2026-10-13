// Tanks renderer: draws the world on a canvas and owns the purely visual extras
// (tread marks, scorch marks, explosions). It reads the world and never changes it.
// On a tall screen the whole arena is turned 90 degrees, so the player's side (the
// left of every map) sits at the bottom, next to the thumbs. The art itself (ground,
// tanks, shots, bombs) is in art.js, which the field guide draws with too.
import {
  drawBomb,
  drawGround,
  drawMine,
  drawShot,
  drawTank,
  drawTankShadow,
  drawTarget,
  makePalette,
} from './art.js';
import { BLAST_R, COLS, MINE_FUSE, MUZZLE, ROWS, TYPES, cellAt, muzzleBlocked, owned, tracePath } from './rules.js';

const FRAME = 0.3; // border around the arena, in cells
const MAX_DPR = 2;
const MARK_LIFE = 9; // seconds a tread mark takes to fade
const MAX_FX = 700;

export function createRenderer(canvas, { reduceMotion = () => false } = {}) {
  const ctx = canvas.getContext('2d');
  const floor = document.createElement('canvas');
  const fctx = floor.getContext('2d');
  const view = { unit: 20, rot: false, w: 0, h: 0, dpr: 1 };
  let pal = null;
  let floorKey = '';
  let marks = [];
  let scorches = [];
  let fx = [];
  let odometer = new Map();
  let clock = 0;
  let shake = 0;
  let smokeTimer = 0;

  /* ---------- Layout and coordinates ---------- */

  /** Fits the arena in availW x availH CSS pixels; returns its size and orientation. */
  function layout(availW, availH) {
    const wide = COLS + FRAME * 2;
    const tall = ROWS + FRAME * 2;
    const flat = Math.min(availW / wide, availH / tall);
    const upright = Math.min(availW / tall, availH / wide);
    view.rot = upright > flat * 1.04;
    view.unit = Math.max(4, Math.floor((view.rot ? upright : flat) * 4) / 4);
    view.w = Math.floor(view.unit * (view.rot ? tall : wide));
    view.h = Math.floor(view.unit * (view.rot ? wide : tall));
    view.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    for (const c of [canvas, floor]) {
      c.width = Math.round(view.w * view.dpr);
      c.height = Math.round(view.h * view.dpr);
    }
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    floorKey = '';
    return { width: view.w, height: view.h, rotated: view.rot };
  }

  /** World -> canvas pixel transform for a 2D context. */
  function worldTransform(c, ox = 0, oy = 0) {
    const s = view.unit * view.dpr;
    if (view.rot) c.setTransform(0, -s, s, 0, (FRAME + ox) * s, (COLS + FRAME + oy) * s);
    else c.setTransform(s, 0, 0, s, (FRAME + ox) * s, (FRAME + oy) * s);
  }

  /** A point in canvas CSS pixels -> world coordinates. */
  function toWorld(px, py) {
    const u = px / view.unit;
    const v = py / view.unit;
    return view.rot ? { x: COLS + FRAME - v, y: u - FRAME } : { x: u - FRAME, y: v - FRAME };
  }

  /** A direction on screen -> the same direction in the world. */
  function vecToWorld(dx, dy) {
    return view.rot ? { x: -dy, y: dx } : { x: dx, y: dy };
  }

  /* ---------- Palette ---------- */

  function readPalette() {
    const cs = getComputedStyle(canvas);
    pal = makePalette((name) => cs.getPropertyValue(name).trim());
    floorKey = '';
  }

  /** The palette the art is drawn with, for badges outside the arena. */
  function palette() {
    if (!pal) readPalette();
    return pal;
  }

  /* ---------- Static layer: floor, blocks, scorch marks ---------- */

  function drawScorch(c, m) {
    c.save();
    c.translate(m.x, m.y);
    c.rotate(m.a);
    c.strokeStyle = pal.scorch;
    c.lineCap = 'round';
    c.lineWidth = 0.17;
    c.beginPath();
    c.moveTo(-0.36, -0.36);
    c.lineTo(0.36, 0.36);
    c.moveTo(0.36, -0.36);
    c.lineTo(-0.36, 0.36);
    c.stroke();
    c.restore();
  }

  function buildFloor(s) {
    const c = fctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = pal.frame;
    c.fillRect(0, 0, floor.width, floor.height);
    worldTransform(c);
    drawGround(c, pal, {
      cols: COLS,
      rows: ROWS,
      kindAt: (col, row) => cellAt(s.grid, col, row),
      // Screen-relative light: up on screen is lit, down on screen is in shade.
      up: vecToWorld(0, -1),
      px: 1 / (view.unit * view.dpr),
    });
    for (const m of scorches) drawScorch(c, m);
    floorKey = keyFor(s);
  }

  const keyFor = (s) => `${s.gridVer}:${view.w}x${view.h}:${view.rot}:${view.dpr}:${pal && pal.floor}`;

  /* ---------- Effects ---------- */

  function add(p) {
    if (fx.length < MAX_FX) fx.push(p);
  }

  function burst(x, y, n, { speed = 2, life = 0.5, size = 0.08, color, kind = 'spark', drag = 3 }) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.8);
      add({ kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random() * 0.8), color, drag, spin: Math.random() * 6 });
    }
  }

  function smoke(x, y, n, spread = 0.2, size = 0.22, life = 0.9) {
    for (let i = 0; i < n; i++) {
      add({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        life: life * (0.7 + Math.random() * 0.6),
        max: life,
        size: size * (0.7 + Math.random() * 0.6),
        drag: 1.5,
      });
    }
  }

  function ring(x, y, r0, r1, life, color, width = 0.08) {
    add({ kind: 'ring', x, y, r0, r1, life, max: life, color, width });
  }

  function flash(x, y, r0, r1, life, color) {
    add({ kind: 'flash', x, y, r0, r1, life, max: life, color });
  }

  /** Turns simulation events into effects. */
  function events(list, s) {
    const calm = reduceMotion();
    for (const e of list) {
      switch (e.type) {
        case 'shot':
          flash(e.x, e.y, 0.12, 0.3, 0.09, pal.flash);
          smoke(e.x, e.y, calm ? 1 : 2, 0.1, 0.12, 0.5);
          break;
        case 'lob':
          // A puff from the mortar tube as the bomb leaves it.
          ring(e.x, e.y, 0.15, 0.6, 0.3, pal.smoke, 0.07);
          smoke(e.x, e.y, calm ? 2 : 5, 0.25, 0.2, 0.8);
          break;
        case 'fizzle':
        case 'pop':
          smoke(e.x, e.y, calm ? 2 : 4, 0.15, 0.13, 0.5);
          break;
        case 'bounce':
          burst(e.x, e.y, calm ? 2 : 5, { speed: 2.2, life: 0.18, size: 0.05, color: pal.flash });
          break;
        case 'clash':
          ring(e.x, e.y, 0.05, 0.45, 0.25, pal.flash, 0.06);
          burst(e.x, e.y, calm ? 3 : 8, { speed: 2.5, life: 0.25, size: 0.06, color: pal.flash });
          break;
        case 'mine':
          ring(e.x, e.y, 0.2, 0.55, 0.35, pal.signal, 0.05);
          break;
        case 'blast': {
          const r = e.r || BLAST_R;
          const k = r / BLAST_R;
          flash(e.x, e.y, 0.4 * k, r, 0.32, pal.fire);
          ring(e.x, e.y, 0.3 * k, r * 1.15, 0.45, pal.flash, 0.12);
          smoke(e.x, e.y, Math.round((calm ? 6 : 16) * k), r, 0.45, 1.4);
          burst(e.x, e.y, Math.round((calm ? 6 : 18) * k), { speed: 4 * k, life: 0.55, size: 0.09, color: pal.fire });
          if (!calm) shake = Math.max(shake, 0.4 * k);
          break;
        }
        case 'crate':
          burst(e.c + 0.5, e.r + 0.5, calm ? 4 : 10, { speed: 2.6, life: 0.6, size: 0.14, color: pal.crate, kind: 'chip' });
          burst(e.c + 0.5, e.r + 0.5, calm ? 2 : 5, { speed: 2.2, life: 0.6, size: 0.12, color: pal.stripe, kind: 'chip' });
          break;
        case 'destroyed': {
          const tone = pal.tanks[e.tank] || pal.tanks.player;
          flash(e.x, e.y, 0.45, 1.15, 0.34, pal.fire);
          flash(e.x, e.y, 0.15, 0.6, 0.14, pal.flash);
          ring(e.x, e.y, 0.3, 1.5, 0.45, pal.fire, 0.12);
          burst(e.x, e.y, calm ? 6 : 16, { speed: 3.8, life: 0.8, size: 0.17, color: tone.base, kind: 'chip' });
          burst(e.x, e.y, calm ? 4 : 10, { speed: 3, life: 0.75, size: 0.13, color: tone.deep, kind: 'chip' });
          burst(e.x, e.y, calm ? 4 : 12, { speed: 4.5, life: 0.35, size: 0.07, color: pal.flash });
          smoke(e.x, e.y, calm ? 4 : 10, 0.6, 0.38, 1.7);
          if (!calm) shake = Math.max(shake, 0.3);
          const mark = { x: e.x, y: e.y, a: Math.random() * 0.5 - 0.25 };
          scorches.push(mark);
          if (floorKey === keyFor(s)) {
            worldTransform(fctx);
            drawScorch(fctx, mark);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** Advances effects, tread marks and shot smoke by dt seconds of play. */
  function update(dt, s) {
    clock += dt;
    shake = Math.max(0, shake - dt * 1.4);
    for (const p of fx) {
      p.life -= dt;
      if (p.vx !== undefined) {
        const k = Math.exp(-(p.drag || 0) * dt);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
    fx = fx.filter((p) => p.life > 0);

    if (!s) return;
    // Every shot leaves smoke: rockets and missiles a thick trail, shells a faint one.
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = reduceMotion() ? 0.08 : 0.03;
      for (const b of s.bullets) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        if (b.weapon === 'rocket') smoke(b.x - (b.vx / sp) * 0.2, b.y - (b.vy / sp) * 0.2, 1, 0.04, 0.1, 0.5);
        else if (b.weapon === 'missile') smoke(b.x - (b.vx / sp) * 0.25, b.y - (b.vy / sp) * 0.25, 1, 0.03, 0.08, 0.8);
        else smoke(b.x - (b.vx / sp) * 0.16, b.y - (b.vy / sp) * 0.16, 1, 0.02, 0.05, 0.3);
      }
    }
    // Tread marks every few centimetres of travel.
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const o = odometer.get(t.id);
      if (!o) {
        odometer.set(t.id, { x: t.x, y: t.y, d: 0, total: 0 });
        continue;
      }
      const moved = Math.hypot(t.x - o.x, t.y - o.y);
      o.d += moved;
      o.total += moved;
      o.x = t.x;
      o.y = t.y;
      if (o.d >= 0.16) {
        o.d = 0;
        marks.push({ x: t.x, y: t.y, a: t.body, t: clock });
      }
    }
    if (marks.length && clock - marks[0].t > MARK_LIFE) marks = marks.filter((m) => clock - m.t <= MARK_LIFE);
  }

  /** Forget everything visual from the previous world (new mission or retry). */
  function reset() {
    marks = [];
    scorches = [];
    fx = [];
    odometer = new Map();
    shake = 0;
    floorKey = '';
  }

  /* ---------- Drawing ---------- */

  function drawMarks() {
    if (!marks.length) return;
    const buckets = 6;
    for (let b = 0; b < buckets; b++) {
      ctx.globalAlpha = 1 - b / buckets;
      ctx.fillStyle = pal.track;
      ctx.beginPath();
      for (const m of marks) {
        const age = (clock - m.t) / MARK_LIFE;
        if (Math.min(buckets - 1, Math.floor(age * buckets)) !== b) continue;
        const hx = Math.cos(m.a);
        const hy = Math.sin(m.a);
        for (const side of [-0.27, 0.27]) {
          const cx = m.x - hy * side;
          const cy = m.y + hx * side;
          // A short dash across each tread.
          const ax = hx * 0.045;
          const ay = hy * 0.045;
          const bx = -hy * 0.085;
          const by = hx * 0.085;
          ctx.moveTo(cx - ax - bx, cy - ay - by);
          ctx.lineTo(cx + ax - bx, cy + ay - by);
          ctx.lineTo(cx + ax + bx, cy + ay + by);
          ctx.lineTo(cx - ax + bx, cy - ay + by);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** A mine's light: it blinks faster as the fuse runs down and turns red at the end. */
  function mineLight(m) {
    const urgent = m.fuse < 3;
    if (reduceMotion()) return urgent ? 'urgent' : 'on';
    const rate = urgent ? 6 : 1.5;
    const age = MINE_FUSE - m.fuse;
    if (Math.floor(age * rate * 2) % 2 === 0 || m.fuse < 0.15) return urgent ? 'urgent' : 'on';
    return 'off';
  }

  function drawAim(s, aim) {
    const p = s.tanks[0];
    if (!p.alive || aim == null || muzzleBlocked(s.grid, p.x, p.y, aim)) return;
    const pts = tracePath(s.grid, p.x + Math.cos(aim) * MUZZLE, p.y + Math.sin(aim) * MUZZLE, aim, 1, 40);
    ctx.strokeStyle = pal.aim;
    ctx.lineWidth = 0.06;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.02, 0.22]);
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.stroke();
    if (pts.length >= 6) {
      // Just a hint of the ricochet.
      const dx = pts[4] - pts[2];
      const dy = pts[5] - pts[3];
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, 2.4 / len);
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(pts[2], pts[3]);
      ctx.lineTo(pts[2] + dx * k, pts[3] + dy * k);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawReticle(pt) {
    ctx.strokeStyle = pal.aim;
    ctx.lineWidth = 0.06;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 0.28, 0, Math.PI * 2);
    ctx.moveTo(pt.x - 0.45, pt.y);
    ctx.lineTo(pt.x - 0.15, pt.y);
    ctx.moveTo(pt.x + 0.15, pt.y);
    ctx.lineTo(pt.x + 0.45, pt.y);
    ctx.moveTo(pt.x, pt.y - 0.45);
    ctx.lineTo(pt.x, pt.y - 0.15);
    ctx.moveTo(pt.x, pt.y + 0.15);
    ctx.lineTo(pt.x, pt.y + 0.45);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Smoke underneath, then flashes and rings, then debris on top.
  const LAYER = { smoke: 0, flash: 1, ring: 2 };
  const layerOf = (p) => LAYER[p.kind] ?? 3;

  function drawFx() {
    for (let layer = 0; layer <= 3; layer++) drawFxLayer(layer);
    ctx.globalAlpha = 1;
  }

  function drawFxLayer(layer) {
    for (const p of fx) {
      if (layerOf(p) !== layer) continue;
      const k = Math.max(0, p.life / p.max);
      if (p.kind === 'flash') {
        ctx.globalAlpha = k * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r1 + (p.r0 - p.r1) * k, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width * (0.4 + k);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r1 + (p.r0 - p.r1) * k, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = k * 0.45;
        ctx.fillStyle = pal.smoke;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.8 - k), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        if (p.kind === 'chip') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.spin * (1 - k) * 3);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
          ctx.restore();
        } else {
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
    }
  }

  /**
   * Draws a frame. opts: aim (angle or null) shows the aiming guide, reticle ({ x, y }
   * or null) marks where the player points, beacon (0-1) rings the player's tank.
   */
  function draw(s, { aim = null, reticle = null, beacon = 0 } = {}) {
    if (!s || !view.w) return;
    if (!pal) readPalette();
    if (floorKey !== keyFor(s)) buildFloor(s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(floor, 0, 0);

    const calm = reduceMotion();
    const jitter = shake > 0 ? shake * 0.12 : 0;
    worldTransform(ctx, jitter ? (Math.random() - 0.5) * jitter : 0, jitter ? (Math.random() - 0.5) * jitter : 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-FRAME, -FRAME, COLS + FRAME * 2, ROWS + FRAME * 2);
    ctx.clip();

    drawMarks();
    // Where bombs will land, on the floor under everything else.
    for (const b of s.bombs) drawTarget(ctx, pal, b, { calm });
    const mineShadow = vecToWorld(0.04, 0.06);
    for (const m of s.mines) {
      const owner = s.tanks.find((t) => t.id === m.owner);
      drawMine(ctx, pal, m, owner ? owner.type : 'player', mineLight(m), mineShadow);
    }

    const hidden = (t) => (TYPES[t.type].invisible ? Math.max(0, 1 - s.time / 1.2) : 1);
    // Shadows first, so no tank's shadow falls on another tank.
    const sh = vecToWorld(0.07, 0.1);
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const a = hidden(t);
      if (a > 0) drawTankShadow(ctx, pal, t, sh, a);
    }
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const a = hidden(t);
      if (a <= 0) continue;
      const T = TYPES[t.type];
      const o = odometer.get(t.id);
      drawTank(ctx, pal, t, {
        phase: o ? o.total : 0,
        mines: T.mines - owned(s.mines, t),
        lit: T.weapon === 'missile' && owned(s.bullets, t) > 0,
        alpha: a,
      });
    }

    if (beacon > 0 && s.tanks[0].alive) {
      const p = s.tanks[0];
      const pulse = (clock * 1.6) % 1;
      ctx.strokeStyle = pal.signal;
      ctx.lineWidth = 0.08;
      ctx.globalAlpha = beacon * (1 - pulse);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.55 + pulse * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawAim(s, aim);
    // A missile's light blinks; under reduced motion it stays on.
    const blink = calm || Math.floor(clock * 8) % 2 === 0;
    for (const b of s.bullets) drawShot(ctx, pal, b, { flame: calm ? 0.5 : Math.random(), blink });
    const up = vecToWorld(0, -1);
    for (const b of s.bombs) drawBomb(ctx, pal, b, up);
    drawFx();
    if (reticle) drawReticle(reticle);
    ctx.restore();
  }

  return { layout, toWorld, vecToWorld, readPalette, palette, events, update, reset, draw };
}

