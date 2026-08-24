/**
 * tools/test_own_time_only.js — whose working time is 📅 ตาราง about?
 *   node tools/test_own_time_only.js
 *
 * REPORTED 2026-08-24: "การแสดงสรุปข้อมูลของคุณครูแสดงคำว่า OUT ไม่ถูกต้อง เพราะเวลาที่แสดงเป็นเวลา
 * เข้างาน ให้แสดงเวลาเหมือนกับหน้าหลัก Admin และแสดงเฉพาะหัวหน้าครูและ Admin เท่านั้น Role อื่นไม่แสดง
 * ให้เห็น คุณครูเห็นเฉพาะเวลาเข้าออกของตัวเอง และเอาข้อมูลการลาของพนักงานคนอื่นออก ลบหัวข้อสรุปรายวัน
 * ออกจาก Role คุณครู"
 *
 * Two separate faults, and the second is the serious one:
 *
 *  1. THE LABEL LIED. The row printed the STATUS followed by the CHECK-IN time — "OUT 06:47" — so
 *     the word said the person had gone home and the number was the moment they arrived. Nobody
 *     reading it could tell what time anyone actually left.
 *
 *  2. IT WAS EVERYBODY'S DAY, FOR EVERYBODY. `schedule` took no payload at all, so any teacher who
 *     opened the screen was sent the whole staff's arrivals, departures and approved leave. The
 *     school's answer: a person's working time is between them, the head teacher and the admin.
 *     Fixed in the ENGINE, not on the screen — hiding a card still ships the data to the device it
 *     was hidden on. The network tab is not a permission model.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js');

function boot() {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], Departments: 'Nursery 1,Nursery 2' },
    staff: [
      { StaffID: 'T1', NameTH: 'ครูจอย', Nickname: 'จอย', Role: 'Teacher', Department: 'Nursery 1', Status: 'ACTIVE', RequireCheckin: true },
      { StaffID: 'T2', NameTH: 'ครูก้อย', Nickname: 'ก้อย', Role: 'Teacher', Department: 'Nursery 2', Status: 'ACTIVE', RequireCheckin: true },
      { StaffID: 'HEAD', NameTH: 'หัวหน้าครู', Nickname: 'หัวหน้า', Role: 'Teacher', Department: '*', Status: 'ACTIVE', RequireCheckin: true },
      { StaffID: 'ADM', NameTH: 'แอดมิน', Nickname: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin', Status: 'ACTIVE', RequireCheckin: false }
    ],
    staffAttendanceToday: [
      { StaffID: 'T1', CheckIn: '06:47', CheckOut: '19:08', Status: 'OUT', Late: 0 },
      { StaffID: 'T2', CheckIn: '08:20', CheckOut: '', Status: 'IN', Late: 20 }
    ],
    staffAttendanceHistory: [
      { Date: '2026-08-20', StaffID: 'T1', In: '06:59', Out: '19:05', Late: 0 },
      { Date: '2026-08-20', StaffID: 'T2', In: '07:02', Out: '18:57', Late: 0 }
    ],
    leaves: [
      { LeaveID: 'L1', StaffID: 'T2', Status: 'APPROVED', Type: 'ลาป่วย', StartDate: '2026-08-25', EndDate: '2026-08-25' },
      { LeaveID: 'L2', StaffID: 'T1', Status: 'APPROVED', Type: 'ลากิจ', StartDate: '2026-08-26', EndDate: '2026-08-26' }
    ],
    workSchedule: [{ StaffID: 'T1', DayOfWeek: 'Mon', CheckInTime: '07:00' }, { StaffID: 'T2', DayOfWeek: 'Mon', CheckInTime: '07:00' }],
    holidays: [], students: [], classes: [], parents: [], userLinks: [], payments: [], studentCharges: [],
    prepayments: [], otDaily: [], paymentSlips: [], otRecords: [], payroll: [], payrollConfig: {},
    checkinStudent: [], studentCheckins: [], studentAttendanceToday: [], studentLeaves: [], journals: [],
    comments: [], staffGroups: [], absenceLog: [], dspmCriteria: [], activityLog: [], announcements: [],
    notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [], classChanges: [],
    timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [], surveyResponses: [],
    injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {}, feed: [], calendar: [],
    holidayAttend: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error, Set };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
  return ctx.createAtomAPI(M, {}).H;
}
const H = boot();
const ids = list => (list || []).map(x => x.StaffID).sort();

console.log('\n1) a plain teacher is sent their own time, and nothing else');
{
  const d = H.schedule({ staffId: 'T1' });
  eq('the answer says which kind it is', d.canSeeAll, false);
  eq('today\'s attendance is hers alone', ids(d.attendance), ['T1']);
  // v270: today's own punch is folded into `history` too — hydration keeps "today" in a separate
  // collection, so the calendar used to draw a blank square for the day somebody had just clocked in
  eq('...so is the history behind the calendar', [...new Set(ids(d.history))], ['T1']);
  eq('...and today is IN it, not missing from it',
    d.history.some(h => String(h.Date).slice(0, 10) === new Date().toISOString().slice(0, 10) && h.In === '06:47'), true);
  eq('...and the approved leave is hers, not the staff\'s', ids(d.leavesToday), ['T1']);
  eq('...the directory does not name her colleagues either', ids(d.staff), ['T1']);
  eq('...nor does her own roster leak anyone else\'s', ids(d.schedule), ['T1']);
  eq('a staffing ratio is a fact about other people', d.staffing, []);
}

console.log('\n2) the head teacher and the admin see the school');
{
  const h = H.schedule({ staffId: 'HEAD' });
  eq('a head teacher (Department "*") sees everyone', [h.canSeeAll, ids(h.attendance)], [true, ['T1', 'T2']]);
  eq('...and the leave they have to cover for', ids(h.leavesToday), ['T1', 'T2']);
  const a = H.schedule({ staffId: 'ADM' });
  eq('so does the admin', [a.canSeeAll, ids(a.attendance)], [true, ['T1', 'T2']]);
}
{
  // ...and an unknown caller is treated as a stranger, not as an admin. staffById returns {} for an
  // id it does not know, so a truthiness test here would have opened the whole staff's day.
  const x = H.schedule({ staffId: 'NOPE' });
  eq('an unknown id sees nothing', [x.canSeeAll, x.attendance.length, x.leavesToday.length], [false, 0, 0]);
  const y = H.schedule({});
  eq('...and so does a call with no id at all', [y.canSeeAll, y.attendance.length], [false, 0]);
}

console.log('\n3) "OUT 06:47" is gone');
{
  const sched = app.slice(app.indexOf('SCREENS.Teacher.schedule = async () => {'), app.indexOf('let MY_DAYS=[]'));
  ok_('the row prints in–out, like the Admin dashboard', /_i\+'–'\+_o/.test(sched));
  ok_('...and never the status followed by the arrival time',
    !/a\.Status\+\(a\.CheckIn\?' '\+a\.CheckIn:''\)/.test(app));
  ok_('a day with no clock-in says so instead of showing a blank', /ยังไม่ลงเวลา/.test(sched));
  ok_('the daily summary is drawn only when the server says so', /\$\{d\.canSeeAll\?`<div class="card"><h3>📋/.test(sched));
  ok_('...and a plain teacher gets their own times in its place', /เวลาของฉันวันนี้/.test(sched));
  ok_('the screen tells the server who is asking', /api\('schedule',\{staffId:USER\.staffId\}\)/.test(app));
  ok_('...and so does the login warm-up, or it would cache the wrong answer',
    /\['schedule',\{staffId:USER\.staffId\}\]/.test(app));
  /* v270: the legend describes the calendar the reader is actually looking at. A plain teacher's is
   * her own times and her own leave; a head teacher's is COVER — who is away and what kind of leave
   * — with the clock-in times left to the daily summary, because printing both put five lines into
   * a cell the size of a stamp and none of it could be read. */
  ok_('a teacher\'s legend promises only her own', /↓เข้า ↑ออก \(ของคุณ\) · 🏠 วันลาของคุณ/.test(app));
  ok_('...and a head teacher\'s says what it is for', /ใครลาวันไหน และลาประเภทอะไร/.test(app));
  ok_('...and where the times went', /เวลาเข้า-ออกดูได้ที่สรุปรายวันด้านบน/.test(app));
}

console.log('\n4) "head teacher" is one rule, in one place');
{
  ok_('there is a helper', /const headTeacher_ = s => String\(\(s&&s\.Department\)\|\|''\)===\'\*\';/.test(eng));
  // comments still SAY `String(me.Department||'')==='*'` when explaining what the helper means —
  // strip them, or this check fails on its own documentation
  const code = eng.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok_('...and the copies it replaced are gone',
    (code.match(/String\(me\.Department\|\|''\)==='\*'/g) || []).length === 0);
  /* A FLOOR, not an exact count. This was pinned at 3 and failed the moment the rule was reused a
   * fourth time (the student record, v266) — which is the behaviour the helper exists to encourage.
   * What must never grow is the number of INLINE copies, and that is the check above. */
  ok_('every call site goes through it', (code.match(/headTeacher_\(/g) || []).length >= 3);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
