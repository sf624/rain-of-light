// The figures of the forms of mathematics, each time one for its whole life
// (see show.js, variantOf): the solids (wireframes) and the knots (closed
// curves, a link of two rings, a Moebius band). Their names are the
// settings' options (config.js), their geometry the shader's tables
// (shaders.js: SOLID, KNOT), their size and height the motions' (forms.js).
// The order is the shader's numbering.

const TAU = Math.PI * 2;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = (a) => Math.sqrt(dot(a, a));
const unit = (a) => a.map((v) => v / len(a));

// The turn that takes `axis` to the vertical (y).
function standing(points, axis) {
  const a = unit(axis), y = [0, 1, 0];
  const c = dot(a, y), k = [a[2], 0, -a[0]];          // the axis to turn about: a x y
  const s = len(k);
  const turn = (p) => {
    if (s < 1e-9) return c > 0 ? p : [p[0], -p[1], -p[2]];
    const n = k.map((v) => v / s);
    const nxp = [n[1] * p[2] - n[2] * p[1], n[2] * p[0] - n[0] * p[2], n[0] * p[1] - n[1] * p[0]];
    const ndp = dot(n, p);
    return p.map((v, i) => v * c + nxp[i] * s + n[i] * ndp * (1 - c));
  };
  return points.map(turn);
}

// A solid from its corners: centred on `centre` (default: their middle),
// scaled so that the farthest corner is 1 away, its edges the pairs of
// corners `apart` away (default: the nearest pairs).
function solidOf(name, { corners, axis, centre, apart, size, y }) {
  const mid = centre || corners[0].map((_, i) => corners.reduce((s, p) => s + p[i], 0) / corners.length);
  let pts = corners.map((p) => sub(p, mid));
  const far = Math.max(...pts.map(len));
  pts = pts.map((p) => p.map((v) => v / far));
  if (axis) pts = standing(pts, axis);
  const gaps = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) gaps.push([i, j, len(sub(pts[i], pts[j]))]);
  const want = apart === undefined ? Math.min(...gaps.map((g) => g[2])) : apart / far;
  const edges = gaps.filter((g) => Math.abs(g[2] - want) < 1e-3).map(([i, j]) => [i, j]);
  // The nearest any edge comes to the centre: within it no LED is near an edge.
  const near = Math.min(...edges.map(([i, j]) => {
    const A = pts[i], ba = sub(pts[j], A);
    const h = Math.min(1, Math.max(0, -dot(A, ba) / dot(ba, ba)));
    return len(A.map((v, k) => v + ba[k] * h));
  }));
  return { name, corners: pts, edges, near, size, y };
}

const cube = [];
for (const x of [-1, 1]) for (const yy of [-1, 1]) for (const z of [-1, 1]) cube.push([x, yy, z]);

// The solids. size: how far its corners are from its centre (world units);
// y: how high that centre floats (see forms.js: solid). Each stands on a
// corner's axis and turns about it, leaning a little: no edge ever runs
// along a strand.
export const SOLIDS = [
  // A tetrahedron, point up.
  solidOf('tetrahedron', { corners: [[0, 1, 0], [0.94281, -0.33333, 0], [-0.47140, -0.33333, 0.81650], [-0.47140, -0.33333, -0.81650]],
    centre: [0, 0, 0], size: 5.0, y: -3.7 }),
  // A cube on a corner.
  solidOf('cube', { corners: cube, axis: [1, 1, 1], size: 4.5, y: -3.0 }),
  // Two tetrahedra through each other (stella octangula), one point up, one
  // down: the diagonals of a cube's faces.
  solidOf('star', { corners: cube, axis: [1, 1, 1], apart: 2 * Math.SQRT2, size: 4.8, y: -3.0 }),
];

// The knots and links: closed curves, each part once round as t goes from 0
// to 2 pi. Three kinds:
// lissajous: x, y, z = box * sin(w t + phase), the phase of x swaying about
//   `widest` (where the loops stand widest open) by `sway`, never as far as
//   where they close into one line (pi / (2 w.y) from it); the depth's
//   phase follows (shaders.js: knotLight).
// rings: a link of rigid circles, each at t its centre + cos t u + sin t v
//   (u, v: unit axes in its plane), turned by `view` (yaw about the
//   vertical, then tilt about x) so that their crossings stand open to the
//   room, and fitted so that the widest of x and y spans -1 .. 1 (each
//   ring's radius then 1 / half). It spins slowly about the axis that faces
//   the room, and leans a little.
// band: a Moebius band about the axis that faces the room, R out from it
//   and r wide each way (in units of size), seen aslant (lean, radians);
//   it spins like the rings.
// size: its half width, in world units; y: how high its centre floats (see forms.js: knot).
export const MOBIUS_RULINGS = 12;                 // the band's brighter straight lines, round it
const turnPoint = ([x, y, z], yaw, tilt) => {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  [x, z] = [cy * x - sy * z, sy * x + cy * z];
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  return [x, ct * y - st * z, st * y + ct * z];
};
// A ring's point at t.
const ringAt = (r, t) => r.centre.map((c, i) => c + r.radius * (Math.cos(t) * r.u[i] + Math.sin(t) * r.v[i]));
// The rings turned and fitted (see rings above), and how far they reach.
function ringsOf(k) {
  let rings = k.rings.map(({ centre, u, v }) => ({ centre: turnPoint(centre, ...k.view), u: turnPoint(u, ...k.view), v: turnPoint(v, ...k.view), radius: 1 }));
  // (A circle spans its centre +- radius * hypot(u_i, v_i) along axis i.)
  const span = (r, i, s) => r.centre[i] + s * r.radius * Math.hypot(r.u[i], r.v[i]);
  const lo = [0, 1, 2].map((i) => Math.min(...rings.map((r) => span(r, i, -1)))), hi = [0, 1, 2].map((i) => Math.max(...rings.map((r) => span(r, i, 1))));
  const mid = lo.map((v, i) => (v + hi[i]) / 2), half = Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2;
  rings = rings.map((r) => ({ ...r, centre: r.centre.map((v, i) => (v - mid[i]) / half), radius: r.radius / half }));
  // (It spins about z: its reach across and up is the farthest any point is from that axis.)
  const points = rings.flatMap((r) => Array.from({ length: 720 }, (_, i) => ringAt(r, TAU * i / 720)));
  const across = Math.max(...points.map(([x, y]) => Math.hypot(x, y))) * 1.001;
  return { ...k, rings, reach: [across, across, (hi[2] - lo[2]) / 2 / half] };
}

export const KNOTS = [
  // A Lissajous curve: twice across while once up and down (a figure of eight), three times in depth.
  { name: 'lissajous', curve: 'lissajous', w: [2, 1, 3], box: [1, 0.9, 0.4], widest: 0, sway: 0.55, size: 4.6, y: -3.2 },
  // Two rings, each through the other's centre, both aslant to the room.
  { name: 'hopf', curve: 'rings', rings: [{ centre: [-0.5, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }, { centre: [0.5, 0, 0], u: [1, 0, 0], v: [0, 0, 1] }],
    view: [0, Math.PI / 4], size: 5.0, y: -3.2 },
  // A Moebius band: R out from its axis, r wide each way.
  { name: 'mobius', curve: 'band', R: 0.66, r: 0.34, lean: 0.9, size: 5.2, y: -3.2 },
].map((k) => (k.curve === 'rings' ? ringsOf(k) : k.curve === 'band' ? { ...k, reach: [k.R + k.r, k.R + k.r, k.r] }
  : { ...k, reach: k.box }));
