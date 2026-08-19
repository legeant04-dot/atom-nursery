/**
 * tools/test_reopen_live.js — the app said 12:00 and the server said 07:00, on the same holiday.
 *   node tools/test_reopen_live.js
 *
 * REPORTED 2026-08-19, live, with the school closed until noon:
 *
 *     the app showed   "วันนี้โรงเรียนหยุดช่วงแรก — เริ่มงาน 12:00 · ลงเวลาได้ตั้งแต่ 11:45"
 *     the server wrote  จอย 12:08 → สาย 308 นาที   (= 12:08 − 07:00, her plain shift)
 *                       ก้อย 12:04 → 304 · ฟิล์ม 12:11 → 311 · จำฉา 12:11 → 251
 *     and clocking in at 11:45 was refused.
 *
 * Both halves ran the same rule (atomStaffHours_) and got different answers, because they were fed
 * DIFFERENT TIMES for the same cell. A time-only cell comes back from Sheets as a Date on the 1899
 * epoch and someone has to format it: the engine does it in the SPREADSHEET's timezone (decodeCell_
 * → ssTz_), while holTime_ did it in the timezone from SCHOOL_CONFIG (tz_). While those two settings
 * agree nothing shows; the moment they differ, the server sees a window that does not cover the
 * morning — so no reopening, no early door, and lateness measured from the ordinary shift.
 *
 * The fix is not a third normalizer. The holiday row is decoded ONCE, by the engine's own decoder,
 * before anything on the Apps Script side looks at it.
 *
 * Note on the harness: its Utilities.formatDate ignores the timezone argument, so it cannot
 * reproduce the two-timezone SPLIT. What it can do — and what actually matters — is prove the
 * end-to-end outcome with a Date-valued cell: 12:08 on a reopening day is not late.
 */
const fs = require('fs'), path = require('path');
const H = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ci = R('src/Checkin.gs'), code = R('src/Code.gs'), app = R('webapp/app.js');

const { run } = H(['Config', 'Db', 'Audit', 'Engine', 'GasEngine', 'Checkin', 'Staff', 'Notify', 'Line']);
const res = JSON.parse(run(function () {
  // apiError_ lives in Code.gs, which this harness does not load (it is the whole dispatcher). Under
  // GAS every file shares one global scope, so the real one is always there.
  if (typeof apiError_ !== 'function') {
    apiError_ = function (code, msg) { var e = new Error(msg); e.apiCode = code; return e; };
  }
  var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
  PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
  PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
  var cfg = main.insertSheet('SCHOOL_CONFIG');
  cfg.appendRow(['Key', 'Value']);
  cfg.appendRow(['LateGraceMinutes', '0']);
  cfg.appendRow(['GPS_Lat', '0']); cfg.appendRow(['GPS_Lng', '0']); cfg.appendRow(['Radius', '999999']);

  // Joy: 07:00–18:00, exactly as live. The holiday runs 07:00–12:00 and its times are stored the way
  // Sheets really stores them — as Dates on the 1899 epoch, NOT as text.
  var st = hr.insertSheet('STAFF');
  st.appendRow(['StaffID', 'Name', 'Nickname', 'StaffGroup', 'StartDate', 'Status', 'Role']);
  st.appendRow(['STF-001', 'จอย', 'จอย', 'ATMG-01', '2020-01-01', 'ACTIVE', 'Teacher']);
  var gr = hr.insertSheet('STAFF_GROUPS');
  gr.appendRow(['GroupName', 'CheckInTime', 'CheckOutTime']);
  gr.appendRow(['ATMG-01', '07:00', '18:00']);
  hr.insertSheet('WORK_SCHEDULE').appendRow(['StaffID', 'DayOfWeek', 'CheckInTime', 'CheckOutTime']);
  var ck = hr.insertSheet('CHECKIN_STAFF');
  ck.appendRow(['Date', 'StaffID', 'CheckIn', 'CheckOut', 'LateMinutes', 'OTHours', 'Status', 'InManual', 'OutManual']);

  var hol = main.insertSheet('HOLIDAYS');
  hol.appendRow(['Date', 'NameTH', 'NameEN', 'Recurring', 'StartTime', 'EndTime']);
  hol.appendRow(['2026-08-19', 'ปิดครึ่งวันเช้า', 'Half day', false,
    new Date(1899, 11, 30, 7, 0, 0), new Date(1899, 11, 30, 12, 0, 0)]);

  var out = {};
  out.decoded = holidayOn_('2026-08-19');
  out.decoded = { StartTime: holTime_(out.decoded.StartTime), EndTime: holTime_(out.decoded.EndTime) };
  out.hours = staffDayHours_('STF-001', new Date('2026-08-19T12:08:00'));

  // the two check-ins from the report, through the REAL route
  function punch(atISO) {
    ck.data = [ck.data[0]];                                    // one fresh attempt per trial
    var real = Date;
    var at = new real(atISO);
    Date = function (a) { return arguments.length ? new real(a) : new real(at.getTime()); };
    Date.now = function () { return at.getTime(); };
    Date.prototype = real.prototype;
    var r;
    try { r = handleStaffCheckin({ staffId: 'STF-001', lat: 0, lng: 0 }); }
    catch (e) { r = { error: String((e && e.message) || e), code: e && e.apiCode }; }
    Date = real;
    return r;
  }
  out.at1208 = punch('2026-08-19T12:08:00');
  out.at1145 = punch('2026-08-19T11:45:00');
  out.at1130 = punch('2026-08-19T11:30:00');
  out.at1240 = punch('2026-08-19T12:40:00');

  // a row written BEFORE the holiday was corrected, and the repair that puts it right
  ck.data = [ck.data[0]];
  ck.appendRow(['2026-08-19', 'STF-001', '12:08', '', 308, '', 'IN', '', '']);
  var real2 = Date, at2 = new real2('2026-08-19T13:00:00');
  Date = function (a) { return arguments.length ? new real2(a) : new real2(at2.getTime()); };
  Date.now = function () { return at2.getTime(); }; Date.prototype = real2.prototype;
  out.repair = handleRecomputeAttendance({});
  out.diag = handleDiagDay({ date: '2026-08-19' });
  Date = real2;
  return JSON.stringify(out);
}));

console.log('\n1) the holiday times the SERVER reads, from a real Sheets time cell');
{
  eq('a Date-valued cell reads as the window that was set', res.decoded, { StartTime: '07:00', EndTime: '12:00' });
  eq('...so the day resolves as a reopening, not an ordinary shift',
    [res.hours.checkIn, res.hours.checkOut, res.hours.reopened], ['12:00', '18:00', true]);
  eq('...with the door open from 11:45 and 15 minutes forgiven', [res.hours.openFrom, res.hours.grace], ['11:45', 15]);
}

console.log('\n2) the four teachers, replayed');
{
  eq('12:08 — checked in, and NOT 308 minutes late', [res.at1208.time, res.at1208.lateMinutes], ['12:08', 0]);
  eq('11:45 — the door is open before the school is', [res.at1145.time, res.at1145.lateMinutes], ['11:45', 0]);
  ok_('11:30 — still too early, and told why', !!res.at1130.error && /หยุด/.test(res.at1130.error));
  eq('12:40 — late, honestly, by 25 minutes', res.at1240.lateMinutes, 25);
}

console.log('\n3) a row already written wrong can be put right');
{
  const f = (res.repair && res.repair.fixed) || [];
  eq('the stale row is found', f.length, 1);
  eq('...and 308 becomes 0', [f[0].was, f[0].late], [308, 0]);
}

console.log('\n4) the server can now be ASKED what it thinks the day is');
{
  const d = res.diag;
  ok_('it reports both timezones — the disagreement that caused this', !!d.ssTimezone && !!d.configTimezone);
  eq('...the holiday as STORED (a Date is the whole class of bug)',
    [d.holidayRaw.startIsDate, d.holidayRaw.endIsDate], [true, true]);
  eq('...and as READ', [d.holidayDecoded.StartTime, d.holidayDecoded.EndTime], ['07:00', '12:00']);
  eq('...and the hours resolved per person', [d.staff[0].start, d.staff[0].openFrom, d.staff[0].reopened], ['12:00', '11:45', true]);
  eq('...beside the shift they would otherwise have worked', d.staff[0].shift, '07:00-18:00');
}

console.log('\n5) one decoder, and it is the engine\'s');
{
  ok_('the holiday row is decoded before Apps Script looks at it', /if \(typeof decodeCell_ === 'function'\) \{\s*\n\s*var o = \{\}; for \(var k in row\) o\[k\] = decodeCell_\(row\[k\]\);/.test(ci));
  ok_('holTime_ no longer formats a Date in the CONFIG timezone', !/formatDate\(v, tz_\(\), 'HH:mm'\)/.test(ci));
  ok_('...it uses the spreadsheet\'s, like decodeCell_ and toHHmm_', /formatDate\(v, \(typeof ssTz_ === 'function'\) \? ssTz_\(\) : tz_\(\), 'HH:mm'\)/.test(ci));
  ok_('the incident is written down where the next person will look',
    /the app said   "เริ่มงาน 12:00/.test(ci) && /late = 12:08 − 07:00 = 308 minutes/.test(ci));
}

console.log('\n6) and an admin can reach both tools without asking anyone');
{
  ok_('the diagnostic is a route', /diagDay:\s+function \(p\) \{ return handleDiagDay\(p\); \}/.test(code));
  ok_('...admin-only', /ADMIN_ONLY = \{[^}]*diagDay: 1/.test(code));
  ok_('...and it is a READ, so it never queues behind the write lock', !/^(submit|save|add)/.test('diagDay'));
  ok_('the repair has a button at last', /A_recomputeAtt\(this\)/.test(app) && /คำนวณนาทีสายของวันนี้ใหม่/.test(app));
  ok_('...and says what it changed, per person', /\$\{x\.was\} → <b style="color:\$\{x\.late\?'var\(--bad\)':'var\(--ok\)'\}">\$\{x\.late\}<\/b>/.test(app));
  ok_('the diagnostic has one too', /A_diagDay\(\)/.test(app) && /ตรวจสอบว่าระบบมองวันนี้อย่างไร/.test(app));
  ok_('...and shouts if the two timezones disagree', /const tzBad = d\.ssTimezone!==d\.configTimezone;/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
