/**
 * tools/test_pay_adjust.js — approving a payslip, and changing what somebody is paid.
 *   node tools/test_pay_adjust.js
 *
 * Two features that share one property: they are the moments this app touches a person's livelihood.
 *
 *   · APPROVE (2026-10-05, "ให้ Approve ข้อมูลก่อนจะบันทึกให้คุณครู") — saving used to publish. The
 *     instant an admin pressed บันทึก the slip was on the teacher's screen, including a half-finished
 *     one saved to come back to. A teacher reading a number about their own pay and then watching it
 *     change is the fastest way to lose their trust in all of it.
 *
 *   · ADJUST (2026-10-05, "ปรับเงินเดือน/ตำแหน่ง/เบี้ยต่างๆ ... เก็บประวัติพร้อมเหตุผล") — the figures
 *     were editable in three different places and nowhere recorded WHY.
 *
 * The section that matters most is §3: the migration. This column did not exist yesterday, and every
 * slip teachers have already read has no value in it — so the gate must not make months of their own
 * payslips vanish on release day.
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const got = (e && e.code) || ''; const ok = !code || got === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + got); ok ? pass++ : fail++; }
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), engine = R('webapp/engine.js'), adjGs = R('src/PayAdjust.gs'),
      payGs = R('src/Payroll.gs'), codeGs = R('src/Code.gs'), cfgGs = R('src/Config.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const adjCode = adjGs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function school() {
  const M = {
    staff: [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูเอ', Nickname: 'เอ', Role: 'Teacher', Position: 'ครูผู้ช่วย',
        PositionLevel: 'Staff', Status: 'ACTIVE', BaseSalary: 14300 },
      { StaffID: 'T2', NameTH: 'ครูบี', Role: 'Teacher', Status: 'ACTIVE', BaseSalary: 13000 }
    ],
    payrollConfig: { T1: { DiligenceAttendanceAmount: 500 } },
    payroll: [], payAdjustments: [], staffGroups: [], leaves: [], otRecords: [],
    students: [], parents: [], activityLog: [], userLinks: [], config: { ContributionMatchRate: 1 }
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================================
console.log('1) saving records; APPROVING publishes');
// ============================================================================================
{
  const { M, H } = school();
  H.computePayroll({ staffId: 'T1', month: '2026-06', baseSalary: 14300 });

  /* `role` is stamped by applyIdentity_ on every non-admin session and never on an admin's — the
   * same test handleComputePayroll uses to decide who may persist. */
  eq('🔴 a saved slip is NOT on the teacher’s screen yet', H.getPayslip({ staffId: 'T1', month: '2026-06', role: 'Teacher' }), null);
  ok_('...while the admin can see it, because they are the one checking it', !!H.getPayslip({ staffId: 'T1', month: '2026-06' }));
  eq('...and it is not in their list of payslips either', H.myPayslipMonths({ staffId: 'T1' }).count, 0);

  H.approvePayslip({ staffId: 'ADM', targetId: 'T1', month: '2026-06', adminId: 'ADM' });
  ok_('🔴 approving is what puts it in front of them', !!H.getPayslip({ staffId: 'T1', month: '2026-06', role: 'Teacher' }));
  eq('...and into their list', H.myPayslipMonths({ staffId: 'T1' }).count, 1);

  /* 🔴 RECALCULATING WITHDRAWS THE APPROVAL. A slip that was signed off and then recomputed is not
   * the slip that was signed off, and leaving it visible would show a teacher new figures under an
   * old signature — worse than having no gate at all. */
  H.computePayroll({ staffId: 'T1', month: '2026-06', baseSalary: 15000 });
  eq('🔴 recalculating after approval takes it back off their screen',
    H.getPayslip({ staffId: 'T1', month: '2026-06', role: 'Teacher' }), null);

  // ...and withdrawing by hand is allowed, because that is the honest way to correct a mistake
  H.approvePayslip({ staffId: 'ADM', targetId: 'T1', month: '2026-06', adminId: 'ADM' });
  H.approvePayslip({ staffId: 'ADM', targetId: 'T1', month: '2026-06', approve: false, adminId: 'ADM' });
  /* 🔴 WITHDRAWING MUST WRITE AN EXPLICIT 'NO'. Clearing the field made the slip look like a row
   * from before the column existed — which §3 grandfathers — and put it straight back on the
   * teacher's screen. Found by this assertion, not by reading the code. */
  eq('🔴 an approval can be withdrawn, and the slip really goes away', H.getPayslip({ staffId: 'T1', month: '2026-06', role: 'Teacher' }), null);
  ok_('...and both directions are on the activity log',
    (M.activityLog || []).filter(a => /approvePayslip/.test(JSON.stringify(a))).length === 3);
  throws_('approving a month with no slip is refused, not silently created',
    () => H.approvePayslip({ staffId: 'ADM', targetId: 'T1', month: '2026-12' }), 'NOT_FOUND');
}

// ============================================================================================
console.log('2) ปรับเงินเดือน / ตำแหน่ง / เบี้ย — applied, and written down');
// ============================================================================================
{
  const { M, H } = school();
  const r = H.adjustStaffPay({ staffId: 'ADM', targetId: 'T1', baseSalary: 15500,
    position: 'ครูประจำชั้น', diligenceAttend: 1000, reason: 'ประเมินประจำปี 2569' });

  eq('three things changed, so three things are recorded', r.changes.length, 3);
  eq('🔴 the salary really moved, where every other screen reads it', M.staff[1].BaseSalary, 15500);
  eq('...and the position with it', M.staff[1].Position, 'ครูประจำชั้น');
  eq('🔴 ...and the allowance, in PAYROLL_CONFIG where payroll reads it',
    M.payrollConfig.T1.DiligenceAttendanceAmount, 1000);

  const h = H.payAdjustHistory({ staffId: 'ADM', targetId: 'T1' });
  eq('the history has one row per FIELD, not one per press', h.length, 3);
  eq('...each carrying what it was and what it became',
    h.filter(x => x.field === 'BaseSalary').map(x => x.from + '→' + x.to), ['14300→15500']);
  eq('...and the reason, on every one of them', h.every(x => x.reason === 'ประเมินประจำปี 2569'), true);
  eq('...and who decided it', h[0].by, 'แอดมิน');

  /* A HISTORY FULL OF "14300 → 14300" IS A HISTORY NOBODY READS. */
  throws_('🔴 a save that changes nothing is refused rather than logged',
    () => H.adjustStaffPay({ staffId: 'ADM', targetId: 'T1', baseSalary: 15500, reason: 'ซ้ำ' }), 'NO_CHANGE');
  eq('...and the history did not grow', H.payAdjustHistory({ staffId: 'ADM', targetId: 'T1' }).length, 3);
  // a blank field means "leave this alone", which is why the form starts empty
  const r2 = H.adjustStaffPay({ staffId: 'ADM', targetId: 'T1', position: 'หัวหน้าครู', reason: 'เลื่อนตำแหน่ง' });
  eq('an untouched field writes nothing', r2.changes.map(c => c.field), ['Position']);
  eq('...and the salary is exactly where it was', M.staff[1].BaseSalary, 15500);

  throws_('a reason is required — the whole point is knowing why',
    () => H.adjustStaffPay({ staffId: 'ADM', targetId: 'T1', baseSalary: 16000 }), 'BAD_INPUT');
  throws_('a negative salary is refused', () =>
    H.adjustStaffPay({ staffId: 'ADM', targetId: 'T1', baseSalary: -1, reason: 'x' }), 'BAD_INPUT');
  throws_('🔴 a teacher cannot give themselves a rise',
    () => H.adjustStaffPay({ staffId: 'T1', targetId: 'T1', baseSalary: 99999, reason: 'x' }), 'NO_PERMISSION');
  throws_('...nor adjust a colleague',
    () => H.adjustStaffPay({ staffId: 'T1', targetId: 'T2', baseSalary: 99999, reason: 'x' }), 'NO_PERMISSION');
  eq('CONTROL — the colleague’s salary is untouched', M.staff[2].BaseSalary, 13000);
  /* A teacher MAY read their own trail: seeing that the rise was "ประเมินประจำปี" and who signed it
   * is the part of this that builds trust. */
  ok_('a teacher may read their own history', H.payAdjustHistory({ staffId: 'T1' }).length > 0);
  throws_('...but not a colleague’s', () => H.payAdjustHistory({ staffId: 'T1', targetId: 'T2' }), 'NO_PERMISSION');
}

// ============================================================================================
console.log('3) 🔴 THE MIGRATION — months of slips teachers have already read');
// ============================================================================================
{
  /* The Approved column did not exist yesterday. Every payslip on the live sheet has no value in it,
   * and those are slips teachers have opened, downloaded and taken to banks. A gate written as
   * "hide unless YES" would have emptied every teacher's payslip screen on the day this shipped.
   *
   * So the gate hides only an EXPLICIT 'NO', which computePayroll writes on every save from now on.
   * Self-migrating, and the failure direction is the safe one: if the column somehow does not write,
   * slips behave exactly as they did yesterday rather than everyone being locked out of their own.
   */
  const { M, H } = school();
  M.payroll.push({ PayrollID: 'OLD', StaffID: 'T1', Month: '2026-05', NetPay: 9000, Contribution: 0 });

  ok_('🔴 a slip written before the column existed is still visible to the teacher',
    !!H.getPayslip({ staffId: 'T1', month: '2026-05', role: 'Teacher' }));
  eq('🔴 ...and still in their list of payslips', H.myPayslipMonths({ staffId: 'T1' }).count, 1);

  // ...while anything saved from now on is gated
  H.computePayroll({ staffId: 'T1', month: '2026-06', baseSalary: 14300 });
  eq('a slip saved today is gated', H.getPayslip({ staffId: 'T1', month: '2026-06', role: 'Teacher' }), null);
  eq('...so the old one is still the only one they can see', H.myPayslipMonths({ staffId: 'T1' }).count, 1);

  ok_('the gate is written as "hide only an explicit NO", on both sides',
    /toUpperCase\(\)==='NO'\) return null;/.test(engine) && /toUpperCase\(\) === 'NO'\) return null;/.test(payGs));
  ok_('...and saving is what writes that NO', /rec\.Approved='NO'/.test(engine) && /rec\.Approved = 'NO'/.test(payGs));
  ok_('...with the column created first, or it would never land', /ensureColumns_\(sheet, \['Approved', 'ApprovedBy', 'ApprovedAt'\]\)/.test(payGs));
}

// ============================================================================================
console.log('4) the live path, and why it has to exist');
// ============================================================================================
{
  /* STAFF and PAYROLL are written by the engine as WHOLE COLLECTIONS, and STAFF is in
   * NO_SHRINK_SHEETS besides: a pay rise through a collection rewrite would carry every other row
   * with it, read from whatever that request happened to hydrate. */
  ok_('STAFF is still shrink-protected', /NO_SHRINK_SHEETS = \{[^}]*STAFF: 1/.test(R('src/GasEngine.gs')));
  ok_('the salary is written one row at a time', /updateRow_\(stSh, st\._row, staffPatch\)/.test(adjCode));
  ok_('...and so is the allowance', /updateRow_\(pcSh, pcRow\._row, cfgPatch\)/.test(adjCode));
  ok_('...and the approval', /updateRow_\(sh, row\._row, \{ Approved:/.test(adjCode));
  ok_('every trail row is appended, never rewritten', /rows\.forEach\(function \(r\) \{ appendObject_\(adjSh, r\); \}\)/.test(adjCode));
  ok_('the routes are wired up', /approvePayslip:\s*function/.test(codeGs) && /adjustStaffPay:\s*function/.test(codeGs));
  ok_('🔴 approving and adjusting are admin-only',
    /ADMIN_ONLY = \{ approvePayslip: 1, adjustStaffPay: 1/.test(codeGs));
  ok_('...and reading your own history is NOT, or a teacher could never see it',
    !/ADMIN_ONLY[\s\S]{0,400}payAdjustHistory: 1/.test(codeGs));
  ok_('the columns are declared, or writeRows_ drops them in silence',
    /'Approved', 'ApprovedBy', 'ApprovedAt'/.test(cfgGs) && /PAY_ADJUSTMENTS: \['AdjID'/.test(cfgGs));
  ok_('...and the trail sheet is in the collection map', /payAdjustments:\s*\{ wb: 'HR'/.test(R('src/GasEngine.gs')));
  ok_('the route refuses a no-op the same way the engine does', /NO_CHANGE/.test(adjCode));
  ok_('...and requires a reason', /กรุณาระบุเหตุผลของการปรับ/.test(adjGs));
}

// ============================================================================================
console.log('5) the screens');
// ============================================================================================
{
  ok_('the payroll screen can show the slip as the TEACHER sees it', /A_slipPreview = async/.test(appCode));
  ok_('🔴 ...drawn by the same function their screen uses, so it cannot drift',
    /A_slipPreview[\s\S]{0,700}payslipCard\(r\)/.test(appCode));
  ok_('a saved slip says whether the teacher can see it yet', /ยังไม่อนุมัติ · คุณครูยังไม่เห็น/.test(app));
  ok_('...and approving says what it just did', /คุณครูเห็นสลิปได้แล้ว/.test(app));
  ok_('...and withdrawing asks first', /A_slipApprove[\s\S]{0,300}confirm\(/.test(appCode));
  ok_('the card appears on a reopened month too, not only after calculating',
    /payslipCard\(saved\)[\s\S]{0,200}slipApproveCard\(saved\)/.test(appCode));

  ok_('the annual review is on ดำเนินการ', /'A_yearReview\(\)'\]/.test(appCode));
  ok_('...and lists everyone before anybody is opened', /window\.A_yearReview = async/.test(appCode));
  /* 🔴 THIS ASSERTION USED TO PIN THE BUG, and it is worth saying how.
   *
   * It read: "...one request at a time, because Apps Script runs one at a time" — and demanded
   * `for(const r of YREV.rows){ await api('staffPerformance' …) }`. The premise is right and the
   * conclusion was exactly backwards. BECAUSE the platform runs one execution at a time for the
   * whole web app, nine sequential requests are nine slots nobody else in the school can have.
   *
   * On 2026-10-07 at 18:06, four teachers could not clock out. This screen is the most likely
   * reason. Server work for the whole lot is 8ms; the nine round trips are 30 seconds at the median
   * and over four minutes at p95.
   *
   * It is ONE request now, and a loop that awaits inside itself is what this check forbids. */
  ok_('🔴 the whole screen is ONE request, not one per teacher',
    /await api\('staffPerformanceAll'/.test(appCode));
  ok_('🔴 ...and nothing awaits per row any more',
    !/for\s*\(\s*const r of YREV\.rows\s*\)\s*\{[\s\S]{0,300}await api\(/.test(appCode));
  ok_('...the engine answers for a LIST of people', /staffPerformanceAll: p => \{/.test(engine));
  ok_('...by delegating to staffPerformance, so the pay figures have one source',
    /staffPerformanceAll[\s\S]{0,900}H\.staffPerformance\(\{ staffId: p\.staffId, targetId: id/.test(engine));
  ok_('...and one person failing does not blank the rest',
    /catch\(e\)\{ return \{ staffId: id, error:/.test(engine));
  ok_('...with a school-wide total', /ภาพรวมทั้งโรงเรียน/.test(app));
  ok_('the adjust form is on the per-person screen', /A_sperfAdjustSave/.test(appCode));
  /* The boxes start EMPTY. Pre-filled with today's salary, a save that changes nothing still writes
   * a history row saying it did. */
  ok_('🔴 ...and its boxes start empty, so only a typed number is a decision',
    /const f=\(id,label,ph\)=>[\s\S]{0,200}placeholder=/.test(appCode) && !/value="\$\{d\.income/.test(appCode));
  ok_('a reason is demanded before the request is even sent', /กรุณาระบุเหตุผลของการปรับ/.test(app));
  ok_('the history is shown to whoever can see the screen', /ประวัติการปรับเงินเดือน/.test(app));
  ok_('🔴 ...but the FORM is admin-only', /\$\{isAdmin\?`<details/.test(appCode));
  ok_('a teacher reaches their own year from การเงิน, behind the slip password',
    /สรุปข้อมูลของฉัน \(มาทำงาน · ลา · รายได้\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
