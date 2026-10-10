/**
 * tools/pg_migrate.js — Phase 2.2. Four years of spreadsheet into Postgres, and a money report.
 *
 *   node tools/pg_migrate.js --file secrets/export/atom_export_….json --dry     read + report only
 *   node tools/pg_migrate.js --file …                 --tenant atom             actually write
 *   node tools/pg_migrate.js --file … --report docs/money_diff.md               save the report
 *
 * The input is what src/Export.gs writes: { MAIN: { SHEET: [rows] }, HR: { … } }, rows decoded the
 * way the APP reads them — dates as 'YYYY-MM-DD', blanks as '', JSON cells parsed. That is the
 * point: we move the values the app sees, not the ones the spreadsheet happens to hold.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 --dry IS THE DEFAULT AND IT IS NOT POLITENESS.
 *
 * No real student data goes to Supabase until the PDPA processing agreement exists and the ผอ. has
 * approved it (Phase 1.5). Writing requires BOTH `--tenant` and the absence of `--dry`, and the
 * run prints what it is about to do first. A migration tool that writes by default is a tool that
 * writes by accident.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 💰 THE REPORT IS THE DELIVERABLE, NOT THE LOAD.
 *
 * Sheets stores every number as a float64. `6899.999999999999` is what four years of arithmetic on
 * binary fractions leaves behind, and it has been rendering as 6,900 the whole time because the
 * screen rounds. numeric(12,2) will store 6900.00 — correct, and DIFFERENT from what is on the
 * sheet today.
 *
 * Every one of those differences is a number somebody was once told. The ผอ. has to see the list
 * and agree to it BEFORE the school runs on it; it cannot be discovered afterwards from a parent
 * asking why their bill moved by one satang. So this reports, per money column:
 *     · rows where the stored float ≠ the value rounded to 2 decimals
 *     · the signed difference, and the total per column
 *     · anything that will not fit numeric(12,2) at all — which must be fixed before loading
 */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const decomment = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || true) : d; };
const DRY = argv.indexOf('--dry') >= 0 || argv.indexOf('--tenant') < 0;

/* ── the destination, read from the SAME file the SQL was generated from ─────────────────────────
 * Not from the database: a column that is missing from Postgres must be reported as missing, and a
 * tool that asks the database what it has can only ever agree with it. */
function targetSchema() {
  const sql = R('docs/schema/001_init.sql');
  const tables = {};
  for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    const cols = {};
    for (const c of m[2].matchAll(/^ {2}([a-z_]+)\s+([a-z0-9_(), ]+?),?\s*$/gm)) cols[c[1]] = c[2].trim();
    tables[m[1]] = cols;
  }
  return tables;
}

/* which sheet becomes which table — the same rule as the generator, including the HR prefix that
 * keeps the two AUDIT_LOGs apart. Duplicated deliberately rather than imported, and asserted equal
 * in tools/test_pg_migrate.js: a migrator that disagrees with the schema about a table name fails
 * at 3am on the one table it got wrong. */
const HR_PREFIXED = new Set(['AUDIT_LOG']);
const tableFor = (wb, sheet) => (wb === 'HR' && HR_PREFIXED.has(sheet)) ? 'hr_' + snake(sheet) : snake(sheet);

/* ── money, named rather than guessed ───────────────────────────────────────────────────────────
 * Read out of the generated SQL, so the list cannot drift from what the columns actually are. */
function moneyColumns(schema) {
  const out = {};
  Object.keys(schema).forEach(t => {
    const cols = Object.keys(schema[t]).filter(c => /^numeric\(12,2\)$/.test(schema[t][c]));
    if (cols.length) out[t] = cols;
  });
  return out;
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const NUM_MAX = 9999999999.99;        // numeric(12,2)

/**
 * 💰 What changes, to the satang, when a float becomes numeric(12,2).
 *
 * Reports only what a person has to DECIDE about:
 *   changed  — the stored value is not what 2dp rounding gives. Real, and the thing to show the ผอ.
 *   tooBig   — will not fit numeric(12,2). Must be fixed on the sheet first; loading would throw.
 *   notNum   — a money column holding something that is not a number (usually '' or a stray label).
 */
/* ═══ 🔴 WHAT ACTUALLY CHANGES, AND HOW I GOT IT WRONG TWICE ════════════════════════════════════
 *
 * First version: report every row where the stored float ≠ its 2-dp rounding. That is thousands of
 * rows of `6899.999999999999 → 6900.00` — a difference of one part in a trillion of a baht — and
 * it buries anything real.
 *
 * Second version: split them at half a satang, "real money" above, "tidying" below. The threshold
 * `Math.abs(d) >= 0.005` then MISSED `1200.005 → 1200.01`, because that difference computes as
 * 0.004999999999954525. A float comparison, failing, inside the tool whose entire subject is float
 * error. Caught by reading the output rather than by a test, which is the only reason it did not
 * ship.
 *
 * 🔴 AND BOTH VERSIONS WERE ANSWERING THE WRONG QUESTION. The app has ALWAYS rounded for display.
 * Nobody has ever been shown `6899.999999999999`; they were shown ฿6,900. So no per-row conversion
 * changes a figure anybody was told — per-row, this migration is invisible by construction.
 *
 * WHERE IT IS NOT INVISIBLE IS A TOTAL. Sheets sums the raw floats; Postgres sums exact numerics.
 * Add up a hundred bills and the two answers can differ by real satang — and a monthly income total
 * is a figure the ผอ. HAS seen, has filed, and may have given to someone else.
 *
 * So the report compares, per money column:  Σ(what the sheet holds)  vs  Σ(what Postgres will hold)
 * That is one number per column, it is checkable against a report the school already has, and it is
 * the only place the move can actually move money.
 */
const sum = xs => xs.reduce((a, b) => a + b, 0);
/* 2 decimals when the figure is exact at 2 decimals, and the extra digits when it is not — so a
 * shift of ฿0.005 prints as 0.005 rather than being rounded up to 0.01 in the one line somebody
 * quotes. Rounding a finding in the sentence that reports it is how a report overstates itself. */
const baht = n => (Math.round(n * 100) / 100 === n) ? n.toFixed(2) : String(Number(n.toFixed(6)));

function moneyReport(data, schema) {
  const money = moneyColumns(schema);
  const perColumn = {}, tooBig = [], notNum = [], tidied = [];
  let tidiedRows = 0;

  for (const wb of ['MAIN', 'HR']) {
    const book = data[wb] || {};
    for (const sheet of Object.keys(book)) {
      const tbl = tableFor(wb, sheet);
      const cols = money[tbl]; if (!cols) continue;

      book[sheet].forEach((row, i) => {
        let rowTidied = false;
        Object.keys(row).forEach(k => {
          const pg = snake(k);
          if (cols.indexOf(pg) < 0) return;
          const raw = row[k];
          if (raw === '' || raw === null || raw === undefined) return;   // blank is blank, not zero
          const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
          if (!Number.isFinite(n)) { notNum.push(`${tbl}.${pg} row ${i + 2} = ${JSON.stringify(raw)}`); return; }
          if (Math.abs(n) > NUM_MAX) { tooBig.push(`${tbl}.${pg} row ${i + 2} = ${n}`); return; }

          const key = tbl + '.' + pg;
          const c = perColumn[key] || (perColumn[key] = { rows: 0, before: [], after: [] });
          c.rows++;
          c.before.push(n);                 // what the sheet holds, untouched
          c.after.push(round2(n));          // what Postgres will hold

          /* the per-row list is CONTEXT, not the finding — see the block above REAL_MONEY. It shows
           * which values were stored untidily; it does not claim anybody was told a wrong number. */
          if (round2(n) !== n) {
            rowTidied = true;
            if (tidied.length < 60) tidied.push({ where: key, row: i + 2, from: n, to: round2(n) });
          }
        });
        if (rowTidied) tidiedRows++;
      });
    }
  }

  /* 🔴 THE FINDING: Σ(float) vs Σ(numeric), per column.
   *
   * Summed in the order the rows appear, because that is the order a spreadsheet's own SUM() adds
   * them in and float addition is not associative — adding the same numbers in a different order
   * gives a different answer, which is itself part of what makes the current totals unreliable. */
  const columns = [];
  let totalShift = 0;
  Object.keys(perColumn).sort().forEach(k => {
    const c = perColumn[k];
    const before = sum(c.before);
    const after = round2(sum(c.after));
    const shift = after - before;                    // RAW — rounding it here is what made 0.005 print as 0.01
    columns.push({ column: k, rows: c.rows, before, after, shift });
    totalShift += shift;
  });
  const moved = columns.filter(c => Math.abs(c.shift) > 1e-9);   // 1e-12 of a baht is not a shift

  return { columns, moved, tooBig, notNum, tidied, tidiedRows,
           // raw, for the same reason the per-column shift is raw: rounding ฿0.005 to ฿0.01 in the
           // headline doubles it, and the headline is the figure somebody quotes
           totalShift,
           columnsChecked: Object.values(money).reduce((a, c) => a + c.length, 0) };
}

/** The report as Thai markdown — this is what the ผอ. reads, so it says what it means in words. */
/**
 * The report the ผอ. reads. It leads with the ONE question that needs an answer — did any column
 * total move — and puts everything else behind a fold. A page of `6899.999999999999 → 6900.00`
 * looks alarming and asks for a decision nobody can make; a single line saying "two columns moved,
 * ฿0.03 in total" is a decision somebody can actually take.
 */
function renderReport(rep, meta) {
  /* 🔴 FORMATTING THAT DOES NOT HIDE THE FINDING.
   *
   * The first draft printed every figure at 2 decimals, and the result was a row reading
   *     ยอดรวมเดิม 15,000.01 | ยอดรวมใหม่ 15,000.01 | ต่าง 0.01
   * — two identical numbers beside a difference. The 2-dp rendering had rounded the "before" into
   * the "after". A report whose own formatting conceals the thing it is reporting is worse than no
   * report, so anything that is not already exact at 2 decimals is shown with the digits that make
   * the difference visible. */
  const B = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const Braw = n => (round2(n) === n)
    ? B(n)
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const L = [];
  L.push('# 💰 รายงานส่วนต่างตัวเลขเงิน — ก่อนย้ายไป Postgres');
  L.push('');
  L.push(`ไฟล์ที่ใช้: \`${meta.file}\` · ส่งออกเมื่อ ${meta.exportedAt || '-'} · ตรวจเมื่อ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  L.push('');
  L.push('## เรื่องนี้คืออะไร (อ่าน 1 นาที)');
  L.push('');
  L.push('Google Sheets เก็บตัวเลขทุกตัวเป็น **ทศนิยมฐานสอง (float)** — บวกลบคูณกันไปมาสี่ปี');
  L.push('ค่าที่ควรเป็น `6,900` จึงกลายเป็น `6899.999999999999` อยู่ในชีตจริงๆ');
  L.push('ระบบใหม่เก็บเป็น `numeric` ซึ่งเก็บได้ตรงเป๊ะ');
  L.push('');
  L.push('**แต่ละแถวจะไม่มีอะไรเปลี่ยนในสายตาคน** เพราะหน้าจอปัดให้ 2 ตำแหน่งมาตลอดอยู่แล้ว');
  L.push('ไม่เคยมีใครเห็นเลข `6899.999999999999` — ทุกคนเห็น ฿6,900 มาตั้งแต่แรก');
  L.push('');
  L.push('> 🔴 **ที่เปลี่ยนได้จริงคือ "ยอดรวม"** · ชีตบวกเลขที่มีเศษ ระบบใหม่บวกเลขที่ตรง');
  L.push('> บวกบิลร้อยใบแล้วสองฝั่งอาจต่างกันเป็นสตางค์จริงๆ');
  L.push('> **และยอดรวมรายเดือนคือตัวเลขที่ ผอ. เคยเห็น เคยเก็บ และอาจเคยส่งต่อให้คนอื่นไปแล้ว**');
  L.push('');
  L.push('ตารางข้างล่างจึงเทียบ **ผลรวมแต่ละคอลัมน์** ระหว่างของเดิมกับของใหม่ — เอาไปเทียบกับรายงานที่โรงเรียนมีอยู่แล้วได้เลย');
  L.push('');
  L.push('## สรุป');
  L.push('');
  L.push('| | |');
  L.push('|---|---:|');
  L.push(`| คอลัมน์เงินที่ตรวจทั้งหมด | ${rep.columnsChecked} |`);
  L.push(`| คอลัมน์ที่มีข้อมูลจริง | ${rep.columns.length} |`);
  L.push(`| 🔴 **คอลัมน์ที่ยอดรวมขยับ** | **${rep.moved.length}** |`);
  L.push(`| 🔴 **ยอดรวมที่ขยับทั้งหมด** | **${Braw(rep.totalShift)} บาท** |`);
  L.push('');
  if (!rep.moved.length) {
    L.push('## ✅ ไม่มียอดรวมคอลัมน์ไหนขยับเลย');
    L.push('');
    L.push('ยอดรวมทุกคอลัมน์ออกมาเท่าเดิมทุกบาททุกสตางค์ · **ไม่มีอะไรต้องอนุมัติ**');
    if (rep.tidiedRows) {
      L.push('');
      L.push(`(มี ${rep.tidiedRows} แถวที่ค่าถูกเก็บไว้เป็นเศษทศนิยม และจะถูกเก็บให้ตรงขึ้น`);
      L.push('— จำนวนเงินเท่าเดิม และหน้าจอก็แสดงค่าเดิมมาตลอด)');
    }
  } else {
    L.push('## 🔴 คอลัมน์ที่ยอดรวมขยับ — ต้องอนุมัติ');
    L.push('');
    L.push('| คอลัมน์ | จำนวนแถว | ยอดรวมเดิม (ชีต) | ยอดรวมใหม่ | ต่าง (บาท) |');
    L.push('|---|---:|---:|---:|---:|');
    rep.moved.forEach(c =>
      L.push(`| \`${c.column}\` | ${c.rows} | ${Braw(c.before)} | ${B(c.after)} | **${Braw(c.shift)}** |`));
  }
  L.push('');
  if (rep.columns.length) {
    L.push('<details><summary>ยอดรวมทุกคอลัมน์ที่มีข้อมูล (กดเพื่อดู)</summary>');
    L.push('');
    L.push('| คอลัมน์ | แถว | ยอดรวมเดิม | ยอดรวมใหม่ | ต่าง |');
    L.push('|---|---:|---:|---:|---:|');
    rep.columns.forEach(c =>
      L.push(`| \`${c.column}\` | ${c.rows} | ${Braw(c.before)} | ${B(c.after)} | ${Braw(c.shift)} |`));
    L.push('');
    L.push('</details>');
    L.push('');
  }
  if (rep.tidied.length) {
    L.push(`<details><summary>ตัวอย่างค่าที่ถูกเก็บให้ตรงขึ้น (${rep.tidiedRows} แถว · กดเพื่อดู)</summary>`);
    L.push('');
    L.push('**จำนวนเงินไม่เปลี่ยน** — หน้าจอแสดงค่าทางขวามือนี้มาตั้งแต่แรกแล้ว');
    L.push('');
    L.push('| ที่ | แถว | เก็บไว้ในชีต | จะเก็บเป็น |');
    L.push('|---|---:|---:|---:|');
    rep.tidied.forEach(s => L.push(`| \`${s.where}\` | ${s.row} | ${s.from} | ${s.to.toFixed(2)} |`));
    L.push('');
    L.push('</details>');
    L.push('');
  }
  if (rep.tooBig.length) {
    L.push('## 🔴 ใหญ่เกินกว่าที่ช่องจะเก็บได้ — ต้องแก้ในชีตก่อนย้าย');
    L.push('');
    L.push('`numeric(12,2)` เก็บได้สูงสุด 9,999,999,999.99 · รายการนี้จะทำให้การย้าย**ล้มเหลวทั้งก้อน**');
    L.push('');
    rep.tooBig.slice(0, 50).forEach(s => L.push('- `' + s + '`'));
    L.push('');
  }
  if (rep.notNum.length) {
    L.push('## ⚠️ ช่องเงินที่ไม่ใช่ตัวเลข');
    L.push('');
    L.push('ส่วนใหญ่เป็นข้อความที่พิมพ์ปนเข้ามา · **ช่องที่ว่างจะย้ายเป็นว่าง ไม่ใช่ 0** และไม่อยู่ในรายการนี้');
    L.push('');
    rep.notNum.slice(0, 50).forEach(s => L.push('- `' + s + '`'));
    L.push('');
  }
  return L.join('\n') + '\n';
}

/* ── loading ────────────────────────────────────────────────────────────────────────────────────
 * Per row, in a transaction per table. `seq` is left to the bigserial, so rows land in the order
 * the sheet had them — which is the order the app shows and the engine's forty-two `[0]` lookups
 * depend on (see the note in tools/pg_engine.js). */
function planLoad(data, schema) {
  const plan = [], unknownTables = [], unknownCols = {};
  for (const wb of ['MAIN', 'HR']) {
    const book = data[wb] || {};
    for (const sheet of Object.keys(book)) {
      const rows = book[sheet]; if (!rows.length) continue;
      const tbl = tableFor(wb, sheet);
      if (!schema[tbl]) { unknownTables.push(wb + '.' + sheet + ' → ' + tbl); continue; }
      const cols = {}, dropped = new Set();
      Object.keys(rows[0]).forEach(k => {
        const pg = snake(k);
        if (schema[tbl][pg]) cols[k] = pg; else dropped.add(k);
      });
      if (dropped.size) unknownCols[wb + '.' + sheet] = [...dropped];
      plan.push({ wb, sheet, table: tbl, rows, cols, count: rows.length });
    }
  }
  return { plan, unknownTables, unknownCols };
}

function encode_(v, type) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return JSON.stringify(v);
  if (/^numeric/.test(type || '')) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? round2(n) : null;
  }
  if (/^boolean/.test(type || '')) {
    const s = String(v).trim().toUpperCase();
    return ['YES', 'TRUE', '1', 'Y'].indexOf(s) >= 0 ? true
         : ['NO', 'FALSE', '0', 'N', ''].indexOf(s) >= 0 ? false : null;
  }
  return v;
}

async function load(client, tenantId, plan, schema) {
  const done = {};
  for (const t of plan) {
    const names = Object.values(t.cols);
    if (!names.length) continue;
    await client.query('begin');
    try {
      for (const row of t.rows) {
        const vals = Object.keys(t.cols).map(k => encode_(row[k], schema[t.table][t.cols[k]]));
        const ph = vals.map((_, i) => '$' + (i + 2)).join(',');
        await client.query(
          `insert into ${t.table} (tenant_id,${names.join(',')}) values ($1,${ph})`, [tenantId, ...vals]);
      }
      await client.query('commit');
      done[t.table] = (done[t.table] || 0) + t.rows.length;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw new Error(t.table + ': ' + e.message);
    }
  }
  return done;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const file = arg('file');
  if (!file || file === true) {
    console.log('\n  ใช้: node tools/pg_migrate.js --file secrets/export/atom_export_….json --dry\n');
    console.log('  ไฟล์นั้นมาจาก  src/Export.gs → exportAllForMigration()  (รันจาก Apps Script editor)\n');
    process.exit(2);
  }
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
  if (!fs.existsSync(abs)) { console.log('\n🔴 ไม่พบไฟล์: ' + file + '\n'); process.exit(2); }

  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const schema = targetSchema();
  const { plan, unknownTables, unknownCols } = planLoad(data, schema);
  const rep = moneyReport(data, schema);

  console.log('\n═══ Phase 2.2 · ย้ายข้อมูลจาก Sheets → Postgres ═══');
  console.log('  ไฟล์      : ' + path.basename(abs));
  console.log('  ส่งออกเมื่อ : ' + (data.exportedAt || '-'));
  console.log('  ตาราง     : ' + plan.length + '  ·  แถวรวม ' + plan.reduce((a, t) => a + t.count, 0));

  if (unknownTables.length) {
    console.log('\n  ⚠️  ชีตที่ไม่มีตารางรองรับ (ข้ามไป):');
    unknownTables.forEach(s => console.log('      · ' + s));
  }
  const dropped = Object.keys(unknownCols);
  if (dropped.length) {
    /* 🔴 THE SILENT LOSS THIS WHOLE PHASE EXISTS TO PREVENT. A column in the export with nowhere to
     * land is data that simply does not arrive, and `insert` would never complain. Named, loudly. */
    console.log('\n  🔴 คอลัมน์ที่ไม่มีที่ลงใน Postgres — ข้อมูลจะหายเงียบๆ ถ้าไม่แก้ก่อน:');
    dropped.forEach(s => console.log('      · ' + s + ': ' + unknownCols[s].join(', ')));
    console.log('      แก้โดยประกาศใน SCHEMA (src/Config.gs) แล้วรัน node tools/schema_inventory.js --write');
  }

  console.log('\n  💰 ยอดรวมที่ขยับ: ' + rep.moved.length + ' คอลัมน์ · ' + baht(rep.totalShift) + ' บาท'
    + '   (' + rep.tidiedRows + ' แถวแค่เก็บให้ตรง — ไม่ใช่เงินขยับ)'
    + (rep.tooBig.length ? '  🔴 เกินขนาด ' + rep.tooBig.length : ''));

  const out = arg('report');
  if (out && out !== true) {
    const p = path.isAbsolute(out) ? out : path.join(ROOT, out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderReport(rep, { file: path.basename(abs), exportedAt: data.exportedAt }), 'utf8');
    console.log('     เขียนรายงานแล้ว: ' + out);
  }

  if (DRY) {
    console.log('\n  ✅ โหมด --dry — ไม่เขียนอะไรลงฐานข้อมูลเลย');
    console.log('     🔴 ข้อมูลจริงจะย้ายได้ก็ต่อเมื่อมีข้อตกลงประมวลผลข้อมูล (PDPA) และ ผอ. อนุมัติแล้ว\n');
    return;
  }
  if (rep.tooBig.length) {
    console.log('\n  🔴 หยุด — มีตัวเลขที่ใหญ่เกิน numeric(12,2) ' + rep.tooBig.length + ' จุด · แก้ในชีตก่อน\n');
    process.exit(1);
  }

  const { connect } = require('./pg_lib.js');
  const { client } = await connect();
  const code = String(arg('tenant'));
  const t = await client.query('select id from tenant where code = $1', [code]);
  if (!t.rows.length) { console.log('\n🔴 ไม่พบ tenant code "' + code + '"\n'); await client.end(); process.exit(1); }
  const done = await load(client, t.rows[0].id, plan, schema);
  console.log('\n  ✅ เขียนแล้ว:');
  Object.keys(done).sort().forEach(k => console.log('      ' + k.padEnd(26) + done[k]));
  await client.end();
  console.log('');
}

module.exports = { targetSchema, moneyReport, renderReport, planLoad, tableFor, encode_, round2, load };
if (require.main === module) main().catch(e => { console.log('🔴 ' + e.message); process.exit(1); });
