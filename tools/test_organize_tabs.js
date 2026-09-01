/**
 * tools/test_organize_tabs.js — จัดชั้นเรียน, split in two because they are two different problems.
 *   node tools/test_organize_tabs.js
 *
 * Asked 2026-09-02, after seeing the drag grid on a phone: "ชอบฟังก์ชันการลากวางได้ แต่ดูยากและ
 * ข้อมูลเยอะไป ... มันดูซ้ำซ้อนกับสิ่งที่มีในระบบอยู่แล้ว ... จะทำยังไงให้มีฟังก์ชันที่หัวหน้าครูจัดการ
 * ได้ง่ายในมือถือ".
 *
 * The grid treated teachers and children as the same kind of thing, and they are not:
 *
 *   a TEACHER belongs to MANY rooms  (ครูก้อย: Baby + 1 + 2 · ครูฟิล์ม: four)  → tick boxes
 *   a CHILD   belongs to exactly ONE (Class is a single value)                 → a choice
 *
 * So the same teacher had to be found in four columns, and the drop-down under each chip could hold
 * only ONE room — meaning the fallback control silently NARROWED anyone who used it. That is the
 * duplication that was being felt, and it was a real defect rather than a matter of taste.
 *
 * And underneath it, the thing that would have made every un-tick look broken: orgMoveTeacher only
 * ever wrote Department, while coveredClasses_ reads Department ∪ Classes ∪ today's cover.
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
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), gasEngine = R('src/Engine.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'GasEngine', 'Engine']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_(), stSh = sheet_(HR, 'STAFF');
  var clSh = sheet_(MAIN, 'CLASSES');
  ['Nursery Baby', 'Nursery 1', 'Nursery 2', 'Nursery 3'].forEach(function (n, i) {
    appendObject_(clSh, { ClassID: 'C' + i, ClassName: n });
  });
  var add = function (id, nick, role, dept, classes) {
    appendObject_(stSh, { StaffID: id, Name: 'คุณ' + nick, Nickname: nick, Role: role,
      PositionLevel: role === 'Admin' ? 'Admin' : 'Staff', Status: 'ACTIVE',
      Department: dept, Classes: classes === undefined ? dept : classes,
      StartDate: '2025-01-01', RequireCheckin: true });
  };
  add('STF-ADM', 'แอดมิน', 'Admin', '*');
  add('STF-KOI', 'ก้อย', 'Teacher', 'Nursery Baby,Nursery 1,Nursery 2');
  add('STF-HEAD', 'จอย', 'Teacher', '*');
  add('STF-NEW', 'เดิ้ล', 'Teacher', '');

  var o = {}, mv = function (target, toDept) {
    try { return engineDispatch_('orgMoveTeacher', { staffId: 'STF-ADM', targetId: target, toDept: toDept }); }
    catch (e) { return { err: (e && (e.apiCode || e.code)) || String(e && e.message) }; }
  };
  var covered = function (id) {
    var s = readObjects_(stSh).filter(function (r) { return r.StaffID === id; })[0];
    return engineDispatch_('myClasses', { staffId: id }).classes.map(function (c) { return c.className; }).sort();
  };
  var row = function (id) {
    var s = readObjects_(stSh).filter(function (r) { return r.StaffID === id; })[0] || {};
    return { dept: String(s.Department || ''), classes: String(s.Classes || '') };
  };

  o.before = { row: row('STF-KOI'), covered: covered('STF-KOI') };
  mv('STF-KOI', 'Nursery Baby,Nursery 1');                 // ← un-tick Nursery 2
  o.afterDrop = { row: row('STF-KOI'), covered: covered('STF-KOI') };
  mv('STF-KOI', 'Nursery Baby,Nursery 1,Nursery 3');       // ← and tick a new one
  o.afterAdd = { row: row('STF-KOI'), covered: covered('STF-KOI') };

  mv('STF-NEW', 'Nursery 2');
  o.newbie = { row: row('STF-NEW'), covered: covered('STF-NEW') };

  // '*' is stored as '*', never as "every box ticked"
  o.headRow = row('STF-HEAD');
  o.headCovered = covered('STF-HEAD');
  mv('STF-KOI', '*');
  o.koiAll = { row: row('STF-KOI'), covered: covered('STF-KOI') };
  mv('STF-KOI', 'Nursery 1');                              // ...and back off again
  o.koiBack = { row: row('STF-KOI'), covered: covered('STF-KOI') };

  // clearing every tick is a legitimate answer: "not in any class yet"
  mv('STF-KOI', '');
  o.koiNone = row('STF-KOI');

  // ---- who may move whom ----
  add('STF-PLAIN', 'ปุ๊ก', 'Teacher', 'Nursery 1');
  var grant = readObjects_(stSh).filter(function (r) { return r.StaffID === 'STF-KOI'; })[0];
  updateRow_(stSh, grant._row, { CanClassOrg: 'YES' });
  appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: 'STD-1', Name: 'ด.ญ. ทดสอบ', Nickname: 'ใบเตย',
    Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2025-05-01', Plan: 'FULL' });
  var tryMove = function (actor, action, payload) {
    try { engineDispatch_(action, Object.assign({ staffId: actor }, payload)); return 'ok'; }
    catch (e) { return (e && (e.apiCode || e.code)) || String(e && e.message); }
  };
  o.perm = {
    headMoveStudent:  tryMove('STF-HEAD',  'orgMoveStudent', { targetId: 'STD-1', toClass: 'Nursery 2' }),
    headMoveTeacher:  tryMove('STF-HEAD',  'orgMoveTeacher', { targetId: 'STF-PLAIN', toDept: 'Nursery 2' }),
    plainMoveStudent: tryMove('STF-PLAIN', 'orgMoveStudent', { targetId: 'STD-1', toClass: 'Nursery 3' }),
    plainMoveTeacher: tryMove('STF-PLAIN', 'orgMoveTeacher', { targetId: 'STF-HEAD', toDept: 'Nursery 3' }),
    grantedStudent:   tryMove('STF-KOI',   'orgMoveStudent', { targetId: 'STD-1', toClass: 'Nursery 3' }),
    grantedTeacher:   tryMove('STF-KOI',   'orgMoveTeacher', { targetId: 'STF-PLAIN', toDept: 'Nursery 3' })
  };
  return JSON.stringify(o);
}));

console.log('\n1) TAKING A ROOM AWAY ACTUALLY TAKES IT AWAY');
{
  /* coveredClasses_ is Department ∪ Classes ∪ cover. orgMoveTeacher wrote only Department, so
   * un-ticking Nursery 2 left 'Nursery 2' in Classes and she still covered it — the screen said she
   * had moved and the class lists said she had not. It could only ever ADD a room. */
  eq('she starts in three rooms', res.before.covered, ['Nursery 1', 'Nursery 2', 'Nursery Baby']);
  eq('...and dropping one drops it', res.afterDrop.covered, ['Nursery 1', 'Nursery Baby']);
  eq('...on BOTH columns, not just the one the screen showed',
    res.afterDrop.row, { dept: 'Nursery Baby,Nursery 1', classes: 'Nursery Baby,Nursery 1' });
  eq('adding one still adds it', res.afterAdd.covered, ['Nursery 1', 'Nursery 3', 'Nursery Baby']);
  eq('a teacher with no class at all can be given one', res.newbie.covered, ['Nursery 2']);
  ok_('the reason is written where the bug was', /CLASSES TOO, OR TAKING A ROOM AWAY DOES NOTHING/.test(engine));
  ok_('...and the built engine has the fix', /s\.Department=p\.toDept\|\|''; s\.Classes=p\.toDept\|\|'';/.test(gasEngine));
}

console.log('\n2) "ทุกชั้น" IS A VALUE, NOT FIVE TICKS');
{
  /* A head teacher stored as five ticks would silently be left out of the sixth Nursery on the day
   * it opens. '*' covers whatever exists. */
  eq('a head teacher is stored as *', res.headRow, { dept: '*', classes: '*' });
  // ...every room THERE IS, including the one setupAll seeds — which is the whole point of '*'
  eq('...and covers every room there is', res.headCovered, ['Nursery 0', 'Nursery 1', 'Nursery 2', 'Nursery 3', 'Nursery Baby']);
  eq('ticking "ทุกชั้น" writes * rather than a list', res.koiAll.row, { dept: '*', classes: '*' });
  eq('...and un-ticking it goes back to exactly what was picked', res.koiBack.row, { dept: 'Nursery 1', classes: 'Nursery 1' });
  eq('...covering only that', res.koiBack.covered, ['Nursery 1']);
  ok_('the screen stores it the same way, and says why',
    /const toDept = all \? '\*' : picked\.join\(','\);/.test(app) &&
    /a head teacher is stored as '\*', NOT as "every box ticked"/.test(app));
  ok_('...and the two answers can never be given at once', /window\.ORG_tAll=\(el\)=>/.test(app));
}

console.log('\n3) NO CLASS AT ALL IS AN ANSWER');
{
  eq('clearing every tick clears both columns', res.koiNone, { dept: '', classes: '' });
  ok_('...and the card says so rather than looking like a save that failed',
    /const none=!all && !deps\.some\(dep=>mine\.indexOf\(dep\)>=0\);/.test(app) && /ยังไม่ได้จัดชั้น/.test(app));
}

console.log('\n4) TWO TABS, BECAUSE THEY ARE TWO DIFFERENT PROBLEMS');
{
  ok_('there is a teacher tab and a child tab', /window\.ORG_tab=\(k\)=>/.test(app) && /segBtn\('teacher'/.test(app) && /segBtn\('student'/.test(app));
  ok_('one card per teacher, with a tick per class', /const tCard=s=>/.test(app) && /class="orgDeps"/.test(app));
  /* THE CHILD SIDE IS DELIBERATELY NOT TICK BOXES. Class is a single value; tick boxes would invite
   * two ticks for something the system cannot store. */
  ok_('...and the child side stays a choice, with the reason recorded',
    /A CHILD belongs to exactly one room, so the student side does NOT become tick boxes/.test(app));
  /* RADIO, NOT CHECK BOX — "ให้เลือกได้ 1:1 ไม่สามารถติ๊กหลายช่องได้". A control that can physically
   * hold two answers is a control that can produce a state the system cannot store, so the browser
   * enforces the rule rather than a script tidying up afterwards. */
  ok_('a child picks exactly one class, enforced by the control itself',
    /<input type="radio" name="orgSr_\$\{esc\(s\.StudentID\)\}"/.test(app));
  ok_('...and the reason that it is not a check box is recorded',
    /Class is a single value, so a control that can physically hold two answers/.test(app));
  /* Nothing is written on the tick: a move changes whose journal this child is on and which food
   * menu the family sees, and a stray tap on a phone is easy. */
  ok_('ticking selects; a named button commits', /window\.ORG_sPick=\(id\)=>/.test(app) && /window\.ORG_sSave=async\(id,btn\)=>/.test(app));
  console.log('   — and how you know it saved');
  /* Both halves used to end the same way: call the server, toast, redraw. The redraw threw away the
   * "✅ บันทึกแล้ว" the teacher card had just written, jumped the page to the top, and left a card
   * that looked exactly as before — so the only way to be sure was to go and open the child's
   * record. "แก้ไขเสร็จจะรู้ได้ยังไงว่าบันทึก ... ต้อง Re-Check ไปตรวจประวัตินักเรียนด้วยไหม" */
  ok_('the confirmation survives the redraw instead of being wiped by it',
    /let ORG_LAST=null;/.test(app) && /window\.ORG_paintSaved=\(\)=>/.test(app) && /\$\{deps\.map\(sGroup\)\.join\(''\)\}`\}`;\n\s*ORG_paintSaved\(\);/.test(app));
  ok_('...names WHAT was saved, not just that something was', /บันทึกแล้ว — ตอนนี้อยู่ \$\{ORG_LAST\.to\}/.test(app));
  ok_('...and says the personal record already agrees', /ข้อมูลในประวัติเปลี่ยนตามแล้ว/.test(app));
  ok_('...and brings the card back into view rather than jumping to the top',
    /card\.scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/.test(app));
  /* The pills ARE the answer to "did it save?", so they must be the server's answer and not a
   * stale-while-revalidate copy that would show the old class for a second. */
  ok_('the redraw re-reads from the server rather than the cache',
    /api\('listStaff',\{\},\{fresh:true\}\),api\('listStudents',\{\},\{fresh:true\}\)/.test(app));
  ok_('...with the reason written down', /READ BACK FROM THE SERVER, not from the cache/.test(app));
  /* THE RE-CHECK THE SCHOOL SAID THEY WOULD HAVE TO DO BY HAND WOULD HAVE FAILED. A_CACHE is what
   * findStudent/findStaff read and what the personal-record form is drawn from; this screen kept its
   * fetch to itself, so opening the child's record straight after a move showed the OLD class. The
   * sheet was right — the other screen was reading a copy taken before the move. */
  ok_('the fresh lists are put where the personal-record form reads them',
    /A_CACHE\.staff=staff; A_CACHE\.students=students;/.test(app));
  ok_('...and the trap is written down next to it',
    /it would\n\s*\* have failed\. The sheet was right; the other screen was reading a copy taken before the move\./.test(app));
  // one element per card wearing that class, or the confirmation lands on the wrong node
  ok_('there is no empty placeholder competing with the confirmation',
    /no empty "saved" slot here/.test(app) && (app.match(/class="orgSaved"|className='orgSaved'/g)||[]).length === 1);
  // one round trip per card, owned by that card — the shared helper is what made this unanswerable
  ok_('the shared mover that swallowed its own errors is gone',
    !/window\.A_moveSel=/.test(app) && /A_moveSel is gone with the last thing that called it/.test(app));
  ok_('...and the button says where the child is going', /ยืนยันย้ายไป \$\{to\}/.test(app));
  ok_('...and stays hidden until something actually changed', /if\(!to \|\| to===card\.dataset\.cur\)\{ box\.hidden=true; return; \}/.test(app));
  /* The teacher chips are gone from the columns — the same thing editable in two places is what made
   * the screen feel duplicated — but the column still NAMES who runs the room. */
  // each class heading still SAYS who runs the room — it just is not where you change it any more
  ok_('teachers are named above each class but no longer edited there',
    /const sGroup=dep=>\{[\s\S]{0,400}ts\.map\(x=>dispNick\(x\)\)\.join\(', '\)/.test(app));
  ok_('...so there is exactly one drop-down per child and none per teacher',
    app.indexOf("A_moveSel('teacher'") < 0);
  /* The drag handlers go with the grid they served. On a phone, dragging a name across a five-column
   * grid was never really available, and every chip already carried a control that did the same
   * job — keeping a second, worse way to do it is the duplication being complained about. */
  ok_('nothing is draggable any more', !/draggable="true"/.test(app) && !/window\.A_drag=/.test(app));
  ok_('...and that is written down rather than just deleted', /THE DRAG HANDLERS ARE GONE WITH THE GRID THEY SERVED/.test(app));
}

console.log('\n5) WHO MAY MOVE A CHILD — "หัวหน้าครูและ Admin เท่านั้น"');
{
  /* Two different decisions, deliberately not the same right. Moving a CHILD is the daily business
   * of running a nursery and the head teacher does it; deciding which STAFF MEMBER is responsible
   * for a room is not, and stays with the admin. */
  eq('a head teacher may move a child', res.perm.headMoveStudent, 'ok');
  eq('...but still may not move a teacher', res.perm.headMoveTeacher, 'NO_PERMISSION');
  eq('a plain teacher may do neither', [res.perm.plainMoveStudent, res.perm.plainMoveTeacher], ['NO_PERMISSION', 'NO_PERMISSION']);
  /* The teacher the admin explicitly ticked CanClassOrg for keeps it — that tick is itself an admin
   * decision ("ย้ายครู/นักเรียน เหมือนแอดมิน"), and silently revoking a granted permission is not
   * something a screen change should do. Confirmed with the school before writing it. */
  eq('a teacher the admin granted CanClassOrg keeps both', [res.perm.grantedStudent, res.perm.grantedTeacher], ['ok', 'ok']);
  ok_('the rule has a name and a reason', /const canMoveStudent_ = staff => canCover_\(staff\);/.test(engine) &&
    /หัวหน้าครูและ Admin เท่านั้น/.test(engine));
  ok_('...and the refusal says who may, instead of "ask the admin"',
    /ย้ายชั้นเรียนนักเรียนได้เฉพาะแอดมินและหัวหน้าครู/.test(engine) && /ย้ายชั้นเรียนนักเรียนได้เฉพาะแอดมินและหัวหน้าครู/.test(gasEngine));
  /* A tab that only ever answers "ไม่มีสิทธิ์" is worse than no tab. */
  ok_('the screen draws only the half you have', /const tabs = \[mayTeacher&&'teacher', mayStudent&&'student'\]\.filter\(Boolean\);/.test(app));
  ok_('...and the head teacher gets a door to it', /window\.T_moveStudents=\(\)=>/.test(app) && /onclick="T_moveStudents\(\)"/.test(app));
  ok_('...told apart from temporary cover, which is a different decision',
    /onclick="T_cover\(\)"/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
