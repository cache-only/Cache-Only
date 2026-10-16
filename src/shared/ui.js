// Shared UI helpers: sheets (native <dialog class="sheet">), a confirm sheet, the side menu,
// progressive-blur layers and board sizing. The styles for all of them are in /styles.css.
import { t } from './i18n.js';

/** Makes a modal sheet close when its backdrop is tapped. */
export function setupSheet(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !dialog.classList.contains('sheet-docked')) dialog.close('backdrop');
  });
  return dialog;
}

// A docked sheet is opened with show(), which gives it no ::backdrop, so one shared scrim stands
// in for it: the modal backdrop's dim, taking every tap on the page. styles.css shows it while a
// docked sheet is open and keeps only the header's home button above it.
let scrim = null;

/**
 * Opens a sheet. Every sheet dims the page behind it and takes its taps. A modal sheet covers the
 * whole page and closes on a tap beside it; a docked one (a start screen or a result that belongs
 * to the game state) stays put and leaves the header's home button, and so the side menu, working.
 */
export function openSheet(dialog, { docked = false } = {}) {
  if (dialog.open) {
    if (dialog.classList.contains('sheet-docked') === docked) return;
    dialog.close();
  }
  dialog.classList.toggle('sheet-docked', docked);
  if (docked) {
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'sheet-scrim';
      scrim.setAttribute('aria-hidden', 'true');
      document.body.append(scrim);
    }
    dialog.show();
  } else dialog.showModal();
}

export function closeSheet(dialog) {
  if (dialog.open) dialog.close();
}

// iOS: rotating while a sheet is scrolled (Tanks' start sheet scrolls in landscape once
// checkpoints are unlocked) can leave WebKit hit-testing at the old scroll offset, so every tap
// lands below where it looks: Start pressed the checkpoint under it and the home button stopped
// answering. As the phone turns, put the page and every open sheet back at the top, and make each
// sheet rebuild its scroller by dropping and restoring its overflow. Only then: a resize that
// keeps the page's width is Safari's toolbar sliding away or the keyboard coming up, and settling
// would pull a page being scrolled, or a sheet being typed in, back to its top.
let settling = 0;
let width = window.innerWidth;
function settleScroll() {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  for (const sheet of document.querySelectorAll('dialog.sheet[open]')) {
    sheet.scrollTop = 0;
    sheet.style.overflow = 'hidden';
    void sheet.offsetHeight;
    sheet.style.overflow = '';
  }
}
function settleSoon() {
  clearTimeout(settling);
  width = window.innerWidth;
  // Once now and once more after iOS's rotation animation has finished resizing the page.
  settleScroll();
  settling = setTimeout(settleScroll, 400);
}
function resized() {
  if (window.innerWidth !== width) settleSoon();
}
window.addEventListener('resize', resized);
window.visualViewport?.addEventListener('resize', resized);
screen.orientation?.addEventListener?.('change', settleSoon);

/** Whether a modal sheet covers the page (docked sheets don't count). */
export function modalOpen() {
  return !!document.querySelector('dialog[open]:not(.sheet-docked)');
}

/** Resolves true if the player confirms. */
export function confirmDialog(message, { ok = t('common.yes'), cancel = t('common.cancel') } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet';
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'sheet-inner';
    const text = document.createElement('p');
    text.className = 't-heading';
    text.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const no = document.createElement('button');
    no.className = 'btn';
    no.value = 'cancel';
    no.textContent = cancel;
    const yes = document.createElement('button');
    yes.className = 'btn btn-primary';
    yes.value = 'ok';
    yes.textContent = ok;
    actions.append(no, yes);
    form.append(text, actions);
    dialog.append(form);
    setupSheet(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    yes.focus();
  });
}

/** Progressive-blur layers: kind is 'top' | 'bottom' | 'tile' | 'left'. */
export function blurLayers(kind, className = '') {
  const el = document.createElement('span');
  el.className = `pblur pblur-${kind}${className ? ` ${className}` : ''}`;
  el.setAttribute('aria-hidden', 'true');
  const layers = kind === 'left' ? 4 : 3;
  for (let i = 0; i < layers; i++) el.append(document.createElement('i'));
  el.append(document.createElement('b'));
  return el;
}

/** Blur out: el fades away as it goes soft, and can't be touched until it blurs back in. */
export function blurOut(el) {
  el.classList.remove('blur-in');
  el.classList.add('blur-out');
}

/** Blur in: el fades back in as it comes into focus. */
export function blurIn(el) {
  el.classList.remove('blur-out');
  el.classList.add('blur-in');
  el.addEventListener('animationend', function done(event) {
    if (event.target !== el || event.animationName !== 'blur-in') return;
    el.classList.remove('blur-in');
    el.removeEventListener('animationend', done);
  });
}

const HOLD_MS = 500;

/**
 * A game's side menu (.side-menu), opened by the home button in its header. As the menu opens the
 * button blurs out, and it blurs back in as the menu closes (Resume, or a tap beside the list).
 * Holding the button for HOLD_MS goes straight back to the games, without waiting for the finger
 * to lift. onOpen runs as it opens, onClose as it closes.
 */
export function setupSideMenu(menu, button, { onOpen, onClose } = {}) {
  let hiding = 0;
  let holding = 0;
  let left = false;
  const isOpen = () => menu.classList.contains('open');
  function open() {
    if (isOpen()) return;
    clearTimeout(hiding);
    menu.hidden = false;
    void menu.offsetWidth; // start the transition from the closed look
    menu.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    blurOut(button);
    onOpen?.();
  }
  function close() {
    if (!isOpen()) return;
    menu.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    blurIn(button);
    hiding = setTimeout(() => (menu.hidden = true), 300);
    onClose?.();
  }
  button.setAttribute('aria-controls', menu.id);
  button.setAttribute('aria-expanded', 'false');
  // A thumb that drifts a little while holding must not turn into a pan, which cancels the hold.
  button.style.touchAction = 'none';
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    clearTimeout(holding);
    holding = setTimeout(() => {
      left = true;
      location.href = '/';
    }, HOLD_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button.addEventListener(type, () => clearTimeout(holding));
  }
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('pageshow', () => (left = false)); // back from the games, page kept
  button.addEventListener('click', () => {
    if (left) return; // the click that ends a hold
    if (isOpen()) close();
    else open();
  });
  menu.addEventListener('click', (event) => {
    if (!event.target.closest('.side-menu-list')) close();
  });
  return { open, close, isOpen };
}

/**
 * A slider (.slider, an empty element) over a row of steps: drag or tap anywhere on it, or use the
 * arrow keys once it has focus. setSteps(n, i) lays out n steps and puts the thumb on step i;
 * describe(thumb, text) writes the thumb's label and what a screen reader hears. onInput(i) runs
 * whenever the player moves it to another step.
 */
export function setupSlider(el, { onInput } = {}) {
  const thumb = document.createElement('span');
  thumb.className = 'slider-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  el.append(thumb);
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  let count = 0;
  let value = 0;
  let dragging = null;

  function place(i) {
    value = i;
    el.style.setProperty('--at', count > 1 ? i / (count - 1) : 0.5);
    el.setAttribute('aria-valuenow', String(i));
  }

  function move(i) {
    if (!count) return;
    const next = Math.max(0, Math.min(count - 1, i));
    if (next === value) return;
    place(next);
    onInput?.(next);
  }

  function stepAt(x) {
    const box = el.getBoundingClientRect();
    const w = parseFloat(getComputedStyle(el).getPropertyValue('--thumb-w')) || 48;
    const span = box.width - 8 - w;
    const at = span > 0 ? (x - box.left - 4 - w / 2) / span : 0.5;
    return Math.round(Math.max(0, Math.min(1, at)) * (count - 1));
  }

  el.addEventListener('pointerdown', (event) => {
    if (!count || el.getAttribute('aria-disabled') === 'true' || event.button > 0) return;
    dragging = event.pointerId;
    el.setPointerCapture?.(event.pointerId);
    move(stepAt(event.clientX));
  });
  el.addEventListener('pointermove', (event) => {
    if (event.pointerId === dragging) move(stepAt(event.clientX));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(type, (event) => {
      if (event.pointerId === dragging) dragging = null;
    });
  }
  el.addEventListener('keydown', (event) => {
    if (!count || el.getAttribute('aria-disabled') === 'true') return;
    const k = event.key;
    const to =
      k === 'ArrowLeft' || k === 'ArrowDown' ? value - 1
      : k === 'ArrowRight' || k === 'ArrowUp' ? value + 1
      : k === 'Home' ? 0
      : k === 'End' ? count - 1
      : null;
    if (to === null) return;
    event.preventDefault();
    event.stopPropagation();
    move(to);
  });

  return {
    setSteps(n, i = 0) {
      count = n;
      el.querySelectorAll('.slider-step').forEach((s) => s.remove());
      for (let k = 0; k < n; k++) {
        const step = document.createElement('span');
        step.className = 'slider-step';
        step.style.setProperty('--at', n > 1 ? k / (n - 1) : 0.5);
        el.insertBefore(step, thumb);
      }
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(Math.max(0, n - 1)));
      el.setAttribute('aria-disabled', String(!n));
      if (!n) thumb.textContent = '';
      place(Math.max(0, Math.min(n - 1, i)));
    },
    describe(label, text) {
      thumb.textContent = label;
      el.setAttribute('aria-valuetext', text);
    },
    value: () => value,
  };
}

/** Board sizing fallback for browsers without container query units. */
export function fitBoard(wrap, board) {
  if (window.CSS && CSS.supports('width', '1cqmin')) return;
  const fit = () => {
    const size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
    board.style.setProperty('--board-size', `${size}px`);
  };
  new ResizeObserver(fit).observe(wrap);
  fit();
}
