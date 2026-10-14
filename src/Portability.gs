/**
 * src/Portability.gs — PHASE 4.6: THE SCHOOL'S OWN COPY OF ITS OWN DATA.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 NOT src/Export.gs, AND THE DIFFERENCE IS THE WHOLE POINT OF BOTH FILES
 *
 * There are now two things in this project that "export everything", and they have opposite rules:
 *
 *   src/Export.gs       the Phase 2.2 MIGRATION dump. Every sheet, raw, including password hashes
 *                       and the LINE channel secret. It says, at the top, "THERE IS NO ROUTE TO
 *                       THIS FILE, AND THERE MUST NOT BE ONE" — it is run by hand from the editor
 *                       by the owner, because a web route would put the whole database one stolen
 *                       session token away. tools/test_pg_migrate.js asserts that no route exists.
 *
 *   src/Portability.gs  THIS file. The school's own readable copy, and it is ROUTED on purpose,
 *                       admin-only, with every credential stripped (see below). The school presses
 *                       a button; nothing is staged on a server and nothing is emailed.
 *
 * They must never be merged, and the routed one must never grow toward the raw one. Written down
 * here because the two were briefly confused during the build and that is how a credential dump
 * acquires a button.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A CUTOVER CRITERION AND NOT A NICE-TO-HAVE
 *
 * Every sentence in docs/pdpa/ that says the data belongs to the school is a promise, and a promise
 * with no button behind it is a sentence. PDPA §30 gives a data subject the right to a copy; the
 * processing agreement in 01_DPA.md §9 says the school gets its data back on termination. Today both
 * of those are satisfied only by the accident that the data happens to sit in a Google Sheet the
 * school's own account owns. After the cutover it will sit in OUR Postgres, and on that day the
 * promise becomes dependent on us answering an email.
 *
 * That is also the single strongest thing to say to the SECOND school: not "we are careful", but
 * "here is the button, press it, the file is yours, and it works whether or not we are still here."
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 SO IT MUST NOT BE AN EXPORT OF THE STORAGE
 *
 * The obvious implementation is to hand over a copy of the two spreadsheets. It would work today and
 * stop working on cutover day — the exact day it matters. This reads the DECLARED SCHEMA instead
 * (SCHEMA[WB.MAIN] / SCHEMA[WB.HR]) and pages rows out of whatever is storing them, so the same
 * route, the same payload and the same .xlsx come out of Sheets today and Postgres tomorrow.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 AND AN EXPORT OF "EVERYTHING" EXPORTS THE CREDENTIALS TOO
 *
 * This is the part that needed care. "Everything" includes:
 *
 *   STAFF.PasswordHash · USERS.PasswordHash   — a credential. A bcrypt hash in a file on a laptop
 *                                               is an offline cracking job, and it is of no possible
 *                                               use to the school.
 *   SCHOOL_CONFIG.SlipOK_ApiKey               — spends the school's SlipOK quota.
 *   SCHOOL_CONFIG.LineChannelAccessToken      — pushes LINE messages AS the school to every parent.
 *   SCHOOL_CONFIG.LineLoginChannelSecret      — "NEVER leaves the server", says Config.gs itself.
 *   SCHOOL_CONFIG.SeedMockKey                 — the gate on the test-data route.
 *
 * A data-portability feature that quietly mails the school its own LINE access token has handed an
 * attacker every parent in the school through whichever inbox the file ends up in.
 *
 * DECLARED, NOT PATTERN-MATCHED. A name pattern cannot answer a question about meaning — four
 * separate bugs in Phase 2.3 came from exactly that (`/^Can/` matching `Cancelled`, `/^time/`
 * matching `timestamptz`). So every secret is listed by name below, and
 * tools/test_export_school.js asserts that EVERY key Config.gs seeds is classified one way or the
 * other, so a new key cannot be added without someone deciding. The regex is kept as a SECOND net
 * that can only ever redact more, never less.
 */

/* ── WHAT NEVER GOES IN THE FILE ───────────────────────────────────────────────────────────────── */

/** Columns stripped from every table, whatever sheet they appear on. Credentials only. */
var EXPORT_REDACT_COLS_ = { PasswordHash: 1 };

/**
 * SCHOOL_CONFIG keys whose VALUE is replaced with '(ไม่ส่งออก)'.
 *
 * The key itself IS exported — the school needs to know the setting exists and is filled in; it is
 * the value that is a credential. An export that silently dropped the row would tell the school its
 * LINE integration is unconfigured.
 */
var EXPORT_SECRET_CONFIG_ = {
  SlipOK_ApiKey: 1,
  LineChannelAccessToken: 1,
  LineChannelSecret: 1,
  LineLoginChannelSecret: 1,
  SeedMockKey: 1
};

/**
 * THE SECOND NET. Anything whose key looks like a credential is redacted even if nobody declared it.
 *
 * This can only ever redact MORE than the list above, which makes it safe in a way the Phase 2.3
 * patterns were not: there, a pattern DECIDED a meaning and got it wrong in both directions. Here a
 * false positive costs the school one visible '(ไม่ส่งออก)' it could have had, and a false negative
 * costs it a LINE channel. Those are not symmetrical, so the net leans.
 *
 * `LiffID`, `GoogleClientId` and `LineLoginChannelId` are deliberately NOT caught: an id sent to
 * every browser that draws a login button is not a secret, and Google's own documentation says so.
 */
function exportIsSecretKey_(key) {
  var k = String(key || '');
  if (EXPORT_SECRET_CONFIG_[k]) return true;
  return /secret|token|apikey|api_key|passwor|privatekey|private_key/i.test(k);
}

var EXPORT_REDACTED_ = '(ไม่ส่งออก)';

/**
 * 400 rows a page. DAILY_JOURNAL is 1.1MB on live and growing by a row per child per school day, and
 * an Apps Script reply has a hard size ceiling — a single-shot export would work for THIS school
 * THIS year and fail for the school that has been running three years, which is the worst possible
 * place to discover it.
 */
var EXPORT_PAGE_ = 400;

/* ── THE TABLE LIST, READ FROM THE DECLARED SCHEMA ─────────────────────────────────────────────── */

/**
 * Every table the school has, in the order a person would read them: children, then families, then
 * staff, then the daily record, then the rest alphabetically.
 *
 * Driven by SCHEMA, so a sheet added to the app is in the export the same day — the alternative is a
 * hand-kept list, and a hand-kept list of "all your data" that is missing a table is the kind of
 * promise this file exists to stop making.
 */
var EXPORT_ORDER_ = ['STUDENTS', 'PARENTS', 'USER_LINKS', 'STAFF', 'DAILY_JOURNAL'];

/**
 * 🔴 `key` IS NOT `sheet`, AND THAT DISTINCTION WAS A MISSING TABLE.
 *
 * AUDIT_LOG is declared in BOTH workbooks — SCHEMA[WB.MAIN] has the general access log and
 * SCHEMA[WB.HR] has the one dedicated to the confidential HR workbook (it says so in Config.gs:
 * "PDPA access log dedicated to the confidential workbook"). They are two different logs with the
 * same name.
 *
 * Keyed by sheet name alone, three things happened at once, and tools/test_export_school.js caught
 * all of them: the lookup below found the MAIN one twice, so the HR access log — the record of who
 * read the salaries — was NEVER EXPORTED; the file got two tabs of identical MAIN rows; and Excel
 * refuses a workbook with two sheets of the same name outright, so the whole export failed to open
 * on account of the one table nobody noticed was missing.
 *
 * The HR copy is therefore `HR_AUDIT_LOG`, which is also what the school sees as the tab name. Same
 * answer tools/schema_inventory.js reached for the Postgres table names (`hr_` prefix), for the same
 * reason, and arrived at independently — which is a sign it is the right one.
 */
function exportKeyFor_(sheetName, wb, collides) {
  return (wb === 'HR' && collides) ? ('HR_' + sheetName) : sheetName;
}

function exportTables_() {
  var seen = {}, out = [];
  // first pass: which names are declared in BOTH workbooks
  [[WB.MAIN, 'MAIN'], [WB.HR, 'HR']].forEach(function (pair) {
    Object.keys(SCHEMA[pair[0]] || {}).forEach(function (n) { seen[n] = (seen[n] || 0) + 1; });
  });
  [[WB.MAIN, 'MAIN'], [WB.HR, 'HR']].forEach(function (pair) {
    var block = SCHEMA[pair[0]] || {};
    Object.keys(block).forEach(function (sheetName) {
      var cols = (block[sheetName] || []).filter(function (c) { return !EXPORT_REDACT_COLS_[c]; });
      if (!cols.length) return;
      out.push({ key: exportKeyFor_(sheetName, pair[1], seen[sheetName] > 1),
        sheet: sheetName, wb: pair[1], cols: cols });
    });
  });
  out.sort(function (a, b) {
    var ia = EXPORT_ORDER_.indexOf(a.key), ib = EXPORT_ORDER_.indexOf(b.key);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out;
}

function exportWbOf_(wb) {
  return String(wb) === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_();
}

/** One cell, as text an .xlsx can carry and a person can read. */
function exportCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v) ? '' : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return ''; } }
  return String(v);
}

/* ── ROUTE 1: WHAT IS THERE ────────────────────────────────────────────────────────────────────── */

/**
 * The manifest. Table names, column headers and ROW COUNTS, so the client knows the size of the job
 * before it starts and can show a real progress bar rather than a spinner that might never end.
 *
 * The count is read here rather than guessed because the next route pages, and a pager with no total
 * cannot tell "finished" from "stopped" — the same confusion as "no differences found" versus "did
 * not look", which is the mistake this project keeps paying for.
 */
function handleExportManifest(p) {
  p = p || {};
  var tables = exportTables_(), total = 0;
  var list = tables.map(function (t) {
    var n = 0;
    try {
      var sh = exportWbOf_(t.wb).getSheetByName(t.sheet);
      // -1 for the header row; a sheet with only headers is 0 rows, not -1
      n = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
    } catch (e) { n = 0; }
    total += n;
    // `key` is what the client asks for and names the tab; `sheet` is only where it came from
    return { key: t.key, sheet: t.sheet, wb: t.wb, cols: t.cols, rows: n };
  });
  /* 🔴 THE EXPORT ITSELF IS A PROCESSING ACTIVITY, and §39 wants it recorded. Logged at the MANIFEST
   * rather than per page, so one export is one audit line instead of forty. */
  try {
    logAudit(String(p.staffId || p.adminId || 'admin'), 'EXPORT_SCHOOL', 'ALL', String(total));
  } catch (e) {}
  return {
    generatedAt: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'),
    school: String(getConfig_('SchoolName', '') || ''),
    tables: list,
    totalRows: total,
    pageSize: EXPORT_PAGE_,
    /* Said in the payload, not only in a comment, so it reaches the sheet the school opens. An
     * export that is quietly incomplete is worse than one that says what it left out. */
    redactedCols: Object.keys(EXPORT_REDACT_COLS_),
    redactedConfigKeys: Object.keys(EXPORT_SECRET_CONFIG_)
  };
}

/* ── ROUTE 2: ONE PAGE OF ONE TABLE ────────────────────────────────────────────────────────────── */

function handleExportTable(p) {
  p = p || {};
  // asked for by KEY, so HR_AUDIT_LOG reaches the HR workbook and not MAIN's log of the same name
  var want = String(p.key || p.sheet || '').trim();
  var def = null;
  exportTables_().forEach(function (t) { if (t.key === want) def = t; });
  /* Looked up in the DECLARED list, never taken from the payload. Opening `p.sheet` directly would
   * let any admin-session caller read a sheet nobody decided was exportable — and the redaction
   * above is applied per declared table, so an undeclared one would arrive unredacted. */
  if (!def) throw apiError_('BAD_INPUT', 'ไม่รู้จักตาราง: ' + want);

  var offset = Math.max(0, parseInt(p.offset, 10) || 0);
  var limit = Math.min(EXPORT_PAGE_, Math.max(1, parseInt(p.limit, 10) || EXPORT_PAGE_));
  var all = [];
  // A sheet the app has declared but this school has never created is 0 rows, not an error: a young
  // school has no WITHDRAWALS, and refusing the page would stop the whole export on an empty table.
  var sh = exportWbOf_(def.wb).getSheetByName(def.sheet);
  if (sh) { try { all = readObjects_(sh) || []; } catch (e) { all = []; } }

  var slice = all.slice(offset, offset + limit);
  var isConfig = (def.sheet === 'SCHOOL_CONFIG');
  var rows = slice.map(function (r) {
    // VALUE blanked for a secret key, the key itself kept — see EXPORT_SECRET_CONFIG_
    var secret = isConfig && exportIsSecretKey_(r.Key);
    return def.cols.map(function (c) {
      if (secret && c === 'Value') return EXPORTED_SECRET_PLACEHOLDER_();
      return exportCell_(r[c]);
    });
  });
  return { key: def.key, sheet: def.sheet, wb: def.wb, cols: def.cols, offset: offset,
    rows: rows, total: all.length, done: (offset + slice.length) >= all.length };
}

/** One place, so the test asserts the same string the file carries. */
function EXPORTED_SECRET_PLACEHOLDER_() { return EXPORT_REDACTED_; }
