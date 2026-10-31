/**
 * tools/test_bill_reissue.js — ลบบิลแล้วออกใหม่ เงินก้อนเก่าต้องไม่ไหลเข้าบิลใบใหม่
 *   node tools/test_bill_reissue.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 เคสน้องอลัน · 2026-10-31 · รายงานโดยผู้ปกครองเอง
 *
 *   *"คุณพ่อช่วยเช็คให้หน่อยครับว่าของน้องอลันยังไม่ได้ชำระ แต่ระบบขึ้นว่าชำระแล้ว"*
 *
 * ลำดับที่เกิดขึ้นจริง — ครูทำถูกทุกขั้นตามที่ระบบเปิดให้ทำ:
 *   ① ออกบิลรายเดือน 6,900
 *   ② แอดมินบันทึกรับเงิน 6,900 (CONFIRMED)
 *   ③ ลบบิล เพราะเดือนนั้นต้องใช้บิลแบบมาครึ่งวัน — **แถวเงินไม่ถูกลบ**
 *   ④ ออกบิลใหม่ 3,000 → ได้ BillingID เดิม เพราะ id คือ `BL-<เดือน>-<รหัสเด็ก>`
 *   ⑤ เงิน 6,900 ผูกเข้าบิลใหม่เอง → ค้างชำระ 0 → **"ชำระแล้ว"**
 *
 * และที่แย่กว่าหน้าจอผิด: `collected` นับ 6,900 ของบิล 3,000
 * **รายได้ของโรงเรียนเกินจริง 3,900 ต่อเด็กหนึ่งคน** โดยไม่มีอะไรเตือน
 *
 * ชุดนี้จึงตรึงสองเรื่องที่ต่างกัน:
 *   · ข้อ 1–2  กลไก: id ซ้ำจริง และเงินเก่าไหลเข้าบิลใหม่จริง (ถ้าไม่มีตัวกัน)
 *   · ข้อ 3–5  ตัวกัน: ลบบิลที่มีเงินผูกอยู่ไม่ได้ · และกฎต้องอยู่ทั้งสองฝั่ง
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

const MONTH = '2026-11';
const ADMIN = { staffId: 'STF-A' };
function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 6900, end: '17:00' },
                      { id: 'p2', labelTH: 'ครึ่งวัน', price: 3000, end: '12:00' }], Departments: 'Nursery 2' },
    students: [{ StudentID: 'STD-A', NameTH: 'น้องอลัน', Nickname: 'อลัน', Class: 'Nursery 2',
      Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-A', DOB: '2023-01-01', EnrollDate: '2025-01-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [{ ParentID: 'PAR-A', NameTH: 'คุณพ่อ' }], classes: [{ ClassID: 'C2', ClassName: 'Nursery 2' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], userLinks: [], feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [],
    studentAttendanceToday: [], staffAttendanceToday: [], staffAttendanceHistory: [], activityLog: [],
    studentLeaves: [], comments: [], assessments: [], dspm: [], leaves: [], announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: [], journals: []
  };
  return { M, H: createAtomAPI(M).H };
}
const fin = H => H.financeSummary(Object.assign({ month: MONTH }, ADMIN)).students.find(x => x.studentId === 'STD-A') || {};

// ============================================================================
console.log('\n1) กลไก: BillingID คำนวณได้แน่นอน จึงซ้ำทุกครั้ง');
{
  const { M, H } = fresh();
  const b1 = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  eq('id มาจากเดือน+รหัสเด็ก', b1.BillingID, 'BL-' + MONTH + '-STD-A');
  /* ถ้าวันหนึ่งมีคนเปลี่ยน id ให้สุ่ม ข้อนี้จะแดง — และนั่นคือการแก้บั๊กนี้อีกทางหนึ่ง
   * ซึ่งก็ถูกเหมือนกัน แต่ต้องรู้ตัวว่ากำลังเปลี่ยนอะไร ไม่ใช่เปลี่ยนไปโดยบังเอิญ */
  M.payments.length = 0;
  const b2 = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  eq('🔴 ออกใหม่เดือนเดิมได้ id เดิม', b2.BillingID, b1.BillingID);
}

// ============================================================================
console.log('\n2) 🔴 ถ้าไม่มีตัวกัน เงินเก่าจะไหลเข้าบิลใหม่ (นี่คือสิ่งที่เกิดขึ้นจริง)');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  H.recordCashPayment(Object.assign({ kind: 'bill', refId: b.BillingID, amount: 6900, paidDate: '2026-11-01' }, ADMIN));
  eq('จ่ายครบแล้ว → ชำระแล้ว', [fin(H).paid, fin(H).tuitionOpen], [true, 0]);

  /* จำลองการลบแบบ "ของเดิมก่อนแก้" — ตัดแถวบิลออกตรง ๆ โดยไม่ผ่าน deleteBill
   * เพื่อพิสูจน์ว่ากลไกยังอยู่ และตัวกันคือสิ่งเดียวที่ขวางมันไว้ */
  M.payments.length = 0;
  eq('ลบบิลแล้ว แถวเงินยังอยู่', M.paymentSlips.length, 1);
  eq('ไม่มีบิล → ยังไม่มีบิล', [fin(H).paid, fin(H).status], [false, 'NO_BILL']);

  M.students[0].Plan = 'p2';                                   // เปลี่ยนเป็นครึ่งวัน 3,000
  const b2 = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  const f = fin(H);
  eq('บิลใหม่เป็น 3,000', b2.Amount, 3000);
  /* 🔴 สามบรรทัดนี้คือตัวบั๊ก · ถ้าวันหนึ่งมันกลับมาเป็น true/0/6900 อีก แปลว่าตัวกันหลุด */
  eq('🔴 เงินเก่าไหลเข้าบิลใหม่ → ขึ้นชำระแล้วทั้งที่ยังไม่จ่าย', f.paid, true);
  eq('🔴 ค้างชำระกลายเป็น 0', f.tuitionOpen, 0);
  eq('🔴 รายได้เกินจริง (เก็บได้ 6,900 ของบิล 3,000)', f.collected, 6900);
}

// ============================================================================
console.log('\n3) ตัวกัน: ลบบิลที่มีเงินยืนยันแล้วผูกอยู่ ไม่ได้');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  H.recordCashPayment(Object.assign({ kind: 'bill', refId: b.BillingID, amount: 6900, paidDate: '2026-11-01' }, ADMIN));
  eq('🔴 ปฏิเสธด้วย BILL_HAS_PAYMENT',
    code(() => H.deleteBill(Object.assign({ billingId: b.BillingID }, ADMIN))), 'BILL_HAS_PAYMENT');
  eq('และบิลยังอยู่ ไม่ได้ถูกลบไปครึ่งทาง', M.payments.length, 1);

  /* ข้อความต้องบอกจำนวนเงิน และบอกว่าต้องทำอะไรต่อ
   * — "ลบไม่ได้" เฉย ๆ คือทางตันที่คนจะหาทางอ้อมเอง ซึ่งอันตรายกว่า */
  let msg = '';
  try { H.deleteBill(Object.assign({ billingId: b.BillingID }, ADMIN)); } catch (e) { msg = (e && e.message) || ''; }
  ok_('บอกจำนวนเงินที่ผูกอยู่', msg.indexOf('6900') >= 0);
  ok_('บอกทางออก (จัดการรายการรับชำระก่อน)', /จัดการรายการรับชำระก่อน/.test(msg));
}

// ============================================================================
console.log('\n4) สลิปที่ยังรอตรวจ ก็ต้องกันเหมือนกัน');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  /* ผู้ปกครองแนบสลิปมาแล้วแต่ยังไม่มีใครตรวจ · ลบบิลตอนนี้ สลิปจะค้างเหมือนกันทุกประการ
   * และจะไปโผล่เป็น "สลิปที่รายการปิดไปแล้ว" ในหน้าการเงิน (v489) ซึ่งเป็นอาการ ไม่ใช่สาเหตุ */
  M.paymentSlips.push({ SlipID: 'SLP-1', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-A',
    Amount: 6900, Url: 'u1', Status: 'SUBMITTED' });
  eq('🔴 ปฏิเสธเช่นกัน',
    code(() => H.deleteBill(Object.assign({ billingId: b.BillingID }, ADMIN))), 'BILL_HAS_PAYMENT');
}

// ============================================================================
console.log('\n5) บิลที่ไม่มีเงินผูกอยู่ ต้องลบได้ตามปกติ');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  /* ตัวกันที่กันทุกอย่าง คือตัวกันที่คนจะหาทางปิด · ออกบิลผิดแล้วยังไม่มีใครจ่าย ต้องลบได้ */
  eq('ลบได้', code(() => H.deleteBill(Object.assign({ billingId: b.BillingID }, ADMIN))), 'RETURNED');
  eq('บิลหายไปจริง', M.payments.length, 0);
  /* ...และสลิปที่ถูกปฏิเสธไปแล้ว ไม่ใช่เงิน จึงไม่ควรขวางการลบ */
  const b2 = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  M.paymentSlips.push({ SlipID: 'SLP-R', RefKind: 'bill', RefID: b2.BillingID, StudentID: 'STD-A',
    Amount: 6900, Url: 'u', Status: 'REJECTED' });
  eq('สลิปที่ปฏิเสธไปแล้วไม่ขวางการลบ',
    code(() => H.deleteBill(Object.assign({ billingId: b2.BillingID }, ADMIN))), 'RETURNED');
}

// ============================================================================
console.log('\n6) 🔴 กฎต้องอยู่ทั้งสองฝั่ง — route ของจริง shadow เอนจินอยู่');
{
  /* src/Code.gs ส่ง deleteBill ไป handleDeleteBill ใน src/Staff.gs
   * ถ้าแก้แต่ในเอนจิน ของจริงที่โรงเรียนใช้จะยังลบได้เหมือนเดิม และบั๊กจะยังอยู่ครบ */
  const gas = R('src/Staff.gs');
  const fn = gas.slice(gas.indexOf('function handleDeleteBill'), gas.indexOf('function handleDeleteBill') + 2200);
  ok_('GAS อ่าน PAYMENT_SLIPS ก่อนลบ', /PAYMENT_SLIPS/.test(fn));
  ok_('นับเฉพาะ CONFIRMED / SUBMITTED / PENDING_VERIFY', /CONFIRMED/.test(fn) && /PENDING_VERIFY/.test(fn));
  ok_('ปฏิเสธด้วยรหัสเดียวกับเอนจิน', /BILL_HAS_PAYMENT/.test(fn));
  ok_('ตรวจก่อน deleteRow ไม่ใช่หลัง', fn.indexOf('BILL_HAS_PAYMENT') < fn.indexOf('deleteRow'));
}

// ============================================================================
console.log('\n7) ตัวตรวจย้อนหลัง — หาเด็กที่ข้อมูลเสียไปแล้ว');
{
  /* ตัวกันกันของใหม่ได้ แต่ข้อมูลที่เสียไปแล้วยังเสียอยู่
   * ถ้าไม่มีตัวตรวจ โรงเรียนจะรู้เฉพาะเคสที่ผู้ปกครองทักมาเอง ซึ่งคือเคสที่โชคดีที่สุด */
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-A', month: MONTH }, ADMIN));
  H.recordCashPayment(Object.assign({ kind: 'bill', refId: b.BillingID, amount: 6900, paidDate: '2026-11-01' }, ADMIN));
  eq('ตอนปกติไม่มีรายการผิดปกติ', H.billOverpaid(ADMIN).count, 0);

  // จำลองความเสียหายที่เกิดไปแล้ว: บิลถูกเปลี่ยนเป็น 3,000 ทีหลัง
  M.payments[0].Amount = 3000;
  const r = H.billOverpaid(ADMIN);
  eq('🔴 จับได้ 1 รายการ', r.count, 1);
  eq('และบอกส่วนต่างที่เกินจริง', r.total, 3900);
  eq('บอกชื่อเด็กและเดือน', [r.bills[0].nick, r.bills[0].month], ['อลัน', MONTH]);
  eq('บอกยอดบิลกับเงินที่ยืนยันแล้ว', [r.bills[0].amount, r.bills[0].confirmed], [3000, 6900]);

  /* อ่านอย่างเดียว — การตัดสินใจว่าจะคืนเงินหรือยกไปเดือนหน้า เป็นเรื่องของโรงเรียน
   * สคริปต์ที่ "แก้ให้เอง" กับเงินของครอบครัว คือสคริปต์ที่ไม่ควรมีอยู่ */
  const before = JSON.stringify(M.payments) + JSON.stringify(M.paymentSlips);
  H.billOverpaid(ADMIN);
  ok_('ไม่แก้ข้อมูลอะไรเลย', JSON.stringify(M.payments) + JSON.stringify(M.paymentSlips) === before);
  eq('ครูธรรมดาเรียกไม่ได้', code(() => H.billOverpaid({ staffId: 'STF-T' })), 'NO_PERMISSION');
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
