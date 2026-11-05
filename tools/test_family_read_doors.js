/**
 * tools/test_family_read_doors.js — a family's session cannot read the school's staff, children and money
 *   node tools/test_family_read_doors.js
 *
 * 2026-11-05, found porting allLeaves to Cloud Run. The @402 audit (tools/test_money_doors.js) covered
 * engine WRITES; reads were never audited. Every engine handler is a live API (ENGINE_FALLBACK), the
 * only role gate is ADMIN_ONLY, and these were not in it — so ANY signed-in parent received:
 *
 *   listStaff        every staff member's NationalID · phone · BaseSalary · BankAccount · PasswordHash
 *   listStudents     every child's NationalID · address · Allergy · MedicalHistory · insurance
 *   financeSummary   the school's whole finances, staff pay totals included
 *   allLeaves        every staff leave request, reasons included (a sick note is health data)
 *   …and the admin/staff queues and reports listed in NOT_FOR_FAMILIES_ (src/Code.gs)
 *
 * Driven through the REAL dispatch_ with REAL sessions (issueSession_, RequireSessionToken on), one call
 * and inside a batch (the @399 lesson: every gate must hold per call in handleBatch too).
 *
 *   1  🔴 a parent gets NO_PERMISSION for every one — single call AND inside a batch
 *   2  the family's own screens still work (their child, their bills, the school calendar)
 *   3  teachers are UNCHANGED (their screens use listStudents / listStaff — a separate decision)
 *   4  the admin still gets everything
 *   5  no parent screen calls any of them (webapp/app.js — only A_/Admin./T_/Teacher. callers)
 */
'use strict';
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
const block = (/var NOT_FOR_FAMILIES_ = \{([\s\S]*?)\};/.exec(code) || [])[1] || '';
const DOORS = [...block.matchAll(/(\w+):\s*['"]/g)].map(m => m[1]);
/* the four that started this — they must be on the list whatever else changes */
const MUST = ['listStaff', 'listStudents', 'financeSummary', 'allLeaves'];

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6']);
const res = JSON.parse(run(new Function('return (' + function (DOORS) {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
  var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'STD-9', Name: 'เด็กของครอบครัวนี้', Status: 'ACTIVE', ParentID: 'PAR-9', Class: 'Nursery 1', NationalID: '1100000000009', MedicalHistory: 'หอบหืด' });
  appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'STD-8', Name: 'เด็กบ้านอื่น', Status: 'ACTIVE', ParentID: 'PAR-8', Class: 'Nursery 1', NationalID: '1100000000008', MedicalHistory: 'แพ้ถั่ว' });
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-9', Name: 'ผู้ปกครองทดสอบ', LineUID: 'U-P9', StudentID: 'STD-9' });
  appendObject_(sheet_(main, 'USER_LINKS'), { UserUID: 'U-P9', StudentID: 'STD-9', ParentID: 'PAR-9' });
  appendObject_(sheet_(main, 'BILLING'), { BillingID: 'BL-9', StudentID: 'STD-9', Month: '2026-11', Amount: 6900, Status: 'UNPAID' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T9', Name: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01', NationalID: '3100000000001', BaseSalary: 15000, BankAccount: '123-4-56789-0', PasswordHash: 'secret-hash' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A9', Name: 'แอดมินทดสอบ', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' });
  appendObject_(sheet_(hr, 'LEAVE_REQUEST'), { LeaveID: 'LV-9', StaffID: 'STF-T9', Type: 'ลาป่วย', StartDate: '2026-11-03', EndDate: '2026-11-03', Days: 1, Reason: 'ผ่าตัด', Status: 'APPROVED' });
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var P = issueSession_('U-P9', 'Parent', 'PAR-9'), T = issueSession_('U-T9', 'Teacher', 'STF-T9'), A = issueSession_('U-A9', 'Admin', 'STF-A9');
  function call(a, p, tok) { var j = JSON.parse(dispatch_(a, p || {}, tok).getContent()); return j.ok ? { ok: true, s: JSON.stringify(j.data) } : { ok: false, code: j.error.code }; }
  function codeOf(r) { return r.ok ? 'OK' : r.code; }
  var out = { single: {}, batch: {}, leak: {}, teacher: {}, admin: {}, family: {} };
  DOORS.forEach(function (a) {
    var r = call(a, { month: '2026-11', staffId: 'STF-T9', studentId: 'STD-9' }, P);
    out.single[a] = codeOf(r);
    if (r.ok && /1100000000008|3100000000001|secret-hash|ผ่าตัด|แพ้ถั่ว|15000/.test(r.s)) out.leak[a] = true;
  });
  var b = JSON.parse(dispatch_('batch', { calls: DOORS.map(function (a) { return { action: a, payload: {} }; }) }, P).getContent());
  (b.data || []).forEach(function (x, i) { out.batch[DOORS[i]] = x.ok ? 'OK' : x.error.code; });
  ['listStudents', 'listStaff', 'leaveQuota', 'staffMissingCheckout', 'teacherClassAttendance', 'pendingInjuries'].forEach(function (a) { out.teacher[a] = codeOf(call(a, {}, T)); });
  ['listStudents', 'listStaff', 'financeSummary', 'allLeaves'].forEach(function (a) { out.admin[a] = codeOf(call(a, {}, A)); });
  out.family.payments = codeOf(call('payments', { studentId: 'STD-9' }, P));
  out.family.studentCheckinHistory = codeOf(call('studentCheckinHistory', { studentId: 'STD-9' }, P));
  out.family.holidays = codeOf(call('holidays', {}, P));
  out.family.bigCleaningDays = codeOf(call('bigCleaningDays', {}, P));
  out.family.notifications = codeOf(call('notifications', { role: 'Parent', parentId: 'PAR-9' }, P));
  return JSON.stringify(out);
}.toString() + ')(' + JSON.stringify(DOORS) + ')')));

console.log('\n0) รายการที่ปิดสำหรับครอบครัว (NOT_FOR_FAMILIES_ ใน src/Code.gs): ' + DOORS.length + ' ตัว');
eq('สี่ตัวที่เริ่มเรื่องนี้อยู่ในรายการ', MUST.filter(a => DOORS.indexOf(a) < 0), []);

console.log('\n1) 🔴 ผู้ปกครองอ่านไม่ได้ — ทั้งคำขอเดี่ยว และใน batch');
eq('คำขอเดี่ยว: ทุกตัว → NO_PERMISSION', DOORS.filter(a => res.single[a] !== 'NO_PERMISSION'), []);
eq('ใน batch: ทุกตัว → NO_PERMISSION', DOORS.filter(a => res.batch[a] !== 'NO_PERMISSION'), []);
eq('🔴 ไม่มีเลขบัตร · เงินเดือน · รหัสผ่าน · ประวัติการรักษา · เหตุผลการลา ของคนอื่นหลุดออกไป', Object.keys(res.leak), []);

console.log('\n2) หน้าจอของครอบครัวยังใช้ได้');
eq('บิล · ประวัติมาเรียน · วันหยุด · Big Cleaning · กระดิ่ง', res.family, { payments: 'OK', studentCheckinHistory: 'OK', holidays: 'OK', bigCleaningDays: 'OK', notifications: 'OK' });

console.log('\n3) ครูไม่เปลี่ยน (เรื่องสิทธิ์ของครูต้องตัดสินแยก)');
eq('หน้าจอครูที่ใช้รายการเหล่านี้ยังทำงาน', res.teacher, { listStudents: 'OK', listStaff: 'OK', leaveQuota: 'OK', staffMissingCheckout: 'OK', teacherClassAttendance: 'OK', pendingInjuries: 'OK' });

console.log('\n4) แอดมินยังได้ทุกอย่าง');
eq('แอดมิน', res.admin, { listStudents: 'OK', listStaff: 'OK', financeSummary: 'OK', allLeaves: 'OK' });

console.log('\n5) ไม่มีหน้าจอของครอบครัวเรียกตัวไหนเลย (webapp/app.js)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').split('\n');
  const owner = i => { for (let j = i; j >= 0; j--) { const m = /(SCREENS\.(\w+)\.(\w+)|window\.([A-Z]{1,2}_\w+)\s*=|function (\w+)\s*\()/.exec(src[j]); if (m) return m[2] || m[4] || m[5]; } return '?'; };
  const family = [];
  DOORS.forEach(a => src.forEach((l, i) => {
    if (l.indexOf("'" + a + "'") < 0 || !/api\(|\[\s*'/.test(l)) return;
    const o = owner(i);
    if (/^(Parent|P_)/.test(o)) family.push(a + '@' + o + ':' + (i + 1));
  }));
  eq('ผู้เรียกที่เป็นหน้าจอครอบครัว', family, []);
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
