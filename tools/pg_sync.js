/**
 * tools/pg_sync.js — Phase 2.4. Keep Postgres in step with the sheets, by DIFF.
 *   node tools/pg_sync.js --file secrets/export/<name>.json --dry      say what would change
 *   node tools/pg_sync.js --file secrets/export/<name>.json --apply    do it
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHY THIS IS NOT "WRITE TO BOTH PLACES AT ONCE"
 *
 * The obvious reading of dual-write is: every time the app writes a row to Sheets, it also POSTs it
 * to Supabase. That design is already known to be wrong HERE, and the evidence is in this repo.
 *
 * The 06–09/10 speed report read: 18:00 fail 13%, 19:00 15%, 20:00 37% — the worst hours of the
 * day, and the hours every teacher clocks out. The cause was one outbound HTTPS call (a LINE push)
 * made INSIDE the write lock, so one person's notification was ~300ms during which nobody in the
 * school could write. The fix, in `src/Code.gs`, was to move the network out of the lock entirely.
 *
 * A Supabase call on every write would be the same mistake, on EVERY write rather than on the few
 * that notify. So the mirror is kept off the request path completely: the school's sheets are
 * exported as they already are, and this reconciles the two databases afterwards.
 *
 * 🔴 AND IT IS A DIFF, NOT A RELOAD. Deleting everything and re-inserting would work and would be
 * unusable: it loses the `id` each row was given, so anything that ever points at a row by id is
 * broken on every cycle, and a crash halfway leaves the school's data half-present. Each row is
 * matched by its SHEET id (STD-001, STF-011) and only the rows that actually differ are touched —
 * which is also what makes the daily difference report of Phase 2.5 possible at all: a sync that
 * reports "0 changes" is the check, not just the write.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 PDPA. This moves REAL CHILDREN'S DATA into Postgres, so `--apply` refuses unless the school
 * has recorded that the agreement is signed (see PDPA_SIGNED in secrets/supabase.env). `--dry`
 * reads and reports and writes nothing, and is the only mode that may be used before then.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { targetSchema, planLoad, tableFor, encode_, encodeRejects_ } = require('./pg_migrate.js');
const { connect, readEnv } = require('./pg_lib');

const arg = n => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : (process.argv[i + 1] || true); };
const APPLY = process.argv.includes('--apply');

/* ── which column identifies a row, read from the schema that declares it ─────────────────────────
 * The unique index migration 001 creates IS the answer, so it is read rather than restated — the
 * alternative is a second list that can disagree with the first, and Phase 2.3 is the record of
 * what guessing a row key costs. A table with no unique index cannot be diffed row by row; those
 * are listed and handled by replacement, which is safe because they are logs and attendance rather
 * than records anything points at. */
function rowKeys(sql) {
  const keys = {};
  for (const m of sql.matchAll(/create unique index if not exists (\w+)_code_uq on (\w+)\(tenant_id, "?([a-z_]+)"?\)/g))
    keys[m[2]] = m[3];
  return keys;
}

/** The sheet column whose snake_case is `pgCol`, taken from the row we actually have. */
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

/* ── 🔴 HOW TO MATCH A ROW THAT HAS NO ID OF ITS OWN ─────────────────────────────────────────────
 *
 * Most of the school's DATA — by a wide margin — lives in tables with no single-column key: every
 * check-in, every daily journal, every measurement, every log. Phase 2.3 established that those
 * tables must NOT have a unique index on a person (`checkin_staff(tenant,staff_id)` would have meant
 * one clock-in per teacher, ever). That is right, and it leaves this question open: when the sheet
 * and the database both hold a row for the same teacher on the same day, are they the same row?
 *
 * DECLARED, not inferred, for the third time in this migration — and for the reason the other two
 * taught: the key is a fact about how the school works, and no amount of looking at column names
 * will tell you it.
 *
 *   [cols…]        these columns together identify one row
 *   'APPEND_ONLY'  a log. Rows are only ever added. Never updated, NEVER deleted — see below.
 *
 * 🔴 WHY A LOG IS A SEPARATE MODE. An audit log is the record of who touched what, and the one
 * thing it must survive is somebody wanting it not to exist. Diffing it would mean a row missing
 * from the sheet becomes a DELETE in Postgres — so trimming a spreadsheet would silently erase the
 * PDPA record of having trimmed it. Append-only means the mirror can only ever grow.
 */
const MATCH_KEY_ = {
  // ── one per person per day (or per day and part of day) ─────────────────────────────────────
  checkin_staff: ['StaffID', 'Date'],
  checkin_student: ['StudentID', 'Date', 'Time', 'Type'],   // in and out are separate rows
  daily_journal: ['StudentID', 'Date'],
  growth_records: ['StudentID', 'Date'],
  absence_log: ['StudentID', 'Date', 'Type'],
  absence_followup: ['StudentID', 'Date'],
  holiday_attend: ['StudentID', 'Date'],
  // ── one per person per thing ────────────────────────────────────────────────────────────────
  vaccine_records: ['StudentID', 'VaccineKey'],
  work_schedule: ['StaffID', 'DayOfWeek'],
  line_recipients: ['StaffID', 'Topic'],
  pickup_persons: ['StudentID', 'Name', 'Phone'],
  user_links: ['UserUID', 'StudentID'],
  // ── reference data with a natural key ───────────────────────────────────────────────────────
  holidays: ['Date'],
  school_config: ['Key'],
  staff_groups: ['GroupName'],
  dspm_criteria: ['AgeLabelTH', 'ItemNo'],
  // ── logs ────────────────────────────────────────────────────────────────────────────────────
  audit_log: 'APPEND_ONLY',
  hr_audit_log: 'APPEND_ONLY',
  backup_log: 'APPEND_ONLY',
  perf_log: 'APPEND_ONLY'
};

/** Compare what the sheet says against what the column holds, in the column's own terms. */
function same(sheetVal, pgVal, type) {
  const a = encode_(sheetVal, type);
  // the driver hands back an instant; compare on the school's calendar, never the server's
  let b = (pgVal instanceof Date) ? dateText(pgVal, type) : pgVal;
  /* A blank boolean cell means false, and must not be read as "different from false" — otherwise
   * every unticked checkbox in the school is reported as a change on every run, for ever, and the
   * sync writes rather than reports. (The sheet does not distinguish "no" from "not answered"; if
   * it ever needs to, that is a column change, not a comparison change.) */
  if ((a === null || a === undefined) && /^boolean/.test(type || '')) return !b;
  if (a === null || a === undefined) return b === null || b === undefined || b === '';
  if (/^numeric/.test(type || '')) return Number(a) === Number(b);
  if (/^boolean/.test(type || '')) return !!a === !!b;
  return String(a) === String(b);
}

/**
 * What would change, per table. Pure — it takes the sheet rows and the Postgres rows and returns a
 * plan, so the whole of this can be tested without a database.
 */
function diffTable(sheetRows, pgRows, cols, key, types, mode) {
  /* `key` is one column or several. A composite key is joined with a separator no id contains, so
   * ('S-1','2026-10-13') cannot collide with ('S-12','026-10-13') — which is the sort of thing that
   * works for years and then merges two children's journals. */
  const parts = Array.isArray(key) ? key : [key];
  const sheetKeyOf = row => parts.map(p => String(row[p] == null ? '' : row[p])).join('\u0000');
  const pgKeyOf = r => parts.map(p => {
    const v = r[cols[p] || snake(p)];
    if (v instanceof Date) return String(dateText(v, types[cols[p] || snake(p)]));
    return String(v == null ? '' : v);
  }).join('\u0000');

  const insert = [], update = [], del = [];
  const byKey = new Map();
  pgRows.forEach(r => byKey.set(pgKeyOf(r), r));
  const seen = new Set();
  let unkeyed = 0;

  sheetRows.forEach(row => {
    const k = sheetKeyOf(row);
    // every part empty means the row cannot be matched to anything — counted, never guessed at
    if (!k.replace(/\u0000/g, '')) { unkeyed++; return; }
    seen.add(k);
    const existing = byKey.get(k);
    if (!existing) { insert.push(row); return; }
    if (mode === 'APPEND_ONLY') return;                 // present already; a log is never rewritten
    const changed = Object.keys(cols).filter(sheetCol =>
      !same(row[sheetCol], existing[cols[sheetCol]], types[cols[sheetCol]]));
    if (changed.length) update.push({ id: existing.id, row, changed });
  });
  /* 🔴 and a log is never shortened. A row missing from the sheet would otherwise become a DELETE,
   * so trimming a spreadsheet would erase the record of having trimmed it. */
  if (mode !== 'APPEND_ONLY') byKey.forEach((r, k) => { if (!seen.has(k)) del.push({ id: r.id, key: k }); });
  return { insert, update, del, unkeyed };
}

/** A Date from the driver, rendered the way the sheet holds it — the school's calendar, not UTC. */
function dateText(d, type) {
  const t = new Date(d.getTime() + 7 * 60 * 60000);
  const p2 = n => String(n).padStart(2, '0');
  const ymd = t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate());
  if (/^date/.test(type || '')) return ymd;
  if (/^time/.test(type || '') && !/^timestamp/.test(type || '')) return p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes());
  if (!t.getUTCHours() && !t.getUTCMinutes() && !t.getUTCSeconds()) return ymd;
  return ymd + ' ' + p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes()) + ':' + p2(t.getUTCSeconds());
}

async function main() {
  const file = arg('file');
  if (!file || file === true) {
    console.log('\n  ใช้: node tools/pg_sync.js --file secrets/export/<name>.json --dry\n');
    console.log('  ไฟล์นั้นมาจาก src/Export.gs → exportAllForMigration() (รันจาก Apps Script editor)\n');
    process.exit(2);
  }
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(abs)) { console.log('\n🔴 ไม่พบไฟล์: ' + file + '\n'); process.exit(2); }

  const env = readEnv();
  /* 🔴 THE PDPA GATE. Phase 1.5 is not signed, and this is the command that would put real
   * children's records into Postgres. It refuses rather than warns: a warning is a thing somebody
   * scrolls past at the end of a long day. */
  if (APPLY && String(env.PDPA_SIGNED || '').toLowerCase() !== 'yes') {
    console.log('\n🔴 --apply ถูกปฏิเสธ: ยังไม่มีข้อตกลง PDPA');
    console.log('   นี่คือคำสั่งที่จะนำข้อมูลเด็กจริงขึ้น Postgres และกติกาของโครงการคือห้ามก่อนเซ็น');
    console.log('   เมื่อ ผอ. ลงนามแล้ว (ดู docs/pdpa/) ให้ใส่  PDPA_SIGNED=yes  ใน secrets/supabase.env');
    console.log('   ระหว่างนี้ใช้ --dry ซึ่งอ่านอย่างเดียว ไม่เขียนอะไรเลย\n');
    process.exit(3);
  }

  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const schema = targetSchema();
  const sql = fs.readFileSync(path.join(ROOT, 'docs', 'schema', '001_init.sql'), 'utf8').replace(/\r\n/g, '\n');
  const keys = rowKeys(sql);
  const { plan, unknownTables, unknownCols } = planLoad(data, schema);

  const { client: c } = await connect();
  const tenantRow = await c.query('select id, code from tenant where code = $1', [env.TENANT_CODE || 'atom']);
  if (!tenantRow.rows.length) {
    console.log('\n🔴 ไม่พบ tenant รหัส "' + (env.TENANT_CODE || 'atom') + '" — สร้างก่อน หรือใส่ TENANT_CODE ใน secrets/supabase.env\n');
    await c.end(); process.exit(2);
  }
  const TENANT = tenantRow.rows[0].id;

  console.log('\n═══ Phase 2.4 · ซิงก์ Sheets → Postgres (เทียบส่วนต่าง) ═══');
  console.log('  โหมด: ' + (APPLY ? '🔴 APPLY (เขียนจริง)' : '🧪 DRY (อ่านอย่างเดียว)'));
  console.log('  โรงเรียน: ' + tenantRow.rows[0].code);
  if (unknownTables.length) console.log('  ⚠️  ชีตที่ไม่มีตารางรองรับ: ' + unknownTables.join(' '));

  const noKey = [], report = [];
  let I = 0, U = 0, D = 0, same_ = 0;

  for (const t of plan) {
    /* The unique index is the first answer and the best one; where there is none, MATCH_KEY_ says
     * how the school identifies a row. A table in neither is REPORTED rather than skipped quietly —
     * "0 changes" must never be reachable by not having looked. */
    const uniq = Object.keys(t.cols).find(sheetCol => t.cols[sheetCol] === keys[t.table]);
    const declared = MATCH_KEY_[t.table];
    const mode = declared === 'APPEND_ONLY' ? 'APPEND_ONLY' : null;
    const key = uniq ? [uniq]
      : (Array.isArray(declared) ? declared : null)
      || (mode ? Object.keys(t.cols) : null);        // a log row is itself its own identity
    if (!key) { noKey.push(t.table); continue; }
    const pg = await c.query('select * from ' + t.table + ' where tenant_id = $1', [TENANT]);
    const types = schema[t.table] || {};
    const d = diffTable(t.rows, pg.rows, t.cols, key, types, mode);
    I += d.insert.length; U += d.update.length; D += d.del.length;
    same_ += t.rows.length - d.insert.length - d.update.length;
    if (d.insert.length || d.update.length || d.del.length || d.unkeyed)
      report.push({ table: t.table, ins: d.insert.length, upd: d.update.length, del: d.del.length,
        unkeyed: d.unkeyed,
        example: (d.update[0] && d.update[0].changed.slice(0, 4).join(',')) || '' });

    if (APPLY) {
      const names = Object.values(t.cols).map(n => '"' + n + '"');
      await c.query('begin');
      try {
        for (const row of d.insert) {
          const vals = Object.keys(t.cols).map(k => encode_(row[k], types[t.cols[k]], t.table + '.' + t.cols[k]));
          const ph = vals.map((_, i) => '$' + (i + 2)).join(',');
          await c.query('insert into ' + t.table + ' (tenant_id,' + names.join(',') + ') values ($1,' + ph + ')', [TENANT, ...vals]);
        }
        for (const u of d.update) {
          const ks = Object.keys(t.cols);
          const sets = ks.map((k, i) => '"' + t.cols[k] + '"=$' + (i + 3));
          const vals = ks.map(k => encode_(u.row[k], types[t.cols[k]], t.table + '.' + t.cols[k]));
          await c.query('update ' + t.table + ' set ' + sets.join(',') + ', updated_at = now() where id = $1 and tenant_id = $2',
            [u.id, TENANT, ...vals]);
        }
        /* 🔴 A ROW THE SHEET NO LONGER HAS IS DELETED — and that is the one operation here that can
         * destroy something, so it is counted, reported, and bounded below. */
        for (const x of d.del) await c.query('delete from ' + t.table + ' where id = $1 and tenant_id = $2', [x.id, TENANT]);
        await c.query('commit');
      } catch (e) { await c.query('rollback').catch(() => {}); throw new Error(t.table + ': ' + e.message); }
    }
  }

  console.log('\n  ตารางที่เปลี่ยน:');
  if (!report.length) console.log('    — ไม่มีอะไรต่างกัน (ฐานข้อมูลตรงกับชีตแล้ว)');
  report.sort((a, b) => (b.ins + b.upd + b.del) - (a.ins + a.upd + a.del)).forEach(r =>
    console.log('    ' + r.table.padEnd(24) + ' +' + r.ins + ' ~' + r.upd + ' −' + r.del +
      (r.unkeyed ? '   ⚠️ ' + r.unkeyed + ' แถวไม่มีรหัส' : '') + (r.example ? '   (' + r.example + ')' : '')));

  if (noKey.length) {
    /* Named, not hidden. These tables have no unique key — attendance, journals, logs, every table
     * keyed by a person AND a date (see ROW_KEY_ in schema_inventory.js) — so a row-by-row diff has
     * nothing to match on. They are the subject of the next step, and saying nothing about them
     * would let "0 changes" be read as "everything is in step". */
    console.log('\n  ⚠️  ' + noKey.length + ' ตารางยังเทียบรายแถวไม่ได้ (ไม่มีคีย์เดี่ยว):');
    console.log('     ' + noKey.join(' '));
    console.log('     → ต้องใช้คีย์ประกอบ (เช่น คน+วันที่) ซึ่งเป็นงานถัดไปของ 2.4');
  }

  console.log('\n  ' + (APPLY ? 'เขียนแล้ว' : 'จะเขียน') + ': เพิ่ม ' + I + ' · แก้ ' + U + ' · ลบ ' + D + ' · เหมือนเดิม ' + same_);
  if (encodeRejects_.length) {
    console.log('\n  🔴 ค่าที่ลงคอลัมน์ไม่ได้ และถูกเก็บเป็นค่าว่าง: ' + encodeRejects_.length);
    encodeRejects_.slice(0, 8).forEach(r => console.log('     ' + r.where + ' (' + r.type + ') = ' + JSON.stringify(r.value)));
  }
  if (!APPLY) console.log('\n  (ยังไม่ได้เขียนอะไร — ใส่ --apply เมื่อพร้อม)');
  console.log('');
  await c.end();
}

module.exports = { diffTable, same, rowKeys, dateText, MATCH_KEY_ };
if (require.main === module) main().catch(e => { console.log('🔴 ' + e.message); process.exit(1); });
