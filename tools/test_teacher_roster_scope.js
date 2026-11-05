/**
 * tools/test_teacher_roster_scope.js — a teacher sees only what their screens need, and only their own class
 *   node tools/test_teacher_roster_scope.js
 *
 * 2026-11-05. Asked: "ปรับปรุงให้ครูเห็นเฉพาะข้อมูลที่จำเป็น โดยตัดฟิลด์ข้อมูลที่ละเอียดอ่อนออก และจำกัดให้เห็น
 * เฉพาะนักเรียนในชั้นเรียนของตนเองเท่านั้น" — with two exceptions the school chose: the holiday "a child
 * turned up" picker, and a teacher the admin ticked CanClassOrg (the organise tool). Both see every
 * child, names only. Driven through the REAL dispatch_ with REAL sessions (issueSession_,
 * RequireSessionToken on) — the role is stamped by the gate, so a teacher cannot ask to be an admin.
 *
 *   1  a homeroom teacher: listStudents = their own class only, roster fields only
 *   2  🔴 no sensitive field reaches any teacher (NationalID, MedicalHistory, Address, insurance …;
 *      for staff NationalID, BaseSalary, BankAccount, PasswordHash, Phone …)
 *   3  the holiday picker (forHoliday) and CanClassOrg and the head teacher: every child, roster fields
 *   4  a teacher who sends role:'Admin' is still a teacher
 *   5  the admin, the ผอ. on a teacher login (PositionLevel Admin) and the Observer keep the full rows
 *   6  the screens: T_holAddStudent asks with forHoliday and does not reuse the class-only cache
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

const SENSITIVE_STUDENT = ['NationalID', 'Address', 'MedicalHistory', 'Allergy', 'BloodType', 'DOB', 'EmergencyContact',
  'InsurancePolicyNo', 'InsuranceCompany', 'ParentID', 'Plan', 'Religion', 'Race', 'Nationality', 'Weight', 'Height',
  'WithdrawReason', 'pauseReason', 'endReason', 'DriveFolderUrl', 'OTRate'];
const SENSITIVE_STAFF = ['NationalID', 'BaseSalary', 'BankAccount', 'BankName', 'PasswordHash', 'Phone', 'LineUID', 'DOB',
  'Email', 'GoogleSub', 'ContributionAccum', 'ContributionOpening', 'pauseSalaryAmount', 'pauseReason', 'EndReason', 'Education'];

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave',
  'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm',
  'BillRun', 'GasEngine', 'Engine', 'Day6']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  setConfigValue_('RequireSessionToken', 'true'); _configCache = null;
  var main = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(main, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-T1' });
  appendObject_(sheet_(main, 'CLASSES'), { ClassID: 'C2', ClassName: 'Nursery 2', TeacherID: 'STF-T2' });
  [['STD-11', 'Nursery 1'], ['STD-12', 'Nursery 1'], ['STD-21', 'Nursery 2'], ['STD-22', 'Nursery 2']].forEach(function (x) {
    appendObject_(sheet_(main, 'STUDENTS'), { StudentID: x[0], Name: 'เด็ก ' + x[0], Nickname: 'น้อง' + x[0].slice(-2), Class: x[1], Status: 'ACTIVE',
      NationalID: '11000000' + x[0].slice(-2), Address: '99 ถนนทดสอบ', MedicalHistory: 'หอบหืด', Allergy: 'แพ้ถั่ว', DOB: '2023-01-01', ParentID: 'PAR-' + x[0].slice(-2),
      EmergencyContact: '0812345678', InsurancePolicyNo: 'POL-1', Photo: 'https://example.test/p.jpg' });
  });
  var st = function (id, extra) { return Object.assign({ StaffID: id, Name: 'ครู ' + id, Nickname: id.slice(-2), Role: 'Teacher', PositionLevel: 'Teacher',
    Status: 'ACTIVE', StartDate: '2025-01-01', NationalID: '3100000000' + id.slice(-2), BaseSalary: 15000, BankAccount: '123-4-56789-0',
    PasswordHash: 'hash-' + id, Phone: '0899999999', LineUID: 'U-' + id, DOB: '1990-01-01' }, extra || {}); };
  appendObject_(sheet_(hr, 'STAFF'), st('STF-T1', { Department: 'Nursery 1' }));
  appendObject_(sheet_(hr, 'STAFF'), st('STF-T2', { Department: 'Nursery 2' }));
  appendObject_(sheet_(hr, 'STAFF'), st('STF-ORG', { Department: 'Nursery 2', CanClassOrg: 'YES' }));
  appendObject_(sheet_(hr, 'STAFF'), st('STF-HEAD', { Department: '*' }));
  appendObject_(sheet_(hr, 'STAFF'), st('STF-LDR', { PositionLevel: 'Leader', Department: 'Nursery 1' }));
  appendObject_(sheet_(hr, 'STAFF'), st('STF-DIR', { PositionLevel: 'Admin', Department: '*' }));
  appendObject_(sheet_(hr, 'STAFF'), st('STF-A', { Role: 'Admin', PositionLevel: 'Admin' }));
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  var tok = {
    T1: issueSession_('U-STF-T1', 'Teacher', 'STF-T1'), ORG: issueSession_('U-STF-ORG', 'Teacher', 'STF-ORG'),
    HEAD: issueSession_('U-STF-HEAD', 'Teacher', 'STF-HEAD'), LDR: issueSession_('U-STF-LDR', 'Teacher', 'STF-LDR'),
    DIR: issueSession_('U-STF-DIR', 'Teacher', 'STF-DIR'), A: issueSession_('U-STF-A', 'Admin', 'STF-A'),
    OBS: issueSession_('U-OBS', 'Observer', 'STF-A')
  };
  function call(a, p, t) { var j = JSON.parse(dispatch_(a, p || {}, t).getContent()); return j.ok ? j.data : { ERR: j.error.code }; }
  var out = {};
  Object.keys(tok).forEach(function (k) {
    out[k] = { stu: call('listStudents', {}, tok[k]), stf: call('listStaff', {}, tok[k]), hol: call('listStudents', { forHoliday: true }, tok[k]) };
  });
  out.T1asAdmin = call('listStudents', { role: 'Admin', staffId: 'STF-A' }, tok.T1);
  var b = JSON.parse(dispatch_('batch', { calls: [{ action: 'listStudents', payload: {} }, { action: 'listStaff', payload: {} }] }, tok.T1).getContent());
  out.T1batch = (b.data || []).map(function (x) { return x.ok ? x.data : { ERR: x.error.code }; });
  return JSON.stringify(out);
}));

const ids = l => (Array.isArray(l) ? l : []).map(x => x.StudentID || x.StaffID);
const keysOf = l => [...new Set([].concat(...(Array.isArray(l) ? l : []).map(x => Object.keys(x))))];
const leaked = (l, bad) => keysOf(l).filter(k => bad.indexOf(k) >= 0);

console.log('\n1) ครูประจำชั้น Nursery 1 — เห็นเฉพาะเด็กในชั้นตัวเอง');
eq('listStudents', ids(res.T1.stu), ['STD-11', 'STD-12']);
eq('...ใน batch ก็เหมือนกัน', ids(res.T1batch[0]), ['STD-11', 'STD-12']);
ok_('ชื่อ · ชื่อเล่น · ชั้น · รูป ยังอยู่ (หน้าจอครูใช้)', res.T1.stu[0] && res.T1.stu[0].NameTH === 'เด็ก STD-11' && res.T1.stu[0].Nickname && res.T1.stu[0].Class === 'Nursery 1' && !!res.T1.stu[0].Photo);

console.log('\n2) 🔴 ไม่มีฟิลด์ละเอียดอ่อนถึงครูคนไหนเลย');
for (const k of ['T1', 'ORG', 'HEAD', 'LDR']) {
  eq(k + ': นักเรียน (รวมรายการวันหยุด)', leaked(res[k].stu, SENSITIVE_STUDENT).concat(leaked(res[k].hol, SENSITIVE_STUDENT)), []);
  eq(k + ': ครู', leaked(res[k].stf, SENSITIVE_STAFF), []);
}
eq('batch: ครู', leaked(res.T1batch[1], SENSITIVE_STAFF), []);
ok_('รายชื่อครูยังครบทุกคน (ไม่ได้จำกัดตามชั้น) พร้อมบทบาทและชั้น', ids(res.T1.stf).length === 7 && res.T1.stf.every(s => 'Role' in s && 'Department' in s));

console.log('\n3) ข้อยกเว้นที่โรงเรียนเลือก — เห็นทุกชั้น แต่เฉพาะชื่อ');
eq('รายการ "เด็กมาวันหยุด" ของครูประจำชั้น', ids(res.T1.hol), ['STD-11', 'STD-12', 'STD-21', 'STD-22']);
eq('ครูที่แอดมินให้สิทธิ์จัดชั้น (CanClassOrg)', ids(res.ORG.stu), ['STD-11', 'STD-12', 'STD-21', 'STD-22']);
eq('หัวหน้าครู (Department *)', ids(res.HEAD.stu), ['STD-11', 'STD-12', 'STD-21', 'STD-22']);
eq('Leader', ids(res.LDR.stu), ['STD-11', 'STD-12', 'STD-21', 'STD-22']);

console.log('\n4) 🔴 ครูที่ส่ง role:"Admin" มาเอง ยังเป็นครู');
eq('ได้แค่ชั้นตัวเอง', ids(res.T1asAdmin), ['STD-11', 'STD-12']);
eq('...และไม่มีฟิลด์ละเอียดอ่อน', leaked(res.T1asAdmin, SENSITIVE_STUDENT), []);

console.log('\n5) แอดมิน · ผอ. (ล็อกอินครูแต่ PositionLevel Admin) · Observer — ได้ข้อมูลเต็มเหมือนเดิม');
for (const k of ['A', 'DIR', 'OBS']) {
  ok_(k + ': เด็กทุกคน พร้อมเลขบัตรและประวัติการรักษา', ids(res[k].stu).length === 4 && res[k].stu.every(s => s.NationalID && s.MedicalHistory));
  ok_(k + ': ครูทุกคน พร้อมเงินเดือน', ids(res[k].stf).length === 7 && res[k].stf.some(s => Number(s.BaseSalary) === 15000));
}

console.log('\n6) หน้าจอ');
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
  const fn = app.slice(app.indexOf('window.T_holAddStudent=async'), app.indexOf('window.T_holAddDo='));
  ok_('T_holAddStudent ขอด้วย forHoliday', /api\('listStudents',\{forHoliday:true\}\)/.test(fn));
  ok_('...และไม่ใช้ A_CACHE.students (ของครูตอนนี้คือชั้นตัวเองเท่านั้น)', !/A_CACHE\.students/.test(fn.replace(/\/\*[\s\S]*?\*\//g, '')));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
