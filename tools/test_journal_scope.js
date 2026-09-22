/**
 * tools/test_journal_scope.js — reading one day of journals instead of four years.
 *   node tools/test_journal_scope.js
 *
 * DAILY_JOURNAL is the biggest sheet the app has and the only one that grows by a row per child per
 * school day for ever. On 2026-09-22 it measured 1,119KB against a 1,055KB cache ceiling, so it was
 * not cached AT ALL and was re-read live on every request that touched it — 10.7s, against 38-121ms
 * for every other collection. Raising the ceiling (v395) fixed the symptom; this is the cause.
 *
 * WHAT THE READS ACTUALLY WANT:
 *   getJournal      ONE student, ONE date      ┐ 1,707 of the 1,800 journal calls in the
 *   journalStatus   ALL students, ONE date     ┘ 17-22/09 report, and its two slowest actions
 *   journalHistory  ONE student, every date    ← the only one that genuinely needs the collection
 *
 * THE DANGER THIS FILE EXISTS FOR. persist() writes a collection back in full when it changes. If
 * M.journals held ONE DAY and anything persisted it, writeCollection_ would rewrite DAILY_JOURNAL
 * with that day alone and four years of daily reports would be gone in a single request. Three locks
 * stand between here and there, and §4 tests all three:
 *   1. every journal WRITE is an in-place route (src/Journal.gs), so the engine's copy is read-only
 *      on GAS in practice;
 *   2. the narrow path uses lazyRO_, which persist() never looks at;
 *   3. DAILY_JOURNAL is in NO_SHRINK_SHEETS, so a write that would shorten it aborts loudly.
 * The first two are arguments. The third is a mechanism, which is why it is there.
 */
const path = require('path'), fs = require('fs');
const H_ = require(path.join(__dirname, 'gas_test_harness.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const gasEngine = R('src/GasEngine.gs'), journalGs = R('src/Journal.gs');

// ============================================================================================
console.log('1) which requests may be narrowed, and which must not be');
// ============================================================================================
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'Journal', 'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var t = gasToday_();
    var s = function (calls) { return journalScopeFor_(calls); };
    return JSON.stringify({
      today:        t,
      oneDate:      s([{ action: 'getJournal', payload: { studentId: 'S1', date: '2026-09-22' } }]),
      defaultsToday: s([{ action: 'journalStatus', payload: {} }]),
      // the class screen's real shape: two journal reads for the same day, in one batch
      classScreen:  s([{ action: 'classList', payload: {} },
                       { action: 'journalStatus', payload: { date: '2026-09-22' } },
                       { action: 'getJournal', payload: { date: '2026-09-22' } },
                       { action: 'notifications', payload: {} }]),
      // ...and the cases that must fall back to the whole collection
      history:      s([{ action: 'journalHistory', payload: { studentId: 'S1' } }]),
      twoDays:      s([{ action: 'getJournal', payload: { date: '2026-09-21' } },
                       { action: 'getJournal', payload: { date: '2026-09-22' } }]),
      historyMixed: s([{ action: 'getJournal', payload: { date: '2026-09-22' } },
                       { action: 'journalHistory', payload: { studentId: 'S1' } }]),
      junkDate:     s([{ action: 'getJournal', payload: { date: 'yesterday' } }]),
      // a batch that never touches journals at all: the answer is irrelevant, and it is lazy anyway
      noJournals:   s([{ action: 'classList', payload: {} }, { action: 'notifications', payload: {} }])
    });
  }));

  eq('one named day narrows to that day', res.oneDate, '2026-09-22');
  eq('no date given means today', res.defaultsToday, res.today);
  /* THE CASE THIS IS ALL FOR: the class screen fires both journal reads for the same day in one
   * tick, and api.js micro-batches them into a single request. */
  eq('the class screen batch narrows to its one day', res.classScreen, '2026-09-22');

  /* AND THE FALLBACKS. Every one of these must return '' — the full collection — because answering
   * them from one day's rows would be WRONG, not merely slower. */
  eq('a history request takes the whole collection', res.history, '');
  eq('two different days in one batch: the whole collection', res.twoDays, '');
  eq('...and one narrow call beside one broad one takes the broad answer', res.historyMixed, '');
  eq('an unparseable date falls back rather than guessing', res.junkDate, '');
}

// ============================================================================================
console.log('\n2) an unknown action is treated as needing everything');
// ============================================================================================
{
  /* THE SAFE DIRECTION, and the one that matters for whoever adds a handler next year. An action
   * that is not on the readers list is assumed not to touch journals; one that IS on it but is not
   * date-scoped takes the collection. A new journal reader added without touching this list gets
   * the FULL collection and works — it does not silently see a single day. */
  ok_('the readers list is explicit', /var JOURNAL_READERS_ = \{/.test(gasEngine));
  ok_('...and the date-scoped subset is a SUBSET of it', (() => {
    const readers = /var JOURNAL_READERS_ = \{([^}]*)\}/.exec(gasEngine)[1];
    const byDate  = /var JOURNAL_BY_DATE_ = \{([^}]*)\}/.exec(gasEngine)[1];
    const names = s => (s.match(/(\w+): 1/g) || []).map(x => x.split(':')[0]);
    return names(byDate).every(n => names(readers).indexOf(n) >= 0);
  })());
  ok_('journalHistory reads journals but is NOT date-scoped',
    /JOURNAL_READERS_ = \{[^}]*journalHistory: 1/.test(gasEngine) &&
    !/JOURNAL_BY_DATE_ = \{[^}]*journalHistory/.test(gasEngine));
}

// ============================================================================================
console.log('\n3) the narrow read returns the same rows the full one would');
// ============================================================================================
{
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'Journal', 'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var MAIN = getMainSpreadsheet_();
    var sh = sheet_(MAIN, 'DAILY_JOURNAL');
    // three days, three children — the middle day is the one asked for
    ['2026-09-20', '2026-09-21', '2026-09-22'].forEach(function (d) {
      ['S1', 'S2', 'S3'].forEach(function (sid) {
        appendObject_(sh, { Date: d, StudentID: sid, TeacherID: 'STF-T', Mood: 'ดี',
          Highlight: 'บันทึกของ ' + sid + ' ' + d, Status: 'SUBMITTED' });
      });
    });
    var before = sh.getLastRow();

    var narrow = readJournalsForDate_('2026-09-21');
    var full = readCollection_('journals').filter(function (r) {
      return String(r.Date).slice(0, 10) === '2026-09-21'; });
    var sortIt = function (a) { return a.map(function (r) { return r.StudentID + '|' + r.Highlight; }).sort(); };
    return JSON.stringify({
      narrow: sortIt(narrow), full: sortIt(full),
      narrowKeys: Object.keys(narrow[0] || {}).sort(),
      fullKeys: Object.keys(full[0] || {}).sort(),
      emptyDay: readJournalsForDate_('2026-09-19'),
      rowsUnchanged: sh.getLastRow() === before
    });
  }));

  eq('the narrow read finds the day’s three rows', res.narrow,
     ['S1|บันทึกของ S1 2026-09-21', 'S2|บันทึกของ S2 2026-09-21', 'S3|บันทึกของ S3 2026-09-21']);
  /* IDENTICAL TO THE FULL READ, not merely similar. The engine cannot be allowed to tell which path
   * it got — a missing field would show up as an empty journal on somebody's screen. */
  eq('...exactly what the full collection would have given', res.narrow, res.full);
  eq('...with the same fields, so nothing reads as blank', res.narrowKeys, res.fullKeys);
  eq('a day with no journals is empty, not a fallback to everything', res.emptyDay, []);
  ok_('reading changed nothing on the sheet', res.rowsUnchanged);
}

// ============================================================================================
console.log('\n4) the three locks that stop a day overwriting four years');
// ============================================================================================
{
  ok_('LOCK 1 — every journal write is an in-place route, not a collection rewrite',
    /function handleSubmitJournal/.test(journalGs) && /updateRow_\(sheet, existing\._row, rec\)/.test(journalGs));
  /* LOCK 2. lazyRO_ is not snapshotted and is never handed to persist(), so a narrowed collection
   * physically cannot be written back. lazyRW_ — the full path — is untouched. */
  ok_('LOCK 2 — the narrowed collection is read-only',
    /if \(journalDate\) \{\s*\n\s*lazyRO_\(M, cache, 'journals'/.test(gasEngine));
  ok_('...and persist only ever looks at the snapshotted ones',
    /if \(snap\.hasOwnProperty\(key\) && JSON\.stringify\(cache\[key\]\) !== snap\[key\]\) writeCollection_/.test(gasEngine));
  /* LOCK 3, and the only one that is a mechanism rather than an argument. */
  ok_('LOCK 3 — DAILY_JOURNAL cannot be shrunk by any write, whatever the reason',
    /NO_SHRINK_SHEETS = \{[^}]*DAILY_JOURNAL: 1/.test(gasEngine));

  // ...and prove lock 3 actually fires, rather than trusting the table
  const { run } = H_(['Config', 'Db', 'Audit', 'Line', 'Auth', 'Code', 'Setup', 'Dspm_Seed', 'Checkin',
                      'Triggers', 'Leave', 'Notify', 'Parent', 'Staff', 'OT', 'Payroll', 'Backup',
                      'Journal', 'GasEngine', 'Engine']);
  const res = JSON.parse(run(function () {
    _configCache = null; setupAll(); _configCache = null;
    var sh = sheet_(getMainSpreadsheet_(), 'DAILY_JOURNAL');
    ['2026-09-20', '2026-09-21'].forEach(function (d) {
      ['S1', 'S2', 'S3'].forEach(function (sid) {
        appendObject_(sh, { Date: d, StudentID: sid, TeacherID: 'STF-T', Status: 'SUBMITTED' }); });
    });
    var before = sh.getLastRow();
    var code = 'NOT REFUSED';
    // the exact catastrophe: one day's rows written back as if they were the whole collection
    try { writeCollection_('journals', readJournalsForDate_('2026-09-21')); }
    catch (e) { code = e.apiCode || e.code || 'ERR'; }
    return JSON.stringify({ code: code, rowsAfter: sh.getLastRow(), rowsBefore: before });
  }));
  eq('writing one day over the collection is REFUSED', res.code, 'WRITE_GUARD');
  eq('...and not one row was lost', res.rowsAfter, res.rowsBefore);
}

// ============================================================================================
console.log('\n5) the cache, which is the reason any of this is fast');
// ============================================================================================
{
  ok_('a day is cached under its own key', /cacheGet_\('jrn:' \+ d\)/.test(gasEngine) &&
    /cachePut_\('jrn:' \+ d, out\)/.test(gasEngine));
  /* A PER-DAY KEY IS A FEW KB. The whole point: it can never approach the chunk ceiling that made
   * DAILY_JOURNAL uncacheable in the first place, however many years the sheet holds. */
  ok_('...and the empty case is cached too, or an empty day costs a full scan every time',
    /cachePut_\('jrn:' \+ d, \[\]\)/.test(gasEngine));
  /* AND EVERY WRITE DROPS IT. This is the one place a stale cache would actually be seen: a teacher
   * saves a journal and the screen behind her still shows the day without it. */
  const busts = (journalGs.match(/cacheDel_\('jrn:' \+ String\(date\)\.slice\(0, 10\)\)/g) || []).length;
  eq('every journal write drops that day’s key', busts, 4);
  eq('...which is every place the collection key is dropped, none missed',
     (journalGs.match(/cacheDel_\('col:DAILY_JOURNAL'\)/g) || []).length, busts);
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
