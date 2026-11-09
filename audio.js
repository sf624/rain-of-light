// Calm generative music for the rain: a slow pad in D major, a soft bell with
// every wave of light, the hush of rain, and a long reverb.
// Web Audio only, no files. Browsers start sound only after a click or a key.
// What changes slowly (the bells' pitch and strength, the pad's brightness,
// the hush of rain) sways with 1/f fluctuation, see sway.js.

import { createSway } from './sway.js';

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

// Chords as MIDI notes, all within D major, so any one may follow any other.
const CHORDS = [
  [50, 57, 64, 66, 69], // D add9
  [47, 54, 61, 62, 66], // Bm add9
  [43, 50, 54, 57, 62], // G maj9
  [45, 52, 59, 61, 64], // A sus2
  [40, 47, 54, 57, 62], // Em9
];
const BELLS = [62, 64, 66, 69, 71, 74, 76, 78, 81]; // D major pentatonic

export function createAudio({ settings }) {
  let ctx = null, master = null, bus = null, verb = null, rainGain = null, clickBuf = null;
  let padBus = null;  // the pad, swelling with the breath
  let on = false, chord = -1, timers = [];
  let bright = null;                                    // the pad's brightness, shared by every voice
  const padSway = createSway({ fastest: 1, octaves: 6 });  // seconds: 1 s .. about a minute
  const bellPitch = createSway({ fastest: 1, octaves: 5 }); // per bell: which note (a 1/f melody)
  const bellLoud = createSway({ fastest: 1, octaves: 4 });  // per bell: how strong
  const TICK = 0.25;                                    // seconds between brightness updates

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    bright = ctx.createConstantSource();
    bright.offset.value = 0;
    bright.start();

    // Everything goes to the bus (dry) and, through a send, to the reverb.
    bus = ctx.createGain();
    bus.connect(master);
    verb = ctx.createConvolver();
    verb.buffer = impulse(6);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet).connect(master);

    clickBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const cd = clickBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() * 2 - 1;

    // Rain: pink noise, softened.
    const noise = ctx.createBufferSource();
    noise.buffer = pinkNoise(6);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    padBus = ctx.createGain();
    padBus.connect(bus);
    padBus.connect(send(0.7));

    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    noise.connect(lp).connect(hp).connect(rainGain);
    rainGain.connect(bus);
    rainGain.connect(send(0.3));
    noise.start();
  }

  function send(level) {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(verb);
    return g;
  }

  // A room of about `seconds`: stereo noise that dies away.
  function impulse(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * i / n) * (1 - i / n);
    }
    return buf;
  }

  function pinkNoise(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) { // Paul Kellet's filter
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.08;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  // One chord of the pad: each note a sine, a triangle and a faint saw,
  // slightly apart in tune, through a slowly breathing low-pass filter; the
  // upper notes also sound softly an octave up. Faded in and out over seconds.
  function padChord(notes, hold) {
    const t = ctx.currentTime, attack = 7, release = 10;
    const level = 0.048 * settings.music;
    const end = t + hold + release + 0.1;
    for (const [i, m] of notes.entries()) {
      const peak = level * (i === 0 ? 1.3 : 1);
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(peak, t + attack);
      out.gain.setValueAtTime(peak, t + hold);
      out.gain.linearRampToValueAtTime(0, t + hold + release);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = rand(1100, 1600);
      filter.Q.value = 0.7;
      bright.connect(filter.frequency);
      later(() => bright.disconnect(filter.frequency), (end - t + 0.5) * 1000);
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.6, 0.6);
      filter.connect(out).connect(pan);
      pan.connect(padBus);
      const layers = [['sine', 0, -4, 1], ['triangle', 0, 4, 0.8], ['sawtooth', 0, rand(-8, 8), 0.12]];
      if (i >= notes.length - 2) layers.push(['sine', 12, rand(-3, 3), 0.22]); // the airy top
      for (const [type, up, cents, gain] of layers) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(m + up);
        o.detune.value = cents + rand(-2, 2);
        const g = ctx.createGain();
        g.gain.value = gain;
        o.connect(g).connect(filter);
        o.start(t);
        o.stop(end);
      }
    }
  }

  // The pad opens and closes slowly, with 1/f fluctuation.
  function tick() {
    if (!on) return;
    bright.offset.setTargetAtTime(650 * padSway(TICK), ctx.currentTime, 0.6);
    later(tick, TICK * 1000);
  }

  function nextChord() {
    if (!on) return;
    let i;
    do i = Math.floor(Math.random() * CHORDS.length); while (i === chord);
    chord = i;
    const hold = rand(14, 20);
    padChord(CHORDS[chord], hold);
    later(nextChord, (hold - 2) * 1000); // the next one swells as this one fades
  }

  // A bell like a small singing bowl: a low hum, the note, and inharmonic
  // overtones, each a pair a hair apart in tune (so it shimmers), each dying
  // away at its own pace, the high ones first; a soft mallet starts it.
  const PARTIALS = [ // ratio to the note, level, seconds to die away
    [0.5, 0.16, 9], [1, 1, 7], [2.0, 0.2, 4.5], [2.76, 0.14, 3.2], [5.4, 0.05, 1.6], [8.93, 0.02, 0.9],
  ];
  function bell(pan = rand(-0.7, 0.7), strength = 1) {
    if (!on || settings.chimes <= 0) return;
    const t = ctx.currentTime;
    const step = (bellPitch(1) + 1) / 2 * (BELLS.length - 1);
    const f = mtof(BELLS[Math.round(step)]);
    const peak = 0.06 * settings.chimes * strength;
    const center = Math.max(-1, Math.min(1, pan));
    for (const [ratio, level, decay] of PARTIALS) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak * level, t + 0.004 + 0.004 / ratio);
      g.gain.exponentialRampToValueAtTime(0.00005, t + decay);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, center + rand(-0.2, 0.2)));
      g.connect(p);
      p.connect(bus);
      p.connect(send(1.1));
      for (const [beat, gain] of [[0, 1], [rand(0.6, 1.6), 0.6]]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * ratio + beat;
        const og = ctx.createGain();
        og.gain.value = gain;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + decay + 0.1);
      }
    }
    // The mallet: a breath of noise around the overtones, gone in a moment.
    const n = ctx.createBufferSource();
    n.buffer = clickBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 3;
    bp.Q.value = 1.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(peak * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.00005, t + 0.06);
    const np = ctx.createStereoPanner();
    np.pan.value = center;
    n.connect(bp).connect(ng).connect(np);
    np.connect(bus);
    np.connect(send(0.6));
    n.start(t);
  }

  function later(fn, ms) {
    const id = setTimeout(() => { timers = timers.filter((x) => x !== id); fn(); }, ms);
    timers.push(id);
  }

  function start() {
    if (on) return;
    if (!ctx) build();
    ctx.resume();
    on = true;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(settings.volume, t + 3);
    nextChord();
    tick();
  }

  function stop() {
    if (!on) return;
    on = false;
    timers.forEach(clearTimeout);
    timers = [];
    chord = -1;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + 2);
  }

  return {
    get on() { return on; },
    start,
    stop,
    toggle() { if (on) stop(); else start(); },
    // A wave of light rings a bell, panned to where it is seen.
    ripple(pan) { bell(pan, 0.65 + 0.3 * bellLoud(1)); },
    // The pad's level with the breath, 0 .. 1.
    breath(k) {
      if (!ctx || !on) return;
      padBus.gain.setTargetAtTime(k, ctx.currentTime, 0.1);
    },
    // The overall volume, 0 .. 1, eased so a dragged slider does not crackle.
    volume() {
      if (!ctx || !on) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.05);
    },
    // The hush follows the weather (0 light rain .. 1 downpour) and the sway
    // the light rain sways with (-1 .. 1), so sound and light swell together.
    rain(amount, sway = 0) {
      if (!ctx || !on) return;
      const level = (0.15 + 0.85 * amount) * (1 + 0.4 * sway) * settings.rainSound * 0.5;
      rainGain.gain.setTargetAtTime(level, ctx.currentTime, 1.5);
    },
  };
}
