// The path of the Lorenz equations, as a field the shader can look up: the
// attractor form reads its light from it with one lookup per LED, however
// long the path is (see attractorLight in shaders.js).
//
// Two paths set out side by side from almost the same place, and follow the
// same equations. For a while they run together; then, as chaos has it, they
// part, and each goes its own way round the two wings. The field holds, per
// cell and per path, how near the path comes (0 .. 1) and where along the
// path that is (0 at its start .. 1 at its end), so light can travel along it.
//
// The path is worked out once, from a fixed start, with plain arithmetic:
// the same on every machine, so a time of the show gives the same picture.

export const LORENZ = {
  cells: 48,       // cells along each side of the field
  half: 1.2,       // the field reaches this far from the form's centre, in units of the form's size
  loops: 16,       // about how many turns round a wing each path takes
  apart: 0.012,    // how far apart the two paths set out (in the equations' units)
  thick: 0.075,    // how thick the path is in the field, in units of the form's size
};
const SIGMA = 10, RHO = 28, BETA = 8 / 3;
const DT = 0.004, LOOP = 0.75;   // the step, and about how long one turn takes, in the equations' time
const SCALE = 25;                // the equations' units per unit of the form's size
const FADE = 0.03;               // the path fades in over this share of its length, and out again

const slope = ([x, y, z]) => [SIGMA * (y - x), x * (RHO - z) - y, x * y - BETA * z];
const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
// One step of the equations (DT of their time) from p = [x, y, z].
export function lorenzStep(p) {
  const a = slope(p), b = slope(add(p, a, DT / 2)), c = slope(add(p, b, DT / 2)), d = slope(add(p, c, DT));
  return p.map((v, i) => v + (a[i] + 2 * b[i] + 2 * c[i] + d[i]) * DT / 6);
}

// The two paths, in the form's own frame: x across the wings, y up, z through
// them; each a list of [x, y, z].
export function lorenzPaths() {
  let p = [1, 1, 1];
  for (let i = 0; i < 5000; i++) p = lorenzStep(p);        // onto the attractor first
  const n = Math.round(LORENZ.loops * LOOP / DT);
  return [p, [p[0] + LORENZ.apart, p[1], p[2]]].map((q) => {
    const path = [];
    for (let i = 0; i < n; i++) {
      path.push([q[0] / SCALE, (q[2] - 25) / SCALE, q[1] / SCALE]);
      q = lorenzStep(q);
    }
    return path;
  });
}

// The field: cells^3 cells of (nearness of the first path, place along it,
// nearness of the second path, place along it), x fastest, then y, then z.
export function lorenzField() {
  const { cells: n, half, thick } = LORENZ;
  const data = new Float32Array(n * n * n * 4);
  const cell = 2 * half / n, reach = Math.ceil(2.2 * thick / cell);
  lorenzPaths().forEach((path, which) => {
    path.forEach((q, k) => {
      const s = k / path.length;
      const ends = Math.min(1, s / FADE, (1 - s) / FADE);
      const at = q.map((v) => (v + half) / cell - 0.5);   // in cells: cell i has its middle at i
      const [i0, j0, k0] = at.map(Math.round);
      for (let dk = -reach; dk <= reach; dk++) for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        const i = i0 + di, j = j0 + dj, l = k0 + dk;
        if (i < 0 || j < 0 || l < 0 || i >= n || j >= n || l >= n) continue;
        const d2 = ((i - at[0]) ** 2 + (j - at[1]) ** 2 + (l - at[2]) ** 2) * cell * cell;
        const near = ends * Math.exp(-d2 / (thick * thick));
        const o = ((l * n + j) * n + i) * 4 + which * 2;
        if (near > data[o]) { data[o] = near; data[o + 1] = s; }
      }
    });
  });
  return { cells: n, data };
}
