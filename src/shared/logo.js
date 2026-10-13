// The Cache Only mark: 10 x 13 rounded-square pixels, drawn as a grid of spans so each pixel can
// come into focus on its own. Progress anywhere in the app is this logo going from blurred grey
// to sharp white, pixel by pixel, in a fixed pseudo-random order. Styles: .logo in styles.css.

export const MARK = [
  '.....##...',
  '...######.',
  '..########',
  '.###.##.##',
  '###..##...',
  '##...##...',
  '##...##...',
  '##...##...',
  '###..##...',
  '.###.##.##',
  '..########',
  '...######.',
  '.....##...',
];

const FLAT = MARK.join('').split('');
const LIT = FLAT.map((ch, i) => (ch === '#' ? i : -1)).filter((i) => i >= 0);
// The order the pixels come into focus: scattered, the same every time.
const RANK = new Map(
  LIT.slice()
    .sort((a, b) => ((a * 37) % 101) - ((b * 37) % 101))
    .map((idx, r) => [idx, r]),
);

/** A logo element. size: 'xs' | 'sm' | 'md' | 'lg'. glow: all white, for the blurred glow. */
export function createLogo({ size = 'sm', glow = false } = {}) {
  const el = document.createElement('span');
  el.className = `logo${size === 'sm' ? '' : ` logo-${size}`}${glow ? ' logo-glow' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < FLAT.length; i++) {
    const px = document.createElement('i');
    if (FLAT[i] === '#') {
      px.className = 'lit';
      px.dataset.rank = RANK.get(i);
    }
    el.append(px);
  }
  return el;
}

/** Brings the first p (0..1) of the pixels into focus; the rest stay blurred grey. */
export function setLogoProgress(logo, p) {
  const sharp = Math.round(Math.max(0, Math.min(1, p)) * LIT.length);
  for (const px of logo.querySelectorAll('i.lit')) {
    px.classList.toggle('soft', Number(px.dataset.rank) >= sharp);
  }
}

/** Leaves the logo partly out of focus, in a fixed pattern (the browser tab: not installed yet). */
export function setLogoHaze(logo, haze = 3) {
  logo.querySelectorAll('i').forEach((px, i) => {
    if (!px.classList.contains('lit')) return;
    const x = i % 10;
    const y = Math.floor(i / 10);
    const step = (x * 7 + y * 13) % 5;
    px.style.filter = step ? `blur(${(step * haze) / 4}px)` : '';
    px.style.background = step > 2 ? '#8a8a8a' : '';
  });
}
