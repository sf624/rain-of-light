// The static data: palettes, weather, flows, colour modes and the tunable settings.

export const small = Math.min(innerWidth, innerHeight) < 700;

export const PALETTES = [
  { name: 'ice',      a: [0.45, 0.70, 1.00], b: [0.95, 0.97, 1.00] },
  { name: 'amber',    a: [1.00, 0.50, 0.12], b: [1.00, 0.82, 0.50] },
  { name: 'sakura',   a: [1.00, 0.30, 0.65], b: [0.65, 0.40, 1.00] },
  { name: 'aurora',   a: [0.15, 1.00, 0.65], b: [0.35, 0.75, 1.00] },
  { name: 'deep sea', a: [0.10, 0.35, 1.00], b: [0.30, 0.95, 1.00] },
  { name: 'candle',   a: [1.00, 0.85, 0.55], b: [1.00, 1.00, 0.95] },
];

// Weather: how fast the drops fall (flow) and how many extra drops join (rain).
export const WEATHER = [
  { name: 'drizzle',  flow: 0.6, rain: 0.0,  hold: [10, 18], weight: 2 },
  { name: 'rain',     flow: 1.0, rain: 0.25, hold: [12, 22], weight: 3 },
  { name: 'shower',   flow: 1.9, rain: 0.6,  hold: [8, 14],  weight: 2 },
  { name: 'downpour', flow: 3.6, rain: 1.0,  hold: [6, 12],  weight: 0 },   // never on its own: the w key or the Weather setting
];
// Direction: rain falls from above. Sideways (each time a new way) is a choice,
// by the d key or the Direction setting; 'auto' changes between the two.
export const FLOWS = [
  { name: 'down',   toward: 0, hold: [20, 40], weight: 3 },
  { name: 'across', toward: 1, hold: [20, 40], weight: 1 },
];
// Colour modes. Their order is the order of the weights uW in the shader.
export const COLOR_MODES = [
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
export const MODE = Object.fromEntries(COLOR_MODES.map((m, i) => [m.name, i]));

// Sets of colours for the palette rain.
export const SETS = [
  { name: 'pastel', c: [[1.0, 0.62, 0.75], [0.62, 0.85, 1.0], [0.72, 1.0, 0.72], [1.0, 0.92, 0.6]] },
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
  [[0.45, 0.75, 1.0], [0.92, 0.96, 1.0]],   // day
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
// them. Each form picks its colours from a few of the palettes.
export const FORMS = [
  { name: 'orb',    type: 0, palettes: ['amber', 'candle', 'sakura', 'ice'] },
  { name: 'spiral', type: 1, palettes: ['deep sea', 'sakura', 'ice', 'aurora'] },
  { name: 'cloud',  type: 3, palettes: ['sakura', 'aurora', 'ice', 'deep sea'] },
];
export const LAYER = { name: 'layer', type: 2, palettes: ['deep sea', 'ice', 'aurora'] };

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
// Durations are in seconds; weight is how often a kind comes.
export const PASSAGES = [
  { name: 'rain',   rain: 1, sky: false, layer: 0.25, hold: [36, 70], weight: 2.2 },   // rain of light
  { name: 'form',   rain: 0, sky: true,  layer: 0.45, hold: [40, 66], weight: 3 },   // a form in the still room
  { name: 'storm',  rain: 1, sky: true,  layer: 0.3,  hold: [30, 52], weight: 1.6 },   // rain falls through a form
  { name: 'still',  rain: 0, sky: false, layer: 1,    hold: [18, 32], weight: 1 },   // only the layer, and sparse drops
];
// Scenes: the whole show, or only its rain, or only its forms.
export const SCENES = ['mix', 'rain', 'crystal'];

// ---------- tunable settings (panel: p key or the gear button; also ?key=value) ----------
export const DEFAULTS = {
  scene: 'mix', form: 'auto', layer: 'auto', mirror: 0.6, walls: 0, haze: 1.5, burn: 0.7, twinkle: 0.4, rainShare: 1,
  grid: small ? 44 : 72,  rows: small ? 72 : 96,
  layout: 'strands', density: 'auto', strandShare: 1.0, rowShare: 1.0, strandMin: 0.3, rowMin: 0.35,
  size: 0.018, maxPx: 4.5, rest: 0.03, wire: 0.2,
  rainGain: 4.0, tipGain: 5.0, exposure: 1.8, bloom: 0.8, fog: 34, blackFloor: 3,
  rays: '2', rayGain: 0.3, rayLength: 20, rayThreshold: 0.7,
  speed: 1.0, trail: 1.0, weather: 'auto', turnTime: 8, turnSteps: 9,
  color: 'auto', palette: 'auto', rainbow: 'drop', bandSpeed: 0.17, bandScale: 1.0, saturation: 1.0,
  set: 'auto', skyDay: 90,
  flow: 'down',
  camera: 'orbit', orbit: 0.025, radius: 10, fov: 76,
  ripples: 14,
  quality: 'auto',
  breath: 'on', breathRate: 6, breathDepth: 0.3,
  volume: 0.8, music: 0.6, chimes: 0.6, rainSound: 0.3,
};
// Older links used ?color=, ?weather= and ?flow= the same way, so they still work.
export const STORAGE_KEY = 'rain-of-light:settings';

export const SCHEMA = [
  { title: 'Scene', items: [
    { key: 'scene', label: 'Scene', options: SCENES,
      hint: 'mix: rain and forms of light come and go, and blend / rain: only the rain / crystal: only the forms of light' },
    { key: 'form', label: 'Form', options: ['auto', ...FORMS.map((f) => f.name), 'none'],
      hint: 'auto: as the scene brings them / or hold one form (none: no form)' },
    { key: 'layer', label: 'Layer of light', options: ['auto', 'on', 'off'] },
    { key: 'mirror', label: 'Floor mirror (0: off)', min: 0, max: 1, step: 0.05 },
    { key: 'walls', label: 'Wall mirrors (copies per side)', min: 0, max: 1, step: 1,
      hint: 'Each copy draws the lattice again: costly' },
    { key: 'haze', label: 'Haze (0: off)', min: 0, max: 2, step: 0.05,
      hint: 'A wide, soft glow around the brightest light' },
    { key: 'burn', label: 'Burn-out (0: off)', min: 0, max: 1, step: 0.05,
      hint: 'The brightest light loses its colour and burns out to white' },
    { key: 'twinkle', label: 'Twinkle', min: 0, max: 2, step: 0.05 },
    { key: 'rainShare', label: 'Share of strands with rain', min: 0, max: 1, step: 0.01 },
  ] },
  { title: 'Display', items: [
    { key: 'quality', label: 'Quality', options: ['auto', 'full'],
      hint: 'auto: lowers the sharpness if frames are slow, and raises it again when they are not / full: always as sharp as the screen allows' },
  ] },
  { title: 'Density', items: [
    { key: 'grid', label: 'Strands per side (max)', min: 8, max: 160, step: 1 },
    { key: 'rows', label: 'LEDs per strand (max)', min: 8, max: 256, step: 1 },
    { key: 'layout', label: 'Layout', options: ['strands', 'scatter', 'grid'],
      hint: 'strands: in lines along each strand / scatter: at random within one strand\'s width / grid: a regular lattice' },
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
    { key: 'exposure', label: 'Exposure', min: 0.2, max: 4, step: 0.05 },
    { key: 'bloom', label: 'Glow', min: 0, max: 2, step: 0.05 },
    { key: 'fog', label: 'Visible distance', min: 6, max: 40, step: 0.5 },
    { key: 'rays', label: 'Light rays', options: ['off', '2', '4', '6', '8'],
      hint: 'Star-like rays from the brightest points: 2 is up and down only' },
    { key: 'rayGain', label: 'Ray brightness', min: 0, max: 2, step: 0.05 },
    { key: 'rayLength', label: 'Ray length (px at 1080 tall)', min: 2, max: 60, step: 1,
      hint: 'Scales with the view, like the LEDs and their spacing' },
    { key: 'rayThreshold', label: 'Ray threshold', min: 0.1, max: 4, step: 0.05,
      hint: 'Only light brighter than this casts rays' },
    { key: 'blackFloor', label: 'Black floor (/255, 0: off)', min: 0, max: 16, step: 0.5,
      hint: 'Glow fainter than this is dropped, so the space between the points is true black (most visible on OLED screens)' },
  ] },
  { title: 'Rain', items: [
    { key: 'weather', label: 'Weather', options: ['auto', 'drizzle', 'rain', 'shower', 'downpour'] },
    { key: 'speed', label: 'Speed (x)', min: 0, max: 4, step: 0.05 },
    { key: 'trail', label: 'Trail length (x)', min: 0.2, max: 4, step: 0.05 },
    { key: 'flow', label: 'Direction', options: ['auto', 'down', 'across'],
      hint: 'down: from above / across: sideways (a random way each time) / auto: changes between them' },
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
    { key: 'camera', label: 'Move', options: ['auto', ...CAMERAS.map((c) => c.name)],
      hint: 'orbit: circle the field / walk: wander through it / spin: look around from the centre / gaze: look up and down / rise: drift up and down' },
    { key: 'orbit', label: 'Move speed', min: 0, max: 0.2, step: 0.005 },
    { key: 'radius', label: 'Distance from the centre', min: 0, max: 16, step: 0.1 },
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
  ] },
  { title: 'Sound (m key or the note button)', items: [
    { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01 },
    { key: 'music', label: 'Pad', min: 0, max: 1, step: 0.05 },
    { key: 'chimes', label: 'Bells', min: 0, max: 1, step: 0.05 },
    { key: 'rainSound', label: 'Rain', min: 0, max: 1, step: 0.05 },
  ] },
];
