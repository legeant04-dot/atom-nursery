/**
 * tools/test_audit_rules.js — ตัวตรวจระบบเองก็ต้องถูกตรวจ
 *   node tools/test_audit_rules.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 บทเรียน 2026-10-15: "รายงานที่ร้องหมาป่า คือรายงานที่ไม่มีใครอ่าน"
 *
 * ตัวตรวจความพร้อมของโรงเรียนใหม่ (Phase 4.1) รันจริงครั้งแรกแล้วรายงาน 4 ข้อ ซึ่ง 3 ข้อเป็นค่าที่
 * ถูกต้องของโรงเรียนเราเอง — ถ้าปล่อยไว้ ครั้งหน้าคนอ่านจะกดข้ามทั้งหน้า รวมถึงข้อที่สี่ที่จริง
 *
 * และ tools/audit_system.js ก็เจอกับตัวเองแบบเดียวกันในการรันครั้งแรก: รายงาน payOT/payCharge/
 * payPrepay ว่า "ไม่มีด่าน" ทั้งที่การตรวจอยู่ในฟังก์ชันที่มันเรียกต่ออีกชั้น
 *
 * ไฟล์นี้จึงพิสูจน์สองอย่างของทุกกฎ ไม่ใช่อย่างเดียว:
 *   ① จับของผิดได้จริง  (ปลูกตัวอย่างที่ผิดลงไป แล้วต้องเจอ)
 *   ② ไม่จับของที่ถูก   (ปลูกตัวอย่างที่ถูกลงไป แล้วต้องเงียบ)
 *
 * ข้อ ② สำคัญกว่าข้อ ① — กฎที่จับทุกอย่างคือกฎที่ไม่ได้บอกอะไรเลย
 */
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

/** รันตัวตรวจจริงแล้วอ่านผลเป็น JSON */
function audit(args) {
  const out = cp.execSync('node tools/audit_system.js --json ' + (args || ''), { cwd: ROOT, maxBuffer: 1 << 24 }).toString();
  return JSON.parse(out.slice(out.indexOf('{'))).findings;
}
const nowAll = audit('');
const by = r => nowAll.filter(f => f.rule === r);

console.log('\n1) ตัวตรวจต้องรันได้ และรายงานเป็นโครงสร้างที่เครื่องอ่านได้');
{
  ok_('รันแล้วได้ JSON ที่มีรายการผลตรวจ', Array.isArray(nowAll));
  ok_('ทุกข้อบอกกฎ · ความรุนแรง · ที่อยู่ · และผลถ้าไม่แก้',
    nowAll.every(f => f.rule && f.sev && f.title && f.where && typeof f.why === 'string'));
  /* 🔴 ไม่มีข้อมูลส่วนบุคคลออกมาทางรายงาน — ตัวตรวจไฟล์ PDPA ต้องไม่กลายเป็นตัวที่คัดลอกมันลง
   * terminal เสียเอง (บทเรียนจาก tools/check_export_file.js) */
  ok_('🔴 รายงานไม่มีเบอร์โทร/เลขบัตร/อีเมลของใครหลุดออกมา',
    !/\b0\d{8,9}\b|\b\d{13}\b|@gmail|@hotmail/.test(JSON.stringify(nowAll)));
}

console.log('\n2) 🔴 R1 — ช่องวันที่จากชีตเทียบแบบสตริง');
{
  // ของจริงในโค้ดวันนี้: ต้องสะอาด เพราะ v460 แทนด้วย ymdCell_ ไปหมดแล้ว
  eq('ซอร์สวันนี้ไม่มีข้อ R1 ค้าง', by('R1').length, 0);
  /* ① ปลูกของผิด — เขียนไฟล์ .gs ชั่วคราวที่มีบรรทัดแบบเดิม แล้วตัวตรวจต้องเจอ
   * ② และบรรทัดที่ใช้ ymdCell_/decodeCell_ ในไฟล์เดียวกันต้องไม่ถูกจับ */
  const tmp = path.join(ROOT, 'src', '_AuditProbe.gs');
  fs.writeFileSync(tmp,
    'function probeBad_(r) { var d = String(r.EndDate || "").slice(0, 10); return d; }\n' +
    'function probeGood_(r) { var d = ymdCell_(r.EndDate); return d; }\n' +
    'function probeAlsoGood_(r) { var d = String(decodeCell_(r.EndDate) || "").slice(0, 10); return d; }\n', 'utf8');
  let got;
  try { got = audit('--rule R1').filter(f => /_AuditProbe/.test(f.where)); }
  finally { fs.unlinkSync(tmp); }
  eq('🔴 ปลูกบรรทัดที่ผิดลงไป → ตัวตรวจต้องเจอ 1 ข้อ', got.length, 1);
  ok_('🔴 ...และต้องชี้บรรทัดที่ผิด ไม่ใช่บรรทัดที่ถูก', /_AuditProbe\.gs:1$/.test((got[0] || {}).where || ''));
}

console.log('\n3) 🔴 R2/R3 — ประตู และการนับว่าเป็นการเขียน');
{
  /* 🔴 ข้อที่พิสูจน์ว่ากฎไม่ได้ร้องหมาป่า: เส้นทางที่การตรวจสิทธิ์อยู่ใน "ฟังก์ชันที่มันเรียกต่อ"
   * ต้องไม่ถูกรายงาน · ตอนเขียนกฎครั้งแรกมันรายงานสี่ตัวนี้ผิดทั้งหมด */
  const r2 = by('R2').map(f => f.title);
  ['payOT', 'payCharge', 'payPrepay', 'uploadSlip'].forEach(a =>
    ok_('ไม่รายงาน ' + a + ' (ด่านอยู่ใน paySlipRecord_ ที่มันเรียกต่อ)', !r2.some(t => t.indexOf(': ' + a + ' ') >= 0)));
  // ...และเส้นทางที่ถูกปิดไปแล้ววันนี้ ต้องไม่กลับมาอีก
  ['deleteParent', 'confirmSlip', 'rejectSlip', 'removeStudent', 'saveStudent', 'saveParent']
    .forEach(a => ok_(a + ' มีประตูแล้ว', !r2.some(t => t.indexOf(': ' + a + ' ') >= 0)));
  const r3 = by('R3').map(f => f.title);
  ['undoBillRun', 'adjustStaffPay', 'contributionReset']
    .forEach(a => ok_(a + ' ถูกนับเป็นการเขียนแล้ว', !r3.some(t => t.indexOf(': ' + a) >= 0)));
  /* perfLog เขียนจริงและตั้งใจไม่ให้จับ lock — ต้องถูก "ยกเว้นพร้อมเหตุผล" ไม่ใช่ถูกเมิน */
  ok_('perfLog อยู่ในรายการยกเว้นที่มีเหตุผลเขียนกำกับ',
    /perfLog:\s*'[^']{40,}/.test(R('tools/audit_system.js')));
}

console.log('\n4) 📐 กติกาของตัวตรวจเอง');
{
  const src = R('tools/audit_system.js'), code = R('src/Code.gs');
  /* 🔴 ถ้า EXTRA_WRITE_RE ในตัวตรวจไม่ตรงกับของจริงใน isMutatingAction_ ตัวตรวจจะโกหกทั้งสองทาง */
  const mine = (src.match(/const EXTRA_WRITE_RE = (\/[^\n]*\/i);/) || [])[1];
  const real = (code.match(/MUTATING_RE\.test\(a\)\s*\|\|\s*(\/[^\n]*?\/i)\.test\(a\)/) || [])[1];
  eq('🔴 กติกา "อะไรคือการเขียน" ตรงกับของจริงใน Code.gs เป๊ะ', mine, real);
  /* ทุกชื่อในรายการยกเว้นต้องมีเหตุผล — รายการที่ไม่มีเหตุผล คือรายการที่ไม่มีใครตรวจซ้ำได้ */
  const block = src.slice(src.indexOf('const DOOR_EXEMPT'), src.indexOf('function ruleR2'));
  const entries = (block.match(/(\w+):\s*'/g) || []).length;
  ok_('ทุกชื่อในรายการยกเว้นประตู มีเหตุผลเขียนกำกับ', entries >= 20);
  ok_('ทุกกฎอธิบายได้ว่าถ้าไม่แก้จะเกิดอะไร', nowAll.every(f => f.sev === 'ℹ️' || f.why.length > 20));
  ok_('มีโหมดตรวจข้อมูลของโรงเรียนด้วย ไม่ใช่ตรวจแต่โค้ด', /--data/.test(src) && /function auditData/.test(src));
  ok_('--strict คืน exit code ได้ (เอาไว้ต่อกับ CI ภายหลัง)', /process\.exit\(HAS\('--strict'\)/.test(src));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
