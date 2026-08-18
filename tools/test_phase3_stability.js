/**
 * tools/test_phase3_stability.js — Phase 3: stop reporting things as broken when they are not, and
 * stop crashing on the one case that really was.
 *   node tools/test_phase3_stability.js
 *
 * From the live log, one day: dspmStatus INTERNAL ×4 · staffCheckout 33% fail · NO_SESSION ×10.
 * Investigating them found three DIFFERENT kinds of problem, and only one was a real fault.
 *
 *   dspmStatus — a genuine crash. studentById returns undefined for a child who is no longer on the
 *     roll, and the next line read .DOB off it. The teacher saw "INTERNAL", which tells them nothing
 *     and tells us nothing either.
 *
 *   staffCheckout — the server was RIGHT to refuse: the punch had already been recorded. The app was
 *     wrong to show it as a failure. It happens when the reply to the first tap is lost in transit,
 *     or when the punch was made on another device; either way the work is done and the teacher
 *     should be told the time, not shown a red error.
 *
 *   NO_SESSION — already self-healing. guarded() signs back in behind the scenes and repeats the
 *     call, so nobody saw anything; but the first attempt was logged as a failure and the recovery
 *     was invisible, so the report accused a morning that was fine. A recovered failure is now
 *     marked, and the report subtracts it from the rate it leads with.
 *
 * The fourth item was the two suites that had been red for months (day4/day5). All three failures
 * were test rot, not product faults — they are fixed in place, and this file states what they were
 * so the next person does not re-investigate them.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, wantCode) {
  let code = null, msg = null;
  try { fn(); } catch (e) { code = e && e.code; msg = String((e && e.message) || e); }
  const ok = code === wantCode;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(code || msg)));
  ok ? pass++ : fail++;
  return msg;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), api = R('webapp/api.js'),
      perf = R('src/Perf.gs'), d4 = R('tools/test_day4.js'), d5 = R('tools/test_day5.js');

function boot(over) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, DspmManualUrl: '' },
    students: [{ StudentID: 'STD-1', NameTH: 'บีม', DOB: '2024-05-01', Class: 'Nursery 1', Status: 'ACTIVE' }],
    dspmCriteria: [{ ItemNo: 40, AgeFrom: 0, AgeTo: 200, Skill: 'GM', Description: 'ยืนได้', AgeLabelTH: '13-15 เดือน' }],
    assessments: [], staff: [], parents: [], userLinks: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], classChanges: [], timeRequests: [],
    adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [], classes: [],
    studentAttendanceToday: [], studentCheckins: [], otRecords: [], dspmEN: {}
  };
  Object.assign(M, over || {});
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}

console.log('\n1) dspmStatus: a child who is not on the roll gets an ANSWER, not a crash');
{
  const { H } = boot();
  eq('a child who IS on the roll still works', H.dspmStatus({ studentId: 'STD-1' }).items.length, 1);
  const msg = throws_('one who is not gets a named refusal, not INTERNAL', () => H.dspmStatus({ studentId: 'STD-GONE' }), 'NOT_FOUND');
  ok_('...and the message says what happened, in words a teacher can act on', /ไม่พบนักเรียน/.test(msg || ''));
  throws_('a blank id too', () => H.dspmStatus({ studentId: '' }), 'NOT_FOUND');
  throws_('...and a missing one', () => H.dspmStatus({}), 'NOT_FOUND');
  ok_('the guard is written where the crash was', /if\(!s\) fail\('NOT_FOUND'/.test(eng));
  // the whole class of bug: a lookup that can return undefined, dereferenced on the next line
  ok_('no other lookup in the engine dereferences an unchecked result', (() => {
    const lines = eng.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /const (\w+)\s*=\s*(?:studentById|staffById_?)\(([^)]*)\)\s*;/.exec(lines[i]);
      if (!m) continue;
      const v = m[1], win = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join('\n');
      // `if(!s)`, `if(!s||seen[..])`, `s||{}`, `s?.x`, `!s.StaffID` — all of them are a guard.
      // The first version of this demanded a closing bracket straight after the name and so
      // reported `if(!s||seen[l.StudentID])return;` as unguarded. A checker that cries wolf is
      // worse than none: it gets switched off.
      const guarded = new RegExp([
        'if\\s*\\(\\s*!' + v + '\\b',      // if (!s) …  /  if (!s || seen[..]) …
        '\\(\\s*' + v + '\\s*&&',          // if (s && …) …  /  return (s && canSee(s))
        'if\\s*\\(\\s*' + v + '\\s*\\)',   // if (s) { … }
        v + '\\s*\\|\\|\\s*\\{\\}',        // const s = … || {}
        v + '\\?\\.',                      // s?.x
        '!' + v + '\\.StaffID'             // the staff-lookup idiom used throughout
      ].join('|')).test(win);
      if (new RegExp('\\b' + v + '\\.[A-Za-z]').test(win) && !guarded) { console.log('      unguarded at line ' + (i + 1)); return false; }
    }
    return true;
  })());
}

console.log('\n2) staffCheckout: "already done" is not a failure');
{
  ok_('the app recognises both already-punched codes', /code==='ALREADY_CHECKED_IN'\|\|code==='ALREADY_CHECKED_OUT'/.test(app));
  ok_('...tells the teacher with a tick, not an error', /toast\('✅ '\+\(\(e&&e\.message\)\|\|\(EN\(\)\?'Already recorded':'บันทึกไว้แล้ว'\)\)\);/.test(app));
  ok_('...and re-reads the screen so it shows the real time', /GO\('home'\); return;\s+\/\/ re-reads the real times/.test(app));
  ok_('every other error is still shown as one', /err\(e\); if\(btn\)\{ btn\.disabled=false;/.test(app));
  // the server message carries the time it actually happened — that is what makes the toast useful
  ok_('the server says WHEN it was recorded', /ALREADY_CHECKED_OUT', 'ลงเวลาออกงานวันนี้ไปแล้ว \(' \+ toHHmm_\(row\.CheckOut\)/.test(R('src/Checkin.gs')));
  ok_('...for the check-in too', /ALREADY_CHECKED_IN', 'ลงเวลาเข้างานวันนี้ไปแล้ว \(' \+ toHHmm_\(existing\.CheckIn\)/.test(R('src/Checkin.gs')));
}

console.log('\n3) a failure that recovered is reported as recovered');
{
  ok_('the client marks the recovery', /return enqueueGas\(action, payload\)\.then\(d => \{ PERF\.mark\('healed', action, 0\); return d; \}\);/.test(api));
  ok_('...only after a successful re-login', /if \(!ok\) throw e;/.test(api));
  ok_('the server counts them', /if \(type === 'healed'\) \{ healed\[action\] = \(healed\[action\] \|\| 0\) \+ 1; healedTotal\+\+; continue; \}/.test(perf));
  ok_('...and reports what is left after taking them out', /realFailed: Math\.max\(0, failed - healedTotal\)/.test(perf) && /realFailRate:/.test(perf));
  ok_('...naming which actions recovered', /healedBy: Object\.keys\(healed\)/.test(perf));
  ok_('the screen says it plainly', /ระบบกู้คืนให้เองแล้ว/.test(app));
  ok_('...and explains that nobody saw an error', /ผู้ใช้ไม่เห็น error/.test(app));
  ok_('the copied report carries it too', /L\.push\('SELF-HEALED: '\+d\.healed/.test(app));
}
{
  // the aggregation, over rows shaped exactly like the sheet's
  const H = require(path.join(__dirname, 'gas_test_harness.js'));
  const { run } = H(['Config', 'Db', 'Perf']);
  const res = JSON.parse(run(function () {
    var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
    PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
    PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
    main.insertSheet('SCHOOL_CONFIG').appendRow(['Key', 'Value']);
    var sh = main.insertSheet('PERF_LOG'); sh.appendRow(PERF_HEADERS);
    var ts = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
    // 10 calls: 8 fine, 2 failed with NO_SESSION — and both then recovered
    for (var i = 0; i < 8; i++) sh.appendRow([ts, 'S1', 'teacher', 'api', 'getJournal', 900, 1, '', 1, 'class', 'iOS', '4g', 0, 'v1']);
    sh.appendRow([ts, 'S1', 'teacher', 'api', 'getJournal', 900, 0, 'NO_SESSION', 1, 'class', 'iOS', '4g', 0, 'v1']);
    sh.appendRow([ts, 'S1', 'teacher', 'api', 'schoolDay', 900, 0, 'NO_SESSION', 1, 'class', 'iOS', '4g', 0, 'v1']);
    sh.appendRow([ts, 'S1', 'teacher', 'healed', 'getJournal', 0, 1, '', 1, 'class', 'iOS', '4g', 0, 'v1']);
    sh.appendRow([ts, 'S1', 'teacher', 'healed', 'schoolDay', 0, 1, '', 1, 'class', 'iOS', '4g', 0, 'v1']);
    return JSON.stringify(handlePerfSummary({ days: 7 }));
  }));
  eq('the raw failures are still counted — they did happen', res.failed, 2);
  eq('...and so is the recovery', res.healed, 2);
  eq('what is left is what people actually experienced', res.realFailed, 0);
  eq('...as a rate', res.realFailRate, 0);
  eq('the healed rows do not inflate the call count', res.calls, 10);
  eq('and it says which actions they were', (res.healedBy || []).map(x => x.action).sort(), ['getJournal', 'schoolDay']);
}

console.log('\n4) the two suites that had been red for months');
{
  // all three were test rot. Recording WHAT they were, so nobody re-investigates them as bugs.
  ok_('day4 loads the file whose function Parent.gs actually calls', /'Leave','Notify','Parent'\]/.test(d4));
  ok_('...and no longer demands a LINE push the school turned off on purpose', /admin notified for final approval \(inbox, or LINE when enabled\)/.test(d4));
  ok_('...checking the channel that is actually configured', /String\(getConfig_\('AdminLineNotify', 'false'\)\) === 'true'/.test(d4));
  ok_('day5 anchors the child\'s age to TODAY instead of a literal date', /_b\.setMonth\(_b\.getMonth\(\) - 13\)/.test(d5));
  ok_('...and says why, so it is not "simplified" back', /the test aged with the calendar and\s+\*?\s*failed by itself/.test(d5));
  ok_('day5 now proves BOTH gates, in the order a teacher meets them', /NOT_CHECKED_IN', 'journal is refused until the child is checked in'/.test(d5) && /MISSING_FIELDS', 'submit blocks missing required field/.test(d5));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
