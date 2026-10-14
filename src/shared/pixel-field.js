// The install page's background: the app icon's field (fieldShade() in logo.js) laid across the
// whole page, with the mark lit white where the page's logo sits. The field runs on the logo's
// grid and stays whole under the text laid over it, only dimmer there, and its pixels blur out and
// back in at random (blurOut/blurIn, slowed down by .pixel-field's --t-blur): plenty of the
// field's at any moment and the mark's rarely. Nothing moves under reduced motion.
import { COLS, MARK_GREY, fieldShade } from './logo.js';
import { blurIn, blurOut } from './ui.js';

const TICK_MS = 80;
// The share of each group that steps away per second, and how long one stays out (ms) once faded.
// A quarter of the field is on its way out or back at any moment; the mark loses about one pixel.
const RATE = { field: 0.07, mark: 0.003 };
const HOLD = { field: [300, 1800], mark: [200, 700] };

// Pixels near a line of text dim so the words read, with no hole and no edge: the nearer the text,
// the dimmer, easing out over a few cells and a little uneven from pixel to pixel.
const UNDER_TEXT = 0.45; // the share of its grey a pixel right under the text keeps
const REACH = 3.5; // the cells over which that eases back to the full grey
const UNEVEN = 0.25;

const hex = (grey) => `#${grey.toString(16).padStart(2, '0').repeat(3)}`;
const jitter = (i, j) => ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000) / 1000;

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

/**
 * A field on layer (an empty, absolutely placed element at the page's top left), on the grid of
 * logo (a laid-out .logo that stays invisible). dim() lists the elements whose text the field dims
 * under.
 */
export function createPixelField(layer, logo, { dim = () => [] } = {}) {
  const groups = { field: [], mark: [] };
  const busy = new WeakSet();
  let timer = 0;
  let fade = 0;

  let drawn = '';

  function draw() {
    layer.style.height = '0';
    const page = document.documentElement;
    const width = page.clientWidth;
    const height = Math.max(page.scrollHeight, innerHeight);
    layer.style.height = `${height}px`;

    const box = logo.getBoundingClientRect();
    const pitch = (box.width * 4) / (COLS * 4 - 1); // a pixel is 3/4 of the pitch, the gap 1/4
    const dot = pitch * 0.75;
    const ox = box.left + scrollX;
    const oy = box.top + scrollY;
    // The lines of text, in cells from the logo's top left corner.
    const text = dim()
      .flatMap(lineBoxes)
      .map((b) => ({ left: (b.left - ox) / pitch, top: (b.top - oy) / pitch, right: (b.right - ox) / pitch, bottom: (b.bottom - oy) / pitch }));

    // A resize that moves nothing (iOS fires one as Safari's toolbar slides away) keeps the pixels,
    // so the ones blurred out come back in their own time.
    const layout = JSON.stringify([width, height, ox, oy, pitch, text]);
    if (layout === drawn && layer.firstChild) return;
    drawn = layout;

    layer.replaceChildren();
    layer.style.setProperty('--dot', `${dot}px`);
    groups.field = [];
    groups.mark = [];
    const frag = document.createDocumentFragment();
    for (let j = Math.floor(-oy / pitch); oy + j * pitch < height; j++) {
      for (let i = Math.floor(-ox / pitch); ox + i * pitch < width; i++) {
        const grey = fieldShade(i, j);
        const x = ox + i * pitch;
        const y = oy + j * pitch;
        if (grey === null) continue;
        const px = document.createElement('i');
        px.style.cssText = `left:${x.toFixed(2)}px;top:${y.toFixed(2)}px`;
        if (grey === MARK_GREY) {
          px.className = 'mark';
          groups.mark.push(px);
        } else {
          const share = Math.round(keep(i + 3 / 8, j + 3 / 8, text, jitter(i, j)) * 100);
          px.style.background = share < 100 ? `color-mix(in srgb, ${hex(grey)} ${share}%, var(--bg))` : hex(grey);
          groups.field.push(px);
        }
        frag.append(px);
      }
    }
    layer.append(frag);
  }

  function stepAway(list, [min, max]) {
    // A few tries at one that isn't already out.
    let el;
    for (let k = 0; k < 4 && (!el || busy.has(el)); k++) el = list[Math.floor(Math.random() * list.length)];
    if (!el || busy.has(el)) return;
    busy.add(el);
    blurOut(el);
    setTimeout(() => {
      blurIn(el);
      setTimeout(() => busy.delete(el), fade);
    }, fade + min + Math.random() * (max - min));
  }

  function tick() {
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const name of Object.keys(RATE)) {
      // Each group steps away at its rate on average: a whole number of pixels per tick, and the
      // fraction left over as a chance of one more.
      const due = (RATE[name] * groups[name].length * TICK_MS) / 1000;
      const count = Math.floor(due) + (Math.random() < due % 1 ? 1 : 0);
      for (let k = 0; k < count; k++) stepAway(groups[name], HOLD[name]);
    }
  }

  return {
    draw,
    start() {
      if (timer) return;
      const t = getComputedStyle(layer).getPropertyValue('--t-blur').trim();
      fade = parseFloat(t) * (t.endsWith('ms') ? 1 : 1000) || 0;
      timer = setInterval(tick, TICK_MS);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      layer.replaceChildren();
    },
  };
}
