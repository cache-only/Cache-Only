// A card up close (the proposals page's CardInspect): a tap on any card lifts it out of its stack to
// the front over a blurred veil, like a collectible in a sleeve. Dragging tilts it under the finger
// (about 20 by 16 degrees) with a glare that follows; on release it springs back. A hard sideways
// swipe (over 60 px, faster than 0.65 px a millisecond) flings it a half turn to its back; the
// arrow keys do the same. A sheet under it says what it is: a resource, where you earn it, what it
// builds and your rate at the bank, with Trade; a development card, what it does and Play; a square
// card, who holds it and what it takes. info(card) gives the words (game.js cardInfo).
import { t } from '../../shared/i18n.js';
import * as A from './art.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function createInspect(host, { reduce = () => false, info }) {
  let item = null;
  let turn = 0;
  let gesture = null;
  let lastFrom = null;
  const veil = el('button', 'ktan-inspect-veil');
  veil.type = 'button';
  veil.tabIndex = -1;
  veil.setAttribute('aria-label', t('ktan.putBack'));
  const shadow = el('div', 'ktan-inspect-shadow');
  const stage = el('div', 'ktan-inspect-stage');
  const lift = el('div', 'ktan-inspect-lift');
  const card = el('div', 'ktan-inspect-card');
  const front = el('div', 'ktan-inspect-face');
  const back = el('div', 'ktan-inspect-face ktan-inspect-back');
  const glare = el('div', 'ktan-inspect-glare');
  const sheen = el('div', 'ktan-inspect-sheen');
  const glareB = el('div', 'ktan-inspect-glare');
  front.append(glare, sheen);
  back.append(glareB);
  card.append(front, back);
  lift.append(card);
  stage.append(lift);
  card.setAttribute('role', 'img');
  const sheet = el('div', 'sheet-inner');
  sheet.setAttribute('role', 'dialog');
  host.append(veil, shadow, stage, sheet);

  // Where the card sits: centred in the room over the sheet, 170 wide on a phone (210 square).
  function place() {
    const W = innerWidth, H = innerHeight, land = W > H * 1.08;
    const sq = !!item?.square;
    const sh = sheet.getBoundingClientRect().height || H * 0.45;
    const top = 24, room = Math.max(160, H - sh - top - 20);
    let w = sq ? 210 : 170;
    w = Math.min(w, (sq ? room : room / 1.4) * 0.84, land ? W * 0.3 : W * 0.6);
    const h = sq ? w : w * 1.4;
    Object.assign(stage.style, { top: `${top}px`, height: `${room}px` });
    Object.assign(lift.style, { left: `${(W - w) / 2}px`, top: `${(room - h) / 2}px`, width: `${w}px`, height: `${h}px` });
    Object.assign(shadow.style, { left: `${(W - w * 1.1) / 2}px`, top: `${top + (room + h) / 2 + 6}px`, width: `${w * 1.1}px` });
    return w;
  }

  function faces(w) {
    const sq = !!item.square;
    const pair = sq ? [A.awardCanvas(item.kind, w), A.awardCanvas('back', w)] : [A.cardCanvas(item.kind, w, { tag: item.fresh ? t('ktan.new') : undefined }), A.cardCanvas(item.kind === 'back' ? 'knight' : 'back', w)];
    [front, back].forEach((f, i) => {
      let cv = f.querySelector('canvas');
      if (!cv) {
        cv = document.createElement('canvas');
        f.prepend(cv);
      }
      cv.width = pair[i].width;
      cv.height = pair[i].height;
      cv.getContext('2d').drawImage(pair[i], 0, 0);
    });
  }

  // The tokens of the tiles a resource comes in on for you, each with how many cards it gives.
  function earnedEl(list) {
    const dpr = A.getDPR(), w = list.length * 56, h = 62;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    list.forEach(({ num, n }, i) => {
      const cx = 27 + i * 56;
      g.save();
      g.translate(cx, 22);
      g.scale(52, 52);
      A.paintToken(g, num, false);
      g.restore();
      g.font = '500 11px ui-monospace, "SF Mono", Menlo, monospace';
      g.textAlign = 'center';
      g.fillStyle = '#efefef';
      g.fillText(n === 2 ? t('ktan.x2city') : '×1', cx, 58);
    });
    c.setAttribute('aria-hidden', 'true');
    return c;
  }
  function buildsEl(list, player) {
    const dpr = A.getDPR(), w = list.length * 42, h = 48;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    list.forEach((b, i) => {
      const cx = 21 + i * 42;
      if (b === 'dev') A.drawCardAt(g, 'back', cx - 12, 7, 24);
      else A.pieceAt(g, b, cx, 42, b === 'road' ? 40 : b === 'city' ? 48 : 52, player?.color || '#efefef', player?.mark || 'diamond');
    });
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  function fill() {
    const d = info(item) || {};
    sheen.style.opacity = item.square || A.DEV[item.kind] ? '1' : '0.55';
    card.setAttribute('aria-label', t('ktan.cardUp', { name: d.title || '' }));
    sheet.setAttribute('aria-label', d.title || '');
    const head = el('div', 'sheet-head');
    head.append(el('p', 'eyebrow', d.brow || ''));
    const x = el('button', 'icon-btn');
    x.type = 'button';
    x.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
    x.setAttribute('aria-label', t('ktan.putBack'));
    x.addEventListener('click', close);
    head.append(x);
    const parts = [head, el('h2', 'ktan-inspect-title', d.title || ''), el('p', 't-body', d.text || '')];
    if (d.earned) {
      const boxes = el('div', 'ktan-cells');
      boxes.style.gridTemplateColumns = 'minmax(0, 1.25fr) minmax(0, 1fr)';
      const a = el('div', 'card');
      a.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;min-width:0;background:rgba(255,255,255,0.07)';
      a.append(el('span', 'eyebrow', t('ktan.earnedOn')));
      a.append(d.earned.length ? earnedEl(d.earned) : el('span', 't-note', t('ktan.noneYet')));
      const b = el('div', 'card');
      b.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px;min-width:0;background:rgba(255,255,255,0.07)';
      b.append(el('span', 'eyebrow', t('ktan.builds')), buildsEl(d.builds || [], d.player), el('span', 'eyebrow', t('ktan.bankRate', { rate: `${d.rate}:1` })));
      boxes.append(a, b);
      parts.push(boxes);
    }
    if (d.facts?.length) {
      const dl = el('dl', 'facts');
      for (const [k, v] of d.facts) dl.append(el('dt', '', k), el('dd', '', v));
      parts.push(dl);
    }
    if (d.note) parts.push(el('p', 't-note', d.note));
    if (d.action) {
      const go = el('button', 'btn btn-primary btn-block', d.action.label);
      go.type = 'button';
      go.disabled = !!d.action.disabled;
      go.addEventListener('click', () => {
        close();
        d.action.run();
      });
      parts.push(go);
    }
    sheet.replaceChildren(...parts);
  }

  function tilt(rx, ry, gx, gy, how) {
    card.style.transition = how === 'drag' ? 'transform 80ms linear' : how === 'fling' ? 'transform 850ms cubic-bezier(.15,.9,.25,1.12)' : 'transform 700ms cubic-bezier(.2,.9,.25,1.25)';
    if (reduce() && how !== 'drag') card.style.transition = 'none';
    card.style.transform = `rotateX(${rx.toFixed(1)}deg) rotateY(${(ry + turn).toFixed(1)}deg)`;
    const backUp = Math.round(turn / 180) % 2 !== 0;
    glare.style.background = `radial-gradient(circle at ${gx.toFixed(0)}% ${gy.toFixed(0)}%, rgba(255,248,230,${backUp ? 0 : 0.38}), rgba(255,248,230,0) 48%)`;
    glareB.style.background = `radial-gradient(circle at ${(100 - gx).toFixed(0)}% ${gy.toFixed(0)}%, rgba(255,236,190,0.22), rgba(255,236,190,0) 50%)`;
    sheen.style.backgroundPosition = `${(100 - gx).toFixed(0)}% 0`;
    shadow.style.transform = `translateX(${(-ry * 1.4).toFixed(1)}px) scaleX(${(1 - Math.abs(ry) / 160).toFixed(3)})`;
    shadow.style.opacity = (0.85 - Math.abs(rx) / 90).toFixed(2);
  }

  /** Lifts a card ({ kind, square?, fresh? }) out of the element it was picked up from. */
  function show(it, from) {
    item = it;
    turn = 0;
    host.classList.toggle('is-square', !!it.square);
    host.hidden = false;
    fill();
    const w = place();
    faces(w);
    tilt(0, 0, 50, 30, 'spring');
    if (!reduce()) {
      if (from) {
        const a = from.getBoundingClientRect(), b = lift.getBoundingClientRect();
        const fx = a.left + a.width / 2 - (b.left + b.width / 2), fy = a.top + a.height / 2 - (b.top + b.height / 2), s0 = clamp(Math.min(a.width / b.width, a.height / b.height), 0.12, 1);
        lift.animate([{ transform: `translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) scale(${s0.toFixed(3)}) rotate(-6deg)`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 550, easing: 'cubic-bezier(.2,.85,.25,1.15)' });
      }
      sheet.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    }
    lastFrom = from || null;
    sheet.querySelector('.icon-btn')?.focus({ preventScroll: true });
  }
  function close() {
    if (!item) return;
    item = null;
    host.hidden = true;
    if (lastFrom?.isConnected) lastFrom.focus({ preventScroll: true });
  }
  veil.addEventListener('click', close);
  host.addEventListener('keydown', (e) => {
    if (!item) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      turn += e.key === 'ArrowLeft' ? -180 : 180;
      tilt(0, 0, 50, 30, 'fling');
    }
  });
  stage.addEventListener('pointerdown', (e) => {
    gesture = { x: e.clientX, y: e.clientY, t: performance.now() };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!item || (e.pointerType !== 'mouse' && !gesture)) return;
    const r = card.getBoundingClientRect(), px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
    tilt(-(py - 0.5) * 32, (px - 0.5) * 40, px * 100, py * 100, 'drag');
  });
  const release = (e) => {
    const g = gesture;
    gesture = null;
    if (!item) return;
    const dx = g ? e.clientX - g.x : 0, dy = g ? e.clientY - g.y : 0, dt = g ? Math.max(1, performance.now() - g.t) : 1;
    const hard = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) / dt > 0.65;
    if (hard) turn += Math.sign(dx) * 180;
    tilt(0, 0, 50, 30, hard ? 'fling' : 'spring');
    if (!g || (Math.abs(dx) < 6 && Math.abs(dy) < 6 && performance.now() - g.t < 300)) {
      // a tap on the card itself does nothing; a tap beside it puts it back
      const r = card.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !gesture && item) tilt(0, 0, 50, 30, 'spring');
  });
  addEventListener('resize', () => {
    if (!item) return;
    faces(place());
  });
  return {
    show, close,
    get open() {
      return !!item;
    },
  };
}
