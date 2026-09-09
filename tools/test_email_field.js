/**
 * tools/test_email_field.js — the second way in starts with an address.
 *   node tools/test_email_field.js
 *
 * Asked 2026-09-09, after the director approved a Google sign-in as a fallback for the parents who
 * cannot complete the LINE hand-off on iOS. Nothing signs in with Google yet; this is the column it
 * will match on, and the guard around it.
 *
 * WHY THE GUARD IS THE POINT. Until now an email would have been one more contact detail: get it
 * wrong and somebody is not reached. From the moment it can be signed in with, a wrong email is a
 * DOOR — whoever owns that address is handed that person's account and that family's child. The two
 * ways it goes wrong are ordinary, not exotic:
 *
 *   · a husband and wife on one family Gmail (routine in Thai families), so two parent rows carry
 *     one address and a lookup has to pick one of them;
 *   · an admin typing an address they were told over the phone, one character off, which lands on
 *     a stranger who happens to exist.
 *
 * So a duplicate is refused at the moment of saving — while the person typing it is still there to
 * correct it — rather than becoming a silent misrouting discovered months later. Everything is
 * stored lower-case and trimmed, because Google treats case as noise and a lookup would not.
 *
 * Uniqueness is per sheet, NOT across both: a teacher whose own child attends resolves to their
 * STAFF row exactly as they already do with LineUID (handleAuth reads STAFF before PARENTS).
 *
 * And the field is OPTIONAL everywhere. A family that never gives an email must keep working
 * precisely as it did — LINE is unchanged and remains the way in.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), cfg = R('src/Config.gs'),
      staffGs = R('src/Staff.gs'), perf = R('src/Perf.gs'), i18n = R('webapp/i18n.js');

/* The code with comments removed — a prose sentence must never satisfy a test about code.
 *
 * `accept="image/*"` opens a block comment that never closes, so a naive stripper swallows the next
 * sixteen thousand characters of REAL code — which is most of the registration form, including the
 * email field this file is about. Neutralise that attribute before stripping anything. */
const srcCode = s => s.replace(/image\/\*/g, 'image_ANY')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** the refusal a handler threw, or '' if it did not throw */
function refusal(fn) { try { fn(); return ''; } catch (e) { return String((e && (e.apiCode || e.code)) || 'THREW'); } }

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    parents: [
      { ParentID: 'PAR-1', Name: 'กานต์ ดีงาม', NameTH: 'กานต์ ดีงาม', Phone: '0811111111', StudentID: 'S1', LineUID: 'U_mum', Email: 'karn@gmail.com' },
      { ParentID: 'PAR-2', Name: 'วิทย์ เก่งกล้า', NameTH: 'วิทย์ เก่งกล้า', Phone: '0822222222', StudentID: 'S1', LineUID: 'U_dad', Email: '' },
      { ParentID: 'PAR-3', Name: 'คนอื่น', NameTH: 'คนอื่น', Phone: '0833333333', StudentID: 'S2', LineUID: 'U_other', Email: 'someone@gmail.com' }],
    students: [
      { StudentID: 'S1', NameTH: 'ภัธนิน', Nickname: 'นิน', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2025-08-01', ParentID: 'PAR-1' },
      { StudentID: 'S2', NameTH: 'อีกคน', Nickname: 'อี', Class: 'Nursery 2', Status: 'ACTIVE', DOB: '2025-01-01', ParentID: 'PAR-3' }],
    userLinks: [{ UserUID: 'U_mum', StudentID: 'S1' }, { UserUID: 'U_dad', StudentID: 'S1' }],
    staff: [
      { StaffID: 'STF-1', NameTH: 'ครูฟิล์ม', Role: 'Teacher', PositionLevel: 'Officer', Status: 'ACTIVE', Email: 'film@gmail.com' },
      { StaffID: 'STF-2', NameTH: 'ครูหนึ่ง', Role: 'Teacher', PositionLevel: 'Officer', Status: 'ACTIVE', Email: '' }],
    leaves: [], payments: [], otDaily: [], otRecords: [], studentCharges: [], prepayments: [], paymentSlips: [],
    checkinStudent: [], journals: [], comments: [], holidays: [], staffGroups: [], workSchedule: [],
    staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {}, studentLeaves: [],
    absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [],
    growth: [], growthRecords: [], assessments: [], classChanges: [], classChangeReq: [], attendanceReq: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    injuryReports: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [],
    calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: [], classCover: [], pickupPersons: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

console.log('1) an address is stored the way it will be looked up');
{
  const { H, M } = boot();
  H.saveParent({ parentId: 'PAR-2', data: { Email: '  Somchai@GMAIL.com  ' } });
  eq('trimmed and lower-cased on the way in', M.parents[1].Email, 'somchai@gmail.com');
  /* Google hands back "Somchai@gmail.com" or "somchai@gmail.com" depending on how the account was
   * typed years ago; both are the same mailbox. Two casings in the sheet would be two people. */
  eq('...so the same mailbox typed differently is one row, not two',
    refusal(() => H.saveParent({ parentId: 'PAR-3', data: { Email: 'SOMCHAI@gmail.com' } })), 'EMAIL_TAKEN');
}

console.log('\n2) one address, one person');
{
  const { H, M } = boot();
  eq('a second parent cannot take the first one’s address',
    refusal(() => H.saveParent({ parentId: 'PAR-2', data: { Email: 'karn@gmail.com' } })), 'EMAIL_TAKEN');
  eq('...and the refused row is left exactly as it was', M.parents[1].Email, '');
  eq('re-saving your OWN address is not a clash', refusal(() => H.saveParent({ parentId: 'PAR-1', data: { Email: 'karn@gmail.com' } })), '');
  eq('clearing it is always allowed', refusal(() => H.saveParent({ parentId: 'PAR-1', data: { Email: '' } })), '');
  eq('...and it really is cleared', M.parents[0].Email, '');
  eq('a new parent cannot be created onto a taken address',
    refusal(() => H.saveParent({ data: { NameTH: 'ใครไม่รู้', Email: 'someone@gmail.com' } })), 'EMAIL_TAKEN');
}
{
  // THE SELF-SERVICE PATH. A mother editing the father's card on "My info" is editing PAR-2 while she
  // is PAR-1 — guarding against the CALLER's id instead of the row's would have let her write her own
  // address onto his row, and every Google sign-in for that family would then land on him.
  const { H, M } = boot();
  eq('a co-parent edit is checked against the row being written',
    refusal(() => H.saveFamilyParent({ uid: 'U_mum', parentId: 'PAR-1', targetParentId: 'PAR-2', data: { Email: 'karn@gmail.com' } })), 'EMAIL_TAKEN');
  eq('...and his row is untouched', M.parents[1].Email, '');
  eq('a genuinely new address on his row is fine',
    refusal(() => H.saveFamilyParent({ uid: 'U_mum', parentId: 'PAR-1', targetParentId: 'PAR-2', data: { Email: 'wit@gmail.com' } })), '');
  eq('...and saved normalised', M.parents[1].Email, 'wit@gmail.com');
  eq('editing her own row still works', refusal(() => H.saveFamilyParent({ uid: 'U_mum', parentId: 'PAR-1', targetParentId: 'PAR-1', data: { Email: 'karn@gmail.com', NameTH: 'กานต์ ดีงาม' } })), '');
}
{
  // registration — where most addresses will actually arrive
  const { H, M } = boot();
  eq('a new family cannot register onto an address already in use',
    refusal(() => H.registerParent({ uid: 'U_new', parent: { NameTH: 'พ่อใหม่', Phone: '0899999999', Email: 'KARN@gmail.com' } })), 'EMAIL_TAKEN');
  eq('...and nothing was created', M.parents.length, 3);
  eq('registering with a fresh address works', refusal(() => H.registerParent({ uid: 'U_new', parent: { NameTH: 'พ่อใหม่', Phone: '0899999999', Email: ' New@Gmail.com ' } })), '');
  eq('...normalised', M.parents[3].Email, 'new@gmail.com');
  eq('registering with NO address still works — the field is optional',
    refusal(() => H.registerParent({ uid: 'U_n2', parent: { NameTH: 'แม่ใหม่', Phone: '0898888888' } })), '');
}

console.log('\n3) staff are guarded the same way, on their own sheet');
{
  const { H, M } = boot();
  eq('one teacher cannot take another’s address', refusal(() => H.saveStaff({ staffId: 'STF-2', data: { Email: 'film@gmail.com' } })), 'EMAIL_TAKEN');
  eq('a teacher editing their own record is guarded too', refusal(() => H.saveStaffSelf({ staffId: 'STF-2', data: { Email: 'FILM@gmail.com' } })), 'EMAIL_TAKEN');
  eq('...and the refused row is untouched', M.staff[1].Email, '');
  eq('their own new address saves', refusal(() => H.saveStaffSelf({ staffId: 'STF-2', data: { Email: 'One@Gmail.com', Nickname: 'หนึ่ง' } })), '');
  eq('...normalised', M.staff[1].Email, 'one@gmail.com');
  eq('...and the rest of that save went through', M.staff[1].Nickname, 'หนึ่ง');
  /* PER SHEET, deliberately. A teacher whose own child attends is one person with two records; her
   * one Gmail on both is not a mistake, and handleAuth reads STAFF first so she lands on the staff
   * record either way — the same thing LineUID already does. */
  eq('a teacher may carry the same address as a parent row', refusal(() => H.saveStaff({ staffId: 'STF-2', data: { Email: 'karn@gmail.com' } })), '');
}

console.log('\n4) what is not an email is refused before it is stored');
{
  const { H, M } = boot();
  ['somchai', 'somchai@', '@gmail.com', 'a b@gmail.com', 'somchai@gmail'].forEach(bad => {
    eq('refused: ' + JSON.stringify(bad), refusal(() => H.saveParent({ parentId: 'PAR-2', data: { Email: bad } })), 'BAD_INPUT');
  });
  eq('...and none of them reached the row', M.parents[1].Email, '');
  eq('a real one is accepted', refusal(() => H.saveParent({ parentId: 'PAR-2', data: { Email: 'a.b-c_d@sub.domain.co.th' } })), '');
}

console.log('\n5) it comes back on the screens that edit it');
{
  const { H } = boot();
  const fam = H.familyProfile({ uid: 'U_mum', parentId: 'PAR-1' });
  const me = (fam.parents || []).find(x => x.ParentID === 'PAR-1');
  eq('the parent’s own address is on My-info', me && me.Email, 'karn@gmail.com');
  ok_('...and a co-parent card carries the field too', (fam.parents || []).some(x => x.ParentID === 'PAR-2' && 'Email' in x));
  eq('a teacher sees theirs', (H.staffSelf({ staffId: 'STF-1' }) || {}).Email, 'film@gmail.com');
  ok_('the admin roster hands back whole rows, so Email rides along', /listParents: \(\) => M\.parents/.test(eng));
}

console.log('\n6) the sheets have somewhere to put it');
{
  ok_('PARENTS declares Email', /PARENTS:[^\n]*'Email'/.test(cfg));
  ok_('...and GoogleSub, the id a sign-in will actually match on', /PARENTS:[^\n]*'GoogleSub'/.test(cfg));
  const staffDecl = cfg.slice(cfg.indexOf('  STAFF:'), cfg.indexOf('  STAFF:') + 2500);
  ok_('STAFF declares both', /'Email', 'GoogleSub'/.test(staffDecl));
  /* A LIVE sheet was created with the headers of its day. Every handler that writes the column has
   * to name it in ensureColumns_ too, or the value is written under a heading that is not there. */
  const gas = srcCode(staffGs);
  ok_('handleSaveStaff widens the sheet', /ensureColumns_\(sh, \[[^\]]*'Email', 'GoogleSub'\]\)/.test(gas.slice(gas.indexOf('function handleSaveStaff'), gas.indexOf('function handleSetStaffEnd'))));
  ['handleSaveParent', 'handleSaveParentSelf', 'handleSaveFamilyParent'].forEach(fn => {
    const seg = gas.slice(gas.indexOf('function ' + fn), gas.indexOf('function ' + fn) + 1400);
    ok_(fn + ' widens the sheet', /ensureColumns_\([^)]*'Email', 'GoogleSub'/.test(seg));
    ok_(fn + ' runs the guard', /emailGuard_\(/.test(seg));
  });
  const self = gas.slice(gas.indexOf('function handleSaveStaffSelf'), gas.indexOf('function handleSetRequireCheckin'));
  ok_('handleSaveStaffSelf lets a teacher set their own, and guards it', /'Email'\]/.test(self) && /emailGuard_\(/.test(self));
  ok_('the guard normalises', /trim\(\)\.toLowerCase\(\)/.test(gas));
  ok_('...and excludes the row being written, so re-saving is not a clash', /String\(r\[idField\] \|\| ''\) !== String\(ownId \|\| ''\)/.test(gas));
  ok_('nothing widened is ever narrowed', !/deleteColumn/.test(gas));
}

console.log('\n7) the refusal reads as a rule, not as a broken app');
{
  ok_('EMAIL_TAKEN is a refusal, not an outage', /EMAIL_TAKEN: 1/.test(perf));
  ok_('...and the parent is told what to do about it', /EMAIL_TAKEN:\s*\[/.test(app));
  ok_('a malformed address is explained too', /BAD_INPUT:\s*\[/.test(app));
}

console.log('\n8) every form that holds a person now has the field');
{
  const c = srcCode(app);
  ok_('registration asks for it', /fld_\('rPEmail',t\('reg\.email'\)/.test(c));
  ok_('...and sends it', /Email:rEmail/.test(c));
  ok_('...after checking the shape, so a typo does not cost a round trip', /if\(!emailOk\(rEmail\)\)/.test(c));
  ok_('a parent can set their own on My-info', /ppFld\(pre,'Email',t\('reg\.email'\)/.test(c));
  ok_('...and it is sent', /Email:emailFmt\(g\('Email'\)\)/.test(c));
  ok_('the admin parent form has it', /f\('Email',t\('reg\.email'\),p\.Email\)/.test(c));
  ok_('the admin staff form has it', /f\('Email',t\('reg\.email'\),s\.Email\)/.test(c));
  ok_('a teacher can set their own', /f\('Email',t\('reg\.email'\),s\.Email,'email'\)/.test(c));
  // registration · parent My-info · teacher My-info · admin parent form · admin staff form
  eq('every one of the five save paths checks the shape first', (c.match(/emailOk\(/g) || []).length, 5);
  ok_('one normaliser, matching the server', /const emailFmt = v => String\(v==null\?'':v\)\.trim\(\)\.toLowerCase\(\)/.test(c));
  /* THE ADMIN IS THE RISKY PATH: they are typing an address for somebody who is not in the room.
   * The warning has to be on that form, not only in a policy document. */
  ok_('the admin forms say to confirm the address with the person first', /ยืนยันอีเมลกับผู้ปกครองโดยตรงก่อนกรอก/.test(app) && /ยืนยันอีเมลกับเจ้าตัวโดยตรงก่อนกรอก/.test(app));
  ok_('the field is labelled in both languages', /'reg\.email':\['อีเมล \(Gmail\)','Email \(Gmail\)'\]/.test(i18n));
  ok_('...and says it is optional, so nobody thinks LINE has been taken away', /ไม่กรอกก็ได้/.test(i18n));
}

console.log('\n9) LINE is untouched — it is still the way in');
{
  const c = srcCode(app);
  ok_('LineUID is still on the parent record', /PARENTS:[^\n]*'LineUID'/.test(cfg));
  ok_('...and still what the admin form ties an account with', /pf_LineUID/.test(c));
  ok_('...and the staff form', /sf_LineUID/.test(c));
  ok_('registration still stamps the LINE uid on the new row', /LineUID:p\.uid\|\|''/.test(srcCode(eng)));
  // no route was added, renamed or gated in this change — the sign-in path is exactly as it shipped
  ok_('no Google route exists yet — this change only collects the address', !/googleExchange|googleLogin/.test(srcCode(R('src/Code.gs'))));
}

console.log(fail ? `\nFAILED ${pass} passed, ${fail} failed` : `\nPASSED ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
