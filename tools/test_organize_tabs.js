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
  ok_('a child is still moved by picking one class', /A_moveSel\('student','\$\{s\.StudentID\}',this\.value\)/.test(app));
  /* The teacher chips are gone from the columns — the same thing editable in two places is what made
   * the screen feel duplicated — but the column still NAMES who runs the room. */
  ok_('teachers are named in each column but no longer edited there',
    /the teachers are named here but not edited here/.test(app) &&
    /ts\.map\(x=>dispNick\(x\)\)\.join\(', '\)/.test(app));
  ok_('...so there is exactly one drop-down per child and none per teacher',
    app.indexOf("A_moveSel('teacher'") < 0);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
