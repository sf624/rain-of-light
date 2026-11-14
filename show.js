// The show's director: one seeded timeline of passages (rain, a form of
// light, rain through a form, a still room), and what it shows at time t:
// how much rain falls, and which forms glow, where and how bright.
// Each passage hands over to the next with slow fades, one channel after
// another (the rain, the form, the layer), so there is never a cut. The
// timeline is made from hashes of one seed: a time (?t=) gives its picture.

import { PALETTES, PALE, FORMS, LAYER, PASSAGES, BAKED } from './config.js';
import { RARE, rareEggs } from './eggs.js';
import './egg-kinds.js';                   // (the eggs: those of the rare slot are cast here)
import { hash, weighted, createMood, leaning, leanTo, hueOf, apart, KIN } from './director.js';
import { motion, FADING } from './forms.js';
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
// A form's light. Every form takes about as long to come (18 .. 24 s) and to
// go: one with a move of its own (it unfurls, unrolls, is drawn, turns; see
// forms.js) has its light there sooner, so that the move shows, and the move
// runs on; one whose coming is its fade alone (FADING in forms.js) fades as
// long as the others' moves take.
const SKY_IN = { at: -2, fade: 12 }, SKY_OUT = { at: -5, fade: 10 };
const SKY_IN_SLOW = { at: -4, fade: 18 }, SKY_OUT_SLOW = { at: -8, fade: 16 };
const SKY_INTO_RAIN = { at: 2, fade: 15 };   // a form going as rain comes
// One form at a time: where one form follows another, the first has gone
// wholly before the next begins to come, this many seconds later, about the
// passage's start. (The room looks dark for longer, 8 to 10 s: a form's first
// and last light is faint.)
const SKY_GAP = 1;
// Among rain or under a form the layer keeps this share of the glow it has alone.
const LAYER_UNDER = 0.6;
const LAYER_IN = { at: -6, fade: 12 }, LAYER_OUT = { at: 2, fade: 12 };
const EASE = 2.5;                             // s: a change of the Rain setting blends the rain in about this long
// A form's or the layer's shown weight moves at most 1 / BLEND a second: it
// follows the timeline's fades as they are (none is as steep), and a change
// of setting fades a form in or out over BLEND seconds, down to 0 exactly.
const BLEND = 4;
// A black hole's shadow fades with the form's weight below this.
const HOLE_FADE = 0.35;

// The timelines: the whole show, and the show without rain (Rain off; Rain on
// pins the rain of the whole show, see wanted).
const POOLS = {
  all: PASSAGES,
  // Without rain: the forms, and a still room between them now and then,
  // less often (the passages of rain alone would leave the room empty).
  dry: PASSAGES.filter((p) => !p.rain).map((p) => (p.sky ? p : { ...p, weight: p.weight * 0.5 })),
};
// Which timeline the Rain setting plays.
const timelineFor = (rain) => (rain === 'off' ? 'dry' : 'all');

// The rare slot (eggs.js: RARE): rarely an easter egg takes the place of the
// form just cast. From RARE.after on, the passage's random number picks the
// nth egg of the slot (rareEggs) when it falls between n and n + 1 times
// RARE.chance, so each comes as often (and the first, the teapot, on the
// same passages as ever). Between two eggs come at least RARE.apart forms:
// one drawn sooner waits, and takes the place of the first form cast after
// them; an egg with a light of its own also waits for a passage without rain
// (among rain it would hardly show). Everything else goes on as if the form it replaced had come (it
// counts as seen, and its palette as told), so the other forms come as
// often as without the eggs. An egg of the slot is a form of the show to the
// timeline: a baked form (BAKED) is drawn as one; any other egg is a form
// with no light of its own (`egg`: its light is the egg's, see eggs.js), in
// the replaced form's palette (it has colours of its own: the palette only
// goes on the colour story).
const rareOf = (T, r) => (T >= RARE.after ? rareEggs()[Math.floor(hash(r * 67 + 9) / RARE.chance)] ?? null : null);
const isRare = (form) => !!form.egg || BAKED.includes(form);
const eggOfForm = (form) => form.egg ?? rareEggs().find((e) => e.form === form.name);

function createTimeline(seed, pool, name, mood, baked) {
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
  // A form with figures (the solid, the knot) is each time another of them:
  // they come in rounds, each round every figure once in a shuffled order,
  // never the one of the time before (so all come as often, none twice in a row).
  const rounds = new Map();   // form -> { left: the figures still to come in this round, last: the latest }
  const figureOf = (form, r) => {
    const n = form.variants?.length || 0;
    if (n < 2) return 0;
    const b = rounds.get(form) || { left: [], last: -1 };
    if (!b.left.length) {
      const order = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(hash(r * 71 + i) * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (order[0] === b.last) [order[0], order[n - 1]] = [order[n - 1], order[0]];
      b.left = order;
    }
    b.last = b.left.shift();
    rounds.set(form, b);
    return b.last;
  };
  const fits = (prev, p) => (!p.across && !prev.across) || (!prev.rain && prev.sky) || (!p.rain && p.sky);
  const pickKind = (prev, r) => {
    // The same kind again is rare; a still room never follows itself.
    const w = pool.map((p) => (p === prev ? (p.sky ? 0.35 : p.rain ? 0.2 : 0) : 1) * p.weight * (fits(prev, p) ? 1 : 0));
    let x = r * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((x -= w[i]) <= 0 && w[i] > 0) return pool[i];
    return pool.find((p, i) => w[i] > 0);
  };
  let lastSky = null;  // the latest sky episode
  let since = Infinity, waiting = null;   // forms cast since the last egg; an egg drawn too soon
  // How the light of a form comes, and goes.
  const comes = (form) => (FADING.has(form.name) ? SKY_IN_SLOW : SKY_IN);
  const goes = (form) => (FADING.has(form.name) ? SKY_OUT_SLOW : SKY_OUT);
  const episode = (form, r, start, how) => {
    const names = form.palettes;
    // What the show opens with is there almost at once. A form comes only
    // once the one before has gone, and SKY_GAP after.
    let inAt = start > 0 ? start + how.at : -how.fade * 0.8;
    if (form !== LAYER && lastSky) inAt = Math.max(inAt, lastSky.outAt + lastSky.outFade + SKY_GAP);
    // Its palette: as the seed alone has it (pal), and with the colour story (told).
    // (A sky form's palette also tires, see TIRE; the layer's does not.)
    const x = hash(r * 53 + 2), m = leaning(true, hash(r * 53 + 4), mood, start);
    const sky = form !== LAYER;
    // (A form with colours of its own, see FORMS, has no palette to pick, and tells none.)
    const pick = names.length ? palAt(names, x, m, sky ? tiredAt(start) : undefined) : 0;
    if (sky && names.length) told.unshift({ start, hue: hueNamed(names[pick]) });
    return { id: `${name}-${++n}`, form, r, start, pal: names.length ? palAt(names, x) : 0, told: pick,
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
      let sky = null, form = null;
      if (kind.sky) {
        if (prev?.sky && prev.kind !== kind && hash(r * 37 + 5) < 0.6) sky = prev.sky;
        else {
          // Never one of the last two forms again; of the others, each as
          // likely as its weight, and the likelier the longer it is unseen
          // (those never seen: as if all the others had come since).
          const options = FORMS.filter((f) => !recent.slice(0, Math.min(2, FORMS.length - 1)).includes(f));
          const since = (f) => (recent.includes(f) ? recent.indexOf(f) : FORMS.length);
          form = weighted(options, hash(r * 41 + 6), (f) => f.weight * since(f) ** 2);
          recent.unshift(form);
        }
      }
      // One form after another: the first goes before T, the next comes after it.
      const old = prev?.sky && prev.sky !== sky ? prev.sky : null;
      if (old && form) close(old, T, { at: -SKY_GAP / 2 - goes(old.form).fade, fade: goes(old.form).fade });
      else if (old) close(old, T, kind.rain > prev.kind.rain ? SKY_INTO_RAIN : goes(old.form));
      // (An egg comes and goes with its own timing; its palette is drawn as the replaced form's, see rareOf.)
      let egg = null;
      if (form) {
        const drawn = rareOf(T, r);
        let e = since >= RARE.apart ? drawn || waiting : null;
        if (since < RARE.apart && drawn) waiting = drawn;
        if (e && !e.form && kind.rain) { waiting = e; e = null; }   // (an egg with a light of its own waits for a passage without rain)
        if (e && e === waiting) waiting = null;
        // (as a form: a baked one, where there are fields; else the form comes)
        egg = !e ? null : e.form ? (baked ? BAKED.find((f) => f.name === e.form) : null) : { name: e.name, egg: e, type: 0, palettes: form.palettes, colors: form.colors };
        since = egg ? 0 : since + 1;
      }
      const as = egg || form;
      if (form) sky = lastSky = episode(form, r, T, old ? { at: SKY_GAP / 2, fade: comes(as).fade } : comes(as));
      if (egg) sky.form = egg;
      else if (form) sky.v = figureOf(form, r);   // (an egg uses none of the figures it replaces)
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
  // When the next passage begins (after t).
  const upcoming = (t) => { extend(t); return list.find((p) => p.start > t)?.start ?? next; };
  // The eggs of the rare slot that show between t0 and t1: { form, from, to } (from its coming to its going).
  function rareSpans(t0, t1) {
    extend(t1 + 40);
    const out = [];
    for (const p of list) {
      const e = p.sky;
      if (e && isRare(e.form) && e.inAt <= t1 && e.outAt + e.outFade >= t0 && !out.some((x) => x.e === e)) out.push({ e, form: e.form, from: e.inAt, to: e.outAt + e.outFade });
    }
    return out;
  }
  return { at, passage, flowAt, upcoming, rareSpans };
}

// baked: whether the baked forms can show (see fields.js; the tools count them).
export function createShow(S, { feet, seed = Math.random() * 1000, baked = true }) {
  const mood = createMood(seed);              // the colour story's mood at a time (see director.js)
  const timelines = {};
  const timeline = (name) => (timelines[name] ||= createTimeline(seed, POOLS[name], name, mood, baked));
  const held = new Map();                     // form name -> a held episode
  const holdOf = (form) => {
    if (!held.has(form.name)) {
      held.set(form.name, { id: `held-${form.name}`, form, r: hash(seed), start: 0, pal: 0, told: 0,
        v: Math.floor(hash(seed * 3 + 1) * (form.variants?.length || 1)),
        inAt: 0, inFade: 1, outAt: Infinity, outFade: 1 });
    }
    return held.get(form.name);
  };

  // Which of its figures an episode shows: as the setting of its form pins
  // it (lab: solid=, knot=), else its own (a held form: one from the seed).
  const variantOf = (e) => {
    const pin = e.form.variants?.indexOf(S[e.form.name]) ?? -1;
    return pin >= 0 ? pin : e.v || 0;
  };

  // What the settings ask for at t: the rain, and the episodes with their weights.
  // egg: an easter egg in the form slot (see eggs.js): { w, age, form, rain, layer }; rare: how
  // much of the timeline's eggs of the rare slot may show (eggs.js: one egg at a time).
  function wanted(t, egg, rare = 1) {
    const tl = timeline(timelineFor(S.rain));
    const now = tl.at(t);
    const rain = S.rain === 'on' ? 1 : S.rain === 'off' ? 0 : now.rain;
    // Only the show's own rain turns sideways, between two form passages. Rain
    // that never ends never changes direction (nor does none): it falls,
    // unless the Direction setting says otherwise.
    const flow = S.rain === 'auto' ? tl.flowAt(t) : { toward: 0, angle: 0 };
    let items = rare < 1 ? now.items.map((x) => (isRare(x.e.form) ? { ...x, w: x.w * rare } : x)) : now.items;
    if (S.form !== 'auto') {
      items = items.filter((x) => x.e.form === LAYER);
      const form = FORMS.find((f) => f.name === S.form);
      if (form) items.push({ e: holdOf(form), w: 1, age: t, out: false });
    }
    if (S.layer !== 'auto') {
      items = items.filter((x) => x.e.form !== LAYER);
      if (S.layer === 'on') items.push({ e: holdOf(LAYER), w: 1, age: t, out: false });
    }
    if (egg) return eggWants(egg, rain, items, flow);
    return { rain, items, flow };
  }
  // While an egg holds the form slot, the forms give way to it (and the layer,
  // unless it keeps it); an egg that is a form of the show is held there; the
  // rain goes to what the egg wants.
  function eggWants(egg, rain, items, flow) {
    const k = 1 - egg.w;
    items = items.map((x) => (x.e.form === LAYER && egg.layer ? x : { ...x, w: x.w * k }));
    const form = egg.form && baked && BAKED.find((f) => f.name === egg.form);
    if (form) items.push({ e: holdOf(form), w: egg.w, age: egg.age, out: false });
    if (egg.rain !== null && egg.rain !== undefined) rain += (egg.rain - rain) * egg.w;
    return { rain, items, flow };
  }

  // The shown state eases to what is wanted, so a change of the Rain, Form or
  // Layer setting blends in rather than cutting. Per episode: its weight now.
  const shown = new Map();                    // id -> { x, w, col: [c, d, the room's colour with it] }
  let rainNow = null, shift = 0, skyShown = 0;
  const story = () => S.story === 'on';
  // An episode's palette, by name: one of its form's (the colour key moves on from it).
  const nameOf = (e, names, pal) => names[(pal + shift) % names.length];
  const paletteOf = (e) => e.form.colors?.name ?? nameOf(e, e.form.palettes, story() ? e.told : e.pal);
  // The palette an episode shows in (above: the form's episode over a layer, if any).
  // The layer answers the form above it with a colour that sets it off:
  // with the story, of those the one nearer the mood as the form came.
  const shownIn = (e, above) => {
    const under = e.form === LAYER && above && (above.form.colors?.under ?? UNDER[paletteOf(above)]);
    if (!under) return paletteOf(e);
    if (!story()) return nameOf(e, under, e.pal);
    const m = leaning(true, hash(e.r * 31 + above.r * 29), mood, above.start);
    return nameOf(e, under, palAt(under, hash(e.r * 29 + above.r * 31), m));
  };
  const colorsOf = (e, above) => {
    const own = e.form.colors;                // a form with colours of its own (see FORMS)
    if (own) return [own.a, own.b, own.room];
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

  const SLOTS = 3;                            // two sky forms (the one that shows, and the next, waiting for it to go) and the layer
  const A = new Float32Array(SLOTS * 4), B = new Float32Array(SLOTS * 4);
  const C = new Float32Array(SLOTS * 3), D = new Float32Array(SLOTS * 3);
  const E = new Float32Array(SLOTS * 4), F = new Float32Array(SLOTS * 4);
  const tint = [...ROOM_TINT];
  // A black hole's shadow (see forms.js: blackhole, and holeShade in shaders.js):
  // its centre and radius, and how dark it is (0: none, and the shader skips it).
  const HOLE = new Float32Array(4), JET = new Float32Array(3);   // (and the colour of its jets)
  let holeDark = 0;

  // The layer's surface height and its band's half thickness: each layer has
  // its own. The forms rest on the top of its band as it is seen (ground, see
  // motion in forms.js): its half thickness over its surface, and its crests
  // with their glow, which lie one behind another along the eye's way through
  // it (CRESTS, measured on screen; its waves rise 0.72 over its surface at
  // most, see layerLight in shaders.js). They rest on it as far as it shows;
  // with no layer, on one in the middle of its range (REST). So a form glides
  // a little as a layer comes or goes, never jumps.
  const CRESTS = 0.8;
  const layerOf = (r) => ({ y: feet + between(...LAYER.height, hash(r * 61 + 1)), thick: between(...LAYER.thick, hash(r * 61 + 2)) });
  const topOf = (r) => layerOf(r).y + layerOf(r).thick + CRESTS;
  const REST = feet + between(...LAYER.height, 0.5) + between(...LAYER.thick, 0.5) + CRESTS;
  let ground = REST;

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
      const { y, thick } = layerOf(r);
      m = { centre: [0, y, 0], size: thick,
        turn: 0, tilt: 0, yaw: 0, f: [between(0.55, 1, hash(r * 61 + 3)), s.alone, LAYER_UNDER], dissolve: 0, bound: 1e4 };
    } else {
      const go = out ? { at: e.outAt - e.inAt, fade: e.outFade } : null;   // (its age as it began to go)
      m = motion(form.name, age, w, go, r, s.face ?? 0, ground, variantOf(e));
      if (eye) {
        const goal = Math.atan2(m.anchor[0] - eye[0], m.anchor[2] - eye[2]);
        const turn = s.face === undefined ? 1 : 1 - Math.exp(-dt / 5);
        const d = goal - (s.face ?? goal);
        s.face = (s.face ?? goal) + (d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI) * turn;
        // (and how far the eye looks up at it, at once: a black hole shows its disc to the eye)
        const [cx, cy, cz] = m.centre, rise = Math.atan2(cy - eye[1], Math.hypot(cx - eye[0], cz - eye[2]));
        m = motion(form.name, age, w, go, r, s.face, ground, variantOf(e), rise);
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
    E.set([sweep * down, out ? -1 : 1, m.yaw, m.dissolve], k * 4);
    F.set([...m.f, m.bound], k * 4);
    // A form with a shadow: it darkens as the form's own move has it, and
    // fades with the form's weight (a change of setting), never at once.
    if (m.hole !== undefined) {
      const dark = (m.dark ?? 1) * smooth(Math.min(1, w / HOLE_FADE));
      if (dark > holeDark) { HOLE.set([...m.centre, m.hole]); JET.set(form.colors.jet); holeDark = dark; }
    }
  }

  // view: the camera ({ eye }): the forms turn towards the eye.
  // egg, rare: what the easter eggs ask (see wanted and eggs.js).
  let eggHeld = null;                         // the baked form an easter egg holds now (its name), if any
  function update(t, dt, view, egg = null, rare = 1) {
    eggHeld = egg?.form ?? null;
    const want = wanted(t, egg, rare);
    const first = rainNow === null;
    const k = first ? 1 : 1 - Math.exp(-dt / EASE);
    rainNow = first ? want.rain : rainNow + (want.rain - rainNow) * k;
    const kc = first ? 1 : 1 - Math.exp(-dt / 2.0);
    const ids = new Set();
    const top = want.items.filter((x) => x.e.form !== LAYER).sort((a, b) => b.w - a.w)[0];
    const above = top?.e;
    const toward = (s, w) => { s.w += Math.max(-dt / BLEND, Math.min(dt / BLEND, w - s.w)); };
    // One form at a time: while one shows, another waits (at 0) until it has
    // gone. (The timeline never asks for two at once; a change of setting may.)
    const showing = [...shown.values()].find((s) => s.x.e.form !== LAYER && s.w > 0);
    for (const x of want.items) {
      ids.add(x.e.id);
      const s = shown.get(x.e.id);
      const goal = colorsOf(x.e, above);
      const w = x.e.form !== LAYER && showing && showing !== s ? 0 : x.w;
      if (!s) shown.set(x.e.id, { x, w: first ? w : 0, col: goal.map((c) => [...c]) });
      else {
        s.x = x;
        toward(s, w);
        s.col.forEach((c, i) => c.forEach((v, j) => { c[j] = v + (goal[i][j] - v) * kc; }));
      }
    }
    for (const [id, s] of shown) {
      if (ids.has(id)) continue;
      toward(s, 0);                           // asked for no more: fade out
      if (s.w <= 0) shown.delete(id);
    }
    // Fill the slots: two for the sky forms, one for the layer. A form keeps
    // its slot while it shows (the order its LEDs light in depends on it);
    // if three would show at once (a quick change of setting), the faintest waits.
    // (An egg of the rare slot with a light of its own takes no slot: eggs.js draws it, see `egg` below.)
    const all = [...shown.values()].sort((a, b) => b.w - a.w);
    const layers = all.filter((s) => s.x.e.form === LAYER).map((s) => ({ k: smooth(s.w), r: s.x.e.r }));
    const lk = layers.reduce((n, l) => n + l.k, 0);
    ground = REST + layers.reduce((n, l) => n + l.k * (topOf(l.r) - REST), 0) / Math.max(1, lk);
    const sky = all.filter((s) => s.x.e.form !== LAYER && !s.x.e.form.egg).slice(0, 2);
    const own = all.find((s) => s.x.e.form.egg && s.w > 0);
    const slots = [null, null, all.find((s) => s.x.e.form === LAYER)];
    for (const s of sky) if (s.slot !== undefined && !slots[s.slot]) slots[s.slot] = s;
    for (const s of sky) if (!slots.includes(s)) { s.slot = slots[0] ? 1 : 0; slots[s.slot] = s; }
    A.fill(0);
    holeDark = 0;
    let sum = 0;
    const mixed = [0, 0, 0];
    const forms = [];
    // How much of a sky form shows: it is the subject, the rest gives way.
    const skyNow = Math.min(1, sky.reduce((n, s) => n + s.w, own?.w ?? 0));
    skyShown = skyNow;
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
    // egg: the egg of the rare slot that shows in a form's place, with its own light ({ egg, w, age }), if any.
    const eggNow = own ? { egg: own.x.e.form.egg, w: own.w, age: own.x.age } : null;
    // layer: the layer of light, how much it shows and the top of its band as seen (topOf, the
    // height the forms rest on; for the eggs, see egg-kinds.js).
    const layer = slots[2] && slots[2].w > 0.001 ? { w: slots[2].w, top: topOf(slots[2].x.e.r) } : null;
    return { rain: rainNow, storm: rainNow * skyNow, A, B, C, D, E, F, tint, forms, flow: want.flow, egg: eggNow, layer, hole: HOLE, holeJet: JET, holeDark };
  }

  // The colour key: every form, shown now or later, takes its next palette.
  function recolor() { shift++; }

  // For the tools: what the timeline has at t (the passage's kind, and each form's palette).
  function cast(t) {
    const tl = timeline('all'), es = tl.at(t).items.filter((x) => x.w > 0.5).map((x) => x.e);
    const top = es.find((e) => e.form !== LAYER);
    return { kind: tl.passage(t).kind.name, items: es.map((e) => ({ form: e.form.name, figure: e.form.variants?.[variantOf(e)], palette: shownIn(e, top) })) };
  }

  // The state that carries from frame to frame (the eased weights and colours, the slots), to be
  // brought back (the lab's seek); the timelines are made from the seed and need none.
  const copyShown = (m) => [...m].map(([id, s]) => [id, { ...s, x: { ...s.x }, col: s.col.map((c) => [...c]) }]);
  const save = () => ({ rainNow, shift, skyShown, shown: copyShown(shown) });
  const load = (d) => {
    rainNow = d.rainNow; shift = d.shift; skyShown = d.skyShown;
    shown.clear();
    for (const [id, s] of copyShown(d.shown)) shown.set(id, s);
  };
  const reset = () => load({ rainNow: null, shift, skyShown: 0, shown: [] });   // (the colour key stays: it is not part of the show's time)

  // For the lab's readout: what the show plays now, read from its state (nothing is worked out for it every frame).
  // passage / next: the passage at t of the timeline that plays (see timelineFor) and when the next
  // begins; playing: what shows now, by the kinds of passage (rain, form, storm, still; the
  // settings may pin the rain and the form: rain through a held form plays a storm whatever the passage);
  // rain, storm, gain: the eased rain, the rain through a form, and how much more a form glows among rain;
  // items: each episode that shows, with its weight, age, whether it goes, its figure (if its form has them),
  // its palette and its colours.
  function info(t) {
    const tl = timeline(timelineFor(S.rain));
    const top = [...shown.values()].filter((s) => s.x.e.form !== LAYER).sort((a, b) => b.w - a.w)[0]?.x.e;
    const items = [...shown.values()].sort((a, b) => b.w - a.w).map((s) => ({
      form: s.x.e.form.name, figure: s.x.e.form.variants?.[variantOf(s.x.e)], w: s.w, age: s.x.age, out: s.x.out, held: s.x.e.id.startsWith('held-'),
      palette: shownIn(s.x.e, top), colors: [s.col[0], s.col[1]],
    }));
    const rain = rainNow ?? 0, sky = items.some((i) => i.form !== LAYER.name && i.w > 0.5);
    const playing = rain > 0.5 ? (sky ? 'storm' : 'rain') : sky ? 'form' : 'still';
    return { passage: tl.passage(t).kind.name, next: tl.upcoming(t) - t, playing,
      rain, storm: rain * skyShown, gain: 1 + STORM_GAIN * rain, items };
  }

  // The timeline the forms come by now (none: a held form).
  const castBy = () => (S.form !== 'auto' ? null : timeline(timelineFor(S.rain)));
  // The baked forms about to show, or showing, at t (within `ahead` seconds): one an easter egg
  // holds, or the timeline's (their fields load first, see fields.js).
  function bakedNear(t, ahead = 40) {
    if (!baked) return [];
    if (eggHeld) return [eggHeld];
    const tl = castBy();
    return tl ? [...new Set(tl.rareSpans(t, t + ahead).filter((x) => BAKED.includes(x.form)).map((x) => x.form.name))] : [];
  }
  // The eggs of the rare slot the timeline has between t0 and t1 (see eggs.js): { egg, from, to }.
  const rareSpans = (t0, t1) => castBy()?.rareSpans(t0, t1).map((x) => ({ egg: eggOfForm(x.form), from: x.from, to: x.to })) ?? [];

  // The rain's direction at t, as the show has it (for the start: update returns it too).
  const flow = (t) => wanted(t).flow;

  return { update, recolor, cast, flow, info, save, load, reset, bakedNear, rareSpans };
}
