/**
 * tools/test_ot_retro_pause.js — a waiver is not a payment, and a return date is a school day.
 *   node tools/test_ot_retro_pause.js
 *
 * Two things reported on 2026-08-20.
 *
 * 1. ธันวา, 18/08 again. The charge had been correctly cancelled when the time was fixed to 16:40 —
 *    but putting the time BACK to 18:09 raised nothing, and neither finance nor the family heard a
 *    word. Two causes, both about a word meaning two things:
 *
 *      'PAID' meant "the family paid" AND "waived in full, nothing left to collect" (adminUpdateOT
 *      marks a zero amount PAID). Nothing could tell them apart, so a waived row was frozen for
 *      ever and a charge that became real again could never be raised.
 *
 *      And a correction that CREATES a charge told nobody. A live check-out messages the parent; the
 *      correction form did not, so a charge for last Tuesday could appear on a bill on Friday with
 *      no explanation. A school should never have to have that argument.
 *
 * 2. โมน่า is due back on 20/08. The system kept her paused through the whole of that day and let
 *    her in on the 21st — a day of a parent tapping a button that refuses them. PauseTo is the day
 *    the child COMES BACK.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), code = R('src/Code.gs'), otgs = R('src/OT.gs');

const DAY = '2026-08-18', TODAY = '2026-08-20';
function boot(students, now) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], OTRatePerHour: 100, OTGraceMinutes: 21,
      DefaultStudentIn: '08:00', DefaultStudentOut: '17:00', GPS_Lat: 0, GPS_Lng: 0, Radius: 999999, Departments: '' },
    students: students || [{ StudentID: 'STD-01', Nickname: 'ธันวา', NameTH: 'ธันวา', Class: 'Nursery 1', Status: 'ACTIVE', ParentID: 'PAR-1' }],
    staff: [{ StaffID: 'STF-01', NameTH: 'ครู', Department: '*', Role: 'Admin', PositionLevel: 'Admin' }],
    classes: [{ ClassName: 'Nursery 1' }],
    otDaily: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    parents: [{ ParentID: 'PAR-1' }], userLinks: [], leaves: [], payments: [], studentCharges: [],
    prepayments: [], paymentSlips: [], journals: [], comments: [], staffGroups: [], workSchedule: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {}, absenceLog: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], holidays: [], otRecords: []
  };
  const at = new Date((now || TODAY) + 'T10:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const row = M => M.otDaily[0] || null;
const setOut = (H, t) => H.editStudentAttendance({ role: 'Admin', staffId: 'STF-01', studentId: 'STD-01', date: DAY, checkOut: t });

console.log('\n1) the charge comes back when the time comes back');
{
  const { H, M } = boot();
  setOut(H, '18:09');
  eq('18:09 owes 2 hours', [row(M).Amount, row(M).Status], [200, 'UNPAID']);
  setOut(H, '16:40');
  eq('16:40 owes nothing', [row(M).Amount, row(M).Status], [0, 'CANCELLED']);
  const r = setOut(H, '18:09');
  eq('...and 18:09 owes 2 hours again', [row(M).Amount, row(M).Status, row(M).PickupTime], [200, 'UNPAID', '18:09']);
  ok_('...and the caller is handed the charge, so somebody can be told', !!r.ot && r.ot.amount === 200);
}
{
  // the exact shape the live row was in: waived to zero, which adminUpdateOT marks PAID
  const { H, M } = boot();
  setOut(H, '18:09');
  H.adminUpdateOT({ staffId: 'STF-01', otId: row(M).OTID, amount: 0, discountReason: 'ยกเว้นให้' });
  eq('a full waiver reads as PAID with nothing owed', [row(M).Amount, row(M).Status], [0, 'PAID']);
  ok_('...but no money was ever received', !Number(row(M).SlipAmount || 0));
  const r = setOut(H, '19:30');
  // the waiver is an AMOUNT (฿200 off) and survives the recompute, as it does everywhere else — the
  // point here is that the row is chargeable again at all, instead of frozen for ever
  eq('so a corrected time can charge again', [row(M).FullAmount, row(M).Discount, row(M).Amount, row(M).Status], [300, 200, 100, 'UNPAID']);
  ok_('...and the charge is reported, with the net beside it', !!r.ot && r.ot.amount === 300 && r.ot.net === 100);
}
{
  // money that really arrived is still untouchable
  const { H, M } = boot();
  setOut(H, '18:09');
  M.otDaily[0].Status = 'PAID'; M.otDaily[0].SlipAmount = 200;
  setOut(H, '16:40');
  eq('a charge the family PAID is never rewritten', [row(M).Amount, row(M).Status, row(M).PickupTime], [200, 'PAID', '18:09']);
}
{
  const { H, M } = boot();
  setOut(H, '18:09');
  M.otDaily[0].SlipAmount = 50;                   // a part payment is still money received
  setOut(H, '16:40');
  eq('...and neither is one that is part paid', [row(M).Amount, row(M).PickupTime], [200, '18:09']);
}

console.log('\n2) a back-dated charge is not a surprise on a bill');
{
  ok_('the correction goes through a route that can notify', /editStudentAttendance: function \(p\) \{ return editAttendanceWrite_\(p\); \}/.test(code));
  ok_('...the parent is told', /linePushText_\(parent\.LineUID, msg\)/.test(code));
  ok_('...and finance too', /notifyAdmins_\(msg\)/.test(code));
  ok_('the message names the DAY, not just the amount', /'👶 ' \+ who \+ ' · วันที่ ' \+ date/.test(code));
  ok_('...and says where the charge came from', /รายการนี้เกิดจากการแก้ไขเวลารับ-ส่งของวันดังกล่าว/.test(code));
  ok_('...and quotes the net after any waiver', /ot\.net != null \? ot\.net : ot\.amount/.test(code));
  ok_('a failed message never fails the correction', /Notification never breaks the correction/.test(code));
  ok_('nothing is sent when nothing is owed', /if \(!ot \|\| !\(Number\(ot\.amount\) > 0\)\) return res;/.test(code));
}

console.log('\n3) โมน่า comes back ON the 20th');
{
  const kid = [{ StudentID: 'STD-01', Nickname: 'โมน่า', NameTH: 'โมน่า', Class: 'Nursery 1',
    Status: 'PAUSED', PauseFrom: '2026-07-20', PauseTo: '2026-08-20', ParentID: 'PAR-1' }];
  { const { H } = boot(kid, '2026-08-19');
    const p = H.pausedStudents()[0];
    eq('the day before: still away', [p.active, p.due], [true, false]);
    eq('...and not on the class list', (H.dashboard().classes[0] || {}).students, []);
    throws_('...and check-in refuses, saying why', () => H.parentCheckin({ studentId: 'STD-01', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 }), 'ลาชั่วคราว'); }
  { const { H } = boot(kid, '2026-08-20');
    const p = H.pausedStudents()[0];
    eq('the return date: back', [p.active, p.due, p.dueToday], [false, true, true]);
    const c = H.dashboard().classes[0];
    eq('...on the class list again', c.students.map(s => s.nick), ['โมน่า']);
    eq('...marked, so nobody reads it as a plain absence', [c.students[0].pauseDue, c.students[0].pauseTo], [true, '2026-08-20']);
    ok_('...and check-in works', !!H.parentCheckin({ studentId: 'STD-01', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 })); }
  { const { H } = boot(kid, '2026-08-25');
    const p = H.pausedStudents()[0];
    eq('after the date: due, and no longer "today"', [p.active, p.due, p.dueToday], [false, true, false]); }
}
{
  // an open-ended leave (no return date) never becomes due by itself
  const kid = [{ StudentID: 'STD-01', Nickname: 'โมน่า', NameTH: 'โมน่า', Class: 'Nursery 1',
    Status: 'PAUSED', PauseFrom: '2026-07-20', PauseTo: '', ParentID: 'PAR-1' }];
  const { H } = boot(kid, '2027-01-01');
  const p = H.pausedStudents()[0];
  eq('no return date: away until somebody says otherwise', [p.active, p.due], [true, false]);
}
{
  // the admin confirms the return — early or on time — and the leave is wiped
  const kid = [{ StudentID: 'STD-01', Nickname: 'โมน่า', NameTH: 'โมน่า', Class: 'Nursery 1',
    Status: 'PAUSED', PauseFrom: '2026-07-20', PauseTo: '2026-09-30', ParentID: 'PAR-1' }];
  const { H, M } = boot(kid, '2026-08-20');
  eq('away, and due back in September', H.pausedStudents()[0].active, true);
  H.setStudentPause({ staffId: 'STF-01', studentId: 'STD-01', paused: false });
  eq('coming back EARLY clears the leave outright', [M.students[0].Status, M.students[0].PauseFrom, M.students[0].PauseTo], ['ACTIVE', '', '']);
  eq('...and there is nothing left on the list', H.pausedStudents().length, 0);
  ok_('...and check-in works', !!H.parentCheckin({ studentId: 'STD-01', type: 'IN', parentId: 'PAR-1', lat: 0, lng: 0 }));
}

console.log('\n4) the admin sees it on the screen they open every morning');
{
  ok_('the dashboard carries the list', /paused:H\.pausedStudents\(\)/.test(eng));
  ok_('...and the card is drawn under attendance by class', /\$\{A_pausedCard\(d\.paused\)\}/.test(app));
  ok_('the ones due back are called out first', /ครบกำหนดแล้ว — กดยืนยันว่ากลับมาเรียนแล้ว/.test(app));
  ok_('...with TODAY said plainly', /ครบกำหนดวันนี้/.test(app));
  ok_('...and the dates of the leave shown', /esc\(ddmmyyyy\(x\.from\)\) \} → \$|esc\(ddmmyyyy\(x\.from\)\)\} →/.test(app));
  ok_('one tap confirms the return, from the home screen', /A_resumeStudent\('\$\{esc\(x\.studentId\)\}','home'\)/.test(app));
  ok_('...which works for an early return too', /window\.A_resumeStudent=async\(sid,back\)=>/.test(app));
  ok_('a due child is marked inside their class, not left reading as ขาด', /ลาชั่วคราว · ครบกำหนดแล้ว/.test(app));
}

console.log('\n5) one meaning per word');
{
  ok_('the engine asks whether money arrived', /function otSettled_\(o\)\{/.test(eng));
  ok_('...and Apps Script asks the same question', /function otMoneyReceived_\(o\) \{/.test(otgs));
  ok_('a PAID row with nothing behind it is re-opened, not frozen', /a row marked PAID with no money behind it is a WAIVER, not a payment/.test(eng));
  ok_('the return date is documented as the day they come BACK', /PauseTo is the day the child COMES BACK, not the last day away/.test(eng));
  ok_('...and a due child is distinguished from an away one', /const pauseDue_ = \(s, onDate\)/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
