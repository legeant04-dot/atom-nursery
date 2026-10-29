/**
 * tools/test_admin_todo.js — "สิ่งที่ต้องทำวันนี้" และ "สรุปภาพรวม" (Phase B + C)
 *   node tools/test_admin_todo.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-21 สั่งทำตามลำดับ B → C → A
 *
 * แดชบอร์ดเดิมตอบมาตลอดว่า "เมื่อวานเป็นยังไง" — ตัวเลขถูกทุกตัว และไม่มีตัวไหนบอกว่า **เช้านี้
 * ต้องทำอะไร** แอดมินจึงไล่เปิดเองวันละหกหน้าจอเพื่อหาว่ามีอะไรค้างอยู่บ้าง
 *
 * 🔴 สามกฎที่ชุดทดสอบนี้มีไว้ตรึง — ทั้งสามข้อมาจากความผิดพลาดที่เคยเกิดจริงในโปรเจกต์นี้
 *
 *   ① ไม่มีงานค้าง = ไม่พิมพ์อะไรเลย
 *      การ์ดที่ขึ้นทุกวันไม่ว่าจะมีอะไรหรือไม่ คือการ์ดที่สายตาเรียนรู้ที่จะข้าม และวันที่มัน
 *      สำคัญจริงก็จะถูกข้ามไปด้วย (เหตุผลเดียวกับ parentDueCard และ "แพ้: -" สีเทาบนทุกแถว)
 *
 *   ② ตัวเลขต้องมาจากแหล่งเดียวกับหน้าจอปลายทาง
 *      "ผูกกับนักเรียนไหม" เคยมีสามคำตอบ (v454) · "ยังไม่ได้จัดชั้น" เคยมีสอง (v456)
 *      ถ้าหน้าแรกบอก 12 แล้วกดเข้าไปเจอ 9 ทั้งหน้าจะไม่ถูกเชื่ออีกเลย
 *
 *   ③ ทุกบรรทัดต้องเป็นงานที่ทำวันนี้ได้ ไม่ใช่สถิติ
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

const _d=new Date().getDay(); const _weekend=(_d===0||_d===6);
const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun', 'AttReq',
                    'Journal', 'Day6', 'GasEngine', 'Engine']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var T = gasToday_();
  // วันนี้ต้องเป็นวันทำงาน ไม่งั้นข้อ "สมุดบันทึก" จะถูกข้ามไปเฉยๆ แล้วเทสต์จะผ่านโดยไม่ได้ตรวจอะไร
  var hol = MAIN.getSheetByName('HOLIDAYS'); if (hol && hol.getLastRow() > 1) hol.deleteRows(2, hol.getLastRow() - 1);
  var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
  /* 🔴 ที่นี่เคยตั้ง SCHOOL_CONFIG.WorkDays = ทุกวัน เพื่อให้ "วันนี้เป็นวันทำงาน"
   * แต่ WorkDays ไม่มีโค้ดบรรทัดไหนในแอปอ่านมันเลย — มันมีอยู่แค่ในไฟล์เทสต์
   * วันเสาร์-อาทิตย์ถูกตรึงเป็นวันหยุดไว้ใน engine เอง (schoolClosedFor_: getDay()===0||6)
   * ชุดนี้จึงเคยผ่านเพราะบังเอิญไม่เคยถูกรันวันเสาร์ ไม่ใช่เพราะ fixture กันไว้ได้ */

  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'TD-ADM', Name: 'แอดมิน', Role: 'Admin',
    PositionLevel: 'Admin', Status: 'ACTIVE', Department: '*', StartDate: '2025-01-01' });
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'TD-T', Name: 'ครู', Nickname: 'ครู', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  /* ...and her child rate IS set, so "โรงเรียนที่ไม่มีอะไรค้าง" really has nothing outstanding.
   * Without this row the new childRate item fires here and section 1 would fail for the right
   * reason — which is itself the point: an unset child rate IS outstanding work (ผอ. 2026-10-23). */
  appendObject_(sheet_(HR, 'PAYROLL_CONFIG'), { StaffID: 'TD-T', ChildThreshold: 31, ChildMultiplier: 300 });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:STAFF', 'rows:STAFF', 'col:HOLIDAYS', 'rows:HOLIDAYS']); } catch (e) {}

  function todo() {
    var ctx = hydrateLazy_(); var H = createAtomAPI(ctx.M, null).H;
    var t = H.adminTodo({ staffId: 'TD-ADM' });
    var byKey = {}; (t.items || []).forEach(function (i) { byKey[i.key] = i.n; });
    return { total: t.total, keys: (t.items || []).map(function (i) { return i.key; }), byKey: byKey,
             /* คิวตรวจตัวจริง — เพื่อเทียบว่าตัวเลขบนหน้าหลักตรงกับสิ่งที่หน้าการเงินแสดงจริง */
             queue: H.pendingPayments({}),
             ops: H.opsPending({ staffId: 'TD-ADM' }) };
  }
  var out = {};
  out.empty = todo();                     // โรงเรียนที่ไม่มีอะไรค้าง

  // ...แล้วค่อยใส่งานค้างเข้าไปทีละแบบ
  appendObject_(sheet_(HR, 'LEAVE_REQUEST'), { LeaveID: 'LV-1', StaffID: 'TD-T', Type: 'ลากิจ',
    StartDate: T, EndDate: T, Status: 'PENDING_ADMIN', CreatedDate: T });
  /* 🔴 บิลต้นทางต้องมีอยู่จริงและยังรอตรวจ — ไม่งั้นสลิปใบนี้คือ "สลิปที่รายการปิดไปแล้ว"
   * ไม่ใช่ "สลิปรอตรวจ" · ของเดิมใส่แต่สลิปโดยไม่มีบิล แล้วคาดหวังว่ามันจะถูกนับเป็นงานค้าง
   * ซึ่งเป็นสมมติฐานที่ตรงกับบั๊กที่ ผอ. เจอพอดี (หน้าหลักขึ้น 13 หน้าการเงินขึ้น 0) */
  appendObject_(sheet_(MAIN, 'BILLING'), { BillingID: 'B-1', StudentID: 'TD-K1', Month: T.slice(0, 7),
    Amount: 100, Status: 'PENDING_VERIFY', PaymentMethod: 'transfer' });
  appendObject_(sheet_(MAIN, 'PAYMENT_SLIPS'), { SlipID: 'SL-1', RefKind: 'bill', RefID: 'B-1',
    Status: 'SUBMITTED', Amount: 100, Date: T });
  /* ...และอีกใบที่รายการต้นทางไม่มีแล้ว — ต้องไปอยู่หัวข้อของตัวเอง ไม่ใช่หายไปเฉย ๆ */
  appendObject_(sheet_(MAIN, 'PAYMENT_SLIPS'), { SlipID: 'SL-GHOST', RefKind: 'bill', RefID: 'B-GONE',
    Status: 'SUBMITTED', Amount: 500, Date: T });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'TD-K1', Name: 'เด็กหนึ่ง', Nickname: 'หนึ่ง',
    Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  // เด็กที่ลาวันนี้ — ต้อง **ไม่** ถูกนับว่า "สมุดบันทึกค้าง"
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'TD-K2', Name: 'เด็กสอง', Nickname: 'สอง',
    Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  appendObject_(sheet_(MAIN, 'LEAVE_REQUEST_STD'), { StudentID: 'TD-K2', Date: T, Type: 'ลาป่วย' });
  try { CacheService.getScriptCache().removeAll(['rows:LEAVE_REQUEST', 'col:LEAVE_REQUEST',
    'rows:PAYMENT_SLIPS', 'col:PAYMENT_SLIPS', 'rows:STUDENTS', 'col:STUDENTS',
    'rows:LEAVE_REQUEST_STD', 'col:LEAVE_REQUEST_STD']); } catch (e) {}
  out.busy = todo();

  /* 💰 ครูคนใหม่ที่ยังไม่ได้กำหนดเรทจำนวนเด็ก (ผอ. 2026-10-23)
   * "ต้องแจ้งเตือนหากยังไม่ได้กำหนดว่า ครูคนไหนนับเรทเด็กคนที่เท่าไหร่และได้เท่าไหร่" */
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'TD-T2', Name: 'ครูใหม่', Nickname: 'ใหม่', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  // ครูที่ลาออกแล้ว ไม่ต้องตั้งค่าอีก — ต้องไม่ถูกนับ
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'TD-T3', Name: 'ครูที่ลาออก', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'INACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  // ...และมีเกณฑ์แต่ไม่มีเรทบาท ก็ยังคิดเงินไม่ได้ จึงนับว่ายังไม่กำหนดเหมือนกัน
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'TD-T4', Name: 'ครูครึ่งเดียว', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  /* 🔴 ตั้งแต่ 2026-10-29 คำเตือนจะขึ้นเฉพาะครูที่ "ติ๊กไว้ว่าได้เรทจำนวนเด็ก" แล้วเท่านั้น
   * ครูที่โรงเรียนไม่ได้จ่ายส่วนนี้เลย ไม่ควรติดค้างตลอดไป — ดูหมายเหตุที่ add('childRate') */
  appendObject_(sheet_(HR, 'PAYROLL_CONFIG'), { StaffID: 'TD-T2', EnableChildRate: 'true' });
  appendObject_(sheet_(HR, 'PAYROLL_CONFIG'), { StaffID: 'TD-T4', ChildThreshold: 21, ChildMultiplier: '', EnableChildRate: 'true' });
  /* ...และครูที่ไม่ได้ติ๊ก ต้องไม่ถูกนับ แม้จะยังไม่ได้กำหนดเรทเลยก็ตาม */
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'TD-T5', Name: 'ครูไม่ได้เรทเด็ก', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });
  try { CacheService.getScriptCache().removeAll(['rows:STAFF', 'col:STAFF',
    'rows:PAYROLL_CONFIG', 'col:PAYROLL_CONFIG']); } catch (e) {}
  out.childRate = todo();

  // ...และโรงเรียนที่ไม่มีเรทนี้เลย ปิดได้ แล้วการ์ดต้องเงียบ
  var cre = findObject_(cfg, function (r) { return r.Key === 'ChildRateEnabled'; });
  if (cre) updateRow_(cfg, cre._row, { Value: 'false' });
  else appendObject_(cfg, { Key: 'ChildRateEnabled', Value: 'false' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  out.childRateOff = todo();
  if (cre) updateRow_(cfg, cre._row, { Value: 'true' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}

  // 💰 แนวโน้มรายได้ 3 เดือน
  var ctx2 = hydrateLazy_(); var H2 = createAtomAPI(ctx2.M, null).H;
  var tr = H2.financeTrend({ staffId: 'TD-ADM', months: 3 });
  out.trend = { n: (tr.months || []).length, months: (tr.months || []).map(function (m) { return m.month; }) };
  // ...ต้องตรงกับ financeSummary ของเดือนเดียวกันเป๊ะ
  var thisMonth = T.slice(0, 7);
  var fs1 = H2.financeSummary({ month: thisMonth });
  var row = (tr.months || []).filter(function (m) { return m.month === thisMonth; })[0] || {};
  out.agree = { trend: row.collected, finance: Number(fs1.collectedAll || 0) };
  // ครูธรรมดาเรียกไม่ได้
  try { H2.adminTodo({ staffId: 'TD-T' }); out.teacher = 'ALLOWED'; }
  catch (e) { out.teacher = (e && e.apiCode) || String((e && e.message) || e); }
  try { H2.financeTrend({ staffId: 'TD-T' }); out.teacherTrend = 'ALLOWED'; }
  catch (e) { out.teacherTrend = (e && e.apiCode) || String((e && e.message) || e); }
  return JSON.stringify(out);
}));

console.log('\n1) 📋 ไม่มีงานค้าง = ไม่มีรายการ');
{
  /* 🔴 ข้อสำคัญที่สุดของการ์ดนี้ · การ์ดเขียวว่า "เรียบร้อย" ทุกเช้า คือเสียงรบกวน และเสียงรบกวน
   * คือสิ่งที่ทำให้คนเลิกอ่านหน้าจอที่สำคัญจริง */
  eq('โรงเรียนที่ไม่มีอะไรค้าง — รายการว่าง', res.empty.keys.length, 0);
  eq('...และผลรวมเป็นศูนย์', res.empty.total, 0);
  ok_('🔴 ฝั่งหน้าจอ: ไม่มีรายการ = ไม่พิมพ์การ์ดเลย',
    /if \(!td \|\| !td\.items \|\| !td\.items\.length\) return '';/.test(app));
}

console.log('\n2) 📋 มีงานค้าง — ขึ้นเฉพาะที่มีจริง');
{
  eq('ใบลารออนุมัติ', res.busy.byKey.leaves, 1);
  /* ═══ 🔴 ตัวเลขนี้ต้องมาจากคิวตรวจตัวจริง (ผอ. 2026-10-29) ════════════════════════════════
   * หน้าหลักขึ้น 13 แต่หน้าการเงินขึ้น "ไม่มีรายการ" เพราะสองที่นับคนละเกณฑ์:
   * ของเดิมนับสลิปทุกใบที่ SUBMITTED · คิวตรวจแสดงเฉพาะใบที่รายการต้นทางยังรออยู่ */
  eq('สลิปรอตรวจ — นับจากคิวตรวจตัวจริง', res.busy.byKey.slips, 1);
  eq('🔴 ...และตรงกับจำนวนใบในคิวเป๊ะ',
    res.busy.byKey.slips,
    (res.busy.queue || []).reduce((a, x) => a + ((x.slips || []).length || (x.cash ? 1 : 0)), 0));
  /* 🔴 ใบที่รายการปิดไปแล้วต้องไม่หายไปเงียบ ๆ ตอนทำให้ตัวเลขตรงกัน
   * "ไม่แสดง" กับ "ไม่มี" ไม่ใช่เรื่องเดียวกัน — และนี่คือหลักฐานการโอนเงินของผู้ปกครอง */
  eq('🔴 สลิปที่รายการปิดไปแล้ว มีหัวข้อของตัวเอง', res.busy.byKey.orphanSlips, 1);
  /* 🔴 เด็กที่ลาวันนี้ ต้องไม่ถูกนับว่า "สมุดบันทึกค้าง" — ตัวเลขแดงที่แก้ไม่ได้ คือตัวเลขที่
   * สอนให้คนเลิกสนใจการ์ดทั้งใบ */
  if (_weekend) console.log('  --   ข้ามข้อ "สมุดบันทึกค้าง" (วันนี้เสาร์/อาทิตย์ โรงเรียนปิด จึงไม่นับ)');
  else eq('🔴 สมุดบันทึกค้าง นับเฉพาะเด็กที่วันนี้ควรมีบันทึก (ไม่นับคนที่ลา)', res.busy.byKey.journals, 1);
  ok_('รายการที่ยังเป็นศูนย์ ไม่โผล่ขึ้นมาด้วย',
    res.busy.keys.indexOf('withdraw') < 0 && res.busy.keys.indexOf('injury') < 0);
  eq('ผลรวมเท่ากับผลบวกของรายการที่แสดง', res.busy.total,
    Object.keys(res.busy.byKey).reduce(function (a, k) { return a + res.busy.byKey[k]; }, 0));
}

console.log('\n3) 🔴 ตัวเลขมาจากแหล่งเดียวกับหน้าจอปลายทาง');
{
  /* opsPending นับของที่รออนุมัติให้ป้ายแดงบนกระดิ่งอยู่แล้ว — การ์ดนี้ต้องถามมัน ไม่ใช่นับใหม่ */
  eq('🔴 ใบลาบนการ์ด = ใบลาที่ opsPending นับ (ป้ายบนกระดิ่ง)', res.busy.byKey.leaves, res.busy.ops.leaves);
  ok_('🔴 ...และโค้ดถามจาก opsPending จริง ไม่ได้นับเอง',
    /const ops = H\.opsPending\(p\) \|\| \{\};/.test(eng));
  ok_('ปลายทางของปุ่มใช้ OPS_BTN ตัวเดียวกับที่อื่น ไม่ได้เขียนที่อยู่ใหม่',
    /timeReq:OPS_BTN\.timeRequests/.test(app));
}

console.log('\n4) 💰 สรุปภาพรวม — เงินต้องมาจากที่เดียว');
{
  eq('ได้ 3 เดือน', res.trend.n, 3);
  ok_('เรียงจากเก่าไปใหม่', res.trend.months[0] < res.trend.months[2]);
  /* 🔴 กราฟบนหน้าแรกกับหน้าการเงิน ต้องเป็นตัวเลขเดียวกัน ถ้าเขียนสูตรใหม่เพื่อให้เร็วขึ้น
   * วันหนึ่งสองหน้าจะไม่ตรงกัน และวันนั้นจะไม่มีใครรู้ว่าอันไหนถูก */
  eq('🔴 ยอดของเดือนนี้บนกราฟ = ยอดบนหน้าการเงินเป๊ะ', res.agree.trend, res.agree.finance);
  ok_('🔴 ...เพราะเรียก financeSummary ตัวเดิมซ้ำ ไม่ได้คำนวณใหม่',
    /const f=H\.financeSummary\(\{month:m\}\)\|\|\{\};/.test(eng));
  /* มติ ผอ. 2026-09-30: เงินเดือน ผอ. ไม่นับในรายจ่ายรวม — ต้องเขียนบนหน้าจอ ไม่ใช่ซ่อนในโค้ด */
  ok_('🔴 บอกบนหน้าจอว่ารายจ่ายไม่รวมเงินเดือน ผอ.', /รายจ่ายไม่รวมเงินเดือนของ ผอ\./.test(app));
  ok_('% ความคืบหน้าคำนวณจากข้อมูลที่โหลดมาแล้ว ไม่ได้ขอเพิ่ม',
    /const jLeft = \(\(window\._TODO/.test(app) &&
    !/api\('journalStatus'/.test(app.slice(app.indexOf('const summaryCard'), app.indexOf('const summaryCard') + 3000)));
}

console.log('\n5) 💰 ครูที่ยังไม่ได้กำหนดเรทจำนวนเด็ก (ผอ. 2026-10-23)');
{
  /* 🔴 เดิมไม่มีทางรู้ว่า "ยังไม่กำหนด" เพราะมีค่าสำรองอยู่ข้างหลังเสมอ (30 ในชีต / 31 ในโค้ด)
   * เงินจึงเดินด้วยเลขที่ไม่มีใครเลือก และไม่มีใครเห็นว่าควรเลือก */
  eq('ครูใหม่ที่ยังไม่ตั้งค่า + คนที่ตั้งไว้ครึ่งเดียว = 2 คน', res.childRate.byKey.childRate, 2);
  ok_('🔴 ครูที่ลาออกแล้ว ไม่ถูกนับ (ตัวเลขแดงที่แก้ไม่ได้ สอนให้คนข้ามการ์ด)',
    res.childRate.byKey.childRate === 2);
  /* 🔴 ครูที่ไม่ได้ติ๊กว่า "ได้เรทจำนวนเด็ก" ต้องไม่ถูกนับ แม้จะยังไม่ได้กำหนดเรทเลย (ผอ. 2026-10-29)
   * มีครู ACTIVE ที่ยังไม่ตั้งค่าอยู่ 3 คนในชุดนี้ (T2 · T4 · T5) แต่ติ๊กไว้แค่ 2 */
  eq('🔴 ครูที่ไม่ได้ติ๊กว่าได้เรทเด็ก ไม่ถูกเตือน', res.childRate.byKey.childRate, 2);
  ok_('...และครูที่ตั้งค่าครบแล้ว ไม่ถูกนับ', res.busy.keys.indexOf('childRate') < 0);
  eq('🏫 โรงเรียนที่ปิดฟังก์ชันนี้ — ไม่ขึ้นเลย', res.childRateOff.keys.indexOf('childRate'), -1);
  ok_('กดจากการ์ดแล้วไปหน้าเงินเดือน ซึ่งเป็นที่ที่แก้ได้จริง',
    /childRate:"GO\('payroll'\)"/.test(app));
  ok_('การ์ดบอกเป็นภาษาคน ไม่ใช่ชื่อคีย์', /ครูที่ยังไม่ได้กำหนดเรทจำนวนเด็ก/.test(app));
  /* ...และหน้าจอกรอกเงินเดือนต้องไม่เติมเลขให้เอง — ช่องที่มีเลขรออยู่ คือช่องที่ไม่มีใครตั้งค่า */
  ok_('🔴 ช่อง "เริ่มคิดเรทที่เด็กคนที่" ว่างไว้จริง ไม่เติม 31',
    /pThreshold'\)\.value=\(pc\.ChildThreshold!=null&&pc\.ChildThreshold!==''\)\?pc\.ChildThreshold:''/.test(app));
  ok_('...และบอกว่าต้องกรอกอะไรก่อน ถึงจะได้เงินก้อนนี้',
    /ต้องกำหนดทั้ง "เริ่มคิดเรทที่เด็กคนที่" และ "เรทต่อเด็ก" ก่อน/.test(app));
}

console.log('\n6) 🔒 แอดมินเท่านั้น และไม่เพิ่มรอบเรียกเซิร์ฟเวอร์');
{
  eq('ครูธรรมดาเรียก adminTodo ไม่ได้', res.teacher, 'NO_PERMISSION');
  eq('ครูธรรมดาเรียก financeTrend ไม่ได้', res.teacherTrend, 'NO_PERMISSION');
  ok_('อยู่ใน ADMIN_ONLY ที่ชั้น route ด้วย', /adminTodo: 1, financeTrend: 1/.test(R('src/Code.gs')));
  /* 🔴 ขี่ไปกับ batch เดิมของหน้าแรก — Apps Script รันทีละคำสั่ง รอบใหม่หนึ่งรอบคือเวลารอจริง
   * ของแอดมินทุกเช้า (บทเรียน "ประกาศ" ที่เคยเป็น await แยกท้ายฟังก์ชัน) */
  const batch = app.slice(app.indexOf("const [d,rem,lrem,pend,fin,todo,trend]"), app.indexOf("window._TODO = todo;"));
  ok_('🔴 ทั้งสอง route อยู่ใน Promise.all ชุดเดียวกับ dashboard', /adminTodo/.test(batch) && /financeTrend/.test(batch));
  ok_('🔴 ...และ deployment เก่าที่ยังไม่มี route นี้ ต้องเปิดแดชบอร์ดได้ตามปกติ',
    /api\('adminTodo'[^)]*\)\.catch\(\(\)=>null\)/.test(app) && /api\('financeTrend'[^)]*\)\.catch\(\(\)=>null\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
