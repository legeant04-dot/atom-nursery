/**
 * tools/test_pay_pick.js — the parent picks what to pay, and the QR follows the selection.
 *   node tools/test_pay_pick.js
 *
 * The rule that matters most here is WHICH ACCOUNT the money lands in. Getting it wrong does not
 * throw an error — the parent transfers successfully into the wrong bank account and nobody notices
 * until reconciliation. So the routing rule is pinned down explicitly.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

// ---- pull P_pickQR out of app.js and run it against a known QR set ------------------------
const src = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8');
const i = src.indexOf('function P_pickQR(');
if (i < 0) { console.log('  FAIL P_pickQR not found in app.js'); process.exit(1); }
let depth = 0, j = src.indexOf('{', i), end = j;
for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (!depth) { end = k; break; } } }
const ctx = { window: {}, EN: () => false };
vm.createContext(ctx);
vm.runInContext(src.slice(i, end + 1), ctx);
const QR = { ot: 'QR_OT', school: 'QR_SCHOOL', byKid: { 'STD-01': 'QR_PKG_A', 'STD-02': 'QR_PKG_B' } };
const pick = items => { ctx.window._PICKQR = QR; return ctx.P_pickQR(items); };
const IT = (kind, sid) => ({ kind, id: 'x', sid });

// ============================================================================
console.log('\n1) Only OT -> the OT account');
{
  eq('one OT', pick([IT('ot', 'STD-01')]).img, 'QR_OT');
  eq('several OT, same child', pick([IT('ot', 'STD-01'), IT('ot', 'STD-01')]).img, 'QR_OT');
  eq('OT for two children is still OT money', pick([IT('ot', 'STD-01'), IT('ot', 'STD-02')]).img, 'QR_OT');
  ok_('and it says so', /OT/.test(pick([IT('ot', 'STD-01')]).note));
}

console.log("\n2) Anything with a bill -> the PACKAGE account");
{
  eq('tuition alone', pick([IT('bill', 'STD-01')]).img, 'QR_PKG_A');
  eq('an extra charge alone', pick([IT('charge', 'STD-01')]).img, 'QR_PKG_A');
  eq('tuition + charge for the same child', pick([IT('bill', 'STD-01'), IT('charge', 'STD-01')]).img, 'QR_PKG_A');
  eq('the OTHER child uses THEIR package account', pick([IT('bill', 'STD-02')]).img, 'QR_PKG_B');
  ok_('never the wrong sibling', pick([IT('bill', 'STD-02')]).img !== 'QR_PKG_A');
}
{
  // a combined bill is still tuition money — it follows the package, not the general account
  eq('tuition + OT bundled into one transfer', pick([IT('bill', 'STD-01'), IT('ot', 'STD-01')]).img, 'QR_PKG_A');
  eq('tuition + charge + OT', pick([IT('bill', 'STD-01'), IT('charge', 'STD-01'), IT('ot', 'STD-01')]).img, 'QR_PKG_A');
  ok_('and it is described as the package account',
    /แพ็กเกจ|package/.test(pick([IT('bill', 'STD-01'), IT('ot', 'STD-01')]).note));
}
{
  // two children on the SAME package account can still go in one transfer
  ctx.window._PICKQR = { ot: 'QR_OT', school: 'QR_SCHOOL', byKid: { 'STD-01': 'QR_PKG_A', 'STD-02': 'QR_PKG_A' } };
  eq('siblings sharing an account use it', ctx.P_pickQR([IT('bill', 'STD-01'), IT('bill', 'STD-02')]).img, 'QR_PKG_A');
}

console.log('\n3) Two DIFFERENT package accounts — the one case with no right answer');
{
  eq('two children on different accounts', pick([IT('bill', 'STD-01'), IT('bill', 'STD-02')]).img, 'QR_SCHOOL');
  eq('everything at once, across children', pick([IT('bill', 'STD-01'), IT('charge', 'STD-01'), IT('ot', 'STD-02')]).img, 'QR_SCHOOL');
  ok_('and the parent is TOLD why, not left guessing',
    /คนละบัญชี|different accounts/.test(pick([IT('bill', 'STD-01'), IT('bill', 'STD-02')]).note));
}

console.log('\n4) It never hands back nothing');
{
  eq('no selection still returns the school QR rather than a blank', pick([]).img, 'QR_SCHOOL');
  ctx.window._PICKQR = { school: 'QR_SCHOOL', byKid: {} };
  eq('no OT QR configured falls back to the school account', ctx.P_pickQR([IT('ot', 'STD-01')]).img, 'QR_SCHOOL');
  ctx.window._PICKQR = { ot: 'QR_OT', school: 'QR_SCHOOL', byKid: {} };
  eq('a child with no package QR falls back to the school account', ctx.P_pickQR([IT('bill', 'STD-09')]).img, 'QR_SCHOOL');
}

console.log('\n5) The screen itself');
{
  ok_('the pick list is rendered on the payment page, not behind a button', /id="payPick"/.test(src));
  ok_('...and before the per-child detail', src.indexOf('id="payPick"') < src.indexOf('id="payBody"'));
  ok_('there is a select-all', /id="pickAll"/.test(src));
  ok_('and a select-all per child', /class="pickAllKid"/.test(src));
  ok_('each row carries its child, so the QR can be routed', /data-sid=/.test(src));
  ok_('the child block leads with the nickname', /pickAllKid[\s\S]{0,400}dispNick\(g\.kid\)|dispNick\(g\.kid\)[\s\S]{0,400}pickAllKid/.test(src));
  ok_('the parent is told which account it goes to', /pickQrNote/.test(src));
  ok_('the QR is shown before the slip step', /P_pickPay[\s\S]{0,600}qrModalHTML/.test(src));
  ok_('...and then hands over to the one-slip flow', /P_pickPay[\s\S]{0,900}P_combinedNext/.test(src));
  ok_('nothing can be submitted with an empty selection', /pickNext[\s\S]{0,200}disabled=!items\.length/.test(src));
  // the old dialog must be gone, not left behind as a second copy of the same list
  ok_('the superseded dialog was removed', src.indexOf('P_combinedPay') < 0 && src.indexOf('combCb') < 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL PASS ') + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
