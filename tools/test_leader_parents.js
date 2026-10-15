/**
 * tools/test_leader_parents.js — the head teacher's read-only view of the families she looks after.
 *   node tools/test_leader_parents.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE FINDING THAT CAME WITH THE FEATURE REQUEST (2026-10-15)
 *
 * Asked: "หัวหน้าครูสามารถดูข้อมูลผู้ปกครองได้เพิ่มเติมเหมือน Admin แต่ดูได้อย่างเดียว".
 *
 * Looking at how to widen the permission turned up that there was no permission to widen:
 * `listParents` returns M.parents whole — every family's NationalID, Address, Phone, LineUID and
 * Email — it was NOT in ADMIN_ONLY, and the engine handler is `() => M.parents` with no check of
 * its own. So any signed-in session could ask for it: a teacher, and — because a parent holds a
 * session too — any parent, for every other family in the school.
 *
 * Nothing in the UI ever drew it, which is why nobody saw it. But "no screen calls it" is not a
 * permission; it is a coincidence that lasts until somebody opens the network tab. The same shape
 * as the geofence that stopped guarding on a blank coordinate: the guard was not refusing, it was
 * absent.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * TWO LIMITS, BOTH DECIDED BY THE SCHOOL AND BOTH ENFORCED ON THE SERVER
 *
 *   WHO   families with a child in a class this person covers
 *   WHAT  contact level — NOT the national ID, the home address, the email or the LINE user id
 *
 * The second one is not squeamishness. The student record screen tells teachers in writing that
 * "เลขบัตรประชาชน ที่อยู่ … อยู่ในสิทธิ์ของแอดมิน", and a head teacher is a teacher: showing the
 * national ID here would make the app say two contradictory things about the same field on two
 * screens, which is how a school stops believing either of them.
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

/* Two classes, two head teachers with different coverage, and a family in each — the only fixture
 * that can tell "scoped" from "returned everything and happened to look right". */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', Capacity: 20 });
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C2', ClassName: 'Nursery 2', Capacity: 20 });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'S1', Name: 'เด็กหนึ่ง', Nickname: 'หนึ่ง',
    Class: 'Nursery 1', ParentID: 'P1', Status: 'ACTIVE', DOB: '2023-01-01' });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'S2', Name: 'เด็กสอง', Nickname: 'สอง',
    Class: 'Nursery 2', ParentID: 'P2', Status: 'ACTIVE', DOB: '2023-01-01' });
  /* 🔴 THE BAIT, and it is the whole point of this suite: real-shaped values in the four fields a
   * head teacher must not receive. Searching the WHOLE reply for them beats listing the fields we
   * remembered to check — a test that enumerates cannot notice the fifth one. */
  appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'P1', Name: 'คุณแม่หนึ่ง', Relationship: 'มารดา',
    Phone: '0812345678', Occupation: 'พยาบาล', Workplace: 'รพ.ทดสอบ', OfficePhone: '021234567',
    NationalID: 'NID-MUST-NOT-APPEAR-1101', Address: 'ADDRESS-MUST-NOT-APPEAR-99/1',
    Email: 'EMAIL-MUST-NOT-APPEAR@example.com', LineUID: 'ULINE-MUST-NOT-APPEAR-abcdef',
    StudentID: 'S1' });
  appendObject_(sheet_(MAIN, 'PARENTS'), { ParentID: 'P2', Name: 'คุณพ่อสอง', Relationship: 'บิดา',
    Phone: '0898765432', NationalID: 'NID2-MUST-NOT-APPEAR', StudentID: 'S2' });
  // the head teacher of Nursery 1 only, and one who covers everything
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'L1', Name: 'หัวหน้าครูหนึ่ง', Role: 'Teacher',
    PositionLevel: 'Leader', Classes: 'Nursery 1', Department: 'Nursery 1',
    Status: 'ACTIVE', StartDate: '2024-01-01' });
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'LALL', Name: 'หัวหน้าครูทุกชั้น', Role: 'Teacher',
    PositionLevel: 'Leader', Department: '*', Status: 'ACTIVE', StartDate: '2024-01-01' });
  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'T1', Name: 'ครูธรรมดา', Role: 'Teacher',
    PositionLevel: 'Staff', Classes: 'Nursery 1', Department: 'Nursery 1',
    Status: 'ACTIVE', StartDate: '2024-01-01' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:PARENTS', 'col:STUDENTS', 'col:STAFF', 'col:CLASSES']); } catch (e) {}

  var ctx = hydrateLazy_(['students', 'staff', 'parents', 'classes', 'userLinks']);
  var H = createAtomAPI(ctx.M, null).H;
  function call(staffId) {
    try { return { ok: true, data: H.leaderParents({ staffId: staffId }) }; }
    catch (e) { return { ok: false, code: (e && e.apiCode) || 'ERR' }; }
  }
  return JSON.stringify({ leader1: call('L1'), leaderAll: call('LALL'),
    plainTeacher: call('T1'), nobody: call('NOPE') });
}));

console.log('\n1) 🔴 เห็นเฉพาะครอบครัวของเด็กในชั้นที่ตนดูแล');
{
  const d = res.leader1.data;
  ok_('หัวหน้าครูเรียกได้', res.leader1.ok === true);
  /* 🔴 A HEAD TEACHER ALREADY COVERS EVERY CLASS, AND THAT IS NOT THIS SCREEN'S DECISION.
   *
   * coveredClasses_ reads `if(lvl==='Admin'||lvl==='Leader'|| … ) return all.slice()` — so anyone
   * whose PositionLevel is Leader covers the whole school, whatever their own Classes/Department
   * say. L1 below is pinned to Nursery 1 and still sees both families.
   *
   * The school asked for "only the classes they look after", and this handler asks exactly that
   * question, of the same function every other screen asks. For a Leader the honest answer happens
   * to be "all of them" — and it has to stay that way, because a second definition of coverage
   * living on this one screen is how two screens come to disagree about who a teacher is
   * responsible for. If the school wants head teachers narrowed, that is a change to
   * coveredClasses_ and it moves the class list, the journal and cover with it. Written down
   * rather than special-cased. */
  eq('หัวหน้าครู (Leader) ครอบคลุมทุกชั้นตามกฎเดิมของระบบ',
    (d.parents || []).map(p => p.parentId).sort(), ['P1', 'P2']);
  ok_('...และบอกขอบเขตออกมาตรงๆ ว่าคือชั้นไหนบ้าง', (d.classes || []).length >= 2);
  /* A head teacher who covers everything sees everything — the SAME rule (coveredClasses_), not a
   * special case. If this were a separate branch it would be a second place for the rule to drift. */
  eq('หัวหน้าครูที่ดูแลทุกชั้น เห็นทั้งสองครอบครัว',
    (res.leaderAll.data.parents || []).map(p => p.parentId).sort(), ['P1', 'P2']);
}

console.log('\n2) 🔴 ไม่มีเลขบัตรประชาชน ที่อยู่ อีเมล หรือ LINE UID หลุดออกไป');
{
  /* Searched against the WHOLE reply, not against the fields we chose to look at. */
  const whole = JSON.stringify(res.leaderAll.data);
  ['NID-MUST-NOT-APPEAR', 'NID2-MUST-NOT-APPEAR', 'ADDRESS-MUST-NOT-APPEAR',
   'EMAIL-MUST-NOT-APPEAR', 'ULINE-MUST-NOT-APPEAR'].forEach(bait =>
    ok_('  ไม่ปรากฏ: ' + bait.split('-')[0], whole.indexOf(bait) < 0));
  const p1 = (res.leaderAll.data.parents || []).find(x => x.parentId === 'P1') || {};
  ok_('🔴 ...แต่บอกได้ว่า "มีเลขบัตรในระบบแล้ว" โดยไม่บอกตัวเลข', p1.hasNationalID === true);
  ok_('🔴 ...และบอกว่าผูก LINE แล้วหรือยัง โดยไม่ให้ตัว id', p1.linked === true);
  // ...and the contact level that WAS asked for really is there, or the screen has nothing to show
  eq('  ชื่อ · ความสัมพันธ์ · เบอร์โทร · อาชีพ · ที่ทำงาน',
    [p1.name, p1.relationship, p1.phone, p1.occupation, p1.workplace],
    ['คุณแม่หนึ่ง', 'มารดา', '0812345678', 'พยาบาล', 'รพ.ทดสอบ']);
  eq('  ...และลูกของใคร', (p1.children || []).map(k => k.nick + '/' + k.cls), ['หนึ่ง/Nursery 1']);
}

console.log('\n3) 🔴 ใครเรียกไม่ได้บ้าง');
{
  eq('ครูประจำชั้นธรรมดา — ปฏิเสธ', res.plainTeacher.code, 'NO_PERMISSION');
  eq('คนที่ไม่ใช่พนักงาน — ปฏิเสธ', res.nobody.code, 'NO_PERMISSION');
}

console.log('\n4) 🔴 รูที่เจอระหว่างทาง — listParents ไม่เคยมีด่าน');
{
  const code = R('src/Code.gs');
  const i = code.indexOf('var ADMIN_ONLY = {');
  const adminOnly = i < 0 ? '' : code.slice(i, code.indexOf('};', i) + 2);
  const inAdmin = n => new RegExp('\\b' + n + ':\\s*1').test(adminOnly);
  ok_('พบ ADMIN_ONLY และเป็นก้อนนั้นจริง', adminOnly.length > 200 && adminOnly.length < 8000);
  ok_('🔴 listParents เป็นของแอดมินแล้ว (เดิมใครล็อกอินอยู่ก็เรียกได้ รวมถึงผู้ปกครอง)',
    inAdmin('listParents'));
  ok_('...parentKidsMap และ parentLinkCounts ด้วย', inAdmin('parentKidsMap') && inAdmin('parentLinkCounts'));
  ok_('🔴 ...แต่ leaderParents ต้องไม่อยู่ในนั้น ไม่งั้นหัวหน้าครูก็เรียกไม่ได้',
    !inAdmin('leaderParents'));
  // ...and it must read as a READ, or it queues behind the write lock for nothing
  ok_('leaderParents ไม่เข้าเงื่อนไขการเขียน',
    !/^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i.test('leaderParents'));
}

console.log('\n5) หน้าจอ — เข้าถึงได้ และบอกสิ่งที่ไม่ได้แสดง');
{
  const app = R('webapp/app.js');
  /* 🔴 REACHABLE. Three times in a fortnight a finished feature shipped with no way in — the ☀️
   * summer button, the whole-school backup, and the backup's own menu label. */
  ok_('🔴 มีปุ่มในหน้าหลักของหัวหน้าครู', /isLeader\?`<button[^`]*T_parents\(\)/.test(app));
  ok_('...และมีหน้าจอจริง', /window\.T_parents\s*=\s*async/.test(app));
  /* 🔴 SAY WHAT IS NOT HERE. A head teacher who cannot find the address will otherwise assume the
   * record is empty and go and ask the family for it again — the gap has to read as a boundary,
   * not as missing data. */
  ok_('🔴 บอกตรงๆ ว่าเลขบัตร/ที่อยู่/อีเมล ไม่ได้แสดงที่นี่',
    /เลขบัตรประชาชน ที่อยู่ และอีเมล ไม่ได้แสดงที่นี่/.test(app));
  ok_('...และบอกว่าดูได้อย่างเดียว', /ดูได้อย่างเดียว แก้ไขไม่ได้/.test(app));
  /* No edit control anywhere on the screen — and no disabled one either, which would imply the
   * permission exists and is merely switched off. The server has no write route for it at all. */
  const i0 = app.indexOf('window.T_parents = async'), i1 = app.indexOf('window.T_studentOT=', i0);
  const screen = i0 >= 0 && i1 > i0 ? app.slice(i0, i1) : '';
  /* Looks for an edit CONTROL, not for the word "แก้ไข" — the footer says "ดูได้อย่างเดียว
   * แก้ไขไม่ได้", so matching the word failed on the very sentence that promises there is none. */
  ok_('🔴 ไม่มีปุ่มแก้ไขใดๆ ในหน้านี้เลย',
    screen.length > 500 && !/<button[^>]*onclick="(?!GO\(|T_parentsFilter)/.test(screen)
    && !/saveParent|A_parentForm|<input(?![^>]*id="pqS")/.test(screen));
  ok_('การค้นหาใช้ตัววาดการ์ดตัวเดียวกับตอนโหลดครั้งแรก',
    (app.match(/_pqCard/g) || []).length >= 3);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
