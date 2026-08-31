/**
 * tools/test_slip_reuse.js — "สลิปถูกใช้ไปแล้ว" decided against OUR records, not SlipOK's memory.
 *   node tools/test_slip_reuse.js
 *
 * Reported 2026-08-30: "ทำไมระบบถึงแจ้งกลับมาว่าสลิปถูกใช้ไปแล้ว (ส่งซ้ำ) ตลอดเวลา เพราะสลิปที่
 * ผู้ปกครองแนบมาเป็นสลิปใหม่เสมอ" — 70 of 72 slips on file carried a rejection.
 *
 * THE ORDER OF OPERATIONS IS THE BUG. Uploading a slip does Drive → SlipOK → write the row, and
 * SlipOK records the slip the moment we ask it to check one. The health report of the same day shows
 * p95 at 17.5s with replies genuinely going missing. A reply lost after SlipOK had already recorded
 * the slip leaves the parent with an error, nothing in our sheet, and a slip SlipOK will call a
 * duplicate for ever. Pressing the button again — the obvious thing to do — could never work.
 *
 * So the bank's `transRef` is now read back out of PAYMENT_SLIPS, where it has been stored since the
 * beginning and never once looked at:
 *
 *   we hold this ref, for THIS payable      → a re-submit. Hand back the record we already made.
 *   we hold this ref, for something ELSE    → genuine reuse. Refuse, and say what it paid for.
 *   we do not hold it at all                → SlipOK's own memory. ACCEPT and flag it: locking a
 *                                             family out of paying because OUR write failed is the
 *                                             worst outcome available, and an admin confirms every
 *                                             slip by hand anyway.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), slipsGs = R('src/PaySlips.gs'), perfGs = R('src/Perf.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine', 'Day6', 'Password', 'PaySlips']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_();
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STU-1', Name: 'ด.ญ. ทดสอบ', Nickname: 'ใบเตย',
    Class: 'Nursery 1', Status: 'ACTIVE', StartDate: '2025-05-01', Plan: 'FULL' });
  var bill = sheet_(MAIN, 'BILLING');
  appendObject_(bill, { BillingID: 'BIL-1', StudentID: 'STU-1', Month: '2026-08', Amount: 6900, Status: 'UNPAID' });
  appendObject_(bill, { BillingID: 'BIL-2', StudentID: 'STU-1', Month: '2026-09', Amount: 6900, Status: 'UNPAID' });

  /* SlipOK stubbed, because the point is what WE do with its answer. It behaves like the real thing:
   * the first sight of a reference is accepted, every sight after that is 1012 — including the sight
   * that happened on an attempt whose reply never came back. */
  var seen = {}, calls = [];
  handleVerifySlip = function (p) {
    var ref = String(p.qrData || '');
    calls.push(ref);
    if (!ref) return { available: false };
    var first = !seen[ref];
    seen[ref] = 1;
    return { available: true, ok: first, code: first ? null : 1012,
      message: first ? '' : 'slip already used', ref: ref, amount: p.amount,
      receiver: { name: 'อะตอม เนอสเซอรี่' }, transDate: '2026-08-28', transTime: '09:15', sender: 'พ่อ' };
  };
  var upload = function (billId, ref, amount) {
    try { return { ok: true, r: handleUploadSlip({ billingId: billId, qrData: ref, slipAmount: amount }) }; }
    catch (e) { return { ok: false, code: e && e.apiCode, message: e && e.message }; }
  };

  var o = {};
  var rowsOf = function () { return readObjects_(paySlipsSheet_()); };

  // ---- 1. the ordinary case: a genuinely new slip ----
  o.first = upload('BIL-1', 'REF-AAA', 6900);
  o.after1 = rowsOf().length;
  o.verdict1 = String(rowsOf()[0].Verified || '');
  o.ref1 = String(rowsOf()[0].TransRef || '');

  // ---- 2. THE REPORTED CASE: the parent presses again ----
  o.again = upload('BIL-1', 'REF-AAA', 6900);
  o.after2 = rowsOf().length;

  // ---- 3. the same slip offered for a DIFFERENT bill: genuine reuse ----
  o.reuse = upload('BIL-2', 'REF-AAA', 6900);
  o.after3 = rowsOf().length;

  // ---- 4. SlipOK remembers a slip we have never held ----
  // exactly what a lost reply leaves behind: SlipOK recorded it, our write never happened
  handleVerifySlip({ qrData: 'REF-ORPHAN', amount: 6900 });     // consumed by the attempt that vanished
  o.orphan = upload('BIL-2', 'REF-ORPHAN', 6900);
  o.after4 = rowsOf().length;
  o.orphanVerdict = String((rowsOf().filter(function (r) { return r.TransRef === 'REF-ORPHAN'; })[0] || {}).Verified || '');

  // ---- 5. the diagnostic ----
  o.diag = handleSlipDiag({});
  o.calls = calls.length;
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) a new slip is taken, and its reference is kept');
{
  ok_('the upload succeeds', res.first.ok === true);
  eq('one row', res.after1, 1);
  eq('...verified', res.verdict1, 'YES');
  eq('...with the bank reference stored', res.ref1, 'REF-AAA');
}

console.log('\n2) THE REPORTED CASE — the parent presses the button again');
{
  /* SlipOK answers 1012 because it recorded the slip on the first attempt. Before this, that became
   * "สลิปถูกใช้ไปแล้ว (ส่งซ้ำ)" and a second row with a rejection on it. */
  ok_('it does not fail', res.again.ok === true);
  ok_('...and says the slip was already in', res.again.r.alreadySubmitted === true);
  eq('...pointing at the record already made', res.again.r.slipId, res.first.r.slipId);
  eq('NO SECOND ROW is created', res.after2, 1);
  eq('...so the amount received is not counted twice', res.again.r.paidSoFar, 6900);
}

console.log('\n3) the same slip for a different bill IS reuse, and is refused');
{
  eq('refused', res.reuse.ok, false);
  eq('...with a code of its own, not INTERNAL', res.reuse.code, 'SLIP_ALREADY_USED');
  ok_('...saying what it already paid for', /บิลรายเดือน BIL-1/.test(res.reuse.message));
  ok_('...and quoting the reference so it can be checked', /REF-AAA/.test(res.reuse.message));
  eq('nothing was written', res.after3, 1);
  ok_('the school’s report calls this a refusal, not a failure', /SLIP_ALREADY_USED: 1/.test(perfGs));
}

console.log('\n4) SlipOK remembers a slip we have never held');
{
  /* The lost-reply case, and the one that matters most: SlipOK consumed the slip on an attempt whose
   * reply never reached the phone, so nothing was ever written here. Refusing would leave the family
   * unable to pay with a slip for money they really did send. */
  ok_('the payment goes through', res.orphan.ok === true);
  eq('...and is recorded', res.after4, 2);
  eq('...flagged for a human rather than silently passed', res.orphanVerdict, 'NO:1012_NEW');
  ok_('...with a label that says what happened', /SlipOK เคยเห็นสลิปนี้ แต่โรงเรียนยังไม่เคยรับ/.test(app));
  ok_('the reasoning is written where the decision is',
    /locking a family out of paying because OUR write failed|blocking the family out of a payment because our own write failed/i.test(slipsGs));
}

console.log('\n5) the diagnostic can now answer "is it us or is it SlipOK?"');
{
  const rf = res.diag.refs;
  eq('it counts the distinct transfers', rf.distinct, 2);
  eq('...how many could not be read', rf.noRef, 0);
  /* THE ANSWER THE SCHOOL ASKED FOR. Two different references, neither submitted twice: every
   * "ส่งซ้ำ" came out of SlipOK's own memory, not from this app sending one slip more than once. */
  eq('...and how many were genuinely submitted twice', rf.repeated, 0);
  ok_('the reference is on the recent list', (res.diag.recent || []).some(r => r.ref === 'REF-AAA'));
  ok_('the screen shows it', /\$\{EN\(\)\?'ref':'อ้างอิง'\} \$\{esc\(r\.ref\)\}/.test(app));
  ok_('...and states the conclusion plainly when nothing repeats',
    /ไม่มีรายการโอนไหนถูกส่งซ้ำเลย/.test(app));
  ok_('...without accusing a combined payment of repeating itself',
    /Object\.keys\(groupOf\[r\]\)\.length > 1/.test(slipsGs) && /ไม่ถูกนับว่าซ้ำ/.test(app));
}

console.log('\n6) one rule, both upload paths');
{
  /* A slip refused on the single-item screen and accepted on the combined one would be worse than
   * either behaviour on its own. */
  ok_('the single-item path asks', /var dup = paySlipDupCheck_\(vr, kind, refId\);/.test(slipsGs));
  ok_('the combined path asks the same question', /var prev = \(String\(vr\.verified \|\| ''\)\.indexOf\('NO:1012'\) === 0\) \? paySlipByRef_\(vr\.ref\) : null;/.test(slipsGs));
  ok_('...and answers a re-submit with the group already recorded', /alreadySubmitted: true \}/.test(slipsGs));
  ok_('a rejected slip does not block its own reference for ever',
    /String\(s\.Status \|\| ''\) !== 'REJECTED'/.test(slipsGs));
  ok_('the parent is told plainly that nothing was sent twice', /ไม่ได้ส่งซ้ำแต่อย่างใด/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
