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

// ---------- penrose ----------
// The tribar: three beams along three axes at right angles, end to end,
// P0 -> P1 -> P2 -> P3. Seen from the one way where P3 lies on the line from
// the eye to P0, the two open ends meet and the three close into an
// impossible triangle. So it is set up anew each frame for where the eye is:
// its diagonal (P0 to P3) points from P0 straight at the eye, and it stands
// ahead of the eye, about where it looks (brought nearer, the same in the
// picture, where it would leave the lattice). Its beams widen with the
// distance from the eye (as seen, every part of a beam is as wide, so the far
// end and the near end look as wide where they meet). It may turn in the
// plane of the picture (a roll about the line of sight keeps the trick),
// breathe a little, and its tones travel round its beams. The mirrors show
// it as it is: the floor's image, seen from the eye's image under the floor,
// quietly gives the trick away (the open, crooked tribar).
// L: a beam's length; w: its width at the anchor's distance; far: how far ahead of the eye it
// stands; tilt: how far above the way the eye looks; roll: its turn in the picture (a corner on top).
const TRI = { L: 6.5, w: 1.4, far: 12, tilt: 0.2, roll: -Math.atan2(0.2357, 0.5443), spin: 150, breathe: 14 };
const G = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const B1 = [1 / Math.sqrt(2), -1 / Math.sqrt(2), 0], B2 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
const TONES = [[1.0, 0.72, 0.3], [1.0, 0.35, 0.62], [0.35, 0.62, 1.0]];   // amber, rose, ice
// Three axes at right angles whose diagonal is v, turned by roll about it.
function frameAbout(v, roll) {
  const r0 = norm(cross(v, [0, 1, 0])), u0 = cross(r0, v);
  const c = Math.cos(roll), s = Math.sin(roll);
  const r = add(r0.map((x) => x * c), u0, s), u = add(r0.map((x) => -x * s), u0, c);
  return [0, 1, 2].map((k) => [0, 1, 2].map((i) => G[k] * v[i] + B1[k] * r[i] + B2[k] * u[i]));
}
// The tribar of beams L long anchored at C, for the eye at `eye`: P0 and the axes.
function tribar(C, eye, L, roll) {
  const v = norm(sub(eye, C));
  const e = frameAbout(v, roll);
  // P0 from the anchor: so that the anchor is the middle of the triangle as seen (P3 lies in
  // front of P0), and halfway between P0 and P3 in depth.
  const q = [0, 1, 2].map((i) => L * (2 * e[0][i] + e[1][i]) / 3);
  const P0 = sub(C, add(add(q, v, -dot(q, v)), v, (L * Math.sqrt(3)) / 2));
  // Then the axes again about the way from P0 itself to the eye: so P3 = P0 + L (e0 + e1 + e2)
  // lies exactly on P0's line of sight, whatever the perspective.
  const ax = frameAbout(norm(sub(eye, P0)), roll);
  const P = [P0];
  for (const a of ax) P.push(add(P.at(-1), a, L));
  return { P, ax };
}
// How far to bring the tribar towards the eye (0 .. 1: the same in the picture, only smaller)
// so that its corners stay inside the lattice, by a beam's half width there (w at distance F) and m.
function fitIn(points, eye, ctx, w, F, m) {
  let s = 1;
  for (const p of points) {
    const e = m + 0.5 * w * Math.hypot(...sub(p, eye)) / F;
    const lo = [-ctx.SPAN / 2 + e, -ctx.HEIGHT / 2 + e, -ctx.SPAN / 2 + e], hi = [ctx.SPAN / 2 - e, ctx.HEIGHT / 2 - e, ctx.SPAN / 2 - e];
    for (let i = 0; i < 3; i++) {
      const d = p[i] - eye[i];
      if (p[i] > hi[i] && d > 1e-6) s = Math.min(s, Math.max(0, hi[i] - eye[i]) / d);
      if (p[i] < lo[i] && d < -1e-6) s = Math.min(s, Math.max(0, lo[i] - eye[i]) / d);
    }
  }
  return Math.max(0.3, s);
}
// The anchor moved across the line of sight so that the triangle as seen (P0, P1, P2) has its
// middle where the anchor C0 is seen: it turns in the picture about its own middle.
function centred(C0, eye, L, roll) {
  const c = sub(C0, eye), F = Math.hypot(...c), t = c.map((x) => x / F);
  let C = C0;
  for (let i = 0; i < 2; i++) {
    const { P } = tribar(C, eye, L, roll);
    const m = [0, 0, 0];
    for (const p of P.slice(0, 3)) { const d = sub(p, eye), k = 1 / (3 * dot(d, t)); for (let j = 0; j < 3; j++) m[j] += d[j] * k; }
    C = add(C, sub(t, m), F);
  }
  return C;
}
registerEgg({
  name: 'penrose', type: EGG.penrose, rain: 0, layer: false, hold: 70, rare: true,
  params(s, ctx, out) {
    const { camera } = ctx;
    // (farther in a tall view, so that it fits the width)
    const far = TRI.far / Math.sqrt(Math.min(1, camera.aspect));
    const L0 = TRI.L * (1 + 0.025 * Math.sin((s.age / TRI.breathe) * Math.PI * 2));
    const roll = TRI.roll + (s.age / TRI.spin) * Math.PI * 2;
    // (ahead of the eye at a height of its own: a little above level, whichever way the eye looks up or down)
    const fh = norm([camera.f[0], 0, camera.f[2]]);
    const up = Math.min(0.6, Math.max(-0.05, Math.asin(camera.f[1]) + TRI.tilt * (camera.rise ?? 1)));
    const C0 = add(camera.eye, [fh[0] * Math.cos(up), Math.sin(up), fh[2] * Math.cos(up)], far);
    const eye = camera.eye;
    // Inside the lattice.
    const Cm = centred(C0, camera.eye, L0, roll);
    const k = fitIn(tribar(Cm, camera.eye, L0, roll).P, camera.eye, ctx, TRI.w, far, 0.3);
    const C = add(camera.eye, sub(Cm, camera.eye), k), L = L0 * k, w = TRI.w * k;
    const { P, ax } = tribar(C, eye, L, roll);
    const F = Math.hypot(...sub(eye, C));
    // It comes beam by beam, and goes the other way (each LED by LED, see penroseLight).
    const level = Math.min(s.w, smooth(s.age / 5));
    const here = [0, 1, 2].map((b) => smooth(level * 3 - b));
    const dFar = Math.hypot(...sub(eye, P[0]));
    const reach = Math.max(...P.map((p) => Math.hypot(...sub(p, C)))) + w * (dFar / F);
    put(out.v, 0, ...P[0], F);
    put(out.v, 1, ...ax[0].map((x) => x * L), w);
    put(out.v, 2, ...ax[1].map((x) => x * L), here[0]);
    put(out.v, 3, ...ax[2].map((x) => x * L), here[1]);
    put(out.v, 4, ...C, Math.max(0.2, ctx.lane[0] * 0.8));
    put(out.v, 5, ...eye, here[2]);
    // The tones of the faces across each axis: they travel round, one step in 24 s.
    const ph = s.age / 24;
    for (let a = 0; a < 3; a++) {
      const x = ph + a, i = Math.floor(x), f = smooth(x - i);
      const c0 = TONES[i % 3], c1 = TONES[(i + 1) % 3];
      put(out.v, 6 + a, ...c0.map((c, j) => c + (c1[j] - c) * f), 0);
    }
    put(out.v, 9, reach + 1.5, 0, 0, 0);
    return level > 0 ? 1 : 0;   // (its weight: the beams come and go by `here`)
  },
});

// ---------- clock ----------
// A panel of 5 x 7 dot glyphs facing the eye (a dot a few strands wide), one
// or two lines of up to 5 glyphs, each line with its own top left corner.
const CODE = { ':': 10, ' ': 15 };
const pack = (text) => [0, 1, 2, 3, 4].reduce((n, i) => n + (i < text.length ? CODE[text[i]] ?? Number(text[i]) : 15) * 16 ** i, 0);
function panel(out, ctx, lines, { colour, dot, distance }) {
  const { eye, f, r } = ctx.camera;
  const R = norm([r[0], 0, r[2]]).map((x) => x * dot);
  const D = [0, -dot, 0];
  // (a little above the middle of the view, clear of the layer)
  const centre = add(add(eye, f, distance), [0, 1, 0], distance * Math.tan(ctx.fov / 2) * 0.3);
  put(out.v, 0, ...R, Math.max(0.2, ctx.lane[0] * 0.9));
  put(out.v, 1, ...D, 0.34);
  put(out.v, 2, ...colour, lines.length);
  lines.forEach((l, i) => {
    const w = l.text.length * 6 - 1;
    const corner = add(add(centre, R, -w / 2), D, l.y);
    put(out.v, 3 + i, ...corner, pack(l.text));
  });
}
// How far a panel of `dots` across should stand, to fill about `share` of the view's width.
const fitDistance = (ctx, dots, dot, share) => {
  const tanH = Math.tan(ctx.fov / 2) * ctx.camera.aspect;
  return Math.min(15, Math.max(6.5, (dots * dot) / (share * 2 * tanH)));
};
const dotSize = (ctx) => Math.max(0.62, ctx.lane[0] * 1.6);

// The time of day, HH:MM (local time).
const two = (n) => String(n).padStart(2, '0');
registerEgg({
  name: 'clock', slot: 'overlay', type: EGG.clock, hold: 25, hush: 0.6, rare: true,
  params(s, ctx, out) {
    const d = ctx.wall, hh = two(d.getHours()), mm = two(d.getMinutes());
    const dot = dotSize(ctx);
    const tall = ctx.camera.aspect < 1;
    const lines = tall ? [{ text: hh, y: -8.5 }, { text: mm, y: 1.5 }] : [{ text: `${hh}:${mm}`, y: -3.5 }];
    const dots = tall ? 11 : 29;
    panel(out, ctx, lines, { colour: [0.88, 0.94, 1.0], dot, distance: fitDistance(ctx, dots, dot, tall ? 0.75 : 0.62) });
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
