/* api.js — single API gateway (browser). Business logic lives in engine.js (shared with GAS via src/Engine.gs).
 * MODE='mock' = run the engine in-browser on window.MOCK. MODE='gas' = POST {action,payload} to the GAS Web App,
 * which runs the SAME engine on data hydrated from Google Sheets (see src/GasEngine.gs).
 * Keep MODE='mock' until the GAS engine is deployed; GAS_URL is kept ready for the switch.
 */
window.CONFIG = { MODE: 'gas', GAS_URL: 'https://script.google.com/macros/s/AKfycbxWUgs0oPyEN52F1qCGETDDbOVGeIBKe18u8_vDYz5bjKrHuS7V541oaeWqWPBsx-7d/exec' };

(function () {
  const M = window.MOCK;
  // seed: per-student Drive folder for the demo students (new students get one at registration)
  M.students.forEach(s => { if (!s.DriveFolderUrl) s.DriveFolderUrl = 'drive://' + (M.config.StudentFolderRoot || 'AtomNursery_Students') + '/' + String(s.NameTH || s.StudentID).trim().replace(/\s+/g, '_'); });

  // build the shared engine over the mock data; GROWTH_STD comes from growth_standard.js
  const E = window.createAtomAPI(M, window.GROWTH_STD);
  const H = E.H;
  window.AGEMONTHS = E.ageMonths;

  const postGas = body => fetch(CONFIG.GAS_URL, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());

  // gas mode: micro-batch all api() calls made in the same tick (e.g. a screen's Promise.all)
  // into ONE request -> one round-trip, and GAS hydrates the sheets once for the whole batch.
  let _q = [], _scheduled = false;
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

  window.api = function (action, payload) {
    payload = payload || {};
    if (CONFIG.MODE === 'gas') {
      return new Promise((res, rej) => {
        _q.push({ action, payload, res, rej });
        if (!_scheduled) { _scheduled = true; Promise.resolve().then(flush); }
      });
    }
    return new Promise((res, rej) => setTimeout(() => {
      try { const h = H[action]; if (!h) { const e = new Error('ไม่รู้จัก action: ' + action); e.code = 'UNKNOWN_ACTION'; throw e; } res(h(payload)); }
      catch (e) { rej(e); }
    }, 110));
  };
})();
