// Tanks' GPU renderer: everything in the arena that moves, drawn with WebGL2 on the arena's own
// canvas, over the floor, a 2D canvas laid just under it that render.js builds once per layout.
// render.js keeps the effects and says what goes where; this draws it, in order, in a few calls.
//
// PERFORMANCE (battery), and why it is sharp: the 2D renderer paints a picture of a tank once per
// kind, pose and degree, which tanks turning and turrets sweeping keep asking for, and it ran at
// 2x on 3x iPhones, stretched by the screen. Here the arena runs at the screen's own pixel ratio,
// and a tank is painted once per look, unlit and facing right (art.js tankPlanes), then turned,
// lit and laid by the GPU on every frame at its exact angle and position: the light is worked out
// per pixel from masks of its parts, with the bands and shadows paintHard paints. Mines and bombs
// are drawn from their numbers (circles and gradients), and every effect is a shape the GPU draws
// from a few numbers. A frame is a couple of dozen draw calls and one buffer upload per program.
import { ART, BOMB, CLEATS, HARD_LIGHT, HEAT, LIGHT, MINE, SHOT_LIGHT, planePose, planeVariants, shotFire, shotPlanes, tankPlanes, tankPose } from './art.js';
import { MUZZLE, TYPES } from './rules.js';

// Opaque: the floor is drawn on it too, so it is the arena's only picture on the screen.
const ATTRS = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
const LX = Math.cos(LIGHT);
const LY = Math.sin(LIGHT);
const KIND = { disc: 0, ring: 1, line: 2, box: 3, glow: 4, sprite: 5, tri: 6, mine: 7, bomb: 8 };
const PRIM_FLOATS = 20;
const TANK_FLOATS = 20;
const SHOT_FLOATS = 12;
const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`); // a number as a GLSL float

/* ---------- Shaders ---------- */

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2DArray;
`;

const PRIM_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_pa; // centre (px), axis (cos, sin)
layout(location = 2) in vec4 a_hk; // half size (px), kind
layout(location = 3) in vec4 a_col; // premultiplied
layout(location = 4) in vec4 a_p0;
layout(location = 5) in vec4 a_p1;
uniform vec2 u_size;
out vec2 v_local;
flat out vec4 v_hk;
flat out vec4 v_col;
flat out vec4 v_p0;
flat out vec4 v_p1;
void main() {
  vec2 local = a_corner * a_hk.xy;
  vec2 p = a_pa.xy + vec2(a_pa.z * local.x - a_pa.w * local.y, a_pa.w * local.x + a_pa.z * local.y);
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_local = local;
  v_hk = a_hk;
  v_col = a_col;
  v_p0 = a_p0;
  v_p1 = a_p1;
}`;

const COMMON = `
float aa(float d) { return clamp(0.5 - d, 0.0, 1.0); }
// Coverage of an edge blurred by a Gaussian of sigma (px): a canvas shadowBlur is 2 sigma.
float soft(float d, float sigma) { return sigma > 0.0 ? 1.0 / (1.0 + exp(1.702 * d / sigma)) : aa(d); }
vec4 over(vec4 top, vec4 c) { return top + c * (1.0 - top.a); }
// A fill of col at coverage a laid on c, as a canvas lays it.
vec4 lay(vec4 c, vec3 col, float a) { return vec4(c.rgb * (1.0 - a) + col * a, c.a + a * (1.0 - c.a)); }
`;

const PRIM_FS = () => {
  const M = MINE;
  const B = BOMB;
  const ramp = (stops, t) => {
    // GLSL for a piecewise-linear ramp through [at, value] stops, at t.
    let out = f(stops[stops.length - 1][1]);
    for (let i = stops.length - 2; i >= 0; i--) {
      const [a0, v0] = stops[i];
      const [a1, v1] = stops[i + 1];
      out = `(${t} < ${f(a1)} ? mix(${f(v0)}, ${f(v1)}, (${t} - ${f(a0)}) / ${f(a1 - a0)}) : ${out})`;
    }
    return out;
  };
  return `${HEAD}
in vec2 v_local;
flat in vec4 v_hk;
flat in vec4 v_col;
flat in vec4 v_p0;
flat in vec4 v_p1;
uniform sampler2DArray u_atlas;
uniform float u_slot;
uniform vec2 u_light;
uniform vec3 u_ink;
uniform vec3 u_flash;
out vec4 o;
${COMMON}
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
// t of a two-point conical gradient from circle (c0, r0) to (c1, r1) at p, as a canvas finds it.
float conical(vec2 p, vec2 c0, float r0, vec2 c1, float r1) {
  vec2 cd = c1 - c0;
  vec2 pd = p - c0;
  float dr = r1 - r0;
  float a = dot(cd, cd) - dr * dr;
  float b = dot(pd, cd) + r0 * dr;
  float c = dot(pd, pd) - r0 * r0;
  if (abs(a) < 1e-4) return c / (2.0 * b);
  float disc = b * b - a * c;
  if (disc < 0.0) return 0.0;
  float t = (b + sqrt(disc)) / a;
  if (r0 + t * dr < 0.0) t = (b - sqrt(disc)) / a;
  return t;
}
// A mine (art.js drawMine), less its shadow and glow. v_p0: px a cell, its light (0 off, 1 on), the
// spark's place (px); v_col: its cap; v_p1: its light's colour.
vec4 mine() {
  float s = v_p0.x;
  vec2 p = v_local;
  vec2 L = u_light;
  float rc = ${f(M.casing)} * s;
  float rk = ${f(M.cap)} * s;
  float mc = aa(length(p) - rc);
  vec4 c = vec4(u_ink * mc, mc);
  c = lay(c, vec3(1.0), ${f(M.rim.a)} * mc * (1.0 - soft(length(p - L * ${f(M.rim.d)} * s) - rc, ${f(M.rim.blur / 2)} * s)));
  c = lay(c, vec3(0.0), ${f(M.capShadow.a)} * soft(length(p - L * ${f(M.capShadow.d)} * s) - rk, ${f(M.capShadow.blur / 2)} * s));
  float mk = aa(length(p) - rk);
  c = lay(c, v_col.rgb, mk);
  c = lay(c, vec3(1.0), ${f(M.capLight.lit)} * mk * (1.0 - soft(length(p - L * ${f(M.capLight.d)} * s) - rk, ${f(M.capLight.blur / 2)} * s)));
  c = lay(c, vec3(0.0), ${f(M.capLight.shade)} * mk * (1.0 - soft(length(p + L * ${f(M.capLight.d)} * s) - rk, ${f(M.capLight.blur / 2)} * s)));
  c = lay(c, v_p1.rgb, aa(length(p) - ${f(M.light)} * s));
  if (v_p0.y > 0.5) c = lay(c, u_flash, aa(length(p - v_p0.zw) - ${f(M.spark.r)} * s));
  return c;
}
// A bomb in the air (art.js drawBomb), less its shadow. v_p0: its radius, its highlight (px from
// its middle), px a cell.
vec4 bomb() {
  vec2 p = v_local;
  float r = v_p0.x;
  vec2 h = v_p0.yz;
  float s = v_p0.w;
  float d = length(p);
  float r0 = r + ${f(B.halo.from)} * s;
  float r1 = r + ${f(B.halo.to)} * s;
  float th = clamp((d - r0) / (r1 - r0), 0.0, 1.0);
  vec4 c = vec4(u_flash, 1.0) * ${ramp(B.halo.stops, 'th')} * aa(d - r1);
  float mb = aa(d - r);
  float tb = clamp(conical(p, h, ${f(B.ball.focal)} * r, vec2(0.0), r), 0.0, 1.0);
  vec3 ink = mix(u_ink, vec3(1.0), ${ramp(B.ball.stops, 'tb')});
  c = over(vec4(ink, 1.0) * mb, c);
  float tr = clamp(conical(p, h, ${f(B.rim.focal)} * r, vec2(0.0), r), 0.0, 1.0);
  c = over(vec4(u_flash, 1.0) * (${f(B.rim.a)} * tr * mb), c);
  float rs = ${f(B.spec.r)} * r;
  float ds = length(p - h);
  float ts = clamp(ds / rs, 0.0, 1.0);
  c = over(vec4(u_flash, 1.0) * (${ramp(B.spec.stops, 'ts')} * aa(ds - rs)), c);
  return c;
}
void main() {
  int kind = int(v_hk.z + 0.5);
  vec2 p = v_local;
  float cov;
  if (kind == ${KIND.disc}) {
    // p0: radius, blur (sigma)
    cov = soft(length(p) - v_p0.x, v_p0.y);
  } else if (kind == ${KIND.ring}) {
    // p0: radius, half its width, dash and gap (along it; no dash: solid); p1: where the dashes start, and which way they run
    cov = aa(abs(length(p) - v_p0.x) - v_p0.y);
    if (v_p0.z > 0.0) {
      float a = mod((atan(p.y, p.x) - v_p1.x) * v_p1.y, 6.2831853);
      float t = mod(a * v_p0.x, v_p0.z + v_p0.w);
      cov *= clamp(0.5 + min(t, v_p0.z - t), 0.0, 1.0);
    }
  } else if (kind == ${KIND.line}) {
    // p0: half its length (along x), half its width, round ends (1) or square (0)
    if (v_p0.z > 0.5) cov = aa(length(vec2(max(abs(p.x) - v_p0.x, 0.0), p.y)) - v_p0.y);
    else {
      vec2 q = abs(p) - v_p0.xy;
      cov = aa(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
    }
  } else if (kind == ${KIND.box}) {
    // p0: half its size, its corners' radius, half its outline's width (none: filled)
    vec2 q = abs(p) - v_p0.xy + v_p0.z;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - v_p0.z;
    if (v_p0.w > 0.0) d = abs(d) - v_p0.w;
    cov = aa(d);
  } else if (kind == ${KIND.glow}) {
    // Light added to what is under it, fading out to p0.x: alpha 0, so it only ever adds.
    o = vec4(v_col.rgb * clamp(1.0 - length(p) / v_p0.x, 0.0, 1.0), 0.0);
    return;
  } else if (kind == ${KIND.sprite}) {
    // p0: its layer, texels a px
    vec2 t = (u_slot * 0.5 + p * v_p0.y) / u_slot;
    o = texture(u_atlas, vec3(t, v_p0.x)) * v_col.a;
    return;
  } else if (kind == ${KIND.tri}) {
    cov = aa(sdTri(p, v_p0.xy, v_p0.zw, v_p1.xy));
  } else if (kind == ${KIND.mine}) {
    o = mine();
    return;
  } else {
    o = bomb();
    return;
  }
  o = v_col * cov;
}`;
};

// A tank: one instance per tank, its hull, gun and head laid together, lit and shaded per pixel.
const TANK_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_pa; // centre (px), hull's axis on screen
layout(location = 2) in vec4 a_tr; // turret's axis on screen, kick and gun slide (texels)
layout(location = 3) in vec4 a_ly; // hull, gun (-1: none) and head layers, alpha
layout(location = 4) in vec4 a_cl; // cleats' colour, how far the treads have rolled (hull units)
layout(location = 5) in vec4 a_ex; // heat, its white-hot share, flags (1: treads, 2: glowing barrels), its gun's tubes' width (cells)
uniform vec2 u_size;
uniform float u_slot;
uniform float u_margin;
out vec2 v_q;
flat out vec4 v_pa;
flat out vec4 v_tr;
flat out vec4 v_ly;
flat out vec4 v_cl;
flat out vec4 v_ex;
void main() {
  vec2 q = a_corner * (u_slot * 0.5 + u_margin);
  vec2 p = a_pa.xy + q;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_q = q;
  v_pa = a_pa;
  v_tr = a_tr;
  v_ly = a_ly;
  v_cl = a_cl;
  v_ex = a_ex;
}`;

const TANK_COMMON = `
in vec2 v_q;
flat in vec4 v_pa;
flat in vec4 v_tr;
flat in vec4 v_ly;
flat in vec4 v_cl;
flat in vec4 v_ex;
uniform sampler2DArray u_atlas;
uniform float u_slot;
uniform vec2 u_light;
out vec4 o;
${COMMON}
// v turned back by an axis's angle: from the screen into a part's own frame.
vec2 back(vec2 v, vec2 ax) { return vec2(ax.x * v.x + ax.y * v.y, ax.x * v.y - ax.y * v.x); }
vec4 at(float layer, vec2 t) { return texture(u_atlas, vec3(t / u_slot, layer)); }
`;

const TANK_FS = () => {
  const H = HARD_LIGHT;
  return `${HEAD}
${TANK_COMMON}
uniform float u_band;
uniform vec4 u_drop; // px: hull, weapon, ring, top
uniform float u_hull; // px a hull unit
uniform float u_cell; // px a cell
uniform vec3 u_fire;
uniform vec3 u_flash;
const float LIT = ${f(H.lit)};
const float SHADE = ${f(H.shade)};
const float DROP = ${f(H.drop)};
const vec4 CLEAT = vec4(${f(CLEATS.pitch)}, ${f(CLEATS.width / 2)}, ${f(CLEATS.from)}, ${f(CLEATS.to)});
const vec4 HEAT = vec4(${f(HEAT.from)}, ${f(HEAT.mid)}, ${f(HEAT.a1)}, ${f(HEAT.a2)});
const vec2 TUBE = vec2(${f(H.tube.reach)}, ${f(H.tube.limb)});
const vec3 TUBE_A = vec3(${f(H.tube.lit)}, ${f(H.tube.shade)}, ${f(H.tube.limbShade)});
void main() {
  float mid = u_slot * 0.5;
  vec2 pb = mid + back(v_q, v_pa.zw);
  vec2 pt = mid + back(v_q, v_tr.xy) + vec2(v_tr.z, 0.0);
  vec2 pg = pt + vec2(v_tr.w, 0.0);
  vec2 lb = back(u_light, v_pa.zw);
  vec2 lt = back(u_light, v_tr.xy);
  float B = v_ly.x;
  float G = v_ly.y;
  float H = v_ly.z;
  int flags = int(v_ex.z + 0.5);
  float steps[2] = float[2](0.5, 1.0);
  float tsteps[3] = float[3](${H.tube.steps.map(f).join(', ')});
  float lsteps[2] = float[2](${H.tube.limbSteps.map(f).join(', ')});
  vec4 hm = at(H + 2.0, pt); // ring, top
  vec4 gm = G >= 0.0 ? at(G + 2.0, pg) : vec4(0.0); // first run, second run, every solid

  // The hull: treads (their cleats rolled on) or a pad, then the hull, each lit and shaded at its
  // edges, the hull's shadow on the treads, then the turret's on both.
  vec4 m = at(B + 1.0, pb);
  float base = m.r;
  float hull = m.g;
  vec4 c = vec4(0.0);
  if (base + hull > 0.0) {
    c = at(B, pb);
    float under = 1.0 - hull;
    if ((flags & 1) != 0) {
      float x = (pb.x - mid) / u_hull;
      float ph = mod(v_cl.w, CLEAT.x);
      float n = floor((x - CLEAT.z - ph) / CLEAT.x + 0.5);
      float k = CLEAT.z + ph + n * CLEAT.x;
      float on = (n >= 0.0 && k < CLEAT.w) ? clamp(0.5 - (abs(x - k) - CLEAT.y) * u_hull, 0.0, 1.0) : 0.0;
      c = lay(c, v_cl.rgb, on * base * under);
    }
    for (int i = 0; i < 2; i++) {
      float d = u_band * steps[i];
      c = lay(c, vec3(1.0), LIT * base * (1.0 - at(B + 1.0, pb - lb * d).r) * under);
      c = lay(c, vec3(0.0), SHADE * base * (1.0 - at(B + 1.0, pb + lb * d).r) * under);
    }
    for (int i = 0; i < 2; i++) c = lay(c, vec3(0.0), DROP * at(B + 1.0, pb - lb * u_drop.x * steps[i]).g * base * under);
    for (int i = 0; i < 2; i++) {
      float d = u_band * steps[i];
      c = lay(c, vec3(1.0), LIT * hull * (1.0 - at(B + 1.0, pb - lb * d).g));
      c = lay(c, vec3(0.0), SHADE * hull * (1.0 - at(B + 1.0, pb + lb * d).g));
    }
    float body = max(base, hull);
    if (G >= 0.0) for (int i = 0; i < 2; i++) c = lay(c, vec3(0.0), DROP * at(G + 2.0, pg - lt * u_drop.y * steps[i]).b * body);
    for (int i = 0; i < 2; i++) c = lay(c, vec3(0.0), DROP * at(H + 2.0, pt - lt * u_drop.z * steps[i]).r * body);
    for (int i = 0; i < 2; i++) c = lay(c, vec3(0.0), DROP * at(H + 2.0, pt - lt * u_drop.w * steps[i]).g * body);
  }

  // The gun, slid back by its recoil: its two runs of solids lit in turn (the second covers the
  // first's light), a minigun's barrels glowing, its decals, then the ring's and the top's shadows.
  vec4 g = vec4(0.0);
  if (G >= 0.0) {
    g = at(G, pg);
    vec4 e = at(G + 1.0, pg);
    if (g.a + e.a > 0.0) {
      if ((flags & 2) != 0 && v_ex.x > 0.0) {
        float x = (pg.x - mid) / u_cell;
        float t = clamp((x - HEAT.x) / (${f(MUZZLE)} - HEAT.x), 0.0, 1.0);
        float hot = t < HEAT.y ? HEAT.z * t / HEAT.y : mix(HEAT.z, HEAT.w, (t - HEAT.y) / (1.0 - HEAT.y));
        vec3 tip = mix(u_fire, u_flash, v_ex.y);
        vec3 col = t < HEAT.y ? u_fire : mix(u_fire, tip, (t - HEAT.y) / (1.0 - HEAT.y));
        g = lay(g, col, e.r * v_ex.x * hot);
      }
      for (int i = 0; i < 2; i++) {
        float d = u_band * steps[i];
        g = lay(g, vec3(1.0), LIT * gm.r * (1.0 - at(G + 2.0, pg - lt * d).r) * (1.0 - gm.g));
        g = lay(g, vec3(0.0), SHADE * gm.r * (1.0 - at(G + 2.0, pg + lt * d).r) * (1.0 - gm.g));
      }
      // The first run is the gun's tubes, if it has any: lit round across them (art.js tubeBands).
      if (v_ex.w > 0.0 && gm.r > 0.0) {
        float reach = TUBE.x * v_ex.w * u_cell * lt.y;
        for (int i = 0; i < 3; i++) {
          vec2 d = vec2(0.0, reach * tsteps[i]);
          g = lay(g, vec3(1.0), TUBE_A.x * gm.r * (1.0 - at(G + 2.0, pg - d).r) * (1.0 - gm.g));
          g = lay(g, vec3(0.0), TUBE_A.y * gm.r * (1.0 - at(G + 2.0, pg + d).r) * (1.0 - gm.g));
        }
        float limb = TUBE.y * v_ex.w * u_cell * (1.0 - abs(lt.y));
        if (limb >= 0.25) {
          for (int i = 0; i < 2; i++) {
            vec2 d = vec2(0.0, limb * lsteps[i]);
            g = lay(g, vec3(0.0), TUBE_A.z * gm.r * (1.0 - at(G + 2.0, pg - d).r) * (1.0 - gm.g));
            g = lay(g, vec3(0.0), TUBE_A.z * gm.r * (1.0 - at(G + 2.0, pg + d).r) * (1.0 - gm.g));
          }
        }
      }
      for (int i = 0; i < 2; i++) {
        float d = u_band * steps[i];
        g = lay(g, vec3(1.0), LIT * gm.g * (1.0 - at(G + 2.0, pg - lt * d).g));
        g = lay(g, vec3(0.0), SHADE * gm.g * (1.0 - at(G + 2.0, pg + lt * d).g));
      }
      if ((flags & 2) == 0) g = over(e, g);
      for (int i = 0; i < 2; i++) g = lay(g, vec3(0.0), DROP * at(H + 2.0, pt - lt * u_drop.z * steps[i]).r * gm.b);
      for (int i = 0; i < 2; i++) g = lay(g, vec3(0.0), DROP * at(H + 2.0, pt - lt * u_drop.w * steps[i]).g * gm.b);
    }
  }

  // The head: the turret ring lit, the top's shadow on it, the top lit, and the top's decals.
  vec4 h = at(H, pt);
  vec4 ho = at(H + 1.0, pt);
  if (h.a + ho.a > 0.0) {
    float ring = hm.r;
    float top = hm.g;
    for (int i = 0; i < 2; i++) {
      float d = u_band * steps[i];
      h = lay(h, vec3(1.0), LIT * ring * (1.0 - at(H + 2.0, pt - lt * d).r) * (1.0 - top));
      h = lay(h, vec3(0.0), SHADE * ring * (1.0 - at(H + 2.0, pt + lt * d).r) * (1.0 - top));
    }
    for (int i = 0; i < 2; i++) h = lay(h, vec3(0.0), DROP * at(H + 2.0, pt - lt * u_drop.w * steps[i]).g * ring * (1.0 - top));
    for (int i = 0; i < 2; i++) {
      float d = u_band * steps[i];
      h = lay(h, vec3(1.0), LIT * top * (1.0 - at(H + 2.0, pt - lt * d).g));
      h = lay(h, vec3(0.0), SHADE * top * (1.0 - at(H + 2.0, pt + lt * d).g));
    }
    h = over(ho, h);
  }
  o = over(over(h, g), c) * v_ly.w;
}`;
};

// A tank's shadow on the floor: each layer's blurred mask, moved along the light by its height.
const SHADOW_FS = () => `${HEAD}
${TANK_COMMON}
uniform vec4 u_cast; // px along the light: treads, pad, hull, weapon
uniform vec2 u_cast2; // ring, top
uniform vec3 u_shadow;
uniform float u_strength;
void main() {
  float mid = u_slot * 0.5;
  vec2 pb = mid + back(v_q, v_pa.zw);
  vec2 pt = mid + back(v_q, v_tr.xy) + vec2(v_tr.z, 0.0);
  vec2 pg = pt + vec2(v_tr.w, 0.0);
  vec2 lb = back(u_light, v_pa.zw);
  vec2 lt = back(u_light, v_tr.xy);
  float base = (int(v_ex.z + 0.5) & 1) != 0 ? u_cast.x : u_cast.y;
  float u = max(at(v_ly.x + 1.0, pb - lb * base).b, at(v_ly.x + 1.0, pb - lb * u_cast.z).a);
  if (v_ly.y >= 0.0) u = max(u, at(v_ly.y + 2.0, pg - lt * u_cast.w).a);
  u = max(u, at(v_ly.z + 2.0, pt - lt * u_cast2.x).b);
  u = max(u, at(v_ly.z + 2.0, pt - lt * u_cast2.y).a);
  // As shadowsShaped stacks its outlines: full strength inside, fading out across the blur.
  float a = 1.0 - pow(1.0 - u_strength, u);
  o = vec4(u_shadow, 1.0) * (a * v_ly.w);
}`;

// A shell, rocket, missile or round: its shadow (mode 0), or itself with its shaded edge (mode 1).
const SHOT_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_pa; // centre (px), axis
layout(location = 2) in vec4 a_ly; // layer, alpha, mode, half size (px)
layout(location = 3) in vec4 a_pr; // its shadow's offset along the light, its shaded edge's depth (px)
uniform vec2 u_size;
out vec2 v_q;
flat out vec4 v_pa;
flat out vec4 v_ly;
flat out vec4 v_pr;
void main() {
  vec2 q = a_corner * a_ly.w;
  vec2 p = a_pa.xy + q;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_q = q;
  v_pa = a_pa;
  v_ly = a_ly;
  v_pr = a_pr;
}`;

const SHOT_FS = () => `${HEAD}
in vec2 v_q;
flat in vec4 v_pa;
flat in vec4 v_ly;
flat in vec4 v_pr;
uniform sampler2DArray u_atlas;
uniform float u_slot;
uniform vec2 u_light;
out vec4 o;
${COMMON}
vec2 back(vec2 v, vec2 ax) { return vec2(ax.x * v.x + ax.y * v.y, ax.x * v.y - ax.y * v.x); }
vec4 at(float layer, vec2 t) { return texture(u_atlas, vec3(t / u_slot, layer)); }
void main() {
  vec2 p = u_slot * 0.5 + back(v_q, v_pa.zw);
  vec2 l = back(u_light, v_pa.zw);
  float L = v_ly.x;
  if (v_ly.z < 0.5) {
    o = vec4(0.0, 0.0, 0.0, 1.0) * (${f(SHOT_LIGHT.shadow.a)} * at(L + 1.0, p - l * v_pr.x).a * v_ly.y);
    return;
  }
  vec4 c = at(L, p);
  vec4 m = at(L + 1.0, p);
  c = lay(c, vec3(0.0), ${f(SHOT_LIGHT.shade.a)} * m.r * (1.0 - at(L + 1.0, p + l * v_pr.y).b));
  o = over(at(L + 2.0, p), c) * v_ly.y;
}`;

// Tread marks: one instance per mark, laid once (marks.add) and faded by its age on the GPU, two
// dashes a mark, one across each tread (render.js drawMarks: six steps of fading).
const MARK_VS = `${HEAD}
layout(location = 0) in vec3 a_v; // a corner (x, y: -1 or 1), and the tread (-1 or 1)
layout(location = 1) in vec4 a_mark; // where (world), the hull's angle, when it was laid (the renderer's clock)
uniform vec2 u_size;
uniform vec4 u_world; // world to device px: a, b, c, d
uniform vec2 u_shift; // and e, f
uniform float u_clock;
uniform float u_life;
uniform vec4 u_dash; // the tread's offset from the middle, the dash's half length and half width (cells), px a cell
uniform vec2 u_trail; // the mark's strength when laid, and what of it stays for good (in the tracks texture)
out vec2 v_local;
flat out float v_alpha;
void main() {
  float ca = cos(a_mark.z);
  float sa = sin(a_mark.z);
  vec2 along = vec2(ca, sa);
  vec2 across = vec2(-sa, ca);
  float pad = 1.5 / u_dash.w; // room for the edge's antialiasing, cells
  vec2 half = vec2(u_dash.y, u_dash.z) + pad;
  vec2 w = a_mark.xy + across * (u_dash.x * a_v.z) + along * (a_v.x * half.x) + across * (a_v.y * half.y);
  vec2 p = vec2(u_world.x * w.x + u_world.z * w.y, u_world.y * w.x + u_world.w * w.y) + u_shift;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_local = a_v.xy * half * u_dash.w;
  // Six steps of fading over u_life, as render.js drawMarks fades them, down to what stays for
  // good: drawn over that, a fresh mark adds only the rest.
  float age = (u_clock - a_mark.w) / u_life;
  float a = age > 1.0 ? 0.0 : u_trail.x * (1.0 - min(5.0, floor(age * 6.0)) / 6.0);
  v_alpha = max(0.0, (a - u_trail.y) / (1.0 - u_trail.y));
}`.replace(/\bhalf\b/g, 'reach');

const MARK_FS = `${HEAD}
in vec2 v_local;
flat in float v_alpha;
uniform vec4 u_dash;
uniform vec3 u_color;
uniform float u_stamp; // 1: laying marks into the tracks texture, how much each covers
out vec4 o;
void main() {
  vec2 q = abs(v_local) - vec2(u_dash.y, u_dash.z) * u_dash.w;
  float cov = clamp(0.5 - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)), 0.0, 1.0);
  o = u_stamp > 0.5 ? vec4(cov, 0.0, 0.0, 0.0) : vec4(u_color, 1.0) * (cov * v_alpha);
}`;

// The floor: render.js builds it on a 2D canvas off the screen; it is laid here, pixel for pixel.
const FLOOR_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_corner.x * 0.5 + 0.5, 0.5 - a_corner.y * 0.5);
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

const FLOOR_FS = `${HEAD}
in vec2 v_uv;
uniform sampler2D u_floor;
uniform sampler2D u_tracks; // where tread marks have been laid (r: how much), for good
uniform float u_trail; // how dark a mark stays
out vec4 o;
void main() {
  vec4 c = texture(u_floor, v_uv);
  // The tracks were drawn into, so their first row is the screen's bottom; the floor was uploaded top first.
  o = vec4(c.rgb * (1.0 - u_trail * texture(u_tracks, vec2(v_uv.x, 1.0 - v_uv.y)).r), 1.0);
}`;

/* ---------- Colours ---------- */

const colours = new Map();
/** [r, g, b, a] (0-1) of a #rrggbb or rgb()/rgba() colour. */
function rgba(col) {
  let v = colours.get(col);
  if (v) return v;
  const s = String(col).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  } else {
    const parts = (s.match(/[\d.]+/g) || []).map(Number);
    v = parts.length >= 3 ? [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] : 1] : [0.5, 0.5, 0.5, 1];
  }
  colours.set(col, v);
  return v;
}

/* ---------- Pictures: painted with a 2D canvas, read back, uploaded ---------- */

/** The widths of n box blurs that, one after another, blur about as a Gaussian of sigma does (odd). */
function boxes(sigma, n) {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let lo = Math.floor(ideal);
  if (lo % 2 === 0) lo--;
  const m = Math.round((12 * sigma * sigma - n * lo * lo - 4 * n * lo - 3 * n) / (-4 * lo - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? lo : lo + 2));
}

/** src (S x S, 0-1) blurred by a box `w` px wide across and then down, into a new array. */
function boxBlur(src, S, w) {
  const r = (w - 1) >> 1;
  if (r < 1) return src.slice();
  const tmp = new Float32Array(S * S);
  const out = new Float32Array(S * S);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < S; y++) {
    const row = y * S;
    let sum = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < S) sum += src[row + x];
    for (let x = 0; x < S; x++) {
      tmp[row + x] = sum * k;
      const add = x + r + 1;
      const drop = x - r;
      if (add < S) sum += src[row + add];
      if (drop >= 0) sum -= src[row + drop];
    }
  }
  for (let x = 0; x < S; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < S) sum += tmp[y * S + x];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = sum * k;
      const add = y + r + 1;
      const drop = y - r;
      if (add < S) sum += tmp[add * S + x];
      if (drop >= 0) sum -= tmp[drop * S + x];
    }
  }
  return out;
}

/** src blurred about as a Gaussian of sigma (px) blurs it. */
function gauss(src, S, sigma) {
  if (sigma < 0.3) return src.slice();
  let cur = src;
  for (const w of boxes(sigma, 3)) cur = boxBlur(cur, S, w);
  return cur;
}

/** The GPU renderer on canvas; onRestored() runs once a lost context is back and everything must be drawn again. */
export function createGL(canvas, { onRestored = () => {} } = {}) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', ATTRS);
  } catch {
    gl = null;
  }
  if (!gl) return null;

  let lost = false;
  let progs = null;
  let quad = null;
  let atlas = null;
  let generation = 0; // goes up whenever every picture is gone (a lost context, a new scale or palette)
  const W = { w: 1, h: 1 };
  const view = { s: 20, ra: 1, rb: 0, rc: 0, rd: 1, slot: 64, dpr: 1 };
  let M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let M0 = M; // the same, unshaken
  let dash = [0.27, 0.045, 0.085]; // a tread mark's dashes (marks)
  let trail = 0; // how dark a tread mark stays for good (marks)
  let pal = null;
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const planes = new Map(); // tank plane key -> { layer, n, used }
  const shots = new Map(); // shot key -> { layer }
  let layers = null; // how high every tank's layers stand and how far their shadows fall (art.js model), read once per palette
  const queue = []; // tank planes to paint before they are needed: [type, plane, { key, pose }]
  let frame = 0;

  /* ---------- Setup ---------- */

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`gl.js shader: ${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`gl.js program: ${gl.getProgramInfoLog(p)}`);
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      uniforms[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u: uniforms };
  }

  /** A program with its instance buffer and vertex array: floats per instance, split into vec4s from location 1. */
  function program(vs, fs, floats) {
    const prog = compile(vs, fs);
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (let i = 0; i < floats / 4; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
    return { ...prog, vao, buf, floats, data: new Float32Array(floats * 256), used: 0 };
  }

  function init() {
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    progs = {
      prim: program(PRIM_VS, PRIM_FS(), PRIM_FLOATS),
      tank: program(TANK_VS, TANK_FS(), TANK_FLOATS),
      shadow: program(TANK_VS, SHADOW_FS(), TANK_FLOATS),
      shot: program(SHOT_VS, SHOT_FS(), SHOT_FLOATS),
    };
    initMarks();
    initFloor();
    tracks = null;
    makeTracks();
    atlas = null;
    planes.clear();
    shots.clear();
    queue.length = 0;
    generation++;
  }

  /* ---------- The floor: one texture, laid first on every frame ---------- */

  let floor = null;

  function initFloor() {
    const prog = compile(FLOOR_VS, FLOOR_FS);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Laid one texel to a pixel: nearest copies it exactly.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    floor = { ...prog, vao, tex, w: 0, h: 0 };
  }

  /* ---------- Tread marks that stay: where they have been, one texture the floor is laid through ---------- */

  let tracks = null;
  let screen = 0; // goes up whenever the tracks texture starts empty (a new size, a lost context)

  function makeTracks() {
    if (tracks) {
      gl.deleteTexture(tracks.tex);
      gl.deleteFramebuffer(tracks.fb);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, W.w, W.h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    tracks = { tex, fb, w: W.w, h: W.h };
    screen++;
  }

  /**
   * Lays marks into the tracks texture: `count` instances of the ring from `first`, or of buffer
   * buf. Where marks overlap the texture keeps the most any one gives (MAX), so a path driven
   * over and over is no darker than one mark.
   */
  function stampTracks(buf, first, count) {
    if (!count || !tracks || !marks) return;
    const m = marks;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tracks.fb);
    gl.viewport(0, 0, tracks.w, tracks.h);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(m.p);
    const u = m.u;
    gl.uniform2f(u.u_size, tracks.w, tracks.h);
    gl.uniform4f(u.u_world, M0.a, M0.b, M0.c, M0.d);
    gl.uniform2f(u.u_shift, M0.e, M0.f);
    gl.uniform1f(u.u_clock, 0);
    gl.uniform1f(u.u_life, 1);
    gl.uniform4f(u.u_dash, dash[0], dash[1], dash[2], view.s);
    gl.uniform2f(u.u_trail, 1, 0);
    gl.uniform1f(u.u_stamp, 1);
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [at, n] of first + count > MARKS && buf === m.ring ? [[first, MARKS - first], [0, first + count - MARKS]] : [[first, count]]) {
      if (!n) continue;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, at * 16);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, n);
    }
    gl.uniform1f(u.u_stamp, 0);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  /* ---------- Tread marks: a ring of instances on the GPU, each laid once ---------- */

  const MARKS = 8192; // marks the ring holds; the oldest go first (about 9 s of eight tanks driving uses a tenth)
  let marks = null;

  function initMarks() {
    const prog = compile(MARK_VS, MARK_FS);
    const vao = gl.createVertexArray();
    const corners = gl.createBuffer();
    const ring = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    // Two quads (one per tread), as triangles: x, y, tread.
    const q = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...q.flatMap(([x, y]) => [x, y, -1]), ...q.flatMap(([x, y]) => [x, y, 1])]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ring);
    gl.bufferData(gl.ARRAY_BUFFER, MARKS * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    marks = { ...prog, vao, ring, head: 0, count: 0, fresh: [] };
  }

  /** Draws the newest `count` marks, at the place in the frame its batch holds. */
  function drawMarks(b) {
    const m = marks;
    const n = Math.min(b.count, m.count, MARKS);
    if (!n) return;
    gl.useProgram(m.p);
    const u = m.u;
    gl.uniform2f(u.u_size, W.w, W.h);
    gl.uniform4f(u.u_world, M.a, M.b, M.c, M.d);
    gl.uniform2f(u.u_shift, M.e, M.f);
    gl.uniform1f(u.u_clock, b.clock);
    gl.uniform1f(u.u_life, b.life);
    gl.uniform4f(u.u_dash, b.dash[0], b.dash[1], b.dash[2], view.s);
    gl.uniform3f(u.u_color, b.color[0], b.color[1], b.color[2]);
    gl.uniform2f(u.u_trail, b.color[3], b.trail);
    gl.uniform1f(u.u_stamp, 0);
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.ring);
    // The live marks run from (head - n) round the ring to head: one or two runs.
    const start = (((m.head - n) % MARKS) + MARKS) % MARKS;
    const first = Math.min(n, MARKS - start);
    for (const [at, count] of [[start, first], [0, n - first]]) {
      if (!count) continue;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, at * 16);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, count);
    }
  }

  /** Uploads the marks laid since the last frame, and lays them into the tracks for good. */
  function flushMarks() {
    const m = marks;
    if (!m.fresh.length) return;
    const first = m.head;
    const count = Math.min(m.fresh.length, MARKS);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.ring);
    let i = 0;
    while (i < m.fresh.length) {
      const at = m.head % MARKS;
      const run = Math.min(m.fresh.length - i, MARKS - at);
      const data = new Float32Array(run * 4);
      for (let k = 0; k < run; k++) data.set(m.fresh[i + k], k * 4);
      gl.bufferSubData(gl.ARRAY_BUFFER, at * 16, data);
      m.head = (m.head + run) % MARKS;
      i += run;
    }
    m.count = Math.min(MARKS, m.count + m.fresh.length);
    m.fresh.length = 0;
    stampTracks(m.ring, first, count);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    init();
    onRestored();
  });
  init();

  /* ---------- The atlas: one array of square layers, every picture in its own ---------- */

  function makeAtlas(depth) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, view.slot, view.slot, depth);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, depth, slot: view.slot, used: new Uint8Array(depth) };
  }

  /** n layers in a row, the atlas made deeper (its pictures copied over) when it has no room. */
  function allocate(n) {
    if (!atlas || atlas.slot !== view.slot) atlas = makeAtlas(64);
    for (;;) {
      for (let i = 0; i + n <= atlas.depth; i++) {
        let free = true;
        for (let j = 0; j < n && free; j++) free = !atlas.used[i + j];
        if (!free) continue;
        atlas.used.fill(1, i, i + n);
        return i;
      }
      const max = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
      if (atlas.depth >= max) {
        evict();
        continue;
      }
      grow(Math.min(max, atlas.depth * 2));
    }
  }

  function grow(depth) {
    const next = makeAtlas(depth);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, next.tex);
    for (let i = 0; i < atlas.depth; i++) {
      if (!atlas.used[i]) continue;
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, atlas.tex, 0, i);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 0, 0, atlas.slot, atlas.slot);
      next.used[i] = 1;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(atlas.tex);
    atlas = next;
  }

  /** Room at the atlas's deepest: the tank pictures this frame isn't using go, the least lately used first. */
  function evict() {
    const old = [...planes.entries()].filter(([, v]) => v.used < frame).sort((a, b) => a[1].used - b[1].used);
    if (!old.length) throw new Error('gl.js: the atlas is full');
    for (const [key, v] of old.slice(0, Math.max(1, old.length >> 1))) {
      atlas.used.fill(0, v.layer, v.layer + v.n);
      planes.delete(key);
    }
  }

  function upload(layer, data) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, view.slot, view.slot, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /**
   * Paints `subs` pictures side by side on the scratch canvas, each with paint(c) at its slot's
   * middle with the transform t ([a, b, c, d], px a unit), on a clear (or, for a mask, black)
   * ground, and reads them back: [{ rgba (premultiplied, 0-255), mask (0-1, from red) }].
   */
  function paintAll(subs, t) {
    const S = view.slot;
    const w = S * subs.length;
    if (scratch.width < w || scratch.height < S) {
      scratch.width = Math.max(scratch.width, w);
      scratch.height = Math.max(scratch.height, S);
    }
    const c = sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, S);
    subs.forEach((sub, i) => {
      if (!sub) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (sub.mask) {
        c.fillStyle = '#000';
        c.fillRect(i * S, 0, S, S);
      }
      c.save();
      c.beginPath();
      c.rect(i * S, 0, S, S);
      c.clip();
      c.setTransform(t[0], t[1], t[2], t[3], i * S + S / 2, S / 2);
      if (sub.shape) {
        c.beginPath();
        sub.shape(c);
        c.fillStyle = '#fff';
        c.fill();
      } else sub.paint(c);
      c.restore();
    });
    const img = c.getImageData(0, 0, w, S).data;
    return subs.map((sub, i) => {
      if (!sub) return null;
      if (sub.mask) {
        const m = new Float32Array(S * S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) m[y * S + x] = img[(y * w + i * S + x) * 4] / 255;
        return { mask: m };
      }
      const out = new Uint8Array(S * S * 4);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const s = (y * w + i * S + x) * 4;
          const d = (y * S + x) * 4;
          const a = img[s + 3];
          out[d] = Math.round((img[s] * a) / 255);
          out[d + 1] = Math.round((img[s + 1] * a) / 255);
          out[d + 2] = Math.round((img[s + 2] * a) / 255);
          out[d + 3] = a;
        }
      }
      return { rgba: out };
    });
  }

  /** Four 0-1 channels as one RGBA layer. */
  function pack(r, g, b, a) {
    const S = view.slot;
    const out = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      out[i * 4] = r ? Math.round(r[i] * 255) : 0;
      out[i * 4 + 1] = g ? Math.round(g[i] * 255) : 0;
      out[i * 4 + 2] = b ? Math.round(b[i] * 255) : 0;
      out[i * 4 + 3] = a ? Math.round(a[i] * 255) : 0;
    }
    return out;
  }

  /** Paints and uploads one plane of a tank (art.js tankPlanes) in a pose; null for a gun it hasn't got. */
  function paintPlane(type, which, pose) {
    const P = tankPlanes(pal, type, pose);
    const p = P[which];
    if (!p) return null;
    const k = which === 'body' ? view.s * ART : view.s;
    const t = [k, 0, 0, k];
    const S = view.slot;
    const blurW = Math.max(1, Math.round(2 * HARD_LIGHT.castBlur * view.s)) | 1;
    if (which === 'body') {
      const [alb, m0, m1] = paintAll([{ paint: p.albedo }, { mask: true, shape: p.masks[0] }, { mask: true, shape: p.masks[1] }], t);
      const layer = allocate(2);
      upload(layer, alb.rgba);
      upload(layer + 1, pack(m0.mask, m1.mask, boxBlur(m0.mask, S, blurW), boxBlur(m1.mask, S, blurW)));
      return { layer, n: 2 };
    }
    const second = p.emission ? { mask: true, paint: p.emission } : { paint: p.overlay };
    const subs = [{ paint: p.albedo }, second, ...p.masks.map((shape) => ({ mask: true, shape }))];
    const [alb, ov, ...masks] = paintAll(subs, t);
    const layer = allocate(3);
    upload(layer, alb.rgba);
    upload(layer + 1, ov.rgba || pack(ov.mask, null, null, null));
    if (which === 'gun') upload(layer + 2, pack(masks[0].mask, masks[1].mask, masks[2].mask, boxBlur(masks[2].mask, S, blurW)));
    else upload(layer + 2, pack(masks[0].mask, masks[1].mask, boxBlur(masks[0].mask, S, blurW), boxBlur(masks[1].mask, S, blurW)));
    return { layer, n: 3 };
  }

  /** How wide tank kind type's gun's tubes are (cells; 0: none), which the shader lights round. */
  const tubes = new Map();
  const tubeOf = (type) => {
    if (!tubes.has(type)) tubes.set(type, tankPlanes(pal, type, {}).gun?.tube || 0);
    return tubes.get(type);
  };

  /** The layer a tank plane is in, painted now if it hasn't been (-1: a gun it hasn't got). */
  function plane(type, which, pp) {
    const key = `${which} ${pp.key}`;
    let v = planes.get(key);
    if (!v) {
      v = paintPlane(type, which, pp.pose) || { layer: -1, n: 0 };
      planes.set(key, v);
    }
    v.used = frame;
    return v.layer;
  }

  /* ---------- Instances, in batches of one program and one blend ---------- */

  let batches = [];

  function push(prog, blend, values) {
    if (prog.used + prog.floats > prog.data.length) {
      const next = new Float32Array(prog.data.length * 2);
      next.set(prog.data);
      prog.data = next;
    }
    prog.data.set(values, prog.used);
    const index = prog.used / prog.floats;
    prog.used += prog.floats;
    const last = batches[batches.length - 1];
    if (last && last.prog === prog && last.blend === blend && last.start + last.count === index) last.count++;
    else batches.push({ prog, blend, start: index, count: 1 });
  }

  // World to device px.
  const px = (x, y) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f];
  // A world direction's angle on the screen, as (cos, sin).
  const axis = (angle) => {
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    return [(view.ra * x + view.rc * y), (view.rb * x + view.rd * y)];
  };
  const premul = (col, a) => {
    const [r, g, b, ca] = rgba(col);
    const k = ca * a;
    return [r * k, g * k, b * k, k];
  };
  const PRIM = new Float32Array(PRIM_FLOATS);

  function prim(blend, x, y, ax, ay, hx, hy, kind, col, p0, p1 = null) {
    const v = PRIM;
    v[0] = x;
    v[1] = y;
    v[2] = ax;
    v[3] = ay;
    v[4] = hx;
    v[5] = hy;
    v[6] = kind;
    v[7] = 0;
    v.set(col, 8);
    v.set(p0, 12);
    if (p1) v.set(p1, 16);
    else v.fill(0, 16, 20);
    push(progs.prim, blend, v);
  }

  /* ---------- The API: world units, as the 2D context draws ---------- */

  const api = {
    get ok() {
      return !lost;
    },
    /** Goes up whenever pictures it gave out (sprites) are gone and must be baked again. */
    get generation() {
      return generation;
    },
    /** The canvas's size, device px. */
    resize(w, h) {
      W.w = Math.max(1, Math.round(w));
      W.h = Math.max(1, Math.round(h));
      if (canvas.width !== W.w) canvas.width = W.w;
      if (canvas.height !== W.h) canvas.height = W.h;
      if (!lost && (!tracks || tracks.w !== W.w || tracks.h !== W.h)) makeTracks();
    },
    /** Goes up whenever the tracks start empty again: the marks that stay must be laid again (trails). */
    get screen() {
      return screen;
    },
    /** Lays tread marks ([x, y, angle] each) into the tracks for good, at once, with the world as it stands (begin). */
    trails(list) {
      if (lost || !marks || !list.length) return;
      const data = new Float32Array(list.length * 4);
      list.forEach((t, i) => data.set([t[0], t[1], t[2], 0], i * 4));
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      stampTracks(buf, 0, list.length);
      gl.deleteBuffer(buf);
    },
    /** Every tread mark gone, the ones that stay too (a new world). */
    clearTrails() {
      if (lost || !tracks) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, tracks.fb);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    /**
     * What the pictures are painted for: s (device px a cell), dpr (device px a CSS px) and the
     * palette. A change drops them all (generation goes up).
     */
    setView({ s, dpr, palette }) {
      const slot = 2 * Math.ceil(0.8 * s + 2);
      const changed = s !== view.s || slot !== view.slot || palette !== pal;
      view.s = s;
      view.dpr = dpr;
      view.slot = slot;
      if (palette !== pal) layers = null;
      pal = palette;
      if (!changed) return;
      if (atlas) gl.deleteTexture(atlas.tex);
      atlas = null;
      planes.clear();
      shots.clear();
      queue.length = 0;
      generation++;
    },
    /** Tank kinds about to be drawn: every look of theirs is painted ahead of need, a little each frame (work). */
    prepare(types) {
      for (const type of new Set(types)) {
        for (const pose of planeVariants(type)) {
          const pp = planePose(type, pose);
          for (const which of ['body', 'gun', 'head']) {
            if (which === 'gun' && !tankPlanes(pal, type, {}).gun) continue;
            const key = `${which} ${pp[which].key}`;
            if (!planes.has(key) && !queue.some((q) => q[3] === key)) queue.push([type, which, pp[which], key]);
          }
        }
      }
    },
    /** Paints queued pictures for up to ms milliseconds. */
    work(ms = 3) {
      if (lost || !pal) return;
      const end = performance.now() + ms;
      while (queue.length && performance.now() < end) {
        const [type, which, pp, key] = queue.shift();
        if (!planes.has(key)) planes.set(key, { ...(paintPlane(type, which, pp.pose) || { layer: -1, n: 0 }), used: frame });
      }
    },
    /**
     * The floor: all of canvas `source` (an opaque 2D canvas the size of this one), or, with
     * rect ({ x, y, w, h }, device px), that part of it again from `source`, an ImageData of it.
     */
    floor(source, rect = null) {
      if (lost || !floor) return;
      gl.bindTexture(gl.TEXTURE_2D, floor.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (!rect) {
        floor.w = source.width;
        floor.h = source.height;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else if (floor.w) gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    },
    /** A tread mark laid at world (x, y) by a hull at angle a, at time t (the renderer's clock). */
    addMark(x, y, a, t) {
      if (marks) marks.fresh.push([x, y, a, t]);
    },
    /** Every tread mark gone (a new world). */
    clearMarks() {
      if (!marks) return;
      marks.fresh.length = 0;
      marks.count = 0;
    },
    /**
     * Draws the newest `count` tread marks here, in col at its strength down to 1/6 of it as they
     * age over `life` seconds of `clock`, over what of each stays for good (trail, laid with the
     * floor): shape is the tread's offset, the dash's half length and half width (cells).
     */
    marks(count, clock, life, col, shape, stays = 0) {
      dash = shape;
      trail = stays;
      batches.push({ special: drawMarks, count, clock, life, color: premul(col, 1), dash: shape, trail: stays });
    },
    /** Starts a frame: M is the world's transform to device px (with any shake), base the same unshaken. */
    begin(matrix, base = matrix) {
      M = matrix;
      M0 = base;
      const s = Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) || 1;
      view.ra = M.a / s;
      view.rb = M.b / s;
      view.rc = M.c / s;
      view.rd = M.d / s;
      frame++;
      batches = [];
      for (const p of Object.values(progs)) p.used = 0;
    },

    disc(x, y, r, col, a = 1, sigma = 0) {
      const [cx, cy] = px(x, y);
      const R = r * view.s;
      const sg = sigma * view.s;
      const h = R + 3 * sg + 1.5;
      prim('over', cx, cy, 1, 0, h, h, KIND.disc, premul(col, a), [R, sg, 0, 0]);
    },
    /** A circle's outline, w wide; dash: [on, off] along it, from world angle 0 the way angles go. */
    ring(x, y, r, w, col, a = 1, dash = null) {
      const [cx, cy] = px(x, y);
      const R = r * view.s;
      const hw = (w * view.s) / 2;
      const h = R + hw + 1.5;
      const [sx, sy] = axis(0);
      const [tx, ty] = axis(Math.PI / 2);
      // Which way angles go on the screen: the same as the world's unless the turn mirrors it.
      const dir = Math.sign(sx * ty - sy * tx) || 1;
      prim('over', cx, cy, 1, 0, h, h, KIND.ring, premul(col, a), [R, hw, dash ? dash[0] * view.s : 0, dash ? dash[1] * view.s : 0], [Math.atan2(sy, sx), dir, 0, 0]);
    },
    /** A line w wide from (x0, y0) to (x1, y1), round-ended or square-ended (butt). add: light added. */
    line(x0, y0, x1, y1, w, col, a = 1, { round = true, add = false } = {}) {
      const [ax, ay] = px(x0, y0);
      const [bx, by] = px(x1, y1);
      const len = Math.hypot(bx - ax, by - ay);
      const hw = (w * view.s) / 2;
      const ux = len > 1e-6 ? (bx - ax) / len : 1;
      const uy = len > 1e-6 ? (by - ay) / len : 0;
      const col4 = premul(col, a);
      if (add) col4[3] = 0;
      prim(add ? 'add' : 'over', (ax + bx) / 2, (ay + by) / 2, ux, uy, len / 2 + hw + 1.5, hw + 1.5, KIND.line, col4, [len / 2, hw, round ? 1 : 0, 0]);
    },
    /** A box hx x hy each side of (x, y), turned by world angle `angle`; corners of radius r; outline: its width (none: filled). */
    box(x, y, hx, hy, angle, col, a = 1, { r = 0, outline = 0 } = {}) {
      const [cx, cy] = px(x, y);
      const [ax, ay] = axis(angle);
      const s = view.s;
      const ow = (outline * s) / 2;
      prim('over', cx, cy, ax, ay, hx * s + ow + 1.5, hy * s + ow + 1.5, KIND.box, premul(col, a), [hx * s, hy * s, r * s, ow]);
    },
    /** Light given off onto whatever is under it: added, fading out to r. */
    glow(x, y, r, col, a = 1) {
      const [cx, cy] = px(x, y);
      const R = r * view.s;
      prim('add', cx, cy, 1, 0, R + 1, R + 1, KIND.glow, premul(col, a), [R, 0, 0, 0]);
    },
    /** A filled triangle, its corners in world units. */
    tri(points, col, a = 1) {
      const p = points.map(([x, y]) => px(x, y));
      const cx = (p[0][0] + p[1][0] + p[2][0]) / 3;
      const cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
      const h = Math.max(...p.map(([x, y]) => Math.max(Math.abs(x - cx), Math.abs(y - cy)))) + 1.5;
      prim('over', cx, cy, 1, 0, h, h, KIND.tri, premul(col, a), [p[0][0] - cx, p[0][1] - cy, p[1][0] - cx, p[1][1] - cy], [p[2][0] - cx, p[2][1] - cy, 0, 0]);
    },

    /**
     * A picture painted once and laid many times: paint(c) draws it in world units, with the
     * world point (x, y) at its middle as the screen shows it (world: true), or facing right at
     * the origin in cells, to be turned and scaled when laid. Returns { layer, generation }.
     */
    bake(paint, { x = 0, y = 0, world = false } = {}) {
      const s = view.s;
      const t = world ? [M.a, M.b, M.c, M.d] : [s, 0, 0, s];
      const [img] = paintAll([{ paint: world ? (c) => {
        c.translate(-x, -y);
        paint(c);
      } : paint }], t);
      const layer = allocate(1);
      upload(layer, img.rgba);
      return { layer, generation };
    },
    /** Lets a baked picture's layer go. */
    free(pic) {
      if (pic && pic.generation === generation && atlas) atlas.used[pic.layer] = 0;
    },
    /** Lays a baked picture with its middle on world point (x, y), turned by world angle `angle` (a picture baked facing right) and scaled. */
    sprite(pic, x, y, a = 1, { angle = null, scale = 1 } = {}) {
      if (!pic || pic.generation !== generation) return;
      const [cx, cy] = px(x, y);
      const [ax, ay] = angle === null ? [1, 0] : axis(angle);
      const h = (view.slot / 2) * scale;
      prim('over', cx, cy, ax, ay, h, h, KIND.sprite, [0, 0, 0, a], [pic.layer, 1 / scale, 0, 0]);
    },

    /** A mine (art.js drawMine): its shadow, its light's glow (when lit) and itself. */
    mine(x, y, tone, state) {
      const K = MINE;
      const s = view.s;
      const [cx, cy] = px(x, y);
      // Its shadow on the floor, along the light.
      const shadow = premul(pal.shadow, 1);
      const R = K.casing * s;
      const sg = (K.shadow.blur / 2) * s;
      prim('over', cx + LX * K.shadow.d * s, cy + LY * K.shadow.d * s, 1, 0, R + 3 * sg + 1.5, R + 3 * sg + 1.5, KIND.disc, shadow, [R, sg, 0, 0]);
      if (state !== 'off') {
        const g = K.glow[state === 'urgent' ? 'urgent' : 'on'];
        api.glow(x, y, g.r, pal[g.color], g.a);
      }
      const light = state === 'off' ? tone.deep : state === 'urgent' ? pal.alarm : pal.signal;
      const [sx, sy] = px(x + K.spark.at, y + K.spark.at);
      const h = R + 2;
      prim('over', cx, cy, 1, 0, h, h, KIND.mine, premul(tone.base, 1), [s, state === 'off' ? 0 : 1, sx - cx, sy - cy], [...rgba(light).slice(0, 3), 1]);
    },
    /** A bomb in the air (art.js bombLook's numbers): its shadow on the floor, then the ball. */
    bomb(look) {
      const s = view.s;
      const sh = look.shadow;
      const [sx, sy] = px(sh.x, sh.y);
      const R = sh.r * s;
      const sg = (sh.blur / 2) * s;
      prim('over', sx, sy, 1, 0, R + 3 * sg + 1.5, R + 3 * sg + 1.5, KIND.disc, premul('#000', sh.a), [R, sg, 0, 0]);
      const [cx, cy] = px(look.x, look.y);
      const [hx, hy] = px(look.hx, look.hy);
      const h = (look.r + BOMB.halo.to) * s + 1.5;
      prim('over', cx, cy, 1, 0, h, h, KIND.bomb, [1, 1, 1, 1], [look.r * s, hx - cx, hy - cy, s]);
    },

    /**
     * Tanks (drawTank's options each, with t): every shadow first, then every tank, so no tank's
     * shadow falls on another; then the glow at a hot minigun's muzzle.
     */
    tanks(list) {
      const rows = [];
      for (const one of list) {
        const { t: at, alpha = 1, phase = 0, mines, lit = false, roll = 0, fired = Infinity, side = 0, heat = 0 } = one;
        const T = TYPES[at.type];
        const tone = pal.tanks[at.type] || pal.tanks.player;
        const { t, recoil } = tankPose(at, fired, side);
        const pp = planePose(at.type, { mines, lit, roll, recoil });
        const B = plane(at.type, 'body', pp.body);
        const G = plane(at.type, 'gun', pp.gun);
        const H = plane(at.type, 'head', pp.head);
        const [cx, cy] = px(t.x, t.y);
        const [bx, by] = axis(t.body);
        const [tx, ty] = axis(t.turret);
        const minigun = T.weapon === 'minigun';
        const hot = minigun ? Math.max(0, Math.min(1, heat)) : 0;
        const cleat = rgba(tone.cleat || tone.deep);
        rows.push({ v: [cx, cy, bx, by, tx, ty, (t.kick || 0) * view.s, pp.gun.slide * view.s, B, G, H, alpha, cleat[0], cleat[1], cleat[2], phase, hot, Math.max(0, hot - 0.5) * 1.6, (T.speed ? 1 : 0) + (minigun ? 2 : 0), tubeOf(at.type)], t, hot, slide: pp.gun.slide, alpha });
      }
      for (const r of rows) push(progs.shadow, 'over', r.v);
      for (const r of rows) push(progs.tank, 'over', r.v);
      for (const r of rows) {
        if (r.hot <= 0.01) continue;
        const d = MUZZLE - 0.08 - r.slide - (r.t.kick || 0);
        api.glow(r.t.x + Math.cos(r.t.turret) * d, r.t.y + Math.sin(r.t.turret) * d, 0.42, pal.fire, 0.3 * r.hot * r.alpha);
      }
    },

    /**
     * Shots ({ b, flame, blink, tone }): every shadow, then what burns behind each (glows and
     * flames), then the shots themselves.
     */
    shots(list) {
      const s = view.s;
      const half = 0.5 * s + 2;
      const rows = list.map(({ b, flame = 0.5, blink = true, tone = null }) => {
        const key = `${b.weapon} ${b.weapon === 'missile' ? `${blink} ${tone ? tone.base : ''}` : ''}`;
        let pic = shots.get(key);
        if (!pic) {
          const P = shotPlanes(pal, b.weapon, { tone, blink });
          const sg = (blur) => (blur / 2) * s;
          const [alb, ov, m0, m1] = paintAll([{ paint: P.albedo }, { paint: P.overlay }, { mask: true, shape: P.shaded }, { mask: true, shape: P.parts }], [s, 0, 0, s]);
          const layer = allocate(3);
          upload(layer, alb.rgba);
          upload(layer + 1, pack(m0.mask, m1.mask, gauss(m0.mask, view.slot, sg(SHOT_LIGHT.shade.blur)), gauss(m1.mask, view.slot, sg(SHOT_LIGHT.shadow.blur))));
          upload(layer + 2, ov.rgba);
          pic = { layer, h: P.h };
          shots.set(key, pic);
        }
        const angle = Math.atan2(b.vy, b.vx);
        const [cx, cy] = px(b.x, b.y);
        const [ax, ay] = axis(angle);
        return { b, angle, flame, blink, cx, cy, ax, ay, pic };
      });
      for (const r of rows) push(progs.shot, 'over', [r.cx, r.cy, r.ax, r.ay, r.pic.layer, 1, 0, half, r.pic.h * HARD_LIGHT.cast * s, SHOT_LIGHT.shade.d * s, 0, 0]);
      for (const r of rows) {
        const fire = shotFire(r.b.weapon, r.flame, r.blink);
        const ca = Math.cos(r.angle);
        const sa = Math.sin(r.angle);
        const to = ([x, y]) => [r.b.x + ca * x - sa * y, r.b.y + sa * x + ca * y];
        for (const g of fire.glows) {
          const [gx, gy] = to([g.x, g.y]);
          api.glow(gx, gy, g.r, pal[g.color], g.a);
        }
        if (fire.flame) api.tri(fire.flame.map(to), pal.fire);
      }
      for (const r of rows) push(progs.shot, 'over', [r.cx, r.cy, r.ax, r.ay, r.pic.layer, 1, 1, half, 0, SHOT_LIGHT.shade.d * s, 0, 0]);
    },

    /** Draws the frame. */
    end() {
      if (lost || !progs) return;
      gl.viewport(0, 0, W.w, W.h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      flushMarks();
      gl.viewport(0, 0, W.w, W.h);
      gl.disable(gl.BLEND);
      if (floor && floor.w) {
        gl.useProgram(floor.p);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, floor.tex);
        gl.uniform1i(floor.u.u_floor, 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, tracks ? tracks.tex : null);
        gl.uniform1i(floor.u.u_tracks, 2);
        gl.uniform1f(floor.u.u_trail, trail);
        gl.bindVertexArray(floor.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (!batches.length) return;
      gl.enable(gl.BLEND);
      for (const p of Object.values(progs)) {
        if (!p.used) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, p.buf);
        gl.bufferData(gl.ARRAY_BUFFER, p.data.subarray(0, p.used), gl.DYNAMIC_DRAW);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas ? atlas.tex : null);
      let current = null;
      let blend = null;
      for (const b of batches) {
        if (b.special) {
          if (blend !== 'over') {
            blend = 'over';
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          }
          b.special(b);
          current = null;
          continue;
        }
        const p = b.prog;
        if (p !== current) {
          current = p;
          gl.useProgram(p.p);
          if (p.frame !== frame) {
            p.frame = frame;
            uniforms(p);
          }
          gl.bindVertexArray(p.vao);
        }
        if (b.blend !== blend) {
          blend = b.blend;
          if (blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
          else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, p.buf);
        const stride = p.floats * 4;
        for (let i = 0; i < p.floats / 4; i++) gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, stride, b.start * stride + i * 16);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count);
      }
      gl.bindVertexArray(null);
    },
  };

  /** The layers' heights and drops: the same on every tank (art.js model), but for a pad's height. */
  function layerInfo() {
    if (layers) return layers;
    const moving = Object.keys(TYPES).find((k) => TYPES[k].speed);
    const fixed = Object.keys(TYPES).find((k) => !TYPES[k].speed) || moving;
    const a = tankPlanes(pal, moving, {});
    const b = tankPlanes(pal, fixed, {});
    layers = { treads: a.heights[0], pad: b.heights[0], hull: a.heights[1], weapon: a.heights[2], ring: a.heights[3], top: a.heights[4], drops: a.drops };
    return layers;
  }

  function uniforms(p) {
    const u = p.u;
    const s = view.s;
    const set2 = (name, x, y) => u[name] && gl.uniform2f(u[name], x, y);
    const set1 = (name, x) => u[name] && gl.uniform1f(u[name], x);
    const set3c = (name, col) => {
      if (!u[name]) return;
      const [r, g, b] = rgba(col);
      gl.uniform3f(u[name], r, g, b);
    };
    set2('u_size', W.w, W.h);
    if (u.u_atlas) gl.uniform1i(u.u_atlas, 0);
    set1('u_slot', view.slot);
    set2('u_light', LX, LY);
    set3c('u_ink', pal.ink);
    set3c('u_flash', pal.flash);
    set3c('u_fire', pal.fire);
    // The hard light at the screen's own pixel ratio: no band or drop thinner than at 2x, in CSS px.
    const k = view.dpr / 2;
    const band = Math.max(HARD_LIGHT.band * s, HARD_LIGHT.bandMin * k);
    set1('u_band', band);
    if (u.u_drop) gl.uniform4f(u.u_drop, ...layerInfo().drops.map((d) => Math.max(d * s, HARD_LIGHT.dropMin * k)));
    set1('u_hull', s * ART);
    set1('u_cell', s);
    set1('u_margin', p === progs.shadow ? 0.3 * s : 0);
    if (u.u_cast) {
      const h = layerInfo();
      const c = HARD_LIGHT.cast * s;
      gl.uniform4f(u.u_cast, h.treads * c, h.pad * c, h.hull * c, h.weapon * c);
      gl.uniform2f(u.u_cast2, h.ring * c, h.top * c);
      set3c('u_shadow', pal.shadow);
      set1('u_strength', rgba(pal.shadow)[3]);
    }
  }

  return api;
}

