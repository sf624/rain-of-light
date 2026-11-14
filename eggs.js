// Easter eggs: rare scenes of their own. This file holds the registry every
// egg plugs into, and decides which egg shows: only one at a time. The eggs
// themselves are in egg-kinds.js (what each one does per frame) and
// egg-shaders.js (their light, in the LEDs' shader).
//
// An egg (registerEgg):
//   name     its name (the lab's pin: ?egg=name)
//   slot     'form' (the default): the show's forms give way while it shows;
//            'overlay': it lays its light over whatever the show plays, and leaves the show alone
//   type     its function in the shader (EGG in egg-kinds.js), or
//   form     the name of a baked form (config.js BAKED) that it holds in the
//            form slot instead, drawn as the show draws its forms (no shader of its own)
//   rain     null: the rain as the show has it; 0: none (not even the pale drops); 1: a rain passage
//   layer    false: the layer of light gives way while it shows
//   hold     s: how long a summons shows it
//   fade     s: how long it takes to come and to go when summoned or by date (FADE; one that
//            gives way to an earlier egg goes in FADE)
//   hush     0 .. 1: how much it dims the rain's light while it shows (its light only, not the show's state)
//   steady   0 .. 1: how much less far the camera's gaze looks up and down while it shows (main.js:
//            cameraPose), for a figure that stands ahead of the eye: looking down, the view
//            leaves only a thin band of lattice above the floor
//   params   (entry, ctx, out): fills out.v (10 vectors) for the shader;
//            may return its weight (else the entry's)
// How it comes (the lab can pin any egg, ?egg=name):
//   secret   false: the secret never summons it (true: in its turn, see SECRET_WORD)
//   when     (Date) => { from, to } (ms of the wall clock): the span of the date
//            and time that brings it, or null
//   rare     true: the rare slot: the show's timeline casts it, rarely, in the
//            place of a form (show.js: rareOf; RARE below): it comes and goes
//            there as a form does, alone in its passage (no form with it; the
//            layer stays); one with a light of its own, in a passage without rain
//
// One at a time (eggOrder): a pin shows its egg alone. Otherwise, of the eggs
// whose time it is, the first in this order shows: the summoned, those of the
// date (in the registry's order), the rare slot's. One that comes while a later
// one shows waits HAND seconds: the later fades out (FADE), and comes back
// once the first has gone, if its time lasts. One that would come while an
// earlier one shows does not show until it has gone.
//
// What carries no state but the summons: an egg's weight and age are a
// function of the show's time (pinned: age = the show's time; summoned: from
// the time it was summoned; by date: from the wall clock, which is the clock
// at page load plus the show's time since, so a seek in the lab finds the
// same egg at the same time).

import { view } from './rotate.js';
import { isTyping } from './keys.js';

export const REGISTRY = [];
export function registerEgg(def) {
  const egg = { slot: 'form', rain: null, layer: true, hold: 50, fade: FADE, hush: 0, steady: 0, secret: true, rare: false, ...def };
  const i = REGISTRY.findIndex((e) => e.name === egg.name);
  if (i >= 0) REGISTRY[i] = egg; else REGISTRY.push(egg);
  return egg;
}
export const eggNamed = (name) => REGISTRY.find((e) => e.name === name);
// The rare slot, the one place to tune it: after: never before this time of the show (s);
// chance: for each egg of the slot, of each form cast after it; apart: at least this many forms
// of the show between two eggs.
export const RARE = { after: 600, chance: 0.012, apart: 3 };
export const rareEggs = () => REGISTRY.filter((e) => e.rare);

const FADE = 3;                               // s: an egg comes and goes over this long
// s: an egg that comes while another shows waits this long, as the other goes:
// longer than FADE, and than a form takes to go (show.js: BLEND), for the rare form.
export const HAND = 5;
const CALM = 8;                               // s: the camera's gaze steadies over this long for an egg of the rare slot
const LOOK = HAND + FADE;                     // s: how far back what came before still matters
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// The secret: typing the word, or SECRET_TAPS quick taps in the top right
// corner of the picture, summons the next egg in the registry at once.
export const SECRET_WORD = 'glint';           // none of its letters is a key of the page
const SECRET_TAPS = 5, TAP_GAP = 600, CORNER = 0.18;

// lab: the lab page (pins, ?date=); start: the show's time at page load;
// rare(t0, t1): the eggs of the rare slot the show has between t0 and t1 ({ egg, from, to }, show.js: rareSpans).
export function createEggs({ lab, params, canvas, start = 0, now = () => 0, onChange = () => {}, rare = () => [] }) {
  // The wall clock at the show's time `start`; the lab may set it (?date=2026-12-31T23:30, local time).
  const asked = lab && params.get('date') ? new Date(params.get('date')).getTime() : NaN;
  const wall0 = Number.isFinite(asked) ? asked : Date.now();
  const wallAt = (t) => wall0 + (t - start) * 1000;
  const showAt = (ms) => start + (ms - wall0) / 1000;
  // The pin: an egg's name, 'off' (no egg at all), or '' (none: the eggs come as they do).
  let pin = lab ? params.get('egg') || '' : '';
  if (pin && pin !== 'off' && !eggNamed(pin)) pin = '';
  let summons = null;                              // { egg, from }: the show's time it was summoned
  let nextSecret = 0;
  const broken = new Set();                        // eggs whose light could not be built (see drop): never shown again

  function summon(egg) {
    summons = { egg, from: now() };
    onChange();
  }
  function summonNext() {
    const list = REGISTRY.filter((e) => e.secret && !broken.has(e));
    if (!list.length) return;
    summon(list[nextSecret++ % list.length]);
  }

  // The secret word, on both pages. (Only letters no key of the page has.)
  let typed = '';
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (isTyping(e.target) || e.target instanceof HTMLSelectElement) return;   // (a select takes letters too)
    typed = (typed + e.key.toLowerCase()).slice(-SECRET_WORD.length);
    if (typed === SECRET_WORD) { typed = ''; summonNext(); }
  });
  // The secret taps: quick taps (or clicks) in the picture's top right corner.
  let taps = [];
  canvas.addEventListener('pointerdown', (e) => {
    const p = view.point(e.clientX, e.clientY);
    const side = CORNER * Math.min(view.w, view.h);
    if (p.x < view.w - side || p.y > side) { taps = []; return; }
    taps = taps.filter((t) => e.timeStamp - t < TAP_GAP * SECRET_TAPS).concat(e.timeStamp);
    const quick = taps.every((t, i) => i === 0 || t - taps[i - 1] < TAP_GAP);
    if (!quick) taps = [e.timeStamp];
    if (taps.length >= SECRET_TAPS) { taps = []; summonNext(); }
  });

  // The eggs whose time is near t, first to last in the order of eggOrder (see the top), each
  // with its span of the show's time: { egg, why, from, end(delay), fade } (end: when it has gone,
  // as it comes `delay` s late).
  function near(t) {
    const out = [];
    if (summons && !broken.has(summons.egg)) {
      const { egg, from } = summons;
      out.push({ egg, why: 'secret', from, end: (d) => from + d + egg.hold + egg.fade, fade: egg.fade });
    }
    const back = Math.min(t - LOOK, summons ? summons.from : Infinity);
    for (const egg of REGISTRY) {
      if (!egg.when || broken.has(egg)) continue;
      const seen = new Set();
      for (const x of [t, t - LOOK, back]) {
        const span = egg.when(new Date(wallAt(x)));
        if (!span || seen.has(span.from)) continue;
        seen.add(span.from);
        const to = showAt(span.to);
        out.push({ egg, why: 'date', from: showAt(span.from), end: () => to, fade: egg.fade });
      }
    }
    for (const s of rare(back, t)) if (!broken.has(s.egg)) out.push({ egg: s.egg, why: 'rare', from: s.from, end: () => s.to, fade: 0 });
    return out;
  }
  // Which egg shows at t, and how much: { egg, why, w, age } or null; rare: how much of the
  // show's rare form may show (0 .. 1; it shows with the show's own weight).
  function eggOrder(t) {
    if (pin === 'off') return { on: null, rare: 0, calm: 0 };
    if (pin) return { on: { egg: eggNamed(pin), why: 'pin', w: 1, age: t }, rare: 0, calm: eggNamed(pin).steady };
    const list = near(t);
    // One that comes while a later one is there (came before it, and has not gone) waits HAND.
    for (const [i, c] of list.entries()) {
      const later = list.slice(i + 1).some((x) => x.from < c.from && c.from <= x.end(0));
      c.start = c.from + (later ? HAND : 0);
      c.to = c.end(c.start - c.from);
    }
    let on = null, rareGate = 0, rareCalm = 0;
    for (const [i, c] of list.entries()) {
      // How much the earlier ones leave it: one that came first goes as an earlier one comes,
      // one that would come while an earlier one is there waits; both come back as it has gone.
      let gate = 1;
      for (const h of list.slice(0, i)) {
        if (c.to <= h.from || h.to <= c.from) continue;
        gate *= t >= h.to ? smooth((t - h.to) / FADE) : c.from < h.from ? 1 - smooth((t - h.from) / FADE) : 0;
      }
      if (c.why === 'rare') {
        if (!on && t >= c.from && t <= c.to) {
          rareGate = Math.max(rareGate, gate);
          // (the rare form's own weight is the show's: near enough, it is there from its coming to its going)
          rareCalm = Math.max(rareCalm, c.egg.steady * gate * smooth((t - c.from) / CALM) * smooth((c.to - t) / CALM));
        }
        continue;
      }
      const w = smooth((t - c.start) / c.fade) * smooth((c.to - t) / c.fade) * gate;
      if (w > 0 && !on) on = { egg: c.egg, why: c.why, w, age: t - c.start };
    }
    // (No rare span near: the show's rare form, if it shows at all, may.)
    // calm: how much the camera's gaze steadies (see steady), a function of the time like the rest.
    return { on, rare: list.some((c) => c.why === 'rare') ? rareGate : on ? 0 : 1, calm: on ? on.egg.steady * on.w : rareCalm };
  }

  // What shows at t, before the show's step: for the show, the egg in the form slot (its weight
  // and what it wants of the rain, the forms and the layer) and how much of its eggs of the rare
  // slot may show; dry: how much of the pale drops go; calm: how much the camera's gaze steadies.
  // Then settle: the show's own egg of the rare slot (show.js: update), when no other shows.
  let shown = null, rareNow = 1;
  function at(t) {
    const o = eggOrder(t);
    shown = o.on;
    rareNow = o.rare;
    const s = shown, k = s?.w ?? 0, form = s?.egg.slot === 'form';
    return {
      show: form ? { w: k, age: s.age, form: s.egg.form, rain: s.egg.rain, layer: s.egg.layer } : null,
      rare: o.rare,
      dry: form && s.egg.rain === 0 ? k : 0,
      calm: o.calm,
    };
  }
  function settle(own) {
    if (!shown && own && own.w > 0 && !broken.has(own.egg)) shown = { egg: own.egg, why: 'rare', w: own.w, age: own.age };
  }
  // How much the egg that shows dims the rain's light (its light only).
  const hush = () => (shown?.egg.hush ?? 0) * (shown?.w ?? 0);

  // The uniforms of the egg that shows: its type, weight, age and a free number; 10 vectors.
  const A = new Float32Array(4), V = new Float32Array(40);
  function frame(t, ctx) {
    A.fill(0);
    const s = shown;
    if (!s || !s.egg.type || !s.egg.params) return;
    V.fill(0);
    const w = s.egg.params(s, { ...ctx, t, wall: new Date(wallAt(t)) }, { v: V });
    A.set([s.egg.type, w ?? s.w, s.age, 0]);
  }
  // The shader function the egg that shows needs (0: none, no egg of its own light shows).
  const showing = () => (shown?.egg.type && shown.egg.params ? shown.egg.type : 0);
  function bind(gl, u) {
    gl.uniform4fv(u.uEgg, A);
    gl.uniform4fv(u.uEggV, V);
  }
  // An egg whose light cannot be built (its program failed, see main.js): it never shows again,
  // and the show goes on without it.
  function drop(type) {
    for (const e of REGISTRY) if (e.type === type) broken.add(e);
    if (pin && broken.has(eggNamed(pin))) pin = '';
    onChange();
  }

  // The lab's select: pin one egg, or none (auto: as they come), or no egg at all (off).
  function labSelect(panel) {
    const box = document.createElement('section');
    box.className = 'tuner-eggs';
    const h = document.createElement('h3');
    h.textContent = 'Lab';
    const row = document.createElement('label');
    row.className = 'tuner-egg';
    const name = document.createElement('span');
    name.className = 'tuner-name';
    name.textContent = 'Easter egg';
    row.title = 'Pin an egg to look at it (?egg=), or turn the eggs off (off); auto: as they come';
    const sel = document.createElement('select');
    for (const v of ['auto', 'off', ...REGISTRY.map((e) => e.name)]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.append(o);
    }
    sel.value = pin || 'auto';
    sel.addEventListener('change', () => {
      pin = sel.value === 'auto' ? '' : sel.value;
      summons = null;
      const q = new URLSearchParams(location.search);
      if (pin) q.set('egg', pin); else q.delete('egg');
      history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
      onChange();
    });
    row.append(name, sel);
    box.append(h, row);
    panel.insertBefore(box, panel.querySelector('.tuner-page'));
  }

  const info = () => {
    if (shown) return `${shown.egg.name} ${shown.w.toFixed(2)} (${shown.why})`;
    const r = rareNow > 0 && rare(now(), now())[0];
    return r ? `${r.egg.name} (rare)` : '';
  };
  // For the tests: the uniforms of the last frame.
  const uniforms = () => ({ egg: [...A], v: [...V] });
  return { at, settle, hush, frame, bind, drop, labSelect, info, uniforms, showing, summon: (name) => { const e = eggNamed(name); if (e) summon(e); }, wallAt };
}
