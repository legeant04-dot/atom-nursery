/* make_template.js — generate a multi-sheet .xlsx import template (no deps, store-only zip).
   Output: Atom_Nursery_Import_Template.xlsx at the repo root.
   Tabs = the 6 base sheets (headers + 1 example row) + a README tab.
   Headers match the Google Sheets columns the GAS engine expects (Thai name -> column `Name`). */
const fs = require('fs');
const path = require('path');

// ---- data: [sheetName, rows[][]] ; first row = headers, second = example ----
const LINE = '(ใส่ LINE userId)';
const SHEETS = [
  ['README', [
    ['Atom Nursery — Import template (กรอกแล้ว copy ไปวางในชีตจริง)'],
    ['ชีตที่ลงท้าย (HR) -> Workbook AtomNursery_HR ; ที่เหลือ -> AtomNursery_Main'],
    ['ชื่อไทยใส่คอลัมน์ "Name" (engine จะ map เป็น NameTH ให้เอง)'],
    ['กฎเชื่อมโยง: STUDENTS.Class = CLASSES.ClassName | STUDENTS.ParentID = PARENTS.ParentID | STUDENTS.Plan = id ใน SCHOOL_CONFIG.Plans'],
    ['Plan ids ที่ใช้ได้: p_0717 (07:00-17:00 6500) | p_0718 (07:00-18:00 7500) | p_inter (Inter 9500) | p_1518 (เสริม 15:30-18:30 3000)'],
    ['WORK_SCHEDULE.StaffID / CLASSES.TeacherID = STAFF.StaffID | STAFF.Department = ชื่อชั้น (Nursery 0-3)'],
    ['USER_LINKS.UserUID = LINE userId ของผู้ปกครอง -> ให้เห็นเฉพาะลูกตัวเอง'],
    ['Admin: ไม่ต้องกรอก STAFF เอง -> รัน bootstrapAdmin("<LINE userId>") ใน GAS'],
    ['ครู: ใส่ LineUID ใน STAFF + เพิ่มแถวใน USERS (LineUID, Role=Teacher, LinkedID=StaffID) เพื่อให้ LIFF รู้บทบาท'],
  ]],
  ['STAFF (HR)', [
    ['StaffID','Name','NameEN','NationalID','Role','Department','PositionLevel','StaffGroup','ReportsTo','Phone','LineUID','StartDate','BaseSalary','Password','MustChangePassword','Status'],
    ['STF-T1','ครูเอ','A Mana','1101700100013','Teacher','Nursery 1','Officer','ครูประจำ','STF-ADM','081-000-0000',LINE,'2023-06-01',16000,'1234','TRUE','ACTIVE'],
  ]],
  ['WORK_SCHEDULE (HR)', [
    ['StaffID','DayOfWeek','CheckInTime','CheckOutTime','EffectiveDate'],
    ['STF-T1','Mon-Fri','08:00','17:00','2025-01-01'],
  ]],
  ['CLASSES', [
    ['ClassID','ClassName','TeacherID','AgeRange','Capacity'],
    ['CL1','Nursery 1','STF-T1','1-2 ปี',15],
  ]],
  ['PARENTS', [
    ['ParentID','NationalID','Name','NameEN','Relationship','Phone','Occupation','Workplace','OfficePhone','LineUID','StudentID','Address'],
    ['PAR-1','1100100100101','กานต์ ดีงาม','Ms.Karn','มารดา','081-111-1111','พนักงานบริษัท','บจก. ดีงาม','02-111-1111',LINE,'STD-1','กรุงเทพฯ'],
  ]],
  ['STUDENTS', [
    ['StudentID','NationalID','Name','NameEN','Nickname','NicknameEN','Gender','DOB','Class','ParentID','Plan','EnrollDate','Allergy','Status'],
    ['STD-1','1234567890121','บีม สุขใจ','Beam','บีม','Beam','M','2025-05-01','Nursery 1','PAR-1','p_0717','2025-06-01','นมวัว','ACTIVE'],
  ]],
  ['USER_LINKS', [
    ['UserUID','StudentID','VerifiedBy','Date'],
    [LINE,'STD-1','register','2025-06-01'],
  ]],
];

// ---- OOXML + store-only zip (Buffer-based) ----
const CRCT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26 | 0; } return s; }
function sheetXml(rows) {
  let body = '';
  rows.forEach((row, r) => {
    let cells = '';
    row.forEach((v, c) => {
      const ref = colName(c) + (r + 1);
      if (typeof v === 'number' && isFinite(v)) cells += `<c r="${ref}"><v>${v}</v></c>`;
      else cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    });
    body += `<row r="${r + 1}">${cells}</row>`;
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
}
function buildParts(sheets) {
  const n = sheets.length;
  const ov = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const sh = sheets.map((s, i) => `<sheet name="${esc(s[0].slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const rel = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const parts = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ov + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sh + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rel + '</Relationships>'],
  ];
  sheets.forEach((s, i) => parts.push(['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s[1])]));
  return parts;
}
function zip(files) {
  const chunks = [], central = []; let offset = 0;
  const u16 = n => Buffer.from([n & 0xFF, (n >>> 8) & 0xFF]);
  const u32 = n => Buffer.from([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
  files.forEach(f => {
    const name = Buffer.from(f[0], 'utf8'), data = Buffer.from(f[1], 'utf8'), crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)]);
    chunks.push(local, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + name.length + data.length;
  });
  const cstart = offset; const cdir = [];
  central.forEach(c => {
    const rec = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset)]);
    cdir.push(rec, c.name); offset += rec.length + c.name.length;
  });
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(offset - cstart), u32(cstart), u16(0)]);
  return Buffer.concat(chunks.concat(cdir, [end]));
}

const out = path.join(__dirname, '..', 'Atom_Nursery_Import_Template.xlsx');
fs.writeFileSync(out, zip(buildParts(SHEETS)));
console.log('wrote', out, '(' + fs.statSync(out).size + ' bytes) — tabs:', SHEETS.map(s => s[0]).join(', '));
