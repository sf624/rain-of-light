// The GLSL sources: a vertex and fragment pair for the points, and three
// full-screen passes (downsample, blur, composite) that share QUAD_VS.

// The falling time wraps at this many flow units (see drop() in POINT_VS).
export const FLOW_WRAP = 1000;
// A light ray is at most this many times the Ray length setting (see POINT_VS: rayK).
export const RAY_CAP = 2.5;

export const POINT_VS = `#version 300 es
precision highp float;
precision highp sampler3D;
layout(location = 0) in vec4 aData; // x, u (0 top .. 1 bottom), z, seed
layout(location = 1) in vec3 aRank; // order in which strands and LEDs go dark when thinning; the LED's gain
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uHeight;
uniform float uFocal;
uniform float uSize;
const float FLOW_WRAP = ${FLOW_WRAP}.0;
uniform float uFlow;  // falling time: integrated, so speed changes never make drops jump; wrapped at FLOW_WRAP
uniform float uRain;  // 0 light rain .. 1 downpour
// The rain's colours come as two looks, and each strand shows one of them
// (uSide: how far the strands have gone over from the first to the second):
// a new colour takes the rain over strand by strand, never as a blend of
// two colours, which goes grey. main() copies the strand's look into the
// globals below.
uniform float uW[22];    // per look: weights of the colour modes, in the order of COLOR_MODES
uniform vec3 uSet[8];    // palette rain: the colours drops pick from
uniform vec3 uAccent[2]; // accent: the colour of the rare drop
uniform vec3 uNear[2];   // depth: colour near the eye
uniform vec3 uFar[2];    // depth: colour far away
uniform float uCloudHue[2]; // colour clouds: base hue
uniform vec3 uGrad0[2];
uniform vec3 uGrad1[2];
uniform vec3 uColA[2];
uniform vec3 uColB[2];
uniform float uSide;
float W[11];
vec3 Set[4];
vec3 Accent, Near, Far, Grad0, Grad1, ColA, ColB;
float CloudHue;
uniform vec3 uSky0;    // sky: colour at the top
uniform vec3 uSky1;    // sky: colour at the bottom
uniform float uFlowRate; // how fast the rain falls now (weather)
// The rain falls down or flows sideways, one after the other, never both (see direction.js).
uniform float uTurn;       // the flow's colour: 0 as the rain falls down .. 1 as it flows sideways
uniform vec2 uDirW;        // how much of the falling rain, and of the sideways rain, shows
uniform vec4 uGate;        // per direction: the falling time its drops may set out from, and for how long
uniform vec2 uFlowDir;  // horizontal direction of that flow
uniform vec2 uLane;     // lane width across the flow, lane height
uniform float uSpan;
uniform float uFogFar;
uniform vec4 uRipples[8]; // xyz center, w start time
uniform float uRest;
uniform float uRainGain;
uniform float uTipGain;
uniform float uMaxPx;
uniform float uWire;   // 0: drawing the LEDs; > 0: drawing the wires between them, this bright
uniform float uRayLen; // > 0: drawing the light rays, this long (px)
uniform vec3 uRayView;     // the view's height over 1080 px; the longest ray (px) the GPU draws
uniform float uTrail;
uniform float uBandShift; // how far the colour bands have slid (integrated and wrapped in JS)
uniform float uBandScale;
uniform float uSat;
uniform vec2 uDensity;  // share of strands, share of LEDs per strand, that are on
uniform float uBowStyle; // rainbow: 0 bands, 1 a random hue per drop, 2 per LED
uniform float uRainShare; // share of strands (or lanes across the flow) that carry rain
// The light on this lattice (see lattice.js: latticeLight), so that a denser
// one is as bright as a sparser one: the light of the forms, waves and rest
// per LED, the light per wire, the share of LEDs that twinkle.
uniform vec3 uLight;
// The rain on this lattice (see lattice.js: latticeLight): [0] the scale of the
// share of strands, and of lanes across the flow, that carry rain; [1] along a
// strand, [2] along a lane: how many times as many LEDs per length lie there
// as on the lattice the light is set for, and each one's light.
uniform vec2 uRainK[3];
// The show: how much of the rain's look there is, forms of light, and the mirrors.
uniform float uRainMix;   // 0: the still room's look (pale drops, the room's tint) .. 1: the rain's colours
uniform float uStorm;     // 0 .. 1: how much rain falls through a form (the rain gives way to it)
uniform vec4 uFormA[3];   // per form: type (see FORMS and LAYER in config.js), weight 0..1, size, turn
uniform vec4 uFormB[3];   // centre (the layer: its height in y), tilt
uniform vec4 uFormE[3];   // how much it comes and goes from the top down (0: LED by LED), 1 coming / -1 going,
                          // the way the tilt leans (yaw), how far it has risen away as points (0 .. 1)
uniform vec4 uFormF[3];   // the form's own measures (see forms.js), and how far from its centre its light reaches
uniform vec3 uFormC[3];   // the form's colour
uniform vec3 uFormD[3];   // its second colour
uniform vec3 uTint;       // the colour of the room: of the forms shown now
uniform float uTwinkle;
uniform vec3 uMirror;     // floor height, reflection gain (> 0: drawing the reflection), its fade length
uniform vec4 uCopy[9];    // wall mirrors, per instance: x sign, x offset, z sign, z offset
uniform float uCopyGain[9];
uniform vec2 uCull;       // a point this far out of the view (in clip units, 1: the edge) is not lit
// How much of the falling rain's light goes as in a real room (see main():
// phys): as much as falling rain shows.
uniform float uFallLight;
uniform vec3 uEye;        // where the eye is
out vec3 vColor;
out float vSize;
out float vSprite;        // the sprite's size: the LED's, or its rays' if longer
out vec4 vRay;            // the rays' colour, and their length in px (0: none)

// Light rays: how long a ray is, in Ray lengths, for a head seen this bright.
// It grows from nothing in step with the light, so a ray grows in and out with
// its head, and a far, dim head casts a short one: near and far rays differ as
// much as their light. A head as bright as RAY_LIGHT (a near one) casts the
// setting's length; the brightest at most RAY_CAP times it. (A gentler curve,
// a square root or a log, left all rays nearly one length: the room looked flat.)
const float RAY_LIGHT = 3.0, RAY_CAP = ${RAY_CAP};
const float RAY_MIN = 0.75;    // px: a ray shorter than this is not drawn (it has faded out by then)
float rayK(float light) {
  return min(RAY_CAP, max(light, 0.0) / RAY_LIGHT);
}

float hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
// (No sine here: the sine of a large number, times a large one, turns a last-bit
// difference in rounding into another number altogether, and the GPU rounds the
// same corner a little differently from one cell of the noise to the next. Then
// noise that moves in time jumped all at once each time it crossed a cell.)
float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(1.0, 0.0);
  return mix(mix(mix(hash3(i), hash3(i + e.xyy), f.x), mix(hash3(i + e.yxy), hash3(i + e.xxy), f.x), f.y),
             mix(mix(hash3(i + e.yyx), hash3(i + e.xyx), f.x), mix(hash3(i + e.yxx), hash3(i + e.xxx), f.x), f.y), f.z);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Rainbow colour of one hue; pure hues look darker, so lift them.
vec3 bowAt(float hue) { return hsv2rgb(vec3(fract(hue), uSat, 1.0)) * 1.4; }

// Colour flows with the light. "along" runs 0 .. 1 in the direction the light
// travels (top to bottom, or far to near); the colour bands slide along it at
// about the speed of an average drop, so they pour down (or in) with the rain.
// The rainbow is added here only as bands; per drop and per LED come later.
vec3 flowColor(float along, float spatial, float h) {
  float phase = along - uBandShift + spatial;
  vec3 mono = mix(ColA, ColB, h * h * 0.85);       // mostly the deep colour, some LEDs paler
  vec3 grad = mix(Grad0, Grad1, 0.5 + 0.5 * sin(phase * 6.2832 * 0.9 * uBandScale));
  vec3 bow = uBowStyle < 0.5 ? bowAt(phase * 0.7 * uBandScale) : vec3(0.0);
  return mono * W[0] + grad * W[1] + bow * W[2];
}

// Colours of the field itself, whatever the flow: drifting clouds of colour,
// near and far, the colour the last wave painted, and the sky.
vec3 placeColor(vec3 pos, float u, float dist) {
  vec3 c = vec3(0.0);
  if (W[7] > 0.001) {
    vec3 drift = vec3(uTime * 0.35, uTime * 0.04, uTime * 0.18);
    float n = noise3(pos * 0.14 + drift) * 0.7 + noise3(pos * 0.37 - drift * 0.6) * 0.3;
    c += hsv2rgb(vec3(fract(CloudHue + smoothstep(0.3, 0.7, n) * 0.4), 0.85, 1.0)) * 1.3 * W[7];
  }
  if (W[8] > 0.001) c += mix(Near, Far, smoothstep(2.5, uFogFar * 0.7, dist)) * W[8];
  if (W[9] > 0.001) {
    float last = -1e9;                       // the latest wave that has passed this LED
    for (int i = 0; i < 8; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.w;
      if (age > 0.0 && r.w > last && length(pos - r.xyz) < age * 3.6) last = r.w;
    }
    c += hsv2rgb(vec3(hash(last * 0.731), 0.8, 1.0)) * 1.3 * W[9];
  }
  if (W[10] > 0.001) c += mix(uSky0, uSky1, u) * W[10];
  return c;
}

// The colour a drop keeps as it flows, from its number (sd, cycle).
vec3 dropColor(float sd, float cycle) {
  float r = hash(sd + cycle * 13.37);
  vec3 c = vec3(0.0);
  if (W[2] > 0.001 && uBowStyle > 0.5 && uBowStyle < 1.5) c += bowAt(r) * W[2];
  if (W[3] > 0.001) c += Set[int(min(r * 4.0, 3.0))] * 1.2 * W[3];
  if (W[4] > 0.001) {
    bool rare = hash(sd + cycle * 7.13 + 3.1) < 0.1;
    c += (rare ? Accent * 2.3 : mix(vec3(0.9, 0.93, 1.0), ColA, 0.4)) * W[4];
  }
  if (W[6] > 0.001) {
    // Slow drops glow warm, fast ones blue-white; a downpour turns it all pale.
    float s = clamp(pow(hash(sd + 1.0), 1.5) * 0.8 + (uFlowRate - 1.0) * 0.25, 0.0, 1.0);
    c += (s < 0.5 ? mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.88, 0.7), s * 2.0)
                  : mix(vec3(1.0, 0.88, 0.7), vec3(0.5, 0.78, 1.0), s * 2.0 - 1.0)) * 1.2 * W[6];
  }
  return c;
}

// One drop runs along a line of LEDs (u: 0 start .. 1 end), then waits past the
// end for the rest of its period. Returns (trail of this drop, tail of the drop
// before it, head brightness, number of this drop) so each drop can have a colour.
// Only drops that set out within the gate (from gate.x, for gate.y) show: as a
// rain ends no new drops come, and as one begins none is already on its way.
// led: the line's LEDs per length, so that the head stays about one LED long,
// and each LED's light (uRainK).
vec4 drop(float sd, float u, float trailK, vec2 gate, vec2 led) {
  float speed  = mix(0.07, 0.34, pow(hash(sd + 1.0), 1.5));
  float period = mix(1.3, 2.8, hash(sd + 2.0));
  float trail  = mix(0.04, 0.18, hash(sd + 3.0)) * trailK;
  // The falling time wraps every FLOW_WRAP, so each drop runs a whole number of
  // cycles (k) in that time: its rate is rounded to k / FLOW_WRAP cycles per unit.
  float k = round(speed / period * FLOW_WRAP);
  float c = uFlow * (k / FLOW_WRAP) + hash(sd + 4.0);
  float cycle = floor(c);
  float born = (cycle - hash(sd + 4.0)) * (FLOW_WRAP / k);   // the falling time this drop set out at
  float now = step(mod(born - gate.x, FLOW_WRAP), gate.y);
  float before = step(mod(born - FLOW_WRAP / k - gate.x, FLOW_WRAP), gate.y);
  float d = fract(c) * period - u;                   // > 0: the LED is behind the head
  float rain = (d >= 0.0 ? exp(-d / trail) : exp(d * 120.0 * led.x)) * led.y;
  now *= smoothstep(0.0, 0.05, fract(c) * period);   // a drop fades in over its first few LEDs, never lit at once
  return vec4(rain * now, exp(-(d + period) / trail) * before * led.y, exp(-abs(d) * 90.0 * led.x) * now * led.y, mod(cycle, k));
}

// Light gathered from several drops, with each drop's own random hue.
struct Lit { float rain; float tip; vec3 rainCol; vec3 tipCol; };
// Comet: a white head whose trail deepens into the palette colour.
const vec3 HEAD = vec3(1.0, 0.97, 0.92);
void gather(inout Lit L, vec4 r, float sd, float w) {
  vec3 now = dropColor(sd, r.w);
  vec3 before = dropColor(sd, r.w - 1.0);
  vec3 tail = ColA * 1.2 * W[5];
  L.rain += (r.x + r.y) * w;
  L.tip += r.z * w;
  float x2 = r.x * r.x;                              // the white of the head reaches only a little way back
  L.rainCol += ((now + mix(tail, HEAD * W[5], x2 * x2 * x2)) * r.x + (before + tail) * r.y) * w;
  L.tipCol += (now + HEAD * W[5]) * r.z * w;
}

// The rain on one strand: two drops at their own pace; in heavy rain two more
// join, one by one across the field, and every trail grows longer.
// How much rain a strand (or a lane across the flow) of number n carries: all
// of it while its hash is under the share, none well over it. In between it
// fades (over SHARE_FADE of the share, about a second at the share's fastest
// change), so no strand's rain comes or goes at once. The share is stretched a
// little near 1 so that a full share still lights every strand fully, and the
// mean share is the one asked for.
const float SHARE_FADE = 0.3;
float rainOn(float n, float k) {
  float s = uRainShare * k;
  s *= 1.0 + (1.0 / (1.0 - 0.5 * SHARE_FADE) - 1.0) * pow(s, 8.0);
  return clamp((s - hash(n + 9.0)) / (SHARE_FADE * max(s, 1e-4)) + 0.5, 0.0, 1.0);
}

void strandRain(inout Lit L, float seed, float u, float trailK, float w) {
  w *= rainOn(seed, uRainK[0].x);
  if (w == 0.0) return;                              // no rain on this strand
  float g3 = hash(seed + 6.0) * 0.6;
  float g4 = 0.3 + hash(seed + 7.0) * 0.6;
  gather(L, drop(seed, u, trailK, uGate.xy, uRainK[1]), seed, w);
  gather(L, drop(seed + 17.0, u, trailK, uGate.xy, uRainK[1]), seed + 17.0, w);
  gather(L, drop(seed + 31.0, u, trailK, uGate.xy, uRainK[1]), seed + 31.0, w * smoothstep(g3, g3 + 0.15, uRain));
  gather(L, drop(seed + 53.0, u, trailK, uGate.xy, uRainK[1]), seed + 53.0, w * smoothstep(g4, g4 + 0.15, uRain));
}

// Light flowing sideways, towards uFlowDir: LEDs in one thin tube along that
// direction light up in turn. Returns the place along the tube (0 .. 1), for the colour.
float sidewaysRain(inout Lit L, vec3 pos, float trailK, float w) {
  const float theta = 1.5707963;                     // (from straight down)
  vec3 hz = vec3(uFlowDir.x, 0.0, uFlowDir.y);
  float st = sin(theta), ct = cos(theta);
  vec3 D = vec3(hz.x * st, -ct, hz.z * st);
  vec3 s1 = vec3(-hz.z, 0.0, hz.x);                  // across the flow, horizontal
  vec3 s2 = cross(D, s1);                            // across the flow, in its vertical plane
  float size2 = uLane.x * ct + uLane.y * st;         // LED spacing along s2
  float lane = floor(dot(pos, s1) / uLane.x) * 7.31 + floor(dot(pos, s2) / size2) * 131.7 + theta * 57.3;
  float len = abs(D.x) * uSpan + abs(D.y) * uHeight + abs(D.z) * uSpan;
  float along = dot(pos, D) / len + 0.5;
  float k = trailK * mix(1.0, 2.0, st);
  w *= rainOn(lane, uRainK[0].y);
  if (w == 0.0) return along;
  gather(L, drop(lane, along, k, uGate.zw, uRainK[2]), lane, w);
  gather(L, drop(lane + 97.0, along, k, uGate.zw, uRainK[2]), lane + 97.0, w * smoothstep(0.2, 0.8, uRain));
  return along;
}

// ---------- forms of light ----------
// Each returns (light, white-hot share, mix from the first colour to the
// second). How each one moves is worked out in forms.js; f holds its own measures.
const vec3 WHITE_HOT = vec3(1.0, 0.96, 0.9);

// The thin forms (a hoop, a curtain) are as thick as about one gap between
// strands, so that a coarse lattice still catches them: this scales their
// squared distances (1 on a lattice of 72 strands a side or more, less on a coarser one).
float fineness() { float k = min(1.0, 0.5 / uLane.x); return k * k; }

// Turned by yaw about the vertical, then tilted about the new x axis.
vec3 turned(vec3 q, float yaw, float tilt) {
  float cy = cos(yaw), sy = sin(yaw);
  q = vec3(cy * q.x - sy * q.z, q.y, sy * q.x + cy * q.z);
  float ct = cos(tilt), st = sin(tilt);
  return vec3(q.x, ct * q.y - st * q.z, st * q.y + ct * q.z);
}

// An orb: a ball of points, deep in colour at its thin rim and pale at its
// glowing heart. It may part in two (f.xy: each half's offset in x and z),
// each half a little smaller; f.z: how far it has risen from the floor.
vec3 orbLight(vec3 p, vec4 a, vec4 b, vec4 f) {
  vec3 o = vec3(f.x, 0.0, f.y);
  float apart = min(1.0, length(o) / a.z * 1.6);
  float R = a.z * (1.0 - 0.2 * apart);
  float d = length(p - b.xyz - o) / R;
  if (apart > 0.0) d = min(d, length(p - b.xyz + o) / R);   // one orb while together, two apart
  float body = exp(-d * d * 2.4) * (1.0 - smoothstep(0.85, 1.0, d));
  float rim = exp(-(d - 0.9) * (d - 0.9) * 220.0);
  float core = exp(-d * d * 7.0) * mix(0.15, 1.0, f.z);     // dim while it is still low, by the floor
  float shimmer = 0.6 + 0.8 * noise3(p * 1.3 + vec3(0.0, uTime * 0.3, 0.0));
  return vec3(body * 2.0 * shimmer + rim * 1.2 + core * 14.0, core * 0.3, smoothstep(0.0, 0.6, d));
}

// A spiral disc: tilted, two arms, a bright bulge at the centre, slowly
// turning. f.x: how far it has unfurled; furled, its arms wind tight.
vec3 spiralLight(vec3 p, vec4 a, vec4 b, float yaw, vec4 f) {
  vec3 q = turned(p - b.xyz, yaw, b.w);
  float R = a.z * f.x;
  float r = length(q.xz) / R;
  float th = atan(q.z, q.x);
  float thick = a.z * (0.06 + 0.12 * exp(-r * r * 8.0));
  float disc = exp(-q.y * q.y / (thick * thick)) * (1.0 - smoothstep(0.75, 1.0, r));
  float arm = pow(0.5 + 0.5 * cos(2.0 * (th - a.w) + mix(9.0, 4.0, f.x) * log(r + 0.03)), 4.0);
  float dust = 0.7 + 0.6 * noise3(p * 0.7);
  float bulge = exp(-dot(q, q) / (a.z * a.z * 0.015));
  return vec3(disc * (0.15 + 22.0 * arm * dust) * exp(-r * 0.6) + bulge * 40.0, bulge, smoothstep(0.1, 0.8, r));
}

// A layer: a sea of light near the floor, its surface in slow waves, its
// points glinting; below the surface it soon goes dark. f.x: how bright it
// is; f.y: how much it has the room to itself (0 .. 1): alone it is the
// subject, a brighter sea in a longer, higher swell, its crests paler.
// f.z: the least of that glow it keeps among rain or under a form.
vec3 layerLight(vec3 p, vec4 a, vec4 b, vec4 f) {
  float s = b.y + (0.35 * sin(p.x * 0.42 + uTime * 0.45) + 0.25 * sin(p.z * 0.57 - uTime * 0.33)
          + 0.12 * sin((p.x - p.z) * 1.1 + uTime * 0.8)) * (1.0 + 0.5 * f.y)
          + f.y * 0.9 * sin(p.x * 0.17 + p.z * 0.11 + uTime * 0.2);
  float dy = p.y - s;
  float thick = a.z * (1.0 + 0.5 * f.y);
  float top = exp(-dy * dy / (thick * thick));
  float below = dy < 0.0 ? exp(dy / 0.7) : 0.0;
  float n = noise3(vec3(p.x * 0.8, uTime * 0.25, p.z * 0.8));
  float glint = 0.3 + 2.2 * n * n;
  return vec3((top * 1.5 * glint + below * 0.22) * f.x * (1.0 + 1.2 * max(f.y, f.z)), top * top * (0.15 + 0.1 * f.y),
    clamp(max(-dy, f.y * 0.7 * top * n * 1.6), 0.0, 1.0));
}

// A ring: a hoop of light, a bright thread in a soft sheath, its face tilted,
// two brighter arcs slowly running round it. It may part into two hoops that
// lean apart (f.x radians) and cross.
vec3 ringLight(vec3 p, vec4 a, vec4 b, float yaw, vec4 f) {
  float apart = min(1.0, f.x * 4.0);
  float fine = fineness();
  float light = 0.0, along = 0.0, hot = 0.0;
  for (int i = 0; i < 2; i++) {
    if (i == 1 && f.x == 0.0) break;                 // one hoop while together
    float tilt = b.w + (i == 0 ? f.x : -f.x);
    vec3 q = turned(p - b.xyz, yaw, tilt);
    float rho = length(q.xz) - a.z;
    float d2 = (rho * rho + q.y * q.y) * fine;
    float th = atan(q.z, q.x);
    float arc = pow(0.5 + 0.5 * cos(th * 2.0 - a.w), 2.0);
    // Where the hoop runs level it crosses each strand at a few LEDs only,
    // where it runs upright it lies along one: the level parts glow more,
    // so the hoop is as bright all the way round.
    float level = 1.0 - abs(sin(tilt) * cos(th));
    float core = exp(-d2 * 9.0);
    float g = (core + 0.3 * exp(-d2 * 2.2)) * (0.42 + 0.58 * arc) * (0.75 + 1.5 * level * level);
    light += g;
    hot += core * core * arc;
    along += g * (0.5 + 0.5 * sin(th + a.w * 0.5));
  }
  float k = f.x == 0.0 ? 1.0 : 0.5 * (1.0 + apart);
  light *= k;
  return vec3(light * 21.0, hot * 0.45 * k, along / max(light, 1e-4) * k);
}

// A veil, like an aurora: a curtain hanging in folds that travel slowly along
// it. Its lower hem is a bright line that rises and falls along the room;
// from it rays of many heights rise and fade. Where a fold turns along the
// line of sight, more of the curtain lies behind itself, and it shows brighter.
// f.x: how much of its length has unrolled; f.y: how far it has lifted;
// f.z: half its length.
vec3 veilLight(vec3 p, vec4 a, vec4 b, float yaw, vec4 f) {
  vec3 q = turned(p - b.xyz, yaw, 0.0);
  float L = f.z, x = q.x;
  float p1 = x * 0.5 + a.w, p2 = x * 1.25 - a.w * 1.6 + 1.3;
  float fold = 1.7 * sin(p1) + 0.55 * sin(p2);
  float slope = 0.85 * cos(p1) + 0.69 * cos(p2);
  float dz = (q.z - fold) / sqrt(1.0 + slope * slope);   // the distance to the curtain, not along z
  float across = exp(-dz * dz * 5.0 * fineness());
  float reach = -L + 2.0 * L * f.x;
  float ends = smoothstep(-L, -L + 3.5, x) * (1.0 - smoothstep(reach - 3.5, reach, x));
  float y = q.y - f.y - 0.75 * sin(x * 0.45 + a.w * 1.3) - 0.3 * sin(x * 1.3 - a.w * 0.9);
  float tall = a.z * (0.4 + 0.6 * pow(0.5 + 0.5 * sin(x * 0.8 + a.w * 0.7 + 2.0 * sin(x * 0.21 - a.w * 0.4)), 1.5));
  float up = y > 0.0 ? pow(max(1.0 - y / tall, 0.0), 1.3) : 0.0;
  float hem = exp(-y * y * (y > 0.0 ? 9.0 : 30.0));
  float rays = 0.5 + 0.5 * sin(x * 2.7 + a.w * 2.0 + 1.5 * sin(x * 0.35 - a.w));
  float light = across * ends * (hem * 10.0 + up * (2.5 + 14.0 * rays * rays));
  return vec3(light, hem * 0.35, clamp(y / tall * 1.7, 0.0, 1.0));
}

// The forms drawn as lines (a solid's edges, a knot): a rod of even light
// with a clean edge and nothing around it, wide enough that two strands
// catch it wherever it runs. d2: the squared distance to the line (in
// strand gaps, see fineness).
float rod(float d2) { return 1.0 - smoothstep(0.13, 0.25, d2); }
// Light running along a line: how bright a place is that lies a way (back) behind
// the running head (0 .. 1 of the way to the head after it): a head, a trail
// that fades over a length (trail), and a short rise before the head, never lit at once.
float runner(float back, float trail) { return exp(-back / trail) + exp(-(1.0 - back) / (trail * 0.06)); }

// A solid: the edges of a regular solid as rods of light, a bright point at
// each corner: a tetrahedron or an octahedron (f.x: which, see SOLID), their
// corners a.z from the centre. It stands on a corner's axis (the solid's y),
// leaning a little (tilt, towards yaw) and turning about that axis (a.w), so
// its edges run aslant or level, never along a strand. The edges are drawn
// out from the corners (f.y: how far, 0 .. 1).
const vec3 CORNER[10] = vec3[10](
  vec3(0.0, 1.0, 0.0), vec3(0.94281, -0.33333, 0.0), vec3(-0.47140, -0.33333, 0.81650), vec3(-0.47140, -0.33333, -0.81650),
  vec3(1.0, 0.0, 0.0), vec3(-1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, -1.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, -1.0));
const ivec2 EDGE[18] = ivec2[18](
  ivec2(0, 1), ivec2(0, 2), ivec2(0, 3), ivec2(1, 2), ivec2(1, 3), ivec2(2, 3),
  ivec2(4, 6), ivec2(4, 7), ivec2(4, 8), ivec2(4, 9), ivec2(5, 6), ivec2(5, 7), ivec2(5, 8), ivec2(5, 9), ivec2(6, 8), ivec2(6, 9), ivec2(7, 8), ivec2(7, 9));
const ivec4 SOLID[2] = ivec4[2](ivec4(0, 6, 0, 4), ivec4(6, 12, 4, 6));   // first edge, edges, first corner, corners
vec3 solidLight(vec3 p, vec4 a, vec4 b, float yaw, vec4 f) {
  float cs = cos(a.w), sn = sin(a.w);
  vec3 q = turned(p - b.xyz, yaw, b.w) / a.z;
  vec3 up = turned(vec3(0.0, 1.0, 0.0), 0.0, b.w);   // the vertical, as the solid sees it
  q = vec3(cs * q.x - sn * q.z, q.y, sn * q.x + cs * q.z);
  up = vec3(cs * up.x - sn * up.z, up.y, sn * up.x + cs * up.z);
  float fine = fineness() * a.z * a.z;
  ivec4 which = SOLID[int(f.x + 0.5)];
  float light = 0.0, hot = 0.0, along = 0.0;
  for (int e = 0; e < 12; e++) {
    if (e >= which.y) break;
    ivec2 ends = EDGE[which.x + e];
    vec3 A = CORNER[ends.x], ba = CORNER[ends.y] - A;
    vec3 pa = q - A;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    vec3 off = pa - ba * h;
    float m = min(h, 1.0 - h);                       // 0 at a corner .. 0.5 at the middle of the edge
    float drawn = 1.0 - smoothstep(f.y * 0.56 - 0.06, f.y * 0.56, m);
    // (An edge that runs level crosses each strand at a few LEDs only: it glows more, like the ring.)
    float level = 1.0 - abs(dot(normalize(ba), up));
    float g = rod(dot(off, off) * fine) * drawn * (0.75 + 0.6 * level * level);
    light += g;
    along += g * m * 2.0;
  }
  for (int v = 0; v < 6; v++) {
    if (v >= which.w) break;
    vec3 d = q - CORNER[which.z + v];
    hot += rod(dot(d, d) * fine * 0.45);
  }
  return vec3(min(light, 1.6) * 8.0 + hot * 9.0, hot * 0.5, along / max(light, 1e-4));
}

// A knot: a Lissajous curve in three dimensions, x = sin(u t + a.w),
// y = sin(v t), z = sin(w t + phase), a closed line whose loops open and
// close a little as its phase sways. It swings twice across while it goes
// once up and down (a figure of eight, woven in depth), so it runs mostly
// aslant or level, hardly ever along a strand, and its loops are few and wide.
// Two lights run round it. f.x .. f.y: the part of the curve that shows (0 .. 1 of the way round).
// The curve passes the LED's height at 2 v places: the nearest place on it
// is sought from each (one step along the curve), so the cost does not grow
// with the curve's length.
const vec3 KNOT = vec3(2.0, 1.0, 3.0);               // u, v, w: how often it swings across, up and down, and in depth
const vec3 KNOT_BOX = vec3(1.0, 0.9, 0.4);          // its half width, height and depth, in units of its size: its broad side shows the figure
vec3 knotLight(vec3 p, vec4 a, vec4 b, float yaw, vec4 f) {
  const float TAU = 6.2831853;
  vec3 w = KNOT;
  vec3 amp = a.z * KNOT_BOX;
  vec3 ph = vec3(a.w, 0.0, a.w * 0.618 + 1.0);
  vec3 q = turned(p - b.xyz, yaw, 0.0);
  if (any(greaterThan(abs(q), amp + 1.2))) return vec3(0.0);   // the curve comes nowhere near
  float ys = asin(clamp(q.y / amp.y, -1.0, 1.0));
  float best = 1e9, at = 0.0, level = 0.0;
  for (int i = 0; i < 2; i++) {                      // (2 v places, and v is 1)
    float t = (i == 0 ? ys : 3.14159265 - ys) / w.y;
    vec3 ang = w * t + ph;
    vec3 c = amp * sin(ang), T = amp * w * cos(ang);
    t += clamp(dot(q - c, T) / max(dot(T, T), 1e-4), -0.3, 0.3);
    vec3 d = q - amp * sin(w * t + ph);
    float d2 = dot(d, d);
    if (d2 < best) { best = d2; at = t; level = 1.0 - abs(T.y) / max(length(T), 1e-4); }
  }
  float s = fract(at / TAU);
  float shown = smoothstep(f.x, f.x + 0.04, s) * (1.0 - smoothstep(f.y - 0.04, f.y, s));
  float run = runner(fract((uTime * 0.021 - s) * 2.0), 0.3);
  float g = rod(best * fineness()) * shown * (0.75 + 0.6 * level * level);
  return vec3(g * (7.0 + 9.0 * run), g * run * run * 0.3, clamp(run * 1.3, 0.0, 1.0));
}

// The light of the forms at p (v: 0 at the top .. 1 at the floor). Each comes
// and goes LED by LED in a random order, or, while rain falls, from the top down.
// A form that rises away as points (e.w) is seen by each LED a random way
// below it: its light lifts off as points, the high ones rising fastest.
// thread: the share of that light the strand's wire shows; around: how near
// p is to a sky form (1 within its reach, 0 well away): rain gives way there.
const vec2 LAYER_NEAR = vec2(4.5, 11.0);   // the layer is dark nearer the eye than x, full from y on
const float FORM_BODY = 1.25;              // the sky forms' light, over what their own functions give
vec3 formsAt(vec3 p, float id, float v, out vec3 thread, out float around) {
  vec3 c = vec3(0.0);
  thread = vec3(0.0);
  around = 0.0;
  for (int k = 0; k < 3; k++) {
    vec4 a = uFormA[k];
    if (a.y < 0.001) continue;
    vec4 b = uFormB[k];
    vec4 e = uFormE[k];
    vec4 ff = uFormF[k];
    vec3 q = p;
    float keep = 1.0;
    if (e.w > 0.001) {
      float h = hash(id + float(k) * 3.1 + 0.5);
      q.y -= e.w * (0.5 + 6.5 * h * h);
      // (each LED fades out as its turn comes, over a second or so, never at once)
      keep = (1.0 - e.w * 0.7) * clamp((hash(id + float(k) * 5.3 + 0.9) - e.w * 0.6) / 0.08 + 1.0, 0.0, 1.0);
    }
    float far = length(q - b.xyz);
    if (k < 2) around = max(around, a.y * (1.0 - smoothstep(ff.w * 0.8, ff.w * 2.2, far)));
    if (far > ff.w) continue;                        // too far from it for any of its light
    int type = int(a.x + 0.5);
    vec3 f;
    if (type == 0) f = orbLight(q, a, b, ff);
    else if (type == 1) f = spiralLight(q, a, b, e.z, ff);
    else if (type == 2) {
      // Where a sky form already lights this LED the layer gives way, so the
      // two never add up to a white flare where a form meets the layer.
      f = layerLight(q, a, b, ff);
      f.x *= 1.0 - min(0.9, max(c.r, max(c.g, c.b)) * 1.5);
      // Not close to the eye: there the layer would be loose big points across the floor.
      vec3 eye = -(transpose(mat3(uView)) * uView[3].xyz);
      f.x *= smoothstep(LAYER_NEAR.x, LAYER_NEAR.y, length(q.xz - eye.xz));
    }
    else if (type == 3) f = ringLight(q, a, b, e.z, ff);
    else if (type == 4) f = veilLight(q, a, b, e.z, ff);
    else if (type == 5) f = solidLight(q, a, b, e.z, ff);
    else f = knotLight(q, a, b, e.z, ff);
    if (type != 2) f.x *= FORM_BODY;
    float order = mix(hash(id + float(k) * 7.7), e.y > 0.0 ? v : 1.0 - v, e.x * 0.8);
    float on = clamp((a.y * 1.25 - order) / 0.25, 0.0, 1.0) * smoothstep(0.0, 0.4, a.y);
    vec3 light = mix(mix(uFormC[k], uFormD[k], f.z), WHITE_HOT, clamp(f.y, 0.0, 1.0)) * f.x * on * keep;
    c += light;
    thread += light * (type == 2 || type == 3 || type >= 5 ? 0.5 : 1.0);   // a hoop or a line is not its strands
  }
  return c;
}

void main() {
  float seed = aData.w;
  float u = aData.y;
  vec3 pos = vec3(aData.x, (0.5 - u) * uHeight, aData.z);
  float h = hash(seed + 5.0);
  float spatial = (pos.x + pos.z) * 0.012;           // bands lean a little across the field
  // Mirror images: the LED's light, seen where its image is (in the walls, the
  // floor). Everything below is worked out at the LED itself (pos), so each
  // image is a true reflection of it.
  vec4 cp = uCopy[gl_InstanceID];
  vec3 seen = vec3(cp.x * pos.x + cp.y, pos.y, cp.z * pos.z + cp.w);
  if (uMirror.y > 0.0) seen.y = 2.0 * uMirror.x - pos.y;
  vec4 mv = uView * vec4(seen, 1.0);
  float dist = -mv.z;
  vec4 clip = uProj * mv;
  // Out of the view, or lost in the fog: skip the work. A wire keeps its place
  // (unlit), so its line never runs off to where a skipped point goes.
  if (dist > uFogFar || clip.w < 0.05 || abs(clip.x) > clip.w * uCull.x || abs(clip.y) > clip.w * uCull.y) {
    gl_Position = uWire > 0.0 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = uWire > 0.0 ? 1.0 : 0.0;
    vColor = vec3(0.0);
    vSize = 1.0;
    return;
  }
  // This strand's look: the new one comes down each strand, one strand after another.
  int look = hash(seed + 21.0) * 0.75 + u * 0.25 < uSide * 1.001 ? 1 : 0;
  for (int i = 0; i < 11; i++) W[i] = uW[look * 11 + i];
  for (int i = 0; i < 4; i++) Set[i] = uSet[look * 4 + i];
  Accent = uAccent[look]; Near = uNear[look]; Far = uFar[look]; CloudHue = uCloudHue[look];
  Grad0 = uGrad0[look]; Grad1 = uGrad1[look]; ColA = uColA[look]; ColB = uColB[look];
  Lit L = Lit(0.0, 0.0, vec3(0.0), vec3(0.0));

  // The rain falling down, or flowing sideways; while one gives way to the
  // other the flow's colour goes over from one to the other.
  float trailK = mix(1.0, 1.7, uRain) * uTrail;
  vec3 col = vec3(0.0);
  if (uDirW.x > 0.001) strandRain(L, seed, u, trailK, uDirW.x);
  if (uTurn < 0.999) col += flowColor(u, spatial, h) * (1.0 - uTurn);
  if (uDirW.y > 0.001 || uTurn > 0.001) col += flowColor(sidewaysRain(L, pos, trailK, uDirW.y), spatial, h) * uTurn;
  float rain = L.rain;
  float tip = L.tip;
  // Spherical waves of light.
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.w;
    if (age < 0.0 || age > 7.0) continue;
    float x = length(pos - r.xyz) - age * 3.6;
    float fade = (1.0 - age / 7.0) * smoothstep(0.0, 0.3, age);   // it swells in over its first moment, never lit at once
    // In the still room a wave is a ring that spreads level, like one on water:
    // a band of light as tall as a hand's reach, running out along the strands.
    float dy = pos.y - r.y;
    // A crisp front, and a wake that fades behind it.
    float wave = x > 0.0 ? exp(-x * x * 6.0) : exp(x * 1.3);
    ring += wave * mix(exp(-dy * dy * 0.3), 1.0, uRainMix) * fade * fade;
  }

  // The forms' light. A wave lifts it at most to white: past that the LED
  // looks the same, and the extra light would only swell the glow around it.
  float id = seed * 0.37 + u * 91.7;
  vec3 thread;
  float around;
  vec3 form = formsAt(pos, id, u, thread, around);
  float fm = max(form.r, max(form.g, form.b));
  vec3 flare = form * min(1.0, 1.0 / max(fm, 1e-3));
  float inForm = clamp(fm, 0.0, 1.0);                // drops in a form take its colour

  float near = 1.0 - smoothstep(3.0, 12.0, dist);
  // The light in the room (forms, waves, rest): a denser lattice shares it out
  // among more LEDs and wires (uLight), so the room is as bright.
  float wave = ring * uLight.x, rest = uRest * uLight.x;
  vec3 c = (form + flare * 2.5 * ring) * uLight.x;
  // The light that casts rays: all of the LED's light but the rain's trails
  // and the LEDs' light at rest (a drop's head, a form, a wave, a twinkle).
  vec3 glint = c;
  vec3 wireCol = (thread + flare * ring) * uLight.y;
  float wireRest = uRest * 1.5 * near * uLight.y, wireWave = ring * 1.2 * uLight.y;
  float wireRain = uRainGain * 0.2 / uRainK[1].y;     // a wire's light does not grow with its LEDs' light
  // The falling rain's light falls off with distance as in a real room,
  // which is what makes near strands stand out from far ones (its look only:
  // the forms keep theirs).
  // - An LED under 1.5 px (in a view 1080 px tall) keeps its size and dims;
  //   the falling rain dims FALL_DIM times as steeply, so its light falls as
  //   about 1 / distance^1.65 instead of 1 / distance. Its wire dims likewise
  //   from 4 units on.
  // - A mist takes a share of the light per unit of the way (along the ray to
  //   the eye, not the depth, so the edges of a wide view see no farther),
  //   over MIST times the visible distance, in place of the fog's even band;
  //   it still ends at the visible distance.
  // - The floor mirrors less when looked at straight down than at a glancing
  //   look (Schlick's Fresnel), down to FLOOR_MIN of its image.
  // - FALL_GAIN keeps the falling rain as bright on the whole as the fog alone.
  float phys = 1.0, physWire = 1.0;
  if (uFallLight > 0.001) {
    const float FALL_GAIN = 1.8, FALL_DIM = 0.65, MIST = 0.68, FLOOR_MIN = 0.7;
    float fog0 = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, dist);
    float mist = exp(-length(mv.xyz) / (MIST * uFogFar)) * (1.0 - smoothstep(uFogFar * 0.85, uFogFar, dist)) * 1.2;
    float f = FALL_GAIN * min(2.0, mist / max(fog0, 1e-3));
    if (uMirror.y > 0.0) {
      float glance = pow(1.0 - abs(normalize(seen - uEye).y), 5.0);
      f *= mix(FLOOR_MIN, 1.0, min(1.0, 2.5 * (0.04 + 0.96 * glance)));
    }
    phys = mix(1.0, f * pow(min(1.0, uSize * uFocal / (dist * uRayView.x) / 1.5), FALL_DIM), uFallLight);
    physWire = mix(1.0, f * pow(min(1.0, 4.0 / dist), FALL_DIM), uFallLight);
  }
  float rk = uRainMix;
  if (rk > 0.001) {
    // The rain's look: its colour modes. Colours travel with each drop; an
    // LED at rest shows one of its own.
    col += placeColor(pos, u, dist);
    vec3 restDrop = dropColor(id, 0.0) + ColA * 1.2 * W[5];
    vec3 rainCol = col + (rain > 1e-4 ? L.rainCol / rain : restDrop);
    vec3 tipCol = col + (tip > 1e-4 ? L.tipCol / tip : restDrop);
    vec3 restCol = col + restDrop;
    // The rainbow per LED: each LED has its own hue, shown as the light passes.
    if (uBowStyle > 1.5) {
      vec3 led = bowAt(hash(id)) * W[2];
      rainCol += led; tipCol += led; restCol += led;
    }
    // A storm: the rain takes the colour of the form it falls through, and
    // dims, so the form stays the subject and its colours are not drowned.
    if (uStorm > 0.001) {
      vec3 room = mix(uTint, vec3(1.0), 0.12) * 1.15;
      rainCol = mix(rainCol, room, uStorm * 0.75);
      tipCol = mix(tipCol, mix(room, vec3(1.0), 0.3), uStorm * 0.75);
      restCol = mix(restCol, room, uStorm * 0.75);
    }
    rainCol = mix(rainCol, flare * 1.3, inForm * 0.8);
    tipCol = mix(tipCol, mix(flare, vec3(1.0), 0.4) * 1.3, inForm * 0.8);
    // Heads turn white in most modes; in the colourful ones they keep their colour.
    const float WHITE[11] = float[11](0.5, 0.5, 0.15, 0.2, 0.3, 0.0, 0.3, 0.35, 0.35, 0.3, 0.35);
    float white = 0.0;
    for (int i = 0; i < 11; i++) white += WHITE[i] * W[i];
    c += (restCol * rest + rainCol * rain * uRainGain + mix(tipCol, vec3(1.0), white) * tip * uTipGain
        + mix(restCol, vec3(1.0), 0.35) * wave * 4.0) * rk * (1.0 - 0.25 * uStorm) * (1.0 - 0.75 * around * (1.0 - inForm)) * phys;
    glint += (tipCol * tip * uTipGain + mix(restCol, vec3(1.0), 0.35) * wave * 4.0) * rk * phys; // a head's light in its own colour
    wireCol += (rainCol * rain * wireRain + restCol * wireRest + restCol * wireWave) * rk * physWire;
  }
  if (rk < 0.999) {
    // The still room's look: a faint lattice in the room's colour with a
    // sparse twinkle, a few pale drops, and waves.
    vec3 pale = mix(uTint, vec3(1.0), 0.55);
    vec3 drop = mix(pale, flare, inForm * 0.8);
    float tw = hash(id + 3.0) < uLight.z
      ? pow(0.5 + 0.5 * sin(uTime * (0.3 + 1.2 * hash(id + 1.0)) + hash(id + 2.0) * 6.2832), 30.0) * uTwinkle : 0.0;
    c += (uTint * rest + pale * tw + drop * (rain * uRainGain * 0.5 + tip * uTipGain) + pale * 5.0 * wave) * (1.0 - rk);
    glint += (pale * tw + drop * tip * uTipGain + pale * 5.0 * wave) * (1.0 - rk);
    // The strands catch the light of the forms they run through, and a faint
    // sheen of the room's: thin lit threads, never dark bars.
    wireCol += (drop * rain * wireRain + uTint * wireRest + pale * wireWave) * (1.0 - rk);
  }

  float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, dist);
  // Each mirror dims its image a little; the floor's image fades with the height above it.
  float g = uCopyGain[gl_InstanceID] * fog;
  if (uMirror.y > 0.0) g *= uMirror.y * exp(-(pos.y - uMirror.x) / uMirror.z);
  c *= g;
  glint *= g;
  wireCol *= g;

  // Thinning: LEDs past the shown share fade out, in an order that leaves the
  // rest evenly spread, so density can change smoothly.
  vec2 on = clamp((uDensity * 1.04 - aRank.xy) / 0.04, 0.0, 1.0);

  // The wires: a whole thread of light along each strand, as bright between
  // the LEDs as at them, running on past LEDs that are thinned out.
  if (uWire > 0.0) {
    gl_Position = clip;
    gl_PointSize = 1.0;
    vSize = 1.0;
    vColor = wireCol * on.x * uWire;
    return;
  }
  c *= on.x * on.y * aRank.z;
  glint *= on.x * on.y * aRank.z;

  // LEDs right at the eye are skipped: they would only be a blur over the view.
  // They fade out on the way there, so none goes out at once as the eye passes.
  float closeBy = smoothstep(1.2, 2.2, dist);
  c *= closeBy;
  glint *= closeBy;
  if (dist <= 1.2 || max(c.r, max(c.g, c.b)) < 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: skipped
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vSize = 1.0;
    return;
  }

  // Every LED has the same physical size; only its brightness changes.
  // Below 1.5 px, keep the size and dim it instead, so far LEDs do not shimmer.
  float px = uSize * uFocal / dist;
  // The head's light as seen in a view 1080 px tall (in a smaller view an LED
  // dims sooner with distance): what a light ray's length goes by.
  float seenLight = max(glint.r, max(glint.g, glint.b)) * min(1.0, px / (uRayView.x * 1.5));
  float shown = clamp(px, 1.5, max(1.5, uMaxPx));
  c *= min(1.0, px / shown);
  glint *= min(1.0, px / shown);
  gl_Position = clip;
  vSize = shown;
  vColor = c;
  // A pixel wider each side, so the LED's light is spread by area (see POINT_FS).
  vSprite = shown + 2.0;
  vRay = vec4(0.0);
  // Light rays, drawn in the same sprite (made larger if they are longer
  // than the LED): as long as the LED's light makes them (rayK), at most what
  // the GPU draws, in its colour; none under RAY_MIN.
  if (uRayLen > 0.0) {
    float k = rayK(seenLight);
    float len = min(uRayLen * k, uRayView.y);
    if (len >= RAY_MIN) {
      // A short ray is faint, so one that grows from nothing never pops in; a
      // long one is a little dimmer along its length, so a near head does not flare.
      vRay = vec4(glint * smoothstep(RAY_MIN, 3.0, len) * pow(max(k, 1.0), -0.35), len);
      vSprite = max(vSprite, 2.0 * len + 1.0);
    }
  }
  gl_PointSize = vSprite;
}`;

// The wires between the LEDs: a thread of light, as bright between the LEDs
// as at them, in the light of the LEDs along it.
export const WIRE_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
uniform float uGain;
out vec4 outColor;
void main() {
  outColor = vec4(vColor * uGain, 1.0);
}`;

export const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vSize;
in float vSprite;
in vec4 vRay;
uniform float uGain; // 1 with float buffers (the composite pass applies exposure); else exposure and breath
uniform float uRays; // light rays: how many lines (2: up and down)
const float RAY_GAIN = 0.3;  // the rays' light, over the LED's
// The light all the rays on one pixel may add up to, about. The rays go to
// a buffer of their own (outRay), blended ONE, ONE_MINUS_SRC_ALPHA with the
// ray's alpha s / RAY_BUDGET: a ray of light s over rays already there (d)
// gives s + d * (1 - s / RAY_BUDGET). A ray alone, or among faint ones, keeps
// all its light (a rain head's ray), but the rays of a form's thousands of
// LEDs side by side stay a soft sparkle near this light, not a white sheet.
// (It is continuous in every ray's light, so nothing pops; the draw order
// only weighs which ray of two bright ones shows more.) The LED's own light
// has alpha 0 there, so it simply adds.
const float RAY_BUDGET = 0.12;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outRay;
void main() {
  vec2 o = (gl_PointCoord - 0.5) * vSprite;     // from the LED's centre, in pixels
  // Added light: each pixel gets the part of the LED's square that falls
  // on it, so an LED gives the same light wherever it sits between pixels
  // (a plain sprite of 1.5 px covers 1 to 4 whole pixels, and its light
  // jumps as the view moves). Large LEDs are rounded.
  vec2 h = vec2(vSize * 0.5);
  vec2 cov = clamp(min(o + 0.5, h) - max(o - 0.5, -h), 0.0, 1.0);
  float r = length(o) / h.x;
  float a = cov.x * cov.y * (0.85 + 0.15 * (1.0 - min(r * r, 1.0)));
  if (vSize >= 3.5) a *= 1.0 - smoothstep(1.0 - 2.0 / vSize, 1.0, r);
  // The rays: uRays thin lines through the centre, about a pixel wide, fading towards their tips.
  float light = 0.0;
  if (vRay.w > 0.0) {
    float half_ = vRay.w + 0.5;
    for (int k = 0; k < 4; k++) {
      if (float(k) >= uRays * 0.5) break;
      float t = float(k) * 3.14159265 / (uRays * 0.5);
      vec2 dir = vec2(sin(t), cos(t));
      float along = abs(dot(o, dir)) / half_;    // 0 at the LED, 1 at the tip
      float across = abs(dot(o, vec2(dir.y, -dir.x)));
      float fade = 1.0 - smoothstep(0.0, 1.0, along);
      light += exp(-across * across * 1.5) * fade * fade;
    }
  }
  if (a <= 0.0 && light <= 0.0) discard;
  outColor = vec4(vColor * max(a, 0.0) * uGain, 0.0);
  vec3 ray = vRay.rgb * light * RAY_GAIN * uGain;
  outRay = vec4(ray, min(1.0, max(ray.r, max(ray.g, ray.b)) / RAY_BUDGET));
}`;

export const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const DOWN_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uRayTex; // the light rays, added to the scene (uRayK 1) in the first step
uniform float uRayK;
uniform vec2 uTexel;
uniform float uKnee; // > 0: only light brighter than this passes, less the knee (only bright cores glow)
out vec4 outColor;
vec3 at(vec2 d) {
  vec2 uv = vUv + uTexel * d;
  vec3 c = texture(uTex, uv).rgb;
  if (uRayK > 0.0) c += texture(uRayTex, uv).rgb;
  return c;
}
void main() {
  vec3 c = at(vec2(-1.0, -1.0)) + at(vec2(1.0, -1.0)) + at(vec2(-1.0, 1.0)) + at(vec2(1.0, 1.0));
  c *= 0.25;
  // The knee is taken off the brightest channel and the colour kept: dim light
  // (most LEDs, the threads) gives no glow at all, so the dark between stays black.
  float m = max(c.r, max(c.g, c.b));
  if (uKnee > 0.0) c *= max(m - uKnee, 0.0) / max(m, 1e-4);
  outColor = vec4(c, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir; // texel step along the blur axis
out vec4 outColor;
void main() {
  const float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 c = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i) * 1.6;
    c += texture(uTex, vUv + o).rgb * w[i];
    c += texture(uTex, vUv - o).rgb * w[i];
  }
  outColor = vec4(c, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uRayTex;   // the light rays (see POINT_FS)
uniform sampler2D uBloom;
uniform float uBloomK;
uniform float uExposure;
uniform float uFloor;  // black floor: glow fainter than about this (on screen, 0..1) is dropped
uniform sampler2D uHaze;     // a much wider glow, around the brightest light
uniform sampler2D uHazeWide; // and a wider one still, a quarter of its size
uniform float uHazeK;
uniform float uBurn;         // > 0: bright light burns out to white
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// A smooth (cubic B-spline) read of a small texture, from four bilinear reads:
// a plain bilinear read of a texture this coarse shows its texels as soft boxes.
vec3 smoothRead(sampler2D t, vec2 uv) {
  vec2 size = vec2(textureSize(t, 0));
  vec2 p = uv * size - 0.5, i = floor(p), f = p - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 s0 = w0 + w1, s1 = w2 + w3;
  vec2 c0 = (i - 0.5 + w1 / s0) / size, c1 = (i + 1.5 + w3 / s1) / size;
  return (texture(t, vec2(c0.x, c0.y)).rgb * s0.x + texture(t, vec2(c1.x, c0.y)).rgb * s1.x) * s0.y
       + (texture(t, vec2(c0.x, c1.y)).rgb * s0.x + texture(t, vec2(c1.x, c1.y)).rgb * s1.x) * s1.y;
}
void main() {
  // Black floor: the haze between the points is all glow (the blurred light
  // of countless dim LEDs). Glow fainter than the floor fades to nothing, so
  // the space between the points is true black; the points stay untouched.
  vec3 b = texture(uBloom, vUv).rgb * uBloomK;
  float tb = uFloor / max(uExposure, 1e-3);             // the floor before tone mapping
  if (uFloor > 0.0) b *= smoothstep(tb, 3.0 * tb, max(b.r, max(b.g, b.b)));
  if (uHazeK > 0.0) b += (smoothRead(uHaze, vUv) * 0.6 + smoothRead(uHazeWide, vUv)) * uHazeK;
  vec3 c = texture(uScene, vUv).rgb + texture(uRayTex, vUv).rgb + b;
  if (uBurn > 0.0) {
    // Light far past white loses its colour, as on film: the cores burn out.
    float m = max(c.r, max(c.g, c.b));
    c = mix(c, vec3(m), smoothstep(1.5, 8.0, m * uExposure) * uBurn);
  }
  c = vec3(1.0) - exp(-c * uExposure);                       // tone map
  float v = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.5);
  c *= mix(0.55, 1.0, v);                               // vignette
  // Dither against banding, faded out near black so it does not lift it again.
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * smoothstep(0.0, 2.0 / 255.0, c);
  outColor = vec4(c, 1.0);
}`;
