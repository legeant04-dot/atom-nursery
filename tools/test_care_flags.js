/**
 * tools/test_care_flags.js — the child a teacher has to be careful with, visible without opening
 * anything.
 *   node tools/test_care_flags.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * Asked 2026-10-15: "ถ้าในประวัติเด็กนักเรียนมีข้อมูลแพ้อาหาร/โรคประจำตัว ต้องแสดงให้คุณครูเห็น
 * และรับรู้ว่าเด็กคนนี้ต้องระวังเรื่องไหนเป็นพิเศษ".
 *
 * The data was already there, already reaching the class list, and already shown in a red card on
 * the profile screen. What was missing is the only thing that matters in a room with twenty
 * children in it: a teacher could not see it without opening each child one at a time.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 AND THE LINE THAT WAS THERE WAS WORSE THAN NOTHING
 *
 * Every row carried a grey "แพ้: -". Measured on the school's real export: of 51 children, 26 have
 * a BLANK allergy field, 17 have '-', and 8 have something real. So ~84% of rows said "แพ้: -" in
 * the same muted grey as the child's age — and by the time a row did say "แพ้: นมวัว" it was in the
 * same place, the same size and the same colour as the forty that said nothing.
 *
 * A warning present on every row, in the colour of furniture, is not a warning. It is a thing the
 * eye learns to skip.
 *
 * 🔴 '-' IS NOT A VALUE EITHER. `A_regSubmit` writes `Allergy: v('#rAllergy')||'-'` — the app
 * manufactured 17 of those dashes itself. Blank, '-', '–' and 'ไม่มี' all mean "nothing recorded",
 * and none of them means "this child has no allergies": nobody has established that either way.
 */
const path = require('path'), fs = require('fs'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

/* The three helpers lifted out of app.js and run for real. They are pure string functions, so they
 * can be exercised directly — which beats asserting that the source contains a regex. */
const sandbox = { EN: () => false, esc: s => String(s == null ? '' : s) };
vm.createContext(sandbox);
{
  /* Cut the block out of app.js and run it as ONE script, with the exports appended — `const` and
   * `function` declared inside a vm script are scoped to that script and never appear on the
   * context, so loading them one at a time leaves the context empty and every assertion below
   * throws rather than failing. (Which is its own small lesson: a harness that cannot reach its
   * subject must say so, not report a pass.) */
  const from = app.indexOf('const careHas = v =>');
  const to = app.indexOf('function bdayTag(dob)');
  if (from < 0 || to < 0 || to <= from) throw new Error('care helpers not found in webapp/app.js');
  vm.runInContext(app.slice(from, to) +
    '\n;this.careHas=careHas;this.careOf=careOf;this.careTag=careTag;this.careLine=careLine;', sandbox);
}
const { careHas, careTag, careLine } = sandbox;
if (typeof careHas !== 'function') throw new Error('care helpers did not load');

console.log('\n1) 🔴 "ไม่มีข้อมูล" กับ "ไม่แพ้" ไม่ใช่เรื่องเดียวกัน');
[['', 'ว่าง'], ['-', 'ขีด (แอปเขียนเองตอนลงทะเบียน · live มี 17 คน)'], ['–', 'ขีดยาว'],
 ['—', 'ขีดยาวมาก'], ['  ', 'ช่องว่าง'], ['ไม่มี', 'คำว่าไม่มี'], ['none', 'none']]
  .forEach(([v, why]) => ok_('  ไม่นับเป็นข้อมูล: ' + why, careHas(v) === ''));
[['นมวัว', 'แพ้นมวัว'], ['ถั่ว, ไข่', 'หลายอย่าง'], ['หอบหืด', 'โรคประจำตัว']]
  .forEach(([v, why]) => eq('  นับเป็นข้อมูลจริง: ' + why, careHas(v), v));

console.log('\n2) 🔴 เด็กที่ต้องระวัง = ป้ายแดง · เด็กที่ไม่มีข้อมูล = ไม่มีหมึกเลย');
{
  const none = { Allergy: '-', MedicalHistory: '' };
  const al = { Allergy: 'นมวัว', MedicalHistory: '-' };
  const md = { Allergy: '', MedicalHistory: 'หอบหืด' };
  const both = { Allergy: 'ถั่ว', MedicalHistory: 'หอบหืด' };
  /* 🔴 "Nothing" is the right amount of ink for "nothing to say". A badge on every row is wallpaper,
   * and wallpaper is what the old grey "แพ้: -" had become. */
  eq('เด็กที่ไม่มีข้อมูล — ไม่มีป้าย', [careTag(none), careLine(none)], ['', '']);
  ok_('แพ้อย่างเดียว → ป้ายแดง', /pill bad/.test(careTag(al)) && /ต้องระวัง/.test(careTag(al)));
  ok_('โรคประจำตัวอย่างเดียว → ป้ายแดงเหมือนกัน (เดิมรายชื่อชั้นเรียนไม่เคยแสดงเลย)',
    /pill bad/.test(careTag(md)));
  ok_('มีทั้งสองอย่าง → ป้ายเดียว ไม่ใช่สองป้าย', (careTag(both).match(/pill bad/g) || []).length === 1);
  /* ...and the DETAIL underneath, because "be careful" without saying what is a pill nobody can
   * act on. A teacher holding a biscuit needs the word "นมวัว", not a red dot. */
  ok_('🔴 บรรทัดใต้ชื่อบอกว่าแพ้อะไร ไม่ใช่แค่ว่า "ระวัง"', /นมวัว/.test(careLine(al)));
  ok_('...และบอกโรคด้วย', /หอบหืด/.test(careLine(md)));
  ok_('...ทั้งสองอย่างอยู่ในบรรทัดเดียว',
    /ถั่ว/.test(careLine(both)) && /หอบหืด/.test(careLine(both)));
  ok_('บรรทัดนั้นเป็นสีแดง ไม่ใช่สีเทาเหมือนอายุ', /var\(--bad\)/.test(careLine(al)));
}

console.log('\n3) อยู่ในรายชื่อชั้นเรียนจริง และไม่เหลือบรรทัดเทาแบบเดิม');
{
  ok_('รายชื่อชั้นเรียนเรียกใช้ careTag + careLine',
    /\$\{careTag\(s\)\}/.test(app) && /\$\{careLine\(s\)\}/.test(app));
  /* 🔴 The old line must be GONE, not merely joined by a better one. Leaving "แพ้: -" in place
   * would keep teaching the eye to skip exactly the row region the new badge lives in. */
  ok_('🔴 บรรทัด "แพ้: -" สีเทาเดิมถูกเอาออกแล้ว',
    !/'allergy':'แพ้'\}: \$\{esc\(s\.Allergy\|\|'-'\)\}/.test(app));
  // the data has to BE there for the badge to work at all — classList spreads the whole student row
  ok_('classList ส่งข้อมูลนักเรียนทั้งแถว (ป้ายจึงอ่าน MedicalHistory ได้)',
    /Object\.assign\(\{ageMonth:ageMonths\(s2\.DOB\)[\s\S]{0,600}\}, s2\)/.test(eng));
}

console.log('\n4) หน้าผู้ปกครอง — คนเดียวที่กรอกข้อมูลนี้ได้');
{
  /* The school decided this stays the family's and the admin's to write (2026-10-15). A teacher who
   * spots the gap can only tell somebody; the parent looking at this card can fix it in seconds —
   * so the ask belongs there, and as an invitation rather than a warning. */
  ok_('การ์ดลูกของผู้ปกครองใช้ careLine เหมือนกัน', /\$\{careLine\(k\)\}/.test(app));
  ok_('🔴 ...และชวนให้กรอกเมื่อยังไม่มีข้อมูล (ไม่ใช่ขึ้นเตือนสีแดงใส่พ่อแม่)',
    /ยังไม่ได้บันทึกข้อมูลแพ้อาหาร/.test(app) && /P_profile\(\)/.test(app));
  // ...and the permission model did not move
  ok_('สิทธิ์แก้ไขยังเป็นของผู้ปกครอง+แอดมิน (คุณครูอ่านอย่างเดียว)',
    /WHITE = \['Nickname', 'NicknameEN', 'BloodType', 'Allergy', 'MedicalHistory'/.test(R('src/Staff.gs')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
