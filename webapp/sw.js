/* Service worker — installable PWA ("Add to Home Screen") + offline shell + fast repeat launches.
 *
 * Caching strategy, and why:
 *   - HTML / navigations -> NETWORK-FIRST. The shell must be able to discover a new release
 *     immediately; index.html is what carries the new ?v=NN stamps.
 *   - every other same-origin GET -> CACHE-FIRST. Those URLs are immutable within a release
 *     (js/css carry ?v=NN, images only ever change on deploy), and `activate` deletes every cache
 *     whose name isn't the current CACHE — so bumping CACHE below is what invalidates them.
 *     This is the whole point: an installed PWA used to wait on the network for all ~700KB of app
 *     code on EVERY launch, because the old handler was network-first for everything.
 *   - cross-origin (fonts, the LIFF SDK, the GAS API) -> not handled at all, straight to network.
 *     Never cache opaque responses; the GAS API is POST and was already skipped.
 *
 * IMPORTANT: bump CACHE on every release, together with APP_VERSION in app.js and the ?v=NN in
 * index.html. Forgetting it means clients keep serving the previous release's js/css from cache.
 */
const CACHE = 'atom-v342';

// Shell only. Everything else lands in the cache the first time it is actually requested, under the
// ?v=NN the page asked for. (The old list precached UNVERSIONED copies of every js/css file, so each
// install downloaded the entire app a second time under keys the page then never requested.)
const PRECACHE = ['./', './index.html', './manifest.json', './assets/logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {}))))  // one bad URL must not fail the install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  if (!res || !res.ok) return res;
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (x) { return; }
  if (url.origin !== self.location.origin) return;   // fonts / LIFF / GAS -> untouched

  const isHTML = req.mode === 'navigate' ||
    url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHTML) {
    e.respondWith(
      fetch(req).then(res => put(req, res))
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res)))
  );
});
