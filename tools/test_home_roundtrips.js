/**
 * tools/test_home_roundtrips.js — the teacher's home screen in one round trip, not four.
 *   node tools/test_home_roundtrips.js
 *
 * p50 is 8.1s against an Apps Script floor of ~3s PER REQUEST, so the only lever left is how many
 * requests a screen makes. api.js already micro-batches every api() call made in the same tick —
 * but Teacher.home then fetched three more sections one after another:
 *     const tca = await api('teacherClassAttendance', …);   // request 2
 *     const ml  = await api('myLeaves', …);                 // request 3
 *     const ot  = await api('myOT', …);                     // request 4
 * …and three more again for a leader. Four to seven requests, ~3s each: that is "home p95 17.6s".
 *
 * Nothing below them depended on them, so they now START with the first batch and are awaited where
 * they are rendered. This test proves the mechanism against the REAL api.js over a stub network,
 * then checks the screen actually uses it.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js');

/* the real api.js, a browser we control, and a network that counts REQUESTS (not calls) */
function boot() {
  const store = {}, requests = [];
  const mkStore = () => ({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite,
    Blob: function (a, b) { this.parts = a; this.type = b && b.type; },
    localStorage: mkStore(), sessionStorage: mkStore(),
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', connection: { effectiveType: '4g' }, sendBeacon: null, maxTouchPoints: 5 },
    performance: { getEntriesByType: () => [] },
    document: { addEventListener: () => {}, hidden: false, currentScript: null },
    __req: requests
  };
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false }); ctx.addEventListener = () => {};
  ctx.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    if (body.action !== 'perfLog') requests.push(body);          // telemetry rides its own request
    const answer = a => (a === 'classList' ? { class: {}, students: [] } : []);
    const data = body.action === 'batch'
      ? (body.payload.calls || []).map(c => ({ ok: true, data: answer(c.action) }))
      : answer(body.action);
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, data: data, a: body.action })) });
  };
  vm.createContext(ctx);
  vm.runInContext(R('webapp/api.js'), ctx);
  ctx.CONFIG.MODE = 'gas'; ctx.CONFIG.GAS_URL = 'https://example.test/exec';
  return ctx;
}
// how many HTTP requests did that cost, and how many calls did each carry?
const shape = c => c.__req.map(b => (b.action === 'batch' ? (b.payload.calls || []).length : 1));

const FIRST = ['myAttendanceToday', 'recentAttendance', 'classList', 'leaveQuota', 'staffSelf', 'journalStatus'];
const TAIL  = ['teacherClassAttendance', 'myLeaves', 'myOT'];
const LEADER = ['teamPendingLeaves', 'teamPendingOT', 'myClassChanges'];
const fresh = { fresh: true };   // every section is live data; the cache is not what is being measured

(async () => {
  console.log('\n1) the old shape: fetch, then fetch again, then again');
  {
    const c = boot();
    await Promise.all(FIRST.map(a => c.api(a, {}, fresh)));
    for (const a of TAIL) await c.api(a, {}, fresh);            // exactly what the code used to do
    eq('four requests for one screen', shape(c), [6, 1, 1, 1]);
  }

  console.log('\n2) the new shape: everything that can travel together, does');
  {
    const c = boot();
    const tail = TAIL.map(a => c.api(a, {}, fresh));            // started FIRST, awaited later
    await Promise.all(FIRST.map(a => c.api(a, {}, fresh)));
    await Promise.all(tail);
    eq('ONE request carrying all nine calls', shape(c), [9]);
  }

  console.log('\n3) a leader: two requests, not seven');
  {
    const c = boot();
    const tail = TAIL.map(a => c.api(a, {}, fresh));
    await Promise.all(FIRST.map(a => c.api(a, {}, fresh)));
    await Promise.all(tail);
    // whether this person IS a leader is only known once staffSelf has answered, so these cannot
    // join the first batch — but they can share one request with each other
    await Promise.all(LEADER.map(a => c.api(a, {}, fresh)));
    eq('9 together, then 3 together', shape(c), [9, 3]);
  }

  console.log('\n4) one broken section must not blank the rest of the screen');
  {
    // this is what the sequential version really cost: the FIRST failure aborted everything after it,
    // including the growth reminder at the very end
    const c = boot();
    c.fetch = (url, init) => {
      const body = JSON.parse(init.body);
      if (body.action !== 'perfLog') c.__req.push(body);
      const calls = body.action === 'batch' ? (body.payload.calls || []) : [{ action: body.action }];
      const data = calls.map(x => x.action === 'teacherClassAttendance'
        ? { ok: false, error: { code: 'INTERNAL', message: 'boom' } }
        : { ok: true, data: [] });
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(
        body.action === 'batch' ? { ok: true, data: data, a: 'batch' } : { ok: false, error: data[0].error || {}, a: body.action })) });
    };
    const got = [];
    const p1 = c.api('teacherClassAttendance', {}, fresh).catch(() => null).then(d => got.push(['tca', d]));
    const p2 = c.api('myLeaves', {}, fresh).catch(() => []).then(d => got.push(['ml', d]));
    const p3 = c.api('myOT', {}, fresh).catch(() => []).then(d => got.push(['ot', d]));
    await Promise.all([p1, p2, p3]);
    eq('the broken one falls back', (got.find(g => g[0] === 'tca') || [])[1], null);
    eq('and the other two still arrive', got.filter(g => g[0] !== 'tca').length, 2);
  }

  console.log('\n5) the screen is written that way');
  {
    const home = app.slice(app.indexOf('SCREENS.Teacher.home = async () => {'), app.indexOf('window.T_growthReminder ='));
    // v232: myLeaves/myOT/recentAttendance left with the lists they fed (📅 ตาราง and 💵 การเงิน)
    // v243: leaveQuota left the batch with the remaining-days grid it fed
    ok_('the remaining section starts before the first await', /const p_tca = api\('teacherClassAttendance'[\s\S]{0,2200}const \[att,cl,me0raw,jstat,al\] = await Promise\.all\(/.test(home));
    /* v282, and the point of this whole section: three MORE calls moved up here. They were fired
     * after the screen was drawn — each in its own tick, so each its own round trip, each ~5s
     * queued in front of something the user was waiting for. holidayAttendList alone was 513 calls
     * in four days, on a school where the answer is "nothing, it is a Tuesday" almost every time. */
    ['p_holNext', 'p_holDay', 'p_missOut'].forEach(v =>
      ok_(v + ' is started in the same tick, not after the render',
        new RegExp('const ' + v + '\\s*=\\s*api\\(').test(home) && new RegExp('\\b' + v + '\\.then\\(').test(home)));
    ok_('...and none of them is still fired on its own after the batch',
      !/\n\s*api\('holidayAttendList',\{\}\)\.then\(/.test(home)
      && !/\n\s*api\('myHolidayOTNext'[^\n]*\)\.then\(/.test(home)
      && !/\n\s*api\('staffMissingCheckout'[^\n]*\)\.then\(/.test(home));
    ok_('...and are only AWAITED at render time', /const tca=await p_tca; setHTML\('#tcatt'/.test(home));
    ok_('no sequential fetch is left', !/const (tca|ml|myot)=await api\(/.test(home));
    ok_('each carries its own fallback', (home.match(/\.catch\(\(\)=>(\[\]|null)\)/g) || []).length >= 6);
    // v236: the card is also handed today's schoolDay, so a holiday says so instead of listing the
    // whole class as absent — but a failed fetch must still render empty rather than throw
    ok_('a null attendance section renders empty instead of throwing', /tca\?tcaHtml\(tca,day0\):''/.test(home));
    // four of them since v224 — the injury queue joined the leave/OT/class-change ones
    // five since v231 — the time-correction queue joined leave/OT/class-change/injury
    ok_('the leader sections share one round trip', /await Promise\.all\(\[p_tp,p_to,p_cc,p_ti,p_tt\]\)/.test(home));
    ok_('and the growth reminder is no longer behind a fetch that can fail', home.indexOf('T_growthReminder();') > home.indexOf('setHTML(\'#myccr\''));
  }

  console.log('\n6) the batching this leans on is still there');
  {
    const api = R('webapp/api.js');
    ok_('calls made in one tick are queued', /_q\.push\(\{ action, payload, res, rej \}\)/.test(api));
    ok_('...and flushed once, as a microtask', /Promise\.resolve\(\)\.then\(flush\)/.test(api));
    // a cached read must NOT be sent again just because it was started early
    const c = boot();
    await c.api('myOT', {}, fresh);
    const before = c.__req.length;
    await c.api('myOT', {});
    eq('a cached read costs no request at all', c.__req.length - before, 0);
  }

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
