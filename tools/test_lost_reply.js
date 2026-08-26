/**
 * tools/test_lost_reply.js — the reply must answer the question that was asked, and a read must not
 * be mistaken for a write.
 *   node tools/test_lost_reply.js
 *
 * Two findings from the 2026-08-11 speed report, both proven by the telemetry rather than guessed:
 *
 * 1. batchShape :: data=object inner=service,status,time
 *    Those three keys are our OWN health check. A POST whose body is lost in transit arrives as an
 *    action-less GET; doGet answered ok:true, and the client handed {service,status,time} to a
 *    screen, which died on "x.map is not a function" (Fa.filter / A.map / S.map in the same report).
 *
 * 2. READ_ONLY on an Observer's home screen, and BUSY on studentCheckinHistory / studentLeaves.
 *    Ten reads whose NAMES look like writes (pay*, check*in, absence*) were whitelisted on the
 *    client but not on the server, so they took the write lock and — being "writes" — were refused
 *    for the Observer role, taking the whole batch they travelled in down with them.
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
const code = R('src/Code.gs'), api = R('webapp/api.js'), ge = R('src/GasEngine.gs');

/* isMutatingAction_ is a plain function of a string — run the REAL one out of Code.gs. */
function loadIsMutating() {
  const at = code.indexOf('var MUTATING_RE');
  const end = code.indexOf('/** Run fn under a script lock');
  const ctx = { String, RegExp, console };
  vm.createContext(ctx);
  vm.runInContext(code.slice(at, end) + '\nthis.f = isMutatingAction_;', ctx);
  return ctx.f;
}

console.log('\n1) the ten reads that only LOOK like writes');
{
  const mut = loadIsMutating();
  const reads = ['absenceReport', 'paymentLog', 'paymentSlips', 'payments', 'payrollConfig',
    'payrollReminderDue', 'prepayTiers', 'prepayments', 'staffCheckinLog', 'studentCheckinHistory'];
  reads.forEach(a => eq(a + ' is a read', mut(a), false));
}

console.log('\n2) ...and every real write is still a write');
{
  const mut = loadIsMutating();
  ['savePayment', 'payCombined', 'payOT', 'payPrepay', 'payCharge', 'uploadSlip', 'confirmSlip',
   'staffCheckin', 'parentCheckin', 'staffStudentCheckin', 'recordCashPayment', 'deleteBill',
   'setStudentPause', 'dedupData', 'reindexParents', 'orgMoveStudent', 'unlinkStudent',
   'recomputeContributions', 'markSalaryPaid', 'saveFoodMenu'].forEach(a => eq(a + ' writes', mut(a), true));
  // the near-misses that make this list dangerous to edit carelessly
  eq('payments (read) vs payCombined (write)', [mut('payments'), mut('payCombined')], [false, true]);
  eq('staffCheckinLog (read) vs staffCheckin (write)', [mut('staffCheckinLog'), mut('staffCheckin')], [false, true]);
  eq('absenceReport (read) vs absenceLog is not an action', mut('absenceReport'), false);
}

console.log('\n3) the client and the server answer "does this write?" identically');
{
  const mut = loadIsMutating();
  const clientList = (api.match(/const READ_ONLY = \{([\s\S]*?)\};/) || [, ''])[1];
  const serverList = (code.match(/var READ_ONLY_ACTIONS_ = \{([\s\S]*?)\};/) || [, ''])[1];
  const names = s => (s.match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*:)/g) || []).sort();
  ok_('both lists exist', !!clientList && !!serverList);
  eq('and hold exactly the same actions', names(serverList), names(clientList));
  // twelve since v285: staffMissingCheckout contains "Checkout" and prepaidStudents starts with
  // "prepay", so the verb test calls both writes. The COUNT is pinned on purpose — this list is the
  // fix for a bug that took an Observer's home screen down, so growing it should be a deliberate
  // act, not something that drifts.
  eq('twelve of them', names(serverList).length, 12);
  ok_('...including the ones whose NAMES are the trap',
    ['staffMissingCheckout', 'prepaidStudents'].every(n => names(serverList).indexOf(n) >= 0));
  const clientW = (api.match(/const WRITES = \{([\s\S]*?)\};/) || [, ''])[1];
  const serverW = (code.match(/var WRITES_ACTIONS_ = \{([\s\S]*?)\};/) || [, ''])[1];
  ok_('both write-lists exist', !!clientW && !!serverW);
  eq('and they match too', names(serverW), names(clientW));
  ok_('nothing is on both lists', names(serverW).every(n => names(serverList).indexOf(n) < 0));
  // the whitelist must be consulted BEFORE the regex, or it does nothing
  ok_('the server checks the whitelist first', /if \(READ_ONLY_ACTIONS_\[a\]\) return false;/.test(code));
  // an action nobody listed still gets judged by the verb
  eq('an unlisted read is still judged by its name', mut('listStudents'), false);
}

console.log('\n3b) the writes whose NAMES do not look like writes');
{
  const mut = loadIsMutating();
  // found by running this classifier over all 124 routes, then reading each handler: every one of
  // these calls updateRow_/appendObject_/deleteRow, so every one needs the write lock
  ['recordCashPayment', 'teacherStudentLeave', 'unlockJournal', 'adminResetPassword',
   'adminUpdateOT', 'adminCancelOT', 'adminRestoreOT', 'adminAddOT', 'adminEditOT',
   'adminDeleteOT', 'decideClassChange', 'reinstallTriggers'].forEach(a => eq(a + ' takes the lock', mut(a), true));
  // and the reads that sit right next to them in the same screens must stay reads
  ['adminOTList', 'otCarryOver', 'pendingClassChanges', 'myClassChanges', 'listBackups',
   'checkDuplicateIds', 'dspmManual', 'notifications', 'adminInbox'].forEach(a => eq(a + ' stays a read', mut(a), false));
}

console.log('\n4) the health check can no longer be mistaken for data');
{
  const doGet = code.slice(code.indexOf('function doGet(e)'), code.indexOf('function doPost(e)'));
  ok_('an action-less request is NOT ok:true', !/ok: true, data: \{ service:/.test(doGet));
  ok_('it answers ok:false with a code the client can act on', /ok: false, a: 'health', error: \{ code: 'NO_ACTION'/.test(doGet));
  ok_('it still says the service is up', /service: 'Atom Nursery API', status: 'up'/.test(doGet));
}

console.log('\n5) every reply names the action it answers');
{
  const disp = code.slice(code.indexOf('function dispatch_(action, payload, token)'), code.indexOf('var OBSERVER_READ_ONLY_MSG_'));
  ok_('reply_ stamps the action', /function reply_\(o\) \{ o\.a = action; return jsonOut_\(o\); \}/.test(disp));
  // reply_ itself is the ONLY jsonOut_ left. It calling reply_ would recurse until the stack blew,
  // taking every request with it — which is exactly what a careless bulk rename did here once.
  eq('only reply_ still calls jsonOut_', (disp.match(/return jsonOut_\(/g) || []).length, 1);
  ok_('and reply_ does not call itself', !/function reply_\(o\) \{[^}]*return reply_\(/.test(disp));
  ok_('...and there are replies to stamp', (disp.match(/return reply_\(/g) || []).length >= 5);
}

console.log('\n6) the client refuses a reply that answers a different question');
{
  const post = api.slice(api.indexOf('async function postGas('), api.indexOf('/* ---- Phase 0 telemetry'));
  ok_('a NO_ACTION reply is treated as lost', /j\.error\.code === 'NO_ACTION'/.test(post));
  ok_('a mismatched action is treated as lost', /j\.a && asked && j\.a !== asked/.test(post));
  ok_('a reply with no name is left alone (older deployment)', /j\.a && asked/.test(post));
  // v247: the three retry paths ask ONE question now (canRepeat), instead of spelling the rule out
  // three times — see tools/test_lost_request.js for what it answers, including the two staff
  // punches, which are safe to repeat because the SERVER refuses the duplicate.
  ok_('a lost READ is asked again', /if \(canRepeat\(body\) && attempt < 2\)/.test(post));
  ok_('a lost WRITE is never repeated', /const canRepeat = body => \{/.test(api) && /RETRY_SAFE\(x\) \|\| IDEMPOTENT_WRITE\.test/.test(api));
  ok_('and it fails with a code, not a JavaScript message', /e3\.code = 'LOST_REQUEST'/.test(post));
  ok_('it is recorded so we can see whether it stops', /PERF\.err\('lostReply'/.test(post));
  ok_('the logger never logs itself', /asked !== 'perfLog'/.test(post));
}

console.log('\n7) an Observer keeps the reads that shared a batch with a write');
{
  const disp = code.slice(code.indexOf('function dispatch_(action, payload, token)'), code.indexOf('var OBSERVER_READ_ONLY_MSG_'));
  ok_('a single write is still refused outright', /if \(action !== 'batch'\) \{[\s\S]{0,160}code: 'READ_ONLY'/.test(disp));
  ok_('a batch is no longer refused whole', /mutates = false;\s+\/\/ nothing in this batch/.test(disp));
  ok_('handleBatch refuses the mutating calls one by one', /isObs && typeof isMutatingAction_ === 'function' && isMutatingAction_\(c\.action\)/.test(ge));
  ok_('...with the same message, from one place', /OBSERVER_READ_ONLY_MSG_/.test(ge) && /var OBSERVER_READ_ONLY_MSG_ =/.test(code));
  // and the refusal still has the shape every batch entry must have, or the client mis-pairs results
  ok_('a refused call still returns one entry', /return \{ ok: false, error: \{ code: 'READ_ONLY',/.test(ge));
}

console.log('\n8) the reads that caused this are reads in the engine, not writes');
{
  // if any of the ten actually wrote, dropping the lock would be a data-loss bug — check the source
  const eng = R('webapp/engine.js');
  [['payments', 'Object.assign({},b,'], ['studentCheckinHistory', 'M.studentCheckins.filter'],
   ['prepayments', 'M.prepayments.filter'], ['paymentSlips', 'paySlips_().filter']].forEach(([a, needle]) => {
    const i = eng.indexOf('\n    ' + a + ':');
    ok_(a + ' only filters/maps', i > 0 && eng.slice(i, i + 2000).indexOf(needle) >= 0);
  });
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
