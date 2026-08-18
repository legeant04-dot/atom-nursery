/**
 * tools/test_att_audit.js — who is still unaccounted for, and the holiday you can now correct.
 *   node tools/test_att_audit.js
 *
 * Two things were asked for on 2026-08-18:
 *
 *  1. "ตรวจสอบนักเรียนที่ไม่ได้ Check-in/out ... หากมีนักเรียนที่ไม่ได้ Check-out ให้ระบบค้างไว้ก่อน และให้
 *     คุณครู/หัวหน้าครูดำเนินการลงเวลาที่นักเรียนกลับบ้านจริง ... หากเกินเงื่อนไข OT นักเรียนให้คิด OT ตามจริง
 *     เช่น นักเรียน A Check-in 07:50 แต่ลืม Check-out และคุณครูใส่เวลา 18:40 นักเรียนคนนี้จะมี OT 1 ชั่วโมง"
 *
 *     The point of the screen is what it REFUSES to do: it does not close the day for anybody. A
 *     child with no pick-up stays OPEN until a person enters the real time, because a guessed time
 *     is a real charge on a real family. When that time is entered it goes through the SAME
 *     editStudentAttendance the class screen uses — so the class scope, the OT recompute and the
 *     activity log are the ones that already exist, not a second set that can drift from them.
 *
 *  2. "วันหยุด เพิ่มแก้ไขข้อมูลวันหยุดได้" — correcting a holiday used to mean delete + add. Two
 *     writes, and if the second one failed the school was left with NO holiday on a day the
 *     check-in guard had already been told to close.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

// 2026-08-18 is a Tuesday. The children finish at 17:00 and OT is ฿100 an hour after a 21-minute grace.
const DAY = '2026-08-18';
function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [], LeaveQuota: {}, BigCleaningDays: [], OTRatePerHour: 100, OTGraceMinutes: 21,
      DefaultStudentIn: '08:00', DefaultStudentOut: '17:00' }, over.config || {}),
    holidays: over.holidays || [],
    classes: over.classes || [{ ClassName: 'Nursery 1', TeacherID: 'STF-001' }, { ClassName: 'Nursery 2', TeacherID: 'STF-002' }],
    students: over.students || [], staff: over.staff || [],
    checkinStudent: over.checkinStudent || [], studentCheckins: over.studentCheckins || [],
    studentLeaves: over.studentLeaves || [], otDaily: over.otDaily || [],
    parents: [], userLinks: [], leaves: [], payments: [], studentCharges: [], prepayments: [], paymentSlips: [],
    journals: [], comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    studentAttendanceToday: over.studentAttendanceToday || [], otRecords: []
  };
  const at = new Date(over.now || (DAY + 'T18:45:00'));
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
// four children, one per situation the screen exists to tell apart
const KIDS = [
  { StudentID: 'STD-001', Nickname: 'ไบร์ท', NameTH: 'ก ข', Class: 'Nursery 1', Status: 'ACTIVE' },
  { StudentID: 'STD-002', Nickname: 'มายด์', NameTH: 'ค ง', Class: 'Nursery 1', Status: 'ACTIVE' },
  { StudentID: 'STD-003', Nickname: 'ปอ',    NameTH: 'จ ฉ', Class: 'Nursery 1', Status: 'ACTIVE' },
  { StudentID: 'STD-004', Nickname: 'จูน',   NameTH: 'ช ซ', Class: 'Nursery 2', Status: 'ACTIVE' }
];
const STAFF = [
  { StaffID: 'STF-001', NameTH: 'ครูเอ', Department: 'Nursery 1', Role: 'Teacher' },
  { StaffID: 'STF-002', NameTH: 'ครูบี', Department: 'Nursery 2', Role: 'Teacher' },
  { StaffID: 'STF-009', NameTH: 'หัวหน้าครู', Department: '*', Role: 'Teacher' }
];
// STD-001 arrived and went home; STD-002 arrived and NOBODY tapped pick-up; STD-003 never logged
// anything at all; STD-004 is on leave (and so is not "missing")
const CK = [
  { Date: DAY, StudentID: 'STD-001', InTime: '07:50', OutTime: '16:40' },
  { Date: DAY, StudentID: 'STD-002', InTime: '07:50', OutTime: '' }
];
const base = over => boot(Object.assign({ students: KIDS, staff: STAFF, studentCheckins: CK,
  studentLeaves: [{ StudentID: 'STD-004', Date: DAY, Type: 'ลาป่วย', Reason: 'ไข้' }] }, over || {}));

console.log('\n1) the four things a day can be, told apart');
{
  const { H } = base();
  const d = H.attendanceAudit({ date: DAY, role: 'Admin' });
  const st = id => (d.rows.find(r => r.studentId === id) || {}).status;
  eq('arrived and went home', st('STD-001'), 'DONE');
  eq('arrived, nobody tapped pick-up — left OPEN, not closed for them', st('STD-002'), 'OPEN');
  eq('no times at all', st('STD-003'), 'NONE');
  eq('on leave — the family told us, so nothing is missing', st('STD-004'), 'LEAVE');
  eq('and the counts say the same thing', [d.counts.total, d.counts.done, d.counts.open, d.counts.none, d.counts.leave], [4, 1, 1, 1, 1]);
  const open = d.rows.find(r => r.studentId === 'STD-002');
  eq('the open row carries the times it does have', [open.inTime, open.outTime], ['07:50', '']);
  eq('...and when the school day ends, so a person can judge the pick-up time', open.planEnd, '17:00');
  eq('the leave says which kind it was', (d.rows.find(r => r.studentId === 'STD-004') || {}).leaveType, 'ลาป่วย');
}

console.log('\n2) you only see the children you are allowed to correct');
{
  const { H } = base();
  const mine = H.attendanceAudit({ date: DAY, staffId: 'STF-001', role: 'Teacher' });
  eq('a class teacher sees their own class', mine.rows.map(r => r.studentId).sort(), ['STD-001', 'STD-002', 'STD-003']);
  eq('...and nobody else\'s', mine.rows.filter(r => r.class !== 'Nursery 1').length, 0);
  eq('...and is told the scope is narrow', mine.scope, 'myClasses');
  const head = H.attendanceAudit({ date: DAY, staffId: 'STF-009', role: 'Teacher' });
  eq('a head teacher (Department "*") sees the school', head.rows.length, 4);
  eq('...and Admin does too', H.attendanceAudit({ date: DAY, role: 'Admin' }).rows.length, 4);
  eq('the class filter narrows it further', H.attendanceAudit({ date: DAY, role: 'Admin', className: 'Nursery 2' }).rows.map(r => r.studentId), ['STD-004']);
  // the same scope rule as the correction itself — a teacher cannot fix a class they cannot see
  throws_('and a teacher may not correct another class', () =>
    H.editStudentAttendance({ studentId: 'STD-004', date: DAY, checkOut: '18:40', staffId: 'STF-001', role: 'Teacher' }), 'ชั้นที่ดูแล');
}

console.log('\n3) the case the school described: dropped off 07:50, pick-up forgotten, teacher enters 18:40');
{
  const { H, M } = base();
  const before = H.attendanceAudit({ date: DAY, staffId: 'STF-001', role: 'Teacher' });
  eq('before: still open', (before.rows.find(r => r.studentId === 'STD-002') || {}).status, 'OPEN');
  eq('...and no OT has been charged for a pick-up nobody recorded', M.otDaily.length, 0);

  const r = H.editStudentAttendance({ studentId: 'STD-002', date: DAY, checkOut: '18:40', staffId: 'STF-001', role: 'Teacher', remark: 'ลืมลงเวลาตอนรับกลับ' });
  eq('the pick-up time is the one the teacher entered, not "now"', r.checkOut, '18:40');
  eq('...and the arrival is untouched', r.checkIn, '07:50');
  eq('OT is raised for the real overrun (17:00 → 18:40 = 100 min → 2h)', [r.ot.lateMinutes, r.ot.amount], [100, 200]);

  const after = H.attendanceAudit({ date: DAY, staffId: 'STF-001', role: 'Teacher' });
  const row = after.rows.find(r2 => r2.studentId === 'STD-002');
  eq('the day is now complete', row.status, 'DONE');
  eq('...and the screen shows the charge that came with it', [row.otLate, row.otAmount], [100, 200]);
  eq('one open case left the list', [after.counts.open, after.counts.done], [0, 2]);
  ok_('the correction is in the activity log, with who and why', (M.activityLog || []).some(a =>
    String(a.Action || a.action) === 'editStudentAttendance' && /18:40/.test(String(a.Detail || a.detail || ''))));
}
{
  // the example in the request, to the letter: an 18:40 pick-up against an 18:00 finish is 1 hour
  const kid = [{ StudentID: 'STD-010', Nickname: 'เอ', NameTH: 'A', Class: 'Nursery 1', Status: 'ACTIVE', EndTime: '18:00' }];
  const { H } = boot({ students: kid, staff: STAFF, studentCheckins: [{ Date: DAY, StudentID: 'STD-010', InTime: '07:50', OutTime: '' }] });
  const r = H.editStudentAttendance({ studentId: 'STD-010', date: DAY, checkOut: '18:40', role: 'Admin' });
  eq('นักเรียน A: 07:50 → 18:40, เลิก 18:00 = OT 1 ชั่วโมง', [r.ot.lateMinutes, r.ot.amount], [40, 100]);
}
{
  // ...and a pick-up INSIDE the grace period is not a charge. The screen must not turn "we finally
  // wrote it down" into money that was never owed.
  const { H, M } = base();
  H.editStudentAttendance({ studentId: 'STD-002', date: DAY, checkOut: '17:15', role: 'Admin' });
  eq('a 15-minute overrun is within the grace and costs nothing', M.otDaily.length, 0);
  eq('...and the day still closes', (H.attendanceAudit({ date: DAY, role: 'Admin' }).rows.find(r => r.studentId === 'STD-002') || {}).status, 'DONE');
}

console.log('\n4) a day the school was shut is not 31 children who went missing');
{
  const { H } = base({ holidays: [{ Date: DAY, NameTH: 'วันหยุด', NameEN: 'Holiday' }] });
  const d = H.attendanceAudit({ date: DAY, role: 'Admin' });
  eq('the day is flagged closed', [d.closed, d.closedAllDay], [true, true]);
  ok_('...and the rows are still there to look at, not hidden', d.rows.length === 4);
}
{
  const { H } = base({ holidays: [{ Date: DAY, NameTH: 'ซ้อมดับเพลิง', StartTime: '08:00', EndTime: '12:30' }] });
  const d = H.attendanceAudit({ date: DAY, role: 'Admin' });
  eq('half a day says so, and hands over the window', [d.closedAllDay, d.holiday.start, d.holiday.end], [false, '08:00', '12:30']);
}

console.log('\n5) a withdrawn or paused child is not on anybody\'s list');
{
  const kids = KIDS.concat([
    { StudentID: 'STD-090', Nickname: 'ลาออก', NameTH: 'X', Class: 'Nursery 1', Status: 'WITHDRAWN' },
    { StudentID: 'STD-091', Nickname: 'พัก', NameTH: 'Y', Class: 'Nursery 1', Status: 'PAUSED', PauseFrom: '2026-08-01', PauseTo: '2026-09-30' }]);
  const { H } = boot({ students: kids, staff: STAFF, studentCheckins: CK });
  const ids = H.attendanceAudit({ date: DAY, role: 'Admin' }).rows.map(r => r.studentId);
  ok_('withdrawn is gone', ids.indexOf('STD-090') < 0);
  ok_('paused is gone', ids.indexOf('STD-091') < 0);
}

console.log('\n6) reading the day must never be mistaken for changing it');
{
  // the classifier both ends share: a read that queued behind the write lock is how the BUSY
  // failures on studentCheckinHistory happened
  const code = R('src/Code.gs');
  const at = code.indexOf('var MUTATING_RE'), end = code.indexOf('/** Run fn under a script lock');
  const c2 = { String, RegExp, console }; vm.createContext(c2);
  vm.runInContext(code.slice(at, end) + '\nthis.f = isMutatingAction_;', c2);
  eq('attendanceAudit is a read', c2.f('attendanceAudit'), false);
  eq('...and editStudentAttendance is still a write', c2.f('editStudentAttendance'), true);
  eq('editHoliday is a write', c2.f('editHoliday'), true);
}

console.log('\n7) วันหยุด: correcting one, in place');
{
  const { H, M } = boot({ holidays: [{ Date: '2026-08-19', NameTH: 'ซ้อมดับเพลิง', NameEN: 'Fire drill', StartTime: '08:00', EndTime: '12:30' }] });
  H.editHoliday({ date: '2026-08-19', nameTH: 'ซ้อมดับเพลิง', newDate: '2026-08-20', newNameTH: 'ซ้อมอพยพ', newNameEN: 'Evacuation drill', startTime: '09:00', endTime: '11:00' });
  eq('there is still exactly ONE holiday — it was corrected, not replaced', M.holidays.length, 1);
  eq('...on the new date, with the new name and the new window',
    [M.holidays[0].Date, M.holidays[0].NameTH, M.holidays[0].NameEN, M.holidays[0].StartTime, M.holidays[0].EndTime],
    ['2026-08-20', 'ซ้อมอพยพ', 'Evacuation drill', '09:00', '11:00']);
}
{
  const { H, M } = boot({ holidays: [{ Date: '2026-08-19', NameTH: 'ซ้อมดับเพลิง', StartTime: '08:00', EndTime: '12:30' }] });
  H.editHoliday({ date: '2026-08-19', nameTH: 'ซ้อมดับเพลิง', startTime: '', endTime: '' });
  eq('clearing the times turns half a day back into a whole one', [M.holidays[0].StartTime, M.holidays[0].EndTime], ['', '']);
  eq('...and the school is shut all day again', H.schoolDay({ date: '2026-08-19' }).closedAllDay, true);
}
{
  const { H, M } = boot({ holidays: [{ Date: '2026-08-19', NameTH: 'วันหยุด', NameEN: 'Holiday', StartTime: '08:00', EndTime: '12:30', Recurring: true }] });
  H.editHoliday({ date: '2026-08-19', nameTH: 'วันหยุด', newDate: '2026-08-19' });
  eq('anything you do not send is left alone',
    [M.holidays[0].NameTH, M.holidays[0].StartTime, M.holidays[0].EndTime, !!M.holidays[0].Recurring],
    ['วันหยุด', '08:00', '12:30', true]);
}
{
  const { H } = boot({ holidays: [{ Date: '2026-08-19', NameTH: 'A' }, { Date: '2026-08-20', NameTH: 'B' }] });
  throws_('a window that ends before it starts is refused', () =>
    H.editHoliday({ date: '2026-08-19', nameTH: 'A', startTime: '12:30', endTime: '08:00' }), 'เวลาสิ้นสุด');
  throws_('moving one holiday onto another day\'s holiday is refused', () =>
    H.editHoliday({ date: '2026-08-19', nameTH: 'A', newDate: '2026-08-20' }), 'มีวันหยุด');
  throws_('and editing one that is not there says so', () =>
    H.editHoliday({ date: '2026-01-01', nameTH: 'ไม่มี' }), 'ไม่พบวันหยุด');
}

console.log('\n8) the screens are wired to all of it');
{
  ok_('Admin reaches it from ดำเนินการ → นักเรียน', /'ตรวจสอบการลงเวลา','A_attAudit\(\)'/.test(app));
  ok_('...and a teacher from their own tool row', /onclick="A_attAudit\(\)">🕵️/.test(app));
  ok_('the screen offers a pick-up button only on an OPEN day', /r\.status==='OPEN'\?`<button[^`]*A_attPunch\('\$\{esc\(r\.studentId\)\}','OUT'\)/.test(app));
  ok_('...and an arrival button when nothing was logged', /r\.status==='NONE'\?`<button[^`]*A_attPunch\('\$\{esc\(r\.studentId\)\}','IN'\)/.test(app));
  ok_('the time field is NOT pre-filled on a past day', /value="\$\{isToday\?esc\(nowTime\(\)\):''\}"/.test(app));
  ok_('...and the reason why is written down', /a default of 18:47\s*\n\s*\* silently bills a family for OT they did not incur/.test(app));
  ok_('saving goes through the shared editStudentAttendance', /A_attPunchSave[\s\S]{0,600}api\('editStudentAttendance'/.test(app));
  ok_('an Observer gets no buttons', /const canEdit=USER&&USER\.role!=='Observer'/.test(app));
  ok_('a holiday row has an edit button', /A_editHoliday\('\$\{esc\(h\.Date\)\}'/.test(app));
  ok_('...and the edit form can clear the window', /ehStart'\)\.value='';document\.getElementById\('ehEnd'\)\.value=''/.test(app));
}

console.log('\n9) the parent\'s side: pay, and be thanked for what you actually did');
{
  ok_('the button no longer names only one way to pay', !/ถัดไป: สแกน QR แล้วแนบสลิป/.test(app));
  ok_('...it just says "pay"', /id="pickNext"[^`]*💳 \$\{EN\(\)\?'Pay':'ชำระ'\}/.test(app));
  ok_('the thank-you knows how the money arrived', /window\.P_thanks=\(amount, outstanding, method\)=>/.test(app));
  ok_('cash is promised a confirmation of the amount RECEIVED', /ยืนยันยอดเงินสดที่ได้รับในระบบโดยเร็วที่สุด/.test(app));
  ok_('...and a slip is still promised a check', /ได้รับสลิปของคุณเรียบร้อยแล้ว/.test(app));
  eq('both cash paths say cash', (app.match(/P_thanks\([^)]*,'cash'\)/g) || []).length, 2);
  ok_('and a slip path still passes no method', /P_thanks\(amt, out\);|P_thanks\(r\.total,0\);/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
