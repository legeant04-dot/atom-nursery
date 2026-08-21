/**
 * tools/test_holiday_ot_pay.js — OT วันหยุด reaches the payslip on its OWN line, the teacher is told,
 * and the day shows on the Admin calendar.
 *   node tools/test_holiday_ot_pay.js
 *
 * Three things were wrong with the first version, all reported after using it:
 *
 *   1. THE SLIP. Holiday OT was folded into "ค่าล่วงเวลาตอนเย็น". A teacher would have read ฿1,200 of
 *      evening overtime for a month where ฿500 of it was a Sunday they came in for, with nothing on
 *      the slip saying so. It is its own line now (OTHoliday), and the payroll screen its own field.
 *
 *      That split has a second, quieter consequence: otCarryOver_ pays forward what a month APPROVED
 *      minus what its saved payslip PAID into OTEvening. If holiday OT is paid on a different line
 *      but still counted as approved evening OT, every month looks short-paid and carries the same
 *      amount forward for ever. So the daily/holiday split has to reach the carry-over too.
 *
 *   2. NOBODY TOLD THE TEACHER. Money agreed for a day they worked, that they are never told about,
 *      is indistinguishable from money that was forgotten — and the one person who would notice it
 *      missing was the one person not told.
 *
 *   3. IT WAS INVISIBLE ON THE CALENDAR that the Admin actually looks at, sitting instead in a list
 *      you have to know to open.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), pay = R('src/Payroll.gs'),
      ot = R('src/OtStaff.gs'), cfg = R('src/Config.gs');

function boot(over) {
  const M = {
    // the diligence/child amounts must be present or the engine's mock computePayroll produces NaN
    // for DiligenceTotal and OtherIncome — nothing to do with OT, but it would hide the gross
    config: { Plans: [], LeaveQuota: {}, SocialSecurityRate: 0.05, SocialSecurityMax: 750, ExtraChildRate: 300,
      DiligenceAttendanceAmount: 0, DiligenceFacebookAmount: 0, TrainingCertRate: 0, TrainingCertMaxPerMonth: 2,
      ExtraChildThreshold: 31, BigCleaningAmount: 0 },
    payrollConfig: { S1: { ChildMultiplier: 0, DailyRate: 0 } },
    staff: [{ StaffID: 'A1', NameTH: 'แอดมิน', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' },
            { StaffID: 'S1', NameTH: 'ครูเอ', Name: 'ครูเอ', Role: 'Teacher', Salary: 15000, BaseSalary: 15000 }],
    otRecords: [], payroll: [], payrollConfig: {},
    students: [], parents: [], userLinks: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const MONTH = '2026-08';
const daily = (id, amt) => ({ OTRecordID: id, StaffID: 'S1', Date: '2026-08-03', Month: MONTH, Hours: amt / 100, Rate: 100, Amount: amt, Status: 'APPROVED' });
const holi  = (id, amt) => ({ OTRecordID: id, StaffID: 'S1', Date: '2026-08-22', Month: MONTH, Hours: 0, Rate: 0, Amount: amt, Status: 'APPROVED', Kind: 'HOLIDAY' });

console.log('\n1) the two are reported apart, and totalled apart');
{
  const { H } = boot({ otRecords: [daily('D1', 700), holi('H1', 500)] });
  const s = H.staffMonthlyOT({ staffId: 'S1', month: MONTH });
  eq('evening OT on its own', s.daily, 700);
  eq('holiday OT on its own', s.holiday, 500);
  eq('...and how many holiday days', s.holidayDays, 1);
  eq('the combined total is still available', s.amount, 1200);
  eq('hours count only what was clocked', s.hours, 7);
}

console.log('\n2) the payslip pays them on separate lines');
{
  const { H, M } = boot({ otRecords: [daily('D1', 700), holi('H1', 500)] });
  const r = H.computePayroll({ staffId: 'S1', month: MONTH, baseSalary: 15000, otEvening: 700 });
  eq('holiday OT is picked up without being asked for', r.OTHoliday, 500);
  eq('...and is NOT inside the evening figure', r.OTEvening, 700);
  eq('both are inside the gross', r.GrossIncome, 15000 + 700 + 500);
  const saved = M.payroll[M.payroll.length - 1] || {};
  eq('the slip row stores it', [saved.OTEvening, saved.OTHoliday], [700, 500]);
}
{
  // an Admin override still wins, the same as every other line on this screen
  const { H } = boot({ otRecords: [holi('H1', 500)] });
  const r = H.computePayroll({ staffId: 'S1', month: MONTH, baseSalary: 15000, otEvening: 0, otHoliday: 800 });
  eq('an explicit amount overrides the automatic one', r.OTHoliday, 800);
  eq('...and the gross follows it', r.GrossIncome, 15800);
}
{
  const { H } = boot({ otRecords: [daily('D1', 700)] });
  const r = H.computePayroll({ staffId: 'S1', month: MONTH, baseSalary: 15000, otEvening: 700 });
  eq('a month with no holiday OT reads exactly as it did before', [r.OTHoliday, r.GrossIncome], [0, 15700]);
}

console.log('\n3) the carry-over must not chase holiday OT for ever');
{
  // July: 700 evening + 500 holiday approved. July's payslip paid OTEvening 700 (and the holiday on
  // its own line). August must carry NOTHING — the old code would have seen 1,200 approved against
  // 700 paid and carried 500 every single month from then on.
  const { H } = boot({
    otRecords: [
      { OTRecordID: 'D1', StaffID: 'S1', Date: '2026-07-03', Month: '2026-07', Hours: 7, Rate: 100, Amount: 700, Status: 'APPROVED' },
      { OTRecordID: 'H1', StaffID: 'S1', Date: '2026-07-20', Month: '2026-07', Hours: 0, Amount: 500, Status: 'APPROVED', Kind: 'HOLIDAY' }],
    payroll: [{ PayrollID: 'PR-1', StaffID: 'S1', Month: '2026-07', OTEvening: 700, OTHoliday: 500, OTCarryDetail: '[]' }]
  });
  const c = H.otCarryOver({ staffId: 'S1', month: MONTH });
  eq('nothing is carried — July was paid in full', c.total, 0);
  ok_('...and no month is listed as owing', !(c.detail || []).length);
}
{
  // the carry-over must still WORK for genuinely unpaid evening OT
  const { H } = boot({
    otRecords: [{ OTRecordID: 'D1', StaffID: 'S1', Date: '2026-07-31', Month: '2026-07', Hours: 3, Rate: 100, Amount: 300, Status: 'APPROVED' }],
    payroll: [{ PayrollID: 'PR-1', StaffID: 'S1', Month: '2026-07', OTEvening: 0, OTCarryDetail: '[]' }]
  });
  eq('evening OT approved after the slip was saved is still carried', H.otCarryOver({ staffId: 'S1', month: MONTH }).total, 300);
}
{
  ok_('the GAS side splits it the same way', /function otApprovedByMonth_\(staffId, kind\)/.test(pay));
  ok_('...defaulting to DAILY, so the carry-over is unaffected by holiday OT', /if \(kind !== 'holiday' && isHol\) return;.*\n.*default = daily only|if \(kind !== 'holiday' && isHol\) return;/.test(pay));
  ok_('there is a holiday total to pay from', /function sumMonthlyHolidayOT_\(staffId, month\)/.test(pay));
  ok_('it is added to the gross as its own term', /base \+ diligenceTotal \+ otherIncome \+ otEvening \+ otCarry \+ otHoliday \+ holidayBonus/.test(pay));
  ok_('...and written to the payslip row', /OTHoliday: otHoliday,/.test(pay));
  ok_('the column exists', /'OTEvening', 'OTHoliday', 'HolidayBonus'/.test(cfg));
  ok_('...and is topped up on the LIVE sheet', /'OTCarry', 'OTCarryDetail', 'OTHoliday'\]/.test(pay));
}

console.log('\n4) the teacher is told');
{
  ok_('granting it writes to that teacher\'s own inbox', /inboxAdd_\('ot', '🎉 OT วันหยุด '/.test(ot));
  ok_('...addressed to them, not the shared Admin inbox', /'ot\|' \+ target \+ '\|' \+ date, target\);/.test(ot));
  ok_('the message says the amount, the day and why', /amount \+ ' บาท\\n' \+ note/.test(ot));
  ok_('...and which month\'s pay it will appear in', /จะรวมในเงินเดือนเดือน/.test(ot));
  ok_('a failure to notify never loses the OT itself', /try \{\s*\n\s*inboxAdd_\('ot'[\s\S]{0,400}\} catch \(e\) \{\}/.test(ot));
  // the per-staff inbox is what the teacher's bell already reads
  ok_('the bell serves staff their own rows', /if \(p\.staffId\) return shape\(handleStaffInbox\(p\)\);/.test(R('src/Notify.gs')));
}

console.log('\n5) it shows on the calendar the Admin actually looks at');
{
  // v256: the same pair of string tests appeared at four call sites; isLiveHolOT is now the one place
  ok_('the ops screen fetches the month\'s holiday OT', /window\._LV_HOT=\(_ot\|\|\[\]\)\.filter\(isLiveHolOT\)/.test(app));
  ok_('...and rejected ones are not drawn', /const isLiveHolOT = o => isHolOT\(o\) && String\(\(o && o\.Status\) \|\| ''\)\.toUpperCase\(\) !== 'REJECTED';/.test(app));
  ok_('the calendar marks the day', /const otByDay=\{\}; \(window\._LV_HOT\|\|\[\]\)\.forEach/.test(app));
  ok_('...with who was in, by name', /title="\$\{esc\(EN\(\)\?'Holiday OT':'OT วันหยุด'\)\}: \$\{esc\(ot\.join\(', '\)\)\}"/.test(app));
  ok_('...one name, or a count when there were several', /🎉 \$\{esc\(ot\.length===1\?ot\[0\]:ot\.length\)\}/.test(app));
  ok_('the legend says what the mark means', /🎉 OT วันหยุด`/.test(app));
  ok_('granting one redraws the calendar underneath, not just the list', /if\(window\._CALRENDER\)\{ const w=document\.getElementById\('calWrap'\); if\(w\) w\.innerHTML=window\._CALRENDER\(\); \}/.test(app));
}

console.log('\n6) the slip itself says "OT วันหยุด"');
{
  ok_('on the teacher\'s payslip card', /<tr><td>🎉 OT วันหยุด<\/td>/.test(app));
  ok_('...only when there is some, so an ordinary slip is unchanged', /\$\{Number\(r\.OTHoliday\|\|0\)\?`<tr><td>🎉 OT วันหยุด/.test(app));
  ok_('and on the printed A4 slip', /\$\{Number\(p\.OTHoliday\|\|0\)\?'OT วันหยุด':'เงินพิเศษวันพักผ่อน'\}/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
