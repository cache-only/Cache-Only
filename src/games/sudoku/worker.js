// Generation and validation off the main thread, so Expert never freezes the UI.
import { analyze, generate } from './generator.js';

self.onmessage = (event) => {
  const { id, type } = event.data || {};
  try {
    const result = type === 'generate' ? generate(event.data.difficulty, event.data.seed) : analyze(event.data.text);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
