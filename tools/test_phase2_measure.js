/**
 * tools/test_phase2_measure.js — Phase 2: the report has to be TRUE before it can be acted on.
 *   node tools/test_phase2_measure.js
 *
 * Two things in the Phase 1 report could not be believed, and we are about to use the next one to
 * decide whether Phase 1 worked.
 *
 *   "leaves x17 p50=5ms p95=407.2s"
 *      Almost every open of that screen was instant. One was 407 seconds — because a request in
 *      flight when a phone is locked does not settle until the app comes back, and the wall clock
 *      kept running in the user's pocket. p95 is exactly the number we rank work by, so pocket time
 *      was setting our priorities. The clock now stops while the app is off screen.
 *
 *   "Desktop x8247 p50=10.7s | Android x5677 p50=5.8s"
 *      Read as "desktops are slow". They are not: the desktop is the office ADMIN, whose screens ask
 *      for far more than a parent's. The role is on every row already (verified server-side, never
 *      self-reported) and is now summarised — together with CALLS PER SESSION, which is the number
 *      that actually explains a queue, and the one Phase 1 set out to move from 71.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const api = R('webapp/api.js'), app = R('webapp/app.js'), perf = R('src/Perf.gs');

// ---- the real api.js, with a clock and a visibility flag we control -----------------------------
function boot() {
  const sent = [], listeners = {}, store = {}, timers = [], logged = [];
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  let now = Date.UTC(2026, 7, 16, 9, 0, 0);
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(now); else super(...a); }
    static now() { return now; }
  }
  let hold = null;                                  // a reply we can keep pending on purpose
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, Promise, JSON, Math, Date: FakeDate, Object, Array, String, Number, isFinite,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, hidden: false, currentScript: null }
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = ctx.document.addEventListener;
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'perfLog') { logged.push(body.payload); return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true,"data":{}}') }); }
    sent.push(body);
    const reply = () => ({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, data: { a: body.action } })) });
    if (hold) return new Promise(res => { hold.push(() => res(reply())); });
    return Promise.resolve(reply());
  };
  vm.createContext(ctx);
  vm.runInContext(api, ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  const settle = () => new Promise(r => setTimeout(r, 30));
  return {
    ctx, sent, logged, settle,
    advance: ms => { now += ms; },
    holdReplies: () => { hold = []; },
    releaseReplies: async () => { const h = hold || []; hold = null; h.forEach(f => f()); await settle(); },
    hide: async () => { ctx.document.hidden = true; (listeners.visibilitychange || []).forEach(f => f()); await settle(); },
    show: async () => { ctx.document.hidden = false; (listeners.visibilitychange || []).forEach(f => f()); await settle(); },
    // rows are buffered for 25 seconds; the app sends them early when it goes to the background,
    // which is the hook the test uses to read them without waiting
    flushRows: async function () {
      ctx.document.hidden = true; (listeners.visibilitychange || []).forEach(f => f()); await settle();
      ctx.document.hidden = false; (listeners.visibilitychange || []).forEach(f => f()); await settle();
      return logged.reduce((a, p) => a.concat((p.rows || []).map(r => ({ t: r.t, a: r.a, ms: r.ms }))), []);
    }
  };
}

(async () => {

console.log('\n1) the clock stops while the app is off screen');
{
  const t = boot();
  ok_('there is one stopwatch, and it knows about visibility', /function awakeTimer\(\)/.test(api) && /window\.__atomAwakeTimer = awakeTimer;/.test(api));
  ok_('the API round trip uses it', /const took = awakeTimer\(\);/.test(api));
  ok_('...and so does every resend', !/PERF\.api\(c\.action, Date\.now\(\) - t1/.test(api) && /PERF\.api\(c\.action, t1\(\)/.test(api));
  ok_('the screen timer uses the same clock', /window\.__atomAwakeTimer\?window\.__atomAwakeTimer\(\)/.test(app) && /__atomPerfMark\('nav',screen,_took\(\)\)/.test(app));
  ok_('...and app.js still works if api.js has not defined it yet', /:\(t0=>\(\)=>Date\.now\(\)-t0\)\(Date\.now\(\)\)/.test(app));
}
{
  // THE REPORTED CASE: open a screen, pocket the phone for seven minutes, come back
  const t = boot();
  t.holdReplies();
  const p = t.ctx.api('allLeaves', {});
  await t.settle();
  await t.hide();
  t.advance(7 * 60000);          // in a pocket
  await t.show();
  t.advance(900);                // the reply actually arrives now
  await t.releaseReplies();
  await p;
  const row = (await t.flushRows()).find(r => r.a === 'allLeaves');
  ok_('the call was recorded at all', !!row);
  ok_('...as under two seconds of waiting, not seven minutes (' + (row && row.ms) + 'ms)', row && row.ms < 2000);
}
{
  // and a call made entirely while the app is on screen is measured exactly as before
  const t = boot();
  t.holdReplies();
  const p = t.ctx.api('dashboard', {});
  await t.settle();
  t.advance(4000);
  await t.releaseReplies();
  await p;
  const row = (await t.flushRows()).find(r => r.a === 'dashboard');
  ok_('a genuinely slow call is still reported as slow (' + (row && row.ms) + 'ms)', row && row.ms >= 4000);
}
{
  const t = boot();
  await t.hide();
  t.advance(5 * 60000);
  await t.show();
  t.holdReplies();
  const p = t.ctx.api('dashboard', {});
  await t.settle();
  t.advance(3000);
  await t.releaseReplies();
  await p;
  const row = (await t.flushRows()).find(r => r.a === 'dashboard');
  ok_('time spent hidden BEFORE the call does not leak into it (' + (row && row.ms) + 'ms)', row && row.ms >= 3000 && row.ms < 4000);
}

console.log('\n2) the report says which ROLE, not just which device');
{
  ok_('the role on each row is read', /var sid = String\(r\[1\]\), role = String\(r\[2\] \|\| ''\)/.test(perf));
  ok_('...and totalled', /roles\[role\] = roles\[role\] \|\| \{ role: role, n: 0, fail: 0, ms: \[\], sids: \{\} \}/.test(perf));
  ok_('each role reports how many calls one visit costs', /perSession: ns \? Math\.round\(t\.n \/ ns\) : 0/.test(perf));
  ok_('...and the whole window does too — the 71 Phase 1 set out to move', /perSession: Object\.keys\(sids\)\.length \? Math\.round\(total \/ Object\.keys\(sids\)\.length\) : 0/.test(perf));
  ok_('it is returned to the client', /byDev: byDev, byNet: byNet, byRole: byRole/.test(perf));
  ok_('the screen shows it', /d\.byRole\|\|\[\]/.test(app) && /calls\/session':'ครั้ง\/เซสชัน/.test(app));
  ok_('...and says what the number means, so it is not read as trivia', /Apps Script รันทีละคำสั่งต่อผู้ใช้หนึ่งคน/.test(app));
  ok_('the device list now warns against reading it as hardware', /ตัวเครื่องไม่ได้บอกความเร็ว/.test(app));
  // the copied text is what gets sent on — it must carry the new numbers too
  ok_('the copied report carries calls-per-session', /perSession='\+\(d\.perSession!=null\?d\.perSession:'\?'\)/.test(app));
  ok_('...and the role breakdown', /L\.push\('ROLES: '\+d\.byRole\.map/.test(app));
}
{
  // the aggregation itself, run over rows shaped exactly like the sheet's
  const H = require(path.join(__dirname, 'gas_test_harness.js'));
  const { run } = H(['Config', 'Db', 'Perf']);
  const res = JSON.parse(run(function () {
    var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
    PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
    main.insertSheet('SCHOOL_CONFIG').appendRow(['Key', 'Value']);
    var sh = main.insertSheet('PERF_LOG');
    sh.appendRow(PERF_HEADERS);
    var d = new Date(); var ts = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
    // one admin session: 20 heavy calls · two parent sessions: 3 calls each
    for (var i = 0; i < 20; i++) sh.appendRow([ts, 'A1', 'admin', 'api', 'financeSummary', 9000, 1, '', 1, 'finance', 'Desktop', '4g', 0, 'v1']);
    for (var j = 0; j < 3; j++) sh.appendRow([ts, 'P1', 'parent', 'api', 'parentChildren', 3000, 1, '', 1, 'home', 'iOS', '4g', 0, 'v1']);
    for (var k = 0; k < 3; k++) sh.appendRow([ts, 'P2', 'parent', 'api', 'parentChildren', 3000, 1, '', 1, 'home', 'Android', '4g', 0, 'v1']);
    return JSON.stringify(handlePerfSummary({ days: 7 }));
  }));
  const byRole = {}; (res.byRole || []).forEach(r => { byRole[r.role] = r; });
  eq('one admin visit cost twenty calls', (byRole.admin || {}).perSession, 20);
  eq('...a parent visit cost three', (byRole.parent || {}).perSession, 3);
  eq('the admin is the slow one — and it is the SCREENS, not the desktop', (byRole.admin || {}).p50, 9000);
  eq('...the parent on a phone is fast', (byRole.parent || {}).p50, 3000);
  eq('sessions are counted per role', [(byRole.admin || {}).sessions, (byRole.parent || {}).sessions], [1, 2]);
  eq('and the window average is reported', res.perSession, 9);
  // nothing that already worked may have moved
  eq('the totals are unchanged', [res.calls, res.sessions], [26, 3]);
  ok_('the device breakdown still works', (res.byDev || []).length === 3);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
