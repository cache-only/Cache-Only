// Tanks renderer: draws the world on a canvas and owns the purely visual extras (tread marks,
// scorch marks, crate splinters, chips knocked off walls, exhaust, recoil, explosions). It reads
// the world and never changes it.
// On a tall screen the whole arena is turned 90 degrees, so the player's side (the
// left of every map) sits at the bottom, next to the thumbs. The canvas covers the
// screen, and everything on it round the field is wall. The art itself (ground,
// tanks, shots, bombs) is in art.js, which the field guide draws with too.
import {
  ART,
  CRATE_BOX,
  LIGHT,
  TARGET,
  bombAt,
  bombLook,
  drawBomb,
  drawGround,
  drawMine,
  drawShadows,
  drawShot,
  drawTank,
  drawTarget,
  glow,
  lensAt,
  makePalette,
  makeSprites,
  roundRect,
  shade,
  wallCell,
} from './art.js';
import { createGL } from './gl.js';
import {
  BLAST_R,
  BOMB_R,
  COLS,
  CRATE,
  LASER_BEAM,
  LASER_CHARGE,
  MINE_FUSE,
  MUZZLE,
  ROWS,
  SHELL_R,
  SPIN_DOWN,
  TAU,
  FLOOR,
  TYPES,
  WALL,
  angleDiff,
  beamLine,
  blocksShell,
  cellAt,
  muzzleBlocked,
  nextContact,
  owned,
  tracePath,
} from './rules.js';

const RING = 2; // cells of wall kept round the field, on the sides that have the room
const SKIRT = 0.5; // cells of wall kept between the field and a screen edge it runs to
const MAX_DPR = 2; // the 2D renderer's: it paints too much to afford a 3x screen's every pixel
const MAX_DPR_GL = 3; // with WebGL (gl.js), the screen's own, up to an iPhone's 3x
const MARK_LIFE = 9; // seconds a tread mark takes to fade to what of it stays
const TRAIL_A = 0.16; // how dark a tread mark stays for good (fresh, --tk-track's strength)
const MAX_TRAILS = 30000; // marks kept to lay again on a new layout; older ones go then
const MAX_FX = 700;
const ROLL = 18; // radians per second a minigun's barrels turn at full speed (a quarter under reduced motion)
const CHIP_LIFE = 3; // seconds a chip knocked off a wall lasts (a minigun round's, half that); it fades over the last two
const MAX_CHIPS = 90;
const BURN_STEP = 0.05; // seconds of world time between a burning laser's marks where it meets a block
const EMBER_LIFE = 2.5; // seconds a laser's burn takes to cool once the beam has moved on
const SEAR_SPREAD = 0.15; // cells a laser's beam moves along a face for what it laid there to count about a third as much toward what it lays next
const LENS_COOL = 1.4; // seconds a laser's ruby rod takes to cool once its beam stops
const GATHER = 70; // sparks a second drawn in to a laser's rod as it charges, at full charge (a third of that as it starts)
const SPIT = 16; // sparks a second thrown off a laser's point while it burns
const MAX_DENTS = 1500; // dents kept to paint again where the floor is drawn again (a crate breaks); older ones stay until then
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

export function createRenderer(canvas, { reduceMotion = () => false, gl: useGL = true } = {}) {
  const ctx = canvas.getContext('2d');
  // Where WebGL2 works, the arena is drawn on a canvas of its own laid over this one (gl.js), which
  // lets every touch through to this one, and this one draws nothing. The floor is still built
  // here with a 2D context, off the screen, and laid by the GPU from a texture: on an iPhone a
  // big 2D canvas on the screen can show blurred (it did on opening, until the next layout), and
  // one picture on the screen is less to put together each frame (PERFORMANCE). Without WebGL2
  // this canvas draws it all, as it always did, the floor laid down on every frame from its own.
  let G = null;
  const glCanvas = useGL ? document.createElement('canvas') : null;
  if (glCanvas) {
    try {
      // A context lost while the game is paused (the app in the background) comes back with
      // nothing on it, and nothing else draws until play goes on: draw the last frame again.
      G = createGL(glCanvas, { onRestored: () => lastFrame && draw(lastFrame.s, lastFrame.opts) });
    } catch {
      G = null;
    }
    if (G) {
      glCanvas.className = 'arena-gl';
      glCanvas.setAttribute('aria-hidden', 'true');
      canvas.after(glCanvas);
    }
  }
  const floor = document.createElement('canvas');
  // Read back to be uploaded, so kept in memory rather than on the GPU.
  const fctx = floor.getContext('2d', G ? { willReadFrequently: true } : undefined);
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
  let built = null; // the grid the floor was last drawn for
  let lastFrame = null; // the world and options last drawn, to draw again after a lost GPU context
  let floorDirty = null; // what of the floor gl.js hasn't been given yet: 'all', or a box of device px
  let marks = [];
  let scorches = [];
  let rubble = []; // splinters where crates stood, on the floor for the rest of the mission
  let chips = []; // what shots knock off walls and crates: crumbs and dust, fading
  let dents = []; // the dents shots leave in walls and crates, which stay (in the floor canvas)
  let dentsAt = new Map(); // the same, by their block's "c,r"
  let trails = []; // every tread mark laid, for good: [x, y, angle]
  let cooling = []; // laser burns the beam has left, still glowing (embers)
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
    view.dpr = Math.min(G ? MAX_DPR_GL : MAX_DPR, window.devicePixelRatio || 1);
    const snap = (v) => Math.round(v * view.dpr) / view.dpr;
    view.x = snap(box.x + (box.w - u * (view.rot ? rows : cols)) / 2);
    view.y = snap(view.rot ? box.y + RING * u : box.y + (box.h - u * rows) / 2);
    floor.width = Math.round(view.w * view.dpr);
    floor.height = Math.round(view.h * view.dpr);
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    if (G) {
      // Only touches land on the arena's own canvas now: one clear pixel, stretched.
      canvas.width = canvas.height = 1;
      G.resize(floor.width, floor.height);
      glCanvas.style.width = canvas.style.width;
      glCanvas.style.height = canvas.style.height;
      floorDirty = 'all';
      dropPictures();
    } else {
      canvas.width = floor.width;
      canvas.height = floor.height;
    }
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
    // A destroyed tank's X (drawX), torn into the floor: the ash round it and the chips off its
    // rims, its far walls lit, its charred bottom and the grit in it, from the floor's own tone;
    // its shadows the soot of a laser's burn.
    const F = pal.floor;
    tones.floor = { ash: shade(F, 0.42), chip: shade(F, 0.52), lit: shade(F, 0.36), char: shade(F, -0.45), grit: shade(F, 0.18), pit: '#0a0806' };
    page = cs.getPropertyValue('--bg').trim() || '#0b0b0b'; // what the screen's edges shade to
    floorKey = rimKey = '';
  }

  /** The palette the art is drawn with, for badges outside the arena. */
  function palette() {
    if (!pal) readPalette();
    return pal;
  }

  /* ---------- Static layer: floor, blocks, scorch marks ---------- */

  /** A scorch mark on the floor: a blast's burn (blastBurn), or the X a destroyed tank leaves on its burn (drawX). */
  function drawScorch(c, m, s) {
    if (m.kind === 'blast') blastBurn(c, m, s);
    else drawX(c, m, s);
  }

  /**
   * The X a destroyed tank leaves on its burn: two gouges torn across the floor, crossed, with
   * round ends, drawn so it reads on the burn's black. Ash blown out of them lies round them in
   * soft smudges and a ragged rim, broken here and there. Across each gouge the near wall is in
   * shadow, the bottom is charred, crazed into small plates with grit lying in it, and the far wall
   * is lit by the arena's light (LIGHT) as much as it faces it. Pale chips are spalled off the
   * rims, the heat has browned the floor along them, a hairline crack or two runs off near the ends
   * and flecks of ash lie round, all on floor cells only (it never reaches a cell past the one
   * round its own). Its shape comes from its seed, so it looks the same each time the floor is
   * drawn again.
   */
  function drawX(c, m, s) {
    const rand = seeded(m.seed);
    const rnd = (a, b) => a + rand() * (b - a);
    const T = tones.floor;
    const L = vecToWorld(Math.cos(LIGHT), Math.sin(LIGHT)); // the way the light falls
    const px = 1 / (view.unit * view.dpr); // one device pixel, in cells
    const W = 0.082; // a gouge's half width
    const S = 64; // points round its outline
    const poly = (pts, dx = 0, dy = 0) => {
      c.moveTo(pts[0][0] + dx, pts[0][1] + dy);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] + dx, pts[i][1] + dy);
      c.closePath();
    };
    const dot = (x, y, r) => {
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, TAU);
    };
    const smudge = (x, y, r, col, a) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    };
    // A smooth wobble, -1 to 1, round a loop of n knots.
    const wobble = (n) => {
      const k = Array.from({ length: n }, () => rnd(-1, 1));
      return (p) => {
        const q = p * n;
        const i = Math.floor(q);
        const f = (1 - Math.cos(Math.PI * (q - i))) / 2;
        return k[i % n] * (1 - f) + k[(i + 1) % n] * f;
      };
    };
    const gouges = [1, -1].map((turn) => {
      const a = m.a + (turn * Math.PI) / 4;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const h0 = 0.5 * rnd(0.93, 1.02); // from the middle to each end's round
      const h1 = 0.5 * rnd(0.93, 1.02);
      const [rough, fine, ash] = [wobble(13), wobble(37), wobble(9)];
      // Once round its outline: back along one side, round one end, out along the other side and
      // round the other end. Each point has its outward normal, the gouge's half width there,
      // rough, and how wide the ash lies on the rim there (none in places).
      const len = h0 + h1;
      const per = 2 * len + TAU * W;
      const outline = [];
      for (let i = 0; i < S; i++) {
        let d = (i / S) * per;
        let t; // along the gouge, from the middle
        let q; // the outward normal's angle from the gouge's
        if (d < len) [t, q] = [h1 - d, Math.PI / 2];
        else if ((d -= len) < Math.PI * W) [t, q] = [-h0, Math.PI / 2 + d / W];
        else if ((d -= Math.PI * W) < len) [t, q] = [d - h0, -Math.PI / 2];
        else [t, q] = [h1, -Math.PI / 2 + (d - len) / W];
        const p = i / S;
        outline.push({
          x: m.x + ux * t,
          y: m.y + uy * t,
          nx: Math.cos(a + q),
          ny: Math.sin(a + q),
          w: W * (1 + 0.12 * rough(p) + 0.05 * fine(p)),
          rim: 0.04 * Math.max(0, 0.2 + ash(p)) ** 0.8,
        });
      }
      const ring = (out) => outline.map((o) => [o.x + o.nx * (o.w + out(o)), o.y + o.ny * (o.w + out(o))]);
      // A point t along the gouge from the middle and v across it.
      const at = (t, v) => [m.x + ux * t - uy * v, m.y + uy * t + ux * v];
      return { ux, uy, h0, h1, outline, at, core: ring(() => 0), fringe: ring((o) => o.rim) };
    });
    const cores = (dx = 0, dy = 0) => {
      c.beginPath();
      for (const g of gouges) poly(g.core, dx, dy);
    };
    c.save();
    c.beginPath();
    for (let r = Math.floor(m.y) - 1; r <= Math.floor(m.y) + 1; r++) {
      for (let col = Math.floor(m.x) - 1; col <= Math.floor(m.x) + 1; col++) if (cellAt(s.grid, col, r) === FLOOR) c.rect(col, r, 1, 1);
    }
    c.clip();
    // The ash blown out of the gouges: soft smudges round them, then their ragged rims.
    for (let k = 0; k < 10; k++) {
      const o = gouges[k % 2].outline[Math.floor(rand() * S)];
      const out = o.w + rnd(0.02, 0.07);
      smudge(o.x + o.nx * out, o.y + o.ny * out, rnd(0.06, 0.12), T.ash, 0.14);
    }
    c.globalAlpha = 0.75;
    c.fillStyle = T.ash;
    c.beginPath();
    for (const g of gouges) poly(g.fringe);
    c.fill();
    c.globalAlpha = 1;
    // Inside the gouges, lit; then in shadow where the gouges are, moved toward the light, which
    // leaves the far walls lit; then, within that, charred where they are moved away from it,
    // which leaves the near walls in shadow.
    const LIT = 0.034; // how wide a far wall shows, where it faces the light
    const SHADE = 0.03; // and a near wall
    c.save();
    cores();
    c.clip();
    c.fillStyle = T.lit;
    c.fillRect(m.x - 1, m.y - 1, 2, 2);
    c.fillStyle = T.pit;
    cores(-L.x * LIT, -L.y * LIT);
    c.fill();
    c.clip();
    c.fillStyle = T.char;
    cores(L.x * SHADE, L.y * SHADE);
    c.fill();
    // The char crazed into small plates: a crack wandering down the middle of each gouge and short
    // ones off it to either side; and grit lying on it.
    c.strokeStyle = T.pit;
    c.lineWidth = Math.max(0.006, 1.2 * px);
    c.lineJoin = 'round';
    c.beginPath();
    for (const g of gouges) {
      let t = -g.h0 - W;
      c.moveTo(...g.at(t, rnd(-0.3, 0.3) * W));
      while (t < g.h1 + W) {
        t += rnd(0.035, 0.06);
        c.lineTo(...g.at(t, rnd(-0.35, 0.35) * W));
      }
      for (t = -g.h0 - W / 2 + rnd(0, 0.04); t < g.h1 + W / 2; t += rnd(0.045, 0.075)) {
        const side = rand() < 0.5 ? 1 : -1;
        c.moveTo(...g.at(t, 0));
        c.lineTo(...g.at(t + rnd(-0.02, 0.02), side * W * 0.6));
        c.lineTo(...g.at(t + rnd(-0.03, 0.03), side * W * 1.3));
      }
    }
    c.stroke();
    c.fillStyle = T.grit;
    c.beginPath();
    for (const g of gouges) for (let k = 0; k < 5; k++) dot(...g.at(rnd(-g.h0, g.h1), rnd(-0.5, 0.5) * W), rnd(0.008, 0.016));
    c.fill();
    c.restore();
    // The heat's brown along the gouges (a laser's burn browns a block the same).
    for (const g of gouges) {
      for (let k = -1; k <= 1; k++) smudge(...g.at(k * rnd(0.22, 0.3) + rnd(-0.04, 0.04), 0), rnd(0.12, 0.2), '#582c10', 0.1);
    }
    // Chips spalled off the rims, pale where the floor broke away.
    c.globalAlpha = 0.9;
    c.fillStyle = T.chip;
    c.beginPath();
    for (const g of gouges) {
      for (let k = 3 + Math.floor(rand() * 3); k > 0; k--) {
        const o = g.outline[Math.floor(rand() * S)];
        const size = rnd(0.014, 0.03);
        const x = o.x + o.nx * (o.w + size * 0.3);
        const y = o.y + o.ny * (o.w + size * 0.3);
        const turn = rnd(0, TAU);
        const sides = 4 + Math.floor(rand() * 2);
        const pts = [];
        for (let j = 0; j < sides; j++) {
          const q = turn + (j / sides) * TAU + rnd(-0.3, 0.3);
          const r = size * rnd(0.6, 1.1);
          pts.push([x + Math.cos(q) * r, y + Math.sin(q) * r]);
        }
        poly(pts);
      }
    }
    c.fill();
    c.globalAlpha = 1;
    // A hairline crack or two off the sides near the ends, slanting away from the middle.
    c.fillStyle = T.pit;
    c.beginPath();
    for (const g of gouges) {
      for (const end of [-1, 1]) {
        if (rand() < 0.65) continue;
        const side = rand() < 0.5 ? 1 : -1;
        const [x, y] = g.at(end * (end > 0 ? g.h1 : g.h0) * rnd(0.55, 0.85), side * (W + 0.006));
        const a = Math.atan2(g.ux * side, -g.uy * side) - end * side * rnd(0.2, 0.7);
        const l = rnd(0.05, 0.09);
        const b = a + rnd(-0.5, 0.5);
        const mx = x + Math.cos(a) * l * 0.55;
        const my = y + Math.sin(a) * l * 0.55;
        crack(c, [x, y, mx, my, mx + Math.cos(b) * l * 0.45, my + Math.sin(b) * l * 0.45], Math.max(0.013, 1.3 * px), 0, 0);
      }
    }
    c.fill();
    // Flecks of ash round it.
    c.globalAlpha = 0.55;
    c.fillStyle = T.ash;
    c.beginPath();
    for (let k = 0; k < 18; k++) {
      const q = rnd(0, TAU);
      const d = rnd(0.16, 0.75);
      dot(m.x + Math.cos(q) * d, m.y + Math.sin(q) * d, rnd(0.006, 0.015));
    }
    c.fill();
    c.restore();
  }

  /**
   * A blast's burn on the floor round (x, y), radius r, a mine's, a bomb's or a tank's blowing up
   * (blastMarks), on floor cells only (walls take its shrapnel's scars, addDent): scattered, not
   * drawn. An uneven scorch at its heart, laid as a few soft blots one over another; round it a
   * spray of soot, specks and small blotches thrown out
   * from it, thinning with distance, some streaked the way they flew; and fine grit. Its shape
   * comes from its seed, so it looks the same each time the floor is drawn again.
   */
  function blastBurn(c, m, s) {
    const rand = seeded(m.seed);
    const R = m.r;
    c.save();
    c.beginPath();
    for (let r = Math.floor(m.y - R - 1); r <= Math.floor(m.y + R + 1); r++) {
      for (let col = Math.floor(m.x - R - 1); col <= Math.floor(m.x + R + 1); col++) if (cellAt(s.grid, col, r) === FLOOR) c.rect(col, r, 1, 1);
    }
    c.clip();
    const blot = (x, y, r, a) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0, 0, 0, ${a})`);
      g.addColorStop(0.55, `rgba(0, 0, 0, ${a * 0.6})`);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    };
    // The heart: soft blots off the middle, so no circle shows.
    for (let i = 0; i < 6; i++) {
      const a = rand() * TAU;
      const d = R * 0.16 * rand();
      blot(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, R * (0.3 + 0.22 * rand()), 0.16 + 0.1 * rand());
    }
    // The spray: most near the heart, fewer the farther out; the farther, the smaller and the
    // more streaked along the way it flew.
    const n = Math.round(70 * R);
    c.fillStyle = 'rgba(0, 0, 0, 0.3)';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU;
      const t = Math.sqrt(rand());
      const d = R * (0.2 + 0.85 * t);
      const x = m.x + Math.cos(a) * d;
      const y = m.y + Math.sin(a) * d;
      const r = (0.012 + 0.05 * rand() * (1 - t * 0.7)) * Math.min(1.4, R);
      const len = r * (1 + 2.5 * t * rand());
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // A speck, stretched out along its flight.
      c.moveTo(x + ux * len, y + uy * len);
      c.quadraticCurveTo(x - uy * r, y + ux * r, x - ux * len * 0.6, y - uy * len * 0.6);
      c.quadraticCurveTo(x + uy * r, y - ux * r, x + ux * len, y + uy * len);
      c.closePath();
    }
    c.fill();
    // Fine grit thrown out past the spray.
    c.fillStyle = 'rgba(0, 0, 0, 0.35)';
    c.beginPath();
    for (let i = 0; i < Math.round(30 * R); i++) {
      const a = rand() * TAU;
      const d = R * (0.4 + 0.75 * rand());
      const r = 0.008 + 0.014 * rand();
      c.moveTo(m.x + Math.cos(a) * d + r, m.y + Math.sin(a) * d);
      c.arc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, r, 0, TAU);
    }
    c.fill();
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
    // crate blown away or a stroke in the editor only draws again the cells that changed and the
    // cell round them, whose edges and shadows reach in (PERFORMANCE: a crate, not the field;
    // with the cells three deep round those drawn, whose shadows reach them).
    const whole = rimKey !== rimFor();
    let area = [-RING, -RING, view.cols + RING * 2, view.rows + RING * 2];
    let clip = [-1, -1, view.cols + 2, view.rows + 2];
    if (!whole && built && built.length === s.grid.length) {
      const box = changed(built, s.grid, view.cols);
      if (!box) {
        floorKey = keyFor(s);
        return;
      }
      clip = [box.c0 - 1, box.r0 - 1, box.c1 - box.c0 + 3, box.r1 - box.r0 + 3];
      area = [box.c0 - 3, box.r0 - 3, box.c1 - box.c0 + 7, box.r1 - box.r0 + 7];
    }
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
      c.rect(...clip);
      c.clip();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = pal.frame;
    c.fillRect(0, 0, floor.width, floor.height);
    worldTransform(c);
    // The light is the screen's (art.js LIGHT), so it stays at the top left however the arena turns.
    drawGround(c, pal, { cols: view.cols, rows: view.rows, kindAt: (col, row) => cellAt(s.grid, col, row), area });
    if (!whole) {
      // Scorch marks, splinters and dents inside what was drawn again: only there, or the rest would darken each time.
      worldTransform(c);
      // PERFORMANCE: only the marks that reach it (a burn lies on its floor cells up to a cell past
      // its radius, an X within a cell of its middle), as every blast and every tank destroyed
      // leaves a burn.
      const [x0, y0, w, h] = clip;
      for (const m of scorches) {
        const d = (m.r || 0) + 2;
        if (m.x + d > x0 && m.x - d < x0 + w && m.y + d > y0 && m.y - d < y0 + h) drawScorch(c, m, s);
      }
      if (!G) stampTrails(c, trails);
      drawRubble(c, rubble);
      stampDents(c, s, clip[0] - 1, clip[1] - 1, clip[0] + clip[2], clip[1] + clip[3]);
    }
    c.restore();
    if (whole) {
      // PERFORMANCE: the blurred screen edges, baked in here once instead of blurred by CSS every frame.
      blurEdges();
      worldTransform(c);
      for (const m of scorches) drawScorch(c, m, s);
      if (!G) stampTrails(c, trails);
      drawRubble(c, rubble);
      stampDents(c, s);
    }
    built = s.grid.slice();
    rimKey = rimFor();
    floorKey = keyFor(s);
    if (whole) floorDirty = 'all';
    else floorChanged(...clip);
  }

  /** Notes that cells x..x+w, y..y+h of the floor were drawn again, for gl.js (which is given them before the next frame). */
  function floorChanged(x, y, w, h) {
    if (!G || floorDirty === 'all') return;
    const M = worldMatrix();
    const xs = [x, x + w].flatMap((cx) => [y, y + h].map((cy) => M.a * cx + M.c * cy + M.e));
    const ys = [x, x + w].flatMap((cx) => [y, y + h].map((cy) => M.b * cx + M.d * cy + M.f));
    const box = {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - 2),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - 2),
      x1: Math.min(floor.width, Math.ceil(Math.max(...xs)) + 2),
      y1: Math.min(floor.height, Math.ceil(Math.max(...ys)) + 2),
    };
    if (box.x1 <= box.x0 || box.y1 <= box.y0) return;
    if (!floorDirty) floorDirty = box;
    else {
      floorDirty.x0 = Math.min(floorDirty.x0, box.x0);
      floorDirty.y0 = Math.min(floorDirty.y0, box.y0);
      floorDirty.x1 = Math.max(floorDirty.x1, box.x1);
      floorDirty.y1 = Math.max(floorDirty.y1, box.y1);
    }
  }

  /** The cells that differ between grids a and b (cols across), as a box { c0, r0, c1, r1 }, or null. */
  function changed(a, b, cols) {
    let box = null;
    for (let i = 0; i < b.length; i++) {
      if (a[i] === b[i]) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      if (!box) box = { c0: c, r0: r, c1: c, r1: r };
      else {
        box.c0 = Math.min(box.c0, c);
        box.c1 = Math.max(box.c1, c);
        box.r0 = Math.min(box.r0, r);
        box.r1 = Math.max(box.r1, r);
      }
    }
    return box;
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
    chip(s, x, y, nx, ny, { size: round ? 0.6 : end ? 1.25 : 1, life: round ? CHIP_LIFE / 2 : CHIP_LIFE, cracks: round ? 0 : end ? 5 : 3, crumbs: round ? 1 : end ? 4 : 3, burn, vx: e.vx || 0, vy: e.vy || 0 });
  }

  /**
   * A shot's mark on the block at (x, y), on the face whose normal is (nx, ny), the shot going
   * (vx, vy) as it leaves: a dent that stays (addDent), and what it knocks off, which fades: a few
   * crumbs on the floor in front of the face and a bloom of dust along it (soot, where a rocket
   * burst). A shell's edge can meet a block beside the row (or column) its centre is in, so it
   * goes on the nearest block.
   */
  function chip(s, x, y, nx, ny, { size, life, cracks, crumbs, burn, vx = 0, vy = 0 }) {
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
    const crate = cellAt(s.grid, best.c, best.r) === CRATE;
    // On the face, within the block it hit: a crate's own box, or anywhere along a wall but for a
    // little short of an end where the wall stops (not at a joint it runs on past).
    const open = (dc, dr) => crate || cellAt(s.grid, best.c + dc, best.r + dr) !== WALL;
    const lo = (dc, dr) => (open(dc, dr) ? 0.08 : 0);
    const cx = Math.max(best.c + lo(-1, 0), Math.min(best.c + 1 - lo(1, 0), px)) + nx * 0.04;
    const cy = Math.max(best.r + lo(0, -1), Math.min(best.r + 1 - lo(0, 1), py)) + ny * 0.04;
    // u: along the face; v: into the block.
    const at = (u, v) => [cx - ny * u - nx * v, cy + nx * u - ny * v];
    const rnd = (a, b) => a + Math.random() * (b - a);
    // Crumbs knocked out onto the floor in front of the face.
    const bits = [];
    for (let k = 0; k < crumbs; k++) {
      const [bx, by] = at(rnd(-0.22, 0.22), -rnd(0.08, 0.32));
      bits.push({ x: bx, y: by, a: rnd(0, Math.PI), r: rnd(0.022, 0.036) * Math.max(1, size) });
    }
    chips.push({ x: cx, y: cy, nx, ny, c: best.c, r: best.r, crate, t: clock, life, size, burn, bits });
    if (chips.length > MAX_CHIPS) dropPicture(chips.shift());
    // A glancing hit scars the face along the way the shot went; a square one (or a corner) pocks it.
    const speed = Math.hypot(vx, vy);
    const square = speed ? Math.abs(vx * nx + vy * ny) / speed : 1;
    const corner = Math.abs(nx) > 0.1 && Math.abs(ny) > 0.1;
    const scrape = !corner && square < 0.5 ? { dir: Math.sign(nx * vy - ny * vx) || 1, len: 0.18 + 0.2 * (1 - square / 0.5) } : null;
    addDent(s, best.c, best.r, cx, cy, nx, ny, { size, cracks, burn, scrape });
  }

  /**
   * Leaves a dent where a shot (or a blast's shrapnel) met block (c, r) at (x, y), on the face whose
   * normal is (nx, ny), and paints it into the floor, where it stays (PERFORMANCE: it costs nothing
   * a frame). A square hit pocks the face; a glancing one (scrape: { dir along the face, len }) scars
   * it lengthwise. A hit beside a dent already on that face roughens that dent instead (it grows
   * a third at most: blocks never wear away, this is only paint), so a spot under fire is one
   * rough scar, not a row of dots. inset: how far in from the face it
   * sits (shrapnel's need not all sit on the edge). cracks: 0 for a small pit.
   */
  function addDent(s, c, r, x, y, nx, ny, { size, cracks = 3, burn = false, scrape = null, inset = 0, merge = true, soot = false, streak = null }) {
    const key = `${c},${r}`;
    const here = dentsAt.get(key) || [];
    let near = null;
    let gap = Infinity;
    if (soot || streak) merge = false;
    // Dents on this face of this block and of the blocks either side along it.
    const beside = [here, dentsAt.get(`${c - ny},${r + nx}`) || [], dentsAt.get(`${c + ny},${r - nx}`) || []];
    for (const m of merge ? beside.flat() : []) {
      if (Math.sign(m.nx) !== Math.sign(nx) || Math.sign(m.ny) !== Math.sign(ny)) continue;
      if (m.kind === 'soot' || m.kind === 'burn' || m.kind === 'sear') continue;
      const d = Math.hypot(m.x - x, m.y - y);
      const reach = m.kind === 'scrape' ? Math.max(0.12, m.len * m.size * 0.6) : 0.12 * Math.max(m.size, size);
      if (d < reach && d < gap) {
        near = m;
        gap = d;
      }
    }
    let m = near;
    if (m) {
      // It stays where it first struck, so the bigger shape (the same seed, scaled up) covers the one it grew from.
      m.hits++;
      m.size = Math.min(m.cap, m.size + size * 0.1);
      m.cracks = Math.min(4, m.cracks + 1);
      m.burn ||= burn;
      if (m.kind === 'scrape') m.len = Math.min(0.55, m.len + (scrape ? scrape.len : 0.1) * 0.25);
      dentShapes(m);
    } else {
      m = { c, r, x: x - nx * inset, y: y - ny * inset, nx, ny, crate: cellAt(s.grid, c, r) === CRATE, size, cap: size * 1.35, cracks, burn, hits: 1, seed: (Math.random() * 2 ** 31) | 0, kind: soot ? 'soot' : streak ? 'streak' : scrape ? 'scrape' : 'pock', dir: scrape ? scrape.dir : 1, len: scrape ? scrape.len : streak ? streak.len : 0, angle: streak ? streak.angle : 0 };
      dentShapes(m);
      keepDent(m);
    }
    if (floorKey === keyFor(s)) {
      stampDent(fctx, s, m);
      floorChanged(c - 1, r - 1, 3, 3);
    }
  }

  /** Keeps dent m to paint again where the floor is drawn again, the oldest let go past MAX_DENTS. */
  function keepDent(m) {
    const key = `${m.c},${m.r}`;
    dents.push(m);
    dentsAt.set(key, [...(dentsAt.get(key) || []), m]);
    if (dents.length > MAX_DENTS) {
      const old = dents.shift();
      const list = dentsAt.get(`${old.c},${old.r}`);
      if (list) list.splice(list.indexOf(old), 1);
    }
  }

  /** 0-1 numbers from a seed (mulberry32), so a dent worked out again, bigger, keeps its own shape. */
  function seeded(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Works out dent m's shapes from its kind, size and seed. A wall's pock: a pale flake spalled off
   * its edge, a pock in it where the shot struck, a short fan of cracks into it. A wall's scrape: a
   * long shallow scar just inside the face, thinning at both ends, its inner edge ragged, with a
   * crack or two off its deep end. A crate's: a notch pressed into its frame with its paint
   * scuffed either side, or a gouge along it. Shapes are ovals on the face line, so only their
   * inner half shows on the block; a dent struck again comes out rougher.
   */
  function dentShapes(m) {
    const rand = seeded(m.seed);
    const rnd = (a, b) => a + rand() * (b - a);
    const { x: cx, y: cy, nx, ny, size } = m;
    const at = (u, v) => [cx - ny * u - nx * v, cy + nx * u - ny * v];
    const rough = Math.min(1, (m.hits - 1) * 0.3);
    const oval = (n, along, into, jag) => {
      const pts = [];
      for (let k = 0; k < n; k++) {
        const t = ((k + rnd(-0.25, 0.25)) / n) * TAU;
        const g = (k % 2 ? 1 - jag : 1) * rnd(0.85, 1.12);
        pts.push(...at(Math.cos(t) * along * size * g, Math.sin(t) * into * size * g));
      }
      return pts;
    };
    const crack = (u, v, into, len) => {
      const [sx, sy] = at(u, v);
      const bend = into + rnd(-0.4, 0.4);
      const mx = sx + Math.cos(into) * len * 0.55;
      const my = sy + Math.sin(into) * len * 0.55;
      return [sx, sy, mx, my, mx + Math.cos(bend) * len * 0.45, my + Math.sin(bend) * len * 0.45];
    };
    const inward = Math.atan2(-ny, -nx);
    m.lines = [];
    if (m.kind === 'soot') return; // a stain, no shape
    if (m.kind === 'streak') {
      // A fragment's score across the top: from where it struck, on the way it flew, a slight kink.
      const ux = Math.cos(m.angle);
      const uy = Math.sin(m.angle);
      const len = m.len * size;
      const bend = rnd(-0.25, 0.25);
      const mx = cx + ux * len * 0.55;
      const my = cy + uy * len * 0.55;
      m.lines = [[cx, cy, mx, my, mx + Math.cos(m.angle + bend) * len * 0.45, my + Math.sin(m.angle + bend) * len * 0.45]];
      return;
    }
    if (m.kind === 'burn') {
      // A laser's, along the stretch of the face it burned (a spot, where the beam was held): char
      // with a ragged edge, pits in it and a hairline crack or two. (Its soot was laid round it as
      // it burned: sear.)
      const us = m.path.map(([x, y]) => (x - cx) * -ny + (y - cy) * nx);
      const u0 = Math.min(...us);
      const u1 = Math.max(...us);
      const len = u1 - u0;
      const spot = len < 0.03;
      m.pits = [];
      // A hairline from (x, y) heading a, l long, kinked, sometimes forked.
      const hairline = (x, y, a, l) => {
        const b = a + rnd(-0.5, 0.5);
        const mx = x + Math.cos(a) * l * 0.5;
        const my = y + Math.sin(a) * l * 0.5;
        m.lines.push([x, y, mx, my, mx + Math.cos(b) * l * 0.5, my + Math.sin(b) * l * 0.5]);
        if (rand() < 0.5) {
          const f = b + (rand() < 0.5 ? -1 : 1) * rnd(0.5, 0.9);
          m.lines.push([mx, my, mx + Math.cos(f) * l * 0.2, my + Math.sin(f) * l * 0.2, mx + Math.cos(f) * l * 0.38, my + Math.sin(f) * l * 0.38]);
        }
      };
      if (spot) {
        // Round the spot: a angle off straight into the block, d out from it.
        const um = (u0 + u1) / 2;
        const rim = (a, d) => at(um + Math.sin(a) * d, Math.cos(a) * d);
        m.char = [];
        for (let k = 0; k < 18; k++) m.char.push(...rim(((k + rnd(-0.3, 0.3)) / 18) * TAU, (k % 2 ? rnd(0.8, 0.95) : rnd(0.95, 1.12)) * 0.12 * size));
        for (let k = 0; k < 5; k++) m.pits.push([...rim(rnd(-1.4, 1.4), rnd(0.03, 0.1) * size), rnd(0.012, 0.024) * size]);
        for (let k = 0; k < 2 + Math.floor(rand() * 2); k++) {
          const a = rnd(-1.1, 1.1);
          const [x, y] = rim(a, 0.08 * size);
          hairline(x, y, inward + a + rnd(-0.3, 0.3), rnd(0.08, 0.16) * size);
        }
        return;
      }
      // How badly each part of the stretch burned, 0 to 1, wandering along it.
      const knots = Array.from({ length: Math.ceil(len / 0.16) + 2 }, () => rand());
      const heat = (u) => {
        const t = Math.max(0, (u - u0) / 0.16);
        const i = Math.min(knots.length - 2, Math.floor(t));
        const f = (1 - Math.cos(Math.PI * Math.min(1, t - i))) / 2;
        return knots[i] * (1 - f) + knots[i + 1] * f;
      };
      // Its char: from beyond the face (clipped; the face is 0.04 out from the path) to a ragged
      // edge in the block, thick where it burned worst, thin between, tapering at both ends.
      const deep = (u) => -0.04 + (0.045 + 0.065 * heat(u)) * size;
      const steps = Math.max(4, Math.ceil((len + 0.08) / 0.02));
      const top = [];
      const edge = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = u0 - 0.04 + t * (len + 0.08);
        top.push(at(u, -0.08));
        edge.push(at(u, -0.04 + (deep(u) + 0.04 + rnd(-0.008, 0.008) * size) * Math.sin(Math.PI * t) ** 0.35));
      }
      m.char = [...top.flat(), ...edge.reverse().flat()];
      // n things spread along the stretch.
      const along = (n, fn) => {
        for (let i = 0; i < n; i++) fn(u0 + ((i + rnd(0.15, 0.85)) / n) * len);
      };
      along(Math.ceil(len / 0.05), (u) => rand() < heat(u) && m.pits.push([...at(u, deep(u) + rnd(-0.01, 0.006) * size), rnd(0.012, 0.022) * size]));
      along(Math.max(1, Math.round(len / 0.9)), (u) => {
        const [x, y] = at(u, deep(u) - 0.01 * size);
        hairline(x, y, inward + rnd(-0.8, 0.8), rnd(0.05, 0.11) * size);
      });
      return;
    }
    if (m.kind === 'scrape') {
      // From a little behind where it struck to len ahead, just inside the face (a wall's face is
      // 0.04 out from the dent's middle, a crate's on it).
      const len = m.len * size;
      const edge = (m.crate ? 0 : -0.04) + 0.004;
      const w = (m.crate ? rnd(0.025, 0.035) : rnd(0.045, 0.065)) * size * (1 + rough * 0.3);
      const n = 12;
      const top = [];
      const deep = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = m.dir * (t - 0.2) * len;
        top.push(at(u, edge));
        deep.push(at(u, edge + w * Math.sin(Math.PI * (0.06 + 0.88 * t)) ** 0.7 * rnd(0.6, 1.15)));
      }
      m.shape = [...top.flat(), ...deep.reverse().flat()];
      if (!m.crate) for (let k = 0; k < Math.min(2, m.cracks >> 1); k++) m.lines.push(crack(m.dir * len * rnd(0.55, 0.8), edge + w * 0.6, inward + rnd(-0.5, 0.5), rnd(0.05, 0.1) * size));
      return;
    }
    if (m.crate) {
      // A nick in its frame, not a chunk out of it: crates come apart only to a blast.
      m.shape = oval(16, 0.13, 0.055, 0.08 + rough * 0.1);
      // Scuffs: short pale scratches along the face from the notch's rim, out to either side.
      m.scuffs = [];
      const n = m.cracks ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? -1 : 1;
        const u0 = side * rnd(0.07, 0.11) * size;
        const v0 = rnd(0.05, 0.08) * size;
        const len = rnd(0.04, 0.08) * size;
        const tilt = rnd(-0.3, 0.3);
        const [sx, sy] = at(u0, v0);
        const [mx, my] = at(u0 + side * len * 0.5, v0 + len * Math.sin(tilt) * 0.25);
        const [ex, ey] = at(u0 + side * len, v0 + len * Math.sin(tilt) * 0.5);
        m.scuffs.push([sx, sy, mx, my, ex, ey]);
      }
      return;
    }
    m.shape = oval(14, 0.14, 0.1, 0.22 + rough * 0.1);
    m.pock = oval(8, 0.06, 0.05, 0.08 + rough * 0.06);
    // Cracks fan out from the pock's rim into the block: short, nearly straight, each with a kink.
    for (let k = 0; k < m.cracks; k++) {
      const a = (m.cracks > 1 ? (k / (m.cracks - 1) - 0.5) * 2.3 : 0) + rnd(-0.2, 0.2);
      const len = rnd(0.07, 0.15) * size * (1 - Math.abs(a) * 0.2);
      m.lines.push(crack(Math.sin(a) * 0.05 * size, Math.cos(a) * 0.04 * size, inward + a, len));
    }
  }

  /**
   * Where tank t's laser beam b meets a wall or crate, on gun g: the spot joins the burn going on
   * there (g.run: its points, each with when the beam was last on it), a new one when the beam has
   * moved to another face or jumped. While the beam holds still the same point stays hot, and the
   * burn grows with how long it was held. At each step it lays soot round the spot (sear), as much
   * as how long it has stayed about here (run.dwell, seconds, which fades as the beam moves on).
   */
  function laserBurn(s, b, t, g) {
    const ux = Math.cos(b.angle);
    const uy = Math.sin(b.angle);
    const L = beamLine(s.grid, t.x, t.y, b.angle);
    const hit = nextContact(s.grid, L.x0, L.y0, ux, uy, 0.02, 64);
    const c = Math.floor(L.x1 + ux * 0.03);
    const r = Math.floor(L.y1 + uy * 0.03);
    if (!hit || !blocksShell(cellAt(s.grid, c, r))) {
      endBurn(s, g);
      return;
    }
    // The face it met: across the beam's larger part, at a corner.
    const across = hit.x && (!hit.y || Math.abs(ux) >= Math.abs(uy));
    const nx = across ? -Math.sign(ux) : 0;
    const ny = across ? 0 : -Math.sign(uy);
    // On the face as a shot's chip sits on it (chip): a wall's 0.04 in, a crate's box edge.
    const x = L.x1 - nx * 0.04;
    const y = L.y1 - ny * 0.04;
    let run = g.run;
    const last = run && run.pts[run.pts.length - 1];
    const onward = last && run.nx === nx && run.ny === ny && Math.abs(nx ? last[0] - x : last[1] - y) < 0.01 && Math.hypot(last[0] - x, last[1] - y) < 0.8;
    if (!onward) {
      endBurn(s, g);
      run = g.run = { c, r, nx, ny, crate: cellAt(s.grid, c, r) === CRATE, pts: [], held: 0, dwell: 0, sears: new Map() };
    }
    const at = run.pts[run.pts.length - 1];
    run.dwell = run.dwell * Math.exp(-(at ? Math.hypot(at[0] - x, at[1] - y) : 0) / SEAR_SPREAD) + BURN_STEP;
    sear(s, run, x, y, Math.min(1, run.dwell / LASER_BEAM));
    if (at && Math.hypot(at[0] - x, at[1] - y) < 0.03) {
      at[2] = clock;
      run.held += BURN_STEP;
      return;
    }
    // A beam sweeping fast burns all the way between, not only where it was each step.
    if (at) {
      const n = Math.floor(Math.hypot(x - at[0], y - at[1]) / 0.05);
      for (let i = 1; i < n; i++) run.pts.push([at[0] + ((x - at[0]) * i) / n, at[1] + ((y - at[1]) * i) / n, clock]);
    }
    run.pts.push([x, y, clock]);
  }

  /**
   * Soot a laser's burn (run) lays round (x, y) on the face, at one step: e (0 to 1) is how long
   * the beam has stayed about here (a whole beam held still: 1). A haze of soot, the heat's brown
   * tint nearer in and a darker scorch round the spot itself, each wider the longer it stays, now
   * and then a cloud of soot drifted into the block, and once it has stayed a while streaks
   * licking out from the spot. So a beam held still builds a wide dark stain, streaked, and one
   * that sweeps along the face lays a little at each place it passes, thin and spread along it.
   * Painted into the floor at once, and kept on the block's sear (a dent of its own) to paint
   * again where the floor is drawn again.
   */
  function sear(s, run, x, y, e) {
    const c = Math.floor(x);
    const r = Math.floor(y);
    const key = `${c},${r}`;
    let m = run.sears.get(key);
    if (!m) {
      m = { kind: 'sear', c, r, nx: run.nx, ny: run.ny, crate: cellAt(s.grid, c, r) === CRATE, x, y, puffs: [] };
      run.sears.set(key, m);
      keepDent(m);
    }
    const from = m.puffs.length;
    const rnd = (a, b) => a + Math.random() * (b - a);
    // d out from (x, y), a off straight into the block.
    const out = (a, d) => [x - m.ny * Math.sin(a) * d - m.nx * Math.cos(a) * d, y + m.nx * Math.sin(a) * d - m.ny * Math.cos(a) * d];
    const soot = '10, 8, 6';
    m.puffs.push(['cloud', x, y, 0.18 + 0.46 * e, soot, 0.13]);
    m.puffs.push(['cloud', x, y, 0.08 + 0.26 * e, m.crate ? '56, 34, 18' : '88, 44, 16', 0.08]);
    m.puffs.push(['cloud', x, y, 0.06 + 0.16 * e, '18, 11, 7', 0.12]);
    if (Math.random() < 0.7) m.puffs.push(['cloud', ...out(rnd(-1.3, 1.3), rnd(0.05, 0.12 + 0.24 * e)), rnd(0.08, 0.12 + 0.14 * e), soot, rnd(0.1, 0.2)]);
    if (Math.random() < 0.8 * e) {
      const a = rnd(-1.45, 1.45);
      const d = (0.12 + 0.38 * e) * rnd(0.6, 1);
      m.puffs.push(['lick', ...out(a, 0.04), ...out(a + rnd(-0.1, 0.1), d * 0.55), ...out(a + rnd(-0.15, 0.15), d), rnd(0.03, 0.06), 0.4]);
    }
    if (floorKey === keyFor(s)) {
      fctx.save();
      worldTransform(fctx);
      chipClip(fctx, s, [m]);
      paintSear(fctx, m, from);
      fctx.restore();
      floorChanged(x - 0.7, y - 0.7, 1.4, 1.4);
    }
  }

  /** A laser's soot on a block (sear's m), from its puff `from` on: soft clouds, and streaks of soot fading as they reach out. */
  function paintSear(c, m, from = 0) {
    for (let i = from; i < m.puffs.length; i++) {
      const p = m.puffs[i];
      if (p[0] === 'cloud') {
        const [, x, y, r, col, a] = p;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${col}, ${a})`);
        g.addColorStop(0.45, `rgba(${col}, ${a * 0.7})`);
        g.addColorStop(1, `rgba(${col}, 0)`);
        c.fillStyle = g;
        c.fillRect(x - r, y - r, 2 * r, 2 * r);
        continue;
      }
      // A streak: a soft wide one under a narrower, both tapering out.
      const pts = p.slice(1, 7);
      const [w, a] = p.slice(7);
      for (const [k, of] of [[2.4, 0.35], [1, 0.65]]) {
        c.beginPath();
        crack(c, pts, w * k, 0, 0);
        c.fillStyle = `rgba(10, 8, 6, ${a * of})`;
        c.fill();
      }
    }
  }

  /**
   * The burn on gun g is over (its beam stopped, or moved to another face): it goes into the floor
   * for good, the whole path at once so its soot never doubles where it overlaps itself (addBurn),
   * and keeps glowing as it cools (cooling).
   */
  function endBurn(s, g) {
    const run = g.run;
    g.run = null;
    if (!run || !run.pts.length) return;
    cooling.push(run);
    addBurn(s, run);
  }

  /** The mark a laser's burn leaves (run: endBurn's), as a dent of its own, painted into the floor. */
  function addBurn(s, run) {
    const xs = run.pts.map((p) => p[0]);
    const ys = run.pts.map((p) => p[1]);
    const m = {
      kind: 'burn',
      c: run.c,
      r: run.r,
      nx: run.nx,
      ny: run.ny,
      crate: run.crate,
      x: run.pts[0][0],
      y: run.pts[0][1],
      path: run.pts.map(([x, y]) => [x, y]),
      // The cells it lies on, for the floor's partial redraws (stampDents).
      box: [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.floor(Math.max(...xs)), Math.floor(Math.max(...ys))],
      size: 0.95 + Math.min(0.3, run.held * 0.35),
      hits: 1,
      cracks: 0,
      seed: (Math.random() * 2 ** 31) | 0,
    };
    dentShapes(m);
    keepDent(m);
    if (floorKey === keyFor(s)) {
      stampDent(fctx, s, m);
      floorChanged(m.box[0] - 1, m.box[1] - 1, m.box[2] - m.box[0] + 3, m.box[3] - m.box[1] + 3);
    }
  }

  /**
   * Every point of a laser's burn still hot, as fn(x, y, heat): heat 1 while the beam is on it,
   * cooling to 0 over EMBER_LIFE once it moves on. Drops the burns that have cooled.
   */
  function embers(fn) {
    if (cooling.length) cooling = cooling.filter((run) => run.pts.some((p) => clock - p[2] < EMBER_LIFE));
    const runs = [...cooling];
    for (const g of guns.values()) if (g.run) runs.push(g.run);
    for (const run of runs) {
      for (const [x, y, t] of run.pts) {
        const heat = 1 - (clock - t) / EMBER_LIFE;
        if (heat > 0) fn(x, y, heat);
      }
    }
  }

  /**
   * The glow of a laser's burn at (x, y), heat 1 to 0, drawn with glow(x, y, r, col, a): white hot
   * where the beam is on it, orange, then a dull red as it cools, light spilling round it.
   */
  function ember(glowAt, x, y, heat) {
    glowAt(x, y, 0.12 + 0.2 * heat, pal.alarm, 0.4 * heat);
    glowAt(x, y, 0.06 + 0.1 * heat, pal.fire, 0.65 * heat * heat);
    if (heat > 0.65) glowAt(x, y, 0.07, pal.flash, (heat - 0.65) * 2.2);
  }

  /**
   * Shrapnel's scars round a blast at (x, y) of radius r, on every face of a wall (or crate) turned
   * toward it within reach that it can see: peppered, not set in a row. Soot stains each face near
   * the blast; fragments score the block's top the way they flew from it; then many marks, unevenly
   * spread along the face and over the block's top up to a fifth of a cell in, mostly small pits and
   * short scrapes, bigger ones the nearer the blast, scraped long where the shrapnel came in at a
   * slant, sooty close in. They never merge into one another, so a blast's scatter stays scattered.
   */
  function blastScars(s, x, y, r) {
    const reach = r * 1.6;
    const FACES = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const seen = (tx, ty, c, row) => {
      // Nothing solid between the blast and the face (the block itself aside).
      const n = Math.ceil(Math.hypot(tx - x, ty - y) / 0.2);
      for (let i = 1; i < n; i++) {
        const sx = x + ((tx - x) * i) / n;
        const sy = y + ((ty - y) * i) / n;
        const cc = Math.floor(sx);
        const cr = Math.floor(sy);
        if ((cc !== c || cr !== row) && blocksShell(cellAt(s.grid, cc, cr))) return false;
      }
      return true;
    };
    for (let row = Math.floor(y - reach); row <= Math.floor(y + reach); row++) {
      for (let c = Math.floor(x - reach); c <= Math.floor(x + reach); c++) {
        const kind = cellAt(s.grid, c, row);
        // Past the map it is all wall (rules.js cellAt): the wall round the field is scarred too.
        if (!blocksShell(kind)) continue;
        const crate = kind === CRATE;
        const inset = crate ? CRATE_BOX.gap : 0;
        for (const [nx, ny] of FACES) {
          if (blocksShell(cellAt(s.grid, c + nx, row + ny))) continue;
          // The face's middle, and whether it is turned toward the blast.
          const fx = c + 0.5 + nx * (0.5 - inset);
          const fy = row + 0.5 + ny * (0.5 - inset);
          if ((x - fx) * nx + (y - fy) * ny <= 0) continue;
          // The face's nearest point to the blast, and how close that is.
          const along0 = Math.max(-0.5, Math.min(0.5, -ny * (x - fx) + nx * (y - fy)));
          const px = fx - ny * along0;
          const py = fy + nx * along0;
          const near = Math.hypot(x - px, y - py);
          if (near > reach || !seen(px, py, c, row)) continue;
          const close = Math.max(0, 1 - near / reach);
          // A wall's face is 0.04 out from where its chips sit; a crate's on its box.
          const out = inset ? 0 : 0.04;
          if (close > 0.3 && !crate) addDent(s, c, row, px - nx * out, py - ny * out, nx, ny, { size: 0.6 + 1.1 * close, soot: true });
          // Fragments scored across the block's top, the way they flew from the blast.
          const scores = Math.round(2 + 7 * close);
          for (let k = 0; k < scores; k++) {
            const along = (Math.random() - 0.5) * 0.92;
            const tx = fx - ny * along - nx * (0.02 + 0.14 * Math.random());
            const ty = fy + nx * along - ny * (0.02 + 0.14 * Math.random());
            const d = Math.hypot(tx - x, ty - y);
            if (d > reach || !seen(tx, ty, c, row)) continue;
            addDent(s, c, row, tx, ty, nx, ny, { size: 0.6 + 0.6 * (1 - d / reach), burn: d < r * 0.5, streak: { angle: Math.atan2(ty - y, tx - x), len: 0.1 + 0.14 * Math.random() } });
          }
          const n = Math.round(4 + 14 * close);
          for (let k = 0; k < n; k++) {
            const along = (Math.random() - 0.5) * 0.92;
            const tx = fx - ny * along;
            const ty = fy + nx * along;
            const dx = tx - x;
            const dy = ty - y;
            const d = Math.hypot(dx, dy);
            if (d > reach || !seen(tx, ty, c, row)) continue;
            const near1 = 1 - d / reach;
            const square = Math.abs(dx * nx + dy * ny) / (d || 1);
            const big = Math.random() < 0.12 + 0.3 * near1;
            const scrape = square < 0.6 || Math.random() < 0.3 ? { dir: Math.sign(nx * dy - ny * dx) || (Math.random() < 0.5 ? -1 : 1), len: 0.1 + 0.18 * Math.random() * (1 - square) } : null;
            addDent(s, c, row, tx - nx * out, ty - ny * out, nx, ny, {
              size: big ? 0.8 + 0.5 * near1 : 0.45 + 0.35 * Math.random(),
              cracks: big ? 2 : Math.random() < 0.35 ? 1 : 0,
              burn: d < r * 0.5,
              scrape,
              inset: crate || scrape ? 0 : Math.random() * 0.2,
              merge: false,
            });
          }
        }
      }
    }
  }

  /**
   * What a blast of radius r at (x, y) leaves for good, a mine's, a bomb's or a tank's blowing up:
   * its burn on the floor (blastBurn) and its shrapnel's scars on the blocks round it (blastScars),
   * painted into the floor once.
   */
  function blastMarks(s, x, y, r) {
    const burn = { kind: 'blast', x, y, r, seed: (Math.random() * 2 ** 31) | 0 };
    scorches.push(burn);
    if (floorKey === keyFor(s)) {
      worldTransform(fctx);
      blastBurn(fctx, burn, s);
      floorChanged(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2);
    }
    blastScars(s, x, y, r);
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

  /** How many of something that comes n times on average (n may be under 1): n's whole part, and one more by chance. */
  const some = (n) => Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);

  /**
   * What laser tank t's rod gives off over dw seconds of world time while its beam b works: as it
   * charges, sparks drawn in to it from round about, more as it nears firing; as it burns, sparks
   * thrown off its point either side of the beam. Not under reduced motion.
   */
  function emitter(s, t, b, g, dw) {
    const lens = lensAt(t, s.time - g.fired);
    if (b.phase === 'charge') {
      const k = 1 - Math.max(0, b.left) / LASER_CHARGE;
      for (let i = some(GATHER * (1 + 2 * k) / 3 * dw); i > 0; i--) {
        const a = Math.random() * TAU;
        const r = 0.3 + Math.random() * 0.35;
        const v = 2.2 + Math.random() * 1.4;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        add({ kind: 'streak', x: lens.x + ux * r, y: lens.y + uy * r, vx: -ux * v, vy: -uy * v, life: r / v, max: r / v, size: 0.02, color: Math.random() < 0.4 ? pal.flash : pal.alarm, drag: 0, gather: true });
      }
      return;
    }
    for (let i = some(SPIT * dw); i > 0; i--) {
      const side = Math.random() < 0.5 ? -1 : 1;
      sparks(lens.tx, lens.ty, b.angle + side * 0.9, 0.5, 1, { speed: 2.2, life: 0.18, size: 0.02, color: Math.random() < 0.5 ? pal.flash : pal.alarm });
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
        case 'beam': {
          // A laser's beam lights: its emitter thumps back (art.js) and light bursts off the rod's
          // point, throwing sparks along the beam.
          const g = gun(e.id);
          g.fired = s.time;
          const t = s.tanks.find((o) => o.id === e.id);
          if (!t) break;
          const lens = lensAt(t, 0);
          flash(lens.tx, lens.ty, 0.08, 0.42, 0.12, pal.flash);
          ring(lens.tx, lens.ty, 0.06, 0.7, 0.28, pal.alarm, 0.06);
          add({ kind: 'glow', x: lens.tx, y: lens.ty, r: 1.5, color: pal.alarm, a: 0.4, life: 0.3, max: 0.3 });
          sparks(lens.tx, lens.ty, e.angle, 1.1, calm ? 1 : 7, { speed: 3.2, life: 0.22, size: 0.03, color: pal.flash });
          break;
        }
        case 'beamEnd': {
          // It goes out: the rod cools (drawLasers), venting a puff of heat and a last spark or two.
          const g = gun(e.id);
          g.ended = s.time;
          const t = s.tanks.find((o) => o.id === e.id);
          if (!t) break;
          const lens = lensAt(t, s.time - g.fired);
          const ux = Math.cos(t.turret);
          const uy = Math.sin(t.turret);
          smoke(lens.tx, lens.ty, calm ? 1 : 2, 0.05, 0.05, 0.7, { vx: ux * 0.35, vy: uy * 0.35, jitter: 0.3, drag: 2 });
          if (!calm) sparks(lens.tx, lens.ty, t.turret, 1.2, 3, { speed: 1.6, life: 0.25, size: 0.02, color: pal.fire });
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
          // It burns the floor and scars the walls round it, for good.
          blastMarks(s, e.x, e.y, r);
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
          // It burns the floor and scars the walls round it as a landing bomb does, and leaves its X
          // on the burn, for good.
          blastMarks(s, e.x, e.y, BOMB_R);
          const mark = { x: e.x, y: e.y, a: Math.random() * 0.5 - 0.25, seed: (Math.random() * 2 ** 31) | 0 };
          scorches.push(mark);
          if (floorKey === keyFor(s)) {
            worldTransform(fctx);
            drawScorch(fctx, mark, s);
            floorChanged(mark.x - 0.9, mark.y - 0.9, 1.8, 1.8);
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
    if (chips.length && clock - chips[0].t > chips[0].life) chips = chips.filter((m) => clock - m.t < m.life || dropPicture(m));

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
    // A laser burning chars the block it meets, for good, and the spot glows hot, cooling after.
    if (dw > 0) {
      const calm = reduceMotion();
      for (const t of s.tanks) {
        const b = t.alive && t.beam;
        const g = gun(t.id);
        if (b && !calm) emitter(s, t, b, g, dw);
        // Charging shows a red line; any other phase is the beam burning (engine.js: 'fire').
        if (!b || b.phase === 'charge') {
          endBurn(s, g);
          continue;
        }
        g.burn = (g.burn || 0) - dw;
        if (g.burn > 0) continue;
        g.burn = BURN_STEP;
        laserBurn(s, b, t, g);
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
        trails.push([t.x, t.y, t.body]);
        if (trails.length > MAX_TRAILS) trails.shift();
        if (G) G.addMark(t.x, t.y, t.body, clock);
        else if (floorKey === keyFor(s)) {
          // The 2D floor keeps what stays of it.
          worldTransform(fctx);
          stampTrails(fctx, [trails[trails.length - 1]]);
        }
      }
    }
    if (marks.length && clock - marks[0].t > MARK_LIFE) marks = marks.filter((m) => clock - m.t <= MARK_LIFE);
  }

  /** Forget everything visual from the previous world (new mission or retry). */
  function reset() {
    marks = [];
    if (G) G.clearMarks();
    scorches = [];
    rubble = [];
    dropPictures();
    chips = [];
    dents = [];
    dentsAt = new Map();
    trails = [];
    cooling = [];
    if (G) G.clearTrails();
    fx = [];
    odometer = new Map();
    guns = new Map();
    worldTime = 0;
    shake = 0;
    floorKey = '';
    built = null; // the whole field again: the last world's scorch marks, splinters and dents go
    prepared = null;
  }

  /* ---------- Drawing ---------- */

  function drawMarks() {
    if (!marks.length) return;
    const buckets = 6;
    // Each fades in six steps down to what of it stays, which the floor holds: over that, it adds only the rest.
    const full = alphaOf(pal.track);
    for (let b = 0; b < buckets; b++) {
      const a = full * (1 - b / buckets);
      ctx.globalAlpha = Math.max(0, (a - TRAIL_A) / (1 - TRAIL_A)) / full;
      if (!ctx.globalAlpha) continue;
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

  /** The strength of a colour: 1 unless it is rgba(). */
  function alphaOf(col) {
    const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(String(col));
    return m ? Number(m[1]) : 1;
  }

  /** Lays tread marks ([x, y, angle] each) into floor canvas c (world transform set) as they stay: both dashes, at TRAIL_A. */
  function stampTrails(c, list) {
    c.save();
    c.fillStyle = `rgba(0, 0, 0, ${TRAIL_A})`;
    c.beginPath();
    for (const [x, y, a] of list) {
      const hx = Math.cos(a);
      const hy = Math.sin(a);
      for (const side of [-0.27, 0.27]) {
        const cx = x - hy * side;
        const cy = y + hx * side;
        const ax = hx * 0.045;
        const ay = hy * 0.045;
        const bx = -hy * 0.085;
        const by = hx * 0.085;
        c.moveTo(cx - ax - bx, cy - ay - by);
        c.lineTo(cx + ax - bx, cy + ay - by);
        c.lineTo(cx + ax + bx, cy + ay + by);
        c.lineTo(cx - ax + bx, cy - ay + by);
        c.closePath();
      }
    }
    c.fill();
    c.restore();
  }

  /** #rrggbb at alpha a. */
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /** A crack as one thin shape along pts, w across at its root, thinning to a point: a sub-path of c's. */
  function crack(c, pts, w, ox, oy) {
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
    c.moveTo(pts[0] + side[0][0] + ox, pts[1] + side[0][1] + oy);
    for (let i = 1; i < n; i++) c.lineTo(pts[i * 2] + side[i][0] + ox, pts[i * 2 + 1] + side[i][1] + oy);
    for (let i = n - 1; i >= 0; i--) c.lineTo(pts[i * 2] - side[i][0] + ox, pts[i * 2 + 1] - side[i][1] + oy);
    c.closePath();
  }

  /**
   * What shots knock off walls and crates, fading (each holds for its first second): crumbs on
   * the floor in front of the face, and a soft bloom of dust along the face, or soot where a rocket
   * burst, clipped to the block. Their dents are in the floor (stampDent). One on a crate goes with
   * the crate.
   */
  function drawChips(s) {
    const live = liveChips(s);
    if (!live.length) return;
    for (const m of live) chipCrumbs(ctx, m, chipFade(m));
    ctx.save();
    chipClip(ctx, s, live);
    for (const m of live) chipDust(ctx, m, chipFade(m));
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  const liveChips = (s) => chips.filter((m) => clock - m.t < m.life && (!m.crate || cellAt(s.grid, m.c, m.r) === CRATE));
  const chipFade = (m) => Math.max(0, Math.min(1, (m.life - (clock - m.t)) / (m.life - 1)));
  const screenLight = () => vecToWorld(Math.cos(LIGHT), Math.sin(LIGHT));

  function polygon(c, pts, dx = 0, dy = 0) {
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) c.lineTo(pts[i] + dx, pts[i + 1] + dy);
    c.closePath();
  }

  /** A chip's crumbs on the floor, each over a faint shadow, at strength a. */
  function chipCrumbs(c, m, a) {
    const L = screenLight();
    const px = 1 / view.unit; // one CSS pixel, in cells
    const T = m.crate ? tones.crate : tones.wall;
    c.globalAlpha = a;
    // A crate's are flecks of its paint; a wall's, pale grit.
    for (const [fill, d] of [['rgba(0, 0, 0, 0.3)', px], [m.crate ? pal.crateLit : T.fresh, 0]]) {
      c.fillStyle = fill;
      c.beginPath();
      for (const b of m.bits) {
        const r = Math.max(b.r, px * 1.1);
        const ca = Math.cos(b.a) * r;
        const sa = Math.sin(b.a) * r;
        const x = b.x + L.x * d;
        const y = b.y + L.y * d;
        c.moveTo(x + ca, y + sa);
        c.lineTo(x - sa * 0.8, y + ca * 0.8);
        c.lineTo(x - ca, y - sa);
        c.lineTo(x + sa * 0.7, y - ca * 0.7);
        c.closePath();
      }
      c.fill();
    }
  }

  /**
   * Clips c to what the chips in list can mark: the walls in and round a wall chip's cell, or a
   * crate chip's own box (not the floor round it, nor the crate beside it).
   */
  function chipClip(c, s, list) {
    c.beginPath();
    const seen = new Set();
    const { gap: g, radius: k } = CRATE_BOX;
    for (const m of list) {
      if (m.crate) {
        const [x0, y0, x1, y1] = [m.c + g, m.r + g, m.c + 1 - g, m.r + 1 - g];
        c.moveTo(x0 + k, y0);
        c.arcTo(x1, y0, x1, y1, k);
        c.arcTo(x1, y1, x0, y1, k);
        c.arcTo(x0, y1, x0, y0, k);
        c.arcTo(x0, y0, x1, y0, k);
        c.closePath();
        continue;
      }
      const [c0, r0, c1, r1] = m.box || [m.c, m.r, m.c, m.r];
      for (let r = r0 - 1; r <= r1 + 1; r++) {
        for (let col = c0 - 1; col <= c1 + 1; col++) {
          const key = `${col},${r}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // Its own outline, rounded at the corners as the floor draws it, so a dent there chips the corner.
          if (cellAt(s.grid, col, r) === WALL) wallCell(c, (cc, rr) => cellAt(s.grid, cc, rr), col, r);
        }
      }
    }
    c.clip();
  }

  /** A chip's bloom of dust along the face (a crate's is fainter), or soot where a rocket burst, at strength k. */
  function chipDust(c, m, k) {
    const T = m.crate ? tones.crate : tones.wall;
    c.globalAlpha = 1;
    c.save();
    c.translate(m.x, m.y);
    c.rotate(Math.atan2(m.ny, m.nx));
    c.scale(0.55, 1);
    const r = (m.burn ? 0.32 : 0.26) * m.size;
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, m.burn ? `rgba(0, 0, 0, ${0.55 * k})` : rgba(T.dust, (m.crate ? 0.16 : 0.28) * k));
    g.addColorStop(1, m.burn ? 'rgba(0, 0, 0, 0)' : rgba(T.dust, 0));
    c.fillStyle = g;
    c.fillRect(-r, -r, 2 * r, 2 * r);
    c.restore();
  }

  /**
   * A dent (dentShapes), at full strength (clipped by the caller), under the light the blocks are
   * lit by. A wall's flake or scrape is a shallow pale scar with a thin shadow under its rim on the
   * side toward the light; a pock in it is dark, its far rim catching the light; then the cracks. A
   * crate's notch or gouge is a bite out of its frame, dark inside, as deep as the gap round a
   * crate, its far wall catching the light; then its paint scuffed pale either side of a notch.
   */
  function chipDent(c, m) {
    const L = screenLight();
    const px = 1 / view.unit;
    const T = m.crate ? tones.crate : tones.wall;
    // A recess in a lit surface: its floor in light, less the part the rim toward the light
    // shades, a band d wide along that side.
    const recess = (pts, light, dark, d) => {
      c.save();
      polygon(c, pts);
      c.clip();
      c.fillStyle = dark;
      c.fill();
      polygon(c, pts, L.x * d, L.y * d);
      c.fillStyle = light;
      c.fill();
      c.restore();
    };
    c.globalAlpha = 1;
    if (m.kind === 'streak') {
      // Its groove's shadow toward the light, then the scored metal (a crate's paint) pale.
      const w = Math.max(0.024 * m.size, 1.1 * px);
      const d = Math.max(0.012 * m.size, 0.7 * px);
      c.beginPath();
      for (const line of m.lines) crack(c, line, w, -L.x * d, -L.y * d);
      c.fillStyle = m.crate ? pal.crateDark : T.deep;
      c.fill();
      c.beginPath();
      for (const line of m.lines) crack(c, line, w * 0.8, 0, 0);
      c.fillStyle = m.crate ? shade(pal.crateLit, 0.2) : m.burn ? shade(T.deep, 0.3) : T.fresh;
      c.fill();
      return;
    }
    if (m.kind === 'soot') {
      // A blast's soot on the face turned toward it: a wide soft stain along it, darkest at its
      // middle and fading into the block.
      c.save();
      c.translate(m.x, m.y);
      c.rotate(Math.atan2(m.ny, m.nx));
      c.scale(0.5, 1);
      const r = 0.55 * m.size;
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(8, 6, 5, 0.62)');
      g.addColorStop(0.5, 'rgba(10, 8, 6, 0.32)');
      g.addColorStop(1, 'rgba(12, 10, 8, 0)');
      c.fillStyle = g;
      c.fillRect(-r, -r, 2 * r, 2 * r);
      c.restore();
      return;
    }
    if (m.kind === 'sear') {
      paintSear(c, m);
      return;
    }
    if (m.kind === 'burn') {
      // Laid along the stretch it burned (or round the spot where the beam was held), over the
      // soot it laid as it burned (sear): the char with its pits, hairline cracks and a glassy sheen.
      const k = m.size;
      c.fillStyle = 'rgba(9, 6, 4, 0.95)';
      polygon(c, m.char);
      c.fill();
      c.beginPath();
      for (const [x, y, r] of m.pits) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, TAU);
      }
      c.fill();
      c.beginPath();
      for (const l of m.lines) crack(c, l, Math.max(0.014 * k, 0.9 * px), 0, 0);
      c.fillStyle = 'rgba(6, 4, 3, 0.8)';
      c.fill();
      // The glassy sheen along its rim away from the light, where the heat glazed it.
      c.save();
      polygon(c, m.char);
      c.clip();
      c.fillStyle = 'rgba(255, 214, 170, 0.2)';
      c.fill();
      polygon(c, m.char, -L.x * 0.018 * k, -L.y * 0.018 * k);
      c.fillStyle = 'rgba(9, 6, 4, 0.95)';
      c.fill();
      c.restore();
      return;
    }
    if (m.crate) {
      // A bite out of the crate's frame: a dark hole, as deep as the gap round a crate (sootier
      // where a rocket burst), whose rim is lit and shaded as the crate's own edges are, right at
      // the cut: light where the hole lies toward the light, shade where it lies away from it.
      const d = Math.max(0.03 * m.size, 1.3 * px);
      polygon(c, m.shape);
      c.fillStyle = m.burn ? shade(pal.crateDark, -0.75) : shade(pal.crateDark, -0.5);
      c.fill();
      c.save();
      // The crate round the hole: all but the hole.
      c.beginPath();
      c.rect(m.x - 1, m.y - 1, 2, 2);
      for (let i = 0; i < m.shape.length; i += 2) c.lineTo(m.shape[i], m.shape[i + 1]);
      c.closePath();
      c.clip('evenodd');
      polygon(c, m.shape, L.x * d, L.y * d);
      c.fillStyle = pal.crateLit;
      c.fill();
      polygon(c, m.shape, -L.x * d, -L.y * d);
      c.fillStyle = pal.crateDark;
      c.fill();
      c.restore();
      if (m.kind === 'scrape') return;
      // Its paint scuffed pale along the face, either side.
      c.beginPath();
      for (const line of m.scuffs) crack(c, line, Math.max(0.022 * m.size, 1.1 * px), 0, 0);
      c.fillStyle = shade(pal.crateLit, 0.2);
      c.globalAlpha = 0.6;
      c.fill();
      c.globalAlpha = 1;
      return;
    }
    recess(m.shape, m.burn ? shade(T.deep, 0.25) : T.fresh, T.deep, Math.max(0.018 * m.size, 0.9 * px));
    if (m.kind === 'scrape') {
      // Its deepest edge, a hairline in the dark.
      c.beginPath();
      for (const line of m.lines) crack(c, line, Math.max(0.022 * m.size, 1 * px), 0, 0);
      c.fillStyle = T.deep;
      c.fill();
      return;
    }
    // The pock: dark, but for its far rim, so the light is laid first and the dark moved toward the light.
    c.save();
    polygon(c, m.pock);
    c.clip();
    c.fillStyle = T.rim;
    c.fill();
    const d = Math.max(0.016 * m.size, 0.9 * px);
    polygon(c, m.pock, -L.x * d, -L.y * d);
    c.fillStyle = T.pit;
    c.fill();
    c.restore();
    if (!m.lines.length) return;
    c.beginPath();
    for (const line of m.lines) crack(c, line, Math.max(0.026 * m.size, 1.1 * px), 0, 0);
    c.fillStyle = T.deep;
    c.fill();
  }

  /** Paints chip m's dent into the floor canvas c, clipped to what it marks. */
  function stampDent(c, s, m) {
    c.save();
    worldTransform(c);
    chipClip(c, s, [m]);
    chipDent(c, m);
    c.restore();
  }

  /** Paints into the floor every dent on cells c0..c1, r0..r1 whose block still stands (a broken crate's go with it). */
  function stampDents(c, s, c0 = -Infinity, r0 = -Infinity, c1 = Infinity, r1 = Infinity) {
    for (const m of dents) {
      const [bc0, br0, bc1, br1] = m.box || [m.c, m.r, m.c, m.r];
      if (bc1 < c0 || bc0 > c1 || br1 < r0 || br0 > r1) continue;
      if (cellAt(s.grid, m.c, m.r) !== (m.crate ? CRATE : WALL)) continue;
      stampDent(c, s, m);
    }
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

  /**
   * A muzzle's flame pointing along +x from the origin, len long, white-hot at its root: a
   * muzzle brake's (brake) also blows out of its sides, and a plain barrel's flicks out two small
   * side flames.
   */
  function paintMuzzle(c, len, brake) {
    c.fillStyle = pal.fire;
    c.beginPath();
    tongue(c, 0, 0, 0, len, len * 0.2);
    if (brake) for (const side of [-1, 1]) tongue(c, -0.1, 0, side * (Math.PI / 2 + 0.2), len * 0.45, len * 0.11);
    else for (const side of [-1, 1]) tongue(c, 0, 0, side * 0.8, len * 0.38, len * 0.08);
    c.fill();
    c.fillStyle = pal.flash;
    c.beginPath();
    tongue(c, 0, 0, 0, len * 0.55, len * 0.12);
    c.fill();
    c.beginPath();
    c.arc(0, 0, len * 0.16, 0, TAU);
    c.fill();
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
   * Lasers, straight on the arena, drawn with fx: gl.js, or fx2d, the same shapes on the 2D
   * context. While one charges, its ruby rod gathers light (a glow growing on it and the floor,
   * rings closing on it, faster as it nears firing) and a thin red line runs down the way it will
   * fire, brightening and blinking in its last third, the rod blinking with it. Then the beam, a
   * red glow round a white-hot core that flickers, flaring where it leaves the rod (brighter and
   * wider for its first half cell, a glare across it, its light on the floor round the tank), with
   * sparks where a wall stops it. Once it goes out the rod glows on, white-hot to orange to a dull
   * red, cooling over LENS_COOL. Steady under reduced motion. (Sparks drawn in and thrown off: emitter.)
   */
  function drawLasers(s, calm, fx) {
    const ADD = { add: true };
    for (const t of s.tanks) {
      if (!t.alive || TYPES[t.type].weapon !== 'laser') continue;
      const g = guns.get(t.id);
      const b = t.beam;
      const lens = lensAt(t, g ? s.time - g.fired : Infinity);
      if (!b) {
        const h = g && g.ended != null ? 1 - (s.time - g.ended) / LENS_COOL : 0;
        if (h > 0 && h <= 1) {
          fx.glow(lens.x, lens.y, 0.16 + 0.16 * h, pal.alarm, 0.5 * h);
          fx.glow(lens.x, lens.y, 0.06 + 0.06 * h, pal.fire, 0.8 * h * h);
          if (h > 0.7) fx.glow(lens.x, lens.y, 0.05, pal.flash, (h - 0.7) * 2.5);
        }
        continue;
      }
      const L = beamLine(s.grid, t.x, t.y, b.angle);
      const ux = Math.cos(b.angle);
      const uy = Math.sin(b.angle);
      const line = (w, col, a, opts) => fx.line(lens.tx, lens.ty, L.x1, L.y1, w, col, a, opts);
      if (b.phase === 'charge') {
        const k = 1 - Math.max(0, b.left) / LASER_CHARGE;
        const blink = calm || k < 0.66 || Math.floor(clock * 16) % 2 === 0 ? 1 : 0.45;
        line(0.025 + 0.035 * k, pal.alarm, (0.35 + 0.55 * k) * blink);
        fx.glow(lens.x, lens.y, 0.5 + 0.4 * k, pal.alarm, 0.12 * k * blink);
        fx.glow(lens.x, lens.y, 0.12 + 0.18 * k, pal.alarm, (0.3 + 0.5 * k) * blink);
        fx.glow(lens.x, lens.y, 0.05 + 0.07 * k, pal.flash, 0.7 * k * k * blink);
        if (!calm) {
          for (let i = 0; i < 2; i++) {
            const p = (2 * k + 2 * k * k + i / 2) % 1;
            fx.ring(lens.x, lens.y, 0.06 + 0.4 * (1 - p), 0.025, pal.alarm, p * (0.2 + 0.4 * k));
          }
        }
      } else {
        const f = calm ? 1 : 0.85 + Math.random() * 0.15;
        fx.glow(lens.x, lens.y, 1.2, pal.alarm, 0.16 * f);
        line(0.34, pal.alarm, 0.2 * f, ADD);
        line(0.16, pal.alarm, 0.5 * f, ADD);
        line(0.06, pal.flash, 0.95, ADD);
        fx.glow(lens.tx + ux * 0.15, lens.ty + uy * 0.15, 0.4, pal.alarm, 0.5 * f);
        fx.line(lens.tx, lens.ty, lens.tx + ux * 0.22, lens.ty + uy * 0.22, 0.11, pal.flash, 0.6 * f, ADD);
        const across = calm ? 0.26 : 0.2 + Math.random() * 0.12;
        for (const [reach, w, col, a] of [[1, 0.08, pal.alarm, 0.3], [0.55, 0.03, pal.flash, 0.55]]) {
          const d = across * reach;
          fx.line(lens.tx - uy * d, lens.ty + ux * d, lens.tx + uy * d, lens.ty - ux * d, w, col, a * f, ADD);
        }
        fx.glow(lens.x, lens.y, 0.32, pal.alarm, 0.75 * f);
        fx.glow(lens.x, lens.y, 0.13, pal.flash, 0.9);
        if (!calm && Math.random() < 0.6) sparks(L.x1, L.y1, b.angle + Math.PI, 1.4, 1, { speed: 3, life: 0.15, color: pal.flash });
      }
    }
  }

  /** gl.js's glow, line and ring, drawn on the 2D context instead (drawLasers). */
  const fx2d = {
    glow: (x, y, r, col, a) => glow(ctx, x, y, r, col, a),
    line(x0, y0, x1, y1, w, col, a, { add = false } = {}) {
      ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
    ring(x, y, r, w, col, a) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };

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
        paintMuzzle(ctx, len, p.brake);
        ctx.restore();
      } else if (p.kind === 'streak') {
        // Most fade as they die; one drawn in (gather) brightens as it nears where it goes.
        ctx.globalAlpha = p.gather ? Math.min(1, (1 - k) * 2.5) : Math.min(1, k * 1.6);
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


  /* ---------- Drawing with WebGL (gl.js) ---------- */

  let prepared = null; // the world whose tank kinds gl.js has been asked to paint ahead
  let preparedGen = -1;
  let marksGen = -1; // the pictures' generation the GPU's tread marks were laid for
  let trailsAt = -1; // gl.js's tracks the marks that stay were last all laid into
  let floorGen = -1; // the pictures' generation gl.js was last given the whole floor for
  const muzzles = new Map(); // a muzzle flame's picture, by its size and kind

  /** The world's transform to device px, as worldTransform sets it, moved by (ox, oy) cells (the shake). */
  function worldMatrix(ox = 0, oy = 0) {
    const s = view.unit * view.dpr;
    const x = view.x * view.dpr + ox * s;
    const y = view.y * view.dpr + oy * s;
    return view.rot ? { a: 0, b: -s, c: s, d: 0, e: x, f: y + view.cols * s } : { a: s, b: 0, c: 0, d: s, e: x, f: y };
  }

  /** Lets a chip's picture go (false, so it can sit in a filter). */
  function dropPicture(m) {
    if (m && m.pic && G) G.free(m.pic);
    if (m) m.pic = null;
    return false;
  }

  /** Lets every picture painted for this layout go: chips are painted as the screen shows them. */
  function dropPictures() {
    if (!G) return;
    for (const m of chips) dropPicture(m);
    for (const pic of muzzles.values()) G.free(pic);
    muzzles.clear();
  }

  /** A muzzle flame of `size`, painted once (at that length; laid stretched as it flickers). */
  function muzzlePicture(size, brake) {
    const key = `${size} ${!!brake}`;
    let pic = muzzles.get(key);
    if (!pic || pic.generation !== G.generation) {
      pic = G.bake((c) => paintMuzzle(c, size, brake));
      muzzles.set(key, pic);
    }
    return pic;
  }

  /**
   * draw, with gl.js: the same things in the same order, from the same numbers. Chips are painted
   * once each (as the screen shows them) and laid fading; every tank kind on the field is painted
   * ahead, a little each frame, while its mission's banner is up.
   */
  function drawGL(s, { aim = null, reticle = null, beacon = 0, cells = null } = {}) {
    if (!G.ok) return;
    const calm = reduceMotion();
    G.setView({ s: view.unit * view.dpr, dpr: view.dpr, palette: pal });
    if (prepared !== s || preparedGen !== G.generation) {
      prepared = s;
      preparedGen = G.generation;
      G.prepare(s.tanks.map((t) => t.type));
    }
    G.work(4);
    if (floorGen !== G.generation) {
      floorGen = G.generation;
      floorDirty = 'all';
    }
    if (floorDirty === 'all') G.floor(floor);
    else if (floorDirty) {
      const { x0, y0, x1, y1 } = floorDirty;
      G.floor(fctx.getImageData(x0, y0, x1 - x0, y1 - y0), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    floorDirty = null;
    const jitter = shake > 0 ? shake * 0.12 : 0;
    const M = worldMatrix(jitter ? (Math.random() - 0.5) * jitter : 0, jitter ? (Math.random() - 0.5) * jitter : 0);
    G.begin(M, worldMatrix());

    for (const m of liveChips(s)) {
      if (!m.pic || m.pic.generation !== G.generation) {
        m.pic = G.bake((c) => {
          chipCrumbs(c, m, 1);
          c.save();
          chipClip(c, s, [m]);
          chipDust(c, m, 1);
          c.restore();
        }, { x: m.x, y: m.y, world: true });
      }
      G.sprite(m.pic, m.x, m.y, chipFade(m));
    }
    // PERFORMANCE: tread marks are laid on the GPU once each (G.addMark in update) and fade there,
    // down to what stays of them, which gl.js keeps in a texture the floor is laid through.
    if (marksGen !== G.generation) {
      marksGen = G.generation;
      G.clearMarks();
      for (const m of marks) G.addMark(m.x, m.y, m.a, m.t);
    }
    if (trailsAt !== G.screen) {
      trailsAt = G.screen;
      G.clearTrails();
      G.trails(trails);
    }
    G.marks(marks.length, clock, MARK_LIFE, pal.track, [0.27, 0.045, 0.085], TRAIL_A);
    for (const b of s.bombs) {
      const { k } = bombAt(b);
      const T = TARGET;
      G.disc(b.tx, b.ty, BOMB_R, pal.alarm, calm ? T.fill.calm : T.fill.a + T.fill.grow * k);
      G.ring(b.tx, b.ty, BOMB_R, T.ring.w, pal.alarm, T.ring.a, T.ring.dash);
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        G.line(b.tx + ux * T.cross.from, b.ty + uy * T.cross.from, b.tx + ux * T.cross.to, b.ty + uy * T.cross.to, T.cross.w, pal.alarm, T.ring.a, { round: false });
      }
      if (!calm) G.ring(b.tx, b.ty, BOMB_R + (1 - k) * T.closing.reach, T.closing.w, pal.alarm, T.closing.a + T.closing.grow * k);
    }
    const kindOf = (id) => s.tanks.find((t) => t.id === id)?.type || 'player';
    for (const m of s.mines) G.mine(m.x, m.y, pal.tanks[kindOf(m.owner)] || pal.tanks.player, mineLight(m));

    const hidden = (t) => (TYPES[t.type].invisible ? Math.max(0, 1 - s.time / 1.2) : 1);
    const list = [];
    for (const t of s.tanks) {
      const alpha = t.alive ? hidden(t) : 0;
      if (alpha <= 0) continue;
      const T = TYPES[t.type];
      const o = odometer.get(t.id);
      const g = guns.get(t.id);
      list.push({
        t,
        alpha,
        phase: o ? o.total : 0,
        mines: T.mines - owned(s.mines, t),
        lit: T.weapon === 'missile' ? owned(s.bullets, t) > 0 : T.weapon === 'laser' && !!t.beam,
        roll: o ? o.roll : 0,
        fired: g ? s.time - g.fired : Infinity,
        side: g?.side || 0,
        heat: g && t.spin ? Math.min(g.heat, t.spin) : 0,
      });
    }
    G.tanks(list);

    drawLasers(s, calm, G);
    embers((x, y, heat) => ember(G.glow, x, y, heat));
    if (beacon > 0 && s.tanks[0].alive) {
      const p = s.tanks[0];
      const pulse = (clock * 1.6) % 1;
      G.ring(p.x, p.y, 0.55 + pulse * 0.6, 0.08, pal.signal, beacon * (1 - pulse));
    }
    glAim(s, aim);
    // A missile's light blinks; under reduced motion it stays on.
    const blink = calm || Math.floor(clock * 8) % 2 === 0;
    G.shots(s.bullets.map((b) => ({ b, flame: calm ? 0.5 : Math.random(), blink, tone: b.weapon === 'missile' ? pal.tanks[kindOf(b.owner)] : null })));
    const up = vecToWorld(0, -1);
    for (const b of s.bombs) G.bomb(bombLook(b, M, { up }));
    glFx();
    if (reticle) {
      G.ring(reticle.x, reticle.y, 0.28, 0.06, pal.aim, 0.8);
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) G.line(reticle.x + ux * 0.15, reticle.y + uy * 0.15, reticle.x + ux * 0.45, reticle.y + uy * 0.45, 0.06, pal.aim, 0.8, { round: false });
    }
    if (cells) {
      const STYLE = { error: [pal.alarm, 1], note: [pal.aim, 0.85], cursor: [pal.aim, 0.45] };
      for (const m of cells) {
        const [color, alpha] = STYLE[m.kind] || STYLE.note;
        G.box(m.c + 0.5, m.r + 0.5, 0.44, 0.44, 0, color, alpha, { r: 0.18, outline: 0.08 });
      }
    }
    G.end();
  }

  /** drawAim, with gl.js: the dotted line out of your gun, and a hint of its ricochet. */
  function glAim(s, aim) {
    const p = s.tanks[0];
    if (!p.alive || aim == null || muzzleBlocked(s.grid, p.x, p.y, aim)) return;
    const pts = tracePath(s.grid, p.x + Math.cos(aim) * MUZZLE, p.y + Math.sin(aim) * MUZZLE, aim, 1, 40);
    // setLineDash([0.02, 0.22]) with round ends, each stroke's dashes from its start.
    const dots = (x0, y0, x1, y1, a) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) return;
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      for (let d = 0; d < len; d += 0.24) {
        const e = Math.min(d + 0.02, len);
        G.line(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e, 0.06, pal.aim, a);
      }
    };
    dots(pts[0], pts[1], pts[2], pts[3], 0.65);
    if (pts.length >= 6) {
      const dx = pts[4] - pts[2];
      const dy = pts[5] - pts[3];
      const k = Math.min(1, 2.4 / (Math.hypot(dx, dy) || 1));
      dots(pts[2], pts[3], pts[2] + dx * k, pts[3] + dy * k, 0.3);
    }
  }

  /** drawFx, with gl.js: smoke, then light and flashes, then flames and rings, then debris and sparks. */
  function glFx() {
    // A glow is laid at the strength the effect before it left the 2D context at (drawFxLayer
    // sets none for it), most often a puff of smoke's: so it is here too, or every muzzle flash
    // and burst would glow about three times as bright as the game has always shown it.
    let left = 1;
    for (let layer = 0; layer <= 3; layer++) {
      for (const p of fx) {
        if (layerOf(p) !== layer) continue;
        const k = Math.max(0, p.life / p.max);
        if (p.kind === 'glow') G.glow(p.x, p.y, p.r, p.color, p.a * k * left);
        else if (p.kind === 'muzzle') {
          const len = p.size * (0.8 + 0.4 * (1 - k));
          G.sprite(muzzlePicture(p.size, p.brake), p.x, p.y, Math.min(1, k * 1.5), { angle: p.a, scale: len / p.size });
        } else if (p.kind === 'streak') G.line(p.x, p.y, p.x - p.vx * 0.035, p.y - p.vy * 0.035, Math.max(p.size, 1 / view.unit), p.color, (left = p.gather ? Math.min(1, (1 - k) * 2.5) : Math.min(1, k * 1.6)));
        else if (p.kind === 'flash') G.disc(p.x, p.y, p.r1 + (p.r0 - p.r1) * k, p.color, (left = k * 0.9));
        else if (p.kind === 'ring') G.ring(p.x, p.y, p.r1 + (p.r0 - p.r1) * k, p.width * (0.4 + k), p.color, (left = k));
        else if (p.kind === 'smoke') G.disc(p.x, p.y, p.size * (1.8 - k), p.color || pal.smoke, (left = k * 0.45));
        else if (p.kind === 'chip') {
          // fillRect(-size / 2, -size / 2, size, size * 0.7), turned: its middle sits 0.15 size off the turn.
          const a = p.spin * (1 - k) * 3;
          G.box(p.x + 0.15 * p.size * Math.sin(a), p.y - 0.15 * p.size * Math.cos(a), p.size / 2, p.size * 0.35, a, p.color, (left = Math.min(1, k * 1.5)));
        } else G.box(p.x, p.y, p.size / 2, p.size / 2, 0, p.color, (left = Math.min(1, k * 1.5)));
      }
    }
  }

  /**
   * Draws a frame. opts: aim (angle or null) shows the aiming guide, reticle ({ x, y }
   * or null) marks where the player points, beacon (0-1) rings the player's tank, and cells
   * ([{ c, r, kind }]) rings cells for the map editor.
   */
  function draw(s, opts = {}) {
    if (!s || !view.w) return;
    lastFrame = { s, opts };
    if (!pal) readPalette();
    if (floorKey !== keyFor(s)) buildFloor(s);
    if (G) {
      drawGL(s, opts);
      return;
    }
    const { aim = null, reticle = null, beacon = 0, cells = null } = opts;
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

    drawLasers(s, calm, fx2d);
    embers((x, y, heat) => ember((ex, ey, r, col, a) => glow(ctx, ex, ey, r, col, a), x, y, heat));

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

