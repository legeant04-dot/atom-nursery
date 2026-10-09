/**
 * tools/pg_rls_spike.js — Phase 1.4: prove school A cannot reach school B's data.
 *   node tools/pg_rls_spike.js
 *
 * This is the one question the whole multi-tenant plan rests on, and it has to be ANSWERED rather
 * than designed for: 52 tables carry a `tenant_isolation` policy, and a policy that is present is
 * not the same as a policy that bites.
 *
 * 🔴 WHY THIS TEST IS HARDER TO WRITE THAN IT LOOKS.
 *
 * The connection in secrets/supabase.env is the `postgres` role, and `postgres` has
 * rolbypassrls = true. Every table is `enable row level security` but NONE is `force row level
 * security`, so the owner bypasses as well. A test written the obvious way — connect, select,
 * check the rows — would therefore see EVERYTHING and prove nothing about the app's isolation,
 * because the app does not connect this way.
 *
 * So every check below runs inside a transaction that first does:
 *     set local role authenticated;                     -- rolbypassrls = false
 *     set local request.jwt.claims = '{"tenant_id":…}'; -- what auth.jwt() actually reads
 * which is exactly the shape PostgREST produces for a signed-in user. `set local` reverts on
 * rollback, so nothing leaks between checks and nothing is left behind.
 *
 * ALL DATA HERE IS FABRICATED and every row is removed at the end. No real child, parent or member
 * of staff appears — the PDPA agreement (Phase 1.5) is not signed, so no real data may be here at
 * all, and this file must stay safe to run on any day.
 */
const { connect } = require('./pg_lib');

let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (o ? '' : ' want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Run fn as a signed-in user of `tenant`, then roll everything back. */
async function asTenant(c, tenant, fn) {
  await c.query('begin');
  try {
    await c.query("set local role authenticated");
    if (tenant) await c.query("select set_config('request.jwt.claims', $1, true)",
                              [JSON.stringify({ tenant_id: tenant, role: 'authenticated' })]);
    return await fn();
  } finally { await c.query('rollback'); }
}
/** The same, as the anonymous role — a request with no user at all. */
async function asAnon(c, claims, fn) {
  await c.query('begin');
  try {
    await c.query("set local role anon");
    if (claims) await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return await fn();
  } finally { await c.query('rollback'); }
}
const count = async (c, sql, args) => Number((await c.query(sql, args)).rows[0].n);

/* 🔴 EVERY REFUSAL NEEDS A SAVEPOINT.
 *
 * Postgres aborts the WHOLE transaction the moment a statement errors — every command after it is
 * answered `current transaction is aborted` until rollback. A helper that merely catches the error
 * and carries on therefore poisons the rest of the block, and the checks that follow fail for a
 * reason that has nothing to do with what they are testing. Found on the first run of this file.
 *
 * A savepoint rolled back to leaves the transaction usable, so a test can assert on several
 * refusals in a row — which is exactly what §3 does. */
const errCode = async (c, sql, args) => {
  await c.query('savepoint s');
  try { await c.query(sql, args); await c.query('release savepoint s'); return null; }
  catch (e) { await c.query('rollback to savepoint s'); return e.code; }
};

(async () => {
  const { client: c } = await connect();
  console.log('\n=== Phase 1.4 · การแยกข้อมูลระหว่างโรงเรียน (RLS) ===');

  // ── seed, as postgres (which bypasses RLS — that is how it can set both tenants up) ──────────
  await c.query('delete from students where tenant_id in ($1,$2)', [A, B]);
  await c.query('delete from staff    where tenant_id in ($1,$2)', [A, B]);
  await c.query('delete from tenant   where id in ($1,$2)', [A, B]);
  await c.query("insert into tenant (id, code, name_th) values ($1,'test-a','โรงเรียนทดสอบ ก'), ($2,'test-b','โรงเรียนทดสอบ ข')", [A, B]);
  await c.query(`insert into students (tenant_id, student_id, name, class) values
    ($1,'A-STD-1','เด็กของโรงเรียน ก หนึ่ง','ห้อง ก'), ($1,'A-STD-2','เด็กของโรงเรียน ก สอง','ห้อง ก'),
    ($2,'B-STD-1','เด็กของโรงเรียน ข หนึ่ง','ห้อง ข')`, [A, B]);
  await c.query(`insert into staff (tenant_id, staff_id, name, base_salary) values
    ($1,'A-STF-1','ครูของโรงเรียน ก', 16000), ($2,'B-STF-1','ครูของโรงเรียน ข', 21000)`, [A, B]);
  console.log('  (ใส่ข้อมูลจำลอง: โรงเรียน ก 2 คน · โรงเรียน ข 1 คน — ลบทิ้งตอนจบ)\n');

  // ============================================================================================
  console.log('1) 🔴 อ่าน — แต่ละโรงเรียนเห็นเฉพาะของตัวเอง');
  await asTenant(c, A, async () => {
    eq('🔴 โรงเรียน ก เห็นนักเรียน 2 คน', await count(c, 'select count(*)::int n from students'), 2);
    const names = (await c.query('select name from students order by student_id')).rows.map(r => r.name);
    ok_('🔴 ...และไม่มีชื่อของโรงเรียน ข ปนมาเลย', names.every(n => n.includes('ก')));
    eq('...พนักงานก็เช่นกัน', await count(c, 'select count(*)::int n from staff'), 1);
  });
  await asTenant(c, B, async () => {
    eq('🔴 โรงเรียน ข เห็น 1 คน — ของตัวเอง', await count(c, 'select count(*)::int n from students'), 1);
  });

  // ============================================================================================
  console.log('\n2) 🔴 เจาะตรงๆ ก็ไม่ได้ — รู้ id ของอีกโรงเรียนแล้วถามตรงๆ');
  await asTenant(c, A, async () => {
    eq('🔴 ถามหาเด็กของโรงเรียน ข ด้วยรหัสที่รู้แน่ๆ',
      await count(c, "select count(*)::int n from students where student_id='B-STD-1'"), 0);
    eq('🔴 ...ใส่ tenant_id ของโรงเรียน ข ไปเองก็ยังไม่เห็น',
      await count(c, 'select count(*)::int n from students where tenant_id=$1', [B]), 0);
    /* เงินเดือนคือข้อมูลที่อ่อนไหวที่สุด — ถ้ารั่วแม้แต่ยอดเดียวก็จบ */
    eq('🔴 ...และยอดเงินเดือนของอีกโรงเรียนก็นับไม่ได้',
      await count(c, 'select count(*)::int n from staff where base_salary > 0 and tenant_id=$1', [B]), 0);
    const agg = (await c.query('select coalesce(sum(base_salary),0)::int s from staff')).rows[0].s;
    eq('🔴 ...แม้แต่ sum() ทั้งตารางก็ได้แค่ของตัวเอง', agg, 16000);
  });

  // ============================================================================================
  console.log('\n3) 🔴 เขียนข้ามโรงเรียนไม่ได้');
  await asTenant(c, A, async () => {
    const e = await errCode(c, "insert into students (tenant_id, student_id, name) values ($1,'X-1','แทรกข้ามโรงเรียน')", [B]);
    eq('🔴 แทรกแถวใส่ tenant ของอีกโรงเรียน → ถูกปฏิเสธ', e, '42501');   // insufficient_privilege
    const e2 = await errCode(c, "insert into students (student_id, name) values ('X-2','ไม่ใส่ tenant เลย')");
    ok_('🔴 ...ไม่ใส่ tenant_id เลยก็ไม่ได้ (คอลัมน์เป็น not null)', e2 === '23502' || e2 === '42501');
    /* ย้ายแถวของ "ตัวเอง" ไปให้อีกโรงเรียน — การรั่วที่อันตรายที่สุด เพราะแถวนั้นมองเห็นได้จริง
     * จึงผ่านด่าน `using` มาแล้ว · ตัวที่กันคือ `with check` ซึ่งตรวจแถวหลังแก้
     *
     * ผมเดาว่ามันจะเงียบๆ แล้วได้ 0 แถว · ของจริง Postgres "ปฏิเสธเสียงดัง" ซึ่งแข็งแรงกว่า —
     * โปรแกรมที่เขียนผิดจะพังทันที ไม่ใช่เขียนแล้วเงียบหายไปโดยไม่มีใครรู้ */
    const mv = await errCode(c, 'update students set tenant_id=$1 where student_id=$2', [B, 'A-STD-1']);
    eq('🔴 ย้ายเด็กของตัวเองไปโรงเรียนอื่น → ถูกปฏิเสธเสียงดัง', mv, '42501');
    /* ลบของอีกโรงเรียน: แถวนั้น "มองไม่เห็น" ตั้งแต่แรก จึงไม่มี error — ไม่มีอะไรให้ลบ
     * ซึ่งก็ถูกเหมือนกัน และเป็นคนละกลไกกับข้างบน */
    const d = await c.query("delete from students where student_id='B-STD-1'");
    eq('🔴 ลบเด็กของอีกโรงเรียน → ไม่มีแถวไหนถูกลบ', d.rowCount, 0);
  });
  // ...และของจริงยังอยู่ครบ หลังจาก rollback ทุกอย่างข้างบน
  eq('CONTROL · ข้อมูลของทั้งสองโรงเรียนยังครบ',
    await count(c, 'select count(*)::int n from students where tenant_id in ($1,$2)', [A, B]), 3);

  // ============================================================================================
  console.log('\n4) 🔴 ไม่มี JWT / JWT ปลอม — ไม่เห็นอะไรเลย');
  await asTenant(c, null, async () => {
    eq('🔴 ไม่ส่ง claim มาเลย → 0 แถว', await count(c, 'select count(*)::int n from students'), 0);
  });
  await asTenant(c, '33333333-3333-4333-8333-333333333333', async () => {
    eq('🔴 claim ของ tenant ที่ไม่มีอยู่จริง → 0 แถว', await count(c, 'select count(*)::int n from students'), 0);
  });
  await asAnon(c, null, async () => {
    eq('🔴 role anon (ยังไม่ล็อกอิน) → 0 แถว', await count(c, 'select count(*)::int n from students'), 0);
  });
  await asAnon(c, { tenant_id: A, role: 'anon' }, async () => {
    /* anon ที่ประกอบ claim เองขึ้นมา: นโยบายไม่ได้สนใจว่าเป็น role ไหน มันเชื่อ claim — ซึ่งถูกแล้ว
     * เพราะ claim มาจาก JWT ที่เซ็นด้วยกุญแจของเซิร์ฟเวอร์ ปลอมไม่ได้จากฝั่งผู้ใช้ */
    eq('anon + claim ที่ถูกต้อง เห็นได้เท่าที่ claim บอก', await count(c, 'select count(*)::int n from students'), 2);
  });

  // ============================================================================================
  console.log('\n5) ขอบเขตของการป้องกัน — สิ่งที่ยังข้ามได้ และเป็นเรื่องที่ตั้งใจ');
  const sup = (await c.query(
    "select rolbypassrls from pg_roles where rolname in ('postgres','service_role') order by rolname")).rows;
  ok_('postgres และ service_role ข้าม RLS ได้ — โดยการออกแบบ', sup.every(r => r.rolbypassrls === true));
  eq('🔴 ...ซึ่งหมายความว่าการเชื่อมต่อแบบที่ผมใช้อยู่นี้ เห็นทุกโรงเรียน',
    await count(c, 'select count(*)::int n from students where tenant_id in ($1,$2)', [A, B]), 3);
  const forced = await count(c,
    "select count(*)::int n from pg_class join pg_namespace ns on ns.oid=relnamespace where nspname='public' and relkind='r' and relforcerowsecurity");
  eq('ไม่มีตารางไหนตั้ง force row level security', forced, 0);
  const anonBypass = (await c.query(
    "select rolbypassrls from pg_roles where rolname in ('anon','authenticated')")).rows;
  ok_('🔴 แต่ anon และ authenticated — ซึ่งเป็นสิ่งที่แอปใช้จริง — ข้ามไม่ได้',
    anonBypass.every(r => r.rolbypassrls === false));

  // ============================================================================================
  console.log('\n6) 🔴 ทุกนโยบาย 52 ข้อ ต้องเขียนแบบเดียวกัน');
  {
    /* §1–§4 ข้างบนทดสอบจริงบน `students` และ `staff` เท่านั้น — ตารางที่เหลืออีก 50 ตารางไม่ได้ถูกแตะ
     * และ "ตารางเดียวที่นโยบายหลวม" คือวิธีที่ข้อมูลรั่วทั้งที่ทุกอย่างดูเขียว
     *
     * ทดลองแล้วเมื่อ 09/10: เปลี่ยนนโยบายของ students เป็น `using (true)` → เทสต์ข้างบนตก 11 ข้อ
     * รวมถึง "ไม่ล็อกอินก็เห็นข้อมูลทุกโรงเรียน" · แต่การพิสูจน์แบบนั้นต้องทำลายฐานข้อมูลก่อน
     * ข้อนี้จึงอ่าน "ข้อความ" ของทุกนโยบายแทน — จับความผิดพลาดแบบเดียวกันได้โดยไม่ต้องพังอะไร */
    const pol = (await c.query(
      "select tablename, qual, with_check, cmd, roles::text from pg_policies where schemaname='public'")).rows;
    eq('มีนโยบายครบทุกตาราง (ยกเว้น tenant เอง)', pol.length, 52);
    const EXPECT = /tenant_id = \(\(auth\.jwt\(\) ->> 'tenant_id'::text\)\)::uuid/;
    const loose = pol.filter(p => !EXPECT.test(String(p.qual || '')) || !EXPECT.test(String(p.with_check || '')));
    eq('🔴 ไม่มีนโยบายไหนหลวมกว่าที่ควร (เช่น using(true))',
      loose.map(p => p.tablename + ' · qual=' + p.qual), []);
    const notAll = pol.filter(p => String(p.cmd) !== 'ALL');
    eq('🔴 ...และทุกข้อคุมครบทั้ง select/insert/update/delete', notAll.map(p => p.tablename + ':' + p.cmd), []);
    /* และต้องไม่มีตารางไหนที่ "ลืมเปิด RLS" — มีนโยบายแต่ไม่เปิด = นโยบายไม่ทำงานเลย */
    const notOn = (await c.query(
      "select relname from pg_class join pg_namespace ns on ns.oid=relnamespace where nspname='public' and relkind='r' and relname<>'tenant' and not relrowsecurity")).rows;
    eq('🔴 ...และไม่มีตารางไหนที่มีนโยบายแต่ลืมเปิด RLS', notOn.map(r => r.relname), []);
  }

  // ── clean up ─────────────────────────────────────────────────────────────────────────────────
  await c.query('delete from students where tenant_id in ($1,$2)', [A, B]);
  await c.query('delete from staff    where tenant_id in ($1,$2)', [A, B]);
  await c.query('delete from tenant   where id in ($1,$2)', [A, B]);
  const left = await count(c, 'select count(*)::int n from tenant');
  eq('\nเก็บกวาดแล้ว — ไม่เหลือข้อมูลทดสอบ', left, 0);

  await c.end();
  console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('🔴 ' + e.message); process.exit(1); });
