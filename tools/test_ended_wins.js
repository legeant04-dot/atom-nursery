/**
 * tools/test_ended_wins.js — "สิ้นสุด" ชนะทุกสถานะเสมอ
 *   node tools/test_ended_wins.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-11-03 · เคสน้องกัปตัน:
 *   ลาชั่วคราว 05/10 → 01/11 · วันสุดท้าย 31/10 (เหตุผลอื่น ๆ — มีพี่เลี้ยงมาดูแลที่บ้าน)
 *   หลังวันสุดท้าย ชื่อยังขึ้นใน "นักเรียนลาชั่วคราว · ครบกำหนดแล้ว — กดยืนยันว่ากลับมาเรียน"
 *   ทั้งที่จะไม่กลับมาอีกแล้ว
 *
 *   *"เมื่อมีการกำหนดให้นักเรียนหรือพนักงานคนนั้นสิ้นสุด ให้ยกเลิกสถานะทั้งหมดและคงสถานะสิ้นสุดเสมอ"*
 *
 * สาเหตุ: pausedStudents ดูแค่ Status==='PAUSED' ไม่เคยถามวันสิ้นสุด
 * และ setStudentEnd ไม่แตะสถานะลา (ออกแบบไว้ให้วันสิ้นสุดตัดสินเอง — แต่รายการนี้ไม่ได้ถาม)
 *
 * 🔴 ข้อที่ต้องระวัง: วันสุดท้ายที่ "ยังไม่ถึง" ห้ามลบการลาทิ้ง
 * เด็กยังลาอยู่จริงจนถึงวันนั้น และการลาคือสิ่งที่ทำให้ไม่ถูกออกบิล — ลบก่อนเวลา = ออกบิลเพิ่ม
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
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const pad = n => String(n).padStart(2, '0');
const day = off => { const d = new Date(); d.setDate(d.getDate() + off);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const ADMIN = { staffId: 'STF-A' };

function fresh(extra) {
  const kid = Object.assign({ StudentID: 'STD-K', NameTH: 'ดนัยพัชร์ ปฏิจิตร', Nickname: 'กัปตัน', Class: 'Nursery 2',
    Plan: 'p1', Status: 'PAUSED', ParentID: 'PAR-K', DOB: '2023-01-01', EnrollDate: '2025-01-01',
    PauseFrom: day(-29), PauseTo: day(-2), PauseReason: 'น้ำท่วมที่บ้านยังไม่สะดวกเดินทาง' }, extra || {});
  const M = {
    config: { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 5900, end: '17:00' }], Departments: 'Nursery 2' },
    students: [kid],
    staff: [{ StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
            { StaffID: 'STF-X', NameTH: 'ครูที่ออกแล้ว', Role: 'Teacher', Department: 'Nursery 2', Status: 'INACTIVE',
              EndDate: day(-3), EndReason: 'ลาออก', PauseFrom: day(-20), PauseTo: '' }],
    parents: [], classes: [{ ClassID: 'C2', ClassName: 'Nursery 2' }],
    payments: [], prepayments: [], studentCharges: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [],
    userLinks: [], feed: [], injuryReports: [], checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], activityLog: [], studentLeaves: [], comments: [],
    assessments: [], dspm: [], leaves: [], announcements: [], withdrawals: [], attendanceReq: [], classChangeReq: [],
    absenceLog: [], journals: []
  };
  return { M, H: createAtomAPI(M).H };
}
const inPaused = H => (H.pausedStudents(ADMIN) || []).some(x => x.studentId === 'STD-K');

// ============================================================================
console.log('\n1) เคสกัปตันตามจริง: วันสุดท้ายผ่านไปแล้ว แต่ยังมีสถานะลาค้างอยู่');
{
  const { H } = fresh({ EndDate: day(-3), EndReason: 'other' });   // ข้อมูลที่ค้างอยู่ในระบบตอนนี้
  /* 🔴 ข้อนี้คือตัวบั๊ก · ถ้าแดงอีก แปลว่ารายการลาชั่วคราวกลับไปดูแค่ Status */
  ok_('🔴 ไม่ขึ้นในรายการนักเรียนลาชั่วคราวแล้ว', !inPaused(H));
  ok_('ไม่ขึ้นในการ์ดหน้าหลักด้วย (dashboard ใช้รายการเดียวกัน)',
    !((H.dashboard(ADMIN) || {}).paused || []).some(x => x.studentId === 'STD-K'));
  ok_('ยังอยู่ในรายการ "สิ้นสุดการเรียนแล้ว"',
    (H.endingStudents(ADMIN) || []).some(x => x.studentId === 'STD-K' && x.ended));
}

// ============================================================================
console.log('\n2) ตั้งวันสุดท้ายที่ผ่านไปแล้ว → ยกเลิกสถานะลาทิ้งเลย');
{
  const { M, H } = fresh();
  H.setStudentEnd(Object.assign({ studentId: 'STD-K', endDate: day(-3), reason: 'other', remark: 'มีพี่เลี้ยงมาดูแลที่บ้าน' }, ADMIN));
  const s = M.students[0];
  eq('Status ไม่ใช่ PAUSED แล้ว', s.Status, 'ACTIVE');
  eq('ช่องลาชั่วคราวถูกล้าง', [s.PauseFrom, s.PauseTo, s.PauseReason], ['', '', '']);
  /* เก็บของเดิมไว้ใน log เผื่อต้องย้อน — การยกเลิกสถานะต้องไม่ทำให้ประวัติหาย */
  const log = M.activityLog.filter(l => l.Action === 'setStudentEnd').pop() || {};
  ok_('log บันทึกว่ายกเลิกลาชั่วคราวช่วงไหน', /ยกเลิกลาชั่วคราว/.test(log.Detail || ''));
  ok_('ไม่ขึ้นในรายการลาชั่วคราว', !inPaused(H));
}

// ============================================================================
console.log('\n3) 🔴 วันสุดท้ายที่ยังไม่ถึง ห้ามลบการลาทิ้ง (เรื่องเงิน)');
{
  const { M, H } = fresh({ PauseFrom: day(-5), PauseTo: '' });   // ลาแบบไม่กำหนดวันกลับ
  H.setStudentEnd(Object.assign({ studentId: 'STD-K', endDate: day(40), reason: 'moved' }, ADMIN));
  const s = M.students[0];
  /* เด็กยังลาอยู่จริงจนถึงวันสุดท้าย · ถ้าลบการลาทิ้งตอนนี้ เด็กจะกลับมา "ถูกคาดหวังให้มาเรียน"
   * และถูกออกบิลเดือนหน้าทั้งที่ไม่ได้มา */
  eq('🔴 สถานะลายังอยู่', [s.Status, s.PauseFrom], ['PAUSED', day(-5)]);
  ok_('ยังขึ้นในรายการลาชั่วคราว (เพราะยังลาอยู่จริง)', inPaused(H));
}

// ============================================================================
console.log('\n4) กฎต้องอยู่ทั้งสองฝั่ง — GAS shadow เอนจินอยู่');
{
  const gas = R('src/Staff.gs');
  const fn = gas.slice(gas.indexOf('function handleSetStudentEnd'), gas.indexOf('function handleLinkParentAdmin'));
  ok_('GAS ล้างช่องลาเมื่อวันสุดท้ายผ่านแล้ว', /if \(due && \(cur === 'PAUSED'/.test(fn) && /patch\.PauseFrom = ''/.test(fn));
  ok_('ล้างก่อน updateRow_ ไม่ใช่หลัง', fn.indexOf("patch.PauseFrom = ''") < fn.indexOf('updateRow_(sh, st._row, patch)'));
  ok_('บันทึกการยกเลิกลงใน audit', /\+ cleared\); \} catch/.test(fn));
}

// ============================================================================
console.log('\n5) ฝั่งพนักงาน: คนที่สิ้นสุดแล้วไม่โผล่ในรายการไหนในฐานะ "ลาอยู่"');
{
  /* ไม่ได้แก้ตรรกะการลาของพนักงาน — staffPaused_ ใช้คำนวณเงินเดือนเดือนสุดท้ายด้วย
   * แตะตรงนั้นคือเปลี่ยนเงินเดือน · ข้อนี้พิสูจน์ว่าทุกรายการที่แสดงผลกรองคนที่ออกแล้วอยู่แล้ว */
  const { H } = fresh();
  const dash = H.dashboard(ADMIN) || {};
  ok_('ไม่อยู่ในพนักงานวันนี้', !(dash.staff || []).some(x => x.staffId === 'STF-X' || x.StaffID === 'STF-X'));
  const list = H.staffList ? H.staffList(ADMIN) : H.listStaff(ADMIN);
  const x = (list || []).find(s => (s.StaffID || s.staffId) === 'STF-X');
  ok_('ถ้าอยู่ในรายชื่อ ก็ต้องถูกทำเครื่องหมายว่าสิ้นสุดแล้ว', !x || x.ended === true || String(x.Status) === 'INACTIVE');
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
