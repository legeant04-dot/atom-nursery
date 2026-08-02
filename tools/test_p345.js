/**
 * tools/test_p345.js — Phase 3–5 harness: payment history log + injury reads.
 *   node tools/test_p345.js
 */
const path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, end: '17:00' }],
      PrepayTiers: [{ months: 6, discount: 10 }], OTRatePerHour: 100, OTGraceMinutes: 21, SchoolName: 'Atom' },
    students: [
      { StudentID: 'STD-1', NameTH: 'น้องอลัน', Nickname: 'อลัน', Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-01-01', Gender: 'ช' },
      { StudentID: 'STD-2', NameTH: 'น้องบีม', Nickname: 'บีม', Class: 'Nursery 2', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2022-01-01', Gender: 'ญ' },
      { StudentID: 'STD-9', NameTH: 'เด็กบ้านอื่น', Nickname: 'อื่น', Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-9' }
    ],
    staff: [{ StaffID: 'STF-T1', NameTH: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher' },
      { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'คุณแม่' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [],
    otRecords: [], payroll: [], userLinks: [], feed: [], injuryReports: [],
    checkinStudent: [], studentAttendanceToday: [], activityLog: [], studentLeaves: [], comments: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) Payment history: one entry per slip, newest first, with the slip attached');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: '2026-07' });
  H.generateMonthlyBills({ month: '2026-08' });
  const jul = M.payments.find(b => b.StudentID === 'STD-1' && b.Month === '2026-07');
  const aug = M.payments.find(b => b.StudentID === 'STD-1' && b.Month === '2026-08');
  H.uploadSlip({ billingId: jul.BillingID, slipAmount: 5900, slipData: 'data:image/png;base64,JUL' });
  H.uploadSlip({ billingId: aug.BillingID, slipAmount: 3000, slipData: 'data:image/png;base64,AUG' });
  M.paymentSlips[0].Status = 'CONFIRMED';
  M.paymentSlips[0].TransDate = '2026-07-03';

  const log = H.paymentLog({ parentId: 'PAR-1' });
  eq('both children in scope', log.students.map(s => s.nick).sort(), ['บีม', 'อลัน']);
  eq('two entries', log.count, 2);
  eq('newest first', log.entries.map(e => e.month), ['2026-08', '2026-07']);
  eq('labelled by what it was for', log.entries[0].label, 'ค่าเทอมรายเดือน');
  eq('the slip comes with it', log.entries[1].slipUrl, 'data:image/png;base64,JUL');
  eq('confirmed total', log.totalConfirmed, 5900);
  eq('still-to-check total', log.totalPending, 3000);
  eq('uses the real transfer date when known', log.entries[1].date, '2026-07-03');
}

console.log('\n2) Every kind of payment appears, described in words');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: '2026-08' });
  const bill = M.payments.find(b => b.StudentID === 'STD-1');
  H.uploadSlip({ billingId: bill.BillingID, slipAmount: 5900, slipData: 'x' });
  const pp = H.prepay({ studentId: 'STD-1', months: 6, startMonth: '2026-09' });
  H.payPrepay({ prepayId: pp.PrepayID, slipAmount: 31860, slipData: 'y' });
  M.otDaily.push({ OTID: 'OT-1', StudentID: 'STD-1', Date: '2026-08-12', Amount: 200, Status: 'UNPAID' });
  H.payOT({ otId: 'OT-1', slipAmount: 200, slipData: 'z' });
  const ch = H.addStudentCharge({ studentId: 'STD-1', month: '2026-08', label: 'ค่าอาหาร', amount: 800 });
  H.payCharge({ chargeId: ch.ChargeID, slipAmount: 800, slipData: 'w' });

  const log = H.paymentLog({ studentId: 'STD-1' });
  eq('four entries', log.count, 4);
  const byKind = log.entries.reduce((a, e) => (a[e.refKind] = e.label, a), {});
  eq('tuition', byKind.bill, 'ค่าเทอมรายเดือน');
  eq('advance payment names its months', byKind.prepay, 'ชำระล่วงหน้า 6 เดือน (2026-09 → 2027-02)');
  eq('late pickup', byKind.ot, 'OT รับช้า 2026-08-12');
  eq('extra charge keeps its own label', byKind.charge, 'ค่าอาหาร');
  eq('each links back to its item', log.entries.every(e => !!e.refId), true);
}

console.log('\n3) Cash payments still show up, even with no slip');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: '2026-08' });
  const bill = M.payments.find(b => b.StudentID === 'STD-1');
  Object.assign(bill, { Status: 'PAID', PaymentMethod: 'cash', PaidDate: '2026-08-04', SlipAmount: 5900 });
  const log = H.paymentLog({ studentId: 'STD-1' });
  eq('recorded', log.count, 1);
  eq('marked as cash', log.entries[0].via, 'cash');
  eq('and says so in the label', /เงินสด/.test(log.entries[0].label), true);
  eq('with no slip to open', log.entries[0].slipUrl, '');
}

console.log('\n4) A family only ever sees its own children');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: '2026-08' });
  M.payments.forEach(b => H.uploadSlip({ billingId: b.BillingID, slipAmount: 100, slipData: 'q' }));
  const log = H.paymentLog({ parentId: 'PAR-1' });
  eq('another family\'s child is not in scope', log.students.map(s => s.studentId).indexOf('STD-9'), -1);
  eq('and none of their payments leak in', log.entries.some(e => e.studentId === 'STD-9'), false);
}

// ============================================================================
console.log('\n5) An injury notification carries the report id, so it can be opened');
{
  const { M, H } = fresh();
  const r = H.submitInjury({ studentId: 'STD-1', staffId: 'STF-T1', date: '2026-08-10', time: '10:30',
    injuryTypes: [1, 5], narrative: 'หกล้มที่สนามเด็กเล่น', place: 'สนามเด็กเล่น' });
  eq('a report id came back', !!r.injuryId, true);
  eq('the notification deep-links to it', M.feed[0].ref, 'injury|' + r.injuryId);
  eq('and is categorised as an emergency', M.feed[0].category, 'emergency');

  const one = H.injuryReport({ injuryId: r.injuryId });
  eq('the report opens', one.InjuryID, r.injuryId);
  eq('with the child by nickname', one.nick, 'อลัน');
  eq('their class', one.className, 'Nursery 1');
  eq('who filed it', one.teacherNick, 'ก้อย');
  eq('and what the teacher wrote', one.Narrative, 'หกล้มที่สนามเด็กเล่น');
  eq('a bad id is refused, not empty',
    (() => { try { H.injuryReport({ injuryId: 'nope' }); return 'RETURNED'; } catch (e) { return e.code; } })(), 'NOT_FOUND');
}

console.log('\n6) Monthly injury summary');
{
  const { H } = fresh();
  H.submitInjury({ studentId: 'STD-1', staffId: 'STF-T1', date: '2026-08-10', time: '10:00', injuryTypes: [1, 5] });
  H.submitInjury({ studentId: 'STD-2', staffId: 'STF-T1', date: '2026-08-20', time: '11:00', injuryTypes: [1] });
  H.submitInjury({ studentId: 'STD-1', staffId: 'STF-T1', date: '2026-07-05', time: '09:00', injuryTypes: [3] });

  const s = H.injurySummary({ month: '2026-08' });
  eq('August only', s.total, 2);
  eq('two different children', s.students, 2);
  eq('type 1 is the commonest', s.byType[0], { key: '1', count: 2 });
  eq('split by class', s.byClass.map(x => x.key).sort(), ['Nursery 1', 'Nursery 2']);
  eq('reports listed newest first', s.reports.map(r => r.date), ['2026-08-20', '2026-08-10']);
  eq('July is its own month', H.injurySummary({ month: '2026-07' }).total, 1);
  eq('a quiet month reads zero, not an error', H.injurySummary({ month: '2026-06' }).total, 0);
}

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} checks passed`));
process.exit(fail ? 1 : 0);
