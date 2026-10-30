/**
 * tools/test_pg_hydrate_fast.js — สองทางโหลดข้อมูล ต้องได้แถวหน้าตาเดียวกันเป๊ะ
 *   node tools/test_pg_hydrate_fast.js            (ต้องมี secrets/supabase.env)
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * `hydrateFast` ยิง query เดียวแทน 38 ครั้ง — วัดบน staging แล้ว 1,140ms → 31ms
 * แต่มันใช้ **simple query protocol** ซึ่งเป็นคนละทางกับ `hydrate` เดิมที่ใช้พารามิเตอร์
 *
 * 🔴 คนละทางเมื่อไหร่ ก็มีโอกาสตอบไม่เหมือนกันเมื่อนั้น — และข้อที่จะต่างคือ **ชนิดของข้อมูล**
 *
 * decode_ ตัดสินจาก dataTypeID ว่าคอลัมน์ไหนเป็น date ไหนเป็น timestamp
 * ถ้าทางใหม่ส่ง fields มาไม่เหมือนเดิม วันที่จะเพี้ยนโดยไม่มีอะไร throw
 * — เป็นบั๊กชนิดเดียวกับเวลาเพี้ยน 7 ชั่วโมงที่โปรเจ็กต์นี้จ่ายค่าไปแล้วสองครั้ง
 *
 * ชุดนี้จึงไม่ได้ถามว่า "เร็วขึ้นไหม" แต่ถามว่า **"เหมือนเดิมไหม"** ซึ่งเป็นคำถามที่ยากกว่า
 * และเทียบด้วย JSON.stringify ของทั้ง M — ไม่ใช่สุ่มดูบางฟิลด์
 *
 * 🔴 ข้อมูลทุกแถวเป็นของปลอม และถูกลบทิ้งเมื่อจบ (Phase 1.5 ยังไม่ลงนาม)
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const { connect } = require(path.join(__dirname, 'pg_lib.js'));
const PG = require(path.join(__dirname, 'pg_engine.js'));

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + (okk ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}

/* ข้อมูลที่จงใจมีของที่ถอดรหัสพลาดง่าย: วันที่ · เวลา · timestamp · ตัวเลขเงิน · ช่องว่าง */
function fixture() {
  const M = {};
  Object.keys(PG.COLLECTIONS).forEach(k => { M[k] = []; });
  M.config = { Plans: [{ id: 'p1', labelTH: 'รายเดือน', price: 6900, end: '17:00' }], Departments: 'Nursery 1' };
  M.students = [
    { StudentID: 'STD-1', NameTH: 'เด็กทดสอบ', Nickname: 'ท', Class: 'Nursery 1', Plan: 'p1',
      Status: 'ACTIVE', DOB: '2023-04-15', EnrollDate: '2025-01-06', ParentID: 'PAR-1' },
    // ...และแถวที่เกือบทุกช่องว่าง — '' กับ null ต้องออกมาเหมือนกันทั้งสองทาง
    { StudentID: 'STD-2', NameTH: 'เด็กทดสอบ 2', Nickname: '', Class: 'Nursery 1', Plan: 'p1',
      Status: 'ACTIVE', DOB: '', EnrollDate: '', ParentID: '' }
  ];
  M.staff = [{ StaffID: 'STF-1', NameTH: 'ครูทดสอบ', Role: 'Teacher', Department: 'Nursery 1',
    Classes: '*', Status: 'ACTIVE', StartDate: '2025-01-01' }];
  M.classes = [{ ClassID: 'C1', ClassName: 'Nursery 1' }];
  // เวลา + timestamp — จุดที่เคยเพี้ยน 7 ชั่วโมง
  /* 🔴 ชื่อฟิลด์เอามาจาก PG.COLLECTIONS ไม่ใช่จากความจำ
   * เวอร์ชันแรกเขียน checkinStudent.In/Out · payments.TotalDue · journals.Food — **ไม่มีสักตัว**
   * (ของจริงคือ Time/Type · Amount · Meals) แถวจึงถูกเขียนลงไปแบบขาดฟิลด์
   * แล้วชุดทดสอบไปทวงของที่ไม่เคยถูกเก็บ · เป็นความผิดพลาดเดียวกับที่ atom-pg-schema-guesses
   * บันทึกไว้ทั้งหน้า: **รูปแบบของชื่อ ตอบคำถามเรื่องความหมายไม่ได้** */
  M.journals = [{ Date: '2026-10-30', StudentID: 'STD-1', Status: 'SUBMITTED', Meals: 'ทานหมด',
    TeacherID: 'STF-1', SubmittedAt: '2026-10-30 17:05:00' }];
  M.checkinStudent = [{ Date: '2026-10-30', StudentID: 'STD-1', Time: '08:12', Type: 'IN', Status: 'OK' }];
  // เงิน — numeric ต้องไม่กลายเป็น string คนละแบบระหว่างสองทาง
  M.payments = [{ BillingID: 'BIL-1', StudentID: 'STD-1', Month: '2026-10', Amount: 6900.50,
    Status: 'UNPAID' }];
  return M;
}

(async () => {
  const TENANT = crypto.randomUUID();
  let client;
  try { ({ client } = await connect()); }
  catch (e) { console.log('\n🔴 ต่อ staging ไม่ได้\n'); process.exit(1); }

  try {
    await client.query(
      "insert into tenant (id, code, name_th) values ($1,$2,'ทดสอบ hydrateFast') on conflict (id) do nothing",
      [TENANT, 'hf-' + TENANT.slice(0, 8)]);
    const keys = Object.keys(PG.COLLECTIONS);
    await PG.persist(client, TENANT, fixture(), {}, keys);

    console.log('\n1) 🔴 สองทางต้องได้ M เหมือนกันทุกตัวอักษร');
    const slow = await PG.hydrate(client, TENANT, keys);
    const fast = await PG.hydrateFast(client, TENANT, keys);

    eq('จำนวน collection เท่ากัน', Object.keys(fast.M).length, Object.keys(slow.M).length);
    /* เทียบทั้งก้อน · ถ้าต่างแม้แต่ช่องเดียวต้องแดง ไม่ใช่ผ่านเพราะบังเอิญไม่ได้ดูช่องนั้น */
    const sJ = JSON.stringify(slow.M), fJ = JSON.stringify(fast.M);
    ok_('🔴 M เหมือนกันทั้งก้อน (เทียบ JSON ทั้งหมด)', sJ === fJ);
    if (sJ !== fJ) {
      Object.keys(slow.M).forEach(k => {
        const a = JSON.stringify(slow.M[k]), b = JSON.stringify(fast.M[k]);
        if (a !== b) console.log('         ต่างที่ ' + k + '\n           hydrate     = ' + String(a).slice(0, 220)
          + '\n           hydrateFast = ' + String(b).slice(0, 220));
      });
    }
    ok_('snapshot เหมือนกันด้วย (persist ใช้ตัวนี้เทียบส่วนต่าง)',
      JSON.stringify(slow.snapshot) === JSON.stringify(fast.snapshot));

    console.log('\n2) ชนิดข้อมูลที่พลาดง่ายที่สุด ต้องออกมาถูกทั้งสองทาง');
    const st = fast.M.students.find(s => s.StudentID === 'STD-1');
    eq('วันเกิดเป็น YYYY-MM-DD ไม่ใช่ ISO เต็ม', st && st.DOB, '2023-04-15');
    const jr = fast.M.journals[0];
    /* 🔴 นาฬิกาของโรงเรียน · ถ้าเห็น 10:05 แปลว่าอ่านในโซน UTC — คือบั๊ก 7 ชั่วโมงกลับมา */
    ok_('🔴 เวลาที่ส่งบันทึกยังเป็นเวลาไทย (17:05 ไม่ใช่ 10:05)',
      !!jr && String(jr.SubmittedAt).indexOf('17:05') >= 0);
    const ck = fast.M.checkinStudent[0];
    eq('เวลาเช็คอินเป็น HH:mm', ck && ck.Time, '08:12');
    const bl = fast.M.payments[0];
    ok_('ยอดเงินอ่านเป็นตัวเลขได้', !!bl && Number(bl.Amount) === 6900.5);
    const empty = fast.M.students.find(s => s.StudentID === 'STD-2');
    eq("ช่องว่างเป็น '' ไม่ใช่ null (เอนจินเทียบด้วย === ทั้งไฟล์)", empty && empty.DOB, '');

    console.log('\n3) และต้องปฏิเสธ tenantId ที่ไม่ใช่ uuid');
    /* simple query ไม่มีพารามิเตอร์ จึงต้องต่อ tenant เป็นสตริง
     * ทางเดียวที่ปลอดภัยคือไม่รับอะไรที่ไม่ใช่ uuid เลย ไม่ใช่พยายาม escape เอง */
    let threw = '';
    try { await PG.hydrateFast(client, "x' or '1'='1", ['students']); } catch (e) { threw = e.message; }
    ok_('🔴 tenantId ที่ไม่ใช่ uuid → โยนทิ้ง ไม่ยิง SQL', /uuid/.test(threw));
  } finally {
    for (const k of Object.keys(PG.COLLECTIONS)) {
      const c = PG.COLLECTIONS[k]; if (!c || !c.known) continue;
      try { await client.query('delete from ' + c.table + ' where tenant_id = $1', [TENANT]); } catch (e) {}
    }
    try { await client.query('delete from tenant where id = $1', [TENANT]); } catch (e) {}
    try { await client.end(); } catch (e) {}
  }

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('\n🔴 ' + (e && e.message) + '\n'); process.exit(1); });
