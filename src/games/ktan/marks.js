// The players' marks and the trade's signs as inline SVG (24 x 24), for the parts of Ktan built
// from elements: chips, rows, the colours to pick, the table's bubbles. Their shapes are the ones
// art.js draws on canvas (markPath, TRADE_ICON, BUILD_ICON), so a mark reads the same everywhere.
import { BUILD_ICON, TRADE_ICON } from './art.js';

const star = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.2 : 10;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12.6 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

const MARKS = {
  diamond: TRADE_ICON.diamond,
  circle: TRADE_ICON.circle,
  triangle: TRADE_ICON.triangle,
  square: TRADE_ICON.square,
  plus: 'M8.6 3h6.8v5.6H21v6.8h-5.6V21H8.6v-5.6H3V8.6h5.6Z',
  star,
};
export const MARK_KINDS = Object.keys(MARKS);

/** A player's mark: diamond, circle, triangle, square, plus or star. */
export const markSvg = (kind) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${MARKS[kind] || MARKS.circle}"/></svg>`;

/** An answer or the trade's sign: check, cross, wait, trade. */
export const iconSvg = (kind) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TRADE_ICON[kind]}"/></svg>`;

/** A build's sign in a player's bubble at the table: settlement, city, road, dev, trade. */
export function signSvg(kind) {
  const I = BUILD_ICON[kind];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${I.backD ? `<path d="${I.backD}" opacity="0.38"/>` : ''}<path d="${I.mainD}" fill-rule="${I.rule}"/></svg>`;
}
