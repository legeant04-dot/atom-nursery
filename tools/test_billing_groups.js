/**
 * tools/test_billing_groups.js — วันตัดรอบบิล: the roster cut the way the bills actually go out.
 *   node tools/test_billing_groups.js
 *
 * ASKED 2026-09-12: "หัวข้อการเงิน เพิ่มเมนู วันตัดรอบบิล ให้จัดกลุ่มนักเรียนที่มีการระบุวันเรียกเก็บ …
 * หากไม่มีการระบุก็จะเป็นกลุ่มเรียกเก็บวันที่ 5 … จุดประสงค์คือต้องการออกบิลรายกลุ่ม เช่น ออกบิลกลุ่ม
 * ของนักเรียนวันที่ 5 หรือ 15 … แสดงชื่อนักเรียนเป็นชื่อเล่น และสามารถกดออกบิลในเมนูนี้ได้เลย"
 *
 * BillingDay has decided every bill's DueDate since 2026-08-24 (tools/test_billing_day.js). What was
 * missing was any way to SEE it: the only route to "who is on the 15th" was opening children one at
 * a time, and the only way to bill a round was to remember the names and tick them off a list of
 * everybody. That is how a family gets missed for a month.
 *
 * Two things here can cost the school money or credibility, and both are about counting:
 *
 *  1. THE GROUPING IS BY THE DAY THAT IS USED, NOT BY WHAT IS TYPED. A blank BillingDay and an
 *     explicit "5" are the same billing round. Splitting them would show the school two groups on
 *     the same date and invite them to bill one and forget the other.
 *
 *  2. THE NUMBER ON THE BUTTON IS THE NUMBER OF BILLS IT WILL CREATE. It counts only children who
 *     are neither already billed this month nor prepaid — exactly the two the server refuses. A
 *     button offering "12 คน" that issues eight teaches the admin to stop believing the screen, on
 *     the one screen where เรื่องเงิน is the whole point.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), codeGs = R('src/Code.gs');

function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [{ id: 'M6900', labelTH: 'รายเดือน 6,900', price: 6900 }],
      LeaveQuota: {}, BigCleaningDays: [], Departments: '' }, over.config || {}),
    students: over.students || [], payments: over.payments || [], prepayments: over.prepayments || [],
    studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [],
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
const kid = (id, nick, over) => Object.assign({ StudentID: id, NameTH: 'เด็กชาย ' + id, Nickname: nick,
  Class: 'Nursery 1', Status: 'ACTIVE', Plan: 'M6900', ParentID: 'PAR-' + id }, over || {});
const MONTH = '2026-09';
const dayOf = (r, d) => (r.groups || []).find(g => g.day === d) || {};

console.log('\n1) blank and "5" are ONE round — the school\'s own default must not go invisible');
{
  const { H } = boot({ students: [kid('S1', 'เอ'), kid('S2', 'บี', { BillingDay: 5 }), kid('S3', 'ซี', { BillingDay: 15 })] });
  const r = H.billingGroups({ month: MONTH });
  eq('two rounds, not three', r.groups.map(g => g.day), [5, 15]);
  eq('the school default is named', r.defaultDay, 5);
  eq('...and the 5th holds both the blank and the explicit one', dayOf(r, 5).count, 2);
  eq('...and is flagged as the default round', dayOf(r, 5).isDefault, true);
  eq('...while the 15th is not', dayOf(r, 15).isDefault, false);
  // the difference is still readable where the admin needs it: who ASKED for this day
  eq('one of the two on the 5th set it by hand', dayOf(r, 5).ownCount, 1);
  eq('...and the child on the 15th did', dayOf(r, 15).ownCount, 1);
  eq('nobody is lost between the rounds', r.total, 3);
}
{
  // the school moving its own day moves everyone who never agreed one — and merges the rounds
  const { H } = boot({ students: [kid('S1', 'เอ'), kid('S2', 'บี', { BillingDay: 15 })], config: { BillingDueDay: 15 } });
  const r = H.billingGroups({ month: MONTH });
  eq('changing the school default re-cuts the rounds', r.groups.map(g => g.day), [15]);
  eq('...and both children are on it', dayOf(r, 15).count, 2);
  eq('...only one of whom asked for it', dayOf(r, 15).ownCount, 1);
}
{
  // rubbish in the cell is not a billing day — the same fallback billDueDate already uses
  const { H } = boot({ students: [kid('S1', 'เอ', { BillingDay: 'ทุกวันที่ 20' }), kid('S2', 'บี', { BillingDay: 0 })] });
  eq('an unreadable day falls into the school\'s round', H.billingGroups({ month: MONTH }).groups.map(g => g.day), [5]);
}

console.log('\n2) the due date the round prints is the one the bill will carry');
{
  const { H, M } = boot({ students: [kid('S1', 'เอ', { BillingDay: 15 })] });
  eq('the round says when it falls due', dayOf(H.billingGroups({ month: MONTH }), 15).dueDate, '2026-09-15');
  H.issueBillsFor({ month: MONTH, studentIds: ['S1'], staffId: 'ADM' });
  eq('...and the bill agrees', (M.payments[0] || {}).DueDate, '2026-09-15');
}
{
  // a day that does not exist in the month is the LAST day of it, on the screen as well as the bill
  const { H } = boot({ students: [kid('S1', 'เอ', { BillingDay: 31 })] });
  eq('the 31st of November is shown as the 30th', dayOf(H.billingGroups({ month: '2026-11' }), 31).dueDate, '2026-11-30');
}

console.log('\n3) THE NUMBER ON THE BUTTON = the number of bills it will create');
{
  const { H, M } = boot({
    students: [kid('S1', 'เอ'), kid('S2', 'บี'), kid('S3', 'ซี'), kid('S4', 'ดี')],
    payments: [{ BillingID: 'BL-1', StudentID: 'S1', Month: MONTH, Amount: 6900, TotalDue: 6900, Status: 'UNPAID', Items: [] }],
    prepayments: [{ PrepayID: 'PP-1', StudentID: 'S2', Months: 3, Status: 'PAID', Amount: 18630,
      Covered: ['2026-09', '2026-10', '2026-11'] }]
  });
  const g = dayOf(H.billingGroups({ month: MONTH }), 5);
  eq('the round holds everybody', g.count, 4);
  eq('one is already billed', g.billed, 1);
  eq('one has paid in advance', g.prepaid, 1);
  eq('so the button offers exactly the other two', g.pending, 2);
  // and the server agrees: issuing the two the button names creates two bills and skips nothing
  const ids = g.students.filter(s => !s.billed && !s.prepaid).map(s => s.studentId);
  eq('...which are S3 and S4', ids.sort(), ['S3', 'S4']);
  const out = H.issueBillsFor({ month: MONTH, studentIds: ids, staffId: 'ADM' });
  eq('the batch creates as many bills as the button promised', out.created, 2);
  eq('...and refuses none of them', out.skipped.length, 0);
  eq('...leaving three bills for the month — the one that existed plus the two just made', M.payments.length, 3);
  // asking again, the round is finished — the button has nothing left to offer
  eq('after issuing, nothing is pending', dayOf(H.billingGroups({ month: MONTH }), 5).pending, 0);
}
{
  /* THE PREPAID CHILD IS THE ONE THAT MATTERS. If the screen counted them as pending, the batch
   * would come back with a PREPAID_MONTH refusal for a child the admin was told would be billed —
   * and the school's prepay discount only works if the app never double-bills a family who paid. */
  const { H } = boot({ students: [kid('S1', 'เอ')],
    prepayments: [{ PrepayID: 'PP-1', StudentID: 'S1', Months: 6, Status: 'PAID', Amount: 35190,
      Covered: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'] }] });
  const g = dayOf(H.billingGroups({ month: MONTH }), 5);
  eq('a prepaid child is shown, not hidden', g.count, 1);
  eq('...marked as prepaid', g.students[0].prepaid, true);
  eq('...and NOT offered to the button', g.pending, 0);
}
{
  // the month in the picker decides every status on the screen — prepaid in September, payable in March
  const { H } = boot({ students: [kid('S1', 'เอ')],
    prepayments: [{ PrepayID: 'PP-1', StudentID: 'S1', Months: 2, Status: 'PAID', Amount: 13110,
      Covered: ['2026-09', '2026-10'] }] });
  eq('September is covered', dayOf(H.billingGroups({ month: MONTH }), 5).pending, 0);
  eq('...and March is not', dayOf(H.billingGroups({ month: '2027-03' }), 5).pending, 1);
}

console.log('\n4) the nickname is the headline, as it is everywhere else a parent-facing name appears');
{
  const { H } = boot({ students: [kid('S1', 'เอ')] });
  const s = dayOf(H.billingGroups({ month: MONTH }), 5).students[0];
  eq('the nickname is carried', s.nick, 'เอ');
  eq('...and the full name with it, for the line underneath', s.name, 'เด็กชาย S1');
  eq('...and the class', s.className, 'Nursery 1');
  ok_('the screen prints the nickname', /\$\{esc\(dnick\(s\)\)\}<\/span>/.test(app) || /cycleChip/.test(app));
  ok_('...via the shared nickname helper, not a field read by hand', /function cycleChip\(s\)\{[\s\S]*?dnick\(s\)/.test(app));
}

console.log('\n5) the screen, the tab and the gate');
{
  ok_('the finance screen has a รอบบิล tab', /tab\('cycle','📅',EN\(\)\?'Bill day':'รอบบิล'\)/.test(app));
  ok_('...which renders the rounds', /FIN_TAB==='cycle'\?cycleTab:inTab/.test(app));
  /* THE READ IS ONLY MADE ON ITS OWN TAB. It is the whole roster with every child's bill state —
   * the most expensive read on this screen — and the income tab, which the admin opens all day,
   * must not pay for it. This is the same discipline as the Phase 1–3 speed work. */
  ok_('the roster is fetched only when that tab is open',
    /FIN_TAB==='cycle'\?api\('billingGroups',\{month\}\)\.catch\(\(\)=>null\):Promise\.resolve\(null\)/.test(app));
  ok_('issuing a round goes through the same batch route as ออกบิล (เลือก)',
    /A_cycleIssueDo[\s\S]{0,900}api\('issueBillsFor',\{studentIds:ids,month:bg\.month\}\)/.test(app));
  ok_('...and only the children who really got a bill are notified',
    /const billed=\(r\.students\|\|\[\]\)\.map\(x=>x\.studentId\);\n\s+if\(notify&&billed\.length\)\{ try\{ await api\('notifyBills'/.test(app));
  ok_('...with the same skipped report both buttons use', /A_skippedModal\(r\.skipped, bg\.month\)/.test(app));
  // the roster + everyone's bill state is admin-only, the same class of answer as prepaidStudents
  ok_('the route is admin-only on the server', /billingGroups: 1,/.test(codeGs));
  ok_('...and the reason is written down', /the whole roster grouped by billing day, with each child's bill state/.test(codeGs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
