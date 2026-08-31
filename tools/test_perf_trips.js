/**
 * tools/test_perf_trips.js — the screen budget counts REQUESTS, which is what it was never counting.
 *   node tools/test_perf_trips.js
 *
 * The health report of 2026-08-30 said:
 *
 *     payroll x11 calls/visit=72.2 ⚠️OVER budget 4
 *     manage  x75 calls/visit=32.1 ⚠️OVER budget 5
 *
 * and those numbers are what Phase 4 was going to be spent on. They are not what they look like.
 *
 * api.js micro-batches every call made in the SAME TICK into one request — that is the single most
 * important thing the client does, because Apps Script runs one execution at a time per user, so a
 * request is roughly five seconds and the calls inside it are free. The report counted the CALLS.
 * A screen fetching nine things in one request was reported as nine and flagged over a budget of
 * four, while a screen making four separate requests — genuinely four times slower — looked fine.
 *
 * The comment above perVisit has always described round trips ("a screen that grew from 4 requests
 * to 9 got twice as slow"). The arithmetic under it counted actions. Optimising against that number
 * would have meant breaking batches apart to make a graph look better.
 *
 * The batch size was already on every row. Each row is 1/batch of a request, so a batch's rows sum
 * back to exactly one.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), perfGs = R('src/Perf.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Perf']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var rows = [];
  // one visit to each screen
  ['payroll', 'thrifty', 'chatty', 'legacy'].forEach(function (s) {
    rows.push({ t: 'nav', a: s, ms: 100, ok: 1, c: '', b: 1, s: s });
  });
  /* THE SCREEN THE OLD NUMBER CONDEMNED: nine things fetched, all in one request. Nine rows, each
   * carrying batch=9, so they add up to one round trip. */
  for (var i = 0; i < 9; i++) rows.push({ t: 'api', a: 'read' + i, ms: 500, ok: 1, c: '', b: 9, s: 'thrifty' });
  /* ...and the screen it let through: four calls, four separate requests. Four times the waiting,
   * and under the old arithmetic it scored BETTER than the one above. */
  for (var j = 0; j < 4; j++) rows.push({ t: 'api', a: 'seq' + j, ms: 5000, ok: 1, c: '', b: 1, s: 'chatty' });
  // payroll: two batches of six, plus one call on its own = 3 requests, 13 actions
  for (var k = 0; k < 6; k++) rows.push({ t: 'api', a: 'p' + k, ms: 400, ok: 1, c: '', b: 6, s: 'payroll' });
  for (var m = 0; m < 6; m++) rows.push({ t: 'api', a: 'q' + m, ms: 400, ok: 1, c: '', b: 6, s: 'payroll' });
  rows.push({ t: 'api', a: 'alone', ms: 5000, ok: 1, c: '', b: 1, s: 'payroll' });
  // a row written before the Batch column existed: blank reads 0, and it WAS its own request
  for (var n = 0; n < 3; n++) rows.push({ t: 'api', a: 'old' + n, ms: 900, ok: 1, c: '', b: 0, s: 'legacy' });

  handlePerfLog({ rows: rows, __sess: { role: 'Admin' } });
  var d = handlePerfSummary({ days: 7 });
  var by = {};
  (d.slowScreens || []).forEach(function (s) { by[s.screen] = s; });
  return JSON.stringify({ by: by, budgets: { thrifty: 4, chatty: 4 } });
}));

// ============================================================================
console.log('\n1) nine calls in one request is ONE request');
{
  const t = res.by.thrifty;
  ok_('the screen is reported at all', !!t);
  eq('requests per visit', t.perVisit, 1);
  eq('...and the actions are still shown beside it', t.actionsPerVisit, 9);
  /* THE WHOLE POINT. Under the old arithmetic this was 9 against a budget of 4 — the app's best
   * behaviour, reported as its worst. */
  eq('...so it is NOT over budget', t.over, false);
}

console.log('\n2) four separate requests is four');
{
  const c = res.by.chatty;
  eq('requests per visit', c.perVisit, 4);
  eq('...and it made only four calls', c.actionsPerVisit, 4);
  /* Four calls scored 4 under the old arithmetic too — the SAME score as the nine-call screen would
   * have got had it batched into two. The old number could not tell the two apart at all, and this
   * one is four times slower. */
  ok_('...at five seconds each, which is the whole cost', c.apiMs >= 20000);
}

console.log('\n3) a real mix — payroll');
{
  const p = res.by.payroll;
  // 6 + 6 batched, plus one on its own
  eq('thirteen actions', p.actionsPerVisit, 13);
  eq('...in three requests', p.perVisit, 3);
  ok_('...which is what the budget of 4 is about, and it is inside it', p.over === false);
}

console.log('\n4) rows from before the Batch column');
{
  /* blank → 0. Treating 0 as "unknown, count it as one" is what those rows actually were, and it
   * must not divide by zero or quietly drop them. */
  const l = res.by.legacy;
  eq('each counts as its own request', l.perVisit, 3);
  eq('...and as three actions', l.actionsPerVisit, 3);
}

console.log('\n5) said plainly on the report');
{
  ok_('the arithmetic is by round trip', /sc\.trips = \(sc\.trips \|\| 0\) \+ \(1 \/ \(batch > 0 \? batch : 1\)\);/.test(perfGs));
  ok_('...and the reason is written down', /ROUND TRIPS, WHICH IS WHAT THE BUDGET IS ABOUT — and what this was NOT counting/.test(perfGs));
  ok_('the report says requests, not calls', /requests\/visit=/.test(app) && !/' calls\/visit='/.test(app));
  ok_('...and shows the action count too, so the batching is visible',
    /\(actions '\+x\.actionsPerVisit\+'\)/.test(app));
}

console.log('\n6) the round trips that were actually there to remove');
{
  /* Found by reading the code rather than the graph — two places where independent calls were
   * awaited one after another, each costing a whole extra request (~5s) on a backend that runs one
   * execution at a time. */
  ok_('the payroll screen’s leave summary rides with the other five',
    /const p_leave = api\('staffLeaveSummary',\{staffId:sid,month:mth\}\)/.test(app));
  ok_('...instead of being asked for after four awaits', !/const ls=await api\('staffLeaveSummary'/.test(app));
  ok_('the two independent writes before a payroll calculation go together',
    /const p_cfg = api\('setPayrollConfig'[\s\S]{0,900}const p_base = api\('saveStaff'[\s\S]{0,300}await p_cfg; await p_base;/.test(app));
  /* computePayroll still WAITS for both: it reads the config and the salary that were just written,
   * and racing it against them would make the payslip depend on which write finished first. */
  ok_('...but the calculation still waits for them both',
    /await p_cfg; await p_base;\n\s*const r=await api\('computePayroll'/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
