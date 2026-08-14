/**
 * tools/test_teacher_ui.js — v226: say what the buttons do, and work the day you were asked to.
 *   node tools/test_teacher_ui.js
 *
 *   · the teacher's per-child buttons carry WORDS, not bare icons (there is no hover on a phone)
 *   · the daily journal stays shut until the child is actually here — the same rule the server
 *     enforces, said on the button instead of as a refusal after a page has been filled in
 *   · "แก้ไขเวลารับ-ส่ง" is an attendance job: it lives in ดำเนินการ → นักเรียน for the admin
 *   · a Big Cleaning day counts as WORK and runs to ITS OWN hours — lateness and OT that day are
 *     measured against those, so nobody is marked late for keeping to the day they were asked to work
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), ci = R('src/Checkin.gs'), css = R('webapp/styles.css');

function boot(cfgExtra) {
  const M = {
    config: Object.assign({ Plans: [], LeaveQuota: {}, LateGraceMinutes: 0, BigCleaningDays: [] }, cfgExtra || {}),
    students: [{ StudentID: 'STD-1', NameTH: 'บีม', Nickname: 'บีม', Class: 'Nursery 1', Status: 'ACTIVE', DOB: '2023-01-01' }],
    staff: [{ StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Officer' }],
    workSchedule: [{ StaffID: 'T1', CheckInTime: '08:00', CheckOutTime: '17:00' }],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], injuryReports: [], insurance: [], bigCleaning: [], departments: [],
    permissions: {}, feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const today = (() => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
function grab(fn) { let e = null; try { fn(); } catch (x) { e = x.message || String(x); } return e; }

console.log('\n=== 1. the buttons say what they do ===');
ok_('one builder for a child’s row', /function studentRowButtons\(s, jdone\)/.test(app));
// the three a teacher uses all day stay on the row, each named in ONE word
[['บันทึก', 'journal — none yet'], ['แก้ไข', 'journal — draft'], ['ดู', 'journal — sent'],
 ['ประเมิน', 'assess'], ['เช็คอิน', 'check in'], ['รับกลับ', 'pick up'], ['ลา', 'on leave']]
  .forEach(w => ok_('the row offers "' + w[0] + '" in words (' + w[1] + ')', app.indexOf("'" + w[0] + "'") > 0));
ok_('the long labels are gone from the row', /const jShortLabel = d =>/.test(app));
ok_('…but the full sentence is still on the tooltip', /journalBtnLabel\(done\)\+' — '\+dispNick\(s\)/.test(app));
ok_('exactly four things on the row: journal, assess, check-in, ⋯',
  /return `<div class="stuacts">\$\{\[jBtn,\n\s*B\('outline', `T_assess[\s\S]{0,220}ciBtn,\n\s*B\('outline more', `T_stuMore[^\]]*\n\s*\]\.join\(''\)\}<\/div>`;/.test(app));
ok_('⋯ is the icon alone — a word there costs a third of the row', /B\('outline more', `T_stuMore\('\$\{s\.StudentID\}'\)`, '⋯', '',/.test(app));
ok_('…and the helper knows an empty label means icon-only', /\$\{icon\}\$\{label\?' '\+esc\(label\):''\}/.test(app));
ok_('the row is a GRID, so every card lines up', /\.stuacts\{display:grid;grid-template-columns:1fr 1fr 1fr 46px/.test(css));
ok_('…mobile first: the phone layout is the default, relaxed upward', /@media\(min-width:520px\)\{\n\s*\.stuacts\{/.test(css));
ok_('the ⋯ column is narrow on purpose', /\.stuacts \.btn\.sm\.more\{/.test(css));
ok_('the two-action home rows are an even pair, not a wrapping strip', /\.acts2\{display:grid;grid-template-columns:1fr 1fr/.test(css));
ok_('…and the name column may shrink so they fit beside it', /min-width:0;flex:1/.test(app));

console.log('\n=== 1b. the occasional three live behind ⋯, as a list ===');
ok_('there is a ⋯ menu for a child', /window\.T_stuMore=\(sid\)=>/.test(app));
[['T_studentLeave', 'file leave'], ['EDIT_ATT', 'correct times'], ['T_journalHistory', 'past reports']]
  .forEach(w => ok_('⋯ offers ' + w[1], new RegExp('\\$\\{close\\}' + w[0] + "\\('\\$\\{esc\\(sid\\)\\}'").test(app)));
ok_('…each on its own full-width line, like the admin’s ⋯',
  (app.match(/<button class="btn block outline"[^>]*onclick="\$\{close\}(T_studentLeave|EDIT_ATT|T_journalHistory)/g) || []).length === 3);
ok_('the menu knows the child’s name without another round trip', /let T_STU=\{\}/.test(app) && /T_STU\[s\.StudentID\]=s;/.test(app));
ok_('…filled by BOTH screens that list children',
  (app.match(/T_STU\[s\.StudentID\]=s;/g) || []).length === 2);
// the old row was six bare icons with the meaning hidden in a title=""
ok_('the bare-icon row is gone', app.indexOf('aria-label="${EN()?"Assess":"ประเมิน"}" title="${EN()?"Assess":"ประเมิน"}">📝</button>') < 0);

console.log('\n=== 2. no journal until the child is here ===');
{
  const { H, M } = boot();
  const e = grab(() => H.submitJournal({ studentId: 'STD-1', staffId: 'T1', submit: true, Mood: 'Happy' }));
  ok_('the server refuses it', /NOT_CHECKED_IN|ยังไม่ได้เช็คอิน/.test(e || ''));
  M.studentAttendanceToday.push({ StudentID: 'STD-1', Status: 'IN' });
  ok_('…and allows it once they arrive', !grab(() => H.submitJournal({ studentId: 'STD-1', staffId: 'T1', submit: true, Mood: 'Happy' })));
}
ok_('the class screen closes the button on the same rule', /const done=jdone\[s\.StudentID\], canJ = s\.inToday \|\| !!done;/.test(app));
ok_('the HOME list closes it too (it used to stay open)',
  /same rule as the class screen and as the server: no journal until the child has arrived/.test(app));
ok_('a child on leave is told the leave IS the record',
  app.indexOf('ลาวันนี้ — การลาคือบันทึกของวันนี้') > 0);
ok_('a child simply not here yet is told to check them in',
  app.indexOf('ต้องเช็คอินนักเรียนก่อนจึงจะบันทึกได้') > 0);

console.log('\n=== 3. correcting a time is an attendance job ===');
ok_('the admin reaches it from ดำเนินการ → นักเรียน', /A_editAttPick\(\)/.test(app));
ok_('…sat between OT รับช้า and สรุปรายชั้นเรียน',
  /A_studentOT\(\)'\][\s\S]{0,160}A_editAttPick\(\)'\][\s\S]{0,160}A_studentReport\(\)'\]/.test(app));
ok_('it is a picker, so the child is chosen by name', /A_editAttFilter/.test(app) && /eaRow/.test(app));
ok_('…and hands off to the existing corrector', /EDIT_ATT\('\$\{esc\(s\.StudentID\)\}'\)/.test(app));
ok_('it is gone from the ADMIN’s per-student ⋯ menu',
  app.indexOf("correcting a time moved to ดำเนินการ → นักเรียน") > 0);
ok_('the teacher keeps it, now on their own ⋯ menu', /\$\{close\}EDIT_ATT\('\$\{esc\(sid\)\}'\)/.test(app));

console.log('\n=== 4. Big Cleaning: a working day with its own hours ===');
{
  const { H } = boot({ BigCleaningDays: [today], BigCleaningIn: '09:00', BigCleaningOut: '15:00' });
  const d = H.schoolDay({});
  eq('today is a Big Cleaning day', d.bigCleaning, true);
  eq('…and NOT closed, whatever day of the week it is', d.closed, false);
  eq('the screen is told the hours (in)', d.bcIn, '09:00');
  eq('the screen is told the hours (out)', d.bcOut, '15:00');
  const bc = H.bigCleaningDays();
  eq('the admin screen can read them back (in)', bc.checkIn, '09:00');
  eq('the admin screen can read them back (out)', bc.checkOut, '15:00');
}
{
  const { H } = boot({ BigCleaningDays: [today] });
  const bc = H.bigCleaningDays();
  eq('unset falls back to the school’s usual start', bc.checkIn, '08:30');
  eq('unset falls back to the school’s usual end', bc.checkOut, '17:00');
  const d = H.schoolDay({});
  eq('an ordinary day carries no Big Cleaning hours', H.schoolDay({ date: '2026-08-19' }).bcIn, '');
  ok_('…and today does', !!d.bcIn);
}
ok_('check-in measures late against the day’s own start', /const bc=isBigCleaning_\(todayLocal\(\)\); const inT=bc\?\(bigCleaningIn_\(\)\):sch\.CheckInTime/.test(eng));
ok_('check-out measures OT against the day’s own end', /isBigCleaning_\(todayLocal\(\)\)\?\(bigCleaningOut_\(\)\):sch\.CheckOutTime/.test(eng));
ok_('the two times live in one place', /const bigCleaningIn_  = \(\) =>/.test(eng) && /const bigCleaningOut_ = \(\) =>/.test(eng));
// v229: read through getConfigTime_ — a time cell comes back from Sheets as a Date (test_config_time.js)
ok_('GAS reports them to the admin screen too', /checkIn: getConfigTime_\('BigCleaningIn', '08:30'\)/.test(ci));
ok_('the OT record’s PlanOut is the day’s real end time, not the group shift', /PlanOut: outHHmm,/.test(ci));
ok_('the admin can set them', /setBCIn/.test(app) && /setBCOut/.test(app) && /A_bcSaveHours/.test(app));
ok_('a blank time never overwrites a working schedule', /an empty time field means "leave it as it is"/.test(app));
ok_('adding a date saves the hours first, so they are not lost', /await api\('setSchoolConfig',\{values:bcHourValues\(\)\}\);\n    try\{ await api\('addBigCleaning'/.test(app));
ok_('the stale "no fixed hours" copy is gone', app.indexOf('ไม่กำหนดเวลาเข้า-ออก') < 0);
ok_('staff are shown the hours on the day', /Big Cleaning Day.{0,80}เวลาทำงานวันนี้/s.test(app) || /const bcBar =/.test(app));
ok_('…explaining that late and OT follow them', app.indexOf('การมาสายและ OT ของวันนี้คิดจากเวลานี้ ไม่ใช่เวลาปกติ') > 0);

console.log('\n=== 5. nothing else moved ===');
{
  const { H, M } = boot({ BigCleaningDays: [today] });
  M.holidays.push({ Date: '2026-12-31', NameTH: 'สิ้นปี' });
  eq('a real holiday still closes the school', H.schoolDay({ date: '2026-12-31' }).closed, true);
  const sat = '2026-08-15';   // a Saturday that is NOT a cleaning day here
  eq('a plain weekend is still closed', H.schoolDay({ date: sat }).closed, true);
  eq('…and carries no cleaning hours', H.schoolDay({ date: sat }).bcIn, '');
}
ok_('the assess button is still on the row', /T_assess\('\$\{s\.StudentID\}'\)/.test(app));
ok_('past reports are still reachable', /T_journalHistory\('\$\{esc\(sid\)\}'\)/.test(app));
ok_('filing a student leave is still reachable', /T_studentLeave\('\$\{esc\(sid\)\}'/.test(app));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
