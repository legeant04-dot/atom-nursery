/**
 * tools/test_billing_p2.js — Phase 2 billing harness (enrol date + mid-month rules, prepay tiers).
 * Runs the SHARED engine (webapp/engine.js) on an in-memory dataset.
 *   node tools/test_billing_p2.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const { createAtomAPI } = require(path.join(ROOT, 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function throws(label, fn, codeRe) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const m = String((e && (e.code || e.message)) || e);
    const ok = !codeRe || codeRe.test(m);
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  threw=' + m.slice(0, 60)); ok ? pass++ : fail++; }
}

function fresh(students) {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, start: '07:00', end: '17:00' }],
      PrepayTiers: [{ months: 3, discount: 5 }, { months: 6, discount: 10 }, { months: 12, discount: 15 }],
      OTRatePerHour: 100, OTGraceMinutes: 21, DefaultCheckOutTime: '17:00' },
    students: students, staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [], payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [],
    otRecords: [], payroll: [],
    userLinks: [], checkinStudent: [], studentAttendanceToday: [], activityLog: [], studentLeaves: [], comments: []
  };
  return { M, H: createAtomAPI(M).H };
}
const kid = extra => Object.assign({ StudentID: 'STD-1', NameTH: 'น้องอลัน', Nickname: 'อลัน',
  Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE' }, extra || {});

// ============================================================================
console.log('\n1) A student whose first day is next month gets NO bill this month');
{
  const { M, H } = fresh([kid({ EnrollDate: '2026-09-01' })]);
  const r = H.generateMonthlyBills({ month: '2026-08' });
  eq('nothing billed', r.created, 0);
  eq('reported as not started yet', r.notYet.map(x => x.enrolDate), ['2026-09-01']);
  eq('no BILLING row at all', M.payments.length, 0);
  const sep = H.generateMonthlyBills({ month: '2026-09' });
  eq('September bills normally', sep.created, 1);
  eq('at the full price', M.payments[0].Amount, 5900);
}

console.log('\n2) issueBill refuses a month before the first day, by name');
{
  const { H } = fresh([kid({ EnrollDate: '2026-09-15' })]);
  throws('August is rejected', () => H.issueBill({ studentId: 'STD-1', month: '2026-08' }), /NOT_ENROLLED_YET|ยังไม่ถึงเดือน/);
  eq('but an explicit amount is still honoured', H.issueBill({ studentId: 'STD-1', month: '2026-08', amount: 1000 }).Amount, 1000);
}

console.log('\n3) The four mid-month rules (returns 16 Aug, 31-day month)');
const modes = { FULL: 5900, HALF: 2950, DAILY: Math.round(5900 * 16 / 31), MANUAL: 3000 };
Object.keys(modes).forEach(mode => {
  const { M, H } = fresh([kid({ EnrollDate: '2026-08-16', ProrateMode: mode, ProrateAmount: 3000 })]);
  H.generateMonthlyBills({ month: '2026-08' });
  eq(mode.padEnd(6) + ' first month', M.payments[0].Amount, modes[mode]);
  if (mode !== 'FULL') {
    const label = String(M.payments[0].Items[0][0]);
    eq(mode.padEnd(6) + ' bill says why', /เริ่มเรียน 2026-08-16/.test(label), true);
  }
});
console.log('   …and every LATER month is the full price again');
{
  const { M, H } = fresh([kid({ EnrollDate: '2026-08-16', ProrateMode: 'HALF' })]);
  H.generateMonthlyBills({ month: '2026-08' });
  H.generateMonthlyBills({ month: '2026-09' });
  eq('August half', M.payments[0].Amount, 2950);
  eq('September full', M.payments[1].Amount, 5900);
}
console.log('   …starting on the 1st is never prorated');
{
  const { M, H } = fresh([kid({ EnrollDate: '2026-08-01', ProrateMode: 'HALF' })]);
  H.generateMonthlyBills({ month: '2026-08' });
  eq('full price', M.payments[0].Amount, 5900);
}
console.log('   …a blank enrol date behaves exactly as before');
{
  const { M, H } = fresh([kid({})]);
  H.generateMonthlyBills({ month: '2026-08' });
  eq('billed in full', M.payments[0].Amount, 5900);
}

console.log('\n4) The standing discount is applied BEFORE the mid-month rule');
{
  const { M, H } = fresh([kid({ EnrollDate: '2026-08-16', ProrateMode: 'HALF', DiscountAmount: 900, DiscountUnit: 'บาท' })]);
  H.generateMonthlyBills({ month: '2026-08' });
  eq('(5900 − 900) ÷ 2', M.payments[0].Amount, 2500);
}

console.log('\n5) A batch bills everyone it can and reports the rest');
{
  const { H } = fresh([kid({ StudentID: 'STD-1' }),
    kid({ StudentID: 'STD-2', EnrollDate: '2026-12-01' }),
    kid({ StudentID: 'STD-3', Plan: '' })]);
  const r = H.issueBillsFor({ studentIds: ['STD-1', 'STD-2', 'STD-3'], month: '2026-08', staffId: 'STF-A' });
  eq('one billed', r.created, 1);
  eq('two skipped, each with a reason', r.skipped.map(x => x.studentId), ['STD-2', 'STD-3']);
  eq('and the reasons are readable', r.skipped.every(x => x.reason && x.reason.length > 5), true);
}

// ============================================================================
console.log('\n6) Prepay tiers come from config, not from code');
{
  const { M, H } = fresh([kid({})]);
  eq('school table 3/6/12', H.prepayTiers().map(t => t.months + ':' + t.discount), ['3:5', '6:10', '12:15']);
  eq('6 months → 10%', H.prepayDiscount(6), 10);
  eq('2 months is not a published tier', H.prepayDiscount(2), 0);
  console.log('   the attachment’s figures, on a 5,900 package');
  eq('3 months  17,700 → 16,815', H.prepay({ studentId: 'STD-1', months: 3, startMonth: '2026-09' }).Amount, 16815);
  eq('6 months  35,400 → 31,860', H.prepay({ studentId: 'STD-1', months: 6, startMonth: '2026-09' }).Amount, 31860);
  eq('12 months 70,800 → 60,180', H.prepay({ studentId: 'STD-1', months: 12, startMonth: '2026-09' }).Amount, 60180);

  console.log('   admin edits the table → new quotes follow it');
  H.savePrepayTiers({ staffId: 'STF-A', tiers: [{ months: 2, discount: 10 }, { months: 6, discount: 12 }] });
  eq('saved + sorted', M.config.PrepayTiers.map(t => t.months), [2, 6]);
  eq('2 months now 10%', H.prepayDiscount(2), 10);
  eq('and 3 months is no longer offered', H.prepayDiscount(3), 0);
  throws('a parent cannot buy an unpublished tier', () => H.prepay({ studentId: 'STD-1', months: 3 }), /BAD_INPUT|เลือกจำนวนเดือน/);
  eq('a non-admin cannot edit the table',
    (() => { try { H.savePrepayTiers({ staffId: 'nobody', tiers: [{ months: 1, discount: 99 }] }); return 'ALLOWED'; }
      catch (e) { return 'blocked'; } })(), 'blocked');
}

console.log('\n7) Admin one-off rate, and re-pricing an unpaid advance payment');
{
  const { M, H } = fresh([kid({})]);
  const pp = H.prepay({ studentId: 'STD-1', months: 2, discount: 10, role: 'Admin', startMonth: '2026-09' });
  eq('2 months at an agreed 10%', pp.Amount, Math.round(5900 * 2 * 0.9));
  eq('covers Sep + Oct', pp.Covered, ['2026-09', '2026-10']);
  throws('a parent may NOT set their own discount',
    () => H.prepay({ studentId: 'STD-1', months: 2, discount: 90 }), /BAD_INPUT/);

  const ed = H.editPrepay({ staffId: 'STF-A', prepayId: pp.PrepayID, months: 3, discount: 20 });
  eq('re-priced', ed.Amount, Math.round(5900 * 3 * 0.8));
  eq('and the cover extended', ed.Covered, ['2026-09', '2026-10', '2026-11']);

  console.log('   changing the tier table later must NOT re-price it');
  H.savePrepayTiers({ staffId: 'STF-A', tiers: [{ months: 3, discount: 1 }] });
  eq('frozen at the agreed 20%', M.prepayments[0].Discount, 20);

  pp.Status = 'PAID';
  throws('a PAID advance payment is untouchable',
    () => H.editPrepay({ staffId: 'STF-A', prepayId: pp.PrepayID, months: 12 }), /ALREADY_PAID/);
}

console.log('\n8) A prepaid month bills 0 and says so');
{
  const { M, H } = fresh([kid({})]);
  const pp = H.prepay({ studentId: 'STD-1', months: 6, startMonth: '2026-09' });
  pp.Status = 'PAID';
  H.generateMonthlyBills({ month: '2026-09' });
  const bill = H.payments({ studentId: 'STD-1' })[0];
  eq('nothing left to pay', bill.TotalDue, 0);
  eq('the full tuition is still shown', bill.GrossDue, 5900);
  eq('credited as a visible line', bill.PrepaidTuition, 5900);
  eq('marked paid', bill.Status, 'PAID');

  console.log('   …but food/activity charges that month are still billed');
  H.addStudentCharge({ studentId: 'STD-1', month: '2026-09', label: 'ค่าอาหาร', amount: 800 });
  const ch = H.studentCharges({ studentId: 'STD-1', month: '2026-09' });
  eq('extra charge stands', ch.length && ch[0].Outstanding, 800);

  console.log('   …and a month OUTSIDE the cover is charged normally');
  H.generateMonthlyBills({ month: '2027-04' });
  const later = H.payments({ studentId: 'STD-1' }).find(b => b.Month === '2027-04');
  eq('full tuition due', later.TotalDue, 5900);
}

// ============================================================================
console.log('\n9) A prepaid month owes no tuition, whatever the tuition happens to be');
{
  // the live case: the bill was issued at 7,500, the child's package is now 5,500, and the family
  // had already paid the year up front. The credit used to be capped at the CURRENT package price,
  // so 2,000 showed as outstanding tuition on money that was paid months ago.
  const { M, H } = fresh([kid({ Plan: 'p1' })]);
  const pp = H.prepay({ studentId: 'STD-1', months: 12, startMonth: '2026-08' });
  pp.Status = 'PAID';
  M.payments.push({ BillingID: 'BL-2026-08-STD-1', StudentID: 'STD-1', Month: '2026-08',
    Items: [['ค่าเทอม รายเดือน', 7500]], Amount: 7500, Status: 'UNPAID', DueDate: '2026-08-05' });
  M.config.Plans[0].price = 5500;                       // package price changed after the bill went out

  const bill = H.payments({ studentId: 'STD-1' })[0];
  eq('the whole 7,500 is credited', bill.PrepaidTuition, 7500);
  eq('nothing left to pay', bill.TotalDue, 0);
  eq('and no phantom outstanding', bill.Outstanding, 0);
  eq('shown as paid', bill.Status, 'PAID');

  const fin = H.financeSummary({ month: '2026-08' });
  const row = fin.students.find(s => s.studentId === 'STD-1');
  eq('finance says tuition is settled', row.tuitionOpen, 0);
  eq('flagged as paid in advance', [row.paid, row.prepaid], [true, true]);
  eq('school-wide tuition outstanding is 0', fin.tuitionOutstanding, 0);
  eq('and it counts as money collected', row.collected, 7500);

  console.log('   it also reports how much of the advance payment is left');
  eq('12 months, this is the 1st', [row.prepay.months, row.prepay.index], [12, 1]);
  eq('covering Aug 2026 → Jul 2027', [row.prepay.from, row.prepay.to], ['2026-08', '2027-07']);
  eq('12 months still covered from here', row.prepay.left, 12);
  const later = H.financeSummary({ month: '2027-07' }).students.find(s => s.studentId === 'STD-1');
  eq('by the last month only 1 is left', later.prepay.left, 1);

  console.log('   …and OT / extra charges that month are still owed, separately');
  H.addStudentCharge({ studentId: 'STD-1', month: '2026-08', label: 'ค่าอาหาร', amount: 800 });
  M.otDaily.push({ OTID: 'OT-9', StudentID: 'STD-1', Date: '2026-08-12', Amount: 200, Status: 'UNPAID' });
  const fin2 = H.financeSummary({ month: '2026-08' }).students.find(s => s.studentId === 'STD-1');
  eq('tuition still clear', fin2.tuitionOpen, 0);
  eq('but 1,000 of other charges is owed', fin2.otherOpen, 1000);
  eq('still counted as tuition-paid', fin2.paid, true);
  eq('school-wide: tuition 0, other 1,000',
    [H.financeSummary({ month: '2026-08' }).tuitionOutstanding, H.financeSummary({ month: '2026-08' }).otherOutstanding], [0, 1000]);
}

console.log('\n10) A month with no advance payment is unaffected');
{
  const { M, H } = fresh([kid({})]);
  H.generateMonthlyBills({ month: '2026-08' });
  const fin = H.financeSummary({ month: '2026-08' }).students[0];
  eq('full tuition still owed', fin.tuitionOpen, 5900);
  eq('not marked paid', fin.paid, false);
  eq('not marked prepaid', fin.prepaid, false);
  console.log('   …and a normal transfer still settles it');
  const b = M.payments[0];
  H.uploadSlip({ billingId: b.BillingID, slipAmount: 5900, slipData: 'x' });
  M.paymentSlips[0].Status = 'CONFIRMED';
  const fin2 = H.financeSummary({ month: '2026-08' }).students[0];
  eq('nothing outstanding', fin2.tuitionOpen, 0);
  eq('marked paid', fin2.paid, true);
}

// ============================================================================
console.log('\n11) The months an advance payment covers — the น้องข้าวสวย case');
{
  // paid on 31 July for 6 months; the cover belongs to Aug–Jan, and Feb bills normally again
  const { M, H } = fresh([kid({})]);
  const pp = H.prepay({ studentId: 'STD-1', months: 6, startMonth: '2026-08' });
  eq('covers Aug 2026 → Jan 2027', pp.Covered, ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
  pp.Status = 'PAID';
  H.generateMonthlyBills({ month: '2026-08' });
  H.generateMonthlyBills({ month: '2027-01' });
  H.generateMonthlyBills({ month: '2027-02' });
  const bills = H.payments({ studentId: 'STD-1' });
  eq('August is covered', bills.find(b => b.Month === '2026-08').TotalDue, 0);
  eq('January is the last covered month', bills.find(b => b.Month === '2027-01').TotalDue, 0);
  eq('February is billed normally again', bills.find(b => b.Month === '2027-02').TotalDue, 5900);
}

console.log('\n12) Admin fixes a cover that was entered a month early');
{
  const { M, H } = fresh([kid({})]);
  const pp = H.prepay({ studentId: 'STD-1', months: 6, startMonth: '2026-07' });   // entered wrong
  pp.Status = 'PAID';
  const paidAmount = pp.Amount;
  eq('as entered, it ends in December', pp.Covered[pp.Covered.length - 1], '2026-12');

  const fixed = H.editPrepay({ staffId: 'STF-A', prepayId: pp.PrepayID, startMonth: '2026-08' });
  eq('shifted to Aug → Jan', [fixed.Covered[0], fixed.Covered[fixed.Covered.length - 1]], ['2026-08', '2027-01']);
  eq('still 6 months', fixed.Months, 6);
  eq('and the amount they transferred is untouched', fixed.Amount, paidAmount);

  console.log('   …but a paid one cannot be re-priced');
  eq('months are locked',
    (() => { try { H.editPrepay({ staffId: 'STF-A', prepayId: pp.PrepayID, months: 12 }); return 'ALLOWED'; }
      catch (e) { return e.code; } })(), 'ALREADY_PAID');
  eq('so is the discount',
    (() => { try { H.editPrepay({ staffId: 'STF-A', prepayId: pp.PrepayID, discount: 50 }); return 'ALLOWED'; }
      catch (e) { return e.code; } })(), 'ALREADY_PAID');
  eq('a teacher cannot touch it at all',
    (() => { try { H.editPrepay({ staffId: 'nobody', prepayId: pp.PrepayID, startMonth: '2026-09' }); return 'ALLOWED'; }
      catch (e) { return e.code; } })(), 'NO_PERMISSION');

  console.log('   an UNPAID one can still be changed completely');
  const un = H.prepay({ studentId: 'STD-1', months: 3, startMonth: '2026-09' });
  const re = H.editPrepay({ staffId: 'STF-A', prepayId: un.PrepayID, months: 12, discount: 15, startMonth: '2027-02' });
  eq('re-quoted', re.Amount, Math.round(5900 * 12 * 0.85));
  eq('and re-covered', [re.Covered[0], re.Covered[11]], ['2027-02', '2028-01']);
}

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} checks passed`));
process.exit(fail ? 1 : 0);
