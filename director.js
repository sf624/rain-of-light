// The rain's director: which weather, colour mode, density and
// camera move come when. Like the show's timeline (show.js), each is a track
// of episodes made from hashes of one seed: a time (?t=) gives its episode,
// and ?seed= gives the same sequence again.

import { WEATHER, COLOR_MODES, PALETTES, PALE, SETS, ACCENTS, DEPTHS, CAMERAS, MODE } from './config.js';

export const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const between = (a, b, r) => a + (b - a) * r;
const smooth = (x) => x * x * (3 - 2 * x);
// The i-th random number of an episode, from its own (r).
const sub = (r, i) => hash(r * 91.7 + i * 13.1 + 1);
// One of a list by its weights (weight 0: never), from x in 0 .. 1.
export function weighted(list, x, weight = (o) => o.weight) {
  const w = list.map(weight);
  let left = x * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) if (w[i] > 0 && (left -= w[i]) <= 0) return list[i];
  return list.find((_, i) => w[i] > 0);
}

// A track: episodes one after another from time 0, each { item, hold, ... }
// made by make(previous episode or undefined, r).
function createTrack(seed, salt, make) {
  const list = [];
  let turn = 0, cursor = 0;
  return {
    at(t) {
      while (!list.length || list[list.length - 1].end <= t) {
        const k = list.length, prev = list[k - 1];
        const r = hash(seed * 1.37 + salt * 71.3 + k * 7.31 + turn * 3.77);
        const start = prev ? prev.end : 0;
        const e = make(prev, r);
        list.push({ ...e, k, r, start, end: start + e.hold });
      }
      cursor = Math.min(cursor, list.length - 1);
      while (cursor > 0 && list[cursor].start > t) cursor--;
      while (list[cursor].end <= t) cursor++;
      return list[cursor];
    },
    // Move on now (a key): the episode ends here, and what follows is made anew.
    skip(t) {
      const e = this.at(t);
      list.length = e.k + 1;
      e.end = t;
      turn++;
    },
  };
}

// A list's track: never the same item twice running (unless again says how
// likely it may stay), each held for a time within its own hold.
// (more and lean are given the time the episode starts at.)
const listTrack = (seed, salt, list, first, more = () => ({}), again = () => 0, lean = () => 1) =>
  createTrack(seed, salt, (prev, r) => {
    const at = prev ? prev.end : 0;
    const item = prev
      ? weighted(list, sub(r, 0), (o) => o.weight * (o === prev.item ? again(o) : 1) * lean(o, r, at))
      : first;
    return { item, hold: between(...item.hold, sub(r, 1)), ...more(r, item, at) };
  });

// ---------- the colour story ----------
// The show's colours belong together from one passage to the next: they lean
// towards one mood, a hue that wanders along an axis from green through
// blue, violet and pink to amber, and back (never across yellow-green, where
// no palette lies). It goes from one palette's hue to the next on the axis
// (stops), a leg taking a time of its own (leg, seconds), mostly on the same
// way as the last (on), always so after a turn, and back where the axis
// ends; from blue to amber takes some 4 to 6 minutes. So no one colour holds
// the room for long: a wide gap between two palettes takes no longer than a
// narrow one, a turn halfway would keep one colour twice as long, and turns
// one after another would rock between two.
const MOOD = { from: 135, leg: [120, 180], on: 0.75 };
// A choice that leans is the likelier the nearer its hues are to the mood:
// a quarter as likely this many degrees of hue away.
const NEAR = 32;
// One choice in so many is free of the mood, so surprises still come.
const FREE = 0.2;
// Rain of many colours at once (see COLOR_MODES, many) is this much rarer when the choice leans.
const MANY = 0.25;

export function createMood(seed) {
  // The stops: the hues of the palettes of colour (not the pale ones), green first.
  const stops = PALETTES.filter((p) => !PALE.includes(p.name))
    .map((p) => { const h = hueOf(p.a)[0]; return h < MOOD.from ? h + 360 : h; }).sort((x, y) => x - y);
  const track = createTrack(seed, 6, (prev, r) => {
    const i = prev ? prev.j : Math.floor(sub(r, 3) * stops.length);
    // Mostly on the same way, always so after a turn, as far as the axis goes; back where it ends.
    const last = prev && prev.j - prev.i;
    const way = prev ? last * (prev.turn || sub(r, 1) < MOOD.on ? 1 : -1) : sub(r, 1) < 0.5 ? 1 : -1;
    const j = stops[i + way] === undefined ? i - way : i + way;
    return { i, j, turn: prev !== undefined && j - i !== last, a: stops[i], b: stops[j], hold: between(...MOOD.leg, sub(r, 2)) };
  });
  // The mood at time t: a hue in degrees (above 360: round again, 400 is 40).
  return (t) => { const e = track.at(Math.max(0, t)); return e.a + (e.b - e.a) * smooth((Math.max(0, t) - e.start) / e.hold); };
}

// A colour's hue in degrees, and how much colour it has (0: grey).
export function hueOf([r, g, b]) {
  const max = Math.max(r, g, b), c = max - Math.min(r, g, b);
  if (c < 1e-6) return [0, 0];
  const h = max === r ? (g - b) / c : max === g ? 2 + (b - r) / c : 4 + (r - g) / c;
  return [(h * 60 + 360) % 360, c];
}
// How far apart two hues are, in degrees (0 .. 180).
export const apart = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
// Hues this many degrees apart or less are of one family (the eye sees one colour).
export const KIN = 50;
// How well some colours suit a mood: the share of their colour near its hue, 0 .. 1.
function suits(colours, mood) {
  let near = 0, all = 0;
  for (const c of colours) {
    const [h, s] = hueOf(c);
    near += s / (1 + (apart(h, mood) / NEAR) ** 2) ** 2;   // (a long tail: of two far colours the nearer still wins)
    all += s;
  }
  return all > 0 ? near / all : 0;
}
// The mood a choice leans to: none (undefined) while the story is off, and for the free ones (coin: 0 .. 1).
export const leaning = (story, coin, mood, t) => (story && coin >= FREE ? mood(t) : undefined);
// How much likelier a choice of these colours is for a mood (none: all alike).
const lean = (mood, colours) => (mood === undefined ? 1 : suits(colours, mood));
// The same for a palette: it counts by its deep colour, which most of its light has.
export const leanTo = (mood, palette) => lean(mood, [palette.a]);
// One of a list of equals: any one without a mood, else the likelier the better its colours suit.
const oneOf = (list, x, mood, colours = (o) => o) => (mood === undefined
  ? list[Math.floor(x * list.length)]
  : weighted(list, x, (o) => lean(mood, colours(o))));

export function createDirector(seed) {
  const mood = createMood(seed);
  // The show opens with light rain falling in a rainbow.
  const weather = listTrack(seed, 1, WEATHER, WEATHER[1]);
  // (The rain's direction belongs to the passages, see show.js.)
  // A colour mode, and the colours each mode may need: two palettes (the
  // pale ones come less often: pale rain soon reads as grey), a set, an
  // accent, a near and a far colour, a hue for the clouds.
  // With the story (see above) the mode and its colours lean to the mood.
  const paletteAt = (x, not, m) => weighted(PALETTES, x,
    (p) => (p === not ? 0 : PALE.includes(p.name) ? 0.4 : 1) * leanTo(m, p));
  const colorTrack = (story) => {
    const moodOf = (r, at) => leaning(story, sub(r, 8), mood, at);
    return listTrack(seed, 3, COLOR_MODES, COLOR_MODES[MODE.rainbow], (r, item, at) => {
      const m = moodOf(r, at);
      const p = paletteAt(sub(r, 2), undefined, m);
      return { p, q: paletteAt(sub(r, 3), p, m), set: oneOf(SETS, sub(r, 4), m, (s) => s.c),
        accent: oneOf(ACCENTS, sub(r, 5), m, (c) => [c]), depth: oneOf(DEPTHS, sub(r, 6), m),
        // (The clouds' hues run from theirs to 0.4 of the circle on: the mood lies in the middle.)
        hue: m === undefined ? sub(r, 7) : (((m / 360 - 0.2 + (sub(r, 7) - 0.5) * 0.1) % 1) + 1) % 1,
        mood: m };
    }, undefined, (o, r, at) => (o.many && moodOf(r, at) !== undefined ? MANY : 1));
  };
  // Density: full at first, then anywhere between the lower limits and full
  // (share: how far from the limit to full, for the strands and for the LEDs).
  const density = createTrack(seed, 4, (prev, r) => (prev
    ? { share: [sub(r, 0), sub(r, 1)], hold: between(15, 30, sub(r, 2)) }
    : { share: [1, 1], hold: between(12, 20, sub(r, 2)) }));
  const camera = listTrack(seed, 5, CAMERAS, CAMERAS[0]);
  // color: as the seed alone has it; story: the same track leaning to the mood.
  return { weather, color: colorTrack(false), story: colorTrack(true), mood, density, camera, skyStart: hash(seed * 3.3 + 9) };
}
