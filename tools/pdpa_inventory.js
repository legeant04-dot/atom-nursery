/**
 * tools/pdpa_inventory.js — what personal data this system actually holds.
 *   node tools/pdpa_inventory.js            print it
 *   node tools/pdpa_inventory.js --write    write docs/pdpa/02_ROPA.md
 *
 * 🔴 WHY IT IS GENERATED, NOT WRITTEN.
 *
 * PDPA §39 requires the CONTROLLER (the school) to keep a record of processing activities. Every
 * template on the internet produces a document that is plausible and unverifiable. This one is
 * derived from `SCHEMA` in src/Config.gs — the same declarations the database is generated from —
 * so the record and the system cannot drift apart, and the day a column is added the record says so.
 *
 * It also answers the question the school has to answer before anything else: **does this system
 * hold ข้อมูลอ่อนไหว (sensitive personal data, PDPA §26)?** It does — a child's allergies, medical
 * history, blood type, religion and race, and injury reports. §26 requires EXPLICIT CONSENT for
 * those, which is a different and stronger thing than the privacy notice §23 asks for, and it is
 * the single most likely gap in a nursery's existing paperwork.
 *
 * This is an inventory, not legal advice. A Thai lawyer must review the agreement it supports.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const decom = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 🔴 ข้อมูลอ่อนไหว (PDPA §26) — explicit consent, not merely a notice ──────────────────────────
 * The categories §26 names are: race/ethnicity, political opinion, religion/philosophy, sexual
 * behaviour, criminal record, health, disability, trade union, genetic and biometric data.
 * Of those, this system holds health, religion and race. Listed by COLUMN, because "this table has
 * health data in it" is not something a school can act on and "this column is a child's medical
 * history" is. */
const SENSITIVE = {
  Allergy: 'สุขภาพ — อาการแพ้ของเด็ก',
  MedicalHistory: 'สุขภาพ — ประวัติการรักษา',
  BloodType: 'สุขภาพ — หมู่เลือด',
  RH: 'สุขภาพ — หมู่เลือด (Rh)',
  Vaccine: 'สุขภาพ — ประวัติวัคซีน',
  VaccineKey: 'สุขภาพ — ประวัติวัคซีน',
  VaccineName: 'สุขภาพ — ประวัติวัคซีน',
  DoseDate: 'สุขภาพ — ประวัติวัคซีน',
  Health: 'สุขภาพ — บันทึกอาการประจำวัน',
  HealthDetail: 'สุขภาพ — รายละเอียดอาการ',
  Religion: 'ศาสนา',
  Race: 'เชื้อชาติ',
  Weight: 'สุขภาพ — น้ำหนัก',
  Height: 'สุขภาพ — ส่วนสูง',
  Result: 'สุขภาพ — ผลประเมินพัฒนาการ (DSPM)',
  /* the injury report, which is the most sensitive thing in the system and uses none of the words a
   * keyword list would expect — it describes a child's body and what happened to it */
  InjuryTypes: 'สุขภาพ — ลักษณะการบาดเจ็บ',
  Narrative: 'สุขภาพ — คำบรรยายเหตุการณ์บาดเจ็บ',
  CauseObject: 'สุขภาพ — สาเหตุการบาดเจ็บ',
  Sex: 'เพศของเด็ก',
  Gender: 'เพศของเด็ก'
};

/* ── identifiers a person can be found by, and the two that are government ids ────────────────── */
const IDENTIFIER = {
  NationalID: '🔴 เลขบัตรประชาชน',
  Phone: 'เบอร์โทรศัพท์', Phone2: 'เบอร์โทรศัพท์',
  Email: 'อีเมล', Address: 'ที่อยู่',
  LineUID: 'รหัสผู้ใช้ LINE', GoogleSub: 'รหัสผู้ใช้ Google',
  Photo: 'รูปถ่าย', Photo1: 'รูปถ่าย', Photo2: 'รูปถ่าย', Photo3: 'รูปถ่าย',
  PictureUrl: 'รูปโปรไฟล์', InsuranceCardImage: 'ภาพบัตรประกัน',
  DOB: 'วันเกิด', Birthday: 'วันเกิด',
  NameTH: 'ชื่อ-นามสกุล', NameEN: 'ชื่อ-นามสกุล', Nickname: 'ชื่อเล่น', NicknameEN: 'ชื่อเล่น',
  InsuredName: 'ชื่อผู้เอาประกัน', InsuranceOwner: 'ชื่อเจ้าของกรมธรรม์',
  BankAccount: '🔴 เลขบัญชีธนาคาร', BankName: 'ธนาคาร',
  PasswordHash: '🔴 รหัสผ่าน (เข้ารหัสแล้ว)',
  EmergencyContact: 'ผู้ติดต่อฉุกเฉิน'
};

/** Whose data is in this table — the question a data-subject request actually asks. */
const SUBJECT = {
  STUDENTS: 'เด็กนักเรียน', PARENTS: 'ผู้ปกครอง', STAFF: 'พนักงาน', USERS: 'ผู้ใช้ระบบ',
  PICKUP_PERSONS: 'ผู้รับ-ส่งที่ได้รับอนุญาต', USER_LINKS: 'ผู้ปกครอง',
  CHECKIN_STUDENT: 'เด็กนักเรียน', GROWTH_RECORDS: 'เด็กนักเรียน', DAILY_JOURNAL: 'เด็กนักเรียน',
  DSPM_ASSESSMENT: 'เด็กนักเรียน', DSPM_CRITERIA: '— (เกณฑ์มาตรฐาน ไม่ใช่ข้อมูลบุคคล)',
  BILLING: 'เด็กนักเรียน / ผู้ปกครอง', STUDENT_CHARGES: 'เด็กนักเรียน', STUDENT_TERMS: 'เด็กนักเรียน',
  PREPAYMENTS: 'ผู้ปกครอง', PAYMENT_SLIPS: 'ผู้ปกครอง', OT_DAILY: 'เด็กนักเรียน / ผู้ปกครอง',
  ABSENCE_LOG: 'เด็กนักเรียน', ABSENCE_FOLLOWUP: 'เด็กนักเรียน', ABSENCE_FOLLOWUP_LOG: 'เด็กนักเรียน',
  HOLIDAY_ATTEND: 'เด็กนักเรียน', VACCINE_RECORDS: 'เด็กนักเรียน',
  LEAVE_REQUEST_STD: 'เด็กนักเรียน', WITHDRAWALS: 'เด็กนักเรียน',
  INJURY_REPORTS: 'เด็กนักเรียน', INSURANCE_PCHI: 'เด็กนักเรียน',
  COMMENTS: 'ผู้ปกครอง / พนักงาน', ANNOUNCEMENTS: '— (ประกาศของโรงเรียน)',
  CLASSES: '— (โครงสร้างชั้นเรียน)', SCHOOL_CONFIG: '— (ตั้งค่าระบบ)', HOLIDAYS: '— (ปฏิทิน)',
  AUDIT_LOG: 'ผู้ใช้ระบบ', ACTIVITY_LOG: 'ผู้ใช้ระบบ', BACKUP_LOG: '— (บันทึกการสำรองข้อมูล)',
  ADMIN_INBOX: 'พนักงาน / ผู้ปกครอง', LINE_RECIPIENTS: 'พนักงาน',
  SURVEYS: '— (แบบสอบถาม)', SURVEY_RESPONSES: 'ผู้ตอบแบบสอบถาม',
  FOOD_ITEMS: '— (รายการอาหาร)', FOOD_MENU: '— (เมนูอาหาร)',
  STAFF_GROUPS: '— (กลุ่มเวลาทำงาน)', PAYROLL_CONFIG: 'พนักงาน', CHECKIN_STAFF: 'พนักงาน',
  LEAVE_REQUEST: 'พนักงาน', OT_RECORDS: 'พนักงาน', PAYROLL: 'พนักงาน',
  PAY_ADJUSTMENTS: 'พนักงาน', TRAINING: 'พนักงาน', WORK_SCHEDULE: 'พนักงาน',
  ATTENDANCE_REQUEST: 'พนักงาน', CLASS_CHANGE_REQ: 'พนักงาน', CLASS_COVER: 'พนักงาน',
  PERF_LOG: '— (วัดความเร็วระบบ ไม่มีชื่อ/รหัสผู้ใช้)'
};

function inventory() {
  const cfg = decom(R('src/Config.gs'));
  const out = [];
  for (const wb of ['MAIN', 'HR']) {
    const i = cfg.indexOf(`SCHEMA[WB.${wb}] = {`); if (i < 0) continue;
    const block = cfg.slice(i, cfg.indexOf('\n};', i));
    for (const m of block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm)) {
      const cols = [...new Set((m[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)))];
      if (!cols.length) continue;
      out.push({
        wb, sheet: m[1], cols,
        subject: SUBJECT[m[1]] || '⚠️ ยังไม่ได้ระบุ',
        sensitive: cols.filter(c => SENSITIVE[c]),
        identifiers: cols.filter(c => IDENTIFIER[c])
      });
    }
  }
  return out.sort((a, b) => a.sheet.localeCompare(b.sheet));
}

const inv = inventory();
const unknown = inv.filter(t => t.subject.indexOf('ยังไม่ได้ระบุ') >= 0);
const withSensitive = inv.filter(t => t.sensitive.length);
const sensitiveCols = [...new Set(inv.flatMap(t => t.sensitive))];

if (process.argv.includes('--check')) {
  /* A new sheet with nobody's name against it is a table of personal data that the record of
   * processing does not mention. Fails rather than guessing. */
  if (unknown.length) {
    console.error('\n❌ ตารางที่ยังไม่ได้ระบุว่าเป็นข้อมูลของใคร:\n');
    unknown.forEach(t => console.error('     ' + t.sheet));
    console.error('\n   เพิ่มใน SUBJECT ใน tools/pdpa_inventory.js\n');
    process.exit(1);
  }
  console.log('ok — ' + inv.length + ' ตาราง · ระบุเจ้าของข้อมูลครบ · ข้อมูลอ่อนไหว ' +
    withSensitive.length + ' ตาราง / ' + sensitiveCols.length + ' คอลัมน์');
  process.exit(0);
}

const L = [];
L.push('# บันทึกรายการกิจกรรมการประมวลผลข้อมูลส่วนบุคคล (Record of Processing Activities)');
L.push('');
L.push('> **เอกสารนี้ถูกสร้างจากโครงสร้างข้อมูลจริงของระบบ** — `node tools/pdpa_inventory.js --write`');
L.push('> ไม่ได้พิมพ์ด้วยมือ และไม่ได้ลอกมาจากแม่แบบ จึงไม่มีทางคลาดจากระบบจริง');
L.push('> ทุกครั้งที่เพิ่มคอลัมน์ใหม่ เอกสารนี้ต้องถูกสร้างใหม่');
L.push('>');
L.push('> ⚖️ **ยังไม่ใช่เอกสารทางกฎหมาย** — ต้องให้ทนายตรวจก่อนนำไปใช้จริง · ผมไม่ใช่ทนาย');
L.push('');
L.push('ตามมาตรา 39 พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 — **ผู้ควบคุมข้อมูล (โรงเรียน) มีหน้าที่จัดทำ**');
L.push('');
L.push('สร้างเมื่อ: ' + new Date().toISOString().slice(0, 10));
L.push('');
L.push('---');
L.push('');
L.push('## สรุป');
L.push('');
L.push('| | |');
L.push('|---|---|');
L.push('| ตารางข้อมูลทั้งหมด | **' + inv.length + '** |');
L.push('| ตารางที่มี **ข้อมูลอ่อนไหว** (ม.26) | **' + withSensitive.length + '** |');
L.push('| คอลัมน์ที่เป็นข้อมูลอ่อนไหว | **' + sensitiveCols.length + '** |');
L.push('');
L.push('### 🔴 ข้อมูลอ่อนไหวที่ระบบเก็บ — ต้องขอความยินยอมโดยชัดแจ้ง (ม.26)');
L.push('');
L.push('**ข้อนี้สำคัญที่สุดในเอกสารทั้งชุด** · ข้อมูลอ่อนไหวไม่สามารถใช้ "ประกาศความเป็นส่วนตัว" อย่างเดียวได้');
L.push('ต้องมี **ความยินยอมโดยชัดแจ้งเป็นหนังสือ** แยกต่างหาก และผู้ปกครองต้องถอนความยินยอมได้');
L.push('');
L.push('| คอลัมน์ | ประเภท |');
L.push('|---|---|');
sensitiveCols.sort().forEach(c => L.push('| `' + c + '` | ' + SENSITIVE[c] + ' |'));
L.push('');
L.push('---');
L.push('');
L.push('## รายการตามตาราง');
L.push('');
L.push('| ตาราง | ข้อมูลของใคร | จำนวนคอลัมน์ | ข้อมูลอ่อนไหว | ตัวระบุตัวบุคคล |');
L.push('|---|---|---|---|---|');
/* 🔴 WHICH WORKBOOK, where the same name is in both (found 2026-10-14 while building the Phase 4.6
 * export). AUDIT_LOG is declared in SCHEMA[WB.MAIN] and again in SCHEMA[WB.HR] — the general access
 * log, and the one dedicated to the confidential HR workbook. The record of processing listed them
 * as two IDENTICAL rows, so a reader of this document — the ผอ. and a lawyer — could see there were
 * two of something but not which was which, and could not tell the row covering "who read the
 * salaries" from the row covering ordinary access. Only shown where there is an ambiguity to
 * resolve, so no existing row changes. */
const dupNames = {};
inv.forEach(t => { dupNames[t.sheet] = (dupNames[t.sheet] || 0) + 1; });
const WB_LABEL = { MAIN: 'ไฟล์หลัก', HR: 'ไฟล์ฝ่ายบุคคล' };
inv.forEach(t => {
  const which = dupNames[t.sheet] > 1 ? ' *(' + (WB_LABEL[t.wb] || t.wb) + ')*' : '';
  L.push('| `' + t.sheet + '`' + which + ' | ' + t.subject + ' | ' + t.cols.length + ' | ' +
    (t.sensitive.length ? '🔴 ' + t.sensitive.join(', ') : '—') + ' | ' +
    (t.identifiers.length ? t.identifiers.map(c => IDENTIFIER[c].replace('🔴 ', '🔴')).join(', ') : '—') + ' |');
});
L.push('');
L.push('---');
L.push('');
L.push('## ข้อที่โรงเรียนต้องเติมเอง (ระบบตอบแทนไม่ได้)');
L.push('');
L.push('| # | เรื่อง | ทำไมต้องเป็นโรงเรียน |');
L.push('|---|---|---|');
L.push('| 1 | **ฐานทางกฎหมายของการเก็บแต่ละอย่าง** (ความยินยอม / สัญญา / ประโยชน์สำคัญต่อชีวิต) | เป็นการตัดสินใจของผู้ควบคุมข้อมูล ไม่ใช่ของระบบ |');
L.push('| 2 | **ระยะเวลาเก็บรักษา** — เก็บข้อมูลเด็กไว้กี่ปีหลังออกจากโรงเรียน | กฎหมายการศึกษา/ภาษีกำหนดขั้นต่ำบางอย่าง ที่เหลือโรงเรียนเลือก |');
L.push('| 3 | **ผู้ติดต่อเรื่องข้อมูลส่วนบุคคล** (ชื่อ · ตำแหน่ง · อีเมล · โทร) | ต้องประกาศให้ผู้ปกครองติดต่อได้ |');
L.push('| 4 | **แบบความยินยอมที่ใช้อยู่ตอนนี้** | ถ้าใบสมัครเดิมไม่มีข้อความเรื่องข้อมูลอ่อนไหว ต้องขอใหม่ |');
L.push('');
module.exports = { inventory, SENSITIVE, IDENTIFIER, SUBJECT };

const text = L.join('\n') + '\n';
if (process.argv.includes('--write')) {
  const dir = path.join(ROOT, 'docs', 'pdpa');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '02_ROPA.md'), text);
  console.log('docs/pdpa/02_ROPA.md written — ' + inv.length + ' ตาราง · ข้อมูลอ่อนไหว ' + sensitiveCols.length + ' คอลัมน์');
} else {
  process.stdout.write(text);
}
