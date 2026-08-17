/**
 * tools/test_schedule_finance.js — the teacher's own records find their proper homes.
 *   node tools/test_schedule_finance.js
 *
 *   · work history and leave history move OFF the home screen into 📅 ตาราง, each folded shut with
 *     a filter — a month is thirty rows, and the home screen is what you do this morning
 *   · the "สลิป" tab becomes 💵 การเงิน and takes the OT history with it: an OT record is money
 *     owed to this person, so it belongs behind the same password as the payslip
 *   · a teacher may read their OWN month; everyone else's is still admin business
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), i18n = R('webapp/i18n.js');

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, LateGraceMinutes: 0, BigCleaningDays: [] },
    staff: [
      { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', PositionLevel: 'Officer', StartDate: '2025-01-01' },
      { StaffID: 'T2', NameTH: 'ครูบี', Role: 'Teacher', PositionLevel: 'Officer', StartDate: '2025-01-01' },
      { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', StartDate: '2025-01-01' }
    ],
    workSchedule: [{ StaffID: 'T1', CheckInTime: '08:00', CheckOutTime: '17:00' }],
    staffAttendanceHistory: [
      { StaffID: 'T1', Date: '2026-07-01', In: '08:00', Out: '17:00', Late: 0 },
      { StaffID: 'T1', Date: '2026-07-02', In: '08:20', Out: '17:05', Late: 20 },
      { StaffID: 'T2', Date: '2026-07-01', In: '07:55', Out: '17:00', Late: 0 }
    ],
    staffAttendanceToday: [],
    leaves: [
      { LeaveID: 'LV1', StaffID: 'T1', Type: 'ลาป่วย', StartDate: '2026-07-06', EndDate: '2026-07-06', Days: 1, Status: 'APPROVED' },
      { LeaveID: 'LV2', StaffID: 'T1', Type: 'ลากิจ', StartDate: '2026-07-20', EndDate: '2026-07-20', Days: 1, Status: 'PENDING_LEADER' }
    ],
    students: [], parents: [], userLinks: [], payments: [], otDaily: [], studentCharges: [], prepayments: [],
    paymentSlips: [], checkinStudent: [], journals: [], comments: [], holidays: [], staffGroups: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], attendanceReq: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [],
    studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  if (typeof H.myAttendanceMonth !== 'function') H.myAttendanceMonth = function () { return { staff: [] }; };
  return { H, M };
}
function grab(fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }

console.log('\n=== 1. a teacher can read their OWN month ===');
{
  const { H } = boot();
  const r = H.myAttendanceMonth({ staffId: 'T1', month: '2026-07' });
  eq('one person comes back — themselves', (r.staff || []).map(s => s.staffId), ['T1']);
  // a build without myAttendanceMonth must FAIL these cleanly, not crash the run
  const me = r.staff[0] || { days: [], present: -1, lateDays: -1, lateMinutes: -1, leaveDays: -1 };
  eq('the days of the month are all there', me.days.length, 31);
  eq('worked days are counted', me.present, 2);
  eq('…and the late one is flagged', me.lateDays, 1);
  eq('…with the minutes', me.lateMinutes, 20);
  eq('approved leave counts as leave', me.leaveDays, 1);
  const d2 = me.days.find(d => d.date === '2026-07-02') || {};
  eq('a day carries the real times', [d2.in, d2.out, d2.late], ['08:20', '17:05', 20]);
  eq('a leave day says which kind', (me.days.find(d => d.date === '2026-07-06') || {}).leaveType, 'ลาป่วย');
}
{
  const { H } = boot();
  ok_('…and still cannot read anyone else’s',
    /NO_PERMISSION|เฉพาะแอดมิน/.test(grab(() => H.staffAttendanceMonth({ staffId: 'T1', month: '2026-07' })) || ''));
  const admin = H.staffAttendanceMonth({ staffId: 'A1', month: '2026-07' });
  ok_('an admin still sees the whole staff', (admin.staff || []).length >= 2);
  const self = H.myAttendanceMonth({ staffId: 'T2', month: '2026-07' });
  eq('another teacher gets their own, not T1’s', (self.staff || []).map(s => s.staffId), ['T2']);
}
{
  const { H, M } = boot();
  M.staff[0].RequireCheckin = false;
  eq('someone exempt from clocking in still gets their own month',
    (H.myAttendanceMonth({ staffId: 'T1', month: '2026-07' }).staff || []).length, 1);
}
ok_('the guard names the exception rather than hiding it', /onlySelf narrows this to the caller/.test(eng));

console.log('\n=== 2. the histories live in 📅 ตาราง, folded and filtered ===');
ok_('work history is a fold-out section', /<details class="card" id="myAttBox">/.test(app));
ok_('leave history is a fold-out section', /<details class="card" id="myLvBox">/.test(app));
ok_('…both shut by default (no `open`)',
  !/id="myAttBox" open/.test(app) && !/id="myLvBox" open/.test(app));
ok_('the work history is filtered by month', /id="mhMonth"[^>]*onchange="T_myHistory\(this\.value\)"/.test(app));
['worked', 'late', 'leave', 'absent'].forEach(f =>
  ok_('…and by "' + f + '"', new RegExp('<option value="' + f + '">').test(app)));
['pending', 'approved', 'rejected'].forEach(f =>
  ok_('leave history filters by "' + f + '"', new RegExp('<option value="' + f + '">').test(app)));
ok_('the month is summarised before the rows', /worked':'มาทำงาน'\} \$\{me\.present\|\|0\}/.test(app));
ok_('the filters are real functions, not markup', /window\.T_myHistoryFilter=\(\)=>/.test(app) && /window\.T_myLeaveFilter=\(\)=>/.test(app));

console.log('\n=== 3. the home screen gave them up ===');
{
  const start = app.indexOf('SCREENS.Teacher.home');
  const home = app.slice(start, app.indexOf('SCREENS.Teacher.class', start));
  ok_('the recent-days list is gone from home', home.indexOf("lbl.recentDays") < 0);
  ok_('the leave list is gone from home', home.indexOf("setHTML('#ml'") < 0);
  ok_('the OT list is gone from home', home.indexOf("setHTML('#myot'") < 0);
  ok_('…and so are the three fetches that fed them',
    home.indexOf("api('myLeaves'") < 0 && home.indexOf("api('myOT'") < 0 && home.indexOf("api('recentAttendance'") < 0);
  // v243: the school asked for the remaining-days grid to go from home too. It is a reference
  // figure, not a morning job, and it is still on the leave screen — where a teacher is actually
  // deciding whether to file one. The way IN stays here.
  ok_('the remaining-days grid is gone from home', !/class="quota"/.test(home));
  ok_('...and so is the fetch that fed it', home.indexOf("api('leaveQuota'") < 0);
  ok_('the way in to leave is still on home', /onclick="GO\('leave'\)">📩/.test(home));
  ok_('...and the figure still exists on the leave screen itself', /<h3>สิทธิคงเหลือ<\/h3><div class="quota">/.test(app));
  ok_('and there is a way through to the records', /onclick="GO\('schedule'\)">📅/.test(home));
}

console.log('\n=== 4. สลิป → การเงิน, with the OT history in it ===');
ok_('the tab is named for the subject, not the document', /'nav\.slip':\['การเงิน','Finance'\]/.test(i18n));
ok_('the screen title follows', /'title\.slip':\['💵 การเงินของฉัน','💵 My finances'\]/.test(i18n));
ok_('the role description follows too', /desc\.Teacher[^\]]*การเงิน/.test(i18n));
ok_('the hard-coded Thai heading is gone', app.indexOf('<h2 class="page">💵 เงินเดือนของฉัน</h2>') < 0);
ok_('the OT history is on the finance screen', /<details class="card" style="margin-top:10px" open>[\s\S]{0,120}ot\.myOT/.test(app));
ok_('…fetched alongside the payslip, not after it', /const p_ot=api\('myOT',\{staffId:USER\.staffId\}\)\.catch\(\(\)=>\[\]\);   \/\/ travels with the payslip fetch/.test(app));
ok_('…and it stays behind the password, because it is money', (() => {
  const s = app.indexOf('SCREENS.Teacher.slip');
  const lockReturn = app.indexOf('return; }', s);
  return app.indexOf("id=\"myot\"", s) > lockReturn;
})());
ok_('the lock screen says "pay", not "salary slip"', /ข้อมูลการเงินเป็นความลับ/.test(app));

console.log('\n=== 5. nothing else moved ===');
{
  const { H } = boot();
  eq('myLeaves still answers (the ตาราง list uses it)', H.myLeaves({ staffId: 'T1' }).length, 2);
  // today + up to three past days; this fixture has two past days
  eq('recentAttendance is untouched for anything still using it', H.recentAttendance({ staffId: 'T1' }).length, 3);
}
ok_('the ตาราง screen keeps the staffing + calendar it already had',
  /staffSchedCalendar\(d\.history/.test(app) && /lbl\.staffingByNursery/.test(app));
ok_('the payslip download is still there', /T_slipDownload\(\)/.test(app));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
