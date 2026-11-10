// The show's director: one seeded timeline of passages (rain, a form of
// light, rain through a form, a still room), and what it shows at time t:
// how much rain falls, and which forms glow, where and how bright.
// Each passage hands over to the next with slow fades, one channel after
// another (the rain, the form, the layer), so there is never a cut. The
// timeline is made from hashes of one seed: a time (?t=) gives its picture.

import { PALETTES, FORMS, LAYER, PASSAGES } from './config.js';

const ROOM_TINT = [0.35, 0.5, 1.0];          // the room's colour while no form shows
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const between = (a, b, r) => a + (b - a) * r;

// When a channel changes at the start T of a passage: it begins at T + at
// and takes `fade` seconds. Rain comes early and leaves late, so a form
// that goes while rain comes dissolves into it, and one that comes while
// rain goes seems to gather out of it.
const RAIN_IN = { at: -5, fade: 14 }, RAIN_OUT = { at: 4, fade: 16 };
const SKY_IN = { at: -2, fade: 12 }, SKY_OUT = { at: -5, fade: 10 };
const SKY_INTO_RAIN = { at: 2, fade: 15 };   // a form going as rain comes
const LAYER_IN = { at: -6, fade: 12 }, LAYER_OUT = { at: 2, fade: 12 };
const EASE = 2.5;                             // s: a change of scene or form setting blends in this long

// The scenes: the whole show, or only its forms (the rain is pinned in update).
const POOLS = {
  mix: PASSAGES,
  // Only the forms: a still room between them now and then, less often.
  crystal: PASSAGES.filter((p) => !p.rain).map((p) => (p.sky ? p : { ...p, weight: p.weight * 0.5 })),
};

function createTimeline(seed, pool, name) {
  const list = [];   // passages: { start, kind, sky, layer } (sky, layer: episodes or null)
  let next = 0, n = 0;
  const recent = [];  // the forms shown, the latest first
  const pickKind = (prev, r) => {
    // The same kind again is rare; a still room never follows itself.
    const w = pool.map((p) => (p === prev ? (p.sky ? 0.35 : p.rain ? 0.2 : 0) : 1) * p.weight);
    let x = r * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((x -= w[i]) <= 0 && w[i] > 0) return pool[i];
    return pool.find((p, i) => w[i] > 0);
  };
  const episode = (form, r, start, how) => {
    const names = form.palettes;
    // What the show opens with is there almost at once.
    const inAt = start > 0 ? start + how.at : -how.fade * 0.8;
    return { id: `${name}-${++n}`, form, r, pal: Math.floor(hash(r * 53 + 2) * names.length) % names.length,
      inAt, inFade: how.fade, outAt: Infinity, outFade: 1 };
  };
  const close = (e, T, how) => { if (e) { e.outAt = T + how.at; e.outFade = how.fade; } };
  function extend(until) {
    while (next <= until) {
      const k = list.length, r = hash(seed + k * 7.31 + 0.13);
      const prev = list[k - 1];
      const kind = prev ? pickKind(prev.kind, hash(r * 91 + 1)) : pool[0];
      const T = next;
      // The form: a storm may keep the form that shows, and rain gathers on it.
      let sky = null;
      if (kind.sky) {
        if (prev?.sky && prev.kind !== kind && hash(r * 37 + 5) < 0.6) sky = prev.sky;
        else {
          // Never the last form again, and more likely the one unseen the longest.
          const options = FORMS.filter((f) => f !== recent[0]);
          const since = (f) => (recent.includes(f) ? recent.indexOf(f) : Infinity);
          options.sort((x, y) => since(y) - since(x));
          const x = hash(r * 41 + 6);
          const form = !recent.length ? options[Math.floor(x * options.length) % options.length]
            : x < 0.7 ? options[0] : options[options.length - 1];
          sky = episode(form, r, T, SKY_IN);
          recent.unshift(form);
        }
      }
      if (prev?.sky && prev.sky !== sky) close(prev.sky, T, kind.rain > prev.kind.rain ? SKY_INTO_RAIN : SKY_OUT);
      const layerOn = hash(r * 23 + 7) < kind.layer;
      let layer = null;
      if (layerOn) layer = prev?.layer || episode(LAYER, r, T, LAYER_IN);
      if (prev?.layer && prev.layer !== layer) close(prev.layer, T, LAYER_OUT);
      list.push({ start: T, kind, sky, layer });
      const hold = k === 0 ? [30, 46] : kind.hold;   // the show opens with a short passage
      next = T + between(...hold, hash(r * 17 + 3));
    }
  }
  function weight(e, t) {
    return smooth((t - e.inAt) / e.inFade) * (1 - smooth((t - e.outAt) / e.outFade));
  }
  // The show at time t: rain (0..1) and the episodes that glow, with their weights.
  function at(t) {
    extend(t + 40);                           // passages a little ahead: their leads start early
    let rain = list[0].kind.rain;
    const items = new Map();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (i > 0) {
        const d = p.kind.rain - list[i - 1].kind.rain;
        const how = d > 0 ? RAIN_IN : RAIN_OUT;
        if (d) rain += d * smooth((t - p.start - how.at) / how.fade);
      }
      for (const e of [p.sky, p.layer]) {
        if (!e || items.has(e.id)) continue;
        const w = weight(e, t);
        if (w > 0.001) items.set(e.id, { e, w, age: t - e.inAt, out: t > e.outAt });
      }
      if (p.start > t + 30) break;
    }
    return { rain: Math.min(1, Math.max(0, rain)), items: [...items.values()] };
  }
  return { at };
}

export function createShow(S, { feet, seed = Math.random() * 1000 }) {
  const timelines = {};
  const timeline = (name) => (timelines[name] ||= createTimeline(seed, POOLS[name], name));
  const held = new Map();                     // form name -> a held episode
  const holdOf = (form) => {
    if (!held.has(form.name)) {
      held.set(form.name, { id: `held-${form.name}`, form, r: hash(seed), pal: 0,
        inAt: 0, inFade: 1, outAt: Infinity, outFade: 1 });
    }
    return held.get(form.name);
  };

  // What the settings ask for at t: the rain, and the episodes with their weights.
  function wanted(t) {
    const scene = S.scene === 'rain' || S.scene === 'crystal' ? S.scene : 'mix';
    const now = scene === 'rain' ? { rain: 1, items: [] } : timeline(scene).at(t);
    const rain = scene === 'crystal' ? 0 : now.rain;
    let items = now.items;
    if (S.form !== 'auto') {
      items = items.filter((x) => x.e.form === LAYER);
      const form = FORMS.find((f) => f.name === S.form);
      if (form) items.push({ e: holdOf(form), w: 1, age: t, out: false });
    }
    if (S.layer !== 'auto') {
      items = items.filter((x) => x.e.form !== LAYER);
      if (S.layer === 'on') items.push({ e: holdOf(LAYER), w: 1, age: t, out: false });
    }
    return { rain, items };
  }

  // The shown state eases to what is wanted, so a change of scene or of a
  // form setting blends in rather than cutting. Per episode: its weight now.
  const shown = new Map();                    // id -> { x, w, col: [c, d] }
  let rainNow = null, shift = 0;
  const colorsOf = (e) => {
    const names = e.form.palettes;
    const p = PALETTES.find((q) => q.name === names[(e.pal + shift) % names.length]);
    // An orb is pale at its heart and deepens to its rim; the others start deep.
    return e.form.name === 'orb' ? [p.b, p.a] : [p.a, p.b];
  };

  const SLOTS = 3;                            // two sky forms (one coming, one going) and the layer
  const A = new Float32Array(SLOTS * 4), B = new Float32Array(SLOTS * 4);
  const C = new Float32Array(SLOTS * 3), D = new Float32Array(SLOTS * 3);
  const E = new Float32Array(SLOTS * 2), yaw = new Float32Array(SLOTS);
  const tint = [...ROOM_TINT];

  // Where a form is at its age, how large, how turned.
  function place(k, { x, w, col }, sweep) {
    const { e, age, out } = x;
    const { form, r } = e;
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
      centre = [0, feet + 1.1, 0];
      size = 0.35;
    }
    A.set([form.type, w, size, turn], k * 4);
    B.set([...centre, tilt], k * 4);
    yaw[k] = lean;
    C.set(col[0], k * 3);
    D.set(col[1], k * 3);
    // While rain falls, a form comes from the top down and goes from the top
    // down, as if rain gathered into it or it ran off as rain; else LED by LED.
    E.set([sweep, out ? -1 : 1], k * 2);
  }

  function update(t, dt) {
    const want = wanted(t);
    const first = rainNow === null;
    const k = first ? 1 : 1 - Math.exp(-dt / EASE);
    rainNow = first ? want.rain : rainNow + (want.rain - rainNow) * k;
    const kc = first ? 1 : 1 - Math.exp(-dt / 2.0);
    const ids = new Set();
    for (const x of want.items) {
      ids.add(x.e.id);
      const s = shown.get(x.e.id);
      const goal = colorsOf(x.e);
      if (!s) shown.set(x.e.id, { x, w: first ? x.w : 0, col: goal.map((c) => [...c]) });
      else {
        s.x = x;
        s.w += (x.w - s.w) * k;
        s.col.forEach((c, i) => c.forEach((v, j) => { c[j] = v + (goal[i][j] - v) * kc; }));
      }
    }
    for (const [id, s] of shown) {
      if (ids.has(id)) continue;
      s.w += (0 - s.w) * k;                   // asked for no more: fade out
      if (s.w < 0.002) shown.delete(id);
    }
    // Fill the slots: two for the sky forms, one for the layer. A form keeps
    // its slot while it shows (the order its LEDs light in depends on it);
    // if three would show at once (a quick change of setting), the faintest waits.
    const all = [...shown.values()].sort((a, b) => b.w - a.w);
    const sky = all.filter((s) => s.x.e.form !== LAYER).slice(0, 2);
    const slots = [null, null, all.find((s) => s.x.e.form === LAYER)];
    for (const s of sky) if (s.slot !== undefined && !slots[s.slot]) slots[s.slot] = s;
    for (const s of sky) if (!slots.includes(s)) { s.slot = slots[0] ? 1 : 0; slots[s.slot] = s; }
    A.fill(0);
    let sum = 0;
    const mixed = [0, 0, 0];
    const forms = [];
    slots.forEach((s, n) => {
      if (!s || s.w <= 0.001) return;
      // While rain falls the layer thins out, LED by LED, so the rain shows
      // through it. It lies too low to come from the top down: always LED by LED.
      if (n === 2) place(n, { ...s, w: s.w * (1 - 0.45 * rainNow) }, 0);
      else {
        place(n, s, rainNow);
        forms.push({ name: s.x.e.form.name, w: s.w, out: s.x.out, at: [B[n * 4], B[n * 4 + 1], B[n * 4 + 2]] });
      }
      for (let i = 0; i < 3; i++) mixed[i] += s.col[0][i] * s.w;
      sum += s.w;
    });
    // The room takes the colour of what shows.
    const m = Math.min(1, sum);
    for (let i = 0; i < 3; i++) tint[i] = (sum > 0 ? mixed[i] / sum : 0) * m + ROOM_TINT[i] * (1 - m);
    // forms: the sky forms that show, for the music (see audio.js forms()).
    return { rain: rainNow, A, B, C, D, E, yaw, tint, forms };
  }

  // The colour key: every form, shown now or later, takes its next palette.
  function recolor() { shift++; }

  return { update, recolor };
}
