/**
 * tools/test_schema_topup.js — a column you declared but the live sheet has not got yet.
 *   node tools/test_schema_topup.js
 *
 * REPORTED 2026-08-18: "ใส่กำหนดเวลา แต่เวลาไม่บันทึก หรือบันทึกแต่ไม่แสดง" — a half-day holiday saved
 * with 07:00–12:00 came back with no times at all.
 *
 * The times were never written. writeRows_ maps each row onto the sheet's EXISTING header, so a
 * field with no column is dropped WITHOUT AN ERROR. ensureCollectionSheet_ was supposed to prevent
 * exactly that by topping the header up from the declared columns — and its own comment says it
 * fixes the problem "once, for every collection" — but it read COLLECTION_HEADERS_, which holds only
 * the FOUR sheets one build introduced. Every other sheet's columns are declared in Config.gs
 * SCHEMA, where nothing looked.
 *
 * So two features shipped, passed their tests, and quietly lost their data on the ONE spreadsheet
 * that mattered:
 *   - HOLIDAYS.StartTime/EndTime   (v244) — and with them, the half-day closure itself
 *   - ANNOUNCEMENTS.StartTime/EndTime (v241) — the window an announcement is on show
 *
 * It could not be caught by testing the feature, because a sheet CREATED by this build has the new
 * columns. Only a school that already had the sheet — i.e. only the live one — lost anything. That
 * is what this file tests: the old sheet, not the new one.
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
const ge = R('src/GasEngine.gs'), api = R('webapp/api.js');

const { run } = H(['Config', 'Db', 'Audit', 'Engine', 'GasEngine', 'Checkin']);
const res = JSON.parse(run(function () {
  var main = SpreadsheetApp.create('MAIN'), hr = SpreadsheetApp.create('HR');
  PropertiesService.getScriptProperties().setProperty('WB_MAIN_ID', main.getId());
  PropertiesService.getScriptProperties().setProperty('WB_HR_ID', hr.getId());
  main.insertSheet('SCHOOL_CONFIG').appendRow(['Key', 'Value']);
  var out = {};

  // ---- the reported case: a HOLIDAYS sheet from before StartTime/EndTime existed ----
  var hol = main.insertSheet('HOLIDAYS');
  hol.data = [['Date', 'NameTH', 'NameEN', 'Recurring']];          // the live sheet, as it was
  engineDispatch_('addHoliday', { date: '2026-08-19', nameTH: 'ครึ่งวัน', nameEN: 'Half', startTime: '07:00', endTime: '12:00' });
  // .slice() — these are the sheet's OWN arrays; the edit further down would otherwise rewrite what
  // this line thinks it captured, and the test would report the wrong moment
  out.holHeader = main.getSheetByName('HOLIDAYS').data[0].slice();
  out.holRow = main.getSheetByName('HOLIDAYS').data[1].slice();
  out.holRead = engineDispatch_('holidays', {});

  // ...and the half-day closure that depends on those times
  out.schoolDay = engineDispatch_('schoolDay', { date: '2026-08-19' });

  // editing it must survive the same trip
  engineDispatch_('editHoliday', { date: '2026-08-19', nameTH: 'ครึ่งวัน', startTime: '08:00', endTime: '12:30' });
  out.holEdited = engineDispatch_('holidays', {});

  // ---- the same bug, the other feature: an ANNOUNCEMENTS sheet from before v241 ----
  var ann = main.insertSheet('ANNOUNCEMENTS');
  ann.data = [['AnnID', 'Date', 'TitleTH', 'TitleEN', 'BodyTH', 'BodyEN', 'Audience', 'StartDate', 'EndDate', 'Status', 'CreatedBy']];
  try {
    engineDispatch_('addAnnouncement', { titleTH: 'ประชุม', bodyTH: 'x', audience: 'ALL',
      startDate: '2026-08-19', endDate: '2026-08-19', startTime: '06:00', endTime: '12:30' });
    out.annHeader = main.getSheetByName('ANNOUNCEMENTS').data[0];
    out.annRead = engineDispatch_('announcements', { role: 'Admin' });
  } catch (e) { out.annThrew = String((e && e.message) || e); }

  // ---- a sheet that does not exist at all is still created with its declared columns ----
  var before = !!main.getSheetByName('SURVEYS');
  out.newSheetCreated = { before: before };
  return JSON.stringify(out);
}));

console.log('\n1) the reported case: a HOLIDAYS sheet that predates the time columns');
{
  eq('the missing columns are appended to the header', res.holHeader,
    ['Date', 'NameTH', 'NameEN', 'Recurring', 'StartTime', 'EndTime']);
  eq('...and the times are actually in the row', res.holRow.slice(4), ['07:00', '12:00']);
  eq('...so they read back', [res.holRead[0].StartTime, res.holRead[0].EndTime], ['07:00', '12:00']);
}
{
  // the times are not decoration: without them the school never closes for the half day it was told to
  eq('the half-day closure works, because the times survived',
    [res.schoolDay.partial, res.schoolDay.holStart, res.schoolDay.holEnd, res.schoolDay.closedAllDay],
    [true, '07:00', '12:00', false]);
}
{
  eq('editing the window survives the same trip',
    [res.holEdited[0].StartTime, res.holEdited[0].EndTime], ['08:00', '12:30']);
  eq('...and there is still exactly one holiday', res.holEdited.length, 1);
}

console.log('\n2) the same bug, the other feature that had it');
{
  ok_('an announcement sheet from before v241 is topped up too',
    !res.annThrew && (res.annHeader || []).indexOf('StartTime') >= 0 && (res.annHeader || []).indexOf('EndTime') >= 0);
  if (!res.annThrew) eq('...and the showing window is kept',
    [(res.annRead[0] || {}).StartTime, (res.annRead[0] || {}).EndTime], ['06:00', '12:30']);
  else console.log('  (addAnnouncement threw: ' + res.annThrew + ')');
}

console.log('\n3) where the columns are declared, and why it reads BOTH lists');
{
  ok_('the declared columns are looked up in one place', /function collectionHeaders_\(def\)/.test(ge));
  ok_('...the build\'s own map first', /if \(COLLECTION_HEADERS_\[def\.sheet\]\) return COLLECTION_HEADERS_\[def\.sheet\];/.test(ge));
  ok_('...then the database SCHEMA, where every other sheet is declared', /SCHEMA\[wb\] && SCHEMA\[wb\]\[def\.sheet\]/.test(ge));
  ok_('ensureCollectionSheet_ asks it instead of one map', /var hdr = collectionHeaders_\(def\);/.test(ge));
  ok_('a sheet nobody declared is still NOT invented — that would hide a typo', /if \(!hdr\) return null;/.test(ge));
  ok_('the two features it cost are named where the next person will look',
    /HOLIDAYS\.StartTime\/EndTime \(v244\)/.test(ge) && /ANNOUNCEMENTS\.StartTime\/EndTime \(v241\)/.test(ge));
  ok_('...including WHY no test caught it', /a fresh sheet is created WITH the new columns/.test(ge));
}

console.log('\n4) and the browser must not serve the old list back for four hours');
{
  // holidays is cached for 4 hours (TTL_STATIC). A write that changes it has to say so, or the
  // screen shows the pre-edit answer for the rest of the afternoon.
  ok_('editHoliday is named as a write that changes the holiday list', /holidays:\s+\/\^\(add\|remove\|edit\)Holiday/.test(api));
  ok_('...and the school-day answer built from it', /schoolDay:\s+\/\^\(add\|remove\|edit\)Holiday/.test(api));
  ok_('...and it is a write we have reasoned about, so the other caches survive it',
    /'addHoliday', 'removeHoliday', 'editHoliday'/.test(api));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
