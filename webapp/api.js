/* api.js — single API gateway (browser). Business logic lives in engine.js (shared with GAS via src/Engine.gs).
 * MODE='mock' = run the engine in-browser on window.MOCK. MODE='gas' = POST {action,payload} to the GAS Web App,
 * which runs the SAME engine on data hydrated from Google Sheets (see src/GasEngine.gs).
 * Keep MODE='mock' until the GAS engine is deployed; GAS_URL is kept ready for the switch.
 */
window.CONFIG = { MODE: 'mock', GAS_URL: 'https://script.google.com/macros/s/AKfycbxWUgs0oPyEN52F1qCGETDDbOVGeIBKe18u8_vDYz5bjKrHuS7V541oaeWqWPBsx-7d/exec' };

(function () {
  const M = window.MOCK;
  // seed: per-student Drive folder for the demo students (new students get one at registration)
  M.students.forEach(s => { if (!s.DriveFolderUrl) s.DriveFolderUrl = 'drive://' + (M.config.StudentFolderRoot || 'AtomNursery_Students') + '/' + String(s.NameTH || s.StudentID).trim().replace(/\s+/g, '_'); });

  // build the shared engine over the mock data; GROWTH_STD comes from growth_standard.js
  const E = window.createAtomAPI(M, window.GROWTH_STD);
  const H = E.H;
  window.AGEMONTHS = E.ageMonths;

  window.api = function (action, payload) {
    payload = payload || {};
    if (CONFIG.MODE === 'gas') {
      return fetch(CONFIG.GAS_URL, { method: 'POST', body: JSON.stringify({ action, payload }) })
        .then(r => r.json())
        .then(j => { if (!j.ok) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j.data; });
    }
    return new Promise((res, rej) => setTimeout(() => {
      try { const h = H[action]; if (!h) { const e = new Error('ไม่รู้จัก action: ' + action); e.code = 'UNKNOWN_ACTION'; throw e; } res(h(payload)); }
      catch (e) { rej(e); }
    }, 110));
  };
})();
