// Sound effects synthesised with Web Audio: no audio files, nothing extra to precache.

export function createAudio() {
  let ctx = null;
  let out = null;
  let noise = null;
  let muted = false;
  const last = new Map();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      // iOS: follow the silent switch and mix with whatever else is playing.
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
    out.gain.value = 0.5;
    const limiter = ctx.createDynamicsCompressor();
    out.connect(limiter);
    limiter.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /** Call from a tap or key press: browsers only start audio inside a user gesture. */
  function unlock() {
    const c = ensure();
    if (c && c.state !== 'running') c.resume().catch(() => {});
  }

  function tone({ type = 'square', from, to = from, dur, vol = 0.2, at = 0 }) {
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

  const notes = (list, { type = 'square', step = 0.1, dur = 0.12, vol = 0.07, last = dur } = {}) =>
    list.forEach((f, i) => tone({ type, from: f, dur: i === list.length - 1 ? last : dur, vol, at: i * step }));

  const SOUNDS = {
    shot() {
      hiss({ dur: 0.09, vol: 0.32, from: 2200, to: 700, q: 0.8 });
      tone({ type: 'triangle', from: 190, to: 70, dur: 0.1, vol: 0.3 });
    },
    enemyShot() {
      hiss({ dur: 0.08, vol: 0.18, from: 1800, to: 600, q: 0.8 });
      tone({ type: 'triangle', from: 160, to: 60, dur: 0.09, vol: 0.16 });
    },
    rocket() {
      hiss({ dur: 0.22, vol: 0.24, type: 'highpass', from: 1500, to: 4200, q: 0.7 });
      tone({ type: 'sawtooth', from: 280, to: 880, dur: 0.16, vol: 0.05 });
    },
    missile() {
      // Lock-on: two quick high beeps, then the launch.
      tone({ type: 'square', from: 1320, dur: 0.045, vol: 0.07 });
      tone({ type: 'square', from: 1760, dur: 0.06, vol: 0.07, at: 0.07 });
      hiss({ dur: 0.3, vol: 0.16, type: 'highpass', from: 1200, to: 3200, q: 0.7, at: 0.05 });
    },
    spin(dur = 1.2) {
      // A minigun's motor winding up: a whine that climbs until the barrels are at speed.
      const d = Math.max(0.15, dur);
      tone({ type: 'sawtooth', from: 120, to: 520, dur: d, vol: 0.035 });
      tone({ type: 'triangle', from: 240, to: 1040, dur: d, vol: 0.05 });
    },
    minigun() {
      // One round: a short dry crack, light enough to repeat ten times a second.
      hiss({ dur: 0.04, vol: 0.14, from: 2600, to: 1200, q: 1.2 });
      tone({ type: 'square', from: 210, to: 110, dur: 0.035, vol: 0.05 });
    },
    lob(flight = 1.5) {
      // A thump from the tube, then a whistle that falls as the bomb does.
      tone({ type: 'sine', from: 150, to: 48, dur: 0.18, vol: 0.4 });
      hiss({ dur: 0.12, vol: 0.2, type: 'lowpass', from: 900, to: 200, q: 0.7 });
      tone({ type: 'sine', from: 1900, to: 620, dur: Math.max(0.3, flight - 0.3), vol: 0.035, at: 0.25 });
    },
    bounce() {
      tone({ type: 'triangle', from: 1500, to: 950, dur: 0.05, vol: 0.1 });
    },
    pop() {
      hiss({ dur: 0.06, vol: 0.14, from: 3000, q: 2 });
    },
    clash() {
      tone({ type: 'square', from: 1800, to: 600, dur: 0.06, vol: 0.06 });
      hiss({ dur: 0.05, vol: 0.18, from: 4000, q: 1 });
    },
    fizzle() {
      hiss({ dur: 0.12, vol: 0.14, from: 900, to: 300, q: 1 });
    },
    mine() {
      tone({ type: 'square', from: 660, dur: 0.06, vol: 0.06 });
      tone({ type: 'square', from: 990, dur: 0.07, vol: 0.06, at: 0.08 });
    },
    blast() {
      hiss({ dur: 0.9, vol: 0.65, type: 'lowpass', from: 1600, to: 110, q: 0.7 });
      tone({ type: 'sine', from: 90, to: 32, dur: 0.6, vol: 0.55 });
    },
    impact() {
      // A landing bomb: a shorter, tighter blast.
      hiss({ dur: 0.55, vol: 0.5, type: 'lowpass', from: 2000, to: 140, q: 0.7 });
      tone({ type: 'sine', from: 120, to: 40, dur: 0.4, vol: 0.45 });
    },
    destroyed() {
      hiss({ dur: 0.6, vol: 0.55, type: 'lowpass', from: 2400, to: 150, q: 0.7 });
      tone({ type: 'sine', from: 120, to: 40, dur: 0.4, vol: 0.45 });
    },
    crate() {
      hiss({ dur: 0.18, vol: 0.26, from: 700, to: 280, q: 3 });
    },
    start() {
      notes([392, 523, 659, 784], { step: 0.11, last: 0.25 });
    },
    clear() {
      notes([523, 659, 784, 1047, 784, 1047], { step: 0.09, dur: 0.1, last: 0.45, vol: 0.08 });
    },
    bonus() {
      notes([880, 1175, 1568, 1760], { type: 'triangle', step: 0.08, dur: 0.1, vol: 0.12 });
    },
    lost() {
      notes([440, 370, 311, 233], { type: 'triangle', step: 0.16, dur: 0.2, last: 0.5, vol: 0.12 });
    },
    victory() {
      notes([523, 523, 659, 784, 659, 784, 1047], { step: 0.12, dur: 0.11, last: 0.7, vol: 0.09 });
    },
  };

  function play(name, ...args) {
    if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
    // A burst of the same sound in one frame (several ricochets) plays once.
    const now = ctx.currentTime;
    if (now - (last.get(name) || -1) < 0.035) return;
    last.set(name, now);
    try {
      SOUNDS[name](...args);
    } catch {
      /* an audio glitch must never break the game */
    }
  }

  return {
    unlock,
    play,
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = !!value;
    },
  };
}
