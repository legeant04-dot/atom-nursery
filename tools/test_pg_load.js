/**
 * tools/test_pg_load.js — the migration actually run, against the staging database.
 *   node tools/test_pg_load.js            (needs secrets/supabase.env)
 *
 * tools/test_pg_migrate.js proves the mapping and the money report offline. This proves the part
 * that cannot be proved offline: that `insert` accepts what the migrator produces. A plan that is
 * correct on paper and rejected by Postgres is not a migration.
 *
 * 🔴 EVERY ROW HERE IS FABRICATED AND DELETED AGAIN. No real student data goes near Supabase until
 * the PDPA processing agreement exists and the ผอ. has approved it (Phase 1.5). The tenant is
 * created, used and removed inside one run; a failure half-way still cleans up.
 */
const { connect } = require('./pg_lib.js');
const M = require('./pg_migrate.js');

let pass = 0, fail = 0;
const eq = (l, got, want) => { const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++; };
const ok_ = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; };

/* A small school, shaped exactly like Export.gs writes it — including the two AUDIT_LOGs, which are
 * the reason this file exists at all. 6899.999999999999 is the float the sheet really holds. */
const EXPORT = {
  exportedAt: '2026-10-10T00:00:00.000Z',
  MAIN: {
    STUDENTS: [
      { StudentID: 'S-1', Name: 'เด็กทดสอบ หนึ่ง', Nickname: 'หนึ่ง', DOB: '2023-04-15', Class: 'Baby', Status: 'ACTIVE', OTRate: 120, DiscountAmount: '' },
      { StudentID: 'S-2', Name: 'เด็กทดสอบ สอง', Nickname: 'สอง', DOB: '2022-11-02', Class: 'Baby', Status: 'ACTIVE', OTRate: '', DiscountAmount: 10 }
    ],
    BILLING: [
      { BillingID: 'BL-1', StudentID: 'S-1', Month: '2026-09', Amount: 6899.999999999999, Status: 'PAID' },
      { BillingID: 'BL-2', StudentID: 'S-2', Month: '2026-09', Amount: 6900, Status: 'UNPAID' }
    ],
    AUDIT_LOG: [{ UserID: 'u-office', Action: 'VIEW_STUDENT', TableName: 'STUDENTS', RecordID: 'S-1' }]
  },
  HR: {
    STAFF: [{ StaffID: 'T-1', Name: 'ครูทดสอบ', Role: 'Teacher', BaseSalary: 16000, Status: 'ACTIVE' }],
    PAYROLL: [{ PayrollID: 'PR-1', StaffID: 'T-1', Month: '2026-09', BaseSalary: 16000,
                OTEvening: 1200.5, SocialSecurity: 750, NetPay: 16450.5 }],
    // 🔴 same sheet NAME as the MAIN one above, different log, and it must land somewhere else
    AUDIT_LOG: [{ UserID: 'u-admin', Action: 'VIEW_PAYROLL', TableName: 'PAYROLL', RecordID: 'PR-1' }]
  }
};

(async () => {
  const { client: c } = await connect();
  const CODE = 'test-migrate-' + Date.now();
  let tenantId = null;
  try {
    await c.query("insert into tenant (code, name_th, name_en) values ($1,'โรงเรียนทดสอบย้ายข้อมูล','migrate test')", [CODE]);
    tenantId = (await c.query('select id from tenant where code = $1', [CODE])).rows[0].id;

    const schema = M.targetSchema();
    const { plan, unknownTables, unknownCols } = M.planLoad(EXPORT, schema);

    console.log('\n1) แผนการย้าย');
    eq('ทุกชีตหาตารางเจอ', unknownTables, []);
    eq('ไม่มีคอลัมน์ไหนไม่มีที่ลง', unknownCols, {});
    eq('🔴 AUDIT_LOG สองชีต → สองตาราง', plan.map(p => p.table).sort(),
      ['audit_log', 'billing', 'hr_audit_log', 'payroll', 'staff', 'students']);

    console.log('\n2) 🔴 เขียนลงจริง — Postgres ต้องรับได้');
    const done = await M.load(c, tenantId, plan, schema);
    eq('จำนวนแถวที่เขียน ตรงกับที่ส่งออกมา',
      [done.students, done.billing, done.staff, done.payroll, done.audit_log, done.hr_audit_log],
      [2, 2, 1, 1, 1, 1]);

    console.log('\n3) อ่านกลับมาแล้วเป็นของเดิม');
    const q = async (sql, p) => (await c.query(sql, p || [tenantId])).rows;
    const st = await q('select student_id, name, dob, otrate, discount_amount from students where tenant_id=$1 order by seq');
    eq('ลำดับแถวเป็นลำดับเดียวกับในชีต', st.map(r => r.student_id), ['S-1', 'S-2']);
    eq('ชื่อไทยครบ', st[0].name, 'เด็กทดสอบ หนึ่ง');
    /* 🔴 READ IT THE WAY THE ENGINE WILL, not with String().slice(0,10).
     *
     * The driver returns a `date` column as a JS Date, and `String(d).slice(0,10)` gives "Sat Apr
     * 15" — which is what the first version of this assertion compared against '2023-04-15' and
     * failed on. The test was wrong, not the data: pg_engine's decode_ is the contract every
     * handler actually reads through, and it formats in the SCHOOL's timezone rather than the
     * server's. Checking through it also ties the two halves together — a migration that loads a
     * date the hydration layer then reads back as the day before is not a working migration. */
    const { decode_ } = require('./pg_engine.js');
    eq('วันเกิดอ่านกลับเป็นวันเดิม (ตามเขตเวลาไทย)', decode_(st[0].dob, 'date'), '2023-04-15');
    /* 🔴 BLANK STAYS BLANK. A child with no OT rate must not acquire a ฿0 one in the move — ฿0 means
     * "free", which is a different statement from "uses the school rate". */
    eq('🔴 ช่องเงินที่ว่าง → null ไม่ใช่ 0', [st[0].discount_amount, st[1].otrate], [null, null]);
    eq('...และช่องที่มีค่า ยังมีค่า', [Number(st[0].otrate), Number(st[1].discount_amount)], [120, 10]);

    console.log('\n4) 💰 เงินถูกเก็บเป็น numeric และปัดตามที่รายงานไว้');
    const bl = await q('select billing_id, amount from billing where tenant_id=$1 order by seq');
    eq('🔴 6899.999999999999 เก็บเป็น 6900.00', String(bl[0].amount), '6900.00');
    eq('...และค่าที่ตรงอยู่แล้วไม่ขยับ', String(bl[1].amount), '6900.00');
    /* ...and the report said so beforehand. 6899.999999999999 + 6900 differs from the exact sum by
     * about 1e-12 baht, so no column TOTAL moves — which is the report's whole point: the migration
     * is invisible to anybody reading a figure, and the only thing worth approving is a total that
     * actually shifts. One row is still flagged as "stored untidily", for transparency. */
    const rep = M.moneyReport(EXPORT, schema);
    eq('รายงานบอกไว้ล่วงหน้า: ไม่มียอดรวมคอลัมน์ไหนขยับ', rep.moved.length, 0);
    eq('...แต่มี 1 แถวที่ถูกเก็บให้ตรงขึ้น', rep.tidiedRows, 1);
    const pr = await q('select otevening, social_security, net_pay from payroll where tenant_id=$1');
    eq('บรรทัดบนสลิปเป็นตัวเลข ไม่ใช่ text',
      [String(pr[0].otevening), String(pr[0].social_security), String(pr[0].net_pay)],
      ['1200.50', '750.00', '16450.50']);

    console.log('\n5) 🔴 สองบันทึกการเข้าถึง ไม่ปนกัน');
    const a1 = await q('select user_id, action from audit_log where tenant_id=$1');
    const a2 = await q('select user_id, action from hr_audit_log where tenant_id=$1');
    eq('ของโรงเรียนอยู่ audit_log', a1.map(r => r.action), ['VIEW_STUDENT']);
    eq('🔴 ของ HR อยู่ hr_audit_log', a2.map(r => r.action), ['VIEW_PAYROLL']);
    ok_('...และไม่มีแถวไหนอยู่ผิดตาราง', a1.length === 1 && a2.length === 1);

    console.log('\n6) CONTROL — โรงเรียนอื่นมองไม่เห็นข้อมูลนี้');
    /* The same boundary Phase 1.4 proved for RLS, checked again on data that arrived through the
     * migrator: a tenant filter that the LOAD gets wrong is invisible to the RLS spike. */
    const other = await c.query('select count(*)::int n from students where tenant_id <> $1', [tenantId]);
    const mine = await c.query('select count(*)::int n from students where tenant_id = $1', [tenantId]);
    eq('ข้อมูลทดสอบผูกกับ tenant นี้เท่านั้น', mine.rows[0].n, 2);
    ok_('...และไม่ได้ไปเขียนทับของใคร', other.rows[0].n === 0);
  } finally {
    if (tenantId) {
      for (const t of ['students', 'billing', 'staff', 'payroll', 'audit_log', 'hr_audit_log'])
        await c.query(`delete from ${t} where tenant_id = $1`, [tenantId]).catch(() => {});
      await c.query('delete from tenant where id = $1', [tenantId]).catch(() => {});
    }
    const left = tenantId
      ? (await c.query('select count(*)::int n from students where tenant_id = $1', [tenantId])).rows[0].n : 0;
    eq('เก็บกวาดแล้ว — ไม่เหลือข้อมูลทดสอบ', left, 0);
    await c.end();
  }
  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('\n🔴 ' + e.message + '\n'); process.exit(1); });
