/**
 * tools/test_injury_badge_month.js — two things reported 2026-09-05 about the admin injury screen.
 *   node tools/test_injury_badge_month.js
 *
 * 1) THE RED 2 AND THE SCREEN DISAGREED. The ดำเนินการ button showed a red 2; September held one
 *    report waiting. Both numbers were right, and that is the problem: the badge counts everything
 *    still waiting for a signature, EVER, while the screen shows a MONTH. A report left unsigned in
 *    August is precisely the one that needs finding, and the month view was the one place that could
 *    not show it.
 *
 * 2) THE MONTH PICKER COULD NOT BE OPENED. It sat inside a <summary>, where any click toggles the
 *    fold — so it carried onclick="event.preventDefault()" to stop that. preventDefault cancels
 *    EVERY default action of that click, the native month picker included. The control was there,
 *    looked enabled, and did nothing.
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
const app = R('webapp/app.js');

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    classes: [{ ClassName: 'Nursery 2', TeacherID: 'T1' }],
    students: [{ StudentID: 'S1', NameTH: 'ไบร์ท', Nickname: 'ไบร์ท', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2024-01-01' },
               { StudentID: 'S2', NameTH: 'พรีม', Nickname: 'พรีม', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2024-02-01' }],
    staff: [{ StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Officer' },
            { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    /* exactly the reported shape: September shows one approved and one waiting, and an older month
     * holds a second one nobody has signed */
    injuryReports: [
      { InjuryID: 'I-SEP-1', StudentID: 'S1', TeacherID: 'T1', Date: '2026-09-02', Time: '16:10', Status: 'APPROVED', InjuryTypes: [15] },
      { InjuryID: 'I-SEP-2', StudentID: 'S2', TeacherID: 'T1', Date: '2026-09-02', Time: '10:25', Status: 'PENDING_ADMIN', InjuryTypes: [11] },
      { InjuryID: 'I-AUG-1', StudentID: 'S1', TeacherID: 'T1', Date: '2026-08-21', Time: '17:11', Status: 'PENDING_LEADER', InjuryTypes: [15] }],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [], otRecords: [], studentCharges: [],
    prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [], holidays: [],
    staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [],
    payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    classChangeReq: [], attendanceReq: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], studentAttendanceToday: [], studentCheckins: [], classCover: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M: M };
}

console.log('1) the number on the button, and what September could show');
{
  const { H } = boot();
  eq('the badge says 2', H.opsPending({ staffId: 'A1' }).injuries, 2);
  const sep = H.injurySummary({ month: '2026-09' });
  eq('...but September holds three-minus-one reports', sep.reports.length, 2);
  eq('...only ONE of which is waiting', sep.reports.filter(r => String(r.status).indexOf('PENDING') === 0).length, 1);
  /* Both figures are correct. The screen just had no way to show the August one, which is the one
   * that has been sitting unsigned the longest. */
  const waiting = H.pendingInjuries({ staffId: 'A1' });
  eq('what is waiting, whatever month it is in, is 2', waiting.length, 2);
  eq('...and that matches the badge exactly', waiting.length, H.opsPending({ staffId: 'A1' }).injuries);
  eq('...including the one from August', waiting.some(r => r.InjuryID === 'I-AUG-1'), true);
  eq('...and never an approved one', waiting.some(r => r.Status === 'APPROVED'), false);
}
{
  // a head teacher only ever takes step 1, so their queue is the PENDING_LEADER half
  const lead = boot();
  lead.M.staff.push({ StaffID: 'L1', NameTH: 'หัวหน้า', Role: 'Teacher', PositionLevel: 'Leader' });
  eq('a head teacher sees only what is on their step', lead.H.pendingInjuries({ staffId: 'L1' }).map(r => r.InjuryID), ['I-AUG-1']);
  eq('a plain teacher has no queue at all', lead.H.pendingInjuries({ staffId: 'T1' }).length, 0);
}

console.log('\n2) the screen shows it');
{
  const scr = app.slice(app.indexOf('window.A_injuries=async'), app.indexOf('window.A_viewInjury=', app.indexOf('window.A_injuries=async')));
  ok_('the screen asks for what is waiting as well as the month', /api\('pendingInjuries'/.test(scr));
  ok_('...in the same tick, so it costs no extra round trip', /Promise\.all\(\[api\('injurySummary'[\s\S]{0,200}pendingInjuries/.test(scr));
  ok_('...and one failing half does not blank the other', /pendingInjuries[\s\S]{0,80}\.catch\(\(\)=>\[\]\)/.test(scr));
  ok_('it is drawn FIRST, above the month summary', scr.indexOf('waiting.length?') < scr.indexOf("stat('🚑'"));
  ok_('...counted in red, like the button', /waiting\.length\?[\s\S]{0,400}pill bad">\$\{waiting\.length\}/.test(scr));
  ok_('...and says plainly that it is not month-scoped', /นับทุกเดือน/.test(scr));
  ok_('nothing waiting draws nothing', /waiting\.length\?`<div class="card"[\s\S]{0,700}`:''/.test(scr));
}

console.log('\n3) the month picker opens');
{
  /* preventDefault on a click cancels every default action of that click — focusing the field and
   * opening the native picker included. Nowhere in this app may an input carry it. */
  ok_('no month input cancels its own click', !/type="month"[^>]*onclick="[^"]*preventDefault/.test(app));
  const inputs = app.match(/<input[^>]*onclick="[^"]*preventDefault[^"]*"[^>]*>/g) || [];
  eq('...nor any other input', inputs.length, 0);
  const scr = app.slice(app.indexOf('window.A_injuries=async'), app.indexOf('window.A_viewInjury=', app.indexOf('window.A_injuries=async')));
  const sumAt = scr.indexOf('<summary'), sumEnd = scr.indexOf('</summary>');
  ok_('the picker is not inside the summary, where every click toggles the fold',
    sumAt > 0 && scr.slice(sumAt, sumEnd).indexOf('type="month"') < 0);
  ok_('...it is inside the fold, above the list it filters',
    scr.indexOf('type="month"', sumEnd) > sumEnd);
  // folding the list must not hide which month is on screen
  ok_('the summary still says which month is shown', /monthNameYear\(sum\.month\)/.test(scr));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
