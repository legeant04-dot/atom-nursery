/**
 * tools/test_parent_first_tap.js — the half a parent came for.
 *   node tools/test_parent_first_tap.js
 *
 * Asked 10/09/26 off the 07–09/09 report: "ผู้ปกครองจะ Login และเข้าไปเพื่อ Check in/out เป็นหลัก
 * ส่วนอื่นค่อยดึงเอา แต่หน้าหลักควรโหลดไวกว่านี้".
 *
 * A parent opens this app in the morning to tap ส่งเข้าเรียน. Everything else on that screen — the
 * journal, the calendar, announcements, what is owed, insurance, surveys — is reading, done after.
 * All of it was assembled in the SAME execution as the two buttons, and Apps Script runs one
 * execution at a time per user, so that assembly was not happening alongside anything. It was just a
 * wait, in front of the one control somebody is standing at the gate to press.
 *
 * The core is deliberately a SUBSET OF parentHome'S OWN SHAPE, field for field. That is the whole
 * reason the screen needs no second render path: the parts that have not arrived yet are exactly the
 * ones it already guards with `||[]`, and the full payload repaints over the top a moment later.
 *
 * AND THE THING THE SAME REPORT PRICED. lineLoginReady was failing 27% and googleLoginReady 49%,
 * every one of them NO_SESSION — on the sign-in screen, where by definition there is no session yet.
 * Both are public actions. The client micro-batches whatever is issued in one tick, and `batch` was
 * not itself public, so a batch of nothing but public calls was refused whole. That is why the
 * fallback sign-in buttons so often were not drawn.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), auth = R('src/Auth.gs'), code = R('src/Code.gs');
const srcCode = s => s.replace(/image\/\*/g, 'image_ANY')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = ymd(new Date());
const YESTERDAY = ymd(new Date(Date.now() - 864e5));

function boot() {
  const M = {
    config: { Plans: [{ PlanID: 'P1', NameTH: 'เต็มวัน', Price: 6900 }], LeaveQuota: {} },
    parents: [{ ParentID: 'PAR-1', Name: 'พ่อ', NameTH: 'พ่อ', LineUID: 'U_dad', StudentID: 'S1' }],
    students: [
      { StudentID: 'S1', NameTH: 'ภัธนิน', Nickname: 'นิน', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2024-08-01', ParentID: 'PAR-1', Plan: 'P1' },
      { StudentID: 'S2', NameTH: 'น้องสอง', Nickname: 'สอง', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2024-01-01', ParentID: 'PAR-1', Plan: 'P1' }],
    userLinks: [{ UserUID: 'U_dad', StudentID: 'S1' }, { UserUID: 'U_dad', StudentID: 'S2' }],
    studentCheckins: [
      { Date: TODAY, StudentID: 'S1', InTime: '07:42', OutTime: '' },
      { Date: YESTERDAY, StudentID: 'S1', InTime: '07:31', OutTime: '17:05' },
      { Date: YESTERDAY, StudentID: 'S2', InTime: '08:02', OutTime: '16:40' }],
    checkinStudent: [
      { Date: TODAY, StudentID: 'S1', InTime: '07:42', OutTime: '' },
      { Date: YESTERDAY, StudentID: 'S1', InTime: '07:31', OutTime: '17:05' },
      { Date: YESTERDAY, StudentID: 'S2', InTime: '08:02', OutTime: '16:40' }],
    leaves: [], payments: [], otDaily: [], otRecords: [], studentCharges: [], prepayments: [],
    paymentSlips: [], journals: [], comments: [], holidays: [], staff: [], staffGroups: [],
    workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {},
    studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    classChangeReq: [], attendanceReq: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [], classCover: [], pickupPersons: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const P = { uid: 'U_dad', parentId: 'PAR-1', role: 'Parent' };

console.log('1) the core is the buttons, and only the buttons');
{
  const { H } = boot();
  const core = H.parentHomeCore(P);
  eq('the children are there — nothing draws without them', (core.children || []).map(k => k.StudentID), ['S1', 'S2']);
  ok_('...and whether school is open at all, which decides if the buttons appear', 'schoolDay' in core);
  ok_('...and the packages, so the card names one instead of printing an id', Array.isArray(core.plans));
  eq('it says it is only the core, which is how the screen knows to ask for the rest', core.core, true);
  /* THE EXPENSIVE HALF IS ABSENT — that is the entire point. Each of these reads a different
   * collection, and parentDue alone walks payments, charges and OT. */
  ['journal', 'announcements', 'calendar', 'familyProfile', 'due', 'leaves', 'insurance', 'surveys']
    .forEach(k => ok_('...and no ' + k, !(k in core)));
}
{
  const { H } = boot();
  const core = H.parentHomeCore(P);
  /* TODAY'S ROW ONLY. It is what the buttons read — whether the drop-off already happened, and at
   * what time — and it is the same field name and shape parentHome uses, so the screen reads it
   * with no second code path. The rest of the history belongs to the calendar, which nobody is
   * standing at the gate waiting for. */
  eq('today’s check-in rides with the core', (core.checkins[0] || []).map(r => r.InTime), ['07:42']);
  eq('...for the second child too, in the same order as children', (core.checkins[1] || []).length, 0);
  ok_('...and yesterday is not carried', !(core.checkins[0] || []).some(r => String(r.Date).slice(0, 10) === YESTERDAY));
  const full = H.parentHome(P);
  eq('the full payload has the whole history, as it always did', (full.checkins[0] || []).length, 2);
  /* THE SHAPES MUST MATCH, or the screen would need to know which one it was handed. */
  (Object.keys(core).filter(k => k !== 'core')).forEach(k =>
    ok_('`' + k + '` means the same thing in both', k in full || k === 'core'));
}
{
  // a family with no children linked yet: the screen shows one card, so the core fetches nothing more
  const { H, M } = boot();
  M.userLinks.length = 0; M.students.forEach(s => { s.ParentID = 'OTHER'; });
  const core = H.parentHomeCore(P);
  eq('no children means no work at all', [core.children.length, 'schoolDay' in core], [0, false]);
}

console.log('\n2) signing in carries the short half');
{
  const a = srcCode(auth);
  ok_('handleAuth hands back the core, not the whole screen', /engineDispatch_\('parentHomeCore'/.test(a));
  ok_('...and nothing else in the sign-in reply changed', /token: issueSession_\(uid, ROLES\.PARENT, par\.ParentID\)/.test(a));
  ok_('...still best-effort, so a failure here can never stop somebody signing in', /catch \(e\) \{ _home = null; \}/.test(a));
}

console.log('\n3) the screen paints twice, and only where it helps');
{
  const c = srcCode(app);
  ok_('the render takes a payload rather than always fetching one', /SCREENS\.Parent\.home = async \(pre\) => \{/.test(c));
  ok_('...and the boot payload is used as the first pass', /pre \|\| window\._BOOT_HOME \|\| api\('parentHome', parentScope\(\)\)/.test(c));
  ok_('the rest is asked for only when the first pass was the core', /if \(HOME\.core\) \{/.test(c));
  /* A parent who taps ส่งเข้าเรียน and moves on must not have the home screen redrawn under whatever
   * they opened next. */
  ok_('...and repaints only if they are still on that screen', /USER\.role === 'Parent' && CURRENT === 'home'/.test(c));
  ok_('...silently, because the half that matters is already drawn', /\.catch\(\(\) => \{\}\);/.test(c));
  ok_('the announcement popup does not fire twice', /if \(!pre\) showAnnPopups\(\);/.test(c));
  /* A LATER visit gets the full payload directly, has no `core` flag, and stays one pass. The split
   * exists only on the login path. */
  ok_('a later visit still fetches parentHome, unchanged', /api\('parentHome', parentScope\(\)\)/.test(c));
}

console.log('\n4) a batch of public calls is not a private request');
{
  const c = srcCode(code);
  /* PRICED IN THE REPORT: lineLoginReady 27% and googleLoginReady 49%, all NO_SESSION. Both public,
   * both issued by the sign-in screen in one tick, so the client batched them — and `batch` was not
   * itself public, so the whole thing was refused. That is why the fallback buttons so often were
   * not drawn at all. */
  ok_('a batch is let through when every call in it is public', /var allPublic = \(action === 'batch'\)/.test(c));
  ok_('...and the gate consults it', /!publicAction_\(action\) && !allPublic && !sess/.test(c));
  ok_('an EMPTY batch is not treated as public', /if \(!cs\.length\) return false;/.test(c));
  ok_('one private passenger and it is refused exactly as before', /if \(!publicAction_\(cs\[i\] && cs\[i\]\.action\)\) return false;/.test(c));
  // identity is still applied per call inside the batch, so nothing was widened
  ok_('handleBatch still stamps identity on every call', /applyIdentity_\(c\.action, c\.payload \|\| \{\}, sess\)/.test(srcCode(R('src/GasEngine.gs'))));
}
{
  // the real gate, run
  const H = require(path.join(__dirname, 'gas_test_harness.js'));
  const ctx = H(['Config', 'Db', 'Checkin', 'Audit', 'Code', 'Auth', 'Staff', 'Perf', 'GasEngine']);
  ctx.run(function () {
    var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
    PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
    var sc = main.insertSheet('SCHOOL_CONFIG'); sc.appendRow(['Key', 'Value']);
    sc.appendRow(['RequireSessionToken', 'true']);
    return 'ok';
  });
  // ask publicAction_ itself — it is the same function the gate consults
  const isPub = a => JSON.parse(ctx.run(new Function('return JSON.stringify(publicAction_(' + JSON.stringify(a) + '));')));
  eq('lineLoginReady is public', isPub('lineLoginReady'), true);
  eq('googleLoginReady is public', isPub('googleLoginReady'), true);
  eq('...and the pair the sign-in screen sends together is therefore an all-public batch',
    ['lineLoginReady', 'googleLoginReady'].every(isPub), true);
  eq('dashboard is not public, so a batch carrying it still needs a session', isPub('dashboard'), false);
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
