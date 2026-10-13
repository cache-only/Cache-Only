// What the Tanks field guide says about each enemy kind, and the little scene drawn on its
// card. Every number is read from TYPES and the constants in rules.js, so a stat change
// reaches the prose on the next `npm run guide`. Behaviour that lives in ai.js (sweep
// timing, the bank-shot search, mine rules, lead, the mortar's aim) and render.js (the
// white tank's fade) is written out by hand: update it here when that code changes.
// scripts/guide.mjs fails if an enemy kind has no entry.

const sp = (n) => n.toFixed(1);
const num = (n) => String(Number(n.toFixed(2)));
const pct = (n) => `${Math.round(n * 100)}%`;
const degs = (rad) => Math.round((rad * 180) / Math.PI);
const spread = (rad) => ((rad * 180) / Math.PI).toFixed(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const range = (t) => `${t.range[0]}–${t.range[1]}`;

/**
 * Text per enemy kind: { role, desc, perks, weak, scene }. `T` is TYPES, `kinds` is
 * ENEMY_KINDS, `R` holds rule constants (blastR, opening, missileTurn, missileFuel, lock,
 * bombFlight, bombR, bombMin, bombMax), `name(kind)` and `note(key)` read the English
 * strings from i18n.js.
 */
export function enemyText({ T, kinds, R, name, note }) {
  const P = T.player;
  const all = kinds.map((k) => T[k]);
  const lowest = (key, t) => t[key] === Math.min(...all.map((o) => o[key] ?? Infinity));
  const highest = (key, t) => t[key] === Math.max(...all.map((o) => o[key] ?? -Infinity));
  const rocket = (t) => t.weapon === 'rocket';
  const pace = (t) => {
    const r = t.speed / P.speed;
    if (r > 1.02) return `${sp(t.speed)} cells a second, faster than you`;
    if (r >= 0.9) return `${sp(t.speed)} cells a second, nearly your speed`;
    if (r >= 0.4 && r <= 0.6) return `about half your speed (${sp(t.speed)} cells a second)`;
    return `${sp(t.speed)} cells a second (you do ${sp(P.speed)})`;
  };
  const vsShell = (t) => {
    const r = t.shot / P.shot;
    if (r >= 1.9 && r <= 2.1) return 'twice the speed of a normal shell';
    if (r >= 1.6 && r < 1.9) return 'almost twice the speed of a normal shell';
    if (r < 1) return `slower than a normal shell (${sp(P.shot)})`;
    return `${r.toFixed(1)} times the speed of a normal shell`;
  };
  const ricochets = (t) => (t.bounces ? plural(t.bounces, 'ricochet', 'ricochets') : 'No ricochet');
  const leads = (t) => (t.lead ? `leads its shots by ${pct(t.lead)} of your motion` : 'aims straight at you');

  return {
    brown: (t) => ({
      role: 'Stationary turret',
      desc: `Never moves. Every 1.4 to 3.4 seconds its turret picks a new heading, usually within 40° of you and sometimes anywhere at all, then turns there at ${degs(t.turret)}° a second. It fires only when that line happens to cross you.`,
      perks: ['Stationary', 'Sweeping aim', ricochets(t), `Reload ${num(t.reload)} s`],
      weak: `${lowest('turret', t) ? 'The slowest turret in the game' : 'A slow turret'}, at ${degs(t.turret)}° a second. Keep moving and it rarely lines up a shot.`,
      scene: 'A brown tank on its pad with the arc its turret sweeps through.',
    }),
    ash: (t) => ({
      role: 'Patrol tank',
      desc: `The first enemy that drives. It moves at ${pace(t)}, aims straight at you and tries to stay ${t.range[0]} to ${t.range[1]} cells away along the route. ${t.bullets === 1 ? 'One shell at a time' : `${t.bullets} shells at a time`}, ${num(t.reload)} s between shots.`,
      perks: ['Direct aim', `Keeps ${range(t)} cells away`, `Dodges ${pct(t.dodge)}`],
      weak: `${t.bullets === 1 ? 'It can’t fire again until its one shell is gone, and it' : 'It'} notices only ${pct(t.dodge)} of the shells headed its way.`,
      scene: 'A grey tank driving across the floor and firing straight ahead.',
    }),
    marine: (t) => ({
      role: 'Rocket sniper',
      desc: `Fires rockets at ${sp(t.shot)} cells a second, ${vsShell(t)}, with a smoke trail behind them. ${t.bounces ? `They ricochet ${plural(t.bounces, 'time', 'times')}.` : 'Rockets don’t ricochet.'} It hangs back ${t.range[0]} to ${t.range[1]} cells, aims to within ${spread(t.spread)}° and ${leads(t)}.`,
      perks: ['Rockets', ricochets(t), `Accurate ±${spread(t.spread)}°`, t.lead ? `Leads ${pct(t.lead)}` : 'Direct aim'],
      weak: t.bounces
        ? `It stays ${t.range[0]} cells or more away, so it is slow to react when you close in.`
        : 'A rocket dies on the first wall it touches, so any block between you is full cover.',
      scene: 'A teal tank firing a rocket that trails smoke.',
    }),
    yellow: (t) => ({
      role: 'Minelayer',
      desc: `Moves at ${pace(t)}, and closes in to ${t.range[0]} to ${t.range[1]} cells. When it is 2 to 9 cells from you, with no ally or other mine close by, it drops a mine every few seconds, up to ${t.mines} on the ground at once. The discs on its rear deck show how many it has left.`,
      perks: [plural(t.mines, 'mine', 'mines'), `Speed ${sp(t.speed)}`, 'Direct aim', `Dodges ${pct(t.dodge)}`],
      weak: `Its mines go off when shot, and a blast destroys every tank within ${R.blastR} cells, the one that laid it included.`,
      scene: 'A yellow tank driving away from two mines it has dropped, with two discs left on its deck.',
    }),
    pink: (t) => ({
      role: 'Burst gunner',
      desc: `Keeps ${t.bullets} shells in the air with only ${num(t.reload)} s between shots, so it fires in bursts. It aims with bank shots: if a wall can bounce a shell into you, it will find that angle.`,
      perks: [`${t.bullets} shells at once`, `Reload ${num(t.reload)} s`, 'Bank shots', `Keeps ${range(t)} cells away`],
      weak: `A slow body at ${sp(t.speed)} cells a second. After a burst it has to wait for its shells to land.`,
      scene: 'A pink tank firing a burst of three shells that bounce off a wall over a block of cover.',
    }),
    green: (t) => ({
      role: 'Trick-shot turret',
      desc: `Stationary, but its rockets ricochet ${plural(t.bounces, 'time', 'times')}${lowest('spread', t) ? ' and it is the most accurate tank in the game' : ''}. It looks for a one-bounce shot off every wall face, and if none reaches you it tries 160 directions for a two-bounce shot.`,
      perks: ['Stationary', 'Rockets', ricochets(t), `${lowest('spread', t) ? 'Most accurate' : 'Accurate'} ±${spread(t.spread)}°`],
      weak: `It can’t move, dodge or run from mines, and it holds only ${plural(t.bullets, 'rocket', 'rockets')} at a time.`,
      scene: 'A green tank on its pad firing a rocket that bounces between two walls.',
    }),
    violet: (t) => ({
      role: 'Mirror tank',
      desc: `Carries nearly your loadout: ${t.bullets} shells, ${plural(t.mines, 'mine', 'mines')} and ${plural(t.bounces, 'ricochet', 'ricochets')}, and moves at ${pace(t)}. It uses bank shots, ${leads(t)}, thinks every ${num(t.think)} s and sidesteps ${pct(t.dodge)} of the shells headed its way.`,
      perks: [`${t.bullets} shells at once`, plural(t.mines, 'mine', 'mines'), 'Bank shots', t.lead ? `Leads ${pct(t.lead)}` : `Dodges ${pct(t.dodge)}`],
      weak: 'It decides once per shell whether it noticed it. A shell it missed stays unseen all the way in.',
      scene: 'A violet tank that has dropped a mine, firing shells that bank off a wall.',
    }),
    red: (t) => ({
      role: 'Missile tank',
      desc: `Fires guided missiles at ${sp(t.shot)} cells a second, ${vsShell(t)}. Each one turns toward you at up to ${degs(R.missileTurn)}° a second for its first ${num(R.missileFuel)} s, but only while you are within ${degs(R.lock)}° of its nose: once it has passed you it flies straight on. It fires only down a clear straight line, one missile at a time, and keeps ${t.range[0]} to ${t.range[1]} cells away. The light on its turret is lit while a missile is in the air.`,
      perks: ['Guided missiles', `Turns ${degs(R.missileTurn)}°/s`, ricochets(t), `Keeps ${range(t)} cells away`],
      weak: `A missile can’t turn tighter than a circle ${num(t.shot / R.missileTurn)} cells in radius, so a late sidestep makes it overshoot. It dies on the first wall it touches, and a shell that meets it head-on cancels both.`,
      scene: 'A red tank whose missile curves after you as you sidestep, its light lit.',
    }),
    white: (t) => ({
      role: 'Ghost',
      desc: `Built like Violet, except it fades out during the first 1.2 s of a mission. Its tread marks, shells and mines stay visible, and the mission banner warns you: “${note('tanks.note.white')}”`,
      perks: ['Invisible', `${t.bullets} shells at once`, plural(t.mines, 'mine', 'mines'), 'Bank shots'],
      weak: `Follow the fresh tread marks. It notices ${pct(t.dodge)} of shells${T.violet ? ` (Violet: ${pct(T.violet.dodge)})` : ''}.`,
      scene: 'A nearly invisible white tank, given away by its tread marks, a mine and its shell.',
    }),
    black: (t) => ({
      role: 'Hunter',
      desc: `${highest('speed', t) ? 'The fastest tank in the game' : 'A fast tank'} at ${sp(t.speed)} cells a second${t.speed > P.speed ? ', faster than you' : ''}. It fires ${rocket(t) ? 'rockets' : 'shells'}, ${t.bullets} at a time, and ${leads(t)}. It comes in close (${t.range[0]} to ${t.range[1]} cells), reacts in ${num(t.react)} s and sidesteps ${pct(t.dodge)} of shells.`,
      perks: [`${highest('speed', t) ? 'Fastest' : 'Speed'} ${sp(t.speed)}`, `${t.bullets} ${rocket(t) ? 'rockets' : 'shells'}`, t.lead ? `Leads ${pct(t.lead)}` : 'Direct aim', `Dodges ${pct(t.dodge)}`, plural(t.mines, 'mine', 'mines')],
      weak: t.bounces
        ? `Its shots ricochet, so cover only helps if no bounce line reaches you.`
        : `Its ${rocket(t) ? 'rockets' : 'shells'} never ricochet, so it can only fire down a clear straight line. Break line of sight and it can’t shoot.`,
      scene: 'A black tank racing forward, firing two rockets, with a mine behind it.',
    }),
    olive: (t) => ({
      role: 'Mortar',
      desc: `Never moves and has no gun. It lobs bombs over walls, crates, holes and tanks: each lands ${num(R.bombFlight)} s after launch on a mark it shows on the floor, and blasts everything within ${num(R.bombR)} cell of it. It aims ${pct(t.lead)} of the way to where you are heading, give or take ${num(t.scatter)} cells, but never closer than ${R.bombMin} cells to itself, further than ${R.bombMax}, or near another enemy. Its tube turns toward the mark before it fires.`,
      perks: ['Stationary', 'Lobs over walls', `Blast ${num(R.bombR)} cell`, `Reaches ${R.bombMin}–${R.bombMax} cells`],
      weak: `It can’t touch you within ${R.bombMin} cells, and nothing guards it up close. Walls don’t stop its bombs, so watch the floor for its mark and keep moving.`,
      scene: 'An olive mortar on its pad lobbing a bomb over a wall onto the mark where it will land.',
    }),
  };
}

/**
 * Card scenes on an 8 x 5 cell patch of arena. walls: [col, row, w, h] blocks; tracks: the
 * route the tank drove (it sits at the last point); at: where a stationary tank sits;
 * turret: aim angle; bank / top / bottom: ricochets off horizontal wall faces at those y
 * values; shots: distances of shells along the path; sweep: [centre, half-width] arc;
 * ghost: tank opacity; laid: mines laid (the rest show as discs on the deck); seek: where a
 * missile is steering to (its path is simulated with the game's turn rate); lob: where a
 * bomb will land and how far through its flight it is.
 */
export const SCENES = {
  brown: { walls: [[6, 0, 1, 2]], at: [2.2, 2.6], turret: -0.35, sweep: [-0.15, 0.75], shots: [2.4] },
  ash: { walls: [[6, 3, 2, 1]], tracks: [[0.2, 4.3], [1.2, 3.7], [2.4, 3.0], [3.4, 2.6]], turret: -0.18, shots: [2.2] },
  marine: { walls: [[7, 3, 1, 2]], tracks: [[0.3, 0.6], [1.0, 1.5], [1.8, 2.2], [2.4, 2.4]], turret: -0.1, shots: [3.4] },
  yellow: { walls: [[7, 0, 1, 1]], tracks: [[0.2, 1.0], [1.2, 1.8], [2.2, 2.1], [3.2, 2.7], [4.3, 3.1], [5.3, 2.9]], mines: [[1.0, 1.64], [3.3, 2.74]], laid: 2, turret: -0.7, shots: [1.2] },
  pink: { walls: [[3, 0, 5, 1], [4, 3, 1, 2]], tracks: [[0, 3.7], [0.7, 3.4], [1.4, 3.2]], turret: -0.55, bank: 1, top: 1.09, shots: [2.0, 3.0, 4.3] },
  green: { walls: [[2, 0, 6, 1], [2, 4, 6, 1], [4, 3, 1, 1]], at: [1.3, 2.5], turret: -0.7, bank: 2, top: 1.09, bottom: 3.91, shots: [3.3] },
  violet: { walls: [[4, 0, 4, 1]], tracks: [[0.3, 4.6], [1.2, 3.9], [2.0, 3.5], [2.6, 3.3]], mines: [[0.9, 4.13]], laid: 1, turret: -0.6, bank: 1, top: 1.09, shots: [1.6, 4.3] },
  red: { walls: [[4, 0, 1, 1], [7, 4, 1, 1]], tracks: [[0.2, 4.4], [0.9, 3.9], [1.5, 3.6]], turret: -0.45, seek: [6.6, 3.6], shots: [3.1] },
  white: { walls: [[6, 3, 2, 2]], tracks: [[0.2, 0.8], [1.4, 1.6], [2.6, 2.5], [3.8, 2.9], [5.0, 2.8]], mines: [[1.9, 1.98]], laid: 1, turret: -0.35, ghost: 0.13, shots: [1.3] },
  black: { walls: [[7, 0, 1, 1]], tracks: [[0.1, 4.4], [1.4, 3.8], [2.6, 3.0], [3.6, 2.6]], mines: [[1.0, 3.98]], laid: 1, turret: -0.15, shots: [1.2, 3.0] },
  olive: { walls: [[4, 1, 1, 3]], at: [1.6, 2.6], turret: 0.05, lob: { to: [6.4, 2.9], k: 0.55 }, shots: [] },
};
