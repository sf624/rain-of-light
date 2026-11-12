// How each form of light moves while it shows: where it is, how large and
// how turned, at each moment, from the time since it began to come (age).
// Every move is slow: a form drifts, turns and breathes over tens of seconds.
// A form comes and goes in place: its light fades in and out LED by LED
// (see show.js), and it grows a little as it comes and shrinks a little as
// it goes (GROW, see motion); it never travels to come or go.
//
// Each function returns { centre, size, turn, tilt, yaw, f, bound }: what
// the shader's form needs (see formsAt in shaders.js). f is per form
// (f[0..2], see each); bound is how far from the centre any of its light
// reaches, so LEDs farther away skip it.
// `face` is the way from the eye towards the form (an angle about the
// vertical, eased in show.js): some forms turn a face to the room, and some
// keep beyond their path as the eye sees it (see BACK).

import { ROOM } from './config.js';

const FLOOR = -ROOM.height / 2 - ROOM.foot;        // the mirror floor
const TAU = Math.PI * 2;
// A slow swell now and then: 0 most of the time, rising to 1 and back over
// `len` seconds, once every `every` seconds, from `first` on.
const swell = (age, first, every, len) => {
  const x = (age - first) % every;
  return age < first || x > len ? 0 : Math.sin(Math.PI * x / len) ** 2;
};

// An orb: hovers, drifting slowly across the room, and breathes.
function orb(age, ph, face) {
  const size = 3.3 + 0.3 * Math.sin(0.11 * age + ph), drift = 2.0;
  return {
    centre: [drift * Math.sin(0.035 * age + ph), -3.4 + 0.6 * Math.sin(0.03 * age + ph), drift * Math.cos(0.028 * age + ph)],
    size, bound: size * 1.3,
  };
}

// A spiral: its arms turning, its face turned towards the room (never
// edge-on, where it would read as a plain column), leaning a little to and fro.
function spiral(age, ph, face) {
  const size = 5.8, drift = 2.0;
  return {
    centre: [drift * Math.sin(0.025 * age + ph), -2.6 + 0.6 * Math.sin(0.02 * age + ph), drift * Math.cos(0.02 * age + ph)],
    size, turn: 0.1 * age + ph,
    yaw: face + 0.75 * Math.sin(0.031 * age + ph),
    tilt: 1.4 + 0.3 * Math.sin(0.023 * age + 2 * ph),
    bound: size * 1.05,
  };
}

// A ring: stands and slowly turns, its face to the room, leaning a little
// towards the eye below; now and then it parts into two hoops that cross and
// come back into one.
// f[0]: how far the two hoops lean apart (radians).
function ring(age, ph, face) {
  const size = 3.5, drift = 1.8;
  return {
    centre: [drift * Math.sin(0.02 * age + ph), -3.0 + 0.4 * Math.sin(0.025 * age + ph), drift * Math.cos(0.017 * age + ph)],
    size, turn: 0.12 * age + ph,
    yaw: face + 0.4 * Math.sin(0.027 * age + ph),
    tilt: 1.9 + 0.2 * Math.sin(0.021 * age + ph),
    f: [0.7 * swell(age, 34, 95, 40), 0, 0],
    bound: size + 1.2,
  };
}

// A veil, like an aurora: a curtain of light across the room, low over the
// floor so that its rays stand in the middle of the view, hanging in
// folds that slowly travel along it, its rays rising from a bright lower
// hem; it sways slowly about the way it faces the room.
// f[0]: half its length.
function veil(age, ph, face) {
  const size = 4.6;                                 // the height of its longest rays
  const half = 8, drift = 1.5;
  return {
    centre: [drift * Math.sin(0.015 * age + ph), -4.5 + 0.35 * Math.sin(0.03 * age + ph), drift * Math.cos(0.012 * age + ph)],
    size, turn: 0.05 * age + ph * 3,
    yaw: face + 0.16 * Math.sin(0.017 * age + ph * 2),
    f: [half, 0, 0],
    bound: half + size + 3,
  };
}

// A solid: the edges of a regular solid, bright points at its corners. It
// stands on the axis of a corner, leaning a little, and turns slowly about
// that axis, while the way it leans goes slowly round: no edge ever runs
// along a strand. Each time it is one of two, for its whole life: a
// tetrahedron, point up, or an octahedron on its point (SOLID in shaders.js).
// f[0]: which solid.
const SOLIDS = [{ size: 5.0, y: -3.7 }, { size: 4.5, y: -3.0 }];   // per solid: how far its corners are from its centre, and how high that is
function solid(age, ph) {
  const which = Math.floor(ph / TAU * 7 * SOLIDS.length) % SOLIDS.length;
  const { size, y } = SOLIDS[which], drift = 1.3;
  return {
    centre: [drift * Math.sin(0.024 * age + ph), y + 0.3 * Math.sin(0.027 * age + ph), drift * Math.cos(0.019 * age + ph)],
    size, turn: 0.055 * age + ph,
    yaw: 0.04 * age + 2 * ph,
    tilt: 0.3 + 0.1 * Math.sin(0.05 * age + 3 * ph),
    f: [which, 0, 0],
    bound: size + 1.2,
  };
}

// A knot: a Lissajous curve, its broad side to the room, swaying. Its phase
// sways about the place where its loops stand widest open, never as far as
// where they close into one line.
// turn: its phase.
const KNOT_SWAY = 0.55;                             // how far the phase sways from 0, where the loops stand widest (they close at pi / 2)
function knot(age, ph, face) {
  const size = 4.6, drift = 1.3;
  return {
    centre: [drift * Math.sin(0.022 * age + ph), -3.2 + 0.3 * Math.sin(0.03 * age + ph), drift * Math.cos(0.018 * age + ph)],
    size, turn: KNOT_SWAY * Math.sin(0.04 * age + ph),
    yaw: face + 0.35 * Math.sin(0.027 * age + 2 * ph),
    bound: size * 1.4 + 0.8,
  };
}

export const MOTIONS = { orb, spiral, ring, veil, solid, knot };
// How far beyond its own path each form keeps, as the eye sees it: the loose
// and the wide ones read from a distance, and none flares right at the eye.
const BACK = { orb: 2.5, spiral: 2.5, ring: 2.5, veil: 3, solid: 2.5, knot: 3.5 };

// How large a form is as it begins to come and as it has gone, of its full size.
const GROW = 0.75;

// The form's place at its age: the defaults filled in. w (0 .. 1) is how
// much it shows (its weight, see show.js): it grows with it, from GROW.
// anchor is the place on its own path (the eye's way to it gives `face`);
// centre is where it shows.
// rise: how many times higher over the floor it floats (a tall view has the
// room for it; see viewFit in main.js).
export function motion(name, age, w, r, face, rise = 1) {
  const m = MOTIONS[name](age, r * TAU, face);
  const [x, y, z] = m.centre, back = BACK[name] || 0;
  return { turn: 0, tilt: 0, yaw: 0, f: [0, 0, 0], ...m, size: m.size * (GROW + (1 - GROW) * w),
    anchor: m.centre, centre: [x + back * Math.sin(face), FLOOR + (y - FLOOR) * rise, z + back * Math.cos(face)] };
}
