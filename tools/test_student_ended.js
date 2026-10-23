/**
 * tools/test_student_ended.js — a child who no longer goes here cannot be marked present.
 *   node tools/test_student_ended.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ., 2026-10-19: "การไม่มีชื่อในชั้นเรียน แต่ Check-in/out ได้ จะทำให้ข้อมูลผิด และเข้าใจผิด".
 *
 * Both halves were wrong, in the two ways this project keeps finding:
 *
 *   🔴 THE SERVER — webapp/engine.js has refused STUDENT_ENDED for a long time, and src/Checkin.gs,
 *      which SHADOWS it and is the route that actually runs on live, only ever checked the FIRST
 *      day. The fourth time an explicit route has quietly disagreed with the engine behind it.
 *
 *   🔴 THE SCREEN — `ended` has been in parentChildren all along and no screen read it. A child off
 *      every class list, with no teacher writing their journal, kept two live check-in buttons on
 *      their family's home screen.
 *
 * AND IT IS A REFUSAL, NOT A REMOVAL. The family keeps the record, the final bill, the certificate
 * and the growth history for ParentAccessGraceDays — so the card counts that window down instead of
 * the door simply shutting one morning with nothing saying why.
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
const app = R('webapp/app.js');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_();
  function days(n) { var d = new Date(); d.setDate(d.getDate() + n); return dateStr_(d); }
  /* 🔴 ON AN ORDINARY OPEN DAY, or every refusal below could be SCHOOL_CLOSED and the suite would
   * pass without ever reaching the gate it was written for. Today is whatever day it is, so the
   * fixture declares it a working day rather than hoping. */
  var hol = MAIN.getSheetByName('HOLIDAYS');
  if (hol && hol.getLastRow() > 1) hol.deleteRows(2, hol.getLastRow() - 1);
  var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
  var wd = findObject_(cfg, function (r) { return r.Key === 'WorkDays'; });
  if (wd) updateRow_(cfg, wd._row, { Value: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' });
  else appendObject_(cfg, { Key: 'WorkDays', Value: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' });

  /* 🔴 เด็กที่หยุดประจำ "วันนี้" — กฎที่ engine มีมานาน แต่ route ที่รันจริงเพิ่งรู้จักใน v466
   * ใส่เลขวันของวันนี้ลงไปตรงๆ เพื่อให้เทสต์ไม่ขึ้นกับว่ารันวันไหน */
  var todayDow = new Date(days(0) + 'T00:00:00').getDay();
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'E-OFF', Name: 'E-OFF', Nickname: 'หยุดวันนี้',
    Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01',
    OffDays: String(todayDow) });
  [['E-HERE', ''], ['E-LAST', days(0)], ['E-GONE', days(-5)]].forEach(function (r) {
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: r[0], Name: r[0], Nickname: r[0],
      Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01',
      ParentID: 'EP-' + r[0], EndDate: r[1], EndReason: r[1] ? 'จบการศึกษา' : '' });
    appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'EP-' + r[0], Name: 'แม่ ' + r[0], LineUID: 'UE-' + r[0] });
    appendObject_(sheet_(MAIN, 'USER_LINKS'), { UserUID: 'UE-' + r[0], StudentID: r[0], VerifiedBy: 't', Date: '2024-01-01' });
  });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:STUDENTS', 'col:PARENTS', 'col:USER_LINKS', 'col:HOLIDAYS']); } catch (e) {}

  function gate(id) {
    try { assertStudentDayOpen_(id, new Date()); return 'OPEN'; }
    catch (e) { return (e && e.apiCode) || String((e && e.message) || e); }
  }
  var out = { live: { here: gate('E-HERE'), last: gate('E-LAST'), gone: gate('E-GONE'),
                      off: todayDow >= 1 && todayDow <= 5 ? gate('E-OFF') : 'SKIP-WEEKEND' } };

  var ctx = hydrateLazy_(['students', 'parents', 'userLinks', 'classes', 'holidays', 'studentTerms']);
  var H = createAtomAPI(ctx.M, null).H;
  // ...and what the family's own home screen is told about them
  var kids = H.parentChildren({ uid: 'UE-E-GONE', parentId: 'EP-E-GONE', role: 'Parent' });
  out.card = kids.length ? { ended: !!kids[0].ended, endDate: kids[0].endDate,
    endReason: kids[0].endReason, hasUntil: !!kids[0].accessUntil } : null;
  var kidsHere = H.parentChildren({ uid: 'UE-E-HERE', parentId: 'EP-E-HERE', role: 'Parent' });
  out.cardHere = kidsHere.length ? !!kidsHere[0].ended : null;
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 เส้นทางที่รันจริง (src/Checkin.gs) — ไม่ใช่แค่ engine');
{
  eq('เด็กที่ยังเรียนอยู่ — ลงเวลาได้ตามปกติ', res.live.here, 'OPEN');
  /* 🔴 THE LAST DAY IS A DAY THE CHILD STILL COMES. EndDate is a LAST WORKING DAY — the same
   * reading the staff gate uses — so this bites the day AFTER, never on it. Cutting a child off on
   * their own farewell day would be the bug this fix is meant to prevent, pointing the other way. */
  eq('🔴 วันสุดท้ายเอง — ยังลงเวลาได้ (วันสุดท้ายคือวันที่ยังมาเรียน)', res.live.last, 'OPEN');
  eq('🔴 หลังวันสุดท้าย — ปฏิเสธ', res.live.gone, 'STUDENT_ENDED');
  /* 🔴 วันหยุดประจำของเด็กคนนั้นเอง — engine ปฏิเสธมานาน route ที่รันจริงเพิ่งรู้จัก (v466)
   * ครั้งที่ 5 ที่ route บังหน้า engine แล้วตกกฎไปข้อหนึ่ง · พบโดย tools/audit_system.js (R5)
   * (เสาร์-อาทิตย์ข้ามข้อนี้ เพราะ OffDays รับเฉพาะ 1..5 และวันหยุดสุดสัปดาห์มีด่านของตัวเอง) */
  if (res.live.off !== 'SKIP-WEEKEND') {
    eq('🔴 วันหยุดประจำของเด็กคนนั้น — ปฏิเสธบนเส้นทางที่รันจริง', res.live.off, 'STUDENT_DAY_OFF');
  } else { console.log('  --   ข้ามข้อวันหยุดประจำ (วันนี้เป็นเสาร์/อาทิตย์)'); }
  /* Both doors go through this one function — the parent's own tap and the teacher's on-behalf
   * button — which is why the fix goes here and not in each handler. */
  const chk = R('src/Checkin.gs'), par = R('src/Parent.gs');
  ok_('ประตูเดียวกันทั้งฝั่งผู้ปกครองและฝั่งคุณครู',
    /assertStudentDayOpen_\(payload\.studentId\)/.test(par) && /assertStudentDayOpen_\(student\.StudentID\)/.test(chk));
  ok_('🔴 ...และ STUDENT_ENDED ไม่ถูกกลืนหายไปใน catch', /e\.apiCode === 'STUDENT_ENDED'/.test(chk));
}

console.log('\n2) 🎓 หน้าจอผู้ปกครองบอกว่าจบแล้ว และนับถอยหลัง');
{
  eq('ส่งสถานะ "สิ้นสุดการเรียน" ให้หน้าจอ', res.card && res.card.ended, true);
  eq('...พร้อมวันสุดท้าย', !!(res.card && res.card.endDate), true);
  eq('...และเหตุผล', res.card && res.card.endReason, 'จบการศึกษา');
  eq('...และวันที่จะปิดการเข้าใช้ (เอาไว้นับถอยหลัง)', res.card && res.card.hasUntil, true);
  eq('เด็กที่ยังเรียนอยู่ ไม่ได้ถูกติดสถานะนี้', res.cardHere, false);

  /* 🔴 FIRST IN THE CHAIN. Every other reason a button is hidden implies "it comes back" — a family
   * whose child has left must not be told "วันนี้โรงเรียนหยุด". */
  const at = app.indexOf('${k.ended'), closed = app.indexOf('window._SCHOOLDAY.closedForStudents && !_expectedToday');
  ok_('🔴 สถานะ "จบแล้ว" มาก่อนเหตุผลอื่นทั้งหมดบนการ์ด', at > 0 && closed > at);
  ok_('การ์ดบอกวันสุดท้าย และบอกว่าไม่มีส่ง-รับให้บันทึกแล้ว',
    /สิ้นสุดการเรียนแล้ว/.test(app) && /ไม่มีการส่ง-รับให้บันทึกแล้ว/.test(app));
  ok_('นับถอยหลังเป็น "เหลืออีก N วัน" ไม่ใช่แค่วันที่', /เหลืออีก \$\{left\} วัน/.test(app));
  /* 🔴 COUNTED AT DRAW TIME, not sent as a number. A cached screen that prints a stale "เหลือ 9 วัน"
   * is a countdown that lies in exactly the week it matters. */
  ok_('🔴 นับจากวันที่ ไม่ได้รับตัวเลขที่เซิร์ฟเวอร์นับไว้ (หน้าจอที่ค้างจะไม่โกหก)',
    /const left=until\?Math\.ceil\(/.test(app));
  ok_('สัปดาห์สุดท้ายขึ้นสีแดง', /left<=7\?'var\(--bad\)'/.test(app));
  ok_('หมดกำหนดแล้วบอกให้ติดต่อโรงเรียน', /พ้นกำหนดแล้ว/.test(app) && /กรุณาติดต่อทางโรงเรียนโดยตรง/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
