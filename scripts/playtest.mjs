// Playtests Tanks missions with a scripted bot: can a map be won, and how hard is it next to
// the others? A dev tool like the field guide, not part of the app. It drives the game's own
// engine, so a map plays here exactly as it plays in the game.
//
//   npm run playtest                          every mission, both bots, 8 seeds each
//   npm run playtest -- --missions 4,12-15    just these missions
//   npm run playtest -- --bot casual --seeds 16
//   npm run playtest -- --map draft.txt       a map from the field guide's editor: its
//                                             "Copy as missions.js entry", or plain rows
//
// Two bots. The expert sees every tank, turns its turret instantly, finds one-bounce shots
// off every wall face, shoots down shots coming at it and steps off bomb marks at once: if it
// can't win a mission most of the time, the map has a problem. The casual bot aims a little
// off, only shoots straight, notices half the shots coming at it, reacts late to bomb marks
// and loses White tanks once they fade. It is no model of a person: compare its results
// between missions rather than with how people play. Each run plays a mission from its start
// with every life, the way the campaign does (a retry keeps destroyed enemies destroyed).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMap } from '../guide/mapcheck.mjs';
import { createWorld, parseLevel, step, survivors } from '../src/games/tanks/engine.js';
import { MISSIONS } from '../src/games/tanks/missions.js';
import {
  BLAST_R,
  BOMB_R,
  COLS,
  CRATE,
  FLOOR,
  HIT_R,
  MUZZLE,
  ROWS,
  SHELL_R,
  STEP,
  TYPES,
  blocksShell,
  cellAt,
  muzzleBlocked,
  open,
  owned,
  rand,
  segmentHit,
  tracePath,
} from '../src/games/tanks/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const BOTS = {
  // Steps between looking for a shot, seconds between shots, aim error (radians either way).
  expert: { lookEvery: 4, fireGap: 0.28, aimError: 0 },
  casual: { lookEvery: 24, fireGap: 0.6, aimError: 0.06 },
};
const WATCH = 0.7; // seconds ahead it watches for shots coming at it
const KEEP = 3; // cells it keeps from a tank that moves (a mortar can't reach it closer than BOMB_MIN)

/** Every line a shell centre bounces on: wall faces pushed out by the shell radius. */
function reflectLines(s) {
  const xs = new Set();
  const ys = new Set();
  const solid = (c, r) => blocksShell(cellAt(s.grid, c, r));
  for (let r = -1; r <= ROWS; r++) {
    for (let c = -1; c <= COLS; c++) {
      const here = solid(c, r);
      if (here !== solid(c + 1, r) && r >= 0 && r < ROWS) xs.add(here ? c + 1 + SHELL_R : c + 1 - SHELL_R);
      if (here !== solid(c, r + 1) && c >= 0 && c < COLS) ys.add(here ? r + 1 + SHELL_R : r + 1 - SHELL_R);
    }
  }
  return { xs: [...xs], ys: [...ys] };
}

/** The first tank your shot at `angle` would hit, its ricochet included, or null. */
function firstHit(s, angle) {
  const p = s.tanks[0];
  if (muzzleBlocked(s.grid, p.x, p.y, angle)) return null;
  const pts = tracePath(s.grid, p.x + Math.cos(angle) * MUZZLE, p.y + Math.sin(angle) * MUZZLE, angle, TYPES.player.bounces, 40);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    let best = Infinity;
    let hit = null;
    for (const t of s.tanks) {
      if (!t.alive || (t === p && i === 0)) continue; // it can't hit you on the way out
      // Shots at enemies must pass near their centre; shots back at you count from further out.
      const radius = (t === p ? HIT_R + 0.15 : HIT_R * 0.8) + SHELL_R;
      const d = segmentHit(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], t.x, t.y, radius);
      if (d >= 0 && d < best) {
        best = d;
        hit = t;
      }
    }
    if (hit) return hit;
  }
  return null;
}

/** Whether a straight shot of yours at `angle` meets a tank within `dist`. */
function tankInLine(s, angle, dist) {
  const p = s.tanks[0];
  const ex = p.x + Math.cos(angle) * dist;
  const ey = p.y + Math.sin(angle) * dist;
  return s.tanks.some((t) => t.alive && t !== p && segmentHit(p.x, p.y, ex, ey, t.x, t.y, HIT_R + SHELL_R) >= 0);
}

const cellIndex = (t) => Math.floor(t.y) * COLS + Math.floor(t.x);

/** Steps from every cell to the nearest `from` cell (8-way, no cutting corners), or -1. */
function distances(from, passable, dirs = DIRS) {
  const f = new Int16Array(COLS * ROWS).fill(-1);
  const queue = [...from];
  for (const i of from) f[i] = 0;
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const c = i % COLS;
    const r = (i - c) / COLS;
    for (const [dc, dr] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (!passable(nc, nr) || (dc && dr && (!passable(c + dc, r) || !passable(c, r + dr)))) continue;
      const n = nr * COLS + nc;
      if (f[n] >= 0) continue;
      f[n] = f[i] + 1;
      queue.push(n);
    }
  }
  return f;
}

/**
 * A bot that drives your tank: makeBot()(world) returns this step's input, the same shape
 * the game reads from the sticks. One bot per life; it keeps a little memory between steps.
 */
export function makeBot({ casual = false, seed = 1 } = {}) {
  const how = BOTS[casual ? 'casual' : 'expert'];
  const dice = { seed: 0x5eed + seed };
  const memo = { lines: null, gridVer: -1, shot: null, lastShot: -9, noShot: 0 };
  return function input(s) {
    const p = s.tanks[0];
    const out = { mx: 0, my: 0, aim: null, fire: false, mine: false };
    if (!p.alive) return out;
    const foes = s.tanks.filter((t) => t.slot >= 0 && t.alive);
    if (memo.gridVer !== s.gridVer) {
      memo.lines = reflectLines(s);
      memo.gridVer = s.gridVer;
    }

    // Aim: the first line, straight or (expert) off one wall, that hits an enemy first.
    if (Math.round(s.time / STEP) % how.lookEvery === 0) {
      memo.shot = null;
      const angles = [];
      for (const e of foes) {
        if (casual && TYPES[e.type].invisible && s.time > 1.2) continue; // faded from view
        const ahead = (Math.hypot(e.x - p.x, e.y - p.y) / TYPES.player.shot) * 0.8;
        const tx = e.x + e.vx * ahead;
        const ty = e.y + e.vy * ahead;
        angles.push(Math.atan2(ty - p.y, tx - p.x));
        if (casual) continue;
        for (const x of memo.lines.xs) angles.push(Math.atan2(ty - p.y, 2 * x - tx - p.x));
        for (const y of memo.lines.ys) angles.push(Math.atan2(2 * y - ty - p.y, tx - p.x));
      }
      const hit = angles.find((a) => firstHit(s, a)?.slot >= 0);
      if (hit != null) memo.shot = hit + (rand(dice) - 0.5) * 2 * how.aimError;
    }
    let shot = memo.shot;
    // Or blow up its own mine from a safe distance, to open a way through crates.
    if (shot == null) {
      for (const m of s.mines) {
        if (m.owner !== p.id) continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < BLAST_R + 0.4) continue; // a blast destroys tanks within BLAST_R + HIT_R / 2
        const a = Math.atan2(m.y - p.y, m.x - p.x);
        if (muzzleBlocked(s.grid, p.x, p.y, a)) continue;
        const pts = tracePath(s.grid, p.x + Math.cos(a) * MUZZLE, p.y + Math.sin(a) * MUZZLE, a, 0, 40);
        if (Math.hypot(pts[2] - p.x, pts[3] - p.y) >= d - 0.3 && !tankInLine(s, a, d)) {
          shot = a;
          break;
        }
      }
    }
    if (shot != null && owned(s.bullets, p) < TYPES.player.bullets && s.time - memo.lastShot > how.fireGap) {
      out.aim = shot;
      out.fire = true;
      memo.lastShot = s.time;
      memo.noShot = 0;
    } else if (shot == null) {
      memo.noShot += STEP;
    }

    // Threats: sidestep shots about to hit, get off bomb marks, stay clear of mines.
    let ax = 0;
    let ay = 0;
    let threatened = false;
    for (const b of s.bullets) {
      if (b.owner === p.id && b.left === TYPES.player.bounces) continue; // yours, still outbound
      const v2 = b.vx * b.vx + b.vy * b.vy;
      const tc = ((p.x - b.x) * b.vx + (p.y - b.y) * b.vy) / v2;
      if (tc < 0 || tc > WATCH) continue;
      const cx = b.x + b.vx * tc - p.x;
      const cy = b.y + b.vy * tc - p.y;
      if (Math.hypot(cx, cy) > 0.8) continue;
      if (casual && Math.imul(b.id, 2654435761) & 1) continue; // misses half of them, for good
      const speed = Math.sqrt(v2);
      let nx = -b.vy / speed;
      let ny = b.vx / speed;
      if (nx * -cx + ny * -cy < 0) {
        nx = -nx;
        ny = -ny;
      }
      ax += nx * 2;
      ay += ny * 2;
      threatened = true;
      if (!casual && out.aim == null && owned(s.bullets, p) < TYPES.player.bullets && s.time - memo.lastShot > 0.15) {
        // Shoot it down.
        out.aim = Math.atan2(b.y + b.vy * 0.15 - p.y, b.x + b.vx * 0.15 - p.x);
        out.fire = true;
        memo.lastShot = s.time;
      }
    }
    const away = (x, y, weight) => {
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy);
      // Right on top of it (a mine it just laid), there is no "away": take the clearest way out.
      const [ux, uy] = d > 0.05 ? [dx / d, dy / d] : clearestWayOut(s, p);
      ax += ux * weight;
      ay += uy * weight;
      threatened = true;
    };
    for (const b of s.bombs) {
      if (casual && b.t < 0.5) continue; // notices the mark late
      if (Math.hypot(p.x - b.tx, p.y - b.ty) < BOMB_R + 0.9) away(b.tx, b.ty, 2);
    }
    for (const m of s.mines) if (Math.hypot(p.x - m.x, p.y - m.y) < BLAST_R + 0.6) away(m.x, m.y, 1);
    if (threatened) return drive(out, ax, ay);

    // Drive: toward the nearest enemy until a shot turns up, keeping a little distance.
    let near = null;
    for (const e of foes) if (!near || Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(near.x - p.x, near.y - p.y)) near = e;
    if (!near) return out;
    const dist = Math.hypot(near.x - p.x, near.y - p.y);
    const keep = TYPES[near.type].weapon === 'bomb' ? 1.6 : KEEP;
    if (shot != null && dist > keep) return out; // hold still and shoot
    if (dist < keep && TYPES[near.type].speed) return drive(out, p.x - near.x, p.y - near.y);
    const goals = foes.map(cellIndex);
    const floor = (c, r) => open(s.grid, c, r) || goals.includes(r * COLS + c);
    let passable = floor;
    let f = distances(goals, floor);
    const here = cellIndex(p);
    const hc = Math.floor(p.x);
    const hr = Math.floor(p.y);
    if (f[here] < 0 || memo.noShot > 4) {
      // No way there on the floor, or no shot for a while: go through crates, in straight
      // steps, and lay a mine right against the first crate in the way (a blast clears crates
      // within BLAST_R + 0.2 of it).
      passable = (c, r) => floor(c, r) || cellAt(s.grid, c, r) === CRATE;
      f = distances(goals, passable, DIRS.slice(0, 4));
      const inTheWay = DIRS.slice(0, 4).some(([dc, dr]) => {
        const n = (hr + dr) * COLS + hc + dc;
        return cellAt(s.grid, hc + dc, hr + dr) === CRATE && f[n] >= 0 && f[n] < f[here] && Math.hypot(hc + dc + 0.5 - p.x, hr + dr + 0.5 - p.y) < 1.3;
      });
      if (inTheWay && owned(s.mines, p) === 0 && !s.mines.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 2)) out.mine = true;
    }
    let next = null;
    let best = f[here] >= 0 ? f[here] : Infinity;
    for (const [dc, dr] of DIRS) {
      const nc = hc + dc;
      const nr = hr + dr;
      const n = nr * COLS + nc;
      if (!open(s.grid, nc, nr) || f[n] < 0 || f[n] >= best) continue;
      if (dc && dr && (!passable(hc + dc, hr) || !passable(hc, hr + dr))) continue;
      best = f[n];
      next = [nc + 0.5, nr + 0.5];
    }
    // Nowhere closer to go (a crate is next): settle in the middle of this cell, against it.
    if (!next) next = [hc + 0.5, hr + 0.5];
    return drive(out, next[0] - p.x, next[1] - p.y);
  };
}

/** The direction to the open neighbouring cell with the most open cells around it. */
function clearestWayOut(s, p) {
  const hc = Math.floor(p.x);
  const hr = Math.floor(p.y);
  let best = [0, 0];
  let most = -1;
  for (const [dc, dr] of DIRS) {
    const c = hc + dc;
    const r = hr + dr;
    if (!open(s.grid, c, r) || (dc && dr && (!open(s.grid, hc + dc, hr) || !open(s.grid, hc, hr + dr)))) continue;
    const around = DIRS.filter(([a, b]) => open(s.grid, c + a, r + b)).length;
    if (around > most) {
      most = around;
      const l = Math.hypot(c + 0.5 - p.x, r + 0.5 - p.y) || 1;
      best = [(c + 0.5 - p.x) / l, (r + 0.5 - p.y) / l];
    }
  }
  return best;
}

function drive(out, dx, dy) {
  const l = Math.hypot(dx, dy);
  out.mx = l > 1 ? dx / l : dx;
  out.my = l > 1 ? dy / l : dy;
  return out;
}

/** What destroyed your tank: an enemy kind (plus "ricochet" if its shot bounced), "mine" or "bomb". */
function killer(s, death, shotsBefore) {
  if (death.cause !== 'shell') return death.cause;
  const dist = (b) => Math.hypot(b.x - death.x, b.y - death.y);
  const shot = shotsBefore.reduce((a, b) => (!a || dist(b) < dist(a) ? b : a), null);
  const owner = shot && s.tanks.find((t) => t.id === shot.owner);
  if (!owner) return 'a shell';
  const name = owner.slot < 0 ? 'your own shell' : owner.type;
  return shot.left < TYPES[owner.type].bounces ? `${name} (ricochet)` : name;
}

/**
 * Plays one mission from its start with every life. Returns { won, deaths, time, stalled,
 * killers }: stalled means a life ran out of time (`limit` seconds) with enemies left.
 */
export function playMission(rows, { seed = 1, lives = 3, limit = 180, casual = false } = {}) {
  const level = parseLevel(rows);
  const killers = {};
  let alive = null;
  let deaths = 0;
  let time = 0;
  for (let life = 0; life < lives; life++) {
    const s = createWorld(level, { seed: seed * 7 + life, alive });
    const bot = makeBot({ casual, seed: seed * 7 + life });
    for (let k = 0; k < limit / STEP && s.phase === 'play'; k++) {
      const shotsBefore = s.bullets.map(({ x, y, owner, left }) => ({ x, y, owner, left }));
      const death = step(s, bot(s), STEP).find((e) => e.type === 'destroyed' && e.tank === 'player');
      if (death) {
        const who = killer(s, death, shotsBefore);
        killers[who] = (killers[who] || 0) + 1;
      }
    }
    time += s.time;
    if (s.phase === 'won') return { won: true, deaths, time, stalled: false, killers };
    if (s.phase === 'play') return { won: false, deaths, time, stalled: true, killers };
    deaths++;
    alive = survivors(s);
  }
  return { won: false, deaths, time, stalled: false, killers };
}

/** A map's rows from text: plain rows, or a missions.js entry as the guide's editor copies it. */
export function readMap(text) {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^['"`]|['"`],?$/g, ''))
    .filter((line) => line && !line.startsWith('//') && !/^[[\]],?$/.test(line));
}

/** Plays a map with one bot over seeds 1..seeds: { wins, runs, deaths, time, stalls, killers }. */
export function playtest(rows, { seeds = 8, casual = false, lives = 3 } = {}) {
  const sum = { wins: 0, runs: seeds, deaths: 0, time: 0, stalls: 0, killers: {} };
  for (let seed = 1; seed <= seeds; seed++) {
    const r = playMission(rows, { seed, casual, lives });
    sum.wins += r.won ? 1 : 0;
    sum.stalls += r.stalled ? 1 : 0;
    sum.deaths += r.deaths;
    sum.time += r.time;
    for (const [who, n] of Object.entries(r.killers)) sum.killers[who] = (sum.killers[who] || 0) + n;
  }
  return sum;
}

/* ---------- Command line ---------- */

function parseArgs(argv) {
  const opts = { missions: null, bots: ['expert', 'casual'], seeds: 8, map: null };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value = argv[i + 1]] = argv[i].split('=');
    const take = () => {
      if (!argv[i].includes('=')) i++;
      if (value == null) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--missions') {
      opts.missions = take().split(',').flatMap((part) => {
        const [a, b = a] = part.split('-').map(Number);
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`--missions: "${part}" isn't a mission number or range`);
        return Array.from({ length: b - a + 1 }, (_, k) => a + k);
      });
    } else if (flag === '--bot') {
      const bot = take();
      if (!['expert', 'casual', 'both'].includes(bot)) throw new Error('--bot is expert, casual or both');
      opts.bots = bot === 'both' ? ['expert', 'casual'] : [bot];
    } else if (flag === '--seeds') {
      opts.seeds = Number(take());
      if (!(opts.seeds >= 1)) throw new Error('--seeds needs a number from 1 up');
    } else if (flag === '--map') {
      opts.map = take();
    } else {
      throw new Error(`Unknown option ${argv[i]}. Options: --missions 1,4-6  --bot expert|casual|both  --seeds 8  --map file.txt`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const i18n = await readFile(path.join(ROOT, 'src/shared/i18n.js'), 'utf8');
  const tanksJs = await readFile(path.join(ROOT, 'src/games/tanks/tanks.js'), 'utf8');
  const lives = Number((tanksJs.match(/const LIVES = (\d+);/) || [])[1]) || 3;
  const nameOf = (n) => (i18n.match(new RegExp(`'tanks\\.name\\.${n}':\\s*(['"])(.*?)\\1`)) || [])[2] || '';

  let maps;
  if (opts.map) {
    // npm runs scripts from the package root; read the file from where you ran it.
    const file = path.resolve(process.env.INIT_CWD || process.cwd(), opts.map);
    const rows = readMap(await readFile(file, 'utf8'));
    const { errors, warnings, stats } = checkMap(rows, { others: MISSIONS.map((m, i) => ({ name: `mission ${i + 1}`, rows: m })) });
    for (const p of errors) console.log(`error  ${p.text}`);
    for (const p of warnings) console.log(`nudge  ${p.text}`);
    if (!stats) throw new Error('The map has to parse before it can be played.');
    maps = [{ label: '--', name: path.basename(file), rows }];
  } else {
    const picked = opts.missions || MISSIONS.map((_, i) => i + 1);
    const bad = picked.filter((n) => !MISSIONS[n - 1]);
    if (bad.length) throw new Error(`No mission ${bad.join(', ')}: there are ${MISSIONS.length}`);
    maps = picked.map((n) => ({ label: String(n).padStart(2), name: nameOf(n), rows: MISSIONS[n - 1] }));
  }

  const cell = (r) => `${`${r.wins}/${r.runs}`.padStart(5)}  ${(r.deaths / r.runs).toFixed(1).padStart(4)}  ${`${Math.round(r.time / r.runs)}s`.padStart(4)}${r.stalls ? ` (${r.stalls} ran out of time)` : ''}`;
  console.log(`Tanks playtest · ${opts.seeds} seeds · ${lives} lives a run · win, deaths per run, time per run`);
  console.log(`      ${''.padEnd(16)}${opts.bots.map((b) => `${b.padStart(5)}${''.padEnd(13)}`).join('')}  ${opts.bots.at(-1)} was destroyed by`);
  for (const m of maps) {
    const results = opts.bots.map((bot) => playtest(m.rows, { seeds: opts.seeds, casual: bot === 'casual', lives }));
    const killers = Object.entries(results.at(-1).killers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([who, n]) => `${who} ${n}`).join(', ');
    console.log(`  ${m.label}  ${m.name.slice(0, 16).padEnd(16)}${results.map(cell).join('  ')}  ${killers}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
