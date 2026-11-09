// The GLSL sources: a vertex and fragment pair for the points, and three
// full-screen passes (downsample, blur, composite) that share QUAD_VS.

// The falling time wraps at this many flow units (see drop() in POINT_VS).
export const FLOW_WRAP = 1000;

export const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aData; // x, u (0 top .. 1 bottom), z, seed
layout(location = 1) in vec2 aRank; // order in which strands and LEDs go dark when thinning
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uHeight;
uniform float uFocal;
uniform float uSize;
const float FLOW_WRAP = ${FLOW_WRAP}.0;
uniform float uFlow;  // falling time: integrated, so speed changes never make drops jump; wrapped at FLOW_WRAP
uniform float uRain;  // 0 light rain .. 1 downpour
uniform float uW[11]; // weights of the colour modes, in the order of COLOR_MODES
uniform vec3 uSet[4];  // palette rain: the colours drops pick from
uniform vec3 uAccent;  // accent: the colour of the rare drop
uniform vec3 uNear;    // depth: colour near the eye
uniform vec3 uFar;     // depth: colour far away
uniform float uCloudHue; // colour clouds: base hue
uniform vec3 uSky0;    // sky: colour at the top
uniform vec3 uSky1;    // sky: colour at the bottom
uniform float uFlowRate; // how fast the rain falls now (weather)
uniform vec3 uGrad0;
uniform vec3 uGrad1;
uniform float uTurn;       // 0 rain falls down .. 1 light flows sideways
uniform float uTurnSteps;  // steps the flow turns through on the way
uniform vec2 uFlowDir;  // horizontal direction of that flow
uniform vec2 uLane;     // lane width across the flow, lane height
uniform float uSpan;
uniform float uFogFar;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec4 uRipples[8]; // xyz center, w start time
uniform float uRest;
uniform float uRainGain;
uniform float uTipGain;
uniform float uMaxPx;
uniform float uTrail;
uniform float uBandShift; // how far the colour bands have slid (integrated and wrapped in JS)
uniform float uBandScale;
uniform float uSat;
uniform vec2 uDensity;  // share of strands, share of LEDs per strand, that are on
uniform float uBowStyle; // rainbow: 0 bands, 1 a random hue per drop, 2 per LED
out vec3 vColor;
out float vSize;

float hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
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
  vec3 mono = mix(uColA, uColB, h);
  vec3 grad = mix(uGrad0, uGrad1, 0.5 + 0.5 * sin(phase * 6.2832 * 0.9 * uBandScale));
  vec3 bow = uBowStyle < 0.5 ? bowAt(phase * 0.7 * uBandScale) : vec3(0.0);
  return mono * uW[0] + grad * uW[1] + bow * uW[2];
}

// Colours of the field itself, whatever the flow: drifting clouds of colour,
// near and far, the colour the last wave painted, and the sky.
vec3 placeColor(vec3 pos, float u, float dist) {
  vec3 c = vec3(0.0);
  if (uW[7] > 0.001) {
    vec3 drift = vec3(uTime * 0.35, uTime * 0.04, uTime * 0.18);
    float n = noise3(pos * 0.14 + drift) * 0.7 + noise3(pos * 0.37 - drift * 0.6) * 0.3;
    c += hsv2rgb(vec3(fract(uCloudHue + smoothstep(0.3, 0.7, n) * 0.4), 0.85, 1.0)) * 1.3 * uW[7];
  }
  if (uW[8] > 0.001) c += mix(uNear, uFar, smoothstep(2.5, uFogFar * 0.7, dist)) * uW[8];
  if (uW[9] > 0.001) {
    float last = -1e9;                       // the latest wave that has passed this LED
    for (int i = 0; i < 8; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.w;
      if (age > 0.0 && r.w > last && length(pos - r.xyz) < age * 3.6) last = r.w;
    }
    c += hsv2rgb(vec3(hash(last * 0.731), 0.8, 1.0)) * 1.3 * uW[9];
  }
  if (uW[10] > 0.001) c += mix(uSky0, uSky1, u) * uW[10];
  return c;
}

// The colour a drop keeps as it flows, from its number (sd, cycle).
vec3 dropColor(float sd, float cycle) {
  float r = hash(sd + cycle * 13.37);
  vec3 c = vec3(0.0);
  if (uW[2] > 0.001 && uBowStyle > 0.5 && uBowStyle < 1.5) c += bowAt(r) * uW[2];
  if (uW[3] > 0.001) c += uSet[int(min(r * 4.0, 3.0))] * 1.2 * uW[3];
  if (uW[4] > 0.001) {
    bool rare = hash(sd + cycle * 7.13 + 3.1) < 0.1;
    c += (rare ? uAccent * 2.3 : vec3(0.9, 0.93, 1.0)) * uW[4];
  }
  if (uW[6] > 0.001) {
    // Slow drops glow warm, fast ones blue-white; a downpour turns it all pale.
    float s = clamp(pow(hash(sd + 1.0), 1.5) * 0.8 + (uFlowRate - 1.0) * 0.25, 0.0, 1.0);
    c += (s < 0.5 ? mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.88, 0.7), s * 2.0)
                  : mix(vec3(1.0, 0.88, 0.7), vec3(0.5, 0.78, 1.0), s * 2.0 - 1.0)) * 1.2 * uW[6];
  }
  return c;
}

// One drop runs along a line of LEDs (u: 0 start .. 1 end), then waits past the
// end for the rest of its period. Returns (trail of this drop, tail of the drop
// before it, head brightness, number of this drop) so each drop can have a colour.
vec4 drop(float sd, float u, float trailK) {
  float speed  = mix(0.07, 0.34, pow(hash(sd + 1.0), 1.5));
  float period = mix(1.3, 2.8, hash(sd + 2.0));
  float trail  = mix(0.04, 0.18, hash(sd + 3.0)) * trailK;
  // The falling time wraps every FLOW_WRAP, so each drop runs a whole number of
  // cycles (k) in that time: its rate is rounded to k / FLOW_WRAP cycles per unit.
  float k = round(speed / period * FLOW_WRAP);
  float c = uFlow * (k / FLOW_WRAP) + hash(sd + 4.0);
  float cycle = floor(c);
  float d = fract(c) * period - u;                   // > 0: the LED is behind the head
  float rain = d >= 0.0 ? exp(-d / trail) : exp(d * 120.0);
  return vec4(rain, exp(-(d + period) / trail), exp(-abs(d) * 90.0), mod(cycle, k));
}

// Light gathered from several drops, with each drop's own random hue.
struct Lit { float rain; float tip; vec3 rainCol; vec3 tipCol; };
// Comet: a white head whose trail deepens into the palette colour.
const vec3 HEAD = vec3(1.0, 0.97, 0.92);
void gather(inout Lit L, vec4 r, float sd, float w) {
  vec3 now = dropColor(sd, r.w);
  vec3 before = dropColor(sd, r.w - 1.0);
  vec3 tail = uColA * 1.2 * uW[5];
  L.rain += (r.x + r.y) * w;
  L.tip += r.z * w;
  L.rainCol += ((now + mix(tail, HEAD * uW[5], r.x * r.x)) * r.x + (before + tail) * r.y) * w;
  L.tipCol += (now + HEAD * uW[5]) * r.z * w;
}

// The rain on one strand: two drops at their own pace; in heavy rain two more
// join, one by one across the field, and every trail grows longer.
void strandRain(inout Lit L, float seed, float u, float trailK, float w) {
  float g3 = hash(seed + 6.0) * 0.6;
  float g4 = 0.3 + hash(seed + 7.0) * 0.6;
  gather(L, drop(seed, u, trailK), seed, w);
  gather(L, drop(seed + 17.0, u, trailK), seed + 17.0, w);
  gather(L, drop(seed + 31.0, u, trailK), seed + 31.0, w * smoothstep(g3, g3 + 0.15, uRain));
  gather(L, drop(seed + 53.0, u, trailK), seed + 53.0, w * smoothstep(g4, g4 + 0.15, uRain));
}

// Light flowing at theta from straight down, leaning towards uFlowDir: LEDs in
// one thin tube along that direction light up in turn. Returns the place along
// the tube (0 .. 1), for the colour.
float tiltedRain(inout Lit L, vec3 pos, float theta, float trailK, float w) {
  vec3 hz = vec3(uFlowDir.x, 0.0, uFlowDir.y);
  float st = sin(theta), ct = cos(theta);
  vec3 D = vec3(hz.x * st, -ct, hz.z * st);
  vec3 s1 = vec3(-hz.z, 0.0, hz.x);                  // across the flow, horizontal
  vec3 s2 = cross(D, s1);                            // across the flow, in its vertical plane
  float size2 = uLane.x * ct + uLane.y * st;         // LED spacing along s2
  float lane = floor(dot(pos, s1) / uLane.x) * 7.31 + floor(dot(pos, s2) / size2) * 131.7 + theta * 57.3;
  float len = abs(D.x) * uSpan + abs(D.y) * uHeight + abs(D.z) * uSpan;
  float along = dot(pos, D) / len + 0.5;
  float k = trailK * mix(1.0, 1.5, st);
  gather(L, drop(lane, along, k), lane, w);
  gather(L, drop(lane + 97.0, along, k), lane + 97.0, w * smoothstep(0.2, 0.8, uRain));
  return along;
}

void main() {
  float seed = aData.w;
  float u = aData.y;
  vec3 pos = vec3(aData.x, (0.5 - u) * uHeight, aData.z);
  float h = hash(seed + 5.0);
  float spatial = (pos.x + pos.z) * 0.012;           // bands lean a little across the field
  vec4 mv = uView * vec4(pos, 1.0);
  float dist = -mv.z;
  Lit L = Lit(0.0, 0.0, vec3(0.0), vec3(0.0));

  // The flow turns from straight down to sideways in uTurnSteps steps; each
  // step's lanes cross-fade into the next, so the streaks seem to tilt over.
  float trailK = mix(1.0, 1.7, uRain) * uTrail;
  float t = uTurn * uTurnSteps;
  float k0 = min(floor(t), uTurnSteps);
  float f = t - k0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float k = k0 + float(i);
    float w = i == 0 ? 1.0 - f : f;
    if (w < 0.001 || k > uTurnSteps + 0.5) continue;
    if (k < 0.5) {
      strandRain(L, seed, u, trailK, w);
      col += flowColor(u, spatial, h) * w;
    } else {
      float along = tiltedRain(L, pos, k / uTurnSteps * 1.5707963, trailK, w);
      col += flowColor(along, spatial, h) * w;
    }
  }
  float rain = L.rain;
  float tip = L.tip;
  col += placeColor(pos, u, dist);

  // Colours that travel with each drop. An LED at rest shows one of its own.
  vec3 restDrop = dropColor(seed * 0.37 + u * 91.7, 0.0) + uColA * 1.2 * uW[5];
  vec3 rainCol = col + (rain > 1e-4 ? L.rainCol / rain : restDrop);
  vec3 tipCol = col + (tip > 1e-4 ? L.tipCol / tip : restDrop);
  vec3 restCol = col + restDrop;
  // The rainbow per LED: each LED has its own hue, shown as the light passes.
  if (uBowStyle > 1.5) {
    vec3 led = bowAt(hash(seed * 0.37 + u * 91.7)) * uW[2];
    rainCol += led; tipCol += led; restCol += led;
  }

  // Spherical waves of light.
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.w;
    if (age < 0.0 || age > 7.0) continue;
    float x = length(pos - r.xyz) - age * 3.6;
    float fade = 1.0 - age / 7.0;
    ring += exp(-x * x * 1.8) * fade * fade;
  }

  // Heads turn white in most modes; in the colourful ones they keep their colour.
  const float WHITE[11] = float[11](0.75, 0.75, 0.15, 0.2, 0.3, 0.0, 0.3, 0.35, 0.5, 0.3, 0.5);
  float white = 0.0;
  for (int i = 0; i < 11; i++) white += WHITE[i] * uW[i];
  vec3 c = restCol * uRest + rainCol * rain * uRainGain
         + mix(tipCol, vec3(1.0), white) * tip * uTipGain
         + mix(restCol, vec3(1.0), 0.35) * ring * 1.6;

  float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, dist);
  c *= fog;

  // Thinning: LEDs past the shown share fade out, in an order that leaves the
  // rest evenly spread, so density can change smoothly.
  vec2 on = clamp((uDensity * 1.04 - aRank) / 0.04, 0.0, 1.0);
  c *= on.x * on.y;

  // LEDs right at the eye are skipped: as opaque squares they would block the view.
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
  float shown = clamp(px, 1.5, max(1.5, uMaxPx));
  c *= min(1.0, px / shown);
  gl_Position = uProj * mv;
  gl_PointSize = shown;
  vSize = shown;
  vColor = c;
}`;

export const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vSize;
uniform float uGain; // 1 with float buffers (the composite pass applies exposure); else exposure and breath
out vec4 outColor;
void main() {
  // An opaque round LED. Its rim pixel is darkened rather than blended,
  // so the depth test can still let near LEDs hide far ones.
  // LEDs of a few pixels are drawn whole: a disc that small is only a dot.
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float edge = vSize < 3.5 ? 1.0 : 1.0 - smoothstep(1.0 - 2.0 / vSize, 1.0, r);
  if (edge <= 0.15) discard;
  float a = edge * (0.85 + 0.15 * (1.0 - r * r));   // slightly brighter centre
  outColor = vec4(vColor * a * uGain, 1.0);
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
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  outColor = vec4(c * 0.25, 1.0);
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
uniform sampler2D uBloom;
uniform float uBloomK;
uniform float uExposure;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomK;
  c = vec3(1.0) - exp(-c * uExposure);                       // tone map
  float v = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.5);
  c *= mix(0.55, 1.0, v);                               // vignette
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;           // dither against banding
  outColor = vec4(c, 1.0);
}`;
