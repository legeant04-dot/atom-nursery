/**
 * tools/test_class_cover.js — lending a teacher to another class for a few days.
 *   node tools/test_class_cover.js
 *
 * Asked 2026-08-29, in the school's own words:
 *
 *   "วันนี้คุณครูลา และมีครูไม่เพียงพอต่อชั้นเรียน … ครูก้อยดูแล Nursery 1 และ 2 เป็นปกติ ต้องการเพิ่ม
 *    Nursery Baby สำหรับวันนี้ แต่พรุ่งนี้ก็กลับไปเป็นปกติ ไม่ได้ทุกวัน"
 *
 * The organize screen could already do this — move ครูก้อย into Nursery Baby. And then somebody has
 * to remember to move her back tomorrow morning, on the day they are already covering for whoever is
 * off sick. Nobody does. So cover is a ROW WITH TWO DATES that stops applying by itself: READING it
 * is what expires it, so there is no trigger to schedule and none to forget.
 *
 * WHAT THIS SUITE IS REALLY ABOUT:
 *   · ADDED to the teacher's own classes, never instead of them — the permanent record is untouched;
 *   · it turns itself off, and turns itself ON for a range starting later;
 *   · every other teacher's list is unchanged (a class list is who a teacher may see and write about);
 *   · the teacher being lent is TOLD, or the first they know is a roomful of unexpected children.
 */
const fs = require('fs'), path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), apiJs = R('webapp/api.js'),
      codeGs = R('src/Code.gs'), gasEng = R('src/GasEngine.gs'), engGs = R('src/Engine.gs');

const p2 = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
const TODAY = shift(0), TOMORROW = shift(1), YESTERDAY = shift(-1);

function fresh() {
  const M = {
    config: { Departments: 'Nursery Baby,Nursery 1,Nursery 2' },
    staff: [
      { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Department: '*' },
      { StaffID: 'STF-H', NameTH: 'หัวหน้าครู', Role: 'Teacher', PositionLevel: 'Staff', Department: '*' },
      { StaffID: 'STF-KOI', NameTH: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1,Nursery 2' },
      { StaffID: 'STF-JOY', NameTH: 'ครูจอย', Nickname: 'จอย', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery Baby' },
      { StaffID: 'STF-X', NameTH: 'ครูอื่น', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 2' }
    ],
    classes: [
      { ClassID: 'C0', ClassName: 'Nursery Baby', TeacherID: 'STF-JOY' },
      { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-KOI' },
      { ClassID: 'C2', ClassName: 'Nursery 2', TeacherID: 'STF-KOI' }
    ],
    students: [
      { StudentID: 'STD-B', NameTH: 'เด็กเบบี้', Class: 'Nursery Baby', Status: 'ACTIVE', DOB: '2025-01-05' },
      { StudentID: 'STD-1', NameTH: 'เด็กหนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2024-01-05' },
      { StudentID: 'STD-2', NameTH: 'เด็กสอง', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2023-01-05' }
    ],
    classCover: [], parents: [], holidays: [], journals: [], activityLog: [], feed: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    dspmCriteria: [], assessments: [], payments: [], userLinks: []
  };
  return { M, H: createAtomAPI(M).H };
}
const classesOf = (H, staffId) => ((H.myClasses({ staffId }) || {}).classes || []).map(c => c.className).sort();

// ============================================================================
console.log('\n1) before anybody is lent to anybody');
{
  const { H } = fresh();
  eq('ครูก้อย has her own two classes', classesOf(H, 'STF-KOI'), ['Nursery 1', 'Nursery 2']);
  eq('...and ครูจอย has hers', classesOf(H, 'STF-JOY'), ['Nursery Baby']);
}

console.log('\n2) an extra class for TODAY only');
{
  const { M, H } = fresh();
  const r = H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby', reason: 'แทนครูจอย (ลาป่วย)' });
  eq('...defaults to today, both ends', [r.from, r.to], [TODAY, TODAY]);
  /* ADDED, NOT INSTEAD OF. A teacher asked to take the babies as well still has her own two rooms —
   * a cover that replaced them would take her own children away from her for the day. */
  eq('ครูก้อย now has three classes', classesOf(H, 'STF-KOI'), ['Nursery 1', 'Nursery 2', 'Nursery Baby']);
  eq('...and her PERMANENT record is untouched', M.staff.find(s => s.StaffID === 'STF-KOI').Department, 'Nursery 1,Nursery 2');
  eq('ครูจอย keeps her own class — cover is not a transfer', classesOf(H, 'STF-JOY'), ['Nursery Baby']);
  eq('...and nobody else gained anything', classesOf(H, 'STF-X'), ['Nursery 2']);
  // the class list is what decides whose children a teacher may open, so check that moved too
  const kids = (H.classList({ staffId: 'STF-KOI' }).students || []).map(s => s.StudentID).sort();
  ok_('the baby is on her class list today', kids.indexOf('STD-B') >= 0);
}

console.log('\n3) it turns itself off, and on');
{
  const { M, H } = fresh();
  H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby' });
  /* READING IT IS WHAT EXPIRES IT. Nothing runs overnight, nobody has to remember, and the row can
   * sit in the sheet for ever without doing anything after its last day. */
  M.classCover[0].From = YESTERDAY; M.classCover[0].To = YESTERDAY;
  eq('yesterday’s cover does nothing today', classesOf(H, 'STF-KOI'), ['Nursery 1', 'Nursery 2']);
  M.classCover[0].From = TOMORROW; M.classCover[0].To = TOMORROW;
  eq('...and tomorrow’s does nothing yet either', classesOf(H, 'STF-KOI'), ['Nursery 1', 'Nursery 2']);
  M.classCover[0].From = YESTERDAY; M.classCover[0].To = TOMORROW;
  eq('...but a range spanning today does', classesOf(H, 'STF-KOI'), ['Nursery 1', 'Nursery 2', 'Nursery Baby']);
}

console.log('\n4) what is refused, and why');
{
  const { H } = fresh();
  throws_('a class that does not exist', () => H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery 9' }), 'NOT_FOUND');
  throws_('a teacher who does not exist', () => H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-ZZ', className: 'Nursery Baby' }), 'NOT_FOUND');
  throws_('no class at all', () => H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: '' }), 'BAD_INPUT');
  throws_('an end before the start', () => H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby', from: TOMORROW, to: TODAY }), 'BAD_INPUT');
  /* A CLASS SHE ALREADY HAS IS NOT COVER. The row would change nothing, and saying so is more use
   * than a list that quietly fills up with entries that do nothing. */
  throws_('a class the teacher already has permanently',
    () => H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery 1' }), 'ALREADY');
  H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby', from: TODAY, to: shift(3) });
  throws_('a range that overlaps one already there',
    () => H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby', from: shift(2), to: shift(5) }), 'DUPLICATE');
  ok_('...but a later, separate range is fine',
    !!H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby', from: shift(10), to: shift(11) }));
}
{
  /* WHO MAY GRANT IT: the same people who may reorganise classes at all. Deliberately not a new flag
   * — "you may move a teacher into a class for good, but not lend them to one for a day" is a strange
   * line, and a second permission is a second thing to get wrong. */
  const { M, H } = fresh();
  throws_('a plain teacher may not lend anybody out',
    () => H.classCoverAdd({ staffId: 'STF-X', targetId: 'STF-KOI', className: 'Nursery Baby' }), 'NO_PERMISSION');
  ok_('the head teacher may', !!H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby' }));
  ok_('...and so may an admin', !!H.classCoverAdd({ staffId: 'STF-A', targetId: 'STF-X', className: 'Nursery Baby' }));
  // ...and a teacher the admin flagged, which is the existing CanClassOrg right
  M.staff.push({ StaffID: 'STF-ORG', NameTH: 'ครูจัดชั้น', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', CanClassOrg: 'YES' });
  ok_('...and a teacher granted CanClassOrg', !!H.classCoverAdd({ staffId: 'STF-ORG', targetId: 'STF-JOY', className: 'Nursery 2' }));
  throws_('reading the list needs the same right',
    () => H.classCoverList({ staffId: 'STF-X' }), 'NO_PERMISSION');
}

console.log('\n5) taking it back');
{
  const { M, H } = fresh();
  const r = H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby' });
  eq('the class is there', classesOf(H, 'STF-KOI').length, 3);
  H.classCoverRemove({ staffId: 'STF-H', coverId: r.coverId });
  eq('...and gone again', classesOf(H, 'STF-KOI'), ['Nursery 1', 'Nursery 2']);
  eq('...with the row deleted, not merely dated out', M.classCover.length, 0);
  throws_('removing something that is not there', () => H.classCoverRemove({ staffId: 'STF-H', coverId: 'CV-9999' }), 'NOT_FOUND');
  throws_('...and a plain teacher may not remove one either',
    () => H.classCoverRemove({ staffId: 'STF-X', coverId: 'CV-0001' }), 'NO_PERMISSION');
}

console.log('\n6) the list says which rows are live, and the teacher is told');
{
  const { H } = fresh();
  H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby' });                       // today
  H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-X', className: 'Nursery Baby', from: shift(5), to: shift(6) }); // later
  const list = H.classCoverList({ staffId: 'STF-H' });
  eq('both rows are listed', list.length, 2);
  /* Three states worked out on the SERVER, so the screen never has to reason about a date range —
   * and so the teacher's own view and the head teacher's cannot disagree about what "today" means. */
  const now = list.find(r => r.staffId === 'STF-KOI'), soon = list.find(r => r.staffId === 'STF-X');
  eq('today’s is active', [now.active, now.upcoming, now.ended], [true, false, false]);
  eq('...and next week’s is upcoming', [soon.active, soon.upcoming, soon.ended], [false, true, false]);
  eq('the teacher is named, so the list reads as a sentence', now.staffNick, 'ก้อย');

  /* THE TEACHER BEING LENT HAS TO KNOW. A class that appears on somebody's screen with no
   * explanation is a roomful of children they were not expecting that morning. */
  const mine = H.myClassCover({ staffId: 'STF-KOI' });
  eq('she sees her own cover', mine.map(r => r.className), ['Nursery Baby']);
  eq('...marked as live today', mine[0].active, true);
  eq('...and she does not see anybody else’s', H.myClassCover({ staffId: 'STF-JOY' }), []);
}
{
  // cover that has finished is not news — her own screen shows today's and what is still coming
  const { M, H } = fresh();
  H.classCoverAdd({ staffId: 'STF-H', targetId: 'STF-KOI', className: 'Nursery Baby' });
  M.classCover[0].From = shift(-9); M.classCover[0].To = shift(-8);
  eq('finished cover is off her screen', H.myClassCover({ staffId: 'STF-KOI' }), []);
  ok_('...but still on the head teacher’s list, marked ended',
    H.classCoverList({ staffId: 'STF-H' })[0].ended === true);
}

console.log('\n7) the wiring that would make it save nothing');
{
  ok_('the sheet is declared', /classCover: *\{ wb: 'MAIN', sheet: 'CLASS_COVER' \}/.test(gasEng));
  ok_('...with its columns', /CLASS_COVER: *\[[^\]]*'From', 'To'[^\]]*\]/.test(gasEng));
  /* NEITHER NAME STARTS WITH A MUTATING VERB — "class…" is not in MUTATING_RE — so both would have
   * run without the server's write lock AND left the caller looking at their own stale list. */
  const namesOf = s => (String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*:)/g) || []);
  const cW = namesOf((apiJs.match(/const WRITES = \{([\s\S]*?)\};/) || [, ''])[1]);
  const sW = namesOf((codeGs.match(/var WRITES_ACTIONS_ = \{([\s\S]*?)\};/) || [, ''])[1]);
  ['classCoverAdd', 'classCoverRemove'].forEach(n => {
    ok_(n + ' is a write on the client', cW.indexOf(n) >= 0);
    ok_('...and on the server', sW.indexOf(n) >= 0);
  });
  ok_('the built engine carries it', /classCoverAdd: p =>/.test(engGs) && /function coverClassesOn_/.test(engGs));
  /* ONE PLACE decides which classes a teacher covers, and cover is folded in THERE — not bolted onto
   * the four screens that happen to ask. Ten call sites read it; a second rule would leave some of
   * them showing the class list and others refusing to open a child in it. */
  ok_('cover is folded into coveredClasses_ itself',
    /coverClassesOn_\(staff\.StaffID, onDate\)\.forEach\(n=>names\[n\]=1\);/.test(engGs));
}

console.log('\n8) what the two screens show');
{
  ok_('the head teacher gets the form on the organize screen', /function orgCoverCard\(teachers, deps, cover\)/.test(app));
  ok_('...reached from their own home', /onclick="T_organize\(\)"/.test(app));
  ok_('both dates default to today, so "one day" is no typing', /id="cvFrom" min="\$\{today\}" value="\$\{today\}"/.test(app)
    && /id="cvTo" min="\$\{today\}" value="\$\{today\}"/.test(app));
  ok_('...and the end date follows the start rather than waiting to refuse it', /window\.CV_syncTo=\(\)=>/.test(app));
  ok_('the rows say live / upcoming / ended', /r\.active\?`<span class="pill ok">/.test(app));
  ok_('the covering teacher is told on her own home screen', /<div id="tcover"><\/div>/.test(app)
    && /p_cover\.then\(rows=>/.test(app));
  /* Same tick as the home batch — Apps Script runs ONE execution at a time per user, so a call
   * placed after an await is another queued execution in front of the busiest screen of the day. */
  ok_('...fetched with the rest of that screen, not after it',
    /const p_cover   = api\('myClassCover',\{staffId:USER\.staffId\}\)\.catch\(\(\)=>null\);/.test(app));
  ok_('...and it says her own classes are unchanged', /ชั้นเรียนประจำของคุณไม่เปลี่ยนแปลง/.test(app));
  /* A HEAD TEACHER MAY LEND SOMEBODY OUT BUT MAY NOT MOVE THEM PERMANENTLY (canCover_ vs
   * canOrganize_), so they get the card on a page of its own rather than the drag grid they cannot
   * use — a screen full of controls that answer with a refusal is worse than not offering them. */
  ok_('the head teacher gets cover on a page of its own', /window\.T_cover = async \(\)=>\{/.test(app));
  ok_('...offered only when they do NOT already have the grid',
    /\$\{\(!canOrg && canCover\)\?`<button class="btn sm outline" onclick="T_cover\(\)">/.test(app));
  ok_("...and Department='*' is what makes somebody a head teacher",
    /const canCover = canOrg \|\| String\(me0\.Department\|\|''\)==='\*';/.test(app));
  ok_('one reload knows which of the two screens it is on',
    /const CV_reload = \(\)=> \(window\.__cvStandalone \? T_cover\(\) : ADMIN_SUB_organize\(\)\);/.test(app));
  ok_('the server draws the same line, and is the one that decides',
    /const canCover_ = staff => canOrganize_\(staff\) \|\| headTeacher_\(staff\);/.test(engGs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
