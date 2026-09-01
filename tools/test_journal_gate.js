/**
 * tools/test_journal_gate.js — "is this child checked in?" must have ONE answer.
 *   node tools/test_journal_gate.js
 *
 * Reported 2026-09-01 by ครูก้อย: อิงใจ's บันทึก button was dead — greyed out, "ต้องเช็คอินนักเรียน
 * ก่อนจึงจะบันทึกได้" — while the school dashboard listed her under "อยู่ที่โรงเรียน" the whole time,
 * and refreshing several times changed nothing.
 *
 * Three places in one engine asked the same question three ways:
 *
 *   dashboard              a ? a.Status : 'ABSENT'                    → IN
 *   journal (server guard) a.Status==='IN' || a.Status==='OUT'        → allowed
 *   classList (the button) !!at.inTime                                → NOT CHECKED IN
 *
 * The first two ask whether a check-in HAPPENED. The third asked whether we also have a TIME STRING
 * for it — so a row whose Time cell came back blank disabled the teacher's work for the whole day,
 * for a journal the server would have accepted had she been able to press the button.
 *
 * Notice which way round the failure went: the strictest test was on the BUTTON, where there is no
 * error message and nothing to retry — just a grey rectangle and a teacher refreshing. The fact and
 * the time are two different questions, and only the fact may decide whether somebody can work.
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
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var today = gasToday_();

  appendObject_(sheet_(HR, 'STAFF'), { StaffID: 'STF-KOI', Name: 'ครูก้อย', Nickname: 'ก้อย',
    Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', Department: 'Nursery 1',
    StartDate: '2025-01-01', RequireCheckin: true });
  appendObject_(sheet_(MAIN, 'CLASSES'), { ClassID: 'C1', ClassName: 'Nursery 1', TeacherID: 'STF-KOI' });

  var kid = function (id, nick) {
    appendObject_(sheet_(MAIN, 'STUDENTS'), { StudentID: id, Name: 'ด.ญ. ' + nick, Nickname: nick,
      Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2025-05-01', Plan: 'FULL', DOB: '2025-06-13' });
  };
  kid('STD-THAM', 'ธาม');      // normal: IN with a time
  kid('STD-ING', 'อิงใจ');      // the reported child: IN, and the Time cell came back blank
  kid('STD-OUT', 'ยูฟ่า');      // already picked up — the LAST event of the day is OUT
  kid('STD-NONE', 'พีรวิชญ์');  // genuinely not checked in — must STAY blocked

  var ci = sheet_(MAIN, 'CHECKIN_STUDENT');
  appendObject_(ci, { Date: today, StudentID: 'STD-THAM', Type: 'IN', Time: '07:20' });
  appendObject_(ci, { Date: today, StudentID: 'STD-ING', Type: 'IN', Time: '' });     // ← the fault
  appendObject_(ci, { Date: today, StudentID: 'STD-OUT', Type: 'IN', Time: '07:38' });
  appendObject_(ci, { Date: today, StudentID: 'STD-OUT', Type: 'OUT', Time: '16:50' });

  var o = {}, list = engineDispatch_('classList', { staffId: 'STF-KOI' });
  o.rows = {};
  list.students.forEach(function (s) {
    o.rows[s.Nickname] = { inToday: s.inToday, outToday: s.outToday, inTime: s.inTime,
                           outTime: s.outTime, attStatus: s.attStatus };
  });

  var dash = engineDispatch_('dashboard', {});
  var c1 = dash.classes.filter(function (c) { return c.className === 'Nursery 1'; })[0] || {};
  o.dash = {}; (c1.students || []).forEach(function (s) { o.dash[s.nick] = { status: s.status, in: s.in, out: s.out }; });

  // ...and the question the button is really standing in for: will the server take the journal?
  var writeJournal = function (sid) {
    try { engineDispatch_('submitJournal', { staffId: 'STF-KOI', studentId: sid, date: today,
            Mood: 'ดี', Note: 'สบายดี' }); return 'ok'; }
    catch (e) { return (e && (e.apiCode || e.code)) || String(e && e.message); }
  };
  o.journalIng = writeJournal('STD-ING');
  o.journalNone = writeJournal('STD-NONE');
  return JSON.stringify(o);
}));

console.log('\n1) THE CHILD THE DASHBOARD CALLED PRESENT');
{
  /* อิงใจ: one IN event today, no time on it. The dashboard has always shown her as present; the
   * class list showed her as a child nobody had checked in, with a dead บันทึก button. */
  eq('the dashboard says she is here', res.dash['อิงใจ'].status, 'IN');
  eq('...and now the class list agrees', res.rows['อิงใจ'].inToday, true);
  eq('...which is what un-greys the button', res.rows['อิงใจ'].attStatus, 'IN');
  /* THE TIME IS STILL MISSING and is not invented — a blank stays blank, and the screen says so
   * rather than printing a confident wrong time. */
  eq('the missing time is still missing, not guessed', res.rows['อิงใจ'].inTime, '');
  ok_('...and the screen says so instead of dropping the pill entirely', /\(ไม่มีเวลา\)/.test(app));
  /* The proof that the button was the odd one out: the SERVER would have taken the journal all
   * along. The teacher was refused by a grey rectangle, not by a rule. */
  eq('the server would have accepted her journal all along', res.journalIng, 'ok');
}

console.log('\n2) THE ONES THAT MUST NOT CHANGE');
{
  eq('a normal check-in still reads normally', [res.rows['ธาม'].inToday, res.rows['ธาม'].inTime], [true, '07:20']);
  // a child already picked up is still "in today" — that is what keeps the journal writable after
  // pick-up, and what makes the button say รับกลับ rather than เช็คอิน
  eq('a child already picked up is in AND out', [res.rows['ยูฟ่า'].inToday, res.rows['ยูฟ่า'].outToday], [true, true]);
  eq('...with both times intact', [res.rows['ยูฟ่า'].inTime, res.rows['ยูฟ่า'].outTime], ['07:38', '16:50']);
  /* THE GATE STILL EXISTS. Loosening "checked in" must not turn it into "everybody" — a child who
   * genuinely has not arrived has no day to write about, and the server still refuses. */
  eq('a child who has not arrived is still not checked in', res.rows['พีรวิชญ์'].inToday, false);
  eq('...and the server still refuses the journal', res.journalNone, 'NOT_CHECKED_IN');
}

console.log('\n3) ONE DEFINITION, WRITTEN DOWN');
{
  ok_('the fact is computed once, next to the time it is not',
    /const seen = !lv\.onLeave && a && \(a\.Status==='IN' \|\| a\.Status==='OUT'\);/.test(engine));
  ok_('...and the row reports the fact, falling back to the time',
    /inToday:at\.checkedIn\|\|!!at\.inTime, outToday:at\.pickedUp\|\|!!at\.outTime/.test(engine));
  ok_('the built engine carries it too', /checkedIn: !!seen, pickedUp:/.test(gasEngine));
  ok_('the reason is written where the trap was', /THE FACT AND THE TIME ARE TWO DIFFERENT QUESTIONS/.test(engine));
  /* A child on leave is not "checked in" no matter what stray row exists — the leave IS the record,
   * and that rule predates this fix and must survive it. */
  ok_('a leave still wins over any check-in row', /const seen = !lv\.onLeave/.test(engine));
}

console.log('\n4) THE DASHBOARD PRINTS THE TIME IT HAS');
{
  /* deriveStudentToday_ on GAS only ever sets Status and Time — never CheckIn — so the admin
   * dashboard's `in:` column read a field that is always blank. teacherClassAttendance has had the
   * ||a.Time fallback all along; this is the same fallback, in the other place. */
  eq('a normal arrival shows its time on the dashboard', res.dash['ธาม'].in, '07:20');
  eq('...and a pick-up shows its own', res.dash['ยูฟ่า'].out, '16:50');
  ok_('the fallback is explained', /deriveStudentToday_ only ever sets Status and Time/.test(engine));
}

console.log('\n5) A LEAVER IS NOT SOMEBODY TO PUT IN A CLASS');
{
  /* Reported the same day: ครูฉำฉา and ครูลิน were both in "พนักงานที่ยังไม่ได้จัดชั้น", which reads
   * as five people waiting for a class when two of them no longer work here — and dropping one into
   * a Nursery would have put a leaver back on a class list. */
  ok_('the organiser drops them from every column and the unassigned tray',
    /const teachers = staff\.filter\(s=>canClass\(s\) && !s\.ended\);/.test(app));
  ok_('...and the reason is written there', /leaver back on a class list/.test(app));
  // the screen is a list; the rule has to live on the server or it is only tidiness
  ok_('the server refuses the move as well', /if\(staffEnded_\(s\)\) fail\('ENDED','สิ้นสุดการทำงานแล้ว/.test(engine));
  ok_('...in the built engine too', /if\(staffEnded_\(s\)\) fail\('ENDED'/.test(gasEngine));
  ok_('ENDED is already known to be a refusal, not a crash', /ENDED: 1,/.test(R('src/Perf.gs')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
