/**
 * tools/test_fast_route_prepay.js — W4 group 3c: advance tuition (ชำระล่วงหน้า), on the fast host
 *   node tools/test_fast_route_prepay.js
 *
 * 💰 Correcting an advance payment re-quotes money from the child's plan price, a PAID one may only move its start
 * month, a cancelled one is deleted in place, and the audit repairs only what the OLD logic broke. Compared three ways
 * (reply · every row of every sheet · LINE) with both sides at the same fixed minute.
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

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'STUDENTS'], ['MAIN', 'BILLING'], ['MAIN', 'PREPAYMENTS'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'AUDIT_LOG']];
const kid = (id, nick, plan) => ({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: plan || 'P1', ParentID: 'PAR-' + id.slice(-2), Status: 'ACTIVE', EnrollDate: '2026-06-01' });
const pp = (id, sid, extra) => Object.assign({ PrepayID: id, StudentID: sid, Months: 2, Discount: 5, Gross: 13800, Amount: 13110, Covered: '["2026-12","2027-01"]', Status: 'UNPAID', SlipAmount: 0, Date: '2026-11-08' }, extra || {});
const bill = (sid, month, extra) => Object.assign({ BillingID: 'BL-' + month + '-' + sid, StudentID: sid, Month: month, Amount: 6900, Status: 'UNPAID', SlipAmount: 0, DueDate: month + '-05' }, extra || {});
const FIX = {
  SCHOOL_CONFIG: [['Timezone', 'Asia/Bangkok'], ['Plans', JSON.stringify([{ id: 'P1', name: 'เต็มวัน', end: '17:00', price: 6900 }, { id: 'P0', name: 'ไม่มีราคา', end: '17:00', price: 0 }])],
    ['PrepayTiers', JSON.stringify([{ months: 2, discount: 5 }, { months: 3, discount: 10 }, { months: 6, discount: 15 }, { months: 12, discount: 20 }])]],
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี'), kid('S03', 'ซี', 'P0'), kid('S04', 'ดี')],
  PREPAYMENTS: [pp('PP-0001', 'S01'), pp('PP-0002', 'S02', { Status: 'PAID', SlipAmount: 13110, PaidDate: '2026-11-09' }), pp('PP-0003', 'S03'),
    pp('PP-0004', 'S04', { Months: 3, Discount: 10, Gross: 20700, Amount: 18630, Covered: '["2026-08","2026-09","2026-10"]', Status: 'PAID', SlipAmount: 18630 }),
    pp('PP-0005', 'S01', { Covered: '["2027-02","2027-03"]' })],
  /* the OLD prepay logic marked covered months' bills PAID/PREPAID — S04's Aug–Oct; Sep was really paid by the family */
  BILLING: [bill('S04', '2026-08', { Status: 'PAID', VerifiedStatus: 'PREPAID' }), bill('S04', '2026-09', { Status: 'PAID', VerifiedStatus: 'CONFIRMED', SlipAmount: 6900, PaidDate: '2026-09-04' }),
    bill('S04', '2026-10', { Status: 'PAID', VerifiedStatus: 'PREPAID', PaidDate: '2026-10-01' }), bill('S04', '2026-11', {})],
  PAYMENT_SLIPS: [{ SlipID: 'SL-P5', RefKind: 'prepay', RefID: 'PP-0005', StudentID: 'S01', Amount: 13110, Url: 'https://drive.example/p5', Status: 'SUBMITTED' }]
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
const A = { staffId: 'STF-A', adminId: 'STF-A' };
const P = id => db.PREPAYMENTS.find(x => x.PrepayID === id) || {};
const B = id => db.BILLING.find(x => x.BillingID === id) || {};
let r;
at('2026-11-12', '09:00');

console.log('\n1) ตั้งระดับส่วนลด (savePrepayTiers)');
r = step('savePrepayTiers', 'handleSavePrepayTiers', Object.assign({ tiers: [{ months: 6, discount: 15 }, { months: 2, discount: 5 }, { months: 0, discount: 50 }, { months: 12, discount: 120 }] }, A), 'บันทึก (ไม่เรียง · มีแถวเสีย · ส่วนลดเกิน 100)');
eq('💰 เรียงตามเดือน · ทิ้งแถว 0 เดือน · 120% ถูกจำกัดเป็น 100', r.host.data.tiers, [{ months: 2, discount: 5 }, { months: 6, discount: 15 }, { months: 12, discount: 100 }]);
eq('...เก็บใน SCHOOL_CONFIG', JSON.parse(db.SCHOOL_CONFIG.find(x => x.Key === 'PrepayTiers').Value).length, 3);
r = step('savePrepayTiers', 'handleSavePrepayTiers', Object.assign({ tiers: [] }, A), '🔴 ว่าง');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('savePrepayTiers', 'handleSavePrepayTiers', Object.assign({ tiers: [{ months: 2, discount: 5 }, { months: 3, discount: 10 }, { months: 6, discount: 15 }, { months: 12, discount: 20 }] }, A), 'คืนค่านโยบายโรงเรียน 5/10/15/20');
eq('...4 ระดับ', r.host.data.tiers.length, 4);

console.log('\n2) 💰 แก้รายการชำระล่วงหน้า (editPrepay)');
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0001', months: 3, discount: 10 }, A), 'ยังไม่จ่าย: 2 → 3 เดือน · 5% → 10%');
eq('💰 ราคาใหม่จากแพ็กเกจ: 6,900 × 3 = 20,700 · ลด 10% = 18,630 · เดือน ธ.ค.–ก.พ.', [P('PP-0001').Months, P('PP-0001').Discount, P('PP-0001').Gross, P('PP-0001').Amount, JSON.parse(P('PP-0001').Covered)],
  [3, 10, 20700, 18630, ['2026-12', '2027-01', '2027-02']]);
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0001', startMonth: '2026-11' }, A), 'เลื่อนเดือนเริ่มเป็น พ.ย.');
eq('...พ.ย.–ม.ค. · ยอดเท่าเดิม', [JSON.parse(P('PP-0001').Covered), P('PP-0001').Amount], [['2026-11', '2026-12', '2027-01'], 18630]);
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0002', months: 6 }, A), '🔴 จ่ายแล้ว: แก้จำนวนเดือน');
eq('🔴 ...ALREADY_PAID ไม่เปลี่ยน', [r.host.code, P('PP-0002').Months], ['ALREADY_PAID', 2]);
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0002', discount: 20 }, A), '🔴 จ่ายแล้ว: แก้ส่วนลด');
eq('🔴 ...ALREADY_PAID', r.host.code, 'ALREADY_PAID');
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0002', startMonth: '2027-01' }, A), '💰 จ่ายแล้ว: เลื่อนเดือนที่มีผลได้');
eq('💰 ม.ค.–ก.พ. · ยอดและส่วนลดไม่ถูกคิดใหม่', [JSON.parse(P('PP-0002').Covered), P('PP-0002').Amount, P('PP-0002').Gross], [['2027-01', '2027-02'], 13110, 13800]);
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0003', months: 3 }, A), '🔴 แพ็กเกจไม่มีราคา');
eq('🔴 ...NO_PLAN_PRICE', r.host.code, 'NO_PLAN_PRICE');
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-0001', startMonth: 'พ.ย.' }, A), '🔴 เดือนผิดรูปแบบ');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('editPrepay', 'handleEditPrepay', Object.assign({ prepayId: 'PP-9999' }, A), '🔴 ไม่มีรายการ');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');

console.log('\n3) 💰 ลบรายการที่ยังไม่จ่าย (cancelPrepay)');
r = step('cancelPrepay', 'handleCancelPrepay', Object.assign({ prepayId: 'PP-0002' }, A), '🔴 จ่ายแล้ว');
eq('🔴 ...ALREADY_PAID', r.host.code, 'ALREADY_PAID');
r = step('cancelPrepay', 'handleCancelPrepay', Object.assign({ prepayId: 'PP-0005' }, A), '🔴 มีสลิปรอตรวจ');
eq('🔴 ...HAS_SLIP', [r.host.code, !!P('PP-0005').PrepayID], ['HAS_SLIP', true]);
r = step('cancelPrepay', 'handleCancelPrepay', Object.assign({ prepayId: 'PP-0003' }, A), '💰 ลบรายการซ้ำที่ยังไม่จ่าย');
eq('💰 หายไป · audit', [!!P('PP-0003').PrepayID, db.AUDIT_LOG.slice(-1)[0].Action], [false, 'PREPAY_DELETE']);

console.log('\n4) 💰 ตรวจบิลที่ตรรกะเก่าทำเครื่องหมายผิด (prepayAudit)');
r = step('prepayAudit', 'handlePrepayAudit', A, 'ตรวจอย่างเดียว');
eq('...พบ 3 ใบของน้องดี (ส.ค. ก.ย. ต.ค.) · ไม่แก้อะไร', [r.host.data.flaggedBills, r.host.data.repaired, r.host.data.applied, B('BL-2026-08-S04').Status], [3, 0, false, 'PAID']);
r = step('prepayAudit', 'handlePrepayAudit', Object.assign({ apply: true }, A), '💰 แก้');
eq('💰 แก้ 2 ใบ (PREPAID → UNPAID) · ก.ย. ที่ครอบครัวจ่ายจริงไม่ถูกแตะ · พ.ย. ไม่อยู่ในช่วง',
  [r.host.data.repaired, ['08', '09', '10', '11'].map(m => [B('BL-2026-' + m + '-S04').Status, B('BL-2026-' + m + '-S04').VerifiedStatus, B('BL-2026-' + m + '-S04').PaidDate])],
  [2, [['UNPAID', '', ''], ['PAID', 'CONFIRMED', '2026-09-04'], ['UNPAID', '', ''], ['UNPAID', '', '']]]);

console.log('\n5) 🔴 ด่าน');
{
  const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
  const g = (a, role) => { try { GATE.identity(a, { prepayId: 'PP-0001', tiers: [{ months: 2, discount: 90 }], apply: true }, { uid: 'U-x', role, linkedId: role === 'Parent' ? 'PAR-01' : 'STF-T' }, {}); return 'ok'; } catch (e) { return e.apiCode || e.message; } };
  eq('🔴 ครู / ผู้ปกครองเรียกทั้ง 4 → NO_PERMISSION', ['savePrepayTiers', 'editPrepay', 'cancelPrepay', 'prepayAudit'].map(a => [g(a, 'Teacher'), g(a, 'Parent')]), Array(4).fill(['NO_PERMISSION', 'NO_PERMISSION']));
}
ROUTES.setClock(null);
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
