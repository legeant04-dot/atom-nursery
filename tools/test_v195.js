/**
 * tools/test_v195.js — transfer date stated by the parent, leave blocking check-in,
 * milk feed times, and who may edit the monthly menu.
 *   node tools/test_v195.js
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1', SchoolName: 'Atom Nursery',
      LeaveQuota: {}, OTRatePerHour: 100, OTGraceMinutes: 21 },
    students: [{ StudentID: 'STD-01', NameTH: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1',
      Plan: 'p1', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' },
            { StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', Classes: 'Nursery 1' },
            { StaffID: 'STF-K', NameTH: 'ครูครัว', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', CanFoodMenu: 'YES' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'พ่อ', StudentID: 'STD-01', LineUID: 'U1' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T' }],
    foodItems: [], foodMenus: [], surveys: [], surveyResponses: [],
    userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }],
    growthRecords: [], assessments: [], dspmCriteria: [], journals: [],
    payments: [{ BillingID: 'BL-1', StudentID: 'STD-01', Month: MONTH, Amount: 6900, Status: 'UNPAID' }],
    prepayments: [], studentCharges: [], paymentSlips: [], otDaily: [],
    otRecords: [], payroll: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], leaveUsed: {}, announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: [], workSchedule: [], holidays: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) The parent states when they really transferred');
{
  const { M, H } = fresh();
  H.uploadSlip({ billingId: 'BL-1', slipAmount: 6900, slipName: 'a.jpg',
    statedDate: '2026-08-05', statedTime: '19:42' });
  const s = M.paymentSlips[0];
  eq('the stated date is kept', s.StatedDate, '2026-08-05');
  eq('and the time', s.StatedTime, '19:42');
  ok_('separately from a bank-verified TransDate, which is still empty here', !s.TransDate);
  ok_('and separately from when the file arrived', !!s.SubmittedDate);
}
{
  const { M, H } = fresh();
  H.uploadSlip({ billingId: 'BL-1', slipAmount: 6900, slipName: 'a.jpg' });
  eq('a parent who states nothing stores nothing', [M.paymentSlips[0].StatedDate, M.paymentSlips[0].StatedTime], ['', '']);
}
{
  const { H } = fresh();
  H.uploadSlip({ billingId: 'BL-1', slipAmount: 6900, slipName: 'a.jpg', statedDate: '2026-08-05', statedTime: '19:42' });
  const list = H.paymentSlips({ studentId: 'STD-01' }) || [];
  const row = list.find(x => x.SlipID) || list[0];
  eq('the stated time reaches the screen', [row.StatedDate, row.StatedTime], ['2026-08-05', '19:42']);
}
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('the parent is asked for it when attaching', /id="slipDate"/.test(app) && /id="slipTime"/.test(app));
  ok_('a slip-read time is labelled as read from the slip', /อ่านจากสลิป/.test(app));
  ok_('and a stated one as the parent\'s own word — never presented as verified', /ผู้ปกครองแจ้ง/.test(app));
  const ps = fs.readFileSync(path.join(__dirname, '..', 'src', 'PaySlips.gs'), 'utf8');
  ok_('the live route stores it too', /StatedDate: statedDate, StatedTime: statedTime/.test(ps));
  ok_('...in columns it creates on demand', /ensureColumns_\(sh0, \[[^\]]*'StatedDate', 'StatedTime'\]/.test(ps));
}

console.log('\n2) A child reported away cannot be checked in');
{
  const { M, H } = fresh();
  M.studentLeaves.push({ LeaveID: 'SL-1', StudentID: 'STD-01', Date: TODAY, Type: 'ลาป่วย', Reason: 'เป็นไข้' });
  throws_('the teacher is stopped, not left to contradict the leave', () =>
    H.staffStudentCheckin({ staffId: 'STF-T', studentId: 'STD-01', type: 'IN', time: '08:10', remark: 'แม่มาส่ง' }), 'ON_LEAVE');
  eq('and nothing was written', M.checkinStudent.length, 0);
}
{
  const { M, H } = fresh();
  M.studentLeaves.push({ LeaveID: 'SL-1', StudentID: 'STD-01', Date: TODAY, Type: 'ลากิจ', Reason: '' });
  const cl = H.classList({ staffId: 'STF-T' });
  const kid = cl.students.find(s => s.StudentID === 'STD-01');
  eq('the class list shows them as on leave', [kid.onLeave, kid.attStatus], [true, 'LEAVE']);
  eq('with the type, even when no reason was given', [kid.leaveType, kid.leaveReason], ['ลากิจ', '']);
}
{
  const { M, H } = fresh();
  M.studentLeaves.push({ LeaveID: 'SL-1', StudentID: 'STD-01', Date: TODAY, Type: 'ลาป่วย', Reason: 'เป็นไข้' });
  const kid = H.classList({ staffId: 'STF-T' }).students.find(s => s.StudentID === 'STD-01');
  eq('and with the reason when there is one', [kid.leaveType, kid.leaveReason], ['ลาป่วย', 'เป็นไข้']);
}
{
  const { M, H } = fresh();
  M.studentLeaves.push({ LeaveID: 'SL-1', StudentID: 'STD-01', Date: '2020-01-01', Type: 'ลาป่วย' });
  const kid = H.classList({ staffId: 'STF-T' }).students.find(s => s.StudentID === 'STD-01');
  eq('a leave on another day does not block today', kid.onLeave, false);
  ok_('and check-in works', !!H.staffStudentCheckin({ staffId: 'STF-T', studentId: 'STD-01', type: 'IN', time: '08:10', remark: 'แม่มาส่ง' }));
}
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('the check-in button is disabled for a child on leave', /s\.onLeave[\s\S]{0,200}disabled/.test(app));
  ok_('and the card says the type and reason instead', /s\.leaveType[\s\S]{0,80}s\.leaveReason/.test(app));
  const ck = fs.readFileSync(path.join(__dirname, '..', 'src', 'Checkin.gs'), 'utf8');
  ok_('the LIVE route refuses too — the UI is only courtesy', /ON_LEAVE/.test(ck));
  ok_('and a real error is not swallowed by its own try/catch', /if \(e && e\.apiCode === 'ON_LEAVE'\) throw e/.test(ck));
}
{
  // it already appears in the child's calendar — this asserts the wiring is still there
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('the calendar is passed the student leaves', /calendarWidget\(cal, ci, planEndOf\(k0\), sl\)/.test(app));
  ok_('and marks the days they fall on', /studentLeaves\.forEach\(l=>\{ const d=new Date\(l\.Date\)/.test(app));
}

console.log('\n3) Milk: how many, and at what times');
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('the teacher can enter the feed times', /id="jMilkTimes"/.test(app));
  ok_('they are sent with the journal', /MilkTimes:milkTimes/.test(app));
  ok_('a typo is dropped rather than stored', /\/\^\\d\{1,2\}:\\d\{2\}\$\//.test(app));
  ok_('and the parent sees them next to the count', /jMilkTimes\(j\)[\s\S]{0,200}mt\.join/.test(app));
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8');
  ok_('MilkTimes is a real journal column', /DAILY_JOURNAL:[^\]]*MilkTimes/.test(cfg));
  const jr = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  ok_('...saved as a journal field', /JOURNAL_FIELDS = \[[^\]]*'MilkTimes'/.test(jr));
  ok_('...with the column created on write', /ensureColumns_\(sheet, \[[^\]]*'MilkTimes'\]/.test(jr));
}
{
  const { M, H } = fresh();
  // the journal may only be written once the child is actually here (existing rule)
  M.studentAttendanceToday.push({ StudentID: 'STD-01', Status: 'IN', Time: '08:00' });
  H.submitJournal({ studentId: 'STD-01', staffId: 'STF-T', submit: false, Mood: 'ร่าเริง',
    Milk: 3, MilkUnit: 'box', MilkTimes: ['09:00', '12:30', '15:00'] });
  const j = M.journals.find(x => x.StudentID === 'STD-01' && String(x.Date).slice(0, 10) === TODAY);
  eq('three feeds, with their times', j.MilkTimes, ['09:00', '12:30', '15:00']);
}

console.log('\n4) The monthly menu: weekends, holidays, and who may edit it');
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  ok_('weekend rows are dropped from the editor', /fmDays\(FM_MONTH\)\.filter\(ds=>!fmWeekend\(ds\)\)/.test(app));
  ok_('a holiday is shown by NAME instead of an input row', /hol\[ds\][\s\S]{0,200}วันหยุด/.test(app));
  ok_('the admin can put a teacher in charge', /id="sf_CanFoodMenu"/.test(app));
  ok_('and it is saved on the staff record', /CanFoodMenu:canFood\?'YES':''/.test(app));
  ok_('that teacher gets the screen on their own home page', /canFood\?[\s\S]{0,120}A_foodMenu\(\)/.test(app));
  const st = fs.readFileSync(path.join(__dirname, '..', 'src', 'Staff.gs'), 'utf8');
  ok_('the column is created on the staff sheet', /'CanClassOrg', 'CanFoodMenu'/.test(st));
}
{
  const { H } = fresh();
  ok_('the kitchen teacher may save the menu', !!H.saveFoodMenu({ staffId: 'STF-K', className: 'Nursery 1', month: MONTH,
    days: [{ date: MONTH + '-03', lunch: 'ข้าวผัด' }] }));
  throws_('a teacher without the flag may not', () =>
    H.saveFoodMenu({ staffId: 'STF-T', className: 'Nursery 1', month: MONTH, days: [] }), 'NO_PERMISSION');
  ok_('and the admin still may', !!H.saveFoodMenu({ staffId: 'STF-A', className: 'Nursery 1', month: MONTH, days: [] }));
  throws_('a parent still may not', () =>
    H.saveFoodMenu({ className: 'Nursery 1', month: MONTH, days: [] }), 'NO_PERMISSION');
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
