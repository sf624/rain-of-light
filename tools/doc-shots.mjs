// Captures the pictures of docs/settings.md (see tools/doc-images.py).
//
//   node tools/doc-shots.mjs OUT_DIR [figure-name ...]
//
// tools/doc-shots.json lists the figures. Each figure has cells; each cell
// loads the page with base + its own query (`q`), on the fake clock of
// tools/page.mjs, rolls the show forward and saves OUT_DIR/<figure>/<i>.png.
// A cell (or a whole figure) may also give:
//   pre     frames rolled forward at a small size first (fast), default 60
//   frames  frames stepped at full size before the shot, default 40
//   ms      ms per frame, default 50
//   seed    the fake clock's Math.random seed (not the show's ?seed=), default 1
//   click   [x, y] as shares of the view: a click, then `after` frames (default 20)
//   keys    keys pressed after the frames, each followed by `after` frames
//   ui      true: keep the page's buttons and panel in the picture
//   w, h    a size of its own
//   crop    [x0, y0, x1, y1] as shares of the shot: doc-images.py shows only that part
// OUT_DIR/<figure>/cells.json keeps the labels (for doc-images.py) and the
// full query of each cell.
// Chrome, the GPU and CAP_MODE: see tools/page.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch } from './page.mjs';

const [OUT, ...only] = process.argv.slice(2);
if (!OUT) { console.error('usage: node tools/doc-shots.mjs OUT_DIR [figure ...]'); process.exit(2); }
// DOC_SHOTS= names another list (to try shots out).
const cfg = JSON.parse(fs.readFileSync(process.env.DOC_SHOTS || path.join(ROOT, 'tools/doc-shots.json'), 'utf8'));
const figures = cfg.figures.filter((f) => !only.length || only.includes(f.name));
const browser = await launch(OUT);

const queries = new Map();                 // figure -> the query of each cell
const jobs = figures.flatMap((f) => f.cells.map((c, i) => ({ f, c, i })));
// The first shot of a fresh GPU Chrome comes back white: take a throwaway one first.
if (browser.mode === 'gpu' && jobs.length) jobs.unshift({ ...jobs[0], warm: true });
for (const { f, c, i, warm } of jobs) {
  const w = c.w ?? f.w ?? cfg.w, h = c.h ?? f.h ?? cfg.h;
  // Later parts win: the cell's own query over the figure's, over the common one.
  const params = new URLSearchParams();
  for (const part of [cfg.base, f.base, c.q]) for (const [k, v] of new URLSearchParams(part ?? '')) params.set(k, v);
  const query = params.toString();
  if (!warm) queries.set(f, [...(queries.get(f) ?? []), query]);
  const page = await browser.open(query, { w, h, seed: c.seed ?? 1, ui: !!c.ui });
  await page.preroll(warm ? 2 : c.pre ?? f.pre ?? 60);
  await page.step(warm ? 2 : c.frames ?? f.frames ?? 40, c.ms ?? 50);
  const after = c.after ?? 20;
  if (c.click) { await page.click(c.click[0] * w, c.click[1] * h); await page.step(after, c.ms ?? 50); }
  for (const k of c.keys ?? []) { await page.key(k); await page.step(after, c.ms ?? 50); }
  const shot = await page.shot();
  await page.close();
  if (warm) continue;
  const dir = path.join(OUT, f.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${i}.png`), shot);
  console.log(`${f.name}/${i}.png  ?${query}`);
}
for (const f of figures) {
  const dir = path.join(OUT, f.name);
  fs.writeFileSync(path.join(dir, 'cells.json'), JSON.stringify({ cols: f.cols ?? 1, width: f.width,
    labels: f.cells.map((c) => c.label ?? ''), queries: queries.get(f),
    crops: f.cells.map((c) => c.crop ?? null) }));
}
browser.close();
process.exit(0);
