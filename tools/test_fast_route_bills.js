/**
 * tools/test_fast_route_bills.js — W4 group 3a: the routes around a month's bills, on the fast host
 *   node tools/test_fast_route_bills.js
 *
 * 💰 Issuing is the engine's (MONEY_PROVEN, tools/test_fast_host_money_live.js). These are the Code.gs routes beside
 * it — telling families, reading back the last bulk run, taking it back, deleting one bill — and two of them DELETE
 * from BILLING, a sheet that may never shrink anywhere else. Every step is compared three ways (reply · every row of
 * every sheet the route can touch · every LINE message), with both sides at the same fixed minute.
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

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'STUDENTS'], ['MAIN', 'PARENTS'], ['MAIN', 'USER_LINKS'], ['MAIN', 'BILLING'], ['MAIN', 'PAYMENT_SLIPS'],
  ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'AUDIT_LOG']];
const kid = (id, nick) => ({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: 'P1', ParentID: 'PAR-' + id.slice(-2), Status: 'ACTIVE', EnrollDate: '2026-06-01' });
const bill = (sid, month, extra) => Object.assign({ BillingID: 'BL-' + month + '-' + sid, StudentID: sid, Month: month, Amount: 6900, Status: 'UNPAID', SlipAmount: 0, DueDate: month + '-05' }, extra || {});
const RUN_OLD = 'BR-2026-10-20261001T0900', RUN = 'BR-2026-11-20261101T1015';
const FIX = {
  SCHOOL_CONFIG: [['Timezone', 'Asia/Bangkok'], ['NotifyParentBill', 'app,line'], ['LineChannelAccessToken', 'test-token-not-real']],
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี'), kid('S03', 'ซี'), kid('S04', 'ดี'), kid('S05', 'อี'), kid('S06', 'เอฟ'), kid('S07', 'จี')],
  PARENTS: [{ ParentID: 'PAR-01', Name: 'แม่เอ', LineUID: 'Uparent0000001', StudentID: 'S01' }, { ParentID: 'PAR-02', Name: 'แม่บี', LineUID: '', StudentID: 'S02' }],
  USER_LINKS: [{ UserUID: 'Ufather0000001', StudentID: 'S01', ParentID: 'PAR-01', Relation: 'พ่อ' }],
  BILLING: [
    bill('S01', '2026-10', { BillRun: RUN_OLD }),
    bill('S01', '2026-11', { BillRun: RUN }),                                           // untouched → removable
    bill('S02', '2026-11', { BillRun: RUN }),                                           // a slip is waiting → kept
    bill('S03', '2026-11', { BillRun: RUN, Status: 'PAID', SlipAmount: 6900, PaidDate: '2026-11-03', VerifiedStatus: 'CONFIRMED' }),
    bill('S04', '2026-11', { BillRun: RUN, Status: 'PARTIAL', SlipAmount: 1000 }),
    bill('S05', '2026-11', { BillRun: RUN, Amount: 4500 }),                             // untouched → removable
    bill('S06', '2026-11', {}),                                                         // issued by hand — no run
    bill('S07', '2026-11', {})],                                                        // by hand, money confirmed
  PAYMENT_SLIPS: [{ SlipID: 'SLP-1', RefKind: 'bill', RefID: 'BL-2026-11-S02', StudentID: 'S02', Amount: 6900, Status: 'SUBMITTED' },
    { SlipID: 'SLP-2', RefKind: 'bill', RefID: 'BL-2026-11-S07', StudentID: 'S07', Amount: 6900, Status: 'CONFIRMED' }],
  ADMIN_INBOX: []
};
G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    var sh = main.getSheetByName(x[1]) || sheet_(main, x[1]);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    if (x[1] === 'BILLING') ensureColumns_(sh, ['BillRun', 'IssuedDate', 'ReceiptDate']);
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
const ids = () => db.BILLING.map(b => b.BillingID);
let r;

console.log('\n1) รอบออกบิลล่าสุด (billRunLast) — อ่านอย่างเดียว');
at('2026-11-12', '09:00');
r = step('billRunLast', 'handleBillRunLast', A, 'รอบล่าสุด');
eq('💰 รอบ ' + RUN + ' · ย้อนได้ 2 ใบ (เอ 6,900 · อี 4,500 = 11,400) · เก็บไว้ 3 ใบ (สลิปรอตรวจ · จ่ายแล้ว · จ่ายบางส่วน)',
  [r.host.data.runId, r.host.data.month, r.host.data.removable.map(x => x.studentId), r.host.data.amount, r.host.data.keep.map(x => x.studentId), r.host.ops.length],
  [RUN, '2026-11', ['S01', 'S05'], 11400, ['S02', 'S03', 'S04'], 0]);
r = step('billRunLast', 'handleBillRunLast', Object.assign({ month: '2026-10' }, A), 'รอบของเดือน 10');
eq('...รอบ ' + RUN_OLD, r.host.data.runId, RUN_OLD);
r = step('billRunLast', 'handleBillRunLast', Object.assign({ month: '2026-09' }, A), 'เดือนที่ไม่มีรอบ');
eq('...found:false', r.host.data, { found: false, month: '2026-09' });

console.log('\n2) 💰 ย้อนกลับรอบออกบิล (undoBillRun) — ลบจาก BILLING ซึ่งปกติห้ามหด');
r = step('undoBillRun', 'handleUndoBillRun', Object.assign({ runId: RUN }, A), '🔴 ไม่ได้ยืนยัน');
eq('🔴 ...NEED_CONFIRM ไม่ลบอะไร', [r.host.code, db.BILLING.length], ['NEED_CONFIRM', 8]);
r = step('undoBillRun', 'handleUndoBillRun', Object.assign({ runId: RUN_OLD, confirm: true }, A), '🔴 รอบที่ไม่ใช่ล่าสุด (เปิดหน้าจอค้างไว้)');
eq('🔴 ...RUN_CHANGED', r.host.code, 'RUN_CHANGED');
r = step('undoBillRun', 'handleUndoBillRun', Object.assign({ confirm: true }, A), '🔴 ไม่ระบุรอบ');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('undoBillRun', 'handleUndoBillRun', Object.assign({ runId: RUN, confirm: true }, A), '💰 ย้อนกลับรอบล่าสุด');
eq('💰 ลบ 2 ใบ (เอ · อี) · ข้าม 3 ใบที่มีเงินเกี่ยวข้อง · ใบเดือน 10 และใบออกมือไม่ถูกแตะ',
  [r.host.data.removed, r.host.data.skipped.map(x => x.studentId), r.host.data.amount, ids()],
  [2, ['S02', 'S03', 'S04'], 11400, ['BL-2026-10-S01', 'BL-2026-11-S02', 'BL-2026-11-S03', 'BL-2026-11-S04', 'BL-2026-11-S06', 'BL-2026-11-S07']]);
ok_('...audit บันทึกว่าใครย้อน กี่ใบ เท่าไร ข้ามกี่ใบ', /ย้อนกลับ 2 ใบ เดือน 2026-11 รวม ฿11400 \(ข้าม 3 ใบ/.test((db.AUDIT_LOG.slice(-1)[0] || {}).RecordID || ''));

console.log('\n3) 💰 ลบบิลทีละใบ (deleteBill)');
r = step('deleteBill', 'handleDeleteBill', Object.assign({ billingId: 'BL-2026-11-S07' }, A), '🔴 บิลที่มีเงินยืนยันแล้วผูกอยู่');
eq('🔴 ...BILL_HAS_PAYMENT ไม่ลบ', [r.host.code, ids().indexOf('BL-2026-11-S07') >= 0], ['BILL_HAS_PAYMENT', true]);
r = step('deleteBill', 'handleDeleteBill', Object.assign({ billingId: 'BL-2026-11-S02' }, A), '🔴 บิลที่มีสลิปรอตรวจ');
eq('🔴 ...BILL_HAS_PAYMENT (รอตรวจ 6900)', [r.host.code, /รอตรวจ 6900/.test(r.host.msg)], ['BILL_HAS_PAYMENT', true]);
r = step('deleteBill', 'handleDeleteBill', Object.assign({ billingId: 'BL-2026-11-S06' }, A), '💰 ลบบิลที่ออกมือ ไม่มีเงินผูก');
eq('💰 หายไป 1 ใบ', [r.host.data, ids().indexOf('BL-2026-11-S06')], [{ ok: true }, -1]);
r = step('deleteBill', 'handleDeleteBill', Object.assign({ billingId: 'BL-2026-11-S06' }, A), '🔴 ลบซ้ำ');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');

console.log('\n4) แจ้งผู้ปกครองว่าออกบิลแล้ว (notifyBills)');
r = step('notifyBills', 'handleNotifyBills', Object.assign({ studentIds: ['S01', 'S02', 'S99', ''], month: '2026-11' }, A), 'แจ้ง 3 รายการ (หนึ่งไม่มีจริง · หนึ่งว่าง)');
eq('...แม่เอ + พ่อเอ (USER_LINKS) ได้ LINE · แม่บีไม่มี LINE · กระดิ่งครอบครัวของเอและบี',
  [r.host.data, r.host.line.map(p => p.to), db.ADMIN_INBOX.map(x => x.StudentID)],
  [{ ok: true, notified: 1, month: '2026-11' }, ['Uparent0000001', 'Ufather0000001'], ['S01', 'S02']]);
r = step('notifyBills', 'handleNotifyBills', Object.assign({ studentIds: ['S03'] }, A), 'ไม่ระบุเดือน → เดือนนี้ตามนาฬิกาโรงเรียน');
eq('...2026-11', r.host.data.month, '2026-11');

console.log('\n5) 🔴 ด่านและกล่องทราย');
{
  const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
  const g = (a, role) => { try { GATE.identity(a, { billingId: 'BL-2026-11-S07', runId: RUN, confirm: true }, { uid: 'U-x', role, linkedId: role === 'Parent' ? 'PAR-01' : 'STF-T' }, {}); return 'ok'; } catch (e) { return e.apiCode || e.message; } };
  eq('🔴 ครู / ผู้ปกครองเรียกทั้ง 4 → NO_PERMISSION', ['notifyBills', 'billRunLast', 'undoBillRun', 'deleteBill'].map(a => [g(a, 'Teacher'), g(a, 'Parent')]),
    [['NO_PERMISSION', 'NO_PERMISSION'], ['NO_PERMISSION', 'NO_PERMISSION'], ['NO_PERMISSION', 'NO_PERMISSION'], ['NO_PERMISSION', 'NO_PERMISSION']]);
  eq('ข้อยกเว้นเรื่องหด: เฉพาะ deleteBill / undoBillRun และเฉพาะ BILLING', ['deleteBill', 'undoBillRun', 'notifyBills', 'billRunLast', 'adminDeleteOT', 'parentCancelLeave'].map(a => ROUTES.shrinks(a)),
    [['BILLING'], ['BILLING'], [], [], [], []]);
  ok_('billRunLast อ่านอย่างเดียว (ไม่มีสิทธิ์เขียน)', !ROUTES.writes('billRunLast'));
  const saved = ROUTES.PORTED.deleteBill.deletes; ROUTES.PORTED.deleteBill.deletes = [];
  G.run(function () { appendObject_(sheet_(getMainSpreadsheet_(), 'BILLING'), { BillingID: 'BL-2026-12-S01', StudentID: 'S01', Month: '2026-12', Amount: 6900, Status: 'UNPAID' }); return ''; });
  db.BILLING.push(Object.assign({ __id: 'r' + (nextId++) }, gasState().BILLING.slice(-1)[0]));
  const keep = JSON.stringify(db); const h = host('deleteBill', Object.assign({ billingId: 'BL-2026-12-S01' }, A));
  ROUTES.PORTED.deleteBill.deletes = saved;
  ok_('🔴 ถ้าไม่ได้ประกาศ deletes → NOT_ON_FAST_HOST ไม่มีอะไรถูกลบ', !h.ok && h.code === 'NOT_ON_FAST_HOST' && JSON.stringify(db) === keep);
  ok_('🔴 ...และ shrinks ที่ไม่มี deletes คู่กันไม่มีผล', ROUTES.shrinks('deleteBill').length === 1 && (() => { const d = ROUTES.PORTED.deleteBill.deletes; ROUTES.PORTED.deleteBill.deletes = []; const x = ROUTES.shrinks('deleteBill').length; ROUTES.PORTED.deleteBill.deletes = d; return x === 0; })());
}
ROUTES.setClock(null);
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
