/**
 * tools/test_early_leave.js — leaving before your end time, and the two rows that read as "0/0 *".
 *   node tools/test_early_leave.js
 *
 * Two things the school asked for on 2026-10-12, which turned out to share one subject: a month's
 * attendance only means something if every row on it can be explained.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * §1  ⏪ clocking out early is MEASURED — OT was `max(0, now - end)`, so the other side of that
 *     subtraction was thrown away and a teacher going home two hours early produced a row
 *     identical to one who stayed
 * §2  🔴 the check-out is SAVED BEFORE anybody is asked anything (2026-10-08: four teachers could
 *     not clock out; a dialog in front of a punch is one more way for that to happen)
 * §3  the leave it files is an ORDINARY leave — same route, 0.5 of a day, same two-step approval
 * §4  🪪 somebody exempt from clocking in is counted as present, not absent, and says why
 * §5  ⏸️ somebody on temporary leave keeps the days they DID work, and says since when
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

/* the school's clock, never UTC — see test_queue_hogs §4 */
const ymd = d => { const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const TODAY = ymd(Date.now());
const MONTH = TODAY.slice(0, 7);

function boot(over) {
  const M = Object.assign({
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 3',
      DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00', EarlyLeaveMinutes: '30' },
    staff: [
      { StaffID: 'T1', NameTH: 'ครูหนึ่ง', Role: 'Teacher', Department: 'Nursery 3', PositionLevel: 'Staff',
        Status: 'ACTIVE', StartDate: '2024-01-01', RequireCheckin: true },
      // 🪪 told not to clock in — ครูแพรว2's case
      { StaffID: 'T2', NameTH: 'ครูสอง', Role: 'Teacher', Department: 'Nursery 3', PositionLevel: 'Staff',
        Status: 'ACTIVE', StartDate: '2024-01-01', RequireCheckin: false },
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }
    ],
    staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    leaves: [], otRecords: [], holidays: [], students: [], parents: [], classes: [],
    userLinks: [], payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], holidayAttend: [], studentTerms: []
  }, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) ⏪ ออกก่อนเวลา — ต้องวัดได้ (เดิมถูกทิ้งไปเฉยๆ)');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* OT is max(0, now − end). The other side of the subtraction was never kept, so a teacher who
   * went home at 14:00 produced a row indistinguishable from one who stayed until 17:00. */
  const eng = R('webapp/engine.js'), gas = R('src/Checkin.gs');
  ok_('🔴 engine คำนวณนาทีที่ออกก่อนเวลา', /const earlyMin = holOT\?0:Math\.max\(0, toMin\(outT\)-/.test(eng));
  ok_('🔴 ...และฝั่งที่รันจริงบน live ก็คำนวณเหมือนกัน',
    /var earlyMin = staffHasHolidayOT_[\s\S]{0,80}Math\.max\(0, outMin - minOfDay_\(now\)\)/.test(gas));
  ok_('ทั้งสองฝั่งส่ง earlyMinutes / early กลับไปให้หน้าจอ',
    /earlyMinutes:earlyMin, earlyGate, early:/.test(eng) && /earlyMinutes: earlyMin, earlyGate: earlyGate, early:/.test(gas));

  /* 💰 a day already paid as a lump sum has no end time to be early against — the same exception OT
   * makes, and it has to be the same on both sides or one of them accuses somebody wrongly. */
  ok_('วันที่จ่ายเหมาแล้ว (OT วันหยุด) ไม่นับว่าออกก่อนเวลา',
    /holOT\?0:Math\.max\(0, toMin\(outT\)/.test(eng) && /staffHasHolidayOT_\(staff\.StaffID, today\) \? 0 : Math\.max\(0, outMin/.test(gas));

  console.log('\n   — เกณฑ์ 30 นาที และตั้งค่าได้');
  ok_('ค่าเริ่มต้น 30 นาที ประกาศไว้ใน SCHOOL_CONFIG', /\['EarlyLeaveMinutes',\s*'30'\]/.test(R('src/Config.gs')));
  ok_('🔴 ...อ่านจากค่าตั้งค่า ไม่ใช่เลขตายตัวในโค้ด',
    /cfg\.EarlyLeaveMinutes/.test(eng) && /getConfig_\('EarlyLeaveMinutes'/.test(gas));
  /* 0 switches the prompt off entirely — a school that does not want it must be able to say so
   * without the code being changed, and `>0` is what makes 0 mean off rather than "always". */
  ok_('ตั้งเป็น 0 = ปิดการแจ้งเตือนทั้งหมด',
    /early: earlyMin>=earlyGate && earlyGate>0/.test(eng) && /early: earlyMin >= earlyGate && earlyGate > 0/.test(gas));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 เวลาออกถูกบันทึกก่อน แล้วค่อยถาม');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const app = R('webapp/app.js');
  /* 2026-10-08: four teachers could not clock out at all. A dialog standing between a person and
   * their own check-out is one more way for that evening to repeat — and the school's own answer to
   * "what if they cancel" was "ให้ Check-out ได้ตามปกติ", which a saved punch already is. */
  const punch = app.slice(app.indexOf('window.T_punch=async'), app.indexOf('window.T_punch=async') + 2200);
  ok_('🔴 ถาม "หลัง" ยิง staffCheckout สำเร็จแล้วเท่านั้น',
    punch.indexOf("punchWithRetry(kind==='in'") < punch.indexOf('T_earlyLeave(r)'));
  ok_('...และถามเฉพาะตอนออกก่อนเวลาจริง', /if\(kind==='out' && r && r\.early\)\{ T_earlyLeave\(r\); return; \}/.test(punch));
  ok_('กดยกเลิก = จบเลย เวลาออกยังอยู่ (ไม่ย้อนคืน)',
    /ไม่ต้อง · บันทึกเวลาออกอย่างเดียว/.test(app) && !/undoCheckout|cancelCheckout/.test(app));
  // a stray backdrop tap must not throw the only offer away
  ok_('แตะพื้นหลังแล้วหน้าต่างไม่หายไปเอง', /if\(m\) m\.onclick=null;/.test(app));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) ใบลาที่สร้างให้ เป็นใบลาธรรมดาทุกประการ');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const app = R('webapp/app.js');
  ok_('🔴 ใช้ route submitLeave ตัวเดียวกับการลาด้วยมือ',
    /await api\('submitLeave',\{ staffId:USER\.staffId, type:q\('#elType'\)/.test(app));
  ok_("🔴 หักครึ่งวัน (halfDay:'PM')", /halfDay:'PM'/.test(app));
  ok_('เลือกประเภทลาได้ครบ 3 แบบ เหมือนฟอร์มปกติ',
    /elType[\s\S]{0,400}ลาป่วย[\s\S]{0,200}ลาพักร้อน/.test(app));
  ok_('🔴 ต้องกรอกเหตุผล ไม่งั้นส่งไม่ได้', /if\(!reason\)\{ toast\(/.test(app));
  // 💰 the ฿500 is said BEFORE it is signed, not discovered on a payslip
  ok_('💰 บอกล่วงหน้าว่ากระทบเบี้ยขยัน', /เบี้ยขยันของเดือนนี้/.test(app));
  ok_('...และบอกว่าหักสิทธิลาครึ่งวัน', /หักสิทธิลา <b>ครึ่งวัน \(0\.5\)<\/b>/.test(app));

  // ...and the engine really does make it half a day and route it for approval
  const { H, M } = boot();
  const r = H.submitLeave({ staffId: 'T1', type: 'ลากิจ', startDate: TODAY, endDate: TODAY, halfDay: 'PM', reason: 'มีนัดหมอ' });
  eq('🔴 บันทึกเป็น 0.5 วัน', r.days, 0.5);
  eq('...และเข้าคิวอนุมัติปกติ (หัวหน้าก่อน)', r.status, 'PENDING_LEADER');
  const row = M.leaves.find(x => x.LeaveID === r.leaveId);
  eq('...เก็บประเภทและเหตุผลตามที่กรอก', [row.Type, row.Reason, row.HalfDay], ['ลากิจ', 'มีนัดหมอ', 'PM']);
  // CONTROL — a FULL day through the same route is still 1, so 0.5 came from halfDay and not from
  // something that halves everything
  const full = H.submitLeave({ staffId: 'T1', type: 'ลากิจ', startDate: TODAY, endDate: TODAY, reason: 'x' });
  eq('CONTROL: ลาเต็มวันยังเป็น 1 วัน', full.days, 1);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) 🪪 คนที่ไม่ต้องลงเวลา — นับว่ามาทำงาน ไม่ใช่ขาด');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const { H } = boot();
  const d = H.staffAttendanceMonth({ staffId: 'ADM', month: MONTH });
  const ids = d.staff.map(x => x.staffId).sort();

  /* They used to be filtered out of this screen entirely — which reads as "this person does not
   * work here" rather than "this person does not clock in". */
  ok_('🔴 อยู่ในรายชื่อ (เดิมถูกตัดออกทั้งคน)', ids.indexOf('T2') >= 0);
  eq('CONTROL: แอดมินยังไม่อยู่ในรายชื่อ (บริหารระบบ ไม่ได้เข้ากะ)', ids.indexOf('ADM'), -1);

  const t2 = d.staff.find(x => x.staffId === 'T2');
  const t1 = d.staff.find(x => x.staffId === 'T1');
  ok_('🔴 มีป้ายบอกว่าไม่ต้องลงเวลา', t2.exemptCheckin === true);
  eq('CONTROL: คนที่ต้องลงเวลา ไม่มีป้ายนี้', t1.exemptCheckin, false);

  /* "นับวันมาทำงานปกติเหมือนคุณครูทุกคน" — there is no CHECKIN_STAFF row for them, so every working
   * day used to fall through to ABSENT. */
  /* 🔴 EVERY WORKING DAY THAT HAS HAPPENED, INCLUDING TODAY.
   *
   * Compared against the days elapsed, not `myRequiredToDate` — that field stops BEFORE today on
   * purpose ("today is not over, nobody is absent yet at 07:30"), while somebody who checked in
   * this morning is already counted present for it. An exempt person is present the same way, so
   * the two numbers legitimately differ by one and the first draft of this assertion read that as
   * a bug. The row itself shows present/myRequiredDays — the whole month — so "8 of 22" mid-month
   * is exactly what it should say. */
  const elapsed = (d.requiredDates || []).filter(ds => ds <= TODAY).length;
  eq('🔴 นับเป็นมาทำงานทุกวันทำงานที่ผ่านมาแล้ว', t2.present, elapsed);
  ok_('...และไม่เกินเป้าของทั้งเดือน', t2.present <= t2.myRequiredDays);
  eq('🔴 ...และไม่ขาดสักวัน', t2.absent, 0);
  eq('...ไม่สายด้วย (ไม่มีเวลาให้สาย)', [t2.lateDays, t2.lateMinutes], [0, 0]);
  /* CONTROL — the teacher who DOES clock in and has not, is still absent. Without this, "T2 has no
   * absences" would be satisfied just as well by code that never marks anybody absent. */
  ok_('CONTROL: คนที่ต้องลงเวลาแต่ไม่ได้ลง ยังขึ้นว่าขาดตามเดิม', t1.absent > 0 && t1.present === 0);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) ⏸️ ลาชั่วคราว — เก็บวันที่ทำงานจริงไว้ และบอกว่าตั้งแต่เมื่อไหร่');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* ครูเอสเธอร์'s case: worked the 1st–15th, paused from the 16th. The school asked for those first
   * days to stay in the summary, with a badge saying when the break began. */
  const mid = MONTH + '-16';
  const { H } = boot({ staff: [
    { StaffID: 'T1', NameTH: 'ครูหนึ่ง', Role: 'Teacher', Department: 'Nursery 3', PositionLevel: 'Staff',
      Status: 'ACTIVE', StartDate: '2024-01-01', RequireCheckin: true },
    { StaffID: 'T3', NameTH: 'ครูสาม', Role: 'Teacher', Department: 'Nursery 3', PositionLevel: 'Staff',
      Status: 'ACTIVE', StartDate: '2024-01-01', RequireCheckin: true, PauseFrom: mid, PauseReason: 'ลาคลอด' },
    { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }
  ] });
  const d = H.staffAttendanceMonth({ staffId: 'ADM', month: MONTH });
  const t3 = d.staff.find(x => x.staffId === 'T3');

  ok_('🔴 มีป้ายลาชั่วคราว', t3.paused === true || t3.pausedInRange === true);
  eq('🔴 ...พร้อมวันที่เริ่มลา', t3.pauseFrom, mid);
  eq('...และเหตุผล', t3.pauseReason, 'ลาคลอด');

  /* The target arithmetic was already right — owesDay_ drops paused days — so the first half of the
   * month is still counted. Asserted anyway: it is the half the school specifically asked about,
   * and "already right" is a claim that has to be checkable. */
  const t1 = d.staff.find(x => x.staffId === 'T1');
  ok_('🔴 วันก่อนลายังถูกนับเป็นเป้าหมาย (ไม่ใช่ 0)', t3.myRequiredDays > 0);
  ok_('🔴 ...แต่น้อยกว่าคนที่ทำงานทั้งเดือน', t3.myRequiredDays < t1.myRequiredDays);
  const pausedDays = (t3.days || []).filter(x => x.status === 'PAUSED').map(x => x.date);
  ok_('วันที่ลาชั่วคราวถูกทำเครื่องหมายไว้ ไม่ใช่นับเป็นขาด', pausedDays.length > 0);
  ok_('🔴 ...และไม่มีวันไหนที่ลาชั่วคราวแล้วยังโดนนับว่าขาด',
    (t3.days || []).every(x => !(x.status === 'ABSENT' && pausedDays.indexOf(x.date) >= 0)));

  // ...and a pause with a fixed end date stops at that date, rather than running for ever
  const back = MONTH + '-20';
  const { H: H2 } = boot({ staff: [
    { StaffID: 'T4', NameTH: 'ครูสี่', Role: 'Teacher', Department: 'Nursery 3', PositionLevel: 'Staff',
      Status: 'ACTIVE', StartDate: '2024-01-01', RequireCheckin: true, PauseFrom: mid, PauseTo: back },
    { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }
  ] });
  const t4 = H2.staffAttendanceMonth({ staffId: 'ADM', month: MONTH }).staff.find(x => x.staffId === 'T4');
  const paused4 = (t4.days || []).filter(x => x.status === 'PAUSED').map(x => x.date);
  ok_('🔴 ช่วงที่กำหนดวันกลับไว้ หยุดนับแค่ช่วงนั้น', paused4.every(ds => ds >= mid && ds < back));
  eq('...และวันกลับมาทำงานเป็นวันทำงานปกติ', paused4.indexOf(back), -1);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n6) ป้ายบนหน้าจอ');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const app = R('webapp/app.js');
  ok_('หน้าสรุปรายเดือนวาดป้ายต่อท้ายชื่อ', /\$\{smTag\(s\)\}/.test(app));
  ok_('🪪 ป้าย "ไม่ต้องลงเวลา"', /ไม่ต้องลงเวลา/.test(app));
  ok_('⏸️ ป้าย "ลาชั่วคราว" พร้อมวันที่', /ลาชั่วคราว[\s\S]{0,120}ตั้งแต่/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
