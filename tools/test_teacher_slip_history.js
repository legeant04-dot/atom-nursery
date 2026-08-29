/**
 * tools/test_teacher_slip_history.js — a teacher's own payslips, past ones included.
 *   node tools/test_teacher_slip_history.js
 *
 * Asked 2026-08-29: "วันนี้คุณครูดูสลิปย้อนหลังได้ไหม? … เพื่อที่ครูจะไปทำธุรกรรมอื่นๆ".
 *
 * They could — there has always been a month box. But checking it turned up the bug that had been
 * quietly making the duplicates:
 *
 *   T_slipFor fell back to computePayroll when a month had no saved slip, and asked for the REAL
 *   thing rather than a preview. computePayroll PERSISTS. So a teacher flipping back through months
 *   looking for a slip for the bank was WRITING A PAYROLL ROW FOR HERSELF on every empty month —
 *   and before ym7_ fixed the month lookup, each visit APPENDED ANOTHER.
 *
 * That is a permissions hole and a money bug at once: rows nobody approved, counted in the school's
 * salary expense, computed from whatever defaults happened to apply. It is almost certainly where
 * ครูจอย's four rows for กรกฎาคม 2569 came from.
 *
 * Fixed on BOTH sides — the client asks for a preview, and the server forces one for any non-admin
 * caller, because "the client promised not to" is not a permission model.
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
  appendObject_(stSh, { StaffID: 'STF-JOY', Name: 'ครูจอย', Nickname: 'จอย', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', BaseSalary: 13000 });
  appendObject_(stSh, { StaffID: 'STF-KOI', Name: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher',
    PositionLevel: 'Staff', Status: 'ACTIVE', BaseSalary: 14000 });
  var add = function (o) {
    appendObject_(paySh, Object.assign({ BaseSalary: 13000, GrossIncome: 13500, SocialSecurity: 650,
      Contribution: 0, TotalDeductions: 650, NetPay: 12850, SlipSent: 'NO' }, o));
  };
  add({ PayrollID: 'PR-1', StaffID: 'STF-JOY', Month: '2026-05', NetPay: 12850, SlipSent: 'YES', PaidDate: '2026-06-05' });
  add({ PayrollID: 'PR-2', StaffID: 'STF-JOY', Month: '2026-06', NetPay: 12900, SlipSent: 'YES' });
  add({ PayrollID: 'PR-3', StaffID: 'STF-JOY', Month: '2026-07', NetPay: 13000 });
  // ...and a DUPLICATE July, the live shape. A teacher's own list must not show July twice.
  add({ PayrollID: 'PR-4', StaffID: 'STF-JOY', Month: '2026-07', NetPay: 0, GrossIncome: 0 });
  add({ PayrollID: 'PR-9', StaffID: 'STF-KOI', Month: '2026-07', NetPay: 13600 });

  var o = {};
  o.mine = handleMyPayslipMonths({ staffId: 'STF-JOY' });
  o.other = handleMyPayslipMonths({ staffId: 'STF-KOI' });
  try { handleMyPayslipMonths({}); o.noId = 'ALLOWED'; } catch (e) { o.noId = e && e.apiCode; }

  // ---- the bug: does LOOKING at an empty month write a row? ----
  o.rowsBefore = readObjects_(paySh).length;
  // a teacher's session — applyIdentity_ stamps role on every non-admin caller
  o.teacherCall = handleComputePayroll({ staffId: 'STF-JOY', month: '2026-03', role: 'Teacher' });
  o.rowsAfterTeacher = readObjects_(paySh).length;
  // ...even if a stale build (or a crafted request) insists it is not a preview
  o.teacherForced = handleComputePayroll({ staffId: 'STF-JOY', month: '2026-02', role: 'Teacher', preview: false });
  o.rowsAfterForced = readObjects_(paySh).length;
  // an ADMIN still saves, which is the whole point of the screen
  o.adminCall = handleComputePayroll({ staffId: 'STF-JOY', month: '2026-04', generatedBy: 'STF-ADM' });
  o.rowsAfterAdmin = readObjects_(paySh).length;
  o.adminRow = !!findObject_(paySh, function (r) { return r.StaffID === 'STF-JOY' && ym7_(r.Month) === '2026-04'; });
  return JSON.stringify(o);
}));

// ============================================================================
console.log('\n1) the months a teacher actually has a slip for');
{
  eq('newest first', res.mine.months.map(m => m.month), ['2026-07', '2026-06', '2026-05']);
  /* ONE ENTRY PER MONTH. July has two rows on this fixture (the live shape), and a teacher's own
   * history is the last place a duplicate should surface — they cannot act on it and it only makes
   * them doubt the rest. The one shown is the one with the strongest evidence behind it. */
  eq('a duplicated month appears once', res.mine.months.filter(m => m.month === '2026-07').length, 1);
  eq('...and it is the real row, not the empty one', res.mine.months[0].netPay, 13000);
  eq('a month that was paid says so', [res.mine.months[2].month, !!res.mine.months[2].paidDate], ['2026-05', true]);
  eq('...and one whose slip was merely sent says that instead',
    [res.mine.months[1].slipSent, !!res.mine.months[1].paidDate], [true, false]);
  eq('it counts them', res.mine.count, 3);
  // scoped to one person — applyIdentity_ pins staffId to the caller, and this reads only that id
  eq('another teacher’s history is their own', res.other.months.map(m => m.month), ['2026-07']);
  eq('no id at all is refused', res.noId, 'BAD_INPUT');
}

console.log('\n2) LOOKING at a month must not create one');
{
  /* THE BUG THAT MADE THE DUPLICATES. computePayroll persists; the teacher's own screen was calling
   * it for real on every month that had no slip. */
  eq('a teacher’s call writes nothing', res.rowsAfterTeacher, res.rowsBefore);
  ok_('...but still returns the figures, so nothing is taken away from them', !!res.teacherCall.NetPay || res.teacherCall.NetPay === 0);
  ok_('...and says it is a preview', res.teacherCall.Preview === true);
  /* NOT TRUSTED TO THE CLIENT. A stale cached build still asks for the real thing, and a crafted
   * request would too — the server decides, from the role its own session stamped on the payload. */
  eq('...even when the caller explicitly says preview:false', res.rowsAfterForced, res.rowsBefore);
  ok_('...which the server forces rather than the screen promising', res.teacherForced.Preview === true);
  // and the admin path is untouched: this is the screen the school runs payroll on
  eq('an admin still saves', res.rowsAfterAdmin, res.rowsBefore + 1);
  ok_('...and the row is there', res.adminRow);
}

console.log('\n3) both halves of the fix, in the code');
{
  ok_('the server forces a preview for a non-admin', /if \(payload\.role && payload\.role !== 'Admin'\) payload\.preview = true;/.test(payGs));
  // the sentence wraps across comment lines, so match across them rather than pinning the wrap
  ok_('...with the reason written down',
    /a teacher flipping back through months to[\s\S]{0,20}find a slip for the bank was writing a payroll row for herself/.test(payGs)
    && /APPENDED ANOTHER/.test(payGs));
  ok_('the screen asks for a preview too', /api\('computePayroll',\{staffId:USER\.staffId,month:m,preview:true\}\)/.test(app));
  ok_('the months route exists', /myPayslipMonths: function \(p\)/.test(codeGs));
  /* NOT admin-only: it is the teacher's OWN history, and applyIdentity_ has already pinned staffId
   * to whoever is signed in. Putting it in ADMIN_ONLY would lock a teacher out of their own slips. */
  ok_('...and is NOT admin-only, or a teacher could not read their own',
    !/myPayslipMonths: 1/.test(codeGs));
}

console.log('\n4) what the teacher sees');
{
  ok_('the real months are offered as buttons', /function T_slipMonthList\(mo, current\)/.test(app));
  ok_('...newest first, marked paid or sent', /x\.paidDate\?' ✅':\(x\.slipSent\?' 📤':''\)/.test(app));
  ok_('...fetched in the same tick as the slip, so it costs no round trip',
    /const p_months=api\('myPayslipMonths',\{staffId:USER\.staffId\}\)\.catch\(\(\)=>null\);/.test(app));
  ok_('the free month box still works for anything older', /id="slipMonth"[\s\S]{0,80}onchange="T_slipMonth\(this\.value\)"/.test(app));
  ok_('picking one keeps the box in step', /window\.T_slipPick=async\(m\)=>\{ const box=document\.getElementById\('slipMonth'\)/.test(app));
  /* AN ESTIMATE IS NOT A DOCUMENT. A month with no issued slip still renders — from a preview — and
   * until now that looked exactly like a real payslip. Somebody taking it to a bank had no way to
   * tell, which is the whole point of the request that started this. */
  ok_('a preview is labelled as an estimate', /r\.Preview\?`<div style="background:var\(--warn-bg\)/.test(app));
  ok_('...saying plainly it cannot be used for a bank', /ยังใช้ยื่นธนาคารหรือทำธุรกรรมไม่ได้/.test(app));
  ok_('...and that the figures can still change', /ตัวเลขอาจเปลี่ยนได้/.test(app));
  // the download already took whatever month is in the box; it must keep doing so
  ok_('the download follows the chosen month', /m=m\|\|\(\$\('#slipMonth'\)&&\$\('#slipMonth'\)\.value\)\|\|monthStr\(\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
