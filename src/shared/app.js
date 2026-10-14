// Makes every page behave like an app, not a web page. The build adds this script and the
// viewport meta to every .html page (scripts/build.mjs), so no screen has to remember them.
// The CSS half (touch-action, no selection, no rubber-banding) lives in styles.css.

import { installIcons } from './icons.js';

// Every page's icons: the pixel sprite from shared/icons.js, which pages <use> by id.
installIcons();

// iOS Safari only applies :active styles when a touchstart listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });

// No zooming the app. iOS ignores user-scalable=no and still pinch-zooms, but cancelling its
// gesture events stops it; ctrl+wheel is a trackpad pinch on desktop.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}
document.addEventListener('wheel', (event) => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });

// Focus rings only for keyboard use. Browsers also draw them when a sheet opens or code moves
// focus after a tap; styles.css hides every outline unless the last input was a key.
const root = document.documentElement;
document.addEventListener('keydown', (event) => {
  if (!event.metaKey && !event.ctrlKey) root.dataset.input = 'keyboard';
}, true);
document.addEventListener('pointerdown', () => {
  root.dataset.input = 'pointer';
}, true);
