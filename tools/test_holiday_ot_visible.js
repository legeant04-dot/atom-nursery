/**
 * tools/test_holiday_ot_visible.js — a rule nobody can see is the same as a rule that is not there.
 *   node tools/test_holiday_ot_visible.js
 *
 * REPORTED 2026-08-24, about Saturday 22/08/26: "มี OT คุณครูจอยที่ต้องดูแลน้องโมน่า หน้าหลักไม่แสดง
 * ชื่อนักเรียนและครูที่ถูกระบุให้ทำ OT วันหยุด คุณครูและนักเรียนไม่สามารถ Check-in ได้ โดยคุณครูใช้คำขอ
 * ลงเวลา ส่วนนักเรียนคุณครูลงเวลาให้"
 *
 * The SERVER was right. staffCheckin has opened a closed day for the person holding OT วันหยุด since
 * 2026-08-21, and assertStudentDayOpen_ has opened it for a named child since 2026-08-20. Every
 * SCREEN, though, still asked the DAY-level question — schoolDay.closed — and hid the buttons:
 *
 *   1. the teacher's work-time card printed "วันนี้โรงเรียนหยุด" with no clock-in button at all,
 *      so the only way in was a คำขอลงเวลา — which is what she did;
 *   2. the ➕ "a child turned up who is not on the list" button lives INSIDE the children's card,
 *      and that card was hidden when the list was empty — so the one situation the button exists
 *      for was the one situation it could not be reached in;
 *   3. nothing anywhere named the teacher or the child, so from outside there was no way to tell
 *      "it was never recorded" from "it was recorded and never displayed". diagDay now says which.
 *
 * `schoolDay` cannot answer this: it answers for the SCHOOL, and OT วันหยุด is about one person. So
 * the answer travels with that person — myAttendanceToday.holidayOT — and with the day's list.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), ci = R('src/Checkin.gs');

const DAY = '2026-08-22';           // a Saturday — the day it happened
const WORKDAY = '2026-08-20';       // an ordinary Thursday

function boot(over, day) {
  over = over || {};
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], OTRatePerHour: 100, GPS_Lat: 0, GPS_Lng: 0, Radius: 999999,
      DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00', LateGraceMinutes: 0, Departments: '' },
    students: [{ StudentID: 'S1', Nickname: 'โมน่า', NameTH: 'ก ข', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1' }],
    staff: [
      { StaffID: 'STF-1', NameTH: 'ครูจอย', Nickname: 'จอย', Department: 'Nursery 1', Role: 'Teacher', StaffGroup: 'G1', StartDate: '2020-01-01', Status: 'ACTIVE' },
      { StaffID: 'STF-2', NameTH: 'ครูก้อย', Nickname: 'ก้อย', Department: 'Nursery 2', Role: 'Teacher', StaffGroup: 'G1', StartDate: '2020-01-01', Status: 'ACTIVE' }
    ],
    staffGroups: [{ GroupName: 'G1', CheckInTime: '08:00', CheckOutTime: '17:00' }],
    classes: [{ ClassName: 'Nursery 1' }], parents: [{ ParentID: 'PAR-1' }],
    otRecords: over.otRecords || [], holidayAttend: over.holidayAttend || [],
    holidays: [], workSchedule: [], staffAttendanceToday: over.staffAttendanceToday || [], staffAttendanceHistory: [],
    otDaily: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    userLinks: [], leaves: [], payments: [], studentCharges: [], prepayments: [], paymentSlips: [],
    journals: [], comments: [], payroll: [], payrollConfig: {}, absenceLog: [], dspmCriteria: [],
    activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [],
    assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: []
  };
  const at = new Date((day || DAY) + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const HOLOT = d => [{ OTRecordID: 'OTR-1', StaffID: 'STF-1', Date: d || DAY, Kind: 'HOLIDAY',
  Amount: 800, Status: 'APPROVED', Hours: 0, Note: 'ดูแลน้องโมน่า' }];
const ATT = () => [{ Date: DAY, StudentID: 'S1', AddedBy: 'STF-1' }];

console.log('\n1) the teacher who holds the OT is told so on her own card');
{
  const { H } = boot({ otRecords: HOLOT() });
  const a = H.myAttendanceToday({ staffId: 'STF-1' });
  eq('she has holiday OT today', a.holidayOT, true);
  eq('...for the agreed amount', a.holidayOTAmount, 800);
  eq('...and the reason travels with it', a.holidayOTNote, 'ดูแลน้องโมน่า');
  // the school IS shut — that has not changed, and must not
  eq('the day is still a closed day for the school', H.schoolDay({}).closed, true);
  // ...and the server would take her punch, which is the whole point
  eq('...and the server accepts her clock-in', H.staffCheckin({ staffId: 'STF-1', lat: 0, lng: 0 }).holidayOT, true);
}
{
  const { H } = boot({ otRecords: HOLOT() });
  eq('a colleague with no holiday OT is not told she has one', H.myAttendanceToday({ staffId: 'STF-2' }).holidayOT, false);
}
{
  // an ordinary working day must not pay for this: OT วันหยุด cannot exist on one (assertHolidayDate_),
  // so the question is not even asked and OT_RECORDS stays unread on the home screen's critical path
  const { H } = boot({ otRecords: HOLOT(WORKDAY) }, WORKDAY);
  eq('nothing is claimed on a working day', H.myAttendanceToday({ staffId: 'STF-1' }).holidayOT, false);
  ok_('...and the read is gated on the day being shut', /schoolDayFor_\(todayLocal\(\)\)\.closed/.test(eng));
}

console.log('\n2) the card that draws the button stops asking the wrong question');
{
  ok_('the closed-day notice yields to this teacher\'s holiday OT',
    /day0&&day0\.closed&&!\(att&&att\.holidayOT\)/.test(app));
  ok_('...and she is shown what the day is, and that it is not paid by the hour',
    /วันนี้คุณมี OT วันหยุด/.test(app) && /ไม่นับสายและไม่มี OT รายชั่วโมงเพิ่ม/.test(app));
  ok_('the reason is written where the flag is made', /the card that draws the button did not/.test(eng));
}

console.log('\n3) the day\'s list names the staff as well as the children');
{
  const { H } = boot({ otRecords: HOLOT(), holidayAttend: ATT(),
    staffAttendanceToday: [{ StaffID: 'STF-1', CheckIn: '08:55', CheckOut: '', Status: 'IN' }] });
  const h = H.holidayAttendList({});
  eq('the day is shut', [h.closed, h.date], [true, DAY]);
  eq('one child is expected', [h.count, h.students[0].nick], [1, 'โมน่า']);
  eq('one teacher is in', h.staffCount, 1);
  eq('...by name, not by id', h.staff[0].nick, 'จอย');
  eq('...with the money and the reason', [h.staff[0].amount, h.staff[0].note], [800, 'ดูแลน้องโมน่า']);
  eq('...and whether she has actually arrived', h.staff[0].checkIn, '08:55');
  eq('the ids stay for "is this person on it"', h.staffIds, ['STF-1']);
}
{
  // THE 22/08 CASE ITSELF: the OT exists, nobody was ticked. The list must still come back, or the
  // teacher has no way to add the child who turns up.
  const { H } = boot({ otRecords: HOLOT() });
  const h = H.holidayAttendList({});
  eq('no children, but the teacher is still reported', [h.count, h.staffCount], [0, 1]);
  ok_('...and the card is drawn for her anyway', /if\(!h\|\|!h\.closed\|\|\(!h\.count&&!_mine\)\)/.test(app));
  ok_('...so the ➕ add-a-child button is reachable', /T_holAddStudent\('\$\{esc\(h\.date\)\}'\)/.test(app));
  ok_('...and it says the list is empty rather than looking broken', /ยังไม่มีนักเรียนในรายชื่อวันนี้/.test(app));
}
{
  const { H } = boot({});   // an ordinary shut Saturday with no arrangement at all
  const h = H.holidayAttendList({});
  eq('nothing arranged, nothing to show', [h.count, h.staffCount], [0, 0]);
  ok_('...and the dashboard draws no card', /if\(!h\|\|!h\.closed\|\|\(!h\.count&&!\(h\.staff\|\|\[\]\)\.length\)\)/.test(app));
}

console.log('\n4) the Admin dashboard says who is at school on a day the school is shut');
{
  const dash = app.slice(app.indexOf('WHO IS AT SCHOOL ON A DAY THE SCHOOL IS SHUT'), app.indexOf("const _anns=await api('announcements')"));
  ok_('there is a card for it', dash.length > 500 && /id=\"aholot\"|aholot/.test(app));
  ok_('it names the staff', /คุณครูที่ทำ OT วันหยุด/.test(dash));
  ok_('...and the children', /นักเรียนที่มาวันนี้/.test(dash));
  ok_('...and says who has not clocked in yet', /ยังไม่ได้ลงเวลา/.test(dash));
  ok_('the incident is written down where the card is made', /22\/08\/26 ครูจอย/.test(app) || /Saturday 22\/08\/26/.test(app));
}

console.log('\n5) diagDay can tell "never recorded" from "recorded and not shown"');
{
  ok_('it reports the day\'s OT rows', /holidayOT: holOT/.test(ci));
  ok_('...including the Kind, which is what decides it', /kind: String\(r\.Kind \|\| ''\)/.test(ci));
  ok_('...and whether each row actually opens the day', /opensDay: otIsHoliday_\(r\) &&/.test(ci));
  ok_('it reports the named children', /holidayStudents: holKids/.test(ci));
  ok_('...naming a child who is on the list but not in the register', /\(ไม่พบในทะเบียน\)/.test(ci));
  ok_('each person carries the answer handleStaffCheckin itself uses', /holidayOT: staffHasHolidayOT_\(s\.StaffID, ds\)/.test(ci));
  ok_('the screen says when nothing was recorded at all', /ไม่มีแถว OT ของวันนี้เลย/.test(app));
  ok_('...and when no child may be checked in', /นักเรียนจะลงเวลาในวันนี้ไม่ได้/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
