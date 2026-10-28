/**
 * tools/test_progress_tabs.js — แถบความคืบหน้า และแถบเครื่องมือหน้าหลักแอดมิน
 *   node tools/test_progress_tabs.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ผอ. 2026-10-28:
 *   · "เปลี่ยน Progress Bar ... ใช้แค่สีเขียว gradient เข้มสุดที่ 100%"
 *   · "Menu Bar ในหน้าหลักของ Admin ... หากเกินจอให้เพิ่มเป็นลูกศร > ด้านหลัง"
 *
 * 🔴 เกณฑ์เดิมคือ `100% เขียว · 90–99% ส้ม · ต่ำกว่า 90% แดง` — **การมาเรียน 89% จึงขึ้นสีแดง**
 * ทั้งที่เด็กลาป่วย 2 คนจาก 19 ก็ตกเกณฑ์แล้ว · สัญญาณเตือนที่เตือนทุกวันคือสัญญาณที่ไม่มีใครอ่าน
 */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  console.log((okk ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (okk ? '' : ' want=' + JSON.stringify(want)));
  okk ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const appAll = R('webapp/app.js'), css = R('webapp/styles.css');
const app = appAll.slice(0, appAll.indexOf('function buildReceiptHTML'));

/* ── เครื่องวัดความต่างสี (WCAG) — ตัวเดียวกับที่ใช้วัดบนเบราว์เซอร์ ─────────────────────── */
const lum = h => { const n = parseInt(h.slice(1), 16);
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  return .2126 * f(n >> 16 & 255) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b);
  return +((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)).toFixed(2); };
/* หน้าต่างกว้างพอจะครอบบล็อก :root ทั้งก้อน (คอมเมนต์ภาษาไทยยาว — 4000 ไม่ถึง --prog-1 ที่ 6,661)
 * และโยนทิ้งถ้าหาไม่เจอ แทนที่จะคืน null ให้ตัวที่เรียกไปพังทีหลังแบบไม่บอกสาเหตุ */
const tok = (block, name) => { const i = css.indexOf(block);
  const m = css.slice(i, i + 12000).match(new RegExp('--' + name + ':(#[0-9a-f]{6})', 'i'));
  if (!m) throw new Error('หา --' + name + ' ในบล็อก ' + block + ' ไม่เจอ');
  return m[1]; };

console.log('1) 📊 เขียวไล่เฉด — ยิ่งมากยิ่งเข้ม');
{
  ok_('มีตัวสร้างแถบตัวเดียวของทั้งแอป', /window\.pbar = p =>/.test(app));
  eq('🔴 ไม่เหลือแถบที่วาดเองด้วย inline style',
    (app.match(/height:6px;background:var\(--line\)/g) || []), []);
  ok_('มีสเกลห้าขั้น', [1, 2, 3, 4, 5].every(i => css.indexOf('--prog-' + i + ':') > -1));
  /* ขั้นต้องเรียงจริง ไม่ใช่แค่มีครบ — ห้าสีที่สุ่มมาวางไม่ใช่สเกล */
  const L = [1, 2, 3, 4, 5].map(i => tok(':root{', 'prog-' + i));
  ok_('🔴 โหมดสว่าง: เข้มขึ้นจริงทุกขั้น', L.every((h, i) => i === 0 || lum(h) < lum(L[i - 1])));
  const D = [1, 2, 3, 4, 5].map(i => tok('html[data-theme="dark"]', 'prog-' + i));
  /* บนพื้นมืด "สว่าง/สดกว่า" คือสิ่งที่อ่านว่า "มากกว่า" — ใช้ชุดเดียวกันทั้งสองโหมดไม่ได้ */
  ok_('🔴 โหมดมืด: ไล่กลับทาง (สว่างขึ้นจริงทุกขั้น)', D.every((h, i) => i === 0 || lum(h) > lum(D[i - 1])));
}

console.log('\n2) 🔴 ...และทุกขั้นต้องมองเห็นบนราง ไม่ใช่แค่ต่างกันเอง');
{
  /* แถบคือ "วัตถุกราฟิก" — เกณฑ์ WCAG คือ 3:1 กับพื้นที่มันวางอยู่
   * ชุดแรกที่ผมเลือกเองสวยกว่านี้ แต่ขั้นอ่อนสุดวัดได้ 1.47 กับราง = แถบ 35% แทบมองไม่เห็น */
  const lt = tok(':root{', 'surface-3'), dt = tok('html[data-theme="dark"]', 'surface-3');
  const bad = [];
  [1, 2, 3, 4, 5].forEach(i => {
    const l = ratio(lt, tok(':root{', 'prog-' + i)), d = ratio(dt, tok('html[data-theme="dark"]', 'prog-' + i));
    if (l < 3) bad.push('light p' + i + '=' + l);
    if (d < 3) bad.push('dark p' + i + '=' + d);
  });
  eq('ทุกขั้นตัดกับรางอย่างน้อย 3:1 ทั้งสองโหมด', bad, []);
}

console.log('\n3) 🔴 ตัวเลขข้างแถบต้องอ่านออก — ไม่ไล่เฉดตามแถบ');
{
  /* วัดบนเบราว์เซอร์: เขียวขั้นอ่อนเป็นสีตัวอักษรบนการ์ดขาวได้ 1.70–3.29 ตกเกณฑ์ 4.5 ทั้งสามขั้น
   * สองช่องทางที่เล่าเรื่องเดียวกัน โดยช่องหนึ่งอ่านไม่ออก แย่กว่ามีช่องเดียวที่ดี */
  ok_('ตัวเลขใช้สีหมึกปกติ', /const pctColor = p => \(Number\(p\) \|\| 0\) < 50 \? 'var\(--prog-low\)' : 'var\(--ink\)';/.test(app));
  ok_('🔴 ...เหลือสีไว้ที่เดียวคือต่ำกว่า 50%', /--prog-low:var\(--bad\)/.test(css));
  /* 🔴 และนี่คือเกณฑ์ที่ ผอ. เห็นว่าผิด: 89% เคยแดง */
  const step = p => p < 50 ? 'plow' : p < 65 ? 'p1' : p < 80 ? 'p2' : p < 90 ? 'p3' : p < 100 ? 'p4' : 'p5';
  ok_('🔴 85% ไม่ใช่สัญญาณเตือนอีกต่อไป', step(85) !== 'plow' && step(89) !== 'plow');
  ok_('...แต่ครึ่งห้องหายไปยังเตือนอยู่', step(49) === 'plow' && step(20) === 'plow');
  ok_('...และกฎในโค้ดตรงกับที่ชุดนี้เชื่อ', /p < 50 \? 'plow' : p < 65 \? 'p1' : p < 80 \? 'p2' : p < 90 \? 'p3' : p < 100 \? 'p4' : 'p5'/.test(app));
}

console.log('\n4) 🧭 แถบเครื่องมือ — ข้อความล้วน และบอกได้ว่ายังมีต่อ');
{
  ok_('เป็นข้อความล้วน ไม่ใช่ปุ่มหกปุ่ม', /class="qtab"/.test(app) && !/class="qbar"><button class="btn sm"/.test(app));
  /* ทั้งหกเป็น "การกระทำ" ไม่ใช่แท็บสลับหน้า — เส้นใต้ถาวรจะเป็นคำโกหกว่า "คุณอยู่ตรงนี้" */
  ok_('🔴 เส้นใต้ขึ้นตอนชี้/แตะ ไม่ใช่ค้างไว้บอกว่าอยู่ตรงนี้',
    /\.qtab:hover,\.qtab:focus-visible\{[^}]*border-bottom-color/.test(css) &&
    !/\.qtab\.active/.test(css));
  ok_('มีปุ่ม › และมันเลื่อนจริง', /window\.QBAR_NEXT = \(btn\)/.test(app) && /scrollBy\(\{ left:/.test(app));
  /* ลูกศรที่อยู่ตลอดเวลาคือลูกศรที่ไม่มีความหมาย */
  ok_('🔴 ...โผล่เฉพาะตอนมีของเลยขอบไปจริง', /const more = bar\.scrollWidth - bar\.clientWidth - bar\.scrollLeft > 4;/.test(app));
  ok_('...และถูกถามใหม่ทุกครั้งที่หน้าจอวาดเสร็จ', /requestAnimationFrame\(\(\)=>document\.querySelectorAll\('\.qbarwrap'\)\.forEach\(QBAR_SYNC\)\)/.test(app));
  ok_('...รวมถึงตอนหมุนจอ', /window\.addEventListener\('resize', \(\) => document\.querySelectorAll\('\.qbarwrap'\)/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
