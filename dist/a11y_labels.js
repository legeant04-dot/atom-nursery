/* One-off: give every icon-only <button> in webapp/app.js an accessible name.
 *
 * A screen reader announces "pencil" for <button>✏️</button> — the label has to be explicit.
 * Done at the source rather than at runtime so it costs nothing per render (the whole point of
 * Phase 3 is to REMOVE runtime DOM passes, not add one).
 *
 * Labels are bilingual through the same EN() ternary the rest of app.js uses, and `title` is set
 * alongside aria-label so desktop users get a tooltip too.
 */
const fs = require('fs');

const FILE = 'webapp/app.js';
let src = fs.readFileSync(FILE, 'utf8');

const L = (th, en) => '${EN()?' + JSON.stringify(en) + ':' + JSON.stringify(th) + '}';

// [icon, handler pattern (null = any), thai, english]
const RULES = [
  ['✏️', null, 'แก้ไข', 'Edit'],
  ['🗑️', null, 'ลบ', 'Delete'],
  ['✕', /T_approveOT\([^)]*reject/, 'ปฏิเสธ', 'Reject'],
  ['✕', null, 'ลบ', 'Delete'],
  ['✔', null, 'อนุมัติ', 'Approve'],
  ['🎤', null, 'พูดเพื่อกรอกข้อความ', 'Voice input'],
  ['◀', null, 'เดือนก่อนหน้า', 'Previous month'],
  ['▶', null, 'เดือนถัดไป', 'Next month'],
  ['💾', null, 'บันทึก', 'Save'],
  ['♻️', null, 'กู้คืน', 'Restore'],
  ['🚫', null, 'ยกเลิก', 'Cancel'],
  ['📝', null, 'ประเมิน', 'Assess'],
  ['📒', null, 'สมุดบันทึกประจำวัน', 'Daily journal'],
  ['📍', null, 'เช็คอิน', 'Check in'],
  ['📎', null, 'แนบสลิป', 'Attach slip'],
  ['💵', null, 'แจ้งชำระเงินสด', 'Pay cash'],
  ['👁️', /PW_toggle/, 'แสดง/ซ่อนรหัสผ่าน', 'Show or hide password'],
  ['👁️', null, 'ดูบันทึกประจำวัน', 'View journal'],
  ['🏖️', null, 'แจ้งลา', 'Report leave'],
];

let added = 0;
const skipped = [];

// <button ...>ICON</button> where the body is nothing but the icon (plus stray spaces)
src = src.replace(/<button([^>]*)>([^<]{1,8})<\/button>/g, (whole, attrs, body) => {
  const icon = body.trim();
  if (!icon || /[a-zA-Z฀-๿]/.test(icon)) return whole;   // has real text already
  if (/aria-label/.test(attrs)) return whole;                       // already labelled
  const rule = RULES.find(r => r[0] === icon && (!r[1] || r[1].test(attrs)));
  if (!rule) { skipped.push(icon + '  ' + attrs.slice(0, 70)); return whole; }
  added++;
  return `<button${attrs} aria-label="${L(rule[2], rule[3])}" title="${L(rule[2], rule[3])}">${body}</button>`;
});

fs.writeFileSync(FILE, src);
console.log('labelled:', added);
if (skipped.length) { console.log('\nNOT labelled (no rule):'); skipped.forEach(s => console.log('  ' + s)); }
