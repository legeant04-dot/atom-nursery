/**
 * tools/test_ops_badges.js — the screen has to say that somebody is waiting.
 *   node tools/test_ops_badges.js
 *
 * ASKED 2026-08-26: "เมนูดำเนินการ หัวข้อหลักไม่มีสถานะบอกว่ามีคำร้องหรือรอการอนุมัติ ให้ทำเป็น
 * Notification ที่มุมของเมนูนั้นๆ … และให้มีการแจ้งเตือนไปที่ Notification กระดิ่งด้านบนด้วย".
 *
 * Every one of those tools already knew its own count — but only once you had opened it, which is
 * exactly the wrong way round. Two time requests sat unanswered because nothing on the screen said
 * they existed.
 *
 * THE TWO THINGS THIS HAS TO GET RIGHT, and they pull against each other:
 *
 *  1. ONE ROUND TRIP. Six counts fetched separately would be six queued executions (Apps Script runs
 *     one at a time per user) on the busiest admin screen, and refreshBell runs from setHeader() on
 *     EVERY render. So there is one handler, and both callers start it in the same tick as a call
 *     they were already making.
 *  2. A BADGE THAT IS ALWAYS THERE IS NOT A SIGNAL. Zero prints nothing, and only work waiting for
 *     THE ADMIN counts — an unpaid student OT is waiting for a parent, so a permanent red number
 *     against it would teach an admin to stop seeing red numbers.
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
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.code) || (e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), css = R('webapp/styles.css');

const TODAY = '2026-08-26';
function boot(over) {
  over = over || {};
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1' },
    staff: [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', RequireCheckin: false, Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', PositionLevel: 'Staff', Status: 'ACTIVE', RequireCheckin: true, StartDate: '2020-01-01' }
    ],
    otRecords: over.otRecords || [], attendanceReq: over.attendanceReq || [],
    classChangeReq: over.classChangeReq || [], otDaily: over.otDaily || [], leaves: over.leaves || [],
    holidays: [], students: [], checkinStudent: [], staffAttendanceHistory: [], staffAttendanceToday: [],
    workSchedule: [], staffGroups: [], classes: [], parents: [], userLinks: [], payments: [],
    studentCharges: [], prepayments: [], paymentSlips: [], payroll: [], payrollConfig: {},
    studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [], comments: [],
    absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
    vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], holidayAttend: []
  };
  const at = new Date(TODAY + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
/* THE STATUSES THE SYSTEM ACTUALLY PRODUCES.
 *
 * An OT row is born PENDING_LEADER on a late check-out, or PENDING_ADMIN when the person IS the
 * leader (src/Checkin.gs), and the leader's approval moves it to PENDING_ADMIN (src/OtStaff.gs).
 * There is no plain 'PENDING' anywhere in that chain.
 *
 * The first version of this file used 'PENDING' — a status nothing writes — so the test passed
 * against a handler that filtered for exactly that, and the live badge stayed at zero while a real
 * request sat unanswered all morning. A fixture that invents its inputs proves nothing about the
 * system; these are read off the code that writes the rows. */
const OT = (id, st, hol) => ({ OTRecordID: id, StaffID: 'T1', Date: '2026-08-22', Status: st,
  Hours: hol ? 0 : 2, Amount: 500, Kind: hol ? 'HOLIDAY' : '', Note: hol ? 'มาทำงานวันหยุด' : '' });

console.log('\n1) what is waiting, counted once');
{
  const H = boot({
    // PENDING_LEADER = just created; PENDING_ADMIN = the leader has approved it. Both are waiting.
    otRecords: [OT('OT1', 'PENDING_LEADER'), OT('OT2', 'APPROVED'), OT('OT3', 'REJECTED'),
                OT('OT4', 'PENDING_ADMIN', true), OT('OT5', 'PENDING_ADMIN')],
    attendanceReq: [{ ReqID: 'R1', Status: 'PENDING_ADMIN' }, { ReqID: 'R2', Status: 'PENDING_LEADER' },
                    { ReqID: 'R3', Status: 'APPROVED' }],
    classChangeReq: [{ ReqID: 'C1', Status: 'PENDING_ADMIN' }, { ReqID: 'C2', Status: 'APPROVED' }],
    otDaily: [{ OTID: 'D1', StudentID: 'S1', Date: '2026-08-20', Status: 'PENDING_VERIFY', Amount: 200 },
              { OTID: 'D2', StudentID: 'S1', Date: '2026-08-21', Status: 'UNPAID', Amount: 200 },
              { OTID: 'D3', StudentID: 'S1', Date: '2026-08-19', Status: 'PAID', Amount: 200 }],
    leaves: [{ LeaveID: 'L1', StaffID: 'T1', Status: 'PENDING_ADMIN' }, { LeaveID: 'L2', StaffID: 'T1', Status: 'APPROVED' }]
  });
  const o = H.opsPending({ staffId: 'ADM' });
  // the example from the request: "คำขอลงเวลาคุณครู มี 2 รายการที่รอ Admin อนุมัติ"
  eq('time requests — both stages, because both are still unanswered', o.timeRequests, 2);
  /* Both stages count: a row waiting on the leader and a row waiting on the admin are both work
   * nobody has finished. OT5 is PENDING_ADMIN, OT1 is PENDING_LEADER — two teacher-OT rows. */
  eq('teacher OT and holiday OT are counted apart', [o.staffOT, o.holidayOT], [2, 1]);
  eq('...and BOTH pending stages are counted, not just one',
    [['PENDING_LEADER', 'PENDING_ADMIN', 'PENDING'].map(st => {
      const H2 = boot({ otRecords: [OT('X', st)] }); return H2.opsPending({ staffId: 'ADM' }).staffOT;
    })], [[1, 1, 1]]);
  eq('...while a decided one is not', [['APPROVED', 'REJECTED', ''].map(st => {
    const H2 = boot({ otRecords: [OT('X', st)] }); return H2.opsPending({ staffId: 'ADM' }).staffOT;
  })], [[0, 0, 0]]);
  eq('class-change requests', o.classChanges, 1);
  eq('leave requests', o.leaves, 1);
  /* A STUDENT OT THAT IS SIMPLY UNPAID IS WAITING FOR A PARENT, not for the admin. Counting it would
   * put a red number on this screen permanently, which is how people learn to stop seeing them. A
   * SUBMITTED SLIP is the admin's move, and it is the only one counted. */
  eq('only the slip waiting to be checked', o.studentOT, 1);
  //                                              staffOT + holidayOT + time + class + studentOT + leave
  eq('and a total, so the bell can add one number', o.total, 2 + 1 + 2 + 1 + 1 + 1);
}
{
  // a quiet morning must produce nothing at all, not a row of grey zeroes
  const H = boot({});
  const o = H.opsPending({ staffId: 'ADM' });
  eq('nothing pending is a clean zero', o.total, 0);
  eq('...on every count', [o.staffOT, o.holidayOT, o.timeRequests, o.classChanges, o.studentOT, o.leaves], [0, 0, 0, 0, 0, 0]);
}
{
  // it is a list of everyone's business — a teacher cannot ask
  const H = boot({});
  throws_('a teacher cannot ask', () => H.opsPending({ staffId: 'T1' }), 'NO_PERMISSION');
  throws_('...and neither can a stranger', () => H.opsPending({ staffId: 'NOBODY' }), 'NO_PERMISSION');
}

console.log('\n2) the badge, on the tool it belongs to');
{
  ok_('opTools takes a count as a 4th item', /items\.map\(\(\[ic,label,fn,n\]\)=>\{/.test(app));
  ok_('...and hides it at zero', /\$\{\(n>0\)\?'':' hidden'\}/.test(app));
  ok_('...and clamps a silly number rather than breaking the row', /n>99\?'99\+':n/.test(app));
  // the id is derived from the onclick, so a button and its count cannot be wired to each other wrongly
  ok_('the badge id comes from the function the button calls', /const id=\(fn\.match\(\/\[A-Za-z_\]\+\/\)\|\|\[''\]\)\[0\];/.test(app));
  ok_('...and the map from count to button is written once', /const OPS_BTN = \{ staffOT:'A_staffOT'/.test(app));
  /* Every key the handler returns must have a button, or a count would be fetched and silently
   * dropped. Checked by running the real table against the real handler's keys. */
  const keys = Object.keys(boot({}).opsPending({ staffId: 'ADM' })).filter(k => k !== 'total');
  const btn = /const OPS_BTN = \{([\s\S]*?)\};/.exec(app)[1];
  const mapped = [...btn.matchAll(/([A-Za-z]+):'/g)].map(m => m[1]);
  eq('every count has a home', keys.filter(k => k !== 'leaves' && mapped.indexOf(k) < 0), []);
  // leaves is deliberately NOT a tool button — it already has its own pill on the คุณครู/นักเรียน tab
  ok_('leave keeps the tab pill it already had', /_lvPend\?` <span class="pill bad"/.test(app));
}
{
  ok_('the badge is the bell’s shape and colour, so it needs no learning',
    /\.opbtn \.opbadge\{position:absolute;top:-6px;right:-6px;background:var\(--bad-2\)/.test(css));
  ok_('...and the button makes room for it rather than overlapping the label', /\.opbtn\{position:relative;overflow:visible;padding-right:26px;\}/.test(css));
  ok_('...and hidden really hides', /\.opbtn \.opbadge\[hidden\]\{display:none;\}/.test(css));
}

console.log('\n3) it costs no round trip');
{
  const scr = app.slice(app.indexOf('SCREENS.Admin.leaves = async () => {'), app.indexOf('window.A_lvMain='));
  /* Started BEFORE the first await, so it joins the batch that was already going. api.js merges
   * everything issued in one tick into a single request. */
  /* The rule is "started before ANYTHING is awaited", not "before the first `await api(`" — as of
   * 2026-09-04 the screen awaits promises it started earlier, so there is no `await api(` left in it
   * at all and the old test compared against -1. Same rule, expressed so it cannot pass by accident. */
  // comments stripped first: the reasoning above this screen contains the word "await", and matching
  // prose instead of code is how a test comes to measure nothing
  const code = scr.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok_('opsPending is started before the screen’s first await',
    code.indexOf("api('opsPending'") >= 0 && code.indexOf("api('opsPending'") < code.indexOf('await '));
  /* ...and so is everything else on this screen. It was five SEQUENTIAL awaits — each its own ~5s
   * round trip, because api.js batches by TICK and an await ends the tick — which is what put this
   * screen at 6.4 requests a visit and p95=22.9s, the worst on the 01–04/09 board. */
  ok_('...along with every other call the screen needs',
    ['holidays','bigCleaningDays','adminOTList','allLeaves'].every(a =>
      code.indexOf("api('"+a+"'") >= 0 && code.indexOf("api('"+a+"'") < code.indexOf('await ')));
  /* ...including the two the student half needs. Which tab is showing is known synchronously, so
   * starting them with the rest costs the teacher tab nothing and saves the student tab a whole
   * second round trip — they used to start inside the `if`, four awaits later. */
  ok_('...and the student tab’s two start with them, not four awaits later',
    ['allStudentLeaves','studentAlerts'].every(a =>
      code.indexOf("api('"+a+"'") >= 0 && code.indexOf("api('"+a+"'") < code.indexOf('await ')));
  eq('...and both tabs paint their badges from that one promise',
    (scr.match(/p_ops\.then\(OPS_badges\)/g) || []).length, 2);
  ok_('a failure to count leaves the screen alone', /api\('opsPending',\{staffId:USER\.staffId\}\)\.catch\(\(\)=>null\)/.test(scr));
  ok_('...and OPS_badges shrugs off nothing', /window\.OPS_badges = \(o\) => \{ if\(!o\) return;/.test(app));
}

console.log('\n4) the bell says it too');
{
  ok_('the tray gets a "waiting for you" section', /function opsTrayHTML\(\)\{/.test(app));
  ok_('...above the notifications', /<div class="nm-list">\$\{opsTrayHTML\(\)\}\$\{ns\.map/.test(app));
  ok_('...and the badge counts them in', /_bellN=ns\.filter\(x=>!x\.read\)\.length \+ \(\(_bellOps&&_bellOps\.total\)\|\|0\)/.test(app));
  /* DELIBERATELY NOT SYNTHESISED AS NOTIFICATION ROWS. A notification can be marked read; "รอ
   * ดำเนินการ" cannot — it stops being true when the work is done, not when somebody dismisses it.
   * Keeping it a separate section is what stops "mark all read" hiding two unanswered requests. */
  ok_('marking all read cannot hide pending work', app.indexOf('opsTrayHTML') < app.indexOf('window.MARKREAD'));
  ok_('...and the tray never says "nothing new" over a pending list', /\|\|\(opsTrayHTML\(\)\?'':`<div class="nm-item"><span class="muted">\$\{EN\(\)\?'Nothing new'/.test(app));
  ok_('tapping one lands on the right tab', /LV_MAIN=g\[0\]; CAL_OFF=0; GO\('leaves'\);/.test(app));
  ok_('...and opens the tool itself', /window\[g\[1\]\] && window\[g\[1\]\]\(\)/.test(app));
  // student OT lives on the other tab — a tap that lands on the wrong half is a dead end
  ok_('the student one goes to the student tab', /studentOT:\['student','A_studentOT'\]/.test(app));
  ok_('every count has a destination', /const OPS_GO = \{/.test(app) &&
    ['staffOT', 'holidayOT', 'timeRequests', 'classChanges', 'leaves', 'studentOT']
      .every(k => new RegExp(k + ":\\['(staff|student)'").test(app)));
  ok_('and every one has a sentence a person can read', /const OPS_LABEL = \{ staffOT:\['OT คุณครูรออนุมัติ'/.test(app));
}
{
  // a parent or a teacher must not be asked this — they would only get NO_PERMISSION, once per render
  ok_('only an admin asks', /const opsWanted_ = \(\) => !!\(USER && USER\.role==='Admin' && USER\.staffId\);/.test(app));
  eq('...checked at both bell call sites', (app.match(/opsWanted_\(\) \? api\('opsPending'/g) || []).length, 2);
  ok_('a fresh sign-in does not inherit the last admin’s pile', /_bellAt=0; _bellN=0; _bellOps=null;/.test(app));
  ok_('and a non-admin tray draws nothing at all', /const o=_bellOps; if\(!o \|\| !o\.total\) return '';/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
