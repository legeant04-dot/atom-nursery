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
  /* 🔴 ครั้งแรกเช็คแค่ `height:6px` — แถบที่สี่สูง 5px จึงรอดไป แล้วไปโผล่เป็นแท่งสีดำบนระบบจริง
   * (ผอ. ส่งภาพมา 2026-10-28) · คราวนี้ถามด้วย "รูปทรงของแถบ" ไม่ใช่ความสูงที่เดาเอง */
  const handRolled = (app.match(/height:100%;width:\$\{[^}]*\}%/g) || []);
  /* สามอันที่เหลือเป็นแผนภูมิ **การกระจาย** ไม่ใช่ความคืบหน้าสู่เป้า:
   *   · สาเหตุการบาดเจ็บ (แดงคือประเด็น) · รายงานความเร็ว (สีมาจากผู้เรียก) · คะแนนแบบสอบถาม
   * เขียวเข้มขึ้นตามค่าจะเป็นคำโกหกกับทั้งสามอัน — "สาเหตุที่พบบ่อย" ไม่ได้แปลว่า "ดี" */
  eq('🔴 เหลือเฉพาะแผนภูมิการกระจาย ไม่ใช่แถบความคืบหน้า', handRolled.length, 3);
  ok_('...และเหตุผลที่ไม่แตะ ถูกเขียนไว้ในชุดนี้', /แผนภูมิ \*\*การกระจาย\*\*/.test(R('tools/test_progress_tabs.js')));
  /* 🔴 ข้อที่จะดักบั๊กเดิมได้ตรง ๆ: pctColor คืนสีของ "ตัวเลข" ไม่ใช่ของ "แถบ"
   * เอาไปทาเป็นพื้นของแถบเมื่อไหร่ แถบจะกลายเป็นสีดำทันที */
  eq('🔴 pctColor ต้องไม่ถูกเอาไปทาเป็นพื้นของแถบ',
    (app.match(/background:\$\{pctColor\(/g) || []), []);
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

console.log('\n5) 📈 กราฟสรุปภาพรวม — สองเส้น 6 เดือน');
{
  ok_('ขอข้อมูล 6 เดือน', /api\('financeTrend',\{staffId:USER\.staffId,months:6\}\)/.test(app));
  /* `d3` เปล่า ๆ ไปชนคำว่า "grid3" — ถามด้วย "การโหลดไลบรารี" ไม่ใช่ชื่อที่อาจโผล่กลางคำ */
  ok_('วาดด้วย SVG ของเราเอง ไม่ใช่ไลบรารีกราฟ',
    /const chart = \(rows\) =>/.test(app) &&
    !/chart\.js|\bd3\.|echarts|apexchart|highcharts/i.test(app));
  ok_('สองเส้น: รับจริง กับ รายจ่าย', /line\('expense'\)/.test(app) && /line\('income'\)/.test(app));
  /* 🔴 กราฟเงินที่ตัดฐานทิ้งจะทำให้ส่วนต่าง 2% ดูเหมือน 200% — และนี่คือหน้าจอที่ใช้ตัดสินใจ
   * เรื่องเงินจริงของโรงเรียน · y() หาร max ตรง ๆ จึงเริ่มที่ 0 เสมอตามนิยาม */
  ok_('🔴 แกนตั้งเริ่มที่ 0 เสมอ', /const y = v => PT \+ \(H - PT - PB\) \* \(1 - \(Number\(v\) \|\| 0\) \/ max\)/.test(app));
  ok_('...และบอกด้วยว่ายอดสูงสุดคือเท่าไหร่', /text-anchor="end"[^`]*kk\(max \* f\)/.test(app));
  /* สีมาจากตัวแปร ไม่ใช่ค่าคงที่ — โหมดมืดจึงตามมาเอง (วัดแล้ว: เส้นรับจริงเป็น prog-3 ของโหมดนั้น) */
  ok_('ใช้ตัวแปรสีของระบบ จึงตามโหมดมืดเอง',
    /stroke="var\(--prog-3\)"/.test(app) && /stroke="var\(--bad\)"/.test(app));
  ok_('มีคำอธิบายว่าเส้นไหนคืออะไร', /const legend = /.test(app) && /'Received' : 'รับจริง'/.test(app));
}

console.log('\n6) 📂 หัวข้อที่พับเก็บได้ และของที่ย้ายออกจากหน้าหลัก');
{
  ok_('นักเรียนลาชั่วคราว พับได้', /<details class="card foldcard"><summary class="spread"><h3>⏸️/.test(app));
  ok_('นักเรียนที่กำลังจะเริ่มเรียน พับได้', /<details class="card foldcard"><summary class="spread"><h3>\$\{ic\('calendar'\)\}/.test(app));
  /* 🔴 พับเก็บได้ ต้องไม่เท่ากับมองไม่เห็นว่ามี — จำนวนคนยังอยู่บนหัวเรื่องที่ปิดอยู่ */
  ok_('🔴 ...แต่จำนวนคนยังอยู่บนหัวเรื่อง', /\$\{list\.length\} \$\{EN\(\)\?'children':'คน'\}<\/span><\/summary>/.test(app));
  ok_('...และลูกศรเป็นของเราเอง ไม่ใช่สามเหลี่ยมของเบราว์เซอร์',
    /\.foldcard>summary::-webkit-details-marker\{display:none;\}/.test(css) && /\.foldcard>summary::after\{content:'›'/.test(css));
  ok_('แถบเครื่องมือไม่มี "จัดการข้อมูล" แล้ว (มันเป็นแท็บในแถบล่างอยู่แล้ว)',
    !/qt\("GO\('manage'\)"/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
