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
  // seed: per-student Drive folder for the demo students (new students get one at registration)
  M.students.forEach(s => { if (!s.DriveFolderUrl) s.DriveFolderUrl = 'drive://' + (M.config.StudentFolderRoot || 'AtomNursery_Students') + '/' + String(s.NameTH || s.StudentID).trim().replace(/\s+/g, '_'); });

  // build the shared engine over the mock data; GROWTH_STD comes from growth_standard.js
  const E = window.createAtomAPI(M, window.GROWTH_STD);
  const H = E.H;
  window.AGEMONTHS = E.ageMonths;

  // HMAC session token from auth — sent with every request so the server can verify the caller
  // and authorize by their real identity (enforced server-side once RequireSessionToken='true').
  let _session = null; try { _session = localStorage.getItem('atom_session_token') || null; } catch (e) {}
  window.__atomClearSession = () => { _session = null; try { localStorage.removeItem('atom_session_token'); } catch (e) {} };
  const postGas = body => fetch(CONFIG.GAS_URL, { method: 'POST', body: JSON.stringify(Object.assign({ token: _session }, body)) }).then(r => r.json());

  // ---- client read cache: persistent (localStorage) + stale-while-revalidate ----
  // Perceived zero-lag: a read paints instantly from the last-known value stored on the
  // device, then refreshes in the background and re-renders only if the data changed.
  const RC_TTL = 30000;            // younger than this → serve cache without hitting the network
  const CACHE_NS = 'atom_rc_v1_';  // bump to invalidate persisted cache across incompatible deploys
  const MAX_PERSIST = 120000;      // skip persisting entries larger than ~120KB (keeps localStorage healthy)
  const _rc = new Map();
  // hydrate from localStorage so a cold app start (reopen) is already warm
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
    if (k && k.indexOf(CACHE_NS) === 0) { try { _rc.set(k.slice(CACHE_NS.length), JSON.parse(localStorage.getItem(k))); } catch (x) {} } } } catch (e) {}
  function rcPrune() { try { const es = [..._rc.entries()].sort((a, b) => a[1].t - b[1].t); const n = Math.ceil(es.length / 2);
    for (let i = 0; i < n; i++) localStorage.removeItem(CACHE_NS + es[i][0]); } catch (e) {} }
  function rcSet(ck, data) { const e = { t: Date.now(), data: data }; _rc.set(ck, e);
    try { const s = JSON.stringify(e); if (s.length <= MAX_PERSIST) localStorage.setItem(CACHE_NS + ck, s); }
    catch (x) { rcPrune(); try { localStorage.setItem(CACHE_NS + ck, JSON.stringify(e)); } catch (y) {} } }
  function rcClear() { _rc.clear();
    try { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(CACHE_NS) === 0) ks.push(k); } ks.forEach(k => localStorage.removeItem(k)); } catch (e) {} }
  window.__atomCacheClear = rcClear; // app.js clears on logout / user switch (don't leak data across LINE accounts)
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  const isMutating = a => MUT.test(a) || /check(in|out)|absence|payOT$|^orgMove|^unlink/i.test(a);

  // gas mode: micro-batch all api() calls made in the same tick (e.g. a screen's Promise.all)
  // into ONE request -> one round-trip, and GAS hydrates the sheets once for the whole batch.
  let _q = [], _scheduled = false;
  function enqueueGas(action, payload) {
    return new Promise((res, rej) => { _q.push({ action, payload, res, rej }); if (!_scheduled) { _scheduled = true; Promise.resolve().then(flush); } });
  }
  function flush() {
    const q = _q; _q = []; _scheduled = false;
    if (q.length === 1) { // single call → no batch wrapper
      postGas({ action: q[0].action, payload: q[0].payload })
        .then(j => { if (!j.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } q[0].res(j.data); })
        .catch(e => q[0].rej(e));
      return;
    }
    postGas({ action: 'batch', payload: { calls: q.map(c => ({ action: c.action, payload: c.payload })) } })
      .then(j => {
        if (!j.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
        j.data.forEach((r, i) => { if (r && r.ok) q[i].res(r.data); else { const e = new Error(r && r.error ? r.error.message : 'batch error'); e.code = r && r.error ? r.error.code : 'INTERNAL'; q[i].rej(e); } });
      })
      .catch(e => q.forEach(c => c.rej(e)));
  }

  // stale-while-revalidate: refetch a cached read in the background; re-render only if it changed.
  const _inflight = new Set(); let _renderT = null;
  function scheduleRender() { clearTimeout(_renderT); _renderT = setTimeout(() => { try { if (window.__atomRevalidate) window.__atomRevalidate(); } catch (e) {} }, 150); }
  function revalidate(ck) {
    if (_inflight.has(ck)) return; _inflight.add(ck);
    const i = ck.indexOf('|'); const action = ck.slice(0, i); let payload = {};
    try { payload = JSON.parse(ck.slice(i + 1) || '{}'); } catch (e) {}
    enqueueGas(action, payload).then(d => { const prev = _rc.get(ck); rcSet(ck, d);
      if (!prev || JSON.stringify(prev.data) !== JSON.stringify(d)) scheduleRender(); })
      .catch(() => {}).then(() => _inflight.delete(ck));
  }
  // refresh everything cached in one batched tick (used on app-focus + a light 60s heartbeat)
  function revalidateAll() { _rc.forEach((e, ck) => revalidate(ck)); }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && CONFIG.MODE === 'gas') revalidateAll(); });
    setInterval(() => { if (!document.hidden && CONFIG.MODE === 'gas') revalidateAll(); }, 60000); // “latest data every minute”
  }

  window.api = function (action, payload, opts) {
    payload = payload || {};
    if (CONFIG.MODE === 'gas') {
      if (action === 'auth') {                                                          // capture the session token; never cache auth
        return enqueueGas(action, payload).then(d => { if (d && d.token) { _session = d.token; try { localStorage.setItem('atom_session_token', d.token); } catch (e) {} } return d; });
      }
      if (isMutating(action)) { rcClear(); return enqueueGas(action, payload); }      // write → bust cache (memory + disk)
      const ck = action + '|' + JSON.stringify(payload);
      // opts.fresh: never serve a possibly-stale cached value — always fetch (still populates the cache).
      // Used for time-sensitive reads like the announcement popup, where a stale empty must not suppress it.
      if (opts && opts.fresh) return enqueueGas(action, payload).then(d => { rcSet(ck, d); return d; });
      const hit = _rc.get(ck);
      if (hit) {                                                                        // local-first: paint instantly
        if (Date.now() - hit.t >= RC_TTL) revalidate(ck);                               // stale → refresh in background
        return Promise.resolve(hit.data);
      }
      return enqueueGas(action, payload).then(d => { rcSet(ck, d); return d; });        // first time → must fetch
    }
    return new Promise((res, rej) => setTimeout(() => {
      try { const h = H[action]; if (!h) { const e = new Error('ไม่รู้จัก action: ' + action); e.code = 'UNKNOWN_ACTION'; throw e; } res(h(payload)); }
      catch (e) { rej(e); }
    }, 110));
  };
})();
