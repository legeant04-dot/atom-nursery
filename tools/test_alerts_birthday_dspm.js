/**
 * tools/test_alerts_birthday_dspm.js — two reminders about a child, in front of the people who act.
 *   node tools/test_alerts_birthday_dspm.js
 *
 *   · BIRTHDAYS this month: on the admin's student calendar (🎂 on the day) and summarised under it,
 *     and on the teacher's own screens for their own classes.
 *   · DSPM DUE: after the child's name, naming the age band they have reached (e.g. 31-36 เดือน).
 *     It CLEARS ITSELF — finish every item in the band and the child drops off the list, with
 *     nothing to dismiss and no way to forget to dismiss it.
 *
 * THE RULE THAT MUST NOT BEND: "ยังไม่ได้ประเมิน" is a real answer a teacher can record, but it is
 * NOT an assessment — it keeps the reminder up. That is the whole point of being able to record it.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js');

const NOW = new Date();
const p2 = n => String(n).padStart(2, '0');
const THIS_MONTH = NOW.getFullYear() + '-' + p2(NOW.getMonth() + 1);
const OTHER_MONTH_NO = ((NOW.getMonth() + 6) % 12) + 1;          // six months away, always different
// a DOB whose month is THIS month, four years ago (birthday this month, too old for any band here)
const BDAY_THIS = (NOW.getFullYear() - 4) + '-' + p2(NOW.getMonth() + 1) + '-12';
// born THIS month three years ago → 35 or 36 months old, so the birthday is this month AND the
// child sits in the 31-36 band. Both facts have to be true of the same child to test them together.
const BDAY_THIS_3Y = (NOW.getFullYear() - 3) + '-' + p2(NOW.getMonth() + 1) + '-12';
const AGE_3Y = (NOW.getDate() >= 12) ? 36 : 35;
// a birthday in a DIFFERENT month
const BDAY_OTHER = (NOW.getFullYear() - 3) + '-' + p2(OTHER_MONTH_NO) + '-05';

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {} },
    students: [
      // birthday THIS month and in the 31-36 band — both facts, one child
      { StudentID: 'S1', NameTH: 'พรีมี่', Nickname: 'พรีมี่', Class: 'Nursery 2', Status: 'ACTIVE', DOB: BDAY_THIS_3Y },
      // birthday in a different month, same class
      { StudentID: 'S2', NameTH: 'กัปตัน', Nickname: 'กัปตัน', Class: 'Nursery 2', Status: 'ACTIVE', DOB: BDAY_OTHER },
      // another class entirely — the teacher must not see this one
      { StudentID: 'S3', NameTH: 'เบรฟ', Nickname: 'เบรฟ', Class: 'Nursery Baby', Status: 'ACTIVE', DOB: BDAY_THIS },
      // withdrawn — nobody should see this one
      { StudentID: 'S9', NameTH: 'ออกแล้ว', Nickname: 'ออก', Class: 'Nursery 2', Status: 'WITHDRAWN', DOB: BDAY_THIS }
    ],
    classes: [{ ClassName: 'Nursery 2', TeacherID: 'T1' }, { ClassName: 'Nursery Baby', TeacherID: 'T2' }],
    staff: [
      { StaffID: 'T1', NameTH: 'ครูเอ', Role: 'Teacher', PositionLevel: 'Officer', Department: 'Nursery 2' },
      { StaffID: 'L1', NameTH: 'หัวหน้าแนน', Role: 'Teacher', PositionLevel: 'Leader' },
      { StaffID: 'A1', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' }
    ],
    dspmCriteria: [
      { ItemNo: 51, AgeFrom: 31, AgeTo: 36, AgeLabelTH: '31-36 เดือน', Skill: 'GM', Description: 'ยืนขาเดียว' },
      { ItemNo: 52, AgeFrom: 31, AgeTo: 36, AgeLabelTH: '31-36 เดือน', Skill: 'FM', Description: 'วาดวงกลม' },
      { ItemNo: 20, AgeFrom: 13, AgeTo: 18, AgeLabelTH: '13-18 เดือน', Skill: 'GM', Description: 'เดินได้' }
    ],
    assessments: [],
    parents: [], userLinks: [], leaves: [], payments: [], otDaily: [], studentCharges: [], prepayments: [],
    paymentSlips: [], checkinStudent: [], journals: [], comments: [], holidays: [], staffGroups: [],
    workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [], payroll: [], payrollConfig: {},
    studentLeaves: [], absenceLog: [], activityLog: [], announcements: [], notifications: [], vaccines: [],
    growth: [], growthRecords: [], classChanges: [], timeRequests: [], attendanceReq: [], adminInbox: [],
    foodMenus: [], foodItems: [], surveys: [], surveyResponses: [], injuries: [], injuryReports: [],
    insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    studentAttendanceToday: [], studentCheckins: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  if (typeof H.studentAlerts !== 'function') H.studentAlerts = function () { return { birthdays: [], dspmDue: [], counts: {} }; };
  return { H, M };
}

console.log('\n=== 1. birthdays this month ===');
{
  const { H } = boot();
  const a = H.studentAlerts({ staffId: 'A1' });
  eq('the admin sees every child with a birthday this month', a.birthdays.map(b => b.studentId).sort(), ['S1', 'S3']);
  eq('…and NOT the one whose birthday is another month', a.birthdays.some(b => b.studentId === 'S2'), false);
  eq('…nor a child who has left', a.birthdays.some(b => b.studentId === 'S9'), false);
  // a build without studentAlerts must FAIL cleanly, not crash the run
  const s1 = a.birthdays.find(b => b.studentId === 'S1') || {};
  eq('the day of the month is there, for the calendar cell', s1.day, 12);
  eq('…and the age they turn', s1.turning, 3);
  ok_('the list is in date order', a.birthdays.every((b, i, arr) => i === 0 || arr[i - 1].day <= b.day));
}
{
  const { H } = boot();
  const t = H.studentAlerts({ staffId: 'T1' });
  eq('a teacher sees their OWN class only', t.birthdays.map(b => b.studentId), ['S1']);
  eq('…and the scope says so', t.scope, 'myClasses');
  eq('the admin scope says school', H.studentAlerts({ staffId: 'A1' }).scope, 'school');
}
{
  const { H } = boot();
  const other = H.studentAlerts({ staffId: 'A1', month: THIS_MONTH.slice(0, 4) + '-' + p2(OTHER_MONTH_NO) });
  eq('another month asks a different question', other.birthdays.map(b => b.studentId), ['S2']);
  eq('…and says which month it answered', other.month, THIS_MONTH.slice(0, 4) + '-' + p2(OTHER_MONTH_NO));
}

console.log('\n=== 2. DSPM: who is due, and which band ===');
{
  const { H } = boot();
  const a = H.studentAlerts({ staffId: 'A1' });
  const found = a.dspmDue.find(k => k.studentId === 'S1');
  ok_('a child of ' + AGE_3Y + ' months is due', !!found);
  const s1 = found || {};
  eq('…named by the band they have reached', s1.band, '31-36');
  eq('…with the label the criteria carry', s1.ageLabel, '31-36 เดือน');
  eq('…their age in months', s1.ageMonth, AGE_3Y);
  eq('…and how many items are done', [s1.done, s1.total], [0, 2]);
  eq('a child with no criteria for their age is not nagged',
    a.dspmDue.some(k => k.studentId === 'S3'), false);
  eq('a withdrawn child is not on the list', a.dspmDue.some(k => k.studentId === 'S9'), false);
}

console.log('\n=== 3. it clears ITSELF ===');
{
  const { H, M } = boot();
  const today = NOW.getFullYear() + '-' + p2(NOW.getMonth() + 1) + '-' + p2(NOW.getDate());
  M.assessments.push({ StudentID: 'S1', ItemNo: 51, Result: 'ผ่าน', Date: today });
  let s1 = H.studentAlerts({ staffId: 'A1' }).dspmDue.find(k => k.studentId === 'S1');
  eq('half way through, still due', [!!s1, s1 && s1.done], [true, 1]);
  M.assessments.push({ StudentID: 'S1', ItemNo: 52, Result: 'ไม่ผ่าน', Date: today });
  s1 = H.studentAlerts({ staffId: 'A1' }).dspmDue.find(k => k.studentId === 'S1');
  eq('every item answered → the reminder is gone', !!s1, false);
  ok_('…and "ไม่ผ่าน" counts as assessed, because it IS an answer', !s1);
}
{
  const { H, M } = boot();
  const today = NOW.getFullYear() + '-' + p2(NOW.getMonth() + 1) + '-' + p2(NOW.getDate());
  M.assessments.push({ StudentID: 'S1', ItemNo: 51, Result: 'ยังไม่ได้รับการทดสอบ', Date: today });
  M.assessments.push({ StudentID: 'S1', ItemNo: 52, Result: 'ยังไม่ได้รับการทดสอบ', Date: today });
  const s1 = H.studentAlerts({ staffId: 'A1' }).dspmDue.find(k => k.studentId === 'S1');
  eq('"not assessed yet" does NOT clear it — that is the point of recording it', !!s1, true);
  eq('…and nothing is counted as done', (s1 || {}).done, 0);
}
{
  const { H, M } = boot();
  const today = NOW.getFullYear() + '-' + p2(NOW.getMonth() + 1) + '-' + p2(NOW.getDate());
  // an OLD result for an item in a band this child has already grown out of must not count
  M.assessments.push({ StudentID: 'S1', ItemNo: 20, Result: 'ผ่าน', Date: '2024-01-01' });
  const s1 = H.studentAlerts({ staffId: 'A1' }).dspmDue.find(k => k.studentId === 'S1');
  eq('a result from an earlier band does not satisfy this one', (s1 || {}).done, 0);
}

console.log('\n=== 4. the admin sees it where the school was told to put it ===');
ok_('the alerts are fetched on ดำเนินการ → นักเรียน', /api\('studentAlerts',\{staffId:USER\.staffId,role:USER\.role\}\)/.test(app));
ok_('🎂 is drawn ON the calendar day', /bdayByDay\[dd\]/.test(app) && /🎂 \$\{bd\.length===1/.test(app));
ok_('…and the legend says what it means', /🎂 วันเกิด/.test(app));
ok_('a birthday summary sits under the calendar', /<div id="bdayCard">/.test(app) && /function birthdayCard\(al\)/.test(app));
ok_('…and the DSPM list under that', /<div id="dspmDueCard">/.test(app) && /function dspmDueCard\(al\)/.test(app));
ok_('the birthdays follow the calendar arrows', /window\.CAL_birthdays=async\(\)=>/.test(app) && /if\(document\.getElementById\('bdayCard'\)\) CAL_birthdays\(\)/.test(app));
ok_('…without refetching a month it already has', /if\(window\._SALERTS && window\._SALERTS\.month===month\)/.test(app));
ok_('the calendar only marks birthdays belonging to the month on screen',
  /_al\.month===`\$\{y\}-\$\{String\(mo\+1\)\.padStart\(2,'0'\)\}`/.test(app));
ok_('a day that has passed is faded rather than removed', /past\?' style="opacity:\.5"':''/.test(app));

console.log('\n=== 5. the teacher sees it after the name ===');
ok_('the class screen fetches the alerts', /api\('studentAlerts',\{staffId:USER\.staffId,role:USER\.role\}\)\.catch\(\(\)=>null\)/.test(app));
ok_('…keyed by student for the row renderers', /function setAlerts\(al\)/.test(app) && /const dspmDueOf = sid => DSPM_DUE\[sid\]/.test(app));
ok_('the badge sits right after the child’s name on the class screen',
  /<b>\$\{esc\(dispNick\(s\)\)\}<\/b> \$\{due\?dspmDueBadge\(due\):''\}/.test(app));
ok_('…and on the home list too', /<b>\$\{esc\(dispNick\(s\)\)\}<\/b> \$\{dueA\?dspmDueBadge\(dueA\):''\}/.test(app));
ok_('the badge names the band, not just "due"', /📝 \$\{esc\(k\.band\)\} \$\{EN\(\)\?'mo':'เดือน'\}/.test(app));
ok_('…and shows progress once some items are answered', /\$\{k\.done\?` · \$\{k\.done\}\/\$\{k\.total\}`:''\}/.test(app));
ok_('the teacher gets the birthday card too', (app.match(/\$\{birthdayCard\(al\)\}/g) || []).length === 2);
ok_('an empty list draws nothing at all',
  /const list=\(al&&al\.birthdays\)\|\|\[\]; if\(!list\.length\) return '';/.test(app) &&
  /const list=\(al&&al\.dspmDue\)\|\|\[\]; if\(!list\.length\) return '';/.test(app));

console.log('\n=== 6. nothing else moved ===');
{
  const { H } = boot();
  ok_('the class list still works', (H.classList({ staffId: 'T1' }).students || []).length === 2);
  ok_('dspmStatus still answers for one child', !!H.dspmStatus({ studentId: 'S1' }).items);
  eq('…with the band’s items', H.dspmStatus({ studentId: 'S1' }).items.length, 2);
}
ok_('the leave calendar still shows absences', /EN\(\)\?'absent':'ขาด'\} \$\{n\}/.test(app));

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
