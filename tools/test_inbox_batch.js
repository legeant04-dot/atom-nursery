/**
 * tools/test_inbox_batch.js — การแจ้งเตือนครูหนึ่งรอบ ต้องอ่านชีตครั้งเดียว ไม่ใช่ครั้งต่อคน
 *   node tools/test_inbox_batch.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 วัดจากคนใช้จริง 6 วัน (2026-10-20 06:40 → 2026-10-26 09:15 · 393 session · 15,236 คำขอ)
 *
 *     ทั้งระบบ       p50 = 8.1s
 *     parentCheckin  p50 = 21.5s   p95 = 31.7s   ช้าสุด 115.2s
 *
 * ปุ่มที่ช้าที่สุดในแอป คือปุ่มที่ผู้ปกครองกด "ขณะยืนอยู่หน้าโรงเรียนพร้อมลูก"
 *
 * 🔴 และสาเหตุไม่ได้อยู่ที่ชนิดฐานข้อมูล — อยู่ที่รูปทรงของงาน
 *
 * การเช็คอินหนึ่งครั้งเรียก inboxAdd_ ทีละคนสำหรับครูทุกคนที่ดูแลเด็กคนนั้น และ inboxAdd_
 * หนึ่งครั้ง = อ่าน ADMIN_INBOX ทั้งชีต (กันข้อความซ้ำ) → ต่อท้าย 1 แถว → **ล้าง cache**
 * การล้าง cache ในข้อสุดท้ายทำให้รอบถัดไปอ่านเย็นเสมอ ครู 3 คนจึงเท่ากับอ่านทั้งชีตแบบเย็น 3 ครั้ง
 * ทั้งหมดอยู่ในล็อกเขียน ซึ่งกั้นคนทั้งโรงเรียนไว้ด้วย
 *
 * 🔴 และ ADMIN_INBOX โตขึ้นทุกวัน — แปลว่าการเช็คอิน **ช้าลงเรื่อย ๆ ทุกสัปดาห์** โดยไม่มีใคร
 * แก้อะไรเลย ซึ่งเป็นรูปแบบที่มองไม่เห็นจากการอ่านโค้ด และเห็นได้จากรายงานการใช้งานจริงเท่านั้น
 *
 * ชุดนี้ตรึง "รูปทรง" ไม่ใช่ความเร็ว: ความเร็วบน Apps Script แกว่ง 2.7–30 วินาทีอยู่แล้ว
 * การตรึงเป็นวินาทีจึงวัดสภาพอากาศ ไม่ได้วัดโค้ด · สิ่งที่ตรึงได้คือ **จำนวนครั้งที่แตะชีต**
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
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var HR = getHrSpreadsheet_(), MAIN = getMainSpreadsheet_();
  // ครู 4 คนที่ดูแลห้องเดียวกัน — จำนวนที่โรงเรียนจริงมีได้สบาย ๆ
  ['N1-A', 'N1-B', 'N1-C', 'N1-D'].forEach(function (id, i) {
    appendObject_(sheet_(HR, 'STAFF'), { StaffID: id, Name: 'ครู ' + id, Role: 'Teacher',
      PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'IB-K1', Name: 'เด็กทดสอบ', Nickname: 'ทดสอบ',
    Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  /* 🔴 กระดิ่งเรื่อง "เด็กมาถึง" ปิดเป็นค่าเริ่มต้น (NotifyStaffArrival = '') — ต้องเปิดก่อน
   * ไม่งั้นชุดนี้จะผ่านโดยไม่ได้ตรวจอะไรเลย เพราะไม่มีใครถูกเขียนถึงตั้งแต่แรก
   * (และข้อเท็จจริงนี้เองคือเหตุผลที่ 21.5 วินาทีของ parentCheckin อธิบายด้วยกล่องข้อความไม่ได้
   *  ทั้งหมด — ดูหมายเหตุใน src/Parent.gs เรื่องการสแกน CHECKIN_STUDENT ทั้งชีต) */
  setConfigValue_('NotifyStaffArrival', 'app');
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'rows:STAFF', 'col:STAFF', 'rows:STUDENTS', 'col:STUDENTS']); } catch (e) {}

  /* นับการแตะ ADMIN_INBOX จริง ๆ โดยห่อ readObjects_ และ setValues/appendRow ไว้ */
  var count = { read: 0, append: 0, setValues: 0 };
  var realRead = readObjects_;
  readObjects_ = function (sh) {
    try { if (sh && sh.getName && sh.getName() === 'ADMIN_INBOX') count.read++; } catch (e) {}
    return realRead.apply(null, arguments);
  };
  var sh = inboxSheet_();
  var realAppend = sh.appendRow.bind(sh), realRange = sh.getRange.bind(sh);
  sh.appendRow = function () { count.append++; return realAppend.apply(null, arguments); };
  sh.getRange = function () {
    var rg = realRange.apply(null, arguments);
    var sv = rg.setValues && rg.setValues.bind(rg);
    if (sv) rg.setValues = function () { count.setValues++; return sv.apply(null, arguments); };
    return rg;
  };

  var student = findObject_(sheet_(MAIN, 'STUDENTS'), function (s) { return s.StudentID === 'IB-K1'; });
  notifyStudentTeacher_(student, '👶 เด็กทดสอบ มาถึงแล้ว (08:30)',
    { adminFallback: false, topic: 'staff.arrival', category: 'arrival', ref: 'IB-K1' });

  readObjects_ = realRead;
  var rows = realRead(inboxSheet_()).filter(function (r) { return String(r.Ref) === 'IB-K1'; });
  return JSON.stringify({ count: count, inboxRows: rows.length,
    staffIds: rows.map(function (r) { return String(r.StaffID); }).sort() });
}));

console.log('\n1) 🔴 ครูกี่คนก็ตาม — อ่าน ADMIN_INBOX ครั้งเดียว');
{
  eq('อ่าน ADMIN_INBOX กี่ครั้ง', res.count.read, 1);
  /* ของเดิมคือหนึ่งครั้งต่อครูหนึ่งคน และแต่ละครั้งอ่านเย็นเพราะรอบก่อนเพิ่งล้าง cache ทิ้ง */
  ok_('🔴 ...ไม่ใช่ครั้งละคน (4 ครูก็ยังอ่านครั้งเดียว)', res.count.read === 1);
}

console.log('\n2) 🔴 และเขียนครั้งเดียว');
{
  eq('ต่อท้ายทีละแถว (appendRow)', res.count.append, 0);
  ok_('เขียนเป็นก้อนเดียวด้วย setValues', res.count.setValues === 1);
}

console.log('\n3) ✅ แต่ทุกคนต้องได้รับเหมือนเดิม — เร็วขึ้นต้องไม่แลกกับความถูกต้อง');
{
  eq('ครูได้กล่องข้อความครบทุกคน', res.inboxRows, 4);
  eq('...และเป็นคนที่ถูกต้อง', res.staffIds, ['N1-A', 'N1-B', 'N1-C', 'N1-D']);
}

console.log('\n4) 🔴 รูปทรงในโค้ด — กันไม่ให้ถอยกลับไปเขียนทีละคน');
{
  const parentGs = R('src/Parent.gs'), notifyGs = R('src/Notify.gs');
  ok_('เก็บรายชื่อก่อน แล้วเขียนทีเดียว', /inboxFor\.push\(staff\.StaffID\)/.test(parentGs) &&
    /if \(inboxFor\.length\) inboxAddMany_\(/.test(parentGs));
  ok_('🔴 ไม่มี inboxAdd_ ทีละคนหลงเหลือในเส้นทางแจ้งครู',
    !/reach = function[\s\S]{0,420}inboxAdd_\(/.test(parentGs));
  ok_('inboxAddMany_ อ่านครั้งเดียวและล้าง cache ครั้งเดียว',
    /function inboxAddMany_/.test(notifyGs) &&
    (notifyGs.slice(notifyGs.indexOf('function inboxAddMany_'), notifyGs.indexOf('function inboxAdd_'))
      .match(/readObjects_\(/g) || []).length === 1);
  /* เหตุผลเขียนไว้ข้างโค้ด ไม่ใช่แค่ในเทสต์ — ตัวเลขที่ไม่มีใครรู้ที่มา คือตัวเลขที่คนถัดไปจะรื้อทิ้ง */
  ok_('มีตัวเลขที่วัดได้จริงเขียนกำกับไว้ข้างโค้ด', /21\.5/.test(notifyGs) && /8\.1/.test(notifyGs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
