/**
 * tools/test_schema_inventory.js — the migration must describe the app that exists.
 *   node tools/test_schema_inventory.js
 *
 * The PostgreSQL schema is GENERATED from the app's own declarations (tools/schema_inventory.js), so
 * it cannot drift by being forgotten. This suite guards the two ways it could still go wrong:
 *
 *   1. THE EXTRACTOR LOSING A TABLE. The first version required a trailing comma and silently
 *      dropped INSURANCE_PCHI — 83 columns of a real insurance policy — from the migration. A
 *      parser that loses a table without saying so is worse than no parser.
 *
 *   2. A MONEY COLUMN TYPED AS TEXT. The whole point of the migration is that Sheets stores every
 *      number as a float64, so the prepay discounts, the OT, the provident fund and the payroll all
 *      run on binary fractions today. The first version of the generator had FIFTEEN payroll
 *      columns — GrossIncome, TotalDeductions, DailyRate, both Diligence amounts, the tax and
 *      social-security deductions — in neither list, so they came out `text`. The exact defect the
 *      migration exists to end, reproduced in the thing meant to end it.
 *
 * So the tool now refuses to generate anything while a money-looking column is unclassified, and
 * this asserts that refusal works — by feeding it one.
 */
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const run = args => cp.execSync('node ' + path.join(__dirname, 'schema_inventory.js') + ' ' + (args || ''),
  { cwd: ROOT, encoding: 'utf8' });

// ============================================================================================
console.log('1) every table the app has reaches the migration');
// ============================================================================================
{
  const out = run('');
  const n = Number((/TABLES:\s*(\d+)/.exec(out) || [])[1]);
  const cols = Number((/COLUMNS:\s*(\d+)/.exec(out) || [])[1]);
  ok_('the inventory runs and counts tables', n > 0);
  /* A FLOOR, NOT AN EXACT NUMBER. Tables get added — three sheets gained columns the week this was
   * written. What must never happen is the count going DOWN without somebody noticing, which is
   * what silently losing a table looks like. */
  ok_('at least 52 tables, which is what live has today  (got ' + n + ')', n >= 52);
  ok_('...and at least 650 columns  (got ' + cols + ')', cols >= 650);

  /* THE ONE THAT WAS LOST. Named explicitly rather than trusted to the count, because it was lost
   * while the count still looked plausible. */
  ok_('INSURANCE_PCHI is in it — the table the first extractor dropped', /INSURANCE_PCHI/.test(out));
  ok_('...and the sheets created at runtime, which are declared nowhere',
    /ADMIN_INBOX/.test(out) && /LINE_RECIPIENTS/.test(out) && /FOOD_MENU/.test(out) && /SURVEYS/.test(out));
  ok_('...and both workbooks', /\bHR\b/.test(out) && /\bMAIN\b/.test(out));
  ok_('nothing is mapped-but-empty', !/mapped but no columns found/.test(out));
}

// ============================================================================================
console.log('\n2) money is numeric, and the tool will not guess');
// ============================================================================================
{
  const sql = run('--sql');
  const money = [...sql.matchAll(/^\s+(\w+)\s+numeric\(12,2\),/gm)].map(m => m[1]);
  ok_('money columns are numeric(12,2), never float or text  (' + money.length + ')', money.length >= 39);
  /* COLUMN DEFINITIONS ONLY — the header comment explains WHY there is no float, and a grep over the
   * whole file reads its own explanation as the thing it forbids. Same trap as the comment-stripping
   * in tools/test_retry_budget.js: a test a document can fail is not testing the code. */
  const ddl = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  ok_('...and there is no float/real/double in any column definition',
    !/\b(float|real|double precision)\b/i.test(ddl));

  /* THE PAYROLL COLUMNS THAT WERE TYPED text BY THE FIRST VERSION. Each is a figure on somebody's
   * payslip; each was found by auditing every column whose NAME looks like money against the list,
   * rather than by reading the list and believing it. */
  ['gross_income', 'total_deductions', 'daily_rate', 'diligence_attendance_amount',
   'diligence_facebook_amount', 'social_security_deduct', 'tax_deduct', 'net_pay',
   'base_salary', 'holiday_bonus', 'training_cert_amount', 'adjustments_total'].forEach(c =>
    ok_(c + ' is numeric', money.indexOf(c) >= 0));

  /* ...AND WHAT IS NOT MONEY, which matters just as much. MilkTotal and Water were in the money list
   * in the first draft: they are millilitres of milk and water a baby drank. A money type on a
   * child's feed is the same class of mistake as a float on a payslip, pointing the other way. */
  ['milk_total', 'water'].forEach(c => ok_(c + ' is NOT money — it is a baby’s feed', money.indexOf(c) < 0));
  ok_('...and they are still numeric, because they are still numbers',
    /milk_total\s+numeric,/.test(sql) && /water\s+numeric,/.test(sql));
}

// ============================================================================================
console.log('\n3) the guard actually refuses — proved by breaking it');
// ============================================================================================
{
  /* A GUARD NOBODY HAS SEEN FIRE IS A GUARD THAT MIGHT NOT WORK. Add a money-shaped column to a
   * copy of the config, run the tool against it, and it must refuse rather than quietly type it
   * `text`. The repo is restored either way. */
  const CFG = 'src/Config.gs';
  const original = R(CFG);
  const backup = path.join(require('os').tmpdir(), 'atom_cfg_backup.gs');
  fs.writeFileSync(backup, original, 'utf8');
  let refused = false, msg = '';
  try {
    const hacked = original.replace(
      /(\s{2}STUDENT_CHARGES:\s*\[)/,
      '$1\'MysteryTotalAmount\', ');
    ok_('the fixture column was injected', hacked !== original);
    fs.writeFileSync(path.join(ROOT, CFG), hacked, 'utf8');
    try { run(''); } catch (e) { refused = true; msg = String(e.stdout || '') + String(e.stderr || ''); }
  } finally {
    fs.writeFileSync(path.join(ROOT, CFG), fs.readFileSync(backup, 'utf8'), 'utf8');
    fs.unlinkSync(backup);
  }
  ok_('an unclassified money column stops the generator', refused);
  ok_('...and it says which column, so it can be fixed', /MysteryTotalAmount/.test(msg));
  ok_('...and says what to do about it', /Add each to MONEY|classified nowhere/.test(msg));
  // and the repo is exactly as it was
  eq('src/Config.gs is restored', R(CFG) === original, true);
  ok_('...and the tool runs clean again', /TABLES:/.test(run('')));
}

// ============================================================================================
console.log('\n4) the decisions that cost the most to reverse are in the DDL itself');
// ============================================================================================
{
  const sql = R('docs/schema/001_init.sql');
  /* tenant_id FROM MIGRATION 001. Adding it later means rewriting every row, every index and every
   * policy in a live database holding children's records. It costs nothing now. */
  const tables = (sql.match(/^create table if not exists (\w+) \(/gm) || []).length;
  const tenanted = (sql.match(/tenant_id\s+uuid not null references tenant\(id\)/g) || []).length;
  eq('every table except `tenant` itself carries tenant_id', tenanted, tables - 1);
  ok_('...and every one has RLS turned on',
    (sql.match(/enable row level security/g) || []).length === tables - 1);
  /* ONE POLICY, ALL IDENTICAL. A per-table exception is how one table ends up readable across
   * tenants — so the DDL writes them in a loop rather than by hand. */
  ok_('the isolation policy is generated for every table, not written per table',
    /for t in select tablename from pg_tables/.test(sql) && /create policy tenant_isolation/.test(sql));
  ok_('...and reads the tenant from the JWT, not from the request',
    /auth\.jwt\(\) ->> 'tenant_id'/.test(sql));
  /* THE SHEET IDS ARE KEPT. Four years of LINE messages, slips and audit rows refer to STD-001 and
   * STF-011; a uuid primary key with no code column would orphan all of it. */
  ok_('the sheet ids survive as per-tenant unique codes',
    /create unique index if not exists students_code_uq on students\(tenant_id, student_id\)/.test(sql));
  ok_('the file says it is generated, so nobody edits it by hand',
    /DO NOT EDIT BY HAND/.test(sql));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
