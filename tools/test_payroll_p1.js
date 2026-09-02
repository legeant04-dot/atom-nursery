/**
 * tools/test_payroll_p1.js — Phase 1 payroll harness (OT rate, OT carry-over, เงินสมทบ ×2).
 * Runs src/Payroll.gs against in-memory "sheets" so the money rules can be checked without GAS.
 *   node tools/test_payroll_p1.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---- fake sheet layer -------------------------------------------------------
const DB = {};                                     // name -> array of row objects
function mkSheet(name) { return { __name: name }; }
global.sheet_ = (ss, name) => mkSheet(name);
global.getHrSpreadsheet_ = () => ({});
global.getMainSpreadsheet_ = () => ({});
global.readObjects_ = sh => (DB[sh.__name] || []).map((r, i) => {
  const o = Object.assign({}, r);
  Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
  return o;
});
global.findObject_ = (sh, pred) => global.readObjects_(sh).find(pred) || null;
global.updateRow_ = (sh, row, patch) => Object.assign(DB[sh.__name][row - 2], patch);
global.appendObject_ = (sh, obj) => { (DB[sh.__name] = DB[sh.__name] || []).push(Object.assign({}, obj)); };
global.ensureColumns_ = () => {};
global.nextId_ = (sh, f, p) => p + '-' + ((DB[sh.__name] || []).length + 1);
global.apiError_ = (c, m) => Object.assign(new Error(m), { code: c });
global.logAuditHr = () => {};
global.dateStr_ = d => new Date(d).toISOString().slice(0, 10);
global.Session = { getScriptTimeZone: () => 'UTC' };
global.Utilities = { formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 7) };
global.CacheService = { getScriptCache: () => ({ removeAll() {} }) };

let CONFIG = {};
global.getConfig_ = (k, d) => (CONFIG[k] !== undefined ? CONFIG[k] : d);
global.setConfigValue_ = (k, v) => { CONFIG[k] = v; };
global.bigCleaningDays_ = () => [];

// load the real files into the global scope. OtStaff.gs comes first: since v242 the OT total is
// split daily-vs-holiday (holiday OT is paid on its own payslip line, so it must not count against
// what OTEvening paid) and otIsHoliday_ — the ONE predicate that decides which is which — lives
// there. Loading the real one, rather than stubbing it, means a change to it is caught here.
(0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'OtStaff.gs'), 'utf8'));
(0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'Payroll.gs'), 'utf8'));

// ---- assertions -------------------------------------------------------------
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function reset() {
  DB.STAFF = [{ StaffID: 'STF-006', Name: 'ฟิล์ม', BaseSalary: 14300, BankAccount: '123-4', ContributionOpening: 35000, ContributionAccum: 0 }];
  DB.OT_RECORDS = []; DB.PAYROLL = []; DB.LEAVE_REQUEST = []; DB.CHECKIN_STAFF = [];
  CONFIG = { SocialSecurityRate: '0.05', SocialSecurityMax: '750', DiligenceAttendanceAmount: '500',
    DiligenceFacebookAmount: '500', ExtraChildRate: '300', TrainingCertRate: '100', TrainingCertMaxPerMonth: '2',
    StaffOTHourlyRate: '100', ContributionMatchRate: '1', OTEveningRate: '0', BigCleaningAmount: '0' };
}
const basePay = extra => Object.assign({ staffId: 'STF-006', month: '2026-08', attendanceEligible: false,
  extraChildCount: 0, trainingCertCount: 0, socialSecurityDeduct: false, generatedBy: 'test' }, extra || {});

// ============================================================================
console.log('\n1) OT rate is the flat StaffOTHourlyRate, not 1.5 × salary/30/8');
reset();
// otRateForStaff_ lives in Checkin.gs — load just that function
// ...with line endings normalised first: a checkout with CRLF made `\n}\n` never match, and the
// suite died on `[0] of null` — a source file's line endings must not decide whether tests run.
(0, eval)(fs.readFileSync(path.join(ROOT, 'src', 'Checkin.gs'), 'utf8').replace(/\r\n/g, '\n')
  .match(/function otRateForStaff_[\s\S]*?\n}\n/)[0]);
eq('flat 100 even with a salary on file', otRateForStaff_(DB.STAFF[0]), 100);
CONFIG.StaffOTHourlyRate = '120';
eq('admin can change it', otRateForStaff_(DB.STAFF[0]), 120);
CONFIG.StaffOTHourlyRate = 'auto';
eq('"auto" restores the labour-law rate (14300 → 89.38)', otRateForStaff_(DB.STAFF[0]), 89.38);
CONFIG.StaffOTHourlyRate = '100';

// ============================================================================
console.log('\n2) เงินสมทบ: deduct 200, school matches 200, fund 35000 → 35400');
reset();
let r = computePayroll(basePay({ contribution: 200 }));
eq('deducted from the teacher', r.Contribution, 200);
eq('school half recorded', r.ContributionEmployer, 200);
eq('รวมหัก has ONLY the teacher half', r.TotalDeductions, 200);
eq('accumulated fund 35000 + 200 + 200', r.ContributionAccum, 35400);
eq('written back to the staff record', DB.STAFF[0].ContributionAccum, 35400);

console.log('   next month adds another 400 on top');
r = computePayroll(basePay({ month: '2026-09', contribution: 200 }));
eq('35400 + 400', r.ContributionAccum, 35800);

console.log('   re-saving the SAME month must not double-count it');
r = computePayroll(basePay({ month: '2026-09', contribution: 200 }));
eq('still 35800', r.ContributionAccum, 35800);

console.log('   match rate 0 = school adds nothing');
reset(); CONFIG.ContributionMatchRate = '0';
r = computePayroll(basePay({ contribution: 200 }));
eq('fund grows by the teacher half only', r.ContributionAccum, 35200);

// ============================================================================
console.log('\n3) OT approved after the month was paid → carried to the next slip');
reset();
// July: OT of 31/07 still PENDING when July payroll is saved with OT 0
DB.OT_RECORDS.push({ OTRecordID: 'OTR-1', StaffID: 'STF-006', Date: '2026-07-31', Month: '2026-07',
  Hours: 2, Rate: 100, Amount: 200, Status: 'PENDING_ADMIN' });
computePayroll(basePay({ month: '2026-07', otEvening: 0 }));
eq('July slip paid no OT', DB.PAYROLL[0].OTEvening, 0);
eq('nothing to carry yet (still pending)', otCarryOver_('STF-006', '2026-08').total, 0);

console.log('   …admin approves it in August');
DB.OT_RECORDS[0].Status = 'APPROVED';
const c = otCarryOver_('STF-006', '2026-08');
eq('August owes it', c.total, 200);
// v261: ...and HOW MANY HOURS. The carry is paid as an amount, so the slip only ever said baht and
// a teacher could not check it against the evenings she remembers working. The hours are that
// amount's share of the month it came from — here, the whole of July's 2 hours.
// 2026-08-30: the entry also carries the month's approved/paid totals and its individual evenings,
// so the admin can see what the carry is made of. Assert the three fields this test is about rather
// than the whole object — a deep-equal here fails on anything ADDED, which is not a regression.
eq('and says which month', c.detail.map(d => ({ month: d.month, amount: d.amount, hours: d.hours })),
  [{ month: '2026-07', amount: 200, hours: 2 }]);
eq('...and which evening it was', c.detail[0].days.map(d => d.date), ['2026-07-31']);
eq('...and the total carries the hours too', c.hours != null ? c.hours : handleOtCarryOver({ staffId: 'STF-006', month: '2026-08' }).hours, 2);

r = computePayroll(basePay({ month: '2026-08', otEvening: 0, baseSalary: 14300 }));
eq('carry is on the August slip', r.OTCarry, 200);
eq('and inside รวมรายได้ (14300 + 200)', r.GrossIncome, 14500);
eq('July slip untouched', DB.PAYROLL[0].OTEvening, 0);

console.log('   September must NOT pay it a second time');
eq('carry cleared', otCarryOver_('STF-006', '2026-09').total, 0);
r = computePayroll(basePay({ month: '2026-09', otEvening: 0, baseSalary: 14300 }));
eq('September carries nothing', r.OTCarry, 0);

console.log('   re-saving August is idempotent');
r = computePayroll(basePay({ month: '2026-08', otEvening: 0, baseSalary: 14300 }));
eq('still 200, not 400', r.OTCarry, 200);

// ============================================================================
console.log('\n4) Sheets date coercion: Month cells come back as Date objects');
reset();
DB.OT_RECORDS.push({ OTRecordID: 'OTR-2', StaffID: 'STF-006', Date: '2026-07-15',
  Month: new Date('2026-07-01T00:00:00Z'), Hours: 1, Amount: 100, Status: 'APPROVED' });
eq('a coerced Month still lands in the right bucket', sumMonthlyOT_('STF-006', '2026-07'), 100);
eq('and not in another month', sumMonthlyOT_('STF-006', '2026-08'), 0);

// ============================================================================
console.log('\n5) A month with NO saved payslip is never carried');
reset();
DB.OT_RECORDS.push({ OTRecordID: 'OTR-3', StaffID: 'STF-006', Date: '2026-07-10', Month: '2026-07',
  Hours: 3, Amount: 300, Status: 'APPROVED' });
eq('July has no slip yet → not owed in August', otCarryOver_('STF-006', '2026-08').total, 0);
eq('July pays it normally when July is run', sumMonthlyOT_('STF-006', '2026-07'), 300);

// ============================================================================
console.log('\n6) Totals still agree with their own columns');
reset();
r = computePayroll(basePay({ baseSalary: 14300, contribution: 200, socialSecurityDeduct: true,
  adjustments: [{ label: 'มาสาย', amount: -300 }, { label: 'โบนัส', amount: 500 }] }));
eq('gross = base + income lines', r.GrossIncome, 14300 + 500);
eq('deductions = SS + contribution + negative lines', r.TotalDeductions, 715 + 200 + 300);
eq('net = gross − deductions', r.NetPay, r.GrossIncome - r.TotalDeductions);

// ============================================================================
console.log('\n7) Preview writes nothing');
reset();
computePayroll(basePay({ contribution: 200, preview: true }));
eq('PAYROLL untouched', DB.PAYROLL.length, 0);
eq('staff fund untouched', DB.STAFF[0].ContributionAccum, 0);

// ============================================================================
console.log('\n8) Back-fill tool: preview first, then apply');
reset();
// two months already on file, saved before the employer half existed (no ContributionEmployer cell)
DB.PAYROLL.push({ PayrollID: 'PR-1', StaffID: 'STF-006', Month: '2026-06', Contribution: 200 });
DB.PAYROLL.push({ PayrollID: 'PR-2', StaffID: 'STF-006', Month: '2026-07', Contribution: 200 });
DB.STAFF[0].ContributionAccum = 35400;          // the old ×1 figure: 35000 + 200 + 200
let pv = handleRecomputeContributions({ preview: true });
eq('one staff member would change', pv.changed, 1);
eq('before', pv.rows[0].before, 35400);
eq('after — both halves of both months', pv.rows[0].after, 35800);
eq('preview wrote NOTHING', DB.STAFF[0].ContributionAccum, 35400);
const ap = handleRecomputeContributions({ preview: false });
eq('apply wrote one row', ap.written, 1);
eq('staff record updated', DB.STAFF[0].ContributionAccum, 35800);
eq('running it again is a no-op', handleRecomputeContributions({ preview: true }).changed, 0);

console.log('   a locked opening balance is reported but the total is still rebuilt');
reset();
DB.STAFF[0].ContributionLocked = 'YES';
DB.PAYROLL.push({ PayrollID: 'PR-1', StaffID: 'STF-006', Month: '2026-07', Contribution: 200 });
pv = handleRecomputeContributions({ preview: true });
eq('flagged as locked', pv.rows[0].locked, true);
handleRecomputeContributions({ preview: false });
eq('opening untouched', DB.STAFF[0].ContributionOpening, 35000);
eq('total rebuilt', DB.STAFF[0].ContributionAccum, 35400);

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} checks passed`));
process.exit(fail ? 1 : 0);
