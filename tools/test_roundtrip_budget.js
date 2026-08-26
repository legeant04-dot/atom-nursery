/**
 * tools/test_roundtrip_budget.js — a spare call is not free, it is in front of something.
 *   node tools/test_roundtrip_budget.js
 *
 * FROM THE 2026-08-25 REPORT: p50 5.4s, p95 14.6s, 29 calls per session, and EVERY screen over its
 * calls/visit budget. Apps Script runs ONE execution at a time per user, so calls do not overlap —
 * they queue. The number of round trips a screen makes IS its latency.
 *
 * api.js already micro-batches everything issued in the SAME TICK into one request. So the thing
 * that decides the count is not how many api() calls a screen makes, it is WHEN it makes them: a
 * call started after an `await` is a new tick, and a new tick is another five-second wait.
 *
 * Three regressions this locks down, all of them mine:
 *
 *  · TEACHER HOME fired myHolidayOTNext, holidayAttendList and staffMissingCheckout AFTER the render,
 *    each in its own tick — three extra round trips added to the busiest screen in the app.
 *    holidayAttendList alone was 513 calls in four days, on a school where the answer is "nothing,
 *    it is a Tuesday" almost every time.
 *  · ADMIN HOME did the same with its holiday-OT card.
 *  · PARENT HOME asked for the first child's studentLeaves TWICE in one batch — the same handler
 *    over the same sheet, twice, on every load.
 *
 * And the bell: refreshBell() runs from setHeader(), which runs on EVERY screen render. 954 calls in
 * four days at ~5.2s each, to paint a number. A badge a minute stale is fine; a screen five seconds
 * slower is not.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), apijs = R('webapp/api.js');

const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));

console.log('\n1) the batching everything here depends on');
{
  ok_('calls made in one tick become one request', /Promise\.resolve\(\)\.then\(flush\)/.test(apijs));
  ok_('...and a lone call skips the wrapper', /if \(q\.length === 1\) \{ \/\/ single call → no batch wrapper/.test(apijs));
  ok_('the server hydrates the sheets once for the whole batch', /GAS hydrates the sheets once for the whole batch/.test(apijs));
}

console.log('\n2) teacher home: nothing is fired after the render');
{
  const home = between('SCREENS.Teacher.home = async () => {', 'window.T_growthReminder =');
  const firstAwait = home.indexOf('await Promise.all(');
  ok_('there IS a first await to measure against', firstAwait > 0);
  // every api( call outside a window.* handler must appear before that await
  const prelude = home.slice(0, firstAwait);
  ['schoolDay', 'teacherClassAttendance', 'myHolidayOTNext', 'holidayAttendList', 'staffMissingCheckout']
    .forEach(a => ok_(`${a} is started before the await`, prelude.indexOf(`api('${a}'`) >= 0));
  ok_('...and none of them is re-fired afterwards',
    !/\n\s{4}api\('(myHolidayOTNext|holidayAttendList|staffMissingCheckout)'/.test(home));
  /* The leader sections CANNOT join that batch — whether this person is a leader is only known once
   * staffSelf has answered — but they share one tick with each other, so they are one more trip and
   * not five. */
  ok_('the leader extras share a single tick with each other',
    /const p_tp=api\('teamPendingLeaves'[\s\S]{0,700}const p_tt=api\('teamPendingTimeRequests'/.test(home));
}

console.log('\n3) admin home: the holiday card rides along');
{
  const home = between('SCREENS.Admin.home = async () => {', 'window.A_annTab=');
  ok_('holidayAttendList is started before the await',
    home.indexOf("api('holidayAttendList'") < home.indexOf('await Promise.all('));
  ok_('...and rendered from the promise, not re-fetched', /p_holDay\.then\(h=>\{/.test(home));
}

console.log('\n4) parent home: nothing is asked for twice');
{
  const home = between('SCREENS.Parent.home = async () => {', 'function parentDueCard(due)');
  const batch = home.slice(home.indexOf('const _res = await Promise.all(['), home.indexOf(']);'));
  // the per-child tail covers kids[0], who IS k0 — the fixed copy was a duplicate handler run
  eq('studentLeaves appears once, in the per-child list', (batch.match(/api\('studentLeaves'/g) || []).length, 1);
  ok_('...and the first child is read out of that list', /const sl = slAll\[0\]\|\|\[\];/.test(home));
  const fixed = (batch.slice(0, batch.indexOf('...kids.map(')).match(/api\('/g) || []).length;
  eq('the fixed block is what FIXED says it is', fixed, 7);
  ok_('...and FIXED says so in one place', /const FIXED = 7;/.test(home));
  /* parentChildren is awaited ALONE before all of this, and has to be: the list of children decides
   * what the rest of the batch asks for. Two round trips is the floor for this screen, not a defect. */
  ok_('the one unavoidable extra trip is the child list, and it is first',
    home.indexOf("await api('parentChildren'") < home.indexOf('const _res = await Promise.all(['));
}

console.log('\n5) payroll: four sequential waits became one');
{
  /* THIS is where "payroll 62.5 calls/visit" came from. payrollConfig → staffMonthlyOT →
   * otCarryOver → getPayslip were awaited one after another, so every time the admin picked a staff
   * member or changed the month the screen sat through four separate ~5s waits. Running payroll for
   * ten people cost forty round trips. None of them depends on another — same (staffId, month),
   * different sheets. */
  const fn = between('window.A_payStaff = async ()=>{', 'window.A_payTypeToggle');
  ['payrollConfig', 'staffMonthlyOT', 'otCarryOver', 'getPayslip'].forEach(a =>
    ok_(`${a} is started before the first await`, fn.indexOf(`api('${a}'`) < fn.indexOf('await p_pc')));
  ok_('...and each is awaited from its promise, not re-fetched',
    /await p_pc;/.test(fn) && /await p_ot;/.test(fn) && /await p_cy;/.test(fn) && /await p_slip;/.test(fn));
  ok_('the month is read ONCE, so all four ask about the same one',
    /const mth=\$\('#pMonth'\)\.value;/.test(fn));
  /* The ORDER the fields are filled in still matters — a saved payslip overwrites the defaults, or
   * reopening a month would show a fresh form instead of what was actually paid. Fetching in
   * parallel must not become applying in parallel. */
  ok_('...but the saved slip is still applied last, over the defaults',
    fn.indexOf('await p_pc') < fn.indexOf('await p_slip'));
  ok_('a stale reply is still dropped when the admin has moved on', (fn.match(/if\(stale\(\)\)return;/g) || []).length >= 4);
}

console.log('\n6) 📅 ตาราง: one request, not two');
{
  const scr = between('SCREENS.Teacher.schedule = async () => {', 'let MY_DAYS=[]');
  ['myAttendanceMonth', 'myLeaves', 'myOT'].forEach(a =>
    ok_(`${a} is started before the schedule await`, scr.indexOf(`api('${a}'`) < scr.indexOf("const d=await api('schedule'")));
  ok_('...and the history reuses that in-flight fetch rather than making its own',
    /T_myHistory\(monthStr\(\), null, p_hist\)/.test(app) && /await \(pre \|\| api\('myAttendanceMonth'/.test(app));
  ok_('...while any OTHER period still asks when it is chosen', /window\.T_myHistory=async\(month, range, pre\)=>/.test(app));
  ok_('a fetch that failed does not render as an empty month', /if\(!r\) throw new Error\('no data'\);/.test(app));
}

console.log('\n7) the bell stops costing a round trip per navigation');
{
  ok_('the count is cached', /if\(!force && Date\.now\(\)-_bellAt < 60000\)/.test(app));
  ok_('...for a minute, which is fresh enough for a badge', /_bellAt < 60000/.test(app));
  ok_('marking read refreshes it immediately, because that is what changes it', /refreshBell\(true\)/.test(app));
  ok_('opening the tray reuses its own read rather than fetching the list twice',
    (app.match(/api\('notifications',notifParams\(\)\)/g) || []).length === 2 &&   // refreshBell + BELL, once each
    /const ns=await api\('notifications',notifParams\(\)\); window\._NOTIFS=ns;[\s\S]{0,320}bellBadge/.test(app));
  /* v285: the admin's "waiting for you" counts ride in the SAME TICK as the notifications call, so
   * the bell still costs ONE round trip — and refreshBell runs from setHeader() on every render, so
   * a second request here would have been ~5s in front of every screen an admin opens. */
  ok_('the pending counts share the notifications request rather than making their own',
    (app.match(/const p_ops = opsWanted_\(\) \? api\('opsPending'[\s\S]{0,120}const ns=await api\('notifications'/g) || []).length === 2);
  ok_('...and only for an admin, who is the only person they mean anything to',
    /const opsWanted_ = \(\) => !!\(USER && USER\.role==='Admin' && USER\.staffId\);/.test(app));
  ok_('...and a fresh sign-in does not inherit them either', /_bellAt=0; _bellN=0; _bellOps=null;/.test(app));
  ok_('a fresh sign-in does not inherit the last person’s count', /window\.__atomBellReset/.test(app));
  ok_('it is still called from the header, so the badge still appears', /if\(USER\) refreshBell\(\);/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
