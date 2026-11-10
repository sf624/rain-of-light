// Rain of Light: a lattice of light points over a mirror floor, with rain of
// light falling through it and forms of light that come and go (see show.js).
// Plain WebGL2, no dependencies. Points add their light into a half-float
// buffer (once as they are, once as their image in the floor), which is then
// blurred for the glow and tone-mapped onto the screen.

import { createTuner, loadSettings } from './tuner.js';
import { createAudio } from './audio.js';
import { createSway } from './sway.js';
import {
  PALETTES, WEATHER, FLOWS, COLOR_MODES, MODE, SETS, ACCENTS, DEPTHS, SKY, CAMERAS,
  DEFAULTS, STORAGE_KEY, SCHEMA, ROOM,
} from './config.js';
import { createShow } from './show.js';
import { FLOW_WRAP, POINT_VS, POINT_FS, WIRE_FS, RAY_FS, QUAD_VS, DOWN_FS, BLUR_FS, COMPOSITE_FS } from './shaders.js';
import { createGL, sub, cross, dot, norm, perspective, lookAt } from './gl.js';
import { createLattice, fillLattice } from './lattice.js';
import { createControls } from './controls.js';
import { keepAwake } from './wakelock.js';
import { view, createRotation } from './rotate.js';

// Errors show on the page (see the inline script in index.html), so a black screen is never silent.
const showError = window.showError;

const canvas = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const gl = canvas.getContext('webgl2', {
  antialias: false,
  alpha: false,
  depth: false, // the light is added up: nothing hides anything
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
const SEED = params.has('seed') && Number.isFinite(Number(params.get('seed'))) ? Number(params.get('seed')) : Math.random() * 1000;
const SPEED = reducedMotion ? 0.4 : 1.0;

// One room for the whole show: the rain and the forms share it.
const SPAN = ROOM.span;     // width and depth of the lattice
const HEIGHT = ROOM.height; // height of the lattice
// The mirror floor, a little below the strands' feet: each strand and its
// image are parted by a thin dark seam, so the floor line can be seen.
const FLOOR = -HEIGHT / 2 - ROOM.foot;
const DEF = DEFAULTS;
const S = loadSettings(DEF, STORAGE_KEY, params);

// A saved or linked choice that no longer exists falls back to its default.
for (const item of SCHEMA.flatMap((g) => g.items)) {
  if (item.options && !item.options.includes(S[item.key])) S[item.key] = DEF[item.key];
  // A number out of range (or none) falls back to its default and is clamped.
  if (item.options === undefined) {
    let v = Number(S[item.key]);
    if (!Number.isFinite(v)) v = DEF[item.key];
    v = Math.min(item.max, Math.max(item.min, v));
    if (item.key === 'ripples' && v > 0) v = Math.max(1, v); // 0 is none; else at least 1 s
    S[item.key] = v;
  }
}
const fovRad = () => S.fov * Math.PI / 180;

const { program, target, freeTarget } = createGL(gl);

// ---------- the lattice ----------
const pointProg = program(POINT_VS, POINT_FS);
const wireProg = program(POINT_VS, WIRE_FS);
const downProg = program(QUAD_VS, DOWN_FS);
const blurProg = program(QUAD_VS, BLUR_FS);
const compProg = program(QUAD_VS, COMPOSITE_FS);
const rayProg = program(POINT_VS, RAY_FS);
const MAX_POINT = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]; // the largest sprite this GPU draws

const lattice = createLattice(gl);
let count = 0, GRID = 0, ROWS = 0, wireCount = 0;
function buildLattice() {
  ({ count, GRID, ROWS, wireCount } = fillLattice(gl, lattice, S, SPAN));
}
buildLattice();
const pointVao = lattice.pointVao;
const emptyVao = gl.createVertexArray();

// ---------- render targets ----------
let W = 0, H = 0, scene = null, bloomA = null, bloomB = null, hazeA = null, hazeB = null, wideA = null, wideB = null;

// Render scale, on top of the device pixel ratio. In 'auto' quality it steps
// down when frames are persistently slow and back up when a probe holds.
const SCALES = [1, 0.85, 0.7, 0.6, 0.5];
const MIN_RATIO = 0.5;   // never fewer than half a pixel per CSS pixel
let scaleIdx = 0;
let renderScale = 1;
const baseRatio = () => Math.min(devicePixelRatio || 1, MAX_DPR);
// The lowest step that keeps MIN_RATIO (a 1x screen has little to give up).
const lastIdx = () => {
  let i = 0;
  while (i + 1 < SCALES.length && baseRatio() * SCALES[i + 1] >= MIN_RATIO) i++;
  return i;
};

function resize() {
  const dpr = baseRatio() * SCALES[scaleIdx];
  renderScale = SCALES[scaleIdx];
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (w === W && h === H) return;
  W = canvas.width = w;
  H = canvas.height = h;
  settleUntil = performance.now() + SETTLE_MS; // frame times right after a change say little
  if (hasFloat) {
    freeTarget(scene); freeTarget(bloomA); freeTarget(bloomB); freeTarget(hazeA); freeTarget(hazeB);
    freeTarget(wideA); freeTarget(wideB);
    scene = target(W, H);
    const bw = Math.max(1, W >> 2), bh = Math.max(1, H >> 2);
    bloomA = target(bw, bh);
    bloomB = target(bw, bh);
    // The haze: a sixteenth of the size, blurred wide.
    const hw = Math.max(1, W >> 4), hh = Math.max(1, H >> 4);
    hazeA = target(hw, hh);
    hazeB = target(hw, hh);
    // And a wider haze, at a quarter of that.
    const ww = Math.max(1, W >> 6), wh = Math.max(1, H >> 6);
    wideA = target(ww, wh);
    wideB = target(ww, wh);
  }
}

// ---------- adaptive render scale ----------
// Frame time is the only signal, and rAF is capped at the display's rate, so
// "fast" can never show spare capacity. So:
//  - Down: the smoothed frame time stays above SLOW_MS (under about 45 fps,
//    judged in absolute terms, so a 120 Hz screen at 60 fps is fine) for
//    DOWN_AFTER s. If that step did not make frames at least 8% quicker (judged
//    only with 20+ frames to go on), the
//    limit is something resolution cannot fix (a 30 fps cap, the CPU): undo
//    it and stop lowering for good.
//  - Up: after UP_WAIT s at a lower step with frames never slow, try one step
//    up as a probe. If it turns slow within PROBE_S s, go back down and double
//    UP_WAIT (up to UP_MAX), so a device that cannot afford it is disturbed
//    rarely. A probe that holds resets UP_WAIT.
//  - Changes are at least MIN_GAP s apart. Hidden-tab and long-gap frames,
//    and the first SETTLE_MS after load or a resize, are ignored.
const SETTLE_MS = 2000;
const SLOW_MS = 22, FAST_MS = 18.5;
const DOWN_AFTER = 2.5, MIN_GAP = 6, UP_BASE = 20, UP_MAX = 300, PROBE_S = 5;
let settleUntil = performance.now() + SETTLE_MS;
let frameMs = 0;            // smoothed frame time
let slowFor = 0;            // s the smoothed time has been slow
let calmFor = 0;            // s the smoothed time has been fast, at this step
let sinceChange = 0;        // s since the last step change
let framesSince = 0;        // frames counted since then
let upWait = UP_BASE;
let probing = false;        // the current step is a trial up
let beforeMs = 0;           // smoothed time before the last step down
let judgeDown = false;      // the last step down is still to be judged
let giveUp = false;         // lowering did not help: stay put
document.addEventListener('visibilitychange', () => { settleUntil = performance.now() + SETTLE_MS; });

function setStep(i) {
  scaleIdx = i;
  slowFor = calmFor = sinceChange = framesSince = 0;
  frameMs = 0;
}

function adapt(rawDt, now) {
  if (S.quality === 'full') {
    if (scaleIdx !== 0) setStep(0);
    probing = judgeDown = false;
    return;
  }
  // Skip hidden-tab or stalled frames, and the settling time.
  if (rawDt <= 0 || rawDt > 3 || now < settleUntil || document.hidden) return;
  const ms = rawDt * 1000;
  frameMs = frameMs ? frameMs + (ms - frameMs) * (1 - Math.exp(-rawDt / 0.5)) : ms;
  sinceChange += rawDt;
  framesSince++;
  slowFor = frameMs > SLOW_MS ? slowFor + rawDt : 0;
  calmFor = frameMs < FAST_MS ? calmFor + rawDt : 0;
  const idx = scaleIdx;
  if (probing && slowFor > 1.5) {          // the probe failed: back down, wait longer
    upWait = Math.min(UP_MAX, upWait * 2);
    probing = false;
    setStep(idx + 1);
    return;
  }
  if (probing && sinceChange > PROBE_S) {  // the probe held
    probing = false;
    upWait = UP_BASE;
  }
  if (sinceChange < MIN_GAP) return;
  if (judgeDown) {
    judgeDown = false;
    // With few frames (a very slow device) the average says too little to judge.
    if (framesSince >= 20 && frameMs > SLOW_MS && frameMs > beforeMs * 0.92) { // no relief
      giveUp = true;
      setStep(idx - 1);
      return;
    }
  }
  if (slowFor > DOWN_AFTER && idx < lastIdx() && !giveUp) {
    beforeMs = frameMs;
    judgeDown = true;
    setStep(idx + 1);
  } else if (!probing && idx > 0 && calmFor > upWait && slowFor === 0) {
    probing = true;
    setStep(idx - 1);
  }
}

// ---------- interaction ----------
const ripples = new Float32Array(8 * 4).fill(-1e4);
let rippleIndex = 0;
function addRipple(x, y, z, t) {
  ripples.set([x, y, z, t], rippleIndex * 4);
  rippleIndex = (rippleIndex + 1) % 8;
  // Every wave rings a bell, from the side where it is seen.
  sound.ripple(panOf([x, y, z]));
}
// Left (-1) .. right (1): where a point in the room is seen, for the sound.
const panOf = (p) => (camera ? dot(sub(p, camera.eye), camera.r) / 6 : 0);

const rotation = createRotation();
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

// The view follows a drag begun on the canvas, by how far the mouse (with
// its button down) or the finger moved. A mouse that only moves leaves the
// view alone.
let mouseDrag = null; // the last mouse position of a drag begun on the canvas
const half = (v) => Math.max(-0.5, Math.min(0.5, v));
// A drag of (dx, dy) screen pixels, in the picture's own directions (it may be turned).
function dragBy(dx, dy) {
  const d = view.delta(dx, dy);
  pointer.x = half(pointer.x - d.x / view.w);
  pointer.y = half(pointer.y - d.y / view.h);
}
addEventListener('pointermove', (e) => {
  wake();
  if (!e.isPrimary) return; // with two fingers the view follows the first
  if (e.pointerType === 'mouse') {
    if (!mouseDrag) return;
    // The drag pulls the picture along: the view turns the other way.
    dragBy(e.clientX - mouseDrag.x, e.clientY - mouseDrag.y);
    mouseDrag = { x: e.clientX, y: e.clientY };
    return;
  }
  const d = touches.get(e.pointerId);
  if (!d) return;
  dragBy(e.clientX - d.lx, e.clientY - d.ly);
  d.lx = e.clientX; d.ly = e.clientY;
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


// A ripple goes where the view is hit at screen point (x, y).
function rippleAt(x, y) {
  if (!camera) return;
  const p = view.point(x, y); // from the screen's point to the picture's
  const nx = (p.x / view.w) * 2 - 1;
  const ny = 1 - (p.y / view.h) * 2;
  const th = Math.tan(fovRad() / 2);
  const { eye, f, r, u, aspect } = camera;
  const dir = norm([
    f[0] + r[0] * nx * th * aspect + u[0] * ny * th,
    f[1] + r[1] * nx * th * aspect + u[1] * ny * th,
    f[2] + r[2] * nx * th * aspect + u[2] * ny * th,
  ]);
  const D = 7;
  // A tap on the floor's image rings the light whose image it is.
  const hy = eye[1] + dir[1] * D;
  addRipple(eye[0] + dir[0] * D, hy < FLOOR ? 2 * FLOOR - hy : hy, eye[2] + dir[2] * D, time);
}

// A mouse rings at once. A finger or pen only looks around while it drags;
// it rings on lift if it was a tap: short, and moved less than TAP_MOVE.
const TAP_MOVE = 10;  // CSS px
const TAP_TIME = 350; // ms
const touches = new Map(); // pointerId -> { x, y, t, drag, lx, ly }: where it began, and where it was last
canvas.addEventListener('pointerdown', (e) => {
  hideOverlay();
  if (e.pointerType === 'mouse') {
    rippleAt(e.clientX, e.clientY);
    if (e.button === 0) {
      mouseDrag = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* the drag then ends at the window's edge */ }
    }
  } else touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp, drag: false, lx: e.clientX, ly: e.clientY });
});
addEventListener('pointermove', (e) => {
  const d = touches.get(e.pointerId);
  if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE) d.drag = true;
});
addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') mouseDrag = null;
  const d = touches.get(e.pointerId);
  touches.delete(e.pointerId);
  if (d && !d.drag && e.timeStamp - d.t < TAP_TIME) rippleAt(d.x, d.y);
});
addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (e.pointerType === 'mouse') mouseDrag = null; });

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return; // browser shortcuts, and a held key
  if (e.key === 'p') tuner.toggle();             // settings panel
  if (e.key === 'f') controls.toggleFullscreen(); // full screen
  if (e.key === 'r') rotation.toggle();         // landscape / portrait
  if (e.key === 'w') step('weather', WEATHER);   // next weather
  if (e.key === 'c') { step('color', COLOR_MODES); show.recolor(); } // next colour, of the rain and the forms
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
  return options.find((x) => x.weight > 0);
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
// Only light past a knee glows (scene light, before exposure): the glow stays
// tight around bright heads and cores, and the dark between the points black.
// The haze, wider, takes only what is brighter still.
const BLOOM_KNEE = 0.5;
// While rain falls the room closes in: the visible distance shrinks by this share.
const RAIN_MIST = 0.35;
const HAZE_KNEE = 1.5;
// The floor's image fades over this height above the floor, as on dark glass.
const MIRROR_FADE = 14;
const CAMERA_BLEND = 8; // seconds to turn one move into the next
const smooth = (x) => x * x * (3 - 2 * x);
// The camera starts at ?t= too, so a time shows one view.
let camMode = CAMERAS[0], camUntil = 0, camClock = time, camBlend = 1;
const camW = CAMERAS.map((c) => (c === camMode ? 1 : 0));
let camFrom = [...camW];
let lastDir = [0, 0, -1];

function nextCamera(now) {
  camMode = pick(CAMERAS, camMode, forced('camera'));
  camUntil = forced('camera') ? Infinity : now + rand(...camMode.hold);
  camFrom = [...camW];
  camBlend = 0;
}

// Where one move puts the eye at clock t, and which way it looks. On a floor
// (ground: the eye's height there) the rise goes up from it and back.
function cameraPose(name, t, R, bob, ground) {
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
      return { eye: onOrbit(ground === undefined ? Math.sin(t * 0.035) * 5.5 : ground + (1 - Math.cos(t * 0.035)) * 3.5),
        dir: inward };
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

// What a change in the panel does at once. The scene, form and layer need
// nothing here: the show reads them every frame and blends into the change.
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
  schema: SCHEMA, settings: S, defaults: DEF, storageKey: STORAGE_KEY,
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

// ---------- the show: rain and forms of light, and the mirrors ----------
// ?seed= gives the show's timeline; else each visit has its own.
const show = createShow(S, { feet: -HEIGHT / 2, seed: SEED }); // the layer lies just above the strands' feet
// While no rain passage shows, a few pale drops still fall: more in heavier weather.
const sparseShare = () => 0.03 + 0.05 * look.rain;
// The images of the lattice in the wall mirrors: per image, x sign and offset,
// z sign and offset, and how much light is left after its reflections. The
// walls stand half a strand spacing beyond the outer strands.
const copies = new Float32Array(9 * 4), copyGain = new Float32Array(9);
function placeImages() {
  const room = SPAN + SPAN / (GRID - 1);
  let i = 0;
  for (const nx of [0, -1, 1]) {
    for (const nz of [0, -1, 1]) {
      copies.set([nx ? -1 : 1, nx * room, nz ? -1 : 1, nz * room], i * 4);
      copyGain[i++] = 0.7 ** (Math.abs(nx) + Math.abs(nz));
    }
  }
}

// ---------- frame ----------
let last = performance.now();

let checked = false;

function frame(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, Math.max(0, rawDt)); // rAF time may precede `last`
  last = now;
  adapt(rawDt, now);
  time += dt;
  resize();

  // Camera: one of several moves, blended while one turns into the next.
  pointer.sx += (pointer.x - pointer.sx) * 0.03;
  pointer.sy += (pointer.y - pointer.sy) * 0.03;
  camClock += dt * SPEED * (S.orbit / DEFAULTS.orbit); // integrated: a new speed never jumps
  camBlend = Math.min(1, camBlend + dt / CAMERA_BLEND);
  const kb = smooth(camBlend);
  let eye = [0, 0, 0], dir = [0, 0, 0];
  // The eye stands on the floor, with a little sway.
  const ground = FLOOR + ROOM.eye;
  const bob = ground + Math.sin(time * 0.05) * 0.2;
  CAMERAS.forEach((cam, i) => {
    camW[i] = camFrom[i] + ((cam === camMode ? 1 : 0) - camFrom[i]) * kb;
    if (camW[i] < 1e-4) return;
    const pose = cameraPose(cam.name, camClock, S.radius, bob, ground);
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
  eye[1] = Math.max(FLOOR + 0.4, eye[1]);          // above the floor, looking a little up
  dir = norm([dir[0], dir[1] + ROOM.pitch, dir[2]]);
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
  const shown = show.update(time, dt, camera.eye);
  const rk = shown.rain;                 // how much rain falls now: 0 a still room .. 1 a rain passage
  placeImages();
  sound.rain(look.rain, sway, rk);
  // Breath: light and pad swell as you breathe in and ease as you breathe out.
  const breath = S.breath === 'on' ? breathAt(dt) : 1;
  const glow = 1 - S.breathDepth * (1 - breath);
  sound.breath(1 - S.breathDepth * 0.8 * (1 - breath));
  // Each form's voice swells and fades with it, from where it is seen.
  for (const f of shown.forms) f.pan = panOf(f.at);
  sound.forms(shown.forms);

  // Points.
  gl.bindFramebuffer(gl.FRAMEBUFFER, hasFloat ? scene.fb : null);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // The LEDs and their wires share one vertex shader, so both get the same uniforms.
  const wiresOn = S.wire > 0 && wireCount > 0;
  // Rays belong to the rain's heads: drawn only while rain falls.
  const rays = S.rays === 'off' || rk < 0.01 ? 0 : Number(S.rays);
  const progs = [pointProg];
  if (wiresOn) progs.push(wireProg);
  if (rays) progs.push(rayProg);
  const rayScale = H / 1080;   // rays scale with the view like the lattice: their length is set for a 1080 px tall view
  const rayLen = Math.min(S.rayLength * rayScale, (MAX_POINT - 1) / 2);
  for (const prog of progs) {
  gl.useProgram(prog.p);
  const u = prog.u;
  gl.uniform1f(u.uWire, prog === wireProg ? S.wire : 0);
  gl.uniform1f(u.uRayLen, prog === rayProg ? rayLen : 0);
  // Points this far past the edge are not lit (clip units): their sprite's half
  // size and a little more. A wire's segment is short, so a wide margin is safe.
  const margin = prog === rayProg ? rayLen + 2 : S.maxPx + 4;
  if (prog === wireProg) gl.uniform2f(u.uCull, 1.5, 1.5);
  else gl.uniform2f(u.uCull, 1 + 2 * margin / W, 1 + 2 * margin / H);
  gl.uniform1f(u.uRayThreshold, S.rayThreshold);
  gl.uniform1f(u.uRays, rays);
  gl.uniform1f(u.uRayGain, S.rayGain);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uHeight, HEIGHT);
  gl.uniform1f(u.uGain, hasFloat ? 1 : S.exposure * glow); // without float buffers the points go to the screen
  gl.uniform1f(u.uFocal, (H / 2) / Math.tan(fovRad() / 2));
  gl.uniform1f(u.uSize, S.size);
  gl.uniform1f(u.uMaxPx, S.maxPx * renderScale); // pixels shrink with the scale
  gl.uniform1f(u.uRest, S.rest);
  gl.uniform1f(u.uRainGain, S.rainGain);
  gl.uniform1f(u.uTipGain, S.tipGain);
  gl.uniform1f(u.uTrail, S.trail);
  gl.uniform1f(u.uBandShift, bandShift);
  gl.uniform1f(u.uBandScale, S.bandScale);
  gl.uniform1f(u.uSat, S.saturation);
  // The forms want the whole lattice: thinning belongs to the rain passages.
  gl.uniform2f(u.uDensity, 1 + (look.density[0] - 1) * rk, 1 + (look.density[1] - 1) * rk);
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
  gl.uniform1f(u.uFogFar, S.fog * (1 - RAIN_MIST * rk)); // rain brings a mist: the far strands fade
  gl.uniform3fv(u.uColA, look.a);
  gl.uniform3fv(u.uColB, look.b);
  gl.uniform4fv(u.uRipples, ripples);
  // Rain spreads strand by strand as a rain passage comes, from the few
  // strands that carry pale drops in a still room.
  gl.uniform1f(u.uRainShare, sparseShare() + (S.rainShare - sparseShare()) * rk);
  gl.uniform1f(u.uRainMix, rk);
  gl.uniform4fv(u.uFormA, shown.A);
  gl.uniform4fv(u.uFormB, shown.B);
  gl.uniform4fv(u.uFormE, shown.E);
  gl.uniform4fv(u.uFormF, shown.F);
  gl.uniform3fv(u.uFormC, shown.C);
  gl.uniform3fv(u.uFormD, shown.D);
  gl.uniform3fv(u.uTint, shown.tint);
  gl.uniform1f(u.uTwinkle, S.twinkle);
  gl.uniform4fv(u.uCopy, copies);
  gl.uniform1fv(u.uCopyGain, copyGain);
  }
  // The light itself, then its image in the floor mirror. Wall mirrors draw
  // the lattice again per image, as instances. Every LED, wire and ray adds
  // its light, near or far: the strands are fine threads, and nothing near
  // the eye stands dark in front of a form.
  const images = S.walls >= 1 ? 9 : 1;
  const passes = S.mirror > 0 ? [0, S.mirror] : [0];
  gl.bindVertexArray(pointVao);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (const mirror of passes) {
    for (const prog of progs) {
      gl.useProgram(prog.p);
      gl.uniform3f(prog.u.uMirror, FLOOR, mirror, MIRROR_FADE);
      if (images > 1 && prog !== wireProg) gl.drawArraysInstanced(gl.POINTS, 0, count, images);
      else if (prog !== wireProg) gl.drawArrays(gl.POINTS, 0, count);
      else if (images > 1) gl.drawElementsInstanced(gl.LINE_STRIP, wireCount, gl.UNSIGNED_INT, 0, images);
      else gl.drawElements(gl.LINE_STRIP, wireCount, gl.UNSIGNED_INT, 0);
    }
  }
  gl.disable(gl.BLEND);

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
    gl.uniform1f(downProg.u.uKnee, BLOOM_KNEE);
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
    if (S.haze > 0) {
      // The haze: the glow, made smaller again and blurred twice more, wide.
      gl.bindFramebuffer(gl.FRAMEBUFFER, hazeA.fb);
      gl.viewport(0, 0, hazeA.w, hazeA.h);
      gl.useProgram(downProg.p);
      gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
      gl.uniform2f(downProg.u.uTexel, 1 / bloomA.w, 1 / bloomA.h);
      gl.uniform1f(downProg.u.uKnee, HAZE_KNEE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.uniform1f(downProg.u.uKnee, 0);
      gl.useProgram(blurProg.p);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, hazeB.fb);
        gl.bindTexture(gl.TEXTURE_2D, hazeA.tex);
        gl.uniform2f(blurProg.u.uDir, 1 / hazeA.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, hazeA.fb);
        gl.bindTexture(gl.TEXTURE_2D, hazeB.tex);
        gl.uniform2f(blurProg.u.uDir, 0, 1 / hazeA.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // The wide haze: a quarter of that again, blurred twice the same way.
      gl.bindFramebuffer(gl.FRAMEBUFFER, wideA.fb);
      gl.viewport(0, 0, wideA.w, wideA.h);
      gl.useProgram(downProg.p);
      gl.bindTexture(gl.TEXTURE_2D, hazeA.tex);
      gl.uniform2f(downProg.u.uTexel, 1 / hazeA.w, 1 / hazeA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(blurProg.p);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, wideB.fb);
        gl.bindTexture(gl.TEXTURE_2D, wideA.tex);
        gl.uniform2f(blurProg.u.uDir, 1 / wideA.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, wideA.fb);
        gl.bindTexture(gl.TEXTURE_2D, wideB.tex);
        gl.uniform2f(blurProg.u.uDir, 0, 1 / wideA.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    // Composite to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(compProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, hazeA.tex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, wideA.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(compProg.u.uScene, 0);
    gl.uniform1i(compProg.u.uBloom, 1);
    gl.uniform1i(compProg.u.uHaze, 2);
    gl.uniform1i(compProg.u.uHazeWide, 3);
    gl.uniform1f(compProg.u.uHazeK, S.haze);
    gl.uniform1f(compProg.u.uBurn, S.burn);
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

keepAwake();
