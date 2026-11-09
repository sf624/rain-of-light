// Rain of Light: a lattice of light points with drops of light falling through it.
// Plain WebGL2, no dependencies. Points are drawn as opaque discs (with a depth
// test) into a half-float buffer, then blurred for bloom and tone-mapped onto the screen.

import { createTuner, loadSettings } from './tuner.js';
import { createAudio } from './audio.js';
import { createSway } from './sway.js';
import {
  PALETTES, WEATHER, FLOWS, COLOR_MODES, MODE, SETS, ACCENTS, DEPTHS, SKY, CAMERAS,
  DEFAULTS, STORAGE_KEY, SCHEMA,
} from './config.js';
import { FLOW_WRAP, POINT_VS, POINT_FS, QUAD_VS, DOWN_FS, BLUR_FS, COMPOSITE_FS } from './shaders.js';
import { createGL, sub, cross, dot, norm, perspective, lookAt } from './gl.js';
import { createLattice, fillLattice } from './lattice.js';
import { createControls } from './controls.js';

// Errors show on the page (see the inline script in index.html), so a black screen is never silent.
const showError = window.showError;

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

// Either extension makes RGBA16F targets renderable.
const hasFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));

// ---------- fixed settings (also ?dpr=1.5) ----------
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_DPR = Number(params.get('dpr')) || 2;
const SPAN = 22;    // width and depth of the lattice
const HEIGHT = 15;  // height of the lattice
const SPEED = reducedMotion ? 0.4 : 1.0;

const S = loadSettings(DEFAULTS, STORAGE_KEY, params);

// A saved or linked choice that no longer exists falls back to its default.
for (const item of SCHEMA.flatMap((g) => g.items)) {
  if (item.options && !item.options.includes(S[item.key])) S[item.key] = DEFAULTS[item.key];
  // A number out of range (or none) falls back to its default and is clamped.
  if (item.options === undefined) {
    let v = Number(S[item.key]);
    if (!Number.isFinite(v)) v = DEFAULTS[item.key];
    v = Math.min(item.max, Math.max(item.min, v));
    if (item.key === 'ripples' && v > 0) v = Math.max(1, v); // 0 is none; else at least 1 s
    S[item.key] = v;
  }
}
const fovRad = () => S.fov * Math.PI / 180;

const { program, target, freeTarget } = createGL(gl);

// ---------- the lattice ----------
const pointProg = program(POINT_VS, POINT_FS);
const downProg = program(QUAD_VS, DOWN_FS);
const blurProg = program(QUAD_VS, BLUR_FS);
const compProg = program(QUAD_VS, COMPOSITE_FS);

const lattice = createLattice(gl);
let count = 0, GRID = 0, ROWS = 0;
function buildLattice() {
  ({ count, GRID, ROWS } = fillLattice(gl, lattice, S, SPAN));
}
buildLattice();
const pointVao = lattice.pointVao;
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

const sound = createAudio({ settings: S });
const controls = createControls({
  sound, S,
  onVolume: (v) => { tuner.set('volume', v); tuner.refresh(); },
});

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
addEventListener('keydown', wake);
addEventListener('focusin', wake); // the controls show while one has the focus

// ---------- breath ----------
let breathPhase = 0;                 // 0 .. 1 through one breath
const INHALE = 0.4;                  // breathing in takes 4 parts of 10
function breathAt(dt) {
  breathPhase = (breathPhase + dt * S.breathRate / 60) % 1;
  const p = breathPhase;
  return p < INHALE ? 0.5 - 0.5 * Math.cos(Math.PI * p / INHALE)       // in: rise
    : 0.5 + 0.5 * Math.cos(Math.PI * (p - INHALE) / (1 - INHALE));    // out: fall
}


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
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return; // browser shortcuts, and a held key
  if (e.key === 'p') tuner.toggle();             // settings panel
  if (e.key === 'f') controls.toggleFullscreen(); // full screen
  if (e.key === 'w') step('weather', WEATHER);   // next weather
  if (e.key === 'c') step('color', COLOR_MODES); // next colour
  if (e.key === 'd') step('flow', FLOWS);        // switch direction
  if (e.key === 'v') step('camera', CAMERAS);    // next camera move
  if (e.key === 'm') controls.toggleSound();     // sound on and off
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
  if (key === 'volume') { sound.volume(); controls.setVolume(S.volume); }
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
let bandShift = (look.flow * S.bandSpeed) % (10 / S.bandScale);
look.flow %= FLOW_WRAP;

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
  const advance = dt * look.flowRate * SPEED * S.speed;
  look.flow = (look.flow + advance) % FLOW_WRAP; // the shader's drops repeat exactly at the wrap
  // The colour bands slide by the same amount, times their speed; both of their
  // periods (1 / (0.9 scale) and 1 / (0.7 scale)) divide 10 / scale.
  bandShift = (bandShift + advance * S.bandSpeed) % (10 / S.bandScale);
}

// ---------- frame ----------
let last = performance.now();

let checked = false;

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
  if (S.ripples > 0 && time > nextAuto) {
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
  // Breath: light and pad swell as you breathe in and ease as you breathe out.
  const breath = S.breath === 'on' ? breathAt(dt) : 1;
  const glow = 1 - S.breathDepth * (1 - breath);
  sound.breath(1 - S.breathDepth * 0.8 * (1 - breath));

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
  gl.uniform1f(u.uGain, hasFloat ? 1 : S.exposure * glow); // without float buffers the points go to the screen
  gl.uniform1f(u.uFocal, (H / 2) / Math.tan(fovRad() / 2));
  gl.uniform1f(u.uSize, S.size);
  gl.uniform1f(u.uMaxPx, S.maxPx);
  gl.uniform1f(u.uRest, S.rest);
  gl.uniform1f(u.uRainGain, S.rainGain);
  gl.uniform1f(u.uTipGain, S.tipGain);
  gl.uniform1f(u.uTrail, S.trail);
  gl.uniform1f(u.uBandShift, bandShift);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fb);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform2f(blurProg.u.uDir, 1 / bloomA.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
    gl.uniform2f(blurProg.u.uDir, 0, 1 / bloomA.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    gl.uniform1f(compProg.u.uFloor, S.blackFloor / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  if (!checked) {
    checked = true;
    const err = gl.getError();
    if (err !== gl.NO_ERROR) showError(`WebGL error 0x${err.toString(16)} (float buffers: ${hasFloat})`);
  }

  frameId = requestAnimationFrame(frame);
}

let frameId = requestAnimationFrame(frame);

// A lost context stops the loop; when the browser gives it back, start afresh.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  cancelAnimationFrame(frameId);
});
canvas.addEventListener('webglcontextrestored', () => location.reload());
