/**
 * tools/test_journal_unlock_past.js — two fixes the ผอ. asked for on 2026-11-15
 *   node tools/test_journal_unlock_past.js
 *
 * 1) สมุดบันทึกประจำวัน: the admin unlocked น้องธันวา's report of 12/11 and the teacher could read it
 *    but not correct it — the entry form only ever held TODAY. Decided with the ผอ.:
 *      · the family does not see the report while it is unlocked; it comes back when it is sent again
 *      · the teachers of that class + the head teacher + the admin may correct and send it
 *      · the teacher who wrote it is told in the app (🔔), and the home screen lists what is waiting
 *      · the old content is what the form opens with — nothing is typed again
 * 2) ติดตามการขาดเรียน kept counting: every day away since the app began. Now only the run of days
 *    away AFTER the child's last check-in; a child who comes back drops off; a new absence starts
 *    the count again. The teacher child-rate (pay) has its own monthly count and must not move.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond, extra) { console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond || extra === undefined ? '' : '  ' + JSON.stringify(extra))); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

const TODAY = '2026-11-15';
function boot(over) {
  over = over || {};
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: '', AbsenceRateExcludeDays: 6 },
    students: [
      { StudentID: 'S1', Nickname: 'ธันวา', NameTH: 'ธันวา ใจดี', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'P1' },
      { StudentID: 'S2', Nickname: 'มายด์', NameTH: 'มายด์ ดี', Class: 'Nursery 2', Status: 'ACTIVE', ParentID: 'P2' }],
    staff: [
      { StaffID: 'A1', NameTH: 'แอดมิน', Department: '*', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2020-01-01' },
      { StaffID: 'T1', NameTH: 'ครูเอ', Department: 'Nursery 1', Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', StartDate: '2020-01-01' },
      { StaffID: 'T2', NameTH: 'ครูบี', Department: 'Nursery 2', Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', StartDate: '2020-01-01' }],
    classes: [{ ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }],
    journals: over.journals || [], absenceLog: over.absenceLog || [], studentLeaves: over.studentLeaves || [],
    studentCheckins: over.studentCheckins || [], absenceFollowups: over.absenceFollowups || [], absenceFollowupLogs: over.logs || [],
    studentAttendanceToday: [], checkinStudent: [], holidays: [], parents: [], userLinks: [], staffGroups: [], workSchedule: []
  };
  const at = new Date(TODAY + 'T10:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set, Map };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const J = (sid, date, status, extra) => Object.assign({ StudentID: sid, Date: date, TeacherID: 'T1', Status: status, Mood: 'Happy', Theme: 'ใบไม้' }, extra || {});

console.log('\n1) engine — an unlocked past report can be corrected and sent again');
{
  const { H, M } = boot({ journals: [J('S1', '2026-11-12', 'SUBMITTED', { SubmittedAt: '2026-11-12 16:00' })] });
  H.unlockJournal({ studentId: 'S1', date: '2026-11-12' });
  eq('unlock: back to a draft, the content kept', [M.journals[0].Status, M.journals[0].Theme], ['DRAFT', 'ใบไม้']);
  eq('...and the family does not see it while it is unlocked', H.getJournal({ studentId: 'S1', date: '2026-11-12' }), null);
  H.submitJournal({ studentId: 'S1', staffId: 'T1', date: '2026-11-12', submit: false, Mood: 'Happy', Theme: 'ใบไม้ (แก้)' });
  eq('a draft save on that day lands on that day — not today', M.journals.map(j => [j.Date, j.Status, j.Theme]), [['2026-11-12', 'DRAFT', 'ใบไม้ (แก้)']]);
  H.submitJournal({ studentId: 'S1', staffId: 'T1', date: '2026-11-12', submit: true, Mood: 'Happy', Theme: 'ใบไม้ (แก้)' });
  eq('sending it: SUBMITTED again, the original author kept', [M.journals[0].Status, M.journals[0].TeacherID], ['SUBMITTED', 'T1']);
  ok_('...and the family sees the corrected one', (H.getJournal({ studentId: 'S1', date: '2026-11-12' }) || {}).Theme === 'ใบไม้ (แก้)');
  let code = ''; try { H.submitJournal({ studentId: 'S1', staffId: 'T1', date: '2026-11-12', submit: false, Mood: 'Happy' }); } catch (e) { code = e.code; }
  eq('once sent it is locked again', code, 'JOURNAL_LOCKED');
}

console.log('\n2) engine — what waits on the teacher\'s home screen');
{
  const { H } = boot({ journals: [
    J('S1', '2026-11-12', 'DRAFT'),                                   // unlocked
    J('S1', '2026-11-13', 'SUBMITTED'),                               // sent — not waiting
    J('S2', '2026-11-11', 'DRAFT', { TeacherID: 'T2' }),              // another class
    J('S1', TODAY, 'DRAFT'),                                          // today is the class screen's job
    J('S1', '2026-09-01', 'DRAFT')] });                               // older than 30 days
  eq('a teacher sees their own class\'s past drafts only', H.journalDraftsPending({ staffId: 'T1' }).map(r => [r.studentId, r.date, r.nick]), [['S1', '2026-11-12', 'ธันวา']]);
  eq('the admin sees the school, oldest first', H.journalDraftsPending({ staffId: 'A1' }).map(r => r.studentId + '@' + r.date), ['S2@2026-11-11', 'S1@2026-11-12']);
  eq('🔒 no staffId (a family session) → nothing', H.journalDraftsPending({}), []);
}

console.log('\n3) engine — the absence list counts only the current run');
{
  const L = (sid, d) => ({ StudentID: sid, Date: d, Reason: 'ป่วย', Type: 'ลาป่วย' });
  // ธันวา: away 3 days in September, came back, away 2 days now. มายด์: away 3 days, came back yesterday.
  const { H, M } = boot({
    studentLeaves: [L('S1', '2026-09-01'), L('S1', '2026-09-02'), L('S1', '2026-09-03'), L('S1', '2026-11-13'), L('S1', '2026-11-14'),
                    L('S2', '2026-11-10'), L('S2', '2026-11-11'), L('S2', '2026-11-12'), L('S1', '2026-11-20')],
    studentCheckins: [{ StudentID: 'S1', Date: '2026-09-04', InTime: '08:00' }, { StudentID: 'S1', Date: '2026-11-12', InTime: '08:00' },
                      { StudentID: 'S2', Date: '2026-11-14', InTime: '08:00' }],
    absenceFollowups: [{ StudentID: 'S1', Status: 'ติดตามแล้ว', Note: 'กันยา', Date: '2026-09-02' }]
  });
  const rows = H.absenceReport({ minDays: 2 });
  eq('a child who came back is off the list (มายด์)', rows.map(r => r.studentId), ['S1']);
  eq('ธันวา counts this run only: 2, not 5 — and next week\'s leave is not an absence yet', [rows[0].count, rows[0].firstDate, rows[0].lastDate], [2, '2026-11-13', '2026-11-14']);
  eq('September\'s "followed up" is not this run\'s status', [rows[0].status, rows[0].note], ['', '']);
  eq('the badge agrees with the list', H.absenceWatchCount({}).watch, 1);
  M.studentCheckins.push({ StudentID: 'S1', Date: TODAY, InTime: '08:10' });
  eq('ธันวา checks in today → off the list', H.absenceReport({ minDays: 2 }).map(r => r.studentId), []);
  eq('...and the badge is empty', H.absenceWatchCount({}).watch, 0);
  // the teacher's pay counts the month on its own and must not move with the list
  const rated = H.ratedChildCount({ month: '2026-11' });
  eq('💵 the child-rate still counts November\'s days away (มายด์ 3)', (rated.students || []).filter(s => s.studentId === 'S2').map(s => s.away), [3]);
}

console.log('\n4) on Apps Script — unlocking tells the teacher who wrote it');
{
  const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin', 'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'OtStaff', 'Payroll', 'Backup', 'PaySlips', 'Slips', 'Perf', 'GasEngine', 'Engine', 'Day6', 'Dspm', 'Journal']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var main = getMainSpreadsheet_();
    appendObject_(sheet_(main, 'STUDENTS'), { StudentID: 'S1', Name: 'ธันวา ใจดี', Nickname: 'ธันวา', Class: 'Nursery 1', Status: 'ACTIVE' });
    appendObject_(sheet_(main, 'DAILY_JOURNAL'), { Date: '2026-11-12', StudentID: 'S1', TeacherID: 'T1', Status: 'SUBMITTED', SubmittedAt: '2026-11-12 16:00', Theme: 'ใบไม้' });
    var r = handleUnlockJournal({ studentId: 'S1', date: '2026-11-12', staffId: 'A1' });
    var j = readObjects_(sheet_(main, 'DAILY_JOURNAL'))[0];
    var inbox = readObjects_(sheet_(main, 'ADMIN_INBOX')).map(function (x) { return [x.StaffID, x.Category, x.Ref, /ธันวา/.test(x.Text) && /2026-11-12/.test(x.Text)]; });
    return JSON.stringify({ r: r, j: [j.Status, j.Theme], inbox: inbox });
  }));
  eq('the row is a draft again, content kept', res.j, ['DRAFT', 'ใบไม้']);
  eq('🔔 one bell for the teacher who wrote it, pointing at the child and the day', res.inbox, [['T1', 'journal', 'journal|S1|2026-11-12', true]]);
  ok_('...and the reply says someone was told', res.r.notified === 1);
}

console.log('\n5) the screen');
{
  ok_('the form takes a day', /window\.T_journal = async \(sid, date\) =>/.test(app));
  ok_('...asks for THAT day\'s entry', /api\('getJournal',day\?\{studentId:sid,date:day,role:USER\.role\}/.test(app));
  ok_('...and saves back to that day', /submit:!!submit,\.\.\.\(J_DATE\?\{date:J_DATE\}:\{\}\)/.test(app));
  ok_('a sent past report stays read-only (the existing branch is kept)', /if\(j && !draft\)\{ app\.innerHTML=/.test(app));
  ok_('the reader offers "correct and send again" on a draft of any day', /const canEdit=\(isToday \|\| jIsDraft\(j\)\)/.test(app) && /T_journal\('\$\{esc\(sid\)\}','\$\{esc\(day\)\}'\)/.test(app));
  ok_('the admin\'s edit no longer refuses an earlier day', !/Only today’s report can be edited/.test(app));
  ok_('the class screen on an earlier day opens a draft in the form', /\(done && jIsDraft\(done\)\)\s*\? B\('', `T_journal\('\$\{s\.StudentID\}','\$\{esc\(onDay\)\}'\)`/.test(app));
  ok_('the bell opens the form for that child and day', /T_journal\(sid,date\); else if\(window\.A_viewJournal\)/.test(app));
  ok_('the home screen lists what is waiting', /api\('journalDraftsPending',\{staffId:USER\.staffId\}\)/.test(app) && /id="tjfix"/.test(app));
  ok_('the absence screen says how it counts now', /นับตั้งแต่เช็คอินครั้งล่าสุด/.test(app));
  const code = R('src/Code.gs');
  ok_('🔒 families cannot ask for the drafts list', /journalDraftsPending: '/.test(code.slice(code.indexOf('var NOT_FOR_FAMILIES_'), code.indexOf('var NOT_FOR_FAMILIES_') + 3000)));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
