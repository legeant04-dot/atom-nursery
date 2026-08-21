/**
 * tools/test_one_rule.js — THE REGISTRY. Every rule that must exist in exactly one place.
 *   node tools/test_one_rule.js
 *
 * Nearly every expensive bug in this app has had the same shape: a rule with two copies that drifted
 * apart. Not a typo, not a missing null check — two pieces of code answering the same question and
 * eventually giving different answers, in a school where one of the answers was money.
 *
 *   "is the school open today"      — the Admin dashboard kept its own copy and, on a holiday that
 *                                     was also a meeting day, marked all 31 children ขาด
 *   "what hours does this person
 *    work today"                    — five copies. A half-day holiday recorded four teachers
 *                                     250–311 minutes late and cost them a month's เบี้ยขยัน
 *   "how do I read this time cell"  — the engine used the spreadsheet's timezone, Apps Script used
 *                                     the config's. The app said 12:00 and the server said 07:00
 *   "does this pick-up owe OT"      — three copies, all stopping at `if (amount > 0)`. Correcting a
 *                                     time DOWNWARD could never take money off a family's bill
 *   "may this request be sent
 *    again"                         — three copies, so a batch was retryable on one path and not
 *                                     another
 *   "how do I sort a timestamp"     — the perf report measured the whole log while printing "7 days"
 *
 * Each was found by a person noticing something wrong in production. This file is the attempt to
 * stop needing that person: one table, one row per rule, naming the owner and the shapes that mean
 * somebody has written a second copy. A new shared rule is a new row here.
 *
 * A row is a claim about the CODE, not about behaviour — the behaviour tests live in their own
 * files. What this catches is the copy appearing, on the day it appears, instead of the morning the
 * two copies finally disagree.
 */
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
function ok_(label, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (cond ? '' : (detail ? '  → ' + detail : '')));
  cond ? pass++ : fail++;
}
const ROOT = path.join(__dirname, '..');
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };

// every file a rule could be copied INTO. src/Engine.gs is generated from webapp/engine.js, so it is
// deliberately excluded — it is the same code, not a second copy.
const SEARCHABLE = ['webapp/app.js', 'webapp/api.js', 'webapp/engine.js',
  'src/Code.gs', 'src/Checkin.gs', 'src/OT.gs', 'src/OtStaff.gs', 'src/Parent.gs', 'src/Payroll.gs',
  'src/AttReq.gs', 'src/GasEngine.gs', 'src/Notify.gs', 'src/Perf.gs', 'src/PaySlips.gs',
  'src/Announce.gs', 'src/Leave.gs', 'src/Staff.gs', 'src/Journal.gs'];
const TEXT = {}; SEARCHABLE.forEach(f => { TEXT[f] = read(f); });

/**
 * owner   : where the rule lives, and the pattern that proves it is still there
 * callers : files allowed to ASK the rule (they must call it, not restate it)
 * forbid  : shapes that mean somebody has written the rule out again. Each is checked in every
 *           searchable file EXCEPT the owner's — a hit is a second copy.
 */
const RULES = [
  {
    rule: 'is the school open, and to whom',
    owner: { file: 'webapp/engine.js', has: /const schoolDayFor_ = \(d, atTime\) =>/ },
    forbid: [
      { what: 'a screen deciding for itself whether today is a holiday',
        re: /_LV_HOL[\s\S]{0,80}getDay\(\)\s*===\s*0/, only: ['webapp/app.js'] }
    ]
  },
  {
    rule: 'what hours does this person work today',
    owner: { file: 'webapp/engine.js', has: /^function atomStaffHours_\(o\) \{/m },
    forbid: [
      { what: 'lateness measured against a raw schedule instead of the day\'s hours',
        re: /isBigCleaningDay_\([a-z]+\) \? getConfig(Time)?_\('BigCleaningIn'/ },
      { what: 'OT measured against a raw schedule instead of the day\'s hours',
        re: /isBigCleaning(Day)?_\([a-zA-Z()]+\)\s*\?\s*\(?(getConfigTime_\('BigCleaningOut'|bigCleaningOut_\(\))/ }
    ]
  },
  {
    rule: 'does this pick-up owe late-pickup OT, and what happens to a charge already there',
    owner: { file: 'webapp/engine.js', has: /function otReconcile_\(student, date, pickupHHMM\)\{/ },
    peer: { file: 'src/OT.gs', has: /function otUpsertForPickup_\(student, pickupHHMM, dateS\) \{/,
            why: 'Apps Script works on sheets, the engine on M — they cannot share code, so they share the TEST' },
    forbid: [
      { what: 'a handler building its own OT row', re: /M\.otDaily\.push\(\{OTID:id,/ },
      { what: 'a handler charging only when the amount is positive and doing nothing otherwise',
        re: /if\(o\.amount>0\)\{ const id='OT-'/ }
    ]
  },
  {
    rule: 'may this request be sent again',
    owner: { file: 'webapp/api.js', has: /const canRepeat = body => \{/ },
    forbid: [
      { what: 'a retry path spelling the rule out for itself', re: /const safe\d? = act\d? === 'batch'/ }
    ]
  },
  {
    rule: 'how a time-only cell from Sheets becomes HH:mm',
    owner: { file: 'src/GasEngine.gs', has: /function decodeCell_\(v\) \{/ },
    forbid: [
      /* `v` is the convention for a value that came out of a CELL (toHHmm_, holTime_, decodeCell_).
       * Formatting one of those in the config timezone is the v251 bug. timeStr_(d) is deliberately
       * NOT caught: it formats a Date the code just made, in the school's own wall clock, which is
       * the right timezone for "what time is it now". */
      { what: 'formatting a CELL value in the config timezone instead of the spreadsheet\'s',
        re: /formatDate\(v, tz_\(\)/ }
    ]
  },
  {
    rule: 'when is an announcement on show',
    owner: { file: 'webapp/engine.js', has: /const annPhase_ = \(a, nowD, nowT\) =>/ },
    forbid: [
      { what: 'a screen filtering announcements by date itself',
        re: /announcements[\s\S]{0,120}filter\([\s\S]{0,60}EndDate\s*(>=|<)/, only: ['webapp/app.js'] }
    ]
  },
  {
    rule: 'is this OT record a holiday lump sum',
    owner: { file: 'webapp/engine.js', has: /const isHolidayOT_ = r =>/ },
    peer: { file: 'src/OtStaff.gs', has: /function otIsHoliday_\(/,
            why: 'the two runtimes cannot share a function; the shape is asserted in both' },
    client: { file: 'webapp/app.js', has: /const isHolOT = o => String\(\(o && o\.Kind\) \|\| ''\)\.toUpperCase\(\) === 'HOLIDAY';/,
              why: 'engine.js is not loaded in production, so the browser needs its own — ONE of its own' },
    forbid: [
      // the browser had five of these before this file existed; the sixth would have been free
      { what: 'a caller testing Kind by hand', re: /Kind\s*\|\|\s*''\)\.toUpperCase\(\)\s*===\s*'HOLIDAY'/,
        allow: ['webapp/engine.js', 'src/OtStaff.gs', 'webapp/app.js'] },
      { what: 'a SECOND copy inside the browser',
        re: /toUpperCase\(\)\s*===?\s*'HOLIDAY'/g, only: ['webapp/app.js'], max: 1 }
    ]
  },
  {
    rule: 'does this action write',
    owner: { file: 'src/Code.gs', has: /function isMutatingAction_\(a\) \{/ },
    peer: { file: 'webapp/api.js', has: /const isMutating = a =>/,
            why: 'the client must answer before it sends; test_lost_reply.js proves the two lists match' },
    forbid: []
  },
  {
    rule: 'a perf timestamp that sorts',
    owner: { file: 'src/Perf.gs', has: /function perfTs_\(v\) \{/ },
    forbid: [
      { what: 'reading a perf row\'s timestamp as a raw string', re: /var ts = String\(r\[0\]\)/ }
    ]
  },
  {
    rule: 'is this child away on a temporary leave',
    owner: { file: 'webapp/engine.js', has: /function studentPaused_\(s, onDate\)\{/ },
    forbid: [
      { what: 'a caller comparing the pause dates itself',
        re: /PauseTo[\s\S]{0,40}<\s*todayLocal\(\)/, allow: ['webapp/engine.js'] }
    ]
  }
];

console.log('\n1) every rule still has its owner');
RULES.forEach(r => {
  ok_(r.rule + ' — owned by ' + r.owner.file, r.owner.has.test(TEXT[r.owner.file] || ''),
    'not found in ' + r.owner.file);
  if (r.peer) ok_('   ...and its ' + r.peer.file + ' counterpart (' + r.peer.why + ')',
    r.peer.has.test(TEXT[r.peer.file] || ''), 'not found in ' + r.peer.file);
  if (r.client) ok_('   ...and the browser\'s single copy (' + r.client.why + ')',
    r.client.has.test(TEXT[r.client.file] || ''), 'not found in ' + r.client.file);
});

console.log('\n2) and nobody has written a second copy');
RULES.forEach(r => {
  (r.forbid || []).forEach(f => {
    // `max` counts instead of forbidding: some rules MUST exist once per runtime (the browser cannot
    // call the engine), so what is banned is the SECOND copy, not the first.
    if (f.max != null) {
      const file = (f.only || [r.owner.file])[0];
      const n = ((TEXT[file] || '').match(f.re) || []).length;
      ok_(r.rule + ' :: ' + f.what, n <= f.max, n + ' copies in ' + file + ' (max ' + f.max + ')');
      return;
    }
    const allow = f.allow || [r.owner.file].concat(r.peer ? [r.peer.file] : []);
    const files = (f.only || SEARCHABLE).filter(x => allow.indexOf(x) < 0);
    const hits = files.filter(x => f.re.test(TEXT[x] || ''));
    ok_(r.rule + ' :: ' + f.what, hits.length === 0, 'found in ' + hits.join(', '));
  });
});

console.log('\n3) the registry itself is not allowed to rot');
{
  // a rule with no owner pattern, or an owner file nobody reads, is a row that can never fail
  ok_('every rule names a file this test actually reads',
    RULES.every(r => SEARCHABLE.indexOf(r.owner.file) >= 0 && (TEXT[r.owner.file] || '').length > 100));
  ok_('every rule carries at least an owner check', RULES.every(r => r.owner && r.owner.has instanceof RegExp));
  ok_('a peer always says WHY there are two', RULES.every(r => !r.peer || (r.peer.why || '').length > 20));
  // the generated copy must never be searched: it would look like a second copy of everything
  ok_('the generated Engine.gs is excluded', SEARCHABLE.indexOf('src/Engine.gs') < 0);
  ok_('...and the reason is written down', /src\/Engine\.gs is generated from webapp\/engine\.js/.test(read('tools/test_one_rule.js')));
  ok_('a browser-side copy always says why it exists', RULES.every(r => !r.client || (r.client.why || '').length > 20));
  console.log('  (' + RULES.length + ' rules, ' +
    RULES.reduce((a, r) => a + (r.forbid || []).length, 0) + ' forbidden shapes, over ' +
    SEARCHABLE.length + ' files)');
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
