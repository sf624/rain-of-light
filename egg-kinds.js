// The easter eggs (see eggs.js for the registry and the triggers, and
// egg-shaders.js for their light). Each egg's params fill its uniforms per
// frame from its age and the camera: out.v, 8 vectors (as egg-shaders.js
// lists them per egg), and for the form slot out.bits.

import { registerEgg } from './eggs.js';
import { EGGS as BAKED } from './config.js';
import { createLife, CYCLE as LIFE_CYCLE } from './egg-life.js';

// The shader's function per egg (eggsAt in egg-shaders.js).
export const EGG = { life: 1, penrose: 2, glyphs: 3, rhythm: 4, fireworks: 5, snow: 6, milky: 7 };

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const put = (v, i, ...xs) => v.set(xs, i * 4);
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => a.map((x, i) => x + b[i] * k);
const yawed = (a, th) => [a[0] * Math.cos(th) + a[2] * Math.sin(th), a[1], -a[0] * Math.sin(th) + a[2] * Math.cos(th)];

// ---------- glider ----------
// Life on the layer: the strands' lattice seen from above is the board, a cell
// a few strands wide; the cells light at the height of the layer. The eye
// rises and looks down, so the sheet is seen, not edge on.
const GEN = 0.6;                    // s a generation
const life = createLife();
registerEgg({
  name: 'glider', type: EGG.life, layer: false, rain: 0, hold: 70,
  view: { lift: 7, pitch: -0.75 },
  params(s, ctx, out) {
    const g = s.age / GEN, n = Math.floor(g);
    const { now, before } = life(n);
    out.bits.set(now, 0);
    out.bits.set(before, 32);
    const cell = ctx.SPAN / 32;
    // the last generations of a cycle fade, and the board starts again
    const k = n % LIFE_CYCLE;
    const fade = smooth((LIFE_CYCLE - k - (g - n)) / 3);
    // The board wraps round the room, so it can begin anywhere: the glider's first cells lie a
    // little ahead of where the eye was as the egg began, a little left of the middle, so that it
    // walks across the view (it goes towards +x +z); the sheet lies low, so that its image in the
    // floor lies close under it.
    const e0 = ctx.eyeAt(-s.age);
    const ahead = norm([-e0[0], 0, -e0[2]]), left = [ahead[2], 0, -ahead[0]];
    const g0 = add(add(e0, ahead, 9), left, 1.5);
    put(out.v, 0, g0[0] - 2 * cell, g0[2] - 2 * cell, cell, -ctx.HEIGHT / 2 + 0.3);
    put(out.v, 1, Math.max(0.2, ctx.lane[1] * 0.8), g - n, 0.12, 0);
    put(out.v, 2, 0.15 * fade, 1.0 * fade, 0.65 * fade, 0);
    put(out.v, 3, 0.9 * fade, 1.0 * fade, 0.95 * fade, 0);
  },
});

// ---------- penrose ----------
// The tribar: three beams along three axes at right angles, end to end. From
// one way only, its first and last ends lie on one line from the eye, and the
// three close into an impossible triangle. penrose: it turns slowly to and fro
// about the vertical and rests where it clicks shut for a few seconds, the
// way set by where the eye is now; penrose-still: it stands still in the
// room, set for where the eye will be at the middle of each of its cycles,
// and the eye's own move carries it through the click.
// L: a beam's length; w: its width at the centre; far: how far ahead of the eye it stands (the
// farther, the less its beams need to widen with depth); y: the height of its centre; taper: how
// much the width follows the depth (1: exactly, so that the two ends that meet look as wide).
const TRI = { L: 8.5, w: 1.8, far: 15, y: -3.6, taper: 1 };
const G = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const B1 = [1 / Math.sqrt(2), -1 / Math.sqrt(2), 0], B2 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
const ROLL = -Math.atan2(0.2357, 0.5443);   // a corner of the triangle on top
// eye: where the eye is (or will be) at the click; ahead: the way the eye looks then (horizontal).
function tribar(out, eye, ahead, turn, ctx) {
  const C = [eye[0] + ahead[0] * TRI.far, ctx.FLOOR + (TRI.y - ctx.FLOOR) * (ctx.camera.rise ?? 1), eye[2] + ahead[2] * TRI.far];
  const v = norm(add(eye, C, -1));
  const r0 = norm(cross(v, [0, 1, 0])), u0 = cross(r0, v);
  const c = Math.cos(ROLL), s = Math.sin(ROLL);
  const r = add(r0.map((x) => x * c), u0, s), u = add(r0.map((x) => -x * s), u0, c);
  // The object's axes (each base axis: its parts along the diagonal and across), turned about the vertical.
  const axis = (k) => yawed([0, 1, 2].map((i) => G[k] * v[i] + B1[k] * r[i] + B2[k] * u[i]), turn);
  const e = [axis(0), axis(1), axis(2)];
  const L = TRI.L;
  // P0 from the centre: so that the centre is the middle of the triangle as seen at the click
  // (P3 there lies in front of P0), and halfway between P0 and P3 in depth.
  const vr = yawed(v, turn);
  const q = [0, 1, 2].map((i) => L * (2 * e[0][i] + e[1][i]) / 3);
  const m = add(add(q, vr, -dot(q, vr)), vr, (L * Math.sqrt(3)) / 2);
  const P0 = add(C, m, -1);
  const F = Math.hypot(...add(eye, C, -1));
  put(out.v, 0, ...P0, F);
  put(out.v, 1, ...e[0].map((x) => x * L), TRI.w);
  const [c1, c2, c3] = [[1.0, 0.72, 0.3], [1.0, 0.35, 0.62], [0.35, 0.62, 1.0]];   // the faces of each axis: amber, rose, ice
  put(out.v, 2, ...e[1].map((x) => x * L), c2[0]);
  put(out.v, 3, ...e[2].map((x) => x * L), c2[1]);
  put(out.v, 4, ...C, Math.max(0.2, ctx.lane[0] * 0.8));
  put(out.v, 5, ...vr, TRI.taper);
  put(out.v, 6, ...c1, c2[2]);
  put(out.v, 7, ...c3, 0);
}
const TURN = { period: 34, angle: 0.85 };
registerEgg({
  name: 'penrose', type: EGG.penrose, rain: 0, layer: false, hold: 70,
  params(s, ctx, out) {
    // to and fro; near each crossing of 0 it rests there for a few seconds
    const x = Math.sin((s.age / TURN.period) * Math.PI * 2);
    const turn = TURN.angle * x * smooth((Math.abs(x) - 0.2) / 0.5);
    const f = ctx.camera.f;
    tribar(out, ctx.camera.eye, norm([f[0], 0, f[2]]), turn, ctx);
  },
});
const STILL = 40;                   // s a cycle: it fades in, the eye passes the click at the middle, it fades out
registerEgg({
  name: 'penrose-still', type: EGG.penrose, rain: 0, layer: false, hold: 2 * STILL, secret: false,
  params(s, ctx, out) {
    const k = s.age / STILL, ph = k - Math.floor(k);
    // (where the eye will be at the cycle's middle, and the way it will look: towards the room's middle)
    const eye = ctx.eyeAt((0.5 - ph) * STILL);
    tribar(out, eye, norm([-eye[0], 0, -eye[2]]), 0, ctx);
    return smooth(ph / 0.1) * smooth((1 - ph) / 0.1);   // (its own fade, over the weight)
  },
});

// ---------- glyphs: the clock, pi ----------
// A panel of 5 x 7 dot glyphs facing the eye (a dot a few strands wide), lines
// of up to 5 glyphs, each line with its own top left corner.
const CODE = { ':': 10, '.': 11, ' ': 15 };
const pack = (text) => [0, 1, 2, 3, 4].reduce((n, i) => n + (i < text.length ? CODE[text[i]] ?? Number(text[i]) : 15) * 16 ** i, 0);
function panel(out, ctx, lines, { colour, dot, distance, at }) {
  const { eye, f, r } = ctx.camera;
  const R = norm([r[0], 0, r[2]]).map((x) => x * dot);
  const D = [0, -dot, 0];
  // (a little above the middle of the view, clear of the layer)
  const centre = at ?? add(add(eye, f, distance), [0, 1, 0], distance * Math.tan(ctx.fov / 2) * 0.3);
  put(out.v, 0, ...R, Math.max(0.2, ctx.lane[0] * 0.9));
  put(out.v, 1, ...D, 0.34);
  put(out.v, 2, ...colour, lines.length);
  const wide = Math.max(...lines.map((l) => l.text.length * 6 - 1));
  lines.forEach((l, i) => {
    const w = l.text.length * 6 - 1;
    const corner = add(add(centre, R, -w / 2), D, l.y);
    put(out.v, 3 + i, ...corner, pack(l.text));
  });
  return wide;
}
// How far a panel of `dots` across should stand, to fill about `share` of the view's width.
const fitDistance = (ctx, dots, dot, share) => {
  const tanH = Math.tan(ctx.fov / 2) * ctx.camera.aspect;
  return Math.min(15, Math.max(6.5, (dots * dot) / (share * 2 * tanH)));
};
const dotSize = (ctx) => Math.max(0.62, ctx.lane[0] * 1.6);

// The clock: the time of day, HH:MM, for 20 s at each full hour (local time).
const two = (n) => String(n).padStart(2, '0');
registerEgg({
  name: 'clock', slot: 'overlay', type: EGG.glyphs, hold: 25, fade: 2, hush: 0.6,
  when(d) {
    if (d.getMinutes() !== 0 || d.getSeconds() >= 20) return null;
    const from = new Date(d); from.setSeconds(0, 0);
    return { from: from.getTime(), to: from.getTime() + 20000 };
  },
  params(s, ctx, out) {
    const d = ctx.wall, hh = two(d.getHours()), mm = two(d.getMinutes());
    const dot = dotSize(ctx);
    const tall = ctx.camera.aspect < 1;
    const lines = tall ? [{ text: hh, y: -8.5 }, { text: mm, y: 1.5 }] : [{ text: `${hh}:${mm}`, y: -3.5 }];
    const dots = tall ? 11 : 29;
    panel(out, ctx, lines, { colour: [0.88, 0.94, 1.0], dot, distance: fitDistance(ctx, dots, dot, tall ? 0.75 : 0.62) });
  },
});

// pi: the digits of pi fall down the strands, in lines of glyphs, 3.141 59265 ...
const PI = '31415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491';
const PI_FALL = 0.9;                // units a second
registerEgg({
  name: 'pi', type: EGG.glyphs, rain: 1, layer: false, hold: 60, hush: 0.6,
  params(s, ctx, out) {
    const dot = dotSize(ctx);
    const tall = ctx.camera.aspect < 1;
    const per = tall ? 3 : 5;
    const pitch = 11;               // dots from one line to the next
    const span = ctx.HEIGHT / dot;  // the room's height, in dots
    const fallen = (s.age * PI_FALL) / dot;   // dots the stream has fallen
    const text = (k) => (k === 0 ? `3.${PI.slice(1, per - 1)}` : PI.slice(per - 1 + (k - 1) * per, per - 1 + k * per));
    // Line k's top, in dots below the room's middle: it sets out 7 dots above the room's top.
    const lines = [];
    for (let k = Math.max(0, Math.ceil((fallen - span - 7) / pitch)); k <= fallen / pitch && lines.length < 5; k++) {
      lines.push({ text: text(k), y: -span / 2 - 7 - k * pitch + fallen });
    }
    const dots = per * 6 - 1;
    const dist = fitDistance(ctx, dots, dot, tall ? 0.8 : 0.45);
    const { eye, f } = ctx.camera;
    const fh = norm([f[0], 0, f[2]]);
    const at = [eye[0] + fh[0] * dist, 0, eye[2] + fh[2] * dist];
    panel(out, ctx, lines, { colour: [1.25, 0.95, 0.5], dot, at });
  },
});

// pi-rhythm: a share of the strands carry drops in step, in groups that count
// the digits (3 drops, a pause, 1, a pause, 4 ...; a zero is a longer pause).
const RHYTHM = { speed: 0.22, slot: 0.3, share: 0.07 };
const rhythmBits = (() => {
  const bits = new Uint32Array(64);
  let n = 0;
  for (const ch of PI) {
    const d = Number(ch);
    const len = d === 0 ? 4 : d + 2;
    if (n + len > 2048) break;
    for (let i = 0; i < d; i++) bits[(n + i) >> 5] |= 1 << ((n + i) & 31);
    n += len;
  }
  return { bits, n };
})();
registerEgg({
  name: 'pi-rhythm', type: EGG.rhythm, rain: 1, hold: 60, hush: 0.45,
  params(s, ctx, out) {
    out.bits.set(rhythmBits.bits);
    put(out.v, 0, RHYTHM.speed, RHYTHM.slot, rhythmBits.n, RHYTHM.share);
    put(out.v, 1, 1.0, 0.8, 0.45, 0);
  },
});

// ---------- the seasons ----------
// fireworks: on 1 January, and on 31 December from 23:00.
registerEgg({
  name: 'fireworks', type: EGG.fireworks, rain: 0, layer: false, hold: 60,
  when(d) {
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    const eve = m === 11 && day === 31 && d.getHours() >= 23, newYear = m === 0 && day === 1;
    if (!eve && !newYear) return null;
    const from = eve ? new Date(y, 11, 31, 23) : new Date(y - 1, 11, 31, 23);
    return { from: from.getTime(), to: new Date(eve ? y + 1 : y, 0, 2).getTime() };
  },
  params(s, ctx, out) {
    put(out.v, 0, 1.9, 6, -ctx.HEIGHT / 2, 1.9);
    put(out.v, 1, 1.0, 0.72, 0.32, 0);
    put(out.v, 2, 1.0, 0.38, 0.58, 0);
    put(out.v, 3, 0.4, 0.8, 1.0, 0);
    put(out.v, 4, 0.75, 1.0, 0.6, 0);
  },
});

// snow: on 24 and 25 December, slow snow in place of the rain, and a tree of light.
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

// tanabata: on 7 July, the Milky Way across the sky of the room, Vega and Altair on either side.
registerEgg({
  name: 'tanabata', slot: 'overlay', type: EGG.milky, hold: 60, hush: 0.5,
  when(d) {
    if (d.getMonth() !== 6 || d.getDate() !== 7) return null;
    const y = d.getFullYear();
    return { from: new Date(y, 6, 7).getTime(), to: new Date(y, 6, 8).getTime() };
  },
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

// ---------- the baked forms ----------
// Each baked form of the show (config.js EGGS: the teapot ...) is an egg too, held in the form slot.
for (const f of BAKED) registerEgg({ name: f.name, form: f.name });
