/**
 * tools/test_class_scope.js — ครูทำได้เฉพาะเด็กในชั้นที่ตัวเองดูแล · หัวหน้าครูทำได้ทั้งหมด
 *   node tools/test_class_scope.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-21: "จำกัดให้ครูดำเนินการได้เฉพาะชั้นเรียนที่ตนเองดูแล แต่หัวหน้าครูทำได้ทั้งหมด
 * เช่นเดิม" — หลังจาก tools/audit_system.js (R2) รายงานว่ามีเจ็ดเส้นทางที่ครูคนใดก็ได้ ทำกับเด็ก
 * คนใดก็ได้ทั้งโรงเรียน
 *
 * 🔴 และนี่ไม่ใช่เรื่อง "ไม่ไว้ใจคุณครู"
 *
 * มันคือการทำให้ความผิดพลาดกลายเป็นเรื่องเล็ก: กดผิดคนในรายชื่อ 26 คนที่ตัวเองสอนทุกวัน
 * แก้ง่ายกว่ากดผิดคนในรายชื่อ 300 คนทั้งโรงเรียนที่ไม่เคยเห็นหน้า — และพอมียี่สิบโรงเรียน
 * จะไม่มี ผอ. คอยเปิดหน้าจอดูให้ทุกวันอีกแล้ว
 *
 * 🔴 เจ็ดเส้นทาง ด่านเดียว. ถ้าแต่ละเส้นทางเขียนกฎของตัวเอง อีกไม่นานมันจะไม่ตรงกัน —
 * `parentStudentIds_` เคยมีสามนิยามด้วยเหตุผลเดียวกันนี้ (v454)
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun', 'AttReq',
                    'Journal', 'Day6', 'GasEngine', 'Engine']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var stSh = sheet_(HR, 'STAFF'), suSh = sheet_(MAIN, 'STUDENTS');
  // ครูประจำ Nursery 1 · ครูประจำ Nursery 2 · หัวหน้าครู ('*' = ทุกชั้น)
  appendObject_(stSh, { StaffID: 'CS-T1', Name: 'ครูหนึ่ง', Nickname: 'หนึ่ง', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01', LineUID: 'U-CS-T1' });
  appendObject_(stSh, { StaffID: 'CS-T2', Name: 'ครูสอง', Nickname: 'สอง', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 2', StartDate: '2025-01-01', LineUID: 'U-CS-T2' });
  appendObject_(stSh, { StaffID: 'CS-HEAD', Name: 'หัวหน้าครู', Nickname: 'หัวหน้า', Role: 'Teacher',
    PositionLevel: 'Leader', Status: 'ACTIVE', Department: '*', StartDate: '2025-01-01', LineUID: 'U-CS-HEAD' });
  appendObject_(stSh, { StaffID: 'CS-ADM', Name: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin',
    Status: 'ACTIVE', Department: '*', StartDate: '2025-01-01' });
  // ...และครูที่ดูแลสองชั้น (คนหนึ่งคุมหลายห้องเป็นเรื่องปกติของที่นี่)
  appendObject_(stSh, { StaffID: 'CS-T12', Name: 'ครูหนึ่งสอง', Nickname: 'หนึ่งสอง', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1, Nursery 2', StartDate: '2025-01-01' });

  appendObject_(suSh, { StudentID: 'CS-K1', Name: 'เด็กห้องหนึ่ง', Nickname: 'หนึ่ง', Class: 'Nursery 1',
    Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  appendObject_(suSh, { StudentID: 'CS-K2', Name: 'เด็กห้องสอง', Nickname: 'สอง', Class: 'Nursery 2',
    Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:STAFF', 'rows:STAFF', 'col:STUDENTS', 'rows:STUDENTS']); } catch (e) {}

  function g(staffId, studentId) {
    try { assertStaffCoversStudent_(staffId, studentId); return 'OK'; }
    catch (e) { return (e && e.apiCode) || String((e && e.message) || e); }
  }
  var out = {
    ownClass:    g('CS-T1', 'CS-K1'),
    otherClass:  g('CS-T1', 'CS-K2'),
    head1:       g('CS-HEAD', 'CS-K1'),
    head2:       g('CS-HEAD', 'CS-K2'),
    admin:       g('CS-ADM', 'CS-K2'),
    twoClassesA: g('CS-T12', 'CS-K1'),
    twoClassesB: g('CS-T12', 'CS-K2'),
    noStudent:   g('CS-T1', 'CS-NOBODY'),
    // 🔴 ไม่มี staffId = ผู้ปกครอง — ด่านของเขาคือ applyIdentity_/parentOwnsStudent_ ไม่ใช่ตัวนี้
    parentPath:  g('', 'CS-K2')
  };

  // ...และเส้นทางจริง ไม่ใช่แค่ตัวช่วย
  function live(fn) { try { fn(); return 'OK'; } catch (e) { return (e && e.apiCode) || String((e && e.message) || e); } }
  out.liveCheckinOther = live(function () {
    handleStaffStudentCheckin({ staffId: 'CS-T1', studentId: 'CS-K2', type: 'IN', remark: 'คุณยายมาส่ง' }); });
  out.liveLeaveOther = live(function () {
    handleTeacherStudentLeave({ staffId: 'CS-T1', studentId: 'CS-K2', date: dateStr_(new Date()), type: 'ลาป่วย' }); });
  out.liveJournalManyMixed = live(function () {
    handleSubmitJournalsMany({ staffId: 'CS-T1', studentIds: ['CS-K1', 'CS-K2'] }); });
  out.liveHeadCheckinAny = live(function () {
    handleStaffStudentCheckin({ staffId: 'CS-HEAD', studentId: 'CS-K2', type: 'IN', remark: 'หัวหน้าครูลงให้' }); });
  out.liveInjuryTeacher = live(function () {
    handleApproveInjury({ staffId: 'CS-T1', injuryId: 'INJ-1', decision: 'approve' }); });
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 ครูประจำชั้น — เฉพาะเด็กในชั้นที่ตัวเองดูแล');
{
  eq('เด็กในชั้นของตัวเอง', res.ownClass, 'OK');
  eq('🔴 เด็กชั้นอื่น — ปฏิเสธ', res.otherClass, 'NO_ACCESS');
  eq('ครูที่ดูแลสองชั้น — ได้ทั้งสองชั้น (ก)', res.twoClassesA, 'OK');
  eq('...และ (ข)', res.twoClassesB, 'OK');
  eq('รหัสนักเรียนที่ไม่มีอยู่', res.noStudent, 'NOT_FOUND');
}

console.log('\n2) ⭐ หัวหน้าครูและแอดมิน — ทั้งโรงเรียนเหมือนเดิม');
{
  /* '*' คือวิธีที่ระบบเก็บ "หัวหน้าครู" มาตลอด และเป็นกฎเดียวกับที่หน้าจัดชั้นเรียนใช้ —
   * ไม่ได้สร้างนิยามใหม่ขึ้นมาอีกอัน */
  eq('หัวหน้าครู · ชั้น 1', res.head1, 'OK');
  eq('หัวหน้าครู · ชั้น 2', res.head2, 'OK');
  eq('แอดมิน', res.admin, 'OK');
  ok_('หัวหน้าครูคือ Department "*" — กฎเดียวกับทุกหน้าจอ', /indexOf\('\*'\) >= 0/.test(R('src/Parent.gs')));
}

console.log('\n3) 👪 ผู้ปกครองไม่ได้ถูกด่านนี้กั้น (เขามีด่านของตัวเอง)');
{
  /* 🔴 submitInsurance ถูกเรียกได้ทั้งจากผู้ปกครอง (กรอกประกันของลูกตัวเอง) และจากครู ถ้าด่านนี้
   * บังคับให้ต้องมีแถวพนักงาน ผู้ปกครองจะกรอกข้อมูลลูกตัวเองไม่ได้ — ซึ่งจะเป็นบั๊กที่เราสร้างเอง
   * จากการแก้บั๊ก applyIdentity_ ลบ staffId ทิ้งสำหรับเซสชันผู้ปกครองอยู่แล้ว */
  eq('ไม่มี staffId (ผู้ปกครอง) — ไม่ถูกกั้นที่ด่านนี้', res.parentPath, 'OK');
  ok_('...และผู้ปกครองยังถูกตรวจด้วย parentOwnsStudent_ ที่ applyIdentity_',
    /parentOwnsStudent_\(sess\.uid, payload\.studentId\)/.test(R('src/Code.gs')));
}

console.log('\n4) 🔴 เส้นทางจริง ไม่ใช่แค่ตัวช่วย');
{
  /* ด่านที่พิสูจน์แค่ในฟังก์ชันช่วย คือด่านที่ยังไม่รู้ว่าถูกเสียบไว้ในเส้นทางจริงหรือเปล่า —
   * บทเรียนจาก v457 (engine รู้กฎ แต่ route ที่รันจริงไม่รู้) */
  eq('ลงเวลาแทนเด็กชั้นอื่น — ปฏิเสธ', res.liveCheckinOther, 'NO_ACCESS');
  eq('แจ้งลาแทนเด็กชั้นอื่น — ปฏิเสธ', res.liveLeaveOther, 'NO_ACCESS');
  /* 🔴 ส่งทั้งชุดที่มีเด็กนอกชั้นปนอยู่ = ปฏิเสธทั้งชุด ไม่ใช่ข้ามเงียบๆ
   * "สำเร็จ แต่บางคนไม่ได้ถูกส่ง" คือคำตอบที่ครูไม่มีทางรู้ว่าเกิดขึ้น */
  eq('🔴 ส่งสมุดบันทึกเป็นชุด มีเด็กนอกชั้นปน — ปฏิเสธทั้งชุด', res.liveJournalManyMixed, 'NO_ACCESS');
  eq('หัวหน้าครูลงเวลาแทนเด็กชั้นไหนก็ได้', res.liveHeadCheckinAny, 'OK');
  eq('🔴 ครูธรรมดาอนุมัติรายงานอุบัติเหตุไม่ได้ (หัวหน้าครู/แอดมินเท่านั้น)', res.liveInjuryTeacher, 'NO_PERMISSION');

  const gs = f => R('src/' + f);
  ok_('ทั้งเจ็ดเส้นทางเรียกด่านเดียวกัน ไม่ได้เขียนกฎของตัวเอง',
    /assertStaffCoversStudent_/.test(gs('Checkin.gs')) && /assertStaffCoversStudent_/.test(gs('Parent.gs')) &&
    (gs('Journal.gs').match(/assertStaffCoversStudent_/g) || []).length >= 3 &&
    /assertStaffCoversStudent_/.test(gs('Dspm.gs')) && /assertStaffCoversStudent_/.test(gs('Day6.gs')));
  /* 🔴 ข้อความปฏิเสธต้องไม่เอ่ยชื่อเด็ก: ครูที่ไม่มีสิทธิ์กับเด็กคนนั้น ไม่ควรได้รู้จากข้อความ
   * ปฏิเสธว่าเด็กคนนั้นมีตัวตนในระบบไหม และอยู่ชั้นไหน */
  ok_('🔴 ข้อความปฏิเสธไม่เผยชื่อเด็กหรือชั้นเรียนของเด็กคนนั้น',
    /ทำรายการได้เฉพาะนักเรียนในชั้นที่ท่านดูแล/.test(gs('Parent.gs')) &&
    !/st\.Nickname|st\.Name|st\.Class/.test(gs('Parent.gs').slice(
      gs('Parent.gs').indexOf('function assertStaffCoversStudent_'),
      gs('Parent.gs').indexOf('function assertStaffCoversStudent_') + 1600).split('NO_ACCESS')[1] || ''));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
