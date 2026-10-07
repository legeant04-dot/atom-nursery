/**
 * tools/test_staff_performance.js — one person's year, on one screen.
 *   node tools/test_staff_performance.js
 *
 * Asked 2026-10-05, out of the ผอ.'s annual-review question: "แสดงเป็น Dashboard Performance รายคน
 * แสดง Chart / วันที่มาทำงาน Total กับ จำนวนวันที่มาจริง / จำนวนและประวัติวันลา - สาย / สรุปจำนวนรายได้
 * รายคนและเงินสะสม".
 *
 * THIS SCREEN DECIDES SOMEBODY'S PAY, so the suite is built around the four ways a review can be
 * unfair rather than around the shape of the reply:
 *
 *   1. counting days that have not happened yet as absence (§1)
 *   2. comparing "days expected to date" against "days present over the whole year" (§1 — it gave
 *      197 of 195 on the very first fixture, and a progress bar past 100%)
 *   3. a headline that contradicts the list printed directly under it (§2)
 *   4. money that is re-derived instead of read from the slip the person was actually paid on (§3)
 *
 * The arithmetic is measured, never grepped: every figure below is counted from a fixture whose
 * answer was worked out by hand first.
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
  catch (e) { const got = (e && e.code) || ''; const ok = !code || got === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + got); ok ? pass++ : fail++; }
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), codeGs = R('src/Code.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TODAY = new Date();
const Y = String(TODAY.getFullYear());
const d2 = n => String(n).padStart(2, '0');
const DS = d => d.getFullYear() + '-' + d2(d.getMonth() + 1) + '-' + d2(d.getDate());
const shift = n => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return DS(d); };

function school(over) {
  const M = Object.assign({
    staff: [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' },
      { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', Position: 'ครูประจำชั้น',
        StaffGroup: 'G1', Status: 'ACTIVE', StartDate: '2024-01-01', ContributionOpening: 5000 },
      { StaffID: 'T2', NameTH: 'ครูบี', Nickname: 'บี', Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: '2024-01-01' }
    ],
    staffGroups: [{ GroupName: 'G1', CheckInTime: '07:00', CheckOutTime: '17:00' }],
    staffAttendanceHistory: [], staffAttendanceToday: [], otRecords: [], leaves: [], payroll: [],
    holidays: [], students: [], parents: [], activityLog: [], userLinks: [], workSchedule: [],
    config: { Timezone: 'Asia/Bangkok', ContributionMatchRate: 1 }
  }, over || {});
  return { M, H: createAtomAPI(M).H };
}
const ask = (H, over) => H.staffPerformance(Object.assign({ staffId: 'ADM', targetId: 'T1', year: Y }, over || {}));

// ============================================================================================
console.log('1) 🔴 the two sides of the comparison are counted by the same rule');
// ============================================================================================
{
  /* A day in the FUTURE can exist: an admin correcting a pick-up time writes one, and an import can.
   * It must not be attendance (nobody has been here yet) and it must not be absence either. */
  /* AttendanceSince is pinned to the start of the year so this section is about the FUTURE rule and
   * nothing else — left to derive itself it would land on the first seeded row and collapse the
   * range to a couple of days. (The derivation has its own section, §7.) */
  const { M, H } = school({ config: { Timezone: 'Asia/Bangkok', ContributionMatchRate: 1, AttendanceSince: Y + '-01-01' } });
  // yesterday — a real day, really here
  M.staffAttendanceHistory.push({ Date: shift(-1), StaffID: 'T1', In: '07:00', Out: '17:00', Late: 0 });
  // ...and a day that has not happened
  M.staffAttendanceHistory.push({ Date: shift(30), StaffID: 'T1', In: '07:00', Out: '17:00', Late: 0 });
  const r = ask(H);

  /* 🔴 NOT "present <= required" — that is not true and should not be. Somebody who comes in on a
   * Saturday (Big Cleaning, OT วันหยุด) is present on a day that was never required, and the first
   * version of this assertion failed on exactly that. What the fix actually guarantees is narrower
   * and checkable: a day that has not happened is not attendance. */
  eq('🔴 only days already past are counted present', r.present, 1);
  ok_('the year ahead is not counted as days expected', r.required < r.requiredWhole);
  ok_('...and the whole-year figure is still reported, for context', r.requiredWhole > 0);
  const future = (r.months || []).find(m => m.month === shift(30).slice(0, 7));
  ok_('a future month contributes nothing to the chart', !future || (future.present === 0 && future.absent === 0));
  /* CONTROL: the rule must not simply drop everything. */
  eq('CONTROL — yesterday IS counted', (r.months || []).reduce((a, m) => a + m.present, 0), 1);
}

// ============================================================================================
console.log('2) 🔴 leave is counted from the leave records, not from the calendar');
// ============================================================================================
{
  /* The day-by-day view marks a day LEAVE only when there is NO check-in — right for a calendar
   * (somebody who came in was here, whatever the paperwork says) and wrong for a review, where the
   * question is the one the entitlement was deducted from. On the first fixture it printed "ลา 0"
   * directly above a list of three approved leaves, which reads as a broken screen. */
  const { M, H } = school();
  M.leaves.push({ LeaveID: 'L1', StaffID: 'T1', Type: 'sick', StartDate: Y + '-02-10', EndDate: Y + '-02-11', Days: 2, Status: 'APPROVED', Reason: 'ไข้' });
  M.leaves.push({ LeaveID: 'L2', StaffID: 'T1', Type: 'personal', StartDate: Y + '-05-20', EndDate: Y + '-05-20', Days: 1, Status: 'APPROVED', HalfDay: 'AM' });
  M.leaves.push({ LeaveID: 'L3', StaffID: 'T1', Type: 'sick', StartDate: Y + '-06-01', EndDate: Y + '-06-03', Days: 3, Status: 'PENDING_ADMIN' });
  // ...and a check-in ON one of the leave days: the calendar says IN, the paperwork says leave
  M.staffAttendanceHistory.push({ Date: Y + '-02-10', StaffID: 'T1', In: '07:00', Out: '17:00', Late: 0 });
  const r = ask(H);

  /* 🔴 2 full + 1 half. Worked out by hand BEFORE running it — which is how the off-by-one below
   * was caught at all. */
  eq('🔴 two full days and a half day make two and a half', r.leaveDays, 2.5);
  eq('...and the headline cannot contradict the list under it',
    r.leaveDays, Object.keys(r.leaveByType).reduce((a, k) => a + r.leaveByType[k], 0));
  eq('a leave still awaiting approval is listed but not counted', r.leaveByType['ลาป่วย'], 2);
  eq('...and a half day counts as a half in the breakdown too', r.leaveByType['ลากิจ'], 0.5);
  eq('...while every request is still shown, with its status', r.leaves.length, 3);
  eq('...newest first', r.leaves[0].leaveId, 'L3');

  /* 🔴 THE OFF-BY-ONE. The expansion loop built its dates in LOCAL time and tested its condition in
   * UTC (.toISOString()), so in any timezone ahead of UTC it ran one iteration too long: a two-day
   * leave counted as three and a half-day added another half. 2.5 days came out as 4. The same trap
   * that put สิงหาคม on a September payslip. */
  const feb = (r.months || []).find(m => m.month === Y + '-02');
  eq('🔴 a two-day leave occupies exactly two days of February', feb && feb.leave, 2);
  const may = (r.months || []).find(m => m.month === Y + '-05');
  eq('🔴 ...and a half day is half of one', may && may.leave, 0.5);
}

// ============================================================================================
console.log('3) the money is read from the slips, never recomputed');
// ============================================================================================
{
  /* A review screen that re-derives pay will eventually disagree with the slip the person was paid
   * on — and the slip is the document they signed for. So the figures are a SUM OF SLIPS, and a
   * month with no slip contributes nothing rather than an estimate. */
  const { M, H } = school();
  [1, 2, 3].forEach(m => M.payroll.push({
    PayrollID: 'PR' + m, StaffID: 'T1', Month: Y + '-' + d2(m), BaseSalary: 14300,
    DiligenceTotal: 1000, ExtraChildAmount: m === 3 ? 900 : 0, OTEvening: 300, OTHoliday: 0,
    GrossIncome: 14300 + 1000 + (m === 3 ? 900 : 0) + 300, SocialSecurity: 750, Contribution: 200,
    TotalDeductions: 950, NetPay: 14300 + 1000 + (m === 3 ? 900 : 0) + 300 - 950,
    ContributionAccum: 5000 + m * 400, Position: 'ครูประจำชั้น', PaidDate: Y + '-' + d2(m) + '-28'
  }));
  // a slip for somebody else, and one outside the year — neither may leak in
  M.payroll.push({ PayrollID: 'PX', StaffID: 'T2', Month: Y + '-02', BaseSalary: 99999, GrossIncome: 99999, NetPay: 99999 });
  M.payroll.push({ PayrollID: 'PY', StaffID: 'T1', Month: (Number(Y) - 1) + '-12', BaseSalary: 88888, GrossIncome: 88888, NetPay: 88888 });
  const r = ask(H);

  eq('three slips in range', r.slipCount, 3);
  eq('base salary is the sum of the slips', r.income.base, 42900);
  eq('...and so is the child-rate allowance', r.income.childRate, 900);
  eq('OT is every kind added together', r.income.ot, 900);
  // 15,600 + 15,600 + 16,500 — worked out by hand, and my first attempt at it was wrong, not the code
  eq('gross is the slips’ own gross, not a re-addition', r.income.gross, 47700);
  eq('net likewise', r.income.net, 44850);
  eq('🔴 another person’s slip never leaks in', r.income.base < 99999, true);
  eq('🔴 ...nor last year’s', r.pay.map(x => x.month), [Y + '-01', Y + '-02', Y + '-03']);

  /* THE FUND. The employee's half is summed; the school's half is derived at the configured match
   * rate; and the RUNNING TOTAL is read from the latest slip rather than added up, because it is a
   * balance carried forward and re-adding it would silently drop the opening balance. */
  eq('the fund deducted this year is the sum', r.fund.own, 600);
  eq('...the school matched it', r.fund.employer, 600);
  eq('...so the fund grew by both halves', r.fund.addedThisPeriod, 1200);
  eq('🔴 the running total comes from the latest slip, not from re-adding', r.fund.accum, 6200);
  eq('...and says which slip it is as of', r.fund.accumAsOf, Y + '-03');

  // nobody paid yet → the opening balance, said plainly rather than shown as zero
  const b = school(); const rb = ask(b.H);
  eq('with no slips at all, the fund shows the opening balance', rb.fund.accum, 5000);
  eq('...and says there is no slip behind it', rb.fund.accumAsOf, '');
  eq('...and the income is zero rather than an estimate', rb.income.gross, 0);
}

// ============================================================================================
console.log('4) lateness, dated');
// ============================================================================================
{
  const { M, H } = school();
  M.staffAttendanceHistory.push({ Date: shift(-3), StaffID: 'T1', In: '07:22', Out: '17:00', Late: 22 });
  M.staffAttendanceHistory.push({ Date: shift(-2), StaffID: 'T1', In: '07:00', Out: '17:00', Late: 0 });
  M.staffAttendanceHistory.push({ Date: shift(-1), StaffID: 'T1', In: '07:09', Out: '17:00', Late: 9 });
  const r = ask(H);
  eq('two late mornings', r.lateDays, 2);
  eq('...and the minutes add up', r.lateMinutes, 31);
  eq('each one is listed with its date and its arrival time', r.lates.map(x => x.minutes), [9, 22]);
  eq('...newest first', r.lates[0].date, shift(-1));
  eq('a punctual day is not in the list', r.lates.length, 2);
  eq('...and the count agrees with the list', r.lateDays, r.lates.length);
}

// ============================================================================================
console.log('5) whose year may be asked for');
// ============================================================================================
{
  const { H } = school();
  /* `targetId` is separate from `staffId` because applyIdentity_ forces staffId to the signed-in
   * person for every non-admin — one shared field would mean an admin could never look at a teacher
   * and a teacher could never look at themselves. Same shape as orgMoveTeacher. */
  ok_('an admin may ask about a teacher', !!ask(H).staffId);
  ok_('a teacher may ask about themselves',
    !!H.staffPerformance({ staffId: 'T1', targetId: 'T1', year: Y }).staffId);
  ok_('...and with no target at all, that is what they get',
    H.staffPerformance({ staffId: 'T1', year: Y }).staffId === 'T1');
  throws_('🔴 a teacher may NOT ask about a colleague',
    () => H.staffPerformance({ staffId: 'T1', targetId: 'T2', year: Y }), 'NO_PERMISSION');
  throws_('somebody who does not exist is refused, not answered with blanks',
    () => H.staffPerformance({ staffId: 'ADM', targetId: 'NOPE', year: Y }), 'NOT_FOUND');
  ok_('the route is NOT admin-only, because a teacher may read their own',
    !/ADMIN_ONLY = \{[^}]*staffPerformance/.test(codeGs));
}

// ============================================================================================
console.log('6) the screen');
// ============================================================================================
{
  ok_('A_staffPerf is defined', /window\.A_staffPerf = async \(staffId, year\)/.test(appCode));
  ok_('it asks for the target, not just the caller', /api\('staffPerformance',\{targetId:SPERF\.staffId, staffId:USER\.staffId/.test(appCode));
  ok_('🔴 the headline pair the ผอ. asked for by name', /วันที่ต้องมาทำงาน \(ถึงวันนี้\)/.test(app) && /มาทำงานจริง/.test(app));
  ok_('...with a bar that cannot read past 100%', /Math\.min\(100,pct\(d\.present\|\|0,d\.required\|\|0\)\)/.test(appCode));
  ok_('absent, leave, late, OT and missing clock-outs are all on it',
    ['ขาด', 'ลา', 'สาย', 'OT', 'ลืมออกงาน'].every(k => app.indexOf(k) > -1));
  ok_('🔴 the charts are inline SVG, drawn from the theme’s own colours',
    /function sperfBars/.test(appCode) && /style="fill:var\(--\$\{k\.c\}\)"/.test(appCode));
  ok_('...one of them is expected-vs-present', /\{k:'required'[\s\S]{0,120}\{k:'present'/.test(appCode));
  ok_('...one is absence, leave and lateness', /\{k:'absent'[\s\S]{0,160}\{k:'late'/.test(appCode));
  ok_('...and one is pay by month', /\{k:'gross'[\s\S]{0,80}\{k:'net'/.test(appCode));
  ok_('the dated histories are both there', /ประวัติการลา/.test(app) && /ประวัติการมาสาย/.test(app));
  // a status is a stored KEY — printed raw it read 'PENDING_LEADER' in the middle of a Thai line,
  // the same leak as EndReason did on the certificate list
  ok_('...and a pending leave shows a translated status, not the raw key',
    /leaveStatusPill\(String\(l\.status\)\.toUpperCase\(\)\)/.test(appCode));
  ok_('earnings are broken down and totalled', /รายได้รวมทั้งปี/.test(app) && /รับสุทธิ/.test(app));
  ok_('the fund shows both halves and the running total',
    /โรงเรียนสมทบ/.test(app) && /ยอดสะสมทั้งหมด/.test(app));
  ok_('...and says the figures come from issued slips, not a recalculation',
    /ดึงจากสลิปที่ออกจริง ไม่ได้คำนวณใหม่/.test(app));
  ok_('a year can be stepped through', /A_sperfYear/.test(appCode));
  ok_('it is reachable from the staff list', /A_staffPerf\('\$\{s\.StaffID\}'\)/.test(app));
  ok_('...and from the payroll screen, where pay is actually decided',
    /ดูสรุปผลการทำงานทั้งปีของคนนี้/.test(app));
}

// ============================================================================================
console.log('7) 🔴 the school did not always have a clock');
// ============================================================================================
{
  /* Reported 2026-10-05: "คุณครูที่อยู่ในระบบตั้งแต่แรก จะขาดงาน 125 วัน เราขึ้นระบบกับวันที่เริ่มให้ใช้
   * งานจริง คนละวันกัน".
   *
   * A teacher who started in 2024 owes every working day of the year by this calculation, and there
   * is no CHECKIN_STAFF row for any day before the school began clocking in — so every one came out
   * ABSENT. A hundred and twenty-five accusations against somebody with a clean record, on the
   * screen their pay is decided from. staffStarted_ could not fix it: that is when the PERSON
   * started, and the question is when the SCHOOL started.
   */
  const SEP = Y + '-09-01';
  const base = () => {
    const s = school();
    s.M.staffAttendanceHistory.push({ Date: SEP, StaffID: 'T1', In: '07:00', Out: '17:00', Late: 0 });
    s.M.staffAttendanceHistory.push({ Date: Y + '-09-02', StaffID: 'T1', In: '07:00', Out: '17:00', Late: 0 });
    return s;
  };
  const a = base(); const ra = ask(a.H);
  eq('the date is derived from the earliest clock-in on record', a.H.attendanceSince().derived, SEP);
  eq('...and that is what is used when nothing is configured', a.H.attendanceSince().effective, SEP);
  /* 🔴 THE WHOLE POINT. January to August is not absence — nobody was asked to clock in. */
  ok_('🔴 the months before it are not counted as absence', ra.absent < 40);
  ok_('...and they are not in the target either', ra.required > 0 && ra.required < 60);
  const jan = (ra.months || []).find(m => m.month === Y + '-01');
  ok_('🔴 a month before the clock existed contributes nothing at all',
    !jan || (jan.required === 0 && jan.absent === 0));
  /* BOTH SIDES, OR NEITHER. Taking the days out of requiredDates alone left the day cells saying
   * ABSENT, so the target dropped and the count underneath it did not: 24 expected, 195 absent. */
  ok_('🔴 the target and the absence count were fixed together', ra.absent <= ra.required);

  // ...and an admin can move it: the first week was a trial and should not count
  const b = base(); b.M.config.AttendanceSince = Y + '-09-02';
  const rb = ask(b.H);
  eq('a configured date wins over the derived one', b.H.attendanceSince().effective, Y + '-09-02');
  /* It moves the TARGET, not the records: one fewer day the school expected, and the clock-in that
   * already exists for the excluded day is still honoured (the CONTROL at the end of this section).
   * Anything else would mean an admin tidying the cut-off could delete somebody's attendance. */
  ok_('...and the day before it leaves the target', rb.required === ra.required - 1);
  eq('...while the attendance already recorded is untouched', rb.present, ra.present);
  eq('...while the derived date is still reported, so the admin can see what the data says',
    b.H.attendanceSince().derived, SEP);
  // clearing it goes back to deriving
  b.H.saveAttendanceSince({ staffId: 'ADM', date: '' });
  eq('clearing the override returns to the derived date', b.H.attendanceSince().effective, SEP);
  throws_('a future date is refused — it would erase the whole year',
    () => b.H.saveAttendanceSince({ staffId: 'ADM', date: shift(5) }), 'BAD_RANGE');

  /* 🔴 THE CALENDAR STILL SAYS WHY A DAY IS EMPTY. Put above the weekend and holiday tests, the
   * cut-off swallowed them — a Saturday in January came out BEFORE instead of OFF. */
  const sat = (() => { const d = new Date(Y + '-01-01T00:00:00');
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return DS(d); })();
  const att = a.H.staffAttendanceMonth({ staffId: 'ADM', from: Y + '-01-01', to: Y + '-12-31' });
  const row = (att.staff || []).find(x => x.staffId === 'T1') || {};
  const satCell = (row.days || []).find(x => x.date === sat);
  eq('🔴 a weekend before the cut-off still reads as a weekend', satCell && satCell.status, 'OFF');
  const workday = (row.days || []).find(x => x.date < SEP && x.status === 'BEFORE');
  ok_('...while a working day before it reads as "not part of this record"', !!workday);
  /* CONTROL: a check-in that DOES exist before the cut-off is still honoured — a record is a record. */
  const c = base(); c.M.config.AttendanceSince = Y + '-09-02';
  const catt = c.H.staffAttendanceMonth({ staffId: 'ADM', from: Y + '-09-01', to: Y + '-09-02' });
  const crow = (catt.staff || []).find(x => x.staffId === 'T1') || {};
  eq('CONTROL — a clock-in before the cut-off is still read as present',
    (crow.days || []).find(x => x.date === SEP).status, 'IN');
}

// ============================================================================
console.log('\n8) 🔴 a teacher who joined in June is not scored against January');
{
  /* Asked 2026-10-07: "ข้อมูลการมาทำงานให้นับจากวันเริ่มงานด้วย แยกเป็น 2 ส่วนคือวันที่ระบบใช้ Check-in
   * จริง และหากมีคุณครูที่มาหลังจากนั้นให้นับวันเริ่มทำงาน".
   *
   * v419 fixed the SCHOOL's floor — nobody owes the days before the school began clocking in. This is
   * the same fault one level down: everybody was then measured against the school's whole year, so a
   * teacher hired halfway through it carried months of absence from before she worked here. The two
   * floors have to COMPOSE, later one winning, which is what the school asked for in two parts. */
  const JUL = Y + '-07-01';
  const c = school({
    staff: [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' },
      { StaffID: 'OLD', NameTH: 'ครูเก่า', Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: '2024-01-01' },
      { StaffID: 'NEW', NameTH: 'ครูใหม่', Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: JUL }
    ],
    // the school has been clocking in since the start of the year, so the ONLY floor that can move
    // ครูใหม่'s target is her own first day
    config: { Timezone: 'Asia/Bangkok', ContributionMatchRate: 1, AttendanceSince: Y + '-01-01' }
  });
  const oldT = c.H.staffPerformance({ staffId: 'ADM', targetId: 'OLD', year: Y });
  const newT = c.H.staffPerformance({ staffId: 'ADM', targetId: 'NEW', year: Y });

  eq('the teacher who was here all year carries the school’s whole target',
    oldT.required, oldT.schoolRequired);
  ok_('🔴 ...and the one who joined in July carries less', newT.required < newT.schoolRequired);
  /* 🔴 ...and NOTHING BEFORE HER FIRST DAY is counted as absence. Her absences after July are real
   * (this fixture has her never clocking in), so the assertion has to be about WHICH months carry
   * them — a bare `absent === 0` would have passed on a fixture that proved nothing. */
  eq('🔴 no month before her first day carries any absence at all',
    (newT.months || []).filter(m => m.month < JUL.slice(0, 7) && (m.absent || m.required)).map(m => m.month), []);
  ok_('...while the teacher who was here all year does carry them', oldT.absent > newT.absent);
  /* THE NUMBER ITSELF, counted by hand from the same calendar rather than taken from the code:
   * her target is exactly the school's required days that fall on or after her first day. */
  const expected = (c.H.staffAttendanceMonth({ staffId: 'ADM', from: Y + '-01-01', to: Y + '-12-31' })
    .requiredDates || []).filter(ds => ds >= JUL && ds < DS(TODAY)).length;
  eq('🔴 ...her target is exactly the working days from her first day onward', newT.required, expected);
  // the screen prints the school's figure beside it so a smaller target reads as a date, not a bug
  ok_('the school’s own figure is still reported, for the row to explain itself with',
    newT.schoolRequired > 0 && newT.schoolRequiredWhole >= newT.schoolRequired);
  ok_('...and the screen actually says so', /counted from|นับตั้งแต่/.test(app) && /schoolRequired > d\.required/.test(appCode));

  /* 🔴 THE CHART AND THE HEADLINE ARE THE SAME NUMBER. The per-month bars are filtered separately
   * from the headline; two filters is how a screen ends up with 112 at the top and 180 in the bars,
   * and the reviewer believes whichever they read first. */
  eq('🔴 the months add up to the headline',
    (newT.months || []).reduce((a, m) => a + m.required, 0), newT.required);
  eq('...and for the teacher who was here all year too',
    (oldT.months || []).reduce((a, m) => a + m.required, 0), oldT.required);
  // ...and the monthly screen's own per-person count is the same rule, so the two screens agree
  eq('🔴 the monthly screen’s figure for her matches this one', newT.myRequired, newT.required);

  /* 🔴 CONTROL — AND THE SCORE CANNOT GO ABOVE 100%.
   *
   * The danger in moving a floor is always the same one §1 was written about: cut `required` and
   * leave `present` counting the whole year, and somebody shows 197 of 195. Here the risk is a
   * check-in that exists BEFORE the person's recorded start date — a back-filled StartDate, or
   * somebody who came in early to help.
   *
   * THE TWO FLOORS ARE DELIBERATELY ASYMMETRIC, and this pins the difference so neither drifts:
   *
   *   · the SCHOOL's floor (attendanceSince_) is tested LAST in the status chain, so a real clock-in
   *     before it still reads IN — "a record is a record whatever the cut-off says";
   *   · a PERSON's own start date is tested FIRST, so the day is not part of their record at all.
   *
   * The second is what keeps present ≤ required: a day nobody owes cannot be a day somebody
   * over-attended. The check-in row is untouched in the sheet either way. */
  const c2 = school({
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' },
            { StaffID: 'NEW', NameTH: 'ครูใหม่', Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: JUL }],
    staffAttendanceHistory: [{ StaffID: 'NEW', Date: Y + '-06-02', In: '07:00', Out: '17:00', Late: 0 }],
    config: { Timezone: 'Asia/Bangkok', ContributionMatchRate: 1, AttendanceSince: Y + '-01-01' }
  });
  const att2 = c2.H.staffAttendanceMonth({ staffId: 'ADM', from: Y + '-06-01', to: Y + '-06-30' });
  const row2 = (att2.staff || []).find(x => x.staffId === 'NEW') || {};
  eq('a day before her own first day is outside her record, not an absence',
    ((row2.days || []).find(x => x.date === Y + '-06-02') || {}).status, 'BEFORE');
  const perf2 = c2.H.staffPerformance({ staffId: 'ADM', targetId: 'NEW', year: Y });
  ok_('🔴 CONTROL · ...so present can never exceed the target', perf2.present <= perf2.required);
  // ...and the school's own floor still keeps a real clock-in before IT, which is the other half
  const c3 = school({
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' },
            { StaffID: 'OLD', NameTH: 'ครูเก่า', Role: 'Teacher', StaffGroup: 'G1', Status: 'ACTIVE', StartDate: '2024-01-01' }],
    staffAttendanceHistory: [{ StaffID: 'OLD', Date: Y + '-06-02', In: '07:00', Out: '17:00', Late: 0 }],
    config: { Timezone: 'Asia/Bangkok', ContributionMatchRate: 1, AttendanceSince: Y + '-07-01' }
  });
  const row3 = ((c3.H.staffAttendanceMonth({ staffId: 'ADM', from: Y + '-06-01', to: Y + '-06-30' }).staff) || [])
    .find(x => x.staffId === 'OLD') || {};
  eq('CONTROL · a clock-in before the SCHOOL’s cut-off is still read as present',
    ((row3.days || []).find(x => x.date === Y + '-06-02') || {}).status, 'IN');
}

// ============================================================================
console.log('\n9) 🔴 the annual review is the teaching staff, and nobody else');
{
  /* Asked 2026-10-07: "เอา Role Admin/Observer และคุณเติ้ล (แม่บ้าน) ออกจากสรุปรายปี เอาเฉพาะคุณครู
   * เท่านั้น". A DIFFERENT list from payroll's, which deliberately keeps the ผอ. because they are an
   * Admin who is paid — see the note on payableStaff. Two questions, two filters. */
  ok_('the review has a filter of its own', /const reviewStaff = list =>/.test(appCode));
  ok_('🔴 ...and it is teachers only', /String\(s\.Role\|\|''\)==='Teacher'/.test(appCode));
  ok_('🔴 ...the housekeeper’s flag still applies on top', /reviewStaff = list =>[^;]*!s\.noPayroll/.test(appCode));
  ok_('...and somebody who has left is still out', /reviewStaff = list =>[^;]*!s\.ended/.test(appCode));
  ok_('🔴 the annual screen uses it', /reviewStaff\(await api\('listStaff'\)/.test(appCode));
  /* CONTROL — PAYROLL MUST NOT HAVE CHANGED. The ผอ. is paid through this app; a filter applied to
   * both lists would have taken the director's own payslip off the screen, which the school settled
   * on 2026-09-29 and is a worse fault than a spare row on a review. */
  ok_('CONTROL · payroll still uses its own, wider list',
    /const payable=payableStaff\(staff\)/.test(appCode));
  ok_('CONTROL · ...and payableStaff still does NOT filter by Role==="Teacher"',
    !/payableStaff = list =>[^;]*Role\|\|''\)==='Teacher'/.test(appCode));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
