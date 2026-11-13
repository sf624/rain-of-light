// Network first, cache as the fallback: online users always get the newest
// files (there is no build step and no file hashing), offline users get the
// last ones they saw. No version to bump.
const CACHE = 'rain-of-light';

// Precached on install, so that one visit is enough to work offline.
// Add new modules and assets here. (The baked forms' fields, fields/*.bin,
// are not: each is fetched only when its form is about to show, and kept
// then, as every file fetched is, see below.)
const CORE = [
  './', 'index.html', 'lab.html', 'boot.js', 'style.css', 'manifest.webmanifest', 'favicon.svg',
  'main.js', 'config.js', 'shaders.js', 'lattice.js', 'gl.js', 'show.js', 'forms.js', 'director.js', 'direction.js',
  'fields.js', 'controls.js', 'clock.js', 'keys.js', 'hud.js', 'audio.js', 'sway.js', 'tuner.js', 'wakelock.js', 'rotate.js',
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

// The previews of pull requests (pr/<n>/ under this scope, see
// docs/development.md) are left to the network: neither served from this
// cache nor stored in it.
const PREVIEWS = new URL('pr/', self.registration.scope).pathname;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith(PREVIEWS)) return;
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
