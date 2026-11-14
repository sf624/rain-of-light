// The comet: one of the planet's variants (config.js: PLANETS, `comet`), a
// small bright head (its coma) with two tails that point away from its sun:
// a narrow, straight, bluish ion tail, and a broad, softly curved, pale dust
// tail that fans out and lags behind along its way. How it moves is in
// forms.js (comet): it crosses the room on a gentle arc, its tails growing
// as it nears its sun. Here: its tails' shape (one source for the shader and
// for its lowest light), its reach and lowest light, and the shader's comet
// (COMET_GLSL, put into the planet's programs by planets.js).
//
// Like the planet's ball, every LED shows the comet as seen along its line
// of sight, so the comet reads as one continuous picture, not as a fence of
// dotted columns, on a coarse lattice too. The head is a ball of LEDs, each
// showing the coma by how near its line of sight passes the heart; each tail
// is a tube of LEDs about its middle line, wider than the tail, each showing
// the tail by how near its line of sight passes that line. Each LED gives
// its share: as many LEDs show the same place as lie along the line of
// sight's chord through the ball or the tube.
//
// Matter streams down the tails from the head: what an LED shows at a
// place depends on when that matter left the head, an aperiodic function
// (value noise) of that time, so the wisps come in clumps of every size and
// spacing and never repeat.

import { PLANETS } from './config.js';

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${+x.toFixed(4)}`);
const COMET = PLANETS.findIndex((P) => P.comet);
const C = PLANETS[COMET]?.comet;

// The dust tail's middle line, at s along the way from its sun: it bends
// towards the side it lags on (bend, per unit squared), and its half width
// grows out from the head (dust: [length, half width at the head, its
// growth per unit, bend]).
export const dustMid = (s) => C.dust[3] * s * s;
export const dustHalf = (s) => C.dust[1] + C.dust[2] * s;
// The dust tail's tube: how far about its middle line its LEDs reach (in
// the shader with a lattice step more, see COMET_GLSL).
const DUST_TUBE = 1.6;

// How far from its head a comet's light reaches, with its tails `ion` and
// `dust` long: their ends, the dust's fan and bend, and the tubes about them.
export function cometReach(ion, dust) {
  const d = Math.hypot(dust, dustMid(dust) + DUST_TUBE * dustHalf(dust));
  return Math.max(C.size * C.window, ion + 1.5, d + 1) + 0.5;
}
// How far below its head a comet's light reaches while it still shows
// clearly: its coma, or its dust tail's lower edge, where the tail lies
// below the head (up: the y of the way from its sun; lagUp: the y of the
// side its dust tail bends to). The dust tail counts as far out as it
// shows clearly (dustClear of its length) and as wide (CLEAR_HALF of its
// half width; see the profile in COMET_GLSL).
const CLEAR_HALF = 0.6;
export function cometLow(up, lagUp, dust) {
  let low = C.size * C.clear;
  const across = Math.sqrt(Math.max(0, 1 - up * up));   // (the tube's height about its middle line, for each unit of its radius)
  for (let i = 1; i <= 16; i++) {
    const s = dust * C.dustClear * i / 16;
    low = Math.max(low, CLEAR_HALF * dustHalf(s) * across - (s * up + dustMid(s) * lagUp));
  }
  return low;
}

// The shader's comet (only in planetShader's programs, see planets.js). It
// needs hash3, noise3, uTime, uLane, Eye, the slot's colours (uFormC, uFormD,
// uFormG, uFormH) and its frame (uFormN, uFormS, uFormT) from there.
export const COMET_GLSL = C ? `
// ---------- the comet (see comet.js) ----------
// A tail's middle line from the head (at the origin) along A, bent towards
// G by bend s^2 and shaken aside by off(s).
vec3 cometAxis(vec3 A, vec3 G, float bend, float s) { return A * s + G * (bend * s * s); }
// Where the line of sight (from oc, the eye as seen from the head, along d)
// passes nearest the tail's middle line: s, how far out along it, and the
// distance between them (one step along the bent line from its nearest
// place to the straight one). sinG: the sine of the angle between them.
float cometNear(vec3 oc, vec3 d, vec3 A, vec3 G, float bend, out float s, out vec3 gap, out float sinG) {
  float ad = dot(A, d), den = max(1.0 - ad * ad, 1e-4), oa = dot(oc, A), od = dot(oc, d);
  sinG = sqrt(den);
  s = (oa - ad * od) / den;
  vec3 P = cometAxis(A, G, bend, s), tg = normalize(A + G * (2.0 * bend * s));
  vec3 w = oc - P;
  s += dot(w - d * dot(w, d), tg);
  w = oc - cometAxis(A, G, bend, s);
  gap = d * dot(w, d) - w;          // from the line to the line of sight
  return length(gap);
}
// The comet in slot k: a = (type, weight, the coma's radius, -), b = (its
// head, -), f = (variant, how bright its tails are (0 .. 1), how bright its
// head is (0 .. 1), reach). uFormN: the way from its sun (A); uFormS: the
// side its dust lags on (G, across A); uFormT: its ion tail's length, its
// dust tail's length. col: the LED's colour (the heart, the coma, the ion
// tail, the dust tail: the slot's four).
vec3 cometLight(vec3 p, vec4 a, vec4 b, vec4 f, int k, out vec3 col) {
  col = vec3(0.0);
  vec3 q = p - b.xyz, A = uFormN[k], G = uFormS[k], T = uFormT[k];
  vec3 N = cross(A, G);
  float R = a.z, RH = R * ${f(C.window)}, sq = dot(q, A);
  bool inHead = dot(q, q) < RH * RH;
  // The tubes about the tails' middle lines: how far this LED is from each.
  float lane = max(uLane.x, uLane.y);
  float ionTube = max(${f(C.ion[1] * 6)}, 3.0 * lane) + ${f(C.ion[2] * 2.5)} * max(sq, 0.0);
  float ionAt = length(q - A * sq);
  float sd = max(sq, 0.0), dustTube = ${f(DUST_TUBE)} * (${f(C.dust[1])} + ${f(C.dust[2])} * sd) + lane;
  float dustAt = length(q - cometAxis(A, G, ${f(C.dust[3])}, sd));
  bool inIon = f.y > 0.001 && sq > -lane && sq < T.x + lane && ionAt < ionTube + 1.0;
  bool inDust = f.y > 0.001 && sq > -lane && sq < T.y + lane && dustAt < dustTube;
  if (!inHead && !inIon && !inDust) return vec3(0.0);
  vec3 oc = Eye - b.xyz;                                   // the eye, from the head (in a mirror, its image)
  vec3 d = normalize(p - Eye);                             // the line of sight through this LED
  float hp = 0.0, heart = 0.0, coma = 0.0, ion = 0.0, dust = 0.0, spark = 0.0;
  if (inHead) {
    // How near the line of sight passes the heart; the chord it runs through the head's LEDs.
    float bo = dot(oc, d), b2 = max(dot(oc, oc) - bo * bo, 0.0);
    float chord = 2.0 * sqrt(max(RH * RH - b2, 0.0));
    float each = uLane.x / max(chord, 0.5 * RH);
    float rc = R * (1.0 + 0.1 * (noise3(vec3(uTime * 0.13, 3.7, 1.1)) - 0.5));   // it breathes a little
    hp = exp(-b2 / (rc * rc * 1.6)) / (1.0 + b2 / (${f(C.core * C.core)} * rc * rc));
    heart = f.z * each * ${f(C.heart)} * hp;
    coma = f.z * each * ${f(C.coma)} * exp(-b2 / (rc * rc));
  }
  // The ion tail: matter leaves the head and is blown straight out from the
  // sun, fast and speeding up; born: when the matter seen at s left the head.
  if (inIon) {
    float s, sinG; vec3 gap;
    float dist0 = cometNear(oc, d, A, G, 0.0, s, gap, sinG);
    if (s > 0.0 && s < T.x) {
      float born = uTime - (sqrt(${f(C.ionFlow[0] * C.ionFlow[0])} + ${f(2 * C.ionFlow[1])} * s) - ${f(C.ionFlow[0])}) / ${f(C.ionFlow[1])};
      // Kinks: the wind shakes the tail where it leaves the head, and the shake is carried out, growing.
      vec2 kink = s * ${f(C.kink)} * vec2(noise3(vec3(born * 0.21, 5.3, 2.9)) - 0.5 + 0.6 * (noise3(vec3(born * 0.57, 8.1, 0.4)) - 0.5),
        noise3(vec3(born * 0.17, 1.9, 6.2)) - 0.5);
      vec3 off = G * kink.x + N * kink.y;
      float dist = length(gap - (off - d * dot(off, d)));
      float w = max(${f(C.ion[1])} + ${f(C.ion[2])} * s, 0.5 * lane);
      // Clumps of every size and spacing, from when the matter left.
      float n1 = noise3(vec3(born * 0.33, 1.7, 4.2)), n2 = noise3(vec3(born * 1.1, 6.6, 9.9));
      float wisp = 0.3 + 1.4 * n1 * n1 + 0.5 * n2 * n2;
      float along = smoothstep(0.0, R * 1.5, s) * exp(-s / (0.9 * T.x)) * (1.0 - smoothstep(0.5 * T.x, T.x, s));
      float tube = max(${f(C.ion[1] * 6)}, 3.0 * lane) + ${f(C.ion[2] * 2.5)} * s;
      float chord = 2.0 * sqrt(max(tube * tube - dist * dist, 0.0)) / max(sinG, 0.35);
      float win = 1.0 - smoothstep(tube, tube + 1.0, ionAt);
      ion = ${f(C.ion[3])} * exp(-dist * dist / (w * w)) * along * wisp * f.y * win * uLane.x / max(chord, 0.5 * tube);
    }
  }
  // The dust tail: slower, it fans out and bends behind the head along its way.
  if (inDust) {
    float s, sinG; vec3 gap;
    float dist = cometNear(oc, d, A, G, ${f(C.dust[3])}, s, gap, sinG);
    if (s > 0.0 && s < T.y) {
      float born = uTime - s / ${f(C.dustFlow)};
      float h = ${f(C.dust[1])} + ${f(C.dust[2])} * s;
      float u = dot(gap, G) / h, v = dist / h;
      // Sharper on the side towards the ion tail, softer on the side it bends to.
      float prof = exp(-v * v * (u < 0.0 ? 2.0 : 1.0));
      // Bands across it: the dust of one moment, spread out as it goes.
      float band = 0.7 + 0.6 * noise3(vec3(born * 0.42 + u * 0.3, 3.3, 5.5));
      float along = smoothstep(0.0, R * 1.5, s) * exp(-s / (0.65 * T.y)) * (1.0 - smoothstep(0.35 * T.y, T.y, s));
      float tube = ${f(DUST_TUBE)} * h + lane;
      float chord = 2.0 * sqrt(max(tube * tube - dist * dist, 0.0)) / max(sinG, 0.35);
      float win = 1.0 - smoothstep(tube - lane, tube, dustAt);
      dust = ${f(C.dust[4])} * prof * band * along * f.y * win * uLane.x / max(chord, 0.5 * tube);
      // Fine sparkle in the dust: a few LEDs glint now and then.
      float g = hash3(p * 1.9 + 7.3);
      spark = g < 0.05 ? dust * pow(0.5 + 0.5 * sin(uTime * (0.4 + 5.0 * g) + 71.0 * g), 16.0) * 4.0 : 0.0;
    }
  }
  float light = heart + coma + ion + dust + spark;
  if (light < 1e-4) return vec3(0.0);
  col = (heart * uFormC[k] + coma * uFormD[k] + ion * uFormG[k] + (dust + spark) * uFormH[k]) / light;
  // Only the heart is white-hot (and so casts rays), and a glint now and then.
  float hot = f.z * smoothstep(0.3, 0.95, hp) * 0.9 + min(spark * 2.0, 0.6);
  return vec3(light, hot, 0.0);
}
` : '';
