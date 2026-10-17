// Ktan's board on the screen: one canvas showing the island's picture (painted off the screen by
// island.js with art.js) and what happens on it, drawn by the GPU: the places a piece can go
// (rings and dashes), ghosts and the robber in the air (pictures), rings round tiles, light. On the
// table it also draws the moving sea under the island (KTAN.md B8, Battery): one draw call a frame,
// every wave worked out in the shader from the time, as the install page's field does.
//
// Why the GPU: on a real iPhone a big 2D canvas on the screen can show blurred and pixelated until
// the next layout (Tanks found it, TANKS.md P4); a WebGL canvas is sharp at the screen's own pixel
// ratio from the first frame. The pictures are still painted with a 2D context, off the screen.
// Without WebGL2 the same calls draw on a 2D context (create2D), the sea in it far slower.
//
// Everything is placed in CSS px of the canvas: pic(), sprite() and the shapes queue in order, and
// end() draws what is queued. Colours are [r, g, b, a] with r, g, b 0..255 and a 0..1.
import { SEA, waveAt, waveD, hash, shapeOf } from './art.js';

const ATTRS = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power' };
const KIND = { ellipse: 0, ring: 1, line: 2, glow: 3 };
const FLOATS = 20;
const TAU = Math.PI * 2;

const HEAD = `#version 300 es
precision highp float;
`;

const QUAD_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
uniform vec2 u_size;     // the canvas, CSS px
uniform vec4 u_rect;     // where the picture goes: x, y (its middle), half its width, half its height
uniform vec2 u_axis;     // cos, sin of its turn about its middle
out vec2 v_uv;
out vec2 v_px;
void main() {
  vec2 local = a_corner * u_rect.zw;
  vec2 p = u_rect.xy + vec2(u_axis.x * local.x - u_axis.y * local.y, u_axis.y * local.x + u_axis.x * local.y);
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_uv = a_corner * 0.5 + 0.5;
  v_px = p;
}`;

// A picture laid by any affine map (the table's swing bends each frame of it to the angle reached):
// its unit square's corner (0, 0) at u_o, its sides along u_ax and u_ay, in CSS px.
const QUADA_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
uniform vec2 u_size;
uniform vec2 u_o;
uniform vec2 u_ax;
uniform vec2 u_ay;
out vec2 v_uv;
out vec2 v_px;
void main() {
  vec2 uv = a_corner * 0.5 + 0.5;
  vec2 p = u_o + u_ax * uv.x + u_ay * uv.y;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_uv = uv;
  v_px = p;
}`;

// A picture, premultiplied, at an alpha; a mask (a strip from a to b, half a width wide) shows only
// the part of it inside: a road laid brick by brick.
const QUAD_FS = `${HEAD}
in vec2 v_uv;
in vec2 v_px;
uniform sampler2D u_tex;
uniform float u_alpha;
uniform vec4 u_mask;     // a (xy), b (zw), px; off when u_maskW < 0
uniform float u_maskW;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv);
  float m = 1.0;
  if (u_maskW >= 0.0) {
    vec2 ab = u_mask.zw - u_mask.xy;
    float l = max(length(ab), 1e-3);
    vec2 u = ab / l;
    vec2 d = v_px - u_mask.xy;
    float t = dot(d, u);
    float s = abs(dot(d, vec2(-u.y, u.x)));
    m = clamp(0.5 - (s - u_maskW), 0.0, 1.0) * clamp(0.5 + t, 0.0, 1.0) * clamp(0.5 + l - t, 0.0, 1.0);
  }
  o = c * (u_alpha * m);
}`;

const PRIM_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_pa;  // centre (px), axis (cos, sin)
layout(location = 2) in vec4 a_hk;  // half the quad (px), kind, blend (0 over, 1 add)
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

const PRIM_FS = `${HEAD}
in vec2 v_local;
flat in vec4 v_hk;
flat in vec4 v_col;
flat in vec4 v_p0;
flat in vec4 v_p1;
uniform float u_dpr;
out vec4 o;
float aa(float d) { return clamp(0.5 - d * u_dpr, 0.0, 1.0); }
// Coverage of an edge blurred by a Gaussian of sigma (px): a canvas shadowBlur is 2 sigma.
float soft(float d, float sigma) { return sigma > 0.0 ? 1.0 / (1.0 + exp(1.702 * d / sigma)) : aa(d); }
// Distance (px) to an ellipse of radii r, to first order: good for the flat rings on the ground.
float ellipse(vec2 p, vec2 r) {
  vec2 q = p / r;
  float k = length(q);
  vec2 g = q / (r * max(k, 1e-4));
  return (k - 1.0) / max(length(g), 1e-4);
}
void main() {
  int kind = int(v_hk.z + 0.5);
  vec2 p = v_local;
  float cov = 0.0;
  if (kind == ${KIND.ellipse}) {
    // p0: radii, blur (sigma, px)
    cov = soft(ellipse(p, v_p0.xy), v_p0.z);
  } else if (kind == ${KIND.ring}) {
    // p0: radii, half its width, blur; p1: dash, gap (px along it, no dash: solid), where its arc starts and ends (a1 <= a0: whole)
    float d = abs(ellipse(p, v_p0.xy)) - v_p0.z;
    cov = v_p0.w > 0.0 ? soft(d, v_p0.w) : aa(d);
    float a = atan(p.y / v_p0.y, p.x / v_p0.x);
    if (v_p1.w > v_p1.z) {
      float m = mod(a - v_p1.z, 6.2831853);
      cov *= step(m, v_p1.w - v_p1.z);
    }
    if (v_p1.x > 0.0) {
      float t = mod((a + 3.14159265) * 0.5 * (v_p0.x + v_p0.y), v_p1.x + v_p1.y);
      cov *= clamp(0.5 + min(t, v_p1.x - t) * u_dpr, 0.0, 1.0);
    }
  } else if (kind == ${KIND.line}) {
    // p0: half its length (along x), half its width, dash, gap (px; no dash: solid); p1: phase, round ends
    vec2 q = vec2(max(abs(p.x) - v_p0.x, 0.0), p.y);
    cov = v_p1.y > 0.5 ? aa(length(q) - v_p0.y) : aa(max(abs(p.x) - v_p0.x, abs(p.y) - v_p0.y));
    if (v_p0.z > 0.0) {
      float t = mod(p.x + v_p0.x + v_p1.x, v_p0.z + v_p0.w);
      float r = v_p1.y > 0.5 ? v_p0.y : 0.0;
      cov *= clamp(0.5 + (min(t + r, v_p0.z + r - t)) * u_dpr, 0.0, 1.0);
    }
  } else if (kind == ${KIND.glow}) {
    // light that falls off to nothing at the radii p0; laid with the add blend
    float k = length(p / v_p0.xy);
    cov = clamp(1.0 - k, 0.0, 1.0);
    cov = cov * cov;
  }
  o = v_col * cov;
}`;

// The moving sea (art.js paintSea and its swash), per pixel: each pixel finds where it lies on the
// ground, along which ray from the island's middle and how far out, then lays every wave near it.
const SEA_MAX = 10; // waves at once (with their swash)
const SEA_FS = `${HEAD}
in vec2 v_uv;
in vec2 v_px;
uniform vec2 u_ground0;     // ground point at the canvas' top left (px 0, 0)
uniform mat2 u_toGround;    // px -> ground
uniform sampler2D u_rays;   // per ray: coast, beach edge, far radius, lag (RGBA32F, N x 1)
uniform float u_n;          // rays
uniform sampler2D u_shallows;
uniform float u_shallowHalf;
uniform sampler2D u_shore;
uniform float u_shoreHalf;
uniform float u_t;
uniform vec4 u_wave[${SEA_MAX}];   // per wave: n, h1, h2, h3
uniform int u_waves;
uniform float u_deep;
out vec4 o;
const float B = ${SEA.beach.toFixed(4)};
const float FAR = ${SEA.far.toFixed(4)};
const float PERIOD = ${SEA.period.toFixed(4)};
const float LIFE = ${SEA.life.toFixed(4)};
const float SWASH = ${SEA.swash.toFixed(4)};
vec4 ray(float a) {
  float fi = a / 6.2831853 * u_n;
  float i0 = floor(fi);
  float f = fi - i0;
  int a0 = int(mod(i0, u_n));
  int a1 = int(mod(i0 + 1.0, u_n));
  return mix(texelFetch(u_rays, ivec2(a0, 0), 0), texelFetch(u_rays, ivec2(a1, 0), 0), f);
}
float radius(vec4 R, float d) {
  return d <= B ? max(R.x + 0.03, R.y - (B - d)) : mix(R.y, R.z, clamp((d - B) / 2.6, 0.0, 1.0)) + (d - B);
}
float waveDist(float p) { return B + 0.035 + (FAR - B) * pow(1.0 - clamp(p, 0.0, 1.0), 1.35); }
// a line of light (or dark) of width w (ground units) at radius rn, over pixels fw wide
float band(float r, float rn, float w, float fw) { return clamp(0.5 - (abs(r - rn) - w * 0.5) / fw, 0.0, 1.0); }
vec4 lay(vec4 c, vec3 col, float a) { return vec4(c.rgb * (1.0 - a) + col * a, 1.0); }
void main() {
  vec2 g = u_ground0 + u_toGround * v_px;
  float r = length(g);
  float a = atan(g.y, g.x);
  if (a < 0.0) a += 6.2831853;
  vec4 R = ray(a);
  float fw = max(fwidth(r), 1e-4);
  vec3 deep = vec3(u_deep);
  vec4 c = vec4(deep, 1.0);
  // the shallows: the water lightens toward the beach
  vec2 su = g / (2.0 * u_shallowHalf) + 0.5;
  if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
    vec4 s = texture(u_shallows, su);
    c.rgb = c.rgb * (1.0 - s.a) + s.rgb;
  }
  // waves rolling in, the farthest first
  for (int k = 0; k < ${SEA_MAX}; k++) {
    if (k >= u_waves) break;
    vec4 W = u_wave[k];
    float pm = (u_t - W.x * PERIOD + R.w) / LIFE;
    if (pm < 0.0 || pm >= 1.0) continue;
    float rn = radius(R, waveDist(pm));
    if (abs(r - rn) > 0.35) continue;
    float fade = clamp(pm / 0.25, 0.0, 1.0) * clamp((1.0 - pm) / 0.05, 0.0, 1.0);
    float amp = 0.05 * (1.0 - pm) + 0.006;
    float n3 = mod(W.x, 3.0), n4 = mod(W.x, 4.0);
    float wob = sin(a * (3.0 + n3) + W.y) * 0.55 + sin(a * (7.0 + n4) + W.z) * 0.3 + sin(a * 17.0 + W.w) * 0.15;
    float gap = sin(a * 9.0 + W.w) * 0.6 + sin(a * 21.0 + W.y) * 0.4;
    float wo = amp * wob;
    // a swell: a soft lit face toward the shore and a darker trough behind it
    c = lay(c, vec3(0.0), 0.1 * fade * band(r, radius(R, waveDist(pm) + 0.08) + wo, 0.12, fw));
    c = lay(c, vec3(190.0, 196.0, 202.0) / 255.0, (0.022 + 0.04 * pm) * fade * band(r, radius(R, waveDist(pm) - 0.015) + wo, 0.09 - 0.05 * pm, fw));
    // then a crest that sharpens and whitens as it nears the shore, broken until it closes up
    if (pm > 0.42 && gap >= 0.1 - 1.3 * pm) {
      float kk = (pm - 0.42) / 0.58, rc = rn + wo;
      c = lay(c, vec3(176.0, 182.0, 188.0) / 255.0, 0.32 * kk * fade * band(r, rc, 0.016 + 0.014 * kk, fw));
      if (pm > 0.8) {
        float b = (pm - 0.8) / 0.2;
        c = lay(c, vec3(240.0, 242.0, 244.0) / 255.0, 0.7 * b * fade * band(r, rc, 0.014 + 0.03 * b, fw));
      }
    }
  }
  // the shore: beach, wet sand, lantern light
  vec2 bu = g / (2.0 * u_shoreHalf) + 0.5;
  if (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) {
    vec4 s = texture(u_shore, bu);
    c.rgb = c.rgb * (1.0 - s.a) + s.rgb;
  }
  // each wave that has broken runs up the beach and slides back, leaving the sand dark a moment
  if (r < R.y + 0.06 && r > R.x - 0.05) {
    for (int k = 0; k < ${SEA_MAX}; k++) {
      if (k >= u_waves) break;
      vec4 W = u_wave[k];
      float sm = ((u_t - W.x * PERIOD + R.w) / LIFE - 1.0) * LIFE / SWASH;
      if (sm < 0.0 || sm >= 1.0) continue;
      float run = 0.11 + 0.06 * fract(sin(W.x * 127.1 + 4.0 * 311.7) * 43758.5453);
      float up = sm < 0.4 ? 1.0 - pow(1.0 - sm / 0.4, 3.0) : 1.0 - pow((sm - 0.4) / 0.6, 1.6);
      float n3 = mod(W.x, 3.0), n4 = mod(W.x, 4.0);
      float wob = sin(a * (3.0 + n3) + W.y) * 0.55 + sin(a * (7.0 + n4) + W.z) * 0.3 + sin(a * 17.0 + W.w) * 0.15;
      float rEdge = radius(R, B - run * up) + 0.008 * wob;
      float rWet = radius(R, B - run * min(1.0, sm / 0.4));
      float rB = radius(R, B);
      float wet = clamp(0.5 + (r - rWet) / fw, 0.0, 1.0) * clamp(0.5 + (rB - r) / fw, 0.0, 1.0);
      c = lay(c, vec3(44.0, 36.0, 26.0) / 255.0, 0.3 * (1.0 - sm) * wet);
      float sheet = clamp(0.5 + (r - rEdge) / fw, 0.0, 1.0) * clamp(0.5 + (radius(R, B + 0.03) - r) / fw, 0.0, 1.0);
      c = lay(c, vec3(214.0, 220.0, 224.0) / 255.0, 0.26 * (1.0 - sm) * sheet);
      c = lay(c, vec3(248.0, 249.0, 250.0) / 255.0, 0.75 * (1.0 - sm) * (sm < 0.5 ? 1.0 : 0.6) * band(r, rEdge, 0.014, fw));
    }
  }
  o = vec4(c.rgb, 1.0);
}`;

/** The GPU board on a canvas, or null without WebGL2. onRestored() runs once a lost context is back. */
export function createGL(canvas, { onRestored = () => {} } = {}) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', ATTRS);
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const size = { w: 1, h: 1, dpr: 1 };
  let quadBuf = null;
  let quadVao = null;
  let progs = null;
  let lost = false;
  const textures = new Map(); // key -> { tex, w, h, source }
  const prims = new Float32Array(FLOATS * 2048);
  let used = 0;
  let seaState = null; // the sea's textures, made from an art.js sea once

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`ktan gl.js shader: ${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`ktan gl.js program: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  function init() {
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const prim = compile(PRIM_VS, PRIM_FS);
    prim.vao = gl.createVertexArray();
    prim.buf = gl.createBuffer();
    gl.bindVertexArray(prim.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, prim.buf);
    for (let i = 0; i < FLOATS / 4; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribDivisor(1 + i, 1);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
    }
    gl.bindVertexArray(null);
    progs = { quad: compile(QUAD_VS, QUAD_FS), quadA: compile(QUADA_VS, QUAD_FS), prim, sea: null };
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const t of textures.values()) t.tex = upload(null, t.source);
    if (seaState) {
      const sea = seaState.sea;
      seaState = null;
      useSea(sea);
    }
  }

  function upload(tex, source) {
    tex = tex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return tex;
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    init();
    onRestored();
  });
  init();

  /* ---------- Queued shapes ---------- */

  function push(x, y, rot, hx, hy, kind, col, p0, p1 = [0, 0, 0, 0], add = false) {
    if (used >= prims.length) flush();
    const d = prims;
    let i = used;
    const a = col[3] ?? 1;
    d[i++] = x; d[i++] = y; d[i++] = Math.cos(rot); d[i++] = Math.sin(rot);
    d[i++] = hx; d[i++] = hy; d[i++] = kind; d[i++] = add ? 1 : 0;
    d[i++] = (col[0] / 255) * a; d[i++] = (col[1] / 255) * a; d[i++] = (col[2] / 255) * a; d[i++] = add ? 0 : a;
    d[i++] = p0[0]; d[i++] = p0[1]; d[i++] = p0[2] ?? 0; d[i++] = p0[3] ?? 0;
    d[i++] = p1[0]; d[i++] = p1[1]; d[i++] = p1[2] ?? 0; d[i++] = p1[3] ?? 0;
    used = i;
  }

  // Shapes are drawn in runs that share a blend: over, or add for light.
  function flush() {
    if (!used) return;
    const P = progs.prim;
    gl.useProgram(P.p);
    gl.uniform2f(P.u.u_size, size.w, size.h);
    gl.uniform1f(P.u.u_dpr, size.dpr);
    gl.bindVertexArray(P.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.buf);
    gl.bufferData(gl.ARRAY_BUFFER, prims.subarray(0, used), gl.DYNAMIC_DRAW);
    const n = used / FLOATS;
    let start = 0;
    while (start < n) {
      const add = prims[start * FLOATS + 7] > 0.5;
      let end = start + 1;
      while (end < n && (prims[end * FLOATS + 7] > 0.5) === add) end++;
      gl.blendFunc(gl.ONE, add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      for (let i = 0; i < FLOATS / 4; i++) gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, start * FLOATS * 4 + i * 16);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - start);
      start = end;
    }
    gl.bindVertexArray(null);
    used = 0;
  }

  /* ---------- The sea ---------- */

  function useSea(sea) {
    if (seaState && seaState.sea === sea) return;
    const N = sea.rays.length;
    const data = new Float32Array(N * 4);
    sea.rays.forEach((ray, i) => {
      data[i * 4] = ray.r0;
      data[i * 4 + 1] = ray.rB;
      data[i * 4 + 2] = ray.rR;
      data[i * 4 + 3] = sea.lag[i];
    });
    const rays = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rays);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // numbers, not a picture: WebGL refuses raw data uploaded with the pictures' premultiplied alpha
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 1, 0, gl.RGBA, gl.FLOAT, data);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (!progs.sea) progs.sea = compile(QUAD_VS, SEA_FS);
    seaState = { sea, N, rays, shallows: upload(null, sea.shallows.c), shore: upload(null, sea.shore) };
  }

  /* ---------- Drawing ---------- */

  const api = {
    gl: true,
    get lost() {
      return lost;
    },
    /** Sizes the drawing buffer: w, h in CSS px. Returns whether it changed. */
    resize(w, h, dpr) {
      const W = Math.max(1, Math.round(w * dpr));
      const H = Math.max(1, Math.round(h * dpr));
      const changed = canvas.width !== W || canvas.height !== H || size.w !== w || size.h !== h;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      Object.assign(size, { w, h, dpr });
      return changed;
    },
    /** Keeps a picture (a canvas) under key, sending it to the GPU again when update is set. */
    texture(key, source, update = false) {
      if (lost) return;
      let t = textures.get(key);
      if (!t) {
        t = { tex: upload(null, source), source, w: source.width, h: source.height };
        textures.set(key, t);
      } else if (update || t.source !== source) {
        t.source = source;
        t.w = source.width;
        t.h = source.height;
        upload(t.tex, source);
      }
    },
    has: (key) => textures.has(key),
    drop(key) {
      const t = textures.get(key);
      if (!t) return;
      if (!lost) gl.deleteTexture(t.tex);
      textures.delete(key);
    },
    /** Starts a frame on the background colour (0..255 grey). */
    begin(grey = 11) {
      if (lost) return false;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(grey / 255, grey / 255, grey / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      used = 0;
      return true;
    },
    /** A kept picture laid at x, y (its top left), w x h, turned rot about its middle, at alpha a. */
    pic(key, x, y, w, h, { a = 1, rot = 0, mask = null } = {}) {
      const t = textures.get(key);
      if (!t || lost || a <= 0) return;
      flush();
      const P = progs.quad;
      gl.useProgram(P.p);
      gl.uniform2f(P.u.u_size, size.w, size.h);
      gl.uniform4f(P.u.u_rect, x + w / 2, y + h / 2, w / 2, h / 2);
      gl.uniform2f(P.u.u_axis, Math.cos(rot), Math.sin(rot));
      gl.uniform1f(P.u.u_alpha, a);
      if (mask) {
        gl.uniform4f(P.u.u_mask, mask[0], mask[1], mask[2], mask[3]);
        gl.uniform1f(P.u.u_maskW, mask[4]);
      } else gl.uniform1f(P.u.u_maskW, -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(P.u.u_tex, 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },
    /** A kept picture laid by an affine map: its top left at o, its top and left sides along ax, ay. */
    picA(key, o, ax, ay, { a = 1 } = {}) {
      const t = textures.get(key);
      if (!t || lost || a <= 0) return;
      flush();
      const P = progs.quadA;
      gl.useProgram(P.p);
      gl.uniform2f(P.u.u_size, size.w, size.h);
      gl.uniform2f(P.u.u_o, o[0], o[1]);
      gl.uniform2f(P.u.u_ax, ax[0], ax[1]);
      gl.uniform2f(P.u.u_ay, ay[0], ay[1]);
      gl.uniform1f(P.u.u_alpha, a);
      gl.uniform1f(P.u.u_maskW, -1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(P.u.u_tex, 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },
    /** A filled ellipse, its edge blurred by blur (px, a canvas shadowBlur of 2 sigma). */
    ellipse(x, y, rx, ry, rot, col, blur = 0) {
      const pad = blur * 2.5 + 1;
      push(x, y, rot, rx + pad, ry + pad, KIND.ellipse, col, [rx, ry, blur / 2, 0]);
    },
    /** An ellipse's outline, w px wide; dash/gap (px) dash it; an arc from a0 to a1 (radians) if given. */
    ring(x, y, rx, ry, rot, w, col, { dash = 0, gap = 0, blur = 0, a0 = 0, a1 = 0 } = {}) {
      const pad = w + blur * 2.5 + 1;
      push(x, y, rot, rx + pad, ry + pad, KIND.ring, col, [rx, ry, w / 2, blur / 2], [dash, gap, a0, a1]);
    },
    /** A line from (x0, y0) to (x1, y1), w px wide, round ends unless square; dash/gap (px) dash it. */
    line(x0, y0, x1, y1, w, col, { dash = 0, gap = 0, phase = 0, square = false } = {}) {
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) / 2;
      push((x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(dy, dx), l + w, w / 2 + 1, KIND.line, col, [l, w / 2, dash, gap], [phase, square ? 0 : 1]);
    },
    /** Light added to what's under it, falling off to nothing at rx, ry. */
    glow(x, y, rx, ry, rot, col) {
      push(x, y, rot, rx, ry, KIND.glow, col, [rx, ry, 0, 0], [0, 0, 0, 0], true);
    },
    /**
     * The sea, over the whole canvas: sea is an art.js sea (seaOf), ground0 the ground point at the
     * canvas' top left and toGround the 2 x 2 that takes a CSS px step to the ground (column major),
     * t the sea's time (s).
     */
    sea(sea, ground0, toGround, t) {
      if (lost) return;
      flush();
      useSea(sea);
      const P = progs.sea;
      gl.useProgram(P.p);
      gl.uniform2f(P.u.u_size, size.w, size.h);
      gl.uniform4f(P.u.u_rect, size.w / 2, size.h / 2, size.w / 2, size.h / 2);
      gl.uniform2f(P.u.u_axis, 1, 0);
      gl.uniform2f(P.u.u_ground0, ground0[0], ground0[1]);
      gl.uniformMatrix2fv(P.u.u_toGround, false, toGround);
      gl.uniform1f(P.u.u_n, seaState.N);
      gl.uniform1f(P.u.u_t, t);
      gl.uniform1f(P.u.u_deep, 11 / 255);
      gl.uniform1f(P.u.u_shallowHalf, sea.shallows.half);
      gl.uniform1f(P.u.u_shoreHalf, sea.half);
      // the waves that may show now, each with its own shape (art.js shapeOf's phases)
      const first = Math.floor((t - SEA.life - SEA.swash - 0.5) / SEA.period), last = Math.floor((t + 3.8) / SEA.period);
      const waves = new Float32Array(SEA_MAX * 4);
      let n = 0;
      for (let k = last; k >= first && n < SEA_MAX; k--, n++) {
        waves.set([k, hash(k, 1) * TAU, hash(k, 2) * TAU, hash(k, 3) * TAU], n * 4);
      }
      gl.uniform4fv(P.u.u_wave, waves);
      gl.uniform1i(P.u.u_waves, n);
      const unit = (i, tex, name) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(P.u[name], i);
      };
      unit(0, seaState.rays, 'u_rays');
      unit(1, seaState.shallows, 'u_shallows');
      unit(2, seaState.shore, 'u_shore');
      gl.disable(gl.BLEND);
      gl.bindVertexArray(quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      gl.enable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
    },
    end() {
      if (!lost) flush();
    },
  };
  return api;
}

/** The same calls on a 2D context: for screens without WebGL2. The sea is drawn by art.js. */
export function create2D(canvas, { paintSea } = {}) {
  const g = canvas.getContext('2d');
  const size = { w: 1, h: 1, dpr: 1 };
  const textures = new Map();
  const css = (c, k = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 1) * k})`;
  const flat = (x, y, rot, fn) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    fn();
    g.restore();
  };
  return {
    gl: false,
    lost: false,
    resize(w, h, dpr) {
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      const changed = canvas.width !== W || canvas.height !== H || size.w !== w;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      Object.assign(size, { w, h, dpr });
      return changed;
    },
    texture(key, source) {
      textures.set(key, source);
    },
    has: (key) => textures.has(key),
    drop: (key) => textures.delete(key),
    begin(grey = 11) {
      g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.fillStyle = `rgb(${grey},${grey},${grey})`;
      g.fillRect(0, 0, size.w, size.h);
      return true;
    },
    pic(key, x, y, w, h, { a = 1, rot = 0, mask = null } = {}) {
      const src = textures.get(key);
      if (!src || a <= 0) return;
      g.save();
      g.globalAlpha = a;
      if (mask) {
        const [ax, ay, bx, by, hw] = mask, dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * hw, ny = dx / l * hw;
        g.beginPath(); g.moveTo(ax + nx, ay + ny); g.lineTo(bx + nx, by + ny); g.lineTo(bx - nx, by - ny); g.lineTo(ax - nx, ay - ny); g.closePath(); g.clip();
      }
      g.translate(x + w / 2, y + h / 2);
      g.rotate(rot);
      g.drawImage(src, -w / 2, -h / 2, w, h);
      g.restore();
    },
    picA(key, o, ax, ay, { a = 1 } = {}) {
      const src = textures.get(key);
      if (!src || a <= 0) return;
      g.save();
      g.globalAlpha = a;
      g.transform(ax[0], ax[1], ay[0], ay[1], o[0], o[1]);
      g.drawImage(src, 0, 0, 1, 1);
      g.restore();
    },
    ellipse(x, y, rx, ry, rot, col, blur = 0) {
      flat(x, y, rot, () => {
        g.filter = blur > 0 ? `blur(${blur / 2}px)` : 'none';
        g.fillStyle = css(col);
        g.beginPath(); g.ellipse(0, 0, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2); g.fill();
        g.filter = 'none';
      });
    },
    ring(x, y, rx, ry, rot, w, col, { dash = 0, gap = 0, a0 = 0, a1 = 0 } = {}) {
      flat(x, y, rot, () => {
        g.strokeStyle = css(col); g.lineWidth = w;
        g.setLineDash(dash > 0 ? [dash, gap] : []);
        g.beginPath();
        if (a1 > a0) g.ellipse(0, 0, Math.max(0.01, rx), Math.max(0.01, ry), 0, a0, a1);
        else g.ellipse(0, 0, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      });
    },
    line(x0, y0, x1, y1, w, col, { dash = 0, gap = 0, phase = 0, square = false } = {}) {
      g.save();
      g.strokeStyle = css(col); g.lineWidth = w; g.lineCap = square ? 'butt' : 'round';
      g.setLineDash(dash > 0 ? [dash, gap] : []); g.lineDashOffset = -phase;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.restore();
    },
    glow(x, y, rx, ry, rot, col) {
      flat(x, y, rot, () => {
        g.scale(1, ry / Math.max(rx, 0.01));
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, css(col)); gr.addColorStop(1, css(col, 0));
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2);
      });
    },
    sea(sea, ground0, toGround, t, draw) {
      // draw(g, t): the caller lays the sea on the ground itself (art.js paintSea, through onGround)
      if (draw) draw(g, t);
      else if (paintSea) paintSea(g, sea, t);
    },
    end() {},
  };
}
