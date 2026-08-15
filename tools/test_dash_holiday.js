/**
 * tools/test_dash_holiday.js — nobody is ABSENT on a day the school is shut.
 *   node tools/test_dash_holiday.js
 *
 * THE BUG THIS EXISTS FOR (reported 2026-08-15): the Admin dashboard's "การมาเรียนแต่ละชั้น" card
 * showed 0% and listed all 31 children as ขาด — on a holiday.
 *
 * The cause is the one v234 already fixed once, in a place it had been copied to: the dashboard
 * worked out for ITSELF whether the school was open —
 *     _closed = (weekend || holiday) && !bigCleaning
 * — which is the STAFF's question. On a Big Cleaning day it answered "open" for the children too,
 * so every child who (correctly) never turned up was counted absent.
 *
 * The fix is not another flag on the client. The server already answers both halves; it now sends
 * the answer WITH the dashboard, and the two cards ask different halves of it:
 *     the children's card -> closedForStudents      the staff card -> closed
 * Anything that re-derives this from holidays/bigCleaning on the client is the bug coming back.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1,Nursery 2' },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: [], otRecords: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  return { H, M };
}
const today = new Date().toISOString().slice(0, 10);
const kids = [
  { StudentID: 'C1', NameTH: 'คานะ', Nickname: 'คานะ', Class: 'Nursery 1', Status: 'ACTIVE' },
  { StudentID: 'C2', NameTH: 'ธันวา', Nickname: 'ธันวา', Class: 'Nursery 1', Status: 'ACTIVE' },
  { StudentID: 'C3', NameTH: 'กัปตัน', Nickname: 'กัปตัน', Class: 'Nursery 2', Status: 'ACTIVE' }
];
const teachers = [{ StaffID: 'S1', NameTH: 'ครูเอ', Role: 'Teacher', Status: 'ACTIVE' }];

console.log('\n1) the dashboard carries the answer instead of leaving the screen to guess');
{
  const { H } = boot({ students: kids, staff: teachers, holidays: [{ Date: today, NameTH: 'วันแม่แห่งชาติ', NameEN: "Mother's Day" }] });
  const d = H.dashboard() || {};
  ok_('the dashboard says whether today is open at all', !!d.day);
  eq('...closed to the children on a public holiday', (d.day || {}).closedForStudents, true);
  eq('...and closed to the staff too', (d.day || {}).closed, true);
  eq('the holiday is NAMED, which is what the banner prints', (d.day || {}).reason, 'วันแม่แห่งชาติ');
  eq('...in English as well', (d.day || {}).reasonEN, "Mother's Day");
  // the roll is still reported — the screen hides the counts, it does not lose them
  eq('the classes are still there, so nothing else on the dashboard breaks', (d.classes || []).length, 2);
}
{
  // THE REPORTED CASE: a holiday that is ALSO a Big Cleaning day. Staff work it, children do not.
  const { H } = boot({ students: kids, staff: teachers,
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [today], Departments: 'Nursery 1,Nursery 2' },
    holidays: [{ Date: today, NameTH: 'วันแม่แห่งชาติ', NameEN: "Mother's Day" }] });
  const day = (H.dashboard() || {}).day || {};
  eq('a Big Cleaning day is a WORKING day for the staff', day.closed, false);
  eq('...and is still shut to the children — this is what the card got wrong', day.closedForStudents, true);
  eq('...and says it is a Big Cleaning day, so the banner can explain the difference', day.bigCleaning, true);
  ok_('...with the hours the staff actually work it to', !!day.bcIn && !!day.bcOut);
  // the old client rule, spelled out, to show what it would have answered
  const oldRule = ((day.weekend || true) && !day.bigCleaning);
  eq('the rule the dashboard used to apply would have called this day OPEN', oldRule, false);
}
{
  const { H } = boot({ students: kids, staff: teachers });
  const day = (H.dashboard() || {}).day || {};
  const g = new Date().getDay(), weekend = (g === 0 || g === 6);
  eq('an ordinary working day is open to everyone', [day.closed, day.closedForStudents], [weekend, weekend]);
}
{
  // schoolDay and dashboard must agree — they are now the same function, and this is what proves it
  const { H } = boot({ students: kids, staff: teachers,
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [today], Departments: 'Nursery 1' } });
  const a = H.schoolDay({}), b = (H.dashboard() || {}).day || {};
  eq('the two handlers give byte-identical answers', JSON.stringify(a), JSON.stringify(b));
  ok_('...because there is only one of them', /const schoolDayFor_ = d => \{/.test(eng));
  ok_('schoolDay just hands it out', /schoolDay: p => schoolDayFor_\(\(p&&p\.date\)\|\|todayLocal\(\)\),/.test(eng));
  ok_('...and so does the dashboard', /day: schoolDayFor_\(todayLocal\(\)\)\}; \},/.test(eng));
}

console.log('\n2) the Admin dashboard asks, and asks the RIGHT half');
{
  const scr = app.slice(app.indexOf('const _day=d.day||{};'), app.indexOf("window.A_holidayOT=async"));
  ok_('the screen reads the server\'s answer', /const _day=d\.day\|\|\{\};/.test(app));
  ok_('...both halves of it', /const _closedStd=!!_day\.closedForStudents, _closedStaff=!!_day\.closed;/.test(app));
  // the exact line that caused the bug must be gone
  ok_('the client no longer works out the weekend for itself',
    !/const _dow=new Date\(\)\.getDay\(\);/.test(app));
  ok_('...nor scans the holiday list', !/_hol=\(d\.holidays\|\|\[\]\)\.find/.test(app));
  ok_('...nor undoes the closure because it is a Big Cleaning day', !/&&!_bc;/.test(app));
  ok_('the children\'s card follows the CHILDREN\'s answer', /const closedBanner=_closedStd\?/.test(app));
  ok_('the staff card follows the STAFF\'s answer', /'Staff today':'พนักงานวันนี้'\}<\/h3>\$\{_closedStaff\?/.test(app));
  ok_('...and on a Big Cleaning day it says so rather than looking like an ordinary day', /🧹 Big Cleaning<\/span>/.test(app));
  ok_('the banner explains the split — staff in, children not', /วัน Big Cleaning — พนักงานทำงาน/.test(app));
  ok_('the attendance card still prints the holiday instead of a percentage', /โรงเรียนหยุด — ไม่มีการมาเรียนวันนี้/.test(app));
  ok_('the KPI tile says หยุด rather than 0%', /_closed\?\(EN\(\)\?'Holiday':'หยุด'\)/.test(app));
}

console.log('\n3) the teacher\'s home card had the same defect');
{
  ok_('it is told what day it is', /function tcaHtml\(d, day\)\{/.test(app));
  ok_('...and is given the answer the screen already fetched', /tcaHtml\(tca,day0\)/.test(app));
  ok_('on a closed day it says so instead of listing the class as absent',
    /if\(day&&day\.closedForStudents\) return `<div class="card">[\s\S]{0,400}วันนี้โรงเรียนหยุด/.test(app));
  ok_('...and offers no check-in-on-behalf button the server would refuse',
    /closedForStudents\) return[\s\S]{0,500}ไม่มีการรับ-ส่งนักเรียน[\s\S]{0,40}<\/div>`;/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
