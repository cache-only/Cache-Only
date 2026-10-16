// Generation off the main thread, so a slow phone never freezes the UI.
import { ladder } from './generator.js';

self.onmessage = (event) => {
  const { id, seed } = event.data || {};
  try {
    self.postMessage({ id, result: ladder(seed) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
