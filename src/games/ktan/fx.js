// What moves on a phone between the board, your hand and the others' chips (the proposals page's
// "Every phone is the table" and "Cards slip into the hand"): cards flying off a tile or a chip,
// the rolled number popping up over the board, the dice shaking in the board's corner. Each thing
// is a small canvas of its own, painted once and moved by the compositor (a big 2D canvas on the
// screen can show blurred on iPhones; small ones don't). One clock runs them all and stops when
// nothing moves. Under reduced motion every flight shows only its end.
import { bezier, cardCanvas, countCoin, drawDie, easeInOut, easeOut, paintRollNumber, rrectPath, softFill, getDPR } from './art.js';

const flyEase = bezier(0.45, 0.05, 0.4, 1);
export const DROP_EASE = bezier(0.2, 0.8, 0.25, 1.03);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

/** The layer: host is a fixed element over the whole screen (.ktan-fx). */
export function createFx(host, { reduce = () => false } = {}) {
  const items = new Set();
  let raf = 0;
  const now = () => performance.now() / 1000;

  function tick() {
    raf = 0;
    const t = now();
    for (const it of [...items]) {
      const a = t - it.t0;
      if (a < 0) {
        it.el.style.opacity = '0';
        continue;
      }
      const f = it.dur > 0 ? a / it.dur : 1;
      if (f >= 1) {
        items.delete(it);
        it.el.remove();
        it.done?.();
        continue;
      }
      it.step(f, a);
    }
    if (items.size) raf = requestAnimationFrame(tick);
  }
  const run = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  function canvas(w, h) {
    const dpr = getDPR();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    return { c, g };
  }

  function add(el, dur, delay, step, done) {
    el.style.opacity = '0';
    host.append(el);
    const it = { el, t0: now() + delay, dur, step, done };
    items.add(it);
    run();
    return it;
  }

  /**
   * A card on its way: kind ('wood'... 'knight', 'back'), from and to as [x, y, rot?] screen points
   * (its middle), its width growing from w0 to w1, bowing up by arc px, over dur s after delay s.
   * turn: it lands face up from its back. done() runs as it lands.
   */
  function card(kind, from, to, { w0 = 40, w1 = 40, dur = 0.9, delay = 0, arc = 40, turn = false, ease = flyEase, count, glow = 0, done } = {}) {
    if (reduce()) {
      setTimeout(() => done?.(), (delay + Math.min(dur, 0.25)) * 1000);
      return;
    }
    const W = Math.max(w0, w1) * 1.3, H = W * 1.4 + W * 0.3;
    const { c, g } = canvas(W, H);
    // both faces, painted once at the largest size it reaches
    const faces = [kind, turn ? 'back' : kind].map((k) => cardCanvas(k, Math.max(w0, w1)));
    let shown = -1;
    const paint = (face) => {
      if (face === shown) return;
      shown = face;
      const w = Math.max(w0, w1), h = w * 1.4, x = (W - w) / 2, y = (H - h) / 2;
      g.clearRect(0, 0, W, H);
      if (glow > 0) softFill(g, rrectPath(x, y, w, h, w * 0.12), `rgba(255,214,140,${0.55 * glow})`, w * 0.22);
      softFill(g, rrectPath(x + w * 0.04, y + w * 0.08, w, h, w * 0.12), 'rgba(0,0,0,0.5)', w * 0.1);
      g.drawImage(faces[face], x, y, w, h);
      if (count !== undefined && face === 0) countCoin(g, x + w - w * 0.035, y + h - w * 0.035, w * 0.135, String(count));
    };
    paint(turn ? 1 : 0);
    const r0 = from[2] ?? 0, r1 = to[2] ?? 0;
    return add(c, dur, delay, (f) => {
      const e = ease(f), lift = Math.sin(Math.PI * f);
      const x = lerp(from[0], to[0], e), y = lerp(from[1], to[1], e) - arc * lift;
      const s = lerp(w0, w1, e) / Math.max(w0, w1);
      let fx = 1;
      if (turn) {
        const fl = seg(f, 0.62, 1);
        fx = Math.max(0.03, Math.abs(Math.cos(Math.PI * fl)));
        paint(fl < 0.5 ? 1 : 0);
      }
      const r = lerp(r0, r1, easeInOut(clamp(f * 1.15, 0, 1)));
      c.style.opacity = '1';
      c.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(4)}rad) scale(${(s * fx).toFixed(4)}, ${s.toFixed(4)}) translate(${(-W / 2).toFixed(1)}px, ${(-H / 2).toFixed(1)}px)`;
    }, done);
  }

  /**
   * A card you drew: it rises face down from `from`, turns over large at `at` for you to see, holds
   * there a moment with a little light behind it, then goes to `to` (its place among your cards),
   * shrinking, and fading out on the way if `fade` (when its place is hidden under a panel).
   */
  function reveal(kind, from, at, to, { w0 = 30, w = 116, w1 = 50, hold = 0.95, fade = false, done } = {}) {
    const T1 = 0.8, T2 = T1 + hold, T3 = T2 + 0.62;
    const W = w * 1.5, H = w * 1.4 + w * 0.5;
    const { c, g } = canvas(W, H);
    const faces = [kind, 'back'].map((k) => cardCanvas(k, w));
    let shown = -1;
    const paint = (face) => {
      if (face === shown) return;
      shown = face;
      const h = w * 1.4, x = (W - w) / 2, y = (H - h) / 2;
      g.clearRect(0, 0, W, H);
      if (face === 0) softFill(g, rrectPath(x, y, w, h, w * 0.12), 'rgba(255,214,140,0.32)', w * 0.2);
      softFill(g, rrectPath(x + w * 0.04, y + w * 0.08, w, h, w * 0.12), 'rgba(0,0,0,0.5)', w * 0.1);
      g.drawImage(faces[face], x, y, w, h);
    };
    if (reduce()) {
      paint(0);
      c.style.transform = `translate(${at[0] - W / 2}px, ${at[1] - H / 2}px)`;
      return add(c, hold + 0.4, 0, () => (c.style.opacity = '1'), done);
    }
    paint(1);
    return add(c, T3, 0, (f, a) => {
      let x, y, sc, fx = 1, o = 1;
      if (a < T1) {
        const q = a / T1, e = flyEase(q), fl = seg(q, 0.45, 1);
        x = lerp(from[0], at[0], e);
        y = lerp(from[1], at[1], e) - 36 * Math.sin(Math.PI * q);
        sc = lerp(w0, w, e) / w;
        fx = Math.max(0.03, Math.abs(Math.cos(Math.PI * fl)));
        paint(fl < 0.5 ? 1 : 0);
      } else if (a < T2) {
        const q = a - T1;
        x = at[0];
        y = at[1] - 3 * Math.sin(q * 2.4);
        sc = 1 + 0.035 * Math.exp(-q * 5) * Math.sin(q * 16);
        paint(0);
      } else {
        const q = (a - T2) / (T3 - T2), e = flyEase(q);
        x = lerp(at[0], to[0], e);
        y = lerp(at[1], to[1], e) - 24 * Math.sin(Math.PI * q);
        sc = lerp(w, w1, e) / w;
        if (fade) o = 1 - seg(q, 0.55, 1);
      }
      c.style.opacity = String(o);
      c.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(sc * fx).toFixed(4)}, ${sc.toFixed(4)}) translate(${(-W / 2).toFixed(1)}px, ${(-H / 2).toFixed(1)}px)`;
    }, done);
  }

  /**
   * A card dropping in from above the screen onto a stack's top card (to: [x, y, rot]), slowing into
   * exactly the place it keeps (the proposals page's DROP): 0.55 s.
   */
  function drop(kind, to, w, { delay = 0, turn = false, done } = {}) {
    const side = to[0] < innerWidth / 2 ? -1 : 1;
    return card(kind, [innerWidth * 0.4 + (to[0] - innerWidth / 2) * 0.3, -w * 1.2, -0.22 * side], to, { w0: w, w1: w, dur: turn ? 0.82 : 0.55, delay, arc: 0, turn, ease: DROP_EASE, done });
  }

  /**
   * The rolled number where the dice stopped: it pops in, waits and fades (q from 0 to life). rot
   * turns it to face a seat at the table.
   */
  function number(n, x, y, R, { delay = 0, life = 1.45, rot = 0, done } = {}) {
    const { c, g } = canvas(R * 4, R * 3);
    g.translate(R * 2, R * 1.8);
    paintRollNumber(g, n, R);
    const turn = rot ? ` rotate(${rot.toFixed(4)}rad)` : '';
    if (reduce()) {
      c.style.transform = `translate(${x}px, ${y}px)${turn} translate(${-R * 2}px, ${-R * 1.8}px)`;
      return add(c, life, delay, () => (c.style.opacity = '1'), done);
    }
    return add(c, life + 0.4, delay, (f, a) => {
      const q = a, out = a - life;
      const fin = clamp(q / 0.45, 0, 1), grow = 0.35 + 0.65 * easeOut(fin) + 0.12 * Math.sin(Math.PI * fin);
      const o = out > 0 ? easeInOut(clamp(out / 0.4, 0, 1)) : 0, sc = grow * (1 - 0.25 * o);
      c.style.opacity = String(clamp(q / 0.12, 0, 1) * (1 - o));
      c.style.transform = `translate(${x}px, ${y}px)${turn} scale(${sc.toFixed(4)}) translate(${-R * 2}px, ${-R * 1.8}px)`;
    }, done);
  }

  /**
   * A card along a path of its own (the table's flights): pose(f, a) gives { x, y, rot, sc, a, flip,
   * lift, glow } for f from 0 to 1 over dur s (a in s), x, y its middle. flip (0 to 1) turns it over
   * from its back to its face, squeezing it at the half.
   */
  function path(kind, w, { dur = 1, delay = 0, pose, back = false, done } = {}) {
    if (reduce()) {
      setTimeout(() => done?.(), (delay + Math.min(dur, 0.3)) * 1000);
      return null;
    }
    const W = w * 1.6, H = w * 1.4 + w * 0.6;
    const { c, g } = canvas(W, H);
    const faces = [kind, 'back'].map((k) => cardCanvas(k, w * 1.15));
    let shown = '';
    const paint = (face, glow, lift) => {
      const key = `${face}|${glow.toFixed(2)}|${lift.toFixed(2)}`;
      if (key === shown) return;
      shown = key;
      const h = w * 1.4, x = (W - w) / 2, y = (H - h) / 2;
      g.clearRect(0, 0, W, H);
      if (glow > 0) softFill(g, rrectPath(x, y, w, h, w * 0.12), `rgba(255,214,140,${(0.55 * glow).toFixed(3)})`, w * 0.22);
      softFill(g, rrectPath(x + w * (0.04 + 0.1 * lift), y + w * (0.08 + 0.14 * lift), w, h, w * 0.12), `rgba(0,0,0,${(0.55 - 0.15 * lift).toFixed(3)})`, w * (0.1 + 0.14 * lift));
      g.drawImage(faces[face], x, y, w, h);
    };
    return add(c, dur, delay, (f, a) => {
      const P = pose(f, a);
      const flip = P.flip ?? (back ? 0 : 1), fx = Math.max(0.03, Math.abs(Math.cos(Math.PI * flip)));
      // the glow and the lift are painted in steps, so a card isn't painted again every frame
      paint(flip < 0.5 ? 1 : 0, Math.round((P.glow || 0) * 8) / 8, Math.round((P.lift || 0) * 4) / 4);
      const sc = P.sc ?? 1;
      c.style.opacity = String(P.a ?? 1);
      c.style.transform = `translate(${P.x.toFixed(1)}px, ${P.y.toFixed(1)}px) rotate(${(P.rot || 0).toFixed(4)}rad) scale(${(sc * fx).toFixed(4)}, ${sc.toFixed(4)}) translate(${(-W / 2).toFixed(1)}px, ${(-H / 2).toFixed(1)}px)`;
    }, done);
  }

  /** A word or a count rising off a point: +2, −4. */
  function rise(text, x, y, { delay = 0, size = 22, col = '#f2dca2', life = 1.6, rot = 0 } = {}) {
    const w = size * 4, h = size * 2;
    const { c, g } = canvas(w, h);
    g.font = `700 ${size}px ui-serif, "New York", "Iowan Old Style", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillText(text, w / 2 + 1.5, h / 2 + 2.5);
    g.fillStyle = col;
    g.fillText(text, w / 2, h / 2);
    return add(c, life, delay, (f, a) => {
      c.style.opacity = String(clamp(a / 0.15, 0, 1) * clamp((life - a) / 0.45, 0, 1));
      const up = reduce() ? 0 : a * (size * 0.55);
      // it rises the way its reader faces (up the screen, or away from their seat at the table)
      c.style.transform = `translate(${x}px, ${y}px) rotate(${rot.toFixed(4)}rad) translate(${-w / 2}px, ${-h / 2 - up}px)`;
    });
  }

  return {
    card, drop, reveal, number, rise, path,
    get busy() {
      return items.size > 0;
    },
    clear() {
      for (const it of items) it.el.remove();
      items.clear();
    },
  };
}

/**
 * The two dice in the board's corner: they shake for a second on every phone at once, then settle
 * on the roll. host: an element holding them; size: a die's width (px).
 */
export function createCornerDice(host, { reduce = () => false } = {}) {
  let faces = [5, 3];
  let size = 28;
  let raf = 0;
  const cvs = [0, 1].map(() => {
    const c = document.createElement('canvas');
    host.append(c);
    return c;
  });
  function draw(t) {
    const dpr = getDPR();
    const shaking = t !== null && t < 1 && !reduce();
    cvs.forEach((c, i) => {
      const box = size * 1.5;
      if (c.width !== Math.round(box * dpr)) {
        c.width = Math.round(box * dpr);
        c.height = Math.round(box * dpr);
        c.style.width = c.style.height = `${box}px`;
        c.style.margin = `${-size * 0.25}px`;
      }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, box, box);
      const face = shaking ? 1 + ((((t * 14) | 0) * (i ? 5 : 3) + i) % 6) : faces[i];
      const rot = shaking ? Math.sin(t * 40 + i * 2) * 0.35 * (1 - t) : i ? 0.08 : -0.1;
      const jx = shaking ? Math.sin(t * 33 + i) * 3 : 0, jy = shaking ? Math.cos(t * 29 + i) * 2 : 0;
      drawDie(g, box / 2 + jx, box / 2 + jy, size, face, 'dark', rot, shaking ? 0.2 : 0);
    });
  }
  draw(null);
  return {
    resize(s) {
      size = s;
      host.style.setProperty('--die', `${s * 1.5}px`);
      draw(null);
    },
    /** Shows the faces at rest. */
    set(f) {
      if (f) faces = f;
      cancelAnimationFrame(raf);
      draw(null);
    },
    /** Shakes for a second, then lands on f; done() runs as they settle. */
    roll(f, done) {
      faces = f;
      cancelAnimationFrame(raf);
      if (reduce()) {
        draw(null);
        done?.();
        return;
      }
      const t0 = performance.now();
      const step = (now) => {
        const t = (now - t0) / 1000;
        draw(t >= 1 ? null : t);
        if (t < 1) raf = requestAnimationFrame(step);
        else done?.();
      };
      raf = requestAnimationFrame(step);
    },
  };
}
