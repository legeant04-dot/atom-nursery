/**
 * tools/test_pg_diff_live.js — Phase 2.5 against the real database.
 *   node tools/test_pg_diff_live.js          (ต้องมี secrets/supabase.env)
 *
 * test_pg_diff_check.js proves the streak and the money rule without a database. This proves the
 * part that can only be proved with one: that a mirror built by the Phase 2.4 sync reads back as
 * IDENTICAL, and that each way it can rot is actually caught.
 *
 * 🔴 THE SECOND HALF MATTERS MORE THAN THE FIRST. A checker that always says "clean" would pass the
 * first test perfectly. So every difference is introduced on purpose, one at a time, and has to be
 * found: a changed amount, a row deleted behind the sync's back, a row added behind it, and a
 * difference in a column nobody would think to look at.
 *
 * ALL DATA IS FABRICATED, in its own tenant, deleted at the end. PDPA (Phase 1.5) is unsigned.
 */
const crypto = require('crypto');
const { connect } = require('./pg_lib');
const { targetSchema, encode_, moneyColumns } = require('./pg_migrate.js');
const { diffTable } = require('./pg_sync.js');
const { moneyHit } = require('./pg_diff_check.js');

let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
function uuid4() {
  const b = crypto.randomBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
const T = uuid4();

const COLS = { BillingID: 'billing_id', StudentID: 'student_id', Month: 'month',
               Amount: 'amount', Status: 'status' };

(async () => {
  const { client: c } = await connect();
  const schema = targetSchema();
  const types = schema.billing;
  const MONEY = moneyColumns(schema).billing || [];
  console.log('\n=== Phase 2.5 · ตรวจความต่างกับฐานข้อมูลจริง (ข้อมูลสมมติ) ===');

  const read = async () => (await c.query('select * from billing where tenant_id = $1 order by billing_id', [T])).rows;
  const check = async (sheet) => {
    const pg = await read();
    const d = diffTable(sheet, pg, COLS, ['BillingID'], types, null);
    return { d, money: moneyHit('billing', d, COLS, MONEY) };
  };

  try {
    await c.query("insert into tenant (id, code, name_th) values ($1,$2,'โรงเรียนทดสอบ 2.5')", [T, 'p25-' + T.slice(0, 8)]);
    ok_('คอลัมน์เงินของตาราง billing ถูกอ่านมาจากสคีมา', MONEY.indexOf('amount') >= 0);

    const sheet = [
      { BillingID: 'BL-1', StudentID: 'S-1', Month: '2026-10', Amount: 6900, Status: 'UNPAID' },
      { BillingID: 'BL-2', StudentID: 'S-2', Month: '2026-10', Amount: 7400.5, Status: 'PAID' },
      { BillingID: 'BL-3', StudentID: 'S-3', Month: '2026-10', Amount: 0, Status: 'PAID' }
    ];
    // build the mirror exactly as the Phase 2.4 sync would
    for (const row of sheet) {
      const names = Object.values(COLS).map(n => '"' + n + '"');
      const vals = Object.keys(COLS).map(k => encode_(row[k], types[COLS[k]]));
      await c.query('insert into billing (tenant_id,' + names.join(',') + ') values ($1,' +
        vals.map((_, i) => '$' + (i + 2)).join(',') + ')', [T, ...vals]);
    }

    console.log('\n1) 🔴 กระจกที่เพิ่งสร้าง ต้องอ่านว่า "เหมือนกันทุกประการ"');
    {
      const r = await check(sheet);
      eq('🔴 ไม่มีความต่างเลย', [r.d.insert.length, r.d.update.length, r.d.del.length], [0, 0, 0]);
      eq('...และไม่มีเรื่องเงิน', r.money, null);
      /* 6900 กลับมาเป็น '6900.00' · 0 กลับมาเป็น '0.00' · 7400.5 เป็น '7400.50'
       * ถ้าตัวเทียบอ่านพลาดสักตัว ตัวตรวจประจำวันจะร้องทุกวันโดยไม่มีอะไรผิดจริง */
      const pg = await read();
      ok_('CONTROL: ตัวเลขกลับมาเป็นข้อความจาก driver จริง', typeof pg[0].amount === 'string');
      ok_('CONTROL: ...และศูนย์ก็เป็น "0.00"', pg.find(r2 => r2.billing_id === 'BL-3').amount === '0.00');
    }

    console.log('\n2) 💰 ยอดเงินในกระจกเพี้ยนไป — ต้องจับได้ และต้องเรียกว่าเรื่องเงิน');
    {
      await c.query("update billing set amount = 6800 where tenant_id = $1 and billing_id = 'BL-1'", [T]);
      const r = await check(sheet);
      eq('จับได้ว่าต่าง 1 แถว', [r.d.insert.length, r.d.update.length, r.d.del.length], [0, 1, 0]);
      eq('...และบอกว่าคอลัมน์ไหน', r.d.update[0].changed, ['Amount']);
      eq('🔴 ...และถูกยกขึ้นมาเป็นเรื่องเงิน', r.money, { table: 'billing', cols: ['Amount'], gaps: 0 });
      await c.query("update billing set amount = 6900 where tenant_id = $1 and billing_id = 'BL-1'", [T]);
      eq('แก้กลับแล้วเงียบอีกครั้ง', (await check(sheet)).d.update.length, 0);
    }

    console.log('\n3) 🔴 บิลหายไปจากกระจก — ไม่มีคอลัมน์ไหนต่าง แต่เป็นเรื่องเงินทั้งใบ');
    {
      await c.query("delete from billing where tenant_id = $1 and billing_id = 'BL-2'", [T]);
      const r = await check(sheet);
      eq('มีแต่ในชีต 1 ใบ', [r.d.insert.length, r.d.update.length, r.d.del.length], [1, 0, 0]);
      eq('🔴 ...และนับเป็นเรื่องเงิน ทั้งที่ไม่มีคอลัมน์ไหน "ต่าง"', r.money, { table: 'billing', cols: [], gaps: 1 });
      // put it back the way the sync would
      const names = Object.values(COLS).map(n => '"' + n + '"');
      const vals = Object.keys(COLS).map(k => encode_(sheet[1][k], types[COLS[k]]));
      await c.query('insert into billing (tenant_id,' + names.join(',') + ') values ($1,' +
        vals.map((_, i) => '$' + (i + 2)).join(',') + ')', [T, ...vals]);
      eq('ใส่กลับแล้วเงียบ', (await check(sheet)).d.insert.length, 0);
    }

    console.log('\n4) 🔴 แถวที่โผล่มาในกระจกโดยไม่มีในชีต');
    {
      /* The direction nobody thinks to test. A delete that did not propagate leaves a bill in
       * Postgres that the school has cancelled — and after cutover the family would be billed for it. */
      await c.query("insert into billing (tenant_id, billing_id, student_id, month, amount, status) values ($1,'BL-GHOST','S-9','2026-10',5000,'UNPAID')", [T]);
      const r = await check(sheet);
      eq('🔴 มีแต่ใน Postgres 1 ใบ', [r.d.insert.length, r.d.update.length, r.d.del.length], [0, 0, 1]);
      eq('...และก็เป็นเรื่องเงินเหมือนกัน', r.money, { table: 'billing', cols: [], gaps: 1 });
      await c.query("delete from billing where tenant_id = $1 and billing_id = 'BL-GHOST'", [T]);
      eq('ลบออกแล้วเงียบ', (await check(sheet)).d.del.length, 0);
    }

    console.log('\n5) ความต่างในคอลัมน์ที่ไม่ใช่เงิน — ต้องจับได้ แต่ไม่ปนกับเรื่องเงิน');
    {
      await c.query("update billing set status = 'PAID' where tenant_id = $1 and billing_id = 'BL-1'", [T]);
      const r = await check(sheet);
      eq('จับได้', r.d.update.map(u => u.changed), [['Status']]);
      /* 🔴 "ยอดเงินตรงกัน แต่สถานะไม่ตรง" ต้องอ่านออกว่าเป็นคนละเรื่องกับ "ยอดเงินไม่ตรง" —
       * ไม่งั้นบรรทัดเรื่องเงินจะเต็มไปด้วยเรื่องที่ไม่ใช่เงิน และเลิกถูกอ่าน */
      eq('🔴 ...แต่ไม่ถูกยกขึ้นเป็นเรื่องเงิน', r.money, null);
      await c.query("update billing set status = 'UNPAID' where tenant_id = $1 and billing_id = 'BL-1'", [T]);
      eq('กลับมาเงียบ', (await check(sheet)).d.update.length, 0);
    }

  } catch (e) {
    ok_('ไม่มีข้อผิดพลาดระหว่างทาง — ' + e.message, false);
  } finally {
    try { await c.query('delete from billing where tenant_id = $1', [T]); } catch (e) {}
    try { await c.query('delete from tenant where id = $1', [T]); } catch (e) {}
    const left = (await c.query('select count(*)::int n from billing where tenant_id = $1', [T])).rows[0].n;
    eq('🧹 เก็บกวาดแล้ว', left, 0);
    await c.end();
  }
  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
