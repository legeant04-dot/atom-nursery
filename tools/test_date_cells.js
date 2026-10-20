/**
 * tools/test_date_cells.js — a date column read from a sheet is a Date OBJECT.
 *   node tools/test_date_cells.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE TRAP, AND WHY IT SURVIVED 184 SUITES
 *
 * readObjects_ returns RAW cell values. Sheets converts a "2026-10-20" string into a DATE CELL on
 * write, so it reads back as a Date — and `String(thatDate).slice(0, 10)` is "Tue Oct 2". It equals
 * nothing and matches no /^\d{4}-\d{2}-\d{2}$/.
 *
 * Every fixture in this repo writes a 'YYYY-MM-DD' STRING. A Date object had never once appeared in
 * a test, so a string-slice comparison passed everywhere and failed on the only machine that
 * matters. This file writes real Date objects on purpose. That is the whole point of it.
 *
 * WHAT IT HAS ALREADY COST:
 *   · the LINE usage report counted ZERO for every line — the school would have concluded the free
 *     plan was ample (fixed in place with a local copy of the coercion inside one handler)
 *   · an admin's attendance correction appended a SECOND row instead of updating the first, so the
 *     app said ✅ บันทึกแล้ว and the calendar, the teacher's screen and the sheet all kept the old
 *     time (ผอ., 2026-10-20) — see tools/test_staff_time_edit.js §3
 *   · and every guard written the same way: the regex fails, the guard concludes there is no date,
 *     and it never fires.
 *
 * 🔴 A GUARD THAT NEVER FIRES IS INDISTINGUISHABLE FROM A GUARD THAT PASSED. The four below decide
 * whether somebody who has left can still sign in, whether they can still clock in, whether a child
 * on leave can be marked present, and whether a paused salary is paused. All four were dead on any
 * row whose date cell Sheets had converted.
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
                    'GasEngine', 'Engine', 'Day6']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  function days(n) { var d = new Date(); d.setDate(d.getDate() + n); return dateStr_(d); }
  function D(s) { return new Date(s + 'T00:00:00'); }        // ← the shape live actually has
  var out = {};

  // ── the coercion itself ───────────────────────────────────────────────────────────────────────
  out.cell = {
    fromDate:   ymdCell_(D('2026-10-20')),
    fromString: ymdCell_('2026-10-20'),
    fromStamp:  ymdCell_('2026-10-20 08:05:00'),
    fromBlank:  ymdCell_(''),
    fromNull:   ymdCell_(null),
    fromJunk:   ymdCell_('ไม่ใช่วันที่')
  };
  // 🔴 and what the OLD code did with the same cell — kept as the control, so the suite says out
  // loud what it is protecting against rather than only asserting the new answer
  out.oldWay = String(D('2026-10-20')).slice(0, 10);

  var stSh = sheet_(HR, 'STAFF');
  appendObject_(stSh, { StaffID: 'DC-GONE', Name: 'ครูที่ออกแล้ว', Nickname: 'ออก', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', LineUID: 'U-DC-GONE',
    RequireCheckin: true, StartDate: D('2025-01-01'), EndDate: D(days(-3)) });
  appendObject_(stSh, { StaffID: 'DC-SOON', Name: 'ครูที่ยังไม่เริ่ม', Nickname: 'ใหม่', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', LineUID: 'U-DC-SOON',
    RequireCheckin: true, StartDate: D(days(10)) });
  appendObject_(stSh, { StaffID: 'DC-PAUSE', Name: 'ครูลาชั่วคราว', Nickname: 'พัก', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', LineUID: 'U-DC-PAUSE',
    RequireCheckin: true, StartDate: D('2025-01-01'), PauseFrom: D(days(-5)), PauseTo: D(days(30)),
    PauseSalaryMode: 'NONE', BaseSalary: 15000 });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:STAFF', 'rows:STAFF']); } catch (e) {}

  function code(fn) { try { fn(); return 'ALLOWED'; } catch (e) { return (e && e.apiCode) || String((e && e.message) || e); } }
  var gone  = findObject_(stSh, function (s) { return s.StaffID === 'DC-GONE'; });
  var soon  = findObject_(stSh, function (s) { return s.StaffID === 'DC-SOON'; });
  var paus  = findObject_(stSh, function (s) { return s.StaffID === 'DC-PAUSE'; });

  // ① the clock-in gate
  out.clock = { gone: code(function () { assertStaffStarted_(gone); }),
                soon: code(function () { assertStaffStarted_(soon); }),
                paused: code(function () { assertStaffStarted_(paus); }) };

  // ② every request from a non-admin session (applyIdentity_)
  var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
  var rq = findObject_(cfg, function (r) { return r.Key === 'RequireSessionToken'; });
  if (rq) updateRow_(cfg, rq._row, { Value: 'true' }); else appendObject_(cfg, { Key: 'RequireSessionToken', Value: 'true' });
  _configCache = null; try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
  out.session = code(function () {
    applyIdentity_('classList', { }, { role: 'Teacher', uid: 'U-DC-GONE', linkedId: 'DC-GONE' });
  });

  // ③ a child on leave today must not be marked present by a teacher on their behalf
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'DC-KID', Name: 'เด็กลา', Nickname: 'ลา',
    Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  var lv = MAIN.getSheetByName('LEAVE_REQUEST_STD') || sheet_(MAIN, 'LEAVE_REQUEST_STD');
  appendObject_(lv, { StudentID: 'DC-KID', Date: D(dateStr_(new Date())), Type: 'ลาป่วย', Reason: 'ไข้' });
  appendObject_(stSh, { StaffID: 'DC-TCH', Name: 'ครูปกติ', Nickname: 'ปกติ', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1', StartDate: D('2025-01-01') });
  try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF', 'col:LEAVE_REQUEST_STD', 'rows:LEAVE_REQUEST_STD']); } catch (e) {}
  out.onLeave = code(function () {
    handleStaffStudentCheckin({ staffId: 'DC-TCH', studentId: 'DC-KID', type: 'IN', remark: 'คุณยายมาส่ง' });
  });

  // ④ a paused salary is actually paused (money)
  var ps = staffPauseSalaryFor_(paus, dateStr_(new Date()).slice(0, 7), 15000);
  out.pauseSalary = ps ? { mode: ps.mode, amount: ps.amount } : null;

  return JSON.stringify(out);
}));

console.log('\n1) 🔴 ymdCell_ — การแปลงค่าวันที่ที่อ่านจากชีต');
{
  eq('Date object → YYYY-MM-DD', res.cell.fromDate, '2026-10-20');
  eq('สตริงวันที่ → เหมือนเดิม', res.cell.fromString, '2026-10-20');
  eq('สตริงที่มีเวลาต่อท้าย → ตัดเหลือวัน', res.cell.fromStamp, '2026-10-20');
  eq('ช่องว่าง → ไม่ใช่วันที่', res.cell.fromBlank, '');
  eq('null → ไม่ใช่วันที่', res.cell.fromNull, '');
  eq('ข้อความที่อ่านเป็นวันไม่ได้ → ไม่ใช่วันที่ (ไม่เดา)', res.cell.fromJunk, '');
  /* 🔴 THE CONTROL — what the old line produced from the very same cell. Printed so this suite
   * states the defect, not merely the fix. */
  eq('🔴 วิธีเดิม String(cell).slice(0,10) ให้ค่านี้ออกมา', res.oldWay, 'Tue Oct 20');
  ok_('🔴 ...ซึ่งไม่มีทางผ่าน /^\\d{4}-\\d{2}-\\d{2}$/ ได้เลย', !/^\d{4}-\d{2}-\d{2}$/.test(res.oldWay));
}

console.log('\n2) 🔴 ด่านที่เคย "ไม่เคยทำงานเลย" เมื่อวันที่เป็น Date object');
{
  eq('🔴 ครูที่สิ้นสุดการทำงาน — ลงเวลาไม่ได้', res.clock.gone, 'ENDED');
  eq('🔴 ครูที่ยังไม่ถึงวันเริ่มงาน — ลงเวลาไม่ได้', res.clock.soon, 'NOT_STARTED');
  eq('🔴 ครูที่ลาชั่วคราว — ลงเวลาไม่ได้', res.clock.paused, 'STAFF_PAUSED');
  /* the door that covers every screen at once: a session token lasts 12 hours and renews itself, so
   * refusing only at sign-in is the wrong door (v315) */
  eq('🔴 ...และทุก request ของคนที่ออกไปแล้วถูกปฏิเสธ ไม่ใช่แค่ตอนล็อกอิน', res.session, 'ENDED');
  eq('🔴 เด็กที่แจ้งลาวันนี้ — คุณครูกดลงเวลาแทนไม่ได้', res.onLeave, 'ON_LEAVE');
  /* 💰 and the money one: PauseSalaryMode NONE means no salary that month. With the date unreadable
   * staffPauseSalaryFor_ returned null — "not paused" — and the full salary was paid. */
  eq('🔴 💰 ลาชั่วคราวแบบไม่รับเงินเดือน — คิดเป็นไม่จ่ายจริง', res.pauseSalary, { mode: 'NONE', amount: 0 });
}

console.log('\n3) 📐 นิยามเดียว ไม่ใช่ก๊อปปี้ไว้ทีละที่');
{
  const db = R('src/Db.gs');
  ok_('ymdCell_ อยู่ในชั้นล่างสุดที่อ่านชีต', /function ymdCell_\(v\)/.test(db));
  /* Every place that compares a RAW sheet row's date must go through it. These are the guards and
   * the money paths; the engine reads through decodeCell_ already and is not in scope here. */
  const files = ['src/AttReq.gs', 'src/Checkin.gs', 'src/Code.gs', 'src/Auth.gs', 'src/Parent.gs', 'src/Payroll.gs'];
  const stragglers = [];
  files.forEach(f => R(f).split('\n').forEach((ln, i) => {
    if (/String\((?:\(?\w+(?: &&)? ?\.?)?[\w.]*(?:Date|StartDate|EndDate|PauseFrom|PauseTo)[^)]*\)\s*\|\|\s*''\)?\)?\.slice\(0, 10\)/.test(ln)
      || /String\([\w.]*\.(?:Date|StartDate|EndDate|PauseFrom|PauseTo)\)\.slice\(0, 10\)/.test(ln)) {
      if (/^\s*\*/.test(ln)) return;                    // a line of the explanatory comment
      stragglers.push(f + ':' + (i + 1));
    }
  }));
  eq('🔴 ไม่มีที่ไหนเทียบวันที่จากชีตด้วย String(...).slice เหลืออยู่', stragglers, []);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
