// Smoke test: serve the repo, open it in headless Chrome (software GL) over CDP,
// and fail on any error, a shown #fallback, a stalled frame loop or a black canvas.
// Usage: node test/smoke.mjs      (CHROME=/path/to/chrome to choose the browser)
// Node 22 built-ins only.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderSound, levels, RATE } from './render-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 780_000;
const MIN_FRAMES = 4; // software GL is slow: a few frames per second, so the page is small (480x300)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json' };

let server, chrome, userDir;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanup() {
  if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
  chrome = null;
  try { server?.close(); server?.closeAllConnections?.(); } catch {}
  if (userDir) { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} userDir = null; }
}
function fail(msg) {
  console.error(`\nSMOKE TEST FAILED: ${msg}`);
  cleanup();
  process.exit(1);
}
const overall = setTimeout(() => fail(`no result within ${TIMEOUT_MS / 1000} s`), TIMEOUT_MS);
process.on('SIGINT', () => fail('interrupted'));
process.on('SIGTERM', () => fail('terminated'));
process.on('uncaughtException', (e) => fail(`test script error: ${e.stack || e}`));
process.on('unhandledRejection', (e) => fail(`test script error: ${e?.stack || e}`));

const FAKE_SHA = '0123456789abcdef0123456789abcdef01234567'; // what the Pages workflow would write
function serve() {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/version.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ sha: FAKE_SHA, date: '2026-01-02T03:04:05+00:00' })); return;
    }
    const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || rel.split(path.sep).some((s) => s.startsWith('.'))
      || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function findChrome() {
  for (const c of [process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    if (!c) continue;
    if (c.includes('/')) { if (fs.existsSync(c)) return c; continue; }
    const r = spawnSync('which', [c], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  return fail('Chrome not found. Set CHROME=/path/to/chrome.');
}

async function startChrome() {
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-smoke-'));
  chrome = spawn(findChrome(), [
    '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required', '--window-size=480,300',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
  ], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] }); // own process group, killed as a whole
  let err = '';
  chrome.stderr.on('data', (d) => { err += d; });
  chrome.on('exit', (code) => { if (chrome) fail(`Chrome exited early (code ${code}).\n${err.slice(-1500)}`); });
  const portFile = path.join(userDir, 'DevToolsActivePort');
  for (let i = 0; i < 400 && !fs.existsSync(portFile); i++) await sleep(100); // a cold CI runner can take over 10 s
  if (!fs.existsSync(portFile)) fail(`Chrome gave no debugging port.\n${err.slice(-1500)}`);
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  return `ws://127.0.0.1:${port}${wsPath}`;
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) handlers.forEach((h) => h(m));
  };
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP connection failed')); });
  return {
    opened,
    on: (h) => handlers.push(h),
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const i = ++id; pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    }),
  };
}

// Minimal PNG reader (8-bit, non-interlaced RGB/RGBA): the share of non-black pixels.
function nonBlackShare(png) {
  let pos = 8, w = 0, h = 0, bpp = 4;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bpp = data[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  let prev = Buffer.alloc(stride), lit = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = (row[x] + add) & 255;
    }
    for (let x = 0; x < w; x++) if (row[x * bpp] + row[x * bpp + 1] + row[x * bpp + 2] > 30) lit++;
    prev = row;
  }
  return lit / (w * h);
}

// Count requestAnimationFrame callbacks that really run.
const COUNT_RAF = `(() => { window.__frames = 0; const r = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => r((t) => { window.__frames++; cb(t); }); })()`;

async function visit(cdp, base, query, interact) {
  const label = query || '(default)';
  const errors = [];
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const origin = new URL(base).origin;
  const urls = new Map();
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      errors.push(`uncaught exception: ${d.exception?.description || d.text} (${d.url || ''}:${d.lineNumber}:${d.columnNumber})`);
    } else if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') {
      errors.push(`browser log error: ${p.entry.text} ${p.entry.url || ''}`);
    } else if (m.method === 'Network.requestWillBeSent') urls.set(p.requestId, p.request.url);
    else if (m.method === 'Network.responseReceived' && p.response.url.startsWith(origin) && p.response.status >= 400) {
      errors.push(`HTTP ${p.response.status} for ${p.response.url}`);
    } else if (m.method === 'Network.loadingFailed' && (urls.get(p.requestId) || '').startsWith(origin) && !p.canceled) {
      errors.push(`request failed: ${urls.get(p.requestId)} (${p.errorText})`);
    }
  });
  for (const d of ['Runtime', 'Log', 'Network', 'Page']) await s(`${d}.enable`);
  await s('Emulation.setDeviceMetricsOverride', { width: 480, height: 300, deviceScaleFactor: 1, mobile: false });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_RAF });
  await s('Page.navigate', { url: `${base}${query}` });
  const evalJs = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const check = (when) => {
    if (errors.length) fail(`[${label}] ${when}:\n  ${[...new Set(errors)].join('\n  ')}`);
  };
  await sleep(1500);
  check('while loading');
  const state = await evalJs(`({ fb: !document.getElementById('fallback').hidden, text: document.getElementById('fallback').textContent, f: window.__frames })`);
  if (state.fb) fail(`[${label}] #fallback is visible: ${state.text}`);
  if (query === '#tune') { // the panel's footer: the repository link, and the commit from version.json
    let foot = null;
    for (let i = 0; i < 40 && !foot?.sha; i++) {
      foot = await evalJs(`(() => { const a = [...document.querySelectorAll('.tuner-foot a')];
        return { gh: a[0]?.href, rel: a[0]?.rel, sha: a[1]?.textContent, href: a[1]?.href }; })()`);
      if (!foot.sha) await sleep(500);
    }
    if (foot.gh !== 'https://github.com/sf624/rain-of-light' || !foot.rel.includes('noopener')) fail(`[${label}] no GitHub link in the panel: ${JSON.stringify(foot)}`);
    if (foot.sha !== FAKE_SHA.slice(0, 7) || foot.href !== `https://github.com/sf624/rain-of-light/commit/${FAKE_SHA}`) fail(`[${label}] commit link wrong: ${JSON.stringify(foot)}`);
    // a vertical drag that starts on a slider must scroll the panel, not move the slider
    const ta = await evalJs(`getComputedStyle(document.querySelector('.tuner input[type=range]')).touchAction`);
    if (ta !== 'pan-y') fail(`[${label}] the panel's sliders have touch-action ${ta}, not pan-y`);
  }
  let f2 = state.f; // wait up to 15 s for MIN_FRAMES frames, and for more frames after the check above
  for (let i = 0; i < 30 && (f2 < MIN_FRAMES || f2 - state.f < 3); i++) { await sleep(500); f2 = await evalJs('window.__frames'); }
  if (f2 < MIN_FRAMES || f2 - state.f < 3) fail(`[${label}] frame loop not advancing (${state.f} -> ${f2} frames in 15 s)`);
  if (interact) {
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 120 });
    await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 120, button: 'left', clickCount: 1 });
    await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 120, button: 'left', clickCount: 1 });
    await sleep(500);
    for (const k of 'cwdvpmpm') { // p and m twice: panel and sound go back
      await s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k, code: `Key${k.toUpperCase()}` });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: `Key${k.toUpperCase()}` });
      await sleep(250);
    }
    await sleep(1000);
    check('after click and keys');
    // The scene changes in place (no reload), and Reset brings back the mix.
    await evalJs(`(() => { window.__stay = 1; const s = [...document.querySelectorAll('.tuner select')]
      .find((x) => [...x.options].some((o) => o.value === 'crystal')); s.value = 'crystal';
      s.dispatchEvent(new Event('change')); })()`);
    await sleep(1500);
    const f = await evalJs('window.__frames');
    // A frame can take over a second on a slow software renderer: wait for one.
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) { await sleep(500); moved = await evalJs('window.__frames') > f; }
    if (await evalJs('window.__stay') !== 1) fail(`[${label}] changing the scene reloaded the page`);
    if (!moved) fail(`[${label}] frame loop stopped after changing the scene`);
    const scene = await evalJs(`(() => { [...document.querySelectorAll('.tuner-buttons button')]
      .find((b) => b.textContent === 'Reset').click(); return [...document.querySelectorAll('.tuner select')]
      .find((x) => [...x.options].some((o) => o.value === 'crystal')).value; })()`);
    if (scene !== 'mix') fail(`[${label}] Reset left the scene at ${scene}, not mix`);
    await sleep(500);
    if (await evalJs('window.__stay') !== 1) fail(`[${label}] Reset reloaded the page`);
    check('after changing the scene and Reset');
  }
  await evalJs(`(() => { const o = document.getElementById('overlay'); if (o) o.style.display = 'none'; })()`);
  await sleep(300);
  const shot = await s('Page.captureScreenshot', { format: 'png' });
  const share = nonBlackShare(Buffer.from(shot.data, 'base64'));
  if (share < 0.001) fail(`[${label}] canvas looks black (${(share * 100).toFixed(3)}% lit pixels)`);
  const f3 = await evalJs('window.__frames');
  if (f3 <= f2) fail(`[${label}] frame loop stopped (${f2} -> ${f3})`);
  if (await evalJs(`!document.getElementById('fallback').hidden`)) fail(`[${label}] #fallback became visible`);
  check('at the end');
  console.log(`ok  ${label}: ${f3} frames, ${(share * 100).toFixed(2)}% lit pixels${interact ? ', click and keys fine' : ''}`);
  await cdp.send('Target.closeTarget', { targetId });
}

const port = await serve();
const base = `http://127.0.0.1:${port}/`;
const cdp = connect(await startChrome());
await cdp.opened;

// Colour modes come from config.js (it reads `innerWidth`, so import it in the page, not in Node).
const { targetId } = await cdp.send('Target.createTarget', { url: `${base}index.html` });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await sleep(500);
const r = await cdp.send('Runtime.evaluate', { expression: `import('./config.js').then((c) => c.COLOR_MODES.map((m) => m.name))`,
  awaitPromise: true, returnByValue: true }, sessionId);
if (r.exceptionDetails || !Array.isArray(r.result.value)) fail(`could not read COLOR_MODES from config.js: ${r.exceptionDetails?.exception?.description || r.exceptionDetails?.text}`);
const modes = r.result.value;
await cdp.send('Target.closeTarget', { targetId });

await visit(cdp, base, '', true);
for (const m of modes) await visit(cdp, base, `?color=${encodeURIComponent(m)}`, false);
await visit(cdp, base, '#tune', false);
// The pinned scenes, and the mix part-way through (a form, rain going or coming).
await visit(cdp, base, '?scene=rain', true);
await visit(cdp, base, '?scene=crystal', true);
await visit(cdp, base, '?seed=7&t=100', false);

// The sound follows the show: rendered offline on the page's own clock (see
// render-audio.mjs), a held orb sounds (its voice, the pad) and a still room
// is near silence; neither clips. The fake clock makes this independent of
// how fast frames are drawn.
const [orb, still] = await renderSound([
  { query: '?scene=crystal&form=orb&seed=1', seconds: 12 },
  { query: '?scene=crystal&form=none&layer=on&seed=1', seconds: 12 },
], { root: ROOT }).catch((e) => fail(`sound render: ${e.message}`));
const a = levels(orb.L, orb.R, 6 * RATE), b = levels(still.L, still.R, 6 * RATE);
const say = (x) => `RMS ${x.rms.toFixed(1)} dBFS, peak ${x.peak.toFixed(1)} dBFS`;
if (a.over || b.over || a.peak > -3 || b.peak > -3) fail(`sound too loud: orb ${say(a)}, still room ${say(b)}`);
if (a.rms < -40) fail(`a held orb is (almost) silent: ${say(a)}`);
if (a.rms - b.rms < 3) fail(`a still room is not quieter than a form: orb ${say(a)}, still room ${say(b)}`);
console.log(`ok  sound: a held orb ${say(a)}; a still room ${say(b)}`);

clearTimeout(overall);
cleanup();
console.log('smoke test passed');
process.exit(0);
