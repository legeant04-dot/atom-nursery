/**
 * tools/test_dbpg_switch.js — the Postgres door is shut unless it is deliberately opened (week 2)
 *   node tools/test_dbpg_switch.js
 *
 * ผอ. 2026-11-04: "เริ่มงานสัปดาห์ที่ 2 ได้เลย สวิตช์ปิดไว้"
 *
 *   · DB_BACKEND unset (how it ships)  → getMainSpreadsheet_ is SpreadsheetApp, exactly as before
 *   · PG_TARGET=production             → refused unless PDPA_SIGNED=yes
 *   · src/PgSchema.gs                  → generated, and in step with the schema it was generated from
 *   · the sheets newly declared in SCHEMA have the SAME columns, in the SAME order, as the code that
 *     creates them — so declaring them changes nothing on the live workbook
 *
 * The parity run itself (every harness suite through the door) is tools/run_dbpg_parity.js.
 */
const path = require('path'), fs = require('fs'), cp = require('child_process');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const saved = process.env.ATOM_DB; delete process.env.ATOM_DB;     // this suite sets the switch itself
const H = require('./gas_test_harness.js');

console.log('\n1) 🔴 ปิดอยู่เป็นค่าตั้งต้น — ระบบจริงไม่เปลี่ยนแม้แต่นิดเดียว');
{
  const { run, props } = H(['Config', 'Db', 'PgSchema', 'DbPg']);
  const r = JSON.parse(run(function () {
    var m = SpreadsheetApp.create('MAIN');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', m.getId());
    var touched = false; Jdbc = { getConnection: function () { touched = true; } };
    var wb = getMainSpreadsheet_();
    return JSON.stringify({ isPg: !!wb.__pg, name: wb.getName(), touched: touched, on: pgEnabled_() });
  }));
  eq('🔴 ไม่มี DB_BACKEND → เปิดชีตตามเดิม ไม่ได้แตะ Postgres', [r.isPg, r.name, r.touched, r.on], [false, 'MAIN', false, false]);
  ok_('ไม่มี property ใดของ Postgres ถูกตั้งไว้ในโค้ด', !props.DB_BACKEND && !props.PG_TARGET);
}

console.log('\n2) เปิดได้เฉพาะ staging · production ต้องมี PDPA');
{
  const tryOpen = extra => { const { run } = H(['Config', 'Db', 'PgSchema', 'DbPg']);
    return run(new Function('return (function(){ var p = PropertiesService.getScriptProperties(); var x = ' + JSON.stringify(extra) +
      '; for (var k in x) p.setProperty(k, x[k]); try { return pgEnabled_() ? "ON" : "OFF"; } catch (e) { return "REFUSED: " + e.message; } })()')); };
  const T = '00000000-0000-4000-8000-000000000001';
  eq('staging + tenant → เปิด', tryOpen({ DB_BACKEND: 'pg', PG_TARGET: 'staging', PG_TENANT_ID: T }), 'ON');
  ok_('🔴 production ไม่มีลายเซ็น PDPA → ปฏิเสธ', /^REFUSED: .*PDPA/.test(tryOpen({ DB_BACKEND: 'pg', PG_TARGET: 'production', PG_TENANT_ID: T })));
  eq('production + PDPA_SIGNED=yes → เปิด', tryOpen({ DB_BACKEND: 'pg', PG_TARGET: 'production', PDPA_SIGNED: 'yes', PG_TENANT_ID: T }), 'ON');
  ok_('ไม่บอก target → ปฏิเสธ (ไม่เดาว่าเป็นที่ไหน)', /^REFUSED/.test(tryOpen({ DB_BACKEND: 'pg', PG_TENANT_ID: T })));
  ok_('tenant ไม่ใช่ uuid → ปฏิเสธ', /^REFUSED/.test(tryOpen({ DB_BACKEND: 'pg', PG_TARGET: 'staging', PG_TENANT_ID: 'atom' })));
}

console.log('\n3) แผนที่ชีต → ตาราง สร้างจาก schema เสมอ');
{
  let inStep = true; try { cp.execFileSync(process.execPath, [path.join(__dirname, 'gen_pg_schema_gs.js'), '--check'], { stdio: 'pipe' }); } catch (e) { inStep = false; }
  ok_('src/PgSchema.gs ตรงกับ Config.gs + 001_init.sql', inStep);
  const sql = R('docs/schema/001_init.sql');
  ok_('🔴 คอลัมน์ที่ชื่อมีตัวเลขไม่หาย (photo1 · step1_by)', /"MAIN:DAILY_JOURNAL"[^\n]*"photo1"/.test(R('src/PgSchema.gs')) && /"HR:OT_RECORDS"[^\n]*"step1_by"/.test(R('src/PgSchema.gs')));
  const typeOf = (table, col) => { const m = new RegExp('create table if not exists ' + table + ' \\(([\\s\\S]*?)\\n\\);').exec(sql);
    const c = m && new RegExp('"' + col + '"\\s+([a-z0-9(), ]+?),?\\n').exec(m[1]); return c ? c[1].trim() : null; };
  /* each of these was a boolean or a date, and would have lost what it says on migration day */
  eq('🔴 คำตัดสินของ SlipOK เก็บเป็นข้อความ', typeOf('payment_slips', 'verified'), 'text');
  eq('🔴 แบบสอบถามไม่ระบุตัวตน — เก็บเป็นข้อความ (=== \'YES\')', typeOf('surveys', 'anonymous'), 'text');
  eq('🔴 แจ้งผู้ปกครองแล้ว (รายงานบาดเจ็บ) — ข้อความ', typeOf('injury_reports', 'notify_parent'), 'text');
  eq('กระดิ่งแอดมิน: อ่านแล้ว / เวลา — ข้อความ', [typeOf('admin_inbox', 'read'), typeOf('admin_inbox', 'date')], ['text', 'text']);
  eq('ผู้ปกครองแจ้งวันเวลาโอน — มีคอลัมน์แล้ว', [typeOf('payment_slips', 'stated_date'), typeOf('payment_slips', 'stated_time')], ['date', 'time']);
}

console.log('\n4) 🔴 ชีตที่เพิ่งประกาศใน SCHEMA = คอลัมน์ชุดเดิมทุกตัว ลำดับเดิม');
{
  const cfg = R('src/Config.gs'), gas = R('src/GasEngine.gs'), notify = R('src/Notify.gs'), perf = R('src/Perf.gs');
  const list = s => (s.match(/'([^']+)'/g) || []).map(x => x.slice(1, -1));
  const schemaOf = name => { const m = new RegExp('^  ' + name + ':\\s*\\[([\\s\\S]*?)\\],?\\s*$', 'm').exec(cfg); return m ? list(m[1]) : null; };
  const headersOf = name => { const m = new RegExp('^  ' + name + ':\\s*\\[([\\s\\S]*?)\\],?\\s*$', 'm').exec(gas); return m ? list(m[1]) : null; };
  ['CLASS_COVER', 'FOOD_MENU', 'FOOD_ITEMS', 'SURVEYS', 'SURVEY_RESPONSES'].forEach(n =>
    eq(n + ' = COLLECTION_HEADERS_', schemaOf(n), headersOf(n)));
  const appended = n => { const m = new RegExp("insertSheet\\('" + n + "'\\); sh\\.appendRow\\(\\[([^\\]]*)\\]").exec(notify); return m ? list(m[1]) : null; };
  eq('ADMIN_INBOX = Notify.gs', schemaOf('ADMIN_INBOX'), appended('ADMIN_INBOX'));
  eq('LINE_RECIPIENTS = Notify.gs', schemaOf('LINE_RECIPIENTS'), appended('LINE_RECIPIENTS'));
  eq('PERF_LOG = PERF_HEADERS', schemaOf('PERF_LOG'), list((/var PERF_HEADERS = \[([^\]]*)\]/.exec(perf) || [])[1] || ''));
}

console.log('\n5) ประตูเดียว');
{
  const cfg = R('src/Config.gs');
  ok_('getMainSpreadsheet_ / getHrSpreadsheet_ คือที่เดียวที่เลือกระหว่างชีตกับ Postgres',
    (cfg.match(/pgEnabled_\(\)\) \? pgWorkbook_\('(MAIN|HR)'\)/g) || []).length === 2);
  const db = R('src/DbPg.gs');
  ok_('ทุกคำสั่งกรองด้วย tenant_id', (db.match(/"tenant_id" = \?::uuid/g) || []).length >= 3 && /\("tenant_id"/.test(db));
  ok_('รหัสผ่านฐานข้อมูลอ่านจาก Script Properties เท่านั้น', /getProperty\('PG_PASSWORD'\)/.test(db) && !/password\s*[:=]\s*'[^']+'/i.test(db));
}

if (saved !== undefined) process.env.ATOM_DB = saved;
console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
