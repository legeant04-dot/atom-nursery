/**
 * tools/test_injury_form.js — the official injury form, filled in, as a PDF.
 *   node tools/test_injury_form.js
 *
 * แบบบันทึกการบาดเจ็บรายบุคคล *๑๐ (๑.๓.๗) is what the school hands to the authority, so the PDF has
 * to be the SAME document: same boxes, same order, same wording, same tick boxes. A form an official
 * does not recognise is a form they send back.
 *
 * The app does not collect everything the paper asks for — the body diagram, the eight numbered
 * wounds and the treatment given have no fields yet — so those print as the EMPTY form to be
 * completed by hand. That is checked here too: printing them blank is deliberate, and dropping the
 * second page would not be the same document.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const rc = R('webapp/report_card.js'), app = R('webapp/app.js'), eng = R('webapp/engine.js'), cfg = R('src/Config.gs');

console.log('\n1) every box on the paper form is drawn');
{
  const want = [
    ['the form number', '*๑๐ (๑.๓.๗) แบบบันทึกการบาดเจ็บรายบุคคล'],
    ['the title', 'แบบบันทึกการบาดเจ็บรายบุคคล'],
    ['date of injury', 'วันที่เกิดการบาดเจ็บ'],
    ['the Buddhist year prefix', 'พ.ศ. ๒๕'],
    ['centre name', 'ชื่อศูนย์'],
    ['affiliation', 'สังกัด'],
    ['...its two options', 'สำนักพัฒนาสังคม'],
    ['district', 'ชื่อเขต'],
    ['recorder', 'ผู้บันทึก'],
    ['the injured child', 'เด็กที่บาดเจ็บ'],
    ['sex', 'ชาย'],
    ['education', 'ไม่ได้เรียน'],
    ['what led to it', 'เหตุนำและเหตุการณ์ของการบาดเจ็บ'],
    ['...with the paper\'s own hint', 'ปีนโต๊ะแล้วตกลงมา'],
    ['the object involved', 'สาเหตุหลักการบาดเจ็บ'],
    ['a direct witness', 'มีผู้พบเห็นเหตุการณ์โดยตรง'],
    ['...its three answers', 'ไม่แน่ใจ'],
    ['where it happened', 'สถานที่เกิดเหตุ'],
    ['...including the day-care option', 'ศูนย์พัฒนาเด็กหรือศูนย์เลี้ยงเด็ก'],
    ['the injury-type instruction', 'ชนิดการบาดเจ็บ']
  ];
  want.forEach(w => ok_(w[0], rc.indexOf(w[1]) >= 0));
}

console.log('\n2) all seventeen injury types, in the paper\'s order and wording');
{
  const m = /var INJ_TYPES_TH = \[([\s\S]*?)\n  \];/.exec(rc);
  const arr = (m ? m[1].match(/'[^']*'/g) || [] : []).map(s => s.slice(1, -1));
  eq('seventeen of them', arr.length, 17);
  eq('1 is the fall', arr[0], 'พลัดตกหกล้ม');
  eq('5 is drowning', arr[4], 'ตกน้ำ จมน้ำ');
  eq('9 is electric shock', arr[8], 'ถูกไฟฟ้าดูด');
  eq('12 is traffic', arr[11], 'การจราจร เช่น ถูกรถชน');
  eq('16 is self-harm', arr[15], 'ทำร้ายตนเอง');
  eq('17 is "other"', arr[16], 'อื่นๆ');
  // the codes stored by the app must line up with these positions, or a tick lands on the wrong line
  const appTypes = /const INJURY_TYPES=\[([\s\S]*?)\n  \];/.exec(app);
  const ns = (appTypes ? appTypes[1].match(/\{n:\s*(\d+)/g) || [] : []).map(s => Number(s.replace(/\D/g, '')));
  eq('the app stores codes 1..17, in order', ns, Array.from({ length: 17 }, (_, i) => i + 1));
  ok_('the form ticks by that code', /picked\.indexOf\(String\(k \+ 1\)\) >= 0/.test(rc));
}

console.log('\n3) the fourteen wound characteristics, and the eight wound rows');
{
  const m = /var INJ_CHAR_TH = \[([\s\S]*?)\];/.exec(rc);
  const arr = (m ? m[1].match(/'[^']*'/g) || [] : []).map(s => s.slice(1, -1));
  eq('fourteen of them', arr.length, 14);
  eq('1 is a graze', arr[0], 'บาดแผลถลอก');
  eq('7 is a break or dislocation', arr[6], 'กระดูกเคลื่อน หรือหัก');
  eq('13 is a brain injury', arr[12], 'บาดเจ็บสมอง');
  ok_('the eight numbered wound rows are drawn', /'บาดแผลหมายเลข ' \+ '๑๒๓๔๕๖๗๘'\.charAt\(r2\)/.test(rc));
  ok_('...as Thai numerals, like the paper', /๑๒๓๔๕๖๗๘/.test(rc));
}

console.log('\n4) what is filled in, and what is deliberately left blank');
{
  ['CenterName', 'AffiliationType', 'AffiliationOther', 'District', 'RecorderName', 'ChildName',
   'Sex', 'AgeYears', 'AgeMonths', 'EduStatus', 'EduGrade', 'Narrative', 'CauseObject', 'Witness',
   'Place', 'PlaceOther', 'InjuryTypes'].forEach(f =>
    ok_('the form prints d.' + f, new RegExp('d\\.' + f + '\\b').test(rc)));
  // …and each of those is a real column, or it would print empty for ever
  const hdr = /INJURY_REPORTS:\s*\[([\s\S]*?)\]/.exec(cfg);
  const cols = (hdr ? hdr[1].match(/'[^']+'/g) || [] : []).map(s => s.slice(1, -1));
  ['CenterName', 'RecorderName', 'ChildName', 'Narrative', 'CauseObject', 'Witness', 'Place', 'InjuryTypes']
    .forEach(c => ok_(c + ' is stored, so it can be printed', cols.indexOf(c) >= 0));
  ok_('page 2 is still drawn, not dropped', /function drawInjuryPage2/.test(rc));
  ok_('...and the reader is told why it is blank', /ยังไม่ได้เก็บข้อมูลส่วนนี้/.test(app));
  ok_('the reason is written down in the code too', /prints as the EMPTY form/.test(rc));
}

console.log('\n5) two A4 pages, built on the device, never uploaded');
{
  ok_('renderInjury makes exactly two pages', /\[drawInjuryPage1, drawInjuryPage2\]\.map/.test(rc));
  ok_('saveInjury is exported', /saveInjury: function \(d, kind\)/.test(rc));
  ok_('PDF is the default, image is the option', /kind === 'jpg'/.test(rc));
  ok_('the file is named after the child and the date', /'แบบบันทึกการบาดเจ็บ_' \+ \(who \|\| 'เด็ก'\) \+ '_'/.test(rc));
  // the filename is scrubbed of characters a filesystem refuses (\ / : * ? " < > | and whitespace)
  ok_('...with characters a filesystem refuses stripped out',
    rc.indexOf('.replace(/[\\\\/:*?"<>|\\s]+/g, \'_\')') >= 0);
  ok_('it reuses the same hand-built PDF writer', /buildPdf\(sheets\)/.test(rc));
  ok_('the same A4 canvas as every other export', /var W = 1240, H = 1754/.test(rc));
  ok_('fonts are awaited, or Thai renders as boxes', /document\.fonts\.ready/.test(rc.slice(rc.indexOf('function renderInjury'))));
}

console.log('\n6) the button, and the data behind it');
{
  ok_('the injury report offers the form', /A_injuryPdf\('\$\{esc\(r\.InjuryID\|\|''\)\}'/.test(app));
  ok_('...loading the drawing code only when asked', /__atomLoadScript\('report_card\.js',\(\)=>!!\(window\.AtomReportCard&&window\.AtomReportCard\.saveInjury\)\)/.test(app));
  ok_('it fetches the FULL record, not the summary row', /const r=await api\('injuryReport',\{injuryId:id\}\)/.test(app));
  ok_('the button cannot be double-tapped mid-build', /btn\.disabled=true; btn\.innerHTML='⏳'/.test(app));
  ok_('...and comes back even if it fails', /finally\{ if\(btn\)\{ btn\.disabled=false; btn\.innerHTML=old; \} \}/.test(app));
  ok_('the engine can return one report by id', /injuryReport: p => \{/.test(eng));
  ok_('...with the child and the teacher resolved for the form', /teacherName:t\.NameTH\|\|t\.Name\|\|''/.test(eng));
}

console.log('\n7) PDPA — a child\'s health data must not leave the device');
{
  const fn = rc.slice(rc.indexOf('saveInjury: function'), rc.indexOf('buildPdf: buildPdf'));
  ok_('no upload, no fetch, no share link', !/fetch\(|XMLHttpRequest|uploadSlip|api\(/.test(fn));
  ok_('it only downloads', /download\(/.test(fn));
  ok_('the whole file states the rule', /never uploaded/.test(rc));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
