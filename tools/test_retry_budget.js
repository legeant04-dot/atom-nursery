/**
 * tools/test_retry_budget.js — what may be sent again, and what must not.
 *   node tools/test_retry_budget.js
 *
 * Three findings from the PERF report of 16–21/09/2026, fixed together in v391 because they are the
 * same question seen from three sides: "was that a failure, or was it something we can simply do
 * again?"
 *
 * 1. parentCheckin failed 13% — the worst of any action a family performs, and the ONLY check-in
 *    door left off IDEMPOTENT_WRITE. staffStudentCheckin, which writes the same sheet for the same
 *    child on the same day, had been on it from the start: a teacher's lost punch healed itself and
 *    a parent's did not. A parent at the gate was told it failed.
 *
 * 2. iOS failed 6% against Android's 2% on the same wifi, with OFFLINE the top code almost
 *    everywhere. iOS cancels an in-flight request when the app leaves the screen, and at p50 11.5s
 *    that is a glance at a message. Each of those spent a real retry, so two glances exhausted the
 *    budget before the server had failed once.
 *
 * 3. The absence screen kept being flagged 3.6 > 3 with nothing left to optimise. The 3.6 was the
 *    teacher ringing families — one round trip per saved follow-up, minutes apart, unbatchable.
 *
 * WHAT THIS FILE IS REALLY GUARDING is the money. IDEMPOTENT_WRITE is a list of writes we promise
 * are safe to send twice, and that promise is kept by a guard in each handler — not by hoping the
 * first one did nothing. A payment or a slip joining this list would double-charge a family, so the
 * test below asserts the list by NAME, and separately asserts that every member has its guard.
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
const api = R('webapp/api.js'), app = R('webapp/app.js'),
      parentGs = R('src/Parent.gs'), checkinGs = R('src/Checkin.gs'), perfGs = R('src/Perf.gs');
/* CODE ONLY, COMMENTS STRIPPED. Both of these files explain at length what they deliberately do NOT
 * do — "the obvious move is GO('absence') and it costs two round trips", "absence: 3 → 6" — and a
 * test that greps the raw text reads those sentences as the thing they are warning against. The
 * first draft of this file did exactly that and failed on its own documentation. Anything asserting
 * what the code DOES must be measured against code. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const appCode = strip(app), perfCode = strip(perfGs);

// ============================================================================================
console.log('1) the list of writes we promise are safe to repeat');
// ============================================================================================
{
  const src = /const IDEMPOTENT_WRITE = \/\^\(([^)]*)\)\$\/;/.exec(api);
  ok_('the list was found', !!src);
  const names = src[1].split('|');

  /* ASSERTED BY NAME, NOT BY COUNT. A test that only checked the length would pass if somebody
   * swapped one of these for `uploadSlip`, which is the exact mistake that must never happen. */
  eq('exactly these seven, and nothing else', names.sort(), [
    'parentCheckin', 'staffCheckin', 'staffCheckout', 'staffStudentCheckin',
    'studentAbsence', 'submitAssessment', 'submitJournal'
  ]);

  /* NOTHING THAT CREATES A MONEY ROW IS ON IT. Named explicitly rather than inferred, so the list of
   * things we are protecting is legible to whoever reads this next. */
  ['uploadSlip', 'verifySlip', 'payCharge', 'payOT', 'payPrepay', 'prepay', 'recordCashPayment',
   'issueBill', 'issueBillsFor', 'generateMonthlyBills', 'payCombined', 'payCombinedCash',
   'updateGrowth', 'submitInjury', 'registerNew'].forEach(n => {
    ok_(n + ' is NOT repeatable', names.indexOf(n) < 0);
  });
}

// ============================================================================================
console.log('\n2) ...and every one of them has a guard to point at');
// ============================================================================================
{
  /* THE RULE THE COMMENT STATES: "nothing joins this list without a guard in its handler to point
   * at." parentCheckin is the one that was added in v391 and the only one that touches money, so it
   * is checked properly rather than by keyword. */
  ok_('parentCheckin de-dups within a window instead of adding a row',
    /var win = parseInt\(getConfig_\('CheckinDedupMinutes', '10'\), 10\) \|\| 10;/.test(parentGs) &&
    /if \(recent\) \{\s*\n\s*updateRow_\(ciSheet, recent\._row/.test(parentGs));
  /* AND THE HALF THAT MATTERS MOST: the de-dup branch RETURNS before the OT block, so a retried
   * pick-up cannot charge a second late fee. If that early return is ever removed, a lost reply on
   * a 17:05 pick-up starts billing the family twice — and nothing else in the app would notice. */
  const dup = parentGs.slice(parentGs.indexOf('if (recent) {'));
  const retIdx = dup.indexOf('duplicate: true }'), otIdx = dup.indexOf('otUpsertForPickup_');
  ok_('...and returns BEFORE the OT charge is computed', retIdx > 0 && otIdx > retIdx);

  ok_('staff punches are refused outright by the server', /ALREADY_CHECKED_IN/.test(checkinGs) &&
    /ALREADY_CHECKED_OUT/.test(checkinGs));
  ok_('studentAbsence returns the existing leave rather than a second one',
    /STUDENT_ABSENCE_DUP/.test(parentGs));

  // the reason is written where the next person will change it, not only here
  ok_('the addition explains itself in the source', /RETURNS BEFORE THE OT BLOCK/.test(api));
}

// ============================================================================================
console.log('\n3) being backgrounded is not the same as failing');
// ============================================================================================
{
  ok_('a resume has its own budget, separate from the retry budget', /const MAX_RESUMES = 2;/.test(api));
  ok_('...and postGas carries it', /async function postGas\(body, attempt, resumes\)/.test(api));
  ok_('the two cases are told apart before the budget is touched',
    /const backgrounded = \(typeof document !== 'undefined' && document\.hidden\);/.test(api) &&
    /canRepeat\(body\) && \(backgrounded \? resumes < MAX_RESUMES : attempt < 2\)/.test(api));
  /* THE WHOLE FIX IN ONE LINE: a resume must not advance `attempt`, or the person who glanced at a
   * message still arrives at the server with a spent budget and nothing has changed. */
  ok_('a resume leaves the retry budget alone',
    /backgrounded \? postGas\(body, attempt, resumes \+ 1\) : postGas\(body, attempt \+ 1, resumes\)/.test(api));
  /* ...and every OTHER retry path has to carry `resumes` through, or a request that survived a
   * backgrounding and then hit a lost reply would silently get its resume budget back. */
  const calls = api.match(/postGas\(body, attempt[^)]*\)/g) || [];
  eq('every recursive call passes the resume count on',
     calls.filter(c => !/resumes/.test(c)), []);

  // it still stops: a phone that never comes back must not be followed for ever
  ok_('visible() gives up after 30s rather than hanging', /setTimeout\(\(\) => \{[^}]*\}, 30000\)/.test(api));
  ok_('a write is still never repeated on a TIMEOUT, because nobody knows what happened',
    /โปรดตรวจสอบก่อนทำรายการซ้ำ เพราะอาจบันทึกไปแล้ว/.test(api));
}

// ============================================================================================
console.log('\n4) the absence budget measures the screen, not the teacher');
// ============================================================================================
{
  const b = /absence: (\d+)/.exec(perfCode);
  eq('the budget is 6', b && Number(b[1]), 6);
  ok_('...and says why it was raised, as the file requires of any change to it',
    /correction to the BUDGET, not a concession about the code/.test(perfGs));

  /* THE CLAIM THE NEW BUDGET RESTS ON: the screen really does load in one round trip. If somebody
   * later splits this into two fetches, the budget is no longer honest and this fails. */
  const scr = appCode.slice(appCode.indexOf('async function absenceScreen('),
                            appCode.indexOf('SCREENS.Teacher.absence'));
  const awaits = (scr.match(/await api\(/g) || []).length;
  const promiseAll = (scr.match(/await Promise\.all\(\[/g) || []).length;
  eq('the load is ONE Promise.all and no loose awaits', [promiseAll, awaits], [1, 0]);
  ok_('...covering both of its reads', /api\('absenceReport'/.test(scr) && /api\('ratedChildCount'\)/.test(scr));

  /* AND THE v389 SAVING IS STILL THERE. Refetching after each follow-up cost two extra round trips
   * per family rung — on Apps Script, ~10 seconds of somebody's afternoon to redraw a line the
   * device already knew. */
  ok_('saving a follow-up updates the row in place, it does not refetch the screen',
    /UPDATED IN PLACE, NOT REFETCHED/.test(app));
  const fu = appCode.slice(appCode.indexOf('window.A_followup=async'), appCode.indexOf('window.A_followup=async') + 1200);
  ok_('...proved by there being no GO() back to the screen in it', !/GO\('absence'\)/.test(fu));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
