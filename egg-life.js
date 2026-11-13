// Conway's Game of Life on a 32 x 32 board that wraps round at its edges
// (the glider egg, see egg-kinds.js). A row is one 32-bit number (bit x:
// the cell in column x). The board at a generation follows from the first
// one alone: it starts again every CYCLE generations, so any generation is
// at most CYCLE steps from the start (a seek never steps far).

export const N = 32;
export const CYCLE = 112;   // generations before the board starts again

// The first board: a glider walking corner to corner, a lightweight
// spaceship along a row, a pulsar beating at one side; laid out so that
// none meets another within CYCLE (they would at generation 115).
const PATTERNS = [
  { x: 1, y: 1, rows: ['.O.', '..O', 'OOO'] },                                   // glider, towards +x +y
  { x: 26, y: 26, rows: ['.O..O', 'O....', 'O...O', 'OOOO.'] },              // lightweight spaceship, towards -x
  { x: 17, y: 2, rows: [
    '..OOO...OOO..', '.............', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '..OOO...OOO..',
    '.............', '..OOO...OOO..', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '.............',
    '..OOO...OOO..'] },                                                          // pulsar, period 3
];

export function firstBoard(patterns = PATTERNS) {
  const g = new Uint32Array(N);
  for (const p of patterns) {
    p.rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        if (row[dx] === 'O') g[(p.y + dy) % N] |= 1 << ((p.x + dx) % N);
      }
    });
  }
  return g;
}

export function step(g) {
  const out = new Uint32Array(N);
  for (let y = 0; y < N; y++) {
    const up = g[(y + N - 1) % N], row = g[y], dn = g[(y + 1) % N];
    let r = 0;
    for (let x = 0; x < N; x++) {
      const l = (x + N - 1) % N, rr = (x + 1) % N;
      const n = ((up >>> l) & 1) + ((up >>> x) & 1) + ((up >>> rr) & 1) + ((row >>> l) & 1) + ((row >>> rr) & 1)
        + ((dn >>> l) & 1) + ((dn >>> x) & 1) + ((dn >>> rr) & 1);
      if (n === 3 || (n === 2 && ((row >>> x) & 1))) r |= 1 << x;
    }
    out[y] = r >>> 0;
  }
  return out;
}

// The board at generation n (and the one before it), kept from the last call,
// so playing on costs one step a generation.
export function createLife(first = firstBoard()) {
  let gen = 0, now = first, before = first;
  return function at(n) {
    n = ((n % CYCLE) + CYCLE) % CYCLE;
    if (n < gen) { gen = 0; now = first; before = first; }
    while (gen < n) { before = now; now = step(now); gen++; }
    return { now, before: n === 0 ? new Uint32Array(N) : before };
  };
}
