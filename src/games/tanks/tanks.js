import { formatNumber, localize, t } from '../../shared/i18n.js';
import { createSaver, createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { confirmDialog, setupSideMenu } from '../../shared/ui.js';
import { drawBadge } from './art.js';
import { createAudio } from './audio.js';
import { createWorld, isWorld, parseLevel, step, survivors } from './engine.js';
import { BONUS_AFTER, CHECKPOINTS, MISSIONS } from './missions.js';
import { createRenderer } from './render.js';
import { ENEMY_KINDS, STEP, TYPES, owned } from './rules.js';

const SCHEMA = 1;
const LIVES = 3;
const BRIEF_S = 2.4; // the mission banner, before the shooting starts...
const BRIEF_READ = 0.025; // ...plus this long per character of its note, up to BRIEF_MAX
const BRIEF_MAX = 5;
const BANNER_AT = 1.1; // after a mission ends: let the explosions play first
const NEXT_AT = 3.8; // ...then the next mission, a retry or the results
const MAX_STEPS = 16; // per frame, so a stall never fast-forwards the battle

const $ = (id) => document.getElementById(id);
const store = createStore('tanks');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

localize();
registerSW();

const canvas = $('arena');
const wrap = $('boardWrap');
const renderer = createRenderer(canvas, { reduceMotion: () => reduceMotion.matches });
const audio = createAudio();

/* ---------- Saved data ---------- */

const prefs = { sound: true, ...(store.load('prefs', 1) || {}) };
const stats = { best: 0, kills: 0, wins: 0, checkpoint: 1, ...(store.load('stats', 1) || {}) };
const savePrefs = () => store.save('prefs', 1, prefs);
const saveStats = () => store.save('stats', 1, stats);
audio.setMuted(!prefs.sound);

// The run in progress: { mission (0-based), lives, kills: { kind: n }, alive: enemy slots or null }.
let campaign = null;
let world = null; // the mission being played
let backdrop = null; // a world drawn, frozen, behind the menu and results
let phase = 'menu'; // menu | brief | play | paused | ending | over
let phaseT = 0;
let briefS = BRIEF_S;
let ending = null;

const saver = createSaver(store, 'session', SCHEMA, () =>
  campaign
    ? {
        campaign,
        // Mid-mission the whole world is saved, so a killed app resumes exactly here.
        world: phase === 'play' || phase === 'paused' ? world : null,
        summary: { mission: campaign.mission + 1 },
      }
    : null,
);

function isCampaign(c) {
  return (
    !!c &&
    Number.isInteger(c.mission) &&
    c.mission >= 0 &&
    c.mission < MISSIONS.length &&
    Number.isInteger(c.lives) &&
    c.lives > 0 &&
    !!c.kills &&
    typeof c.kills === 'object' &&
    (c.alive === null || Array.isArray(c.alive))
  );
}

const total = (kills) => Object.values(kills).reduce((a, b) => a + b, 0);

function addKills(into, from) {
  for (const [kind, n] of Object.entries(from)) into[kind] = (into[kind] || 0) + n;
}

/* ---------- Input ---------- */

const input = {
  keys: new Set(),
  stick: { x: 0, y: 0 }, // drive stick, screen space, length up to 1
  aimDir: null, // world angle from the aim stick or a tap
  aimPoint: null, // world point from the mouse
  guide: false, // show the aiming guide
  reticle: false, // mark aimPoint
  shots: 0, // shots waiting for the barrel to reload
  shotsUntil: 0,
  mine: false,
  mineUntil: 0,
};

const KEY_DIRS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

let touchUI = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let skipPointer = null; // the click that dismissed the mission banner; it doesn't also fire

function currentAim() {
  if (!world) return null;
  const p = world.tanks[0];
  if (input.aimPoint) return Math.atan2(input.aimPoint.y - p.y, input.aimPoint.x - p.x);
  return input.aimDir;
}

function readInput() {
  let sx = input.stick.x;
  let sy = input.stick.y;
  let kx = 0;
  let ky = 0;
  for (const k of input.keys) {
    const d = KEY_DIRS[k];
    if (d) {
      kx += d[0];
      ky += d[1];
    }
  }
  if (kx || ky) {
    const l = Math.hypot(kx, ky);
    sx = kx / l;
    sy = ky / l;
  }
  // Up on screen is up on screen, whichever way the arena is turned.
  const move = renderer.vecToWorld(sx, sy);
  if (input.shots && world.time > input.shotsUntil) input.shots = 0;
  if (input.mine && world.time > input.mineUntil) input.mine = false;
  return { mx: move.x, my: move.y, aim: currentAim(), fire: input.shots > 0, mine: input.mine };
}

function queueShot() {
  if (phase !== 'play') return;
  input.shots = Math.min(3, input.shots + 1);
  input.shotsUntil = world.time + 0.3;
}

function queueMine() {
  if (phase !== 'play') return;
  input.mine = true;
  input.mineUntil = world.time + 0.3;
}

/** Turns the turret straight at the nearest enemy you can see: no ricochets, no lead. */
function aimAtNearest() {
  const p = world.tanks[0];
  let best = null;
  let bestD = Infinity;
  for (const t of world.tanks) {
    // An invisible tank stays hidden: the auto-aim doesn't give it away.
    if (t.slot < 0 || !t.alive || TYPES[t.type].invisible) continue;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return;
  input.aimDir = Math.atan2(best.y - p.y, best.x - p.x);
  input.aimPoint = null;
}

// Touch: Brawl Stars-style floating sticks over the whole play area. A thumb anywhere on the
// left half drives, with the stick centred where it lands. On the right half, drag to aim and
// let go to fire, drag back to the middle to cancel, or just tap to fire at the nearest tank.
// The round button on the right edge, above the aim stick, lays a mine.
//
// The sticks follow touches by identifier, and every touch event carries the full list of
// fingers still on the screen. A stick whose finger isn't on that list is let go, so a lost
// touchend (iOS drops them with several fingers down or a system gesture) can't leave the
// tank driving on its own: the next touch anywhere frees it, and a new thumb on that half
// takes the stick over.
const pads = $('pads');
const mineBtn = $('mineBtn');
const AIM_DEAD = 0.25; // share of the stick's reach: inside it, the aim stick hasn't aimed

function makeStick(el, { start = () => {}, move, end }) {
  const knob = el.querySelector('.knob');
  const stick = { id: null, mag: 0 };
  let ox = 0;
  let oy = 0;
  const reach = () => el.offsetWidth / 2 || 56;
  const setKnob = (dx, dy) => {
    knob.style.setProperty('--kx', `${dx}px`);
    knob.style.setProperty('--ky', `${dy}px`);
  };
  stick.track = (touch) => {
    const r = reach();
    const dx = touch.clientX - ox;
    const dy = touch.clientY - oy;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    setKnob(dx * k, dy * k);
    stick.mag = Math.min(1, len / r);
    move((dx * k) / r, (dy * k) / r, stick.mag);
  };
  stick.begin = (touch, quiet) => {
    const box = pads.getBoundingClientRect();
    stick.id = touch.identifier;
    ox = touch.clientX;
    oy = touch.clientY;
    el.style.left = `${ox - box.left}px`;
    el.style.top = `${oy - box.top}px`;
    el.classList.add('active');
    start(quiet);
    stick.track(touch);
  };
  /** Lets go. cancelled: the touch was taken away rather than lifted, so nothing fires. */
  stick.finish = (cancelled) => {
    if (stick.id === null) return;
    stick.id = null;
    el.classList.remove('active', 'cancel');
    el.style.left = '';
    el.style.top = '';
    setKnob(0, 0);
    end(cancelled);
  };
  return stick;
}

const moveStick = makeStick($('moveStick'), {
  move(x, y) {
    input.stick = { x, y };
  },
  end() {
    input.stick = { x: 0, y: 0 };
  },
});

const aimEl = $('aimStick');
let aimed = false; // the aim stick has left its middle since the thumb landed
let aimQuiet = false; // the thumb that started the mission: tapping with it doesn't fire

const aimStick = makeStick(aimEl, {
  start(quiet) {
    aimed = false;
    aimQuiet = quiet;
    aimEl.style.removeProperty('--ka');
  },
  move(x, y, mag) {
    if (mag < AIM_DEAD) {
      input.guide = false;
      aimEl.classList.toggle('cancel', aimed);
      return;
    }
    aimed = true;
    aimEl.classList.remove('cancel');
    // The knob's shell points along the aim (clockwise from up, as CSS rotates).
    aimEl.style.setProperty('--ka', `${Math.atan2(x, -y)}rad`);
    const v = renderer.vecToWorld(x, y);
    input.aimDir = Math.atan2(v.y, v.x);
    input.aimPoint = null;
    input.guide = true;
  },
  end(cancelled) {
    input.guide = false;
    aimEl.style.removeProperty('--ka');
    if (cancelled || phase !== 'play') return;
    if (aimStick.mag >= AIM_DEAD) {
      queueShot();
    } else if (!aimed && !aimQuiet) {
      aimAtNearest();
      queueShot();
    }
    // Otherwise it was aimed, then brought back to the middle: cancelled.
  },
});

const sticks = [moveStick, aimStick];
let mineTouch = null;

function pressMine(id) {
  mineTouch = id;
  mineBtn.classList.toggle('pressed', id !== null);
}

/** Lets go of every stick and button whose finger is no longer on the screen. */
function settle(touches) {
  const down = new Set(Array.from(touches, (t) => t.identifier));
  for (const s of sticks) if (s.id !== null && !down.has(s.id)) s.finish(true);
  if (mineTouch !== null && !down.has(mineTouch)) pressMine(null);
}

pads.addEventListener(
  'touchstart',
  (event) => {
    event.preventDefault();
    settle(event.touches);
    // A touch during the mission banner starts the mission, and can start driving too.
    let quiet = false;
    if (phase === 'brief' && phaseT > 0.35) {
      startPlay();
      quiet = true;
    }
    if (phase !== 'play') return;
    const box = pads.getBoundingClientRect();
    for (const touch of event.changedTouches) {
      if (mineBtn.contains(touch.target)) {
        pressMine(touch.identifier);
        queueMine();
        continue;
      }
      const stick = touch.clientX < box.left + box.width / 2 ? moveStick : aimStick;
      if (stick.id === null) stick.begin(touch, quiet);
    }
  },
  { passive: false },
);

pads.addEventListener(
  'touchmove',
  (event) => {
    event.preventDefault();
    for (const touch of event.changedTouches) {
      for (const s of sticks) if (s.id === touch.identifier) s.track(touch);
    }
  },
  { passive: false },
);

function touchEnd(event) {
  for (const touch of event.changedTouches) {
    for (const s of sticks) if (s.id === touch.identifier) s.finish(event.type === 'touchcancel');
    if (touch.identifier === mineTouch) pressMine(null);
  }
  settle(event.touches);
}

pads.addEventListener('touchend', touchEnd);
pads.addEventListener('touchcancel', touchEnd);
// Touches that start or end anywhere else (the header) also say which fingers are still down.
for (const type of ['touchstart', 'touchend', 'touchcancel']) {
  document.addEventListener(type, (event) => settle(event.touches), { passive: true });
}

function releaseInput() {
  for (const s of sticks) s.finish(true);
  pressMine(null);
  input.keys.clear();
  input.stick = { x: 0, y: 0 };
  input.guide = false;
  input.reticle = false;
  input.shots = 0;
  input.mine = false;
}

function resetAim() {
  input.aimDir = null;
  input.aimPoint = null;
}

// Mouse: aim anywhere over the play area and click to fire; right-click lays a mine.
const play = document.querySelector('.play-tanks');

function aimAtMouse(event) {
  const r = canvas.getBoundingClientRect();
  input.aimPoint = renderer.toWorld(event.clientX - r.left, event.clientY - r.top);
  input.guide = input.reticle = true;
}

play.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || phase !== 'play' || event.pointerId === skipPointer) return;
  event.preventDefault();
  if (mineBtn.contains(event.target)) {
    queueMine();
    return;
  }
  aimAtMouse(event);
  if (event.button === 0) queueShot();
  else if (event.button === 2) queueMine();
});

play.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse' && phase === 'play') aimAtMouse(event);
});

play.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'mouse') input.reticle = false;
});

play.addEventListener('contextmenu', (event) => event.preventDefault());

// iOS: no scrolling, zooming or back-swipes from the arena.
for (const type of ['touchstart', 'touchmove']) canvas.addEventListener(type, (event) => event.preventDefault(), { passive: false });

// Any touch or key during the mission banner starts the mission (the pads handle their own).
document.addEventListener(
  'pointerdown',
  (event) => {
    skipPointer = null;
    if (phase === 'brief' && phaseT > 0.35 && !pads.contains(event.target)) {
      skipPointer = event.pointerId;
      startPlay();
    }
  },
  true,
);

// Sound may only start inside a user gesture; for touch that's the lift, not the press.
const unlockAudio = (event) => {
  if (event.type !== 'pointerdown' || event.pointerType === 'mouse') audio.unlock();
};
for (const type of ['pointerdown', 'pointerup', 'touchend']) document.addEventListener(type, unlockAudio, true);

wrap.addEventListener('pointerdown', () => {
  if (phase === 'ending') skipEnding();
});

document.addEventListener('keydown', (event) => {
  // macOS sends no keyup for keys let go while Cmd is down, so a held key would stick.
  if (event.key === 'Meta') input.keys.clear();
  if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
  audio.unlock();
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'p' || key === 'Escape') {
    if (menu.isOpen()) menu.close();
    else if (phase === 'play') menu.open();
    else return;
    event.preventDefault();
    return;
  }
  if (menu.isOpen()) {
    // Keys work the menu's own items; Space or Enter anywhere else closes it and plays on.
    if ((key === ' ' || key === 'Enter') && !event.target.closest?.('.side-menu')) {
      event.preventDefault();
      menu.close();
    }
    return;
  }
  if (phase === 'brief' && phaseT > 0.35 && !event.repeat) {
    event.preventDefault();
    startPlay();
    if (!KEY_DIRS[key]) return;
  } else if (phase === 'ending' && (key === ' ' || key === 'Enter')) {
    event.preventDefault();
    skipEnding();
    return;
  }
  if (KEY_DIRS[key]) {
    event.preventDefault();
    input.keys.add(key);
    return;
  }
  if (phase !== 'play' || event.repeat) return;
  if (key === ' ' || key === 'e' || key === 'Shift') {
    event.preventDefault();
    queueMine();
  } else if (key === 'Enter' || key === 'f') {
    event.preventDefault();
    queueShot();
  }
});

document.addEventListener('keyup', (event) => {
  input.keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
});

/* ---------- HUD, banners, overlays ---------- */

function renderHud() {
  if (campaign) {
    $('missionStat').textContent = String(campaign.mission + 1).padStart(2, '0');
    $('livesStat').textContent = String(campaign.lives);
  }
  renderPips();
}

function renderPips() {
  const used = world ? owned(world.mines, world.tanks[0]) : 0;
  [...$('minePips').children].forEach((el, i) => el.classList.toggle('used', i >= TYPES.player.mines - used));
}

const BADGE_W = 34;
const BADGE_H = 26;

/** A tank kind as the game draws it, small: shape shows what it does, colour which kind it is. */
function badge(kind) {
  const el = document.createElement('canvas');
  el.className = 'badge';
  el.dataset.kind = kind;
  el.title = t(`tanks.type.${kind}`);
  paintBadge(el);
  return el;
}

function paintBadge(el) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.width = Math.round(BADGE_W * dpr);
  el.height = Math.round(BADGE_H * dpr);
  const c = el.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBadge(c, renderer.palette(), el.dataset.kind, BADGE_W, BADGE_H);
}

// Kinds whose arrival the mission banner warns about.
const NOTES = { red: 'tanks.note.red', white: 'tanks.note.white', olive: 'tanks.note.olive' };

function showBanner({ title, name = '', sub = '', kinds = [], note = '' }) {
  const banner = $('banner');
  $('bannerTitle').textContent = title;
  $('bannerName').textContent = name;
  $('bannerSub').textContent = sub;
  $('bannerNote').textContent = note;
  $('bannerTanks').replaceChildren(...kinds.map(badge));
  banner.hidden = false;
  banner.classList.remove('in');
  void banner.offsetWidth; // restart the slide-in
  banner.classList.add('in');
}

function hideBanner() {
  $('banner').hidden = true;
}

const overlays = { menu: $('ovMenu'), over: $('ovOver') };

function showOverlay(name) {
  for (const [key, el] of Object.entries(overlays)) el.hidden = key !== name;
}

function renderCheckpoints(box) {
  const open = CHECKPOINTS.filter((cp) => cp > 1 && cp <= stats.checkpoint);
  if (!open.length) return box.replaceChildren();
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = t('tanks.startAt');
  const buttons = open.map((cp) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = t('tanks.missionN', { n: cp });
    b.addEventListener('click', () => chooseStart(cp - 1));
    return b;
  });
  box.replaceChildren(label, ...buttons);
}

function renderTally(box, kills) {
  box.replaceChildren(
    ...ENEMY_KINDS.filter((kind) => kills[kind]).map((kind) => {
      const item = document.createElement('span');
      item.className = 'tally-item';
      item.append(badge(kind), `× ${formatNumber(kills[kind])}`);
      return item;
    }),
  );
}

/* ---------- Loop ---------- */

let raf = 0;
let last = 0;
let acc = 0;
const LOOPING = ['brief', 'play', 'ending'];

function setPhase(next) {
  phase = next;
  phaseT = 0;
  // The touch controls stay up from the banner to the end of the mission, and take touches
  // while it is starting or being played.
  pads.classList.toggle('shown', LOOPING.includes(next));
  pads.classList.toggle('live', next === 'brief' || next === 'play');
  if (LOOPING.includes(next)) startLoop();
  else stopLoop();
}

function startLoop() {
  if (raf || document.hidden || menu.isOpen()) return;
  last = performance.now();
  acc = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  draw();
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  phaseT += dt;
  if (phase === 'play') {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      acc -= STEP;
      steps++;
      const events = step(world, readInput(), STEP);
      if (events.length) onEvents(events);
      if (world.phase !== 'play') {
        missionOver();
        break;
      }
    }
    if (steps >= MAX_STEPS) acc = 0;
  }
  renderer.update(dt, world);
  if (phase === 'brief' && phaseT >= briefS) startPlay();
  else if (phase === 'ending') tickEnding();
  draw();
}

function draw() {
  const s = world || backdrop;
  if (!s) return;
  const playing = phase === 'play';
  const aim = playing && input.guide ? currentAim() ?? s.tanks[0].turret : null;
  let beacon = 0;
  if (phase === 'brief') beacon = 1;
  else if (playing && s.time < 1.6) beacon = 1 - s.time / 1.6;
  renderer.draw(s, { aim, reticle: playing && input.reticle ? input.aimPoint : null, beacon });
}

function onEvents(events) {
  renderer.events(events, world);
  for (const e of events) {
    switch (e.type) {
      case 'shot':
        if (e.player) input.shots = Math.max(0, input.shots - 1);
        if (e.weapon === 'rocket' || e.weapon === 'missile') audio.play(e.weapon);
        else audio.play(e.player ? 'shot' : 'enemyShot');
        break;
      case 'lob':
        audio.play('lob', e.flight);
        break;
      case 'fizzle':
        if (e.player) input.shots = Math.max(0, input.shots - 1);
        audio.play('fizzle');
        break;
      case 'mine':
        if (e.player) input.mine = false;
        audio.play('mine');
        renderPips();
        break;
      case 'blast':
        audio.play(e.cause === 'bomb' ? 'impact' : 'blast');
        renderPips();
        break;
      case 'bounce':
      case 'pop':
      case 'clash':
      case 'crate':
      case 'destroyed':
        audio.play(e.type);
        break;
      default:
        break;
    }
  }
}

/* ---------- Campaign flow ---------- */

function beginMission() {
  const level = parseLevel(MISSIONS[campaign.mission]);
  world = createWorld(level, { seed: (Math.random() * 2 ** 31) | 0, alive: campaign.alive });
  backdrop = null;
  renderer.reset();
  releaseInput();
  resetAim();
  const n = campaign.mission + 1;
  stats.best = Math.max(stats.best, n);
  for (const cp of CHECKPOINTS) if (n >= cp) stats.checkpoint = Math.max(stats.checkpoint, cp);
  saveStats();
  showOverlay(null);
  setPhase('brief');
  const kinds = world.tanks.filter((tk) => tk.slot >= 0).map((tk) => tk.type);
  const sub = [n === MISSIONS.length ? t('tanks.final') : '', t('tanks.enemies', { n: kinds.length })].filter(Boolean);
  // The mission's one-line briefing, then a warning for each kind that needs one.
  const note = [t(`tanks.brief.${n}`), ...Object.keys(NOTES).filter((kind) => kinds.includes(kind)).map((kind) => t(NOTES[kind]))].join(' ');
  briefS = Math.min(BRIEF_MAX, BRIEF_S + note.length * BRIEF_READ);
  showBanner({ title: t('tanks.missionN', { n }), name: t(`tanks.name.${n}`), sub: sub.join(' · '), kinds, note });
  renderHud();
  saver.flush();
  audio.play('start');
}

function startPlay() {
  if (phase !== 'brief') return;
  hideBanner();
  document.activeElement?.blur?.();
  setPhase('play');
}

/** Wraps up a finished campaign: records, then forgets the run. Returns the results. */
function closeCampaign(victory, reached) {
  const kills = total(campaign.kills);
  const record = kills > stats.kills;
  stats.kills = Math.max(stats.kills, kills);
  if (victory) {
    stats.best = MISSIONS.length + 1;
    stats.wins++;
  }
  saveStats();
  const result = { victory, reached, kills, tally: { ...campaign.kills }, record };
  campaign = null;
  return result;
}

function missionOver() {
  const won = world.phase === 'won';
  addKills(campaign.kills, world.kills);
  const n = campaign.mission + 1;
  ending = { won, bonus: false, result: null, shown: false, chimed: false };
  if (won) {
    ending.bonus = BONUS_AFTER.includes(n);
    if (ending.bonus) campaign.lives++;
  } else {
    campaign.lives--;
  }
  ending.lives = campaign.lives;
  renderHud();
  if (won && n >= MISSIONS.length) ending.result = closeCampaign(true, n);
  else if (!won && campaign.lives <= 0) ending.result = closeCampaign(false, n);
  else if (won) {
    campaign.mission = n;
    campaign.alive = null;
  } else {
    // Destroyed enemies stay destroyed on the retry.
    campaign.alive = survivors(world);
  }
  releaseInput();
  setPhase('ending');
  saver.flush();
}

function tickEnding() {
  if (!ending.shown && phaseT >= BANNER_AT) {
    ending.shown = true;
    if (ending.won) {
      showBanner({ title: t(ending.result ? 'tanks.victoryShort' : 'tanks.cleared'), sub: ending.bonus ? t('tanks.bonus') : '' });
      audio.play(ending.result ? 'victory' : 'clear');
    } else {
      showBanner({
        title: t('tanks.destroyed'),
        sub: ending.result ? t('tanks.gameOver') : t('tanks.livesLeft', { n: ending.lives }),
      });
      audio.play('lost');
    }
  }
  if (ending.bonus && !ending.chimed && phaseT >= BANNER_AT + 0.75) {
    ending.chimed = true;
    audio.play('bonus');
  }
  if (phaseT >= NEXT_AT) finishEnding();
}

function skipEnding() {
  if (phase === 'ending' && ending.shown && phaseT > BANNER_AT + 0.6) finishEnding();
}

function finishEnding() {
  const done = ending;
  ending = null;
  hideBanner();
  if (done.result) showResults(done.result);
  else beginMission();
}

function showResults(r) {
  backdrop = world;
  world = null;
  $('overTitle').textContent = t(r.victory ? 'tanks.victory' : 'tanks.gameOver');
  $('overMission').textContent = r.victory ? `${MISSIONS.length} / ${MISSIONS.length}` : String(r.reached);
  $('overKills').textContent = formatNumber(r.kills);
  $('newRecord').hidden = !r.record;
  renderTally($('tally'), r.tally);
  renderCheckpoints($('overCheckpoints'));
  showOverlay('over');
  setPhase('over');
}

function showMenu() {
  const start = $('startBtn');
  start.textContent = campaign ? t('tanks.continue', { n: campaign.mission + 1 }) : t('tanks.start');
  $('newBtn').hidden = !campaign;
  renderCheckpoints($('menuCheckpoints'));
  let record = '';
  if (stats.kills) {
    record =
      stats.best > MISSIONS.length
        ? t('tanks.recordAll', { kills: formatNumber(stats.kills) })
        : t('tanks.record', { kills: formatNumber(stats.kills), mission: stats.best });
  }
  $('record').textContent = record;
  $('help').textContent = t(touchUI ? 'tanks.helpTouch' : 'tanks.helpKeys');
  world = null;
  backdrop = createWorld(parseLevel(MISSIONS[campaign ? campaign.mission : 0]), { alive: campaign ? campaign.alive : null });
  renderer.reset();
  if (campaign) renderHud();
  showOverlay('menu');
  setPhase('menu');
}

async function chooseStart(index) {
  if (campaign && !(await confirmDialog(t('tanks.confirmNew'), { ok: t('tanks.newCampaign') }))) return;
  campaign = { mission: index, lives: LIVES, kills: {}, alive: null };
  beginMission();
}

/* ---------- Side menu: the home button's options, and the pause ---------- */

const menu = setupSideMenu($('sideMenu'), $('homeBtn'), { onOpen: hold, onClose: release });

/** Holds the game while the menu is open: a battle pauses (and is saved), a banner waits. */
function hold() {
  releaseInput();
  if (phase === 'play') {
    setPhase('paused');
    saver.flush();
  } else {
    stopLoop();
  }
  const held = ['paused', 'brief', 'ending'].includes(phase);
  $('menuTitle').hidden = !held;
  $('resumeBtn').hidden = !held;
  $('quitBtn').hidden = phase !== 'paused' && phase !== 'brief';
  $('soundToggle').checked = prefs.sound;
}

function release() {
  document.activeElement?.blur?.();
  if (phase === 'paused') setPhase('play');
  else if (LOOPING.includes(phase)) startLoop();
}

async function quit() {
  if (!(await confirmDialog(t('tanks.confirmQuit'), { ok: t('tanks.quit') }))) return;
  if (world) addKills(campaign.kills, world.kills);
  closeCampaign(false, campaign.mission + 1);
  saver.flush();
  showMenu();
  menu.close();
}

$('startBtn').addEventListener('click', () => {
  if (campaign) beginMission();
  else chooseStart(0);
});
$('newBtn').addEventListener('click', () => chooseStart(0));
$('againBtn').addEventListener('click', () => chooseStart(0));
$('resumeBtn').addEventListener('click', () => menu.close());
$('quitBtn').addEventListener('click', quit);
$('soundToggle').addEventListener('change', (event) => {
  prefs.sound = event.target.checked;
  audio.setMuted(!prefs.sound);
  savePrefs();
  if (prefs.sound) audio.unlock();
});

/* ---------- Page life ---------- */

function applyTouchUI() {
  document.body.classList.toggle('touch-ui', touchUI);
}

window.addEventListener(
  'touchstart',
  () => {
    if (touchUI) return;
    touchUI = true;
    applyTouchUI();
    fit();
    if (phase === 'menu') $('help').textContent = t('tanks.helpTouch');
  },
  { passive: true },
);

// Leaving the app pauses the battle; the player resumes deliberately.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (phase === 'play') menu.open();
    releaseInput();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else if (LOOPING.includes(phase)) {
    startLoop();
  }
});

window.addEventListener('blur', () => {
  releaseInput();
  if (phase === 'play') menu.open();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  renderer.readPalette();
  for (const el of document.querySelectorAll('canvas.badge')) paintBadge(el);
  draw();
});

// Sizing: the arena as big as the play area allows, under the header, turned upright on a
// tall screen. The touch controls float over it, so they take no room.
function fit() {
  if (!wrap.clientWidth || !wrap.clientHeight) return;
  renderer.layout(wrap.clientWidth, wrap.clientHeight);
  draw();
}

new ResizeObserver(fit).observe(wrap);

/* ---------- Boot ---------- */

applyTouchUI();
const saved = store.load('session', SCHEMA);
if (saved && isCampaign(saved.campaign)) {
  campaign = saved.campaign;
  if (saved.world && isWorld(saved.world)) {
    world = saved.world;
    renderHud();
    setPhase('paused');
    menu.open();
  } else {
    showMenu();
  }
} else {
  showMenu();
}
