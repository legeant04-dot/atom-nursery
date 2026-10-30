/**
 * tools/test_cycle_paused.js — รอบบิล: กลุ่มแยกของนักเรียนที่ลาชั่วคราว
 *   node tools/test_cycle_paused.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-30: *"Admin > การเงิน : รอบบิล — แยกเด็กที่ลาอยู่ออกมาเพิ่มอีกกลุ่ม
 *   เพื่อให้แอดมินตัดสินใจเองว่าจะออกบิลให้เด็กกลุ่มที่ลาอยู่ไหม"*
 *
 * 🔴 หัวใจของชุดนี้คือเรื่องเงิน ไม่ใช่เรื่องการจัดกลุ่ม:
 *   **"ลาอยู่" ไม่ได้แปลว่า "ออกบิลไม่ได้"**
 *   issueBill ปฏิเสธเฉพาะคนที่ลา *ตลอดทั้งเดือน* · เด็กที่ลาครึ่งเดือนยังต้องออกบิลตามปกติ
 *   ถ้าวันหนึ่งมีคนย่อสองอย่างนี้ให้เหลือเงื่อนไขเดียว โรงเรียนจะหยุดเก็บเงินที่ควรเก็บ
 *   โดยไม่มีอะไรบนหน้าจอบอก — ชุดนี้มีไว้ให้ข้อนั้นแดงก่อน
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

const MONTH = '2026-11';            // เดือนในอนาคต เพื่อให้ "ลาตลอดเดือน" คุมได้แน่นอน
const ADMIN = { staffId: 'STF-A' };

function fresh() {
  const kid = (id, nick, extra) => Object.assign({
    StudentID: id, NameTH: 'น้อง' + nick, Nickname: nick, Class: 'Nursery 1',
    Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-' + id, DOB: '2023-01-01', EnrollDate: '2025-01-01'
  }, extra || {});
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 6900, end: '17:00' }],
      Departments: 'Nursery 1', BillingDay: 5 },
    students: [
      kid('S-NORMAL', 'อาร์ม'),
      kid('S-OWNDAY', 'ใยไหม', { BillingDay: 15 }),
      // ลาตลอดเดือน พ.ย. — issueBill ต้องปฏิเสธ
      kid('S-ALLMONTH', 'บีม', { Status: 'PAUSED', PauseFrom: '2026-10-20', PauseTo: '2026-12-10' }),
      // ลาแค่ครึ่งเดือน — ยังออกบิลได้
      kid('S-HALF', 'ปลื้ม', { Status: 'PAUSED', PauseFrom: '2026-10-20', PauseTo: '2026-11-16' })
    ],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [], classes: [{ ClassID: 'C1', ClassName: 'Nursery 1' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], userLinks: [], feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [],
    studentAttendanceToday: [], staffAttendanceToday: [], staffAttendanceHistory: [], activityLog: [],
    studentLeaves: [], comments: [], assessments: [], dspm: [], leaves: [], announcements: [],
    withdrawals: [], attendanceReq: [], classChangeReq: [], absenceLog: [], journals: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) คนที่ลาอยู่ต้องไม่ปนอยู่ในกลุ่มวันอีกต่อไป');
{
  const { H } = fresh();
  const bg = H.billingGroups(Object.assign({ month: MONTH }, ADMIN));
  const inDays = [];
  (bg.groups || []).forEach(g => g.students.forEach(s => inDays.push(s.studentId)));
  eq('กลุ่มวันเหลือเฉพาะคนที่ไม่ได้ลา', inDays.sort(), ['S-NORMAL', 'S-OWNDAY']);
  ok_('มีกลุ่มแยกของคนที่ลา', !!bg.pausedGroup);
  eq('กลุ่มแยกมีครบทั้งสองคน',
    (bg.pausedGroup.students || []).map(s => s.studentId).sort(), ['S-ALLMONTH', 'S-HALF']);
  /* total ต้องยังนับทุกคน — ถ้าการแยกกลุ่มทำให้ยอดรวมหาย แอดมินจะไม่มีทางรู้ว่ามีเด็กตกหล่น */
  eq('ยอดรวมยังครบทุกคน', bg.total, 4);
}

// ============================================================================
console.log('\n2) 🔴 "ลาอยู่" กับ "ออกบิลไม่ได้" เป็นคนละเรื่อง');
{
  const { H } = fresh();
  const bg = H.billingGroups(Object.assign({ month: MONTH }, ADMIN));
  const by = {}; bg.pausedGroup.students.forEach(s => by[s.studentId] = s);
  ok_('ทั้งสองคนถูกทำเครื่องหมายว่าลาอยู่', by['S-ALLMONTH'].paused && by['S-HALF'].paused);
  eq('คนที่ลาตลอดเดือน — pausedMonth = true', by['S-ALLMONTH'].pausedMonth, true);
  eq('คนที่ลาครึ่งเดือน — pausedMonth = false', by['S-HALF'].pausedMonth, false);

  /* 🔴 ข้อที่สำคัญที่สุดของทั้งชุด · ปุ่มต้องนับเฉพาะคนที่ออกบิลได้จริง
   * ถ้าตัวเลขนี้กลายเป็น 2 แปลว่ามีใครย่อ pausedMonth เป็น paused แล้วปุ่มจะสัญญาเกินจริง
   * ถ้ากลายเป็น 0 แปลว่าโรงเรียนหยุดเก็บเงินเด็กที่ลาครึ่งเดือน ซึ่งแย่กว่า */
  eq('ปุ่มนับได้ 1 คน (เฉพาะคนที่ลาครึ่งเดือน)', bg.pausedGroup.pending, 1);
  eq('และบอกว่าอีก 1 คนออกบิลไม่ได้', bg.pausedGroup.blocked, 1);
}

// ============================================================================
console.log('\n3) และเซิร์ฟเวอร์ต้องเห็นด้วยกับตัวเลขบนปุ่ม');
{
  const { H, M } = fresh();
  const bg = H.billingGroups(Object.assign({ month: MONTH }, ADMIN));
  const ids = bg.pausedGroup.students
    .filter(s => !s.billed && !s.prepaid && !s.pausedMonth).map(s => s.studentId);
  /* ยิงผ่านประตูเดียวกับที่หน้าจอใช้ · ถ้าปุ่มบอก 1 แล้วเซิร์ฟเวอร์ออกได้ 1 และข้าม 0
   * แปลว่าหน้าจอกับเซิร์ฟเวอร์ตอบคำถามเดียวกันตรงกัน ซึ่งคือทั้งหมดที่ข้อนี้ต้องการ */
  const r = H.issueBillsFor(Object.assign({ studentIds: ids, month: MONTH }, ADMIN));
  eq('ออกบิลได้เท่ากับที่ปุ่มบอก', [r.created, (r.skipped || []).length], [1, 0]);
  eq('และเป็นของคนที่ลาครึ่งเดือน', (r.students || []).map(x => x.studentId), ['S-HALF']);
  const b = M.payments.find(x => x.StudentID === 'S-HALF');
  ok_('บิลถูกสร้างจริงในเดือนที่เลือก', !!b && String(b.Month).slice(0, 7) === MONTH);

  // ...และคนที่ลาตลอดเดือน ถ้าฝืนส่งไป ต้องถูกปฏิเสธด้วยรหัสที่อ่านออก
  const r2 = H.issueBillsFor(Object.assign({ studentIds: ['S-ALLMONTH'], month: MONTH }, ADMIN));
  eq('คนที่ลาตลอดเดือนถูกปฏิเสธด้วย STUDENT_PAUSED',
    [r2.created, (r2.skipped[0] || {}).code], [0, 'STUDENT_PAUSED']);
}

// ============================================================================
console.log('\n4) ตัวเลขบนปุ่มของกลุ่มวัน ต้องตรงกับที่มันทำได้จริงด้วย');
{
  const { M, H } = fresh();
  // เด็กที่ยังไม่ถึงวันเริ่มเรียน — issueBill ปฏิเสธเหมือนกัน (NOT_ENROLLED_YET)
  M.students.push({ StudentID: 'S-SOON', NameTH: 'น้องมิว', Nickname: 'มิว', Class: 'Nursery 1',
    Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-X', DOB: '2024-01-01', EnrollDate: '2027-01-05' });
  const bg = H.billingGroups(Object.assign({ month: MONTH }, ADMIN));
  const g5 = (bg.groups || []).find(g => g.day === 5);
  /* 🔴 ของเดิม pending = "ยังไม่ออกบิล และไม่ได้ชำระล่วงหน้า" เฉย ๆ จึงนับคนที่ยังไม่เริ่มเรียนด้วย
   * ปุ่มบอก 2 แล้วออกได้ 1 · คำอธิบายในโค้ดเขียนไว้เองว่า pending ต้องไม่สัญญาเกินกว่าที่ทำได้ */
  eq('คนที่ยังไม่เริ่มเรียนอยู่ในกลุ่ม แต่ไม่ถูกนับบนปุ่ม',
    [g5.students.length, g5.pending], [2, 1]);
  const ids = g5.students.filter(s => !s.billed && !s.prepaid && !s.notStarted).map(s => s.studentId);
  const r = H.issueBillsFor(Object.assign({ studentIds: ids, month: MONTH }, ADMIN));
  eq('ออกบิลได้เท่ากับที่ปุ่มบอก', [r.created, (r.skipped || []).length], [1, 0]);
}

// ============================================================================
console.log('\n5) ไม่มีใครลาเลย ก็ต้องไม่มีกล่องเปล่าโผล่มา');
{
  const { M, H } = fresh();
  M.students = M.students.filter(s => s.Status !== 'PAUSED');
  const bg = H.billingGroups(Object.assign({ month: MONTH }, ADMIN));
  /* กล่องที่ขึ้นทุกวันไม่ว่าจะมีอะไรหรือไม่ คือกล่องที่สายตาเรียนรู้ที่จะข้าม
   * เหตุผลเดียวกับ "สิ่งที่ต้องทำวันนี้" ที่ไม่พิมพ์อะไรเลยเมื่อไม่มีงาน */
  eq('ไม่มีกลุ่มแยก', bg.pausedGroup, null);
  ok_('หน้าจอไม่วาดอะไรเมื่อไม่มีกลุ่ม', /const pg = bg && bg\.pausedGroup; if\(!pg\) return '';/.test(app));
}

// ============================================================================
console.log('\n6) หน้าจอ — ต้องเดินผ่านประตูเดียวกับการออกบิลรอบปกติ');
{
  const fn = app.slice(app.indexOf('window.A_cycleIssuePaused=(btn)=>{'), app.indexOf('window.A_cycleIssueDo=async'));
  ok_('ใช้ route เดิม ไม่ได้เขียนทางออกบิลเส้นที่สอง', /api\('issueBillsFor'/.test(fn));
  ok_('แจ้งผู้ปกครองด้วย route เดิม', /api\('notifyBills'/.test(fn));
  ok_('และรายงานรายการที่ถูกข้ามด้วยหน้าต่างเดิม', /A_skippedModal/.test(fn));
  /* 🔴 ต้องกรอง pausedMonth ออกก่อนส่ง ไม่ใช่ส่งไปให้เซิร์ฟเวอร์ปฏิเสธแล้วค่อยรายงานว่าข้าม
   * ปุ่มที่บอกว่าทำ N คน ต้องทำ N คน */
  ok_('กรองคนที่ลาตลอดเดือนออกก่อนส่ง', /!s\.pausedMonth/.test(fn));
  const sec = app.slice(app.indexOf('function A_cyclePausedHTML(bg){'), app.indexOf("/** Issue this round's bills"));
  ok_('หน้าจอบอกรายคนว่าออกบิลได้หรือไม่ได้', /ลาตลอดเดือน — ออกบิลไม่ได้/.test(sec) && /ลาบางช่วง — ออกบิลได้/.test(sec));
  ok_('ปุ่มบอกจำนวนที่ออกได้จริง', /ออกบิลให้กลุ่มนี้ \(\$\{pg\.pending\} คน\)/.test(sec));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
