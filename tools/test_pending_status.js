/**
 * tools/test_pending_status.js — "a slip is waiting" is a state of its own.
 *   node tools/test_pending_status.js
 *
 * Reported 2026-09-02, two halves of one fault. A family had transferred and attached a slip:
 *
 *   ยูฟ่า, an OT charge of ฿100   → the row read  ✅ ชำระแล้ว   (…and, underneath, "แนบสลิปแล้ว รอตรวจสอบ")
 *   เฉลอา, tuition of ฿6,900      → the row read  ⛔ ค้างชำระ
 *
 * Both slips were sitting in the SAME approval queue, two rows apart on the admin's own screen. The
 * server had always returned tuitionPending beside otherPending; the row read only the second one,
 * so the identical act got opposite answers depending on what the money was for.
 *
 * Neither answer was right. Waiting is not paid — the money has not been checked and could be the
 * wrong amount, or a slip already used. And it is not owing — nobody should be telephoned about it.
 * It is the one state of the three the ADMIN can act on from this screen, which is why it takes the
 * pill and anything genuinely still owed is stated underneath instead of merged into it.
 */
const path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js');

// ---- lift finStudentRow out and run it for real ----
function fnSrc(name) {
  const start = app.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0, inStr = '', esc0 = false;
  for (let j = app.indexOf('{', start); j < app.length; j++) {
    const c = app[j];
    if (esc0) { esc0 = false; continue; }
    if (c === '\\') { esc0 = true; continue; }
    if (inStr) { if (c === inStr) inStr = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return app.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const baht = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s);
const row = new Function('EN', 'baht', 'esc', 't', 'dnick', 'dnSub', 'planLabel', 'prepaySpan', 'monthNameYear', `
  ${fnSrc('finStudentRow')}
  return finStudentRow;`)(
  () => false, baht, esc,
  k => ({ 's.paid': 'ชำระแล้ว', 's.unpaid': 'ค้างชำระ', 'fin.noBill': 'ยังไม่ออกบิล' }[k] || k),
  s => s.nick, () => '', () => 'รายเดือน', () => '', m => m
);

const base = { studentId: 'STD-1', nick: 'x', plan: 'p', status: 'UNPAID' };
const html = o => row(Object.assign({}, base, o));

console.log('\n1) THE TWO ROWS THAT DISAGREED');
{
  // ยูฟ่า: OT ฿100 open, and the whole of it is a slip in the queue. Tuition settled.
  const ot = html({ tuitionOpen: 0, otherOpen: 100, otherPending: 100, tuitionPending: 0, paid: true });
  ok_('an OT slip in the queue no longer reads ชำระแล้ว', ot.indexOf('ชำระแล้ว') < 0);
  ok_('...it reads รอตรวจสอบ, with the amount', /🕐 รอตรวจสอบ 100\.00/.test(ot));

  // เฉลอา: tuition ฿6,900 open, all of it a slip in the queue.
  const tui = html({ tuitionOpen: 6900, otherOpen: 0, otherPending: 0, tuitionPending: 6900, paid: false });
  ok_('a tuition slip in the queue no longer reads ค้างชำระ', tui.indexOf('ค้างชำระ') < 0);
  ok_('...it reads the same as the OT one', /🕐 รอตรวจสอบ 6,900\.00/.test(tui));
  ok_('...and says what the slip is for', /แนบสลิปแล้ว · ค่าเทอม 6,900\.00/.test(tui));
}

console.log('\n2) WAITING IS NOT PAID, AND NOT OWING');
{
  /* The three states must stay distinguishable, or the new one has just replaced one wrong answer
   * with another. */
  const paid = html({ tuitionOpen: 0, otherOpen: 0, otherPending: 0, tuitionPending: 0, paid: true });
  ok_('a family who owes nothing and has nothing waiting still reads ชำระแล้ว',
    /pill ok">ชำระแล้ว/.test(paid) && paid.indexOf('รอตรวจสอบ') < 0);
  const owed = html({ tuitionOpen: 6900, otherOpen: 0, otherPending: 0, tuitionPending: 0, paid: false });
  ok_('a family who genuinely has not paid still reads ค้างชำระ',
    /pill bad">ค้างชำระ/.test(owed) && owed.indexOf('รอตรวจสอบ') < 0);
  /* HALF AND HALF. A slip covering part of what is owed must not hide the rest — the pill says what
   * the admin can do here, and the line underneath says what is still a phone call. */
  const half = html({ tuitionOpen: 6900, otherOpen: 0, otherPending: 0, tuitionPending: 2000, paid: false });
  ok_('a part-payment slip shows the waiting amount', /🕐 รอตรวจสอบ 2,000\.00/.test(half));
  ok_('...and does not hide the ฿4,900 still owed', /ยังค้างชำระ 4,900\.00/.test(half));
  // and OT + tuition waiting at once are one figure with both named
  const both = html({ tuitionOpen: 6900, otherOpen: 100, otherPending: 100, tuitionPending: 6900, paid: false });
  ok_('two slips waiting add up in the pill', /🕐 รอตรวจสอบ 7,000\.00/.test(both));
  ok_('...and each is named underneath', /ค่าเทอม 6,900\.00 · อื่นๆ 100\.00/.test(both));
}

console.log('\n3) WHAT MUST NOT HAVE CHANGED');
{
  /* These were fixed on 2026-08-24 (a row printing ฿100, a green ชำระแล้ว and an orange
   * "ค้างชำระอื่นๆ 100" at once) and must survive this. */
  const otherDue = html({ tuitionOpen: 0, otherOpen: 100, otherPending: 0, tuitionPending: 0, paid: true });
  ok_('tuition paid but an OT genuinely unpaid is still not a green tick',
    otherDue.indexOf('pill ok">ชำระแล้ว') < 0 && /ค่าเทอมครบ · ยังค้างอื่นๆ/.test(otherDue));
  ok_('...and the amount is stated', /ค้างชำระอื่นๆ \(ไม่ใช่ค่าเทอม\) 100\.00/.test(otherDue));
  const pre = html({ tuitionOpen: 0, otherOpen: 0, otherPending: 0, tuitionPending: 0, prepaid: true, paid: true, prepay: {} });
  ok_('a prepaid family still reads ชำระล่วงหน้าแล้ว', /ชำระล่วงหน้าแล้ว/.test(pre));
}

console.log('\n4) THE SERVER ALREADY KNEW');
{
  /* tuitionPending has been returned beside otherPending since the pending-slip work; only the row
   * ignored it. Worth pinning: the fix is a screen reading a field, not a new calculation. */
  ok_('the server returns both figures', /tuitionPending,otherPending,pendingVerify:tuitionPending\+otherPending,/.test(engine));
  ok_('...computed the same way for each', /const tuitionPending = Math\.min\(tuitionOpen, billPending\);/.test(engine) &&
    /const otherPending = Math\.min\(otherOpen, otPending \+ chPending\);/.test(engine));
  ok_('the row now reads the tuition one too', /const tuiPend=Number\(s\.tuitionPending\|\|0\), tuiReal=Math\.max\(0,tuiOpen-tuiPend\);/.test(app));
  ok_('...and the reason is recorded', /this row read only the second one/.test(app));
}

console.log('\n5) THE SAME THREE STATES INSIDE THE STUDENT’S OWN SCREEN');
{
  /* The row is opened by tapping it, and the detail behind it had the same disagreement: the bill
   * pill said ค้างชำระ, the OT row printed its raw status code, and the extra charges printed theirs.
   * One helper now answers for all three. */
  ok_('there is one helper, not three spellings', /const statePill = \(sl, status\) => \{ const p=pendAmt\(sl\);/.test(app));
  ok_('the bill pill uses it', /const _p=pendAmt\(slipsOf\('bill',bill\.BillingID\)\);/.test(app));
  ok_('the extra charges use it', /\$\{statePill\(slipsOf\('charge',c\.ChargeID\), c\.Status\|\|'UNPAID'\)\}/.test(app));
  ok_('the OT rows use it', /\$\{statePill\(sl, o\.Status\)\}/.test(app));
  /* ...and while it was there: those rows printed the RAW status ("PENDING_VERIFY") at a school
   * where the whole screen is otherwise Thai. */
  ok_('a status now prints as words rather than a code', /esc\(tStat\(status\)\|\|status\|\|''\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
