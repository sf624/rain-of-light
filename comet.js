// The comet: one of the planet's variants (config.js: PLANETS, `comet`), a
// small, star-like head (a tight white-hot heart in a modest coma) with two
// long tails that point away from its sun: a straight blue ion tail, a
// narrow cone of fine streamers, and a broad, softly curved, pale gold dust
// tail that fans out and lags behind along its way. How it moves is in
// forms.js (comet): it crosses the room on a gentle arc, its tails growing
// as it nears its sun. Here: its tails' shape (one source for the shader,
// for its lowest light and for its reach), and the shader's comet
// (COMET_GLSL, put into the planet's programs by planets.js).
//
// Like the planet's ball, every LED shows the comet as seen along its line
// of sight, so the comet reads as one continuous picture, not as a fence of
// dotted columns, on a coarse lattice too. The head is a ball of LEDs, each
// showing the coma by how near its line of sight passes the heart; each tail
// is a tube of LEDs about its middle line, wider than the tail, each showing
// the tail by how near its line of sight passes that line. The LEDs along a
// line of sight share what it sees: those near its nearest place to the
// tail's middle line give most of it, those farther along it less (a soft
// window), so that how many LEDs lie in the tube along it does not show.
//
// Matter streams down the tails from the head: what an LED shows at a
// place depends on when that matter left the head, an aperiodic function
// (value noise) of that time, so knots, kinks and wisps come in every size
// and spacing and never repeat; now and then the ion tail breaks off at the
// head and the old tail sails away down the tail while a new one grows.

import { PLANETS, ROOM } from './config.js';

const f = (x) => (Number.isInteger(x) ? `${x}.0` : `${+x.toFixed(4)}`);
const COMET = PLANETS.findIndex((P) => P.comet);
const C = PLANETS[COMET]?.comet;

// The dust tail's middle line, at s along the way from its sun: it leans
// and bends towards the side it lags on (lean, per unit; bend, per unit
// squared), and its half width grows out from the head (dust: [length,
// half width at the head, its growth per unit, lean, bend, how bright]).
export const dustMid = (s) => C.dust[3] * s + C.dust[4] * s * s;
export const dustHalf = (s) => C.dust[1] + C.dust[2] * s;
// The ion tail's fan of streamers: its half width at s (ion[1]: at the
// head; rays[3]: its growth per unit). The glow about its middle near the
// head grows less (ion[2]).
const ionFan = (s) => C.ion[1] + C.rays[3] * s;
// Each tail shows its light out to VIS of its half width about its middle
// line (and a little more on a coarse lattice); its tube of LEDs reaches
// TUBE lattice steps beyond that (the same in the shader, see cometTube).
const VIS = { ion: 1.3, dust: 1.6 };
const TUBE = 2;
const tube = (vis, lane) => vis + TUBE * lane;
// The largest lattice step the shader's tubes allow for here (a phone's lattice is about 0.46).
const LANE_MAX = 0.6;

// How far from its head a comet's light reaches, with its tails `ion` and
// `dust` long: their ends, the dust's fan and bend, and the tubes about them.
export function cometReach(ion, dust) {
  const d = Math.hypot(dust, dustMid(dust) + tube(VIS.dust * dustHalf(dust), LANE_MAX));
  const i = Math.hypot(ion, tube(VIS.ion * ionFan(ion), LANE_MAX) + 0.5 * C.kink * ion);
  return Math.max(C.size * C.window, i, d) + 0.5;
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

// The ion tail's streamers: RAYS fine rays spread evenly across its fan
// (rays[0]: each one's half width, of the fan's; rays[1]: how far each
// wanders across it, of its half width), each in knots that brighten and
// fade with when their matter left the head, the outer ones fainter.
const RAYS = 5;
const rayGLSL = () => Array.from({ length: RAYS }, (_, i) => {
  const at = -1 + 2 * i / (RAYS - 1);
  return `      { float ui = ${f(at)} + ${f(C.rays[1])} * (noise3(vec3(born * 0.07 + ${f(i * 1.7)}, ${f(i * 5.3 + 0.4)}, 2.1)) - 0.5) * 2.0;
        float bi = noise3(vec3(born * ${f(0.27 + 0.09 * i)}, ${f(i * 3.1 + 0.7)}, 6.4));
        float x = (u - ui * fan) / rw;
        rays += ${f(1 - 0.3 * Math.abs(at))} * (0.12 + 2.2 * bi * bi * bi) * exp(-x * x); }`;
}).join('\n');

// The shader's comet (only in planetShader's programs, see planets.js). It
// needs hash3, noise3, uTime, uLane, Eye, the slot's colours (uFormC, uFormD,
// uFormG, uFormH) and its frame (uFormN, uFormS, uFormT) from there.
export const COMET_GLSL = C ? `
// ---------- the comet (see comet.js) ----------
// A tail's middle line from the head (at the origin) along A, leaning
// and bending towards G by lean s + bend s^2 (s: how far along A).
vec3 cometAxis(vec3 A, vec3 G, vec2 lb, float s) { return A * s + G * (lb.x * s + lb.y * s * s); }
// Where the line of sight (from oc, the eye as seen from the head, along d)
// passes nearest the tail's middle line: s, how far out along A, and the
// distance between them (from the nearest place to the leaning line, one
// step along the bent one). sinG: the sine of the angle between them.
float cometNear(vec3 oc, vec3 d, vec3 A, vec3 G, vec2 lb, out float s, out vec3 gap, out float sinG) {
  float m = sqrt(1.0 + lb.x * lb.x);
  vec3 L = (A + G * lb.x) / m;
  float ad = dot(L, d), den = max(1.0 - ad * ad, 1e-4), oa = dot(oc, L), od = dot(oc, d);
  sinG = sqrt(den);
  s = (oa - ad * od) / den / m;
  vec3 P = cometAxis(A, G, lb, s), tg = A + G * (lb.x + 2.0 * lb.y * s);
  float tl = length(tg);
  vec3 w = oc - P;
  s += dot(w - d * dot(w, d), tg / tl) / tl;
  w = oc - cometAxis(A, G, lb, s);
  gap = d * dot(w, d) - w;          // from the line to the line of sight
  return length(gap);
}
// A tail's tube of LEDs about its middle line, where it shows out to vis (see comet.js: tube).
float cometTube(float vis, float lane) { return vis + ${f(TUBE)} * lane; }
// This LED's share of what its line of sight sees of a tail: the LEDs
// along it within the tube share it, all alike over the middle half of its
// chord through the tube and fewer towards the tube's wall (a window that
// tapers, so that how many LEDs lie in the tube along it does not show as
// a pattern). along: how far along the line of sight this LED is from its
// nearest place to the tail's middle line; dist: how near it passes; sinG:
// the sine of its angle to that line.
float cometShare(float along, float dist, float tube, float sinG) {
  float hc = sqrt(max(tube * tube - dist * dist, 0.0));
  float x = min(abs(along) * sinG / max(hc, 1e-3), 1.0);
  float w = x < 0.5 ? 1.0 : 0.5 + 0.5 * cos(6.2832 * (x - 0.5));
  float sg = max(sinG, 0.35);
  return w * uLane.x * sg / (1.5 * max(hc, 0.25 * tube));
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
  float sd = max(sq, 0.0);
  float ionTube = cometTube(${f(VIS.ion)} * (${f(C.ion[1])} + ${f(C.rays[3])} * sd) + 0.4 * lane, lane) + ${f(0.5 * C.kink)} * sd;
  float ionAt = length(q - A * sq);
  float dustTube = cometTube(${f(VIS.dust)} * (${f(C.dust[1])} + ${f(C.dust[2])} * sd), lane);
  vec2 lb = vec2(${f(C.dust[3])}, ${f(C.dust[4])});
  float dustAt = length(q - cometAxis(A, G, lb, sd));
  bool inIon = f.y > 0.001 && sq > -lane && sq < T.x + lane && ionAt < ionTube;
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
    cometNear(oc, d, A, G, vec2(0.0), s, gap, sinG);
    if (s > 0.0 && s < T.x) {
      float born = uTime - (sqrt(${f(C.ionFlow[0] * C.ionFlow[0])} + ${f(2 * C.ionFlow[1])} * s) - ${f(C.ionFlow[0])}) / ${f(C.ionFlow[1])};
      // Kinks: the wind shakes the tail where it leaves the head, and the shake is carried out, growing.
      vec2 kink = s * ${f(C.kink)} * vec2(noise3(vec3(born * 0.21, 5.3, 2.9)) - 0.5 + 0.6 * (noise3(vec3(born * 0.57, 8.1, 0.4)) - 0.5),
        noise3(vec3(born * 0.17, 1.9, 6.2)) - 0.5);
      vec3 off = G * kink.x + N * kink.y;
      vec3 g2 = gap - (off - d * dot(off, d));
      // Across the tail as the eye sees it (u): a soft glow about its middle
      // near the head (w: its half width), and the fan of streamers (fan:
      // its half width).
      float w = ${f(C.ion[1])} + ${f(C.ion[2])} * s, fan = ${f(C.ion[1])} + ${f(C.rays[3])} * s;
      float rw = max(${f(C.rays[0])} * fan, 0.35 * lane);
      float u = dot(g2, cross(d, A)) / max(sinG, 1e-3);
      float rays = ${f(C.rays[2])} * exp(-u * u / (w * w) - s / ${f(0.25 * C.ion[0])});
${rayGLSL()}
      // Now and then the tail breaks off at the head: the matter that left
      // then is missing, and the gap streams away down the tail.
      float cut = 1.0 - 0.9 * smoothstep(${f(C.cut[1])}, ${f(C.cut[1] + 0.05)}, noise3(vec3(born * ${f(C.cut[0])}, 4.4, 1.3)));
      float along = smoothstep(0.0, ${f(C.ion[5])} * R, s) * exp(-s / (${f(C.ion[4])} * T.x)) * (1.0 - smoothstep(0.25 * T.x, T.x, s));
      float tube = cometTube(${f(VIS.ion)} * fan + 0.4 * lane, lane);
      ion = ${f(C.ion[3])} * rays * cut * along * f.y * cometShare(dot(q - A * s - off, d), length(g2), tube, sinG);
    }
  }
  // The dust tail: slower, it fans out and bends behind the head along its way.
  if (inDust) {
    float s, sinG; vec3 gap;
    float dist = cometNear(oc, d, A, G, lb, s, gap, sinG);
    if (s > 0.0 && s < T.y) {
      float born = uTime - s / ${f(C.dustFlow)};
      float h = ${f(C.dust[1])} + ${f(C.dust[2])} * s;
      float u = dot(gap, G) / h, v = dist / h;
      // Sharper on the side towards the ion tail, softer on the side it bends to.
      float prof = exp(-v * v * (u < 0.0 ? 2.0 : 1.0));
      // Striae across it: the dust of one moment, spread out as it goes.
      float n = noise3(vec3(born * 0.42 + u * 0.3, 3.3, 5.5));
      float band = 1.0 + ${f(C.striae)} * (n - 0.5);
      float along = smoothstep(0.0, ${f(C.dust[6])} * R, s) * exp(-s / (0.65 * T.y)) * (1.0 - smoothstep(0.35 * T.y, T.y, s));
      float tube = cometTube(${f(VIS.dust)} * h, lane);
      dust = ${f(C.dust[5])} * prof * band * along * f.y * cometShare(dot(q - cometAxis(A, G, lb, s), d), dist, tube, sinG);
      // Fine sparkle in the dust: a few LEDs glint now and then.
      float g = hash3(p * 1.9 + 7.3);
      spark = g < 0.05 ? dust * pow(0.5 + 0.5 * sin(uTime * (0.4 + 5.0 * g) + 71.0 * g), 16.0) * 4.0 : 0.0;
    }
  }
  // The tails fade out before the room ends (its walls and its top), so a
  // long one never ends in a cut where the lattice does.
  vec3 wall = vec3(${f(ROOM.span / 2)}) - abs(p);
  float tails = smoothstep(0.0, ${f(C.edge)}, min(min(wall.x, wall.z), ${f(ROOM.height / 2)} - p.y));
  ion *= tails; dust *= tails; spark *= tails;
  float light = heart + coma + ion + dust + spark;
  if (light < 1e-4) return vec3(0.0);
  col = (heart * uFormC[k] + coma * uFormD[k] + ion * uFormG[k] + (dust + spark) * uFormH[k]) / light;
  // Only the heart is white-hot (and so casts rays), and a glint now and then.
  float hot = f.z * smoothstep(0.3, 0.95, hp) * 0.9 + min(spark * 2.0, 0.6);
  return vec3(light, hot, 0.0);
}
` : '';
