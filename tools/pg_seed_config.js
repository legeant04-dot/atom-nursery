/**
 * tools/pg_seed_config.js — give a TEST tenant on staging the settings a new school starts with
 *   node tools/pg_seed_config.js wh-a75f7402            say what would be written
 *   node tools/pg_seed_config.js wh-a75f7402 --apply
 *
 * The measurement tenants were filled with students, staff, journals and check-ins and never with
 * SCHOOL_CONFIG — so on the real host the engine had no settings at all (2026-11-04). The values are
 * SCHOOL_CONFIG_DEFAULTS from src/Config.gs, read from that file, not restated here.
 *
 * 🔴 TEST TENANTS ONLY. A code that is not one of ours is refused — on the day this is pointed at a
 * database with a school in it, overwriting a school's settings must not be a thing it can do.
 * Existing keys are left as they are; only missing keys are added.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { connect } = require('./pg_lib');
const TEST_CODE = /^(p23-|test-|perf-|wh-|sc-)/;
const code = process.argv[2] || '', APPLY = process.argv.includes('--apply');

function defaults() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.search(/^var SCHOOL_CONFIG_DEFAULTS = \[/m); if (i < 0) throw new Error('SCHOOL_CONFIG_DEFAULTS not found');
  const end = src.indexOf('\n];', i);
  const box = {}; vm.runInNewContext(src.slice(i, end + 3) + '\nthis.D = SCHOOL_CONFIG_DEFAULTS;', box);
  return box.D.map(r => [String(r[0]), r[1] == null ? '' : String(r[1])]);
}

(async () => {
  if (!TEST_CODE.test(code)) { console.log('🔴 ปฏิเสธ: "' + code + '" ไม่ใช่รหัสโรงเรียนทดสอบ'); process.exit(2); }
  const D = defaults();
  const { client: c } = await connect();
  const t = (await c.query('select id from tenant where code = $1', [code])).rows[0];
  if (!t) { console.log('🔴 ไม่พบ tenant ' + code); await c.end(); process.exit(2); }
  const have = new Set((await c.query('select "key" from school_config where tenant_id = $1', [t.id])).rows.map(r => r.key));
  const add = D.filter(([k]) => !have.has(k));
  console.log(code + ': มีอยู่ ' + have.size + ' · ค่าเริ่มต้น ' + D.length + ' · จะเพิ่ม ' + add.length);
  if (APPLY) {
    for (const [k, v] of add) await c.query('insert into school_config (tenant_id, "key", "value") values ($1, $2, $3)', [t.id, k, v]);
    console.log('  เพิ่มแล้ว ' + add.length);
  } else console.log('  (ยังไม่ได้เขียน — ใส่ --apply)');
  await c.end();
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
