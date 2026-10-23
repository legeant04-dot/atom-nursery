/**
 * tools/audit_functions.js — ใบงาน "รวบ / ตัด / เพิ่ม / จัดใหม่" สำหรับฟังก์ชันทั้งระบบ
 *   node tools/audit_functions.js
 *   node tools/audit_functions.js --md docs/FUNCTION_REVIEW.md
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-23: *"ขั้นตอนต่อไปในการจัดเรียง แก้ไข เพิ่ม ลด ปรับปรุง รวบรวมฟังก์ชันของเราต้องทำอะไรต่อ"*
 *
 * map_flows.js ตอบว่า "อะไรเชื่อมกับอะไร" — ตัวนี้ตอบคนละคำถาม: **อะไรควรอยู่ อะไรควรรวบ อะไรควรตัด**
 * โดยหาหลักฐานให้ ไม่ได้ตัดสินแทน การตัดสินเป็นของ ผอ.
 *
 * 🔴 ความเสี่ยงหลักของเครื่องมือแบบนี้คือ "บอกว่าตัดได้" ทั้งที่ของนั้นถูกใช้อยู่
 *
 * ร่างแรกรายงานว่ามี 49 route ที่ไม่มีใครเรียก — ในนั้นมี `parentCheckin` และ `staffCheckin` ซึ่งคือ
 * การลงเวลาเข้า-ออก ของทั้งโรงเรียน ถ้าเชื่อแล้วลบทิ้งคือระบบพังทันที เหตุเพราะตัวนับมองหาแต่
 * `api('x')` ขณะที่โค้ดจริงเรียกผ่าน `punchWithRetry('x')` — ตัวช่วยที่ลองใหม่ให้เวลาเน็ตหลุด
 *
 * ตัวนี้จึงนับ **ทุกการอ้างถึงชื่อ route ในฐานะสตริง** ทั่วทั้ง webapp/ ซึ่งเอนเอียงไปทาง
 * "นับว่าใช้อยู่" โดยตั้งใจ — ในใบงานที่เสนอให้ลบของ ความผิดพลาดที่ปลอดภัยกว่าคือการเตือนน้อยเกินไป
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), api = R('webapp/api.js'), eng = R('webapp/engine.js'), code = R('src/Code.gs');
const web = app + '\n' + api;

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

/* ── 1. ทุก route ที่มีอยู่ ─────────────────────────────────────────────────────────────────── */
const engRoutes = [...new Set([...eng.matchAll(/^    ([a-zA-Z][a-zA-Z0-9_]*):\s*(?:async\s*)?[(p]/gm)].map(m => m[1]))];
const srvRoutes = [...new Set([...code.matchAll(/^  ([a-zA-Z][a-zA-Z0-9_]*):\s*function/gm)].map(m => m[1]))];
const all = [...new Set([...engRoutes, ...srvRoutes])].sort();

/* ── 2. ถูกอ้างถึงที่ไหนบ้าง — ทุกวิธีเรียก ไม่ใช่แค่ api() ───────────────────────────────── */
const refCount = {};
for (const r of all) {
  const re = new RegExp("['\"]" + r + "['\"]", 'g');
  refCount[r] = (web.match(re) || []).length;
}
/* ...และนับเฉพาะ "การเรียกจริง" แยกไว้อีกชุด เพื่อดูว่าหน้าจอไหนเรียกบ้าง */
const CALL = /(?:api|punchWithRetry|apiSilent|apiQuiet)\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
const calledDirect = new Set([...web.matchAll(CALL)].map(m => m[1]));

const unreferenced = all.filter(r => refCount[r] === 0);
const referencedNotCalled = all.filter(r => refCount[r] > 0 && !calledDirect.has(r));

/* ── 3. ตระกูลชื่อที่อาจรวบได้ ─────────────────────────────────────────────────────────────── */
const families = {};
for (const r of all) {
  const stem = r.replace(/[A-Z].*$/, '');          // payCombinedCash → pay
  if (stem.length < 3) continue;
  (families[stem] = families[stem] || []).push(r);
}
const bigFamilies = Object.entries(families)
  .filter(([, v]) => v.length >= 4)
  .sort((a, b) => b[1].length - a[1].length);

/* ── 4. ของที่หน้าจอเดียวใช้คนเดียว (ย้ายเข้าไปอยู่ในหน้านั้นได้) ──────────────────────────── */
const onceOnly = all.filter(r => calledDirect.has(r) && refCount[r] === 1);

/* ── 5. น้ำหนักของหน้าจอ — จาก map_flows ─────────────────────────────────────────────────── */
let flows = null;
try {
  flows = JSON.parse(require('child_process')
    .execSync('node ' + JSON.stringify(path.join(__dirname, 'map_flows.js')) + ' --json',
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 }));
} catch (e) { /* ใบงานยังอ่านได้แม้ไม่มีแผนผัง */ }

const heavy = flows ? flows.screens
  .map(s => ({ role: s.role, name: s.name, buttons: s.buttons, modals: s.modals, api: s.api.length }))
  .sort((a, b) => (b.buttons + b.modals) - (a.buttons + a.modals)).slice(0, 8) : [];
const thin = flows ? flows.screens
  .filter(s => s.buttons <= 1 && s.modals === 0)
  .map(s => ({ role: s.role, name: s.name, api: s.api.length })) : [];

/* ── OUTPUT ─────────────────────────────────────────────────────────────────────────────────── */
const lines = [];
const say = s => { lines.push(s); console.log(s); };

say('\n════════ ใบงาน: รวบ / ตัด / จัดใหม่ ════════\n');
say('  route ทั้งหมด            ' + all.length + '   (engine ' + engRoutes.length + ' · server ' + srvRoutes.length + ')');
say('  ถูกเรียกตรงๆ จากหน้าจอ    ' + [...calledDirect].filter(r => all.includes(r)).length);
say('  มีชื่ออยู่ในโค้ดหน้าบ้าน      ' + all.filter(r => refCount[r] > 0).length);
say('  🔴 ไม่พบชื่อเลยในหน้าบ้าน   ' + unreferenced.length + '   ← ตัวเลขที่ต้องตรวจมือทุกตัวก่อนตัด');

say('\n──── ① ไม่มีหน้าจอไหนเรียกถึง (' + unreferenced.length + ') ────');
say('  🔴 "ไม่มีใครเรียก" ไม่ได้แปลว่า "ไม่มีใครใช้" — ตรวจมือทุกตัวก่อนเสมอ');
say('  ตัวอย่างที่ตรวจแล้วในรอบแรก:');
say('    · adminInbox      ใช้อยู่จริง — handleNotifications() เรียกเองฝั่งเซิร์ฟเวอร์ สำหรับ Role แอดมิน');
say('    · staffAuth/restoreSheet/listBackups  เครื่องมือฉุกเฉินและงานเบื้องหลัง');
say('    · saveParentSelf  ไม่มีหน้าจอไหนใช้จริง (ยืนยันแล้วตอนตรวจระบบ v466)');
say('  👉 สิ่งที่ "ตัด" ได้คือ **การเปิดเป็น route** ไม่ใช่ตัวฟังก์ชัน — route ที่ไม่มีใครเรียก');
say('     คือพื้นที่โจมตีที่ต้องตอบคำถามเรื่องสิทธิ์ และเป็นภาระของ Operation System ต่อไป');
unreferenced.forEach(r => say('    · ' + r));

say('\n──── ② มีชื่ออยู่ แต่ไม่ได้ถูกเรียกแบบปกติ (' + referencedNotCalled.length + ') ────');
say('  ส่วนใหญ่คือของที่เรียกผ่านตัวช่วย เช่น punchWithRetry หรืออยู่ในรายการ batch');
referencedNotCalled.forEach(r => say('    · ' + r + '   (พบชื่อ ' + refCount[r] + ' ที่)'));

say('\n──── ③ ตระกูลชื่อที่อาจรวบเป็นชุดเดียวได้ ────');
bigFamilies.forEach(([stem, v]) => say('    ' + stem + '*  ×' + v.length + '  →  ' + v.join(', ')));

say('\n──── ④ หน้าจอที่หนักที่สุด (ปุ่ม + กล่อง) ────');
heavy.forEach(s => say('    ' + (s.role + '.' + s.name).padEnd(20) + 'ปุ่ม ' + String(s.buttons).padStart(3) +
  ' · กล่อง ' + String(s.modals).padStart(3) + ' · ข้อมูล ' + s.api));

say('\n──── ⑤ หน้าจอบาง — อาจยุบรวมกับหน้าอื่น ────');
thin.forEach(s => say('    ' + (s.role + '.' + s.name).padEnd(20) + 'ข้อมูล ' + s.api));

say('\n──── ⑥ route ที่มีที่เรียกเพียงแห่งเดียว (' + onceOnly.length + ') ────');
say('  ไม่ใช่ปัญหาในตัวเอง — แต่เป็นรายการที่ย้ายไปอยู่กับหน้าที่ใช้มันได้ ถ้าจะแตกเป็นโมดูล');
say('    ' + onceOnly.join(', '));
say('');

const md = arg('--md');
if (md) {
  const out = ['# ใบงาน: รวบ / ตัด / เพิ่ม / จัดใหม่ — ฟังก์ชันทั้งระบบ\n',
    '> สร้างด้วย `node tools/audit_functions.js --md docs/FUNCTION_REVIEW.md` — อ่านจากโค้ดจริง',
    '> **เอกสารนี้หาหลักฐานให้ ไม่ได้ตัดสินแทน** — ทุกบรรทัดในหมวด ① ต้องตรวจมือก่อนตัด\n',
    '```', ...lines.slice(1), '```'];
  fs.writeFileSync(path.join(ROOT, md), out.join('\n') + '\n');
  console.log('เขียนแล้ว: ' + md);
}
