/**
 * tools/test_ot_discount.js — goodwill discount on a student's late-pickup OT.
 *   node tools/test_ot_discount.js
 *
 * The case: OT comes to ฿200, Admin decides ฿100 is enough. That used to be done by typing 100 over
 * the amount, which lost the real charge, left no record of who granted it or why, and — worst —
 * was silently undone by ANY later check-out, because the recompute overwrote Amount.
 *
 * The charge (FullAmount) and the waiver (Discount) are now separate. Amount stays the NET payable,
 * so billing, slips, finance totals and the parent's payables are untouched.
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
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

function fresh(otRows) {
  const M = {
    config: { Plans: [{ id: 'p1', price: 6900, end: '17:00' }], Departments: 'Nursery 1',
      OTRatePerHour: 100, OTGraceMinutes: 21, LeaveQuota: {} },
    students: [{ StudentID: 'STD-01', NameTH: 'เด็กหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1',
      Plan: 'p1', Status: 'ACTIVE', DOB: '2023-01-01', ParentID: 'PAR-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Nickname: 'ตอม', Role: 'Admin', PositionLevel: 'Admin', Department: 'Nursery 1' }],
    parents: [{ ParentID: 'PAR-01', NameTH: 'ผู้ปกครอง', StudentID: 'STD-01', LineUID: 'U1' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-A' }],
    otDaily: otRows || [], assessments: [], dspmCriteria: [],
    payments: [], prepayments: [], studentCharges: [], paymentSlips: [],
    otRecords: [], payroll: [], userLinks: [{ UserUID: 'U1', StudentID: 'STD-01' }], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], leaves: [], leaveUsed: {}, announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}
// 19:00 pickup against a 17:00 plan end = 2 hours late = ฿200
const OTID = 'OT-' + TODAY.replace(/-/g, '') + '-STD-01';   // the id the app really generates
const ot = extra => Object.assign({ OTID: OTID, Date: TODAY, StudentID: 'STD-01', PickupTime: '19:00',
  PlanEnd: '17:00', LateMinutes: 120, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200,
  Status: 'UNPAID', SlipRef: '', SlipAmount: 0 }, extra || {});

// ============================================================================
console.log('\n1) The case: ฿200 owed, Admin says ฿100 is enough');
{
  const { M, H } = fresh([ot()]);
  const r = H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100, discountReason: 'รถติดมาก' });
  eq('parent is billed 100', r.amount, 100);
  eq('the real charge is still on record', M.otDaily[0].FullAmount, 200);
  eq('the waiver is recorded as 100', M.otDaily[0].Discount, 100);
  eq('with the reason', M.otDaily[0].DiscountReason, 'รถติดมาก');
  eq('and who granted it', M.otDaily[0].DiscountBy, 'STF-A');
  ok_('and when', !!M.otDaily[0].DiscountAt);
  ok_('an audit entry was written', (M.activityLog || []).some(a => String(a.Action) === 'otDiscount'));
}

console.log('\n2) The bug that made this unsafe: a later check-out must not undo the discount');
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100, discountReason: 'กรณีพิเศษ' });
  // teacher re-records the same pick-up time (double tap / correcting something else)
  H.editStudentAttendance({ role: 'Admin', staffId: 'STF-A', studentId: 'STD-01', date: TODAY, checkOut: '19:00', remark: 'แก้เวลา' });
  eq('the discount survives a recompute', [M.otDaily[0].FullAmount, M.otDaily[0].Discount, M.otDaily[0].Amount], [200, 100, 100]);
  eq('the reason survives too', M.otDaily[0].DiscountReason, 'กรณีพิเศษ');
}
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100 });
  // the real pick-up was later than first recorded: the CHARGE grows, the waiver stays
  const r = H.editStudentAttendance({ role: 'Admin', staffId: 'STF-A', studentId: 'STD-01', date: TODAY, checkOut: '20:00', remark: 'รับจริง 20:00' });
  ok_('the recompute really ran (guards against a vacuous test)', !!r.ot && r.ot.amount === 300);
  eq('charge recomputed to 300, discount still 100, parent pays 200',
    [M.otDaily[0].FullAmount, M.otDaily[0].Discount, M.otDaily[0].Amount], [300, 100, 200]);
}
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100 });
  // corrected DOWN to less than the discount — the school can never end up owing the parent
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, pickupTime: '18:00' });
  eq('a smaller charge caps the discount, never goes negative',
    [M.otDaily[0].FullAmount, M.otDaily[0].Discount, M.otDaily[0].Amount], [100, 100, 0]);
}

console.log('\n3) Nothing downstream changes — Amount is still the net payable');
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100, discountReason: 'รถติด' });
  eq('the stored Amount is the net the parent owes', Number(M.otDaily[0].Amount), 100);
  // the parent's own OT list carries both figures, so the app can show the waiver
  const mine = H.otDaily({ studentId: 'STD-01' });
  eq('parent-facing row keeps charge and waiver', [Number(mine[0].FullAmount), Number(mine[0].Discount), Number(mine[0].Amount)], [200, 100, 100]);
}
{
  // the payment history line the parent reads after paying
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100, discountReason: 'รถติด' });
  M.otDaily[0].Status = 'PAID'; M.otDaily[0].PaidDate = TODAY; M.otDaily[0].PaymentMethod = 'cash';
  const log = H.paymentLog({ studentId: 'STD-01' });
  const line = (log.entries||[]).find(x => String(x.refId) === OTID);
  ok_('the OT appears in the payment history', !!line);
  eq('charged the net, not the full amount', Number(line.due), 100);
  ok_('and the line spells out the waiver', /ส่วนลดพิเศษ/.test(line.label) && /ปกติ 200/.test(line.label));
}
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100 });
  const fin = H.financeSummary({ month: MONTH });
  ok_('finance reports outstanding OT as the net 100, never the full 200',
    JSON.stringify(fin).indexOf('"otOpen":100') >= 0 || (fin.otOpen === 100) ||
    (fin.students || []).some(s => Number(s.otOpen) === 100));
}

console.log('\n4) Guard rails');
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: -50 });
  eq('a negative amount cannot invent a bigger discount than the charge', [M.otDaily[0].Discount, M.otDaily[0].Amount], [200, 0]);
}
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 500 });
  eq('paying more than the charge is not a negative discount', [M.otDaily[0].Discount, M.otDaily[0].Amount], [0, 200]);
}
{
  const { H } = fresh([ot({ Status: 'PAID' })]);
  throws_('a settled row cannot be discounted after the fact', () =>
    H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100 }), 'ALREADY_PAID');
}
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100, discountReason: 'ครั้งแรก' });
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 200 });
  eq('removing the discount restores the full charge', [M.otDaily[0].Discount, M.otDaily[0].Amount], [0, 200]);
  eq('and clears the reason (it no longer applies)', M.otDaily[0].DiscountReason, '');
}
{
  const { H } = fresh([ot()]);
  throws_('an empty edit is refused', () => H.adminUpdateOT({ staffId: 'STF-A', otId: OTID }), 'BAD_INPUT');
}
{
  const { M, H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, discount: 150, discountReason: 'ตรง ๆ' });
  eq('a discount can also be given directly', [M.otDaily[0].Discount, M.otDaily[0].Amount], [150, 50]);
}

console.log('\n5) Rows written before discounts existed still behave');
{
  // no FullAmount / Discount columns at all — Amount IS the full charge
  const { M, H } = fresh([{ OTID: OTID, Date: TODAY, StudentID: 'STD-01', PickupTime: '19:00',
    PlanEnd: '17:00', LateMinutes: 120, Hours: 2, Amount: 200, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 }]);
  const list = H.studentOtList({ month: MONTH });
  eq('a legacy row reports its charge correctly', [list[0].fullAmount, list[0].discount, list[0].amount], [200, 0, 200]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100 });
  eq('and can be discounted from then on', [M.otDaily[0].FullAmount, M.otDaily[0].Discount, M.otDaily[0].Amount], [200, 100, 100]);
}

console.log('\n6) Everyone who needs to see the discount, sees it');
{
  const { H } = fresh([ot()]);
  H.adminUpdateOT({ staffId: 'STF-A', otId: OTID, amount: 100, discountReason: 'รถติด' });
  const a = H.studentOtList({ month: MONTH })[0];
  eq('admin list shows charge / discount / net', [a.fullAmount, a.discount, a.amount], [200, 100, 100]);
  eq('with the reason and the grantor', [a.discountReason, a.discountBy], ['รถติด', 'STF-A']);
  const t = H.teacherStudentOtList({ staffId: 'STF-A', month: MONTH });
  const item = t.students[0].items[0];
  eq('teacher follow-up chases the net, not the full charge', [item.fullAmount, item.discount, item.amount], [200, 100, 100]);
  eq('outstanding is the net', t.totalOutstanding, 100);
}

console.log('\n7) The live GAS route keeps the same promises (it shadows the engine)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'OT.gs'), 'utf8');
  ok_('the recompute preserves the discount', /otDiscOf_\(ex, c\.amount\)/.test(src));
  ok_('...and never writes a bare Amount from the computed charge',
    !/updateRow_\(sh, ex\._row, \{ PickupTime: pickupHHMM[^}]*Amount: c\.amount \}/.test(src));
  ok_('the new columns are created on demand', /ensureColumns_\(sh, OT_DISCOUNT_COLS_\)/.test(src));
  ok_('a discount is written to the audit log', /logAudit\([^)]*OT_DISCOUNT/.test(src));
  ok_('the discount is capped at the charge', /Math\.min\(otNum_\(p\.discount\), full\)/.test(src));
  ok_('paying more than the charge cannot go negative', /Math\.max\(0, full - otNum_\(p\.amount\)\)/.test(src));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
