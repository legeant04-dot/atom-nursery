/**
 * tools/test_pin.js — an admin's money actions need a PIN confirmed in the last 12 hours
 *   node tools/test_pin.js          (offline — Apps Script through the harness, the host's gate in-process)
 *
 * 2026-11-14. The school decided (12/11) every role stays signed in for 90 days and an admin's money
 * actions re-confirm after 12 hours; (14/11) the confirmation is a 6-digit PIN, for every action that
 * CHANGES money. Driven through the REAL dispatch_ with REAL sessions:
 *
 *   1  money without a PIN → PIN_REQUIRED, refused BEFORE the handler (single call AND inside a batch)
 *   2  what is not money is untouched — an announcement, a nickname, the GPS radius on the same screen
 *   3  setting a PIN: weak ones refused · stored as HMAC with a pepper, never the PIN · a token with `pa`
 *   4  with that token money passes the gate · 12 hours later it does not · a `pa` from the future does not
 *   5  wrong PIN → counted · 5 → locked 15 min (even the right PIN) · the lock ends → works, count reset
 *   6  change needs the old PIN · another admin resets yours, never you your own · the client cannot name
 *      whose PIN it is
 *   7  sessions: 90 days for every role (guest 12 h) · renewed once a day · renewal keeps `pa`, an admin
 *      who is no longer an admin loses it
 *   8  the fast host: the SAME gate (server/gate.js runs Code.gs) · renewal on the host is Auth.gs's own,
 *      and its tokens verify on Apps Script and Apps Script's on the host
 *   9  the app: PIN_REQUIRED is asked and the call repeated once · cards and buttons are where they belong
 */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
let pass = 0, fail = 0;
function ok_(label, cond, extra) { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; }

const FILES = ['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'OtStaff', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6', 'Pin', 'HolidayCare', 'Freeze', 'Announce'];
const H = H_(FILES);
H.props.SESSION_SECRET = 'pin-test-secret-' + 'y'.repeat(24);

const res = JSON.parse(H.run(new Function('return (' + function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); setConfigValue_('OTRatePerHour', '100'); setConfigValue_('Radius', '150'); _configCache = null;
  var hr = getHrSpreadsheet_();
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A9', Name: 'แอดมินเก้า', Nickname: 'เก้า', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-A9' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A8', Name: 'แอดมินแปด', Nickname: 'แปด', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-A8' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T9', Name: 'ครูเก้า', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01', LineUID: 'U-T9', BaseSalary: 15000, BankAccount: '111-1-11111-1' });
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var A = issueSession_('U-A9', 'Admin', 'STF-A9'), A8 = issueSession_('U-A8', 'Admin', 'STF-A8'), T = issueSession_('U-T9', 'Teacher', 'STF-T9');
  function call(a, p, tok) { var j = JSON.parse(dispatch_(a, p || {}, tok).getContent()); return j.ok ? { ok: true, d: j.data } : { ok: false, code: j.error.code, msg: j.error.message }; }
  function code(r) { return r.ok ? 'OK' : r.code; }
  var o = {};
  // 1 — money without a PIN
  o.m = {};
  ['confirmSlip', 'recordCashPayment', 'generateMonthlyBills', 'deleteBill', 'approvePayslip', 'adjustStaffPay', 'adminAddHolidayOT', 'holidayAttendSet', 'savePlans', 'markSalaryPaid']
    .forEach(function (a) { o.m[a] = code(call(a, { slipId: 'SL-X', billId: 'BL-X', staffId: 'STF-T9', month: '2026-11' }, A)); });
  o.cfgMoney = code(call('setConfigVal', { key: 'OTRatePerHour', value: '120' }, A));
  o.cfgMoneySame = code(call('setConfigVal', { key: 'OTRatePerHour', value: '100' }, A));
  o.cfgSchoolGps = code(call('setSchoolConfig', { values: { Radius: '150', OTRatePerHour: '100' } }, A));
  o.cfgSchoolMoney = code(call('setSchoolConfig', { values: { Radius: '150', OTRatePerHour: '130' } }, A));
  o.staffNick = code(call('saveStaff', { staffId: 'STF-T9', data: { Nickname: 'น้องเก้า', BaseSalary: 15000, BankAccount: '111-1-11111-1' } }, A));
  o.staffSalary = code(call('saveStaff', { staffId: 'STF-T9', data: { BaseSalary: 16000 } }, A));
  o.staffBank = code(call('saveStaff', { staffId: 'STF-T9', data: { BankAccount: '999-9-99999-9' } }, A));
  o.staffNewSalary = code(call('saveStaff', { data: { NameTH: 'ครูใหม่', BaseSalary: 12000 } }, A));
  o.salaryAfter = String(findObject_(sheet_(hr, 'STAFF'), function (s) { return s.StaffID === 'STF-T9'; }).BaseSalary);
  var b = JSON.parse(dispatch_('batch', { calls: [{ action: 'confirmSlip', payload: { slipId: 'SL-X' } }, { action: 'listStaff', payload: {} }] }, A).getContent());
  o.batch = (b.data || []).map(function (x) { return x.ok ? 'OK' : x.error.code; });
  // 2 — not money
  o.announce = code(call('addAnnouncement', { title: 'ทดสอบ', content: 'ข้อความ' }, A));
  o.teacherMoney = code(call('confirmSlip', { slipId: 'SL-X' }, T));
  // 3 — set a PIN
  o.st0 = call('pinStatus', {}, A).d;
  o.verifyNone = code(call('pinVerify', { pin: '482916' }, A));
  o.weak = ['123456', '111111', '987654', '12345', 'abcdef', '1234567'].map(function (p) { return code(call('pinSet', { pin: p }, A)); });
  var set = call('pinSet', { pin: '482916' }, A);
  o.setOk = set.ok;
  var row = findObject_(sheet_(hr, 'ADMIN_PIN'), function (r) { return r.StaffID === 'STF-A9'; });
  o.stored = { hasHash: /^[0-9a-f]{64}$/.test(String(row.PinHash)), noPlain: String(row.PinHash).indexOf('482916') < 0 && JSON.stringify(row).indexOf('482916') < 0, salt: !!row.Salt };
  o.pepper = !!PropertiesService.getScriptProperties().getProperty('PIN_PEPPER');
  o.inbox = readObjects_(sheet_(getMainSpreadsheet_(), 'ADMIN_INBOX')).filter(function (r) { return r.Category === 'security'; }).length;
  var tokPa = set.d.token, sessPa = verifySession_(tokPa);
  o.paSet = !!(sessPa && sessPa.pa && Math.abs(sessPa.pa - Date.now()) < 5000 && sessPa.uid === 'U-A9' && sessPa.role === 'Admin' && sessPa.linkedId === 'STF-A9');
  o.st1 = call('pinStatus', {}, tokPa).d;
  // 4 — with the PIN, money passes the gate (whatever the handler then says, it is not PIN_REQUIRED)
  o.withPin = code(call('setConfigVal', { key: 'OTRatePerHour', value: '120' }, tokPa));
  o.withPinSlip = code(call('confirmSlip', { slipId: 'SL-X' }, tokPa));
  var old = issueSession_('U-A9', 'Admin', 'STF-A9', undefined, { pa: Date.now() - 13 * 3600 * 1000 });
  o.expired = code(call('confirmSlip', { slipId: 'SL-X' }, old));
  var future = issueSession_('U-A9', 'Admin', 'STF-A9', undefined, { pa: Date.now() + 3600 * 1000 });
  o.future = code(call('confirmSlip', { slipId: 'SL-X' }, future));
  o.teacherPa = !!verifySession_(issueSession_('U-T9', 'Teacher', 'STF-T9', undefined, { pa: Date.now() })).pa;
  // 5 — wrong, lock, unlock
  o.wrong = [];
  for (var i = 0; i < 5; i++) o.wrong.push(code(call('pinVerify', { pin: '000001' }, A)));
  o.wrongMsg = call('pinVerify', { pin: '000001' }, A8).code;   // A8 has no PIN — different row, not locked
  o.lockedRight = code(call('pinVerify', { pin: '482916' }, A));
  o.lockedStatus = call('pinStatus', {}, A).d.locked;
  var sh = sheet_(hr, 'ADMIN_PIN'); row = findObject_(sh, function (r) { return r.StaffID === 'STF-A9'; });
  updateRow_(sh, row._row, { LockUntil: Date.now() - 1000 });
  o.afterLock = code(call('pinVerify', { pin: '482916' }, A));
  row = findObject_(sh, function (r) { return r.StaffID === 'STF-A9'; });
  o.reset = { fails: Number(row.Fails) || 0, lock: String(row.LockUntil || '') };
  // 6 — change, reset, who
  o.changeNoOld = code(call('pinSet', { pin: '739204' }, A));
  o.changeOk = code(call('pinSet', { pin: '739204', oldPin: '482916' }, A));
  o.oldGone = code(call('pinVerify', { pin: '482916' }, A));
  o.newOk = code(call('pinVerify', { pin: '739204' }, A));
  o.resetSelf = code(call('pinReset', { targetKey: 'STF-A9' }, A));
  o.spoof = code(call('pinVerify', { pin: '739204', __pinKey: 'STF-A8' }, A));      // still A9's own row
  o.resetOther = call('pinReset', { targetKey: 'STF-A9' }, A8);
  o.afterReset = code(call('pinVerify', { pin: '739204' }, A));
  o.teacherPinSet = code(call('pinSet', { pin: '482916' }, T));
  o.audit = readObjects_(sheet_(hr, 'AUDIT_LOG')).map(function (r) { return r.Action; }).filter(function (a) { return /^PIN_/.test(a); });
  // 7 — sessions
  o.ttl = { Parent: sessionTtlFor_('Parent'), Teacher: sessionTtlFor_('Teacher'), Admin: sessionTtlFor_('Admin'), Observer: sessionTtlFor_('Observer'), Leader: sessionTtlFor_('Leader'), guest: sessionTtlFor_('guest') };
  var now = Date.now(), day = 24 * 3600 * 1000;
  o.renewFresh = renewSession_({ uid: 'U-A9', role: 'Admin', linkedId: 'STF-A9', iat: now - 3600 * 1000, exp: now + 80 * day, pa: now - 3600 * 1000 });
  var rn = verifySession_(renewSession_({ uid: 'U-A9', role: 'Admin', linkedId: 'STF-A9', iat: now - 2 * day, exp: now + 80 * day, pa: now - 3600 * 1000 }));
  o.renewDue = rn ? { pa: rn.pa === now - 3600 * 1000, exp: Math.round((rn.exp - now) / day) } : null;
  o.renewAt89 = !!renewSession_({ uid: 'U-T9', role: 'Teacher', linkedId: 'STF-T9', iat: now - 89 * day, exp: now + 1 * day });
  o.renewExpired = renewSession_({ uid: 'U-T9', role: 'Teacher', linkedId: 'STF-T9', iat: now - 91 * day, exp: now - day });
  var stA9 = findObject_(sheet_(hr, 'STAFF'), function (s) { return s.StaffID === 'STF-A9'; });
  updateRow_(sheet_(hr, 'STAFF'), stA9._row, { Role: 'Teacher' });
  var demoted = verifySession_(renewSession_({ uid: 'U-A9', role: 'Admin', linkedId: 'STF-A9', iat: now - 2 * day, exp: now + 80 * day, pa: now }));
  o.demoted = demoted ? { role: demoted.role, pa: demoted.pa || 0 } : null;
  updateRow_(sheet_(hr, 'STAFF'), stA9._row, { Role: 'Admin' });
  // for section 8: an Apps Script token to verify on the host, and the identity rows the host will read
  o.gasToken = issueSession_('U-A9', 'Admin', 'STF-A9', undefined, { pa: now });
  o.staffRows = readObjects_(sheet_(hr, 'STAFF')).map(function (r) { var x = {}; Object.keys(r).forEach(function (k) { x[k] = r[k] instanceof Date ? r[k].toISOString() : r[k]; }); return x; });
  return JSON.stringify(o);
}.toString() + ')()')));

const C = (label, got, want) => ok_(label + '  → ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), { want });

console.log('\n1) 🔴 เงินโดยไม่มี PIN → PIN_REQUIRED ก่อน handler');
Object.keys(res.m).forEach(a => C(a, res.m[a], 'PIN_REQUIRED'));
C('setConfigVal เปลี่ยนค่าเงิน (ค่า OT 100 → 120)', res.cfgMoney, 'PIN_REQUIRED');
C('...บันทึกค่าเดิม (100) — ไม่ได้เปลี่ยนเงิน', res.cfgMoneySame, 'OK');
C('setSchoolConfig หน้าเดียวกัน แค่บันทึกรัศมี GPS (ค่าเงินไม่เปลี่ยน)', res.cfgSchoolGps, 'OK');
C('setSchoolConfig ที่เปลี่ยนค่า OT', res.cfgSchoolMoney, 'PIN_REQUIRED');
C('saveStaff แก้ชื่อเล่น (ฟอร์มส่งเงินเดือน/บัญชีค่าเดิมมาด้วย)', res.staffNick, 'OK');
C('saveStaff เปลี่ยนเงินเดือน', res.staffSalary, 'PIN_REQUIRED');
C('saveStaff เปลี่ยนเลขบัญชี', res.staffBank, 'PIN_REQUIRED');
C('saveStaff พนักงานใหม่ที่มีเงินเดือน', res.staffNewSalary, 'PIN_REQUIRED');
C('...เงินเดือนยังเป็นค่าเดิม (ไม่มีอะไรถูกเขียน)', res.salaryAfter, '15000');
C('ใน batch: call เงินถูกปฏิเสธ · call ข้าง ๆ ยังตอบ', res.batch, ['PIN_REQUIRED', 'OK']);

console.log('\n2) ไม่ใช่เงิน → ไม่ถาม');
C('แอดมินเพิ่มประกาศ', res.announce, 'OK');
C('ครูเรียก confirmSlip → ประตูเดิม (NO_PERMISSION) ไม่ใช่ PIN', res.teacherMoney, 'NO_PERMISSION');

console.log('\n3) 🔐 ตั้ง PIN');
C('ยังไม่มี PIN', res.st0.hasPin, false);
C('ยืนยันทั้งที่ยังไม่ได้ตั้ง', res.verifyNone, 'PIN_NOT_SET');
C('PIN อ่อน/ผิดรูปแบบถูกปฏิเสธทั้งหมด (123456 111111 987654 5หลัก ตัวอักษร 7หลัก)', res.weak, Array(6).fill('BAD_INPUT'));
C('ตั้ง 482916 ได้', res.setOk, true);
C('🔴 เก็บเป็น HMAC 64 hex · ไม่มี PIN ในแถว · มี salt', res.stored, { hasHash: true, noPlain: true, salt: true });
C('pepper อยู่ใน Script Properties', res.pepper, true);
C('กระดิ่งแอดมินได้รับแจ้ง "ตั้ง PIN แล้ว"', res.inbox >= 1, true);
C('token ใหม่มี pa = ตอนนี้ และเป็นของคนเดิม', res.paSet, true);
C('pinStatus: มี PIN · ยืนยันถึงอีก ~12 ชม.', [res.st1.hasPin, res.st1.confirmedUntil > Date.now() + 11.9 * 3600e3], [true, true]);

console.log('\n4) ผ่านประตูด้วย PIN · หมดอายุ · เวลาอนาคต');
ok_('setConfigVal ด้วย token ที่มี pa → ไม่ใช่ PIN_REQUIRED (' + res.withPin + ')', res.withPin !== 'PIN_REQUIRED');
ok_('confirmSlip ด้วย token ที่มี pa → ไปถึง handler (' + res.withPinSlip + ')', res.withPinSlip !== 'PIN_REQUIRED');
C('pa เมื่อ 13 ชม.ก่อน', res.expired, 'PIN_REQUIRED');
C('🔴 pa ในอนาคต (token ปลอมแปลงไม่ได้ แต่กันไว้)', res.future, 'PIN_REQUIRED');
C('token ของครูไม่มีวันมี pa', res.teacherPa, false);

console.log('\n5) ผิด · ล็อก · ปลดล็อก');
C('ผิด 4 ครั้งแรก = PIN_WRONG · ครั้งที่ 5 = PIN_LOCKED', res.wrong, ['PIN_WRONG', 'PIN_WRONG', 'PIN_WRONG', 'PIN_WRONG', 'PIN_LOCKED']);
C('🔴 ระหว่างล็อก แม้ PIN ถูกก็ไม่ผ่าน', res.lockedRight, 'PIN_LOCKED');
C('pinStatus บอกว่าล็อก', res.lockedStatus, true);
C('แอดมินอีกคน (แถวคนละแถว) ไม่โดนล็อกไปด้วย', res.wrongMsg, 'PIN_NOT_SET');
C('หมดเวลาล็อก → PIN ถูกผ่าน', res.afterLock, 'OK');
C('...และนับใหม่ / ล้างล็อก', res.reset, { fails: 0, lock: '' });

console.log('\n6) เปลี่ยน · รีเซ็ต · ใครเป็นเจ้าของ');
C('เปลี่ยน PIN โดยไม่ใส่ PIN เดิม', res.changeNoOld, 'PIN_WRONG');
C('เปลี่ยนด้วย PIN เดิม', res.changeOk, 'OK');
C('PIN เดิมใช้ไม่ได้แล้ว · PIN ใหม่ใช้ได้', [res.oldGone, res.newOk], ['PIN_WRONG', 'OK']);
C('🔴 รีเซ็ต PIN ของตัวเองไม่ได้', res.resetSelf, 'NO_PERMISSION');
C('🔴 ส่ง __pinKey ของคนอื่นมา → ยังเป็น PIN ของตัวเอง (ผ่านด้วย PIN ตัวเอง)', res.spoof, 'OK');
C('แอดมินอีกคนรีเซ็ตให้ได้', res.resetOther.ok && res.resetOther.d.cleared, true);
C('...หลังรีเซ็ต ต้องตั้งใหม่', res.afterReset, 'PIN_NOT_SET');
C('ครูเรียก pinSet', res.teacherPinSet, 'NO_PERMISSION');
ok_('บันทึกตรวจสอบ HR: ตั้ง · ผิด · ล็อก · เปลี่ยน · รีเซ็ต  → ' + [...new Set(res.audit)].join(' '),
  ['PIN_SET', 'PIN_WRONG', 'PIN_LOCKED', 'PIN_OK', 'PIN_CHANGED', 'PIN_RESET'].every(a => res.audit.indexOf(a) >= 0));

console.log('\n7) session 90 วัน · ต่ออายุวันละครั้ง');
const D90 = 90 * 24 * 3600;
C('ทุกบทบาท 90 วัน · guest 12 ชม.', res.ttl, { Parent: D90, Teacher: D90, Admin: D90, Observer: D90, Leader: D90, guest: 43200 });
C('token อายุ 1 ชม. → ยังไม่ต่อ', res.renewFresh, '');
C('token อายุ 2 วัน → ต่อ · pa เดิม (ไม่ยืดการยืนยัน) · อายุใหม่ 90 วัน', res.renewDue, { pa: true, exp: 90 });
C('เปิดแอปวันที่ 89 → ต่อได้ (สัญญา "เปิดอย่างน้อยทุก 90 วัน")', res.renewAt89, true);
C('หมดอายุแล้ว → ไม่ต่อ', res.renewExpired, '');
C('🔴 ถูกเปลี่ยนจากแอดมินเป็นครู → ต่ออายุเป็นครู และ pa หายไป', res.demoted, { role: 'Teacher', pa: 0 });

console.log('\n8) โฮสต์ใหม่: ประตูเดียวกัน · ต่ออายุด้วยโค้ดของ Apps Script');
const GATE = require(path.join(ROOT, 'server', 'gate.js'));
const { verifySession, sign_ } = require(path.join(ROOT, 'server', 'session.js'));
const PGE = require(path.join(ROOT, 'tools', 'pg_engine.js'));
const M = { config: { OTRatePerHour: '100' }, staff: [] };
const now = Date.now();
const codeOf = fn => { try { fn(); return 'OK'; } catch (e) { return e.apiCode || e.code || String(e.message).slice(0, 40); } };
const A = { uid: 'U-A9', role: 'Admin', linkedId: 'STF-A9', iat: now, exp: now + 3600e3 };
C('host: confirmSlip ไม่มี pa', codeOf(() => GATE.identity('confirmSlip', { slipId: 'X' }, A, M)), 'PIN_REQUIRED');
C('host: confirmSlip มี pa', codeOf(() => GATE.identity('confirmSlip', { slipId: 'X' }, Object.assign({ pa: now }, A), M)), 'OK');
C('host: setConfigVal ค่าเดิม', codeOf(() => GATE.identity('setConfigVal', { key: 'OTRatePerHour', value: '100' }, A, M)), 'OK');
C('host: setConfigVal ค่าใหม่', codeOf(() => GATE.identity('setConfigVal', { key: 'OTRatePerHour', value: '150' }, A, M)), 'PIN_REQUIRED');
C('host: listStaff', codeOf(() => GATE.identity('listStaff', {}, A, M)), 'OK');
const SECRET = H.props.SESSION_SECRET;
ok_('token ที่ Apps Script ออก → โฮสต์ตรวจผ่าน และเห็น pa', (() => { const p = verifySession(res.gasToken, SECRET); return !!(p && p.pa); })());
const staffRows = res.staffRows;
const old = { uid: 'U-A9', role: 'Admin', linkedId: 'STF-A9', iat: now - 2 * 86400e3, exp: now + 80 * 86400e3, pa: now - 60e3 };
C('renewDue: อายุ 2 วัน', GATE.renewDue(old), true);
C('renewDue: อายุ 1 ชม.', GATE.renewDue(Object.assign({}, old, { iat: now - 3600e3 })), false);
const hostTok = GATE.renew(old, { USERS: [], PARENTS: [], STAFF: staffRows }, SECRET);
const hp = verifySession(hostTok, SECRET);
C('โฮสต์ต่ออายุ: คนเดิม · Admin · pa เดิม · 90 วัน', hp && { uid: hp.uid, role: hp.role, linkedId: hp.linkedId, pa: hp.pa === old.pa, days: Math.round((hp.exp - now) / 86400e3) },
  { uid: 'U-A9', role: 'Admin', linkedId: 'STF-A9', pa: true, days: 90 });
/* 🔴 the harness's base64EncodeWebSafe drops the '=' padding; REAL Apps Script keeps it (server/session.js
 * header) and verifySession_ compares the signature string exactly. So this check runs Auth.gs's own
 * verifySession_ with Apps Script's real encoding — the one the host must match on the day. */
const harnessB64 = H.g.Utilities.base64EncodeWebSafe;
H.g.Utilities.base64EncodeWebSafe = d => (Array.isArray(d) ? Buffer.from(d.map(b => b < 0 ? b + 256 : b)) : Buffer.from(String(d), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const gasCheck = H.run(new Function('return (function(t){ var p = verifySession_(t); return p ? p.uid + "|" + p.role : "null"; })(' + JSON.stringify(hostTok) + ')'));
H.g.Utilities.base64EncodeWebSafe = harnessB64;
C('🔴 token ที่โฮสต์ออก → Apps Script (verifySession_) ตรวจผ่าน', gasCheck, 'U-A9|Admin');
C('uid ที่ไม่มีในระบบแล้ว → ไม่ต่อ', GATE.renew(Object.assign({}, old, { uid: 'U-GONE' }), { USERS: [], PARENTS: [], STAFF: staffRows }, SECRET), '');

console.log('\n8b) โฮสต์: คำตอบพก token ใหม่เมื่อถึงเวลา');
(async () => {
  process.env.SESSION_SECRET = SECRET; process.env.TENANT_ID = '00000000-0000-4000-8000-0000000000ae';
  const libPath = require.resolve(path.join(ROOT, 'tools', 'pg_lib.js'));
  require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: { acquire: async () => ({ client: { query: async () => ({ rows: [] }), end: async () => {} }, release() {} }) } };
  let reads = [];
  PGE.persist = async () => ({});
  PGE.hydrateConfig = async () => ({ Departments: ['Nursery 1'] });
  PGE.hydrateFast = async (c, t, keys) => { const MM = {}; keys.forEach(k => { MM[k] = []; });
    MM.staff = [{ __id: 's1', StaffID: 'STF-A9', NameTH: 'แอดมินเก้า', Role: 'Admin', PositionLevel: 'Admin', Department: '', Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
    return { M: MM, snapshot: {} }; };
  PGE.readSheet = async (c, t, sh) => { reads.push(sh); return sh === 'STAFF' ? staffRows : []; };
  const { handle } = require(path.join(ROOT, 'server', 'host.js'));
  const tok = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64'); return b + '.' + sign_(b, SECRET); };
  const call = async (t) => { let out = ''; reads = [];
    await handle({}, { setHeader() {}, writeHead() {}, end(s) { out = s; } }, JSON.stringify({ token: t, action: 'staffSelf', payload: {} })); return JSON.parse(out); };
  const r1 = await call(tok(old));
  C('token อายุ 2 วัน → คำตอบมี token ใหม่ · อ่าน USERS/PARENTS/STAFF', [r1.ok, !!r1.token, reads.sort().join(',')], [true, true, 'PARENTS,STAFF,USERS']);
  const r2 = await call(tok(Object.assign({}, old, { iat: now - 3600e3 })));
  C('token อายุ 1 ชม. → ไม่มี token ใหม่ · ไม่อ่านตารางตัวตน', [r2.ok, !!r2.token, reads.length], [true, false, 0]);

  console.log('\n9) แอป');
  const api = fs.readFileSync(path.join(ROOT, 'webapp', 'api.js'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'webapp', 'app.js'), 'utf8');
  ok_('api.js: PIN_REQUIRED → ถาม PIN แล้วส่งซ้ำครั้งเดียว', /e\.code === 'PIN_REQUIRED'[\s\S]{0,200}pinConfirm\(\)[\s\S]{0,200}enqueueGas\(action, payload\)/.test(api));
  ok_('api.js: ถามครั้งเดียวต่อหลาย call ที่รอ', /let _pinP = null;/.test(api) && /if \(_pinP\) return _pinP;/.test(api));
  ok_('api.js: pinSet/pinVerify/pinReset อยู่ใน WRITES', /pinSet: 1, pinVerify: 1, pinReset: 1/.test(api));
  ok_('app.js: กล่อง PIN เปิดแป้นตัวเลข (inputmode numeric) · ไม่เก็บ PIN ใน localStorage',
    /window\.__atomPinPrompt = async/.test(app) && /inputmode="numeric"/.test(app) && !/localStorage\.setItem\([^)]*pin/i.test(app));
  ok_('app.js: ตั้ง/เปลี่ยน PIN ของตัวเองอยู่ในเมนู ⚙️ ตั้งค่า & เครื่องมือ ของแอดมิน', /\['🔢',EN\(\)\?'My money PIN':'รหัส PIN รายการเงินของฉัน','PIN_CHANGE\(\)'\]/.test(app) && /window\.PIN_CHANGE = async/.test(app));
  ok_('app.js: ปุ่มรีเซ็ต PIN ในข้อมูลพนักงานที่เป็นแอดมิน ยกเว้นตัวเอง', /String\(s\.Role\|\|''\)==='Admin' && id!==USER\.staffId/.test(app) && /A_resetPin\('\$\{id\}'\)/.test(app));

  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\nFAILED ' + pass + ' passed, ' + (fail + 1) + ' failed\n'); process.exit(1); });
