/**
 * tools/test_pdpa_inventory.js — the record of processing must not drift from the system.
 *   node tools/test_pdpa_inventory.js
 *
 * PDPA §39 makes the school keep a record of what personal data is processed. A record that was
 * true the day it was written and has not been looked at since is worse than none: it is a document
 * the school would hand to a regulator, or to a parent, believing it.
 *
 * So the record is GENERATED from `SCHEMA` in src/Config.gs, and this fails the moment the two
 * disagree — the same arrangement, and the same reason, as the generated migration file.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * §1  every table is attributed to somebody — a new sheet cannot slip in unnamed
 * §2  the committed document is what the generator produces today
 * §3  🔴 the sensitive columns (PDPA §26) are listed by NAME, because §26 needs EXPLICIT consent
 *     and "this system holds some health data" is not something a school can act on
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const { inventory, SENSITIVE, SUBJECT } = require('./pdpa_inventory.js');

console.log('\n1) 🔴 ทุกตารางต้องรู้ว่าเป็นข้อมูลของใคร');
{
  const inv = inventory();
  ok_('อ่านโครงสร้างข้อมูลได้จริง', inv.length >= 40);
  const unnamed = inv.filter(t => !SUBJECT[t.sheet]).map(t => t.sheet);
  /* A table nobody has attributed is a table of personal data that the record does not mention —
   * which is the one failure this document may not have. */
  eq('🔴 ไม่มีตารางไหนที่ยังไม่ได้ระบุเจ้าของข้อมูล', unnamed, []);
}

console.log('\n2) 🔴 เอกสารที่ commit ไว้ ตรงกับระบบวันนี้');
{
  /* 🔴 READ THE GENERATOR, DO NOT RE-WRITE THE DOCUMENT.
   *
   * This used to run `--write`, which rewrote docs/pdpa/02_ROPA.md as a side effect of testing it.
   * The committed file therefore came back DIRTY after every suite run — only the date line, but
   * that is a tracked PDPA record whose date moved every day with nothing having changed, and
   * anybody committing the day's work carried the drift along. Found on 2026-10-24 when the working
   * tree showed a ROPA edit nobody had made.
   *
   * Comparing the generator's stdout answers the same question without touching the file. */
  const before = R('docs/pdpa/02_ROPA.md');
  const after = cp.execSync('node tools/pdpa_inventory.js', { cwd: ROOT, encoding: 'utf8' });
  /* The generation date is the one line that legitimately moves, so it is excluded — everything
   * else differing means somebody changed the schema and did not re-generate the record. */
  const strip = s => s.replace(/^สร้างเอกสารครั้งล่าสุด:.*$/m, '').replace(/\r/g, '').trim();
  eq('🔴 บันทึกรายการประมวลผล ยังตรงกับ SCHEMA', strip(before) === strip(after) ? 'in step' : 'STALE', 'in step');
}

console.log('\n3) 🔴 ข้อมูลอ่อนไหว (ม.26) — ระบุเป็นรายคอลัมน์');
{
  const doc = R('docs/pdpa/02_ROPA.md');
  const inv = inventory();
  const cols = [...new Set(inv.flatMap(t => t.sensitive))];
  ok_('มีข้อมูลอ่อนไหวอยู่จริง และเอกสารบอกไว้', cols.length >= 15);
  /* Named individually. A count would be satisfied by the wrong fifteen, and the school has to
   * write each of these into a consent form. */
  ['Allergy', 'MedicalHistory', 'BloodType', 'Religion', 'Race', 'Narrative', 'InjuryTypes', 'Result']
    .forEach(c => ok_('🔴 ' + c + ' ถูกระบุว่าเป็นข้อมูลอ่อนไหว', !!SENSITIVE[c] && doc.indexOf('`' + c + '`') >= 0));
  /* 🔴 THE INJURY REPORT uses none of the words a keyword list would look for — it describes a
   * child's body and what happened to it, in columns called Narrative and CauseObject. It is the
   * most sensitive thing in the system and the easiest to miss. */
  ok_('🔴 รายงานการบาดเจ็บถูกนับเป็นข้อมูลสุขภาพ',
    !!SENSITIVE.Narrative && !!SENSITIVE.CauseObject && !!SENSITIVE.InjuryTypes);
  /* CONTROL — not everything is sensitive, or the category means nothing */
  ok_('CONTROL: ชื่อเล่นและชั้นเรียน ไม่ใช่ข้อมูลอ่อนไหว', !SENSITIVE.Nickname && !SENSITIVE.Class);
}

console.log('\n4) 📄 ชุดเอกสารครบ และบอกตรงๆ ว่ายังไม่ใช่เอกสารกฎหมาย');
{
  ['README.md', '01_DPA.md', '02_ROPA.md', '03_CONSENT_PARENTS.md', '04_SUBPROCESSORS.md']
    .forEach(f => ok_('มี docs/pdpa/' + f, fs.existsSync(path.join(ROOT, 'docs', 'pdpa', f))));
  /* Every one of these says it needs a lawyer. A draft that reads like a finished legal instrument
   * is the one way this set could do harm. */
  ['README.md', '01_DPA.md', '02_ROPA.md', '03_CONSENT_PARENTS.md', '04_SUBPROCESSORS.md']
    .forEach(f => ok_('🔴 ' + f + ' บอกว่าต้องให้ทนายตรวจ', /ทนาย/.test(R('docs/pdpa/' + f))));
  /* and the consent half must stay separate from the notice half — §26 cannot ride on a §23 notice */
  const consent = R('docs/pdpa/03_CONSENT_PARENTS.md');
  ok_('🔴 แยก "การแจ้ง" ออกจาก "การขอความยินยอม"',
    /ส่วนที่ 1 · การแจ้ง/.test(consent) && /ส่วนที่ 2 · ขอความยินยอมโดยชัดแจ้ง/.test(consent));
  ok_('🔴 ...และปฏิเสธได้โดยลูกยังเรียนได้', /ยังเรียนได้/.test(consent));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
