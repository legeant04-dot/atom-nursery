/**
 * tools/test_fast_route_pickup.js — W3: a family drops off and picks up on the fast host, baht for baht
 *   node tools/test_fast_route_pickup.js
 *
 * 💰 parentCheckin OUT is where a late-pickup charge (OT_DAILY) is born, refreshed or cancelled. Every rule
 * of otUpsertForPickup_ is walked with BOTH sides standing at the same fixed minute, and every step is
 * compared three ways as in W1/W2: the reply · every row of every sheet the route can touch · every LINE
 * message (recipient, text, order).
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
  'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'PaySlips', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce', 'Demo']);

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['MAIN', 'PARENTS'], ['MAIN', 'STUDENTS'], ['MAIN', 'CLASSES'], ['HR', 'STAFF'], ['MAIN', 'HOLIDAYS'], ['MAIN', 'HOLIDAY_ATTEND'],
  ['MAIN', 'LEAVE_REQUEST_STD'], ['MAIN', 'CHECKIN_STUDENT'], ['MAIN', 'OT_DAILY'], ['MAIN', 'PAYMENT_SLIPS'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'USERS'], ['MAIN', 'LINE_RECIPIENTS'], ['MAIN', 'AUDIT_LOG']];
const LAT = 13.7563, LNG = 100.5018;
const kid = (id, nick, extra) => Object.assign({ StudentID: id, Name: 'ด.ช. ' + nick, Nickname: nick, Class: 'N1', Plan: 'P1', ParentID: 'PAR-' + id.slice(-2),
  Status: 'ACTIVE', EnrollDate: '2026-06-01' }, extra || {});
const mom = (id, uid) => ({ ParentID: 'PAR-' + id.slice(-2), Name: 'แม่' + id.slice(-2), Relationship: 'มารดา', Phone: '0800000000', LineUID: uid || '', StudentID: id });
const FIX = {
  SCHOOL_CONFIG: [['Timezone', 'Asia/Bangkok'], ['GPS_Lat', String(LAT)], ['GPS_Lng', String(LNG)], ['Radius', '30'],
    ['Plans', JSON.stringify([{ id: 'P1', name: 'เต็มวัน', end: '17:00', price: 6900 }, { id: 'P2', name: 'ครึ่งวัน', end: '12:00', price: 4500 }])],
    ['OTRatePerHour', '100'], ['OTGraceMinutes', '21'], ['CheckinDedupMinutes', '10'],
    ['NotifyStaffArrival', 'app,line'], ['NotifyParentOt', 'app,line'], ['NotifyParentCheckin', 'app,line'],
    ['LineChannelAccessToken', 'test-token-not-real']],
  PARENTS: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12'].map((s, i) => mom(s, i % 3 === 2 ? '' : 'Uparent00000' + s)),
  STUDENTS: [kid('S01', 'เอ'), kid('S02', 'บี', { EndTime: '18:00' }), kid('S03', 'ซี', { OTGraceUntil: '18:00' }), kid('S04', 'ดี', { OTRate: 150 }),
    kid('S05', 'อี', { GeoExempt: 'YES' }), kid('S06', 'เอฟ', { EnrollDate: '2026-12-01' }), kid('S07', 'จี', { EndDate: '2026-10-31' }),
    kid('S08', 'เอช', { OffDays: '2' }), kid('S09', 'ไอ', { Plan: 'P2' }), kid('S10', 'เจ'), kid('S11', 'เค'), kid('S12', 'แอล')],
  CLASSES: [{ ClassID: 'C1', ClassName: 'N1', TeacherID: 'STF-T' }],
  STAFF: [{ StaffID: 'STF-T', Name: 'ครูที', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'Uteacher000001' },
    { StaffID: 'STF-K', Name: 'ครูเค', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-HD', Name: 'หัวหน้าครู', Role: 'Teacher', PositionLevel: 'Leader', Department: '*', Status: 'ACTIVE', StartDate: '2025-01-01' },
    { StaffID: 'STF-Z', Name: 'ครูห้องอื่น', Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N2', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'Uteacher000009' }],
  HOLIDAYS: [{ Date: '2026-11-11', NameTH: 'วันหยุดทั้งวัน' }],
  HOLIDAY_ATTEND: [{ Date: '2026-11-11', StudentID: 'S01', AddedBy: 'STF-T', AddedAt: '2026-11-10 17:00' }],
  LEAVE_REQUEST_STD: [{ LeaveID: 'LVS-0001', StudentID: 'S04', Date: '2026-11-13', Type: 'ลาป่วย', Reason: 'มีไข้', Status: 'APPROVED' }],
  CHECKIN_STUDENT: [],
  /* three charges that already exist on Tuesday 10/11 and must be treated by their history, not recomputed blind */
  OT_DAILY: [
    { OTID: 'OT-20261110-S10', Date: '2026-11-10', StudentID: 'S10', PickupTime: '18:30', PlanEnd: '17:00', LateMinutes: 90, Hours: 2, FullAmount: 200, Discount: 100, DiscountReason: 'ผอ.ลดให้', DiscountBy: 'ADM', Amount: 100, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 },
    { OTID: 'OT-20261110-S11', Date: '2026-11-10', StudentID: 'S11', PickupTime: '18:30', PlanEnd: '17:00', LateMinutes: 90, Hours: 2, FullAmount: 200, Discount: 0, Amount: 200, Status: 'CANCELLED', CancelledBy: 'ADM', CancelNote: 'ยกเว้นให้', SlipRef: '', SlipAmount: 0 },
    { OTID: 'OT-20261110-S12', Date: '2026-11-10', StudentID: 'S12', PickupTime: '17:40', PlanEnd: '17:00', LateMinutes: 40, Hours: 1, FullAmount: 100, Discount: 0, Amount: 100, Status: 'PAID', SlipRef: 'SLP-1', SlipAmount: 100 }],
  PAYMENT_SLIPS: [], ADMIN_INBOX: [], USERS: [],
  LINE_RECIPIENTS: [{ Name: 'ผอ.', LineUID: 'Udirector000004', Topics: 'approval', Active: 'YES', Note: '' }]
};
G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    var wb = x[0] === 'HR' ? hr : main, sh = wb.getSheetByName(x[1]) || sheet_(wb, x[1]);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    (F[x[1]] || []).forEach(function (r) { appendObject_(sh, x[1] === 'SCHOOL_CONFIG' ? { Key: r[0], Value: r[1] } : r); });
  });
  _configCache = null; return '';
});
const gasState = () => JSON.parse(G.run(function () {
  var out = {}, main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    out[x[1]] = readObjects_(sheet_(x[0] === 'HR' ? hr : main, x[1])).map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; return o; });
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
  try { const data = ROUTES.run(action, payload, raw, {}, {}, sink, line); applyOps(sink); return { ok: true, data, ops: sink.length, line: line.out }; }
  catch (e) { if (e.keptOnRefusal) applyOps(sink); return { ok: false, code: e.apiCode || e.message, msg: e.message, ops: e.keptOnRefusal ? sink.length : 0, kept: e.keptOnRefusal || 0, line: line.out }; }
};
const gas = (fn, payload) => { G.g.__P = JSON.stringify(payload); G.g.__F = fn; return JSON.parse(G.run(function () {
  _configCache = null; PUSH.length = 0;
  var r; try { r = { ok: true, data: this[__F](JSON.parse(__P)) }; } catch (e) { r = { ok: false, code: e.apiCode || e.message, msg: e.message }; }
  r.line = PUSH.slice(); return JSON.stringify(r); })); };
const setCfg = (key, value) => {
  G.g.__K = key; G.g.__V = value;
  G.run(function () { _configCache = null; setConfigValue_(__K, __V); _configCache = null; return ''; });
  const row = db.SCHOOL_CONFIG.find(r => r.Key === key);
  if (row) row.Value = value; else db.SCHOOL_CONFIG.push({ __id: 'r' + (nextId++), Key: key, Value: value });
};
G.g.__FAKE = ROUTES.FAKE_DATE;
const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); G.g.__MS = ms;
  G.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };

const comparable = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = /^IN-\d+(-\d+)+$/.test(o.InboxID) ? 'IN-…' : o.InboxID;
  if (name === 'AUDIT_LOG') { delete o.LogID; delete o.Timestamp; }
  return o; });
const hostPushes = list => list.map(p => (p.messages.length === 1 && p.messages[0].type === 'text') ? { to: p.to, text: p.messages[0].text } : { to: p.to, bad: p.messages });
function step(p, label, action, fn) {
  const w = gas(fn || 'handleParentCheckin', p), h = host(action || 'parentCheckin', p);
  const rw = JSON.stringify(w.ok ? { ok: true, data: w.data } : { ok: false, code: w.code, msg: w.msg });
  const rh = JSON.stringify(h.ok ? { ok: true, data: h.data } : { ok: false, code: h.code, msg: h.msg });
  ok_(label + ' — คำตอบเท่ากัน' + (rw === rh ? '' : '\n         gas=' + rw.slice(0, 500) + '\n        host=' + rh.slice(0, 500)), rw === rh);
  const s = gasState(), diff = Object.keys(s).filter(k => JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || [])));
  ok_('   ...ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
  diff.forEach(k => console.log('         ' + k + '\n           gas=' + JSON.stringify(comparable(k, s[k])).slice(-600) + '\n          host=' + JSON.stringify(comparable(k, db[k] || [])).slice(-600)));
  const lw = JSON.stringify(w.line), lh = JSON.stringify(hostPushes(h.line));
  ok_('   ...LINE เท่ากัน (' + w.line.length + ')' + (lw === lh ? '' : '\n         gas=' + lw.slice(0, 400) + '\n        host=' + lh.slice(0, 400)), lw === lh);
  return { gas: w, host: h };
}
const go = (sid, type, extra) => Object.assign({ parentId: 'PAR-' + sid.slice(-2), studentId: sid, type, lat: LAT, lng: LNG, acc: 10 }, extra || {});
const ot = sid => db.OT_DAILY.filter(r => r.StudentID === sid).slice(-1)[0] || {};
const rows = sid => db.CHECKIN_STUDENT.filter(r => r.StudentID === sid);
const audits = act => (db.AUDIT_LOG || []).filter(r => r.Action === act);

console.log('\n1) วันอังคาร 10/11/2026 — มาส่ง (ที่ไหนก็ได้) · กดซ้ำ · คุณครูได้รับแจ้ง');
at('2026-11-10', '07:40');
let r = step(go('S01', 'IN'), 'แม่น้องเอ มาส่ง 07:40');
eq('บันทึก 1 แถว เวลา 07:40', [rows('S01').length, rows('S01')[0].Time, rows('S01')[0].Type, rows('S01')[0].Status], [1, '07:40', 'IN', 'OK']);
eq('...แจ้งครูประจำชั้น (มี LINE) · กระดิ่งครูทั้งห้อง · ไม่แจ้งครูห้องอื่น', [r.host.line.map(p => p.to), db.ADMIN_INBOX.filter(x => x.StaffID).map(x => x.StaffID).sort()], [['Uteacher000001'], ['STF-HD', 'STF-K', 'STF-T']]);
at('2026-11-10', '07:46');
r = step(go('S01', 'IN'), '🔴 กดซ้ำภายใน 10 นาที');
eq('🔴 ...แถวเดิมเลื่อนเวลา ไม่มีแถวใหม่ ไม่แจ้งซ้ำ', [r.host.data.duplicate, rows('S01').length, rows('S01')[0].Time, r.host.line.length], [true, 1, '07:46', 0]);
r = step(go('S02', 'IN', { lat: LAT + 0.05, lng: LNG }), 'มาส่งจากที่ไกล ~5.5 กม. (ส่งจากบ้าน)');
eq('...ผ่าน และบันทึกระยะ', [r.host.ok, r.host.data && r.host.data.distance > 5000], [true, true]);
r = step(go('S03', 'IN', { lat: undefined, lng: undefined }), 'มาส่งโดยไม่มีพิกัด');
eq('...ผ่าน ระยะเป็น null', [r.host.ok, r.host.data && r.host.data.distance], [true, null]);

console.log('\n2) 🔴 ด่านก่อนลงเวลา');
r = step(go('S06', 'IN'), 'ยังไม่ถึงวันแรกของการเรียน');
eq('...NOT_STARTED', [r.host.code, r.host.ops], ['NOT_STARTED', 0]);
r = step(go('S07', 'IN'), 'เลยวันสุดท้ายแล้ว');
eq('...STUDENT_ENDED', r.host.code, 'STUDENT_ENDED');
r = step(go('S08', 'IN'), 'วันอังคารเป็นวันหยุดประจำของเด็ก');
eq('...STUDENT_DAY_OFF', r.host.code, 'STUDENT_DAY_OFF');
r = step(go('S01', 'IN', { parentId: 'PAR-99' }), 'ไม่มีผู้ปกครองคนนี้');
eq('...PARENT_NOT_FOUND', r.host.code, 'PARENT_NOT_FOUND');
r = step(go('S01', 'XX'), 'ชนิดผิด');
eq('...BAD_TYPE', r.host.code, 'BAD_TYPE');
r = step(go('S01', 'IN', { studentId: '' }), 'ไม่ระบุเด็ก');
eq('...BAD_INPUT', r.host.code, 'BAD_INPUT');

console.log('\n3) 💰 รับกลับ: รั้ว GPS · ช่วงผ่อนผัน · ปัดชั่วโมงขึ้น');
at('2026-11-10', '17:15');
r = step(go('S01', 'OUT', { lat: LAT + 0.01 }), '🔴 รับกลับจากที่ห่าง ~1.1 กม.');
eq('🔴 ...OUT_OF_RANGE ไม่บันทึกการรับกลับ · ไม่แจ้งใคร · แต่เก็บ audit 1 แถว (ระยะเป็นเมตร ไม่มีพิกัด) เหมือน Apps Script',
  [r.host.code, rows('S01').length, r.host.line.length, r.host.kept, audits('STUDENT_CHECKOUT_OUT_OF_RANGE').map(x => x.RecordID)], ['OUT_OF_RANGE', 1, 0, 1, ['S01 · 1112m acc=10m']]);
r = step(go('S07', 'IN'), '🔴 การปฏิเสธที่ไม่ได้เขียน audit');
eq('🔴 ...STUDENT_ENDED · ไม่มีอะไรถูกเก็บ', [r.host.code, r.host.kept], ['STUDENT_ENDED', 0]);
r = step(go('S05', 'OUT', { lat: LAT + 0.01 }), 'เด็กที่ได้รับยกเว้นรั้ว รับจากที่ห่าง ~1.1 กม.');
eq('...ผ่าน + audit GEO_EXEMPT', [r.host.ok, audits('STUDENT_CHECKOUT_GEO_EXEMPT').length], [true, 1]);
r = step(go('S01', 'OUT'), 'น้องเอ รับ 17:15 (เลิก 17:00 · ผ่อนผัน 21)');
eq('💰 15 นาที ไม่เกินผ่อนผัน → ไม่มีค่ารับช้า', [r.host.data.ot, ot('S01').OTID], [null, undefined]);
at('2026-11-10', '17:22');
r = step(go('S04', 'OUT'), 'น้องดี (อัตรา 150) รับ 17:22');
eq('💰 22 นาที → 1 ชม. × 150 = 150', [ot('S04').LateMinutes, ot('S04').Hours, ot('S04').FullAmount, ot('S04').Amount, ot('S04').Status, ot('S04').OTID], [22, 1, 150, 150, 'UNPAID', 'OT-20261110-S04']);
eq('...ผู้ปกครองได้ LINE ยอดเงิน + ครูได้แจ้งรับกลับ', r.host.line.map(p => p.to), ['Uteacher000001', 'Uparent00000S04']);
ok_('...ข้อความบอก 1 ชม. × 150 = 150 บาท', /1 ชม\. × 150 = 150 บาท/.test(r.host.line[1].messages[0].text));
at('2026-11-10', '18:05');
r = step(go('S02', 'OUT'), 'น้องบี (เลิก 18:00 ของตัวเอง) รับ 18:05');
eq('💰 วัดจาก 18:00 ไม่ใช่ 17:00 → ไม่มีค่า', r.host.data.ot, null);
r = step(go('S03', 'OUT'), 'น้องซี (รับได้ถึง 18:00 โดยไม่คิด) รับ 18:05');
eq('💰 วัดจาก 18:00 → ไม่มีค่า', r.host.data.ot, null);
at('2026-11-10', '19:01');
r = step(go('S09', 'OUT'), 'น้องไอ (ครึ่งวัน เลิก 12:00 · แม่ไม่มี LINE) รับ 19:01');
eq('💰 421 นาที → 8 ชม. × 100 = 800 · กระดิ่งครอบครัว ไม่มี LINE ผู้ปกครอง', [ot('S09').Hours, ot('S09').Amount, r.host.line.map(p => p.to), db.ADMIN_INBOX.filter(x => x.StudentID === 'S09').length], [8, 800, ['Uteacher000001'], 1]);

console.log('\n4) 💰 แถวค่ารับช้าที่มีประวัติ: ส่วนลด · แอดมินยกเลิก · จ่ายแล้ว');
r = step(go('S10', 'OUT'), 'น้องเจ (มีส่วนลด 100) รับใหม่ 19:01');
eq('💰 คิดใหม่ 3 ชม. = 300 · ส่วนลด 100 ยังอยู่ → เรียกเก็บ 200', [ot('S10').FullAmount, ot('S10').Discount, ot('S10').Amount, ot('S10').DiscountReason], [300, 100, 200, 'ผอ.ลดให้']);
r = step(go('S11', 'OUT'), 'น้องเค (แอดมินยกเลิกไว้) รับ 19:01');
eq('💰 การยกเลิกของแอดมินคงอยู่ · ไม่มีค่า · ไม่แจ้งเงิน', [ot('S11').Status, ot('S11').Amount, r.host.data.ot], ['CANCELLED', 200, null]);
r = step(go('S12', 'OUT'), 'น้องแอล (จ่ายแล้ว 100) รับ 19:01');
eq('💰 เงินที่รับแล้วไม่ถูกคิดใหม่', [ot('S12').Status, ot('S12').Amount, ot('S12').PickupTime, r.host.data.ot], ['PAID', 100, '17:40', null]);

console.log('\n5) 💰 แก้เวลา: กดรับซ้ำภายใน 10 นาทีเลื่อนเวลา · กดใหม่หลังจากนั้นคิดใหม่');
at('2026-11-10', '19:05');
r = step(go('S09', 'OUT'), 'น้องไอ กดซ้ำ 19:05');
eq('...แถวเดิมเลื่อน ไม่มีค่าใหม่ (ซ้ำ ไม่คิดเงินซ้ำ)', [r.host.data.duplicate, rows('S09').length, ot('S09').Amount], [true, 1, 800]);
at('2026-11-10', '20:05');
r = step(go('S09', 'OUT'), 'น้องไอ กดรับอีกครั้ง 20:05 (พ้น 10 นาทีแล้ว)');
eq('💰 แถวค่ารับช้าเดิมถูกคิดใหม่ 485 นาที → 9 ชม. = 900 (ไม่มีแถวที่สอง)', [db.OT_DAILY.filter(x => x.StudentID === 'S09').length, ot('S09').LateMinutes, ot('S09').Amount, ot('S09').PickupTime], [1, 485, 900, '20:05']);

console.log('\n6) วันพุธ 11/11 หยุด — มาได้เฉพาะเด็กที่มีชื่อ · ปิดรับค่า OT ช่วงหนึ่ง');
at('2026-11-11', '08:00');
r = step(go('S02', 'IN'), '🔴 วันหยุด เด็กที่ไม่มีชื่อ');
eq('🔴 ...SCHOOL_CLOSED', [r.host.code, r.host.ops], ['SCHOOL_CLOSED', 0]);
r = step(go('S01', 'IN'), 'วันหยุด เด็กที่มีชื่อ (HOLIDAY_ATTEND)');
eq('...ผ่าน', r.host.ok, true);
setCfg('OTWaiveDays', JSON.stringify([{ from: '2026-11-11', to: '2026-11-11', reason: 'ฝนตกหนัก' }]));
at('2026-11-11', '18:30');
r = step(go('S01', 'OUT'), 'วันงดคิด OT รับ 18:30');
eq('💰 งดคิด → ไม่มีแถว · ไม่แจ้ง', [r.host.data.ot, ot('S01').OTID], [null, undefined]);
setCfg('OTWaiveDays', '');

console.log('\n7) 💰 ปิดแจ้ง LINE ค่ารับช้า: กระดิ่งยังขึ้น LINE ไม่ส่ง · ปิดแจ้งครู');
setCfg('NotifyParentOt', 'app'); setCfg('NotifyStaffArrival', 'app');
at('2026-11-12', '08:00'); step(go('S01', 'IN'), 'วันพฤหัส มาส่ง');
at('2026-11-12', '18:30');
r = step(go('S01', 'OUT'), 'รับ 18:30');
eq('💰 2 ชม. = 200 · ไม่มี LINE เลย · กระดิ่งครอบครัว 1', [ot('S01').Amount, r.host.line.length, db.ADMIN_INBOX.filter(x => x.StudentID === 'S01').length], [200, 0, 1]);

console.log('\n9) ครูบันทึกรับ-ส่งแทน (staffStudentCheckin) — วันศุกร์ 13/11');
const by = (staffId, sid, type, extra) => Object.assign({ staffId, studentId: sid, type, remark: 'คุณยายมารับ-ส่ง' }, extra || {});
const sst = (p, label) => step(p, label, 'staffStudentCheckin', 'handleStaffStudentCheckin');
at('2026-11-13', '08:30');
r = sst(by('STF-T', 'S01', 'IN', { remark: '  ' }), '🔴 ไม่มีหมายเหตุ');
eq('🔴 ...REMARK_REQUIRED', [r.host.code, r.host.ops], ['REMARK_REQUIRED', 0]);
r = sst(by('STF-Z', 'S01', 'IN'), '🔴 ครูห้องอื่น');
eq('🔴 ...NO_ACCESS (ไม่บอกชื่อเด็ก)', [r.host.code, /เอ/.test(r.host.msg)], ['NO_ACCESS', false]);
r = sst(by('STF-T', 'S04', 'IN'), '🔴 เด็กที่แจ้งลาวันนี้');
eq('🔴 ...ON_LEAVE', r.host.code, 'ON_LEAVE');
r = sst(by('STF-T', 'S01', 'IN', { time: '07:50' }), 'ครูบันทึกมาส่ง 07:50 (กดตอน 08:30)');
{ const x = rows('S01').slice(-1)[0];
  eq('...Time = เวลาจริง 07:50 · ByAt = เวลาที่กด 08:30 · ByStaffID · ParentID ของเด็ก', [x.Time, x.ByAt, x.ByStaffID, x.ParentID, x.Remark], ['07:50', '08:30', 'STF-T', 'PAR-01', 'คุณยายมารับ-ส่ง']); }
eq('...แจ้งผู้ปกครอง (กระดิ่ง + LINE)', r.host.line.map(p => p.to), ['Uparent00000S01']);
at('2026-11-13', '17:30');
r = sst(by('STF-T', 'S01', 'OUT', { time: '17:45' }), 'ครูบันทึกรับกลับ 17:45');
eq('💰 45 นาที → 1 ชม. = 100 (คิดจากเวลาที่พิมพ์ ไม่ใช่เวลาที่กด)', [ot('S01').OTID, ot('S01').PickupTime, ot('S01').Amount], ['OT-20261113-S01', '17:45', 100]);
ok_('...ข้อความผู้ปกครองบอกค่ารับช้า', /รับช้า 45 นาที · ค่าล่วงเวลา 100 บาท/.test(r.host.line[0].messages[0].text));
r = sst(by('STF-T', 'S01', 'OUT', { time: '16:50' }), '💰 แก้เวลาเป็น 16:50 (กดผิด)');
eq('💰 แถวเดิมถูกแก้ · ค่ารับช้ายกเลิกอัตโนมัติ (AUTO_TIME) · ยังมีแถวรับกลับเดียวของวันนั้น', [rows('S01').filter(x => x.Type === 'OUT' && x.Date === '2026-11-13').length, ot('S01').Status, ot('S01').Amount, ot('S01').CancelledBy], [1, 'CANCELLED', 0, 'AUTO_TIME']);
r = sst(by('STF-T', 'S01', 'OUT', { time: '18:30' }), '💰 แก้อีกครั้งเป็น 18:30');
eq('💰 ค่ารับช้ากลับมา: UNPAID 2 ชม. = 200', [ot('S01').Status, ot('S01').Amount, ot('S01').CancelledBy], ['UNPAID', 200, '']);
at('2026-11-13', '18:40');
r = sst(by('STF-HD', 'S02', 'OUT'), 'หัวหน้าครู (ทุกห้อง) บันทึกรับน้องบี ไม่ใส่เวลา (= 18:40)');
eq('💰 วัดจาก 18:00 ของน้องบี → 40 นาที → 1 ชม. = 100', [ot('S02').PickupTime, ot('S02').LateMinutes, ot('S02').Amount], ['18:40', 40, 100]);
at('2026-11-14', '09:00');
r = sst(by('STF-T', 'S11', 'IN'), '🔴 วันเสาร์');
eq('🔴 ...SCHOOL_CLOSED', r.host.code, 'SCHOOL_CLOSED');

console.log('\n10) 🔴 ปุ่มของผู้ปกครองเป็นของผู้ปกครอง (applyIdentity_ — ประตูเดียวกันทั้ง Apps Script และโฮสต์)');
{
  const GATE = require(path.join(__dirname, '..', 'server', 'gate.js'));
  const who = (role, linkedId) => { try { const p = GATE.identity('parentCheckin', { parentId: 'PAR-01', studentId: 'S01', type: 'IN' }, { uid: 'U-' + linkedId, role, linkedId }, {}); return 'ok:' + (p.parentId || ''); }
    catch (e) { return e.apiCode || e.message; } };
  eq('🔴 ครูส่ง parentId ของครอบครัวอื่น → NO_PERMISSION', who('Teacher', 'STF-T'), 'NO_PERMISSION');
  eq('🔴 หัวหน้าครู → NO_PERMISSION', who('Leader', 'STF-HD'), 'NO_PERMISSION');
  eq('แอดมิน (ดูมุมมองผู้ปกครอง) → ผ่านเหมือนเดิม', who('Admin', 'STF-A'), 'ok:PAR-01');
  ok_('ผู้ปกครอง → ผ่าน และ parentId มาจากเซสชันเสมอ (ไม่ใช่ที่ส่งมา)', /^(ok:PAR-02|NO_ACCESS)$/.test(who('Parent', 'PAR-02')));
}

console.log('\n11) 🔴 กล่องทราย');
{
  ok_('parentCheckin มีสิทธิ์ส่ง LINE', ROUTES.sendsLine('parentCheckin'));
  const saved = ROUTES.PORTED.parentCheckin.appends; ROUTES.PORTED.parentCheckin.appends = ['CHECKIN_STUDENT', 'ADMIN_INBOX'];
  at('2026-11-13', '19:30'); const keep = JSON.stringify(db); const h = host('parentCheckin', go('S04', 'OUT'));
  ROUTES.PORTED.parentCheckin.appends = saved;
  ok_('🔴 ถ้าไม่ได้ประกาศ OT_DAILY → NOT_ON_FAST_HOST · การรับกลับก็ไม่ถูกบันทึก · ไม่มี LINE', !h.ok && h.code === 'NOT_ON_FAST_HOST' && JSON.stringify(db) === keep && h.line.length === 0);
}
ROUTES.setClock(null);
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
