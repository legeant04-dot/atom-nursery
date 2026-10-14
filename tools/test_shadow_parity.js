/**
 * tools/test_shadow_parity.js — Phase 2.6. Do the two halves of a shadowed READ agree?
 *   node tools/test_shadow_parity.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE CLASS OF BUG THIS EXISTS FOR
 *
 * 131 handlers exist twice: once as an explicit route in src/Code.gs, once in webapp/engine.js. The
 * route wins — dispatch_ looks there first — so **every test written against the engine half is a
 * test of code the school does not run**. That has already shipped three changes that went green
 * and did nothing on live (saveStaffSelf v378, insuranceStatus v379, setSchoolConfig's whitelist).
 *
 * For a WRITE the duplication is forced: the engine persists whole collections and Sheets needs
 * in-place writes — that is the 2026-07-09 wipe. 114 of the 131 are that.
 *
 * 🔴 BUT 17 OF THEM ARE PURE READS (tools/shadow_audit.js finds them), and for a read there is no
 * mechanism forcing anything. Those pairs exist for no reason, and nothing stops them drifting —
 * `insuranceStatus` is on that list, and `insuranceStatus` is one of the three that already did.
 *
 * `test_shadow_routes.js` NAMES the pairs and compares a few contracts by reading source text.
 * This one RUNS BOTH HALVES on the same school and compares the answers, which is the only check
 * that can see a difference nobody thought to look for.
 *
 * A difference here is not automatically a bug — a route may deliberately return more. It is a
 * DECISION that has to be made deliberately, which is exactly what has been missing.
 */
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         route  =' + JSON.stringify(got) + '\n         engine =' + JSON.stringify(want)));
  o ? pass++ : fail++;
}

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

/* One school, built once, then asked the same question through both doors. The fixture is small on
 * purpose: this is about whether the two implementations AGREE, not about volume. */
const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;

  var ss = getMainSpreadsheet_(), hr = getHrSpreadsheet_();
  appendObject_(sheet_(ss, 'STUDENTS'), { StudentID: 'S-1', NameTH: 'เด็กทดสอบ', Nickname: 'ทด',
    Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-04-15', EnrollDate: '2026-01-05',
    InsuranceHas: 'YES', InsurancePolicyNo: 'P-1', InsuranceCompany: 'AIA',
    InsuranceExpiry: '2100-01-01', InsuranceSum: '500,000.00' });
  /* 🔴 `Name`, NOT `NameTH`. The STAFF sheet's column is literally `Name` (SCHEMA.STAFF) and the
   * engine only sees `NameTH` because FIELD_ALIAS renames it on the way in. The fixture used to
   * write NameTH — a column the sheet does not have — so the ROUTE half read no name at all and the
   * payslip-name difference below looked like a missing field in the route rather than a fixture
   * that had never populated it. Position / BankName / BankAccount are here for the same reason:
   * a parity test on fields that are blank on both sides proves nothing. */
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'T-1', Name: 'ครูทดสอบ', Nickname: 'ครู',
    Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', Classes: 'Nursery 1',
    Position: 'ครูประจำชั้น', BankName: 'KBANK', BankAccount: '123-4-56789-0',
    Status: 'ACTIVE', StartDate: '2024-01-01', BaseSalary: 18000, StaffGroup: 'ATMG-01' });
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'ADM', Name: 'แอดมิน', Role: 'Admin',
    PositionLevel: 'Admin', Status: 'ACTIVE', StartDate: '2024-01-01' });
  appendObject_(sheet_(hr, 'LEAVE_REQUEST'), { LeaveID: 'LV-1', StaffID: 'T-1', Type: 'ลาป่วย',
    DateFrom: '2026-10-20', DateTo: '2026-10-20', Days: 1, Reason: 'ไข้', Status: 'PENDING_LEADER',
    CreatedDate: '2026-10-13' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'rows:STUDENTS', 'rows:STAFF', 'rows:LEAVE_REQUEST']); } catch (e) {}

  /* THE ENGINE HALF, built the way engineDispatch_ builds it — same M, same createAtomAPI. Using
   * the real path rather than a hand-made M is the point: a parity test on a fixture the engine
   * would never actually be given proves nothing about the engine. */
  function engineH() {
    var ctx = hydrateLazy_(['students', 'staff', 'leaves', 'studentLeaves', 'assessments',
      'dspmCriteria', 'payroll', 'otRecords', 'holidays', 'bigCleaning', 'classes', 'staffGroups',
      'payrollConfig', 'insurance', 'payAdjustments']);
    return createAtomAPI(ctx.M, null).H;
  }

  /* 🔴 A REFUSAL IS AN ANSWER, and the two halves must agree about it by CODE, not by wording.
   * dspmCriteria refuses an age with no criteria on both sides and says so in different words —
   * that is parity. Comparing the sentences would report a defect that is not one, and a report
   * that cries wolf stops being read (the lesson from the speed report's refused-vs-failed split). */
  function both(name, payload) {
    var out = { route: null, engine: null, routeErr: null, engineErr: null };
    try { out.route = ROUTES[name] ? ROUTES[name](JSON.parse(JSON.stringify(payload || {}))) : '(no route)'; }
    catch (e) { out.routeErr = (e && e.apiCode) || 'ERR'; out.routeMsg = String(e && e.message || e); }
    try { var H = engineH(); out.engine = H[name] ? H[name](JSON.parse(JSON.stringify(payload || {}))) : '(no handler)'; }
    catch (e) { out.engineErr = (e && e.apiCode) || 'ERR'; out.engineMsg = String(e && e.message || e); }
    return out;
  }

  return JSON.stringify({
    insuranceStatus: both('insuranceStatus', { studentId: 'S-1' }),
    insuranceList:   both('insuranceList',   { staffId: 'ADM' }),
    pendingLeaves:   both('pendingLeaves',   { staffId: 'ADM' }),
    allLeaves:       both('allLeaves',       { staffId: 'ADM' }),
    bigCleaningDays: both('bigCleaningDays', {}),
    dspmCriteria:    both('dspmCriteria',    { studentId: 'S-1' }),
    otWaiveDays:     both('otWaiveDays',     {}),
    otCarryOver:     both('otCarryOver',     { staffId: 'T-1' }),
    studentAssessment: both('studentAssessment', { studentId: 'S-1' }),
    myPayslipMonths:   both('myPayslipMonths',   { staffId: 'T-1' }),
    payAdjustHistory:  both('payAdjustHistory',  { staffId: 'T-1', month: '2026-10' }),
    googleLoginReady:  both('googleLoginReady',  {}),
    computePayroll:    both('computePayroll',    { staffId: 'T-1', month: '2026-10' })
  });
}));

/** keys only — a parity difference is almost always a FIELD that one side forgot, not a value. */
const keysOf = v => Array.isArray(v) ? (v.length ? Object.keys(v[0]).sort() : ['(empty)'])
  : (v && typeof v === 'object') ? Object.keys(v).sort() : [typeof v];

/* ── 🔴 THE PAYSLIP GAP — CLOSED 2026-10-14 ──────────────────────────────────────────────────────
 *
 * This was the largest finding of Phase 2.6: `computePayroll` is the payslip, and its two halves
 * disagreed about ELEVEN fields. The explicit route is what the school runs today; the engine half
 * is what runs after the cutover. So cutting over as things stood would have:
 *
 *   · dropped the staff member's NAME, POSITION, BANK NAME and the generated-by / generated-date
 *     audit fields from every payslip;
 *   · put the school's bank NAME into the teacher's account-number cell (the engine's only
 *     `BankAccount: cfg.BankName`), so the slip showed "SCB" where an account number belongs;
 *   · ERASED SlipSent / PaidDate / PaidBy / SlipUrl on any recalculation — the engine assigned a
 *     whole new row over the old one, so a slip the school had already PAID read back as unpaid and
 *     the obvious next action was to pay it twice;
 *   · called one quantity by two names (`ChildCount` here, `ExtraChildCount` in the sheet and on the
 *     route) so the screen's own fallback was the only thing keeping "เด็ก N คน × ฿300" on the slip;
 *   · lost the certificate COUNT, keeping only the money, so the payroll screen reopened at 0;
 *   · grown OTCarryDetail without limit toward the 50,000-character cell ceiling.
 *
 * KNOWN_DIFF is now EMPTY, and that is the assertion: an empty object means every field of the
 * payslip is named the same on both sides. It is kept rather than deleted because a future shadow
 * that needs a pinned difference should be added here, visibly, and not tolerated in silence.
 *
 * 🔴 WHAT IS STILL OPEN is a VALUE, not a field: the Nth child the rate starts at. See
 * CHILD_RATE_THRESHOLD_DEFAULT_ in src/Payroll.gs and section 3 below. */
const KNOWN_DIFF = {};

/* The fields that are the same QUANTITY on both sides and must therefore hold the same VALUE.
 * Keys-only parity is what let the bank-name-in-the-account-cell bug sit here unseen: both halves
 * had a `BankAccount`, and they held different things. GeneratedDate is excluded — it is a clock
 * reading, and two calls a millisecond apart are allowed to differ. */
const SAME_VALUE = ['StaffID', 'Month', 'BaseSalary', 'StaffName', 'Position', 'BankName',
  'BankAccount', 'ExtraChildCount', 'ChildThreshold', 'TrainingCertCount', 'SlipSent',
  'PaidDate', 'PaidBy', 'SlipUrl', 'GeneratedBy'];

console.log('\n1) 🔴 ประตูสองบานของคำถามเดียวกัน ต้องตอบเหมือนกัน');
Object.keys(res).forEach(name => {
  const r = res[name];
  if (r.routeErr || r.engineErr) {
    /* 🔴 A half that answers where the other REFUSES is the strongest form of divergence, and until
     * now nothing in the suite could have noticed it, because only one of them ever runs.
     * Both refusing with the same code is agreement. */
    if (r.routeErr && r.engineErr) {
      eq(name + ' — ปฏิเสธเหมือนกัน (เทียบด้วยรหัส ไม่ใช่ข้อความ)', r.routeErr, r.engineErr);
    } else {
      ok_('🔴 ' + name + ' — ฝั่งหนึ่งตอบได้ อีกฝั่งปฏิเสธ  (route: ' +
        (r.routeErr || 'ตอบได้') + ' · engine: ' + (r.engineErr || 'ตอบได้') + ')', false);
    }
    return;
  }
  const kd = KNOWN_DIFF[name];
  if (kd) {
    const a = keysOf(r.route), b = keysOf(r.engine);
    eq('🔴 ' + name + ' — ช่องที่มีเฉพาะฝั่ง live (' + kd.why + ')', a.filter(k => b.indexOf(k) < 0), kd.routeOnly);
    eq('🔴 ' + name + ' — ช่องที่มีเฉพาะฝั่ง engine', b.filter(k => a.indexOf(k) < 0), kd.engineOnly);
    return;
  }
  eq(name + ' — รูปร่างคำตอบตรงกัน', keysOf(r.route), keysOf(r.engine));
});

console.log('\n1b) 🔴 ...และช่องเดียวกันต้องมีค่าเดียวกัน (ไม่ใช่แค่ชื่อตรงกัน)');
{
  const a = res.computePayroll.route || {}, b = res.computePayroll.engine || {};
  SAME_VALUE.forEach(k => {
    /* Compared as text: the route reads a Sheets cell and the engine reads a decoded collection, so
     * 18000 and '18000' are the SAME ANSWER arriving through two readers. A test that called that a
     * defect would be testing the harness. */
    const s = v => (v == null ? '' : (v instanceof Date ? 'date' : String(v)));
    eq('  computePayroll.' + k, s(a[k]), s(b[k]));
  });
  /* 🔴 THE ONE THAT MUST NOT BE SILENTLY "FIXED" BY A FALLBACK. A paid slip that is recalculated
   * must still say it was paid, on BOTH sides. This is the double-payment bug, asserted directly
   * rather than inferred from a field list. */
  ok_('  🔴 ExtraChildCount เป็นชื่อเดียวกันทั้งสองฝั่ง (ไม่มี ChildCount เหลืออยู่)',
    !Object.prototype.hasOwnProperty.call(b, 'ChildCount') &&
    Object.prototype.hasOwnProperty.call(b, 'ExtraChildCount'));
  ok_('  🔴 BankAccount ไม่ใช่ชื่อธนาคาร (engine เคยใส่ชื่อธนาคารลงช่องเลขบัญชี)',
    String(b.BankAccount || '') === '123-4-56789-0' && String(b.BankName || '') === 'KBANK');
}

console.log('\n2) 🔴 รายชื่อ shadow ที่เป็นการอ่านล้วน — ต้องไม่โตขึ้นเงียบๆ');
{
  const { readOnly, shadows } = require('./shadow_audit.js');
  /* Pinned, like every other ledger in this project. A new read-only shadow is a new pair of
   * implementations of one answer, with nothing forcing them to agree — the exact shape that cost
   * three releases. Adding one has to be a visible decision. */
  eq('จำนวน shadow ทั้งหมด', shadows.length, 131);
  eq('🔴 ...ที่เป็นการอ่านล้วน (ไม่มีเหตุผลเชิงกลไก)', readOnly.length, 17);
  /* the three that have already bitten — named, so a future cleanup cannot quietly drop the check */
  ['insuranceStatus'].forEach(n =>
    ok_('🔴 ' + n + ' ยังอยู่ในรายการ (เคยทำให้ v379 ขึ้นเขียวแล้วไม่มีผลจริง)', readOnly.indexOf(n) >= 0));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
