/**
 * tools/test_edu_policy_tz.js — four clocks, a qualification, a policy a family can claim on, and
 * the route that shadowed the change that was supposed to fix all of it.
 *   node tools/test_edu_policy_tz.js
 *
 * ASKED 2026-09-12, four things at once. The one that matters most is not on the list:
 *
 * ── THE SHADOW ────────────────────────────────────────────────────────────────────────────────
 * v378 added NameTH to saveStaffSelf's whitelist so a teacher could spell their own name, and the
 * suite went green. It did nothing on live. `saveStaffSelf` has an EXPLICIT ROUTE in src/Code.gs
 * (handleSaveStaffSelf in Staff.gs), and an explicit route SHADOWS the engine — so the whitelist the
 * test exercised was the one that never runs. A green suite over a dead change is worse than a red
 * one, so the two whitelists are now compared to each other here, and this file fails if they drift.
 *
 * ── THE CLOCK ─────────────────────────────────────────────────────────────────────────────────
 * The time comes from FOUR independent places — the script (triggers), the MAIN workbook (what hour
 * a PERF row is stamped with), the HR workbook (attendance, payroll) and SCHOOL_CONFIG (what DATE a
 * check-in is filed under). Nothing ever compared them. A mismatch throws nothing: it files a
 * check-in under yesterday and shifts every hour in the speed report, both of which read as data
 * problems and neither of which points at a timezone.
 *
 * ── THE POLICY ────────────────────────────────────────────────────────────────────────────────
 * "ผู้ปกครองสามารถดูได้ และนำไปใช้เบิกประกันหรือทำธุรกรรมเองได้". A family at a hospital counter needs
 * the policy number and the sum insured. It is NOT the PCHI record, which is the enrolment form a
 * family fills in FOR an insurer — two different things that both answer to the word ประกัน.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), staffGs = R('src/Staff.gs'),
      cfgGs = R('src/Config.gs'), codeGs = R('src/Code.gs'), repairGs = R('src/Repair.gs');

function boot(over) {
  over = over || {};
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1' },
    students: over.students || [], staff: over.staff || [], insurancePCHI: over.insurancePCHI || [],
    parents: [], userLinks: [], classes: [{ ClassName: 'Nursery 1' }], staffGroups: [],
    payments: [], studentCharges: [], prepayments: [], otDaily: [], paymentSlips: [], otRecords: [],
    payroll: [], payrollConfig: {}, checkinStudent: [], studentCheckins: [], studentAttendanceToday: [],
    studentLeaves: [], journals: [], comments: [], workSchedule: [], staffAttendanceToday: [],
    staffAttendanceHistory: [], leaves: [], absenceLog: [], absenceFollowups: [], absenceFollowupLogs: [],
    dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
    growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
    foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [],
    departments: [], permissions: {}, feed: [], calendar: [], holidays: [], holidayAttend: [],
    pickupPersons: [], vaccineRecords: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

console.log('\n1) THE SHADOW — the two whitelists that must never drift');
{
  /* Pull both lists out of the source and compare them. src/Staff.gs is the one that RUNS on live;
   * webapp/engine.js is the one the rest of this suite exercises. If they disagree, one of them is
   * a lie — and last time the lie was the tested one. */
  const engList = (/\['NameTH','NameEN','Nickname','NicknameEN','Phone','DOB','Photo','Education','EduMajor','EduGradDate'\]/.exec(eng) || [])[0];
  ok_('the engine whitelist is where it is expected', !!engList);
  const gasSeg = staffGs.slice(staffGs.indexOf('function handleSaveStaffSelf'), staffGs.indexOf('function handleSetRequireCheckin'));
  const gasList = (/WHITE = \[([\s\S]*?)\];/.exec(gasSeg) || [])[1] || '';
  const gasFields = (gasList.match(/'([A-Za-z]+)'/g) || []).map(s => s.replace(/'/g, '')).sort();
  eq('the LIVE route allows exactly the same fields as the engine', gasFields,
    ['DOB', 'Education', 'EduGradDate', 'EduMajor', 'Email', 'NameEN', 'NameTH', 'Nickname', 'NicknameEN', 'Phone', 'Photo'].sort());
  // and the fields that must never be in either, listed by name so adding one is a deliberate act
  ['BaseSalary', 'BankAccount', 'Role', 'PositionLevel', 'Department', 'StaffGroup', 'RequireCheckin',
   'NationalID', 'PasswordHash', 'CanClassOrg', 'Classes', 'StartDate']
    .forEach(k => ok_(k + ' is in NEITHER whitelist', gasFields.indexOf(k) < 0 && (engList || '').indexOf("'" + k + "'") < 0));
  ok_('the live route maps NameTH to the sheet column Name', /row\.Name = row\.NameTH; delete row\.NameTH;/.test(gasSeg));
  ok_('...refuses a blank one, like the engine does', /กรุณากรอกชื่อ-นามสกุล/.test(gasSeg));
  ok_('...and writes the audit line the engine writes', /SAVE_STAFF_SELF/.test(gasSeg));
  ok_('the shadowing is written down where somebody would repeat the mistake',
    /this route SHADOWS the engine/.test(staffGs));
}

console.log('\n2) THE CLOCK — four of them, named and compared');
{
  ok_('the diagnostic exists and is routed', /tzDiag:\s+function \(\)\s+\{ return handleTzDiag\(\); \}/.test(codeGs));
  ok_('...and so is the fix', /setTimezone:\s+function \(p\) \{ return handleSetTimezone\(p\); \}/.test(codeGs));
  ok_('both are admin-only', /tzDiag: 1, setTimezone: 1,/.test(codeGs));
  // all four sources, or the answer is worse than no answer
  ['Session.getScriptTimeZone', 'getMainSpreadsheet_\\(\\)\\.getSpreadsheetTimeZone',
   'getHrSpreadsheet_\\(\\)\\.getSpreadsheetTimeZone', "getConfig_\\('Timezone'"]
    .forEach(src => ok_('it reads ' + src.replace(/\\/g, ''), new RegExp(src).test(repairGs)));
  /* A BLANK CONFIG ROW IS NOT A DISAGREEMENT. Every caller reads it as getConfig_('Timezone',
   * 'Asia/Bangkok'), so treating blank as a mismatch would send an admin to fix something already
   * right — and they would then distrust the tool the next time it was correct. */
  ok_('a blank config row counts as the default, not as a mismatch',
    /var effective = list\.map\(function \(x\) \{ return x\.tz \|\| 'Asia\/Bangkok'; \}\);/.test(repairGs));
  /* THE SCRIPT'S ZONE IS THE TARGET, not something the button changes: it lives in appsscript.json,
   * changing it needs a deploy, and a trigger firing at the wrong hour is worse than a sheet
   * stamping at the wrong hour because nobody is watching when it happens. */
  ok_('the script zone is the target and is not written', /scriptFixable: false/.test(repairGs)
    && !/setScriptTimeZone/.test(repairGs));
  ok_('...and the reason is written down', /a trigger that fires at the wrong hour\n \* is worse/.test(repairGs));
  ok_('a bad zone is refused rather than silently formatting as GMT', /if \(!probe\) throw apiError_\('BAD_INPUT'/.test(repairGs));
  ok_('the fix drops the caches that were built under the old zone', /_configCache = null;[\s\S]{0,80}_ssTz = null;/.test(repairGs));
  ok_('...and logs what it changed', /'SET_TIMEZONE'/.test(repairGs));
  ok_('the admin has a button for it', /A_tzDiag\(this\)/.test(app));
  ok_('...which says what a mismatch actually costs, not just that there is one',
    /การเช็คอินอาจถูกบันทึกผิดวัน/.test(app));
  ok_('appsscript.json still says Asia\/Bangkok', /"timeZone": "Asia\/Bangkok"/.test(R('src/appsscript.json')));
}

console.log('\n3) วุฒิการศึกษา — a fixed list, a free-text สาขา, and a date; none of them required');
{
  const { H, M } = boot({ staff: [{ StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', Status: 'ACTIVE',
    Education: 'ปริญญาตรี', EduMajor: 'การศึกษาปฐมวัย', EduGradDate: '2018-03-31' }] });
  const s = H.staffSelf({ staffId: 'T1' });
  eq('the level comes back', s.Education, 'ปริญญาตรี');
  eq('...the field of study', s.EduMajor, 'การศึกษาปฐมวัย');
  eq('...and the graduation date', s.EduGradDate, '2018-03-31');
  const blank = boot({ staff: [{ StaffID: 'T1', NameTH: 'ครูบี', Role: 'Teacher', Status: 'ACTIVE' }] })
    .H.staffSelf({ staffId: 'T1' });
  eq('an empty record returns blanks, not undefined', [blank.Education, blank.EduMajor, blank.EduGradDate], ['', '', '']);
  // a teacher may set their own — a qualification is a personal detail, not pay, hours or permission
  H.saveStaffSelf({ staffId: 'T1', data: { Education: 'ปวส.', EduMajor: 'คอมพิวเตอร์ธุรกิจ', EduGradDate: '2015-03-31' } });
  eq('a teacher can record their own qualification', M.staff[0].Education, 'ปวส.');
  eq('...and it is logged like every other personal change',
    M.activityLog.filter(a => a.Action === 'saveStaffSelf').length, 1);
}
{
  ok_('the list is exactly the one the school gave',
    /const EDU_LEVELS = \['ม\.3','ม\.6','ม\.6 หรือเทียบเท่า','ปวช\.','ปวช\. หรือเทียบเท่า','ปวส\.','ปริญญาตรี'\];/.test(app));
  /* A ROW ALREADY HOLDING SOMETHING ELSE KEEPS IT. The live sheet has "ป.โท", "มัธยมศึกษาตอนปลาย"
   * and "กำลังศึกษา ป.ตรี" on it; a <select> that snapped those to its first option would rewrite a
   * real record the next time anybody saved an unrelated field on that form. */
  ok_('...and a value already on the record is kept, not snapped away',
    /if\(c && list\.indexOf\(c\)<0\) list\.unshift\(c\);/.test(app));
  ok_('the boxes are on the admin form', /\$\{eduFields\('sf',s\)\}/.test(app));
  ok_('...and on the teacher\'s own profile', /\$\{eduFields\('sp',s\)\}/.test(app));
  ok_('both forms send them', /Object\.assign\(data, eduRead\(m,'sf'\)\)/.test(app) && /Object\.assign\(data, eduRead\(document,'sp'\)\)/.test(app));
  ok_('สาขา is free text, not another dropdown', /<textarea id="\$\{pre\}_EduMajor"/.test(app));
  ok_('the form says they are optional', /ไม่บังคับกรอก · ช่องที่ไม่มีข้อมูลจะแสดงเป็น “-”/.test(app));
  ok_('a blank prints a dash', /const eduDash = v => \{ const s=String\(v==null\?'':v\)\.trim\(\); return s\|\|'-'; \};/.test(app));
  ok_('the columns are declared', ['Education', 'EduMajor', 'EduGradDate'].every(c => new RegExp("'" + c + "'").test(cfgGs)));
  ok_('...and topped up on save, or the value is written under a heading that is not there',
    /ensureColumns_\(sh, \[[\s\S]*?'Education', 'EduMajor', 'EduGradDate'\]\)/.test(staffGs));
}

console.log('\n4) 📤 รายชื่อคุณครู — the six columns the school asked for, and no helpful extras');
{
  const seg = app.slice(app.indexOf('window.A_staffExport'), app.indexOf('function phoneDash'));
  ok_('exactly the six headings, in order',
    /const head=\['ลำดับที่','ชื่อจริง','เบอร์โทร','วันเกิด','อายุ','วุฒิการศึกษา'\];/.test(seg));
  ok_('...under the title row the school\'s own sheet has', /\[\['รายชื่อคุณครู'\],\[\]\]/.test(seg));
  /* NO ROUND TRIP. The roster is already on this screen; asking the server again in front of the
   * user would cost ~7 seconds on Apps Script for data the device is holding. */
  ok_('built from what is already on the device', /A_CACHE\.staff\|\|\[\]/.test(seg) && !/await api\(/.test(seg));
  ok_('leavers are left out — it is a list of the CURRENT teaching staff',
    /!s\.ended && String\(s\.Status\|\|'ACTIVE'\)\.toUpperCase\(\)!=='INACTIVE'/.test(seg));
  ok_('a missing date of birth or qualification prints a dash, not a blank or a guess',
    /s\.DOB\?ddmmyyyy\(String\(s\.DOB\)\.slice\(0,10\)\):'-'/.test(seg) && /eduDash\(s\.Education\)/.test(seg));
  ok_('...and the CSV fallback carries a BOM, or Excel mangles every Thai name', /'\\ufeff'\+csv/.test(seg) || /﻿'\+csv/.test(seg));
  // 08-9895-5895 — the shape on the school's sheet. phoneFmt strips to digits for tel: links.
  ok_('the phone is grouped the way the school writes it', /d\.slice\(0,2\)\+'-'\+d\.slice\(2,6\)\+'-'\+d\.slice\(6\)/.test(app));
  ok_('why สาขา and วันจบ are NOT exported is written down', /deliberately NOT exported/.test(app));
}

console.log('\n5) 🛡️ the policy the SCHOOL bought — the parent reads it, nobody else writes it');
{
  const kid = { StudentID: 'S1', NameTH: 'เด็กหญิง ก', Nickname: 'เอ', Class: 'Nursery 1', Status: 'ACTIVE',
    InsuranceHas: true, InsuranceCompany: 'AIA', InsurancePlan: 'AIANPA2500', InsuranceType: 'อุบัติเหตุส่วนบุคคล',
    InsurancePolicyNo: 'P263474486', InsuredName: 'ปรเมศวร์ ไฉไลสถาพร', InsuranceOwner: 'ปานไพลิน คำผา',
    InsuranceStatus: 'มีผลบังคับ', InsuranceStart: '2025-10-25', InsuranceExpiry: '2100-10-25',
    InsuranceSum: '500,000.00', InsuranceBenefits: 'การเสียชีวิต สูญเสียอวัยวะ (อ.บ.1) 500,000.00',
    InsuranceHotline: '1581' };
  const { H } = boot({ students: [kid], staff: [{ StaffID: 'ADM', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE' }] });
  const p = H.insuranceStatus({ studentId: 'S1' }).policy;
  eq('the family gets the number they will be asked for', p.policyNo, 'P263474486');
  eq('...and the sum insured', p.sum, '500,000.00');
  eq('...the company and the plan', [p.company, p.plan, p.type], ['AIA', 'AIANPA2500', 'อุบัติเหตุส่วนบุคคล']);
  eq('...who is insured and who owns it', [p.insured, p.owner], ['ปรเมศวร์ ไฉไลสถาพร', 'ปานไพลิน คำผา']);
  eq('...whether it is in force', p.status, 'มีผลบังคับ');
  eq('...and the dates, normalised', [p.start, p.expiry], ['2025-10-25', '2100-10-25']);
  eq('...and a number to ring', p.hotline, '1581');
  /* IT RIDES ON insuranceStatus, which the parent's screen already calls. A route of its own would
   * be another ~7 seconds on Apps Script for data of the same size. */
  ok_('it travels on the call the parent already makes', /policy: studentPolicy_\(s\),\n\s+student:\{name:s\.NameTH/.test(eng));
  /* `has` IS NOT THE CHECKBOX ALONE. The tick and the details are entered at different times, and a
   * card that hid a real policy number because nobody ticked a box is the exact failure this exists
   * to prevent — a parent at a hospital counter with nothing to show. */
  const noTick = boot({ students: [Object.assign({}, kid, { InsuranceHas: '' })] })
    .H.insuranceStatus({ studentId: 'S1' }).policy;
  eq('an unticked box does not hide a policy that is plainly there', noTick.has, true);
  const none = boot({ students: [{ StudentID: 'S1', NameTH: 'ข', Class: 'Nursery 1', Status: 'ACTIVE' }] })
    .H.insuranceStatus({ studentId: 'S1' }).policy;
  eq('...and a child with no policy at all says so', none.has, false);
  eq('...with blanks, never undefined', [none.policyNo, none.sum, none.benefits], ['', '', '']);
  // the admin sees it on the record; a teacher is still told only THAT there is cover
  const full = H.studentProfile({ studentId: 'S1', staffId: 'ADM', role: 'Admin' });
  eq('the admin record carries the whole policy', full.policy.policyNo, 'P263474486');
}
{
  ok_('the card is on the parent\'s insurance screen', /\$\{policyCard\(st\.policy\)\}/.test(app));
  ok_('it is read-only for the parent — the school buys it, the family does not edit it',
    /function policyCard\(p\)\{[\s\S]*?\n  \}/.test(app) && !/policyCard[\s\S]{0,2000}<input/.test(app));
  /* A ROW IS DRAWN EVEN WHEN EMPTY. Hiding empty rows would look tidier and would leave a parent
   * scanning for จำนวนเงินเอาประกันภัย unable to tell "not entered" from "wrong screen". */
  ok_('...and prints a dash rather than dropping the line', /\|\|'-'\)\}<\/span>/.test(app));
  ok_('the reason that matters is written down', /a parent scanning for "จำนวนเงินเอาประกันภัย"/.test(app));
  ok_('the admin has every box', ['InsurancePlan', 'InsuranceType', 'InsuredName', 'InsuranceOwner',
    'InsuranceStatus', 'InsuranceStart', 'InsuranceSum', 'InsuranceBenefits', 'InsuranceHotline']
    .every(k => new RegExp("stf_" + k + "\\b").test(app) || new RegExp("f\\('" + k + "'").test(app)));
  ok_('...and the save sends them all', ['InsurancePlan', 'InsuranceType', 'InsuredName', 'InsuranceOwner',
    'InsuranceStatus', 'InsuranceStart', 'InsuranceSum', 'InsuranceBenefits', 'InsuranceHotline']
    .every(k => new RegExp(k + ":v\\('" + k + "'\\)").test(app)));
  ok_('the columns are declared', ['InsurancePlan', 'InsuranceSum', 'InsuranceBenefits'].every(c => new RegExp("'" + c + "'").test(cfgGs)));
  ok_('...and topped up on save', /ensureColumns_\(sh, \[[\s\S]*?'InsuranceBenefits', 'InsuranceHotline'\]\)/.test(staffGs));
  // the two things that both answer to the word ประกัน are named apart, so nobody merges them
  ok_('it is distinguished from the PCHI enrolment form in writing', /It is NOT the PCHI record above/.test(eng));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
