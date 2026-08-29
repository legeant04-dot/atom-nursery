/**
 * tools/test_not_started_yet.js — a child who has not started yet is not absent; they are not here.
 *   node tools/test_not_started_yet.js
 *
 * ASKED 2026-08-24: "ระบบตรวจสอบวันที่เริ่มเรียนจริงของนักเรียน หากยังไม่ถึงวันเริ่มเรียนยังไม่เอา
 * รายชื่อเข้ามาในระบบ หลักการเดียวกันกับนักเรียนลาชั่วคราว ไม่เอารายชื่อเข้ามา ปิด Check-in/out และ
 * แจ้งวันที่เริ่มเรียนจริง จนกว่าจะถึงวันนั้น มาวันที่ 01/10/26 ก็เปิดระบบการใช้งานของผู้ปกครองวันที่
 * 01/10/26 และระบบเอารายชื่อเข้ามาในชั้นเรียน"
 *
 * A family is entered days or weeks before the first day so the deposit and the first month can be
 * billed — that part already worked (EnrollDate drives the first bill). But the child was on the
 * CLASS LIST from the moment the record was typed in: counted against the class's attendance
 * percentage, marked ขาด every morning, and their parent shown a live drop-off button for a nursery
 * the child does not go to yet.
 *
 * Same treatment as a temporary leave, for the same reason: ON the billing lists, OFF every list
 * about who is here. And it turns itself on — the first day arrives, the child is on the roster and
 * the button is live, with nobody having to remember to switch anything.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), ci = R('src/Checkin.gs');

const START = '2026-10-01';   // "มาวันที่ 01/10/26"
function boot(today) {
  const M = {
    config: { Plans: [{ id: 'M5900', labelTH: 'รายเดือน 5,900', price: 5900 }], LeaveQuota: {},
      BigCleaningDays: [], Departments: 'Nursery 1', GPS_Lat: 0, GPS_Lng: 0, Radius: 999999,
      DefaultStudentIn: '08:00', DefaultStudentOut: '17:00' },
    students: [
      { StudentID: 'NEW', NameTH: 'เจนธนินท์', Nickname: 'เอ็นเจ', Class: 'Nursery 1', Status: 'ACTIVE',
        Plan: 'M5900', ParentID: 'PAR-1', EnrollDate: START },
      { StudentID: 'OLD', NameTH: 'อีกคน', Nickname: 'บี', Class: 'Nursery 1', Status: 'ACTIVE',
        Plan: 'M5900', ParentID: 'PAR-2', EnrollDate: '2026-05-01' }
    ],
    parents: [{ ParentID: 'PAR-1' }, { ParentID: 'PAR-2' }],
    userLinks: [{ ParentID: 'PAR-1', StudentID: 'NEW' }, { ParentID: 'PAR-2', StudentID: 'OLD' }],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครู', Nickname: 'ครู', Role: 'Teacher', Department: 'Nursery 1', Classes: 'Nursery 1', Status: 'ACTIVE' }],
    classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], staffGroups: [], workSchedule: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], leaves: [], absenceLog: [], dspmCriteria: [],
    activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [],
    assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: []
  };
  const at = new Date(today + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const BEFORE = '2026-09-20', DAY1 = START, AFTER = '2026-10-05';

console.log('\n1) before the first day: off every list about who is here');
{
  const { H } = boot(BEFORE);
  const cl = H.classList({ staffId: 'T1' });
  eq('not on the class list', cl.students.map(s => s.StudentID), ['OLD']);
  const d = H.dashboard({ staffId: 'ADM' });
  const n1 = d.classes.find(c => c.className === 'Nursery 1');
  eq('...so the class is not one short in its own attendance count', n1.total, 1);
  eq('...and nobody is marked absent who was never expected', n1.students.map(s => s.studentId), ['OLD']);
}
{
  const { H } = boot(BEFORE);
  throws_('the parent cannot drop them off', () =>
    H.parentCheckin({ studentId: 'NEW', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 }), 'วันแรกของการมาเรียนคือ 2026-10-01');
  throws_('...nor can a teacher, on their behalf', () =>
    H.staffStudentCheckin({ studentId: 'NEW', type: 'IN', staffId: 'T1', remark: 'แม่มาส่ง' }), '2026-10-01');
  ok_('...and the refusal names the DAY rather than just saying no',
    /ยังลงเวลาไม่ได้จนกว่าจะถึงวันนั้น/.test(eng));
}
{
  const { H } = boot(BEFORE);
  const kids = H.parentChildren({ parentId: 'PAR-1' });
  eq('the family still sees their child', kids.map(k => k.StudentID), ['NEW']);
  eq('...told the date instead of being offered a button', [kids[0].notStarted, kids[0].startDate], [true, START]);
  ok_('the card prints it', /วันแรกของการมาเรียน/.test(app) && /k\.notStarted/.test(app));
}

console.log('\n2) ...but still billable, which is the whole reason the record exists early');
{
  const { H, M } = boot(BEFORE);
  H.issueBillsFor({ month: '2026-10', studentIds: ['NEW'], staffId: 'ADM' });
  eq('a bill can be issued before the first day', (M.payments[0] || {}).StudentID, 'NEW');
  eq('...for the month they start in', (M.payments[0] || {}).Month, '2026-10');
  const fin = H.financeSummary({ month: '2026-10' });
  ok_('...and the finance list still knows them', fin.students.some(s => s.studentId === 'NEW'));
}

console.log('\n3) the day itself: everything opens, with nobody switching anything on');
{
  const { H } = boot(DAY1);
  eq('on the class list that morning', H.classList({ staffId: 'T1' }).students.map(s => s.StudentID).sort(), ['NEW', 'OLD']);
  const r = H.parentCheckin({ studentId: 'NEW', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 });
  eq('...and the drop-off goes through', r.type, 'IN');
  eq('...the card stops saying "not started"', H.parentChildren({ parentId: 'PAR-1' })[0].notStarted, false);
}
{
  const { H } = boot(AFTER);
  eq('and it stays open afterwards', H.classList({ staffId: 'T1' }).students.length, 2);
}
{
  // a child with NO enrol date is not "not started" — most of the roll has never had one
  const { H, M } = boot(BEFORE);
  M.students.push({ StudentID: 'NODATE', NameTH: 'ไม่มีวันที่', Nickname: 'ซี', Class: 'Nursery 1', Status: 'ACTIVE' });
  eq('a blank enrol date means they are simply here', H.classList({ staffId: 'T1' }).students.map(s => s.StudentID).sort(), ['NODATE', 'OLD']);
}

console.log('\n4) the admin can see who is coming');
{
  const { H } = boot(BEFORE);
  const s = H.startingStudents();
  eq('one child starting', s.map(x => x.studentId), ['NEW']);
  eq('...with the date and how far off it is', [s[0].startDate, s[0].days], [START, 11]);
  ok_('...on the dashboard, in its own card', /A_startingCard\(d\.starting\)/.test(app) && /นักเรียนที่กำลังจะเริ่มเรียน/.test(app));
  ok_('...saying plainly what is and is not switched on for them',
    /ยังไม่นับขาด ไม่ขึ้นชื่อในชั้นเรียน และผู้ปกครองยังลงเวลาไม่ได้ · แต่ออกบิลล่วงหน้าได้แล้ว/.test(app));
  eq('nobody is "starting" once they have started', boot(DAY1).H.startingStudents().length, 0);
}

console.log('\n5) the parent is not told to wait for something that is not coming');
{
  /* The home screen printed "⏳ รอคุณครูส่งข้อมูลของวันที่ 25-08-2026" under a card that had just
   * said the first day is 01/10. There is no teacher waiting to send anything — and telling a family
   * to wait for something that is not coming is worse than telling them nothing. */
  ok_('there is one card that explains an empty journal', /function journalEmptyCard\(kid, date\)\{/.test(app));
  ok_('...used by the home screen', /journalChecklist\(j,\{parentEditable:true,student:k0\}\) : journalEmptyCard\(k0\)/.test(app));
  ok_('...and by the journal screen, so the two cannot drift apart',
    /journalChecklist\(j,\{parentEditable:true\}\):journalEmptyCard\(kid\)/.test(app));
  ok_('a child who has not started is told the date the journal begins',
    /สมุดบันทึกประจำวันจะเริ่มในวันที่ \$\{esc\(ddmmyyyy\(kid\.startDate\)\)\}/.test(app));
  ok_('...a child on leave is told the leave is the record', /วันที่ไม่ได้มาเรียนจะไม่มีสมุดบันทึก/.test(app));
  ok_('...and everybody else still just waits for the teacher', /return waitCard\(date\); \}/.test(app));
  ok_('the journal screen has the child to ask about', /const kid=\(kids\|\|\[\]\)\.find\(k=>k\.StudentID===sid\)\|\|\{\};/.test(app));

  /* THE THIRD REASON, AND THE COMMONEST ONE. Reported 2026-08-29 with a screenshot: the child's card
   * said "🏖️ วันนี้โรงเรียนหยุด · วันหยุดสุดสัปดาห์" and the journal directly beneath it said
   * "⏳ รอคุณครูส่งข้อมูลของวันที่ 29-08-2026". Nobody is at school on a Saturday, so there is no
   * teacher waiting to send anything — one screen telling a family two contradictory things, one of
   * them a promise it could not keep. It happened every weekend, to every family.
   *
   * The reasoning had already been written down for the other two cases and this one was missed. */
  ok_('a closed day says so, instead of promising a journal nobody will write',
    /sd && sd\.closedForStudents && String\(sd\.date\|\|''\)===String\(date\|\|todayStr\(\)\)/.test(app));
  ok_('...naming the holiday, the way the card above it does', /esc\(EN\(\)\?\(sd\.reasonEN\|\|'Holiday'\):\(sd\.reason\|\|'วันหยุด'\)\)/.test(app));
  ok_('...and saying why there is no journal', /วันที่ไม่มีการเรียนการสอน จะไม่มีสมุดบันทึกประจำวัน/.test(app));
  ok_('...with the window shown when the school is shut for only part of the day', /sd\.partial\?` <b>\$\{esc\(\(sd\.holStart\|\|'00:00'\)/.test(app));
  /* _SCHOOLDAY HOLDS ONE DATE'S ANSWER. Without comparing dates, opening a journal for a Tuesday in
   * June would have been told that day was a holiday because TODAY is — the new card would have
   * been a second, quieter version of the same bug. */
  ok_('a past date is never told it was a holiday because today is',
    /It holds ONE date's answer/.test(app));
  /* And the order matches the kid card directly above it (closed, then on leave), so the two halves
   * of one screen cannot give a family different reasons for the same empty day. */
  ok_('the reasons are checked in the same order the kid card uses',
    app.indexOf('sd.closedForStudents && String(sd.date') < app.indexOf("if(kid.onLeave) return"));
  ok_('the journal screen fetches the day it needs, rather than relying on home having run first',
    /api\('schoolDay',\{\}\)\.then\(d=>\{ window\._SCHOOLDAY=d; return d; \}\)\.catch\(\(\)=>null\)\]\);/.test(app));
}

console.log('\n6) both halves of the app refuse it');
{
  ok_('the engine', /const studentNotStarted_ = \(s, onDate\) =>/.test(eng));
  ok_('...checks it BEFORE the calendar, or the refusal names the wrong reason',
    eng.indexOf('if(s && studentNotStarted_(s, d)) fail') < eng.indexOf("const why=schoolClosedFor_(d, true)"));
  ok_('Apps Script does the same, and it is what runs live', /NOT_STARTED', 'วันแรกของการมาเรียนคือ '/.test(ci));
  ok_('...also before the calendar test', ci.indexOf("NOT_STARTED', 'วันแรกของการมาเรียนคือ '") < ci.indexOf('if (!isSchoolClosed_(d)) return;'));
  ok_('...and it does not swallow its own refusal in the try/catch around the sheet read',
    /catch \(e\) \{ if \(e && e\.apiCode === 'NOT_STARTED'\) throw e; \}/.test(ci));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
