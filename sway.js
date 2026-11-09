// 1/f fluctuation ("sway"): neither as regular as a sine nor as restless as
// plain random numbers. Several smooth random curves, each twice as slow as
// the one before, are added with equal weight (after Voss): equal power per
// octave gives a spectrum that falls as 1/f between the fastest and slowest.
//
// next(dt) advances by dt (seconds, or 1 per event) and returns a value
// mostly within -1 .. 1, centred on 0.
export function createSway({ fastest = 1, octaves = 6 } = {}) {
  const rnd = () => Math.random() * 2 - 1;
  const layers = Array.from({ length: octaves }, (_, k) => ({
    period: fastest * 2 ** k, t: Math.random(), a: rnd(), b: rnd(),
  }));
  const norm = 1 / (2 * Math.sqrt(octaves / 3)); // the sum has sd sqrt(n/3); bring it to 0.5
  return function next(dt) {
    let sum = 0;
    for (const L of layers) {
      L.t += dt / L.period;
      while (L.t >= 1) { L.t -= 1; L.a = L.b; L.b = rnd(); }
      const k = L.t * L.t * (3 - 2 * L.t);
      sum += L.a + (L.b - L.a) * k;
    }
    return Math.max(-1, Math.min(1, sum * norm));
  };
}
