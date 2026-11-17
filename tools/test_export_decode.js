/**
 * tools/test_export_decode.js — the migration export holds the values the APP sees, not raw instants
 *   node tools/test_export_decode.js
 *
 * 2026-11-17, first rehearsal with real data. src/Export.gs wrote readObjects_'s raw Date for every
 * date cell, believing readObjects_ decoded it. JSON made each one a UTC instant — a date became the
 * day before in Bangkok, and a time-only cell (Sheets stores 08:05 as 1899-12-30 08:05) became
 * '1899-12-30T01:…Z', which pg_migrate stored as NULL: every check-in time, every OT pickup time,
 * every slip time. 15,823 cells in the real export. This holds the fix and the guard.
 */
'use strict';
/* SHEETS ONLY: the export reads the live SPREADSHEETS (that is the whole point of it), and section 1
 * builds a scratch sheet Postgres has no table for. Under run_dbpg_parity (ATOM_DB=pg) there is
 * nothing for this suite to prove, so it says so and passes rather than reporting a false break. */
if (process.env.ATOM_DB === 'pg') { console.log('ข้าม: ชุดนี้ทดสอบการส่งออกจากชีต — ไม่มีอะไรให้พิสูจน์ผ่าน Postgres\nPASSED 0 passed, 0 failed'); process.exit(0); }
const path = require('path');
let pass = 0, fail = 0;
const ok_ = (l, c) => { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; };

const H = require('./gas_test_harness.js')(['Config', 'Db', 'Audit', 'Setup', 'GasEngine', 'Engine', 'Export']);
/* Sheets hands back Date objects in the SCRIPT's timezone (Asia/Bangkok): build them as Sheets would.
 * A time-only cell is a Date on the 1899-12-30 epoch — in Bangkok's 1899 offset (LMT +06:42:04), which
 * is exactly why naive "+7" arithmetic gets it wrong by 17 minutes 56 seconds. */
const bkk = (y, m, d, hh, mm, ss) => {
  // the instant whose Asia/Bangkok wall clock reads y-m-d hh:mm:ss (handles the 1899 LMT offset)
  let t = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    t += Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0) - wall;
  }
  return new Date(t);
};
H.g.__ROWS = [
  ['Date', 'StudentID', 'Time', 'Type', 'Note'],
  [bkk(2026, 5, 1), 'STD-1', bkk(1899, 12, 30, 8, 5), 'IN', '{"a":1}'],
  [bkk(2026, 5, 1, 17, 42, 9), 'STD-2', bkk(1899, 12, 30, 17, 30), 'OUT', 'ปกติ']
];
const out = JSON.parse(JSON.stringify(H.run(function () {
  _configCache = null; setupAll(); _configCache = null;
  var ss = getMainSpreadsheet_(), sh = ss.getSheetByName('TEST_DECODE') || ss.insertSheet('TEST_DECODE');
  sh.getRange(1, 1, __ROWS.length, __ROWS[0].length).setValues(__ROWS);
  return exportWorkbook_(ss, 'MAIN').TEST_DECODE;
})));

console.log('\n1) src/Export.gs — every cell as the app reads it (decodeCell_)');
ok_('a date cell → "YYYY-MM-DD" in Bangkok (not the UTC instant of the day before)', out[0].Date === '2026-05-01');
ok_('a time-only cell → "HH:mm" (not 1899-12-30T…Z)', out[0].Time === '08:05' && out[1].Time === '17:30');
ok_('a date-time cell → "YYYY-MM-DD HH:mm:ss" in Bangkok', out[1].Date === '2026-05-01 17:42:09');
ok_('a JSON cell is parsed, text is left alone', out[0].Note && out[0].Note.a === 1 && out[1].Note === 'ปกติ');
ok_('🔴 no value anywhere is a UTC instant', !JSON.stringify(out).match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/));

console.log('\n2) tools/pg_migrate.js — an undecoded export is refused, not half-loaded');
const M = require('./pg_migrate.js');
const schema = M.targetSchema();
const bad = { MAIN: { CHECKIN_STUDENT: [{ Date: '2026-04-30T17:00:00.000Z', StudentID: 'S1', Time: '1899-12-30T01:17:56.000Z', Type: 'IN' }] }, HR: {} };
const good = { MAIN: { CHECKIN_STUDENT: [{ Date: '2026-05-01', StudentID: 'S1', Time: '08:00', Type: 'IN' }] }, HR: {} };
const hit = M.undecodedInstants(M.planLoad(bad, schema).plan, schema);
ok_('a raw instant in a `date` column and a `time` column is found, by column', hit.length === 2 && hit.every(x => x.n === 1) && hit.some(x => /CHECKIN_STUDENT\.Time$/.test(x.where)));
ok_('a decoded export passes', M.undecodedInstants(M.planLoad(good, schema).plan, schema).length === 0);
const src = require('fs').readFileSync(path.join(__dirname, 'pg_migrate.js'), 'utf8');
ok_('…and main() stops on it before writing anything (dry or not)', /const raw = undecodedInstants\(plan, schema\);\s*\n\s*if \(raw\.length\) \{[\s\S]{0,600}process\.exit\(1\)/.test(src) &&
  src.indexOf('undecodedInstants(plan, schema)') < src.indexOf("await connect()"));

console.log('\n3) tools/pg_migrate.js — a value the column type would ALTER stops the run (pg_diff_check cannot see it)');
{
  const fake = { t: { water: 'numeric', backup_date: 'date', start_time: 'time', ts: 'timestamptz', age: 'numeric' } };
  const plan = [{ wb: 'MAIN', sheet: 'X', table: 't', cols: { Water: 'water', BackupDate: 'backup_date', StartTime: 'start_time', Ts: 'ts', Age: 'age' },
    rows: [{ Water: 'น้อย', BackupDate: '2026-11-17 02:00:13', StartTime: '08:00', Ts: '2026-11-17 02:00:13', Age: '#NUM!' },
           { Water: '', BackupDate: '2026-11-17', StartTime: 'สาย', Ts: '2026-11-17', Age: 12 }] }];
  const L = M.lossyValues(plan, fake), by = w => L.find(x => x.where.endsWith('.' + w)) || {};
  ok_('a word in a numeric column (DAILY_JOURNAL.Water — 2,088 real rows)', by('Water').n === 1);
  ok_('a date-time in a `date` column (BACKUP_LOG.BackupDate — the time would be cut)', by('BackupDate').n === 1);
  ok_('a word in a `time` column', by('StartTime').n === 1);
  ok_('a timestamp column is NOT mistaken for a time column', !by('Ts').where);
  ok_("a spreadsheet's own #NUM! is reported, not counted as a loss", by('Age').err === 1 && !by('Age').n);
  ok_('…and main() stops on a loss before connecting', /const lossy = lossyValues\(plan, schema\);[\s\S]{0,900}if \(lost\.length\) \{[\s\S]{0,500}process\.exit\(1\)/.test(src) &&
    src.indexOf('lossyValues(plan, schema)') < src.indexOf('await connect()'));
}

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
