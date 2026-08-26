/**
 * tools/test_no_double_bill.js — a month bought in advance is not asked for again.
 *   node tools/test_no_double_bill.js
 *
 * ASKED 2026-08-26: "นักเรียนที่ชำระล่วงหน้ามาแล้ว … จะต้องไม่ออกบิลซ้ำ … ระบบจะต้องแจ้งเตือน
 * ข้อความด้านล่างเสมอว่ามีนักเรียนที่ระบบไม่ออกบิลซ้อนเนื่องจากมีการชำระล่วงหน้าแล้ว มีนักเรียนคนไหนบ้าง
 * จำนวนกี่คน แต่ละคนสถานะเป็นอย่างไร เช่น นักเรียน A (1/6)".
 *
 * The old behaviour issued the bill and credited it straight back to zero. Nobody was overcharged —
 * and the family still received a demand for a month they had paid for in advance, with notifyBills
 * sending them a message about it. Being asked twice for the same money is a credibility problem
 * whether or not the arithmetic holds.
 *
 * THREE THINGS THAT HAD TO MOVE TOGETHER, and the third is the one that could have cost real money:
 *
 *   1. issueBill refuses (PREPAID_MONTH) and generateMonthlyBills reports rather than creating.
 *   2. The picker cannot tick a child it cannot bill, and says where in their prepayment they are —
 *      a checkbox that can be ticked and then quietly ignored teaches nobody anything.
 *   3. financeSummary read the prepaid credit OFF THE BILL. Take the bill away and every covered
 *      month drops out of "รายได้รวม" — a change about not sending a duplicate would have made the
 *      school's own takings appear to shrink. That equivalence is checked in test_billing_p2 and the
 *      reasoning is pinned here.
 *
 * WHAT IS NOT COVERED BY A PREPAY, and must keep being billed: food, activity and special-class
 * charges. They are studentCharges rows, issued and paid separately, so refusing the tuition bill
 * takes nothing away from the school.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function code_(label, fn, want) {
  let c = null; try { fn(); } catch (e) { c = (e && e.code) || String(e); }
  const ok = c === want;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(c)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), code = R('src/Code.gs');

const TODAY = '2026-08-26';
const PLAN = { id: 'P1', labelTH: 'เต็มเดือน', price: 6900 };
function boot(students) {
  const M = {
    config: { Plans: [PLAN], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1',
      PrepayTiers: [{ months: 2, discount: 5 }, { months: 3, discount: 10 }, { months: 6, discount: 15 }, { months: 12, discount: 20 }] },
    students: students,
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', RequireCheckin: false }],
    payments: [], prepayments: [], studentCharges: [], paymentSlips: [], otDaily: [],
    holidays: [], checkinStudent: [], staffAttendanceHistory: [], staffAttendanceToday: [], leaves: [],
    otRecords: [], workSchedule: [], staffGroups: [], classes: [], parents: [], userLinks: [],
    payroll: [], payrollConfig: {}, studentCheckins: [], studentAttendanceToday: [], studentLeaves: [],
    journals: [], comments: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    attendanceReq: [], classChangeReq: [], holidayAttend: []
  };
  const at = new Date(TODAY + 'T09:00:00');
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const kid = (id, nick, over) => Object.assign({ StudentID: id, NameTH: 'ด.ญ. ' + nick, Nickname: nick,
  Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', Plan: 'P1', EnrollDate: '2025-01-01' }, over || {});
const paidPrepay = (H, M, sid, months, from) => {
  const pp = H.prepay({ studentId: sid, months, startMonth: from });
  M.prepayments.find(x => x.PrepayID === pp.PrepayID).Status = 'PAID';
  return pp;
};

console.log('\n1) the tuition bill is refused, with a reason the admin can act on');
{
  const { H, M } = boot([kid('S1', 'ข้าวสวย')]);
  paidPrepay(H, M, 'S1', 6, '2026-08');
  code_('issuing it again is refused', () => H.issueBill({ studentId: 'S1', month: '2026-08' }), 'PREPAID_MONTH');
  let msg = ''; try { H.issueBill({ studentId: 'S1', month: '2026-08' }); } catch (e) { msg = e.message; }
  ok_('...and the message says how long they paid for', /6 เดือน/.test(msg));
  ok_('...and where this month sits in it', /เดือนที่ 1\/6/.test(msg));
  ok_('...in the school’s own words', /ไม่ต้องออกบิลซ้ำ/.test(msg));
  eq('nothing was written', M.payments.length, 0);
  // a month OUTSIDE the cover is untouched — this is a rule about a paid-for month, not a student
  ok_('the first month after the cover bills normally', H.issueBill({ studentId: 'S1', month: '2027-02' }).Amount === 6900);
}
{
  /* AN ADMIN WRITING A BILL BY HAND STILL GETS THROUGH. The rule is "do not re-bill the tuition
   * automatically", not "never bill this child again" — a school that cannot issue a one-off charge
   * for a prepaid family has been given a rule instead of a tool. */
  const { H, M } = boot([kid('S1', 'ข้าวสวย')]);
  paidPrepay(H, M, 'S1', 6, '2026-08');
  const b = H.issueBill({ studentId: 'S1', month: '2026-08', amount: 1500, label: 'ค่าชุดนักเรียน' });
  eq('a custom amount is allowed', b.Amount, 1500);
}

console.log('\n2) the monthly run reports them — every time, by name and by position');
{
  const { H, M } = boot([kid('S1', 'ข้าวสวย'), kid('S2', 'เก้า'), kid('S3', 'คานะ')]);
  paidPrepay(H, M, 'S1', 6, '2026-08');
  paidPrepay(H, M, 'S2', 2, '2026-07');            // 2026-08 is the 2nd and last month
  const r = H.generateMonthlyBills({ month: '2026-08' });
  eq('only the child with no prepayment is billed', r.created, 1);
  eq('...and the other two are reported', r.prepaid.map(x => x.studentId).sort(), ['S1', 'S2']);
  // "นักเรียน A (1/6) นักเรียน B (1/2)" — the shape the school asked for
  eq('each with where they are in their prepayment',
    r.prepaid.sort((a, b) => a.studentId.localeCompare(b.studentId)).map(x => x.nick + ' (' + x.index + '/' + x.months + ')'),
    ['ข้าวสวย (1/6)', 'เก้า (2/2)']);
  eq('...and how many months are left after this one',
    r.prepaid.map(x => Math.max(0, x.left - 1)), [5, 0]);
  eq('...and the span it covers', r.prepaid.map(x => x.from + '→' + x.to), ['2026-08→2027-01', '2026-07→2026-08']);
  eq('the child who owes it really was billed', M.payments.map(b => b.StudentID), ['S3']);
}
{
  // the batch picker reports the same thing in the same shape, with a code a screen can group on
  const { H, M } = boot([kid('S1', 'ข้าวสวย'), kid('S2', 'เก้า', { Plan: '' })]);
  paidPrepay(H, M, 'S1', 6, '2026-08');
  const r = H.issueBillsFor({ studentIds: ['S1', 'S2'], month: '2026-08' });
  eq('neither could be billed', r.created, 0);
  eq('...for two different reasons, told apart by code',
    r.skipped.map(x => x.code).sort(), ['NO_PLAN_PRICE', 'PREPAID_MONTH']);
  const pre = r.skipped.find(x => x.code === 'PREPAID_MONTH');
  eq('...and the prepaid one carries its position', [pre.prepay.index, pre.prepay.months], [1, 6]);
}

console.log('\n3) who is prepaid THIS month — the answer the picker greys itself out with');
{
  const { H, M } = boot([kid('S1', 'ข้าวสวย'), kid('S2', 'เก้า')]);
  paidPrepay(H, M, 'S1', 6, '2026-08');
  const aug = H.prepaidStudents({ staffId: 'ADM', month: '2026-08' });
  eq('one child, this month', [aug.count, Object.keys(aug.byStudent)], [1, ['S1']]);
  eq('...with what the row has to print', [aug.byStudent.S1.index, aug.byStudent.S1.months], [1, 6]);
  /* KEYED TO THE MONTH IN THE PICKER. The same child is prepaid in September and payable in March;
   * a list that did not follow the month would be a confident lie half the time. */
  eq('September, still covered', H.prepaidStudents({ staffId: 'ADM', month: '2026-09' }).count, 1);
  eq('February, no longer', H.prepaidStudents({ staffId: 'ADM', month: '2027-02' }).count, 0);
  eq('July, before it started', H.prepaidStudents({ staffId: 'ADM', month: '2026-07' }).count, 0);
}
{
  // an UNPAID prepayment has bought nothing yet — it must not stop a bill going out
  const { H, M } = boot([kid('S1', 'ข้าวสวย')]);
  H.prepay({ studentId: 'S1', months: 6, startMonth: '2026-08' });       // quoted, not paid
  eq('a quote covers no month', H.prepaidStudents({ staffId: 'ADM', month: '2026-08' }).count, 0);
  eq('...and the bill still goes out', H.generateMonthlyBills({ month: '2026-08' }).created, 1);
}

console.log('\n4) the screens say it');
{
  ok_('the picker asks who is prepaid for the month on show', /api\('prepaidStudents',\{month\}\)/.test(app));
  ok_('...alongside the roster, in one round trip', /const \[students,pre\]=await Promise\.all\(\[/.test(app));
  ok_('...and re-asks when the month changes', /window\.A_icMonth=async\(month\)=>/.test(app) && /onchange="A_icMonth\(this\.value\)"/.test(app));
  ok_('a prepaid child cannot be ticked', /<input type="checkbox" class="icStu" value="\$\{s\.StudentID\}" style="width:auto"\$\{pi\?' disabled':''\}\/>/.test(app));
  /* "SELECT ALL" MUST NOT TICK ONE EITHER — a ticked-then-skipped row is exactly the confusion this
   * was asked to remove, and :not([disabled]) is what stops it. */
  ok_('...not even by "select all"', /document\.querySelectorAll\('\.icStu:not\(\[disabled\]\)'\)/.test(app));
  ok_('the row says how many months are left', /\$\{EN\(\)\?'left':'เหลืออีก'\} \$\{Math\.max\(0,\(pi\.left\|\|1\)-1\)\}/.test(app));
  ok_('...and where this month sits', /\(\$\{pi\.index\}\/\$\{pi\.months\}\)/.test(app));
}
{
  ok_('both ways of billing end at the same summary', /function prepaidSkipCard\(list\)\{/.test(app));
  ok_('...used by the picker', /A_skippedModal\(r\.skipped, month\)/.test(app));
  ok_('...and by the monthly run', /\$\{pre\.length\?prepaidSkipCard\(pre\):''\}/.test(app));
  ok_('the monthly run reports every reason it skipped somebody, not just one',
    /const np=r\.noPlan\|\|\[\], pre=r\.prepaid\|\|\[\], notYet=r\.notYet\|\|\[\], paused=r\.paused\|\|\[\];/.test(app));
  ok_('...and stays silent when it skipped nobody', /if\(!\(np\.length\|\|pre\.length\|\|notYet\.length\|\|paused\.length\)\) return;/.test(app));
  ok_('the card says the extras are still billed', /ค่าอาหาร\/กิจกรรม\/เรียนพิเศษ เป็นรายการแยก ยังเรียกเก็บตามปกติ/.test(app));
  /* AND NOBODY IS TOLD ABOUT A BILL THAT DOES NOT EXIST. notifyBills used to be sent the whole
   * ticked list; a child skipped for any reason has no new bill, and "คุณมีบิลใหม่" for a bill that
   * is not there is worse than silence. */
  ok_('only the children actually billed are notified', /const billed=\(r\.students\|\|\[\]\)\.map\(x=>x\.studentId\);/.test(app));
  ok_('...and nothing is sent when nothing was issued', /if\(notify && billed\.length\)\{ try\{ await api\('notifyBills',\{studentIds:billed,month\}\)/.test(app));
}
{
  ok_('the new read is admin-only on the server too', /prepaidStudents: 1/.test(code));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
