/**
 * tools/test_finance_index.js — financeSummary got faster without changing a single number.
 *   node tools/test_finance_index.js
 *
 * financeSummary is the slowest action in the report (p50 11.1s) and the one that decides what every
 * family owes, so speed may not cost a single baht of accuracy. The change groups each collection
 * once instead of re-scanning it per child: 424,111 rows visited became 1,581 for a 31-child school
 * (tools/bench_finance.js).
 *
 * This test does NOT snapshot the new output — a snapshot only proves the code agrees with itself.
 * It recomputes every figure with an independent brute-force implementation written the old way
 * (filter the whole collection, scan the whole slip book) and demands they agree, on a dataset built
 * out of the awkward cases: duplicate bills for one month, rejected and part-paid slips, an advance
 * payment, a child on temporary leave, a child with no bill at all, and cancelled OT.
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

const MONTH = '2026-08';
function fixture() {
  return {
    students: [
      { StudentID: 'S1', NameTH: 'ก', Nickname: 'หนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', Plan: 'p_6900' },   // paid in full
      { StudentID: 'S2', NameTH: 'ข', Nickname: 'สอง', Class: 'Nursery 1', Status: 'ACTIVE', Plan: 'p_6900' },   // part paid + OT + charges
      { StudentID: 'S3', NameTH: 'ค', Nickname: 'สาม', Class: 'Nursery 2', Status: 'ACTIVE', Plan: 'p_6900' },   // DUPLICATE bills
      { StudentID: 'S4', NameTH: 'ง', Nickname: 'สี่', Class: 'Nursery 2', Status: 'ACTIVE', Plan: 'p_6900' },   // no bill at all
      { StudentID: 'S5', NameTH: 'จ', Nickname: 'ห้า', Class: 'Nursery 3', Status: 'ACTIVE', Plan: 'p_6900',
        PauseFrom: '2026-08-01', PauseTo: '2026-12-31' },                                                          // temporary leave
      { StudentID: 'S6', NameTH: 'ฉ', Nickname: 'หก', Class: 'Nursery 1', Status: 'WITHDRAWN', Plan: 'p_6900' }   // gone — must not appear
    ],
    payments: [
      { BillingID: 'B1', StudentID: 'S1', Month: MONTH, Amount: 6900, Status: 'PAID' },
      { BillingID: 'B2', StudentID: 'S2', Month: MONTH, Amount: 6900, Status: 'UNPAID' },
      { BillingID: 'B3a', StudentID: 'S3', Month: MONTH, Amount: 6900, Status: 'UNPAID' },
      { BillingID: 'B3b', StudentID: 'S3', Month: MONTH, Amount: 6900, Status: 'PAID' },        // the duplicate that must win
      { BillingID: 'B5', StudentID: 'S5', Month: MONTH, Amount: 6900, Status: 'UNPAID' },
      { BillingID: 'Bold', StudentID: 'S2', Month: '2026-07', Amount: 6900, Status: 'PAID' }    // another month — must be ignored
    ],
    otDaily: [
      { OTID: 'O1', StudentID: 'S2', Date: MONTH + '-05', Amount: 100, Status: 'UNPAID' },
      { OTID: 'O2', StudentID: 'S2', Date: MONTH + '-06', Amount: 200, Status: 'PAID' },
      { OTID: 'O3', StudentID: 'S2', Date: MONTH + '-07', Amount: 300, Status: 'CANCELLED' },
      { OTID: 'O4', StudentID: 'S1', Date: '2026-07-09', Amount: 400, Status: 'UNPAID' }        // last month — ignored
    ],
    studentCharges: [
      { ChargeID: 'C1', StudentID: 'S2', Month: MONTH, Amount: 500, Status: 'UNPAID' },
      { ChargeID: 'C2', StudentID: 'S2', Month: MONTH, Amount: 800, Status: 'PAID' },
      { ChargeID: 'C3', StudentID: 'S4', Month: '2026-07', Amount: 900, Status: 'UNPAID' }      // last month — ignored
    ],
    paymentSlips: [
      { SlipID: 'L1', RefKind: 'bill', RefID: 'B1', StudentID: 'S1', Amount: 6900, Status: 'CONFIRMED' },
      { SlipID: 'L2', RefKind: 'bill', RefID: 'B2', StudentID: 'S2', Amount: 3000, Status: 'CONFIRMED' },   // part payment
      { SlipID: 'L3', RefKind: 'bill', RefID: 'B2', StudentID: 'S2', Amount: 1000, Status: 'SUBMITTED' },   // waiting on the school
      { SlipID: 'L4', RefKind: 'bill', RefID: 'B2', StudentID: 'S2', Amount: 9999, Status: 'REJECTED' },    // must count for nothing
      { SlipID: 'L5', RefKind: 'ot', RefID: 'O1', StudentID: 'S2', Amount: 40, Status: 'CONFIRMED' },
      { SlipID: 'L6', RefKind: 'ot', RefID: 'O1', StudentID: 'S2', Amount: 25, Status: 'PENDING_VERIFY' },
      { SlipID: 'L7', RefKind: 'charge', RefID: 'C1', StudentID: 'S2', Amount: 120, Status: 'CONFIRMED' },
      { SlipID: 'L8', RefKind: 'charge', RefID: 'C2', StudentID: 'S2', Amount: 800, Status: 'CONFIRMED' },
      { SlipID: 'L9', RefKind: 'charge', RefID: 'C1', StudentID: 'S2', Amount: 60, Status: 'SUBMITTED' },
      { SlipID: 'LA', RefKind: 'bill', RefID: 'B3b', StudentID: 'S3', Amount: 6900, Status: 'CONFIRMED' }
    ],
    prepayments: [],
    staff: [{ StaffID: 'T1', NameTH: 'ครู', Role: 'Teacher' }],
    payroll: [{ StaffID: 'T1', Month: MONTH, NetPay: 15000, SlipSent: 'YES' }]
  };
}

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paySlips: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

/* the OLD way, written out plainly: scan everything, every time */
function reference(M, month) {
  const ym7 = v => String(v || '').slice(0, 7);
  const slipSum = (kind, refId, statuses) => M.paymentSlips
    .filter(s => s.RefKind === kind && s.RefID === refId && statuses.indexOf(s.Status) >= 0)
    .reduce((a, s) => a + Number(s.Amount || 0), 0);
  const out = {};
  M.students.filter(s => String(s.Status || '').toUpperCase() !== 'WITHDRAWN').forEach(s => {
    const bills = M.payments.filter(x => x.StudentID === s.StudentID && ym7(x.Month) === month);
    const b = bills.find(x => x.Status === 'PAID') || bills.find(x => x.Status === 'PARTIAL') || bills[0];
    const otRows = M.otDaily.filter(o => o.StudentID === s.StudentID && ym7(o.Date) === month);
    const open = o => { const st = String(o.Status || 'UNPAID').toUpperCase(); return st !== 'PAID' && st !== 'CANCELLED'; };
    const otOpen = otRows.filter(open).reduce((a, o) => a + Math.max(0, Number(o.Amount || 0) - slipSum('ot', o.OTID, ['CONFIRMED'])), 0);
    const otCollected = otRows.reduce((a, o) => a + (o.Status === 'PAID' ? Number(o.Amount || 0) : slipSum('ot', o.OTID, ['CONFIRMED'])), 0);
    const chs = M.studentCharges.filter(c => c.StudentID === s.StudentID && ym7(c.Month) === month);
    const chOpen = chs.reduce((a, c) => a + Math.max(0, Number(c.Amount || 0) - slipSum('charge', c.ChargeID, ['CONFIRMED'])), 0);
    const chCollected = chs.reduce((a, c) => a + slipSum('charge', c.ChargeID, ['CONFIRMED']), 0);
    const otPending = otRows.filter(open).reduce((a, o) => a + slipSum('ot', o.OTID, ['SUBMITTED', 'PENDING_VERIFY']), 0);
    const chPending = chs.reduce((a, c) => a + slipSum('charge', c.ChargeID, ['SUBMITTED', 'PENDING_VERIFY']), 0);
    const amount = b ? Number(b.Amount || 0) : 0;
    const billConfirmed = b ? slipSum('bill', b.BillingID, ['CONFIRMED']) : 0;
    const billPending = b ? slipSum('bill', b.BillingID, ['SUBMITTED', 'PENDING_VERIFY']) : 0;
    const tuitionOpen = Math.max(0, amount - billConfirmed);
    const otherOpen = otOpen + chOpen;
    out[s.StudentID] = {
      amount: amount, otOpen: otOpen, chOpen: chOpen, tuitionOpen: tuitionOpen, otherOpen: otherOpen,
      due: tuitionOpen + otherOpen,
      collected: (b ? (b.Status === 'PAID' ? amount : billConfirmed) : 0) + chCollected + otCollected,
      tuitionPending: Math.min(tuitionOpen, billPending),
      otherPending: Math.min(otherOpen, otPending + chPending),
      status: b ? b.Status : 'NO_BILL'
    };
  });
  return out;
}

console.log('\n1) every figure, for every child, matches the old scan-everything way');
{
  const f = fixture();
  const { H, M } = boot(f);
  const got = H.financeSummary({ month: MONTH });
  const want = reference(M, MONTH);
  const KEYS = ['amount', 'otOpen', 'chOpen', 'tuitionOpen', 'otherOpen', 'due', 'collected', 'tuitionPending', 'otherPending', 'status'];
  eq('the same children are listed', got.students.map(s => s.studentId).sort(), Object.keys(want).sort());
  got.students.forEach(s => {
    const w = want[s.studentId];
    KEYS.forEach(k => eq(s.studentId + '.' + k, s[k], w[k]));
  });
}

console.log('\n2) the awkward cases are right, not merely consistent');
{
  const { H } = boot(fixture());
  const r = H.financeSummary({ month: MONTH });
  const by = {}; r.students.forEach(s => { by[s.studentId] = s; });
  eq('a withdrawn child is not billed at all', !!by.S6, false);
  eq('a duplicate bill resolves to the PAID one', by.S3.status, 'PAID');
  eq('...and that child owes nothing', by.S3.tuitionOpen, 0);
  eq('a rejected slip counts for nothing (6900 - 3000 confirmed)', by.S2.tuitionOpen, 3900);
  eq('a submitted slip is "waiting", not "collected"', by.S2.tuitionPending, 1000);
  eq('OT: 100 minus 40 confirmed; the PAID and CANCELLED rows are not open', by.S2.otOpen, 60);
  // OT collected is not reported per child on its own — it is folded into `collected`:
  // 3000 confirmed on the bill + 920 confirmed charges + (200 PAID OT + 40 confirmed on the open OT)
  eq('OT money in is counted, via `collected`', by.S2.collected, 4160);
  eq('charges: 500-120 open, the PAID one is settled', by.S2.chOpen, 380);
  eq('a child with no bill shows NO_BILL and owes nothing', [by.S4.status, by.S4.due], ['NO_BILL', 0]);
  eq('a child on temporary leave is still billable', by.S5.tuitionOpen, 6900);
  eq('...and is listed LAST', r.students[r.students.length - 1].studentId, 'S5');
  eq('last month\'s bill does not leak into this month', by.S2.amount, 6900);
}

console.log('\n3) the totals add up from the rows, not from a second calculation');
{
  const { H } = boot(fixture());
  const r = H.financeSummary({ month: MONTH });
  eq('tuitionOutstanding = Σ tuitionOpen', r.tuitionOutstanding, r.students.reduce((a, s) => a + s.tuitionOpen, 0));
  eq('otherOutstanding = Σ otherOpen', r.otherOutstanding, r.students.reduce((a, s) => a + s.otherOpen, 0));
  eq('tuitionCollected = Σ collected', r.tuitionCollected, r.students.reduce((a, s) => a + s.collected, 0));
  eq('studentsTotal counts the enrolled', r.studentsTotal, 5);
  eq('salary expense still comes from payroll', r.expense, 15000);
}

console.log('\n4) an empty school does not divide by anything');
{
  const { H } = boot({});
  const r = H.financeSummary({ month: MONTH });
  eq('no students', r.students.length, 0);
  eq('no income', [r.income, r.tuitionOutstanding, r.otherOutstanding], [0, 0, 0]);
}

console.log('\n5) the work really is grouped once, not repeated per child');
{
  const eng = R('webapp/engine.js');
  const fn = eng.slice(eng.indexOf('financeSummary: p =>'), eng.indexOf('// ---------- Admin ----------'));
  ok_('collections are grouped up front', /const billsBy=groupBy\(M\.payments/.test(fn) && /const otBy=groupBy\(M\.otDaily/.test(fn) && /const chBy=groupBy\(M\.studentCharges/.test(fn));
  ok_('the slip book is summed in one pass', /paySlips_\(\)\.forEach\(s=>\{ const k=s\.RefKind\+'\|'\+s\.RefID\+'\|'\+s\.Status/.test(fn));
  ok_('no per-child rescan of payments is left', !/M\.payments\.filter\(x=>x\.StudentID===s\.StudentID/.test(fn));
  ok_('no per-child rescan of OT is left', !/M\.otDaily\.filter\(o=>o\.StudentID===s\.StudentID/.test(fn));
  ok_('no per-child rescan of charges is left', !/M\.studentCharges\.filter\(c=>c\.StudentID===s\.StudentID/.test(fn));
  ok_('and no per-item rescan of the slip book', !/sumSlips_\(/.test(fn));
  // the open-OT rows were filtered twice; once is enough and both uses must see the same rows
  ok_('the open-OT rows are worked out once', (fn.match(/otRows\.filter\(otOpenRec\)/g) || []).length === 1);
  // sumSlips_ itself is untouched — every OTHER caller must keep the exact behaviour it had
  ok_('sumSlips_ still exists for everyone else', /function sumSlips_\(kind, refId, statuses\)\{ return paySlips_\(\)\.filter/.test(eng));
  ok_('...and is still used elsewhere', (eng.match(/sumSlips_\(/g) || []).length > 5);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
