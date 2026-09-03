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

/* Lift finStudentRow out and run it for real.
 *
 * Cut to the next top-level declaration rather than counting braces: the row is built from nested
 * template literals, and a brace walker that treats ` as a plain string runs straight past the end
 * of the function the moment one of them gains another `${...}` level — which is what happened the
 * first time this row changed. The boundary is a fact about the file, not something to infer. */
function fnSrc(name, until) {
  const a = app.indexOf('function ' + name + '(');
  const b = app.indexOf(until, a);
  if (a < 0 || b < 0) throw new Error('not found: ' + name);
  return app.slice(a, b);
}
const baht = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s);
const row = new Function('EN', 'baht', 'esc', 't', 'dnick', 'dnSub', 'planLabel', 'prepaySpan', 'monthNameYear', `
  ${fnSrc('finStudentRow', '\n  SCREENS.Admin.finance')}
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

console.log('\n3b) BOOKED FOR LATER IS NOT AWAY NOW');
{
  /* โมน่า's temporary leave began on the 4th and the finance list was opened on the 2nd. The
   * dashboard card listed her under "นักเรียนลาชั่วคราว"; this row said NOTHING about her at all,
   * because studentPaused_ is a question about TODAY while Status only says whether a leave exists.
   * Two screens, two answers, and the admin had to work out which to believe (2026-09-02).
   *
   * She is not away: she was at school that morning and is billed for those two days. The row was
   * not wrong to bill her — it was wrong to say nothing. */
  const soon = html({ tuitionOpen: 6900, otherOpen: 0, otherPending: 0, tuitionPending: 0,
                      paid: false, paused: false, pauseScheduled: true, pauseFrom: '2026-09-04' });
  ok_('a booked leave is stated on the row', /จะลาชั่วคราว 2026-09-04/.test(soon));
  ok_('...saying she is still here until then', /ยังมาเรียนอยู่/.test(soon));
  ok_('...and she is still billed like anyone else', /pill bad">ค้างชำระ/.test(soon));
  const away = html({ tuitionOpen: 0, otherOpen: 0, otherPending: 0, tuitionPending: 0,
                      paid: true, paused: true, pauseFrom: '2026-08-01', pauseTo: '2026-10-31' });
  ok_('a child actually away still reads ลาชั่วคราว', /⏳ ลาชั่วคราว · 2026-08-01–2026-10-31/.test(away));
  ok_('...and the two cannot be confused', away.indexOf('จะลาชั่วคราว') < 0 && soon.indexOf('⏳ ลาชั่วคราว') < 0);
  // the server decides which it is, so every screen gets the same answer
  ok_('the server marks the difference',
    /pauseScheduled: !studentPaused_\(s\) && !!ymd\(s\.PauseFrom\|\|''\) && todayLocal\(\) < ymd\(s\.PauseFrom\)/.test(engine));
  ok_('...and says why it is not the same question as Status', /`paused` = away RIGHT NOW/.test(engine));
  /* THE DASHBOARD CARD TOLD THE ADMIN SOMETHING FALSE. Its footnote — "ระหว่างลาชั่วคราว จะไม่ออกบิล
   * ไม่นับขาด และไม่ขึ้นชื่อในชั้นเรียน" — was printed under a child who was on the class list that
   * morning and would be billed for the month. */
  ok_('the card gives them their own group',
    /const due=list\.filter\(x=>x\.due\), soon=list\.filter\(x=>!x\.due&&x\.scheduled\), away=/.test(app));
  ok_('...and says plainly that nothing applies yet', /จนถึงวันเริ่มลา ยังออกบิล ยังนับการมาเรียน/.test(app));
  ok_('...and the footnote no longer speaks for them', /— นับจากวันเริ่มลาเป็นต้นไป/.test(app));
  // the roster and the child's own record are the third and fourth screens that said it
  ok_('the roster pill distinguishes them', /pauseSoon\(s\)\?`<span class="pill info" style="font-size:11px">📅 /.test(app));
  ok_('...on the dates, not on Status', /const pauseSoon = s => isPaused\(s\) &&/.test(app));
  ok_('the leave box in the record says it has not begun', /Leave booked — still at school until then/.test(app));
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

console.log('\n6) THE THREE SWITCHES ASKED FOR ON 2026-09-02');
{
  /* (a) ONE DATE FORMAT. "หน้าหลักของ Admin ให้ใช้ Format วันเดือนปี [DD/MM/YYYY] เหมือนของคุณครู
   * ทั้งหมดทุกหัวข้อ" — changed in ddmmyyyy itself rather than on the admin screens, because both
   * roles already call that one function. A second formatter for one screen would have created the
   * very inconsistency the request is about. */
  ok_('dates are DD/MM/YYYY, in the one place that decides',
    /return p2\(d\.getDate\(\)\)\+'\/'\+p2\(d\.getMonth\(\)\+1\)\+'\/'\+d\.getFullYear\(\);/.test(app));
  ok_('...and the reason it was not done screen by screen is written down',
    /ONE DATE FORMAT, EVERYWHERE: DD\/MM\/YYYY/.test(app));

  /* (b) THE PREPAY SWITCH, shaped like the check-in one, default ON. */
  ok_('the setting exists and is seeded ON', /\['ParentPrepayEnabled',   'true'\]/.test(R('src/Config.gs')));
  ok_('...and is savable, or the toggle would do nothing',
    /ParentPrepayEnabled: 1,/.test(R('src/Staff.gs')) && /gv\.ParentPrepayEnabled=ck\('#setPrepayOn'\)/.test(app));
  ok_('the admin has a toggle for it', /id="setPrepayOn"[\s\S]{0,80}cfgOn\('ParentPrepayEnabled',true\)/.test(app));
  ok_('the parent card disappears when it is off', /const preHtml=\(!preOn && !preShow\.length\) \? '' :/.test(app));
  /* ...but only the OFFER. A family who paid six months ahead must still be able to see what they
   * bought; hiding it would look like the money had gone. */
  ok_('...while advance payments already made stay visible', /Rows ALREADY[\s\S]{0,40}paid stay visible/.test(app));
  /* A hidden button is a suggestion, not a rule: the payable this creates commits the school to a
   * discount for up to a year, so the server refuses it too. */
  ok_('the server refuses a new one, not just the screen',
    /fail\('PREPAY_OFF','ขณะนี้โรงเรียนปิดการชำระล่วงหน้าไว้/.test(engine));
  ok_('...in the built engine as well', /fail\('PREPAY_OFF'/.test(R('src/Engine.gs')));

  /* (c) SOCIAL SECURITY OFF BY DEFAULT. */
  ok_('unset means not deducted, on the live route', /: \(pcSS != null \? pcSS : false\);/.test(R('src/Payroll.gs')));
  ok_('...and in the engine', /pc\.SocialSecurityDeduct\)===true;/.test(engine));
  ok_('...and the tick box agrees with both', /\$\('#pSS'\)\.checked=pc\.SocialSecurityDeduct===true;/.test(app));
  ok_('...with the reason it is the safer default written down',
    /a payslip that is too HIGH and is told about it/.test(R('src/Payroll.gs')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
