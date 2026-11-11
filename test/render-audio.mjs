// Render the page's real sound, for a fixed seed and stretch of the show, so
// that it can be heard and measured without speakers.
//
//   node test/render-audio.mjs --query '?seed=4&t=118&weather=rain' --seconds 200 --out /tmp/x
//     writes /tmp/x.wav (16-bit stereo, 48 kHz), /tmp/x.f32 (the same as
//     32-bit floats: left then right) and /tmp/x.json (the show's state every
//     0.05 s: rain, the weight of each form and of the layer), and prints the
//     peak and the level.
//   --root DIR    the page to serve (default: this repo), e.g. an older checkout
//   --random N    the seed of Math.random in the page (default 1)
// smoke.mjs uses renderSound() for a short check.
//
// How: headless Chrome opens the page with a fake clock (performance.now,
// requestAnimationFrame and setTimeout are driven from here, as in a
// frame-by-frame capture), and the page's AudioContext is replaced by an
// OfflineAudioContext. The m key turns the sound on (the same path as a
// user's key); then the context renders, suspending every 0.05 s of sound to
// run one frame of the page, so main.js hands the show's state to audio.js
// exactly as it does live, and audio.js schedules on that same clock. There
// is no hook in the page's code.
// Limits: Math.random is seeded, but the weather, the waves and the music
// still differ between two versions of the code unless the URL pins them (pin
// the weather with ?weather=); the lattice is drawn tiny (?grid=8&rows=8),
// which the sound does not depend on; a frame is 0.05 s (20 fps).
// Node 22 built-ins only, like smoke.mjs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RATE = 48000;
const STEP = 0.05;
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of [process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    if (!c) continue;
    if (c.includes('/')) { if (fs.existsSync(c)) return c; continue; }
    const r = spawnSync('which', [c], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  throw new Error('Chrome not found. Set CHROME=/path/to/chrome.');
}

// The fake clock and the offline context, set up before the page's scripts run.
const pageScript = (seconds, random) => `(() => {
  let now = 1000, seq = 0; const frames = [], timers = [];
  let s = ${random >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  window.cancelAnimationFrame = () => {};
  window.setTimeout = (fn, ms = 0, ...a) => { timers.push({ id: ++seq, at: now + Math.max(0, Number(ms) || 0), fn, a }); return seq; };
  window.clearTimeout = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
  window.__step = (ms) => {
    now += ms;
    for (;;) {
      let k = -1;
      timers.forEach((x, i) => { if (x.at <= now && (k < 0 || x.at < timers[k].at)) k = i; });
      if (k < 0) break;
      const [x] = timers.splice(k, 1);
      x.fn(...x.a);
    }
    for (const cb of frames.splice(0)) cb(now);
  };
  try { localStorage.clear(); } catch {}
  window.AudioContext = window.webkitAudioContext = function () {
    if (window.__offline) throw new Error('a second AudioContext');
    const ctx = window.__offline = new OfflineAudioContext(2, Math.ceil(${seconds} * ${RATE}), ${RATE});
    ctx.resume = () => Promise.resolve();   // the page's own resume: the render drives the context
    return ctx;
  };
  window.__render = async () => {
    const ctx = window.__offline;
    if (!ctx) throw new Error('the sound did not start');
    const n = Math.floor(${seconds} / ${STEP}) - 1;
    let k = 0;
    const onSuspend = () => {
      window.__step(${STEP * 1000});
      if (++k < n) ctx.suspend((k + 1) * ${STEP}).then(onSuspend);
      OfflineAudioContext.prototype.resume.call(ctx);
    };
    ctx.suspend(${STEP}).then(onSuspend);
    const buf = await ctx.startRendering();
    const all = new Float32Array(buf.length * 2);
    all.set(buf.getChannelData(0), 0);
    all.set(buf.getChannelData(1), buf.length);
    await fetch('/__sound', { method: 'POST', body: all });
    return buf.length;
  };
})()`;

// Render each job { query, seconds, random } of the page at root: returns
// [{ L, R, track }] (Float32Arrays at RATE; the show's state every STEP).
export async function renderSound(jobs, { root = HERE } = {}) {
  let saved = null, chrome = null;
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && p === '/__sound') {   // the rendered samples
      const parts = [];
      req.on('data', (d) => parts.push(d));
      req.on('end', () => { saved = Buffer.concat(parts); res.end('ok'); });
      return;
    }
    const file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-sound-'));
  const results = [];
  const kill = () => { if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} } };
  process.on('exit', kill);   // also when the caller exits early
  try {
    chrome = spawn(findChrome(), ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle',
      '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=320,200',
      '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank'],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'] }); // own process group, killed as a whole
    let err = '';
    chrome.stderr.on('data', (d) => { err += d; });
    const portFile = path.join(userDir, 'DevToolsActivePort');
    for (let i = 0; i < 400 && !fs.existsSync(portFile); i++) await sleep(100); // a cold CI runner can take over 10 s
    if (!fs.existsSync(portFile)) throw new Error(`Chrome gave no debugging port.\n${err.slice(0, 1500)}`);
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    let id = 0;
    const pending = new Map(), errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP connection failed')); });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const i = ++id; pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

    for (const { query = '?seed=4', seconds = 30, random = 1 } of jobs) {
      const q = `${query}${query.includes('?') ? '&' : '?'}grid=8&rows=8&quality=full&mirror=0`;
      saved = null;
      errors.length = 0;
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => send(m, p, sessionId);
      await s('Runtime.enable');
      await s('Page.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: 320, height: 200, deviceScaleFactor: 1, mobile: false });
      await s('Page.addScriptToEvaluateOnNewDocument', { source: pageScript(seconds, random) });
      await s('Page.navigate', { url: base + 'index.html' + q });
      const ev = async (expression) => {
        const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      let ready = false;
      for (let i = 0; i < 300 && !ready; i++) {
        await sleep(100);
        ready = await ev('typeof window.__step === "function" && document.readyState === "complete" && !!document.querySelector(".sound-toggle")');
      }
      if (!ready) throw new Error(`[${query}] the page did not load`);
      // One frame, then the m key (as a user turns the sound on), then the render.
      await ev(`window.__step(${STEP * 1000})`);
      await s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', text: 'm', code: 'KeyM' });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm', code: 'KeyM' });
      const length = await ev('window.__render()');
      if (errors.length) throw new Error(`[${query}] errors in the page:\n  ${errors.join('\n  ')}`);
      if (!saved || saved.length !== length * 8) throw new Error(`[${query}] no samples came back`);
      const f32 = new Float32Array(saved.buffer, saved.byteOffset, length * 2);
      results.push({ L: f32.subarray(0, length), R: f32.subarray(length), track: await showTrack(root, q, seconds) });
      await send('Target.closeTarget', { targetId });
    }
    ws.close();
  } finally {
    kill();
    process.off('exit', kill);
    server.close();
    server.closeAllConnections?.();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  return results;
}

// The show at each step, from show.js itself (the same seed and settings as
// the page; it is one frame ahead of the sound, as the page is).
async function showTrack(root, query, seconds) {
  const params = new URLSearchParams(query.slice(query.indexOf('?')));
  globalThis.innerWidth ??= 320; globalThis.innerHeight ??= 200;   // config.js reads them
  const { createShow } = await import(pathToFileURL(path.join(root, 'show.js')).href);
  const { DEFAULTS } = await import(pathToFileURL(path.join(root, 'config.js')).href);
  const S = { ...DEFAULTS };
  for (const [k, v] of params) if (k in S) S[k] = typeof DEFAULTS[k] === 'number' ? Number(v) : v;
  const show = createShow(S, { feet: -7.5, seed: Number(params.get('seed')) });
  const track = [];
  let t = Number(params.get('t')) || 0;
  show.update(t, STEP);
  show.update(t += STEP, STEP);
  const NAMES = ['orb', 'spiral', 'layer', 'ring'];   // by form type
  for (let k = 0; k * STEP < seconds; k++) {
    const st = show.update(t += STEP, STEP);
    const w = { orb: 0, spiral: 0, ring: 0 };
    for (let n = 0; n < 2; n++) if (st.A[n * 4 + 1] > 0) w[NAMES[st.A[n * 4]]] += st.A[n * 4 + 1];
    const r3 = (x) => Math.round(x * 1000) / 1000;
    track.push({ at: r3(k * STEP), t: r3(t), rain: r3(st.rain), orb: r3(w.orb), spiral: r3(w.spiral), ring: r3(w.ring), layer: r3(st.A[2 * 4 + 1]) });
  }
  return track;
}

// Peak and RMS (dBFS) of a stretch, and how many samples reach full scale.
export function levels(L, R, from = 0, to = L.length) {
  let peak = 0, sum = 0, over = 0;
  for (let i = from; i < to; i++) {
    for (const x of [L[i], R[i]]) {
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 1) over++;
      sum += x * x;
    }
  }
  const db = (x) => 20 * Math.log10(x || 1e-10);
  return { peak: db(peak), rms: db(Math.sqrt(sum / (2 * (to - from)))), over };
}

function writeWav(file, L, R) {
  const n = L.length, wav = Buffer.alloc(44 + n * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, wav);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
  const out = args.out || path.join(os.tmpdir(), 'rain-sound');
  const seconds = Number(args.seconds || 60);
  const t0 = Date.now();
  try {
    const [{ L, R, track }] = await renderSound([{ query: args.query, seconds, random: Number(args.random || 1) }],
      { root: path.resolve(args.root || HERE) });
    const both = new Float32Array(L.length * 2);
    both.set(L, 0); both.set(R, L.length);
    fs.writeFileSync(`${out}.f32`, Buffer.from(both.buffer));
    writeWav(`${out}.wav`, L, R);
    fs.writeFileSync(`${out}.json`, JSON.stringify(track));
    const { peak, rms, over } = levels(L, R);
    console.log(`${out}.wav: ${(L.length / RATE).toFixed(1)} s, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s; `
      + `peak ${peak.toFixed(1)} dBFS, RMS ${rms.toFixed(1)} dBFS, ${over} samples at or above full scale`);
  } catch (e) {
    console.error(`render failed: ${e.stack || e}`);
    process.exit(1);
  }
}
