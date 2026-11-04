/**
 * tools/test_skeleton_shape.js — โครงระหว่างรอ วาดตามรูปหน้าจอจริงของแต่ละ Role
 *   node tools/test_skeleton_shape.js
 *
 * ผอ. 2026-11-04: "Skeleton Loader ทำให้เป็นโครงของแอปเราได้ไหม ทุก Role เพื่อความสมจริง"
 *
 * หลังหน้าจอวาดเสร็จ จำ "รูปร่าง" ไว้ (ชนิดกล่อง · ความสูง · จำนวนแถว) ครั้งหน้าวาดโครงจากรูปนั้น
 * 🔴 เก็บรูปร่างเท่านั้น — ห้ามมีข้อความ ชื่อ หรือตัวเลขจากหน้าจอหลุดลง localStorage
 */
const path = require('path'), fs = require('fs'), vm = require('vm');
let pass = 0, fail = 0;
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n?/g, '\n');
const app = R('webapp/app.js'), css = R('webapp/styles.css');

// run the real code: from the skeleton section up to the next section, with a fake page around it
const a = app.indexOf('  window.skel = (kind, n) => {'), b = app.indexOf('/* ═══ 📊 PBAR');
const src = app.slice(a, b);
const store = {};
function el(tag, cls, h, kids, extra) {
  return { tagName: tag, classList: { contains: c => (cls || '').split(' ').includes(c) },
    getBoundingClientRect: () => ({ height: h }), children: kids || [], textContent: 'ด.ญ. สมใจ ใจดี ฿6,900',
    querySelector: s => (extra && extra.title && /h3/.test(s)) ? {} : null,
    querySelectorAll: () => ({ length: (extra && extra.rows) || 0 }) };
}
const page = el('DIV', '', 0, [
  el('H2', 'page', 30),
  el('DIV', 'kpigrid', 120, [{}, {}, {}, {}]),
  el('DIV', 'card', 210, [], { title: true, rows: 5 }),
  el('BUTTON', 'btn block', 44),
  el('DIV', 'card', 140, [], { title: true }),
  el('DIV', 'spread', 3),                       // too small to draw
]);
const ctx = { window: {}, app: page, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  JSON, Math, Array, console };
vm.createContext(ctx);
vm.runInContext(src.replace(/^  window\./gm, 'window.').replace(/\bskel\(/g, 'window.skel('), ctx);
const W = ctx.window;

console.log('\n1) จำรูปร่างหน้าจริง แล้ววาดโครงตามนั้น');
W.skelRemember('Teacher', 'class');
const saved = store['atom.sk.v1.Teacher.class'];
ok_('เก็บไว้ต่อ Role ต่อหน้า', !!saved);
const shape = JSON.parse(saved || '[]');
ok_('ได้ครบทุกกล่องที่มองเห็น (ข้ามกล่องเล็กกว่า 8px)', shape.map(x => x.t).join() === 'h,kpi,card,btn,card');
ok_('การ์ดจำความสูงและจำนวนแถว', shape[2].h === 210 && shape[2].rows === 5 && shape[2].title === true);
/* 🔴 ข้อนี้คือเหตุผลที่ทำแบบนี้ได้โดยไม่มีเรื่อง PDPA */
ok_('🔴 ไม่มีข้อความจากหน้าจอหลุดลงเครื่อง', !/สมใจ|6,900|ด\.ญ/.test(saved));
ok_('🔴 ...มีแค่ชนิด ขนาด จำนวน', shape.every(x => Object.keys(x).every(k => ['t', 'h', 'n', 'title', 'rows'].includes(k))));
const drawn = W.skelScreen('Teacher', 'class');
ok_('โครงครั้งหน้าใช้รูปที่จำไว้: แถว 5 แถวในการ์ด', (drawn.match(/sk-row/g) || []).length === 5);
ok_('...การ์ดสูงเท่าของจริง', /min-height:210px/.test(drawn) && /sk-btn/.test(drawn) && /kpigrid/.test(drawn));
ok_('จำว่าเครื่องนี้ใช้ Role อะไรล่าสุด (ไว้วาดตอนกลับเข้าระบบ)', store['atom.sk.lastRole'] === 'Teacher');

console.log('\n2) ยังไม่เคยเปิด: หน้าแรกของแต่ละ Role มีรูปของตัวเอง');
const p = W.skelScreen('Parent', 'home'), t = W.skelScreen('Teacher', 'home'), ad = W.skelScreen('Admin', 'home');
ok_('สาม Role ได้โครงไม่ซ้ำกัน', p !== t && t !== ad && p !== ad);
ok_('แอดมินมีกล่องตัวเลข · ผู้ปกครองมีปุ่มใหญ่', /kpigrid/.test(ad) && /sk-btn/.test(p));
ok_('หน้าที่ไม่รู้จัก ใช้โครงกลางเหมือนเดิม', /sk-title/.test(W.skelScreen('Admin', 'something')));

console.log('\n3) ต่อเข้ากับการเปลี่ยนหน้า');
ok_('GO() วาดโครงตามหน้า ไม่ใช่โครงกลาง', /app\.innerHTML=skelScreen\(USER\.role, screen\)/.test(app));
ok_('จำรูปหลังวาดเสร็จ เฉพาะเมื่อยังอยู่หน้าเดิมและ Role เดิม',
  /setTimeout\(\(\)=>\{ if\(CURRENT===screen && USER && USER\.role===_role\) skelRemember\(_role, screen\); \}, 1500\)/.test(app));
ok_('หน้าที่ล้มไม่ถูกจำ (จำเฉพาะตอนสำเร็จ)', /r\.then\(_keep,_navOff\)/.test(app));
ok_('ตอนกลับเข้าระบบ วาดหน้าแรกของ Role ล่าสุด', /_lr \? skelScreen\(_lr, 'home'\)/.test(app));
ok_('CSS ใช้ตัวแปรของระบบ ไม่ใช่สีตายตัว', /\.sk-h\{height:var\(--fs-5\)/.test(css) && /\.sk-btn\{height:44px;border-radius:var\(--radius\)/.test(css));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
