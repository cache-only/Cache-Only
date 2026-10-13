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

/**
 * Opens a sheet. A modal sheet covers the page; a docked one (a start screen or a result that
 * belongs to the game state) leaves the header and its side menu working around it.
 */
export function openSheet(dialog, { docked = false } = {}) {
  if (dialog.open) {
    if (dialog.classList.contains('sheet-docked') === docked) return;
    dialog.close();
  }
  dialog.classList.toggle('sheet-docked', docked);
  if (docked) dialog.show();
  else dialog.showModal();
}

export function closeSheet(dialog) {
  if (dialog.open) dialog.close();
}

// iOS: rotating while a sheet is scrolled (Tanks' start sheet scrolls in landscape once
// checkpoints are unlocked) can leave WebKit hit-testing at the old scroll offset, so every tap
// lands below where it looks: Start pressed the checkpoint under it and the home button stopped
// answering. After each resize, put the page and every open sheet back at the top, and make each
// sheet rebuild its scroller by dropping and restoring its overflow.
let settling = 0;
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
  // Once now and once more after iOS's rotation animation has finished resizing the page.
  settleScroll();
  settling = setTimeout(settleScroll, 400);
}
window.addEventListener('resize', settleSoon);
window.visualViewport?.addEventListener('resize', settleSoon);
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

/**
 * A game's side menu (.side-menu), opened and closed by the home button in its header. The
 * button keeps its home icon either way. Tapping beside the list closes it too. onOpen runs as
 * it opens, onClose as it closes.
 */
export function setupSideMenu(menu, button, { onOpen, onClose } = {}) {
  let hiding = 0;
  const isOpen = () => menu.classList.contains('open');
  function open() {
    if (isOpen()) return;
    clearTimeout(hiding);
    menu.hidden = false;
    void menu.offsetWidth; // start the transition from the closed look
    menu.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    onOpen?.();
  }
  function close() {
    if (!isOpen()) return;
    menu.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    hiding = setTimeout(() => (menu.hidden = true), 240);
    onClose?.();
  }
  button.setAttribute('aria-controls', menu.id);
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  menu.addEventListener('click', (event) => {
    if (!event.target.closest('.side-menu-list')) close();
  });
  return { open, close, isOpen };
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
