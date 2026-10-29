/**
 * tools/test_pause_edit.js — แก้ไข "วันกลับมาเรียน" ของนักเรียนที่ลาชั่วคราว
 *   node tools/test_pause_edit.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-29:
 *   "เคสนักเรียนลาชั่วคราว ก่อนหน้าเคยใส่ว่ากลับมาวันที่ 01/11/2026 วันนี้แก้ไขยังไม่ใส่กำหนด
 *    กลับมาเรียน แต่หน้าที่ผู้ปกครองเห็นยังเป็นวันที่ 01/11/2026 ตรวจสอบทีว่าทำไมไม่อัพเดท"
 *
 * 🔴 สาเหตุจริงไม่ใช่แคชและไม่ใช่การเขียนข้อมูล — ฝั่งเซิร์ฟเวอร์ลบวันกลับได้ถูกต้องมาตลอด
 * (ข้อ 1 ของชุดนี้พิสูจน์) แต่ "ไม่มีปุ่มให้แก้" เลย: เมื่อนักเรียนอยู่สถานะ PAUSED แล้ว
 * A_pauseBox จะแสดงแค่ปุ่ม ▶️ กลับมาเรียนตามปกติ ปุ่ม ⏸️ ที่เปิดฟอร์มถูกซ่อนไปจนจบการลา
 * วันที่จึง "ไม่อัพเดท" เพราะมันไม่เคยถูกแก้ — หน้าผู้ปกครองแสดงความจริงอยู่แล้ว
 *
 * ชุดนี้จึงตรึงสองอย่างที่ต่างกัน:
 *   · ข้อ 1–2  พฤติกรรมของข้อมูล: ลบวันกลับแล้วต้องว่างจริง และทุกหน้าต้องเห็นตรงกัน
 *   · ข้อ 3–4  ทางที่จะไปถึงมันได้: ต้องมีปุ่มแก้ และฟอร์มต้องเปิดมาพร้อมค่าที่บันทึกไว้
 *             (ฟอร์มที่เปิดมาว่างเปล่าแก้ข้อมูลไม่ได้ — มันรีเซ็ตวันเริ่มลาเป็นวันนี้เงียบ ๆ)
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

function fresh() {
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, end: '17:00' }],
      Departments: 'Nursery 1', DefaultCheckOutTime: '17:00' },
    students: [{ StudentID: 'STD-1', NameTH: 'น้องอาร์ม', Nickname: 'อาร์ม', Class: 'Nursery 1',
      Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-1', DOB: '2023-01-01' }],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'คุณแม่' }],
    classes: [{ ClassID: 'C1', ClassName: 'Nursery 1' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], userLinks: [], feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [],
    studentAttendanceToday: [], staffAttendanceToday: [], activityLog: [], studentLeaves: [],
    comments: [], assessments: [], dspm: [], leaves: [], announcements: [], withdrawals: [],
    attendanceReq: [], classChangeReq: [], absenceLog: []
  };
  return { M, H: createAtomAPI(M).H };
}
const ADMIN = { staffId: 'STF-A' };
const PARENT = { uid: 'U1', parentId: 'PAR-1', role: 'Parent' };

// ============================================================================
console.log('\n1) ลบวันกลับมาเรียนออก — ต้องว่างจริง ไม่ใช่คงค่าเดิมไว้');
{
  const { M, H } = fresh();
  H.setStudentPause(Object.assign({ studentId: 'STD-1', paused: true, from: '2026-10-01',
    to: '2026-11-01', reason: 'ไปต่างประเทศ' }, ADMIN));
  eq('ตั้งค่าแรกแล้วมีวันกลับ', String(M.students[0].PauseTo || ''), '2026-11-01');
  /* 🔴 หัวใจของเคสนี้ · ส่ง to เป็นค่าว่างแล้วช่องต้องว่าง — ถ้า handler ตีความ "ว่าง" ว่า
   * "ไม่ได้ส่งมา ไม่ต้องแตะ" (patch แบบ merge ที่พบบ่อย) ค่าเดิมจะค้างอยู่ และนั่นคือ
   * อาการที่ ผอ. เห็น พอดี ชุดนี้จึงต้องเช็กที่ตัวช่องในชีต ไม่ใช่ที่ค่าที่ handler คืนมา */
  H.setStudentPause(Object.assign({ studentId: 'STD-1', paused: true, from: '2026-10-01',
    to: '', reason: 'ไปต่างประเทศ' }, ADMIN));
  eq('ลบวันกลับแล้วช่อง PauseTo ว่าง', String(M.students[0].PauseTo || ''), '');
  eq('วันเริ่มลาไม่ถูกแตะ', String(M.students[0].PauseFrom || ''), '2026-10-01');
  eq('เหตุผลยังอยู่', String(M.students[0].PauseReason || ''), 'ไปต่างประเทศ');
  ok_('ยังลาชั่วคราวอยู่ (ไม่ใช่กลับมาเรียน)', String(M.students[0].Status) === 'PAUSED');
}

// ============================================================================
console.log('\n2) ผู้ปกครอง · แอดมิน · การ์ดหน้าหลัก ต้องเห็นวันเดียวกันเสมอ');
{
  const { H } = fresh();
  const seen = () => ({
    parent: String((H.parentChildren(PARENT)[0] || {}).pauseTo || ''),
    home:   String((H.parentHome(PARENT).children[0] || {}).pauseTo || ''),
    roster: String((H.listStudents(ADMIN).find(s => s.StudentID === 'STD-1') || {}).pauseTo || ''),
    card:   String(((H.pausedStudents(ADMIN) || []).find(x => x.studentId === 'STD-1') || {}).to || '')
  });
  H.setStudentPause(Object.assign({ studentId: 'STD-1', paused: true, from: '2026-10-01', to: '2026-11-01' }, ADMIN));
  eq('ทั้งสี่หน้าเห็น 2026-11-01', seen(), { parent: '2026-11-01', home: '2026-11-01', roster: '2026-11-01', card: '2026-11-01' });
  /* สี่หน้าอ่านจากช่องเดียวกัน — ตัวเลขสองตัวที่ตอบคำถามเดียวกันต้องมาจากที่เดียวกัน
   * ถ้าหน้าใดหน้าหนึ่งหลุด แปลว่ามีใครเก็บสำเนาไว้เอง ซึ่งเป็นบั๊กคนละตัวแต่อาการเดียวกัน */
  H.setStudentPause(Object.assign({ studentId: 'STD-1', paused: true, from: '2026-10-01', to: '' }, ADMIN));
  eq('ลบแล้วทั้งสี่หน้าว่างพร้อมกัน', seen(), { parent: '', home: '', roster: '', card: '' });
}

// ============================================================================
console.log('\n3) ต้องมี "ทาง" ไปแก้ — นักเรียนที่ลาอยู่แล้วต้องเปิดฟอร์มได้');
{
  const box = app.slice(app.indexOf('function A_pauseBox(s){'), app.indexOf('/* ===== THE SAME THING FOR A STAFF MEMBER'));
  ok_('กล่องของคนที่ลาอยู่มีปุ่มกลับมาเรียน', /A_resumeStudent\(/.test(box));
  /* 🔴 ข้อที่พลาดไปทั้งเวอร์ชัน · เงื่อนไข isPaused(s) คืนปุ่มเดียวแล้ว return ออกไปเลย
   * ปุ่ม ⏸️ ที่เปิดฟอร์ม (A_pauseForm) อยู่หลัง return จึงไม่เคยถูกวาดระหว่างการลา
   * ตรึงไว้ว่า "สาขาของคนที่ลาอยู่" ต้องเรียก A_pauseForm ด้วย ไม่ใช่แค่มีอยู่ในไฟล์ */
  const paused = box.slice(box.indexOf('if(isPaused(s)){'), box.indexOf('</div>`;') + 8);
  ok_('กล่องของคนที่ลาอยู่มีปุ่มแก้ไขที่เปิดฟอร์มเดียวกัน', /A_pauseForm\(/.test(paused));
  const card = app.slice(app.indexOf('window.A_pausedCard=(list)=>{'), app.indexOf('window.A_pausedCard=(list)=>{') + 4000);
  ok_('การ์ดหน้าหลักก็แก้ได้จากที่เดิม', /A_pauseForm\(/.test(card));
}

// ============================================================================
console.log('\n4) ฟอร์มต้องเปิดมาพร้อมค่าที่บันทึกไว้ — ไม่ใช่ฟอร์มเปล่า');
{
  const form = app.slice(app.indexOf('window.A_pauseForm=(sid,pre,back)=>{'), app.indexOf('window.A_pauseDo=async'));
  ok_('มีการอ่านค่าที่บันทึกไว้จากตัวนักเรียน', /s\.PauseFrom/.test(form) && /s\.PauseTo/.test(form));
  /* วันเริ่มลาต้องเป็นค่าเดิม ถ้ามี · ก่อนรอบนี้ค่าเริ่มต้นคือ todayStr() เสมอ แปลว่าการ
   * "แก้วันกลับ" ของเด็กที่ลามาตั้งแต่ 01/10 จะย้ายวันเริ่มลาไปเป็นวันนี้โดยไม่บอกใคร
   * ซึ่งทำให้บิลของเดือนที่ผ่านมาเปลี่ยนความหมาย — เรื่องเงิน ไม่ใช่เรื่องหน้าตา */
  ok_('วันเริ่มลาใช้ค่าเดิมก่อน แล้วค่อย fallback เป็นวันนี้', /cFrom\|\|todayStr\(\)/.test(form));
  ok_('ช่องวันกลับเปิดมาพร้อมค่าเดิม', /id="pz_to" value="\$\{esc\(cTo\)\}"/.test(form));
  ok_('ช่องเหตุผลเปิดมาพร้อมค่าเดิม', /id="pz_why" value="\$\{esc\(s\.PauseReason\|\|''\)\}"/.test(form));
  /* 🔴 เหตุผลเป็นข้อความอิสระที่แอดมินพิมพ์เอง และ esc() ไม่แตะ ' (มันหนีอักขระสำหรับ HTML
   * ไม่ใช่สำหรับสตริงใน JS) · ถ้าเอาค่ามาต่อเป็นสตริงใน onclick เครื่องหมาย ' เดียว
   * ก็ทำให้ปุ่มตาย ชุดนี้จึงตรึงว่าการ์ดต้องส่ง "คีย์" ไม่ใช่ข้อมูล */
  const card = app.slice(app.indexOf('window.A_pausedCard=(list)=>{'), app.indexOf('window.A_pausedCard=(list)=>{') + 4000);
  ok_('การ์ดส่งคีย์ ไม่ใช่ PauseReason ที่ต่อเป็นสตริง', /A_pauseForm\(.{0,40}?,'card',/.test(card) && !/PauseReason:'\$\{esc/.test(card));
  ok_('ฟอร์มรู้จักคีย์นั้น', /pre==='card'/.test(form));
}

// ============================================================================
console.log('\n5) ข้อความยืนยันต้องบอกว่าวันกลับกลายเป็นอะไร');
{
  const dо = app.slice(app.indexOf('window.A_pauseDo=async'), app.indexOf('window.A_resumeStudent='));
  /* "บันทึกแล้ว" เฉย ๆ คือสิ่งที่ทำให้การแก้ที่ไม่เคยเกิดขึ้น ดูเหมือนเกิดขึ้นแล้ว */
  ok_('มีสองกรณี — มีวันกลับ และยังไม่กำหนด', /ยังไม่กำหนดวันกลับ/.test(dо) && /กลับมาเรียน \$\{ddmmyyyy\(to\)\}/.test(dо));
  ok_('กลับไปหน้าที่กดมา ไม่ใช่เด้งไปหน้าจัดการเสมอ', /GO\(back\|\|'manage'\)/.test(dо));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
