/**
 * tools/test_first_bill_insurance.js — two things asked for on 2026-11-25, for the new system (not UAT)
 *   node tools/test_first_bill_insurance.js
 *
 * 🧾 THE FIRST BILL. After accepting an application the admin issues tuition AND the entrance fee,
 *    deposit, a discount… on one screen. Proven here:
 *    · billQuote shows the figure issueBill will put on the bill — the same function (issueQuote_),
 *      including part-month starts, the student's standing discount, and every refusal
 *    · issueBill itself still behaves exactly as before (amounts, refusals, custom amount)
 *    · a month that already has a bill is REPORTED by billQuote, so the screen never overwrites it
 *    · the extra lines are the finance screen's own addStudentCharge, and a discount comes off the
 *      month's total and stops at zero (monthDiscount_, unchanged)
 *    · the school's usual items (ChargePresets) are read leniently and saved through setSchoolConfig
 *
 * 🛡️ THE FAMILY'S OWN INSURANCE (ประกันส่วนตัว). Free text, separate from the school's policy:
 *    · one cleaner (atomPrivateInsClean_) for every writer — Apps Script uses the same function
 *    · the family writes it (application, ข้อมูลของฉัน), the admin writes it, a TEACHER cannot
 *    · a teacher reads company / cover / claims phone — never the policy number; admin + family read all
 *    · an accepted application carries it onto the student (and the attach path fills it if empty)
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

const p2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const dayOff = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = dayOff(0);
const monthOff = (n, day) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + (day ? '-' + p2(day) : ''); };
const NEXT_MONTH = monthOff(1), NEXT_15 = monthOff(1, 15), NEXT_1 = monthOff(1, 1);

function boot(over) {
  over = over || {};
  const M = {
    config: Object.assign({ Plans: [{ id: 'M6900', labelTH: 'รายเดือน', price: 6900 }], LeaveQuota: {}, BigCleaningDays: [],
      Departments: 'Nursery Baby,Nursery 1,Nursery 2,Nursery 3', ApplyRetentionYears: '5', ApplyPdpaContact: 'LINE @atomnursery' }, over.config || {}),
    students: over.students || [], parents: [
      { ParentID: 'PAR-001', NameTH: 'แม่ ทดสอบ', LineUID: 'Uaaa', Phone: '0811111111', StudentID: 'STD-001' }],
    userLinks: over.userLinks || [], classes: [{ ClassName: 'Nursery 1' }, { ClassName: 'Nursery 2' }],
    staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' },
      { StaffID: 'T1', NameTH: 'ครูหนึ่ง', Role: 'Teacher', PositionLevel: 'Teacher', Status: 'ACTIVE', Department: 'Nursery 1' }],
    pickupPersons: [], growthRecords: [], payments: over.payments || [], studentCharges: over.studentCharges || [],
    prepayments: over.prepayments || [], otDaily: [], paymentSlips: [],
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
  return { H: ctx.createAtomAPI(M, {}).H, M, ctx };
}
const kid = o => Object.assign({ StudentID: 'STD-001', NameTH: 'ด.ญ. ทดลอง ใจดี', Nickname: 'ดี', Class: 'Nursery 1', Plan: 'M6900',
  Status: 'ACTIVE', ParentID: 'PAR-001', DOB: '2024-06-01', EnrollDate: '2025-01-06' }, o || {});
const INS = { has: 'YES', list: [{ company: 'เมืองไทยประกันชีวิต', policyNo: 'MT-123456', coverage: 'OPD 2,000/ครั้ง · IPD 50,000', expiry: '2099-12-31', hotline: '1766' }] };

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) 🛡️ one cleaner for every writer');
{
  const { ctx } = boot();
  const C = (v) => ctx.atomPrivateInsClean_(v, 'PAR-001', '2026-11-25 10:00:00');
  const ok = C(INS);
  ok_('a full entry is accepted', ok.ok === true);
  eq('...stored as JSON with who and when', JSON.parse(ok.value).by + '|' + JSON.parse(ok.value).at, 'PAR-001|2026-11-25 10:00:00');
  eq('"ไม่มี" is an answer and is kept', JSON.parse(C({ has: 'NO', list: [INS.list[0]] }).value), { has: 'NO', list: [], at: '2026-11-25 10:00:00', by: 'PAR-001' });
  eq('not answered → stored as blank', C({}).value, '');
  ok_('🔴 "มี" with nothing typed is refused', C({ has: 'YES', list: [] }).ok === false);
  ok_('🔴 a policy without a company is refused', C({ has: 'YES', list: [{ coverage: 'x' }] }).ok === false);
  ok_('🔴 a policy without what it covers is refused', C({ has: 'YES', list: [{ company: 'x' }] }).ok === false);
  ok_('🔴 more than three policies is refused', C({ has: 'YES', list: [1, 2, 3, 4].map(i => ({ company: 'c' + i, coverage: 'x' })) }).ok === false);
  const long = C({ has: 'YES', list: [{ company: 'ก'.repeat(500), coverage: 'ข'.repeat(5000), policyNo: '9'.repeat(200), hotline: '1'.repeat(99), expiry: '31/12/2099' }] });
  const L = JSON.parse(long.value).list[0];
  eq('every field is capped, and a date that is not YYYY-MM-DD is dropped', [L.company.length, L.coverage.length, L.policyNo.length, L.hotline.length, L.expiry], [120, 1000, 60, 40, '']);
  eq('blank rows are dropped, not refused', JSON.parse(C({ has: 'YES', list: [{}, INS.list[0], { company: '' }] }).value).list.length, 1);
  eq('a broken stored value reads as "not answered"', ctx.atomPrivateIns_('{not json').has, '');
  ok_('Apps Script cleans with THIS function (admin form)', /atomPrivateInsClean_\(row\.PrivateInsurance/.test(R('src/Staff.gs')));
  ok_('...and the family\'s ข้อมูลของฉัน', /atomPrivateInsClean_\(d\.PrivateInsurance/.test(R('src/Staff.gs')));
}

console.log('\n2) 🛡️ who writes it');
{
  const { H, M } = boot({ students: [kid()] });
  H.saveStudentSelf({ studentId: 'STD-001', parentId: 'PAR-001', data: { PrivateInsurance: INS } });
  eq('the family saves it from ข้อมูลของฉัน', JSON.parse(M.students[0].PrivateInsurance).list[0].company, 'เมืองไทยประกันชีวิต');
  H.saveStudentSelf({ studentId: 'STD-001', staffId: 'T1', data: { PrivateInsurance: { has: 'NO' }, Allergy: 'นม' } });
  eq('🔴 a teacher\'s save leaves it alone (and still saves what they may)', [JSON.parse(M.students[0].PrivateInsurance).has, M.students[0].Allergy], ['YES', 'นม']);
  eq('🔴 a bad entry from the family is refused, in Thai', code_(() => H.saveStudentSelf({ studentId: 'STD-001', parentId: 'PAR-001', data: { PrivateInsurance: { has: 'YES', list: [{ company: 'x' }] } } })), 'BAD_INPUT');
  H.saveStudent({ studentId: 'STD-001', adminId: 'ADM', data: { PrivateInsurance: { has: 'NO' } } });
  eq('the admin saves it from the student form', JSON.parse(M.students[0].PrivateInsurance).has, 'NO');
  eq('🔴 the admin\'s entry is checked too', code_(() => H.saveStudent({ studentId: 'STD-001', data: { PrivateInsurance: { has: 'YES' } } })), 'BAD_INPUT');
  const sg = R('src/Staff.gs');
  ok_('🔴 Apps Script drops it from a staff session on the self-edit route', /d\.PrivateInsurance !== undefined && !p\.staffId/.test(sg));
  ok_('...and makes the column before writing it (no column = silently dropped)', /ensureColumns_\(sh, \[[\s\S]*?'PrivateInsurance'\]\)/.test(sg));
  ok_('the column is declared on STUDENTS', /'PauseReason',[\s\S]{0,400}'PrivateInsurance'\]/.test(R('src/Config.gs')));
  ok_('...and in the Postgres map', /\["PrivateInsurance","private_insurance","text"\]/.test(R('src/PgSchema.gs')));
  ok_('...and in the schema the database is built from', /"private_insurance"\s+text/.test(R('docs/schema/001_init.sql')));
}

console.log('\n3) 🛡️ who reads what');
{
  const { H, M } = boot({ students: [kid({ PrivateInsurance: JSON.stringify(INS) })] });
  const t = H.studentProfile({ studentId: 'STD-001', staffId: 'T1', role: 'Teacher' });
  eq('a teacher sees the company, the cover and the claims phone', [t.scope, t.privateIns.list[0].company, t.privateIns.list[0].hotline], ['care', 'เมืองไทยประกันชีวิต', '1766']);
  ok_('🔴 ...but never the policy number', !('policyNo' in t.privateIns.list[0]) && !/MT-123456/.test(JSON.stringify(t)));
  const a = H.studentProfile({ studentId: 'STD-001', staffId: 'ADM', role: 'Admin' });
  eq('the admin sees the policy number', a.privateIns.list[0].policyNo, 'MT-123456');
  const f = H.familyProfile({ parentId: 'PAR-001', studentId: 'STD-001', role: 'Parent' });
  eq('the family reads their own entry back, parsed', (f.students[0] || {}).PrivateInsurance && f.students[0].PrivateInsurance.list[0].policyNo, 'MT-123456');
  M.students[0].PrivateInsurance = JSON.stringify({ has: 'YES', list: [Object.assign({}, INS.list[0], { expiry: '2020-01-01' })] });
  eq('an expired policy says so', H.studentProfile({ studentId: 'STD-001', staffId: 'ADM', role: 'Admin' }).privateIns.list[0].expired, true);
  ok_('the injury form shows it while the teacher writes', /window\.INJ_ins=async/.test(app) && /INJ_ins\(pfx, sel\.value\)/.test(app));
  ok_('🔴 a teacher\'s roster does not carry it', !/privateinsurance/i.test(String((eng.match(/const STUDENT_ROSTER_ = \[[^\]]*\]/) || [''])[0])));
}

console.log('\n4) 🛡️ from the application onto the student');
{
  const thaiId = f => { let s = 0; for (let i = 0; i < 12; i++) s += (+f[i]) * (13 - i); return f + ((11 - (s % 11)) % 10); };
  const form = (H, ins) => ({ parentId: 'PAR-001', uid: 'Uaaa', lang: 'th', clientRef: 'r-' + Math.random(),
    child: { NameTH: 'ด.ช. ใหม่ ใจดี', NameEN: 'Mai Jaidee', Nickname: 'ใหม่', NicknameEN: 'Mai', Gender: 'M', DOB: '2024-03-01', IdType: 'TH', NationalID: thaiId('110170099999'), Photo: '' },
    data: { child: { address: { no: '1' } }, father: {}, mother: {}, pickups: [], health: {}, wish: {}, insurance: ins },
    consents: { pdpa: true, health: true, daily: true, photoJournal: true, photoPublic: true }, truth: true, signName: 'แม่ ทดสอบ', consentVersion: H.applyInfo().version });
  const { H, M } = boot();
  const r = H.submitApplication(form(H, INS));
  eq('the family\'s answer is kept on the application', JSON.parse(M.applications[0].Data).insurance.list[0].company, 'เมืองไทยประกันชีวิต');
  { const g = form(H, { has: 'YES', list: [{ company: 'x' }] }); g.child = Object.assign({}, g.child, { NationalID: thaiId('110170077777'), NameTH: 'ด.ช. อื่น' });
    eq('🔴 a bad answer is refused at submit, not at approval', code_(() => H.submitApplication(g)), 'BAD_INPUT'); }
  const ap = H.approveApplication({ appId: r.appId, startDate: NEXT_1, className: 'Nursery 1', adminId: 'ADM' });
  const s = M.students.find(x => x.StudentID === ap.studentId);
  eq('accepting carries it onto the student', JSON.parse(s.PrivateInsurance).list[0].policyNo, 'MT-123456');
  eq('...marked as coming from the application', JSON.parse(s.PrivateInsurance).by, 'application');
  // the attach path (office typed the child in first): filled only when empty
  // the application arrives first; the office then types the same child in by hand (the กอบบุญ case)
  const b = boot();
  const f2 = form(b.H, INS); f2.child = Object.assign({}, f2.child, { NationalID: thaiId('110170088888'), NameTH: 'ด.ช. ก่อน', DOB: '2024-01-01' });
  const r2 = b.H.submitApplication(f2);
  b.M.students.push(kid({ StudentID: 'STD-070', NationalID: thaiId('110170088888'), NameTH: 'ด.ช. ก่อน', DOB: '2024-01-01', ParentID: '' }));
  const at = b.H.approveApplication({ appId: r2.appId, attachTo: 'STD-070', adminId: 'ADM' });
  ok_('tying to an existing student fills it when it was empty', at.filled.indexOf('PrivateInsurance') >= 0 && !!b.M.students[0].PrivateInsurance);
  ok_('the form asks it on the health page, kept whatever item 1 says', /data\.insurance\.has/.test(app) && /'insurance'\]\.forEach/.test(eng));
  ok_('the admin sees the answer on the application', /d\.insurance\?sec\('🛡️ '/.test(app));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) 🧾 billQuote IS issueBill\'s figure');
{
  // a child starting mid-month next month: the quote and the bill must be the same number
  const { H, M } = boot({ students: [kid({ EnrollDate: NEXT_15 })] });
  const q = H.billQuote({ studentId: 'STD-001', month: NEXT_MONTH });
  ok_('a tuition line is offered for the start month', !!q.tuition && q.tuition.amount > 0);
  const b = H.issueBill({ studentId: 'STD-001', month: NEXT_MONTH });
  eq('🔴 the bill carries exactly the quoted figure and label', [b.Amount, b.Items[0][0]], [q.tuition.amount, q.tuition.label]);
  eq('the quote now reports that bill, so the screen will not overwrite it', H.billQuote({ studentId: 'STD-001', month: NEXT_MONTH }).existing.amount, b.Amount);
  eq('a month before the start is refused, with the reason', H.billQuote({ studentId: 'STD-001', month: monthOff(0) }).refuse.code, 'NOT_ENROLLED_YET');
  // standing discount applies to the quote as it does to the bill
  const d = boot({ students: [kid({ DiscountAmount: 900, DiscountUnit: 'บาท' })] });
  eq('the standing discount is in the quote', [d.H.billQuote({ studentId: 'STD-001', month: monthOff(0) }).tuition.amount, d.H.billQuote({ studentId: 'STD-001', month: monthOff(0) }).tuition.discount], [6000, 900]);
  eq('...and on the bill', d.H.issueBill({ studentId: 'STD-001', month: monthOff(0) }).Amount, 6000);
  // refusals are unchanged
  const np = boot({ students: [kid({ Plan: '' })] });
  eq('no package → refused (quote)', np.H.billQuote({ studentId: 'STD-001', month: monthOff(0) }).refuse.code, 'NO_PLAN_PRICE');
  eq('no package → refused (bill)', code_(() => np.H.issueBill({ studentId: 'STD-001', month: monthOff(0) })), 'NO_PLAN_PRICE');
  eq('...unless the admin typed the amount', np.H.issueBill({ studentId: 'STD-001', month: monthOff(0), amount: 3000, label: 'ค่าเทอม' }).Amount, 3000);
  const pa = boot({ students: [kid({ Status: 'PAUSED', PauseFrom: monthOff(0, 1), PauseTo: monthOff(1, 1) })] });
  eq('paused all month → refused', code_(() => pa.H.issueBill({ studentId: 'STD-001', month: monthOff(0) })), 'STUDENT_PAUSED');
  eq('every extra item already on the month is listed', (() => { const x = boot({ students: [kid()], studentCharges: [{ ChargeID: 'CH1', StudentID: 'STD-001', Month: monthOff(0), Label: 'ค่าแรกเข้า', Amount: 5000, Status: 'UNPAID' }] });
    return x.H.billQuote({ studentId: 'STD-001', month: monthOff(0) }).charges.map(c => c.label + ':' + c.amount); })(), ['ค่าแรกเข้า:5000']);
  ok_('billQuote and chargePresets are admin-only', /billQuote: 1, chargePresets: 1/.test(R('src/Code.gs')));
}

console.log('\n6) 🧾 the extra lines, and the month\'s total');
{
  const { H, M } = boot({ students: [kid()] });
  const mm = monthOff(0);
  H.issueBill({ studentId: 'STD-001', month: mm });
  H.addStudentCharge({ studentId: 'STD-001', month: mm, label: 'ค่าแรกเข้า', amount: 5000 });
  H.addStudentCharge({ studentId: 'STD-001', month: mm, label: 'ส่วนลดแรกเข้า', amount: -1000 });
  const pay = H.payments({ studentId: 'STD-001' }).find(b => b.Month === mm || String(b.Month).slice(0, 7) === mm) || {};
  const ch = H.studentCharges({ studentId: 'STD-001', month: mm });
  eq('a discount line is a negative charge on the same month', ch.map(c => c.Amount), [5000, -1000]);
  ok_('...and comes off the month: tuition first', Number(pay.TotalDue != null ? pay.TotalDue : pay.Amount) === 6900 - 1000);
  ok_('the screen sends the tuition WITHOUT an amount unless it was changed', /if\(Math\.abs\(T\.amount-T\.quoted\)>=0\.005\)\{ pl\.amount=T\.amount; pl\.label=T\.label; \}/.test(app));
  ok_('the extra lines go through addStudentCharge on the same month', /api\('addStudentCharge',\{studentId:F\.sid, month:F\.month, label:x\.label, amount:x\.amount\}\)/.test(app));
  ok_('🔴 a month that already has a bill is shown, never re-issued', /const tu=q\.tuition, ex=q\.existing, can=!!tu && !ex;/.test(app));
  ok_('🔴 a partial failure says which lines went through', /ออกบิลได้ไม่ครบ/.test(app));
  ok_('accepting an application leads to this screen', /window\.A_appBill=async\(sid\)=>\{[^\n]*A_firstBill\(sid\)/.test(app));
}

console.log('\n7) 🧾 the school\'s usual items');
{
  const { H } = boot({ config: { ChargePresets: JSON.stringify([{ label: 'ค่าแรกเข้า', amount: 5000 }, { label: 'ส่วนลดพี่น้อง', amount: 500, discount: true },
    { label: '', amount: 100 }, { label: 'ศูนย์บาท', amount: 0 }]) } });
  eq('read leniently: nameless and ฿0 items are dropped', H.chargePresets().map(x => x.label + (x.discount ? '−' : '+') + x.amount), ['ค่าแรกเข้า+5000', 'ส่วนลดพี่น้อง−500']);
  eq('nothing set → an empty list, not an error', boot().H.chargePresets(), []);
  eq('broken JSON → an empty list', boot({ config: { ChargePresets: '[{' } }).H.chargePresets(), []);
  ok_('saveable on Apps Script', /ChargePresets: 1,/.test(R('src/Staff.gs')));
  ok_('...and in the engine\'s copy of the list', /ChargePresets:1,/.test(eng));
  ok_('edited from the packages screen', /onclick="A_chargePresets\(\)"/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
