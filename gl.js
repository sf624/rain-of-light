// GL helpers (made for one context) and the vector math (column-major 4x4).

export function createGL(gl) {
  // One shader object per source, kept for the life of the context: programs that share a shader
  // (the LEDs' and the wires' vertex shader, the fragment shaders of every program of the LEDs)
  // compile it once, whenever each is built. A shader whose compile failed leaves the cache, so a
  // program built again compiles it again.
  const shaders = new Map();   // `${type}\n${src}` -> shader
  function shader(type, src) {
    const key = `${type}\n${src}`;
    let s = shaders.get(key);
    if (!s) {
      s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      shaders.set(key, s);
    }
    return { s, src, key };
  }

  // A program: its compile and link are sent at once, and its outcome is read only at its first use
  // (`u`, its uniforms), so that the page does other work while the GPU builds it. A build that
  // failed throws at that first use, with the shader's log; the error has `lost` set when the
  // context went while the program was built (no fault of the program's).
  // `ready()` says, without waiting, whether that first use would wait for the GPU
  // (KHR_parallel_shader_compile, where the GPU has it; without it, the first answer waits a frame:
  // the driver may build it meanwhile). A program built while the show runs is used once it is ready.
  // (A context may be lost at any time: a browser on WSL loses it once as it starts, a GPU resets.)
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  function program(vs, fs) {
    const p = gl.createProgram();
    const sh = [shader(gl.VERTEX_SHADER, vs), shader(gl.FRAGMENT_SHADER, fs)];
    for (const { s } of sh) gl.attachShader(p, s);
    gl.linkProgram(p);
    let u = null, asked = false;
    return {
      p,
      get u() { return u || (u = finish(p, sh)); },
      ready() {
        if (u) return true;
        if (gl.isContextLost()) return false;
        if (parallel ? gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR) : asked) return true;
        asked = true;
        return false;
      },
    };
  }

  function finish(p, sh) {
    for (const { s, src, key } of sh) {
      if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) continue;
      const log = gl.getShaderInfoLog(s);
      if (shaders.get(key) === s) shaders.delete(key);
      // (A failed build with no log: the context is going, and will be lost.)
      throw Object.assign(new Error(log ? `${log}\n${src}` : 'the context went while the program was built'), { lost: !log });
    }
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw Object.assign(new Error(log || 'the context went while the program was linked'), { lost: !log });
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return u;
  }

  // A half-float render target; with `second`, a second colour attachment (tex2) beside the first.
  function target(w, h, second = false) {
    const texture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tex = texture();
    const tex2 = second ? texture() : null;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (tex2) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex2, 0);
    return { tex, tex2, fb, w, h };
  }

  function freeTarget(t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    if (t.tex2) gl.deleteTexture(t.tex2);
    gl.deleteFramebuffer(t.fb);
  }

  return { program, target, freeTarget };
}

// ---------- vector math (column-major 4x4) ----------
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye, at, up) {
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}
