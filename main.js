// Rain of Light: a lattice of light points with drops of light falling through it.
// Plain WebGL2, no dependencies. Points are drawn additively into a half-float
// buffer, then blurred for bloom and tone-mapped onto the screen.

import { createTuner, loadSettings } from './tuner.js';

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
// Direction: rain falls from above, or now and then flows from the far side to the eye.
const FLOWS = [
  { name: 'down',   toward: 0, hold: [20, 40], weight: 3 },
  { name: 'toward', toward: 1, hold: [8, 14],  weight: 1 },
];
// Colour: one palette, a gradient between two palettes, or a rainbow.
const COLOR_MODES = [
  { name: 'mono',     mode: [1, 0, 0], hold: [14, 26], weight: 3 },
  { name: 'gradient', mode: [0, 1, 0], hold: [14, 24], weight: 2 },
  { name: 'rainbow',  mode: [0, 0, 1], hold: [10, 18], weight: 1.5 },
];

// ---------- tunable settings (panel: p key or the gear button; also ?key=value) ----------
const DEFAULTS = {
  grid: small ? 48 : 80,  rows: small ? 96 : 128,
  size: 0.013, maxPx: 4.5, rest: 0.025,
  rainGain: 4.0, tipGain: 5.0, exposure: 1.5, bloom: 0.4, fog: 22,
  speed: 1.0, trail: 1.0, weather: 'auto',
  color: 'auto', palette: 'auto', rainbow: 'drop', bandSpeed: 0.17, bandScale: 1.0, saturation: 1.0,
  flow: 'auto',
  orbit: 0.025, radius: 7.5, fov: 60,
  ripples: 9,
};
// Older links used ?color=, ?weather= and ?flow= the same way, so they still work.
const STORAGE_KEY = 'rain-of-light:settings';
const S = loadSettings(DEFAULTS, STORAGE_KEY, params);

const SCHEMA = [
  { title: '密度', items: [
    { key: 'grid', label: '糸の本数 (一辺)', min: 8, max: 160, step: 1 },
    { key: 'rows', label: '1本の粒の数', min: 8, max: 256, step: 1 },
  ] },
  { title: 'LED', items: [
    { key: 'size', label: '粒の大きさ', min: 0.004, max: 0.05, step: 0.001 },
    { key: 'maxPx', label: '最大サイズ (px)', min: 1.5, max: 16, step: 0.5 },
    { key: 'rest', label: '消灯時の明るさ', min: 0, max: 0.1, step: 0.001 },
  ] },
  { title: '光', items: [
    { key: 'rainGain', label: '尾の明るさ', min: 0, max: 12, step: 0.1 },
    { key: 'tipGain', label: '先頭の明るさ', min: 0, max: 15, step: 0.1 },
    { key: 'exposure', label: '露出', min: 0.2, max: 4, step: 0.05 },
    { key: 'bloom', label: 'にじみ', min: 0, max: 2, step: 0.05 },
    { key: 'fog', label: '見える距離', min: 6, max: 40, step: 0.5 },
  ] },
  { title: '雨', items: [
    { key: 'weather', label: '天気', options: ['auto', 'drizzle', 'rain', 'shower', 'downpour'] },
    { key: 'speed', label: '速さ (倍)', min: 0, max: 4, step: 0.05 },
    { key: 'trail', label: '尾の長さ (倍)', min: 0.2, max: 4, step: 0.05 },
    { key: 'flow', label: '向き', options: ['auto', 'down', 'toward'] },
  ] },
  { title: '色', items: [
    { key: 'color', label: '色の出し方', options: ['auto', 'mono', 'gradient', 'rainbow'] },
    { key: 'rainbow', label: '虹の色の付け方', options: ['drop', 'led', 'bands'],
      hint: 'drop: しずくごとにランダム / led: LEDごとにランダム / bands: 流れる帯' },
    { key: 'palette', label: 'パレット', options: ['auto', ...PALETTES.map((p) => p.name)] },
    { key: 'bandSpeed', label: '色の流れる速さ', min: 0, max: 0.8, step: 0.01 },
    { key: 'bandScale', label: '色の帯の細かさ', min: 0.1, max: 4, step: 0.05 },
    { key: 'saturation', label: '彩度 (虹)', min: 0, max: 1, step: 0.01 },
  ] },
  { title: 'カメラ', items: [
    { key: 'orbit', label: '回る速さ', min: 0, max: 0.2, step: 0.005 },
    { key: 'radius', label: '中心からの距離', min: 0, max: 10, step: 0.1 },
    { key: 'fov', label: '画角 (度)', min: 30, max: 110, step: 1 },
  ] },
  { title: '波紋', items: [
    { key: 'ripples', label: '自動の間隔 (秒, 0で無し)', min: 0, max: 30, step: 0.5 },
  ] },
];
const fovRad = () => S.fov * Math.PI / 180;

// ---------- shaders ----------
const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aData; // x, u (0 top .. 1 bottom), z, seed
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uHeight;
uniform float uFocal;
uniform float uSize;
uniform float uFlow;  // falling time: integrated, so speed changes never make drops jump
uniform float uRain;  // 0 light rain .. 1 downpour
uniform vec3 uMode;  // weights of mono, gradient, rainbow
uniform vec3 uGrad0;
uniform vec3 uGrad1;
uniform float uToward;  // 0 rain falls down .. 1 light flows from the far side to the eye
uniform vec2 uFlowDir;  // horizontal direction of that flow (towards the eye)
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
uniform float uBowStyle; // rainbow: 0 bands, 1 a random hue per drop, 2 per LED
out vec3 vColor;
out float vSize;

float hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

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
  return mono * uMode.x + grad * uMode.y + bow * uMode.z;
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
void gather(inout Lit L, vec4 r, float sd, float w) {
  vec3 now = bowAt(hash(sd + r.w * 13.37));
  vec3 before = bowAt(hash(sd + (r.w - 1.0) * 13.37));
  L.rain += (r.x + r.y) * w;
  L.tip += r.z * w;
  L.rainCol += (now * r.x + before * r.y) * w;
  L.tipCol += now * r.z * w;
}

void main() {
  float seed = aData.w;
  float u = aData.y;
  vec3 pos = vec3(aData.x, (0.5 - u) * uHeight, aData.z);
  float h = hash(seed + 5.0);
  float spatial = (pos.x + pos.z) * 0.012;           // bands lean a little across the field
  Lit L = Lit(0.0, 0.0, vec3(0.0), vec3(0.0));

  // Two drops run down each strand at their own pace; in heavy rain two more
  // join, one by one across the field, and every trail grows longer.
  float trailK = mix(1.0, 1.7, uRain) * uTrail;
  float wd = 1.0 - uToward;
  float g3 = hash(seed + 6.0) * 0.6;
  float g4 = 0.3 + hash(seed + 7.0) * 0.6;
  gather(L, drop(seed, u, trailK), seed, wd);
  gather(L, drop(seed + 17.0, u, trailK), seed + 17.0, wd);
  gather(L, drop(seed + 31.0, u, trailK), seed + 31.0, wd * smoothstep(g3, g3 + 0.15, uRain));
  gather(L, drop(seed + 53.0, u, trailK), seed + 53.0, wd * smoothstep(g4, g4 + 0.15, uRain));
  vec3 col = flowColor(u, spatial, h);

  // Flow towards the eye: LEDs in one thin lane along the flow light up in turn.
  if (uToward > 0.001) {
    vec2 side = vec2(-uFlowDir.y, uFlowDir.x);
    float lane = floor(dot(pos.xz, side) / uLane.x) * 7.31 + floor(pos.y / uLane.y) * 131.7;
    float w = dot(pos.xz, uFlowDir) / (uSpan * 1.42) + 0.5; // 0 far side .. 1 near side
    gather(L, drop(lane, w, trailK * 1.5), lane, uToward);
    gather(L, drop(lane + 97.0, w, trailK * 1.5), lane + 97.0, uToward * smoothstep(0.2, 0.8, uRain));
    col = mix(col, flowColor(w, pos.y * 0.012, h), uToward);
  }
  float rain = L.rain;
  float tip = L.tip;

  // The rainbow per drop (each drop keeps one random hue as it flows) or per
  // LED (each LED has its own hue, shown as the light passes).
  vec3 rainCol = col, tipCol = col, restCol = col;
  if (uBowStyle > 0.5) {
    vec3 led = bowAt(hash(seed * 0.37 + u * 91.7));
    bool perDrop = uBowStyle < 1.5;
    rainCol += uMode.z * (perDrop && rain > 1e-4 ? L.rainCol / rain : led);
    tipCol += uMode.z * (perDrop && tip > 1e-4 ? L.tipCol / tip : led);
    restCol += uMode.z * led;
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

  // Heads turn white, except in the rainbow, where they keep their colour.
  float white = mix(0.75, 0.15, uMode.z);
  vec3 c = restCol * uRest + rainCol * rain * uRainGain
         + mix(tipCol, vec3(1.0), white) * tip * uTipGain
         + mix(restCol, vec3(1.0), 0.35) * ring * 1.6;

  vec4 mv = uView * vec4(pos, 1.0);
  float dist = -mv.z;
  float fog = 1.0 - smoothstep(uFogFar * 0.3, uFogFar, dist);
  c *= fog;

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
gl.bindVertexArray(null);
let count = 0, GRID = 0, ROWS = 0;

function buildLattice() {
  GRID = Math.max(2, Math.round(S.grid));
  ROWS = Math.max(2, Math.round(S.rows));
  count = GRID * GRID * ROWS;
  const data = new Float32Array(count * 4);
  const step = SPAN / (GRID - 1);
  let k = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      // Jitter each strand, and shift its LEDs by up to one row, so that rows
      // and columns never line up into dark lines across the view.
      const x = -SPAN / 2 + i * step + (Math.random() - 0.5) * step * 0.7;
      const z = -SPAN / 2 + j * step + (Math.random() - 0.5) * step * 0.7;
      const shift = Math.random();
      const seed = Math.random() * 1000;
      for (let r = 0; r < ROWS; r++) {
        data[k++] = x;
        data[k++] = (r + shift) / ROWS;
        data[k++] = z;
        data[k++] = seed;
      }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
let flowDir = [0, 1];
let aimFlow = false; // point flowDir at the eye on the next frame
const goal = { mode: [1, 0, 0], a: PALETTES[0].a, b: PALETTES[0].b, g0: PALETTES[0].a, g1: PALETTES[1].b };

// A setting other than auto holds its choice until it is changed.
const forced = (key) => (S[key] === 'auto' ? undefined : S[key]);
function nextWeather(now) {
  weather = pick(WEATHER, weather, forced('weather'));
  weatherUntil = forced('weather') ? Infinity : now + rand(...weather.hold);
}
function nextFlow(now) {
  flowMode = pick(FLOWS, flowMode, forced('flow'));
  flowUntil = forced('flow') ? Infinity : now + rand(...flowMode.hold);
  // Keep the direction fixed for the whole episode, pointing at where the eye is now.
  if (flowMode.toward) aimFlow = true;
}
function nextColor(now) {
  colorMode = pick(COLOR_MODES, colorMode, forced('color'));
  colorUntil = forced('color') ? Infinity : now + rand(...colorMode.hold);
  const p = PALETTES.find((x) => x.name === S.palette) || pickPalette();
  const q = pickPalette(p);
  Object.assign(goal, { mode: colorMode.mode, a: p.a, b: p.b, g0: p.a, g1: q.b });
}

// Start calm (light rain, one colour, falling) unless a setting says otherwise.
weather = WEATHER[1]; colorMode = COLOR_MODES[0]; flowMode = FLOWS[0];
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
  if (key === 'grid' || key === 'rows') {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildLattice, 250); // wait for the slider to settle
  }
  if (key === 'weather') nextWeather(time);
  if (key === 'flow') nextFlow(time);
  if (key === 'color' || key === 'palette') nextColor(time);
}
const tuner = createTuner({
  schema: SCHEMA, settings: S, defaults: DEFAULTS, storageKey: STORAGE_KEY,
  onChange: (key) => apply(key),
});
const look = {
  flow: Number(params.get('t')) || 0,
  flowRate: weather.flow, rain: weather.rain, toward: flowMode.toward,
  mode: [...goal.mode], a: [...goal.a], b: [...goal.b], g0: [...goal.g0], g1: [...goal.g1],
};

// Ease the current look towards the targets, over about tau seconds.
function ease(dt) {
  const kw = 1 - Math.exp(-dt / 2.5);
  const kc = 1 - Math.exp(-dt / 3.0);
  look.flowRate += (weather.flow - look.flowRate) * kw;
  look.rain += (weather.rain - look.rain) * kw;
  look.toward += (flowMode.toward - look.toward) * kw;
  for (const key of ['mode', 'a', 'b', 'g0', 'g1']) {
    for (let i = 0; i < 3; i++) look[key][i] += (goal[key][i] - look[key][i]) * kc;
  }
  look.flow += dt * look.flowRate * SPEED * S.speed;
}

// ---------- frame ----------
let last = performance.now();
let nextAuto = 2;
let orbitAngle = 0;

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); // rAF time may precede `last`
  last = now;
  time += dt;
  resize();

  // Camera: a slow orbit inside the lattice, nudged by the pointer.
  pointer.sx += (pointer.x - pointer.sx) * 0.03;
  pointer.sy += (pointer.y - pointer.sy) * 0.03;
  orbitAngle += dt * S.orbit * SPEED; // integrated, so a new speed never makes the view jump
  const ang = orbitAngle + pointer.sx * 0.7;
  const R = S.radius;
  // Eye level stays horizontal; the pointer only raises or lowers the eye.
  const eyeY = Math.sin(time * 0.05) * 0.8 - pointer.sy * 2.0;
  const eye = [Math.sin(ang) * R, eyeY, Math.cos(ang) * R];
  // Look ahead along the orbit's inward direction; at the centre, look along -z.
  const at = R > 0.01 ? [0, eyeY, 0] : [eye[0] - Math.sin(ang), eyeY, eye[2] - Math.cos(ang)];
  const aspect = W / H;
  const view = lookAt(eye, at, [0, 1, 0]);
  const proj = perspective(fovRad(), aspect, 0.1, 60);
  const f = norm(sub(at, eye));
  const r = norm(cross(f, [0, 1, 0]));
  camera = { eye, f, r, u: cross(r, f), aspect };
  if (aimFlow) {
    const l = Math.hypot(eye[0], eye[2]) || 1;
    flowDir = [eye[0] / l, eye[2] / l];
    aimFlow = false;
  }

  // A wave now and then, somewhere in the field.
  if (S.ripples > 0 && time > nextAuto) {
    addRipple((Math.random() - 0.5) * SPAN * 0.6, (Math.random() - 0.5) * HEIGHT * 0.5,
      (Math.random() - 0.5) * SPAN * 0.6, time);
    nextAuto = time + S.ripples * (0.7 + Math.random() * 0.6);
  }

  if (time > weatherUntil) nextWeather(time);
  if (time > colorUntil) nextColor(time);
  if (time > flowUntil) nextFlow(time);
  ease(dt);

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
  gl.uniform1f(u.uBowStyle, { bands: 0, drop: 1, led: 2 }[S.rainbow] ?? 1);
  gl.uniform1f(u.uFlow, look.flow);
  gl.uniform1f(u.uRain, look.rain);
  gl.uniform1f(u.uToward, look.toward);
  gl.uniform2fv(u.uFlowDir, flowDir);
  gl.uniform2f(u.uLane, SPAN / (GRID - 1), HEIGHT / ROWS);
  gl.uniform1f(u.uSpan, SPAN);
  gl.uniform3fv(u.uMode, look.mode);
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
  gl.uniform1f(compProg.u.uExposure, S.exposure);
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
