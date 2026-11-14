// A study: the whole room as a lattice of cubes drawn in light (an easter egg
// of the lab only, ?egg=cubes; never cast by the show). Its light is a chunk
// of the LEDs' vertex shader (CUBES_GLSL, behind EGG_6: only the programs
// built for it hold it, see egg-shaders.js); cubesParams works out its
// uniforms per frame, a function of the show's time alone.
//
// The lattice's lines run along the room's axes, on the strands' own grid:
// a cube's edge is a whole number of strand gaps across and of LED gaps up,
// on any lattice of LEDs (the phone's is much sparser). A vertical line is a
// whole strand; a horizontal one a row of LEDs, one per strand, at one
// height. Each LED is lit by how near it stands to a line, in LED gaps:
// exp(-s^2 sharp), with s its offset from the line's planes; the 'index'
// mode measures that from the place the LED stands for on the strands'
// regular grid (so a line is exactly one LED thick, and follows the strands'
// jitter, so a row zigzags by up to half a gap), the 'world' mode from where
// it is (a soft line, as straight as the LEDs around it allow; the turned
// lattice needs it). The 'snap' mode is 'index' with the LEDs on the lines
// moved onto the regular grid (cubesPlace): straight lines of single LEDs.

// The variants of the study (?cubes=name in the lab; window.__cubesTune = { ... } overrides any
// of these at once, to try values in the lab's console):
//   cell, cellY   a cube's edge across and up (units), rounded to whole gaps on each lattice
//   mode          'snap', 'index' or 'world' (see above); turn: the lattice turned about the vertical (radians, world only)
//   glow          the light of an LED one gap off a line, over one on it (its soft core)
//   vert          the vertical lines' light, over the horizontal ones' (whole strands lit can overpower)
//   node          extra light where lines meet (0: none; the lines add up there anyway, unless max)
//   max           1: an LED takes the brightest of its lines, not their sum (no bright nodes)
//   fade          units: the lattice fades with distance from the eye over this long (far lines: a haze)
//   gain          the lines' light
//   a, b          two colours, mixed by a slow drifting field through the room
//   wave          how deep the slow waves of brightness go (0 .. 1)
//   pulses        how many signals run along the lines at a time, turning at the nodes; speed: cells a second
//   pc, pg        their colour and light
//   cells         the share of cubes whose edges light up now and then (0: none); fill: their inside's light
//   wire          the share of a vertical line's light its strand's wire shows (0: a line of points only)
const VARIANTS = {
  a: { cell: 4.5, cellY: 3.75, mode: 'snap', glow: 0, vert: 0.5, node: 0.4, max: 0, fade: 8, gain: 40,
    a: [0.42, 0.66, 1.0], b: [0.86, 0.93, 1.0], wave: 0.35, pulses: 24, speed: 1.3, pc: [1.0, 0.72, 0.38], pg: 12,
    cells: 0.03, fill: 0, wire: 0.5, turn: 0 },
  b: { cell: 3, cellY: 3, a: [1.0, 0.3, 0.65], b: [0.55, 0.45, 1.0], wave: 0.6, pulses: 0, cells: 0.05, node: 0.2 },
  c: { cell: 6, cellY: 5, vert: 1, node: 2.5, a: [1.0, 0.85, 0.55], b: [1.0, 1.0, 0.95], pulses: 10, pc: [1, 1, 1], pg: 5,
    cells: 0.06, fill: 0.05, wave: 0.25 },
};
const BASE = VARIANTS.a;
const pick = () => {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('cubes');
  return { ...BASE, ...(VARIANTS[q] || {}) };
};
let chosen = null;

// The life of a pin: the lattice grows from a seed node (its front runs
// along the lines, so it spreads as an octahedron, by the lattice's own
// distance), holds, then goes out edge by edge, and grows again from a new seed.
export const CUBES_LIFE = { cycle: 90, grow: 20, go: 12 };

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const put = (v, i, ...xs) => v.set(xs, i * 4);
const frac = (x) => x - Math.floor(x);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);

export function cubesParams(s, ctx, out) {
  chosen ??= pick();
  const V = { ...chosen, ...(globalThis.__cubesTune || {}) };
  const [gx, gy] = ctx.lane;
  const GRID = Math.round(ctx.SPAN / gx) + 1, ROWS = Math.round(ctx.HEIGHT / gy);
  const nx = Math.max(2, Math.round(V.cell / gx)), ny = Math.max(2, Math.round(V.cellY / gy));
  // The lowest corner node: lines on the strands i0, i0 + nx ...; the lowest row of LEDs, and every ny-th above it.
  const i0 = Math.floor(((GRID - 1) % nx) / 2);
  const x0 = -ctx.SPAN / 2 + i0 * gx, y0 = -ctx.HEIGHT / 2 + 0.5 * gy;
  const NX = Math.floor((GRID - 1 - i0) / nx), NY = Math.floor((ROWS - 1) / ny);
  const cx = nx * gx, cy = ny * gy;
  const world = V.mode === 'world' || V.turn ? 1 : V.mode === 'snap' ? 2 : 0;
  // The life of the pin.
  const L = CUBES_LIFE, age = s.age;
  const n = Math.floor(age / L.cycle), x = age - n * L.cycle;
  const seed = [Math.floor(NX * (0.3 + 0.4 * hash(n * 3.1 + 1))), Math.floor(NY * (0.2 + 0.5 * hash(n * 5.7 + 2))), Math.floor(NX * (0.3 + 0.4 * hash(n * 7.3 + 3)))];
  // (the farthest node from the seed, along the lines)
  const reach = (Math.max(seed[0], NX - seed[0]) + Math.max(seed[2], NX - seed[2])) * cx + Math.max(seed[1], NY - seed[1]) * cy;
  const front = 2.5;
  const R = x < L.grow ? smooth(x / L.grow) * (reach + 2 * front) : reach + 2 * front;
  const gone = smooth((x - (L.cycle - L.go)) / L.go);
  // A slow breath of the whole lattice, two periods that never fall into step.
  const breath = 0.88 + 0.06 * Math.sin(age * 2 * Math.PI / 11.3) + 0.06 * Math.sin(age * 2 * Math.PI / 17.9 + 1.3);
  // The slow waves run along a way that turns slowly.
  const wa = 0.7 + age * 0.011, k = (2 * Math.PI) / 26;
  put(out.v, 0, x0, y0, x0, world);
  put(out.v, 1, cx, cy, cx, -Math.log(Math.max(1e-4, V.glow)));
  put(out.v, 2, V.vert, V.node, V.fade, V.gain * breath * (V.max ? -1 : 1));
  put(out.v, 3, ...V.a, V.wave);
  put(out.v, 4, ...V.b, V.wire);
  put(out.v, 5, ...V.pc, V.pg);
  put(out.v, 6, x0 + seed[0] * cx, y0 + seed[1] * cy, x0 + seed[2] * cx, R);
  put(out.v, 7, NX, NY, V.pulses, V.speed);
  put(out.v, 8, front, gone, V.turn, V.cells);
  put(out.v, 9, Math.cos(wa) * k, 0.35 * k, Math.sin(wa) * k, V.fill);
  return 1;
}

// The light (see the top of the file). uEggV as cubesParams puts it:
// v0: the lowest node, mode (0: index, 1: world, 2: snap); v1: a cell's size, sharp; v2: vert, node, fade, gain (< 0: max);
// v3: colour a, wave; v4: colour b, wire; v5: the pulses' colour, light; v6: the seed node, the
// growth's reach (along the lines); v7: nodes across, up, pulses, speed; v8: the front's width, how
// far it has gone (0 .. 1), turn, cells; v9: the waves' way (radians a unit), fill.
export const CUBES_GLSL = `
vec3 CubesCalm = vec3(0.0);   // the lines' light: it casts no rays (POINT_VS takes it out of glint)
float cubeF(float s, float k) { return exp(-s * s * k); }
vec3 cubeAxis(int i) { return i == 0 ? vec3(1.0, 0.0, 0.0) : i == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0); }
// A cube's edges light up now and then: its own slow time, and a draw per turn of it.
float cubeLit(vec3 c, float chance) {
  float per = 26.0;
  float ph = uTime / per + hash3(c + 0.37);
  float e = floor(ph), x = (ph - e) * per;
  return step(hash3(c * 1.31 + e * 7.17 + 3.1), chance) * smoothstep(0.0, 5.0, x) * (1.0 - smoothstep(9.0, 16.0, x));
}
// Where the LED stands on the strands' regular grid: its strand, its row.
vec3 cubeIdeal(vec3 p) {
  float rows = floor(uHeight / uLane.y + 0.5);
  return vec3(floor((p.x + 0.5 * uSpan) / uLane.x + 0.5) * uLane.x - 0.5 * uSpan,
    (0.5 - (floor((0.5 - p.y / uHeight) * rows) + 0.5) / rows) * uHeight,
    floor((p.z + 0.5 * uSpan) / uLane.x + 0.5) * uLane.x - 0.5 * uSpan);
}
// The snap (mode 2): an LED on a line steps onto its place on the regular
// grid (at most half a gap each way) as the growth reaches it, and back as
// the lattice goes: the lines are straight whatever the strands' jitter.
vec3 cubesPlace(vec3 p) {
  vec4 v0 = uEggV[0], v6 = uEggV[6], v8 = uEggV[8];
  if (v0.w < 1.5 || uEgg.y <= 0.0) return p;
  vec3 i = cubeIdeal(p);
  vec3 g = (i - v0.xyz) / uEggV[1].xyz;
  vec3 s = abs(g - floor(g + 0.5)) * uEggV[1].xyz / vec3(uLane.x, uLane.y, uLane.x);
  // On a line: on two of the three planes.
  float on = step(s.x, 0.25) * step(s.z, 0.25) + step(s.y, 0.25) * (step(s.x, 0.25) + step(s.z, 0.25));
  float d1 = dot(abs(i - v6.xyz), vec3(1.0));
  float w = min(on, 1.0) * (1.0 - smoothstep(v6.w - v8.x * 2.0, v6.w - v8.x, d1)) * (1.0 - v8.y);
  return mix(p, i, w);
}
vec3 cubesLight(vec3 p, float id, vec4 a, inout vec3 thread) {
  vec4 v0 = uEggV[0], v1 = uEggV[1], v2 = uEggV[2], v6 = uEggV[6], v7 = uEggV[7], v8 = uEggV[8];
  vec3 cell = v1.xyz, gap = vec3(uLane.x, uLane.y, uLane.x);
  float sharp = v1.w;
  vec3 q = abs(v0.w - 1.0) > 0.5 ? cubeIdeal(p) : p;
  q -= v0.xyz;
  if (v8.z != 0.0) {
    vec3 m = vec3(0.5 * uSpan - v0.x, 0.0, 0.5 * uSpan - v0.z);   // (about the room's middle)
    float cs = cos(v8.z), sn = sin(v8.z);
    q -= m;
    q.xz = vec2(cs * q.x + sn * q.z, -sn * q.x + cs * q.z);
    q += m;
  }
  vec3 g = q / cell;
  vec3 n = floor(g + 0.5);
  vec3 s = (g - n) * cell / gap;                   // off the nearest planes of lines, in LED gaps
  vec3 f = vec3(cubeF(s.x, sharp), cubeF(s.y, sharp), cubeF(s.z, sharp));
  vec3 l = vec3(f.y * f.z, f.x * f.z, f.x * f.y);  // on a line along x, y, z
  // It grows from the seed along the lines, a bright front ahead; it goes edge by edge.
  float d1 = dot(abs(q - (v6.xyz - v0.xyz)), vec3(1.0));
  float grown = 1.0 - smoothstep(v6.w - v8.x, v6.w, d1);
  float dist = length(p - uEye);
  float k = v2.w * (uLane.x / 0.4557) / uLight.x;  // light per unit of a line's length on any lattice
  float fade = exp(-max(0.0, dist - 4.0) / v2.z);  // near lines strong, far ones a haze of fine lines
  // The inside of a lit cube: a faint volume of light (fill).
  vec3 fill = vec3(0.0);
  if (uEggV[9].w > 0.0 && v8.w > 0.0) {
    fill = uEggV[3].rgb * uEggV[9].w * cubeLit(floor(g), v8.w) * grown * (1.0 - v8.y) * abs(k) * fade;
    CubesCalm = fill;
  }
  if (max(l.x, max(l.y, l.z)) < 0.003) return fill;
  float tip = exp(-pow((v6.w - v8.x * 0.6 - d1) / v8.x, 2.0)) * step(d1, v6.w);
  int ax = l.x >= l.y && l.x >= l.z ? 0 : l.y >= l.z ? 1 : 2;   // the line it is on (at a node, any)
  vec3 e = cubeAxis(ax);
  vec3 edge = n * (1.0 - e) + floor(g) * e;        // its edge: the nodes round it, and which cell along
  float keep = clamp((hash3(edge * 1.7 + float(ax) * 11.3) - v8.y) / 0.12 + 1.0, 0.0, 1.0) * (1.0 - v8.y * 0.5);
  float w = grown * keep;
  if (w < 0.001 && tip < 0.001) return fill;
  float lines = v2.w < 0.0 ? max(max(l.x, l.z), l.y * v2.x) : l.x + l.z + l.y * v2.x;
  lines += v2.y * f.x * f.y * f.z;
  // The slow waves, and the colours drifting through the room.
  vec4 v9 = uEggV[9];
  float wave = 1.0 - uEggV[3].w * (0.5 + 0.5 * sin(dot(q, v9.xyz) - uTime * 0.16));
  vec3 col = mix(uEggV[3].rgb, uEggV[4].rgb, smoothstep(0.25, 0.75, noise3(q * 0.07 + vec3(0.0, uTime * 0.02, uTime * 0.013))));
  // Cubes whose edges light up: the cells round its edge.
  float lit = 0.0;
  if (v8.w > 0.0) {
    vec3 o1 = ax == 0 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), o2 = ax == 2 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 c0 = edge - o1 - o2;
    lit = max(max(cubeLit(c0, v8.w), cubeLit(c0 + o1, v8.w)), max(cubeLit(c0 + o2, v8.w), cubeLit(c0 + o1 + o2, v8.w)));
  }
  // Signals running along the lines, turning at the nodes: each a seeded walk
  // of six legs of 1 to 3 cells, from a node drawn anew each time it sets out.
  float pl = 0.0, head = 0.0;
  int np = int(v7.z + 0.5);
  vec3 nmax = vec3(v7.x, v7.y, v7.x);
  float speed = v7.w;
  const float TRAIL = 0.8;                        // cells
  for (int k = 0; k < 40; k++) {
    if (k >= np) break;
    float fk = float(k);
    float per = 12.0 * (0.75 + 0.5 * hash(fk * 3.7 + 1.3));
    float ph = uTime / per + hash(fk * 5.1 + 0.7);
    float ep = floor(ph);
    float sh = (ph - ep) * per * speed * (0.8 + 0.4 * hash(fk * 2.3 + ep));   // the head, along its walk (cells)
    float hs = fk * 17.3 + ep * 41.9;
    vec3 at = floor(vec3(hash(hs + 0.1), hash(hs + 0.2), hash(hs + 0.3)) * (nmax + 0.999));
    int dir = int(hash(hs + 0.4) * 2.999);
    float S = 0.0;
    for (int i = 0; i < 6; i++) {
      if (S > sh) break;
      float hi = hs + float(i) * 7.13;
      dir = (dir + 1 + int(hash(hi + 0.5) * 1.999)) % 3;
      vec3 u = cubeAxis(dir);
      float len = 1.0 + floor(hash(hi + 0.6) * 2.999);
      float c0 = dot(at, u), top = dot(nmax, u);
      float sg = hash(hi + 0.7) < 0.5 ? -1.0 : 1.0;
      if (c0 + sg * len > top || c0 + sg * len < 0.0) sg = -sg;
      len = min(len, sg > 0.0 ? top - c0 : c0);
      if (len < 0.5) continue;
      if (S + len > sh - TRAIL * 4.0) {
        vec3 d = g - at;
        float along = dot(d, u) * sg;
        vec3 off = (d - u * dot(d, u)) * cell / gap;
        float near = cubeF(length(off), sharp);
        if (near > 0.003 && along > -0.2 && along < len + 0.2) {
          float back = sh - (S + clamp(along, 0.0, len));
          pl += near * (back >= 0.0 ? exp(-back / TRAIL) : exp(-back * back * 200.0));
          float bg = back * dot(cell, u) / dot(gap, u);   // (in LED gaps)
          head += near * exp(-bg * bg * 2.0);             // (about one LED)
        }
      }
      at += u * sg * len;
      S += len;
    }
  }
  pl *= smoothstep(0.0, 0.3, w);
  head = min(head, pl) * smoothstep(0.0, 0.3, w);
  vec3 pc = mix(uEggV[5].rgb, vec3(1.0), 0.3) * uEggV[5].w * abs(k) * fade;
  vec3 calm = col * lines * w * wave * abs(k) * fade * (1.0 + 2.5 * lit);
  vec3 front = col * lines * tip * 2.0 * abs(k) * fade;
  vec3 light = calm + front + pc * pl + fill;
  // Only the nodes and the signals' heads glint (cast rays): the lines, the growth's
  // front and the signals' trails do not, else each LED of a line is a dash.
  CubesCalm = calm * (1.0 - uEggV[2].y * f.x * f.y * f.z / max(lines, 1e-3)) + front + pc * (pl - head) + fill;
  thread += col * l.y * w * wave * uEggV[4].w * abs(k) * fade * v2.x * 3.0;
  return light;
}
`;
