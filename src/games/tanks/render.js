// Tanks renderer: draws the world on a canvas and owns the purely visual extras (tread marks,
// scorch marks, crate splinters, chips knocked off walls, exhaust, recoil, explosions). It reads
// the world and never changes it.
// On a tall screen the whole arena is turned 90 degrees, so the player's side (the
// left of every map) sits at the bottom, next to the thumbs. The canvas covers the
// screen, and everything on it round the field is wall. The art itself (ground,
// tanks, shots, bombs) is in art.js, which the field guide draws with too.
import {
  ART,
  LIGHT,
  drawBomb,
  drawGround,
  drawMine,
  drawShadows,
  drawShot,
  drawTank,
  drawTarget,
  glow,
  makePalette,
  makeSprites,
  roundRect,
  shade,
} from './art.js';
import {
  BLAST_R,
  COLS,
  CRATE,
  LASER_CHARGE,
  MINE_FUSE,
  MUZZLE,
  ROWS,
  SHELL_R,
  SPIN_DOWN,
  TAU,
  TYPES,
  angleDiff,
  beamLine,
  blocksShell,
  cellAt,
  muzzleBlocked,
  owned,
  tracePath,
} from './rules.js';

const RING = 2; // cells of wall kept round the field, on the sides that have the room
const SKIRT = 0.5; // cells of wall kept between the field and a screen edge it runs to
const MAX_DPR = 2;
const MARK_LIFE = 9; // seconds a tread mark takes to fade
const MAX_FX = 700;
const ROLL = 18; // radians per second a minigun's barrels turn at full speed (a quarter under reduced motion)
const CHIP_LIFE = 3; // seconds a chip knocked off a wall lasts (a minigun round's, half that); it fades over the last two
const MAX_CHIPS = 90;
const HEAT_ROUND = 0.04; // how much each round heats a minigun's barrels: full after 25 (2.5 s of spray)
const HEAT_HOLD = 0.2; // seconds after its last round before they start to cool

// PERFORMANCE: the screen's edges past the two cells of wall round the field (the top and bottom
// in portrait, the sides in landscape) are blurred once, into the floor canvas, whenever it is
// built for a layout, so they cost nothing per frame. They used to be CSS backdrop-filter layers
// over the arena (.pblur-deep), which iOS blurs again on every frame, because the canvas under
// them is drawn again on every frame. These are .pblur-deep's layers from styles.css, in order:
// each blurs what the ones before it left (blur: CSS px), whole from the screen's edge to `from`
// of the edge's depth, gone by `to`.
const EDGE_BLURS = [
  { blur: 3, from: 0.8, to: 1 },
  { blur: 7, from: 0.45, to: 0.8 },
  { blur: 14, from: 0.1, to: 0.45 },
];
// In portrait, over the blur, .pblur-deep's shade: the page's background, at these strengths
// from the screen's edge to the end of the edge's depth.
const EDGE_SHADE = [[0, 1], [0.24, 0.86], [0.46, 0.68], [0.66, 0.42], [0.84, 0.18], [1, 0]];

export function createRenderer(canvas, { reduceMotion = () => false } = {}) {
  const ctx = canvas.getContext('2d');
  const floor = document.createElement('canvas');
  const fctx = floor.getContext('2d');
  // PERFORMANCE: the tanks' kept pictures (art.js makeSprites), so a tank is
  // painted only when it looks different, not on every frame.
  const sprites = makeSprites(() => document.createElement('canvas'));
  // unit: CSS px a cell; w x h: the canvas (the screen); x, y: the field's top left on it;
  // cols x rows: the size of the field laid out (rules.js SCALES).
  const view = { unit: 20, rot: false, w: 0, h: 0, dpr: 1, x: 0, y: 0, cols: COLS, rows: ROWS };
  let pal = null;
  let tones = null;
  let page = '#0b0b0b'; // the page's background (--bg)
  let floorKey = '';
  let rimKey = ''; // the layout the floor canvas holds everything past the field for
  let marks = [];
  let scorches = [];
  let rubble = []; // splinters where crates stood, on the floor for the rest of the mission
  let chips = []; // pale chips shots knock off walls and crates, fading
  let fx = [];
  let odometer = new Map();
  let guns = new Map(); // tank id -> { fired, round, heat, side }: world times of its last shot and round, a minigun's heat, the missile pod that fired
  let clock = 0;
  let worldTime = 0;
  let shake = 0;
  let smokeTimer = 0;

  /* ---------- Layout and coordinates ---------- */

  /**
   * Sizes the canvas to the screen (screenW x screenH CSS px) and fits the field in box ({ x, y,
   * w, h }, the room the page leaves it, on the screen). Upright, the field spans the width but
   * for a skirt of wall each side, two cells of wall over it from the box's top; flat, it spans
   * the height but for a skirt of wall top and bottom, centred, with two cells of wall at least
   * left and right. size is the field's [cols, rows], the campaign's unless a map of your own is
   * another size. Returns the orientation, and where those two cells of wall start and end on
   * the screen: top and bottom (y), left and right (x).
   */
  function layout(screenW, screenH, box, [cols, rows] = [COLS, ROWS]) {
    view.cols = cols;
    view.rows = rows;
    // Upright: the field and its skirts across, its walls and the field down. Flat: the field and
    // its walls across, the field and its skirts down.
    const flat = Math.min(box.w / (cols + RING * 2), box.h / (rows + SKIRT * 2));
    const upright = Math.min(box.w / (rows + SKIRT * 2), box.h / (cols + RING * 2));
    view.rot = upright > flat * 1.04;
    const u = Math.max(4, Math.floor((view.rot ? upright : flat) * 4) / 4);
    view.unit = u;
    view.w = Math.round(screenW);
    view.h = Math.round(screenH);
    view.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const snap = (v) => Math.round(v * view.dpr) / view.dpr;
    view.x = snap(box.x + (box.w - u * (view.rot ? rows : cols)) / 2);
    view.y = snap(view.rot ? box.y + RING * u : box.y + (box.h - u * rows) / 2);
    for (const c of [canvas, floor]) {
      c.width = Math.round(view.w * view.dpr);
      c.height = Math.round(view.h * view.dpr);
    }
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    floorKey = rimKey = '';
    return { rotated: view.rot, ...walls() };
  }

  /** Where the two cells of wall round the field start and end on the screen, CSS px: top and bottom (y), left and right (x). */
  function walls() {
    const fw = view.unit * (view.rot ? view.rows : view.cols);
    const fh = view.unit * (view.rot ? view.cols : view.rows);
    const wall = RING * view.unit;
    return { top: view.y - wall, bottom: view.y + fh + wall, left: view.x - wall, right: view.x + fw + wall };
  }

  /** World -> canvas pixel transform for a 2D context. */
  function worldTransform(c, ox = 0, oy = 0) {
    const s = view.unit * view.dpr;
    const x = view.x * view.dpr + ox * s;
    const y = view.y * view.dpr + oy * s;
    if (view.rot) c.setTransform(0, -s, s, 0, x, y + view.cols * s);
    else c.setTransform(s, 0, 0, s, x, y);
  }

  /** A point in canvas CSS pixels -> world coordinates. */
  function toWorld(px, py) {
    const u = (px - view.x) / view.unit;
    const v = (py - view.y) / view.unit;
    return view.rot ? { x: view.cols - v, y: u } : { x: u, y: v };
  }

  /** A direction on screen -> the same direction in the world. */
  function vecToWorld(dx, dy) {
    return view.rot ? { x: -dy, y: dx } : { x: dx, y: dy };
  }

  /** A world direction -> the same direction on screen (the inverse of vecToWorld). */
  function vecToScreen(wx, wy) {
    return view.rot ? { x: wy, y: -wx } : { x: wx, y: wy };
  }

  /* ---------- Palette ---------- */

  function readPalette() {
    const cs = getComputedStyle(canvas);
    pal = makePalette((name) => cs.getPropertyValue(name).trim());
    // A chip's tones on each kind of block: fresh (the broken face), deep (shadow, and cracks),
    // pit (the pock), rim (light caught on the pock's far rim) and dust (the bloom round it, and
    // the puff off it).
    const of = (base, lit) => ({ fresh: shade(lit, 0.18), deep: shade(base, -0.42), pit: shade(base, -0.62), rim: shade(lit, 0.4), dust: shade(lit, 0.45) });
    tones = { wall: of(pal.wall, pal.wallLit), crate: of(pal.crate, pal.crateLit) };
    page = cs.getPropertyValue('--bg').trim() || '#0b0b0b'; // what the screen's edges shade to
    floorKey = rimKey = '';
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

  /**
   * A broken crate's splinters, lying flat where it stood: each a thin sliver in one of the
   * crate's greys, with a small shadow along the screen's light.
   */
  function drawRubble(c, list) {
    const L = vecToWorld(Math.cos(LIGHT), Math.sin(LIGHT));
    const sliver = (m, dx, dy) => {
      const h = m.len / 2;
      const w = m.w / 2;
      c.save();
      c.translate(m.x + dx, m.y + dy);
      c.rotate(m.a);
      c.beginPath();
      c.moveTo(-h, w * m.bend);
      c.lineTo(-h + m.w * 0.7, -w);
      c.lineTo(h - m.w * 0.4, -w * 0.7);
      c.lineTo(h, w * 0.2);
      c.lineTo(h - m.w * 0.9, w);
      c.lineTo(-h + m.w * 0.5, w * 0.8);
      c.closePath();
      c.fill();
      c.restore();
    };
    c.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (const m of list) sliver(m, L.x * 0.03, L.y * 0.03);
    for (const m of list) {
      c.fillStyle = pal[m.tone];
      sliver(m, 0, 0);
    }
  }

  function buildFloor(s) {
    const c = fctx;
    // Past the field it is all wall (rules.js cellAt), and nothing past the wall's first cell
    // hangs on the map. So once the floor canvas holds all of it for this layout, a new map, a
    // crate blown away or a stroke in the editor only draws the field and that cell again (with
    // the cell past it, whose edges and shadows reach in).
    const whole = rimKey !== rimFor();
    let area = [-RING, -RING, view.cols + RING * 2, view.rows + RING * 2];
    c.save();
    if (whole) {
      // Every cell on the screen.
      const a = toWorld(0, 0);
      const b = toWorld(view.w, view.h);
      const x0 = Math.floor(Math.min(a.x, b.x));
      const y0 = Math.floor(Math.min(a.y, b.y));
      area = [x0, y0, Math.ceil(Math.max(a.x, b.x)) - x0, Math.ceil(Math.max(a.y, b.y)) - y0];
    } else {
      worldTransform(c);
      c.beginPath();
      c.rect(-1, -1, view.cols + 2, view.rows + 2);
      c.clip();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = pal.frame;
    c.fillRect(0, 0, floor.width, floor.height);
    worldTransform(c);
    // The light is the screen's (art.js LIGHT), so it stays at the top left however the arena turns.
    drawGround(c, pal, { cols: view.cols, rows: view.rows, kindAt: (col, row) => cellAt(s.grid, col, row), area });
    c.restore();
    // PERFORMANCE: the blurred screen edges, baked in here once instead of blurred by CSS every frame.
    if (whole) blurEdges();
    worldTransform(c);
    for (const m of scorches) drawScorch(c, m);
    drawRubble(c, rubble);
    rimKey = rimFor();
    floorKey = keyFor(s);
  }

  /** A new canvas at least w x h device px (and 1 x 1). */
  function canvasOf(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }

  /** The widths of n box blurs that, one after another, blur about as a Gaussian of sigma does (odd, so each has a middle). */
  function boxes(sigma, n) {
    const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let lo = Math.floor(ideal);
    if (lo % 2 === 0) lo--;
    const m = Math.round((12 * sigma * sigma - n * lo * lo - 4 * n * lo - 3 * n) / (-4 * lo - 4));
    return Array.from({ length: n }, (_, i) => (i < m ? lo : lo + 2));
  }

  /**
   * cur blurred by a box 2r + 1 px wide along (dx, dy), on a new w x h canvas: its shifts laid
   * one by one, the nth at 1/n strength, which keeps the running average of them all (to within
   * a level of 255 at each step, where adding them up at 1/(2r + 1) each would lose several).
   */
  function boxBlur(cur, w, h, r, dx, dy) {
    const out = canvasOf(w, h);
    const g = out.getContext('2d');
    for (let i = -r, n = 1; i <= r; i++, n++) {
      g.globalAlpha = 1 / n;
      g.drawImage(cur, i * dx, i * dy);
    }
    return out;
  }

  /**
   * The (x, y, w, h) rectangle of src blurred about as CSS blur(sigma) blurs it (sigma device px),
   * on a new w x h canvas. It reads pad px round the rectangle, so that much round it must be
   * picture. Halved while sigma is over 4 px at that scale (each halving a plain average of 2 x 2
   * pixels: art.js soften says why never more at once), blurred there by three box blurs across
   * and three down, then doubled back the same way.
   */
  function gauss(src, x, y, w, h, sigma, pad) {
    let n = 0;
    while (sigma / 2 ** n > 4) n++;
    const W = w + 2 * pad;
    const H = h + 2 * pad;
    const size = (k) => [W / 2 ** k, H / 2 ** k];
    const scaled = (from, [fw, fh], [tw, th]) => {
      const to = canvasOf(tw, th);
      const g = to.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'low';
      g.drawImage(from, 0, 0, fw, fh, 0, 0, tw, th);
      return to;
    };
    let cur = canvasOf(W, H);
    cur.getContext('2d').drawImage(src, x - pad, y - pad, W, H, 0, 0, W, H);
    for (let k = 1; k <= n; k++) cur = scaled(cur, size(k - 1), size(k));
    const [sw, sh] = size(n);
    for (const b of boxes(sigma / 2 ** n, 3)) {
      cur = boxBlur(cur, sw, sh, (b - 1) / 2, 1, 0);
      cur = boxBlur(cur, sw, sh, (b - 1) / 2, 0, 1);
    }
    for (let k = n - 1; k >= 0; k--) cur = scaled(cur, size(k + 1), size(k));
    const out = canvasOf(w, h);
    out.getContext('2d').drawImage(cur, pad, pad, w, h, 0, 0, w, h);
    return out;
  }

  /**
   * PERFORMANCE: bakes the blurred screen edges into the floor canvas (EDGE_BLURS says why).
   * Each layer blurs the floor as the layers before it left it, drawn out past the screen by
   * repeating its outermost pixels (what a blur at the screen's edge sees), fades it out toward
   * the field and lays it on the floor. Called whenever the floor is built for a new layout.
   */
  function blurEdges() {
    const d = view.dpr;
    const W = floor.width;
    const H = floor.height;
    const at = walls();
    const wide = view.w > view.h; // landscape, as styles.css's @media (orientation: landscape) has it
    // Each edge: its rectangle on the floor canvas (device px), and the way in from the screen's edge.
    const top = Math.round(at.top * d);
    const bottom = Math.round(at.bottom * d);
    const left = Math.round(at.left * d);
    const right = Math.round(at.right * d);
    const edges = (
      wide
        ? [{ x: 0, y: 0, w: left, h: H, dx: 1, dy: 0 }, { x: right, y: 0, w: W - right, h: H, dx: -1, dy: 0 }]
        : [{ x: 0, y: 0, w: W, h: top, dx: 0, dy: 1 }, { x: 0, y: bottom, w: W, h: H - bottom, dx: 0, dy: -1 }]
    ).filter((e) => e.w > 0 && e.h > 0);
    if (!edges.length) return;
    // From the screen's edge, inward, across an edge's rectangle (its own coordinates).
    const across = (g, e) => {
      const depth = e.dx ? e.w : e.h;
      const sx = e.dx < 0 ? e.w : 0;
      const sy = e.dy < 0 ? e.h : 0;
      return g.createLinearGradient(sx, sy, sx + e.dx * depth, sy + e.dy * depth);
    };
    const pad = Math.ceil(3 * EDGE_BLURS[EDGE_BLURS.length - 1].blur * d); // three sigma of the deepest blur
    const work = canvasOf(W + 2 * pad, H + 2 * pad);
    const wg = work.getContext('2d');
    fctx.save();
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const layer of EDGE_BLURS) {
      wg.clearRect(0, 0, work.width, work.height);
      wg.drawImage(floor, pad, pad);
      wg.drawImage(floor, 0, 0, W, 1, pad, 0, W, pad);
      wg.drawImage(floor, 0, H - 1, W, 1, pad, H + pad, W, pad);
      wg.drawImage(floor, 0, 0, 1, H, 0, pad, pad, H);
      wg.drawImage(floor, W - 1, 0, 1, H, W + pad, pad, pad, H);
      for (const [sx, sy, tx, ty] of [[0, 0, 0, 0], [W - 1, 0, W + pad, 0], [0, H - 1, 0, H + pad], [W - 1, H - 1, W + pad, H + pad]]) {
        wg.drawImage(floor, sx, sy, 1, 1, tx, ty, pad, pad);
      }
      for (const e of edges) {
        const blurred = gauss(work, e.x + pad, e.y + pad, e.w, e.h, layer.blur * d, pad);
        const g = blurred.getContext('2d');
        const fade = across(g, e);
        fade.addColorStop(0, '#000');
        fade.addColorStop(layer.from, '#000');
        fade.addColorStop(layer.to, 'rgba(0, 0, 0, 0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = fade;
        g.fillRect(0, 0, e.w, e.h);
        fctx.drawImage(blurred, 0, 0, e.w, e.h, e.x, e.y, e.w, e.h);
      }
    }
    if (!wide) {
      for (const e of edges) {
        fctx.save();
        fctx.translate(e.x, e.y);
        const shadeTo = across(fctx, e);
        for (const [stop, a] of EDGE_SHADE) shadeTo.addColorStop(stop, rgba(page, a));
        fctx.fillStyle = shadeTo;
        fctx.fillRect(0, 0, e.w, e.h);
        fctx.restore();
      }
    }
    fctx.restore();
  }

  const rimFor = () => `${view.w}x${view.h}:${view.x},${view.y}@${view.unit}:${view.rot}:${view.dpr}:${view.cols}:${pal && pal.floor}`;
  const keyFor = (s) => `${s.gridVer}:${rimFor()}`;

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

  /** Smoke puffs round (x, y), drifting at (vx, vy) give or take jitter. */
  function smoke(x, y, n, spread = 0.2, size = 0.22, life = 0.9, { vx = 0, vy = 0, jitter = 0.5, drag = 1.5, color } = {}) {
    for (let i = 0; i < n; i++) {
      add({
        kind: 'smoke',
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: vx + (Math.random() - 0.5) * jitter,
        vy: vy + (Math.random() - 0.5) * jitter,
        life: life * (0.7 + Math.random() * 0.6),
        max: life,
        size: size * (0.7 + Math.random() * 0.6),
        drag,
        color,
      });
    }
  }

  /** Sparks flying out within spread of angle a, drawn as short streaks along their flight. */
  function sparks(x, y, a, spread, n, { speed = 3, life = 0.2, size = 0.04, color, drag = 6 }) {
    for (let i = 0; i < n; i++) {
      const d = a + (Math.random() - 0.5) * 2 * spread;
      const v = speed * (0.45 + Math.random() * 0.7);
      add({ kind: 'streak', x, y, vx: Math.cos(d) * v, vy: Math.sin(d) * v, life: life * (0.6 + Math.random() * 0.6), max: life, size, color, drag });
    }
  }

  /** A tank's gun: when it last fired and its last minigun round (world time), and its barrels' heat. */
  function gun(id) {
    let g = guns.get(id);
    if (!g) guns.set(id, (g = { fired: -Infinity, round: -Infinity, heat: 0, side: 0 }));
    return g;
  }

  /**
   * The muzzle as a shot leaves it: a flame along the shot (a muzzle brake's out of its sides
   * too), a flash of its light on the floor, smoke pushed out after it and a few sparks. A
   * missile's backblast also blows smoke out behind the tank; a minigun round gets a small flame
   * and flicks out a spent casing.
   */
  function muzzle(e, calm) {
    const ux = Math.cos(e.angle);
    const uy = Math.sin(e.angle);
    if (e.weapon === 'minigun') {
      add({ kind: 'muzzle', x: e.x, y: e.y, a: e.angle + (Math.random() - 0.5) * 0.3, size: 0.2, life: 0.05, max: 0.05 });
      if (!calm) {
        const a = e.angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random() * 0.6);
        const v = 1.6 + Math.random();
        add({ kind: 'chip', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35, max: 0.35, size: 0.05, color: pal.flash, drag: 5, spin: Math.random() * 6 });
      }
      return;
    }
    const brake = e.weapon === 'rocket';
    const missile = e.weapon === 'missile';
    add({ kind: 'muzzle', x: e.x, y: e.y, a: e.angle, size: brake ? 0.44 : missile ? 0.26 : 0.34, brake, life: 0.08, max: 0.08 });
    add({ kind: 'glow', x: e.x, y: e.y, r: brake ? 0.95 : 0.7, life: 0.1, max: 0.1, color: pal.fire, a: 0.32 });
    smoke(e.x, e.y, calm ? 1 : 3, 0.06, 0.1, 0.6, { vx: ux * 1.4, vy: uy * 1.4, jitter: 0.7, drag: 4 });
    if (brake) {
      for (const side of [-1, 1]) smoke(e.x - ux * 0.08, e.y - uy * 0.08, calm ? 1 : 2, 0.04, 0.09, 0.5, { vx: -uy * side * 1.5, vy: ux * side * 1.5, jitter: 0.5, drag: 4 });
    }
    if (missile) smoke(e.x - ux * 0.95, e.y - uy * 0.95, calm ? 1 : 3, 0.1, 0.11, 0.7, { vx: -ux * 1.2, vy: -uy * 1.2, jitter: 0.7, drag: 3 });
    if (!calm) sparks(e.x, e.y, e.angle, 0.3, brake ? 5 : 3, { speed: 4.5, life: 0.12, color: pal.flash });
  }

  /**
   * A shot meeting a wall or crate (e carries the face's normal): a spark off the face and a
   * pale chip knocked out of it, cracked, which fades over a few seconds, so you can read where
   * shots bounce. A shot that dies there knocks out a bigger one; a rocket or missile bursts in
   * fire and scorches it.
   */
  function impact(e, s, calm, end) {
    const n = Math.hypot(e.nx, e.ny);
    const nx = e.nx / n;
    const ny = e.ny / n;
    const a = Math.atan2(ny, nx);
    const x = e.x - nx * SHELL_R;
    const y = e.y - ny * SHELL_R;
    const round = e.weapon === 'minigun';
    const burn = end && (e.weapon === 'rocket' || e.weapon === 'missile');
    if (burn) {
      flash(x, y, 0.1, 0.42, 0.16, pal.fire);
      add({ kind: 'glow', x, y, r: 0.9, life: 0.18, max: 0.18, color: pal.fire, a: 0.35 });
      smoke(x + nx * 0.15, y + ny * 0.15, calm ? 2 : 5, 0.2, 0.15, 0.8, { vx: nx * 0.8, vy: ny * 0.8, jitter: 0.6, drag: 3 });
    } else flash(x, y, 0.02, round ? 0.1 : 0.16, 0.06, pal.flash);
    sparks(x, y, a, 1.1, calm ? 1 : round ? 2 : burn ? 7 : 5, { speed: 3.4, life: 0.2, color: pal.flash });
    if (!calm && !round) sparks(x, y, a, 0.9, 2, { speed: 2.4, life: 0.26, color: pal.fire });
    if (!round) {
      const dust = tones[cellAt(s.grid, Math.floor(x - nx * 0.05), Math.floor(y - ny * 0.05)) === CRATE ? 'crate' : 'wall'].dust;
      smoke(x + nx * 0.05, y + ny * 0.05, calm ? 1 : 3, 0.06, 0.06, 0.5, { vx: nx * 0.8, vy: ny * 0.8, jitter: 0.6, drag: 3, color: dust });
    }
    chip(s, x, y, nx, ny, { size: round ? 0.6 : end ? 1.25 : 1, life: round ? CHIP_LIFE / 2 : CHIP_LIFE, cracks: round ? 0 : end ? 5 : 3, crumbs: round ? 1 : end ? 4 : 3, burn });
  }

  /**
   * A chip knocked out of the block at (x, y), on the face whose normal is (nx, ny): a pale flake
   * spalled off its edge with a pock in the middle where the shot struck, a short fan of cracks
   * running from the pock into the block, and a few crumbs on the floor in front of it. A shell's
   * edge can meet a block beside the row (or column) its centre is in, so it goes on the nearest
   * block. Its shape is worked out once, here.
   */
  function chip(s, x, y, nx, ny, { size, life, cracks, crumbs, burn }) {
    const px = x - nx * 0.04;
    const py = y - ny * 0.04;
    let best = null;
    for (let r = Math.floor(py - 0.25); r <= Math.floor(py + 0.25); r++) {
      for (let c = Math.floor(px - 0.25); c <= Math.floor(px + 0.25); c++) {
        if (!blocksShell(cellAt(s.grid, c, r))) continue;
        const d = Math.hypot(px - Math.max(c, Math.min(c + 1, px)), py - Math.max(r, Math.min(r + 1, py)));
        if (!best || d < best.d) best = { c, r, d };
      }
    }
    if (!best) return;
    // On the face, within the block it hit.
    const cx = Math.max(best.c + 0.08, Math.min(best.c + 0.92, px)) + nx * 0.04;
    const cy = Math.max(best.r + 0.08, Math.min(best.r + 0.92, py)) + ny * 0.04;
    // u: along the face; v: into the block. Shapes are ovals on the face line, so only their
    // inner half shows on the block.
    const at = (u, v) => [cx - ny * u - nx * v, cy + nx * u - ny * v];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const oval = (n, along, into, jag) => {
      const pts = [];
      for (let k = 0; k < n; k++) {
        const t = ((k + rnd(-0.25, 0.25)) / n) * TAU;
        const g = (k % 2 ? 1 - jag : 1) * rnd(0.85, 1.12);
        pts.push(...at(Math.cos(t) * along * size * g, Math.sin(t) * into * size * g));
      }
      return pts;
    };
    const flake = oval(14, 0.14, 0.1, 0.22);
    const pock = oval(8, 0.06, 0.05, 0.08);
    // Cracks fan out from the pock's rim into the block: short, nearly straight, each with a kink.
    const lines = [];
    for (let k = 0; k < cracks; k++) {
      const a = (cracks > 1 ? (k / (cracks - 1) - 0.5) * 2.3 : 0) + rnd(-0.2, 0.2);
      const into = Math.atan2(-ny, -nx) + a;
      const [sx, sy] = at(Math.sin(a) * 0.05 * size, Math.cos(a) * 0.04 * size);
      const len = rnd(0.07, 0.15) * size * (1 - Math.abs(a) * 0.2);
      const bend = into + rnd(-0.4, 0.4);
      const mx = sx + Math.cos(into) * len * 0.55;
      const my = sy + Math.sin(into) * len * 0.55;
      lines.push([sx, sy, mx, my, mx + Math.cos(bend) * len * 0.45, my + Math.sin(bend) * len * 0.45]);
    }
    // Crumbs knocked out onto the floor in front of the face.
    const bits = [];
    for (let k = 0; k < crumbs; k++) {
      const [bx, by] = at(rnd(-0.22, 0.22), -rnd(0.08, 0.32));
      bits.push({ x: bx, y: by, a: rnd(0, Math.PI), r: rnd(0.022, 0.036) * Math.max(1, size) });
    }
    chips.push({ x: cx, y: cy, nx, ny, c: best.c, r: best.r, crate: cellAt(s.grid, best.c, best.r) === CRATE, t: clock, life, size, burn, flake, pock, lines, bits });
    if (chips.length > MAX_CHIPS) chips.shift();
  }

  /** A few splinters on the floor where crate (c, r) stood. */
  function splinters(c, r) {
    const tones = ['crate', 'crate', 'crateLit', 'crateDark'];
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n + 2; i++) {
      const chunk = i >= n; // and a couple of small chunks
      const len = chunk ? 0.06 + Math.random() * 0.03 : 0.13 + Math.random() * 0.15;
      rubble.push({
        x: c + 0.5 + (Math.random() - 0.5) * 0.62,
        y: r + 0.5 + (Math.random() - 0.5) * 0.62,
        a: Math.random() * Math.PI,
        len,
        w: chunk ? len * 0.8 : 0.035 + Math.random() * 0.03,
        bend: (Math.random() - 0.5) * 0.8,
        tone: tones[Math.floor(Math.random() * tones.length)],
      });
    }
  }

  /**
   * Two small puffs from the back of the hull as a tank pulls away from a stop, or turns hard
   * (through about 45 degrees near its full turn rate). dw: world seconds since the last look.
   */
  function exhaust(t, o, dw) {
    const T = TYPES[t.type];
    o.puff = Math.max(0, o.puff - dw);
    let go = false;
    if (Math.hypot(t.vx, t.vy) < 0.05) o.still += dw;
    else {
      if (o.still > 0.3) go = true;
      o.still = 0;
    }
    const turn = angleDiff(t.body, o.body);
    o.body = t.body;
    if (Math.abs(turn) / dw > T.turn * 0.6) {
      o.turned += turn;
      if (Math.abs(o.turned) > 0.8) {
        go = true;
        o.turned = 0;
      }
    } else o.turned = 0;
    if (!go || o.puff > 0) return;
    o.puff = 0.5;
    const ca = Math.cos(t.body);
    const sa = Math.sin(t.body);
    for (const side of [-1, 1]) {
      const lx = -0.4 * ART;
      const ly = side * 0.15 * ART;
      const vx = -ca * 0.7 - sa * side * 0.2;
      const vy = -sa * 0.7 + ca * side * 0.2;
      smoke(t.x + ca * lx - sa * ly, t.y + sa * lx + ca * ly, 1, 0.03, 0.09, 0.75, { vx, vy, jitter: 0.25, drag: 3 });
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
    if (!pal) readPalette();
    const calm = reduceMotion();
    for (const e of list) {
      switch (e.type) {
        case 'shot': {
          // The gun recoils (art.js): a missile tank's pods fire in turn, and only the one that
          // fired slides back. A minigun's barrels heat up a little with every round.
          const g = gun(e.id);
          g.fired = s.time;
          g.side = e.side || 0;
          if (e.weapon === 'minigun') {
            g.round = s.time;
            g.heat = Math.min(1, g.heat + HEAT_ROUND);
          }
          muzzle(e, calm);
          break;
        }
        case 'lob': {
          // The tube punches down (art.js), a flash and a puff come out of it as the bomb leaves,
          // and the shock throws dust out from under the pad.
          gun(e.id).fired = s.time;
          flash(e.x, e.y, 0.08, 0.26, 0.08, pal.flash);
          ring(e.x, e.y, 0.15, 0.6, 0.3, pal.smoke, 0.07);
          smoke(e.x, e.y, calm ? 2 : 5, 0.25, 0.2, 0.8);
          const n = calm ? 8 : 22;
          for (let i = 0; i < n; i++) {
            const a = ((i + Math.random()) / n) * TAU;
            const ux = Math.cos(a);
            const uy = Math.sin(a);
            const r = 0.42 + Math.random() * 0.12;
            const v = 0.7 + Math.random() * 0.7;
            smoke(e.x + ux * r, e.y + uy * r, 1, 0.04, 0.055, 0.5, { vx: ux * v, vy: uy * v, jitter: 0.25, drag: 4, color: tones.wall.dust });
          }
          break;
        }
        case 'fizzle':
          gun(e.id).fired = s.time;
          smoke(e.x, e.y, calm ? 2 : 4, 0.15, 0.13, 0.5);
          break;
        case 'pop':
          // A shot that died on a wall (one still in the air when a battle ends has no face).
          if (e.nx || e.ny) impact(e, s, calm, true);
          smoke(e.x, e.y, calm ? 2 : 4, 0.15, 0.13, 0.5);
          break;
        case 'bounce':
          impact(e, s, calm, false);
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
          // Pieces fly, and splinters stay on the floor (the floor is drawn again: the grid changed).
          burst(e.c + 0.5, e.r + 0.5, calm ? 4 : 10, { speed: 2.6, life: 0.6, size: 0.14, color: pal.crate, kind: 'chip' });
          burst(e.c + 0.5, e.r + 0.5, calm ? 2 : 5, { speed: 2.2, life: 0.6, size: 0.12, color: pal.crateDark, kind: 'chip' });
          splinters(e.c, e.r);
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
    if (chips.length && clock - chips[0].t > chips[0].life) chips = chips.filter((m) => clock - m.t < m.life);

    if (!s) return;
    // World time since the last look: zero while paused, or between two steps on a fast screen.
    const dw = s.time - worldTime;
    worldTime = s.time;
    // A minigun's barrels cool, once it stops firing, as fast as they run down.
    if (dw > 0) for (const g of guns.values()) if (g.heat > 0 && s.time - g.round > HEAT_HOLD) g.heat = Math.max(0, g.heat - dw / SPIN_DOWN);
    // Every shot leaves smoke: rockets and missiles a thick trail, shells a faint one, minigun
    // rounds a fainter, shorter one. A minigun keeps ten in the air, so their smoke is the first
    // thing dropped on a busy screen, leaving room for explosions.
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = reduceMotion() ? 0.08 : 0.03;
      for (const b of s.bullets) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        if (b.weapon === 'minigun') {
          if (fx.length < MAX_FX - 200) smoke(b.x - (b.vx / sp) * 0.12, b.y - (b.vy / sp) * 0.12, 1, 0.02, 0.04, 0.22);
        } else if (b.weapon === 'rocket') smoke(b.x - (b.vx / sp) * 0.2, b.y - (b.vy / sp) * 0.2, 1, 0.04, 0.1, 0.5);
        else if (b.weapon === 'missile') smoke(b.x - (b.vx / sp) * 0.25, b.y - (b.vy / sp) * 0.25, 1, 0.03, 0.08, 0.8);
        else smoke(b.x - (b.vx / sp) * 0.16, b.y - (b.vy / sp) * 0.16, 1, 0.02, 0.05, 0.3);
      }
    }
    // Tread marks every few centimetres of travel, a minigun's barrels turning, and exhaust as a
    // tank pulls away or turns hard (never from White, which would give it away).
    const roll = ROLL * (reduceMotion() ? 0.25 : 1);
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const o = odometer.get(t.id);
      if (!o) {
        odometer.set(t.id, { x: t.x, y: t.y, d: 0, total: 0, roll: 0, body: t.body, still: 0, turned: 0, puff: 0 });
        continue;
      }
      if (dw > 0 && TYPES[t.type].speed && !TYPES[t.type].invisible) exhaust(t, o, dw);
      if (t.spin) o.roll = (o.roll + t.spin * roll * dt) % (Math.PI * 2);
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
    rubble = [];
    chips = [];
    fx = [];
    odometer = new Map();
    guns = new Map();
    worldTime = 0;
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

  /** #rrggbb at alpha a. */
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /** A crack as one thin shape along pts, w across at its root, thinning to a point. */
  function crack(pts, w, ox, oy) {
    const n = pts.length / 2;
    const side = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = pts[b * 2] - pts[a * 2];
      const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
      const len = Math.hypot(dx, dy) || 1;
      const h = (w / 2) * (1 - (0.85 * i) / (n - 1));
      side.push([(-dy / len) * h, (dx / len) * h]);
    }
    ctx.moveTo(pts[0] + side[0][0] + ox, pts[1] + side[0][1] + oy);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2] + side[i][0] + ox, pts[i * 2 + 1] + side[i][1] + oy);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(pts[i * 2] - side[i][0] + ox, pts[i * 2 + 1] - side[i][1] + oy);
    ctx.closePath();
  }

  /**
   * Chips knocked off walls and crates, under the same light as the blocks. On the block (clipped
   * to the blocks round it): a soft bloom of dust along the face, or soot where a rocket burst;
   * the flake, a shallow pale scar with a thin shadow under its rim on the side toward the light;
   * the pock in it, dark, its far rim catching the light; and the cracks. On the floor in front
   * of it, its crumbs. Each holds for its first second, then fades; a chip on a crate goes with
   * the crate.
   */
  function drawChips(s) {
    if (!chips.length) return;
    const live = chips.filter((m) => clock - m.t < m.life && (!m.crate || cellAt(s.grid, m.c, m.r) === CRATE));
    if (!live.length) return;
    const fade = (m) => Math.max(0, Math.min(1, (m.life - (clock - m.t)) / (m.life - 1)));
    const L = vecToWorld(Math.cos(LIGHT), Math.sin(LIGHT));
    const px = 1 / view.unit; // one CSS pixel, in cells
    const path = (pts, dx = 0, dy = 0) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx, pts[i + 1] + dy);
      ctx.closePath();
    };
    // A recess in a lit surface: its floor in light, less the part the rim toward the light
    // shades, a band d wide along that side.
    const recess = (pts, light, dark, d) => {
      ctx.save();
      path(pts);
      ctx.clip();
      ctx.fillStyle = dark;
      ctx.fill();
      path(pts, L.x * d, L.y * d);
      ctx.fillStyle = light;
      ctx.fill();
      ctx.restore();
    };
    // Crumbs on the floor, each over a faint shadow.
    for (const m of live) {
      const T = m.crate ? tones.crate : tones.wall;
      ctx.globalAlpha = fade(m);
      for (const [fill, d] of [['rgba(0, 0, 0, 0.3)', px], [T.fresh, 0]]) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (const b of m.bits) {
          const r = Math.max(b.r, px * 1.1);
          const ca = Math.cos(b.a) * r;
          const sa = Math.sin(b.a) * r;
          const x = b.x + L.x * d;
          const y = b.y + L.y * d;
          ctx.moveTo(x + ca, y + sa);
          ctx.lineTo(x - sa * 0.8, y + ca * 0.8);
          ctx.lineTo(x - ca, y - sa);
          ctx.lineTo(x + sa * 0.7, y - ca * 0.7);
          ctx.closePath();
        }
        ctx.fill();
      }
    }
    ctx.save();
    ctx.beginPath();
    const seen = new Set();
    for (const m of live) {
      for (let r = m.r - 1; r <= m.r + 1; r++) {
        for (let c = m.c - 1; c <= m.c + 1; c++) {
          const key = `${c},${r}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (blocksShell(cellAt(s.grid, c, r))) ctx.rect(c, r, 1, 1);
        }
      }
    }
    ctx.clip();
    for (const m of live) {
      const k = fade(m);
      const T = m.crate ? tones.crate : tones.wall;
      // Dust spread along the face, or soot.
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(Math.atan2(m.ny, m.nx));
      ctx.scale(0.55, 1);
      const r = (m.burn ? 0.32 : 0.26) * m.size;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, m.burn ? `rgba(0, 0, 0, ${0.55 * k})` : rgba(T.dust, 0.28 * k));
      g.addColorStop(1, m.burn ? 'rgba(0, 0, 0, 0)' : rgba(T.dust, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.restore();
      ctx.globalAlpha = k;
      recess(m.flake, m.burn ? shade(T.deep, 0.25) : T.fresh, T.deep, Math.max(0.018 * m.size, 0.9 * px));
      // The pock: dark, but for its far rim, so the light is laid first and the dark moved toward the light.
      ctx.save();
      path(m.pock);
      ctx.clip();
      ctx.fillStyle = T.rim;
      ctx.fill();
      const d = Math.max(0.016 * m.size, 0.9 * px);
      path(m.pock, -L.x * d, -L.y * d);
      ctx.fillStyle = T.pit;
      ctx.fill();
      ctx.restore();
      if (!m.lines.length) continue;
      ctx.beginPath();
      for (const line of m.lines) crack(line, Math.max(0.026 * m.size, 1.1 * px), 0, 0);
      ctx.fillStyle = T.deep;
      ctx.fill();
    }
    ctx.restore();
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

  /**
   * The map editor's rings round whole cells: 'error' (what stops a map being played),
   * 'note' (worth knowing) and 'cursor' (the cell under the mouse).
   */
  function drawCells(list) {
    const STYLE = { error: [pal.alarm, 1], note: [pal.aim, 0.85], cursor: [pal.aim, 0.45] };
    ctx.lineWidth = 0.08;
    for (const m of list) {
      const [color, alpha] = STYLE[m.kind] || STYLE.note;
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      roundRect(ctx, m.c + 0.06, m.r + 0.06, 0.88, 0.88, 0.18);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A flame tongue from (x, y) toward angle a, len long and about 2w across: a sub-path. */
  function tongue(c, x, y, a, len, w) {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const bx = x - ux * w * 0.4;
    const by = y - uy * w * 0.4;
    c.moveTo(bx, by);
    c.quadraticCurveTo(x + ux * len * 0.3 - uy * w * 1.5, y + uy * len * 0.3 + ux * w * 1.5, x + ux * len, y + uy * len);
    c.quadraticCurveTo(x + ux * len * 0.3 + uy * w * 1.5, y + uy * len * 0.3 - ux * w * 1.5, bx, by);
    c.closePath();
  }

  // Smoke underneath, then light on the floor and flashes, then flames and rings, then debris
  // and sparks on top.
  const LAYER = { smoke: 0, glow: 1, flash: 1, muzzle: 2, ring: 2 };
  const layerOf = (p) => LAYER[p.kind] ?? 3;

  /**
   * Lasers, straight on the arena: while one charges, a thin red line down the way it will fire,
   * brightening as it nears firing and blinking in its last third; then the beam, a red glow round
   * a white-hot core that flickers, with sparks where a wall stops it. Steady under reduced motion.
   */
  function drawBeams(s, calm) {
    for (const t of s.tanks) {
      const b = t.alive && t.beam;
      if (!b) continue;
      const L = beamLine(s.grid, t.x, t.y, b.angle);
      const line = (w, a, col) => {
        ctx.globalAlpha = a;
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(L.x0, L.y0);
        ctx.lineTo(L.x1, L.y1);
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = 'round';
      if (b.phase === 'charge') {
        const k = 1 - Math.max(0, b.left) / LASER_CHARGE;
        const blink = calm || k < 0.66 || Math.floor(clock * 16) % 2 === 0 ? 1 : 0.45;
        line(0.025 + 0.035 * k, (0.35 + 0.55 * k) * blink, pal.alarm);
      } else {
        const f = calm ? 1 : 0.85 + Math.random() * 0.15;
        ctx.globalCompositeOperation = 'lighter';
        line(0.34, 0.2 * f, pal.alarm);
        line(0.16, 0.5 * f, pal.alarm);
        line(0.06, 0.95, pal.flash);
        if (!calm && Math.random() < 0.6) sparks(L.x1, L.y1, b.angle + Math.PI, 1.4, 1, { speed: 3, life: 0.15, color: pal.flash });
      }
      ctx.restore();
    }
  }

  function drawFx() {
    for (let layer = 0; layer <= 3; layer++) drawFxLayer(layer);
    ctx.globalAlpha = 1;
  }

  function drawFxLayer(layer) {
    for (const p of fx) {
      if (layerOf(p) !== layer) continue;
      const k = Math.max(0, p.life / p.max);
      if (p.kind === 'glow') {
        glow(ctx, p.x, p.y, p.r, p.color, p.a * k);
      } else if (p.kind === 'muzzle') {
        // The flame out of the muzzle, white-hot at its root; a muzzle brake's also blows out of
        // its sides, and a plain barrel's flicks out two small side flames.
        const len = p.size * (0.8 + 0.4 * (1 - k));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = pal.fire;
        ctx.beginPath();
        tongue(ctx, 0, 0, 0, len, len * 0.2);
        if (p.brake) for (const side of [-1, 1]) tongue(ctx, -0.1, 0, side * (Math.PI / 2 + 0.2), len * 0.45, len * 0.11);
        else for (const side of [-1, 1]) tongue(ctx, 0, 0, side * 0.8, len * 0.38, len * 0.08);
        ctx.fill();
        ctx.fillStyle = pal.flash;
        ctx.beginPath();
        tongue(ctx, 0, 0, 0, len * 0.55, len * 0.12);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, len * 0.16, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'streak') {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(p.size, 1 / view.unit);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.kind === 'flash') {
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
        ctx.fillStyle = p.color || pal.smoke;
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
   * or null) marks where the player points, beacon (0-1) rings the player's tank, and cells
   * ([{ c, r, kind }]) rings cells for the map editor.
   */
  function draw(s, { aim = null, reticle = null, beacon = 0, cells = null } = {}) {
    if (!s || !view.w) return;
    if (!pal) readPalette();
    if (floorKey !== keyFor(s)) buildFloor(s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(floor, 0, 0);

    const calm = reduceMotion();
    const jitter = shake > 0 ? shake * 0.12 : 0;
    worldTransform(ctx, jitter ? (Math.random() - 0.5) * jitter : 0, jitter ? (Math.random() - 0.5) * jitter : 0);
    ctx.save();

    drawChips(s);
    drawMarks();
    // Where bombs will land, on the floor under everything else.
    for (const b of s.bombs) drawTarget(ctx, pal, b, { calm });
    const kindOf = (id) => s.tanks.find((t) => t.id === id)?.type || 'player';
    for (const m of s.mines) drawMine(ctx, pal, m, kindOf(m.owner), mineLight(m));

    const hidden = (t) => (TYPES[t.type].invisible ? Math.max(0, 1 - s.time / 1.2) : 1);
    // Shadows first, all at once, so no tank's shadow falls on another tank. PERFORMANCE: shadows
    // are drawn as shapes (art.js shadowsShaped), and tanks come from kept pictures (sprites),
    // painted only when a tank looks different.
    // How long since each tank fired, and which pod (for its recoil, its shadow's too).
    const fired = (t) => {
      const g = guns.get(t.id);
      return g ? s.time - g.fired : Infinity;
    };
    const side = (t) => guns.get(t.id)?.side || 0;
    drawShadows(ctx, pal, s.tanks.filter((t) => t.alive && hidden(t) > 0).map((t) => ({ t, alpha: hidden(t), fired: fired(t), side: side(t) })), { shaped: true });
    for (const t of s.tanks) {
      if (!t.alive) continue;
      const a = hidden(t);
      if (a <= 0) continue;
      const T = TYPES[t.type];
      const o = odometer.get(t.id);
      const g = guns.get(t.id);
      drawTank(ctx, pal, t, {
        phase: o ? o.total : 0,
        mines: T.mines - owned(s.mines, t),
        lit: T.weapon === 'missile' ? owned(s.bullets, t) > 0 : T.weapon === 'laser' && !!t.beam,
        roll: o ? o.roll : 0,
        // The gun's recoil, and a minigun's heat, which never outlasts its barrels' spin.
        fired: fired(t),
        side: side(t),
        heat: g && t.spin ? Math.min(g.heat, t.spin) : 0,
        alpha: a,
        sprites,
      });
    }

    drawBeams(s, calm);

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
    for (const b of s.bullets) {
      // Only a missile wears its owner's colour.
      const tone = b.weapon === 'missile' ? pal.tanks[kindOf(b.owner)] : null;
      drawShot(ctx, pal, b, { flame: calm ? 0.5 : Math.random(), blink, tone });
    }
    const up = vecToWorld(0, -1);
    for (const b of s.bombs) drawBomb(ctx, pal, b, { up });
    drawFx();
    if (reticle) drawReticle(reticle);
    if (cells) drawCells(cells);
    ctx.restore();
  }

  return { layout, toWorld, vecToWorld, vecToScreen, readPalette, palette, events, update, reset, draw };
}

