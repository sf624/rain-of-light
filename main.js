// Rain of Light: a lattice of light points over a mirror floor, with rain of
// light falling through it and forms of light that come and go (see show.js).
// Plain WebGL2, no dependencies. Points add their light into a half-float
// buffer (once as they are, once as their image in the floor), which is then
// blurred for the glow and tone-mapped onto the screen.

import { createTuner, loadSettings } from './tuner.js';
import { createAudio } from './audio.js';
import { createSway, createRandom } from './sway.js';
import {
  PALETTES, WEATHER, FLOWS, COLOR_MODES, SETS, SKY, CAMERAS,
  DEFAULTS, STORAGE_KEY, SCHEMA, ROOM,
} from './config.js';
import { createShow } from './show.js';
import { createDirector, hash } from './director.js';
import { createDirection } from './direction.js';
import { FLOW_WRAP, RAY_CAP, POINT_VS, POINT_FS, WIRE_FS, QUAD_VS, DOWN_FS, BLUR_FS, COMPOSITE_FS } from './shaders.js';
import { createGL, sub, cross, dot, norm, perspective, lookAt } from './gl.js';
import { createFields } from './fields.js';
import { createLattice, fillLattice, latticeLight } from './lattice.js';
import { createControls } from './controls.js';
import { createClock, rateText } from './clock.js';
import { createHud } from './hud.js';
import { keepAwake } from './wakelock.js';
import { view, createRotation } from './rotate.js';
import { createEggs } from './eggs.js';
import { eggShader } from './egg-shaders.js';
import './egg-kinds.js';

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
// The scene's two buffers: the light, and the light rays (see POINT_FS).
const BOTH = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1], FIRST = [gl.COLOR_ATTACHMENT0, gl.NONE];

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
// A view narrower than 16:9 (a window made narrow, a phone held upright) sees
// too little of the room's width at the set field of view: everything looks
// too big. So the view zooms out, smoothly with the shape of the view: the
// field of view opens (up to FOV_MAX, past which the picture distorts), and
// the eye steps back from the centre (while it stays inside the room), the
// visible distance with it (by half as much: farther strands than that only
// crowd the picture, and cost frames). A tall view also has room above and
// below the horizon: the eye looks level, and the forms float higher over
// the floor (see forms.js), so a form stands in the upper middle with its
// image in the floor well below it. At 16:9 and wider nothing changes: there
// the Field of view and Distance settings are what is seen.
const WIDE = 16 / 9, FOV_MAX = 96, FOV_SHARE = 0.2, BACK_SHARE = 0.35;
const TALL = { pitch: -0.06, rise: 0.6 };   // in a view as tall as a phone's: added to the eye's pitch, and to the forms' height (a share)
function viewFit() {
  const need = W > 0 && H > 0 ? Math.max(1, WIDE * H / W) : 1;   // how many times too narrow the view is
  const tan = Math.min(Math.tan(S.fov * Math.PI / 360) * need ** FOV_SHARE,
    Math.tan(Math.max(S.fov, FOV_MAX) * Math.PI / 360));
  const radius = Math.min(S.radius * need ** BACK_SHARE, Math.max(S.radius, SPAN / 2 - 1.5));
  const back = S.radius > 0 ? radius / S.radius : 1;
  const tall = Math.min(1, (need - 1) / 2.8);                    // 0 at 16:9 .. 1 on a phone held upright
  return { fov: 2 * Math.atan(tan), radius, far: 1 + (back - 1) * 0.5,
    pitch: ROOM.pitch + TALL.pitch * tall, rise: 1 + TALL.rise * tall };
}
const fovRad = () => viewFit().fov;

const { program, programLater, target, freeTarget } = createGL(gl);

// ---------- the lattice ----------
const plain = { point: program(POINT_VS, POINT_FS), wire: program(POINT_VS, WIRE_FS) };
// The same with the light of the easter eggs that show (egg-shaders.js), built the first time those
// eggs show, without waiting for the GPU: until they are done (a few frames, as the egg fades in) the
// plain programs draw. While no egg shows, the LEDs are drawn by programs with no egg in them at all.
const withEggs = new Map();   // the eggs' types, as 'n,m' -> { point, wire }: each gives its program when done
function eggProgs(types) {
  const key = types.join();
  if (!withEggs.has(key)) {
    const vs = eggShader(POINT_VS, types);
    withEggs.set(key, { point: programLater(vs, POINT_FS), wire: programLater(vs, WIRE_FS) });
  }
  const p = withEggs.get(key);
  if (!p.done) {
    const point = p.point(), wire = p.wire();
    if (!point || !wire) return plain;
    fieldsUnit(point); fieldsUnit(wire);
    p.done = { point, wire };
  }
  return p.done;
}
const downProg = program(QUAD_VS, DOWN_FS);
const blurProg = program(QUAD_VS, BLUR_FS);
const compProg = program(QUAD_VS, COMPOSITE_FS);
const MAX_POINT = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]; // the largest sprite this GPU draws
// The baked forms' fields (see fields.js), on a texture unit of their own (0 .. 4: the composite's).
const FIELD_UNIT = 5;
const fields = createFields(gl, FIELD_UNIT);
const fieldsUnit = (prog) => { gl.useProgram(prog.p); gl.uniform1i(prog.u.uFields, FIELD_UNIT); };
for (const prog of [plain.point, plain.wire]) fieldsUnit(prog);

const lattice = createLattice(gl);
let count = 0, GRID = 0, ROWS = 0, wireCount = 0, light = null;
function buildLattice() {
  ({ count, GRID, ROWS, wireCount } = fillLattice(gl, lattice, S, SPAN, HEIGHT));
  light = latticeLight(GRID, ROWS, SPAN, HEIGHT);
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
    scene = target(W, H, true); // and the light rays beside it (see POINT_FS)
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
function addRipple(x, y, z, t, quiet = false) {
  ripples.set([x, y, z, t], rippleIndex * 4);
  rippleIndex = (rippleIndex + 1) % 8;
  // Every wave rings a bell, from the side where it is seen.
  if (!quiet) sound.ripple(panOf([x, y, z]));
}
// Left (-1) .. right (1): where a point in the room is seen, for the sound.
const panOf = (p) => (camera ? dot(sub(p, camera.eye), camera.r) / 6 : 0);

const rotation = createRotation();
const sound = createAudio({ settings: S });
const lab = document.documentElement.dataset.page === 'lab';
const clock = createClock({ lab, params, seed: SEED });
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
  const D = 10;   // about where the forms are: far enough for the wave to be seen whole
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
  if (e.key === 'c') { show.recolor(); step('color', COLOR_MODES); } // next colour, of the rain and the forms
  if (e.key === 'd') {                           // switch direction (and hold it)
    tuner.set('flow', flowOf(flowGoal) ? 'down' : 'across');
    tuner.refresh();
  }
  if (e.key === 'v') step('camera', CAMERAS);    // next camera move
  if (e.key === 'm') controls.toggleSound();     // sound on and off
});
// A key moves on to another episode while the setting is auto, else to the next choice.
function step(key, list) {
  if (S[key] === 'auto') { trackOf(key).skip(time); restate(); return; }
  const i = list.findIndex((x) => x.name === S[key]);
  tuner.set(key, list[(i + 1) % list.length].name);
  tuner.refresh();
}

let overlayTimer = setTimeout(hideOverlay, 7000);
function hideOverlay() {
  clearTimeout(overlayTimer);
  overlay.classList.add('hidden');
}

const MAX_T = 86400;     // the lab's last time: 24 h (a seek or ?t= beyond it goes to it)
const clampT = (t) => (Number.isFinite(t) ? Math.min(MAX_T, Math.max(0, t)) : 0);
const START = lab ? clampT(Number(params.get('t'))) : Number(params.get('t')) || 0;
let time = START;
// The easter eggs (eggs.js): a pin in the lab, the secret, or the date and time bring one. A change
// of pin or a summons is a change of setting (the lab's snapshots go).
const eggs = createEggs({ lab, params, canvas, start: START, now: () => time, onChange: () => apply('egg') });
// The lab draws every random number of the show from the seed, so that a moment can be
// made again (see seekTo); the viewer page keeps Math.random.
const randomFor = (salt) => (lab ? createRandom(SEED + salt) : Math.random);
let nextAuto = time + 2, autoWaves = 0;   // the next automatic wave, and how many there were
let rippleGap = null;                     // per wave: how long until the next
let look = null;    // the rain now: its flow, rate, amount and density, easing towards the weather (set up below)

// ---------- director: weather and colour change on their own ----------
// What comes when is in director.js: tracks of episodes made from the seed.
// Here each episode is put to work as its time comes. A setting other than
// auto holds its choice over the track's.
const director = createDirector(SEED);
// The colours' track: with the colour story, or as the seed alone has them.
const trackOf = (key) => director[key === 'color' && S.story === 'on' ? 'story' : key];
const forced = (key) => (S[key] === 'auto' ? undefined : S[key]);
const chosen = (key, list, e) => list.find((x) => x.name === forced(key)) || e.item;

let weather = null, colorMode = null;
const densityGoal = [1, 1];
// The rain falls or flows sideways, as the passage has it or the Direction
// setting; a change never shows both at once (see direction.js).
const flowOf = (flow) => { const f = FLOWS.find((x) => x.name === forced('flow')); return f ? f.toward : flow.toward; };
let flowGoal = { toward: 0, angle: 0 };     // the show's direction now (see show.js, flowAt)
let flowDir = [0, 1];
let flowTurns = 0;                          // the lab: how many times a rain began with its own way                       // the way the sideways rain flows: a new one each time it begins
let direction = null;
// The rain's colours: two looks, and each strand shows one of them. A new
// colour episode is written to the look that is out of sight, and the strands
// then go over to it one after another (see POINT_VS): a blend of two colours
// would pass through grey.
const goals = [null, null], looks = [null, null];
let side = 0, sideNow = 0;   // the look the running episode has; how far the strands have gone over to look 1
const SWITCH = 7;            // seconds for all strands to go over
const copyLook = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, [...v]]));

// Per track: what an episode e does as it begins (snap: at once, as on load).
const BEGIN = {
  weather(e) { weather = chosen('weather', WEATHER, e); },
  color(e, snap) {
    colorMode = chosen('color', COLOR_MODES, e);
    const p = PALETTES.find((x) => x.name === S.palette) || e.p;
    const q = p === e.q ? e.p : e.q;
    const set = SETS.find((x) => x.name === S.set) || e.set;
    const next = {
      mode: colorMode.mode, a: p.a, b: p.b, g0: p.a, g1: q.b,
      s0: set.c[0], s1: set.c[1], s2: set.c[2], s3: set.c[3],
      acc: e.accent, near: e.depth[0], far: e.depth[1], cloud: [e.hue, 0, 0],
    };
    if (snap) {
      for (const i of [0, 1]) { goals[i] = next; looks[i] = copyLook(next); }
      return;
    }
    // Out of sight, the other look changes at once; if strands still show it
    // (a change in the middle of the last one), it eases to the new colours.
    const unseen = sideNow === side;
    side = 1 - side;
    goals[side] = next;
    if (unseen) looks[side] = copyLook(next);
    if (colorMode.name === 'repaint') nextAuto = Math.min(nextAuto, time + 1.5); // a first wave soon
  },
  // Density wanders between its lower limits and full, or holds the manual shares.
  density(e) {
    const manual = S.density === 'manual';
    [[S.strandShare, S.strandMin], [S.rowShare, S.rowMin]].forEach(([share, min], i) => {
      densityGoal[i] = manual ? share : Math.min(1, min) + (1 - Math.min(1, min)) * e.share[i];
    });
  },
  camera(e, snap) {
    camMode = chosen('camera', CAMERAS, e);
    camFrom = [...camW];
    camBlend = 0;
    if (snap) { camW.fill(0); camW[CAMERAS.indexOf(camMode)] = 1; camFrom = [...camW]; camBlend = 1; }
  },
};
const TRACKS = Object.keys(BEGIN);
const episode = {};   // per track: the episode that runs now
function direct(now, snap) {
  for (const key of TRACKS) {
    const e = trackOf(key).at(now);
    if (e !== episode[key]) { episode[key] = e; BEGIN[key](e, snap); }
  }
}
// Only light past a knee glows (scene light, before exposure): the glow stays
// tight around bright heads and cores, and the dark between the points black.
// The haze, wider, takes only what is brighter still.
const BLOOM_KNEE = 0.5;
// While rain falls the room closes in: the visible distance shrinks by this share.
const RAIN_MIST = 0.22;
const HAZE_KNEE = 1.5;
// The floor's image fades over this height above the floor, as on dark glass.
const MIRROR_FADE = 22;
const CAMERA_BLEND = 8; // seconds to turn one move into the next
const smooth = (x) => x * x * (3 - 2 * x);
// The camera starts at ?t= too, so a time shows one view.
let camMode = CAMERAS[0], camClock = time, camBlend = 1;
const camW = CAMERAS.map((c) => (c === camMode ? 1 : 0));
let camFrom = [...camW];
let lastDir = [0, 0, -1];


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

// The sky's colours at this moment of its day.
let skyClock = (director.skyStart + time / Math.max(1, S.skyDay)) % 1;
function skyColors() {
  const x = skyClock * SKY.length;
  const i = Math.floor(x) % SKY.length, j = (i + 1) % SKY.length, k = smooth(x - Math.floor(x));
  const lerp = (a, b) => a.map((v, n) => v + (b[n] - v) * k);
  return [lerp(SKY[i][0], SKY[j][0]), lerp(SKY[i][1], SKY[j][1])];
}

// (The state is set up at the start time, or at 0 in the lab, by initState below.)

// What a change in the panel does at once. The scene, form and layer need
// nothing here: the show reads them every frame and blends into the change.
// Only the picture reads these: the show's state does not depend on them, so a change leaves it as it is.
const LATTICE = ['leds', 'aspect', 'grid', 'rows', 'layout', 'jitter'];
const DRAW_ONLY = ['volume', 'quality', 'exposure', 'twinkle', 'haze', 'burn', 'mirror', 'walls', 'size', 'maxPx', 'rest',
  'wire', 'rainGain', 'tipGain', 'bloom', 'fog', 'rays', 'rayLength', 'blackFloor', 'saturation', 'rainbow'];
let rebuildTimer = 0;
function apply(key) {
  const redone = !DRAW_ONLY.includes(key) && !LATTICE.includes(key) && restate();
  if (LATTICE.includes(key)) {
    snaps.clear();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildLattice, 250); // wait for the slider to settle
  }
  if (key === 'volume') { sound.volume(); controls.setVolume(S.volume); }
  if (redone) return;   // (the moment was made again with the setting: nothing is left to hand over)
  // The setting takes over from the running episode, or hands back to it.
  const track = ['palette', 'set'].includes(key) ? 'color'
    : ['strandShare', 'rowShare', 'strandMin', 'rowMin'].includes(key) ? 'density' : key;
  if (BEGIN[track]) BEGIN[track](episode[track]);
}

// Which panel: lab.html (data-page="lab") shows every setting, the viewer page a few.
const tuner = createTuner({
  schema: SCHEMA, lab,
  settings: S, defaults: DEF, storageKey: STORAGE_KEY,
  onChange: (key) => apply(key),
});
if (lab) eggs.labSelect(document.querySelector('.tuner'));   // the lab's pin of an egg (not a setting: never saved)
let bandShift = 0;

// The rain swells and eases within its weather, with 1/f fluctuation
// (2 s .. about 2 min); the sound of rain follows the same sway.
let rainSway = null;
let sway = 0;

// Ease the current look towards the targets, over about tau seconds.
function ease(dt) {
  const kw = 1 - Math.exp(-dt / 2.5);
  const kc = 1 - Math.exp(-dt / 3.0);
  sway = rainSway(dt);
  look.flowRate += (weather.flow * (1 + 0.22 * sway) - look.flowRate) * kw;
  look.rain += (weather.rain - look.rain) * kw;
  if (direction.update(dt, flowOf(flowGoal), look.flow) === 1) {
    // (With the setting the way is the show's next one, or one from the seed.)
    const a = flowGoal.toward ? flowGoal.angle : hash(SEED * 5.3 + (lab ? 7.31 * ++flowTurns : time)) * Math.PI * 2;   // (the lab counts the turns: the same way however the steps fall)
    flowDir = [Math.cos(a), Math.sin(a)];
  }
  const kd = 1 - Math.exp(-dt / 5.0); // density drifts slowly
  for (let i = 0; i < 2; i++) look.density[i] += (densityGoal[i] - look.density[i]) * kd;
  looks.forEach((l, n) => {
    for (const key of Object.keys(l)) {
      for (let i = 0; i < l[key].length; i++) l[key][i] += (goals[n][key][i] - l[key][i]) * kc;
    }
  });
  sideNow = Math.max(0, Math.min(1, sideNow + Math.sign(side - sideNow) * dt / SWITCH));
  if (Math.abs(side - sideNow) < 1e-3) sideNow = side;
  skyClock = (skyClock + dt / Math.max(1, S.skyDay)) % 1;
  const advance = dt * look.flowRate * SPEED * S.speed;
  look.flow = (look.flow + advance) % FLOW_WRAP; // the shader's drops repeat exactly at the wrap
  // The colour bands slide by the same amount, times their speed; both of their
  // periods (1 / (0.9 scale) and 1 / (0.7 scale)) divide 10 / scale.
  bandShift = (bandShift + advance * S.bandSpeed) % (10 / S.bandScale);
}

// ---------- the show: rain and forms of light, and the mirrors ----------
// ?seed= gives the show's timeline; else each visit has its own.
const show = createShow(S, { feet: -HEIGHT / 2, seed: SEED, eggs: fields.able }); // the layer lies just above the strands' feet
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
// One step of the show's state, without drawing or sound: the camera, the waves that come by
// themselves, the director's episodes, the easings, the show. dt: the show's time that goes by;
// replay: stepping to a time (no bell for a wave, and a
// neutral pointer, so that a time comes out the same whatever the mouse did).
let viewM = null, projM = null, lastFit = null;
function advance(dt, replay = false) {
  const egg = eggs.at(time);
  camClock += dt * SPEED * (S.orbit / DEFAULTS.orbit); // integrated: a new speed never jumps
  camBlend = Math.min(1, camBlend + dt / CAMERA_BLEND);
  const kb = smooth(camBlend);
  let eye = [0, 0, 0], dir = [0, 0, 0];
  // The eye stands on the floor, with a little sway.
  const fit = lastFit = viewFit();
  const ground = FLOOR + ROOM.eye;
  const bob = ground + Math.sin(time * 0.05) * 0.2;
  CAMERAS.forEach((cam, i) => {
    camW[i] = camFrom[i] + ((cam === camMode ? 1 : 0) - camFrom[i]) * kb;
    if (camW[i] < 1e-4) return;
    const pose = cameraPose(cam.name, camClock, fit.radius, bob, ground);
    for (let k = 0; k < 3; k++) {
      eye[k] += pose.eye[k] * camW[i];
      dir[k] += pose.dir[k] * camW[i];
    }
  });
  dir = Math.hypot(...dir) > 1e-3 ? norm(dir) : lastDir;
  lastDir = dir;
  // The pointer turns the whole view about the centre and raises or lowers the eye.
  const px = replay ? 0 : pointer.sx, py = replay ? 0 : pointer.sy;
  const yaw = px * 0.7, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const turn = (v) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
  eye = turn(eye);
  eye[1] -= py * 2.0;
  dir = turn(dir);
  if (egg.view) {                                  // an egg that wants to be seen from higher up
    eye[1] += egg.view.lift;
    dir = norm([dir[0], dir[1] + egg.view.pitch, dir[2]]);
  }
  eye[1] = Math.max(FLOOR + 0.4, eye[1]);          // above the floor, looking a little up
  dir = norm([dir[0], dir[1] + fit.pitch, dir[2]]);
  const at = [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]];
  const aspect = W / H;
  viewM = lookAt(eye, at, [0, 1, 0]);
  projM = perspective(fovRad(), aspect, 0.1, 60);
  const f = norm(sub(at, eye));
  const r = norm(cross(f, [0, 1, 0]));
  camera = { eye, f, r, u: cross(r, f), aspect, rise: fit.rise };

  // A wave now and then, somewhere in the field.
  if (S.ripples > 0 && time > nextAuto) {
    const where = (i) => hash(SEED + ++autoWaves * 5.71 + i) - 0.5;   // from the seed, like the rest of the show
    addRipple(where(1) * SPAN * 0.6, where(2) * HEIGHT * 0.5, where(3) * SPAN * 0.6, time, replay || clock.rate > 4);   // a fast show rings no bells for them, nor does a seek
    // While waves repaint the field, they come more often.
    // The gaps sway with 1/f fluctuation: about half to twice the setting.
    const every = colorMode.name === 'repaint' ? Math.min(S.ripples, 6) : S.ripples;
    nextAuto = time + every * Math.exp(0.7 * rippleGap(1));
  }

  direct(time);
  ease(dt);
  const shown = show.update(time, dt, camera, egg.show);
  flowGoal = shown.flow;
  // Breath: light and pad swell as you breathe in and ease as you breathe out.
  const breath = S.breath === 'on' ? breathAt(dt) : 1;
  return { shown, breath, egg };
}
// Where the eye will be in dt seconds of the show, as the camera move goes on (for an egg that is
// set for where the eye will be; no blend of moves, no pointer).
function eyeAt(dt) {
  const fit = lastFit || viewFit(), ground = FLOOR + ROOM.eye;
  const pose = cameraPose(camMode.name, camClock + dt * SPEED * (S.orbit / DEFAULTS.orbit), fit.radius,
    ground + Math.sin((time + dt) * 0.05) * 0.2, ground);
  return [pose.eye[0], Math.max(FLOOR + 0.4, pose.eye[1]), pose.eye[2]];
}

// ---------- the state at a time: set up, save, bring back, seek ----------
// The show's timeline and the director's tracks are made from the seed, so they need no state. What
// carries from frame to frame is listed here: the easings (weather, colours, direction, forms, camera
// move), the sways, the waves, the sky, the breath (see saveState). A moment can be made again by
// bringing back a snapshot from before it (or setting the state up at 0) and stepping it on, without
// drawing, in steps of REPLAY_STEP: the lab does so for ?t= and for a seek back. A snapshot is taken
// the first time the show's time passes each SNAP_S, in play or in a replay, so a seek is short.
// A seek is time-sliced over frames, so that a long one never freezes the page. The settings (the
// scene, the colours' story ...) and the colour key (c) are those of now; a pointer is not replayed.
const REPLAY_STEP = 0.05;     // s of the show per step: the longest step a frame takes
const SNAP_S = 60;            // s of the show between snapshots
const MAX_SNAPS = 1500;       // at most this many snapshots (25 h of show; about 25 MB)
const SLICE_MS = 8;           // ms a frame gives to a seek in progress
function initState(t0) {
  time = t0;
  nextAuto = time + 2; autoWaves = 0;
  rippleGap = createSway({ fastest: 1, octaves: 5, random: randomFor(1) });
  ripples.fill(-1e4); rippleIndex = 0;
  for (const key of TRACKS) delete episode[key];
  side = 0; sideNow = 0;
  camMode = CAMERAS[0]; camClock = time; camBlend = 1;
  CAMERAS.forEach((c, i) => { camW[i] = c === camMode ? 1 : 0; });
  camFrom = [...camW];
  lastDir = [0, 0, -1];
  skyClock = (director.skyStart + time / Math.max(1, S.skyDay)) % 1;
  direct(time, true);
  look = { flow: t0, flowRate: weather.flow, rain: weather.rain, density: [...densityGoal] };
  bandShift = (look.flow * S.bandSpeed) % (10 / S.bandScale);
  look.flow %= FLOW_WRAP;
  rainSway = createSway({ fastest: 2, octaves: 6, random: randomFor(2) });
  sway = 0;
  breathPhase = 0;
  flowTurns = 0;
  show.reset();
  flowGoal = show.flow(time);
  direction = createDirection(flowOf(flowGoal));
  flowDir = [0, 1];
  if (flowGoal.toward) flowDir = [Math.cos(flowGoal.angle), Math.sin(flowGoal.angle)];
}
// (What the tracks and the config own is kept by reference; the rest is copied.)
function saveState() {
  return {
    ...structuredClone({
      time, nextAuto, autoWaves, ripples: [...ripples], rippleIndex, look, bandShift, sway, densityGoal,
      goals, looks, side, sideNow, flowGoal, flowDir, flowTurns, skyClock, breathPhase, camBlend, camFrom, camW, camClock, lastDir,
      gap: rippleGap.save(), rain: rainSway.save(), direction: direction.save(),
    }),
    show: show.save(), episode: { ...episode }, weather, colorMode, camMode,
  };
}
function loadState(d) {
  const c = structuredClone({ ...d, show: null, episode: null, weather: null, colorMode: null, camMode: null });
  ({ time, nextAuto, autoWaves, rippleIndex, look, bandShift, sway, side, sideNow, flowGoal, flowDir, flowTurns, skyClock, breathPhase, camBlend, camFrom, camClock, lastDir } = c);
  ripples.set(c.ripples);
  densityGoal.splice(0, 2, ...c.densityGoal);
  goals.splice(0, 2, ...c.goals); looks.splice(0, 2, ...c.looks);
  camW.splice(0, camW.length, ...c.camW);
  rippleGap.load(c.gap); rainSway.load(c.rain); direction.load(c.direction);
  show.load(d.show);
  for (const key of TRACKS) delete episode[key];
  Object.assign(episode, d.episode);
  ({ weather, colorMode, camMode } = d);
}
const snaps = new Map();      // k -> the state when the show's time first passed k * SNAP_S
let seekMs = 0, replayed = 0;             // the last seek: its time and steps (for the readout)
function snapshot() {
  const k = Math.floor(time / SNAP_S);
  if (k > 0 && !snaps.has(k) && snaps.size < MAX_SNAPS) snaps.set(k, saveState());
}
let job = null;               // the seek in progress: { target, from, began }
// Begin a seek to time t (the lab). Ahead of now: stepped on from the state as it is. Behind: from
// the latest snapshot at or before t (or from 0). A time that is not a number is ignored.
function startSeek(t) {
  if (!Number.isFinite(t)) return;
  t = clampT(t);
  if (t === time) return;   // already there
  replayed = 0;
  if (t < time) {
    let k = Math.floor(t / SNAP_S);
    while (k > 0 && !(snaps.get(k)?.time <= t)) k--;
    if (k > 0) loadState(snaps.get(k)); else initState(0);
  }
  job = { target: t, from: time, began: performance.now() };
}
// Step the seek on for about `budget` ms; true when it has arrived. A step is REPLAY_STEP, except the
// last when less is left (so a time is reached to within a millionth of a second, and the same
// steps are taken from wherever a seek begins).
function pumpSeek(budget) {
  const until = performance.now() + budget;
  for (;;) {
    for (let i = 0; i < 100; i++) {
      const rest = job.target - time;
      if (rest <= 1e-6) {
        seekMs = performance.now() - job.began;
        job = null;
        return true;
      }
      const d = rest > REPLAY_STEP - 1e-6 ? REPLAY_STEP : rest;   // (a whole step unless less is left)
      time = d === REPLAY_STEP ? time + d : job.target;   // (summed like the frames' time, so a frame of 0.05 s and a step are the same)
      advance(d, true);
      replayed++;
      snapshot();
    }
    if (performance.now() >= until) return false;
  }
}
// The state depends on a setting that changed (or on the colour key, or a skipped episode): the
// snapshots were made without it. A paused lab shows the same moment again with it, by a seek to
// it (the same as a seek there gives); a running show blends into the change. True when it seeks.
function restate() {
  snaps.clear();
  if (!lab || !(job || clock.paused)) return false;
  const t = job ? job.target : time;
  initState(0);
  startSeek(t);
  return true;
}
let pendingSeek = null;
clock.onSeek = (t) => { pendingSeek = t; };
if (lab) {
  initState(0);
  startSeek(START);
} else initState(START);

let last = performance.now();

let checked = false;

// ---------- the lab's readout ----------
// What the readout (hud.js) shows, read from the real state when it asks (a few
// times a second); the frame keeps only the last frame's few derived values.
let lastShown = null, lastGlow = 1, lastBreath = null, rainShareNow = 0, fallLightNow = 0;
const RIPPLE_LIFE = 7;   // seconds a wave lives (POINT_VS)
function hudSnapshot() {
  const info = show.info(time);
  const lookNow = looks[sideNow < 0.5 ? 0 : 1], goalNow = goals[sideNow < 0.5 ? 0 : 1];
  const [w0, w1] = direction.weights;
  const moves = CAMERAS.map((c, i) => [c.name, camW[i]]).filter(([, w]) => w > 0.01).map(([n, w]) => `${n} ${w.toFixed(2)}`).join(' ');
  return {
    time, seed: SEED, rateText: rateText(clock.rate), paused: clock.paused,
    seek: { steps: replayed, ms: seekMs, snaps: snaps.size },
    scale: renderScale, adaptive: S.quality !== 'full', canvas: [W, H],
    grid: GRID, rows: ROWS, leds: count,
    scene: S.scene, form: S.form, layer: S.layer, show: info, egg: eggs.info(),
    weather: { name: weather.name, rain: look.rain, fall: look.flowRate },
    density: look.density, rainShare: rainShareNow,
    flow: { down: w0, across: w1, mix: direction.mix, goal: flowOf(flowGoal) },
    color: { mode: colorMode.name, palette: PALETTES.find((p) => p.a.every((v, i) => v === goalNow.a[i]))?.name, swatches: [lookNow.a, lookNow.b] },
    light: {
      exposure: S.exposure, breath: lastBreath, glow: lastGlow, applied: S.exposure * lastGlow,
      room: light.room, wire: light.wire, twinkle: light.twinkle, fall: fallLightNow, stormGain: info.gain,
      bloom: S.bloom, haze: S.haze, burn: S.burn, rays: S.rays, float: hasFloat,
    },
    camera: { moves, eye: camera ? camera.eye : [0, 0, 0] },
    ripples: ripples.reduce((n, v, i) => (i % 4 === 3 && time - v >= 0 && time - v < RIPPLE_LIFE ? n + 1 : n), 0),
  };
}
// For tests of the lab: the whole state as text, and a seek.
if (lab) window.__lab = { state: () => JSON.stringify(saveState()), seek: (t) => { pendingSeek = t; }, eggs: () => ({ on: eggs.info(), ...eggs.uniforms(), eye: camera?.eye }) };
const hud = createHud({ lab, params, bar: clock.bar, snapshot: hudSnapshot });

function frame(now) {
  const rawDt = (now - last) / 1000;
  // rAF time may precede `last`. The lab's clock may stand the show still or run it faster.
  let dt = clock.tick(Math.min(0.05, Math.max(0, rawDt)));
  last = now;
  if (!clock.paused) adapt(rawDt, now);   // a paused picture keeps its render scale
  if (pendingSeek !== null) { startSeek(pendingSeek); pendingSeek = null; }
  let note = '';
  if (job) {
    resize();   // (the camera needs the canvas's shape)
    const from = job.from, target = job.target, began = job.began;
    pumpSeek(Math.max(SLICE_MS, Math.min(250, rawDt * 500)));   // (a slow frame can give more)
    if (job && performance.now() - began > 100) note = `seeking ${Math.round(100 * (time - from) / Math.max(1e-9, target - from))}%`;
    dt = 0;   // the frame of a seek shows the moment itself
    settleUntil = performance.now() + SETTLE_MS;   // a seek's frame says little about the speed
  } else time += dt;
  clock.show(time, note);
  hud.frame(now);
  resize();

  // Camera: the eye follows the pointer a little more each frame.
  pointer.sx += (pointer.x - pointer.sx) * 0.03;
  pointer.sy += (pointer.y - pointer.sy) * 0.03;
  const { shown, breath, egg } = advance(dt);
  // A baked form's field loads as it draws near, and the form shows once it is there.
  fields.frame(show.eggsNear(time), shown, Math.min(0.1, Math.max(0, rawDt)));
  if (lab && !job) snapshot();
  const view = viewM, proj = projM, fit = lastFit;
  const rk = shown.rain;                 // how much rain falls now: 0 a still room .. 1 a rain passage
  placeImages();
  sound.rain(look.rain, sway, rk);
  const glow = 1 - S.breathDepth * (1 - breath);
  sound.breath(1 - S.breathDepth * 0.8 * (1 - breath));
  // Each form's voice swells and fades with it, from where it is seen.
  for (const f of shown.forms) f.pan = panOf(f.at);
  sound.forms(shown.forms);

  // For the lab's readout (see hudSnapshot): the frame's last state.
  lastShown = shown; lastGlow = glow; lastBreath = S.breath === 'on' ? breath : null;
  rainShareNow = (sparseShare() + (S.rainShare * (1 - 0.35 * shown.storm) - sparseShare()) * rk) * (1 - egg.dry);
  eggs.frame(time, { camera, fov: fovRad(), SPAN, HEIGHT, FLOOR, lane: [SPAN / (GRID - 1), HEIGHT / ROWS], eyeAt });
  fallLightNow = rk * (1 - direction.mix);

  // Points.
  gl.bindFramebuffer(gl.FRAMEBUFFER, hasFloat ? scene.fb : null);
  if (hasFloat) gl.drawBuffers(BOTH);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // The LEDs and their wires share one vertex shader, so both get the same uniforms.
  const wiresOn = S.wire > 0 && wireCount > 0;
  // Every LED's light casts rays (see POINT_VS: rayK), drawn with the LED into
  // the second buffer. Without float buffers there are none.
  const rays = S.rays === 'off' || !hasFloat ? 0 : Number(S.rays);
  const eggTypes = eggs.showing();
  const { point: pointProg, wire: wireProg } = eggTypes.length ? eggProgs(eggTypes) : plain;
  const progs = [pointProg];
  if (wiresOn) progs.push(wireProg);
  const rayScale = H / 1080;   // rays scale with the view like the lattice: their length is set for a 1080 px tall view
  const rayLen = rays ? S.rayLength * rayScale : 0;
  for (const prog of progs) {
  gl.useProgram(prog.p);
  const u = prog.u;
  gl.uniform1f(u.uWire, prog === wireProg ? S.wire : 0);
  // Points this far past the edge are not lit (clip units): their sprite's half
  // size (the LED's, or its rays') and a little more. A wire's segment is short, so a wide margin is safe.
  const margin = Math.max(S.maxPx + 4, rays ? Math.min(rayLen * RAY_CAP, MAX_POINT / 2) + 2 : 0);
  if (prog === wireProg) gl.uniform2f(u.uCull, 1.5, 1.5);
  else gl.uniform2f(u.uCull, 1 + 2 * margin / W, 1 + 2 * margin / H);
  gl.uniform1f(u.uRays, rays);
  gl.uniform3f(u.uRayView, rayScale, (MAX_POINT - 1) / 2, 0); // the view's height over 1080 px; the longest ray the GPU draws
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uHeight, HEIGHT);
  gl.uniform1f(u.uGain, hasFloat ? 1 : S.exposure * glow); // without float buffers the points go to the screen
  gl.uniform1f(u.uFocal, (H / 2) / Math.tan(fovRad() / 2));
  gl.uniform1f(u.uSize, S.size);
  gl.uniform1f(u.uMaxPx, S.maxPx * renderScale); // pixels shrink with the scale
  gl.uniform1f(u.uRest, S.rest);
  gl.uniform3f(u.uLight, light.room, light.wire, light.twinkle);
  gl.uniform2fv(u.uRainK, [...light.share, ...light.fall, ...light.side]);
  gl.uniform1f(u.uRainGain, S.rainGain * (1 - egg.hush));   // (an overlay egg dims the rain's light while it shows)
  gl.uniform1f(u.uTipGain, S.tipGain * (1 - egg.hush));
  gl.uniform1f(u.uTrail, S.trail);
  gl.uniform1f(u.uBandShift, bandShift);
  gl.uniform1f(u.uBandScale, S.bandScale);
  gl.uniform1f(u.uSat, S.saturation);
  // The forms want the whole lattice: thinning belongs to the rain passages.
  gl.uniform2f(u.uDensity, 1 + (look.density[0] - 1) * rk, 1 + (look.density[1] - 1) * rk);
  gl.uniform1f(u.uBowStyle, { bands: 0, drop: 1, led: 2 }[S.rainbow] ?? 1);
  gl.uniform1f(u.uFlow, look.flow);
  gl.uniform1f(u.uRain, look.rain);
  gl.uniform1f(u.uTurn, direction.mix);
  gl.uniform2fv(u.uDirW, direction.weights);
  gl.uniform4fv(u.uGate, direction.gates);
  gl.uniform2fv(u.uFlowDir, flowDir);
  gl.uniform2f(u.uLane, SPAN / (GRID - 1), HEIGHT / ROWS);
  gl.uniform1f(u.uSpan, SPAN);
  const both = (...keys) => looks.flatMap((l) => keys.flatMap((key) => l[key]));
  gl.uniform1fv(u.uW, both('mode'));
  gl.uniform3fv(u.uSet, both('s0', 's1', 's2', 's3'));
  gl.uniform3fv(u.uAccent, both('acc'));
  gl.uniform3fv(u.uNear, both('near'));
  gl.uniform3fv(u.uFar, both('far'));
  gl.uniform1fv(u.uCloudHue, looks.map((l) => l.cloud[0]));
  gl.uniform1f(u.uSide, sideNow);
  const [sky0, sky1] = skyColors();
  gl.uniform3fv(u.uSky0, sky0);
  gl.uniform3fv(u.uSky1, sky1);
  gl.uniform1f(u.uFlowRate, look.flowRate);
  gl.uniform3fv(u.uGrad0, both('g0'));
  gl.uniform3fv(u.uGrad1, both('g1'));
  // Rain brings a mist: the far strands fade. An eye that stepped back sees as far into the room as before.
  gl.uniform1f(u.uFogFar, S.fog * fit.far * (1 - RAIN_MIST * rk));
  gl.uniform3fv(u.uColA, both('a'));
  gl.uniform3fv(u.uColB, both('b'));
  gl.uniform4fv(u.uRipples, ripples);
  // Rain spreads strand by strand as a rain passage comes, from the few
  // strands that carry pale drops in a still room.
  // Through a form it thins, so the form shows between the drops.
  gl.uniform1f(u.uRainShare, rainShareNow);
  gl.uniform1f(u.uRainMix, rk);
  // The falling rain's light goes as in a real room, as much as falling rain shows (see POINT_VS: phys).
  gl.uniform1f(u.uFallLight, fallLightNow);
  gl.uniform3fv(u.uEye, camera.eye);
  gl.uniform1f(u.uStorm, shown.storm);
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
  if (pointProg !== plain.point) eggs.bind(gl, u);
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
      // The rays are a glint in the eye, not light in the room: the images in
      // the floor cast none. Only the LEDs themselves write the rays' buffer.
      const withRays = prog === pointProg && mirror === 0 && rays > 0;
      if (prog === pointProg) gl.uniform1f(prog.u.uRayLen, withRays ? rayLen : 0);
      if (hasFloat) gl.drawBuffers(withRays ? BOTH : FIRST);
      // The LED's light has alpha 0, so it adds; a ray over earlier rays takes
      // their place as far as it is bright (its alpha), so crowded rays never sum to a sheet.
      if (withRays) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE);
      if (images > 1 && prog !== wireProg) gl.drawArraysInstanced(gl.POINTS, 0, count, images);
      else if (prog !== wireProg) gl.drawArrays(gl.POINTS, 0, count);
      else if (images > 1) gl.drawElementsInstanced(gl.LINE_STRIP, wireCount, gl.UNSIGNED_INT, 0, images);
      else gl.drawElements(gl.LINE_STRIP, wireCount, gl.UNSIGNED_INT, 0);
    }
  }
  gl.disable(gl.BLEND);

  // The glow and the haze: the haze is made from the glow's buffer, so with
  // both at 0 none of their passes runs, and the composite reads the scene alone.
  const glowOn = S.bloom > 0 || S.haze > 0;
  if (hasFloat && glowOn) {
    gl.bindVertexArray(emptyVao);
    // Downsample to a quarter.
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.viewport(0, 0, bloomA.w, bloomA.h);
    gl.useProgram(downProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(downProg.u.uTex, 0);
    gl.uniform1i(downProg.u.uRayTex, 1);
    gl.uniform1f(downProg.u.uRayK, 1);   // the rays glow with the rest
    gl.uniform2f(downProg.u.uTexel, 1 / W, 1 / H);
    gl.uniform1f(downProg.u.uKnee, BLOOM_KNEE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.uniform1f(downProg.u.uRayK, 0);
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
  }
  if (hasFloat) {
    gl.bindVertexArray(emptyVao);
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
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(compProg.u.uScene, 0);
    gl.uniform1i(compProg.u.uRayTex, 4);
    gl.uniform1i(compProg.u.uBloom, 1);
    gl.uniform1i(compProg.u.uHaze, 2);
    gl.uniform1i(compProg.u.uHazeWide, 3);
    gl.uniform1f(compProg.u.uHazeK, S.haze);
    gl.uniform1f(compProg.u.uBurn, S.burn);
    gl.uniform1f(compProg.u.uBloomK, S.bloom);   // (0: the glow's buffer is not read)
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
