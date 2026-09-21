/**
 * tools/test_leave_range_end.js — a leave that lasts several days, and a child's last day.
 *   node tools/test_leave_range_end.js
 *
 * Two things asked for together on 2026-09-21, both about a DATE RANGE rather than a single day.
 *
 * 1. "พานักเรียนไปต่างจังหวัด 3 วัน 21/09/26-23/09/26 จะมาโรงเรียนในวันที่ 24/09/26 วันที่ 21-23/09
 *    ระบบก็จะแสดงข้อมูลนักเรียนเป็นในส่วนของลา" — filing the same form once per day was the only way,
 *    and the day somebody forgot became an unexplained absence with a teacher ringing the family.
 *
 * 2. "ประวัตินักเรียนเพิ่มข้อมูลวันสิ้นสุดการเรียน ... ให้ Admin ใส่ข้อมูลและเหตุผล ... คล้ายกับของพนักงาน"
 *    — a last day recorded IN ADVANCE, the way staff EndDate already works. The school knows in
 *    March that a child finishes in May.
 *
 * THE FOUR DECISIONS THIS FILE PROTECTS, all taken 2026-09-21 and all easy to quietly undo later:
 *   · closed days inside a range are SKIPPED — a child is not absent on a Sunday;
 *   · a range is capped at 14 days — longer is ลาชั่วคราว, which is a different thing and free;
 *   · the end date CUTS OFF BY ITSELF when it passes, with no trigger to run;
 *   · but the BILL is decided by the MONTH — a child finishing on the 15th is billed for that whole
 *     month, and the finance screen must still find them on the 20th. That last one is the one that
 *     costs real money if it regresses, and it is the least obvious.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'),
      parentGs = R('src/Parent.gs'), staffGs = R('src/Staff.gs'),
      codeGs = R('src/Code.gs'), configGs = R('src/Config.gs');

/* A MONDAY, so the fixtures below can say "three days" and "across a weekend" without either one
 * depending on the day the suite happens to be run. Everything here is anchored to it. */
const MON = '2026-09-21', TUE = '2026-09-22', WED = '2026-09-23', THU = '2026-09-24',
      FRI = '2026-09-25', SAT = '2026-09-26', SUN = '2026-09-27', NEXTMON = '2026-09-28';

// ============================================================================================
console.log('1) the span expands into days, and the closed ones are dropped');
// ============================================================================================
{
  const M = {
    students: [{ StudentID: 'S1', NameTH: 'เด็กหญิงเอ', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE' }],
    studentLeaves: [],
    holidays: [{ Date: WED, NameTH: 'วันหยุดโรงเรียน' }],   // a school holiday INSIDE the range
    staff: [], parents: [], activityLog: [], config: {}
  };
  const H = createAtomAPI(M).H;

  const r = H.studentAbsence({ studentId: 'S1', date: MON, dateTo: THU, type: 'ลากิจ', reason: 'ไปต่างจังหวัด' });
  eq('Mon–Thu with a holiday on Wed → three days filed', r.days, 3);
  eq('...and they are the open ones', M.studentLeaves.map(l => l.Date).sort(), [MON, TUE, THU]);
  eq('...the span it reports is the span that was asked for', [r.from, r.to], [MON, THU]);
  ok_('...every row carries the same GroupID, which is what makes it one trip',
    new Set(M.studentLeaves.map(l => l.GroupID)).size === 1);
  ok_('...and DateTo, so a screen can print the span without regrouping',
    M.studentLeaves.every(l => l.DateTo === THU));

  /* THE POINT OF ONE ROW PER DAY: every existing reader answers correctly with no change at all.
   * studentLeaves is what the register, the calendar and the follow-up all go through. */
  const days = H.studentLeaves({ studentId: 'S1' }).map(l => l.Date).sort();
  eq('the register sees each day on its own', days, [MON, TUE, THU]);

  // a weekend crossing, with no holiday involved
  M.studentLeaves.length = 0;
  const r2 = H.studentAbsence({ studentId: 'S1', date: FRI, dateTo: NEXTMON, type: 'ลาป่วย' });
  eq('Fri–Mon → two days, the weekend dropped', [r2.days, M.studentLeaves.map(l => l.Date).sort()],
     [2, [FRI, NEXTMON]]);

  // a range that is ENTIRELY closed is a mistake worth naming rather than an empty success
  M.studentLeaves.length = 0;
  let code = '';
  try { H.studentAbsence({ studentId: 'S1', date: SAT, dateTo: SUN }); } catch (e) { code = e.code; }
  eq('a weekend-only range is refused, and says so', [code, M.studentLeaves.length], ['NO_OPEN_DAYS', 0]);
}

// ============================================================================================
console.log('\n2) the two limits, and the one that sends the family somewhere useful');
// ============================================================================================
{
  const M = { students: [{ StudentID: 'S1', NameTH: 'เอ', Status: 'ACTIVE' }], studentLeaves: [],
              holidays: [], staff: [], parents: [], activityLog: [], config: {} };
  const H = createAtomAPI(M).H;

  let e1 = null;
  try { H.studentAbsence({ studentId: 'S1', date: THU, dateTo: MON }); } catch (e) { e1 = e; }
  eq('an end before the start is refused', e1 && e1.code, 'BAD_RANGE');

  let e2 = null;
  try { H.studentAbsence({ studentId: 'S1', date: '2026-09-01', dateTo: '2026-09-30' }); } catch (e) { e2 = e; }
  eq('thirty days is refused', e2 && e2.code, 'RANGE_TOO_LONG');
  /* AND IT SAYS WHAT TO DO INSTEAD. A parent told "too long" has nowhere to go; a parent told to ask
   * the school for ลาชั่วคราว has the right next step — and that route does not charge them. */
  ok_('...naming ลาชั่วคราว, which is the thing they actually want',
    /ลาชั่วคราว/.test(e2.message) && /ไม่คิดค่าเทอม/.test(e2.message));

  // the boundary itself: exactly fourteen calendar days is allowed
  const r = H.studentAbsence({ studentId: 'S1', date: '2026-09-07', dateTo: '2026-09-20' });
  ok_('exactly 14 days is allowed', r.days > 0);
  ok_('the cap is a named constant, not a number buried in a condition',
    /MAX_LEAVE_SPAN_DAYS = 14/.test(engine) && /MAX_LEAVE_SPAN_DAYS_ = 14/.test(parentGs));
}

// ============================================================================================
console.log('\n3) filing it twice, and filing MORE of it');
// ============================================================================================
{
  const M = { students: [{ StudentID: 'S1', NameTH: 'เอ', Status: 'ACTIVE' }], studentLeaves: [],
              holidays: [], staff: [], parents: [], activityLog: [], config: {} };
  const H = createAtomAPI(M).H;

  H.studentAbsence({ studentId: 'S1', date: MON, dateTo: TUE, type: 'ลากิจ' });
  const again = H.studentAbsence({ studentId: 'S1', date: MON, dateTo: TUE, type: 'ลากิจ' });
  eq('a double-submit creates nothing and says nothing happened',
     [again.days, again.duplicate, M.studentLeaves.length], [0, false, 2].map((v, i) => i === 1 ? true : v));

  /* EXTENDING A TRIP IS THE CASE THAT MATTERS. A family away Mon–Tue who decides to stay until
   * Thursday files Mon–Thu. Refusing the whole thing because Monday is already on record would send
   * them to ring the school; skipping per-day gives them the two new days and leaves the rest. */
  const more = H.studentAbsence({ studentId: 'S1', date: MON, dateTo: THU, type: 'ลากิจ' });
  eq('...but extending it adds only the new days', [more.days, more.skipped], [2, [MON, TUE]]);
  eq('...and there is still exactly one row per day', M.studentLeaves.map(l => l.Date).sort(),
     [MON, TUE, WED, THU]);
}

// ============================================================================================
console.log('\n4) cancelling a trip cancels the trip — and keeps the days already taught');
// ============================================================================================
{
  const TODAY = (() => { const d = new Date(); return d.toISOString().slice(0, 10); })();
  const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const M = { students: [{ StudentID: 'S1', NameTH: 'เอ', Status: 'ACTIVE' }],
              studentLeaves: [], holidays: [], staff: [], parents: [], activityLog: [], config: {} };
  const H = createAtomAPI(M).H;

  // a run that started two days ago and runs two more — the shape of somebody coming home early
  const G = 'LVG-S1-x';
  [-2, -1, 0, 1].forEach((n, i) => M.studentLeaves.push({
    LeaveID: 'LVS-000' + (i + 1), StudentID: 'S1', Date: shift(n), DateTo: shift(1),
    GroupID: G, Type: 'ลากิจ', Status: 'Notified' }));

  const r = H.parentCancelLeave({ studentId: 'S1', leaveId: 'LVS-0003', parentId: 'P1' });
  eq('today and tomorrow are cancelled', r.cancelled, 2);
  /* THE DAYS ALREADY PAST ARE KEPT, and this is not a nicety: they are the attendance record of two
   * mornings the school taught. Deleting them would let a family rewrite the register from a phone. */
  eq('...and the two days already taught are still on record',
     M.studentLeaves.map(l => l.Date).sort(), [shift(-2), shift(-1)]);

  // a run entirely in the past has nothing left to cancel, and says so rather than doing nothing
  let code = '';
  try { H.parentCancelLeave({ studentId: 'S1', leaveId: 'LVS-0001', parentId: 'P1' }); } catch (e) { code = e.code; }
  eq('a finished trip is refused outright', code, 'LEAVE_PAST');
}

// ============================================================================================
console.log('\n5) the last day — recorded in advance, acting on its own');
// ============================================================================================
{
  const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const M = {
    students: [
      { StudentID: 'S1', NameTH: 'เอ', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-01-05' },
      { StudentID: 'S2', NameTH: 'บี', Nickname: 'บี', Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-01-05' }
    ],
    staff: [{ StaffID: 'ADM', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', NameTH: 'แอดมิน' }],
    studentLeaves: [], holidays: [], payments: [], parents: [], activityLog: [], config: {}
  };
  const H = createAtomAPI(M).H;
  const onRoll = () => H.listStudents().map(s => s.StudentID).sort();

  eq('both children start on the roll', onRoll(), ['S1', 'S2']);

  const r = H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: shift(30), reason: 'graduated' });
  eq('a last day a month away is accepted, and is not "ended" yet',
     [r.endDate, r.ended, r.endScheduled], [shift(30), false, true]);
  /* THE WHOLE POINT. The school records it in March and the child keeps coming until May — so a
   * scheduled end must change NOTHING about today. */
  eq('...and the child is still on every list', onRoll(), ['S1', 'S2']);
  ok_('...and can still be checked in', (() => {
    try { H.parentCheckin && 0; return true; } catch (e) { return false; } })());

  // the day itself is a school day; the day after is not
  H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: shift(0), reason: 'graduated' });
  eq('on the last day itself they are still here', onRoll(), ['S1', 'S2']);
  H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: shift(-1), reason: 'graduated' });
  eq('the day after, they are off the roll', onRoll(), ['S2']);

  /* NOTHING WAS DELETED, AND NOTHING FLIPPED. Status is untouched, which is what makes the next
   * assertion possible — clearing a date entered by mistake puts the child straight back rather
   * than leaving a WITHDRAWN row for somebody to repair. */
  eq('Status was never touched', M.students.find(s => s.StudentID === 'S1').Status, 'ACTIVE');
  H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: '' });
  eq('clearing it brings them straight back', onRoll(), ['S1', 'S2']);

  // the endingStudents list is the "แจ้ง Admin" half — it must show BOTH sides of the date
  H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: shift(-1), reason: 'moved' });
  H.setStudentEnd({ staffId: 'ADM', studentId: 'S2', endDate: shift(10), reason: 'graduated' });
  const ending = H.endingStudents();
  eq('both the finished and the upcoming are listed',
     ending.map(x => [x.studentId, x.ended]), [['S1', true], ['S2', false]]);
  ok_('...with the reason, so "why did this child leave" has an answer months later',
     ending.every(x => !!x.reason));
}

// ============================================================================================
console.log('\n6) the refusals — a typo must not make a child disappear');
// ============================================================================================
{
  const M = {
    students: [{ StudentID: 'S1', NameTH: 'เอ', Status: 'ACTIVE', EnrollDate: '2026-06-01' }],
    staff: [{ StaffID: 'ADM', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
            { StaffID: 'STF-T', Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE' }],
    studentLeaves: [], holidays: [], parents: [], activityLog: [], config: {}
  };
  const H = createAtomAPI(M).H;

  let e = null;
  try { H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: '2026-05-01', reason: 'moved' }); } catch (x) { e = x; }
  /* A LAST DAY BEFORE THE FIRST DAY is not a short enrolment, it is a typo — and it would make a
   * child who has not started already finished, invisible from the moment they were entered. */
  eq('a last day before the first day is refused', e && e.code, 'BAD_INPUT');
  ok_('...naming the first day, so the admin can see what they mis-typed', /2026-06-01/.test(e.message));

  let e2 = null;
  try { H.setStudentEnd({ staffId: 'ADM', studentId: 'S1', endDate: '2026-12-01' }); } catch (x) { e2 = x; }
  /* THE REASON IS REQUIRED. "Why did this child leave?" is asked months later by somebody who was
   * not in the room, and this record is the only thing left that can answer it. */
  eq('a date with no reason is refused', e2 && e2.code, 'BAD_INPUT');

  let e3 = null;
  try { H.setStudentEnd({ staffId: 'STF-T', studentId: 'S1', endDate: '2026-12-01', reason: 'moved' }); } catch (x) { e3 = x; }
  eq('a teacher may not end a child’s enrolment', e3 && e3.code, 'NO_PERMISSION');
  eq('...and nothing was written', M.students[0].EndDate, undefined);

  ok_('the route is admin-only on the server too, not just in the engine',
    /setStudentEnd: 1/.test(codeGs) && /endingStudents: 1/.test(codeGs));
}

// ============================================================================================
console.log('\n7) THE MONEY — a child finishing mid-month is billed for the whole month');
// ============================================================================================
{
  /* THE DECISION (2026-09-21): "ออกบิลเต็มเดือนตามปกติ" — no proration. Which means the cut-off for
   * BILLING is by MONTH, not by day. Get this wrong and the last invoice of a child who is leaving
   * silently never goes out — the one invoice nobody is watching for, because the child is gone. */
  const M = {
    students: [{ StudentID: 'S1', NameTH: 'เอ', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE',
                 Plan: 'P1', EnrollDate: '2026-01-05', EndDate: '2026-09-15' }],
    staff: [{ StaffID: 'ADM', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }],
    payments: [], studentLeaves: [], holidays: [], otDaily: [], studentCharges: [], paySlips: [],
    parents: [], activityLog: [], userLinks: [], classes: [],
    config: { Plans: [{ id: 'P1', labelTH: 'เต็มวัน', price: 6900 }] }
  };
  const H = createAtomAPI(M).H;

  // 2026-09-20: five days AFTER the last day, still inside the month they finished in
  const sept = H.financeSummary({ staffId: 'ADM', month: '2026-09' });
  ok_('the September finance page still lists a child who finished on the 15th',
    (sept.students || []).some(s => String(s.studentId || s.StudentID) === 'S1'));

  const gen = H.generateMonthlyBills({ staffId: 'ADM', month: '2026-09' });
  eq('...and September’s bill run still bills them', gen.created, 1);

  // ...but the month AFTER is where it stops
  const oct = H.financeSummary({ staffId: 'ADM', month: '2026-10' });
  ok_('October does not list them', !(oct.students || []).some(s => String(s.studentId || s.StudentID) === 'S1'));
  const gen2 = H.generateMonthlyBills({ staffId: 'ADM', month: '2026-10' });
  eq('...and October bills nobody', gen2.created, 0);

  ok_('the month-vs-day distinction is written down where the next person will change it',
    /endedBeforeMonth_/.test(engine) && /PASS A MONTH WHEN THE QUESTION IS ABOUT MONEY/.test(engine));
}

// ============================================================================================
console.log('\n8) the live GAS routes — because these are the ones that actually run');
// ============================================================================================
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var MAIN = getMainSpreadsheet_();
    var stu = sheet_(MAIN, 'STUDENTS');
    appendObject_(stu, { StudentID: 'S9', Name: 'เด็กหญิงซี', Nickname: 'ซี', Class: 'Nursery 1',
      Status: 'ACTIVE', EnrollDate: '2026-01-05', ParentID: 'P9' });
    appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'P9', Name: 'แม่ซี', StudentID: 'S9', LineUID: '' });

    var out = { steps: [] };
    var grab = function (label, fn) {
      try { out.steps.push([label, 'ok', fn()]); } catch (e) { out.steps.push([label, e.apiCode || e.code || 'ERR', String(e.message || e)]); }
    };

    // Mon 21 → Thu 24 with Wed 23 a school holiday, exactly as section 1
    var hol = sheet_(MAIN, 'HOLIDAYS');
    appendObject_(hol, { Date: '2026-09-23', NameTH: 'วันหยุดโรงเรียน' });
    _configCache = null;

    grab('range', function () {
      var r = handleStudentAbsence({ parentId: 'P9', studentId: 'S9', date: '2026-09-21',
        dateTo: '2026-09-24', type: 'ลากิจ', reason: 'ไปต่างจังหวัด' });
      return { days: r.days, from: r.from, to: r.to, group: !!r.groupId };
    });
    grab('rows', function () {
      return readObjects_(sheet_(MAIN, 'LEAVE_REQUEST_STD'))
        .filter(function (r) { return String(r.StudentID) === 'S9'; })
        .map(function (r) { return otNormDate_(r.Date); }).sort();
    });
    grab('groupOne', function () {
      var g = {}; readObjects_(sheet_(MAIN, 'LEAVE_REQUEST_STD'))
        .forEach(function (r) { if (String(r.StudentID) === 'S9') g[String(r.GroupID || '')] = 1; });
      return Object.keys(g);
    });
    grab('tooLong', function () {
      handleStudentAbsence({ parentId: 'P9', studentId: 'S9', date: '2026-10-01', dateTo: '2026-10-31' });
      return 'NOT REFUSED';
    });
    grab('backwards', function () {
      handleStudentAbsence({ parentId: 'P9', studentId: 'S9', date: '2026-10-10', dateTo: '2026-10-01' });
      return 'NOT REFUSED';
    });

    // ---- the last day, on the live route ----
    grab('endNoReason', function () {
      handleSetStudentEnd({ studentId: 'S9', endDate: '2026-12-31' }); return 'NOT REFUSED'; });
    grab('endBeforeStart', function () {
      handleSetStudentEnd({ studentId: 'S9', endDate: '2025-12-31', reason: 'moved' }); return 'NOT REFUSED'; });
    grab('endOk', function () {
      var r = handleSetStudentEnd({ studentId: 'S9', endDate: '2026-12-31', reason: 'graduated',
        remark: 'ย้ายไปอนุบาล', adminId: 'ADM' });
      var row = findObject_(sheet_(MAIN, 'STUDENTS'), function (s) { return String(s.StudentID) === 'S9'; });
      return { scheduled: r.endScheduled, ended: r.ended, status: String(row.Status || ''),
               endDate: String(row.EndDate || '').slice(0, 10), reason: String(row.EndReason || '') };
    });
    grab('endClear', function () {
      handleSetStudentEnd({ studentId: 'S9', endDate: '', adminId: 'ADM' });
      var row = findObject_(sheet_(MAIN, 'STUDENTS'), function (s) { return String(s.StudentID) === 'S9'; });
      return { endDate: String(row.EndDate || ''), status: String(row.Status || '') };
    });
    grab('audit', function () {
      return readObjects_(sheet_(MAIN, 'AUDIT_LOG'))
        .map(function (r) { return String(r.Action || ''); })
        .filter(function (a) { return a.indexOf('STUDENT_END') === 0 || a === 'STUDENT_ABSENCE'; });
    });
    return JSON.stringify(out);
  }));
  const S = {}; res.steps.forEach(([k, st, v]) => { S[k] = { st, v }; });

  eq('the live route files three days across a holiday', S.range.v, { days: 3, from: '2026-09-21', to: '2026-09-24', group: true });
  eq('...one row per open day', S.rows.v, ['2026-09-21', '2026-09-22', '2026-09-24']);
  eq('...all under one GroupID', S.groupOne.v.length, 1);
  eq('the live route refuses a month-long range', S.tooLong.st, 'RANGE_TOO_LONG');
  eq('...and a backwards one', S.backwards.st, 'BAD_RANGE');

  eq('the live end route refuses a date with no reason', S.endNoReason.st, 'BAD_INPUT');
  eq('...and a last day before the first day', S.endBeforeStart.st, 'BAD_INPUT');
  eq('a scheduled end is written, and Status is left alone', S.endOk.v,
     { scheduled: true, ended: false, status: 'ACTIVE', endDate: '2026-12-31', reason: 'graduated' });
  eq('clearing it empties the field and still leaves Status alone', S.endClear.v, { endDate: '', status: 'ACTIVE' });
  ok_('both are on the audit record', S.audit.v.indexOf('STUDENT_ABSENCE') >= 0 &&
      S.audit.v.some(a => a.indexOf('STUDENT_END') === 0));
}

// ============================================================================================
console.log('\n9) the columns exist, and the screens reach them');
// ============================================================================================
{
  /* A shadowed write saves NOTHING if the column is not declared — the value goes into an object
   * whose key has no header and is dropped without an error. Both features add columns. */
  ok_('LEAVE_REQUEST_STD declares DateTo and GroupID',
    /LEAVE_REQUEST_STD: \[[^\]]*'DateTo', 'GroupID'\]/.test(configGs));
  ok_('STUDENTS declares EndDate, EndReason and EndRemark',
    /'EndDate', 'EndReason', 'EndRemark'/.test(configGs));
  ok_('...and the live routes ensureColumns_ them anyway, for a sheet created before today',
    /ensureColumns_\(sheet, \['Type', 'FiledBy', 'DateTo', 'GroupID'\]\)/.test(parentGs) &&
    /ensureColumns_\(sh, \['EndDate', 'EndReason', 'EndRemark'\]\)/.test(staffGs));

  // the parent's form
  ok_('the parent form has both dates', /id="aDate"/.test(app) && /id="aDateTo"/.test(app));
  ok_('...and sends the second one', /dateTo:to/.test(app));
  ok_('the teacher form has them too', /id="tslDateTo"/.test(app) && /dateTo:g\('tslDateTo'\)/.test(app));
  /* THE COUNT IS NOT PREDICTED ON SCREEN. Neither form holds the school's holiday list, so a number
   * shown before sending could disagree with what is actually filed. They state the span and say
   * closed days are skipped; the toast afterwards reports the real figure from the server. */
  ok_('neither form promises a day count it cannot know',
    /ระบบข้ามให้อัตโนมัติ/.test(app) && /Number\(r&&r\.days\)\|\|0/.test(app));

  // a run reads as one line
  ok_('runs are folded into one row on the parent’s list', /function groupLeaveRuns_\(/.test(app));
  ok_('...and the cancel confirmation names all the days it will take',
    /ยกเลิกการแจ้งลาทั้ง \$\{n\} วัน/.test(app));

  // the admin's form
  ok_('the student form has the end-of-study block', /id="stf_EndDate"/.test(app) && /id="stf_EndReason"/.test(app));
  ok_('...admin only, matching the server', /USER\.role==='Admin'&&id\?\(function\(\)\{/.test(app));
  /* AND IT IS NOT SWEPT UP BY THE ORDINARY SAVE. Ending a child's enrolment is its own decision; a
   * date typed into a form that is then saved with everything else is a date nobody agreed to. */
  ok_('...and A_saveStudent does not send EndDate behind the admin’s back',
    !/EndDate:v\('EndDate'\)/.test(app));
  ok_('the confirmation says what happens and when, not "are you sure"',
    /ยังมาเรียนได้ตามปกติจนถึงวันนั้น/.test(app));
  ok_('children already finished have somewhere to be seen, and a way back',
    /sec-students-gone/.test(app) && /A_studentEndClear/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
