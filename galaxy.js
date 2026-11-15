// The galaxy, a celestial body (see celestial.js), seen almost edge-on like
// the Sombrero galaxy: a glowing bulge, a broad disc of stars, a lane of
// dust across them (config.js: BODIES, its `galaxy`). Here: how far below
// its centre and how far out its light reaches (galaxyLow, galaxyReach), the
// frame it shows itself in (galaxyFrame), and the shader's galaxy
// (GALAXY_GLSL, in its own programs only, celestial.js: bodyShader). How it
// moves is in forms.js (galaxy).

import { BODIES } from './config.js';
import { sub, cross, norm } from './gl.js';

const GX = BODIES.find((P) => P.kind === 'galaxy');   // (one galaxy: the shader's measures are its own)
const scale = (a, k) => a.map((x) => x * k);

// How far below its centre its light reaches, its disc leaning by tilt (rad
// from level): its disc's rim at that lean (out to where it still shows
// clearly), or its bulge's glow below its heart. size: its disc's radius
// now (forms.js: fitted); its disc is as thick at every size.
const GALAXY_RIM = 0.92, BULGE_LOW = 1.1;
export function galaxyLow(P, tilt, size = P.size) {
  const { bulge, flat, thick } = P.galaxy;
  return Math.max(size * GALAXY_RIM * Math.sin(tilt) + 2 * thick * Math.cos(tilt), size * BULGE_LOW * bulge * flat);
}
// How far from its centre any of its light reaches: its disc's rim, or the
// bulge's glow, which fades out by BULGE_TAIL bulge radii from its heart.
const BULGE_TAIL = 2.9;
export const galaxyReach = (P, size = P.size) => size * Math.max(1.02, BULGE_TAIL * P.galaxy.bulge);

// The frame a galaxy shows itself in: n, its disc's axis, leaning from the
// vertical by tilt towards the eye that looks from the way az, and rolled
// aside by roll; t and s, two ways across the disc that keep still in the
// room (its stars turn by the shader's clock: the inner ones faster).
export function galaxyFrame(tilt, az, roll) {
  const s = Math.sin(az), c = Math.cos(az);
  const up = Math.cos(tilt) * Math.cos(roll), toEye = Math.sin(tilt), left = Math.cos(tilt) * Math.sin(roll);
  const n = [-toEye * s + left * c, up, -toEye * c - left * s];
  const t = norm(sub([1, 0, 0], scale(n, n[0])));
  return { n, sun: cross(n, t), t };
}

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${+x.toFixed(4)}`);

// The shader's galaxy. Its light is a volume: each LED shows the light of
// the stars where it is, so the near-edge-on disc gathers into a bright
// band, and the bulge is a ball of glow seen through. The dust darkens what
// lies behind it: each LED's light is dimmed by the dust its line of sight
// to the eye passes through. It needs hash3, noise3, uLane and the slot's
// colours from POINT_VS, and Eye, the third and fourth colours and the
// frame from celestial.js: BODY_GLSL.
export const GALAXY_GLSL = `
// ---------- the galaxy (see galaxy.js) ----------
const float G_BULGE = ${f(GX.galaxy.bulge)}, G_FLAT = ${f(GX.galaxy.flat)};
const float G_THICK = ${f(GX.galaxy.thick)}, G_DUST = ${f(GX.galaxy.lane)};   // its disc's half thickness and its dust's (units; config.js: thick, lane)
const float G_FULL = ${f(GX.size)};   // its full size (a radius; it may show smaller, see forms.js: fitted)
const float G_LANE_ROWS = 0.9;   // and at least this many LED gaps (see galaxyLight)
const float G_TAIL = ${f(BULGE_TAIL)};   // the bulge's glow fades out by this many bulge radii (see galaxyReach)
float gsq(float x) { return x * x; }
// Its dust at r (radii) in its disc's plane (0 .. 1): rings of it (config.js).
float galDust(float r) {
  return ${GX.galaxy.dust.map(([c, w, d]) => `${f(d)} * exp(-gsq((r - ${f(c)}) / ${f(w)}))`).join(' + ')};
}
// The galaxy in slot k: a = (type, weight, its disc's radius, how far it has
// turned at its rim), b = (centre, -), f = (body, how far its light has
// come out from its heart (0 .. 1), how dark its dust is (0 .. 1), reach).
// uFormN: its disc's axis; uFormT, uFormS: two ways across it (galaxyFrame).
// col: the LED's colour (its own: the slot's four).
vec3 galaxyLight(vec3 p, vec4 a, vec4 b, vec4 f, int k, out vec3 col) {
  float R = a.z, grow = f.y;
  vec3 n = uFormN[k], ax = uFormT[k], ay = uFormS[k];
  vec3 q = p - b.xyz;
  float z = dot(q, n) / R;
  vec2 xy = vec2(dot(q, ax), dot(q, ay)) / R;
  float r = length(xy);
  // The bulge: a flattened ball of old stars, warm, white-hot at its heart; it comes first.
  // (Its glow fades out by G_TAIL bulge radii from its heart.) Its glow is a volume seen
  // through: its light along a line of sight grows with its size. So a galaxy shown
  // smaller than its full size (in a narrow view) lights its glow the more, by as
  // much, and its crown keeps its presence; its white heart is as bright at every size.
  float db = length(vec3(xy, z / G_FLAT)) / G_BULGE;
  float tail = 1.0 - smoothstep(G_TAIL - 0.5, G_TAIL, db);
  // The disc: as thick at every size, and at least about one LED gap.
  float hz = max(G_THICK, 0.8 * uLane.y) / R;
  // Beyond both, no light (the most of the LEDs within its reach).
  if (tail <= 0.0 && z * z > 12.0 * hz * hz) return vec3(0.0);
  float showB = smoothstep(0.0, 0.35, grow);
  float bulge = (exp(-db * db * 1.3) * 5.0 + exp(-db * 1.4) * 0.6) * showB * tail * G_FULL / R, core = exp(-db * db * 14.0) * showB;
  // The disc spreads out from the heart as it comes.
  float vert = exp(-z * z / (hz * hz));
  float edge = 1.0 - smoothstep(0.82, 1.0, r / max(grow, 0.05));
  float rad = 0.25 * exp(-r * 2.5) + 0.9 * exp(-gsq((r - 0.74) / 0.16)) + 0.25 * exp(-gsq((r - 0.93) / 0.06));
  // Its stars turn about the heart, the inner ones faster (a.w: the turn at the rim),
  // in clumps; the densest are knots where stars are born.
  float ang = a.w / max(r, 0.25);
  vec2 rxy = vec2(cos(ang) * xy.x + sin(ang) * xy.y, cos(ang) * xy.y - sin(ang) * xy.x);
  float clump = noise3(vec3(rxy * 9.0, z * 6.0) + 7.0);
  float disc = vert * rad * edge * (0.45 + 1.1 * clump) * 9.0;
  float knots = vert * rad * edge * smoothstep(0.62, 0.8, clump) * smoothstep(0.25, 0.45, r) * 12.6;
  // A grain of single stars: a few LEDs brighter, in the disc and about the bulge.
  float g = hash3(p * 2.3 + 5.1);
  float star = g < 0.03 * (vert * rad + 0.25 * gsq(exp(-db * 1.4))) * edge ? (0.6 + 0.8 * fract(g * 977.0)) * 6.0 * smoothstep(0.2, 0.6, grow) : 0.0;
  // The dust between this LED and the eye: the part of its line of sight
  // within the dust's slab (as thick as G_DUST, or G_LANE_ROWS LED gaps), and the
  // dust along it (Simpson's rule: at the slab's two sides and between).
  vec3 oc = (Eye - b.xyz) / R;
  float ze = dot(oc, n);
  float hd = max(G_DUST, G_LANE_ROWS * uLane.y) / R, z1 = clamp(z, -2.0 * hd, 2.0 * hd), z2 = clamp(ze, -2.0 * hd, 2.0 * hd);
  float tau = 0.0;
  if (abs(z2 - z1) > 1e-5) {
    vec3 qq = q / R, d = oc - qq;
    float s1 = (z1 - z) / (ze - z), s2 = (z2 - z) / (ze - z);
    vec3 x1 = qq + d * s1, x2 = qq + d * s2, xm = 0.5 * (x1 + x2);
    float rho = (galDust(length(x1 - n * z1)) * exp(-gsq(z1 / hd)) + galDust(length(x2 - n * z2)) * exp(-gsq(z2 / hd))
      + 4.0 * galDust(length(xm - n * dot(xm, n))) * exp(-gsq(dot(xm, n) / hd))) / 6.0;
    tau = rho * min(length(d) * abs(s2 - s1), 1.5) / hd * 2.2 * f.z;
  }
  float clear = exp(-tau);
  float all = bulge + core * 30.0 + disc + knots + star;
  // Its colour: the bulge warm, deeper to its rim; the disc's stars blue; its knots pink; reddened behind dust.
  col = (mix(uFormC[k], uFormD[k], smoothstep(0.1, 0.9, db)) * (bulge + core * 30.0) + uFormG[k] * (disc + star) + uFormH[k] * knots) / max(all, 1e-4);
  col *= mix(vec3(1.0, 0.6, 0.4), vec3(1.0), clear);
  return vec3(all * clear, core * 0.7 * clear, 0.0);
}

// Its part of the celestial bodies' interface (celestial.js: KINDS).
float galaxyFar(vec3 rel, vec4 b, vec4 e, vec4 f) { return length(rel); }
vec3 galaxyBody(vec3 p, vec4 a, vec4 b, vec4 e, vec4 f, int k, out vec3 col) {
  BodyRay = 1.0;
  BodyThread = 0.2;   // (a disc of stars is not its strands)
  return galaxyLight(p, a, b, f, k, col);
}
float galaxyShade(vec3 seen) { return 1.0; }
`;
