// How each form of light moves through its life: where it is, how large and
// how turned, at each moment, from the time since it began to come (age) and
// how far it has gone on its way out (leave, 0 .. 1). Every move is slow:
// a form drifts, turns and breathes over tens of seconds, and comes and goes
// with a move of its own as well as a fade (see show.js for the fades).
//
// Each function returns { centre, size, turn, tilt, yaw, f, dissolve, bound }:
// what the shader's form needs (see formsAt in shaders.js). f is per form
// (f[0..2], see each); dissolve (0 .. 1) lifts the form away as rising points
// (the veil); bound is how far from the
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
  const hover = -3.4 + 0.6 * Math.sin(0.03 * age + ph);
  const deep = FLOOR - size * 1.1;                  // below the floor, out of sight
  const y = mix(mix(deep, hover, smooth(age / 22)), deep, smooth(leave * 1.1) * 0.75);
  const apart = 2.3 * swell(age, 30, 110, 46);
  const way = 0.02 * age + ph, drift = 2.0;
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
  const size = 5.8, drift = 2.0;
  return {
    centre: [drift * Math.sin(0.025 * age + ph), -2.6 + 0.6 * Math.sin(0.02 * age + ph), drift * Math.cos(0.02 * age + ph)],
    size, turn: 0.1 * age + ph,
    yaw: face + 0.75 * Math.sin(0.031 * age + ph),
    tilt: 1.4 + 0.3 * Math.sin(0.023 * age + 2 * ph),
    f: [0.15 + 0.85 * smooth(age / 24) * (1 - smooth(leave * 1.15)), 0, 0],
    bound: size * 1.05,
  };
}

// A ring: rises out of the floor lying flat, beside its own image, then
// stands up and slowly turns, its face to the room; now and then it parts
// into two hoops that cross and come back into one. It goes by lying down
// and sinking into the floor.
// f[0]: how far the two hoops lean apart (radians).
function ring(age, leave, ph, face) {
  const size = 3.5, drift = 1.8;
  const up = smooth((age - 6) / 22) * (1 - smooth(leave * 1.2));   // 0 lying .. 1 standing
  const rise = smooth(age / 16) * (1 - smooth(leave * 1.1 - 0.2));
  const y = mix(FLOOR - 0.9, -3.0 + 0.4 * Math.sin(0.025 * age + ph), rise);
  return {
    centre: [drift * Math.sin(0.02 * age + ph), y, drift * Math.cos(0.017 * age + ph)],
    size, turn: 0.12 * age + ph,
    yaw: face + 0.4 * Math.sin(0.027 * age + ph),
    tilt: mix(0, 1.9 + 0.2 * Math.sin(0.021 * age + ph), up),   // standing, it leans a little towards the eye below
    f: [0.7 * swell(age, 34, 95, 40) * up, 0, 0],
    bound: size + 1.2,
  };
}

// A veil, like an aurora: a curtain of light across the room, low over the
// floor so that its rays stand in the middle of the view, hanging in
// folds that slowly travel along it, its rays rising from a bright lower
// hem; it unrolls from one end, sways slowly about the way it faces the
// room, and goes by lifting away upward.
// f[0]: how much of it has unrolled (0 .. 1); f[1]: how far it has lifted;
// f[2]: half its length.
function veil(age, leave, ph, face) {
  const size = 4.6;                                 // the height of its longest rays
  const half = 8, drift = 1.5;
  return {
    centre: [drift * Math.sin(0.015 * age + ph), -4.5 + 0.35 * Math.sin(0.03 * age + ph), drift * Math.cos(0.012 * age + ph)],
    size, turn: 0.05 * age + ph * 3,
    yaw: face + 0.16 * Math.sin(0.017 * age + ph * 2),
    f: [smooth(age / 20), 6 * smooth(leave), half],
    dissolve: 0.5 * smooth(leave),
    bound: half + size + 3 + 6 * smooth(leave),
  };
}

// A solid: bright points come first, the corners of a regular solid; its
// edges are drawn out from them until they meet. It stands on the axis of
// a corner, leaning a little, and turns slowly about that axis, while the
// way it leans goes slowly round: no edge ever runs along a strand. It goes
// as its edges draw back into the corners. Each time it is one of two, for
// its whole life: a tetrahedron, point up, or an octahedron on its point
// (SOLID in shaders.js).
// f[0]: which solid; f[1]: how far the edges are drawn (0 .. 1).
const SOLIDS = [{ size: 5.0, y: -3.7 }, { size: 4.5, y: -3.0 }];   // per solid: how far its corners are from its centre, and how high that is
function solid(age, leave, ph) {
  const which = Math.floor(ph / TAU * 7 * SOLIDS.length) % SOLIDS.length;
  const { size, y } = SOLIDS[which], drift = 1.3;
  return {
    centre: [drift * Math.sin(0.024 * age + ph), y + 0.3 * Math.sin(0.027 * age + ph), drift * Math.cos(0.019 * age + ph)],
    size, turn: 0.055 * age + ph,
    yaw: 0.04 * age + 2 * ph,
    tilt: 0.3 + 0.1 * Math.sin(0.05 * age + 3 * ph),
    f: [which, smooth((age - 5) / 17) * (1 - smooth(leave * 1.25)), 0],
    bound: size + 1.2,
  };
}

// A knot: a Lissajous curve, drawn once round as it comes, its broad side
// to the room, swaying. Its phase sways about the place where its loops
// stand widest open, never as far as where they close into one line. It
// goes as the curve is undone from where it began.
// turn: its phase; f[0] .. f[1]: the part of the curve that shows.
const KNOT_SWAY = 0.55;                             // how far the phase sways from 0, where the loops stand widest (they close at pi / 2)
function knot(age, leave, ph, face) {
  const size = 4.6, drift = 1.3;
  return {
    centre: [drift * Math.sin(0.022 * age + ph), -3.2 + 0.3 * Math.sin(0.03 * age + ph), drift * Math.cos(0.018 * age + ph)],
    size, turn: KNOT_SWAY * Math.sin(0.04 * age + ph),
    yaw: face + 0.35 * Math.sin(0.027 * age + 2 * ph),
    f: [-0.1 + 1.2 * smooth(leave * 1.1), -0.05 + 1.15 * smooth(age / 18), 0],
    bound: size * 1.4 + 0.8,
  };
}

export const MOTIONS = { orb, spiral, ring, veil, solid, knot };
// How far beyond its own path each form keeps, as the eye sees it: the loose
// and the wide ones read from a distance, and none flares right at the eye.
const BACK = { orb: 2.5, spiral: 2.5, ring: 2.5, veil: 3, solid: 2.5, knot: 3.5 };

// The form's place at its age: the defaults filled in. anchor is the place
// on its own path (the eye's way to it gives `face`); centre is where it shows.
// rise: how many times higher over the floor it floats (a tall view has the
// room for it; see viewFit in main.js). What is in the floor stays there.
export function motion(name, age, leave, r, face, rise = 1) {
  const m = MOTIONS[name](age, leave, r * TAU, face);
  const [x, y, z] = m.centre, back = BACK[name] || 0;
  return { turn: 0, tilt: 0, yaw: 0, f: [0, 0, 0], dissolve: 0, ...m,
    anchor: m.centre, centre: [x + back * Math.sin(face), y > FLOOR ? FLOOR + (y - FLOOR) * rise : y, z + back * Math.cos(face)] };
}
