// 1/f fluctuation ("sway"): neither as regular as a sine nor as restless as
// plain random numbers. Several smooth random curves, each twice as slow as
// the one before, are added with equal weight (after Voss): equal power per
// octave gives a spectrum that falls as 1/f between the fastest and slowest.
//
// next(dt) advances by dt (seconds, or 1 per event) and returns a value
// mostly within -1 .. 1, centred on 0.
// random: where its numbers come from (Math.random; the lab gives a seeded one, see createRandom,
// so that a sway can be saved and brought back: next.save() / next.load()).
export function createSway({ fastest = 1, octaves = 6, random = Math.random } = {}) {
  const rnd = () => random() * 2 - 1;
  const layers = Array.from({ length: octaves }, (_, k) => ({
    period: fastest * 2 ** k, t: random(), a: rnd(), b: rnd(),
  }));
  const norm = 1 / (2 * Math.sqrt(octaves / 3)); // the sum has sd sqrt(n/3); bring it to 0.5
  function next(dt) {
    let sum = 0;
    for (const L of layers) {
      L.t += dt / L.period;
      while (L.t >= 1) { L.t -= 1; L.a = L.b; L.b = rnd(); }
      const k = L.t * L.t * (3 - 2 * L.t);
      sum += L.a + (L.b - L.a) * k;
    }
    return Math.max(-1, Math.min(1, sum * norm));
  }
  next.save = () => ({ layers: layers.map((L) => ({ ...L })), random: random.get?.() });
  next.load = (d) => { d.layers.forEach((L, i) => Object.assign(layers[i], L)); if (d.random !== undefined) random.set(d.random); };
  return next;
}

// A seeded random number generator (mulberry32) whose place can be read and set again.
export function createRandom(seed) {
  let a = (Math.floor(seed * 1000) ^ 0x9e3779b9) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.get = () => a;
  next.set = (v) => { a = v; };
  return next;
}
