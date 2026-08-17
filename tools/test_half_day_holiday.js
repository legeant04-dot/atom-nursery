/**
 * tools/test_half_day_holiday.js — a holiday can be HALF a day.
 *   node tools/test_half_day_holiday.js
 *
 * Asked for: "19/08/2026 08:00–12:30 is a school holiday — close check-in/out and show it on the
 * calendar, but only for that half of the day." Blank times keep meaning the whole day.
 *
 * Two things make this harder than it looks.
 *
 *   1. "Is the school closed?" stops being a fact about a DAY and becomes a fact about a MOMENT.
 *      Everything that asked the old question — the check-in guard, the parent's card, the teacher's
 *      clock card, the dashboard, the calendars — has to keep working, and a half-day must not read
 *      as a whole one. So schoolDayFor_ now answers BOTH: `closed` (shut right now) and
 *      `closedAllDay` (the whole day is off), plus the window itself for anything that draws it.
 *
 *   2. A time in a Sheets cell can come back as a Date on the 1899 epoch. Parsed carelessly that
 *      becomes 00:00 — which would turn a full-day holiday into one that ends at midnight, i.e.
 *      quietly open all day. Anything unreadable falls back to BLANK, meaning the whole day.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, want) {
  let msg = null; try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  const ok = msg !== null && (!want || msg.indexOf(want) >= 0);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '  got=' + JSON.stringify(msg)));
  ok ? pass++ : fail++;
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), eng = R('webapp/engine.js'), ci = R('src/Checkin.gs'), cfg = R('src/Config.gs'), i18n = R('webapp/i18n.js');

// 2026-08-19 is a Wednesday — an ordinary working day but for the holiday
const DAY = '2026-08-19';
function boot(holidays, nowISO) {
  const M = {
    config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [] },
    holidays: holidays || [],
    students: [], parents: [], userLinks: [], staff: [], leaves: [], payments: [], otDaily: [],
    studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], journals: [], comments: [],
    staffGroups: [], workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
    payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [], dspmCriteria: [], activityLog: [],
    announcements: [], notifications: [], vaccines: [], growth: [], growthRecords: [], assessments: [],
    classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [], foodItems: [], surveys: [],
    surveyResponses: [], injuries: [], insurance: [], bigCleaning: [], departments: [], permissions: {},
    feed: [], calendar: [], classes: [], studentAttendanceToday: [], studentCheckins: [], otRecords: []
  };
  const at = new Date(nowISO || (DAY + 'T09:00:00'));
  class FakeDate extends Date {
    constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
    static now() { return at.getTime(); }
  }
  const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(R('webapp/engine.js'), ctx);
  return { H: ctx.createAtomAPI(M, {}).H, M };
}
const HALF = [{ Date: DAY, NameTH: 'ซ้อมดับเพลิง', NameEN: 'Fire drill', StartTime: '08:00', EndTime: '12:30' }];
const FULL = [{ Date: DAY, NameTH: 'วันแม่แห่งชาติ', NameEN: "Mother's Day" }];
const day = (hols, when) => boot(hols, when).H.schoolDay({ date: DAY });

console.log('\n1) the window the school asked for: 19/08 08:00–12:30');
{
  eq('07:59 — still open, an ordinary morning', day(HALF, DAY + 'T07:59:00').closed, false);
  eq('08:00 — shut', day(HALF, DAY + 'T08:00:00').closed, true);
  eq('10:00 — shut', day(HALF, DAY + 'T10:00:00').closed, true);
  eq('12:30 — still shut, to the minute', day(HALF, DAY + 'T12:30:00').closed, true);
  eq('12:31 — open again', day(HALF, DAY + 'T12:31:00').closed, false);
  eq('16:00 — open', day(HALF, DAY + 'T16:00:00').closed, false);
  // the CHILDREN's half of the answer moves with it
  eq('...and the children are shut out for exactly the same window',
    [day(HALF, DAY + 'T09:00:00').closedForStudents, day(HALF, DAY + 'T13:00:00').closedForStudents], [true, false]);
}
{
  const d = day(HALF, DAY + 'T09:00:00');
  eq('it is flagged as a PART of the day, not the whole of it', [d.partial, d.closedAllDay], [true, false]);
  eq('...and reports the window, so a screen can print it', [d.holStart, d.holEnd], ['08:00', '12:30']);
  eq('the holiday is still named', d.reason, 'ซ้อมดับเพลิง');
  // at 16:00 the day is open, but the holiday is still a fact about that date
  const later = day(HALF, DAY + 'T16:00:00');
  eq('after the window it is open but the day is still named on the calendar', [later.closed, later.reason], [false, 'ซ้อมดับเพลิง']);
}

console.log('\n2) a holiday with no times behaves exactly as it always did');
{
  eq('early morning — shut', day(FULL, DAY + 'T00:30:00').closed, true);
  eq('midday — shut', day(FULL, DAY + 'T12:00:00').closed, true);
  eq('late evening — STILL shut, not reopened at midnight', day(FULL, DAY + 'T23:30:00').closed, true);
  eq('...and it says the whole day is off', day(FULL, DAY + 'T12:00:00').closedAllDay, true);
  eq('...with no window to draw', [day(FULL).partial, day(FULL).holStart, day(FULL).holEnd], [false, '', '']);
}
{
  // the trap: a Sheets time cell decoded as an 1899 Date must not become 00:00 and end the holiday
  const junk = [{ Date: DAY, NameTH: 'วันหยุด', StartTime: 'Sat Dec 30 1899 00:00:00', EndTime: 'Sat Dec 30 1899 00:00:00' }];
  eq('an unreadable time falls back to the WHOLE day', day(junk, DAY + 'T15:00:00').closed, true);
  eq('...and is not reported as a window', day(junk).partial, false);
}
{
  // half a window
  const fromOnly = [{ Date: DAY, NameTH: 'ปิดครึ่งบ่าย', StartTime: '13:00', EndTime: '' }];
  eq('a start with no end shuts from then to the end of the day', [day(fromOnly, DAY + 'T12:59:00').closed, day(fromOnly, DAY + 'T13:00:00').closed, day(fromOnly, DAY + 'T22:00:00').closed], [false, true, true]);
  const toOnly = [{ Date: DAY, NameTH: 'ปิดครึ่งเช้า', StartTime: '', EndTime: '12:00' }];
  eq('an end with no start shuts from midnight until then', [day(toOnly, DAY + 'T06:00:00').closed, day(toOnly, DAY + 'T12:00:00').closed, day(toOnly, DAY + 'T12:01:00').closed], [true, true, false]);
}
{
  // a weekend is a whole-day fact and no window applies to it
  const sat = boot([], '2026-08-15T09:00:00').H.schoolDay({ date: '2026-08-15' });
  eq('Saturday is shut all day, as before', [sat.closed, sat.closedAllDay, sat.partial], [true, true, false]);
}

console.log('\n3) EVERY role is refused during the window, and let through outside it');
{
  const { H } = boot(HALF, DAY + 'T09:00:00');
  throws_('the engine guard refuses a staff check-in during the window', () => H.staffCheckin({ staffId: 'S1' }), 'โรงเรียนหยุด');
  const open = boot(HALF, DAY + 'T13:00:00').H;
  let msg = null;
  try { open.staffCheckin({ staffId: 'S1' }); } catch (e) { msg = String(e.message || e); }
  ok_('...and does NOT refuse it after the window (it fails for another reason, or not at all)',
    msg === null || msg.indexOf('โรงเรียนหยุด') < 0);
}
{
  ok_('the one rule takes the time', /const schoolClosedFor_ = \(d, forStudents, atTime\) => \{/.test(eng));
  ok_('...and only refuses inside the window', /const inWindow=\(!hs\|\|now>=hs\)&&\(!he\|\|now<=he\);\s*\n\s*if\(!inWindow\) return null;/.test(eng));
  ok_('...saying WHICH hours, so the message is actionable', /return nm\+' '\+\(hs\|\|'00:00'\)\+'-'\+\(he\|\|'23:59'\);/.test(eng));
  // the GAS routes are what actually run
  ok_('the GAS guard reads the window too', /var hs2 = holTime_\(h\.StartTime\), he2 = holTime_\(h\.EndTime\);/.test(ci));
  ok_('...lets the check-in through outside it', /if \(!inWindow\) return;/.test(ci));
  ok_('...and has its own careful time parser', /function holTime_\(v\)/.test(ci) && /if \(v instanceof Date\)/.test(ci));
  ok_('the message now says "just now", not "today"', /ขณะนี้โรงเรียนหยุด/.test(ci));
  ok_('...and still distinguishes children from staff', /ไม่มีการรับ-ส่งนักเรียน[\s\S]{0,80}ไม่ต้องลงเวลา/.test(ci));
}

console.log('\n4) the calendar and the cards say "half a day", not "closed"');
{
  ok_('the columns exist', /'Recurring', 'StartTime', 'EndTime'\]/.test(cfg));
  ok_('the admin form has both time fields', /id="hStart"/.test(app) && /id="hEnd"/.test(app));
  ok_('...and sends them', /startTime:s,endTime:e\}\)/.test(app));
  ok_('an end before the start is refused before saving', /if\(s&&e&&e<s\)\{ toast/.test(app));
  ok_('the form explains what blank means', /'hol\.timeNote'/.test(app) && /เว้นเวลาว่างไว้ = หยุดทั้งวัน/.test(i18n));
  ok_('the saved holiday keeps blank as blank', /StartTime:cfgTime_\(p\.startTime,''\),EndTime:cfgTime_\(p\.endTime,''\)/.test(eng));

  ok_('one helper puts the window into words', /const holWindow = h =>/.test(app));
  ok_('...and one puts it next to the name', /const holLabel = h =>/.test(app));
  eq('every calendar draws the holiday through it', (app.match(/holByDay\[d\.getDate\(\)\]=holLabel\(h\);/g) || []).length, 3);
  ok_('the admin list badges the window', /🕘 \$\{esc\(holWindow\(h\)\)\}/.test(app));
  ok_('the parent card says "closed just now" for a half day', /window\._SCHOOLDAY\.partial\?\(EN\(\)\?'School closed just now':'ขณะนี้โรงเรียนหยุด'\)/.test(app));
  ok_('...and tells them the buttons come back', /หลังเวลานี้จะกลับมาใช้ปุ่มได้ตามปกติ/.test(app));
  ok_('the teacher clock card does the same', /day0\.partial\?\(EN\(\)\?'School closed just now':'ขณะนี้โรงเรียนหยุด'\)/.test(app));
  ok_('...and says clocking in comes back', /หลังเวลานี้ลงเวลาได้ตามปกติ/.test(app));
}
{
  // the dashboard/daily-report still read the same fields — a half-day must not blank the roll all day
  const at13 = boot(HALF, DAY + 'T13:00:00').H.dashboard();
  eq('at 13:00 the dashboard counts attendance again', (at13.day || {}).closedForStudents, false);
  const at9 = boot(HALF, DAY + 'T09:00:00').H.dashboard();
  eq('...and at 09:00 it shows the holiday', (at9.day || {}).closedForStudents, true);
  eq('...naming it', (at9.day || {}).reason, 'ซ้อมดับเพลิง');
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
