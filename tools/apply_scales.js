/**
 * tools/apply_scales.js — ย้ายขนาดตัวอักษรและระยะห่างทั้งแอปมาอยู่บนสเกลเดียว
 *
 *   node tools/apply_scales.js            ดูว่าจะเปลี่ยนอะไรบ้าง (ไม่เขียนไฟล์)
 *   node tools/apply_scales.js --write    เขียนจริง
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 ที่มา — docs/UI_AUDIT.md §2.1 และ §2.2 (ผอ. 2026-10-23: "ดู AI มากกว่า Design")
 *
 *     margin-top:8px  186 ครั้ง
 *     margin-top:6px  175 ครั้ง   ← **เจตนาเดียวกัน ห่างกัน 2px**
 *
 * **ไม่มีใครมองเห็น 2px** — แต่ข้าม 27 หน้าจอ มันคือเหตุผลที่ทุกอย่างดูไม่ตรงแนว
 * เรื่องนี้ไม่ใช่เรื่องรสนิยม: สองค่านี้ไม่ได้ถูกเลือก มันถูกพิมพ์โดยใครก็ตามที่กำลังเขียนตรงนั้น
 *
 * และขนาดตัวอักษร **27 ขนาด สำหรับงานที่ต้องการ 6** โดยมี 5 ขนาดเป็นทศนิยม —
 * ขนาดทศนิยมคือลายเซ็นของค่าที่ถูกขยับจน "ดูดี" บนจอเดียว เครื่องเดียว ครั้งเดียว
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 สคริปต์นี้ไม่ได้ลบ inline style 2,530 จุดทิ้ง และไม่ได้ตั้งใจจะลบ
 *
 * มันทำให้ทั้ง 2,530 จุด **อ้างถึงระบบเดียวกัน** แทนที่จะแข่งกับระบบ · หลังจากนี้การเปลี่ยนสเกล
 * ทั้งแอปคือการแก้ตัวเลขใน :root ที่เดียว และ "ปรับฟอนต์ตามโรงเรียน" กลายเป็นงานที่ทำได้จริง
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 สิ่งที่ไม่แตะ และเหตุผล
 *
 *   · **เอกสารกระดาษ** (ใบเสร็จ A5 / สลิป A4) — ทุกอย่างตั้งแต่ buildReceiptHTML ลงไป
 *     กระดาษอ่านที่ระยะ 30 ซม. บนหน้าที่มีขนาดตายตัว ไม่ใช่จอมือถือกลางแดด
 *     ของพวกนี้ยังจงใจมี 8.5px/9px และนั่น**ถูกแล้ว** — §2.3 ของ audit เคยนับมันเป็นหน้าจอ
 *     แล้วสรุปผิดมาครั้งหนึ่ง
 *   · **ตัวอักษรต่ำกว่า 12px บนหน้าจอ** — คือข้อยกเว้นที่ประกาศไว้แล้วใน styles.css
 *     (ตัวเลขในวงกลม 16–18px และช่องปฏิทินที่กว้าง ~50px) ไม่มีค่าไหนในสเกลที่ใส่ลงไปได้
 *   · **ค่ามากกว่า 32px** — เป็นระยะเฉพาะของผัง ไม่ใช่จังหวะซ้ำ ๆ · การยัดลงสเกลคือจุดที่ของพัง
 *   · **ค่าติดลบ** — แปลงเป็นค่าบนสเกลเหมือนกัน แต่คงเป็นตัวเลข ไม่ใช่ calc() ที่อ่านไม่ออก
 */
const fs = require('fs'), path = require('path');
const WRITE = process.argv.includes('--write');
const P = f => path.join(__dirname, '..', f);

/* ── สเกลตัวอักษร — 6 ขั้น เอามาจากสิ่งที่แอปใช้จริง ไม่ใช่อัตราส่วนที่ยกมาจากที่อื่น ────────
 * 12 กับ 13 ถูกยุบเป็นขั้นเดียวโดยตั้งใจ: มันคือปัญหาเดียวกับ 6px/8px เป๊ะ ๆ — ห่างกัน 1px
 * ไม่มีกฎ และไม่มีใครแยกออก · พื้นเลยขยับขึ้นเป็น 13px ซึ่งตรงกับกฎที่เราเขียนไว้เองใน
 * docs/FRONTEND_DESIGN.md ว่าต้อง "อ่านออกจากระยะแขน กลางแดด มือเดียว ขณะอุ้มเด็กอยู่" */
const FONT = { 12:1, 13:1, 14:1, 15:2, 16:2, 17:3, 18:3, 19:3, 20:4, 21:4, 22:4,
               24:5, 26:5, 28:5, 30:5, 34:5, 38:6, 40:6, 42:6, 44:6, 46:6, 48:6 };

/* ── สเกลระยะห่าง — ฐาน 4px บวกขั้น "เส้นผม" 2px ที่ของเดิมใช้จริง 112 ครั้ง ───────────────
 * ปัดเข้าขั้นที่ใกล้ที่สุด · เท่ากันให้ปัดขึ้น → 6→8 และ 10→12 ซึ่งแปลว่าหน้าจอโปร่งขึ้นเล็กน้อย
 * ทั้งแอปอย่างสม่ำเสมอ (ตั้งใจ ไม่ใช่ผลข้างเคียง) */
const STEP = [2, 4, 8, 12, 16, 24, 32];
const spIdx = n => { let best = 0, d = Infinity;
  STEP.forEach((s, i) => { const dd = Math.abs(n - s); if (dd < d || (dd === d && s > STEP[best])) { d = dd; best = i; } });
  return best; };

const SPACE_PROPS = ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'gap', 'row-gap', 'column-gap'];

const report = { font: {}, space: {}, skipped: {} };
const bump = (b, k) => b[k] = (b[k] || 0) + 1;

function mapFont(s) {
  return s.replace(/font-size:(\d+(?:\.\d+)?)px/g, (all, n) => {
    const v = Number(n), step = FONT[v];
    if (!step) { bump(report.skipped, 'font ' + n + 'px'); return all; }
    bump(report.font, n + 'px → --fs-' + step);
    return 'font-size:var(--fs-' + step + ')';
  });
}

function mapSpace(s) {
  for (const p of SPACE_PROPS) {
    /* ขอบซ้ายกันไม่ให้ margin-top ถูกจับซ้ำตอนวนถึง margin · ค่าหยุดที่ ; " ' } ) เท่านั้น
     * เพราะ declaration ใน template literal ไม่ได้ลงท้ายด้วย ; เสมอไป */
    const re = new RegExp('(^|[;"\'{(\\s])(' + p + '):([^;"\'})]*)', 'g');
    s = s.replace(re, (all, lead, prop, val) => {
      if (/var\(/.test(val)) return all;                    // แปลงไปแล้ว
      let touched = false;
      const out = val.replace(/(-?)(\d+(?:\.\d+)?)px/g, (m, sign, n) => {
        const v = Number(n);
        /* 1px ไม่ใช่จังหวะ มันคือ "เส้นผม" — ใช้จัดให้ของสองอย่างตรงกันทางสายตา (เช่นช่องติ๊ก)
         * ปัดมันขึ้นเป็น 2px คือการทำให้สิ่งที่เคยตรง เยื้องไป 1px โดยไม่มีใครได้อะไรกลับมา */
        if (v > 32 || v === 0 || v === 1) { bump(report.skipped, prop + ' ' + sign + n + 'px'); return m; }
        if (sign === '-') {                                  // ติดลบ: อยู่บนสเกล แต่คงเป็นตัวเลข
          const t = STEP[spIdx(v)];
          if (t === v) return m;
          touched = true; bump(report.space, '-' + n + 'px → -' + t + 'px');
          return '-' + t + 'px';
        }
        const i = spIdx(v);
        touched = true; bump(report.space, n + 'px → --sp-' + i + ' (' + STEP[i] + 'px)');
        return 'var(--sp-' + i + ')';
      });
      return touched ? lead + prop + ':' + out : all;
    });
  }
  return s;
}

const files = [];
{
  const src = fs.readFileSync(P('webapp/app.js'), 'utf8');
  /* 🔴 เส้นแบ่ง "จอ" กับ "กระดาษ" — ทุกอย่างตั้งแต่ตัวสร้างใบเสร็จลงไปคือเอกสารที่พิมพ์ออกมา */
  const cut = src.indexOf('function buildReceiptHTML');
  if (cut < 0) { console.error('หาเส้นแบ่งหน้าจอ/กระดาษไม่เจอ — หยุดไว้ก่อน'); process.exit(1); }
  files.push({ f: 'webapp/app.js', out: mapSpace(mapFont(src.slice(0, cut))) + src.slice(cut) });
}
['webapp/index.html', 'webapp/styles.css'].forEach(f => {
  files.push({ f, out: mapSpace(mapFont(fs.readFileSync(P(f), 'utf8'))) });
});

const show = (title, b) => { const e = Object.entries(b).sort((a, c) => c[1] - a[1]);
  console.log('\n' + title + '  (' + e.reduce((a, c) => a + c[1], 0) + ')');
  e.forEach(([k, v]) => console.log('   ' + String(v).padStart(4) + '×  ' + k)); };
show('ขนาดตัวอักษร', report.font);
show('ระยะห่าง', report.space);
show('ไม่แตะ (นอกสเกลโดยตั้งใจ)', report.skipped);

if (WRITE) { files.forEach(x => fs.writeFileSync(P(x.f), x.out)); console.log('\n✅ เขียนแล้ว ' + files.length + ' ไฟล์'); }
else console.log('\n(ยังไม่เขียนไฟล์ — ใส่ --write เพื่อเขียนจริง)');
