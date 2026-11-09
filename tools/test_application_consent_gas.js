/**
 * tools/test_application_consent_gas.js — 🔒 ใบสมัคร ระยะ 3 on the REAL Apps Script path, real sessions
 *   node tools/test_application_consent_gas.js
 *
 * The daily journal is written by src/Journal.gs in place — it never runs the engine — so the engine's
 * own refusal (tools/test_application.js §14) proves nothing about the live route. This does:
 *   1  🔴 a picture for a child whose family said NO to 7.3-3 is refused by submitJournal
 *   2  the same entry without a picture saves; a child with no answer on file (enrolled before the app)
 *      still gets pictures — nothing changes for them
 *   3  only the admin records or reads a child's consent; a teacher and a parent cannot
 *   4  the class list carries the NO answers to the teacher's screen
 */
'use strict';
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6', 'Apply', 'Journal']);
const res = JSON.parse(run(new Function('return (' + function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
  var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(main, 'CLASSES'), { ClassName: 'Nursery 1', TeacherID: 'STF-T9' });
  appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'STD-1', Name: 'ไม่ยินยอมรูป', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2025-01-01', ParentID: 'PAR-9' });
  appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'STD-2', Name: 'เด็กเดิม', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2025-01-01' });
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-9', Name: 'แม่', LineUID: 'U-P9', StudentID: 'STD-1' });
  appendObject_(sheet_(main, 'USER_LINKS'), { UserUID: 'U-P9', StudentID: 'STD-1' });
  appendObject_(sheet_(main, 'CONSENTS'), { ConsentID: 'CNS-00001', AppID: 'APP-0001', StudentID: 'STD-1', ParentID: 'PAR-9', Item: 'photoJournal', Value: 'NO', Version: 'v', At: '2026-11-09 10:00', Source: 'application' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T9', Name: 'ครู', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01', Department: 'Nursery 1' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A9', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' });
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var P = issueSession_('U-P9', 'Parent', 'PAR-9'), T = issueSession_('U-T9', 'Teacher', 'STF-T9'), A = issueSession_('U-A9', 'Admin', 'STF-A9');
  function call(a, p, tok) { var j = JSON.parse(dispatch_(a, p || {}, tok).getContent()); return j.ok ? { ok: true, d: j.data } : { ok: false, code: j.error.code, msg: j.error.message }; }
  function codeOf(r) { return r.ok ? 'OK' : r.code; }
  var PAST = '2026-11-02';   // a back-filled day: the check-in rule only applies to today
  var out = {};
  out.declined = codeOf(call('submitJournal', { studentId: 'STD-1', date: PAST, Mood: 'Happy', Photo1: 'data:image/jpeg;base64,/9j/AA' }, T));
  out.declinedNoPhoto = codeOf(call('submitJournal', { studentId: 'STD-1', date: PAST, Mood: 'Happy' }, T));
  out.oldChildPhoto = codeOf(call('submitJournal', { studentId: 'STD-2', date: PAST, Mood: 'Happy', Photo1: 'data:image/jpeg;base64,/9j/AA' }, T));
  out.doors = [codeOf(call('setStudentConsent', { studentId: 'STD-1', item: 'photoJournal', value: 'YES' }, T)),
    codeOf(call('setStudentConsent', { studentId: 'STD-1', item: 'photoJournal', value: 'YES' }, P)),
    codeOf(call('studentConsents', { studentId: 'STD-1' }, T)), codeOf(call('applicationDocument', { appId: 'APP-0001' }, P))];
  var cl = call('classList', {}, T);
  out.classList = cl.ok ? (cl.d.students || []).map(function (s) { return s.StudentID + ':' + (s.noConsent || []).join(','); }).sort() : cl.code;
  var set = call('setStudentConsent', { studentId: 'STD-1', item: 'photoJournal', value: 'YES', note: 'คุณแม่โทรมาแจ้ง' }, A);
  out.adminSet = set.ok ? set.d.current.photoJournal : set.code;
  out.afterYes = codeOf(call('submitJournal', { studentId: 'STD-1', date: '2026-11-03', Mood: 'Happy', Photo1: 'data:image/jpeg;base64,/9j/AA' }, T));
  out.rows = readObjects_(sheet_(main, 'CONSENTS')).filter(function (c) { return c.StudentID === 'STD-1'; }).map(function (c) { return c.Value + ':' + c.Source; });
  return JSON.stringify(out);
}.toString() + ')()')));

console.log('\n1–2) บันทึกประจำวัน (Journal.gs — ทางจริง)');
eq('🔴 แนบรูปเด็กที่ผู้ปกครองไม่ยินยอม → ปฏิเสธ', res.declined, 'NO_CONSENT');
eq('...บันทึกโดยไม่แนบรูปได้', res.declinedNoPhoto, 'OK');
eq('เด็กเดิม (ไม่มีบันทึกความยินยอมในระบบ) แนบรูปได้ตามเดิม', res.oldChildPhoto, 'OK');
console.log('\n3) ประตู');
eq('ครู/ผู้ปกครองบันทึกความยินยอมไม่ได้ · ครูอ่านประวัติไม่ได้ · ผู้ปกครองพิมพ์ใบสมัครฝั่งแอดมินไม่ได้', res.doors, ['NO_PERMISSION', 'NO_PERMISSION', 'NO_PERMISSION', 'NO_PERMISSION']);
console.log('\n4) หน้ารายชื่อชั้นของครู');
eq('ครูเห็นข้อที่ไม่ยินยอมที่ชื่อเด็ก', res.classList, ['STD-1:photoJournal', 'STD-2:']);
console.log('\n…และแอดมินเปลี่ยนได้');
eq('แอดมินบันทึกว่ายินยอมแล้ว', res.adminSet, 'YES');
eq('หลังยินยอม แนบรูปได้', res.afterYes, 'OK');
eq('ประวัติต่อท้าย ไม่ทับ', res.rows, ['NO:application', 'YES:admin']);

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
