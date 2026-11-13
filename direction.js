// The rain's direction: it falls down (0), flows sideways (1), or runs along
// rays from a point, out (2) or in (3), and a rain keeps its direction for its
// whole life: it never turns. The show changes direction only while no rain
// falls (see show.js, flowAt): then only the few sparse drops of a still room
// change, or a rain the Direction setting changes. Either way the drops of the
// old direction stop coming and fade out; only when they have gone do those of
// the new direction begin, their first drops setting out from where drops
// start, and fade in. So no two ever show at once, and none comes or goes at once.
//
// Per direction the shader gets how much of its rain shows (w, 0 .. 1), and a
// gate: only drops whose run began (in falling time, see drop() in POINT_VS)
// from `from` on, and less than `span` later, show (wrapped at FLOW_WRAP).

import { FLOW_WRAP } from './shaders.js';

const OPEN = FLOW_WRAP / 2;   // the span of a gate that is open: later drops show too
const KEEP = 100;             // falling time an open gate reaches back (more than any drop's run)
const wrap = (x) => ((x % FLOW_WRAP) + FLOW_WRAP) % FLOW_WRAP;
const smooth = (x) => x * x * (3 - 2 * x);
// Seconds a change of direction takes: half for the old drops to fade out, half for the new to fade in.
export const CHANGE = 8;

// toward: the direction the rain has at first, lit at once; count: how many directions there are.
export function createDirection(toward, count = 2) {
  const each = (f) => Array.from({ length: count }, (_, d) => f(d));
  let lit = toward;                    // the direction that makes drops (-1: none, between two)
  const w = each((d) => (d === toward ? 1 : 0));
  const gate = each(() => ({ from: null, span: OPEN }));
  // The flow's colour: each direction's share of it (they add up to 1). The
  // lit one's share grows as the new rain fades in, the others' shrink.
  const share = each((d) => (d === toward ? 1 : 0));
  const gates = new Float32Array(count * 2), weights = new Float32Array(count), shares = new Float32Array(count);
  return {
    // goal: the direction wanted now; flow: the falling time.
    // Returns the direction of a rain that begins now (the sideways one may take a new way then), else -1.
    update(dt, goal, flow) {
      const fade = CHANGE / 2;
      let begun = -1;
      for (const g of gate) if (g.from === null) g.from = wrap(flow - KEEP);
      if (lit >= 0 && goal !== lit) {  // no new drops from here on
        gate[lit].span = wrap(flow - gate[lit].from);
        lit = -1;
      }
      if (lit < 0 && w.every((x) => x === 0)) {   // the old rain has gone: the new one begins
        lit = goal;
        gate[lit] = { from: flow, span: OPEN };
        begun = lit;
      }
      for (let d = 0; d < count; d++) w[d] = Math.min(1, Math.max(0, w[d] + (d === lit ? dt : -dt) / fade));
      for (const g of gate) {          // an open gate keeps up with the falling time
        if (g.span === OPEN && wrap(flow - g.from) > KEEP) g.from = wrap(flow - KEEP);
      }
      // (The colour goes over while the new rain fades in, so a new way never jumps.)
      if (lit >= 0) {
        let rest = 0;
        for (let d = 0; d < count; d++) if (d !== lit) rest += (share[d] = Math.max(0, share[d] - dt / fade));
        share[lit] = 1 - rest;
      }
      return begun;
    },
    // The whole state, to be brought back (the lab's seek).
    save() { return { lit, w: [...w], gate: gate.map((g) => ({ ...g })), share: [...share] }; },
    load(s) {
      lit = s.lit;
      s.w.forEach((x, d) => { w[d] = x; });
      s.gate.forEach((g, d) => { gate[d] = { ...g }; });
      s.share.forEach((x, d) => { share[d] = x; });
    },
    // For the shader: per direction its weight, its gate (from, span), and its share of the flow's colour.
    get weights() { w.forEach((x, d) => { weights[d] = smooth(x); }); return weights; },
    get gates() { gate.forEach((g, d) => { gates[d * 2] = g.from ?? 0; gates[d * 2 + 1] = g.span; }); return gates; },
    get shares() {
      // (Eased each, then scaled to add up to 1: with two in play, as they mostly are, the scale is 1.)
      let sum = 0;
      share.forEach((x, d) => { sum += (shares[d] = smooth(x)); });
      for (let d = 0; d < count; d++) shares[d] /= sum;
      return shares;
    },
  };
}
