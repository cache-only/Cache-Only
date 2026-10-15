// The icons: pixel art on a 9 x 9 grid of the logo's rounded-square pixels. A pixel is 4 units
// with a gap of 1 (the logo's proportions), so a whole icon is 44 x 44 units. '#' is lit, '+' is
// dimmed and '.' is dark. The four corner pixels always stay dark: an .icon-btn's corners would
// cut them off. Shapes are solid, their details cut out. Lines (close, new, update, share) are one
// pixel. The one exception to the pixels is SHAPES below: Tanks' shell and mine.
//
// app.js puts every icon on every page as one sprite of <symbol id="i-<name>">, so a page only
// writes <svg class="icon"><use href="#i-name"/></svg>.

export const ICONS = {
  home: [
    '.........',
    '....#....',
    '...###...',
    '..#####..',
    '.#######.',
    '.#######.',
    '.###.###.',
    '.###.###.',
    '.........',
  ],
  games: [
    '.........',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.........',
    '.###.###.',
    '.###.###.',
    '.###.###.',
    '.........',
  ],
  settings: [
    '.........',
    '.#..#..#.',
    '.#.###.#.',
    '.#..#..#.',
    '.#..#.###',
    '###.#..#.',
    '.#..#..#.',
    '.#..#..#.',
    '.........',
  ],
  close: [
    '.........',
    '.#.....#.',
    '..#...#..',
    '...#.#...',
    '....#....',
    '...#.#...',
    '..#...#..',
    '.#.....#.',
    '.........',
  ],
  new: [
    '.........',
    '....#....',
    '....#....',
    '....#....',
    '.#######.',
    '....#....',
    '....#....',
    '....#....',
    '.........',
  ],
  play: [
    '.........',
    '...#.....',
    '...##....',
    '...###...',
    '...####..',
    '...###...',
    '...##....',
    '...#.....',
    '.........',
  ],
  update: [
    '.........',
    '...####..',
    '..#....#.',
    '.#....###',
    '.#.....#.',
    '.#.......',
    '..#....#.',
    '...####..',
    '.........',
  ],
  download: [
    '....#....',
    '....#....',
    '....#....',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
    '.........',
    '.#######.',
  ],
  share: [
    '....#....',
    '...###...',
    '..#.#.#..',
    '....#....',
    '.##.#.##.',
    '.#..#..#.',
    '.#.....#.',
    '.#.....#.',
    '.#######.',
  ],
  app: [
    '.........',
    '..#####..',
    '.#######.',
    '.##...##.',
    '.##.####.',
    '.##...##.',
    '.#######.',
    '..#####..',
    '.........',
  ],
  dots: [
    '.........',
    '....#....',
    '.........',
    '.........',
    '....#....',
    '.........',
    '.........',
    '....#....',
    '.........',
  ],
  undo: [
    '.........',
    '...#.....',
    '..##.....',
    '.######..',
    '..##...#.',
    '...#...#.',
    '.......#.',
    '...####..',
    '.........',
  ],
  redo: [
    '.........',
    '.....#...',
    '.....##..',
    '..######.',
    '.#...##..',
    '.#...#...',
    '.#.......',
    '..####...',
    '.........',
  ],
  erase: [
    '.........',
    '...######',
    '..#######',
    '.###.#.##',
    '#####.###',
    '.###.#.##',
    '..#######',
    '...######',
    '.........',
  ],
  pencil: [
    '.........',
    '......++.',
    '.....###.',
    '....###..',
    '...###...',
    '..###....',
    '.###.....',
    '.#.......',
    '.........',
  ],
  hint: [
    '...###...',
    '..#####..',
    '.##.####.',
    '.#######.',
    '.#######.',
    '..#####..',
    '...###...',
    '.........',
    '...###...',
  ],
  enter: [
    '.........',
    '.#######.',
    '##.#.#.##',
    '#########',
    '##.#.#.##',
    '#########',
    '###...###',
    '.#######.',
    '.........',
  ],
  warn: [
    '.........',
    '....#....',
    '...###...',
    '...#.#...',
    '..##.##..',
    '..#####..',
    '.###.###.',
    '#########',
    '.........',
  ],
  copy: [
    '.........',
    '.####....',
    '.####....',
    '.##......',
    '.##.####.',
    '....####.',
    '....####.',
    '....####.',
    '.........',
  ],
  sound: [
    '.........',
    '...#..#..',
    '..##...#.',
    '####.#.#.',
    '####.#.#.',
    '####.#.#.',
    '..##...#.',
    '...#..#..',
    '.........',
  ],
  flag: [
    '.........',
    '.#######.',
    '.######..',
    '.#####...',
    '.######..',
    '.#######.',
    '.#.......',
    '.#.......',
    '.#.......',
  ],
  list: [
    '.........',
    '.##.####.',
    '.........',
    '.##.####.',
    '.........',
    '.##.####.',
    '.........',
    '.##.####.',
    '.........',
  ],
  mirror: [
    '.........',
    '....#....',
    '.#.....#.',
    '.##.#.##.',
    '.###.###.',
    '.##.#.##.',
    '.#.....#.',
    '....#....',
    '.........',
  ],
  trash: [
    '.........',
    '...###...',
    '.#######.',
    '.........',
    '..#####..',
    '..#.#.#..',
    '..#.#.#..',
    '..#####..',
    '.........',
  ],
  // A die showing five: Tanks' Generate, a map at random.
  dice: [
    '.........',
    '.#######.',
    '.#.###.#.',
    '.#######.',
    '.###.###.',
    '.#######.',
    '.#.###.#.',
    '.#######.',
    '.........',
  ],
  // A two-headed arrow across the corners: a map's size.
  resize: [
    '.........',
    '.####....',
    '.##......',
    '.#.#.....',
    '.#..#..#.',
    '.....#.#.',
    '......##.',
    '....####.',
    '.........',
  ],
};

// Tanks' shell and mine are not pixel art: they stay smooth shapes on a 24 x 24 grid, solid while
// ready and outlined while in use (the -empty ones).
const SHELL = 'M7.7 13.3V20a2 2 0 0 0 2 2h4.6a2 2 0 0 0 2-2v-6.7Q16.3 7.3 12 2 7.7 7.3 7.7 13.3z';
const OUTLINE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"';
export const SHAPES = {
  shell: `<path d="${SHELL}"/>`,
  'shell-empty': `<path d="${SHELL}" ${OUTLINE}/>`,
  mine:
    '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 5.3a6.7 6.7 0 1 0 0 13.4' +
    'a6.7 6.7 0 1 0 0-13.4zM12 6.8a5.2 5.2 0 1 0 0 10.4a5.2 5.2 0 1 0 0-10.4zM12 9.8a2.2 2.2 0 1 0 0 4.4' +
    'a2.2 2.2 0 1 0 0-4.4z"/>',
  'mine-empty': `<circle cx="12" cy="12" r="8.1" ${OUTLINE}/>`,
};

const CELL = 4;
const PITCH = 5;
const R = 1.36; // the logo's corner: 34% of a pixel
const SIDE = CELL - 2 * R;
const DIM = 0.45;

/** One rounded-square pixel as a path, from its top-left corner. */
const pixel = (x, y) =>
  `M${x} ${y + R}a${R} ${R} 0 0 1 ${R}-${R}h${SIDE}a${R} ${R} 0 0 1 ${R} ${R}v${SIDE}` +
  `a${R} ${R} 0 0 1-${R} ${R}h-${SIDE}a${R} ${R} 0 0 1-${R}-${R}z`;

/** An icon's pixels as SVG markup: one path for the lit pixels, one for the dimmed ones. */
export function iconMarkup(rows) {
  const paths = { '#': '', '+': '' };
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch in paths) paths[ch] += pixel(x * PITCH, y * PITCH);
    });
  });
  return (
    (paths['#'] ? `<path d="${paths['#']}"/>` : '') +
    (paths['+'] ? `<path d="${paths['+']}" opacity="${DIM}"/>` : '')
  );
}

/** Puts every icon on the page as one hidden sprite, once. */
export function installIcons(doc = document) {
  if (doc.getElementById('pixel-icons')) return;
  const symbols =
    Object.entries(ICONS)
      .map(([name, rows]) => `<symbol id="i-${name}" viewBox="0 0 44 44">${iconMarkup(rows)}</symbol>`)
      .join('') +
    Object.entries(SHAPES)
      .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
      .join('');
  doc.body.insertAdjacentHTML(
    'afterbegin',
    `<svg id="pixel-icons" width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg>`,
  );
}
