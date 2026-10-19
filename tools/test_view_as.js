/**
 * tools/test_view_as.js — the preview must be the family's screen, not a near miss.
 *   node tools/test_view_as.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * THREE REPORTS FROM THE ผอ. ON 2026-10-19, which turned out to be one idea three times:
 * a screen that answers a question differently from the screen next to it.
 *
 *   ① ย้าย/จัดชั้นเรียน — ครูจอย, a head teacher covering EVERY class, was listed at the top of the
 *     screen under ⚠️ "ยังไม่ได้จัดชั้น — 1", while her own card four centimetres below showed
 *     ทุกชั้น (หัวหน้าครู) ticked. The banner and the card asked the same question in two different
 *     ways, and only one of them knew that '*' means every class.
 *
 *   ② แผนก — Admin and Observer were still named in ⚠️ "ยังไม่ได้อยู่แผนกใด". The leavers had been
 *     taken off that screen the same day; the system accounts had only been taken off the clock-in
 *     list. Two screens, one rule, applied to one of them.
 *
 *   ③ ดูมุมมองผู้ปกครอง — "ความเป็นจริงในการเข้าไปดูมุมมองคือ ต้องการเห็นเหมือนกับผู้ปกครอง เป๊ะๆ
 *     ด้วยเงื่อนไขเดียวกัน". An Admin session is returned untouched by applyIdentity_ — that is what
 *     makes the preview work at all, and it also means every gate the family's own session passes
 *     through is skipped.
 *
 * 🔴 WHY ③ IS THE SERIOUS ONE. A preview that is MORE GENEROUS than the real thing is worse than no
 * preview: the admin confirms with their own eyes something that is not true, and then tells a
 * parent the app is working. It is the mirror image of the bug this project has now hit four times
 * from the other side — the server says yes and the screen says no.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
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

/** cut a span out of app.js and run it for real — asserting a regex matches the source would pass
 *  just as happily on a line that was never executed. */
function lift(fromMark, toMark, tail, ctx) {
  const from = app.indexOf(fromMark), to = app.indexOf(toMark, from + 1);
  if (from < 0 || to <= from) throw new Error('not found in webapp/app.js: ' + fromMark);
  const sandbox = Object.assign({}, ctx); vm.createContext(sandbox);
  vm.runInContext(app.slice(from, to) + '\n;' + tail, sandbox);
  return sandbox;
}

console.log('\n1) 🏫 "ยังไม่ได้จัดชั้น" กับการ์ดของคนคนเดียวกัน ต้องตอบตรงกัน');
{
  const deps = ['Nursery Baby', 'Nursery 1', 'Nursery 2', 'Nursery 3'];
  const S = lift('const depOf = s =>', 'const teachers = staff.filter', ';this.depOf=depOf;this.inDep=inDep;', {});
  const S2 = lift('const noClass = s =>', 'const unassigned = teachers.filter',
    ';this.noClass=noClass;', { deps: deps, depOf: S.depOf, inDep: S.inDep });
  const noClass = S2.noClass;
  const leader = { StaffID: 'S1', Department: '*', PositionLevel: 'Leader' };
  eq('🔴 หัวหน้าครู (ทุกชั้น = "*") ไม่ใช่คนที่ยังไม่ได้จัดชั้น', noClass(leader), false);
  eq('ครูที่ติ๊กไว้ 3 ชั้น', noClass({ Department: 'Nursery 1, Nursery 2, Nursery 3' }), false);
  eq('ครูที่ยังว่างจริงๆ', noClass({ Department: '' }), true);
  /* a Department left pointing at a class that has since been deleted or renamed IS unassigned —
   * the room it names does not exist, so nobody is covering it */
  eq('ครูที่ผูกกับชั้นที่ถูกลบไปแล้ว', noClass({ Department: 'Nursery 9' }), true);
  /* 🔴 ONE predicate, read by both. Two copies is how they disagreed in the first place. */
  const body = app.slice(app.indexOf('const noClass = s =>'), app.indexOf('const sCard=s=>'));
  ok_('🔴 การ์ดใช้ predicate ตัวเดียวกับแบนเนอร์ ไม่ได้เขียนเงื่อนไขซ้ำ', /const none=noClass\(s\);/.test(body));
}

console.log('\n2) 🏫 แผนก — Admin/Observer ไม่ได้อยู่ในโครงสร้างห้องเรียนและกะเวลา');
{
  const S = lift('const staffInStructure = (s) =>', 'const _expectedToday', ';this.f=staffInStructure;', {});
  const f = S.f;
  eq('คุณครู', f({ Role: 'Teacher', PositionLevel: 'Staff' }), true);
  eq('หัวหน้าครู', f({ Role: 'Teacher', PositionLevel: 'Leader' }), true);
  eq('🔴 Admin', f({ Role: 'Admin' }), false);
  eq('🔴 Observer', f({ Role: 'Observer' }), false);
  eq('🔴 ...ไม่ว่าจะเก็บไว้ที่ Role หรือ PositionLevel', f({ Role: 'Teacher', PositionLevel: 'Admin' }), false);
  /* 🔴 THE SCREEN THAT WAS MISSED. The ⚠️ list and the department chips are built from one array;
   * it filtered leavers and not system accounts, which is exactly what the ผอ. saw. */
  ok_('🔴 หน้าแผนกกรองทั้ง "คนที่ออกแล้ว" และ "ไม่ได้อยู่ในโครงสร้าง"',
    /const active=\(staff\|\|\[\]\)\.filter\(s=>!staffLeft\(s\) && staffInStructure\(s\)\);/.test(app));
}

console.log('\n3) 👁️ ดูมุมมองผู้ปกครอง — เงื่อนไขเดียวกับที่ผู้ปกครองเจอจริง');
{
  /* 🔴 THE LOOKUP KEY. `uid: p.LineUID||pid` let the preview find USER_LINKS rows whose UserUID is
   * a ParentID — three of them on the real export — a key no sign-in can ever present. */
  ok_('🔴 ไม่ใช้ ParentID แทน LINE UID เวลาผู้ปกครองยังไม่ได้ผูก LINE',
    /parentId:pid,uid:p\.LineUID\|\|'',/.test(app) && !/uid:p\.LineUID\|\|pid/.test(app));
  ok_('ทุก request ในมุมมองติดธงว่าเป็นมุมมอง (ไม่ใช่เฉพาะหน้าที่จำได้)',
    /__viewAs: 'Parent'/.test(app) && /payload = _vaStamp\(payload\);/.test(app));
  ok_('แถบด้านบนบอกว่าครอบครัวนี้ถูกปิดการเข้าใช้แล้ว', /USER\._accessClosed \?/.test(app));

  const g = JSON.parse(run_live());
  eq('เด็กที่ยังเรียนอยู่ — มุมมองเปิดได้', g.openHere, 'OK');
  eq('🔴 เด็กที่ออกไปเกินกำหนด — มุมมองถูกปฏิเสธเหมือนที่ผู้ปกครองเจอ', g.openOut, 'ACCESS_ENDED');
  /* 🔴 ...and ONLY while previewing. An admin doing their own job must still be able to open,
   * correct and close the record of a child who has left — that is the whole point of the office
   * having a copy. Breaking that to fix the preview would trade one bug for a worse one. */
  eq('🔴 แอดมินที่ทำงานปกติ (ไม่ได้อยู่ในมุมมอง) ยังเปิดประวัติเด็กที่ออกไปแล้วได้', g.adminOut, 'OK');
  /* 🔴 A FORGED FLAG CAN ONLY COST ITS SENDER ACCESS. __viewAs arrives from the client; an Admin
   * session already had the free pass, so the worst a tampered payload achieves is a refusal. */
  eq('ธง __viewAs ปลอมได้ แต่ได้แค่ "ถูกปฏิเสธ" ไม่เคยได้สิทธิ์เพิ่ม', g.forged, 'ACCESS_ENDED');
}

function run_live() {
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                      'GasEngine', 'Engine', 'Day6']);
  return run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var MAIN = getMainSpreadsheet_();
    function days(n) { var d = new Date(); d.setDate(d.getDate() + n); return dateStr_(d); }
    [['V-HERE', ''], ['V-OUT', days(-40)]].forEach(function (r) {
      appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: r[0], Name: r[0], Nickname: r[0],
        Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2024-01-01',
        ParentID: 'VP-' + r[0], EndDate: r[1] });
      appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'VP-' + r[0], Name: 'แม่ ' + r[0], LineUID: 'UV-' + r[0] });
    });
    /* 🔴 THE GATE ONLY EXISTS WHEN SESSIONS ARE ENFORCED, which live does and a fresh fixture does
     * not — applyIdentity_ returns on its first line otherwise. Without this the whole section
     * passed by never reaching the code it was written to test. */
    var _cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
    var _rq = findObject_(_cfg, function (r) { return r.Key === 'RequireSessionToken'; });
    if (_rq) updateRow_(_cfg, _rq._row, { Value: 'true' }); else appendObject_(_cfg, { Key: 'RequireSessionToken', Value: 'true' });
    _configCache = null;
    try { CacheService.getScriptCache().removeAll(['cfg', 'col:STUDENTS', 'col:PARENTS']); } catch (e) {}
    if (!sessionRequired_()) throw new Error('fixture did not enable session enforcement');
    var sess = { role: 'Admin', uid: 'U-ADMIN', linkedId: 'STF-ADMIN' };
    function tryIt(payload) {
      try { applyIdentity_('studentProfile', payload, sess); return 'OK'; }
      catch (e) { return (e && e.apiCode) || String((e && e.message) || e); }
    }
    return JSON.stringify({
      openHere: tryIt({ __viewAs: 'Parent', studentId: 'V-HERE', uid: 'UV-V-HERE' }),
      openOut:  tryIt({ __viewAs: 'Parent', studentId: 'V-OUT',  uid: 'UV-V-OUT' }),
      adminOut: tryIt({ studentId: 'V-OUT' }),
      forged:   tryIt({ __viewAs: 'Parent', studentId: 'V-OUT' })
    });
  });
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
