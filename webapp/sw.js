/* Basic service worker — enables "Add to Home Screen" (installable PWA) + offline shell. */
const CACHE = 'atom-v50';
const ASSETS = ['./','./index.html','./styles.css','./i18n.js','./i18n_tr.js','./mockdata.js','./growth_standard.js','./xlsx_min.js','./engine.js','./api.js','./app.js','./assets/logo.png','./manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
// network-first: always try the network (fresh code), fall back to cache offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{}); return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
