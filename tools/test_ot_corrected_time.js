/**
 * tools/test_ot_corrected_time.js — the pick-up time the TEACHER entered is the one the money follows.
 *   node tools/test_ot_corrected_time.js
 *
 * REPORTED 2026-08-19: ธันวา, 18/08. The teacher recorded the real pick-up as 16:40. The child was
 * charged 2 hours of late-pickup OT against 18:09 — the moment the teacher happened to press the
 * button. The attendance row said 16:40 and the charge said 18:09, on the same day, for the same
 * child. An admin then waived ฿100 of a charge that should never have existed at all.
 *
 * The cause was one line at the top of otUpsertForPickup_:
 *
 *     if (c.amount <= 0) return null;
 *
 * A corrected time that owes nothing left the function before it could look at the charge the OLD
 * time had created. So correcting a pick-up UPWARD moved money and correcting it DOWNWARD never
 * did — in the one direction that takes money OFF a family's bill.
 *
 * Three handlers had their own version of this arithmetic (the parent's check-out, the teacher's
 * on-behalf check-out, the correction form) and each stopped at `if (amount > 0)`. They now share
 * otReconcile_ in the engine and otUpsertForPickup_ on Apps Script, and both answer the same way:
 *
 *   nothing owed            -> the charge is CANCELLED, kept at zero so the correction can be SEEN
 *   something owed          -> created/recomputed, keeping any discount the school granted
 *   PAID                    -> never touched
 *   CANCELLED by an ADMIN   -> stays cancelled: that was a decision about money
 *   CANCELLED by this rule  -> comes back if the time changes again: that was only arithmetic
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
const eng = R('webapp/engine.js'), otgs = R('src/OT.gs');

const DAY = '2026-08-18';
function boot(now) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], OTRatePerHour: 100, OTGraceMinutes: 21,
      DefaultStudentIn: '08:00', DefaultStudentOut: '17:00', GPS_Lat: 0, GPS_Lng: 0, Radius: 999999 },
    students: [{ StudentID: 'STD-01', Nickname: 'ธันวา', NameTH: 'ธันวา', Class: 'Nursery 2', Status: 'ACTIVE', ParentID: 'PAR-1' }],
    staff: [{ StaffID: 'STF-01', NameTH: 'ครู', Department: 'Nursery 2', Role: 'Teacher' }],
    classes: [{ ClassName: 'Nursery 2', TeacherID: 'STF-01' }],
    otDaily: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    parents: [{ ParentID: 'PAR-1' }], userLinks: [], leaves: [], payments: [], studentCharges: [],
    prepayments: [], paymentSlips: [], journals: [], comments: [], staffGroups: [], workSchedule: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {}, absenceLog: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], holidays: [], otRecords: []
  };
  const at = new Date(now || (DAY + 'T18:09:00'));
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const row = M => M.otDaily[0] || null;

console.log('\n1) the reported case, end to end');
{
  // 18:09 — the teacher taps at the end of the day, entering no time. The charge is real.
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'แม่มารับ' });
  eq('tapped at 18:09 with no time entered: 2 hours, ฿200', [row(M).PickupTime, row(M).Hours, row(M).Amount], ['18:09', 2, 200]);

  // ...then the teacher corrects it to the time the child actually went home
  const r = H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '16:40', remark: 'กลับจริง 16:40' });
  eq('the attendance now says 16:40', r.checkOut, '16:40');
  eq('...and so does the charge', row(M).PickupTime, '16:40');
  eq('...which is now ZERO — 16:40 is before the school day ends', [row(M).Amount, row(M).FullAmount, row(M).Hours], [0, 0, 0]);
  eq('...and cancelled, by the arithmetic rather than by a person', [row(M).Status, row(M).CancelledBy], ['CANCELLED', 'AUTO_TIME']);
  ok_('...saying why, in words the school can read', /16:40/.test(row(M).CancelNote || ''));
  eq('the family owes nothing for that day', H.otDaily({ studentId: 'STD-01' }).length, 0);
}
{
  // the same correction through the teacher's own button, which is the path that actually failed
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'แม่มารับ' });
  eq('the charge exists', row(M).Amount, 200);
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', time: '16:40', remark: 'แก้เวลาจริง' });
  eq('correcting through the on-behalf button removes it too', [row(M).PickupTime, row(M).Amount, row(M).Status], ['16:40', 0, 'CANCELLED']);
  eq('...and the attendance agrees', H.studentCheckinHistory({ studentId: 'STD-01' })[0].OutTime, '16:40');
}

console.log('\n2) the time the teacher ENTERS is the time, in both directions');
{
  const { H, M } = boot();
  // a teacher tidying up at 18:09 records a child who really left at 12:57 — no charge, ever
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', time: '12:57', remark: 'พ่อรับตอนเที่ยง' });
  eq('12:57 entered at 18:09 raises nothing', M.otDaily.length, 0);
}
{
  const { H, M } = boot(DAY + 'T16:00:00');
  // ...and one who really left at 18:40, recorded at 16:00 the next morning, is charged for 18:40
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', time: '18:40', remark: 'ลืมลงเวลา' });
  eq('18:40 entered at 16:00 charges for 18:40', [row(M).PickupTime, row(M).LateMinutes, row(M).Amount], ['18:40', 100, 200]);
}

console.log('\n3) a waiver the school granted is never lost, and never quietly re-applied');
{
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'x' });
  H.adminUpdateOT({ staffId: 'STF-01', otId: row(M).OTID, amount: 100, reason: 'ส่วนลดพิเศษ' });
  eq('the waiver stands: charge 200, billed 100', [row(M).FullAmount, row(M).Discount, row(M).Amount], [200, 100, 100]);
  // the real pick-up turns out to be later still — the CHARGE grows, the waiver survives
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '19:30' });
  eq('a bigger charge keeps the same waiver', [row(M).FullAmount, row(M).Discount, row(M).Amount], [300, 100, 200]);
  // ...and correcting it away zeroes the lot
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '16:40' });
  eq('correcting it away leaves nothing owed', [row(M).Amount, row(M).Status], [0, 'CANCELLED']);
}

console.log('\n4) what may and may not be revived');
{
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'x' });
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '16:40' });
  eq('cancelled by arithmetic', [row(M).Status, row(M).CancelledBy], ['CANCELLED', 'AUTO_TIME']);
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '18:09' });
  eq('...comes back when the time comes back', [row(M).Status, row(M).Amount, row(M).PickupTime], ['UNPAID', 200, '18:09']);
  ok_('...with no cancellation note left behind', !row(M).CancelledBy && !row(M).CancelNote);
}
{
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'x' });
  H.adminCancelOT({ staffId: 'STF-01', otId: row(M).OTID });
  eq('an ADMIN cancelled it', [row(M).Status, row(M).CancelledBy || ''], ['CANCELLED', '']);
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '19:30' });
  // adminCancelOT leaves the figure on the row for the record — OT_CLOSED is what keeps it off a
  // bill. What matters here is that the correction did not TOUCH the row: same status, same time.
  eq('...and a later check-out edit does NOT quietly reinstate the charge',
    [row(M).Status, row(M).PickupTime, row(M).CancelledBy || ''], ['CANCELLED', '18:09', '']);
  eq('...nor does it count against the family', H.otDaily({ studentId: 'STD-01' }).length, 0);
}
{
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'x' });
  M.otDaily[0].Status = 'PAID';
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '16:40' });
  eq('money already paid is never rewritten by a correction', [row(M).Status, row(M).Amount, row(M).PickupTime], ['PAID', 200, '18:09']);
}
{
  // clearing the pick-up entirely ("the parent tapped by mistake") takes the charge with it
  const { H, M } = boot();
  H.staffStudentCheckin({ studentId: 'STD-01', type: 'OUT', staffId: 'STF-01', remark: 'x' });
  H.editStudentAttendance({ role: 'Admin', studentId: 'STD-01', date: DAY, checkOut: '' });
  eq('cleared pick-up, cleared charge', [row(M).Amount, row(M).Status], [0, 'CANCELLED']);
  eq('...and the child is back at school', H.studentCheckinHistory({ studentId: 'STD-01' })[0].OutTime, '');
}

console.log('\n5) one rule, in one place, on each side');
{
  ok_('the engine has a single reconcile', /function otReconcile_\(student, date, pickupHHMM\)\{/.test(eng));
  eq('...used by every handler that touches a pick-up', (eng.match(/otReconcile_\(/g) || []).length - 1, 3);
  ok_('no handler builds an OT row for itself any more', !/M\.otDaily\.push\(\{OTID:id,/.test(eng));
  ok_('the reason is written down', /Money that a\s*\n\s*\* teacher had already put right, still on the family's bill\./.test(eng));
}
{
  ok_('the Apps Script route no longer leaves early when nothing is owed',
    !/var c = otComputeFor_\(student, pickupHHMM\);\s*\n\s*if \(c\.amount <= 0\) return null;/.test(otgs));
  ok_('...it cancels the charge the old time made', /Status: 'CANCELLED', CancelledBy: OT_CANCEL_AUTO_/.test(otgs));
  // v254: "PAID" alone is not enough — a fully waived charge is marked PAID with nothing received,
  // and freezing THAT is what stopped a corrected time from ever charging again
  ok_('...keeps a row with money received untouched', /if \(settled\) return null;\s+\/\/ settled money is never rewritten here/.test(otgs));
  ok_('...and asks whether money actually arrived, not just the status', /function otMoneyReceived_\(o\) \{/.test(otgs));
  ok_('...leaves an ADMIN\'s cancellation alone', /if \(st === 'CANCELLED' && String\(ex\.CancelledBy \|\| ''\) !== OT_CANCEL_AUTO_\) return null;/.test(otgs));
  ok_('...and revives its own', /if \(st === 'CANCELLED'\) \{ patch\.Status = 'UNPAID'; patch\.CancelledBy = ''; patch\.CancelNote = ''; \}/.test(otgs));
  ok_('the incident is named where the next person will look', /ธันวา on 18\/08/.test(otgs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
