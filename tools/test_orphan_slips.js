/**
 * tools/test_orphan_slips.js — สลิปที่รายการต้นทางปิดไปแล้ว
 *   node tools/test_orphan_slips.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-29: *"สลิปที่รายการปิดไปแล้ว — รอเคลียร์ : กดแล้วไปที่หน้าจัดการ แล้วยังไงต่อ?
 *   ต้องไปทำอะไรต่อ หรือจุดประสงค์คืออะไร? จริง ๆ แล้วต้องไปที่การเงิน > รออนุมัติ รึเปล่า?"*
 *
 * คำตอบคือ "ไม่ใช่" — สลิปพวกนี้ **ตกจากคิวรออนุมัติไปแล้วตามนิยาม** ส่งไปที่นั่นจะเจอคิวว่าง
 * ซึ่งคือความสับสน 13-กับ-0 แบบเดิมอีกรอบ · มันจึงต้องมีหัวข้อของตัวเองใต้คิวนั้น
 *
 * 🔴 ชุดนี้ตรึงสามอย่างที่พังได้คนละแบบ:
 *   · ข้อ 1–2  นิยาม: อะไรคือสลิปค้าง และตัวเลขหน้าหลักต้องมาจากรายการเดียวกับที่หน้าจอแสดง
 *   · ข้อ 3    ปลายทาง: แถวบนหน้าหลักต้องพาไปที่ที่มีของจริง
 *   · ข้อ 4    ความปลอดภัยของเงิน: ต้องไม่มีปุ่มที่ทำให้บันทึกเงินก้อนเดิมซ้ำ
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
const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

const MONTH = '2026-09';
function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, end: '17:00' }], Departments: 'Nursery 1' },
    students: [{ StudentID: 'STD-1', NameTH: 'น้องอาร์ม', Nickname: 'อาร์ม', Class: 'Nursery 1',
      Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-01-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'คุณแม่' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1' }],
    // บิลสองใบ: ใบหนึ่งยังรอตรวจ (อยู่ในคิว) อีกใบถูกปิดด้วยเงินสดไปแล้ว (ตกจากคิว)
    payments: [
      { BillingID: 'BIL-OPEN', StudentID: 'STD-1', Month: MONTH, Amount: 5900, Status: 'PENDING_VERIFY', PaymentMethod: 'transfer' },
      { BillingID: 'BIL-CASH', StudentID: 'STD-1', Month: '2026-08', Amount: 5900, Status: 'PAID', PaymentMethod: 'cash' }
    ],
    paymentSlips: [
      { SlipID: 'SLP-1', RefKind: 'bill', RefID: 'BIL-OPEN', StudentID: 'STD-1', Amount: 5900, Url: 'u1', Status: 'SUBMITTED' },
      { SlipID: 'SLP-2', RefKind: 'bill', RefID: 'BIL-CASH', StudentID: 'STD-1', Amount: 5900, Url: 'u2', Status: 'SUBMITTED' },
      { SlipID: 'SLP-3', RefKind: 'bill', RefID: 'BIL-GONE', StudentID: 'STD-1', Amount: 300, Url: 'u3', Status: 'SUBMITTED' },
      { SlipID: 'SLP-4', RefKind: 'bill', RefID: 'BIL-CASH', StudentID: 'STD-1', Amount: 100, Url: 'u4', Status: 'REJECTED' }
    ],
    prepayments: [], studentCharges: [], otDaily: [], otRecords: [], payroll: [], userLinks: [],
    feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], activityLog: [], studentLeaves: [],
    comments: [], assessments: [], dspm: [], leaves: [], announcements: [], withdrawals: [],
    attendanceReq: [], classChangeReq: [], absenceLog: [], journals: []
  };
  return { M, H: createAtomAPI(M).H };
}
const ADMIN = { staffId: 'STF-A' };

// ============================================================================
console.log('\n1) อะไรคือ "สลิปค้าง" — SUBMITTED และไม่อยู่ในคิวตรวจ');
{
  const { H } = fresh();
  const got = (H.orphanSlips(ADMIN) || []).map(x => x.slipId).sort();
  /* SLP-1 อยู่ในคิว (บิลยังรอตรวจ) · SLP-4 ถูกปฏิเสธไปแล้ว ไม่ใช่ของค้าง
   * เหลือ SLP-2 (บิลปิดด้วยเงินสด) กับ SLP-3 (บิลหายไปจากระบบ) */
  eq('นับเฉพาะสองใบที่ตกคิวจริง', got, ['SLP-2', 'SLP-3']);
  const q = (H.pendingPayments({}) || []);
  const inQ = []; q.forEach(x => (x.slips || []).forEach(s => inQ.push(s.slipId)));
  ok_('ใบที่อยู่ในคิวไม่ถูกนับซ้ำที่นี่', inQ.indexOf('SLP-2') < 0 && inQ.indexOf('SLP-1') >= 0);
}

// ============================================================================
console.log('\n2) แต่ละแถวต้องบอก "ทำไมมันค้าง" — ไม่งั้นแอดมินตัดสินใจไม่ได้');
{
  const { H } = fresh();
  const by = {}; (H.orphanSlips(ADMIN) || []).forEach(x => by[x.slipId] = x);
  /* "บิลถูกลบไปแล้ว" กับ "รับเป็นเงินสดไปแล้ว" คือคนละปัญหาและต้องทำคนละอย่าง
   * ถ้าหน้าจอบอกแค่ว่า "ค้าง" เฉย ๆ มันก็คือแถวบนหน้าหลักเดิมที่กดแล้วไม่รู้จะทำอะไรต่อ */
  eq('ใบที่บิลปิดด้วยเงินสด บอกสถานะและวิธีจ่ายของบิลนั้น',
    [by['SLP-2'].targetStatus, by['SLP-2'].targetMethod, by['SLP-2'].targetMissing], ['PAID', 'cash', false]);
  eq('ใบที่บิลหายไป บอกว่าหาไม่เจอ', by['SLP-3'].targetMissing, true);
  ok_('มีชื่อเด็กให้จับต้นทางได้', by['SLP-2'].nick === 'อาร์ม' && by['SLP-2'].studentId === 'STD-1');
  ok_('มีรูปสลิปและยอดเงิน', by['SLP-2'].url === 'u2' && by['SLP-2'].amount === 5900);
}

// ============================================================================
console.log('\n3) ตัวเลขบนหน้าหลัก กับรายการที่หน้าจอแสดง ต้องมาจากที่เดียวกัน');
{
  const { H } = fresh();
  const td = H.adminTodo(ADMIN) || {};
  const item = (td.items || []).find(x => x.key === 'orphanSlips') || {};
  /* 🔴 นี่คือบั๊ก 13-กับ-0 ในรูปใหม่ · ถ้าวันหนึ่งเงื่อนไขถูกเขียนซ้ำสองที่แล้วแก้ไปที่เดียว
   * หน้าหลักจะบอกเลขหนึ่ง หน้าการเงินจะแสดงอีกจำนวนหนึ่ง และไม่มีอะไรบอกว่าอันไหนถูก */
  eq('ตัวเลขบนการ์ด = จำนวนรายการที่หน้าการเงินจะแสดง', item.n, (H.orphanSlips(ADMIN) || []).length);
  ok_('และต้องไม่เป็น 0 ในเคสนี้ (ไม่งั้นข้อบนผ่านแบบว่างเปล่า)', item.n === 2);

  // ปลายทางของแถว — ก่อนหน้านี้ไม่มี จึงตกไป GO('manage') ซึ่งไม่เกี่ยวอะไรเลย
  const go = app.slice(app.indexOf('const TODO_GO = {'), app.indexOf('const TODO_TONE'));
  ok_('แถวนี้มีปลายทางของตัวเองแล้ว', /orphanSlips:\s*"A_finTab\('wait'\)"/.test(go));
  ok_('และไม่ได้พาไปหน้าจัดการข้อมูลอีก', !/orphanSlips:\s*"GO\('manage'\)"/.test(go));
  // ...และหน้าการเงินต้องวาดหัวข้อนั้นจริงบนแท็บนั้น
  ok_('แท็บรออนุมัติวาดหัวข้อสลิปค้างต่อท้ายคิว', /const waitTab=[\s\S]{0,400}A_orphanSlipsHTML\(orph/.test(app));
  ok_('ดึงข้อมูลเฉพาะตอนอยู่แท็บนั้น ไม่ได้ดึงทุกแท็บ', /FIN_TAB==='wait'\?api\('orphanSlips'\)/.test(app));
}

// ============================================================================
console.log('\n4) 🔴 ต้องไม่มีปุ่มที่บันทึกเงินก้อนเดิมซ้ำ');
{
  const sec = app.slice(app.indexOf('window.A_orphanSlipsHTML=(list)=>{'), app.indexOf('function slipThumb2'));
  /* รายการต้นทางปิดไปแล้ว · การกดยืนยันสลิปจะไปเพิ่มยอดที่ยืนยันแล้วของรายการที่จ่ายไปแล้ว
   * เรื่องเงินพลาดครั้งเดียวเสียความน่าเชื่อถือ — ปุ่มที่ทำให้ยอดซ้ำได้ ไม่ควรมีอยู่ตั้งแต่แรก */
  ok_('ไม่มีปุ่มยืนยันสลิปในหัวข้อนี้', !/A_confirmSlip/.test(sec));
  ok_('มีทางเคลียร์ (ปฏิเสธสลิป)', /A_rejectSlip/.test(sec));
  ok_('และมีทางไปแก้ที่ต้นทาง ถ้าการปิดนั้นผิด', /A_finStudent/.test(sec));
  ok_('อธิบายให้คนอ่านรู้ว่าทำไมถึงไม่มีปุ่มยืนยัน', /บันทึกเงินก้อนเดิมซ้ำ/.test(sec));
  /* คลาสปุ่มที่ไม่มีอยู่จริง = ปุ่มอันตรายที่หน้าตาเหมือนปุ่มธรรมดา · แอปนี้มีแค่ pink/green/gray */
  ok_('ใช้คลาสปุ่มที่มีอยู่จริงในแอป', !/class="btn[^"]*\b(bad|red|danger)\b/.test(sec));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
