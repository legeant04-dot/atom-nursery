/* Atom Nursery — Parent usage guide deck (Thai). Run with NODE_PATH=global node_modules. */
const PptxGenJS = require('pptxgenjs');
const p = new PptxGenJS();
p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
p.layout = 'W';

const NAVY='0D2B4E', BLUE='1565C0', BLUEDK='0E4C92', BLUELT='E9F1FC', CARD='F4F8FE',
      GREEN='2E7D32', GREENLT='E6F4E7', AMBER='E65100', AMBERLT='FFF3E0', RED='C62828',
      INK='1E2A37', MUTED='5F7185', WHITE='FFFFFF', LINE='D6E1EC', PINK='C2185B';
const TH='Tahoma';
const W=13.333, H=7.5;

// ---------- helpers ----------
function bg(s, color){ s.background = { color }; }
function title(s, text, opts){ opts=opts||{};
  s.addText(text, { x:0.6, y:0.42, w:9.4, h:0.8, fontFace:TH, fontSize:opts.size||30, bold:true,
    color:opts.color||INK, align:'left', valign:'middle' }); }
function kicker(s, text, color){ s.addText(text, { x:0.62, y:0.2, w:9, h:0.32, fontFace:TH, fontSize:12.5,
    bold:true, color:color||BLUE, charSpacing:2, align:'left' }); }
function pageNum(s, n){ s.addText(String(n), { x:12.7, y:7.02, w:0.5, h:0.3, fontFace:TH, fontSize:10,
    color:MUTED, align:'right' }); }
function foot(s){ s.addText('Atom Nursery · คู่มือผู้ปกครอง', { x:0.6, y:7.02, w:6, h:0.3, fontFace:TH,
    fontSize:9.5, color:MUTED, align:'left' }); }

// icon chip: colored rounded square with a glyph
function chip(s, x, y, glyph, fill, sz){ sz=sz||0.62;
  s.addShape('roundRect', { x, y, w:sz, h:sz, rectRadius:0.12, fill:{color:fill}, line:{type:'none'} });
  s.addText(glyph, { x, y, w:sz, h:sz, fontFace:TH, fontSize:(sz*26), bold:true, color:WHITE, align:'center', valign:'middle' }); }

// icon+text row block
function iconRow(s, x, y, w, glyph, gfill, head, body){
  chip(s, x, y, glyph, gfill, 0.56);
  s.addText(head, { x:x+0.72, y:y-0.04, w:w-0.72, h:0.34, fontFace:TH, fontSize:15, bold:true, color:INK, align:'left', valign:'middle' });
  s.addText(body, { x:x+0.72, y:y+0.3, w:w-0.72, h:0.62, fontFace:TH, fontSize:11.5, color:MUTED, align:'left', valign:'top' }); }

// a titled panel with body lines (bullets)
function panel(s, x, y, w, h, head, headColor, lines, fill){
  s.addShape('roundRect', { x, y, w, h, rectRadius:0.08, fill:{color:fill||CARD}, line:{color:LINE, width:1} });
  s.addText(head, { x:x+0.22, y:y+0.16, w:w-0.44, h:0.36, fontFace:TH, fontSize:14, bold:true, color:headColor||BLUE, align:'left' });
  const items = lines.map((t,i)=>({ text:t, options:{ bullet:{code:'2022'}, color:INK, fontSize:11.5, fontFace:TH, breakLine:true, paraSpaceAfter:5 } }));
  s.addText(items, { x:x+0.22, y:y+0.6, w:w-0.44, h:h-0.78, valign:'top', align:'left' }); }

// ---------- phone mockup ----------
// blocks: [{card:true, lines:[{t,b,c,s,glyph}], fill}, {buttons:[{t,c}]}, {headline:'..'}]
function phone(s, x, y, w, blocks, screenName){
  const h = w*2.02;
  // frame + shadow
  s.addShape('roundRect', { x:x-0.06, y:y-0.06, w:w+0.12, h:h+0.12, rectRadius:0.34, fill:{color:'0A1B33'}, line:{type:'none'},
    shadow:{ type:'outer', color:'0A1B33', opacity:0.28, blur:10, offset:4, angle:90 } });
  s.addShape('roundRect', { x, y, w, h, rectRadius:0.3, fill:{color:WHITE}, line:{type:'none'} });
  // header bar
  const hb=0.62;
  s.addShape('roundRect', { x, y, w, h:hb+0.14, rectRadius:0.3, fill:{color:BLUE}, line:{type:'none'} });
  s.addShape('rect', { x, y:y+0.36, w, h:hb-0.22, fill:{color:BLUE}, line:{type:'none'} });
  s.addText('Atom Nursery', { x:x+0.22, y:y+0.06, w:w-1.6, h:hb, fontFace:TH, fontSize:11, bold:true, color:WHITE, valign:'middle' });
  s.addText('TH  🔔  ●', { x:x+w-1.55, y:y+0.06, w:1.4, h:hb, fontFace:TH, fontSize:9, color:'DCEBFB', align:'right', valign:'middle' });
  if(screenName) s.addText(screenName, { x, y:y+h-0.34, w, h:0.3, fontFace:TH, fontSize:8, italic:true, color:MUTED, align:'center' });
  // body blocks
  let cy = y+hb+0.2; const bx=x+0.18, bw=w-0.36;
  blocks.forEach(bl=>{
    if(bl.headline){
      s.addText(bl.headline, { x:bx, y:cy, w:bw, h:0.32, fontFace:TH, fontSize:11.5, bold:true, color:INK, valign:'middle' });
      cy+=0.4; return;
    }
    if(bl.buttons){
      const n=bl.buttons.length, gap=0.1, bwid=(bw-(n-1)*gap)/n;
      bl.buttons.forEach((b,i)=>{ const bxx=bx+i*(bwid+gap);
        s.addShape('roundRect', { x:bxx, y:cy, w:bwid, h:0.44, rectRadius:0.1, fill:{color:b.c}, line:{type:'none'} });
        s.addText(b.t, { x:bxx, y:cy, w:bwid, h:0.44, fontFace:TH, fontSize:9.5, bold:true, color:WHITE, align:'center', valign:'middle' }); });
      cy+=0.44+0.16; return;
    }
    // card
    const lines=bl.lines||[];
    const ch = 0.16 + lines.reduce((a,l)=>a+(l.s? l.s*0.021:0.26),0) + 0.12;
    s.addShape('roundRect', { x:bx, y:cy, w:bw, h:ch, rectRadius:0.1, fill:{color:bl.fill||CARD}, line:{color:LINE,width:0.75} });
    let ly=cy+0.12;
    lines.forEach(l=>{ const fs=l.s||9.5;
      s.addText((l.glyph? l.glyph+' ':'')+l.t, { x:bx+0.16, y:ly, w:bw-0.32, h:fs*0.028, fontFace:TH, fontSize:fs, bold:!!l.b, color:l.c||INK, valign:'middle', align:l.align||'left' });
      ly += fs*0.028; });
    cy+=ch+0.16;
  });
}

// callout label with connector dot (for annotated screens)
function callout(s, x, y, w, num, head, body, color){
  s.addShape('roundRect', { x, y, w, h:0.86, rectRadius:0.08, fill:{color:WHITE}, line:{color:color,width:1.25},
    shadow:{type:'outer',color:'99A',opacity:0.18,blur:5,offset:2,angle:90} });
  s.addShape('oval', { x:x+0.12, y:y+0.12, w:0.34, h:0.34, fill:{color:color}, line:{type:'none'} });
  s.addText(String(num), { x:x+0.12, y:y+0.12, w:0.34, h:0.34, fontFace:TH, fontSize:12, bold:true, color:WHITE, align:'center', valign:'middle' });
  s.addText(head, { x:x+0.56, y:y+0.1, w:w-0.68, h:0.3, fontFace:TH, fontSize:12, bold:true, color:INK, valign:'middle' });
  s.addText(body, { x:x+0.56, y:y+0.4, w:w-0.68, h:0.42, fontFace:TH, fontSize:9.7, color:MUTED, valign:'top' }); }

// =====================================================================
// SLIDE 1 — TITLE
// =====================================================================
let s = p.addSlide(); bg(s, NAVY);
s.addShape('oval', { x:-2.2, y:-2.4, w:6, h:6, fill:{color:'12386B'}, line:{type:'none'} });
s.addShape('oval', { x:9.4, y:4.6, w:5.2, h:5.2, fill:{color:'123A6E'}, line:{type:'none'} });
s.addText('ATOM NURSERY', { x:0.9, y:1.2, w:7.6, h:0.4, fontFace:TH, fontSize:15, bold:true, color:'7FB3F2', charSpacing:3 });
s.addText('คู่มือการใช้งาน\nสำหรับผู้ปกครอง', { x:0.85, y:1.7, w:7.7, h:2.1, fontFace:TH, fontSize:44, bold:true, color:WHITE, lineSpacingMultiple:1.0 });
s.addText('เข้าใจทุกเมนู ทุกฟังก์ชัน — ลงทะเบียน · รับ-ส่ง · ชำระเงิน · บันทึกประจำวัน · พัฒนาการ · แชท',
  { x:0.9, y:3.95, w:7.5, h:0.9, fontFace:TH, fontSize:15, color:'CFE0F5', lineSpacingMultiple:1.15 });
s.addShape('roundRect', { x:0.9, y:5.15, w:3.5, h:0.5, rectRadius:0.1, fill:{color:BLUE}, line:{type:'none'} });
s.addText('แอปเปิดผ่าน LINE OA ของโรงเรียน', { x:0.9, y:5.15, w:3.5, h:0.5, fontFace:TH, fontSize:11.5, bold:true, color:WHITE, align:'center', valign:'middle' });
// mini phone on right
phone(s, 9.5, 1.15, 2.7, [
  { headline:'สวัสดีค่ะ คุณกานต์ 👋' },
  { fill:BLUELT, lines:[ {t:'บีม',b:true,c:BLUE,s:13}, {t:'🏫 Nursery 1 · 1 ปี 2 เดือน',c:MUTED,s:8.5}, {t:'07:00–17:00 น. · แพ้: นมวัว',c:MUTED,s:8.5} ] },
  { buttons:[ {t:'🟢 ส่งเข้าเรียน',c:GREEN}, {t:'🔴 รับกลับ',c:PINK} ] },
  { lines:[ {t:'📒 บันทึกของ บีม วันนี้',b:true,s:9.5}, {t:'⏳ รอคุณครูส่งข้อมูล',c:MUTED,s:8.5} ] },
], 'หน้าหลัก (Home)');

// =====================================================================
// SLIDE 2 — AGENDA
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'ภาพรวมคู่มือ'); title(s,'ในคู่มือนี้มีอะไรบ้าง');
const ag = [
  ['📝','ลงทะเบียน & จัดการบุตรหลาน','ลงทะเบียนครั้งแรก · เพิ่มเด็ก 2 คน · ลบ/ยกเลิกการผูก',BLUE],
  ['🧭','เมนูด้านบน & เมนูล่าง','ความหมายของทุกไอคอนที่เห็นบนหน้าจอ',BLUEDK],
  ['🏠','หน้าหลัก & ประกาศ','การ์ดเด็ก · ป๊อปอัปประกาศ · แจ้งลา · ประกัน · ปฏิทิน',GREEN],
  ['📍','รับ-ส่งเด็ก (GPS)','เช็คอิน-เอาท์ในรัศมีโรงเรียน แจ้งครูอัตโนมัติ',BLUE],
  ['💳','ชำระเงิน','บิลรายเดือน · QR/แนบสลิป/เงินสด · OT นักเรียน',AMBER],
  ['📒','บันทึกประจำวัน','กิน-นอน-ขับถ่าย-อารมณ์ ที่ครูบันทึกให้ทุกวัน',BLUE],
  ['📈','พัฒนาการ (DSPM)','ประเมินพัฒนาการ 5 ด้าน · กราฟโต · วัคซีน',PINK],
  ['💬','แชทกับโรงเรียน','คุยผ่าน LINE OA ที่เดียว ไม่ตกหล่น',GREEN],
];
ag.forEach((a,i)=>{ const col=i%2, row=Math.floor(i/2);
  iconRow(s, 0.7+col*6.2, 1.55+row*1.28, 6.0, a[0], a[3], a[1], a[2]); });
foot(s); pageNum(s,2);

// =====================================================================
// SLIDE 3 — REGISTER + ADD CHILD
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'เริ่มต้นใช้งาน'); title(s,'ลงทะเบียน & เพิ่มบุตรหลาน 2 คน');
phone(s, 0.75, 1.5, 2.55, [
  { headline:'👶 เพิ่มบุตรหลาน' },
  { fill:BLUELT, lines:[ {t:'📝 ลงทะเบียนเด็กใหม่',b:true,c:BLUE,s:10} ] },
  { lines:[ {t:'เคยลงทะเบียนแล้ว',c:MUTED,s:8.5}, {t:'เลขบัตร ปชช. เด็ก…',c:INK,s:9} ] },
  { buttons:[ {t:'🔗 เชื่อมข้อมูล',c:BLUEDK} ] },
], 'หน้าเพิ่มบุตรหลาน');
// steps
panel(s, 3.7, 1.5, 4.55, 2.35, 'แบบ A — เด็กใหม่ (ยังไม่มีในระบบ)', BLUE, [
  'หน้าหลัก → กด "+ เพิ่มบุตรหลาน"',
  'เลือก 📝 ลงทะเบียนเด็กใหม่',
  'กรอก: ชื่อ-สกุล · ชื่อเล่น · เลขบัตร · วันเกิด · เพศ · ประวัติแพ้ · รูป · คนรับ-ส่ง (สูงสุด 4)',
  'กดบันทึก → ระบบจัดชั้นเรียนให้อัตโนมัติตามอายุ',
]);
panel(s, 3.7, 4.05, 4.55, 1.95, 'แบบ B — เด็กมีในระบบแล้ว', GREEN, [
  'ใช้เมื่อพ่อ/แม่อีกคนลงทะเบียนไว้แล้ว',
  'ช่อง "เคยลงทะเบียนแล้ว" → กรอกเลขบัตร ปชช. ของเด็ก',
  'กด 🔗 เชื่อมข้อมูล → ผูกเด็กเข้าบัญชีทันที (ไม่สร้างข้อมูลซ้ำ)',
], GREENLT);
panel(s, 8.5, 1.5, 4.15, 4.5, 'เพิ่มเด็กคนที่ 2 (และคนถัดไป)', AMBER, [
  'ทำซ้ำขั้นตอนเดิมอีกครั้ง: กด "+ เพิ่มบุตรหลาน" แล้วเลือกแบบ A หรือ B',
  'เด็กแต่ละคนจะขึ้นเป็น "การ์ดแยกกัน" บนหน้าหลัก',
  'ทุกเมนูทำงานแยกรายคน: ส่ง-รับ / บันทึก / พัฒนาการ / ชำระเงิน',
  'สลับดูเด็กแต่ละคนได้จากการ์ดของแต่ละคนโดยตรง',
  'ชั้นเรียนเริ่มต้นตั้งตามอายุ: 0–1 ปี Nursery Baby · 1–2 ปี N1 · 2–3 ปี N2 · 3 ปีขึ้นไป N3 (Premium ทางโรงเรียนกำหนดเอง)',
], AMBERLT);
foot(s); pageNum(s,3);

// =====================================================================
// SLIDE 4 — REMOVE / UNLINK
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'จัดการบุตรหลาน'); title(s,'นำเด็กออก / ยกเลิกการผูก (Unlink)');
s.addText('มี 2 อย่างที่ต่างกัน — เลือกให้ถูกตามสถานการณ์', { x:0.62, y:1.18, w:11, h:0.4, fontFace:TH, fontSize:13, color:MUTED });
// two comparison cards
s.addShape('roundRect', { x:0.7, y:1.75, w:5.7, h:3.0, rectRadius:0.12, fill:{color:GREENLT}, line:{color:GREEN,width:1.25} });
s.addText('✂️  ยกเลิกการผูก (Unlink)', { x:0.95, y:1.95, w:5.2, h:0.4, fontFace:TH, fontSize:16, bold:true, color:GREEN });
s.addText([
  {text:'ตัดผู้ปกครอง 1 คน ออกจากเด็ก', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'เด็กยังเรียนอยู่ในระบบตามปกติ (ACTIVE)', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'ใช้เมื่อผูกผิดคน / พ่อแม่แยกบัญชี', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'ทำได้เฉพาะ Admin เท่านั้น', options:{bullet:{code:'2022'},breakLine:false,fontFace:TH,fontSize:12.5,bold:true,color:GREEN}},
], { x:0.95, y:2.45, w:5.2, h:2.2, valign:'top' });
s.addShape('roundRect', { x:6.9, y:1.75, w:5.7, h:3.0, rectRadius:0.12, fill:{color:AMBERLT}, line:{color:AMBER,width:1.25} });
s.addText('🚪  แจ้งลาออก (Withdraw)', { x:7.15, y:1.95, w:5.2, h:0.4, fontFace:TH, fontSize:16, bold:true, color:AMBER });
s.addText([
  {text:'เด็กออกจากโรงเรียน "ทั้งระบบ"', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'หลุดจากรายชื่อนักเรียนที่กำลังเรียน', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'ใช้เมื่อเด็กลาออก/ย้ายโรงเรียนจริง', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'ทำได้เฉพาะ Admin เท่านั้น', options:{bullet:{code:'2022'},breakLine:false,fontFace:TH,fontSize:12.5,bold:true,color:AMBER}},
], { x:7.15, y:2.45, w:5.2, h:2.2, valign:'top' });
panel(s, 0.7, 5.0, 11.9, 1.75, 'ขั้นตอนยกเลิกการผูก (สำหรับ Admin)', BLUE, [
  'เข้า "จัดการ (Manage) → นักเรียน" แล้วกด ✏️ แก้ไข เด็กที่ต้องการ',
  'เลื่อนลงล่างสุด กดปุ่ม 🔗 "ผู้ปกครองที่ผูก / ยกเลิกการผูก"',
  'จะเห็นรายชื่อผู้ปกครองที่ผูกกับเด็กคนนี้ → กด ✂️ ยกเลิกผูก ข้างคนที่ต้องการ → ยืนยัน',
  'ผู้ปกครองไม่มีปุ่มนี้ — ต้องแจ้ง Admin ให้ดำเนินการ (มีบันทึก audit log ทุกครั้ง)',
]);
foot(s); pageNum(s,4);

// =====================================================================
// SLIDE 5 — TOP MENU ICONS
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'รู้จักหน้าจอ'); title(s,'เมนูด้านบน (แถบหัว) — ไอคอนต่าง ๆ');
// header strip mock
s.addShape('roundRect', { x:0.7, y:1.35, w:11.9, h:0.9, rectRadius:0.12, fill:{color:BLUE}, line:{type:'none'} });
s.addText('🍎  Atom Nursery', { x:0.95, y:1.35, w:4, h:0.9, fontFace:TH, fontSize:15, bold:true, color:WHITE, valign:'middle' });
s.addText('📒 📈     TH     🔔     กานต์ ▸ 👤     ออก', { x:5.2, y:1.35, w:7.2, h:0.9, fontFace:TH, fontSize:14, color:WHITE, align:'right', valign:'middle' });
const top = [
  ['📒 / 📈','ทางลัด บันทึก / พัฒนาการ','สองปุ่มลัดของลูกคนแรก — เปิดบันทึกประจำวันและหน้าพัฒนาการได้ทันที',BLUE],
  ['TH','สลับภาษา ไทย / อังกฤษ','กดสลับทั้งแอปเป็นไทย↔อังกฤษ ทุกเมนูและปุ่ม',BLUEDK],
  ['🔔','กระดิ่งแจ้งเตือน','แจ้งเตือนในแอป (เช่น ประกาศ/สถานะคำขอ) มีตัวเลขสีแดงบอกจำนวนที่ยังไม่อ่าน',AMBER],
  ['👤','ชื่อ & รูปโปรไฟล์','แตะเพื่อเปิด "ข้อมูลของฉัน" — แก้ข้อมูลผู้ปกครอง/เด็ก และดูบุตรหลานที่ผูกไว้',GREEN],
  ['🍎','โลโก้ (มุมซ้าย)','แตะกลับหน้าหลักได้ทุกเมื่อ',PINK],
  ['ออก','ออกจากระบบ','ลงชื่อออก (ครั้งถัดไปเข้าใหม่ผ่าน LINE)',MUTED],
];
top.forEach((a,i)=>{ const col=i%2,row=Math.floor(i/2);
  iconRow(s, 0.7+col*6.2, 2.7+row*1.28, 6.0, a[0], a[3], a[1], a[2]); });
foot(s); pageNum(s,5);

// =====================================================================
// SLIDE 6 — BOTTOM NAV
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'รู้จักหน้าจอ'); title(s,'เมนูล่าง (แถบนำทางหลัก) — 6 เมนู');
const nav=[
  ['🏠','หน้าหลัก','ภาพรวมของลูก การ์ดเด็ก บันทึกวันนี้ ประกาศ ปฏิทิน',BLUE],
  ['📍','รับ-ส่ง','เช็คอิน-เอาท์ด้วย GPS + ประวัติการรับ-ส่ง',GREEN],
  ['💳','ชำระเงิน','บิลรายเดือน · OT · แนบสลิป/QR/เงินสด',AMBER],
  ['📒','บันทึก','บันทึกประจำวันที่ครูทำให้ (กิน-นอน-อารมณ์)',BLUEDK],
  ['📈','พัฒนาการ','ประเมิน DSPM · กราฟการเจริญเติบโต · วัคซีน',PINK],
  ['💬','แชท','คุยกับโรงเรียนผ่าน LINE OA',GREEN],
];
nav.forEach((a,i)=>{ const col=i%3,row=Math.floor(i/3);
  const x=0.75+col*4.05, y=1.7+row*2.35;
  s.addShape('roundRect', { x, y, w:3.75, h:2.05, rectRadius:0.12, fill:{color:CARD}, line:{color:LINE,width:1} });
  chip(s, x+0.28, y+0.28, a[0], a[3], 0.7);
  s.addText(a[1], { x:x+1.15, y:y+0.28, w:2.4, h:0.7, fontFace:TH, fontSize:16, bold:true, color:INK, valign:'middle' });
  s.addText(a[2], { x:x+0.28, y:y+1.12, w:3.2, h:0.8, fontFace:TH, fontSize:11.5, color:MUTED, valign:'top' }); });
// nav bar mock
s.addShape('roundRect', { x:3.4, y:6.55, w:6.5, h:0.62, rectRadius:0.3, fill:{color:NAVY}, line:{type:'none'} });
s.addText('🏠   📍   💳   📒   📈   💬', { x:3.4, y:6.55, w:6.5, h:0.62, fontFace:TH, fontSize:16, color:WHITE, align:'center', valign:'middle' });
foot(s); pageNum(s,6);

// =====================================================================
// SLIDE 7 — HOME + POPUP (annotated)
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'หน้าหลัก'); title(s,'หน้าหลัก & ป๊อปอัปประกาศ — แยกเป็นส่วน');
phone(s, 0.75, 1.45, 2.75, [
  { headline:'สวัสดีค่ะ คุณกานต์ 👋' },
  { fill:BLUELT, lines:[ {t:'บีม',b:true,c:BLUE,s:12}, {t:'🏫 Nursery 1 · 07:00–17:00',c:MUTED,s:8}, {t:'แพ้: นมวัว',c:MUTED,s:8} ] },
  { buttons:[ {t:'🟢 ส่ง',c:GREEN}, {t:'🔴 รับ',c:PINK} ] },
  { lines:[ {t:'📒 บันทึกของ บีม วันนี้',b:true,s:9}, {t:'⏳ รอคุณครูส่งข้อมูล',c:MUTED,s:8} ] },
  { lines:[ {t:'🏠 แจ้งลาบุตรหลาน  + แจ้งลา',b:true,s:9} ] },
  { lines:[ {t:'📢 ประกาศจากโรงเรียน',b:true,c:AMBER,s:9}, {t:'ตรวจมือเท้าปากช่วงเช้า…',c:MUTED,s:8} ] },
], 'หน้าหลัก');
const co=[
  ['1','การ์ดบุตรหลาน','ชื่อเล่นตัวใหญ่ + ชั้นเรียน + เวลาเข้า-เลิก + ประวัติแพ้ · มีปุ่ม 🟢 ส่งเข้าเรียน / 🔴 รับกลับ ในตัว',BLUE],
  ['2','บันทึกของวันนี้','สรุปบันทึกประจำวันของลูก ถ้าครูยังไม่ส่งจะขึ้น "รอคุณครูส่งข้อมูล"',BLUEDK],
  ['3','แจ้งลาบุตรหลาน','กด "+ แจ้งลา" เลือกวันที่ + ประเภท (ป่วย/กิจ/พักร้อน) + เหตุผล แล้วส่งถึงครู',GREEN],
  ['4','ข้อมูลประกัน (PCHI)','กรอกข้อมูลประกันอุบัติเหตุของลูกไว้ครั้งเดียว เผื่อกรณีฉุกเฉิน',PINK],
  ['5','ประกาศ + ปฏิทิน','ข่าวจากโรงเรียน และปฏิทินแสดงวันมา-ลา-หยุด ของลูก',AMBER],
];
co.forEach((c,i)=> callout(s, 4.05+ (i%2)*4.35, 1.5 + Math.floor(i/2)*1.02, 4.2, c[0], c[1], c[2], c[3]));
// popup note
s.addShape('roundRect', { x:8.4, y:4.56, w:4.2, h:2.15, rectRadius:0.1, fill:{color:NAVY}, line:{type:'none'} });
s.addText('💡 ป๊อปอัปประกาศ', { x:8.6, y:4.72, w:3.8, h:0.36, fontFace:TH, fontSize:13, bold:true, color:'8Fc0F5' });
s.addText('เมื่อเปิดแอป ประกาศสำคัญจะ "เด้งขึ้นกลางจอ" ก่อน ให้อ่านแล้วปิด เพื่อไม่ให้พลาดข่าวเร่งด่วน เช่น การระบาดของโรค หรือวันหยุด — ประกาศทั้งหมดยังดูซ้ำได้ที่การ์ด "ประกาศจากโรงเรียน" ด้านล่าง',
  { x:8.6, y:5.1, w:3.85, h:1.5, fontFace:TH, fontSize:10.5, color:'DCEBFB', valign:'top', lineSpacingMultiple:1.05 });
foot(s); pageNum(s,7);

// =====================================================================
// SLIDE 8 — ANNOUNCEMENTS meaning
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'ประกาศ'); title(s,'ประกาศจากโรงเรียน — แต่ละแบบหมายถึงอะไร');
panel(s, 0.7, 1.55, 5.75, 2.5, '🔔 ประเภทของประกาศ', BLUE, [
  'Pop-up (เด้งกลางจอ): เรื่องสำคัญ/เร่งด่วน อยากให้เห็นทันทีที่เปิดแอป',
  'ประกาศทั่วไป: แสดงในการ์ด "ประกาศจากโรงเรียน" ให้เลื่อนอ่านย้อนหลังได้',
  'ระดับความสำคัญ ⭐ สูง: เน้นสีส้ม อยู่บนสุด',
  'แต่ละประกาศมี ช่วงวันที่เริ่ม–สิ้นสุด ที่แสดง',
]);
panel(s, 6.65, 1.55, 5.95, 2.5, '📄 ในประกาศมีอะไรบ้าง', GREEN, [
  'หัวข้อ + เนื้อหา (ไทย/อังกฤษ)',
  'รูปภาพประกอบ (ถ้ามี)',
  'วันที่ประกาศ และวันหมดอายุการแสดง',
  'ตัวอย่างจริง: "เช้านี้จะตรวจเช็คอาการมือเท้าปากในเด็กช่วงเช้า…"',
]);
s.addShape('roundRect', { x:0.7, y:4.35, w:11.9, h:2.35, rectRadius:0.12, fill:{color:AMBERLT}, line:{color:AMBER,width:1} });
s.addText('ตัวอย่างประกาศจริงในระบบ', { x:0.95, y:4.5, w:11, h:0.4, fontFace:TH, fontSize:13, bold:true, color:AMBER });
s.addText('"ได้รับแจ้งจากผู้ปกครองเมื่อวานว่ามีเด็กป่วยจากเนอสเซอรี่ 1 เป็นมือเท้าปาก จำนวน 4 ท่าน กรุณาสังเกตอาการบุตรหลานของท่าน หากมีไข้ ผื่น หรือแผลในปาก โปรดพาไปพบแพทย์"',
  { x:0.95, y:4.95, w:11.4, h:1.0, fontFace:TH, fontSize:14, italic:true, color:INK, valign:'top', lineSpacingMultiple:1.15 });
s.addText('👉 ประกาศแบบนี้จะตั้งเป็น Pop-up เพื่อให้ผู้ปกครองเห็นทันทีที่เปิดแอป', { x:0.95, y:6.05, w:11.4, h:0.5, fontFace:TH, fontSize:12, bold:true, color:AMBER });
foot(s); pageNum(s,8);

// =====================================================================
// SLIDE 9 — CHECK-IN / OUT
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'รับ-ส่งเด็ก'); title(s,'รับ-ส่งเด็ก (GPS) — วิธีใช้และรายละเอียด');
phone(s, 0.75, 1.5, 2.6, [
  { headline:'📍 รับ-ส่งเด็ก (GPS)' },
  { buttons:[ {t:'🟢 ส่งเข้าเรียน',c:GREEN} ] },
  { buttons:[ {t:'🔴 รับกลับ',c:PINK} ] },
  { fill:AMBERLT, lines:[ {t:'ต้องอยู่ในรัศมี 50 ม.',b:true,c:AMBER,s:9}, {t:'จากโรงเรียน',c:MUTED,s:8.5} ] },
  { lines:[ {t:'🗓️ ประวัติการรับ-ส่ง',b:true,s:9}, {t:'05-06  ↓08:00 ↑17:35',c:MUTED,s:8.5}, {t:'04-06  ↓07:48 ↑16:50',c:MUTED,s:8.5} ] },
], 'หน้ารับ-ส่ง');
panel(s, 3.7, 1.5, 4.35, 2.6, 'ขั้นตอนใช้งาน', BLUE, [
  'เปิดจากการ์ดลูกในหน้าหลัก หรือเมนู 📍 รับ-ส่ง',
  'อยู่ในบริเวณโรงเรียน (ในรัศมีที่ตั้งไว้ เช่น 50 ม.)',
  'กด 🟢 ส่งเข้าเรียน ตอนมาส่ง / 🔴 รับกลับ ตอนมารับ',
  'อนุญาตให้แอปเข้าถึงตำแหน่ง (GPS) เมื่อระบบถาม',
]);
panel(s, 8.2, 1.5, 4.4, 2.6, 'ระบบทำอะไรให้อัตโนมัติ', GREEN, [
  'บันทึกเวลาเข้า/ออกจริง พร้อมตรวจว่าอยู่ในรัศมีโรงเรียน',
  'แจ้งเตือนคุณครูประจำชั้นทันทีที่ส่ง/รับ',
  'กันกดซ้ำ: ถ้ากดซ้ำในเวลาใกล้กัน ระบบใช้เวลาล่าสุดให้',
], GREENLT);
s.addShape('roundRect', { x:3.7, y:4.35, w:8.9, h:2.35, rectRadius:0.12, fill:{color:AMBERLT}, line:{color:AMBER,width:1.25} });
s.addText('⏰ รับช้า = เกิดค่า OT อัตโนมัติ', { x:3.95, y:4.55, w:8.4, h:0.4, fontFace:TH, fontSize:15, bold:true, color:AMBER });
s.addText([
  {text:'ถ้ากด "รับกลับ" หลังเวลาเลิกเรียนของลูก (เกินช่วงผ่อนผัน) ระบบจะคิดค่าล่วงเวลา (OT) ให้ทันที', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'คิดตาม "เวลาเลิกเรียนจริงของลูกแต่ละคน" (เช่น 17:00 หรือ 18:00) ไม่เหมารวมทุกคน', options:{bullet:{code:'2022'},breakLine:true,paraSpaceAfter:7,fontFace:TH,fontSize:12.5,color:INK}},
  {text:'จะมีป๊อปอัป QR ให้ชำระ และยอดจะไปแสดงที่เมนู 💳 ชำระเงิน → OT', options:{bullet:{code:'2022'},breakLine:false,fontFace:TH,fontSize:12.5,color:INK}},
], { x:3.95, y:5.05, w:8.4, h:1.5, valign:'top' });
foot(s); pageNum(s,9);

// =====================================================================
// SLIDE 10 — PAYMENT overview
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'ชำระเงิน (1/3)'); title(s,'ชำระเงิน — บิลรายเดือน');
phone(s, 0.75, 1.5, 2.7, [
  { headline:'💳 การชำระเงิน · บีม' },
  { fill:BLUELT, lines:[ {t:'งวด 2026-06  ค้างชำระ',b:true,c:RED,s:9},
    {t:'ค่าเทอม            8,000',c:INK,s:8.5}, {t:'ค่าอาหาร          1,500',c:INK,s:8.5},
    {t:'ค่ากิจกรรม          500',c:INK,s:8.5}, {t:'OT ยกมา            200',c:AMBER,s:8.5},
    {t:'รวม              10,800',b:true,c:INK,s:9.5} ] },
  { buttons:[ {t:'📲 QR',c:BLUE}, {t:'📎 สลิป',c:BLUEDK}, {t:'💵 สด',c:MUTED} ] },
  { fill:GREENLT, lines:[ {t:'งวด 2026-05  ชำระแล้ว ✓',b:true,c:GREEN,s:9}, {t:'🧾 ใบเสร็จ',c:GREEN,s:8.5} ] },
], 'หน้าชำระเงิน');
panel(s, 3.7, 1.5, 4.35, 2.75, 'บิลรายเดือนบอกอะไร', BLUE, [
  'แยกรายการ: ค่าเทอม · ค่าอาหาร · ค่ากิจกรรม · ค่าเรียนพิเศษ',
  '"OT ยกมา": ค่ารับช้าที่ยังไม่จ่าย จะถูกรวมเข้าบิล',
  'ยอดรวม + วันครบกำหนดชำระ',
  'สถานะ: ค้างชำระ / ชำระบางส่วน / รอตรวจสอบ / ชำระแล้ว',
]);
panel(s, 8.2, 1.5, 4.4, 2.75, 'ชำระล่วงหน้ารับส่วนลด', GREEN, [
  'กด "💰 จ่ายล่วงหน้า" เพื่อดูตัวเลือก',
  'จ่ายหลายเดือนพร้อมกันได้ส่วนลด (เช่น 2/3/6/12 เดือน)',
  'ระบบสร้างงวดที่ครอบคลุมให้อัตโนมัติ',
], GREENLT);
panel(s, 3.7, 4.5, 8.9, 2.2, 'สถานะการชำระ — อ่านอย่างไร', AMBER, [
  'ค้างชำระ (แดง): ยังไม่ได้จ่าย',
  'รอตรวจสอบ (เหลือง): แนบสลิปแล้ว รอแอดมินยืนยัน',
  'ชำระบางส่วน: จ่ายมาแล้วบางส่วน เหลือยอดคงค้าง — แนบสลิปเพิ่มได้',
  'ชำระแล้ว (เขียว): จ่ายครบ กดดู 🧾 ใบเสร็จ ได้',
], AMBERLT);
foot(s); pageNum(s,10);

// =====================================================================
// SLIDE 11 — PAYMENT methods + slip
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'ชำระเงิน (2/3)'); title(s,'วิธีชำระเงิน & การแนบสลิป');
const pm=[
  ['📲','QR พร้อมเพย์','กดปุ่ม QR → สแกนจ่ายจากแอปธนาคาร → กลับมาแนบสลิป',BLUE],
  ['📎','แนบสลิปโอน','แนบรูปสลิป ระบบตรวจยอดอัตโนมัติ (SlipOK) แล้วส่งให้แอดมินยืนยัน',BLUEDK],
  ['💵','แจ้งชำระเงินสด','แจ้งว่าจ่ายสด ครู/แอดมินยืนยันและบันทึกวันที่ให้',GREEN],
];
pm.forEach((a,i)=>{ const x=0.7+i*4.05;
  s.addShape('roundRect', { x, y:1.55, w:3.75, h:1.9, rectRadius:0.12, fill:{color:CARD}, line:{color:LINE,width:1} });
  chip(s, x+0.28, y=1.8, a[0], a[3], 0.66);
  s.addText(a[1], { x:x+1.1, y:1.85, w:2.5, h:0.6, fontFace:TH, fontSize:14.5, bold:true, color:INK, valign:'middle' });
  s.addText(a[2], { x:x+0.28, y:2.62, w:3.2, h:0.75, fontFace:TH, fontSize:11, color:MUTED, valign:'top' }); });
// slip steps as numbered flow
s.addText('ขั้นตอนแนบสลิป (แนะนำ — เร็วและตรวจยอดอัตโนมัติ)', { x:0.7, y:3.75, w:11.9, h:0.4, fontFace:TH, fontSize:15, bold:true, color:BLUE });
const st=[
  ['1','กดปุ่ม 📎 แนบสลิป','ที่บิลหรือรายการ OT ที่ต้องการจ่าย'],
  ['2','เลือกรูปสลิป','ระบบอ่าน QR/ยอดในสลิปให้อัตโนมัติ (SlipOK)'],
  ['3','ตรวจยอดที่โอน','ถ้าตรงจะขึ้น ✅ ถ้าไม่ตรงเตือน ⚠️ ให้แก้ก่อนส่ง'],
  ['4','กดส่ง','สถานะเป็น "รอตรวจสอบ" → แอดมินยืนยัน → "ชำระแล้ว"'],
];
st.forEach((a,i)=>{ const x=0.7+i*3.0;
  s.addShape('roundRect', { x, y:4.35, w:2.75, h:1.95, rectRadius:0.1, fill:{color:WHITE}, line:{color:BLUE,width:1} });
  s.addShape('oval', { x:x+0.2, y:4.55, w:0.5, h:0.5, fill:{color:BLUE}, line:{type:'none'} });
  s.addText(a[0], { x:x+0.2, y:4.55, w:0.5, h:0.5, fontFace:TH, fontSize:16, bold:true, color:WHITE, align:'center', valign:'middle' });
  s.addText(a[1], { x:x+0.2, y:5.15, w:2.4, h:0.55, fontFace:TH, fontSize:12.5, bold:true, color:INK, valign:'top' });
  s.addText(a[2], { x:x+0.2, y:5.68, w:2.4, h:0.55, fontFace:TH, fontSize:10, color:MUTED, valign:'top' });
  if(i<3) s.addText('▸', { x:x+2.72, y:4.9, w:0.35, h:0.5, fontFace:TH, fontSize:18, bold:true, color:BLUE, align:'center' }); });
s.addText('💡 แนบสลิปเพิ่มได้หลายใบจนกว่าจะครบยอด (กรณีจ่ายบางส่วน)', { x:0.7, y:6.45, w:11.9, h:0.35, fontFace:TH, fontSize:11.5, italic:true, color:MUTED });
foot(s); pageNum(s,11);

// =====================================================================
// SLIDE 12 — OT student
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'ชำระเงิน (3/3)'); title(s,'OT นักเรียน (ค่ารับช้า)');
phone(s, 0.75, 1.5, 2.7, [
  { headline:'⏰ สรุป OT รายวัน' },
  { fill:AMBERLT, lines:[ {t:'03-06-2026 · 18:10',b:true,s:9}, {t:'สาย 70 นาที · 2 ชม.',c:MUTED,s:8.5}, {t:'200.00 บาท',b:true,c:AMBER,s:10} ] },
  { fill:BLUELT, lines:[ {t:'ยอด OT ค้างชำระ',b:true,s:9}, {t:'200.00 บาท',b:true,c:RED,s:11}, {t:'ถ้าไม่จ่าย จะรวมกับบิลเดือน',c:MUTED,s:8} ] },
  { buttons:[ {t:'📎 แนบสลิป',c:BLUEDK}, {t:'💵 เงินสด',c:MUTED} ] },
], 'OT ในหน้าชำระเงิน');
panel(s, 3.7, 1.5, 8.9, 2.15, 'OT คิดอย่างไร', AMBER, [
  'เกิดเมื่อ "รับกลับ" ช้ากว่าเวลาเลิกเรียนของลูก เกินช่วงผ่อนผัน (เช่น 21 นาที)',
  'คิดตามเวลาเลิกจริงของลูกแต่ละคน — เด็กเลิก 18:00 จะไม่ถูกคิดจาก 17:00',
  'คิดเป็นรายชั่วโมง (เศษปัดขึ้น) × เรตต่อชั่วโมงของโรงเรียน',
], AMBERLT);
panel(s, 3.7, 3.85, 4.35, 2.85, 'ดูและชำระที่ไหน', BLUE, [
  'เมนู 💳 ชำระเงิน → หัวข้อ "สรุป OT รายวัน"',
  'เห็นวันที่ · เวลาที่รับ · จำนวนสาย/ชั่วโมง · ยอดเงิน',
  'มี "ยอด OT ค้างชำระ" รวมให้',
  'ชำระแยกได้ด้วย 📎 แนบสลิป หรือ 💵 เงินสด',
]);
panel(s, 8.2, 3.85, 4.4, 2.85, 'ถ้ายังไม่จ่าย OT', GREEN, [
  'ยอด OT ที่ค้างจะถูก "ยกไปรวม" ในบิลรายเดือนโดยอัตโนมัติ',
  'จ่ายรวมทีเดียวกับค่าเทอมก็ได้',
  'คุณครูที่ดูแลชั้นก็ช่วยติดตาม/แนบสลิปแทนได้ในบางกรณี',
], GREENLT);
foot(s); pageNum(s,12);

// =====================================================================
// SLIDE 13 — Daily journal
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'บันทึกประจำวัน'); title(s,'บันทึก (Daily Journal) — รายละเอียด');
phone(s, 0.75, 1.5, 2.7, [
  { headline:'📒 บันทึกประจำวัน · บีม' },
  { fill:BLUELT, lines:[ {t:'วันนี้ 21-07-2026',b:true,s:9}, {t:'⏳ รอคุณครูส่งข้อมูล',c:AMBER,s:9} ] },
  { headline:'ย้อนหลัง' },
  { lines:[ {t:'08-06  😀 Happy',b:true,s:9.5}, {t:'แตะ "ดู" เพื่อเปิดรายละเอียด',c:MUTED,s:8.5} ] },
], 'หน้าบันทึก');
panel(s, 3.7, 1.5, 8.9, 2.35, 'คุณครูบันทึกอะไรให้บ้าง (ทุกวัน)', BLUE, [
  'อารมณ์ของเด็ก 😀 · การรับประทานอาหาร/นม · การนอนกลางวัน',
  'การขับถ่าย · สุขภาพ/อาการที่สังเกต · กิจกรรม/ธีมการเรียนรู้ของวัน',
  'ปริมาณนม/น้ำ และหมายเหตุอื่น ๆ ที่ครูอยากแจ้ง',
]);
panel(s, 3.7, 4.05, 4.35, 2.65, 'สถานะบันทึก', AMBER, [
  '⏳ รอคุณครูส่งข้อมูล: ยังไม่ส่งของวันนี้',
  '📝 ฉบับร่าง: ครูกำลังทำ ยังไม่ส่ง',
  '✅ ส่งแล้ว: พร้อมเวลาที่ส่ง — อ่านได้เลย',
], AMBERLT);
panel(s, 8.2, 4.05, 4.4, 2.65, 'ผู้ปกครองทำอะไรได้', GREEN, [
  'เปิดอ่านบันทึกของแต่ละวัน (รวมย้อนหลัง)',
  'พิมพ์ "ความคิดเห็น/ข้อความถึงครู" ใต้บันทึกได้',
  'เปิดเร็วได้จากปุ่มลัด 📒 บนแถบหัว หรือเมนูล่าง',
], GREENLT);
foot(s); pageNum(s,13);

// =====================================================================
// SLIDE 14 — DSPM
// =====================================================================
s = p.addSlide(); bg(s, WHITE);
kicker(s,'พัฒนาการ'); title(s,'พัฒนาการ (DSPM) — วัดอะไร สำคัญอย่างไร');
s.addShape('roundRect', { x:0.7, y:1.4, w:11.9, h:1.0, rectRadius:0.1, fill:{color:BLUELT}, line:{type:'none'} });
s.addText('DSPM = คู่มือเฝ้าระวังและส่งเสริมพัฒนาการเด็กปฐมวัย (กรมอนามัย/กรมสุขภาพจิต) — ประเมินว่าเด็ก "ทำได้ตามวัย" หรือไม่ เพื่อส่งเสริม/ช่วยเหลือได้เร็ว',
  { x:0.95, y:1.5, w:11.4, h:0.8, fontFace:TH, fontSize:12.5, color:INK, valign:'middle', lineSpacingMultiple:1.1 });
const dom=[
  ['GM','กล้ามเนื้อมัดใหญ่','นั่ง ยืน เดิน วิ่ง กระโดด',BLUE],
  ['FM','กล้ามเนื้อมัดเล็ก','หยิบจับ ขีดเขียน ใช้มือ-นิ้ว',BLUEDK],
  ['RL','ภาษา (เข้าใจ)','ฟังเข้าใจ ทำตามคำสั่ง',GREEN],
  ['EL','ภาษา (แสดงออก)','พูด บอกความต้องการ',AMBER],
  ['PS','ส่วนบุคคล-สังคม','ช่วยเหลือตัวเอง เล่นกับผู้อื่น',PINK],
];
dom.forEach((a,i)=>{ const x=0.7+i*2.4;
  s.addShape('roundRect', { x, y:2.65, w:2.2, h:1.5, rectRadius:0.1, fill:{color:CARD}, line:{color:LINE,width:1} });
  chip(s, x+0.75, y=2.8, a[0], a[3], 0.7);
  s.addText(a[1], { x:x+0.05, y:3.55, w:2.1, h:0.35, fontFace:TH, fontSize:11.5, bold:true, color:INK, align:'center' });
  s.addText(a[2], { x:x+0.1, y:3.85, w:2.0, h:0.28, fontFace:TH, fontSize:9, color:MUTED, align:'center' }); });
panel(s, 0.7, 4.4, 5.85, 2.3, 'ดูอย่างไร / เห็นอะไร', BLUE, [
  'เมนู 📈 พัฒนาการ ของลูกแต่ละคน',
  'ช่วงวัยปัจจุบัน + รายการประเมินแต่ละข้อ: ✅ ผ่าน / ❌ ไม่ผ่าน / ⏳ ยังไม่ประเมิน',
  'กราฟการเจริญเติบโต: น้ำหนัก/ส่วนสูง เทียบ "แถบเกณฑ์ปกติตามวัย"',
  'บันทึกวัคซีน: ติ๊กเข็มที่ได้รับ ตามตารางวัคซีนพื้นฐาน',
]);
panel(s, 6.75, 4.4, 5.85, 2.3, 'สำคัญอย่างไร', GREEN, [
  'รู้เร็วว่าลูกพัฒนาการตามวัยไหม ถ้าล่าช้าจะช่วยเหลือได้ทัน',
  'เห็นการเติบโต (โต/ผอม/เตี้ย) เทียบเกณฑ์มาตรฐาน',
  'ไม่พลาดวัคซีนสำคัญตามช่วงอายุ',
  'พ่อแม่-ครู เห็นข้อมูลชุดเดียวกัน ส่งเสริมได้ตรงจุด',
], GREENLT);
foot(s); pageNum(s,14);

// =====================================================================
// SLIDE 15 — CHAT + CLOSING
// =====================================================================
s = p.addSlide(); bg(s, NAVY);
s.addShape('oval', { x:10.2, y:-2, w:5.5, h:5.5, fill:{color:'123A6E'}, line:{type:'none'} });
kicker(s,'แชท & สรุป','8FC0F5');
s.addText('แชทกับโรงเรียน', { x:0.62, y:0.55, w:9, h:0.8, fontFace:TH, fontSize:30, bold:true, color:WHITE });
phone(s, 9.4, 1.35, 2.7, [
  { headline:'💬 แชทกับโรงเรียน' },
  { fill:BLUELT, lines:[ {t:'คุยผ่าน LINE OA ที่เดียว',b:true,c:BLUE,s:9.5}, {t:'ครูจัดการรวมศูนย์ ไม่ตกหล่น',c:MUTED,s:8.5} ] },
  { buttons:[ {t:'เปิดแชท LINE OA →',c:GREEN} ] },
], 'หน้าแชท');
s.addShape('roundRect', { x:0.7, y:1.55, w:8.2, h:1.5, rectRadius:0.12, fill:{color:'12386B'}, line:{type:'none'} });
s.addText('💬 การแชททำงานอย่างไร', { x:0.95, y:1.7, w:7.6, h:0.4, fontFace:TH, fontSize:15, bold:true, color:'8FC0F5' });
s.addText('ทุกการพูดคุยทำผ่าน LINE OA ของโรงเรียน — กดปุ่ม "เปิดแชท LINE OA" แล้วระบบพาไปที่ห้องแชท LINE ของโรงเรียนโดยตรง เพื่อให้คุณครูดูแลตอบรวมที่เดียว ข้อความไม่ตกหล่น',
  { x:0.95, y:2.15, w:7.7, h:0.85, fontFace:TH, fontSize:12.5, color:'DCEBFB', valign:'top', lineSpacingMultiple:1.15 });
// recap chips
s.addText('สรุปเมนูหลักของผู้ปกครอง', { x:0.7, y:3.35, w:8, h:0.4, fontFace:TH, fontSize:15, bold:true, color:'8FC0F5' });
const recap=[['🏠','หน้าหลัก'],['📍','รับ-ส่ง'],['💳','ชำระเงิน'],['📒','บันทึก'],['📈','พัฒนาการ'],['💬','แชท']];
recap.forEach((a,i)=>{ const x=0.7+ (i%3)*2.75, y=3.85+Math.floor(i/3)*1.15;
  s.addShape('roundRect', { x, y, w:2.55, h:0.95, rectRadius:0.12, fill:{color:'12386B'}, line:{type:'none'} });
  s.addText(a[0], { x:x+0.15, y, w:0.8, h:0.95, fontFace:TH, fontSize:22, align:'center', valign:'middle' });
  s.addText(a[1], { x:x+0.9, y, w:1.55, h:0.95, fontFace:TH, fontSize:14, bold:true, color:WHITE, valign:'middle' }); });
s.addShape('roundRect', { x:0.7, y:6.35, w:11.9, h:0.7, rectRadius:0.1, fill:{color:BLUE}, line:{type:'none'} });
s.addText('มีคำถามการใช้งาน แตะ 💬 แชท เพื่อสอบถามโรงเรียนผ่าน LINE OA ได้ตลอด', { x:0.7, y:6.35, w:11.9, h:0.7, fontFace:TH, fontSize:13, bold:true, color:WHITE, align:'center', valign:'middle' });

p.writeFile({ fileName: 'C:/Users/Pattara.Th/Downloads/Atom/dist/Atom_Nursery_Parent_Guide.pptx' })
  .then(f => console.log('WROTE', f))
  .catch(e => { console.error(e); process.exit(1); });
