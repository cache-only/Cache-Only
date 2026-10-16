// Tanks: the field's ground, painted away from the page. A new layout (the phone turned) needs
// the whole field drawn again at the screen's pixel ratio, its light and shadows included, which
// takes a phone a good part of a second; render.js shows the arena at once from a quick picture
// and has this worker paint the sharp field meanwhile, so the page never stalls. Without workers
// or OffscreenCanvas, render.js runs paintField itself.
//
// The field layer is the field and the cell of wall round it, as drawGround draws them, on a
// canvas of its own that is anchored to the field, not the screen: moved on the screen by whole
// device pixels, it is still the same picture. Everything past it is plain wall (art.js
// drawBricks), and the marks of a battle (render.js) go on top.
import { drawGround } from './art.js';
import { cellAt, gridSize } from './rules.js';

/**
 * Paints the field layer of grid on 2D context c (cleared, w x h device px): matrix is the world's
 * transform onto it ([a, b, c, d, e, f], render.js fieldLayer), pal the art's palette. The ground
 * is drawn two cells past the field, so the light and shadows round the edge cells come out as
 * they do on the arena, and the canvas keeps the first of those cells.
 */
export function paintField(c, { grid, pal, matrix }) {
  const [cols, rows] = gridSize(grid);
  c.setTransform(...matrix);
  drawGround(c, pal, { cols, rows, kindAt: (col, r) => cellAt(grid, col, r), area: [-2, -2, cols + 4, rows + 4] });
}

// In a worker: each job is { id, w, h, grid, pal, matrix }; the reply is { id, bitmap }, or
// { id, error } when it can't be painted here (render.js paints it itself then).
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = ({ data: job }) => {
    try {
      const canvas = new OffscreenCanvas(job.w, job.h);
      paintField(canvas.getContext('2d', { willReadFrequently: true }), job);
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ id: job.id, bitmap }, [bitmap]);
    } catch (err) {
      self.postMessage({ id: job.id, error: String(err && err.message ? err.message : err) });
    }
  };
}
