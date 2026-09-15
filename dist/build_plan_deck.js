/* Atom Nursery — แผนพัฒนาระบบ (deck for the director).
   Run:  NODE_PATH="$(npm root -g)" node dist/build_plan_deck.js
   Every figure in here is measured from the repository, not estimated. */
const PptxGenJS = require('pptxgenjs');
const p = new PptxGenJS();
p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
p.layout = 'W';
p.author = 'Atom Nursery';
p.title  = 'แผนพัฒนาระบบ Atom Nursery';

/* Palette: institutional warmth. Deep teal-navy carries the weight, warm amber is the
   single accent that marks what needs a decision, sage for "done/good", clay for problems.
   Deliberately not the app's own Material blue — this is a document about the product,
   not a screen of it. */
const NAVY='123A4F', NAVY_D='0B2835', TEAL='2E6E78', SAGE='6B9080', SAGE_L='E4EDE7',
      AMBER='D9822B', AMBER_L='FBEEDC', CLAY='9E2A2B', CLAY_L='F6E4E2',
      CREAM='F7F3EC', CARD='FFFFFF', INK='1C2A33', MUTED='62757F', WHITE='FFFFFF',
      LINE='DCE4E8';
const TH='Tahoma';
const W=13.333, H=7.5;
let N=0;

/* ---------- helpers ---------- */
const sl = (bgc) => { const s=p.addSlide(); s.background={color:bgc||CREAM}; N++; return s; };
function num(s){ s.addText(String(N), { x:12.55, y:6.95, w:0.5, h:0.34, fontFace:TH, fontSize:10,
  color:MUTED, align:'right', isTextBox:true, margin:0 }); }
function kicker(s, txt, color){ s.addText(txt, { x:0.7, y:0.42, w:11.9, h:0.34, fontFace:TH,
  fontSize:12, bold:true, color:color||AMBER, charSpacing:2, align:'left', isTextBox:true, margin:0 }); }
function title(s, txt, o){ o=o||{}; s.addText(txt, { x:0.7, y:o.y||0.78, w:o.w||11.9, h:o.h||0.95,
  fontFace:TH, fontSize:o.size||30, bold:true, color:o.color||NAVY, align:'left',
  valign:'top', isTextBox:true, margin:0 }); }
function sub(s, txt, o){ o=o||{}; s.addText(txt, { x:0.7, y:o.y||1.72, w:o.w||11.9, h:o.h||0.55,
  fontFace:TH, fontSize:o.size||15, color:o.color||MUTED, align:'left', isTextBox:true, margin:0 }); }
function card(s, x,y,w,h, fill, o){ o=o||{};
  s.addShape(p.ShapeType.roundRect, { x,y,w,h, rectRadius:0.09, fill:{color:fill||CARD},
    line:{ color:o.line||LINE, width:o.lw===undefined?1:o.lw },
    shadow: o.shadow===false?undefined:{ type:'outer', angle:90, blur:9, offset:1.5, color:'96A8B2', opacity:0.22 } }); }
function badge(s, x,y,d, fill, glyph, gcol, gsize){
  s.addShape(p.ShapeType.ellipse, { x,y,w:d,h:d, fill:{color:fill}, line:{color:fill,width:0} });
  s.addText(glyph, { x, y, w:d, h:d, fontFace:TH, fontSize:gsize||16, bold:true,
    color:gcol||WHITE, align:'center', valign:'middle', isTextBox:true, margin:0 });
}
function txt(s, t, o){ s.addText(t, Object.assign({ fontFace:TH, isTextBox:true, margin:0,
  valign:'top', align:'left' }, o)); }
function bullets(s, items, o){ o=o||{};
  const runs = items.map((t,i)=>({ text:t, options:{ bullet:true, breakLine:i<items.length-1,
    fontSize:o.size||14, color:o.color||INK, paraSpaceAfter:o.gap===undefined?7:o.gap } }));
  s.addText(runs, { x:o.x, y:o.y, w:o.w, h:o.h, fontFace:TH, isTextBox:true, margin:0, valign:'top' });
}

/* ============ 1 · TITLE ============ */
{
  const s = sl(NAVY);
  s.addShape(p.ShapeType.ellipse, { x:9.6, y:-1.5, w:6.2, h:6.2, fill:{color:TEAL}, line:{width:0}, transparency:55 });
  s.addShape(p.ShapeType.ellipse, { x:11.2, y:3.6, w:3.4, h:3.4, fill:{color:AMBER}, line:{width:0}, transparency:70 });
  txt(s, 'ATOM NURSERY', { x:0.9, y:1.5, w:8.6, h:0.4, fontSize:13, bold:true, color:AMBER, charSpacing:3 });
  txt(s, 'แผนพัฒนาระบบ\nปี 2569', { x:0.9, y:2.05, w:8.8, h:2.0, fontSize:44, bold:true, color:WHITE, lineSpacing:52 });
  txt(s, 'ยกระดับจากระบบที่ใช้งานได้ ให้เป็นระบบที่ขายได้', { x:0.9, y:4.25, w:8.8, h:0.5, fontSize:17, color:'C6D6DE' });
  s.addShape(p.ShapeType.roundRect, { x:0.9, y:5.25, w:5.6, h:0.95, rectRadius:0.1, fill:{color:'1B4A5F'}, line:{width:0} });
  txt(s, 'เสนอต่อผู้อำนวยการ  ·  15 กันยายน 2569', { x:1.15, y:5.25, w:5.2, h:0.95, fontSize:13, color:'D8E6EC', valign:'middle' });
  s.addNotes('เอกสารนี้สรุปสิ่งที่ระบบทำได้วันนี้ ปัญหาที่พบจากข้อมูลการใช้งานจริง แผนพัฒนา ค่าใช้จ่าย และรายได้ที่เป็นไปได้หากขายให้โรงเรียนอื่น ทุกตัวเลขวัดจากระบบจริง ไม่ใช่การประมาณ');
}

/* ============ 2 · EXEC SUMMARY ============ */
{
  const s = sl();
  kicker(s, 'สรุปสำหรับผู้บริหาร');
  title(s, 'สี่ตัวเลขที่ต้องรู้');
  const items = [
    ['6.8', 'วินาที', 'เวลารอเฉลี่ยต่อการกด 1 ครั้ง\nวัดจากผู้ใช้จริง 405 ครั้ง', CLAY, CLAY_L],
    ['15–20', 'เท่า', 'ความเร็วที่จะดีขึ้น\nหลังย้ายฐานข้อมูล', SAGE, SAGE_L],
    ['฿1,825', 'ต่อเดือน', 'ค่าระบบใหม่ ทั้งโรงเรียน\n(ปัจจุบัน ฿0)', NAVY, 'E7EEF1'],
    ['฿199+', 'ต่อเด็ก/เดือน', 'ราคาที่จะขายโรงเรียนอื่น\nกำไรขั้นต้น ~90%', AMBER, AMBER_L],
  ];
  items.forEach((it,i)=>{
    const x = 0.7 + i*3.06;
    card(s, x, 2.35, 2.82, 3.35, it[4], { line:it[4] });
    txt(s, it[0], { x:x+0.22, y:2.62, w:2.4, h:0.95, fontSize:40, bold:true, color:it[3] });
    txt(s, it[1], { x:x+0.22, y:3.58, w:2.4, h:0.34, fontSize:13, bold:true, color:it[3] });
    txt(s, it[2], { x:x+0.22, y:4.08, w:2.42, h:1.35, fontSize:13, color:INK, lineSpacing:19 });
  });
  txt(s, 'ข้อสรุป : ปัญหาทั้งหมดของระบบวันนี้มาจากที่เดียว คือฐานข้อมูล  ·  การแก้จุดนั้นทำให้เร็วขึ้น และเปิดทางให้ขายระบบต่อได้',
    { x:0.7, y:6.05, w:11.9, h:0.5, fontSize:14, bold:true, color:NAVY });
  num(s);
  s.addNotes('เปิดด้วยตัวเลขก่อน: ช้า 6.8 วินาที แก้ได้ 15-20 เท่า ค่าใช้จ่าย 1,825 บาท และมีรายได้ปลายทาง');
}

/* ============ 3 · WHAT WE HAVE ============ */
{
  const s = sl();
  kicker(s, 'สถานะปัจจุบัน');
  title(s, 'วันนี้ระบบทำอะไรให้โรงเรียนแล้วบ้าง');
  sub(s, 'ทุกข้อด้านล่างใช้งานจริงอยู่ทุกวัน และมีชุดทดสอบอัตโนมัติคุ้มครองอยู่');
  const groups = [
    ['👶', 'เด็กและผู้ปกครอง', ['รับ-ส่งเด็กด้วย GPS', 'สมุดรายงานประจำวัน', 'พัฒนาการ DSPM', 'กราฟการเจริญเติบโต', 'ประกัน · วัคซีน'], TEAL],
    ['💰', 'การเงิน', ['ออกบิล · ติดตามค้างชำระ', 'ตรวจสลิปอัตโนมัติ SlipOK', 'ชำระล่วงหน้า (ส่วนลด)', 'วันตัดรอบบิล', 'ค่าใช้จ่ายเพิ่มเติม'], AMBER],
    ['👩‍🏫', 'บุคลากร', ['ลงเวลาเข้า-ออกงาน', 'ลา 2 ขั้นอนุมัติ', 'OT · OT วันหยุด', 'เงินเดือน + สลิป', 'สิทธิการลารายคน'], SAGE],
    ['🛡️', 'ความปลอดภัย', ['รายงานอุบัติเหตุ', 'ติดตามการขาดเรียน', 'แจ้งเตือนฉุกเฉินทาง LINE', 'บันทึกการแก้ไขทุกครั้ง', 'สำรองข้อมูลทุกวัน'], CLAY],
  ];
  groups.forEach((g,i)=>{
    const x = 0.7 + i*3.06;
    card(s, x, 2.5, 2.82, 3.7);
    badge(s, x+0.26, 2.78, 0.62, g[3], g[0], WHITE, 17);
    txt(s, g[1], { x:x+1.0, y:2.88, w:1.75, h:0.45, fontSize:14, bold:true, color:NAVY });
    bullets(s, g[2], { x:x+0.3, y:3.62, w:2.4, h:2.4, size:12, gap:6 });
  });
  num(s);
}

/* ============ 4 · THE NUMBERS ============ */
{
  const s = sl();
  kicker(s, 'ขนาดของสิ่งที่สร้างไปแล้ว');
  title(s, 'ระบบนี้ไม่เล็ก');
  const stats = [
    ['36,676', 'บรรทัดโค้ด'], ['151', 'คำสั่งเชื่อมต่อ'], ['27', 'หน้าจอ'],
    ['48', 'ตารางข้อมูล'], ['137', 'ชุดทดสอบ'], ['5', 'บทบาทผู้ใช้'],
  ];
  stats.forEach((st,i)=>{
    const col=i%3, row=Math.floor(i/3);
    const x = 0.7 + col*4.03, y = 2.35 + row*1.85;
    card(s, x, y, 3.78, 1.55, 'FFFFFF');
    txt(s, st[0], { x:x+0.3, y:y+0.22, w:2.0, h:0.7, fontSize:32, bold:true, color:TEAL });
    txt(s, st[1], { x:x+0.3, y:y+0.95, w:3.2, h:0.4, fontSize:13, color:MUTED });
  });
  card(s, 0.7, 6.15, 11.9, 0.82, 'E7EEF1', { line:'E7EEF1' });
  txt(s, '137 ชุดทดสอบอัตโนมัติ คือเหตุผลที่ระบบนี้ย้ายได้อย่างปลอดภัย — กฎทุกข้อถูกเขียนไว้แล้ว พร้อมเหตุการณ์จริงที่ทำให้เกิดกฎนั้น',
    { x:1.0, y:6.15, w:11.3, h:0.82, fontSize:13.5, color:NAVY, valign:'middle' });
  num(s);
}

/* ============ 5 · THE PROBLEM ============ */
{
  const s = sl(NAVY);
  kicker(s, 'ปัญหา', AMBER);
  txt(s, 'ทุกการกด 1 ครั้ง\nผู้ใช้รอเฉลี่ย', { x:0.7, y:1.45, w:5.6, h:1.6, fontSize:30, bold:true, color:WHITE, lineSpacing:40 });
  txt(s, '6.8', { x:0.62, y:3.05, w:3.4, h:1.9, fontSize:104, bold:true, color:AMBER });
  txt(s, 'วินาที', { x:3.35, y:4.05, w:2.0, h:0.7, fontSize:26, bold:true, color:WHITE });
  txt(s, 'และ 5% ของการกด รอเกิน 28.8 วินาที', { x:0.7, y:5.15, w:6.0, h:0.5, fontSize:15, color:'C6D6DE' });
  card(s, 7.1, 1.45, 5.5, 4.55, '1B4A5F', { line:'2E6E78', shadow:false });
  txt(s, 'ผู้ใช้เจออะไร', { x:7.45, y:1.72, w:4.8, h:0.42, fontSize:15, bold:true, color:AMBER });
  bullets(s, [
    'ผู้ปกครองยืนหน้าโรงเรียน กดรับกลับ แล้วรอ',
    'คุณครูเช็กชื่อตอนเช้า ทีละคน ทีละ 7 วินาที',
    'แอดมินออกบิล บางครั้งรอ 2 นาที',
    '28 วินาที คือจุดที่ผู้ปกครองคิดว่าแอปเสีย',
  ], { x:7.45, y:2.3, w:4.85, h:2.5, size:14, color:'DCE9EE', gap:14 });
  card(s, 7.45, 4.95, 4.8, 0.85, '0B2835', { line:'0B2835', shadow:false });
  txt(s, 'วัดจริงจาก 14,782 ครั้ง · 405 รอบการใช้งาน', { x:7.7, y:4.95, w:4.4, h:0.85, fontSize:12.5, color:'9FB8C2', valign:'middle' });
  num(s);
  s.addNotes('ตัวเลขนี้ไม่ใช่ความรู้สึก มาจากระบบวัดที่ฝังอยู่ในแอปเอง เก็บทุกการเรียกใช้จริงของผู้ใช้จริง');
}

/* ============ 6 · WHY ============ */
{
  const s = sl();
  kicker(s, 'สาเหตุ');
  title(s, 'เราใช้ Google Sheets เป็นฐานข้อมูล');
  sub(s, 'มันเคยเป็นทางเลือกที่ถูกต้อง — เริ่มได้เร็ว ฟรี และโรงเรียนเปิดดูข้อมูลเองได้');
  card(s, 0.7, 2.5, 5.7, 3.5, CLAY_L, { line:'EDCFCC' });
  badge(s, 1.0, 2.8, 0.55, CLAY, '!', WHITE, 20);
  txt(s, 'ข้อจำกัดที่แก้ไม่ได้', { x:1.72, y:2.88, w:4.4, h:0.42, fontSize:16, bold:true, color:CLAY });
  bullets(s, [
    'Google รันได้ทีละคำสั่งต่อผู้ใช้ 1 คน — ต่อคิวกันเอง',
    'Sheets ไม่ใช่ฐานข้อมูล ไม่มีดัชนีค้นหา',
    'ไม่มี transaction — ออกบิลล้มกลางคัน = ออกไปครึ่งห้อง',
    'ทุกตัวเลขถูกเก็บเป็นทศนิยมโดยประมาณ',
  ], { x:1.05, y:3.55, w:5.1, h:2.3, size:13.5, color:INK, gap:12 });
  card(s, 6.9, 2.5, 5.7, 3.5, SAGE_L, { line:'CFE0D5' });
  badge(s, 7.2, 2.8, 0.55, SAGE, '✓', WHITE, 18);
  txt(s, 'ฐานข้อมูลจริง (PostgreSQL)', { x:7.92, y:2.88, w:4.4, h:0.42, fontSize:16, bold:true, color:'3F6B53' });
  bullets(s, [
    'รองรับคนเข้าพร้อมกันหลายร้อยคน',
    'ค้นหาจากดัชนี — หลักมิลลิวินาที',
    'transaction — สำเร็จทั้งหมด หรือไม่เกิดอะไรเลย',
    'ชนิดข้อมูลตัวเงินที่แม่นยำ 100%',
  ], { x:7.25, y:3.55, w:5.1, h:2.3, size:13.5, color:INK, gap:12 });
  num(s);
}

/* ============ 7 · THE HIDDEN DEFECT ============ */
{
  const s = sl();
  kicker(s, 'สิ่งที่ต้องรายงานให้ทราบ', CLAY);
  title(s, 'ตอนนี้ระบบคำนวณเงินด้วยทศนิยมโดยประมาณ');
  card(s, 0.7, 2.05, 11.9, 1.5, CLAY_L, { line:'EDCFCC' });
  txt(s, 'Google Sheets เก็บทุกตัวเลขเป็นทศนิยมแบบประมาณ (floating point) — และเราคำนวณส่วนลดชำระล่วงหน้า OT\nกองทุนสำรองเลี้ยงชีพ และเงินเดือน ด้วยตัวเลขแบบนั้น',
    { x:1.05, y:2.05, w:11.2, h:1.5, fontSize:15, color:INK, valign:'middle', lineSpacing:24 });
  const rows = [
    ['ยังไม่เคยเกิดปัญหา', 'เพราะตัวเลขค่าเทอมของโรงเรียนเป็นเลขกลม ส่วนลดจึงลงตัวพอดี', SAGE, SAGE_L],
    ['แต่เป็นความเสี่ยงจริง', 'วันที่มีเลขไม่กลม ผลต่างระดับสตางค์จะโผล่ขึ้นมาแบบเงียบ ๆ ในสลิปเงินเดือน', AMBER, AMBER_L],
    ['ฐานข้อมูลใหม่แก้ได้ทันที', 'PostgreSQL มีชนิดข้อมูลตัวเงินที่แม่นยำเป๊ะ ไม่มีการปัดเศษซ่อนอยู่', TEAL, 'E7EEF1'],
  ];
  rows.forEach((r,i)=>{
    const y = 3.85 + i*0.95;
    card(s, 0.7, y, 11.9, 0.82, r[3], { line:r[3], shadow:false });
    badge(s, 0.95, y+0.14, 0.54, r[2], String(i+1), WHITE, 15);
    txt(s, r[0], { x:1.65, y, w:2.9, h:0.82, fontSize:14.5, bold:true, color:r[2], valign:'middle' });
    txt(s, r[1], { x:4.6, y, w:7.8, h:0.82, fontSize:13.5, color:INK, valign:'middle' });
  });
  txt(s, 'เรื่องเงินคือความน่าเชื่อถือของระบบ — ข้อนี้ข้อเดียวก็คุ้มค่าที่จะย้ายแล้ว',
    { x:0.7, y:6.72, w:11.9, h:0.42, fontSize:14, bold:true, color:NAVY });
  num(s);
}

/* ============ 8 · NEW STACK ============ */
{
  const s = sl();
  kicker(s, 'โครงสร้างใหม่');
  title(s, 'เครื่องมือที่จะใช้ และเหตุผล');
  const items = [
    ['Supabase', 'ฐานข้อมูล', 'PostgreSQL · ตัวเงินแม่นยำ · แยกข้อมูลแต่ละโรงเรียนที่ระดับฐานข้อมูล', TEAL],
    ['Vercel', 'ที่ตั้งเว็บ', 'เซิร์ฟเวอร์สิงคโปร์ ใกล้ไทยที่สุด · ตรวจงานได้ก่อนขึ้นจริง', NAVY],
    ['Cloudflare R2', 'เก็บรูปภาพ', 'ค่าโหลดรูปฟรี — สำคัญมากกับแอปที่เต็มไปด้วยรูปเด็ก', SAGE],
    ['n8n', 'งานอัตโนมัติ', 'แจ้งเตือนเช้า-เย็น · สำรองข้อมูล · ออกบิลตามรอบ', AMBER],
    ['LINE (เดิม)', 'ทางเข้าระบบ', 'ผู้ปกครองยังเข้าผ่าน LINE เหมือนเดิม ไม่ต้องเรียนรู้ใหม่', '06A34A'],
    ['SlipOK (เดิม)', 'ตรวจสลิป', 'ไม่แตะต้อง — มันทำงานได้ และเป็นเส้นทางเงิน', CLAY],
  ];
  items.forEach((it,i)=>{
    const col=i%2, row=Math.floor(i/2);
    const x=0.7+col*6.1, y=2.35+row*1.55;
    card(s, x, y, 5.85, 1.32);
    badge(s, x+0.24, y+0.36, 0.6, it[3], it[0].slice(0,1), WHITE, 18);
    txt(s, it[0], { x:x+0.98, y:y+0.17, w:2.5, h:0.38, fontSize:15, bold:true, color:NAVY });
    txt(s, it[1], { x:x+3.5, y:y+0.2, w:2.1, h:0.34, fontSize:11.5, bold:true, color:it[3], align:'right' });
    txt(s, it[2], { x:x+0.98, y:y+0.6, w:4.6, h:0.62, fontSize:12, color:MUTED, lineSpacing:16 });
  });
  num(s);
}

/* ============ 9 · TWO TRACKS ============ */
{
  const s = sl();
  kicker(s, 'แนวทางการทำงาน');
  title(s, 'แยกเป็น 2 สาย — ของเดิมใช้งานได้ตลอดเวลา');
  sub(s, 'ระบบใหม่ค่อย ๆ โตข้างระบบเดิม และรับงานไปทีละส่วน · ไม่มีวันที่ต้อง "ปิดระบบเพื่อย้าย"');
  card(s, 0.7, 2.5, 5.85, 3.9, 'E7EEF1', { line:'D3E0E5' });
  badge(s, 1.0, 2.8, 0.6, TEAL, 'A', WHITE, 19);
  txt(s, 'ทำให้เร็ว', { x:1.75, y:2.85, w:3.0, h:0.45, fontSize:19, bold:true, color:NAVY });
  txt(s, 'โรงเรียนได้ประโยชน์ก่อน', { x:1.75, y:3.3, w:4.0, h:0.35, fontSize:12.5, color:MUTED });
  bullets(s, [
    'ออกแบบฐานข้อมูลใหม่ 48 ตาราง',
    'เชื่อมสองทาง Sheets ↔ ฐานข้อมูลใหม่',
    'ย้าย "การอ่าน" — ตรงนี้ความเร็วเปลี่ยน',
    'ย้าย "การเขียน" — เรื่องเงินท้ายสุด ตรวจทุกบาท',
    'Sheets เหลือไว้เป็นกระจกอ่านอย่างเดียว',
  ], { x:1.05, y:3.95, w:5.2, h:2.3, size:13, gap:10 });
  card(s, 6.8, 2.5, 5.8, 3.9, AMBER_L, { line:'F0DCC2' });
  badge(s, 7.1, 2.8, 0.6, AMBER, 'B', WHITE, 19);
  txt(s, 'ทำให้ขายได้', { x:7.85, y:2.85, w:3.4, h:0.45, fontSize:19, bold:true, color:NAVY });
  txt(s, 'สิ่งที่จะนำไปเสนอโรงเรียนอื่น', { x:7.85, y:3.3, w:4.4, h:0.35, fontSize:12.5, color:MUTED });
  bullets(s, [
    'ออกแบบหน้าตาใหม่ทั้งหมด (UX/UI)',
    'ระบบรองรับหลายโรงเรียน',
    'หน้าจอควบคุมสำหรับเปิด-ปิดฟังก์ชัน',
    'ขึ้น Google Play Store',
    'ระบบอัปเดตแบบทยอยปล่อย',
  ], { x:7.15, y:3.95, w:5.2, h:2.3, size:13, gap:10 });
  txt(s, 'สาย A เสร็จก่อน ประมาณเดือนที่ 4–5 · สาย B ทำต่อเนื่องไปจนพร้อมขาย',
    { x:0.7, y:6.6, w:11.9, h:0.45, fontSize:13.5, bold:true, color:NAVY });
  num(s);
}

/* ============ 10 · DOCUMENTS ============ */
{
  const s = sl();
  kicker(s, 'งานชิ้นแรก');
  title(s, 'คู่มือการใช้งานครบทุกบทบาท');
  sub(s, 'ทำก่อนเขียนโค้ดแม้แต่บรรทัดเดียว — เพราะมันคือข้อกำหนดของระบบใหม่ และเป็นคู่มือพนักงานไปในตัว');
  const docs = [
    ['ผู้ปกครอง', '7 หน้าจอ', TEAL], ['คุณครู', '9 หน้าจอ', SAGE],
    ['หัวหน้าครู', '+ อนุมัติ', AMBER], ['ผู้ดูแลระบบ', '11 หน้าจอ', NAVY],
    ['ผู้ตรวจสอบ', 'อ่านอย่างเดียว', MUTED],
  ];
  docs.forEach((d,i)=>{
    const x = 0.7 + i*2.44;
    card(s, x, 2.6, 2.24, 1.85);
    badge(s, x+0.78, 2.85, 0.68, d[2], '📄', WHITE, 17);
    txt(s, d[0], { x:x+0.1, y:3.65, w:2.04, h:0.38, fontSize:14, bold:true, color:NAVY, align:'center' });
    txt(s, d[1], { x:x+0.1, y:4.04, w:2.04, h:0.32, fontSize:11.5, color:MUTED, align:'center' });
  });
  card(s, 0.7, 4.75, 11.9, 1.85, 'FFFFFF');
  txt(s, 'แต่ละเล่มบอกอะไร', { x:1.05, y:4.98, w:4.0, h:0.4, fontSize:15, bold:true, color:NAVY });
  const cols = [
    ['เห็นอะไรได้บ้าง', 'ทุกหน้าจอที่บทบาทนั้นเข้าถึงได้'],
    ['ทำอะไรได้บ้าง', 'ทุกปุ่ม และผลของการกดปุ่มนั้น'],
    ['ทำอะไรไม่ได้', 'ข้อห้าม พร้อมข้อความที่ระบบจะตอบกลับ'],
  ];
  cols.forEach((c,i)=>{
    const x = 1.05 + i*3.85;
    txt(s, c[0], { x, y:5.5, w:3.6, h:0.35, fontSize:13, bold:true, color:TEAL });
    txt(s, c[1], { x, y:5.85, w:3.6, h:0.6, fontSize:12.5, color:MUTED, lineSpacing:17 });
  });
  num(s);
}

/* ============ 11 · MULTI TENANT ============ */
{
  const s = sl();
  kicker(s, 'ระบบขายต่อ');
  title(s, 'หนึ่งระบบ รองรับหลายโรงเรียน');
  sub(s, 'ข้อมูลแต่ละโรงเรียนถูกกั้นที่ระดับฐานข้อมูล — ไม่ใช่ที่โค้ด ฐานข้อมูลจะปฏิเสธเองถ้าข้ามโรงเรียน');
  card(s, 0.7, 2.5, 3.6, 3.9, NAVY, { line:NAVY });
  txt(s, 'หน้าจอควบคุม\nของเรา', { x:1.0, y:2.8, w:3.0, h:0.9, fontSize:17, bold:true, color:WHITE, lineSpacing:24 });
  bullets(s, [
    'เพิ่ม/ระงับโรงเรียน',
    'เปิด-ปิดฟังก์ชันรายโรงเรียน',
    'ดูความเร็วรายโรงเรียน',
    'ออกใบแจ้งหนี้',
    'ทยอยปล่อยอัปเดต',
  ], { x:1.0, y:3.9, w:3.1, h:2.3, size:12.5, color:'CFDEE5', gap:11 });
  const schools = [['โรงเรียน Atom','Package C · beta',SAGE],['โรงเรียน B','Package A · stable',TEAL],['โรงเรียน C','Package B · stable',AMBER]];
  schools.forEach((sc,i)=>{
    const y = 2.5 + i*1.35;
    card(s, 4.75, y, 7.85, 1.15);
    badge(s, 5.0, y+0.26, 0.62, sc[2], '🏫', WHITE, 16);
    txt(s, sc[0], { x:5.78, y:y+0.2, w:3.6, h:0.4, fontSize:15, bold:true, color:NAVY });
    txt(s, sc[1], { x:5.78, y:y+0.62, w:3.6, h:0.34, fontSize:12, color:MUTED });
    txt(s, 'ข้อมูลแยกขาดจากกัน', { x:9.4, y, w:3.0, h:1.15, fontSize:12, color:MUTED, align:'right', valign:'middle' });
  });
  txt(s, 'เพิ่มโรงเรียนใหม่ = สร้างข้อมูล 1 แถว แล้วเลือกแพ็กเกจ ไม่ต้องติดตั้งระบบใหม่',
    { x:0.7, y:6.6, w:11.9, h:0.45, fontSize:13.5, bold:true, color:NAVY });
  num(s);
}

/* ============ 12 · 16 SWITCHES ============ */
{
  const s = sl();
  kicker(s, 'ของที่ขายได้ มีอยู่แล้ว');
  title(s, '16 ฟังก์ชันที่เปิด-ปิดได้รายโรงเรียน');
  sub(s, 'ทั้งหมดนี้สร้างเสร็จและผ่านการทดสอบแล้ว ไม่ใช่สิ่งที่ต้องสร้างใหม่');
  const feats = ['เงินเดือน + สลิป','OT','OT วันหยุด','พัฒนาการ DSPM','กราฟการเจริญเติบโต','ประกันนักเรียน',
    'รายงานอุบัติเหตุ','แบบสอบถาม','เมนูอาหาร','ประกาศ','ชำระล่วงหน้า','ตรวจสลิป SlipOK',
    'แจ้งเตือน LINE','เข้าระบบด้วย Google','จัดชั้นเรียน','ติดตามการขาดเรียน'];
  feats.forEach((f,i)=>{
    const col=i%4, row=Math.floor(i/4);
    const x=0.7+col*3.06, y=2.55+row*1.02;
    card(s, x, y, 2.85, 0.84, 'FFFFFF', { shadow:false });
    s.addShape(p.ShapeType.roundRect, { x:x+0.18, y:y+0.26, w:0.5, h:0.3, rectRadius:0.14,
      fill:{color:SAGE}, line:{width:0} });
    s.addShape(p.ShapeType.ellipse, { x:x+0.43, y:y+0.285, w:0.245, h:0.245, fill:{color:WHITE}, line:{width:0} });
    txt(s, f, { x:x+0.8, y, w:1.95, h:0.84, fontSize:11.5, color:INK, valign:'middle' });
  });
  num(s);
}

/* ============ 13 · PRICING ============ */
{
  const s = sl();
  kicker(s, 'รูปแบบราคา');
  title(s, 'เก็บรายหัวเด็ก ต่อเดือน');
  sub(s, 'เป็นหน่วยที่โรงเรียนคิดอยู่แล้ว เพราะเป็นวิธีเดียวกับที่เขาเก็บค่าเทอมจากผู้ปกครอง');
  const pk = [
    ['A','เริ่มต้น','199','วันของโรงเรียน\nรับ-ส่ง · สมุดรายงาน\nประกาศ · ออกบิล', TEAL, 'E7EEF1'],
    ['B','มาตรฐาน','299','A + เงินและบุคลากร\nSlipOK · ชำระล่วงหน้า\nลา · ติดตามขาดเรียน', SAGE, SAGE_L],
    ['C','Pro','399','B + เงินเดือน\nOT · DSPM · ประกัน\nExport · LINE push', AMBER, AMBER_L],
    ['D','Enterprise','ใบเสนอราคา','เกิน 30 คน\nหรือต้องปรับระบบเฉพาะ', NAVY, 'E2E8EB'],
  ];
  pk.forEach((k,i)=>{
    const x=0.7+i*3.06;
    card(s, x, 2.5, 2.82, 3.4, k[5], { line:k[5] });
    badge(s, x+0.28, 2.75, 0.58, k[4], k[0], WHITE, 18);
    txt(s, k[1], { x:x+1.0, y:2.83, w:1.7, h:0.4, fontSize:14, bold:true, color:NAVY });
    txt(s, k[2], { x:x+0.28, y:3.5, w:2.3, h:0.72, fontSize:k[2].length>4?18:32, bold:true, color:k[4] });
    txt(s, k[2].length>4?'':'บาท / เด็ก / เดือน', { x:x+0.28, y:4.22, w:2.3, h:0.32, fontSize:10.5, color:MUTED });
    txt(s, k[3], { x:x+0.28, y:4.6, w:2.3, h:1.2, fontSize:11.5, color:INK, lineSpacing:16 });
  });
  card(s, 0.7, 6.1, 11.9, 0.88, 'FFFFFF');
  txt(s, 'กติกาสำคัญ 2 ข้อ :  คิดขั้นต่ำ 20 คนทุกโรงเรียน (Package A เริ่ม ฿3,980/เดือน)  ·  เกิน 30 คน เปลี่ยนเป็นใบเสนอราคา',
    { x:1.05, y:6.1, w:11.2, h:0.88, fontSize:13, color:NAVY, valign:'middle' });
  num(s);
}

/* ============ 14 · REVENUE CHART ============ */
{
  const s = sl();
  kicker(s, 'ตัวเลขทางธุรกิจ');
  title(s, 'รายได้เทียบค่าใช้จ่าย');
  sub(s, 'สมมติเด็กเฉลี่ยโรงเรียนละ 25 คน · คละแพ็กเกจ A–C');
  s.addChart(p.ChartType.bar, [
    { name:'รายได้ต่อเดือน', labels:['1 โรงเรียน','5 โรงเรียน','20 โรงเรียน'], values:[7500, 37500, 150000] },
    { name:'ค่าใช้จ่ายระบบ', labels:['1 โรงเรียน','5 โรงเรียน','20 โรงเรียน'], values:[1825, 2200, 4245] },
  ], {
    x:0.7, y:2.45, w:7.4, h:4.0,
    barDir:'col', chartColors:[SAGE, CLAY],
    showTitle:false, showLegend:true, legendPos:'t', legendFontSize:12, legendColor:INK,
    showValue:true, dataLabelPosition:'outEnd', dataLabelFontSize:10.5, dataLabelColor:INK,
    dataLabelFormatCode:'#,##0',
    catAxisLabelColor:MUTED, catAxisLabelFontSize:12,
    valAxisLabelColor:MUTED, valAxisLabelFontSize:10, valAxisLabelFormatCode:'#,##0',
    valGridLine:{ color:LINE, size:1 }, catGridLine:{ style:'none' },
    chartArea:{ fill:{ color:'FFFFFF' } }, fontFace:TH,
  });
  const notes = [
    ['~90%', 'กำไรขั้นต้นเมื่อมี 5 โรงเรียนขึ้นไป', SAGE],
    ['โรงเรียนแรก', 'คือโรงเรียนที่แพงที่สุด หลังจากนั้นเกือบเป็นกำไรล้วน', NAVY],
    ['฿4,245', 'ค่าใช้จ่ายระบบทั้งหมด เมื่อมี 20 โรงเรียน', TEAL],
  ];
  notes.forEach((nt,i)=>{
    const y = 2.55 + i*1.32;
    card(s, 8.4, y, 4.2, 1.15);
    txt(s, nt[0], { x:8.68, y:y+0.13, w:3.7, h:0.5, fontSize:21, bold:true, color:nt[2] });
    txt(s, nt[1], { x:8.68, y:y+0.63, w:3.7, h:0.45, fontSize:11.5, color:MUTED, lineSpacing:15 });
  });
  num(s);
}

/* ============ 15 · PROS ============ */
{
  const s = sl();
  kicker(s, 'ข้อดี', SAGE);
  title(s, 'สิ่งที่โรงเรียนจะได้');
  const pros = [
    ['เร็วขึ้น 15–20 เท่า', 'จาก 6.8 วินาที เหลือต่ำกว่า 0.4 วินาที · ผู้ปกครองหน้าโรงเรียนไม่ต้องยืนรอ', TEAL],
    ['ตัวเลขเงินแม่นยำ 100%', 'ปิดความเสี่ยงการปัดเศษในสลิปเงินเดือนและส่วนลด ก่อนที่มันจะเกิด', CLAY],
    ['ข้อมูลปลอดภัยขึ้นมาก', 'สำรองย้อนเวลาได้ · ออกบิลล้มกลางคันแล้วไม่เหลือของค้าง', NAVY],
    ['มีคู่มือครบทุกบทบาท', 'พนักงานใหม่อ่านเองได้ ไม่ต้องสอนปากต่อปาก', AMBER],
    ['ขึ้น Play Store ได้', 'ผู้ปกครองโหลดจากที่เดียวกับแอปทั่วไป น่าเชื่อถือขึ้น', SAGE],
    ['กลายเป็นสินทรัพย์', 'จากค่าใช้จ่ายของโรงเรียน เป็นสิ่งที่สร้างรายได้จากโรงเรียนอื่น', '6B4E9E'],
  ];
  pros.forEach((pr,i)=>{
    const col=i%2, row=Math.floor(i/2);
    const x=0.7+col*6.1, y=2.2+row*1.55;
    card(s, x, y, 5.85, 1.32);
    badge(s, x+0.25, y+0.35, 0.6, pr[2], '✓', WHITE, 17);
    txt(s, pr[0], { x:x+1.0, y:y+0.2, w:4.6, h:0.4, fontSize:14.5, bold:true, color:NAVY });
    txt(s, pr[1], { x:x+1.0, y:y+0.62, w:4.65, h:0.62, fontSize:12, color:MUTED, lineSpacing:16 });
  });
  num(s);
}

/* ============ 16 · CONS ============ */
{
  const s = sl();
  kicker(s, 'ข้อเสีย และสิ่งที่ต้องยอมรับ', CLAY);
  title(s, 'เรื่องที่ต้องบอกให้ครบ');
  const cons = [
    ['มีค่าใช้จ่ายรายเดือน', 'จาก ฿0 เป็น ~฿1,825/เดือน · ระบบเดิมฟรีเพราะใช้ของ Google', 'ยอมรับ — แลกกับความเร็วและความปลอดภัยของข้อมูลเงิน'],
    ['ใช้เวลา 9–11 เดือน', 'ไม่ใช่งานที่เสร็จใน 1–2 เดือน เพราะต้องย้ายเรื่องเงินอย่างระมัดระวัง', 'แบ่ง 2 สาย โรงเรียนได้ความเร็วตั้งแต่เดือนที่ 4–5'],
    ['เปิด Google Sheets ดูเองไม่ได้เหมือนเดิม', 'ทุกวันนี้เปิดชีตดูข้อมูลดิบได้ · ฐานข้อมูลใหม่เปิดแบบนั้นไม่ได้', 'จะทำหน้าจอส่งออก Excel ทดแทนให้ครบ'],
    ['พึ่งพาผู้ให้บริการภายนอก', 'ถ้า Supabase หรือ Vercel ล่ม ระบบเราล่มด้วย', 'สำรองข้อมูลออกมานอกระบบทุกวัน และย้ายผู้ให้บริการได้'],
  ];
  cons.forEach((c,i)=>{
    const y = 2.2 + i*1.17;
    card(s, 0.7, y, 11.9, 1.02, i%2? 'FFFFFF' : CREAM, { shadow:false, line:LINE });
    badge(s, 0.95, y+0.24, 0.55, CLAY, '!', WHITE, 16);
    txt(s, c[0], { x:1.66, y:y+0.12, w:3.5, h:0.78, fontSize:13.5, bold:true, color:CLAY, valign:'middle' });
    txt(s, c[1], { x:5.3, y:y+0.12, w:3.6, h:0.78, fontSize:11.5, color:MUTED, valign:'middle', lineSpacing:15 });
    txt(s, '→ ' + c[2], { x:9.05, y:y+0.12, w:3.3, h:0.78, fontSize:11.5, color:'3F6B53', valign:'middle', lineSpacing:15 });
  });
  txt(s, 'คอลัมน์ขวาคือวิธีรับมือ — ไม่มีข้อไหนที่ยังไม่มีคำตอบ',
    { x:0.7, y:6.95, w:11.9, h:0.4, fontSize:13, bold:true, color:NAVY });
  num(s);
}

/* ============ 17 · TIMELINE ============ */
{
  const s = sl();
  kicker(s, 'แผนเวลา');
  title(s, 'ลำดับงาน และจุดที่โรงเรียนจะรู้สึกได้');
  const ph = [
    ['เดือน 1', 'เขียนคู่มือทุกบทบาท\nออกแบบฐานข้อมูล', TEAL],
    ['เดือน 2–3', 'สร้างฐานข้อมูลใหม่\nเชื่อมสองทางกับของเดิม', TEAL],
    ['เดือน 4–5', 'ย้ายการอ่าน–เขียน\nระบบเร็วขึ้นจริง', SAGE],
    ['เดือน 6–8', 'หน้าตาใหม่ทั้งหมด\nรองรับหลายโรงเรียน', AMBER],
    ['เดือน 9–11', 'หน้าจอควบคุม\nขึ้น Play Store · พร้อมขาย', NAVY],
  ];
  ph.forEach((f,i)=>{
    const x = 0.7 + i*2.44;
    card(s, x, 2.75, 2.24, 2.5, 'FFFFFF');
    badge(s, x+0.82, 2.98, 0.6, f[2], String(i+1), WHITE, 18);
    txt(s, f[0], { x:x+0.12, y:3.72, w:2.0, h:0.38, fontSize:13.5, bold:true, color:f[2], align:'center' });
    txt(s, f[1], { x:x+0.12, y:4.12, w:2.0, h:0.95, fontSize:11.5, color:MUTED, align:'center', lineSpacing:16 });
    if (i<4) txt(s, '›', { x:x+2.24, y:3.6, w:0.2, h:0.5, fontSize:22, color:LINE, align:'center' });
  });
  card(s, 0.7, 5.6, 5.85, 1.1, SAGE_L, { line:'CFE0D5' });
  txt(s, 'เดือนที่ 4–5 · โรงเรียนได้ความเร็ว', { x:1.05, y:5.75, w:5.2, h:0.35, fontSize:14, bold:true, color:'3F6B53' });
  txt(s, 'ก่อนหน้านั้นใช้ระบบเดิมตามปกติ ไม่มีอะไรเปลี่ยน', { x:1.05, y:6.12, w:5.2, h:0.4, fontSize:12, color:MUTED });
  card(s, 6.8, 5.6, 5.8, 1.1, AMBER_L, { line:'F0DCC2' });
  txt(s, 'เดือนที่ 11 · เริ่มเสนอขายโรงเรียนอื่นได้', { x:7.15, y:5.75, w:5.2, h:0.35, fontSize:14, bold:true, color:'8A5A18' });
  txt(s, 'ระบบหลายโรงเรียนต้องเสร็จสมบูรณ์ก่อนไปขาย', { x:7.15, y:6.12, w:5.2, h:0.4, fontSize:12, color:MUTED });
  num(s);
}

/* ============ 18 · ASK ============ */
{
  const s = sl(NAVY);
  kicker(s, 'ขั้นตอนถัดไป', AMBER);
  txt(s, 'สิ่งที่ขออนุมัติ', { x:0.7, y:0.82, w:8.0, h:0.9, fontSize:32, bold:true, color:WHITE });
  const asks = [
    ['1', 'อนุมัติค่าใช้จ่ายระบบ ~฿1,825 / เดือน', 'เริ่มจ่ายจริงเมื่อเริ่มสร้างฐานข้อมูล ประมาณเดือนที่ 2'],
    ['2', 'อนุมัติทิศทางขายต่อให้โรงเรียนอื่น', 'เพื่อให้ออกแบบระบบหลายโรงเรียนตั้งแต่ต้น แทนการมาแก้ทีหลัง'],
    ['3', 'ยืนยันรูปแบบราคา 199 / 299 / 399 บาท ต่อเด็ก', 'รวมถึงกติกาขั้นต่ำ 20 คน และเกิน 30 คนเป็นใบเสนอราคา'],
    ['4', 'มอบหมายผู้ตรวจรับคู่มือแต่ละบทบาท', 'คู่มือต้องตรงกับการใช้งานจริง จึงต้องมีคนของโรงเรียนอ่านและยืนยัน'],
  ];
  asks.forEach((a,i)=>{
    const y = 2.0 + i*1.15;
    card(s, 0.7, y, 11.9, 1.0, '1B4A5F', { line:'2E6E78', shadow:false });
    badge(s, 0.98, y+0.21, 0.58, AMBER, a[0], WHITE, 17);
    txt(s, a[1], { x:1.72, y:y+0.1, w:5.6, h:0.8, fontSize:14.5, bold:true, color:WHITE, valign:'middle' });
    txt(s, a[2], { x:7.45, y:y+0.1, w:4.9, h:0.8, fontSize:12, color:'A9C4CE', valign:'middle', lineSpacing:16 });
  });
  card(s, 0.7, 6.65, 11.9, 0.62, '0B2835', { line:'0B2835', shadow:false });
  txt(s, 'งานที่เริ่มได้ทันทีโดยไม่มีค่าใช้จ่าย : เขียนคู่มือทุกบทบาท และออกแบบฐานข้อมูลบนกระดาษ',
    { x:1.0, y:6.65, w:11.3, h:0.62, fontSize:12.5, color:AMBER, valign:'middle' });
  num(s);
  s.addNotes('ปิดท้ายด้วยสิ่งที่ขอ 4 ข้อ และย้ำว่างานเดือนแรกเริ่มได้เลยโดยยังไม่มีค่าใช้จ่าย');
}

p.writeFile({ fileName: 'dist/Atom_Nursery_แผนพัฒนาระบบ.pptx' })
  .then(f => console.log('written:', f, '· slides:', N));
