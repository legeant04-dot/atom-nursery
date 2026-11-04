/**
 * tools/test_bill_document.js — ใบเสร็จรับเงิน / ใบแจ้งหนี้: what is printed on them
 *   node tools/test_bill_document.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-11-03: ใบเสร็จ A5 แนวนอน ดาวน์โหลดเป็น .pdf เท่านั้น + ใบแจ้งหนี้จากข้อมูลเดียวกัน
 * มีชื่อเต็ม/ที่อยู่/เบอร์/LINE ของโรงเรียน · รหัสนักเรียนและชั้น · ผู้ชำระ · วิธีชำระ (ธนาคาร/เลขอ้างอิง)
 * · จำนวนเงินตัวอักษร · สถานะภาษี · ลายเซ็นผู้รับเงิน · วันที่ออกเอกสารแยกจากวันที่ชำระ
 *
 * Decisions (answered "ตามที่แนะนำทั้งหมด"):
 *   ผู้ชำระ = ชื่อบัญชีผู้โอนจากสลิป, ไม่มีก็ชื่อผู้ปกครอง · เลขที่ = RC- + เลขบิล
 *   วันที่ออกใบเสร็จ = วันที่โรงเรียนยืนยันรับเงิน (ไม่ใช่วันที่กดดาวน์โหลด) · ใบแจ้งหนี้ = วันที่ออกบิล
 *   ลายเซ็นเฉพาะใบเสร็จ · ปุ่มอยู่ทั้งหน้าผู้ปกครองและหน้าการเงินของแอดมิน
 *
 * The PDF is drawn on the phone (webapp/receipt.js); WHAT goes on it is billDocument in the engine,
 * which is what this suite pins down.
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

function fresh(school) {
  const M = {
    config: { SchoolName: school === undefined ? 'Atom Nursery' : school,
      Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 6900, end: '17:00' }], Departments: 'Nursery 2' },
    students: [{ StudentID: 'STD-018', NameTH: 'ปาริมิตา เทียนชัย', Nickname: 'เลอา', Class: 'Nursery 2', Plan: 'p1',
      Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-01-01', EnrollDate: '2025-01-01' },
      { StudentID: 'STD-099', NameTH: 'เด็กอีกคน', Nickname: 'อีกคน', Class: 'Nursery 2', Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-2',
        DOB: '2023-01-01', EnrollDate: '2025-01-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }, { StaffID: 'STF-T', NameTH: 'ครู', Role: 'Teacher' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'สมใจ เทียนชัย' }, { ParentID: 'PAR-2', NameTH: 'คนอื่น' }],
    classes: [{ ClassID: 'C2', ClassName: 'Nursery 2' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [],
    userLinks: [], feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], activityLog: [], studentLeaves: [], comments: [],
    assessments: [], dspm: [], leaves: [], announcements: [], withdrawals: [], attendanceReq: [], classChangeReq: [],
    absenceLog: [], journals: []
  };
  return { M, H: createAtomAPI(M).H };
}
const doc = (H, b, sid) => H.billDocument({ studentId: sid || 'STD-018', billingId: b.BillingID });

// ============================================================================
console.log('\n1) จำนวนเงินตัวอักษร — ต้องตรงกับ BAHTTEXT ที่นักบัญชีใช้เทียบ');
{
  const { M, H } = fresh();
  const words = n => { M.payments.length = 0; const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11', amount: n }, ADMIN)); return doc(H, b).words; };
  eq('6,900', words(6900), 'หกพันเก้าร้อยบาทถ้วน');
  eq('1', words(1), 'หนึ่งบาทถ้วน');
  eq('11 → สิบเอ็ด', words(11), 'สิบเอ็ดบาทถ้วน');
  eq('21 → ยี่สิบเอ็ด', words(21), 'ยี่สิบเอ็ดบาทถ้วน');
  eq('101 → หนึ่งร้อยเอ็ด', words(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
  eq('8,800', words(8800), 'แปดพันแปดร้อยบาทถ้วน');
  eq('1,000,001 → หนึ่งล้านเอ็ด', words(1000001), 'หนึ่งล้านเอ็ดบาทถ้วน');
  eq('21,500,000', words(21500000), 'ยี่สิบเอ็ดล้านห้าแสนบาทถ้วน');
  eq('สตางค์', words(1250.5), 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์');
}

// ============================================================================
console.log('\n2) ยังไม่จ่าย → ใบแจ้งหนี้ · จ่ายครบ → ใบเสร็จ');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11' }, ADMIN));
  let d = doc(H, b);
  eq('ใบแจ้งหนี้ ใช้เลขบิล', [d.kind, d.no], ['invoice', 'BL-2026-11-STD-018']);
  ok_('ใบแจ้งหนี้มีวันที่ออกบิล', /^\d{4}-\d{2}-\d{2}$/.test(d.issueDate) && d.issueDate === M.payments[0].IssuedDate);
  eq('ครบกำหนด', d.dueDate, M.payments[0].DueDate);
  eq('ข้อมูลนักเรียน: ชื่อ ชื่อเล่น รหัส ชั้น', d.student, { id: 'STD-018', name: 'ปาริมิตา เทียนชัย', nick: 'เลอา', className: 'Nursery 2' });

  M.paymentSlips.push({ SlipID: 'S1', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-018', Amount: 6900, Url: 'u',
    Status: 'SUBMITTED', TransDate: '2026-10-31', TransTime: '18:42', TransRef: '016304115822CTF07438', Sender: 'นางสาวสมใจ เทียนชัย', SendBank: '004' });
  H.confirmSlip(Object.assign({ slipId: 'S1' }, ADMIN));
  d = doc(H, b);
  eq('ใบเสร็จ เลข RC- ตามบิล', [d.kind, d.no], ['receipt', 'RC-2026-11-STD-018']);
  eq('ผู้ชำระ = ชื่อบัญชีที่อ่านจากสลิป', d.payer, 'นางสาวสมใจ เทียนชัย');
  eq('วิธีชำระ: โอน ธนาคาร เลขอ้างอิง', [d.payments[0].method, d.payments[0].bank, d.payments[0].ref], ['transfer', '004', '016304115822CTF07438']);
  eq('วันที่ชำระจริง = วันที่โอนบนสลิป', [d.paidDate, d.paidTime], ['2026-10-31', '18:42']);
  /* 🔴 ข้อนี้คือคำขอ: วันที่ออกเอกสารต้องแยกจากวันที่เงินเข้า */
  ok_('🔴 วันที่ออกใบเสร็จ = วันที่โรงเรียนยืนยัน ไม่ใช่วันที่โอน', d.issueDate === M.payments[0].ReceiptDate && d.issueDate !== d.paidDate);
  eq('ตัวอักษร', d.words, 'หกพันเก้าร้อยบาทถ้วน');
}

// ============================================================================
console.log('\n3) วันที่ออกใบเสร็จไม่เปลี่ยนเมื่อดาวน์โหลดซ้ำ หรือคำนวณซ้ำ');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11' }, ADMIN));
  M.paymentSlips.push({ SlipID: 'S1', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-018', Amount: 6900, Url: 'u', Status: 'SUBMITTED' });
  H.confirmSlip(Object.assign({ slipId: 'S1' }, ADMIN));
  M.payments[0].ReceiptDate = '2026-11-01';          // as if confirmed two days ago
  H.confirmSlip(Object.assign({ slipId: 'S1' }, ADMIN));   // recompute on an already-PAID bill
  eq('🔴 ยังเป็นวันเดิม', doc(H, b).issueDate, '2026-11-01');
  eq('บิลเก่าที่ไม่มี ReceiptDate ใช้ PaidDate', (delete M.payments[0].ReceiptDate, doc(H, b).issueDate), M.payments[0].PaidDate);
}

// ============================================================================
console.log('\n4) ผู้ชำระเมื่อสลิปไม่มีชื่อ · เงินสด · ชำระบางส่วน');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11' }, ADMIN));
  M.paymentSlips.push({ SlipID: 'C1', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-018', Amount: 2000, Url: '', Method: 'cash',
    Status: 'SUBMITTED', StatedDate: '2026-11-02' });
  H.confirmSlip(Object.assign({ slipId: 'C1' }, ADMIN));
  let d = doc(H, b);
  eq('จ่ายไม่ครบ → ยังเป็นใบแจ้งหนี้', d.kind, 'invoice');
  eq('...แสดงยอดที่จ่ายแล้วและยอดคงค้าง', [d.paidSoFar, d.outstanding], [2000, 4900]);
  eq('...ตัวอักษรเป็นยอดคงค้าง', d.words, 'สี่พันเก้าร้อยบาทถ้วน');
  M.paymentSlips.push({ SlipID: 'C2', RefKind: 'bill', RefID: b.BillingID, StudentID: 'STD-018', Amount: 4900, Url: '', Method: 'cash', Status: 'SUBMITTED' });
  H.confirmSlip(Object.assign({ slipId: 'C2' }, ADMIN));
  d = doc(H, b);
  eq('ครบแล้ว → ใบเสร็จ', d.kind, 'receipt');
  eq('เงินสด ไม่มีชื่อบนสลิป → ใช้ชื่อผู้ปกครอง', d.payer, 'สมใจ เทียนชัย');
  eq('วิธีชำระ: เงินสดสองครั้ง', d.payments.map(x => x.method), ['cash', 'cash']);
}

// ============================================================================
console.log('\n5) เดือนที่ชำระล่วงหน้าแล้ว: ใบเสร็จบอกว่าจ่ายด้วยการชำระล่วงหน้าใบไหน');
{
  const { M, H } = fresh();
  M.prepayments.push({ PrepayID: 'PP-1', StudentID: 'STD-018', Months: 3, Discount: 10, Amount: 18630, Covered: ['2026-10', '2026-11', '2026-12'],
    Status: 'PAID', PaidDate: '2026-09-28' });
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11', amount: 6900 }, ADMIN));
  const d = doc(H, b);
  eq('ครบด้วยเงินล่วงหน้า → ใบเสร็จ ยอด 0', [d.kind, d.total], ['receipt', 0]);
  eq('รายการมีบรรทัดหักค่าเทอมที่จ่ายล่วงหน้า', d.items.map(x => x[1]), [6900, -6900]);
  eq('วิธีชำระ = ชำระล่วงหน้า PP-1 วันที่จ่ายจริง', [d.payments[0].method, d.payments[0].ref, d.payments[0].date], ['prepay', 'PP-1', '2026-09-28']);
}

// ============================================================================
console.log('\n6) หัวกระดาษ: ค่าของ Atom ใช้เฉพาะเมื่อโรงเรียนคือ Atom');
{
  let { H } = fresh();
  const s = H.docInfo();
  eq('ชื่อเต็ม', s.DocSchoolName, 'อะตอม เนอสเซอรี่ (Atom Nursery)');
  /* ผอ. รอบ 2: "เอาข้อมูลแขวงลงมาบรรทัดเดียวกันกับเขต" */
  eq('🔴 ที่อยู่บรรทัด 1 จบที่ซอย', s.DocAddress1, '933/149-150 หมู่บ้านพิมพ์ทอง ซ.ลาดพร้าว 101 แยก 35');
  eq('🔴 บรรทัด 2 = แขวง + เขต', s.DocAddress2, 'แขวงคลองเจ้าคุณสิงห์ เขตวังทองหลาง กรุงเทพฯ 10310');
  {
    /* 🔴 แอดมินที่กด "บันทึก" ไปแล้วในรอบแรก เก็บที่อยู่แบบแบ่งเก่าไว้ในตั้งค่า — ต้องไม่ติดค้างแบบเก่า */
    const x = fresh(); x.M.config.DocAddress1 = '933/149-150 หมู่บ้านพิมพ์ทอง ซ.ลาดพร้าว 101 แยก 35 แขวงคลองเจ้าคุณสิงห์';
    x.M.config.DocAddress2 = 'เขตวังทองหลาง กรุงเทพฯ 10310';
    eq('🔴 ค่าแบบเก่าที่บันทึกไว้ → พิมพ์แบบใหม่', [x.H.docInfo().DocAddress1, x.H.docInfo().DocAddress2],
      [s.DocAddress1, s.DocAddress2]);
    x.M.config.DocAddress2 = 'เขตวังทองหลาง กทม. 10310';
    eq('...แต่ที่อยู่ที่แอดมินพิมพ์เองไม่ถูกแตะ', x.H.docInfo().DocAddress2, 'เขตวังทองหลาง กทม. 10310');
  }
  eq('เบอร์ · LINE · ผู้ลงนาม', [s.DocPhone, s.DocLineId, s.DocSignerName], ['02-731-5859, 089-895-5895', '@atomnursery', 'ศิลา เส็งพานิช']);
  eq('สถานะภาษี', s.DocTaxNote, 'ได้รับการยกเว้นภาษีมูลค่าเพิ่มตามประมวลรัษฎากร');
  ({ H } = fresh('โรงเรียนอื่น'));
  const o = H.docInfo();
  eq('🔴 โรงเรียนอื่นไม่ได้ที่อยู่ของ Atom', [o.DocAddress1, o.DocSignerName, o.DocTaxNote], ['', '', '']);
  eq('...ชื่อใช้ SchoolName ของตัวเอง', o.DocSchoolName, 'โรงเรียนอื่น');
  ({ H } = fresh());
  H.saveDocInfo(Object.assign({ DocPhone: '02-000-0000', DocAddress2: '' }, ADMIN));
  eq('แก้ได้ · แถวว่างของ Atom กลับไปใช้ค่าเดิม (ปุ่ม "เพิ่มแถวที่ขาด" เขียนค่าว่าง)', [H.docInfo().DocPhone, H.docInfo().DocAddress2],
    ['02-000-0000', 'แขวงคลองเจ้าคุณสิงห์ เขตวังทองหลาง กรุงเทพฯ 10310']);
  eq('ครูแก้หัวกระดาษไม่ได้', code(() => H.saveDocInfo({ staffId: 'STF-T', DocPhone: 'x' })), 'NO_PERMISSION');
}

// ============================================================================
console.log('\n6b) 🔴 บิลที่แอดมินบันทึกว่าจ่ายแล้วโดยไม่มีสลิป ต้องได้ใบเสร็จ ไม่ใช่ใบแจ้งหนี้');
{
  /* found 2026-11-03 in the demo data: status PAID, no slip row → the slip balance said "owes it all" */
  const { H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11' }, ADMIN));
  H.confirmPayment(Object.assign({ kind: 'bill', id: b.BillingID, method: 'cash', paidDate: '2026-11-02' }, ADMIN));
  const d = doc(H, b);
  eq('🔴 ใบเสร็จ ยอดคงค้าง 0', [d.kind, d.outstanding, d.total], ['receipt', 0, 6900]);
  eq('วิธีชำระ = เงินสด วันที่ที่แอดมินบันทึก', [d.payments[0].method, d.payments[0].date], ['cash', '2026-11-02']);
  eq('ตัวอักษรเป็นยอดเต็ม', d.words, 'หกพันเก้าร้อยบาทถ้วน');
}

console.log('\n6c) 🔴 ใบแจ้งหนี้ของบิลที่ออกก่อน v495 ต้องมีวันที่ออก (ใบแรกจริงขึ้น "–")');
{
  const { M, H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11' }, ADMIN));
  delete M.payments[0].IssuedDate; delete M.payments[0].BillRun;          // as it was before v495
  M.activityLog.forEach(l => { if (l.Target === b.BillingID) l.Timestamp = '2026-10-25 09:12:00'; });
  eq('🔴 อ่านวันที่จากบันทึกการออกบิล', doc(H, b).issueDate, '2026-10-25');
  M.activityLog.length = 0;
  ok_('ไม่มีบันทึกเลย → ใช้วันนี้ ไม่ใช่ขีด', /^\d{4}-\d{2}-\d{2}$/.test(doc(H, b).issueDate));
}

console.log('\n7) บิลของเด็กคนอื่นขอไม่ได้');
{
  const { H } = fresh();
  const b = H.issueBill(Object.assign({ studentId: 'STD-018', month: '2026-11' }, ADMIN));
  eq('ระบุนักเรียนไม่ตรงกับบิล → ไม่พบ', code(() => H.billDocument({ studentId: 'STD-099', billingId: b.BillingID })), 'NOT_FOUND');
}

// ============================================================================
console.log('\n8) ฝั่ง GAS และหน้าจอ');
{
  const pay = R('src/PaySlips.gs'), code_ = R('src/Code.gs'), cfg = R('src/Config.gs'), day6 = R('src/Day6.gs'), app = R('webapp/app.js'),
    rc = R('webapp/receipt.js'), cert = R('src/Certificate.gs');
  ok_('🔴 GAS เขียน ReceiptDate ตอนบิลเปลี่ยนเป็น PAID เท่านั้น', /kind === 'bill' && String\(tgt\.obj\.Status \|\| ''\)\.toUpperCase\(\) !== 'PAID'[\s\S]{0,200}paidPatch\.ReceiptDate/.test(pay));
  ok_('คอลัมน์ IssuedDate/ReceiptDate และ SendBank อยู่ใน schema', /'IssuedDate', 'ReceiptDate'\]/.test(cfg) && /'Method', 'SendBank'/.test(cfg));
  ok_('SlipOK: เก็บธนาคารผู้โอน', /sendBank: String\(d\.sendingBank/.test(day6) && (pay.match(/SendBank: vr\.sendBank/g) || []).length === 2);
  ok_('สลิปรวมหลายบิลก็เก็บชื่อผู้โอนด้วย', /SlipGroup', 'TransDate', 'TransTime', 'StatedDate', 'StatedTime', 'Sender', 'SendBank'/.test(pay));
  ok_('route: saveDocInfo แอดมินเท่านั้น', /markCertIssued: 1, saveDocInfo: 1/.test(code_));
  ok_('🔴 ลายเซ็นและเอกสาร: ครูขอไม่ได้', /FAMILY_DOCS = \{ docSignature: 1, billDocument: 1 \}/.test(code_) && /function handleDocSignature/.test(cert));
  ok_('ลายเซ็นขอเฉพาะตอนเป็นใบเสร็จ', /d\.kind==='receipt'\?api\('docSignature'/.test(app));
  ok_('PDF A5 แนวนอน', /landscape: true, a5: true/.test(rc));
  ok_('ไม่มีปุ่มพิมพ์ HTML แบบเก่าเหลืออยู่', !/buildReceiptHTML|P_receipt/.test(app));
  ok_('ทั้งผู้ปกครองและแอดมินมีปุ่ม', (app.match(/billDocBtn\(sid, b(ill)?\.BillingID/g) || []).length === 2);
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
