/**
 * tools/pg_wipe_uat_copy.js — empty atom-prod of the UAT copy, so move night starts from nothing
 *   ATOM_PG_ENV=atom-prod.env node tools/pg_wipe_uat_copy.js                        report only
 *   ATOM_PG_ENV=atom-prod.env node tools/pg_wipe_uat_copy.js --confirm wipe-uat-<today YYYY-MM-DD>
 *
 * MOVE_NIGHT_RUNBOOK "ก่อนคืน D": atom-prod holds the rehearsal/UAT copy until D−1 and must be EMPTY
 * when the real data is moved in on night D. Also used after a dress rehearsal on fake data.
 * Removes every row of every public table and every tenant, then proves every table counts 0.
 *
 * 🔴 IT DELETES A WHOLE DATABASE'S DATA, SO:
 *   · only through ATOM_PG_ENV=atom-prod.env — never the default staging file (pg_sweep_tenants is for staging)
 *   · only with --confirm wipe-uat-<today, Bangkok> — yesterday's command from the notes is refused
 *   · NEVER ONCE THE APP RUNS ON IT. From 2026-11-27 21:00 Bangkok — MOVE_NIGHT_RUNBOOK step 5a, when
 *     DB_BACKEND=pg is set — atom-prod is the school's real system; this file refuses outright from then
 *     on, whatever is typed. Until then (D−1, and a failed step 3 on the night itself, while the school
 *     is still on the frozen sheets) emptying it loses nothing. A later wipe is a decision
 *     for a person with the ผอ., not for a script — change WIPE_UNTIL in code review if it ever is.
 *   · one transaction: any error and nothing is deleted
 * Run a backup first if there is anything worth keeping (docs/BACKUP.md).
 */
'use strict';
const path = require('path');
const WIPE_UNTIL = Date.parse('2026-11-27T21:00:00+07:00');
const bkkDay = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const argv = process.argv.slice(2);
const confirm = argv[argv.indexOf('--confirm') + 1];
const APPLY = argv.indexOf('--confirm') >= 0;

if (path.basename(process.env.ATOM_PG_ENV || '') !== 'atom-prod.env') { console.error('🔴 ใช้กับ atom-prod เท่านั้น: ATOM_PG_ENV=atom-prod.env'); process.exit(2); }
if (Date.now() >= WIPE_UNTIL) { console.error('🔴 ตั้งแต่ 27 พ.ย. 21:00 (คืนย้ายขั้น 5a) atom-prod คือระบบจริงของโรงเรียน — เครื่องมือนี้ปฏิเสธเสมอ'); process.exit(2); }
if (APPLY && confirm !== 'wipe-uat-' + bkkDay()) { console.error('🔴 ต้องใส่ --confirm wipe-uat-' + bkkDay() + ' (วันที่ของวันนี้)'); process.exit(2); }

(async () => {
  const { connect } = require('./pg_lib.js');
  const { client: c } = await connect();
  const tables = (await c.query("select tablename from pg_tables where schemaname='public' order by 1")).rows.map(r => r.tablename);
  const count = async () => { const o = {}; for (const t of tables) o[t] = (await c.query(`select count(*)::int n from public."${t}"`)).rows[0].n; return o; };
  const before = await count();
  const nonEmpty = Object.entries(before).filter(([, n]) => n > 0);
  const tenants = (await c.query('select code from tenant order by code')).rows.map(r => r.code);
  console.log('tenant: ' + (tenants.join(', ') || '(ไม่มี)') + ' · ตารางที่มีข้อมูล ' + nonEmpty.length + '/' + tables.length +
    ' · รวม ' + nonEmpty.reduce((a, [, n]) => a + n, 0) + ' แถว');
  if (!APPLY) { console.log('(รายงานอย่างเดียว — ใส่ --confirm wipe-uat-' + bkkDay() + ' เพื่อล้าง)'); await c.end(); return; }
  await c.query('begin');
  try {
    /* children before the tenant: every table but tenant, then tenant */
    for (const t of tables.filter(t => t !== 'tenant')) await c.query(`delete from public."${t}"`);
    await c.query('delete from public.tenant');
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); console.error('🔴 ล้างไม่สำเร็จ ไม่มีอะไรถูกลบ: ' + e.message); process.exit(1); }
  const after = await count();
  const left = Object.entries(after).filter(([, n]) => n > 0);
  await c.end();
  if (left.length) { console.error('🔴 ยังเหลือข้อมูล: ' + left.map(([t, n]) => t + '=' + n).join(', ')); process.exit(1); }
  console.log('✅ atom-prod ว่างแล้ว — ' + tables.length + ' ตาราง · 0 แถว');
})().catch(e => { console.error('🔴 ' + e.message); process.exit(1); });
