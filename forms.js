// How each form of light moves through its life: where it is, how large and
// how turned, at each moment, from the time since it began to come (age) and
// how far it has gone on its way out (leave, 0 .. 1). Every move is slow:
// a form drifts, turns and breathes over tens of seconds, and comes and goes
// with a move of its own as well as a fade (see show.js for the fades).
//
// Each function returns { centre, size, turn, tilt, yaw, f, dissolve, bound }:
// what the shader's form needs (see formsAt in shaders.js). f is per form
// (f[0..2], see each); dissolve (0 .. 1) lifts the form away as rising points
// (or, falling back, gathers it out of them); bound is how far from the
// centre any of its light reaches, so LEDs farther away skip it.
// `face` is the way from the eye towards the form (an angle about the
// vertical, eased in show.js): some forms turn a face to the room, and some
// keep beyond their path as the eye sees it (see BACK).

import { ROOM } from './config.js';

const FLOOR = -ROOM.height / 2 - ROOM.foot;        // the mirror floor
const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const mix = (a, b, k) => a + (b - a) * k;
// A slow swell now and then: 0 most of the time, rising to 1 and back over
// `len` seconds, once every `every` seconds, from `first` on.
const swell = (age, first, every, len) => {
  const x = (age - first) % every;
  return age < first || x > len ? 0 : Math.sin(Math.PI * x / len) ** 2;
};

// An orb: rises out of the floor, meeting its own image there, and sinks back
// into it as it goes. Between, it drifts, breathes, and now and then parts
// into two that drift apart and flow together again.
// f: how far each half has moved from the centre (x, z), and how far it has
// risen (its heart glows only once it is clear of the floor).
function orb(age, leave, ph, face) {
  const size = 3.3 + 0.3 * Math.sin(0.11 * age + ph);
  const hover = -2.4 + 0.9 * Math.sin(0.03 * age + ph);
  const deep = FLOOR - size * 1.1;                  // below the floor, out of sight
  const y = mix(mix(deep, hover, smooth(age / 22)), deep, smooth(leave * 1.1) * 0.75);
  const apart = 2.3 * swell(age, 30, 110, 46);
  const way = 0.02 * age + ph, drift = 2.6;
  return {
    centre: [drift * Math.sin(0.035 * age + ph), y, drift * Math.cos(0.028 * age + ph)],
    size, f: [apart * Math.cos(way), apart * Math.sin(way), smooth((y - FLOOR) / size)],
    bound: size * 1.3 + apart,
  };
}

// A spiral: unfurls out of its bright core, arms turning, and winds back
// into it as it goes. Its face turns towards the room (never edge-on, where
// it would read as a plain column), leaning a little to and fro.
// f[0]: how far it has unfurled (0.15 .. 1).
function spiral(age, leave, ph, face) {
  const size = 7.2, drift = 2.0;
  return {
    centre: [drift * Math.sin(0.025 * age + ph), -1.6 + 0.7 * Math.sin(0.02 * age + ph), drift * Math.cos(0.02 * age + ph)],
    size, turn: 0.1 * age + ph,
    yaw: face + 0.75 * Math.sin(0.031 * age + ph),
    tilt: 1.4 + 0.3 * Math.sin(0.023 * age + 2 * ph),
    f: [0.15 + 0.85 * smooth(age / 24) * (1 - smooth(leave * 1.15)), 0, 0],
    bound: size * 1.05,
  };
}

// A cloud of points: a few puffs over a flat base. It gathers as points fall
// into place, drifts across the room, and now and then parts into two drifts
// that come together again; it goes by rising away as points.
// f: how far each drift has moved from the centre (x, z).
function cloud(age, leave, ph, face) {
  const size = 3.0;           // about one puff's radius
  const apart = 2.6 * swell(age, 24, 90, 50);
  const way = -0.015 * age + ph;
  return {
    centre: [3.2 * Math.sin(0.022 * age + ph), -3.3 + 0.5 * Math.sin(0.03 * age), 2.8 * Math.sin(0.017 * age + 2 * ph + 1)],
    size, f: [apart * Math.cos(way), apart * Math.sin(way), 0],
    dissolve: Math.max(0.85 * (1 - smooth(age / 14)), smooth(leave * 1.1)),
    bound: size * 2.6 + apart,
  };
}

// A ring: rises out of the floor lying flat, beside its own image, then
// stands up and slowly turns, its face to the room; now and then it parts
// into two hoops that cross and come back into one. It goes by lying down
// and sinking into the floor.
// f[0]: how far the two hoops lean apart (radians).
function ring(age, leave, ph, face) {
  const size = 3.7, drift = 1.8;
  const up = smooth((age - 6) / 22) * (1 - smooth(leave * 1.2));   // 0 lying .. 1 standing
  const rise = smooth(age / 16) * (1 - smooth(leave * 1.1 - 0.2));
  const y = mix(FLOOR - 0.9, -2.5 + 0.5 * Math.sin(0.025 * age + ph), rise);
  return {
    centre: [drift * Math.sin(0.02 * age + ph), y, drift * Math.cos(0.017 * age + ph)],
    size, turn: 0.12 * age + ph,
    yaw: face + 0.4 * Math.sin(0.027 * age + ph),
    tilt: mix(0, 1.9 + 0.2 * Math.sin(0.021 * age + ph), up),   // standing, it leans a little towards the eye below
    f: [0.7 * swell(age, 34, 95, 40) * up, 0, 0],
    bound: size + 1.2,
  };
}

// A veil, like an aurora: a curtain of light across the room, hanging in
// folds that slowly travel along it, its rays rising from a bright lower
// hem; it unrolls from one end, sways slowly about the way it faces the
// room, and goes by lifting away upward.
// f[0]: how much of it has unrolled (0 .. 1); f[1]: how far it has lifted;
// f[2]: half its length.
function veil(age, leave, ph, face) {
  const size = 5.2;                                 // the height of its longest rays
  const half = 9.5, drift = 1.5;
  return {
    centre: [drift * Math.sin(0.015 * age + ph), -3.2 + 0.35 * Math.sin(0.03 * age + ph), drift * Math.cos(0.012 * age + ph)],
    size, turn: 0.05 * age + ph * 3,
    yaw: face + 0.16 * Math.sin(0.017 * age + ph * 2),
    f: [smooth(age / 20), 6 * smooth(leave), half],
    dissolve: 0.5 * smooth(leave),
    bound: half + size + 3 + 6 * smooth(leave),
  };
}

export const MOTIONS = { orb, spiral, cloud, ring, veil };
// How far beyond its own path each form keeps, as the eye sees it: the loose
// and the wide ones read from a distance, and none flares right at the eye.
const BACK = { orb: 1.5, ring: 1.5, cloud: 3.5, veil: 3 };

// The form's place at its age: the defaults filled in. anchor is the place
// on its own path (the eye's way to it gives `face`); centre is where it shows.
export function motion(name, age, leave, r, face) {
  const m = MOTIONS[name](age, leave, r * TAU, face);
  const [x, y, z] = m.centre, back = BACK[name] || 0;
  return { turn: 0, tilt: 0, yaw: 0, f: [0, 0, 0], dissolve: 0, ...m,
    anchor: m.centre, centre: [x + back * Math.sin(face), y, z + back * Math.cos(face)] };
}
