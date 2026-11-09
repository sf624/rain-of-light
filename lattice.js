// The lattice of light points: its buffers, and the build that fills them.

// The vertex array of the points: positions (location 0) and ranks (location 1).
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
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return { pointVao, pointBuf, rankBuf };
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

// Fills the buffers from the settings S and returns the sizes drawn.
export function buildLattice(gl, { pointBuf, rankBuf }, S, SPAN) {
  const GRID = Math.max(2, Math.round(S.grid));
  const ROWS = Math.max(2, Math.round(S.rows));
  const count = GRID * GRID * ROWS;
  const data = new Float32Array(count * 4);
  const rank = new Float32Array(count * 2);
  const step = SPAN / (GRID - 1);
  const rb = bitsFor(ROWS);
  // Rank only among the rows in use, so shares map evenly onto 0..1.
  const rowOrder = [];
  for (let r = 0; r < ROWS; r++) rowOrder.push([bitReverse(r, rb), r]);
  rowOrder.sort((a, b) => a[0] - b[0]);
  const rowRank = new Float32Array(ROWS);
  rowOrder.forEach(([, r], n) => { rowRank[r] = (n + 0.5) / ROWS; });
  let k = 0, q = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      // Jitter each strand, and shift its LEDs by up to one row, so that rows
      // and columns never line up into dark lines across the view.
      const x = -SPAN / 2 + i * step + (Math.random() - 0.5) * step;
      const z = -SPAN / 2 + j * step + (Math.random() - 0.5) * step;
      const shift = Math.random();
      const seed = Math.random() * 1000;
      const strandRank = Math.random();
      const rowStart = Math.floor(Math.random() * ROWS);
      // Scattered: every LED at a random place in its strand's cell, so no lines
      // show at all; the rain still falls down through each cell.
      const scatter = S.layout === 'scatter';
      for (let r = 0; r < ROWS; r++) {
        data[k++] = scatter ? x + (Math.random() - 0.5) * step : x;
        data[k++] = scatter ? Math.random() : (r + shift) / ROWS;
        data[k++] = scatter ? z + (Math.random() - 0.5) * step : z;
        data[k++] = seed;
        rank[q++] = strandRank;
        rank[q++] = rowRank[(r + rowStart) % ROWS];
      }
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, rankBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rank, gl.STATIC_DRAW);
  return { count, GRID, ROWS };
}
