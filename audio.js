// Calm generative music for the rain: a slow pad in D major, a soft bell with
// every wave of light, the hush of rain, and a long reverb.
// Web Audio only, no files. Browsers start sound only after a click or a key.
// What changes slowly (the bells' pitch and strength, the pad's brightness,
// the hush of rain) sways with 1/f fluctuation, see sway.js.
//
// The music follows the show (main.js hands its state in every frame, see
// rain(), forms() and breath()): what the eye sees change, the ear hears
// change at the same moment. The show's own fades are the clock; the music
// only eases a little behind them.
// - Each form of light has a voice that swells and fades with it: the orb a
//   warm, low hum; the spiral a slow figure of notes that turns; the cloud a
//   high, airy shimmer; the ring a clear, glassy tone; the veil a soft, open
//   air; the solid a still chord of pure fifths; the attractor a figure that
//   wanders between a low and a high wing, never the same way twice; the
//   knot two tones that beat against each other, each at its own pace; the
//   fractal one fifth in every octave, each softer. As a form gathers, a
//   chord of its own blooms; as it leaves, the harmony comes home to D. Each
//   voice comes from where its form is seen.
// - With a form the pad opens (brighter); in rain it is veiled.
// - In a still room (no rain, no form) the pad thins out, and now and then a
//   high, soft note falls, like the room's pale drops.
// - The breath: a low tone under the pad swells as the light does.

import { createSway } from './sway.js';
import { lorenzStep } from './lorenz.js';

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Chords as MIDI notes, all within D major, so any one may follow any other.
const CHORDS = [
  [50, 57, 64, 66, 69], // D add9
  [47, 54, 61, 62, 66], // Bm add9
  [43, 50, 54, 57, 62], // G maj9
  [45, 52, 59, 61, 64], // A sus2
  [40, 47, 54, 57, 62], // Em9
];
const HOME = 0;                                          // where the harmony rests as a form leaves
const BELLS = [62, 64, 66, 69, 71, 74, 76, 78, 81]; // D major pentatonic
// The forms' voices, and the chord each one brings when it gathers: the orb
// (warm palettes) the low, warm G; the spiral the open, unresolved A sus2;
// the cloud and the veil the soft Em9; the ring the still B minor; the solid
// the A sus2 (it is made of fifths); the attractor the restless B minor; the
// knot the G; the fractal D itself.
const FORM_CHORD = { orb: 2, spiral: 3, cloud: 4, ring: 1, veil: 4, solid: 3, attractor: 1, knot: 2, fractal: 0 };
const VOICES = Object.keys(FORM_CHORD);
const AIRY = { cloud: 0.012, veil: 0.007 };              // the forms with the air of the noise, and how much
const SETTLE = 6;    // s: a chord a form brought is not changed again sooner

export function createAudio({ settings }) {
  let ctx = null, master = null, bus = null, verb = null, rainGain = null, clickBuf = null;
  let padBus = null;  // the pad, swelling with the breath
  let swell = null;   // the low tone under the pad, swelling more
  let on = false, chord = -1, timers = [];
  let bright = null;                                    // the pad's brightness, shared by every voice
  const padSway = createSway({ fastest: 1, octaves: 6 });  // seconds: 1 s .. about a minute
  const bellPitch = createSway({ fastest: 1, octaves: 5 }); // per bell: which note (a 1/f melody)
  const bellLoud = createSway({ fastest: 1, octaves: 4 });  // per bell: how strong
  const TICK = 0.25;                                    // seconds between brightness updates

  // What the show shows, as last handed in (kept while the sound is off, so
  // it starts in step).
  const zero = () => Object.fromEntries(VOICES.map((name) => [name, 0]));
  const heard = { falling: 1, breath: 1, w: zero(), pan: zero() };
  const present = new Set();                            // forms whose voice has begun
  const leaving = new Set();                            // forms that have begun to go
  const voice = {};                                     // per form: its gain and pan
  // The chord now: when it began, how long it holds, why it came, and the
  // fades its voices sound through (to let it go early).
  let now = { at: -Infinity, hold: 0, why: 'time', fades: [] };
  let chordTimer = 0;
  let arpAt = 0, arpStep = 0, arpPan = 0, dropAt = 0;
  let wingAt = 0, wing = [2, 3, 20];                    // the attractor's figure: its next note, and where its own path is

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
    swell = ctx.createGain();
    swell.connect(padBus);

    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    noise.connect(lp).connect(hp).connect(rainGain);
    rainGain.connect(bus);
    rainGain.connect(send(0.3));
    noise.start();

    // The forms' voices: each through its own gain (the form's weight) and
    // pan (where the form is seen).
    for (const name of VOICES) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      g.connect(p);
      p.connect(bus);
      p.connect(send(0.9));
      voice[name] = { g, p };
    }
    // The air of the cloud and the veil: the rain's noise, high and narrow, very soft.
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = 3800;
    air.Q.value = 0.9;
    noise.connect(air);
    for (const [name, level] of Object.entries(AIRY)) {
      const airGain = ctx.createGain();
      airGain.gain.value = level;
      air.connect(airGain).connect(voice[name].g);
    }
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

  // A gain the chord now sounds through to `dest`, so it can be let go early.
  function fadeTo(dest) {
    const g = ctx.createGain();
    g.connect(dest);
    now.fades.push(g);
    return g;
  }

  // One sustained note: oscillator layers [type, semitones up, cents, gain]
  // through a low-pass, faded in over `attack` and out after `hold`.
  function sustain(m, layers, { t, hold, attack = 7, release = 10, peak, cutoff, pan, dest, follow = true }) {
    const top = t + Math.max(attack, hold), end = top + release + 0.1;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + attack);
    out.gain.setValueAtTime(peak, top);
    out.gain.linearRampToValueAtTime(0, top + release);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    if (follow) bright.connect(filter.frequency);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    filter.connect(out).connect(p).connect(dest);
    let last = null;
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
      last = o;
    }
    // Let go of the shared brightness when the voice ends (a timer would not
    // survive the sound being turned off).
    if (follow) last.onended = () => bright.disconnect(filter.frequency);
  }

  // One chord of the pad: each note a sine, a triangle and a faint saw,
  // slightly apart in tune, through a slowly breathing low-pass filter; the
  // upper notes also sound softly an octave up. Faded in and out over seconds.
  // Under it, the root an octave down swells with the breath; and each form
  // that shows adds its voice.
  function padChord(notes, hold) {
    const t = ctx.currentTime;
    const level = 0.048 * settings.music;
    const dest = fadeTo(padBus);
    for (const [i, m] of notes.entries()) {
      const layers = [['sine', 0, -4, 1], ['triangle', 0, 4, 0.8], ['sawtooth', 0, rand(-8, 8), 0.12]];
      if (i >= notes.length - 2) layers.push(['sine', 12, rand(-3, 3), 0.22]); // the airy top
      sustain(m, layers, { t, hold, peak: level * (i === 0 ? 1.3 : 1), cutoff: rand(1100, 1600), pan: rand(-0.6, 0.6), dest });
    }
    sustain(notes[0] - 12, [['sine', 0, 0, 1], ['triangle', 0, 3, 0.5]],
      { t, hold, peak: level * 0.9, cutoff: 380, pan: 0, dest: fadeTo(swell), follow: false });
    for (const name of VOICES) if (present.has(name)) formLayer(name, notes, t, hold);
  }

  // A form's voice on this chord. The spiral's and the attractor's are
  // figures of notes (see tick); the others are held, like the pad.
  function formLayer(name, notes, t, hold) {
    if (name === 'spiral' || name === 'attractor' || settings.formSound <= 0) return;
    const level = { orb: 0.035, cloud: 0.025, ring: 0.02, veil: 0.022, solid: 0.022, knot: 0.024, fractal: 0.022 }[name];
    const dest = fadeTo(voice[name].g);
    if (name === 'orb') {
      // Warm and low: the root, its fifth and its octave, soft and dark.
      const r = notes[0];
      sustain(r, [['triangle', 0, -3, 1], ['sine', 0, 3, 0.8]], { t, hold, attack: 6, peak: level, cutoff: 700, pan: -0.2, dest, follow: false });
      sustain(r + 7, [['sine', 0, 0, 1], ['triangle', 0, 5, 0.4]], { t, hold, attack: 7, peak: level * 0.8, cutoff: 800, pan: 0.2, dest, follow: false });
      sustain(r + 12, [['sine', 0, -2, 1], ['triangle', 0, 2, 0.5]], { t, hold, attack: 8, peak: level * 0.6, cutoff: 900, pan: 0, dest, follow: false });
    } else if (name === 'cloud') {
      // Airy and high: the top notes two octaves up, each a pair a little
      // apart (a slow shimmer), with the air of the noise.
      for (const [i, m] of notes.slice(-3).entries()) {
        sustain(m + 24, [['sine', 0, -7, 1], ['sine', 0, 7, 1]],
          { t, hold, attack: 8, peak: level * 0.22, cutoff: 6000, pan: (i - 1) * 0.6, dest, follow: false });
      }
      for (const [i, m] of notes.slice(-2).entries()) {
        sustain(m + 12, [['sine', 0, -5, 1], ['triangle', 0, 5, 0.3]],
          { t, hold, attack: 7, peak: level * 0.35, cutoff: 3000, pan: i ? 0.4 : -0.4, dest, follow: false });
      }
    } else if (name === 'ring') {
      // Clear and glassy: the root and its fifth two octaves up, pure sines,
      // each a pair a hair apart in tune, so the tone turns slowly.
      const r = notes[0];
      sustain(r + 24, [['sine', 0, -3, 1], ['sine', 0, 3, 1]], { t, hold, attack: 9, peak: level * 0.3, cutoff: 5000, pan: -0.15, dest, follow: false });
      sustain(r + 31, [['sine', 0, -2, 1], ['sine', 0, 2, 1]], { t, hold, attack: 10, peak: level * 0.18, cutoff: 5000, pan: 0.15, dest, follow: false });
    } else if (name === 'veil') {
      // Soft and open: the top two notes an octave up, slowly beating sines
      // that swell late, with a little of the air.
      for (const [i, m] of notes.slice(-2).entries()) {
        sustain(m + 12, [['sine', 0, -6, 1], ['sine', 0, 6, 0.8]],
          { t, hold, attack: 10, peak: level * 0.3, cutoff: 2500, pan: i ? 0.35 : -0.35, dest, follow: false });
      }
    } else if (name === 'solid') {
      // Still and pure: three fifths, one on the other, from the root an
      // octave up; plain sines, hardly beating.
      const r = notes[0] + 12;
      for (const [i, up] of [0, 7, 14].entries()) {
        sustain(r + up, [['sine', 0, -1.5, 1], ['sine', 0, 1.5, 1]],
          { t, hold, attack: 8 + i, peak: level * [0.5, 0.36, 0.24][i], cutoff: 4000, pan: (i - 1) * 0.3, dest, follow: false });
      }
    } else if (name === 'knot') {
      // Two lines that cross: two notes of the chord an octave up, each a
      // pair a little apart in tune, the one beating half again as fast as
      // the other.
      sustain(notes[2] + 12, [['sine', 0, -6, 1], ['triangle', 0, 6, 0.6]], { t, hold, attack: 8, peak: level * 0.42, cutoff: 2200, pan: -0.4, dest, follow: false });
      sustain(notes[3] + 12, [['sine', 0, -9, 1], ['triangle', 0, 9, 0.6]], { t, hold, attack: 9, peak: level * 0.36, cutoff: 2200, pan: 0.4, dest, follow: false });
    } else if (name === 'fractal') {
      // The same in every octave: the root and its fifth, an octave up, two
      // and three, each half as loud as the one below.
      const r = notes[0];
      for (const [i, up] of [12, 24, 36].entries()) {
        sustain(r + up, [['triangle', 0, -3, 1], ['sine', 0, 3, 0.8]], { t, hold, attack: 7 + i, peak: level * 0.5 / 2 ** i, cutoff: 1400 * 2 ** i, pan: -0.25, dest, follow: false });
        sustain(r + up + 7, [['sine', 0, 2, 1], ['triangle', 0, -2, 0.5]], { t, hold, attack: 8 + i, peak: level * 0.36 / 2 ** i, cutoff: 1400 * 2 ** i, pan: 0.25, dest, follow: false });
      }
    }
  }

  // A short, soft note: a sine and a glassy overtone, dying away. The
  // spiral's figure and the still room's drops.
  function ping(m, at, { peak, decay, pan, dest, verbSend = 1 }) {
    const f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.00005, at + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p).connect(dest);
    if (verbSend) p.connect(send(verbSend));
    for (const [ratio, gain] of [[1, 1], [2.76, 0.12]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * ratio;
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(g);
      o.start(at);
      o.stop(at + decay + 0.05);
    }
  }

  // How much of the room is still: no rain falls and no form shows.
  const formsNow = () => Math.min(1, VOICES.reduce((sum, name) => sum + heard.w[name], 0));
  const stillness = () => (1 - heard.falling) * (1 - formsNow());

  // The pad opens and closes slowly, with 1/f fluctuation; and with the show.
  // The spiral's figure and the still room's drops are scheduled here, a
  // little ahead (a hidden tab runs this only once a second).
  function tick() {
    if (!on) return;
    const t = ctx.currentTime;
    const F = formsNow(), R = heard.falling, still = stillness();
    const breathe = swellOf(heard.breath);
    const open = 500 * F - 250 * R * (1 - F) - 250 * still + 150 * (breathe - 0.5);
    bright.offset.setTargetAtTime(650 * padSway(TICK) + open, t, 0.4);
    const ahead = t + 1.2;
    // The spiral: the chord's notes an octave up, climbing and turning back,
    // turning from one side to the other.
    if (heard.w.spiral > 0.02 && settings.formSound > 0 && chord >= 0) {
      if (arpAt < t) arpAt = t + 0.05;
      while (arpAt < ahead) {
        const notes = CHORDS[chord];
        const path = [0, 1, 2, 3, 4, 3, 2, 1];
        const m = notes[path[arpStep % path.length]] + 12;
        arpStep++;
        arpPan += 0.9;
        ping(m, arpAt, { peak: 0.05 * (arpStep % 4 === 1 ? 1 : 0.7), decay: 4.5, pan: 0.6 * Math.sin(arpPan), dest: voice.spiral.g, verbSend: 0 });
        arpAt += 3.2 + 0.7 * Math.sin(arpStep * 0.7);   // unhurried: a note, and room after it
      }
    }
    // The attractor: a note for each stretch of a path of its own through
    // the Lorenz equations: from the chord's low notes while the path is on
    // one wing, from its high notes an octave up on the other, from the side
    // that wing is on; the higher the path, the longer until the next.
    if (heard.w.attractor > 0.02 && settings.formSound > 0 && chord >= 0) {
      if (wingAt < t) wingAt = t + 0.05;
      while (wingAt < ahead) {
        for (let i = 0; i < 70; i++) wing = lorenzStep(wing);
        const notes = CHORDS[chord], right = wing[0] > 0;
        const n = Math.min(2, Math.floor(wing[2] / 16));
        ping(right ? notes[2 + n] + 12 : notes[n] + 12, wingAt,
          { peak: right ? 0.04 : 0.05, decay: 5, pan: clamp(wing[0] / 18, -0.7, 0.7), dest: voice.attractor.g, verbSend: 0 });
        wingAt += 2.0 + 1.6 * clamp(wing[2] / 45, 0, 1);
      }
    }
    // The still room: now and then a high, soft note, like a pale drop.
    if (still > 0.3 && settings.chimes > 0) {
      if (dropAt < t) dropAt = t + rand(1, 4);
      while (dropAt < ahead) {
        const m = BELLS[Math.floor(rand(3, BELLS.length))] + 12;
        ping(m, dropAt, { peak: 0.022 * settings.chimes * still, decay: 1.8, pan: rand(-0.8, 0.8), dest: bus, verbSend: 1.3 });
        dropAt += rand(2.5, 7) / still;
      }
    } else dropAt = 0;
    later(tick, TICK * 1000);
  }

  // The low tone's level with the breath: its rise, made deeper.
  const swellOf = (k) => clamp((k - 0.6) / 0.4, 0, 1) ** 2;

  // A new chord: one a form asks for, home as a form leaves, else any other.
  function nextChord(prefer, why = 'time') {
    if (!on) return;
    clearTimeout(chordTimer);
    timers = timers.filter((x) => x !== chordTimer);
    const t = ctx.currentTime;
    // A chord that comes early lets the one before go soon, while it swells
    // (so the two together stay about as loud as one).
    if (why !== 'time') for (const g of now.fades) g.gain.setTargetAtTime(0, t + 3, 3);
    let i = prefer;
    if (i === undefined && leaving.size && !present.size) i = HOME;
    if (i === undefined || i === chord) {
      do i = Math.floor(Math.random() * CHORDS.length); while (i === chord);
    }
    chord = i;
    const hold = rand(14, 20);
    now = { at: t, hold, why, fades: [] };
    padChord(CHORDS[chord], hold);
    chordTimer = later(() => nextChord(), (hold - 2) * 1000); // the next one swells as this one fades
  }

  // A form begins to show: its chord blooms (unless one just did), or its
  // voice joins the chord now.
  function arrive(name) {
    const t = ctx.currentTime;
    if (t - now.at > SETTLE || now.why === 'leave') nextChord(FORM_CHORD[name], 'arrive');
    else formLayer(name, CHORDS[chord], t, Math.max(4, now.at + now.hold - t));
  }

  // A form begins to go and none other comes: the harmony goes home.
  function depart() {
    const t = ctx.currentTime;
    if (!present.size && t - now.at > SETTLE && chord !== HOME) nextChord(HOME, 'leave');
  }

  // The pad's level: the breath, thinned in a still room, and making a little
  // room for a form's voice; and the low tone under it.
  function mixPad() {
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    padBus.gain.setTargetAtTime(heard.breath * (1 - 0.55 * stillness()) * (1 - 0.12 * formsNow()), t, 0.15);
    swell.gain.setTargetAtTime(swellOf(heard.breath), t, 0.15);
  }

  // The forms' voices: each as strong as its form, from where it is seen.
  // Rain through a form: fuller, not louder. Unchanged levels are left alone.
  function mixVoices() {
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    for (const name of VOICES) {
      const v = voice[name];
      const level = heard.w[name] * settings.formSound * (1 - 0.3 * heard.falling);
      if (Math.abs(level - (v.level ?? -1)) > 1e-4) v.g.gain.setTargetAtTime(v.level = level, t, 0.3);
      if (level > 0) v.p.pan.setTargetAtTime(heard.pan[name], t, 0.5);
    }
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
    return id;
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
    // The forms showing now sound from the start, without a chord of their own.
    present.clear();
    leaving.clear();
    for (const name of VOICES) if (heard.w[name] > 0.03) present.add(name);
    for (const name of VOICES) voice[name].level = undefined;
    mixPad();
    mixVoices();
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
      heard.breath = k;
      mixPad();
    },
    // The overall volume, 0 .. 1, eased so a dragged slider does not crackle.
    volume() {
      if (!ctx || !on) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.05);
    },
    // The hush follows the weather (0 light rain .. 1 downpour) and the sway
    // the light rain sways with (-1 .. 1), so sound and light swell together;
    // and how much rain falls at all (0 a still room .. 1 a rain passage).
    rain(amount, sway = 0, falling = 1) {
      heard.falling = falling;
      if (!ctx || !on) return;
      const level = (0.15 + 0.85 * amount) * (1 + 0.4 * sway) * (0.06 + 0.94 * falling) * settings.rainSound * 0.5;
      rainGain.gain.setTargetAtTime(level, ctx.currentTime, 1.5);
    },
    // The forms that show: [{ name, w (0 .. 1), out (it has begun to go),
    // pan (-1 .. 1, where it is seen) }]. Each one's voice follows its weight.
    forms(list) {
      for (const name of VOICES) heard.w[name] = 0;
      const going = new Set();
      for (const f of list) {
        if (!(f.name in heard.w)) continue;
        heard.w[f.name] = Math.max(heard.w[f.name], f.w);
        heard.pan[f.name] = clamp(f.pan || 0, -0.8, 0.8);
        if (f.out) going.add(f.name);
      }
      if (!ctx || !on) return;
      // Arrivals first: a form that turns into another does not go home first.
      for (const name of VOICES) {
        if (!present.has(name) && heard.w[name] > 0.03 && !going.has(name)) { present.add(name); leaving.delete(name); arrive(name); }
      }
      for (const name of VOICES) {
        const w = heard.w[name];
        if (present.has(name) && (going.has(name) || w < 0.01)) { present.delete(name); leaving.add(name); depart(); }
        else if (w < 0.01) leaving.delete(name);
      }
      mixVoices();
    },
  };

}
