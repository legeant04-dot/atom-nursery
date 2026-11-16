/**
 * tools/test_observer_readonly.js — an Observer is not shown a button the server will refuse (v511).
 *   node tools/test_observer_readonly.js
 *
 * docs/ROLE_FUNCTIONS.md (14 Nov): the four screens an Observer shares with the Admin drew ประกาศ ·
 * เชื่อม · มุมมอง · edit/delete announcement · edit/cancel leave, and every pop-up behind them more.
 * app.js now hides every A_ function matching OBS_EDIT_RE with one generated CSS rule. This pins the
 * line between "changes something" and "only looks", in both directions.
 */
const fs = require('fs'), path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok_ = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; };

const m = /const OBS_EDIT_RE = (\/\^A_\(.*\)\/);\n/.exec(app);
ok_('OBS_EDIT_RE is in app.js', !!m);
const RE = m ? eval(m[1]) : /$^/;
const defined = [...new Set((app.match(/window\.(A_[A-Za-z0-9_]+)\s*=/g) || []).map(s => s.replace(/^window\.|\s*=$/g, '')))];

// A_resetPin ships with the move (golive) — hidden by the same rule the day it exists on live
const LATER = new Set(['A_resetPin']);

console.log('\n1) what an Observer must NOT see — the ones the review named, and the money doors');
['A_addAnn', 'A_editAnn', 'A_delAnn', 'A_linkParent', 'A_viewAs', 'A_editLeave', 'A_cancelLeave', 'A_addOTForm',
 'A_confirmSlip', 'A_rejectSlip', 'A_confirmPay', 'A_issueBill', 'A_genBills', 'A_finCash', 'A_delStaff', 'A_resetPw',
 'A_viewPw', 'A_resetPin', 'A_unlockJournal', 'A_saveSettings', 'A_saveStudent', 'A_setMoney', 'A_injDecide']
  .forEach(n => ok_(n + ' hidden', RE.test(n) && (defined.includes(n) || LATER.has(n))));

console.log('\n2) what an Observer MUST still see — reading is the whole role');
['A_previewAnn', 'A_annTab', 'A_lvMain', 'A_lvTab', 'A_staffOT', 'A_holidayOT', 'A_timeRequests', 'A_injuries',
 'A_finTab', 'A_finStudent', 'A_studentOT', 'A_cls', 'A_staffMonth', 'A_yearReview', 'A_viewJournal', 'A_viewInjury',
 'A_exitViewAs', 'A_search', 'A_studentReport', 'A_prepayAudit', 'A_payLog']
  .forEach(n => ok_(n + ' shown', !RE.test(n) && defined.includes(n)));

console.log('\n3) the mechanism');
ok_('one CSS rule built from the functions that exist, scoped to body.ro-observer',
  /'body\.ro-observer \[onclick\*="' \+ n \+ '\("\]'/.test(app));
ok_('rebuilt when more A_ functions appear (a session restored at start-up paints before they exist)',
  /Number\(st\.dataset\.n\) >= names\.length/.test(app));
ok_('removed for anyone who is not an Observer (an Admin after an Observer on the same phone)',
  /if \(!on\) \{ if \(st\) st\.remove\(\); return; \}/.test(app));
ok_('run from setHeader and from every GO()', (app.match(/window\.__atomObsStyle\) window\.__atomObsStyle\(\)/g) || []).length >= 2);
ok_('the api guard is still the second layer', /isObserver\(\) && window\.__atomIsMutating && window\.__atomIsMutating\(action\)/.test(app));

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
