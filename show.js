// The show's director: one seeded timeline of passages (rain, a form of
// light, rain through a form, a still room), and what it shows at time t:
// how much rain falls, and which forms glow, where and how bright.
// Each passage hands over to the next with slow fades, one channel after
// another (the rain, the form, the layer), so there is never a cut. The
// timeline is made from hashes of one seed: a time (?t=) gives its picture.

import { PALETTES, PALE, FORMS, LAYER, PASSAGES } from './config.js';
import { hash, weighted, createMood, leaning, leanTo, hueOf, apart, KIN } from './director.js';
import { motion } from './forms.js';
import { CHANGE } from './direction.js';

const ROOM_TINT = [0.35, 0.5, 1.0];          // the room's colour while no form shows
// The layer's palettes under a form of each palette: never the form's own,
// never a pale one (a form over a grey sea reads as no colour), and deep
// enough to stay the ground under it.
const UNDER = {
  amber: ['deep sea', 'sakura'], candle: ['amber', 'deep sea'], sakura: ['deep sea', 'aurora'],
  ice: ['deep sea', 'sakura'], aurora: ['deep sea', 'sakura'], 'deep sea': ['aurora', 'sakura'],
};
const STORM_GAIN = 0.8;                       // a form among rain glows this much more, to hold its own
const paletteNamed = (n) => PALETTES.find((q) => q.name === n);
// One of some palettes (by name), from x in 0 .. 1: any one without a mood
// (m undefined), else the likelier the nearer it is to it (see director.js,
// the colour story); tired: how much less likely each one is (see TIRE). Its place in the list.
function palAt(names, x, m, tired) {
  if (m === undefined && !tired) return Math.floor(x * names.length) % names.length;
  return names.indexOf(weighted(names, x, (n) => (m === undefined ? 1 : leanTo(m, paletteNamed(n))) * (tired ? tired(n) : 1)));
}
const hueNamed = (n) => hueOf(paletteNamed(n).a)[0];
// With the colour story, once the forms have kept one family of hues (see
// KIN) for this many seconds, a palette of that family is this much less
// likely for the next form, even for a choice free of the mood (a surprise
// should not be the colour that has held the room).
const TIRE = { after: 90, by: 0.05 };
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const between = (a, b, r) => a + (b - a) * r;

// When a channel changes at the start T of a passage: it begins at T + at
// and takes `fade` seconds. Rain comes early and leaves late, so a form
// that goes while rain comes fades into it, and one that comes while
// rain goes seems to gather out of it.
const RAIN_IN = { at: -5, fade: 14 }, RAIN_OUT = { at: 4, fade: 16 };
const SKY_IN = { at: -4, fade: 18 }, SKY_OUT = { at: -8, fade: 16 };
const SKY_INTO_RAIN = { at: 2, fade: 15 };   // a form going as rain comes
// Among rain or under a form the layer keeps this share of the glow it has alone.
const LAYER_UNDER = 0.6;
const LAYER_IN = { at: -6, fade: 12 }, LAYER_OUT = { at: 2, fade: 12 };
const EASE = 2.5;                             // s: a change of scene or form setting blends in this long

// The scenes: the whole show, or only its forms (the rain is pinned in update).
const POOLS = {
  mix: PASSAGES,
  // Only the forms: a still room between them now and then, less often.
  crystal: PASSAGES.filter((p) => !p.rain).map((p) => (p.sky ? p : { ...p, weight: p.weight * 0.5 })),
};

function createTimeline(seed, pool, name, mood) {
  const list = [];   // passages: { start, kind, sky, layer, r } (sky, layer: episodes or null; r: its random number)
  let next = 0, n = 0;
  const recent = [];  // the forms shown, the latest first
  const told = [];    // their palettes with the colour story ({ start, hue }), the latest first
  // How much less likely each palette is for a form that starts at start (see TIRE).
  const tiredAt = (start) => {
    let since = start;
    for (const o of told) { if (apart(o.hue, told[0].hue) > KIN) break; since = o.start; }
    return start - since < TIRE.after ? () => 1 : (n) => (apart(hueNamed(n), told[0].hue) <= KIN ? TIRE.by : 1);
  };
  // Sideways rain (drift) comes only between two form passages: a form lasts
  // long enough that the rain before has gone, and the direction changed,
  // before the sideways rain comes, and the same after it (see flowAt).
  const fits = (prev, p) => (!p.across && !prev.across) || (!prev.rain && prev.sky) || (!p.rain && p.sky);
  const pickKind = (prev, r) => {
    // The same kind again is rare; a still room never follows itself.
    const w = pool.map((p) => (p === prev ? (p.sky ? 0.35 : p.rain ? 0.2 : 0) : 1) * p.weight * (fits(prev, p) ? 1 : 0));
    let x = r * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((x -= w[i]) <= 0 && w[i] > 0) return pool[i];
    return pool.find((p, i) => w[i] > 0);
  };
  const episode = (form, r, start, how) => {
    const names = form.palettes;
    // What the show opens with is there almost at once.
    const inAt = start > 0 ? start + how.at : -how.fade * 0.8;
    // Its palette: as the seed alone has it (pal), and with the colour story (told).
    // (A sky form's palette also tires, see TIRE; the layer's does not.)
    const x = hash(r * 53 + 2), m = leaning(true, hash(r * 53 + 4), mood, start);
    const sky = form !== LAYER;
    const pick = palAt(names, x, m, sky ? tiredAt(start) : undefined);
    if (sky) told.unshift({ start, hue: hueNamed(names[pick]) });
    return { id: `${name}-${++n}`, form, r, start, pal: palAt(names, x), told: pick,
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
          // Never one of the last two forms again; of the others, each as
          // likely as its weight, and the likelier the longer it is unseen
          // (those never seen: as if all the others had come since).
          const options = FORMS.filter((f) => !recent.slice(0, Math.min(2, FORMS.length - 1)).includes(f));
          const since = (f) => (recent.includes(f) ? recent.indexOf(f) : FORMS.length);
          const form = weighted(options, hash(r * 41 + 6), (f) => f.weight * since(f) ** 2);
          sky = episode(form, r, T, SKY_IN);
          recent.unshift(form);
        }
      }
      if (prev?.sky && prev.sky !== sky) close(prev.sky, T, kind.rain > prev.kind.rain ? SKY_INTO_RAIN : SKY_OUT);
      const layerOn = hash(r * 23 + 7) < kind.layer;
      let layer = null;
      if (layerOn) layer = prev?.layer || episode(LAYER, r, T, LAYER_IN);
      if (prev?.layer && prev.layer !== layer) close(prev.layer, T, LAYER_OUT);
      list.push({ start: T, kind, sky, layer, r });
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
  // The passage at time t.
  const passage = (t) => { extend(t); return list.findLast((p) => p.start <= t); };
  // The rain's direction at t: sideways (toward 1, its way: angle) from so
  // long before a sideways passage's rain comes that the change of direction
  // (CHANGE, see direction.js) is done by then, until its rain has gone; else
  // down. Two sideways passages close together stay sideways in between.
  function flowAt(t) {
    extend(t + 40);
    let w = null;                             // the stretch of sideways rain so far: { from, end, angle }
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.kind.across) continue;
      const from = p.start + RAIN_IN.at - CHANGE;
      if (from > t + 2 * CHANGE) break;
      const end = list[i + 1] ? list[i + 1].start + RAIN_OUT.at + RAIN_OUT.fade : Infinity;
      if (w && from - w.end < 2 * CHANGE) w.end = end;   // close to the last: one stretch
      else if (w && t < w.end) break;
      else w = { from, end, angle: hash(p.r * 47 + 11) * Math.PI * 2 };
    }
    return w && w.from <= t && t < w.end ? { toward: 1, angle: w.angle } : { toward: 0, angle: 0 };
  }
  return { at, passage, flowAt };
}

export function createShow(S, { feet, seed = Math.random() * 1000 }) {
  const mood = createMood(seed);              // the colour story's mood at a time (see director.js)
  const timelines = {};
  const timeline = (name) => (timelines[name] ||= createTimeline(seed, POOLS[name], name, mood));
  const held = new Map();                     // form name -> a held episode
  const holdOf = (form) => {
    if (!held.has(form.name)) {
      held.set(form.name, { id: `held-${form.name}`, form, r: hash(seed), start: 0, pal: 0, told: 0,
        inAt: 0, inFade: 1, outAt: Infinity, outFade: 1 });
    }
    return held.get(form.name);
  };

  // What the settings ask for at t: the rain, and the episodes with their weights.
  function wanted(t) {
    const scene = S.scene === 'rain' || S.scene === 'crystal' ? S.scene : 'mix';
    const now = scene === 'rain' ? { rain: 1, items: [] } : timeline(scene).at(t);
    const rain = scene === 'crystal' ? 0 : now.rain;
    // (Rain alone never ends, so it never changes direction: it falls, unless the Direction setting says otherwise.)
    const flow = scene === 'mix' ? timeline(scene).flowAt(t) : { toward: 0, angle: 0 };
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
    return { rain, items, flow };
  }

  // The shown state eases to what is wanted, so a change of scene or of a
  // form setting blends in rather than cutting. Per episode: its weight now.
  const shown = new Map();                    // id -> { x, w, col: [c, d, the room's colour with it] }
  let rainNow = null, shift = 0;
  const story = () => S.story === 'on';
  // An episode's palette, by name: one of its form's (the colour key moves on from it).
  const nameOf = (e, names, pal) => names[(pal + shift) % names.length];
  const paletteOf = (e) => nameOf(e, e.form.palettes, story() ? e.told : e.pal);
  // The palette an episode shows in (above: the form's episode over a layer, if any).
  // The layer answers the form above it with a colour that sets it off:
  // with the story, of those the one nearer the mood as the form came.
  const shownIn = (e, above) => {
    const under = e.form === LAYER && above && UNDER[paletteOf(above)];
    if (!under) return paletteOf(e);
    if (!story()) return nameOf(e, under, e.pal);
    const m = leaning(true, hash(e.r * 31 + above.r * 29), mood, above.start);
    return nameOf(e, under, palAt(under, hash(e.r * 29 + above.r * 31), m));
  };
  const colorsOf = (e, above) => {
    const name = shownIn(e, above);
    const of = paletteNamed;
    const p = of(name);
    // The room's colour with this form: its own, or under a pale form the
    // colour of its ground (white light in a white room has no colour at all).
    const q = PALE.includes(name) ? of(UNDER[name][0]) : p;
    const room = q.a.map((v, i) => (v + q.b[i]) / 2);
    // An orb is pale at its heart and deepens to its rim; the others start deep.
    return e.form.name === 'orb' ? [p.b, p.a, room] : [p.a, p.b, room];
  };

  const SLOTS = 3;                            // two sky forms (one coming, one going) and the layer
  const A = new Float32Array(SLOTS * 4), B = new Float32Array(SLOTS * 4);
  const C = new Float32Array(SLOTS * 3), D = new Float32Array(SLOTS * 3);
  const E = new Float32Array(SLOTS * 3), F = new Float32Array(SLOTS * 4);
  const tint = [...ROOM_TINT];

  // Where a form is at its age, how large, how turned (see forms.js). The
  // forms follow the eye slowly as it moves (the way from the eye to a form: face).
  // Each layer has a height, a thickness and a brightness of its own.
  function place(k, s, sweep, view, dt, down = 1) {
    const eye = view?.eye;
    const { x, w, col } = s;
    const { e, age, out } = x;
    const { form, r } = e;
    let m;
    if (form === LAYER) {                     // the layer: its surface height, its thickness
      m = { centre: [0, feet + between(0.5, 1.8, hash(r * 61 + 1)), 0], size: between(0.2, 0.45, hash(r * 61 + 2)),
        turn: 0, tilt: 0, yaw: 0, f: [between(0.55, 1, hash(r * 61 + 3)), s.alone, LAYER_UNDER], bound: 1e4 };
    } else {
      m = motion(form.name, age, w, r, s.face ?? 0, view?.rise);
      if (eye) {
        const goal = Math.atan2(m.anchor[0] - eye[0], m.anchor[2] - eye[2]);
        const turn = s.face === undefined ? 1 : 1 - Math.exp(-dt / 5);
        const d = goal - (s.face ?? goal);
        s.face = (s.face ?? goal) + (d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI) * turn;
        m = motion(form.name, age, w, r, s.face, view.rise);
      }
    }
    A.set([form.type, w, m.size, m.turn], k * 4);
    B.set([...m.centre, m.tilt], k * 4);
    // A form glows more among rain.
    const gain = form === LAYER ? 1 : 1 + STORM_GAIN * sweep;
    C.set(col[0].map((v) => v * gain), k * 3);
    D.set(col[1].map((v) => v * gain), k * 3);
    // While rain falls, a form comes from the top down and goes from the top
    // down, as if rain gathered into it or it ran off as rain; else LED by LED
    // (also beside sideways rain, which falls from nowhere: down 0).
    E.set([sweep * down, out ? -1 : 1, m.yaw], k * 3);
    F.set([...m.f, m.bound], k * 4);
  }

  // view: the camera ({ eye, rise }): the forms turn towards the eye, and float higher in a tall view.
  function update(t, dt, view) {
    const want = wanted(t);
    const first = rainNow === null;
    const k = first ? 1 : 1 - Math.exp(-dt / EASE);
    rainNow = first ? want.rain : rainNow + (want.rain - rainNow) * k;
    const kc = first ? 1 : 1 - Math.exp(-dt / 2.0);
    const ids = new Set();
    const top = want.items.filter((x) => x.e.form !== LAYER).sort((a, b) => b.w - a.w)[0];
    const above = top?.e;
    for (const x of want.items) {
      ids.add(x.e.id);
      const s = shown.get(x.e.id);
      const goal = colorsOf(x.e, above);
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
    // How much of a sky form shows: it is the subject, the rest gives way.
    const skyNow = Math.min(1, sky.reduce((n, s) => n + s.w, 0));
    slots.forEach((s, n) => {
      if (!s || s.w <= 0.001) return;
      // While rain falls, or under a form, the layer thins out a little, LED by LED:
      // the rain shows through it, and the form stays the subject. It lies
      // too low to come from the top down: always LED by LED.
      // With the room to itself (no rain, no form) it is the subject (alone).
      if (n === 2) place(n, { ...s, w: s.w * (1 - 0.2 * rainNow) * (1 - 0.2 * skyNow), alone: (1 - rainNow) * (1 - skyNow) }, 0, view, dt);
      else {
        place(n, s, rainNow, view, dt, want.flow.toward ? 0 : 1);
        forms.push({ name: s.x.e.form.name, w: s.w, out: s.x.out, at: [B[n * 4], B[n * 4 + 1], B[n * 4 + 2]] });
      }
      // (Under a form the layer's colour is its ground, not the room's.)
      const share = n === 2 ? s.w * (1 - skyNow) : s.w;
      for (let i = 0; i < 3; i++) mixed[i] += s.col[2][i] * share;
      sum += share;
    });
    // The room takes the colour of what shows.
    const m = Math.min(1, sum);
    for (let i = 0; i < 3; i++) tint[i] = (sum > 0 ? mixed[i] / sum : 0) * m + ROOM_TINT[i] * (1 - m);
    // forms: the sky forms that show, for the music (see audio.js forms()).
    // storm: how much rain falls through a form (0 .. 1).
    // flow: which way the rain goes now (see flowAt).
    return { rain: rainNow, storm: rainNow * skyNow, A, B, C, D, E, F, tint, forms, flow: want.flow };
  }

  // The colour key: every form, shown now or later, takes its next palette.
  function recolor() { shift++; }

  // For the tools: what the timeline has at t (the passage's kind, and each form's palette).
  function cast(t) {
    const tl = timeline('mix'), es = tl.at(t).items.filter((x) => x.w > 0.5).map((x) => x.e);
    const top = es.find((e) => e.form !== LAYER);
    return { kind: tl.passage(t).kind.name, items: es.map((e) => ({ form: e.form.name, palette: shownIn(e, top) })) };
  }

  // The rain's direction at t, as the show has it (for the start: update returns it too).
  const flow = (t) => wanted(t).flow;

  return { update, recolor, cast, flow };
}
