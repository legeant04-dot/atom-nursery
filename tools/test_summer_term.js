/**
 * tools/test_summer_term.js — a child who has graduated, back for the summer.
 *   node tools/test_summer_term.js
 *
 * Asked 2026-10-11: "เคสที่มีนักเรียนจบการศึกษาไปแล้ว แต่มีการกลับมาให้โรงเรียนดูแลในช่วง Summer …
 * ให้ใช้ระบบได้ปกติแค่ในช่วงเวลานั้นๆ แล้วกำหนดวัน เช่น 30 หรือ 60 วัน".
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * §1  the window OPENS and CLOSES on its own dates — nobody has to remember to switch it off,
 *     which is the entire request and the one thing the old way (clearing EndDate by hand) could
 *     not do
 * §2  the graduation SURVIVES — EndDate, EndReason and the certificate are untouched, where
 *     clearing EndDate destroyed all three
 * §3  everything the school said must work, works: check-in, the class list, the daily journal
 * §4  everything the school said must NOT happen, does not: DSPM, the annual count, insurance
 * §5  the bill is the ordinary monthly one, at the ordinary rate, and a part month honours the
 *     figure the admin typed
 * §6  two terms cannot overlap — termOn_ takes the first match, so overlapping rows would decide a
 *     parent's check-in by row order
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function throws_(l, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const o = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '  got=' + JSON.stringify(msg)));
  o ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

/* the school's clock, never UTC — see the note in test_queue_hogs §4 */
const ymd = d => { const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const DAY = 86400000;
const TODAY = ymd(Date.now());
const plus = n => ymd(Date.now() + n * DAY);

/* GRAD finished last term — exactly the child the school is asking about. KID is still here, and is
 * the control: nothing below may change for the 31 children who come all year. */
const GRAD = {
  StudentID: 'G1', NameTH: 'เด็กจบแล้ว', Nickname: 'จบ', DOB: '2021-04-11', Class: 'Nursery 3',
  ParentID: 'PAR-G', Plan: 'M6900', Status: 'ACTIVE',
  EnrollDate: '2023-05-01', EndDate: plus(-120), EndReason: 'graduated', EndRemark: 'จบชั้น Nursery 3',
  CertIssuedDate: plus(-118), InsuranceHas: true, InsurancePolicyNo: 'OLD-1', InsuranceExpiry: plus(-100)
};
const KID = {
  StudentID: 'S1', NameTH: 'เด็กปกติ', Nickname: 'ปกติ', DOB: '2023-04-11', Class: 'Nursery 3',
  ParentID: 'PAR-1', Plan: 'M6900', Status: 'ACTIVE', EnrollDate: '2026-05-01'
};

function boot(terms) {
  const M = {
    config: { Plans: [{ id: 'M6900', labelTH: 'รายเดือน', price: 6900, end: '17:00' }],
      LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 3' },
    students: [JSON.parse(JSON.stringify(GRAD)), JSON.parse(JSON.stringify(KID))],
    studentTerms: terms || [],
    parents: [{ ParentID: 'PAR-G', NameTH: 'แม่จบ', StudentID: 'G1' },
              { ParentID: 'PAR-1', NameTH: 'แม่ปกติ', StudentID: 'S1' }],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
            { StaffID: 'T3', NameTH: 'ครูสาม', Role: 'Teacher', Department: 'Nursery 3', Classes: 'Nursery 3', Status: 'ACTIVE' }],
    classes: [{ ClassName: 'Nursery 3', TeacherID: 'T3', Capacity: 15 }],
    userLinks: [{ ParentID: 'PAR-G', StudentID: 'G1' }, { ParentID: 'PAR-1', StudentID: 'S1' }],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], staffGroups: [], workSchedule: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], leaves: [], absenceLog: [],
    /* 🔴 REAL CRITERIA, covering BOTH children's ages. The first draft left this empty — so
     * "dspmTotal is 0 for a summer child" was true whether the exclusion worked or not, and
     * deleting the exclusion did not fail the suite. A test with nothing in the fixture passes on
     * nothing. */
    dspmCriteria: [
      { AgeFrom: 36, AgeTo: 72, ItemNo: 1, Skill: 'GM', Track: 'Teacher' },
      { AgeFrom: 36, AgeTo: 72, ItemNo: 2, Skill: 'FM', Track: 'Teacher' },
      { AgeFrom: 36, AgeTo: 72, ItemNo: 3, Skill: 'RL', Track: 'Teacher' }
    ],
    activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [],
    assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [],
    surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
/** a term running from `a` days off to `b` days off (To is exclusive) */
const term = (a, b, over) => Object.assign({ TermID: 'TM-0001', StudentID: 'G1', Kind: 'SUMMER',
  From: plus(a), To: plus(b), Class: 'Nursery 3', Status: 'ACTIVE' }, over || {});

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) 🔴 หน้าต่างเปิด-ปิดเองตามวันที่ ไม่ต้องมีใครไปปิด');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const closed = boot([]).H;
  throws_('ไม่มีเทอม → เช็คอินไม่ได้ (เหมือนเดิม)',
    () => closed.parentCheckin({ parentId: 'PAR-G', studentId: 'G1', type: 'IN', lat: 0, lng: 0 }), 'ลงเวลาไม่ได้แล้ว');

  const open = boot([term(-5, 25)]).H;     // started 5 days ago, runs 25 more
  const prof = open.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' });
  eq('🔴 อยู่ในเทอม → ระบบถือว่ายังไม่จบ', prof.ended, false);

  const before = boot([term(5, 35)]).H;    // agreed, but has not begun
  eq('ยังไม่ถึงวันเริ่ม → ยังปิดอยู่',
    before.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' }).ended, true);

  /* 🔴 THE AUTO-CLOSE. This is the whole request — "กำหนดวัน เช่น 30 หรือ 60 วัน" — and the one
   * thing clearing EndDate by hand could never do. Nobody runs anything on the last day. */
  const over = boot([term(-40, -1)]).H;
  eq('🔴 เลยวันสุดท้ายแล้ว → ปิดเอง ไม่มีใครต้องไปกด',
    over.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' }).ended, true);
  throws_('...และเช็คอินไม่ได้อีก',
    () => over.parentCheckin({ parentId: 'PAR-G', studentId: 'G1', type: 'IN', lat: 0, lng: 0 }), 'ลงเวลาไม่ได้แล้ว');

  /* `To` is EXCLUSIVE — the same rule PauseTo follows, and for the same reason: the last day the
   * child comes must be a working day, not a morning of the parent tapping a button that refuses. */
  const lastDay = boot([term(-10, 1)]).H;   // To = tomorrow → today is the last day
  eq('🔴 วันสุดท้ายยังเช็คอินได้ (To เป็นวันถัดไป)',
    lastDay.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' }).ended, false);

  const cancelled = boot([term(-5, 25, { Status: 'CANCELLED' })]).H;
  eq('เทอมที่ยกเลิกแล้ว ไม่นับ',
    cancelled.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' }).ended, true);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 การจบการศึกษายังอยู่ครบ');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const { H, M } = boot([term(-5, 25)]);
  const g = M.students.find(s => s.StudentID === 'G1');
  /* The only thing possible before today was clearing EndDate — which setStudentEnd does by also
   * clearing EndReason and EndRemark. The record of the child's graduation, gone, to let them
   * attend for four weeks. */
  eq('🔴 EndDate / EndReason / EndRemark ไม่ถูกแตะ',
    [g.EndDate, g.EndReason, g.EndRemark], [plus(-120), 'graduated', 'จบชั้น Nursery 3']);
  eq('...และเกียรติบัตรที่ออกไปแล้วก็ยังอยู่', g.CertIssuedDate, plus(-118));
  const prof = H.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' });
  eq('วันจบยังรายงานออกมาตามเดิม', prof.endDate, plus(-120));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) ✅ สิ่งที่โรงเรียนบอกว่าต้องใช้ได้ — ใช้ได้');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const { H, M } = boot([term(-5, 25)]);
  const cl = H.classList({ staffId: 'T3', className: 'Nursery 3' });
  const ids = cl.students.map(s => s.StudentID).sort();
  eq('🔴 อยู่ในรายชื่อชั้น Nursery 3 ร่วมกับเด็กปกติ', ids, ['G1', 'S1']);

  /* ☀️ THE BADGE, NOT A CLASS. A separate "Summer" class would hide the child from the very teacher
   * looking after them — staffCoversClass_ decides who sees whom. See inSummerTerm_ in engine.js. */
  const row = cl.students.find(s => s.StudentID === 'G1');
  eq('☀️ ติดป้ายซัมเมอร์ไว้บนแถว', row.summer, true);
  eq('...พร้อมบอกวันสุดท้าย', row.summerLastDay, plus(24));
  eq('CONTROL: เด็กปกติไม่มีป้าย', cl.students.find(s => s.StudentID === 'S1').summer, false);

  const inRes = H.parentCheckin({ parentId: 'PAR-G', studentId: 'G1', type: 'IN', lat: 0, lng: 0 });
  eq('🔴 ผู้ปกครองเช็คอินได้', inRes.type, 'IN');
  /* the journal is gated on the child being checked IN first — which is the point: the gate let
   * them through, so the teacher can record the day. */
  H.submitJournal({ staffId: 'T3', studentId: 'G1', date: TODAY, Mood: 'ดี', submit: false });
  // asserted on the stored row, not the return value: what matters is that the day was recorded
  const saved = M.journals.filter(x => x.StudentID === 'G1' && x.Date === TODAY);
  eq('🔴 คุณครูเขียนบันทึกประจำวันได้', [saved.length, saved[0] && saved[0].Mood], [1, 'ดี']);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) ❌ สิ่งที่โรงเรียนบอกว่าไม่ต้องทำ — ไม่ทำ');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const { H, M } = boot([term(-5, 25)]);
  const rep = H.studentMonthReport({ staffId: 'ADM', month: TODAY.slice(0, 7) });
  const all = rep.classes.reduce((a, c) => a.concat(c.students), []);
  const g = all.find(x => x.studentId === 'G1'), s = all.find(x => x.studentId === 'S1');

  /* CONTROL FIRST. The all-year child of the same age band must have a real DSPM total, or "the
   * summer child has 0" is satisfied by an empty criteria table and proves nothing — which is
   * exactly what the first version of this did. */
  eq('CONTROL: เด็กปกติวัยเดียวกันมีรายการ DSPM จริง', s.dspmTotal, 3);
  eq('🔴 ไม่ต้องประเมิน DSPM (ข้อ 5)', [g.dspmTotal, g.dspmDone], [0, 0]);
  ok_('...จึงไม่ไปค้างอยู่ในรายการ "ยังไม่ประเมิน" ของหัวหน้าครู',
    rep.classes.every(c => c.dspmPending === 0 || !c.students.some(x => x.studentId === 'G1' && x.dspmTotal > 0)));
  eq('☀️ และรายงานบอกว่าเป็นเด็กซัมเมอร์ เพื่อไม่ให้ถูกนับรวม (ข้อ 6)', [g.summer, s.summer], [true, false]);
  eq('...พร้อมวันสุดท้าย เพื่อให้แยกช่วงเวลาได้', g.summerTo, plus(25));

  /* 🔴 INSURANCE. The school decided not to insure a four-week stay — their call — but the record
   * still carries last year's policy, and `has` used to be true for ever once any field was filled
   * in. The person who reads that is a teacher at a hospital counter. */
  const care = H.studentProfile({ studentId: 'G1', staffId: 'T3', role: 'Teacher' });
  eq('🔴 การ์ดของคุณครูต้องบอกว่าไม่มีความคุ้มครอง (ข้อ 4)', care.insuranceHas, false);
  eq('...และบอกเหตุผลว่าหมดอายุ ไม่ใช่เงียบไป', care.insuranceExpired, true);
  const pol = H.studentProfile({ studentId: 'G1', staffId: 'ADM', role: 'Admin' }).policy;
  eq('...แต่เลขกรมธรรม์ยังอยู่ให้ติดต่อ/ต่ออายุได้', [pol.onFile, pol.policyNo], [true, 'OLD-1']);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) 💰 บิล — ราคาปกติ ทางเดียว (ผอ. 12/10)');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const mm = TODAY.slice(0, 7);
  const { H, M } = boot([term(-5, 25)]);
  H.generateMonthlyBills({ staffId: 'ADM', month: mm });
  const billed = M.payments.map(b => b.StudentID).sort();
  eq('🔴 เด็กซัมเมอร์เข้ารอบบิลรายเดือนตามปกติ', billed, ['G1', 'S1']);

  /* CONTROL — a child who has genuinely left stays OUT of the run. Without this, "summer children
   * are billed" would be satisfied just as well by billing everybody who ever attended. */
  const gone = boot([]);
  gone.H.generateMonthlyBills({ staffId: 'ADM', month: mm });
  eq('CONTROL: เด็กที่จบไปจริงๆ ไม่ถูกออกบิล', gone.M.payments.map(b => b.StudentID).sort(), ['S1']);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5b) 💰 เดือนที่มาไม่เต็ม — ราคาที่แอดมินใส่เองต้องถูกใช้จริง');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* 🔴 THE TRAP. The part-month rule keyed off EnrollDate, which for this child is 2023 — so the
   * month being billed never matched and MANUAL was silently ignored. A fortnight would have been
   * charged as a full month, with nothing on the screen to show it. */
  const mm = TODAY.slice(0, 7);
  const start = mm + '-15';
  const { H, M } = boot([term(0, 30, { From: start })]);
  const g = M.students.find(s => s.StudentID === 'G1');
  g.ProrateMode = 'MANUAL'; g.ProrateAmount = 3450;

  H.generateMonthlyBills({ staffId: 'ADM', month: mm });
  const bill = M.payments.find(b => b.StudentID === 'G1');
  eq('🔴 ใช้ยอดที่แอดมินกำหนดเอง ไม่ใช่เต็มเดือน', Number(bill && bill.Amount), 3450);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n6) 🔴 เทอมทับกันไม่ได้ และกติกาของ route');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const { H, M } = boot([term(-5, 25)]);
  /* termOn_ takes the FIRST match, so two overlapping rows would make the answer to "may this
   * parent check in today" depend on the order rows happen to sit in the sheet. */
  throws_('🔴 เปิดเทอมที่ทับกับเทอมเดิมไม่ได้',
    () => H.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: plus(10), days: 30, class: 'Nursery 3' }),
    'ทับกับช่วง');
  ok_('...แต่ช่วงที่ไม่ทับกันเปิดได้',
    !!H.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: plus(40), days: 30, class: 'Nursery 3' }).termId);

  const fresh = boot([]).H;
  throws_('ไม่ใช่แอดมิน เปิดเทอมไม่ได้',
    () => fresh.setStudentTerm({ staffId: 'T3', studentId: 'G1', from: TODAY, days: 30, class: 'Nursery 3' }), 'เฉพาะแอดมิน');
  throws_('ชั้นเรียนที่ไม่มีอยู่จริง ถูกปฏิเสธ',
    () => fresh.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: TODAY, days: 30, class: 'Summer' }), 'ไม่พบชั้นเรียน');
  throws_('วันสุดท้ายก่อนวันเริ่ม ถูกปฏิเสธ',
    () => fresh.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: plus(10), to: plus(5), class: 'Nursery 3' }), 'ต้องอยู่หลังวันเริ่ม');

  /* "30 วัน" and "last day" are the two ways the school says the same thing — both are accepted so
   * neither has to be worked out by hand, and the screen asks for a LAST DAY because that is what
   * is agreed with the family. */
  const byDays = boot([]).H.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: TODAY, days: 30, class: 'Nursery 3' });
  eq('ระบุ 30 วัน → วันสุดท้ายคืออีก 29 วัน', byDays.lastDay, plus(29));
  const byDate = boot([]).H.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: TODAY, to: plus(29), class: 'Nursery 3' });
  eq('...ระบุวันสุดท้ายตรงๆ ก็ได้ผลเดียวกัน', byDate.lastDay, plus(29));

  const { H: H2, M: M2 } = boot([]);
  H2.setStudentTerm({ staffId: 'ADM', studentId: 'G1', from: TODAY, days: 30, class: 'Nursery 3' });
  const g2 = M2.students.find(s => s.StudentID === 'G1');
  eq('ย้ายชั้นให้เด็กตามเทอม (ห้องที่อยู่จริง)', g2.Class, 'Nursery 3');
  /* 🔴 AND OPENING A TERM TOUCHES NOTHING ELSE ON THE RECORD. §2 proves a term does not hide the
   * graduation; this proves the ROUTE does not quietly tidy it away while writing the term — the
   * single thing the old workaround (clearing EndDate) did, and the reason this exists. */
  eq('🔴 เปิดเทอมแล้ว ประวัติการจบยังอยู่ครบ',
    [g2.EndDate, g2.EndReason, g2.EndRemark], [plus(-120), 'graduated', 'จบชั้น Nursery 3']);
  const list = H2.studentTerms({ staffId: 'ADM', studentId: 'G1' });
  eq('รายการเทอมอ่านได้ และบอกว่ากำลังเปิดอยู่', [list.length, list[0].open, list[0].days], [1, true, 30]);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
