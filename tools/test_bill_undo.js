/**
 * tools/test_bill_undo.js — previewing a bill run, and taking it back.
 *   node tools/test_bill_undo.js
 *
 * Asked 2026-09-30, after the ผอ. re-ran September to see what the screen looked like and had no way
 * to find out what that had done: "เมื่อกดเลือกให้แสดงข้อความทักท้วงก่อนที่จะคอนเฟิร์ม ... หากดำเนินการ
 * ผิดพลาดจะต้องเรียกการออกบิลทั้งหมดย้อนกลับได้".
 *
 * AN UNDO THAT DELETES BILLS IS THE MOST DANGEROUS BUTTON IN THIS APP. Every assertion here is about
 * one of the four ways it could destroy something:
 *
 *   1. deleting a bill a family has ALREADY PAID → the record of money is gone (§3, the control)
 *   2. reaching past its own run into last month's bills (§2)
 *   3. reaching a bill somebody issued BY HAND (§2 — those carry no run id, ever)
 *   4. running without being looked at first (§4)
 *
 * §1 covers the other half: the preview must be the run itself, or the warning screen and the run
 * can disagree — and on this screen that means a family billed contrary to what the admin was shown.
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const got = (e && e.code) || ''; const ok = !code || got === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + got); ok ? pass++ : fail++; }
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'),
      brGs = R('src/BillRun.gs'), codeGs = R('src/Code.gs'), cfgGs = R('src/Config.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const brCode = brGs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MONTH = '2026-09';
function school() {
  const M = {
    students: [
      { StudentID: 'S1', NameTH: 'ด.ช. เอ', Nickname: 'เอ', Class: 'N1', Status: 'ACTIVE', Plan: 'full', StartDate: '2024-01-01' },
      { StudentID: 'S2', NameTH: 'ด.ญ. บี', Nickname: 'บี', Class: 'N1', Status: 'ACTIVE', Plan: 'full', StartDate: '2024-01-01' },
      { StudentID: 'S3', NameTH: 'ด.ช. ซี', Nickname: 'ซี', Class: 'N2', Status: 'ACTIVE', Plan: 'full', StartDate: '2024-01-01' },
      // finishing this month — billed, and the whole point of the warning screen
      { StudentID: 'S4', NameTH: 'ด.ญ. ดี', Nickname: 'ดี', Class: 'N2', Status: 'ACTIVE', Plan: 'full', StartDate: '2024-01-01', EndDate: '2026-09-30', EndReason: 'graduated' },
      // no package — not billed
      { StudentID: 'S5', NameTH: 'ด.ช. อี', Nickname: 'อี', Class: 'N2', Status: 'ACTIVE', StartDate: '2024-01-01' },
      // away all month — not billed
      { StudentID: 'S6', NameTH: 'ด.ญ. เอฟ', Nickname: 'เอฟ', Class: 'N1', Status: 'PAUSED', Plan: 'full', StartDate: '2024-01-01', PauseFrom: '2026-09-01', PauseTo: '2026-09-30' }
    ],
    payments: [], studentCharges: [], prepayments: [], paymentSlips: [], otDaily: [],
    parents: [], staff: [], activityLog: [], userLinks: [],
    config: { Plans: [{ id: 'full', labelTH: 'เต็มเดือน', price: 6000, start: '07:00', end: '17:00' }] }
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================================
console.log('1) the preview IS the run — it just writes nothing');
// ============================================================================================
{
  const { M, H } = school();
  const pv = H.generateMonthlyBills({ month: MONTH, preview: true });

  eq('the preview says who would be billed', pv.created, 4);
  eq('🔴 ...and writes NOTHING', M.payments.length, 0);
  eq('...and says so in the reply', pv.preview, true);
  eq('a preview gets no run id — there is nothing to undo', pv.runId, '');
  eq('nobody is charged twice over by looking', H.generateMonthlyBills({ month: MONTH, preview: true }).created, 4);
  eq('looking is not written to the activity log', (M.activityLog || []).length, 0);

  // the four warnings the school asked for, all from this one reply
  eq('🎓 …and names the children who are finishing', pv.ending.map(x => x.studentId), ['S4']);
  eq('...saying it is their last month', pv.ending[0].lastMonth, true);
  eq('⚠️ …and who has no package', pv.noPlan.map(x => x.studentId), ['S5']);
  eq('⏳ …and who is away all month', pv.paused.map(x => x.studentId), ['S6']);
  eq('…and the amount the run would come to', pv.willBill.reduce((a, x) => a + x.amount, 0), 24000);

  /* THE CONTROL FOR THIS SECTION. "Writes nothing" would also be true of a preview that decided
   * nothing — so the real run must agree with it, figure for figure. */
  const real = H.generateMonthlyBills({ month: MONTH });
  eq('🔴 CONTROL — the real run bills exactly who the preview said', real.created, pv.created);
  eq('...the same children', real.willBill.map(x => x.studentId), pv.willBill.map(x => x.studentId));
  eq('...the same skips', [real.noPlan.length, real.paused.length, real.notYet.length],
    [pv.noPlan.length, pv.paused.length, pv.notYet.length]);
  eq('...and NOW rows exist', M.payments.length, 4);
  eq('...and it IS logged', (M.activityLog || []).filter(a => /generateMonthlyBills/.test(JSON.stringify(a))).length, 1);
}

// ============================================================================================
console.log('2) the undo reaches its own run and nothing else');
// ============================================================================================
{
  const { M, H } = school();
  // an OLDER run, for a different month, that must never be touched
  const aug = H.generateMonthlyBills({ month: '2026-08' });
  // ...and a bill somebody issued BY HAND, which carries no run id at all
  H.issueBill({ studentId: 'S1', month: '2026-07', amount: 1234, label: 'ค่าเทอม (ทำมือ)' });
  const before = M.payments.length;
  const sep = H.generateMonthlyBills({ month: MONTH });

  const last = H.billRunLast({});
  eq('the latest run is the one just made', last.runId, sep.runId);
  eq('...not the August one', last.runId === aug.runId, false);
  eq('it offers every bill of that run', last.removable.length, sep.created);
  eq('...and nothing is being kept back yet', last.keep.length, 0);

  const r = H.undoBillRun({ runId: last.runId, confirm: true });
  eq('it removes them', r.removed, sep.created);
  eq('🔴 CONTROL — August and the hand-made bill are untouched', M.payments.length, before);
  eq('...and August is still whole', M.payments.filter(b => String(b.Month) === '2026-08').length, aug.created);
  eq('🔴 CONTROL — the hand-issued bill survives, because it carries no run id',
    M.payments.filter(b => String(b.Month) === '2026-07').length, 1);
  eq('...and a hand-issued bill can never be reached by an undo',
    M.payments.filter(b => String(b.Month) === '2026-07')[0].BillRun, undefined);
  eq('the undo is on the record', (M.activityLog || []).filter(a => /undoBillRun/.test(JSON.stringify(a))).length, 1);
}

// ============================================================================================
console.log('3) 🔴 a bill somebody has PAID is never deleted');
// ============================================================================================
{
  /* The school's decision, 2026-09-30: "ข้ามใบนั้นไป ลบที่เหลือ แล้วรายงานว่าข้ามใคร". A paid bill is
   * not a row the school created — it is a record of money changing hands, and no undo button gets
   * to delete that. Four different ways a bill counts as touched, because the payment path writes
   * different fields depending on how the family paid. */
  const cases = [
    ['a confirmed payment', b => { b.Status = 'PAID'; b.PaidDate = '2026-09-20'; }],
    ['a slip awaiting verification', b => { b.Status = 'PENDING_VERIFY'; b.SlipAmount = 6000; }],
    ['a verified flag on its own', b => { b.VerifiedStatus = 'CONFIRMED'; }],
    ['a part payment', b => { b.SlipAmount = 2000; }]
  ];
  cases.forEach(([label, touch]) => {
    const { M, H } = school();
    const run = H.generateMonthlyBills({ month: MONTH });
    touch(M.payments.find(b => b.StudentID === 'S1'));
    const last = H.billRunLast({});
    eq('🔴 ' + label + ' — kept back', last.keep.map(x => x.studentId), ['S1']);
    const r = H.undoBillRun({ runId: run.runId, confirm: true });
    eq('   ...the others go', r.removed, run.created - 1);
    eq('   ...and it is still there', M.payments.filter(b => b.StudentID === 'S1' && String(b.Month) === MONTH).length, 1);
    eq('   ...and named in the reply, not just counted', r.skipped.map(x => x.nick), ['เอ']);
  });

  // ...and a slip row is enough on its own, even when the bill's own fields look untouched
  {
    const { M, H } = school();
    const run = H.generateMonthlyBills({ month: MONTH });
    const b = M.payments.find(x => x.StudentID === 'S2');
    M.paymentSlips.push({ SlipID: 'SL-1', RefKind: 'bill', RefID: b.BillingID, StudentID: 'S2', Amount: 6000, Status: 'PENDING' });
    eq('🔴 a slip sitting unconfirmed still protects the bill', H.billRunLast({}).keep.map(x => x.studentId), ['S2']);
    H.undoBillRun({ runId: run.runId, confirm: true });
    eq('   ...and it survives', M.payments.filter(x => x.StudentID === 'S2' && String(x.Month) === MONTH).length, 1);
  }

  // every bill paid → nothing to remove, and that is not an error
  {
    const { M, H } = school();
    const run = H.generateMonthlyBills({ month: MONTH });
    M.payments.forEach(b => { b.Status = 'PAID'; });
    const last = H.billRunLast({});
    eq('a fully paid run offers nothing', last.removable.length, 0);
    eq('...and keeps all of it', last.keep.length, run.created);
    eq('...and undoing it removes nothing rather than failing',
      H.undoBillRun({ runId: run.runId, confirm: true }).removed, 0);
  }
}

// ============================================================================================
console.log('4) it cannot be fired by accident');
// ============================================================================================
{
  const { H } = school();
  const run = H.generateMonthlyBills({ month: MONTH });
  throws_('🔴 without confirm it refuses', () => H.undoBillRun({ runId: run.runId }), 'NEED_CONFIRM');
  throws_('...and confirm must be the boolean, not a truthy string',
    () => H.undoBillRun({ runId: run.runId, confirm: 'yes' }), 'NEED_CONFIRM');
  throws_('without a run id it refuses', () => H.undoBillRun({ confirm: true }), 'BAD_INPUT');
  /* THE RACE. The admin may have had the undo screen open while another run happened — "undo the
   * latest" must never quietly mean a run they have not looked at. */
  const stale = run.runId;
  H.generateMonthlyBills({ month: '2026-10' });
  throws_('🔴 a run id that is no longer the latest is refused, not silently redirected',
    () => H.undoBillRun({ runId: stale, confirm: true }), 'RUN_CHANGED');
}

// ============================================================================================
console.log('5) the live path, and the guard that makes it necessary');
// ============================================================================================
{
  /* 🔴 THE REASON src/BillRun.gs EXISTS. BILLING is in NO_SHRINK_SHEETS, so a full-collection
   * rewrite that makes the sheet shorter is aborted by WRITE_GUARD. The engine's undoBillRun removes
   * rows from M.payments — on GAS that write would be refused and the button would never work. */
  ok_('BILLING is still shrink-protected', /NO_SHRINK_SHEETS = \{[^}]*BILLING: 1/.test(R('src/GasEngine.gs')));
  ok_('...so the undo deletes rows in place instead', /sh\.deleteRow\(r\)/.test(brCode));
  /* deleteRow shifts every row below it, so ascending order deletes the wrong rows from the second
   * one onward — the same trap the payslip de-duplicator had to be written around. */
  ok_('🔴 ...bottom-up, or it deletes the wrong rows', /\.sort\(function \(a, b\) \{ return b - a; \}\)/.test(brCode));
  ok_('both routes are wired up', /billRunLast:\s*function/.test(codeGs) && /undoBillRun:\s*function/.test(codeGs));
  ok_('the column the run id lives in is declared', /BILLING:[^\n]*'BillRun'/.test(cfgGs));
  ok_('...and topped up on read, for a sheet that predates it', /ensureColumns_\(sh, \['BillRun'\]\)/.test(brCode));
  ok_('the route refuses without confirm, exactly as the engine does', /p\.confirm !== true/.test(brCode));
  ok_('...and checks the run is still the latest', /info\.runId !== runId/.test(brCode));
  ok_('...and skips a touched bill rather than deleting it', /function billTouched_/.test(brCode));
  ok_('a slip protects the bill on the live path too', /RefKind \|\| ''\) === 'bill'/.test(brCode));
  ok_('the deletion is audited', /logAudit\([^)]*'BILL_UNDO', 'BILLING'/.test(brCode));

  /* PERMISSION. Issuing a bill is the school asking a family for money. issueBillsFor was already
   * admin-only and these were not — an omission found while adding the undo. */
  ok_('🔴 generating the month’s bills is admin-only', /ADMIN_ONLY = \{[^}]*generateMonthlyBills: 1/.test(codeGs));
  ok_('🔴 ...so is issuing one', /ADMIN_ONLY = \{[^}]*issueBill: 1/.test(codeGs));
  ok_('...and so is the undo', /ADMIN_ONLY = \{[^}]*undoBillRun: 1/.test(codeGs));
}

// ============================================================================================
console.log('6) the screens: look first, and a way out that is easy to reach');
// ============================================================================================
{
  ok_('the button now opens a CHECK, not the run', /onclick="A_genBillsCheck\(this\)"/.test(appCode));
  ok_('...which asks for a preview', /api\('generateMonthlyBills',\{month,preview:true\}\)/.test(appCode));
  ok_('🎓 the finishing children are the first warning on it',
    /ending\.length\?[\s\S]{0,400}นักเรียนที่กำลังจะสิ้นสุดการเรียน/.test(app));
  ok_('...and it says they ARE still billed, so nobody "fixes" it by cancelling them',
    /ระบบ<u>ยังออกบิลให้<\/u>/.test(app));
  ok_('the other three warnings are there too',
    /ยังไม่ได้เลือกแพ็กเกจ — จะไม่ได้รับบิล/.test(app) && /ลาชั่วคราวตลอดเดือน — จะไม่ได้รับบิล/.test(app)
    && /prepaidSkipCard\(pre\)/.test(app));
  /* ย้อนกลับ on the LEFT and drawn as the quieter button — the way out should never be the harder
   * one to reach on a screen whose other button asks thirty families for money. */
  ok_('🔴 the way back sits before the confirm', /ย้อนกลับ[\s\S]{0,260}ยืนยันออกบิล/.test(app));
  ok_('a run that would create nothing says so instead of pretending to work', /ไม่มีบิลที่ต้องออก/.test(app));
  ok_('the undo screen names what it will remove', /A_billUndo=async/.test(appCode) && /จะถูกลบ/.test(app));
  ok_('...and names what it is keeping, rather than counting it', /เก็บไว้ — ชำระหรือแนบสลิปแล้ว/.test(app));
  ok_('...and asks once more before deleting', /A_billUndoDo=async[\s\S]{0,200}confirm\(/.test(appCode));
  ok_('the undo is reachable straight after a run, not only from a menu', /const undoCard=r\.created\?/.test(appCode));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
