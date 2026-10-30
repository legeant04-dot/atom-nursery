/**
 * tools/measure_fast_host.js — ประตูชั้นที่ 1 ของ docs/SPEED_FIRST_PLAN.md
 *   node tools/measure_fast_host.js              วัดด้วยปริมาณเท่าโรงเรียนจริง
 *   node tools/measure_fast_host.js --keep       ไม่ลบ tenant ทดสอบทิ้ง (ไว้ดูต่อ)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * **เป้า: p50 < 1.5s** · ถ้าไม่ถึง → หยุด แล้วคุยกันใหม่ ไม่เดินต่อโดยหวังว่าจะดีขึ้นเอง
 *
 * วัดอะไร: เวลาที่ "คนเห็นหน้าจอ 1 ครั้ง" ต้องรอ — ไม่ใช่เวลา query
 * เทียบกับของจริงวันนี้ (ATOM PERF 28–30/10): **p50 = 7.4s · p95 = 18.5s**
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 ยิงด้วย "รูปทราฟฟิกจริง" ไม่ใช่ query เดี่ยว ๆ
 *
 * api.js รวบทุก api() ที่เกิดใน tick เดียวเป็น batch ก้อนเดียว · หน้าหลักของคุณครูจึงเป็น
 * **หนึ่ง request ที่มีสิบกว่า call อยู่ข้างใน** ไม่ใช่สิบ request
 * การวัด `select * from students` ตัวเดียวแล้วบอกว่าเร็วขึ้น 50 เท่า คือการวัดผิดคำถาม
 * ชุดนี้จึงยิง batch ชุดเดียวกับที่รายงานความเร็วบอกว่าหน้าหลักยิงจริง
 *
 * 🔴 ข้อมูลทุกแถวเป็นของปลอม และถูกลบทิ้งเมื่อจบ
 * ไม่มีเด็ก ผู้ปกครอง หรือพนักงานจริงแตะที่นี่ — ข้อตกลงประมวลผลข้อมูลยังไม่ลงนาม (Phase 1.5)
 * กฎเดียวกับที่ tools/test_pg_load.js เขียนไว้ก่อนแล้ว
 */
'use strict';
const path = require('path');
const { connect } = require(path.join(__dirname, 'pg_lib.js'));
const PG = require(path.join(__dirname, 'pg_engine.js'));
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

const KEEP = process.argv.includes('--keep');
const ROUNDS = Number((process.argv.find(a => a.startsWith('--n=')) || '').slice(4)) || 30;

/* ── ปริมาณเท่าโรงเรียนจริง ─────────────────────────────────────────────────────────────
 * จากที่ตรวจไว้ 2026-07-11 และยังใกล้เคียงวันนี้: 27 นักเรียน · 10 พนักงาน · 56 ผู้ปกครอง
 * ส่วนสองตัวที่โตเร็วที่สุดและจะเจ็บก่อนคือ journals (1.36MB) กับ checkinStudent (537KB)
 * จึงใส่ให้เท่าของจริงคร่าว ๆ: บันทึกวันละ ~25 ใบ × 120 วันเรียน และเช็คอินวันละ ~50 แถว */
const N = { students: 27, staff: 10, parents: 56, days: 120 };

const pad = (n, w) => String(n).padStart(w, '0');
const dayStr = i => { const d = new Date(2026, 5, 1); d.setDate(d.getDate() + i);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); };

function fakeM() {
  const M = {};
  Object.keys(PG.COLLECTIONS).forEach(k => { M[k] = []; });
  M.config = { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 6900, end: '17:00' }],
    Departments: 'Nursery 1,Nursery 2', DefaultCheckOutTime: '17:00', OTRatePerHour: 100 };
  for (let i = 1; i <= N.students; i++) M.students.push({ StudentID: 'STD-' + pad(i, 3),
    NameTH: 'เด็กทดสอบ ' + i, Nickname: 'ท' + i, Class: i % 2 ? 'Nursery 1' : 'Nursery 2',
    Plan: 'p1', Status: 'ACTIVE', ParentID: 'PAR-' + pad(i, 3), DOB: '2023-01-01', EnrollDate: '2025-01-01' });
  for (let i = 1; i <= N.staff; i++) M.staff.push({ StaffID: 'STF-' + pad(i, 3),
    NameTH: 'ครูทดสอบ ' + i, Nickname: 'ค' + i, Role: i === 1 ? 'Admin' : 'Teacher',
    PositionLevel: i === 1 ? 'Admin' : 'Teacher', Department: i % 2 ? 'Nursery 1' : 'Nursery 2',
    Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' });
  for (let i = 1; i <= N.parents; i++) M.parents.push({ ParentID: 'PAR-' + pad(i, 3), NameTH: 'ผู้ปกครองทดสอบ ' + i });
  M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }, { ClassID: 'C2', ClassName: 'Nursery 2' }];
  // ...และสองตัวที่โตจริง
  for (let d = 0; d < N.days; d++) {
    const date = dayStr(d);
    for (let i = 1; i <= N.students; i++) {
      if (i % 27 === d % 27) continue;                       // ขาดบ้างตามจริง
      M.checkinStudent.push({ Date: date, StudentID: 'STD-' + pad(i, 3), In: '08:1' + (i % 10), Out: '17:0' + (i % 10) });
      if (i <= 25) M.journals.push({ Date: date, StudentID: 'STD-' + pad(i, 3), Status: 'SUBMITTED',
        Food: 'ทานหมด', Sleep: '2 ชม.', Mood: 'อารมณ์ดี', Note: 'บันทึกทดสอบของวันที่ ' + date,
        TeacherID: 'STF-002', SubmittedAt: date + ' 17:05:00' });
    }
  }
  return M;
}

/* ── รูปทราฟฟิกจริง ───────────────────────────────────────────────────────────────────
 * สิบ action ที่กินเวลารวมมากที่สุดในรายงาน 28–30/10 — ทั้งหมดอยู่ในหน้าหลักของคุณครู
 * และ api.js ยิงมันออกไปใน tick เดียว จึงเป็น batch ก้อนเดียว */
const TEACHER_HOME = ['staffSelf', 'classList', 'myAttendanceToday', 'journalStatus', 'studentAlerts',
  'notifications', 'myHolidayOTNext', 'holidayAttendList', 'teacherClassAttendance', 'staffMissingCheckout'];

const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const ms = v => v >= 1000 ? (v / 1000).toFixed(2) + 's' : Math.round(v) + 'ms';

(async () => {
  /* 🔴 ชื่อตารางคือ `tenant` เอกพจน์ · id เป็น uuid · และ `code` ก็ unique
   * ตอนแรกเขียนเป็น `tenants (id, name)` ด้วยสตริงธรรมดา — ผิดทั้งสามอย่าง
   * เป็นความผิดพลาดแบบเดียวกับที่บันทึกไว้ใน atom-pg-schema-guesses:
   * **เดาชื่อคอลัมน์แทนที่จะไปอ่านว่าสคีมาเขียนว่าอะไร** · คราวนี้ไปอ่านมาแล้ว */
  const TENANT = require('crypto').randomUUID();
  let client, scrub = s => s;
  try { ({ client, scrub } = await connect()); }
  catch (e) { console.log('\n🔴 ต่อ staging ไม่ได้ — ดูข้อความด้านบน\n'); process.exit(1); }

  console.log('\n⏱️  วัดเส้นเร็ว · tenant ทดสอบ = ' + TENANT);
  console.log('   ข้อมูลจำลอง: นักเรียน ' + N.students + ' · พนักงาน ' + N.staff +
              ' · ผู้ปกครอง ' + N.parents + ' · ' + N.days + ' วันเรียน');

  try {
    await client.query(
      "insert into tenant (id, code, name_th) values ($1, $2, 'วัดความเร็ว (ข้อมูลปลอม)') on conflict (id) do nothing",
      [TENANT, 'perf-' + String(TENANT).slice(0, 8)]);

    // ── ใส่ข้อมูลจำลอง ─────────────────────────────────────────────
    const M0 = fakeM();
    const t0 = Date.now();
    await PG.persist(client, TENANT, M0, {}, Object.keys(PG.COLLECTIONS));
    console.log('   ใส่ข้อมูลจำลองเสร็จใน ' + ms(Date.now() - t0) +
                ' (บันทึก ' + M0.journals.length + ' ใบ · เช็คอิน ' + M0.checkinStudent.length + ' แถว)\n');

    // ── วัด ────────────────────────────────────────────────────────
    const ALL = Object.keys(PG.COLLECTIONS);
    const tot = [], hyd = [], run = [];
    for (let i = 0; i < ROUNDS; i++) {
      const a0 = Date.now();
      const { M } = await PG.hydrateFast(client, TENANT, ALL);
      const a1 = Date.now();
      const H = createAtomAPI(M, null).H;
      const ident = { uid: 'U-1', role: 'Teacher', staffId: 'STF-002' };
      TEACHER_HOME.forEach(a => { try { if (typeof H[a] === 'function') H[a](Object.assign({}, ident)); } catch (e) {} });
      const a2 = Date.now();
      tot.push(a2 - a0); hyd.push(a1 - a0); run.push(a2 - a1);
    }

    const line = (label, arr) => console.log('   ' + label.padEnd(26) +
      'p50 ' + ms(pct(arr, .5)).padStart(8) + '   p95 ' + ms(pct(arr, .95)).padStart(8));
    console.log('📊 ผลการวัด (' + ROUNDS + ' รอบ · batch หน้าหลักคุณครู ' + TEACHER_HOME.length + ' call)');
    line('โหลดข้อมูลจาก Postgres', hyd);
    line('เอนจินทำงาน', run);
    line('รวมต่อ 1 request', tot);

    const p50 = pct(tot, .5), p95 = pct(tot, .95);
    console.log('\n   เทียบของจริงวันนี้ (Apps Script): p50 7.4s · p95 18.5s');
    console.log('   เร็วขึ้น ' + (7400 / Math.max(1, p50)).toFixed(1) + ' เท่า (p50)');
    /* 🔴 ตัวเลขนี้ยังไม่รวมค่าเดินทางจากมือถือถึงสิงคโปร์ (~30–80ms บน 4G)
     * และยังไม่รวม TLS handshake — เครื่องที่วัดนี้อยู่ไทย ต่อตรง ไม่ผ่านเบราว์เซอร์
     * ของจริงจะช้ากว่านี้ แต่ไม่ใช่หลักวินาที */
    console.log('   ⚠️  ยังไม่รวมค่าเดินทางมือถือ→สิงคโปร์ (~30–80ms) และ TLS');
    console.log('\n   ' + (p50 < 1500 ? '✅ ผ่านประตูชั้นที่ 1 (p50 < 1.5s)' : '🔴 ไม่ผ่านประตูชั้นที่ 1 — หยุดแล้วคุยกันใหม่'));
  } finally {
    if (!KEEP) {
      // ลบทุกแถวของ tenant ทดสอบ — ไม่ทิ้งอะไรไว้
      for (const k of Object.keys(PG.COLLECTIONS)) {
        const c = PG.COLLECTIONS[k]; if (!c || !c.known) continue;
        try { await client.query('delete from ' + c.table + ' where tenant_id = $1', [TENANT]); } catch (e) {}
      }
      try { await client.query('delete from tenant where id = $1', [TENANT]); } catch (e) {}
      console.log('\n   ลบข้อมูลจำลองทิ้งแล้ว');
    } else {
      console.log('\n   --keep : เก็บ tenant ' + TENANT + ' ไว้ · ลบด้วย tools/pg_sweep_tenants.js');
    }
    try { await client.end(); } catch (e) {}
  }
})().catch(e => { console.log('\n🔴 ' + (e && e.message) + '\n'); process.exit(1); });
