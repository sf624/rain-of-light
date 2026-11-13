// The static data: palettes, weather, flows, colour modes and the tunable settings.

import { SOLIDS, KNOTS } from './figures.js';

export const small = Math.min(innerWidth, innerHeight) < 700;

export const PALETTES = [
  { name: 'ice',      a: [0.45, 0.70, 1.00], b: [0.95, 0.97, 1.00] },
  { name: 'amber',    a: [1.00, 0.50, 0.12], b: [1.00, 0.82, 0.50] },
  { name: 'sakura',   a: [1.00, 0.30, 0.65], b: [0.65, 0.40, 1.00] },
  { name: 'aurora',   a: [0.15, 1.00, 0.65], b: [0.35, 0.75, 1.00] },
  { name: 'deep sea', a: [0.10, 0.35, 1.00], b: [0.30, 0.95, 1.00] },
  { name: 'candle',   a: [1.00, 0.85, 0.55], b: [1.00, 1.00, 0.95] },
];
// The pale ones: light of these has little colour of its own.
export const PALE = ['ice', 'candle'];

// Weather: how fast the drops fall (flow) and how many extra drops join (rain).
export const WEATHER = [
  { name: 'drizzle',  flow: 0.6, rain: 0.08, hold: [10, 18], weight: 2 },
  { name: 'rain',     flow: 1.0, rain: 0.25, hold: [12, 22], weight: 3 },
  { name: 'shower',   flow: 1.9, rain: 0.6,  hold: [8, 14],  weight: 0 },   // the two heavy ones never come on their own:
  { name: 'downpour', flow: 3.6, rain: 1.0,  hold: [6, 12],  weight: 0 },   // only by the w key or the Weather setting
];
// Direction: rain falls from above, or flows sideways. Which one belongs to the
// passage (see PASSAGES, drift): a rain keeps its direction for its whole life.
export const FLOWS = [
  { name: 'down',   toward: 0 },
  { name: 'across', toward: 1 },
];
// Colour modes. Their order is the order of the weights uW in the shader.
// many: rain of many colours at once, whatever the mood (see director.js, the colour story).
export const COLOR_MODES = [
  { name: 'mono',     hold: [14, 26], weight: 3 },   // one palette
  { name: 'gradient', hold: [14, 24], weight: 2 },   // two palettes, flowing
  { name: 'rainbow',  hold: [10, 18], weight: 1.5, many: true }, // a random hue per drop
  { name: 'palette',  hold: [14, 24], weight: 2 },   // each drop picks from a set of colours
  { name: 'accent',   hold: [12, 20], weight: 1 },   // pale rain, now and then a coloured drop
  { name: 'comet',    hold: [12, 20], weight: 1.5 }, // white heads, coloured trails
  { name: 'speed',    hold: [12, 20], weight: 1, many: true },   // slow drops warm, fast ones blue-white
  { name: 'cloud',    hold: [16, 28], weight: 2 },   // drifting clouds of colour
  { name: 'depth',    hold: [12, 20], weight: 1, many: true },   // one colour near, another far
  { name: 'repaint',  hold: [20, 32], weight: 1.2, many: true }, // each wave paints the field anew
  { name: 'sky',      hold: [45, 75], weight: 1, many: true },   // dawn, day, dusk and night go by
];
COLOR_MODES.forEach((m, i) => { m.mode = COLOR_MODES.map((_, k) => (k === i ? 1 : 0)); });
export const MODE = Object.fromEntries(COLOR_MODES.map((m, i) => [m.name, i]));

// Sets of colours for the palette rain.
export const SETS = [
  { name: 'pastel', c: [[1.0, 0.45, 0.65], [0.42, 0.72, 1.0], [0.5, 1.0, 0.6], [1.0, 0.82, 0.38]] },
  { name: 'neon',   c: [[1.0, 0.1, 0.6], [0.1, 0.9, 1.0], [0.7, 1.0, 0.1], [0.6, 0.2, 1.0]] },
  { name: 'wa',     c: [[0.93, 0.25, 0.15], [0.15, 0.3, 0.85], [1.0, 0.72, 0.1], [0.45, 0.8, 0.35]] },
  { name: 'sunset', c: [[1.0, 0.35, 0.1], [1.0, 0.62, 0.2], [0.9, 0.2, 0.45], [0.55, 0.25, 0.9]] },
  { name: 'ocean',  c: [[0.1, 0.4, 1.0], [0.2, 0.9, 0.9], [0.6, 0.9, 1.0], [0.15, 0.95, 0.6]] },
];
export const ACCENTS = [[1.0, 0.68, 0.12], [1.0, 0.15, 0.1], [0.1, 0.85, 1.0], [1.0, 0.2, 0.8], [0.4, 1.0, 0.3]];
export const DEPTHS = [                                       // near, far
  [[1.0, 0.55, 0.15], [0.1, 0.3, 1.0]],
  [[1.0, 0.35, 0.55], [0.1, 0.85, 0.8]],
  [[1.0, 0.85, 0.3], [0.55, 0.2, 1.0]],
  [[0.3, 1.0, 0.6], [0.2, 0.35, 1.0]],
];
// The sky through one day: colour at the top, colour at the bottom.
export const SKY = [
  [[0.35, 0.35, 0.95], [1.0, 0.55, 0.45]],  // dawn
  [[0.25, 0.6, 1.0], [0.7, 0.9, 1.0]],      // day
  [[0.6, 0.25, 0.85], [1.0, 0.45, 0.12]],   // dusk
  [[0.08, 0.15, 0.65], [0.35, 0.45, 0.95]], // night
];
// Camera moves. All run on one clock, so any blend of them moves smoothly.
export const CAMERAS = [
  { name: 'orbit', hold: [30, 50], weight: 3 },
  { name: 'walk',  hold: [25, 40], weight: 2 },
  { name: 'spin',  hold: [20, 35], weight: 1.5 },
  { name: 'gaze',  hold: [20, 30], weight: 1 },
  { name: 'rise',  hold: [25, 40], weight: 1.5 },
];

// Forms of light. Sky forms come one at a time (two while one turns into the
// next); the layer (a sea of light near the floor) comes and goes beside
// them. Each form picks its colours from a few of the palettes. type is the
// form's number in the shader (see formsAt in shaders.js); weight is how
// often it comes (see the casting in show.js): the forms of nature come more
// often than the forms of mathematics. variants: the figures a form may be,
// one for each of its lives (see figures.js, and show.js: variantOf).
export const FORMS = [
  { name: 'orb',       type: 0, weight: 1,   palettes: ['amber', 'candle', 'sakura', 'deep sea'] },
  { name: 'spiral',    type: 1, weight: 1,   palettes: ['deep sea', 'sakura', 'ice', 'aurora'] },
  { name: 'ring',      type: 3, weight: 1,   palettes: ['amber', 'aurora', 'sakura', 'deep sea'] },
  { name: 'veil',      type: 4, weight: 1,   palettes: ['aurora', 'sakura', 'deep sea', 'amber'] },
  { name: 'solid',     type: 5, weight: 0.4, palettes: ['ice', 'amber', 'aurora', 'sakura'], variants: SOLIDS.map((x) => x.name) },
  { name: 'knot',      type: 6, weight: 0.4, palettes: ['aurora', 'amber', 'sakura', 'deep sea'], variants: KNOTS.map((x) => x.name) },
];
export const LAYER = { name: 'layer', type: 2, palettes: ['deep sea', 'ice', 'aurora', 'sakura', 'amber'] };
// The baked forms: shapes baked into fields of distance (fields/*.bin, see
// fields.js and tools/bake-field.py), drawn as a glowing skin. They are not
// cast like the forms above: rarely, one of them takes a form's place (see
// EGG and the casting in show.js), and the viewer's settings never name them.
// field: its slab in the shader's field; size: half the side of its box;
// top: the top of its shape in that box (-1 .. 1, as tools/bake-field.py prints it).
export const EGGS = [
  { name: 'teapot', type: 7, field: 0, size: 5.6, top: -0.019, palettes: ['ice', 'candle'] },
];
// after: never before this time (s); chance: of each form that is cast after it.
export const EGG = { after: 600, chance: 0.012 };

// The room: strands of LEDs over a mirror floor, the same for the whole show.
export const ROOM = {
  span: 36,      // width and depth of the lattice
  height: 15,    // its height, centred on 0
  foot: 0.45,    // the strands end this far above the mirror floor
  eye: 2.2,      // the eye's height above the floor
  pitch: 0.06,   // and how far it looks up
};

// The show moves between passages (see show.js). A passage sets how much
// rain falls, which form of light shows, and whether the layer glows.
// Durations are in seconds; weight is how often a kind comes; layer is the
// chance that the layer glows (it shows for about 70% of the show).
export const PASSAGES = [
  { name: 'rain',   rain: 1, sky: false, layer: 0.55, hold: [36, 70], weight: 2.2 },   // rain of light
  { name: 'form',   rain: 0, sky: true,  layer: 0.75, hold: [40, 66], weight: 3 },   // a form in the still room
  { name: 'storm',  rain: 1, sky: true,  layer: 0.5,  hold: [30, 52], weight: 1.6 },   // rain falls through a form
  { name: 'still',  rain: 0, sky: false, layer: 1,    hold: [18, 32], weight: 1 },   // only the layer, and sparse drops
  // Rain that flows sideways, each time a new way: an event of its own, only
  // ever between two form passages, so it never reads as a rain that turned.
  { name: 'drift',  rain: 1, sky: false, layer: 0.55, hold: [30, 48], weight: 1.3, across: true },
];
// Scenes: the whole show, or only its rain, or only its forms.
export const SCENES = ['mix', 'rain', 'crystal'];

// ---------- tunable settings (panel: p key or the gear button; also ?key=value) ----------
export const DEFAULTS = {
  scene: 'mix', form: 'auto', solid: 'auto', knot: 'auto', layer: 'auto', mirror: 0.6, walls: 0, haze: 0, burn: 0.7, twinkle: 0.4, rainShare: 1,
  leds: small ? 210 : 1000, aspect: 1, grid: 0, rows: 0,
  layout: 'strands', jitter: 'off', density: 'auto', strandShare: 1.0, rowShare: 1.0, strandMin: 0.66, rowMin: 0.68,
  size: 0.018, maxPx: 4.5, rest: 0.03, wire: 0.2,
  rainGain: 4.0, tipGain: 5.0, exposure: 2.2, bloom: 0, fog: 34, blackFloor: 3,
  rays: '2', rayLength: 10,
  speed: 1.0, trail: 1.0, weather: 'auto',
  color: 'auto', story: 'on', palette: 'auto', rainbow: 'drop', bandSpeed: 0.17, bandScale: 1.0, saturation: 1.0,
  set: 'auto', skyDay: 90,
  flow: 'auto',
  camera: 'orbit', orbit: 0.025, radius: 10, fov: 76,
  ripples: 14,
  quality: 'auto',
  breath: 'on', breathRate: 6, breathDepth: 0.3,
  volume: 0.8, music: 0.6, chimes: 0.6, rainSound: 0.3, formSound: 0.4,
};
// Older links used ?color=, ?weather= and ?flow= the same way, so they still work.
export const STORAGE_KEY = 'rain-of-light:settings';

// The panel. An item with `viewer: n` is also on the viewer page's small
// panel (index.html), as its nth control, under `short` if it has one; the
// lab (lab.html) shows every item.
export const SCHEMA = [
  { title: 'Scene', items: [
    { key: 'scene', label: 'Scene', options: SCENES, viewer: 1,
      hint: 'mix: rain and forms of light come and go, and blend / rain: only the rain / crystal: only the forms of light' },
    { key: 'form', label: 'Form', options: ['auto', ...FORMS.map((f) => f.name), ...EGGS.map((f) => f.name), 'none'],
      hint: 'auto: as the scene brings them / or hold one form (none: no form)' },
    ...FORMS.filter((f) => f.variants).map((f) => ({ key: f.name, label: `Which ${f.name}`, options: ['auto', ...f.variants],
      hint: `auto: each time the ${f.name} comes, another of its figures / or always this one` })),
    { key: 'layer', label: 'Layer of light', options: ['auto', 'on', 'off'] },
    { key: 'mirror', label: 'Floor mirror (0: off)', min: 0, max: 1, step: 0.05 },
    { key: 'walls', label: 'Wall mirrors (copies per side)', min: 0, max: 1, step: 1,
      hint: 'Each copy draws the lattice again: costly' },
    { key: 'haze', label: 'Haze (0: off)', min: 0, max: 2, step: 0.05,
      hint: 'A wide, soft glow around the brightest light' },
    { key: 'burn', label: 'Burn-out (0: off)', min: 0, max: 1, step: 0.05,
      hint: 'The brightest light loses its colour and burns out to white' },
    { key: 'twinkle', label: 'Twinkle', min: 0, max: 2, step: 0.05 },
    { key: 'rainShare', label: 'Share of strands with rain', min: 0, max: 1, step: 0.01,
      hint: 'At 1, every strand of a lattice of up to 72 a side; a denser one carries rain on as many strands per area, not on all' },
  ] },
  { title: 'Display', items: [
    { key: 'quality', label: 'Quality', options: ['auto', 'full'], viewer: 4,
      hint: 'auto: lowers the sharpness if frames are slow, and raises it again when they are not / full: always as sharp as the screen allows' },
  ] },
  { title: 'Density', items: [
    { key: 'leds', label: 'LEDs in all (thousands)', min: 20, max: 1700, step: 10,
      hint: 'How many LEDs the room holds: the strands and the LEDs on each follow, spaced as Spacing says. More LEDs show the forms finer, and cost more' },
    { key: 'aspect', label: 'Spacing along / between strands', min: 0.25, max: 4, step: 0.05,
      hint: '1: the LEDs on a strand are as far apart as the strands / under 1: closer along the strands / over 1: farther' },
    { key: 'grid', label: 'Strands per side (0: auto)', min: 0, max: 160, step: 1,
      hint: 'Set: this many strands, and the LEDs per strand follow at the spacing (unless set too) / 0: from LEDs in all' },
    { key: 'rows', label: 'LEDs per strand (0: auto)', min: 0, max: 256, step: 1,
      hint: 'Set: this many LEDs on each strand, and the strands follow at the spacing (unless set too) / 0: from LEDs in all' },
    { key: 'layout', label: 'Layout', options: ['strands', 'scatter', 'grid'],
      hint: 'strands: in lines along each strand / scatter: at random within one strand\'s width / grid: a regular lattice' },
    { key: 'jitter', label: 'LED spacing', options: ['off', '0.25', '0.5', 'pitch', 'cluster'],
      labels: ['even', 'a little uneven', 'uneven', 'per strand', 'clustered'],
      hint: 'How the LEDs sit along each strand. even: one gap apart / a little uneven, uneven: each LED moved by up to a quarter, or half, of the gap / per strand: each strand evenly spaced, at its own gap / clustered: in bunches and gaps' },
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
    { key: 'rest', label: 'Brightness at rest', min: 0, max: 0.3, step: 0.001 },
    { key: 'wire', label: 'Wire glow (0: off)', min: 0, max: 2, step: 0.05,
      hint: 'The wires between the LEDs glow with their light' },
  ] },
  { title: 'Light', items: [
    { key: 'rainGain', label: 'Trail brightness', min: 0, max: 12, step: 0.1 },
    { key: 'tipGain', label: 'Head brightness', min: 0, max: 15, step: 0.1 },
    { key: 'exposure', label: 'Exposure', min: 0.2, max: 4, step: 0.05, viewer: 3, short: 'Brightness' },
    { key: 'bloom', label: 'Glow', min: 0, max: 2, step: 0.05 },
    { key: 'fog', label: 'Visible distance', min: 6, max: 40, step: 0.5 },
    { key: 'rays', label: 'Light rays', options: ['off', '2', '4', '6', '8'],
      hint: 'Star-like rays from the brightest points: 2 is up and down only' },
    { key: 'rayLength', label: 'Ray length (px at 1080 tall, bright point)', min: 2, max: 60, step: 1,
      hint: 'How long the rays of a bright point are. Dimmer light casts shorter rays, down to none, so far points cast short ones. Scales with the view, like the LEDs and their spacing' },
    { key: 'blackFloor', label: 'Black floor (/255, 0: off)', min: 0, max: 16, step: 0.5,
      hint: 'Glow fainter than this is dropped, so the space between the points is true black (most visible on OLED screens)' },
  ] },
  { title: 'Rain', items: [
    { key: 'weather', label: 'Weather', options: ['auto', 'drizzle', 'rain', 'shower', 'downpour'] },
    { key: 'speed', label: 'Speed (x)', min: 0, max: 4, step: 0.05 },
    { key: 'trail', label: 'Trail length (x)', min: 0.2, max: 4, step: 0.05 },
    { key: 'flow', label: 'Direction', options: ['auto', 'down', 'across'],
      hint: 'auto: as the passage has it (now and then a passage of sideways rain) / down: from above / across: sideways' },
  ] },
  { title: 'Colour', items: [
    { key: 'color', label: 'Colour mode', options: ['auto', ...COLOR_MODES.map((m) => m.name)], viewer: 2,
      hint: 'mono: one palette / gradient: flowing gradient / rainbow: a hue per drop / '
        + 'palette: each drop picks from a set / accent: pale rain, now and then a coloured drop / '
        + 'comet: white heads, coloured trails / speed: colour by speed / cloud: drifting clouds of colour / '
        + 'depth: near and far / repaint: waves repaint the field / sky: a day goes by' },
    { key: 'story', label: 'Colour story', options: ['on', 'off'],
      hint: 'on: the colours of the rain and the forms drift slowly together, from cool to warm and back / off: each is chosen on its own' },
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
    { key: 'camera', label: 'Move', options: ['auto', ...CAMERAS.map((c) => c.name)],
      hint: 'orbit: circle the field / walk: wander through it / spin: look around from the centre / gaze: look up and down / rise: drift up and down' },
    { key: 'orbit', label: 'Move speed', min: 0, max: 0.2, step: 0.005 },
    { key: 'radius', label: 'Distance from the centre', min: 0, max: 16, step: 0.1,
      hint: 'As set in a view of 16:9 or wider; in a narrower one (a phone held upright) the eye steps back' },
    { key: 'fov', label: 'Field of view (deg)', min: 30, max: 110, step: 1,
      hint: 'As set in a view of 16:9 or wider; a narrower one opens further, so the room keeps its size' },
  ] },
  { title: 'Ripples', items: [
    { key: 'ripples', label: 'Auto interval, about (s, 0: none)', min: 0, max: 30, step: 0.5 },
  ] },
  { title: 'Meditation', items: [
    { key: 'breath', label: 'Breathing guide', options: ['on', 'off'],
      hint: 'The light and the pad swell as you breathe in (4 parts) and fade as you breathe out (6 parts)' },
    { key: 'breathRate', label: 'Breaths per minute', min: 3, max: 12, step: 0.5 },
    { key: 'breathDepth', label: 'Depth of the swell', min: 0, max: 0.8, step: 0.05 },
  ] },
  { title: 'Sound (m key or the note button)', items: [
    { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },
    { key: 'music', label: 'Pad', min: 0, max: 1, step: 0.05, viewer: 5 },
    { key: 'chimes', label: 'Bells', min: 0, max: 1, step: 0.05, viewer: 6 },
    { key: 'rainSound', label: 'Rain', min: 0, max: 1, step: 0.05, viewer: 7 },
    { key: 'formSound', label: 'Forms', min: 0, max: 1, step: 0.05, viewer: 8,
      hint: 'The voice each form of light brings: the orb a low hum, the spiral a turning figure, the ring a glassy tone, the veil a soft air, the solid a chord of pure fifths, the knot two beating tones' },
  ] },
];
