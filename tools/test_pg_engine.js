/**
 * tools/test_pg_engine.js — Phase 2.1: the 320 handlers must not be able to tell.
 *   node tools/test_pg_engine.js            (ต้องมี secrets/supabase.env)
 *
 * The claim in the plan is "PgEngine รับ M แบบเดียวกัน — handlers ไม่รู้ว่าเปลี่ยน". That is not a
 * claim about SQL; it is a claim about VALUES, and the only way to test it is to put the same school
 * through both doors and compare what the handlers say.
 *
 * So every check here builds one school twice — once as a plain in-memory `M` of the shape GasEngine
 * produces, and once by writing it to Postgres and hydrating it back — then runs the SAME engine
 * handler on both and compares the answers.
 *
 * 🔴 WHAT THIS IS REALLY HUNTING. Nothing throws when a date arrives as a Date object instead of
 * 'YYYY-MM-DD', or a blank cell as null instead of ''. The engine does
 * `String(r.Date||'').slice(0,10)` and `r.Status === 'DRAFT'` several hundred times, and both of
 * those quietly give a different answer. A migration that lost a comparison would not fail — it
 * would report slightly wrong numbers for ever.
 *
 * ALL DATA IS FABRICATED and removed at the end. PDPA (Phase 1.5) is not signed, so nothing real may
 * be in this database at all.
 */
const path = require('path');
const { connect } = require('./pg_lib');
const { COLLECTIONS, hydrate, persist, decode_ } = require('./pg_engine');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
const T = '44444444-4444-4444-8444-444444444444';

/* One school, written out once. These are the shapes the engine actually reads: a date column, a
 * time column, a money column, a boolean-ish flag, an empty field, and a JSON field. */
const TODAY = (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))(new Date());
function school() {
  return {
    students: [
      { StudentID: 'S-1', NameTH: 'เด็กทดสอบ หนึ่ง', Nickname: 'หนึ่ง', Class: 'ห้องทดสอบ', Status: 'ACTIVE', DOB: '2023-04-15', ParentID: 'P-1' },
      { StudentID: 'S-2', NameTH: 'เด็กทดสอบ สอง', Nickname: 'สอง', Class: 'ห้องทดสอบ', Status: 'ACTIVE', DOB: '2022-11-02', ParentID: '' }
    ],
    staff: [
      { StaffID: 'T-1', NameTH: 'ครูทดสอบ', Nickname: 'ครู', Role: 'Teacher', PositionLevel: 'Staff',
        Department: 'ห้องทดสอบ', Classes: 'ห้องทดสอบ', Status: 'ACTIVE', StartDate: '2024-01-01',
        BaseSalary: 16000, StaffGroup: 'G1' }
    ],
    classes: [{ ClassName: 'ห้องทดสอบ' }],
    staffGroups: [{ GroupName: 'G1', CheckInTime: '07:00', CheckOutTime: '17:00' }],
    studentLeaves: [{ LeaveID: 'LV-1', StudentID: 'S-2', Date: TODAY, Reason: 'เป็นไข้', Status: 'Notified' }],
    payments: [{ BillingID: 'B-1', StudentID: 'S-1', Month: TODAY.slice(0, 7), TotalDue: 6900, Status: 'UNPAID' }],
    checkinStudent: [{ StudentID: 'S-1', Date: TODAY, Time: '08:02', Type: 'IN', Status: 'IN' }]
  };
}
const KEYS = ['students', 'staff', 'classes', 'staffGroups', 'studentLeaves', 'payments', 'checkinStudent'];

/** The in-memory M GasEngine would have produced — every collection the engine may touch. */
function memM(src) {
  const M = { config: { Timezone: 'Asia/Bangkok', Departments: ['ห้องทดสอบ'] } };
  KEYS.forEach(k => { M[k] = JSON.parse(JSON.stringify(src[k] || [])); });
  ['parents', 'journals', 'holidays', 'activityLog', 'userLinks', 'otRecords', 'leaves',
   'payroll', 'studentCharges', 'prepayments', 'otDaily', 'workSchedule', 'staffAttendanceHistory',
   'staffAttendanceToday', 'studentCheckins', 'studentAttendanceToday', 'assessments',
   'growthRecords', 'absenceLog', 'comments', 'paymentSlips', 'pickupPersons'].forEach(k => { M[k] = M[k] || []; });
  return M;
}

(async () => {
  const { client: c } = await connect();
  console.log('\n=== Phase 2.1 · PgEngine — handlers ต้องแยกไม่ออก ===');

  // ── the mapping, before anything touches the database ─────────────────────────────────────────
  console.log('\n1) การจับคู่ชื่อคอลัมน์ 3 ชั้น');
  {
    const st = COLLECTIONS.students;
    eq('collection students → ตาราง students', st.table, 'students');
    /* 🔴 THE ALIAS. The engine reads NameTH; SCHEMA declares the column as Name; Postgres has `name`.
     * Three names for one thing, and a migration that forgot the middle one would hand every handler
     * an undefined name and break silently. */
    eq('🔴 engine NameTH → pg name  (ผ่าน FIELD_ALIAS)', st.toPg.NameTH, 'name');
    eq('   engine StudentID → pg student_id', st.toPg.StudentID, 'student_id');
    eq('   และย้อนกลับได้', st.toEngine.name, 'NameTH');
    eq('staff BaseSalary → base_salary', COLLECTIONS.staff.toPg.BaseSalary, 'base_salary');
    eq('studentLeaves → ตาราง leave_request_std', COLLECTIONS.studentLeaves.table, 'leave_request_std');
    ok_('ทุก collection ที่ COLLECTION_MAP รู้จัก มีตารางรองรับ',
      Object.keys(COLLECTIONS).every(k => COLLECTIONS[k].table));
  }

  // ── values ────────────────────────────────────────────────────────────────────────────────────
  console.log('\n2) 🔴 ค่าที่ engine ได้รับ ต้องหน้าตาเหมือน Sheets ไม่ใช่เหมือน Postgres');
  {
    eq('ว่าง → "" ไม่ใช่ null (engine เทียบด้วย === ทั่วทั้งไฟล์)', decode_(null), '');
    eq('date → YYYY-MM-DD', decode_(new Date('2026-04-15T00:00:00+07:00'), 'date'), '2026-04-15');
    eq('timestamp เที่ยงคืน → วันที่เฉยๆ', decode_(new Date('2026-04-15T00:00:00+07:00'), 'timestamptz'), '2026-04-15');
    eq('timestamp มีเวลา → YYYY-MM-DD HH:mm:ss',
      decode_(new Date('2026-04-15T09:30:05+07:00'), 'timestamptz'), '2026-04-15 09:30:05');
    eq('time → HH:mm', decode_('08:02:00', 'time'), '08:02');
    eq('ข้อความที่เป็น JSON → แปลงกลับเป็น object', decode_('[1,2]'), [1, 2]);
    eq('ตัวเลขยังเป็นตัวเลข', decode_(16000), 16000);
    /* 🔴 numeric มาเป็น "ข้อความ" จาก driver — ต้องแปลงกลับเป็นตัวเลขให้ engine
     * node-postgres ไม่แปลง numeric ให้ เพราะ numeric เก็บค่าที่ float64 เก็บไม่ได้ (ถูกของเขา)
     * แต่ Sheets ส่งเป็น "ตัวเลข" มาตลอด → '18000.00' + '1200.50' = '18000.001200.50' */
    eq('🔴 numeric → ตัวเลข ไม่ใช่ "18000.00"', decode_('18000.00', 'numeric'), 18000);
    ok_('🔴 ...และเป็น typeof number จริงๆ', typeof decode_('18000.00', 'numeric') === 'number');
    eq('🔴 ศูนย์เป็นเลข 0 (ไม่ใช่ "0.00" ที่ === 0 เป็น false)', decode_('0.00', 'numeric'), 0);
    eq('...บวกกันได้ ไม่ใช่ต่อกัน', decode_('18000.00','numeric') + decode_('1200.50','numeric'), 19200.5);
    eq('ช่องเงินที่ว่าง ยังเป็น "" เหมือนเดิม', decode_(null, 'numeric'), '');
    /* CONTROL — ต้องไม่แปลงมั่ว: คอลัมน์ที่ไม่ใช่ numeric ยังเป็นข้อความตามเดิม
     * (ถ้าเผลอแปลงทุกอย่างที่หน้าตาเหมือนเลข บัญชีธนาคาร '0012345' จะกลายเป็น 12345) */
    eq('CONTROL: เลขบัญชีที่เป็น text ต้องไม่ถูกแปลงเป็นตัวเลข', decode_('0012345'), '0012345');
    /* 🔴 เขตเวลาของโรงเรียน ไม่ใช่ของเซิร์ฟเวอร์ — เที่ยงคืนกรุงเทพคือ 17:00 UTC ของวันก่อนหน้า
     * ถ้าอ่านเป็น UTC จะได้วันที่ผิดไป 1 วัน ซึ่งเป็นกับดักที่โครงการนี้โดนมาแล้วทั้งเดือนในสลิปและการนับวันลา */
    eq('🔴 เที่ยงคืนตามเวลาไทย ต้องได้วันของไทย',
      decode_(new Date('2026-04-14T17:00:00Z'), 'date'), '2026-04-15');
  }

  // ── seed via PgEngine itself, then hydrate back ───────────────────────────────────────────────
  console.log('\n3) 🔴 เขียนลง Postgres แล้วอ่านกลับ — ต้องได้ของเดิมทุกค่า');
  await c.query('delete from tenant where id=$1', [T]);
  for (const k of KEYS) await c.query(`delete from ${COLLECTIONS[k].table} where tenant_id=$1`, [T]);
  await c.query("insert into tenant (id, code, name_th) values ($1,'test-pg','โรงเรียนทดสอบ PgEngine')", [T]);

  const src = school();
  { // write it in through persist(), which is the path a real request would take
    const blank = {}; const snap = {};
    KEYS.forEach(k => { blank[k] = JSON.parse(JSON.stringify(src[k])); snap[k] = []; });
    const w = await persist(c, T, blank, snap, KEYS);
    eq('เขียนครบทุกแถว', w.inserted, KEYS.reduce((a, k) => a + src[k].length, 0));
    eq('...โดยไม่มีการแก้หรือลบอะไรเลย', [w.updated, w.deleted], [0, 0]);
  }

  const { M: pgM, snapshot } = await hydrate(c, T, KEYS);
  {
    const a = pgM.students.find(s => s.StudentID === 'S-1');
    eq('ชื่อไทยกลับมาครบ', a.NameTH, 'เด็กทดสอบ หนึ่ง');
    eq('🔴 วันเกิดเป็นข้อความ ไม่ใช่ Date object', a.DOB, '2023-04-15');
    eq('🔴 ช่องว่างกลับมาเป็น "" ไม่ใช่ null', pgM.students.find(s => s.StudentID === 'S-2').ParentID, '');
    /* 🔴 THE ASSERTION THAT USED TO HIDE THE BUG. It read
     *      eq('เงินเดือนเป็นตัวเลข', Number(pgM.staff[0].BaseSalary), 16000)
     * — Number() applied inside the assertion, so it tested the VALUE and could not see the TYPE.
     * It passed happily on the string '16000.00' for as long as it existed. The lesson is small and
     * costly: a test that coerces before comparing is testing its own coercion. */
    eq('เงินเดือนเป็นตัวเลข (ไม่ใช่ข้อความ)', pgM.staff[0].BaseSalary, 16000);
    ok_('🔴 ...typeof number — ไม่ Number() ครอบในข้อสอบเอง',
      typeof pgM.staff[0].BaseSalary === 'number');
    /* ...and every money column on every hydrated row, not just this one. A single spot-check is how
     * twelve of the thirteen would have slipped through again. */
    {
      const MONEYISH = ['BaseSalary', 'Amount', 'SlipAmount', 'OTRate', 'DiscountAmount',
        'ProrateAmount', 'OTEvening', 'OTHoliday', 'OTCarry', 'OtherIncome', 'SocialSecurity',
        'NetPay', 'GrossIncome', 'Gross'];
      const bad = [];
      Object.keys(pgM).forEach(key => (pgM[key] || []).forEach(r =>
        MONEYISH.forEach(f => { const v = r[f];
          if (v !== undefined && v !== '' && typeof v !== 'number') bad.push(key + '.' + f + '=' + JSON.stringify(v)); })));
      eq('🔴 ทุกช่องเงินที่อ่านกลับมา เป็นตัวเลขหมด', bad, []);
    }
    eq('เวลาเป็น HH:mm ไม่ใช่ 08:02:00', pgM.checkinStudent[0].Time, '08:02');
  }

  // ── the real question ─────────────────────────────────────────────────────────────────────────
  console.log('\n4) 🔴 handler ตัวจริง ให้คำตอบเดียวกันทั้งสองทาง');
  {
    const mem = memM(src);
    const pg = Object.assign(memM({}), pgM);          // same empty collections, real data from pg
    pg.config = mem.config;
    const Hm = createAtomAPI(mem).H, Hp = createAtomAPI(pg).H;

    const both = (label, call, scrub) => {
      let a, b, ea = null, eb = null;
      try { a = call(Hm); } catch (e) { ea = e.code || e.message; }
      try { b = call(Hp); } catch (e) { eb = e.code || e.message; }
      if (ea || eb) { eq(label + '  (ทั้งคู่ต้องตอบเหมือนกัน)', eb, ea); return; }
      eq(label, scrub ? scrub(b) : b, scrub ? scrub(a) : a);
    };

    both('🔴 listStudents — รายชื่อนักเรียน', H => H.listStudents({}).map(s => s.StudentID + '|' + s.NameTH + '|' + s.Class));
    both('🔴 classList — หน้าจอห้องเรียนของคุณครู', H => {
      const r = H.classList({ staffId: 'T-1' });
      return { cls: r.class && r.class.ClassName, n: (r.students || []).length,
               kids: (r.students || []).map(s => s.StudentID + ':' + s.attStatus + ':' + (s.inTime || '-')) };
    });
    /* Type/FiledBy ของ LEAVE_REQUEST_STD ยังไม่มีที่ลงใน Postgres — ดู tools/test_schema_runtime_cols.js
     * จึงเทียบเฉพาะคอลัมน์ที่ประกาศไว้จริง · เมื่อ Phase 2.2 ปิดช่องว่างนี้แล้วค่อยเพิ่ม Type กลับเข้ามา */
    both('🔴 studentLeaves — ใบลาของเด็กคนหนึ่ง', H => H.studentLeaves({ studentId: 'S-2' }).map(l => l.LeaveID + '|' + l.Date + '|' + l.Reason + '|' + l.Status));
    both('🔴 payments — บิลของเด็กคนหนึ่ง (ตัวเลขเงิน)', H => H.payments({ studentId: 'S-1' }).map(p => p.BillingID + '|' + p.TotalDue + '|' + p.Status));
    both('listStaff — รายชื่อพนักงาน', H => H.listStaff({}).map(s => s.StaffID + '|' + s.Role + '|' + s.StartDate));
    both('schoolDay — วันนี้โรงเรียนเปิดไหม', H => H.schoolDay({}));
  }

  // ── writes ────────────────────────────────────────────────────────────────────────────────────
  console.log('\n5) 🔴 เขียนกลับเป็นรายแถว ไม่ใช่เขียนทับทั้งตาราง');
  {
    pgM.students.push({ StudentID: 'S-3', NameTH: 'เด็กใหม่', Class: 'ห้องทดสอบ', Status: 'ACTIVE' });
    pgM.students[0].Nickname = 'ชื่อใหม่';
    const removed = pgM.students.splice(1, 1)[0];
    const w = await persist(c, T, pgM, snapshot, ['students']);
    eq('เพิ่ม 1 · แก้ 1 · ลบ 1', [w.inserted, w.updated, w.deleted], [1, 1, 1]);

    const { M: after } = await hydrate(c, T, ['students']);
    eq('อ่านกลับมาแล้วตรงกับที่ตั้งใจ',
      after.students.map(s => s.StudentID + ':' + s.Nickname).sort(), ['S-1:ชื่อใหม่', 'S-3:']);
    /* 🔴 CONTROL — ตารางอื่นต้องไม่ถูกแตะ. GasEngine เขียนทับทั้ง collection ซึ่งเป็นเหตุผลที่
     * NO_SHRINK_SHEETS ต้องมีอยู่ · ที่นี่ไม่มีอะไรถูกเขียนทับ จึงไม่มีอะไรให้หาย */
    const { M: others } = await hydrate(c, T, ['staff', 'payments', 'studentLeaves']);
    eq('CONTROL · ตารางอื่นไม่ขยับแม้แต่แถวเดียว',
      [others.staff.length, others.payments.length, others.studentLeaves.length], [1, 1, 1]);
    // ...and putting the child back is just another insert
    delete removed.__id;
    pgM.students.push(removed);
    const w2 = await persist(c, T, pgM, (await hydrate(c, T, ['students'])).snapshot, ['students']);
    ok_('เอาเด็กที่ลบไปกลับคืนได้', w2.inserted === 1);
  }

  // ── clean up ──────────────────────────────────────────────────────────────────────────────────
  for (const k of KEYS) await c.query(`delete from ${COLLECTIONS[k].table} where tenant_id=$1`, [T]);
  await c.query('delete from tenant where id=$1', [T]);
  const left = Number((await c.query('select count(*)::int n from students where tenant_id=$1', [T])).rows[0].n);
  eq('\nเก็บกวาดแล้ว', left, 0);

  await c.end();
  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('🔴 ' + e.message); process.exit(1); });
