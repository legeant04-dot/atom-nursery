/**
 * tools/test_fast_route_payments.js — W4 group 3b: money received, on the fast host
 *   node tools/test_fast_route_payments.js
 *
 * 💰 Every route here ends in paySlipRecompute_ — the rule that turns the CONFIRMED slips of a payable into PAID /
 * PARTIAL / PENDING_VERIFY / UNPAID — on all four kinds (bill · OT · extra charge · prepay). Compared three ways as
 * everywhere (reply · every row of every sheet · LINE), both sides at the same fixed minute. Also pins the declared
 * `drops` (columns the SHEET does not have, which Apps Script's updateRow_ discards) to the schema itself.
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got=' + JSON.stringify(got) + '\n        want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const ROUTES = require(path.join(__dirname, '..', 'server', 'routes.js'));
delete process.env.ATOM_DB;
const G = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff',
  'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'PaySlips', 'Password', 'BillRun', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce', 'Demo']);

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'STUDENTS'], ['MAIN', 'PARENTS'], ['MAIN', 'USER_LINKS'], ['MAIN', 'BILLING'], ['MAIN', 'OT_DAILY'],
  ['MAIN', 'STUDENT_CHARGES'], ['MAIN', 'PREPAYMENTS'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'USERS'], ['MAIN', 'LINE_RECIPIENTS'], ['MAIN', 'AUDIT_LOG']];
const kid = (id, nick) => ({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: 'P1', ParentID: 'PAR-' + id.slice(-2), Status: 'ACTIVE', EnrollDate: '2026-06-01' });
const bill = (sid, extra) => Object.assign({ BillingID: 'BL-2026-11-' + sid, StudentID: sid, Month: '2026-11', Amount: 6900, Status: 'UNPAID', SlipAmount: 0, DueDate: '2026-11-05' }, extra || {});
const slip = (id, ref, kind, sid, amt, status, extra) => Object.assign({ SlipID: id, RefKind: kind, RefID: ref, StudentID: sid, Amount: amt, Url: '', FileId: '', Verified: '', TransRef: '', Receiver: '', SubmittedDate: '2026-11-08 10:00:00', Status: status }, extra || {});
const FIX = {
  SCHOOL_CONFIG: [['Timezone', 'Asia/Bangkok'], ['NotifyAdminApproval', 'app'], ['LineChannelAccessToken', 'test-token-not-real']],
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี'), kid('S03', 'ซี'), kid('S04', 'ดี'), kid('S05', 'อี'), kid('S06', 'เอฟ')],
  PARENTS: [{ ParentID: 'PAR-05', Name: 'แม่อี', LineUID: 'Uparent0000005', StudentID: 'S05' }, { ParentID: 'PAR-06', Name: 'แม่เอฟ', LineUID: 'Uparent0000006', StudentID: 'S06' }],
  BILLING: [bill('S01'), bill('S02', { Status: 'PENDING_VERIFY', SlipAmount: 6900 }), bill('S03', { Status: 'PAID', SlipAmount: 6900, PaidDate: '2026-11-03', VerifiedStatus: 'CONFIRMED' }),
    bill('S05', { Amount: 4500 }), bill('S06')],
  OT_DAILY: [{ OTID: 'OT-20261110-S01', Date: '2026-11-10', StudentID: 'S01', PickupTime: '18:30', PlanEnd: '17:00', LateMinutes: 90, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 }],
  STUDENT_CHARGES: [{ ChargeID: 'CH-0001', StudentID: 'S01', Month: '2026-11', Label: 'ทัศนศึกษา', Amount: 500, Status: 'UNPAID' },
    { ChargeID: 'CH-0002', StudentID: 'S05', Month: '2026-11', Label: 'ชุดกีฬา', Amount: 350, Status: 'UNPAID' }],
  PREPAYMENTS: [{ PrepayID: 'PP-0001', StudentID: 'S04', Months: 2, Discount: 5, Gross: 13800, Amount: 13110, Covered: '["2026-12","2027-01"]', Status: 'UNPAID', SlipAmount: 0, Date: '2026-11-08' }],
  PAYMENT_SLIPS: [slip('SL-A', 'BL-2026-11-S02', 'bill', 'S02', 6900, 'SUBMITTED', { Url: 'https://drive.example/a', Verified: 'YES' }),
    slip('SL-B', 'BL-2026-11-S03', 'bill', 'S03', 6900, 'CONFIRMED', { Url: 'https://drive.example/b', Verified: 'YES' }),
    slip('SL-C', 'BL-2026-11-S06', 'bill', 'S06', 6900, 'SUBMITTED', { Method: 'cash' }),
    slip('SL-D', 'BL-2026-11-S06', 'bill', 'S06', 100, 'SUBMITTED', { Method: 'cash' })],
  ADMIN_INBOX: [], USERS: [], LINE_RECIPIENTS: [{ Name: 'ผอ.', LineUID: 'Udirector000004', Topics: 'approval', Active: 'YES', Note: '' }]
};
G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    var sh = main.getSheetByName(x[1]) || sheet_(main, x[1]);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    if (x[1] === 'BILLING') ensureColumns_(sh, ['BillRun', 'IssuedDate', 'ReceiptDate']);
    if (x[1] === 'PAYMENT_SLIPS') ensureColumns_(sh, ['SlipGroup', 'TransDate', 'TransTime', 'Sender', 'Method', 'SendBank', 'StatedDate', 'StatedTime']);
    (F[x[1]] || []).forEach(function (r) { appendObject_(sh, x[1] === 'SCHOOL_CONFIG' ? { Key: r[0], Value: r[1] } : r); });
  });
  _configCache = null; return '';
});
const gasState = () => JSON.parse(G.run(function () {
  var out = {}, main = getMainSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    out[x[1]] = readObjects_(sheet_(main, x[1])).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
  });
  return JSON.stringify(out);
}));
let nextId = 1; const db = {};
{ const s = gasState(); Object.keys(s).forEach(k => { db[k] = s[k].map(r => Object.assign({ __id: 'r' + (nextId++) }, r)); }); }
const applyOps = ops => ops.forEach(o => {
  const t = db[o.sheet] || (db[o.sheet] = []);
  if (o.op === 'insert') { const id = 'r' + (nextId++); t.push(Object.assign({ __id: id }, JSON.parse(JSON.stringify(o.row)))); o.__real = id; return; }
  const id = String(o.id).indexOf('new:') === 0 ? ops.find(x => x.tmp === o.id).__real : o.id;
  const i = t.findIndex(r => r.__id === id); if (i < 0) throw new Error('op on a missing row ' + o.sheet + ' ' + id);
  if (o.op === 'update') Object.assign(t[i], JSON.parse(JSON.stringify(o.patch))); else t.splice(i, 1);
});
const host = (action, payload) => {
  const raw = {}; ROUTES.needs([action]).forEach(s => { raw[s] = JSON.parse(JSON.stringify(db[s] || [])); });
  const sink = [], line = { ready: true, out: [] };
  try { const data = ROUTES.run(action, payload, raw, {}, {}, sink, line); applyOps(sink); return { ok: true, data, ops: sink, line: line.out }; }
  catch (e) { return { ok: false, code: e.apiCode || e.message, msg: e.message, ops: [], line: line.out }; }
};
const gas = (fn, payload) => { G.g.__P = JSON.stringify(payload); G.g.__F = fn; return JSON.parse(G.run(function () {
  _configCache = null; PUSH.length = 0;
  var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message, msg: e.message }; }
  r.line = PUSH.slice(); return JSON.stringify(r); })); };
G.g.__FAKE = ROUTES.FAKE_DATE;
const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); G.g.__MS = ms;
  G.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };
const comparable = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = /^IN-\d+(-\d+)+$/.test(o.InboxID) ? 'IN-…' : o.InboxID;
  if (name === 'AUDIT_LOG') { delete o.LogID; delete o.Timestamp; }
  if (name === 'AUDIT_LOG') o.RecordID = String(o.RecordID || '').replace(/^(SL-\d+)-\d+ /, '$1-rnd ');
  /* recordCashPayment's id ends in Math.random() — the one value two runs cannot share */
  if (name === 'PAYMENT_SLIPS' && o.Verified === 'MANUAL') o.SlipID = String(o.SlipID).replace(/-\d+$/, '-rnd');
  return o; });
const hostPushes = list => list.map(p => (p.messages.length === 1 && p.messages[0].type === 'text') ? { to: p.to, text: p.messages[0].text } : { to: p.to, bad: p.messages });
function step(action, fn, p, label) {
  const w = gas(fn, p), h = host(action, p);
  const rw = JSON.stringify(w.ok ? { ok: true, data: w.data } : { ok: false, code: w.code, msg: w.msg });
  const rh = JSON.stringify(h.ok ? { ok: true, data: h.data } : { ok: false, code: h.code, msg: h.msg });
  ok_(label + ' — คำตอบเท่ากัน' + (rw === rh ? '' : '\n         gas=' + rw.slice(0, 500) + '\n        host=' + rh.slice(0, 500)), rw === rh);
  const s = gasState(), diff = Object.keys(s).filter(k => JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || [])));
  ok_('   ...ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
  diff.forEach(k => console.log('         ' + k + '\n           gas=' + JSON.stringify(comparable(k, s[k])).slice(-600) + '\n          host=' + JSON.stringify(comparable(k, db[k] || [])).slice(-600)));
  const lw = JSON.stringify(w.line), lh = JSON.stringify(hostPushes(h.line));
  ok_('   ...LINE เท่ากัน (' + w.line.length + ')' + (lw === lh ? '' : '\n         gas=' + lw.slice(0, 300) + '\n        host=' + lh.slice(0, 300)), lw === lh);
  return { gas: w, host: h };
}
const A = { staffId: 'STF-A', adminId: 'STF-A', adminName: 'แอดมินเอ' };
const of = (sheet, key, id) => db[sheet].find(x => String(x[key]) === id) || {};
const slipsOf = ref => db.PAYMENT_SLIPS.filter(x => x.RefID === ref);
let r;

console.log('\n1) 💰 แอดมินบันทึกรับเงินนอกแอป (recordCashPayment) — ทั้ง 4 ชนิดรายการ');
at('2026-11-12', '09:00');
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2026-11-S01', amount: 3000, date: '2026-11-11' }, A), 'รับเงินสดค่าเทอมน้องเอ 3,000 จาก 6,900');
{ const b = of('BILLING', 'BillingID', 'BL-2026-11-S01');
  eq('💰 PARTIAL · SlipAmount 3,000 · ค้าง 3,900 · แถวเงิน CONFIRMED (MANUAL) ไม่มีรูป', [b.Status, b.SlipAmount, r.host.data.outstanding, slipsOf('BL-2026-11-S01').map(x => [x.Status, x.Verified, x.Url, x.Method, x.TransDate])],
    ['PARTIAL', 3000, 3900, [['CONFIRMED', 'MANUAL', '', 'cash', '2026-11-11']]]); }
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2026-11-S01', amount: 4000 }, A), '🔴 รับเกินยอดที่ค้าง');
eq('🔴 ...OVERPAY ไม่บันทึก', [r.host.code, slipsOf('BL-2026-11-S01').length], ['OVERPAY', 1]);
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2026-11-S01', amount: 0 }, A), '🔴 ไม่ระบุจำนวน');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2026-11-S01', amount: 3900, date: '2026-11-12', method: 'transfer' }, A), 'รับส่วนที่เหลือ 3,900 (โอนเข้าบัญชี)');
{ const b = of('BILLING', 'BillingID', 'BL-2026-11-S01');
  eq('💰 PAID · วันที่จ่าย = วันที่รับเงิน · วันออกใบเสร็จ = วันนี้ · CONFIRMED', [b.Status, b.SlipAmount, b.PaidDate, b.ReceiptDate, b.VerifiedStatus, r.host.data.outstanding], ['PAID', 6900, '2026-11-12', '2026-11-12', 'CONFIRMED', 0]); }
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'ot', refId: 'OT-20261110-S01', amount: 200 }, A), 'รับค่ารับช้า 200');
eq('💰 OT PAID (VerifiedStatus ไม่มีคอลัมน์ใน OT_DAILY — ทิ้งเหมือน Apps Script)', [of('OT_DAILY', 'OTID', 'OT-20261110-S01').Status, of('OT_DAILY', 'OTID', 'OT-20261110-S01').SlipAmount, 'VerifiedStatus' in of('OT_DAILY', 'OTID', 'OT-20261110-S01')], ['PAID', 200, false]);
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'charge', refId: 'CH-0001', amount: 500 }, A), 'รับค่าทัศนศึกษา 500');
eq('💰 ค่าใช้จ่ายเพิ่มเติม PAID (ชีตนี้เก็บแค่ Status)', of('STUDENT_CHARGES', 'ChargeID', 'CH-0001').Status, 'PAID');
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'prepay', refId: 'PP-0001', amount: 13110 }, A), 'รับชำระล่วงหน้า 2 เดือน 13,110');
eq('💰 PREPAYMENTS PAID 13,110', [of('PREPAYMENTS', 'PrepayID', 'PP-0001').Status, of('PREPAYMENTS', 'PrepayID', 'PP-0001').SlipAmount], ['PAID', 13110]);
r = step('recordCashPayment', 'handleRecordCashPayment', Object.assign({ kind: 'bill', refId: 'BL-2099-01-S01', amount: 1 }, A), '🔴 ไม่มีรายการนี้');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');

console.log('\n2) 💰 ยืนยัน / ปฏิเสธสลิป');
r = step('confirmSlip', 'handleConfirmSlip', Object.assign({ slipId: 'SL-A', paidDate: '2026-11-09' }, A), 'ยืนยันสลิปน้องบี 6,900');
eq('💰 บิลน้องบี PAID · วันที่จ่าย 9/11 ตามที่ระบุ', [of('BILLING', 'BillingID', 'BL-2026-11-S02').Status, of('BILLING', 'BillingID', 'BL-2026-11-S02').PaidDate, r.host.data.outstanding], ['PAID', '2026-11-09', 0]);
r = step('rejectSlip', 'handleRejectSlip', Object.assign({ slipId: 'SL-B' }, A), '💰 ปฏิเสธสลิปที่ยืนยันไปแล้วของน้องซี');
eq('💰 บิลกลับเป็น UNPAID (เงินก้อนนั้นไม่นับแล้ว) · audit', [of('BILLING', 'BillingID', 'BL-2026-11-S03').Status, of('BILLING', 'BillingID', 'BL-2026-11-S03').SlipAmount, r.host.data.kept, db.AUDIT_LOG.slice(-1)[0].Action], ['UNPAID', 0, false, 'SLIP_REJECT']);
r = step('rejectSlip', 'handleRejectSlip', Object.assign({ slipId: 'SL-Z' }, A), '🔴 ไม่มีสลิปนี้');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');

console.log('\n3) 💰 ลบรายการชำระที่ไม่มีรูป (deleteSlip · deleteSlips) · ปฏิเสธหลายใบ (rejectSlips)');
r = step('deleteSlip', 'handleDeleteSlip', Object.assign({ slipId: 'SL-A' }, A), '🔴 ลบรายการที่มีสลิปแนบ');
eq('🔴 ...HAS_SLIP (สลิปคือหลักฐาน — ให้ปฏิเสธแทน)', [r.host.code, !!of('PAYMENT_SLIPS', 'SlipID', 'SL-A').SlipID], ['HAS_SLIP', true]);
const cashRow = slipsOf('BL-2026-11-S01').find(x => Number(x.Amount) === 3900);
const gasCash = gasState().PAYMENT_SLIPS.filter(x => x.RefID === 'BL-2026-11-S01' && Number(x.Amount) === 3900)[0];
{ /* the random id differs per side, so each side deletes ITS OWN row of 3,900 */
  const w = gas('handleDeleteSlip', Object.assign({ slipId: gasCash.SlipID }, A)), h = host('deleteSlip', Object.assign({ slipId: cashRow.SlipID }, A));
  eq('💰 ลบเงิน 3,900 ที่บันทึกผิด → บิลน้องเอกลับเป็น PARTIAL 3,000 (ทั้งสองฝั่ง)', [w.ok, h.ok, of('BILLING', 'BillingID', 'BL-2026-11-S01').Status, of('BILLING', 'BillingID', 'BL-2026-11-S01').SlipAmount,
    gasState().BILLING.find(x => x.BillingID === 'BL-2026-11-S01').Status], [true, true, 'PARTIAL', 3000, 'PARTIAL']);
  const s = gasState(), diff = Object.keys(s).filter(k => JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || [])));
  ok_('   ...ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
}
r = step('deleteSlips', 'handleDeleteSlips', Object.assign({ slipIds: ['SL-C', 'SL-A', 'SL-Q'] }, A), 'ลบหลายใบ: ไม่มีรูป · มีรูป · ไม่มีจริง');
eq('💰 ลบ SL-C · ข้าม SL-A (HAS_SLIP) และ SL-Q (NOT_FOUND)', [r.host.data.count, r.host.data.skipped.map(x => [x.slipId, x.code]), !!of('PAYMENT_SLIPS', 'SlipID', 'SL-C').SlipID],
  [1, [['SL-A', 'HAS_SLIP'], ['SL-Q', 'NOT_FOUND']], false]);
r = step('rejectSlips', 'handleRejectSlips', Object.assign({ slipIds: ['SL-D'] }, A), 'ปฏิเสธหลายใบ');
eq('...REJECTED · บิลน้องเอฟกลับเป็น UNPAID (ไม่มีเงินค้างรอตรวจแล้ว)', [of('PAYMENT_SLIPS', 'SlipID', 'SL-D').Status, of('BILLING', 'BillingID', 'BL-2026-11-S06').Status], ['REJECTED', 'UNPAID']);
r = step('rejectSlips', 'handleRejectSlips', Object.assign({ slipIds: [] }, A), '🔴 ไม่ได้เลือก');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');

console.log('\n4) 💰 ครอบครัวแจ้งจ่ายเงินสด (payCombinedCash)');
const fam = (extra) => Object.assign({ uid: 'Uparent0000005', parentId: 'PAR-05', items: [{ kind: 'bill', id: 'BL-2026-11-S05' }, { kind: 'charge', id: 'CH-0002' }] }, extra || {});
r = step('payCombinedCash', 'handlePayCombinedCash', fam({ amount: 4000 }), '🔴 ยอดไม่ตรง (ต้อง 4,850)');
eq('🔴 ...AMOUNT_MISMATCH', [r.host.code, /฿4850/.test(r.host.msg)], ['AMOUNT_MISMATCH', true]);
r = step('payCombinedCash', 'handlePayCombinedCash', fam({ amount: 4850, paidDate: '2026-11-20' }), '🔴 วันที่ในอนาคต');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('payCombinedCash', 'handlePayCombinedCash', fam({ amount: 4850, uid: 'Uparent0000006' }), '🔴 แม่เอฟแจ้งจ่ายของลูกบ้านอื่น');
eq('🔴 ...NO_PERMISSION', r.host.code, 'NO_PERMISSION');
r = step('payCombinedCash', 'handlePayCombinedCash', fam({ amount: 4850, paidDate: '2026-11-11' }), '💰 แม่อีแจ้งจ่ายเงินสด 4,850 เมื่อวาน');
{ const rows = db.PAYMENT_SLIPS.filter(x => x.SlipGroup === r.host.data.groupId);
  eq('💰 2 แถว SUBMITTED (รอโรงเรียนยืนยัน ไม่ใช่ PAID) · วันที่จ่าย 11/11 · บิลและค่าใช้จ่ายเป็น PENDING_VERIFY', [rows.map(x => [x.RefKind, x.Amount, x.Status, x.Method, x.TransDate]), of('BILLING', 'BillingID', 'BL-2026-11-S05').Status, of('STUDENT_CHARGES', 'ChargeID', 'CH-0002').Status],
    [[['bill', 4500, 'SUBMITTED', 'cash', '2026-11-11'], ['charge', 350, 'SUBMITTED', 'cash', '2026-11-11']], 'PENDING_VERIFY', 'PENDING_VERIFY']); }
eq('...แอดมินได้กระดิ่ง + LINE ถึงคนในรายชื่อ', [/แจ้งชำระเงินสด 1 คน \(อี\)/.test((db.ADMIN_INBOX.slice(-1)[0] || {}).Text || ''), r.host.line.map(p => p.to)], [true, ['Udirector000004']]);

console.log('\n5) 🔴 ด่าน · คอลัมน์ที่ทิ้ง · สิ่งที่ยังอยู่ Apps Script');
{
  const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
  const g = (a, role) => { try { GATE.identity(a, { slipId: 'SL-A', kind: 'bill', refId: 'BL-2026-11-S01', amount: 1 }, { uid: 'U-x', role, linkedId: role === 'Parent' ? 'PAR-05' : 'STF-T' }, {}); return 'ok'; } catch (e) { return e.apiCode || e.message; } };
  eq('🔴 ครู / ผู้ปกครอง เรียกงานแอดมิน → NO_PERMISSION', ['recordCashPayment', 'confirmSlip', 'rejectSlip', 'rejectSlips', 'deleteSlip', 'deleteSlips'].map(a => [g(a, 'Teacher'), g(a, 'Parent')]),
    Array(6).fill(['NO_PERMISSION', 'NO_PERMISSION']));
  /* every declared drop must be a column the SHEET does not have: absent from SCHEMA and from every ensureColumns_ call */
  const fs = require('fs'), SRC = path.join(__dirname, '..', 'src');
  const schema = fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8');
  const all = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const bad = [];
  Object.keys(ROUTES.PORTED).forEach(a => Object.entries(ROUTES.PORTED[a].drops || {}).forEach(([sheet, cols]) => cols.forEach(c => {
    const line = (new RegExp('^\\s*' + sheet + ':\\s*\\[[^\\]]*\\]', 'm').exec(schema) || [''])[0];
    if (line.indexOf("'" + c + "'") >= 0) bad.push(a + ' ' + sheet + '.' + c + ' (in SCHEMA)');
    if (new RegExp("ensureColumns_\\([^;]*'" + c + "'").test(all) && new RegExp(sheet).test(all)) {
      // only a problem when the ensureColumns_ that names it is on THIS sheet
      const hits = all.split('\n').filter(l => /ensureColumns_\(/.test(l) && l.indexOf("'" + c + "'") >= 0);
      if (hits.some(l => l.indexOf(sheet) >= 0)) bad.push(a + ' ' + sheet + '.' + c + ' (ensureColumns_)');
    }
  })));
  ok_('🔴 ทุกคอลัมน์ที่ประกาศว่า "ทิ้ง" ไม่มีอยู่จริงบนชีตนั้น' + (bad.length ? '  → ' + bad.join(' · ') : ''), !bad.length);
  ok_('การอัปโหลดสลิป / SlipOK ยังอยู่ Apps Script', ['uploadSlip', 'payOT', 'payCharge', 'payPrepay', 'payCombined', 'verifySlip'].every(a => !ROUTES.has(a)));
}
ROUTES.setClock(null);
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
