// How each form of light moves through its life: where it is, how large and
// how turned, at each moment, from the time since it began to come (age) and
// how far it has gone on its way out (leave, 0 .. 1). Every move is slow:
// a form drifts, turns and breathes over tens of seconds. Each form comes
// and goes in a way of its own, always where it floats: none rises from
// the floor or sinks into it (see show.js for the fades of its light).
//
// Each function returns { centre, size, turn, tilt, yaw, f, dissolve, bound }:
// what the shader's form needs (see formsAt in shaders.js). f is per form
// (f[0..2], see each); dissolve (0 .. 1) lifts the form away as rising points
// (the veil); bound is how far from the centre any of its light reaches, so
// LEDs farther away skip it.
// `face` is the way from the eye towards the form (an angle about the
// vertical, eased in show.js): some forms turn a face to the room, and some
// keep beyond their path as the eye sees it (see BACK).

import { ROOM, EGGS } from './config.js';

const FLOOR = -ROOM.height / 2 - ROOM.foot;        // the mirror floor
const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// An orb: gathers where it hovers, growing a little as its light comes
// (GROW), and shrinks a little as it goes; between, it drifts slowly across
// the room and breathes.
function orb(age, w, leave, ph, face) {
  const size = 3.3 + 0.3 * Math.sin(0.11 * age + ph), drift = 2.0;
  return {
    centre: [drift * Math.sin(0.035 * age + ph), -3.4 + 0.6 * Math.sin(0.03 * age + ph), drift * Math.cos(0.028 * age + ph)],
    size: size * (GROW + (1 - GROW) * w), bound: size * 1.3,
  };
}

// A spiral: unfurls out of its bright core, arms turning, and winds back
// into it as it goes. Its face turns towards the room (never edge-on, where
// it would read as a plain column), leaning a little to and fro.
// f[0]: how far it has unfurled (0.15 .. 1).
function spiral(age, w, leave, ph, face) {
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

// A ring: tumbles slowly, like a coin turning in the air, about a diameter
// that lies aslant (never upright, so its edge is never a line along a
// strand): its face (its axis, n) goes round a circle, turned to the eye
// (and leaning a little towards it below) and then edge-on to it, a slanting
// line, once round in TURN seconds; the diameter's slant sways slowly. It
// comes edge-on, a line that opens into the hoop, and as it goes it turns on
// to the next edge-on place, so it closes into a line as its light goes.
// f[0]: how far its face is turned to the eye (0 edge-on .. 1).
const TURN = 80;                                    // s for a whole turn
const LEAN = 0.32;                                  // how far its face leans towards the eye below
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function ring(age, w, leave, ph, face, go) {
  const size = 3.5, drift = 1.8;
  const e = [-Math.sin(face) * Math.cos(LEAN), -Math.sin(LEAN), -Math.cos(face) * Math.cos(LEAN)];   // towards the eye
  const side = [Math.cos(face), 0, -Math.sin(face)], up = cross(side, e);
  const slant = 0.6 + 0.2 * Math.sin(0.013 * age + ph);   // the diameter's slant from level
  const along = cross(side.map((x, i) => Math.cos(slant) * x + Math.sin(slant) * up[i]), e);   // n edge-on
  const free = (a) => Math.PI / 2 + TAU * a / TURN;   // the turn at age a: edge-on at 0
  let th = free(age);
  if (go) {
    const end = free(go.at + go.fade * 0.8);
    const edge = Math.PI / 2 + Math.PI * Math.ceil((end - Math.PI / 2) / Math.PI);
    th += (edge - end) * smooth((age - go.at) / (go.fade * 0.8));
  }
  const n = e.map((x, i) => x * Math.cos(th) + along[i] * Math.sin(th));
  return {
    centre: [drift * Math.sin(0.02 * age + ph), -3.0 + 0.4 * Math.sin(0.025 * age + ph), drift * Math.cos(0.017 * age + ph)],
    size, turn: 0.12 * age + ph,
    yaw: Math.atan2(-n[0], -n[2]), tilt: Math.acos(Math.max(-1, Math.min(1, n[1]))),   // (see turned in shaders.js)
    f: [Math.abs(Math.cos(th)), 0, 0],
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
function veil(age, w, leave, ph, face) {
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
function solid(age, w, leave, ph) {
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
function knot(age, w, leave, ph, face) {
  const size = 4.6, drift = 1.3;
  return {
    centre: [drift * Math.sin(0.022 * age + ph), -3.2 + 0.3 * Math.sin(0.03 * age + ph), drift * Math.cos(0.018 * age + ph)],
    size, turn: KNOT_SWAY * Math.sin(0.04 * age + ph),
    yaw: face + 0.35 * Math.sin(0.027 * age + 2 * ph),
    f: [-0.1 + 1.2 * smooth(leave * 1.1), -0.05 + 1.15 * smooth(age / 18), 0],
    bound: size * 1.4 + 0.8,
  };
}

// A baked form (an egg, see EGGS): it sits on the floor, its side to the
// room, and sways slowly about the vertical, so that it shows its profile
// and, now and then, a little of its front and its back; it never turns
// round (its outline would read only from the side).
// f[0]: its slab in the shader's field; f[1]: the top of its shape in its
// box (see tools/bake-field.py), so that LEDs above it skip it.
const BASE = 0.9;                                   // its base lies this far below its box's centre (of its size, see tools/bake-field.py)
// Like the orb, it comes and goes by its light's fade alone (FADING), growing
// a little as it comes (GROW), its base kept on the floor.
function baked(egg, age, w, leave, ph, face) {
  const size = egg.size * (GROW + (1 - GROW) * w), drift = 1.2;
  return {
    centre: [drift * Math.sin(0.02 * age + ph), -ROOM.height / 2 + BASE * size + 0.1, drift * Math.cos(0.017 * age + ph)],
    size, yaw: face + 0.55 * Math.sin(0.045 * age + ph),
    f: [egg.field, egg.top, 0],
    bound: size * 1.75, onFloor: true,
  };
}

export const MOTIONS = { orb, spiral, ring, veil, solid, knot,
  ...Object.fromEntries(EGGS.map((egg) => [egg.name, (age, w, leave, ph, face) => baked(egg, age, w, leave, ph, face)])) };
// How far beyond its own path each form keeps, as the eye sees it: the loose
// and the wide ones read from a distance, and none flares right at the eye.
const BACK = { orb: 2.5, spiral: 2.5, ring: 2.5, veil: 3, solid: 2.5, knot: 3.5, ...Object.fromEntries(EGGS.map((egg) => [egg.name, 3])) };

// How large the orb (and a baked form) is as it begins to come and as it has gone, of its full size.
const GROW = 0.75;

// The forms whose coming and going is their light's fade alone: the orb
// and the baked forms, which grow with it (GROW). The others have a move of their own (see
// show.js, SKY_IN).
export const FADING = new Set(['orb', ...EGGS.map((egg) => egg.name)]);

// The form's place at its age: the defaults filled in. w (0 .. 1) is how
// much it shows (its weight, see show.js); go: null while it stays, else
// { at, fade }: its age as it began to go and how long its light takes to go;
// the forms see how far it has gone on its way out (leave, 0 .. 1). anchor is the place on its own path (the eye's way to it
// gives `face`); centre is where it shows.
// rise: how many times higher over the floor it floats (a tall view has the
// room for it; see viewFit in main.js), unless it sits on the floor (onFloor).
export function motion(name, age, w, go, r, face, rise = 1) {
  const leave = go ? smooth((age - go.at) / go.fade) : 0;
  const m = MOTIONS[name](age, w, leave, r * TAU, face, go);
  const [x, y, z] = m.centre, back = BACK[name] || 0;
  const lift = m.onFloor ? 1 : rise;                // (a baked form stays on the floor)
  return { turn: 0, tilt: 0, yaw: 0, f: [0, 0, 0], dissolve: 0, ...m,
    anchor: m.centre, centre: [x + back * Math.sin(face), FLOOR + (y - FLOOR) * lift, z + back * Math.cos(face)] };
}
