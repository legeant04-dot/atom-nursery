/**
 * tools/test_pg_diff_check.js — Phase 2.5. The daily check must not be able to flatter itself.
 *   node tools/test_pg_diff_check.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * The output of this phase is one number — how many consecutive days the two databases have been
 * identical — and that number is the gate for cutting the school over. So every way it could be
 * WRONG IN THE FLATTERING DIRECTION is a way the school gets moved onto a database that does not
 * match its records.
 *
 * §1  a clean day is a day where everything was compared and nothing differed
 * §2  🔴 a day that could not be checked BREAKS the streak. "No differences found" and "did not
 *     look" are the same output and opposite facts — the exact mistake the speed report made twice
 * §3  🔴 a table nobody can match is not a clean table
 * §4  the streak counts BACKWARDS from today and stops at the first bad day — it is not a total
 * §5  💰 a difference in a money column is reported separately, never as one of N differences
 * §6  the checker never writes to Postgres. A checker that repairs what it finds has destroyed the
 *     evidence of the bug it just hid
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const { streak, render } = require('./pg_diff_check.js');
const src = R('tools/pg_diff_check.js');

const day = (date, o) => Object.assign({ date, clean: false, checked: true, diffs: 0, money: 0 }, o);

console.log('\n1) นับวันที่สะอาดติดต่อกัน');
{
  eq('ยังไม่เคยตรวจ → 0', streak({ days: [] }), 0);
  eq('สะอาด 3 วันติด → 3', streak({ days: [
    day('2026-10-11', { clean: true }), day('2026-10-12', { clean: true }), day('2026-10-13', { clean: true })] }), 3);
  /* 🔴 นับถอยหลังจากวันนี้ ไม่ใช่นับรวม — สะอาด 10 วันแล้วพังเมื่อวาน ไม่ใช่ "สะอาด 10 วัน" */
  eq('🔴 สะอาดมานาน แล้วพังวันล่าสุด → 0', streak({ days: [
    day('2026-10-10', { clean: true }), day('2026-10-11', { clean: true }),
    day('2026-10-12', { clean: true }), day('2026-10-13', { diffs: 2 })] }), 0);
  eq('พังตรงกลาง → นับเฉพาะหลังจากนั้น', streak({ days: [
    day('2026-10-10', { clean: true }), day('2026-10-11', { diffs: 5 }),
    day('2026-10-12', { clean: true }), day('2026-10-13', { clean: true })] }), 2);
}

console.log('\n2) 🔴 วันที่ตรวจไม่ได้ ต้องตัดสถิติ');
{
  /* "ไม่พบความต่าง" กับ "ไม่ได้ดู" ให้ผลลัพธ์หน้าตาเดียวกันและเป็นข้อเท็จจริงตรงข้ามกัน
   * — รายงานความเร็วของโครงการนี้เคยผิดแบบนี้มาแล้ว 2 ครั้ง */
  eq('🔴 วันที่ตรวจไม่ได้ → สถิติขาด', streak({ days: [
    day('2026-10-11', { clean: true }), day('2026-10-12', { clean: true }),
    day('2026-10-13', { clean: false, checked: false, why: 'ไม่พบไฟล์ส่งออก' })] }), 0);
  ok_('...และโค้ดบันทึกว่า checked:false จริง', /writeLedger\(\{ date, clean: false, checked: false, why \}\)/.test(src));
  ok_('...ทุกทางที่ตรวจไม่ได้ ผ่าน fail() ทางเดียว', (src.match(/fail\(['`]/g) || []).length >= 4);
  ok_('ไฟล์หาย · tenant ไม่มี · อ่านไฟล์ไม่ออก — ครบทั้งสาม',
    /ไม่พบไฟล์ส่งออก/.test(src) && /ไม่พบ tenant/.test(src) && /อ่านไฟล์ส่งออกไม่สำเร็จ/.test(src));
}

console.log('\n3) 🔴 ตารางที่เทียบไม่ได้ ไม่ใช่ตารางที่สะอาด');
{
  ok_('ตารางที่จับคู่แถวไม่ได้ ถูกเก็บไว้ต่างหาก', /unmatched\.push\(t\.table\)/.test(src));
  /* clean = ไม่มีความต่าง AND ไม่มีตารางที่เทียบไม่ได้ — ถ้าลืมครึ่งหลัง ตารางที่ไม่มีใครดู
   * จะซ่อนอยู่ในผลลัพธ์สีเขียว */
  ok_('🔴 ...และทำให้ทั้งวันไม่สะอาด', /const clean = !rows\.length && !unmatched\.length;/.test(src));
  ok_('...พร้อมบอกตรงๆ ว่าคืออะไร', /ตรวจไม่ครบ/.test(src));
}

console.log('\n4) 💰 ความต่างที่แตะเงิน ต้องแยกออกมา');
{
  const { moneyHit } = require('./pg_diff_check.js');
  const cols = { TotalDue: 'total_due', Note: 'note', StudentID: 'student_id' };
  const MONEY = ['total_due'];
  const d = (o) => Object.assign({ insert: [], update: [], del: [] }, o);

  ok_('ใช้รายชื่อคอลัมน์เงินจากสคีมา ไม่ได้เดา', /moneyColumns\(schema\)/.test(src));
  eq('ยอดเงินต่าง → รายงานพร้อมชื่อคอลัมน์',
    moneyHit('billing', d({ update: [{ changed: ['TotalDue'] }] }), cols, MONEY),
    { table: 'billing', cols: ['TotalDue'], gaps: 0 });
  eq('CONTROL: หมายเหตุต่าง ไม่ใช่เรื่องเงิน',
    moneyHit('billing', d({ update: [{ changed: ['Note'] }] }), cols, MONEY), null);
  /* 🔴 บิลที่มีอยู่ฝั่งเดียว ไม่มี "คอลัมน์ที่ต่าง" เลย — มันคือใบแจ้งหนี้ทั้งใบที่หายไป
   * รายงานว่า "ไม่มีคอลัมน์เงินต่าง" จะเป็นความจริงที่ไร้ประโยชน์ */
  eq('🔴 บิลหายทั้งใบ → นับเป็นเรื่องเงิน แม้ไม่มีคอลัมน์ไหนต่าง',
    moneyHit('billing', d({ del: [{ id: 'x' }] }), cols, MONEY),
    { table: 'billing', cols: [], gaps: 1 });
  eq('CONTROL: ตารางที่ไม่มีคอลัมน์เงินเลย → ไม่เกี่ยว',
    moneyHit('classes', d({ del: [{ id: 'x' }], update: [{ changed: ['Note'] }] }), cols, []), null);
  eq('ทั้งสองอย่างพร้อมกัน → รายงานทั้งคู่',
    moneyHit('billing', d({ insert: [{}], update: [{ changed: ['TotalDue', 'Note'] }] }), cols, MONEY),
    { table: 'billing', cols: ['TotalDue'], gaps: 1 });
  ok_('พิมพ์แยกเป็นหัวข้อของตัวเอง', /💰🔴 ความต่างที่แตะคอลัมน์เงิน/.test(src));
  ok_('...และบอกชื่อคอลัมน์ ไม่ใช่แค่จำนวน', /คอลัมน์ ' \+ h\.cols\.join/.test(src));
}

console.log('\n5) 🔒 ตรวจอย่างเดียว ไม่แก้อะไร');
{
  /* A checker that repairs what it finds has destroyed the evidence of the bug it just hid — and
   * would also make the streak meaningless, because it could never be anything but clean. */
  ok_('🔴 ไม่มี insert / update / delete ลง Postgres เลย',
    !/\binsert into\b/i.test(src) && !/\bupdate .* set\b/i.test(src) && !/\bdelete from\b/i.test(src));
  ok_('...และบอกไว้บนหน้าจอว่าอ่านอย่างเดียว', /อ่านอย่างเดียว/.test(src));
  ok_('ใช้ตัวเทียบตัวเดียวกับตัวซิงก์ ไม่ได้เขียนใหม่', /require\('\.\/pg_sync\.js'\)/.test(src) && /diffTable/.test(src));
}

console.log('\n6) 📒 สมุดบันทึกผลการตรวจ');
{
  ok_('หนึ่งวันหนึ่งบรรทัด — รันซ้ำวันเดิมต้องทับ ไม่ใช่เพิ่ม',
    /L\.days\.filter\(d => d\.date !== entry\.date\)/.test(src));
  ok_('เก็บย้อนหลังแบบมีขอบเขต', /slice\(-120\)/.test(src));
  /* 🔴 the ledger will hold table names and difference counts about a real school — it belongs in
   * secrets/, which is gitignored, not in docs/ */
  ok_('🔴 เก็บไว้ใน secrets/ (นอก git)', /secrets', 'diff_history\.json'/.test(src));
  const ig = R('.gitignore');
  ok_('...และ .gitignore กันไว้จริง', /^secrets\/\*$/m.test(ig));
  const out = render({ days: [day('2026-10-13', { clean: true })] });
  ok_('รายงานอ่านออกเป็นภาษาคน', /เหมือนกันติดต่อกัน 1 วัน/.test(out));
  const out14 = render({ days: Array.from({ length: 14 }, (_, i) => day('2026-10-' + String(i + 1).padStart(2, '0'), { clean: true })) });
  /* 14 วันเป็นเกณฑ์ที่เสนอ ไม่ใช่กฎที่โค้ดบังคับ — และต้องคร่อมรอบเงินเดือนกับสิ้นเดือน
   * เพราะนั่นคือสองวันที่ตัวเลขขยับมากที่สุดในเดือน */
  ok_('ถึง 14 วันแล้วบอกว่าถึงเกณฑ์', /ถึงเกณฑ์/.test(out14));
  ok_('...และก่อนหน้านั้นบอกว่ายังไม่ถึง พร้อมเงื่อนไข', /คร่อมรอบเงินเดือน/.test(out));
}

console.log('\n7) รหัสผลลัพธ์ — ให้ตัวตั้งเวลาอ่านได้');
{
  ok_('เหมือนกันหมด → 0', /process\.exit\(clean \? 0 : 1\)/.test(src));
  ok_('ตรวจไม่ได้ → 2 (คนละเรื่องกับ "ต่าง")', /process\.exit\(2\)/.test(src));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
