/**
 * tools/test_pg_sync_live.js — Phase 2.4 against the real database.
 *   node tools/test_pg_sync_live.js          (ต้องมี secrets/supabase.env)
 *
 * tools/test_pg_sync.js proves the DIFF is right without a database, which is where the thinking
 * is. This proves the other half — that applying the diff does to Postgres exactly what the diff
 * said it would, and that **running it twice changes nothing the second time**.
 *
 * 🔴 THAT SECOND PROPERTY IS THE WHOLE PHASE. A mirror you can run again safely is a mirror you can
 * run on a schedule; one that reports changes every time it runs is a writer pretending to be a
 * check, and Phase 2.5 — the daily difference report — has nothing left to report.
 *
 * ALL DATA IS FABRICATED and deleted at the end, in its own tenant. PDPA (Phase 1.5) is unsigned,
 * so the staging database must end as empty as it began.
 */
const path = require('path'), crypto = require('crypto');
const { connect } = require('./pg_lib');
const { targetSchema, encode_ } = require('./pg_migrate.js');
const { diffTable } = require('./pg_sync.js');

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

const COLS = { StudentID: 'student_id', NameTH: 'name', Class: 'class', Status: 'status',
               EnrollDate: 'enroll_date', DOB: 'dob' };

/** apply a diff — the same four statements pg_sync runs, kept side by side so they cannot drift */
async function apply(c, table, cols, d, types) {
  const names = Object.values(cols).map(n => '"' + n + '"');
  for (const row of d.insert) {
    const vals = Object.keys(cols).map(k => encode_(row[k], types[cols[k]]));
    const ph = vals.map((_, i) => '$' + (i + 2)).join(',');
    await c.query('insert into ' + table + ' (tenant_id,' + names.join(',') + ') values ($1,' + ph + ')', [T, ...vals]);
  }
  for (const u of d.update) {
    const ks = Object.keys(cols);
    const sets = ks.map((k, i) => '"' + cols[k] + '"=$' + (i + 3));
    const vals = ks.map(k => encode_(u.row[k], types[cols[k]]));
    await c.query('update ' + table + ' set ' + sets.join(',') + ' where id = $1 and tenant_id = $2', [u.id, T, ...vals]);
  }
  for (const x of d.del) await c.query('delete from ' + table + ' where id = $1 and tenant_id = $2', [x.id, T]);
}

(async () => {
  const { client: c } = await connect();
  const schema = targetSchema();
  const types = schema.students;
  console.log('\n=== Phase 2.4 · ซิงก์จริงกับฐานข้อมูล (ข้อมูลสมมติ) ===');
  try {
    await c.query("insert into tenant (id, code, name_th) values ($1,$2,'โรงเรียนทดสอบ 2.4')", [T, 'p24-' + T.slice(0, 8)]);

    const read = async () => (await c.query('select * from students where tenant_id = $1 order by student_id', [T])).rows;

    // ── 1. first run: an empty database, three children ──────────────────────────────────────
    console.log('\n1) ครั้งแรก — ฐานข้อมูลว่าง');
    const sheet1 = [
      { StudentID: 'S-1', NameTH: 'เด็กหนึ่ง', Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-01-05', DOB: '2023-04-15' },
      { StudentID: 'S-2', NameTH: 'เด็กสอง', Class: 'Nursery 2', Status: 'ACTIVE', EnrollDate: '2026-02-01', DOB: '2022-11-02' },
      { StudentID: 'S-3', NameTH: 'เด็กสาม', Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-03-01', DOB: '2023-01-20' }
    ];
    let d = diffTable(sheet1, await read(), COLS, ['StudentID'], types, null);
    eq('เด็ก 3 คน → เพิ่ม 3', [d.insert.length, d.update.length, d.del.length], [3, 0, 0]);
    await apply(c, 'students', COLS, d, types);
    eq('อ่านกลับมาได้ครบ 3', (await read()).length, 3);

    // ── 2. run it again, unchanged ───────────────────────────────────────────────────────────
    console.log('\n2) 🔴 รันซ้ำโดยไม่มีอะไรเปลี่ยน');
    const before = await read();
    d = diffTable(sheet1, before, COLS, ['StudentID'], types, null);
    /* 🔴 THE PHASE, IN ONE ASSERTION. Dates came back from Postgres as Date objects at 17:00 UTC
     * and a money-free row still has a dozen values that crossed a type boundary; if any of them
     * reads as different, this runs for ever and Phase 2.5 can never say "nothing differs". */
    eq('🔴 ไม่มีอะไรต้องทำเลย', [d.insert.length, d.update.length, d.del.length], [0, 0, 0]);
    const ids = before.map(r => r.id);
    await apply(c, 'students', COLS, d, types);
    eq('🔴 ...และ id ของทุกแถวยังเป็นตัวเดิม', (await read()).map(r => r.id), ids);

    // ── 3. one change of each kind ───────────────────────────────────────────────────────────
    console.log('\n3) เปลี่ยนอย่างละหนึ่ง');
    const sheet2 = [
      Object.assign({}, sheet1[0], { Class: 'Nursery 2' }),      // moved class
      sheet1[1],                                                  // untouched
      // S-3 withdrawn — gone from the sheet
      { StudentID: 'S-4', NameTH: 'เด็กสี่', Class: 'Nursery 1', Status: 'ACTIVE', EnrollDate: '2026-10-01', DOB: '2023-06-06' }
    ];
    d = diffTable(sheet2, await read(), COLS, ['StudentID'], types, null);
    eq('เพิ่ม 1 · แก้ 1 · ลบ 1', [d.insert.length, d.update.length, d.del.length], [1, 1, 1]);
    eq('...และบอกว่าคอลัมน์ไหนเปลี่ยน', d.update[0].changed, ['Class']);
    const keepId = before.find(r => r.student_id === 'S-2').id;
    await apply(c, 'students', COLS, d, types);
    const after = await read();
    eq('ผลลัพธ์คือ S-1 S-2 S-4', after.map(r => r.student_id), ['S-1', 'S-2', 'S-4']);
    eq('S-1 ย้ายห้องแล้ว', after.find(r => r.student_id === 'S-1').class, 'Nursery 2');
    /* 🔴 the row nobody touched keeps the id it was given. Anything that ever points at a row by id
     * — and a relational database is made of that — survives a sync only because of this. */
    eq('🔴 แถวที่ไม่ได้แตะ ยังเป็น id เดิม', after.find(r => r.student_id === 'S-2').id, keepId);

    // ── 4. and still idempotent afterwards ───────────────────────────────────────────────────
    console.log('\n4) 🔴 รันซ้ำอีกครั้งหลังเปลี่ยน');
    d = diffTable(sheet2, after, COLS, ['StudentID'], types, null);
    eq('🔴 ยังไม่มีอะไรต้องทำ', [d.insert.length, d.update.length, d.del.length], [0, 0, 0]);

    // ── 5. values that cross a type boundary ─────────────────────────────────────────────────
    console.log('\n5) 🔴 ค่าที่ข้ามชนิดข้อมูล — ต้องไม่ถูกนับว่าเปลี่ยน');
    const money = { StaffID: 'staff_id', NameTH: 'name', BaseSalary: 'base_salary',
                    StartDate: 'start_date', RequireCheckin: 'require_checkin' };
    const st = schema.staff;
    const staffSheet = [{ StaffID: 'T-1', NameTH: 'ครูทดสอบ', BaseSalary: 18000, StartDate: '2024-01-01', RequireCheckin: '' }];
    let sd = diffTable(staffSheet, [], money, ['StaffID'], st, null);
    await apply(c, 'staff', money, sd, st);
    const staffBack = (await c.query('select * from staff where tenant_id = $1', [T])).rows;
    ok_('เงินเดือนกลับมาเป็นข้อความจาก driver', typeof staffBack[0].base_salary === 'string');
    sd = diffTable(staffSheet, staffBack, money, ['StaffID'], st, null);
    /* numeric → '18000.00', date → Date, a blank checkbox → null. Three different boundaries in one
     * row, and none of them is a change. */
    eq('🔴 เงิน · วันที่ · ช่องติ๊กที่ว่าง — ไม่มีอันไหนนับว่าเปลี่ยน', sd.update.length, 0);

  } catch (e) {
    ok_('ไม่มีข้อผิดพลาดระหว่างทาง — ' + e.message, false);
  } finally {
    // everything this run wrote, gone — PDPA (Phase 1.5) is unsigned
    for (const t of ['students', 'staff']) { try { await c.query('delete from ' + t + ' where tenant_id = $1', [T]); } catch (e) {} }
    try { await c.query('delete from tenant where id = $1', [T]); } catch (e) {}
    const left = (await c.query('select count(*)::int n from students where tenant_id = $1', [T])).rows[0].n;
    eq('🧹 เก็บกวาดแล้ว', left, 0);
    await c.end();
  }
  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
