/**
 * tools/test_pg_migrate.js — the Sheets → Postgres move, and the money report the ผอ. signs off.
 *   node tools/test_pg_migrate.js
 *
 * Offline: the migrator is pure apart from `load()`, so everything below runs on a FABRICATED
 * export. That is deliberate and not only convenience — the school's standing rule is that no real
 * student data goes near Postgres until the PDPA agreement exists (Phase 1.5), so the tool has to
 * be provable without it.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT THIS IS GUARDING
 *
 * §1  a column with nowhere to land must be REPORTED, not dropped in silence
 * §2  the two AUDIT_LOGs must not land in the same table
 * §3  💰 the float → numeric differences must be found, to the satang, and must be findable
 * §4  blank is blank — a money cell that is empty must not become 0
 * §5  the writer refuses by default: --dry unless somebody asked for a tenant
 */
const fs = require('fs'), path = require('path');
const M = require('./pg_migrate.js');

const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function eq(l, got, want) {
  const o = JSON.stringify(got) === JSON.stringify(want);
  console.log((o ? '  ok   ' : '  FAIL ') + l + (o ? '' : '\n         got =' + JSON.stringify(got) + '\n         want=' + JSON.stringify(want)));
  o ? pass++ : fail++;
}
function ok_(l, c) { console.log((c ? '  ok   ' : '  FAIL ') + l); c ? pass++ : fail++; }

const schema = M.targetSchema();

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) ชีต → ตาราง และคอลัมน์ที่ไม่มีที่ลงต้องถูกรายงาน');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  ok_('อ่านสคีมาปลายทางจาก 001_init.sql ได้', Object.keys(schema).length > 50);
  ok_('...และรู้ชนิดคอลัมน์ด้วย ไม่ใช่แค่ชื่อ', /numeric\(12,2\)/.test(schema.payroll.base_salary));

  const data = {
    MAIN: { STUDENTS: [{ StudentID: 'S1', Name: 'เด็กหนึ่ง', OTRate: 100, ThisDoesNotExist: 'x' }] },
    HR: { STAFF: [{ StaffID: 'T1', Name: 'ครูหนึ่ง', BaseSalary: 16000 }] }
  };
  const { plan, unknownTables, unknownCols } = M.planLoad(data, schema);
  eq('ชีตที่รู้จักเข้าแผนครบ', plan.map(p => p.table).sort(), ['staff', 'students']);
  eq('ไม่มีชีตที่หาตารางไม่เจอ', unknownTables, []);
  /* 🔴 THE WHOLE POINT OF PHASE 2.2. A column in the export with nowhere to land is data that does
   * not arrive, and `insert` never complains about a key you did not ask it to write. */
  eq('🔴 คอลัมน์ที่ไม่มีที่ลง ต้องถูกบอกชื่อออกมา', unknownCols, { 'MAIN.STUDENTS': ['ThisDoesNotExist'] });
  eq('...และคอลัมน์ที่มีที่ลง ถูกจับคู่เป็น snake_case', plan.find(p => p.table === 'students').cols,
    { StudentID: 'student_id', Name: 'name', OTRate: 'otrate' });
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 AUDIT_LOG มีสองชีต และต้องไม่ลงตารางเดียวกัน');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  eq('ของ MAIN → audit_log', M.tableFor('MAIN', 'AUDIT_LOG'), 'audit_log');
  eq('🔴 ของ HR → hr_audit_log', M.tableFor('HR', 'AUDIT_LOG'), 'hr_audit_log');
  ok_('...และทั้งสองตารางมีอยู่จริงในสคีมา', !!schema.audit_log && !!schema.hr_audit_log);
  // CONTROL — the prefix applies to the colliding sheet ONLY, not to every HR sheet
  eq('CONTROL: ชีต HR อื่นๆ ไม่ถูกเติม hr_', M.tableFor('HR', 'STAFF'), 'staff');

  const data = { MAIN: { AUDIT_LOG: [{ UserID: 'u1', Action: 'VIEW' }] },
                 HR: { AUDIT_LOG: [{ UserID: 'u2', Action: 'VIEW_PAYROLL' }] } };
  const { plan } = M.planLoad(data, schema);
  eq('🔴 สองชีตแยกเป็นสองตารางจริง', plan.map(p => p.table).sort(), ['audit_log', 'hr_audit_log']);
  /* The MAIN audit log records access to school data; the HR one is the PDPA access log for
   * salaries and national IDs. Merging them would dissolve an access boundary into a convenience —
   * somebody allowed to read one must not thereby learn who has been looking at payroll. */
  ok_('...และ migrator ใช้กฎเดียวกับตัวสร้างสคีมา',
    /HR_PREFIXED = new Set\(\['AUDIT_LOG'\]\)/.test(R('tools/pg_migrate.js')) &&
    /HR_PREFIXED = new Set\(\['AUDIT_LOG'\]\)/.test(R('tools/schema_inventory.js')));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) 💰 ยอดรวมคอลัมน์ — ที่เดียวที่เงินขยับได้จริง');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* 🔴 ทำไมถึงวัด "ยอดรวม" ไม่ใช่ "รายแถว"
   *
   * แอปปัด 2 ตำแหน่งตอนแสดงผลมาตลอด · ไม่เคยมีใครเห็น 6899.999999999999 — ทุกคนเห็น ฿6,900
   * **รายแถวจึงไม่มีอะไรเปลี่ยนในสายตาคนเลย** ไม่ว่าจะย้ายหรือไม่ย้าย
   *
   * ที่เปลี่ยนได้จริงคือ **ผลรวม** — ชีตบวกเลขที่มีเศษ Postgres บวกเลขที่ตรง
   * บวกบิลหลายใบแล้วสองฝั่งต่างกันเป็นสตางค์ และยอดรวมรายเดือนคือตัวเลขที่ ผอ. เคยเห็นจริง */
  const data = { MAIN: { BILLING: [
      { BillingID: 'B1', Amount: 6899.999999999999 },     // เศษทศนิยม — เงินเท่าเดิม
      { BillingID: 'B2', Amount: 6900 },                  // ตรงอยู่แล้ว
      { BillingID: 'B3', Amount: 1200.005 },              // ครึ่งสตางค์ — ตัวที่ทำให้ยอดรวมขยับ
      { BillingID: 'B4', Amount: '' },                    // ว่าง — ไม่ใช่ 0
      { BillingID: 'B5', Amount: 'ยังไม่ระบุ' }             // ข้อความปนมา
    ] }, HR: {} };
  const rep = M.moneyReport(data, schema);
  const col = rep.columns.find(c => c.column === 'billing.amount');

  eq('นับเฉพาะแถวที่เป็นตัวเลข (ว่างและข้อความไม่ถูกนับ)', col.rows, 3);
  ok_('ยอดรวมเดิมคือผลบวกของค่าที่อยู่ในชีตจริงๆ', Math.abs(col.before - 15000.005) < 1e-9);
  eq('ยอดรวมใหม่คือผลบวกของค่าที่ปัดแล้ว', col.after, 15000.01);
  /* 🔴 ส่วนต่างต้องไม่ถูกปัด — ปัด 0.005 เป็น 0.01 คือรายงานเกินจริงเท่าตัว
   * (เวอร์ชันแรกปัด ทำให้บรรทัดสรุป ซึ่งเป็นตัวเลขที่คนเอาไปพูดต่อ ผิดไป 2 เท่า) */
  ok_('🔴 ส่วนต่างไม่ถูกปัด', Math.abs(col.shift - 0.005) < 1e-9);
  eq('มี 1 คอลัมน์ที่ยอดรวมขยับ', rep.moved.map(c => c.column), ['billing.amount']);

  console.log('\n   — CONTROL: เศษทศนิยมล้วนๆ ต้องไม่ถูกนับว่าเงินขยับ');
  /* 6899.999999999999 + 6900 ต่างจากค่าที่ปัดแล้วราว 1e-12 บาท · ไม่ใช่เงิน
   * และต้องไม่ไปโผล่ในรายการที่ขอให้ ผอ. อนุมัติ */
  const noise = M.moneyReport({ MAIN: { BILLING: [
      { BillingID: 'N1', Amount: 6899.999999999999 }, { BillingID: 'N2', Amount: 6900 }] }, HR: {} }, schema);
  eq('🔴 เศษระดับ 1e-12 ไม่นับว่ายอดรวมขยับ', noise.moved.length, 0);
  eq('...แต่ยังบอกว่ามีค่าที่ถูกเก็บให้ตรงขึ้นกี่แถว', noise.tidiedRows, 1);
  ok_('...และรายงานพูดว่าไม่มีอะไรต้องอนุมัติ',
    /ไม่มียอดรวมคอลัมน์ไหนขยับเลย/.test(M.renderReport(noise, { file: 'x' })));

  console.log('\n   — CONTROL: ชีตที่สะอาดจริงๆ');
  const clean = M.moneyReport({ MAIN: { BILLING: [{ BillingID: 'C', Amount: 6900 }, { BillingID: 'D', Amount: 1250.5 }] }, HR: {} }, schema);
  eq('ไม่มีอะไรเปลี่ยนเลย', [clean.moved.length, clean.totalShift, clean.tidiedRows], [0, 0, 0]);

  console.log('\n   — ค่าที่ใหญ่เกินช่อง และช่องที่ไม่ใช่ตัวเลข');
  const big = M.moneyReport({ MAIN: { BILLING: [{ BillingID: 'X', Amount: 99999999999.5 }] }, HR: {} }, schema);
  eq('🔴 เกิน numeric(12,2) ถูกแยกออกมาเตือน', big.tooBig.length, 1);
  ok_('...พร้อมบอกว่าแถวไหน', /billing\.amount row 2/.test(big.tooBig[0]));
  eq('🔴 ช่องเงินที่ว่าง ไม่ถูกรายงานว่าผิด', rep.notNum.filter(s => /row 5/.test(s)), []);
  eq('...แต่ข้อความที่ไม่ใช่ตัวเลข ถูกรายงาน', rep.notNum.length, 1);
  ok_('...โดยบอกตำแหน่งให้ไปแก้ได้', /billing\.amount row 6/.test(rep.notNum[0]));

  console.log('\n   — รายงานที่ ผอ. อ่าน');
  const md = M.renderReport(rep, { file: 'atom_export_test.json', exportedAt: '2026-10-10' });
  ok_('อธิบายว่าทำไมตัวเลขถึงเปลี่ยน ไม่ใช่โยนตารางให้', /ทศนิยมฐานสอง/.test(md));
  ok_('🔴 บอกตรงๆ ว่ารายแถวไม่มีอะไรเปลี่ยนในสายตาคน',
    /ไม่เคยมีใครเห็นเลข/.test(md) && /ยอดรวม/.test(md));
  ok_('...บอกว่าต้องอนุมัติ', /ต้องอนุมัติ/.test(md));
  /* 🔴 รูปแบบตัวเลขต้องไม่กลบสิ่งที่รายงานอยู่
   * เวอร์ชันแรกพิมพ์ทุกช่องเป็น 2 ตำแหน่ง ได้บรรทัดว่า "เดิม 15,000.01 | ใหม่ 15,000.01 | ต่าง 0.01"
   * — เลขสองตัวเท่ากันข้างๆ ส่วนต่าง · การปัดของรายงานเองไปกลืนสิ่งที่รายงานจะบอก */
  ok_('🔴 ยอดรวมเดิมแสดงทศนิยมพอให้เห็นส่วนต่าง', /15,000\.005/.test(md));
  ok_('...และส่วนต่างไม่ถูกปัดขึ้นเป็น 0.01', /\*\*0\.005\*\*/.test(md));
  ok_('มีตารางยอดรวมทุกคอลัมน์ให้ตรวจทาน', /ยอดรวมทุกคอลัมน์ที่มีข้อมูล/.test(md));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) ค่าที่เขียนลงจริง — ชนิดต้องตรง และว่างต้องเป็น null');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  eq('🔴 ว่าง → null ไม่ใช่ 0', M.encode_('', 'numeric(12,2)'), null);
  eq('ตัวเลขถูกปัดเป็น 2 ตำแหน่งตอนเขียน', M.encode_(6899.999999999999, 'numeric(12,2)'), 6900);
  eq('...และ 1200.005 → 1200.01', M.encode_(1200.005, 'numeric(12,2)'), 1200.01);
  eq('ข้อความที่มีจุลภาค ยังอ่านเป็นตัวเลขได้', M.encode_('1,250.50', 'numeric(12,2)'), 1250.5);
  eq('YES → true', M.encode_('YES', 'boolean'), true);
  eq('ว่าง (boolean) → null ไม่ใช่ false', M.encode_('', 'boolean'), null);
  eq("'NO' → false", M.encode_('NO', 'boolean'), false);
  /* CONTROL — a text column must survive untouched, including a leading zero. encode_ coercing
   * everything that looks numeric would turn bank account '0012345' into 12345. */
  eq('CONTROL: เลขบัญชีที่เป็น text ไม่ถูกแปลง', M.encode_('0012345', 'text'), '0012345');
  eq('object → JSON (คอลัมน์ที่เก็บรายการ)', M.encode_({ a: 1 }, 'text'), '{"a":1}');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) 🔴 ไม่เขียนฐานข้อมูลโดยไม่ได้ตั้งใจ');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const src = R('tools/pg_migrate.js');
  ok_('🔴 ไม่ใส่ --tenant = โหมด dry โดยอัตโนมัติ',
    /const DRY = argv\.indexOf\('--dry'\) >= 0 \|\| argv\.indexOf\('--tenant'\) < 0;/.test(src));
  ok_('...และ dry ไม่แตะฐานข้อมูลเลย — ไม่ได้ require pg_lib ก่อนถึงตรงนั้นด้วย',
    /if \(DRY\) \{[\s\S]{0,400}return;\n  \}/.test(src) &&
    src.indexOf("require('./pg_lib.js')") > src.indexOf('if (DRY) {'));
  ok_('🔴 ค่าที่ใหญ่เกินช่อง หยุดก่อนเขียน', /if \(rep\.tooBig\.length\) \{[\s\S]{0,260}process\.exit\(1\)/.test(src));
  ok_('...และบอกเรื่อง PDPA ตรงจุดที่คนจะอ่าน', /PDPA/.test(src) && /ผอ\. อนุมัติแล้ว/.test(src));

  // the exporter has no route — this is the control on the thing that would hurt most
  const code = R('src/Code.gs');
  ok_('🔴 ตัวส่งออกไม่มี route ในแอป — ต้องรันจาก editor เท่านั้น',
    !/exportAllForMigration/.test(code) && /function exportAllForMigration/.test(R('src/Export.gs')));
  ok_('...และบอกเหตุผลไว้ในไฟล์', /THERE IS NO ROUTE TO THIS FILE/.test(R('src/Export.gs')));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
console.log('\n3) 💰 ยอดรวมคอลัมน์ — ที่เดียวที่เงินขยับได้จริง');
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  /* 🔴 ทำไมถึงวัด "ยอดรวม" ไม่ใช่ "รายแถว"
   *
   * แอปปัด 2 ตำแหน่งตอนแสดงผลมาตลอด · ไม่เคยมีใครเห็น 6899.999999999999 — ทุกคนเห็น ฿6,900
   * **รายแถวจึงไม่มีอะไรเปลี่ยนในสายตาคนเลย** ไม่ว่าจะย้ายหรือไม่ย้าย
   *
   * ที่เปลี่ยนได้จริงคือ **ผลรวม** — ชีตบวกเลขที่มีเศษ Postgres บวกเลขที่ตรง
   * บวกบิลหลายใบแล้วสองฝั่งต่างกันเป็นสตางค์ และยอดรวมรายเดือนคือตัวเลขที่ ผอ. เคยเห็นจริง */
  const data = { MAIN: { BILLING: [
      { BillingID: 'B1', Amount: 6899.999999999999 },     // เศษทศนิยม — เงินเท่าเดิม
      { BillingID: 'B2', Amount: 6900 },                  // ตรงอยู่แล้ว
      { BillingID: 'B3', Amount: 1200.005 },              // ครึ่งสตางค์ — ตัวที่ทำให้ยอดรวมขยับ
      { BillingID: 'B4', Amount: '' },                    // ว่าง — ไม่ใช่ 0
      { BillingID: 'B5', Amount: 'ยังไม่ระบุ' }             // ข้อความปนมา
    ] }, HR: {} };
  const rep = M.moneyReport(data, schema);
  const col = rep.columns.find(c => c.column === 'billing.amount');

  eq('นับเฉพาะแถวที่เป็นตัวเลข (ว่างและข้อความไม่ถูกนับ)', col.rows, 3);
  ok_('ยอดรวมเดิมคือผลบวกของค่าที่อยู่ในชีตจริงๆ', Math.abs(col.before - 15000.005) < 1e-9);
  eq('ยอดรวมใหม่คือผลบวกของค่าที่ปัดแล้ว', col.after, 15000.01);
  /* 🔴 ส่วนต่างต้องไม่ถูกปัด — ปัด 0.005 เป็น 0.01 คือรายงานเกินจริงเท่าตัว
   * (เวอร์ชันแรกปัด และทำให้บรรทัดสรุปซึ่งเป็นตัวเลขที่คนเอาไปพูดต่อ ผิดไป 2 เท่า) */
  ok_('🔴 ส่วนต่างไม่ถูกปัด', Math.abs(col.shift - 0.005) < 1e-9);
  eq('มี 1 คอลัมน์ที่ยอดรวมขยับ', rep.moved.map(c => c.column), ['billing.amount']);

  console.log('\n   — CONTROL: เศษทศนิยมล้วนๆ ต้องไม่ถูกนับว่าเงินขยับ');
  /* 6899.999999999999 + 6900 = 13799.999999999998 → ปัดแล้ว 13800.00
   * ต่างกัน 2e-12 บาท · ไม่ใช่เงิน และต้องไม่ไปโผล่ในรายการที่ต้องอนุมัติ */
  const noise = M.moneyReport({ MAIN: { BILLING: [
      { BillingID: 'N1', Amount: 6899.999999999999 }, { BillingID: 'N2', Amount: 6900 }] }, HR: {} }, schema);
  eq('🔴 เศษระดับ 1e-12 ไม่นับว่ายอดรวมขยับ', noise.moved.length, 0);
  eq('...แต่ยังบอกว่ามีค่าที่ถูกเก็บให้ตรงขึ้นกี่แถว', noise.tidiedRows, 1);
  ok_('...และรายงานพูดว่าไม่มีอะไรต้องอนุมัติ',
    /ไม่มียอดรวมคอลัมน์ไหนขยับเลย/.test(M.renderReport(noise, { file: 'x' })));

  console.log('\n   — CONTROL: ชีตที่สะอาดจริงๆ');
  const clean = M.moneyReport({ MAIN: { BILLING: [{ BillingID: 'C', Amount: 6900 }, { BillingID: 'D', Amount: 1250.5 }] }, HR: {} }, schema);
  eq('ไม่มีอะไรเปลี่ยนเลย', [clean.moved.length, clean.totalShift, clean.tidiedRows], [0, 0, 0]);

  console.log('\n   — และค่าที่ใหญ่เกินช่องต้องหยุดการย้าย ไม่ใช่ปล่อยให้ insert ตาย');
  const big = M.moneyReport({ MAIN: { BILLING: [{ BillingID: 'X', Amount: 99999999999.5 }] }, HR: {} }, schema);
  eq('🔴 เกิน numeric(12,2) ถูกแยกออกมาเตือน', big.tooBig.length, 1);
  ok_('...พร้อมบอกว่าแถวไหน', /billing\.amount row 2/.test(big.tooBig[0]));
  eq('🔴 ช่องเงินที่ว่าง ไม่ถูกรายงานว่าผิด', rep.notNum.filter(s => /row 5/.test(s)), []);
  eq('...แต่ข้อความที่ไม่ใช่ตัวเลข ถูกรายงาน', rep.notNum.length, 1);
  ok_('...โดยบอกตำแหน่งให้ไปแก้ได้', /billing\.amount row 6/.test(rep.notNum[0]));

  console.log('\n   — รายงานที่ ผอ. อ่าน');
  const md = M.renderReport(rep, { file: 'atom_export_test.json', exportedAt: '2026-10-10' });
  ok_('อธิบายว่าทำไมตัวเลขถึงเปลี่ยน ไม่ใช่โยนตารางให้', /ทศนิยมฐานสอง/.test(md));
  ok_('🔴 บอกตรงๆ ว่ารายแถวไม่มีอะไรเปลี่ยนในสายตาคน',
    /ไม่เคยมีใครเห็นเลข/.test(md) && /ที่เปลี่ยนได้จริงคือ "ยอดรวม"/.test(md));
  ok_('...บอกว่าต้องอนุมัติ', /ต้องอนุมัติ/.test(md));
  /* 🔴 รูปแบบตัวเลขต้องไม่กลบสิ่งที่รายงานอยู่
   * เวอร์ชันแรกพิมพ์ทุกช่องเป็น 2 ตำแหน่ง ได้บรรทัดว่า "เดิม 15,000.01 | ใหม่ 15,000.01 | ต่าง 0.01"
   * — เลขสองตัวเท่ากันข้างๆ ส่วนต่าง · การปัดของรายงานเองไปกลืนสิ่งที่รายงานจะบอก */
  ok_('🔴 ยอดรวมเดิมแสดงทศนิยมพอให้เห็นส่วนต่าง', /15,000\.005/.test(md));
  ok_('...และส่วนต่างไม่ถูกปัดขึ้นเป็น 0.01', /\*\*0\.005\*\*/.test(md));
  ok_('มีตารางยอดรวมทุกคอลัมน์ให้ตรวจทาน', /ยอดรวมทุกคอลัมน์ที่มีข้อมูล/.test(md));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
