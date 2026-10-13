import { formatNumber, localize, t } from '../../shared/i18n.js';
import { createSaver, createStore } from '../../shared/storage.js';
import { registerSW } from '../../shared/sw-client.js';
import { confirmDialog } from '../../shared/ui.js';
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
  aimDir: null, // world angle from the aim stick
  aimPoint: null, // world point from the mouse or a finger on the arena
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
let arenaPointer = null; // a finger aiming on the arena
let skipPointer = null; // the touch that dismissed the mission banner; it doesn't also fire

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

const sticks = [];

function releaseInput() {
  for (const s of sticks) s.release();
  input.keys.clear();
  input.stick = { x: 0, y: 0 };
  input.guide = false;
  input.reticle = false;
  input.shots = 0;
  input.mine = false;
  arenaPointer = null;
}

function resetAim() {
  input.aimDir = null;
  input.aimPoint = null;
}

/** A floating thumb stick: it centres wherever the thumb lands inside its zone. */
function bindStick(zone, stick, { move, start = () => {}, end }) {
  const knob = stick.querySelector('.knob');
  let id = null;
  let ox = 0;
  let oy = 0;
  const radius = () => stick.offsetWidth / 2 || 48;
  const setKnob = (dx, dy) => {
    knob.style.setProperty('--kx', `${dx}px`);
    knob.style.setProperty('--ky', `${dy}px`);
  };
  const reset = () => {
    id = null;
    stick.classList.remove('active');
    stick.style.left = '';
    stick.style.top = '';
    setKnob(0, 0);
  };
  const track = (event) => {
    const rad = radius();
    const dx = event.clientX - ox;
    const dy = event.clientY - oy;
    const len = Math.hypot(dx, dy);
    const k = len > rad ? rad / len : 1;
    setKnob(dx * k, dy * k);
    move((dx * k) / rad, (dy * k) / rad, Math.min(1, len / rad));
  };
  zone.addEventListener('pointerdown', (event) => {
    if (id !== null || phase !== 'play') return;
    event.preventDefault();
    id = event.pointerId;
    zone.setPointerCapture?.(id);
    const r = zone.getBoundingClientRect();
    const margin = Math.min(radius(), r.width / 2, r.height / 2);
    ox = Math.max(r.left + margin, Math.min(r.right - margin, event.clientX));
    oy = Math.max(r.top + margin, Math.min(r.bottom - margin, event.clientY));
    stick.style.left = `${ox - r.left}px`;
    stick.style.top = `${oy - r.top}px`;
    stick.classList.add('active');
    start();
    track(event);
  });
  zone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== id) return;
    event.preventDefault();
    track(event);
  });
  const finish = (event) => {
    if (event.pointerId !== id) return;
    reset();
    end(event.type !== 'pointerup');
  };
  zone.addEventListener('pointerup', finish);
  zone.addEventListener('pointercancel', finish);
  zone.addEventListener('lostpointercapture', finish);
  const api = {
    release() {
      if (id === null) return;
      reset();
      end(true);
    },
  };
  sticks.push(api);
  return api;
}

bindStick($('moveZone'), $('moveStick'), {
  move(x, y) {
    input.stick = { x, y };
  },
  end() {
    input.stick = { x: 0, y: 0 };
  },
});

bindStick($('aimZone'), $('aimStick'), {
  start() {
    input.guide = true;
    input.reticle = false;
  },
  move(x, y, mag) {
    if (mag < 0.25) return;
    const v = renderer.vecToWorld(x, y);
    input.aimDir = Math.atan2(v.y, v.x);
    input.aimPoint = null;
  },
  end(cancelled) {
    input.guide = false;
    // A flick fires where it pointed; a tap fires wherever the turret points.
    if (!cancelled) queueShot();
  },
});

const mineBtn = $('mineBtn');
mineBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  mineBtn.classList.add('pressed');
  queueMine();
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  mineBtn.addEventListener(type, () => mineBtn.classList.remove('pressed'));
}

// The arena: a finger aims at a spot and fires on release; a mouse always aims.
function pointerWorld(event) {
  const r = canvas.getBoundingClientRect();
  return renderer.toWorld(event.clientX - r.left, event.clientY - r.top);
}

canvas.addEventListener('pointerdown', (event) => {
  if (phase !== 'play' || event.pointerId === skipPointer) return;
  event.preventDefault();
  const pt = pointerWorld(event);
  if (event.pointerType === 'mouse') {
    input.aimPoint = pt;
    input.guide = input.reticle = true;
    if (event.button === 0) queueShot();
    else if (event.button === 2) queueMine();
    return;
  }
  if (arenaPointer !== null) return;
  arenaPointer = event.pointerId;
  canvas.setPointerCapture?.(arenaPointer);
  input.aimPoint = pt;
  input.guide = input.reticle = true;
});

canvas.addEventListener('pointermove', (event) => {
  if (phase !== 'play') return;
  if (event.pointerType === 'mouse') {
    input.aimPoint = pointerWorld(event);
    input.guide = input.reticle = true;
  } else if (event.pointerId === arenaPointer) {
    input.aimPoint = pointerWorld(event);
  }
});

function arenaUp(event) {
  if (event.pointerId !== arenaPointer) return;
  arenaPointer = null;
  input.guide = input.reticle = false;
  if (event.type === 'pointerup') queueShot();
}

canvas.addEventListener('pointerup', arenaUp);
canvas.addEventListener('pointercancel', arenaUp);
canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'mouse') input.reticle = false;
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

// iOS: no scrolling, zooming or back-swipes from the arena or the controls.
for (const el of [canvas, $('moveZone'), $('aimZone'), mineBtn]) {
  el.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  el.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
}

// Any touch or key during the mission banner starts the mission.
document.addEventListener(
  'pointerdown',
  (event) => {
    skipPointer = null;
    if (phase === 'brief' && phaseT > 0.35) {
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
  if (document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey) return;
  audio.unlock();
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'p' || key === 'Escape') {
    if (phase === 'play') pause();
    else if (phase === 'paused') resume();
    else return;
    event.preventDefault();
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
  } else if (phase === 'paused' && (key === ' ' || key === 'Enter')) {
    event.preventDefault();
    resume();
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

const overlays = { menu: $('ovMenu'), pause: $('ovPause'), over: $('ovOver') };

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
  $('pauseBtn').disabled = next !== 'play';
  if (LOOPING.includes(next)) startLoop();
  else stopLoop();
}

function startLoop() {
  if (raf || document.hidden) return;
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

function pause() {
  if (phase !== 'play') return;
  releaseInput();
  $('soundToggle').checked = prefs.sound;
  showOverlay('pause');
  setPhase('paused');
  saver.flush();
}

function resume() {
  if (phase !== 'paused') return;
  showOverlay(null);
  document.activeElement?.blur?.();
  setPhase('play');
}

async function quit() {
  if (!(await confirmDialog(t('tanks.confirmQuit'), { ok: t('tanks.quit') }))) return;
  if (world) addKills(campaign.kills, world.kills);
  closeCampaign(false, campaign.mission + 1);
  saver.flush();
  showMenu();
}

$('startBtn').addEventListener('click', () => {
  if (campaign) beginMission();
  else chooseStart(0);
});
$('newBtn').addEventListener('click', () => chooseStart(0));
$('againBtn').addEventListener('click', () => chooseStart(0));
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
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
    if (phase === 'play') pause();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else if (LOOPING.includes(phase)) {
    startLoop();
  }
});

window.addEventListener('blur', () => {
  input.keys.clear();
  if (phase === 'play') pause();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  renderer.readPalette();
  for (const el of document.querySelectorAll('canvas.badge')) paintBadge(el);
  draw();
});

// Sizing. With the thumb pads under the arena (portrait), the arena is sized first and
// any spare height goes to the pads rather than to empty bands around the arena.
const play = document.querySelector('.play-tanks');
const sideways = matchMedia('(orientation: landscape) and (max-height: 600px)');
const PADS_MIN = 112;
const PADS_MAX = 210;

function fit() {
  if (touchUI && !sideways.matches) {
    const cs = getComputedStyle(play);
    const innerW = play.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const innerH = play.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.rowGap) || 0;
    if (innerW <= 0 || innerH <= PADS_MIN + gap) return;
    const size = renderer.layout(innerW, innerH - PADS_MIN - gap);
    const pads = Math.max(PADS_MIN, Math.min(PADS_MAX, Math.floor(innerH - size.height - gap)));
    play.style.setProperty('--controls-h', `${pads}px`);
  } else {
    play.style.removeProperty('--controls-h');
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    renderer.layout(wrap.clientWidth, wrap.clientHeight);
  }
  draw();
}

new ResizeObserver(fit).observe(play);
sideways.addEventListener?.('change', fit);

/* ---------- Boot ---------- */

applyTouchUI();
const saved = store.load('session', SCHEMA);
if (saved && isCampaign(saved.campaign)) {
  campaign = saved.campaign;
  if (saved.world && isWorld(saved.world)) {
    world = saved.world;
    renderHud();
    $('soundToggle').checked = prefs.sound;
    showOverlay('pause');
    setPhase('paused');
  } else {
    showMenu();
  }
} else {
  showMenu();
}
