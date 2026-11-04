/**
 * tools/test_pg_sync_schema.js — the tool that repairs staging must read the schema file correctly
 *   node tools/test_pg_sync_schema.js          (offline — no database)
 *
 * Week 2 (2026-11-04), running pg_sync_schema against staging, its column reader was found to drop
 * three kinds of column without a word:
 *   · a digit in the name     daily_journal.photo1, ot_records.step1_by
 *   · a trailing `-- comment` tenant.code
 *   · a quoted default        tenant.status … default 'ACTIVE'
 * A column it cannot see is "missing" in the file — and its live twin then looks like a STRAY, which
 * on an empty table means the tool rebuilds the table. So this pins the reader, and the safety rules
 * the apply step relies on.
 */
const fs = require('fs'), path = require('path');
const { statements, wantColumns } = require('./pg_sync_schema');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }

const sql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'schema', '001_init.sql'), 'utf8').replace(/\r\n/g, '\n');
const W = wantColumns(statements(sql));

console.log('\n1) อ่านคอลัมน์ได้ครบ');
ok_('ชื่อที่มีตัวเลข: daily_journal.photo1', !!(W.daily_journal && W.daily_journal.photo1));
ok_('ชื่อที่มีตัวเลข: ot_records.step1_by', !!(W.ot_records && W.ot_records.step1_by));
ok_('บรรทัดที่มีคอมเมนต์ต่อท้าย: tenant.code', !!(W.tenant && W.tenant.code));
ok_("ค่าเริ่มต้นในเครื่องหมายคำพูด: tenant.status", !!(W.tenant && W.tenant.status));
ok_('ตารางใหม่ของสัปดาห์ 2 อ่านได้: class_cover.from / to', !!(W.class_cover && W.class_cover.from && W.class_cover.to));
/* every column a create-table line declares must be seen; count the declaration lines directly */
let missed = [];
for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
  const declared = m[2].split('\n').map(l => l.replace(/--.*$/, '').trim()).filter(l => /^"?[a-z0-9_]+"?\s+[a-z]/.test(l) && !/^(primary|unique|constraint|foreign)\b/.test(l))
    .map(l => l.match(/^"?([a-z0-9_]+)"?/)[1]).filter(c => !/^(id|seq|tenant_id)$/.test(c));
  declared.forEach(c => { if (!W[m[1]] || !W[m[1]][c]) missed.push(m[1] + '.' + c); });
}
ok_('🔴 ไม่มีคอลัมน์ใดในไฟล์ที่ตัวอ่านมองไม่เห็น' + (missed.length ? '  → ' + missed.slice(0, 8).join(' ') : ''), missed.length === 0);

console.log('\n2) 🔴 กติกาความปลอดภัยของขั้น --apply');
const src = fs.readFileSync(path.join(__dirname, 'pg_sync_schema.js'), 'utf8');
ok_('สร้างตารางใหม่เฉพาะตารางว่าง — และเช็กซ้ำภายใต้ lock', /if \(x\.rows\)[\s\S]{0,120}continue;/.test(src) && /lock table ' \+ x\.t[\s\S]{0,160}if \(await hasRows\(x\.t\)\)/.test(src));
ok_('เปลี่ยนชนิดเฉพาะคอลัมน์ที่ว่าง — และเช็กซ้ำภายใต้ lock', /if \(x\.filled\)[\s\S]{0,120}continue;/.test(src) && /lock table ' \+ x\.t[\s\S]{0,200}is not null\) e'/.test(src));
ok_('ไม่มี drop column และไม่มี cascade', !/drop column/i.test(src) && !/cascade/i.test(src));
ok_('ค่าเดิมไม่ถูกแปลงเดาเอา — using null (คอลัมน์ว่างอยู่แล้ว)', /type ' \+ x\.want \+ ' using null'/.test(src));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
