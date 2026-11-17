/**
 * tools/make_fake_export.js — an export file in the exact shape of src/Export.gs, from FABRICATED rows
 *   node tools/make_fake_export.js --tenant <code>          → secrets/export/FAKE_export_<code>.json
 *
 * For dress-rehearsing the move pipeline (pg_migrate → pg_diff_check → route_sweep_real → backup →
 * restore) without a real export: 17 Nov 2026, the night before the first rehearsal with real data,
 * so a tool that has never run end-to-end breaks on fake data instead of on the school's.
 *
 * 🔴 STAGING ONLY, TEST TENANTS ONLY. Refuses when ATOM_PG_ENV points anywhere but the default
 *    staging file, and refuses any tenant whose code does not carry a test prefix — the fabricated
 *    tenants that tools/measure_fast_host.js and the *_live suites create (wh- sc- p23- …).
 *    Rows are read the way the app reads them (pg_engine.readSheet), which is what Export.gs writes.
 *    The workbook of each sheet comes from Config.gs SCHEMA via tools/schema_inventory.js.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const CODE = argv[argv.indexOf('--tenant') + 1];
if (!CODE || argv.indexOf('--tenant') < 0) { console.error('usage: --tenant <test tenant code>'); process.exit(2); }
if (process.env.ATOM_PG_ENV && path.basename(process.env.ATOM_PG_ENV) !== 'supabase.env') { console.error('🔴 staging เท่านั้น — ไม่ตั้ง ATOM_PG_ENV'); process.exit(2); }
if (!/^(wh|sc|p23|t|ld|fx|test)-/.test(CODE)) { console.error('🔴 tenant นี้ไม่ใช่ tenant ทดสอบ (ต้องขึ้นต้นด้วย wh- sc- p23- …)'); process.exit(2); }

/* sheet → workbook, from the inventory's own table (the same source the schema is generated from) */
const inv = cp.execFileSync(process.execPath, [path.join(__dirname, 'schema_inventory.js')], { encoding: 'utf8', cwd: ROOT });
const WB = {};
inv.split('\n').forEach(l => { const m = /^([A-Z][A-Z0-9_]*)\s+(MAIN|HR)\s/.exec(l); if (m) (WB[m[1]] = WB[m[1]] || []).push(m[2]); });

(async () => {
  const { connect } = require('./pg_lib.js');
  const PG = require('./pg_engine.js');
  const { client: c } = await connect();
  const t = (await c.query('select id::text id from tenant where code = $1', [CODE])).rows[0];
  if (!t) { console.error('🔴 ไม่พบ tenant ' + CODE); process.exit(1); }
  const out = { exportedAt: new Date().toISOString(), stamp: 'FAKE', schema: 1, fake: true, MAIN: {}, HR: {} };
  let n = 0;
  for (const [sheet, wbs] of Object.entries(WB)) {
    for (const wb of wbs) {
      /* AUDIT_LOG is two logs: MAIN's is audit_log, HR's is hr_audit_log — readSheet knows the MAIN one only */
      if (sheet === 'AUDIT_LOG' && wb === 'HR') { out.HR[sheet] = []; continue; }
      let rows = []; try { rows = await PG.readSheet(c, t.id, sheet); } catch (e) { rows = []; }
      out[wb][sheet] = rows; n += rows.length;
    }
  }
  await c.end();
  const file = path.join(ROOT, 'secrets', 'export', 'FAKE_export_' + CODE + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  console.log('✅ ' + path.relative(ROOT, file) + ' · ' + n + ' แถว · MAIN ' + Object.keys(out.MAIN).length + ' ชีต · HR ' + Object.keys(out.HR).length + ' ชีต (ข้อมูลปลอม)');
})().catch(e => { console.error('🔴 ' + e.message); process.exit(1); });
