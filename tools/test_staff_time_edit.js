/**
 * tools/test_staff_time_edit.js — correcting a staff clock time that was wrong.
 *   node tools/test_staff_time_edit.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ., 2026-10-20: "ระบบของเรามีฟังก์ชันไหนในการแก้เวลาพนักงานบ้าง หากลงเวลาผิด ที่ไม่ใช่คำขอลงเวลา
 * เหมือนฟังก์ชันของนักเรียนเวลาผู้ปกครองกดผิด".
 *
 * The answer was NONE, and the asymmetry was stark:
 *
 *   👶 a child    parent taps รับกลับ by mistake → any teacher covering the class fixes it in ten
 *                 seconds · times set OR CLEARED · OT recomputed · who and why recorded
 *   👩‍🏫 a teacher  คำขอลงเวลา, two approvals — and arApply_ can only ever WRITE a time
 *
 * So: a clock-in on a day somebody did not work could be removed by nobody; a second tap was
 * refused (ALREADY_CHECKED_IN) which froze the wrong time the instant it was made; and nobody could
 * file on behalf of a teacher who had left or could not open the app. The only repair left was
 * editing the Google Sheet by hand — which records nothing about who changed it.
 *
 * 🔴 AND THIS IS MONEY. LateMinutes feeds เบี้ยขยัน; OTHours feeds the payslip. Which is why the
 * school's answer was admin-only, a reason required, and the person told every single time.
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
const app = R('webapp/app.js'), code = R('src/Code.gs'), att = R('src/AttReq.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun', 'AttReq',
                    'GasEngine', 'Engine', 'Day6']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var HR = getHrSpreadsheet_(), stSh = sheet_(HR, 'STAFF');
  function days(n) { var d = new Date(); d.setDate(d.getDate() + n); return dateStr_(d); }
  var YDAY = days(-1), TOMORROW = days(1);

  appendObject_(stSh, { StaffID: 'TE-ADM', Name: 'แอดมิน', Nickname: 'แอด', Role: 'Admin',
    PositionLevel: 'Admin', Status: 'ACTIVE', Department: '*', StartDate: '2025-01-01' });
  appendObject_(stSh, { StaffID: 'TE-TCH', Name: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01',
    LineUID: 'U-TE-TCH', RequireCheckin: true, StaffGroup: 'ATMG-01' });
  appendObject_(stSh, { StaffID: 'TE-OTH', Name: 'ครูบี', Nickname: 'บี', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: '2025-01-01' });

  /* 🔴 THE DATE IS A Date OBJECT, BECAUSE THAT IS WHAT LIVE HAS.
   *
   * Sheets turns a "2026-10-20" string into a DATE CELL on write, so it reads back as a Date. Every
   * fixture in this repo writes the string, so a date comparison written as String(r.Date).slice()
   * passes in all 184 suites and fails on the only machine that matters — which is exactly what
   * happened on 2026-10-20: each correction appended a SECOND row and every screen kept reading the
   * first. This row is the real shape on purpose. */
  var ci = sheet_(HR, 'CHECKIN_STAFF');
  appendObject_(ci, { Date: new Date(YDAY + 'T00:00:00'), StaffID: 'TE-TCH', CheckIn: '08:40', CheckOut: '12:05',
    LateMinutes: 25, OTHours: 0, Status: 'OUT' });
  // ...and a day they clocked in on by accident and never worked
  appendObject_(ci, { Date: days(-2), StaffID: 'TE-TCH', CheckIn: '07:58', CheckOut: '',
    LateMinutes: 0, OTHours: '', Status: 'IN' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'rows:CHECKIN_STAFF', 'col:CHECKIN_STAFF', 'col:STAFF']); } catch (e) {}

  function call(p) {
    try { return { ok: true, r: handleEditStaffAttendance(p) }; }
    catch (e) { return { ok: false, code: (e && e.apiCode) || String((e && e.message) || e) }; }
  }
  var out = {};
  out.teacher = call({ staffId: 'TE-OTH', targetId: 'TE-TCH', date: YDAY, checkOut: '17:30', remark: 'x' });
  out.noReason = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: YDAY, checkOut: '17:30' });
  out.future  = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: TOMORROW, checkIn: '08:00', remark: 'x' });
  out.badTime = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: YDAY, checkOut: '5pm', remark: 'x' });
  out.nobody  = call({ staffId: 'TE-ADM', targetId: 'NOPE', date: YDAY, checkOut: '17:30', remark: 'x' });

  // the real correction: she actually left at 17:30
  out.fix = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: YDAY, checkIn: '08:05', checkOut: '17:30',
    remark: 'ลืมลงเวลาออก กลับจริง 17:30' });
  /* read back with the SAME predicate the handler uses, and count the rows — "the sheet now has the
   * right time" is only half the claim; "it did not write a second row to put it in" is the other */
  var allY = arDayRows_(sheet_(HR, 'CHECKIN_STAFF'), 'TE-TCH', YDAY);
  out.rowCount = allY.length;
  var rowAfter = allY[0] || {};
  out.row = { checkIn: toHHmm_(rowAfter.CheckIn), checkOut: toHHmm_(rowAfter.CheckOut),
    late: Number(rowAfter.LateMinutes || 0), ot: Number(rowAfter.OTHours || 0),
    inManual: String(rowAfter.InManual || ''), editedBy: String(rowAfter.EditedBy || ''),
    note: String(rowAfter.EditNote || ''), hasWhen: !!String(rowAfter.EditedAt || '') };

  // and the day she never worked: both blank removes it
  out.wipe = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: days(-2), checkIn: '', checkOut: '',
    remark: 'กดลงเวลาผิดวัน' });
  out.gone = !findObject_(sheet_(HR, 'CHECKIN_STAFF'), function (r) {
    return String(r.StaffID) === 'TE-TCH' && String(r.Date).slice(0, 10) === days(-2); });

  // ...and a day with no row at all can be filled in (a teacher who could not open the app)
  out.create = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: days(-3), checkIn: '08:00', checkOut: '17:00',
    remark: 'มือถือเสีย ลงเวลาให้' });

  /* 🔴 WHAT "RECOMPUTED" MEANS, asked of the school's own rule rather than written down here as a
   * number. staffDayHours_ is what a real clock-in on that day would have been judged against; a
   * fixture that hard-codes 5 would keep passing if the school changed its grace period and the
   * correction quietly stopped agreeing with the clock. */
  var hrs = staffDayHours_('TE-TCH', new Date(YDAY + 'T00:00:00'));
  out.expectLate = Math.max(0, hhmmToMin_('08:05') - (hhmmToMin_(hrs.checkIn || '08:00') + hrs.grace));
  // ...and it must not be the stale figure that was sitting in the row before the edit
  out.staleLate = 25;
  out.isWrite = isMutatingAction_('editStaffAttendance');

  /* 🔴 ...AND THE DAYS ALREADY DUPLICATED BY THE BUG MUST HEAL THEMSELVES. A fix that only stops
   * making new duplicates leaves the school reading the stale copy of every day it already broke. */
  var D = days(-6);
  appendObject_(ci, { Date: new Date(D + 'T00:00:00'), StaffID: 'TE-TCH', CheckIn: '08:00', CheckOut: '17:00', Status: 'OUT' });
  appendObject_(ci, { Date: D, StaffID: 'TE-TCH', CheckIn: '08:00', CheckOut: '12:00', Status: 'OUT' });   // the duplicate
  appendObject_(ci, { Date: D, StaffID: 'TE-TCH', CheckIn: '08:00', CheckOut: '13:00', Status: 'OUT' });   // ...and another
  out.dupBefore = arDayRows_(ci, 'TE-TCH', D).length;
  out.dupFix = call({ staffId: 'TE-ADM', targetId: 'TE-TCH', date: D, checkIn: '08:00', checkOut: '17:30', remark: 'รวมแถวซ้ำ' });
  var left = arDayRows_(ci, 'TE-TCH', D);
  out.dupAfter = left.length;
  out.dupOut = left.length ? toHHmm_(left[0].CheckOut) : '';
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 ใครแก้ได้ และแก้อะไรไม่ได้');
{
  eq('ครูธรรมดาแก้เวลาคนอื่นไม่ได้', res.teacher.code, 'NO_PERMISSION');
  /* 🔴 THE REASON IS NOT OPTIONAL. These fields decide somebody's pay; a change with no sentence
   * attached is exactly what editing the sheet by hand already allowed. */
  eq('🔴 ไม่ใส่เหตุผล = ไม่ให้บันทึก', res.noReason.code, 'NEED_REASON');
  eq('🔴 แก้เวลาของวันที่ยังมาไม่ถึงไม่ได้', res.future.code, 'FUTURE_DATE');
  eq('เวลาผิดรูปแบบ ไม่เดาให้', res.badTime.code, 'BAD_TIME');
  eq('ไม่พบพนักงาน', res.nobody.code, 'NOT_FOUND');
}

console.log('\n2) ✏️ แก้แล้วคำนวณสาย/OT ใหม่ ไม่ใช่ปล่อยตัวเลขเดิมค้าง');
{
  eq('บันทึกสำเร็จ', res.fix.ok, true);
  eq('เวลาเข้า', res.row.checkIn, '08:05');
  eq('เวลาออก', res.row.checkOut, '17:30');
  /* 🔴 THE NUMBERS THAT FOLLOW THE TIME. 08:40 was 25 minutes late; 08:05 is not. Leaving the old
   * LateMinutes standing beside a corrected time would be a worse lie than the typo — the row would
   * look right and the payslip would still be wrong. */
  eq('🔴 นาทีสายคำนวณใหม่จาก 08:05 ตามกติกาของวันนั้น', res.row.late, res.expectLate);
  ok_('🔴 ...และไม่ใช่ตัวเลขเดิมที่ค้างอยู่ในแถว (25 นาที จาก 08:40)', res.row.late !== res.staleLate);
  eq('🔴 OT คำนวณใหม่จาก 17:30', res.row.ot, 0);
  eq('ติดธงว่าเป็นเวลาที่คนกรอก (✍️ บนปฏิทิน)', res.row.inManual, 'YES');
  /* 🔴 WHO, WHEN, WHY — on the row itself. The request route keeps its two signatures in
   * ATTENDANCE_REQUEST; this one writes straight into attendance, so the trail has to live here or
   * it does not exist at all. That absence is what made "fix it in the sheet" unacceptable. */
  eq('🔴 บันทึกว่าใครแก้', res.row.editedBy, 'แอดมิน');
  eq('🔴 ...และเหตุผล', res.row.note, 'ลืมลงเวลาออก กลับจริง 17:30');
  eq('🔴 ...และแก้เมื่อไหร่', res.row.hasWhen, true);
}

console.log('\n3) 🔴 วันที่ในชีตเป็น Date object — ต้องเจอแถวเดิม ไม่ใช่เพิ่มแถวใหม่');
{
  /* 🔴 THE BUG THE ผอ. CAUGHT ON 2026-10-20. The notification gave it away: it read
   * "เข้างาน — → 07:57", so the handler had found NO previous row on a day that plainly had one.
   * String(DateObject).slice(0,10) is "Tue Oct 2", which matches nothing — so every save appended a
   * SECOND row, and every reader takes the first. ✅ บันทึกแล้ว, and nothing on screen moved. */
  eq('🔴 ไม่ได้เพิ่มแถวใหม่ — ยังมีแถวเดียวของวันนั้น', res.rowCount, 1);
  eq('🔴 ...และระบบอ่านค่าเดิมเจอ (ไม่ใช่ "—")', res.fix.ok && res.fix.r.before.checkOut, '12:05');
  eq('วันที่เคยมีแถวซ้ำอยู่แล้ว (จากบั๊กเดิม) — ตั้งต้น', res.dupBefore, 3);
  eq('🔴 แก้ครั้งเดียว รวมแถวซ้ำให้เหลือแถวเดียว', res.dupAfter, 1);
  eq('🔴 ...และแถวที่เหลือคือแถวที่แก้แล้ว', res.dupOut, '17:30');
  eq('รายงานกลับว่ารวมแถวซ้ำไปกี่แถว', res.dupFix.ok && res.dupFix.r.healed, 2);
  /* one definition of "this person, this day", used by the writer and by the repair — and the same
   * answer handleStaffCheckin has always given with dateStr_(new Date(r.Date)) */
  ok_('🔴 เทียบวันด้วยตัวเดียวกันทั้งไฟล์ ไม่ใช่ slice สตริง',
    /function arSameDay_/.test(att) && !/String\(r\.Date\)\.slice\(0, 10\) === date/.test(att));
}

console.log('\n4) 🚫 ล้างทั้งวัน — สิ่งที่คำขอลงเวลาทำไม่ได้เลย');
{
  eq('ล้างทั้งสองช่องสำเร็จ', res.wipe.ok && res.wipe.r.removed, true);
  eq('🔴 แถวนั้นหายไปจริง (ไม่ใช่เหลือแถวว่าง = มาทำงาน)', res.gone, true);
  eq('วันที่ยังไม่มีแถว กรอกให้ใหม่ได้', res.create.ok, true);
  eq('...และได้ค่าตามที่กรอก', res.create.ok && res.create.r.checkOut, '17:00');
}

console.log('\n5) 🔔 เจ้าตัวต้องรู้ทุกครั้ง และหน้าจออยู่ตรงที่แอดมินเห็นปัญหา');
{
  /* 🔴 A SILENT CORRECTION IS INDISTINGUISHABLE FROM A BUG. Somebody else changed a number that
   * decides their เบี้ยขยัน and their OT; if nobody tells them, they find out from the payslip,
   * which is the worst possible place to discover it. The message carries the OLD time too —
   * "เข้างาน 08:30" alone is not something anyone can check. */
  ok_('🔴 แจ้งเจ้าตัวทุกครั้ง', /function editStaffAttendanceNotify_/.test(att) && /notifyStaffMember_\(target\.StaffID/.test(att));
  ok_('🔴 ...และบอกเวลาเดิม → เวลาใหม่', /fmt\(before\.checkIn\) \+ ' → ' \+ fmt\(after\.checkIn\)/.test(att));
  ok_('การแจ้งเตือนล้มเหลว ต้องไม่ทำให้การแก้ไขล้มเหลว', /editStaffAttendanceNotify_ failed/.test(att));
  ok_('แอดมินก็เห็นในกล่องข้อความด้วย', /notifyAdmins_\(msg\)/.test(att));

  ok_('เป็นสิทธิ์แอดมินเท่านั้นที่ชั้น route ด้วย', /editStaffAttendance: 1/.test(code));
  /* 🔴 IT WRITES, SO IT TAKES THE WRITE LOCK. `edit` is in MUTATING_RE on both sides — the same
   * check that backfillConfig failed in v450, when a write slipped through with no lock at all. */
  // asked of the function the dispatcher actually calls, not of the regex's source text
  eq('🔴 ระบบถือว่าเป็นการเขียน (ได้ write lock + ล้าง cache)', res.isWrite, true);
  ok_('ไม่ได้อยู่ในรายการ read-only', !/editStaffAttendance/.test(String((code.match(/READ_ONLY_ACTIONS_[\s\S]{0,600}?\};/) || [])[0] || '')));

  // the cell the admin is already looking at when they spot the wrong time IS the button
  ok_('แตะที่วันบนปฏิทินเพื่อแก้ได้เลย', /onclick="A_editStaffTime\(/.test(app));
  ok_('🔴 ...เฉพาะ Admin และไม่ใช่วันในอนาคต',
    /const mayEdit = USER && USER\.role==='Admin' && r\.status!=='FUTURE';/.test(app));
  ok_('ฟอร์มบังคับใส่เหตุผลก่อนส่ง', /if \(!why\) \{ toast/.test(app));
  ok_('มีปุ่มล้างทั้งวันสำหรับกรณีกดผิด', /ล้างทั้งวัน \(กดลงเวลาผิด\)/.test(app));
  /* totals moved too, so the screen is rebuilt rather than the one cell patched — a calendar
   * showing a new time beside yesterday's month totals is a half-true screen, and those get
   * believed */
  ok_('บันทึกแล้วโหลดเดือนใหม่ ไม่ได้แก้แค่ช่องเดียว', /await A_staffMonth\(\);\s*\n\s*A_staffMonthOne\(sid\);/.test(app));
  /* 🔴 REPORTED ON THE DAY IT SHIPPED (v458): "กดบันทึก > เวลาไม่เปลี่ยน". The server had stored it
   * correctly — verified through the real dispatcher. `modal()` APPENDS rather than replaces, so
   * three were stacked by the time Save was pressed, and removing only the form left the person's
   * calendar underneath STILL SHOWING THE OLD TIME. The admin closed the fresh one, landed on the
   * stale one, and read it as a write that had not happened.
   *
   * A stale copy of a screen left underneath a fresh one is indistinguishable from a failed save. */
  ok_('🔴 ปิดทุกหน้าต่างที่ค้างอยู่ก่อนวาดใหม่ (ไม่เหลือหน้าจอเก่าที่ยังโชว์เวลาเดิม)',
    /document\.querySelectorAll\('\.modal'\)\.forEach\(x => x\.remove\(\)\);/.test(app));
  /* ...and the toast states what the SERVER stored, not what was typed — so it stays a true
   * statement about the sheet even if the redraw after it fails. */
  ok_('🔴 ข้อความยืนยันบอกเวลาที่บันทึกจริง (อ่านจากคำตอบของเซิร์ฟเวอร์)',
    /\$\{res\.checkIn \|\| '—'\}–\$\{res\.checkOut \|\| '—'\}/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
