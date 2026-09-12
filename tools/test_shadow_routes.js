/**
 * tools/test_shadow_routes.js — the 115 handlers that exist TWICE, and the class of bug that makes.
 *   node tools/test_shadow_routes.js
 *
 * WHY THIS FILE EXISTS. Twice in two days a change was made to webapp/engine.js, the suite went
 * green, and nothing happened on the live school:
 *
 *   v378  saveStaffSelf gained NameTH so a teacher could spell their own name.
 *   v379  insuranceStatus gained `policy` so a parent could read the cover the school bought.
 *
 * Both handlers have an EXPLICIT ROUTE in src/Code.gs, and an explicit route SHADOWS the engine —
 * dispatch_ looks in ROUTES first and only falls through to the engine when it finds nothing. So the
 * code the tests exercised was the copy that never runs. A green suite over a dead change is worse
 * than a red one: it is a change everybody believes shipped.
 *
 * There are 115 of these pairs. Most are deliberate and documented — the engine persists WHOLE
 * collections, which is how the 2026-07-09 wipe happened, so every CRUD write was moved to an
 * in-place route. The pairing is not the bug. The bug is editing one half.
 *
 * So this file does two things a per-feature test cannot:
 *
 *   1. NAMES THE 115. A route that becomes newly shadowed is a behaviour silently replaced — the
 *      dangerous direction — and the diff is printed so accepting it is a deliberate edit here.
 *   2. CHECKS THE CONTRACTS that have already been broken once, field by field. Where the two halves
 *      have to agree on a whitelist or a returned key, both are read out of the source and compared.
 *
 * It cannot prove 115 pairs agree about everything; nothing static can. It can make sure the next
 * person who edits one half is told about the other.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got=' + JSON.stringify(got) + '\n        want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const codeGs = R('src/Code.gs'), eng = R('webapp/engine.js'),
      staffGs = R('src/Staff.gs'), day6 = R('src/Day6.gs');

/** every name in the ROUTES object of src/Code.gs (comments stripped, so a commented-out route is not one) */
function routeNames(src) {
  const block = /var ROUTES = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) return [];
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...new Set((body.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || []).map(s => s.trim().replace(':', '')))];
}
/** every handler on the engine's H object (top-level keys only — four-space indent) */
function engineHandlers(src) {
  const body = src.slice(src.indexOf('const H = {'));
  return [...new Set((body.match(/^    ([A-Za-z_][A-Za-z0-9_]*)\s*:/gm) || []).map(s => s.trim().replace(':', '')))];
}

console.log('\n1) the parser found both sides');
const ROUTES = routeNames(codeGs), HANDLERS = engineHandlers(eng);
{
  ok_('the ROUTES table was found and is a real table', ROUTES.length > 100);
  ok_('...and the engine handlers too', HANDLERS.length > 200);
  // spot-check one of each kind, so a parser that silently matched nothing cannot pass
  ok_('a known route is in the route list', ROUTES.indexOf('submitJournal') >= 0);
  ok_('a known engine-only handler is NOT in it', ROUTES.indexOf('classList') < 0 && HANDLERS.indexOf('classList') >= 0);
}

console.log('\n2) THE 115 — a new one is a behaviour silently replaced');
{
  /* Sorted. Add a name here only when you have ALSO checked that the new route reproduces whatever
   * the engine handler did — that check is the entire point of adding it. Removing a name means the
   * engine took the job back, which is fine and also worth noticing. */
  const KNOWN = [
    'addAnnouncement', 'addBigCleaning', 'addChildNew', 'addDepartment', 'addHoliday',
    'adminAddHolidayOT', 'adminAddOT', 'adminCancelOT', 'adminDeleteOT', 'adminEditOT',
    'adminResetPassword', 'adminRestoreOT', 'adminUpdateOT', 'allLeaves', 'approveInjury',
    'approveLeave', 'approveOT', 'approveTimeRequest', 'bigCleaningDays', 'cancelLeave',
    'cancelPrepay', 'changeStaffPassword', 'checkStaffPassword', 'claimParent', 'computePayroll',
    'confirmOT', 'confirmSlip', 'confirmTimeRequest', 'decideClassChange', 'deleteAnnouncement',
    'deleteBill', 'deleteDspmCriteria', 'deleteParent', 'deleteSlip', 'deleteStaff',
    'deleteStudentLeave', 'deleteStudentLeaves', 'dspmCriteria', 'editAnnouncement', 'editHoliday',
    'editLeave', 'editPrepay', 'editStudentAttendance', 'editStudentLeave', 'getPayslip',
    'getStaffPassword', 'googleExchange', 'googleLink', 'googleLoginReady', 'insuranceList',
    'insuranceStatus', 'linkParentAdmin', 'markNotifsRead', 'markSalaryPaid', 'myPayslipMonths',
    'notifications', 'otCarryOver', 'parentCancelLeave', 'parentCheckin', 'parentEditLeave',
    'payCharge', 'payCombined', 'payCombinedCash', 'payOT', 'payPrepay', 'pendingLeaves',
    'recomputeContributions', 'recordCashPayment', 'registerNew', 'rejectSlip', 'removeBigCleaning',
    'removeDepartment', 'removeHoliday', 'removeStudent', 'renameDepartment', 'requestPasswordReset',
    'saveDspmCriteria', 'saveFamilyParent', 'saveInsuranceAdmin', 'saveParent', 'saveParentComment',
    'savePlans', 'savePrepayTiers', 'saveQRCodes', 'saveSlipOk', 'saveStaff', 'saveStaffSelf',
    'saveStudent', 'saveStudentSelf', 'saveTeacherReply', 'setConfigVal', 'setLeaveQuota',
    'setRequireCheckin', 'setSchoolConfig', 'setStaffPause', 'setStudentPause', 'slipDiag',
    'staffCheckin', 'staffCheckout', 'staffStudentCheckin', 'studentAbsence', 'studentAssessment',
    'submitAssessment', 'submitClassChange', 'submitInjury', 'submitInsurance', 'submitJournal',
    'submitLeave', 'submitTimeRequest', 'teacherPayOT', 'teacherStudentLeave', 'unlinkStudent',
    'unlockJournal', 'uploadSlip', 'verifySlip'
  ];
  const actual = ROUTES.filter(r => HANDLERS.indexOf(r) >= 0).sort();
  eq('NEWLY shadowed (a route now replaces an engine handler — check it reproduces the engine)',
    actual.filter(x => KNOWN.indexOf(x) < 0), []);
  eq('no longer shadowed (the engine took the job back)',
    KNOWN.filter(x => actual.indexOf(x) < 0), []);
  ok_('...and there really are that many, so nobody reads this as a short list', actual.length > 100);
}

console.log('\n3) saveStaffSelf — the v378 break, now checked field by field');
{
  const engList = (/\['NameTH','NameEN','Nickname','NicknameEN','Phone','DOB','Photo','Education','EduMajor','EduGradDate'\]/.exec(eng) || [])[0] || '';
  const gasSeg = staffGs.slice(staffGs.indexOf('function handleSaveStaffSelf'), staffGs.indexOf('function handleSetRequireCheckin'));
  const gasFields = ((/WHITE = \[([\s\S]*?)\];/.exec(gasSeg) || [])[1] || '').match(/'([A-Za-z]+)'/g) || [];
  const gas = gasFields.map(s => s.replace(/'/g, ''));
  ok_('the engine whitelist is where it is expected', !!engList);
  // Email is guarded separately in the engine (engEmail_) and is in the GAS list — compare the rest
  eq('every field the ENGINE allows, the LIVE route allows too',
    ['NameTH', 'NameEN', 'Nickname', 'NicknameEN', 'Phone', 'DOB', 'Photo', 'Education', 'EduMajor', 'EduGradDate']
      .filter(f => gas.indexOf(f) < 0), []);
  eq('...and nothing extra crept into the live one',
    gas.filter(f => ['NameTH', 'NameEN', 'Nickname', 'NicknameEN', 'Phone', 'DOB', 'Photo', 'Email', 'Education', 'EduMajor', 'EduGradDate'].indexOf(f) < 0), []);
  /* The twelve that must be in NEITHER. Money, hours, permissions and the username — a field added
   * to one of these lists without a reason is a field somebody can give themselves, and
   * Department='*' or Role would be a promotion to Admin from your own profile page. */
  ['BaseSalary', 'BankName', 'BankAccount', 'Role', 'PositionLevel', 'Department', 'Classes',
   'StaffGroup', 'RequireCheckin', 'StartDate', 'NationalID', 'CanClassOrg']
    .forEach(k => ok_(k + ' is in NEITHER whitelist', gas.indexOf(k) < 0 && engList.indexOf("'" + k + "'") < 0));
  ok_('the live route maps NameTH onto the sheet column Name', /row\.Name = row\.NameTH/.test(gasSeg));
  ok_('...refuses a blank one, as the engine does', /กรุณากรอกชื่อ-นามสกุล/.test(gasSeg));
  ok_('...and writes an audit line, as the engine does', /SAVE_STAFF_SELF/.test(gasSeg));
}

console.log('\n4) insuranceStatus — the v379 break, found by this audit and not by a user');
{
  const gasSeg = day6.slice(day6.indexOf('function handleInsuranceStatus'), day6.indexOf('function handleInsuranceStatus') + 900);
  ok_('the LIVE route returns the school-bought policy at all', /policy: insPolicy_\(stu\)/.test(gasSeg));
  /* THE SAME SHAPE, key for key. The parent's card reads one object; two halves that return
   * different field names would draw an empty card on live and a full one in every test. */
  const keys = ['plan', 'type', 'policyNo', 'company', 'insured', 'owner', 'status', 'start', 'expiry', 'sum', 'benefits', 'hotline', 'card', 'has'];
  const gasPol = day6.slice(day6.indexOf('function insPolicy_'), day6.indexOf('function handleInsuranceStatus'));
  const engPol = eng.slice(eng.indexOf('function studentPolicy_'), eng.indexOf('function studentPolicy_') + 1200);
  // `has` is derived last on both sides, so it is an assignment rather than a literal key — accept either
  const carries = (src, k) => new RegExp('\\b' + k + ':').test(src) || new RegExp('\\.' + k + '\\s*=').test(src);
  eq('every key the engine returns, the live route returns', keys.filter(k => !carries(gasPol, k)), []);
  eq('...and the engine returns every one of them too', keys.filter(k => !carries(engPol, k)), []);
  /* `has` IS NOT THE CHECKBOX ALONE, on both sides. A card that hid a real policy number because
   * nobody ticked a box is the exact failure the feature exists to prevent. */
  ok_('the live route treats a filled-in policy as cover even without the tick',
    /pol\.policyNo \|\| pol\.plan \|\| pol\.company \|\| pol\.sum \|\| pol\.benefits/.test(gasPol));
  ok_('...and so does the engine',
    /p\.policyNo\|\|p\.plan\|\|p\.company\|\|p\.sum\|\|p\.benefits/.test(engPol));
  /* A sheet cell holds text, not a boolean: 'TRUE' / 'YES' from a hand-edited sheet must read as
   * ticked. The engine runs on mock objects where it really is a boolean, so only the GAS side needs
   * this — and getting it wrong would hide a policy from the families who have one. */
  ok_('the live route reads a sheet cell, not a JavaScript boolean',
    /tick === 'TRUE' \|\| tick === 'YES'/.test(gasPol));
  ok_('the shadowing is written down where the next person will edit it', /SHADOWS the engine/.test(day6));
}

console.log('\n5) the columns exist, or a shadowed write saves nothing at all');
{
  /* updateRow_ and writeRows_ both DROP a field with no column, in silence. Every field added to a
   * route above has to be named in that route's ensureColumns_ call, or the save reports success
   * and changes nothing — which on a policy number or a qualification is indistinguishable from
   * the admin not having typed it. */
  ok_('education, on the staff routes', /ensureColumns_\(sh, \[[\s\S]*?'Education', 'EduMajor', 'EduGradDate'\]\)/.test(staffGs));
  ok_('the school policy, on the student route', /ensureColumns_\(sh, \[[\s\S]*?'InsuranceBenefits', 'InsuranceHotline'\]\)/.test(staffGs));
  ok_('the follow-up trail sheet is declared so it can be created', /ABSENCE_FOLLOWUP_LOG/.test(R('src/GasEngine.gs')));
  // handleSaveStudent copies every field it is given — no whitelist to also update
  {
    // bounded by the NEXT function declaration, not by a named one far below: handleSaveStudentSelf
    // has a whitelist of its own, and a loose slice picked it up and reported it against this one
    const a = staffGs.indexOf('function handleSaveStudent(');
    const b = staffGs.indexOf('\nfunction ', a + 10);
    const seg = staffGs.slice(a, b > a ? b : a + 2000);
    ok_('the student route copies every field it is given — no second whitelist to forget',
      seg.length > 200 && /mapName_\(p\.data \|\| \{\}\)/.test(seg) && !/WHITE/.test(seg));
  }
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
