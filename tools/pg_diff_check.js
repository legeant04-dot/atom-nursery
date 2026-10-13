/**
 * tools/pg_diff_check.js — Phase 2.5. Does the mirror still say the same thing as the sheets?
 *   node tools/pg_diff_check.js --file secrets/export/<name>.json
 *   node tools/pg_diff_check.js --file <…> --history        just show the streak and stop
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS ACTUALLY FOR
 *
 * During dual-write the sheets are the truth and Postgres is a copy. The only question that matters
 * is whether the copy is faithful — and the only honest way to answer it is to compare them, every
 * day, and to be able to say how long the answer has been yes.
 *
 * So this does NOT just print today's differences. It keeps a ledger, and the number it exists to
 * produce is the STREAK: how many consecutive days the two databases have been identical. "It
 * looked fine when I checked" is not a cutover criterion. "Identical for fourteen consecutive
 * days, including two payroll runs and a month end" is.
 *
 * 🔴 AND A DAY WE COULD NOT CHECK IS NOT A CLEAN DAY. A table that cannot be matched, a file that
 * is missing, a connection that failed — each breaks the streak, because a streak that survives not
 * having looked is a number that says the opposite of what it means. This is the same rule the
 * speed report had to learn: silence is not success.
 *
 * READ ONLY. It never writes to Postgres. It cannot: the whole point is to observe the mirror
 * without touching it, and a checker that repairs what it finds destroys the evidence of a bug it
 * has just hidden.
 *
 * 💰 MONEY IS REPORTED SEPARATELY, ALWAYS. A note that differs is a curiosity; an amount that
 * differs is the thing this entire migration is most able to get wrong, and it must never be a line
 * item inside a count of 312 other differences.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { targetSchema, planLoad, moneyColumns } = require('./pg_migrate.js');
const { diffTable, rowKeys, MATCH_KEY_ } = require('./pg_sync.js');
const { connect, readEnv } = require('./pg_lib');

const arg = n => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : (process.argv[i + 1] || true); };
const LEDGER = path.join(ROOT, 'secrets', 'diff_history.json');
const today = () => { const d = new Date(Date.now() + 7 * 3600000); return d.toISOString().slice(0, 10); };

function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch (e) { return { days: [] }; }
}
/** One entry per DAY — a second run on the same day replaces the first rather than inflating it. */
function writeLedger(entry) {
  const L = readLedger();
  L.days = L.days.filter(d => d.date !== entry.date).concat([entry]).slice(-120);
  L.days.sort((a, b) => a.date.localeCompare(b.date));
  try { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(L, null, 2)); } catch (e) {}
  return L;
}
/** Consecutive clean days ending today — broken by a difference OR by a day we could not check. */
function streak(L) {
  let n = 0;
  for (let i = L.days.length - 1; i >= 0; i--) { if (!L.days[i].clean) break; n++; }
  return n;
}

function render(L) {
  const s = streak(L);
  const lines = [];
  lines.push('\n  ── ประวัติการตรวจ ──');
  L.days.slice(-14).forEach(d => lines.push('     ' + d.date + '  ' +
    (d.clean ? '✅ เหมือนกันทุกตาราง' : (d.checked === false ? '⚠️  ตรวจไม่ได้: ' + (d.why || '?')
      : '🔴 ต่าง ' + d.diffs + ' จุด' + (d.money ? '  💰 รวมคอลัมน์เงิน ' + d.money + ' จุด' : '')))));
  lines.push('');
  lines.push(s >= 14 ? '  ✅ เหมือนกันติดต่อกัน ' + s + ' วัน — ถึงเกณฑ์ที่เสนอไว้สำหรับการตัดระบบ'
           : s > 0   ? '  🟡 เหมือนกันติดต่อกัน ' + s + ' วัน (เสนอเกณฑ์ไว้ที่ 14 วัน และต้องคร่อมรอบเงินเดือนกับสิ้นเดือน)'
                     : '  🔴 ยังไม่มีวันที่สะอาดติดต่อกันเลย');
  return lines.join('\n');
}

/**
 * 💰 Which of a table's differences touch an AMOUNT.
 *
 * Separated out and returned rather than printed, so the rule can be tested — this is the single
 * most consequential line of the report, and "three differences in billing" and "three differences
 * in billing, one of them TotalDue" are not the same sentence.
 *
 * 🔴 A ROW PRESENT ON ONLY ONE SIDE COUNTS TOO, if the table holds money at all. A bill that exists
 * in the sheets and not in Postgres has no "differing column" — it is a whole invoice missing, and
 * reporting it as "no money columns differ" would be true and useless.
 *
 * @param cols   sheet column → pg column, for this table
 * @param mcols  the pg columns that are numeric(12,2), from the schema — never guessed
 */
function moneyHit(table, d, cols, mcols) {
  const mc = new Set(mcols);
  if (!mc.size) return null;
  const changed = new Set();
  d.update.forEach(u => u.changed.forEach(sheetCol => { if (mc.has(cols[sheetCol])) changed.add(sheetCol); }));
  const gaps = d.insert.length + d.del.length;
  if (!changed.size && !gaps) return null;
  return { table, cols: [...changed], gaps };
}

async function main() {
  if (process.argv.includes('--history')) { console.log(render(readLedger())); console.log(''); return; }

  const file = arg('file');
  const date = today();
  const fail = (why) => {
    /* 🔴 A DAY WE COULD NOT CHECK BREAKS THE STREAK. Recording it as "no differences found" would be
     * literally true and completely misleading, which is the shape of mistake this project keeps
     * finding in its own reports. */
    const L = writeLedger({ date, clean: false, checked: false, why });
    console.log('\n🔴 ตรวจไม่ได้: ' + why);
    console.log(render(L)); console.log('');
    process.exit(2);
  };

  if (!file || file === true) fail('ไม่ได้ระบุไฟล์ส่งออก (--file)');
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(abs)) fail('ไม่พบไฟล์ส่งออก: ' + file);

  let data, schema, keys, plan, c;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    schema = targetSchema();
    keys = rowKeys(fs.readFileSync(path.join(ROOT, 'docs', 'schema', '001_init.sql'), 'utf8').replace(/\r\n/g, '\n'));
    ({ plan } = planLoad(data, schema));
  } catch (e) { fail('อ่านไฟล์ส่งออกไม่สำเร็จ: ' + e.message); }

  const env = readEnv();
  ({ client: c } = await connect());
  const tenant = await c.query('select id from tenant where code = $1', [env.TENANT_CODE || 'atom']);
  if (!tenant.rows.length) { await c.end(); fail('ไม่พบ tenant รหัส "' + (env.TENANT_CODE || 'atom') + '"'); }
  const TENANT = tenant.rows[0].id;
  const money = moneyColumns(schema);

  console.log('\n═══ Phase 2.5 · ตรวจความต่างประจำวัน ' + date + ' ═══');
  console.log('  🔒 อ่านอย่างเดียว — ไม่เขียนอะไรลง Postgres เลย\n');

  const rows = [], moneyHits = [], unmatched = [];
  let diffs = 0;

  for (const t of plan) {
    const uniq = Object.keys(t.cols).find(sc => t.cols[sc] === keys[t.table]);
    const declared = MATCH_KEY_[t.table];
    const mode = declared === 'APPEND_ONLY' ? 'APPEND_ONLY' : null;
    const key = uniq ? [uniq] : (Array.isArray(declared) ? declared : null) || (mode ? Object.keys(t.cols) : null);
    if (!key) { unmatched.push(t.table); continue; }

    const pg = await c.query('select * from ' + t.table + ' where tenant_id = $1', [TENANT]);
    const types = schema[t.table] || {};
    const d = diffTable(t.rows, pg.rows, t.cols, key, types, mode);
    const n = d.insert.length + d.update.length + d.del.length;
    if (!n && !d.unkeyed) continue;
    diffs += n;

    const hit = moneyHit(t.table, d, t.cols, money[t.table] || []);
    if (hit) moneyHits.push(hit);

    rows.push({ table: t.table, only_sheet: d.insert.length, only_pg: d.del.length,
      differ: d.update.length, unkeyed: d.unkeyed,
      cols: [...new Set(d.update.flatMap(u => u.changed))].slice(0, 6) });
  }
  await c.end();

  if (unmatched.length) {
    /* Not a difference — something worse. A table nobody can compare is a table nobody is checking,
     * and it must not be able to hide inside a clean result. */
    console.log('  🔴 ตารางที่เทียบไม่ได้ (' + unmatched.length + '): ' + unmatched.join(' '));
    console.log('     → วันนี้นับว่า "ตรวจไม่ครบ" ไม่ใช่ "ไม่มีอะไรต่าง"\n');
  }

  if (!rows.length && !unmatched.length) {
    console.log('  ✅ ไม่มีอะไรต่างกันเลย — ทุกตาราง ทุกแถว ทุกคอลัมน์');
  } else {
    console.log('  ตาราง'.padEnd(26) + 'มีแต่ในชีต  มีแต่ใน pg  ค่าต่าง');
    rows.sort((a, b) => (b.only_sheet + b.only_pg + b.differ) - (a.only_sheet + a.only_pg + a.differ))
      .forEach(r => console.log('  ' + r.table.padEnd(24) + String(r.only_sheet).padStart(8) +
        String(r.only_pg).padStart(12) + String(r.differ).padStart(10) +
        (r.cols.length ? '   (' + r.cols.join(',') + ')' : '') +
        (r.unkeyed ? '   ⚠️ ' + r.unkeyed + ' แถวไม่มีคีย์' : '')));
  }

  /* 💰 PRINTED LAST AND ON ITS OWN, so it cannot be skimmed past inside the table above. The
   * school's standing rule: money is the thing that decides whether the app is believed. */
  if (moneyHits.length) {
    console.log('\n  💰🔴 ความต่างที่แตะคอลัมน์เงิน — ตรวจก่อนอย่างอื่น');
    moneyHits.forEach(h => console.log('     ' + h.table +
      (h.cols.length ? ' · คอลัมน์ ' + h.cols.join(', ') : '') +
      (h.gaps ? ' · แถวที่มีอยู่ฝั่งเดียว ' + h.gaps : '')));
  }

  const clean = !rows.length && !unmatched.length;
  const L = writeLedger({ date, clean, checked: !unmatched.length, diffs,
    money: moneyHits.length, tables: rows.length });
  console.log(render(L));
  console.log('\n  (บันทึกไว้ที่ secrets/diff_history.json — อยู่นอก git)\n');
  process.exit(clean ? 0 : 1);
}

module.exports = { streak, render, readLedger, writeLedger, LEDGER, moneyHit };
if (require.main === module) main().catch(e => { console.log('🔴 ' + e.message); process.exit(2); });
