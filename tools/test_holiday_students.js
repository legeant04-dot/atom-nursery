/**
 * tools/test_holiday_students.js — a closed day that is open to the people who were named for it.
 *   node tools/test_holiday_students.js
 *
 * Asked for 2026-08-21: on an OT วันหยุด day, tick the children who are coming (nicknames, grouped
 * by class). For them the day then behaves like any other — check in, check out, the history, and
 * the late-pickup charge. Tick nobody and only that teacher's own clock opens.
 *
 * The three decisions the school made when asked, because each of them is money:
 *
 *   1. The teacher is paid the LUMP SUM and nothing else. Opening their clock on a holiday would
 *      otherwise have raised a second, hourly OT record on top of the agreed amount — a double
 *      payment nobody asked for. No lateness either: a holiday has no shift to be late for.
 *   2. A child collected late IS charged, exactly as on a school day. The day is a normal day for
 *      the children who came.
 *   3. A child who is not on the list is REFUSED — and a teacher can add the name on the spot. "Who
 *      is coming" is the only thing that makes opening a closed day safe: a child nobody expected
 *      has nobody responsible for them. Refusing at the door with no way to say yes would not be a
 *      safety rule, it would be an obstacle.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), css = R('webapp/styles.css');
const ci = R('src/Checkin.gs'), par = R('src/Parent.gs'), code = R('src/Code.gs'), cfg = R('src/Config.gs'), ge = R('src/GasEngine.gs');

const DAY = '2026-08-22';   // a Saturday — shut to everyone
function boot(over, now) {
  over = over || {};
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], OTRatePerHour: 100, OTGraceMinutes: 21,
      DefaultStudentIn: '08:00', DefaultStudentOut: '17:00', GPS_Lat: 0, GPS_Lng: 0, Radius: 999999,
      DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00', LateGraceMinutes: 0, Departments: '' },
    students: [
      { StudentID: 'S1', Nickname: 'ไบร์ท', NameTH: 'ก ข', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1' },
      { StudentID: 'S2', Nickname: 'มายด์', NameTH: 'ค ง', Class: 'Nursery 2', Status: 'ACTIVE', ParentID: 'PAR-2' }
    ],
    staff: [{ StaffID: 'STF-1', NameTH: 'ครูเอ', Nickname: 'เอ', Department: '*', Role: 'Admin',
              PositionLevel: 'Admin', StaffGroup: 'G1', StartDate: '2020-01-01', Status: 'ACTIVE' }],
    staffGroups: [{ GroupName: 'G1', CheckInTime: '08:00', CheckOutTime: '17:00' }],
    classes: [{ ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }],
    otRecords: over.otRecords || [], holidayAttend: over.holidayAttend || [],
    holidays: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    otDaily: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    parents: [{ ParentID: 'PAR-1' }, { ParentID: 'PAR-2' }], userLinks: [], leaves: [], payments: [],
    studentCharges: [], prepayments: [], paymentSlips: [], journals: [], comments: [], payroll: [],
    payrollConfig: {}, absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: []
  };
  const at = new Date((now || (DAY + 'T09:00:00')));
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
/* FUNCTIONS, not constants. These arrays are handed straight to the engine, which mutates them —
 * so a shared literal makes one case's removal into the next case's missing row, and the failure
 * appears somewhere that never touched it. */
const HOLOT = () => [{ OTRecordID: 'OTR-1', StaffID: 'STF-1', Date: DAY, Kind: 'HOLIDAY', Amount: 800, Status: 'APPROVED', Hours: 0 }];
const ATT = () => [{ Date: DAY, StudentID: 'S1', AddedBy: 'STF-1' }];

console.log('\n1) with nobody ticked, the day stays shut to the children');
{
  const { H } = boot({ otRecords: HOLOT() });
  throws_('a parent cannot check their child in', () =>
    H.parentCheckin({ studentId: 'S1', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 }), 'ไม่ได้อยู่ในรายชื่อ');
  throws_('...nor can a teacher, on their behalf', () =>
    H.staffStudentCheckin({ studentId: 'S1', type: 'IN', staffId: 'STF-1', remark: 'แม่มาส่ง' }), 'ไม่ได้อยู่ในรายชื่อ');
  ok_('...and the refusal says what to do about it',
    /ให้คุณครูเพิ่มชื่อก่อนจึงจะลงเวลาได้/.test(eng));
  // but the teacher who was given the OT can still clock in — that is the whole point of the day
  const r = H.staffCheckin({ staffId: 'STF-1', lat: 0, lng: 0 });
  ok_('the teacher on OT วันหยุด clocks in', !!r.time && r.holidayOT === true);
}
{
  const { H } = boot({});   // an ordinary Saturday, nobody has holiday OT
  throws_('a teacher with no holiday OT is still refused', () =>
    H.staffCheckin({ staffId: 'STF-1', lat: 0, lng: 0 }), 'หยุด');
}

console.log('\n2) a ticked child has an ordinary day');
{
  const { H, M } = boot({ otRecords: HOLOT(), holidayAttend: ATT() });
  const inR = H.parentCheckin({ studentId: 'S1', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 });
  eq('the parent drops them off', inR.type, 'IN');
  ok_('...and it is recorded like any other day', (M.checkinStudent || []).some(c => c.StudentID === 'S1' && c.Type === 'IN'));
  eq('...and shows in the history', H.studentCheckinHistory({ studentId: 'S1' }).length, 1);
  // the child who was NOT ticked is still refused, on the same day
  throws_('the child nobody named is still refused', () =>
    H.parentCheckin({ studentId: 'S2', type: 'IN', parentId: 'PAR-2', lat: 0, lng: 0 }), 'ไม่ได้อยู่ในรายชื่อ');
}
{
  // collected late, on a holiday, is still collected late
  const { H, M } = boot({ otRecords: HOLOT(), holidayAttend: ATT() }, DAY + 'T18:40:00');
  H.staffStudentCheckin({ studentId: 'S1', type: 'IN', staffId: 'STF-1', remark: 'แม่มาส่ง', time: '07:50' });
  const out = H.staffStudentCheckin({ studentId: 'S1', type: 'OUT', staffId: 'STF-1', remark: 'แม่มารับ' });
  eq('the late-pickup charge is raised as usual', [out.ot.lateMinutes, out.ot.amount], [100, 200]);
  eq('...and it is a real row', [M.otDaily.length, M.otDaily[0].Status], [1, 'UNPAID']);
}

console.log('\n3) the teacher is paid the lump sum, and only the lump sum');
{
  const { H, M } = boot({ otRecords: HOLOT() }, DAY + 'T10:30:00');
  const r = H.staffCheckin({ staffId: 'STF-1', lat: 0, lng: 0 });
  eq('arriving at 10:30 on a holiday is not late', r.lateMinutes, 0);
  ok_('...even though the shift says 08:00', r.rawLate > 0);
}
{
  const { H, M } = boot({ otRecords: HOLOT() }, DAY + 'T09:00:00');
  H.staffCheckin({ staffId: 'STF-1', lat: 0, lng: 0 });
  const { H: H2 } = boot({ otRecords: HOLOT() }, DAY + 'T20:00:00');
  // (a fresh boot cannot carry the morning's row; what matters is the OT arithmetic on the way out)
  const before = boot({ otRecords: HOLOT() }, DAY + 'T20:00:00');
  before.M.staffAttendanceToday.push({ StaffID: 'STF-1', CheckIn: '09:00', CheckOut: '', Status: 'IN', Late: 0 });
  const out = before.H.staffCheckout({ staffId: 'STF-1', lat: 0, lng: 0 });
  eq('leaving at 20:00 raises NO hourly OT on top of the lump sum', [out.otMinutes, out.otHours], [0, 0]);
  eq('...and says why', out.holidayOT, true);
}
{
  // ...and on an ordinary working day the hourly OT is untouched
  const { H, M } = boot({}, '2026-08-20T20:00:00');
  M.staffAttendanceToday.push({ StaffID: 'STF-1', CheckIn: '08:00', CheckOut: '', Status: 'IN', Late: 0 });
  const out = H.staffCheckout({ staffId: 'STF-1', lat: 0, lng: 0 });
  eq('a normal Thursday still pays hourly OT', [out.otMinutes, out.otHours], [180, 3]);
}

console.log('\n4) the list itself');
{
  const { H, M } = boot({ otRecords: HOLOT() });
  H.holidayAttendSet({ staffId: 'STF-1', date: DAY, studentIds: ['S1', 'S2', 'S1'] });
  eq('ticking saves one row per child, no duplicates', M.holidayAttend.length, 2);
  const l = H.holidayAttendList({ date: DAY });
  eq('...and reads back with nicknames and classes',
    l.students.map(s => [s.nick, s.class]), [['ไบร์ท', 'Nursery 1'], ['มายด์', 'Nursery 2']]);
  eq('...knowing the day is closed, and who is working it', [l.closed, l.staff], [true, ['STF-1']]);
  H.holidayAttendSet({ staffId: 'STF-1', date: DAY, studentIds: ['S2'] });
  eq('saving again REPLACES the day rather than adding to it', M.holidayAttend.map(r => r.StudentID), ['S2']);
  H.holidayAttendSet({ staffId: 'STF-1', date: DAY, studentIds: [] });
  eq('...and an empty list is an answer too', M.holidayAttend.length, 0);
}
{
  const { H, M } = boot({ otRecords: HOLOT() });
  const r = H.holidayAttendAdd({ staffId: 'STF-1', studentId: 'S1' });
  eq('a teacher can add a name on the spot', [r.added, r.date], [true, DAY]);
  eq('...twice is not two rows', [H.holidayAttendAdd({ staffId: 'STF-1', studentId: 'S1' }).already, M.holidayAttend.length], [true, 1]);
  ok_('...and the check-in opens immediately', !!H.parentCheckin({ studentId: 'S1', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 }));
  ok_('who added it and when is recorded', !!M.holidayAttend[0].AddedBy && !!M.holidayAttend[0].AddedAt);
  ok_('...and it is in the activity log', (M.activityLog || []).some(a => /holidayAttendAdd/.test(String(a.Action || a.action))));
}
{
  const { H, M } = boot({ otRecords: HOLOT(), holidayAttend: ATT() });
  eq('a name ticked by mistake can be taken off', H.holidayAttendRemove({ staffId: 'STF-1', studentId: 'S1' }).removed, true);
  eq('...leaving nothing behind', M.holidayAttend.length, 0);
}
{
  const { H } = boot({ otRecords: HOLOT(), holidayAttend: ATT() });
  H.parentCheckin({ studentId: 'S1', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 });
  throws_('but a child who already clocked in cannot be un-invited', () =>
    H.holidayAttendRemove({ staffId: 'STF-1', studentId: 'S1' }), 'ลงเวลาไปแล้ว');
}
{
  const { H } = boot({ otRecords: HOLOT() });
  throws_('only an admin sets the whole day\'s list', () =>
    H.holidayAttendSet({ staffId: 'NOBODY', date: DAY, studentIds: ['S1'] }), 'เฉพาะแอดมิน');
  throws_('...and a name that is not a student is refused', () =>
    H.holidayAttendSet({ staffId: 'STF-1', date: DAY, studentIds: ['S9'] }), 'ไม่พบนักเรียน');
}

console.log('\n5) an ordinary day is untouched by any of it');
{
  const { H, M } = boot({}, '2026-08-20T08:05:00');       // a Thursday
  ok_('a child checks in with no list anywhere near it',
    !!H.parentCheckin({ studentId: 'S1', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 }));
  const r = H.staffCheckin({ staffId: 'STF-1', lat: 0, lng: 0 });
  eq('...and the teacher is late if they are late', r.lateMinutes, 5);
}

console.log('\n6) both runtimes, and the door they share');
{
  ok_('the engine has ONE door for a child\'s day', /function assertStudentDayOpen_\(studentId, date\)\{/.test(eng));
  ok_('...used by the parent\'s button', /assertStudentDayOpen_\(p\.studentId\);/.test(eng));
  ok_('...and the teacher\'s', /assertStudentDayOpen_\(st\.StudentID, p\.date\);/.test(eng));
  ok_('Apps Script has the same door', /function assertStudentDayOpen_\(studentId, d\) \{/.test(ci));
  ok_('...on the parent route', /assertStudentDayOpen_\(payload\.studentId\);/.test(par));
  ok_('...and the teacher route, which never had ANY check before', /assertStudentDayOpen_\(student\.StudentID\);/.test(ci));
  ok_('the lump-sum rule is in both too',
    /const holOT=hasHolidayOT_\(p\.staffId, todayLocal\(\)\);/.test(eng) && /staffHasHolidayOT_\(staff\.StaffID, today\)/.test(ci));
  ok_('...and says why it exists', /it is not a second thing to be paid\s*\n\s*\* for/.test(ci));
}
{
  ok_('the sheet is declared', /HOLIDAY_ATTEND:\s+\['Date', 'StudentID', 'AddedBy', 'AddedAt'\]/.test(cfg));
  ok_('...and mapped for the engine', /holidayAttend:\s+\{ wb: 'MAIN', sheet: 'HOLIDAY_ATTEND' \}/.test(ge));
  // the three that WRITE do not start with a mutating verb — an unnamed write takes no lock
  ok_('the three writes are named as writes, server side',
    /holidayAttendSet: 1, holidayAttendAdd: 1, holidayAttendRemove: 1/.test(code));
  ok_('...and client side', /holidayAttendSet: 1, holidayAttendAdd: 1, holidayAttendRemove: 1/.test(R('webapp/api.js')));
  ok_('replacing the whole day is admin-only', /ADMIN_ONLY = \{[\s\S]{0,900}holidayAttendSet: 1/.test(code));
  ok_('...but adding ONE name deliberately is not', !/ADMIN_ONLY = \{[\s\S]{0,900}holidayAttendAdd: 1/.test(code));
}

console.log('\n7) the screens');
{
  ok_('the OT วันหยุด form has the children, by class', /A_hotStdList=async\(date\)=>/.test(app) && /byClass\[c\]/.test(app));
  ok_('...by nickname', /<b>\$\{esc\(dispNick\(s\)\)\}<\/b>/.test(app));
  ok_('...with a whole class tickable at once', /A_hotStdClass\(this,'\$\{esc\(c\)\}'\)/.test(app));
  ok_('...and it says what ticking DOES', /ติ๊กชื่อนักเรียนเพื่อเปิดการรับ-ส่งของวันนั้น/.test(app));
  ok_('...including what happens if you tick nobody', /ไม่ติ๊กใครเลย = เปิดเฉพาะการลงเวลาของคุณครู/.test(app));
  ok_('saving writes the list beside the OT', /await api\('holidayAttendSet',\{staffId:USER\.staffId,date:g\('hotDate'\),studentIds\}\)/.test(app));
  ok_('reopening the form shows what was saved', /picked\.forEach\(x=>\{ on\[x\.studentId\]=1; \}\)/.test(app));
  ok_('the teacher sees the day\'s children on their home screen', /api\('holidayAttendList',\{\}\)/.test(app));
  ok_('...and can add one who turned up', /window\.T_holAddStudent=async\(\)=>/.test(app) && /holidayAttendAdd/.test(app));
}

console.log('\n8) a tick box beside its label, on a phone');
{
  // reported with the mismatch marked in red: input{width:100%} applies to checkboxes too, so every
  // box took a line of its own and the label fell under the box BEFORE it
  ok_('.chk-inline finally has a rule', /\.chk-inline\{display:flex/.test(css));
  ok_('...the control does not stretch', /\.chk-inline input\[type=checkbox\],\.chk-inline input\[type=radio\]\{width:22px/.test(css));
  ok_('...and does not shrink when the text wraps', /min-width:22px/.test(css) && /flex:0 0 auto/.test(css));
  ok_('the whole row is a 44px target', /\.chk-inline\{[^}]*min-height:44px/.test(css));
  ok_('every label is a span, so it can sit beside the box', !/<label class="chk-inline"><input[^>]*\/> \$\{esc/.test(app));
  ok_('the reason is written down', /took the whole line and its label dropped underneath/.test(css));
  ok_('two columns on a wide screen, one on a phone', /@media\(min-width:560px\)\{ \.chk-cols\{grid-template-columns:1fr 1fr;\} \}/.test(css));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
