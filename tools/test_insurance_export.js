/**
 * tools/test_insurance_export.js — the export IS the insurer's form, and the family is only asked
 * for what the family can answer.
 *   node tools/test_insurance_export.js
 *
 * TARGET: "23022026 - PCHI Members In-Out Form.xlsx" → sheet "Input Data", columns A–X. The school
 * opens Pacific Cross's real template and pastes the block in, so the column ORDER and the HEADINGS
 * have to be theirs. Transcribed from the workbook on 2026-08-27 and pinned here, so a change to the
 * form is a deliberate edit in two places and never a silent drift.
 *
 * WHAT THE COMPARISON FOUND. All 23 data columns (B–X) map onto a column INSURANCE_PCHI already had
 * — nothing missing, nothing to add — and every value in our dropdowns is one the form accepts.
 * Our own InsuranceID / StudentID / CompanyName / PolicyNo / FilledBy… are bookkeeping and must NOT
 * travel to the insurer.
 *
 * THE REQUIRED FIELDS depart from the workbook's own colour coding in two places, both the school's
 * decision (2026-08-27):
 *   · E ชื่อกลาง and I เลขหนังสือเดินทาง are coloured MANDATORY there, and are optional here —
 *     most Thai children have neither.
 *   · N วันมีผลบังคับ and O แผนประกัน are coloured MANDATORY there, and are not asked of the family
 *     at all — the school and the insurer settle them after the form is handed in.
 */
const fs = require('fs'), path = require('path');
const H = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got=' + JSON.stringify(got) + '\n        want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), i18n = R('webapp/i18n.js'), code = R('src/Code.gs'), day6 = R('src/Day6.gs');

// ---- the real GAS code, against an in-memory spreadsheet -------------------------------------
const { run } = H(['Config', 'Db', 'Day6', 'GasEngine', 'Checkin', 'Password']);
const res = JSON.parse(run(function () {
  var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
  PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
  PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
  var cfg = main.insertSheet('SCHOOL_CONFIG'); cfg.appendRow(['Key', 'Value']); cfg.appendRow(['Timezone', 'Asia/Bangkok']);

  var ins = main.insertSheet('INSURANCE_PCHI');
  ins.appendRow(['InsuranceID', 'StudentID', 'Type', 'Title', 'InsuredName', 'InsuredMiddleName',
    'InsuredLastName', 'Gender', 'NationalID', 'Passport', 'DOB', 'MemberStatus', 'MaritalStatus',
    'Occupation', 'EffectiveDate', 'Plan', 'Mobile', 'Email', 'BankAccountName', 'BankAccountNumber',
    'EmployeeID', 'BeneficiaryName', 'BeneficiaryLastName', 'BeneficiaryRelationship', 'Remarks',
    'CompanyName', 'PolicyNo', 'FilledBy', 'FilledByRole', 'FilledDate']);
  ins.appendRow(['INS-001', 'STD-1', '', 'ด.ญ.', 'ปารมิตา', '', 'เทียนชัย', 'Female', '1104500210510',
    '', '2023-12-02', 'Child', 'Single', 'นักเรียน', '', '', '0812345678', 'a@b.com',
    'SCB: ธนาคารไทยพาณิชย์ จำกัด (มหาชน)', '1234567890', '', 'ภัทร', 'เทียนชัย', 'Father',
    'หมายเหตุ, มีคอมมา', 'Atom Nursery', 'P-1', 'Parent', 'Parent', '2026-08-27 10:19:54']);
  // a row nobody has filled in — it must NOT be sent to the insurer as though it were a member
  ins.appendRow(['INS-002', 'STD-9', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '', '', '', '', '', '']);
  // …and one that already carries an explicit movement type
  ins.appendRow(['INS-003', 'STD-3', 'ออก', 'ด.ช.', 'ธาม', '', 'อินน้อย', 'Male', '9', '', '2022-05-09',
    'Child', 'Single', 'นักเรียน', '2026-09-01', '3', '0898888888', 'c@d.com',
    'KBANK: ธนาคารกสิกรไทย จำกัด (มหาชน)', '999', '', 'พ่อ', 'อินน้อย', 'Father', '',
    'Atom Nursery', 'P-1', 'Admin', 'Admin', '2026-08-27 11:00:00']);

  return JSON.stringify({ ex: handleInsuranceExport(), form: PCHI_FORM_ });
}));

/* The insurer's headings, transcribed from the workbook, sheet "Input Data", rows 12 and 13. */
const TH = ['ลำดับ (Auto)', 'ประเภท', 'คำนำหน้า*', 'ชื่อผู้เอาประกันภัย*', 'ชื่อกลางผู้เอาประกันภัย*',
  'นามสกุลผู้เอาประกันภัย*', 'เพศ*', 'เลขที่บัตรประชาชน*', 'เลขหนังสือเดินทาง*', 'ว/ด/ป เกิด*', 'สถาน*',
  'สถานภาพการสมรส*', 'อาชีพ/ตำแหน่ง*', 'วันมีผลบังคับ*', 'แผนประกัน*', 'เบอร์โทรศัพท์มือถือ', 'อีเมล์',
  'ชื่อบัญชีธนาคารกรณีเรียกร้องสินไหม', 'เลขที่ธนาคารกรณีเรียกร้องสินไหม', 'รหัสพนักงาน',
  'ชื่อผู้รับผลประโยชน์', 'นามสกุลผู้รับผลประโยชน์', 'ความสัมพันธ์', 'หมายเหตุ'];
const EN = ['No.', 'Type', 'Title*', 'Insured Name*', 'Insured Middle Name*', 'Insured Last Name*',
  'Gender*', 'ID No.*', 'Passport*', '/DOB D/M/Y*', 'Status*', 'Marital Status*', 'Occupation/Duties*',
  'Effective date*', 'Plan*', 'Mobile no.', 'Email Address', 'Bank Account Name', 'Bank Account Number',
  'Employee ID', 'Beneficiary', 'Beneficiary', 'Relationship', 'Remarks'];

console.log('\n1) the export is the insurer form, column for column');
{
  const r = res.ex;
  eq('24 columns, A to X', r.headers.length, 24);
  eq('the Thai heading row is theirs, verbatim', r.headers, TH);
  eq('...and the English one too', r.headersEN, EN);
  /* Every column of their form must be fed by a column we actually store — checked against the map
   * the handler itself uses, so adding a heading without wiring it up cannot pass. */
  eq('every data column is wired to one of ours', res.form.filter((c, i) => i > 0 && !c[2]), []);
  eq('...and column A is the running number they call "(Auto)"', res.form[0][2], null);
}
{
  const r = res.ex;
  eq('only the rows a family has filled in', r.count, 2);
  ok_('...the empty one is not sent as though it were a member', JSON.stringify(r.rows).indexOf('STD-9') < 0);
  eq('numbered from 1, in order', r.rows.map(x => x[0]), [1, 2]);
  /* Column B is the movement type. Everything this produces is a member being ADDED, so it defaults
   * to เข้า — but a row that already says otherwise is left alone. */
  eq('type defaults to the "in" value, an explicit one is kept', r.rows.map(x => x[1]), ['เข้า', 'ออก']);
  eq('the first row, cell for cell', r.rows[0].slice(2, 15),
    ['ด.ญ.', 'ปารมิตา', '', 'เทียนชัย', 'Female', '1104500210510', '', '2023-12-02', 'Child', 'Single', 'นักเรียน', '', '']);
  eq('...and the tail of it', r.rows[0].slice(15),
    ['0812345678', 'a@b.com', 'SCB: ธนาคารไทยพาณิชย์ จำกัด (มหาชน)', '1234567890', '', 'ภัทร', 'เทียนชัย', 'Father', 'หมายเหตุ, มีคอมมา']);
  ok_('the filename names the insurer form', /^PCHI_Members_In-Out_\d{4}-\d{2}-\d{2}\.xlsx$/.test(r.filename));
  ok_('...and the tab is named as their sheet is', r.sheetName === 'Input Data');
}
{
  // OUR bookkeeping must not travel to the insurer
  const flat = JSON.stringify(res.ex);
  ['InsuranceID', 'StudentID', 'FilledBy', 'CompanyName', 'PolicyNo'].forEach(f =>
    ok_(f + ' is not one of the columns', res.ex.headers.indexOf(f) < 0));
  ok_('...nor is our internal id leaking into a cell', flat.indexOf('INS-001') < 0);
  ok_('dates go out as dates, never as ISO timestamps', !/\d{4}-\d{2}-\d{2}T/.test(flat));
}

console.log('\n2) it is the admin file, and it changes nothing');
{
  ok_('routed', /insuranceExport: *function \(\) *\{ return handleInsuranceExport\(\); \}/.test(code));
  /* Every child's national id, date of birth and bank account in one download — the most sensitive
   * single artefact this system can produce. */
  ok_('...and admin-only on the server', /insuranceExport: 1/.test(code));
  const MUT = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  ok_('classified as a read, because it writes nothing', !MUT.test('insuranceExport'));
  const body = day6.slice(day6.indexOf('function handleInsuranceExport'), day6.indexOf('/** Status: is the insurance form'));
  ok_('...and the handler really does not write', !/appendRow|setValue|updateRow_|deleteRow/.test(body));
  /* exportStudent is the counter-example and must stay a WRITE: it stamps Status='EXPORTED'. The
   * names look alike; the behaviour does not. */
  ok_('exportStudent is still a write, unlike this one', MUT.test('exportStudent'));
}

console.log('\n3) the download itself');
{
  ok_('there is a button, top right of the title row', /onclick="A_insuranceExport\(this\)"/.test(app));
  ok_('...disabled while nothing has been filled in', /\$\{_filled\?'':' disabled/.test(app));
  ok_('...and while the export is running, so it cannot be queued twice', /btn\.disabled=true; btn\.style\.opacity='\.5';/.test(app));
  ok_('BOTH heading rows are written, Thai then English',
    /const rows = \[r\.headers\]\.concat\(r\.headersEN \? \[r\.headersEN\] : \[\]\)\.concat\(r\.rows\|\|\[\]\);/.test(app));
  ok_('...and nothing is reordered or renamed on the way out',
    !/\.sort\(|\.map\(h=>/.test(app.slice(app.indexOf('window.A_insuranceExport'), app.indexOf('window.A_insuranceEdit'))));
  ok_('xlsx first, which carries Thai with no encoding to choose', /XLSXMin\.download\(r\.filename/.test(app));
  /* CSV is the fallback for a blocked or offline writer — WITH A BOM. Excel reads a BOM-less UTF-8
   * CSV as latin-1 and turns every Thai name into mojibake. */
  ok_('...CSV as a fallback', /type:'text\/csv;charset=utf-8'/.test(app));
  ok_('...with a BOM', /'﻿'\+csv/.test(app));
  ok_('...and CSV quoting for the commas already in the data', /\/\[",\\n\]\/\.test\(v\)/.test(app));
  ok_('an empty sheet says so instead of downloading nothing', /ยังไม่มีข้อมูลให้นำออก/.test(app));
}

console.log('\n4) the family is asked for exactly what the school listed');
{
  /* C–M, P–S, U–W of the insurer's form, minus the two the school waived (E, I) and the two the
   * school fills itself (N, O). */
  const want = ['Title', 'InsuredName', 'InsuredLastName', 'Gender', 'NationalID', 'DOB',
    'MemberStatus', 'MaritalStatus', 'Occupation', 'Mobile', 'Email',
    'BankAccountName', 'BankAccountNumber', 'BeneficiaryName', 'BeneficiaryLastName', 'BeneficiaryRelationship'];
  const block = /const INS_REQUIRED = \[([\s\S]*?)\];/.exec(app)[1];
  eq('the required list is exactly the school list', [...block.matchAll(/\['([A-Za-z]+)'/g)].map(m => m[1]), want);
  ok_('...and validity is derived from it, not written twice',
    /function insValid\(d\)\{ return insMissing\(d\)\.length === 0; \}/.test(app));
  // the two the school waived, and the two it fills itself
  ['InsuredMiddleName', 'Passport', 'EffectiveDate', 'Plan'].forEach(f =>
    ok_(f + ' is NOT demanded of the family', block.indexOf("'" + f + "'") < 0));
  ok_('...and the form says who fills the last two in', /ทางโรงเรียนจะเป็นผู้กรอกให้/.test(app));
}
{
  /* Sixteen required fields and a flat "please fill the required fields" is a puzzle, not an error —
   * so the message names them. */
  ok_('the message names what is missing', /_miss\.slice\(0,4\)\.join\(', '\)/.test(app));
  ok_('...and says how many more there are', /\(\+'\+\(_miss\.length-4\)\+'\)/.test(app));
  eq('...on both save paths', (app.match(/const _miss=insMissing\(d\);/g) || []).length, 2);
  ok_('the generic message no longer names plan or effective date', !/แผนประกัน, วันมีผลบังคับ/.test(i18n));
  /* Occupation is mandatory on the insurer's form and meaningless for a two-year-old, so it is
   * pre-filled rather than left as a puzzle for the parent. */
  ok_('occupation is pre-filled for a child', /rec\.Occupation\|\|\(EN\(\)\?'Student':'นักเรียน'\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
