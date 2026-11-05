/**
 * tools/test_money_doors.js — money (and the hours pay is measured against) is the admin's alone
 *   node tools/test_money_doors.js
 *
 * 2026-11-05, found porting money writes to Cloud Run: eleven engine actions that write had no
 * door anywhere — not in ADMIN_ONLY, not in the handler. Driven through the REAL dispatch_ with REAL
 * sessions (issueSession_, RequireSessionToken on), because the door is in dispatch_/applyIdentity_:
 *
 *   1  🔴 a parent cannot mark their own bill PAID, or give their child a negative charge
 *   2  a teacher cannot do any of the eleven
 *   3  the admin still can — the screens that use them keep working
 *   4  the family's own "I paid cash" (notifyCash) still works for the family
 */
'use strict';
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}

const DOORS = ['confirmPayment', 'rejectPayment', 'addStudentCharge', 'removeStudentCharge', 'setPayrollConfig',
  'addStaffGroup', 'deleteStaffGroup', 'setStaffGroupHours', 'importStudent', 'moveStudent', 'setPerm'];

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6']);
const res = JSON.parse(run(new Function('return (' + function (DOORS) {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
  var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'STD-9', Name: 'เด็กทดสอบ', Status: 'ACTIVE', ParentID: 'PAR-9', Class: 'Nursery 1' });
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-9', Name: 'ผู้ปกครองทดสอบ', LineUID: 'U-P9', StudentID: 'STD-9' });
  appendObject_(sheet_(main, 'USER_LINKS'), { UserUID: 'U-P9', StudentID: 'STD-9', ParentID: 'PAR-9' });
  appendObject_(sheet_(main, 'BILLING'), { BillingID: 'BL-9', StudentID: 'STD-9', Month: '2026-11', Amount: 6900, Status: 'UNPAID' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T9', Name: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A9', Name: 'แอดมินทดสอบ', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' });
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:BILLING', 'rows:BILLING', 'col:STUDENTS', 'col:PARENTS', 'col:USER_LINKS', 'col:STAFF', 'rows:STAFF']); } catch (e) {}
  var P = issueSession_('U-P9', 'Parent', 'PAR-9'), T = issueSession_('U-T9', 'Teacher', 'STF-T9'), A = issueSession_('U-A9', 'Admin', 'STF-A9');
  function call(a, p, tok) { var j = JSON.parse(dispatch_(a, p, tok).getContent()); return j.ok ? 'OK' : j.error.code; }
  function bill() { try { CacheService.getScriptCache().removeAll(['col:BILLING', 'rows:BILLING']); } catch (e) {}
    return (readObjects_(sheet_(main, 'BILLING')).filter(function (b) { return b.BillingID === 'BL-9'; })[0] || {}).Status; }
  var out = {};
  out.parentConfirm = call('confirmPayment', { kind: 'bill', id: 'BL-9', paidDate: '2026-11-05', method: 'cash' }, P);
  out.billAfterParent = bill();
  out.parentCredit = call('addStudentCharge', { studentId: 'STD-9', label: 'x', amount: -5000 }, P);
  out.teacher = {};
  DOORS.forEach(function (a) { out.teacher[a] = call(a, { kind: 'bill', id: 'BL-9', studentId: 'STD-9', staffId: 'STF-T9', config: { DailyRate: 9999 } }, T); });
  out.billAfterTeacher = bill();
  out.adminConfirm = call('confirmPayment', { kind: 'bill', id: 'BL-9', paidDate: '2026-11-05', method: 'cash', adminId: 'STF-A9' }, A);
  out.billAfterAdmin = bill();
  appendObject_(sheet_(main, 'BILLING'), { BillingID: 'BL-10', StudentID: 'STD-9', Month: '2026-12', Amount: 6900, Status: 'UNPAID' });
  try { CacheService.getScriptCache().removeAll(['col:BILLING', 'rows:BILLING']); } catch (e) {}
  out.parentCash = call('notifyCash', { kind: 'bill', id: 'BL-10', amount: 6900 }, P);
  return JSON.stringify(out);
}.toString() + ')(' + JSON.stringify(DOORS) + ')')));

console.log('\n1) 🔴 ผู้ปกครองยืนยันบิลตัวเองไม่ได้ · ให้ส่วนลดตัวเองไม่ได้');
eq('confirmPayment บิลของลูกตัวเอง', res.parentConfirm, 'NO_PERMISSION');
eq('...บิลยังไม่ถูกจ่าย', res.billAfterParent, 'UNPAID');
eq('addStudentCharge −5,000', res.parentCredit, 'NO_PERMISSION');

console.log('\n2) ครูทำไม่ได้ทั้ง ' + DOORS.length + ' ตัว');
eq('ทุกตัว → NO_PERMISSION', Object.keys(res.teacher).filter(a => res.teacher[a] !== 'NO_PERMISSION'), []);
eq('...บิลยังไม่ถูกจ่าย', res.billAfterTeacher, 'UNPAID');

console.log('\n3) แอดมินยังทำได้ตามปกติ');
eq('confirmPayment โดยแอดมิน', res.adminConfirm, 'OK');
eq('...บิลเป็น PAID', res.billAfterAdmin, 'PAID');

console.log('\n4) ปุ่ม "แจ้งชำระเงินสด" ของผู้ปกครองยังใช้ได้');
eq('notifyCash โดยผู้ปกครอง', res.parentCash, 'OK');

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
