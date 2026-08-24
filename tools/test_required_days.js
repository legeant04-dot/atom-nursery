/**
 * tools/test_required_days.js — how many days did the school expect people in?
 *   node tools/test_required_days.js
 *
 * ASKED 2026-08-24: "ให้สรุปเป็นโจทย์คือวันที่ต้องมาทำงาน เช่น เดือน 8 ต้องมาทำงาน 21 วัน ไม่นับเสาร์
 * อาทิตย์และวันหยุดของโรงเรียน แต่นับวัน Meeting ให้เป็นวันทำงานด้วย และแสดงผลให้ถูกต้อง" — together
 * with a period filter: day / week / month / quarter / year, and an exact range.
 *
 * "present 16" means nothing until you know it is out of 21, and the number could not be counted off
 * a calendar: a MEETING DAY is a working day that falls on a Saturday. That single exception is why
 * this belongs in the engine rather than in each screen that wants to print it.
 *
 * The school's decision when asked: ONE target for everybody, with leave in its own column — a day
 * of leave does not quietly reduce what a person owed. The only adjustment is for somebody who
 * started or left INSIDE the period, who cannot owe the days either side of their employment, and
 * the screen marks those rows rather than printing a shortfall nobody owes.
 *
 * `requiredToDate` exists so a month in progress does not accuse anybody: days that have not
 * happened yet are in the target, but not yet in what is owed.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

const TODAY = '2026-08-24';
function boot(over) {
  over = over || {};
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: over.bigCleaning || [], Departments: '' },
    staff: over.staff || [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', RequireCheckin: false, Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', Status: 'ACTIVE', RequireCheckin: true, StartDate: '2020-01-01' }
    ],
    holidays: over.holidays || [],
    staffAttendanceHistory: over.history || [], staffAttendanceToday: [], leaves: over.leaves || [],
    otRecords: [], workSchedule: [], staffGroups: [], students: [], classes: [], parents: [],
    userLinks: [], payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], holidayAttend: []
  };
  const at = new Date(TODAY + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const ask = (H, p) => H.staffAttendanceMonth(Object.assign({ staffId: 'ADM' }, p));

console.log('\n1) August 2026 — the example the school gave');
{
  // August 2026 has 21 weekdays. 12/08 (วันแม่) is a school holiday → 20 …
  const H = boot({ holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }] });
  eq('weekdays minus the school holiday', ask(H, { month: '2026-08' }).requiredDays, 20);
}
{
  // …and the meeting day on Saturday 15/08 puts it back to 21. This is the case a calendar cannot
  // answer, and the reason the number is computed here rather than on each screen.
  const H = boot({ holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }], bigCleaning: ['2026-08-15'] });
  const d = ask(H, { month: '2026-08' });
  eq('a MEETING Saturday counts as a working day', d.requiredDays, 21);
  eq('...and the days already passed are counted apart', d.requiredToDate, 15);
  ok_('...which is what stops a month in progress reading as a shortfall', d.requiredToDate < d.requiredDays);
}
{
  const H = boot({ bigCleaning: ['2026-08-15'], holidays: [{ Date: '2026-08-15', NameTH: 'ปิดโรงเรียน' }] });
  eq('a holiday beats a meeting on the same day — the school is shut', ask(H, { month: '2026-08' }).requiredDays, 21 - 0);
}

console.log('\n2) a target is not reduced by leave');
{
  const H = boot({
    holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }],
    leaves: [{ LeaveID: 'L1', StaffID: 'T1', Status: 'APPROVED', Type: 'ลาป่วย', StartDate: '2026-08-03', EndDate: '2026-08-05' }]
  });
  const s = ask(H, { month: '2026-08' }).staff[0];
  eq('the target stands', [s.requiredDays, s.myRequiredDays], [20, 20]);
  eq('...and the leave is reported on its own, as the school asked', s.leaveDays, 3);
  // this teacher never clocked in at all, so every working day that has passed is either leave or
  // an absence — and NOT ONE of the three leave days is counted twice
  const d2 = ask(H, { month: '2026-08' });
  eq('...so those days are not absences as well', s.absent, d2.requiredToDate - 3);
  eq('...which is 14 working days so far, 3 of them on leave', [d2.requiredToDate, s.leaveDays, s.absent], [14, 3, 11]);
}

console.log('\n3) somebody who started inside the period owes only their share');
{
  const H = boot({
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', RequireCheckin: false, Status: 'ACTIVE' },
      { StaffID: 'NEW', NameTH: 'ครูใหม่', Nickname: 'ใหม่', Role: 'Teacher', Status: 'ACTIVE', RequireCheckin: true, StartDate: '2026-08-17' }]
  });
  const d = ask(H, { month: '2026-08' });
  const s = d.staff[0];
  eq('the school\'s target is unchanged', d.requiredDays, 21);
  eq('...but hers starts on her first day', s.myRequiredDays, 11);
  ok_('...and the screen marks the row rather than printing a shortfall she does not owe',
    /s\.myRequiredDays!==s\.requiredDays\)\?` <span title=/.test(app));
}

console.log('\n4) any period, not just a month');
{
  const H = boot({ holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }], bigCleaning: ['2026-08-15'] });
  eq('a week (Sun 16 → Sat 22)', ask(H, { from: '2026-08-16', to: '2026-08-22' }).requiredDays, 5);
  // 10–14 are weekdays (5), 12/08 is วันแม่ (−1), and Saturday 15/08 is the meeting (+1)
  eq('...a week with a holiday AND a meeting still comes to five', ask(H, { from: '2026-08-09', to: '2026-08-15' }).requiredDays, 5);
  eq('an exact range of three weekdays', ask(H, { from: '2026-08-17', to: '2026-08-19' }).requiredDays, 3);
  eq('...one day on its own', ask(H, { from: '2026-08-17', to: '2026-08-17' }).requiredDays, 1);
  eq('...a Sunday on its own is nobody\'s working day', ask(H, { from: '2026-08-16', to: '2026-08-16' }).requiredDays, 0);
  const q = ask(H, { from: '2026-07-01', to: '2026-09-30' });
  ok_('a quarter is just a longer range', q.requiredDays > 60 && q.from === '2026-07-01' && q.to === '2026-09-30');
  eq('the range is reported back, so the screen prints what it asked for', [q.from, q.to], ['2026-07-01', '2026-09-30']);
}
{
  // ...and asking for a month still behaves EXACTLY as it always did — the day rows are the month's
  const d = ask(boot({}), { month: '2026-08' });
  eq('a month is still a month', [d.month, d.from, d.to, d.daysInMonth], ['2026-08', '2026-08-01', '2026-08-31', 31]);
  eq('...with a row per day', d.staff[0].days.length, 31);
  eq('...each still knowing its day OF THE MONTH, which is how the calendar lays out',
    [d.staff[0].days[0].day, d.staff[0].days[30].day], [1, 31]);
}
{
  const d = ask(boot({}), { from: '2026-08-17', to: '2026-08-19' });
  eq('a short range has only its own days', d.staff[0].days.map(x => x.day), [17, 18, 19]);
}

console.log('\n5) the screen');
{
  ok_('one definition of a week, shared with the teacher\'s own history',
    /const PERIOD_KINDS = \['week','month','quarter','year'\]/.test(app) && /function periodRange\(kind, anchor\)/.test(app));
  ok_('weeks run Sunday→Saturday, like every calendar the app draws', /back to Sunday/.test(app));
  ok_('the target is printed as the target', /วันที่ต้องมาทำงาน/.test(app));
  ok_('...explained, because "21" on its own is a claim', /นับวันประชุมเป็นวันทำงาน/.test(app));
  ok_('every row is measured against it', /\$\{EN\(\)\?'present':'มาทำงาน'\} \$\{s\.present\}\/\$\{s\.myRequiredDays/.test(app));
  ok_('an exact range can be picked', /A_smCustom=\(\)=>/.test(app));
  ok_('...and a backwards one is refused rather than returning nothing', /วันเริ่มต้นอยู่หลังวันสิ้นสุด/.test(app));
  ok_('the printed sheet carries the period and the target', /ต้องมาทำงาน '\+\(d\.requiredDays\|\|0\)\+' วัน'/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
