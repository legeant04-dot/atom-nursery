/**
 * tools/test_off_days.js — a child who comes four days a week.
 *   node tools/test_off_days.js
 *
 * Asked 2026-08-30: a new family agreed four days a week, away every Wednesday. On that day the
 * child must not be counted absent, must not be checked in by anyone, must not appear on the class
 * list, and no teacher owes a daily report for them. "และเผื่อในอนาคตว่าจะมีเคสแบบนี้มาเพิ่มอีก" —
 * so it is a list of days per child, not a Wednesday flag.
 *
 * STORED AS THE DAYS THEY DO NOT COME. The school chose this and it is the safer half of the choice:
 * blank means "here every day", so all 34 existing records mean the right thing untouched. Recording
 * the days they DO come would have required filling in Mon–Fri for every child first, and any record
 * that was missed would silently have become a child who never comes — a data migration that fails
 * quietly, on live data, in the direction of hiding children.
 *
 * The two rules that decide whether the numbers are right:
 *   • a day off is NOT an absence, and it is not in the denominator either — a day they never owed
 *     cannot be a day they missed, or the attendance percentage is a fiction;
 *   • the school's holiday wins, because it applies to everybody.
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
      cfgGs = R('src/Config.gs'), staffGs = R('src/Staff.gs'), perfGs = R('src/Perf.gs');

// 2026-09: the 2nd is a Wednesday, the 3rd a Thursday, the 4th a Friday, the 7th a Monday.
const WED = '2026-09-02', THU = '2026-09-03', FRI = '2026-09-04', MON = '2026-09-07';

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine']);
const res = JSON.parse(run(function () {
  // the sandbox cannot see the module's consts, and fixed dates are the whole point: two suites once
  // went red purely because they were run on a Saturday
  var WED = '2026-09-02', THU = '2026-09-03', FRI = '2026-09-04', MON = '2026-09-07';
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var stu = sheet_(MAIN, 'STUDENTS');
  ensureColumns_(stu, ['OffDays']);
  var add = function (id, nick, off) {
    appendObject_(stu, { StudentID: id, Name: 'ด.ญ. ' + nick, Nickname: nick, Class: 'Nursery 1',
      Status: 'ACTIVE', EnrollDate: '2025-05-01', Plan: 'FULL', OffDays: off || '' });
  };
  add('STU-W', 'ใบเตย', '3');        // away every Wednesday
  add('STU-WF', 'ต้นกล้า', '3,5');   // Wednesday AND Friday
  add('STU-ALL', 'พลอย', '');        // every day
  add('STU-NONE', 'มะลิ', '1,2,3,4,5'); // never comes on a weekday at all — the extreme end of the rule
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' });
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'ADM', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', Department: '*' });
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'STF-T', Name: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1' });

  var o = {}, D = function (a, p) { return engineDispatch_(a, p); };
  var tryD = function (a, p) { try { return { ok: true, r: D(a, p) }; } catch (e) { return { ok: false, code: e && (e.apiCode || e.code), msg: e && e.message }; } };

  // ---- who is expected, day by day ----
  o.wed = D('classList', { staffId: 'STF-T', className: 'Nursery 1', date: WED });
  o.checkinWed = tryD('staffStudentCheckin', { staffId: 'STF-T', studentId: 'STU-W', type: 'IN', date: WED, remark: 'แม่มาส่ง' });
  o.checkinThu = tryD('staffStudentCheckin', { staffId: 'STF-T', studentId: 'STU-W', type: 'IN', date: THU, remark: 'แม่มาส่ง' });
  o.checkinWedOther = tryD('staffStudentCheckin', { staffId: 'STF-T', studentId: 'STU-ALL', type: 'IN', date: WED, remark: 'แม่มาส่ง' });
  o.friWF = tryD('staffStudentCheckin', { staffId: 'STF-T', studentId: 'STU-WF', type: 'IN', date: FRI, remark: 'แม่มาส่ง' });
  o.monWF = tryD('staffStudentCheckin', { staffId: 'STF-T', studentId: 'STU-WF', type: 'IN', date: MON, remark: 'แม่มาส่ง' });

  // ---- the record, and what a parent's card is told ----
  o.profile = D('studentProfile', { studentId: 'STU-WF', staffId: 'STF-T', role: 'Teacher' });

  // ---- the monthly report: a day off is neither an absence nor a day owed ----
  // nobody attends anything all month; the only difference between these children is their agreement
  // LAST month, deliberately: a month that is over has no 'today is not finished yet' rule running
  // through it, so absences and days-owed can be compared exactly instead of approximately.
  var _lm=new Date(); _lm.setDate(1); _lm.setMonth(_lm.getMonth()-1);
  o.month = dateStr_(_lm).slice(0,7);
  o.report = D('studentMonthReport', { month: o.month, staffId: 'ADM', role: 'Admin' });

  // ---- the sheet is normalised on save, whatever the form sends ----
  handleSaveStudent({ studentId: 'STU-ALL', role: 'Admin', adminId: 'ADM', data: { OffDays: '5, 3,3, 7, 0, x, 2' } });
  o.cleaned = String(findObject_(stu, function (s) { return s.StudentID === 'STU-ALL'; }).OffDays || '');
  handleSaveStudent({ studentId: 'STU-ALL', role: 'Admin', adminId: 'ADM', data: { OffDays: '' } });
  o.cleared = String(findObject_(stu, function (s) { return s.StudentID === 'STU-ALL'; }).OffDays || '');
  o.audit = readObjects_(sheet_(MAIN, 'AUDIT_LOG')).filter(function (r) { return String(r.Action) === 'STUDENT_OFFDAYS'; }).length;
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) the class list on a Wednesday');
{
  const on = res.wed.students.map(s => s.Nickname).sort();
  /* NOT greyed out on the list — off it. A name in front of a teacher who has nothing to do about it
   * is still a name to work through, and it would still count against "is everyone recorded?". */
  eq('the Wednesday children are not on it', on, ['พลอย']);
  eq('...but the class says who is away, and why',
    (res.wed.offToday || []).map(x => [x.nick, x.days]).sort(),
    [['ต้นกล้า', 'วันพุธ, วันศุกร์'],
     ['มะลิ', 'วันจันทร์, วันอังคาร, วันพุธ, วันพฤหัสบดี, วันศุกร์'],
     ['ใบเตย', 'วันพุธ']]);
}

console.log('\n2) nobody can check them in on that day');
{
  eq('a teacher cannot record them', res.checkinWed.ok, false);
  eq('...with a code of its own', res.checkinWed.code, 'STUDENT_DAY_OFF');
  ok_('...naming the child and the day', /ใบเตย/.test(res.checkinWed.msg) && /วันพุธ/.test(res.checkinWed.msg));
  ok_('...and saying plainly it is not an absence', /ไม่นับเป็นวันขาด/.test(res.checkinWed.msg));
  ok_('the school’s report calls that a refusal, not a failure', /STUDENT_DAY_OFF: 1/.test(perfGs));
  // the rest of the week is untouched — this is the half that would break silently
  ok_('the same child checks in normally on Thursday', res.checkinThu.ok === true);
  ok_('another child is unaffected on the same Wednesday', res.checkinWedOther.ok === true);
  eq('a child off two days is refused on the second one', res.friWF.code, 'STUDENT_DAY_OFF');
  ok_('...and is fine on a Monday', res.monWF.ok === true);
  /* ONE GATE. The parent's button and the teacher's on-behalf button both go through
   * assertStudentDayOpen_, so neither can drift from the other. */
  ok_('both doors ask the same function', (engine.match(/assertStudentDayOpen_\(/g) || []).length >= 3);
  ok_('...and the day-off check lives inside it', /if\(s2 && studentOffDay_\(s2, d\)\) fail\('STUDENT_DAY_OFF'/.test(engine));
}

console.log('\n3) the school’s holiday wins');
{
  /* Asked for explicitly: "หากชนกับวันหยุดโรงเรียนก็ให้เป็นไปตามวันหยุดของโรงเรียน". Both mean "not
   * expected", so they cannot disagree about attendance; what differs is the reason given, and a
   * school holiday is the one that applies to everybody. */
  // by POSITION inside the one gate, which is what "first" actually means — a character-window regex
  // would pass or fail on how long the comments happen to be
  const gate = engine.slice(engine.indexOf('function assertStudentDayOpen_'));
  const iClosed = gate.indexOf("fail('SCHOOL_CLOSED'"), iOff = gate.indexOf("fail('STUDENT_DAY_OFF'");
  ok_('school-closed is answered before the child’s own day off', iClosed > 0 && iOff > iClosed);
  ok_('...with the reason written down', /THE SCHOOL'S HOLIDAY IS REPORTED FIRST/.test(engine));
  /* ...but a child NAMED for a closed day still gets in: putting them on the list for one particular
   * date is a decision about that date, and it beats a standing weekly pattern. */
  ok_('a named holiday attendee still passes', /if\(isHolidayAttendee_\(studentId, d\)\) return;/.test(engine));
}

console.log('\n4) THE NUMBERS — a day off is not an absence, and not a day owed');
{
  // the report groups by class, which is the unit a teacher thinks in
  const all = [].concat.apply([], res.report.classes.map(c => c.students));
  const row = n => all.find(r => r.nick === n);
  const berry = row('ใบเตย'), sprout = row('ต้นกล้า'), ploy = row('พลอย');
  const never = row('มะลิ');
  ok_('all four children are in the report', !!berry && !!sprout && !!ploy && !!never);
  /* Asserted as RELATIONSHIPS against the month's own school-day count, not as hard-coded numbers:
   * the school's holidays are part of that count and change from month to month, and a test that
   * pins "22" would go red for a reason that has nothing to do with this rule. */
  eq('a child who comes every day owes every school day', ploy.schoolDays, res.report.schoolDays);
  ok_('...one Wednesday off owes fewer', berry.schoolDays < ploy.schoolDays);
  ok_('...Wednesday and Friday, fewer still', sprout.schoolDays < berry.schoolDays);
  // the far end of the rule, where an off-by-one would show up plainly
  eq('a child off every weekday owes nothing', never.schoolDays, 0);
  eq('...and is absent nothing', never.absent, 0);
  /* THE DENOMINATOR HAS TO AGREE WITH THE NUMERATOR. Nobody attended anything this month, so every
   * day owed is an absence. Counting the day off as owed but not as missed would read as an
   * attendance percentage nobody could account for; not counting it at all is what adds up. */
  eq('absences match the days actually owed',
    [ploy.absent === ploy.schoolDays, berry.absent === berry.schoolDays, sprout.absent === sprout.schoolDays],
    [true, true, true]);
  ok_('...so a four-day child is not chased for an absence they never had', berry.absent < ploy.absent);
  ok_('...and neither is the run of consecutive absences inflated',
    berry.maxConsecutive < ploy.maxConsecutive && sprout.maxConsecutive < berry.maxConsecutive);
}

console.log('\n5) what gets stored, and what a screen is told');
{
  eq('the record carries the days', res.profile.offDays, '3,5');
  eq('...spelled out for a person', res.profile.offDaysLabel, 'วันพุธ, วันศุกร์');
  eq('...and in English', res.profile.offDaysLabelEN, 'Wednesday, Friday');
  /* WHATEVER THE FORM SENDS, THE SHEET GETS A CLEAN LIST. This decides whether a child is expected at
   * school, so it is normalised on the way in rather than trusted: Saturday and Sunday dropped (the
   * weekend is already closed for everyone), duplicates collapsed, rubbish ignored, order fixed so
   * two identical settings cannot look different in the sheet. */
  eq('7, 0 and rubbish are dropped; 3 twice becomes 3 once; sorted', res.cleaned, '2,3,5');
  eq('...and clearing every box really clears it', res.cleared, '');
  ok_('the column is declared', /'OffDays'\]/.test(cfgGs));
  ok_('...and topped up on save, so ticking a box cannot silently do nothing', /'OffDays'\]\); \} catch \(e\) \{\}/.test(staffGs));
  // changing which days a child attends moves them off lists and out of the absence count
  eq('every change is on the record', res.audit, 2);
}

console.log('\n6) the screens');
{
  ok_('the admin form has Monday–Friday only', /\[1,2,3,4,5\]\.map\(n=>\{/.test(app));
  ok_('...and says what a ticked day means', /ไม่นับเป็นวันขาด/.test(app));
  ok_('...including that the fee does not change', /ค่าเทอมคิดเต็มเหมือนเดิม/.test(app));
  ok_('an empty selection is still sent, or un-ticking the last box would do nothing',
    /data\.OffDays=_od\.filter\(x=>x\.checked\)\.map\(x=>x\.value\)\.join\(','\)/.test(app));
  ok_('the parent’s card replaces the buttons instead of offering a refusal', /: k\.dayOff/.test(app));
  ok_('...and the journal card says why there is no report', /วันหยุดประจำของน้อง/.test(app));
  ok_('the teacher’s class screen says who is away by arrangement', /วันนี้ไม่มาเรียนตามที่ตกลงไว้/.test(app));
  ok_('the built engine has the rule too', /function studentOffDay_\(s, onDate\)\{/.test(gasEngine));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
