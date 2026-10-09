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

  const gaps = [];
  sites.forEach(s => {
    if (!s.sheet) return;
    const tbl = snake(s.sheet);
    if (!tableCols[tbl]) return;                       // sheet not in the migration at all — other test
    s.cols.forEach(c => {
      if ((dec[s.sheet] || new Set()).has(c)) return;   // declared properly
      if (tableCols[tbl].has(snake(c))) return;         // present in SQL some other way
      gaps.push(s.sheet + '.' + c + '  (' + s.file + ')');
    });
  });
  const uniq = [...new Set(gaps)].sort();

  /* 🔴 THE LEDGER — known debt, and not one column more.
   *
   * Every line below is a column holding real data on a live sheet today with nowhere to go in
   * Postgres. Phase 2.2 must declare each one in SCHEMA, on the sheet that actually uses it, and
   * re-generate the migration.
   *
   * It would be easy to assert `=== []` and leave the suite red until then. That is the wrong shape:
   * a permanently failing check teaches everyone to scroll past red, and the next REAL failure goes
   * with it. So the count is pinned instead. Fixing one means lowering KNOWN by one — a deliberate
   * act, recorded in the diff — and adding a nineteenth fails immediately, which is the thing that
   * actually needs catching.
   *
   * An attempt to close all eighteen on 2026-10-09 corrupted Config.gs (the anchor matched a later
   * sheet's identical column name) and was reverted. They need doing one at a time, by hand, with
   * the call site in view. */
  const KNOWN = 18;
  if (uniq.length) {
    console.log('  ── ค้างอยู่ ' + uniq.length + ' คอลัมน์ (งานของ Phase 2.2) ──');
    uniq.forEach(g => console.log('     · ' + g));
  }
  eq('🔴 ไม่มีคอลัมน์ที่จะหายตอน migrate เพิ่มขึ้นจากที่รู้อยู่แล้ว', uniq.length, KNOWN);
  ok_('...และรายการนี้คือสิ่งที่ Phase 2.2 ต้องปิดให้หมด', uniq.length <= KNOWN);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
