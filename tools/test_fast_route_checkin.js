/**
 * tools/test_fast_route_checkin.js — W3: staff clock-in / clock-out on the fast host, baht for baht
 *   node tools/test_fast_route_checkin.js
 *
 * 💰 These two routes decide LateMinutes (เบี้ยขยัน) and staff OT (hours × rate → OT_RECORDS). Both are
 * functions of "now", so BOTH sides stand at the same fixed minute (ROUTES.setClock on the host, the same
 * fake Date inside the Apps Script harness) and every step is compared three ways, as W1/W2 are:
 *   the reply · every row of every sheet the route can touch · every LINE message (recipient, text, order)
 * The days are real ones from November 2026: an ordinary Tuesday, a whole-day holiday, a half-day holiday
 * that reopens at noon, a Big Cleaning Saturday, and a Sunday opened for one person by OT วันหยุด.
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
  'GasEngine', 'Engine', 'Payroll', 'Day6', 'OtStaff', 'OT', 'AttReq', 'Password', 'PaySlips', 'Certificate', 'Dspm', 'DspmAdmin', 'Journal', 'Announce', 'Demo']);

const SHEETS = [['MAIN', 'SCHOOL_CONFIG'], ['HR', 'STAFF'], ['HR', 'STAFF_GROUPS'], ['HR', 'WORK_SCHEDULE'], ['MAIN', 'HOLIDAYS'], ['HR', 'OT_RECORDS'],
  ['HR', 'CHECKIN_STAFF'], ['HR', 'ATTENDANCE_REQUEST'], ['MAIN', 'ADMIN_INBOX'], ['MAIN', 'USERS'], ['MAIN', 'LINE_RECIPIENTS'], ['MAIN', 'AUDIT_LOG'], ['HR', 'AUDIT_LOG']];
const LAT = 13.7563, LNG = 100.5018;
const st = (id, name, extra) => Object.assign({ StaffID: id, Name: name, Role: 'Teacher', PositionLevel: 'Teacher', Department: 'N1', Status: 'ACTIVE', StartDate: '2025-01-01', BaseSalary: 24000 }, extra || {});
const FIX = {
  SCHOOL_CONFIG: [['Timezone', 'Asia/Bangkok'], ['GPS_Lat', String(LAT)], ['GPS_Lng', String(LNG)], ['Radius', '30'], ['LateGraceMinutes', '5'],
    ['DefaultCheckInTime', '08:00'], ['DefaultCheckOutTime', '17:00'], ['StaffOTHourlyRate', '100'], ['OTRoundUpMinutes', '50'], ['EarlyLeaveMinutes', '30'],
    ['BigCleaningDays', '2026-11-14'], ['BigCleaningIn', '08:30'], ['BigCleaningOut', '17:00'], ['HolidayReopenWindowMinutes', '15'],
    ['LineChannelAccessToken', 'test-token-not-real'], ['NotifyAdminApproval', 'app']],
  STAFF: [st('STF-T', 'ครูที', { StaffGroup: 'G1' }), st('STF-U', 'ครูยู'), st('STF-W', 'ครูดับเบิลยู'),
    st('STF-L', 'หัวหน้าแอล', { PositionLevel: 'Leader' }), st('STF-N', 'ครูใหม่', { StartDate: '2026-12-01' }),
    st('STF-P', 'ครูพัก', { PauseFrom: '2026-11-01', PauseTo: '2026-11-20' }), st('STF-H', 'ครูวันหยุด'), st('STF-E', 'ครูลาออก', { EndDate: '2026-10-31' }), st('STF-A', 'แอดมินเอ', { Role: 'Admin', PositionLevel: 'Admin' })],
  STAFF_GROUPS: [{ GroupName: 'G1', GroupNameEN: 'G1', CheckInTime: '07:30', CheckOutTime: '16:30' }],
  WORK_SCHEDULE: [{ StaffID: 'STF-W', DayOfWeek: 'Tuesday', CheckInTime: '09:00', CheckOutTime: '18:00', EffectiveDate: '2026-01-01' }],
  HOLIDAYS: [{ Date: '2026-11-11', NameTH: 'วันหยุดทั้งวัน' }, { Date: '2026-11-12', NameTH: 'ประชุมผู้ปกครอง', StartTime: '08:00', EndTime: '12:00' }],
  OT_RECORDS: [{ OTRecordID: 'OTR-0001', StaffID: 'STF-H', Date: '2026-11-15', Hours: 0, Rate: 0, Amount: 800, Status: 'APPROVED', Kind: 'HOLIDAY', Month: '2026-11', Note: 'เหมาจ่าย' }],
  CHECKIN_STAFF: [], ATTENDANCE_REQUEST: [], ADMIN_INBOX: [], USERS: [],
  LINE_RECIPIENTS: [{ Name: 'ผอ.', LineUID: 'Udirector000004', Topics: 'approval', Active: 'YES', Note: '' }]
};
G.g.__FIX = JSON.stringify(FIX); G.g.__SHEETS = JSON.stringify(SHEETS);
G.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var F = JSON.parse(__FIX), main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  JSON.parse(__SHEETS).forEach(function (x) {
    var sh = sheet_(x[0] === 'HR' ? hr : main, x[1]);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    (F[x[1]] || []).forEach(function (r) { appendObject_(sh, x[1] === 'SCHOOL_CONFIG' ? { Key: r[0], Value: r[1] } : r); });
  });
  _configCache = null; return '';
});
const keyOf = x => (x[0] === 'HR' && x[1] === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : x[1];
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
  catch (e) { return { ok: false, code: e.apiCode || e.message, msg: e.message, ops: 0, line: line.out }; }
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
/* 🕐 both sides stand at this minute of the school's day */
G.g.__FAKE = ROUTES.FAKE_DATE;
const at = (ymd, hm) => { const ms = Date.parse(ymd + 'T' + hm + ':00+07:00'); ROUTES.setClock(ms); G.g.__MS = ms;
  G.run(function () { if (typeof __RD === 'undefined') __RD = Date; Date = __RD; eval(__FAKE)(__MS); return ''; }); };

const comparable = (name, rows) => rows.map(r => { const o = Object.assign({}, r); delete o.__id;
  if (name === 'ADMIN_INBOX') o.InboxID = /^IN-\d+(-\d+)+$/.test(o.InboxID) ? 'IN-…' : o.InboxID;
  return o; });
const hostPushes = list => list.map(p => (p.messages.length === 1 && p.messages[0].type === 'text') ? { to: p.to, text: p.messages[0].text } : { to: p.to, bad: p.messages });
function step(a, fn, p, label) {
  const w = gas(fn, p), h = host(a, p);
  const rw = JSON.stringify(w.ok ? { ok: true, data: w.data } : { ok: false, code: w.code, msg: w.msg });
  const rh = JSON.stringify(h.ok ? { ok: true, data: h.data } : { ok: false, code: h.code, msg: h.msg });
  ok_(label + ' — คำตอบเท่ากัน' + (rw === rh ? '' : '\n         gas=' + rw.slice(0, 400) + '\n        host=' + rh.slice(0, 400)), rw === rh);
  const s = gasState(), diff = Object.keys(s).filter(k => JSON.stringify(comparable(k, s[k])) !== JSON.stringify(comparable(k, db[k] || [])));
  ok_('   ...ทุกชีตเท่ากันทุกแถว' + (diff.length ? '  ต่างที่: ' + diff.join(', ') : ''), !diff.length);
  diff.forEach(k => console.log('         ' + k + '\n           gas=' + JSON.stringify(comparable(k, s[k])).slice(-500) + '\n          host=' + JSON.stringify(comparable(k, db[k] || [])).slice(-500)));
  ok_('   ...LINE เท่ากัน (' + w.line.length + ')', JSON.stringify(hostPushes(h.line)) === JSON.stringify(w.line));
  return { gas: w, host: h };
}
const IN = 'staffCheckin', INF = 'handleStaffCheckin', OUT = 'staffCheckout', OUTF = 'handleStaffCheckout';
const here = (id, extra) => Object.assign({ staffId: id, lat: LAT, lng: LNG, acc: 10 }, extra || {});
const ci = id => db.CHECKIN_STAFF.filter(r => r.StaffID === id).slice(-1)[0] || {};
const otOf = id => db.OT_RECORDS.filter(r => r.StaffID === id).slice(-1)[0] || {};

console.log('\n1) วันอังคารปกติ 10/11/2026 — เข้างาน: กะของกลุ่ม · ค่าเริ่มต้น · ตารางรายวัน');
at('2026-11-10', '07:25');
let r = step(IN, INF, here('STF-T'), 'ครูกลุ่ม G1 (07:30) มา 07:25');
eq('💰 ไม่สาย', [r.host.data.lateMinutes, ci('STF-T').LateMinutes, ci('STF-T').CheckIn, ci('STF-T').Status], [0, 0, '07:25', 'IN']);
r = step(IN, INF, here('STF-T'), '🔴 กดซ้ำ');
eq('🔴 ...ALREADY_CHECKED_IN ไม่มีแถวเพิ่ม', [r.host.code, r.host.ops, db.CHECKIN_STAFF.length], ['ALREADY_CHECKED_IN', 0, 1]);
at('2026-11-10', '08:00');
step(IN, INF, here('STF-L'), 'หัวหน้ามา 08:00');
at('2026-11-10', '08:20');
r = step(IN, INF, here('STF-U'), 'ครูไม่มีกลุ่ม (ค่าเริ่มต้น 08:00 · ผ่อนผัน 5) มา 08:20');
eq('💰 สาย 15 นาที', [r.host.data.lateMinutes, ci('STF-U').LateMinutes], [15, 15]);
at('2026-11-10', '09:04');
r = step(IN, INF, here('STF-W'), 'ครูมีตารางวันอังคาร 09:00 มา 09:04');
eq('💰 อยู่ในช่วงผ่อนผัน = ไม่สาย', r.host.data.lateMinutes, 0);

console.log('\n2) 🔴 ด่านก่อนลงเวลา');
r = step(IN, INF, { staffId: 'STF-N', lat: LAT, lng: LNG }, 'ครูที่ยังไม่ถึงวันเริ่มงาน');
eq('...NOT_STARTED', r.host.code, 'NOT_STARTED');
r = step(IN, INF, here('STF-P'), 'ครูที่ลาชั่วคราว');
eq('...STAFF_PAUSED', r.host.code, 'STAFF_PAUSED');
r = step(IN, INF, here('STF-E'), 'ครูที่สิ้นสุดการทำงานแล้ว');
eq('...ENDED', r.host.code, 'ENDED');
r = step(IN, INF, here('STF-X'), 'ไม่มีพนักงานคนนี้');
eq('...STAFF_NOT_FOUND', r.host.code, 'STAFF_NOT_FOUND');
r = step(IN, INF, { staffId: 'STF-H' }, 'ไม่มีพิกัด');
eq('...BAD_GPS', r.host.code, 'BAD_GPS');
r = step(IN, INF, { staffId: 'STF-H', lat: LAT + 0.01, lng: LNG, acc: 10 }, '🔴 อยู่ห่างโรงเรียน ~1.1 กม.');
eq('🔴 ...OUT_OF_RANGE ไม่บันทึก (ข้อความบอกระยะเท่ากันทั้งสองฝั่ง)', [r.host.code, r.host.ops, r.host.msg === r.gas.msg], ['OUT_OF_RANGE', 0, true]);
r = step(IN, INF, { staffId: 'STF-H', lat: LAT + 0.0006, lng: LNG, acc: 2000 }, 'ห่าง ~67 ม. เครื่องแจ้งคลาดเคลื่อน 2 กม. (เผื่อได้สูงสุด 50)');
eq('...ผ่าน (67 − 50 ≤ 30) และบันทึกระยะจริง', [r.host.ok, r.host.data && r.host.data.distance === r.gas.data.distance], [true, true]);
setCfg('GPS_Lat', '');
r = step(OUT, OUTF, here('STF-T'), '🔴 โรงเรียนยังไม่ตั้งพิกัด');
eq('🔴 ...NO_SCHOOL_GPS (รั้วที่ไม่มีจุดศูนย์กลางต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน)', [r.host.code, r.host.ops], ['NO_SCHOOL_GPS', 0]);
setCfg('GPS_Lat', String(LAT));

console.log('\n3) วันอังคาร — ออกงาน: กลับก่อน · OT เต็มชั่วโมง · ปัดขึ้นที่ 50 นาที');
at('2026-11-10', '16:00');
r = step(OUT, OUTF, here('STF-T'), 'ครู G1 (เลิก 16:30) ออก 16:00');
eq('ออกก่อน 30 นาที → เสนอใบลา · ไม่มี OT', [r.host.data.early, r.host.data.earlyMinutes, r.host.data.otHours, r.host.data.planOut, ci('STF-T').Status], [true, 30, 0, '16:30', 'OUT']);
r = step(OUT, OUTF, here('STF-T'), '🔴 ออกซ้ำ');
eq('🔴 ...ALREADY_CHECKED_OUT', r.host.code, 'ALREADY_CHECKED_OUT');
r = step(OUT, OUTF, here('STF-N', { staffId: 'STF-E' }), '🔴 คนที่ลงเวลาไม่ได้ ออกงานไม่ได้เช่นกัน');
at('2026-11-10', '18:45');
r = step(OUT, OUTF, here('STF-W'), 'ครูตารางเลิก 18:00 ออก 18:45');
eq('💰 45 นาที ไม่ถึงเกณฑ์ปัด → OT 0 · ไม่มีแถว OT · ไม่แจ้งแอดมิน', [r.host.data.otHours, r.host.data.otPay, db.OT_RECORDS.length, r.host.line.length], [0, 0, 1, 0]);
at('2026-11-10', '18:53');
r = step(OUT, OUTF, here('STF-U'), 'ครูเลิก 17:00 ออก 18:53');
eq('💰 113 นาที → 2 ชม. × 100 = 200 บาท · เข้าคิวหัวหน้า', [r.host.data.otHours, r.host.data.otMinutes, r.host.data.otPay, otOf('STF-U').Amount, otOf('STF-U').Rate, otOf('STF-U').Status, otOf('STF-U').Step1Status, otOf('STF-U').PlanOut, otOf('STF-U').ActualOut, otOf('STF-U').Month],
  [2, 113, 200, 200, 100, 'PENDING_LEADER', 'Pending', '17:00', '18:53', '2026-11']);
eq('...แจ้งแอดมิน: LINE ถึงคนในรายชื่อ + กระดิ่ง', [r.host.line.map(p => p.to), db.ADMIN_INBOX.length], [['Udirector000004'], 1]);
ok_('...ข้อความบอกชั่วโมงและจำนวนเงิน', /OT 2 ชม\./.test(r.host.line[0].messages[0].text) && /200 บาท/.test(r.host.line[0].messages[0].text));
at('2026-11-10', '19:00');
r = step(OUT, OUTF, here('STF-L'), 'หัวหน้าออก 19:00');
eq('💰 2 ชม. · OT ของหัวหน้าข้ามขั้นแรก', [r.host.data.otHours, otOf('STF-L').Status, otOf('STF-L').Step1Status], [2, 'PENDING_ADMIN', 'Skipped']);
r = step(OUT, OUTF, here('STF-H'), 'ครูที่เข้างานแล้ว ออก 19:00');
r = step(OUT, OUTF, here('STF-P'), '🔴 ไม่ได้เข้างาน/ลาชั่วคราว');

console.log('\n4) วันพุธ 11/11 หยุดทั้งวัน · วันพฤหัส 12/11 หยุดครึ่งเช้า (เปิด 12:00)');
at('2026-11-11', '08:00');
r = step(IN, INF, here('STF-T'), '🔴 วันหยุดทั้งวัน');
eq('🔴 ...SCHOOL_CLOSED', [r.host.code, r.host.ops], ['SCHOOL_CLOSED', 0]);
at('2026-11-12', '09:00');
r = step(IN, INF, here('STF-T'), '🔴 ช่วงที่โรงเรียนยังปิด');
eq('🔴 ...SCHOOL_CLOSED', r.host.code, 'SCHOOL_CLOSED');
at('2026-11-12', '11:50');
r = step(IN, INF, here('STF-U'), 'มารอก่อนเปิด 10 นาที (เปิดให้ลงเวลาก่อน 15 นาที)');
eq('💰 ลงเวลาได้ ไม่สาย', [r.host.ok, r.host.data && r.host.data.lateMinutes], [true, 0]);
at('2026-11-12', '12:20');
r = step(IN, INF, here('STF-L'), 'กะ 08:00 มา 12:20 (เปิด 12:00 · ผ่อนผัน 15)');
eq('💰 สาย 5 นาที — ไม่ใช่ 255 นาทีจากกะ 08:00', r.host.data && r.host.data.lateMinutes, 5);
/* the school's rule as written (atomStaffHours_): the window moves the start only when it COVERS the start.
 * G1 begins 07:30, before this 08:00 closure — so that shift still began at 07:30. Pinned, not judged. */
r = step(IN, INF, here('STF-T'), 'กะ 07:30 (เริ่มก่อนช่วงปิด 08:00) มา 12:20');
eq('💰 ...วัดจากกะของตัวเอง: 12:20 − 07:30 − ผ่อนผัน 5 = 285', r.host.data && r.host.data.lateMinutes, 285);
at('2026-11-12', '17:00');
r = step(OUT, OUTF, here('STF-T'), 'ออก 17:00 — OT นับจากเวลาเลิกของกะตัวเอง (16:30)');
eq('💰 30 นาที → OT 0', [r.host.data.otHours, r.host.data.planOut], [0, '16:30']);

console.log('\n5) วันเสาร์ 14/11 Big Cleaning (08:30–17:00) · วันอาทิตย์ 15/11 OT วันหยุดเฉพาะคน');
at('2026-11-14', '08:40');
r = step(IN, INF, here('STF-T'), 'Big Cleaning มา 08:40');
eq('💰 วัดจาก 08:30 + ผ่อนผัน 5 → สาย 5', r.host.data && r.host.data.lateMinutes, 5);
at('2026-11-14', '18:00');
r = step(OUT, OUTF, here('STF-T'), 'Big Cleaning ออก 18:00');
eq('💰 OT 1 ชม. จาก 17:00 ของวันนั้น (ไม่ใช่ 16:30 ของกะ)', [r.host.data.otHours, otOf('STF-T').PlanOut, otOf('STF-T').Amount], [1, '17:00', 100]);
at('2026-11-15', '09:30');
r = step(IN, INF, here('STF-T'), '🔴 วันอาทิตย์ คนทั่วไป');
eq('🔴 ...SCHOOL_CLOSED', r.host.code, 'SCHOOL_CLOSED');
r = step(IN, INF, here('STF-H'), 'คนที่ได้ OT วันหยุด');
eq('💰 ลงเวลาได้ · ไม่มีสาย (เหมาจ่าย)', [r.host.ok, r.host.data && r.host.data.lateMinutes], [true, 0]);
at('2026-11-15', '20:00');
const otBefore = db.OT_RECORDS.length;
r = step(OUT, OUTF, here('STF-H'), 'คนที่ได้ OT วันหยุด ออก 20:00');
eq('💰 ไม่มี OT รายชั่วโมงซ้อนเหมาจ่าย · ไม่มีแถว OT ใหม่ · ไม่แจ้ง', [r.host.data.otHours, r.host.data.otPay, db.OT_RECORDS.length - otBefore, r.host.line.length], [0, 0, 0, 0]);

console.log('\n6) 💰 อัตรา OT: ค่าที่โรงเรียนตั้ง · auto (เงินเดือน ÷ 30 ÷ 8 × 1.5) · เกณฑ์ปัดที่เปลี่ยน');
setCfg('StaffOTHourlyRate', 'auto'); setCfg('OTRoundUpMinutes', '30');
at('2026-11-16', '08:00'); step(IN, INF, here('STF-U'), 'วันจันทร์ เข้า 08:00');
at('2026-11-16', '18:35');
r = step(OUT, OUTF, here('STF-U'), 'ออก 18:35 (อัตรา auto · ปัดที่ 30)');
eq('💰 95 นาที → 2 ชม. × 150 = 300', [r.host.data.otHours, r.host.data.otPay, otOf('STF-U').Rate, otOf('STF-U').Amount], [2, 300, 150, 300]);
setCfg('StaffOTHourlyRate', '120'); setCfg('OTRoundUpMinutes', '50');
at('2026-11-16', '08:10'); step(IN, INF, here('STF-W'), 'วันจันทร์ (ไม่มีตาราง → ค่าเริ่มต้น) เข้า 08:10');
at('2026-11-16', '20:10');
r = step(OUT, OUTF, here('STF-W'), 'ออก 20:10 (อัตรา 120)');
eq('💰 190 นาที → 3 ชม. × 120 = 360 · รหัส OT ต่อจากเลขสูงสุด', [r.host.data.otHours, r.host.data.otPay, otOf('STF-W').OTRecordID === gasState().OT_RECORDS.slice(-1)[0].OTRecordID, /^OTR-\d{4}$/.test(otOf('STF-W').OTRecordID)], [3, 360, true, true]);

console.log('\n7) 💰 อนุมัติ OT: หัวหน้า (ขั้น 1) → แอดมิน (ขั้น 2) · คิดราคาใหม่ตอนอนุมัติ · เหมาจ่ายไม่ถูกคิดใหม่');
const otId = (sid, d) => (db.OT_RECORDS.find(x => x.StaffID === sid && String(x.Date).slice(0, 10) === d) || {}).OTRecordID;
const otRow = id => db.OT_RECORDS.find(x => x.OTRecordID === id) || {};
const AP = 'approveOT', APF = 'handleApproveOT', CF = 'confirmOT', CFF = 'handleConfirmOT';
const uTue = otId('STF-U', '2026-11-10'), lTue = otId('STF-L', '2026-11-10'), tSat = otId('STF-T', '2026-11-14'), wMon = otId('STF-W', '2026-11-16');
ok_('มีแถว OT ที่รออนุมัติครบ 4 แถว', [uTue, lTue, tSat, wMon].every(Boolean));
r = step(AP, APF, { staffId: 'STF-T', otId: uTue, decision: 'approve' }, '🔴 ครูธรรมดาอนุมัติ');
eq('🔴 ...NO_PERMISSION', [r.host.code, r.host.ops], ['NO_PERMISSION', 0]);
r = step(AP, APF, { staffId: 'STF-L', otId: 'OTR-9999', decision: 'approve' }, '🔴 ไม่มีรายการนี้');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');
r = step(AP, APF, { staffId: 'STF-L', otId: uTue, decision: 'approve' }, 'หัวหน้าอนุมัติ OT ของครูยู');
eq('...PENDING_ADMIN · Step1By ชื่อหัวหน้า · ยอดยังไม่เปลี่ยน', [otRow(uTue).Status, otRow(uTue).Step1Status, otRow(uTue).Step1By, otRow(uTue).Amount], ['PENDING_ADMIN', 'Approved', 'หัวหน้าแอล', 200]);
r = step(AP, APF, { staffId: 'STF-L', otId: uTue, decision: 'approve' }, '🔴 อนุมัติซ้ำ');
eq('🔴 ...BAD_STATE', r.host.code, 'BAD_STATE');
r = step(AP, APF, { staffId: 'STF-L', otId: tSat, decision: 'reject' }, 'หัวหน้าไม่อนุมัติ OT Big Cleaning');
eq('...REJECTED', [otRow(tSat).Status, otRow(tSat).Step1Status], ['REJECTED', 'Rejected']);
r = step(CF, CFF, { staffId: 'STF-L', otId: uTue, decision: 'approve' }, '🔴 หัวหน้ายืนยันขั้นแอดมิน');
eq('🔴 ...NO_PERMISSION', r.host.code, 'NO_PERMISSION');
r = step(CF, CFF, { staffId: 'STF-A', otId: uTue, decision: 'approve' }, '💰 แอดมินยืนยัน (อัตราตอนนี้ 120)');
eq('💰 คิดใหม่ตอนอนุมัติ: 2 ชม. × 120 = 240 (เดิม 200 ที่อัตรา 100)', [otRow(uTue).Status, otRow(uTue).Hours, otRow(uTue).Rate, otRow(uTue).Amount, otRow(uTue).ApprovedBy, otRow(uTue).Step2Status], ['APPROVED', 2, 120, 240, 'แอดมินเอ', 'Approved']);
r = step(CF, CFF, { staffId: 'STF-A', otId: lTue, decision: 'approve', hours: 1, note: 'ตัดเหลือ 1 ชม.' }, '💰 แอดมินแก้เป็น 1 ชม.');
eq('💰 1 × 120 = 120 · หมายเหตุ', [otRow(lTue).Hours, otRow(lTue).Amount, otRow(lTue).Note], [1, 120, 'ตัดเหลือ 1 ชม.']);
r = step(CF, CFF, { staffId: 'STF-A', otId: wMon, decision: 'approve', amount: '350' }, '💰 แอดมินกำหนดยอดเอง 350');
eq('💰 ยอดที่แอดมินระบุชนะ', [otRow(wMon).Amount, otRow(wMon).Hours, otRow(wMon).Status], [350, 3, 'APPROVED']);
r = step(CF, CFF, { staffId: 'STF-A', otId: 'OTR-0001', decision: 'approve' }, '💰 ยืนยัน OT วันหยุดเหมาจ่าย');
eq('💰 800 คงเดิม · อัตรา 0 (ไม่กลายเป็น 0 ชม. × อัตรา = 0)', [otRow('OTR-0001').Amount, otRow('OTR-0001').Rate, otRow('OTR-0001').Hours], [800, 0, 0]);
r = step(CF, CFF, { staffId: 'STF-A', otId: tSat, decision: 'reject' }, 'แอดมินไม่อนุมัติ');
eq('...REJECTED ขั้น 2', [otRow(tSat).Status, otRow(tSat).Step2Status, otRow(tSat).Step2By], ['REJECTED', 'Rejected', 'แอดมินเอ']);

console.log('\n8) ขอลงเวลา (GPS ใช้ไม่ได้): ยื่น → หัวหน้าอนุมัติ/ไม่อนุมัติ (ขั้นแอดมินที่เขียนเวลาจริงอยู่ W4)');
setCfg('NotifyStaffApproval', 'app,line');
const SR = 'submitTimeRequest', SRF = 'handleSubmitTimeRequest', AR = 'approveTimeRequest', ARF = 'handleApproveTimeRequest';
const req = id => db.ATTENDANCE_REQUEST.find(x => x.ReqID === id) || {};
at('2026-11-17', '09:00');
r = step(SR, SRF, { staffId: 'STF-U', type: 'IN', date: '2026-11-16', time: '07:55', reason: 'GPS ใช้ไม่ได้' }, 'ครูยูขอลงเวลาเข้า 16/11 07:55');
eq('...ATR-001 · รอหัวหน้า · แอดมินได้กระดิ่ง + LINE ตามรายชื่อ', [r.host.data.reqId, req('ATR-001').Status, req('ATR-001').Step1Status, req('ATR-001').CreatedDate, r.host.line.map(p => p.to)],
  ['ATR-001', 'PENDING_LEADER', 'Pending', '2026-11-17', ['Udirector000004']]);
ok_('...ยังไม่มีอะไรถูกเขียนลงเวลาครู (ขั้นแอดมินเท่านั้นที่เขียน)', !db.CHECKIN_STAFF.some(x => x.StaffID === 'STF-U' && String(x.Date).slice(0, 10) === '2026-11-16' && x.CheckIn === '07:55'));
r = step(SR, SRF, { staffId: 'STF-L', type: 'OUT', date: '2026-11-16', time: '18:10' }, 'หัวหน้าขอลงเวลาออกของตัวเอง');
eq('...ข้ามขั้นหัวหน้า → รอแอดมิน', [req('ATR-002').Status, req('ATR-002').Step1Status], ['PENDING_ADMIN', 'Skipped']);
r = step(SR, SRF, { staffId: 'STF-U', type: 'XX', date: '2026-11-16', time: '07:55' }, '🔴 ชนิดผิด');
eq('🔴 ...BAD_TYPE', r.host.code, 'BAD_TYPE');
r = step(SR, SRF, { staffId: 'STF-U', type: 'IN', date: '2026-11-16' }, '🔴 ไม่ระบุเวลา');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step(SR, SRF, { staffId: 'STF-X', type: 'IN', date: '2026-11-16', time: '07:55' }, '🔴 ไม่มีพนักงานคนนี้');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');
at('2026-11-17', '10:30');
r = step(AR, ARF, { staffId: 'STF-T', reqId: 'ATR-001', decision: 'approve' }, '🔴 ครูธรรมดาอนุมัติ');
eq('🔴 ...NO_PERMISSION', r.host.code, 'NO_PERMISSION');
r = step(AR, ARF, { staffId: 'STF-L', reqId: 'ATR-001', decision: 'approve' }, 'หัวหน้าอนุมัติ ATR-001');
eq('...รอแอดมิน · เวลาที่อนุมัติถูกเก็บ · ไม่แจ้งใคร (คำตอบสุดท้ายมาจากแอดมิน)', [req('ATR-001').Status, req('ATR-001').Step1By, req('ATR-001').Step1At, r.host.line.length],
  ['PENDING_ADMIN', 'หัวหน้าแอล', '2026-11-17 10:30:00', 0]);
r = step(AR, ARF, { staffId: 'STF-L', reqId: 'ATR-001', decision: 'approve' }, '🔴 อนุมัติซ้ำ');
eq('🔴 ...BAD_STATE', r.host.code, 'BAD_STATE');
r = step(SR, SRF, { staffId: 'STF-W', type: 'OUT', date: '2026-11-16', time: '21:00', reason: 'ลืมกด' }, 'ครูดับเบิลยูขอลงเวลาออก 21:00');
r = step(AR, ARF, { staffId: 'STF-L', reqId: 'ATR-003', decision: 'reject', reason: 'วันนั้นออกงานแล้ว 20:10' }, 'หัวหน้าไม่อนุมัติ พร้อมเหตุผล');
eq('...REJECTED · เหตุผลถูกเก็บ · ผู้ขอได้กระดิ่ง (ไม่มี LINE เพราะไม่มี LineUID)', [req('ATR-003').Status, req('ATR-003').DecisionNote, db.ADMIN_INBOX.filter(x => x.StaffID === 'STF-W').length, r.host.line.length],
  ['REJECTED', 'วันนั้นออกงานแล้ว 20:10', 1, 0]);
r = step(AR, ARF, { staffId: 'STF-L', reqId: 'ATR-999', decision: 'approve' }, '🔴 ไม่มีคำขอนี้');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');

/* 🔴 request 1000 used to be ATR-000, and every one after it ATR-000 again (ผอ. 2026-11-11 — fixed in AttReq.gs) */
G.run(function () { appendObject_(sheet_(getHrSpreadsheet_(), 'ATTENDANCE_REQUEST'), { ReqID: 'ATR-999', StaffID: 'STF-U', Date: '2026-11-01', Type: 'IN', RequestTime: '08:00', Status: 'APPROVED' }); return ''; });
db.ATTENDANCE_REQUEST.push(Object.assign({ __id: 'r' + (nextId++) }, gasState().ATTENDANCE_REQUEST.slice(-1)[0]));   // the row exactly as the sheet holds it
r = step(SR, SRF, { staffId: 'STF-U', type: 'IN', date: '2026-11-16', time: '08:05' }, 'คำขอใบที่ 1000');
eq('🔴 ...ATR-1000 ไม่ใช่ ATR-000', r.host.data && r.host.data.reqId, 'ATR-1000');
r = step(SR, SRF, { staffId: 'STF-U', type: 'IN', date: '2026-11-16', time: '08:06' }, 'คำขอใบที่ 1001');
eq('🔴 ...ATR-1001 (ไม่ซ้ำ)', r.host.data && r.host.data.reqId, 'ATR-1001');
console.log('\n10) 💰 W4 · แอดมิน: ยืนยันคำขอลงเวลา (เขียนเวลาจริง) · แก้เวลาครูโดยตรง');
const CT = 'confirmTimeRequest', CTF = 'handleConfirmTimeRequest', ES = 'editStaffAttendance', ESF = 'handleEditStaffAttendance';
const dayRow = (sid, d) => db.CHECKIN_STAFF.filter(x => x.StaffID === sid && String(x.Date).slice(0, 10) === d);
at('2026-11-17', '11:00');
r = step(CT, CTF, { staffId: 'STF-L', reqId: 'ATR-001', decision: 'approve' }, '🔴 หัวหน้าเรียกขั้นแอดมิน');
eq('🔴 ...NO_PERMISSION', [r.host.code, r.host.ops], ['NO_PERMISSION', 0]);
r = step(CT, CTF, { staffId: 'STF-A', reqId: 'ATR-001', decision: 'approve' }, '💰 แอดมินอนุมัติ ATR-001 (ครูยู เข้า 16/11 07:55)');
{ const x = dayRow('STF-U', '2026-11-16');
  eq('💰 แถวเดิมของวันนั้นถูกแก้: เข้า 07:55 · ไม่สาย · ✍️ InManual · ออก 18:35 เดิมคงอยู่', [x.length, x[0].CheckIn, x[0].LateMinutes, x[0].InManual, x[0].CheckOut, x[0].Status], [1, '07:55', 0, 'YES', '18:35', 'OUT']); }
eq('...คำขอ APPROVED · เวลาที่อนุมัติ · ผู้ขอได้กระดิ่ง', [req('ATR-001').Status, req('ATR-001').Step2At, db.ADMIN_INBOX.filter(x => x.StaffID === 'STF-U').length > 0], ['APPROVED', '2026-11-17 11:00:00', true]);
r = step(CT, CTF, { staffId: 'STF-A', reqId: 'ATR-001', decision: 'approve' }, '🔴 อนุมัติซ้ำ');
eq('🔴 ...BAD_STATE', r.host.code, 'BAD_STATE');
r = step(CT, CTF, { staffId: 'STF-A', reqId: 'ATR-002', decision: 'approve' }, '💰 อนุมัติ ATR-002 (หัวหน้า ออก 16/11 18:10 · วันนั้นไม่มีแถว)');
{ const x = dayRow('STF-L', '2026-11-16');
  eq('💰 สร้างแถวใหม่: ออก 18:10 · 70 นาที → OT 1 ชม. · OutManual', [x.length, x[0] && x[0].CheckOut, x[0] && x[0].OTHours, x[0] && x[0].OutManual, x[0] && x[0].Status], [1, '18:10', 1, 'YES', 'OUT']); }
r = step(CT, CTF, { staffId: 'STF-A', reqId: 'ATR-1000', decision: 'reject', reason: 'ซ้ำกับ ATR-001' }, 'ไม่อนุมัติ ATR-1000 ที่ยังค้างที่หัวหน้า');
eq('...REJECTED · ขั้นหัวหน้าบันทึกว่าแอดมินตัดสินแทน · ไม่เขียนเวลา', [req('ATR-1000').Status, req('ATR-1000').Step1By, req('ATR-1000').DecisionNote, dayRow('STF-U', '2026-11-16')[0].CheckIn],
  ['REJECTED', 'แอดมินเอ (แอดมินอนุมัติแทน)', 'ซ้ำกับ ATR-001', '07:55']);

/* a day that was duplicated by the old string-slice bug — both sides carry two rows for STF-W on 16/11 */
G.run(function () { appendObject_(sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF'), { Date: '2026-11-16', StaffID: 'STF-W', CheckIn: '08:30', Status: 'IN', LateMinutes: 25 }); return ''; });
db.CHECKIN_STAFF.push(Object.assign({ __id: 'r' + (nextId++) }, gasState().CHECKIN_STAFF.slice(-1)[0]));
ok_('มีแถวซ้ำของครูดับเบิลยู 16/11 สองแถว', dayRow('STF-W', '2026-11-16').length === 2);
r = step(ES, ESF, { staffId: 'STF-L', targetId: 'STF-W', date: '2026-11-16', checkIn: '08:00' }, '🔴 หัวหน้าแก้เวลาครู');
eq('🔴 ...NO_PERMISSION', r.host.code, 'NO_PERMISSION');
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-W', date: '2026-11-18', checkIn: '08:00' }, '🔴 วันที่ยังมาไม่ถึง');
eq('🔴 ...FUTURE_DATE', r.host.code, 'FUTURE_DATE');
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-W', date: '2026-11-16', checkIn: '8 โมง' }, '🔴 รูปแบบเวลาผิด');
eq('🔴 ...BAD_TIME', r.host.code, 'BAD_TIME');
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-W', date: '2026-11-16' }, '🔴 ไม่มีอะไรให้แก้');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-W', date: '2026-11-16', checkIn: '08:12', remark: 'ลืมกด' }, '💰 แอดมินแก้เวลาเข้า 16/11 เป็น 08:12');
{ const x = dayRow('STF-W', '2026-11-16');
  eq('💰 แถวซ้ำถูกรวมเหลือแถวเดียว · สาย 7 (08:00 + 5) · ออก 20:10 เดิม OT 3 คงอยู่ · ผู้แก้/เหตุผล', [r.host.data.healed, x.length, x[0].CheckIn, x[0].LateMinutes, x[0].CheckOut, x[0].OTHours, x[0].EditedBy, x[0].EditNote],
    [1, 1, '08:12', 7, '20:10', 3, 'แอดมินเอ', 'ลืมกด']); }
eq('...เจ้าตัวและแอดมินได้กระดิ่ง', db.ADMIN_INBOX.slice(-2).map(x => x.StaffID || '(admin)'), ['STF-W', '(admin)']);
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-W', date: '2026-11-16', checkOut: '' }, '💰 ลบเวลาออก');
eq('💰 ไม่มีเวลาออก → OT ว่าง · สถานะ IN', [dayRow('STF-W', '2026-11-16')[0].OTHours, dayRow('STF-W', '2026-11-16')[0].Status], ['', 'IN']);
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-W', date: '2026-11-16', checkIn: '' }, '💰 ลบเวลาเข้าด้วย = วันนี้ไม่ได้ทำงาน');
eq('💰 แถวของวันนั้นถูกลบ', [r.host.data.removed, dayRow('STF-W', '2026-11-16').length], [true, 0]);
r = step(ES, ESF, { staffId: 'STF-A', targetId: 'STF-T', date: '2026-11-14', checkIn: '08:50' }, '💰 แก้เวลาเข้าวัน Big Cleaning 14/11 เป็น 08:50');
eq('💰 วัดจาก 08:30 ของวันนั้น + ผ่อนผัน 5 → สาย 15', dayRow('STF-T', '2026-11-14')[0].LateMinutes, 15);

console.log('\n11) 💰 W4 · แอดมินจัดการ OT ครู: เพิ่ม · OT วันหยุด · แก้ · ลบ');
const AO = 'adminAddOT', AOF = 'handleAdminAddOT', AH = 'adminAddHolidayOT', AHF = 'handleAdminAddHolidayOT', EO = 'adminEditOT', EOF_ = 'handleAdminEditOT', DO = 'adminDeleteOT', DOF = 'handleAdminDeleteOT';
const lastOt = () => db.OT_RECORDS.slice(-1)[0] || {};
at('2026-11-17', '12:00');
r = step(AO, AOF, { staffId: 'STF-L', targetStaffId: 'STF-T', hours: 2 }, '🔴 หัวหน้าเพิ่ม OT');
eq('🔴 ...NO_PERMISSION', [r.host.code, r.host.ops], ['NO_PERMISSION', 0]);
r = step(AO, AOF, { staffId: 'STF-A', targetStaffId: 'STF-T', hours: 0 }, '🔴 ไม่ระบุชั่วโมง');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
r = step(AO, AOF, { staffId: 'STF-A', targetStaffId: 'STF-X', hours: 2 }, '🔴 ไม่มีพนักงานคนนี้');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');
r = step(AO, AOF, { staffId: 'STF-A', targetStaffId: 'STF-T', hours: 2, date: '2026-11-16', note: 'อยู่ช่วยงานเย็น' }, '💰 แอดมินเพิ่ม OT 2 ชม. ให้ครูที (อัตราตอนนี้ 120)');
const addedId = lastOt().OTRecordID;
eq('💰 2 × 120 = 240 · APPROVED ทันที · รหัสต่อจากเลขสูงสุด', [lastOt().StaffID, lastOt().Amount, lastOt().Rate, lastOt().Status, lastOt().Month, /^OTR-\d{4}$/.test(addedId)], ['STF-T', 240, 120, 'APPROVED', '2026-11', true]);
r = step(AO, AOF, { staffId: 'STF-A', targetStaffId: 'STF-U', hours: 1.5, amount: '200', date: '2026-11-16' }, '💰 ระบุยอดเอง 200');
eq('💰 ยอดที่พิมพ์ชนะ', lastOt().Amount, 200);
r = step(AH, AHF, { staffId: 'STF-A', staffIds: ['STF-T', 'STF-U', 'STF-T'], date: '2026-11-22', amount: 600, note: 'ทำความสะอาดใหญ่วันอาทิตย์' }, '💰 OT วันหยุด อาทิตย์ 22/11 · ติ๊กครูทีซ้ำ');
{ const h = db.OT_RECORDS.filter(x => String(x.Date).slice(0, 10) === '2026-11-22');
  eq('💰 2 แถว (ซ้ำไม่จ่ายซ้ำ) · 600 เหมาจ่าย · Kind HOLIDAY · เจ้าตัวได้กระดิ่ง', [r.host.data.count, h.length, h.map(x => x.Amount), h.map(x => x.Kind), db.ADMIN_INBOX.filter(x => /OT วันหยุด 2026-11-22/.test(x.Text)).map(x => x.StaffID)],
    [2, 2, [600, 600], ['HOLIDAY', 'HOLIDAY'], ['STF-T', 'STF-U']]); }
r = step(AH, AHF, { staffId: 'STF-A', staffIds: ['STF-T'], date: '2026-11-17', amount: 600, note: 'x' }, '🔴 OT วันหยุดในวันทำงาน');
eq('🔴 ...NOT_A_HOLIDAY', r.host.code, 'NOT_A_HOLIDAY');
r = step(AH, AHF, { staffId: 'STF-A', staffIds: ['STF-T'], date: '2026-11-22', amount: 600, note: '  ' }, '🔴 ไม่เขียนรายละเอียด');
eq('🔴 ...BAD_INPUT', r.host.code, 'BAD_INPUT');
const holId = db.OT_RECORDS.find(x => String(x.Date).slice(0, 10) === '2026-11-22' && x.StaffID === 'STF-T').OTRecordID;
r = step(EO, EOF_, { staffId: 'STF-A', otId: holId, hours: 3 }, '💰 แก้ชั่วโมงของ OT วันหยุด');
eq('💰 เหมาจ่าย 600 ไม่ถูกคิดใหม่เป็นชั่วโมง × อัตรา', db.OT_RECORDS.find(x => x.OTRecordID === holId).Amount, 600);
r = step(EO, EOF_, { staffId: 'STF-A', otId: holId, date: '2026-11-18' }, '🔴 ย้าย OT วันหยุดไปวันทำงาน');
eq('🔴 ...NOT_A_HOLIDAY', r.host.code, 'NOT_A_HOLIDAY');
r = step(EO, EOF_, { staffId: 'STF-A', otId: addedId, hours: 3, note: 'แก้เป็น 3 ชม.' }, '💰 แก้ OT รายชั่วโมงเป็น 3 ชม.');
eq('💰 3 × 120 = 360', [db.OT_RECORDS.find(x => x.OTRecordID === addedId).Amount, db.OT_RECORDS.find(x => x.OTRecordID === addedId).Note], [360, 'แก้เป็น 3 ชม.']);
r = step(EO, EOF_, { staffId: 'STF-A', otId: addedId, date: '2026-12-01' }, 'ย้ายไปเดือนหน้า');
eq('...Month ตามวันที่ใหม่', db.OT_RECORDS.find(x => x.OTRecordID === addedId).Month, '2026-12');
const n0 = db.OT_RECORDS.length;
r = step(DO, DOF, { staffId: 'STF-A', otId: addedId }, '💰 ลบ OT ที่เพิ่ม');
eq('💰 หายไป 1 แถว', [db.OT_RECORDS.length, !!db.OT_RECORDS.find(x => x.OTRecordID === addedId)], [n0 - 1, false]);
r = step(DO, DOF, { staffId: 'STF-A', otId: addedId }, '🔴 ลบซ้ำ');
eq('🔴 ...NOT_FOUND', r.host.code, 'NOT_FOUND');

console.log('\n12) 🔴 กล่องทราย');
{
  ROUTES.setClock(null);
  ok_('staffCheckin ไม่มีสิทธิ์ส่ง LINE · staffCheckout มี', !ROUTES.sendsLine(IN) && ROUTES.sendsLine(OUT));
  const before = JSON.stringify(db);
  const saved = ROUTES.PORTED[OUT].appends; ROUTES.PORTED[OUT].appends = ['ADMIN_INBOX'];
  at('2026-11-17', '08:00'); const a = host(IN, here('STF-U'));
  at('2026-11-17', '19:30'); const keep = JSON.stringify(db); const h = host(OUT, here('STF-U'));
  ROUTES.PORTED[OUT].appends = saved;
  ok_('🔴 ถ้าไม่ได้ประกาศ OT_RECORDS → NOT_ON_FAST_HOST และเวลาออกก็ไม่ถูกบันทึก (ไม่มีครึ่ง ๆ กลาง ๆ)', a.ok && !h.ok && h.code === 'NOT_ON_FAST_HOST' && JSON.stringify(db) === keep && h.line.length === 0);
  void before;
}
ROUTES.setClock(null);
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
