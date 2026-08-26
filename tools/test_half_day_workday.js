/**
 * tools/test_half_day_workday.js — half a holiday is still a working day, and a child who has not
 * started has not been absent.
 *   node tools/test_half_day_workday.js
 *
 * TWO SCREENS THAT ACCUSED SOMEBODY OF SOMETHING THEY HAD NOT DONE, both reported 2026-08-26, both
 * the same shape of mistake: a rule that already existed elsewhere in the engine had never been
 * taught to the screen that needed it.
 *
 * 1. "เวลาเข้า-ออกรายเดือน" printed ต้องมาทำงาน 20 วัน for a month the school counts as 21.
 *
 *    The arithmetic makes the cause exact. August 2026 has 21 weekdays. The school had TWO holidays
 *    on record — 12/08 (วันแม่, all day) and 19/08 (ไฟฟ้าดับ, 07:00–12:00) — and one meeting day on
 *    Saturday 15/08:
 *          21 − 12/08 − 19/08 + meeting = 20   ← what the screen said
 *          21 − 12/08          + meeting = 21   ← what the school counts
 *    So the meeting day was being added all along; what was wrong was that a holiday which only ran
 *    until lunchtime excused the WHOLE day. Everybody worked that afternoon, and the target said
 *    they owed the school nothing.
 *
 *    schoolDayFor_ had drawn this distinction since the half-day holiday was built (`closedAllDay`
 *    vs `closed`). staffAttendanceMonth had one object doing both jobs, so every question it asked
 *    got the whole-day answer.
 *
 * 2. "สรุปรายชั้นเรียน" listed น้องเอ็นเจ as ขาด 16 · ขาดต่อเนื่อง 16 · ต้องติดตาม, where 16 is
 *    exactly the number of school days BEFORE their first day. studentNotStarted_ already guards
 *    check-in, the class roster and billing — this screen, the one that decides whose parents get
 *    chased, was the only place still counting from the 1st of the month.
 *
 * The rule underneath both: a target or a shortfall must be measured over the days the person was
 * actually expected, and nothing else.
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

const TODAY = '2026-08-26';
function boot(over) {
  over = over || {};
  const M = {
    config: { Plans: over.plans || [], LeaveQuota: {}, BigCleaningDays: over.bigCleaning || [], Departments: 'Nursery 1' },
    staff: over.staff || [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', RequireCheckin: false, Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', Status: 'ACTIVE', RequireCheckin: true, StartDate: '2020-01-01' }
    ],
    holidays: over.holidays || [],
    students: over.students || [],
    checkinStudent: over.checkins || [],
    staffAttendanceHistory: over.history || [], staffAttendanceToday: [], leaves: over.leaves || [],
    otRecords: [], workSchedule: [], staffGroups: [], classes: [], parents: [],
    userLinks: [], payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [],
    payroll: [], payrollConfig: {}, studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: over.studentLeaves || [], journals: [], comments: [], absenceLog: [], dspmCriteria: [], activityLog: [],
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
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const ask = (H, p) => H.staffAttendanceMonth(Object.assign({ staffId: 'ADM' }, p));

// the live August the report came from
const AUG = {
  holidays: [
    { Date: '2026-08-12', NameTH: 'วันเฉลิมพระชนมพรรษาฯ และวันแม่แห่งชาติ' },
    { Date: '2026-08-19', NameTH: 'ไฟฟ้าดับ ตัดไฟฟ้า', StartTime: '07:00', EndTime: '12:00' }
  ],
  bigCleaning: ['2026-08-15']       // a Saturday meeting day
};

console.log('\n1) the reported month, reproduced and then corrected');
{
  const { H } = boot(AUG);
  const d = ask(H, { month: '2026-08' });
  eq('ต้องมาทำงาน is 21, not 20', d.requiredDays, 21);
  // …and each part of that 21, so a future change to any one of them fails HERE and not on a payslip
  eq('the whole-day holiday is out', d.requiredDates.indexOf('2026-08-12'), -1);
  ok_('the HALF-day holiday is in — people worked that afternoon', d.requiredDates.indexOf('2026-08-19') >= 0);
  ok_('the Saturday meeting day is in', d.requiredDates.indexOf('2026-08-15') >= 0);
  ok_('...and ordinary Saturdays are not', d.requiredDates.indexOf('2026-08-22') < 0);
  // the figure the screen prints next to it moves with the target, or the pair reads as a shortfall
  eq('days already passed, counted the same way', d.requiredToDate, 17);
}

console.log('\n2) a half-day holiday is still SHOWN as a holiday — it just does not excuse the day');
{
  const { H } = boot(AUG);
  const d = ask(H, { month: '2026-08' });
  const day19 = d.staff[0].days.find(r => r.date === '2026-08-19');
  ok_('the cell still carries the name', /ไฟฟ้าดับ/.test(day19.holiday));
  ok_('...with the window, so nobody has to guess which half', /07:00-12:00/.test(day19.holiday));
  // a teacher who did not come in that afternoon was absent, exactly as on any other working day
  eq('and not turning up is an absence', day19.status, 'ABSENT');
  const day12 = d.staff[0].days.find(r => r.date === '2026-08-12');
  eq('while the whole-day holiday is still a holiday', day12.status, 'HOLIDAY');
  ok_('...and its name carries no window', !/\(/.test(day12.holiday));
}
{
  // …and someone who DID work the afternoon is present, with their real times
  const { H } = boot(Object.assign({}, AUG, {
    history: [{ StaffID: 'T1', Date: '2026-08-19', In: '12:45', Out: '17:30', Late: 0 }]
  }));
  const row = ask(H, { month: '2026-08' }).staff[0];
  const d19 = row.days.find(r => r.date === '2026-08-19');
  eq('present, at the time they actually came', [d19.status, d19.in, d19.out], ['IN', '12:45', '17:30']);
  eq('and it counts towards the month', row.present, 1);
}

console.log('\n3) nothing else about a holiday changed');
{
  // blank times have always meant the whole day, and every holiday entered before this has blanks
  const { H } = boot({ holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่' }] });
  eq('a plain holiday still removes its day', ask(H, { month: '2026-08' }).requiredDays, 20);
  const { H: H2 } = boot({ holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่', StartTime: '', EndTime: '' }] });
  eq('...and so does one with empty times', ask(H2, { month: '2026-08' }).requiredDays, 20);
  /* AN UNREADABLE TIME MUST FALL BACK TO THE WHOLE DAY. A Sheets cell can hand a time back as a
   * Date on the 1899 epoch; read carelessly that becomes 00:00, which here would turn a full-day
   * holiday into a working day and mark the whole school absent. cfgTime_ refuses it. */
  const { H: H3 } = boot({ holidays: [{ Date: '2026-08-12', NameTH: 'วันแม่', StartTime: 'Sat Dec 30 1899 00:00:00' }] });
  eq('a damaged time is not a half-day holiday', ask(H3, { month: '2026-08' }).requiredDays, 20);
}
{
  /* A WHOLE-DAY HOLIDAY DECLARED OVER A MEETING DAY STILL CANCELS IT — the school's decision, and
   * test_required_days pins it. What changes here is only the HALF-day case: shutting the school
   * until lunchtime does not cancel a meeting that was called for that day. */
  const { H } = boot({ holidays: [{ Date: '2026-08-15', NameTH: 'วันหยุด' }], bigCleaning: ['2026-08-15'] });
  ok_('a whole-day holiday still cancels a meeting on the same date',
    ask(H, { month: '2026-08' }).requiredDates.indexOf('2026-08-15') < 0);
  const { H: H4 } = boot({ holidays: [{ Date: '2026-08-15', NameTH: 'ไฟดับ', StartTime: '07:00', EndTime: '12:00' }],
    bigCleaning: ['2026-08-15'] });
  ok_('...but a half-day one does not — the meeting still stands',
    ask(H4, { month: '2026-08' }).requiredDates.indexOf('2026-08-15') >= 0);
}

console.log('\n4) the screen explains the rule it is using');
{
  ok_('the Thai note says half-day holidays still count', /วันหยุดครึ่งวันยังนับเป็นวันทำงาน/.test(app));
  ok_('...and the English one', /minus WHOLE-day school holidays/.test(app));
  ok_('...including on the printed report', /หักวันหยุดเต็มวันของโรงเรียน/.test(app));
}

// ============================================================================
console.log('\n5) the class report — น้องเอ็นเจ, who had not started yet');
const kid = o => Object.assign({ StudentID: 'STD-1', NameTH: 'เด็กหญิงเอ็นเจ', Nickname: 'เอ็นเจ',
  Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2024-01-01', Plan: '', EnrollDate: '2026-08-22' }, o || {});
{
  /* The live case: enrolled from Saturday 22/08, so the first school day they owed is Monday 24/08.
   * The report showed ขาด 16 — every school day of the month before they existed here. */
  const { H } = boot({ students: [kid()] });
  const r = H.studentMonthReport({ staffId: 'ADM', month: '2026-08' });
  const s = r.classes[0].students[0];
  eq('the 16 phantom absences are gone — only 24 and 25 remain', s.absent, 2);
  eq('...and the run with them', s.maxConsecutive, 2);
  eq('...so nobody is chased on nothing', r.totals.watch, 0);
  eq('...and the class agrees', r.classes[0].watch, 0);
}
{
  /* TODAY IS NOT OVER, EITHER. 26/08 is today: at 09:00 a child who has not been dropped off yet is
   * on their way, not absent. Counting it took this child to a 3-day run and over the follow-up
   * line — an accusation that would have appeared every morning and withdrawn itself by lunchtime. */
  const { H } = boot({ students: [kid()] });
  const s = H.studentMonthReport({ staffId: 'ADM', month: '2026-08' }).classes[0].students[0];
  ok_('today is not counted against them', s.absent === 2 && s.lastAbsent === '2026-08-25');
  // ...and a child who DOES arrive today is present for it
  const { H: H2 } = boot({ students: [kid()], checkins: [{ StudentID: 'STD-1', Date: TODAY, Type: 'IN' }] });
  const s2 = H2.studentMonthReport({ staffId: 'ADM', month: '2026-08' }).classes[0].students[0];
  eq('arriving today still counts as present', s2.present, 1);
  eq('...and it closes the run', s2.maxConsecutive, 2);
}
{
  /* AND THE ROW HAS TO SAY WHY IT IS SHORT. Once those days stop counting, "มา 2 · ขาด 0" and
   * "มา 18 · ขาด 0" look identical on the screen — so the row carries how many days this child was
   * actually due in, and the date they started. */
  const { H } = boot({ students: [kid({ EnrollDate: '2026-09-01' })] });   // first day still ahead
  const r = H.studentMonthReport({ staffId: 'ADM', month: '2026-08' });
  const s = r.classes[0].students[0];
  eq('marked as not started', s.notStarted, true);
  eq('with the date', s.startDate, '2026-09-01');
  eq('and no days owed at all', [s.schoolDays, s.absent], [0, 0]);
  ok_('...which is fewer than the month has', s.schoolDays < r.schoolDays);
}
{
  // the one already in the roster: due in for 24, 25 and 26 — three days, two of them judged
  const { H } = boot({ students: [kid()] });
  const s = H.studentMonthReport({ staffId: 'ADM', month: '2026-08' }).classes[0].students[0];
  eq('due in since their first day', s.schoolDays, 3);
  eq('and started, so not pilled as upcoming', s.notStarted, false);
}
{
  // a child who HAS started and really did miss the days is untouched — the point is not leniency
  const { H } = boot({ students: [kid({ EnrollDate: '2026-07-01' })] });
  const s = H.studentMonthReport({ staffId: 'ADM', month: '2026-08' }).classes[0].students[0];
  ok_('a real run of absences is still counted', s.absent > 10 && s.maxConsecutive >= 3);
  eq('...and still flagged to follow up', H.studentMonthReport({ staffId: 'ADM', month: '2026-08' }).totals.watch, 1);
  eq('...and is NOT marked as a late start', s.notStarted, false);
}
{
  // the days AFTER their first day count normally — starting late is not a permanent excuse
  const { H } = boot({ students: [kid({ EnrollDate: '2026-08-03' })],
    checkins: [{ StudentID: 'STD-1', Date: '2026-08-03', Type: 'IN' }] });
  const s = H.studentMonthReport({ staffId: 'ADM', month: '2026-08' }).classes[0].students[0];
  eq('present on the day they arrived', s.present, 1);
  ok_('and absent for the ones after it', s.absent > 5);
  eq('the run is measured from the start date, not the 1st', s.maxConsecutive, s.absent);
  // present + absent + today-not-yet-judged accounts for every day they owed, and nothing else
  eq('every day owed is accounted for', s.schoolDays, s.present + s.absent + 1);
}

console.log('\n6) the report says which days it counted');
{
  ok_('the footnote names the start-date rule', /วันก่อนถึงวันเริ่มเรียน และวันที่ลาชั่วคราว ไม่นับเป็นขาด/.test(app));
  ok_('...on the exported sheet too', /วันก่อนถึงวันเริ่มเรียน/.test(app));
  ok_('a short month is labelled on the row rather than left to guess', /\(\$\{EN\(\)\?'due in':'ต้องมา'\} \$\{s\.schoolDays\}\/\$\{d\.schoolDays\}/.test(app));
  ok_('...and the child is pilled with their first day', /\$\{EN\(\)\?'starts':'เริ่ม'\} \$\{esc\(ddmmyyyy\(s\.startDate\)\)\}/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
