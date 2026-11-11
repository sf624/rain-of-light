// Captures frames of the page for the README's GIFs (see tools/make-gifs.py).
//
//   node tools/capture-frames.mjs OUT_DIR [scene-name ...]
//
// For each scene of tools/scenes.json it loads the page on a fake clock (see
// tools/page.mjs: a run is repeatable), rolls the show forward, and saves one
// PNG every `step` ms of show time: OUT_DIR/<scene>/0000.png ...
// Chrome, the GPU and CAP_MODE: see tools/page.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch } from './page.mjs';

const [OUT, ...only] = process.argv.slice(2);
if (!OUT) { console.error('usage: node tools/capture-frames.mjs OUT_DIR [scene ...]'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/scenes.json'), 'utf8'));
const scenes = cfg.scenes.filter((s) => !only.length || only.includes(s.name));
const browser = await launch(OUT);

const { width: W, height: H, step, frames, preroll } = cfg;   // frames: how many PNGs per scene
const sub = Math.round(step / 2);                              // two page frames per PNG
// The first shot of a fresh GPU Chrome comes back white: take a throwaway one first.
const list = browser.mode === 'gpu' ? [{ ...scenes[0], warm: true }, ...scenes] : scenes;
for (const sc of list) {
  const t0 = Date.now();
  const page = await browser.open('dpr=1&quality=full&' + sc.q, { w: W, h: H, seed: sc.seed ?? 1 });
  const dir = path.join(OUT, sc.name);
  if (!sc.warm) fs.mkdirSync(dir, { recursive: true });
  await page.preroll(preroll);
  await page.step(4, sub);
  const n = sc.warm ? 2 : frames;
  for (let i = 0; i < n; i++) {
    await page.step(2, sub);
    const shot = await page.shot();
    if (!sc.warm) fs.writeFileSync(path.join(dir, String(i).padStart(4, '0') + '.png'), shot);
  }
  if (!sc.warm) console.log(`${sc.name}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.close();
}
browser.close();
process.exit(0);
