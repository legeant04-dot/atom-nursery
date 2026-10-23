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
const CACHE = 'atom-v467';

/* ═══ 🚚 ย้ายโดเมน — สวิตช์ส่งมอบ (2026-10-22) ═══════════════════════════════════════════════
 *
 * `''` = ปิด (ค่าปกติ ไม่ทำอะไรเลย) · ใส่ origin ใหม่ = เปิด เช่น 'https://atomnursery.co.th'
 *
 * 🔴 ต้องตรงกับ MIGRATE_TO ใน webapp/app.js เสมอ — tools/test_domain_move.js ตรึงไว้
 *
 * 🔴 เปิดสวิตช์นี้ "หลัง" โดเมนใหม่ใช้งานได้จริงแล้วเท่านั้น
 * ถ้าเปิดก่อน ผู้ปกครองจะถูกส่งไปยังโดเมนที่ยังไม่มีอยู่ — และเขาจะเข้าแอปไม่ได้เลย
 * ลำดับที่ถูกต้องอยู่ใน docs/DOMAIN_MOVE.md
 *
 * ── ทำไมต้องมีสวิตช์นี้ แทนที่จะปล่อยให้เซิร์ฟเวอร์ 301 เอง ──────────────────────────────
 *
 * แอปที่ผู้ปกครองติดตั้งไว้แล้ว มี service worker ตัวนี้คั่นอยู่ระหว่างเขากับเครือข่าย
 * ถ้าเราย้ายโดเมนแล้วหวังให้ 301 ของ GitHub จัดการเอง จะเจอสองปัญหา:
 *
 *   ① เครื่องที่มี SW เก่าค้างอยู่ จะเสิร์ฟของเก่าจาก cache ต่อไปโดยไม่เห็น 301 เลย
 *   ② และถ้ามันเห็น — การคืน response ที่ "ถูก redirect มาแล้ว" ให้การเปิดหน้า
 *      **เบราว์เซอร์จะปฏิเสธ** ผู้ปกครองจะเห็นหน้าขาว ไม่ใช่แอปใหม่
 *
 * ตัวจัดการข้อ ② อยู่ข้างล่างและ **ทำงานตลอดเวลา ไม่ขึ้นกับสวิตช์นี้** — มันต้องไปอยู่บน
 * เครื่องของผู้ปกครอง *ก่อน* วันที่เซิร์ฟเวอร์เริ่ม redirect นี่คือเหตุผลที่รุ่นนี้ต้องออกก่อน
 *
 * ── และทำไม "ไม่" ถอนตัวเอง (unregister) ─────────────────────────────────────────────────
 *
 * SW ที่ถอนตัวเองทิ้ง จะหมดความสามารถในการส่งต่อไปโดเมนใหม่ด้วย — ถ้าวันหนึ่งเซิร์ฟเวอร์เดิม
 * หยุด 301 (เช่น repo ถูกลบ หรือ Pages ถูกปิด) เครื่องที่ยังติดตั้งอยู่จะเข้าไม่ได้ถาวร
 * ตัวนี้จึงอยู่ต่อในฐานะ "ป้ายบอกทาง" และล้าง cache ทิ้งให้หมดแทน
 */
const MIGRATE_TO = '';

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
      // ย้ายโดเมนแล้ว → ล้างทุก cache ทิ้ง ไม่เหลืออะไรให้เสิร์ฟของเก่าได้อีก
      .then(ks => Promise.all(ks.filter(k => MIGRATE_TO || k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const put = (req, res) => {
  // response ที่ถูก redirect มาแล้ว ห้ามเก็บลง cache — มันคือสำเนาของ "ที่อยู่เก่าที่ถูกย้าย"
  if (!res || !res.ok || res.redirected) return res;
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

  /* 🚚 ย้ายโดเมนแล้ว — ส่งต่อทุกการเปิดหน้าไปโดเมนใหม่ พร้อม path และ query เดิม
   * (ผู้ปกครองที่กดลิงก์เก่าจาก LINE หรือสแกน QR แผ่นเดิม ต้องไปถึงหน้าที่ถูกต้อง) */
  if (MIGRATE_TO && isHTML) {
    e.respondWith(Response.redirect(MIGRATE_TO + url.pathname + url.search, 302));
    return;
  }

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => {
          /* 🔴 ห้ามคืน response ที่ "ถูก redirect มาแล้ว" ให้กับการเปิดหน้า
           *
           * เบราว์เซอร์จะปฏิเสธมันตามสเปก และผู้ปกครองจะเห็น **หน้าขาว** ไม่ใช่แอปใหม่ —
           * ซึ่งเป็นสิ่งที่จะเกิดขึ้นพอดีในวันที่เราชี้โดเมนใหม่แล้ว GitHub เริ่มตอบ 301
           *
           * แปลงเป็น redirect จริงๆ ให้เบราว์เซอร์เดินเอง · บรรทัดนี้**ไม่ขึ้นกับ MIGRATE_TO**
           * เพราะมันต้องไปอยู่บนเครื่องผู้ปกครอง *ก่อน* วันที่ย้ายจริง */
          if (res && res.redirected && res.url) return Response.redirect(res.url, 302);
          return put(req, res);
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res)))
  );
});
