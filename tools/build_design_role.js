/* build_design_role.js — ประกอบหน้าม็อกอัป "หน้าย่อย" ของแต่ละ Role ให้เป็นไฟล์ HTML ที่จบในตัว
 *
 *   node tools/build_design_role.js parent      → design/allpay-parent-screens.html
 *
 * ทำไมต้องประกอบ: html_to_figma รับเฉพาะเอกสารที่จบในตัว (ไม่ดึง CSS ภายนอก) แต่เราไม่อยากคัดลอก
 * ชุดส่วนประกอบ AllPay + iOS 18 ไปไว้ในทุกไฟล์ — คัดลอกแล้วจะเริ่มต่างกันทีละนิดเหมือนที่หน้าแอปเป็นอยู่
 * (docs/UI_AUDIT.md) · จึงมีต้นฉบับเดียว:
 *   - CSS หลัก  = <style> ใน design/theme-allpay-parent.html (ชุดที่ ผอ. อนุมัติ 30 ต.ค.)
 *   - CSS เพิ่ม = design/allpay-extra.css (ฟอร์ม · แผ่นล่าง · สถานะ)
 *   - เนื้อหา   = design/screens/<role>.html (เฉพาะ .grid ของโทรศัพท์)
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'design');
const role = process.argv[2];
const TITLES = { parent: 'ผู้ปกครอง', teacher: 'คุณครู', leader: 'หัวหน้าครู', admin: 'แอดมิน', observer: 'ผู้สังเกตการณ์', guest: 'ผู้ใช้ทั่วไป / ใบสมัคร' };
if (!TITLES[role]) { console.error('usage: node tools/build_design_role.js <' + Object.keys(TITLES).join('|') + '>'); process.exit(1); }

const base = fs.readFileSync(path.join(D, 'theme-allpay-parent.html'), 'utf8');
const m = /<style>([\s\S]*?)<\/style>/.exec(base);
if (!m) { console.error('no <style> in theme-allpay-parent.html'); process.exit(1); }
const extra = fs.readFileSync(path.join(D, 'allpay-extra.css'), 'utf8');
const body = fs.readFileSync(path.join(D, 'screens', role + '.html'), 'utf8');
const n = (body.match(/class="phone"/g) || []).length;

const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" />
<title>Atom Nursery — AllPay + iOS 18 · หน้าย่อย${TITLES[role]}</title>
<!-- ไฟล์นี้ถูกสร้างโดย tools/build_design_role.js ${role} · แก้ที่ design/screens/${role}.html แล้วสร้างใหม่ -->
<style>${m[1]}
${extra}</style></head>
<body><div class="wrap">
<h1>หน้าย่อย · ${TITLES[role]} (${n} หน้าจอ)</h1>
<p class="lede">ต่อจากแท็บหลักใน theme-allpay-*.html · ฟอร์ม แผ่นล่าง และสถานะต่าง ๆ ที่แอปจริงมีแต่ยังไม่มีแบบ ·
รายการทั้งหมดอยู่ใน <code>docs/ROLE_FUNCTIONS.md</code> · ป้ายข้อความยกมาจากแอปจริง v509</p>
<div class="grid">
${body}
</div></div></body></html>`;
const out = path.join(D, 'allpay-' + role + '-screens.html');
fs.writeFileSync(out, html);
console.log(path.relative(ROOT, out) + ': ' + n + ' phones, ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
