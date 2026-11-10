/**
 * tools/test_application.js — ใบสมัครออนไลน์ ระยะ 1 (docs/APPLICATION_FORM_PLAN.md), the engine half
 *   node tools/test_application.js
 *
 * 🔴 ใบสมัคร ≠ นักเรียน. Until this, a family adding a child created an ACTIVE student billed from
 * today. The promises proven here:
 *   · an application is invisible to the roster, the register and billing until it is approved
 *   · approval builds the child through addStudentByAdmin — the same record as every other child —
 *     tied to the family the way addChildNew ties one
 *   · 💰 the start date is the admin's, never in the past, and nothing is billed before it
 *   · the consent the family gave is logged per item with the version of the words they read,
 *     and an item they declined is not recorded (7.3) — enforced on the server, not the screen
 *   · a re-submit returns the same application; another family cannot open or duplicate it
 *   · applications stay closed until the school fills the two blanks in the PDPA text
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function code_(fn) { try { fn(); return null; } catch (e) { return e.code || String(e.message || e); } }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js');

const p2 = n => String(n).padStart(2, '0');
const dayOff = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const TODAY = dayOff(0), TOMORROW = dayOff(1), YESTERDAY = dayOff(-1);
const NEXT_MONTH = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-01'; })();

function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [{ id: 'M6900', labelTH: 'รายเดือน', price: 6900 }], LeaveQuota: {}, BigCleaningDays: [],
      Departments: 'Nursery Baby,Nursery 1,Nursery 2,Nursery 3', ApplyRetentionYears: '5', ApplyPdpaContact: 'LINE @atomnursery' }, over.config || {}),
    students: [], parents: [
      { ParentID: 'PAR-001', NameTH: 'แม่ ทดสอบ', LineUID: 'Uaaa', Phone: '0811111111' },
      { ParentID: 'PAR-002', NameTH: 'พ่อ อื่น', LineUID: 'Ubbb', Phone: '0822222222' }],
    userLinks: [], classes: [{ ClassName: 'Nursery 1' }],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }],
    pickupPersons: [], growthRecords: [], payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [],
    otRecords: [], payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [],
    staffAttendanceHistory: [], leaves: [], absenceLog: [], absenceFollowups: [], absenceFollowupLogs: [], dspmCriteria: [],
    activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: [],
    vaccineRecords: [], studentTerms: [], withdrawals: [], applications: [], consents: [], applicationDocs: []
  };
  const ctx = { console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
// a valid Thai id (check digit computed, so the test does not depend on a real person's number)
function thaiId(first12) { let s = 0; for (let i = 0; i < 12; i++) s += (+first12[i]) * (13 - i); return first12 + ((11 - (s % 11)) % 10); }
const NID = thaiId('110170012345');
function form(H, over) {
  over = over || {};
  const info = H.applyInfo();
  return Object.assign({
    parentId: 'PAR-001', uid: 'Uaaa', lang: 'th', clientRef: 'r-' + Math.random(),
    child: { NameTH: 'ด.ญ. ทดลอง ใจดี', NameEN: 'Tadlong Jaidee', Nickname: 'น้องดี', NicknameEN: 'Dee', Gender: 'F',
      DOB: '2024-06-01', IdType: 'TH', NationalID: NID, Photo: '' },
    data: { child: { race: 'ไทย', nationality: 'ไทย', religion: 'พุทธ', weight: 11.5, height: 82,
        address: { no: '9/9', road: 'สุขุมวิท', province: 'กรุงเทพฯ', postcode: '10110' } },
      father: { name: 'พ่อ ใจดี', mobile: '0899999999' }, mother: { name: 'แม่ ทดสอบ' },
      pickups: [{ name: 'ยาย ใจดี', phone: '0877777777', relation: 'ยาย' }, { name: '' }],
      health: { walkAt: 12, blood: 'O', allergy: 'กุ้ง', chronic: 'หอบหืด', medication: 'ยาพ่น', drinkFrom: ['cup'] },
      wish: { startDate: NEXT_MONTH, pickupTime: '17:30' } },
    consents: { pdpa: true, health: true, daily: true, photoJournal: true, photoPublic: false },
    truth: true, signName: 'แม่ ทดสอบ', consentVersion: info.version
  }, over);
}
const nothingElse = M => [M.students.length, M.userLinks.length, M.pickupPersons.length, M.growthRecords.length, M.payments.length];

console.log('\n1) 🔴 ปิดอยู่จนกว่าโรงเรียนจะเติมช่องว่างใน PDPA');
{
  const { H, M } = boot({ config: { ApplyRetentionYears: '', ApplyPdpaContact: '' } });
  const info = H.applyInfo();
  eq('applyInfo บอกว่าปิด และบอกว่าขาดอะไร', [info.open, info.missing], [false, ['ApplyRetentionYears', 'ApplyPdpaContact']]);
  eq('ส่งใบสมัครไม่ได้ขณะปิด', code_(() => H.submitApplication(form(H))), 'APPLY_CLOSED');
  eq('...และไม่มีอะไรถูกเขียน', M.applications.length, 0);
  const b = boot({});
  const t = b.H.applyInfo();
  ok_('เปิดเมื่อเติมครบ · ข้อความมีตัวเลขปีและช่องทางติดต่อที่ตั้งไว้', t.open && t.text.th.pdpa.join('').indexOf('เก็บข้อมูลไว้ 5 ปี') >= 0
    && t.text.en.pdpa.join('').indexOf('LINE @atomnursery') >= 0 && t.text.th.pdpa.join('').indexOf('{') < 0);
  // ผอ. 2026-11-09: Atom's answers are 5 years, and the school's phone with the director's name
  const atom = boot({ config: { SchoolName: 'Atom Nursery', ApplyRetentionYears: '', ApplyPdpaContact: '' } }).H.applyInfo();
  ok_('Atom: เปิดได้ด้วยคำตอบของ ผอ. — 5 ปี · เบอร์โรงเรียน · ชื่อ ผอ.', atom.open && atom.years === '5'
    && /ศิลา เส็งพานิช/.test(atom.contact) && /02-731-5859/.test(atom.contact) && /ครูผู้อำนวยการ/.test(atom.contact)
    && atom.text.th.pdpa.join('').indexOf('เก็บข้อมูลไว้ 5 ปี') >= 0);
  const other = boot({ config: { SchoolName: 'โรงเรียนอื่น', ApplyRetentionYears: '', ApplyPdpaContact: '' } }).H.applyInfo();
  eq('🔴 โรงเรียนอื่นที่คัดลอกจาก Atom ไม่ได้คำตอบของ Atom — ยังปิด', [other.open, other.years, other.contact], [false, '', '']);
  const own = boot({ config: { SchoolName: 'Atom Nursery', ApplyRetentionYears: '7', ApplyPdpaContact: 'อีเมล x@y' } }).H.applyInfo();
  eq('ค่าที่ตั้งในหน้าตั้งค่าชนะค่าเริ่ม', [own.years, own.contact], ['7', 'อีเมล x@y']);
  const c = boot({ config: { ApplyRetentionYears: '10' } });
  ok_('ฉบับของข้อความเปลี่ยนเองเมื่อข้อความเปลี่ยน', c.H.applyInfo().version !== t.version && /^APP2569-[0-9a-f]{8}$/.test(t.version));
}

console.log('\n2) 🔴 ใบสมัคร ≠ นักเรียน — ส่งแล้วไม่ปรากฏที่ใดเลย');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H));
  eq('ได้ใบสมัคร APP-0001 สถานะรอพิจารณา', [r.appId, r.status, r.existing], ['APP-0001', 'SUBMITTED', false]);
  eq('ไม่มีนักเรียน · ไม่มีการเชื่อม LINE · ไม่มีผู้รับแทน · ไม่มีน้ำหนักส่วนสูง · ไม่มีบิล', nothingElse(M), [0, 0, 0, 0, 0]);
  eq('รายชื่อนักเรียนของแอดมินว่าง', H.listStudents ? H.listStudents({}).length : 0, 0);
  eq('สร้างบิลรายเดือน → ไม่มีใครถูกเรียกเก็บ', (H.generateMonthlyBills({ month: TODAY.slice(0, 7) }) || {}).created || 0, 0);
  const cons = M.consents.map(c => c.Item + '=' + c.Value);
  eq('บันทึกความยินยอมรายข้อ (รวมคำรับรองความจริงและ 7.1–7.2)', cons,
    ['truth=YES', 'pdpa=YES', 'health=YES', 'daily=YES', 'photoJournal=YES', 'photoPublic=NO']);
  ok_('ทุกแถวมีฉบับข้อความ · LINE id · ชื่อที่พิมพ์ · เวลาเซิร์ฟเวอร์',
    M.consents.every(c => c.Version === H.applyInfo().version && c.UserUID === 'Uaaa' && c.SignName === 'แม่ ทดสอบ' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(c.At)));
}

console.log('\n3) ส่งซ้ำไม่สร้างซ้ำ (บทเรียนผู้ปกครองซ้ำ 84 ราย)');
{
  const { H, M } = boot({});
  const f = form(H); const a = H.submitApplication(f); const b = H.submitApplication(Object.assign({}, f));
  eq('กดส่งซ้ำ (clientRef เดิม) → ใบเดิม', [b.appId, b.existing, M.applications.length], [a.appId, true, 1]);
  const c = H.submitApplication(form(H));
  eq('ส่งใหม่สำหรับเด็กคนเดิมขณะยังรอพิจารณา → ใบเดิม', [c.appId, c.existing, M.applications.length], [a.appId, true, 1]);
  eq('ผู้ปกครองอีกบ้านส่งเด็กคนเดียวกัน → ปฏิเสธ', code_(() => H.submitApplication(form(H, { parentId: 'PAR-002', uid: 'Ubbb' }))), 'DUP_APPLICATION');
  eq('ความยินยอมไม่ถูกบันทึกซ้ำ', M.consents.length, 6);
  H.cancelApplication({ appId: a.appId, parentId: 'PAR-001', uid: 'Uaaa' });
  const d = H.submitApplication(form(H));
  ok_('ยกเลิกแล้วส่งใหม่ได้', d.appId === 'APP-0002' && !d.existing);
}

console.log('\n4) ตรวจข้อมูลที่ฝั่งเซิร์ฟเวอร์');
{
  const { H, M } = boot({});
  const bad = (label, over, want) => eq(label, code_(() => H.submitApplication(form(H, over))), want);
  bad('เลขบัตรผิดหลักตรวจสอบ', { child: Object.assign({}, form(H).child, { NationalID: NID.slice(0, 12) + ((+NID[12] + 1) % 10) }) }, 'BAD_INPUT');
  bad('ไม่มีวันเกิด', { child: Object.assign({}, form(H).child, { DOB: '' }) }, 'BAD_INPUT');
  bad('ไม่มีชื่อเล่นภาษาอังกฤษ', { child: Object.assign({}, form(H).child, { NicknameEN: '' }) }, 'BAD_INPUT');
  bad('ยังไม่เลือกครบ 4 ข้อ', { consents: { pdpa: true, health: true, daily: true, photoJournal: true } }, 'BAD_INPUT');
  bad('ไม่ยินยอม 7.1–7.2', { consents: { pdpa: false, health: true, daily: true, photoJournal: true, photoPublic: true } }, 'BAD_INPUT');
  bad('ไม่ได้พิมพ์ชื่อ', { signName: '' }, 'BAD_INPUT');
  bad('ไม่ได้ยืนยันความจริง', { truth: false }, 'BAD_INPUT');
  bad('ข้อความยินยอมเปลี่ยนระหว่างกรอก', { consentVersion: 'APP2569-00000000' }, 'CONSENT_CHANGED');
  bad('ยังไม่ได้ลงทะเบียนผู้ปกครอง', { parentId: '' }, 'NEEDS_REGISTRATION');
  bad('ส่ง parentId ที่ไม่มีอยู่', { parentId: 'PAR-999' }, 'NEEDS_REGISTRATION');
  eq('ไม่มีอะไรถูกเขียนจากคำขอที่ถูกปฏิเสธ', [M.applications.length, M.consents.length], [0, 0]);
  const pp = H.submitApplication(form(H, { child: Object.assign({}, form(H).child, { IdType: 'PASSPORT', NationalID: '', Passport: 'AB1234567' }) }));
  ok_('เด็กต่างชาติ: ใช้พาสปอร์ตแทนเลขบัตรได้', pp.status === 'SUBMITTED' && M.applications[0].Passport === 'AB1234567' && M.applications[0].NationalID === '');
}

console.log('\n5) 🔴 ข้อที่ไม่ยินยอมจะไม่ถูกบันทึก (7.3) — บังคับที่เซิร์ฟเวอร์');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H, { consents: { pdpa: true, health: false, daily: false, photoJournal: true, photoPublic: true } }));
  const d = JSON.parse(M.applications[0].Data);
  eq('ไม่ยินยอมข้อ 1 → หมู่เลือด อาการแพ้ โรคประจำตัว ยา ถูกทิ้ง', [d.health.blood, d.health.allergy, d.health.chronic, d.health.medication], [undefined, undefined, undefined, undefined]);
  eq('...พัฒนาการ/นิสัยที่ไม่ใช่ข้อมูลสุขภาพยังอยู่', d.health.walkAt, 12);
  eq('ไม่ยินยอมข้อ 2 → น้ำหนัก ส่วนสูง ถูกทิ้ง', [d.child.weight, d.child.height], [undefined, undefined]);
  H.approveApplication({ appId: r.appId, startDate: NEXT_MONTH, className: 'Nursery 1', adminId: 'ADM' });
  const s = M.students[0];
  eq('รับเข้าแล้ว นักเรียนไม่มีข้อมูลสุขภาพ', [s.BloodType || '', s.Allergy || '', s.Weight || '', s.Height || ''], ['', '', '', '']);
  eq('...และไม่มีแถวน้ำหนักส่วนสูงแรก', M.growthRecords.length, 0);
}

console.log('\n6) เห็นได้เฉพาะของตัวเอง');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H));
  H.rejectApplication({ appId: r.appId, parentMessage: 'ชั้นเต็ม ขออภัย', internalNote: 'ห้องเต็มถึงเมษา', adminId: 'ADM' });
  eq('บ้านอื่นเปิดดูไม่ได้', code_(() => H.myApplication({ appId: r.appId, parentId: 'PAR-002', uid: 'Ubbb' })), 'NO_ACCESS');
  eq('บ้านอื่นยกเลิกไม่ได้', code_(() => H.cancelApplication({ appId: r.appId, parentId: 'PAR-002', uid: 'Ubbb' })), 'NO_ACCESS');
  eq('รายการของบ้านอื่นว่าง', H.myApplications({ parentId: 'PAR-002', uid: 'Ubbb' }).length, 0);
  const mine = H.myApplications({ parentId: 'PAR-001', uid: 'Uaaa' })[0];
  eq('เจ้าของเห็นสถานะและข้อความที่แอดมินส่ง', [mine.status, mine.parentMessage], ['REJECTED', 'ชั้นเต็ม ขออภัย']);
  ok_('...แต่ไม่เห็นเหตุผลภายใน', JSON.stringify(H.myApplication({ appId: r.appId, parentId: 'PAR-001' })).indexOf('ห้องเต็มถึงเมษา') < 0);
  ok_('แอดมินเห็นเหตุผลภายใน', H.applicationAdmin({ appId: r.appId }).internalNote === 'ห้องเต็มถึงเมษา');
  eq('ไม่รับแล้วรับเข้าซ้ำไม่ได้', code_(() => H.approveApplication({ appId: r.appId, startDate: NEXT_MONTH, adminId: 'ADM' })), 'BAD_STATE');
  eq('...และยกเลิกไม่ได้', code_(() => H.cancelApplication({ appId: r.appId, parentId: 'PAR-001' })), 'BAD_STATE');
  eq('ไม่มีนักเรียนถูกสร้าง', M.students.length, 0);
}

console.log('\n7) นัดเยี่ยมชม');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H));
  eq('ไม่มีเวลา → ปฏิเสธ', code_(() => H.setApplicationVisit({ appId: r.appId, visitAt: TOMORROW })), 'BAD_INPUT');
  const v = H.setApplicationVisit({ appId: r.appId, visitAt: TOMORROW + 'T10:30', note: 'พาน้องมาด้วย', adminId: 'ADM' });
  eq('นัดแล้ว สถานะ VISIT', [v.status, v.visitAt], ['VISIT', TOMORROW + ' 10:30']);
  const mine = H.myApplications({ parentId: 'PAR-001' })[0];
  eq('ผู้ปกครองเห็นวันเวลาและหมายเหตุ', [mine.visitAt, mine.visitNote], [TOMORROW + ' 10:30', 'พาน้องมาด้วย']);
  eq('เลื่อนนัดได้ขณะยังไม่ตัดสิน', H.setApplicationVisit({ appId: r.appId, visitAt: TOMORROW + ' 14:00' }).visitAt, TOMORROW + ' 14:00');
  eq('ยังไม่มีนักเรียน', M.students.length, 0);
}

console.log('\n8) รับเข้า — นักเรียนแบบเดียวกับที่แอดมินเพิ่มเอง · ผูกกับครอบครัว');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H));
  eq('💰 วันเริ่มเรียนย้อนหลัง → ปฏิเสธ', code_(() => H.approveApplication({ appId: r.appId, startDate: YESTERDAY, adminId: 'ADM' })), 'BAD_INPUT');
  eq('ไม่มีวันเริ่มเรียน → ปฏิเสธ', code_(() => H.approveApplication({ appId: r.appId, adminId: 'ADM' })), 'BAD_INPUT');
  eq('...ไม่มีอะไรถูกสร้าง', nothingElse(M), [0, 0, 0, 0, 0]);
  const a = H.approveApplication({ appId: r.appId, startDate: NEXT_MONTH, plan: 'M6900', adminId: 'ADM' });
  const s = M.students[0];
  eq('สร้างนักเรียน 1 คน · ใบสมัครชี้ไปที่นักเรียน', [M.students.length, a.status, a.studentId], [1, 'ACCEPTED', s.StudentID]);
  eq('ชั้นตามอายุ (เกิด 2024-06 → Nursery 1 หรือ 2 ตามวันนี้) · วันเริ่มเรียนตามที่แอดมินเลือก · แผน',
    [!!s.Class, s.EnrollDate, s.Plan, s.Status], [true, NEXT_MONTH, 'M6900', 'ACTIVE']);
  eq('ผูกกับผู้ปกครองที่สมัคร (ParentID + LINE)', [s.ParentID, M.userLinks.map(l => l.UserUID + '>' + l.StudentID + '>' + l.VerifiedBy)],
    ['PAR-001', ['Uaaa>' + s.StudentID + '>application']]);
  eq('ผู้รับแทน (เฉพาะช่องที่กรอก)', M.pickupPersons.map(x => x.Name + '|' + x.Phone + '|' + x.StudentID), ['ยาย ใจดี|0877777777|' + s.StudentID]);
  eq('ข้อมูลสุขภาพ (ยินยอมข้อ 1) · น้ำหนักแรก (ยินยอมข้อ 2)', [s.BloodType, s.Allergy, M.growthRecords.length], ['O', 'กุ้ง', 1]);
  ok_('โรคประจำตัว + ยาประจำ อยู่ใน MedicalHistory', /หอบหืด/.test(s.MedicalHistory) && /ยาพ่น/.test(s.MedicalHistory));
  ok_('ที่อยู่ประกอบจากช่องย่อย', /9\/9/.test(s.Address) && /10110/.test(s.Address));
  ok_('ความยินยอมทุกแถวชี้ไปที่นักเรียนแล้ว', M.consents.every(c => c.StudentID === s.StudentID));
  // the same KIND of record as the admin's own path — compared field by field, not trusted
  const b = boot({}); b.H.addStudentByAdmin({ student: { NameTH: 'x', NameEN: 'x', NicknameEN: 'x', DOB: '2024-06-01', EnrollDate: NEXT_MONTH }, adminId: 'ADM' });
  const missing = Object.keys(b.M.students[0]).filter(k => !(k in s));
  eq('ทุกช่องที่ addStudentByAdmin สร้าง มีในนักเรียนที่รับเข้า', missing, []);
  eq('รับเข้าซ้ำไม่ได้', code_(() => H.approveApplication({ appId: r.appId, startDate: NEXT_MONTH, adminId: 'ADM' })), 'BAD_STATE');
  eq('ผู้ปกครองเห็นว่ารับเข้าแล้ว พร้อมชั้นและวันเริ่ม', (() => { const m = H.myApplications({ parentId: 'PAR-001' })[0]; return [m.status, m.startDate, m.studentId]; })(),
    ['ACCEPTED', NEXT_MONTH, s.StudentID]);
  eq('ส่งใบสมัครเด็กคนนี้อีก → เป็นนักเรียนอยู่แล้ว', code_(() => H.submitApplication(form(H))), 'ALREADY_STUDENT');
}

console.log('\n9) 💰 วันเริ่มเรียนในอนาคต → ไม่มียอดเรียกเก็บเดือนนี้');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H));
  H.approveApplication({ appId: r.appId, startDate: NEXT_MONTH, plan: 'M6900', adminId: 'ADM' });
  const g = H.generateMonthlyBills({ month: TODAY.slice(0, 7) }) || {};
  eq('บิลเดือนนี้ไม่ถูกสร้างให้เด็กที่ยังไม่เริ่มเรียน', [g.created || 0, M.payments.length], [0, 0]);
  const n = H.generateMonthlyBills({ month: NEXT_MONTH.slice(0, 7) }) || {};
  eq('...เดือนที่เริ่มเรียนถูกเรียกเก็บตามปกติ', n.created, 1);
}

console.log('\n10) พี่น้อง — ผู้ปกครองที่มีลูกอยู่แล้วสมัครลูกคนที่สองผ่านใบสมัคร');
{
  const { H, M } = boot({});
  const r1 = H.submitApplication(form(H));
  H.approveApplication({ appId: r1.appId, startDate: TODAY, adminId: 'ADM' });
  const sib = form(H, { child: { NameTH: 'ด.ช. น้องเล็ก ใจดี', NameEN: 'Nonglek Jaidee', NicknameEN: 'Lek', Gender: 'M', DOB: '2025-03-01',
    IdType: 'TH', NationalID: thaiId('110170012399') } });
  const r2 = H.submitApplication(sib);
  eq('ใบที่สองเป็นใบใหม่ ไม่กระทบลูกคนแรก', [r2.appId, r2.status, M.students.length], ['APP-0002', 'SUBMITTED', 1]);
  H.approveApplication({ appId: r2.appId, startDate: TODAY, adminId: 'ADM' });
  eq('รับเข้าแล้ว ผู้ปกครองคนเดิมเห็นลูกทั้งสอง', M.userLinks.filter(l => l.UserUID === 'Uaaa').length, 2);
}

console.log('\n12) 📎 ระยะ 2 — เอกสารแนบ: ใครแนบ/ดู/ลบได้');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H, { signature: 'data:image/png;base64,AAAA' }));
  const P = { parentId: 'PAR-001', uid: 'Uaaa', __role: 'Parent' }, Q = { parentId: 'PAR-002', uid: 'Ubbb', __role: 'Parent' };
  const A = { __role: 'Admin', adminId: 'ADM' }, T = { staffId: 'STF-T', __role: 'Teacher' };
  const up = (who, o) => H.uploadApplicationDoc(Object.assign({ appId: r.appId, docType: 'birth', mime: 'image/jpeg', size: 1000, data: 'data:image/jpeg;base64,BBBB', name: 'birth.jpg' }, who, o || {}));
  eq('🔴 ลายเซ็นเก็บเป็นเอกสารแบบปิด ไม่ใช่รูปลิงก์สาธารณะ', [M.applications[0].Image, M.applicationDocs.map(d => d.DocType)], ['', ['signature']]);
  const d1 = up(P);
  eq('ผู้ปกครองเจ้าของแนบได้', [d1.type, d1.by], ['birth', 'parent']);
  eq('🔴 บ้านอื่นแนบไม่ได้', code_(() => up(Q)), 'NO_ACCESS');
  eq('🔴 ครูแนบไม่ได้', code_(() => up(T)), 'NO_PERMISSION');
  eq('🔴 ครูเปิดดูไม่ได้', code_(() => H.applicationDocFile(Object.assign({ docId: d1.docId }, T))), 'NO_PERMISSION');
  eq('🔴 บ้านอื่นเปิดดูไม่ได้', code_(() => H.applicationDocFile(Object.assign({ docId: d1.docId }, Q))), 'NO_ACCESS');
  eq('🔴 ส่ง __role ปลอมเป็นลายเซ็นไม่ได้ (เฉพาะเซิร์ฟเวอร์)', code_(() => up(P, { docType: 'signature' })), 'BAD_INPUT');
  eq('ชนิดไฟล์อื่น (เช่น .docx) แนบไม่ได้', code_(() => up(P, { mime: 'application/msword' })), 'BAD_INPUT');
  eq('ใหญ่เกิน 5 MB แนบไม่ได้', code_(() => up(P, { size: 5 * 1024 * 1024 + 1 })), 'TOO_LARGE');
  ok_('PDF แนบได้', up(P, { mime: 'application/pdf', docType: 'house' }).type === 'house');
  eq('ผู้ปกครองเห็นรายการของตัวเอง (ไม่รวมลายเซ็น)', H.applicationDocs(Object.assign({ appId: r.appId }, P)).map(d => d.type), ['birth', 'house']);
  eq('แอดมินเปิดไฟล์ได้', H.applicationDocFile(Object.assign({ docId: d1.docId }, A)).data, 'data:image/jpeg;base64,BBBB');
  const dA = up(A, { docType: 'parentId' });
  eq('แอดมินถ่าย/อัปโหลดแทนได้', dA.by, 'admin');
  eq('ผู้ปกครองลบไฟล์ที่แอดมินแนบไม่ได้', code_(() => H.deleteApplicationDoc(Object.assign({ docId: dA.docId }, P))), 'BAD_STATE');
  eq('ลายเซ็นลบไม่ได้ (หลักฐานการยินยอม)', code_(() => H.deleteApplicationDoc(Object.assign({ docId: M.applicationDocs[0].DocID }, A))), 'BAD_STATE');
  eq('ผู้ปกครองลบไฟล์ของตัวเองได้ขณะรอพิจารณา', H.deleteApplicationDoc(Object.assign({ docId: d1.docId }, P)).docId, d1.docId);
  ok_('...ไฟล์ที่ลบ ไม่มีเนื้อไฟล์เหลือในแถว และไม่อยู่ในรายการ', !('Data' in M.applicationDocs.find(d => d.DocID === d1.docId))
    && H.applicationDocs(Object.assign({ appId: r.appId }, A)).every(d => d.docId !== d1.docId));
  H.setApplicationDocsStatus({ appId: r.appId, complete: true, adminId: 'ADM' });
  eq('แอดมินติ๊กเอกสารครบ', H.applicationAdmin({ appId: r.appId }).docsStatus, 'COMPLETE');
  // approve → the papers become the child's
  const ap = H.approveApplication({ appId: r.appId, startDate: NEXT_MONTH, adminId: 'ADM' });
  ok_('รับเข้าแล้ว เอกสารทุกไฟล์ชี้ไปที่นักเรียน', M.applicationDocs.filter(d => d.Status !== 'DELETED').every(d => d.StudentID === ap.studentId));
  eq('รับเข้าแล้ว ผู้ปกครองแนบเพิ่มเองไม่ได้ (ติดต่อโรงเรียน)', code_(() => up(P)), 'BAD_STATE');
  ok_('...แต่แอดมินแนบเพิ่มได้ และเป็นของนักเรียนทันที', up(A, { docType: 'vaccine' }).studentId === ap.studentId);
}

console.log('\n13) 🔴 ไม่รับ / ยกเลิก + 90 วัน → ลบเอกสาร (ลายเซ็นและข้อมูลใบสมัครยังอยู่)');
{
  const { H, M } = boot({});
  const r = H.submitApplication(form(H, { signature: 'data:image/png;base64,AAAA' }));
  const P = { parentId: 'PAR-001', uid: 'Uaaa', __role: 'Parent' };
  H.uploadApplicationDoc(Object.assign({ appId: r.appId, docType: 'birth', mime: 'image/jpeg', size: 10, data: 'data:image/jpeg;base64,BB' }, P));
  H.rejectApplication({ appId: r.appId, adminId: 'ADM' });
  const decided = M.applications[0].DecidedAt.slice(0, 10);
  // local calendar arithmetic (the suite rule: never derive a date from UTC)
  const day = n => { const [y, m, d] = decided.split('-').map(Number); const x = new Date(y, m - 1, d + n);
    return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate()); };
  eq('วันที่ 89 หลังไม่รับ → ยังไม่ลบ', H.purgeApplicationDocs({ today: day(89) }).deleted, 0);
  const g = H.purgeApplicationDocs({ today: day(90) });
  eq('วันที่ 90 → ลบเอกสาร 1 ไฟล์', [g.deleted, g.retentionDays], [1, 90]);
  eq('...ลายเซ็นยังอยู่ · ใบสมัครและความยินยอมยังอยู่', [M.applicationDocs.filter(d => d.Status === 'ACTIVE').map(d => d.DocType), M.applications.length, M.consents.length > 0], [['signature'], 1, true]);
  eq('รันซ้ำไม่ลบซ้ำ', H.purgeApplicationDocs({ today: day(200) }).deleted, 0);
  // withdrawn: the clock starts when the family withdraws
  const b = boot({}); const r2 = b.H.submitApplication(form(b.H));
  b.H.uploadApplicationDoc(Object.assign({ appId: r2.appId, docType: 'house', mime: 'application/pdf', size: 10, data: 'data:application/pdf;base64,CC' }, P));
  b.H.cancelApplication({ appId: r2.appId, parentId: 'PAR-001' });
  ok_('ยกเลิกเองก็นับ 90 วันจากวันที่ยกเลิก', /^\d{4}-\d{2}-\d{2}/.test(b.M.applications[0].DecidedAt) && b.H.purgeApplicationDocs({ today: TODAY }).deleted === 0);
  // accepted / still open: never purged
  const c = boot({}); const r3 = c.H.submitApplication(form(c.H));
  c.H.uploadApplicationDoc(Object.assign({ appId: r3.appId, docType: 'house', mime: 'application/pdf', size: 10, data: 'data:application/pdf;base64,CC' }, P));
  eq('ใบที่ยังรอพิจารณา ไม่ถูกลบไม่ว่าจะนานแค่ไหน', c.H.purgeApplicationDocs({ today: '2099-01-01' }).deleted, 0);
  c.H.approveApplication({ appId: r3.appId, startDate: NEXT_MONTH, adminId: 'ADM' });
  eq('ใบที่รับเข้าแล้ว เอกสารเป็นของนักเรียน ไม่ถูกลบ', c.H.purgeApplicationDocs({ today: '2099-01-01' }).deleted, 0);
}

console.log('\n14) 🔒 ระยะ 3 — ความยินยอม 7.3 ใช้ได้จริง');
{
  const { H, M } = boot({});
  M.students.push({ StudentID: 'STD-OLD', NameTH: 'เด็กเดิม', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01', EnrollDate: '2025-01-01' });
  const r = H.submitApplication(form(H, { consents: { pdpa: true, health: true, daily: true, photoJournal: false, photoPublic: false } }));
  const ap = H.approveApplication({ appId: r.appId, startDate: TODAY, className: 'Nursery 1', adminId: 'ADM' });
  const sid = ap.studentId;
  eq('เด็กเดิม (ไม่มีบันทึกในระบบ) = ใช้ได้ตามใบสมัครกระดาษ', H.studentConsents({ studentId: 'STD-OLD' }).current, { health: '', daily: '', photoJournal: '', photoPublic: '' });
  eq('เด็กจากใบสมัคร: คำตอบของผู้ปกครองติดตัวเด็กไป', H.studentConsents({ studentId: sid }).current, { health: 'YES', daily: 'YES', photoJournal: 'NO', photoPublic: 'NO' });
  const rows = H.listStudents({}).filter(s => s.StudentID === sid || s.StudentID === 'STD-OLD');
  eq('รายชื่อนักเรียนแสดงเฉพาะข้อที่ "ไม่ยินยอม"', rows.map(s => s.StudentID + ':' + s.noConsent.join(',')).sort(), ['STD-OLD:', sid + ':photoJournal,photoPublic'].sort());
  // the journal: no picture for this child; the other child is untouched
  M.studentAttendanceToday.push({ StudentID: sid, Status: 'IN' }, { StudentID: 'STD-OLD', Status: 'IN' });
  const J = (id, ph) => H.submitJournal({ studentId: id, staffId: 'ADM', Mood: 'Happy', Photo1: ph });
  eq('🔴 บันทึกประจำวันแนบรูปเด็กที่ไม่ยินยอมไม่ได้', code_(() => J(sid, 'data:image/jpeg;base64,AA')), 'NO_CONSENT');
  ok_('...แต่บันทึกโดยไม่แนบรูปได้ตามปกติ', code_(() => J(sid, '')) === null);
  ok_('เด็กเดิมแนบรูปได้ตามเดิม (ไม่กระทบฟังก์ชันเดิม)', code_(() => J('STD-OLD', 'data:image/jpeg;base64,AA')) === null);
  // the office records a change — appended, latest wins, history kept
  H.setStudentConsent({ studentId: 'STD-OLD', item: 'photoPublic', value: 'NO', note: 'ใบสมัครกระดาษ 2569', adminId: 'ADM' });
  H.setStudentConsent({ studentId: sid, item: 'photoJournal', value: 'YES', note: 'คุณแม่โทรมาแจ้ง', adminId: 'ADM' });
  eq('แอดมินบันทึกเปลี่ยนได้ · ค่าล่าสุดชนะ', [H.studentConsents({ studentId: 'STD-OLD' }).current.photoPublic, H.studentConsents({ studentId: sid }).current.photoJournal], ['NO', 'YES']);
  ok_('ประวัติยังอยู่ครบ (ไม่ทับของเดิม)', H.studentConsents({ studentId: sid }).history.filter(h => h.item === 'photoJournal').map(h => h.value).join('>') === 'NO>YES');
  ok_('หลังเปลี่ยนเป็นยินยอม แนบรูปได้', code_(() => J(sid, 'data:image/jpeg;base64,AA')) === null);
  eq('ค่าที่ไม่ถูกต้องถูกปฏิเสธ', [code_(() => H.setStudentConsent({ studentId: sid, item: 'x', value: 'NO' })), code_(() => H.setStudentConsent({ studentId: sid, item: 'daily', value: 'maybe' }))], ['BAD_INPUT', 'BAD_INPUT']);
  // the printable application carries everything it prints
  const d = H.applicationDocument({ appId: r.appId });
  ok_('🖨️ เอกสารพิมพ์: ข้อความ PDPA ฉบับไทย/อังกฤษ · ฉบับตรงกัน · หัวกระดาษโรงเรียน · คำตอบ',
    d.text.th.pdpa.length > 5 && d.text.en.items.photoPublic && d.versionMatches === true && 'DocSchoolName' in d.school && d.data.pickups.filter(x => x.name).length === 1 && d.consents.length === 6);
}

console.log('\n11) หน้าจอ — ทางเข้าเดียวคือใบสมัคร');
{
  const app = R('webapp/app.js'), html = R('webapp/index.html'), code = R('src/Code.gs');
  ok_('🔴 ปุ่ม "เพิ่มบุตรหลานคนใหม่" เปิดใบสมัคร ไม่ใช่ฟอร์มสร้างนักเรียนเดิม', /remove\(\);APPLY_START\(\)/.test(app) && !/remove\(\);REG_CHILD_FORM\(\)/.test(app));
  /* ผอ. 2026-11-10: ไม่อยู่หน้าแรกแล้ว — เข้าระบบก่อน · ไม่มี UID จึงเห็นทางเลือกสมัครเรียน */
  ok_('🔴 ปุ่มสมัครเรียนไม่อยู่หน้าแรก (ทั้งโครงหน้าและ loginScreen)', !/APPLY_INTENT/.test(html) && !/class="lgrow" onclick="APPLY_INTENT/.test(app));
  ok_('บัญชีที่ยังไม่มีในระบบเห็น "สมัครเรียน" เป็นทางแรก และไปลงทะเบียนผู้ปกครองก่อน',
    /<button class="role-card" onclick="APPLY_INTENT\(\)">/.test(app) && /window\.APPLY_INTENT=\(\)=>\{[^\n]*setItem\('atom_apply_intent','1'\)[^\n]*REG_START\(\); \};/.test(app));
  ok_('🔴 พนักงานไม่ได้เลือก Role เอง — ทางที่สามแค่เปิดกล่อง LINE ID ให้ส่งแอดมิน',
    /window\.ACCT_STAFF=\(\)=>\{ const b=\$\('#acctStaffBox'\)/.test(app) && !/ACCT_STAFF[^\n]*(LOGIN_|api\()/.test(app));
  ok_('ครอบครัวใหม่ที่ลงทะเบียนเพราะจะสมัคร ไปที่ใบสมัครต่อทันที', /APPLY_INTENT_PENDING\(\)\?APPLY_START\(\):P_addChild\(\)/.test(app));
  ok_('🔴 ตัวจัดการ inline ไม่อ้างตัวแปรภายใน (APP_S) — เคยทำให้ติ๊กคำรับรองไม่ได้', !/on[a-z]+="[^"]*APP_S/.test(app));
  ok_('💰 ช่องวันเริ่มเรียนตอนรับเข้าห้ามเลือกวันย้อนหลัง', /id="apAS" type="date" min="\$\{today\}"/.test(app));
  ok_('เวลารับกลับที่ผู้ปกครองแจ้ง ไม่ถูกนำไปตั้ง OT', !/EndTime[^\n]{0,80}pickupTime|pickupTime[^\n]{0,80}EndTime/.test(app + eng));
  ok_('📎 เอกสารเปิดผ่าน applicationDocFile เท่านั้น — ไม่มีการสร้างลิงก์ Drive ในหน้าเอกสาร',
    /APP_docView=async[\s\S]{0,200}api\('applicationDocFile'/.test(app) && !/APP_docs=[\s\S]{0,3000}drive\.google\.com/.test(app));
  ok_('📎 รูปเอกสารย่อที่ 1600px (อ่านออก) ไม่ใช่ 640px แบบรูปทั่วไป', /compressImage\(f,1600,0\.85\)/.test(app));
  ok_('📎 สำรองข้อมูลประจำวันลบเอกสารของใบที่ไม่รับ/ยกเลิก', /purgeApplicationDocs_\(\)/.test(R('src/Backup.gs')));
  ok_('ประตูของแอดมินอยู่ใน ADMIN_ONLY', ['listApplications', 'applicationAdmin', 'setApplicationVisit', 'rejectApplication', 'approveApplication']
    .every(n => new RegExp('\\b' + n + ': 1').test(code)));
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
