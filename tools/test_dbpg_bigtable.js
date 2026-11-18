/**
 * tools/test_dbpg_bigtable.js — Apps Script on Postgres must not read a big table one cell at a time
 *   node tools/test_dbpg_bigtable.js
 *
 * 18 Nov 2026, UAT on the real data (R8): every request except ping timed out at 6 minutes.
 * src/DbPg.gs read a table with one JDBC call per CELL, and appendObject_ asked getLastRow() after
 * every append, which loaded the whole table. AUDIT_LOG is 20,829 rows. A fabricated tenant never
 * had more than a few hundred, so 96 parity suites stayed green the whole time.
 *
 * This suite counts STATEMENTS, not answers (the parity run already proves the answers):
 *   - a table is loaded with ONE statement, whatever its size
 *   - appending (appendRow, or writing just past the end) never loads the table
 *   - the size of a table nobody has read is a count(*)
 *   - perfTrim_ at the cap deletes the oldest rows in ONE statement
 */
'use strict';
process.env.ATOM_DB = 'pg';
let pass = 0, fail = 0;
const ok_ = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; };

const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Setup', 'GasEngine', 'Engine', 'Perf']);
H.run(function () { _configCache = null; setupAll(); _configCache = null; });
const N = 3000;
const sel = () => H.pgLog.filter(x => /^select coalesce\(json_agg/.test(x.sql) && /from "audit_log"/.test(x.sql)).length;
const cnt = () => H.pgLog.filter(x => /^select count\(\*\)/.test(x.sql)).length;

console.log('\n1) a big table — the shape of the real AUDIT_LOG');
H.g.__N = N;
H.run(function () {
  var sh = getMainSpreadsheet_().getSheetByName('AUDIT_LOG');
  for (var i = 0; i < __N; i++) sh.appendRow(['2026-11-18 08:00:00', 'U' + i, 'login', 'USERS', 'R' + i]);
});
H.pgLog.length = 0;

console.log('\n2) logging one line does not read the table');
{
  H.props.PG_NO_CACHE = '';                          // a real execution: one request, tables read once
  const n = H.run(function () { PG_.on = null; PG_.wb = {}; _WB_CACHE_.main = _WB_CACHE_.hr = null; /* a new execution: nothing read yet */ logAudit('U-x', 'test', 'X', 'R-x'); return getMainSpreadsheet_().getSheetByName('AUDIT_LOG').getLastRow(); });
  ok_('logAudit loaded AUDIT_LOG 0 times (was: the whole table, every request)', sel() === 0);
  ok_('…getLastRow came from count(*) (' + cnt() + ' statement)', cnt() >= 1);
  ok_('…and is right: ' + N + ' + 1 appended + header = ' + (N + 2), n === N + 2);
}

console.log('\n3) reading it is ONE statement, whatever its size');
{
  H.pgLog.length = 0;
  const got = H.run(function () { return readObjects_(getMainSpreadsheet_().getSheetByName('AUDIT_LOG')); });
  ok_('one statement for ' + got.length + ' rows', sel() === 1 && got.length === N + 1);
  ok_('…values intact (first, last)', got[0].UserID === 'U0' && got[got.length - 1].UserID === 'U-x');
}

console.log('\n4) writing just past the end (PERF_LOG) does not read the table either');
{
  H.pgLog.length = 0;
  H.run(function () {
    PG_.on = null; PG_.wb = {}; _WB_CACHE_.main = _WB_CACHE_.hr = null; /* a new execution: nothing read yet */
    var sh = getMainSpreadsheet_().getSheetByName('AUDIT_LOG');
    sh.getRange(sh.getLastRow() + 1, 1, 2, 5).setValues([['2026-11-18 09:00:00', 'P1', 'a', 'T', 'R'], ['2026-11-18 09:00:01', 'P2', 'a', 'T', 'R']]);
  });
  ok_('two rows written past the end, AUDIT_LOG loaded 0 times', sel() === 0);
  const last = H.run(function () { var r = readObjects_(getMainSpreadsheet_().getSheetByName('AUDIT_LOG')); return r[r.length - 1].UserID; });
  ok_('…and they are there, in order', last === 'P2');
}

console.log('\n5) trimming the oldest rows is ONE delete, not a load and n deletes');
{
  H.pgLog.length = 0;
  H.run(function () { PG_.on = null; PG_.wb = {}; _WB_CACHE_.main = _WB_CACHE_.hr = null; /* a new execution: nothing read yet */ getMainSpreadsheet_().getSheetByName('AUDIT_LOG').deleteRows(2, 100); });
  const dels = H.pgLog.filter(x => /^delete from "audit_log"/.test(x.sql));
  ok_('one delete statement, 0 loads', dels.length === 1 && sel() === 0);
  const r = H.run(function () { return readObjects_(getMainSpreadsheet_().getSheetByName('AUDIT_LOG')); });
  ok_('…the OLDEST 100 went (first is now U100, ' + (N + 3 - 100) + ' left)', r[0].UserID === 'U100' && r.length === N + 3 - 100);
}

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
