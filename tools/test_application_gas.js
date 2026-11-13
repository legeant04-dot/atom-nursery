/**
 * tools/test_application_gas.js — ใบสมัครออนไลน์ through the REAL Apps Script dispatch, with REAL sessions
 *   node tools/test_application_gas.js
 *
 * tools/test_application.js proves the engine's rules. This proves the doors and the messages, which
 * live in src/Code.gs and src/Apply.gs and which the engine cannot see:
 *   1  🔴 a family's applications are a family's — a TEACHER cannot submit or read one (they would be
 *      typing another family's parentId), a parent cannot reach the admin's queue or decisions
 *   2  the whole path on Sheets: submit → admin 🔔 → visit → family 🔔 (keyed by the APPLICATION, there
 *      is no child yet) → approve → a student + USER_LINKS row + the family 🔔 on the new child
 *   3  the family's bell really shows the application notices, and nobody else's
 *   4  a re-submit sends the admin nothing twice
 *   5  applications stay closed until the PDPA blanks are filled — on live, not only in the engine
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
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6', 'Apply']);
const res = JSON.parse(run(new Function('return (' + function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
  var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-9', Name: 'แม่ผู้สมัคร', LineUID: 'U-P9', Relationship: 'มารดา', Phone: '0811111111' });
  appendObject_(sheet_(main, 'PARENTS'), { ParentID: 'PAR-8', Name: 'บ้านอื่น', LineUID: 'U-P8', Phone: '0822222222' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-T9', Name: 'ครูทดสอบ', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', StartDate: '2025-01-01' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'STF-A9', Name: 'แอดมินทดสอบ', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2025-01-01' });
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var P = issueSession_('U-P9', 'Parent', 'PAR-9'), Q = issueSession_('U-P8', 'Parent', 'PAR-8'),
      T = issueSession_('U-T9', 'Teacher', 'STF-T9'), A = issueSession_('U-A9', 'Admin', 'STF-A9');
  function call(a, p, tok) { var j = JSON.parse(dispatch_(a, p || {}, tok).getContent()); return j.ok ? { ok: true, d: j.data } : { ok: false, code: j.error.code }; }
  function codeOf(r) { return r.ok ? 'OK' : r.code; }
  var out = {};
  // a valid Thai id, computed
  var d12 = '110170012345', s = 0; for (var i = 0; i < 12; i++) s += (+d12[i]) * (13 - i); var NID = d12 + ((11 - (s % 11)) % 10);
  function form(info, over) {
    var f = { clientRef: 'g-1', lang: 'th',
      child: { NameTH: 'ด.ญ. ทดลอง ใจดี', NameEN: 'Tadlong Jaidee', Nickname: 'น้องดี', NicknameEN: 'Dee', Gender: 'F', DOB: '2024-06-01', IdType: 'TH', NationalID: NID },
      data: { child: { weight: 11 }, pickups: [{ name: 'ยาย', phone: '0877777777', relation: 'ยาย' }], health: { allergy: 'กุ้ง' }, wish: {} },
      consents: { pdpa: true, health: true, daily: true, photoJournal: true, photoPublic: false },
      truth: true, signName: 'แม่ผู้สมัคร', consentVersion: info.version };
    for (var k in (over || {})) f[k] = over[k];
    return f;
  }
  // 5) closed until the school fills the blanks
  var info0 = call('applyInfo', {}, P).d;
  out.closed = [info0.open, codeOf(call('submitApplication', form(info0), P))];
  setConfigValue_('ApplyRetentionYears', '5'); setConfigValue_('ApplyPdpaContact', 'LINE @atom'); _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var info = call('applyInfo', {}, P).d;
  out.opened = info.open;
  // 1) doors
  out.teacher = { submit: codeOf(call('submitApplication', form(info, { parentId: 'PAR-9' }), T)),
    mine: codeOf(call('myApplications', { parentId: 'PAR-9' }, T)) };
  out.parentAdminDoors = ['listApplications', 'applicationAdmin', 'setApplicationVisit', 'rejectApplication', 'approveApplication']
    .map(function (a) { return a + ':' + codeOf(call(a, { appId: 'APP-0001' }, P)); });
  // 2) the path
  var sub = call('submitApplication', form(info, { parentId: 'PAR-8' /* ignored: the session decides */ }), P);
  out.sub = sub.ok ? [sub.d.appId, sub.d.status] : sub.code;
  var appRow = readObjects_(sheet_(main, 'APPLICATIONS'))[0] || {};
  out.appOwner = appRow.ParentID;
  out.studentsAfterSubmit = readObjects_(sheet_(main, 'STUDENTS')).length;
  out.consentRows = readObjects_(sheet_(main, 'CONSENTS')).length;
  var inbox = function () { return readObjects_(sheet_(main, 'ADMIN_INBOX')); };
  out.adminBell = inbox().filter(function (r) { return r.Category === 'registration' && /ใบสมัครใหม่/.test(r.Text) && !r.StudentID; }).length;
  // 4) a re-submit (same clientRef) tells nobody anything twice
  var again = call('submitApplication', form(info), P);
  out.again = again.ok ? again.d.existing : again.code;
  out.adminBellAfterAgain = inbox().filter(function (r) { return /ใบสมัครใหม่/.test(r.Text); }).length;
  // other family cannot read it
  out.otherFamily = codeOf(call('myApplication', { appId: 'APP-0001' }, Q));
  out.otherList = (call('myApplications', {}, Q).d || []).length;
  // visit → the family's bell, keyed by the application
  var v = call('setApplicationVisit', { appId: 'APP-0001', visitAt: '2099-01-02T10:30', note: 'นำเอกสารมาด้วย' }, A);
  out.visit = v.ok ? v.d.status : v.code;
  var fam = call('notifications', { role: 'Parent' }, P).d || [];
  out.familyBellVisit = fam.filter(function (n) { return /นัดเยี่ยมชม/.test(n.text) && /02\/01\/2642 10:30/.test(n.text); }).length;
  out.otherBell = (call('notifications', { role: 'Parent' }, Q).d || []).length;
  out.adminSeesVisitInOwnBell = inbox().filter(function (r) { return /นัดเยี่ยมชม/.test(r.Text) && !r.StudentID; }).length;
  // approve → a student, linked to this family, and the family's bell on the new child
  var ap = call('approveApplication', { appId: 'APP-0001', startDate: '2099-02-01', className: 'Nursery 1' }, A);
  out.approve = ap.ok ? [ap.d.status, !!ap.d.studentId] : ap.code;
  var st = readObjects_(sheet_(main, 'STUDENTS'));
  out.student = st.length ? [st.length, st[0].ParentID, ymdCell_(st[0].EnrollDate), st[0].Status] : null;
  out.link = readObjects_(sheet_(main, 'USER_LINKS')).filter(function (l) { return l.UserUID === 'U-P9' && l.StudentID === (st[0] || {}).StudentID; }).length;
  out.pickup = readObjects_(sheet_(main, 'PICKUP_PERSONS')).length;
  var fam2 = call('notifications', { role: 'Parent' }, P).d || [];
  out.familyBellAccepted = fam2.filter(function (n) { return /ได้รับการตอบรับเข้าเรียนแล้ว/.test(n.text); }).length;
  out.mineAfter = (call('myApplications', {}, P).d || []).map(function (a) { return a.status; });
  // a decided application cannot be withdrawn by the family
  out.cancelAfter = codeOf(call('cancelApplication', { appId: 'APP-0001' }, P));
  return JSON.stringify(out);
}.toString() + ')()')));

console.log('\n5) ปิดจนกว่าโรงเรียนจะเติมช่องว่างใน PDPA (บน Sheets จริง)');
eq('ยังไม่เติม → ปิด และส่งไม่ได้', res.closed, [false, 'APPLY_CLOSED']);
eq('เติมแล้ว → เปิด', res.opened, true);
console.log('\n1) 🔴 ประตู');
eq('ครูส่งใบสมัครแทนบ้านอื่นไม่ได้ · อ่านรายการของบ้านอื่นไม่ได้', res.teacher, { submit: 'NO_PERMISSION', mine: 'NO_PERMISSION' });
eq('ผู้ปกครองเข้าคิวและการตัดสินของแอดมินไม่ได้', res.parentAdminDoors,
  ['listApplications:NO_PERMISSION', 'applicationAdmin:NO_PERMISSION', 'setApplicationVisit:NO_PERMISSION', 'rejectApplication:NO_PERMISSION', 'approveApplication:NO_PERMISSION']);
console.log('\n2) เส้นทางทั้งหมด');
eq('ส่งได้ APP-0001', res.sub, ['APP-0001', 'SUBMITTED']);
eq('🔴 เจ้าของคือคนที่ล็อกอิน ไม่ใช่ parentId ที่ส่งมา', res.appOwner, 'PAR-9');
eq('🔴 ยังไม่มีนักเรียน', res.studentsAfterSubmit, 0);
eq('บันทึกความยินยอม 6 แถว', res.consentRows, 6);
eq('🔔 แอดมินได้รับแจ้งใบสมัครใหม่', res.adminBell, 1);
eq('ส่งซ้ำ → ใบเดิม', res.again, true);
eq('...และแอดมินไม่ได้รับแจ้งซ้ำ', res.adminBellAfterAgain, 1);
eq('บ้านอื่นเปิดใบสมัครนี้ไม่ได้', res.otherFamily, 'NO_ACCESS');
eq('...และรายการของบ้านอื่นว่าง', res.otherList, 0);
eq('นัดเยี่ยมชม', res.visit, 'VISIT');
eq('🔔 ผู้ปกครองเห็นวันเวลานัด (พ.ศ.) ในกระดิ่ง ทั้งที่ยังไม่มีบุตรในระบบ', res.familyBellVisit, 1);
eq('...บ้านอื่นไม่เห็น', res.otherBell, 0);
eq('...และไม่ไหลเข้ากระดิ่งแอดมิน', res.adminSeesVisitInOwnBell, 0);
eq('รับเข้า', res.approve, ['ACCEPTED', true]);
eq('นักเรียน 1 คน · ผูกกับผู้สมัคร · เริ่มตามวันที่เลือก · ACTIVE', res.student, [1, 'PAR-9', '2099-02-01', 'ACTIVE']);
eq('เชื่อม LINE ของผู้สมัครกับเด็ก', res.link, 1);
eq('ผู้รับแทนถูกสร้าง', res.pickup, 1);
eq('🔔 ผู้ปกครองได้รับแจ้งว่ารับเข้าแล้ว', res.familyBellAccepted, 1);
eq('สถานะในหน้าผู้ปกครอง', res.mineAfter, ['ACCEPTED']);
eq('ตัดสินแล้วยกเลิกไม่ได้', res.cancelAfter, 'BAD_STATE');

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
