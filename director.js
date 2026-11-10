// The rain's director: which weather, colour mode, direction, density and
// camera move come when. Like the show's timeline (show.js), each is a track
// of episodes made from hashes of one seed: a time (?t=) gives its episode,
// and ?seed= gives the same sequence again.

import { WEATHER, FLOWS, COLOR_MODES, PALETTES, PALE, SETS, ACCENTS, DEPTHS, CAMERAS, MODE } from './config.js';

export const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const between = (a, b, r) => a + (b - a) * r;
// The i-th random number of an episode, from its own (r).
const sub = (r, i) => hash(r * 91.7 + i * 13.1 + 1);
// One of a list by its weights (weight 0: never), from x in 0 .. 1.
function weighted(list, x, weight = (o) => o.weight) {
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
const listTrack = (seed, salt, list, first, more = () => ({}), again = () => 0) =>
  createTrack(seed, salt, (prev, r) => {
    const item = prev
      ? weighted(list, sub(r, 0), (o) => o.weight * (o === prev.item ? again(o) : 1))
      : first;
    return { item, hold: between(...item.hold, sub(r, 1)), ...more(r, item) };
  });

export function createDirector(seed) {
  // The show opens with light rain falling in a rainbow.
  const weather = listTrack(seed, 1, WEATHER, WEATHER[1]);
  // Rain falls for a good while; now and then it flows sideways, each time a
  // new way (angle), and then falls again.
  const flow = listTrack(seed, 2, FLOWS, FLOWS[0], (r) => ({ angle: sub(r, 2) * Math.PI * 2 }),
    (o) => (o.toward ? 0 : 1));
  // A colour mode, and the colours each mode may need: two palettes (the
  // pale ones come less often: pale rain soon reads as grey), a set, an
  // accent, a near and a far colour, a hue for the clouds.
  const paletteAt = (x, not) => weighted(PALETTES, x, (p) => (p === not ? 0 : PALE.includes(p.name) ? 0.4 : 1));
  const color = listTrack(seed, 3, COLOR_MODES, COLOR_MODES[MODE.rainbow], (r) => {
    const p = paletteAt(sub(r, 2));
    return { p, q: paletteAt(sub(r, 3), p), set: SETS[Math.floor(sub(r, 4) * SETS.length)],
      accent: ACCENTS[Math.floor(sub(r, 5) * ACCENTS.length)], depth: DEPTHS[Math.floor(sub(r, 6) * DEPTHS.length)],
      hue: sub(r, 7) };
  });
  // Density: full at first, then anywhere between the lower limits and full
  // (share: how far from the limit to full, for the strands and for the LEDs).
  const density = createTrack(seed, 4, (prev, r) => (prev
    ? { share: [sub(r, 0), sub(r, 1)], hold: between(15, 30, sub(r, 2)) }
    : { share: [1, 1], hold: between(12, 20, sub(r, 2)) }));
  const camera = listTrack(seed, 5, CAMERAS, CAMERAS[0]);
  return { weather, flow, color, density, camera, skyStart: hash(seed * 3.3 + 9) };
}
