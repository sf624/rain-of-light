// Calm generative music for the rain: a slow pad in D major, soft bells now
// and then (and with every wave of light), the hush of rain, and a long reverb.
// Web Audio only, no files. Browsers start sound only after a click or a key.

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pickOf = (list) => list[Math.floor(Math.random() * list.length)];

// Chords as MIDI notes, all within D major, so any one may follow any other.
const CHORDS = [
  [50, 57, 64, 66, 69], // D add9
  [47, 54, 61, 62, 66], // Bm add9
  [43, 50, 54, 57, 62], // G maj9
  [45, 52, 59, 61, 64], // A sus2
  [40, 47, 54, 57, 62], // Em9
];
const BELLS = [74, 76, 78, 81, 83, 86, 88]; // D major pentatonic, high

export function createAudio({ settings }) {
  let ctx = null, master = null, bus = null, verb = null, rainGain = null;
  let on = false, chord = -1, timers = [];

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    // Everything goes to the bus (dry) and, through a send, to the reverb.
    bus = ctx.createGain();
    bus.connect(master);
    verb = ctx.createConvolver();
    verb.buffer = impulse(6);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet).connect(master);

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

  // One chord of the pad: each note two soft oscillators through a slowly
  // breathing low-pass filter, faded in and out over many seconds.
  function padChord(notes, hold) {
    const t = ctx.currentTime, attack = 7, release = 10;
    const level = 0.045 * settings.music;
    for (const [i, m] of notes.entries()) {
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(level * (i === 0 ? 1.3 : 1), t + attack);
      out.gain.setValueAtTime(level * (i === 0 ? 1.3 : 1), t + hold);
      out.gain.linearRampToValueAtTime(0, t + hold + release);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = rand(600, 900);
      filter.Q.value = 0.4;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rand(0.03, 0.08);
      const depth = ctx.createGain();
      depth.gain.value = 300;
      lfo.connect(depth).connect(filter.frequency);
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.5, 0.5);
      filter.connect(out).connect(pan);
      pan.connect(bus);
      pan.connect(send(0.8));
      const end = t + hold + release + 0.1;
      for (const [type, cents] of [['sine', -4], ['triangle', 4]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(m);
        o.detune.value = cents + rand(-2, 2);
        o.connect(filter);
        o.start(t);
        o.stop(end);
      }
      lfo.start(t);
      lfo.stop(end);
    }
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

  // A soft bell: a sine with two faint overtones, ringing out for seconds.
  function bell(pan = rand(-0.7, 0.7), strength = 1) {
    if (!on || settings.chimes <= 0) return;
    const t = ctx.currentTime;
    const f = mtof(pickOf(BELLS));
    const env = ctx.createGain();
    const peak = 0.07 * settings.chimes * strength;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    env.connect(p);
    p.connect(bus);
    p.connect(send(1.2));
    for (const [ratio, gain] of [[1, 1], [2.01, 0.18], [3.02, 0.06]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(env);
      o.start(t);
      o.stop(t + 6.2);
    }
  }

  function bells() {
    if (!on) return;
    bell(rand(-0.7, 0.7), rand(0.4, 0.8));
    later(bells, rand(5, 13) * 1000);
  }

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function start() {
    if (on) return;
    if (!ctx) build();
    ctx.resume();
    on = true;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(1, t + 3);
    nextChord();
    later(bells, 4000);
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
    ripple(pan) { bell(pan, 1); },
    // The hush follows the weather: 0 light rain .. 1 downpour.
    rain(amount) {
      if (!ctx || !on) return;
      rainGain.gain.setTargetAtTime((0.15 + 0.85 * amount) * settings.rainSound * 0.5, ctx.currentTime, 1.5);
    },
  };
}
