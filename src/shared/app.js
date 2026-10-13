// Makes every page behave like an app, not a web page. The build adds this script and the
// viewport meta to every .html page (scripts/build.mjs), so no screen has to remember them.
// The CSS half (touch-action, no selection, no rubber-banding) lives in styles.css.

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
