import { formatNumber, localize, t } from '../../shared/i18n.js';
import { createSaver, createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { setSoundOn, watchSound } from '../../shared/sound.js';
import { closeSheet, confirmDialog, modalOpen, openSheet, setupSideMenu } from '../../shared/ui.js';
import { tapTarget } from './ai.js';
import { drawBadge } from './art.js';
import { createAudio } from './audio.js';
import { createWorld, isWorld, parseLevel, step, survivors } from './engine.js';
import { BONUS_AFTER, CHECKPOINTS, MISSIONS, TEST_MAX, testMap } from './missions.js';
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

// test: what the test range was last set to.
const prefs = { test: { kind: ENEMY_KINDS.at(-1), count: 1 }, ...(store.load('prefs', 1) || {}) };
if (!ENEMY_KINDS.includes(prefs.test?.kind) || !(prefs.test.count >= 1 && prefs.test.count <= TEST_MAX)) {
  prefs.test = { kind: ENEMY_KINDS.at(-1), count: 1 };
}
const stats = { best: 0, kills: 0, wins: 0, checkpoint: 1, ...(store.load('stats', 1) || {}) };
const savePrefs = () => store.save('prefs', 1, prefs);
const saveStats = () => store.save('stats', 1, stats);
// Sound used to be switched in this game's menu; a mute set there carries over to Settings once.
if ('sound' in prefs) {
  if (prefs.sound === false) setSoundOn(false);
  delete prefs.sound;
  savePrefs();
}
watchSound((on) => audio.setMuted(!on));

// The run in progress: { mission (0-based), lives, kills: { kind: n }, alive: enemy slots or null }.
let campaign = null;
// A test range run in progress, { kind, count }. It leaves the campaign alone: nothing in it
// counts, and it is never saved.
let test = null;
let world = null; // the mission (or test) being played
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
        world: !test && (phase === 'play' || phase === 'paused') ? world : null,
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

/**
 * Turns the turret straight at the nearest enemy in sight within TAP_RANGE (no ricochets, no
 * lead). With none, the aim stays put and the shot goes where you last aimed.
 */
function aimAtNearest() {
  const p = world.tanks[0];
  const target = tapTarget(world);
  if (!target) return;
  input.aimDir = Math.atan2(target.y - p.y, target.x - p.x);
  input.aimPoint = null;
}

// Touch: Brawl Stars-style floating sticks over the bottom half of the screen. A thumb anywhere
// on its left half drives, with the stick centred where it lands. On its right half, drag to aim
// and let go to fire, drag back to the middle to cancel, or just tap to fire at the nearest tank
// in sight (or, with none close, where you last aimed).
// The round button (right edge in landscape, between the sticks in portrait) lays a mine.
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

/** The enemy a tap on the aim stick would fire at right now, or null. */
function tapAim() {
  if (!touchUI || phase !== 'play') return null;
  // A thumb that has dragged aims by hand, and the one that started the mission fires nothing.
  if (aimStick.id !== null && (aimed || aimQuiet)) return null;
  return tapTarget(world);
}

/**
 * While a tap would fire at an enemy, the aim stick shines and the turret follows that enemy,
 * with the stick's shell pointing the same way. Once a thumb drags the stick, it aims by hand.
 */
function showTapAim() {
  const target = tapAim();
  aimEl.classList.toggle('ready', !!target);
  if (!target) {
    if (!(aimStick.id !== null && aimed)) aimEl.style.removeProperty('--ka');
    return;
  }
  const p = world.tanks[0];
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  input.aimDir = Math.atan2(dy, dx);
  input.aimPoint = null;
  const v = renderer.vecToScreen(dx, dy);
  aimEl.style.setProperty('--ka', `${Math.atan2(v.x, -v.y)}rad`);
}

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
      // The sticks start only on the bottom half of the screen, where the thumbs rest.
      if (touch.clientY < window.innerHeight / 2) continue;
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
  if (modalOpen() || event.metaKey || event.ctrlKey || event.altKey) return;
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
  const lives = $('livesStat');
  // A test has no lives: the stat goes, and the mission reads "Test".
  lives.parentElement.hidden = !!test;
  if (test) {
    $('missionStat').textContent = t('tanks.test');
  } else if (campaign) {
    $('missionStat').textContent = String(campaign.mission + 1);
    lives.textContent = String(campaign.lives);
  } else {
    $('missionStat').textContent = '--';
    lives.textContent = '-';
  }
  renderAmmo();
}

/** One icon per shell and per mine you hold, under the stats: filled while ready, hollow while out. */
function makeMeter(el, n, full, empty) {
  const slots = Array.from({ length: n }, () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon slot');
    for (const [cls, id] of [['full', full], ['empty', empty]]) {
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('class', cls);
      use.setAttribute('href', `#${id}`);
      svg.append(use);
    }
    return svg;
  });
  el.replaceChildren(...slots);
  return slots;
}

const meters = {
  shells: makeMeter($('shellMeter'), TYPES.player.bullets, 'i-shell', 'i-shell-empty'),
  mines: makeMeter($('mineMeter'), TYPES.player.mines, 'i-mine', 'i-mine-empty'),
};
const mineIcon = mineBtn.querySelector('.slot');
let ammoShown = '';

/** Shows how many shells and mines are ready; cheap when nothing changed, so it runs every frame. */
function renderAmmo() {
  const p = world?.tanks[0];
  const shells = p ? TYPES.player.bullets - owned(world.bullets, p) : TYPES.player.bullets;
  const mines = p ? TYPES.player.mines - owned(world.mines, p) : TYPES.player.mines;
  const key = `${shells}/${mines}`;
  if (key === ammoShown) return;
  ammoShown = key;
  meters.shells.forEach((el, i) => el.classList.toggle('is-used', i >= shells));
  meters.mines.forEach((el, i) => el.classList.toggle('is-used', i >= mines));
  mineIcon.classList.toggle('is-used', mines <= 0);
  $('ammo').setAttribute(
    'aria-label',
    t('tanks.ammo', { shells, maxShells: TYPES.player.bullets, mines, maxMines: TYPES.player.mines }),
  );
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
const NOTES = {
  hornet: 'tanks.note.hornet',
  red: 'tanks.note.red',
  white: 'tanks.note.white',
  olive: 'tanks.note.olive',
  lime: 'tanks.note.lime',
};

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

// The campaign menu, the test range and the results are docked sheets: the header and its side
// menu still work.
const sheets = { menu: $('startSheet'), test: $('testSheet'), over: $('overSheet') };

function showOverlay(name) {
  for (const [key, el] of Object.entries(sheets)) {
    if (key === name) openSheet(el, { docked: true });
    else closeSheet(el);
  }
}

function renderCheckpoints(box) {
  const open = CHECKPOINTS.filter((cp) => cp > 1 && cp <= stats.checkpoint);
  box.hidden = !open.length;
  if (!open.length) return box.replaceChildren();
  const label = document.createElement('h3');
  label.className = 'eyebrow';
  label.textContent = t('tanks.startAt');
  const row = document.createElement('div');
  row.className = 'sheet-actions';
  for (const cp of open) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = t('tanks.missionN', { n: cp });
    b.addEventListener('click', () => chooseStart(cp - 1));
    row.append(b);
  }
  box.replaceChildren(label, row);
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
  showTapAim();
  renderAmmo();
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
        if (e.weapon === 'rocket' || e.weapon === 'missile' || e.weapon === 'minigun') audio.play(e.weapon);
        else audio.play(e.player ? 'shot' : 'enemyShot');
        break;
      case 'spin':
        audio.play('spin', e.dur);
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
        break;
      case 'blast':
        audio.play(e.cause === 'bomb' ? 'impact' : 'blast');
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

/**
 * Puts a fresh world for `level` in play behind its banner: a campaign mission or a test run.
 * banner: title, name, sub (put before the enemy count) and note (before the warnings).
 */
function launch(level, { alive = null, title, name, sub = '', note = '' }) {
  world = createWorld(level, { seed: (Math.random() * 2 ** 31) | 0, alive });
  backdrop = null;
  renderer.reset();
  releaseInput();
  resetAim();
  showOverlay(null);
  setPhase('brief');
  const kinds = world.tanks.filter((tk) => tk.slot >= 0).map((tk) => tk.type);
  // The note (a mission's one-line briefing), then a warning for each kind that needs one.
  const notes = [note, ...Object.keys(NOTES).filter((kind) => kinds.includes(kind)).map((kind) => t(NOTES[kind]))];
  const text = notes.filter(Boolean).join(' ');
  briefS = Math.min(BRIEF_MAX, BRIEF_S + text.length * BRIEF_READ);
  const subs = [sub, t('tanks.enemies', { n: kinds.length })].filter(Boolean);
  showBanner({ title, name, sub: subs.join(' · '), kinds, note: text });
  renderHud();
  audio.play('start');
}

function beginMission() {
  test = null;
  const n = campaign.mission + 1;
  stats.best = Math.max(stats.best, n);
  for (const cp of CHECKPOINTS) if (n >= cp) stats.checkpoint = Math.max(stats.checkpoint, cp);
  saveStats();
  launch(parseLevel(MISSIONS[campaign.mission]), {
    alive: campaign.alive,
    title: t('tanks.missionN', { n }),
    name: t(`tanks.name.${n}`),
    sub: n === MISSIONS.length ? t('tanks.final') : '',
    note: t(`tanks.brief.${n}`),
  });
  saver.flush();
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
  if (test) {
    // A test only says how it went, then goes back to the test range.
    ending = { won, test: true, shown: false };
    releaseInput();
    setPhase('ending');
    return;
  }
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
    if (ending.test) {
      showBanner({ title: t(ending.won ? 'tanks.testCleared' : 'tanks.destroyed') });
      audio.play(ending.won ? 'clear' : 'lost');
    } else if (ending.won) {
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
  if (done.test) showTest();
  else if (done.result) showResults(done.result);
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
  test = null;
  world = null;
  backdrop = createWorld(parseLevel(MISSIONS[campaign ? campaign.mission : 0]), { alive: campaign ? campaign.alive : null });
  renderer.reset();
  renderHud();
  showOverlay('menu');
  setPhase('menu');
}

/* ---------- Test range: any one kind, 1 to TEST_MAX of them, on a four-wall map ---------- */

const testKinds = $('testKinds');
const testCount = $('testCount');

function choice(attrs, ...content) {
  const b = document.createElement('button');
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.append(...content);
  return b;
}

/** Marks the picked enemy and count, and draws the range with them behind the sheet. */
function renderTest() {
  const { kind, count } = prefs.test;
  if (!testKinds.children.length) {
    testKinds.append(...ENEMY_KINDS.map((k) => choice({ 'data-kind': k, 'aria-label': t(`tanks.type.${k}`) }, badge(k))));
    for (let n = 1; n <= TEST_MAX; n++) testCount.append(choice({ 'data-count': n }, String(n)));
  }
  for (const b of testKinds.children) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
  for (const b of testCount.children) b.setAttribute('aria-pressed', String(Number(b.dataset.count) === count));
  $('testKindLabel').textContent = `${t('tanks.testEnemy')} · ${t(`tanks.type.${kind}`)}`;
  backdrop = createWorld(parseLevel(testMap(kind, count)));
  renderer.reset();
  draw();
}

function showTest() {
  test = null;
  world = null;
  renderTest();
  renderHud();
  showOverlay('test');
  setPhase('menu');
}

function pickTest(change) {
  Object.assign(prefs.test, change);
  savePrefs();
  renderTest();
}

function beginTest() {
  const { kind, count } = prefs.test;
  test = { kind, count };
  launch(parseLevel(testMap(kind, count)), { title: t('tanks.test'), name: t(`tanks.type.${kind}`) });
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
  $('quitBtn').hidden = phase !== 'paused' && phase !== 'brief';
  $('quitLabel').textContent = t(test ? 'tanks.testEnd' : 'tanks.quit');
}

function release() {
  document.activeElement?.blur?.();
  if (phase === 'paused') setPhase('play');
  else if (LOOPING.includes(phase)) startLoop();
}

async function quit() {
  if (test) {
    // Nothing to lose in a test: straight back to the range.
    showTest();
    menu.close();
    return;
  }
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
$('testBtn').addEventListener('click', showTest);
$('testClose').addEventListener('click', showMenu);
$('testStart').addEventListener('click', beginTest);
testKinds.addEventListener('click', (event) => {
  const b = event.target.closest('button');
  if (b) pickTest({ kind: b.dataset.kind });
});
testCount.addEventListener('click', (event) => {
  const b = event.target.closest('button');
  if (b) pickTest({ count: Number(b.dataset.count) });
});
$('againBtn').addEventListener('click', () => chooseStart(0));
$('resumeBtn').addEventListener('click', () => menu.close());
$('quitBtn').addEventListener('click', quit);

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
