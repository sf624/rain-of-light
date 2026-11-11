// Opens the page in Chrome on a fake clock, for the capture tools
// (capture-frames.mjs for the GIFs, doc-shots.mjs for the docs' pictures).
//
// The fake clock: seeded Math.random, and performance.now and
// requestAnimationFrame that move only when a tool steps them, so a run is
// repeatable. The page's own buttons and panel are hidden unless asked.
//
// Needs Node 22 and Chrome. It runs Chrome with a window, on the GPU (WSLg on
// WSL2 with an NVIDIA card: about 50 ms per 960x540 frame); set CAP_MODE=
// swiftshader for headless software GL (several seconds per frame). CHROME=
// names the browser, LD_LIBRARY_PATH may need its libraries. It serves the
// repo itself on a random port and kills its Chrome at the end.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's controls, hidden in captures (the canvas alone).
const UI = '.overlay,.tuner-toggle,.sound-toggle,.full-toggle,.rotate-toggle,.volume-bar,.tuner';

const clock = (seed, ui) => `(() => {
  let now = 1000; const cbs = []; let s = ${seed >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (n, ms) => { for (let i = 0; i < n; i++) { now += ms; for (const cb of cbs.splice(0)) cb(now); } return now; };
  try { localStorage.clear(); } catch {}
  ${ui ? '' : `addEventListener('DOMContentLoaded', () => { const st = document.createElement('style');
    st.textContent = '${UI}{display:none !important}'; document.head.appendChild(st); });`}
})()`;

// Starts the server and Chrome; tmp is a directory for Chrome's profile.
export async function launch(tmp) {
  const MODE = process.env.CAP_MODE || 'gpu';
  const CHROME = process.env.CHROME || process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
  fs.mkdirSync(tmp, { recursive: true });
  const userDir = fs.mkdtempSync(path.join(tmp, 'chrome-'));
  let chrome;
  const cleanup = () => {
    if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGTERM', () => process.exit(2));
  process.on('SIGINT', () => process.exit(2));

  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const flags = ['--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`,
    ...(MODE === 'gpu' ? ['--use-angle=gl-egl', '--ozone-platform=x11', '--window-size=1400,900']
      : ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'])];
  const LIBS = '/usr/lib/x86_64-linux-gnu:' + process.env.HOME + '/.cache/explain-bash-tools/libs/usr/lib/x86_64-linux-gnu';
  chrome = spawn(CHROME, [...flags, 'about:blank'], { detached: true, stdio: 'ignore',
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || LIBS,
      ...(MODE === 'gpu' ? { GALLIUM_DRIVER: 'd3d12', MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA' } : {}) } });
  const portFile = path.join(userDir, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

  // Opens index.html + query in a new tab, w x h, on the fake clock.
  async function open(query, { w, h, seed = 1, ui = false }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    const size = (width, height) => s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await s('Runtime.enable'); await s('Page.enable');
    await size(w, h);
    await s('Page.addScriptToEvaluateOnNewDocument', { source: clock(seed, ui) });
    await s('Page.navigate', { url: base + 'index.html?' + query });
    const ev = async (expression) => { const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    for (let i = 0; i < 100; i++) { await sleep(100); if (await ev('typeof window.__step === "function" && !!document.querySelector("canvas") && document.readyState === "complete"')) break; }
    await sleep(500);
    const step = async (n, ms) => { for (; n > 0; n -= 20) await ev(`window.__step(${Math.min(n, 20)}, ${ms})`); };
    return {
      ev, step,
      // Rolls the show forward at a small size (fast), then goes back to w x h.
      async preroll(n) {
        await size(192, 108); await sleep(200);
        await step(n, 50);
        await size(w, h); await sleep(300);
      },
      async click(x, y) {
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      },
      async key(k) {
        await s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k });
        await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
      },
      async shot(type = 'png') { return Buffer.from((await s('Page.captureScreenshot', { format: type })).data, 'base64'); },
      close: () => send('Target.closeTarget', { targetId }),
    };
  }
  return { open, mode: MODE, close: () => server.close() };
}
