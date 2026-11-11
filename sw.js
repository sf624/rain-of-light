// Network first, cache as the fallback: online users always get the newest
// files (there is no build step and no file hashing), offline users get the
// last ones they saw. No version to bump.
const CACHE = 'rain-of-light';

// Precached on install, so that one visit is enough to work offline.
// Add new modules and assets here.
const CORE = [
  './', 'index.html', 'lab.html', 'boot.js', 'style.css', 'manifest.webmanifest', 'favicon.svg',
  'main.js', 'config.js', 'shaders.js', 'lattice.js', 'gl.js', 'show.js', 'forms.js', 'lorenz.js', 'director.js', 'direction.js',
  'controls.js', 'audio.js', 'sway.js', 'tuner.js', 'wakelock.js', 'rotate.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: revalidate, so the host's max-age does not delay an update.
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
