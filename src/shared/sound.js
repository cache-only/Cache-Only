// One sound switch for the whole app, in Settings, saved as gh:app:sound. Every game that makes
// a sound follows it.
import { createStore } from './storage.js';

const store = createStore('app');

export function soundOn() {
  return store.load('sound', 1) !== false;
}

export function setSoundOn(on) {
  store.save('sound', 1, !!on);
}

/**
 * Calls fn(on) now, and again whenever the switch may have changed: in another window of the
 * app, or while this page sat in the back/forward cache.
 */
export function watchSound(fn) {
  const update = () => fn(soundOn());
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === 'gh:app:sound') update();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) update();
  });
  update();
}
