// The celestial bodies: one form of light (config.js: FORMS, celestial)
// whose variants are bodies of the sky (config.js: BODIES), one per
// appearance: the ringed planets Saturn and Uranus (planets.js). Each body
// has colours of its own, in place of the palettes of the other forms.
//
// A body's light is not in the shared shader: the page draws the whole frame
// (the LEDs, their wires, the floor's and the walls' images) with programs of
// the group's own while a body shows (see main.js), and with programs that
// hold none of its code the rest of the time. SwiftShader (no GPU) runs a
// shader the slower the more code it holds, even code that does not run:
// the planet's code in every frame cost rain alone 10% there, the orb 15%.

// The vertex shader `src` (POINT_VS) with the bodies' light in place of the
// other sky forms' (while a body shows, none of them does; see formsAt in
// shaders.js).
export const bodyShader = (src) => src.replace('#version 300 es\n', '#version 300 es\n#define CELESTIAL\n');
