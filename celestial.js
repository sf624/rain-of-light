// The celestial bodies: one form of light (config.js: FORMS, celestial)
// whose variants are bodies of the sky (config.js: BODIES), one per
// appearance: the ringed planets Saturn and Uranus (planets.js) and a black
// hole (blackhole.js). Each body has colours of its own, in place of the
// palettes of the other forms, and is of a kind (`kind`): the bodies of one
// kind share their shader code and their move (forms.js: KIND_MOVES).
//
// A body's light is not in the shared shader: the page draws the whole frame
// (the LEDs, their wires, the floor's and the walls' images) with programs of
// its kind's own while a body shows (see main.js: bodyProgs), and with
// programs that hold none of the bodies' code the rest of the time.
// SwiftShader (no GPU) runs a shader the slower the more code it holds, even
// code that does not run (the planet's code in every frame cost rain alone
// 10% there, the orb 15%), and so does a GPU, less: so each kind has a pair
// of programs that holds only its own code, and a body pays for no other.
// A kind's programs are built when one of its bodies is about to come
// (show.js: bodiesNear).

import { PLANET_GLSL } from './planets.js';
import { HOLE_GLSL } from './blackhole.js';

// The kinds of body, each with its shader code (a new kind: one entry here,
// its move in forms.js: KIND_MOVES, its bodies in config.js: BODIES). A
// kind's code defines its part of the bodies' interface, its functions
// named after it (planetFar, holeFar ...):
//   float <kind>Far(vec3 rel, vec4 b, vec4 e, vec4 f): how far rel (from the
//     body's centre) is, as its reach (f.w) counts: LEDs farther skip it;
//   vec3 <kind>Body(vec3 p, vec4 a, vec4 b, vec4 e, vec4 f, int k, out vec3 col):
//     the light at p of the body in slot k (x; y: how white-hot) and its
//     colour (col); it sets BodyRay, the share of that light that casts rays,
//     and BodyThread, the share its strand's wire shows;
//   float <kind>Shade(vec3 seen): what is left of any light seen at `seen`
//     (an LED's, a wire's, an image's: 1 all, 0 none).
const KINDS = [{ name: 'planet', glsl: PLANET_GLSL }, { name: 'hole', glsl: HOLE_GLSL }];

// The vertex shader `src` (POINT_VS) with the light of the bodies of `kind`
// in place of the other sky forms' (while a body shows, none of them does;
// see formsAt in shaders.js).
const define = (kind) => `BODY_${kind.toUpperCase()}`;
export const bodyShader = (src, kind) => src.replace('#version 300 es\n', `#version 300 es\n#define CELESTIAL\n#define ${define(kind)}\n`);

// The shader's celestial bodies (only in their programs, see bodyShader):
// each kind's code, and the interface the shared shader calls made from it.
const glslOf = ({ name, glsl }) => `#ifdef ${define(name)}
${glsl}
float bodyFar(vec3 rel, vec4 b, vec4 e, vec4 f) { return ${name}Far(rel, b, e, f); }
vec3 bodyLight(vec3 p, vec4 a, vec4 b, vec4 e, vec4 f, int k, out vec3 col) { return ${name}Body(p, a, b, e, f, k, col); }
float bodyShade(vec3 seen) { return ${name}Shade(seen); }
#endif`;
export const BODY_GLSL = `
// ---------- the celestial bodies (see celestial.js) ----------
uniform vec3 uFormG[3];     // a body's third and fourth colours
uniform vec3 uFormH[3];
vec3 Eye;                   // where the eye is as this LED's image is seen (main sets it: in a mirror, the eye's image)
float BodyRay, BodyThread;  // set by the body's light (see KINDS)
${KINDS.map(glslOf).join('\n')}
`;
