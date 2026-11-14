// The easter eggs (see eggs.js for the registry and how each comes, and
// egg-shaders.js for their light). Each egg's params fill its uniforms per
// frame from its age and the camera: out.v, 10 vectors (as egg-shaders.js
// lists them per egg). The order here is the registry's: the secret's turn,
// and the rare slot's draw (the teapot first, see show.js: rareOf).

import { registerEgg } from './eggs.js';
import { BAKED } from './config.js';

// The shader's function per egg (eggAt in egg-shaders.js).
export const EGG = { penrose: 1, clock: 2, fireworks: 3, snow: 4, milky: 5 };

// ---------- the baked forms ----------
// Each baked form (config.js BAKED: the teapot) is an egg held in the form slot.
for (const f of BAKED) registerEgg({ name: f.name, form: f.name, rare: true });

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const put = (v, i, ...xs) => v.set(xs, i * 4);
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => a.map((x, i) => x + b[i] * k);
const sub = (a, b) => add(a, b, -1);

// ---------- a figure that faces the eye ----------
// Where a flat figure facing the eye stands (the penrose, the clock): ahead
// of the eye, the way it looks as seen from above, a little above the middle
// of the view (lift, radians); `dist` away along the line of sight (D0,
// brought nearer where a wall is near: as seen, the same); inside the view
// (by VIEW_EDGE of its half height) and inside the lattice (its height
// between lo and hi). w, h: its half width and half height in units; t0: the
// size of a unit as seen (its tangent) that it would have, if the view and the
// room leave room for it, else as large as they do. All of it is worked out
// from the camera alone, so a time shows one picture (the lab's seek, pause).
// Returns its middle C, the way to the eye N, its right R and up U, and a unit's length.
const VIEW_EDGE = 0.08;
// How far from the eye a figure stands (as far as the walls let it). Far back, a figure as large
// as seen is larger in the room: more LEDs draw it, and the floor (or the layer) takes less of
// the view's height there.
const FAR = 18;
const clamp1 = (x) => Math.max(-1, Math.min(1, x));
function facing(ctx, { w, h, t0, D0, lift, lo, hi }) {
  const { eye, f, aspect } = ctx.camera;
  const vh = ctx.fov / 2, m = VIEW_EDGE * vh;
  const hh = Math.atan(Math.tan(vh) * aspect);
  const az = norm([f[0], 0, f[2]]), side = [-az[2], 0, az[0]];
  const phi = Math.asin(clamp1(f[1]));
  const way = (b) => [az[0] * Math.cos(b), Math.sin(b), az[2] * Math.cos(b)];
  const tMax = Math.min(t0, Math.tan(hh - m) / w);   // (as wide as the view lets it be)
  // Its height: where the view and the lattice both leave room (as angles of elevation from the eye;
  // its top and bottom edges are dist / cos(rho) away, rho its half height as seen). Then the walls:
  // brought nearer until its corners are inside them (as seen, the same), and its height again.
  let dist = D0, rho = Math.atan(tMax * h), beta = phi + lift;
  const wall = ctx.SPAN / 2 - 0.4;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 2; i++) {
      const far = dist / Math.cos(rho);
      const b0 = Math.max(phi - vh + m, Math.asin(clamp1((lo - eye[1]) / far)));
      const b1 = Math.min(phi + vh - m, Math.asin(clamp1((hi - eye[1]) / far)));
      rho = Math.max(0.01, Math.min(Math.atan(tMax * h), (b1 - b0) / 2));
      beta = b1 - b0 < 2 * rho ? (b0 + b1) / 2 : Math.min(Math.max(phi + lift, b0 + rho), b1 - rho);
    }
    if (pass === 2) break;
    const c = way(beta), up = [-Math.sin(beta) * az[0], Math.cos(beta), -Math.sin(beta) * az[2]];
    const tw = (Math.tan(rho) / h) * w, th = Math.tan(rho);
    let k = 1;
    for (const [x, y] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const p = add(add(c, side, x * tw), up, y * th);   // (a corner, per unit of distance)
      for (const i of [0, 2]) if (Math.abs(p[i]) > 1e-6) k = Math.min(k, (wall - Math.sign(p[i]) * eye[i]) / (Math.abs(p[i]) * dist));
    }
    dist = Math.max(3, dist * k);
  }
  const C = add(eye, way(beta), dist);
  const N = norm(sub(eye, C)), R = norm(cross([0, 1, 0], N)), U = cross(N, R);
  return { C, N, R, U, unit: (Math.tan(rho) / h) * dist, dist };
}
// While an egg that asks for it shows, the camera's gaze looks less far up and
// down (main.js: cameraPose): looking down, the view leaves only a thin band
// of lattice above the floor, too thin for a figure at its size.

// ---------- penrose ----------
// The impossible triangle, drawn in light: not a solid, but a picture of one
// in a thin slab of LEDs (a few LED spacings thick) that faces the eye, at
// one distance from it, so every part of it has the same grain, size of point
// and brightness. The figure is the classic one: an equilateral triangle of
// three bars, each showing two of its faces, in three tones; the faces that
// look one way make one L-shaped band over two bars, and where two bands meet,
// each lies over the next in turn (see penroseLight). It turns slowly in its
// plane, breathes a little, its tones travel round, its points shimmer; it
// comes LED by LED, round the figure as a pen would draw it, and goes the
// same way back. The mirrors show it as it is (a true reflection of the slab).
// n: a bar's length in units of its width (a face is one unit wide); thick: the
// slab's half thickness in LED spacings; size: its circumradius as seen (tan);
// roll: one turn in this long (s); breathe: its
// period (s); come: s to come; tones: one step round in this long (s); tall: in a view as
// tall as a phone's (camera.tall 1, see viewFit in main.js), which has room above the
// horizon, it stands this share higher above the middle of the view.
const TRI = { n: 5, thick: 1.25, size: 0.36, roll: 200, breathe: 16, come: 7, tones: 30, tall: 0.6 };
// The three tones: a light face, a middle one and a dark one (as a drawing shades it).
const TONES = [[1.0, 0.86, 0.62], [1.0, 0.42, 0.45].map((x) => x * 0.62), [0.35, 0.5, 1.0].map((x) => x * 0.4)];
// The figure's circumradius in units: its farthest corner from its middle (in
// the picture's coordinates a ex + b ey, ex, ey, ez 120 degrees apart; see penroseLight).
const CIRCUM = (() => {
  const n = TRI.n, c = Math.sqrt(3) / 2;
  const ex = [c, -0.5], ey = [-c, -0.5], ez = [0, 1];
  const at = (x, y, z) => [x * ex[0] + y * ey[0] + z * ez[0], x * ex[1] + y * ey[1] + z * ez[1]];
  const mid = at(2 * n / 3, n / 3, 0);
  const pts = [at(0, 0, 1), at(n, 0, 1), at(n, n - 1, 1), at(n, 0, 0), at(n, n, 0), at(n, n, n - 1), at(0, 1, -(n - 1)), at(1, 1, -(n - 1)), at(0, 1, 1)];
  return Math.max(...pts.map((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1])));
})();
// Eased time: it starts at rest as the figure comes (its slope rises as it does), then runs.
const eased = (age, T) => (age < T ? T * ((age / T) ** 3 - (age / T) ** 4 / 2) : age - T / 2);
registerEgg({
  name: 'penrose', type: EGG.penrose, rain: 0, layer: false, hold: 70, fade: 6, rare: true, steady: 0.6,
  params(s, ctx, out) {
    const level = Math.min(s.w, smooth(s.age / TRI.come));
    const g = eased(s.age, TRI.come);
    const breath = 1 + 0.03 * Math.sin((g / TRI.breathe) * Math.PI * 2);
    const lane = ctx.lane[0];
    const fit = facing(ctx, { w: 1, h: 1, t0: TRI.size * breath, D0: FAR, lift: 0.2 * (ctx.fov / 2) * (1 + TRI.tall * (ctx.camera.tall ?? 0)),
      lo: -ctx.HEIGHT / 2 + 0.3, hi: ctx.HEIGHT / 2 - 0.3 });
    const unit = fit.unit / CIRCUM;                      // a face's width (a cube's edge, as drawn)
    const roll = Math.PI / 2 + (g / TRI.roll) * Math.PI * 2;   // (a corner on top as it comes)
    const half = TRI.thick * lane;
    put(out.v, 0, ...fit.C, half);
    put(out.v, 1, Math.cos(roll), Math.sin(roll), 1 / unit, TRI.n);
    // (edges: soft over about a third of an LED spacing, in the picture's units)
    put(out.v, 2, level, 0.12, (unit * Math.sqrt(3) / 2) / (0.3 * lane), 0);
    // The tones of the bands Z, X, Y: they dwell, then glide one step round (not while it comes).
    const x = Math.max(0, s.age - TRI.come) / TRI.tones, i = Math.floor(x), k = smooth((x - i - 0.7) / 0.3);
    for (let b = 0; b < 3; b++) {
      const c0 = TONES[(b + i) % 3], c1 = TONES[(b + i + 1) % 3];
      put(out.v, 3 + b, ...c0.map((c, j) => c + (c1[j] - c) * k), b === 0 ? 7.5 : 0);
    }
    put(out.v, 6, fit.unit * 1.02 + half + lane, 0, 0, 0);
    return level > 0 ? 1 : 0;   // (its weight: it comes and goes LED by LED, see penroseLight)
  },
});

// ---------- clock ----------
// A panel of 5 x 7 dot glyphs turned to the eye (a dot a few strands wide), one
// or two lines of up to 5 glyphs, each line with its own top left corner. It
// stands where it fits whole above the floor (and above the layer of light,
// while the layer shows), as large as fits.
// CLEAR: how far its lowest dots keep above the top of the layer's band (show.js: topOf, where
// the forms rest), so that the band stays well below the glyphs.
const CLEAR = 1.875;
const CODE = { ':': 10, ' ': 15 };
const pack = (text) => [0, 1, 2, 3, 4].reduce((n, i) => n + (i < text.length ? CODE[text[i]] ?? Number(text[i]) : 15) * 16 ** i, 0);
// lines: { text, y } (y: its top, in dots from the middle, down); w, h: the panel's half width and height in dots.
function panel(out, ctx, lines, { colour, w, h, share }) {
  const lane = ctx.lane[0];
  const tanW = Math.tan(Math.atan(Math.tan(ctx.fov / 2) * ctx.camera.aspect));
  const feet = -ctx.HEIGHT / 2;
  // (above the layer: CLEAR over the top of its band as seen, show.js: topOf)
  const lo = Math.max(feet + 0.4, ctx.layer ? feet + 0.4 + (ctx.layer.top + CLEAR - feet - 0.4) * ctx.layer.w : -Infinity);
  const fit = facing(ctx, { w, h, t0: (share * tanW) / w, D0: FAR, lift: 0.15 * (ctx.fov / 2), lo, hi: ctx.HEIGHT / 2 - 0.4 });
  // It stands upright, as the strands do (so each dot is drawn by whole pieces of strands, and the
  // glyphs stay crisp however high it stands), as tall in the room as the facing panel would be.
  const dot = fit.unit * Math.hypot(fit.N[0], fit.N[2]);
  const R = fit.R.map((x) => x * dot), D = [0, -dot, 0];
  put(out.v, 0, ...R, Math.max(0.2, lane * 0.9));
  put(out.v, 1, ...D, 0.34);
  put(out.v, 2, ...colour, lines.length);
  lines.forEach((l, i) => {
    const lw = l.text.length * 6 - 1;
    const corner = add(add(fit.C, R, -lw / 2), D, l.y);
    put(out.v, 3 + i, ...corner, pack(l.text));
  });
}

// The time of day, HH:MM (local time); in a tall view, HH over MM.
const two = (n) => String(n).padStart(2, '0');
registerEgg({
  name: 'clock', slot: 'overlay', type: EGG.clock, hold: 25, hush: 0.8, rare: true, steady: 0.6,
  params(s, ctx, out) {
    const d = ctx.wall, hh = two(d.getHours()), mm = two(d.getMinutes());
    const tall = ctx.camera.aspect < 1;
    const lines = tall ? [{ text: hh, y: -8 }, { text: mm, y: 1 }] : [{ text: `${hh}:${mm}`, y: -3.5 }];
    panel(out, ctx, lines, tall ? { colour: [0.88, 0.94, 1.0], w: 5.5, h: 8, share: 0.75 }
      : { colour: [0.88, 0.94, 1.0], w: 14.5, h: 3.5, share: 0.62 });
  },
});

// ---------- fireworks, snow, tanabata ----------
// fireworks: shells rise along the strands and burst into spheres of sparks.
registerEgg({
  name: 'fireworks', type: EGG.fireworks, rain: 0, layer: false, hold: 60, rare: true,
  params(s, ctx, out) {
    put(out.v, 0, 1.9, 6, -ctx.HEIGHT / 2, 1.9);
    put(out.v, 1, 1.0, 0.72, 0.32, 0);
    put(out.v, 2, 1.0, 0.38, 0.58, 0);
    put(out.v, 3, 0.4, 0.8, 1.0, 0);
    put(out.v, 4, 0.75, 1.0, 0.6, 0);
  },
});

// snow: slow snow in place of the rain, and a tree of light; on 24 and 25 December.
registerEgg({
  name: 'snow', type: EGG.snow, rain: 0, layer: false, hold: 70,
  when(d) {
    if (d.getMonth() !== 11 || (d.getDate() !== 24 && d.getDate() !== 25)) return null;
    const y = d.getFullYear();
    return { from: new Date(y, 11, 24).getTime(), to: new Date(y, 11, 26).getTime() };
  },
  params(s, ctx, out) {
    const top = ctx.HEIGHT / 2, foot = -ctx.HEIGHT / 2;
    put(out.v, 0, 1.5, 0.42, top + 0.3, foot - 0.3);
    put(out.v, 1, 0, foot, 0, 7.2);
    put(out.v, 2, 3.0, 0, 0, 0);
    put(out.v, 3, 0.85, 0.92, 1.0, 0);
    put(out.v, 4, 0.12, 0.55, 0.32, 0);
    put(out.v, 5, 1.0, 0.78, 0.42, 0);
    put(out.v, 6, 1.0, 0.92, 0.65, 0);
  },
});

// tanabata: the Milky Way across the sky of the room, Vega and Altair on either side.
registerEgg({
  name: 'tanabata', slot: 'overlay', type: EGG.milky, hold: 60, hush: 0.5, rare: true,
  params(s, ctx, out) {
    // A great circle leaning 35 degrees from the horizon; the stars about 15 degrees off it on either side.
    // (its highest part a little left of the way the eye first looks, -z)
    const tilt = 0.6, az = 4.2;
    const pole = [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)].map((x, i) => (i === 1 ? x : -x));
    const way = (azim, elev) => [Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)];
    put(out.v, 0, ...norm(pole), 0.13);
    put(out.v, 1, ...way(az + 0.9, 0.72));     // Vega, above the band (about 16 degrees off it)
    put(out.v, 2, ...way(az + 0.15, 0.25));    // Altair, below it (about 20 degrees)
    put(out.v, 3, 0.62, 0.7, 1.0, 0);
    put(out.v, 4, 0.78, 0.88, 1.0, 0);
    put(out.v, 5, 1.0, 0.93, 0.8, 0);
    put(out.v, 6, 9, 30, 0, 0);
  },
});
