/**
 * tools/test_config_time.js — a TIME kept in SCHOOL_CONFIG must survive the round trip.
 *   node tools/test_config_time.js
 *
 * THE BUG THIS EXISTS FOR (reported 2026-08-15): saving the Big Cleaning hours said "saved", and
 * the fields were empty when the admin came back.
 *
 * Writing '09:15' into a cell makes Google Sheets store a TIME, and a time-only cell reads back as
 * a Date on the 1899-12-30 epoch — NOT the string that was written. Everything downstream treated
 * it as a string:
 *   · the admin screen got 'Sat D' (String(date).slice(0,5)); an <input type="time"> silently
 *     rejects a value it cannot parse, so the box was blank and the setting looked lost;
 *   · hhmmToMin_ returned null, so lateness and OT on a Big Cleaning day were measured against the
 *     fallback instead of the hours the school had actually set. That is the half that costs money.
 *
 * The rule: a time config value is read through getConfigTime_ (GAS) / cfgTime_ (engine), and
 * hydrateConfig_ decodes Date cells for every config key at once, so no key can be caught again.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ci = R('src/Checkin.gs'), ge = R('src/GasEngine.gs'), eng = R('webapp/engine.js');

// ---- the real GAS code, against an in-memory spreadsheet -------------------------------------
const { run } = H(['Config', 'Db', 'Checkin', 'Staff', 'GasEngine']);
const res = JSON.parse(run(function () {
  var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
  PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
  PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
  var cfg = main.insertSheet('SCHOOL_CONFIG');
  cfg.appendRow(['Key', 'Value']);
  cfg.appendRow(['BigCleaningDays', '2026-08-15']);

  var out = {};
  out.defaults = handleBigCleaningDays();
  handleSetSchoolConfig({ values: { BigCleaningIn: '09:15', BigCleaningOut: '15:45', BigCleaningAmount: 300 } });
  out.written = cfg.getRange(1, 1, cfg.getLastRow(), 2).getValues()
    .filter(function (r) { return /^BigCleaning(In|Out|Amount)$/.test(r[0]); });
  out.readBack = handleBigCleaningDays();

  // …now do to those cells exactly what Google Sheets does to a time: store a 1899-12-30 Date
  for (var i = 2; i <= cfg.getLastRow(); i++) {
    var k = cfg.getRange(i, 1, 1, 1).getValues()[0][0];
    if (k === 'BigCleaningIn')  cfg.getRange(i, 2, 1, 1).setValue(new Date(1899, 11, 30, 9, 15));
    if (k === 'BigCleaningOut') cfg.getRange(i, 2, 1, 1).setValue(new Date(1899, 11, 30, 15, 45));
  }
  _configCache = null;
  out.afterCoercion = handleBigCleaningDays();
  // a build without the fix must FAIL these cleanly, not blow up the run
  var T = (typeof getConfigTime_ === 'function') ? getConfigTime_ : function (k, d) { return String(getConfig_(k, d)).slice(0, 5); };
  out.timeHelper = { fromDate: T('BigCleaningIn', '08:30'), missing: T('NoSuchKey', '07:00') };
  // a damaged cell must fall back, never become midnight
  cfg.appendRow(['JunkTime', 'not a time at all']); _configCache = null;
  out.timeHelper.junk = T('JunkTime', '08:00');
  // lateness must be measured against the hours that were SET
  out.late = { at0930: hhmmToMin_(T('BigCleaningIn', '08:30')) };
  return JSON.stringify(out);
}));

console.log('\n=== 1. the value is written, and read back ===');
eq('nothing set yet → the school’s usual hours', [res.defaults.checkIn, res.defaults.checkOut], ['08:30', '17:00']);
eq('the admin’s times reach SCHOOL_CONFIG', res.written.map(r => r[0] + '=' + r[1]).sort(),
  ['BigCleaningAmount=300', 'BigCleaningIn=09:15', 'BigCleaningOut=15:45']);
eq('…and read straight back', [res.readBack.checkIn, res.readBack.checkOut], ['09:15', '15:45']);
eq('the bonus too', res.readBack.amount, 300);

console.log('\n=== 2. …and STILL read back after Sheets turns them into times ===');
// this is the exact state of the live sheet: the cell holds a 1899-12-30 Date, not a string
eq('the hours survive the round trip', [res.afterCoercion.checkIn, res.afterCoercion.checkOut], ['09:15', '15:45']);
ok_('…so the admin screen shows what was saved, not an empty box',
  /^\d{2}:\d{2}$/.test(res.afterCoercion.checkIn) && /^\d{2}:\d{2}$/.test(res.afterCoercion.checkOut));
eq('getConfigTime_ decodes a Date cell', res.timeHelper.fromDate, '09:15');
eq('a missing key falls back', res.timeHelper.missing, '07:00');
eq('a damaged cell falls back — it does NOT become midnight', res.timeHelper.junk, '08:00');

console.log('\n=== 3. the half that costs money: lateness and OT ===');
eq('the Big Cleaning start parses to real minutes (it used to be null → 08:00)', res.late.at0930, 555);
ok_('check-in measures late against the day’s own start, decoded',
  /getConfigTime_\('BigCleaningIn', '08:30'\)/.test(ci) && ci.indexOf("getConfig_('BigCleaningIn'") < 0);
ok_('check-out measures OT against the day’s own end, decoded',
  /getConfigTime_\('BigCleaningOut', '17:00'\)/.test(ci) && ci.indexOf("getConfig_('BigCleaningOut'") < 0);
ok_('the admin screen reads them the same way', /checkIn: getConfigTime_\('BigCleaningIn'/.test(ci));
ok_('…and the raw String(...).slice(0,5) is gone', ci.indexOf("String(getConfig_('BigCleaning") < 0);

console.log('\n=== 4. fixed once, for every config key ===');
ok_('hydrateConfig_ decodes Date cells instead of passing them through', /else cfg\[k\] = decodeCell_\(v\);/.test(ge));
ok_('the engine refuses a time that is not HH:mm', /const cfgTime_ = \(v, dflt\) =>/.test(eng));
ok_('…and uses it for both Big Cleaning hours',
  /bigCleaningIn_  = \(\) => cfgTime_\(cfg\.BigCleaningIn,  '08:30'\)/.test(eng) &&
  /bigCleaningOut_ = \(\) => cfgTime_\(cfg\.BigCleaningOut, '17:00'\)/.test(eng));
ok_('getConfigTime_ is documented with the reason it exists', /1899-12-30 epoch/.test(ci));

console.log('\n=== 5. the engine agrees, on a value of either shape ===');
{
  const mk = v => {
    const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
    const M = { config: { Plans: [], LeaveQuota: {}, BigCleaningDays: ['2026-08-15'], BigCleaningIn: v, BigCleaningOut: '15:45' },
      students: [], staff: [], parents: [], userLinks: [], leaves: [], payments: [], otDaily: [], studentCharges: [],
      prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [], holidays: [], staffGroups: [],
      workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {},
      studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [], notifications: [],
      vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [],
      foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [], injuryReports: [], insurance: [],
      bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], classes: [],
      studentAttendanceToday: [], studentCheckins: [] };
    return ctx.createAtomAPI(M, {}).H;
  };
  eq('a plain string works', mk('09:15').bigCleaningDays().checkIn, '09:15');
  eq('a Date-shaped string is refused, not half-read', mk('Sat Dec 30 1899 09:15:00').bigCleaningDays().checkIn, '08:30');
  eq('blank falls back', mk('').bigCleaningDays().checkIn, '08:30');
  eq('the day’s card carries the hours', mk('09:15').schoolDay({ date: '2026-08-15' }).bcIn, '09:15');
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
