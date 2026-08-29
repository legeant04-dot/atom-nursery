/**
 * tools/test_contrib_reset.js — starting one person's provident fund again from zero.
 *   node tools/test_contrib_reset.js
 *
 * ครูจอย's เงินสมทบ was entered wrong and the school wants to key it in correctly from today
 * (asked 2026-08-29, answered "ล้างยอดยกมา + ล้างเงินสมทบในสลิปเก่าทุกเดือน").
 *
 * WHY IT CANNOT SIMPLY BE RECOMPUTED: recomputeContributions rebuilds the running total FROM the
 * monthly payroll rows. If those rows are wrong, recomputing puts the wrong answer straight back.
 * Every month compounds the last, so the only honest fix is zero and re-enter.
 *
 * THIS DELETES REAL MONEY FIGURES, so the suite is mostly about the guard rails:
 *
 *   1. PREVIEW WRITES NOTHING. The default call reads and reports; only confirm:true touches a cell.
 *   2. THE BACKUP COMES FIRST, and a backup that throws ABORTS — a destructive change with no way
 *      back is not one worth making faster.
 *   3. THE ARITHMETIC. เงินสมทบ is a DEDUCTION, so removing it LOWERS total deductions and RAISES
 *      net pay. Getting the sign wrong here would silently rewrite what every past month says it
 *      paid — this is the school's own rule: "เรื่องเงินเป็นเรื่องละเอียดและสำคัญมาก".
 *   4. ONE PERSON. Nobody else's figures move, ever.
 */
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));
const fs = require('fs');

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
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup']);
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var HR = getHrSpreadsheet_();
  var stSh = sheet_(HR, 'STAFF'), paySh = sheet_(HR, 'PAYROLL');
  ensureColumns_(stSh, ['ContributionOpening', 'ContributionAccum', 'ContributionLocked']);
  ensureColumns_(paySh, ['ContributionEmployer', 'ContributionAccum', 'StaffName']);

  appendObject_(stSh, { StaffID: 'STF-JOY', Name: 'ครูจอย', Role: 'Teacher', PositionLevel: 'Staff',
    Status: 'ACTIVE', BaseSalary: 15000, ContributionOpening: 4000, ContributionAccum: 12800 });
  appendObject_(stSh, { StaffID: 'STF-KOI', Name: 'ครูก้อย', Role: 'Teacher', PositionLevel: 'Staff',
    Status: 'ACTIVE', BaseSalary: 14000, ContributionOpening: 2500, ContributionAccum: 7300 });

  // three months for ครูจอย: 200 deducted, matched 1:1 by the school. Two slips already sent.
  var mk = function (id, sid, month, contrib, emp, ded, net, sent) {
    appendObject_(paySh, { PayrollID: id, StaffID: sid, Month: month, BaseSalary: 15000,
      GrossIncome: 15000, SocialSecurity: 750, Contribution: contrib, ContributionEmployer: emp,
      OtherDeductions: 0, TotalDeductions: ded, NetPay: net, Status: 'PAID', SlipSent: sent });
  };
  mk('PR-001', 'STF-JOY', '2026-06', 200, 200, 950, 14050, 'YES');
  mk('PR-002', 'STF-JOY', '2026-07', 200, 200, 950, 14050, 'YES');
  mk('PR-003', 'STF-JOY', '2026-08', 300, 300, 1050, 13950, 'NO');
  /* A SECOND SLIP FOR JULY. Not invented for the test: the live preview showed FOUR rows for one
   * month on a real teacher, which would count that month twice in the school's expenses. */
  mk('PR-004', 'STF-JOY', '2026-07', 0, 0, 750, 500, 'NO');
  mk('PR-010', 'STF-KOI', '2026-08', 500, 500, 1250, 12750, 'YES');

  var o = {};
  // ---- 1. preview: reads, reports, writes nothing ----
  o.preview = handleContributionReset({ staffId: 'STF-JOY', adminId: 'STF-ADM' });
  o.afterPreview = {
    staff: findObject_(stSh, function (x) { return x.StaffID === 'STF-JOY'; }),
    rows: readObjects_(paySh).filter(function (r) { return r.StaffID === 'STF-JOY'; })
      .map(function (r) { return { m: ym7_(r.Month), c: Number(r.Contribution), net: Number(r.NetPay) }; })
  };
  o.afterPreview.staff = { opening: Number(o.afterPreview.staff.ContributionOpening),
                           accum: Number(o.afterPreview.staff.ContributionAccum) };
  o.backupsBefore = readObjects_(sheet_(getMainSpreadsheet_(), 'BACKUP_LOG')).length;

  // ---- 2. apply ----
  o.applied = handleContributionReset({ staffId: 'STF-JOY', confirm: true, adminId: 'STF-ADM' });
  var st2 = findObject_(stSh, function (x) { return x.StaffID === 'STF-JOY'; });
  o.after = { opening: Number(st2.ContributionOpening), accum: Number(st2.ContributionAccum) };
  o.joyRows = readObjects_(paySh).filter(function (r) { return r.StaffID === 'STF-JOY'; })
    .sort(function (a, b) { return ym7_(a.Month).localeCompare(ym7_(b.Month)); })
    .map(function (r) { return { m: ym7_(r.Month), c: Number(r.Contribution), e: Number(r.ContributionEmployer),
      ded: Number(r.TotalDeductions), net: Number(r.NetPay) }; });
  // nobody else moved
  var koi = findObject_(stSh, function (x) { return x.StaffID === 'STF-KOI'; });
  var koiRow = findObject_(paySh, function (r) { return r.PayrollID === 'PR-010'; });
  o.koi = { opening: Number(koi.ContributionOpening), accum: Number(koi.ContributionAccum),
            c: Number(koiRow.Contribution), net: Number(koiRow.NetPay) };
  o.backupsAfter = readObjects_(sheet_(getMainSpreadsheet_(), 'BACKUP_LOG')).length;
  // logAuditHr writes to AUDIT_LOG in the HR workbook (see Audit.gs), not to a separate sheet
  o.audit = readObjects_(sheet_(getHrSpreadsheet_(), 'AUDIT_LOG'))
    .map(function (a) { return String(a.Action || ''); }).filter(function (a) { return /CONTRIB_RESET/.test(a); });

  // ---- 3. a staff member who does not exist ----
  try { handleContributionReset({ staffId: 'STF-NOPE' }); o.missing = 'ALLOWED'; }
  catch (e) { o.missing = e && e.apiCode; }
  try { handleContributionReset({}); o.noId = 'ALLOWED'; }
  catch (e) { o.noId = e && e.apiCode; }
  // ---- 3b. a SETTABLE opening, and the two things the live preview turned up ----
  // ครูก้อย gets the same treatment, but starting from a figure the school types in
  o.koiPreview = handleContributionReset({ staffId: 'STF-KOI', adminId: 'STF-ADM' });
  o.koiSet = handleContributionReset({ staffId: 'STF-KOI', confirm: true, newOpening: 35800, adminId: 'STF-ADM' });
  var koi2 = findObject_(stSh, function (x) { return x.StaffID === 'STF-KOI'; });
  o.koiAfterSet = { opening: Number(koi2.ContributionOpening), accum: Number(koi2.ContributionAccum) };
  o.koiRowAccum = Number(findObject_(paySh, function (r) { return r.PayrollID === 'PR-010'; }).ContributionAccum);
  try { handleContributionReset({ staffId: 'STF-KOI', confirm: true, newOpening: -5 }); o.negative = 'ALLOWED'; }
  catch (e) { o.negative = e && e.apiCode; }
  try { handleContributionReset({ staffId: 'STF-KOI', confirm: true, newOpening: 'abc' }); o.notANumber = 'ALLOWED'; }
  catch (e) { o.notANumber = e && e.apiCode; }

  // ---- 4. running it twice is harmless ----
  o.twice = handleContributionReset({ staffId: 'STF-JOY', confirm: true, adminId: 'STF-ADM' });
  var st3 = findObject_(stSh, function (x) { return x.StaffID === 'STF-JOY'; });
  o.afterTwice = { opening: Number(st3.ContributionOpening), accum: Number(st3.ContributionAccum) };
  o.joyNetTwice = readObjects_(paySh).filter(function (r) { return r.StaffID === 'STF-JOY'; })
    .map(function (r) { return Number(r.NetPay); }).sort();
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) the preview reads and reports, and writes nothing at all');
{
  const p = res.preview;
  eq('it says so', p.preview, true);
  eq('the opening balance as it stands', p.before.opening, 4000);
  eq('...and the accumulated total', p.before.accum, 12800);
  eq('...and how many months are on file', p.before.payrollRows, 4);
  eq('...and what was deducted and matched', [p.before.sumEmployee, p.before.sumEmployer], [700, 700]);
  /* THE PART THAT MUST NOT BE BURIED: two of those slips have already been handed over, and their
   * net pay is about to change. The screen shows this in red above the confirm button. */
  eq('...and how many slips have already gone out', p.slipsAlreadySent, 2);
  eq('nothing was written to the staff record', res.afterPreview.staff, { opening: 4000, accum: 12800 });
  eq('...nor to any payslip', res.afterPreview.rows.map(r => r.c), [200, 200, 300, 0]);
}

console.log('\n2) the arithmetic — เงินสมทบ is a DEDUCTION');
{
  /* Remove a 200 deduction and the month owes 200 LESS, so it PAYS 200 more. Getting this sign
   * wrong would rewrite what every past month says it paid, in the wrong direction, silently. */
  const j = res.preview.months;
  eq('June: 950 deductions become 750', [j[0].totalDeductions, j[0].newTotalDeductions], [950, 750]);
  eq('...so net pay RISES from 14,050 to 14,250', [j[0].netPay, j[0].newNetPay], [14050, 14250]);
  eq('...by exactly the contribution', j[0].netPayChange, 200);
  // rows come back sorted by month, so the second July (the duplicate, with no contribution) is [2]
  eq('the duplicate July, which has no contribution, does not move', [j[2].netPay, j[2].newNetPay, j[2].netPayChange], [500, 500, 0]);
  eq('August, where the figure was 300', [j[3].netPay, j[3].newNetPay, j[3].netPayChange], [13950, 14250, 300]);
  // and the write agrees with the preview, because both are computed from the same array
  eq('the rows written match the preview', res.joyRows.map(r => r.net), [14250, 14250, 500, 14250]);
  eq('...with the deductions lowered to match', res.joyRows.map(r => r.ded), [750, 750, 750, 750]);
}

console.log('\n3) what it actually cleared');
{
  eq('the opening balance is zero', res.after.opening, 0);
  eq('...and the accumulated total', res.after.accum, 0);
  eq('every month’s own half is zero', res.joyRows.map(r => r.c), [0, 0, 0, 0]);
  eq('...and the school’s matching half too', res.joyRows.map(r => r.e), [0, 0, 0, 0]);
  eq('the reply reports the figures afterwards, read back rather than assumed',
    [res.applied.after.opening, res.applied.after.accum, res.applied.after.sumEmployee, res.applied.after.sumEmployer], [0, 0, 0, 0]);
  ok_('...and it is on the record', res.audit.length >= 1);
}

console.log('\n3b) zero is the DEFAULT, not the only answer');
{
  /* The live preview is what proved this was needed: 35,800 stored against 400 in the payslips is a
   * real balance the school knows and the sheet cannot derive. Wiping it to nothing throws it away. */
  eq('a figure typed in becomes the opening balance', res.koiAfterSet.opening, 35800);
  eq('...and the running total starts there, not at zero', res.koiAfterSet.accum, 35800);
  /* Every monthly row was just zeroed, so each month's running total IS the opening — leaving them
   * at 0 would print a fund of nothing on an old slip for somebody carrying a real balance. */
  eq('...and each month’s stored total says so too', res.koiRowAccum, 35800);
  eq('a negative opening is refused', res.negative, 'BAD_INPUT');
  eq('...and so is something that is not a number', res.notANumber, 'BAD_INPUT');
  eq('blank still means zero — the default is unchanged', res.after.opening, 0);
}

console.log('\n3c) the two things the live data turned up, reported rather than left to be spotted');
{
  const b = res.preview.before;
  /* accum should be opening + Σ(own + employer). On ครูจอย it was 35,800 against 400 of payslip
   * contributions and an opening of 0 — a gap of 35,400 that exists nowhere the system can see, and
   * the reason recomputeContributions would have QUIETLY LOST it (it would rebuild 800). */
  eq('what the total would be if rebuilt from the rows', b.derivedAccum, 4000 + 700 + 700);
  eq('...and the part that cannot be explained by them', b.unexplained, 12800 - 5400);
  // ...and more than one payslip for the same month, which double-counts the month's expense
  eq('a month with two payslips is named', res.preview.duplicateMonths, ['2026-07']);
  eq('...and a person with none reports none', res.koiPreview.duplicateMonths, []);
  ok_('the screen highlights those rows', /dups\.indexOf\(x\.month\)>=0\?' style="background:var\(--warn-bg\)"':''/.test(app));
  ok_('...and says what it means for the payroll about to be run', /รายจ่ายของโรงเรียนจะถูกนับซ้ำ/.test(app));
  /* NEVER MERGED AUTOMATICALLY. Deciding which of four July slips is the real one is not something
   * to guess at, and deleting a payslip is not this tool's job. */
  ok_('...without deleting anything', /เครื่องมือนี้ไม่ลบสลิปให้/.test(app));
  ok_('the payroll id is shown, so the row can be found in the sheet', /esc\(x\.payrollId\|\|''\)/.test(app));
}

console.log('\n4) one person, and only that person');
{
  eq('ครูก้อย’s opening balance is untouched', res.koi.opening, 2500);
  eq('...her accumulated total too', res.koi.accum, 7300);
  eq('...and her payslip', [res.koi.c, res.koi.net], [500, 12750]);
  eq('a staff member who does not exist is refused', res.missing, 'NOT_FOUND');
  eq('...and so is no id at all', res.noId, 'BAD_INPUT');
}

console.log('\n5) the backup, which is the only way back');
{
  /* dailyBackup() copies the WHOLE of MAIN and HR into the backup folder and logs each copy. It runs
   * before the first cell is touched, and if it throws the handler aborts having written nothing. */
  ok_('a backup was taken', res.backupsAfter > res.backupsBefore);
  ok_('...and the reply says which copies', !!res.applied.backup && !!res.applied.backup.main && !!res.applied.backup.hr);
  ok_('the preview took none — it changes nothing, so there is nothing to protect',
    res.backupsBefore === 0 || res.preview.backup === undefined);
  ok_('it is taken BEFORE the first write', payGs.indexOf('backup = dailyBackup();') < payGs.indexOf('Contribution: 0, ContributionEmployer: 0'));
  ok_('...and a failed backup aborts rather than proceeding',
    /catch \(e\) \{ throw apiError_\('BACKUP_FAILED'[\s\S]{0,120}จึงยังไม่ได้แก้ไขอะไรเลย/.test(payGs));
}

console.log('\n6) running it again is harmless');
{
  // an operation that is dangerous to repeat is one somebody will repeat
  eq('the second run finds nothing left to clear', res.afterTwice, { opening: 0, accum: 0 });
  eq('...and does not move net pay a second time', res.joyNetTwice, [14250, 14250, 14250, 500]);
}

console.log('\n7) the screen makes the second press a different press');
{
  ok_('the route is admin-only', /recomputeContributions: 1, contributionReset: 1,/.test(codeGs));
  ok_('the preview is what opens', /api\('contributionReset',\{staffId:sid,adminId:USER\.staffId\}\)/.test(app));
  ok_('...and applying is a separate call with confirm', /api\('contributionReset',\{staffId:sid,confirm:true,newOpening:opening,adminId:USER\.staffId\}\)/.test(app));
  ok_('...carrying the figure the school typed in', /const opening=String\(\(m\.querySelector\('#crOpening'\)\|\|\{\}\)\.value\|\|''\)\.trim\(\);/.test(app));
  ok_('the button says which of the two it will do before it is pressed', /window\.CR_openHint=\(\)=>/.test(app));
  /* THE CONFIRMATION IS THE NAME, not the word "yes": somebody typing "ครูจอย" cannot be halfway
   * through resetting a different teacher by accident. */
  /* THE CONFIRMATION MUST NOT FAIL INVISIBLY.
   *
   * Reported 2026-08-29: "กดบันทึกไม่ได้", with a screenshot showing the name typed correctly and the
   * button doing nothing. The stored name carried a DOUBLE SPACE — invisible on screen — and the
   * first version compared the two strings exactly, so a correctly-typed name was rejected with only
   * a toast that said "type it correctly". Reproduced in a browser before it was changed.
   *
   * Two names that LOOK the same now ARE the same, and the button says whether it is armed.
   */
  ok_('the name still has to be typed', /crNameKey\(inp\.value\)!==crNameKey\(inp\.dataset\.name\)/.test(app));
  ok_('...but invisible whitespace cannot make it fail', /const crNameKey = s => String\(s==null\?'':s\)\.replace\(\/\\s\+\/g,' '\)\.trim\(\)\.toLowerCase\(\);/.test(app));
  ok_('...and the button is visibly locked until it matches', /<button class="btn block pink" id="crGo" disabled/.test(app));
  ok_('...saying which of the three states it is in', /✓ ชื่อตรงแล้ว/.test(app) && /✗ ชื่อยังไม่ตรง/.test(app)
    && /พิมพ์ชื่อด้านบนให้ตรงเพื่อปลดล็อกปุ่ม/.test(app));
  ok_('...checked as you type', /oninput="CR_checkName\(\)"/.test(app) && /window\.CR_checkName=\(\)=>/.test(app));
  // behaviour, run rather than read: the comparison itself
  {
    const src = /const crNameKey = (s => [^;]+);/.exec(app);
    const crNameKey = eval('(' + src[1] + ')');
    const same = (a, b) => crNameKey(a) === crNameKey(b);
    ok_('a double space in the stored name still matches', same('อารียา  จิตร์สุวรรณ', 'อารียา จิตร์สุวรรณ'));
    ok_('...a tab too', same('อารียา\tจิตร์สุวรรณ', 'อารียา จิตร์สุวรรณ'));
    ok_('...and leading or trailing space', same('  อารียา จิตร์สุวรรณ ', 'อารียา จิตร์สุวรรณ'));
    ok_('...and a difference of case in a Latin name', same('Kru Joy', 'kru joy'));
    /* AND IT STILL REFUSES A DIFFERENT PERSON, which is the whole point of asking. */
    ok_('a different teacher does NOT match', !same('อารียา จิตร์สุวรรณ', 'ปริณดา สว่างจิต'));
    ok_('...nor half the name', !same('อารียา จิตร์สุวรรณ', 'อารียา'));
    ok_('...nor an empty box', !same('อารียา จิตร์สุวรรณ', ''));
  }
  ok_('the button is targeted by id, not by "the last pink one"', /const b=document\.getElementById\('crGo'\); if\(!b\) return;/.test(app));
  ok_('the reset does not reuse the broom, which already means a meeting day', !/♻️[sS]{0,4000}🧹/.test(app));
  ok_('the month-by-month table is shown before it', /EN\(\)\?'Net after':'สุทธิใหม่'/.test(app));
  ok_('...and the already-sent slips are called out in red', /มีสลิปที่ส่งให้พนักงานไปแล้ว/.test(app)
    && /สลิปที่คำนวณใหม่จะไม่ตรงกับกระดาษที่ส่งให้คุณครูไปแล้ว/.test(app));
  ok_('...and the backup is promised in writing', /หากสำรองไม่สำเร็จ จะไม่มีการแก้ไขใดๆ เลย/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
