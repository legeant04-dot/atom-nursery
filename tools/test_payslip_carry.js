/**
 * tools/test_payslip_carry.js — recalculating a payslip must not forget that it was PAID.
 *   node tools/test_payslip_carry.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 THE BUG, FOUND 2026-10-14 WHILE CLOSING THE PHASE 2.6 PAYSLIP GAP
 *
 * A payroll row holds two different kinds of cell:
 *
 *   DERIVED  — BaseSalary, เบี้ยขยัน, OT, the totals. Recomputing is the whole point of them.
 *   RECORDED — SlipSent, PaidDate, PaidBy, SlipUrl. These say the school TRANSFERRED the money and
 *              filed the receipt. Nothing in an arithmetic can produce them.
 *
 * The engine's computePayroll assigned a whole new record over the old one (`M.payroll[i]=rec`) and
 * the new record did not contain the recorded four. So: admin computes, admin pays, admin notices
 * one OT hour was missing, admin recomputes — and the slip says unpaid again. The finance screen
 * counts it as owing, the "ยังไม่จ่าย" list has the teacher back on it, and the obvious next action
 * is to pay her a second time.
 *
 * It had never bitten, for one reason: nothing the school runs today goes through that half. The
 * Sheets route writes IN PLACE and only touches cells it names, so it kept the payment by accident
 * of its mechanism rather than by decision. After the cutover, everything goes through the engine.
 *
 * 🔴 WHY THIS FILE EXISTS RATHER THAN A LINE IN THE PARITY TEST. test_shadow_parity compares the
 * two halves on a FRESH month, where every one of the four is empty on both sides and therefore
 * equal. The bug only appears on the SECOND compute of a month that was already paid, which is a
 * sequence, not a shape. A field list could never have caught it.
 *
 * Both halves are tested, with the same sequence, because "the other one happens to be safe" is the
 * state this project keeps finding and it is never a reason not to assert it.
 */
const path = require('path');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                    'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                    'PaySlips', 'PayAdjust', 'Password', 'Certificate', 'Dspm', 'BillRun',
                    'GasEngine', 'Engine', 'Day6']);

const MONTH = '2026-09';   // inlined inside run(): the body is serialised into a vm context, so it closes over nothing

const res = JSON.parse(run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var hr = getHrSpreadsheet_();
  appendObject_(sheet_(hr, 'STAFF'), { StaffID: 'T-9', Name: 'ครูเงินเดือน', Nickname: 'ครู',
    Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', Classes: 'Nursery 1',
    Position: 'ครูประจำชั้น', BankName: 'KBANK', BankAccount: '111-2-33333-4',
    Status: 'ACTIVE', StartDate: '2024-01-01', BaseSalary: 20000, StaffGroup: 'ATMG-01' });
  _configCache = null;
  try { CacheService.getScriptCache().removeAll(['cfg', 'rows:STAFF', 'col:STAFF']); } catch (e) {}

  var out = {};

  /* ── THE SHEETS ROUTE: compute → pay → recompute ───────────────────────────────────────────── */
  computePayroll({ staffId: 'T-9', month: '2026-09', extraChildCount: 0, generatedBy: 'admin1' });
  // markSalaryPaid is the admin pressing "จ่ายแล้ว" and filing the transfer slip
  handleMarkSalaryPaid({ staffId: 'T-9', month: '2026-09', paid: true,
    slipUrl: 'https://drive.example/slip-9.pdf', adminId: 'admin1' });
  var afterPayRoute = computePayroll({ staffId: 'T-9', month: '2026-09', extraChildCount: 0,
    otEvening: 1200, generatedBy: 'admin1' });          // the correction that used to erase it
  out.route = { SlipSent: afterPayRoute.SlipSent, PaidBy: afterPayRoute.PaidBy,
    SlipUrl: afterPayRoute.SlipUrl, paidDateSet: !!String(afterPayRoute.PaidDate || ''),
    // ...and the DERIVED half really did change, or this test would pass on a function that did nothing
    OTEvening: afterPayRoute.OTEvening };
  // the SHEET, not only the returned object — the screen reads the sheet on the next load
  var onSheet = findObject_(sheet_(hr, 'PAYROLL'), function (r) {
    return String(r.StaffID) === 'T-9' && ym7_(r.Month) === '2026-09'; }) || {};
  out.routeSheet = { SlipSent: String(onSheet.SlipSent || ''), SlipUrl: String(onSheet.SlipUrl || '') };

  /* ── THE ENGINE HALF: the same sequence, on its own M ──────────────────────────────────────── */
  var ctx = hydrateLazy_(['staff', 'payroll', 'students', 'leaves', 'otRecords']);
  var H = createAtomAPI(ctx.M, null).H;
  H.computePayroll({ staffId: 'T-9', month: '2026-09', extraChildCount: 0, generatedBy: 'admin1' });
  H.markSalaryPaid({ staffId: 'T-9', month: '2026-09', paid: true,
    slipUrl: 'https://drive.example/slip-9.pdf', adminId: 'admin1' });
  var afterPayEng = H.computePayroll({ staffId: 'T-9', month: '2026-09', extraChildCount: 0,
    otEvening: 1200, generatedBy: 'admin1' });
  out.engine = { SlipSent: afterPayEng.SlipSent, PaidBy: afterPayEng.PaidBy,
    SlipUrl: afterPayEng.SlipUrl, paidDateSet: !!String(afterPayEng.PaidDate || ''),
    OTEvening: afterPayEng.OTEvening };
  // ...and it is on the COLLECTION too, which is what persist() would write
  var row = (ctx.M.payroll || []).filter(function (r) { return String(r.StaffID) === 'T-9'; })[0] || {};
  out.engineRow = { SlipSent: String(row.SlipSent || ''), SlipUrl: String(row.SlipUrl || '') };
  out.engineRowCount = (ctx.M.payroll || []).filter(function (r) { return String(r.StaffID) === 'T-9'; }).length;

  /* ── AND THE FIELDS THE ENGINE SIMPLY DID NOT HAVE ─────────────────────────────────────────── */
  out.who = { StaffName: afterPayEng.StaffName, Position: afterPayEng.Position,
    BankName: afterPayEng.BankName, BankAccount: afterPayEng.BankAccount,
    GeneratedBy: afterPayEng.GeneratedBy };
  return JSON.stringify(out);
}));

console.log('\n1) 🔴 คำนวณสลิปใหม่ หลังจากจ่ายเงินแล้ว — ต้องยังบอกว่าจ่ายแล้ว (ฝั่ง Sheets ที่ใช้อยู่จริง)');
eq('SlipSent ยังเป็น YES', res.route.SlipSent, 'YES');
eq('PaidBy ยังอยู่', res.route.PaidBy, 'admin1');
eq('SlipUrl (หลักฐานการโอน) ยังอยู่', res.route.SlipUrl, 'https://drive.example/slip-9.pdf');
ok_('PaidDate ยังอยู่', res.route.paidDateSet === true);
eq('...และตัวเลขที่ต้องคำนวณใหม่ เปลี่ยนจริง (OT 1,200)', res.route.OTEvening, 1200);
eq('ในชีตก็ยังเป็น YES', res.routeSheet.SlipSent, 'YES');
eq('ในชีตยังมีหลักฐานการโอน', res.routeSheet.SlipUrl, 'https://drive.example/slip-9.pdf');

console.log('\n2) 🔴 เรื่องเดียวกัน ฝั่ง engine — ฝั่งที่จะใช้หลังย้ายฐานข้อมูล (นี่คือบั๊กที่เจอ)');
eq('SlipSent ยังเป็น YES (เคยกลายเป็น NO → เสี่ยงจ่ายซ้ำ)', res.engine.SlipSent, 'YES');
eq('PaidBy ยังอยู่ (ฝั่งนี้ไม่เคยบันทึกเลย)', res.engine.PaidBy, 'admin1');
eq('SlipUrl ยังอยู่', res.engine.SlipUrl, 'https://drive.example/slip-9.pdf');
ok_('PaidDate ยังอยู่', res.engine.paidDateSet === true);
eq('...และ OT คำนวณใหม่จริง', res.engine.OTEvening, 1200);
eq('ในคอลเลกชันก็ยังเป็น YES', res.engineRow.SlipSent, 'YES');
eq('🔴 ยังมีแถวเดียว (คำนวณซ้ำต้องไม่เพิ่มแถว)', res.engineRowCount, 1);

console.log('\n3) 🔴 ช่องที่ฝั่ง engine ไม่มีเลย — สลิปจะไม่มีชื่อคนรับเงิน');
eq('ชื่อพนักงาน', res.who.StaffName, 'ครูเงินเดือน');
eq('ตำแหน่ง', res.who.Position, 'ครูประจำชั้น');
eq('ชื่อธนาคาร', res.who.BankName, 'KBANK');
eq('🔴 เลขบัญชี — ไม่ใช่ชื่อธนาคาร (เดิมใส่ชื่อธนาคารลงช่องนี้)', res.who.BankAccount, '111-2-33333-4');
eq('ใครออกสลิป', res.who.GeneratedBy, 'admin1');

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
