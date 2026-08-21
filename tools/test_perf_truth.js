/**
 * tools/test_perf_truth.js — the report has to be true before anything it says is worth acting on.
 *   node tools/test_perf_truth.js
 *
 * The 2026-08-21 report opened with:
 *
 *     ATOM PERF Fri Aug 21 2026 -> Wed Aug 19 2026
 *
 * A range that runs backwards, which is the visible half of a defect that had made every figure in
 * every report mean something other than it said.
 *
 * Rows are WRITTEN as 'yyyy-MM-dd HH:mm:ss', which sorts correctly as text. Sheets stores that as a
 * DATE, and getValues() hands back a Date object; String(date) is "Fri Aug 21 2026 …", starting with
 * the WEEKDAY. So:
 *   - the "last N days" filter compared "Fri Aug 21…" against "2026-08-14…". Digits sort before
 *     letters, so EVERY row passed. The report covered the whole log rather than the window it
 *     printed, and figures from two reports were never over the same period.
 *   - the header's min and max were alphabetical by weekday name.
 *
 * Same trap as the holiday times (v251): a Sheets cell read back as a Date and treated as a string.
 *
 * The other half of the file is about the same idea applied to failures. "staffCheckin fail 53%" was
 * six people standing outside the geofence and four tapping a button they had already used — the
 * rule working exactly as designed, reported as though the app were falling over, at the top of the
 * list where it buried the failures that were ours.
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
const perf = R('src/Perf.gs'), app = R('webapp/app.js'), api = R('webapp/api.js');

// run the two real helpers out of Perf.gs, with a formatDate that behaves like the GAS one
function loadHelpers() {
  const at = perf.indexOf('var PERF_EXPECTED_'), end = perf.indexOf('/** Keep the sheet bounded');
  const ctx = {
    console, String, Object, Number, Date,
    Utilities: { formatDate: function (d, tz, fmt) {
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
             p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } },
    perfTz_: () => 'Asia/Bangkok'
  };
  vm.createContext(ctx);
  vm.runInContext(perf.slice(at, end) + '\nthis.stamp = perfStamp_; this.ts = perfTs_; this.expected = PERF_EXPECTED_;', ctx);
  return ctx;
}
const H = loadHelpers();

console.log('\n1) a timestamp that sorts');
{
  const d = new Date(2026, 7, 21, 10, 30, 0);          // Friday 21 Aug 2026
  eq('a Date becomes the same text the writer produced', H.ts(d), '2026-08-21 10:30:00');
  eq('...and text is left alone', H.ts('2026-08-19 07:00:00'), '2026-08-19 07:00:00');
  eq('blank stays blank', H.ts(null), '');
  eq('the writer and the reader agree', H.stamp(d), H.ts(d));
}
{
  // the comparison the whole report rests on
  const fri = new Date(2026, 7, 21, 10, 0, 0), wed = new Date(2026, 7, 19, 10, 0, 0);
  ok_('Wednesday sorts before Friday, as a date should', H.ts(wed) < H.ts(fri));
  ok_('...which the raw strings did NOT', !(String(wed) < String(fri)));
  const cut = H.stamp(new Date(2026, 7, 20, 0, 0, 0));
  ok_('a row older than the cutoff is now excluded', H.ts(wed) < cut);
  ok_('...and a row inside it is kept', !(H.ts(fri) < cut));
  ok_('the raw string let EVERY row through, whatever the cutoff', !(String(wed) < cut) && !(String(fri) < cut));
}

console.log('\n2) the reader uses it — everywhere the old one was');
{
  ok_('rows are read through it', /var ts = perfTs_\(r\[0\]\);/.test(perf));
  ok_('the cutoff is built with the same formatter', /var cutStr = perfStamp_\(cutoff\);/.test(perf));
  ok_('...and so is the row being written', /var ts = perfStamp_\(new Date\(\)\);/.test(perf));
  ok_('no raw String\\(r\\[0\\]\\) is left', !/var ts = String\(r\[0\]\)/.test(perf));
  ok_('the trap is written down for the next person', /which starts with the WEEKDAY/.test(perf));
  ok_('...and named as the one from v251', /Same trap as the holiday times \(v251\)/.test(perf));
}

console.log('\n3) the window says when it is shorter than it claims');
{
  ok_('rows older than the cutoff are counted', /\{ skipped\+\+; continue; \}/.test(perf));
  ok_('...and reported', /older: skipped,/.test(perf));
  ok_('a full log with nothing skipped is flagged as truncated',
    /truncated: \(skipped === 0 && Math\.max\(0, sh\.getLastRow\(\) - 1\) >= PERF_MAX_KEEP\)/.test(perf));
  ok_('the report prints the warning first', /if\(d\.truncated\) L\.push\('WINDOW: capped at '/.test(app));
  ok_('...saying it covers LESS than asked', /this covers LESS than '\+d\.days\+' days/.test(app));
}

console.log('\n4) refused on purpose is not failed');
{
  eq('standing outside the geofence', H.expected.OUT_OF_RANGE, 1);
  eq('a second punch the server refuses', [H.expected.ALREADY_CHECKED_IN, H.expected.ALREADY_CHECKED_OUT], [1, 1]);
  eq('a form submitted incomplete', H.expected.MISSING_FIELDS, 1);
  eq('a journal already sent to the parent', H.expected.JOURNAL_LOCKED, 1);
  eq('a role asking for what it may not have', [H.expected.NO_PERMISSION, H.expected.READ_ONLY], [1, 1]);
  // the ones that must NEVER be waved through: these are ours
  ['BAD_RESPONSE', 'LOST_REQUEST', 'INTERNAL', 'OFFLINE', 'NO_SESSION', 'BUSY', 'UNKNOWN_ACTION', 'WRITE_GUARD']
    .forEach(c => eq(c + ' is still a failure', H.expected[c] === 1, false));
}
{
  ok_('a refusal is counted apart from a failure', /var refused = !ok && PERF_EXPECTED_\[code\] === 1;/.test(perf));
  ok_('...and kept out of the headline rate', /if \(refused\) a\.refused\+\+; else \{ a\.fail\+\+; failed\+\+; \}/.test(perf));
  ok_('...out of the device breakdown', /if \(!ok && !refused\) devs\[dev\]\.fail\+\+;/.test(perf));
  ok_('...and out of the role breakdown', /if \(!ok && !refused\) roles\[role\]\.fail\+\+;/.test(perf));
  ok_('the codes are still listed, so nothing is hidden', /a\.codes\[code \|\| 'ERR'\] = \(a\.codes\[code \|\| 'ERR'\] \|\| 0\) \+ 1;/.test(perf));
  ok_('the report shows the total', /'REFUSED \(working as intended\): '/.test(app));
  ok_('...and puts them beside each failing action', /\(x\.refused\?' \(\+'\+x\.refused\+' refused\)':''\)/.test(app));
  ok_('adding to the list is documented as a deliberate act', /Adding to this list is a deliberate act/.test(perf));
}

console.log('\n5) a teacher does not type her daily report twice');
{
  // 18 lost replies in one week, all confirmed by the diagnostic added in v247:
  //   http=200 redirected via=script.googleusercontent.com
  ok_('the four the outbox already replays may now be retried too',
    /const IDEMPOTENT_WRITE = \/\^\(staffCheckin\|staffCheckout\|staffStudentCheckin\|submitJournal\|studentAbsence\|submitAssessment\)\$\//.test(api));
  ok_('...with what makes each one safe written down', /staffStudentCheckin updates the existing\s*\n\s*\* row for that \(student, date, type\)/.test(api));
  ok_('...and why a lost reply is a weaker demand than the outbox', /the outbox replays\s*\n\s*\* minutes or hours later, this retries within the same second/.test(api));
  ok_('money is still never repeated', /Everything that CREATES a row — payments, slips, bills, growth records — is deliberately absent/.test(api));
  // the promise the whole retry rule rests on
  ok_('a plain write is still not repeatable', /const RETRY_SAFE = a => a === 'auth' \|\| a === 'ping' \|\| \(a !== 'batch' && !isMutating\(a\)\)/.test(api));
  ok_('...and the outbox still refuses to queue anything that creates a row',
    /Everything that CREATES a\s*\n\s*\/\/ row \(payments, slips, bills, growth records\) or deletes one is deliberately NOT queued/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
