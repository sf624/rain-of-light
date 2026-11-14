// The baked forms' fields (see BAKED in config.js): each a cube of
// signed distances to a shape's skin, baked by tools/bake-field.py into
// fields/<name>.bin. They share one 3D texture, a slab each, on a texture
// unit of their own. A field is fetched only when its form is about to show
// (show.js: bakedNear), never with the page; the service worker keeps it once
// fetched (it is not in its list of files to cache at install).
// Where 3D textures cannot be made, `able` is false and no baked form ever shows.

import { BAKED } from './config.js';

// The layout the baking tool writes (tools/fields.json: grid; the file's
// header must say the same): cells along each side of a slab, and the
// reach of the distances in the box [-1, 1].
export const FIELD = { cells: 40, reach: 0.3, slabs: BAKED.length };
const HEADER = 16;
const FADE = 1.5;    // s: a field that comes late (a seek, a slow network) shows its form over this long

export function createFields(gl, unit) {
  const n = FIELD.cells;
  let tex = null;
  try {
    tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, n, n, n * FIELD.slabs);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, wrap, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  } catch { tex = null; }
  const able = !!tex && gl.getError() === gl.NO_ERROR && gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > unit;

  const state = new Map();   // name -> 'loading' | 'failed' | a number: how much it shows (0 .. 1, eases in once loaded)

  function load(name) {
    const egg = BAKED.find((e) => e.name === name);
    if (!able || !egg || state.has(name)) return;
    state.set(name, 'loading');
    fetch(`fields/${name}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`fields/${name}.bin: ${r.status}`))))
      .then((buf) => {
        const head = new DataView(buf, 0, HEADER);
        const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
        const ok = magic === 'FLD1' && [4, 6, 8].every((at) => head.getUint16(at, true) === n)
          && Math.abs(head.getFloat32(10, true) - FIELD.reach) < 1e-6 && buf.byteLength === HEADER + n * n * n;
        if (!ok) throw new Error(`fields/${name}.bin: not a field of this layout`);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, egg.field * n, n, n, n, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(buf, HEADER));
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.activeTexture(gl.TEXTURE0);
        state.set(name, 0);
      })
      .catch((err) => { console.warn(err.message); state.set(name, 'failed'); });
  }

  // Each frame: load the fields of the baked forms near (names, see show.js:
  // bakedNear), and dim a form whose field is not there yet, in the show's
  // arrays (A: its weight; the forms' list: its voice). dt: real seconds.
  function frame(near, shown, dt) {
    for (const name of near) load(name);
    for (const [name, s] of state) if (typeof s === 'number') state.set(name, Math.min(1, s + dt / FADE));
    for (let k = 0; k < 2; k++) {
      if (shown.A[k * 4] !== BAKED[0].type || shown.A[k * 4 + 1] <= 0) continue;
      const egg = BAKED[Math.round(shown.F[k * 4])];
      const s = state.get(egg.name);
      shown.A[k * 4 + 1] *= typeof s === 'number' ? s * s * (3 - 2 * s) : 0;
    }
    for (const f of shown.forms) {
      const s = state.get(f.name);
      if (BAKED.some((e) => e.name === f.name)) f.w *= typeof s === 'number' ? s : 0;
    }
  }

  return { able, frame, ready: (name) => typeof state.get(name) === 'number' };
}
