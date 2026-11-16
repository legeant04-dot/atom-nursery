/**
 * tools/test_slip_guard3.js — three layers against one slip paying twice (ผอ. 16 Nov 2026).
 *   node tools/test_slip_guard3.js
 *
 * ① the bank's reference · ② the image file's SHA-256 · ③ amount + transfer date + minute + sender
 * bank, used only when a reference is missing on one side. See paySlipFindSame_ in src/PaySlips.gs.
 *
 * SlipOK is stubbed per slip: `qrData` names a scenario, so one test can play "SlipOK is down",
 * "SlipOK read it but found no reference" and "two real transfers in the same minute".
 */
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine', 'Day6', 'Password', 'PaySlips']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_();
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STU-1', Name: 'ด.ญ. หนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', StartDate: '2025-05-01', Plan: 'FULL' });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STU-2', Name: 'ด.ญ. สอง', Nickname: 'สอง', Class: 'Nursery 1', Status: 'ACTIVE', StartDate: '2025-05-01', Plan: 'FULL' });
  var bill = sheet_(MAIN, 'BILLING');
  ['BIL-1:STU-1', 'BIL-2:STU-1', 'BIL-3:STU-2', 'BIL-4:STU-2', 'BIL-5:STU-1', 'BIL-6:STU-2', 'BIL-7:STU-1', 'BIL-8:STU-2', 'BIL-9:STU-1', 'BIL-10:STU-2']
    .forEach(function (x, i) { var a = x.split(':');
      appendObject_(bill, { BillingID: a[0], StudentID: a[1], Month: '2026-' + ('0' + (i + 1)).slice(-2), Amount: 6900, Status: 'UNPAID' }); });

  var S = {   // SlipOK's answer per scenario
    DOWN:      null,                                                              // SlipOK unreachable
    NOREF_A:   { ref: '',       d: '2026-11-16', t: '09:15', bank: 'KBANK' },     // read, no reference
    NOREF_B:   { ref: '',       d: '2026-11-16', t: '09:15', bank: 'KBANK' },     // another photo of the same transfer
    TWIN_1:    { ref: 'REF-T1', d: '2026-11-16', t: '10:00', bank: 'SCB' },
    TWIN_2:    { ref: 'REF-T2', d: '2026-11-16', t: '10:00', bank: 'SCB' },       // same minute, same amount, own ref
    AMT13:     { ref: 'REF-13', d: '2026-11-16', t: '11:00', bank: 'BBL', code: 1013 },
    COMBO:     { ref: '',       d: '2026-11-16', t: '12:00', bank: 'KTB' },
    COMBO_B:   { ref: '',       d: '2026-11-16', t: '12:00', bank: 'KTB' }
  };
  var calls = [], drives = 0;
  handleVerifySlip = function (p) {
    var k = String(p.qrData || ''); calls.push(k);
    var s = S[k];
    if (!s) return { available: false };
    return { available: true, ok: !s.code, code: s.code || null, ref: s.ref, amount: p.amount,
      receiver: { name: 'อะตอม เนอสเซอรี่' }, transDate: s.d, transTime: s.t + ':00', sender: 'พ่อ', sendBank: s.bank };
  };
  paySlipToDrive_ = function () { drives++; return { url: 'u' + drives, fileId: 'f' + drives }; };
  var img = function (txt) { return 'data:image/jpeg;base64,' + Utilities.base64Encode(txt); };
  var up = function (billId, scenario, image, amount) {
    try { return { ok: true, r: handleUploadSlip({ billingId: billId, qrData: scenario, slipData: image, slipAmount: amount || 6900 }) }; }
    catch (e) { return { ok: false, code: e && e.apiCode, message: e && e.message }; }
  };
  var combo = function (ids, scenario, image, amount) {
    try { return { ok: true, r: handlePayCombined({ items: ids.map(function (id) { return { kind: 'bill', id: id }; }), qrData: scenario, slipData: image, slipAmount: amount }) }; }
    catch (e) { return { ok: false, code: e && e.apiCode, message: e && e.message }; }
  };
  var rows = function () { return readObjects_(paySlipsSheet_()); };
  var o = {};

  // ② the same FILE while SlipOK is down
  o.f1 = up('BIL-1', 'DOWN', img('PHOTO-ONE'));
  o.f1hash = String(rows()[0].FileHash || '');
  var c0 = calls.length, d0 = drives, r0 = rows().length;
  o.f2 = up('BIL-2', 'DOWN', img('PHOTO-ONE'));
  o.f2calls = calls.length - c0; o.f2drives = drives - d0; o.f2rows = rows().length - r0;
  o.f3 = up('BIL-1', 'DOWN', img('PHOTO-ONE'));             // the same file, the same bill → a re-submit
  o.f3rows = rows().length - r0;

  // ③ the same transfer, a different photo, no reference
  o.n1 = up('BIL-3', 'NOREF_A', img('PHOTO-A'));
  o.n2 = up('BIL-4', 'NOREF_B', img('PHOTO-B'));
  o.n2amt = up('BIL-4', 'NOREF_B', img('PHOTO-B2'), 6800);   // amount differs → a different transfer

  // ① twins: same minute, same amount, same bank — but each has its own reference
  o.t1 = up('BIL-5', 'TWIN_1', img('TWIN-PHOTO-1'));
  o.t2 = up('BIL-6', 'TWIN_2', img('TWIN-PHOTO-2'));

  // ① a reference we hold, on a slip SlipOK objected to for another reason (1013) — used to slip through
  o.a1 = up('BIL-7', 'AMT13', img('AMT-PHOTO-1'));
  o.a2 = up('BIL-8', 'AMT13', img('AMT-PHOTO-2'));

  // a REJECTED slip never blocks
  var firstRow = rows().filter(function (r) { return r.RefID === 'BIL-1'; })[0];
  handleRejectSlip({ slipId: firstRow.SlipID });
  o.afterReject = up('BIL-2', 'DOWN', img('PHOTO-ONE'));

  // combined path asks the same three questions
  o.c1 = combo(['BIL-9', 'BIL-10'], 'COMBO', img('COMBO-PHOTO'), 13800);
  o.c1rows = rows().filter(function (r) { return r.SlipGroup && r.SlipGroup === (o.c1.r && o.c1.r.groupId); }).length;
  o.c2 = up('BIL-3', 'COMBO_B', img('COMBO-OTHER-PHOTO'), 13800);  // the group's TOTAL, another photo
  o.c3 = combo(['BIL-9', 'BIL-10'], 'DOWN', img('COMBO-PHOTO'), 13800);  // re-submit of the group
  o.c4 = combo(['BIL-3', 'BIL-4'], 'DOWN', img('PHOTO-A'), 13800);   // a single's file reused in a combo

  // a cash record whose note happens to equal a reference does not block anything
  handleRecordCashPayment({ kind: 'bill', refId: 'BIL-8', amount: 100, note: 'REF-T9', date: '2026-11-16' });
  S.CASHREF = { ref: 'REF-T9', d: '2026-11-15', t: '08:00', bank: 'GSB' };
  o.cash = up('BIL-8', 'CASHREF', img('CASH-PHOTO'));
  return JSON.stringify(o);
}));

console.log('\n② the same file, while SlipOK is down');
ok_('the first one is taken', res.f1.ok);
ok_('...and its fingerprint stored (64 hex)', /^[0-9a-f]{64}$/.test(res.f1hash));
eq('the same file for ANOTHER bill is refused', res.f2.code, 'SLIP_ALREADY_USED');
ok_('...saying which bill it paid', /ไฟล์สลิปนี้เคยแนบชำระ บิลรายเดือน BIL-1/.test(res.f2.message || ''));
eq('...without asking SlipOK (no quota spent)', res.f2calls, 0);
eq('...without a stray file in Drive', res.f2drives, 0);
eq('...and nothing written', res.f2rows, 0);
ok_('the same file for the SAME bill is a re-submit, not an error', res.f3.ok && res.f3.r.alreadySubmitted === true);
eq('...no second row', res.f3rows, 0);

console.log('\n③ the same transfer, another photo, no reference');
ok_('the first is taken', res.n1.ok);
eq('another photo of the same transfer for another bill is refused', res.n2.code, 'SLIP_ALREADY_USED');
ok_('...and the family is told how to proceed if it really was a second transfer', /ติดต่อโรงเรียน/.test(res.n2.message || ''));
ok_('a different amount is a different transfer — taken', res.n2amt.ok);

console.log('\n① twins: two real transfers in the same minute');
ok_('the first twin is taken', res.t1.ok);
ok_('the second twin is taken (its own reference decides, not the matching details)', res.t2.ok);

console.log('\n① a held reference behind a different SlipOK objection (1013)');
ok_('the first is taken', res.a1.ok);
eq('the same reference for another bill is refused', res.a2.code, 'SLIP_ALREADY_USED');
ok_('...quoting the reference', /REF-13/.test(res.a2.message || ''));

console.log('\na slip the admin REJECTED never blocks');
ok_('the rejected file can be sent again', res.afterReject.ok && !res.afterReject.r.alreadySubmitted);

console.log('\nthe combined payment asks the same questions');
ok_('a combined payment is taken', res.c1.ok);
eq('...one row per item', res.c1rows, 2);
eq('its transfer (by total) reused on a single bill is refused', res.c2.code, 'SLIP_ALREADY_USED');
ok_('re-sending the same combined file is a re-submit', res.c3.ok && res.c3.r.alreadySubmitted === true);
eq('a single bill\'s file reused in a combined payment is refused', res.c4.code, 'SLIP_ALREADY_USED');

console.log('\ncash records are not bank references');
ok_('a slip whose reference equals a cash note is taken', res.cash.ok);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
