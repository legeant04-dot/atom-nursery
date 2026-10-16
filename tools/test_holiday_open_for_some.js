/**
 * tools/test_holiday_open_for_some.js — a closed day that is open to SOME people has to be open to
 * them on the SCREEN too, not only in the server's opinion.
 *   node tools/test_holiday_open_for_some.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE DEFECT, REPORTED ON LIVE 2026-10-16
 *
 * The school set up a holiday OT day exactly as designed: a teacher rostered (ครูจอย, ฿600,
 * "เลี้ยงเลอา") and a child named for the day (เลอา, Nursery 2). The admin dashboard printed, in so
 * many words, "สำหรับคนกลุ่มนี้ วันนี้คือวันทำงาน — ลงเวลาเข้า-ออกได้ และนักเรียนลงเวลา/บันทึก/คิด
 * ค่าใช้จ่ายได้ตามปกติ".
 *
 * Neither of them could clock in. The parent's screen said "ไม่ต้องบันทึกส่ง-รับ" and had no button.
 *
 * BOTH SERVERS WERE ALREADY RIGHT. assertStudentDayOpen_ returns early for a named attendee and has
 * since the feature was built; handleStaffCheckin skips the closed-day refusal for a teacher with
 * holiday OT. The screens asked `closedForStudents` — which answers for the SCHOOL — and hid the
 * controls. A whole feature, correct on the server, unusable in the app.
 *
 * 🔴 THE SHAPE OF IT. A question about ONE CHILD cannot be answered by a fact about the school. The
 * teacher's own card learned that lesson once already (v259: `att.holidayOT` travels with the
 * person, because schoolDay "answers for the school, not for one teacher"). The children's half
 * never got the same treatment — openStudentIds is it.
 *
 * This suite runs the real handlers rather than reading source: the client gating is checked too,
 * but the first two sections prove the SERVER and the PAYLOAD agree, which is what the screens
 * depend on.
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

/* TODAY is made a holiday, one child is named for it, a second is not. Derived from the real clock
 * rather than written down — a fixture with a hard-coded date tests the calendar, not the feature
 * (the same trap that made the SlipOK suite rot overnight). */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var today = dateStr_(new Date());
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  appendObject_(sheet_(MAIN, 'HOLIDAYS'), { Date: today, NameTH: 'วันหยุดทดสอบ', NameEN: 'Test holiday' });
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C2', ClassName: 'Nursery 2', Capacity: 20 });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'S-IN', Name: 'เด็กที่ถูกเรียก', Nickname: 'มา',
    Class: 'Nursery 2', ParentID: 'P-IN', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'S-OUT', Name: 'เด็กที่ไม่ได้ถูกเรียก', Nickname: 'ไม่มา',
    Class: 'Nursery 2', ParentID: 'P-OUT', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01' });
  // ...and the one thing that makes opening a closed day safe: a NAME
  appendObject_(sheet_(MAIN, 'HOLIDAY_ATTEND'), { Date: today, StudentID: 'S-IN', AddedBy: 'ADM', AddedAt: '' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:HOLIDAYS', 'col:HOLIDAY_ATTEND', 'col:STUDENTS', 'col:CLASSES']); } catch (e) {}

  var out = { today: today };

  /* ── 1. THE SERVER (the live Sheets route, which is what the school runs) ──────────────────── */
  function dayOpen(sid) {
    // 🔴 a DATE, not a string: the live route calls d.getDay() on it. Passing the string threw a
    // TypeError that the catch below reported as 'ERR' — a harness that cannot reach its subject
    // must not be read as a verdict about the subject.
    try { assertStudentDayOpen_(sid, new Date()); return 'ALLOWED'; }
    catch (e) { return (e && e.apiCode) || 'ERR'; }
  }
  out.routeNamed = dayOpen('S-IN');
  out.routeNotNamed = dayOpen('S-OUT');

  /* ── 2. THE PAYLOAD the screens are given ─────────────────────────────────────────────────── */
  var ctx = hydrateLazy_(['students', 'staff', 'classes', 'holidays', 'holidayAttend']);
  var H = createAtomAPI(ctx.M, null).H;
  var day = H.schoolDay({});
  out.day = { closedForStudents: !!day.closedForStudents, openStudentIds: day.openStudentIds || [] };
  // ...and the engine half of the same gate, because the two must refuse the same things
  function engineOpen(sid) {
    try { H.parentCheckin({ studentId: sid, type: 'IN', parentId: 'P-IN', lat: 0, lng: 0 }); return 'ALLOWED'; }
    catch (e) { return (e && e.apiCode) || 'ERR'; }
  }
  out.engineNamed = engineOpen('S-IN');
  out.engineNotNamed = engineOpen('S-OUT');

  // an ORDINARY day must not pay for any of this: no list, and everyone expected
  var openDay = H.schoolDay({ date: '2026-10-14' });   // a Wednesday, no holiday row
  out.openDay = { closedForStudents: !!openDay.closedForStudents,
    openStudentIds: openDay.openStudentIds || [] };
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 ฝั่งเซิร์ฟเวอร์ (เส้นทางที่โรงเรียนใช้จริง) — เด็กที่ถูกเรียกชื่อ ต้องลงเวลาได้');
eq('เด็กที่ถูกเรียกชื่อไว้ → อนุญาต', res.routeNamed, 'ALLOWED');
eq('เด็กที่ไม่ได้ถูกเรียก → ปฏิเสธ (วันหยุดยังเป็นวันหยุดสำหรับคนอื่น)', res.routeNotNamed, 'SCHOOL_CLOSED');

console.log('\n2) 🔴 ...และคำตอบที่ส่งให้หน้าจอ ต้องบอกได้ว่า "ใคร"');
{
  eq('วันนี้ปิดสำหรับนักเรียน', res.day.closedForStudents, true);
  /* 🔴 THE FIELD THAT DID NOT EXIST. Without it the screens had only `closedForStudents` — a fact
   * about the school — and no way to ask about one child, so they hid the buttons from the family
   * the school had asked to come in. */
  eq('🔴 ...แต่บอกชื่อเด็กที่ยังถูกคาดหวังไว้ด้วย', res.day.openStudentIds, ['S-IN']);
  ok_('เด็กที่ไม่ได้ถูกเรียก ไม่อยู่ในรายการ', res.day.openStudentIds.indexOf('S-OUT') < 0);
}

console.log('\n3) วันธรรมดา ต้องไม่ต้องจ่ายค่าอะไรเพิ่มเลย');
{
  /* HOLIDAY_ATTEND is only read on a day that is actually shut. On an ordinary morning the answer is
   * always "every child", and putting that sheet on the home screen's critical path would cost every
   * teacher and parent a read for an answer that never changes. */
  eq('วันเปิดเรียน — ไม่ปิด', res.openDay.closedForStudents, false);
  eq('...และไม่อ่านรายชื่อเลย', res.openDay.openStudentIds, []);
}

console.log('\n4) 🔴 สองฝั่งต้องปฏิเสธเหมือนกัน (บทเรียน Phase 2.6)');
{
  /* The Sheets route is what runs today and the engine is what runs after the cutover. A gate the
   * two halves disagree about is the defect that cost three releases. */
  eq('engine — เด็กที่ถูกเรียกชื่อ ก็อนุญาตเหมือนกัน', res.engineNamed, 'ALLOWED');
  eq('engine — เด็กที่ไม่ได้ถูกเรียก ก็ปฏิเสธเหมือนกัน', res.engineNotNamed, 'SCHOOL_CLOSED');
}

console.log('\n5) 🔴 และหน้าจอต้องถามคำถามต่อ "เด็กคนนี้" ไม่ใช่ต่อ "โรงเรียน"');
{
  const app = R('webapp/app.js');
  ok_('มีตัวตอบคำถามนั้นอยู่ที่เดียว', /const _expectedToday = \(sid\) =>/.test(app));
  /* 🔴 ONE place, asked by all three screens that draw a child's check-in control. Three copies of
   * this test is how two of them end up disagreeing about whether a child may be checked in — which
   * is the whole reason schoolDayFor_ exists in the first place (the dashboard once re-derived the
   * closed day for itself and marked all 31 children ขาด). */
  const uses = (app.match(/_expectedToday\(/g) || []).length;
  ok_('...และหน้าจอที่วาดปุ่มของเด็ก เรียกใช้ตัวเดียวกันทุกที่ (' + uses + ' จุด)', uses >= 3);
  ok_('การ์ดของผู้ปกครอง', /closedForStudents && !_expectedToday\(k\.StudentID\)/.test(app));
  ok_('ปุ่มเช็คอินแทนในรายชื่อชั้นเรียนของคุณครู',
    /closedForStudents\) && !_expectedToday\(s\.StudentID\)/.test(app));
  ok_('การ์ดสมุดบันทึกของผู้ปกครอง', /_sameDay && !\(_sameDay && _expectedToday\(/.test(app));
  ok_('การ์ดการมาเรียนในแดชบอร์ด', /closedForStudents&&!\(\(day\.openStudentIds\|\|\[\]\)\.length\)/.test(app));
  /* 🔴 THE SAFE DEFAULT. If the school day is unknown the helper must behave as the app did before,
   * not throw the gate open — this decides whether a child can be recorded as present. */
  ok_('🔴 ไม่รู้สถานะของวัน → ทำเหมือนเดิม ไม่ใช่เปิดประตู',
    /if \(!d \|\| !d\.closedForStudents\) return true;/.test(app));
}

console.log('\n6) ฝั่งคุณครู — เคยแก้ด้วยวิธีเดียวกันนี้มาแล้ว');
{
  const app = R('webapp/app.js'), eng = R('webapp/engine.js'), ci = R('src/Checkin.gs');
  ok_('การ์ดลงเวลาของคุณครูยกเว้นคนที่ได้ OT วันหยุด', /day0\.closed&&!\(att&&att\.holidayOT\)/.test(app));
  ok_('...และคำตอบเดินทางมากับตัวคน ไม่ใช่มากับวัน', /holidayOT:!!_hot/.test(eng));
  ok_('เส้นทางที่รันจริงก็ยกเว้นให้เช่นกัน', /var holOT = staffHasHolidayOT_\(staff\.StaffID, today\);/.test(ci));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
