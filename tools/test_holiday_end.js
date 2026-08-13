/**
 * tools/test_holiday_end.js — nobody clocks in on a day the school is shut, and a leaving date is a
 * date, not a delete button.
 *   node tools/test_holiday_end.js
 *
 * Two rules, both of which used to be enforced in only half the places that needed them:
 *   · the dashboard greyed out a holiday and the digests skipped it, but the check-in BUTTONS still
 *     worked — so a closed day could collect attendance that then had to be explained;
 *   · an admin told on the 11th that someone leaves on the 30th could only record it by removing
 *     them from the roster immediately, for the nineteen days they were still turning up.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), checkin = R('src/Checkin.gs'),
      parent = R('src/Parent.gs'), staffGs = R('src/Staff.gs');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [] },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  // a build without schoolDay must FAIL these checks cleanly, not die on the first call
  if (typeof H.schoolDay !== 'function') H.schoolDay = () => ({ closed: null, reason: null, reasonEN: null, bigCleaning: null });
  return { H, M };
}
// 2026-08-12 is a Wednesday; 2026-08-15 a Saturday
const WED = '2026-08-12', SAT = '2026-08-15', SUN = '2026-08-16';

console.log('\n1) which days the school is shut — one answer, for every screen');
{
  const { H } = boot({ holidays: [{ Date: WED, NameTH: 'วันแม่แห่งชาติ', NameEN: "Mother's Day" }] });
  const d = H.schoolDay({ date: WED });
  eq('a public holiday is closed', d.closed, true);
  eq('...and it is NAMED, which is the thing people want to know', d.reason, 'วันแม่แห่งชาติ');
  eq('...in English too', d.reasonEN, "Mother's Day");
  eq('Saturday is closed', H.schoolDay({ date: SAT }).closed, true);
  eq('Sunday too', H.schoolDay({ date: SUN }).closed, true);
  eq('a weekend says so rather than naming a holiday it has not got', H.schoolDay({ date: SAT }).reason, 'วันหยุดสุดสัปดาห์');
  const open = boot({}).H.schoolDay({ date: WED });
  eq('an ordinary Wednesday is open', [open.closed, open.reason], [false, '']);
}
{
  // Big Cleaning is a WORKING day that happens to fall at the weekend — staff clock in on it
  const { H } = boot({ config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [SAT] } });
  const d = H.schoolDay({ date: SAT });
  eq('a Big Cleaning Saturday is NOT closed', d.closed, false);
  eq('...and says so', d.bigCleaning, true);
}

console.log('\n2) the server refuses attendance on a closed day');
{
  ok_('one helper decides it', /function assertSchoolOpen_\(d\)/.test(checkin));
  ok_('...built on the SAME isSchoolClosed_ the digests use', /if \(!isSchoolClosed_\(d\)\) return;/.test(checkin));
  ok_('a Big Cleaning day is let through', /if \(isBigCleaningDay_\(ds\)\) return;/.test(checkin));
  eq('staff check-IN and check-OUT are both guarded', (checkin.match(/assertSchoolOpen_\(\);/g) || []).length, 2);
  ok_('and the student side too', /assertSchoolOpen_\(\);/.test(parent));
  ok_('the refusal names the day, not just "no"', /วันนี้โรงเรียนหยุด \(' \+ why \+ '\)/.test(checkin));
  ok_('it is a code the client can act on', /apiError_\('SCHOOL_CLOSED'/.test(checkin));
}

console.log('\n3) the screens stop offering a button that would fail');
{
  ok_('the parent card shows the holiday instead of the buttons', /window\._SCHOOLDAY&&window\._SCHOOLDAY\.closed/.test(app));
  ok_('...naming it', /window\._SCHOOLDAY\.reason/.test(app));
  ok_('the teacher card does the same', /:\(day0&&day0\.closed\)\?/.test(app));
  ok_('...and keeps the recent-days list, which is still worth reading', /day0&&day0\.closed[\s\S]{0,700}recentRows/.test(app));
  ok_('both ask the server, rather than working it out twice', /api\('schoolDay'/.test(app));
  eq('...once on each home screen', (app.match(/api\('schoolDay'/g) || []).length, 2);
  // the teacher's copy must travel with the batch, not cost another round trip
  ok_('the teacher fetches it with the rest of the screen', /const p_day = api\('schoolDay'[\s\S]{0,400}await Promise\.all\(/.test(app));
}

console.log('\n4) the parent home screen still pairs each child with their OWN rows');
{
  // schoolDay was added to a Promise.all whose tail is one entry PER CHILD — the offsets below it
  // had to move with it, or every family's calendar shows another child's data
  const start = app.indexOf('SCREENS.Parent.home = async () => {');
  const home = app.slice(start, app.indexOf('setTopActions(', start));
  const head = home.slice(home.indexOf('const _res = await Promise.all(['), home.indexOf('...kids.map('));
  const fixed = (head.match(/api\('/g) || []).length;
  eq('seven fixed calls before the per-child ones', fixed, 7);
  ok_('and the slice starts after all seven', /_res\.slice\(7, 7\+kids\.length\)/.test(home) && /_res\.slice\(7\+kids\.length\)/.test(home));
}

console.log('\n5) a leaving date is a DATE, not a delete button');
{
  const fn = staffGs.slice(staffGs.indexOf('function handleSetStaffEnd'), staffGs.indexOf('// Staff edits their OWN record'));
  ok_('the status only flips once the day has come', /var due = end < today;/.test(fn) && /if \(due\) patch\.Status = 'INACTIVE';/.test(fn));
  ok_('the date, reason and note are always recorded', /var patch = \{ EndDate: end, EndReason: reason, EndRemark/.test(fn));
  ok_('the caller is told which of the two happened', /scheduled: !due/.test(fn));
  ok_('a scheduled leaving is logged differently from one that took effect', /STAFF_END_SCHEDULED/.test(fn));
  ok_('the row is still patched in place, never deleted', /updateRow_/.test(fn) && !/deleteRow/.test(fn));
}
{
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
  const { H } = boot({ staff: [
    { StaffID: 'S1', NameTH: 'ยังอยู่', Role: 'Teacher', Status: 'ACTIVE' },
    { StaffID: 'S2', NameTH: 'จะลาออกสิ้นเดือน', Role: 'Teacher', Status: 'ACTIVE', EndDate: future },
    { StaffID: 'S3', NameTH: 'ออกไปแล้ว', Role: 'Teacher', Status: 'ACTIVE', EndDate: past },
    { StaffID: 'S4', NameTH: 'ปิดไว้แต่เดิม', Role: 'Teacher', Status: 'INACTIVE' }
  ] });
  const by = {}; H.listStaff().forEach(s => { by[s.StaffID] = s; });
  eq('nobody with no leaving date is ended', by.S1.ended, false);
  eq('a FUTURE leaving date does not end them', by.S2.ended, false);
  eq('...but it is flagged, so the screen can say so', by.S2.endScheduled, true);
  eq('a date that has PASSED ends them, with nothing having to run that day', by.S3.ended, true);
  eq('an INACTIVE record from before this existed still counts as ended', by.S4.ended, true);
  eq('...and is not called "scheduled"', by.S4.endScheduled, false);
  eq('today itself is still a working day', boot({ staff: [{ StaffID: 'S5', Role: 'Teacher', EndDate: today }] }).H.listStaff()[0].ended, false);
}
{
  // clocking in is guarded at BOTH ends of the employment, and only after the last day has passed
  ok_('the check-in guard knows about the end date too', /var end = String\(\(rec && rec\.EndDate\) \|\| ''\)/.test(checkin));
  ok_('...and only refuses AFTER it', /test\(end\) && today > end/.test(checkin));
  ok_('the message says when it ended', /สิ้นสุดการทำงานเมื่อ/.test(checkin));
}

console.log('\n6) the food menu is gone from the parent, and only from the parent');
{
  ok_('the parent home no longer offers a menu card', !/onclick="P_menu\(/.test(app));
  ok_('...and the screen itself is gone', !/window\.P_menu = async/.test(app));
  ok_('the reason is written down', /already on the child's daily journal/.test(app));
  // the journal is where the food now lives for a family — that must still work
  ok_('the journal still pre-fills from the monthly menu', /const chosen = k => items\[k\] \|\| JPLAN\[k\] \|\| ''/.test(app));
  ok_('...and still labels where it came from', /จากเมนูประจำเดือน/.test(app));
  ok_('the staff planner is untouched', /window\.A_foodMenu=async\(\)=>/.test(app));
  ok_('and the engine still resolves a child\'s class for their meals', /mealSlots: p => \{/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
