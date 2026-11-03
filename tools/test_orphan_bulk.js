/**
 * tools/test_orphan_bulk.js — เคลียร์สลิปค้างทีละหลายใบ โดยไม่เปิดหนี้ปลอม
 *   node tools/test_orphan_bulk.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-11-03: เพิ่ม Check Box และปุ่มเคลียร์ทั้งหมด ในหัวข้อ "สลิปที่รายการปิดไปแล้ว" (14 ใบ)
 *
 * 🔴 ก่อนทำปุ่มนี้ เจอบั๊กเรื่องเงินในปุ่ม "ไม่ต้องใช้" ที่ทำไว้ตั้งแต่ v489:
 *   ปฏิเสธสลิป → คำนวณสถานะรายการใหม่จากสลิป → ไม่เจอเงินยืนยันสักบาท → UNPAID
 *   · ค่า OT ที่ "ยกเลิก" ไปแล้ว (เคสอาร์เมอร์ 20/07)  → กลับมาเป็นหนี้ 100 บาท
 *   · บิลที่จ่ายเงินสดแล้วโดยไม่มีแถวสลิป            → กลับมาค้างชำระเต็มยอด
 * ปุ่ม "เคลียร์ทั้งหมด" ทับบั๊กนี้ = เปิดหนี้ปลอมให้ 14 ครอบครัวในคลิกเดียว
 *
 * กฎ: สลิปที่ยังไม่เคยยืนยัน ไม่เคยทำให้รายการ PAID — ปฏิเสธหรือลบมัน จึงต้องไม่ทำให้ PAID หลุด
 *     และรายการ CANCELLED ไม่มีสลิปไหนมีสิทธิ์เปลี่ยนสถานะ
 */
const path = require('path'), fs = require('fs');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
function code(fn) { try { fn(); return 'RETURNED'; } catch (e) { return (e && (e.code || e.apiCode)) || String(e); } }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = { staffId: 'STF-A' };

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, end: '17:00' }], Departments: 'Nursery 1' },
    students: [{ StudentID: 'STD-1', NameTH: 'อาร์เมอร์', Nickname: 'อาร์เมอร์', Class: 'Nursery 1', Plan: 'p1',
      Status: 'ACTIVE', ParentID: 'P1', DOB: '2023-01-01', EnrollDate: '2025-01-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' },
            { StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher' }],
    parents: [], classes: [{ ClassID: 'C1', ClassName: 'Nursery 1' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [],
    userLinks: [], feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], activityLog: [], studentLeaves: [], comments: [],
    assessments: [], dspm: [], leaves: [], announcements: [], withdrawals: [], attendanceReq: [], classChangeReq: [],
    absenceLog: [], journals: []
  };
  return { M, H: createAtomAPI(M).H };
}
/* สามสถานการณ์ที่อยู่ในหัวข้อ "สลิปที่รายการปิดไปแล้ว" จริง */
function seed(M, H) {
  M.otDaily.push({ OTID: 'OT-X', StudentID: 'STD-1', Date: '2026-07-20', Amount: 100, Status: 'CANCELLED' });
  M.paymentSlips.push({ SlipID: 'S-OT', RefKind: 'ot', RefID: 'OT-X', StudentID: 'STD-1', Amount: 100, Url: 'u1', Status: 'SUBMITTED' });
  const b = H.issueBill(Object.assign({ studentId: 'STD-1', month: '2026-10' }, ADMIN));
  H.confirmPayment(Object.assign({ kind: 'bill', id: b.BillingID, method: 'cash' }, ADMIN));
  M.paymentSlips.push({ SlipID: 'S-BILL', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-1', Amount: 5900, Url: 'u2', Status: 'SUBMITTED' });
  // รายการแจ้งเงินสดที่ไม่มีรูป — ตัวเดียวที่ "ลบ" ได้
  M.paymentSlips.push({ SlipID: 'S-CASH', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-1', Amount: 5900, Url: '', Status: 'SUBMITTED', Method: 'cash' });
  return b;
}

// ============================================================================
console.log('\n1) 🔴 ปฏิเสธสลิปค้าง ต้องไม่เปิดรายการที่ปิดแล้วกลับมาเป็นหนี้');
{
  const { M, H } = fresh(); seed(M, H);
  H.rejectSlip(Object.assign({ slipId: 'S-OT' }, ADMIN));
  eq('🔴 OT ที่ยกเลิกแล้ว ยังยกเลิกอยู่ (ไม่กลับมาเป็นหนี้ 100 บาท)', M.otDaily[0].Status, 'CANCELLED');
  H.rejectSlip(Object.assign({ slipId: 'S-BILL' }, ADMIN));
  eq('🔴 บิลที่จ่ายเงินสดแล้ว ยัง PAID อยู่', M.payments[0].Status, 'PAID');
  eq('สลิปถูกปฏิเสธจริง', M.paymentSlips.filter(s => s.Status === 'REJECTED').length, 2);
}

// ============================================================================
console.log('\n2) แต่การปฏิเสธสลิปที่ "ยืนยันแล้ว" ยังต้องลดสถานะได้ตามเดิม');
{
  /* กรณีนี้สลิปคือตัวที่ทำให้บิล PAID จริง · ปฏิเสธแล้วบิลต้องกลับมาค้าง ไม่งั้นกฎใหม่กลายเป็น
   * "ปฏิเสธอะไรก็ไม่มีผล" ซึ่งเป็นบั๊กอีกด้านหนึ่ง */
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-1', month: '2026-10' }, ADMIN));
  M.paymentSlips.push({ SlipID: 'S-C', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-1', Amount: 5900, Url: 'u', Status: 'SUBMITTED' });
  H.confirmSlip(Object.assign({ slipId: 'S-C' }, ADMIN));
  eq('ยืนยันแล้ว → PAID', M.payments[0].Status, 'PAID');
  H.rejectSlip(Object.assign({ slipId: 'S-C' }, ADMIN));
  eq('ปฏิเสธสลิปที่ยืนยันแล้ว → กลับมา UNPAID', M.payments[0].Status, 'UNPAID');
}

// ============================================================================
console.log('\n3) ลบสลิปค้าง ก็ต้องไม่เปิดหนี้เหมือนกัน');
{
  const { M, H } = fresh(); seed(M, H);
  H.deleteSlip(Object.assign({ slipId: 'S-CASH' }, ADMIN));
  eq('🔴 บิลยัง PAID หลังลบรายการแจ้งเงินสดที่ค้าง', M.payments[0].Status, 'PAID');
  eq('สลิปที่มีรูป ลบไม่ได้ (หลักฐานการโอน)', code(() => H.deleteSlip(Object.assign({ slipId: 'S-BILL' }, ADMIN))), 'HAS_SLIP');
}

// ============================================================================
console.log('\n4) เคลียร์หลายใบในคำขอเดียว');
{
  const { M, H } = fresh(); seed(M, H);
  const r = H.rejectSlips(Object.assign({ slipIds: ['S-OT', 'S-BILL', 'S-CASH', 'ไม่มีจริง'] }, ADMIN));
  eq('เคลียร์ได้ 3 · ข้าม 1 (ไม่มีจริง)', [r.count, r.skipped.length], [3, 1]);
  /* 🔴 ข้อนี้คือเหตุผลทั้งหมดของการแก้ก่อนทำปุ่ม */
  eq('🔴 หลังเคลียร์ทั้งหมด ไม่มีรายการไหนกลับมาเป็นหนี้', [M.otDaily[0].Status, M.payments[0].Status], ['CANCELLED', 'PAID']);
  ok_('ทุกใบที่เคลียร์ได้ รายงานว่า "ไม่แตะสถานะรายการ"', r.done.every(x => x.kept));
  eq('ไม่เหลือสลิปค้างในหัวข้อนี้', (H.orphanSlips(ADMIN) || []).length, 0);
}

// ============================================================================
console.log('\n5) ลบหลายใบ: ใบที่มีรูปถูกข้าม ไม่ใช่ล้มทั้งก้อน');
{
  const { M, H } = fresh(); seed(M, H);
  const r = H.deleteSlips(Object.assign({ slipIds: ['S-CASH', 'S-BILL'] }, ADMIN));
  eq('ลบได้ 1 · ข้าม 1', [r.count, r.skipped.length], [1, 1]);
  eq('ตัวที่ข้ามคือใบที่มีรูป', r.skipped[0].code, 'HAS_SLIP');
  eq('บิลยัง PAID', M.payments[0].Status, 'PAID');
}

// ============================================================================
console.log('\n6) สิทธิ์ และกฎต้องอยู่ทั้งสองฝั่ง');
{
  const { H } = fresh();
  eq('ครูเรียกเคลียร์ไม่ได้', code(() => H.rejectSlips({ staffId: 'STF-T', slipIds: ['x'] })), 'NO_PERMISSION');
  const gas = R('src/PaySlips.gs'), code_ = R('src/Code.gs');
  const rej = gas.slice(gas.indexOf('function handleRejectSlip('), gas.indexOf('// recompute a target'));
  ok_('🔴 GAS ปฏิเสธสลิป: ไม่คำนวณใหม่ถ้ารายการปิดไปแล้ว', /if \(!keep\) paySlipRecompute_/.test(rej));
  const del = gas.slice(gas.indexOf('function handleDeleteSlip('), gas.indexOf('function handleEditPrepay'));
  ok_('🔴 GAS ลบสลิป: กฎเดียวกัน', /if \(!keep\) paySlipRecompute_/.test(del));
  ok_('🔴 GAS: รายการ CANCELLED ไม่ถูกสลิปแตะเลย',
    /function paySlipRecompute_[\s\S]{0,300}=== 'CANCELLED'\) return;/.test(gas));
  ok_('route ใหม่มีอยู่จริง', /rejectSlips: +function/.test(code_) && /deleteSlips: +function/.test(code_));
  ok_('และเป็นของแอดมินเท่านั้น', /rejectSlip: 1, rejectSlips: 1, deleteSlips: 1/.test(code_));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
