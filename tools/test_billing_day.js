/**
 * tools/test_billing_day.js — the day of the month THIS family pays on.
 *   node tools/test_billing_day.js
 *
 * ASKED 2026-08-24: "ข้อมูลนักเรียน เพิ่มหัวข้อ วันที่ตัดรอบบิล โดยให้ระบุว่านักเรียนคนนี้จะต้อง
 * ชำระบิลทุกๆวันที่เท่าไหร่ของเดือน เช่น นักเรียน A โรงเรียนต้องการให้ชำระบิลค่าเทอมทุกๆวันที่ 15"
 *
 * Every bill the app has ever issued was stamped `DueDate: month + '-05'` — the 5th, for everybody,
 * because that is what the code said. Families are not all paid on the same day, and the school
 * agrees a date with each of them. Everyone whose day was not the 5th was overdue on paper from the
 * 6th of every month, which is the kind of thing that gets a family chased for money they are not
 * late with.
 *
 * The second half of this file is the outstanding-total tile, on the finance screen: it printed the
 * TUITION figure under a label that promises every kind of it, so it read a calm 0.00 on a month
 * with ฿200 of student OT owed. Same fault as the dashboard tile (v272), one screen along.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), cfgGs = R('src/Config.gs'), staffGs = R('src/Staff.gs');

function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [{ id: 'M6900', labelTH: 'รายเดือน 6,900', price: 6900 }],
      LeaveQuota: {}, BigCleaningDays: [], Departments: '' }, over.config || {}),
    students: over.students || [],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }],
    classes: [{ ClassName: 'Nursery 1' }], parents: [], userLinks: [], payroll: [], payrollConfig: {},
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [],
    comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    leaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
    vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    holidays: [], holidayAttend: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const kid = over => Object.assign({ StudentID: 'S1', NameTH: 'ก ข', Nickname: 'เอ', Class: 'Nursery 1',
  Status: 'ACTIVE', Plan: 'M6900', ParentID: 'PAR-1' }, over || {});
const dueOf = (M, sid) => (M.payments.find(b => b.StudentID === sid) || {}).DueDate;

console.log('\n1) "ทุกวันที่ 15" — and the bill says so');
{
  const { H, M } = boot({ students: [kid({ BillingDay: 15 })] });
  H.issueBillsFor({ month: '2026-09', studentIds: ['S1'], staffId: 'ADM' });
  eq('the bill falls due on this family’s own day', dueOf(M, 'S1'), '2026-09-15');
}
{
  const { H, M } = boot({ students: [kid({})] });
  H.issueBillsFor({ month: '2026-09', studentIds: ['S1'], staffId: 'ADM' });
  eq('a family with no day agreed keeps the school’s 5th', dueOf(M, 'S1'), '2026-09-05');
}
{
  const { H, M } = boot({ students: [kid({})], config: { BillingDueDay: 10 } });
  H.issueBillsFor({ month: '2026-09', studentIds: ['S1'], staffId: 'ADM' });
  eq('...and the school can move its own default', dueOf(M, 'S1'), '2026-09-10');
}
{
  // A DAY THAT DOES NOT EXIST IN THAT MONTH must not roll into the next one — the due date would
  // then be after the month the bill is for.
  const { H, M } = boot({ students: [kid({ BillingDay: 31 })] });
  H.issueBillsFor({ month: '2026-11', studentIds: ['S1'], staffId: 'ADM' });
  eq('the 31st of a 30-day month is the 30th, not the 1st of December', dueOf(M, 'S1'), '2026-11-30');
  const b = boot({ students: [kid({ BillingDay: 30 })] });
  b.H.issueBillsFor({ month: '2027-02', studentIds: ['S1'], staffId: 'ADM' });
  eq('...and February is the 28th', dueOf(b.M, 'S1'), '2027-02-28');
}
{
  // rubbish in the cell is not a due date — fall back rather than stamping "2026-09-undefined"
  const { H, M } = boot({ students: [kid({ BillingDay: 'วันที่ 15' })] });
  H.issueBillsFor({ month: '2026-09', studentIds: ['S1'], staffId: 'ADM' });
  eq('an unreadable value falls back to the school’s day', dueOf(M, 'S1'), '2026-09-05');
  const z = boot({ students: [kid({ BillingDay: 0 })] });
  z.H.issueBillsFor({ month: '2026-09', studentIds: ['S1'], staffId: 'ADM' });
  eq('...and so does a zero', dueOf(z.M, 'S1'), '2026-09-05');
}
{
  // the single-student route (A_issueBill) must agree with the batch one — same rule, one helper
  const { H, M } = boot({ students: [kid({ BillingDay: 20 })] });
  H.issueBill({ studentId: 'S1', month: '2026-09', staffId: 'ADM', items: [['ค่าเทอม', 6900]], amount: 6900 });
  eq('issuing one bill uses the same day as issuing them all', dueOf(M, 'S1'), '2026-09-20');
}

console.log('\n2) it is on the record and on the form');
{
  const { H } = boot({ students: [kid({ BillingDay: 15 })] });
  const d = H.studentProfile({ studentId: 'S1', staffId: 'ADM', role: 'Admin' });
  eq('the record says which day', d.billingDay, 15);
  eq('...and that it is this family’s own, not the school’s', d.billingDayOwn, true);
  const e = boot({ students: [kid({})] }).H.studentProfile({ studentId: 'S1', staffId: 'ADM', role: 'Admin' });
  eq('...while a family on the default is marked as such', [e.billingDay, e.billingDayOwn], [5, false]);
  ok_('the profile prints it in words', /ทุกวันที่ \$\{d\.billingDay\} ของเดือน/.test(app));
  ok_('...and says when it is only the school default', /\(ค่าของโรงเรียน\)/.test(app));
}
{
  ok_('the admin can set it', /id="stf_BillingDay"/.test(app));
  ok_('...within 1–31', /min="1" max="31"/.test(app));
  ok_('...and it is saved', /BillingDay:v\('BillingDay'\)===''\?''/.test(app));
  ok_('...as blank when blank, which means "use the school’s day"', /\?''\:Math\.min\(31,Math\.max\(1,Number\(v\('BillingDay'\)\)\|\|1\)\)/.test(app));
  ok_('the sheet is given the column, or the write is dropped in silence', /'BillingDay'\]\); \} catch \(e\) \{\}/.test(staffGs));
  ok_('...and it is declared in the schema', /'BillingDay'\]/.test(cfgGs));
  ok_('a shorter month is explained rather than left to surprise somebody',
    /บิลจะครบกำหนดในวันสุดท้ายของเดือนนั้น/.test(app));
}

console.log('\n3) "ค้างชำระ" on the finance screen means every kind of it');
{
  ok_('the tile totals the three kinds', /const _all=_t\+_c\+_o;/.test(app));
  ok_('...and breaks them out underneath', /🏫 \$\{baht\(_t\)\} · ⏰ \$\{baht\(_o\)\}/.test(app));
  ok_('...and turns pink when anything is owed', /stat\(_all>0\?'pink':'amber'/.test(app));
  ok_('...rather than printing the tuition figure under a label that promises the lot',
    !/stat\('amber',baht\(f\.tuitionOutstanding\),t\('fin\.outstanding'\)\)/.test(app));
  ok_('the stat tile can carry a sub-line at all', /const stat=\(cls,n,l,sub\)=>/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
