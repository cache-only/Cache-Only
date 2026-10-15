// What we could add to the enemies, shown in the field guide marked Proposed: none of it is
// built. The levels each kind has today come from its stats (TYPES in rules.js); these are the
// levels it would reach. Keep this in step with TANKS.md A5. When one ships, take it out of
// here: the guide then shows it as the kind's level today.
// scripts/guide.mjs fails if an entry names an unknown kind or axis.

const SEEK = { level: 2, name: 'Seeks a firing spot', detail: 'drives to the nearest spot with a line on you' };

/** Per kind, per axis (aim, aware, defence, tactics, mines): the proposed level, 0 to 3. */
export const PROPOSED = {
  ash: { tactics: SEEK },
  marine: { tactics: { level: 2, name: 'Seeks a long line', detail: 'drives to a spot with a line on you, 7–12 cells off' } },
  green: { aim: { level: 3, name: 'Bank ×2, leads', detail: 'leads its shots, as Teal does' } },
  yellow: { tactics: SEEK },
  pink: { tactics: { level: 2, name: 'Seeks a bank line', detail: 'drives to a spot it can bounce a shot in from' } },
  pinkNight: {
    defence: { level: 3, name: 'Shoots shells down', detail: 'and sidesteps the rest' },
    tactics: { level: 3, name: 'Seeks, takes cover', detail: 'fires, then ducks behind a wall to reload' },
  },
  white: {
    defence: { level: 3, name: 'Shoots shells down', detail: 'and sidesteps the rest, invisible' },
    tactics: { level: 3, name: 'Seeks, takes cover', detail: 'fires, then ducks behind a wall to reload' },
  },
  red: { tactics: SEEK },
  black: {
    defence: { level: 3, name: 'Shoots shells down', detail: 'and sidesteps the rest' },
    mines: { level: 2, name: 'Drops 2 behind it', detail: 'as it hunts, so chasing it is a risk' },
  },
  lime: { tactics: SEEK },
};

/**
 * Measured 2026-10-14: the share of its time each kind spends at its distance from you with no
 * line on you, with you hiding (20 missions, 3 seeds, 30 s each). In that state it has no goal.
 */
export const AIMLESS = { marine: 67, ash: 63, red: 47, pink: 46, yellow: 36, black: 32, white: 29, pinkNight: 17 };

/** The additions, one card each: the axis it raises, what it does, who gets it and why. */
export const ADDITIONS = [
  {
    axis: 'tactics',
    name: 'Seek a firing spot',
    what: 'A tank that moves and has no shot on you drives to the nearest cell at its distance from you that has one (a bank line for bank aimers), instead of wandering. It stops only for a reason: to line up a shot, watch a mine, give way to another tank, or take cover.',
    who: ['ash', 'marine', 'yellow', 'pink', 'red', 'lime'],
    why: 'Today a tank at its distance with no shot has no goal at all, so it drifts and pauses at random, which reads as a bug. With you hiding, this is how much of their time they spend like that:',
    aimless: true,
  },
  {
    axis: 'defence',
    name: 'Shoot shells down',
    what: 'Of the shells it notices coming at it, it fires at some instead of only stepping aside, aiming at where the shell will be. Shells that meet already cancel out, so this needs only the aiming.',
    who: ['pinkNight', 'white', 'black'],
    why: 'The top level of Defence. The expert playtest bot already plays this way, and it is the hardest thing to beat.',
  },
  {
    axis: 'tactics',
    name: 'Fire, then take cover',
    what: 'After a shot it steps back behind the nearest wall until it has reloaded, then comes out again.',
    who: ['pinkNight', 'white'],
    why: 'Gives Night Pink a Tactics level Pink doesn’t have: today Night Pink and White roam just like Pink.',
  },
  {
    axis: 'mines',
    name: 'Mines for Black',
    what: 'Black drops mines behind it as it hunts: 2 on the ground at once, laid while you are on its tail, so chasing it head-on is a risk.',
    who: ['black'],
    why: 'It carried 2 until the minelayer rework. As the fastest hunter, mines it leaves behind fit how it fights.',
  },
  {
    axis: 'aim',
    name: 'Lead for Green',
    what: 'Green aims ahead of you as Teal does (Teal leads 50%), on top of its two-bounce shots.',
    who: ['green'],
    why: 'Green out-banks Teal but doesn’t lead its shots as Teal does (50%), so its aim misses a moving target that Teal’s wouldn’t.',
  },
];
