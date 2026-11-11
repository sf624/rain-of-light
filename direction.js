// The rain's direction: it falls down (0) or flows sideways (1), and a rain
// keeps its direction for its whole life: it never turns. The show changes
// direction only while no rain falls (see show.js, flowAt): then only the
// few sparse drops of a still room change, or a rain the Direction setting
// changes. Either way the drops of the old direction stop coming and fade
// out; only when they have gone do those of the new direction begin, their
// first drops setting out from where drops start, and fade in. So the two
// never show at once, and neither comes or goes at once.
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

// toward: the direction the rain has at first, lit at once.
export function createDirection(toward) {
  let lit = toward;                    // the direction that makes drops (-1: none, between two)
  const w = [toward ? 0 : 1, toward ? 1 : 0];
  const gate = [{ from: null, span: OPEN }, { from: null, span: OPEN }];
  let mix = toward;                    // the flow's colour: from falling (0) to sideways (1)
  const gates = new Float32Array(4), weights = new Float32Array(2);
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
      if (lit < 0 && w[0] === 0 && w[1] === 0) {   // the old rain has gone: the new one begins
        lit = goal;
        gate[lit] = { from: flow, span: OPEN };
        begun = lit;
      }
      for (const d of [0, 1]) w[d] = Math.min(1, Math.max(0, w[d] + (d === lit ? dt : -dt) / fade));
      for (const g of gate) {          // an open gate keeps up with the falling time
        if (g.span === OPEN && wrap(flow - g.from) > KEEP) g.from = wrap(flow - KEEP);
      }
      // (The colour goes over while the new rain fades in, so a new way never jumps.)
      if (lit >= 0) mix = Math.min(1, Math.max(0, mix + Math.sign(lit - mix) * dt / fade));
      return begun;
    },
    // For the shader: per direction its weight, and its gate (from, span).
    get weights() { weights[0] = smooth(w[0]); weights[1] = smooth(w[1]); return weights; },
    get gates() { gate.forEach((g, i) => { gates[i * 2] = g.from ?? 0; gates[i * 2 + 1] = g.span; }); return gates; },
    get mix() { return smooth(mix); },
  };
}
