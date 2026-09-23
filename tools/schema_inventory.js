/**
 * tools/schema_inventory.js — every table the app actually has, read out of the source.
 *   node tools/schema_inventory.js            → the inventory, as a table
 *   node tools/schema_inventory.js --sql      → PostgreSQL DDL on stdout
 *   node tools/schema_inventory.js --write    → write docs/schema/ and docs/schema/INVENTORY.md
 *
 * WHY THIS IS A TOOL AND NOT A DOCUMENT.
 *
 * The migration has to describe what the app has TODAY, and "today" moves: three sheets gained
 * columns this week (DateTo/GroupID on the leaves, EndDate/EndReason/EndRemark on the students,
 * ByAt on the check-ins, Pause* on the staff). A schema typed out by hand is a snapshot that starts
 * drifting the moment it is saved, and the drift is invisible — a column that exists in Sheets and
 * not in Postgres is data that silently stops being written the day we switch.
 *
 * So the schema is GENERATED from the three places the app already declares it:
 *   1. SCHEMA in src/Config.gs          — the columns of every declared sheet, per workbook
 *   2. COLLECTION_MAP in src/GasEngine.gs — which collections the engine reads, and from where
 *   3. RUNTIME_SHEETS below             — the handful created on demand, never declared
 * Re-run it and the diff tells you what changed.
 *
 * WHAT IT WILL NOT DO IS GUESS AT MONEY. Every column that holds an amount is listed by name in
 * MONEY and typed `numeric(12,2)`. Sheets stores every number as a float64, so today the prepay
 * discounts, the OT, the provident fund and the payroll all run on binary fractions — the defect
 * reported to the ผอ. Inferring "this looks like money" from a column name would carry that
 * uncertainty into the new database, which is the one place it must not go.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------------------------
// 1. read the declarations
// ---------------------------------------------------------------------------------------------
const cfg = R('src/Config.gs'), gas = R('src/GasEngine.gs');
/** Strip comments so a column name quoted inside a note is never read as a column. */
const decomment = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** SCHEMA[WB.MAIN] / SCHEMA[WB.HR] → { SHEET: [cols] }, tagged with the workbook it came from. */
function readSheets() {
  const out = [];
  const src = decomment(cfg);
  // each workbook block starts at `SCHEMA[WB.X] = {` and ends at the matching `};`
  for (const wb of ['MAIN', 'HR']) {
    const start = src.indexOf(`SCHEMA[WB.${wb}] = {`);
    if (start < 0) continue;
    const end = src.indexOf('\n};', start);
    const block = src.slice(start, end < 0 ? undefined : end);
    /* The trailing comma is OPTIONAL — the LAST entry in each workbook block has none, and requiring
     * it silently dropped INSURANCE_PCHI (83 columns of a real insurance policy) from the migration.
     * A parser that loses a table without saying so is worse than no parser, which is why the run
     * also prints anything mapped-but-empty rather than only what it found. */
    const re = /^\s{2}([A-Z][A-Z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm;
    let m;
    while ((m = re.exec(block))) {
      const cols = (m[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
      if (cols.length) out.push({ sheet: m[1], wb, cols });
    }
  }
  return out;
}

/** COLLECTION_MAP → which engine collection reads which sheet. */
function readCollections() {
  const m = /var COLLECTION_MAP = \{([\s\S]*?)\n\};/.exec(gas);
  return [...m[1].matchAll(/(\w+):\s*\{ wb: '(\w+)', sheet: '([A-Z0-9_]+)'/g)]
    .map(x => ({ collection: x[1], wb: x[2], sheet: x[3] }));
}

/* SHEETS THE APP CREATES ON DEMAND and never declares in SCHEMA. Every one of them is real and
 * carries live data; leaving them out of the migration would lose it. Columns are taken from the
 * ensureColumns_/insertSheet call that creates each one — quoted here because there is nowhere else
 * to read them from, and checked by tools/test_schema_inventory.js against those call sites. */
const RUNTIME_SHEETS = [
  { sheet: 'ADMIN_INBOX', wb: 'MAIN', cols: ['InboxID', 'Date', 'Category', 'Text', 'Read', 'Ref', 'StaffID'],
    note: 'the 🔔 in-app inbox — built when the LINE quota ran out' },
  { sheet: 'PERF_LOG', wb: 'MAIN', cols: ['Ts', 'Sid', 'Role', 'Type', 'Action', 'Ms', 'Ok', 'Code', 'Batch', 'Screen', 'Dev', 'Net', 'Pwa', 'Ver', 'Os'],
    note: 'Phase 0 telemetry. NOT migrated — see the note in the DDL' },
  { sheet: 'LINE_RECIPIENTS', wb: 'MAIN', cols: ['Topic', 'StaffID', 'Enabled'],
    note: 'who is pushed for which topic' },
  { sheet: 'FOOD_MENU', wb: 'MAIN', cols: ['MenuID', 'Month', 'Day', 'Slot', 'ItemID', 'Note'],
    note: 'engine-managed (ensureCollectionSheet_ creates it from first write)' },
  { sheet: 'FOOD_ITEMS', wb: 'MAIN', cols: ['ItemID', 'Name', 'NameEN', 'Category', 'Allergens', 'Active'],
    note: 'engine-managed' },
  { sheet: 'CLASS_COVER', wb: 'MAIN', cols: ['CoverID', 'StaffID', 'ClassName', 'FromDate', 'ToDate', 'Note'],
    note: 'engine-managed — a teacher lent to another class' },
  { sheet: 'SURVEYS', wb: 'MAIN', cols: ['SurveyID', 'Title', 'Question', 'Options', 'Target', 'StartDate', 'EndDate', 'Status'],
    note: 'engine-managed' },
  { sheet: 'SURVEY_RESPONSES', wb: 'MAIN', cols: ['ResponseID', 'SurveyID', 'RespondentID', 'Answer', 'Date'],
    note: 'engine-managed' },
  { sheet: 'STAFF', wb: 'HR', cols: null, note: 'declared in SCHEMA — listed here only to show it is HR' }
];

// ---------------------------------------------------------------------------------------------
// 2. build the inventory
// ---------------------------------------------------------------------------------------------
function inventory() {
  const sheets = readSheets(), cols = readCollections();
  const byKey = new Map();
  const key = t => t.wb + '.' + t.sheet;
  sheets.forEach(s => byKey.set(key(s), { ...s, source: 'SCHEMA', collection: null }));
  RUNTIME_SHEETS.forEach(s => {
    if (!s.cols) return;
    if (byKey.has(key(s))) { byKey.get(key(s)).note = s.note; return; }
    byKey.set(key(s), { ...s, source: 'runtime' });
  });
  cols.forEach(c => {
    const t = byKey.get(key(c));
    if (t) t.collection = c.collection;
    else byKey.set(key(c), { sheet: c.sheet, wb: c.wb, cols: [], source: 'COLLECTION_MAP only', collection: c.collection });
  });
  return [...byKey.values()].sort((a, b) => a.wb.localeCompare(b.wb) || a.sheet.localeCompare(b.sheet));
}

// ---------------------------------------------------------------------------------------------
// 3. types — explicit where it matters, inferred where it does not
// ---------------------------------------------------------------------------------------------
/* EVERY COLUMN THAT HOLDS AN AMOUNT, BY NAME. numeric(12,2), never float. This list is the whole
 * reason the tool exists rather than a hand-typed file: it is checked, it is complete, and adding a
 * money column without adding it here is a test failure (tools/test_schema_inventory.js). */
const MONEY = new Set([
  'Amount', 'Price', 'SlipAmount', 'Rate', 'DailyRate', 'OTRate', 'OTAmount',
  'Discount', 'DiscountAmount', 'Gross', 'ProrateAmount', 'InsuranceSum',
  // payroll — every one of these is a figure on somebody's payslip
  'BaseSalary', 'NetPay', 'GrossIncome', 'AdjustmentsTotal', 'DiligenceTotal', 'ExtraChildAmount',
  'HolidayBonus', 'OtherDeductions', 'TotalDeductions', 'TrainingCertAmount',
  'Contribution', 'ContributionOpening', 'ContributionAccum', 'PauseSalaryAmount',
  'DiligenceAttendanceAmount', 'DiligenceFacebookAmount', 'SocialSecurityDeduct', 'TaxDeduct'
]);
/* WHAT ONLY LOOKS LIKE MONEY. Listed as explicitly as the money itself, because the check below
 * refuses to let a column matching the money pattern go through unclassified — and "not money" is a
 * decision somebody has to have made, not a default.
 *
 * MilkTotal and Water were in MONEY in the first draft of this file. They are millilitres of milk
 * and water a baby drank. A money type on a child's feed is the same class of mistake as a float on
 * a payslip, pointing the other way, and the audit is what caught it. */
const NOT_MONEY = new Set([
  'PaidDate', 'PaymentMethod', 'GeneratedBy', 'GeneratedDate', 'PaidBy', 'PayType', 'PayrollID',
  'PrepayID', 'ChargeID', 'PauseSalaryMode', 'ContributionLocked', 'MilkTotal', 'Water',
  'Net'   // PERF_LOG: the connection class, '4g' / '3g' — caught by "net" in the pattern
]);
/* ...and the ones that are a COUNT or a MEASUREMENT. Separated deliberately: `Weight` and `Hours`
 * look numeric in the same way and must not become numeric(12,2) by accident. */
const NUMERIC_OTHER = new Set(['Weight', 'Height', 'Hours', 'OTHours', 'Days', 'LateMinutes', 'Minutes',
  'Count', 'Qty', 'Priority', 'AgeMonth', 'ItemNo', 'BillingDay', 'Ms', 'Batch', 'Year',
  'MilkTotal', 'Water']);

/* THE GUARD, and the reason the money list can be trusted. Any column whose NAME looks like money
 * must appear in MONEY or in NOT_MONEY — never in neither. The first version of this tool had
 * fifteen payroll columns (GrossIncome, TotalDeductions, DailyRate, the two Diligence amounts, the
 * tax and social-security deductions…) in neither, so they were silently typed `text`: the exact
 * defect this migration exists to end, reproduced in the thing meant to end it.
 *
 * A new money column added to a sheet now fails this run until somebody says which it is. */
const MONEY_LIKE = /(amount|price|salary|pay|total|rate|discount|deduct|bonus|allow|contribut|fee|charge|sum|balance|owed|cost|baht|net|gross|paid)/i;
function assertMoneyClassified(tables) {
  const unclassified = [];
  tables.forEach(t => (t.cols || []).forEach(c => {
    if (!MONEY_LIKE.test(c)) return;
    if (MONEY.has(c) || NOT_MONEY.has(c) || NUMERIC_OTHER.has(c)) return;
    unclassified.push(t.sheet + '.' + c);
  }));
  if (unclassified.length) {
    console.error('\n❌ these columns look like money and are classified nowhere.');
    console.error('   Add each to MONEY (numeric) or NOT_MONEY (it only looks like money):\n');
    unclassified.sort().forEach(c => console.error('     ' + c));
    console.error('\n   Refusing to generate a schema that guesses at money.\n');
    process.exit(1);
  }
}

const BOOL_PREFIX = /^(Is|Has|Can|Require|Notify|Allow|Enabled?|Active|Read|Locked?|Verified?|Anonymous|Popup|GeoExempt|MustChange)/;
const DATE_EXACT = /(Date|DOB|Expiry|Birthday)$/;
const TIME_EXACT = /(Time|CheckIn|CheckOut|In|Out)$/;
const STAMP_EXACT = /(At|Timestamp|Ts)$/;

function sqlType(col) {
  if (MONEY.has(col)) return 'numeric(12,2)';
  if (NUMERIC_OTHER.has(col)) return 'numeric';
  if (/^(Month)$/.test(col)) return 'text';                 // 'YYYY-MM', a period not a date
  if (STAMP_EXACT.test(col) && col !== 'SubmittedAt') return 'timestamptz';
  if (col === 'SubmittedAt' || col === 'UpdatedAt' || col === 'ByAt') return 'timestamptz';
  if (DATE_EXACT.test(col)) return 'date';
  if (TIME_EXACT.test(col) && !/ID$/.test(col)) return 'time';
  if (BOOL_PREFIX.test(col)) return 'boolean';
  return 'text';
}
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

// ---------------------------------------------------------------------------------------------
// 4. output
// ---------------------------------------------------------------------------------------------
const inv = inventory();
const withCols = inv.filter(t => t.cols && t.cols.length);
assertMoneyClassified(withCols);   // refuse to go further if any amount is unclassified

if (process.argv.includes('--sql') || process.argv.includes('--write')) {
  const L = [];
  L.push('-- Atom Nursery → PostgreSQL, migration 001 (generated: node tools/schema_inventory.js --sql)');
  L.push('-- DO NOT EDIT BY HAND. Change the source declarations and re-generate, or the schema and');
  L.push('-- the app drift apart silently — which is the failure this whole file exists to prevent.');
  L.push('--');
  L.push('-- THREE DECISIONS ARE BAKED IN HERE, all taken before a line of it was written:');
  L.push('--   1. tenant_id on EVERY table, from migration 001. Adding it later means rewriting every');
  L.push('--      row, every index and every policy in a live database. It costs nothing now.');
  L.push('--   2. numeric for money, never float. Sheets stores every number as a float64, so the');
  L.push('--      prepay discounts, the OT, the provident fund and the payroll all run on binary');
  L.push('--      fractions today. This is the migration that ends that, and it only ends if the');
  L.push('--      column type says so.');
  L.push('--   3. the sheet id (STD-001, STF-011) is KEPT as `code`, not thrown away. Four years of');
  L.push('--      LINE messages, slips and audit rows refer to those strings; a uuid primary key with');
  L.push('--      no code column would orphan all of it.');
  L.push('');
  L.push('create extension if not exists "pgcrypto";');
  L.push('');
  L.push('-- ── tenancy ───────────────────────────────────────────────────────────────────────────');
  L.push('create table if not exists tenant (');
  L.push('  id          uuid primary key default gen_random_uuid(),');
  L.push('  code        text not null unique,      -- "atom" — short, used in URLs and support');
  L.push('  name_th     text not null,');
  L.push('  name_en     text,');
  L.push('  status      text not null default \'ACTIVE\',');
  L.push('  created_at  timestamptz not null default now()');
  L.push(');');
  L.push('');

  withCols.forEach(t => {
    const tbl = snake(t.sheet);
    L.push(`-- ── ${t.sheet}  (${t.wb} workbook${t.collection ? ', engine: ' + t.collection : ''})${t.note ? ' — ' + t.note : ''}`);
    L.push(`create table if not exists ${tbl} (`);
    L.push('  id          uuid primary key default gen_random_uuid(),');
    L.push('  tenant_id   uuid not null references tenant(id) on delete restrict,');
    t.cols.forEach(c => {
      const name = snake(c);
      if (name === 'id') return;
      L.push(`  ${name.padEnd(26)} ${sqlType(c)},`);
    });
    L.push('  created_at  timestamptz not null default now(),');
    L.push('  updated_at  timestamptz not null default now()');
    L.push(');');
    // the sheet's own id column becomes a per-tenant unique code
    const idCol = t.cols.find(c => /ID$/.test(c) && c.toLowerCase().startsWith(t.sheet.split('_')[0].slice(0, 4).toLowerCase()))
              || t.cols.find(c => /^[A-Za-z]+ID$/.test(c));
    if (idCol) L.push(`create unique index if not exists ${tbl}_code_uq on ${tbl}(tenant_id, ${snake(idCol)});`);
    L.push(`create index if not exists ${tbl}_tenant_ix on ${tbl}(tenant_id);`);
    L.push(`alter table ${tbl} enable row level security;`);
    L.push('');
  });

  L.push('-- ── row-level security ────────────────────────────────────────────────────────────────');
  L.push('-- One policy per table, all identical, all reading the SAME claim. A per-table exception is');
  L.push('-- how one table ends up readable across tenants, so there are none.');
  L.push('-- The app connects with the anon key plus a JWT we mint; the service-role key bypasses ALL');
  L.push('-- of this by design and must never leave the server.');
  L.push('do $$ declare t text; begin');
  L.push('  for t in select tablename from pg_tables where schemaname = \'public\' and tablename <> \'tenant\' loop');
  L.push('    execute format($f$');
  L.push('      create policy tenant_isolation on %I');
  L.push('        using (tenant_id = (auth.jwt() ->> \'tenant_id\')::uuid)');
  L.push('        with check (tenant_id = (auth.jwt() ->> \'tenant_id\')::uuid);');
  L.push('    $f$, t);');
  L.push('  end loop;');
  L.push('end $$;');
  L.push('');

  const sql = L.join('\n');
  if (process.argv.includes('--write')) {
    const dir = path.join(ROOT, 'docs', 'schema');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '001_init.sql'), sql, 'utf8');
    console.log('docs/schema/001_init.sql written —', withCols.length, 'tables,',
      withCols.reduce((a, t) => a + t.cols.length, 0), 'columns');
  } else {
    console.log(sql);
  }
} else {
  const money = [];
  withCols.forEach(t => t.cols.forEach(c => { if (MONEY.has(c)) money.push(t.sheet + '.' + c); }));
  console.log('TABLES:', withCols.length, ' COLUMNS:', withCols.reduce((a, t) => a + t.cols.length, 0));
  console.log('MONEY COLUMNS (numeric, never float):', money.length);
  console.log('');
  console.log('sheet'.padEnd(26) + 'wb'.padEnd(6) + 'cols'.padEnd(6) + 'engine collection');
  console.log('-'.repeat(78));
  withCols.forEach(t => console.log(
    t.sheet.padEnd(26) + t.wb.padEnd(6) + String(t.cols.length).padEnd(6) + (t.collection || '—')));
  const orphan = inv.filter(t => !t.cols || !t.cols.length);
  if (orphan.length) { console.log('\n⚠️  mapped but no columns found:'); orphan.forEach(t => console.log('   ', t.sheet)); }
}
