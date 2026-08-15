/**
 * tools/test_meeting_rename.js — the staff's extra workday is called a MEETING on screen, and the
 * data underneath it did not move.
 *   node tools/test_meeting_rename.js
 *
 * Asked for on 2026-08-15: "Big Cleaning" reads badly on a nursery's calendar, which parents see.
 *
 * The danger in a rename is not the words. It is that renaming the LABEL and renaming the DATA look
 * like the same job: SCHOOL_CONFIG holds BigCleaningDays / BigCleaningIn / BigCleaningOut /
 * BigCleaningAmount, and the routes are addBigCleaning / removeBigCleaning / bigCleaningDays. Touch
 * any of those and every date the school has already entered — and the bonus already paid against
 * them — stops being found. So: every visible string changes, every key stays, and the label lives
 * in ONE place so the next rename cannot miss a screen.
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
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), i18n = R('webapp/i18n.js'),
      notify = R('src/Notify.gs'), checkin = R('src/Checkin.gs'), cfgGs = R('src/Config.gs');

console.log('\n1) one name and one icon, in one place');
{
  ok_('the icon is a constant', /const BC_ICON  = '👥';/.test(app));
  ok_('the full name is a constant', /const BC_NAME  = \(\) => EN\(\)\?'Meeting day':'วันประชุม';/.test(app));
  ok_('...and the short one, for a pill', /const BC_SHORT = \(\) => EN\(\)\?'Meeting':'ประชุม';/.test(app));
  ok_('the reason for the rename is written down where the constants are', /renaming live data to\n\s+\* relabel a screen is how a term's records go missing/.test(app));
  // the whole point: nothing spells it out for itself any more
  const strings = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  eq('no screen writes "Big Cleaning" itself', (strings.match(/Big Cleaning/g) || []).length, 0);
  eq('...and the broom is gone from every calendar and card', (strings.match(/🧹/g) || []).length, 3);
  ok_('the three brooms left are the unrelated ones — clearing duplicates and the perf log',
    /🧹 \$\{esc\(t\('dedup\.title'\)\)\}/.test(app) && /\['🧹',t\('dedup\.title'\)/.test(app) && /A_perfClear\(this\)">🧹/.test(app));
}

console.log('\n2) every screen that showed the old name now shows the new one');
{
  ok_('the teacher\'s clock card', /\$\{BC_ICON\} <b>\$\{BC_NAME\(\)\}<\/b>/.test(app));
  ok_('the Admin dashboard banner', /\$\{BC_NAME\(\)\} — พนักงานทำงาน/.test(app));
  ok_('the staff-today pill', /\$\{BC_ICON\} \$\{BC_SHORT\(\)\}<\/span>/.test(app));
  ok_('the admin screen that sets the days', /<h3>\$\{BC_ICON\} \$\{BC_NAME\(\)\}<\/h3>/.test(app));
  ok_('...and each date in its list', /<span>\$\{BC_ICON\} \$\{esc\(ddmmyyyy\(d\)\)\}<\/span>/.test(app));
  ok_('the settings screen that points at it', /\$\{BC_ICON\} \$\{EN\(\)\?'Meeting days moved to':'วันประชุมย้ายไปที่'\}/.test(app));
  ok_('the morning-digest checkbox', /Morning digest 10:00 \(\$\{BC_NAME\(\)\} \+ pending\)/.test(app));
  ok_('the menu entry', /'manage\.holidays':\['วันหยุด \/ วันประชุม','Holidays \/ Meetings'\]/.test(i18n));
  // four calendars draw the day; all four must use the constant, or one keeps a broom
  eq('every calendar marks the day with the shared icon', (app.match(/BC_ICON/g) || []).length >= 10, true);
  ok_('...including the three legends underneath them',
    (app.match(/\$\{BC_ICON\} meeting/g) || []).length + (app.match(/\$\{BC_ICON\} ประชุม/g) || []).length >= 5);
  ok_('the calendar entry the server sends is renamed too', /title:'วันประชุม 👥',titleEN:'Meeting day 👥'/.test(eng));
  ok_('and the 10:00 LINE digest says meeting, not cleaning', /lines\.push\('👥 วันนี้เป็นวันประชุม'\)/.test(notify));
  ok_('nothing user-facing in the engine still says it', !/Big Cleaning Day 🧹/.test(eng));
}

console.log('\n3) the DATA did not move — this is the half that could lose a term of records');
{
  ok_('the config keys are untouched', /BigCleaningDays/.test(checkin) && /BigCleaningIn/.test(app) && /BigCleaningOut/.test(app) && /BigCleaningAmount/.test(app));
  ok_('...and so are the routes the screens call', /api\('bigCleaningDays'\)/.test(app) && /api\('addBigCleaning'/.test(app) && /api\('removeBigCleaning'/.test(app));
  ok_('the server still answers under those names', /bigCleaningDays: \(\) =>/.test(eng) && /addBigCleaning: p =>/.test(eng) && /removeBigCleaning: p =>/.test(eng));
  ok_('the flag on every answer is still bigCleaning', /bigCleaning:bc/.test(eng));
  ok_('the calendar entry type is unchanged, so filters still match', /type:'bigclean'/.test(eng));
}
{
  // and it still WORKS: a date entered under the old name is still a working day with its own hours
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: ['2026-08-15'], BigCleaningIn: '09:00', BigCleaningOut: '15:00', BigCleaningAmount: 300 },
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    holidays: [], staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: [], otRecords: []
  };
  const ctx = { window: {}, console, Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(R('webapp/engine.js'), ctx);
  const H = ctx.createAtomAPI(M, {}).H;
  const day = H.schoolDay({ date: '2026-08-15' });
  eq('a Saturday already in the config is still a working day for the staff', day.closed, false);
  eq('...still shut to the children', day.closedForStudents, true);
  eq('...and still runs to the hours that were saved for it', [day.bcIn, day.bcOut], ['09:00', '15:00']);
  eq('the days list still reads back', H.bigCleaningDays().days, ['2026-08-15']);
  eq('...with its bonus', H.bigCleaningDays().amount, 300);
  const ev = H.calendar().find(e => e.type === 'bigclean') || {};
  eq('the calendar prints the new name for the old date', [ev.title, ev.titleEN], ['วันประชุม 👥', 'Meeting day 👥']);
  H.addBigCleaning({ date: '2026-09-19' });
  eq('adding a day still works', H.bigCleaningDays().days, ['2026-08-15', '2026-09-19']);
  H.removeBigCleaning({ date: '2026-08-15' });
  eq('...and removing one', H.bigCleaningDays().days, ['2026-09-19']);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
