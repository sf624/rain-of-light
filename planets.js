// The planet: a form of light with variants, one per appearance (Saturn,
// Uranus). Each variant has colours of its own (in place of the palettes of
// the other forms), a size, a spin and rings (config.js: PLANETS; show.js
// picks one as it picks a solid's figure). Here: its rings' extent and
// lowest light, the frame it shows itself in (planetFrame), its rings'
// profile as a texture (createRingMap), and the shader's planet
// (PLANET_GLSL, put into POINT_VS by shaders.js). How it moves is in
// forms.js (planet).
//
// The ball is drawn as the eye sees it: every LED inside the ball shows the
// place on the ball's near surface that lies behind it along the line of
// sight, so all its LEDs together show the near face. The rings are a slab
// of LEDs about their plane, each showing the place where its line of sight
// crosses the plane, so their bands and gaps stay sharp on a coarse lattice.
// The slab is as thick as the lattice needs (see SLAB), so that every line of
// LEDs that crosses the plane gives it the same light: the rings read as
// continuous bands, not as dotted arcs.
//
// SwiftShader (no GPU) pays for the planet's code in every frame, planet or
// not: what is the same for all its LEDs (its axis, the sun) is worked out
// here once a frame, and its rings' profile is read from a texture.

import { small, PLANETS } from './config.js';
import { sub, dot, cross, norm } from './gl.js';

// A variant's rings as shown: its bands spread out from the first band's
// inner edge by its stretch ([from, to, density, tone], in radii).
export function bandsOf(P) {
  const r0 = P.rings[0][0], at = (r) => r0 + (r - r0) * P.stretch;
  return P.rings.map(([a, b, d, t]) => [at(a), at(b), d, t]);
}
// How far out its rings reach (radii).
const outer = (P) => Math.max(...bandsOf(P).map((b) => b[1]));

// How far an upright planet's rings may lean from level (rad), their top
// turned to the eye, which looks up at them: enough to open them to it by
// `open` (see planetFrame).
const LEAN = 0.7;
// The sun lies this far beyond the rings' plane from the eye (rad): their
// shadow then falls on the face of the ball the eye sees, as a dark band
// beside them (and the eye sees their face lit through them).
const SUN = 0.17;
// The rings' slab: SLAB steps of the lattice thick (along the lattice's
// axis that crosses their plane most steeply), its edges each one step soft.
// Along any line of LEDs across it, the LEDs' weights then add up to
// exactly SLAB, wherever the plane lies between them: every strand that
// crosses the rings gives them as much light, and the bands read as
// continuous, not as dotted arcs (nor as moiré as they turn).
const SLAB = 5;
const LANE_MAX = 0.5;   // the coarsest lattice step it is made for (a phone's: 0.45)

// How far below its centre a variant's light ever reaches: its ball, or its
// rings' lowest edge as far as they lean (LEAN, with the roll). The eye on
// the floor looks up at it, so they lean about that far most of the time
// (each frame's lean would make it rise and fall as the eye moves). The
// slab's LEDs below that edge show the rings where their lines of sight
// cross the plane, so the eye sees them on the plane, not below it.
export function planetLow(P) {
  const lean = P.upright ? Math.acos(Math.cos(LEAN) * Math.cos(P.roll)) : Math.PI / 2;
  return Math.max(P.size, outer(P) * P.size * Math.sin(lean));
}
// How far from its centre any of its light reaches: its rings, and the LEDs
// of the slab that show their edge from a little beyond it (along the line
// of sight, as far as SLAB steps of the lattice, seen slanting).
export const planetReach = (P) => outer(P) * P.size + (SLAB + 1) * LANE_MAX;
// How far out (radii) its rings show when they have come out `w` (0 .. 1) of the way.
export const ringsOut = (P, w) => 1 + (outer(P) + 0.25 - 1) * w;

const scale = (a, k) => a.map((x) => x * k);
const add = (...vs) => vs.reduce((s, v) => s.map((x, i) => x + v[i]));

// The frame a planet at `centre` shows itself in to the eye at `eye`: its
// axis n (the rings' plane's), turned so that its rings open to the eye by
// `open` (rad from edge-on), their ellipse leaning by `roll`; the sun, round
// from the eye by `phase` (0 full .. pi new); and t, a way across the axis,
// turned about it by `turn` (the ball's spin). (The images in the mirrors are of this one
// planet: the shader sees it from the eye's image.)
export function planetFrame(P, centre, eye, open, roll, phase, turn) {
  const te = sub(eye, centre);
  const fh = norm([-te[0] + 1e-6, 0, -te[2]]);             // level, from the eye towards it
  let n;
  if (P.upright) {
    const up = Math.atan2(-te[1], Math.hypot(te[0], te[2]));   // how far the eye looks up to it
    const l = Math.max(-LEAN, Math.min(LEAN, open + up));       // its lean towards the eye
    n = add([0, Math.cos(l), 0], scale(fh, -Math.sin(l)));
  } else n = add(scale([fh[2], 0, -fh[0]], Math.cos(open)), scale(fh, Math.sin(open)));
  n = add(scale(n, Math.cos(roll)), scale(cross(fh, n), Math.sin(roll)), scale(fh, dot(fh, n) * (1 - Math.cos(roll))));
  const tn = norm(te), side = Math.sign(dot(tn, n)) || 1;
  const tp = norm(sub(tn, scale(n, dot(tn, n)))), sp = cross(n, tp);
  const sun = add(scale(add(scale(tp, Math.cos(phase)), scale(sp, Math.sin(phase))), Math.cos(SUN)), scale(n, -side * Math.sin(SUN)));
  const t0 = norm(cross(n, fh));
  return { n, sun, t: add(scale(t0, Math.cos(turn)), scale(cross(n, t0), Math.sin(turn))) };
}

// The rings' profile: per variant a row of RINGS_W texels out to RINGS_R
// radii, r: how dense (0 .. 1), g: the tone (2 .. 3 along the colours, as
// 0 .. 1). The bands' edges are a quarter of a lattice step soft, and a band
// narrower than 0.6 of a step is widened to that (for the default lattice
// of this screen: a phone's is coarser); broad bands carry ringlets.
const RINGS_W = 1024, RINGS_R = 3.5, WIDE = 0.1, LANE_BAKE = small ? 0.45 : 0.27;
const hashOf = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const noise1 = (x, o) => { const i = Math.floor(x), t = smoothstep(0, 1, x - i); return hashOf(i + o) * (1 - t) + hashOf(i + o + 1) * t; };
function profile(P) {
  const R = P.size, s = 0.25 * LANE_BAKE / R, m = 0.6 * LANE_BAKE / R, px = new Uint8Array(RINGS_W * 2);
  for (let i = 0; i < RINGS_W; i++) {
    const r = (i + 0.5) / RINGS_W * RINGS_R, fine = 0.6 + 0.35 * noise1(r * 9, 0) + 0.3 * noise1(r * 3, 50);
    let den = 0, tone = 0;
    for (const [a, b, d, t] of bandsOf(P)) {
      const c = (a + b) / 2, h = Math.max((b - a) / 2, m / 2);
      const k = smoothstep(c - h - s, c - h + s, r) * (1 - smoothstep(c + h - s, c + h + s, r)) * d * (b - a > WIDE ? fine : 1);
      den += k; tone += k * t;
    }
    px[i * 2] = Math.round(Math.min(1, den) * 255);
    px[i * 2 + 1] = Math.round(Math.max(0, Math.min(1, (den > 0 ? tone / den : 2) - 2)) * 255);
  }
  return px;
}
export function createRingMap(gl, unit) {
  const px = new Uint8Array(RINGS_W * 2 * PLANETS.length);
  PLANETS.forEach((P, v) => px.set(profile(P), v * RINGS_W * 2));
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, RINGS_W, PLANETS.length, 0, gl.RG, gl.UNSIGNED_BYTE, px);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  return tex;
}

// The vertex shader `src` (POINT_VS) with the planet's light in place of the
// other sky forms' (while it shows, none of them does). The page draws with
// it only while a planet shows (see main.js): SwiftShader (no GPU) runs a
// shader the slower the more code it holds, even code that does not run, and
// the planet's code in every frame cost rain alone 10% there, the orb 15%.
export const planetShader = (src) => src.replace('#version 300 es\n', '#version 300 es\n#define PLANET\n');

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${+x.toFixed(4)}`);
const URANUS = PLANETS.findIndex((P) => P.name === 'uranus');

// The shader's planet (only in planetShader's programs). It needs hash3,
// uTime, uLane, uEye and the slot's colours from POINT_VS.
export const PLANET_GLSL = `
// ---------- the planet (see planets.js) ----------
uniform sampler2D uRings;   // the rings' profile (planets.js: createRingMap)
uniform vec3 uFormG[3];     // a planet's third and fourth colours (its rings')
uniform vec3 uFormH[3];
vec3 Eye;                   // where the eye is as this LED's image is seen (main sets it: in a mirror, the eye's image)
uniform vec3 uFormN[3];     // a planet's axis, its sun, and the way across its axis that its turn is counted from (planetFrame)
uniform vec3 uFormS[3];
uniform vec3 uFormT[3];
const float P_SLAB = ${f(SLAB)};

// The rings at r (radii): how dense (0 .. 1), and their tone (0 .. 1 from the third colour to the fourth).
vec2 ringAt(int v, float r) {
  return textureLod(uRings, vec2(r / ${f(RINGS_R)}, (float(v) + 0.5) / ${f(PLANETS.length)}), 0.0).rg;
}

// The planet in slot k: a = (type, weight, radius, -), b = (centre, -),
// f = (variant, -, how far out its rings show (radii), reach). Its frame
// is uFormN (its axis), uFormS (its sun) and uFormT (a way across its axis,
// turning with it). col: the LED's colour (its own colours: the slot's four).
vec3 planetLight(vec3 p, vec4 a, vec4 b, vec4 f, int k, out vec3 col) {
  col = vec3(0.0);
  int v = int(f.x + 0.5);
  float R = a.z;
  vec3 q = p - b.xyz, n = uFormN[k], sun = uFormS[k];
  // Outside the ball, only the LEDs in the rings' slab (see SLAB): apart is
  // how far apart the LEDs are across it, along the lattice's steepest axis.
  float r2 = dot(q, q), wt = 1.0;
  if (r2 >= R * R) {
    vec3 an = abs(n);
    float apart = max(uLane.y * an.y, uLane.x * max(an.x, an.z));
    wt = clamp((0.5 * (P_SLAB + 1.0) * apart - abs(dot(q, n))) / apart, 0.0, 1.0);
    if (wt <= 0.0) return vec3(0.0);
  }
  vec3 oc = Eye - b.xyz;                                    // the eye, from the centre (in a mirror, its image)
  vec3 d = normalize(p - Eye);                              // the line of sight through this LED
  float dn = dot(d, n);
  float tx = abs(dn) > 0.02 ? -dot(oc, n) / dn : -1.0;      // where it crosses the rings' plane
  vec3 x = oc + d * tx;
  float rr = length(x) / R;
  vec2 rg = tx > 0.0 ? ringAt(v, rr) : vec2(0.0);
  rg.x *= 1.0 - smoothstep(f.z - 0.25, f.z, rr);           // as far out as they have come
  vec3 ringCol = mix(uFormG[k], uFormH[k], rg.y);
  // Where the line of sight enters the ball, and half its chord through it.
  float bo = dot(oc, d), h = bo * bo - dot(oc, oc) + R * R;
  float t0 = h > 0.0 ? -bo - sqrt(h) : -1.0, chord = sqrt(max(h, 0.0));
  if (r2 < R * R) {
    // The ball: the place on its near surface behind this LED.
    vec3 nn = (oc + d * t0) / R;
    // z: how far north (the sine of the latitude); u: a way across, turning with it.
    float z = dot(nn, n), u = dot(nn, uFormT[k]);
    float tone, bright = 1.0;
    if (v == ${URANUS}) tone = 0.7 * smoothstep(0.4, 0.96, abs(z));   // Uranus: pale cyan, deeper to the poles
    else {   // Saturn: pale zones and tan belts, their edges waving, drifting as it turns
      tone = clamp((0.5 + 0.5 * sin(z * 13.0 + 0.6 * sin(4.0 * u + 3.0 * z))) * smoothstep(0.06, 0.3, abs(z)) * 1.1, 0.0, 1.0);
      bright = 1.0 - 0.3 * smoothstep(0.85, 0.99, abs(z));
    }
    float lam = dot(nn, sun);
    float lit = smoothstep(-0.06, 0.18, lam) * (0.35 + 0.65 * clamp(lam, 0.0, 1.0));
    float mu = clamp(-dot(nn, d), 0.0, 1.0);
    // The rings' shadow on it.
    float ts = -dot(nn, n) * R / dot(sun, n);
    float shade = ts > 0.0 ? 1.0 - 0.85 * min(1.0, 1.6 * ringAt(v, length(nn * R + sun * ts) / R).x) : 1.0;
    // The rings in front of it: they hide some of it, and show themselves over it.
    float fr = tx > 0.0 && tx < t0 ? rg.x : 0.0;
    // As many LEDs show this place as lie along the chord: each gives its share.
    float each = uLane.x / max(chord, 0.5 * R);
    float ball = bright * lit * shade * (0.7 + 0.3 * mu) * 19.0 * each * (1.0 - 0.55 * fr);
    float ring = fr * 24.0 * each;
    col = mix(mix(uFormC[k], uFormD[k], tone), ringCol, ring / max(ball + ring, 1e-4));
    return vec3(ball + ring, 0.0, 0.0);
  }
  // The rings: each LED of the slab shows where its line of sight crosses their plane.
  if (rg.x < 0.003) return vec3(0.0);
  // Behind the ball as the eye sees it: hidden; in the ball's shadow: dark.
  float hidden = t0 > 0.0 && t0 < tx ? 0.95 : 0.0;
  float bs = dot(x, sun);
  float shadow = bs < 0.0 ? 1.0 - smoothstep(R * R * 0.82, R * R * 1.0, dot(x, x) - bs * bs) : 0.0;
  // Its lit face, or the other (a little fainter: the light through it).
  float face = dot(sun, n) * dot(oc, n) > 0.0 ? 1.0 : 0.85;
  // As bright as the eye sees it, however open: an LED's light by how
  // steeply its line of sight crosses the slab (more LEDs where it slants).
  float light = rg.x * face * (1.0 - 0.92 * shadow) * (1.0 - hidden) * wt / P_SLAB * min(abs(dn), 0.8) * 45.0 * sqrt(uLane.x / 0.27);
  // Ice: a few LEDs glint now and then, more where the ring is dense.
  float g = hash3(p * 1.7 + 3.1);
  float glint = g < 0.07 * rg.x ? pow(0.5 + 0.5 * sin(uTime * (0.25 + 7.0 * g) + 89.0 * g), 24.0) : 0.0;
  glint *= face * (1.0 - shadow) * (1.0 - hidden);
  col = ringCol;
  return vec3(light + glint * 10.0, glint * 0.8, 0.0);
}
`;
