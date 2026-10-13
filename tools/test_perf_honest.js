/**
 * tools/test_perf_honest.js — the report must not multiply an incident, and must not time a clamp.
 *   node tools/test_perf_honest.js
 *
 * Two defects found in the 07–13/10 report. Neither is a bug in the app; both are the report
 * describing what happened as something else, which is worse — the report is what decides what gets
 * worked on next.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * §1  THE SLOW LIST WAS ONE PHONE'S BAD MINUTE
 *
 *     2026-10-08 19:49:15  3600.0s  myClassCover @home · Teacher · Android · FAILED TIMEOUT
 *     … ×10, same second, same teacher, same device, every one at 3600.0s
 *
 *     3600.0s is PERF_MS_CEILING_, the clamp inside perfNum_ — and the client aborts at 90s, so no
 *     call we issue can honestly measure an hour. Those ten rows took ten of the fifteen slots in
 *     the list whose entire job is to show the worst REAL moments of the week.
 *
 *     This exact distortion was found and fixed once before, for OFFLINE, and the note left behind
 *     said TIMEOUT was deliberately kept because it is "our own 90-second cap — a wait a person
 *     really sat through". True of a 90s TIMEOUT; not true of a clamped one. The rule belongs on
 *     the VALUE, not on the code, and that is what this guards.
 *
 * §2  ONE FAILED SCREEN WAS COUNTED AS TEN FAILURES
 *
 *     FAILING listed ten routes with near-identical tallies — OFFLINEx24,16,16,15,15,15,14,14,15,14
 *     — because the home screen sends ten actions in ONE request and api.js writes one row per
 *     action. Ten broken routes is what it looked like; about twenty bad moments on one screen is
 *     what it was. The screen budget already divides by the batch size for exactly this reason; the
 *     failure count did not.
 *
 * §3  and the budget correction for dspm, which is a tabbed screen: one round trip per class the
 *     admin opens is the screen working, not a regression.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const perfGs = R('src/Perf.gs'), app = R('webapp/app.js');

function report(build) {
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Perf']);
  return JSON.parse(run(new Function('return (' + (function (mk) {
    _configCache = null; setupAll(); _configCache = null;
    var rows = mk();
    handlePerfLog({ rows: rows, __sess: { role: 'Teacher' } });
    return JSON.stringify(handlePerfSummary({ days: 7 }));
  }).toString() + ')(' + build.toString() + ')')));
}

// ============================================================================
console.log('\n1) 🔴 ค่าที่ตันเพดาน ไม่ใช่เวลา');
{
  const d = report(function () {
    var rows = [];
    /* THE REAL EVENT, reproduced: one home batch of ten, every row clamped at the ceiling. */
    for (var i = 0; i < 10; i++) rows.push({ t: 'api', a: 'home' + i, ms: 3600000, ok: 0, c: 'TIMEOUT', b: 10, s: 'home' });
    /* ...and the moments it was crowding out: genuinely slow, genuinely measured, 25–40s. */
    rows.push({ t: 'api', a: 'realSlow', ms: 40000, ok: 0, c: 'TIMEOUT', b: 1, s: 'home' });
    rows.push({ t: 'api', a: 'realSlow2', ms: 25000, ok: 1, c: '', b: 1, s: 'class' });
    // a fast, healthy call so p50 has something honest to land on
    for (var j = 0; j < 20; j++) rows.push({ t: 'api', a: 'quick', ms: 2000, ok: 1, c: '', b: 1, s: 'home' });
    return rows;
  });
  const slowActions = (d.slowMoments || []).map(x => x.action);
  ok_('🔴 ไม่มีแถวที่ตันเพดานอยู่ในรายการช้าสุดเลย', !slowActions.some(a => /^home\d/.test(a)));
  ok_('...และของที่ช้าจริงได้ขึ้นแทน', slowActions.indexOf('realSlow') >= 0 && slowActions.indexOf('realSlow2') >= 0);
  eq('นับไว้ต่างหาก และบอกจำนวน', d.ceilinged, 10);
  eq('...พร้อมบอกว่าเพดานคือเท่าไหร่', d.ceilingMs, 3600000);
  /* p50 is the number the school is told the app "feels like". With the clamp counted it was being
   * dragged toward an hour by rows that measured nothing. */
  ok_('🔴 p50 ไม่ถูกลากขึ้นโดยค่าเพดาน', d.p50 <= 3000);
  ok_('...และ p95 ก็ไม่ถูกลาก', d.p95 <= 40000);
  /* STILL A FAILURE. It is not a measurement of how long anything took; it very much IS a screen
   * that did not load, and quietly dropping it would be the opposite error. */
  ok_('🔴 ยังนับเป็น fail อยู่ (ไม่ได้ซุกไว้ใต้พรม)', d.failRate > 0);
  const homeAct = (d.slowest || []).concat(d.failing || []).filter(x => /^home\d/.test(x.action));
  ok_('...และยังปรากฏในรายการที่ล้มเหลว', homeAct.length > 0);
}

// ============================================================================
console.log('\n2) 🔴 หน้าจอล้ม 1 ครั้ง ไม่ใช่ความล้มเหลว 10 ครั้ง');
{
  const d = report(function () {
    var rows = [];
    // two home screens that failed: 2 requests, 20 action rows
    for (var k = 0; k < 2; k++)
      for (var i = 0; i < 10; i++) rows.push({ t: 'api', a: 'h' + i, ms: 9000, ok: 0, c: 'OFFLINE', b: 10, s: 'home' });
    // eight requests that worked, one action each
    for (var j = 0; j < 8; j++) rows.push({ t: 'api', a: 'ok' + j, ms: 1000, ok: 1, c: '', b: 1, s: 'home' });
    return rows;
  });
  eq('คำขอทั้งหมด (ฝั่ง action)', d.calls, 28);
  eq('ความล้มเหลวฝั่ง action = 20 → 71.4%', d.failRate, 71.4);
  /* THE SAME EVENTS, COUNTED AS THINGS A PERSON SAW. Ten requests, two of which failed. The first
   * figure sizes the retry load; this one sizes the complaint, and only this one is what happened
   * to anybody. Printing only the first made every incident look ten times its size. */
  eq('🔴 round trip ทั้งหมด = 10', d.trips, 10);
  eq('🔴 ...ที่ล้มจริง = 2', d.tripsFailed, 2);
  eq('🔴 ...คิดเป็น 20% ไม่ใช่ 71.4%', d.tripFailRate, 20);
  ok_('และรายงานที่คัดลอกไปพิมพ์ทั้งสองฝั่ง', /REQUESTS \(= /.test(app) && /d\.tripFailRate/.test(app));
  ok_('...และพิมพ์จำนวนแถวที่ตันเพดานด้วย', /d\.ceilinged/.test(app));
}

// ============================================================================
console.log('\n3) 📐 งบคำขอของหน้า DSPM');
{
  const d = report(function () {
    var rows = [{ t: 'nav', a: 'dspm', ms: 100, ok: 1, c: '', b: 1, s: 'dspm' }];
    // the real shape: one load (2 actions, 1 trip) + classAssessment for the first class…
    rows.push({ t: 'api', a: 'listStudents', ms: 900, ok: 1, c: '', b: 2, s: 'dspm' });
    rows.push({ t: 'api', a: 'listDepartments', ms: 900, ok: 1, c: '', b: 2, s: 'dspm' });
    // …then one per class tab the admin taps. The school has five departments.
    for (var i = 0; i < 5; i++) rows.push({ t: 'api', a: 'classAssessment', ms: 800, ok: 1, c: '', b: 1, s: 'dspm' });
    // …and a glance at one child
    rows.push({ t: 'api', a: 'studentAllBands', ms: 700, ok: 1, c: '', b: 2, s: 'dspm' });
    rows.push({ t: 'api', a: 'growthHistory', ms: 700, ok: 1, c: '', b: 2, s: 'dspm' });
    return rows;
  });
  const sc = (d.slowScreens || []).find(x => x.screen === 'dspm');
  ok_('หน้า dspm ถูกรายงาน', !!sc);
  eq('อ่านครบทุกชั้น + ดูเด็ก 1 คน = 7 คำขอ', sc.perVisit, 7);
  /* The taps are seconds or minutes apart, so no tick contains two of them and there is nothing to
   * batch. Flagging that as a regression trains the school to ignore the flag. */
  eq('🔴 ...และไม่ถูกตีว่าเกินงบ', sc.over, false);
  eq('งบคือ 8', sc.budget, 8);
  ok_('เหตุผลเขียนไว้ในโค้ด ไม่ใช่แค่ตัวเลข', /tabbed|TAPPING A TAB/.test(perfGs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
