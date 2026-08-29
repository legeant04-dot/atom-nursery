/* api.js — single API gateway (browser). Business logic lives in engine.js (shared with GAS via src/Engine.gs).
 * MODE='mock' = run the engine in-browser on window.MOCK. MODE='gas' = POST {action,payload} to the GAS Web App,
 * which runs the SAME engine on data hydrated from Google Sheets (see src/GasEngine.gs).
 * Keep MODE='mock' until the GAS engine is deployed; GAS_URL is kept ready for the switch.
 */
// DEMO_MODE=true keeps the role chooser / demo logins for testing. At go-live flip it to false
// (LINE-only login) AND set SCHOOL_CONFIG RequireSessionToken='true' (server-side enforcement).
window.CONFIG = { MODE: 'gas', GAS_URL: 'https://script.google.com/macros/s/AKfycbxWUgs0oPyEN52F1qCGETDDbOVGeIBKe18u8_vDYz5bjKrHuS7V541oaeWqWPBsx-7d/exec', LIFF_ID: '2010457597-hcIeTe2L', DEMO_MODE: false };

(function () {
  const M = window.MOCK;
  // this file's own ?v=NN, reused for anything we load on demand so it can never go stale
  const VQ = (function () { const s = document.currentScript && document.currentScript.src, q = s && s.split('?')[1]; return q ? '?' + q : ''; })();

  // engine.js (154KB) is NOT shipped any more: in gas mode every handler runs server-side on the
  // same engine via src/Engine.gs, and the only thing the browser ever wanted out of it was this
  // one helper. Keep it byte-identical to ageMonths() in engine.js / src/Engine.gs.
  window.AGEMONTHS = function (dob) { const d = new Date(dob), n = new Date();
    let m = (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth());
    if (n.getDate() < d.getDate()) m--; return Math.max(0, m); };

  // load one of our own scripts on demand, inheriting this file's ?v=NN so it can never go stale.
  // Repeat calls for the same src share one promise, so two callers can't inject it twice.
  const _loaded = {};
  window.__atomLoadScript = function (file, isReady) {
    if (isReady && isReady()) return Promise.resolve();
    if (_loaded[file]) return _loaded[file];
    return (_loaded[file] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = file + VQ;
      s.onload = res; s.onerror = () => { delete _loaded[file]; rej(new Error(file + ' failed to load')); };
      document.head.appendChild(s);
    }));
  };

  // mock mode (dev/demo) still runs the whole engine in the browser — fetch it, and the sample rows,
  // on the first call instead of on every page load, so production never pays for either.
  let _H = null, _engineP = null;
  function mockHandlers() {
    if (_H) return Promise.resolve(_H);
    if (!_engineP) _engineP = Promise.all([
      window.__atomLoadScript('engine.js', () => !!window.createAtomAPI),
      window.__atomLoadScript('mockdata.js', () => !!(M && M.students && M.students.length)),
    ]).then(() => {
      // seed: per-student Drive folder for the demo students (new students get one at registration)
      M.students.forEach(s => { if (!s.DriveFolderUrl) s.DriveFolderUrl = 'drive://' + (M.config.StudentFolderRoot || 'AtomNursery_Students') + '/' + String(s.NameTH || s.StudentID).trim().replace(/\s+/g, '_'); });
      _H = window.createAtomAPI(M, window.GROWTH_STD).H;   // GROWTH_STD comes from growth_standard.js
      return _H;
    });
    return _engineP;
  }

  // HMAC session token from auth — sent with every request so the server can verify the caller
  // and authorize by their real identity (enforced server-side once RequireSessionToken='true').
  // A session token is "<base64 body>.<signature>". Anything else stored here is junk from an older
  // build or a truncated write — sending it achieves nothing and used to be able to take the whole
  // request down server-side, so drop it on the way in rather than carry it around.
  let _session = null;
  try { const t = localStorage.getItem('atom_session_token');
    if (t && t.indexOf('.') > 0) _session = t; else if (t) localStorage.removeItem('atom_session_token');
  } catch (e) {}
  window.__atomClearSession = () => { _session = null; try { localStorage.removeItem('atom_session_token'); } catch (e) {} };
  /**
   * The API always answers JSON. If it does not, something upstream replied for it — Apps Script's
   * own HTML error page, a Google sign-in page, or a captive portal — and r.json() would surface
   * 'Unexpected token "<", "<!DOCTYPE"...' to the user, which tells them nothing. Say what actually
   * happened instead, and keep the first slice of the body for diagnosis.
   */
  // Google rejects an oversized POST before the script runs and answers with an HTML page. Catch it
  // here, where we can still say which action and how big, instead of letting it look like a crash.
  const MAX_POST = 6000000;   // ~6 MB of JSON; a compressed slip is ~150 KB
  // Google occasionally answers a perfectly good request with an error PAGE instead of handing it to
  // the script — observed live as a 404 + HTML on one call and a clean 200 on the identical call
  // moments later. Retrying is what a person does anyway, so do it for them.
  // Only for calls that cannot double-charge: a read, or auth/ping. A write is reported, never repeated.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Resolve when the app is on screen again. Retrying while it is still in the background just
  // gets cancelled a second time on iOS.
  const visible = () => new Promise(r => {
    if (typeof document === 'undefined' || !document.hidden) return r();
    const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); r(); } };
    document.addEventListener('visibilitychange', on);
    setTimeout(() => { document.removeEventListener('visibilitychange', on); r(); }, 30000);   // never hang forever
  });
  async function postGas(body, attempt) {
    attempt = attempt || 0;
    const payload = JSON.stringify(Object.assign({ token: _session }, body));
    if (payload.length > MAX_POST) {
      const e = new Error('ไฟล์ที่แนบมาใหญ่เกินไป (' + Math.round(payload.length / 1048576) + ' MB) — กรุณาถ่ายใหม่หรือย่อรูปก่อน');
      e.code = 'TOO_LARGE';
      throw e;
    }
    /* The request never reached Google at all.
     *
     * fetch() rejects with a bare TypeError — Safari words it "Load failed" — and that message went
     * straight to the user and into the error log, where it was the top unexplained failure on iOS
     * (8% of calls, against 0% on desktop). The usual cause is not a broken network: iOS cancels an
     * in-flight request when the app goes to the background, and with calls that took nine seconds,
     * switching away for a moment was enough. There was also NO retry on this path — only on an
     * unreadable reply — so one blip failed the screen outright.
     *
     * So: wait for the app to come back to the foreground, then try again, and only give up with a
     * message that says what actually happened. A write is still never repeated.
     */
    let r;
    try { r = await fetch(CONFIG.GAS_URL, { method: 'POST', body: payload }); }
    catch (netErr) {
      if (canRepeat(body) && attempt < 2) {
        if (typeof document !== 'undefined' && document.hidden) await visible();
        await sleep(400 * (attempt + 1));
        return postGas(body, attempt + 1);
      }
      const e2 = new Error('เชื่อมต่อไม่ได้ — กรุณาตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่');
      e2.code = 'OFFLINE';
      throw e2;
    }
    const text = await r.text();
    try {
      const j = JSON.parse(text);
      // the server hands back a fresh token when the current one is over halfway through its life
      if (j && j.token) { _session = j.token; try { localStorage.setItem('atom_session_token', j.token); } catch (x) {} }
      /* ---- does this reply answer the question we asked? --------------------------------------
       * A POST whose body is lost in transit reaches the web app as an action-less GET. The server
       * used to answer that with its health check — ok:true, data {service,status,time} — and this
       * function handed it back as if it were the data. The screen then died on
       * "x.map is not a function": the v186 crash, still in the 2026-08-11 report as
       *   batchShape :: data=object inner=service,status,time
       * Every reply now names its action, so an answer to a DIFFERENT question is caught here
       * instead of reaching a screen. A reply with no name at all is from an older deployment and
       * is left alone, so the app keeps working while the two sides roll out.
       */
      const asked = (body && body.action) || '';
      const lost = j && (
        (j.error && j.error.code === 'NO_ACTION') ||        // the body never arrived: nothing ran
        (j.a && asked && j.a !== asked));                   // answered something else entirely
      if (lost) {
        /* WHY does a POST arrive as an action-less GET? Eight of these across seven people in one
         * day and we still cannot say. Guessing is how the v186 crash went unexplained for months,
         * so record the three facts that would identify it instead: the HTTP status, whether the
         * response came back from a REDIRECT, and where it finally landed. Apps Script answers /exec
         * with a 302 to googleusercontent.com, and a 302 on a POST is re-issued by the browser as a
         * GET — which is exactly what an action-less GET looks like from the server's side. If that
         * is the mechanism these three fields will say so, and if it is not they rule it out. */
        let diag = '';
        try { diag = ' http=' + r.status + (r.redirected ? ' redirected' : '') +
          ' via=' + String(r.url || '').replace(/^https?:\/\//, '').split('/')[0]; } catch (x) {}
        // never log the logger: a lost perfLog reply that recorded itself could feed itself forever
        if (asked !== 'perfLog') PERF.err('lostReply', asked + ' got ' + ((j.a || (j.error && j.error.code)) || '?') + ' attempt=' + attempt + diag);
        /* A read is simply asked again. A WRITE is not repeated — a duplicated payment is worse
         * than an error the person can act on — EXCEPT where the server itself refuses the
         * duplicate: a second check-in is answered ALREADY_CHECKED_IN, which the app now treats as
         * the success it is (v245). Those two are safe to repeat because the SERVER makes them
         * safe, not because we hope the first one did nothing. That is the whole of the exception,
         * and it is why a teacher whose morning punch is lost in transit no longer has to notice. */
        if (canRepeat(body) && attempt < 2) {
          await sleep(400 * (attempt + 1));
          return postGas(body, attempt + 1).then(d => {
            // the retry worked: say so, or the report accuses a request nobody ever saw fail
            if (asked !== 'perfLog') { try { PERF.mark('healed', asked, 0); } catch (x) {} }
            return d;
          });
        }
        // NO_ACTION means the server never dispatched anything, so nothing was saved — say that,
        // because it is what tells the person it is safe to simply do it again.
        const e3 = new Error('คำขอไม่ถึงระบบ — ยังไม่มีการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
        e3.code = 'LOST_REQUEST';
        throw e3;
      }
      return j;
    } catch (e) {
      /* The reply above was READ fine — it just was not ours, and the branch that decided so threw
       * from INSIDE this try. Without this line that carefully-worded refusal ("nothing was saved,
       * it is safe to do again") was caught here and replaced with "อ่านคำตอบจากระบบไม่ได้", which
       * is both wrong and useless to the person holding the phone; the log said BAD_RESPONSE for
       * what was really a lost request, so the two were indistinguishable in the report. */
      if (e && e.code === 'LOST_REQUEST') throw e;
      const looksHTML = /^\s*<(!doctype|html)/i.test(text);
      try { console.error('postGas non-JSON', body && body.action, r.status, text.slice(0, 300)); } catch (x) {}
      // a batch is retried only when every call in it is safe to repeat
      if (canRepeat(body) && attempt < 2) { await sleep(400 * (attempt + 1)); return postGas(body, attempt + 1); }
      const err = new Error(looksHTML
        ? 'ระบบของโรงเรียนตอบกลับไม่ถูกต้อง (HTTP ' + r.status + ') — กรุณาลองใหม่อีกครั้ง'
        : 'อ่านคำตอบจากระบบไม่ได้ (HTTP ' + r.status + ')');
      err.code = 'BAD_RESPONSE';
      throw err;
    }
  }

  /* ---- Phase 0 telemetry: how slow is it REALLY, and where does it break? ------------------
   * PageSpeed can only measure the signed-out login page. Everything users complain about —
   * "the finance screen takes forever", "it errors on my phone" — happens AFTER sign-in, behind
   * LINE, where no external tool can reach. So the app measures itself.
   *
   * PRIVACY (PDPA): rows carry NO names, NO student/parent/staff ids, and NO payloads — only the
   * action name, how long it took, whether it failed, and coarse device/connection class. The
   * session id is random per browser session and is never linked to a person.
   *
   * SAFETY: telemetry is best-effort and must never be able to slow down, block, or break real
   * work. Every path is wrapped; a failure to log is simply dropped. It calls postGas directly,
   * bypassing window.api, so it can never take the write lock, bust the read cache, or be timed
   * by itself (which would recurse).
   *
   * OFF SWITCH: localStorage.atom_perf_off='1' on a device, or SCHOOL_CONFIG PerfLog='off'
   * server-side to stop collection for everyone.
   */
  const PERF = (function () {
    let off = false;
    try { off = localStorage.getItem('atom_perf_off') === '1'; } catch (e) {}
    const BUF_MAX = 40;          // flush early once this many rows are queued
    const FLUSH_MS = 25000;      // ...otherwise every 25s, so one bad phone costs ~3 requests/min
    const SESSION_CAP = 2000;    // hard stop: a runaway loop must never spam the sheet
    const MSG_MAX = 200;         // truncate error text; never send a whole stack

    let sid = '';
    try { sid = sessionStorage.getItem('atom_perf_sid') || ''; } catch (e) {}
    if (!sid) {
      sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { sessionStorage.setItem('atom_perf_sid', sid); } catch (e) {}
    }

    // coarse buckets only — enough to answer "is it only on old Android / on 3G?", not enough to
    // identify a device.
    const dev = (function () {
      try {
        const u = navigator.userAgent || '';
        if (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return 'iPad';
        if (/iPhone|iPod/.test(u)) return 'iOS';
        if (/Android/.test(u)) return 'Android';
        return 'Desktop';
      } catch (e) { return '?'; }
    })();
    const net = () => { try { return (navigator.connection && navigator.connection.effectiveType) || ''; } catch (e) { return ''; } };
    const standalone = (function () {
      try { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
      catch (e) { return false; }
    })();

    let buf = [], timer = null, total = 0, sending = false;
    // Cache hits are far too frequent to be worth a row each — they would eat the session cap and
    // bury the real data. Count them instead: the ratio is what matters (a high hit rate is why the
    // app feels instant, and a low one on a given screen explains why that screen does not).
    let hits = 0, misses = 0;

    function flush(beacon) {
      if ((!buf.length && !hits && !misses) || sending) return;
      const rows = buf; buf = [];
      const h = hits, m = misses; hits = 0; misses = 0;
      clearTimeout(timer); timer = null;
      // The token is sent so the SERVER can label the row with the caller's verified role. The
      // client never states its own role — a self-reported role would make the one report we base
      // decisions on trivial to poison. No token is fine, and is itself the interesting case.
      const body = JSON.stringify({
        action: 'perfLog', token: _session,
        payload: { sid: sid, ver: (window.__atomVer || ''), dev: dev, net: net(), pwa: standalone ? 1 : 0, hit: h, miss: m, rows: rows }
      });
      // A page being closed cancels an in-flight fetch; sendBeacon survives it. This is exactly the
      // moment we most want the data — a user giving up on a slow screen and closing the app.
      if (beacon) {
        try { if (navigator.sendBeacon && navigator.sendBeacon(CONFIG.GAS_URL, new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
      }
      sending = true;
      try {
        fetch(CONFIG.GAS_URL, { method: 'POST', body: body, keepalive: true })
          .catch(() => {}).then(() => { sending = false; });
      } catch (e) { sending = false; }
    }

    function push(row) {
      if (off || CONFIG.MODE !== 'gas') return;
      if (total >= SESSION_CAP) return;
      total++;
      try {
        row.s = String(window.__atomScreen || '').slice(0, 30);
        buf.push(row);
        if (buf.length >= BUF_MAX) flush(false);
        else if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS);
      } catch (e) {}
    }

    // t = 'api' | 'nav' | 'boot' | 'err'
    const api = (action, ms, ok, code, batch) => push({ t: 'api', a: String(action || '').slice(0, 40), ms: Math.round(ms), ok: ok ? 1 : 0, c: String(code || '').slice(0, 30), b: batch || 1 });
    const mark = (type, name, ms) => push({ t: String(type).slice(0, 8), a: String(name || '').slice(0, 40), ms: Math.round(ms), ok: 1, c: '', b: 1 });
    const err = (kind, message) => push({ t: 'err', a: String(kind || 'js').slice(0, 40), ms: 0, ok: 0, c: String(message || '').replace(/\s+/g, ' ').slice(0, MSG_MAX), b: 1 });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });
      window.addEventListener('pagehide', () => flush(true));
      // The errors the user reports as "it broke on my phone" mostly arrive here and are never seen
      // by anyone, because nobody has a console open on a parent's phone.
      window.addEventListener('error', e => {
        try { err('onerror', (e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0)); } catch (x) {}
      });
      window.addEventListener('unhandledrejection', e => {
        try { const r = e.reason; err('unhandled', (r && (r.code ? r.code + ' ' : '') + (r.message || r)) || 'rejection'); } catch (x) {}
      });
      // navigation timing: how long the shell itself took, once, per session
      window.addEventListener('load', () => setTimeout(() => {
        try {
          const n = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]);
          if (n) { mark('boot', 'domReady', n.domContentLoadedEventEnd); mark('boot', 'loaded', n.loadEventEnd || n.duration); }
          const p = performance.getEntriesByType && performance.getEntriesByType('paint');
          if (p) p.forEach(x => { if (x.name === 'first-contentful-paint') mark('boot', 'fcp', x.startTime); });
        } catch (e) {}
      }, 0));
    }
    const hit = () => { if (!off && CONFIG.MODE === 'gas') { hits++; if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS); } };
    const miss = () => { if (!off && CONFIG.MODE === 'gas') misses++; };
    return { api: api, mark: mark, err: err, hit: hit, miss: miss, flush: flush, off: () => off };
  })();
  // app.js reports screen render time and the version string through these
  window.__atomPerfMark = (type, name, ms) => { try { PERF.mark(type, name, ms); } catch (e) {} };
  window.__atomPerfErr = (kind, msg) => { try { PERF.err(kind, msg); } catch (e) {} };

  // ---- client read cache: persistent (localStorage) + stale-while-revalidate ----
  // Perceived zero-lag: a read paints instantly from the last-known value stored on the
  // device, then refreshes in the background and re-renders only if the data changed.
  /* ---- how long an answer stays good for -------------------------------------------------------
   *
   * Every read used to be treated as if it went stale after 30 seconds, and a heartbeat re-fetched
   * EVERY cached entry every minute whether or not its answer could possibly have changed. Measured
   * over one day: 17,308 calls across 244 sessions — 71 per session — of which ~2,500 were asking
   * again for things that change once a term (getPlans ×329, classList ×594, payrollConfig ×230) or
   * once a day (schoolDay ×608, announcements ×344).
   *
   * That is not just wasted traffic. Apps Script runs ONE execution at a time per user, so those
   * calls queue behind each other, and the queue is what everything else then waits in — which is
   * why every single action measured the same 6–8 seconds regardless of how little work it did.
   *
   * So an answer now keeps for as long as it is actually good for. Three tiers, and the DEFAULT is
   * still the cautious one: anything not named here behaves exactly as before.
   *
   * Two things make the long tiers safe:
   *   · every WRITE still clears the whole cache (rcClear) — so the person who changed something
   *     never sees their own stale copy, whatever tier it is in;
   *   · an entry cached on a different DAY is never served (rcFresh below), so nothing dated can
   *     survive midnight in an app left open overnight.
   * Money and roll data deliberately sit in the short tier: another device changing a price or a
   * child's class must reach this one in minutes, not hours.
   */
  const RC_TTL = 30000;            // default — live data (check-ins, journals, notifications)
  const TTL_SLOW = 10 * 60000;     // changes now and then, and matters when it does
  const TTL_STATIC = 4 * 3600000;  // structural: changes when someone reorganises the school
  const TTL_BY_ACTION = {
    // structural — a term or a year between changes
    classList: TTL_STATIC, dspmCriteria: TTL_STATIC, staffGroups: TTL_STATIC, permissions: TTL_STATIC,
    holidays: TTL_STATIC, bigCleaningDays: TTL_STATIC, vaccineSchedule: TTL_STATIC, payrollConfig: TTL_STATIC,
    departments: TTL_STATIC, dspmItems: TTL_STATIC, qrCodes: TTL_STATIC,
    // once a day, or when an admin posts something — minutes of lag is not noticeable, hours is
    schoolDay: TTL_SLOW, announcements: TTL_SLOW, listStaff: TTL_SLOW, staffSelf: TTL_SLOW,
    students: TTL_SLOW, parentChildren: TTL_SLOW, getPlans: TTL_SLOW, foodMenu: TTL_SLOW,
    // a handful of picture URLs, read by every parent on every journal and changed only when the
    // kitchen uploads one — the screen that uploads clears its own copy, so nobody waits for this
    foodPhotos: TTL_STATIC,
    insuranceStatus: TTL_SLOW, prepayTiers: TTL_SLOW, leaveQuota: TTL_SLOW
  };
  const ttlOf = a => TTL_BY_ACTION[a] || RC_TTL;
  window.__atomTtlOf = ttlOf;      // the speed report reads this to explain what it is seeing
  const CACHE_NS = 'atom_rc_v1_';  // bump to invalidate persisted cache across incompatible deploys
  const MAX_PERSIST = 120000;      // skip persisting entries larger than ~120KB (keeps localStorage healthy)
  const _rc = new Map();
  // hydrate from localStorage so a cold app start (reopen) is already warm
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
    if (k && k.indexOf(CACHE_NS) === 0) { try { _rc.set(k.slice(CACHE_NS.length), JSON.parse(localStorage.getItem(k))); } catch (x) {} } } } catch (e) {}
  function rcPrune() { try { const es = [..._rc.entries()].sort((a, b) => a[1].t - b[1].t); const n = Math.ceil(es.length / 2);
    for (let i = 0; i < n; i++) localStorage.removeItem(CACHE_NS + es[i][0]); } catch (e) {} }
  // the LOCAL calendar day an entry was cached on. Not a duration: "today's attendance" and "is the
  // school open today" are answers about a DATE, and an app left open overnight (a phone on a
  // bedside table) would otherwise serve yesterday's answer all morning under the long tiers.
  const rcDay = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function rcSet(ck, data) { const e = { t: Date.now(), d: rcDay(), data: data }; _rc.set(ck, e);
    try { const s = JSON.stringify(e); if (s.length <= MAX_PERSIST) localStorage.setItem(CACHE_NS + ck, s); }
    catch (x) { rcPrune(); try { localStorage.setItem(CACHE_NS + ck, JSON.stringify(e)); } catch (y) {} } }
  // an entry from another day is not stale — it is about a different day, and must not be shown at all
  const rcSameDay = e => !e || !e.d || e.d === rcDay();
  function rcClear() { _rc.clear();
    try { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(CACHE_NS) === 0) ks.push(k); } ks.forEach(k => localStorage.removeItem(k)); } catch (e) {} }
  window.__atomCacheClear = rcClear; // app.js clears on logout / user switch (don't leak data across LINE accounts)
  /* ---- what a WRITE actually invalidates ------------------------------------------------------
   *
   * Every write used to throw away the WHOLE cache, the four-hour tier included, and then refetch
   * the ten most recent keys. For a parent that is nothing — they write twice a day. For the ADMIN,
   * who saves constantly, it meant destroying their own cache over and over: measured 17–18 Aug,
   * one admin visit cost 482 requests against a teacher's 99 and a parent's 32, 16 admin sessions
   * made 47% of all traffic, the cache hit rate FELL from 75% to 67% after the tiers were added,
   * and payrollConfig — a four-hour entry — was still fetched 220 times at p50 13.8s.
   *
   * So: a read listed here has exactly one set of writes that can change it. Any other write leaves
   * it alone. Everything NOT listed is cleared exactly as before, which is what makes this safe —
   * forgetting to list something costs a refetch, never a stale screen. Showing a teacher yesterday's
   * roll would be far worse than any delay, and that trade is the whole design of this table.
   */
  const OWNED_BY = {
    // the shape of the school — changes when someone reorganises it, not when the day is worked
    // saveStaff is here because a teacher's Department decides which class they are shown against —
    // a staff edit CAN change what this returns, even though it is not obviously about a class
    classList:       /^(add|remove|rename)Class|^orgMove|^moveStudent|^(save|register)Student|^registerNew|^(add|remove|rename)Department|^decideClassChange|^saveStaff|^setStaffEnd/i,
    departments:     /^(add|remove|rename)Department|^decideClassChange/i,
    staffGroups:     /^saveStaffGroup|^setSchoolConfig|^saveStaff|^setStaffEnd/i,
    permissions:     /^saveStaff|^setPermission|^setSchoolConfig/i,
    dspmCriteria:    /^(save|delete)DspmCriteria|^seedDspm/i,
    dspmItems:       /^(save|delete)DspmCriteria|^seedDspm/i,
    vaccineSchedule: /^setSchoolConfig/i,
    // the calendar — only the two screens that edit it
    holidays:        /^(add|remove|edit)Holiday|^setSchoolConfig/i,
    bigCleaningDays: /^(add|remove)BigCleaning|^setSchoolConfig/i,
    schoolDay:       /^(add|remove|edit)Holiday|^(add|remove)BigCleaning|^setSchoolConfig/i,
    // money SETTINGS (not the money itself — bills and slips are live data and stay uncached-on-write)
    getPlans:        /^savePlans|^savePrepayTiers|^setSchoolConfig/i,
    prepayTiers:     /^savePrepayTiers|^savePlans|^setSchoolConfig/i,
    payrollConfig:   /^setPayrollConfig|^computePayroll|^saveStaff|^setSchoolConfig|^recomputeContributions/i,
    leaveQuota:      /^setLeaveQuota|^submitLeave|^approveLeave|^confirmLeave|^cancelLeave|^editLeave|^setSchoolConfig/i,
    qrCodes:         /^saveQRCodes|^setSchoolConfig/i,
    // the announcements board
    announcements:   /^(add|edit|delete)Announcement|^reindexAnnouncements/i,
    // who I am — only my own record changes it
    staffSelf:       /^saveStaff|^saveProfile|^setStaffEnd|^adminResetPassword|^changePassword|^setRequireCheckin/i,

    /* ---- THE LIVE READS -------------------------------------------------------------------------
     *
     * The ten busiest reads in the app were all missing from this table, so EVERY write threw all of
     * them away: a parent dropping their child off wiped that family's journal, their bill and their
     * leave history, none of which a check-in touches. On a morning of thirty check-ins the client
     * cache was being emptied thirty times, and the 2026-08-25 report's "cache=60%" is mostly that.
     *
     * These entries are safer to get wrong than the ones above, and it is worth being clear why:
     * everything here sits in the DEFAULT tier (RC_TTL, 30 seconds) with stale-while-revalidate. A
     * mistake costs at most half a minute of stale data that then corrects itself — not the four
     * hours a mistake in the static tier would cost. Each is written against the handler it names.
     */
    // reads M.studentCheckins (CHECKIN_STUDENT) for one child, and nothing else
    studentCheckinHistory: /^(parent|staffStudent)Checkin$|^editStudentAttendance/i,
    // reads M.studentLeaves (LEAVE_REQUEST_STD) for one child
    studentLeaves:   /^studentAbsence|^teacherStudentLeave|^(edit|delete)StudentLeaves?$/i,
    // both read M.journals (DAILY_JOURNAL). An injury shared into the journal is a different
    // collection behind a different action (journalInjuries), so it does not belong here.
    getJournal:      /^(submit|unlock)Journal/i,
    journalStatus:   /^(submit|unlock)Journal/i,
    /* my own clock for today. Wider than it looks: besides my punches it depends on the day's HOURS
     * (holidays, meeting days, my group's shift, my start date) and on whether I hold an OT วันหยุด
     * — see myAttendanceToday → staffHoursOn_ + holidayOTStaffInfo_. All of them are named. */
    myAttendanceToday: /^staffCheck(in|out)$|^confirmTimeRequest|^adminAdd(Holiday)?OT|^adminEditOT|^adminDeleteOT|^(add|remove|edit)Holiday|^(add|remove)BigCleaning|^setSchoolConfig|^saveStaff|^saveStaffGroup|^setStaffEnd/i,
    /* what the family owes. Every money write, AND parentCheckin — collecting a child late RAISES an
     * OT charge (otUpsertForPickup_), so a pick-up really can change this number. That one is easy
     * to miss and is the reason this whole table is written next to its handlers. */
    parentDue:       /^(upload|confirm|reject|delete)Slip|^pay(Combined|CombinedCash|Charge|Prepay|OT)$|^prepay$|^cancelPrepay|^recordCashPayment|^notifyCash|^issueBill|^deleteBill|^(add|remove)StudentCharge|^admin(Update|Cancel|Restore)OT|^parentCheckin$|^editStudentAttendance/i
  };
  /* The other half of the safety property, and the one that is easy to get wrong: the table above
   * says which writes DO change a read — so an unknown write, one nobody has thought about yet,
   * would slip through every one of those tests and keep the long tier. The next feature to touch
   * the payroll config would then show a stale figure for four hours.
   *
   * So a write must be named HERE as well: one we have actually reasoned about. Anything else — a
   * new action, a renamed one, a typo — clears everything, exactly as before. Adding a write to
   * this list is a deliberate act; forgetting to costs a refetch and nothing else. */
  const SCOPED_WRITES = new RegExp('^(' + [
    // attendance and the daily record — the things a teacher does all morning
    'staffCheckin', 'staffCheckout', 'parentCheckin', 'staffStudentCheckin', 'studentAbsence',
    'submitJournal', 'unlockJournal', 'submitAssessment', 'commentAssessment', 'updateGrowth',
    'submitInjury', 'editInjury', 'approveInjury', 'unlockInjury', 'deleteInjury',
    // OT, leave and time — what the admin and the head teacher spend the day approving
    'adminAddOT', 'adminAddHolidayOT', 'adminEditOT', 'adminDeleteOT', 'approveOT', 'confirmOT', 'payOT',
    'adminUpdateOT', 'adminCancelOT', 'adminRestoreOT',
    'submitLeave', 'approveLeave', 'confirmLeave', 'cancelLeave', 'editLeave', 'teacherStudentLeave',
    'editStudentLeave', 'deleteStudentLeave', 'deleteStudentLeaves', 'setLeaveQuota',
    'submitTimeRequest', 'approveTimeRequest', 'confirmTimeRequest',
    // money — bills and slips are live data; only the SETTINGS are cached long
    'uploadSlip', 'payCombined', 'payCombinedCash', 'payCharge', 'payPrepay', 'prepay', 'cancelPrepay',
    'confirmSlip', 'rejectSlip', 'deleteSlip', 'recordCashPayment', 'notifyCash', 'issueBillsFor',
    // a bill or an extra charge, one child at a time — and a corrected pick-up time, which can raise
    // or remove a late-pickup OT (otReconcile_) and is therefore a MONEY write as well as a time one
    'issueBill', 'deleteBill', 'addStudentCharge', 'removeStudentCharge', 'editStudentAttendance',
    'notifyBills', 'markSalaryPaid', 'computePayroll', 'setPayrollConfig', 'recomputeContributions',
    // the settings screens themselves — each owns something in the table above
    'addHoliday', 'removeHoliday', 'editHoliday', 'addBigCleaning', 'removeBigCleaning', 'setSchoolConfig',
    'savePlans', 'savePrepayTiers', 'saveQRCodes', 'saveDspmCriteria', 'deleteDspmCriteria',
    'addAnnouncement', 'editAnnouncement', 'deleteAnnouncement', 'reindexAnnouncements',
    'addDepartment', 'removeDepartment', 'renameDepartment', 'decideClassChange', 'submitClassChange',
    'orgMoveTeacher', 'orgMoveStudent', 'moveStudent', 'saveStaff', 'setStaffEnd', 'setRequireCheckin',
    'saveStudent', 'registerStudent', 'registerNew', 'saveStaffGroup', 'setPermission', 'seedDspm',
    'saveProfile', 'adminResetPassword', 'changePassword',
    'markInboxRead', 'markNotifsRead'
  ].join('|') + ')$', 'i');
  const rcOwner = ck => OWNED_BY[ck.slice(0, ck.indexOf('|'))];
  /** Clear everything this write could have touched; keep only what it provably could not. */
  function rcClearFor(action) {
    const keep = [];
    // a write nobody has reasoned about is treated as if it could have changed anything
    if (SCOPED_WRITES.test(String(action || ''))) {
      _rc.forEach((e, ck) => { const own = rcOwner(ck); if (own && !own.test(action)) keep.push([ck, e]); });
    }
    rcClear();
    keep.forEach(([ck, e]) => { _rc.set(ck, e);
      try { const s = JSON.stringify(e); if (s.length <= MAX_PERSIST) localStorage.setItem(CACHE_NS + ck, s); } catch (x) {} });
    return keep.length;
  }
  window.__atomClearFor = rcClearFor;   // the speed test drives this directly
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  /**
   * Reads that the verb list catches by accident — "payments", "prepayments", "paymentLog" and the
   * rest only LOOK like writes. Being treated as one cost them twice over: they were never cached,
   * AND each one wiped the entire cache, so simply opening the payment screen threw away everything
   * the app had and made the next several screens wait for the server again.
   *
   * Every name here was checked against its handler in engine.js and confirmed to touch nothing.
   * That matters beyond caching: a read may be safely re-sent when a reply is unreadable, so listing
   * a real write here could submit a payment twice. exportStudent looks like a read and is NOT here,
   * because it stamps Status='EXPORTED'.
   */
  const READ_ONLY = {
    absenceReport: 1, paymentLog: 1, paymentSlips: 1, payments: 1, payrollConfig: 1,
    payrollReminderDue: 1, prepayTiers: 1, prepayments: 1, staffCheckinLog: 1, studentCheckinHistory: 1,
    // starts with "prepay", so the verb test calls it a write. It only asks WHICH children have
    // already paid for a month (so the bill picker can grey them out) and touches nothing. Left
    // unlisted it would take the write lock, refuse an Observer, and — because ONE flagged call
    // refuses the whole batch — take the bill screen down with it.
    prepaidStudents: 1,
    // contains "Checkout", so the verb test calls it a write; it only reads (see Code.gs)
    staffMissingCheckout: 1
  };
  /**
   * The mirror: WRITES whose name does not start with a mutating verb. Missing them meant the cache
   * was NOT cleared afterwards — an admin who recorded a cash payment kept seeing the bill unpaid
   * until the cache expired — and, worse on the server, they ran without the write lock.
   * Each was confirmed against its handler (updateRow_ / appendObject_ / deleteRow).
   * Keep identical to WRITES_ACTIONS_ in src/Code.gs.
   */
  const WRITES = {
    recordCashPayment: 1, teacherStudentLeave: 1, unlockJournal: 1, unlockInjury: 1,
    // A parent correcting or withdrawing their own leave. Both start with "parent", so the anchored
    // verb test calls them reads — and a write the cache does not know about is a family deleting a
    // leave and going on being shown it.
    parentEditLeave: 1, parentCancelLeave: 1,
    adminResetPassword: 1, adminUpdateOT: 1, adminCancelOT: 1, adminRestoreOT: 1,
    adminAddOT: 1, adminAddHolidayOT: 1, adminEditOT: 1, adminDeleteOT: 1, decideClassChange: 1, reinstallTriggers: 1,
    commentAssessment: 1,  // writes a note onto an assessment row; "comment" is not a mutating verb
    // who is expected on a closed day — none of the three starts with a mutating verb
    holidayAttendSet: 1, holidayAttendAdd: 1, holidayAttendRemove: 1
  };
  const isMutating = a => !READ_ONLY[a] && !!(WRITES[a] || MUT.test(a) || /check(in|out)|absence|payOT$|^orgMove|^unlink|^claim|^recompute/i.test(a));
  // app.js asks the same question for the Observer role, so "does this write?" has ONE answer
  window.__atomIsMutating = isMutating;
  // Safe to send again if the reply was unreadable: reads, plus auth/ping. A write is never repeated
  // — a retried payment or check-in would be worse than the error. Used by postGas (declared above,
  // but only ever CALLED after this module has finished initialising).
  const RETRY_SAFE = a => a === 'auth' || a === 'ping' || (a !== 'batch' && !isMutating(a));
  /* Writes the SERVER refuses to do twice. A second staff punch is answered ALREADY_CHECKED_IN /
   * ALREADY_CHECKED_OUT — it cannot create a duplicate row — and since v245 the app reads that as
   * the success it is and shows the real time. So these are safe to send again when a request is
   * lost in transit, and only these: the safety comes from the server's own guard, not from hoping
   * the first attempt did nothing. Nothing to do with money is here, and nothing should be added
   * without a guard on the handler to point at. */
  /* The four after the punches are the SAME four the offline outbox has been replaying since v198
   * (QUEUEABLE in app.js), each checked in its GAS handler: staffStudentCheckin updates the existing
   * row for that (student, date, type); submitJournal writes by (student, date); studentAbsence
   * returns the existing leave on a duplicate; submitAssessment clears the previous result per item
   * first. Sending one again cannot create a second row.
   *
   * They are added here because a lost reply is a WEAKER demand than the outbox: the outbox replays
   * minutes or hours later, this retries within the same second. A teacher's daily report was lost
   * twice in one week (submitJournal, 2026-08-21) and she was told to type it again.
   *
   * Everything that CREATES a row — payments, slips, bills, growth records — is deliberately absent,
   * and nothing joins this list without a guard in its handler to point at. */
  const IDEMPOTENT_WRITE = /^(staffCheckin|staffCheckout|staffStudentCheckin|submitJournal|studentAbsence|submitAssessment)$/;
  /* "May this request be sent again?" — asked in THREE places (the connection never opened, the
   * reply was unreadable, the reply answered a different question) and, until now, written out
   * three times. Three copies of one rule is how a batch ends up retryable on one path and not on
   * another; it is the same mistake as "is the school open today", which cost two releases. */
  const canRepeat = body => {
    const a = body && body.action;
    const ok = x => RETRY_SAFE(x) || IDEMPOTENT_WRITE.test(String(x || ''));
    return a === 'batch'
      ? (((body.payload || {}).calls) || []).every(c => ok(c.action))
      : ok(a);
  };

  // gas mode: micro-batch all api() calls made in the same tick (e.g. a screen's Promise.all)
  // into ONE request -> one round-trip, and GAS hydrates the sheets once for the whole batch.
  let _q = [], _scheduled = false;
  function enqueueGas(action, payload) {
    return new Promise((res, rej) => { _q.push({ action, payload, res, rej }); if (!_scheduled) { _scheduled = true; Promise.resolve().then(flush); } });
  }
  // The server has told us the token is no good. Keeping it means every later call fails the same
  // way and the user is stuck on a screen that will not load — drop it so the next sign-in is clean.
  /**
   * The session expired mid-use — do not throw the user out for it.
   *
   * The token used to last exactly 12 hours from sign-in, whatever you were doing, so a teacher who
   * signed in at 07:00 was bounced to the login screen at 19:00. The server now renews a token that
   * is still in use (see renewSession_), which prevents almost all of these. For the rest — a token
   * that expired while the app was closed, or a secret that was rotated — the LINE session behind it
   * is usually still valid, so we can quietly sign in again and carry on.
   *
   * Retrying the failed call afterwards is safe even for a payment: NO_SESSION is returned by
   * dispatch_ BEFORE the handler runs, so the write it was refusing never happened.
   */
  let _reauthP = null;
  function reauth() {
    if (_reauthP) return _reauthP;                       // one attempt shared by every waiting call
    _reauthP = Promise.resolve()
      .then(() => (typeof window.__atomReauth === 'function' ? window.__atomReauth() : null))
      .then(ok => { _reauthP = null; return !!ok; })
      .catch(() => { _reauthP = null; return false; });
    return _reauthP;
  }
  const isDeadSession = e => !!(e && (e.code === 'NO_SESSION' || e.code === 'INVALID_TOKEN'));
  /* ---- measure what the user WAITED for, not what the clock did ---------------------------------
   *
   * A request that is in flight when the phone is locked, or the app is switched away from, does not
   * settle until the app comes back. The wall clock keeps running the whole time, so the row we
   * recorded said the call took as long as the user was away. That is how "leaves p50=5ms
   * p95=407.2s" got into the report: almost every open of that screen was instant, and one person
   * opened it and put their phone in their pocket for seven minutes.
   *
   * It is not a harmless outlier. p95 is exactly the number we use to decide what to fix, and a
   * report about to be used to judge whether Phase 1 worked must not be measuring pocket time. So
   * the clock only runs while the app is on screen; a call made entirely in the background (a
   * heartbeat is not — those are suppressed — but a save queued offline can be) records the real
   * work, not the wait for the user to come back.
   */
  let _hidTotal = 0, _hidAt = 0;
  try { if (typeof document !== 'undefined' && document.hidden) _hidAt = Date.now(); } catch (e) {}
  const hidNow = () => _hidTotal + (_hidAt ? Date.now() - _hidAt : 0);
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (!_hidAt) _hidAt = Date.now(); }
      else if (_hidAt) { _hidTotal += Date.now() - _hidAt; _hidAt = 0; }
    });
  } catch (e) {}
  // start a stopwatch that only advances while the app is visible
  function awakeTimer() { const t0 = Date.now(), h0 = hidNow();
    return () => Math.max(0, (Date.now() - t0) - (hidNow() - h0)); }
  window.__atomAwakeTimer = awakeTimer;   // app.js times a screen with the same clock

  const dropDeadSession = e => { if (isDeadSession(e)) window.__atomClearSession(); };
  function flush() {
    const q = _q; _q = []; _scheduled = false;
    // Phase 0: time every round trip. t0 is taken here, so what we measure is exactly what the
    // user waits for — queueing, network, GAS hydration and the handler, all of it.
    const took = awakeTimer();   // counts only the time the app was actually on screen
    if (q.length === 1) { // single call → no batch wrapper
      postGas({ action: q[0].action, payload: q[0].payload })
        .then(j => { if (!j.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } PERF.api(q[0].action, took(), 1, '', 1); q[0].res(j.data); })
        .catch(e => { PERF.api(q[0].action, took(), 0, (e && e.code) || 'ERR', 1); dropDeadSession(e); q[0].rej(e); });
      return;
    }
    postGas({ action: 'batch', payload: { calls: q.map(c => ({ action: c.action, payload: c.payload })) } })
      .then(j => {
        if (!j.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
        // Results are matched to calls BY POSITION. If the reply is not the array we expect, calling
        // .forEach on it threw "data.forEach is not a function" and took the whole screen down with a
        // message nobody can act on. Send each call again on its own instead — one extra round trip,
        // but the screen loads and any genuine per-call error is reported properly.
        // Results are matched to calls BY POSITION, so a reply with the wrong NUMBER of entries is
        // just as dangerous as one that is not an array: every call after the gap would be handed
        // another action's data, which is exactly what "x.map is not a function" looks like. Short
        // of that, the tail of the batch would hang forever on a screen stuck at "กำลังโหลด…".
        if (Array.isArray(j.data) && j.data.length !== q.length) {
          PERF.err('batchLength', 'got ' + j.data.length + ' for ' + q.length +
            ' [' + q.map(c => c.action).slice(0, 6).join(' ') + ']');
          q.forEach(c => {
            const t1 = awakeTimer();
            postGas({ action: c.action, payload: c.payload })
              .then(r => { if (!r.ok) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } PERF.api(c.action, t1(), 1, 'RESENT', 1); c.res(r.data); })
              .catch(e => { PERF.api(c.action, t1(), 0, (e && e.code) || 'ERR', 1); dropDeadSession(e); c.rej(e); });
          });
          return;
        }
        if (!Array.isArray(j.data)) {
          try { console.error('batch reply was not an array', j); } catch (x) {}
          // This is the v186 incident. It is rare and we could not reproduce it — so record every
          // occurrence with its shape, which is what finally identifies the trigger.
          // The first version of this recorded the OUTER keys, which are always "ok,data" and told us
          // nothing. What identifies the trigger is the INNER shape and which calls were in the batch.
          PERF.err('batchShape', 'data=' + (j.data === null ? 'null' : typeof j.data) +
            (j.data && typeof j.data === 'object' ? ' inner=' + Object.keys(j.data).slice(0, 6).join(',') : '') +
            ' n=' + q.length + ' [' + q.map(c => c.action).slice(0, 6).join(' ') + ']');
          q.forEach(c => {
            const t1 = awakeTimer();
            postGas({ action: c.action, payload: c.payload })
              .then(r => { if (!r.ok) { const e = new Error(r.error.message); e.code = r.error.code; throw e; } PERF.api(c.action, t1(), 1, 'RESENT', 1); c.res(r.data); })
              .catch(e => { PERF.api(c.action, t1(), 0, (e && e.code) || 'ERR', 1); dropDeadSession(e); c.rej(e); });
          });
          return;
        }
        const ms = took(), n = q.length;
        j.data.forEach((r, i) => { if (r && r.ok) { PERF.api(q[i].action, ms, 1, '', n); q[i].res(r.data); } else { const e = new Error(r && r.error ? r.error.message : 'batch error'); e.code = r && r.error ? r.error.code : 'INTERNAL'; PERF.api(q[i].action, ms, 0, e.code, n); dropDeadSession(e); q[i].rej(e); } });
      })
      .catch(e => { const ms = took(), n = q.length; dropDeadSession(e); q.forEach(c => { PERF.api(c.action, ms, 0, (e && e.code) || 'ERR', n); c.rej(e); }); });
  }

  /* ---- response-shape guard ------------------------------------------------------------------
   * A reply that arrives as an object where the screen expects a list crashes it with
   * "x.map is not a function" — around a dozen people hit exactly that on the home screen last
   * week, and saw a message about JavaScript instead of their child's information.
   *
   * The cause is still unproven, so this does not assume one. It REMEMBERS the shape each action
   * returned last time and, when a reply disagrees, simply ASKS AGAIN. If the second reply is the
   * expected list the damage happened in transit and has now been repaired without anyone noticing;
   * if it disagrees the same way twice the action genuinely changed shape, which is accepted and
   * remembered. Either way the real shape is recorded, so the next speed report can identify the
   * trigger that months of guessing could not.
   *
   * It can only ever cost one extra round trip, and only for an action that has already been seen
   * returning something else — so it cannot break a screen that works today.
   */
  const _shape = new Map();
  const shapeOf = d => Array.isArray(d) ? 'list' : (d && typeof d === 'object' ? 'object' : 'value');
  const shapeNote = d => shapeOf(d) === 'object' ? ' keys=' + Object.keys(d || {}).slice(0, 6).join(',') : (d === null ? ' (null)' : '');
  function guarded(action, payload) {
    // An expired session is recoverable: sign in again behind the scenes and repeat the call. Safe
    // for a write too — NO_SESSION is refused before the handler runs, so nothing was written.
    /* An expired session is recoverable: sign in again behind the scenes and repeat the call. Safe
     * for a write too — NO_SESSION is refused before the handler runs, so nothing was written.
     *
     * It already worked. What did NOT work was SAYING so: the first attempt was recorded as a
     * failure and the recovery was invisible, so a day's log showed "NO_SESSION ×10" across seven
     * actions — all of them one morning's silent re-login that no teacher ever saw — and we spent
     * time hunting a problem that had already fixed itself. A recovered failure is now marked as
     * such, so the report can tell "broke and healed" from "broke". */
    const send = () => enqueueGas(action, payload).catch(e => {
      if (!isDeadSession(e) || action === 'auth') throw e;
      return reauth().then(ok => {
        if (!ok) throw e;
        return enqueueGas(action, payload).then(d => { PERF.mark('healed', action, 0); return d; });
      });
    });
    return send().then(d => {
      const got = shapeOf(d), prev = _shape.get(action);
      /* null is NOT a shape — it is "nothing yet", and it is a normal answer.
       *
       * getJournal returns null until the teacher writes the entry and an object afterwards; the
       * same is true of getPayslip since v215. Treating null as a shape made every one of those a
       * "shape changed" alarm: 237 of the 240 rows in the 2026-08-11 report, from 34 people, none
       * of them a fault — and they buried the ones that were. So a null neither reports nor
       * overwrites what this action is known to return.
       *
       * The ONE exception is a reply that was a LIST and came back null: that is the reply a screen
       * .maps over, and it is exactly the crash this guard exists to catch. It falls through.
       */
      if (d === null && prev !== 'list') return d;
      if (prev === undefined) { _shape.set(action, got); return d; }
      if (prev === got) return d;
      PERF.err('shapeChanged', action + ' was ' + prev + ' now ' + got + shapeNote(d));
      // Only a reply that LOST its list shape can crash a screen; anything else is just recorded.
      if (prev !== 'list') { _shape.set(action, got); return d; }
      // NEVER re-send a write. The reply is only being re-asked for because it looked wrong, and a
      // repeated payment or check-in is far worse than a screen that fails honestly. Same rule as
      // postGas's RETRY_SAFE, for the same reason.
      if (isMutating(action)) { _shape.set(action, got); return d; }
      return enqueueGas(action, payload).then(d2 => {
        if (shapeOf(d2) === 'list') { PERF.err('shapeRepaired', action + ' — second reply was the expected list'); return d2; }
        _shape.set(action, shapeOf(d2)); return d2;      // twice in a row: it really did change
      });
    });
  }

  // stale-while-revalidate: refetch a cached read in the background; re-render only if it changed.
  const _inflight = new Set(); let _renderT = null;
  function scheduleRender() { clearTimeout(_renderT); _renderT = setTimeout(() => { try { if (window.__atomRevalidate) window.__atomRevalidate(); } catch (e) {} }, 150); }
  function revalidate(ck) {
    if (_inflight.has(ck)) return; _inflight.add(ck);
    const i = ck.indexOf('|'); const action = ck.slice(0, i); let payload = {};
    try { payload = JSON.parse(ck.slice(i + 1) || '{}'); } catch (e) {}
    guarded(action, payload).then(d => { const prev = _rc.get(ck); rcSet(ck, d);
      if (!prev || JSON.stringify(prev.data) !== JSON.stringify(d)) scheduleRender(); })
      .catch(() => {}).then(() => _inflight.delete(ck));
  }
  /* The heartbeat used to refresh EVERY cached entry, every minute, forever — including the class
   * list, the price list and the payroll config, none of which change while someone watches a screen.
   * An app left open all morning therefore made 15–25 requests a minute, and since Apps Script runs
   * one execution at a time per user, everything else queued behind them.
   *
   * Two limits now, and both have to be passed:
   *   IN USE   — the key was read by a screen in the last few minutes. Cached answers for screens
   *              nobody is looking at are left alone; they refresh the moment that screen is opened.
   *   DUE      — the answer is older than what that action is actually good for (ttlOf).
   * `_touched` is bounded by the number of distinct reads the app makes, and pruned with the cache. */
  const _touched = new Map();
  const ACTIVE_WINDOW = 5 * 60000;
  function revalidateDue(now) {
    now = now || Date.now();
    _rc.forEach((e, ck) => {
      const used = _touched.get(ck) || 0;
      if (now - used > ACTIVE_WINDOW) return;                       // no screen is showing this
      if (!rcSameDay(e)) { revalidate(ck); return; }                // yesterday's answer — always refresh
      if (now - e.t < ttlOf(ck.slice(0, ck.indexOf('|')))) return;  // still good
      revalidate(ck);
    });
  }
  /* A screen that sits untouched — a teacher watching the drop-off list — reads its data once and
   * would age out of the window while they are still looking straight at it. Any real interaction
   * says "I am still here": the keys that screen most recently read are marked in use again. It is
   * capped at the working set of one screen, so this cannot drift back into refreshing everything. */
  const ACTIVE_SET = 12;
  function bumpActive() {
    const now = Date.now();
    [..._touched.entries()].sort((a, b) => b[1] - a[1]).slice(0, ACTIVE_SET)
      .forEach(([ck]) => _touched.set(ck, now));
  }
  // coming back to the app is the one moment a person EXPECTS a refresh — but still only of what
  // they are looking at, and still only if it is due
  function revalidateAll() { bumpActive(); revalidateDue(); }

  /* ---- re-warm after a write --------------------------------------------------------------
   * A write has to throw the cache away — showing a check-in that has just been undone would be
   * far worse than any delay. But the cache does not have to STAY empty, and until now it did: in
   * a nursery morning a teacher writes constantly, so every screen afterwards went back to waiting
   * on a server that takes seconds to answer.
   *
   * So the entries the user was actually using are fetched again, in ONE batched request, while
   * they are still looking at the result of their write. It is capped, debounced so a burst of
   * check-ins costs one refill rather than ten, and it deliberately does NOT offer the "new data"
   * bar — nothing on screen has changed under the user, the cache is simply full again.
   */
  const REWARM_MAX = 10, REWARM_WAIT = 1200;
  let _rewarmT = null, _rewarmKeys = [];
  const rcRecentKeys = () => [..._rc.entries()].sort((a, b) => b[1].t - a[1].t).map(e => e[0]);
  function rewarmLater(keys) {
    _rewarmKeys = [...new Set(_rewarmKeys.concat(keys))];
    clearTimeout(_rewarmT);
    _rewarmT = setTimeout(() => {
      const ks = _rewarmKeys.slice(0, REWARM_MAX); _rewarmKeys = [];
      ks.forEach(ck => {
        if (_rc.has(ck) || _inflight.has(ck)) return;         // already back, or on its way
        _inflight.add(ck);
        const i = ck.indexOf('|'); let payload = {};
        try { payload = JSON.parse(ck.slice(i + 1) || '{}'); } catch (e) {}
        guarded(ck.slice(0, i), payload).then(d => rcSet(ck, d)).catch(() => {}).then(() => _inflight.delete(ck));
      });
    }, REWARM_WAIT);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && CONFIG.MODE === 'gas') revalidateAll(); });
    // a tap or a keystroke says the person is still on this screen — it does NOT fetch anything by
    // itself, it only keeps that screen's data inside the refresh window
    ['pointerdown', 'keydown'].forEach(ev => { try { document.addEventListener(ev, bumpActive, { passive: true }); } catch (e) {} });
    // the heartbeat now costs nothing on a quiet screen: it refreshes only what is BOTH in use and
    // past what that action is good for (revalidateDue), instead of every cached key every minute
    setInterval(() => { if (!document.hidden && CONFIG.MODE === 'gas') revalidateDue(); }, 60000);
  }

  window.api = function (action, payload, opts) {
    payload = payload || {};
    if (CONFIG.MODE === 'gas') {
      if (action === 'auth') {                                                          // capture the session token; never cache auth
        return enqueueGas(action, payload).then(d => { if (d && d.token) { _session = d.token; try { localStorage.setItem('atom_session_token', d.token); } catch (e) {} } return d; });
      }
      // write → throw away what it could have changed, then quietly fill it again so the next
      // screen is instant instead of waiting on the server all over again
      if (isMutating(action)) { const was = rcRecentKeys(); rcClearFor(action); return guarded(action, payload).then(d => { rewarmLater(was); return d; }); }
      const ck = action + '|' + JSON.stringify(payload);
      // opts.fresh: never serve a possibly-stale cached value — always fetch (still populates the cache).
      // Used for time-sensitive reads like the announcement popup, where a stale empty must not suppress it.
      if (opts && opts.fresh) return guarded(action, payload).then(d => { rcSet(ck, d); return d; });
      const hit = _rc.get(ck);
      _touched.set(ck, Date.now());   // this key is in USE — the heartbeat only refreshes these
      if (hit && rcSameDay(hit)) {                                                      // local-first: paint instantly
        PERF.hit();
        if (Date.now() - hit.t >= ttlOf(action)) revalidate(ck);                        // stale → refresh in background
        return Promise.resolve(hit.data);
      }
      PERF.miss();
      return guarded(action, payload).then(d => { rcSet(ck, d); return d; });          // first time → must fetch
    }
    return mockHandlers().then(H => new Promise((res, rej) => setTimeout(() => {
      try { const h = H[action]; if (!h) { const e = new Error('ไม่รู้จัก action: ' + action); e.code = 'UNKNOWN_ACTION'; throw e; } res(h(payload)); }
      catch (e) { rej(e); }
    }, 110)));
  };
})();
