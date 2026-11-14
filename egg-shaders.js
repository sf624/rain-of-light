// The easter eggs' light, a chunk of the LEDs' vertex shader (POINT_VS in
// shaders.js puts it in before its main and calls eggAt). Each egg is a
// function of the LED's place and the egg's uniforms, as the forms are; what
// it needs per frame is worked out in egg-kinds.js. One egg shows at a time.
//
// uEgg: type (EGG in egg-kinds.js; 0: none), weight 0..1, age (s), a free
// number. uEggV: ten vectors of the egg's own.
// The page draws with this chunk only while an egg shows (eggShader: the
// same shader with EGGS defined, and EGG_n for the egg's function); else with
// programs that have none of it. (One program with all of them made the
// GPU's compiler give up on Windows' D3D.)

// The vertex shader `src` (POINT_VS) with the light of the egg of this type (EGG in egg-kinds.js).
export const eggShader = (src, type) => src.replace('#version 300 es\n', `#version 300 es\n#define EGGS\n#define EGG_${type}\n`);

// A dot-matrix font of 5 x 7, one row a number of 5 bits (the left dot is
// bit 4): 0 .. 9, then ':' (10). A code of 15 is no glyph.
// (Made into a chain of tests, glyphRows below: an indexed constant array of
// them came out all dark on ANGLE's D3D backend.)
const FONT = [
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31], [31, 2, 4, 2, 1, 17, 14],
  [2, 6, 10, 18, 31, 2, 2], [31, 16, 30, 1, 1, 17, 14], [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8],
  [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12], [0, 12, 12, 0, 12, 12, 0],
];
// Each glyph's rows packed in two numbers: rows 0 .. 3, and rows 4 .. 6, 5 bits each.
const packed = (rows) => [rows.slice(0, 4), rows.slice(4)].map((r) => r.reduce((n, x, i) => n + x * 32 ** i, 0));
const GLYPH_ROWS = `ivec2 glyphRows(int c) {
${FONT.map((rows, i) => `  if (c == ${i}) return ivec2(${packed(rows).join(', ')});`).join('\n')}
  return ivec2(0);
}`;

export const EGG_GLSL = `
uniform vec4 uEgg;
uniform vec4 uEggV[10];

// The light of a small point (a flake, a spark, a glyph's dot) is about as
// many LEDs on any lattice (its size goes by the strand gap): give each LED
// back what uLight takes from a denser lattice, so it is as bright.
float eggPoint() { return 1.0 / max(uLight.x, 0.25); }
// 1 within r of a thin thing (a spark, a flake, a star), and never under about
// half a strand gap, so it always catches an LED; then it fades over half a gap.
float eggNear(float d, float r) { float c = max(r, 0.45 * uLane.x); return 1.0 - smoothstep(c, c + 0.5 * uLane.x, d); }

#ifdef EGG_1
// ---------- penrose: the impossible triangle, drawn in light ----------
// A picture, not a solid: a slab of LEDs a few spacings thick (v0.w: its half
// thickness) through C (v0.xyz) that faces the eye, with the classic figure
// drawn in it. Each LED is seen where the line from the eye through it meets
// the slab's middle plane, so the edges are crisp as seen. In the picture a
// point is a ex + b ey, with ex, ey, ez one unit long, 120 degrees apart (ez
// up; ex + ey + ez = 0): the drawing of a tribar of cubes as an isometric
// picture shows it. The faces that look one way make one band, an L over two
// bars (a long arm of n units, a short one of n - 1, both one unit wide): Z
// (the tops), X, Y. Where two bands overlap, X lies over Z, Z over Y and Y
// over X: no order in depth does that, which is the trick of the figure.
// v1: cos and sin of its turn, 1 / the unit's length, n; v2: how far it has
// come (0 .. 1), its shimmer, the edges' sharpness (1 / their softness, in units);
// v3 .. v5: the tones of Z, X, Y (v3.w: its gain); v6: its reach from C, where
// the pen starts round it (a share of a turn).
float pIn(float v, float lo, float hi, float k) { return clamp(min(v - lo, hi - v) * k + 0.5, 0.0, 1.0); }
// A band: its long arm (x 0 .. n, y 0 .. 1) and its short arm (x n - 1 .. n, y 0 .. n - 1).
float pBand(float x, float y, float n, float k) {
  return max(pIn(x, 0.0, n, k) * pIn(y, 0.0, 1.0, k), pIn(x, n - 1.0, n, k) * pIn(y, 0.0, n - 1.0, k));
}
vec3 penroseLight(vec3 p, float id, vec4 a) {
  vec4 v0 = uEggV[0], v1 = uEggV[1], v2 = uEggV[2];
  vec3 d = p - v0.xyz;
  float reach = uEggV[6].x;
  if (dot(d, d) > reach * reach) return vec3(0.0);   // (the most of the LEDs: far from it)
  vec3 toE = uEye - v0.xyz;
  float D = length(toE);
  vec3 N = toE / D;
  float z = dot(d, N);
  // In the slab: its LEDs at one depth, with a soft face one LED spacing deep (so the light
  // a line of LEDs across it gives is the same wherever the lattice stands).
  float depth = clamp((v0.w - abs(z)) / uLane.x + 0.5, 0.0, 1.0);
  if (depth <= 0.0) return vec3(0.0);
  vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), N)), U = cross(N, R);
  vec2 q = vec2(dot(d, R), dot(d, U)) * (D / (D - z));
  q = vec2(q.x * v1.x + q.y * v1.y, q.y * v1.x - q.x * v1.y) * v1.z;   // (turned back, in units)
  float n = v1.w, k = v2.z;
  // a, b from the triangle's middle (2n/3, n/3), then each band's own two coordinates.
  float A = 0.57735027 * q.x - q.y + 2.0 * n / 3.0, B = -0.57735027 * q.x - q.y + n / 3.0;
  float Z = pBand(A + 1.0, B + 1.0, n, k);
  float X = pBand(B + n - A, n - A, n, k);
  // (Y's arms the other way about: x 0 .. n - 1 along a, and its short arm down, 1 - n .. 1)
  float zy = 1.0 - B, xy = A + 1.0 - B;
  float Y = max(pIn(xy, 0.0, n - 1.0, k) * pIn(zy, 0.0, 1.0, k), pIn(xy, 0.0, 1.0, k) * pIn(zy, 1.0 - n, 1.0, k));
  vec3 col = uEggV[3].xyz * Z * (1.0 - X) + uEggV[4].xyz * X * (1.0 - Y) + uEggV[5].xyz * Y * (1.0 - Z);
  // It comes LED by LED, round the figure from a corner (+x: the top as it comes) as a pen would draw
  // it, and goes back the same way.
  float pen = fract(atan(q.y, q.x) / 6.2831853 + 1.0 - uEggV[6].y);
  float order = 0.55 * hash(id + 67.0) + 0.45 * pen;
  float gate = clamp((v2.x * 1.6 - order) / 0.6, 0.0, 1.0);   // (each LED over a good part of the way)
  float shimmer = 1.0 + v2.y * sin(uTime * (1.1 + 1.6 * hash(id + 68.0)) + 6.2831853 * hash(id + 69.0));
  return col * depth * gate * shimmer * uEggV[3].w * eggPoint();
}

#endif
#ifdef EGG_2
// ---------- clock: the time of day in dot glyphs ----------
${GLYPH_ROWS}
// v0: one dot's step to the right (xyz), the half thickness of the panel;
// v1: one dot's step down, the dot's half width (in dots); v2: the colour, how
// many lines; v3, v4: per line (one or two), its top left corner and its glyphs (up to 5,
// 4 bits each, the first lowest).
vec3 clockLight(vec3 p, vec4 a) {
  vec4 R = uEggV[0], D = uEggV[1], col = uEggV[2];
  float s2 = dot(R.xyz, R.xyz);
  vec3 N = normalize(cross(R.xyz, D.xyz));
  float light = 0.0;
  int n = int(col.w + 0.5);
  for (int i = 0; i < 2; i++) {
    if (i >= n) break;
    vec4 Ln = uEggV[3 + i];
    vec3 q = p - Ln.xyz;
    float z = dot(q, N);
    if (abs(z) > R.w * 3.0) continue;
    // Where the line from the eye through the LED meets the panel's plane: so a dot is as crisp as
    // seen however thick the slab, and however far above or below the eye the panel stands.
    float k = 1.0 - z / dot(p - uEye, N);
    q = q * k + (Ln.xyz - uEye) * (k - 1.0);
    float x = dot(q, R.xyz) / s2, y = dot(q, D.xyz) / s2;
    if (x < 0.0 || y < 0.0 || y >= 7.0 || x >= 30.0) continue;
    int ch = int(x) / 6, cx = int(x) - ch * 6;
    if (cx >= 5) continue;
    int code = (int(Ln.w + 0.5) >> (4 * ch)) & 15;
    if (code >= 11) continue;
    ivec2 g = glyphRows(code);
    int row = int(y);
    int bits = row < 4 ? g.x >> (5 * row) : g.y >> (5 * (row - 4));
    if (((bits >> (4 - cx)) & 1) == 0) continue;
    vec2 f = fract(vec2(x, y)) - 0.5;
    // A dot fills most of its cell (a soft square with a dark gap round it), and the
    // panel is a slab of even light a few strand gaps thick (it faces the eye, so
    // its depth does not show): so a dot always
    // catches a few LEDs, wherever the strands stand.
    light += (1.0 - smoothstep(D.w, D.w + 0.12, max(abs(f.x), abs(f.y)))) * (1.0 - smoothstep(R.w * 1.6, R.w * 2.6, abs(z)));
  }
  return col.xyz * min(light, 1.0) * 6.0 * eggPoint();
}

#endif
#ifdef EGG_3
// ---------- fireworks ----------
// Shells rise along the strands and burst into spheres of sparks that fall and
// fade. v0: the time between shells, the room's half span for them, the
// strands' foot (y), the rise time; v1 .. v4: four colours.
vec3 fireworksLight(vec3 p, vec4 a) {
  vec4 v = uEggV[0];
  float gap = v.x, age = a.z;
  float n0 = floor(age / gap);
  vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float n = n0 - float(i);
    if (n < 0.0) break;
    float t = age - n * gap - hash(n * 3.1) * gap * 0.4;
    if (t < 0.0) continue;
    vec3 base = vec3((hash(n * 7.3) - 0.5) * 2.0 * v.y, 0.0, (hash(n * 5.9) - 0.5) * 2.0 * v.y);
    float top = mix(-3.6, -0.6, hash(n * 2.7));
    float rise = v.w * mix(0.8, 1.15, hash(n * 4.1));
    vec3 col = uEggV[1 + int(hash(n * 9.7) * 3.999)].xyz;
    if (t < rise) {
      float k = t / rise;
      float y = mix(v.z, top, 1.0 - (1.0 - k) * (1.0 - k));
      float side = eggNear(length(p.xz - base.xz), 0.0);
      if (side < 0.01) continue;
      float dy = p.y - y;
      float head = eggNear(abs(dy), 0.12);
      float trail = dy < 0.0 ? exp(dy / 0.9) * 0.45 : 0.0;
      c += mix(vec3(1.0, 0.8, 0.5), vec3(1.0), 0.5) * side * (head * 9.0 + trail * 3.0) * eggPoint();
      continue;
    }
    float b = t - rise;
    float life = 3.8;
    if (b > life) continue;
    float R = mix(3.0, 4.6, hash(n * 6.1)) * (1.0 - exp(-b * 2.4));
    vec3 ctr = vec3(base.x, top - 0.35 * b * b, base.z);
    vec3 d = p - ctr;
    float r = length(d);
    if (r > R + 0.8 || r < 0.05) continue;
    vec3 dir = d / r;
    // Which spark: the cell of a cube map round the centre, its own way.
    vec3 m = abs(dir);
    float face = m.x > m.y && m.x > m.z ? (dir.x > 0.0 ? 0.0 : 1.0) : m.y > m.z ? (dir.y > 0.0 ? 2.0 : 3.0) : (dir.z > 0.0 ? 4.0 : 5.0);
    vec2 uv = m.x > m.y && m.x > m.z ? dir.yz / m.x : m.y > m.z ? dir.xz / m.y : dir.xy / m.z;
    vec2 cell = floor((uv + 1.0) * 2.5);              // 5 x 5 a face: 150 sparks
    float id = n * 31.0 + face * 37.0 + cell.x * 5.0 + cell.y;
    vec2 cuv = (cell + 0.25 + 0.5 * vec2(hash(id), hash(id + 0.5))) / 2.5 - 1.0;
    vec3 sd = face < 2.0 ? vec3(face < 1.0 ? 1.0 : -1.0, cuv.x, cuv.y) : face < 4.0 ? vec3(cuv.x, face < 3.0 ? 1.0 : -1.0, cuv.y) : vec3(cuv.x, cuv.y, face < 5.0 ? 1.0 : -1.0);
    sd = normalize(sd);
    float along = dot(d, sd);
    vec3 off = d - sd * along;
    float tail = R - along;                            // behind the spark's head, towards the centre
    if (tail < -0.4 || tail > 1.6) continue;
    float thin = eggNear(length(off), 0.0);
    float fade = (1.0 - b / life);
    fade *= fade;
    float head = eggNear(abs(tail), 0.1);
    float streak = tail > 0.0 ? exp(-tail / 0.5) * 0.6 : 0.0;
    float flick = 0.75 + 0.25 * sin(uTime * 23.0 + id * 1.7);
    vec3 hot = mix(col, vec3(1.0, 0.95, 0.85), exp(-b * 2.5) * 0.8);
    c += hot * thin * (head * 14.0 + streak * 7.0) * fade * flick * eggPoint();
  }
  return c;
}

#endif
#ifdef EGG_4
// ---------- snow, and a tree of light ----------
// Flakes drift down slowly, each in its column of the room (cells of v0.x),
// swaying a little; a cone of points with a garland and a star.
// v0: the cell, fall speed, the top (y), the bottom; v1: the tree's foot (xyz), its height;
// v2: its radius at the foot, -, -, -; v3: the flakes' colour; v4: the tree's; v5: the garland's; v6: the star's
vec3 snowLight(vec3 p, float id, vec4 a) {
  vec4 v = uEggV[0];
  vec3 c = vec3(0.0);
  float span = v.z - v.w;
  vec2 cell = floor(p.xz / v.x);
  for (int k = 0; k < 2; k++) {
    float h = hash(cell.x * 17.3 + cell.y * 41.9 + float(k) * 7.7);
    float speed = v.y * mix(0.7, 1.3, hash(h * 13.1));
    float y = v.z - fract(h * 5.3 + a.z * speed / span) * span;
    vec2 at = (cell + 0.2 + 0.6 * vec2(hash(h * 3.7), hash(h * 9.1))) * v.x;
    at += 0.22 * v.x * vec2(sin(a.z * 0.6 + h * 30.0), cos(a.z * 0.47 + h * 20.0));
    float g = eggNear(length(p - vec3(at.x, y, at.y)), 0.0);
    c += uEggV[3].xyz * g * (0.8 + 0.4 * sin(a.z * 1.7 + h * 50.0)) * 5.0 * eggPoint();
  }
  // The tree: a cone over its foot, a garland winding up it, a star on top.
  vec4 t = uEggV[1];
  float hy = (p.y - t.y) / t.w;                      // 0 at the foot .. 1 at the top
  if (hy > -0.05 && hy < 1.15) {
    vec2 q = p.xz - t.xz;
    float rho = length(q), rc = uEggV[2].x * (1.0 - hy);
    float slope = uEggV[2].x / t.w;
    float dd = (rho - rc) / sqrt(1.0 + slope * slope);
    float shell = eggNear(abs(dd), 0.0) * step(hy, 1.0) * step(0.0, hy);
    if (shell > 0.01) {
      float ang = atan(q.y, q.x) / 6.2831853;
      float wind = fract(ang + hy * 3.5 - a.z * 0.03);
      float garland = exp(-pow(min(wind, 1.0 - wind) * 9.0, 2.0));
      float run = 0.5 + 0.5 * sin((hy * 40.0 + ang * 6.2831853) - a.z * 1.2);
      float bulb = hash(id + 41.0) < 0.1 ? pow(0.5 + 0.5 * sin(a.z * (0.6 + hash(id + 42.0)) + hash(id + 43.0) * 6.28), 6.0) : 0.0;
      vec3 bulbCol = hsv2rgb(vec3(hash(id + 44.0), 0.65, 1.0));
      c += shell * (uEggV[4].xyz * 2.0 + uEggV[5].xyz * garland * (5.0 + 6.0 * run) + bulbCol * bulb * 16.0) * eggPoint();
    }
    vec3 s = p - vec3(t.x, t.y + t.w + 0.25, t.z);
    float star = eggNear(length(s), 0.3);
    c += uEggV[6].xyz * star * (10.0 + 2.0 * sin(a.z * 2.1)) * eggPoint();
  }
  return c;
}

#endif
#ifdef EGG_5
// ---------- tanabata: the Milky Way, Vega and Altair ----------
// The sky of 7 July: a band of faint twinkling LEDs rising slantwise from the
// horizon, with a dark rift along it, and the two stars on either side. It is
// drawn by the way from the eye to each LED (between v6.x and v6.y from the
// eye), as a sky is: it stays where it is as the eye walks, and turns with the view.
// v0: the band's pole (the normal of its great circle), its half width (rad);
// v1, v2: the ways to Vega and Altair; v3: the band's colour; v4: Vega's; v5: Altair's;
// v6: the nearest and farthest distance it uses.
vec3 milkyLight(vec3 p, float id, vec4 a) {
  vec4 v = uEggV[0], r = uEggV[6];
  vec3 e = p - uEye;
  float dist = length(e);
  float depth = smoothstep(r.x, r.x + 3.0, dist) * (1.0 - smoothstep(r.y - 4.0, r.y, dist));
  if (depth <= 0.0) return vec3(0.0);
  vec3 d = e / dist;
  float sky = smoothstep(-0.02, 0.06, d.y);           // above the horizon (the floor shows its image)
  vec3 c = vec3(0.0);
  float off = dot(d, v.xyz);                          // the sine of the angle from the band's middle
  if (abs(off) < v.w * 2.8 && sky > 0.0) {             // (no farther out than its widest place shows)
    float along = atan(d.z, d.x);
    float width = v.w * (0.7 + 0.6 * noise3(vec3(along * 2.5, 1.0, 3.0)));
    float band = exp(-off * off / (width * width)) * sky * depth;
    float rift = 1.0 - 0.75 * exp(-pow((off - width * 0.25 * sin(along * 3.0)) / (width * 0.18), 2.0));
    float dust = 0.3 + 0.9 * noise3(d * 14.0);
    float tw = hash(id + 17.0) < 0.1 ? pow(0.5 + 0.5 * sin(uTime * (0.4 + 1.3 * hash(id + 18.0)) + hash(id + 19.0) * 6.28), 12.0) : 0.0;
    c += uEggV[3].xyz * band * rift * (dust * 0.6 + tw * 4.0) * eggPoint();
  }
  // A star: the LEDs along its way, within about half a strand gap of it, between the distances.
  float k = 0.5 * uLane.x / dist;
  float sv = 1.0 - smoothstep(k * 0.6, k * 1.4, length(d - uEggV[1].xyz));
  float sa = 1.0 - smoothstep(k * 0.6, k * 1.4, length(d - uEggV[2].xyz));
  c += (uEggV[4].xyz * sv + uEggV[5].xyz * sa) * depth * 5.0 * eggPoint();
  return c;
}

#endif
// The light of the egg that shows at p (id: the LED's). It fades with its
// weight LED by LED, as a form does.
vec3 eggAt(vec3 p, float id, inout vec3 thread) {
  vec4 a = uEgg;
  int type = int(a.x + 0.5);
  vec3 f = vec3(0.0);
#ifdef EGG_1
  if (type == 1) f = penroseLight(p, id, a);
#endif
#ifdef EGG_2
  if (type == 2) f = clockLight(p, a);
#endif
#ifdef EGG_3
  if (type == 3) f = fireworksLight(p, a);
#endif
#ifdef EGG_4
  if (type == 4) f = snowLight(p, id, a);
#endif
#ifdef EGG_5
  if (type == 5) f = milkyLight(p, id, a);
#endif
  vec3 c = f * clamp((a.y * 1.25 - hash(id + 61.0)) / 0.25, 0.0, 1.0) * smoothstep(0.0, 0.4, a.y);
  thread += c * 0.5;
  return c;
}
`;
