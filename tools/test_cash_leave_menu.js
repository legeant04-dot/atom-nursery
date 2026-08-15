/**
 * tools/test_cash_leave_menu.js — three things the school asked for on 2026-08-15.
 *   node tools/test_cash_leave_menu.js
 *
 *   1. A parent can say "I paid cash at the school" — with the amount and THE DAY they handed it
 *      over. It waits for the school to confirm; it is never marked paid on the parent's word.
 *   2. A parent with two children: the one who is away has drop-off / pick-up CLOSED, and the
 *      sibling who did go to school keeps theirs, on the same screen.
 *   3. The printed monthly menu includes DINNER — the kitchen was planning a meal the sheet did
 *      not show — labelled with who actually eats it.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), card = R('webapp/report_card.js'),
      ps = R('src/PaySlips.gs'), code = R('src/Code.gs');

const TODAY = (() => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    students: [
      { StudentID: 'STD-1', NameTH: 'ไบร์ท', Nickname: 'ไบร์ท', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2024-09-01', ParentID: 'PAR-1' },
      { StudentID: 'STD-2', NameTH: 'เบรฟ', Nickname: 'เบรฟ', Class: 'Nursery Baby', Status: 'ACTIVE', DOB: '2026-01-01', ParentID: 'PAR-1' }
    ],
    parents: [{ ParentID: 'PAR-1', Name: 'คุณแม่', StudentID: 'STD-1', LineUID: 'U1' }],
    userLinks: [{ ParentID: 'PAR-1', StudentID: 'STD-1' }, { ParentID: 'PAR-1', StudentID: 'STD-2' }],
    payments: [{ BillingID: 'B-1', StudentID: 'STD-1', Month: TODAY.slice(0, 7), Amount: 6900, Items: [], Status: 'UNPAID' }],
    otDaily: [{ OTID: 'OT-1', StudentID: 'STD-1', Date: TODAY, Amount: 100, Status: 'UNPAID' }],
    paymentSlips: [], leaves: [], studentCharges: [], prepayments: [], checkinStudent: [], journals: [],
    comments: [], holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [],
    staffAttendanceHistory: [], payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], injuryReports: [], insurance: [],
    bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    classes: [{ ClassName: 'Nursery 2' }, { ClassName: 'Nursery Baby' }],
    studentAttendanceToday: [], studentCheckins: [], staff: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  if (typeof H.payCombinedCash !== 'function') H.payCombinedCash = function () { return { missing: true }; };
  return { H, M };
}
const SCOPE = { parentId: 'PAR-1', uid: 'U1', role: 'Parent' };
function grab(fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }

console.log('\n=== 1. cash, with an amount and the day it was handed over ===');
{
  const { H, M } = boot();
  const items = [{ kind: 'bill', id: 'B-1' }, { kind: 'ot', id: 'OT-1' }];
  const wrong = grab(() => H.payCombinedCash(Object.assign({ items, amount: 5000, paidDate: TODAY }, SCOPE)));
  ok_('a short amount is refused, exactly as a transfer is', /AMOUNT_MISMATCH|ไม่ตรงกับยอดรวม/.test(wrong || ''));
  const future = grab(() => H.payCombinedCash(Object.assign({ items, amount: 7000, paidDate: '2099-01-01' }, SCOPE)));
  ok_('a payment dated in the future is refused', /ไม่เป็นวันในอนาคต|BAD_INPUT/.test(future || ''));
  const r = H.payCombinedCash(Object.assign({ items, amount: 7000, paidDate: '2026-08-11' }, SCOPE));
  eq('the whole selection is covered', r.count, 2);
  eq('…for the right total', r.total, 7000);
  eq('…recorded as cash', r.method, 'cash');
  eq('…on the day the money changed hands, not today', r.paidDate, '2026-08-11');
  const slips = M.paymentSlips;
  eq('one row per item, like a slip', slips.length, 2);
  ok_('every row says cash', slips.every(s => s.Method === 'cash'));
  ok_('…and carries the payment date', slips.every(s => s.TransDate === '2026-08-11'));
  ok_('no slip image is invented', slips.every(s => !s.Url));
  eq('the bill is NOT marked paid on the parent’s word', M.payments[0].Status, 'PENDING_VERIFY');
  eq('…it is waiting for the school, as cash', M.payments[0].PaymentMethod, 'cash');
  eq('the OT is waiting too', M.otDaily[0].Status, 'PENDING_VERIFY');
  const log = H.paymentLog(SCOPE);
  eq('it is in the payment history the family can read', (log.entries || []).filter(x => x.via === 'cash').length, 2);
  eq('…as still waiting, not as money in', log.totalConfirmed, 0);
  eq('…and counted as pending', log.totalPending, 7000);
}
{
  const { H } = boot();
  ok_('another family’s bill cannot be settled', /NO_PERMISSION|ไม่ใช่ของบุตรหลาน/.test(
    grab(() => H.payCombinedCash({ items: [{ kind: 'bill', id: 'B-1' }], amount: 6900, paidDate: TODAY, parentId: 'PAR-9', uid: 'U9', role: 'Parent' })) || ''));
  ok_('an empty selection is refused', /BAD_INPUT|ยังไม่ได้เลือก/.test(
    grab(() => H.payCombinedCash(Object.assign({ items: [], amount: 0 }, SCOPE))) || ''));
}
console.log('  — the client offers it —');
ok_('the parent sees a cash button beside the QR', /P_combinedCash\(\)/.test(app) && /ชำระเงินสดที่โรงเรียน/.test(app));
ok_('the amount is filled in for them', /id="cashAmt" type="number" inputmode="decimal" value="\$\{_COMB\.due\}"/.test(app));
ok_('…and must still match', /Math\.round\(amt\)!==Math\.round\(_COMB\.due\)/.test(app));
ok_('the date is theirs to set, and cannot be in the future', /id="cashDate"[^>]*max="\$\{todayStr\(\)\}"/.test(app));
ok_('it is a real route on GAS, not a fall-through', /payCombinedCash: function \(p\)/.test(code) && /function handlePayCombinedCash/.test(ps));
ok_('…which tells the admin, because cash leaves no bank trail', /แจ้งชำระเงินสด/.test(ps));
ok_('…and does not mark it paid either', ps.indexOf("PaymentMethod: 'cash', TransactionDate: paidOn") > 0 && /Status: 'SUBMITTED', SlipGroup: groupId/.test(ps));

console.log('\n=== 2. two children, one away ===');
{
  const { H, M } = boot();
  M.studentLeaves.push({ LeaveID: 'LVS-1', StudentID: 'STD-1', Date: TODAY, Type: 'ลาป่วย', Reason: 'เป็นไข้', Status: 'Notified' });
  const kids = H.parentChildren(SCOPE);
  const away = kids.find(k => k.StudentID === 'STD-1'), here = kids.find(k => k.StudentID === 'STD-2');
  eq('the child who is away is flagged', away.onLeave, true);
  eq('…with the type', away.leaveType, 'ลาป่วย');
  eq('…and the reason', away.leaveReason, 'เป็นไข้');
  eq('the sibling who went to school is NOT flagged', here.onLeave, false);
  ok_('the server refuses a check-in for the one on leave',
    /ON_LEAVE|แจ้งลาวันนี้แล้ว/.test(grab(() => H.parentCheckin({ studentId: 'STD-1', type: 'IN', lat: 0, lng: 0, parentId: 'PAR-1' })) || ''));
  ok_('…and still allows the sibling',
    !/ON_LEAVE/.test(grab(() => H.parentCheckin({ studentId: 'STD-2', type: 'IN', lat: 0, lng: 0, parentId: 'PAR-1' })) || ''));
  ok_('a leave on ANOTHER day does not close today',
    (() => { const b = boot(); b.M.studentLeaves.push({ LeaveID: 'L2', StudentID: 'STD-1', Date: '2020-01-01', Type: 'ลากิจ' });
      return b.H.parentChildren(SCOPE).find(k => k.StudentID === 'STD-1').onLeave === false; })());
}
ok_('one answer to "is this child away", shared by every screen', /function studentLeaveToday_\(sid, onDate\)/.test(eng));
ok_('…used by the class list', /const lv=studentLeaveToday_\(sid\);/.test(eng));
ok_('…and by the parent’s children', /studentLeaveToday_\(s\.StudentID\), s\)/.test(eng));
ok_('the parent’s card shows the leave instead of the buttons', /: k\.onLeave/.test(app) && /ลาวันนี้/.test(app));
ok_('…saying what to do if the child does turn up', app.indexOf('หากมาจริงกรุณายกเลิกใบลาก่อน') > 0);

console.log('\n=== 3. the printed menu has dinner ===');
ok_('dinner is a column', /\['dinner', 'เย็น', '\(เฉพาะ Nursery 1\)'\]/.test(card));
ok_('…labelled with who eats it, under its own column', /if \(mm\[2\]\) text\(ctx, mm\[2\]/.test(card));
ok_('five meals now, not four', (card.match(/var MEALS = \[[\s\S]*?\];/) || [''])[0].split("['").length - 1 === 5);
ok_('the columns were re-measured to fit six', /colW = \[84, 205, 175, 235, 175, 214\]/.test(card));
ok_('…and they still fit the page', (() => { const m = /colW = \[([\d, ]+)\]/.exec(card);
  return m && m[1].split(',').reduce((a, x) => a + Number(x), 0) <= 1240 - 72 * 2; })());
ok_('a month with only dinners entered is not called empty', /x\.dinner \|\| x\.note\) filled\+\+/.test(card));
ok_('the screen already collected dinner — only the print was missing', /dinner:g\('dinner'\)/.test(app));

console.log('\n=== 4. nothing else moved ===');
{
  const { H, M } = boot();
  const r = H.payCombined(Object.assign({ items: [{ kind: 'bill', id: 'B-1' }], slipAmount: 6900, slipData: 'data:image/jpeg;base64,AA' }, SCOPE));
  eq('a transfer still works', r.count, 1);
  eq('…and is still recorded as a transfer', M.paymentSlips[0].Method, 'transfer');
  ok_('…with the slip attached', !!M.paymentSlips[0].Url);
}
{
  const { H } = boot();
  eq('a child with no leave is not flagged', H.parentChildren(SCOPE).every(k => k.onLeave === false), true);
  ok_('…and can be checked in', !/ON_LEAVE/.test(grab(() => H.parentCheckin({ studentId: 'STD-1', type: 'IN', lat: 0, lng: 0, parentId: 'PAR-1' })) || ''));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
