// Small shared UI helpers: sheets (native <dialog>) and a confirm prompt.
import { t } from './i18n.js';

/** Makes a <dialog> close when its backdrop is tapped. */
export function setupSheet(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('backdrop');
  });
  return dialog;
}

export function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
}

/** Resolves true if the player confirms. */
export function confirmDialog(message, { ok = t('common.yes'), cancel = t('common.cancel') } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet sheet-confirm';
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'sheet-inner';
    const text = document.createElement('p');
    text.className = 'confirm-text';
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
