/**
 * tools/test_student_record.js — everything the family wrote down, back where somebody can read it.
 *   node tools/test_student_record.js
 *
 * ASKED 2026-08-24: "ประวัตินักเรียน ต้องมีข้อมูลแสดงเหมือนกับตอนที่ผู้ปกครองลงทะเบียนมา วันเกิด/
 * กรุ๊ปเลือด/ข้อมูลทั้งหมดที่ลงทะเบียนของนักเรียนต้องแสดงในประวัตินักเรียนทั้งหมด"
 *
 * A family fills in a blood type, an allergy, a medical history and an emergency contact on the day
 * a child joins. Afterwards the only thing anybody could see was the age and the allergy on a class
 * card. Information collected and never shown again is information the school does not really have:
 * at the moment it is needed, nobody knows where to look.
 *
 * TWO AUDIENCES, ONE RECORD — the school's answer when asked:
 *   · Admin / Leader / head teacher: the whole thing, including what identifies a family.
 *   · A teacher: CARE INFORMATION ONLY — everything needed to look after the child and to act in an
 *     emergency, and nothing that is simply the family's business.
 *
 * Decided in the ENGINE. A screen that fetched the row and hid half of it would still have put a
 * national ID on a phone in a classroom — the same lesson as the working-time screen (v263).
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), cfg = R('src/Config.gs');

// every field the registration form collects, filled in — this is the point of the test
const KID = {
  StudentID: 'S1', NationalID: '1103700123456', NameTH: 'เด็กหญิงแอชลีย์ ใจดี', NameEN: 'Ashley Jaidee',
  Nickname: 'แอชลีย์', NicknameEN: 'Ashley', Gender: 'Female', DOB: '2023-04-11', Class: 'Nursery 1',
  ParentID: 'PAR-1', Plan: 'รายเดือน 9500', Weight: 12.4, Height: 88, BloodType: 'O', RH: 'Rh+',
  Allergy: 'แพ้นมวัว', MedicalHistory: 'หอบหืด', Vaccine: 'ครบตามเกณฑ์',
  Race: 'ไทย', Nationality: 'ไทย', Religion: 'พุทธ',
  EmergencyContact: 'คุณแม่ 081-234-5678', Address: '99/1 ถนนสุขุมวิท กรุงเทพฯ',
  EnrollDate: '2026-05-01', InsuranceHas: true, InsurancePolicyNo: 'PCHI-0099',
  InsuranceCompany: 'PCHI', InsuranceExpiry: '2027-05-01', Status: 'ACTIVE', CreatedDate: '2026-05-01'
};

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1,Nursery 2' },
    students: [KID, { StudentID: 'S2', NameTH: 'อีกคน', Nickname: 'บี', Class: 'Nursery 2', Status: 'ACTIVE' }],
    parents: [{ ParentID: 'PAR-1', NameTH: 'สมหญิง ใจดี', Nickname: 'แม่', Relationship: 'มารดา',
      Phone: '0812345678', Occupation: 'พยาบาล', Workplace: 'รพ.รามา', Address: '99/1 ถนนสุขุมวิท', NationalID: '3100900112233' }],
    staff: [
      { StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูจอย', Nickname: 'จอย', Role: 'Teacher', Department: 'Nursery 1', Classes: 'Nursery 1', Status: 'ACTIVE' },
      { StaffID: 'T2', NameTH: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher', Department: 'Nursery 2', Classes: 'Nursery 2', Status: 'ACTIVE' },
      { StaffID: 'HEAD', NameTH: 'หัวหน้าครู', Role: 'Teacher', Department: '*', Status: 'ACTIVE' }
    ],
    classes: [{ ClassName: 'Nursery 1', TeacherID: 'T1' }, { ClassName: 'Nursery 2', TeacherID: 'T2' }],
    userLinks: [{ ParentID: 'PAR-1', StudentID: 'S1' }],
    growthRecords: [{ StudentID: 'S1', Date: '2026-08-01', Weight: 12.4, Height: 88 }],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], staffGroups: [], workSchedule: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], leaves: [], absenceLog: [], dspmCriteria: [],
    activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], holidays: [], holidayAttend: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const H = boot();

console.log('\n1) the admin sees the record the family filled in');
{
  const d = H.studentProfile({ studentId: 'S1', staffId: 'ADM', role: 'Admin' });
  eq('it is the full record', d.scope, 'full');
  eq('date of birth', d.dob, '2023-04-11');
  eq('blood type and Rh — the two the school asked for by name', [d.bloodType, d.rh], ['O', 'Rh+']);
  eq('allergy', d.allergy, 'แพ้นมวัว');
  eq('medical history', d.medicalHistory, 'หอบหืด');
  eq('emergency contact', d.emergencyContact, 'คุณแม่ 081-234-5678');
  eq('race / nationality / religion', [d.race, d.nationality, d.religion], ['ไทย', 'ไทย', 'พุทธ']);
  eq('weight and height', [d.weight, d.height], [12.4, 88]);
  eq('...and when they were last measured', d.measuredAt, '2026-08-01');
  eq('national ID', d.nationalId, '1103700123456');
  eq('address', d.address, '99/1 ถนนสุขุมวิท กรุงเทพฯ');
  eq('the package they pay for', d.plan, 'รายเดือน 9500');
  eq('insurance, in full', [d.insuranceHas, d.insuranceCompany, d.insurancePolicyNo, d.insuranceExpiry],
    [true, 'PCHI', 'PCHI-0099', '2027-05-01']);
  eq('the family, with a number to ring', [d.parents.length, d.parents[0].phone, d.parents[0].relationship],
    [1, '0812345678', 'มารดา']);
}
{
  // NOTHING THE FORM COLLECTS MAY BE MISSING. The sheet's own column list is the reference, so a
  // field added to registration later cannot quietly fail to appear in the record.
  // the block between STUDENTS: and the next sheet — trailing comments sit inside it, so strip them
  const block = cfg.slice(cfg.indexOf('STUDENTS:'), cfg.indexOf('CLASSES:')).replace(/\/\/.*$/gm, '');
  const declared = (block.match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
  ok_('the column list was actually found', declared.length > 20);
  const d = H.studentProfile({ studentId: 'S1', staffId: 'ADM', role: 'Admin' });
  const lc = k => String(k).toLowerCase();
  const shown = Object.keys(d).map(lc);
  // columns that are bookkeeping rather than "what the family told us"
  const notAsked = ['name', 'photo', 'lastgrowthupdate', 'insurancecardimage', 'drivefolderurl',
    'withdrawdetail', 'withdrawby', 'parentid', 'otrate'];
  const missing = declared.map(lc).filter(k => notAsked.indexOf(k) < 0 && shown.indexOf(k) < 0)
    // engine names that differ from the column name
    .filter(k => !{ studentid: 1, nameth: 1, nameen: 1, nickname: 1, nicknameen: 1, nationalid: 1, bloodtype: 1,
      medicalhistory: 1, emergencycontact: 1, enrolldate: 1, insurancehas: 1, insurancepolicyno: 1,
      insurancecompany: 1, insuranceexpiry: 1, withdrawreason: 1, withdrawdate: 1, createddate: 1 }[k]);
  eq('every column the registration form fills is in the record', missing, []);
}

console.log('\n2) a teacher gets what she needs to look after the child, and no more');
{
  const d = H.studentProfile({ studentId: 'S1', staffId: 'T1', role: 'Teacher' });
  eq('it is the care record', d.scope, 'care');
  eq('the allergy is there — it is the whole point', d.allergy, 'แพ้นมวัว');
  eq('...and the medical history', d.medicalHistory, 'หอบหืด');
  eq('...the blood type, for a hospital door', [d.bloodType, d.rh], ['O', 'Rh+']);
  eq('...the emergency contact', d.emergencyContact, 'คุณแม่ 081-234-5678');
  eq('...the date of birth and the growth figures', [d.dob, d.weight, d.height], ['2023-04-11', 12.4, 88]);
  eq('...and THAT there is cover, which is what she would say at the door', d.insuranceHas, true);
  // ...and nothing that is simply the family's business
  eq('no national ID', d.nationalId, undefined);
  eq('no home address', d.address, undefined);
  eq('no policy number', d.insurancePolicyNo, undefined);
  eq('no package, no money', [d.plan, d.otRate], [undefined, undefined]);
  eq('no parent record, no parent’s ID', [d.parents, d.parentId], [undefined, undefined]);
  eq('...not even race, nationality or religion', [d.race, d.nationality, d.religion], [undefined, undefined, undefined]);
}
{
  const d = H.studentProfile({ studentId: 'S1', staffId: 'HEAD', role: 'Teacher' });
  eq('a head teacher (Department "*") sees the whole record', d.scope, 'full');
}

console.log('\n3) scope is a permission, not a preference');
{
  throws_('a teacher cannot read a child from a class she does not cover',
    () => H.studentProfile({ studentId: 'S1', staffId: 'T2', role: 'Teacher' }), 'ชั้นที่ดูแล');
  throws_('...and a stranger cannot read one at all',
    () => H.studentProfile({ studentId: 'S1', staffId: 'NOPE', role: 'Teacher' }), 'เฉพาะคุณครูหรือแอดมิน');
  throws_('...nor a caller with no id',
    () => H.studentProfile({ studentId: 'S1' }), 'เฉพาะคุณครูหรือแอดมิน');
  throws_('a child who is not on the roll says so instead of crashing',
    () => H.studentProfile({ studentId: 'GONE', staffId: 'ADM', role: 'Admin' }), 'ไม่พบนักเรียน');
  ok_('an Observer reads it — it is a read', H.studentProfile({ studentId: 'S1', staffId: 'X', role: 'Observer' }).scope === 'full');
  ok_('the reason is written where the decision is made',
    /would still have put a[\s\S]{0,40}national ID on a phone in a classroom/.test(eng));
}

console.log('\n4) the screen');
{
  ok_('there is one, reachable from the teacher’s menu', /STU_profile\('\$\{esc\(sid\)\}'\)/.test(app));
  ok_('...and from the admin’s', /\$\{close\}STU_profile/.test(app));
  ok_('the urgent two are FIRST and in red', /ข้อควรระวัง/.test(app) && /d\.allergy\|\|d\.medicalHistory/.test(app));
  ok_('...and it says so plainly when there are none, rather than showing nothing',
    /ไม่มีประวัติแพ้หรือโรคประจำตัวที่บันทึกไว้/.test(app));
  ok_('the screen prints what the SERVER sent, never deciding for itself', /d\.scope==='full'\?row/.test(app));
  ok_('...and tells a teacher why her copy is shorter', /อยู่ในสิทธิ์ของแอดมิน/.test(app));
  ok_('an admin can go straight from reading it to editing it', /A_studentForm\('\$\{esc\(sid\)\}'\)/.test(app));
  ok_('stored values are shielded from the EN dictionary', /_notr\(v==null\|\|v===''\?'—':v\)/.test(app));
}

console.log('\n5) the admin can EDIT them, not just read them');
{
  /* The read-only record was only half the answer. The form an admin actually opens to change a
   * child — A_studentForm — had no date of birth, no gender, no blood type, no Rh, no address, no
   * emergency contact, no race/nationality/religion, no weight or height and no vaccine note. All of
   * them are collected at registration and land in the sheet; none of them could be seen or
   * corrected afterwards. A blood type nobody can open is a blood type the school does not have, and
   * a date of birth nobody can correct stays wrong for as long as the child is enrolled. */
  const form = app.slice(app.indexOf('window.A_studentForm=(id)=>{'), app.indexOf('window.A_studentLinks='));
  // a field is either written out (id="stf_X") or built by the f('X', …) helper, which supplies it
  const has = (label, id) => ok_(label,
    new RegExp('stf_' + id + '\\b').test(form) || new RegExp("\\bf\\('" + id + "'").test(form));
  has('date of birth is on the form', 'DOB');
  has('...gender', 'Gender');
  has('...blood type', 'BloodType');
  has('...Rh', 'RH');
  has('...weight', 'Weight');
  has('...height', 'Height');
  has('...emergency contact', 'EmergencyContact');
  has('...home address', 'Address');
  has('...race', 'Race');
  has('...nationality', 'Nationality');
  has('...religion', 'Religion');
  has('...vaccine notes', 'Vaccine');
  ok_('blood type is a list, not a free-text box that collects typos', /id="stf_BloodType"><select|<select id="stf_BloodType">/.test(form));

  const save = app.slice(app.indexOf('window.A_saveStudent=async(btn,id)=>{'), app.indexOf('window.A_saveStudent=async(btn,id)=>{') + 2000);
  ['DOB', 'Gender', 'BloodType', 'RH', 'EmergencyContact', 'Address', 'Race', 'Nationality', 'Religion', 'Vaccine']
    .forEach(k => ok_('save sends ' + k, new RegExp(k + ":v\\('" + k + "'\\)").test(save)));
  // a number column must keep '' as '' — 0 kg is a real weight and an unmeasured child is not it
  ok_('an unmeasured child is not saved as weighing nothing',
    /Weight:v\('Weight'\)===''\?'':\(Number/.test(save) && /Height:v\('Height'\)===''\?'':\(Number/.test(save));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
