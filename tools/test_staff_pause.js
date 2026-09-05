/**
 * tools/test_staff_pause.js — ลาชั่วคราว for a staff member.
 *   node tools/test_staff_pause.js
 *
 * Asked 2026-09-02: the arrangement a child already has, for staff — "ลาชั่วคราวเหมือนของนักเรียนโดย
 * ไม่นับเป็นขาด/ลา/มาสาย ใส่เหตุผล [ให้ Admin เขียนเอง] และช่องหมายเหตุ ... ไม่ต้องนำมาแสดงในข้อมูล
 * Check-in/out โรงเรียน ไม่เอาชื่ออยู่ในการจัดชั้นเรียน ... ในส่วนของเงินเดือน ให้ Admin กำหนดเองเช่น
 * ไม่จ่ายเงินเดือน/จ่ายครึ่งเดือน/กำหนดเอง".
 *
 * Two decisions worth stating, because both could have gone the other way:
 *
 * 1. NOT Status='PAUSED', the way the student version works. A child's Status is read by code that
 *    only ever asks "is this child attending". Status on a staff row is read by staffEnded_, by the
 *    login gate, by payroll and by half the reports, and INACTIVE there means "no longer employed".
 *    Somebody on maternity leave is still employed. So the fact lives in its own columns and nothing
 *    that already works has to learn a new status value.
 *
 * 2. An undecided salary rule pays in FULL. A blank PauseSalaryMode means the school has not said,
 *    and the safe reading of "has not said" is not zero — a wrong zero on a payslip is the kind of
 *    mistake that costs a school its staff.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), gasEngine = R('src/Engine.gs'),
      staffGs = R('src/Staff.gs'), payrollGs = R('src/Payroll.gs'), checkinGs = R('src/Checkin.gs'),
      parentGs = R('src/Parent.gs'), configGs = R('src/Config.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_(), stSh = sheet_(HR, 'STAFF');
  var today = gasToday_(), month = today.slice(0, 7);
  var shift = function (n) { var d = new Date(); d.setDate(d.getDate() + n); return dateStr_(d); };

  var add = function (id, nick, dept) {
    appendObject_(stSh, { StaffID: id, Name: 'คุณ' + nick, Nickname: nick, Role: 'Teacher',
      PositionLevel: 'Staff', Status: 'ACTIVE', Department: dept || 'Nursery 1', LineUID: 'U' + id,
      StartDate: '2025-01-01', RequireCheckin: true, BaseSalary: 15000 });
  };
  add('STF-ADM', 'แอดมิน'); updateRow_(stSh, findObject_(stSh, function (s) { return s.StaffID === 'STF-ADM'; })._row,
    { Role: 'Admin', PositionLevel: 'Admin', Department: '*' });
  add('STF-MOM', 'ก้อย');      // going on maternity leave
  add('STF-HERE', 'เอ');       // working normally — the control
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-HERE' });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-1', Name: 'ด.ญ. ทดสอบ', Nickname: 'ใบเตย',
    Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2025-05-01', Plan: 'FULL' });

  var o = {}, call = function (p) {
    try { return handleSetStaffPause(p); }
    catch (e) { return { err: (e && (e.apiCode || e.code)) || 'ERR', msg: e && e.message }; }
  };
  // ---- the input rules ----
  o.noReason = call({ staffId: 'STF-ADM', targetId: 'STF-MOM', from: today, reason: '' });
  o.noFrom   = call({ staffId: 'STF-ADM', targetId: 'STF-MOM', reason: 'ลาคลอด' });
  o.backwards = call({ staffId: 'STF-ADM', targetId: 'STF-MOM', from: shift(10), to: shift(2), reason: 'ลาคลอด' });
  o.customBlank = call({ staffId: 'STF-ADM', targetId: 'STF-MOM', from: today, reason: 'ลาคลอด', salaryMode: 'CUSTOM', salaryAmount: '' });
  o.badMode = call({ staffId: 'STF-ADM', targetId: 'STF-MOM', from: today, reason: 'ลาคลอด', salaryMode: 'MAYBE' });

  /* ---- the real thing: away since the FIRST of this month, back in 60 days, half salary ----
   * From the 1st, not from yesterday: with `yesterday` the month held one working day BEFORE the
   * leave began, so "not counted absent" read absent=1 on any day of the month except the 1st and
   * 2nd — a suite that passes today and fails tomorrow. The rule under test is about days INSIDE the
   * leave, so the fixture covers the whole month. */
  o.set = call({ staffId: 'STF-ADM', targetId: 'STF-MOM', from: month + '-01', to: shift(60),
                 reason: 'ลาคลอด', remark: 'ครบกำหนดคลอด 20/09', salaryMode: 'HALF' });
  var row = function (id) { var r = readObjects_(stSh).filter(function (x) { return x.StaffID === id; })[0] || {};
    return { status: String(r.Status || ''), from: String(r.PauseFrom || '').slice(0, 10),
             to: String(r.PauseTo || '').slice(0, 10), reason: String(r.PauseReason || ''),
             remark: String(r.PauseRemark || ''), mode: String(r.PauseSalaryMode || ''),
             base: Number(r.BaseSalary || 0) }; };
  o.stored = row('STF-MOM');

  // ---- what it changes ----
  o.board = engineDispatch_('dashboard', {}).staff.map(function (s) { return s.nick; }).sort();
  var ls = engineDispatch_('listStaff', {});
  o.listed = ls.filter(function (s) { return s.StaffID === 'STF-MOM'; })
    .map(function (s) { return { paused: s.paused, from: s.pauseFrom, reason: s.pauseReason, mode: s.pauseSalaryMode }; })[0];
  o.stillOnRoster = ls.filter(function (s) { return s.StaffID === 'STF-MOM'; }).length;

  var punch = function (id) {
    try { handleStaffCheckin({ staffId: id, lat: 13.792472, lng: 100.646389 }); return 'ok'; }
    catch (e) { return (e && (e.apiCode || e.code)) || String(e && e.message); }
  };
  o.punchPaused = punch('STF-MOM');
  o.punchNormal = punch('STF-HERE');

  // she is not a recipient of routine traffic either — she is not at the nursery
  o.onDutyPaused = staffOnDuty_(findObject_(stSh, function (s) { return s.StaffID === 'STF-MOM'; }));
  o.onDutyNormal = staffOnDuty_(findObject_(stSh, function (s) { return s.StaffID === 'STF-HERE'; }));

  // the month: not absent, not late, not on leave — and the days are not owed
  var mo = engineDispatch_('staffAttendanceMonth', { month: month, staffId: 'STF-ADM' });
  var mine = (mo.staff || mo || []).filter(function (s) { return s.staffId === 'STF-MOM'; })[0] || {};
  o.month = { absent: mine.absent, lateDays: mine.lateDays, leaveDays: mine.leaveDays,
              required: mine.myRequiredDays, schoolRequired: mine.requiredDays };
  o.pausedDayStatus = (mine.days || []).filter(function (d) { return d.date === today; })
    .map(function (d) { return d.status; })[0];

  // ---- salary ----
  var pay = function (id) { return computePayroll({ staffId: id, month: month, preview: true,
    socialSecurityDeduct: false, generatedBy: 'test' }); };
  o.payHalf = { base: pay('STF-MOM').BaseSalary, mode: pay('STF-MOM').PauseSalaryMode, reason: pay('STF-MOM').PauseReason };
  o.payNormal = pay('STF-HERE').BaseSalary;
  // ...and the stored salary is NOT touched: the payroll screen writes its base box back to STAFF
  o.baseAfterPay = row('STF-MOM').base;

  var mode = function (m, amt) {
    call({ staffId: 'STF-ADM', targetId: 'STF-MOM', from: month + '-01', to: shift(60), reason: 'ลาคลอด',
           salaryMode: m, salaryAmount: amt });
    return pay('STF-MOM').BaseSalary;
  };
  o.payNone = mode('NONE');
  o.payCustom = mode('CUSTOM', 6000);
  o.payUndecided = mode('');          // the school has not said → paid in full

  // a month the leave does not touch is untouched
  o.payOtherMonth = computePayroll({ staffId: 'STF-MOM', month: '2024-01', preview: true,
    socialSecurityDeduct: false, generatedBy: 'test' }).BaseSalary;

  // ---- and back again ----
  call({ staffId: 'STF-ADM', targetId: 'STF-MOM', paused: false });
  o.cleared = row('STF-MOM');
  o.boardAfter = engineDispatch_('dashboard', {}).staff.map(function (s) { return s.nick; }).sort();
  o.punchAfter = punch('STF-MOM');
  return JSON.stringify(o);
}));

console.log('\n1) WHAT THE ADMIN HAS TO PROVIDE');
{
  /* The reason is FREE TEXT and required — asked for that way ("ใส่เหตุผล [ให้ Admin เขียนเอง]").
   * A dropdown would force the real reason into the wrong box; requiring it stops a pause becoming
   * a mystery six months later when somebody asks why this person was not paid. */
  eq('a pause with no reason is refused', res.noReason.err, 'BAD_INPUT');
  eq('...and one with no start date', res.noFrom.err, 'BAD_INPUT');
  eq('...and a return date before the start', res.backwards.err, 'BAD_INPUT');
  /* CUSTOM with an empty box would pay zero and look deliberate. The whole point of CUSTOM is that
   * the admin typed a figure. */
  eq('"set the amount myself" with no amount is refused', res.customBlank.err, 'BAD_INPUT');
  eq('an unknown salary mode is refused rather than ignored', res.badMode.err, 'BAD_INPUT');
  eq('a complete one is accepted', [res.set.ok, res.set.salaryMode], [true, 'HALF']);
}

console.log('\n2) STILL EMPLOYED — the reason this is not Status');
{
  /* INACTIVE on a staff row means "no longer employed" and is read by staffEnded_, the login gate,
   * payroll and half the reports. Somebody on maternity leave is still employed. */
  eq('Status is untouched', res.stored.status, 'ACTIVE');
  eq('...and they are still on the admin roster', res.stillOnRoster, 1);
  eq('the leave is stored beside it, in full', [res.stored.from !== '', res.stored.reason, res.stored.remark, res.stored.mode],
    [true, 'ลาคลอด', 'ครบกำหนดคลอด 20/09', 'HALF']);
  eq('...and the roster says so', [res.listed.paused, res.listed.reason, res.listed.mode], [true, 'ลาคลอด', 'HALF']);
  ok_('the decision is written down where it was made', /NOT stored as Status like the student version/.test(engine));
  ok_('the columns are declared, or writeRows_ would drop them silently',
    /'PauseFrom', 'PauseTo', 'PauseReason', 'PauseRemark', 'PauseSalaryMode', 'PauseSalaryAmount'\]/.test(configGs));
}

console.log('\n3) NOT HERE — and not counted as anything');
{
  eq('off the daily staff summary', res.board, ['เอ']);
  eq('...and cannot clock in', res.punchPaused, 'STAFF_PAUSED');
  /* NOT `=== 'ok'`. Clocking in also goes through the school-calendar gate, so on a Saturday every
   * punch is refused SCHOOL_CLOSED and this line failed for a reason that has nothing to do with
   * temporary leave (it ran red on Sat 05/09/26 having passed all week). What is being tested is
   * that the PAUSE refusal is aimed at one person: everybody else is not stopped BY THE PAUSE. */
  eq('...while everybody else is not stopped by it', res.punchNormal === 'STAFF_PAUSED', false);
  eq('not notified about children arriving either', [res.onDutyPaused, res.onDutyNormal], [false, true]);
  /* THE POINT OF THE WHOLE FEATURE: "ไม่นับเป็นขาด/ลา/มาสาย". A day away on this arrangement is not
   * an absence, and it is not owed — so the month does not print a shortfall against them. */
  eq('the month counts no absence, no lateness and no leave', [res.month.absent, res.month.lateDays, res.month.leaveDays], [0, 0, 0]);
  eq('...and the days are not owed', res.month.required, 0);
  ok_('...even though the school still expects that many of everybody else', res.month.schoolRequired > 0);
  eq('the day itself says why', res.pausedDayStatus, 'PAUSED');
  ok_('the class-organising screen drops them too',
    /const teachers = staff\.filter\(s=>canClass\(s\) && !s\.ended && !s\.paused\);/.test(app));
  ok_('the check-in refusal is spelled out in the handler that owns the door',
    /STAFF_PAUSED', 'อยู่ระหว่างลาชั่วคราว/.test(checkinGs));
  ok_('...and staffOnDuty_ asks the same question', /nor anyone on temporary leave/.test(parentGs));
}

console.log('\n4) THE SALARY IS THE SCHOOL’S DECISION');
{
  eq('HALF pays half the base', res.payHalf.base, 7500);
  eq('NONE pays nothing', res.payNone, 0);
  eq('CUSTOM pays exactly what the admin typed, INSTEAD of the base', res.payCustom, 6000);
  /* A blank mode means the school has not decided, and an undecided rule must pay in FULL rather
   * than quietly pay nothing. */
  eq('undecided pays in full', res.payUndecided, 15000);
  eq('somebody who is not on leave is unaffected', res.payNormal, 15000);
  eq('a month the leave does not touch is unaffected', res.payOtherMonth, 15000);
  /* AND THE STORED SALARY IS NOT TOUCHED. The payroll screen writes its base-salary box straight
   * back to STAFF.BaseSalary, so reducing the base through the payload would have permanently
   * overwritten this person's real salary with half of it. */
  eq('the person’s real salary on file is unchanged', res.baseAfterPay, 15000);
  ok_('...and the reason that matters is recorded', /would permanently\n   \* overwrite the person's real salary with half of it/.test(payrollGs));
  /* An unexplained half salary is indistinguishable from a mistake, so the payslip row carries the
   * rule and the reason — and the columns exist, or writeRows_ drops them. */
  eq('the slip says which rule was applied, and why', [res.payHalf.mode, res.payHalf.reason], ['HALF', 'ลาคลอด']);
  ok_('...with columns to land in', /'PauseSalaryMode', 'PauseFrom', 'PauseTo', 'PauseReason'\]/.test(configGs));
  ok_('the rule is duplicated into the .gs route that shadows the engine, and says so',
    /function staffPauseSalaryFor_/.test(payrollGs) && /lives in the engine alone would never run on live/.test(payrollGs));
}

console.log('\n5) BACK TO WORK');
{
  eq('every pause field is cleared', [res.cleared.from, res.cleared.to, res.cleared.reason, res.cleared.remark, res.cleared.mode],
    ['', '', '', '', '']);
  eq('...back on the daily summary', res.boardAfter.sort(), ['ก้อย', 'เอ']);
  // same weekend trap as above — the pause is what must be gone, not the school calendar
  eq('...and the pause no longer blocks clocking in', res.punchAfter === 'STAFF_PAUSED', false);
  ok_('the write is in place, like every other STAFF write in that file',
    /updateRow_\(sh, st\._row, \{ PauseFrom: '', PauseTo: ''/.test(staffGs));
  ok_('...and the route takes targetId, so applyIdentity_ cannot redirect it at the caller',
    /targetId, not staffId — the same reason orgMoveTeacher takes one/.test(staffGs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
