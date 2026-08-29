/**
 * tools/test_insurance_dates.js — a date the family can read, not a UTC timestamp.
 *   node tools/test_insurance_dates.js
 *
 * REPORTED 2026-08-27, from a real submission. The "already filled in" screen printed:
 *
 *     กรอกโดย: Parent · 2026-08-27T03:19:54.375Z
 *     ว/ด/ป เกิด:        2023-12-02T05:00:00.000Z
 *
 * Two separate faults in one line each:
 *   · a Date object written into a cell reads back as a Date and serialises to JSON as an ISO
 *     string, so the screen printed the wire format straight at a parent;
 *   · and it is UTC. 03:19Z is 10:19 in Bangkok, so the stamp was also seven hours wrong. A child
 *     born late in the evening would show the WRONG DAY.
 *
 * THE CAUSE IS THE PROJECT'S OWN DOCUMENTED TRAP. The engine's version of this handler has always
 * written `todayLocal()` — a plain string. The Code.gs ROUTE shadows the engine, and the route wrote
 * `new Date()`. Routes always win on GAS, so the engine being right never mattered.
 *
 * Fixed on the way IN (local strings) and on the way OUT (`insReadable_`), because rows written
 * before today already hold Dates and nobody is going to migrate the sheet by hand.
 */
const fs = require('fs'), path = require('path');
const H = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const day6 = R('src/Day6.gs');

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;    // the shape that must never reach a screen

const { run } = H(['Config', 'Db', 'Day6', 'GasEngine', 'Checkin', 'Password']);
const res = JSON.parse(run(function () {
  var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
  PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
  PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
  var cfg = main.insertSheet('SCHOOL_CONFIG'); cfg.appendRow(['Key', 'Value']);
  cfg.appendRow(['Timezone', 'Asia/Bangkok']);

  var stu = main.insertSheet('STUDENTS');
  stu.appendRow(['StudentID', 'Name', 'NameEN', 'NationalID', 'Gender', 'DOB', 'Class', 'Status']);
  // exactly what Sheets hands back for a date cell: a Date, not a string
  stu.appendRow(['STD-1', 'ด.ญ. เลอา', 'Leah', '1104500210510', 'F', new Date(2023, 11, 2), 'Nursery 2', 'ACTIVE']);

  var ins = main.insertSheet('INSURANCE_PCHI');
  ins.appendRow(['InsuranceID', 'StudentID', 'Title', 'InsuredName', 'InsuredLastName', 'Gender',
                 'NationalID', 'DOB', 'EffectiveDate', 'Plan', 'CompanyName', 'PolicyNo',
                 'FilledBy', 'FilledByRole', 'FilledDate', 'UpdatedBy', 'UpdatedDate']);
  var out = {};

  // ---- a fresh submission, exactly as the parent's form sends it ----
  handleSubmitInsurance({ studentId: 'STD-1', data: {
    Title: 'ด.ญ.', InsuredName: 'ปารมิตา', InsuredLastName: 'เทียนชัย',
    NationalID: '1104500210510', DOB: '2023-12-02', EffectiveDate: '', Plan: ''
  } });
  out.stored = handleInsuranceStatus({ studentId: 'STD-1' }).record;
  out.rawCells = ins.getRange(2, 1, 1, ins.getLastColumn()).getDisplayValues()[0];

  // ---- and a row written by the OLD code, still sitting in the sheet ----
  var legacy = main.insertSheet('LEGACY_PROBE');
  legacy.appendRow(['x']);                                  // keep the harness happy
  ins.appendRow(['INS-002', 'STD-9', 'ด.ช.', 'เก่า', 'เก่า', 'Male', '9', new Date(2022, 4, 9),
                 '', '', '', '', 'Parent', 'Parent', new Date(Date.UTC(2026, 7, 27, 3, 19, 54)), '', '']);
  out.legacy = insReadable_({ DOB: new Date(2022, 4, 9), EffectiveDate: '',
    FilledDate: new Date(Date.UTC(2026, 7, 27, 3, 19, 54)),
    FilledBy: 'Parent' });
  out.legacyIsoString = insReadable_({ FilledDate: '2026-08-27T03:19:54.375Z', DOB: '2023-12-02T05:00:00.000Z' });
  out.plainLeftAlone = insReadable_({ FilledDate: '2026-08-27 10:19', DOB: '2023-12-02' });
  return JSON.stringify(out);
}));

console.log('\n1) nothing that reaches the screen is a wire format');
{
  const r = res.stored;
  ok_('the stamp is not an ISO timestamp any more', !ISO.test(String(r.FilledDate)));
  // nowStr_ writes seconds too ('yyyy-MM-dd HH:mm:ss') — the same stamp PaySlips uses, so the two
  // agree; what matters here is that it is a local, readable string and not a wire format
  ok_('...it is a readable local one', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(r.FilledDate)));
  eq('date of birth is a plain date', r.DOB, '2023-12-02');
  ok_('...with no time and no Z on it', !/T|Z/.test(String(r.DOB)));
  // the two the parent may now leave blank must stay genuinely blank, not "undefined"/"null"
  eq('an unanswered plan is empty, not a word', [r.Plan, r.EffectiveDate], ['', '']);
}
{
  /* AND THE SHEET ITSELF holds strings, so the export (which reads display values) and anything
   * else reading that column agree with the screen. */
  const cells = res.rawCells;
  ok_('what landed in the sheet is not an ISO timestamp either', !cells.some(c => ISO.test(String(c))));
  ok_('...the date of birth cell reads as a date', cells.indexOf('2023-12-02') >= 0);
}

console.log('\n2) rows written BEFORE the fix display correctly too');
{
  /* Nobody is going to migrate the sheet by hand, so the repair is on the way OUT as well. */
  const L = res.legacy;
  ok_('a stored Date is rendered, not serialised', !ISO.test(String(L.FilledDate)));
  ok_('...in the school’s timezone, not UTC', String(L.FilledDate) === '2026-08-27 10:19');
  eq('...and a stored Date of birth becomes a date', L.DOB, '2022-05-09');
  const S = res.legacyIsoString;
  eq('an ISO string already in the sheet is repaired too', S.FilledDate, '2026-08-27 10:19');
  eq('...including the one from the report', S.DOB, '2023-12-02');
}
{
  // …and a value that is ALREADY a plain local string must not be reinterpreted as UTC and shifted
  const P = res.plainLeftAlone;
  eq('a plain local stamp is left exactly alone', P.FilledDate, '2026-08-27 10:19');
  eq('...and a plain date too', P.DOB, '2023-12-02');
}

console.log('\n3) the shape of the fix');
{
  ok_('the write stamps a local string', /FilledDate: nowStr_\(\)/.test(day6));
  ok_('...on an edit as well', /patch\.UpdatedDate = nowStr_\(\);/.test(day6));
  ok_('...and no Date object is written into a cell any more', !/Date: new Date\(\)/.test(day6));
  ok_('the read repairs what is already stored', /record: insReadable_\(rec\)/.test(day6));
  ok_('...on the admin list too', /filled: !!rec, record: insReadable_\(rec\)/.test(day6));
  /* Function DECLARATIONS, not `var f = function`: they are called from above their own position in
   * the file, and a var assignment would still be undefined at that point — which is exactly the
   * bug the first draft of this fix had. */
  ok_('the helpers are hoisted declarations', /^function insDate_\(/m.test(day6) && /^function insStamp_\(/m.test(day6));
  ok_('...and are defined before the handler that calls them',
    day6.indexOf('function insDate_(') < day6.indexOf('function handleSubmitInsurance'));
}

console.log('\n4) and the screen reads it the way its own label promises');
{
  const app = R('webapp/app.js');
  /* The row is labelled ว/ด/ป. A bare 2023-12-02 under that heading can be read as 2 December or as
   * the 12th, and on a form that goes to an insurer that ambiguity is not worth leaving open. */
  /* Anchored on insReviewRows, which is now the ONE place the read-back table is built (parent and
   * admin both render from it), rather than on the inline array literal it replaced. */
  ok_('date of birth is rendered day-first', /\['ins2\.dob',\s*insDay\(r\.DOB\)\]/.test(app));
  ok_('...and so is the effective date', /\['ins2\.effective',\s*insDay\(r\.EffectiveDate\)\]/.test(app));
  ok_('the helper exists', /const insDay = v =>/.test(app));
  /* BLANK MUST STAY BLANK. ddmmyyyy('') is new Date(todayStr()) — it would print TODAY as a child's
   * date of birth, which is worse than printing nothing. */
  ok_('...and an empty value does not become today', /return t \? ddmmyyyy\(t\.slice\(0,10\)\) : '';/.test(app));
  // …behaviour of that helper, run rather than read
  const p2n = n => String(n).padStart(2, '0');
  const ddmmyyyy = s => { const d = new Date(s || '2026-08-27'); return p2n(d.getDate()) + '-' + p2n(d.getMonth() + 1) + '-' + d.getFullYear(); };
  const insDay = v => { const t = String(v == null ? '' : v).trim(); return t ? ddmmyyyy(t.slice(0, 10)) : ''; };
  eq('a plain date reads day-first', insDay('2023-12-02'), '02-12-2023');
  eq('a legacy ISO value still reads day-first', insDay('2023-12-02T05:00:00.000Z'), '02-12-2023');
  eq('blank stays blank', [insDay(''), insDay(null), insDay(undefined)], ['', '', '']);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
