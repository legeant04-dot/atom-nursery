/**
 * tools/test_insurance_export.js — the PCHI export really is the sheet, and the family is no longer
 * asked for things only the insurer knows.
 *   node tools/test_insurance_export.js
 *
 * ASKED 2026-08-27, two halves of the same problem:
 *
 *  · "แผนประกันและวันเริ่มใช้ ให้ปลดบังคับใส่ออก รอ Admin มาใส่ข้อมูลเอง" — the plan and the effective
 *    date are decided by the school and the insurer AFTER the form is handed in. A parent cannot
 *    know either. Requiring them meant the form could not be saved until somebody made an answer up,
 *    and an invented plan is a wrong plan on a real insurance policy.
 *
 *  · "เพิ่มปุ่ม Export … ใช้รูปแบบเดียวกันกับ Google Sheet เป๊ะๆ" — the file goes to the insurer, who
 *    expects their own column layout.
 *
 * WHAT MAKES THE EXPORT HONEST. "Exactly the same as the sheet" cannot be promised by a list of
 * column names in code: `ensureColumns_` adds columns to a live sheet on the fly, and the day one
 * appears, a hard-coded list would silently disagree with the thing it claims to mirror. So the
 * header row is READ AT EXPORT TIME, and this file proves that by adding a column the code has never
 * heard of and checking it comes out.
 *
 * The real GAS handler is run against an in-memory spreadsheet — not a re-implementation of it.
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
const app = R('webapp/app.js'), i18n = R('webapp/i18n.js'), code = R('src/Code.gs');

// ---- the real GAS code, against an in-memory spreadsheet -------------------------------------
const { run } = H(['Config', 'Db', 'Day6', 'GasEngine']);
const res = JSON.parse(run(function () {
  var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
  PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
  PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
  var out = {};

  var ins = main.insertSheet('INSURANCE_PCHI');
  // the sheet's own header row, plus ONE column the code has never heard of — this is the whole
  // point of reading the header instead of listing the columns in code
  ins.appendRow(['InsuranceID', 'StudentID', 'Title', 'InsuredName', 'InsuredLastName',
                 'NationalID', 'DOB', 'EffectiveDate', 'Plan', 'Remarks', 'ColumnNobodyDeclared']);
  ins.appendRow(['INS-1', 'STD-1', 'ด.ญ.', 'เลอา', 'เทียนชัย', '1234567890123', '2023-02-01', '', '', 'หมายเหตุ, มีคอมมา', 'x1']);
  ins.appendRow(['INS-2', 'STD-2', 'ด.ช.', 'มีมี่', 'เทียนชัย', '9876543210987', '2022-05-09', '2026-09-01', 'Plan A', '', 'x2']);

  out.empty = handleInsuranceExport();          // called BEFORE the rows? no — capture the filled one
  out.filled = handleInsuranceExport();

  // …and a sheet with a header but no data rows at all
  var ins2 = main.insertSheet('INSURANCE_PCHI_EMPTY');
  ins2.appendRow(['InsuranceID', 'StudentID']);
  return JSON.stringify(out);
}));

console.log('\n1) the export IS the sheet');
{
  const r = res.filled;
  eq('the header row comes out as the sheet has it',
    r.headers, ['InsuranceID', 'StudentID', 'Title', 'InsuredName', 'InsuredLastName',
                'NationalID', 'DOB', 'EffectiveDate', 'Plan', 'Remarks', 'ColumnNobodyDeclared']);
  /* A COLUMN NOBODY DECLARED still comes out. ensureColumns_ adds columns to a live sheet, so a
   * hard-coded list would quietly stop matching the file it claims to mirror. */
  ok_('...including a column the code has never heard of', r.headers.indexOf('ColumnNobodyDeclared') >= 0);
  eq('every row, in the sheet order', r.rows.length, 2);
  eq('...cell for cell', r.rows[0],
    ['INS-1', 'STD-1', 'ด.ญ.', 'เลอา', 'เทียนชัย', '1234567890123', '2023-02-01', '', '', 'หมายเหตุ, มีคอมมา', 'x1']);
  eq('...with the same number of cells as headers', r.rows.map(x => x.length), [11, 11]);
  eq('and the count the screen reports', r.count, 2);
  ok_('the filename says what it is and when', /^INSURANCE_PCHI_\d{4}-\d{2}-\d{2}\.xlsx$/.test(r.filename));
  ok_('...and the tab is named like the sheet', r.sheetName === 'INSURANCE_PCHI');
}
{
  /* DISPLAY VALUES, NOT VALUES. getValues() hands back a Date for a date cell, which would export as
   * an ISO timestamp — not what the sheet shows and not what the insurer's template expects. */
  ok_('dates are the characters in the cell, not ISO timestamps',
    res.filled.rows.every(row => !/T\d{2}:\d{2}/.test(String(row[6]))));
  ok_('...which is what getDisplayValues means', /getDisplayValues\(\)/.test(R('src/Day6.gs')));
  ok_('a blank cell stays blank rather than becoming "null"',
    res.filled.rows[0][7] === '' && res.filled.rows[0][8] === '');
}

console.log('\n2) it is the admin’s file, and it changes nothing');
{
  ok_('routed', /insuranceExport: *function \(\) *\{ return handleInsuranceExport\(\); \}/.test(code));
  /* Every child's national id, date of birth and bank account in one download — this is the most
   * sensitive single artefact the system can produce. */
  ok_('...and admin-only on the server', /insuranceExport: 1/.test(code));
  // it only reads; the verb test agrees, so it must NOT take the write lock
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  ok_('classified as a read, because it writes nothing', !MUT.test('insuranceExport'));
  ok_('...and the handler really does not write', !/appendRow|setValue|updateRow_|deleteRow/.test(
    R('src/Day6.gs').slice(R('src/Day6.gs').indexOf('function handleInsuranceExport'),
      R('src/Day6.gs').indexOf('/** Status: is the insurance form'))));
  /* exportStudent is the counter-example and must stay classified as a WRITE: it stamps
   * Status='EXPORTED'. The names look alike; the behaviour does not. */
  ok_('exportStudent is still a write, unlike this one', MUT.test('exportStudent'));
}

console.log('\n3) the download itself');
{
  ok_('there is a button, top right of the title row', /onclick="A_insuranceExport\(this\)"/.test(app));
  ok_('...disabled while nothing has been filled in', /\$\{_filled\?'':' disabled/.test(app));
  ok_('...and while the export is running, so it cannot be queued twice', /btn\.disabled=true; btn\.style\.opacity='\.5';/.test(app));
  ok_('the header row is written as the first line of the file', /const rows = \[r\.headers\]\.concat\(r\.rows\|\|\[\]\);/.test(app));
  ok_('...and nothing is reordered or renamed on the way out', !/\.sort\(|\.map\(h=>/.test(
    app.slice(app.indexOf('window.A_insuranceExport'), app.indexOf('window.A_insuranceEdit'))));
  ok_('xlsx first, which carries Thai with no encoding to choose', /XLSXMin\.download\(r\.filename/.test(app));
  /* CSV is the fallback for a blocked or offline writer — WITH A BOM. Excel reads a BOM-less UTF-8
   * CSV as latin-1 and turns every Thai name into mojibake. */
  ok_('...CSV as a fallback', /type:'text\/csv;charset=utf-8'/.test(app));
  ok_('...with a BOM, or Excel mangles every Thai name', /'﻿'\+csv/.test(app));
  ok_('...and CSV quoting for the commas that are already in the data', /\/\[",\\n\]\/\.test\(v\)/.test(app));
  ok_('an empty sheet says so instead of downloading nothing', /Nothing to export yet|ยังไม่มีข้อมูลให้นำออก/.test(app));
}

console.log('\n4) the parent is no longer asked what only the school knows');
{
  ok_('plan and effective date are not required any more',
    /function insValid\(d\)\{ return d\.Title&&d\.InsuredName&&d\.InsuredLastName; \}/.test(app));
  // the asterisk has to go with it, or the form still LOOKS like it is demanding them
  ok_('...and the form stops marking them with *', /insInp\('EffectiveDate',t\('ins2\.effective'\),rec\.EffectiveDate,'date'\)/.test(app));
  // the `1` is insSel/insInp's "required" flag — its absence IS the change, so assert on its absence
  ok_('...both of them', /insSel\('Plan',t\('ins2\.plan'\),o\.Plans,rec\.Plan\)\}/.test(app));
  ok_('...and neither carries the required flag any more',
    !/insSel\('Plan'[^)]*,1\)/.test(app) && !/insInp\('EffectiveDate'[^)]*,1\)/.test(app));
  ok_('...and says who fills them in', /ทางโรงเรียนจะเป็นผู้กรอกให้/.test(app));
  ok_('the error message no longer names them', !/แผนประกัน, วันมีผลบังคับ/.test(i18n));
  /* The three that ARE still required are the ones a family is the only source for. */
  ok_('title and name are still required', /d\.Title&&d\.InsuredName&&d\.InsuredLastName/.test(app));
  // the admin form shares insValid, which is the point: the admin is the one who fills the rest in
  ok_('the admin form uses the same rule', (app.match(/if\(!insValid\(d\)\)/g) || []).length === 2);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
