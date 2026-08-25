/**
 * tools/test_growth_edit.js — a measurement can be corrected, and only by the right person.
 *   node tools/test_growth_edit.js
 *
 * REPORTED 2026-08-25: น้องเบรฟ has the same 10 kg · 76 cm recorded THREE times on 2026-08-14.
 * Growth rows were only ever appended — there was no way to remove two of them, and the chart a
 * nurse reads was stuck with whatever had been typed.
 *
 * WHICH ROW. These rows have no id, and Date+StudentID is not unique — that is the whole point of
 * this bug. So the caller sends the POSITION in the list growthHistory gave them, together with the
 * values they were looking at. If those no longer match, the correction is REFUSED rather than
 * landing on whatever is in that slot now: silently rewriting a different measurement is not an
 * acceptable way to fail on a child's health record.
 *
 * WHO. "คุณครูที่บันทึก / หัวหน้าครู / Admin". A row written before RecordedBy existed belongs to
 * NOBODY — a teacher must not be able to claim an old measurement by being the one who opened the
 * screen, so those are for a head teacher or an admin.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), cfgGs = R('src/Config.gs');

const TODAY = '2026-08-25', DAY = '2026-08-14';
function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1' },
    students: [{ StudentID: 'BRAVE', NameTH: 'เบรฟ', Nickname: 'เบรฟ', Class: 'Nursery 1', Status: 'ACTIVE',
      DOB: '2026-01-14', Gender: 'Male', Weight: 10, Height: 76, LastGrowthUpdate: DAY }],
    // the three identical rows from the screenshot, plus one older measurement
    growthRecords: [
      { Date: '2026-06-14', StudentID: 'BRAVE', AgeMonth: 5, Weight: 8, Height: 70, RecordedBy: 'T1' },
      { Date: DAY, StudentID: 'BRAVE', AgeMonth: 7, Weight: 10, Height: 76, RecordedBy: 'T1' },
      { Date: DAY, StudentID: 'BRAVE', AgeMonth: 7, Weight: 10, Height: 76, RecordedBy: 'T1' },
      { Date: DAY, StudentID: 'BRAVE', AgeMonth: 7, Weight: 10, Height: 76 }        // legacy: nobody's
    ],
    staff: [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูหนึ่ง', Nickname: 'หนึ่ง', Role: 'Teacher', Department: 'Nursery 1', Classes: 'Nursery 1', Status: 'ACTIVE' },
      { StaffID: 'T2', NameTH: 'ครูสอง', Nickname: 'สอง', Role: 'Teacher', Department: 'Nursery 1', Classes: 'Nursery 1', Status: 'ACTIVE' },
      { StaffID: 'HEAD', NameTH: 'หัวหน้าครู', Role: 'Teacher', Department: '*', Status: 'ACTIVE' }
    ],
    classes: [{ ClassName: 'Nursery 1' }], parents: [], userLinks: [], payments: [], studentCharges: [],
    prepayments: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [], payrollConfig: {},
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [],
    comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    leaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
    vaccines: [], growth: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [],
    foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [],
    bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: []
  };
  const at = new Date(TODAY + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  // GROWTH_STD = null, exactly as GAS runs it: the standard band is drawn on the device
  return { H: ctx.createAtomAPI(M, null).H, M };
}
const rowsOf = M => M.growthRecords.filter(r => r.StudentID === 'BRAVE');

console.log('\n1) the duplicates can be removed');
{
  const { H, M } = boot();
  const before = H.growthHistory({ studentId: 'BRAVE' }).records;
  eq('four measurements, three of them the same day', before.length, 4);
  eq('...and each carries the handle a correction comes back with', before.map(r => r.idx), [0, 1, 2, 3]);
  H.deleteGrowth({ studentId: 'BRAVE', idx: 1, wasDate: DAY, wasWeight: 10, wasHeight: 76, staffId: 'ADM', role: 'Admin' });
  eq('one is gone', rowsOf(M).length, 3);
  eq('...and the right one — the others are untouched',
    rowsOf(M).map(r => [r.Date, r.Weight]), [['2026-06-14', 8], [DAY, 10], [DAY, 10]]);
}

console.log('\n2) a measurement can be corrected');
{
  const { H, M } = boot();
  H.editGrowth({ studentId: 'BRAVE', idx: 1, wasDate: DAY, wasWeight: 10, wasHeight: 76,
    weight: 10.4, height: 77, staffId: 'ADM', role: 'Admin' });
  const r = rowsOf(M).find(x => x.Weight === 10.4);
  eq('the numbers changed', [r.Weight, r.Height], [10.4, 77]);
  eq('...and nothing else did', rowsOf(M).length, 4);
}
{
  // re-dating re-ages it: the chart is plotted against the age AT MEASUREMENT, not at typing
  const { H, M } = boot();
  H.editGrowth({ studentId: 'BRAVE', idx: 1, wasDate: DAY, wasWeight: 10, wasHeight: 76,
    date: '2026-07-14', staffId: 'ADM', role: 'Admin' });
  const r = rowsOf(M).find(x => x.Date === '2026-07-14');
  eq('the age is recomputed for the new date', r.AgeMonth, 6);
}
{
  const { H } = boot();
  throws_('a future measurement is refused, as it is on the way in', () =>
    H.editGrowth({ studentId: 'BRAVE', idx: 1, date: '2027-01-01', staffId: 'ADM', role: 'Admin' }), 'ต้องไม่เป็นวันในอนาคต');
  throws_('...and so is a weight of zero', () =>
    H.editGrowth({ studentId: 'BRAVE', idx: 1, weight: 0, staffId: 'ADM', role: 'Admin' }), 'น้ำหนักต้องมากกว่า 0');
}

console.log('\n3) the child’s CURRENT figures follow the newest measurement');
{
  /* STUDENTS.Weight/Height are a copy of the last row. Deleting or re-dating changes which row that
   * is — and the profile would go on quoting a number that is no longer in the history behind it. */
  const { H, M } = boot();
  eq('before: the profile shows the 14/08 figures', [M.students[0].Weight, M.students[0].Height], [10, 76]);
  ['3', '2', '1'].forEach(() => {});
  H.deleteGrowth({ studentId: 'BRAVE', idx: 3, wasDate: DAY, wasWeight: 10, wasHeight: 76, staffId: 'ADM', role: 'Admin' });
  H.deleteGrowth({ studentId: 'BRAVE', idx: 2, wasDate: DAY, wasWeight: 10, wasHeight: 76, staffId: 'ADM', role: 'Admin' });
  H.deleteGrowth({ studentId: 'BRAVE', idx: 1, wasDate: DAY, wasWeight: 10, wasHeight: 76, staffId: 'ADM', role: 'Admin' });
  eq('all three duplicates gone, the older one left', rowsOf(M).length, 1);
  eq('...and the profile now quotes THAT one', [M.students[0].Weight, M.students[0].Height], [8, 70]);
  eq('...with the date to match', M.students[0].LastGrowthUpdate, '2026-06-14');
  H.deleteGrowth({ studentId: 'BRAVE', idx: 0, wasDate: '2026-06-14', wasWeight: 8, wasHeight: 70, staffId: 'ADM', role: 'Admin' });
  eq('with nothing left, the profile is cleared rather than frozen at a number nothing supports',
    [M.students[0].Weight, M.students[0].Height, M.students[0].LastGrowthUpdate], ['', '', '']);
}

console.log('\n4) who may');
{
  const { H } = boot();
  ok_('the teacher who recorded it may fix their own', !!H.editGrowth({ studentId: 'BRAVE', idx: 1, weight: 10.2, staffId: 'T1', role: 'Teacher' }).ok);
  throws_('...another teacher may not', () =>
    H.editGrowth({ studentId: 'BRAVE', idx: 1, weight: 11, staffId: 'T2', role: 'Teacher' }), 'เฉพาะบันทึกที่ตนเองเป็นผู้บันทึก');
  ok_('a head teacher may fix anyone’s', !!H.editGrowth({ studentId: 'BRAVE', idx: 1, weight: 10.3, staffId: 'HEAD', role: 'Teacher' }).ok);
  throws_('a row with no recorder is for a head teacher or an admin, not for whoever opened the screen', () =>
    H.editGrowth({ studentId: 'BRAVE', idx: 3, weight: 11, staffId: 'T1', role: 'Teacher' }), 'ไม่มีชื่อผู้บันทึก');
  ok_('...and a head teacher can', !!H.editGrowth({ studentId: 'BRAVE', idx: 3, weight: 10.9, staffId: 'HEAD', role: 'Teacher' }).ok);
  throws_('a stranger may not', () =>
    H.editGrowth({ studentId: 'BRAVE', idx: 1, weight: 11, staffId: 'NOPE', role: 'Teacher' }), 'เฉพาะคุณครูหรือแอดมิน');
  throws_('an Observer may not — it is a read-only account', () =>
    H.deleteGrowth({ studentId: 'BRAVE', idx: 1, staffId: 'X', role: 'Observer' }), 'ดูได้อย่างเดียว');
}

console.log('\n5) it refuses rather than hitting the wrong row');
{
  const { H, M } = boot();
  throws_('a stale position is refused, not applied to whatever is there now', () =>
    H.deleteGrowth({ studentId: 'BRAVE', idx: 0, wasDate: DAY, wasWeight: 10, wasHeight: 76, staffId: 'ADM', role: 'Admin' }), 'ข้อมูลถูกแก้ไขไปแล้ว');
  eq('...and nothing was touched', rowsOf(M).length, 4);
  throws_('a position past the end is a not-found, not a crash', () =>
    H.deleteGrowth({ studentId: 'BRAVE', idx: 99, staffId: 'ADM', role: 'Admin' }), 'ไม่พบบันทึก');
  throws_('...and so is a missing one', () =>
    H.deleteGrowth({ studentId: 'BRAVE', staffId: 'ADM', role: 'Admin' }), 'ไม่พบบันทึก');
}

console.log('\n6) the screen, and the record of who did what');
{
  const { H, M } = boot();
  H.updateGrowth({ studentId: 'BRAVE', weight: 11, height: 78, staffId: 'T2' });
  const last = rowsOf(M)[rowsOf(M).length - 1];
  eq('a new measurement records WHO took it', last.RecordedBy, 'T2');
  ok_('...and when', !!last.RecordedAt);
  ok_('the column is declared, or the write is dropped in silence', /'RecordedBy', 'RecordedAt'\]/.test(cfgGs));
  const { M: M2, H: H2 } = boot();
  H2.deleteGrowth({ studentId: 'BRAVE', idx: 1, wasDate: DAY, wasWeight: 10, wasHeight: 76, staffId: 'ADM', role: 'Admin' });
  ok_('a deletion is written to the activity log', (M2.activityLog || []).some(a => a.Action === 'deleteGrowth'));
  ok_('the buttons are on the staff screen', /onclick="G_edit\('\$\{esc\(sid\)\}'/.test(app) && /onclick="G_del\('\$\{esc\(sid\)\}'/.test(app));
  ok_('...and NOT on the parent’s, which passes no student id', /\$\{growthRecordsList\(g\.records\)\}/.test(app));
  ok_('the values on screen travel with the correction, so a stale list is caught',
    /wasDate:wasD,wasWeight:wasW,wasHeight:wasH/.test(app));
  ok_('deleting asks first, and says what will happen to the chart', /กราฟการเจริญเติบโตจะถูกวาดใหม่โดยไม่มีรายการนี้/.test(app));
  ok_('the list says who may correct what', /คุณครูแก้ไขได้เฉพาะรายการที่ตนเองบันทึก/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
