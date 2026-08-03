/**
 * tools/test_pause_cash.js — temporary leave (ลาชั่วคราว) + money received outside the app.
 *   node tools/test_pause_cash.js
 */
const path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function code(fn) { try { fn(); return 'RETURNED'; } catch (e) { return (e && e.code) || String(e); } }

const TODAY = new Date().toISOString().slice(0, 10);
const THIS_MONTH = TODAY.slice(0, 7);
const shift = (m, n) => { let [y, mo] = m.split('-').map(Number); mo += n; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return y + '-' + String(mo).padStart(2, '0'); };

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, end: '17:00' }],
      PrepayTiers: [{ months: 2, discount: 5 }], OTRatePerHour: 100, OTGraceMinutes: 21,
      Departments: 'Nursery 1', DefaultCheckOutTime: '17:00' },
    students: [
      { StudentID: 'STD-1', NameTH: 'น้องอาร์มเมอร์', Nickname: 'อาร์มเมอร์', Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-01-01' },
      { StudentID: 'STD-2', NameTH: 'น้องบีม', Nickname: 'บีม', Class: 'Nursery 1', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-2', DOB: '2023-05-01' }
    ],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' },
      { StaffID: 'STF-T1', NameTH: 'ครูก้อย', Role: 'Teacher', Department: 'Nursery 1', Classes: '*' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'คุณแม่' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T1' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [],
    otRecords: [], payroll: [], userLinks: [], feed: [], injuryReports: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], staffAttendanceToday: [],
    activityLog: [], studentLeaves: [], comments: [], assessments: [], dspm: [],
    leaves: [], announcements: [], withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}
const pause = (H, extra) => H.setStudentPause(Object.assign({ staffId: 'STF-A', studentId: 'STD-1', paused: true }, extra));

// ============================================================================
console.log('\n1) Admin puts a child on temporary leave — and only an Admin can');
{
  const { M, H } = fresh();
  eq('a teacher cannot', code(() => H.setStudentPause({ staffId: 'STF-T1', studentId: 'STD-1', paused: true, from: TODAY })), 'NO_PERMISSION');
  eq('a start date is required', code(() => pause(H, {})), 'BAD_INPUT');
  eq('the return cannot precede the start', code(() => pause(H, { from: '2026-09-01', to: '2026-08-01' })), 'BAD_INPUT');
  const r = pause(H, { from: TODAY, to: shift(THIS_MONTH, 2) + '-28', reason: 'ไปต่างประเทศกับครอบครัว' });
  eq('status recorded', r.status, 'PAUSED');
  eq('and it is in force today', r.paused, true);
  eq('the record itself is untouched otherwise', [M.students[0].StudentID, M.students[0].ParentID], ['STD-1', 'PAR-1']);
  eq('reason kept for the school', M.students[0].PauseReason, 'ไปต่างประเทศกับครอบครัว');
}

console.log('\n2) While away: no bill, no class list, no absence — but still in the database');
{
  const { M, H } = fresh();
  pause(H, { from: THIS_MONTH + '-01' });                       // open-ended, from the 1st

  const gen = H.generateMonthlyBills({ month: THIS_MONTH });
  eq('only the other child is billed', gen.created, 1);
  eq('and the paused one is named, with a reason', gen.paused.map(x => x.nick), ['อาร์มเมอร์']);
  eq('no bill row exists for them', M.payments.some(b => b.StudentID === 'STD-1'), false);
  eq('issuing one by hand is refused too',
    code(() => H.issueBill({ studentId: 'STD-1', month: THIS_MONTH })), 'STUDENT_PAUSED');

  const cls = H.classList({ staffId: 'STF-T1' });
  const names = (cls.students || []).map(s => s.Nickname || s.NameTH);
  eq('not on the teacher\'s class list', names.indexOf('อาร์มเมอร์'), -1);
  eq('the other child still is', names.indexOf('บีม') >= 0, true);

  const dash = H.dashboard();
  const all = [].concat.apply([], dash.classes.map(c => c.students.map(s => s.nick)));
  eq('not on the dashboard', all.indexOf('อาร์มเมอร์'), -1);
  eq('so never counted absent', dash.classes.reduce((a, c) => a + c.absent, 0), 1);   // บีม only

  eq('excluded from the rated child count', H.ratedChildCount().rated, 1);
  eq('but STILL on the admin roster', H.listStudents().map(s => s.StudentID).sort(), ['STD-1', 'STD-2']);
  eq('flagged there as paused', H.listStudents().find(s => s.StudentID === 'STD-1').paused, true);
  eq('and the parent has not lost the child',
    H.parentChildren({ parentId: 'PAR-1' }).map(s => s.StudentID), ['STD-1']);
}

console.log('\n3) A part-paused month is still billed (the Admin adjusts it, the system does not guess)');
{
  const { M, H } = fresh();
  pause(H, { from: THIS_MONTH + '-15' });                       // away from the 15th
  const gen = H.generateMonthlyBills({ month: THIS_MONTH });
  eq('both children billed', gen.created, 2);
  eq('nobody skipped', gen.paused.length, 0);
}

console.log('\n4) They come back on their own date, without anyone flipping a switch');
{
  const { M, H } = fresh();
  const last = shift(THIS_MONTH, -1);
  pause(H, { from: last + '-01', to: last + '-28' });            // a leave that has already ended
  eq('the flag is still PAUSED on the record', M.students[0].Status, 'PAUSED');
  eq('but they are active again today', H.listStudents().find(s => s.StudentID === 'STD-1').paused, false);
  eq('so this month bills normally', H.generateMonthlyBills({ month: THIS_MONTH }).created, 2);
  eq('and the admin is told the date has passed', H.pausedStudents()[0].due, true);

  console.log('   …and ending the leave clears everything');
  H.setStudentPause({ staffId: 'STF-A', studentId: 'STD-1', paused: false });
  eq('back to ACTIVE', M.students[0].Status, 'ACTIVE');
  eq('dates cleared', [M.students[0].PauseFrom, M.students[0].PauseTo], ['', '']);
  eq('nobody left on the away list', H.pausedStudents().length, 0);
}

console.log('\n5) A withdrawn child is not "paused" — that is a different thing');
{
  const { M, H } = fresh();
  M.students[0].Status = 'WITHDRAWN';
  eq('refused', code(() => pause(H, { from: TODAY })), 'BAD_STATE');
}

// ============================================================================
console.log('\n6) Money received outside the app: cash at the desk');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: THIS_MONTH });
  const bill = M.payments.find(b => b.StudentID === 'STD-1');
  eq('a teacher cannot record payments',
    code(() => H.recordCashPayment({ staffId: 'STF-T1', kind: 'bill', refId: bill.BillingID, amount: 100 })), 'NO_PERMISSION');
  eq('an amount is required',
    code(() => H.recordCashPayment({ staffId: 'STF-A', kind: 'bill', refId: bill.BillingID, amount: 0 })), 'BAD_INPUT');
  eq('and it cannot exceed the bill',
    code(() => H.recordCashPayment({ staffId: 'STF-A', kind: 'bill', refId: bill.BillingID, amount: 9999 })), 'OVERPAY');

  const r = H.recordCashPayment({ staffId: 'STF-A', kind: 'bill', refId: bill.BillingID, amount: 2000, note: 'ค่าธรรมเนียมแรกเข้า' });
  eq('recorded', r.amount, 2000);
  eq('outstanding drops', r.outstanding, 3900);
  const view = H.payments({ studentId: 'STD-1' })[0];
  eq('the bill agrees', view.Outstanding, 3900);
  eq('and reads as partly paid', view.Status, 'PARTIAL');

  console.log('   the parent then transfers only what is left, and it matches');
  H.uploadSlip({ billingId: bill.BillingID, slipAmount: 3900, slipData: 'data:image/png;base64,X' });
  M.paymentSlips.find(s => s.Url).Status = 'CONFIRMED';
  const done = H.payments({ studentId: 'STD-1' })[0];
  eq('paid in full', done.Outstanding, 0);
  eq('status PAID', done.Status, 'PAID');

  console.log('   and BOTH payments are on the record, cash marked as cash');
  const log = H.paymentLog({ studentId: 'STD-1' });
  eq('two entries', log.count, 2);
  eq('amounts', log.entries.map(e => e.amount).sort((a, b) => a - b), [2000, 3900]);
  eq('the cash one has a note instead of a slip',
    log.entries.filter(e => !e.slipUrl).map(e => e.transRef), ['ค่าธรรมเนียมแรกเข้า']);
  eq('both confirmed', log.totalConfirmed, 5900);
}

console.log('\n7) The same works on an advance payment — the อาโป case');
{
  const { M, H } = fresh();
  // 2 months in advance by transfer, plus 2,000 of fees settled in cash on this month's bill
  const pp = H.prepay({ studentId: 'STD-1', months: 2, startMonth: THIS_MONTH });
  eq('quoted at the published tier', pp.Amount, Math.round(5900 * 2 * 0.95));
  H.payPrepay({ prepayId: pp.PrepayID, slipAmount: pp.Amount, slipData: 'data:image/png;base64,Y' });
  M.paymentSlips[0].Status = 'CONFIRMED';
  M.prepayments[0].Status = 'PAID';

  const ch = H.addStudentCharge({ studentId: 'STD-1', month: THIS_MONTH, label: 'ค่าธรรมเนียมแรกเข้า', amount: 2000 });
  H.recordCashPayment({ staffId: 'STF-A', kind: 'charge', refId: ch.ChargeID, amount: 2000, note: 'รับเงินสดหน้าเคาน์เตอร์' });

  H.generateMonthlyBills({ month: THIS_MONTH });
  const bill = H.payments({ studentId: 'STD-1' })[0];
  eq('tuition covered by the advance payment', bill.TotalDue, 0);
  eq('the fee is settled too', H.studentCharges({ studentId: 'STD-1', month: THIS_MONTH })[0].Outstanding, 0);

  const fin = H.financeSummary({ month: THIS_MONTH }).students.find(s => s.studentId === 'STD-1');
  eq('nothing outstanding at all', [fin.tuitionOpen, fin.otherOpen], [0, 0]);
  eq('shown as paid in advance', [fin.paid, fin.prepaid], [true, true]);

  console.log('   and the transfer is still findable — filed under the advance payment');
  const slips = H.paymentSlips({ studentId: 'STD-1', refKind: 'prepay', refId: pp.PrepayID });
  eq('one slip, confirmed', slips.map(s => s.Status), ['CONFIRMED']);
  eq('with the image still attached', !!slips[0].Url, true);
  eq('the whole family history shows both', H.paymentLog({ studentId: 'STD-1' }).count, 2);
}

// ============================================================================
console.log('\n8) Deleting an entry that was created twice and never paid');
{
  const { M, H } = fresh();
  const a = H.prepay({ studentId: 'STD-1', months: 2, startMonth: THIS_MONTH });
  const b = H.prepay({ studentId: 'STD-1', months: 2, startMonth: THIS_MONTH });   // the double-tap
  eq('two entries exist', M.prepayments.length, 2);
  H.payPrepay({ prepayId: a.PrepayID, slipAmount: a.Amount, slipData: 'data:image/png;base64,Z' });
  M.paymentSlips[0].Status = 'CONFIRMED'; M.prepayments[0].Status = 'PAID';

  H.cancelPrepay({ prepayId: b.PrepayID, staffId: 'STF-A' });
  eq('the empty one goes', M.prepayments.length, 1);
  eq('the paid one stays', M.prepayments[0].PrepayID, a.PrepayID);
  console.log('   …and the one that was actually paid cannot be deleted this way');
  H.cancelPrepay({ prepayId: a.PrepayID, staffId: 'STF-A' });
  eq('still there', M.prepayments.length, 1);
}

console.log('\n9) An empty payment row can be deleted; one with a slip cannot');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: THIS_MONTH });
  const bill = M.payments.find(b => b.StudentID === 'STD-1');
  H.recordCashPayment({ staffId: 'STF-A', kind: 'bill', refId: bill.BillingID, amount: 2000, note: 'พิมพ์ผิด' });
  const cashRow = M.paymentSlips[0];
  eq('outstanding after the mistake', H.payments({ studentId: 'STD-1' })[0].Outstanding, 3900);

  eq('a teacher cannot delete it', code(() => H.deleteSlip({ staffId: 'STF-T1', slipId: cashRow.SlipID })), 'NO_PERMISSION');
  H.deleteSlip({ staffId: 'STF-A', slipId: cashRow.SlipID });
  eq('gone', M.paymentSlips.length, 0);
  eq('and the balance is put back', H.payments({ studentId: 'STD-1' })[0].Outstanding, 5900);

  H.uploadSlip({ billingId: bill.BillingID, slipAmount: 5900, slipData: 'data:image/png;base64,K' });
  eq('a row WITH a slip is protected — reject it instead',
    code(() => H.deleteSlip({ staffId: 'STF-A', slipId: M.paymentSlips[0].SlipID })), 'HAS_SLIP');
}

console.log('\n10) The history shows when the money MOVED, not when the file was attached');
{
  const { M, H } = fresh();
  H.generateMonthlyBills({ month: THIS_MONTH });
  const bill = M.payments.find(b => b.StudentID === 'STD-1');
  H.uploadSlip({ billingId: bill.BillingID, slipAmount: 5900, slipData: 'data:image/png;base64,M' });
  // SlipOK read the slip: transferred late on the 2nd, uploaded the next morning
  Object.assign(M.paymentSlips[0], { Status: 'CONFIRMED', TransDate: '2026-08-02', TransTime: '18:45',
    SubmittedDate: '2026-08-03 08:06', TransRef: '0142XYZ', Sender: 'ปรเมศวร์ ไจไลสถาพร' });

  const slips = H.paymentSlips({ studentId: 'STD-1' });
  eq('the transfer moment is carried', [slips[0].TransDate, slips[0].TransTime], ['2026-08-02', '18:45']);
  eq('the upload moment is kept too, separately', slips[0].SubmittedDate, '2026-08-03 08:06');
  eq('and who sent it', slips[0].Sender, 'ปรเมศวร์ ไจไลสถาพร');

  const log = H.paymentLog({ studentId: 'STD-1' });
  eq('the log dates it by the transfer', log.entries[0].date, '2026-08-02');
  eq('with the time', log.entries[0].transTime, '18:45');
  eq('not by the upload', log.entries[0].date === '2026-08-03', false);
}

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} checks passed`));
process.exit(fail ? 1 : 0);
