/**
 * tools/test_cache_scope.js — a check-in does not throw away the bill.
 *   node tools/test_cache_scope.js
 *
 * FROM THE 2026-08-25 REPORT: cache=60%. That figure is the CLIENT read cache in api.js — the 40% is
 * calls that had to go to the network at all.
 *
 * The ten busiest reads in the app were all missing from OWNED_BY, so EVERY write threw all of them
 * away. A parent dropping their child off wiped that family's journal, their bill and their leave
 * history — none of which a check-in touches. On a morning of thirty check-ins the cache was emptied
 * thirty times, and each screen afterwards went back to the server for everything.
 *
 * WHY IT IS SAFE TO WIDEN THIS, in a way it would not have been for the static tier: every read
 * named here sits in the DEFAULT tier (RC_TTL = 30 seconds) with stale-while-revalidate. A rule that
 * is too generous costs at most half a minute of stale data that then corrects itself — not the four
 * hours a mistake in TTL_STATIC would cost. Each rule is written against the handler it names, and
 * this file is where the claim is checked rather than asserted.
 *
 * THE TRAP THIS FILE EXISTS FOR: rcClearFor only consults OWNED_BY when SCOPED_WRITES matches the
 * action. Naming a write inside an OWNED_BY rule without also adding it to SCOPED_WRITES produces a
 * rule that reads correctly and never runs.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
const src = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'api.js'), 'utf8').replace(/\r\n/g, '\n');

// pull the two tables straight out of the source and run them
const OWNED = {};
{
  const block = /const OWNED_BY = \{([\s\S]*?)\n  \};/.exec(src)[1];
  const re = /^\s*([A-Za-z]+):\s*(\/.*\/i),?\s*$/gm; let m;
  while ((m = re.exec(block))) OWNED[m[1]] = eval(m[2]);
}
const SCOPED = (() => {
  const block = /const SCOPED_WRITES = new RegExp\('\^\(' \+ \[([\s\S]*?)\]\.join/.exec(src)[1];
  return [...block.matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]);
})();
/** what rcClearFor actually does: a read survives only if it is scoped AND its owner says no */
const survives = (read, write) => SCOPED.indexOf(write) >= 0 && !!OWNED[read] && !OWNED[read].test(write);

console.log('\n1) the tables are wired to each other');
{
  /* Every write named in an owner rule must also be SCOPED, or the rule reads correctly and never
   * runs. Checked against the writes this file's rules actually depend on — the five that had to be
   * added for them, plus a sample of the ones that were already there. */
  ['editStudentAttendance', 'issueBill', 'deleteBill', 'addStudentCharge', 'removeStudentCharge',
   'parentCheckin', 'staffStudentCheckin', 'submitJournal', 'unlockJournal', 'staffCheckin',
   'staffCheckout', 'confirmTimeRequest', 'studentAbsence', 'teacherStudentLeave', 'uploadSlip']
    .forEach(w => ok_(`${w} is scoped, so its owner rules can run`, SCOPED.indexOf(w) >= 0));
  eq('every scoped write is a name, not a pattern', SCOPED.filter(w => !/^[A-Za-z]+$/.test(w)), []);
  ok_('an UNKNOWN write still clears everything', !survives('getJournal', 'somethingNobodyHasWrittenYet'));
}

console.log('\n2) a parent dropping their child off keeps what it cannot have changed');
{
  ['getJournal', 'journalStatus', 'studentLeaves', 'myAttendanceToday']
    .forEach(r => ok_(`${r} survives parentCheckin`, survives(r, 'parentCheckin')));
  // ...and loses what it CAN
  ok_('studentCheckinHistory does NOT survive it — the times changed', !survives('studentCheckinHistory', 'parentCheckin'));
  /* AND NEITHER DOES parentDue. Collecting a child late RAISES an OT charge (otUpsertForPickup_), so
   * a pick-up really can change what the family owes. This is the one that is easy to miss, and the
   * reason the table is written next to the handlers rather than from memory. */
  ok_('parentDue does NOT survive it — a late pick-up costs money', !survives('parentDue', 'parentCheckin'));
}

console.log('\n3) each live read is dropped by exactly what touches it');
{
  const cases = [
    ['studentCheckinHistory', ['parentCheckin', 'staffStudentCheckin', 'editStudentAttendance'],
      ['submitJournal', 'uploadSlip', 'staffCheckin', 'submitLeave', 'submitAssessment']],
    ['studentLeaves', ['studentAbsence', 'teacherStudentLeave', 'editStudentLeave', 'deleteStudentLeaves'],
      ['parentCheckin', 'submitJournal', 'approveLeave', 'uploadSlip']],
    ['getJournal', ['submitJournal', 'unlockJournal'],
      ['parentCheckin', 'uploadSlip', 'submitAssessment', 'staffCheckin']],
    ['journalStatus', ['submitJournal', 'unlockJournal'],
      ['parentCheckin', 'staffCheckin', 'submitLeave']],
    ['myAttendanceToday', ['staffCheckin', 'staffCheckout', 'confirmTimeRequest', 'adminAddHolidayOT',
      'adminEditOT', 'adminDeleteOT', 'addHoliday', 'editHoliday', 'addBigCleaning', 'setSchoolConfig',
      'saveStaff', 'saveStaffGroup', 'setStaffEnd'],
      ['parentCheckin', 'submitJournal', 'uploadSlip', 'submitLeave', 'submitAssessment']],
    ['parentDue', ['uploadSlip', 'confirmSlip', 'rejectSlip', 'deleteSlip', 'payCombined', 'payCharge',
      'payPrepay', 'payOT', 'prepay', 'cancelPrepay', 'recordCashPayment', 'issueBillsFor', 'issueBill',
      'deleteBill', 'addStudentCharge', 'removeStudentCharge', 'adminCancelOT', 'adminRestoreOT',
      'parentCheckin', 'editStudentAttendance'],
      ['submitJournal', 'staffCheckin', 'submitAssessment', 'submitLeave']]
  ];
  cases.forEach(([read, drops, keeps]) => {
    drops.forEach(w => ok_(`${read} is dropped by ${w}`, !survives(read, w)));
    ok_(`${read} survives ${keeps.length} writes that cannot touch it`, keeps.every(w => survives(read, w)));
  });
}

console.log('\n4) the reads that were already scoped still behave');
{
  ok_('classList survives a check-in', survives('classList', 'parentCheckin'));
  ok_('...and is dropped when a child is moved', !survives('classList', 'orgMoveStudent'));
  ok_('payrollConfig survives a journal', survives('payrollConfig', 'submitJournal'));
  ok_('...and is dropped by setPayrollConfig', !survives('payrollConfig', 'setPayrollConfig'));
  ok_('schoolDay is dropped when a holiday is edited', !survives('schoolDay', 'editHoliday'));
}

console.log('\n5) the reasoning is written down where the rules are');
{
  ok_('the tier that bounds a mistake is stated', /RC_TTL, 30 seconds\) with stale-while-revalidate/.test(src));
  ok_('...and the late-pickup trap', /a pick-up really can change this number/.test(src));
  ok_('...and why an unnamed write still clears everything', /a write nobody has reasoned about is treated as if it could have changed anything/.test(src));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
