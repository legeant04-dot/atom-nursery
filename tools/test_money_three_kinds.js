/**
 * tools/test_money_three_kinds.js — three kinds of money, each counted once, each shown as itself.
 *   node tools/test_money_three_kinds.js
 *
 * REPORTED 2026-08-24: "ระบบแสดงยอดเงินไม่ถูกต้อง มีการออกบิลให้น้องแอสลี่รายเดือน 9500 และค่าธรรมเนียม
 * แรกเข้า 2000 แต่ระบบแสดงเฉพาะรายเดือนที่ค้าง ไม่แสดงค่าใช้จ่ายเพิ่มเติม"
 *
 * Three separate defects were behind it, all in the same few lines:
 *
 *  1. EXTRA CHARGES WERE INVISIBLE. financeSummary has always computed chOpen, but only ever
 *     reported it folded into `otherOutstanding` (OT + charges together), and no screen printed that.
 *     A ฿2,000 entry fee was billed, owed, and nowhere on the dashboard.
 *
 *  2. `tuitionCollected` HAS NEVER BEEN TUITION. It is Σ collected — tuition, charges and OT added
 *     together. It was printed under "ค่าเทอมรายเดือน · เก็บได้", and the month's total then added
 *     otCollected to it, counting the OT twice. So did `income`.
 *
 *  3. CASH WAS A DEBT. A bill settled in cash is stamped PAID with no slip, so
 *     `amount − prepaid − confirmedSlips` still came to the whole bill: the same money counted as
 *     collected AND as outstanding, and `paid` read false so the family appeared in neither count.
 *     A school that takes cash was looking at its own takings as an unpaid balance.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

function boot(over) {
  const M = Object.assign({
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: '' },
    students: [{ StudentID: 'S1', NameTH: 'โซมาดินา', Nickname: 'แอชลีย์', Class: 'Nursery Premium', Status: 'ACTIVE' }],
    payments: [], studentCharges: [], otDaily: [], paymentSlips: [], prepayments: [],
    staff: [], payroll: [], classes: [], parents: [], userLinks: [], leaves: [],
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [],
    comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payrollConfig: {}, absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
    vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [],
    bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], holidays: [], otRecords: [],
    holidayAttend: []
  }, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const MONTH = '2026-08';
const bill = (amt, st) => [{ BillingID: 'B1', StudentID: 'S1', Month: MONTH, Amount: amt, Status: st || 'UNPAID' }];
const charge = (amt, st) => [{ ChargeID: 'C1', StudentID: 'S1', Month: MONTH, Label: 'ค่าธรรมเนียมแรกเข้า', Amount: amt, Status: st || 'UNPAID' }];
const ot = (amt, st) => [{ OTID: 'O1', StudentID: 'S1', Date: MONTH + '-18', Amount: amt, Status: st || 'UNPAID' }];
const fin = o => boot(o).H.financeSummary({ month: MONTH });

console.log('\n1) the case as reported: tuition 9,500 + entry fee 2,000, both unpaid');
{
  const f = fin({ payments: bill(9500), studentCharges: charge(2000), otDaily: ot(100) });
  eq('tuition outstanding is tuition', f.tuitionOutstanding, 9500);
  eq('the entry fee is reported on its own', f.chargesOutstanding, 2000);
  eq('...and so is the OT', f.otOutstanding, 100);
  eq('nothing has been collected', [f.collectedTuition, f.collectedCharges, f.collectedOT, f.collectedAll], [0, 0, 0, 0]);
  eq('the family owes all three', f.students[0].due, 11600);
  eq('...and the month is billed for all three', f.tuitionOutstanding + f.chargesOutstanding + f.otOutstanding, 11600);
}

console.log('\n2) each kind of money is counted ONCE');
{
  const f = fin({ payments: bill(9500, 'PAID'), studentCharges: charge(2000),
    otDaily: ot(100, 'PAID'), paymentSlips: [{ RefKind: 'charge', RefID: 'C1', Status: 'CONFIRMED', Amount: 2000 }] });
  eq('tuition in', f.collectedTuition, 9500);
  eq('charges in', f.collectedCharges, 2000);
  eq('OT in', f.collectedOT, 100);
  eq('all of it, once', f.collectedAll, 11600);
  eq('income is the same number, not more', f.income, 11600);
  // the shape the dashboard prints
  eq('collected + outstanding = billed', f.collectedAll + f.tuitionOutstanding + f.chargesOutstanding + f.otOutstanding, 11600);
}
{
  // the old arithmetic, kept here so the regression is unmistakable
  const f = fin({ payments: bill(9500, 'PAID'), otDaily: ot(100, 'PAID') });
  eq('the legacy name still means "everything"', f.tuitionCollected, f.collectedAll);
  ok_('...so adding otCollected to it would double the OT', f.tuitionCollected + f.otCollected > f.collectedAll);
  ok_('...which is why no screen does that any more',
    !/_allIn=Number\(fin\.tuitionCollected\|\|0\)\+_otCol/.test(app) && /_allIn=Number\(fin\.collectedAll\|\|0\)/.test(app));
}

console.log('\n3) cash is not a debt');
{
  const f = fin({ payments: [{ BillingID: 'B1', StudentID: 'S1', Month: MONTH, Amount: 9500,
    Status: 'PAID', PaymentMethod: 'cash', PaidDate: MONTH + '-05' }] });
  const s = f.students[0];
  eq('a cash-paid bill owes nothing', s.tuitionOpen, 0);
  eq('...and is counted as collected, once', s.tuitionIn, 9500);
  eq('...and the family reads as paid', s.paid, true);
  eq('school-wide, the takings are not also a debt', [f.collectedTuition, f.tuitionOutstanding], [9500, 0]);
  eq('...and the paid count includes them', [f.studentsPaid, f.studentsTotal], [1, 1]);
}
{
  // ...while an unpaid bill is still unpaid, and a part-payment is still part-paid
  const f = fin({ payments: bill(9500), paymentSlips: [{ RefKind: 'bill', RefID: 'B1', Status: 'CONFIRMED', Amount: 4000 }] });
  eq('half paid by slip leaves the rest owing', [f.students[0].tuitionOpen, f.students[0].tuitionIn], [5500, 4000]);
  eq('...and is not counted as paid', f.students[0].paid, false);
}
{
  const f = fin({ payments: bill(9500) });
  eq('an untouched bill is fully outstanding', [f.tuitionOutstanding, f.collectedTuition], [9500, 0]);
}

console.log('\n4) a waived or cancelled charge is not owed');
{
  const f = fin({ studentCharges: [{ ChargeID: 'C1', StudentID: 'S1', Month: MONTH, Amount: 2000, Status: 'CANCELLED' }] });
  eq('a cancelled charge is not outstanding', f.chargesOutstanding, 0);
}

console.log('\n5) the screens show all three');
{
  const home = app.slice(app.indexOf('const payHtml='), app.indexOf('const remHtml ='));
  ok_('the total names all three kinds', /ค่าเทอม \+ ค่าใช้จ่ายเพิ่มเติม \+ OT นักเรียน/.test(home));
  ok_('extra charges get their own line', /ค่าใช้จ่ายเพิ่มเติม/.test(home));
  ok_('...which is hidden when there are none, rather than printing a zero',
    /\$\{\(_chCol\|\|_chOut\)\?`/.test(app));
  ok_('tuition collected is TUITION now', /\$\{baht\(_tuiCol\)\}/.test(app) && /const _tuiCol = Number\(fin\.collectedTuition\|\|0\)/.test(app));
  ok_('the KPI tile carries the extras beside the OT', /➕ <b style="color:var\(--warn\)">\$\{baht\(_chOut\)\}/.test(app));
  ok_('the finance screen counts each kind once', /f\.collectedAll!=null\?f\.collectedAll/.test(app));
  ok_('the reason is written down where the numbers are made', /`tuitionCollected` has never been tuition/.test(eng));
  ok_('...and the cash one too', /A school\s*\n\s*\* that takes cash saw its own takings as a debt/.test(eng));
}

console.log('\n6) one screen, one answer to "does anybody owe us money?"');
{
  /* REPORTED 2026-08-24, with a screenshot: the dashboard's headline tile read a green 0.00 while
   * the card directly beneath it read "ค้างชำระ 200". Both were drawn from the same reply. The tile
   * printed the TUITION figure and left the student OT in small grey type underneath — so the first
   * number anybody reads said "no" when the answer was 200. */
  const f = fin({ payments: bill(9500, 'PAID'), otDaily: ot(200) });
  eq('tuition is settled', f.tuitionOutstanding, 0);
  eq('...but the OT is not', f.otOutstanding, 200);
  const total = f.tuitionOutstanding + f.chargesOutstanding + f.otOutstanding;
  eq('the total the school is owed', total, 200);
  ok_('the headline tile is that total, not one third of it',
    /<b class="kn" style="color:\$\{_allOut>0\?'var\(--bad\)':'var\(--ok\)'\}">\$\{baht\(_allOut\)\}<\/b><span class="kl">\$\{EN\(\)\?'Outstanding \(all\)':'ค้างชำระทั้งหมด'\}/.test(app));
  ok_('...with the three kinds broken out beneath it, so it is still answerable',
    /🏫 <b style="color:\$\{tuiOut>0/.test(app) && /⏰ <b style="color:\$\{_otOut>0/.test(app));
  ok_('...and it is the same figure the card below prints', /_allOut=tuiOut\+_chOut\+_otOut/.test(app));
}
{
  // ...and the same contradiction one row at a time: ฿100 owed, and a green "ชำระแล้ว" beside it
  // tuiOpen became tuiReal on 2026-09-02, when a tuition slip already in the queue stopped counting
  // as owed — the same allowance othReal has always had. Same rule: only what is genuinely still due.
  ok_('"paid" is held back until NOTHING is outstanding', /const stillOwed = tuiReal \+ othReal;/.test(app));
  ok_('...a family whose tuition is clear but who owe an OT are named as such',
    /ค่าเทอมครบ · ยังค้างอื่นๆ/.test(app));
  ok_('...and a slip already sent does not hold the tick back', /othReal=Math\.max\(0,othOpen-othPend\)/.test(app));
  ok_('...the amount and the pill can no longer disagree',
    app.indexOf('const stillOwed = tuiReal + othReal;') < app.indexOf('const pill = pending>0'));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
