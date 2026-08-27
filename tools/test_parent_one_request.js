/**
 * tools/test_parent_one_request.js — the parent's home screen, in one request instead of five.
 *   node tools/test_parent_one_request.js
 *
 * A parent who evidently writes software told the school, through a teacher, that the app was making
 * far too many calls for what it was showing them (2026-08-26). They were right, and the count was
 * the whole problem: Apps Script runs ONE execution at a time per user, so requests do not overlap —
 * they queue. Five round trips is five waits end to end.
 *
 * WHY IT COULD NOT BE FIXED ON THE CLIENT. api.js already merges everything issued in one tick into
 * a single request. The parent's home could not use that, because each batch needed the answer to
 * the one before: nothing can be asked per-child until parentChildren has said which children, and
 * insuranceStatus / openSurveys were issued after that await, so each bought its own place in the
 * queue. The fan-out had to move to the server, where the sheets are already hydrated.
 *
 *   1. parentChildren
 *   2. journal · announcements · calendar · familyProfile · plans · schoolDay · parentDue
 *      · per-child check-in history · per-child leaves
 *   3. per-child insuranceStatus
 *   4. openSurveys
 *   5. PREFETCH, re-asking for three things the screen was already fetching
 *
 * WHAT THIS FILE IS FOR. Not "the handler runs" — that it returns THE SAME DATA the five calls did.
 * Every field is compared, field by field, against the handler the screen used to call. A composite
 * that quietly disagrees with the screens it links to is worse than the five requests were.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

const TODAY = '2026-08-26';
function boot() {
  const kid = (id, nick, pid) => ({ StudentID: id, NameTH: 'ด.ญ. ' + nick, Nickname: nick, Class: 'Nursery 2',
    Status: 'ACTIVE', DOB: '2023-02-01', Plan: 'P1', EnrollDate: '2025-01-01', ParentID: pid });
  const M = {
    config: { Plans: [{ id: 'P1', labelTH: 'เต็มเดือน', price: 6900 }], LeaveQuota: {}, BigCleaningDays: [],
      Departments: 'Nursery 2', GPS_Lat: 0, GPS_Lng: 0, Radius: 50 },
    students: [kid('STD-1', 'เลอา', 'PAR-1'), kid('STD-2', 'มีมี่', 'PAR-1'), kid('STD-9', 'คนอื่น', 'PAR-9')],
    parents: [{ ParentID: 'PAR-1', NameTH: 'ปรเมศวร์', LineUID: 'U_p1', Relationship: 'บิดา', StudentID: 'STD-1' },
              { ParentID: 'PAR-9', NameTH: 'คนอื่น', LineUID: 'U_p9', StudentID: 'STD-9' },
              // a parent whose child is not enrolled yet — the "no children" case below
              { ParentID: 'PAR-0', NameTH: 'ยังไม่มีบุตร', LineUID: 'U_p0' }],
    userLinks: [{ UserUID: 'U_p1', StudentID: 'STD-1', ParentID: 'PAR-1' },
                { UserUID: 'U_p1', StudentID: 'STD-2', ParentID: 'PAR-1' }],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', RequireCheckin: false }],
    journals: [{ JournalID: 'J1', StudentID: 'STD-1', Date: TODAY, Status: 'SUBMITTED', Mood: 'ดี' }],
    announcements: [{ AnnID: 'A1', TitleTH: 'ประกาศ', BodyTH: 'x', Audience: 'ALL', Active: true }],
    calendar: [{ date: TODAY, title: 'กิจกรรม', type: 'event' }],
    checkinStudent: [{ StudentID: 'STD-1', Date: '2026-08-25', Type: 'IN', Time: '08:10' },
                     { StudentID: 'STD-2', Date: '2026-08-25', Type: 'IN', Time: '08:20' }],
    studentLeaves: [{ LeaveID: 'SL1', StudentID: 'STD-2', Date: '2026-08-24', Type: 'ลาป่วย', Status: 'APPROVED' }],
    payments: [{ BillingID: 'BL-1', StudentID: 'STD-1', Month: '2026-08', Amount: 6900, Status: 'UNPAID', Items: [['ค่าเทอม', 6900]] }],
    insurancePCHI: [{ StudentID: 'STD-1', NationalID: '' }],
    surveys: [{ SurveyID: 'SV1', TitleTH: 'ความพึงพอใจ', Status: 'OPEN', Audience: 'ALL',
                StartDate: '2026-08-01', EndDate: '2026-12-31', Questions: [] }],
    surveyResponses: [], holidays: [], otDaily: [], studentCharges: [], prepayments: [], paymentSlips: [],
    comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, absenceLog: [], dspmCriteria: [], activityLog: [], notifications: [],
    vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], injuries: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], classes: [], studentAttendanceToday: [], studentCheckins: [],
    leaves: [], otRecords: [], attendanceReq: [], classChangeReq: [], holidayAttend: []
  };
  const at = new Date(TODAY + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number,
    isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const SCOPE = { uid: 'U_p1', parentId: 'PAR-1', role: 'Parent' };

console.log('\n1) one call returns exactly what the five used to');
{
  const H = boot();
  const home = H.parentHome(SCOPE);
  // …compared against the very handlers the screen called before, on the same data
  eq('children', home.children, H.parentChildren(SCOPE));
  eq('journal of the first child', home.journal, H.getJournal(Object.assign({}, SCOPE, { studentId: 'STD-1' })));
  eq('announcements', home.announcements, H.announcements(SCOPE));
  eq('calendar', home.calendar, H.calendar(SCOPE));
  eq('familyProfile', home.familyProfile, H.familyProfile(SCOPE));
  eq('plans', home.plans, H.getPlans(SCOPE));
  eq('schoolDay', home.schoolDay, H.schoolDay({}));
  eq('what the family owes', home.due, H.parentDue(SCOPE));
  eq('open surveys', home.surveys, H.openSurveys(SCOPE));
  ['STD-1', 'STD-2'].forEach((id, i) => {
    eq(`check-in history · child ${i + 1}`, home.checkins[i], H.studentCheckinHistory(Object.assign({}, SCOPE, { studentId: id })));
    eq(`leaves · child ${i + 1}`, home.leaves[i], H.studentLeaves(Object.assign({}, SCOPE, { studentId: id })));
    eq(`insurance · child ${i + 1}`, home.insurance[i], H.insuranceStatus(Object.assign({}, SCOPE, { studentId: id })));
  });
}

console.log('\n2) the per-child lists line up with the children, and only this family’s');
{
  const H = boot();
  const home = H.parentHome(SCOPE);
  eq('two children, in order', home.children.map(k => k.StudentID), ['STD-1', 'STD-2']);
  /* THE FAILURE THIS REPLACED. The old code read one flat array by index with a `FIXED = 7` offset;
   * every time an entry was added or removed the slices shifted and a child was handed another
   * child's calendar. Three parallel arrays, one per child, in the children's own order. */
  eq('one entry per child, per list',
    [home.checkins.length, home.leaves.length, home.insurance.length], [2, 2, 2]);
  eq('...and each is that child’s own', home.insurance.map(x => x.studentId), ['STD-1', 'STD-2']);
  eq('the sick child’s leave is on the sick child', home.leaves.map(l => l.length), [0, 1]);
  // another family's child must not appear anywhere in the payload
  ok_('another family’s child is nowhere in it', JSON.stringify(home).indexOf('STD-9') < 0);
}

console.log('\n3) a family with no children asks for nothing else');
{
  const H = boot();
  const home = H.parentHome({ uid: 'U_p0', parentId: 'PAR-0', role: 'Parent' });
  eq('no children', home.children, []);
  // the screen draws a single card in this case, so fetching a journal or a calendar would be waste
  eq('...and none of the per-child work was done', [home.checkins, home.leaves, home.insurance, home.journal],
    [undefined, undefined, undefined, undefined]);
}

console.log('\n4) one section failing must not take the home screen down');
{
  /* Each part is guarded, because the screen's own .catch()es used to do this: familyProfile, plans,
   * schoolDay, parentDue and the leave lists all had one. A composite without them would turn a
   * survivable gap into a blank home screen. */
  const H = boot();
  const orig = H.parentDue;
  H.parentDue = () => { throw new Error('boom'); };
  let home = null;
  try { home = H.parentHome(SCOPE); } catch (e) { /* must not happen */ }
  ok_('the screen still gets its payload', !!home && home.children.length === 2);
  eq('...with the broken part null, exactly as the client’s catch produced', home && home.due, null);
  ok_('...and everything else intact', !!home.journal && home.checkins.length === 2);
  H.parentDue = orig;
  ok_('the guard is written once, not per field', /const soft = \(fn, dflt\) =>/.test(eng));
}

console.log('\n5) the screen really does make one request');
{
  const home = app.slice(app.indexOf('SCREENS.Parent.home = async () => {'), app.indexOf('// add another child'));
  // counted on api('…') — a bare "api()" in prose is a comment, and matching it was this test
  // failing on the very sentence that says there is no second call
  eq('exactly one api() call on the whole screen', (home.match(/api\('/g) || []).length, 1);
  ok_('...and it is parentHome', /const HOME = window\._BOOT_HOME \|\| await api\('parentHome', parentScope\(\)\);/.test(home));
  /* …and on the very first render there is no request at all: signing in already returned the whole
   * screen (handleAuth), which removes the SECOND Apps Script execution from the login path. It is
   * consumed once — a parent must not be looking at their morning for the rest of the day. */
  ok_('the sign-in hands the screen over, so the first render is free', /window\._BOOT_HOME = null;/.test(home));
  ok_('...and the server really sends it', /home: _home/.test(R('src/Auth.gs')));
  ok_('...built from the same composite, not a second copy', /engineDispatch_\('parentHome'/.test(R('src/Auth.gs')));
  ok_('...and a failure there still signs them in', /catch \(e\) \{ _home = null; \}/.test(R('src/Auth.gs')));
  // the things that used to be separate trips are now read out of that one answer
  ['HOME.insurance', 'HOME.surveys', 'HOME.checkins', 'HOME.leaves', 'HOME.due', 'HOME.schoolDay']
    .forEach(f => ok_(`${f} comes from the same reply`, home.indexOf(f) >= 0));
  ok_('the FIXED-offset slicing is gone for good', !/const FIXED = 7;/.test(home));
  ok_('...and so is the second await that bought its own place in the queue',
    !/await Promise\.all\(kids\.map\(k=>api\('insuranceStatus'/.test(home));
}

console.log('\n6) and the prefetch stops asking for what the screen is already fetching');
{
  const pf = app.slice(app.indexOf('window.PREFETCH = () => {'), app.indexOf('function confirmSaved'));
  const parentJobs = /USER\.role==='Parent'\s*\?\s*\[([\s\S]*?)\]\s*\n/.exec(pf)[1];
  eq('a parent warms only the bell, which the header asks for anyway',
    (parentJobs.match(/\['([a-zA-Z]+)'/g) || []).map(x => x.slice(2, -1)), ['notifications']);
  ok_('parentChildren is no longer re-requested 500ms after the screen asked for it',
    parentJobs.indexOf('parentChildren') < 0);
  ['announcements', 'calendar'].forEach(a =>
    ok_(`...nor ${a}`, parentJobs.indexOf("'" + a + "'") < 0));
  ok_('the other roles are untouched', /USER\.role==='Admin'/.test(pf) && /classList/.test(pf));
}

console.log('\n7) a drop-off no longer waits on a satellite');
{
  /* Drop-off is NOT fenced — a parent may tap it from anywhere — so the position is a log line and
   * nothing depends on it. Asking for enableHighAccuracy with a ten-second timeout meant up to ten
   * seconds of spinner, indoors, for an answer nobody checks. Pick-up is untouched: it is fenced,
   * the school's radius depends on it, and it must have the best fix the phone can give. */
  ok_('there is a quick profile', /const GEO_QUICK = \{enableHighAccuracy:false, timeout:3000, maximumAge:120000\};/.test(app));
  ok_('...and the drop-off uses it', /else \{ try\{ \(\{lat,lng,acc\}=await getPosition\(GEO_QUICK\)\); \}/.test(app));
  ok_('pick-up still asks for the best fix available', /if\(type==='OUT'\)\{ \(\{lat,lng,acc\}=await getPosition\(\)\); \}/.test(app));
  ok_('...which is still high accuracy, 10s, no cached fix',
    /Object\.assign\(\{enableHighAccuracy:true,timeout:10000,maximumAge:0\}, opts\|\|\{\}\)/.test(app));
  // the staff punches are fenced too and must not have been made sloppy by this
  ok_('staff check-in/out still uses the strict profile', !/T_punch[\s\S]{0,400}GEO_QUICK/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
