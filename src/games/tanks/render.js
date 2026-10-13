// Tanks renderer: draws the world on a canvas and owns the purely visual extras
// (tread marks, scorch marks, explosions). It reads the world and never changes it.
// On a tall screen the whole arena is turned 90 degrees, so the player's side (the
// left of every map) sits at the bottom, next to the thumbs.
import {
  BLAST_R,
  COLS,
  CRATE,
  HOLE,
  MINE_FUSE,
  MUZZLE,
  ROWS,
  TYPES,
  WALL,
  cellAt,
  muzzleBlocked,
  tracePath,
} from './rules.js';

const FRAME = 0.3; // border around the arena, in cells
const MAX_DPR = 2;
const MARK_LIFE = 9; // seconds a tread mark takes to fade
const MAX_FX = 700;
const ART = 1.1; // tanks are drawn a little larger than their hit circle, like toys

const TOKENS = {
  frame: '--tk-frame',
  floor: '--tk-floor',
  joint: '--tk-joint',
  wall: '--tk-wall',
  wallLit: '--tk-wall-lit',
  wallDark: '--tk-wall-dark',
  shadow: '--tk-shadow',
  crate: '--tk-crate',
  stripe: '--tk-stripe',
  hole: '--tk-hole',
  holeRim: '--tk-hole-rim',
  track: '--tk-track',
  scorch: '--tk-scorch',
  shell: '--tk-shell',
  aim: '--tk-aim',
  ink: '--tk-ink',
  tread: '--tk-tread',
  flash: '--tk-flash',
  fire: '--tk-fire',
  smoke: '--tk-smoke',
  signal: '--signal',
};

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a hex colour toward white (amount > 0) or black (amount < 0). */
function shade(hex, amount) {
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgb(${r}, ${g}, ${b})`;
}

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
    const get = (name) => cs.getPropertyValue(name).trim();
    pal = {};
    for (const [key, name] of Object.entries(TOKENS)) pal[key] = get(name);
    pal.tanks = {};
    for (const type of Object.keys(TYPES)) {
      const base = get(`--tk-${type}`) || '#888888';
      pal.tanks[type] = { base, dark: shade(base, -0.32), light: shade(base, 0.22), deep: shade(base, -0.55) };
    }
    floorKey = '';
  }

  /* ---------- Static layer: floor, blocks, scorch marks ---------- */

  function rectPath(c, x, y, w, h) {
    c.rect(x, y, w, h);
  }

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
    const px = 1 / (view.unit * view.dpr); // one device pixel in world units
    c.fillStyle = pal.floor;
    c.fillRect(0, 0, COLS, ROWS);

    // Slab joints.
    c.strokeStyle = pal.joint;
    c.lineWidth = Math.max(px, 0.03);
    c.beginPath();
    for (let x = 1; x < COLS; x++) {
      c.moveTo(x, 0);
      c.lineTo(x, ROWS);
    }
    for (let y = 1; y < ROWS; y++) {
      c.moveTo(0, y);
      c.lineTo(COLS, y);
    }
    c.stroke();

    const kind = (col, row) => cellAt(s.grid, col, row);
    const each = (type, fn) => {
      for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) if (s.grid[r * COLS + col] === type) fn(col, r);
    };
    // Screen-relative light: up on screen is lit, down on screen is in shade.
    const up = vecToWorld(0, -1);
    const down = { x: -up.x, y: -up.y };
    const sh = vecToWorld(0.1, 0.14);
    const edge = (col, r, n, t) => {
      if (n.x === 1) return [col + 1 - t, r, t, 1];
      if (n.x === -1) return [col, r, t, 1];
      if (n.y === 1) return [col, r + 1 - t, 1, t];
      return [col, r, 1, t];
    };

    // Holes: dark pits with a rim on the edges that face the light.
    c.fillStyle = pal.hole;
    c.beginPath();
    each(HOLE, (col, r) => rectPath(c, col, r, 1, 1));
    c.fill();
    c.fillStyle = pal.holeRim;
    c.beginPath();
    each(HOLE, (col, r) => {
      if (kind(col + down.x, r + down.y) !== HOLE) rectPath(c, ...edge(col, r, down, 0.1));
    });
    c.fill();

    // Hard shadows for walls and crates.
    c.save();
    c.beginPath();
    c.rect(0, 0, COLS, ROWS);
    c.clip();
    c.fillStyle = pal.shadow;
    c.beginPath();
    for (const type of [WALL, CRATE]) each(type, (col, r) => rectPath(c, col + sh.x, r + sh.y, 1, 1));
    c.fill();
    c.restore();

    // Walls: flat ink blocks with a lit top edge and a shaded bottom edge.
    c.fillStyle = pal.wall;
    c.beginPath();
    each(WALL, (col, r) => rectPath(c, col, r, 1, 1));
    c.fill();
    c.fillStyle = pal.wallLit;
    c.beginPath();
    each(WALL, (col, r) => {
      if (kind(col + up.x, r + up.y) !== WALL) rectPath(c, ...edge(col, r, up, 0.09));
    });
    c.fill();
    c.fillStyle = pal.wallDark;
    c.beginPath();
    each(WALL, (col, r) => {
      if (kind(col + down.x, r + down.y) !== WALL) rectPath(c, ...edge(col, r, down, 0.09));
    });
    c.fill();

    // Crates: hazard stripes, one bordered block each.
    each(CRATE, (col, r) => {
      c.save();
      c.beginPath();
      c.rect(col + 0.04, r + 0.04, 0.92, 0.92);
      c.clip();
      c.fillStyle = pal.crate;
      c.fillRect(col, r, 1, 1);
      c.strokeStyle = pal.stripe;
      c.lineWidth = 0.13;
      c.beginPath();
      for (let k = -1; k <= 2; k += 0.36) {
        c.moveTo(col + k, r);
        c.lineTo(col + k - 1, r + 1);
      }
      c.stroke();
      c.restore();
      c.strokeStyle = pal.stripe;
      c.lineWidth = 0.08;
      c.strokeRect(col + 0.08, r + 0.08, 0.84, 0.84);
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
        case 'blast':
          flash(e.x, e.y, 0.4, BLAST_R, 0.32, pal.fire);
          ring(e.x, e.y, 0.3, BLAST_R * 1.15, 0.45, pal.flash, 0.12);
          smoke(e.x, e.y, calm ? 6 : 16, BLAST_R, 0.45, 1.4);
          burst(e.x, e.y, calm ? 6 : 18, { speed: 4, life: 0.55, size: 0.09, color: pal.fire });
          if (!calm) shake = Math.max(shake, 0.4);
          break;
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

  /** Advances effects, tread marks and rocket smoke by dt seconds of play. */
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
    // Rockets leave smoke.
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = reduceMotion() ? 0.08 : 0.03;
      for (const b of s.bullets) {
        if (!b.rocket) continue;
        const sp = Math.hypot(b.vx, b.vy) || 1;
        smoke(b.x - (b.vx / sp) * 0.2, b.y - (b.vy / sp) * 0.2, 1, 0.04, 0.1, 0.5);
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

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTank(t, alpha) {
    const tone = pal.tanks[t.type];
    const o = odometer.get(t.id);
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(ART, ART);
    ctx.rotate(t.body);
    // Treads with moving cleats.
    ctx.fillStyle = pal.tread;
    roundRect(-0.43, -0.39, 0.86, 0.21, 0.05);
    ctx.fill();
    roundRect(-0.43, 0.18, 0.86, 0.21, 0.05);
    ctx.fill();
    ctx.strokeStyle = tone.deep;
    ctx.lineWidth = 0.035;
    const phase = o ? o.total % 0.14 : 0;
    ctx.beginPath();
    for (let k = -0.42 + phase; k < 0.42; k += 0.14) {
      ctx.moveTo(k, -0.37);
      ctx.lineTo(k, -0.2);
      ctx.moveTo(k, 0.2);
      ctx.lineTo(k, 0.37);
    }
    ctx.stroke();
    // Hull.
    ctx.fillStyle = tone.base;
    roundRect(-0.37, -0.26, 0.74, 0.52, 0.09);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 0.045;
    ctx.stroke();
    ctx.fillStyle = tone.dark;
    ctx.fillRect(-0.3, -0.2, 0.08, 0.4);
    ctx.fillRect(0.22, -0.2, 0.08, 0.4);
    ctx.restore();

    // Turret and barrel. The barrel reaches the real muzzle, where shells appear.
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.turret);
    ctx.fillStyle = tone.dark;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.rect(0.08, -0.065, MUZZLE - 0.08, 0.13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tone.light;
    ctx.beginPath();
    ctx.arc(0, 0, 0.2 * ART, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = tone.dark;
    ctx.beginPath();
    ctx.arc(-0.05 * ART, 0, 0.065 * ART, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawMine(m, s) {
    const owner = s.tanks.find((t) => t.id === m.owner);
    const tone = pal.tanks[owner ? owner.type : 'player'];
    ctx.fillStyle = pal.shadow;
    const sh = vecToWorld(0.04, 0.06);
    ctx.beginPath();
    ctx.arc(m.x + sh.x, m.y + sh.y, 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.ink;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tone.base;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 0.16, 0, Math.PI * 2);
    ctx.fill();
    // The light blinks faster as the fuse runs down, and turns red at the end.
    const urgent = m.fuse < 3;
    const rate = urgent ? 6 : 1.5;
    const age = MINE_FUSE - m.fuse;
    if (Math.floor(age * rate * 2) % 2 === 0 || m.fuse < 0.15) {
      ctx.fillStyle = urgent ? '#ff3b30' : pal.signal;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawShell(b) {
    const a = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    if (b.rocket) {
      ctx.fillStyle = pal.fire;
      ctx.beginPath();
      ctx.moveTo(-0.13, -0.05);
      ctx.lineTo(-0.3 - Math.random() * 0.08, 0);
      ctx.lineTo(-0.13, 0.05);
      ctx.fill();
    }
    ctx.fillStyle = pal.shell;
    roundRect(-0.14, -0.065, 0.28, 0.13, 0.065);
    ctx.fill();
    ctx.restore();
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

    const jitter = shake > 0 ? shake * 0.12 : 0;
    worldTransform(ctx, jitter ? (Math.random() - 0.5) * jitter : 0, jitter ? (Math.random() - 0.5) * jitter : 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-FRAME, -FRAME, COLS + FRAME * 2, ROWS + FRAME * 2);
    ctx.clip();

    drawMarks();
    for (const m of s.mines) drawMine(m, s);

    const hidden = (t) => (TYPES[t.type].invisible ? Math.max(0, 1 - s.time / 1.2) : 1);
    // Shadows first, so no tank's shadow falls on another tank.
    const sh = vecToWorld(0.07, 0.1);
    ctx.fillStyle = pal.shadow;
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const a = hidden(t);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(t.x + sh.x, t.y + sh.y);
      ctx.scale(ART, ART);
      ctx.rotate(t.body);
      roundRect(-0.43, -0.39, 0.86, 0.78, 0.08);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const a = hidden(t);
      if (a > 0) drawTank(t, a);
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
    for (const b of s.bullets) drawShell(b);
    drawFx();
    if (reticle) drawReticle(reticle);
    ctx.restore();
  }

  return { layout, toWorld, vecToWorld, readPalette, events, update, reset, draw };
}
