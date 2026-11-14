// How each form of light moves through its life: where it is, how large and
// how turned, at each moment, from the time since it began to come (age) and
// how far it has gone on its way out (leave, 0 .. 1). Every move is slow:
// a form drifts, turns and breathes over tens of seconds. Each form comes
// and goes in a way of its own, always where it floats: none rises from
// the floor or sinks into it (see show.js for the fades of its light).
//
// Each function returns { centre, low, size, turn, tilt, yaw, f, dissolve,
// bound }: what the shader's form needs (see formsAt in shaders.js). f is per
// form (f[0..2], see each); dissolve (0 .. 1) lifts the form away as rising
// points (the veil); bound is how far from the centre any of its light
// reaches, so LEDs farther away skip it. The height of its centre is not its
// own: centre[1] is how far above the lowest place of its path it floats
// (0 at the lowest), and low how far below its centre its light
// reaches now (see lowestAt; without it, its bound).
// motion rests it on the layer of light (ground).
// `face` is the way from the eye towards the form (an angle about the
// vertical, eased in show.js): some forms turn a face to the room, and some
// keep beyond their path as the eye sees it (see BACK).

import { BAKED } from './config.js';
import { SOLIDS, KNOTS } from './figures.js';

// A form's lowest light is where it still shows clearly: a quarter of its
// brightest, as measured on screen. The thin forms' light around their line
// (at full quality; see fineness in shaders.js): a rod's half width, the
// ring's thread with its soft sheath, and a solid's corner point (rod in
// shaders.js).
const ROD = 0.3, THREAD = 0.55, CORNER = 0.45;
// How far each form rises and falls over the lowest place of its path: a
// little, so that it never floats far over the layer.
const BOB = 0.2;

// How far below its centre a rigid shape's light reaches in its pose: its
// points (as in shaders.js, in units of its size) turned about its axis
// (turn) and leaning (tilt; the yaw changes no height, see turned in
// shaders.js). The deepest point counts, softly (SOFT), so that the form
// never jolts as another point becomes the lowest. A new shape states its
// points; a form whose light is no rigid shape (the veil) states its depth.
const SOFT = 4;                                     // per unit: a few tenths of a unit over the deepest point where two are as deep
export function lowestAt(points, size, turn, tilt) {
  const cs = Math.cos(turn), sn = Math.sin(turn), ct = Math.cos(tilt), st = Math.sin(tilt);
  let sum = 0;
  for (const [x, y, z] of points) sum += Math.exp(-SOFT * size * (ct * y + st * (cs * z - sn * x)));
  return Math.log(sum) / SOFT;
}
// The same for a figure that spins about the axis that faces the room (z;
// spin) and then leans (tilt): a knot's link or band (see knotLight). Its
// points lie close along its curves, which move smoothly: the deepest counts
// as it is (softly, many close points would lift it).
export function lowestSpun(points, size, spin, tilt) {
  const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
  let d = -Infinity;
  for (const [x, y, z] of points) d = Math.max(d, -size * (ct * (sn * x + cs * y) + st * z));
  return d;
}
const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// An orb: gathers where it hovers, growing a little as its light comes
// (GROW), and shrinks a little as it goes; between, it drifts slowly across
// the room and breathes.
const ORB_LOW = 0.85;                               // where its light still shows clearly, of its size (see orbLight)
function orb(age, w, leave, ph, face) {
  const size = 3.3 + 0.3 * Math.sin(0.11 * age + ph), drift = 2.0;
  return {
    centre: [drift * Math.sin(0.035 * age + ph), BOB * (1 + Math.sin(0.03 * age + ph)), drift * Math.cos(0.028 * age + ph)],
    low: ORB_LOW * size,                            // (as it breathes; it grows about its centre as it comes)
    size: size * (GROW + (1 - GROW) * w), bound: size * 1.3,
  };
}

// A spiral: unfurls out of its bright core, arms turning, and winds back
// into it as it goes. Its face turns towards the room (never edge-on, where
// it would read as a plain column), leaning a little to and fro.
// f[0]: how far it has unfurled (0.15 .. 1).
const SPIRAL_RIM = 0.85;                            // its disc's light shows clearly out to this share of its size (see spiralLight)
function spiral(age, w, leave, ph, face) {
  const size = 4.2, drift = 2.0;
  const tilt = 1.4 + 0.3 * Math.sin(0.023 * age + 2 * ph);   // its face's lean from level
  return {
    centre: [drift * Math.sin(0.025 * age + ph), BOB * (1 + Math.sin(0.02 * age + ph)), drift * Math.cos(0.02 * age + ph)],
    low: SPIRAL_RIM * size * Math.abs(Math.sin(tilt)),   // its rim, unfurled, at its lean
    size, turn: 0.1 * age + ph,
    yaw: face + 0.75 * Math.sin(0.031 * age + ph),
    tilt,
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
    centre: [drift * Math.sin(0.02 * age + ph), BOB * (1 + Math.sin(0.025 * age + ph)), drift * Math.cos(0.017 * age + ph)],
    // Its rim reaches lowest upright, and half as low at its most level: it
    // rolls a little on the layer as it tumbles, never far over it.
    low: size * (0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - n[1] * n[1]))) + THREAD,
    size, turn: 0.12 * age + ph,
    yaw: Math.atan2(-n[0], -n[2]), tilt: Math.acos(Math.max(-1, Math.min(1, n[1]))),   // (see turned in shaders.js)
    f: [Math.abs(Math.cos(th)), 0, 0],
    bound: size + 1.2,
  };
}

// A veil, like an aurora: a curtain of light across the room, hanging in
// folds that slowly travel along it, its rays rising from a bright lower
// hem just over the layer of light; it unrolls from one end, sways slowly about the way it faces the
// room, and goes by lifting away upward.
// f[0]: how much of it has unrolled (0 .. 1); f[1]: how far it has lifted;
// f[2]: half its length.
function veil(age, w, leave, ph, face) {
  const size = 4.6;                                 // the height of its longest rays
  const half = 8, drift = 1.5;
  return {
    centre: [drift * Math.sin(0.015 * age + ph), BOB * (1 + Math.sin(0.03 * age + ph)), drift * Math.cos(0.012 * age + ph)],
    low: 0.75 + 0.3 + 0.1,                          // its hem's lowest fold (see veilLight) and the glow below it
    size, turn: 0.05 * age + ph * 3,
    yaw: face + 0.16 * Math.sin(0.017 * age + ph * 2),
    f: [smooth(age / 20), 6 * smooth(leave), half],
    dissolve: 0.5 * smooth(leave),
    bound: half + size + 3 + 6 * smooth(leave),
  };
}

// A solid: bright points come first, the corners of a solid; its edges are
// drawn out from them until they meet. It stands on an axis of its own,
// leaning a little, and turns slowly about that axis, while the way it leans
// goes slowly round: no edge ever runs along a strand. It goes as its edges
// draw back into the corners. Each time it is one of SOLIDS (figures.js),
// for its whole life (v).
// f[0]: which solid; f[1]: how far the edges are drawn (0 .. 1).
// It rests on its lowest corner (corners: SOLIDS in figures.js).
function solid(age, w, leave, ph, face, go, v) {
  const { size, corners } = SOLIDS[v], drift = 1.3;
  const turn = 0.055 * age + ph, tilt = 0.3 + 0.1 * Math.sin(0.05 * age + 3 * ph);
  return {
    centre: [drift * Math.sin(0.024 * age + ph), BOB * (1 + Math.sin(0.027 * age + ph)), drift * Math.cos(0.019 * age + ph)],
    low: lowestAt(corners, size, turn, tilt) + CORNER, size, turn, tilt,
    yaw: 0.04 * age + 2 * ph,
    f: [v, smooth((age - 5) / 17) * (1 - smooth(leave * 1.25)), 0],
    bound: size + 1.2,
  };
}

// A knot: a closed curve (or a few, a link), drawn once round as it comes,
// its broad side to the room, swaying; it goes as the curve is undone from
// where it began (a link: each of its rings at once). Each time it is one of
// KNOTS (figures.js), for its whole life (v). A Lissajous curve's phase
// sways about the place where its loops stand widest open, never as far as
// where they close into one line; a rigid figure (a link, a band) spins
// slowly about the axis that faces the room, and leans a little to and fro,
// so that its crossings show which way they pass. It rests on its lowest
// light: a Lissajous curve's at the bottom of its box, a rigid figure's in
// its pose (its points in figures.js).
// turn: its phase, or its spin; f[0] .. f[1]: the part of the curve that
// shows; f[2]: which knot.
function knot(age, w, leave, ph, face, go, v) {
  const k = KNOTS[v], { size } = k, drift = 1.3;
  const rigid = k.curve !== 'lissajous';
  const turn = rigid ? 0.05 * age + ph : k.widest + k.sway * Math.sin(0.04 * age + ph);
  const tilt = rigid ? (k.lean || 0) + 0.15 * Math.sin(0.023 * age + 3 * ph) : 0;
  return {
    centre: [drift * Math.sin(0.022 * age + ph), BOB * (1 + Math.sin(0.03 * age + ph)), drift * Math.cos(0.018 * age + ph)],
    low: (rigid ? lowestSpun(k.points, size, turn, tilt) : size * k.box[1]) + ROD,
    size, turn, tilt,
    yaw: face + (rigid ? 0.2 : 0.35) * Math.sin(0.027 * age + 2 * ph),
    f: [-0.1 + 1.2 * smooth(leave * 1.1), -0.05 + 1.15 * smooth(age / 18), v],
    bound: size * Math.hypot(...k.reach) + 0.8,
  };
}

// A black hole: a dark heart (its shadow) in a thin disc of matter that turns
// about it and is drawn into it, the disc's far side lifted over and under
// the heart as the eye sees it (the lens), and two jets along the disc's
// axis (see holeLight in shaders.js). The disc shows itself to the eye from
// a little above its plane: its axis leans towards the eye by how far the
// eye looks up at it (rise, from show.js) and by its opening, which sways
// slowly between 4.5 and 8 degrees.
// It comes as a wide, faint spiral of matter that winds in until the disc
// has formed, while the heart goes dark; then the jets grow out of it. It
// goes: the jets first, then the disc drains into the heart, the ring at the
// heart's edge shrinks to a point and goes out, and the darkness closes last.
// hole: the shadow's radius now; dark: how dark it is (0 .. 1; see show.js).
// f[0]: how far the disc has formed; f[1]: how far it has drained; f[2]: hole.
// turn: how far the jets reach (0 .. 1). tilt: the axis's lean towards the eye.
// BH: size, the disc's outer radius; shadow, the heart's full radius; sheet,
// the disc's half thickness (HOLE_SHEET in shaders.js); under, the arch
// under the heart, of the shadow's radius (HOLE_UNDER); down, how far past
// the heart the lower jet still shows clearly (HOLE_JET).
const BH = { size: 5.4, shadow: 1.5, sheet: 0.3, under: 1.25, down: 1.0 };
const BH_RIM = 0.9;                                 // the disc's light shows clearly out to this share of its outer edge (see holeLight)
function blackhole(age, w, leave, ph, face, go, v, rise = 0.3) {
  const { size, shadow } = BH, drift = 1.3;
  const hole = shadow * (1 - smooth((leave - 0.3) / 0.6));   // shrinks to a point as the disc drains
  const f = [smooth(age / 20), smooth(leave * 1.8), hole];
  const open = 0.11 + 0.03 * Math.sin(0.023 * age + 2 * ph);
  const tilt = Math.max(-0.3, Math.min(0.8, open + rise));   // (not past these, where the eye is high over it or right under it)
  // Its outer edge (as in holeLight): wide as it gathers. (As it drains the edge is drawn in,
  // and the heart stays where it is: it does not sink.)
  const outer = size * (1.6 - 0.6 * f[0]);
  const bound = size * 1.1 + 0.8;                   // (the wide spiral it gathers from reaches past it, and is cut there)
  return {
    centre: [drift * Math.sin(0.021 * age + ph), BOB * (1 + Math.sin(0.027 * age + ph)), drift * Math.cos(0.017 * age + ph)],
    // Its lowest light: the disc's near or far edge at its lean, the arch under the heart, or the lower jet
    // (counted from the first, so that the form stays where it is as the jets grow and go).
    low: Math.max(BH_RIM * Math.min(outer, bound) * Math.abs(Math.sin(tilt)) + BH.sheet * Math.cos(tilt),
      BH.under * shadow, (1.05 * shadow + BH.down) * Math.cos(tilt)),
    size, turn: smooth((age - 16) / 8) * (1 - smooth(leave * 3)),
    tilt, f, hole, dark: smooth((age - 5) / 12) * (1 - smooth((leave - 0.8) / 0.2)),
    bound,
  };
}

// A baked form (see BAKED): it rests on the layer of light, its side to the
// room, and sways slowly about the vertical, so that it shows its profile
// and, now and then, a little of its front and its back; it never turns
// round (its outline would read only from the side).
// f[0]: its slab in the shader's field; f[1]: the top of its shape in its
// box (see tools/bake-field.py), so that LEDs above it skip it.
const BASE = 0.9;                                   // its base lies this far below its box's centre (of its size, see tools/bake-field.py)
const SKIN = 0.35;                                  // its skin's light below its base (see bakedLight)
// Like the orb, it comes and goes by its light's fade alone (FADING), growing
// a little as it comes (GROW), its base kept on the layer.
function baked(egg, age, w, leave, ph, face) {
  const size = egg.size * (GROW + (1 - GROW) * w), drift = 1.2;
  return {
    centre: [drift * Math.sin(0.02 * age + ph), 0, drift * Math.cos(0.017 * age + ph)],
    low: BASE * size + SKIN,                        // its base, kept on the layer as it grows
    size, yaw: face + 0.55 * Math.sin(0.045 * age + ph),
    f: [egg.field, egg.top, 0],
    bound: size * 1.75,
  };
}

export const MOTIONS = { orb, spiral, ring, veil, solid, knot, blackhole,
  ...Object.fromEntries(BAKED.map((egg) => [egg.name, (age, w, leave, ph, face) => baked(egg, age, w, leave, ph, face)])) };
// How far beyond its own path each form keeps, as the eye sees it: the loose
// and the wide ones read from a distance, and none flares right at the eye.
const BACK = { orb: 2.5, spiral: 2.5, ring: 2.5, veil: 3, solid: 2.5, knot: 3.5, blackhole: 2, ...Object.fromEntries(BAKED.map((egg) => [egg.name, 3])) };

// How large the orb (and a baked form) is as it begins to come and as it has gone, of its full size.
const GROW = 0.75;

// The forms whose coming and going is their light's fade alone: the orb
// and the baked forms, which grow with it (GROW). The others have a move of their own (see
// show.js, SKY_IN).
export const FADING = new Set(['orb', ...BAKED.map((egg) => egg.name)]);

// The form's place at its age: the defaults filled in. w (0 .. 1) is how
// much it shows (its weight, see show.js); go: null while it stays, else
// { at, fade }: its age as it began to go and how long its light takes to go;
// the forms see how far it has gone on its way out (leave, 0 .. 1). anchor is the place on its own path (the eye's way to it
// gives `face`); centre is where it shows.
// ground: the height the forms rest on, the top of the layer's band (see
// show.js): at the lowest of its path (centre[1] 0), a form's lowest light
// (low below its centre) just touches it.
// v: which of its figures it is (the solid, the knot, see figures.js).
// rise: how far the eye looks up at the form (rad; the black hole shows its disc to the eye).
export function motion(name, age, w, go, r, face, ground, v = 0, rise) {
  const leave = go ? smooth((age - go.at) / go.fade) : 0;
  const m = MOTIONS[name](age, w, leave, r * TAU, face, go, v, rise);
  const [x, h, z] = m.centre, back = BACK[name] || 0;
  const y = ground + (m.low ?? m.bound) + h;
  return { turn: 0, tilt: 0, yaw: 0, f: [0, 0, 0], dissolve: 0, ...m,
    anchor: [x, y, z], centre: [x + back * Math.sin(face), y, z + back * Math.cos(face)] };
}
