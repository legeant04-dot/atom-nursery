/**
 * tools/test_fast_route_payroll.js — W4 group 3d: payroll (เงินเดือน), on the fast host, baht for baht
 *   node tools/test_fast_route_payroll.js
 *
 * 💰 The slip is the most composed figure in the app: base (pay type · temporary-leave rule) + เบี้ยขยัน + the
 * child rate (per teacher) + certificates + OT เย็น + OT carried from an earlier month + OT วันหยุด + adjustment
 * lines − ประกันสังคม − เงินสมทบ − other. Every step is compared three ways (reply · every row of every sheet ·
 * LINE) with both sides at the same fixed minute, and the first slip's arithmetic is also written out by hand.
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
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));
delete process.env.ATOM_DB;
const G = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff',
  'GasEngine', 'Engine', 'Payroll', 'PayAdjust', 'Day6', 'OtStaff', 'OT', 'AttReq', 'Password', 'PaySlips', 'BillRun', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce', 'Demo']);

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'STUDENTS'], ['MAIN', 'LEAVE_REQUEST_STD'], ['MAIN', 'ABSENCE_LOG'], ['MAIN', 'ADMIN_INBOX'],
  ['HR', 'STAFF'], ['HR', 'PAYROLL_CONFIG'], ['HR', 'PAYROLL'], ['HR', 'LEAVE_REQUEST'], ['HR', 'CHECKIN_STAFF'], ['HR', 'OT_RECORDS'],
  ['HR', 'PAY_ADJUSTMENTS'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG']];
const st = (id, name, extra) => Object.assign({ StaffID: id, Name: name, Role: 'Teacher', PositionLevel: 'Teacher', Position: 'ครูประจำชั้น', Department: 'N1',
  Status: 'ACTIVE', StartDate: '2025-01-01', BaseSalary: 15000, BankName: 'SCB', BankAccount: '123-4-56789-0' }, extra || {});
const kid = (id, extra) => Object.assign({ StudentID: id, Name: 'ด.ช. ' + id, Nickname: id, Class: 'N1', Plan: 'P1', Status: 'ACTIVE', EnrollDate: '2026-01-05' }, extra || {});
const pr = (id, sid, month, extra) => Object.assign({ PayrollID: id, StaffID: sid, Month: month, BaseSalary: 15000, GrossIncome: 15000, NetPay: 15000, TotalDeductions: 0,
  OTEvening: 0, Contribution: 0, SlipSent: 'NO', GeneratedDate: month + '-28T03:00:00.000Z', GeneratedBy: 'STF-A' }, extra || {});
const FIX = {
  SCHOOL_CONFIG: [['Timezone', 'Asia/Bangkok'], ['DiligenceAttendanceAmount', '500'], ['DiligenceFacebookAmount', '500'], ['DiligenceLeaveMaxDays', '3'],
    ['TrainingCertMaxPerMonth', '2'], ['TrainingCertRate', '100'], ['SocialSecurityRate', '0.05'], ['SocialSecurityMax', '750'], ['ContributionMatchRate', '1'],
    ['OTEveningRate', '100'], ['BigCleaningAmount', '200'], ['BigCleaningDays', '2026-11-14'], ['AbsenceRateExcludeDays', '6']],
  /* 5 children on the roll; K5 was away 6 days in November (3 absent + 3 leave) → not counted → rated 4 */
  STUDENTS: [kid('K1'), kid('K2'), kid('K3'), kid('K4'), kid('K5')],
  ABSENCE_LOG: [3, 4, 5].map(d => ({ StudentID: 'K5', Date: '2026-11-0' + d, Type: 'ABSENT' })),
  LEAVE_REQUEST_STD: [9, 10, 11].map(d => ({ LeaveID: 'SL-' + d, StudentID: 'K5', Date: '2026-11-' + String(d).padStart(2, '0'), Status: 'APPROVED', Type: 'sick' })),
  STAFF: [st('STF-T', 'ครูที', { ContributionOpening: 5000, ContributionAccum: 5400 }), st('STF-U', 'ครูยู'),
    st('STF-P', 'ครูพัก', { BaseSalary: 20000, PauseFrom: '2026-11-05', PauseTo: '2026-11-25', PauseSalaryMode: 'HALF', PauseReason: 'ลาคลอด' }),
    st('STF-D', 'ครูรายวัน', { BaseSalary: 0 }), st('STF-J', 'ครูเจ', { ContributionOpening: 0, ContributionAccum: 35800 }),
    st('STF-A', 'แอดมินเอ', { Role: 'Admin', PositionLevel: 'Admin', Position: 'ผู้จัดการ' })],
  PAYROLL_CONFIG: [{ StaffID: 'STF-T', ChildThreshold: 3, ChildMultiplier: 300, DiligenceAttendanceAmount: 1000, Contribution: 200, SocialSecurityDeduct: 'YES' },
    { StaffID: 'STF-D', PayType: 'daily', DailyRate: 500 }],
  /* October was paid with 100 of OT เย็น; 300 was approved for October (one evening approved late) → 200 carried.
   * Its ContributionEmployer is blank — a slip from before the school's half was recorded → rebuilt at the match rate. */
  PAYROLL: [pr('PR-0001', 'STF-T', '2026-10', { OTEvening: 100, Contribution: 200, ContributionEmployer: '', SlipSent: 'YES', PaidDate: '2026-10-31' }),
    pr('PR-0002', 'STF-J', '2026-07', { Contribution: 200, ContributionEmployer: 200, PaidDate: '2026-07-31', SlipSent: 'YES' }),
    pr('PR-0003', 'STF-J', '2026-07', { GrossIncome: 0, NetPay: 0, BaseSalary: 0 }),
    pr('PR-0004', 'STF-J', '2026-08', { Contribution: 200, ContributionEmployer: 200 })],
  LEAVE_REQUEST: [{ LeaveID: 'LV-1', StaffID: 'STF-U', Type: 'sick', StartDate: '2026-11-16', EndDate: '2026-11-19', Days: 4, Status: 'APPROVED' }],
  CHECKIN_STAFF: [{ StaffID: 'STF-U', Date: '2026-11-03', CheckIn: '08:07', LateMinutes: 7 }, { StaffID: 'STF-T', Date: '2026-11-03', CheckIn: '07:55', LateMinutes: 0 },
    { StaffID: 'STF-T', Date: '2026-11-14', CheckIn: '08:20', LateMinutes: 0 }],
  OT_RECORDS: [{ OTRecordID: 'OTR-1', StaffID: 'STF-T', Date: '2026-10-20', Hours: 1, Amount: 100, Status: 'APPROVED', Month: '2026-10' },
    { OTRecordID: 'OTR-2', StaffID: 'STF-T', Date: '2026-10-30', Hours: 2, Amount: 200, Status: 'APPROVED', Month: '2026-10' },
    { OTRecordID: 'OTR-3', StaffID: 'STF-T', Date: '2026-11-10', Hours: 2.5, Amount: 250, Status: 'APPROVED', Month: '2026-11' },
    { OTRecordID: 'OTR-4', StaffID: 'STF-T', Date: '2026-11-20', Hours: 1, Amount: 100, Status: 'PENDING', Month: '2026-11' },
    { OTRecordID: 'OTR-5', StaffID: 'STF-T', Date: '2026-11-15', Hours: 0, Amount: 800, Status: 'APPROVED', Month: '2026-11', Kind: 'HOLIDAY' }],
  ADMIN_INBOX: [], PAY_ADJUSTMENTS: []
};
G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    var sh = sheet_(x[0] === 'HR' ? hr : main, x[1]);
    if (x[1] === 'PAYROLL') ensureColumns_(sh, SCHEMA[WB.HR].PAYROLL);
    if (x[1] === 'STAFF') ensureColumns_(sh, ['ContributionOpening', 'ContributionAccum', 'ContributionLocked', 'PauseFrom', 'PauseTo', 'PauseReason', 'PauseSalaryMode', 'PauseSalaryAmount']);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    (F[x[1]] || []).forEach(function (r) { appendObject_(sh, x[1] === 'SCHOOL_CONFIG' ? { Key: r[0], Value: r[1] } : r); });
  });
  _configCache = null; return '';
});
const gasState = () => JSON.parse(G.run(function () {
  var out = {}, main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    out[(x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1]))
      .map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
  });
  return JSON.stringify(out);
}));
let nextId = 1; const db = {};
{ const s = gasState(); Object.keys(s).forEach(k => { db[k] = s[k].map(r => Object.assign({ __id: 'r' + (nextId++) }, r)); }); }
/* the engine the host builds for the request — here on the same students / leaves / absences Apps Script hydrates */
const M = JSON.parse(G.run(function () {
  _configCache = null; var c = hydrateLazy_('');
  return JSON.stringify({ students: c.M.students, studentLeaves: c.M.studentLeaves, absenceLog: c.M.absenceLog, config: c.M.config });
}));
const H = createAtomAPI(M, null).H;
const applyOps = ops => ops.forEach(o => {
  const t = db[o.sheet] || (db[o.sheet] = []);
  if (o.op === 'insert') { const id = 'r' + (nextId++); t.push(Object.assign({ __id: id }, JSON.parse(JSON.stringify(o.row)))); o.__real = id; return; }
  const id = String(o.id).indexOf('new:') === 0 ? ops.find(x => x.tmp === o.id).__real : o.id;
  const i = t.findIndex(r => r.__id === id); if (i < 0) throw new Error('op on a missing row ' + o.sheet + ' ' + id);
  if (o.op === 'update') Object.assign(t[i], JSON.parse(JSON.stringify(o.patch))); else t.splice(i, 1);
});
const host = (action, payload, h) => {
  const raw = {}; ROUTES.needs([action]).forEach(s => { raw[s] = JSON.parse(JSON.stringify(db[s] || [])); });
  const sink = [], line = { ready: true, out: [] };
  try { const data = ROUTES.run(action, payload, raw, h === undefined ? H : h, {}, sink, line); applyOps(sink); return { ok: true, data, ops: sink, line: line.out }; }
  catch (e) { return { ok: false, code: e.apiCode || e.message, msg: e.message, ops: sink, line: line.out }; }
};
const gas = (fn, payload) => { G.g.__P = JSON.stringify(payload); G.g.__F = fn; return JSON.parse(G.run(function () {
  _configCache = null; _ratedChildCache_ = {}; PUSH.length = 0;
  var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message, msg: e.message }; }
  r.line = PUSH.slice(); return JSON.stringify(r); })); };
G.g.__FAKE = ROUTES.FAKE_DATE;
const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); G.g.__MS = ms;
  G.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };
const comparable = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = /^IN-\d+(-\d+)+$/.test(o.InboxID) ? 'IN-…' : o.InboxID;
  if (name === 'AUDIT_LOG' || name === 'HR_AUDIT_LOG') { delete o.LogID; delete o.Timestamp; }
  return o; });
const hostPushes = list => list.map(p => (p.messages.length === 1 && p.messages[0].type === 'text') ? { to: p.to, text: p.messages[0].text } : { to: p.to, bad: p.messages });
function step(action, fn, p, label) {
  const w = gas(fn, p), h = host(action, p);
  const rw = JSON.stringify(w.ok ? { ok: true, data: w.data } : { ok: false, code: w.code, msg: w.msg });
  const rh = JSON.stringify(h.ok ? { ok: true, data: h.data } : { ok: false, code: h.code, msg: h.msg });
  ok_(label + ' — คำตอบเท่ากัน' + (rw === rh ? '' : '\n         gas=' + rw.slice(0, 900) + '\n        host=' + rh.slice(0, 900)), rw === rh);
  const s = gasState(), diff = Object.keys(s).filter(k => JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || [])));
  ok_('   ...ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
  diff.forEach(k => console.log('         ' + k + '\n           gas=' + JSON.stringify(comparable(k, s[k])).slice(-900) + '\n          host=' + JSON.stringify(comparable(k, db[k] || [])).slice(-900)));
  const lw = JSON.stringify(w.line), lh = JSON.stringify(hostPushes(h.line));
  ok_('   ...LINE เท่ากัน (' + w.line.length + ')' + (lw === lh ? '' : '\n         gas=' + lw.slice(0, 300) + '\n        host=' + lh.slice(0, 300)), lw === lh);
  return { gas: w, host: h };
}
/* a step only the host can take — the confirmed backup-first writes. It must refuse and record NOTHING. */
function hostOnly(action, p, label) {
  const before = JSON.stringify(db), h = host(action, p);
  eq(label + ' → NOT_ON_FAST_HOST (Apps Script ทำแทน พร้อมสำรองข้อมูล)', h.code, 'NOT_ON_FAST_HOST');
  ok_('   ...ไม่มีอะไรถูกบันทึก', JSON.stringify(db) === before && !h.ops.length);
  return h;
}
const A = { adminId: 'STF-A', generatedBy: 'STF-A' };   // an admin's payload: staffId is the TARGET (applyIdentity_ leaves it)
const ROW = (sid, m) => db.PAYROLL.filter(x => x.StaffID === sid && x.Month === m);
const S = id => db.STAFF.find(x => x.StaffID === id) || {};
let r;
at('2026-11-28', '10:00');

console.log('\n1) 💰 คำนวณเงินเดือน ครูที พ.ย. 2569 (computePayroll)');
const TPAY = Object.assign({ staffId: 'STF-T', month: '2026-11', facebookPosted: true, trainingCertCount: 3,
  adjustments: [{ label: 'ค่าเดินทาง', amount: 300 }, { label: 'เบิกล่วงหน้า', amount: -1000 }, { label: '', amount: 0 }] }, A);
r = step('computePayroll', 'handleComputePayroll', Object.assign({ preview: true }, TPAY), 'ดูตัวอย่าง (preview)');
ok_('...ไม่มีอะไรถูกบันทึก', !r.host.ops.length && ROW('STF-T', '2026-11').length === 0);
const d = r.host.data;
console.log('\n     ── สลิปครูที พ.ย. (ให้ ผอ. ตรวจ) ──');
[['เงินเดือน', d.BaseSalary], ['เบี้ยขยัน มาครบ (ค่าของครูคนนี้ 1,000)', d.DiligenceAttendance], ['เบี้ยขยัน โพสต์ FB (ค่าโรงเรียน 500)', d.DiligenceFacebook],
  ['Big Cleaning 14 พ.ย. มาทำงาน (200)', d.DiligenceTotal - d.DiligenceAttendance - d.DiligenceFacebook],
  ['เรทเด็ก: นับได้ ' + d.RatedTotal + ' คน · จ่ายตั้งแต่คนที่ ' + d.ChildThreshold + ' → ' + d.ExtraChildCount + ' คน × ' + d.ChildMultiplier, d.ExtraChildAmount],
  ['ใบประกาศ 3 ใบ (สูงสุด 2) × 100', d.TrainingCertAmount], ['OT เย็น พ.ย. (อนุมัติแล้ว · รออนุมัติไม่นับ)', d.OTEvening], ['OT ยกมาจาก ต.ค.', d.OTCarry],
  ['OT วันหยุด', d.OTHoliday], ['รายได้อื่น (เรทเด็ก + ใบประกาศ + ค่าเดินทาง 300)', d.OtherIncome], ['รวมรายได้', d.GrossIncome],
  ['ประกันสังคม 5% สูงสุด 750', d.SocialSecurity], ['เงินสมทบ (ครู)', d.Contribution], ['หักอื่น (เบิกล่วงหน้า)', d.OtherDeductions], ['รวมหัก', d.TotalDeductions],
  ['สุทธิ', d.NetPay], ['เงินสมทบที่โรงเรียนสมทบ', d.ContributionEmployer], ['เงินสมทบสะสม (ยกมา 5,000 + ต.ค. 200+200 + พ.ย. 200+200)', d.ContributionAccum]]
  .forEach(x => console.log('     ' + x[0].padEnd(60) + String(Number(x[1]).toLocaleString('en-US')).padStart(10)));
eq('💰 รายได้: 15,000 + 1,000 + 500 + 200 + เด็ก 2×300=600 + ใบประกาศ 200 + ค่าเดินทาง 300 + OT 250 + ยกมา 200 + วันหยุด 800 = 19,050',
  [d.BaseSalary, d.DiligenceTotal, d.ExtraChildCount, d.ExtraChildAmount, d.TrainingCertAmount, d.OtherIncome, d.OTEvening, d.OTCarry, d.OTHoliday, d.GrossIncome],
  [15000, 1700, 2, 600, 200, 1100, 250, 200, 800, 19050]);
eq('💰 หัก: ประกันสังคม 750 + สมทบ 200 + เบิกล่วงหน้า 1,000 = 1,950 · สุทธิ 17,100 · สะสม 5,800',
  [d.SocialSecurity, d.Contribution, d.OtherDeductions, d.TotalDeductions, d.NetPay, d.ContributionEmployer, d.ContributionAccum], [750, 200, 1000, 1950, 17100, 200, 5800]);
eq('...OT ยกมา: ต.ค. อนุมัติ 300 จ่ายไปแล้ว 100', JSON.parse(JSON.stringify(d.OTCarryDetail)), JSON.stringify([{ month: '2026-10', amount: 200, hours: 2 }]));

r = step('computePayroll', 'handleComputePayroll', TPAY, '💰 บันทึก');
eq('💰 แถวใหม่ PR-0005 · ยังไม่อนุมัติ · สุทธิ 17,100', ROW('STF-T', '2026-11').map(x => [x.PayrollID, x.Approved, x.NetPay]), [['PR-0005', 'NO', 17100]]);
eq('...ยอดสะสมบน STAFF = 5,800 (ยอดยกมาไม่ถูกแตะ)', [S('STF-T').ContributionAccum, S('STF-T').ContributionOpening], [5800, 5000]);

console.log('\n2) อนุมัติสลิป (approvePayslip)');
r = step('approvePayslip', 'handleApprovePayslip', Object.assign({ targetId: 'STF-T', month: '2026-11' }, A), 'อนุมัติ');
eq('...YES · ผู้อนุมัติ · เวลา', [ROW('STF-T', '2026-11')[0].Approved, ROW('STF-T', '2026-11')[0].ApprovedBy, ROW('STF-T', '2026-11')[0].ApprovedAt], ['YES', 'STF-A', '2026-11-28 10:00']);
r = step('computePayroll', 'handleComputePayroll', Object.assign({}, TPAY, { facebookPosted: false }), '💰 คำนวณใหม่หลังอนุมัติ (ไม่ได้โพสต์ FB)');
eq('💰 แถวเดิม ไม่ซ้ำ · สุทธิ 16,600 · 🔴 การอนุมัติถูกถอน', ROW('STF-T', '2026-11').map(x => [x.PayrollID, x.NetPay, x.Approved]), [['PR-0005', 16600, 'NO']]);
r = step('approvePayslip', 'handleApprovePayslip', Object.assign({ targetId: 'STF-T', month: '2026-11', approve: false }, A), 'ถอนการอนุมัติ');
eq('...NO (ไม่ใช่ค่าว่าง)', ROW('STF-T', '2026-11')[0].Approved, 'NO');
r = step('approvePayslip', 'handleApprovePayslip', Object.assign({ targetId: 'STF-T', month: '2026-09' }, A), '🔴 เดือนที่ยังไม่มีสลิป');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');
r = step('approvePayslip', 'handleApprovePayslip', Object.assign({ targetId: 'STF-T', month: '2026-11' }, A), 'อนุมัติอีกครั้ง');

console.log('\n3) 💰 กรณีพิเศษของสลิป');
r = step('computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-U', month: '2026-11' }, A), 'ครูยู: สาย 7 นาที · ลา 4 วัน · ยังไม่ตั้งเรทเด็ก');
eq('💰 ไม่ได้เบี้ยขยัน · ลาเกิน 3 วัน · เรทเด็กว่าง = ฿0 · ไม่หักประกันสังคม (ไม่ได้ติ๊ก) · สุทธิ 15,000',
  [r.host.data.DiligenceAttendance, r.host.data.LeaveExceeds, r.host.data.ChildThreshold, r.host.data.ExtraChildAmount, r.host.data.SocialSecurity, r.host.data.NetPay],
  [0, true, '', 0, 0, 15000]);
r = step('computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-P', month: '2026-11' }, A), 'ครูพัก: ลาพักครึ่งเงินเดือน');
eq('💰 20,000 → 10,000 · สลิปบอกเหตุผล · เงินเดือนจริงบน STAFF ไม่ถูกแตะ', [r.host.data.BaseSalary, r.host.data.PauseSalaryMode, r.host.data.PauseReason, S('STF-P').BaseSalary], [10000, 'HALF', 'ลาคลอด', 20000]);
r = step('computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-D', month: '2026-11', daysWorked: 20 }, A), 'ครูรายวัน 20 วัน × 500');
eq('💰 10,000', [r.host.data.PayType, r.host.data.BaseSalary], ['daily', 10000]);
r = step('computePayroll', 'handleComputePayroll', { staffId: 'STF-U', month: '2026-12', role: 'Teacher' }, '🔴 ครูขอคำนวณจริง → ได้แค่ตัวอย่าง');
ok_('🔴 ...Preview · ไม่มีอะไรถูกบันทึก', r.host.data.Preview === true && !r.host.ops.length && !ROW('STF-U', '2026-12').length);
r = step('computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-X', month: '2026-11' }, A), '🔴 ไม่มีพนักงาน');
eq('🔴 ...STAFF_NOT_FOUND', r.host.code, 'STAFF_NOT_FOUND');
r = step('computePayroll', 'handleComputePayroll', Object.assign({ staffId: 'STF-T' }, A), '🔴 ไม่ระบุเดือน');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
{ const h = host('computePayroll', Object.assign({ preview: true }, TPAY), {});
  eq('🔴 engine ไม่พร้อม → ไม่ตอบเป็น ฿0 แต่ส่งให้ Apps Script', h.code, 'NOT_ON_FAST_HOST'); }

console.log('\n4) 💰 บันทึกว่าจ่ายแล้ว (markSalaryPaid)');
r = step('markSalaryPaid', 'handleMarkSalaryPaid', Object.assign({ staffId: 'STF-T', month: '2026-11', paid: true, slipUrl: 'https://drive.example/salary-t' }, A), 'จ่ายแล้ว พร้อมลิงก์สลิป');
eq('💰 SlipSent YES · วันที่จ่าย · ลิงก์', ['SlipSent', 'PaidDate', 'PaidBy', 'SlipUrl'].map(k => ROW('STF-T', '2026-11')[0][k]), ['YES', '2026-11-28', 'STF-A', 'https://drive.example/salary-t']);
eq('...🔔 ของครูที (ในแอปเท่านั้น)', db.ADMIN_INBOX.map(x => [x.Category, x.StaffID, x.Ref, x.Text]), [['payslip', 'STF-T', 'PR-0005', '📄 สลิปเงินเดือน พฤศจิกายน 2569 ออกให้แล้ว · โอนสุทธิ 16,600.00 บาท — เปิดดูได้ที่เมนูสลิปเงินเดือน']]);
hostOnly('markSalaryPaid', Object.assign({ staffId: 'STF-U', month: '2026-11', paid: true, slipUrl: 'data:image/jpeg;base64,AAAA' }, A), 'แนบรูปสลิป');
r = step('markSalaryPaid', 'handleMarkSalaryPaid', Object.assign({ staffId: 'STF-T', month: '2026-11', paid: false }, A), 'ยกเลิกสถานะจ่าย');
eq('...NO · วันที่และลิงก์ถูกล้าง', ['SlipSent', 'PaidDate', 'SlipUrl'].map(k => ROW('STF-T', '2026-11')[0][k]), ['NO', '', '']);
r = step('markSalaryPaid', 'handleMarkSalaryPaid', Object.assign({ staffId: 'STF-T', month: '2026-11', paid: true }, A), 'จ่ายแล้ว (ไม่มีสลิป)');
r = step('markSalaryPaid', 'handleMarkSalaryPaid', Object.assign({ staffId: 'STF-T', month: '2026-08', paid: true }, A), '🔴 เดือนที่ไม่มีสลิป');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');
r = step('computePayroll', 'handleComputePayroll', Object.assign({}, TPAY, { facebookPosted: false }), '💰 คำนวณใหม่หลังจ่ายแล้ว');
eq('💰 การจ่ายเงินยังอยู่บนสลิป (ไม่ถูกคำนวณทับ)', ['SlipSent', 'PaidDate'].map(k => ROW('STF-T', '2026-11')[0][k]), ['YES', '2026-11-28']);

console.log('\n5) 💰 ปรับเงินเดือน / ตำแหน่ง / เบี้ย (adjustStaffPay · payAdjustHistory)');
r = step('adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-T', baseSalary: 16000, position: 'ครูประจำชั้น', childMultiplier: 350, reason: 'ประเมินประจำปี' }, A),
  'ขึ้นเงินเดือน 15,000 → 16,000 · เรทเด็ก 300 → 350 · ตำแหน่งเท่าเดิม');
eq('💰 บันทึก 2 รายการ (ตำแหน่งไม่เปลี่ยน = ไม่บันทึก)', db.PAY_ADJUSTMENTS.map(x => [x.Field, x.FromValue, x.ToValue, x.Reason, x.ByName]),
  [['BaseSalary', '15000', '16000', 'ประเมินประจำปี', 'แอดมินเอ'], ['ChildMultiplier', '300', '350', 'ประเมินประจำปี', 'แอดมินเอ']]);
eq('...ค่าปัจจุบันอยู่ที่เดิม: STAFF 16,000 · PAYROLL_CONFIG 350', [S('STF-T').BaseSalary, db.PAYROLL_CONFIG.find(x => x.StaffID === 'STF-T').ChildMultiplier], [16000, 350]);
r = step('adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-U', contribution: 300, positionLevel: 'Leader', reason: 'เลื่อนเป็นหัวหน้า' }, A), 'ครูยู (ยังไม่มีแถวตั้งค่า): สมทบ 300 · Leader');
eq('...เพิ่มแถว PAYROLL_CONFIG ใหม่', db.PAYROLL_CONFIG.filter(x => x.StaffID === 'STF-U').map(x => x.Contribution), [300]);
r = step('adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-T', baseSalary: 16000 }, A), '🔴 ไม่ใส่เหตุผล');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-T', baseSalary: 16000, reason: 'ซ้ำ' }, A), '🔴 ไม่มีอะไรเปลี่ยน');
eq('🔴 ...NO_CHANGE', r.host.code, 'NO_CHANGE');
r = step('adjustStaffPay', 'handleAdjustStaffPay', Object.assign({ targetId: 'STF-T', baseSalary: -1, reason: 'ผิด' }, A), '🔴 เงินเดือนติดลบ');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step('payAdjustHistory', 'handlePayAdjustHistory', Object.assign({ targetId: 'STF-T' }, A), 'ประวัติของครูที (แอดมิน)');
eq('...2 รายการ', r.host.data.length, 2);
r = step('payAdjustHistory', 'handlePayAdjustHistory', { staffId: 'STF-U', targetId: 'STF-U', role: 'Teacher' }, 'ครูยูดูของตัวเอง');
r = step('payAdjustHistory', 'handlePayAdjustHistory', { staffId: 'STF-U', targetId: 'STF-T', role: 'Teacher' }, '🔴 ครูยูดูของครูที');
eq('🔴 ...NO_PERMISSION', r.host.code, 'NO_PERMISSION');

console.log('\n6) 💰 เงินสมทบ และสลิปซ้ำ');
r = step('recomputeContributions', 'handleRecomputeContributions', Object.assign({ preview: true }, A), 'คำนวณยอดสะสมใหม่ — ดูตัวอย่าง');
eq('...ครูเจ: เก็บไว้ 35,800 · คำนวณจากสลิปได้ 800 (ก.ค. 200+200 · ส.ค. 200+200 · แถวซ้ำว่างไม่มีเงิน) · ไม่เขียน', r.host.data.rows.map(x => [x.staffId, x.before, x.after]).concat([[r.host.data.written, S('STF-J').ContributionAccum]]),
  [['STF-J', 35800, 800], [0, 35800]]);
r = step('payrollDuplicates', 'handlePayrollDuplicates', A, 'หาสลิปซ้ำ');
eq('...ครูเจ ก.ค. 2 แถว · เก็บแถวที่จ่ายแล้ว (PR-0002)', r.host.data.groups.map(g => [g.staffId, g.month, g.count, g.keepId, g.reason]), [['STF-J', '2026-07', 2, 'PR-0002', 'PAID']]);
r = step('deletePayrollRow', 'handleDeletePayrollRow', Object.assign({ payrollId: 'PR-0003' }, A), 'ลบแถวซ้ำ — ดูตัวอย่าง');
eq('...preview', r.host.data.preview, true);
r = step('deletePayrollRow', 'handleDeletePayrollRow', Object.assign({ payrollId: 'PR-0002', confirm: true }, A), '🔴 ลบแถวที่จ่ายแล้ว');
eq('🔴 ...ALREADY_PAID', r.host.code, 'ALREADY_PAID');
hostOnly('deletePayrollRow', Object.assign({ payrollId: 'PR-0003', confirm: true }, A), 'ลบจริง');
r = step('contributionReset', 'handleContributionReset', Object.assign({ staffId: 'STF-J', newOpening: 35000 }, A), 'ล้างเงินสมทบครูเจ — ดูตัวอย่าง');
eq('...ส่วนต่างที่อธิบายไม่ได้ 35,800 − 800 = 35,000 · ก.ค. ซ้ำ', [r.host.data.before.unexplained, r.host.data.duplicateMonths, r.host.data.preview], [35000, ['2026-07'], true]);
hostOnly('contributionReset', Object.assign({ staffId: 'STF-J', newOpening: 35000, confirm: true }, A), 'ล้างจริง');
r = step('recomputeContributions', 'handleRecomputeContributions', Object.assign({ preview: false }, A), '💰 คำนวณยอดสะสมใหม่ — บันทึก');
eq('💰 ครูเจ 35,800 → 800', [r.host.data.written, S('STF-J').ContributionAccum], [1, 800]);

console.log('\n7) 🔴 ด่าน');
{
  const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
  const g = (a, role) => { try { GATE.identity(a, { targetId: 'STF-T', staffId: 'STF-T', month: '2026-11', payrollId: 'PR-0005', confirm: true, preview: false }, { uid: 'U-x', role, linkedId: role === 'Parent' ? 'PAR-01' : 'STF-U' }, {}); return 'ok'; } catch (e) { return e.apiCode || e.message; } };
  const ADMIN_ONLY = ['approvePayslip', 'adjustStaffPay', 'markSalaryPaid', 'recomputeContributions', 'payrollDuplicates', 'contributionReset', 'deletePayrollRow'];
  eq('🔴 ครู / ผู้ปกครองเรียก 7 เส้นทางของแอดมิน → NO_PERMISSION', ADMIN_ONLY.map(a => [g(a, 'Teacher'), g(a, 'Parent')]), Array(7).fill(['NO_PERMISSION', 'NO_PERMISSION']));
}
ROUTES.setClock(null);
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
