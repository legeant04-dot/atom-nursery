/**
 * tools/test_scales.js — ขนาดตัวอักษรและระยะห่างต้องมาจากสเกลเดียว ไม่ใช่จากคนที่กำลังพิมพ์
 *   node tools/test_scales.js
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 ของเดิม (docs/UI_AUDIT.md §2.1 §2.2):
 *
 *     margin-top 8px — 186 ครั้ง
 *     margin-top 6px — 175 ครั้ง   ← เจตนาเดียวกัน ห่างกัน 2px
 *     ขนาดตัวอักษร 27 ขนาด สำหรับงานที่ต้องการ 6 โดย 5 ขนาดเป็นทศนิยม
 *
 * ไม่มีใครมองเห็น 2px — แต่ข้าม 27 หน้าจอ มันคือเหตุผลที่ทุกอย่างดูไม่ตรงแนว
 *
 * 🔴 ชุดนี้ไม่ได้ห้าม inline style (ยังมี 2,530 จุด และไม่ได้ตั้งใจจะลบ)
 * มันบังคับแค่ว่า **ตัวเลขต้องมาจากที่เดียว** — เพราะปัญหาไม่ใช่ว่าเขียน style ตรงนั้น
 * แต่คือทุกจุดตัดสินใจเองว่าจะห่างเท่าไหร่
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
const css = R('webapp/styles.css'), html = R('webapp/index.html');
const appAll = R('webapp/app.js');
/* 🔴 เส้นแบ่ง "จอ" กับ "กระดาษ" — ตัวเดียวกับที่ tools/apply_scales.js ใช้
 * ใบเสร็จ A5 และสลิป A4 อ่านที่ระยะ 30 ซม. บนหน้าที่มีขนาดตายตัว ไม่ใช่จอมือถือกลางแดด
 * audit §2.3 เคยนับของพวกนี้เป็นหน้าจอแล้วสรุปผิดมาครั้งหนึ่ง — เส้นนี้คือสิ่งที่กันไม่ให้ผิดซ้ำ */
const CUT = appAll.indexOf('function buildReceiptHTML');
const app = appAll.slice(0, CUT), paper = appAll.slice(CUT);

console.log('1) 📏 สเกลมีอยู่จริง และอยู่ที่เดียว');
{
  ok_('สเกลตัวอักษร 6 ขั้นประกาศไว้ใน :root',
    ['--fs-1:13px', '--fs-2:15px', '--fs-3:18px', '--fs-4:21px', '--fs-5:28px', '--fs-6:44px']
      .every(d => css.indexOf(d) > -1));
  ok_('สเกลระยะห่างประกาศไว้ใน :root',
    /--sp-0:2px; --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px;/.test(css));
  ok_('🔴 ...และไม่มีขั้นที่เจ็ดของตัวอักษรแอบเพิ่มมา', !/--fs-7/.test(css) && !/--fs-0/.test(css));
  /* เหตุผลต้องอยู่ข้างตัวเลข ไม่ใช่อยู่ในเทสต์ — ตัวเลขที่ไม่มีใครรู้ที่มา คือตัวเลขที่คนถัดไปจะรื้อทิ้ง */
  ok_('มีเหตุผลเขียนกำกับไว้ข้างสเกล', /ไม่มีใครมองเห็น 2px/.test(css));
}

console.log('\n2) 🔴 หน้าจอต้องไม่มีขนาดตัวอักษรที่พิมพ์เป็นตัวเลขเอง');
{
  const lit = s => (s.match(/font-size:\d+(?:\.\d+)?px/g) || []);
  /* ต่ำกว่า 12px = ข้อยกเว้นที่ประกาศไว้แล้วใน styles.css (ตัวเลขในวงกลม 16–18px และ
   * ช่องปฏิทินที่กว้าง ~50px) ไม่มีค่าไหนในสเกลที่ใส่ลงไปได้ — ดู audit §2.3 */
  const big = s => lit(s).filter(x => Number(x.match(/[\d.]+/)[0]) >= 12);
  eq('app.js (ส่วนหน้าจอ)', big(app), []);
  eq('index.html', big(html), []);
  eq('styles.css', big(css), []);
  const small = lit(css).map(x => x.replace('font-size:', ''));
  ok_('🔴 ...และข้อยกเว้นที่เหลือเล็กกว่า 12px ทั้งหมด', small.every(x => Number(x.replace('px', '')) < 12));
  ok_('...ซึ่งแต่ละตัวมีเหตุผลเขียนไว้ข้าง ๆ', /readability floor/.test(css));
}

console.log('\n3) 🔴 และต้องไม่มีระยะห่างที่พิมพ์เป็นตัวเลขเอง');
{
  const PROPS = 'margin|margin-top|margin-bottom|margin-left|margin-right|padding|padding-top|padding-bottom|padding-left|padding-right|gap|row-gap|column-gap';
  /* ที่ปล่อยไว้โดยตั้งใจ: 0 (ไม่ใช่ระยะ) · 1px (เส้นผม ใช้จัดของให้ตรงทางสายตา)
   * · มากกว่า 32px (ระยะเฉพาะของผัง ไม่ใช่จังหวะซ้ำ ๆ · การยัดลงสเกลคือจุดที่ของพัง)
   *
   * 🔴 ค่าติดลบคงเป็นตัวเลขไว้ เพราะ calc(-1 * var(--sp-2)) อ่านไม่ออกสำหรับคนที่มาแก้ทีหลัง
   * แต่มัน **ต้องอยู่บนสเกล** อยู่ดี — ที่นี่จึงไม่ปล่อยผ่าน แต่ตรวจว่าค่าสัมบูรณ์เป็นขั้นที่มีจริง */
  const STEP = [2, 4, 8, 12, 16, 24, 32];
  const stray = s => {
    const out = [], re = new RegExp('(?:^|[;"\'{(\\s])(' + PROPS + '):([^;"\'})]*)', 'g');
    let m;
    while ((m = re.exec(s))) (m[2].match(/-?\d*\.?\d+px/g) || []).forEach(v => {
      const n = Math.abs(parseFloat(v));
      if (n <= 1 || n > 32) return;
      if (v.charAt(0) === '-' && STEP.indexOf(n) > -1) return;   // ติดลบแต่อยู่บนสเกล
      out.push(m[1] + ':' + v);
    });
    return out;
  };
  eq('app.js (ส่วนหน้าจอ)', stray(app), []);
  eq('index.html', stray(html), []);
  eq('styles.css', stray(css), []);
}

console.log('\n4) 📄 กระดาษไม่ถูกแตะ — และนั่นคือสิ่งที่ถูกต้อง');
{
  ok_('ใบเสร็จ/สลิป ยังมีขนาดตัวอักษรของตัวเอง', /font-size:\d+(?:\.\d+)?px/.test(paper));
  ok_('🔴 ...และยังมีขนาดที่เล็กกว่า 12px ซึ่งอ่านที่ระยะ 30 ซม. บนกระดาษ',
    (paper.match(/font-size:(\d+(?:\.\d+)?)px/g) || []).some(x => parseFloat(x.match(/[\d.]+/)[0]) < 12));
  ok_('...และไม่มีตัวแปรของหน้าจอหลุดเข้าไปในเอกสารที่พิมพ์', !/var\(--fs-|var\(--sp-/.test(paper));
  /* เอกสารที่พิมพ์เปิดในแท็บเบราว์เซอร์ก่อนจะสั่งพิมพ์ — ถ้ามันไปอ้าง token ของแอป
   * มันจะเปลี่ยนตามธีมของคนเปิด ซึ่งเป็นบั๊กเดิมที่เคยทำให้ผู้ปกครองได้หมึก #222 บนหน้าสีดำ */
  ok_('และยังประกาศตัวเองว่าเป็นกระดาษ', /color-scheme:light/.test(paper));
}

console.log('\n5) 🛠️ เครื่องมือที่ทำให้ย้อนกลับไปเหมือนเดิมไม่ได้');
{
  const tool = R('tools/apply_scales.js');
  ok_('สคริปต์แปลงยังอยู่ และรันซ้ำได้โดยไม่พัง', /--write/.test(tool) && /var\(/.test(tool));
  ok_('🔴 ...และมันข้ามส่วนกระดาษด้วยเส้นแบ่งเดียวกับชุดนี้',
    /function buildReceiptHTML/.test(tool));
  ok_('...และข้ามค่าที่ไม่ใช่จังหวะ (0 · 1px · มากกว่า 32px)',
    /v > 32 \|\| v === 0 \|\| v === 1/.test(tool));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
