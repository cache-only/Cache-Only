// The install page's background: the app icon's field (fieldShade() in logo.js) laid across the
// whole page, with the mark lit white where the page's logo sits. The field runs on the logo's
// grid and stays whole under the text laid over it, only dimmer there, and its pixels blur out and
// back in at random (the blur out and blur in of styles.css, slowed by .pixel-field's --t-blur):
// plenty of the field's at any moment and the mark's rarely. Nothing moves under reduced motion.
//
// The GPU draws it on one canvas, in one draw call a frame: each pixel works out from the time
// alone where it is in its own blur out and back, so a frame sets one number and nothing else.
// (A pixel per element, each animating its own filter, made a compositing layer of every pixel:
// a thousand on an iPhone and four times that on an iPad, which stalled Safari's Share sheet and
// lost the steps' glass.) Without WebGL the field is laid out as elements and stays still.
import { COLS, MARK_GREY, fieldShade } from './logo.js';

// The share of each group that steps away per second, and how long one stays out (s) once faded.
// A quarter of the field is on its way out or back at any moment; the mark loses about one pixel.
const RATE = { field: 0.07, mark: 0.003 };
const HOLD = { field: [0.3, 1.8], mark: [0.2, 0.7] };
// The blurs are slow: 30 frames a second look as smooth as 60, for half the work.
const FRAME_MS = 1000 / 30;
const MAX_DPR = 3;
const MAX_AREA = 16e6; // device pixels in the canvas, under what iOS allows one canvas

// Pixels near a line of text dim so the words read, with no hole and no edge: the nearer the text,
// the dimmer, easing out over a few cells and a little uneven from pixel to pixel.
const UNDER_TEXT = 0.45; // the share of its grey a pixel right under the text keeps
const REACH = 3.5; // the cells over which that eases back to the full grey
const UNEVEN = 0.25;

const jitter = (i, j) => ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000) / 1000;

// Each cell's own random numbers for its schedule, new on every visit but the same across layouts,
// so turning the phone leaves every pixel where it was in its blur.
const VISIT = (Math.random() * 2 ** 32) >>> 0;
function chance(i, j, k) {
  let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791) ^ VISIT) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

/** The boxes of the lines of text inside el, in page coordinates. */
function lineBoxes(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].map((r) => ({
    left: r.left + scrollX,
    top: r.top + scrollY,
    right: r.right + scrollX,
    bottom: r.bottom + scrollY,
  }));
}

/** How much of its grey a pixel centred at (x, y) keeps, near the boxes of text (all in cells). */
function keep(x, y, boxes, uneven) {
  let d = Infinity;
  for (const b of boxes) {
    d = Math.min(d, Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom)));
  }
  const t = Math.min(1, d / REACH);
  const ease = t * t * (3 - 2 * t);
  return Math.min(1, UNDER_TEXT + (1 - UNDER_TEXT) * ease + (uneven - 0.5) * UNEVEN * (1 - ease));
}

/** #rrggbb as [r, g, b], 0 to 255. */
function rgb(value, fallback) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  const n = hex ? parseInt(hex, 16) : fallback;
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** What the field takes from styles.css: the blur's timing, depth and easing, and its colours. */
function readLook(el) {
  const css = getComputedStyle(el);
  const get = (name) => css.getPropertyValue(name).trim();
  const fade = get('--t-blur');
  const ease = get('--ease').match(/-?[\d.]+/g)?.map(Number);
  return {
    fade: parseFloat(fade) / (fade.endsWith('ms') ? 1000 : 1) || 1,
    blur: parseFloat(get('--blur-fade')) || 0,
    ease: ease?.length === 4 ? ease : [0, 0, 1, 1],
    round: parseFloat(get('--r-pixel')) / 100 || 0.34,
    bg: rgb(get('--bg'), 0x0b0b0b),
    ink: rgb(get('--ink'), 0xefefef),
  };
}

/* ---------- On the GPU ---------- */

// A pixel is a quad of two triangles, each corner carrying the whole pixel: where it is, its colour
// and its schedule. Once a period (1 / its group's RATE) a pixel steps away at a random moment:
// it blurs out over the fade, stays out for a random hold, and blurs back in. The vertex shader
// works that out from the time and grows the quad to hold the blur; the fragment shader draws the
// rounded square, blurred as CSS's blur() would (a Gaussian of that radius).
const ATTRIBUTES = [
  ['a_corner', 2],
  ['a_centre', 2], // CSS px from the page's top left
  ['a_size', 2], // CSS px
  ['a_colour', 3], // 0 to 1
  ['a_when', 4], // period (s), phase, and the random numbers for when in a period and how long
  ['a_hold', 2], // the shortest hold (s), and how much longer it can be
];
const STRIDE = ATTRIBUTES.reduce((sum, [, size]) => sum + size, 0);
const CORNERS = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];

const VERT = `
attribute vec2 a_corner;
attribute vec2 a_centre;
attribute vec2 a_size;
attribute vec3 a_colour;
attribute vec4 a_when;
attribute vec2 a_hold;
uniform vec2 u_view;
uniform float u_scale;
uniform float u_time;
uniform float u_fade;
uniform float u_blur;
uniform float u_round;
uniform float u_motion;
uniform vec4 u_ease;
varying vec2 v_at;
varying vec2 v_half;
varying float v_corner;
varying float v_sigma;
varying vec4 v_colour;

float bezier(float a, float b, float s) {
  float r = 1.0 - s;
  return 3.0 * r * r * s * a + 3.0 * r * s * s * b + s * s * s;
}

// CSS's cubic-bezier(x1, y1, x2, y2) at x: Newton's method finds the curve's s for x.
float ease(float x) {
  float s = x;
  for (int k = 0; k < 6; k++) {
    float r = 1.0 - s;
    float dx = 3.0 * r * r * u_ease.x + 6.0 * r * s * (u_ease.z - u_ease.x) + 3.0 * s * s * (1.0 - u_ease.z);
    s = clamp(s - (bezier(u_ease.x, u_ease.z, s) - x) / max(dx, 0.0001), 0.0, 1.0);
  }
  return bezier(u_ease.y, u_ease.w, s);
}

void main() {
  float period = a_when.x;
  float t = u_time + a_when.y * period;
  float k = floor(t / period);
  float hold = a_hold.x + fract(a_when.w + k * 0.7548777) * a_hold.y;
  float s = t - k * period - fract(a_when.z + k * 0.618034) * max(period - 2.0 * u_fade - hold, 0.0);
  float gone = 0.0;
  if (s > 0.0 && s < u_fade) gone = ease(s / u_fade);
  else if (s >= u_fade && s <= u_fade + hold) gone = 1.0;
  else if (s > u_fade + hold && s < 2.0 * u_fade + hold) gone = 1.0 - ease((s - u_fade - hold) / u_fade);
  gone *= u_motion;

  float sigma = u_blur * gone;
  vec2 reach = a_size * 0.5 + 3.0 * sigma + 1.0 / u_scale;
  vec2 at = a_corner * reach;
  vec2 pos = a_centre + at;
  gl_Position = vec4(pos.x / u_view.x * 2.0 - 1.0, 1.0 - pos.y / u_view.y * 2.0, 0.0, 1.0);
  v_at = at * u_scale;
  v_half = a_size * 0.5 * u_scale;
  v_corner = u_round * min(a_size.x, a_size.y) * u_scale;
  v_sigma = sigma * u_scale;
  v_colour = vec4(a_colour, 1.0) * (1.0 - gone);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_at;
varying vec2 v_half;
varying float v_corner;
varying float v_sigma;
varying vec4 v_colour;

// Evan Wallace's blurred rounded rectangle (madebyevan.com/shaders/fast-rounded-rectangle-shadows):
// exact across x, and four samples of the Gaussian down y.
vec2 erf(vec2 x) {
  vec2 s = sign(x);
  vec2 a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  x *= x;
  return s - s / (x * x);
}

float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.506628 * sigma);
}

float blurredX(float x, float y, float sigma) {
  float delta = min(v_half.y - v_corner - abs(y), 0.0);
  float curved = v_half.x - v_corner + sqrt(max(0.0, v_corner * v_corner - delta * delta));
  vec2 integral = 0.5 + 0.5 * erf((x + vec2(-curved, curved)) * (0.7071068 / sigma));
  return integral.y - integral.x;
}

void main() {
  float cover = 0.0;
  if (v_sigma < 0.5) {
    // Sharp: the rounded square, its edge antialiased over a device pixel.
    vec2 q = abs(v_at) - v_half + v_corner;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - v_corner;
    cover = clamp(0.5 - d, 0.0, 1.0);
  } else {
    float from = clamp(-3.0 * v_sigma, v_at.y - v_half.y, v_at.y + v_half.y);
    float to = clamp(3.0 * v_sigma, v_at.y - v_half.y, v_at.y + v_half.y);
    float dy = (to - from) / 4.0;
    float y = from + dy * 0.5;
    for (int i = 0; i < 4; i++) {
      cover += blurredX(v_at.x, v_at.y - y, v_sigma) * gaussian(y, v_sigma) * dy;
      y += dy;
    }
  }
  gl_FragColor = v_colour * cover;
}
`;

/**
 * The field's canvas and what the GPU holds for it, or null where WebGL doesn't work. changed()
 * runs when the context is lost (live turns false) and when it comes back.
 */
function createGPU(changed) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const uniforms = {};
  let count = 0;
  let released = false;

  function setUp() {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    let offset = 0;
    for (const [name, size] of ATTRIBUTES) {
      const at = gl.getAttribLocation(program, name);
      if (at >= 0) {
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
      }
      offset += size;
    }
    for (const name of ['u_view', 'u_scale', 'u_time', 'u_fade', 'u_blur', 'u_round', 'u_motion', 'u_ease']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    count = 0;
    return true;
  }

  const gpu = {
    canvas,
    live: setUp(),

    /** Sizes the canvas to the field and hands the GPU its pixels. */
    load({ width, height, pixels }, look) {
      const [maxW, maxH] = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      const scale = Math.min(devicePixelRatio || 1, MAX_DPR, Math.sqrt(MAX_AREA / (width * height)), maxW / width, maxH / height);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);

      const data = new Float32Array(pixels.length * 6 * STRIDE);
      let n = 0;
      for (const p of pixels) {
        // Each edge on a device pixel, as the page lays out an element's box.
        const left = Math.round(p.x * scale) / scale;
        const top = Math.round(p.y * scale) / scale;
        const w = Math.round((p.x + p.size) * scale) / scale - left;
        const h = Math.round((p.y + p.size) * scale) / scale - top;
        const [lo, hi] = HOLD[p.group];
        const vertex = [
          0, 0, left + w / 2, top + h / 2, w, h,
          p.colour[0] / 255, p.colour[1] / 255, p.colour[2] / 255,
          1 / RATE[p.group], chance(p.i, p.j, 0), chance(p.i, p.j, 1), chance(p.i, p.j, 2),
          lo, hi - lo,
        ];
        for (let c = 0; c < CORNERS.length; c += 2) {
          vertex[0] = CORNERS[c];
          vertex[1] = CORNERS[c + 1];
          data.set(vertex, n);
          n += STRIDE;
        }
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      count = pixels.length * 6;

      gl.uniform2f(uniforms.u_view, width, height);
      gl.uniform1f(uniforms.u_scale, canvas.width / width);
      gl.uniform1f(uniforms.u_fade, look.fade);
      gl.uniform1f(uniforms.u_blur, look.blur);
      gl.uniform1f(uniforms.u_round, look.round);
      gl.uniform4fv(uniforms.u_ease, look.ease);
    },

    /** One frame at time (s); motion 0 shows every pixel sharp. */
    paint(time, motion) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform1f(uniforms.u_motion, motion);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },

    /** Gives the GPU's memory back, for good. */
    release() {
      released = true;
      gpu.live = false;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  if (!gpu.live) return null;

  canvas.addEventListener('webglcontextlost', (event) => {
    if (released) return;
    event.preventDefault(); // so it comes back
    gpu.live = false;
    changed();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (released) return;
    gpu.live = setUp();
    changed();
  });
  return gpu;
}

/* ---------- The field ---------- */

/**
 * A field on layer (an empty, absolutely placed element at the page's top left), on the grid of
 * logo (a laid-out .logo that stays invisible). dim() lists the elements whose text the field dims
 * under.
 */
export function createPixelField(layer, logo, { dim = () => [] } = {}) {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let look = null;
  let field = null; // the pixels as last laid out
  let drawn = '';
  let gpu; // createGPU()'s, made when first needed; null without WebGL
  let running = false;
  let frame = 0;
  let last = -Infinity;

  /** Where the field goes: the page's size, the logo's grid, and the lines of text in cells. */
  function measure() {
    layer.style.height = '0';
    const page = document.documentElement;
    const width = page.clientWidth;
    const height = Math.max(page.scrollHeight, innerHeight);
    layer.style.height = `${height}px`;

    const box = logo.getBoundingClientRect();
    const pitch = (box.width * 4) / (COLS * 4 - 1); // a pixel is 3/4 of the pitch, the gap 1/4
    const ox = box.left + scrollX;
    const oy = box.top + scrollY;
    // The lines of text, in cells from the logo's top left corner.
    const text = dim()
      .flatMap(lineBoxes)
      .map((b) => ({ left: (b.left - ox) / pitch, top: (b.top - oy) / pitch, right: (b.right - ox) / pitch, bottom: (b.bottom - oy) / pitch }));
    return { width, height, ox, oy, pitch, text };
  }

  function layOut({ width, height, ox, oy, pitch, text }) {
    const size = pitch * 0.75;
    const pixels = [];
    for (let j = Math.floor(-oy / pitch); oy + j * pitch < height; j++) {
      for (let i = Math.floor(-ox / pitch); ox + i * pitch < width; i++) {
        const grey = fieldShade(i, j);
        if (grey === null) continue;
        const pixel = { i, j, x: ox + i * pitch, y: oy + j * pitch, size };
        if (grey === MARK_GREY) {
          pixel.group = 'mark';
          pixel.colour = look.ink;
        } else {
          const share = Math.round(keep(i + 3 / 8, j + 3 / 8, text, jitter(i, j)) * 100) / 100;
          pixel.group = 'field';
          pixel.colour = look.bg.map((bg) => grey * share + bg * (1 - share));
        }
        pixels.push(pixel);
      }
    }
    return { width, height, size, pixels };
  }

  /** Without WebGL: every pixel an element, sharp and still. */
  function drawStill() {
    layer.style.setProperty('--dot', `${field.size}px`);
    const frag = document.createDocumentFragment();
    for (const p of field.pixels) {
      const px = document.createElement('i');
      px.style.cssText = `left:${p.x.toFixed(2)}px;top:${p.y.toFixed(2)}px;background:rgb(${p.colour.map(Math.round)})`;
      frag.append(px);
    }
    layer.replaceChildren(frag);
  }

  function paint(now) {
    last = now;
    gpu.paint(now / 1000, still.matches ? 0 : 1);
  }

  function loop() {
    if (frame || !running || !gpu?.live || still.matches) return;
    frame = requestAnimationFrame((now) => {
      frame = 0;
      if (!running || !gpu?.live) return;
      if (now - last > FRAME_MS - 4) paint(now);
      loop();
    });
  }

  function show() {
    if (gpu === undefined) {
      gpu = createGPU(() => {
        drawn = '';
        if (layer.firstChild) draw();
      });
    }
    if (gpu?.live) {
      gpu.load(field, look);
      if (layer.firstChild !== gpu.canvas) layer.replaceChildren(gpu.canvas);
      paint(performance.now());
      loop();
    } else {
      drawStill();
    }
  }

  // Draws the field where the page is now, in this frame (the page calls it from a
  // ResizeObserver, so a new layout never shows the old one). A resize that moves nothing (iOS
  // fires one as Safari's toolbar slides away) leaves it be.
  function draw() {
    look ??= readLook(layer);
    const where = measure();
    const layout = JSON.stringify(where);
    if (layout === drawn && layer.firstChild) return;
    drawn = layout;
    field = layOut(where);
    show();
  }

  still.addEventListener?.('change', () => {
    if (!gpu?.live || !field || !layer.firstChild) return;
    paint(performance.now());
    loop();
  });

  return {
    draw,
    start() {
      running = true;
      loop();
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
      gpu?.release();
      gpu = undefined;
      drawn = '';
      layer.replaceChildren();
    },
  };
}
