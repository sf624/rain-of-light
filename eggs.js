// Easter eggs: rare scenes of their own. This file holds the registry every
// egg plugs into, and what decides which ones show: a pin (the lab's
// `?egg=` and its select), a summons (the secret, below), or the date and
// time. The eggs themselves are in egg-kinds.js (what each one does per
// frame) and egg-shaders.js (their light, in the LEDs' shader).
//
// An egg (registerEgg):
//   name     its name (the pin, ?egg=name)
//   slot     'form': it takes the form slot (the show's forms give way while it
//            shows); 'overlay': it adds its light over whatever shows
//   type     its function in the shader (EGG in egg-kinds.js), or
//   form     the name of a form of the show (config.js FORMS) that it holds in
//            the form slot instead, drawn as that form is (no shader of its own)
//   rain     null: the rain as the show has it; 0: none (not even the pale
//            drops); 1: a rain passage
//   layer    false: the layer of light gives way while it shows
//   hold     s: how long a summons shows it
//   when     (Date) => { from, to } (ms of the wall clock) when the date and time
//            bring it, else null; none: only a pin or a summons
//   view     { lift, pitch }: the eye rises (units) and looks down (radians) while it shows
//   hush     0 .. 1: how much it dims the rain's light while it shows (its light only, not the show's state)
//   params   (entry, ctx, out): fills out.v (8 vectors) and out.bits for the shader;
//            may return a factor on its weight (a fade of its own)
//   secret   false: the secret never summons it
// A form of the show becomes an egg with one line:
//   registerEgg({ name: 'teapot', form: 'teapot' });   (egg-kinds.js does so for each baked form)
//
// What carries no state: an egg's weight and age are a function of the show's
// time (pinned: age = the show's time; summoned: from the time it was summoned;
// by date: from the wall clock, which is the clock at page load plus the show's
// time since, so a seek in the lab finds the same egg at the same time).

import { view } from './rotate.js';
import { isTyping } from './keys.js';

export const REGISTRY = [];
export function registerEgg(def) {
  const egg = { slot: 'form', rain: null, layer: true, hold: 50, secret: true, ...def };
  const i = REGISTRY.findIndex((e) => e.name === egg.name);
  if (i >= 0) REGISTRY[i] = egg; else REGISTRY.push(egg);
  return egg;
}
export const eggNamed = (name) => REGISTRY.find((e) => e.name === name);

const FADE = 3;                               // s: an egg comes and goes over this long
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// The secret: typing the word, or SECRET_TAPS quick taps in the top right
// corner of the picture, summons the next egg in the registry at once.
export const SECRET_WORD = 'glint';           // none of its letters is a key of the page
const SECRET_TAPS = 5, TAP_GAP = 600, CORNER = 0.18;

// lab: the lab page (pins, ?date=); start: the show's time at page load.
export function createEggs({ lab, params, canvas, start = 0, now = () => 0, onChange = () => {} }) {
  // The wall clock at the show's time `start`; the lab may set it (?date=2026-12-31T23:30, local time).
  const asked = lab && params.get('date') ? new Date(params.get('date')).getTime() : NaN;
  const wall0 = Number.isFinite(asked) ? asked : Date.now();
  const wallAt = (t) => wall0 + (t - start) * 1000;
  let pin = lab ? params.get('egg') || '' : '';   // names (a form's and an overlay's: glider,clock), 'off' (no egg at all), or ''
  let summons = null;                              // { egg, from }: the show's time it was summoned
  let nextSecret = 0;

  function summon(egg) {
    summons = { egg, from: now() };
    onChange();
  }
  function summonNext() {
    const list = REGISTRY.filter((e) => e.secret);
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

  // The eggs of a kind of slot that would show at the show's time t, with their weights and
  // ages, first the pinned, then the summoned, then those of the date and time.
  function entries(slot, t) {
    const pins = pin.split(',');
    if (pins.includes('off')) return [];
    const list = pins.map(eggNamed).filter((e) => e?.slot === slot).map((egg) => ({ egg, w: 1, age: t, why: 'pin' }));
    if (summons && summons.egg.slot === slot) {
      const age = t - summons.from, hold = summons.egg.hold;
      const w = smooth(age / FADE) * (1 - smooth((age - hold) / FADE));
      if (w > 0) list.push({ egg: summons.egg, w, age, why: 'secret' });
    }
    const wall = wallAt(t);
    for (const egg of REGISTRY) {
      if (egg.slot !== slot || !egg.when) continue;
      const span = egg.when(new Date(wall));
      if (!span) continue;
      const fade = egg.fade ?? FADE;
      const w = smooth((wall - span.from) / 1000 / fade) * smooth((span.to - wall) / 1000 / fade);
      if (w > 0) list.push({ egg, w, age: (wall - span.from) / 1000, why: 'date' });
    }
    return list.filter((x, i) => list.findIndex((y) => y.egg === x.egg) === i);
  }

  // What shows at t: per slot its entry (one form, two overlays); for the show (the form slot's
  // egg): its weight and what it wants of the rain, the forms and the layer; for the camera: how
  // far the eye rises and looks down; dry: how much of the pale drops go.
  let slots = [null, null, null];
  function at(t) {
    const over = entries('overlay', t);
    slots = [entries('form', t)[0] ?? null, over[0] ?? null, over[1] ?? null];
    const f = slots[0];
    const show = f ? { w: f.w, age: f.age, form: f.egg.form, rain: f.egg.rain, layer: f.egg.layer } : null;
    const lift = (s) => (s?.egg.view ? s.w : 0);
    const v = slots.find((s) => s?.egg.view);
    return {
      show,
      view: v ? { lift: v.egg.view.lift * lift(v), pitch: v.egg.view.pitch * lift(v) } : null,
      dry: f && f.egg.rain === 0 ? f.w : 0,
      hush: Math.max(0, ...slots.map((s) => (s?.egg.hush ?? 0) * (s?.w ?? 0))),
    };
  }

  // The uniforms: per slot type, weight, age and a free number; 8 vectors each; slot 0's bits.
  const A = new Float32Array(12), V = new Float32Array(96), BITS = new Uint32Array(64);
  const outs = [0, 1, 2].map((k) => ({ v: V.subarray(k * 32, k * 32 + 32), bits: BITS }));
  function frame(t, ctx) {
    A.fill(0);
    slots.forEach((s, k) => {
      if (!s || !s.egg.type || !s.egg.params) return;
      outs[k].v.fill(0);
      const fade = s.egg.params(s, { ...ctx, t, wall: new Date(wallAt(t)) }, outs[k]);
      A.set([s.egg.type, s.w * (fade ?? 1), s.age, 0], k * 4);
    });
  }
  // The shader functions the eggs that show now need (none: no egg shows).
  const showing = () => [...new Set(slots.filter((s) => s?.egg.type && s.egg.params).map((s) => s.egg.type))].sort((a, b) => a - b);
  function bind(gl, u) {
    gl.uniform4fv(u.uEgg, A);
    gl.uniform4fv(u.uEggV, V);
    gl.uniform4uiv(u.uEggBits, BITS);
  }

  // The lab's select: pin one egg, or none, or no egg at all (also no date's).
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
    row.title = 'Pin an egg to look at it (?egg=), or turn the eggs off (off); auto: as the date and time bring them';
    const sel = document.createElement('select');
    for (const v of ['auto', 'off', ...REGISTRY.map((e) => e.name)]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.append(o);
    }
    sel.value = pin.includes(',') ? 'auto' : pin || 'auto';
    if (pin.includes(',')) {                       // (two pinned by the URL: shown as they are)
      const o = document.createElement('option');
      o.value = o.textContent = pin;
      sel.append(o);
      sel.value = pin;
    }
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
    const before = panel.querySelector('.tuner-page');
    panel.insertBefore(box, before);
  }

  const info = () => slots.filter(Boolean).map((s) => `${s.egg.name} ${s.w.toFixed(2)} (${s.why})`).join(', ');
  // For the tests: the uniforms of the last frame.
  const uniforms = () => ({ egg: [...A], v: [...V] });
  return { at, frame, bind, labSelect, info, uniforms, showing, summon: (name) => { const e = eggNamed(name); if (e) summon(e); }, wallAt };
}
