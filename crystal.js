// The crystal scene's director: which forms of light show, where, how bright.
// Two slots: one for the sky forms (orb, spiral, cloud) one after another, and
// one for the layer of light near the floor, which comes and goes beside them.
// The timeline comes from hashes of one seed, so a time (?t=) gives its forms.

import { PALETTES, FORMS, LAYER } from './config.js';

const FADE = 7;                               // seconds to come, and to go
const ROOM = [0.35, 0.5, 1.0];                // the room's colour while no form shows
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const between = (a, b, r) => a + (b - a) * r;

export function createForms(S, { floor, seed = Math.random() * 1000 }) {
  // Episodes per slot: { start, dur, form, palette, r }, made as time goes on.
  const slots = [
    { list: [], next: -FADE * 0.6, hold: [36, 56], gap: [2, 6], pool: FORMS },
    { list: [], next: between(8, 20, hash(seed + 0.5)), hold: [40, 70], gap: [14, 40], pool: [LAYER] },
  ];
  function extend(slot, n, until) {
    while (slot.next < until) {
      const k = slot.list.length, r = hash(seed + n * 101 + k * 7.31);
      const prev = slot.list[k - 1];
      const others = slot.pool.filter((f) => f !== prev?.form);
      const options = others.length ? others : slot.pool; // the layer has only itself
      const form = options[Math.floor(hash(r * 91 + 1) * options.length) % options.length];
      const names = form.palettes;
      const palette = PALETTES.find((p) => p.name === names[Math.floor(hash(r * 53 + 2) * names.length) % names.length]);
      const dur = between(...slot.hold, hash(r * 17 + 3));
      slot.list.push({ start: slot.next, dur, form, palette, r });
      slot.next += dur + between(...slot.gap, hash(r * 29 + 4));
    }
  }
  // The episode a slot shows at time t, its weight (0..1) and age, or null.
  function at(n, t) {
    const slot = slots[n];
    extend(slot, n, t + 1);
    for (let i = slot.list.length - 1; i >= 0; i--) {
      const e = slot.list[i];
      if (t < e.start) continue;
      const age = t - e.start;
      if (age > e.dur) return null;
      return { e, age, w: smooth(age / FADE) * (1 - smooth((age - e.dur + FADE) / FADE)) };
    }
    return null;
  }
  // A forced choice holds one form, fully on.
  function held(form, t) {
    return { e: { form, palette: PALETTES.find((p) => p.name === form.palettes[0]), r: hash(seed) }, age: t, w: 1 };
  }

  const A = new Float32Array(8), B = new Float32Array(8), C = new Float32Array(6), D = new Float32Array(6);
  const yaw = new Float32Array(2);
  const tint = [...ROOM];

  // Where a form is at its age, how large, how turned.
  function place(k, { e, age, w }) {
    const { form, palette: p, r } = e;
    const ph = r * 6.2832;
    let centre = [0, 0, 0], size = 1, turn = 0, tilt = 0, lean = 0;
    if (form.name === 'orb') {
      centre = [3.5 * Math.sin(0.05 * age + ph), -2 + 1.2 * Math.sin(0.03 * age + ph), 3.5 * Math.cos(0.04 * age + ph)];
      size = 3.8 + 0.3 * Math.sin(0.2 * age);
    } else if (form.name === 'spiral') {
      centre = [1.5 * Math.sin(0.03 * age + ph), -2, 1.5 * Math.cos(0.025 * age + ph)];
      size = 7.5;
      tilt = 1.1 + 0.15 * Math.sin(0.04 * age + ph);
      lean = 0.04 * age + ph;
      turn = 0.12 * age + ph;
    } else if (form.name === 'cloud') {
      centre = [4 * Math.sin(0.035 * age + ph), -1.5 + Math.sin(0.05 * age), 3 * Math.cos(0.03 * age + ph)];
      size = 6;
    } else {                                  // the layer: its surface height, its thickness
      centre = [0, floor + 1.3, 0];
      size = 0.35;
    }
    A.set([form.type, w, size, turn], k * 4);
    B.set([...centre, tilt], k * 4);
    yaw[k] = lean;
    // An orb is pale at its heart and deepens to its rim; the others start deep.
    const [c, d] = form.name === 'orb' ? [p.b, p.a] : [p.a, p.b];
    C.set(c, k * 3);
    D.set(d, k * 3);
  }

  function update(t) {
    const sky = S.form === 'none' ? null
      : S.form === 'auto' ? at(0, t) : held(FORMS.find((f) => f.name === S.form) || FORMS[0], t);
    const layer = S.layer === 'off' ? null : S.layer === 'on' ? held(LAYER, t) : at(1, t);
    A.fill(0);
    let sum = 0;
    const mixed = [0, 0, 0];
    [sky, layer].forEach((s, k) => {
      if (!s || s.w <= 0) return;
      place(k, s);
      for (let i = 0; i < 3; i++) mixed[i] += C[k * 3 + i] * s.w;
      sum += s.w;
    });
    // The room takes the colour of what shows.
    const m = Math.min(1, sum);
    for (let i = 0; i < 3; i++) tint[i] = (sum > 0 ? mixed[i] / sum : 0) * m + ROOM[i] * (1 - m);
    return { A, B, C, D, yaw, tint };
  }

  return { update };
}
