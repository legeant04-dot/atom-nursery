/**
 * tools/test_payslip_null.js — "no payslip yet" is a normal answer, not a failure.
 *   node tools/test_payslip_null.js
 *
 * getPayslip was 21% NOT_FOUND (x11) in the 2026-08-11 speed report. It is the same trap as
 * classAssessment: an explicit ROUTE in src/Code.gs shadows the engine and answered a DIFFERENT
 * shape. The engine has always returned null when no slip is saved; the route threw NOT_FOUND.
 * Every caller was written against null, so on live:
 *   · a teacher who unlocked their own payslip screen got nothing — the throw escaped before
 *     the very next line could fall back to a calculated preview;
 *   · printing a month threw once PER staff member;
 *   · and a perfectly normal state was counted as a failure, hiding the real ones.
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
const app = R('webapp/app.js'), pay = R('src/Payroll.gs'), code = R('src/Code.gs');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, ContributionMatchRate: 1 },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paySlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: []
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

console.log('\n1) the engine: no slip saved → null, never a throw');
{
  const { H } = boot({ staff: [{ StaffID: 'S1', NameTH: 'ครูเอ' }], payroll: [] });
  let threw = null, got;
  try { got = H.getPayslip({ staffId: 'S1', month: '2026-08' }); } catch (e) { threw = e.message || String(e); }
  eq('returns null', got, null);
  eq('and did not throw', threw, null);
}

console.log('\n2) ...and a saved month still comes back');
{
  const { H } = boot({
    staff: [{ StaffID: 'S1', NameTH: 'ครูเอ', ContributionOpening: 0 }],
    payroll: [{ StaffID: 'S1', Month: '2026-08', BaseSalary: 15000, Contribution: 200 }]
  });
  const got = H.getPayslip({ staffId: 'S1', month: '2026-08' });
  ok_('the saved row is returned', !!got && got.BaseSalary === 15000);
  eq('...for the right month', got && got.Month, '2026-08');
  eq('a DIFFERENT month is still null', H.getPayslip({ staffId: 'S1', month: '2026-07' }), null);
  eq('a different person is still null', H.getPayslip({ staffId: 'S2', month: '2026-08' }), null);
}

console.log('\n3) the ROUTE now answers the same way as the engine it shadows');
{
  const fn = pay.slice(pay.indexOf('function handleGetPayslip('), pay.indexOf('function handleComputePayroll('));
  ok_('no slip → return null', /if \(!row\) return null;/.test(fn));
  ok_('...and the throw is gone', !/if \(!row\) throw apiError_\('NOT_FOUND'/.test(fn));
  ok_('the reason is written down where the next person will look', /NORMAL state|normal state/.test(fn));
  // the fund total this route derives must survive the change
  ok_('it still derives the contribution total', /row\.ContributionAccum = round2_\(accum\)/.test(fn));
  ok_('and still fills in the employer half', /row\.ContributionEmployer = empOf\(row\)/.test(fn));
}

console.log('\n4) marking a salary PAID still refuses a month with no row');
{
  // that one IS an error: the admin is trying to tick a payment that was never calculated
  const fn = pay.slice(pay.indexOf('function handleMarkSalaryPaid('), pay.indexOf('/** Route: { staffId, month } -> stored payroll'));
  const fn2 = pay.slice(pay.indexOf('function handleMarkSalaryPaid('));
  const body = fn || fn2.slice(0, 1200);
  ok_('markSalaryPaid still throws NOT_FOUND', /throw apiError_\('NOT_FOUND', 'ยังไม่มีรายการจ่ายของเดือนนี้/.test(body));
}

console.log('\n5) the teacher\'s own payslip screen cannot end up blank');
{
  const fn = app.slice(app.indexOf('async function T_slipFor('), app.indexOf('window.T_slipMonth='));
  ok_('T_slipFor exists', !!fn);
  ok_('the saved slip is fetched safely', /try\{ pay=await api\('getPayslip'[\s\S]{0,80}catch\(e\)\{\}/.test(fn));
  ok_('the preview fallback is guarded too', /if\(!pay\)\{ try\{ pay=await api\('computePayroll'[\s\S]{0,90}catch\(e\)\{\}/.test(fn));
  // every entry point to the slip goes through it — an unguarded one is how this broke
  ok_('the screen uses it', /const pay=await T_slipFor\(month\)/.test(app));
  ok_('changing month uses it', /T_slipMonth=async\(m\)=>\{ setHTML\('#slipBox', payslipCard\(await T_slipFor\(m\), m\)\)/.test(app));
  ok_('downloading uses it', /T_slipDownload=async\(m\)=>\{[\s\S]{0,200}const pay=await T_slipFor\(m\)/.test(app));
  ok_('no unguarded getPayslip is left on the teacher path',
    !/let pay=await api\('getPayslip'/.test(app));
}

console.log('\n6) the card says so instead of crashing on a null row');
{
  const card = app.slice(app.indexOf('function payslipCard(r,month){'), app.indexOf('function payslipCard(r,month){') + 700);
  ok_('the null guard is the first thing it does', /function payslipCard\(r,month\)\{\s*\n\s*\/\/[^\n]*\n\s*if\(!r\) return/.test(card));
  // strip comments first — the comment above the guard mentions r.StaffID itself
  const codeOnly = card.replace(/^\s*\/\/.*$/gm, '');
  ok_('...and it returns before touching r', codeOnly.indexOf('if(!r) return') < codeOnly.indexOf('r.StaffID'));
  ok_('it names the state in Thai', /ยังไม่มีสลิปเงินเดือนของเดือนนี้/.test(card));
  ok_('and in English', /No payslip for this month yet/.test(card));
  ok_('it says what makes the slip appear', /คำนวณเงินเดือนของเดือนนี้แล้ว/.test(card));
  ok_('the month is shown so nobody misreads which one', /\$\{month\?` · \$\{esc\(month\)\}`:''\}/.test(card));
}

console.log('\n7) printing a whole month no longer fails once per person');
{
  const fn = app.slice(app.indexOf('window.A_print=async(month)=>'), app.indexOf('window.A_print=async(month)=>') + 600);
  ok_('each staff member is still fetched independently', /api\('getPayslip',\{staffId:x\.StaffID,month\}\)\.catch\(\(\)=>null\)/.test(fn));
  ok_('nulls are filtered, not thrown', /\.filter\(Boolean\)/.test(fn));
  ok_('and an empty month is a message, not an error', /ยังไม่มีสลิปของเดือนนี้/.test(fn));
}

console.log('\n8) the route is still the one that runs on live');
{
  // if this route were ever deleted the engine would answer — same shape now, but the fund total
  // is derived HERE, so the check that it exists must stay
  ok_('getPayslip is routed in Code.gs', /getPayslip:\s*function/.test(code));
  ok_('and it is not admin-only (a teacher opens their own)', !/\bgetPayslip: 1/.test(code.slice(code.indexOf('var ADMIN_ONLY'), code.indexOf('parentKidsMap: 1 }'))));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
