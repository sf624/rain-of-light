// The lattice of light points: its buffers, and the build that fills them.

// The vertex array of the points: positions (location 0), and ranks and gain (location 1).
export function createLattice(gl) {
  const pointVao = gl.createVertexArray();
  const pointBuf = gl.createBuffer();
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  const rankBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rankBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  // The wires: pairs of neighbouring LEDs on a strand, drawn as lines.
  const wireBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireBuf);
  gl.bindVertexArray(null);

  return { pointVao, pointBuf, rankBuf, wireBuf };
}

// Ranks in 0..1 for thinning. Along a strand, bit reversal: every prefix is
// spread evenly. Each strand starts that order at its own row, and strands
// get random ranks: an order shared by all strands (or a Bayer matrix across
// them) put the dark LEDs at the same heights or in the same rows of strands,
// which showed as straight dark lines across the view.
const bitsFor = (n) => Math.max(1, Math.ceil(Math.log2(n)));
function bitReverse(n, bits) {
  let v = 0;
  for (let b = 0; b < bits; b++) v = (v << 1) | ((n >> b) & 1);
  return v;
}

// Ranks along a strand of n LEDs, by bit reversal (see above): rows in use
// only, so shares map evenly onto 0..1.
function rowRanks(n) {
  const rb = bitsFor(n);
  const order = [];
  for (let r = 0; r < n; r++) order.push([bitReverse(r, rb), r]);
  order.sort((a, b) => a[0] - b[0]);
  const rank = new Float32Array(n);
  order.forEach(([, r], m) => { rank[r] = (m + 0.5) / n; });
  return rank;
}

// A fixed random number in 0..1 for (a, b): the spacing below draws from it,
// not from Math.random, so the strands themselves stay where they were.
function rand(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Spacing along a strand (the setting LED spacing, ?jitter=). Returns the rows (in row
// units, 0 .. rows) of a strand's LEDs, how many of them are lit, and the gain
// that keeps the strand's light as a whole the same.
//   0.25, 0.5: each LED moved along its strand by up to that share of the pitch.
//   pitch: each strand evenly spaced, at its own pitch (1 to 1.8 rows) and
//          phase; the LEDs past its end are never lit, and the others are
//          brighter by the pitch, so a sparse strand is not dimmer.
//   cluster: smooth waves along the strand bunch the LEDs and part them
//            (gaps of up to 1.85 rows), never past each other.
const SPACINGS = ['0.25', '0.5', 'pitch', 'cluster'];
function spacing(mode, s, ROWS, shift, at) {
  if (mode === 'pitch') {
    const m = 1 + 0.8 * rand(s, -1);
    const phase = rand(s, -2) * m;
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
      const y = phase + r * m;
      if (y <= ROWS) { at[r] = y; n = r + 1; } else at[r] = -1;
    }
    return { lit: n, gain: m };
  }
  if (mode === 'cluster') {
    const l1 = 14 + 10 * rand(s, -3), l2 = 5 + 3 * rand(s, -4);
    const p1 = 6.2832 * rand(s, -5), p2 = 6.2832 * rand(s, -6);
    // Slopes 0.55 + 0.3 < 1: an LED never passes its neighbour.
    const d = (r) => 0.55 * l1 / 6.2832 * Math.sin(6.2832 * r / l1 + p1) + 0.3 * l2 / 6.2832 * Math.sin(6.2832 * r / l2 + p2);
    const d0 = d(0), d1 = d(ROWS - 1);
    for (let r = 0; r < ROWS; r++) at[r] = r + shift + d(r) - (d0 + (d1 - d0) * r / (ROWS - 1)); // the ends stay put
    return { lit: ROWS, gain: 1 };
  }
  const a = Number(mode);
  for (let r = 0; r < ROWS; r++) at[r] = Math.min(ROWS, Math.max(0, r + shift + a * (2 * rand(s, r) - 1)));
  return { lit: ROWS, gain: 1 };
}

// Fills the buffers from the settings S and returns the sizes drawn.
export function fillLattice(gl, { pointVao, pointBuf, rankBuf, wireBuf }, S, SPAN) {
  const GRID = Math.max(2, Math.round(S.grid));
  const ROWS = Math.max(2, Math.round(S.rows));
  const count = GRID * GRID * ROWS;
  const data = new Float32Array(count * 4);
  const rank = new Float32Array(count * 3);
  const step = SPAN / (GRID - 1);
  const rowRank = rowRanks(ROWS);
  // A grid is regular: no jitter, all rows at one height, so the lattice
  // lines up in perspective.
  const grid = S.layout === 'grid';
  const jitter = S.layout === 'strands' && SPACINGS.includes(S.jitter) ? S.jitter : '';
  const at = new Float32Array(ROWS), litRank = [];
  const lit = new Uint32Array(GRID * GRID);
  let k = 0, q = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      // Jitter each strand, and shift its LEDs by up to one row, so that rows
      // and columns never line up into dark lines across the view.
      const x = -SPAN / 2 + i * step + (grid ? 0 : (Math.random() - 0.5) * step);
      const z = -SPAN / 2 + j * step + (grid ? 0 : (Math.random() - 0.5) * step);
      const shift = grid ? 0.5 : Math.random();
      const seed = Math.random() * 1000;
      const strandRank = Math.random();
      const rowStart = Math.floor(Math.random() * ROWS);
      // Scattered: every LED at a random place in its strand's cell, so no lines
      // show at all; the rain still falls down through each cell.
      const scatter = S.layout === 'scatter';
      const s = i * GRID + j;
      const sp = jitter ? spacing(jitter, s, ROWS, shift, at) : { lit: ROWS, gain: 1 };
      lit[s] = sp.lit;
      const rowsRank = sp.lit === ROWS ? rowRank : (litRank[sp.lit] ??= rowRanks(sp.lit));
      for (let r = 0; r < ROWS; r++) {
        data[k++] = scatter ? x + (Math.random() - 0.5) * step : x;
        // An LED never lit lies far below the floor, where it is culled at once.
        data[k++] = scatter ? Math.random() : !jitter ? (r + shift) / ROWS : r < sp.lit ? at[r] / ROWS : 1e4;
        data[k++] = scatter ? z + (Math.random() - 0.5) * step : z;
        data[k++] = seed;
        rank[q++] = strandRank;
        rank[q++] = r < sp.lit ? rowsRank[(r + rowStart) % sp.lit] : 2;
        rank[q++] = sp.gain;
      }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, rankBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rank, gl.STATIC_DRAW);
  // Wires: one line strip down each strand, through its LEDs (scattered LEDs
  // have none). Strips are parted by the restart index, which WebGL2 always
  // honours, so each LED is worked out once for the wires, not once per segment.
  const wires = S.layout === 'scatter' ? new Uint32Array(0) : new Uint32Array(lit.reduce((n, l) => n + l + 1, 0));
  if (wires.length) {
    let w = 0;
    for (let s = 0; s < GRID * GRID; s++) {
      for (let r = 0; r < lit[s]; r++) wires[w++] = s * ROWS + r;
      wires[w++] = 0xFFFFFFFF;
    }
  }
  gl.bindVertexArray(pointVao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wires, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { count, GRID, ROWS, wireCount: wires.length };
}
