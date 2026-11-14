// The black hole, a celestial body (see celestial.js): a dark heart in a thin
// disc of matter that turns about it and falls into it, the disc's far side
// lifted over and under the heart as the eye sees it (the lens), a photon
// ring at the heart's edge, and two jets along the disc's axis. Here: its
// measures (BH) and the shader's black hole (HOLE_GLSL, in its own programs
// only, celestial.js: bodyShader). How it moves is in forms.js (blackhole).
//
// While it shows, the whole frame is drawn with its programs: its shadow
// (holeShadow) hides the light behind the heart, as the eye sees it, of
// every LED (the rain, the layer, its own disc), of the wires and of the
// images in the floor and the walls.

// size, the disc's outer radius; shadow, the heart's full radius; sheet,
// the disc's half thickness (HOLE_SHEET); under, the arch under the heart,
// of the shadow's radius (HOLE_UNDER); down, how far past the heart the
// lower jet still shows clearly (HOLE_JET); open and roll (rad): the ranges
// the opening and the roll sway in (forms.js: blackhole); rim: the disc's
// light shows clearly out to this share of its outer edge (see holeLight).
export const BH = { size: 4.4, shadow: 1.3, sheet: 0.3, under: 1.25, down: 3.0, open: [0.16, 0.26], roll: [0.68, 0.84], rim: 0.9 };

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${+x.toFixed(4)}`);

// The shader's black hole. It needs hash, noise3, uTime, uLane, uEye, uCopy,
// uMirror, WHITE_HOT and the slot's colours from POINT_VS, and the group's
// interface (celestial.js: KINDS).
export const HOLE_GLSL = `
uniform vec4 uHole;       // its shadow: its centre and radius (see show.js and holeShadow)
uniform float uHoleDark;  // how dark that shadow is (0: none, and nothing is tested)
// The black hole (forms.js: blackhole): a dark heart (its shadow, see
// holeShadow), a thin disc of matter, its far side lifted over and under the
// heart as the eye sees it (the lens), a thin photon ring at the shadow's
// edge, and two jets along the disc's axis. The axis stands in the room
// (b.w, yaw; forms.js); the lensed arcs and the ring are an image that faces
// the eye, laid out by the disc as the eye sees it, and thick along the line
// of sight (HOLE_DEEP each side), so that LEDs at many depths draw them as
// continuous arcs.
// The matter falls in at a steady pace in log radius (HOLE_FALL), turning
// the faster the nearer it is (HOLE_SPIN at the inner rim, as r^-1.5 farther
// out), so each piece follows a fixed spiral path: its angle less the turn
// it has still to make on its way in (path). What moves with the matter
// keeps its path and the time it reaches the rim (rim): its streaks, arms
// along the paths broken into strokes, and now and then a brighter knot, run
// in with it. Light and heat rise towards the inner rim; the side that comes
// towards the eye (the left) is brighter.
// a.z: the disc's outer radius; a.w: how far the jets reach (0 .. 1);
// f.x: how far the disc has formed (it gathers from wide and faint); f.y: how
// far it has drained into the heart; f.z: the shadow's radius now.
const float HOLE_SPIN = 0.4, HOLE_FALL = 0.12, HOLE_KNOT = 13.0;   // HOLE_KNOT: s between the knots that may come
const float HOLE_DEEP = 1.6;      // the lensed image's half depth along the line of sight
const vec2 HOLE_SHEET = vec2(0.6, ${f(BH.sheet)});   // the disc's half thickness: of the LEDs' spacing along a strand, at most (BH.sheet)
const float HOLE_RIN = 1.35;                   // the disc's inner rim, of the shadow's radius
const vec3 HOLE_ARC = vec3(1.1, 1.06, 1.7);    // of the shadow's radius: the arch over the heart of the inner rim (half width, height), the outer edge's height
const vec2 HOLE_UNDER = vec2(1.03, ${f(BH.under)});      // the arch under the heart: the inner rim's height, the outer edge's (BH.under)
const vec4 HOLE_JET = vec4(7.0, 2.6, 5.0, 2.6);   // the jets: the upper one's reach past the heart and fade length, the lower one's (forms.js: BH.down)
const vec3 HOLE_CONE = vec3(0.25, 0.06, 0.5);  // a jet's half width at its base, its widening per unit; the light of one that goes away from the eye
float HoleRay, HoleJet;   // set by holeLight: the share of its light that casts rays, and that is a jet's
// The disc's axis: up, leaning by b.w towards the way yaw.
vec3 holeAxis(vec4 b, float yaw) { return vec3(sin(b.w) * sin(yaw), cos(b.w), sin(b.w) * cos(yaw)); }
// How far rel is from a black hole's centre, as its reach (bound) counts:
// within its disc's sphere, or along its jets (within 1.2 of the axis, more as they widen).
float holeReach(vec3 rel, vec4 b, float yaw, float bound) {
  vec3 n = holeAxis(b, yaw);
  float y = dot(rel, n);
  return min(length(rel), bound * max(length(rel - n * y) / (1.2 + HOLE_CONE.y * abs(y)), abs(y) / (HOLE_JET.x + 2.0)));
}
// The disc's matter at radius r and angle th (0 to the eye's right, pi/2
// away from the eye; turn: where that is in the disc, so that its streaks
// keep their place as the eye goes round): its light, heat and knot.
// inner, outer: its rims now.
vec3 holeMatter(float r, float th, float turn, float rin, float inner, float outer, float lane, vec4 f, float lens) {
  float u = (r - inner) / max(outer - inner, 1e-3);   // 0 at the inner rim .. 1 at the outer edge
  if (u < -0.1 || u > 1.2) return vec3(0.0);
  float x = rin / r;
  float path = th + turn - HOLE_SPIN * x * sqrt(x) / (1.5 * HOLE_FALL);
  float rim = uTime - log(x) / HOLE_FALL;
  vec2 c = vec2(cos(path), sin(path));
  float st = smoothstep(0.3, 0.9, 0.5 + 0.5 * cos((lane > 0.35 ? 4.0 : 6.0) * path + 5.0 * noise3(vec3(c * 0.9, rim * 0.08))))
           * smoothstep(0.3, 0.6, noise3(vec3(c * 1.4 + 3.0, rim * 0.28)));
  // A knot: a lump of the matter, at one path and reaching the rim at one time.
  float kc = floor(rim / HOLE_KNOT), kr = rim / HOLE_KNOT - kc - 0.5, ka = hash(kc * 5.1 + 2.9) * 6.2831853;
  vec2 kd = vec2(cos(ka), sin(ka)) - c;
  float kn = step(hash(kc * 3.7 + 1.3), 0.7) * exp(-kr * kr * 400.0 - dot(kd, kd) * 12.0) * 3.0 * step(0.0, u);
  float hot = clamp(1.0 - u, 0.0, 1.0), beam = 0.5 - 0.5 * cos(th);   // beam: the side coming towards the eye
  float sparse = smoothstep(0.3, 0.45, lane);         // (a sparse lattice fills the dark between the streaks)
  float glow = smoothstep(-0.06, 0.04, u) * (1.0 - smoothstep(0.85, 1.0, u)) * (0.6 + 2.4 * hot * hot)
             * (0.35 + 0.35 * sparse + 1.2 * st) * (0.5 + beam);
  float wisp = smoothstep(0.8, 1.0, u) * (1.0 - smoothstep(1.0, 1.15, u)) * st * st;
  float edge = exp(-u * u * 100.0) * (1.0 + 2.0 * f.y) * (0.5 + beam) * (1.0 - 0.7 * lens);   // the inner rim, brightest as the disc drains
  float light = mix(0.25, 1.0, f.x) * (1.0 - 0.75 * f.y) * (glow * 5.5 + wisp * 3.0 + edge * 4.0 + kn * 5.0);
  return vec3(light, clamp(hot * hot * (0.5 + 0.5 * beam) + edge * 0.5 + kn * 0.3, 0.0, 1.0) * smoothstep(-0.1, 0.0, u), kn);
}
vec3 holeLight(vec3 p, vec4 a, vec4 b, float yaw, vec4 f) {
  vec3 rel = p - b.xyz;
  float lane = max(uLane.x, uLane.y), Rs = f.z;
  // The eye's frame (v: to the heart; R, U: right and up as the eye sees it),
  // the disc's axis n and how open the eye sees the disc (o > 0: from n's
  // side), and the disc's own frame as the eye sees it: X across the line of
  // sight, F away from the eye; turn: X's angle from X0, a way fixed in the disc.
  vec3 v = normalize(b.xyz - uEye), R = normalize(vec3(-v.z, 0.0, v.x)), U = cross(R, v), n = holeAxis(b, yaw);
  float o = -dot(n, v), dc = length(b.xyz - uEye), depth = dot(rel, v), y = dot(rel, n);
  vec3 F = normalize(v + n * o), X = cross(F, n), X0 = vec3(cos(yaw), 0.0, -sin(yaw));
  float turn = atan(dot(X, cross(n, X0)), dot(X, X0));
  vec2 S = vec2(dot(rel, R), dot(rel, U)) * dc / max(dc + depth, 0.1);   // where the eye sees it, at the heart's distance
  float off = length(S);
  vec2 Q = vec2(dot(X, R), dot(X, U));
  S = vec2(dot(S, Q), dot(S, vec2(-Q.y, Q.x)) * (o < 0.0 ? -1.0 : 1.0));   // (and in the disc's frame: along X, towards the far side)
  float rin = max(Rs, 0.3) * HOLE_RIN;
  float outer = mix(mix(a.z * 1.6, a.z, f.x), rin * 1.1, f.y);
  float inner = mix(a.z * 1.05, rin, smoothstep(0.0, 0.8, f.x));
  vec3 m = vec3(0.0);
  float sheet = min(HOLE_SHEET.x * uLane.y, HOLE_SHEET.y);
  if (abs(y) < sheet) {
    // The disc itself: a thin sheet across the strands, about one LED of each.
    float x = dot(rel, X), z = dot(rel, F);
    m = holeMatter(length(vec2(x, z)), atan(z, x), turn, rin, inner, outer, lane, f, 0.0) * vec3(1.6 - 1.6 * smoothstep(0.5 * sheet, sheet, abs(y)), 1.0, 1.0);
  } else if (abs(depth) < HOLE_DEEP && off > Rs) {
    // The lens: the disc's far side as the eye sees it lifted over the heart
    // and, thinner, under it (as high, seen edge-on). Each ring of it (radius
    // A) shows as an arch of half width A, as high as B: the inner rim's hugs
    // the heart, the outer edge's joins the disc at its two ends.
    float side = S.y > 0.0 ? 0.0 : smoothstep(0.0, 0.2, abs(o));
    vec2 B = Rs * mix(HOLE_ARC.yz, HOLE_UNDER, side), A = vec2(min(Rs * HOLE_ARC.x, inner), outer);
    float lo = 0.0, hi = 1.0;
    for (int i = 0; i < 6; i++) {
      float s = 0.5 * (lo + hi);
      vec2 e = S / vec2(mix(A.x, A.y, s), mix(B.x, B.y, s));
      if (dot(e, e) > 1.0) lo = s; else hi = s;
    }
    float s = 0.5 * (lo + hi);
    vec2 e = S / vec2(mix(A.x, A.y, s), mix(B.x, B.y, s));
    float g = dot(e, e);
    m = holeMatter(mix(inner, outer, s), atan(abs(e.y), e.x), turn, rin, inner, outer, lane, f, 1.0)
      * vec3((1.0 - smoothstep(0.6 * HOLE_DEEP, HOLE_DEEP, abs(depth))) * smoothstep(0.75, 1.0, g) * (1.0 - smoothstep(1.0, 1.3, g))
             * mix(exp(-2.5 * s), 0.5 * (1.0 - smoothstep(0.05, 0.25, s)), side), 1.0, 1.0);
  }
  // The photon ring: thin, at the shadow's edge as the eye sees it.
  float ring = (off - Rs) / (0.45 * lane) - 1.0;
  ring = exp(-ring * ring - depth * depth / (lane * lane * 1.6)) * step(0.01, Rs);
  float light = m.x + ring * 14.0 * smoothstep(0.4, 0.9, f.x) * smoothstep(0.04, 0.25, Rs / a.z);
  // The jets: narrow cones along the axis, from just outside the heart,
  // widening and fading as they go, with knots that run outwards. The one
  // that comes towards the eye is the brighter; the one that goes away dims
  // where the disc lies in front of it (where the line of sight to it crosses the disc).
  float far = abs(y) - Rs * 1.05, jet = 0.0;
  float up = step(0.0, y), reach = a.w * mix(HOLE_JET.z, HOLE_JET.x, up);
  if (far > 0.0 && far < reach) {
    float w = max(0.9 * lane, HOLE_CONE.x + HOLE_CONE.y * far), d = length(rel - n * y);
    float k = (far - 2.2 * uTime) / 3.0 + 0.5 * up, kk = fract(k) - 0.5;   // a knot every 3 units, 2.2 units a second
    float he = o * dc, t = y * he < 0.0 ? he / (he - y) : 0.0;           // (the eye's height over the disc's plane; where the line of sight crosses it)
    float rc = length(mix(uEye - b.xyz, rel, t));
    jet = exp(-d * d / (w * w)) * exp(-far / mix(HOLE_JET.w, HOLE_JET.y, up)) * (0.4 + 3.0 * exp(-kk * kk * 60.0) * hash(floor(k) + 7.0 * up))
        * smoothstep(0.0, 0.6, far) * (1.0 - smoothstep(mix(0.45 * reach, reach - 1.5, up), reach, far)) * 44.0
        * mix(HOLE_CONE.z, 1.0, smoothstep(-0.1, 0.1, o * (up - 0.5))) * (1.0 - 0.5 * smoothstep(0.9 * rin, 1.2 * rin, rc) * (1.0 - smoothstep(0.8 * outer, outer, rc)));
  }
  HoleJet = jet / max(light + jet, 1e-4);
  float white = clamp(m.y * m.y * m.y * 0.3 + ring * 0.7, 0.0, 1.0);
  // Only the hottest light casts rays, and none that would run across the heart.
  HoleRay = max(smoothstep(0.25, 0.7, white) * S.x * S.x / max(off * off, 1e-3), smoothstep(0.5, 2.0, m.z));
  return vec3(light + jet, white, m.y * m.y);
}

// A black hole's shadow (see holeLight): how much of an LED's light is
// hidden, as the eye sees it at seen, by a sphere at C of radius uHole.w: all
// of it where the line of sight passes through the sphere on its way to the
// LED (the LED lies inside it or behind it), none outside; the edge is soft
// over about one LED gap at the sphere's distance, so it is crisp and round.
float hideBy(vec3 seen, vec3 C) {
  float R = uHole.w, soft = 0.6 * max(uLane.x, uLane.y);
  vec3 to = seen - uEye, c = C - uEye;
  float L = length(to);
  float tc = dot(c, to) / L;                          // the sphere's centre, along the line of sight
  float d2 = max(dot(c, c) - tc * tc, 0.0);           // and its distance from that line, squared
  if (d2 > R * R) return 0.0;
  float front = tc - sqrt(R * R - d2);                // where the line of sight enters the sphere
  return (1.0 - smoothstep(R - soft, R, sqrt(d2))) * smoothstep(front - soft, front + soft, L);
}
// What is left of an LED's light: its own line of sight is tested against
// the hole; an image's (in the floor, in a wall) also against the image of
// the hole there, which is where its line of sight runs past the mirror.
float holeShadow(vec3 seen) {
  float h = hideBy(seen, uHole.xyz);
  vec4 cp = uCopy[gl_InstanceID];
  if (uMirror.y > 0.0 || gl_InstanceID > 0) {
    vec3 C = vec3(cp.x * uHole.x + cp.y, uHole.y, cp.z * uHole.z + cp.w);
    if (uMirror.y > 0.0) C.y = 2.0 * uMirror.x - C.y;
    h = max(h, hideBy(seen, C));
  }
  return 1.0 - uHoleDark * h;
}

// Its part of the celestial bodies' interface (celestial.js: KINDS).
float holeFar(vec3 rel, vec4 b, vec4 e, vec4 f) { return holeReach(rel, b, e.z, f.w); }
// Its colour: the disc's first colour mixed towards its second, then
// towards WHITE_HOT, then towards the jets' (the slot's third).
vec3 holeBody(vec3 p, vec4 a, vec4 b, vec4 e, vec4 f, int k, out vec3 col) {
  vec3 h = holeLight(p, a, b, e.z, f);
  col = mix(mix(mix(uFormC[k], uFormD[k], h.z), WHITE_HOT, clamp(h.y, 0.0, 1.0)), uFormG[k], HoleJet);
  BodyRay = HoleRay;
  BodyThread = 0.12;   // (a disc is not its strands)
  return vec3(h.x, 0.0, 0.0);
}
float holeShade(vec3 seen) { return uHoleDark > 0.0 ? holeShadow(seen) : 1.0; }
`;
