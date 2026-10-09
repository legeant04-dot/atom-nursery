/**
 * tools/test_schema_runtime_cols.js — columns the code creates at run time, and the migration loses.
 *   node tools/test_schema_runtime_cols.js
 *
 * 🔴 FOUND 2026-10-09, while proving PgEngine against the real engine (Phase 2.1). A leave read back
 * from Postgres had `Type: undefined`, and the reason is not a bug in PgEngine:
 *
 *     LEAVE_REQUEST_STD has no `Type` column in SCHEMA. Nothing declares it. It exists on the live
 *     sheet because src/Parent.gs calls ensureColumns_(sheet, ['Type','FiledBy','DateTo','GroupID'])
 *     and the spreadsheet grows a column on demand — so the sheet has four years of leave types in a
 *     column the migration has nowhere to put.
 *
 * `ensureColumns_` is a perfectly good idea for a spreadsheet and a trap for a migration: it means
 * the real schema is the union of SCHEMA and forty-five scattered call sites, and only the first
 * half was ever turned into SQL. A column nobody declared is a column nobody migrates, and the loss
 * is SILENT — `select` returns undefined, the engine reads '' and carries on.
 *
 * This suite is the ledger. It fails while any such column has nowhere to land, and the list it
 * prints is the work item for Phase 2.2.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const decom = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

let pass = 0, fail = 0;
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got, null, 1)));
  o ? pass++ : fail++;
}
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }

/** Which sheet an ensureColumns_ call is about — from the variable it is handed, traced back. */
function callSites() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(x => x.endsWith('.gs'))) {
    const src = decom(R('src/' + f));
    for (const m of src.matchAll(/ensureColumns_\(\s*([A-Za-z_][\w.]*)\s*,\s*\[([^\]]*)\]/g)) {
      const cols = (m[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
      if (!cols.length) continue;
      /* the sheet this variable was assigned from, nearest assignment BEFORE the call — the same
       * way a reader would work it out, and good enough because these are all local `var sh = ...` */
      const before = src.slice(0, m.index);
      const re = new RegExp('\\b' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                            "\\s*=\\s*sheet_\\([^,]+,\\s*'([A-Z0-9_]+)'\\)", 'g');
      const hits = [...before.matchAll(re)];
      out.push({ file: f, sheet: hits.length ? hits[hits.length - 1][1] : null, cols });
    }
  }
  return out;
}

function declared() {
  const cfg = decom(R('src/Config.gs'));
  const bySheet = {};
  for (const wb of ['MAIN', 'HR']) {
    const i = cfg.indexOf(`SCHEMA[WB.${wb}] = {`); if (i < 0) continue;
    const block = cfg.slice(i, cfg.indexOf('\n};', i));
    for (const m of block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm))
      bySheet[m[1]] = new Set((m[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)));
  }
  return bySheet;
}

console.log('\n1) คอลัมน์ที่โค้ดสร้างตอนรัน แต่ตารางปลายทางไม่มีที่ให้ลง');
{
  const sites = callSites(), dec = declared();
  const sql = R('docs/schema/001_init.sql');
  const tableCols = {};
  for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g))
    tableCols[m[1]] = new Set([...m[2].matchAll(/^ {2}([a-z_]+)\s/gm)].map(x => x[1]));

  ok_('พบจุดที่เรียก ensureColumns_ จริง', sites.length >= 40);
  ok_('...และรู้ว่าแต่ละจุดเป็นของตารางไหนเกือบทั้งหมด',
    sites.filter(s => s.sheet).length >= sites.length - 8);

  /* the detector itself, as a function of what is DECLARED — so the control below can feed it a
   * doctored schema and watch the real code find the hole */
  const gapsGiven = (declaredBySheet, sqlCols) => {
    const gaps = [];
    sites.forEach(s => {
      if (!s.sheet) return;
      const tbl = snake(s.sheet);
      if (!sqlCols[tbl]) return;                           // sheet not in the migration at all — other test
      s.cols.forEach(c => {
        if ((declaredBySheet[s.sheet] || new Set()).has(c)) return;   // declared properly
        if (sqlCols[tbl].has(snake(c))) return;                       // present in SQL some other way
        gaps.push(s.sheet + '.' + c + '  (' + s.file + ')');
      });
    });
    return [...new Set(gaps)].sort();
  };
  const uniq = gapsGiven(dec, tableCols);

  /* 🔴 THE DEBT IS PAID — 18 → 0 on 2026-10-09, the first task of Phase 2.2.
   *
   * This started as a pinned count (KNOWN = 18) rather than `=== []`, deliberately: a permanently
   * failing check teaches everyone to scroll past red and the next REAL failure goes with it. The
   * eighteen are now declared in SCHEMA — DAILY_JOURNAL.TeacherReply, LEAVE_REQUEST_STD.Type/FiledBy,
   * three PAYROLL contribution/OT-carry columns, STAFF.NoPayroll, and eleven on STUDENTS of which
   * nine decide what a family pays — so the pin comes down to zero and the check changes shape with
   * it. From here it is no longer a ledger of known debt; it is the guard that stops a nineteenth.
   *
   * 🔴 WHAT IT IS GUARDING, in one sentence: ensureColumns_ is a fine idea on a spreadsheet and a
   * trap in a database. A column created at run time and declared nowhere still works on Sheets, and
   * on Postgres it is simply ABSENT — `select` answers undefined, the engine reads '' and bills the
   * full price. Nothing throws. So any new ensureColumns_ column must be declared in the same commit.
   *
   * (The first attempt closed all eighteen in one pass and corrupted Config.gs, because an anchor
   * matched an identical column name on a later sheet. Reverted; redone one sheet at a time with the
   * call site in view, which is how it should have been done.) */
  if (uniq.length) {
    console.log('  ── 🔴 ' + uniq.length + ' คอลัมน์ที่โค้ดสร้างเองแต่ไม่มีใครประกาศ — ประกาศใน SCHEMA ให้ครบก่อน ──');
    uniq.forEach(g => console.log('     · ' + g));
    console.log('     (แล้วรัน node tools/schema_inventory.js เพื่อสร้าง migration ใหม่)');
  }
  eq('🔴 ไม่มีคอลัมน์ไหนที่จะหายเงียบๆ ตอน migrate', uniq, []);

  /* CONTROL — the check above must be capable of failing. If callSites() or declared() ever stops
   * finding anything (a regex that no longer matches the file it reads), `uniq` goes empty and the
   * assertion passes on NOTHING, which is the one way this suite could lie. So: pretend one real
   * declared column was never declared, and prove the same code reports it. */
  {
    ok_('CONTROL: ยังอ่านจุดเรียก ensureColumns_ ของ STUDENTS ได้จริง',
      sites.some(s => s.sheet === 'STUDENTS' && s.cols.indexOf('DiscountUnit') >= 0));

    // un-declare one real money column, in BOTH places it could be found, and re-run the detector
    const doctored = {}; Object.keys(dec).forEach(k => { doctored[k] = new Set([...dec[k]]); });
    doctored.STUDENTS.delete('DiscountUnit');
    const noSql = {}; Object.keys(tableCols).forEach(t => { noSql[t] = new Set([...tableCols[t]]); });
    noSql.students.delete('discount_unit');

    const found = gapsGiven(doctored, noSql);
    ok_('CONTROL: ถอดการประกาศ DiscountUnit ออก แล้วตัวตรวจต้องจับได้',
      found.some(g => g.indexOf('STUDENTS.DiscountUnit') === 0));
    ok_('...และจับได้แค่ตัวนั้นตัวเดียว (ไม่ใช่พังทั้งก้อน)', found.length === 1);
  }
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
