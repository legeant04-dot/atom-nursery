/**
 * tools/test_ops_month.js — the ⏰ tools moved to ดำเนินการ, and a month of working time per teacher.
 *   node tools/test_ops_month.js
 *
 * The number that must never be wrong here is ABSENT. A weekend, a holiday, or a day before someone
 * started is not an absence, and a teacher who reads as absent on their first payslip has to be
 * explained to. So the month is built day by day and each kind of day is pinned.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('webapp/app.js'), code = R('src/Code.gs'), ge = R('src/GasEngine.gs');

// ---- boot the engine on a small school, with "today" pinned -----------------------------------
// August 2026: the 1st is a Saturday, so 1/2, 8/9, 15/16, 22/23, 29/30 are weekends.
const TODAY = '2026-08-10';   // a Monday
function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, Departments: 'Nursery 1', BigCleaningDays: '' },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paySlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], classes: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  // pin "today" so the month under test never drifts with the real clock
  ctx.Date = class extends Date { constructor(...a){ if(!a.length) super(TODAY+'T09:00:00'); else super(...a); } static now(){ return new Date(TODAY+'T09:00:00').getTime(); } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const ADMIN = { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', RequireCheckin: false };
const teacher = (id, over) => Object.assign({ StaffID: id, NameTH: id, Nickname: id, Role: 'Teacher', Status: 'ACTIVE', RequireCheckin: true }, over || {});
const dayOf = (s, d) => s.days.find(x => x.date === d);

console.log('\n1) A month of working time, day by day');
{
  const H = boot({
    staff: [ADMIN, teacher('ครูเอ', { StartDate: '2026-01-01' })],
    holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }],
    staffAttendanceHistory: [
      { Date: '2026-08-03', StaffID: 'ครูเอ', In: '07:55', Out: '17:05', Late: 0, OTHours: 0 },
      { Date: '2026-08-04', StaffID: 'ครูเอ', In: '08:20', Out: '17:00', Late: 20, OTHours: 0 },
      { Date: '2026-08-05', StaffID: 'ครูเอ', In: '07:50', Out: '18:30', Late: 0, OTHours: 1.5 }
    ]
  });
  const r = H.staffAttendanceMonth({ month: '2026-08', staffId: 'ADM' });
  eq('the month asked for', r.month, '2026-08');
  eq('every day of August', r.daysInMonth, 31);
  eq('the admin is not in the list — they do not log time', r.staff.map(s => s.staffId), ['ครูเอ']);
  const s = r.staff[0];
  eq('...and neither is anyone else', s.days.length, 31);

  eq('a worked day keeps its times', [dayOf(s,'2026-08-03').in, dayOf(s,'2026-08-03').out], ['07:55','17:05']);
  eq('a late day keeps the minutes RECORDED that day', dayOf(s,'2026-08-04').late, 20);
  eq('OT is carried too', dayOf(s,'2026-08-05').otHours, 1.5);
  eq('Saturday is not an absence', dayOf(s,'2026-08-01').status, 'OFF');
  eq('nor Sunday', dayOf(s,'2026-08-02').status, 'OFF');
  eq('a public holiday is not an absence', dayOf(s,'2026-08-12').status, 'HOLIDAY');
  eq('...and it says which holiday', dayOf(s,'2026-08-12').holiday, 'วันแม่');
  eq('a working day with no check-in IS an absence', dayOf(s,'2026-08-06').status, 'ABSENT');
  eq('a day still to come is not an absence', dayOf(s,'2026-08-31').status, 'FUTURE');

  eq('present days', s.present, 3);
  eq('late days', s.lateDays, 1);
  eq('total minutes late', s.lateMinutes, 20);
  eq('OT hours', s.otHours, 1.5);
  // elapsed working days are 3,4,5,6,7 (the 10th is today, which is not over) minus the three
  // worked → the 6th and the 7th
  eq('absent days counts only FINISHED working days', s.absent, 2);
  eq('...and today is not one of them', dayOf(s,'2026-08-10').status, 'TODAY');
}

console.log('\n2) Leave is leave, not absence');
{
  const H = boot({
    staff: [ADMIN, teacher('ครูบี', { StartDate: '2026-01-01' })],
    leaves: [
      { LeaveID: 'L1', StaffID: 'ครูบี', Type: 'ลาป่วย', StartDate: '2026-08-03', EndDate: '2026-08-05', Status: 'APPROVED', Days: 3, Reason: 'ไข้' },
      { LeaveID: 'L2', StaffID: 'ครูบี', Type: 'ลากิจ', StartDate: '2026-08-06', EndDate: '2026-08-06', Status: 'APPROVED', Days: 0.5, HalfDay: 'AM' },
      { LeaveID: 'L3', StaffID: 'ครูบี', Type: 'ลาพักร้อน', StartDate: '2026-08-07', EndDate: '2026-08-07', Status: 'PENDING_ADMIN', Days: 1 }
    ]
  });
  const s = H.staffAttendanceMonth({ month: '2026-08', staffId: 'ADM' }).staff[0];
  eq('a multi-day leave marks EVERY day in the range', ['2026-08-03','2026-08-04','2026-08-05'].map(d=>dayOf(s,d).status), ['LEAVE','LEAVE','LEAVE']);
  eq('...with the type, so the calendar can say what kind', dayOf(s,'2026-08-03').leaveType, 'ลาป่วย');
  eq('a half day is marked as half', dayOf(s,'2026-08-06').leaveHalf, 'AM');
  eq('half days count as 0.5, matching the entitlement', s.leaveDays, 3.5);
  // a leave still awaiting approval has not happened yet
  eq('an UNAPPROVED leave is not treated as leave', dayOf(s,'2026-08-07').status, 'ABSENT');
  // Aug 7 is the only elapsed working day with neither leave nor a check-in; today (the 10th) is
  // not counted because the day is not over.
  eq('and none of the approved leave counts as absence', s.absent, 1);
  eq('today is its own kind of day, not an absence', dayOf(s,'2026-08-10').status, 'TODAY');
}

console.log('\n3) Before someone starts, they are not part of the month');
{
  const H = boot({ staff: [ADMIN, teacher('ครูฟาง', { StartDate: '2026-08-13' })] });   // starts after today
  const s = H.staffAttendanceMonth({ month: '2026-08', staffId: 'ADM' }).staff[0];
  eq('the days before the first are their own kind of day', dayOf(s,'2026-08-03').status, 'BEFORE');
  eq('NOT absences — this is what would appear on a first payslip', s.absent, 0);
  eq('the start date is shown so the reader knows why', s.startDate, '2026-08-13');
  eq('and their first day is not marked absent either', dayOf(s,'2026-08-13').status, 'FUTURE');
}
{
  // someone who has LEFT keeps their history but is off the working list
  const H = boot({ staff: [ADMIN, teacher('ครูเก่า', { Status: 'INACTIVE', EndDate: '2026-07-31' })] });
  eq('a staff member who has left is not listed', H.staffAttendanceMonth({ month: '2026-08', staffId: 'ADM' }).staff.length, 0);
}

console.log('\n4) Only an admin (or a read-only Observer) may read everyone’s time');
{
  const H = boot({ staff: [ADMIN, teacher('ครูซี'), teacher('ผู้ตรวจ', { Role: 'Observer' })] });
  let denied = false;
  try { H.staffAttendanceMonth({ month: '2026-08', staffId: 'ครูซี' }); } catch (e) { denied = /แอดมิน/.test(e.message); }
  ok_('a teacher cannot read the whole staff’s working time', denied);
  ok_('an admin can', !!H.staffAttendanceMonth({ month: '2026-08', staffId: 'ADM' }).staff);
  ok_('an Observer can too — it is a read', !!H.staffAttendanceMonth({ month: '2026-08', staffId: 'ผู้ตรวจ' }).staff);
  ok_('and it is admin-only at the route as well', /staffAttendanceMonth: 1/.test(code));
}

console.log('\n5) The figures come from what was recorded, not recomputed');
{
  // CHECKIN_STAFF stores LateMinutes/OTHours against THAT day's schedule (a Big Cleaning day has its
  // own hours). The projection used to drop them, forcing any report to guess the schedule backwards.
  ok_('the daily late/OT figures survive hydration', /Late: Number\(r\.LateMinutes\) \|\| 0, OTHours: Number\(r\.OTHours\) \|\| 0/.test(ge));
  ok_('the engine reads them rather than recalculating', /lt=Number\(h\.Late\|\|0\); oth=Number\(h\.OTHours\|\|0\)/.test(R('webapp/engine.js')));
  ok_('the built Engine.gs carries the new handler', /staffAttendanceMonth/.test(R('src/Engine.gs')));
}

console.log('\n6) The ⏰ tools moved to ดำเนินการ, split teacher / student');
{
  ok_('they are gone from the จัดการ menu', !/'⏰ เวลา & OT', items:/.test(app));
  const i = app.indexOf("SCREENS.Admin.leaves = async");
  const screen = app.slice(i, app.indexOf('window.A_lvMain=', i));
  const stu = screen.slice(screen.indexOf("if(LV_MAIN==='student')"), screen.indexOf('return;'));
  const tea = screen.slice(screen.indexOf('const [all,staff]'));
  ok_('student tab offers the student OT tool', /A_studentOT\(\)/.test(stu));
  ok_('...and only that one', !/A_staffOT\(\)|A_timeRequests\(\)/.test(stu));
  ok_('teacher tab offers staff OT', /A_staffOT\(\)/.test(tea));
  ok_('...the time-request approvals', /A_timeRequests\(\)/.test(tea));
  ok_('...the class-change requests', /A_classChanges\(\)/.test(tea));
  ok_('...and the new monthly work time', /A_staffMonth\(\)/.test(tea));
  ok_('the student OT tool is NOT on the teacher tab', !/A_studentOT\(\)/.test(tea));
  // t('ot.adminOT') already begins with ⏰ — printing another one read "⏰ ⏰ OT คุณครู"
  ok_('a label that already has an icon does not get a second one', /const dup=L\.slice\(0,3\)\.indexOf\(ic\)>=0/.test(app));
}

console.log('\n7) The screen shows the overview AND the detail behind it');
{
  ok_('an overview row per teacher', /window\.A_staffMonth = async/.test(app));
  ok_('with the month selectable', /A_staffMonth\(this\.value\)/.test(app));
  ok_('totals across the school', /วันมาทำงาน[\s\S]{0,200}วันขาด/.test(app));
  ok_('tapping a teacher opens their day-by-day month', /A_staffMonthOne\(/.test(app));
  { const j=app.indexOf('window.A_staffMonthOne = (sid)');
    const one=app.slice(j, app.indexOf('\n  };', j));
    ok_('drawn as a calendar', /<div class="cal">/.test(one));
    ok_('...with a blank for each day before the 1st falls', /for\(let i=0;i<first;i\+\+\)/.test(one)); }
  ok_('each day shows the times worked', /r\.status==='IN' \?[\s\S]{0,160}esc\(r\.in\|\|''\)/.test(app));
  ok_('...how late, when late', /EN\(\)\?'late':'สาย'\} \$\{r\.late\}′/.test(app));
  ok_('...and the kind of leave, when on leave', /esc\(r\.leaveType\|\|'ลา'\)/.test(app));
  ok_('a back-dated time entry is marked, so it is not mistaken for a normal one', /r\.manual\?'<br>✍️':''/.test(app));
  ok_('there is a legend, because the colours mean things', /เขียว = มาทำงาน/.test(app));
  ok_('teachers are listed in the app’s one alphabetical order', /sortPeopleD\(d\.staff\|\|\[\]\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
