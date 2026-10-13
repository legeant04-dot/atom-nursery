/**
 * tools/pg_sweep_tenants.js — leave the staging database as empty as it was found.
 *   node tools/pg_sweep_tenants.js            report what is there
 *   node tools/pg_sweep_tenants.js --apply    remove every test tenant and everything it owns
 *
 * 🔴 WHY. No real data may go into this database until the PDPA processing agreement exists
 * (Phase 1.5), so "it is empty" has to be a fact somebody checked, not an assumption. Phase 2.3
 * creates a tenant per process and deletes it on the way out; across a hundred and seventy
 * processes one exited the hard way and left its tenant behind. A per-process guarantee that holds
 * 168 times out of 169 is not a guarantee.
 *
 * ONLY TEST TENANTS. A tenant whose code does not look like one of ours is left exactly where it
 * is and REPORTED — on the day this file is pointed at a database with a school in it, deleting
 * something it did not recognise must not be a thing it can do.
 */
const { connect } = require('./pg_lib');
const APPLY = process.argv.includes('--apply');
const TEST_CODE = /^(p23-|test-|migrate-test)/;

(async () => {
  const { client: c } = await connect();
  const tenants = await c.query('select id, code, name_th from tenant order by code');
  const mine = tenants.rows.filter(t => TEST_CODE.test(String(t.code || '')));
  const theirs = tenants.rows.filter(t => !TEST_CODE.test(String(t.code || '')));

  const tabs = (await c.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name <> 'tenant'"
  )).rows.map(r => r.table_name);

  if (theirs.length) {
    console.log('\n⚠️  tenants this tool will NOT touch (not a test code):');
    theirs.forEach(t => console.log('     ' + t.code + '  ' + t.name_th));
  }
  console.log('\n  test tenants: ' + mine.length + (mine.length ? '  ' + mine.map(t => t.code).join(' ') : ''));

  if (APPLY && mine.length) {
    const ids = mine.map(t => t.id);
    for (const t of tabs) {
      try { await c.query('delete from ' + t + ' where tenant_id = any($1::uuid[])', [ids]); } catch (e) {}
    }
    await c.query('delete from tenant where id = any($1::uuid[])', [ids]);
    console.log('  removed ' + mine.length + ' test tenant(s) and everything they owned');
  }

  // the number the caller actually reads
  let total = 0;
  for (const t of tabs) {
    const n = await c.query('select count(*)::int n from ' + t);
    total += n.rows[0].n;
  }
  const left = await c.query('select count(*)::int n from tenant');
  console.log('\n  ROWS LEFT ' + total + '  (tenant rows: ' + left.rows[0].n + ')\n');
  await c.end();
  process.exit(0);
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
