// Site test: assembles the Pages site with tools/build-site.sh (one commit at
// the root, pull request heads under pr/<n>/), checks the tree, then serves it
// under /rain-of-light/ as GitHub Pages does and opens it in headless Chrome:
// the root registers its service worker, each preview loads with no error,
// loads only its own files, registers no service worker, and is not cached by
// the root's. The data files in fields/ are published as build-site.sh
// promises (a fixture commit in a clone of the repo tries the limits). A
// plain load fetches no baked field (fields/*.bin); a preview pinned to one
// fetches it from its own folder.
// Usage: node test/site.mjs [ROOT_COMMIT [N=COMMIT ...]]   (default: HEAD 1=HEAD)
// CHROME=/path/to/chrome chooses the browser. Node 22 built-ins only.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/rain-of-light/';
const WAIT_MS = 90_000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream' };
// As in tools/build-site.sh (copy_fields).
const FIELD_MAX = 262144, FIELDS_MAX = 2097152;

const args = process.argv.slice(2);
const rootRef = args[0] || 'HEAD';
const prArgs = args.length > 1 ? args.slice(1) : ['1=HEAD'];

let server, chrome;
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rain-site-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanup() {
  if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
  chrome = null;
  try { server?.close(); server?.closeAllConnections?.(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
function fail(msg) {
  console.error(`\nSITE TEST FAILED: ${msg}`);
  cleanup();
  process.exit(1);
}
const overall = setTimeout(() => fail('no result within 600 s'), 600_000);
process.on('SIGINT', () => fail('interrupted'));
process.on('SIGTERM', () => fail('terminated'));
process.on('uncaughtException', (e) => fail(`test script error: ${e.stack || e}`));
process.on('unhandledRejection', (e) => fail(`test script error: ${e?.stack || e}`));

async function poll(what, probe, timeout = WAIT_MS) {
  const end = Date.now() + timeout;
  let last = '';
  for (;;) {
    try { const v = await probe(); if (v) return v; last = ''; } catch (e) { last = ` (last error: ${e.message})`; }
    if (Date.now() > end) return fail(`timed out after ${timeout / 1000} s waiting for ${what}${last}`);
    await sleep(200);
  }
}
const git = (...a) => gitIn(ROOT, ...a);
const gitIn = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) fail(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// 1. Build.
const site = path.join(tmp, 'site');
const build = spawnSync('bash', [path.join(ROOT, 'tools/build-site.sh'), site, rootRef, ...prArgs], { cwd: ROOT, encoding: 'utf8' });
if (build.status !== 0) fail(`build-site.sh failed:\n${build.stdout}${build.stderr}`);
const previews = prArgs.map((a) => ({ n: a.split('=')[0], sha: git('rev-parse', `${a.split('=').slice(1).join('=')}^{commit}`) }));
const rootSha = git('rev-parse', `${rootRef}^{commit}`);

// 2. The tree.
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) fail(`symbolic link in the site: ${path.relative(site, p)}`);
    if (e.isDirectory()) walk(p, out); else out.push(path.relative(site, p));
  }
  return out;
}
const all = walk(site);
// The files of one copy (the root, or pr/<n>), relative to it.
const copyFiles = (dir) => all.filter((f) => dir ? f.startsWith(dir + '/') : !f.startsWith('pr/')).map((f) => dir ? f.slice(dir.length + 1) : f);
// The fields/ files a commit should publish (see copy_fields in build-site.sh):
// its regular fields/*.bin (no subfolder) of at most FIELD_MAX bytes each, or
// none if those pass FIELDS_MAX in all.
function fieldsOf(sha, g = git) {
  const keep = g('ls-tree', '-l', sha, 'fields/').split('\n').filter(Boolean).map((l) => {
    const [meta, name] = l.split('\t');
    const [mode, type, , size] = meta.split(/\s+/);
    return { name, size: Number(size), ok: type === 'blob' && mode.startsWith('100') && /^fields\/[^/]+\.bin$/.test(name) };
  }).filter((f) => f.ok && f.size <= FIELD_MAX);
  return keep.reduce((n, f) => n + f.size, 0) > FIELDS_MAX ? [] : keep.map((f) => f.name).sort();
}
const fieldsIn = (files) => files.filter((f) => f.startsWith('fields/')).sort();

function checkCopy(dir, sha, pr) {
  const label = dir || '(root)';
  const files = copyFiles(dir);
  const at = (f) => path.join(site, dir, f);
  const tracked = new Set(git('ls-tree', '-r', '--name-only', sha).split('\n'));
  for (const f of files) if (f !== 'version.json' && !tracked.has(f)) fail(`[${label}] ${f} is not a file of ${sha}`);
  for (const f of ['index.html', 'lab.html', 'main.js', 'boot.js', 'style.css', 'manifest.webmanifest', 'version.json', 'icons/icon-192.png']) {
    if (!files.includes(f)) fail(`[${label}] no ${f}`);
  }
  for (const f of tracked) if (/^[^/]+\.js$/.test(f) && !(pr && f === 'sw.js') && !files.includes(f)) fail(`[${label}] module ${f} not copied`);
  if (fieldsIn(files).join() !== fieldsOf(sha).join()) fail(`[${label}] fields/ has ${fieldsIn(files).join(', ') || 'nothing'}, not ${fieldsOf(sha).join(', ') || 'nothing'}`);
  if (pr && files.includes('sw.js')) fail(`[${label}] a preview must have no sw.js`);
  if (!pr && !files.includes('sw.js')) fail('[root] no sw.js');
  const v = JSON.parse(fs.readFileSync(at('version.json'), 'utf8'));
  if (v.sha !== sha || Number.isNaN(Date.parse(v.date)) || (pr ? v.pr !== Number(pr) : 'pr' in v)) {
    fail(`[${label}] version.json wrong: ${JSON.stringify(v)} (expected ${sha}${pr ? `, pr ${pr}` : ''})`);
  }
  // Every link in the pages and every import in the modules is relative and
  // inside this copy (only the og: tags may name the live site).
  for (const f of files.filter((x) => /\.(html|js|css|webmanifest)$/.test(x))) {
    const text = fs.readFileSync(at(f), 'utf8');
    const refs = [];
    if (f.endsWith('.html')) {
      for (const m of text.matchAll(/<(?:link|script|img|a)\b[^>]*?\s(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
    } else if (f.endsWith('.js')) {
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) refs.push(m[1]);
    } else if (f.endsWith('.webmanifest')) {
      const man = JSON.parse(text);
      refs.push(man.start_url, man.scope, ...man.icons.map((i) => i.src));
    } else {
      for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/g)) if (!m[1].startsWith('data:')) refs.push(m[1]);
    }
    for (const r of refs) {
      if (/^[a-z]+:/i.test(r) || r.startsWith('/') || r.startsWith('#')) {
        if (r.startsWith('#') || r.startsWith('https://github.com/')) continue;
        fail(`[${label}] ${f} links to ${r}: not relative`);
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), r.split(/[?#]/)[0] || '.'));
      if (target.startsWith('..')) fail(`[${label}] ${f} links to ${r}: outside its folder`);
      const isDir = target === '.' || r.endsWith('/');
      if (!files.includes(isDir ? path.posix.join(target, 'index.html') : target)) fail(`[${label}] ${f} links to ${r}: missing`);
    }
  }
  console.log(`ok  tree ${label}: ${files.length} files, ${sha.slice(0, 7)}`);
}
checkCopy('', rootSha, null);
// sw.js precaches its list: each entry must be in the root copy.
const core = fs.readFileSync(path.join(site, 'sw.js'), 'utf8').match(/const CORE = \[([\s\S]*?)\];/);
if (!core) fail('sw.js has no CORE list');
for (const m of core[1].matchAll(/'([^']*)'/g)) {
  const f = m[1] === './' ? 'index.html' : m[1];
  if (!copyFiles('').includes(f)) fail(`sw.js precaches ${m[1]}, which is not in the site`);
}
for (const p of previews) checkCopy(`pr/${p.n}`, p.sha, p.n);
const strays = new Set(all.filter((f) => f.startsWith('pr/')).map((f) => f.split('/')[1]));
for (const s of strays) if (!previews.some((p) => p.n === s)) fail(`unexpected pr/${s}/`);

// fields/ at its limits, in a clone (the repo itself is left alone): a commit
// with fields/ gets its small regular *.bin files under its own folder, and
// neither a symbolic link, a subfolder, another kind of file nor one over
// FIELD_MAX; a commit whose files pass FIELDS_MAX in all gets none; a commit
// without fields/ gets none.
{
  const clone = path.join(tmp, 'fixture');
  const c = spawnSync('git', ['clone', '--quiet', '--shared', '--no-checkout', ROOT, clone], { encoding: 'utf8' });
  if (c.status !== 0) fail(`git clone: ${c.stderr}`);
  const g = (...a) => gitIn(clone, ...a);
  g('checkout', '--quiet', '--detach', rootSha);
  const put = (name, bytes) => { fs.mkdirSync(path.dirname(path.join(clone, name)), { recursive: true }); fs.writeFileSync(path.join(clone, name), Buffer.alloc(bytes, 7)); };
  const commit = (msg) => { g('add', '-A', '.'); g('-c', 'user.name=site test', '-c', 'user.email=site@test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('rm', '-r', '--quiet', '--ignore-unmatch', 'fields');
  const none = commit('no fields');
  put('fields/a.bin', 1000); put('fields/b.bin', FIELD_MAX); put('fields/big.bin', FIELD_MAX + 1);
  put('fields/note.txt', 10); put('fields/sub/c.bin', 10);
  fs.symlinkSync('a.bin', path.join(clone, 'fields/link.bin'));
  const some = commit('fields at their limits');
  g('rm', '-r', '--quiet', 'fields');
  for (let i = 0; i < 9; i++) put(`fields/f${i}.bin`, 240_000);
  const many = commit('fields over the total');
  const out = path.join(tmp, 'fixture-site');
  const b = spawnSync('bash', [path.join(ROOT, 'tools/build-site.sh'), out, some, `2=${none}`, `3=${many}`], { cwd: clone, encoding: 'utf8' });
  if (b.status !== 0) fail(`build-site.sh on the fixture failed:\n${b.stdout}${b.stderr}`);
  const got = (dir) => (fs.existsSync(path.join(out, dir, 'fields')) ? fs.readdirSync(path.join(out, dir, 'fields')).map((f) => `fields/${f}`).sort() : []);
  const want = { '': ['fields/a.bin', 'fields/b.bin'], 'pr/2': [], 'pr/3': [] };
  for (const [dir, w] of Object.entries(want)) {
    if (got(dir).join() !== w.join()) fail(`[fixture ${dir || 'root'}] fields/ has ${got(dir).join(', ') || 'nothing'}, not ${w.join(', ') || 'nothing'}`);
    if (fieldsOf({ '': some, 'pr/2': none, 'pr/3': many }[dir], g).join() !== w.join()) fail(`[fixture ${dir || 'root'}] fieldsOf disagrees`);
  }
  if (fs.lstatSync(path.join(out, 'fields/a.bin')).size !== 1000) fail('[fixture] fields/a.bin copied wrong');
  const said = b.stdout + b.stderr;   // (a warning goes to stdout on GitHub Actions)
  if (!/big\.bin/.test(said) || !/over 2097152/.test(said)) fail(`[fixture] no warning for the files over the limits:\n${said}`);
  console.log('ok  fields/: small *.bin files published under their own folder; links, subfolders, other files and those over the limits not');
}

// 3. In the browser, under /rain-of-light/ as on GitHub Pages.
server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(site, p.slice(PREFIX.length) + (p.endsWith('/') ? 'index.html' : ''));
  if (path.relative(site, file).startsWith('..') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const base = `http://127.0.0.1:${port}${PREFIX}`;

function findChrome() {
  for (const c of [process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    if (!c) continue;
    if (c.includes('/')) { if (fs.existsSync(c)) return c; continue; }
    const r = spawnSync('which', [c], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  return fail('Chrome not found. Set CHROME=/path/to/chrome.');
}
const userDir = path.join(tmp, 'chrome');
fs.mkdirSync(userDir);
chrome = spawn(findChrome(), [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle',
  '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--mute-audio',
  '--window-size=480,300', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
], { detached: true, stdio: ['ignore', 'ignore', 'pipe'], // own process group, killed as a whole
  env: { ...process.env, TMPDIR: tmp } }); // its socket and leftovers go with tmp (keep TMPDIR short: a socket path has 107 bytes)
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });
chrome.on('exit', (code, sig) => { if (chrome) fail(`Chrome exited early (${sig || `code ${code}`}).\n${chromeErr.slice(0, 1500)}`); });
const portFile = path.join(userDir, 'DevToolsActivePort');
for (let i = 0; i < 400 && !fs.existsSync(portFile); i++) await sleep(100);
if (!fs.existsSync(portFile)) fail(`Chrome gave no debugging port.\n${chromeErr.slice(-1500)}`);
const [cport, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${cport}${wsPath}`);
let id = 0;
const pending = new Map(), handlers = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  } else if (m.method) handlers.forEach((h) => h(m));
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP connection failed')); });
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});

// Opens base + page in a new tab; returns its errors, the URLs it requested
// and an evaluator. Waits for the page to load and draw two frames.
async function open(page) {
  const errors = [], requested = [];
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  handlers.push((m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    if (m.method === 'Runtime.exceptionThrown') errors.push(`uncaught exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`);
    else if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    else if (m.method === 'Log.entryAdded' && p.entry.level === 'error') errors.push(`browser log error: ${p.entry.text} ${p.entry.url || ''}`);
    else if (m.method === 'Network.requestWillBeSent') requested.push(p.request.url);
    else if (m.method === 'Network.responseReceived' && p.response.status >= 400) errors.push(`HTTP ${p.response.status} for ${p.response.url}`);
  });
  for (const d of ['Runtime', 'Log', 'Network', 'Page']) await s(`${d}.enable`);
  await s('Page.navigate', { url: base + page });
  const ev = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await poll(`${page} to load`, () => ev(`location.href === ${JSON.stringify(base + page)} && document.readyState === 'complete'`));
  await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await sleep(1000);
  if (await ev(`!document.getElementById('fallback').hidden`)) errors.push(`#fallback shown: ${await ev(`document.getElementById('fallback').textContent`)}`);
  return { errors, requested, ev, close: () => send('Target.closeTarget', { targetId }) };
}
const scopes = (ev) => ev('navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => r.scope))');

// The root first: its service worker installs and controls the whole site,
// so the previews below are opened under it.
const main = await open('');
if (main.errors.length) fail(`[root] ${[...new Set(main.errors)].join('\n  ')}`);
if (main.requested.some((u) => u.includes('/fields/'))) fail(`[root] a plain load fetched a field: ${main.requested.filter((u) => u.includes('/fields/')).join(', ')}`);
await poll('the root service worker', () => main.ev(`navigator.serviceWorker.ready.then((r) => r.active && r.scope)`));
await poll('the root service worker to control the page', () => main.ev('!!navigator.serviceWorker.controller'));
const v0 = await main.ev(`fetch('version.json').then((r) => r.json())`);
if (v0.sha !== rootSha) fail(`[root] served version.json ${JSON.stringify(v0)}`);
console.log(`ok  root: loads, service worker at ${(await scopes(main.ev)).join(', ')}`);
await main.close();

for (const p of previews) {
  for (const page of [`pr/${p.n}/`, `pr/${p.n}/lab.html`]) {
    const t = await open(page);
    if (t.errors.length) fail(`[${page}] ${[...new Set(t.errors)].join('\n  ')}`);
    const own = base + `pr/${p.n}/`;
    const foreign = t.requested.filter((u) => !u.startsWith(own) && !u.startsWith('data:') && !u.startsWith('blob:'));
    if (foreign.length) fail(`[${page}] requested files outside its folder: ${foreign.join(', ')}`);
    const v = await t.ev(`fetch('version.json').then((r) => r.json())`);
    if (v.sha !== p.sha || v.pr !== Number(p.n)) fail(`[${page}] served version.json ${JSON.stringify(v)}`);
    await sleep(1500); // time for a registration on 'load', if there were one
    const sc = await scopes(t.ev);
    if (sc.some((x) => x !== base)) fail(`[${page}] service workers registered: ${sc.join(', ')}`);
    const cached = await t.ev(`caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys()))))
      .then((ls) => ls.flat().map((r) => r.url).filter((u) => u.includes('/pr/')))`);
    if (cached.length) fail(`[${page}] the root service worker cached preview files: ${cached.slice(0, 5).join(', ')}`);
    console.log(`ok  ${page}: loads ${t.requested.length} files of its own, ${v.sha.slice(0, 7)}, no service worker of its own, nothing cached`);
    await t.close();
  }
  // A baked form held in the lab: its field comes from the preview's own folder.
  const field = git('ls-tree', '--name-only', p.sha, 'fields/').split('\n').find((f) => f.endsWith('.bin'));
  if (field) {
    const name = path.posix.basename(field, '.bin'), page = `pr/${p.n}/lab.html?form=${name}&leds=20`;
    const t = await open(page);
    await poll(`${page} to fetch ${field}`, () => t.requested.includes(base + `pr/${p.n}/${field}`));
    await sleep(500);
    if (t.errors.length) fail(`[${page}] ${[...new Set(t.errors)].join('\n  ')}`);
    console.log(`ok  ${page}: fetches ${field} from its own folder`);
    await t.close();
  }
}

clearTimeout(overall);
cleanup();
console.log('site test passed');
process.exit(0);
