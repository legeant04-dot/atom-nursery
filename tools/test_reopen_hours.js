/**
 * tools/test_reopen_hours.js — the school opens at noon, and nobody is late.
 *   node tools/test_reopen_hours.js
 *
 * A half-day holiday "07:00–12:00" shuts the school until noon. Everything that measured lateness
 * measured it against the teacher's normal 08:00, so the first person through the door at 12:00 was
 * recorded 240 minutes late — and attendanceEligible_ (Payroll.gs) drops the WHOLE month's เบี้ยขยัน
 * on a single late minute. ฿500, for arriving the moment the gate opened.
 *
 * The school's rule, 2026-08-18:
 *   - work starts at the END of the holiday window, when that window covers the normal start
 *   - work finishes at the person's OWN time, and OT still runs from that same time
 *   - a window that swallows the whole shift is a day off — no late mark, no absence
 *   - clocking OUT is never refused (an afternoon closure used to trap everyone already at work)
 *   - the reopening is forgiving by WINDOW minutes each way, so 11:58 need not wait and 12:01 is not
 *     a ฿500 mistake
 *
 * The point of this file is not the arithmetic — it is that there is now ONE piece of arithmetic.
 * Five places used to answer "what hours does this person work today" for themselves, and Big
 * Cleaning was already special-cased in some and not others.
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
const eng = R('webapp/engine.js'), app = R('webapp/app.js'), ci = R('src/Checkin.gs'), ar = R('src/AttReq.gs'), cfgs = R('src/Config.gs');

// the pure rule, run on its own — no sheets, no M, which is exactly why GAS and the engine can share it
const RULE = (() => { const c = { console }; vm.createContext(c); vm.runInContext(eng, c); return c.atomStaffHours_; })();
const SHIFT = { checkIn: '08:00', checkOut: '17:00', grace: 0, window: 15 };
const on = o => RULE(Object.assign({}, SHIFT, o));

console.log('\n1) the case the school gave: หยุด 07:00–12:00, กะ 08:00–17:00');
{
  const h = on({ holStart: '07:00', holEnd: '12:00' });
  eq('work starts when the school opens', h.checkIn, '12:00');
  eq('...and finishes at the person\'s own time, untouched', h.checkOut, '17:00');
  eq('the day is flagged as a reopening, so a screen can say so', h.reopened, true);
  eq('clocking in opens 15 minutes early — nobody waits at the gate', h.openFrom, '11:45');
  eq('...and 15 minutes are forgiven after, so 12:01 is not a ฿500 mistake', h.grace, 15);
  eq('it is not a day off — there is a shift to work', h.dayOff, false);
}
{
  // what the check-in will actually record, with the grace applied
  const h = on({ holStart: '07:00', holEnd: '12:00' });
  const late = t => { const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const e = Number(h.checkIn.slice(0, 2)) * 60 + Number(h.checkIn.slice(3));
    return Math.max(0, m - (e + h.grace)); };
  eq('11:50 (before the school opens) — not late', late('11:50'), 0);
  eq('12:00 — not late', late('12:00'), 0);
  eq('12:01 — NOT late, which is the whole point', late('12:01'), 0);
  eq('12:15 — still inside the window', late('12:15'), 0);
  eq('12:30 — late, and honestly so', late('12:30'), 15);
  // and the number that used to appear
  eq('the old answer would have been 240+ minutes', Math.max(0, 12 * 60 - (8 * 60 + 0)), 240);
}

console.log('\n2) a window that does NOT cover the start leaves the day alone');
{
  eq('an afternoon closure does not move the morning start',
    [on({ holStart: '13:00', holEnd: '15:00' }).checkIn, on({ holStart: '13:00', holEnd: '15:00' }).reopened], ['08:00', false]);
  eq('a window that ends BEFORE the shift starts changes nothing',
    on({ holStart: '05:00', holEnd: '07:00' }).checkIn, '08:00');
  eq('a closure at the end of the day does not shorten the shift (OT still runs from 17:00)',
    on({ holStart: '13:00', holEnd: '17:00' }).checkOut, '17:00');
  eq('no holiday at all — the plain shift', [on({}).checkIn, on({}).checkOut, on({}).reopened], ['08:00', '17:00', false]);
  eq('a WHOLE-day holiday (both times blank) is not this rule\'s business — nobody works',
    on({ holStart: '', holEnd: '' }).reopened, false);
}

console.log('\n3) a window that swallows the whole shift is a day off');
{
  const h = on({ holStart: '08:00', holEnd: '17:00' });
  eq('flagged as a day off', h.dayOff, true);
  const h2 = on({ holStart: '07:00', holEnd: '18:00' });
  eq('...and so is one that more than covers it', h2.dayOff, true);
  const h3 = on({ holStart: '07:00', holEnd: '16:59' });
  eq('one minute short of the end is NOT a day off — there is still work to do', h3.dayOff, false);
}

console.log('\n4) Big Cleaning still wins, and the two rules compose');
{
  const bc = { bigCleaning: true, bigCleanIn: '08:30', bigCleanOut: '17:00' };
  eq('a meeting day is worked to its own hours', [on(bc).checkIn, on(bc).checkOut], ['08:30', '17:00']);
  const both = on(Object.assign({}, bc, { holStart: '07:00', holEnd: '12:00' }));
  eq('...and a reopening on the same day still moves the start', [both.checkIn, both.checkOut, both.reopened], ['12:00', '17:00', true]);
}

console.log('\n5) the school\'s own numbers, and a school that turns the window off');
{
  eq('window 0 — opens exactly on time, no forgiveness',
    [on({ holStart: '07:00', holEnd: '12:00', window: 0 }).openFrom, on({ holStart: '07:00', holEnd: '12:00', window: 0 }).grace], ['12:00', 0]);
  eq('a school with a 30-minute normal grace keeps it if it is the larger',
    on({ holStart: '07:00', holEnd: '12:00', grace: 30 }).grace, 30);
  eq('...and an unset window falls back to 15', on({ holStart: '07:00', holEnd: '12:00', window: null }).grace, 15);
  eq('a shift that is not set at all still answers', [RULE({}).checkIn, RULE({}).checkOut], ['08:00', '17:00']);
  eq('a damaged time cell (an 1899 Date from Sheets) does not become midnight',
    RULE({ checkIn: new Date('1899-12-30T08:00:00'), checkOut: '17:00' }).checkIn, '08:00');
}

console.log('\n6) ONE rule — every place that used to have its own now asks it');
{
  ok_('the rule is a single pure function', /^function atomStaffHours_\(o\) \{/m.test(eng));
  ok_('...at the top level, so Apps Script sees it as a global', eng.indexOf('function atomStaffHours_') < eng.indexOf('function createAtomAPI'));
  ok_('...and it touches no sheets and no M', !/\bM\.[a-z]/.test(eng.slice(eng.indexOf('function atomStaffHours_'), eng.indexOf('function createAtomAPI'))));
  ok_('GAS gathers the facts in one place too', /function staffDayHours_\(staffId, date\)/.test(ci));
  ok_('staff CHECK-IN asks it', /var hrs = staffDayHours_\(staff\.StaffID, now\);/.test(ci));
  ok_('staff CHECK-OUT asks it for the end time', /var outHHmm = staffDayHours_\(staff\.StaffID, now\)\.checkOut;/.test(ci));
  ok_('the recompute tool asks it', /var hrs = staffDayHours_\(r\.StaffID, new Date\(\)\);/.test(ci));
  ok_('approving a back-dated request asks it FOR THAT DATE', /staffDayHours_\(req\.StaffID, new Date\(date \+ 'T00:00:00'\)\)/.test(ar));
  ok_('the engine gathers them once as well', /function staffHoursOn_\(staffId, date\)\{/.test(eng));
  ok_('the teacher\'s own history card no longer re-measures against today\'s shift',
    /const lateOf=\(hhmm,onDate\)=>\{ if\(!hhmm\)return 0; const h=staffHoursOn_\(p\.staffId,onDate\);/.test(eng));
  // the old copies must be gone, or one of them will quietly disagree again
  ok_('no check-in computes its own Big Cleaning start any more', !/var expectHHmm = isBigCleaningDay_\(today\)/.test(ci));
  ok_('...and neither does the request approval', !/var expectHHmm = isBigCleaningDay_\(date\)/.test(ar));
  ok_('...nor the engine check-in', !/const bc=isBigCleaning_\(todayLocal\(\)\); const inT=bc\?/.test(eng));
}

console.log('\n6b) what "grace" MEANS — the two engines disagreed, and it was hidden by a zero');
{
  /* Apps Script subtracted it (late = arrival − (start + grace)); the shared engine treated it as a
   * threshold (over the grace → the WHOLE overrun counts). With the school's grace at 0 the two
   * agreed exactly, so nothing ever showed. Giving a reopening 15 minutes would have made them
   * differ BY the grace — on the rows that decide a month's เบี้ยขยัน. Subtraction wins: it is what
   * has been writing the live sheet. */
  // v257: both now short-circuit to 0 on an OT วันหยุด day (a holiday has no shift to be late for),
  // and subtract the grace on every other day exactly as before
  ok_('Apps Script subtracts the grace', /var lateMin = holOT \? 0 : Math\.max\(0, minOfDay_\(now\) - \(expectMin \+ hrs\.grace\)\);/.test(ci));
  ok_('...and so does the engine now', /const late=holOT\?0:Math\.max\(0, raw-hrs\.grace\);/.test(eng));
  ok_('...and the history card', /return Math\.max\(0, raw-h\.grace\);/.test(eng));
  ok_('no threshold form is left anywhere', !/raw<=hrs\.grace\?0:raw/.test(eng) && !/raw<=h\.grace\?0:raw/.test(eng));
  ok_('the reason is written down where the next person will look', /Grace is SUBTRACTED, not a threshold/.test(eng));
}

console.log('\n7) clocking out is never refused; clocking in opens early only for STAFF');
{
  ok_('the check-out guard is gone, with the reason written down',
    /Clocking OUT is never refused, on any day/.test(ci) && !/assertSchoolOpen_\(\);\s*\n\s*var dist = assertWithinGeofence_\(payload\.lat, payload\.lng, payload\.acc\);\s*\n\s*var now = new Date\(\), today = dateStr_\(now\);\s*\n\s*var sheet = sheet_\(getHrSpreadsheet_\(\), 'CHECKIN_STAFF'\);\s*\n\s*\n\s*var row/.test(ci));
  ok_('...in the engine too', /staffCheckout: p => \{ const d=geo/.test(eng));
  ok_('the early opening is a STAFF-only door', /function assertSchoolOpen_\(d, forStudents, openFrom\)/.test(ci) && /if \(!forStudents && openFrom &&/.test(ci));
  ok_('...and the engine guard agrees', /function assertSchoolOpen_\(date, forStudents, openFrom\)\{/.test(eng) && /if\(!forStudents && openFrom &&/.test(eng));
  ok_('a full day off refuses the check-in with a reason a person can read',
    /วันนี้เป็นวันหยุดของโรงเรียน — ไม่ต้องลงเวลา/.test(ci));
  ok_('children are NOT let in early — their side keeps the original condition',
    /Students are never\s*\n \* let in early/.test(ci));
}

console.log('\n8) the school can change the window, and the teacher can see the day');
{
  ok_('the window is a school setting, not a number in the code', /\['HolidayReopenWindowMinutes', '15'\]/.test(cfgs));
  ok_('...with the ฿500 it protects written next to it', /เบี้ยขยัน/.test(cfgs) && /attendanceEligible_ drops it on a single late minute/.test(cfgs));
  ok_('the teacher\'s clock card says when work starts today', /hrs0 && hrs0\.reopened/.test(app) && /วันนี้โรงเรียนหยุดช่วงแรก/.test(app));
  ok_('...and when they may clock in', /ลงเวลาได้ตั้งแต่ \$\{esc\(hrs0\.openFrom\)\}/.test(app));
  ok_('...and that OT is unchanged', /OT ยังคิดจาก \$\{esc\(hrs0\.checkOut\)\} ตามเดิม/.test(app));
  ok_('a full day off says so instead of showing an empty clock', /วันนี้เป็นวันหยุด — ไม่ต้องลงเวลา/.test(app));
  ok_('the server sends the hours, the card only prints them', /hours:h, checkIn:r\?r\.CheckIn/.test(eng));
}

console.log('\n9) end to end, through the engine handlers');
{
  const DAY = '2026-08-19';   // a Wednesday
  function boot(nowISO, holidays) {
    const M = {
      config: { Plans: [], LeaveQuota: {}, BigCleaningDays: [], LateGraceMinutes: 0, HolidayReopenWindowMinutes: 15,
        DefaultCheckInTime: '08:00', DefaultCheckOutTime: '17:00', GPS_Lat: 0, GPS_Lng: 0, Radius: 100000, OTRoundUpMinutes: 50 },
      holidays: holidays || [],
      staff: [{ StaffID: 'STF-001', NameTH: 'ครูเอ', StaffGroup: 'ATMG-01', StartDate: '2020-01-01', Status: 'ACTIVE' }],
      staffGroups: [{ GroupName: 'ATMG-01', CheckInTime: '08:00', CheckOutTime: '17:00' }],
      workSchedule: [], staffAttendanceToday: [], staffAttendanceHistory: [],
      students: [], parents: [], userLinks: [], classes: [], leaves: [], payments: [], otDaily: [],
      studentCharges: [], prepayments: [], paymentSlips: [], checkinStudent: [], studentCheckins: [],
      journals: [], comments: [], payroll: [], payrollConfig: {}, studentLeaves: [], absenceLog: [],
      dspmCriteria: [], activityLog: [], announcements: [], notifications: [], vaccines: [], growth: [],
      growthRecords: [], assessments: [], classChanges: [], timeRequests: [], adminInbox: [], foodMenus: [],
      foodItems: [], surveys: [], surveyResponses: [], injuries: [], insurance: [], bigCleaning: [],
      departments: [], permissions: {}, feed: [], calendar: [], studentAttendanceToday: [], otRecords: []
    };
    const at = new Date(nowISO);
    class FakeDate extends Date {
      constructor(...a) { if (!a.length) super(at.getTime()); else super(...a); }
      static now() { return at.getTime(); }
    }
    const ctx = { window: {}, console, Date: FakeDate, JSON, Math, Object, Array, String, Number, isFinite, parseInt, parseFloat, RegExp, Error };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(eng, ctx);
    return ctx.createAtomAPI(M, {});
  }
  const HALF = [{ Date: DAY, NameTH: 'ซ้อมดับเพลิง', StartTime: '07:00', EndTime: '12:00' }];

  { const { H } = boot(DAY + 'T12:01:00', HALF);
    const r = H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 });
    eq('12:01 on a reopening day: checked in, not late', [r.time, r.lateMinutes], ['12:01', 0]); }
  { const { H } = boot(DAY + 'T11:50:00', HALF);
    const r = H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 });
    eq('11:50 — the door is already open, and it is not late', [r.time, r.lateMinutes], ['11:50', 0]); }
  { const { H } = boot(DAY + 'T11:30:00', HALF);
    throws_('11:30 — too early, the school is still shut', () => H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 }), 'หยุด'); }
  { const { H } = boot(DAY + 'T12:40:00', HALF);
    const r = H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 });
    eq('12:40 — genuinely late, by 25 minutes', r.lateMinutes, 25); }
  { const { H } = boot(DAY + 'T18:00:00', HALF);
    H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 });   // (late, but that is not what this checks)
    const r = H.staffCheckout({ staffId: 'STF-001', lat: 0, lng: 0 });
    eq('OT still runs from 17:00, the person\'s own end time', [r.otMinutes, r.otHours], [60, 1]); }
  { // an afternoon closure: at work since the morning, going home when the school shuts
    const { H } = boot(DAY + 'T14:00:00', [{ Date: DAY, NameTH: 'ปิดบ่าย', StartTime: '13:00', EndTime: '17:00' }]);
    H.staffAttendanceTodaySeed = null;
    const M2 = H; // (the handler creates the row itself)
    throws_('...checking IN during the closure is still refused', () => M2.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 }), 'หยุด');
  }
  { const { H } = boot(DAY + 'T09:00:00', [{ Date: DAY, NameTH: 'ปิดบ่าย', StartTime: '13:00', EndTime: '17:00' }]);
    H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 });
    const { H: H2 } = boot(DAY + 'T13:05:00', [{ Date: DAY, NameTH: 'ปิดบ่าย', StartTime: '13:00', EndTime: '17:00' }]);
    // a fresh boot cannot carry the morning's row, so this only proves the guard is gone from checkout
    let msg = null; try { H2.staffCheckout({ staffId: 'STF-001', lat: 0, lng: 0 }); } catch (e) { msg = String(e.message || e); }
    ok_('...but checking OUT is refused only for "not checked in", never for the closure',
      msg === null || msg.indexOf('ยังไม่ได้ลงเวลาเข้างาน') >= 0);
  }
  { const { H } = boot(DAY + 'T17:30:00', [{ Date: DAY, NameTH: 'หยุดทั้งกะ', StartTime: '08:00', EndTime: '17:00' }]);
    throws_('a window that swallows the shift: told it is a day off, not asked to clock in',
      () => H.staffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 }), 'วันหยุด'); }
  { const { H } = boot(DAY + 'T12:01:00', HALF);
    const a = H.myAttendanceToday({ staffId: 'STF-001' });
    eq('the teacher\'s card is told today\'s hours, not the roster\'s',
      [a.hours.checkIn, a.hours.checkOut, a.hours.openFrom, a.schedule.CheckInTime], ['12:00', '17:00', '11:45', '12:00']); }
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
