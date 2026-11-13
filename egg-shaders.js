// The easter eggs' light, a chunk of the LEDs' vertex shader (POINT_VS in
// shaders.js puts it in before its main and calls eggsAt). Each egg is a
// function of the LED's place and the egg's uniforms, as the forms are; what
// it needs per frame is worked out in egg-kinds.js.
//
// Three slots: 0 holds an egg that takes the form slot or the whole scene
// (glider, penrose, pi, fireworks, snow), 1 and 2 an overlay each (clock, tanabata).
// uEgg[k]: type (EGG in egg-kinds.js; 0: none), weight 0..1, age (s), a free
// number. uEggV[8k ..]: eight vectors of the egg's own. uEggBits: slot 0's
// bits (the life grid now and before, the rhythm of pi).
// The page draws with this chunk only while an egg shows (eggShader: the
// same shader with EGGS defined, and EGG_n for each egg's function it needs);
// else with programs that have none of it. (One program with all of them
// made the GPU's compiler give up on Windows' D3D.)

// The vertex shader `src` (POINT_VS) with the light of the eggs of these types (EGG in egg-kinds.js).
export const eggShader = (src, types) =>
  src.replace('#version 300 es\n', `#version 300 es\n#define EGGS\n${types.map((t) => `#define EGG_${t}\n`).join('')}`);

// A dot-matrix font of 5 x 7, one row a number of 5 bits (the left dot is
// bit 4): 0 .. 9, then ':' (10) and '.' (11). A code of 15 is no glyph.
// (Made into a chain of tests, glyphRows below: an indexed constant array of
// them came out all dark on ANGLE's D3D backend.)
const FONT = [
  [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14], [14, 17, 1, 2, 4, 8, 31], [31, 2, 4, 2, 1, 17, 14],
  [2, 6, 10, 18, 31, 2, 2], [31, 16, 30, 1, 1, 17, 14], [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8],
  [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12], [0, 12, 12, 0, 12, 12, 0], [0, 0, 0, 0, 0, 12, 12],
];
// Each glyph's rows packed in two numbers: rows 0 .. 3, and rows 4 .. 6, 5 bits each.
const packed = (rows) => [rows.slice(0, 4), rows.slice(4)].map((r) => r.reduce((n, x, i) => n + x * 32 ** i, 0));
const GLYPH_ROWS = `ivec2 glyphRows(int c) {
${FONT.map((rows, i) => `  if (c == ${i}) return ivec2(${packed(rows).join(', ')});`).join('\n')}
  return ivec2(0);
}`;

export const EGG_GLSL = `
uniform vec4 uEgg[3];
uniform vec4 uEggV[24];
uniform uvec4 uEggBits[16];

uint eggBit(int i) { return (uEggBits[i >> 7][(i >> 5) & 3] >> uint(i & 31)) & 1u; }
// The light of a small point (a flake, a spark, a glyph's dot) is about as
// many LEDs on any lattice (its size goes by the strand gap): give each LED
// back what uLight takes from a denser lattice, so it is as bright.
float eggPoint() { return 1.0 / max(uLight.x, 0.25); }
// 1 within r of a thin thing (a spark, a flake, a star), and never under about
// half a strand gap, so it always catches an LED; then it fades over half a gap.
float eggNear(float d, float r) { float c = max(r, 0.45 * uLane.x); return 1.0 - smoothstep(c, c + 0.5 * uLane.x, d); }

#ifdef EGG_1
// ---------- glider: Conway's Life on the layer ----------
// v0: where the board's first cell begins (x, z), a cell's size, the sheet's height
// v1: its half thickness, how far the generation has gone (0 .. 1), the board's glow, -
// v2, v3: the colour of a living cell, of one just born; v4: the ways of the board's columns and rows (x, z each)
vec3 lifeLight(vec3 p, vec4 a, int o) {
  vec4 g = uEggV[o], h = uEggV[o + 1];
  float dy = p.y - g.w;
  if (abs(dy) > h.x * 3.0) return vec3(0.0);
  vec4 ax = uEggV[o + 4];
  vec2 q = p.xz - g.xy;
  vec2 c = mod(vec2(dot(q, ax.xy), dot(q, ax.zw)) / g.z, 32.0);   // (the board wraps round the room)
  ivec2 ci = ivec2(c);
  vec2 f = fract(c) - 0.5;
  float sq = 1.0 - smoothstep(0.3, 0.42, max(abs(f.x), abs(f.y)));
  int i = ci.y * 32 + ci.x;
  float now = float(eggBit(i)), was = float(eggBit(1024 + i));
  float k = smoothstep(0.0, 0.55, h.y);
  float alive = mix(was, now, k);
  float born = now * (1.0 - was) * exp(-h.y * 2.5);
  float sheet = exp(-dy * dy / (h.x * h.x));
  vec3 col = mix(uEggV[o + 2].xyz, uEggV[o + 3].xyz, born);
  return (col * (alive * 12.0 + born * 6.0) + uEggV[o + 2].xyz * h.z) * sq * sheet;
}

#endif
#ifdef EGG_2
// ---------- penrose: the tribar ----------
// Three square beams along three axes at right angles, end to end, P0 -> P1
// -> P2 -> P3; from the one way where P3 lies in front of P0 the ends meet and
// the three close into an impossible triangle. Each beam's faces glow in one
// of three tones (by the axis they face), only the faces towards the eye, and
// a beam hides what lies behind it. Its width grows with the distance from the
// eye's place at the click (along the diagonal), so the two ends that meet
// there look as wide.
// v0: P0, the eye's distance at the click (F); v1..v3: the beams (axis times
// its length), w: its width at the centre; v4: the centre, the shell's half
// thickness; v5: the diagonal (towards the eye at the click), w: how much the
// width grows with depth (0 .. 1); v6, v7: the colours of the faces along the first
// and the third axis, (v2.w, v3.w, v6.w) that of the second.
float pBox(vec3 o, vec3 d, vec3 S, vec3 A, vec3 B, vec3 C, float len, float hw) {
  // Where the line o + t d (t 0 .. 1) enters the beam's box, or 2 if it misses it.
  vec3 lo = vec3(dot(o - S, A), dot(o - S, B), dot(o - S, C));
  vec3 ld = vec3(dot(d, A), dot(d, B), dot(d, C));
  vec3 mn = vec3(-hw, -hw, -hw), mx = vec3(len + hw, hw, hw);
  vec3 inv = 1.0 / mix(ld, vec3(1e-5), lessThan(abs(ld), vec3(1e-5)));
  vec3 t0 = (mn - lo) * inv, t1 = (mx - lo) * inv;
  vec3 ta = min(t0, t1), tb = max(t0, t1);
  float tin = max(max(ta.x, ta.y), max(ta.z, 0.0)), tout = min(min(tb.x, tb.y), min(tb.z, 1.0));
  return tin <= tout ? tin : 2.0;
}
vec3 penroseLight(vec3 p, vec4 a, int o) {
  vec4 v0 = uEggV[o], v4 = uEggV[o + 4], v5 = uEggV[o + 5];
  vec3 P = v0.xyz;
  float L = length(uEggV[o + 1].xyz);
  if (length(p - v4.xyz) > L * 0.95 + 1.5) return vec3(0.0);   // (its farthest corner, and a beam's half width at its widest)
  float F = v0.w, T = v4.w;
  vec3 ax[3] = vec3[3](uEggV[o + 1].xyz / L, uEggV[o + 2].xyz / L, uEggV[o + 3].xyz / L);
  float zc = dot(p - v4.xyz, v5.xyz);
  float hwHere = 0.5 * uEggV[o + 1].w * (1.0 - v5.w * zc / F);
  vec3 tone = vec3(0.0);
  float best = 0.0;
  int hit = -1;
  vec3 S[3] = vec3[3](P, P + ax[0] * L, P + (ax[0] + ax[1]) * L);
  for (int k = 0; k < 3; k++) {
    vec3 A = ax[k], B = ax[(k + 1) % 3], C = ax[(k + 2) % 3];
    vec3 q = p - S[k];
    float s = dot(q, A), x = dot(q, B), y = dot(q, C);
    float hw = hwHere;
    // The distance in from each face (negative outside it).
    float dx = hw - abs(x), dyy = hw - abs(y), ds = min(s + hw, L + hw - s);
    float din = min(min(dx, dyy), ds);
    if (din < -T * 2.0) continue;
    // Which face is nearest: its normal, and whether it looks towards the eye.
    vec3 n = dx < dyy ? B * sign(x) : C * sign(y);
    float second = max(dx < dyy ? dyy : dx, 0.0);
    if (ds < min(dx, dyy)) { n = A * (s < L * 0.5 ? -1.0 : 1.0); second = min(dx, dyy); }
    if (dot(n, uEye - p) <= 0.0) continue;
    float shell = exp(-din * din / (T * T));
    if (shell < 0.02) continue;
    float edge = exp(-second * second / (T * T * 1.5));   // where two faces meet: a brighter line
    // The tone: by the axis the face looks along (three tones, as the drawing has).
    float ta = abs(dot(n, ax[0])), tb = abs(dot(n, ax[1]));
    vec3 col = ta > 0.5 ? uEggV[o + 6].xyz : tb > 0.5 ? vec3(uEggV[o + 2].w, uEggV[o + 3].w, uEggV[o + 6].w) : uEggV[o + 7].xyz;
    float k2 = ta > 0.5 ? 1.0 : tb > 0.5 ? 0.75 : 0.55;
    float light = shell * (k2 * 3.0 + edge * 9.0);
    if (light > best) { best = light; tone = col * shell * k2 * 5.0 + mix(col, WHITE_HOT, 0.6) * edge * shell * 13.0; hit = k; }
  }
  if (hit < 0) return vec3(0.0);
  // Hidden behind another beam: the line from the eye to here passes through it first.
  vec3 d = p - uEye;
  for (int k = 0; k < 3; k++) {
    if (k == hit) continue;
    vec3 A = ax[k], B = ax[(k + 1) % 3], C = ax[(k + 2) % 3];
    // (the beam's width where the line passes closest to its axis, near enough)
    float tc = clamp(dot(S[k] + A * L * 0.5 - uEye, d) / dot(d, d), 0.0, 1.0);
    float hw = 0.5 * uEggV[o + 1].w * (1.0 - v5.w * dot(uEye + d * tc - v4.xyz, v5.xyz) / F);
    float t = pBox(uEye, d, S[k], A, B, C, L, hw);
    if (t < 1.0 - T * 0.7 / length(d)) return vec3(0.0);
  }
  return tone;
}

#endif
#ifdef EGG_3
// ---------- glyphs: the clock, the digits of pi ----------
${GLYPH_ROWS}
// v0: one dot's step to the right (xyz), the half thickness of the panel;
// v1: one dot's step down, the dot's half width (in dots); v2: the colour, how
// many lines; v3 .. v7: per line, its top left corner and its glyphs (up to 5,
// 4 bits each, the first lowest).
vec3 glyphLight(vec3 p, vec4 a, int o) {
  vec4 R = uEggV[o], D = uEggV[o + 1], col = uEggV[o + 2];
  float s2 = dot(R.xyz, R.xyz);
  vec3 N = normalize(cross(R.xyz, D.xyz));
  float light = 0.0;
  int n = int(col.w + 0.5);
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    vec4 Ln = uEggV[o + 3 + i];
    vec3 q = p - Ln.xyz;
    float z = dot(q, N);
    if (abs(z) > R.w * 3.0) continue;
    float x = dot(q, R.xyz) / s2, y = dot(q, D.xyz) / s2;
    if (x < 0.0 || y < 0.0 || y >= 7.0 || x >= 30.0) continue;
    int ch = int(x) / 6, cx = int(x) - ch * 6;
    if (cx >= 5) continue;
    int code = (int(Ln.w + 0.5) >> (4 * ch)) & 15;
    if (code >= 12) continue;
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
#ifdef EGG_4
// ---------- pi-rhythm: drops that count the digits ----------
// On a share of the strands, all in step, drops fall in groups: as many drops
// as the digit, then a pause (a zero: a longer pause). uEggBits holds which
// slots of the rhythm have a drop.
// v0: speed (strand lengths per s), a slot (s), slots in the table, the share of strands; v1: colour
vec3 rhythmLight(float seed, float u, vec4 a, int o) {
  vec4 v = uEggV[o];
  if (hash(seed + 71.3) > v.w) return vec3(0.0);
  float te = (a.z - u / v.x) / v.y;                  // the slot this LED's drop set out in
  float k = floor(te), ph = te - k;
  int slot = int(mod(k, v.z));
  float back = ph * v.y * v.x * uHeight;            // how far behind its head (units)
  float lit = float(eggBit(slot)) * exp(-back / 0.55);
  // (the next slot's head, coming)
  int next = int(mod(k + 1.0, v.z));
  lit += float(eggBit(next)) * exp(-(1.0 - ph) * v.y * v.x * uHeight / 0.06);
  return uEggV[o + 1].xyz * lit * 9.0 * eggPoint();
}

#endif
#ifdef EGG_5
// ---------- fireworks ----------
// Shells rise along the strands and burst into spheres of sparks that fall and
// fade. v0: the time between shells, the room's half span for them, the
// strands' foot (y), the rise time; v1 .. v4: four colours.
vec3 fireworksLight(vec3 p, vec4 a, int o) {
  vec4 v = uEggV[o];
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
    vec3 col = uEggV[o + 1 + int(hash(n * 9.7) * 3.999)].xyz;
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
#ifdef EGG_6
// ---------- snow, and a tree of light ----------
// Flakes drift down slowly, each in its column of the room (cells of v0.x),
// swaying a little; a cone of points with a garland and a star.
// v0: the cell, fall speed, the top (y), the bottom; v1: the tree's foot (xyz), its height;
// v2: its radius at the foot, -, -, -; v3: the flakes' colour; v4: the tree's; v5: the garland's; v6: the star's
vec3 snowLight(vec3 p, float id, vec4 a, int o) {
  vec4 v = uEggV[o];
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
    c += uEggV[o + 3].xyz * g * (0.8 + 0.4 * sin(a.z * 1.7 + h * 50.0)) * 5.0 * eggPoint();
  }
  // The tree: a cone over its foot, a garland winding up it, a star on top.
  vec4 t = uEggV[o + 1];
  float hy = (p.y - t.y) / t.w;                      // 0 at the foot .. 1 at the top
  if (hy > -0.05 && hy < 1.15) {
    vec2 q = p.xz - t.xz;
    float rho = length(q), rc = uEggV[o + 2].x * (1.0 - hy);
    float slope = uEggV[o + 2].x / t.w;
    float dd = (rho - rc) / sqrt(1.0 + slope * slope);
    float shell = eggNear(abs(dd), 0.0) * step(hy, 1.0) * step(0.0, hy);
    if (shell > 0.01) {
      float ang = atan(q.y, q.x) / 6.2831853;
      float wind = fract(ang + hy * 3.5 - a.z * 0.03);
      float garland = exp(-pow(min(wind, 1.0 - wind) * 9.0, 2.0));
      float run = 0.5 + 0.5 * sin((hy * 40.0 + ang * 6.2831853) - a.z * 1.2);
      float bulb = hash(id + 41.0) < 0.1 ? pow(0.5 + 0.5 * sin(a.z * (0.6 + hash(id + 42.0)) + hash(id + 43.0) * 6.28), 6.0) : 0.0;
      vec3 bulbCol = hsv2rgb(vec3(hash(id + 44.0), 0.65, 1.0));
      c += shell * (uEggV[o + 4].xyz * 2.0 + uEggV[o + 5].xyz * garland * (5.0 + 6.0 * run) + bulbCol * bulb * 16.0) * eggPoint();
    }
    vec3 s = p - vec3(t.x, t.y + t.w + 0.25, t.z);
    float star = eggNear(length(s), 0.3);
    c += uEggV[o + 6].xyz * star * (10.0 + 2.0 * sin(a.z * 2.1)) * eggPoint();
  }
  return c;
}

#endif
#ifdef EGG_7
// ---------- tanabata: the Milky Way, Vega and Altair ----------
// The sky of 7 July: a band of faint twinkling LEDs rising slantwise from the
// horizon, with a dark rift along it, and the two stars on either side. It is
// drawn by the way from the eye to each LED (between v6.x and v6.y from the
// eye), as a sky is: it stays where it is as the eye walks, and turns with the view.
// v0: the band's pole (the normal of its great circle), its half width (rad);
// v1, v2: the ways to Vega and Altair; v3: the band's colour; v4: Vega's; v5: Altair's;
// v6: the nearest and farthest distance it uses.
vec3 milkyLight(vec3 p, float id, vec4 a, int o) {
  vec4 v = uEggV[o], r = uEggV[o + 6];
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
    c += uEggV[o + 3].xyz * band * rift * (dust * 0.6 + tw * 4.0) * eggPoint();
  }
  // A star: the LEDs along its way, within about half a strand gap of it, between the distances.
  float k = 0.5 * uLane.x / dist;
  float sv = 1.0 - smoothstep(k * 0.6, k * 1.4, length(d - uEggV[o + 1].xyz));
  float sa = 1.0 - smoothstep(k * 0.6, k * 1.4, length(d - uEggV[o + 2].xyz));
  c += (uEggV[o + 4].xyz * sv + uEggV[o + 5].xyz * sa) * depth * 5.0 * eggPoint();
  return c;
}

#endif
// The light of the eggs that show at p (seed: the strand's, id: the LED's,
// u: 0 at the top .. 1 at the foot). Each fades with its weight LED by LED,
// as a form does.
vec3 eggsAt(vec3 p, float seed, float id, float u, inout vec3 thread) {
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    vec4 a = uEgg[k];
    if (a.y < 0.001) continue;
    int type = int(a.x + 0.5), o = k * 8;
    vec3 f = vec3(0.0);
#ifdef EGG_1
    if (type == 1) f = lifeLight(p, a, o);
#endif
#ifdef EGG_2
    if (type == 2) f = penroseLight(p, a, o);
#endif
#ifdef EGG_3
    if (type == 3) f = glyphLight(p, a, o);
#endif
#ifdef EGG_4
    if (type == 4) f = rhythmLight(seed, u, a, o);
#endif
#ifdef EGG_5
    if (type == 5) f = fireworksLight(p, a, o);
#endif
#ifdef EGG_6
    if (type == 6) f = snowLight(p, id, a, o);
#endif
#ifdef EGG_7
    if (type == 7) f = milkyLight(p, id, a, o);
#endif
    float on = clamp((a.y * 1.25 - hash(id + 61.0 + float(k))) / 0.25, 0.0, 1.0) * smoothstep(0.0, 0.4, a.y);
    c += f * on;
  }
  thread += c * 0.5;
  return c;
}
`;
