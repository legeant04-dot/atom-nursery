/**
 * tools/test_payroll_dupes.js — more than one payslip for one person in one month.
 *   node tools/test_payroll_dupes.js
 *
 * FOUND ON LIVE DATA 2026-08-29: ครูจอย had FOUR rows for กรกฎาคม 2569.
 *
 * The cause was already written down at the top of src/Payroll.gs, by whoever fixed it: 'YYYY-MM'
 * written into a Sheets cell is COERCED TO A DATE and reads back as '2026-07-01', so every
 * `String(row.Month) === '2026-07'` comparison failed. computePayroll's "is there already a row for
 * this month?" lookup never matched, and every press of บันทึก appended another row. ym7_ fixed the
 * lookup. The rows made before that fix were never cleaned up, and nothing has ever pointed at them.
 *
 * WHY THEY ARE WORSE THAN A DOUBLE COUNT: the readers disagree.
 *
 *   financeSummary  .find()   → the month's salary expense is whichever row is FIRST in the sheet
 *   getPayslip      .find()   → so is the slip that prints
 *   markSalaryPaid  .find()   → and the row the paid-tick lands on
 *   the slip list   .filter() → prints one slip per row
 *   recomputeContributions    → ADDS the fund from every duplicate
 *   otCarryOver_              → ADDS the OT from every duplicate
 *
 * Half the totals are decided by row order and the other half are inflated, and neither says so.
 *
 * The suite pins the RULES for choosing a keeper, and — just as much — the cases where the rules
 * refuse to choose. A tool that guesses confidently about somebody's pay is worse than one that says
 * "a person has to look at this".
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
const app = R('webapp/app.js'), payGs = R('src/Payroll.gs'), codeGs = R('src/Code.gs');

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup', 'Slips']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var HR = getHrSpreadsheet_();
  var stSh = sheet_(HR, 'STAFF'), paySh = sheet_(HR, 'PAYROLL');
  ensureColumns_(paySh, ['ContributionEmployer', 'ContributionAccum', 'StaffName', 'SlipUrl', 'PaidDate', 'PaidBy']);
  ['JOY', 'KOI', 'FANG', 'NID', 'BEE'].forEach(function (n, i) {
    appendObject_(stSh, { StaffID: 'STF-' + n, Name: 'ครู' + n, Nickname: n, Role: 'Teacher',
      PositionLevel: 'Staff', Status: 'ACTIVE', BaseSalary: 13000 + i });
  });
  var add = function (o) {
    appendObject_(paySh, Object.assign({ Month: '2026-07', BaseSalary: 0, GrossIncome: 0,
      SocialSecurity: 0, Contribution: 0, ContributionEmployer: 0, OtherDeductions: 0,
      TotalDeductions: 0, NetPay: 0, OTEvening: 0, SlipSent: 'NO' }, o));
  };
  /* ครูJOY — the shape of the live case: one empty row, two identical real ones, one different.
   * Nothing paid, nothing sent, so the rules have to fall through to "which is a real month's pay". */
  add({ PayrollID: 'PR-J1', StaffID: 'STF-JOY' });                                                    // empty
  add({ PayrollID: 'PR-J2', StaffID: 'STF-JOY', BaseSalary: 13000, GrossIncome: 13950, NetPay: 13000, Contribution: 200, GeneratedDate: '2026-07-31 09:00' });
  add({ PayrollID: 'PR-J3', StaffID: 'STF-JOY', BaseSalary: 13000, GrossIncome: 14435, NetPay: 13685, GeneratedDate: '2026-07-31 10:00' });
  add({ PayrollID: 'PR-J4', StaffID: 'STF-JOY', BaseSalary: 13000, GrossIncome: 13950, NetPay: 13000, Contribution: 200, GeneratedDate: '2026-07-31 09:05' });
  // ครูKOI — one row is PAID. Money that moved beats every other rule.
  add({ PayrollID: 'PR-K1', StaffID: 'STF-KOI', GrossIncome: 14000, NetPay: 13200 });
  add({ PayrollID: 'PR-K2', StaffID: 'STF-KOI', GrossIncome: 14000, NetPay: 13200, PaidDate: '2026-08-05', PaidBy: 'STF-ADM' });
  // ครูFANG — nothing paid, but one slip was SENT: that is the paper the teacher is holding.
  add({ PayrollID: 'PR-F1', StaffID: 'STF-FANG', GrossIncome: 12000, NetPay: 11500 });
  add({ PayrollID: 'PR-F2', StaffID: 'STF-FANG', GrossIncome: 12500, NetPay: 12000, SlipSent: 'YES' });
  // ครูNID — two rows that are the same to the last satang. The rules must NOT pick one.
  add({ PayrollID: 'PR-N1', StaffID: 'STF-NID', GrossIncome: 11000, NetPay: 10500 });
  add({ PayrollID: 'PR-N2', StaffID: 'STF-NID', GrossIncome: 11000, NetPay: 10500 });
  // ครูBEE — one row only, for the month AND another month. Never reported.
  add({ PayrollID: 'PR-B1', StaffID: 'STF-BEE', GrossIncome: 10000, NetPay: 9500 });
  add({ PayrollID: 'PR-B2', StaffID: 'STF-BEE', Month: '2026-08', GrossIncome: 10000, NetPay: 9500 });
  // a row the finder CANNOT place. It must be counted and reported, never silently dropped — a row
  // it skipped is a row it cannot vouch for, and the admin needs to know the scan had a hole in it.
  add({ PayrollID: 'PR-X1', StaffID: '', GrossIncome: 9000, NetPay: 8500 });
  add({ PayrollID: 'PR-X2', StaffID: 'STF-GHOST', Month: '', GrossIncome: 9000, NetPay: 8500 });

  var o = {};
  o.all = handlePayrollDuplicates({});
  o.oneStaff = handlePayrollDuplicates({ staffId: 'STF-JOY' });
  o.oneMonth = handlePayrollDuplicates({ month: '2026-08' });
  // NOBODY duplicated: the clean answer, which is the one the screen used to render as a toast
  o.clean = handlePayrollDuplicates({ staffId: 'STF-BEE' });
  // the two date helpers, which shipped with the backslashes missing from their regexes
  o.payDateStr = payDate_('2026-08-05');
  o.payDateIso = payDate_('2026-08-05T00:00:00.000Z');
  o.payDateObj = payDate_(new Date(2026, 7, 5));
  o.payStampIso = payStamp_('2026-08-05T09:30:00.000Z');
  o.rowsBefore = readObjects_(paySh).length;

  // deleting: preview, refusal, and the real thing
  o.delPreview = handleDeletePayrollRow({ payrollId: 'PR-J1' });
  o.rowsAfterPreview = readObjects_(paySh).length;
  try { handleDeletePayrollRow({ payrollId: 'PR-K2', confirm: true }); o.deletePaid = 'ALLOWED'; }
  catch (e) { o.deletePaid = e && e.apiCode; }
  try { handleDeletePayrollRow({ payrollId: 'PR-NOPE', confirm: true }); o.deleteMissing = 'ALLOWED'; }
  catch (e) { o.deleteMissing = e && e.apiCode; }
  o.backupsBefore = readObjects_(sheet_(getMainSpreadsheet_(), 'BACKUP_LOG')).length;
  o.deleted = handleDeletePayrollRow({ payrollId: 'PR-J1', confirm: true, adminId: 'STF-ADM' });
  o.backupsAfter = readObjects_(sheet_(getMainSpreadsheet_(), 'BACKUP_LOG')).length;
  o.rowsAfter = readObjects_(paySh).length;
  o.joyLeft = readObjects_(paySh).filter(function (r) { return r.StaffID === 'STF-JOY'; })
    .map(function (r) { return r.PayrollID; }).sort();
  // ...and a paid row CAN be removed when the caller insists (the MANY_PAID case)
  o.forced = handleDeletePayrollRow({ payrollId: 'PR-K2', confirm: true, force: true, adminId: 'STF-ADM' });
  o.audit = readObjects_(sheet_(getHrSpreadsheet_(), 'AUDIT_LOG'))
    .map(function (a) { return String(a.Action || ''); }).filter(function (a) { return /PAYROLL_ROW_DELETE/.test(a); });
  return JSON.stringify(o);
}));

const g = n => (res.all.groups || []).find(x => x.staffId === 'STF-' + n) || {};

// ============================================================================
console.log('\n1) only a real duplicate is reported');
{
  eq('four people have one, and only four', res.all.count, 4);
  eq('...and the one with a single row per month is not among them',
    (res.all.groups || []).map(x => x.staffId).sort(), ['STF-FANG', 'STF-JOY', 'STF-KOI', 'STF-NID']);
  eq('a person with the same month twice is reported once, with all their rows', [g('JOY').count, g('JOY').rows.length], [4, 4]);
  // asking about one person, or one month, narrows it
  eq('asking about one teacher answers about that teacher', res.oneStaff.groups.map(x => x.staffId), ['STF-JOY']);
  eq('...and a month with no duplicates says so plainly', res.oneMonth.count, 0);
}

console.log('\n2) which one to keep, by rules that are written down');
{
  /* MONEY THAT MOVED BEATS EVERYTHING: the row somebody was paid against is the one the bank
   * statement agrees with, whatever the other rows say. */
  eq('a row that was PAID is the keeper', [g('KOI').keepId, g('KOI').reason], ['PR-K2', 'PAID']);
  // ...then the slip the teacher is actually holding
  eq('...then the slip that was SENT', [g('FANG').keepId, g('FANG').reason], ['PR-F2', 'SLIP_SENT']);
  /* Nothing paid, nothing sent: keep the one that is a full month's pay. PR-J3 grosses 14,435
   * against 13,950 for the two identical ones, so it is unambiguously the biggest. */
  eq('...then the only one with a full month’s pay', [g('JOY').keepId, g('JOY').reason], ['PR-J3', 'HIGHEST_GROSS']);
}

console.log('\n3) and where the rules cannot tell, they say so instead of guessing');
{
  /* A TOOL THAT GUESSES CONFIDENTLY ABOUT SOMEBODY'S PAY IS WORSE THAN ONE THAT ASKS. Two rows that
   * are identical to the last satang carry no information about which was meant; picking one and
   * calling it a recommendation would dress a coin toss up as an answer. */
  eq('two identical rows get no recommendation', [g('NID').keepId, g('NID').reason], ['', 'IDENTICAL']);
  ok_('...and the screen says a person has to decide', /ระบบไม่เลือกใบให้ เพราะกฎแยกไม่ออก/.test(app));
  ok_('...marking that group as the uncertain kind', /const unsure=\['MANY_PAID','MANY_SENT','IDENTICAL','ALL_EMPTY'\]/.test(app));
  ok_('every reason has words a person can read', ['PAID', 'SLIP_SENT', 'ONLY_REAL', 'HIGHEST_GROSS',
    'MANY_PAID', 'MANY_SENT', 'IDENTICAL', 'ALL_EMPTY'].every(k => new RegExp('\\b' + k + ':').test(app)));
}

console.log('\n4) what the totals are doing with them RIGHT NOW');
{
  /* Worth reporting, because the answer is "whichever landed first in the sheet" — which nobody
   * chose and which is usually not the row anyone would pick. */
  eq('the row the sheet-order readers use', g('JOY').currentlyUsedId, 'PR-J1');
  ok_('...which is not the one worth keeping', g('JOY').currentlyUsedId !== g('JOY').keepId);
  /* ...and the two places that ADD every duplicate instead of picking one. 200 + 200 from the two
   * identical rows is where a fund total quietly doubles. */
  eq('the fund adds every duplicate together', g('JOY').sumContribution, 400);
  ok_('the screen shows both numbers', /EN\(\)\?'Currently used by the totals':'ยอดต่างๆ ตอนนี้ใช้ใบ'/.test(app)
    && /EN\(\)\?'fund adds all':'เงินสมทบบวกทุกใบ'/.test(app));
}

console.log('\n5) deleting is a separate, careful step');
{
  eq('without confirm it only describes what it would remove', [res.delPreview.preview, res.delPreview.payrollId], [true, 'PR-J1']);
  eq('...and removes nothing', res.rowsAfterPreview, res.rowsBefore);
  /* A ROW SOMEBODY WAS PAID AGAINST IS REFUSED. It is the strongest evidence there is that the row
   * is the real one, and deleting it would leave the bank record pointing at nothing. */
  eq('a paid row is refused', res.deletePaid, 'ALREADY_PAID');
  eq('...and a row that does not exist', res.deleteMissing, 'NOT_FOUND');
  ok_('a backup is taken before the row goes', res.backupsAfter > res.backupsBefore);
  ok_('...and the reply says which copies', !!(res.deleted.backup && res.deleted.backup.hr));
  eq('the row is gone', res.rowsAfter, res.rowsBefore - 1);
  eq('...and only that row', res.joyLeft, ['PR-J2', 'PR-J3', 'PR-J4']);
  // the MANY_PAID case — two rows both claim to be paid, so somebody has to be able to say which
  ok_('a paid row can still be removed when the caller insists', !!res.forced.ok);
  ok_('every deletion is on the record', res.audit.length >= 2);
  ok_('...and the forced one is marked as such', payGs.indexOf("(forced ? ' FORCED' : '')") > 0);
}

console.log('\n6) a clean result is still a result');
{
  /* Reported 2026-08-30: "กดตรวจหาสลิปเงินเดือนซ้ำ ไม่ขึ้น มีแค่ข้อความบอกว่าสำเร็จ แต่ไม่มีข้อมูล
   * อะไรขึ้นมาเลย". The finder answered with a toast and opened nothing, which looks exactly like a
   * tool that failed — and the admin had reason to doubt it, having been told days earlier that
   * ครูจอย had four rows for July. A diagnostic that reports "nothing wrong" without saying WHAT IT
   * LOOKED AT is not evidence of anything. */
  eq('nobody duplicated → no groups', res.clean.count, 0);
  ok_('...but it still says how many rows it read', Number(res.all.scanned.rows) >= 13);
  // the five teachers. STF-GHOST's only row has no month, so it is skipped before it can be placed
  // — it shows up in skippedNoMonth below rather than as a sixth person with nothing under them.
  eq('...how many people', res.all.scanned.staff, 5);
  eq('...and the months it covers', [res.all.scanned.from, res.all.scanned.to], ['2026-07', '2026-08']);
  // the scan is reported even when the SEARCH was narrowed, or the summary would contradict itself
  ok_('a filtered search still reports the whole scan', res.clean.scanned.rows === res.all.scanned.rows);
  ok_('...and still names the person who does have duplicates',
    res.clean.scanned.perStaff.some(x => x.nick === 'JOY' && x.dupMonths.indexOf('2026-07') >= 0));
  eq('a person with one slip a month has no duplicate months',
    res.all.scanned.perStaff.find(x => x.nick === 'BEE').dupMonths, []);
  eq('...and their row count is still shown', res.all.scanned.perStaff.find(x => x.nick === 'BEE').rows, 2);
  /* A ROW IT CANNOT PLACE IS A HOLE IN THE SCAN, not something to drop quietly. */
  eq('a row with no staff id is counted as skipped', res.all.scanned.skippedNoStaff, 1);
  eq('...and one with no month too', res.all.scanned.skippedNoMonth, 1);
  ok_('the screen opens on a clean result instead of firing a toast and nothing else',
    /🗂️ \$\{EN\(\)\?'What was checked':'ตรวจจากข้อมูลอะไรบ้าง'\}/.test(app)
    && /พนักงานทุกคนมีสลิปเดือนละไม่เกิน 1 ใบ/.test(app));
  ok_('...and warns when rows could not be placed', /แถวที่ระบุไม่ได้/.test(app));
  ok_('the reason is written where the code is', /A CLEAN RESULT IS STILL A RESULT/.test(app));
}

console.log('\n7) the two date helpers — \\d, not d');
{
  /* These shipped with the backslashes lost from BOTH regexes, so they matched the literal letter d
   * and never a date. payDate_ fell through to String(v), which put a raw
   * "Sat Aug 01 2026 00:00:00 GMT+0700 (Indochina Time)" on the duplicate screen next to a figure
   * somebody was paid. Nothing failed loudly; it just printed a machine string at a person. */
  eq('a plain date passes through', res.payDateStr, '2026-08-05');
  eq('an ISO stamp is cut to the date', res.payDateIso, '2026-08-05');
  eq('a real Date object too', res.payDateObj, '2026-08-05');
  ok_('...none of them leak a raw JS date string', !/GMT|\(.*Time\)/.test(String(res.payDateIso) + res.payDateObj));
  ok_('a timestamp keeps the time, and is not an ISO string', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(res.payStampIso));
  // the source itself, so a future edit through a shell cannot eat them again unnoticed
  ok_('the regexes have their backslashes', /\/\^\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\//.test(payGs)
    && /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\//.test(payGs));
  ok_('...with a note saying why that matters', /\\d, not d\./.test(payGs));
}

console.log('\n8) the wiring, and where a person finds it');
{
  ok_('both routes exist', /payrollDuplicates: function \(p\)/.test(codeGs) && /deletePayrollRow:  function \(p\)/.test(codeGs));
  ok_('...and are admin-only', /payrollDuplicates: 1, deletePayrollRow: 1,/.test(codeGs));
  /* "deletePayrollRow" starts with a mutating verb, so the classifier already calls it a write —
   * unlike payrollDuplicates, which only reads and must not take the write lock. */
  ok_('the finder is not mistaken for a write', !/payrollDuplicates: 1/.test(R('webapp/api.js')));
  ok_('there is a button for it', /onclick="A_payrollDups\(this\)"/.test(app));
  /* ABOVE the fund tools in the settings list on purpose: the provident-fund total is COMPUTED FROM
   * these rows, so clearing a total while the duplicates are still there rebuilds it wrong. */
  ok_('...placed with the reason written down', /the fund is COMPUTED FROM these rows/.test(app));
  ok_('the cause is recorded where the fix lives', /appending a DUPLICATE on each press/.test(payGs));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
