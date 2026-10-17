// Ktan's art: the island, its pieces, the cards and the dice, drawn as the design proposals page
// draws them (KTAN.md B8, and the proposals page it links). Everything is lit by one light from
// the viewer's top left, with soft shadows down and to the right and no ink outlines. The island is
// a plane tilted toward its viewer (depth foreshortened to K, heights straight up); everything that
// stands on it is a small 3D model in that projection, painted once per angle as a sprite and laid
// where it stands. Measured in R, a tile's corner radius. Drawing only: this module draws on the
// contexts it is given, or on canvases it makes for its own kept pictures.
// ---------------------------------------------------------------------------------------------
// Core: numbers, colour, the board's projection, soft shadows, sprite cache and a tiny oblique
// 3D renderer for buildings. Everything is measured in R, a tile's corner radius.
// ---------------------------------------------------------------------------------------------
// The pixel ratio pictures are painted at: the screen's, at most 3 (the table sets 2).
let DPR = Math.min(globalThis.devicePixelRatio || 1, 3);
export const setDPR = (d) => { DPR = d; };
export const getDPR = () => DPR;
export const K = 0.68;                 // depth foreshortening (B8)
export const TAU = Math.PI * 2, S3 = Math.sqrt(3);
export const RT = 0.33;                // number token radius
export const RC = 0.40;                // clearing round the token
export const EDGE = 0.11;              // strip kept clear along every edge, for roads
export const FOOT = 0.27;              // footing kept clear round every corner, for buildings
export const SLAB = 0.08;              // tile thickness
export const GAP = 0.028;              // seam between tiles
export const SERIF = 'ui-serif, "New York", "Iowan Old Style", Georgia, serif';
export const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, sans-serif';

export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap = (a) => ((a % TAU) + TAU) % TAU;

export function rgbOf(c) {
  if (Array.isArray(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixC(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
}
export function css(c, a = 1) {
  const C = rgbOf(c);
  return `rgba(${clamp(Math.round(C[0]), 0, 255)},${clamp(Math.round(C[1]), 0, 255)},${clamp(Math.round(C[2]), 0, 255)},${a})`;
}
export function scaleC(c, k) { const C = rgbOf(c); return [C[0] * k, C[1] * k, C[2] * k]; }
export function lumOf(c) { const C = rgbOf(c); return (0.3 * C[0] + 0.59 * C[1] + 0.11 * C[2]) / 255; }
// A surface under the one light: shade leans cool, full light leans warm (as Tanks does).
export function litC(base, k) {
  let c = scaleC(base, k);
  if (k < 0.82) c = mixC(c, [36, 32, 66], (0.82 - k) * 0.45);
  if (k > 0.98) c = mixC(c, [255, 244, 222], Math.min(0.5, (k - 0.98) * 1.1));
  return c;
}

// ---- hex geometry (pointy top: corner i at -90 + 60i degrees) ----
export const cornerAt = (i, r = 1) => { const a = (-90 + 60 * i) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
export const CORNERS = [0, 1, 2, 3, 4, 5].map((i) => cornerAt(i));
export const hexDist = (x, y) => Math.max(Math.abs(x), Math.abs(0.5 * x + 0.866 * y), Math.abs(-0.5 * x + 0.866 * y));
export const axial = (q, r) => [S3 * (q + r / 2), 1.5 * r];
export function hexRound(p, cx, cy, r, rr) {
  const pts = CORNERS.map(([x, y]) => [cx + x * r, cy + y * r]);
  const t = rr / r;
  for (let i = 0; i < 6; i++) {
    const c = pts[i], pr = pts[(i + 5) % 6], nx = pts[(i + 1) % 6];
    const a = [c[0] + (pr[0] - c[0]) * t, c[1] + (pr[1] - c[1]) * t];
    const b = [c[0] + (nx[0] - c[0]) * t, c[1] + (nx[1] - c[1]) * t];
    if (i === 0) p.moveTo(a[0], a[1]); else p.lineTo(a[0], a[1]);
    p.quadraticCurveTo(c[0], c[1], b[0], b[1]);
  }
  p.closePath();
  return p;
}
// The same rounded hex as a polygon (three points per corner), with each edge's outward normal.
export function hexPoly(r, rr) {
  const t = rr / r, pts = [];
  for (let i = 0; i < 6; i++) {
    const c = CORNERS[i].map((v) => v * r), pr = CORNERS[(i + 5) % 6].map((v) => v * r), nx = CORNERS[(i + 1) % 6].map((v) => v * r);
    const a = [c[0] + (pr[0] - c[0]) * t, c[1] + (pr[1] - c[1]) * t];
    const b = [c[0] + (nx[0] - c[0]) * t, c[1] + (nx[1] - c[1]) * t];
    pts.push(a, [0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]], b);
  }
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    return { p, n: [dy / l, -dx / l] };
  });
}
export const TILE_POLY = hexPoly(1 - GAP, 0.09);

// ---- the projection ----------------------------------------------------------------------
// A seat looks across the table from angle phi (0 = the bottom edge, 90 = the left, 180 = the
// top, 270 = the right). Ground (table) coordinates turn into the seat's frame and their depth
// foreshortens by K; heights stand straight up. The island never moves on the table: a new seat
// only changes the frame it is drawn in.
export function makeView(phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return {
    phi, c, s,
    p: (x, y) => [c * x + s * y, (-s * x + c * y) * K],
    d: (x, y) => -s * x + c * y,
    rot: (x, y) => [c * x + s * y, -s * x + c * y],
  };
}
// Draw something lying flat on the ground (sea, tile tops, roads), `lift` above the table.
export function onGround(ctx, v, lift, fn) {
  ctx.save();
  ctx.translate(0, -lift);
  ctx.scale(1, K);
  ctx.rotate(-v.phi);
  fn();
  ctx.restore();
}

// ---- soft shadows that work in every browser (shadowBlur, shape pushed off canvas) ----------
export function softFill(ctx, path, color, blur) {
  const m = ctx.getTransform();
  const det = m.a * m.d - m.b * m.c;
  if (!det) return;
  const D = 6000;
  ctx.save();
  ctx.translate(-D * m.d / det, D * m.b / det);
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(0.5, blur * Math.sqrt(Math.abs(det)));
  ctx.shadowOffsetX = D;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#000';
  ctx.fill(path);
  ctx.restore();
}
export function ellipsePath(x, y, rx, ry) { const p = new Path2D(); p.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), 0, 0, TAU); return p; }
export function polyPath(pts, p = new Path2D()) { pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; }
export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
export function rrectPath(x, y, w, h, r) { const p = new Path2D(); rrect(p, x, y, w, h, r); return p; }
export function circle(g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, Math.max(1e-4, r), 0, TAU); }
export function fillCircles(g, list, color) { g.beginPath(); list.forEach(([x, y, r]) => circle(g, x, y, r)); g.fillStyle = color; g.fill(); }
export function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
// ---- sprites: everything that stands is painted once, upright, and laid where it stands ----
export const SPRITES = new Map();
// Phones cap the memory all canvases together may use; the table (an iPad, swinging its view round)
// keeps more.
let SPRITE_CAP = 2600;
export const setSpriteCap = (n) => { SPRITE_CAP = n; };
export function spriteOf(key, sc, box, draw) {
  const k = key + '@' + Math.round(sc);
  let s = SPRITES.get(k);
  if (s) return s;
  const p = 0.03;
  const c = canvasOf((box[2] - box[0] + 2 * p) * sc, (box[3] - box[1] + 2 * p) * sc);
  const g = c.getContext('2d');
  g.setTransform(sc, 0, 0, sc, (p - box[0]) * sc, (p - box[1]) * sc);
  g.lineCap = 'round'; g.lineJoin = 'round';
  draw(g);
  s = { c, ax: p - box[0], ay: p - box[1], w: c.width / sc, h: c.height / sc };
  SPRITES.set(k, s);
  // Keep the cache bounded: phones cap the memory all canvases together may use.
  if (SPRITES.size > SPRITE_CAP) { let n = 0; for (const key of SPRITES.keys()) { if (n++ >= 400) break; const old = SPRITES.get(key); old.c.width = old.c.height = 0; SPRITES.delete(key); } }
  return s;
}

// ---- a tiny oblique 3D renderer --------------------------------------------------------------
// Model space: x across, y toward the viewer, z up; a point lands at (x, K y - z), the board's own
// projection. Faces carry their outward normal; a face shows when it turns toward the viewer.
// Decals are drawn in a face's own plane (u to the right as seen from outside, v downward).
export const LV = (() => { const v = [-0.55, 0.3, 0.78], l = Math.hypot(...v); return v.map((x) => x / l); })();
export function lightOf(n) { return clamp(0.62 + 0.55 * (n[0] * LV[0] + n[1] * LV[1] + n[2] * LV[2]), 0.42, 1.16); }
export const P3 = (q) => [q[0], K * q[1] - q[2]];
export function rotZ(rho) { const c = Math.cos(rho), s = Math.sin(rho); return (p) => [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; }
export function drawPart(g, part, rho) {
  const R = rotZ(rho), vis = [];
  for (const f of part) {
    const n = R(f.n);
    if (n[1] + K * n[2] <= 0.004) continue;
    const pts = f.p.map(R);
    const depth = pts.reduce((a, q) => a + q[1] + K * q[2], 0) / pts.length;
    vis.push({ f, n, pts, depth });
  }
  vis.sort((a, b) => (a.f.layer || 0) - (b.f.layer || 0) || a.depth - b.depth);
  for (const v of vis) {
    const k = lightOf(v.n);
    g.beginPath();
    v.pts.forEach((q, i) => { const s = P3(q); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); });
    g.closePath();
    g.fillStyle = css(litC(v.f.col, k * (v.f.gain || 1)));
    g.fill();
    g.lineWidth = 0.003; g.strokeStyle = css(litC(v.f.col, k * (v.f.gain || 1))); g.stroke();
    if (v.f.decal) {
      const o = P3(R(v.f.o)), u = R(v.f.u), w = R(v.f.v);
      g.save();
      g.transform(u[0], K * u[1] - u[2], w[0], K * w[1] - w[2], o[0], o[1]);
      v.f.decal(g, k);
      g.restore();
    }
  }
}
// Parts of one building, back to front.
export function drawParts(g, parts, rho) {
  const R = rotZ(rho);
  const order = parts.map((part) => {
    const c = part.center || [0, 0, 0];
    return { part, d: part.ground ? -1e3 : R(c)[1] };
  }).sort((a, b) => a.d - b.d);
  order.forEach(({ part }) => (part.prims ? drawSolid(g, part.prims, rho) : drawPart(g, part.faces, rho)));
}
// Shadow of a building on the ground: every face pushed down and to the right by its height.
export function partsShadow(parts, rho) {
  const R = rotZ(rho), path = new Path2D();
  parts.forEach((part) => part.prims && path.addPath(solidShadow(part.prims, rho)));
  parts.forEach((part) => (part.faces || []).forEach((f) => {
    const pts = f.p.map(R).map((q) => [q[0] + 0.55 * q[2], K * q[1] + 0.28 * q[2]]);
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(a) < 1e-7) return;
    polyPath(a > 0 ? pts : pts.slice().reverse(), path);
  }));
  return path;
}
// Box faces with decal frames (front = +y as seen from the bottom seat).
export function boxFaces(x0, x1, y0, y1, z0, z1, col, opt = {}) {
  const F = [];
  const face = (p, n, o, u, v, decal, extra) => F.push({ p, n, o, u, v, decal, col, layer: opt.layer || 0, ...(extra || {}) });
  face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], [x0, y1, z1], [1, 0, 0], [0, 0, -1], opt.front);
  face([[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]], [0, -1, 0], [x1, y0, z1], [-1, 0, 0], [0, 0, -1], opt.back);
  face([[x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]], [1, 0, 0], [x1, y1, z1], [0, -1, 0], [0, 0, -1], opt.right);
  face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], [x0, y0, z1], [0, 1, 0], [0, 0, -1], opt.left);
  if (opt.top !== false) face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [x0, y0, z1], [1, 0, 0], [0, 1, 0], opt.top, opt.topCol ? { col: opt.topCol } : null);
  return F;
}

// ---- marks (colour is never the only clue) ---------------------------------------------------
export function markPath(kind, cx, cy, s) {
  const p = new Path2D(), h = s / 2;
  if (kind === 'diamond') polyPath([[cx, cy - h], [cx + h * 0.8, cy], [cx, cy + h], [cx - h * 0.8, cy]], p);
  else if (kind === 'circle') p.arc(cx, cy, h * 0.85, 0, TAU);
  else if (kind === 'triangle') polyPath([[cx, cy - h], [cx + h, cy + h * 0.75], [cx - h, cy + h * 0.75]], p);
  else if (kind === 'square') p.rect(cx - h * 0.75, cy - h * 0.75, h * 1.5, h * 1.5);
  else if (kind === 'plus') { const t = h * 0.36; polyPath([[cx - t, cy - h], [cx + t, cy - h], [cx + t, cy - t], [cx + h, cy - t], [cx + h, cy + t], [cx + t, cy + t], [cx + t, cy + h], [cx - t, cy + h], [cx - t, cy + t], [cx - h, cy + t], [cx - h, cy - t], [cx - t, cy - t]], p); }
  else { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? h * 0.42 : h; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } polyPath(pts, p); }
  return p;
}

// ---- easing ----------------------------------------------------------------------------------
// cubic-bezier(x1, y1, x2, y2) solved by Newton steps, as CSS does.
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-5 || !d) break; t -= e / d; }
    return Y(clamp(t, 0, 1));
  };
}
export const easeInOut = bezier(0.77, 0, 0.175, 1);   // things moving on screen
export const easeOut = bezier(0.23, 1, 0.32, 1);      // things arriving
// ---------------------------------------------------------------------------------------------
// Everything that stands on the island is a small 3D model in the board's projection (x across,
// y toward the seat, z up), never a picture stood on end. A seat sees it from its own side: the
// model turns by `rho` (its heading less the seat's angle) and every facet is lit again by the one
// light, which stays at the top left of whoever is looking. Round domes (kilns, mounds, haystacks)
// are drawn as shaded volumes with their courses as true horizontal rings.
// ---------------------------------------------------------------------------------------------
export const T = {};
export function domePath(x, y, rx, ry) { const p = new Path2D(); p.moveTo(x - rx, y); p.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), 0, Math.PI, TAU); p.closePath(); return p; }
export function lensPath(bx, by, tx, ty, wd, p = new Path2D()) {
  const mx = (bx + tx) / 2, my = (by + ty) / 2, dx = tx - bx, dy = ty - by, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l * wd, ny = dx / l * wd;
  p.moveTo(bx, by); p.quadraticCurveTo(mx + nx, my + ny, tx, ty); p.quadraticCurveTo(mx - nx, my - ny, bx, by); p.closePath();
  return p;
}
export function line(g, pts, color, w) { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.strokeStyle = color; g.lineWidth = w; g.stroke(); }

// ---- solids --------------------------------------------------------------------------------
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function newell(pts, out) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const l = Math.hypot(n[0], n[1], n[2]) || 1, m = n.map((v) => v / l);
  return out && dot3(m, out) < 0 ? m.map((v) => -v) : m;
}
export const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
// Outward from the vertical axis through (0, 0), tipped up a little.
export const outward = (pts) => { const c = centroid(pts); return [c[0], c[1], 0.45 * (Math.abs(c[2]) + 0.02)]; };
export function poly(P, pts, col, hint, extra) { P.push({ k: 'poly', p: pts, n: newell(pts, hint || outward(pts)), col: rgbOf(col), ...(extra || {}) }); }
export function ball(P, c, r, col, extra) { P.push({ k: 'ball', c, r, col: rgbOf(col), ...(extra || {}) }); }
export function stick(P, a, b, w, col) { P.push({ k: 'line', a, b, w, col: rgbOf(col) }); }
export function ringAt(n, rad, z, r, o = {}) {
  const off = o.off ?? 0, cx = o.cx || 0, cy = o.cy || 0;
  return Array.from({ length: n }, (_, i) => {
    const a = off + (i + (o.ja ? (r() - 0.5) * o.ja : 0)) * TAU / n, rr = rad * (1 + (o.jr ? (r() - 0.5) * o.jr : 0));
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (o.sq || 1), z + (o.jz ? (r() - 0.5) * o.jz : 0) - (o.droop ? r() * o.droop : 0)];
  });
}
export function bandTris(A, B) { const n = A.length, out = []; for (let i = 0; i < n; i++) { const j = (i + 1) % n; out.push([A[i], A[j], B[j]], [A[i], B[j], B[i]]); } return out; }
export function fanTris(A, top) { return A.map((p, i) => [p, A[(i + 1) % A.length], top]); }
export function frustum(P, cx, cy, z0, z1, r0, r1, seg, col, o = {}) {
  const A = ringAt(seg, r0, z0, null, { cx, cy, off: o.off || 0 }), B = ringAt(seg, r1, z1, null, { cx, cy, off: o.off || 0 });
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg, pts = [A[i], A[j], B[j], B[i]], c = centroid(pts); poly(P, pts, typeof col === 'function' ? col(i) : col, [c[0] - cx, c[1] - cy, 0]); }
  if (o.cap) poly(P, B.slice(), o.cap, [0, 0, 1]);
  return B;
}
export function cone(P, cx, cy, z0, z1, rad, seg, col, r, o = {}) {
  const A = ringAt(seg, rad, z0, r, { cx, cy, off: r() * TAU, jr: o.jit || 0, droop: o.droop || 0 });
  const top = [cx + (r() - 0.5) * rad * 0.12, cy + (r() - 0.5) * rad * 0.12, z1];
  fanTris(A, top).forEach((t, i) => { const c = centroid(t); poly(P, t, typeof col === 'function' ? col(i) : col, [c[0] - cx, c[1] - cy, 0.3 * rad]); });
}
export const jit = (col, r, a = 0.22) => mixC(col, r() < 0.5 ? [0, 0, 0] : [255, 255, 255], r() * a * 0.5);
export function clipZ(pts, zs, above) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], pin = above ? p[2] >= zs : p[2] < zs, qin = above ? q[2] >= zs : q[2] < zs;
    if (pin) out.push(p);
    if (pin !== qin) { const t = (zs - p[2]) / (q[2] - p[2]); out.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t), zs]); }
  }
  return out;
}
// A jetty's deck height and its piles (along it, across it, and whether it stands up as a mooring post).
export const JETTY = { deck: 0.095, piles: [[0.16, -0.1], [0.16, 0.1], [0.38, -0.1], [0.38, 0.1], [0.6, -0.1], [0.6, 0.1], [0.66, -0.2, 1], [0.66, 0.2, 1], [0.83, -0.2], [0.83, 0.2], [1.0, -0.2, 1], [1.0, 0.2, 1], [1.0, 0]] };
export const PCOL = {
  trunk: [76, 52, 34], pine: [47, 112, 66], leaf: [62, 136, 78], wool: [238, 232, 219], face: [43, 38, 34], hay: [214, 166, 64],
  rock: { grey: [116, 126, 142], sand: [160, 142, 108], clay: [170, 92, 62] }, peak: [118, 128, 145], snow: [240, 244, 249],
  bush: { forest: [44, 104, 60], hills: [126, 138, 68], desert: [122, 138, 78], pasture: [104, 156, 68] },
  crystal: [178, 196, 218], timber: [122, 90, 58], white: [232, 224, 207], thatch: [124, 86, 52], sail: [238, 228, 206],
  coat: [91, 107, 125], burlap: [207, 180, 124], hat: [74, 52, 36], pole: [109, 76, 46], stone: [214, 197, 154], sand: [214, 188, 136], cactus: [76, 124, 64],
};
export const BUILD = {
  pine(o) {
    const h = o.h, r = rng(o.seed * 31 + 7), P = [];
    frustum(P, 0, 0, 0, h * 0.24, h * 0.05, h * 0.032, 7, PCOL.trunk);
    for (let i = 0; i < 4; i++) {
      const z0 = h * (0.13 + 0.205 * i), rad = h * 0.29 * (1 - 0.2 * i), th = h * (0.37 - 0.03 * i);
      cone(P, (r() - 0.5) * h * 0.02, (r() - 0.5) * h * 0.02, z0, z0 + th, rad, 11, () => jit(PCOL.pine, r, 0.3), r, { jit: 0.16, droop: h * 0.05 });
    }
    return P;
  },
  broadleaf(o) {
    const h = o.h, r = rng(o.seed * 17 + 3), P = [];
    frustum(P, 0, 0, 0, h * 0.5, h * 0.05, h * 0.032, 7, PCOL.trunk);
    stick(P, [0, 0, h * 0.38], [h * 0.12, h * 0.05, h * 0.56], h * 0.03, PCOL.trunk);
    stick(P, [0, 0, h * 0.42], [-h * 0.1, -h * 0.07, h * 0.6], h * 0.03, PCOL.trunk);
    ball(P, [0, 0, h * 0.64], h * 0.25, PCOL.leaf, { speck: 1 });
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5 + r() * 0.6, d = h * (0.16 + r() * 0.04);
      ball(P, [Math.cos(a) * d, Math.sin(a) * d, h * (0.55 + r() * 0.12)], h * (0.15 + r() * 0.04), jit(PCOL.leaf, r, 0.25), { speck: 1 });
    }
    ball(P, [(r() - 0.5) * h * 0.06, (r() - 0.5) * h * 0.06, h * 0.82], h * 0.15, PCOL.leaf, { speck: 1 });
    return P;
  },
  bush(o) {
    const h = o.h, r = rng(o.seed * 7 + 2), P = [], col = PCOL.bush[o.pal || 'forest'];
    ball(P, [0, 0, h * 0.5], h * 0.48, col, { speck: 1 });
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + r(); ball(P, [Math.cos(a) * h * 0.42, Math.sin(a) * h * 0.42, h * 0.34], h * 0.33, jit(col, r), { speck: 1 }); }
    return P;
  },
  rock(o) {
    const h = o.h, w = o.w, r = rng(o.seed * 11 + 5), P = [], col = PCOL.rock[o.pal || 'grey'], off = r() * TAU;
    const A = ringAt(7, w / 2, 0, r, { off, ja: 0.4, jr: 0.35, sq: 0.85 }), B = ringAt(7, w * 0.3, h * 0.6, r, { off: off + 0.3, ja: 0.4, jr: 0.4, jz: h * 0.25, sq: 0.85 });
    [...bandTris(A, B), ...fanTris(B, [(r() - 0.5) * w * 0.1, (r() - 0.5) * w * 0.1, h])].forEach((t) => poly(P, t, jit(col, r, 0.3)));
    return P;
  },
  peak(o) {
    const h = o.h, w = o.w, r = rng(o.seed * 53 + 11), P = [], off = r() * TAU;
    const R0 = ringAt(9, w * 0.5, 0, r, { off, ja: 0.45, jr: 0.32, sq: 0.9 });
    const R1 = ringAt(9, w * 0.31, h * 0.42, r, { off: off + 0.2, ja: 0.45, jr: 0.5, jz: h * 0.16, sq: 0.9 });
    const R2 = ringAt(9, w * 0.13, h * 0.76, r, { off: off + 0.4, ja: 0.5, jr: 0.6, jz: h * 0.1, sq: 0.9 });
    const apex = [(r() - 0.5) * w * 0.1, (r() - 0.5) * w * 0.08, h], zs = h * (0.58 + r() * 0.06);
    [...bandTris(R0, R1), ...bandTris(R1, R2), ...fanTris(R2, apex)].forEach((t) => {
      const hint = outward(t), n = newell(t, hint), z = zs + (r() - 0.5) * h * 0.1;
      const lo = clipZ(t, z, false), hi = clipZ(t, z, true);
      if (lo.length > 2) P.push({ k: 'poly', p: lo, n, col: mixC(PCOL.peak, r() < 0.5 ? [86, 94, 110] : [160, 168, 182], r() * 0.4) });
      if (hi.length > 2) P.push({ k: 'poly', p: hi, n, col: mixC(PCOL.snow, [196, 206, 222], r() * 0.3) });
    });
    return P;
  },
  crystal(o) {
    const h = o.h, r = rng(o.seed * 19 + 4), P = [];
    const A = ringAt(7, h * 0.55, 0, r, { ja: 0.3, jr: 0.3, sq: 0.8 }), B = ringAt(7, h * 0.3, h * 0.18, r, { ja: 0.3, jr: 0.3, sq: 0.8 });
    [...bandTris(A, B), ...fanTris(B, [0, 0, h * 0.24])].forEach((t) => poly(P, t, jit([80, 88, 104], r)));
    [[-0.28, 0.05, 0.62, 0.1, -0.35, 0.2], [0.28, -0.05, 0.7, 0.11, 0.3, -0.25], [0.02, 0.0, 1.0, 0.14, 0.05, 0.12]].forEach(([bx, by, len, rad, lx, ly]) => {
      const ax = [lx, ly, 1], al = Math.hypot(...ax), d = ax.map((v) => v / al);
      const e1n = [d[2], 0, -d[0]], e1l = Math.hypot(...e1n), e1 = e1n.map((v) => v / e1l), e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
      const at = (t, ang, rr) => [bx * h + d[0] * t + (e1[0] * Math.cos(ang) + e2[0] * Math.sin(ang)) * rr, by * h + d[1] * t + (e1[1] * Math.cos(ang) + e2[1] * Math.sin(ang)) * rr, d[2] * t + (e1[2] * Math.cos(ang) + e2[2] * Math.sin(ang)) * rr];
      const L = len * h, R = rad * h, base = [], mid = [];
      for (let i = 0; i < 6; i++) { base.push(at(0, i * TAU / 6, R)); mid.push(at(L * 0.76, i * TAU / 6, R)); }
      const tip = at(L, 0, 0), axisAt = (p) => { const t = dot3([p[0] - bx * h, p[1] - by * h, p[2]], d); return [bx * h + d[0] * t, by * h + d[1] * t, d[2] * t]; };
      const face = (pts) => { const c = centroid(pts), a = axisAt(c); poly(P, pts, jit(PCOL.crystal, r, 0.35), [c[0] - a[0], c[1] - a[1], c[2] - a[2]]); };
      for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; face([base[i], base[j], mid[j], mid[i]]); face([mid[i], mid[j], tip]); }
    });
    return P;
  },
  mine(o) {
    // A shaft head: a timber headframe with its wheel over a square shaft, an ore cart at the head of the
    // rails. It stands in a pass in the ring of peaks and is open all round, so the mine reads from
    // every seat (a mouth cut into a hillside only shows from the side it faces).
    const h = o.h, P = [], T = PCOL.timber, Td = [92, 66, 42], s = 0.038, t = 0.012, top = h * 0.6;
    // the collar round the shaft, dark inside
    boxFaces(-s - 0.008, s + 0.008, -s - 0.008, s + 0.008, 0, t, Td, { topCol: [146, 110, 72] }).forEach((f) => P.push({ k: 'poly', ...f }));
    const hz = t + 0.0006, hs = s * 0.62;
    poly(P, [[-hs, -hs, hz], [hs, -hs, hz], [hs, hs, hz], [-hs, hs, hz]], [8, 8, 12], [0, 0, 1], { flat: true, bias: 0.004 });
    // four legs leaning in to the head, braced round their middle and crossed on each side
    const foot = [[-s, -s], [s, -s], [s, s], [-s, s]], at = (i, f) => [lerp(foot[i][0], foot[i][0] * 0.32, f), lerp(foot[i][1], foot[i][1] * 0.32, f), lerp(t, top, f)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      stick(P, at(i, 0), at(i, 1), 0.0075, T);
      stick(P, at(i, 0.5), at(j, 0.5), 0.005, Td);
      stick(P, at(i, 0.04), at(j, 0.5), 0.004, Td);
    }
    boxFaces(-s * 0.42, s * 0.42, -s * 0.42, s * 0.42, top, top + 0.006, Td, { topCol: [150, 114, 76] }).forEach((f) => P.push({ k: 'poly', ...f }));
    // the winding wheel on its two posts
    const rw = Math.min(0.016, (h - top - 0.008) / 2), wz = top + 0.006 + rw;
    stick(P, [0, -s * 0.3, top + 0.006], [0, -s * 0.3, wz], 0.004, Td);
    stick(P, [0, s * 0.3, top + 0.006], [0, s * 0.3, wz], 0.004, Td);
    const rim = Array.from({ length: 12 }, (_, i) => { const a = i * TAU / 12; return [Math.cos(a) * rw, 0, wz + Math.sin(a) * rw]; });
    rim.forEach((p, i) => stick(P, p, rim[(i + 1) % 12], 0.0035, [70, 50, 32]));
    [0, 3].forEach((i) => stick(P, rim[i], rim[i + 6], 0.0025, [70, 50, 32]));
    // an ore cart on the rails, toward the clearing (+x), heaped with ore
    const cx0 = s + 0.018, cx1 = s + 0.056;
    boxFaces(cx0, cx1, -0.016, 0.016, 0.008, 0.03, [70, 74, 84], { topCol: [44, 46, 52] }).forEach((f) => P.push({ k: 'poly', ...f }));
    [[cx0 + 0.007, -0.017], [cx1 - 0.007, -0.017], [cx0 + 0.007, 0.017], [cx1 - 0.007, 0.017]].forEach(([x, y]) => ball(P, [x, y, 0.007], 0.0065, [34, 34, 38]));
    [[cx0 + 0.011, -0.006, 0.032, 0.0095], [cx1 - 0.01, 0.006, 0.032, 0.009], [(cx0 + cx1) / 2, 0, 0.037, 0.0085]].forEach(([x, y, z, rr]) => ball(P, [x, y, z], rr, [112, 132, 164]));
    // a lantern on a post at the corner
    stick(P, [-s - 0.012, s + 0.014, 0], [-s - 0.012, s + 0.014, h * 0.62], 0.006, [59, 43, 29]);
    ball(P, [-s - 0.012, s + 0.014, h * 0.62 + 0.007], 0.01, [255, 213, 138], { glow: 1 });
    return P;
  },
  sheep(o) {
    const s = o.s || 1, r = rng(o.seed * 5 + 2), P = [];
    [[0.032, 0.017], [0.032, -0.017], [-0.034, 0.017], [-0.034, -0.017]].forEach(([lx, ly]) => stick(P, [lx * s, ly * s, 0], [lx * s, ly * s, 0.045 * s], 0.012 * s, PCOL.face));
    [[-0.036, 0, 0.066, 0.037], [0, 0, 0.07, 0.041], [0.03, 0, 0.067, 0.035]].forEach(([x, y, z, rr]) => ball(P, [x * s, y * s, z * s], rr * s, PCOL.wool));
    for (let i = 0; i < 7; i++) { const x = -0.05 + r() * 0.085, a = r() * Math.PI; ball(P, [x * s, Math.cos(a) * 0.026 * s, (0.074 + Math.sin(a) * 0.026) * s], 0.016 * s, jit(PCOL.wool, r, 0.1)); }
    ball(P, [0.069 * s, 0, 0.078 * s], 0.021 * s, PCOL.face, { dark: 1 });
    ball(P, [0.06 * s, 0.022 * s, 0.088 * s], 0.009 * s, PCOL.face, { dark: 1 });
    ball(P, [0.06 * s, -0.022 * s, 0.088 * s], 0.009 * s, PCOL.face, { dark: 1 });
    ball(P, [0.056 * s, 0, 0.098 * s], 0.013 * s, PCOL.wool);
    return P;
  },
  bale(o) {
    const s = o.s || 1, rr = 0.036 * s, L = 0.064 * s, seg = 14, r = rng(o.seed * 7 + 1), P = [];
    const pt = (t, y) => [rr * Math.cos(t), y, rr + rr * Math.sin(t)];
    const straw = (seed) => (g) => {
      const q = rng(seed), wd = TAU * rr / seg;
      for (let k = 0; k < 9; k++) {
        const y = q() * wd, x0 = q() * L * 0.3, x1 = x0 + L * (0.35 + q() * 0.5);
        g.strokeStyle = q() < 0.5 ? 'rgba(255,236,170,0.55)' : 'rgba(120,80,20,0.45)'; g.lineWidth = rr * 0.05;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(Math.min(L, x1), y + (q() - 0.5) * wd * 0.4); g.stroke();
      }
    };
    for (let i = 0; i < seg; i++) {
      const t0 = i * TAU / seg, t1 = (i + 1) * TAU / seg, tm = (t0 + t1) / 2;
      poly(P, [pt(t0, -L / 2), pt(t1, -L / 2), pt(t1, L / 2), pt(t0, L / 2)], jit(PCOL.hay, r, 0.25), [Math.cos(tm), 0, Math.sin(tm)], { o: pt(t0, -L / 2), u: [0, 1, 0], v: [-Math.sin(t0), 0, Math.cos(t0)], decal: straw(o.seed * 31 + i) });
    }
    const spiral = (g) => {
      g.fillStyle = 'rgba(120,80,20,0.35)'; g.beginPath(); circle(g, 0, 0, rr * 0.25); g.fill();
      g.strokeStyle = 'rgba(128,86,22,0.85)'; g.lineWidth = rr * 0.09; g.beginPath();
      for (let a = 0; a < 5 * TAU; a += 0.2) { const q = rr * 0.94 * a / (5 * TAU); a ? g.lineTo(Math.cos(a) * q, Math.sin(a) * q) : g.moveTo(0, 0); }
      g.stroke();
      g.strokeStyle = 'rgba(255,240,190,0.5)'; g.lineWidth = rr * 0.035; g.beginPath();
      for (let a = 0.6; a < 5 * TAU; a += 0.2) { const q = rr * 0.94 * a / (5 * TAU) + rr * 0.05; a > 0.65 ? g.lineTo(Math.cos(a) * q, Math.sin(a) * q) : g.moveTo(Math.cos(a) * q, Math.sin(a) * q); }
      g.stroke();
    };
    [[L / 2, 1], [-L / 2, -1]].forEach(([y, sg]) => poly(P, Array.from({ length: seg }, (_, i) => pt(i * TAU / seg, y)), [230, 192, 102], [0, sg, 0], { o: [0, y, rr], u: [sg, 0, 0], v: [0, 0, -1], decal: spiral }));
    return P;
  },
  windmill(o) {
    const h = o.h, P = [], seg = 12, r0 = h * 0.17, r1 = h * 0.11, zt = h * 0.62;
    const A = ringAt(seg, r0, 0, null, { off: Math.PI / seg }), B = ringAt(seg, r1, zt, null, { off: Math.PI / seg });
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg, pts = [A[i], A[j], B[j], B[i]], c = centroid(pts), front = Math.abs(Math.atan2(c[1], c[0])) < Math.PI / seg;
      const extra = front ? {
        o: B[j], u: (() => { const d = [B[i][0] - B[j][0], B[i][1] - B[j][1], 0], l = Math.hypot(d[0], d[1]); return [d[0] / l, d[1] / l, 0]; })(),
        v: (() => { const d = [A[j][0] - B[j][0], A[j][1] - B[j][1], A[j][2] - B[j][2]], l = Math.hypot(...d); return d.map((x) => x / l); })(),
        decal: (g) => {
          const wd = Math.hypot(B[i][0] - B[j][0], B[i][1] - B[j][1]), ht = Math.hypot(A[j][0] - B[j][0], A[j][1] - B[j][1], zt);
          const dw = h * 0.065, dh = h * 0.13;
          g.fillStyle = '#3a2a1e'; g.beginPath(); g.moveTo(wd / 2 - dw / 2, ht); g.lineTo(wd / 2 - dw / 2, ht - dh + dw / 2); g.arc(wd / 2, ht - dh + dw / 2, dw / 2, Math.PI, TAU); g.lineTo(wd / 2 + dw / 2, ht); g.fill();
          g.fillStyle = '#ffd27a'; g.fillRect(wd / 2 - h * 0.018, ht * 0.32, h * 0.036, h * 0.05);
        },
      } : null;
      poly(P, pts, mixC(PCOL.white, [150, 140, 122], (i % 3) * 0.04), [c[0], c[1], 0], extra);
    }
    cone(P, 0, 0, zt - h * 0.01, zt + h * 0.21, r1 * 1.35, 12, PCOL.thatch, rng(o.seed + 3), {});
    const hub = [h * 0.16, 0, h * 0.74];
    ball(P, hub, h * 0.035, [61, 42, 30], { dark: 1, bias: 0.02 });
    for (let i = 0; i < 4; i++) {
      const th = 0.4 + i * Math.PI / 2, d = [0, Math.cos(th), Math.sin(th)], wv = [0, -Math.sin(th), Math.cos(th)];
      const q = (rr, wd) => [hub[0] + 0.002, hub[1] + d[1] * rr + wv[1] * wd, hub[2] + d[2] * rr + wv[2] * wd];
      const ra = h * 0.09, rb = h * 0.54, bw = h * 0.1;
      P.push({
        k: 'poly', p: [q(ra, 0.004), q(rb, 0.004), q(rb, bw), q(ra, bw)], n: [1, 0, 0], both: true, col: PCOL.sail, bias: 0.02,
        o: q(ra, 0), u: d, v: wv, decal: (g) => { g.strokeStyle = 'rgba(90,64,44,0.8)'; g.lineWidth = h * 0.012; g.beginPath(); for (let k = 0; k <= 4; k++) { const x = (rb - ra) * k / 4; g.moveTo(x, 0); g.lineTo(x, bw); } g.moveTo(0, bw); g.lineTo(rb - ra, bw); g.stroke(); },
      });
      stick(P, hub, q(rb * 1.03, 0), h * 0.024, [90, 64, 48]);
    }
    return P;
  },
  scarecrow(o) {
    const h = o.h, P = [];
    stick(P, [0, 0, 0], [0, 0, h * 0.86], h * 0.05, PCOL.pole);
    stick(P, [0, -h * 0.36, h * 0.63], [0, h * 0.36, h * 0.63], h * 0.04, PCOL.pole);
    P.push({ k: 'poly', p: [[0.004, -h * 0.3, h * 0.65], [0.004, h * 0.3, h * 0.65], [0.004, h * 0.2, h * 0.3], [0.004, -h * 0.2, h * 0.3]], n: [1, 0, 0], both: true, col: PCOL.coat, bias: 0.01 });
    ball(P, [0, 0, h * 0.76], h * 0.1, PCOL.burlap);
    poly(P, ringAt(10, h * 0.18, h * 0.84, null), PCOL.hat, [0, 0, 1], { bias: 0.02 });
    frustum(P, 0, 0, h * 0.84, h * 0.98, h * 0.09, h * 0.08, 8, PCOL.hat, { cap: [92, 66, 46] });
    return P;
  },
  column(o) {
    const h = o.h, r = rng(o.seed * 29 + 8), P = [];
    frustum(P, 0, 0, 0, 0.02, 0.044, 0.042, 10, mixC(PCOL.stone, [120, 104, 76], 0.25), { cap: PCOL.stone });
    const top = o.broken ? h : h - 0.032;
    const B = frustum(P, 0, 0, 0.02, top, 0.027, 0.024, 10, (i) => (i % 2 ? PCOL.stone : mixC(PCOL.stone, [140, 120, 88], 0.2)));
    if (o.broken) {
      const ring = B.map((p) => [p[0], p[1], p[2] - r() * 0.03]), mz = ring.reduce((a, p) => a + p[2], 0) / ring.length;
      fanTris(ring, [0, 0, mz - 0.004]).forEach((t) => poly(P, t, [236, 222, 186], [0, 0, 1]));
    } else {
      frustum(P, 0, 0, top, top + 0.016, 0.026, 0.04, 10, PCOL.stone);
      boxFaces(-0.044, 0.044, -0.044, 0.044, top + 0.016, h, mixC(PCOL.stone, [255, 250, 236], 0.1)).forEach((f) => P.push({ k: 'poly', ...f, bias: 0.01 }));
    }
    return P;
  },
  jetty() {
    // A jetty on piles: a walk of planks out from the coast to a broad pier head, held over the water on
    // round piles braced in pairs along its sides, each pile dark with weed where it meets the water.
    // The head's corner piles stand above the deck as mooring posts. Out along +x from the coast.
    const P = [], Z = JETTY.deck, TH = 0.014, WOOD = [150, 114, 76], PILE = [96, 72, 50], WEED = [46, 52, 40];
    const r = rng(19), board = (x0, x1, y0, y1) => boxFaces(x0, x1, y0, y1, Z - TH, Z, mixC(WOOD, r() < 0.5 ? [196, 160, 112] : [104, 78, 50], 0.12 + r() * 0.22)).forEach((f) => P.push({ k: 'poly', ...f, bias: 0.004 }));
    for (let x = 0.0; x < 0.6; x += 0.062) board(x, x + 0.054, -0.095, 0.095);
    for (let x = 0.6; x < 1.0; x += 0.062) board(x, x + 0.054, -0.2, 0.2);
    // bearers under the planks, seen along the sides
    [[-0.08, 0, 0.62], [0.08, 0, 0.62], [-0.185, 0.6, 1.0], [0.185, 0.6, 1.0], [0, 0.6, 1.0]].forEach(([y, x0, x1]) => boxFaces(x0, x1, y - 0.012, y + 0.012, Z - TH - 0.022, Z - TH, [86, 64, 44]).forEach((f) => P.push({ k: 'poly', ...f })));
    JETTY.piles.forEach(([x, y, post]) => {
      const pr = 0.021;
      frustum(P, x, y, 0, 0.022, pr * 1.08, pr * 1.02, 9, WEED);
      frustum(P, x, y, 0.022, post ? Z + 0.04 : Z - TH - 0.004, pr * 1.02, pr * 0.94, 9, (i) => mixC(PILE, i % 2 ? [60, 44, 30] : [120, 92, 64], 0.2), { cap: post ? [128, 100, 70] : PILE });
    });
    // braces: a diagonal between each pair of piles along a side
    for (const y of [-0.112, 0.112]) for (const [a, b] of [[0.16, 0.38], [0.38, 0.6]]) stick(P, [a, y, 0.03], [b, y, Z - TH - 0.02], 0.007, [110, 84, 58]);
    for (const y of [-0.215, 0.215]) stick(P, [0.66, y, 0.03], [1.0, y, Z - TH - 0.02], 0.007, [110, 84, 58]);
    P.foot = 0.02;
    return P;
  },
  dune(o) {
    // A crescent dune (a barchan) with the wind at its back, blowing toward +x: a long gentle slope up
    // to a sharp crest, a steep slip face in its lee, and two horns trailing downwind. Each row across
    // the wind is cut at its toe, its crest and its lee, so the crest stays one clean line, and every
    // facet is lit by the way it faces: from any seat the windward slope takes the light and the slip
    // face falls into shade.
    const H = o.h, W = o.w, r = rng(o.seed * 41 + 6), P = [], Ly = W * 0.5, Lw = W * 0.62, Ls = W * 0.17;
    const ny = 18, m1 = 12, m2 = 6, rows = [];
    for (let j = 0; j <= ny; j++) {
      const u = -1 + 2 * j / ny, q = 1 - u * u, hu = H * Math.pow(q, 0.7), y = u * Ly;
      const xc = W * (0.3 * u * u - 0.02), x0 = xc - Lw * (0.4 + 0.6 * q), xe = xc + Ls * (0.3 + 0.7 * q), row = [];
      for (let k = 0; k <= m1; k++) { const t = k / m1; row.push([x0 + (xc - x0) * t, y, hu * Math.pow(Math.sin(t * Math.PI / 2), 1.4)]); }
      for (let k = 1; k <= m2; k++) { const t = k / m2; row.push([xc + (xe - xc) * t, y, hu * Math.pow(1 - t, 1.3)]); }
      rows.push(row);
    }
    const xm = W * -0.1;
    rows.forEach((row) => row.forEach((p) => { p[0] -= xm; }));
    const SAND = [204, 174, 122];
    for (let j = 0; j < ny; j++) for (let k = 0; k < m1 + m2; k++) {
      const a = rows[j][k], b = rows[j][k + 1], c = rows[j + 1][k + 1], d = rows[j + 1][k];
      if (a[2] + b[2] + c[2] + d[2] < 1e-5) continue;
      const col = jit(SAND, r, 0.04);
      poly(P, [a, b, c], col, [0, 0, 1]); poly(P, [a, c, d], col, [0, 0, 1]);
    }
    P.foot = W * 0.08;
    return P;
  },
  cactus(o) {
    const h = o.h, P = [], c = PCOL.cactus, rib = (i) => (i % 2 ? c : mixC(c, [30, 60, 26], 0.25));
    frustum(P, 0, 0, 0, h * 0.9, h * 0.085, h * 0.08, 8, rib);
    ball(P, [0, 0, h * 0.9], h * 0.08, c);
    [[1, h * 0.42, h * 0.72, h * 0.2], [-1, h * 0.55, h * 0.8, h * 0.17]].forEach(([sd, z0, z1, out]) => {
      stick(P, [0, sd * h * 0.05, z0], [0, sd * out, z0], h * 0.11, c);
      stick(P, [0, sd * out, z0], [0, sd * out, z1], h * 0.11, c);
      ball(P, [0, sd * out, z1], h * 0.055, c);
    });
    ball(P, [0, 0, h * 0.99], h * 0.035, [242, 140, 162]);
    return P;
  },
  stump() {
    const P = [], h = 0.04, rr = 0.036;
    frustum(P, 0, 0, 0, h, rr * 1.08, rr, 12, (i) => mixC([77, 52, 32], [120, 84, 52], (i % 3) * 0.15));
    poly(P, ringAt(12, rr, h, null), [217, 176, 122], [0, 0, 1], { o: [0, 0, h], u: [1, 0, 0], v: [0, 1, 0], decal: (g) => { g.strokeStyle = '#b4874f'; g.lineWidth = 0.004; [0.62, 0.32].forEach((k) => { g.beginPath(); circle(g, 0, 0, rr * k); g.stroke(); }); } });
    [[0.056, 0.004, 1], [0.07, 0.018, 0.75]].forEach(([x, y, s]) => { stick(P, [x, y, 0], [x, y, 0.018 * s], 0.006 * s, [239, 230, 210]); ball(P, [x, y, 0.022 * s], 0.014 * s, [196, 70, 47]); });
    return P;
  },
  bricks() {
    const P = [];
    boxFaces(-0.055, 0.055, -0.04, 0.04, 0, 0.055, [201, 95, 58], { front: brickWall(0.11, 0.055), back: brickWall(0.11, 0.055), left: brickWall(0.08, 0.055), right: brickWall(0.08, 0.055), topCol: [229, 138, 99] }).forEach((f) => P.push({ k: 'poly', ...f }));
    boxFaces(-0.036, 0.036, -0.05, 0.05, 0.055, 0.09, [196, 92, 56], { front: brickWall(0.072, 0.035), back: brickWall(0.072, 0.035), left: brickWall(0.1, 0.035), right: brickWall(0.1, 0.035), topCol: [232, 142, 104] }).forEach((f) => P.push({ k: 'poly', ...f, bias: 0.06 }));
    return P;
  },
  robber() {
    const P = [], cloak = [74, 74, 86], Z0 = 0.02;
    frustum(P, 0, 0, 0, Z0, 0.1, 0.1, 18, (i) => mixC([58, 58, 66], [30, 30, 36], (i % 2) * 0.3), { cap: [66, 66, 76] });
    // the cloak falls in folds from the shoulders
    const folds = (i) => mixC(cloak, i % 2 ? [30, 30, 38] : [120, 120, 134], 0.3);
    frustum(P, 0, 0, Z0, 0.2, 0.082, 0.052, 14, folds);
    frustum(P, 0, 0, 0.2, 0.262, 0.052, 0.046, 14, folds);
    // a sack slung behind
    ball(P, [-0.05, -0.018, 0.2], 0.042, [128, 102, 66]);
    stick(P, [-0.03, -0.02, 0.25], [0.02, 0.03, 0.2], 0.009, [92, 70, 44]);
    // the hood, its point falling back
    ball(P, [-0.004, 0, 0.288], 0.058, cloak);
    cone(P, -0.03, 0, 0.3, 0.35, 0.03, 8, cloak, rng(5), {});
    // its opening: a lit rim set into the front, shadow inside, and two eyes catching the light
    const opening = (x, ry, rz, col, extra) => poly(P, Array.from({ length: 16 }, (_, i) => { const a = -i * TAU / 16; return [x, Math.cos(a) * ry, 0.281 + Math.sin(a) * rz]; }), col, [1, 0, 0], extra);
    opening(0.047, 0.037, 0.044, mixC(cloak, [150, 150, 166], 0.25), { bias: 0.03 });
    opening(0.0505, 0.028, 0.035, [7, 7, 11], { bias: 0.035, flat: true });
    ball(P, [0.052, 0.0118, 0.288], 0.0064, [255, 214, 140], { glow: 1, glowR: 2.4, glowA: 0.45, bias: 0.05 });
    ball(P, [0.052, -0.0118, 0.288], 0.0064, [255, 214, 140], { glow: 1, glowR: 2.4, glowA: 0.45, bias: 0.05 });
    return P;
  },
  block() {
    const P = [];
    boxFaces(-0.045, 0.045, -0.03, 0.03, 0, 0.042, [205, 187, 146], { front: (g) => { g.fillStyle = 'rgba(120,96,60,0.35)'; g.fillRect(0, 0.012, 0.09, 0.006); }, topCol: [230, 216, 178] }).forEach((f) => P.push({ k: 'poly', ...f }));
    return P;
  },
};
export function brickWall(w, h) {
  return (g) => {
    g.strokeStyle = 'rgba(70,24,10,0.55)'; g.lineWidth = 0.003;
    const rows = Math.max(2, Math.round(h / 0.016)), rh = h / rows;
    g.beginPath();
    for (let i = 1; i < rows; i++) { g.moveTo(0, i * rh); g.lineTo(w, i * rh); }
    for (let i = 0; i < rows; i++) for (let x = (i % 2 ? 0.0135 : 0.027); x < w; x += 0.027) { g.moveTo(x, i * rh); g.lineTo(x, (i + 1) * rh); }
    g.stroke();
    g.fillStyle = 'rgba(255,220,190,0.12)'; g.fillRect(0, 0, w, 0.004);
  };
}
// Draw a solid as seen from a seat: facets culled and lit, balls shaded as volumes, back to front.
export function drawSolid(g, prims, rho) {
  const R = rotZ(rho), list = [];
  for (const p of prims) {
    if (p.k === 'poly') {
      let n = R(p.n), facing = n[1] + K * n[2];
      if (facing <= 0.004) { if (!p.both) continue; n = n.map((v) => -v); }
      const pts = p.p.map(R);
      list.push({ p, n, pts, d: pts.reduce((a, q) => a + q[1] + K * q[2], 0) / pts.length + (p.bias || 0) });
    } else if (p.k === 'ball') { const c = R(p.c); list.push({ p, c, d: c[1] + K * c[2] + (p.bias || 0) }); }
    else { const a = R(p.a), b = R(p.b); list.push({ p, a, b, d: (a[1] + b[1]) / 2 + K * (a[2] + b[2]) / 2 }); }
  }
  list.sort((a, b) => a.d - b.d);
  for (const it of list) {
    const p = it.p;
    if (p.k === 'poly') {
      const k = lightOf(it.n), col = css(p.flat ? p.col : litC(p.col, k));
      g.beginPath(); it.pts.forEach((q, i) => { const s = P3(q); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); g.closePath();
      g.fillStyle = col; g.fill(); g.strokeStyle = col; g.lineWidth = 0.003; g.stroke();
      if (p.decal) {
        const o = P3(R(p.o)), u = R(p.u), w = R(p.v);
        g.save(); g.transform(u[0], K * u[1] - u[2], w[0], K * w[1] - w[2], o[0], o[1]); p.decal(g, k); g.restore();
      }
    } else if (p.k === 'ball') {
      const [x, y] = P3(it.c), rr = p.r;
      if (p.glow) {
        const gR = rr * (p.glowR || 6), gl = g.createRadialGradient(x, y, 0, x, y, gR); gl.addColorStop(0, `rgba(255,200,110,${p.glowA ?? 0.55})`); gl.addColorStop(1, 'rgba(255,190,100,0)');
        g.fillStyle = gl; g.fillRect(x - gR, y - gR, gR * 2, gR * 2);
        g.fillStyle = css(p.col); g.beginPath(); circle(g, x, y, rr); g.fill();
        continue;
      }
      const gr = g.createRadialGradient(x - rr * 0.38, y - rr * 0.42, rr * 0.06, x - rr * 0.08, y - rr * 0.08, rr * 1.08);
      gr.addColorStop(0, css(litC(p.col, p.dark ? 1.6 : 1.12))); gr.addColorStop(0.5, css(litC(p.col, 0.9))); gr.addColorStop(1, css(litC(p.col, 0.52)));
      g.fillStyle = gr; g.beginPath(); circle(g, x, y, rr); g.fill();
      if (p.speck) {
        g.save(); g.beginPath(); circle(g, x, y, rr); g.clip();
        const sr = rng(Math.round((p.c[0] * 997 + p.c[1] * 131 + p.c[2] * 71) * 1e4) >>> 0);
        for (let i = 0; i < 9; i++) {
          const a = sr() * TAU, d = sr() * rr * 0.85, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, lit = (px - x) + (py - y) < 0;
          g.fillStyle = lit ? css(litC(p.col, 1.25), 0.7) : css(litC(p.col, 0.45), 0.55);
          g.beginPath(); circle(g, px, py, rr * (0.08 + sr() * 0.06)); g.fill();
        }
        g.restore();
      }
    } else {
      const a = P3(it.a), b = P3(it.b);
      line(g, [a, b], css(litC(p.col, 0.8)), p.w);
      line(g, [[a[0] - p.w * 0.22, a[1]], [b[0] - p.w * 0.22, b[1]]], css(litC(p.col, 1.08)), p.w * 0.35);
    }
  }
}
// The ground shadow of a solid: everything pushed down and to the right by its height.
export function solidShadow(prims, rho) {
  const R = rotZ(rho), path = new Path2D(), S = (q) => [q[0] + 0.55 * q[2], K * q[1] + 0.28 * q[2]];
  for (const p of prims) {
    if (p.k === 'poly') {
      const pts = p.p.map(R).map(S);
      let a = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u[0] * v[1] - v[0] * u[1]; }
      if (Math.abs(a) > 1e-8) polyPath(a > 0 ? pts : pts.reverse(), path);
    } else if (p.k === 'ball') { const [x, y] = S(R(p.c)); path.ellipse(x, y, p.r, p.r * 0.62, 0, 0, TAU); }
    else {
      const a = S(R(p.a)), b = S(R(p.b)), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * p.w / 2, ny = dx / l * p.w / 2;
      const q = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
      let ar = 0; for (let i = 0; i < 4; i++) { const u = q[i], v = q[(i + 1) % 4]; ar += u[0] * v[1] - v[0] * u[1]; }
      polyPath(ar > 0 ? q : q.reverse(), path);
    }
  }
  return path;
}
export const SOLIDS = new Map();
export function solidOf(o) {
  const key = o.t + '|' + (o.key || '');
  let s = SOLIDS.get(key);
  if (s) return s;
  const prims = BUILD[o.t](o);
  let maxR = 0.01, maxZ = 0.01, foot = 0;
  const see = (p, extra = 0) => { const rr = Math.hypot(p[0], p[1]) + extra; maxR = Math.max(maxR, rr); maxZ = Math.max(maxZ, p[2] + extra); if (p[2] - extra < 0.012) foot = Math.max(foot, rr); };
  prims.forEach((p) => { if (p.k === 'poly') p.p.forEach((q) => see(q)); else if (p.k === 'ball') see(p.c, p.r * (p.glow ? 6 : 1)); else { see(p.a, p.w); see(p.b, p.w); } });
  s = { prims, maxR, maxZ, foot: prims.foot ?? Math.max(foot, maxR * 0.4), box: [-maxR - 0.012, -(maxZ + K * maxR) - 0.012, maxR + 0.012, K * maxR + 0.012] };
  SOLIDS.set(key, s);
  return s;
}
Object.keys(BUILD).forEach((t) => { T[t] = { yawed: true, buckets: 36, solid: true, box: (o) => solidOf(o).box, draw: (g, o) => drawSolid(g, solidOf(o).prims, o.rho) }; });
// The robber turns to face whoever the table is drawn for, a little to one side so he stays round.
T.robber.faces = Math.PI / 2 - 0.35;
export const yawFor = (def, it, v) => (def.faces !== undefined ? v.phi + def.faces : (it.yaw || 0));
// a jetty is long and lines up with the shore, so it turns in finer steps
T.jetty.buckets = 96;

// ---- domes: drawn as shaded volumes; their courses are horizontal rings, so they bow down in front
export function domeOutline(r, H) {
  const p = new Path2D(), top = Math.sqrt(K * K * r * r + H * H);
  p.moveTo(-r, 0); p.ellipse(0, 0, r, top, 0, Math.PI, TAU); p.ellipse(0, 0, r, r * K, 0, 0, Math.PI); p.closePath();
  return p;
}
export function domeFill(g, path, r, H, lit, mid, dark) {
  const gr = g.createRadialGradient(-r * 0.4, -H * 0.72, r * 0.05, -r * 0.1, -H * 0.4, Math.max(r, H) * 1.25);
  gr.addColorStop(0, lit); gr.addColorStop(0.5, mid); gr.addColorStop(1, dark);
  g.fillStyle = gr; g.fill(path);
}
export function domeRings(g, r, H, zs, col, w) {
  g.strokeStyle = col; g.lineWidth = w;
  zs.forEach((z) => { const rz = r * Math.sqrt(Math.max(0, 1 - (z / H) ** 2)); g.beginPath(); g.ellipse(0, -z, rz, rz * K, 0, 0.05, Math.PI - 0.05); g.stroke(); });
}
T.kiln = {
  yawed: true, buckets: 36,
  box: (o) => [-o.h * 0.62, -o.h * 1.75, o.h * 1.05, o.h * 0.42],
  draw(g, o) {
    const h = o.h, r = h * 0.55, H = h * 0.92, f = o.rho, fy = Math.sin(f), fx = Math.cos(f);
    const out = domeOutline(r, H);
    domeFill(g, out, r, H, '#d77650', '#a8482c', '#5e2414');
    g.save(); g.clip(out);
    domeRings(g, r, H, [0.16, 0.32, 0.48, 0.63, 0.77, 0.88].map((k) => k * H), 'rgba(60,20,10,0.42)', h * 0.016);
    g.strokeStyle = 'rgba(60,20,10,0.3)'; g.lineWidth = h * 0.012;
    const rr = rng(o.seed * 3 + 1);
    [0.08, 0.24, 0.4, 0.55, 0.7].forEach((k, n) => {
      const z0 = k * H, z1 = (k + 0.15) * H, r0 = r * Math.sqrt(1 - (z0 / H) ** 2), r1 = r * Math.sqrt(1 - Math.min(1, (z1 / H) ** 2));
      for (let a = 0.25 + (n % 2) * 0.22 + rr() * 0.1; a < Math.PI - 0.15; a += 0.44) { g.beginPath(); g.moveTo(Math.cos(a) * r0, K * Math.sin(a) * r0 - z0); g.lineTo(Math.cos(a) * r1, K * Math.sin(a) * r1 - z1); g.stroke(); }
    });
    g.restore();
    if (fy > 0.04) {
      const S = (ang, z) => { const rz = r * Math.sqrt(Math.max(0, 1 - (z / H) ** 2)) * 1.002; return [Math.cos(ang) * rz, K * Math.sin(ang) * rz - z]; };
      const aw = 0.32, za = H * 0.44, pts = [];
      for (let z = 0; z <= za * 0.55; z += za * 0.11) pts.push(S(f - aw, z));
      for (let t = 0; t <= 1.0001; t += 0.1) { const ang = f - aw + 2 * aw * t, z = za * 0.55 + za * 0.45 * Math.sin(t * Math.PI); pts.push(S(ang, z)); }
      for (let z = za * 0.55; z >= 0; z -= za * 0.11) pts.push(S(f + aw, z));
      const arch = polyPath(pts), [cx, cy] = S(f, za * 0.3);
      g.fillStyle = '#2a120a'; g.fill(arch);
      const fire = g.createRadialGradient(cx, cy + h * 0.04, 0, cx, cy, r * 0.5); fire.addColorStop(0, '#ffe08a'); fire.addColorStop(0.4, '#ff8a3a'); fire.addColorStop(1, 'rgba(160,40,10,0)');
      g.fillStyle = fire; g.fill(arch);
      g.strokeStyle = '#7f321d'; g.lineWidth = h * 0.045; g.stroke(arch);
      const gx = fx * r * 1.15, gy = K * fy * r * 1.15;
      const pool = g.createRadialGradient(gx, gy, 0, gx, gy, r * 0.5); pool.addColorStop(0, 'rgba(255,150,70,0.35)'); pool.addColorStop(1, 'rgba(255,150,70,0)');
      g.save(); g.translate(gx, gy); g.scale(1, K); g.translate(-gx, -gy); g.fillStyle = pool; g.fillRect(gx - r * 0.5, gy - r * 0.5, r, r); g.restore();
    }
    const vr = r * 0.16;
    g.fillStyle = '#7a3119'; g.fillRect(-vr, -H - h * 0.08, vr * 2, h * 0.1);
    g.fillStyle = '#a3492b'; g.fillRect(-vr, -H - h * 0.08, vr * 0.7, h * 0.1);
    g.fillStyle = '#9a4428'; g.fill(ellipsePath(0, -H - h * 0.08, vr, vr * K));
    g.fillStyle = '#1c0c06'; g.fill(ellipsePath(0, -H - h * 0.08, vr * 0.62, vr * 0.62 * K));
    fillCircles(g, [[r * 0.12, -H - h * 0.24, h * 0.07]], 'rgba(236,230,224,0.3)');
    fillCircles(g, [[r * 0.42, -H - h * 0.42, h * 0.095]], 'rgba(236,230,224,0.2)');
    fillCircles(g, [[r * 0.8, -H - h * 0.62, h * 0.12]], 'rgba(236,230,224,0.12)');
  },
  shadow: (o) => domeOutline(o.h * 0.55, o.h * 0.92),
};
T.mound = {
  box: (o) => [-o.w * 0.56, -o.h * 1.5, o.w * 0.56, o.w * 0.4],
  draw(g, o) {
    const h = o.h, r = o.w / 2, rr = rng(o.seed * 9 + 2), out = domeOutline(r, h);
    domeFill(g, out, r, h, '#e59670', '#c06842', '#6e2c16');
    g.save(); g.clip(out);
    domeRings(g, r, h, [0.22, 0.45, 0.68].map((k) => k * h), 'rgba(110,40,20,0.42)', h * 0.04);
    g.restore();
    g.strokeStyle = '#8a8a3a'; g.lineWidth = h * 0.035; g.beginPath();
    for (let i = 0; i < 7; i++) { const a = rr() * TAU, d = rr() * r * 0.55, x = Math.cos(a) * d, z = h * Math.sqrt(Math.max(0, 1 - (d / r) ** 2)), y = K * Math.sin(a) * d - z; g.moveTo(x, y); g.lineTo(x - h * 0.06, y - h * 0.16); g.moveTo(x, y); g.lineTo(x + h * 0.05, y - h * 0.17); }
    g.stroke();
  },
  shadow: (o) => domeOutline(o.w / 2, o.h),
};
// Hay: a beehive stack of straw, dense, every strand following the surface, ragged at the edges.
T.haystack = {
  box: (o) => [-o.h * 0.95, -o.h * 1.14, o.h * 0.95, o.h * 0.62],
  draw(g, o) {
    const h = o.h, rb = h * 0.56, r = rng(o.seed * 13 + 4);
    const HAY = ['#fff0bc', '#f7d982', '#e8bd52', '#d09c34', '#a8781f', '#7a5414'];
    const tone = (lit) => HAY[clamp(Math.round((1 - lit) * 5 + (r() - 0.5) * 1.8), 0, 5)];
    g.lineCap = 'round';
    // loose straw scattered round its foot
    for (let i = 0; i < 90; i++) {
      const a = r() * TAU, d = rb * (0.9 + r() * 0.6), x = Math.cos(a) * d, y = K * Math.sin(a) * d, b = r() * TAU, l = h * (0.06 + r() * 0.09);
      line(g, [[x, y], [x + Math.cos(b) * l, y + K * Math.sin(b) * l]], css(rgbOf(tone(0.55 - Math.sin(a) * 0.15)), 0.9), h * 0.014);
    }
    // the stack: a fat body drawn in to a peak
    const W = (v) => rb * (v < 0.55 ? 1 + 0.12 * Math.sin(v / 0.55 * Math.PI) : (1 - (v - 0.55) / 0.45) * 1.0);
    const body = new Path2D();
    body.moveTo(-rb, 0);
    for (let v = 0; v <= 1.0001; v += 0.05) body.lineTo(-W(v) * (1 + (r() - 0.5) * 0.05), -h * v);
    for (let v = 1; v >= -0.0001; v -= 0.05) body.lineTo(W(v) * (1 + (r() - 0.5) * 0.05), -h * v);
    body.ellipse(0, 0, rb, rb * K, 0, 0, Math.PI);
    body.closePath();
    const gr = g.createLinearGradient(-rb, -h, rb, 0);
    gr.addColorStop(0, '#f4d47c'); gr.addColorStop(0.5, '#cf9c36'); gr.addColorStop(1, '#6e4a10');
    g.fillStyle = gr; g.fill(body);
    g.save(); g.clip(body);
    // straw laid down the stack in courses, light on the left, dark on the right, thick enough to read small
    for (let i = 0; i < 700; i++) {
      const v = r(), u = r() * 2 - 1, half = W(v), x = u * half, y = -h * v + K * half * 0.3 * Math.sqrt(Math.max(0, 1 - u * u));
      const lit = clamp(0.66 - u * 0.5 + (v - 0.5) * 0.15, 0, 1), l = h * (0.09 + r() * 0.1), lean = u * 0.5 + (r() - 0.5) * 0.35;
      line(g, [[x, y], [x + lean * l, y + l]], css(rgbOf(tone(lit)), 0.75 + r() * 0.25), h * (0.014 + r() * 0.012));
    }
    // the top weathers grey-brown
    const cap = g.createLinearGradient(0, -h, 0, -h * 0.62);
    cap.addColorStop(0, 'rgba(96,74,44,0.75)'); cap.addColorStop(1, 'rgba(96,74,44,0)');
    g.fillStyle = cap; g.fillRect(-rb * 1.2, -h * 1.05, rb * 2.4, h * 0.45);
    // a rope round the waist, weighted
    g.strokeStyle = 'rgba(70,46,18,0.9)'; g.lineWidth = h * 0.028;
    g.beginPath(); g.ellipse(0, -h * 0.5, W(0.5) * 1.01, W(0.5) * K * 0.55, 0, 0.05, Math.PI - 0.05); g.stroke();
    g.restore();
    // ragged edge: straws sticking out of the silhouette
    for (let i = 0; i < 110; i++) {
      const v = r() * 0.95, side = r() < 0.5 ? -1 : 1, x = side * W(v), y = -h * v, l = h * (0.05 + r() * 0.08), a = side * (0.4 + r() * 0.8);
      line(g, [[x, y], [x + Math.sin(a) * l, y + Math.cos(a) * l * 0.5 - l * 0.2]], css(rgbOf(tone(side < 0 ? 0.8 : 0.25)), 0.9), h * 0.012);
    }
    for (let i = 0; i < 12; i++) { const b = -Math.PI / 2 + (r() - 0.5) * 1.6, l = h * (0.06 + r() * 0.07); line(g, [[0, -h * 0.98], [Math.cos(b) * l, -h * 0.98 + Math.sin(b) * l]], css(rgbOf(tone(0.4)), 0.9), h * 0.013); }
  },
  shadow: (o) => { const h = o.h, rb = h * 0.56, p = new Path2D(); p.moveTo(-rb, 0); p.lineTo(-rb * 1.1, -h * 0.3); p.lineTo(-rb * 0.9, -h * 0.6); p.lineTo(0, -h); p.lineTo(rb * 0.9, -h * 0.6); p.lineTo(rb * 1.1, -h * 0.3); p.lineTo(rb, 0); p.closePath(); return p; },
};

// A lantern on a post beside each jetty: a round post on a small footing, a four-sided glass lantern seen
// from a little above (its left faces lit, its right in shade), a pyramid cap, the flame inside.
T.lantern = {
  box: () => [-0.09, -0.39, 0.09, 0.04],
  draw(g) {
    const ph = 0.25, pr = 0.012, s = 0.029, ch = 0.058, yb = -ph, yt = yb - ch, so = s * 1.3, apex = yt - 0.034;
    // the lamp's own glow, close round it (its light on the ground is part of the beach)
    const gr = g.createRadialGradient(0, yb - ch * 0.5, 0, 0, yb - ch * 0.5, 0.075);
    gr.addColorStop(0, 'rgba(255,200,110,0.55)'); gr.addColorStop(1, 'rgba(255,190,100,0)');
    g.fillStyle = gr; g.fillRect(-0.08, yb - ch * 0.5 - 0.08, 0.16, 0.16);
    // the footing and the post, round, lit on the left
    g.fillStyle = '#2c241c'; g.fill(ellipsePath(0, 0, 0.024, 0.024 * K));
    g.fillStyle = '#5a4a3a'; g.fill(ellipsePath(0, -0.008, 0.022, 0.022 * K));
    const pg = g.createLinearGradient(-pr, 0, pr, 0); pg.addColorStop(0, '#8a6c4c'); pg.addColorStop(0.45, '#5a4430'); pg.addColorStop(1, '#241a10');
    g.fillStyle = pg; g.fillRect(-pr, yb, 2 * pr, ph - 0.008);
    // the lantern: a square cage turned to show two faces, its glass lit from within
    const L = [-s, yb], F = [0, yb + s * K], R = [s, yb], up = (p, h) => [p[0], p[1] - h];
    g.fillStyle = '#1e1812'; g.fill(polyPath([[-s, yb], [0, yb - s * K], [s, yb], [0, yb + s * K]]));
    const lf = polyPath([L, F, up(F, ch), up(L, ch)]), rf = polyPath([F, R, up(R, ch), up(F, ch)]);
    const gl = g.createLinearGradient(0, yt, 0, yb); gl.addColorStop(0, '#fff2c8'); gl.addColorStop(1, '#ffc865');
    g.fillStyle = gl; g.fill(lf); g.fillStyle = '#f0b250'; g.fill(rf);
    g.fillStyle = 'rgba(255,255,240,0.9)'; g.fill(ellipsePath(0, yb - ch * 0.45, s * 0.28, ch * 0.24));
    g.strokeStyle = '#231a12'; g.lineWidth = 0.005;
    g.beginPath(); [L, F, R].forEach((p) => { g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] - ch); }); g.moveTo(...L); g.lineTo(...F); g.lineTo(...R); g.moveTo(...up(L, ch)); g.lineTo(...up(F, ch)); g.lineTo(...up(R, ch)); g.stroke();
    // the cap: a little pyramid, its left face catching the light, a ring on top
    const cL = [-so, yt], cF = [0, yt + so * K], cR = [so, yt], cB = [0, yt - so * K], A = [0, apex];
    g.fillStyle = '#3a2e22'; g.fill(polyPath([cL, cB, cR, A]));
    g.fillStyle = '#6e5a44'; g.fill(polyPath([cL, cF, A]));
    g.fillStyle = '#2e241a'; g.fill(polyPath([cF, cR, A]));
    g.strokeStyle = '#1a140e'; g.lineWidth = 0.004; g.beginPath(); circle(g, 0, apex - 0.006, 0.006); g.stroke();
  },
  shadow: () => { const p = new Path2D(); p.rect(-0.012, -0.25, 0.024, 0.25); p.rect(-0.03, -0.31, 0.06, 0.06); return p; },
};

// Resource glyphs: plain silhouettes, used on the port plaques.
export const RES_COL = { wood: '#3f7d4c', brick: '#c8643f', wool: '#9cc66a', grain: '#f0c64c', ore: '#a3aec0' };
export function glyph(g, kind, cx, cy, s, col) {
  g.save(); g.translate(cx, cy); g.scale(s, s);
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (pts) => g.fill(polyPath(pts));
  if (kind === 'wood') { P([[0, -0.48], [0.28, -0.08], [-0.28, -0.08]]); P([[0, -0.26], [0.4, 0.26], [-0.4, 0.26]]); g.fillRect(-0.07, 0.24, 0.14, 0.22); }
  else if (kind === 'brick') { g.beginPath(); rrect(g, -0.46, 0.04, 0.44, 0.3, 0.05); rrect(g, 0.02, 0.04, 0.44, 0.3, 0.05); rrect(g, -0.22, -0.32, 0.44, 0.3, 0.05); g.fill(); }
  else if (kind === 'wool') { g.beginPath(); [[-0.2, 0, 0.2], [0.04, -0.1, 0.22], [0.24, 0.02, 0.18], [-0.02, 0.12, 0.2], [-0.32, 0.12, 0.13]].forEach(([x, y, r]) => circle(g, x, y, r)); g.fill(); g.beginPath(); circle(g, 0.4, -0.12, 0.12); g.fill(); g.fillRect(-0.24, 0.24, 0.07, 0.2); g.fillRect(0.12, 0.24, 0.07, 0.2); }
  else if (kind === 'grain') { g.lineWidth = 0.07; g.beginPath(); g.moveTo(0, 0.48); g.lineTo(0, -0.2); g.stroke(); const p = new Path2D(); for (let i = 0; i < 4; i++) { const y = 0.2 - i * 0.17; lensPath(0, y, -0.2, y - 0.18, 0.07, p); lensPath(0, y, 0.2, y - 0.18, 0.07, p); } lensPath(0, -0.28, 0, -0.5, 0.08, p); g.fill(p); }
  else if (kind === 'ore') P([[-0.18, -0.42], [0.18, -0.42], [0.42, -0.1], [0, 0.46], [-0.42, -0.1]]);
  g.restore();
}

T.plaque = {
  box: () => [-0.3, -0.42, 0.3, 0.04],
  draw(g, o) {
    const gw = 0.5, gh = 0.24, post = 0.14, top = -post - gh;
    const pg = g.createLinearGradient(-0.016, 0, 0.016, 0); pg.addColorStop(0, '#a07a50'); pg.addColorStop(1, '#5e4329');
    g.fillStyle = pg; g.fillRect(-0.016, -post - 0.01, 0.032, post + 0.01);
    g.fillStyle = '#120d08'; g.beginPath(); rrect(g, -gw / 2 + 0.012, top + 0.016, gw, gh, 0.06); g.fill();
    g.beginPath(); rrect(g, -gw / 2, top, gw, gh, 0.06); g.fillStyle = '#231a12'; g.fill();
    g.lineWidth = 0.018; g.strokeStyle = '#b8995a'; g.stroke();
    g.beginPath(); rrect(g, -gw / 2 + 0.02, top + 0.02, gw - 0.04, 0.01, 0.005); g.fillStyle = 'rgba(255,236,200,0.14)'; g.fill();
    const text = o.res ? '2:1' : '3:1', tx = o.res ? 0.07 : 0;
    if (o.res) glyph(g, o.res, -0.11, top + gh / 2, 0.15, RES_COL[o.res]);
    g.save(); g.translate(tx, top + gh / 2 + 0.006); g.scale(0.01, 0.01);
    g.font = `700 15px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f3ecdc'; g.fillText(text, 0, 0);
    g.restore();
  },
  shadow: () => { const p = new Path2D(); p.rect(-0.25, -0.38, 0.5, 0.24); p.rect(-0.016, -0.14, 0.032, 0.14); return p; },
};


// ---------------------------------------------------------------------------------------------
// Pieces: settlements and cities are small painted-wood buildings built in 3D, so every seat sees
// the side that faces it (gable from the bottom, the long side from the left). Roads are cobbled,
// raised a little, kerbed and set in the player's colour, and they join at the corners they share.
// ---------------------------------------------------------------------------------------------
// Twelve colours to pick from, one per player, chosen to tell apart at a glance: the first six are
// the ones drawn on this page. They spread round the wheel, with a grey and a brown for the
// players who don't care, and all are bright enough to glow on the dark edge of the table.
export const PALETTE = [['Ivory', '#efefef'], ['Blue', '#5b8cff'], ['Red', '#ff6b5b'], ['Violet', '#b07cff'], ['Teal', '#3fc9d6'], ['Pink', '#ff8fd0'],
  ['Orange', '#ff9a3d'], ['Yellow', '#f2d44e'], ['Green', '#2fbf71'], ['Lime', '#a6e05a'], ['Brown', '#b07a4f'], ['Grey', '#8f9bb3']];
export const markInk = (col) => (lumOf(col) > 0.7 ? '#2b2824' : '#f6efe0');
export const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function winDecal(g, cx, cy, w, h, arch) {
  const gl = g.createRadialGradient(cx, cy, 0, cx, cy, w * 1.7);
  gl.addColorStop(0, 'rgba(255,200,110,0.42)'); gl.addColorStop(1, 'rgba(255,200,110,0)');
  g.fillStyle = gl; g.fillRect(cx - w * 1.7, cy - w * 1.7, w * 3.4, w * 3.4);
  const shape = (pad) => {
    const q = new Path2D();
    if (arch) {
      q.moveTo(cx - w / 2 - pad, cy + h / 2 + pad); q.lineTo(cx - w / 2 - pad, cy - h / 2 + w / 2);
      q.arc(cx, cy - h / 2 + w / 2, w / 2 + pad, Math.PI, TAU); q.lineTo(cx + w / 2 + pad, cy + h / 2 + pad); q.closePath();
    } else rrect(q, cx - w / 2 - pad, cy - h / 2 - pad, w + 2 * pad, h + 2 * pad, 0.003);
    return q;
  };
  g.fillStyle = 'rgba(34,22,14,0.82)'; g.fill(shape(0.0055));
  g.fillStyle = '#ffd27a'; g.fill(shape(0));
  g.fillStyle = 'rgba(255,246,220,0.7)'; g.fillRect(cx - w / 2, cy - h / 2 + (arch ? w / 2 : 0), w * 0.34, h * 0.36);
  g.strokeStyle = 'rgba(96,58,22,0.6)'; g.lineWidth = 0.0042;
  g.beginPath(); g.moveTo(cx, cy - h / 2 + (arch ? w * 0.1 : 0)); g.lineTo(cx, cy + h / 2); g.moveTo(cx - w / 2, cy + h * 0.06); g.lineTo(cx + w / 2, cy + h * 0.06); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(cx - w / 2 - 0.007, cy + h / 2 + 0.0045, w + 0.014, 0.006);
}
export function doorDecal(g, cx, bottom, w, h, double) {
  const d = new Path2D(); d.moveTo(cx - w / 2, bottom); d.lineTo(cx - w / 2, bottom - h + w / 2); d.arc(cx, bottom - h + w / 2, w / 2, Math.PI, TAU); d.lineTo(cx + w / 2, bottom); d.closePath();
  g.fillStyle = 'rgba(30,20,12,0.6)'; g.save(); g.translate(0.004, 0.003); g.fill(d); g.restore();
  g.fillStyle = '#4a3324'; g.fill(d);
  g.save(); g.clip(d);
  g.strokeStyle = 'rgba(20,12,6,0.45)'; g.lineWidth = 0.003;
  g.beginPath(); for (let x = cx - w / 2 + w / 4; x < cx + w / 2; x += w / 4) { g.moveTo(x, bottom); g.lineTo(x, bottom - h); } g.stroke();
  if (double) line(g, [[cx, bottom], [cx, bottom - h]], 'rgba(15,8,4,0.7)', 0.005);
  g.fillStyle = 'rgba(255,220,170,0.12)'; g.fillRect(cx - w / 2, bottom - h, w * 0.3, h);
  g.restore();
  fillCircles(g, double ? [[cx - 0.008, bottom - h * 0.42, 0.0045], [cx + 0.008, bottom - h * 0.42, 0.0045]] : [[cx + w * 0.26, bottom - h * 0.42, 0.0045]], '#d8b86a');
}
export function markDecal(g, mark, ink, cx, cy, s) {
  g.save(); g.translate(0.003, 0.003); g.fillStyle = 'rgba(0,0,0,0.22)'; g.fill(markPath(mark, cx, cy, s)); g.restore();
  g.fillStyle = ink; g.fill(markPath(mark, cx, cy, s));
}
export function shingles(len, depth) {
  return (g) => {
    g.lineWidth = 0.0048;
    for (let v = 0.026; v < depth - 0.006; v += 0.027) {
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(0, v); g.lineTo(len, v); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.09)'; g.beginPath(); g.moveTo(0, v + 0.006); g.lineTo(len, v + 0.006); g.stroke();
    }
  };
}
// A gabled block: walls x0..x1 across, y0..y1 deep, eaves at ze, ridge along y.
export function gabled(x0, x1, y0, y1, z0, z1, zr, col, decals) {
  // `col` is the player's colour, or { wall, roof, trim, ov, oy, th } to set each part
  const C = typeof col === 'object' && !Array.isArray(col) ? col : null;
  const wall = rgbOf(C ? C.wall : col), roof = C && C.roof ? rgbOf(C.roof) : mixC(wall, [44, 32, 38], 0.42), trim = C && C.trim ? rgbOf(C.trim) : mixC(wall, [252, 248, 240], 0.38);
  const xc = (x0 + x1) / 2, hw = (x1 - x0) / 2, ov = C && C.ov !== undefined ? C.ov : 0.026, oy = C && C.oy !== undefined ? C.oy : 0.017, TH = C && C.th !== undefined ? C.th : 0.016;
  const RX = hw + ov, ZE = z1 - ov * ((zr - z1) / hw), ZT = zr + 0.012;
  const sl = Math.hypot(RX, ZT - ZE), nl = norm3([-(ZT - ZE), 0, RX]), nr = [-nl[0], 0, nl[2]];
  const Y0 = y0 - oy, Y1 = y1 + oy;
  return [
    { p: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [xc, y1, zr], [x0, y1, z1]], n: [0, 1, 0], col: wall, layer: 1, o: [x0, y1, zr], u: [1, 0, 0], v: [0, 0, -1], decal: decals.front },
    { p: [[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [xc, y0, zr], [x1, y0, z1]], n: [0, -1, 0], col: wall, layer: 1, o: [x1, y0, zr], u: [-1, 0, 0], v: [0, 0, -1], decal: decals.back },
    { p: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], n: [-1, 0, 0], col: wall, layer: 1, o: [x0, y0, z1], u: [0, 1, 0], v: [0, 0, -1], decal: decals.left },
    { p: [[x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]], n: [1, 0, 0], col: wall, layer: 1, o: [x1, y1, z1], u: [0, -1, 0], v: [0, 0, -1], decal: decals.right },
    { p: [[xc - RX, Y0, ZE], [xc - RX, Y1, ZE], [xc, Y1, ZT], [xc, Y0, ZT]], n: nl, col: roof, layer: 2, o: [xc, Y0, ZT], u: [0, 1, 0], v: [-RX / sl, 0, -(ZT - ZE) / sl], decal: decals.roof ? decals.roof(Y1 - Y0, sl) : shingles(Y1 - Y0, sl) },
    { p: [[xc + RX, Y1, ZE], [xc + RX, Y0, ZE], [xc, Y0, ZT], [xc, Y1, ZT]], n: nr, col: roof, layer: 2, o: [xc, Y1, ZT], u: [0, -1, 0], v: [RX / sl, 0, -(ZT - ZE) / sl], decal: decals.roof ? decals.roof(Y1 - Y0, sl) : shingles(Y1 - Y0, sl) },
    { p: [[xc - RX, Y1, ZE - TH], [xc - RX, Y1, ZE], [xc, Y1, ZT], [xc + RX, Y1, ZE], [xc + RX, Y1, ZE - TH], [xc, Y1, ZT - TH]], n: [0, 1, 0], col: trim, layer: 3 },
    { p: [[xc + RX, Y0, ZE - TH], [xc + RX, Y0, ZE], [xc, Y0, ZT], [xc - RX, Y0, ZE], [xc - RX, Y0, ZE - TH], [xc, Y0, ZT - TH]], n: [0, -1, 0], col: trim, layer: 3 },
    { p: [[xc - RX, Y0, ZE - TH], [xc - RX, Y1, ZE - TH], [xc - RX, Y1, ZE], [xc - RX, Y0, ZE]], n: [-1, 0, 0], col: scaleC(roof, 0.85), layer: 3 },
    { p: [[xc + RX, Y1, ZE - TH], [xc + RX, Y0, ZE - TH], [xc + RX, Y0, ZE], [xc + RX, Y1, ZE]], n: [1, 0, 0], col: scaleC(roof, 0.85), layer: 3 },
  ];
}
export const STONE = [134, 128, 118];
export const PARTS = new Map();
// Turn a part's faces (and their decal frames) by `ang` about the vertical, then move them.
export function xform(faces, ang, dx = 0, dy = 0) {
  const c = Math.cos(ang), s = Math.sin(ang), R = (v) => [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]], M = (v) => { const q = R(v); return [q[0] + dx, q[1] + dy, q[2]]; };
  return faces.map((f) => ({ ...f, p: f.p.map(M), n: R(f.n), ...(f.o ? { o: M(f.o), u: R(f.u), v: R(f.v) } : {}) }));
}
// A round stone base, its top laid with setts.
export function baseDisc(r, h) {
  const seg = 18, ring = (z) => Array.from({ length: seg }, (_, i) => { const a = (i + 0.5) * TAU / seg; return [Math.cos(a) * r, Math.sin(a) * r, z]; });
  const A = ring(0), B = ring(h), F = [];
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg, m = (i + 1) * TAU / seg; F.push({ p: [A[i], A[j], B[j], B[i]], n: [Math.cos(m), Math.sin(m), 0], col: mixC(STONE, [90, 84, 76], (i % 2) * 0.12) }); }
  F.push({ p: B, n: [0, 0, 1], col: [156, 150, 138], o: [0, 0, h], u: [1, 0, 0], v: [0, 1, 0], decal: (g) => {
    const q = rng(7); g.lineWidth = 0.003;
    for (let rr = 0.03; rr < r - 0.008; rr += 0.024) {
      const n = Math.max(5, Math.round(rr * TAU / 0.024)), off = q() * TAU;
      for (let k = 0; k < n; k++) {
        const a0 = off + k * TAU / n, a1 = a0 + TAU / n - 0.012 / rr;
        g.strokeStyle = 'rgba(70,64,56,0.45)'; g.beginPath(); g.arc(0, 0, rr, a0, a1); g.stroke();
        g.strokeStyle = 'rgba(70,64,56,0.3)'; g.beginPath(); g.moveTo(Math.cos(a0) * (rr - 0.012), Math.sin(a0) * (rr - 0.012)); g.lineTo(Math.cos(a0) * (rr + 0.012), Math.sin(a0) * (rr + 0.012)); g.stroke();
      }
    }
  } });
  return F;
}
export function pyramidFaces(x0, x1, y0, y1, zb, zt, col) {
  const A = [(x0 + x1) / 2, (y0 + y1) / 2, zt], a = [x0, y0, zb], b = [x1, y0, zb], c = [x1, y1, zb], d = [x0, y1, zb], hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, h = zt - zb;
  return [
    { p: [d, c, A], n: norm3([0, h, hy]), col, layer: 3 }, { p: [b, a, A], n: norm3([0, -h, hy]), col, layer: 3 },
    { p: [c, b, A], n: norm3([h, 0, hx]), col, layer: 3 }, { p: [a, d, A], n: norm3([-h, 0, hx]), col, layer: 3 },
  ];
}
// Settlement: a settlers' camp on a round of trampled grass dyed in the player's colour. A ridge tent
// and two bell tents in the colour stand round a campfire, with crates and a pole flying the player's
// flag, all modelled in 3D so every seat sees its own side.
export function discFaces(r, h, side, top, decal) {
  const seg = 18, ring = (z) => Array.from({ length: seg }, (_, i) => { const a = (i + 0.5) * TAU / seg; return [Math.cos(a) * r, Math.sin(a) * r, z]; });
  const A = ring(0), B = ring(h), F = [];
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg, m = (i + 1) * TAU / seg; F.push({ p: [A[i], A[j], B[j], B[i]], n: [Math.cos(m), Math.sin(m), 0], col: side }); }
  F.push({ p: B, n: [0, 0, 1], col: top, o: [0, 0, h], u: [1, 0, 0], v: [0, 1, 0], decal });
  return F;
}
// trampled grass: specks of light and dark, and a few scuffs round the fire
export const earthDecal = (r, seed) => (g) => {
  const q = rng(seed);
  for (let i = 0; i < 70; i++) { const a = q() * TAU, d = q() * r * 0.92; g.fillStyle = q() < 0.5 ? 'rgba(255,240,210,0.18)' : 'rgba(30,20,10,0.2)'; g.beginPath(); circle(g, Math.cos(a) * d, Math.sin(a) * d, 0.003 + q() * 0.006); g.fill(); }
  g.strokeStyle = 'rgba(30,20,10,0.16)'; g.lineWidth = 0.004;
  for (let i = 0; i < 9; i++) { const a = q() * TAU, d = 0.05 + q() * r * 0.7; g.beginPath(); g.arc(0, 0, d, a, a + 0.25 + q() * 0.3); g.stroke(); }
};
export function settlementParts(col, mark) {
  const key = 's' + col + mark;
  if (PARTS.has(key)) return PARTS.get(key);
  const Z0 = 0.022, C = rgbOf(col), tent = mixC(C, [255, 255, 255], 0.12), P = [], tx = -0.045, y0 = -0.12, y1 = 0.015, hw = 0.068, zr = 0.17;
  const seams = (w, h) => (g) => { g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.003; g.beginPath(); for (let x = 0.03; x < w; x += 0.03) { g.moveTo(x, 0); g.lineTo(x, h); } g.stroke(); };
  const sl = Math.hypot(hw, zr - Z0);
  poly(P, [[tx - hw, y1, Z0], [tx - hw, y0, Z0], [tx, y0, zr], [tx, y1, zr]], tent, [-1, 0, 0.6], { o: [tx, y0, zr], u: [0, 1, 0], v: [-hw / sl, 0, -(zr - Z0) / sl], decal: seams(y1 - y0, sl) });
  poly(P, [[tx + hw, y0, Z0], [tx + hw, y1, Z0], [tx, y1, zr], [tx, y0, zr]], tent, [1, 0, 0.6], { o: [tx, y1, zr], u: [0, -1, 0], v: [hw / sl, 0, -(zr - Z0) / sl], decal: seams(y1 - y0, sl) });
  poly(P, [[tx + hw, y0, Z0], [tx - hw, y0, Z0], [tx, y0, zr]], tent, [0, -1, 0]);
  poly(P, [[tx - hw, y1, Z0], [tx + hw, y1, Z0], [tx, y1, zr]], tent, [0, 1, 0], { o: [tx - hw, y1, zr], u: [1, 0, 0], v: [0, 0, -1], decal: (g) => {
    const H = zr - Z0; g.fillStyle = '#20160f'; g.beginPath(); g.moveTo(hw, H * 0.3); g.lineTo(hw - 0.026, H); g.lineTo(hw + 0.026, H); g.closePath(); g.fill();
    g.fillStyle = css(mixC(C, [0, 0, 0], 0.2)); g.beginPath(); g.moveTo(hw, H * 0.3); g.lineTo(hw - 0.026, H); g.lineTo(hw - 0.042, H); g.closePath(); g.fill();
  } });
  stick(P, [tx, y1 + 0.004, zr - 0.004], [tx, y1 + 0.004, zr + 0.016], 0.005, [90, 66, 42]);
  const P2 = [], P3 = [];
  cone(P2, 0.09, -0.07, Z0, 0.175, 0.058, 10, (i) => mixC(tent, [0, 0, 0], (i % 2) * 0.1), rng(4), {}); stick(P2, [0.09, -0.07, 0.17], [0.09, -0.07, 0.195], 0.005, [90, 66, 42]);
  cone(P3, 0.105, 0.075, Z0, 0.14, 0.048, 10, (i) => mixC(tent, [0, 0, 0], (i % 2) * 0.1), rng(6), {}); stick(P3, [0.105, 0.075, 0.135], [0.105, 0.075, 0.158], 0.005, [90, 66, 42]);
  const fire = [], fx = -0.02, fy = 0.1;
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ball(fire, [fx + Math.cos(a) * 0.028, fy + Math.sin(a) * 0.028, Z0 + 0.006], 0.009, [120, 116, 108]); }
  stick(fire, [fx - 0.02, fy - 0.012, Z0 + 0.008], [fx + 0.02, fy + 0.012, Z0 + 0.016], 0.008, [92, 60, 34]); stick(fire, [fx - 0.02, fy + 0.012, Z0 + 0.008], [fx + 0.02, fy - 0.012, Z0 + 0.016], 0.008, [92, 60, 34]);
  ball(fire, [fx, fy, Z0 + 0.024], 0.013, [255, 150, 60], { glow: 1 }); ball(fire, [fx + 0.003, fy, Z0 + 0.04], 0.008, [255, 214, 120], { glow: 1 });
  const crates = [...boxFaces(0.02, 0.055, 0.035, 0.07, Z0, Z0 + 0.035, [150, 110, 68]), ...boxFaces(0.026, 0.05, 0.04, 0.064, Z0 + 0.035, Z0 + 0.058, [136, 98, 60])];
  const flag = [], fpx = -0.14, fpy = -0.1;
  stick(flag, [fpx, fpy, Z0], [fpx, fpy, 0.34], 0.007, [90, 66, 42]);
  // the flag flies at a slant, so no seat ever sees it edge on
  const fu = [Math.SQRT1_2, -Math.SQRT1_2, 0], fl = 0.075, F = (d, z) => [fpx + fu[0] * d, fpy + fu[1] * d, z];
  flag.push({ k: 'poly', p: [F(0, 0.335), F(fl, 0.328), F(fl, 0.278), F(0, 0.285)], n: [Math.SQRT1_2, Math.SQRT1_2, 0], both: true, col: C, bias: 0.02, o: F(0, 0.335), u: fu, v: [0, 0, -1], decal: (g) => { g.fillStyle = markInk(col); g.fill(markPath(mark, 0.037, 0.026, 0.03)); } });
  // the camp's ground takes the player's colour, as the tents do: the same dyed grass as a town's hill
  const top = mixC(C, [118, 140, 80], 0.5), side = mixC(scaleC(C, 0.55), [80, 95, 54], 0.5);
  const parts = [
    { ground: true, faces: discFaces(0.19, Z0, side, top, earthDecal(0.18, 9)) },
    { center: [tx, (y0 + y1) / 2, 0], prims: P },
    { center: [0.09, -0.07, 0], prims: P2 }, { center: [0.105, 0.075, 0], prims: P3 },
    { center: [fx, fy, 0], prims: fire }, { center: [0.038, 0.052, 0], faces: crates }, { center: [fpx, fpy, 0], prims: flag },
  ];
  PARTS.set(key, parts);
  return parts;
}
// City: a hilltop town. A little hill dyed in the player's colour, rising from a straight rim as tall as
// a camp's round, houses on two terraces cut round it,
// each on a stone footing level with the slope below, its gable end facing downhill and its ridge
// running up toward the tower at the top, which flies the player's mark. Cream walls, roofs in the colour.
export function cityParts(col, mark) {
  const key = 'c' + col + mark;
  if (PARTS.has(key)) return PARTS.get(key);
  const Z0 = 0.022, C = rgbOf(col), ink = markInk(col), R0 = 0.25, H = 0.11, r = rng(17);
  const hz = (d) => H * Math.max(0, 1 - (d / R0) ** 2) + Z0;
  const grass = mixC(C, [118, 140, 80], 0.5), side = mixC(scaleC(C, 0.55), [80, 95, 54], 0.5), mound = [];
  // the hill stands on a straight rim as tall as a camp's round (Z0, in the same side colour), then curves up
  const rings = [[R0, 0], [R0, Z0], [0.225, hz(0.225)], [0.2, hz(0.2)], [0.13, hz(0.13)], [0.05, hz(0.05)]].map(([rr, z]) => ringAt(16, rr, z, null, { off: 0.1 }));
  bandTris(rings[0], rings[1]).forEach((t) => poly(mound, t, side));
  [...bandTris(rings[1], rings[2]), ...bandTris(rings[2], rings[3]), ...bandTris(rings[3], rings[4]), ...bandTris(rings[4], rings[5]), ...fanTris(rings[5], [0, 0, hz(0)])].forEach((t) => poly(mound, t, jit(grass, r, 0.16)));
  const parts = [{ ground: true, prims: mound }];
  const walls = [[236, 226, 204], [230, 212, 176], [244, 238, 226], [222, 206, 180]], FOOT_C = [150, 141, 126];
  const coursed = (w, h) => (g) => { g.strokeStyle = 'rgba(50,42,34,0.35)'; g.lineWidth = 0.0025; g.beginPath(); for (let z = 0.01; z < h; z += 0.01) { g.moveTo(0, z); g.lineTo(w, z); } g.stroke(); };
  const house = (d, a, s, i) => {
    const hw = 0.029 * s, hd = 0.036 * s, x = Math.cos(a) * d, y = Math.sin(a) * d, z0 = hz(d) - 0.003, zb = hz(d + hd + 0.004) - 0.01;
    const z1 = z0 + 0.068 * s, zr = z0 + 0.114 * s, wall = walls[i % 4], gable = zr - z0;
    const body = gabled(-hw, hw, -hd, hd, z0, z1, zr, { wall, roof: jit(C, r, 0.12), trim: wall, ov: 0.012, oy: 0.008, th: 0.01 }, {
      front: (g) => { doorDecal(g, hw, gable, 0.016, 0.03); winDecal(g, hw, gable - 0.062 * s, 0.013, 0.016); },
      back: (g) => winDecal(g, hw, gable - 0.04 * s, 0.013, 0.016),
      left: (g) => winDecal(g, hd, 0.032 * s, 0.013, 0.017), right: (g) => winDecal(g, hd, 0.032 * s, 0.013, 0.017),
    });
    const f = 0.004, footing = boxFaces(-hw - f, hw + f, -hd - f, hd + f, zb, z0, FOOT_C, { topCol: scaleC(FOOT_C, 1.08), front: coursed(2 * (hw + f), z0 - zb), left: coursed(2 * (hd + f), z0 - zb), right: coursed(2 * (hd + f), z0 - zb) });
    parts.push({ center: [x, y, 0], faces: xform([...footing, ...body], a - Math.PI / 2, x, y) });
  };
  for (let k = 0; k < 6; k++) house(0.18, 0.3 + k * TAU / 6, 1, k);
  // one house on the upper terrace, at the front right of the tower; the two behind it were hidden clutter
  house(0.098, 0.3 + TAU / 12, 0.9, 2);
  // a few bushes in the gaps between the lower houses
  [1, 3, 5].forEach((k) => { const a = 0.3 + (k + 0.5) * TAU / 6, d = 0.2, x = Math.cos(a) * d, y = Math.sin(a) * d, z = hz(d), B = []; ball(B, [x, y, z + 0.018], 0.02, PCOL.leaf, { speck: 1 }); ball(B, [x + 0.012, y + 0.006, z + 0.012], 0.014, PCOL.bush.forest, { speck: 1 }); parts.push({ center: [x, y, 0], prims: B }); });
  // the tower at the top, a cornice, a roof in the colour and a brass finial
  const zt = hz(0) - 0.006, tw = 0.032;
  const banner = (g) => {
    winDecal(g, tw, 0.05, 0.016, 0.03, true);
    const bx = tw, by = 0.1, bw = 0.026, bh = 0.036, p = polyPath([[bx - bw / 2, by - bh / 2], [bx + bw / 2, by - bh / 2], [bx + bw / 2, by + bh / 2 - 0.008], [bx, by + bh / 2], [bx - bw / 2, by + bh / 2 - 0.008]]);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.save(); g.translate(0.003, 0.003); g.fill(p); g.restore();
    g.fillStyle = css(C); g.fill(p); g.fillStyle = ink; g.fill(markPath(mark, bx, by - 0.002, 0.018));
  };
  const tallWin = (g) => winDecal(g, tw, 0.05, 0.016, 0.03, true);
  parts.push({ center: [0, 0, 0], faces: [
    ...boxFaces(-tw, tw, -tw, tw, zt, 0.33, CREAM_C, { layer: 1, top: false, front: banner, left: tallWin, right: tallWin, back: tallWin }),
    ...boxFaces(-tw - 0.005, tw + 0.005, -tw - 0.005, tw + 0.005, 0.33, 0.342, scaleC(CREAM_C, 0.94), { layer: 2 }),
    ...pyramidFaces(-tw - 0.007, tw + 0.007, -tw - 0.007, tw + 0.007, 0.342, 0.44, C),
    ...boxFaces(-0.005, 0.005, -0.005, 0.005, 0.436, 0.455, '#c9a961', { layer: 4 }),
  ] });
  PARTS.set(key, parts);
  return parts;
}
export const CREAM_C = [236, 226, 204];
T.settlement = {
  yawed: true, buckets: 96,
  box: () => [-0.27, -0.5, 0.27, 0.17],
  draw: (g, o) => drawParts(g, settlementParts(o.col, o.mark), o.rho),
  shadow: (o) => partsShadow(settlementParts(o.col, o.mark), o.rho), shadowFinal: true,
};
T.city = {
  yawed: true, buckets: 96,
  box: () => [-0.29, -0.66, 0.29, 0.21],
  draw: (g, o) => drawParts(g, cityParts(o.col, o.mark), o.rho),
  shadow: (o) => partsShadow(cityParts(o.col, o.mark), o.rho), shadowFinal: true,
};
// Camps and towns, like the numbers and the robber, face whoever the table is drawn for.
T.settlement.faces = 0; T.city.faces = 0;
// Bricks in the player's colour laid in herringbone between kerbs of bricks on edge, raised a little,
// with a roundel of bricks in rings where two of one player's roads meet.
export const ROAD_W = 0.15, ROAD_TH = 0.024;
export function sett(g, x, y, w, h, base, r) {
  const b = mixC(base, r() < 0.5 ? [255, 250, 240] : [0, 0, 0], 0.05 + r() * 0.11);
  const gr = g.createRadialGradient(x + w * 0.4, y + h * 0.38, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.65);
  gr.addColorStop(0, css(mixC(b, [255, 250, 240], 0.22))); gr.addColorStop(1, css(scaleC(b, 0.84)));
  g.fillStyle = gr; g.beginPath(); rrect(g, x, y, w, h, Math.min(w, h) * 0.32); g.fill();
}
// The colour a player's ground is dyed: under a camp, a town's hill, and inside their roads.
export const dyed = (col) => mixC(rgbOf(col), [118, 140, 80], 0.5);
export function roadTexture(len, W, col, sc, seed) {
  const c = canvasOf(len * sc, W * sc), g = c.getContext('2d'), r = rng(seed), pc = rgbOf(col), fill = dyed(col);
  const cap = new Path2D(); rrect(cap, 0, 0, len, W, W / 2);
  g.scale(sc, sc); g.save(); g.clip(cap);
  g.fillStyle = css(mixC(fill, [20, 16, 22], 0.6)); g.fillRect(0, 0, len, W);
  const kerb = W * 0.17, bw = 0.03, bh = 0.012;
  for (let y = kerb; y < W - kerb + bw; y += 0.019) for (let x = -0.04, k = 0; x < len + 0.04; x += 0.019, k++) {
    g.save(); g.translate(x + ((y / 0.019) % 2 ? 0.0095 : 0), y); g.rotate(k % 2 ? Math.PI / 4 : -Math.PI / 4);
    sett(g, -bw / 2, -bh / 2, bw, bh, fill, r);
    g.restore();
  }
  [0, W - kerb].forEach((y0) => { g.fillStyle = css(mixC(pc, [20, 16, 22], 0.6)); g.fillRect(0, y0, len, kerb); for (let x = 0; x < len; x += 0.016) sett(g, x + 0.002, y0 + 0.003, 0.012, kerb - 0.006, mixC(pc, [0, 0, 0], 0.2), r); });
  g.restore();
  return c;
}
export function junctionTexture(rj, col, sc, seed) {
  const c = canvasOf(2 * rj * sc, 2 * rj * sc), g = c.getContext('2d'), r = rng(seed), pc = dyed(col), fill = pc;
  g.setTransform(sc, 0, 0, sc, rj * sc, rj * sc);
  g.save(); g.beginPath(); circle(g, 0, 0, rj); g.clip();
  g.fillStyle = css(mixC(fill, [20, 16, 22], 0.6)); g.fillRect(-rj, -rj, 2 * rj, 2 * rj);
  [[0.0, 0.03, 1], [0.03, 0.058, 8], [0.058, rj, 14]].forEach(([r0, r1, n]) => { for (let k = 0; k < n; k++) { const a = k * TAU / n, rm = (r0 + r1) / 2; g.save(); g.translate(Math.cos(a) * rm, Math.sin(a) * rm); g.rotate(a); const w = Math.max(0.02, r1 - r0 - 0.005), h = n === 1 ? 0.04 : rm * TAU / n - 0.005; sett(g, -w / 2, -h / 2, w, h, k % 3 ? pc : mixC(pc, [0, 0, 0], 0.18), r); g.restore(); } });
  g.restore();
  return c;
}
// ---------------------------------------------------------------------------------------------
// Terrain. Every tile is planned from above, on the ground, never as a picture for one seat:
//   - a clearing in the middle, where the token lies;
//   - a footing kept clear at each corner (settlements and cities) and a strip along each edge (roads);
//   - everything else is scenery, spread evenly all the way round, so no side is the "back";
//   - the sight line: a standing thing is never taller than K x (its distance to the token's rim),
//     so from every seat the token stays whole. Scenery rises from the clearing toward the rim.
// ---------------------------------------------------------------------------------------------
export const TOP = { wood: '#2b6639', brick: '#b35a3b', wool: '#86b85a', grain: '#ddab3c', ore: '#6c7788', desert: '#b49a69' };
export const SIDE = { wood: '#1c4428', brick: '#74331e', wool: '#527733', grain: '#94701f', ore: '#454c59', desert: '#786443' };

export function allowedAt(x, y, foot) {
  if (Math.hypot(x, y) - foot < RC) return false;
  if (0.866 - hexDist(x, y) < EDGE + foot) return false;
  for (const [cx, cy] of CORNERS) if (Math.hypot(x - cx, y - cy) < FOOT + foot) return false;
  return true;
}
export const capAt = (x, y) => Math.min(K * (Math.hypot(x, y) - RT) - 0.015, 0.3);

export function planTile(res, seed) {
  const r = rng(seed), items = [], decals = {};
  const free = (x, y, foot, spacing = 0.85) => allowedAt(x, y, foot) && items.every((it) => Math.hypot(it.x - x, it.y - y) > (it.foot + foot) * spacing);
  // Sizes are rounded and shapes come in a few variants, so many things share one drawing per angle.
  const put = (t, x, y, o) => {
    const it = { t, x, y, foot: 0.05, seed: (r() * 6) | 0, yaw: r() * TAU, ...o };
    if (it.h) it.h = Math.floor(it.h * 100) / 100;
    if (it.w) it.w = Math.round(it.w * 50) / 50;
    if (it.s) it.s = Math.floor(it.s * 20) / 20;
    items.push(it);
    return it;
  };
  const polar = (a, d) => [Math.cos(a) * d, Math.sin(a) * d];
  const uniform = () => { for (;;) { const x = (r() * 2 - 1) * 0.87, y = r() * 2 - 1; if (hexDist(x, y) < 0.86) return [x, y]; } };
  const place = (t, a, d, o) => {
    for (let i = 0; i < 14; i++) {
      const aa = a + (i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.11 : 0), dd = d + (i > 7 ? (r() - 0.5) * 0.08 : 0);
      const [x, y] = polar(aa, dd);
      if (free(x, y, o.foot ?? 0.05, o.spacing ?? 0.85)) return put(t, x, y, o);
    }
    return null;
  };
  const fill = (n, tries, make) => { let k = 0; for (let i = 0; i < tries && k < n; i++) { const [x, y] = uniform(); if (make(x, y, capAt(x, y))) k++; } };
  // A wide model (a peak, a dune) fits only when every point of it, laid flat where it stands and
  // turned by its yaw, keeps out of the clearing, the road strips and the corner footings: its foot
  // alone says too little, since a peak's base or a dune's horns reach well past it.
  const fits = (t, x, y, o) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw), ok = (q) => allowedAt(x + c * q[0] - s * q[1], y + s * q[0] + c * q[1], 0);
    return BUILD[t](o).every((p) => (p.k === 'poly' ? p.p.every(ok) : p.k === 'ball' ? ok(p.c) : ok(p.a) && ok(p.b)));
  };
  // The biggest of a model that fits somewhere along `spots` (as near the first as it can), shrinking
  // from `w0` to `wMin`; it keeps its own seed and yaw.
  const fitted = (t, spots, w0, wMin, o) => {
    const seed = (r() * 6) | 0, yaw = o.yaw ?? r() * TAU;
    for (let w = w0; w >= wMin - 1e-6; w -= 0.02) for (const [x, y] of spots) {
      if (!free(x, y, o.foot, o.spacing ?? 0.85)) continue;
      const it = { ...o, seed, yaw, w: Math.round(w * 50) / 50, h: Math.floor(o.h(x, y, w) * 100) / 100 };
      if (fits(t, x, y, it)) return put(t, x, y, it);
    }
    return null;
  };
  const a0 = r() * TAU;
  decals.turn = (r() * 6) | 0;

  if (res === 'wood') {
    place('stump', a0, 0.47, { foot: 0.045 });
    place('stump', a0 + Math.PI, 0.47, { foot: 0.045 });
    fill(58, 1400, (x, y, c) => {
      const foot = c > 0.2 ? 0.068 : c > 0.1 ? 0.055 : 0.04;
      if (c < 0.035 || !free(x, y, foot, 0.78)) return false;
      if (c > 0.1) put(r() < 0.6 ? 'pine' : 'broadleaf', x, y, { h: c * (0.84 + r() * 0.16), foot });
      else put('bush', x, y, { h: Math.min(c * 0.9, 0.055), foot, pal: 'forest' });
      return true;
    });
  }

  if (res === 'brick') {
    decals.pit = polar(a0 + 2.6, 0.6);
    put('none', decals.pit[0], decals.pit[1], { foot: 0.12 });
    place('kiln', a0, 0.6, { h: 0.15, foot: 0.09 });
    place('kiln', a0 + Math.PI, 0.6, { h: 0.15, foot: 0.09 });
    [a0 + 1.05, a0 + 4.2, a0 + 5.25].forEach((a) => place('mound', a, 0.62, { h: 0.13 + r() * 0.02, w: 0.2 + r() * 0.05, foot: 0.09 }));
    place('bricks', a0 + 0.62, 0.5, { foot: 0.07 });
    place('bricks', a0 + 3.76, 0.5, { foot: 0.07 });
    fill(10, 500, (x, y, c) => {
      if (c < 0.04 || !free(x, y, 0.04)) return false;
      if (r() < 0.5) put('rock', x, y, { h: Math.min(c * 0.8, 0.05), w: 0.07, pal: 'clay', foot: 0.04 });
      else put('bush', x, y, { h: Math.min(c * 0.8, 0.045), pal: 'hills', foot: 0.04 });
      return true;
    });
  }

  if (res === 'wool') {
    // a flock and nothing else standing: sheep all the way round, lambs nearer the middle, grazing roughly one way
    fill(15, 3000, (x, y, c) => {
      if (c < 0.072 || !free(x, y, 0.062, 0.95)) return false;
      put('sheep', x, y, { s: Math.min(1.05, c / 0.12), foot: 0.062, yaw: a0 + (r() - 0.5) * 2.4 });
      return true;
    });
    decals.trail = Array.from({ length: 3 }, (_, i) => a0 + i * TAU / 3 + 0.5);
  }

  if (res === 'grain') {
    const order = ['wheat', 'barley', 'wheat', 'barley', 'wheat', 'stubble'];
    const rot = (r() * 6) | 0;
    decals.wedges = order.map((_, i) => order[(i + rot) % 6]);
    const wa = (i) => (-60 + 60 * i) * Math.PI / 180;
    const wi = decals.wedges.indexOf('wheat'), si = decals.wedges.indexOf('stubble'), bi = decals.wedges.indexOf('barley');
    place('windmill', wa(wi), 0.63, { h: 0.15, foot: 0.08 });
    // hay: stacks and round bales where the crop is in, the most on the stubble
    const hay = (a, d) => { const [x, y] = polar(a, d); return place('haystack', a, d, { h: Math.min(0.14, capAt(x, y) * 0.95), foot: 0.075 }); };
    hay(wa(si), 0.62);
    [[-0.5, 0.52], [-0.22, 0.5], [0.22, 0.5], [0.5, 0.52], [-0.3, 0.7], [0.3, 0.7]].forEach(([k, d]) => place('bale', wa(si) + k, d, { s: 1.3, foot: 0.055, spacing: 0.8 }));
    hay(wa(bi), 0.62);
    [-0.42, 0.42].forEach((k) => place('bale', wa(bi) + k, 0.54, { s: 1.3, foot: 0.055 }));
    hay(wa((wi + 4) % 6), 0.62);
    [-0.45, 0.45].forEach((k) => place('bale', wa((wi + 4) % 6) + k, 0.54, { s: 1.3, foot: 0.055 }));
    place('scarecrow', wa((wi + 2) % 6), 0.57, { h: 0.12, foot: 0.05 });
  }

  if (res === 'ore') {
    // the mine first, in a pass in the range, so the peaks stand back from it on either side and
    // nothing tall is in front of it from any seat
    const n = 8, mA = a0 + Math.PI / n;
    const mine = place('mine', mA, 0.52, { h: 0.1, w: 0.18, foot: 0.085, spacing: 0.5 });
    if (mine) { decals.mine = [mine.x, mine.y]; mine.yaw = Math.atan2(-mine.y, -mine.x); }
    // a range: big peaks shoulder to shoulder all the way round, foothills in front of them
    // each peak as wide as it can be and still stand clear of the roads and the corners, its whole base
    for (let i = 0; i < n; i++) {
      const a = a0 + i * TAU / n + (r() - 0.5) * 0.2, w0 = 0.32 + r() * 0.06, k = 0.95 + r() * 0.05, spots = [];
      for (let d = 0.66; d > 0.5; d -= 0.02) for (const da of [0, 0.08, -0.08]) spots.push(polar(a + da, d));
      fitted('peak', spots, w0, 0.16, { h: (x, y) => capAt(x, y) * k, foot: 0.06, spacing: 0.2 });
    }
    for (let i = 1; i < n; i++) {
      const a = a0 + (i + 0.5) * TAU / n + (r() - 0.5) * 0.2;
      fitted('rock', [polar(a, 0.5), polar(a, 0.53)], 0.17 + r() * 0.04, 0.07, { h: (x, y) => Math.min(capAt(x, y) * 0.9, 0.08), pal: 'grey', foot: 0.03, spacing: 0.3 });
    }
    place('crystal', a0 + Math.PI / n + 2.4, 0.47, { h: 0.065, foot: 0.04, spacing: 0.4 });
    place('crystal', a0 + Math.PI / n + 4.3, 0.47, { h: 0.055, foot: 0.04, spacing: 0.4 });
    fill(5, 400, (x, y, c) => {
      if (c < 0.03 || !free(x, y, 0.035, 0.5)) return false;
      put('rock', x, y, { h: Math.min(c * 0.8, 0.05), w: 0.07, pal: 'grey', foot: 0.035 });
      return true;
    });
  }

  if (res === 'desert') {
    for (let i = 0; i < 8; i++) {
      const [x, y] = polar(a0 + i * TAU / 8, 0.47), broken = i % 3 !== 0;
      put('column', x, y, { h: broken ? 0.07 + r() * 0.08 : 0.21, broken, foot: 0.04 });
    }
    place('block', a0 + 0.4, 0.6, { foot: 0.05 });
    place('block', a0 + 3.5, 0.62, { foot: 0.05 });
    // the dunes all lie the same way, their horns trailing with the wind
    const wind = r() * TAU;
    // each dune as big as it can be with its horns and its slip face clear of the roads and the corners
    for (let i = 0; i < 3; i++) {
      const a = a0 + 1.0 + i * TAU / 3, hh = 0.075 + r() * 0.025, yaw = wind + (r() - 0.5) * 0.35, spots = [];
      for (let d = 0.64; d > 0.5; d -= 0.02) for (const da of [0, 0.12, -0.12, 0.24, -0.24]) spots.push(polar(a + da, d));
      fitted('dune', spots, 0.34, 0.2, { h: () => hh, yaw, foot: 0.08, spacing: 0.6 });
    }
    place('cactus', a0 + 2.2, 0.62, { h: 0.15, foot: 0.05 });
    place('cactus', a0 + 4.9, 0.6, { h: 0.12, foot: 0.05 });
    fill(4, 300, (x, y) => { if (!free(x, y, 0.035)) return false; put('rock', x, y, { h: 0.04, w: 0.06, pal: 'sand', foot: 0.035 }); return true; });
  }

  const out = items.filter((it) => it.t !== 'none');
  out.forEach((it) => { it.key = [it.t, (it.h || 0).toFixed(2), (it.w || 0).toFixed(2), it.seed, it.pal || '', (it.s || 0).toFixed(2), it.broken ? 1 : 0].join('|'); });
  return { items: out, decals };
}

// ---- the ground, drawn from above in the tile's own frame ---------------------------------
export function softDot(g, x, y, rad, col, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
}
export function anyPoint(r) { for (;;) { const x = (r() * 2 - 1) * 0.9, y = (r() * 2 - 1) * 1.02; if (hexDist(x, y) < 0.9) return [x, y]; } }
export function clearing(g, col, inner = 0.8) {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, RC + 0.1);
  gr.addColorStop(0, css(col, 1)); gr.addColorStop(inner * RC / (RC + 0.1), css(col, 0.95)); gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr; g.fillRect(-0.6, -0.6, 1.2, 1.2);
}
export function strokes(g, n, r, len, col, w, where) {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath();
  for (let i = 0; i < n; i++) { const [x, y] = where ? where(r) : anyPoint(r); const a = r() * TAU, l = len * (0.6 + r() * 0.8); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
  g.stroke();
}
export const GROUND = {
  wood(g, plan, r) {
    g.fillStyle = TOP.wood; g.fillRect(-1.1, -1.1, 2.2, 2.2);
    for (let i = 0; i < 70; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.06 + r() * 0.1, [18, 50, 28], 0.6); }
    for (let i = 0; i < 40; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.03 + r() * 0.06, [84, 146, 82], 0.38); }
    strokes(g, 560, r, 0.018, 'rgba(126,100,60,0.3)', 0.006);
    [0, 2, 4].forEach((k) => {
      const c = CORNERS[(k + plan.decals.turn) % 6], a = Math.atan2(c[1], c[0]), bend = (r() - 0.5) * 0.5;
      const s = [Math.cos(a) * RC * 0.9, Math.sin(a) * RC * 0.9], e = [c[0] * 0.8, c[1] * 0.8];
      const m = [(s[0] + e[0]) / 2 - Math.sin(a) * bend * 0.2, (s[1] + e[1]) / 2 + Math.cos(a) * bend * 0.2];
      g.lineCap = 'round';
      [[0.055, 'rgba(110,90,56,0.32)'], [0.022, 'rgba(160,136,92,0.22)']].forEach(([w, col]) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(...s); g.quadraticCurveTo(...m, ...e); g.stroke(); });
    });
    clearing(g, [76, 136, 74]);
    strokes(g, 90, r, 0.016, 'rgba(150,200,120,0.4)', 0.005, (rr) => { const a = rr() * TAU, d = rr() * RC; return [Math.cos(a) * d, Math.sin(a) * d]; });
  },
  brick(g, plan, r) {
    g.fillStyle = TOP.brick; g.fillRect(-1.1, -1.1, 2.2, 2.2);
    for (let i = 0; i < 40; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.05 + r() * 0.1, [214, 128, 88], 0.3); }
    for (let i = 0; i < 40; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.05 + r() * 0.08, [126, 52, 28], 0.3); }
    g.strokeStyle = 'rgba(92,36,18,0.48)'; g.lineWidth = 0.007; g.beginPath();
    for (let i = 0; i < 46; i++) {
      let [x, y] = anyPoint(r), a = r() * TAU;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 0.05; y += Math.sin(a) * 0.05; g.lineTo(x, y); }
    }
    g.stroke();
    if (plan.decals.pit) {
      const [px, py] = plan.decals.pit;
      g.fillStyle = '#cf7a55'; g.beginPath(); circle(g, px, py, 0.125); g.fill();
      g.fillStyle = '#7f3a22'; g.beginPath(); circle(g, px, py, 0.1); g.fill();
      const w = g.createRadialGradient(px - 0.02, py - 0.02, 0, px, py, 0.08);
      w.addColorStop(0, '#7d9aa3'); w.addColorStop(1, '#3d5a64');
      g.fillStyle = w; g.beginPath(); circle(g, px, py, 0.074); g.fill();
      g.fillStyle = 'rgba(230,240,244,0.45)'; g.beginPath(); g.ellipse(px - 0.025, py - 0.022, 0.022, 0.008, -0.5, 0, TAU); g.fill();
    }
    g.lineCap = 'round';
    strokes(g, 70, r, 0.02, 'rgba(150,140,70,0.55)', 0.006);
    clearing(g, [198, 116, 78]);
  },
  wool(g, plan, r) {
    g.fillStyle = TOP.wool; g.fillRect(-1.1, -1.1, 2.2, 2.2);
    for (let i = 0; i < 50; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.05 + r() * 0.1, [96, 142, 60], 0.38); }
    for (let i = 0; i < 40; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.04 + r() * 0.07, [176, 214, 124], 0.32); }
    g.lineCap = 'round';
    strokes(g, 520, r, 0.016, 'rgba(84,130,48,0.5)', 0.006);
    strokes(g, 420, r, 0.014, 'rgba(184,222,132,0.45)', 0.005);
    (plan.decals.trail || []).forEach((a) => {
      g.strokeStyle = 'rgba(206,222,160,0.42)'; g.lineWidth = 0.028; g.beginPath();
      for (let k = 0; k <= 12; k++) { const t = a + k * 0.12, d = 0.5 + Math.sin(k * 0.9 + a) * 0.04; const x = Math.cos(t) * d, y = Math.sin(t) * d; k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    });
    fillCircles(g, Array.from({ length: 46 }, () => [...anyPoint(r), 0.008]), '#f7f3ea');
    fillCircles(g, Array.from({ length: 28 }, () => [...anyPoint(r), 0.008]), '#f2cf62');
    clearing(g, [158, 204, 108]);
  },
  grain(g, plan, r) {
    g.fillStyle = TOP.grain; g.fillRect(-1.1, -1.1, 2.2, 2.2);
    const CROP = {
      wheat: ['#e0ae3e', '#f4d065', '#b8862a'], barley: ['#e8d088', '#f8e9b4', '#c2a85c'],
      stubble: ['#d2ae66', '#ead08f', '#a88544'],
    };
    plan.decals.wedges.forEach((type, i) => {
      const A = CORNERS[i], B = CORNERS[(i + 1) % 6], tri = polyPath([[0, 0], [A[0] * 1.1, A[1] * 1.1], [B[0] * 1.1, B[1] * 1.1]]);
      const C = CROP[type];
      g.save(); g.clip(tri);
      g.fillStyle = C[0]; g.fill(tri);
      const ex = B[0] - A[0], ey = B[1] - A[1], el = Math.hypot(ex, ey), ux = ex / el, uy = ey / el;
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, ml = Math.hypot(mx, my), nx = -mx / ml, ny = -my / ml;
      for (let dd = 0.016; dd < 0.87; dd += 0.03) {
        const px = mx + nx * dd, py = my + ny * dd;
        line(g, [[px - ux * 1.2, py - uy * 1.2], [px + ux * 1.2, py + uy * 1.2]], C[2], 0.011);
        line(g, [[px - ux * 1.2 + nx * 0.008, py - uy * 1.2 + ny * 0.008], [px + ux * 1.2 + nx * 0.008, py + uy * 1.2 + ny * 0.008]], C[1], 0.006);
      }
      if (type === 'wheat' || type === 'barley') {
        const lit = new Path2D(), dark = new Path2D();
        for (let k = 0; k < 1100; k++) { const [x, y] = anyPoint(r), a = Math.atan2(uy, ux) + (r() - 0.5) * 0.9, l = 0.016 + r() * 0.01; lensPath(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.0045, k % 3 ? lit : dark); }
        g.fillStyle = type === 'wheat' ? 'rgba(255,226,140,0.6)' : 'rgba(255,248,214,0.6)'; g.fill(lit);
        g.fillStyle = type === 'wheat' ? 'rgba(150,100,24,0.45)' : 'rgba(170,140,70,0.45)'; g.fill(dark);
      }
      if (type === 'stubble') strokes(g, 200, r, 0.012, 'rgba(250,232,180,0.55)', 0.004);
      g.restore();
    });
    g.lineCap = 'round';
    CORNERS.forEach(([cx, cy]) => {
      const s = [cx * RC, cy * RC], e = [cx * 1.02, cy * 1.02];
      line(g, [s, e], '#b88d48', 0.05);
      const px = -cy * 0.012, py = cx * 0.012;
      line(g, [[s[0] + px, s[1] + py], [e[0] + px, e[1] + py]], 'rgba(110,80,35,0.5)', 0.006);
      line(g, [[s[0] - px, s[1] - py], [e[0] - px, e[1] - py]], 'rgba(110,80,35,0.5)', 0.006);
    });
    g.fillStyle = '#c9a15e'; g.beginPath(); circle(g, 0, 0, RC); g.fill();
    g.strokeStyle = 'rgba(120,84,40,0.35)'; g.lineWidth = 0.012; g.stroke();
    g.save(); g.beginPath(); circle(g, 0, 0, RC); g.clip();
    strokes(g, 160, r, 0.03, 'rgba(244,214,140,0.55)', 0.005);
    g.restore();
  },
  ore(g, plan, r) {
    g.fillStyle = TOP.ore; g.fillRect(-1.1, -1.1, 2.2, 2.2);
    for (let i = 0; i < 40; i++) { const [x, y] = anyPoint(r); softDot(g, x, y, 0.06 + r() * 0.1, [80, 90, 106], 0.45); }
    fillCircles(g, Array.from({ length: 260 }, () => [...anyPoint(r), 0.005 + r() * 0.009]), 'rgba(160,170,186,0.55)');
    fillCircles(g, Array.from({ length: 200 }, () => [...anyPoint(r), 0.005 + r() * 0.008]), 'rgba(58,66,80,0.5)');
    for (let i = 0; i < 6; i++) {
      const a = r() * TAU, d = 0.7 + r() * 0.16;
      softDot(g, Math.cos(a) * d, Math.sin(a) * d, 0.04 + r() * 0.04, [226, 232, 240], 0.45);
    }
    if (plan.decals.mine) {
      const [mx, my] = plan.decals.mine, l = Math.hypot(mx, my), ux = -mx / l, uy = -my / l, px = -uy, py = ux;
      const s = [mx + ux * 0.05, my + uy * 0.05], e = [ux * (RC + 0.02), uy * (RC + 0.02)];
      const len = Math.hypot(e[0] - s[0], e[1] - s[1]);
      g.strokeStyle = '#6a4c30'; g.lineWidth = 0.012; g.beginPath();
      for (let t = 0; t <= len; t += 0.03) { const x = s[0] + ux * t, y = s[1] + uy * t; g.moveTo(x - px * 0.03, y - py * 0.03); g.lineTo(x + px * 0.03, y + py * 0.03); }
      g.stroke();
      [-0.018, 0.018].forEach((o) => line(g, [[s[0] + px * o, s[1] + py * o], [e[0] + px * o, e[1] + py * o]], '#a2a8b1', 0.006));
    }
    clearing(g, [134, 145, 162]);
    g.strokeStyle = 'rgba(60,68,82,0.4)'; g.lineWidth = 0.006; g.beginPath();
    for (let i = 0; i < 5; i++) { const a = r() * TAU; let x = Math.cos(a) * 0.1, y = Math.sin(a) * 0.1; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += Math.cos(a + (r() - 0.5)) * 0.06; y += Math.sin(a + (r() - 0.5)) * 0.06; g.lineTo(x, y); } }
    g.stroke();
  },
  desert(g, plan, r) {
    g.fillStyle = TOP.desert; g.fillRect(-1.1, -1.1, 2.2, 2.2);
    for (let y = -1.05; y < 1.05; y += 0.046) {
      g.beginPath(); for (let x = -1; x <= 1; x += 0.04) { const yy = y + Math.sin(x * 7 + y * 9) * 0.012; x > -1 ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.strokeStyle = 'rgba(150,123,78,0.5)'; g.lineWidth = 0.006; g.stroke();
      g.save(); g.translate(0, -0.008); g.strokeStyle = 'rgba(224,206,162,0.45)'; g.lineWidth = 0.005; g.stroke(); g.restore();
    }
    fillCircles(g, Array.from({ length: 60 }, () => [...anyPoint(r), 0.006 + r() * 0.008]), 'rgba(120,98,64,0.5)');
    g.fillStyle = '#efe8d8';
    for (let i = 0; i < 2; i++) { const a = r() * TAU, d = 0.7; g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(r() * TAU); g.beginPath(); g.ellipse(0, 0, 0.022, 0.016, 0, 0, TAU); g.fill(); g.fillRect(0.01, -0.005, 0.04, 0.01); g.restore(); }
    // a paved plaza, stones missing here and there: the robber's lair
    g.fillStyle = '#8a7650'; g.beginPath(); circle(g, 0, 0, RC); g.fill();
    [[0.095, 0.205, 8], [0.205, 0.31, 13], [0.31, RC, 18]].forEach(([r0, r1, n]) => {
      const off = r() * TAU;
      for (let k = 0; k < n; k++) {
        const a0 = off + k * TAU / n, a1 = a0 + TAU / n, gp = 0.006;
        const p = new Path2D(); p.arc(0, 0, r1 - gp, a0 + gp / r1, a1 - gp / r1); p.arc(0, 0, r0 + gp, a1 - gp / r0, a0 + gp / r0, true); p.closePath();
        g.fillStyle = r() < 0.12 ? TOP.desert : css(mixC('#cdbb93', r() < 0.5 ? '#efe2c0' : '#a8956c', r() * 0.45));
        g.fill(p);
      }
    });
    g.fillStyle = '#d8c79f'; g.beginPath(); circle(g, 0, 0, 0.088); g.fill();
    g.strokeStyle = 'rgba(120,96,60,0.55)'; g.lineWidth = 0.006; g.stroke(markPath('star', 0, 0, 0.12));
  },
};
export function tileTexture(res, plan, sc, seed) {
  const c = canvasOf(2 * sc, 2 * sc), g = c.getContext('2d');
  g.setTransform(sc, 0, 0, sc, sc, sc);
  g.save(); g.clip(hexRound(new Path2D(), 0, 0, 1 - GAP, 0.09));
  GROUND[res](g, plan, rng(seed));
  g.restore();
  return { c, half: 1 };
}
// ---------------------------------------------------------------------------------------------
// The island: the starter layout, its coast and ports, pieces, and one renderer for every seat.
// A frame lays the sea and tile tops as flat images under the seat's projection, then tokens and
// roads, then every standing sprite back to front. Nothing is spun as one picture.
// ---------------------------------------------------------------------------------------------
export const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
export const cornerKey = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100);
export const cornerOf = (q, r, i) => { const [x, y] = axial(q, r), c = CORNERS[((i % 6) + 6) % 6]; return [x + c[0], y + c[1]]; };

// A tile of the island, planned and painted once. x, y: its centre in the scene (the island's middle at 0, 0).
export function makeTile(q, r, res, num, seed, sc, x, y) {
  const plan = planTile(res, seed);
  return { q, r, x, y, res, num, plan, tex: tileTexture(res, plan, sc, seed + 7) };
}
// The pieces on the island, as a scene's items, roads and junctions. buildings: [{ x, y, kind, col,
// mark }]; roads: [{ id, a: [x, y], b: [x, y], col, owner }], in the scene's units. A road's bricks
// and a junction's rings are painted once for what they show and kept, each seeded by where it
// lies, so a new road paints only itself and the others keep their pattern.
export const ROAD_TEX = new Map();
export function keptTexture(key, make) {
  let c = ROAD_TEX.get(key);
  if (!c) {
    c = make();
    ROAD_TEX.set(key, c);
    if (ROAD_TEX.size > 400) ROAD_TEX.delete(ROAD_TEX.keys().next().value);
  }
  return c;
}
export const seedAt = (x, y) => ((Math.round(x * 100) * 73856093) ^ (Math.round(y * 100) * 19349663)) >>> 0;
export function sceneOf(tiles, buildings, roads, sc) {
  const items = [];
  tiles.forEach((t) => t.plan.items.forEach((it) => items.push({ ...it, x: t.x + it.x, y: t.y + it.y, lift: SLAB })));
  const built = new Set();
  buildings.forEach(({ x, y, kind, col, mark }) => {
    built.add(cornerKey(x, y));
    items.push({ t: kind, x, y, lift: SLAB, yaw: 0, col, mark, key: kind + col + mark });
  });
  const end = (C, owner) => cornerKey(...C) + '|' + owner, ends = new Map();
  roads.forEach(({ a, b, owner }) => [a, b].forEach((C) => ends.set(end(C, owner), (ends.get(end(C, owner)) || 0) + 1)));
  const junctions = [], seen = new Set(), rj = ROAD_W / 2 + 0.018, scr = Math.round(sc);
  const out = roads.map(({ id, a: A, b: B, col, owner }) => {
    // where two of one player's roads meet at an empty corner they join at a roundel; at a building
    // the road runs in under it; at a free end it rounds off short of the corner
    const trim = (C) => {
      const k = end(C, owner);
      if (built.has(cornerKey(...C))) return 0.1;
      if (ends.get(k) > 1) {
        if (!seen.has(k)) {
          seen.add(k);
          const seed = 500 + (seedAt(...C) % 100000);
          junctions.push({ x: C[0], y: C[1], col, r: rj, tex: keptTexture(['j', col, scr, seed].join('|'), () => junctionTexture(rj, col, sc, seed)) });
        }
        return 0;
      }
      return 0.15;
    };
    const ta = trim(A), tb = trim(B);
    const dx = B[0] - A[0], dy = B[1] - A[1], L0 = Math.hypot(dx, dy), ux = dx / L0, uy = dy / L0;
    const a = [A[0] + ux * ta, A[1] + uy * ta], b = [B[0] - ux * tb, B[1] - uy * tb];
    const len = L0 - ta - tb, ang = Math.atan2(uy, ux), rr = ROAD_W / 2;
    const ca = [a[0] + ux * rr, a[1] + uy * rr], cb = [b[0] - ux * rr, b[1] - uy * rr];
    const poly = [];
    for (let k = 0; k <= 6; k++) { const t = ang - Math.PI / 2 + k * Math.PI / 6; poly.push([cb[0] + Math.cos(t) * rr, cb[1] + Math.sin(t) * rr]); }
    for (let k = 0; k <= 6; k++) { const t = ang + Math.PI / 2 + k * Math.PI / 6; poly.push([ca[0] + Math.cos(t) * rr, ca[1] + Math.sin(t) * rr]); }
    const norms = poly.map((pt, i) => { const qq = poly[(i + 1) % poly.length], ex = qq[0] - pt[0], ey = qq[1] - pt[1], l = Math.hypot(ex, ey) || 1; return [ey / l, -ex / l]; });
    const seed = 300 + (seedAt((A[0] + B[0]) / 2, (A[1] + B[1]) / 2) % 100000);
    return { id, col, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang, len, poly, norms, tex: keptTexture(['r', col, scr, seed, len.toFixed(3)].join('|'), () => roadTexture(len, ROAD_W, col, sc, seed)) };
  });
  return { tiles, items, roads: out, junctions };
}

// The coast: every corner on an outer edge, in order round the middle.
export function coastRing(tiles) {
  const land = new Set(tiles.map((t) => t.q + ',' + t.r)), DIR = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]], pts = new Map();
  tiles.forEach((t) => DIR.forEach(([dq, dr], e) => {
    if (land.has((t.q + dq) + ',' + (t.r + dr))) return;
    [e, e + 1].forEach((i) => { const c = [t.x + CORNERS[i % 6][0], t.y + CORNERS[i % 6][1]]; pts.set(cornerKey(...c), c); });
  }));
  return [...pts.values()].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
}
// ---- the sea ------------------------------------------------------------------------------------
// The island stands in a dark grey sea (B8). A narrow beach rings the coast. Waves come in from 3.7 R
// out, faint and broken far off, and close up as they come, slowing, steepening and whitening near
// the shore; each breaks on the wet sand and washes up the beach, which stays dark where it reached
// for a moment. The still parts (shallows, beach, ripples round the jetties' piles) are painted once; the waves are
// drawn every frame from rings worked out once along rays from the middle.
export const SEA = { deep: '#0b0b0b', beach: 0.26, far: 3.7, period: 1.9, life: 10, swash: 2.6 };
export const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
export function seaOf(tiles, harbours, sc) {
  const r = rng(77), ring = coastRing(tiles), coast = polyPath(ring), B = SEA.beach;
  const segs = ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
  const dist = (x, y) => { let m = 1e9; for (const [a, b] of segs) { const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1); m = Math.min(m, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return m; };
  const inside = (x, y) => { let c2 = false; for (const [a, b] of segs) if ((a[1] > y) !== (b[1] > y) && x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])) c2 = !c2; return c2; };
  // Along each ray from the middle: where it leaves the coast, and where the beach ends. The beach's
  // edge is the line 0.26 R off the coast, smoothed so the sand fills the bays between the tiles and
  // the shore runs in curves, never the tiles' zigzag; it never comes nearer the coast than 0.12 R.
  // Waves follow it near the shore and round out further off, as they bend round an island.
  const N = 360;
  const reach = (ux, uy, r0, d) => { let a0 = r0, b0 = r0 + d * 2.6 + 0.05; for (let q = 0; q < 20; q++) { const m = (a0 + b0) / 2; if (dist(ux * m, uy * m) < d) a0 = m; else b0 = m; } return a0; };
  const rays = Array.from({ length: N }, (_, i) => {
    const a = i * TAU / N, ux = Math.cos(a), uy = Math.sin(a);
    let lo = 0, hi = 7; for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (inside(ux * m, uy * m)) lo = m; else hi = m; }
    return { ux, uy, r0: hi, rMin: reach(ux, uy, hi, 0.12), rB: reach(ux, uy, hi, B) };
  });
  const smooth = (vals, w) => vals.map((_, i) => { let t = 0; for (let k = -w; k <= w; k++) t += vals[(i + k + N) % N]; return t / (2 * w + 1); });
  let rb = smooth(smooth(rays.map((ray) => ray.rB), 9), 9).map((v, i) => Math.max(v, rays[i].rMin));
  rb = smooth(rb, 3).map((v, i) => Math.max(v, rays[i].rMin));
  const rr = smooth(smooth(rb, 45), 45);
  rays.forEach((ray, i) => { ray.rB = rb[i]; ray.rR = rr[i]; });
  // when each part of the shore meets a wave: the swell comes from the table's top left (-2.4 rad)
  const lag = rays.map((_, i) => { const a = i * TAU / N; return 1.6 * (1 - Math.cos(a + 2.4)) + 0.35 * Math.sin(3 * a + 1.3) + 0.35; });
  const radius = (ray, d) => d <= B ? Math.max(ray.r0 + 0.03, ray.rB - (B - d)) : lerp(ray.rB, ray.rR, clamp((d - B) / 2.6, 0, 1)) + (d - B);
  const at = (d) => rays.map((ray) => { const q = radius(ray, d); return [ray.ux * q, ray.uy * q]; });
  const sea = { rays, radius, at, ring, lag, half: 6.4, items: [], shapes: new Map() };

  // the shallows: the water lightens toward the beach
  const hs = 8, ss = 22, sh = canvasOf(2 * hs * ss, 2 * hs * ss), q = sh.getContext('2d');
  q.setTransform(ss, 0, 0, ss, hs * ss, hs * ss); q.lineJoin = 'round';
  const edge = polyPath(at(B));
  for (let k = 0; k < 20; k++) { q.strokeStyle = 'rgba(110,116,122,0.011)'; q.lineWidth = 2 * (1.3 - k * 0.062); q.stroke(edge); }
  for (let k = 0; k < 6; k++) { q.strokeStyle = 'rgba(130,136,140,0.02)'; q.lineWidth = 2 * (0.22 - k * 0.032); q.stroke(edge); }
  for (let i = 0; i < 70; i++) { const a = r() * TAU, d = 4 + r() * 4; softDot(q, Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 1.6, r() < 0.5 ? [255, 255, 255] : [0, 0, 0], 0.018); }
  sea.shallows = { c: sh, half: hs };

  // the shore: beach, wet sand and earth in the seams; transparent beyond
  const half = sea.half, c = canvasOf(2 * half * sc, 2 * half * sc), g = c.getContext('2d');
  g.setTransform(sc, 0, 0, sc, half * sc, half * sc);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.fillStyle = '#bfa982'; g.fill(edge);
  g.save(); g.clip(edge);
  for (let i = 0; i < 160; i++) { const [x, y] = ring[(r() * ring.length) | 0], j2 = 1 + (r() - 0.2) * 0.16; softDot(g, x * j2, y * j2, 0.06 + r() * 0.14, r() < 0.5 ? [236, 222, 190] : [168, 148, 112], 0.35); }
  const grain = canvasOf(96, 96), gg = grain.getContext('2d'), gq = rng(5);
  for (let i = 0; i < 900; i++) { gg.fillStyle = gq() < 0.5 ? 'rgba(255,246,222,0.32)' : 'rgba(110,88,56,0.28)'; gg.fillRect(gq() * 96, gq() * 96, gq() < 0.8 ? 1 : 2, 1); }
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = g.createPattern(grain, 'repeat'); g.fillRect(0, 0, c.width, c.height); g.restore();
  // wet sand toward the water, darkest at the edge, with a glisten along it
  for (let k = 0; k < 12; k++) { g.strokeStyle = 'rgba(70,58,42,0.075)'; g.lineWidth = 2 * (0.15 - k * 0.012); g.stroke(edge); }
  // the tide line: wrack and shells along the top of the wet sand
  const tide = at(B * 0.42);
  for (let i = 0; i < tide.length; i += 2) { const [x, y] = tide[i], j2 = 1 + (r() - 0.5) * 0.012; if (r() < 0.55) fillCircles(g, [[x * j2, y * j2, 0.006 + r() * 0.008]], r() < 0.7 ? 'rgba(78,66,48,0.55)' : 'rgba(246,240,226,0.8)'); }
  // shade at the foot of the tiles, and grit and grass where the land meets the sand
  for (let k = 0; k < 10; k++) { g.strokeStyle = 'rgba(52,38,24,0.075)'; g.lineWidth = 2 * (0.11 - k * 0.01); g.stroke(coast); }
  const near = at(0.05);
  for (let i = 0; i < 160; i++) {
    const [x, y] = near[(r() * N) | 0], l = Math.hypot(x, y) || 1, j2 = (r() - 0.3) * 0.12, px = x + x / l * j2, py = y + y / l * j2;
    if (r() < 0.55) fillCircles(g, [[px, py, 0.007 + r() * 0.01]], r() < 0.5 ? 'rgba(150,138,118,0.8)' : 'rgba(92,80,66,0.8)');
    else { g.strokeStyle = 'rgba(106,132,64,0.8)'; g.lineWidth = 0.008; g.beginPath(); g.moveTo(px, py); g.lineTo(px - 0.02, py - 0.035); g.moveTo(px, py); g.lineTo(px + 0.006, py - 0.04); g.moveTo(px, py); g.lineTo(px + 0.025, py - 0.03); g.stroke(); }
  }
  g.restore();
  g.fillStyle = '#3d3022'; g.fill(coast);
  // ports: a jetty on piles (a standing piece, drawn for each seat), the water dark where each pile
  // meets it; every pile in the water is kept with the moment a wave reaches it, for paintPiles
  sea.piles = [];
  harbours.forEach(({ x, y, e, type: t }) => {
    const na = (-60 + 60 * e) * Math.PI / 180, nx = Math.cos(na), ny = Math.sin(na), qx = -ny, qy = nx;
    const mx = x + nx * 0.866, my = y + ny * 0.866;
    const pos = (a, b) => [mx + nx * a + qx * b, my + ny * a + qy * b];
    JETTY.piles.forEach(([a, b]) => {
      const [px, py] = pos(a, b), rp = Math.hypot(px, py), i = ((Math.round(Math.atan2(py, px) / TAU * N) % N) + N) % N, ray = rays[i];
      if (rp < sea.radius(ray, B) + 0.02) return;
      softFill(g, ellipsePath(px + 0.006, py + 0.006, 0.03, 0.03), 'rgba(0,0,0,0.5)', 0.012);
      // how far a wave has come (waveAt) when its crest reaches this pile: invert radius, then waveD
      let lo = B, hi = SEA.far; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (sea.radius(ray, m) < rp) lo = m; else hi = m; }
      const p = 1 - Math.pow(Math.max(0, lo - B - 0.035) / (SEA.far - B), 1 / 1.35);
      sea.piles.push({ x: px, y: py, ux: ray.ux, uy: ray.uy, i, p, k: sea.piles.length * 5 + 11, st: 0.55 + 0.45 * clamp((p - 0.6) / 0.35, 0, 1) });
    });
    sea.items.push({ t: 'jetty', x: mx, y: my, lift: 0, yaw: na, key: 'jetty', span: [nx * 1.02, ny * 1.02] });
    // a lantern on the sand either side of the jetty's foot, clear of the corners where towns stand;
    // its light lies on the beach itself, so the tiles in front of it cover it as they should
    [-1, 1].forEach((sd) => {
      const [lx, ly] = pos(0.12, sd * 0.25), pool = g.createRadialGradient(lx, ly, 0, lx, ly, 0.17);
      pool.addColorStop(0, 'rgba(255,196,112,0.34)'); pool.addColorStop(1, 'rgba(255,196,112,0)');
      g.fillStyle = pool; g.fillRect(lx - 0.17, ly - 0.17, 0.34, 0.34);
      sea.items.push({ t: 'lantern', x: lx, y: ly, lift: 0, key: 'lantern' });
    });
    const [px, py] = pos(0.86, 0);
    sea.items.push({ t: 'plaque', x: px, y: py, lift: JETTY.deck, res: t === 'any' ? null : t, key: 'plaque' + t });
  });
  sea.shore = c;
  return sea;
}
// Where wave `n` is along ray `i` at time `t`: its progress (0 far out, 1 at the beach, more once it
// has broken). The swell comes from the top left of the table and wraps round the island, so each
// wave meets the far shore up to about 3 s after the near one, and breaks along the beach in a sweep.
export const waveAt = (sea, n, i, t) => (t - n * SEA.period + sea.lag[i]) / SEA.life;
export const waveD = (p) => SEA.beach + 0.035 + (SEA.far - SEA.beach) * Math.pow(1 - clamp(p, 0, 1), 1.35);
// Each wave's own shape round the island (how it wobbles, and where its crest is broken), worked out
// once when the wave appears and kept while it lasts.
export function shapeOf(sea, n) {
  let w = sea.shapes.get(n);
  if (w) return w;
  const N = sea.rays.length, h1 = hash(n, 1) * TAU, h2 = hash(n, 2) * TAU, h3 = hash(n, 3) * TAU, wob = new Float32Array(N), gap = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = i * TAU / N;
    wob[i] = Math.sin(a * (3 + (n % 3)) + h1) * 0.55 + Math.sin(a * (7 + (n % 4)) + h2) * 0.3 + Math.sin(a * 17 + h3) * 0.15;
    gap[i] = Math.sin(a * 9 + h3) * 0.6 + Math.sin(a * 21 + h1) * 0.4;
  }
  w = { wob, gap };
  sea.shapes.set(n, w);
  for (const k of sea.shapes.keys()) if (k < n - 12) sea.shapes.delete(k);
  return w;
}
// One frame of the sea at `t` seconds, on the ground (inside onGround). The rings are drawn in arcs
// of a few degrees, each styled by how far its stretch of the wave has come.
export function paintSea(g, sea, t) {
  const B = SEA.beach, S0 = sea.shallows, rays = sea.rays, N = rays.length, A = 12;
  g.drawImage(S0.c, -S0.half, -S0.half, 2 * S0.half, 2 * S0.half);
  g.lineJoin = 'round'; g.lineCap = 'butt';
  const first = Math.floor((t - SEA.life - SEA.swash - 0.5) / SEA.period), last = Math.floor((t + 3.8) / SEA.period);
  const arc = (s0, f, p = new Path2D(), back = false) => {
    for (let k = 0; k <= A; k++) {
      const kk = back ? A - k : k, i = (s0 + kk) % N, ray = rays[i], rr = f(i, ray);
      if (rr === null) continue;
      const x = ray.ux * rr, y = ray.uy * rr;
      if (k && rr !== null) p.lineTo(x, y); else p.moveTo(x, y);
    }
    return p;
  };
  // waves rolling in, the farthest first
  for (let n = last; n >= first; n--) {
    for (let s0 = 0; s0 < N; s0 += A) {
      const pm = waveAt(sea, n, (s0 + A / 2) % N, t);
      if (pm < 0 || pm >= 1) continue;
      const fade = clamp(pm / 0.25, 0, 1) * clamp((1 - pm) / 0.05, 0, 1), amp = 0.05 * (1 - pm) + 0.006, W = shapeOf(sea, n);
      const ring = (off, thr) => arc(s0, (i, ray) => (thr > -1 && W.gap[i] < thr ? null : sea.radius(ray, waveD(waveAt(sea, n, i, t)) + off) + amp * W.wob[i]));
      // a swell: a soft lit face toward the shore and a darker trough behind it
      g.strokeStyle = `rgba(0,0,0,${(0.1 * fade).toFixed(3)})`; g.lineWidth = 0.12; g.stroke(ring(0.08, -1));
      g.strokeStyle = `rgba(190,196,202,${((0.022 + 0.04 * pm) * fade).toFixed(3)})`; g.lineWidth = 0.09 - 0.05 * pm; g.stroke(ring(-0.015, -1));
      // then a crest that sharpens and whitens as it nears the shore, broken until it closes up
      if (pm > 0.42) {
        const k = (pm - 0.42) / 0.58, crest = ring(0, 0.1 - 1.3 * pm);
        g.strokeStyle = `rgba(176,182,188,${(0.32 * k * fade).toFixed(3)})`; g.lineWidth = 0.016 + 0.014 * k; g.stroke(crest);
        if (pm > 0.8) { const b = (pm - 0.8) / 0.2; g.strokeStyle = `rgba(240,242,244,${(0.7 * b * fade).toFixed(3)})`; g.lineWidth = 0.014 + 0.03 * b; g.stroke(crest); }
      }
    }
  }
  g.drawImage(sea.shore, -sea.half, -sea.half, 2 * sea.half, 2 * sea.half);
  if (sea.piles && sea.piles.length) paintPiles(g, sea, t);
  // each wave that has broken runs up the beach and slides back, leaving the sand dark for a moment
  for (let n = first; n <= last; n++) {
    const run = 0.11 + 0.06 * hash(n, 4);
    const sOf = (i) => clamp((waveAt(sea, n, i, t) - 1) * SEA.life / SEA.swash, 0, 1);
    const up = (s) => (s < 0.4 ? easeOut(s / 0.4) : 1 - Math.pow((s - 0.4) / 0.6, 1.6));
    for (let s0 = 0; s0 < N; s0 += A) {
      const sm = (waveAt(sea, n, (s0 + A / 2) % N, t) - 1) * SEA.life / SEA.swash;
      if (sm < 0 || sm >= 1) continue;
      const W = shapeOf(sea, n), edgeR = (i, ray) => sea.radius(ray, B - run * up(sOf(i))) + 0.008 * W.wob[i];
      const wet = arc(s0, (i, ray) => sea.radius(ray, B)); arc(s0, (i, ray) => sea.radius(ray, B - run * Math.min(1, sOf(i) / 0.4)), wet, true); wet.closePath();
      g.fillStyle = `rgba(44,36,26,${(0.3 * (1 - sm)).toFixed(3)})`; g.fill(wet);
      const sheet = arc(s0, (i, ray) => sea.radius(ray, B + 0.03)); arc(s0, edgeR, sheet, true); sheet.closePath();
      g.fillStyle = `rgba(214,220,224,${(0.26 * (1 - sm)).toFixed(3)})`; g.fill(sheet);
      g.strokeStyle = `rgba(248,249,250,${(0.75 * (1 - sm) * (sm < 0.5 ? 1 : 0.6)).toFixed(3)})`; g.lineWidth = 0.014; g.stroke(arc(s0, edgeR));
    }
  }
}
// The waves against the jetties' piles. As each crest reaches a pile it heaps up white on the pile's
// seaward side and throws a few drops ahead of it; the water parts round the pile in a short wake
// toward the shore, and a ring spreads from the pile as the wave runs on. Between waves the water
// laps round each pile, rising as the swell comes. The nearer the beach, the harder a wave breaks.
// Everything is gathered into a few paths by kind and strength, so the piles cost a handful of strokes.
export function paintPiles(g, sea, t) {
  const P = SEA.period, Q = 12, pens = new Map(), lap = new Path2D();
  const pen = (kind, a) => { const q = Math.round(clamp(a, 0, 1) * Q); if (!q) return null; const key = kind + q; let p = pens.get(key); if (!p) pens.set(key, p = new Path2D()); return p; };
  const ring = (p, x, y, rr, a0 = 0, a1 = TAU) => { p.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr); p.arc(x, y, rr, a0, a1); };
  for (const s of sea.piles) {
    const base = t + sea.lag[s.i] - s.p * SEA.life, n0 = Math.floor(base / P), tau0 = base - n0 * P, th = Math.atan2(s.uy, s.ux);
    ring(lap, s.x, s.y, 0.028 + 0.006 * (0.5 + 0.5 * Math.cos(TAU * Math.min(tau0 / P, 1))));
    for (let back = 0; back < 2; back++) {
      const tau = tau0 + back * P, n = n0 - back, st = s.st * (0.8 + 0.4 * hash(n, s.k));
      if (tau < 0.7) {
        const f = tau / 0.7;
        // white water heaped against the pile: a crescent that swells, then thins as it slides round
        const ro = 0.027 + 0.026 * easeOut(Math.min(1, f * 1.6)), sp = 1.4 + 0.4 * f, ri = 0.022 + 0.016 * f;
        const white = pen('white', 0.2 * st * (1 - f) ** 1.1), foam = pen('foam', 0.42 * st * (1 - f) ** 1.2);
        if (white) { ring(white, s.x, s.y, ro, th - sp, th + sp); white.arc(s.x + s.ux * 0.012 * (1 - f), s.y + s.uy * 0.012 * (1 - f), ri, th + sp, th - sp, true); white.closePath(); }
        if (foam) ring(foam, s.x, s.y, ro, th - sp, th + sp);
        const drop = pen('drop', 0.4 * st * (1 - f));
        if (drop) for (let k = 0; k < 4; k++) {
          const h1 = hash(n * 7 + k, s.k), h2 = hash(n * 7 + k, s.k + 3), a = th + (h1 - 0.5) * 2.4, d = 0.034 + (0.02 + 0.045 * h2) * (1 - (1 - f) ** 2);
          ring(drop, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, (0.004 + 0.003 * h2) * (1 - 0.5 * f));
        }
      }
      if (tau > 0.05 && tau < 1.1) {
        const f = (tau - 0.05) / 1.05, l = 0.03 + 0.05 * easeOut(f), wake = pen('wake', 0.24 * st * (1 - f));
        if (wake) for (const sg of [-1, 1]) {
          const c = th + sg * 1.5, a = th + Math.PI - sg * 0.38, x0 = s.x + Math.cos(c) * 0.028, y0 = s.y + Math.sin(c) * 0.028;
          wake.moveTo(x0, y0); wake.quadraticCurveTo(x0 + Math.cos(a) * l * 0.5 + Math.cos(c) * 0.012, y0 + Math.sin(a) * l * 0.5 + Math.sin(c) * 0.012, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l);
        }
      }
      const fr = (tau - 0.15) / 1.6;
      if (fr > 0 && fr < 1) { const rr = 0.035 + 0.1 * Math.pow(fr, 0.7), p = pen('ring', 0.2 * st * (1 - fr) ** 1.6); if (p) ring(p, s.x - s.ux * 0.04 * fr, s.y - s.uy * 0.04 * fr, rr); }
    }
  }
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(206,212,218,0.11)'; g.lineWidth = 0.006; g.stroke(lap);
  const LOOK = { white: [true, '226,232,236'], foam: [false, '246,248,250', 0.009], drop: [true, '240,244,246'], wake: [false, '226,230,234', 0.008], ring: [false, '204,210,216', 0.007] };
  for (const [key, p] of pens) {
    const kind = key.replace(/\d+$/, ''), a = (+key.slice(kind.length) / Q).toFixed(3), [fill, rgb, w] = LOOK[kind];
    if (fill) { g.fillStyle = `rgba(${rgb},${a})`; g.fill(p); } else { g.strokeStyle = `rgba(${rgb},${a})`; g.lineWidth = w; g.stroke(p); }
  }
  g.lineCap = 'butt';
}
// The island as the game has it, { tiles: [{ q, r, res, num }], harbours: [{ q, r, e, type }] }:
// its tiles, each planned and painted once from a seed of its place (so every device paints the
// same island), and the sea with its ports. Centred on the middle of its tiles, where the sea's rays
// start. withPieces adds the buildings and roads of the moment; the tiles and the sea are kept.
export function islandScene(island, sc) {
  const at = island.tiles.map(({ q, r }) => axial(q, r));
  const cx = at.reduce((s, p) => s + p[0], 0) / at.length, cy = at.reduce((s, p) => s + p[1], 0) / at.length;
  const tiles = island.tiles.map(({ q, r, res, num }, i) => makeTile(q, r, res, num, 1000 + i * 97, sc, at[i][0] - cx, at[i][1] - cy));
  const harbours = (island.harbours || []).map(({ q, r, e, type }) => { const [x, y] = axial(q, r); return { x: x - cx, y: y - cy, e, type }; });
  const sea = seaOf(tiles, harbours, Math.min(sc, 160));
  return { tiles, sea, offset: [cx, cy], sc };
}
export function withPieces(base, buildings, roads, extra = []) {
  const scene = sceneOf(base.tiles, buildings, roads, base.sc);
  scene.items.push(...base.sea.items, ...extra);
  scene.sea = base.sea;
  scene.offset = base.offset;
  return scene;
}
// One tile on its own, under a soft shadow, for a picture of a tile away from the island.
export function tileScene(res, num, seed, sc) {
  const scene = sceneOf([makeTile(0, 0, res, num, seed, sc, 0, 0)], [], [], sc);
  scene.under = true;
  return scene;
}

// ---- drawing --------------------------------------------------------------------------------
export function itemSprite(it, v) {
  const def = T[it.t];
  let rho = 0, bucket = 0;
  if (def.yawed) { const n = def.buckets || 48; bucket = Math.round(wrap(yawFor(def, it, v) - v.phi) / TAU * n) % n; rho = bucket * TAU / n; }
  return { def, o: Object.assign({}, it, { rho }), key: it.t + '#' + (it.key || '') + '#' + bucket };
}
export function spriteFor(it, v, sc) {
  const { def, o, key } = itemSprite(it, v);
  return spriteOf(key, sc, def.box(o), (g) => def.draw(g, o));
}
// A shadow on the ground: a solid's every part pushed down and to the right by its height, and a
// darker contact patch where it stands; a flat sprite's silhouette sheared the same way.
export function shadowFor(it, v, sc) {
  const def = T[it.t];
  if (def.solid) {
    const n = 12, bucket = Math.round(wrap(yawFor(def, it, v) - v.phi) / TAU * n) % n, rho = bucket * TAU / n, S = solidOf(it), m = S.maxR, z = S.maxZ;
    return spriteOf('sh:' + it.t + '#' + (it.key || '') + '#' + bucket, sc, [-m - 0.06, -K * m - 0.06, m + 0.55 * z + 0.06, K * m + 0.28 * z + 0.06], (g) => {
      softFill(g, solidShadow(S.prims, rho), 'rgba(16,12,34,0.32)', 0.02);
      softFill(g, ellipsePath(0, 0, S.foot * 0.95, S.foot * 0.95 * K), 'rgba(8,6,16,0.32)', 0.014);
    });
  }
  if (!def.shadow) return null;
  const { o, key } = itemSprite(it, v), b = def.box(o), H = -b[1];
  const box = def.shadowFinal ? [b[0] - 0.06, -0.32, b[2] + 0.32, 0.46] : [b[0] - 0.55 * b[3] - 0.07, -0.28 * b[3] - 0.07, b[2] + 0.55 * H + 0.07, 0.28 * H + 0.07];
  return spriteOf('sh:' + key, sc, box, (g) => {
    if (!def.shadowFinal) g.transform(1, 0, -0.55, -0.28, 0, 0);
    softFill(g, def.shadow(o), 'rgba(16,12,34,0.36)', def.shadowFinal ? 0.02 : 0.05);
  });
}
// Static drawings paint straight onto their canvas, at the exact angle, and keep nothing.
export function drawDirect(ctx, it, v, shadow) {
  const def = T[it.t], rho = def.yawed ? wrap(yawFor(def, it, v) - v.phi) : 0, o = Object.assign({}, it, { rho }), [x, y] = v.p(it.x, it.y);
  ctx.save(); ctx.translate(x, y - (it.lift || 0)); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (!shadow) def.draw(ctx, o);
  else if (def.solid) {
    const S = solidOf(it);
    softFill(ctx, solidShadow(S.prims, rho), 'rgba(16,12,34,0.32)', 0.02);
    softFill(ctx, ellipsePath(0, 0, S.foot * 0.95, S.foot * 0.95 * K), 'rgba(8,6,16,0.32)', 0.014);
  } else if (def.shadow) {
    if (!def.shadowFinal) ctx.transform(1, 0, -0.55, -0.28, 0, 0);
    softFill(ctx, def.shadow(o), 'rgba(16,12,34,0.36)', def.shadowFinal ? 0.02 : 0.05);
  }
  ctx.restore();
}
export function drawItem(ctx, it, v, sc) {
  const s = spriteFor(it, v, sc), [x, y] = v.p(it.x, it.y);
  ctx.drawImage(s.c, x - s.ax, y - (it.lift || 0) - s.ay, s.w, s.h);
}
export function drawShadowOf(ctx, it, v, sc) {
  const s = shadowFor(it, v, sc);
  if (!s) return;
  const [x, y] = v.p(it.x, it.y);
  ctx.drawImage(s.c, x - s.ax, y - (it.lift || 0) - s.ay, s.w, s.h);
}
// Paint ahead, in small slices, every angle the next swing of the view will pass through.
export function prewarm(scene, from, to, sc, steps = 12) {
  const items = scene.items.filter((it) => T[it.t].yawed), total = items.length * steps;
  let k = 0;
  const job = () => {
    const t0 = performance.now();
    while (k < total && performance.now() - t0 < 6) {
      const st = Math.floor(k / items.length), it = items[k % items.length], v = makeView(from + (to - from) * (st + 1) / steps);
      spriteFor(it, v, sc); shadowFor(it, v, sc);
      k++;
    }
    if (k < total) setTimeout(job, 4);
  };
  setTimeout(job, 250);
}
export function drawSlab(ctx, v, t, lit) {
  const base = TILE_POLY.map(({ p }) => v.p(t.x + p[0], t.y + p[1])), side = rgbOf(SIDE[t.res]), n = TILE_POLY.length;
  for (let i = 0; i < n; i++) {
    const nv = v.rot(...TILE_POLY[i].n);
    if (nv[1] <= 0.01) continue;
    const a = base[i], b = base[(i + 1) % n], col = css(litC(side, 0.8 - 0.3 * nv[0] - 0.1 * nv[1]));
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - SLAB); ctx.lineTo(b[0], b[1] - SLAB); ctx.lineTo(b[0], b[1]); ctx.lineTo(a[0], a[1]); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.004; ctx.stroke();
  }
  onGround(ctx, v, SLAB, () => ctx.drawImage(t.tex.c, t.x - 1, t.y - 1, 2, 2));
  ctx.lineWidth = 0.022;
  for (let i = 0; i < n; i++) {
    const nv = v.rot(...TILE_POLY[i].n), l = -(nv[0] * 0.75 + nv[1] * 0.66);
    if (Math.abs(l) < 0.2) continue;
    const a = base[i], b = base[(i + 1) % n];
    ctx.strokeStyle = l > 0 ? `rgba(255,244,222,${(0.2 * l).toFixed(3)})` : `rgba(16,10,4,${(-0.32 * l).toFixed(3)})`;
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - SLAB); ctx.lineTo(b[0], b[1] - SLAB); ctx.stroke();
  }
  if (lit && t.num === lit) {
    const top = polyPath(base.map(([x, y]) => [x, y - SLAB]));
    [[0.14, 0.12], [0.07, 0.3], [0.026, 0.95]].forEach(([w, a]) => { ctx.lineWidth = w; ctx.strokeStyle = `rgba(255,226,160,${a})`; ctx.stroke(top); });
  }
}
// ---- number tokens: brass medallions ---------------------------------------------------------
// A token is a struck brass disc lying flat in the clearing: a milled edge, a rim with two slopes
// (the outer one catches the light at its top left, the inner one at its bottom right), a sunken
// enamel face engraved like a watch dial, a raised serif numeral, and its odds as studs on an arc
// under it. It is round, lit from the viewer's top left and its numeral faces the viewer, so it
// looks the same from every seat: each number is painted once per state and laid as a sprite.
export const LIGHT_A = Math.atan2(-0.66, -0.75);   // where the light comes from, on the ground: top left
export const TOKEN_E = 0.04;                       // the disc's thickness
export const RIM = {
  brass: { hi: '#fff3cc', up: '#e6c47a', mid: '#b08a46', lo: '#4e3918' },
  lit: { hi: '#fffdf2', up: '#fbe4a4', mid: '#dcb262', lo: '#8f6829' },
};
// Brightest at `a0`, darkest opposite (a linear gradient where conic ones are missing).
export function conicOr(g, a0, r, stops) {
  if (g.createConicGradient) { const gr = g.createConicGradient(a0, 0, 0); stops.forEach(([t, c]) => gr.addColorStop(t, c)); return gr; }
  const gr = g.createLinearGradient(Math.cos(a0) * r, Math.sin(a0) * r, -Math.cos(a0) * r, -Math.sin(a0) * r);
  stops.filter(([t]) => t <= 0.5).forEach(([t, c]) => gr.addColorStop(t * 2, c));
  return gr;
}
export function ringPath(r0, r1) { const p = new Path2D(); p.arc(0, 0, r0, 0, TAU); p.moveTo(r1, 0); p.arc(0, 0, r1, 0, -TAU, true); return p; }
// One medallion centred at 0 on whatever it lies on; `k` is its foreshortening (1 = face on).
//   o: { r, k, e (thickness shown below it), num, hot, on (lit up), pips, fs (numeral size in r),
//        ny (numeral centre below the face's, in r), maxW (widest numeral, in r) }
// The rolled number on its own, where the dice stopped: the numeral alone in the serif at its heaviest,
// lit gold from the top, or red for a 7, with only a soft shadow under it so it reads over the veil.
export function paintRollNumber(g, n, R) {
  const s = R * 2.05, y = s * 0.355, m = g.getTransform(), k = Math.hypot(m.a, m.b);
  g.save(); g.font = `800 ${s.toFixed(1)}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const gr = g.createLinearGradient(0, y - s * 0.72, 0, y);
  if (n === 7) { gr.addColorStop(0, '#ff9c86'); gr.addColorStop(0.55, '#f0654a'); gr.addColorStop(1, '#b8341f'); }
  else { gr.addColorStop(0, '#fff6dc'); gr.addColorStop(0.5, '#f2dca2'); gr.addColorStop(1, '#c9a961'); }
  g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = R * 0.22 * k; g.shadowOffsetX = R * 0.04 * k; g.shadowOffsetY = R * 0.08 * k;
  g.fillStyle = gr; g.fillText(String(n), 0, y);
  g.restore();
}
export function paintMedal(g, o) {
  const r = o.r, k = o.k ?? 1, e = o.e ?? 0, on = !!o.on, hot = !!o.hot, rFace = r * 0.79, B = on ? RIM.lit : RIM.brass;
  // the milled edge: the near half of the disc's side, lit from the left like a short cylinder
  if (e > 0) {
    const side = new Path2D();
    side.ellipse(0, 0, r, r * k, 0, 0, Math.PI); side.ellipse(0, -e, r, r * k, 0, Math.PI, 0, true); side.closePath();
    const sg = g.createLinearGradient(-r, 0, r, 0);
    sg.addColorStop(0, on ? '#fde6a8' : '#d9b46a'); sg.addColorStop(0.35, on ? '#dcb468' : '#9c773a'); sg.addColorStop(1, on ? '#86622a' : '#33240f');
    g.fillStyle = sg; g.fill(side);
    g.save(); g.clip(side); g.lineWidth = r * 0.018;
    for (let i = 1; i < 52; i++) {
      const a = i * Math.PI / 52, x = Math.cos(a) * r, y = Math.sin(a) * r * k;
      g.strokeStyle = i % 2 ? 'rgba(255,244,214,0.3)' : 'rgba(26,16,6,0.42)';
      g.beginPath(); g.moveTo(x, y + r * 0.05); g.lineTo(x, y - e - r * 0.05); g.stroke();
    }
    g.restore();
  }
  g.save(); g.translate(0, -e); g.scale(1, k);
  // the rim: the outer slope faces the light at its top left, the inner slope at its bottom right
  g.fillStyle = conicOr(g, LIGHT_A, r, [[0, B.hi], [0.15, B.up], [0.5, B.lo], [0.85, B.up], [1, B.hi]]);
  g.fill(ringPath(r, r * 0.895));
  g.fillStyle = conicOr(g, LIGHT_A + Math.PI, r, [[0, B.up], [0.2, B.mid], [0.5, B.lo], [0.8, B.mid], [1, B.up]]);
  g.fill(ringPath(r * 0.895, rFace));
  g.lineCap = 'round';
  g.lineWidth = r * 0.014; g.strokeStyle = 'rgba(255,250,232,0.6)'; g.beginPath(); g.arc(0, 0, r * 0.895, LIGHT_A - 1.1, LIGHT_A + 1.1); g.stroke();
  g.lineWidth = r * 0.016; g.strokeStyle = 'rgba(36,22,6,0.5)'; g.beginPath(); circle(g, 0, 0, r * 0.992); g.stroke();
  // the sunken face: dark enamel, or lit like a lantern when its number is rolled
  const face = new Path2D(); face.arc(0, 0, rFace, 0, TAU);
  const fg = g.createRadialGradient(-rFace * 0.25, -rFace * 0.3, 0, 0, 0, rFace * 1.04);
  if (on) { fg.addColorStop(0, '#fffdf5'); fg.addColorStop(0.55, '#fcefc9'); fg.addColorStop(1, '#efc877'); }
  else { fg.addColorStop(0, '#2d2722'); fg.addColorStop(0.6, '#191512'); fg.addColorStop(1, '#0f0c0a'); }
  g.fillStyle = fg; g.fill(face);
  g.save(); g.clip(face);
  // engraved like a watch dial: a fine sunburst from the middle
  g.lineWidth = r * 0.009;
  for (let i = 0; i < 64; i++) {
    const a = i * TAU / 64;
    g.strokeStyle = on ? (i % 2 ? 'rgba(170,112,30,0.12)' : 'rgba(255,255,255,0.3)') : (i % 2 ? 'rgba(255,232,180,0.07)' : 'rgba(0,0,0,0.3)');
    g.beginPath(); g.moveTo(Math.cos(a) * rFace * 0.1, Math.sin(a) * rFace * 0.1); g.lineTo(Math.cos(a) * rFace, Math.sin(a) * rFace); g.stroke();
  }
  // a soft sheen across the lacquer
  const sh = g.createLinearGradient(-rFace, -rFace, rFace, rFace);
  sh.addColorStop(0.16, 'rgba(255,244,220,0)'); sh.addColorStop(0.3, `rgba(255,244,220,${on ? 0.32 : 0.08})`); sh.addColorStop(0.46, 'rgba(255,244,220,0)');
  g.fillStyle = sh; g.fillRect(-rFace, -rFace, 2 * rFace, 2 * rFace);
  // the rim's wall shades the face along its top left
  const hole = new Path2D(); hole.rect(-r * 3, -r * 3, r * 6, r * 6); hole.moveTo(rFace + r * 0.05, r * 0.06); hole.arc(r * 0.05, r * 0.06, rFace, 0, -TAU, true);
  softFill(g, hole, on ? 'rgba(130,78,12,0.45)' : 'rgba(0,0,0,0.8)', r * 0.07);
  g.restore();
  g.restore();
  // the numeral stands proud of the face: a shadow down and to the right, a lit edge at the top left
  if (o.num !== undefined) {
    const txt = String(o.num), F = r * (o.fs ?? 1.2), U = F / 100, sq = k < 1 ? 0.86 : 1;
    g.save(); g.translate(0, -e + r * (o.ny ?? 0)); g.scale(U, U * sq);
    g.font = `800 100px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const m = g.measureText(txt), asc = m.actualBoundingBoxAscent || 70, maxW = (o.maxW ?? 1.25) * r / U;
    if (m.width > maxW) g.scale(maxW / m.width, 1);
    const y = asc / 2, d = 0.032 * r / U;
    g.fillStyle = on ? 'rgba(140,84,14,0.4)' : 'rgba(0,0,0,0.75)'; g.fillText(txt, d, y + d);
    g.fillStyle = on ? 'rgba(255,255,255,0.85)' : hot ? 'rgba(255,214,196,0.95)' : 'rgba(255,255,255,0.95)'; g.fillText(txt, -d * 0.45, y - d * 0.45);
    const ng = g.createLinearGradient(0, y - asc, 0, y), ink = on ? (hot ? ['#d4391f', '#9c2310'] : ['#45301a', '#1f150b']) : hot ? ['#ff8b69', '#e8462c'] : ['#fffbf2', '#eadcbc'];
    ng.addColorStop(0, ink[0]); ng.addColorStop(1, ink[1]);
    g.fillStyle = ng; g.fillText(txt, 0, y);
    g.restore();
  }
  // the odds: studs on an arc under the numeral, brass, or rubies on the 6 and the 8
  const n = o.pips || 0;
  if (n) {
    const pr = r * 0.062, rp = rFace * 0.75, step = 0.27;
    const C = on ? ['#b88a4a', '#6b4a20', '#2e1e0c'] : hot ? ['#ffd2c2', '#ec4f36', '#5c100a'] : ['#fff2c8', '#d0ab62', '#5a4120'];
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i - (n - 1) / 2) * step, x = Math.cos(a) * rp, y = -e + Math.sin(a) * rp * k;
      g.fillStyle = on ? 'rgba(120,70,10,0.35)' : 'rgba(0,0,0,0.7)'; g.beginPath(); circle(g, x + pr * 0.28, y + pr * 0.34, pr); g.fill();
      const pg = g.createRadialGradient(x - pr * 0.35, y - pr * 0.4, pr * 0.05, x, y, pr);
      pg.addColorStop(0, C[0]); pg.addColorStop(0.5, C[1]); pg.addColorStop(1, C[2]);
      g.fillStyle = pg; g.beginPath(); circle(g, x, y, pr); g.fill();
    }
  }
}
export function paintToken(g, num, on) {
  const r = RT;
  if (on) {
    // the rolled number glows: a pool of warm light on the clearing and a bloom round the disc
    g.save(); g.scale(1, K);
    const pool = g.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 2.1);
    pool.addColorStop(0, 'rgba(255,214,140,0.6)'); pool.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = pool; g.fillRect(-r * 2.2, -r * 2.2, r * 4.4, r * 4.4);
    g.restore();
    softFill(g, ellipsePath(0, -TOKEN_E, r * 1.1, r * K * 1.1), 'rgba(255,222,150,0.95)', 0.1);
  }
  softFill(g, ellipsePath(0.024, 0.02, r * 1.02, r * K * 1.05), 'rgba(10,8,22,0.55)', 0.035);
  softFill(g, ellipsePath(0.005, 0.006, r * 1.005, r * K * 1.005), 'rgba(6,4,10,0.6)', 0.01);
  paintMedal(g, { r, k: K, e: TOKEN_E, num, hot: num === 6 || num === 8, on, pips: PIPS[num] || 0, fs: 1.18, ny: -0.13 });
}
export const TOKEN_BOX = [-RT * 2.25, -RT * K * 2.25 - TOKEN_E, RT * 2.25, RT * K * 2.25 + 0.04];
// While a rolled number is lit, every other token steps back (`dim`, 0 to 1): its darkened picture,
// painted once like the others, is laid over it.
export const TOKEN_DIM = 0.6;
export function drawToken(ctx, v, t, lit, sc, dim = 0) {
  const [x, y0] = v.p(t.x, t.y), y = y0 - SLAB, on = lit === t.num;
  if (!sc) { ctx.save(); ctx.translate(x, y); paintToken(ctx, t.num, on); ctx.restore(); return; }
  const s = spriteOf('token|' + t.num + '|' + (on ? 1 : 0), sc, TOKEN_BOX, (g) => paintToken(g, t.num, on));
  ctx.drawImage(s.c, x - s.ax, y - s.ay, s.w, s.h);
  if (dim > 0 && lit && !on) {
    const d = spriteOf('token|' + t.num + '|dim', sc, TOKEN_BOX, (g) => {
      paintToken(g, t.num, false);
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(14,12,10,${TOKEN_DIM})`;
      g.fillRect(TOKEN_BOX[0] - 0.05, TOKEN_BOX[1] - 0.05, TOKEN_BOX[2] - TOKEN_BOX[0] + 0.1, TOKEN_BOX[3] - TOKEN_BOX[1] + 0.1);
    });
    ctx.save(); ctx.globalAlpha *= dim; ctx.drawImage(d.c, x - d.ax, y - d.ay, d.w, d.h); ctx.restore();
  }
}
export function drawRoads(ctx, v, scene) {
  const list = scene.roads.slice().sort((a, b) => v.d(...a.mid) - v.d(...b.mid));
  for (const rd of list) if ((rd.th ?? ROAD_TH) > 0.008) softFill(ctx, polyPath(rd.poly.map((p) => { const [x, y] = v.p(p[0], p[1]); return [x + 0.02, y - SLAB + 0.016]; })), 'rgba(12,8,24,0.5)', 0.02);
  for (const rd of list) {
    const P = rd.poly.map((p) => v.p(p[0], p[1])), side = rgbOf(rd.side || rd.col), TH = rd.th ?? ROAD_TH, W = rd.w ?? ROAD_W;
    for (let i = 0; i < P.length; i++) {
      const nv = v.rot(...rd.norms[i]);
      if (nv[1] <= 0.01) continue;
      const a = P[i], b = P[(i + 1) % P.length], col = css(litC(side, 0.56 - 0.16 * nv[0]));
      ctx.beginPath(); ctx.moveTo(a[0], a[1] - SLAB - TH); ctx.lineTo(b[0], b[1] - SLAB - TH); ctx.lineTo(b[0], b[1] - SLAB); ctx.lineTo(a[0], a[1] - SLAB); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.003; ctx.stroke();
    }
    onGround(ctx, v, SLAB + TH, () => { ctx.translate(rd.mid[0], rd.mid[1]); ctx.rotate(rd.ang); ctx.drawImage(rd.tex, -rd.len / 2, -W / 2, rd.len, W); });
  }
  for (const j of scene.junctions) {
    const [x, y0] = v.p(j.x, j.y), y = y0 - SLAB, TH = j.th ?? ROAD_TH, col = css(litC(rgbOf(j.side || j.col), 0.52));
    ctx.fillStyle = col;
    ctx.fill(ellipsePath(x, y, j.r, j.r * K));
    ctx.fillRect(x - j.r, y - TH, 2 * j.r, TH);
    onGround(ctx, v, SLAB + TH, () => ctx.drawImage(j.tex, j.x - j.r, j.y - j.r, 2 * j.r, 2 * j.r));
  }
}
export function renderScene(ctx, scene, phi, o) {
  const v = makeView(phi), sc = o.sc || o.S * DPR * (o.zoom || 1);
  ctx.save();
  ctx.translate(o.cx, o.cy);
  if (o.table) ctx.rotate(phi);
  ctx.scale(o.S, o.S);
  if (scene.sea && o.sea !== false) onGround(ctx, v, 0, () => paintSea(ctx, scene.sea, o.t ?? 7.3));
  // the island's own shadow, down and to the right, on the beach and the water
  if (scene.sea) softFill(ctx, polyPath(scene.sea.ring.map(([x, y]) => { const q = v.p(x, y); return [q[0] + 0.07, q[1] + 0.1]; })), 'rgba(0,0,0,0.5)', 0.1);
  if (scene.under) for (const t of scene.tiles) softFill(ctx, polyPath(TILE_POLY.map(({ p }) => { const [x, y] = v.p(t.x + p[0], t.y + p[1]); return [x + 0.05, y + 0.08]; })), 'rgba(0,0,0,0.7)', 0.12);
  const tiles = scene.tiles.slice().sort((a, b) => v.d(a.x, a.y) - v.d(b.x, b.y));
  for (const t of tiles) drawSlab(ctx, v, t, o.lit);
  // o.skip(it): something left out of this picture (not painted yet, or drawn moving on its own)
  const shown = o.skip ? scene.items.filter((it) => !o.skip(it)) : scene.items;
  for (const it of shown) o.direct ? drawDirect(ctx, it, v, true) : drawShadowOf(ctx, it, v, sc);
  for (const t of tiles) if (t.num) drawToken(ctx, v, t, o.lit, o.direct ? 0 : sc, o.dim || 0);
  // the robber's tile: its number goes dark until he moves again
  if (o.blocked && o.blocked.num) { const [x, y] = v.p(o.blocked.x, o.blocked.y); ctx.fillStyle = 'rgba(4,4,8,0.62)'; ctx.fill(ellipsePath(x, y - SLAB - TOKEN_E, RT * 1.02, RT * K * 1.02)); }
  drawRoads(ctx, v, scene);
  // a long thing (a jetty) is placed by its farthest point, so what stands on it comes after it
  const depth = (it) => (it.span ? Math.min(v.d(it.x, it.y), v.d(it.x + it.span[0], it.y + it.span[1])) : v.d(it.x, it.y));
  const items = shown.slice().sort((a, b) => depth(a) - depth(b));
  for (const it of items) o.direct ? drawDirect(ctx, it, v, false) : drawItem(ctx, it, v, sc);
  ctx.restore();
}
// ---------------------------------------------------------------------------------------------
// Cards, 100 x 140 units, printed on thick stock and lit like everything else on the table: from
// the top left, so each card's top and left rims catch the light and its bottom and right fall away.
// Corners are concentric with the frame's 12: a hairline inset 5 (radius 7), the art window inset 8
// (radius 4), the count badge and the tag at the corner, inset 4.5 (radius 7.5).
// Resource cards are paintings of where the resource comes from, all on one plan: the sun at the top
// left, the horizon at one height, the resource itself standing in front with its shadow falling down
// and to the right. Development cards are brass engravings on charcoal: brass is the light, so the lit
// side of a thing is cut with heavy lines and its shaded side with hairlines.
// ---------------------------------------------------------------------------------------------
export const CARD = {
  wood: { frame: '#24502f', name: 'Wood' }, brick: { frame: '#7a321f', name: 'Brick' }, wool: { frame: '#4c7631', name: 'Wool' },
  grain: { frame: '#8f6212', name: 'Grain' }, ore: { frame: '#454e5c', name: 'Ore' },
};
export const DEV = { knight: 'Knight', vp: 'Victory point', roads: 'Road building', harvest: 'Harvest', tribute: 'Tribute' };
export const BRASS = '#c9a961', BRASS_D = '#8e7440', BRASS_HI = '#f2dca2', IVORY = '#f3ecdc', INK = '#121110';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
export const WIN = [8, 8, 84, 98];          // the art window, inset 8, radius 4
export const SW = 100, SH = 117, HZ = 60;   // a painting's own units (the window at 0.84), and its horizon

// ---- the stock ------------------------------------------------------------------------------
export function stock(g, col, seed) {
  const c = rgbOf(col), frame = rrectPath(0, 0, 100, 140, 12);
  const fg = g.createLinearGradient(0, 0, 0, 140);
  fg.addColorStop(0, css(mixC(c, [255, 250, 236], 0.09))); fg.addColorStop(1, css(scaleC(c, 0.76)));
  g.fillStyle = fg; g.fill(frame);
  const sh = g.createLinearGradient(0, 0, 64, 90);
  sh.addColorStop(0, 'rgba(255,248,228,0.14)'); sh.addColorStop(1, 'rgba(255,248,228,0)');
  g.fillStyle = sh; g.fill(frame);
}
export function stockEdge(g) {
  const e = g.createLinearGradient(0, 0, 100, 140);
  e.addColorStop(0, 'rgba(255,248,228,0.5)'); e.addColorStop(0.4, 'rgba(255,248,228,0.06)');
  e.addColorStop(0.6, 'rgba(0,0,0,0.06)'); e.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.lineWidth = 1.3; g.strokeStyle = e; g.stroke(rrectPath(0.65, 0.65, 98.7, 138.7, 11.35));
}
export function hairline(g, col, w = 0.6) { g.lineWidth = w; g.strokeStyle = col; g.stroke(rrectPath(5, 5, 90, 130, 7)); }
// The window is sunk into the stock: its top-left wall in shade, its bottom-right wall catching light.
export function windowWell(g) {
  const p = rrectPath(...WIN, 4);
  const e = g.createLinearGradient(8, 8, 92, 106);
  e.addColorStop(0, 'rgba(6,4,10,0.75)'); e.addColorStop(0.45, 'rgba(6,4,10,0.12)'); e.addColorStop(0.62, 'rgba(255,248,230,0)'); e.addColorStop(1, 'rgba(255,248,230,0.42)');
  g.save(); g.clip(p); g.lineWidth = 2.2; g.strokeStyle = e; g.stroke(p); g.restore();
  const lip = g.createLinearGradient(8, 8, 92, 106);
  lip.addColorStop(0, 'rgba(0,0,0,0.38)'); lip.addColorStop(0.5, 'rgba(0,0,0,0)'); lip.addColorStop(1, 'rgba(255,248,230,0.28)');
  g.lineWidth = 0.7; g.strokeStyle = lip; g.stroke(rrectPath(7.55, 7.55, 84.9, 98.9, 4.45));
}
// The name, pressed into the stock between two brass lozenges; on resource cards, rules run out from
// them and fade toward the hairline.
export function title(g, text, y, o) {
  g.save();
  const t = o.caps ? text.toUpperCase() : text;
  let size = o.size;
  g.font = `700 ${size}px ${SERIF}`;
  // a long name is set a little smaller rather than crowding the lozenges into the hairline
  if (o.fit && g.measureText(t).width > o.fit) { size = size * o.fit / g.measureText(t).width; g.font = `700 ${size.toFixed(2)}px ${SERIF}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const ls = 'letterSpacing' in g ? (o.caps ? size * 0.15 : 0.12) : 0;
  if (ls) g.letterSpacing = ls.toFixed(2) + 'px';
  const tw = g.measureText(t).width - ls, x = 50 + ls / 2;
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(t, x + 0.2, y + 0.5);
  g.fillStyle = 'rgba(255,248,230,0.12)'; g.fillText(t, x - 0.15, y - 0.35);
  g.fillStyle = o.col; g.fillText(t, x, y);
  g.letterSpacing = '0px';
  const lx = 50 - tw / 2 - 4.6, rx = 50 + tw / 2 + 4.6, s = 1.7;
  [lx, rx].forEach((cx) => {
    const yy = y - o.size * 0.04;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill(polyPath([[cx + 0.25, yy - s + 0.45], [cx + s + 0.25, yy + 0.45], [cx + 0.25, yy + s + 0.45], [cx - s + 0.25, yy + 0.45]]));
    const b = g.createLinearGradient(cx - s, yy - s, cx + s, yy + s); b.addColorStop(0, BRASS_HI); b.addColorStop(1, BRASS_D);
    g.fillStyle = b; g.fill(polyPath([[cx, yy - s], [cx + s, yy], [cx, yy + s], [cx - s, yy]]));
  });
  if (o.rules && lx - 4 > 14) {
    const yy = y - o.size * 0.04;
    [[lx - 3.4, 11], [rx + 3.4, 89]].forEach(([a, b]) => {
      const gr = g.createLinearGradient(a, 0, b, 0); gr.addColorStop(0, 'rgba(214,186,120,0.9)'); gr.addColorStop(1, 'rgba(214,186,120,0)');
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(a + 0.2, yy + 0.45); g.lineTo(b + 0.2, yy + 0.45); g.stroke();
      g.strokeStyle = gr; g.beginPath(); g.moveTo(a, yy); g.lineTo(b, yy); g.stroke();
    });
  }
  g.restore();
}
// A rounded box whose corners differ, so a tag in the card's corner stays concentric with it.
export function rrect4(x, y, w, h, [tl, tr, br, bl]) {
  const p = new Path2D();
  p.moveTo(x + tl, y); p.lineTo(x + w - tr, y); p.quadraticCurveTo(x + w, y, x + w, y + tr);
  p.lineTo(x + w, y + h - br); p.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  p.lineTo(x + bl, y + h); p.quadraticCurveTo(x, y + h, x, y + h - bl);
  p.lineTo(x, y + tl); p.quadraticCurveTo(x, y, x + tl, y); p.closePath();
  return p;
}
export function cornerTag(g, text) {
  g.save();
  g.font = `700 6.4px ${MONO}`;
  if ('letterSpacing' in g) g.letterSpacing = '0.5px';
  const w = g.measureText(text).width + 8.5, h = 12, x = 95.5 - w, y = 4.5, p = rrect4(x, y, w, h, [3, 7.5, 3, 3]);
  softFill(g, rrect4(x + 0.4, y + 0.9, w, h, [3, 7.5, 3, 3]), 'rgba(0,0,0,0.5)', 0.9);
  const f = g.createLinearGradient(x, y, x + w * 0.6, y + h); f.addColorStop(0, '#fbf6ea'); f.addColorStop(1, '#ddd2b8');
  g.fillStyle = f; g.fill(p);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1b1a18'; g.fillText(text, x + w / 2 + 0.25, y + h / 2 + 0.3);
  g.restore();
}

// ---- painting tools (a painting's units: 100 x 117, sun at the top left) --------------------
export function skyOf(g, stops, to = HZ + 10) { const s = g.createLinearGradient(0, 0, 0, to); stops.forEach(([t, c]) => s.addColorStop(t, c)); g.fillStyle = s; g.fillRect(0, 0, SW, to + 1); }
export function sunOf(g, x, y, r, glow, core) {
  const o = g.createRadialGradient(x, y, 0, x, y, r * 6); o.addColorStop(0, glow); o.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = o; g.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
  const d = g.createRadialGradient(x, y, 0, x, y, r); d.addColorStop(0, '#fffdf4'); d.addColorStop(0.7, core); d.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = d; g.beginPath(); circle(g, x, y, r); g.fill();
}
export function beamsOf(g, x, y, col, seed) {
  const r = rng(seed);
  g.fillStyle = col;
  for (let i = 0; i < 5; i++) {
    const a = 0.42 + i * 0.2 + r() * 0.08, w = 0.035 + r() * 0.04;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a - w) * 150, y + Math.sin(a - w) * 150); g.lineTo(x + Math.cos(a + w) * 150, y + Math.sin(a + w) * 150); g.closePath(); g.fill();
  }
}
export function cloudOf(g, x, y, s, lit, shade) {
  const puffs = [[0, 0, 1], [1.05, 0.22, 0.78], [-1, 0.3, 0.7], [0.45, -0.52, 0.74], [-0.42, -0.36, 0.64], [1.75, 0.46, 0.5], [-1.7, 0.52, 0.44]];
  g.save(); g.beginPath(); g.rect(x - s * 3, y - s * 3, s * 6, s * 3.62); g.clip();
  fillCircles(g, puffs.map(([a, b, k]) => [x + a * s + s * 0.1, y + b * s + s * 0.16, k * s]), shade);
  fillCircles(g, puffs.map(([a, b, k]) => [x + a * s - s * 0.07, y + b * s - s * 0.12, k * s * 0.9]), lit);
  g.restore();
}
export function ridgeOf(g, y, amp, col, seed, o = {}) {
  const r = rng(seed), ph = [r() * TAU, r() * TAU, r() * TAU], f = o.freq || 1, pts = [];
  for (let x = -2; x <= SW + 2; x += 1.25) pts.push([x, y - amp * (0.55 * Math.sin(x * 0.045 * f + ph[0]) + 0.3 * Math.sin(x * 0.11 * f + ph[1]) + 0.15 * Math.sin(x * 0.27 * f + ph[2])) + (o.rough ? (r() - 0.5) * o.rough : 0)]);
  const p = polyPath([...pts, [SW + 2, SH + 2], [-2, SH + 2]]);
  g.fillStyle = col; g.fill(p);
  if (o.rim) { g.strokeStyle = o.rim; g.lineWidth = 0.6; g.beginPath(); pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy))); g.stroke(); }
  return pts;
}
export function hazeOf(g, y, h, col) { const s = g.createLinearGradient(0, y - h, 0, y + h); s.addColorStop(0, css(col, 0)); s.addColorStop(0.5, css(col, 0.6)); s.addColorStop(1, css(col, 0)); g.fillStyle = s; g.fillRect(0, y - h, SW, 2 * h); }
export function groundOf(g, y, top, bottom) { const s = g.createLinearGradient(0, y, 0, SH); s.addColorStop(0, top); s.addColorStop(1, bottom); g.fillStyle = s; g.fillRect(0, y, SW, SH - y + 1); }
// Sunlight lying on the ground toward the left, where the light comes from.
export function sunlitOf(g, y, col) { const s = g.createRadialGradient(10, y, 2, 18, y + 8, 70); s.addColorStop(0, css(col, 0.35)); s.addColorStop(1, css(col, 0)); g.fillStyle = s; g.fillRect(0, y, SW, SH - y); }
export function dropOf(g, x, y, rx, ry, a = 0.5) { softFill(g, ellipsePath(x + rx * 0.16, y + ry * 0.3, rx, ry), `rgba(20,12,30,${a})`, Math.max(1.4, ry * 0.75)); }
export function bladesOf(g, seed, n, y0, y1, dark, light) {
  const r = rng(seed), d = new Path2D(), l = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = r() * SW, y = y0 + r() * (y1 - y0), h = 1.4 + (y - y0) / (y1 - y0) * 2.6, lean = (r() - 0.5) * 1.6, p = r() < 0.55 ? d : l;
    p.moveTo(x - 0.35, y); p.quadraticCurveTo(x + lean * 0.4, y - h * 0.6, x + lean, y - h); p.quadraticCurveTo(x + lean * 0.3, y - h * 0.5, x + 0.35, y); p.closePath();
  }
  g.fillStyle = dark; g.fill(d); g.fillStyle = light; g.fill(l);
}
export function vignetteOf(g) { const v = g.createRadialGradient(44, 48, 30, 50, 62, 86); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(12,6,16,0.38)'); g.fillStyle = v; g.fillRect(0, 0, SW, SH); }
// A pine in tiers, lit on its left half.
export function pineAt(g, x, base, h, col, lit = 0.2, wf = 0.26) {
  const c = rgbOf(col), L = css(mixC(c, [255, 250, 220], lit)), D = css(c);
  g.fillStyle = css(scaleC(c, 0.62)); g.fillRect(x - h * 0.022, base - h * 0.18, h * 0.044, h * 0.18);
  for (let i = 0; i < 4; i++) {
    const yb = base - h * (0.12 + 0.2 * i), yt = i === 3 ? base - h : base - h * (0.5 + 0.17 * i), w = h * wf * (1 - 0.2 * i), sag = h * 0.045;
    const whole = new Path2D(); whole.moveTo(x, yt); whole.lineTo(x + w, yb); whole.quadraticCurveTo(x + w * 0.5, yb - sag * 0.2, x, yb - sag); whole.quadraticCurveTo(x - w * 0.5, yb - sag * 0.2, x - w, yb); whole.closePath();
    const left = new Path2D(); left.moveTo(x, yt); left.lineTo(x - w, yb); left.quadraticCurveTo(x - w * 0.5, yb - sag * 0.2, x, yb - sag); left.closePath();
    g.fillStyle = D; g.fill(whole); g.fillStyle = L; g.fill(left);
  }
}
export function pineRowOf(g, base, h, col, step, seed, lit = 0.14) {
  const r = rng(seed);
  for (let x = -3; x < SW + 4; x += step * (0.75 + r() * 0.5)) pineAt(g, x, base + r() * 2.4, h * (0.75 + r() * 0.5), col, lit);
  g.fillStyle = col; g.fillRect(0, base + 1.2, SW, SH);
}
// A lump of rock or ore: facets from a crown toward the light, each lit by the way it faces.
export function lumpOf(g, x, y, s, r, cols) {
  const n = 6 + ((r() * 2) | 0), pts = [], apex = [x - s * 0.22, y - s * 0.28];
  for (let k = 0; k < n; k++) { const a = k * TAU / n + r() * 0.5, rr = s * (0.78 + r() * 0.32); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]); }
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % n], mx = (p[0] + q[0]) / 2 - apex[0], my = (p[1] + q[1]) / 2 - apex[1], l = Math.hypot(mx, my) || 1;
    const lt = clamp(0.55 + 0.6 * ((-0.62 * mx - 0.78 * my) / l), 0, 1);
    g.fillStyle = css(lt > 0.5 ? mixC(cols[1], cols[2], (lt - 0.5) * 2) : mixC(cols[0], cols[1], lt * 2));
    g.beginPath(); g.moveTo(apex[0], apex[1]); g.lineTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.closePath(); g.fill();
    g.strokeStyle = g.fillStyle; g.lineWidth = 0.15; g.stroke();
  });
  return pts;
}

// ---- grounding: everything in a painting stands on its ground ------------------------------
// A smooth outline through points (Catmull-Rom), sampled as a polygon so it can be filled and tested.
export function smoothPts(pts, steps = 6, closed = true) {
  const n = pts.length, out = [], P = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)], m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
export function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
  return c;
}
export function hullOf(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// The dark right where a thing meets the ground, and the shadow it casts down and to the right.
export function contactOf(g, x, y, rx, ry, a = 0.55) { softFill(g, ellipsePath(x, y, rx, ry), `rgba(26,14,10,${a})`, Math.max(0.45, ry * 0.55)); }
export function castOf(g, pts, a = 0.34, blur = 1.6) { softFill(g, polyPath(hullOf(pts)), `rgba(30,16,30,${a})`, blur); }
export function yOn(ridge, x) { return ridge[clamp(Math.round((x + 2) / 1.25), 0, ridge.length - 1)][1]; }

// ---- wood ------------------------------------------------------------------------------------
// A fir in many tiers of boughs, each with a ragged hem, lit on its left half.
export function firAt(g, x, base, h, col, seed, o = {}) {
  const c = rgbOf(col), r = rng(seed), tiers = o.tiers || 8, w0 = h * (o.wf || 0.25);
  g.fillStyle = css(scaleC(c, 0.5)); g.fillRect(x - h * 0.018, base - h * 0.2, h * 0.036, h * 0.2);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, yb = base - h * (0.12 + 0.8 * t), yt = base - h * Math.min(1, 0.12 + 0.8 * t + 0.26), w = w0 * (1 - t * 0.82) * (0.92 + r() * 0.16);
    const hem = [], n = 10;
    for (let k = 0; k <= n; k++) { const u = 1 - (k / n) * 2; hem.push([x + u * w, yb - (1 - u * u) * h * 0.035 + (k % 2 ? -h * 0.03 : 0) * (Math.abs(u) < 0.95 ? 1 : 0)]); }
    g.fillStyle = css(litC(c, 0.8)); g.fill(polyPath([[x, yt], ...hem]));
    g.fillStyle = css(litC(c, 1.04 + (o.lit || 0))); g.fill(polyPath([[x, yt], ...hem.slice(Math.ceil(n / 2)), [x, yb - h * 0.035]]));
    g.strokeStyle = css(litC(c, 0.55), 0.55); g.lineWidth = Math.max(0.2, h * 0.006); g.beginPath();
    for (let k = 1; k < n; k += 2) { const [hx, hy] = hem[k]; g.moveTo(hx, hy); g.lineTo(lerp(hx, x, 0.35), lerp(hy, yt, 0.25)); }
    g.stroke();
  }
}
// An axe struck into the top of a log, at its middle: the head stands in front of the log, cut off
// where it goes into the wood along the log's own round section there, the haft rises up and to the
// right, bowed a little, to a knob, and the bark is split and cracked round the cut.
//   cut: the log's section where the bit goes in, [cx, cy, r]; wood: the log's outline, face: its cut end
export function axeOnTop(g, T, cut, wood, face, pile) {
  const k = 1.3, d = [0.45, -0.893], b = [0.893, 0.45], E = [T[0] - b[0] * 4.4 * k, T[1] - b[1] * 4.4 * k], L = 29, end = [E[0] + d[0] * L, E[1] + d[1] * L];
  // the haft, its shadow lying across the logs below and to the right
  const mid = [E[0] + d[0] * L * 0.5 - b[0] * 1.4, E[1] + d[1] * L * 0.5 - b[1] * 1.4], N = 18, Ls = [], Rs = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t, x = u * u * E[0] + 2 * u * t * mid[0] + t * t * end[0], y = u * u * E[1] + 2 * u * t * mid[1] + t * t * end[1];
    const w = t > 0.93 ? 1.6 : 1.25 - 0.22 * Math.sin(t * Math.PI * 0.9);
    Ls.push([x - b[0] * w, y - b[1] * w]); Rs.push([x + b[0] * w, y + b[1] * w]);
  }
  const haft = polyPath([...Ls, ...Rs.slice().reverse()]);
  g.save(); g.clip(pile); g.translate(2.2, 2.4); softFill(g, haft, 'rgba(30,14,4,0.55)', 1); g.restore();
  const hg = g.createLinearGradient(E[0] - b[0] * 1.3, E[1] - b[1] * 1.3, E[0] + b[0] * 1.3, E[1] + b[1] * 1.3);
  hg.addColorStop(0, '#e6b886'); hg.addColorStop(0.45, '#a8733f'); hg.addColorStop(1, '#55331a');
  g.fillStyle = hg; g.fill(haft);
  line(g, Ls.slice(2, -2).map(([x, y]) => [x + b[0] * 0.5, y + b[1] * 0.5]), 'rgba(255,238,204,0.6)', 0.35);
  line(g, Rs.slice(1, -3).map(([x, y]) => [x - b[0] * 0.55, y - b[1] * 0.55]), 'rgba(50,26,10,0.45)', 0.3);
  // the head, in its own frame (u toward the bit, v along the haft); what is in the wood stays hidden
  const head = new Path2D();
  head.moveTo(-3.6, -1.7); head.lineTo(1.2, -1.8); head.quadraticCurveTo(3.8, -2.5, 7.2, -4.4); head.lineTo(7.2, 3.6);
  head.quadraticCurveTo(3.8, 1.9, 1.2, 1.8); head.lineTo(-3.6, 1.7); head.closePath();
  g.save(); g.clip(pile); g.transform(b[0], b[1], d[0], d[1], E[0] + 1, E[1] + 1.3); g.scale(k, k); softFill(g, head, 'rgba(30,14,4,0.55)', 0.8); g.restore();
  const [qx, qy, qr] = cut, section = new Path2D(); section.moveTo(qx + qr, qy); section.arc(qx, qy, qr, 0, TAU);
  // the bark round the cut: cracks running from it toward the cut end, and the split it opened
  g.save();
  const bark = new Path2D(); bark.addPath(wood); bark.addPath(face); g.clip(bark, 'evenodd');
  const cr = rng(12), arcAt = (x) => [x, qy - Math.sqrt(Math.max(0, qr * qr - (x - qx) ** 2))];
  [[48.6, 1.9], [51.4, 2.3], [54.2, 1.6], [46.4, 1.2]].forEach(([x0, len]) => {
    let [x, y] = arcAt(x0); const pts = [[x, y - 0.2]];
    for (let i = 0; i < 4; i++) { x += (cr() - 0.5) * 1.1; y += len; pts.push([x, y]); }
    line(g, pts, 'rgba(26,12,4,0.8)', 0.42); line(g, pts.map(([px, py]) => [px - 0.35, py + 0.1]), 'rgba(230,186,130,0.35)', 0.22);
  });
  g.restore();
  g.save(); g.clip(wood);
  const lip = new Path2D(); for (let x = 47.6; x <= 56.6; x += 0.5) { const [px, py] = arcAt(x); x > 47.6 ? lip.lineTo(px, py) : lip.moveTo(px, py); }
  g.strokeStyle = 'rgba(22,10,3,0.9)'; g.lineWidth = 1.1; g.stroke(lip);
  g.save(); g.translate(0, 0.8); g.strokeStyle = 'rgba(236,196,140,0.5)'; g.lineWidth = 0.35; g.stroke(lip); g.restore();
  g.restore();
  // the head, in front of the log, cut off along its section
  g.save();
  const out = new Path2D(); out.rect(-10, -10, 130, 140); out.addPath(section);
  g.clip(out, 'evenodd');
  g.transform(b[0], b[1], d[0], d[1], E[0], E[1]); g.scale(k, k);
  const sg = g.createLinearGradient(0, -2.6, 0, 2.6); sg.addColorStop(0, '#e2e8ed'); sg.addColorStop(0.5, '#8f99a3'); sg.addColorStop(1, '#4a525b');
  g.fillStyle = sg; g.fill(head);
  g.fillStyle = 'rgba(255,255,255,0.24)'; g.fill(polyPath([[1.4, -1.7], [6.8, -4], [7.4, -1.6], [1.6, -0.5]]));
  g.fillStyle = '#3a4048'; g.fill(polyPath([[-3.6, -1.7], [-2.7, -1.7], [-2.7, 1.7], [-3.6, 1.7]]));
  line(g, [[1.2, -1.8], [1.2, 1.8]], 'rgba(30,34,40,0.6)', 0.3);
  g.restore();
}

// ---- brick: an oblique of its own, x across, z away from us (up and to the right), y up ------
export const obl = (ox, oy) => (x, y, z) => [ox + x + z * 0.42, oy - y - z * 0.34];
export function oblBox(g, P, [x0, x1], [y0, y1], [z0, z1], col, o = {}) {
  const c = rgbOf(col);
  const front = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)];
  const side = [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)];
  const top = [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)];
  g.fillStyle = css(litC(c, o.kf ?? 0.9)); g.fill(polyPath(front));
  g.fillStyle = css(litC(c, o.ks ?? 0.6)); g.fill(polyPath(side));
  g.fillStyle = css(litC(c, o.kt ?? 1.1)); g.fill(polyPath(top));
  return { front, side, top };
}
// One fired brick: speckled, its arrises caught by the light, a corner knocked off now and then.
export function brickOb(g, P, X, Y, Z, r, o = {}) {
  const tone = o.tone || mixC([194, 86, 52], r() < 0.5 ? [138, 54, 34] : [218, 124, 84], r() * 0.42);
  const f = oblBox(g, P, X, Y, Z, tone);
  const span = (q) => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))];
  if (o.fine) {
    [[f.front, 'rgba(84,26,10,0.5)', 'rgba(255,214,180,0.35)'], [f.top, 'rgba(120,44,20,0.35)', 'rgba(255,226,200,0.4)']].forEach(([q, dk, lt]) => {
      const [a0, b0, a1, b1] = span(q), n = Math.round((a1 - a0) * (b1 - b0) * 0.5);
      g.save(); g.clip(polyPath(q));
      fillCircles(g, Array.from({ length: n }, () => [a0 + r() * (a1 - a0), b0 + r() * (b1 - b0), 0.12 + r() * 0.18]), dk);
      fillCircles(g, Array.from({ length: Math.round(n * 0.4) }, () => [a0 + r() * (a1 - a0), b0 + r() * (b1 - b0), 0.1 + r() * 0.12]), lt);
      g.restore();
    });
    if (o.frog) { const fx0 = lerp(X[0], X[1], 0.28), fx1 = lerp(X[0], X[1], 0.72), fz0 = lerp(Z[0], Z[1], 0.3), fz1 = lerp(Z[0], Z[1], 0.7); const yy = Y[1]; g.fillStyle = css(litC(tone, 0.86)); g.fill(polyPath([P(fx0, yy, fz0), P(fx1, yy, fz0), P(fx1, yy, fz1), P(fx0, yy, fz1)])); g.fillStyle = css(litC(tone, 0.58)); g.fill(polyPath([P(fx0, yy, fz1), P(fx1, yy, fz1), P(fx1 - 0.5, yy, fz1 - 0.7), P(fx0 + 0.5, yy, fz1 - 0.7)])); g.fill(polyPath([P(fx0, yy, fz0), P(fx0, yy, fz1), P(fx0 + 0.6, yy, fz1 - 0.7), P(fx0 + 0.6, yy, fz0 + 0.2)])); }
  }
  line(g, [f.front[3], f.front[2], f.side[2]], css(litC(tone, 1.3), 0.7), 0.3);
  if (o.fine && r() < 0.35) { const [x, y] = r() < 0.5 ? f.front[3] : f.front[2], sd = x === f.front[3][0] ? 1 : -1; g.fillStyle = css(litC(tone, 0.55)); g.fill(polyPath([[x, y], [x + sd * 1.3, y], [x, y + 0.9]])); }
  return f;
}

// ---- wool: a ewe standing side-on, facing right; her feet at (0, 0), body 46 long --------------
export const EWE = [[-16, -36], [-21, -34], [-24, -28.5], [-24, -20], [-22, -14], [-17, -10], [-8, -8.8], [2, -8.9], [11, -9.5], [17.5, -11.8], [21.8, -16.4], [24.2, -22.6], [25.6, -29], [25.6, -35.5], [22.8, -41.4], [18.2, -42.8], [14, -40.2], [8, -37.6], [0, -37.2], [-8, -37.4]];
export const EWE_HEAD = [[19.4, -40.4], [22.4, -43.4], [26.6, -42.6], [30.6, -38.8], [33.5, -33.8], [34.3, -30.8], [33.2, -28.9], [31.2, -28.2], [28.6, -29.4], [25.6, -32], [22.6, -34.6], [20.2, -37.2]];
export const EWE_LEGS = {
  fore: [[14.3, -13], [14.6, -6.6], [14.3, -5.1], [14.7, -1.7], [14.5, 0], [17.3, 0], [17.1, -1.7], [17.6, -5.2], [17.5, -6.8], [18.1, -13]],
  hind: [[-18.2, -13], [-19.3, -7.6], [-18.5, -5.4], [-17.3, -1.7], [-17.6, 0], [-14.8, 0], [-14.6, -1.7], [-15, -5.4], [-14.8, -7.8], [-13.3, -13]],
};
export function eweAt(g, x, y, s, o = {}) {
  const sg = o.flip ? -1 : 1, fine = s > 0.5, BASE = [236, 229, 212];
  const toPage = ([lx, ly]) => [x + sg * s * lx, y + s * ly];
  // her shadow and the four hoof prints, in the page's own frame so they always fall to the right
  softFill(g, ellipsePath(x + 5 * s, y + 0.2 * s, 22 * s, 2.6 * s), 'rgba(28,44,18,0.34)', 2.2 * s);
  [[16, 0, 1], [-16.2, 0, 1], [12.6, -1.3, 0.8], [-13, -1.3, 0.8]].forEach(([lx, ly, k]) => { const [px, py] = toPage([lx, ly]); contactOf(g, px + 0.4 * s, py + 0.2 * s, 2.3 * s * k, 0.75 * s, 0.5); });
  g.save(); g.translate(x, y); g.scale(sg * s, s);
  const light = (px, py) => { const nx = clamp(px / 25, -1, 1) * sg, ny = clamp((py + 23) / 15, -1, 1), nz = Math.sqrt(Math.max(0.04, 1 - 0.75 * (nx * nx + ny * ny))); return clamp(0.64 + 0.55 * (-0.5 * nx - 0.6 * ny + 0.45 * nz), 0.42, 1.18); };
  const leg = (pts, dx, dy, far) => {
    const P = pts.map(([px, py]) => [px + dx, py + dy]);
    g.fillStyle = far ? '#15110e' : '#2a231e'; g.fill(polyPath(P));
    if (!far && fine) line(g, P.slice(0, 4).map(([px, py]) => [px + 0.55, py]), 'rgba(170,150,130,0.5)', 0.45);
    g.fillStyle = '#0a0807'; g.fill(polyPath([[P[3][0], P[3][1] + 0.1], [P[4][0] - 0.2, P[4][1]], [P[5][0] + 0.2, P[5][1]], [P[6][0], P[6][1] + 0.1]]));
    if (fine) { const mx = (P[4][0] + P[5][0]) / 2; line(g, [[mx, P[4][1]], [mx + 0.1, P[4][1] - 0.9]], 'rgba(120,108,96,0.7)', 0.22); }
  };
  leg(EWE_LEGS.fore, -3.4, -1.3, true); leg(EWE_LEGS.hind, 3.2, -1.3, true);
  leg(EWE_LEGS.fore, 0, 0, false); leg(EWE_LEGS.hind, 0, 0, false);
  // the head (its back is under the fleece), grazing or held up, and its far ear behind it
  const headFrame = () => { if (o.graze) { g.translate(20.5, -37); g.rotate(1.05); g.translate(-20.5, 37); } };
  g.save(); headFrame();
  g.fillStyle = '#0f0c0a'; g.fill(lensPath(22.6, -41.4, 18, -43.8, 0.95));
  const hp = polyPath(smoothPts(EWE_HEAD, 5));
  const hg = g.createLinearGradient(23, -44, 33, -28); hg.addColorStop(0, '#5d544c'); hg.addColorStop(0.45, '#2c2520'); hg.addColorStop(1, '#120f0d');
  g.fillStyle = hg; g.fill(hp);
  if (fine) {
    line(g, smoothPts([[26.4, -42.2], [30, -39], [32.9, -34.6], [33.8, -31.6]], 4, false), 'rgba(176,160,146,0.45)', 0.7);
    g.save(); g.translate(27.7, -38.3); g.rotate(-0.35);
    g.fillStyle = 'rgba(110,100,92,0.45)'; g.fill(ellipsePath(0, 0, 1.75, 1.2));
    g.fillStyle = '#7a4c1c'; g.fill(ellipsePath(0, 0, 1.05, 0.82));
    g.fillStyle = '#0b0806'; g.fill(ellipsePath(0.05, 0.05, 0.62, 0.22));
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); circle(g, -0.38, -0.32, 0.24); g.fill();
    g.restore();
    g.strokeStyle = '#080605'; g.lineWidth = 0.45; g.beginPath(); g.moveTo(32.5, -32.2); g.quadraticCurveTo(33.7, -32.6, 33.9, -31.3); g.stroke();
    line(g, [[33.3, -29.6], [31.5, -29.1]], '#080605', 0.35);
  }
  g.restore();
  // the fleece: thick and fluffy, built of tufts. A ragged edge of puffs round a plump body, then tufts
  // packed all over it, each lit at its top left and casting a soft shade on the ones below; the
  // whole is lit as one round body, and the belly falls into shade.
  const poly = smoothPts(EWE, 6), body = polyPath(poly), r = rng(o.seed || 35), fluff = new Path2D();
  fluff.addPath(body);
  // wool stays warm in shade: it goes toward a soft fawn, never the cool grey of stone
  const wool = (k) => (k >= 1 ? mixC(BASE, [255, 253, 246], Math.min(1, (k - 1) * 3)) : mixC(BASE, [150, 128, 100], Math.min(1, (1 - k) * 1.5)));
  const tuft = (px, py, rad, k, soft) => {
    const gr = g.createRadialGradient(px - rad * 0.36 * sg, py - rad * 0.4, rad * 0.06, px, py, rad);
    gr.addColorStop(0, css(wool(Math.min(1.25, k * 1.12)))); gr.addColorStop(0.55, css(wool(k * 0.97)));
    gr.addColorStop(soft ? 0.82 : 1, css(wool(k * 0.84), soft ? 0.9 : 1)); if (soft) gr.addColorStop(1, css(wool(k * 0.8), 0));
    g.fillStyle = gr; g.beginPath(); circle(g, px, py, rad); g.fill();
  };
  const fg = g.createRadialGradient(-6 * sg, -34, 1, 0, -24, 34);
  fg.addColorStop(0, css(wool(1))); fg.addColorStop(0.55, css(wool(0.86))); fg.addColorStop(1, css(wool(0.66)));
  g.fillStyle = fg; g.fill(body);
  // the ragged edge: puffs of different sizes standing out of the outline
  let run = 0, gap = 2;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    run += Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (run < gap) continue;
    run = 0; gap = 1.9 + r() * 1.1;
    const rad = 1.8 + r() * 1.3, dx = -p[0], dy = -23 - p[1], l = Math.hypot(dx, dy) || 1, cx = p[0] + dx / l * rad * 0.42, cy = p[1] + dy / l * rad * 0.42;
    fluff.moveTo(cx + rad, cy); fluff.arc(cx, cy, rad, 0, TAU);
    tuft(cx, cy, rad, light(cx, cy), false);
  }
  // tufts packed over the body, the higher ones first, so each lies over the one above it
  if (fine) {
    const tufts = [];
    for (let i = 0; tufts.length < 280 && i < 5000; i++) { const px = -23 + r() * 48, py = -42 + r() * 33; if (inPoly(poly, px, py)) tufts.push([px, py, 1.6 + r() * 1.4]); }
    tufts.sort((a2, b2) => a2[1] - b2[1]);
    g.save(); g.clip(fluff);
    tufts.forEach(([px, py, rad]) => tuft(px, py, rad, light(px, py), true));
    // crimp: fine wavy locks over the tufts, lighter where the light falls
    g.lineCap = 'round'; g.lineWidth = 0.28;
    tufts.forEach(([px, py, rad], i) => { if (i % 2) return; const k = light(px, py); g.strokeStyle = css(wool(k * (k > 0.9 ? 1.2 : 0.8)), 0.6); g.beginPath(); g.arc(px - rad * 0.15 * sg, py - rad * 0.1, rad * 0.55, 3.3, 4.9); g.arc(px + rad * 0.3 * sg, py + rad * 0.2, rad * 0.35, 4.2, 5.8); g.stroke(); });
    g.restore();
  }
  g.save(); g.clip(fluff);
  const bs = g.createLinearGradient(0, -21, 0, -7); bs.addColorStop(0, 'rgba(110,88,60,0)'); bs.addColorStop(1, 'rgba(110,88,60,0.38)');
  g.fillStyle = bs; g.fillRect(-28, -22, 58, 16);
  g.restore();
  // a fluffy topknot on her poll
  g.save(); headFrame();
  [[21.2, -42.2, 1.7], [23.2, -43.4, 1.5], [20.6, -40.2, 1.6]].forEach(([px, py, rad]) => tuft(px, py, rad, light(px, py) * 1.05, false));
  g.restore();
  // the near ear lies over the fleece of her neck
  g.save(); headFrame();
  const ear = lensPath(24.4, -39.6, 17.2, -34.2, 1.55);
  if (fine) softFill(g, ear, 'rgba(60,50,40,0.45)', 0.6);
  g.fillStyle = '#211b17'; g.fill(ear);
  if (fine) { g.fillStyle = '#5a3a30'; g.fill(lensPath(23.4, -38.9, 18.6, -35.3, 0.6)); line(g, smoothPts([[24.2, -40.2], [21, -38.6], [17.6, -35]], 3, false), 'rgba(190,170,150,0.55)', 0.35); }
  g.restore();
  g.restore();
}
// A dry-stone wall laid along a hill, its copes stood on edge.
export function stoneWall(g, ridge, off, seed) {
  const r = rng(seed), top = [], base = [];
  ridge.forEach(([x, y]) => { base.push([x, y + off + 1.8]); top.push([x, y + off + (r() - 0.5) * 0.2]); });
  softFill(g, polyPath([...base, ...base.slice().reverse().map(([x, y]) => [x + 0.5, y + 1.3])]), 'rgba(40,64,28,0.4)', 0.5);
  g.fillStyle = '#6f7869'; g.fill(polyPath([...top, ...base.slice().reverse()]));
  for (let x = -1; x < 101; x += 0.9 + r() * 0.6) {
    const y = yOn(ridge, x) + off;
    [[1.05, 0.62], [0.35, 0.58]].forEach(([dy, h]) => { const w = 0.6 + r() * 0.5; g.fillStyle = css(mixC([150, 156, 140], r() < 0.5 ? [196, 200, 184] : [118, 124, 110], r() * 0.6)); g.fill(rrectPath(x + r() * 0.3, y + dy, w, h, 0.22)); });
  }
  g.strokeStyle = '#59614f'; g.lineWidth = 0.32; g.beginPath();
  for (let x = -1; x < 101; x += 0.42) { const y = yOn(ridge, x) + off; g.moveTo(x, y + 0.2); g.lineTo(x + 0.1, y - 0.45); }
  g.stroke();
  line(g, top.map(([x, y]) => [x, y - 0.45]), 'rgba(226,230,214,0.55)', 0.22);
}

// ---- grain -----------------------------------------------------------------------------------
// One ear of wheat: two staggered rows of plump kernels on a spike that nods as it grows heavy,
// long awns fanning up from them.
export function earAt(g, x, y, a, len, lit, droop) {
  const n = 8, pts = [];
  let px = x, py = y, th = a;
  for (let i = 0; i <= 16; i++) { pts.push([px, py, th]); th = a + droop * (i / 16) * (i / 16); px += Math.sin(th) * len / 16; py -= Math.cos(th) * len / 16; }
  const at = (t) => pts[clamp(Math.round(t * 16), 0, 16)];
  g.lineCap = 'round';
  g.strokeStyle = css(mixC([190, 140, 56], [252, 228, 156], lit), 0.72); g.lineWidth = 0.15; g.beginPath();
  for (let k = 0; k < n; k++) for (const sd of [-1, 1]) {
    const t = (k + (sd > 0 ? 0.5 : 0) + 0.6) / (n + 0.6), [kx, ky, kth] = at(t), aw = kth + sd * (0.12 + t * 0.06), L = 4.2 + t * 2.8;
    g.moveTo(kx, ky); g.lineTo(kx + Math.sin(aw) * L, ky - Math.cos(aw) * L);
  }
  g.stroke();
  for (const sd of [1, -1]) {
    for (let k = 0; k < n; k++) {
      const t = (k + (sd > 0 ? 0.5 : 0) + 0.3) / (n + 0.6), [kx, ky, kth] = at(t), taper = 1 - t * 0.38, lt = clamp(lit + (sd < 0 ? 0.2 : -0.24), 0, 1);
      g.save(); g.translate(kx + Math.cos(kth) * sd * 0.66 * taper, ky + Math.sin(kth) * sd * 0.66 * taper); g.rotate(kth + sd * 0.4 - Math.PI / 2);
      g.fillStyle = css(mixC([140, 90, 24], [250, 214, 118], lt)); g.beginPath(); g.ellipse(0, 0, 1.1 * taper + 0.38, 0.66 * taper + 0.22, 0, 0, TAU); g.fill();
      if (lt > 0.5) { g.fillStyle = 'rgba(255,246,206,0.4)'; g.beginPath(); g.ellipse(-0.25, -0.16, 0.5 * taper, 0.14, 0, 0, TAU); g.fill(); }
      g.restore();
    }
  }
}
// A sheaf: stalks splayed at the foot, gathered at the waist with twine, ears crowded into a crown
// that nods outward at its edges. Drawn about its foot at (cx, by), S times its own units.
export function sheafAt(g, cx, by, seed, S = 1) {
  const r = rng(seed), N = 88, st = [];
  for (let i = 0; i < N; i++) {
    const u = clamp((i + r()) / N * 2 - 1, -0.99, 0.99), d = r(), al = u * 1.1 + (r() - 0.5) * 0.18;
    st.push({
      u, d, al, lit: clamp(0.62 - u * 0.42 + (d - 0.5) * 0.45, 0, 1),
      bx: u * 11.4 + (r() - 0.5) * 0.5, by: (d - 0.5) * 3.2 * Math.sqrt(1 - u * u),
      wx: u * 3.1 + (r() - 0.5) * 0.5, wy: -21 + (r() - 0.5) * 0.5,
      ex: Math.sin(al) * 6.2, ey: -25.4 - Math.cos(al) * 3.2 + (1 - d) * 1.4 + (r() - 0.5) * 1,
      len: 11 + r() * 2.4, droop: Math.sign(al) * 0.95 * Math.pow(Math.abs(al), 1.5) + (r() - 0.5) * 0.14,
    });
  }
  g.save(); g.translate(cx, by); g.scale(S, S);
  const sp = [[-11.5, -0.6], [11.5, 0.4], [0, 1.8]];
  [[-3.5, 21], [3.5, 21], [-18, 28], [19, 28], [-6, 40], [7, 40]].forEach(([x, h]) => sp.push([x + 0.42 * h, 0.07 * h]));
  castOf(g, sp, 0.3, 1.8);
  contactOf(g, 0, 0.3, 12.4, 2.1, 0.6);
  st.sort((a, b) => a.d - b.d);
  st.forEach((s) => {
    g.strokeStyle = css(mixC([150, 102, 30], [246, 212, 120], s.lit * (0.55 + s.d * 0.45))); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(s.bx, s.by); g.quadraticCurveTo(lerp(s.bx, s.wx, 0.62), lerp(s.by, s.wy, 0.55), s.wx, s.wy);
    g.quadraticCurveTo(s.wx + (s.ex - s.wx) * 0.25, s.wy - 2.2, s.ex, s.ey); g.stroke();
    if (s.lit > 0.5 && s.d > 0.4) { g.strokeStyle = 'rgba(255,246,206,0.42)'; g.lineWidth = 0.26; g.stroke(); }
    earAt(g, s.ex, s.ey, s.al * 1.18, s.len, s.lit * (0.6 + s.d * 0.4), s.droop);
  });
  // the cut ends along the foot, hollow straws
  st.filter((s) => s.d > 0.4).forEach((s) => { g.fillStyle = css(mixC([196, 146, 60], [240, 206, 128], s.lit)); g.fill(ellipsePath(s.bx, s.by + 0.2, 0.46, 0.32)); fillCircles(g, [[s.bx + 0.06, s.by + 0.24, 0.16]], 'rgba(100,64,16,0.8)'); });
  // twine, twice round the waist, knotted at the front
  const tw = (y, rx) => {
    g.lineWidth = 1.2; g.strokeStyle = '#5a3c1a'; g.beginPath(); g.ellipse(0, y, rx, 1.1, 0, 0.06, Math.PI - 0.06); g.stroke();
    g.lineWidth = 0.4; g.strokeStyle = '#c99e62'; g.beginPath(); g.ellipse(0, y - 0.32, rx, 1.1, 0, 0.5, Math.PI - 0.4); g.stroke();
    g.strokeStyle = 'rgba(40,24,8,0.55)'; g.lineWidth = 0.2; g.beginPath();
    for (let a = 0.2; a < Math.PI - 0.15; a += 0.2) { const x = Math.cos(a) * rx, yy = y + Math.sin(a) * 1.1; g.moveTo(x - 0.3, yy - 0.5); g.lineTo(x + 0.25, yy + 0.5); }
    g.stroke();
  };
  tw(-22.2, 4.4); tw(-20.2, 4.2);
  const kx = 1.6, ky = -20.2;
  g.fillStyle = '#5a3c1a'; g.beginPath(); circle(g, kx, ky + 0.3, 0.95); g.fill(); fillCircles(g, [[kx - 0.25, ky, 0.4]], '#c99e62');
  line(g, [[kx + 0.3, ky + 0.8], [kx + 1.1, ky + 3.2], [kx + 0.7, ky + 4.4]], '#5a3c1a', 0.55);
  line(g, [[kx - 0.3, ky + 0.9], [kx - 0.6, ky + 3.6]], '#5a3c1a', 0.5);
  // a few straws dropped round its foot
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) { const x = (r() - 0.5) * 30, y = 1 + r() * 3, a = (r() - 0.5) * 0.6, l = 3 + r() * 3; line(g, [[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l * 0.4]], css(mixC([170, 120, 40], [240, 206, 128], r())), 0.45); }
  g.restore();
}
// A sickle lying in the stubble: a crescent of steel honed on its inner edge, a turned handle.
export function sickleAt(g, x, y, ang, k = 1) {
  const R = 7, cxx = -7, N = 30, f1 = -3.8, outer = [], inner = [];
  const w = (t) => (t < 0.1 ? lerp(0.8, 2.2, t / 0.1) : 2.2 * Math.pow((1 - t) / 0.9, 0.7)) + 0.05;
  for (let i = 0; i <= N; i++) { const t = i / N, f = f1 * t, c = Math.cos(f), s = Math.sin(f); outer.push([cxx + c * (R + w(t) / 2), s * (R + w(t) / 2)]); inner.push([cxx + c * (R - w(t) / 2), s * (R - w(t) / 2)]); }
  const blade = polyPath([...outer, ...inner.slice().reverse()]);
  const handle = new Path2D(); handle.moveTo(1.7, -1); handle.quadraticCurveTo(7, -1.35, 11.6, -0.8); handle.quadraticCurveTo(12.6, 0, 11.6, 0.9); handle.quadraticCurveTo(7, 1.4, 1.7, 1); handle.closePath();
  const ferrule = rrectPath(0.2, -1.2, 1.8, 2.4, 0.4);
  // its shadow first, close under it
  g.save(); g.translate(x + 0.7, y + 0.9); g.scale(k, 0.62 * k); g.rotate(ang);
  const all = new Path2D(); all.addPath(blade); all.addPath(handle); all.addPath(ferrule);
  softFill(g, all, 'rgba(70,40,6,0.55)', 0.7);
  g.restore();
  g.save(); g.translate(x, y); g.scale(k, 0.62 * k); g.rotate(ang);
  const sg = g.createRadialGradient(cxx, 0, R - 1.3, cxx, 0, R + 1.3);
  sg.addColorStop(0, '#f6f7f8'); sg.addColorStop(0.28, '#b3b8bd'); sg.addColorStop(0.7, '#696e74'); sg.addColorStop(1, '#33363a');
  g.fillStyle = sg; g.fill(blade);
  g.save(); g.clip(blade); const sh = g.createLinearGradient(cxx - 6, -8, cxx + 2, 2); sh.addColorStop(0, 'rgba(255,255,255,0.45)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(cxx - 9, -9, 18, 14); g.restore();
  line(g, inner.slice(2, -3).map(([px, py]) => [cxx + (px - cxx) * 1.03, py * 1.03]), 'rgba(255,255,255,0.75)', 0.28);
  g.strokeStyle = 'rgba(40,46,54,0.6)'; g.lineWidth = 0.14; g.beginPath();
  inner.slice(3, -4).forEach(([px, py], i) => { if (i % 2) return; const dx = px - cxx, dy = py, l = Math.hypot(dx, dy); g.moveTo(px, py); g.lineTo(px + dx / l * 0.4, py + dy / l * 0.4); });
  g.stroke();
  const hgr = g.createLinearGradient(0, -1.3, 0, 1.3); hgr.addColorStop(0, '#d6a067'); hgr.addColorStop(0.4, '#8f5a2c'); hgr.addColorStop(1, '#3d220e');
  g.fillStyle = hgr; g.fill(handle);
  line(g, [[3, -0.5], [7, -0.75], [10.8, -0.4]], 'rgba(255,230,190,0.45)', 0.3);
  const fr = g.createLinearGradient(0, -1.2, 0, 1.2); fr.addColorStop(0, '#f4dc9c'); fr.addColorStop(0.5, '#b8924c'); fr.addColorStop(1, '#5e4520');
  g.fillStyle = fr; g.fill(ferrule);
  line(g, [[0.8, -1.2], [0.8, 1.2]], 'rgba(70,50,20,0.6)', 0.2); line(g, [[1.4, -1.2], [1.4, 1.2]], 'rgba(70,50,20,0.6)', 0.2);
  g.restore();
}
// A tower mill on the far rise: limewashed, a thatched cap, four lattice sails.
export function millAt(g, x, y, h) {
  const bw = h * 0.21, tw = h * 0.14, th = h * 0.62, top = y - th;
  softFill(g, polyPath([[x - bw, y], [x + bw, y], [x + bw + h * 0.5, y + h * 0.06], [x + h * 0.2, y + h * 0.08]]), 'rgba(120,80,20,0.35)', h * 0.04);
  const body = polyPath([[x - bw, y], [x - tw, top], [x + tw, top], [x + bw, y]]);
  const bg = g.createLinearGradient(x - bw, 0, x + bw, 0); bg.addColorStop(0, '#fbf0d6'); bg.addColorStop(0.45, '#eadbb8'); bg.addColorStop(0.55, '#cdb78e'); bg.addColorStop(1, '#a8916a');
  g.fillStyle = bg; g.fill(body);
  g.fillStyle = '#4a3624'; g.fill(polyPath([[x + bw * 0.08, y], [x + bw * 0.08, y - h * 0.11], [x + bw * 0.5, y - h * 0.12], [x + bw * 0.5, y]]));
  g.fillStyle = '#5e4630'; g.fillRect(x - tw * 0.2, top + th * 0.3, tw * 0.4, h * 0.06);
  const cap = new Path2D(); cap.moveTo(x - tw * 1.2, top + 0.2); cap.quadraticCurveTo(x - tw * 1.1, top - h * 0.17, x, top - h * 0.22); cap.quadraticCurveTo(x + tw * 1.1, top - h * 0.17, x + tw * 1.2, top + 0.2); cap.closePath();
  const cg = g.createLinearGradient(x - tw, 0, x + tw, 0); cg.addColorStop(0, '#b48c5a'); cg.addColorStop(1, '#6e5030');
  g.fillStyle = cg; g.fill(cap);
  const hx = x + tw * 0.3, hy = top - h * 0.06;
  g.save(); g.translate(hx, hy); g.rotate(0.42);
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    const a0 = h * 0.06, a1 = h * 0.66, sw = h * 0.12;
    g.fillStyle = 'rgba(250,244,226,0.95)'; g.fillRect(a0, 0, a1 - a0, sw);
    g.strokeStyle = 'rgba(110,80,46,0.85)'; g.lineWidth = h * 0.012; g.beginPath();
    for (let k = 0; k <= 5; k++) { const xx = a0 + (a1 - a0) * k / 5; g.moveTo(xx, 0); g.lineTo(xx, sw); }
    g.moveTo(a0, sw); g.lineTo(a1, sw); g.stroke();
    line(g, [[0, 0], [a1 + h * 0.02, 0]], '#6a4c2c', h * 0.022);
  }
  g.restore();
  fillCircles(g, [[hx, hy, h * 0.03]], '#3e2c1c');
}
// A stook: six sheaves leant together to dry, ears up.
export function stookAt(g, x, y, h, seed) {
  const r = rng(seed);
  castOf(g, [[x - h * 0.32, y], [x + h * 0.32, y], [x + h * 0.82, y + h * 0.1], [x + h * 0.5, y + h * 0.14]], 0.3, h * 0.07);
  contactOf(g, x, y, h * 0.34, h * 0.07, 0.5);
  [-1, 1, -0.6, 0.6, -0.2, 0.2].forEach((t, k) => {
    const bx = x + t * h * 0.3, tx = x + t * h * 0.07, ty = y - h * 0.62, lit = clamp(0.62 - t * 0.45, 0, 1), col = mixC([150, 104, 34], [244, 208, 122], lit);
    g.fillStyle = css(col); g.fill(polyPath([[bx - h * 0.09, y + (k > 1 ? 0.2 : -0.2)], [bx + h * 0.09, y + (k > 1 ? 0.2 : -0.2)], [tx + h * 0.05, ty], [tx - h * 0.05, ty]]));
    g.fillStyle = css(scaleC(col, 0.75)); g.fillRect(tx - h * 0.055, ty + h * 0.12, h * 0.11, h * 0.035);
    const ex = tx + t * h * 0.12, ey = ty - h * 0.14;
    g.fillStyle = css(mixC(col, [255, 236, 170], 0.25)); g.beginPath(); g.ellipse(ex, ey, h * 0.08, h * 0.2, t * 0.5, 0, TAU); g.fill();
    g.fillStyle = css(scaleC(col, 0.78)); g.beginPath(); g.ellipse(ex + h * 0.03, ey + h * 0.03, h * 0.05, h * 0.15, t * 0.5, 0, TAU); g.fill();
    line(g, [[ex, ey - h * 0.18], [ex + t * h * 0.08 + (r() - 0.5) * h * 0.05, ey - h * 0.34]], css(col, 0.8), h * 0.015);
  });
}

// ---- ore: a little perspective of its own, so the rails, the cart and the mine agree -----------
// Ground at Y = 0, the eye 0.767 up and looking along +Z; the horizon is at 64.
export const PJ = (X, Y, Z) => [50 + X * 60 / Z, 64 + (0.767 - Y) * 60 / Z];
export const TRACK = { o: [-0.2, 1.62], d: [0.8, 0.6], n: [0.6, -0.8] };   // n points to its near side
export const onTrack = (a, b, Y = 0) => PJ(TRACK.o[0] + TRACK.d[0] * a + TRACK.n[0] * b, Y, TRACK.o[1] + TRACK.d[1] * a + TRACK.n[1] * b);
export const trackZ = (a, b = 0) => TRACK.o[1] + TRACK.d[1] * a + TRACK.n[1] * b;

export const SCENES = {
  wood(g) {
    skyOf(g, [[0, '#8cc4ad'], [0.55, '#cfe5c2'], [1, '#f2efcf']]);
    beamsOf(g, 16, 14, 'rgba(255,250,214,0.08)', 2);
    sunOf(g, 16, 14, 5.5, 'rgba(255,246,210,0.75)', '#fff3c4');
    pineRowOf(g, 53, 10, '#aed2b4', 3.4, 11, 0.1);
    hazeOf(g, 56, 5, [222, 238, 214]);
    pineRowOf(g, 63, 14, '#88bb95', 4.4, 12, 0.12);
    hazeOf(g, 66, 4, [210, 232, 204]);
    pineRowOf(g, 73, 20, '#5a9469', 6.2, 13, 0.16);
    groundOf(g, 75, '#5f9150', '#294b29');
    sunlitOf(g, 75, [214, 226, 150]);
    // a worn path out of the wood
    const path = new Path2D(); path.moveTo(-2, SH); path.quadraticCurveTo(18, 92, 41, 77.5); path.lineTo(46, 77.5); path.quadraticCurveTo(34, 96, 30, SH); path.closePath();
    g.fillStyle = 'rgba(180,158,104,0.42)'; g.fill(path);
    bladesOf(g, 14, 120, 77, 116, 'rgba(36,70,32,0.7)', 'rgba(150,196,110,0.55)');
    // tall firs either side frame the clearing
    firAt(g, 2, 124, 104, '#22502f', 3, { tiers: 9, wf: 0.2, lit: 0.06 });
    firAt(g, 98.5, 120, 92, '#1f4a2c', 4, { tiers: 9, wf: 0.2 });
    // the stack: three, two, one, cut ends to the front, lit from the top left
    const R = 8.6, d = 6.5, logs = [[32.4, 101], [50, 101], [67.6, 101], [41.2, 85.6], [58.8, 85.6], [50, 70.2]];
    castOf(g, [[22, 108], [78, 108], [30, 105], [86, 104.5], [74, 99], [58, 103]], 0.32, 2);
    [32.4, 50, 67.6].forEach((x) => contactOf(g, x + 0.6, 109.4, 6.6, 1.3, 0.6));
    const bodies = logs.map(([x, y]) => { const b = new Path2D(); b.moveTo(x - R, y); b.lineTo(x - R, y - d); b.arc(x, y - d, R, Math.PI, TAU); b.lineTo(x + R, y); b.closePath(); return b; });
    logs.forEach(([x, y], n) => {
      const body = bodies[n], bk = g.createLinearGradient(x - R, 0, x + R, 0); bk.addColorStop(0, '#8e6646'); bk.addColorStop(0.42, '#5e3e26'); bk.addColorStop(1, '#2e1c0e');
      g.fillStyle = bk; g.fill(body);
      g.save(); g.clip(body);
      const r = rng(70 + n);
      for (let k = 0; k < 16; k++) { const bx = x - R + r() * 2 * R, lt = bx < x - R * 0.2; line(g, [[bx, y + 1], [bx + (r() - 0.5) * 1.2, y - d - R]], lt ? 'rgba(196,152,104,0.4)' : 'rgba(18,10,4,0.5)', 0.35 + r() * 0.5); }
      g.restore();
    });
    logs.forEach(([x, y], n) => {
      const r = rng(90 + n), wr = R - 1.4, px = x + (r() - 0.5) * 1.6, py = y + (r() - 0.5) * 1.4;
      g.fillStyle = '#3b2513'; g.beginPath(); circle(g, x, y, R); g.fill();
      g.strokeStyle = '#94694a'; g.lineWidth = 1.1; g.beginPath(); g.arc(x, y, R - 0.6, Math.PI * 1.02, Math.PI * 1.62); g.stroke();
      const wd = g.createRadialGradient(x - wr * 0.4, y - wr * 0.42, 0, x, y, wr * 1.05);
      wd.addColorStop(0, '#f8deb0'); wd.addColorStop(0.6, '#dcab6e'); wd.addColorStop(1, '#b07a45');
      g.fillStyle = wd; g.beginPath(); circle(g, x, y, wr); g.fill();
      g.fillStyle = 'rgba(150,92,44,0.28)'; g.beginPath(); circle(g, px, py, wr * 0.42); g.fill();
      g.strokeStyle = 'rgba(252,236,200,0.6)'; g.lineWidth = 0.5; g.beginPath(); circle(g, x, y, wr - 0.6); g.stroke();
      g.strokeStyle = 'rgba(150,96,50,0.55)'; g.lineWidth = 0.32;
      [0.16, 0.3, 0.44, 0.57, 0.7, 0.82].forEach((k) => { g.beginPath(); for (let a = 0; a <= TAU + 0.01; a += 0.35) { const q = wr * k * (1 + (r() - 0.5) * 0.06), xx = px + Math.cos(a) * q, yy = py + Math.sin(a) * q; a ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.closePath(); g.stroke(); });
      fillCircles(g, [[px, py, 0.7]], '#8a5a2e');
      g.strokeStyle = 'rgba(40,20,6,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, wr - 0.5, -0.15, Math.PI * 0.65); g.stroke();
    });
    // the axe, struck into the top of the top log, at its middle
    const pile = new Path2D(); bodies.forEach((bd) => pile.addPath(bd)); logs.forEach(([x, y]) => { pile.moveTo(x + R, y); pile.arc(x, y, R, 0, TAU); });
    const endTop = new Path2D(); endTop.moveTo(50 + R, 70.2); endTop.arc(50, 70.2, R, 0, TAU);
    axeOnTop(g, [50, 56.2], [50, 65.4, R], bodies[5], endTop, pile);
    // chips from the splitting, lying in the grass
    const r = rng(9);
    for (let i = 0; i < 12; i++) { const x = 12 + r() * 78, y = 108 + r() * 7; if (x > 22 && x < 78 && y < 111) continue; const a = r() * TAU, l = 1.4 + r(); softFill(g, polyPath([[x + 0.4, y + 0.5], [x + 0.4 + Math.cos(a) * l, y + 0.5 + Math.sin(a) * l * 0.5], [x + 0.9 + Math.cos(a) * l, y + 0.9 + Math.sin(a) * l * 0.5]]), 'rgba(20,30,10,0.5)', 0.3); g.fillStyle = '#ecc993'; g.fill(polyPath([[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5], [x + 0.5 + Math.cos(a) * l, y + 0.4 + Math.sin(a) * l * 0.5], [x + 0.6, y + 0.5]])); }
    vignetteOf(g);
  },
  brick(g) {
    skyOf(g, [[0, '#e99a77'], [0.5, '#f5c6a0'], [1, '#fde4ca']]);
    sunOf(g, 16, 15, 6, 'rgba(255,236,200,0.8)', '#fff0d0');
    g.fillStyle = 'rgba(255,238,222,0.55)'; [[52, 22, 26, 2.2], [74, 30, 18, 1.6], [36, 33, 14, 1.3]].forEach(([x, y, rx, ry]) => g.fill(ellipsePath(x, y, rx, ry)));
    g.fillStyle = 'rgba(214,132,104,0.35)'; [[54, 23.4, 24, 1.2], [75, 31.1, 16, 0.8]].forEach(([x, y, rx, ry]) => g.fill(ellipsePath(x, y, rx, ry)));
    ridgeOf(g, 58, 4, '#e2a283', 21, { rim: 'rgba(255,226,204,0.6)' });
    hazeOf(g, 61, 5, [250, 214, 190]);
    ridgeOf(g, 68, 4, '#cc7553', 22, { rim: 'rgba(240,170,130,0.7)' });
    const gr = g.createLinearGradient(0, 74, 0, SH); gr.addColorStop(0, '#c36d48'); gr.addColorStop(1, '#7c371e');
    const yard = ridgeOf(g, 77, 0.9, gr, 23, { freq: 0.5, rim: 'rgba(240,170,130,0.5)' });
    sunlitOf(g, 77, [246, 176, 130]);
    // cracked, sun-dried clay
    const cr = rng(25);
    g.strokeStyle = 'rgba(96,36,16,0.38)'; g.lineWidth = 0.35; g.beginPath();
    for (let i = 0; i < 30; i++) { let x = cr() * SW, y = 80 + cr() * 36, a = cr() * TAU; const sc = 0.4 + (y - 78) / 40; g.moveTo(x, y); for (let k = 0; k < 3; k++) { a += (cr() - 0.5) * 1.6; x += Math.cos(a) * 3.2 * sc; y += Math.sin(a) * 1.2 * sc; g.lineTo(x, y); } }
    g.stroke();
    // a hack of green bricks drying under a board, far off on the left
    for (let x = 4; x < 34; x += 0.9) { const y = yOn(yard, x) + 3.4; g.fillStyle = (x * 7) % 2 < 1 ? '#c9a184' : '#b48c70'; g.fillRect(x, y - 2.6, 0.7, 2.6); }
    line(g, [[3.6, yOn(yard, 4) + 0.7], [34.4, yOn(yard, 34) + 0.7]], '#6e4a36', 0.7);
    softFill(g, polyPath([[4, yOn(yard, 4) + 3.4], [34, yOn(yard, 34) + 3.4], [35, yOn(yard, 34) + 4.2], [5, yOn(yard, 4) + 4.2]]), 'rgba(80,24,8,0.4)', 0.4);
    // the kiln, firing, its smoke drifting away from the light
    const kx = 83, ky = yOn(yard, 83) + 1.5;
    [[kx + 2, ky - 21, 2.6, 0.5], [kx + 6, ky - 26, 3.4, 0.36], [kx + 11, ky - 30, 4.4, 0.24], [kx + 18, ky - 32, 5.4, 0.14]].forEach(([x, y, rr, a]) => fillCircles(g, [[x, y, rr]], `rgba(250,242,232,${a})`));
    contactOf(g, kx + 1.5, ky, 12.5, 1.6, 0.5);
    const kiln = domePath(kx, ky, 11, 17);
    const kg = g.createRadialGradient(kx - 5, ky - 12, 1, kx, ky - 6, 16); kg.addColorStop(0, '#dd8058'); kg.addColorStop(0.6, '#a9482b'); kg.addColorStop(1, '#6a2715');
    g.fillStyle = kg; g.fill(kiln);
    g.save(); g.clip(kiln); g.strokeStyle = 'rgba(70,22,10,0.45)'; g.lineWidth = 0.4;
    [0.14, 0.28, 0.42, 0.55, 0.67, 0.78, 0.88].forEach((k) => { const yy = ky - 17 * k, ww = 11 * Math.sqrt(1 - k * k); g.beginPath(); g.moveTo(kx - ww, yy); g.quadraticCurveTo(kx, yy + 1.2, kx + ww, yy); g.stroke(); });
    g.restore();
    const arch = new Path2D(); arch.moveTo(kx - 3.4, ky); arch.lineTo(kx - 3.4, ky - 4); arch.arc(kx - 0.6, ky - 4, 2.8, Math.PI, TAU); arch.lineTo(kx + 2.2, ky); arch.closePath();
    const fire = g.createRadialGradient(kx - 0.6, ky - 1.5, 0, kx - 0.6, ky - 3, 5); fire.addColorStop(0, '#fff0b0'); fire.addColorStop(0.45, '#ff9440'); fire.addColorStop(1, '#5a1a08');
    g.fillStyle = fire; g.fill(arch); g.strokeStyle = '#7a2e18'; g.lineWidth = 0.8; g.stroke(arch);
    const glow = g.createRadialGradient(kx - 1, ky + 1, 0, kx - 1, ky + 1, 7); glow.addColorStop(0, 'rgba(255,170,90,0.4)'); glow.addColorStop(1, 'rgba(255,170,90,0)');
    g.save(); g.translate(0, ky); g.scale(1, 0.35); g.fillStyle = glow; g.fillRect(kx - 8, -8, 16, 16); g.restore();
    g.fillStyle = '#7d331c'; g.fillRect(kx - 1.5, ky - 19, 3, 2.4); g.fillStyle = '#a24b2c'; g.fillRect(kx - 1.5, ky - 19, 1, 2.4);
    // the cube of fired bricks on its pallet: courses laid crosswise, the top one a brick short
    const P = obl(24, 108.2), L = 18, W = 9, H = 5.2, gp = 0.34, PH = 3.8, r = rng(27), PX = 2 * L, PZ = 2 * W;
    const sh = [];
    [[-1, -1], [PX + 1, -1], [PX + 1, PZ + 1], [-1, PZ + 1]].forEach(([x, z]) => { sh.push(P(x, 0, z)); const hh = PH + 6 * H; sh.push(P(x + 0.5 * hh, 0, z - 0.18 * hh)); });
    castOf(g, sh, 0.36, 1.4);
    softFill(g, polyPath([P(-1.4, 0, -1.4), P(PX + 1.4, 0, -1.4), P(PX + 1.4, 0, PZ + 1.4), P(-1.4, 0, PZ + 1.4)]), 'rgba(40,10,4,0.55)', 0.7);
    oblBox(g, P, [-1, PX + 1], [0, 2.4], [-1, PZ + 1], [40, 22, 16], { kf: 0.7, ks: 0.5, kt: 0.8 });
    const wood = [168, 140, 100];
    [-1, PX / 2 - 2, PX - 3].forEach((x0) => oblBox(g, P, [x0, x0 + 4], [0, 2.4], [-1, PZ + 1], wood, { kf: 0.82, ks: 0.6 }));
    for (let x0 = -1; x0 < PX + 1; x0 += 5.4) { const f = oblBox(g, P, [x0, Math.min(PX + 1, x0 + 4.8)], [2.4, PH], [-1, PZ + 1], mixC(wood, [120, 96, 66], r() * 0.4), { kf: 0.7, ks: 0.6, kt: 1.06 }); fillCircles(g, [[(f.front[0][0] + f.front[1][0]) / 2, (f.front[0][1] + f.front[2][1]) / 2, 0.24]], 'rgba(40,26,12,0.6)'); }
    oblBox(g, P, [0, PX], [PH, PH + 5 * H - gp], [0, PZ], [52, 20, 12], { kf: 0.8, ks: 0.6, kt: 0.8 });
    for (let c = 0; c < 6; c++) {
      const y0 = PH + c * H, Y = [y0, y0 + H - gp], last = c === 5, list = [];
      if (c % 2 === 0) { for (const zi of [1, 0]) for (const xi of [0, 1]) list.push([[xi * L + gp / 2, xi * L + L - gp / 2], [zi * W + gp / 2, zi * W + W - gp / 2]]); }
      else for (let xi = 0; xi < (last ? 3 : 4); xi++) list.push([[xi * W + gp / 2, xi * W + W - gp / 2], [gp / 2, L - gp / 2]]);
      list.forEach(([X, Z]) => brickOb(g, P, X, Y, Z, r, { fine: true, frog: last || c === 4 }));
    }
    // a brick and a broken half lying in front
    [[obl(69, 114), [0, L], [0, W]], [obl(8, 114.5), [0, 8.4], [0, W]]].forEach(([Q, X, Z], i) => {
      const sh2 = []; [[X[0], Z[0]], [X[1], Z[0]], [X[1], Z[1]], [X[0], Z[1]]].forEach(([x, z]) => { sh2.push(Q(x, 0, z)); sh2.push(Q(x + 2.3, 0, z - 0.8)); });
      castOf(g, sh2, 0.34, 0.8);
      contactOf(g, ...Q((X[0] + X[1]) / 2, 0, 0.6), (X[1] - X[0]) * 0.55, 0.7, 0.55);
      const f = brickOb(g, Q, X, [0, H], Z, r, { fine: true, frog: i === 0 });
      if (i === 1) { g.fillStyle = css(litC([170, 74, 46], 0.7)); g.fill(polyPath([f.side[0], [f.side[0][0] + 0.8, f.side[0][1] - 1.3], [f.side[0][0] + 0.2, f.side[0][1] - 2.6], [f.side[1][0] + 0.7, f.side[1][1] - 2.4], [f.side[2][0], f.side[2][1]], f.side[3]])); }
    });
    const ch = rng(28);
    for (let i = 0; i < 9; i++) { const x = 8 + ch() * 84, y = 108 + ch() * 8; if (x > 24 && x < 70 && y < 111) continue; contactOf(g, x + 0.4, y + 0.6, 0.9, 0.3, 0.5); g.fillStyle = css(mixC([200, 96, 60], [150, 60, 36], ch())); g.fill(polyPath([[x, y], [x + 1.2 + ch(), y - 0.4], [x + 1.6, y + 0.5], [x + 0.3, y + 0.8]])); }
    vignetteOf(g);
  },
  wool(g) {
    skyOf(g, [[0, '#76b0d8'], [0.55, '#bddff0'], [1, '#eef6e6']]);
    sunOf(g, 15, 14, 5, 'rgba(255,255,236,0.6)', '#fffbe4');
    cloudOf(g, 70, 24, 6.2, '#ffffff', '#c3d7e6'); cloudOf(g, 36, 35, 3.6, '#fbfdff', '#c7dae7');
    ridgeOf(g, 57, 3, '#b8d89a', 31, { rim: 'rgba(240,250,220,0.8)' });
    hazeOf(g, 59.5, 4, [236, 244, 224]);
    const hill = g.createLinearGradient(0, 60, 0, 80); hill.addColorStop(0, '#a8d07a'); hill.addColorStop(1, '#84b558');
    const mid = ridgeOf(g, 66, 4, hill, 32, { rim: 'rgba(220,240,176,0.75)' });
    // a dry-stone wall runs across the hill just under its crest, and two more of the flock graze there
    stoneWall(g, mid, 3.4, 37);
    eweAt(g, 19, yOn(mid, 19) + 8.6, 0.15, { graze: true });
    eweAt(g, 84, yOn(mid, 84) + 7.4, 0.12, { graze: true, flip: true });
    // the meadow in front rises gently toward us
    const fgd = g.createLinearGradient(0, 73, 0, SH); fgd.addColorStop(0, '#93c35e'); fgd.addColorStop(1, '#447329');
    ridgeOf(g, 77, 1.4, fgd, 33, { rim: 'rgba(206,236,150,0.55)', freq: 0.6 });
    sunlitOf(g, 77, [220, 240, 160]);
    bladesOf(g, 33, 170, 78, 117, 'rgba(52,94,32,0.7)', 'rgba(184,224,128,0.6)');
    const fr = rng(34);
    for (let i = 0; i < 26; i++) { const y = 80 + fr() * 36, x = fr() * SW, s = 0.35 + (y - 80) / 36 * 0.5; fillCircles(g, [[x, y, s]], i % 3 ? '#fbf8f0' : '#f4d25e'); }
    eweAt(g, 46.5, 106.8, 1.04, { seed: 35 });
    bladesOf(g, 36, 40, 104, 109, 'rgba(52,94,32,0.75)', 'rgba(170,214,116,0.6)');
    vignetteOf(g);
  },
  grain(g) {
    skyOf(g, [[0, '#eab55a'], [0.5, '#f6d892'], [1, '#fdefcc']]);
    beamsOf(g, 17, 16, 'rgba(255,248,220,0.1)', 5);
    sunOf(g, 17, 16, 7, 'rgba(255,244,200,0.85)', '#fff5d2');
    const far = ridgeOf(g, 57, 2.4, '#ddb86a', 41, { rim: 'rgba(255,240,200,0.7)' });
    hazeOf(g, 59, 4.5, [250, 230, 178]);
    millAt(g, 84, yOn(far, 84) + 1.4, 17);
    // the stubble where the field is cut, rows running to the horizon
    const st = g.createLinearGradient(0, 60, 0, SH); st.addColorStop(0, '#dcae52'); st.addColorStop(1, '#a87628');
    g.fillStyle = st; g.fillRect(0, 60, SW, SH - 60);
    g.save(); g.beginPath(); g.rect(0, 68, SW, SH); g.clip();
    for (let x = -130; x <= 230; x += 6.5) { line(g, [[50, 57], [x, SH + 4]], 'rgba(140,92,24,0.45)', 0.8); line(g, [[50.6, 57], [x + 2.4, SH + 4]], 'rgba(255,232,160,0.35)', 0.5); }
    g.restore();
    // the standing crop beyond, cut along a ragged edge
    const edge = (x) => 68.4 + Math.sin(x * 0.21) * 0.5 + Math.sin(x * 0.67 + 1) * 0.3;
    const crop = polyPath([[0, 59], [SW, 59], ...Array.from({ length: 51 }, (_, i) => [SW - i * 2, edge(SW - i * 2)])]);
    const cg = g.createLinearGradient(0, 59, 0, 69); cg.addColorStop(0, '#e8c062'); cg.addColorStop(1, '#d29e3a');
    g.fillStyle = cg; g.fill(crop);
    softFill(g, polyPath([...Array.from({ length: 51 }, (_, i) => [i * 2, edge(i * 2)]), [SW, 70.6], [0, 70.6]]), 'rgba(110,64,10,0.35)', 0.6);
    const cr = rng(42), dl = new Path2D(), dd = new Path2D();
    for (let i = 0; i < 520; i++) { const x = cr() * SW, t = cr(), y = 59.5 + t * (edge(x) - 59.5), s = 0.25 + t * 0.55; lensPath(x, y, x + (cr() - 0.5) * s * 0.4, y - s * 1.8, s * 0.3, i % 3 ? dl : dd); }
    for (let x = 0; x < SW; x += 0.7) { const y = edge(x); lensPath(x, y + 0.2, x + (cr() - 0.5) * 0.5, y - 1.8, 0.28, x % 1.4 < 0.7 ? dl : dd); }
    g.fillStyle = 'rgba(255,236,170,0.65)'; g.fill(dl); g.fillStyle = 'rgba(150,100,26,0.45)'; g.fill(dd);
    sunlitOf(g, 68, [255, 236, 170]);
    const ticks = Array.from({ length: 110 }, () => { const y = 70 + Math.pow(cr(), 0.7) * 47, x = cr() * SW; return [x, y, 0.4 + (y - 70) / 47 * 1.4]; });
    g.strokeStyle = 'rgba(120,76,16,0.5)'; g.lineWidth = 0.4; g.beginPath(); ticks.forEach(([x, y, s]) => { g.moveTo(x - s * 0.3, y + 0.15); g.lineTo(x + s * 0.4, y + 0.15); }); g.stroke();
    g.strokeStyle = 'rgba(250,226,160,0.6)'; g.lineWidth = 0.32; g.beginPath(); ticks.forEach(([x, y, s]) => { g.moveTo(x, y); g.lineTo(x + 0.15 * s, y - s); g.moveTo(x + 0.3 * s, y); g.lineTo(x + 0.5 * s, y - s * 0.8); }); g.stroke();
    // stooks drying out in the field
    stookAt(g, 13, 76, 10, 3); stookAt(g, 88, 74, 7.5, 4);
    sheafAt(g, 51, 107, 44, 1.28);
    // a sickle laid in the stubble
    sickleAt(g, 21, 111, 0.22, 1.25);
    vignetteOf(g);
  },
  ore(g) {
    skyOf(g, [[0, '#7d92ad'], [0.55, '#b8c6d7'], [1, '#e2e8ef']], 66);
    sunOf(g, 15, 14, 4.5, 'rgba(255,255,255,0.5)', '#f4f7fb');
    // peaks, each face lit by the way it turns to the light, snow on the tops
    [[22, 28, 24, 63], [50, 24, 27, 63], [8, 38, 18, 63], [74, 30, 22, 63]].forEach(([px, py, hw, base], i) => {
      const r = rng(50 + i), mid = [px + hw * 0.18, base];
      g.fillStyle = '#c3ccd9'; g.fill(polyPath([[px - hw, base], [px, py], mid]));
      g.fillStyle = '#7c889c'; g.fill(polyPath([[px, py], [px + hw, base], mid]));
      g.fillStyle = 'rgba(70,80,100,0.22)'; g.fill(polyPath([[px - hw * 0.5, base], [px - hw * 0.2, py + (base - py) * 0.45], [px - hw * 0.05, base]]));
      const sy = py + (base - py) * (0.3 + r() * 0.06), sl = px - (sy - py) / (base - py) * hw, sR = px + (sy - py) / (base - py) * hw, sm = px + (sy - py) / (base - py) * hw * 0.18;
      g.fillStyle = '#f7f9fc'; g.fill(polyPath([[px, py], [sm, sy + 1.4], [sm - 2.4, sy - 0.6], [sl + 3.2, sy + 1.6], [sl, sy]]));
      g.fillStyle = '#c4cfdd'; g.fill(polyPath([[px, py], [sR, sy], [sR - 2.6, sy + 1.4], [sm + 1.6, sy - 0.4], [sm, sy + 1.4]]));
    });
    hazeOf(g, 62.5, 5, [206, 216, 228]);
    const gd = g.createLinearGradient(0, 63, 0, SH); gd.addColorStop(0, '#98a1b0'); gd.addColorStop(0.25, '#727b8a'); gd.addColorStop(1, '#3c424d');
    g.fillStyle = gd; g.fillRect(0, 63.6, SW, SH);
    ridgeOf(g, 63.6, 2.2, '#727b8c', 57, { rough: 1.3, freq: 2.4, rim: 'rgba(200,210,224,0.35)' });
    const gd2 = g.createLinearGradient(0, 64, 0, SH); gd2.addColorStop(0, '#7b8493'); gd2.addColorStop(0.3, '#646d7c'); gd2.addColorStop(1, '#383e48');
    ridgeOf(g, 66.2, 0.8, gd2, 58, { freq: 0.7 });
    hazeOf(g, 64, 2.2, [176, 186, 200]);
    // old snow lying in hollows, and boulders, smaller toward the range
    const sn = rng(59);
    for (let i = 0; i < 7; i++) { const x = sn() * 60, y = 68 + sn() * 14, k = 0.4 + (y - 66) / 30; g.fillStyle = 'rgba(226,232,240,0.55)'; g.fill(ellipsePath(x, y, (3 + sn() * 5) * k, (0.6 + sn() * 0.5) * k)); }
    for (let i = 0; i < 6; i++) { const x = 4 + sn() * 40, y = 70 + sn() * 22, k = 0.5 + (y - 66) / 22; contactOf(g, x + 0.3 * k, y + 0.3 * k, 1.6 * k, 0.45 * k, 0.5); lumpOf(g, x, y - 0.6 * k, 1.5 * k, sn, [[50, 56, 66], [100, 108, 122], [176, 186, 200]]); }
    sunlitOf(g, 64, [226, 232, 242]);
    // the hillside the mine is driven into, rock in lit and shaded planes, snow lying on its shoulders
    const hillPts = [[48, 79], [55, 72], [61, 66], [66, 60], [72, 56], [80, 52], [90, 49.5], [102, 48], [102, 82]];
    g.fillStyle = '#5f6878'; g.fill(polyPath(hillPts));
    [[[55, 72], [61, 66], [66, 60], [64, 70], [58, 76]], [[66, 60], [72, 56], [80, 52], [76, 62], [70, 66]], [[80, 52], [90, 49.5], [102, 48], [102, 58], [88, 58]], [[64, 70], [70, 66], [76, 62], [74, 72]]].forEach((pts, i) => { g.fillStyle = ['#8b96a8', '#a3aec0', '#97a2b4', '#6c7586'][i]; g.fill(polyPath(pts)); });
    g.fillStyle = '#eef2f7'; g.fill(polyPath([[72, 56], [80, 52], [90, 49.5], [86, 52.4], [79, 54.6], [74, 57.4]])); g.fill(polyPath([[61, 66], [66, 60], [67, 61.6], [62.6, 66.4]]));
    const rk = rng(52);
    for (let i = 0; i < 12; i++) { const x = 58 + rk() * 42, y = 58 + rk() * 22; line(g, [[x, y], [x + 2 + rk() * 3, y - 1 - rk() * 2]], 'rgba(30,36,46,0.4)', 0.35); }
    // the mine: a timbered portal facing back down the track, dark inside, a lantern burning in it
    const t1 = 2.5, hw = 0.36, PT = (b, Y, da = 0) => onTrack(t1 + da, b, Y);
    const face = polyPath([PT(-hw - 0.5, 0), PT(-hw - 0.42, 0.55), PT(-hw - 0.18, 1.02), PT(0.05, 1.2), PT(hw + 0.3, 1.04), PT(hw + 0.55, 0.62), PT(hw + 0.66, 0)]);
    g.fillStyle = '#4a515e'; g.fill(face);
    g.fillStyle = '#7d879a'; g.fill(polyPath([PT(-hw - 0.5, 0), PT(-hw - 0.42, 0.55), PT(-hw - 0.18, 1.02), PT(0.05, 1.2), PT(-hw + 0.1, 0.92), PT(-hw - 0.1, 0.3)]));
    g.fillStyle = '#5f6878'; g.fill(polyPath([PT(0.05, 1.2), PT(hw + 0.3, 1.04), PT(hw + 0.1, 0.9), PT(-0.1, 0.96)]));
    const mouth = polyPath([PT(-hw, 0), PT(-hw, 0.74), PT(hw, 0.74), PT(hw, 0)]);
    const mg = g.createLinearGradient(0, PT(0, 0.74)[1], 0, PT(0, 0)[1]); mg.addColorStop(0, '#07080b'); mg.addColorStop(1, '#1d1a18');
    g.fillStyle = mg; g.fill(mouth);
    const deep = PT(0.05, 0.3, 1.2), dg = g.createRadialGradient(deep[0], deep[1], 0, deep[0], deep[1], 5); dg.addColorStop(0, 'rgba(255,190,100,0.55)'); dg.addColorStop(1, 'rgba(255,190,100,0)');
    g.save(); g.clip(mouth); g.fillStyle = dg; g.fillRect(deep[0] - 6, deep[1] - 6, 12, 12); g.restore();
    // the track: a gravel bed, sleepers, two rails, all of it running on into the dark
    const a0 = -1.32, a2 = t1 + 1.4;
    const bed = polyPath([onTrack(a0, -0.42), onTrack(t1, -0.42), onTrack(t1, 0.42), onTrack(a0, 0.42)]);
    g.fillStyle = '#5c5550'; g.fill(bed);
    g.save(); g.clip(bed); const gv = rng(53); for (let i = 0; i < 260; i++) { const a = a0 + gv() * (t1 - a0), b = (gv() - 0.5) * 0.84, [x, y] = onTrack(a, b), z = trackZ(a, b); fillCircles(g, [[x, y, 0.25 / z + gv() * 0.3 / z]], gv() < 0.5 ? 'rgba(180,176,170,0.6)' : 'rgba(40,36,34,0.55)'); } g.restore();
    const drawTrack = (from, to) => {
      for (let a = Math.floor(to / 0.21) * 0.21; a >= from; a -= 0.21) {
        const tie = polyPath([onTrack(a - 0.04, -0.3, 0.035), onTrack(a + 0.04, -0.3, 0.035), onTrack(a + 0.04, 0.3, 0.035), onTrack(a - 0.04, 0.3, 0.035)]);
        const face = polyPath([onTrack(a - 0.04, -0.3, 0), onTrack(a - 0.04, 0.3, 0), onTrack(a - 0.04, 0.3, 0.035), onTrack(a - 0.04, -0.3, 0.035)]);
        g.fillStyle = '#3e2e22'; g.fill(face); g.fillStyle = '#6e5440'; g.fill(tie);
      }
      [-0.15, 0.15].forEach((b) => {
        const web = polyPath([onTrack(from, b + 0.012, 0.035), onTrack(to, b + 0.012, 0.035), onTrack(to, b + 0.012, 0.075), onTrack(from, b + 0.012, 0.075)]);
        const head = polyPath([onTrack(from, b - 0.016, 0.075), onTrack(to, b - 0.016, 0.075), onTrack(to, b + 0.016, 0.075), onTrack(from, b + 0.016, 0.075)]);
        g.fillStyle = '#3a3f47'; g.fill(web); g.fillStyle = '#c7ced8'; g.fill(head);
      });
    };
    g.save(); g.clip(mouth); drawTrack(t1, a2);
    const dk = g.createLinearGradient(0, PT(0, 0)[1], 0, PT(0, 0, 1.4)[1]); dk.addColorStop(0, 'rgba(8,8,10,0.15)'); dk.addColorStop(1, 'rgba(8,8,10,0.95)');
    g.fillStyle = dk; g.fill(mouth); g.restore();
    drawTrack(a0, t1);
    // the portal's frame: two posts and a cap, in squared timber
    const timber = (pts, lit) => { g.fillStyle = lit ? '#8a6a48' : '#5e4630'; g.fill(polyPath(pts)); };
    timber([PT(-hw - 0.08, 0), PT(-hw - 0.08, 0.8), PT(-hw, 0.8), PT(-hw, 0)], true);
    timber([PT(hw, 0), PT(hw, 0.8), PT(hw + 0.08, 0.8), PT(hw + 0.08, 0)], false);
    timber([PT(-hw - 0.14, 0.74), PT(-hw - 0.14, 0.86), PT(hw + 0.14, 0.86), PT(hw + 0.14, 0.74)], true);
    line(g, [PT(-hw - 0.14, 0.86), PT(hw + 0.14, 0.86)], 'rgba(220,190,150,0.6)', 0.4);
    line(g, [PT(-hw - 0.08, 0.8), PT(-hw - 0.08, 0.02)], 'rgba(220,190,150,0.5)', 0.35);
    // rubble heaped either side of the portal
    const rb = rng(55);
    [[-hw - 0.34, 0.05], [-hw - 0.2, 0.1], [hw + 0.28, 0.06], [hw + 0.45, 0.12], [hw + 0.18, 0.16]].forEach(([b, da]) => { const [x, y] = PT(b, 0.03, -da), s2 = (0.07 + rb() * 0.04) * 60 / trackZ(t1 - da, b); contactOf(g, x + 0.3, y + s2 * 0.5, s2 * 1.1, s2 * 0.35, 0.5); lumpOf(g, x, y, s2, rb, [[46, 52, 62], [96, 104, 118], [170, 180, 196]]); });
    // a lantern on the left post, and its light on the ground
    const [lx, ly] = PT(-hw - 0.2, 0.52);
    const pool = g.createRadialGradient(lx, PT(-hw, 0)[1] + 1, 0, lx, PT(-hw, 0)[1] + 1, 9); pool.addColorStop(0, 'rgba(255,190,110,0.32)'); pool.addColorStop(1, 'rgba(255,190,110,0)');
    g.save(); g.translate(0, PT(-hw, 0)[1] + 1); g.scale(1, 0.4); g.fillStyle = pool; g.fillRect(lx - 9, -9, 18, 18); g.restore();
    line(g, [[lx + 0.4, ly - 2.4], [lx + 1.6, ly - 2.4]], '#2a2018', 0.35);
    sunOf(g, lx, ly, 1.3, 'rgba(255,200,110,0.75)', '#ffd58a');
    g.fillStyle = '#2a2018'; g.fillRect(lx - 0.75, ly - 1.7, 1.5, 0.45); g.fillRect(lx - 0.75, ly + 1.2, 1.5, 0.4);
    // the cart, on the rails in front: a tapered iron box on four flanged wheels, heaped with ore
    const C = (a, b, Y) => onTrack(a, b, Y), Zc = (a, b) => trackZ(a, b);
    const bot = { a: 0.4, b: 0.2, y: 0.19 }, top = { a: 0.49, b: 0.26, y: 0.56 };
    const shp = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sa, sb]) => { shp.push(C(sa * top.a, sb * top.b, 0)); const X = TRACK.o[0] + TRACK.d[0] * sa * top.a + TRACK.n[0] * sb * top.b, Z = trackZ(sa * top.a, sb * top.b); shp.push(PJ(X + 0.5 * top.y, 0, Z - 0.2 * top.y)); });
    castOf(g, shp, 0.42, 1.6);
    const wheel = (a, b, rad, near) => {
      const pts = Array.from({ length: 28 }, (_, i) => { const t = i * TAU / 28; return C(a + Math.cos(t) * rad, b, 0.1 + Math.sin(t) * rad); });
      const hub = Array.from({ length: 20 }, (_, i) => { const t = i * TAU / 20; return C(a + Math.cos(t) * rad * 0.42, b + 0.01, 0.1 + Math.sin(t) * rad * 0.42); });
      contactOf(g, ...C(a, b, 0), 2.6 / Zc(a, b), 0.6 / Zc(a, b), 0.6);
      g.fillStyle = near ? '#23262c' : '#121418'; g.fill(polyPath(pts));
      if (near) {
        const rim = Array.from({ length: 28 }, (_, i) => { const t = i * TAU / 28; return C(a + Math.cos(t) * rad * 0.8, b + 0.012, 0.1 + Math.sin(t) * rad * 0.8); });
        g.fillStyle = '#4a5059'; g.fill(polyPath(rim));
        g.fillStyle = '#2b2f36'; g.fill(polyPath(hub));
        line(g, pts.slice(12, 21), 'rgba(210,218,228,0.7)', 0.45);
        fillCircles(g, [[...C(a, b + 0.02, 0.1), 0.45]], '#9aa3ae');
      }
    };
    [[-0.27, -0.24], [0.27, -0.24]].forEach(([a, b]) => wheel(a, b, 0.105, false));
    const corner = (sa, sb, o) => C(sa * o.a, sb * o.b, o.y);
    // the inside first: the far walls, then the heap over them
    const rimQ = [corner(-1, -1, top), corner(1, -1, top), corner(1, 1, top), corner(-1, 1, top)];
    g.fillStyle = '#1e2229'; g.fill(polyPath(rimQ));
    g.fillStyle = '#4c535e'; g.fill(polyPath([corner(1, -1, top), corner(1, 1, top), C(0.4, 0.2, 0.3), C(0.4, -0.2, 0.3)]));
    g.fillStyle = '#353b45'; g.fill(polyPath([corner(-1, -1, top), corner(1, -1, top), C(0.4, -0.2, 0.3), C(-0.4, -0.2, 0.3)]));
    const or = rng(54), lumps = [];
    for (let i = 0; i < 70; i++) {
      const u = or() * 2 - 1, v = or() * 2 - 1, a = u * 0.44, b = v * 0.22, rad = 0.05 + or() * 0.035;
      const hgt = top.y + 0.2 * (1 - u * u * 0.9) * (1 - v * v * 0.8) - 0.02 + rad * 0.5;
      lumps.push({ a, b, y: hgt, rad, z: Zc(a, b), kind: or() < 0.13 ? 'gold' : or() < 0.12 ? 'rust' : 'iron', glint: or() });
    }
    lumps.sort((p, q) => q.z - p.z || p.y - q.y);
    const ORE = { iron: [[30, 34, 44], [88, 96, 112], [186, 196, 212]], gold: [[66, 50, 22], [160, 124, 60], [244, 214, 140]], rust: [[64, 36, 26], [132, 78, 54], [210, 156, 118]] };
    lumps.forEach((l) => {
      const [x, y] = C(l.a, l.b, l.y), s = l.rad * 60 / l.z;
      lumpOf(g, x, y, s, or, ORE[l.kind]);
      if (l.glint < 0.32) { const gx = x - s * 0.3, gy = y - s * 0.35, gold = l.kind === 'gold'; sunOf(g, gx, gy, 0.55, gold ? 'rgba(255,214,120,0.7)' : 'rgba(255,255,255,0.75)', gold ? '#ffe39a' : '#ffffff'); }
    });
    // the outside: the near end in the light, the near side in shade, banded and riveted
    const endF = [corner(-1, -1, bot), corner(-1, 1, bot), corner(-1, 1, top), corner(-1, -1, top)];
    const sideF = [corner(-1, 1, bot), corner(1, 1, bot), corner(1, 1, top), corner(-1, 1, top)];
    const eg = g.createLinearGradient(endF[3][0], endF[3][1], endF[1][0], endF[1][1]); eg.addColorStop(0, '#a6afbd'); eg.addColorStop(1, '#6a7380');
    g.fillStyle = eg; g.fill(polyPath(endF));
    const sgd = g.createLinearGradient(sideF[0][0], 0, sideF[1][0], 0); sgd.addColorStop(0, '#59616e'); sgd.addColorStop(1, '#353b45');
    g.fillStyle = sgd; g.fill(polyPath(sideF));
    const band = (a, w, col) => { g.fillStyle = col; g.fill(polyPath([C(a - w, 0.205, 0.19), C(a + w, 0.205, 0.19), C(a * 1.225 + w, 0.265, 0.56), C(a * 1.225 - w, 0.265, 0.56)])); };
    [-0.36, 0, 0.36].forEach((a) => band(a, 0.022, '#2c3139'));
    [-0.36, 0, 0.36].forEach((a) => { [0.26, 0.48].forEach((Y) => { const t = (Y - 0.19) / 0.37; fillCircles(g, [[...C(a * (1 + 0.225 * t), 0.21 + 0.06 * t, Y), 0.32]], '#aab3bf'); }); });
    line(g, [corner(-1, -1, top), corner(-1, 1, top), corner(1, 1, top)], '#d5dbe3', 0.9);
    line(g, [corner(-1, 1, top), corner(1, 1, top)].map(([x, y]) => [x, y + 0.7]), 'rgba(20,24,30,0.6)', 0.4);
    line(g, [corner(-1, -1, top), corner(1, -1, top), corner(1, 1, top)], 'rgba(200,208,220,0.6)', 0.4);
    line(g, [corner(-1, 1, bot), corner(1, 1, bot)], '#22262c', 0.7);
    [[-0.27, 0.24], [0.27, 0.24]].forEach(([a, b]) => wheel(a, b, 0.105, true));
    // straps and rivets on the near end too, and its coupling
    [-0.12, 0.12].forEach((b) => { g.fillStyle = '#5d6672'; g.fill(polyPath([C(-0.405, b - 0.018, 0.19), C(-0.405, b + 0.018, 0.19), C(-0.495, b * 1.3 + 0.018, 0.56), C(-0.495, b * 1.3 - 0.018, 0.56)])); [0.27, 0.47].forEach((Y) => fillCircles(g, [[...C(-0.41 - (Y - 0.19) * 0.24, b * (1 + (Y - 0.19) * 0.8), Y), 0.3]], '#c9d0da')); });
    const hook = C(-0.44, 0, 0.17); g.fillStyle = '#2a2e35'; g.fillRect(hook[0] - 0.7, hook[1] - 0.6, 1.4, 1.6); line(g, [[hook[0], hook[1] + 1], [hook[0] - 0.6, hook[1] + 2], [hook[0] + 0.2, hook[1] + 2.4]], '#2a2e35', 0.5);
    // a pick leant against the long side, its head over the rim and resting on the ore
    const foot = C(-0.16, 0.55, 0), restP = C(-0.08, 0.27, 0.62);
    contactOf(g, foot[0] + 0.3, foot[1] + 0.1, 1.5, 0.45, 0.6);
    const hdx = restP[0] - foot[0], hdy = restP[1] - foot[1], hl = Math.hypot(hdx, hdy), hu = [hdx / hl, hdy / hl], hn = [-hu[1], hu[0]];
    g.save(); g.clip(polyPath(sideF)); softFill(g, polyPath([[foot[0] + 1.2, foot[1] - 2], [restP[0] + 2.4, restP[1] + 0.8], [restP[0] + 3.4, restP[1] + 1], [foot[0] + 2.4, foot[1] - 2]]), 'rgba(10,12,16,0.5)', 0.8); g.restore();
    const haft = polyPath([[foot[0] - hn[0] * 0.75, foot[1] - hn[1] * 0.75], [restP[0] - hn[0] * 0.95, restP[1] - hn[1] * 0.95], [restP[0] + hn[0] * 0.95, restP[1] + hn[1] * 0.95], [foot[0] + hn[0] * 0.75, foot[1] + hn[1] * 0.75]]);
    const pg = g.createLinearGradient(foot[0] - hn[0], foot[1] - hn[1], foot[0] + hn[0], foot[1] + hn[1]); pg.addColorStop(0, '#d9a874'); pg.addColorStop(0.5, '#9a6838'); pg.addColorStop(1, '#4a2c12');
    g.fillStyle = pg; g.fill(haft);
    line(g, [[foot[0] - hn[0] * 0.35, foot[1] - hn[1] * 0.35], [restP[0] - hn[0] * 0.45, restP[1] - hn[1] * 0.45]], 'rgba(255,230,190,0.45)', 0.3);
    // the head: a curved pick one way, a chisel the other, the eye where the haft goes through
    const H0 = [restP[0] + hu[0] * 0.5, restP[1] + hu[1] * 0.5], pick = C(0.27, 0.22, 0.7), adze = C(-0.34, 0.3, 0.68);
    const arm = (tip, w0, w1, sag) => {
      const dx = tip[0] - H0[0], dy = tip[1] - H0[1], l = Math.hypot(dx, dy), up = [dy / l, -dx / l][1] < 0 ? [dy / l, -dx / l] : [-dy / l, dx / l], T = [], B = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12, w = lerp(w0, w1, t) / 2, x = H0[0] + dx * t, y = H0[1] + dy * t + sag * t * t; T.push([x + up[0] * w, y + up[1] * w]); B.push([x - up[0] * w, y - up[1] * w]); }
      return { path: polyPath([...T, ...B.reverse()]), top: T };
    };
    const arms = [arm(pick, 2, 0.15, 1.7), arm(adze, 2, 1.5, 1)];
    arms.forEach(({ path }) => softFill(g, path, 'rgba(10,10,14,0.5)', 0.8));
    arms.forEach(({ path, top }) => {
      const hg2 = g.createLinearGradient(H0[0], H0[1] - 1.2, H0[0], H0[1] + 1.4); hg2.addColorStop(0, '#f2f5f7'); hg2.addColorStop(0.45, '#a0a8b2'); hg2.addColorStop(1, '#3e454e');
      g.fillStyle = hg2; g.fill(path);
      line(g, top.slice(1, -1), 'rgba(255,255,255,0.8)', 0.3);
    });
    g.fillStyle = '#4b525c'; g.fill(rrectPath(H0[0] - 1.3, H0[1] - 1.4, 2.6, 2.8, 0.6));
    g.fillStyle = '#c3cad3'; g.fill(rrectPath(H0[0] - 1.3, H0[1] - 1.4, 2.6, 0.7, 0.35));
    fillCircles(g, [[H0[0], H0[1] + 0.1, 0.42]], '#9a6838');
    vignetteOf(g);
  },
};

export function resourceCard(g, kind, o) {
  const R = CARD[kind];
  stock(g, R.frame, kind.length * 31 + 7);
  hairline(g, css(mixC(rgbOf(R.frame), [243, 236, 220], 0.55), 0.7));
  const win = rrectPath(...WIN, 4);
  g.save(); g.clip(win); g.translate(WIN[0], WIN[1]); g.scale(WIN[2] / SW, WIN[2] / SW);
  SCENES[kind](g);
  g.restore();
  windowWell(g);
  if (!o.small) title(g, R.name, 120.5, { caps: true, size: 12, col: IVORY, rules: true });
  stockEdge(g);
}

// ---- development cards: brass engravings on charcoal ---------------------------------------
export const LIT = {
  tl: (u, v) => 1.15 - 0.75 * u - 0.55 * v,                                   // a flat face toward the top left
  cyl: (u) => 0.08 + 0.92 * Math.max(0, Math.cos((u - 0.3) * 2.5)),          // a round body, brightest a third in
  ball: (u, v) => 1.1 - 1.7 * Math.hypot(u - 0.34, v - 0.3),                    // a dome
  flat: () => 0.3,
};
// Engrave a shape: parallel lines across it, each one swelling where the light falls (and thinning to a
// hairline in shade), so the brass alone draws the form. `bend` curves the lines over a round surface.
export function cut(g, path, box, o = {}) {
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0, cx = x0 + w / 2, cy = y0 + h / 2, R = Math.hypot(w, h) / 2 + 1;
  const a = o.angle || 0, ca = Math.cos(a), sa = Math.sin(a), step = o.step || 1.15, seg = 0.75, light = o.light || LIT.tl;
  const lv = 6, paths = Array.from({ length: lv }, () => new Path2D());
  for (let t = -R; t <= R; t += step) {
    let px = null, py = null;
    for (let s = -R; s <= R + 1e-6; s += seg) {
      let x = cx + ca * s - sa * t, y = cy + sa * s + ca * t;
      if (o.bend) { const b = o.bend((x - x0) / w, (y - y0) / h); x -= sa * b; y += ca * b; }
      if (px !== null) {
        const L = light(((px + x) / 2 - x0) / w, ((py + y) / 2 - y0) / h);
        if (L === null) { px = x; py = y; continue; }
        const q = clamp(Math.round(clamp(L, 0, 1) * (lv - 1)), 0, lv - 1);
        paths[q].moveTo(px, py); paths[q].lineTo(x, y);
      }
      px = x; py = y;
    }
  }
  g.save(); g.clip(path); g.lineCap = 'round';
  const mn = o.min ?? 0.13, mx = o.max ?? step * 0.8;
  paths.forEach((p, q) => { const k = q / (lv - 1); g.lineWidth = lerp(mn, mx, k); g.strokeStyle = css(mixC(BRASS_D, BRASS_HI, 0.1 + k * 0.9)); g.stroke(p); });
  g.restore();
}
// Lines that follow a tube along its spine: the engraver's way of drawing a horn or a plume.
export function cutAlong(g, spine, rad, o = {}) {
  const n = spine.length, lv = 6, paths = Array.from({ length: lv }, () => new Path2D()), L2 = [-0.6, -0.8];
  const nrm = spine.map((p, i) => { const a = spine[Math.max(0, i - 1)], b = spine[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; });
  const lines = o.lines || 9;
  for (let j = 0; j < lines; j++) {
    const f = -0.92 + 1.84 * j / (lines - 1);
    let prev = null;
    for (let i = 0; i < n; i++) {
      const r = rad(i / (n - 1)), p = [spine[i][0] + nrm[i][0] * r * f, spine[i][1] + nrm[i][1] * r * f];
      if (prev) {
        const lt = 0.3 + 0.75 * (f * (nrm[i][0] * L2[0] + nrm[i][1] * L2[1])) + 0.25 * Math.sqrt(1 - f * f);
        const q = clamp(Math.round(clamp(lt, 0, 1) * (lv - 1)), 0, lv - 1);
        paths[q].moveTo(prev[0], prev[1]); paths[q].lineTo(p[0], p[1]);
      }
      prev = p;
    }
  }
  g.save(); g.lineCap = 'round';
  const mn = o.min ?? 0.15, mx = o.max ?? 1;
  paths.forEach((p, q) => { const k = q / (lv - 1); g.lineWidth = lerp(mn, mx, k); g.strokeStyle = css(mixC(BRASS_D, BRASS_HI, 0.1 + k * 0.9)); g.stroke(p); });
  g.restore();
}
export function tubePath(spine, rad) {
  const n = spine.length, L = [], Rt = [];
  spine.forEach((p, i) => {
    const a = spine[Math.max(0, i - 1)], b = spine[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, r = rad(i / (n - 1));
    L.push([p[0] - dy / l * r, p[1] + dx / l * r]); Rt.push([p[0] + dy / l * r, p[1] - dx / l * r]);
  });
  return polyPath([...L, ...Rt.reverse()]);
}
export function bez(p0, p1, p2, p3, n = 40) { return Array.from({ length: n }, (_, i) => { const t = i / (n - 1), u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; }); }
export const block = (g, p) => { g.fillStyle = INK; g.fill(p); };
export const edge = (g, p, w = 0.5, col = BRASS) => { g.lineWidth = w; g.strokeStyle = col; g.stroke(p); };
export function burst(g, x, y, n, r0, r1, a) {
  g.strokeStyle = `rgba(201,169,97,${a})`; g.lineWidth = 0.35; g.beginPath();
  for (let i = 0; i < n; i++) { const t = i * TAU / n; g.moveTo(x + Math.cos(t) * r0, y + Math.sin(t) * r0); g.lineTo(x + Math.cos(t) * r1, y + Math.sin(t) * r1); }
  g.stroke();
}
// An engraved sky: level hairlines, left open round the sun.
export function skyLines(g, y0, y1, sx, sy) {
  g.strokeStyle = 'rgba(201,169,97,0.42)'; g.lineWidth = 0.28; g.beginPath();
  for (let y = y0; y < y1; y += 1.5) { const dy = y - sy; if (Math.abs(dy) < 11) { const hw = Math.sqrt(121 - dy * dy); g.moveTo(8, y); g.lineTo(sx - hw, y); g.moveTo(sx + hw, y); g.lineTo(92, y); } else { g.moveTo(8, y); g.lineTo(92, y); } }
  g.stroke();
  g.strokeStyle = 'rgba(242,220,162,0.75)'; g.lineWidth = 0.4;
  [3.2, 5, 7].forEach((r) => { g.beginPath(); circle(g, sx, sy, r); g.stroke(); });
  burst(g, sx, sy, 24, 8, 10.5, 0.6);
}
// Waves: rows of little crests.
export function waves(g, y0, y1, seed) {
  const r = rng(seed);
  for (let y = y0; y < y1; y += 2.4) {
    const k = (y - y0) / (y1 - y0);
    g.strokeStyle = css(mixC(BRASS_D, BRASS, k), 0.8); g.lineWidth = 0.3 + k * 0.4; g.beginPath();
    for (let x = 8 + r() * 4; x < 92; x += 4.5 + r() * 2) { g.moveTo(x, y); g.quadraticCurveTo(x + 1.6, y - 1 - k, x + 3.2, y); }
    g.stroke();
  }
}

export const ENGRAVE = {
  knight(g) {
    burst(g, 50, 58, 64, 20, 50, 0.12);
    // two lances crossed behind, each with its pennant
    [[1, [19, 104], [76, 22]], [-1, [81, 104], [24, 22]]].forEach(([sd, a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
      const shaft = polyPath([[a[0] + nx * 1.4, a[1] + ny * 1.4], [b[0] + nx * 0.7, b[1] + ny * 0.7], [b[0] - nx * 0.7, b[1] - ny * 0.7], [a[0] - nx * 1.4, a[1] - ny * 1.4]]);
      block(g, shaft); cut(g, shaft, [Math.min(a[0], b[0]), b[1], Math.max(a[0], b[0]), a[1]], { angle: Math.atan2(dy, dx) + Math.PI / 2, step: 0.8, light: () => (sd > 0 ? 0.75 : 0.35) });
      edge(g, shaft, 0.35, BRASS_D);
      const tip = lensPath(b[0] - ux * 1, b[1] - uy * 1, b[0] + ux * 7, b[1] + uy * 7, 1.6);
      g.fillStyle = BRASS_HI; g.fill(tip); edge(g, tip, 0.3, BRASS_D);
      // the pennant flies outward from just under the head, swallow-tailed, rippling
      const f0 = [b[0] - ux * 3, b[1] - uy * 3], f1 = [b[0] - ux * 10, b[1] - uy * 10], Lf = 12 * sd, mid = [(f0[0] + f1[0]) / 2, (f0[1] + f1[1]) / 2];
      const flag = new Path2D(); flag.moveTo(...f0);
      flag.bezierCurveTo(f0[0] + Lf * 0.35, f0[1] - 1.6, f0[0] + Lf * 0.65, f0[1] + 1.8, f0[0] + Lf, f0[1] + 1.2);
      flag.lineTo(mid[0] + Lf * 0.62, mid[1] + 1.4); flag.lineTo(f1[0] + Lf, f1[1] + 1.6);
      flag.bezierCurveTo(f1[0] + Lf * 0.65, f1[1] + 2.2, f1[0] + Lf * 0.35, f1[1] - 1.2, f1[0], f1[1]); flag.closePath();
      block(g, flag); cut(g, flag, [Math.min(f0[0], f0[0] + Lf), f0[1] - 3, Math.max(f0[0], f0[0] + Lf), f1[1] + 3], { angle: 0, step: 0.85, light: (u, v) => 0.95 - v * 0.7 });
      edge(g, flag, 0.4, BRASS_D);
    });
    // the plume, sweeping back from the crest
    const plumeSpine = bez([50, 37], [50, 22], [62, 13], [80, 15], 34);
    const prad = (t) => 3.8 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) + 0.4;
    const plume = tubePath(plumeSpine, prad);
    block(g, plume); cutAlong(g, plumeSpine, prad, { lines: 7, max: 0.9 }); edge(g, plume, 0.4, BRASS_D);
    // the great helm, a drum of plate with a domed top
    const helm = new Path2D(); helm.moveTo(33.5, 93); helm.lineTo(33.5, 56); helm.bezierCurveTo(33.5, 41, 41, 35, 50, 35); helm.bezierCurveTo(59, 35, 66.5, 41, 66.5, 56); helm.lineTo(66.5, 93); helm.quadraticCurveTo(50, 96.5, 33.5, 93); helm.closePath();
    block(g, helm); cut(g, helm, [33.5, 35, 66.5, 96], { angle: Math.PI / 2, step: 1.05, light: (u, v) => LIT.cyl(u) * (v < 0.22 ? 1.1 - (0.22 - v) * 1.5 : 1) });
    // the brow band and the sight, either side of a ridge down the face
    const brow = polyPath([[33.5, 57], [66.5, 57], [66.5, 60.2], [33.5, 60.2]]);
    g.fillStyle = INK; g.fill(polyPath([[35, 60.8], [48.4, 60.8], [48.4, 64.6], [35, 64.6]])); g.fill(polyPath([[51.6, 60.8], [65, 60.8], [65, 64.6], [51.6, 64.6]]));
    line(g, [[35, 64.9], [48.4, 64.9]], 'rgba(242,220,162,0.8)', 0.4); line(g, [[51.6, 64.9], [65, 64.9]], 'rgba(242,220,162,0.6)', 0.4);
    block(g, brow); cut(g, brow, [33.5, 57, 66.5, 60.2], { angle: Math.PI / 2, step: 0.8, light: (u) => LIT.cyl(u) * 1.15 });
    edge(g, brow, 0.35, BRASS_D);
    g.fillStyle = BRASS_HI; g.fill(polyPath([[48.8, 36.5], [50, 36.5], [50, 94.2], [48.8, 94.2]])); g.fillStyle = BRASS_D; g.fill(polyPath([[50, 36.5], [51.2, 36.5], [51.2, 94.2], [50, 94.2]]));
    // breaths on the right cheek, rivets along the rim
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const x = 55.5 + i * 3.2, y = 71 + j * 3.6; g.fillStyle = INK; g.fill(polyPath([[x - 0.9, y], [x, y - 0.9], [x + 0.9, y], [x, y + 0.9]])); }
    const rim = new Path2D(); rim.moveTo(33.5, 88); rim.quadraticCurveTo(50, 91.4, 66.5, 88); rim.lineTo(66.5, 93); rim.quadraticCurveTo(50, 96.5, 33.5, 93); rim.closePath();
    block(g, rim); cut(g, rim, [33.5, 88, 66.5, 96.5], { angle: Math.PI / 2, step: 0.8, light: (u) => LIT.cyl(u) * 1.2 }); edge(g, rim, 0.35, BRASS_D);
    fillCircles(g, [36.5, 41.5, 46.5, 53.5, 58.5, 63.5].map((x) => [x, 90.8 + Math.sin((x - 33.5) / 33 * Math.PI) * 1.6, 0.55]), BRASS_HI);
    edge(g, helm, 0.5, BRASS_D);
  },
  vp(g) {
    burst(g, 50, 58, 56, 14, 48, 0.12);
    // the laurel: two branches meeting under the crown, tied with a ribbon
    [[-1, 108, 250], [1, 72, -70]].forEach(([sd, a0, a1]) => {
      const R = 31, cx = 50, cy = 58, pts = [];
      for (let i = 0; i <= 40; i++) { const a = (a0 + (a1 - a0) * i / 40) * Math.PI / 180; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
      g.strokeStyle = BRASS_D; g.lineWidth = 1.1; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.stroke();
      for (let i = 0; i < 10; i++) {
        const a = (a0 + (a1 - a0) * (i + 0.5) / 10) * Math.PI / 180, bx = cx + R * Math.cos(a), by = cy + R * Math.sin(a);
        [-1, 1].forEach((side) => {
          const ta = a + sd * (Math.PI / 2) * -1 + side * 0.55, L = 7.4 - i * 0.25;
          const tx = bx + Math.cos(ta) * L, ty = by + Math.sin(ta) * L, leaf = lensPath(bx, by, tx, ty, 2.1);
          block(g, leaf);
          const up = Math.cos(ta) * -0.6 + Math.sin(ta) * -0.8, lt = clamp(0.35 + up * 0.5 + (sd < 0 ? 0.15 : -0.05), 0, 1);
          g.fillStyle = css(mixC(BRASS_D, BRASS_HI, lt)); g.fill(leaf);
          line(g, [[bx, by], [bx + (tx - bx) * 0.85, by + (ty - by) * 0.85]], 'rgba(40,30,14,0.7)', 0.3);
        });
      }
    });
    const bow = new Path2D(); bow.moveTo(50, 89); bow.bezierCurveTo(42, 83, 38, 92, 44, 93); bow.closePath(); bow.moveTo(50, 89); bow.bezierCurveTo(58, 83, 62, 92, 56, 93); bow.closePath();
    bow.moveTo(49, 89.5); bow.lineTo(41, 101); bow.lineTo(44, 100.4); bow.lineTo(45, 103.4); bow.lineTo(50.5, 90); bow.closePath();
    bow.moveTo(51, 89.5); bow.lineTo(59, 101); bow.lineTo(56, 100.4); bow.lineTo(55, 103.4); bow.lineTo(49.5, 90); bow.closePath();
    block(g, bow); cut(g, bow, [38, 83, 62, 104], { angle: 0.5, step: 0.85 }); edge(g, bow, 0.35, BRASS_D);
    fillCircles(g, [[50, 89.4, 1.6]], BRASS);
    // the crown
    const crown = polyPath([[35, 72], [33, 49], [40.5, 58], [45, 46], [47.6, 54], [50, 41], [52.4, 54], [55, 46], [59.5, 58], [67, 49], [65, 72]]);
    block(g, crown); cut(g, crown, [33, 41, 67, 72], { angle: Math.PI / 2, step: 1.05, light: (u) => LIT.cyl(u) * 1.08 });
    edge(g, crown, 0.5, BRASS_D);
    const band = new Path2D(); band.moveTo(34.4, 66.5); band.quadraticCurveTo(50, 69, 65.6, 66.5); band.lineTo(65.2, 73.5); band.quadraticCurveTo(50, 76.2, 34.8, 73.5); band.closePath();
    block(g, band); cut(g, band, [34.4, 66.5, 65.6, 76], { angle: Math.PI / 2, step: 0.8, light: (u) => LIT.cyl(u) * 1.25 }); edge(g, band, 0.4, BRASS_D);
    const gem = (x, y, s, col) => { const p = polyPath([[x, y - s], [x + s * 0.8, y], [x, y + s], [x - s * 0.8, y]]); g.fillStyle = col; g.fill(p); edge(g, p, 0.3, BRASS_D); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill(polyPath([[x - s * 0.25, y - s * 0.5], [x, y - s * 0.8], [x + s * 0.05, y - s * 0.3]])); };
    gem(50, 71.4, 2.4, IVORY); gem(41.5, 70.8, 1.5, '#e3d2a8'); gem(58.5, 70.8, 1.5, '#e3d2a8');
    [[33, 48.4, 1.6], [45, 45.3, 1.3], [50, 40, 1.9], [55, 45.3, 1.3], [67, 48.4, 1.6]].forEach(([x, y, r]) => { const b = g.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r); b.addColorStop(0, '#fff6dc'); b.addColorStop(0.6, BRASS); b.addColorStop(1, BRASS_D); g.fillStyle = b; g.beginPath(); circle(g, x, y, r); g.fill(); });
  },
  roads(g) {
    // Two roads for free: a brick road comes up from your feet to a roundel and forks there into two,
    // one to each side of the horizon, under a rising sun. At the fork a signpost points down both,
    // its arms cut I and II; a few bricks wait in the grass.
    const HZ = 57;
    // the sun coming up behind the fork, its rays over the sky only
    g.save(); g.beginPath(); g.rect(0, 0, 100, HZ); g.clip();
    burst(g, 50, HZ, 72, 13, 62, 0.16);
    [[11.5, 0.55], [14.5, 0.32]].forEach(([r, a]) => { g.strokeStyle = `rgba(201,169,97,${a})`; g.lineWidth = 0.4; g.beginPath(); g.arc(50, HZ, r, Math.PI, TAU); g.stroke(); });
    const sun = g.createRadialGradient(47, HZ - 4, 0.5, 50, HZ, 9);
    sun.addColorStop(0, '#fff3cf'); sun.addColorStop(0.55, BRASS_HI); sun.addColorStop(1, BRASS);
    g.fillStyle = sun; g.beginPath(); g.arc(50, HZ, 8.6, Math.PI, TAU); g.closePath(); g.fill();
    g.restore();
    line(g, [[8, HZ], [92, HZ]], BRASS, 0.5);
    // the ground: level hairlines, further apart as they come toward you
    g.strokeStyle = 'rgba(201,169,97,0.34)'; g.lineWidth = 0.3; g.beginPath();
    for (let k = 1; k <= 13; k++) { const y = HZ + 50 * Math.pow(k / 13, 1.55); g.moveTo(8, y); g.lineTo(92, y); }
    g.stroke();
    // A road of herringbone brick between kerbs, as on the board: a brass surface lit from the left,
    // its mortar cut in rows of chevrons that close up as the road narrows into the distance.
    const brickRoad = (spine, rad, litLeft) => {
      const n = spine.length, nrm = [], Lp = [], Rp = [];
      spine.forEach((p, i) => {
        const a = spine[Math.max(0, i - 1)], b = spine[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, r = rad(i / (n - 1));
        nrm.push([dy / l, -dx / l, dx / l, dy / l]);
        Lp.push([p[0] + dy / l * r, p[1] - dx / l * r]); Rp.push([p[0] - dy / l * r, p[1] + dx / l * r]);
      });
      const body = polyPath([...Lp, ...Rp.slice().reverse()]);
      const near = spine[0], far = spine[n - 1], sf = g.createLinearGradient(near[0], near[1], far[0], far[1]);
      sf.addColorStop(0, css(mixC(BRASS_D, BRASS, 0.75))); sf.addColorStop(0.7, css(mixC(INK, BRASS_D, 0.85))); sf.addColorStop(1, css(mixC(INK, BRASS_D, 0.5)));
      g.fillStyle = sf; g.fill(body);
      g.save(); g.clip(body);
      // light across it, from the lit kerb
      const [lx0, ly0] = nrm[0], mid = spine[Math.floor(n * 0.3)], r0 = rad(0.3);
      const sh = g.createLinearGradient(mid[0] + lx0 * r0 * (litLeft ? 1 : -1), mid[1] + ly0 * r0 * (litLeft ? 1 : -1), mid[0] - lx0 * r0 * (litLeft ? 1 : -1), mid[1] - ly0 * r0 * (litLeft ? 1 : -1));
      sh.addColorStop(0, 'rgba(255,240,200,0.22)'); sh.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = sh; g.fill(body);
      g.lineCap = 'round'; g.lineJoin = 'miter';
      let acc = 1e9, row = 0;
      for (let i = 1; i < n; i++) {
        acc += Math.hypot(spine[i][0] - spine[i - 1][0], spine[i][1] - spine[i - 1][1]);
        const r = rad(i / (n - 1)), step = Math.max(0.5, r * 0.36);
        if (acc < step) continue;
        acc = 0; row++;
        const [lx, ly, ux, uy] = nrm[i], p = spine[i], f = r * 1.05, tip = r * 0.5, lw = clamp(r * 0.05, 0.14, 0.7);
        const V = [[p[0] + lx * f - ux * tip, p[1] + ly * f - uy * tip], [p[0], p[1]], [p[0] - lx * f - ux * tip, p[1] - ly * f - uy * tip]];
        g.strokeStyle = 'rgba(255,238,190,0.35)'; g.lineWidth = lw * 0.7; g.beginPath(); V.forEach((q, j) => (j ? g.lineTo(q[0] - ux * lw, q[1] - uy * lw) : g.moveTo(q[0] - ux * lw, q[1] - uy * lw))); g.stroke();
        g.strokeStyle = 'rgba(14,12,9,0.9)'; g.lineWidth = lw; g.beginPath(); V.forEach((q, j) => (j ? g.lineTo(...q) : g.moveTo(...q))); g.stroke();
        // the ends of the bricks between this row and the last, staggered, so it reads as herringbone
        g.lineWidth = lw * 0.75; g.beginPath();
        [0.3, 0.72].forEach((s) => [1, -1].forEach((sd) => { const o = (row % 2 ? s : s + 0.2) * f * sd, x = p[0] + lx * o - ux * tip * Math.abs(o) / f, y = p[1] + ly * o - uy * tip * Math.abs(o) / f; g.moveTo(x, y); g.lineTo(x - ux * step * 0.9 + lx * sd * step * 0.5, y - uy * step * 0.9 + ly * sd * step * 0.5); }));
        g.stroke();
      }
      g.restore();
      // the kerbs, bricks on edge in the player's full colour: here, brass
      [[Lp, litLeft ? BRASS_HI : BRASS_D], [Rp, litLeft ? BRASS_D : BRASS_HI]].forEach(([pts, col]) => {
        for (let i = 1; i < n; i++) { const r = rad(i / (n - 1)); g.strokeStyle = col; g.lineWidth = clamp(r * 0.09, 0.25, 1.3); g.lineCap = 'round'; g.beginPath(); g.moveTo(...pts[i - 1]); g.lineTo(...pts[i]); g.stroke(); }
      });
    };
    const FY = 80;
    // the two roads out of the fork, into the distance either side
    brickRoad(bez([45.5, FY - 0.7], [39, FY - 4.6], [29.5, HZ + 6], [19, HZ + 0.7], 44), (t) => lerp(4.2, 0.5, Math.pow(t, 0.65)), true);
    brickRoad(bez([54.5, FY - 0.7], [61, FY - 4.6], [70.5, HZ + 6], [81, HZ + 0.7], 44), (t) => lerp(4.2, 0.5, Math.pow(t, 0.65)), false);
    // the road you stand on, coming up to the fork
    brickRoad(bez([50, 111], [50, 100], [50, 90], [50, FY + 1], 40), (t) => lerp(21, 5.6, t), true);
    // the roundel of bricks in rings where they meet
    const ro = ellipsePath(50, FY, 10, 3.9);
    block(g, ro); edge(g, ro, 1.1, BRASS_HI);
    g.strokeStyle = BRASS; g.lineWidth = 0.35; [0.72, 0.46, 0.22].forEach((s) => g.stroke(ellipsePath(50, FY, 10 * s, 3.9 * s)));
    g.strokeStyle = 'rgba(201,169,97,0.6)'; g.lineWidth = 0.25; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * TAU / 16; g.moveTo(50 + Math.cos(a) * 7.2, FY + Math.sin(a) * 2.8); g.lineTo(50 + Math.cos(a) * 10, FY + Math.sin(a) * 3.9); }
    g.stroke();
    // the signpost's shadow, down and to the right across the bricks
    softFill(g, polyPath([[49.2, FY + 0.4], [51.2, FY + 0.4], [66, FY + 8.6], [63.4, FY + 9.2]]), 'rgba(0,0,0,0.7)', 0.9);
    // the post, a round pole lit from the left, with a ball on top
    const post = polyPath([[48.2, 26], [51.8, 26], [51.8, FY + 0.4], [48.2, FY + 0.4]]);
    block(g, post); cut(g, post, [48.2, 26, 51.8, FY], { angle: Math.PI / 2, step: 0.62, light: (u) => LIT.cyl(u) * 1.15, min: 0.2, max: 0.55 }); edge(g, post, 0.35, BRASS_D);
    const ball = g.createRadialGradient(49, 22.4, 0.2, 50, 23.6, 3); ball.addColorStop(0, '#fff6dc'); ball.addColorStop(0.55, BRASS); ball.addColorStop(1, BRASS_D);
    g.fillStyle = ball; g.beginPath(); circle(g, 50, 23.6, 2.9); g.fill();
    g.fillStyle = BRASS_D; g.fillRect(47.7, 25.8, 4.6, 1.3);
    // its two arms, one down each road, cut I and II
    [[-1, 33, 'I'], [1, 44, 'II']].forEach(([sd, y, num]) => {
      const x0 = sd < 0 ? 48.2 : 51.8, L = 26, tip = x0 + sd * L, back = x0 - sd * 1.8, hh = 4.3;
      const arm = polyPath([[back, y - hh], [tip - sd * 3.6, y - hh + sd * 0.8], [tip, y + sd * 0.8 + 0.4], [tip - sd * 3.6, y + hh + sd * 0.8], [back, y + hh]]);
      softFill(g, arm, 'rgba(0,0,0,0.6)', 1.2);
      block(g, arm); cut(g, arm, [Math.min(back, tip), y - hh, Math.max(back, tip), y + hh + 1], { angle: 0, step: 0.78, light: (u, v) => 1.05 - v * 0.75, max: 0.62 }); edge(g, arm, 0.45, BRASS_D);
      line(g, [[back, y - hh + 0.35], [tip - sd * 3.6, y - hh + sd * 0.8 + 0.35]], BRASS_HI, 0.45);
      const cx = x0 + sd * L * 0.47;
      g.save(); g.font = `700 7px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(242,220,162,0.85)'; g.fillText(num, cx + 0.3, y + 0.85); g.fillStyle = INK; g.fillText(num, cx, y + 0.55); g.restore();
      g.fillStyle = BRASS_HI; g.beginPath(); circle(g, x0 + sd * 0.9, y, 0.55); g.fill();
    });
    // a few bricks waiting in the grass, front right: two below and one laid across them
    const brick = (x, y, w, h, d) => {
      const top = polyPath([[x, y], [x + w, y], [x + w + d, y - d * 0.7], [x + d, y - d * 0.7]]), front = rrectPath(x, y, w, h, 0.3), side = polyPath([[x + w, y], [x + w + d, y - d * 0.7], [x + w + d, y + h - d * 0.7], [x + w, y + h]]);
      softFill(g, polyPath([[x + 1, y + h], [x + w + d + 1.6, y + h - d * 0.2], [x + w + d + 2.4, y + h + 1.2], [x + 1.4, y + h + 1.2]]), 'rgba(0,0,0,0.55)', 0.8);
      block(g, front); cut(g, front, [x, y, x + w, y + h], { angle: Math.PI / 2, step: 0.7, light: (u) => 0.92 - u * 0.5, max: 0.5 }); edge(g, front, 0.35, BRASS_D);
      g.fillStyle = BRASS_HI; g.fill(top); edge(g, top, 0.3, BRASS_D);
      g.fillStyle = BRASS_D; g.fill(side); edge(g, side, 0.3, '#5c4a26');
    };
    brick(72, 99.6, 8.6, 4.2, 1.9); brick(81.4, 99.6, 8.6, 4.2, 1.9); brick(76.4, 94.6, 8.6, 4.2, 1.9);
  },
  harvest(g) {
    burst(g, 50, 58, 56, 16, 50, 0.1);
    // the horn of plenty, curling up at its tip
    const spine = bez([34, 70], [52, 98], [86, 92], [84, 52], 48).concat(bez([84, 52], [83, 42], [76, 38], [72, 44], 14).slice(1));
    const rad = (t) => t < 0.78 ? lerp(14, 3.2, Math.pow(t / 0.78, 0.9)) : lerp(3.2, 0.6, (t - 0.78) / 0.22);
    const horn = tubePath(spine, rad);
    block(g, horn); cutAlong(g, spine, rad, { lines: 13, max: 1.05 });
    // its rings
    [0.12, 0.27, 0.42, 0.56, 0.68].forEach((t) => {
      const i = Math.round(t * (spine.length - 1)), p = spine[i], q = spine[Math.min(spine.length - 1, i + 1)], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, r = rad(t);
      const nx = -dy / l, ny = dx / l;
      g.strokeStyle = BRASS_HI; g.lineWidth = 0.9; g.beginPath(); g.moveTo(p[0] - nx * r, p[1] - ny * r); g.quadraticCurveTo(p[0] + dx / l * 2.2, p[1] + dy / l * 2.2, p[0] + nx * r, p[1] + ny * r); g.stroke();
      g.strokeStyle = 'rgba(30,22,10,0.8)'; g.lineWidth = 0.45; g.beginPath(); g.moveTo(p[0] - nx * r + dx / l * 0.9, p[1] - ny * r + dy / l * 0.9); g.quadraticCurveTo(p[0] + dx / l * 3.1, p[1] + dy / l * 3.1, p[0] + nx * r + dx / l * 0.9, p[1] + ny * r + dy / l * 0.9); g.stroke();
    });
    edge(g, horn, 0.5, BRASS_D);
    // its mouth, and what spills out of it: an ear of wheat, a log, a brick, a ball of wool, a lump of ore
    const m = spine[0], m2 = spine[2], ma = Math.atan2(m2[1] - m[1], m2[0] - m[0]) + Math.PI / 2;
    g.save(); g.translate(m[0], m[1]); g.rotate(ma);
    g.fillStyle = INK; g.fill(ellipsePath(0, 0, 14, 5.4)); g.strokeStyle = BRASS_HI; g.lineWidth = 1; g.stroke(ellipsePath(0, 0, 14, 5.4));
    g.restore();
    [[30, 64, 14, 40], [33, 63, 26, 38], [36, 64, 38, 42]].forEach(([bx, by, tx, ty], k) => {
      line(g, [[bx, by], [tx, ty]], BRASS_D, 0.7);
      const dx = tx - bx, dy = ty - by, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
      for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) {
        const t = 1 - (i + (sd > 0 ? 0.5 : 0)) * 0.07, x = bx + dx * t + -uy * sd * 1.2, y = by + dy * t + ux * sd * 1.2;
        const kp = lensPath(x - ux * 1.4, y - uy * 1.4, x + ux * 1.8, y + uy * 1.8, 0.95);
        g.fillStyle = sd < 0 || k === 0 ? BRASS_HI : BRASS; g.fill(kp);
        line(g, [[x + ux * 1.6, y + uy * 1.6], [x + ux * 1.6 + (ux * 0.7 - uy * sd * 0.7) * 4.5, y + uy * 1.6 + (uy * 0.7 + ux * sd * 0.7) * 4.5]], 'rgba(201,169,97,0.7)', 0.22);
      }
    });
    // ground
    g.strokeStyle = 'rgba(201,169,97,0.4)'; g.lineWidth = 0.3; g.beginPath(); for (let y = 99; y < 106; y += 1.4) { g.moveTo(10, y); g.lineTo(90, y); } g.stroke();
    // the wool
    const wool = new Path2D(); circle(wool, 22, 92, 7);
    block(g, wool); cut(g, wool, [15, 85, 29, 99], { angle: -0.7, step: 0.9, light: LIT.ball, bend: (u) => Math.sin(u * Math.PI) * 2.2 }); edge(g, wool, 0.45, BRASS_D);
    g.strokeStyle = BRASS_HI; g.lineWidth = 0.45; [[-0.6, 1.3], [0.9, 2.4]].forEach(([a0, a1]) => { g.beginPath(); g.arc(22, 92, 5.4, a0 + 3, a1 + 3); g.stroke(); });
    // the log, its end toward us
    const logB = polyPath([[34, 93.5], [44, 89.5], [44, 101.5], [34, 105.5]]);
    block(g, logB); cut(g, logB, [34, 89.5, 44, 105.5], { angle: -0.38, step: 0.85, light: (u, v) => 0.95 - v * 0.9 }); edge(g, logB, 0.35, BRASS_D);
    const logE = new Path2D(); circle(logE, 34, 99.5, 6);
    block(g, logE); g.fillStyle = BRASS; g.fill(logE);
    g.strokeStyle = 'rgba(40,30,14,0.7)'; g.lineWidth = 0.35; [1.5, 3, 4.5].forEach((r) => { g.beginPath(); circle(g, 34.3, 99.7, r); g.stroke(); });
    edge(g, logE, 0.6, BRASS_HI);
    // the brick
    const bTop = polyPath([[47, 96], [61, 96], [61, 93.4], [47, 93.4]]), bFront = polyPath([[47, 96], [61, 96], [61, 102.4], [47, 102.4]]);
    block(g, bFront); g.fillStyle = BRASS_HI; g.fill(bTop); edge(g, bTop, 0.3, BRASS_D);
    cut(g, bFront, [47, 96, 61, 102.4], { angle: Math.PI / 2, step: 0.8, light: (u) => 0.75 - u * 0.5 }); edge(g, bFront, 0.4, BRASS_D);
    // the ore
    const ore = polyPath([[64, 103], [62.6, 97], [66, 92.6], [71.6, 92], [75, 96.4], [74, 102.6]]);
    block(g, ore);
    g.fillStyle = BRASS_HI; g.fill(polyPath([[62.6, 97], [66, 92.6], [71.6, 92], [68.4, 96.8]]));
    g.fillStyle = BRASS; g.fill(polyPath([[62.6, 97], [68.4, 96.8], [64, 103]]));
    cut(g, polyPath([[68.4, 96.8], [71.6, 92], [75, 96.4], [74, 102.6], [64, 103]]), [64, 92, 75, 103], { angle: 0.7, step: 0.85, light: LIT.flat });
    edge(g, ore, 0.45, BRASS_D);
  },
  tribute(g) {
    // Name a resource and every other player hands you all of it: their cards come in from the three
    // other sides of the table (left, across and right) and sweep down into your open chest.
    burst(g, 50, 80, 60, 12, 54, 0.12);
    // the lid, thrown back, its inside toward us, two straps over it
    const lid = polyPath([[30.5, 74], [69.5, 74], [73, 57.5], [27, 57.5]]);
    block(g, lid); cut(g, lid, [27, 57.5, 73, 74], { angle: 0, step: 0.95, light: (u, v) => 0.62 - u * 0.4 + v * 0.15 }); edge(g, lid, 0.45, BRASS_D);
    [[36.5, 35], [63.5, 65]].forEach(([b, t], i) => { const st = polyPath([[b - 1.6, 74], [b + 1.6, 74], [t + 1.8, 57.5], [t - 1.8, 57.5]]); g.fillStyle = i ? BRASS : BRASS_HI; g.fill(st); edge(g, st, 0.3, BRASS_D); });
    line(g, [[27, 57.5], [73, 57.5]], BRASS_HI, 0.7);
    // three streams of cards, each with a few fine lines trailing it
    const streams = [bez([4, 40], [22, 27], [37, 44], [43, 69], 40), bez([50, 9], [42, 24], [57, 41], [50, 68], 40), bez([96, 40], [78, 27], [63, 44], [57, 69], 40)];
    streams.forEach((sp) => {
      g.strokeStyle = 'rgba(201,169,97,0.55)'; g.lineWidth = 0.32;
      [-1.6, 0, 1.6].forEach((o) => {
        g.beginPath();
        for (let i = 0; i < 22; i++) { const p = sp[i], q = sp[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, X = p[0] - dy / l * o, Y = p[1] + dx / l * o; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
        g.stroke();
      });
      [0.5, 0.7, 0.9].forEach((t, k) => {
        const i = Math.round(t * (sp.length - 1)), [x, y] = sp[i], q = sp[Math.min(i + 1, sp.length - 1)], a = Math.atan2(q[1] - y, q[0] - x) - Math.PI / 2 + (k - 1) * 0.3;
        const w = 8.4 - k * 0.5, h = w * 1.4, card = rrectPath(-w / 2, -h / 2, w, h, 1.3);
        g.save(); g.translate(x, y); g.rotate(a);
        g.save(); g.translate(0.7, 1); softFill(g, card, 'rgba(0,0,0,0.65)', 0.9); g.restore();
        block(g, card); cut(g, card, [-w / 2, -h / 2, w / 2, h / 2], { angle: 0.7, step: 0.7, light: (u, v) => 1 - (u + v) * 0.45, max: 0.5 });
        edge(g, card, 0.45, BRASS_HI); edge(g, rrectPath(-w / 2 + 1.2, -h / 2 + 1.2, w - 2.4, h - 2.4, 0.6), 0.25, BRASS_D);
        g.fillStyle = BRASS_HI; g.fill(polyPath([[0, -1.6], [1.1, 0], [0, 1.6], [-1.1, 0]]));
        g.restore();
      });
    });
    // the chest: the dark inside with cards already in it, a front of planks banded in brass, a lock
    const inside = polyPath([[30.5, 74], [69.5, 74], [72, 79], [28, 79]]);
    g.fillStyle = INK; g.fill(inside);
    [[38, 76.6, 0.5], [47, 76.2, -0.3], [56, 76.8, 0.2], [63, 76.4, -0.6]].forEach(([x, y, a]) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = BRASS_D; g.fill(rrectPath(-3, -1.1, 6, 2.2, 0.6)); g.restore(); });
    const front = polyPath([[28, 79], [72, 79], [72, 102.5], [28, 102.5]]);
    block(g, front); cut(g, front, [28, 79, 72, 102.5], { angle: 0, step: 1, light: (u, v) => 0.92 - u * 0.62 - v * 0.12 }); edge(g, front, 0.5, BRASS_D);
    g.strokeStyle = 'rgba(30,22,10,0.9)'; g.lineWidth = 0.45; g.beginPath(); [86.5, 94].forEach((y) => { g.moveTo(28, y); g.lineTo(72, y); }); g.stroke();
    [[27.2, 78.2, 45.6, 3.4, BRASS], [27.2, 99.8, 45.6, 3, BRASS_D]].forEach(([x, y, w, h, c]) => { const b = rrectPath(x, y, w, h, 0.6); g.fillStyle = c; g.fill(b); edge(g, b, 0.3, BRASS_D); });
    line(g, [[27.6, 78.5], [72.4, 78.5]], BRASS_HI, 0.5);
    [[35.5, BRASS_HI], [61, BRASS]].forEach(([x, c]) => { const st = polyPath([[x, 81.6], [x + 3.5, 81.6], [x + 3.5, 99.8], [x, 99.8]]); g.fillStyle = c; g.fill(st); edge(g, st, 0.3, BRASS_D); fillCircles(g, [[x + 1.75, 85, 0.55], [x + 1.75, 96, 0.55]], '#fff2c8'); });
    const plate = rrectPath(45.4, 83, 9.2, 10.4, 1.2); g.fillStyle = BRASS; g.fill(plate); edge(g, plate, 0.35, BRASS_D);
    g.fillStyle = BRASS_HI; g.fill(rrectPath(45.9, 83.5, 3.2, 9.4, 0.8));
    g.fillStyle = INK; g.beginPath(); circle(g, 50, 87, 1.25); g.fill(); g.fill(polyPath([[49.4, 87.4], [50.6, 87.4], [51, 90.6], [49, 90.6]]));
    // the floor it stands on
    g.strokeStyle = 'rgba(201,169,97,0.4)'; g.lineWidth = 0.3; g.beginPath(); for (let y = 103.6; y < 106; y += 1.3) { g.moveTo(12, y); g.lineTo(88, y); } g.stroke();
  },
};
export function devCard(g, kind, o) {
  stock(g, '#1b1a18', kind.length * 17 + 3);
  hairline(g, 'rgba(201,169,97,0.85)', 0.7);
  const win = rrectPath(...WIN, 4);
  const bg = g.createRadialGradient(46, 50, 4, 50, 58, 64); bg.addColorStop(0, '#2a2823'); bg.addColorStop(1, '#100f0d');
  g.fillStyle = bg; g.fill(win);
  g.save(); g.clip(win); ENGRAVE[kind](g); g.restore();
  windowWell(g);
  g.lineWidth = 0.4; g.strokeStyle = 'rgba(201,169,97,0.45)'; g.stroke(win);
  if (!o.small) title(g, DEV[kind], 120.5, { caps: false, size: 12, fit: 64, col: '#e6cf95' });
  stockEdge(g);
  if (o.tag) cornerTag(g, o.tag);
}
// The compass rose of the backs, centred at (cx, cy), 31.5 across its ring.
export function compassRose(g, cx, cy) {
  g.fillStyle = '#15171c'; g.beginPath(); circle(g, cx, cy, 31.5); g.fill();
  g.strokeStyle = BRASS; g.lineWidth = 0.9; g.beginPath(); circle(g, cx, cy, 30.5); g.stroke();
  g.lineWidth = 0.45; g.beginPath(); circle(g, cx, cy, 26.5); g.stroke();
  g.beginPath(); for (let i = 0; i < 64; i++) { const a = i * TAU / 64, r0 = i % 8 ? (i % 2 ? 28.8 : 27.8) : 26.5; g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * 30.5, cy + Math.sin(a) * 30.5); } g.stroke();
  const star = (r1, r2, rot, n, light, dark) => {
    for (let i = 0; i < n; i++) {
      const a = rot + i * TAU / n, tip = [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1], h = Math.PI / n;
      const l = [cx + Math.cos(a - h) * r2, cy + Math.sin(a - h) * r2], r = [cx + Math.cos(a + h) * r2, cy + Math.sin(a + h) * r2];
      g.fillStyle = light; g.fill(polyPath([[cx, cy], l, tip])); g.fillStyle = dark; g.fill(polyPath([[cx, cy], tip, r]));
    }
  };
  star(14, 2.4, Math.PI / 8, 8, '#8e7440', '#5c4b2a');
  star(19, 3.6, Math.PI / 4, 4, '#b8995a', '#7d6838');
  star(25.5, 4.6, -Math.PI / 2, 4, '#f2dca2', '#b8995a');
  fillCircles(g, [[cx, cy, 2.4]], '#15171c'); fillCircles(g, [[cx, cy, 1.3]], BRASS_HI);
  // north, marked with a lozenge past the ring
  const n = polyPath([[cx, cy - 37.5], [cx + 2.2, cy - 34.5], [cx, cy - 31.5], [cx - 2.2, cy - 34.5]]);
  g.fillStyle = BRASS_HI; g.fill(n);
}
// The back: a brass compass rose on a night-blue chart, rhumb lines running out from it to the edges.
export function backCard(g) {
  stock(g, '#15171c', 11);
  hairline(g, 'rgba(201,169,97,0.85)', 0.7);
  const panel = rrectPath(8, 8, 84, 124, 4), cx = 50, cy = 70;
  g.save(); g.clip(panel);
  g.strokeStyle = 'rgba(201,169,97,0.07)'; g.lineWidth = 0.45;
  for (let y = 8; y < 136; y += 7.5) for (let x = 8 + ((y / 7.5) % 2 ? 4.3 : 0); x < 96; x += 8.66) g.stroke(hexRound(new Path2D(), x, y, 4.3, 0.3));
  g.strokeStyle = 'rgba(201,169,97,0.16)'; g.lineWidth = 0.3; g.beginPath();
  for (let i = 0; i < 32; i++) { const a = i * TAU / 32; g.moveTo(cx + Math.cos(a) * 31, cy + Math.sin(a) * 31); g.lineTo(cx + Math.cos(a) * 120, cy + Math.sin(a) * 120); }
  g.stroke();
  g.restore();
  g.lineWidth = 0.45; g.strokeStyle = 'rgba(201,169,97,0.5)'; g.stroke(panel);
  compassRose(g, cx, cy);
  [[18, 22], [82, 22], [18, 118], [82, 118]].forEach(([x, y]) => { g.strokeStyle = BRASS; g.lineWidth = 0.55; g.stroke(hexRound(new Path2D(), x, y, 5, 0.8)); g.fillStyle = 'rgba(201,169,97,0.28)'; g.fill(hexRound(new Path2D(), x, y, 2.8, 0.5)); });
  stockEdge(g);
}
export function paintCard(g, kind, o = {}) {
  if (CARD[kind]) resourceCard(g, kind, o);
  else if (kind === 'back') backCard(g);
  else devCard(g, kind, o);
}
export const CARD_CACHE = new Map();
export function cardCanvas(kind, w, o = {}) {
  const key = [kind, Math.round(w * DPR), o.tag || '', o.small ? 1 : 0].join('|');
  let c = CARD_CACHE.get(key);
  if (c) return c;
  const s = w * DPR / 100;
  c = canvasOf(100 * s, 140 * s);
  const g = c.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.save(); g.clip(rrectPath(0, 0, 100, 140, 12)); paintCard(g, kind, o); g.restore();
  CARD_CACHE.set(key, c);
  return c;
}
// The count: a brass coin hanging off the bottom-right corner, its face sunk into a bevelled rim.
export function countCoin(ctx, x, y, r, text) {
  softFill(ctx, ellipsePath(x + r * 0.12, y + r * 0.24, r, r), 'rgba(0,0,0,0.6)', r * 0.32);
  const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  rim.addColorStop(0, '#f6e3ad'); rim.addColorStop(0.45, '#bf9f5e'); rim.addColorStop(1, '#5a4622');
  ctx.fillStyle = rim; ctx.beginPath(); circle(ctx, x, y, r); ctx.fill();
  const fr = r * 0.78, face = ctx.createRadialGradient(x - fr * 0.3, y - fr * 0.35, 0, x, y, fr);
  face.addColorStop(0, '#2a2824'); face.addColorStop(1, '#100f0d');
  ctx.fillStyle = face; ctx.beginPath(); circle(ctx, x, y, fr); ctx.fill();
  const well = ctx.createLinearGradient(x - fr, y - fr, x + fr, y + fr);
  well.addColorStop(0, 'rgba(0,0,0,0.7)'); well.addColorStop(0.5, 'rgba(0,0,0,0)'); well.addColorStop(1, 'rgba(255,240,200,0.35)');
  ctx.lineWidth = Math.max(0.6, r * 0.07); ctx.strokeStyle = well; ctx.beginPath(); circle(ctx, x, y, fr); ctx.stroke();
  ctx.font = `700 ${(r * 1.04).toFixed(2)}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(text, x + r * 0.03, y + r * 0.12);
  ctx.fillStyle = IVORY; ctx.fillText(text, x, y + r * 0.06);
}
// A card laid on a page canvas: its shadow, then the card, turned about its foot.
export function drawCardAt(ctx, kind, x, y, w, o = {}, rot = 0, origin = [0.5, 1.15]) {
  const c = cardCanvas(kind, w * (o.zoom || 1), o), h = w * 1.4;
  ctx.save();
  ctx.translate(x + w * origin[0], y + h * origin[1]); ctx.rotate(rot); ctx.translate(-w * origin[0], -h * origin[1]);
  softFill(ctx, rrectPath(w * 0.03, w * 0.06, w, h, w * 0.12), 'rgba(0,0,0,0.5)', w * 0.09);
  softFill(ctx, rrectPath(w * 0.008, w * 0.014, w, h, w * 0.12), 'rgba(0,0,0,0.45)', w * 0.012);
  ctx.globalAlpha = o.dim ? 0.32 : 1;
  ctx.drawImage(c, 0, 0, w, h);
  ctx.globalAlpha = 1;
  if (o.count !== undefined && o.count !== '') countCoin(ctx, w - w * 0.035, h - w * 0.035, w * 0.135, String(o.count));
  ctx.restore();
}
// ---------------------------------------------------------------------------------------------
// Dice seen from above: a rounded cube, its top face lit from the top left, drilled pips. Rolling,
// it tips over its leading edge: the old top narrows ahead as the next face rises behind it.
// ---------------------------------------------------------------------------------------------
export const DIE = {
  light: { edge: '#cbc1ab', side: '#ddd3be', top: '#f6f0e3', hi: '#ffffff', pip: '#1d1c1a', pipHi: 'rgba(255,255,255,0.35)', pipLo: 'rgba(0,0,0,0)' },
  dark: { edge: '#0c0b0a', side: '#1d1c1a', top: '#2e2c29', hi: '#45423d', pip: '#c9a961', pipHi: 'rgba(0,0,0,0)', pipLo: 'rgba(0,0,0,0.45)' },
};
export const PIP_AT = { tl: [-0.25, -0.25], tr: [0.25, -0.25], ml: [-0.25, 0], mm: [0, 0], mr: [0.25, 0], bl: [-0.25, 0.25], br: [0.25, 0.25] };
export const FACES = { 1: ['mm'], 2: ['tl', 'br'], 3: ['tl', 'mm', 'br'], 4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'mm', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] };
// One face, centred at 0, s across, squeezed to `k` of its width along x (a face tipping away).
export function dieFace(g, s, face, tone, k, light) {
  const D = DIE[tone];
  g.save(); g.scale(Math.max(0.001, k), 1);
  const f = 0.86 * s, top = g.createLinearGradient(-f / 2, -f / 2, f / 2, f / 2);
  top.addColorStop(0, css(litC(rgbOf(D.hi), light))); top.addColorStop(0.55, css(litC(rgbOf(D.top), light))); top.addColorStop(1, css(litC(rgbOf(D.top), light * 0.93)));
  g.fillStyle = top; g.beginPath(); rrect(g, -f / 2, -f / 2, f, f, s * 0.17); g.fill();
  const pr = s * 0.085;
  FACES[face].forEach((key) => {
    const [px, py] = PIP_AT[key], x = px * s, y = py * s;
    g.fillStyle = css(litC(rgbOf(D.pip), light)); g.beginPath(); circle(g, x, y, pr); g.fill();
    g.fillStyle = D.pipHi; g.beginPath(); g.arc(x, y, pr, -0.2, Math.PI * 0.7); g.arc(x - pr * 0.25, y - pr * 0.25, pr * 0.85, Math.PI * 0.7, -0.2, true); g.fill();
    g.fillStyle = D.pipLo; g.beginPath(); g.arc(x, y, pr, Math.PI * 0.8, Math.PI * 1.7); g.arc(x + pr * 0.25, y + pr * 0.25, pr * 0.85, Math.PI * 1.7, Math.PI * 0.8, true); g.fill();
  });
  g.restore();
}
// A die at rest or in the air (`lift` 0..1), turned `rot`.
export function drawDie(g, x, y, s, face, tone, rot = 0, lift = 0) {
  const D = DIE[tone];
  g.save(); g.translate(x, y);
  g.save(); g.translate(s * (0.07 + lift * 0.35), s * (0.1 + lift * 0.45)); g.rotate(rot);
  softFill(g, rrectPath(-s / 2, -s / 2, s, s, s * 0.22), `rgba(2,2,10,${(0.6 - lift * 0.25).toFixed(3)})`, s * (0.12 + lift * 0.3));
  g.restore();
  const sc = 1 + lift * 0.14;
  g.scale(sc, sc); g.rotate(rot);
  g.fillStyle = D.edge; g.beginPath(); rrect(g, -s / 2, -s / 2, s, s, s * 0.22); g.fill();
  g.fillStyle = D.side; g.beginPath(); rrect(g, -s / 2 + s * 0.02, -s / 2 + s * 0.015, s * 0.94, s * 0.94, s * 0.2); g.fill();
  g.translate(-s * 0.012, -s * 0.018);
  dieFace(g, s, face, tone, 1, 1);
  g.strokeStyle = tone === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.12)'; g.lineWidth = s * 0.018;
  g.beginPath(); g.moveTo(-s * 0.4, s * 0.16); g.lineTo(-s * 0.4, -s * 0.26); g.quadraticCurveTo(-s * 0.4, -s * 0.4, -s * 0.26, -s * 0.4); g.lineTo(s * 0.16, -s * 0.4); g.stroke();
  g.restore();
}
// A die rolling along `dir`, `alpha` (0..PI/2) into its current quarter turn, from face a to face b.
export function drawDieRoll(g, x, y, s, a, b, alpha, dir, tone, lift = 0) {
  const D = DIE[tone], ca = Math.cos(alpha), sa = Math.sin(alpha);
  const uc = s / 2 * (1 - ca + sa), uA = uc + s / 2 * sa, uB = uc - s / 2 * ca;
  const z = s / 2 * (sa + ca) - s / 2;
  g.save(); g.translate(x, y); g.rotate(dir);
  const span0 = uB - s * sa / 2, span1 = uA + s * ca / 2, len = span1 - span0;
  g.save(); g.rotate(-dir); g.translate(s * (0.07 + (lift + z / s) * 0.35), s * (0.1 + (lift + z / s) * 0.45)); g.rotate(dir);
  softFill(g, rrectPath(span0, -s / 2, len, s, s * 0.22), 'rgba(2,2,10,0.5)', s * (0.14 + z / s * 0.3));
  g.restore();
  g.fillStyle = D.edge; g.beginPath(); rrect(g, span0, -s / 2, len, s, s * 0.22); g.fill();
  if (sa > 0.02) { g.save(); g.translate(uB, 0); dieFace(g, s, b, tone, sa, 0.7 + 0.3 * sa); g.restore(); }
  if (ca > 0.02) { g.save(); g.translate(uA, 0); dieFace(g, s, a, tone, ca, 0.7 + 0.3 * ca); g.restore(); }
  g.restore();
}
// A chain of top faces ending on `result`, each one a neighbour of the last (never itself or its opposite).
export function faceChain(n, result, r) {
  const seq = [result];
  for (let i = 0; i < n; i++) {
    const last = seq[0], opts = [1, 2, 3, 4, 5, 6].filter((f) => f !== last && f !== 7 - last);
    seq.unshift(opts[(r() * opts.length) | 0]);
  }
  return seq;
}
// Where a die is `t` seconds into its run across the table.
export function dieAt(d, t) {
  const T = d.dur, tt = clamp(t, 0, T), tau = Math.max(0.36, T * 0.3);
  const dist = d.D * (1 - Math.exp(-tt / tau)) / (1 - Math.exp(-T / tau));
  const q = Math.min(d.n, Math.floor(dist / d.s + 1e-6)), frac = q >= d.n ? 0 : dist / d.s - q;
  const ux = Math.cos(d.dir), uy = Math.sin(d.dir);
  const hop = tt < 0.28 ? Math.sin(tt / 0.28 * Math.PI) * 0.28 * (1 - tt / 0.28) : 0;
  return { x: d.x + ux * q * d.s, y: d.y + uy * q * d.s, a: d.seq[q], b: d.seq[Math.min(q + 1, d.n)], alpha: frac * Math.PI / 2, done: t >= T, hop };
}

export const TRADE_ICON = {
  trade: 'M3 7.2H15V4.4L20.4 8.6L15 12.8V10H3ZM21 14H9V11.2L3.6 15.4L9 19.6V16.8H21Z',
  check: 'M3.6 12.6L6.2 10L10 13.8L17.8 6L20.4 8.6L10 19Z',
  cross: 'M6.2 4.4L12 10.2L17.8 4.4L19.6 6.2L13.8 12L19.6 17.8L17.8 19.6L12 13.8L6.2 19.6L4.4 17.8L10.2 12L4.4 6.2Z',
  wait: 'M4.2 12a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0ZM10.2 12a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0ZM16.2 12a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z',
  diamond: 'M12 2.5L21.5 12L12 21.5L2.5 12Z', circle: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0Z',
  triangle: 'M12 2.8L21.6 19.8H2.4Z', square: 'M6.5 3.5H17.5A3 3 0 0 1 20.5 6.5V17.5A3 3 0 0 1 17.5 20.5H6.5A3 3 0 0 1 3.5 17.5V6.5A3 3 0 0 1 6.5 3.5Z',
};
export const svgIcon = (kind) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${TRADE_ICON[kind]}"/></svg>`;

// A resource as a fanned stack, its count on the top card (dim at 0): a stack in the hand that opens to take a card and closes behind one that leaves. `n` is the count it
// shows. `open` (0 to 1) is how far its fan has opened for a card about to land: the cards already
// there tilt apart to their places in the wider fan (or, on a full stack, slide down a place, the
// bottom one slipping under), so the new card lands exactly where it stays. `close` (0 to 1) is how
// far it has closed behind `gone` cards that left. `age` is the time since a card last landed: the
// stack takes it with a little give, its fan breathing out and back and the cards dipping, then rests.
// `still` (reduced motion): the stack changes in place.
export function fanStack(g, k, res, n, cx, top, w, o = {}) {
  const R = !!o.still, open = R ? 0 : o.open || 0, close = R ? 1 : o.close ?? 1, gone = o.gone || 0, age = R ? 9 : o.age ?? 9;
  const shown = Math.max(1, Math.min(n, 4));
  let sA = shown, shift = 0, low = 1;
  if (open > 0) { sA = lerp(shown, Math.min(n + 1, 4), open); if (n >= 4) { shift = open; low = 1 - open; } }
  else if (close < 1 && gone > 0) { sA = lerp(Math.max(1, Math.min(n + gone, 4)), shown, close); if (n >= 4) { shift = 1 - close; low = close; } }
  const wob = age < 0.8 ? Math.exp(-age * 7) * Math.sin(age * 19) : 0, spread = 1 + 0.32 * wob;
  for (let j = 0; j < shown; j++) {
    const kk = (j - shift - (sA - 1) / 2) * spread;
    let a = j === 0 ? low : 1;
    if (n === 0) a *= 1 - open;
    if (a <= 0.003) continue;
    g.save(); g.globalAlpha *= a;
    drawCardAt(g, res, cx - w / 2 + kk * w * 0.045, top + 3 * wob * (0.6 + 0.4 * j / Math.max(1, shown - 1)), w, { count: j === shown - 1 ? n : undefined, dim: n === 0, zoom: k }, kk * 4 * Math.PI / 180);
    g.restore();
  }
}
// The pose of the top card of a stack holding `c` cards: its middle and its turn, so a card flying in
// (or out) meets the stack exactly where it sits.
export function fanTop(cx, top, w, c) {
  const s = Math.max(1, Math.min(c, 4)), kk = (s - 1) / 2, r = kk * 4 * Math.PI / 180;
  return [cx + kk * w * 0.045 + 0.91 * w * Math.sin(r), top + 1.61 * w - 0.91 * w * Math.cos(r), r];
}
export function stackAt(g, k, res, n, cx, top, w) {
  const shown = Math.max(1, Math.min(n, 4));
  for (let j = 0; j < shown; j++) { const kk = j - (shown - 1) / 2; drawCardAt(g, res, cx - w / 2 + kk * w * 0.045, top, w, { count: j === shown - 1 ? n : undefined, dim: n === 0, zoom: k }, kk * 4 * Math.PI / 180); }
}
// The real pieces, small, in a player's colour: a stretch of road, a camp, a town. Drawn about the
// piece's foot at (cx, by), S px per R.
const PIECE_ROADS = new Map();
export function pieceAt(g, kind, cx, by, S, col, mark) {
  g.save(); g.translate(cx, by); g.scale(S, S);
  if (kind === 'road') {
    if (!PIECE_ROADS.has(col)) PIECE_ROADS.set(col, roadTexture(0.62, ROAD_W, col, 240, 77));
    g.rotate(-0.22);
    g.fillStyle = css(litC(rgbOf(col), 0.5)); g.beginPath(); rrect(g, -0.31, -ROAD_W * K / 2, 0.62, ROAD_W * K + ROAD_TH, ROAD_W * K / 2); g.fill();
    g.save(); g.scale(1, K); g.drawImage(PIECE_ROADS.get(col), -0.31, -ROAD_W / 2, 0.62, ROAD_W); g.restore();
  } else {
    const it = { t: kind, x: 0, y: 0, lift: 0, yaw: 0.35, col, mark, key: kind + col + mark }, v = makeView(0);
    drawDirect(g, it, v, true); drawDirect(g, it, v, false);
  }
  g.restore();
}

// The player whose turn it is: a brass ring round their chip, lit at the top left like all the brass,
// with a little warm light spilling out of it.
export function turnRing(g, x, y, w, h, r) {
  g.save(); g.lineJoin = 'round';
  [[7, 0.06], [4.6, 0.11], [2.8, 0.2]].forEach(([lw, a]) => { g.strokeStyle = `rgba(201,169,97,${a})`; g.lineWidth = lw; g.stroke(rrectPath(x - 1.25, y - 1.25, w + 2.5, h + 2.5, r + 1.25)); });
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, '#f6e3ad'); gr.addColorStop(0.45, BRASS); gr.addColorStop(1, '#8e7440');
  g.strokeStyle = gr; g.lineWidth = 1.75; g.stroke(rrectPath(x - 1.25, y - 1.25, w + 2.5, h + 2.5, r + 1.25));
  g.restore();
}
// The brass medal of a card worth two points, small, for a chip: crossed lances for largest army, a
// road running off for longest road.
export function awardMedal(g, kind, cx, cy, r) {
  const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  gr.addColorStop(0, '#f6e3ad'); gr.addColorStop(0.5, BRASS); gr.addColorStop(1, '#6a5228');
  g.save(); g.fillStyle = gr; g.beginPath(); circle(g, cx, cy, r); g.fill();
  g.strokeStyle = '#2b2416'; g.lineWidth = r * 0.17; g.lineCap = 'round'; g.beginPath();
  if (kind === 'army') { g.moveTo(cx - r * 0.48, cy + r * 0.43); g.lineTo(cx - r * 0.13, cy - r * 0.48); g.moveTo(cx + r * 0.48, cy + r * 0.43); g.lineTo(cx + r * 0.13, cy - r * 0.48); }
  else { g.moveTo(cx - r * 0.5, cy + r * 0.45); g.quadraticCurveTo(cx + r * 0.1, cy + r * 0.1, cx - r * 0.05, cy - r * 0.15); g.quadraticCurveTo(cx - r * 0.15, cy - r * 0.45, cx + r * 0.45, cy - r * 0.5); }
  g.stroke(); g.restore();
}

// The signs of the four builds, on a 24 grid like the answers' tick and cross: a main shape (cut where
// it has openings) and a second shape behind it at lower strength.
export const BUILD_ICON = (() => {
  const f = (v) => +v.toFixed(2);
  const P = (...pts) => 'M' + pts.map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z';
  const RR = (x, y, w, h, r) => `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
  // a road narrowing to the horizon between two kerbs, its bricks in herringbone courses
  const kerbL = (y) => 10.75 - 5.5 * (y - 3) / 18, chev = (y, d, th) => { const w = 12 - kerbL(y) - 0.75; return P([12 - w, y], [12, y - d], [12 + w, y], [12 + w, y + th], [12, y - d + th], [12 - w, y + th]); };
  const star = (cx, cy, R, r) => P(...Array.from({ length: 8 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 4, q = i % 2 ? r : R; return [cx + Math.cos(a) * q, cy + Math.sin(a) * q]; }));
  // two arrows turning round each other, for a trade: a thick arc ending in a head, clockwise on screen
  const arcArrow = (r, w, a0, a1, head) => {
    const n = 14, out = [], inn = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([12 + Math.cos(a) * (r + w / 2), 12 + Math.sin(a) * (r + w / 2)]); inn.push([12 + Math.cos(a) * (r - w / 2), 12 + Math.sin(a) * (r - w / 2)]); }
    const tip = a1 + head / r;
    return P(...out, [12 + Math.cos(a1) * (r + w / 2 + 1.75), 12 + Math.sin(a1) * (r + w / 2 + 1.75)], [12 + Math.cos(tip) * r, 12 + Math.sin(tip) * r], [12 + Math.cos(a1) * (r - w / 2 - 1.75), 12 + Math.sin(a1) * (r - w / 2 - 1.75)], ...inn.reverse());
  };
  const D = {
    // a trade: two arrows turning round each other, a card between them
    trade: { main: arcArrow(8.1, 2.3, Math.PI + 0.42, TAU - 0.62, 3.1) + arcArrow(8.1, 2.3, 0.42, Math.PI - 0.62, 3.1), rule: 'nonzero', back: RR(9.15, 8.25, 5.7, 7.5, 1.1) },
    // a settlement: the settlers' camp it is on the board, a big tent with its door open and a pennant
    // on its pole, a smaller tent behind
    settlement: { main: P([2.6, 20.6], [10.6, 6.4], [18.6, 20.6]) + P([10.6, 12.2], [13.1, 20.6], [8.1, 20.6]) + RR(10.15, 1.8, 0.9, 4.4, 0.45) + P([11.05, 1.9], [15.4, 3.1], [11.05, 4.3]) + RR(1.6, 20.6, 20.8, 1.7, 0.85), rule: 'evenodd', back: P([12.6, 20.6], [17.4, 10.6], [22.2, 20.6]) },
    // a city: the hilltop town, a church tower with its spire between two gabled houses, on its hill
    city: { main: P([10.1, 18.2], [10.1, 7.4], [12, 2.4], [13.9, 7.4], [13.9, 18.2]) + P([4.6, 18.2], [4.6, 13.2], [7.25, 10.6], [9.9, 13.2], [9.9, 18.2]) + P([14.1, 18.2], [14.1, 12.4], [16.85, 9.7], [19.6, 12.4], [19.6, 18.2]) + RR(11.35, 9.2, 1.3, 2.4, 0.65) + 'M11.05 18.2V15.9a0.95 0.95 0 0 1 1.9 0V18.2Z' + RR(6.6, 14.4, 1.3, 1.6, 0.3) + RR(16.2, 13.8, 1.3, 1.6, 0.3), rule: 'evenodd', back: 'M1.6 22.2C3.4 16.6 7.4 15.2 12 15.2C16.6 15.2 20.6 16.6 22.4 22.2Z' },
    // a road: two kerbs running to the horizon and the herringbone between them
    road: { main: P([9.55, 3], [10.75, 3], [5.25, 21], [2.35, 21]) + P([13.25, 3], [14.45, 3], [21.65, 21], [18.75, 21]) + chev(8.4, 1.1, 0.95) + chev(13.2, 1.9, 1.25) + chev(18.4, 2.6, 1.55), rule: 'nonzero', back: P([10.75, 3], [13.25, 3], [18.75, 21], [5.25, 21]) },
    // a development card: a card with the compass of their backs cut in it, another behind
    dev: { main: RR(3.6, 5.4, 12.2, 16.6, 2.1) + star(9.7, 13.7, 4.9, 1.35), rule: 'evenodd', under: RR(3.6, 5.4, 12.2, 16.6, 2.1), back: RR(8.6, 2.2, 12.2, 16.6, 2.1) },
  };
  Object.values(D).forEach((d) => { d.mainD = d.main; d.backD = d.back; d.main = new Path2D(d.main); d.back = d.back && new Path2D(d.back); d.under = d.under && new Path2D(d.under); });
  return D;
})();
// A sign as SVG, for the live table's HTML bubbles.
export const signSvg = (kind) => { const I = BUILD_ICON[kind]; return `<svg viewBox="0 0 24 24" aria-hidden="true">${I.backD ? `<path d="${I.backD}" fill="currentColor" opacity="0.38"/>` : ''}<path d="${I.mainD}" fill="currentColor" fill-rule="${I.rule}"/></svg>`; };
// A build's sign, `s` across, centred; `bg` fills under a shape whose cuts would show what lies behind.
export function drawBuildIcon(g, kind, cx, cy, s, col, bg) {
  const I = BUILD_ICON[kind], k = s / 24;
  g.save(); g.translate(cx - 12 * k, cy - 12 * k); g.scale(k, k);
  if (I.back) { g.save(); g.globalAlpha *= 0.38; g.fillStyle = col; g.fill(I.back); g.restore(); }
  if (I.under && bg) { g.fillStyle = bg; g.fill(I.under); }
  g.fillStyle = col; g.fill(I.main, I.rule);
  g.restore();
}

// ---- the two cards worth two points ---------------------------------------------------------------
// Square, unlike every other card, and their own: held by one player at a time, they sit apart from
// the hand. Charcoal stock in a double brass frame with studs at the corners, a brass coin with the 2
// at the top right, the name on a brass ribbon, and between them an engraving in brass. Longest road:
// a brick road winding from your feet to the horizon past five milestones. Largest army: a shield
// with three stars, one for each knight it takes, over crossed lances with pennants.
export const AWARD = { longest: 'Longest road', army: 'Largest army' };
export const AWARD_CACHE = new Map();
export function awardCanvas(kind, w) {
  const key = kind + '|' + Math.round(w * DPR);
  let c = AWARD_CACHE.get(key);
  if (c) return c;
  const s = w * DPR / 100;
  c = canvasOf(100 * s, 100 * s);
  const g = c.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, 0); g.lineCap = 'round'; g.lineJoin = 'round';
  g.save(); g.clip(rrectPath(0, 0, 100, 100, 12)); if (kind === 'back') paintAwardBack(g); else paintAward(g, kind); g.restore();
  AWARD_CACHE.set(key, c);
  return c;
}
export function paintAward(g, kind) {
  const bg = g.createLinearGradient(0, 0, 100, 100); bg.addColorStop(0, '#2c2a25'); bg.addColorStop(1, '#100f0d');
  g.fillStyle = bg; g.fillRect(0, 0, 100, 100);
  const brass = g.createLinearGradient(0, 0, 100, 100); brass.addColorStop(0, '#f6e3ad'); brass.addColorStop(0.45, '#c9a961'); brass.addColorStop(1, '#6e5426');
  // the art, in its window
  g.save(); g.clip(rrectPath(9, 9, 82, 64, 5));
  const win = g.createRadialGradient(40, 30, 4, 50, 44, 60); win.addColorStop(0, '#2a2823'); win.addColorStop(1, '#0e0d0b');
  g.fillStyle = win; g.fillRect(9, 9, 82, 64);
  if (kind === 'longest') awardRoad(g, brass); else awardArmy(g, brass);
  g.restore();
  g.lineWidth = 0.5; g.strokeStyle = 'rgba(201,169,97,0.5)'; g.stroke(rrectPath(9, 9, 82, 64, 5));
  // the frame: a heavy brass line and a fine one inside it, studs at the corners
  g.lineWidth = 1.8; g.strokeStyle = brass; g.stroke(rrectPath(4, 4, 92, 92, 9));
  g.lineWidth = 0.5; g.stroke(rrectPath(6.6, 6.6, 86.8, 86.8, 7));
  [[6.6, 6.6], [93.4, 6.6], [6.6, 93.4], [93.4, 93.4]].forEach(([x, y]) => { g.fillStyle = brass; g.beginPath(); circle(g, x, y, 1.9); g.fill(); g.fillStyle = 'rgba(255,248,226,0.7)'; g.beginPath(); circle(g, x - 0.5, y - 0.5, 0.6); g.fill(); });
  // the name on a ribbon with swallowtail ends
  const rib = new Path2D(); rib.moveTo(10, 77); rib.lineTo(90, 77); rib.lineTo(86, 83.5); rib.lineTo(90, 90); rib.lineTo(10, 90); rib.lineTo(14, 83.5); rib.closePath();
  softFill(g, rib, 'rgba(0,0,0,0.6)', 1.2);
  g.fillStyle = brass; g.fill(rib);
  g.font = `700 8.6px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,246,220,0.45)'; g.fillText(AWARD[kind], 50, 84.1);
  g.fillStyle = '#1d1a14'; g.fillText(AWARD[kind], 50, 83.6);
  // the 2, on a brass coin over the top right corner of the window
  softFill(g, ellipsePath(81.5, 20.5, 9.5, 9.5), 'rgba(0,0,0,0.7)', 1.6);
  const coin = g.createLinearGradient(71, 10, 91, 30); coin.addColorStop(0, '#fbeab8'); coin.addColorStop(0.5, '#c9a961'); coin.addColorStop(1, '#5e4720');
  g.fillStyle = coin; g.beginPath(); circle(g, 81, 19.5, 9.5); g.fill();
  g.strokeStyle = 'rgba(40,28,10,0.5)'; g.lineWidth = 0.5; g.beginPath(); circle(g, 81, 19.5, 7.6); g.stroke();
  g.font = `800 12px ${SERIF}`; g.fillStyle = 'rgba(255,248,226,0.6)'; g.fillText('2', 81.3, 20.4); g.fillStyle = '#231b0e'; g.fillText('2', 81, 19.9);
  // the top and left rims catch the light
  g.strokeStyle = 'rgba(255,240,205,0.22)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(1, 90); g.lineTo(1, 10); g.quadraticCurveTo(1, 1, 10, 1); g.lineTo(90, 1); g.stroke();
}
// Their back: the deck's night chart and compass rose, set in the square cards' own brass frame.
export function paintAwardBack(g) {
  const bg = g.createLinearGradient(0, 0, 100, 100); bg.addColorStop(0, '#1b1e25'); bg.addColorStop(1, '#0b0c0f');
  g.fillStyle = bg; g.fillRect(0, 0, 100, 100);
  const brass = g.createLinearGradient(0, 0, 100, 100); brass.addColorStop(0, '#f6e3ad'); brass.addColorStop(0.45, '#c9a961'); brass.addColorStop(1, '#6e5426');
  const panel = rrectPath(9, 9, 82, 82, 5);
  g.save(); g.clip(panel);
  g.fillStyle = '#15171c'; g.fill(panel);
  g.strokeStyle = 'rgba(201,169,97,0.07)'; g.lineWidth = 0.45;
  for (let j = 0; j < 13; j++) for (let x = 9 + (j % 2 ? 4.33 : 0); x < 96; x += 8.66) g.stroke(hexRound(new Path2D(), x, 9 + j * 7.5, 4.3, 0.3));
  g.strokeStyle = 'rgba(201,169,97,0.16)'; g.lineWidth = 0.3; g.beginPath();
  for (let i = 0; i < 32; i++) { const a = i * TAU / 32; g.moveTo(50 + Math.cos(a) * 31, 50 + Math.sin(a) * 31); g.lineTo(50 + Math.cos(a) * 80, 50 + Math.sin(a) * 80); }
  g.stroke();
  g.restore();
  g.lineWidth = 0.5; g.strokeStyle = 'rgba(201,169,97,0.5)'; g.stroke(panel);
  compassRose(g, 50, 50);
  // the frame, as on the front: a heavy brass line and a fine one inside it, studs at the corners
  g.lineWidth = 1.8; g.strokeStyle = brass; g.stroke(rrectPath(4, 4, 92, 92, 9));
  g.lineWidth = 0.5; g.stroke(rrectPath(6.6, 6.6, 86.8, 86.8, 7));
  [[6.6, 6.6], [93.4, 6.6], [6.6, 93.4], [93.4, 93.4]].forEach(([x, y]) => { g.fillStyle = brass; g.beginPath(); circle(g, x, y, 1.9); g.fill(); g.fillStyle = 'rgba(255,248,226,0.7)'; g.beginPath(); circle(g, x - 0.5, y - 0.5, 0.6); g.fill(); });
  g.strokeStyle = 'rgba(255,240,205,0.22)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(1, 90); g.lineTo(1, 10); g.quadraticCurveTo(1, 1, 10, 1); g.lineTo(90, 1); g.stroke();
}
// a brick road from your feet to the horizon, winding, past five milestones
export function awardRoad(g, brass) {
  const H = 34;
  // the sun low on the left, hills along the horizon
  g.strokeStyle = 'rgba(201,169,97,0.55)'; g.lineWidth = 0.5;
  for (let i = 0; i < 9; i++) { const a = Math.PI + i * Math.PI / 8; g.beginPath(); g.moveTo(26 + Math.cos(a) * 7.5, H - 4 + Math.sin(a) * 7.5); g.lineTo(26 + Math.cos(a) * 11, H - 4 + Math.sin(a) * 11); g.stroke(); }
  g.fillStyle = brass; g.beginPath(); g.arc(26, H - 4, 5, Math.PI, 0); g.fill();
  g.lineWidth = 0.7; g.strokeStyle = brass;
  g.beginPath(); g.moveTo(9, H + 1); g.bezierCurveTo(24, H - 7, 36, H - 2, 50, H - 1); g.bezierCurveTo(62, H - 1, 74, H - 9, 91, H - 2); g.stroke();
  g.lineWidth = 0.35; [[0.6, 9], [1.2, 16], [2.2, 26]].forEach(([dy, n]) => { for (let i = 0; i < n; i++) { const x = 10 + i * 80 / n + (dy * 3) % 4; g.beginPath(); g.moveTo(x, H + 4 + dy * 4); g.lineTo(x + 3, H + 4 + dy * 4); g.stroke(); } });
  // the road: an S from the bottom of the window to the horizon, narrowing as it goes
  const P = (t) => { const u = 1 - t; return [u * u * u * 62 + 3 * u * u * t * 96 + 3 * u * t * t * 18 + t * t * t * 52, u * u * u * 76 + 3 * u * u * t * 58 + 3 * u * t * t * 46 + t * t * t * H]; };
  const W = (t) => 30 * Math.pow(1 - t, 1.25) + 1.6, N = 60, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, [x, y] = P(t), [x2, y2] = P(Math.min(1, t + 0.01)), [x0, y0] = P(Math.max(0, t - 0.01)), dx = x2 - x0, dy = y2 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = W(t) / 2;
    L.push([x + nx * w, y + ny * w * 0.55]); R.push([x - nx * w, y - ny * w * 0.55]);
  }
  const road = polyPath([...L, ...R.slice().reverse()]);
  g.fillStyle = '#231f19'; g.fill(road);
  g.save(); g.clip(road);
  // bricks laid across it, closer together toward the horizon, staggered along the middle
  g.strokeStyle = 'rgba(201,169,97,0.55)'; g.lineWidth = 0.4;
  for (let i = 0; i < 26; i++) {
    const t = 1 - Math.pow(1 - i / 26, 1.7), a = L[Math.round(t * N)], b = R[Math.round(t * N)];
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    if (i % 2 === 0 && i < 22) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], t2 = 1 - Math.pow(1 - (i + 1) / 26, 1.7), c = L[Math.round(t2 * N)], d = R[Math.round(t2 * N)], m2 = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]; g.beginPath(); g.moveTo(m[0], m[1]); g.lineTo(m2[0], m2[1]); g.stroke(); }
  }
  g.restore();
  // its kerbs, in brass
  g.lineWidth = 0.9; g.strokeStyle = brass;
  [L, R].forEach((side) => { const p = new Path2D(); side.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); g.stroke(p); });
  // five milestones along its right side, smaller as they go, the last one with a flag
  [0.12, 0.34, 0.53, 0.7, 0.84].forEach((t, i) => {
    const [x, y] = R[Math.round(t * N)], sc = 1 - t * 0.75, w = 3.4 * sc, h = 6 * sc, mx = x - 1.5 - w;
    g.fillStyle = brass; g.beginPath(); rrect(g, mx, y - h, w, h, w * 0.45); g.fill();
    g.fillStyle = 'rgba(30,22,10,0.6)'; g.fillRect(mx + w * 0.55, y - h + 0.6, w * 0.3, h - 1);
    if (i === 4) { g.strokeStyle = brass; g.lineWidth = 0.4; g.beginPath(); g.moveTo(mx + w / 2, y - h); g.lineTo(mx + w / 2, y - h - 5); g.stroke(); g.fillStyle = brass; g.beginPath(); g.moveTo(mx + w / 2, y - h - 5); g.lineTo(mx + w / 2 + 3.4, y - h - 4); g.lineTo(mx + w / 2, y - h - 3); g.fill(); }
  });
}
// a shield with three stars, one for each knight it takes, over crossed lances with pennants
export function awardArmy(g, brass) {
  // rays behind, faint
  g.strokeStyle = 'rgba(201,169,97,0.22)'; g.lineWidth = 0.4;
  for (let i = 0; i < 28; i++) { const a = i * TAU / 28; g.beginPath(); g.moveTo(50 + Math.cos(a) * 12, 42 + Math.sin(a) * 12); g.lineTo(50 + Math.cos(a) * 46, 42 + Math.sin(a) * 46); g.stroke(); }
  // the lances, crossed, tips at the top, each with a pennant
  [[1, 20, 74, 78, 14], [-1, 80, 74, 22, 14]].forEach(([sd, x0, y0, x1, y1]) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(x0 + 0.6, y0 + 0.8); g.lineTo(x1 + 0.6, y1 + 0.8); g.stroke();
    g.strokeStyle = brass; g.lineWidth = 1.7; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.fillStyle = brass; g.beginPath(); g.moveTo(x1 + ux * 6, y1 + uy * 6); g.lineTo(x1 + nx * 2.2, y1 + ny * 2.2); g.lineTo(x1 - nx * 2.2, y1 - ny * 2.2); g.closePath(); g.fill();
    const bx = x1 - ux * 4, by = y1 - uy * 4, side = sd > 0 ? 1 : -1, f = new Path2D();
    f.moveTo(bx, by); f.lineTo(bx - ux * 9, by - uy * 9); f.lineTo(bx - ux * 4.5 + nx * 12 * side, by - uy * 4.5 + ny * 12 * side); f.closePath();
    g.fillStyle = brass; g.fill(f); g.strokeStyle = 'rgba(40,28,10,0.5)'; g.lineWidth = 0.3; g.stroke(f);
    // the grip
    g.strokeStyle = 'rgba(30,22,10,0.7)'; g.lineWidth = 0.5; [0.62, 0.66, 0.7].forEach((t) => { const px = x0 + dx * (1 - t), py = y0 + dy * (1 - t); g.beginPath(); g.moveTo(px - nx * 1.4, py - ny * 1.4); g.lineTo(px + nx * 1.4, py + ny * 1.4); g.stroke(); });
  });
  // the shield
  const sh = new Path2D(); sh.moveTo(35, 25); sh.lineTo(65, 25); sh.lineTo(65, 45); sh.quadraticCurveTo(64, 61, 50, 70); sh.quadraticCurveTo(36, 61, 35, 45); sh.closePath();
  softFill(g, sh, 'rgba(0,0,0,0.7)', 2.2);
  const face = g.createLinearGradient(35, 25, 65, 70); face.addColorStop(0, '#2e2b25'); face.addColorStop(1, '#141310');
  g.fillStyle = face; g.fill(sh);
  g.lineWidth = 1.6; g.strokeStyle = brass; g.stroke(sh);
  g.save(); g.translate(50, 47.5); g.scale(0.84, 0.84); g.translate(-50, -47.5); g.lineWidth = 0.5; g.stroke(sh); g.restore();
  // three stars
  const star = (cx, cy, r) => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return polyPath(p); };
  [[44, 36, 4.6], [56, 36, 4.6], [50, 50, 5.4]].forEach(([x, y, r]) => { softFill(g, star(x + 0.4, y + 0.6, r), 'rgba(0,0,0,0.6)', 0.6); g.fillStyle = brass; g.fill(star(x, y, r)); });
}
// An award on a page canvas or the table: its shadow, then the square.
export function drawAwardAt(ctx, kind, x, y, w, o = {}) {
  const c = awardCanvas(kind, w * (o.zoom || 1));
  ctx.save();
  softFill(ctx, rrectPath(x + w * 0.03, y + w * 0.06, w, w, w * 0.12), 'rgba(0,0,0,0.5)', w * 0.09);
  ctx.drawImage(c, x, y, w, w);
  ctx.restore();
}

// The names printed on the cards, in the language being read: { wood: 'Fusta', ..., knight:
// 'Cavaller', ..., longest: 'Camí més llarg', army: 'Exèrcit més gran' }. Pictures already painted
// with other names are let go.
export function setCardNames(names) {
  let changed = false;
  for (const [k, v] of Object.entries(names)) {
    if (CARD[k] && CARD[k].name !== v) { CARD[k].name = v; changed = true; }
    else if (DEV[k] && DEV[k] !== v) { DEV[k] = v; changed = true; }
    else if (AWARD[k] && AWARD[k] !== v) { AWARD[k] = v; changed = true; }
  }
  if (changed) { CARD_CACHE.clear(); AWARD_CACHE.clear(); }
}
