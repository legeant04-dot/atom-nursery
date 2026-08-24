/**
 * tools/test_calendar_readable.js — a calendar you can read, and a deduction you can check.
 *   node tools/test_calendar_readable.js
 *
 * FOUR THINGS REPORTED 2026-08-24, with screenshots:
 *
 *  1. "ทำไมประกันสังคมหัก 550 เอาเลขนี้มาจากไหน?" — 5% of 11,000, capped at 750. The figure was
 *     right; that it had to be ASKED is the defect. A deduction from somebody's pay that they cannot
 *     check is one they have to trust, so the slip shows the working.
 *
 *  2. The teacher's calendar was blank on the very day she had clocked in. Hydration splits
 *     CHECKIN_STAFF into "today" and "everything else", and the calendar was only given the second —
 *     so today was missing BY CONSTRUCTION, on every calendar, for everybody.
 *
 *  3. Her own leave did not appear, and nothing said what kind it was.
 *
 *  4. On the head teacher's / admin's calendar the text ran over its neighbours until the month was
 *     unreadable — precisely on the busy days somebody opens it to look at. The cell joined its
 *     lines with "\n" inside one span and simply overflowed the square.
 *
 * The fix for (4) is not only CSS. The head teacher's calendar is about COVER — who is away, and on
 * which day. The clock-in times are already on the daily summary directly above it, so printing them
 * again is what filled the cell in the first place. The school's decision: leave only there, times
 * only on your own.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), css = R('webapp/styles.css');

const TODAY = '2026-08-24';
function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1' },
    staff: [
      { StaffID: 'T1', NameTH: 'ปานตะวัน', Nickname: 'ฟาง', Role: 'Teacher', Department: 'Nursery 1', Status: 'ACTIVE' },
      { StaffID: 'T2', NameTH: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher', Department: 'Nursery 1', Status: 'ACTIVE' },
      { StaffID: 'HEAD', NameTH: 'หัวหน้า', Nickname: 'หัวหน้า', Role: 'Teacher', Department: '*', Status: 'ACTIVE' }
    ],
    staffAttendanceToday: [{ StaffID: 'T1', CheckIn: '06:42', CheckOut: '', Status: 'IN', Late: 0 }],
    staffAttendanceHistory: [{ Date: '2026-08-21', StaffID: 'T1', In: '06:58', Out: '19:08', Late: 0 }],
    leaves: [
      { LeaveID: 'L1', StaffID: 'T1', Status: 'APPROVED', Type: 'ลากิจ', StartDate: '2026-08-27', EndDate: '2026-08-27' },
      { LeaveID: 'L2', StaffID: 'T2', Status: 'APPROVED', Type: 'ลาพักร้อน', StartDate: '2026-08-27', EndDate: '2026-08-27' }
    ],
    workSchedule: [], holidays: [], students: [], classes: [], parents: [], userLinks: [], payments: [],
    studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [],
    payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], staffGroups: [], absenceLog: [], dspmCriteria: [],
    activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [],
    assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], holidayAttend: []
  };
  const at = new Date(TODAY + 'T14:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const H = boot();

console.log('\n1) the day you clocked in on is ON your calendar');
{
  const d = H.schedule({ staffId: 'T1' });
  const today = d.history.filter(h => String(h.Date).slice(0, 10) === TODAY);
  eq('today is in the history the calendar draws from', today.length, 1);
  eq('...with the time actually punched', today[0].In, '06:42');
  eq('...and an open day has no end time rather than a wrong one', today[0].Out, '');
  eq('yesterday is still there too', d.history.filter(h => String(h.Date).slice(0, 10) === '2026-08-21').length, 1);
}
{
  // ...and it is still HERS. Folding today in must not fold in anybody else's.
  const d = H.schedule({ staffId: 'T2' });
  eq('a colleague who has not clocked in has nothing', d.history.filter(h => String(h.Date).slice(0, 10) === TODAY).length, 0);
  eq('...and never sees T1’s punch', d.history.filter(h => h.StaffID === 'T1').length, 0);
}

console.log('\n2) your own leave, with the kind written on it');
{
  const d = H.schedule({ staffId: 'T1' });
  eq('a teacher gets her own leave', d.leavesToday.map(l => l.LeaveID), ['L1']);
  eq('...with its type, which is what the cell prints', d.leavesToday[0].Type, 'ลากิจ');
  ok_('the calendar prints the type', /\('\+tLeaveType\(l\.Type\)\+'\)/.test(app));
  ok_('...and no name on your own calendar, where it would be yours on every cell',
    /const who=seeAll\?shortName\(l\.StaffID\)\+' ':'';/.test(app));
}
{
  const d = H.schedule({ staffId: 'HEAD' });
  eq('a head teacher sees who is away', d.leavesToday.map(l => l.StaffID).sort(), ['T1', 'T2']);
}

console.log('\n3) the head teacher’s calendar is about COVER, not clock-ins');
{
  ok_('the times are drawn only on your own calendar', /if\(!seeAll\)\{\s*\n\s*\(history\|\|\[\]\)\.forEach/.test(app));
  ok_('...and the legend says where they went instead', /เวลาเข้า-ออกดูได้ที่สรุปรายวันด้านบน/.test(app));
  ok_('leave is drawn on both', /opts\.leaves\|\|\[\]\)\.filter\(l=>l\.Status==='APPROVED'\)/.test(app));
  ok_('the screen passes on which kind of reader it is', /canSeeAll:d\.canSeeAll/.test(app));
}

console.log('\n4) nothing overflows its own square');
{
  ok_('each entry is its own block, not a "\\n" inside one span',
    /class="calent/.test(app) && !/esc\(ppl\.join\('\\n'\)\)/.test(app));
  ok_('...clipped rather than allowed to run over the neighbours',
    /\.cal \.d \.calent\{[^}]*overflow:hidden[^}]*text-overflow:ellipsis/.test(css));
  ok_('...one line each, so a long name cannot wrap into the next day',
    /\.cal \.d \.calent\{[^}]*white-space:nowrap/.test(css));
  ok_('a crowded day says how many did not fit instead of growing', /\+\$\{ppl\.length-3\}/.test(app));
  ok_('...and shows at most three', /ppl\.slice\(0,3\)/.test(app));
  ok_('the cell still clips whatever gets past that', /\.cal \.d\{[^}]*overflow:hidden/.test(css));
  ok_('the reason is written beside the rule', /ran past the square and printed over its neighbours/.test(css));
}

console.log('\n5) the payslip shows its working for ประกันสังคม');
{
  ok_('there is a working', /function ssWorking\(r\)\{/.test(app));
  ok_('...printed on the deduction line', /หัก ประกันสังคม\$\{Number\(r\.SocialSecurity\|\|0\)\?/.test(app));
  ok_('...from the school’s own rate and cap, not numbers written here',
    /MOCK\.config&&MOCK\.config\.SocialSecurityRate/.test(app) && /MOCK\.config&&MOCK\.config\.SocialSecurityMax/.test(app));
  ok_('...and it says when the CAP is what produced the figure, not the percentage',
    /เพดานสูงสุด/.test(app));
  // 11,000 × 5% = 550 — the case in the screenshot
  const f = new Function('MOCK', 'EN', 'baht', 'esc', app.slice(app.indexOf('function ssWorking(r){'),
    app.indexOf('function carryMonths(r){')) + '; return ssWorking;');
  const ssWorking = f({ config: { SocialSecurityRate: 0.05, SocialSecurityMax: 750 } }, () => false,
    n => Number(n).toLocaleString(), s => s);
  eq('11,000 → "5% ของ 11,000"', ssWorking({ BaseSalary: 11000, SocialSecurity: 550 }).indexOf('5% ของ 11,000'), 0);
  ok_('20,000 is explained by the cap instead', ssWorking({ BaseSalary: 20000, SocialSecurity: 750 }).indexOf('เพดานสูงสุด') === 0);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
