/**
 * tools/test_dspm_class.js — DSPM by class: coverage vs pass rate, and who is counted.
 *   node tools/test_dspm_class.js
 */
const path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
const TODAY = new Date().toISOString().slice(0, 10);
const yr = n => (Number(TODAY.slice(0, 4)) + n) + TODAY.slice(4);

function fresh(students, assessments) {
  const M = {
    config: { Plans: [{ id: 'p1', price: 5900, end: '17:00' }], Departments: 'Nursery Baby',
      OTRatePerHour: 100, OTGraceMinutes: 21 },
    students: students, staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [], classes: [{ ClassID: 'C1', ClassName: 'Nursery Baby', TeacherID: 'STF-A' }],
    assessments: assessments || [], dspmCriteria: [],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [],
    otRecords: [], payroll: [], userLinks: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}
const kid = (id, extra) => Object.assign({ StudentID: id, NameTH: 'น้อง' + id, Nickname: '', Class: 'Nursery Baby',
  Plan: 'p1', Status: 'ACTIVE', DOB: '2025-01-01' }, extra || {});
const rec = (sid, result, item) => ({ AssessID: sid + '-' + (item || 1), StudentID: sid, Skill: 'GM',
  ItemNo: item || 1, Result: result, Date: TODAY, AgeBand: '9' });

// ============================================================================
console.log('\n1) A class nobody has assessed reads 0%, not 100%');
{
  const { H } = fresh([kid('S1'), kid('S2'), kid('S3')]);
  const r = H.classAssessment({ className: 'Nursery Baby' });
  eq('nobody assessed', r.assessed, 0);
  eq('coverage starts at 0', r.coverage, 0);
  eq('pass rate is 0, not 100', r.passRate, 0);
  eq('all three still listed', r.studentCount, 3);
  eq('and each is flagged as not assessed', r.perStudent.map(s => s.assessed), [false, false, false]);
}

console.log('\n2) One child of six assessed no longer makes the class look finished');
{
  // the live Nursery Baby: five children untouched, one with 5 passes
  const kids = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map(id => kid(id));
  const a = [1, 2, 3, 4, 5].map(n => rec('S6', 'ผ่าน', n));
  const { H } = fresh(kids, a);
  const r = H.classAssessment({ className: 'Nursery Baby' });
  eq('coverage says 1 of 6', [r.assessed, r.studentCount, r.coverage], [1, 6, 17]);
  eq('five still to do', r.notAssessed, 5);
  eq('the pass rate of what WAS assessed is still 100', r.passRate, 100);
  eq('and the totals are visible', [r.totalPass, r.totalFail], [5, 0]);
}

console.log('\n3) Only assessed items count towards the pass rate');
{
  const { H } = fresh([kid('S1'), kid('S2')],
    [rec('S1', 'ผ่าน', 1), rec('S1', 'ไม่ผ่าน', 2), rec('S1', 'ยังไม่เข้าโรงเรียน', 3)]);
  const r = H.classAssessment({ className: 'Nursery Baby' });
  eq('"ยังไม่เข้าโรงเรียน" is skipped entirely', [r.totalPass, r.totalFail], [1, 1]);
  eq('so the rate is 1 of 2', r.passRate, 50);
  eq('the child counts as assessed', r.perStudent.find(s => s.studentId === 'S1').assessed, true);
  eq('their own rate', r.perStudent.find(s => s.studentId === 'S1').rate, 50);
  eq('the untouched child has no rate at all', r.perStudent.find(s => s.studentId === 'S2').rate, null);
}

console.log('\n4) Children who are not at school are left out of the count');
{
  const kids = [kid('S1'), kid('S2', { Status: 'PAUSED', PauseFrom: '2020-01-01' }),
    kid('S3', { EnrollDate: yr(1) }), kid('S4', { Status: 'WITHDRAWN' })];
  const { H } = fresh(kids, [rec('S1', 'ผ่าน', 1)]);
  const r = H.classAssessment({ className: 'Nursery Baby' });
  eq('only the one child who is actually here', r.studentCount, 1);
  eq('assessed 1 of 1 → 100% coverage', [r.assessed, r.coverage], [1, 100]);
  eq('and the two set aside are explained', r.skipped, 2);   // paused + not started (withdrawn is gone entirely)
  eq('neither appears in the list', r.perStudent.map(s => s.studentId), ['S1']);
}

console.log('\n5) A fully assessed class reads what it really is');
{
  const { H } = fresh([kid('S1'), kid('S2')],
    [rec('S1', 'ผ่าน', 1), rec('S1', 'ผ่าน', 2), rec('S2', 'ผ่าน', 1), rec('S2', 'ไม่ผ่าน', 2)]);
  const r = H.classAssessment({ className: 'Nursery Baby' });
  eq('everyone assessed', [r.assessed, r.studentCount, r.coverage], [2, 2, 100]);
  eq('nothing outstanding', r.notAssessed, 0);
  eq('3 of 4 passed', r.passRate, 75);
}

console.log('\n6) Names carry the nickname AND the real name');
{
  const { H } = fresh([kid('S1', { NameTH: 'ธนิดา ศรีพลาย', Nickname: 'นิดา' })], [rec('S1', 'ผ่าน', 1)]);
  const s = H.classAssessment({ className: 'Nursery Baby' }).perStudent[0];
  eq('nickname', s.nick, 'นิดา');
  eq('real name kept for the sub-line', s.name, 'ธนิดา ศรีพลาย');
}

console.log('\n7) A child starting LATER THIS MONTH is not on today\'s list');
{
  // this is what made the tab say 9 and the card 11: the tab used a day rule, the card a month rule
  const later = TODAY.slice(0, 8) + '28';
  const { H } = fresh([kid('S1'), kid('S2', { EnrollDate: later })]);
  const r = H.classAssessment({ className: 'Nursery Baby' });
  eq('only the child who is already here', r.studentCount, Number(TODAY.slice(8, 10)) >= 28 ? 2 : 1);
  if (Number(TODAY.slice(8, 10)) < 28) eq('the other is set aside, with a reason', r.skipped, 1);
}

// ============================================================================
console.log('\n8) Half-day leave takes half a day of entitlement');
{
  const M = {
    config: { LeaveQuota: { 'ลาป่วย': 30, 'ลากิจ': 6, 'ลาพักร้อน': 6 }, Plans: [] },
    students: [], staff: [{ StaffID: 'T1', NameTH: 'ลินน์', Nickname: 'ลินน์', Department: 'Nursery 1', PositionLevel: 'Staff' },
      { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [], classes: [], leaves: [], assessments: [], payments: [], prepayments: [],
    studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [], userLinks: [],
    feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    staffAttendanceToday: [], activityLog: [], studentLeaves: [], comments: [], announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: [], leaveUsed: {}
  };
  const H = createAtomAPI(M).H;

  const full = H.submitLeave({ staffId: 'T1', type: 'ลาป่วย', startDate: '2026-08-10', endDate: '2026-08-10', reason: 'ไข้' });
  eq('a normal single day is 1', full.days, 1);

  const half = H.submitLeave({ staffId: 'T1', type: 'ลาป่วย', startDate: '2026-08-11', endDate: '2026-08-11', reason: 'พบแพทย์', halfDay: 'AM' });
  eq('half a day is 0.5', half.days, 0.5);
  eq('and which half is recorded', half.halfDay, 'AM');
  eq('stored on the row too', M.leaves[1].Days, 0.5);

  eq('a half day over a RANGE is refused',
    (() => { try { H.submitLeave({ staffId: 'T1', type: 'ลากิจ', startDate: '2026-08-12', endDate: '2026-08-14', halfDay: 'PM' }); return 'ALLOWED'; }
      catch (e) { return e.code; } })(), 'BAD_INPUT');
  eq('a stray value is treated as a full day',
    H.submitLeave({ staffId: 'T1', type: 'ลากิจ', startDate: '2026-08-15', endDate: '2026-08-15', halfDay: 'อะไรก็ไม่รู้' }).days, 1);

  console.log('   …and the entitlement comes out at 29.5');
  M.leaves.forEach(l => { l.Status = 'APPROVED'; });
  M.leaveUsed = M.leaves.filter(l => l.Status === 'APPROVED')
    .reduce((a, l) => { (a[l.StaffID] = a[l.StaffID] || {})[l.Type] = (a[l.StaffID][l.Type] || 0) + Number(l.Days); return a; }, {});
  const sick = H.leaveQuota({ staffId: 'T1' }).find(q => q.type === 'ลาป่วย');
  eq('used 1 + 0.5', sick.used, 1.5);
  eq('remaining 30 − 1.5', sick.remain, 28.5);

  console.log('   admin can switch an existing request to half a day');
  const ed = H.editLeave({ staffId: 'A1', leaveId: M.leaves[0].LeaveID, halfDay: 'PM' });
  eq('now 0.5', ed.Days, 0.5);
  eq('and back to a full day', H.editLeave({ staffId: 'A1', leaveId: M.leaves[0].LeaveID, halfDay: '' }).Days, 1);
}

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} checks passed`));
process.exit(fail ? 1 : 0);
