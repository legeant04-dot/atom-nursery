/**
 * tools/test_missing_checkout.js — the day that was never closed, and the child whose history it was.
 *   node tools/test_missing_checkout.js
 *
 * Two things reported on 2026-08-19.
 *
 * 1. ก้อย's month read "ครบ" — full attendance, nothing to see. Opening her calendar showed two days,
 *    07/08 and 19/08, with an arrival and no departure. A day with no end time has no working hours
 *    and no OT behind it, and nobody had been told: not her, not the head teacher, not the admin. The
 *    only person who knows what time she left is her, so she is told first, on her own home screen,
 *    with the way to fix it (a time request). The monthly screen stops calling it "ครบ", and the
 *    evening digest reaches the people who can chase it.
 *
 *    A day is only counted once it is OVER. An open day at 15:00 is someone still at work.
 *
 * 2. A parent with more than one child saw ONE child's pick-up history — kids[0] — with nothing on
 *    the screen saying which, and no way to reach the other. Two children's mornings look much alike,
 *    so the wrong one is not obviously the wrong one.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), notify = R('src/Notify.gs');

const TODAY = '2026-08-20';
function boot(hist) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00' },
    staff: [{ StaffID: 'STF-01', NameTH: 'ปริณดา สว่างศรี', Nickname: 'ก้อย', StartDate: '2023-05-02', Status: 'ACTIVE', Role: 'Admin', PositionLevel: 'Admin' }],
    staffAttendanceHistory: hist || [], staffAttendanceToday: [],
    holidays: [], leaves: [], staffGroups: [], workSchedule: [],
    students: [], parents: [], userLinks: [], classes: [], payments: [], otDaily: [], studentCharges: [],
    prepayments: [], paymentSlips: [], checkinStudent: [], studentCheckins: [], journals: [], comments: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], studentAttendanceToday: [], otRecords: []
  };
  const at = new Date(TODAY + 'T15:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
// ก้อย's month as reported: in and out every day except 07/08 and 19/08, which have only an arrival
const HIST = [
  { StaffID: 'STF-01', Date: '2026-08-03', In: '06:58', Out: '18:14' },
  { StaffID: 'STF-01', Date: '2026-08-04', In: '06:50', Out: '18:09' },
  { StaffID: 'STF-01', Date: '2026-08-05', In: '06:38', Out: '18:08' },
  { StaffID: 'STF-01', Date: '2026-08-06', In: '06:45', Out: '15:28' },
  { StaffID: 'STF-01', Date: '2026-08-07', In: '06:42', Out: '' },          // never clocked out
  { StaffID: 'STF-01', Date: '2026-08-19', In: '12:04', Out: '' },          // never clocked out
  { StaffID: 'STF-01', Date: '2026-08-18', In: '06:41', Out: '18:10' }
];

console.log('\n1) ก้อย\'s month is no longer "ครบ"');
{
  const { H } = boot(HIST);
  const d = H.staffAttendanceMonth({ month: '2026-08', staffId: 'STF-01' });
  const me = d.staff[0];
  eq('the two open days are found', me.missingOutDays, ['2026-08-07', '2026-08-19']);
  eq('...and counted', me.missingOut, 2);
  eq('...and named at the top level, for the screens that only want the exceptions',
    (d.missingOut || []).map(x => [x.nick, x.days.length]), [['ก้อย', 2]]);
  const day7 = me.days.find(x => x.date === '2026-08-07');
  eq('the day itself is flagged, so a calendar can mark it', [day7.status, day7.in, day7.out, day7.missingOut], ['IN', '06:42', '', true]);
  const day3 = me.days.find(x => x.date === '2026-08-03');
  eq('a complete day is not flagged', day3.missingOut, false);
}
{
  // the one-question version the home card and the digest both ask
  const { H } = boot(HIST);
  const mo = H.staffMissingCheckout({ staffId: 'STF-01' });
  eq('asked on its own it gives the same answer', [mo.count, mo.staff[0].days.length], [2, 2]);
}

console.log('\n2) a day still in progress is not a missing check-out');
{
  const { H } = boot(HIST.concat([{ StaffID: 'STF-01', Date: TODAY, In: '07:30', Out: '' }]));
  const d = H.staffAttendanceMonth({ month: '2026-08', staffId: 'STF-01' });
  eq('today is left alone — she is still at work', d.staff[0].missingOutDays, ['2026-08-07', '2026-08-19']);
}
{
  // a day with NO arrival either is an absence, which is a different problem with a different name
  const { H } = boot([{ StaffID: 'STF-01', Date: '2026-08-05', In: '', Out: '' }]);
  const d = H.staffAttendanceMonth({ month: '2026-08', staffId: 'STF-01' });
  eq('a day nobody logged at all is not a missing check-out', d.staff[0].missingOut, 0);
  ok_('...it is counted as an absence instead', d.staff[0].absent > 0);
}

console.log('\n3) everyone who needs to know, knows');
{
  ok_('the teacher is told on their own home screen', /api\('staffMissingCheckout',\{staffId:USER\.staffId\}\)/.test(app));
  ok_('...how many days, and which', /มี \$\{mo\.count\} วันที่ยังไม่ได้ลงเวลาออก/.test(app) && /days\.map\(d=>esc\(ddmmyyyy\(d\)\)\)\.join\(' · '\)/.test(app));
  ok_('...why it matters', /วันเหล่านี้จะยังไม่มีชั่วโมงทำงานและไม่มี OT/.test(app));
  ok_('...and is handed the way to fix it', /onclick="GO\('leave'\)">📤/.test(app));
  ok_('the monthly screen stops saying ครบ', /s\.missingOut\?`<span class="pill bad">⏳/.test(app));
  ok_('...counts it as its own figure', /smStat\(tot\.mo, EN\(\)\?'no check-out':'ไม่ได้ลงเวลาออก'/.test(app));
  ok_('...and lists the days per person', /d\.missingOut\.map\(x=>`<div style="margin-top:2px">• <b>/.test(app));
  ok_('the evening digest tells the admins and the head teacher', /staffMissingCheckout/.test(notify)
    && /ยังไม่ได้ลงเวลาออก ' \+ mo\.count \+ ' วัน/.test(notify));
  ok_('...naming who and which days', /\(s\.days \|\| \[\]\)\.join\(', '\)/.test(notify));
}

console.log('\n4) a parent with two children can tell whose history they are reading');
{
  ok_('the pick-up screen has nickname tabs', /\$\{childSwitcher\(kids, sid, 'P_ciHist'\)\}/.test(app));
  ok_('...and each tab loads that child', /window\.P_ciHist = async \(sid\) =>/.test(app));
  ok_('the card repeats the name, so a screenshot is unambiguous', /<b>\$\{esc\(dispNick\(kid\)\)\}<\/b> <small class="muted">\$\{esc\(kid\.Class\|\|''\)\}/.test(app));
  ok_('...and it no longer silently shows kids[0]', !/const hist=await api\('studentCheckinHistory',\{studentId:kids\[0\]\.StudentID\}\);/.test(app));
  ok_('the reason is written down', /Two children's mornings look\s*\n\s*\* much alike/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
