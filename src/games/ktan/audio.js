// Ktan's sounds, synthesised with Web Audio (no audio files): the dice, a card dealt, a piece set
// down, a trade, the robber, your turn, a win. They follow the iOS silent switch and the app's one
// Sound switch in Settings (shared/sound.js).
import { watchSound } from '../../shared/sound.js';

export function createAudio() {
  let ctx = null;
  let out = null;
  let noise = null;
  let muted = false;
  const last = new Map();
  watchSound((on) => (muted = !on));

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch {
      /* not supported */
    }
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    out = ctx.createGain();
    out.gain.value = 0.45;
    const limiter = ctx.createDynamicsCompressor();
    out.connect(limiter);
    limiter.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /** Call from a tap: browsers only start audio inside a user gesture. */
  function unlock() {
    const c = ensure();
    if (c && c.state !== 'running') c.resume().catch(() => {});
  }

  function tone({ type = 'sine', from, to = from, dur, vol = 0.2, at = 0 }) {
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function hiss({ dur, vol = 0.3, type = 'bandpass', from = 1000, to = from, q = 1, at = 0 }) {
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  const SOUNDS = {
    // two dice rattling in a hand, then tumbling to a stop
    dice() {
      for (let i = 0; i < 9; i++) hiss({ dur: 0.035, vol: 0.22 - i * 0.012, from: 2600 + (i % 3) * 700, q: 3, at: i * 0.07 + Math.random() * 0.02 });
      for (let i = 0; i < 4; i++) tone({ type: 'triangle', from: 520 + i * 40, to: 300, dur: 0.05, vol: 0.05, at: 0.62 + i * 0.09 });
    },
    // a card, its edge brushing the air
    deal: () => hiss({ dur: 0.09, vol: 0.16, from: 5200, to: 2400, q: 0.8 }),
    card: () => {
      hiss({ dur: 0.14, vol: 0.18, from: 3800, to: 1600, q: 0.7 });
      tone({ from: 880, to: 1320, dur: 0.12, vol: 0.04, at: 0.04 });
    },
    // a wooden piece set down
    build: () => {
      tone({ type: 'triangle', from: 190, to: 120, dur: 0.12, vol: 0.22 });
      hiss({ dur: 0.05, vol: 0.12, from: 900, q: 1.5 });
      tone({ from: 660, to: 990, dur: 0.18, vol: 0.05, at: 0.08 });
    },
    // two brass coins
    trade: () => {
      tone({ type: 'triangle', from: 1320, dur: 0.16, vol: 0.06 });
      tone({ type: 'triangle', from: 1760, dur: 0.2, vol: 0.05, at: 0.07 });
    },
    steal: () => hiss({ dur: 0.22, vol: 0.14, from: 1600, to: 500, q: 0.9 }),
    robber: () => {
      hiss({ dur: 0.5, vol: 0.12, type: 'lowpass', from: 900, to: 200, q: 0.7 });
      tone({ from: 98, to: 73, dur: 0.5, vol: 0.12 });
    },
    award: () => [784, 988, 1175].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.22, vol: 0.05, at: i * 0.08 })),
    turn: () => {
      tone({ from: 660, dur: 0.16, vol: 0.06 });
      tone({ from: 990, dur: 0.24, vol: 0.05, at: 0.1 });
    },
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', from: f, dur: i === 4 ? 0.6 : 0.2, vol: 0.06, at: i * 0.11 })),
    tap: () => tone({ from: 1400, dur: 0.03, vol: 0.03 }),
    no: () => tone({ type: 'square', from: 220, to: 180, dur: 0.12, vol: 0.03 }),
  };

  return {
    unlock,
    play(name) {
      if (muted || !SOUNDS[name]) return;
      const c = ensure();
      if (!c || c.state !== 'running') return;
      const now = performance.now();
      if (now - (last.get(name) || 0) < 40) return;
      last.set(name, now);
      SOUNDS[name]();
    },
  };
}
