// Rain of Light: a lattice of light points with drops of light falling through it.
// Plain WebGL2, no dependencies. Points are drawn additively into a half-float
// buffer, then blurred for bloom and tone-mapped onto the screen.

import { createTuner, loadSettings } from './tuner.js';
import { createAudio } from './audio.js';
import { createSway } from './sway.js';

// Show any error on the page, so a black screen is never silent.
function showError(msg) {
  const el = document.getElementById('fallback');
  el.textContent = String(msg);
  el.style.whiteSpace = 'pre-wrap';
  el.style.fontSize = '13px';
  el.hidden = false;
}
addEventListener('error', (e) => showError(e.message || e.error));
addEventListener('unhandledrejection', (e) => showError(e.reason));

const canvas = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const gl = canvas.getContext('webgl2', {
  antialias: false,
  alpha: false,
  depth: true, // used when float buffers are missing
  powerPreference: 'high-performance',
});

if (!gl) {
  document.getElementById('fallback').hidden = false;
  throw new Error('WebGL2 not available');
}

const hasFloat = !!gl.getExtension('EXT_color_buffer_float');

// ---------- fixed settings (also ?dpr=1.5) ----------
const params = new URLSearchParams(location.search);
const small = Math.min(innerWidth, innerHeight) < 700;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_DPR = Number(params.get('dpr')) || 2;
const SPAN = 22;    // width and depth of the lattice
const HEIGHT = 15;  // height of the lattice
const SPEED = reducedMotion ? 0.4 : 1.0;

const PALETTES = [
  { name: 'ice',      a: [0.45, 0.70, 1.00], b: [0.95, 0.97, 1.00] },
  { name: 'amber',    a: [1.00, 0.50, 0.12], b: [1.00, 0.82, 0.50] },
  { name: 'sakura',   a: [1.00, 0.30, 0.65], b: [0.65, 0.40, 1.00] },
  { name: 'aurora',   a: [0.15, 1.00, 0.65], b: [0.35, 0.75, 1.00] },
  { name: 'deep sea', a: [0.10, 0.35, 1.00], b: [0.30, 0.95, 1.00] },
  { name: 'candle',   a: [1.00, 0.85, 0.55], b: [1.00, 1.00, 0.95] },
];

// Weather: how fast the drops fall (flow) and how many extra drops join (rain).
const WEATHER = [
  { name: 'drizzle',  flow: 0.6, rain: 0.0,  hold: [10, 18], weight: 2 },
  { name: 'rain',     flow: 1.0, rain: 0.25, hold: [12, 22], weight: 3 },
  { name: 'shower',   flow: 1.9, rain: 0.6,  hold: [8, 14],  weight: 2 },
  { name: 'downpour', flow: 3.6, rain: 1.0,  hold: [6, 12],  weight: 1.5 },
];
// Direction: rain falls from above, or now and then flows sideways, each time a new way.
const FLOWS = [
  { name: 'down',   toward: 0, hold: [20, 40], weight: 3 },
  { name: 'across', toward: 1, hold: [20, 40], weight: 1 },
];
// Colour modes. Their order is the order of the weights uW in the shader.
const COLOR_MODES = [
  { name: 'mono',     hold: [14, 26], weight: 3 },   // one palette
  { name: 'gradient', hold: [14, 24], weight: 2 },   // two palettes, flowing
  { name: 'rainbow',  hold: [10, 18], weight: 1.5 }, // a random hue per drop
  { name: 'palette',  hold: [14, 24], weight: 2 },   // each drop picks from a set of colours
  { name: 'accent',   hold: [14, 24], weight: 1.5 }, // white rain, now and then a coloured drop
  { name: 'comet',    hold: [12, 20], weight: 1.5 }, // white heads, coloured trails
  { name: 'speed',    hold: [12, 20], weight: 1 },   // slow drops warm, fast ones blue-white
  { name: 'cloud',    hold: [16, 28], weight: 2 },   // drifting clouds of colour
  { name: 'depth',    hold: [12, 20], weight: 1 },   // one colour near, another far
  { name: 'repaint',  hold: [20, 32], weight: 1.2 }, // each wave paints the field anew
  { name: 'sky',      hold: [45, 75], weight: 1 },   // dawn, day, dusk and night go by
];
COLOR_MODES.forEach((m, i) => { m.mode = COLOR_MODES.map((_, k) => (k === i ? 1 : 0)); });
const MODE = Object.fromEntries(COLOR_MODES.map((m, i) => [m.name, i]));

// Sets of colours for the palette rain.
const SETS = [
  { name: 'pastel', c: [[1.0, 0.62, 0.75], [0.62, 0.85, 1.0], [0.72, 1.0, 0.72], [1.0, 0.92, 0.6]] },
  { name: 'neon',   c: [[1.0, 0.1, 0.6], [0.1, 0.9, 1.0], [0.7, 1.0, 0.1], [0.6, 0.2, 1.0]] },
  { name: 'wa',     c: [[0.93, 0.25, 0.15], [0.15, 0.3, 0.85], [1.0, 0.72, 0.1], [0.45, 0.8, 0.35]] },
  { name: 'sunset', c: [[1.0, 0.35, 0.1], [1.0, 0.62, 0.2], [0.9, 0.2, 0.45], [0.55, 0.25, 0.9]] },
  { name: 'ocean',  c: [[0.1, 0.4, 1.0], [0.2, 0.9, 0.9], [0.6, 0.9, 1.0], [0.15, 0.95, 0.6]] },
];
const ACCENTS = [[1.0, 0.68, 0.12], [1.0, 0.15, 0.1], [0.1, 0.85, 1.0], [1.0, 0.2, 0.8], [0.4, 1.0, 0.3]];
const DEPTHS = [                                       // near, far
  [[1.0, 0.55, 0.15], [0.1, 0.3, 1.0]],
  [[1.0, 0.35, 0.55], [0.1, 0.85, 0.8]],
  [[1.0, 0.85, 0.3], [0.55, 0.2, 1.0]],
  [[0.3, 1.0, 0.6], [0.2, 0.35, 1.0]],
];
// The sky through one day: colour at the top, colour at the bottom.
const SKY = [
  [[0.35, 0.35, 0.95], [1.0, 0.55, 0.45]],  // dawn
  [[0.45, 0.75, 1.0], [0.92, 0.96, 1.0]],   // day
  [[0.6, 0.25, 0.85], [1.0, 0.45, 0.12]],   // dusk
  [[0.08, 0.15, 0.65], [0.35, 0.45, 0.95]], // night
];

// ---------- tunable settings (panel: p key or the gear button; also ?key=value) ----------
const DEFAULTS = {
  grid: small ? 36 : 60,  rows: small ? 72 : 96,
  layout: 'strands', density: 'auto', strandShare: 1.0, rowShare: 1.0, strandMin: 0.3, rowMin: 0.35,
  size: 0.013, maxPx: 4.5, rest: 0.025,
  rainGain: 4.0, tipGain: 5.0, exposure: 1.5, bloom: 0.4, fog: 22,
  speed: 1.0, trail: 1.0, weather: 'auto', turnTime: 8, turnSteps: 9,
  color: 'auto', palette: 'auto', rainbow: 'drop', bandSpeed: 0.17, bandScale: 1.0, saturation: 1.0,
  set: 'auto', skyDay: 90,
  flow: 'auto',
  camera: 'orbit', orbit: 0.025, radius: 7.5, fov: 60,
  ripples: 12,
  breath: 'on', breathRate: 6, breathDepth: 0.3, timer: 'off',
  volume: 0.8, music: 0.6, chimes: 0.6, rainSound: 0.3,
};
// Older links used ?color=, ?weather= and ?flow= the same way, so they still work.
const STORAGE_KEY = 'rain-of-light:settings';
const S = loadSettings(DEFAULTS, STORAGE_KEY, params);
S.timer = 'off'; // a timer runs only when started, never on its own after a reload

const SCHEMA = [
  { title: 'Density', items: [
    { key: 'grid', label: 'Strands per side (max)', min: 8, max: 160, step: 1 },
    { key: 'rows', label: 'LEDs per strand (max)', min: 8, max: 256, step: 1 },
    { key: 'layout', label: 'Layout', options: ['strands', 'scatter'],
      hint: 'strands: in lines along each strand / scatter: at random within one strand\'s width' },
    { key: 'density', label: 'Density change', options: ['auto', 'manual'],
      hint: 'auto: drifts slowly between the lower limits and full / manual: held at the shares below' },
    { key: 'strandShare', label: 'Share of strands (manual)', min: 0.02, max: 1, step: 0.01 },
    { key: 'rowShare', label: 'Share of LEDs (manual)', min: 0.02, max: 1, step: 0.01 },
    { key: 'strandMin', label: 'Lowest share of strands (auto)', min: 0.02, max: 1, step: 0.01 },
    { key: 'rowMin', label: 'Lowest share of LEDs (auto)', min: 0.02, max: 1, step: 0.01 },
  ] },
  { title: 'LED', items: [
    { key: 'size', label: 'LED size', min: 0.004, max: 0.05, step: 0.001 },
    { key: 'maxPx', label: 'Largest size (px)', min: 1.5, max: 16, step: 0.5 },
    { key: 'rest', label: 'Brightness at rest', min: 0, max: 0.1, step: 0.001 },
  ] },
  { title: 'Light', items: [
    { key: 'rainGain', label: 'Trail brightness', min: 0, max: 12, step: 0.1 },
    { key: 'tipGain', label: 'Head brightness', min: 0, max: 15, step: 0.1 },
    { key: 'exposure', label: 'Exposure', min: 0.2, max: 4, step: 0.05 },
    { key: 'bloom', label: 'Glow', min: 0, max: 2, step: 0.05 },
    { key: 'fog', label: 'Visible distance', min: 6, max: 40, step: 0.5 },
  ] },
  { title: 'Rain', items: [
    { key: 'weather', label: 'Weather', options: ['auto', 'drizzle', 'rain', 'shower', 'downpour'] },
    { key: 'speed', label: 'Speed (x)', min: 0, max: 4, step: 0.05 },
    { key: 'trail', label: 'Trail length (x)', min: 0.2, max: 4, step: 0.05 },
    { key: 'flow', label: 'Direction', options: ['auto', 'down', 'across'],
      hint: 'down: from above / across: sideways (a random way each time)' },
    { key: 'turnTime', label: 'Turn time (s)', min: 1, max: 30, step: 0.5 },
    { key: 'turnSteps', label: 'Turn steps (1: cross-fade)', min: 1, max: 18, step: 1 },
  ] },
  { title: 'Colour', items: [
    { key: 'color', label: 'Colour mode', options: ['auto', ...COLOR_MODES.map((m) => m.name)],
      hint: 'mono: one palette / gradient: flowing gradient / rainbow: a hue per drop / '
        + 'palette: each drop picks from a set / accent: white rain, now and then a coloured drop / '
        + 'comet: white heads, coloured trails / speed: colour by speed / cloud: drifting clouds of colour / '
        + 'depth: near and far / repaint: waves repaint the field / sky: a day goes by' },
    { key: 'rainbow', label: 'Rainbow style', options: ['drop', 'led', 'bands'],
      hint: 'drop: a random hue per drop / led: a random hue per LED / bands: flowing bands' },
    { key: 'palette', label: 'Palette', options: ['auto', ...PALETTES.map((p) => p.name)] },
    { key: 'bandSpeed', label: 'Band speed', min: 0, max: 0.8, step: 0.01 },
    { key: 'bandScale', label: 'Band scale', min: 0.1, max: 4, step: 0.05 },
    { key: 'saturation', label: 'Saturation (rainbow)', min: 0, max: 1, step: 0.01 },
    { key: 'set', label: 'Colour set (palette)', options: ['auto', ...SETS.map((x) => x.name)] },
    { key: 'skyDay', label: 'Length of a day (s, sky)', min: 20, max: 600, step: 5 },
  ] },
  { title: 'Camera', items: [
    { key: 'camera', label: 'Move', options: ['auto', 'orbit', 'walk', 'spin', 'gaze', 'rise'],
      hint: 'orbit: circle the field / walk: wander through it / spin: look around from the centre / gaze: look up and down / rise: drift up and down' },
    { key: 'orbit', label: 'Move speed', min: 0, max: 0.2, step: 0.005 },
    { key: 'radius', label: 'Distance from the centre', min: 0, max: 10, step: 0.1 },
    { key: 'fov', label: 'Field of view (deg)', min: 30, max: 110, step: 1 },
  ] },
  { title: 'Ripples', items: [
    { key: 'ripples', label: 'Auto interval, about (s, 0: none)', min: 0, max: 30, step: 0.5 },
  ] },
  { title: 'Meditation', items: [
    { key: 'breath', label: 'Breathing guide', options: ['on', 'off'],
      hint: 'The light and the pad swell as you breathe in (4 parts) and fade as you breathe out (6 parts)' },
    { key: 'breathRate', label: 'Breaths per minute', min: 3, max: 12, step: 0.5 },
    { key: 'breathDepth', label: 'Depth of the swell', min: 0, max: 0.8, step: 0.05 },
    { key: 'timer', label: 'Timer (min)', options: ['off', '5', '10', '20', '30'],
      hint: 'Starts at once with a bell; at the end three bells ring and light and sound fade out. Click to come back.' },
  ] },
  { title: 'Sound (m key or the note button)', items: [
    { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },
    { key: 'music', label: 'Pad', min: 0, max: 1, step: 0.05 },
    { key: 'chimes', label: 'Bells', min: 0, max: 1, step: 0.05 },
    { key: 'rainSound', label: 'Rain', min: 0, max: 1, step: 0.05 },
  ] },
];
// A saved or linked choice that no longer exists falls back to its default.
for (const item of SCHEMA.flatMap((g) => g.items)) {
  if (item.options && !item.options.includes(S[item.key])) S[item.key] = DEFAULTS[item.key];
}
const fovRad = () => S.fov * Math.PI / 180;

// ---------- shaders ----------
const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aData; // x, u (0 top .. 1 bottom), z, seed
layout(location = 1) in vec2 aRank; // order in which strands and LEDs go dark when thinning
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uHeight;
uniform float uFocal;
uniform float uSize;
uniform float uFlow;  // falling time: integrated, so speed changes never make drops jump
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
uniform float uBandSpeed;
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
  float phase = along - uFlow * uBandSpeed + spatial;
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
  float x = uFlow * speed + hash(sd + 4.0) * period;
  float cycle = floor(x / period);
  float d = x - cycle * period - u;                  // > 0: the LED is behind the head
  float rain = d >= 0.0 ? exp(-d / trail) : exp(d * 120.0);
  return vec4(rain, exp(-(d + period) / trail), exp(-abs(d) * 90.0), cycle);
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

const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vSize;
out vec4 outColor;
void main() {
  // An opaque round LED. Its rim pixel is darkened rather than blended,
  // so the depth test can still let near LEDs hide far ones.
  // LEDs of a few pixels are drawn whole: a disc that small is only a dot.
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float edge = vSize < 3.5 ? 1.0 : 1.0 - smoothstep(1.0 - 2.0 / vSize, 1.0, r);
  if (edge <= 0.15) discard;
  float a = edge * (0.85 + 0.15 * (1.0 - r * r));   // slightly brighter centre
  outColor = vec4(vColor * a, 1.0);
}`;

const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const DOWN_FS = `#version 300 es
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

const BLUR_FS = `#version 300 es
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

const COMPOSITE_FS = `#version 300 es
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

// ---------- GL helpers ----------
function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function target(w, h, withDepth = false) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let depth = null;
  if (withDepth) {
    depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  return { tex, fb, depth, w, h };
}

function freeTarget(t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
  if (t.depth) gl.deleteRenderbuffer(t.depth);
}

// ---------- vector math (column-major 4x4) ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye, at, up) {
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

// ---------- the lattice ----------
const pointProg = program(POINT_VS, POINT_FS);
const downProg = program(QUAD_VS, DOWN_FS);
const blurProg = program(QUAD_VS, BLUR_FS);
const compProg = program(QUAD_VS, COMPOSITE_FS);

const pointVao = gl.createVertexArray();
const pointBuf = gl.createBuffer();
gl.bindVertexArray(pointVao);
gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
const rankBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, rankBuf);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// Ranks in 0..1 for thinning. Along a strand, bit reversal: every prefix is
// spread evenly. Each strand starts that order at its own row, and strands
// get random ranks: an order shared by all strands (or a Bayer matrix across
// them) put the dark LEDs at the same heights or in the same rows of strands,
// which showed as straight dark lines across the view.
const bitsFor = (n) => Math.max(1, Math.ceil(Math.log2(n)));
function bitReverse(n, bits) {
  let v = 0;
  for (let b = 0; b < bits; b++) v = (v << 1) | ((n >> b) & 1);
  return v;
}
let count = 0, GRID = 0, ROWS = 0;

function buildLattice() {
  GRID = Math.max(2, Math.round(S.grid));
  ROWS = Math.max(2, Math.round(S.rows));
  count = GRID * GRID * ROWS;
  const data = new Float32Array(count * 4);
  const rank = new Float32Array(count * 2);
  const step = SPAN / (GRID - 1);
  const rb = bitsFor(ROWS);
  // Rank only among the rows in use, so shares map evenly onto 0..1.
  const rowOrder = [];
  for (let r = 0; r < ROWS; r++) rowOrder.push([bitReverse(r, rb), r]);
  rowOrder.sort((a, b) => a[0] - b[0]);
  const rowRank = new Float32Array(ROWS);
  rowOrder.forEach(([, r], n) => { rowRank[r] = (n + 0.5) / ROWS; });
  let k = 0, q = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      // Jitter each strand, and shift its LEDs by up to one row, so that rows
      // and columns never line up into dark lines across the view.
      const x = -SPAN / 2 + i * step + (Math.random() - 0.5) * step;
      const z = -SPAN / 2 + j * step + (Math.random() - 0.5) * step;
      const shift = Math.random();
      const seed = Math.random() * 1000;
      const strandRank = Math.random();
      const rowStart = Math.floor(Math.random() * ROWS);
      // Scattered: every LED at a random place in its strand's cell, so no lines
      // show at all; the rain still falls down through each cell.
      const scatter = S.layout === 'scatter';
      for (let r = 0; r < ROWS; r++) {
        data[k++] = scatter ? x + (Math.random() - 0.5) * step : x;
        data[k++] = scatter ? Math.random() : (r + shift) / ROWS;
        data[k++] = scatter ? z + (Math.random() - 0.5) * step : z;
        data[k++] = seed;
        rank[q++] = strandRank;
        rank[q++] = rowRank[(r + rowStart) % ROWS];
      }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, rankBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rank, gl.STATIC_DRAW);
}
buildLattice();
const emptyVao = gl.createVertexArray();

// ---------- render targets ----------
let W = 0, H = 0, scene = null, bloomA = null, bloomB = null;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (w === W && h === H) return;
  W = canvas.width = w;
  H = canvas.height = h;
  if (hasFloat) {
    freeTarget(scene); freeTarget(bloomA); freeTarget(bloomB);
    scene = target(W, H, true);
    const bw = Math.max(1, W >> 2), bh = Math.max(1, H >> 2);
    bloomA = target(bw, bh);
    bloomB = target(bw, bh);
  }
}

// ---------- interaction ----------
const ripples = new Float32Array(8 * 4).fill(-1e4);
let rippleIndex = 0;
function addRipple(x, y, z, t) {
  ripples.set([x, y, z, t], rippleIndex * 4);
  rippleIndex = (rippleIndex + 1) % 8;
  // Every wave rings a bell, from the side where it is seen.
  const pan = camera ? dot([x - camera.eye[0], y - camera.eye[1], z - camera.eye[2]], camera.r) / 6 : 0;
  sound.ripple(pan);
}

// ---------- sound: off until asked for; once turned on, it starts again with the first click ----------
const SOUND_KEY = 'rain-of-light:sound';
const sound = createAudio({ settings: S });
const soundBtn = document.createElement('button');
soundBtn.className = 'sound-toggle';
soundBtn.type = 'button';
soundBtn.title = 'Sound (m)';
soundBtn.setAttribute('aria-label', 'Sound');
soundBtn.textContent = '♪';
// The volume bar beside the note button; it is the panel's Volume too.
const volumeBar = document.createElement('input');
volumeBar.className = 'volume-bar';
volumeBar.type = 'range';
volumeBar.min = 0;
volumeBar.max = 1;
volumeBar.step = 0.01;
volumeBar.value = S.volume;
volumeBar.title = 'Volume';
volumeBar.setAttribute('aria-label', 'Volume');
volumeBar.addEventListener('input', () => {
  tuner.set('volume', Number(volumeBar.value));
  tuner.refresh();
  if (!sound.on && Number(volumeBar.value) > 0) setSound(true); // turning it up turns it on
});
document.body.append(volumeBar, soundBtn);
function setSound(want) {
  if (want) sound.start(); else sound.stop();
  soundBtn.classList.toggle('active', sound.on);
  volumeBar.classList.toggle('active', sound.on);
  try { localStorage.setItem(SOUND_KEY, sound.on ? '1' : '0'); } catch { /* storage blocked */ }
}
soundBtn.addEventListener('click', () => setSound(!sound.on));
let soundWanted = false;
try { soundWanted = localStorage.getItem(SOUND_KEY) === '1'; } catch { /* storage blocked */ }
if (soundWanted) {
  const resume = (e) => {
    removeEventListener('pointerdown', resume, true);
    removeEventListener('keydown', resume, true);
    if (e.target !== soundBtn && e.target !== volumeBar && e.key !== 'm' && !sound.on) setSound(true);
  };
  addEventListener('pointerdown', resume, true);
  addEventListener('keydown', resume, true);
}

const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
let camera = null; // last eye and basis, for picking

// Hide the cursor (and the gear button) after a few still seconds.
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
}
wake();

addEventListener('pointermove', (e) => {
  pointer.x = e.clientX / innerWidth - 0.5;
  pointer.y = e.clientY / innerHeight - 0.5;
  wake();
});
addEventListener('pointerdown', wake);

// ---------- breath and timer ----------
let breathPhase = 0;                 // 0 .. 1 through one breath
const INHALE = 0.4;                  // breathing in takes 4 parts of 10
function breathAt(dt) {
  breathPhase = (breathPhase + dt * S.breathRate / 60) % 1;
  const p = breathPhase;
  return p < INHALE ? 0.5 - 0.5 * Math.cos(Math.PI * p / INHALE)       // in: rise
    : 0.5 + 0.5 * Math.cos(Math.PI * (p - INHALE) / (1 - INHALE));    // out: fall
}

let timerEnd = Infinity, timerBells = [], fadeAt = Infinity, fadeGoal = 1, fade = 1, ended = false;
function bellAhead() {             // a wave (and its bell) straight ahead
  if (!camera) return;
  const { eye, f } = camera;
  addRipple(eye[0] + f[0] * 7, eye[1] + f[1] * 7, eye[2] + f[2] * 7, time);
}
function startTimer(minutes) {
  timerEnd = time + minutes * 60;
  timerBells = [time + 0.5];
  fadeAt = Infinity; fadeGoal = 1; ended = false;
}
function stopTimer() {
  timerEnd = Infinity; timerBells = []; fadeAt = Infinity; fadeGoal = 1; ended = false;
}
function timerStep(dt) {
  if (time > timerEnd) {           // the end: three bells, then fade out
    timerEnd = Infinity;
    timerBells = [time, time + 4, time + 8];
    fadeAt = time + 10;
  }
  while (timerBells.length && time >= timerBells[0]) { timerBells.shift(); bellAhead(); }
  if (time > fadeAt) { fadeAt = Infinity; fadeGoal = 0; ended = true; }
  fade += (fadeGoal - fade) * (1 - Math.exp(-dt / (fadeGoal ? 2 : 6)));
}
// After the end, a click (or a key) brings light and sound back.
function comeBack() {
  if (!ended) return;
  stopTimer();
  tuner.set('timer', 'off');
  tuner.refresh();
}
addEventListener('pointerdown', comeBack);
addEventListener('keydown', comeBack);

canvas.addEventListener('pointerdown', (e) => {
  hideOverlay();
  if (!camera) return;
  const nx = (e.clientX / innerWidth) * 2 - 1;
  const ny = 1 - (e.clientY / innerHeight) * 2;
  const th = Math.tan(fovRad() / 2);
  const { eye, f, r, u, aspect } = camera;
  const dir = norm([
    f[0] + r[0] * nx * th * aspect + u[0] * ny * th,
    f[1] + r[1] * nx * th * aspect + u[1] * ny * th,
    f[2] + r[2] * nx * th * aspect + u[2] * ny * th,
  ]);
  const D = 7;
  addRipple(eye[0] + dir[0] * D, eye[1] + dir[1] * D, eye[2] + dir[2] * D, time);
});

addEventListener('keydown', (e) => {
  if (e.key === 'p') tuner.toggle();             // settings panel
  if (e.key === 'w') step('weather', WEATHER);   // next weather
  if (e.key === 'c') step('color', COLOR_MODES); // next colour
  if (e.key === 'd') step('flow', FLOWS);        // switch direction
  if (e.key === 'v') step('camera', CAMERAS);    // next camera move
  if (e.key === 'm') setSound(!sound.on);        // sound on and off
});
// A key moves on at random while the setting is auto, else to the next choice.
function step(key, list) {
  if (S[key] === 'auto') { apply(key); return; }
  const i = list.findIndex((x) => x.name === S[key]);
  tuner.set(key, list[(i + 1) % list.length].name);
  tuner.refresh();
}

let overlayTimer = setTimeout(hideOverlay, 7000);
function hideOverlay() {
  clearTimeout(overlayTimer);
  overlay.classList.add('hidden');
}

let time = Number(params.get('t')) || 0;
let nextAuto = 2;   // the next automatic wave
const rippleGap = createSway({ fastest: 1, octaves: 5 }); // per wave: how long until the next
let look = null;    // the look now, easing towards the goal (set up below)

// ---------- director: weather and colour change on their own ----------
const rand = (a, b) => a + Math.random() * (b - a);
function pick(list, current, name) {
  const forced = name && list.find((x) => x.name === name);
  if (forced) return forced;
  const options = list.filter((x) => x !== current);
  let r = Math.random() * options.reduce((n, x) => n + x.weight, 0);
  for (const x of options) if ((r -= x.weight) <= 0) return x;
  return options[options.length - 1];
}
const pickPalette = (not) => {
  const options = PALETTES.filter((p) => p !== not);
  return options[Math.floor(Math.random() * options.length)];
};

let weather = null, weatherUntil = 0;
let colorMode = null, colorUntil = 0;
let flowMode = null, flowUntil = 0;
const densityGoal = [1, 1];
let densityUntil = 0;
let flowDir = [0, 1];
// Turning between falling (0) and sideways (1): from, to, progress 0..1, now.
let turnFrom = 0, turnTo = 0, turnP = 1, turnNow = 0;
const goal = {
  mode: COLOR_MODES[0].mode, a: PALETTES[0].a, b: PALETTES[0].b, g0: PALETTES[0].a, g1: PALETTES[1].b,
  s0: SETS[0].c[0], s1: SETS[0].c[1], s2: SETS[0].c[2], s3: SETS[0].c[3],
  acc: ACCENTS[0], near: DEPTHS[0][0], far: DEPTHS[0][1], cloud: [0, 0, 0],
};
// Colours that belong to one mode; they change at once while that mode is unseen.
const OWN = { s0: 'palette', s1: 'palette', s2: 'palette', s3: 'palette', acc: 'accent',
  near: 'depth', far: 'depth', cloud: 'cloud' };
const EASED = Object.keys(goal);
const pickOf = (list) => list[Math.floor(Math.random() * list.length)];

// A setting other than auto holds its choice until it is changed.
const forced = (key) => (S[key] === 'auto' ? undefined : S[key]);
function nextWeather(now) {
  weather = pick(WEATHER, weather, forced('weather'));
  weatherUntil = forced('weather') ? Infinity : now + rand(...weather.hold);
}
function nextFlow(now) {
  flowMode = pick(FLOWS, flowMode, forced('flow'));
  flowUntil = forced('flow') ? Infinity : now + rand(...flowMode.hold);
  // A new horizontal direction for each sideways episode, picked while the
  // rain still falls straight down, so the turn never swings round.
  if (flowMode.toward && turnNow < 0.01) {
    const a = Math.random() * Math.PI * 2;
    flowDir = [Math.cos(a), Math.sin(a)];
  }
  if (flowMode.toward !== turnTo) {
    turnFrom = turnNow;
    turnTo = flowMode.toward;
    turnP = 0;
  }
}
// Camera moves. All run on one clock, so any blend of them moves smoothly.
const CAMERAS = [
  { name: 'orbit', hold: [30, 50], weight: 3 },
  { name: 'walk',  hold: [25, 40], weight: 2 },
  { name: 'spin',  hold: [20, 35], weight: 1.5 },
  { name: 'gaze',  hold: [20, 30], weight: 1 },
  { name: 'rise',  hold: [25, 40], weight: 1.5 },
];
const CAMERA_BLEND = 8; // seconds to turn one move into the next
const smooth = (x) => x * x * (3 - 2 * x);
let camMode = CAMERAS[0], camUntil = 0, camClock = 0, camBlend = 1;
const camW = CAMERAS.map((c) => (c === camMode ? 1 : 0));
let camFrom = [...camW];
let lastDir = [0, 0, -1];

function nextCamera(now) {
  camMode = pick(CAMERAS, camMode, forced('camera'));
  camUntil = forced('camera') ? Infinity : now + rand(...camMode.hold);
  camFrom = [...camW];
  camBlend = 0;
}

// Where one move puts the eye at clock t, and which way it looks.
function cameraPose(name, t, R, bob) {
  const a = t * 0.025;                                   // orbit angle
  const inward = [-Math.sin(a), 0, -Math.cos(a)];        // towards the centre
  const onOrbit = (y) => [Math.sin(a) * R, y, Math.cos(a) * R];
  switch (name) {
    case 'walk': {                                       // a slow figure through the lattice
      const x = 7 * Math.sin(t * 0.031), z = 7 * Math.sin(t * 0.023 + 1.0);
      const dx = Math.cos(t * 0.031) * 0.031, dz = Math.cos(t * 0.023 + 1.0) * 0.023;
      return { eye: [x, bob, z], dir: norm([dx, 0, dz]) };
    }
    case 'spin': {                                       // stand at the centre, look around
      const b = t * 0.04;
      return { eye: [0, bob, 0], dir: [Math.sin(b), 0, Math.cos(b)] };
    }
    case 'gaze': {                                       // look up into the rain, then down
      const p = 0.6 * Math.sin(t * 0.08);
      return { eye: onOrbit(bob), dir: [inward[0] * Math.cos(p), Math.sin(p), inward[2] * Math.cos(p)] };
    }
    case 'rise':                                         // drift up and down through the lattice
      return { eye: onOrbit(Math.sin(t * 0.035) * 5.5), dir: inward };
    default:                                             // orbit
      return { eye: onOrbit(bob), dir: inward };
  }
}

// Density wanders between its lower limits and full, or holds the manual shares.
function nextDensity(now) {
  if (S.density === 'manual') {
    densityGoal[0] = S.strandShare;
    densityGoal[1] = S.rowShare;
    densityUntil = Infinity;
    return;
  }
  densityGoal[0] = rand(Math.min(1, S.strandMin), 1);
  densityGoal[1] = rand(Math.min(1, S.rowMin), 1);
  densityUntil = now + rand(15, 30);
}
function nextColor(now) {
  colorMode = pick(COLOR_MODES, colorMode, forced('color'));
  colorUntil = forced('color') ? Infinity : now + rand(...colorMode.hold);
  const p = PALETTES.find((x) => x.name === S.palette) || pickPalette();
  const q = pickPalette(p);
  const set = SETS.find((x) => x.name === S.set) || pickOf(SETS);
  const depth = pickOf(DEPTHS);
  Object.assign(goal, {
    mode: colorMode.mode, a: p.a, b: p.b, g0: p.a, g1: q.b,
    s0: set.c[0], s1: set.c[1], s2: set.c[2], s3: set.c[3],
    acc: pickOf(ACCENTS), near: depth[0], far: depth[1], cloud: [Math.random(), 0, 0],
  });
  if (!look) return;
  for (const [key, mode] of Object.entries(OWN)) {
    if (look.mode[MODE[mode]] < 0.05) look[key] = [...goal[key]];
  }
  if (colorMode.name === 'repaint') nextAuto = Math.min(nextAuto, now + 1.5); // a first wave soon
}

// The sky's colours at this moment of its day.
let skyClock = Math.random();
function skyColors() {
  const x = skyClock * SKY.length;
  const i = Math.floor(x) % SKY.length, j = (i + 1) % SKY.length, k = smooth(x - Math.floor(x));
  const lerp = (a, b) => a.map((v, n) => v + (b[n] - v) * k);
  return [lerp(SKY[i][0], SKY[j][0]), lerp(SKY[i][1], SKY[j][1])];
}

// Start with light rain falling in a rainbow, unless a setting says otherwise.
weather = WEATHER[1]; colorMode = COLOR_MODES[MODE.rainbow]; flowMode = FLOWS[0];
if (forced('weather')) nextWeather(0); else weatherUntil = rand(...weather.hold);
if (forced('flow')) nextFlow(0); else flowUntil = rand(...flowMode.hold);
if (forced('color') || forced('palette')) nextColor(0);
else {
  colorUntil = rand(...colorMode.hold);
  Object.assign(goal, { mode: colorMode.mode });
}

// What a change in the panel does at once.
let rebuildTimer = 0;
function apply(key) {
  if (key === 'grid' || key === 'rows' || key === 'layout') {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildLattice, 250); // wait for the slider to settle
  }
  if (key === 'volume') { sound.volume(); volumeBar.value = S.volume; }
  if (key === 'timer') { if (S.timer === 'off') stopTimer(); else startTimer(Number(S.timer)); }
  if (key === 'weather') nextWeather(time);
  if (key === 'flow') nextFlow(time);
  if (key === 'camera') nextCamera(time);
  if (['density', 'strandShare', 'rowShare', 'strandMin', 'rowMin'].includes(key)) nextDensity(time);
  if (key === 'color' || key === 'palette' || key === 'set') nextColor(time);
}
if (S.density === 'manual') nextDensity(0); else densityUntil = rand(12, 20);
if (forced('camera')) {
  nextCamera(0);
  camW.fill(0); camW[CAMERAS.indexOf(camMode)] = 1; camFrom = [...camW]; camBlend = 1;
} else camUntil = rand(...CAMERAS[0].hold);

const tuner = createTuner({
  schema: SCHEMA, settings: S, defaults: DEFAULTS, storageKey: STORAGE_KEY,
  onChange: (key) => apply(key),
});
look = {
  flow: Number(params.get('t')) || 0,
  flowRate: weather.flow, rain: weather.rain,
  density: [S.density === 'manual' ? S.strandShare : 1, S.density === 'manual' ? S.rowShare : 1],
};
for (const key of EASED) look[key] = [...goal[key]];

// The rain swells and eases within its weather, with 1/f fluctuation
// (2 s .. about 2 min); the sound of rain follows the same sway.
const rainSway = createSway({ fastest: 2, octaves: 6 });
let sway = 0;

// Ease the current look towards the targets, over about tau seconds.
function ease(dt) {
  const kw = 1 - Math.exp(-dt / 2.5);
  const kc = 1 - Math.exp(-dt / 3.0);
  sway = rainSway(dt);
  look.flowRate += (weather.flow * (1 + 0.22 * sway) - look.flowRate) * kw;
  look.rain += (weather.rain - look.rain) * kw;
  turnP = Math.min(1, turnP + dt / Math.max(0.1, S.turnTime));
  turnNow = turnFrom + (turnTo - turnFrom) * smooth(turnP);
  const kd = 1 - Math.exp(-dt / 5.0); // density drifts slowly
  for (let i = 0; i < 2; i++) look.density[i] += (densityGoal[i] - look.density[i]) * kd;
  for (const key of EASED) {
    for (let i = 0; i < goal[key].length; i++) look[key][i] += (goal[key][i] - look[key][i]) * kc;
  }
  skyClock = (skyClock + dt / Math.max(1, S.skyDay)) % 1;
  look.flow += dt * look.flowRate * SPEED * S.speed;
}

// ---------- frame ----------
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); // rAF time may precede `last`
  last = now;
  time += dt;
  resize();

  // Camera: one of several moves, blended while one turns into the next.
  pointer.sx += (pointer.x - pointer.sx) * 0.03;
  pointer.sy += (pointer.y - pointer.sy) * 0.03;
  camClock += dt * SPEED * (S.orbit / DEFAULTS.orbit); // integrated: a new speed never jumps
  camBlend = Math.min(1, camBlend + dt / CAMERA_BLEND);
  const kb = smooth(camBlend);
  let eye = [0, 0, 0], dir = [0, 0, 0];
  const bob = Math.sin(time * 0.05) * 0.8;
  CAMERAS.forEach((cam, i) => {
    camW[i] = camFrom[i] + ((cam === camMode ? 1 : 0) - camFrom[i]) * kb;
    if (camW[i] < 1e-4) return;
    const pose = cameraPose(cam.name, camClock, S.radius, bob);
    for (let k = 0; k < 3; k++) {
      eye[k] += pose.eye[k] * camW[i];
      dir[k] += pose.dir[k] * camW[i];
    }
  });
  dir = Math.hypot(...dir) > 1e-3 ? norm(dir) : lastDir;
  lastDir = dir;
  // The pointer turns the whole view about the centre and raises or lowers the eye.
  const yaw = pointer.sx * 0.7, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const turn = (v) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
  eye = turn(eye);
  eye[1] -= pointer.sy * 2.0;
  dir = turn(dir);
  const at = [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]];
  const aspect = W / H;
  const view = lookAt(eye, at, [0, 1, 0]);
  const proj = perspective(fovRad(), aspect, 0.1, 60);
  const f = norm(sub(at, eye));
  const r = norm(cross(f, [0, 1, 0]));
  camera = { eye, f, r, u: cross(r, f), aspect };

  // A wave now and then, somewhere in the field.
  if (S.ripples > 0 && time > nextAuto && fadeGoal > 0) {
    addRipple((Math.random() - 0.5) * SPAN * 0.6, (Math.random() - 0.5) * HEIGHT * 0.5,
      (Math.random() - 0.5) * SPAN * 0.6, time);
    // While waves repaint the field, they come more often.
    // The gaps sway with 1/f fluctuation: about half to twice the setting.
    const every = colorMode.name === 'repaint' ? Math.min(S.ripples, 6) : S.ripples;
    nextAuto = time + every * Math.exp(0.7 * rippleGap(1));
  }

  if (time > weatherUntil) nextWeather(time);
  if (time > colorUntil) nextColor(time);
  if (time > flowUntil) nextFlow(time);
  if (time > densityUntil) nextDensity(time);
  if (time > camUntil) nextCamera(time);
  ease(dt);
  sound.rain(look.rain, sway);
  // Breath: light and pad swell and ease; the timer's fade dims them both.
  timerStep(dt);
  const breath = S.breath === 'on' ? breathAt(dt) : 1;
  const glow = (1 - S.breathDepth * (1 - breath)) * fade;
  sound.breath(1 - S.breathDepth * 0.8 * (1 - breath));
  sound.dim(fade);

  // Points.
  gl.bindFramebuffer(gl.FRAMEBUFFER, hasFloat ? scene.fb : null);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.useProgram(pointProg.p);
  const u = pointProg.u;
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uHeight, HEIGHT);
  gl.uniform1f(u.uFocal, (H / 2) / Math.tan(fovRad() / 2));
  gl.uniform1f(u.uSize, S.size);
  gl.uniform1f(u.uMaxPx, S.maxPx);
  gl.uniform1f(u.uRest, S.rest);
  gl.uniform1f(u.uRainGain, S.rainGain);
  gl.uniform1f(u.uTipGain, S.tipGain);
  gl.uniform1f(u.uTrail, S.trail);
  gl.uniform1f(u.uBandSpeed, S.bandSpeed);
  gl.uniform1f(u.uBandScale, S.bandScale);
  gl.uniform1f(u.uSat, S.saturation);
  gl.uniform2fv(u.uDensity, look.density);
  gl.uniform1f(u.uBowStyle, { bands: 0, drop: 1, led: 2 }[S.rainbow] ?? 1);
  gl.uniform1f(u.uFlow, look.flow);
  gl.uniform1f(u.uRain, look.rain);
  gl.uniform1f(u.uTurn, turnNow);
  gl.uniform1f(u.uTurnSteps, Math.max(1, Math.round(S.turnSteps)));
  gl.uniform2fv(u.uFlowDir, flowDir);
  gl.uniform2f(u.uLane, SPAN / (GRID - 1), HEIGHT / ROWS);
  gl.uniform1f(u.uSpan, SPAN);
  gl.uniform1fv(u.uW, look.mode);
  gl.uniform3fv(u.uSet, [...look.s0, ...look.s1, ...look.s2, ...look.s3]);
  gl.uniform3fv(u.uAccent, look.acc);
  gl.uniform3fv(u.uNear, look.near);
  gl.uniform3fv(u.uFar, look.far);
  gl.uniform1f(u.uCloudHue, look.cloud[0]);
  const [sky0, sky1] = skyColors();
  gl.uniform3fv(u.uSky0, sky0);
  gl.uniform3fv(u.uSky1, sky1);
  gl.uniform1f(u.uFlowRate, look.flowRate);
  gl.uniform3fv(u.uGrad0, look.g0);
  gl.uniform3fv(u.uGrad1, look.g1);
  gl.uniform1f(u.uFogFar, S.fog);
  gl.uniform3fv(u.uColA, look.a);
  gl.uniform3fv(u.uColB, look.b);
  gl.uniform4fv(u.uRipples, ripples);
  gl.bindVertexArray(pointVao);
  gl.drawArrays(gl.POINTS, 0, count);
  gl.disable(gl.DEPTH_TEST);

  if (hasFloat) {
    gl.bindVertexArray(emptyVao);
    // Downsample to a quarter.
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.viewport(0, 0, bloomA.w, bloomA.h);
    gl.useProgram(downProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(downProg.u.uTex, 0);
    gl.uniform2f(downProg.u.uTexel, 1 / W, 1 / H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Blur once in each direction: a faint glow that keeps the LEDs crisp.
    gl.useProgram(blurProg.p);
    gl.uniform1i(blurProg.u.uTex, 0);
    for (let i = 0; i < 1; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fb);
      gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
      gl.uniform2f(blurProg.u.uDir, 1 / bloomA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
      gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
      gl.uniform2f(blurProg.u.uDir, 0, 1 / bloomA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // Composite to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(compProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform1i(compProg.u.uScene, 0);
    gl.uniform1i(compProg.u.uBloom, 1);
    gl.uniform1f(compProg.u.uBloomK, S.bloom);
  gl.uniform1f(compProg.u.uExposure, S.exposure * glow);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  if (!checked) {
    checked = true;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) showError(`WebGL error 0x${err.toString(16)} (float buffers: ${hasFloat})`);
  }

  requestAnimationFrame(frame);
}

let checked = false;
requestAnimationFrame(frame);
