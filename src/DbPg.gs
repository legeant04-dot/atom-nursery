/**
 * DbPg.gs — the same spreadsheet API, answered by Postgres (week 2 of docs/SPEED_FIRST_PLAN.md)
 * ================================================================================================
 *
 * 🔴 OFF UNLESS TWO SCRIPT PROPERTIES SAY OTHERWISE, AND A THIRD FOR REAL DATA.
 *
 *     DB_BACKEND = pg                  — without this, nothing in this file runs at all
 *     PG_TARGET  = staging             — fabricated data only (docs/pdpa: nothing real before signing)
 *     PG_TARGET  = production          — refused unless PDPA_SIGNED = yes as well
 *     PG_JDBC_URL · PG_USER · PG_PASSWORD · PG_TENANT_ID   — the connection, never in the code
 *
 * WHY EMULATE THE SPREADSHEET, NOT REWRITE THE CALLERS. 37 files reach the data through
 * getMainSpreadsheet_() / getHrSpreadsheet_() and then the Sheet API — about 1,000 helper calls and
 * 100 direct ones (counted 2026-11-04). Rewriting them would be 37 files of new code with no way to
 * show they still do what they did. Answering the same API from Postgres changes ONE door
 * (Config.gs) and lets every existing suite run through it unchanged (tools/gas_test_harness.js,
 * ATOM_DB=pg) — the same move pg_hook made for the engine in Phase 2.3.
 *
 * WHAT A "SHEET" IS HERE. One table, read once per execution in `seq` order — exactly what a GAS
 * execution already does with a sheet. Row 1 is the header (the declared columns, in SCHEMA order);
 * row r is rows[r-2]. Writes go straight to Postgres, row by row, and the in-memory copy follows, so
 * a read after a write in the same request sees it — the behaviour every caller already relies on.
 *
 * WHAT GOES IN AND OUT. In: pg_migrate.js encode_'s rule, reproduced (one answer to "what goes in
 * this column"). Out: what Sheets would hand back — a Date for a date or timestamp cell, a number
 * for a number, a string otherwise — because that is what 37 files of callers were written against.
 *
 * A COLUMN THE SCHEMA DOES NOT DECLARE CANNOT BE STORED. ensureColumns_ on Sheets just adds it; here
 * there is no column to add it to. It is recorded (pgUnknownColumns_) instead of thrown, so the
 * parity run can list every one — those are migration-day data losses, found before migration day.
 */

var PG_ = { on: null, conn: null, tenant: '', wb: {}, rejects: [], unknown: {}, missing: {}, noCache: false };

/** Is the Postgres door open for this execution? Read once; a missing property means NO. */
function pgEnabled_() {
  if (PG_.on !== null) return PG_.on;
  var p = PropertiesService.getScriptProperties();
  var on = String(p.getProperty('DB_BACKEND') || '') === 'pg';
  if (on) {
    var target = String(p.getProperty('PG_TARGET') || '');
    if (target === 'production') {
      if (String(p.getProperty('PDPA_SIGNED') || '') !== 'yes')
        throw new Error('PG_TARGET=production ถูกปฏิเสธ: ยังไม่ได้ลงนาม PDPA (PDPA_SIGNED ไม่ใช่ yes)');
    } else if (target !== 'staging') {
      throw new Error('DB_BACKEND=pg ต้องระบุ PG_TARGET เป็น staging หรือ production');
    }
    PG_.tenant = String(p.getProperty('PG_TENANT_ID') || '');
    /* TEST HARNESS ONLY. A real execution serves one request, so a table read once is current for all
     * of it. tools/gas_test_harness.js runs many requests in one process and edits its sheets between
     * them; PG_NO_CACHE=yes makes every access re-read. Never set on the live script. */
    PG_.noCache = String(p.getProperty('PG_NO_CACHE') || '') === 'yes';
    if (!/^[0-9a-f-]{36}$/i.test(PG_.tenant)) throw new Error('PG_TENANT_ID ต้องเป็น uuid');
  }
  return (PG_.on = on);
}

function pgConn_() {
  if (PG_.conn) return PG_.conn;
  var p = PropertiesService.getScriptProperties();
  var c = Jdbc.getConnection(String(p.getProperty('PG_JDBC_URL') || ''),
    String(p.getProperty('PG_USER') || ''), String(p.getProperty('PG_PASSWORD') || ''));
  // the school's clock on every connection — the same reason pg_lib.connect does it (a timestamp
  // written as bare text is read in the SESSION's zone, and the server's is UTC)
  var st = c.createStatement(); st.execute("set time zone 'Asia/Bangkok'"); st.close();
  return (PG_.conn = c);
}

/**
 * 🔴 THE SCHOOL'S WRITE LOCK, SHARED WITH THE CLOUD RUN HOST (2026-11-05).
 *
 * LockService serialises Apps Script against Apps Script. Once the data is in Postgres a second
 * writer exists — server/host.js — and it serialises with `pg_advisory_xact_lock(hashtextextended(
 * tenant, 0))`. Two different locks over one database is the 2026-07-09 wipe waiting to happen
 * again: GAS reads a table, the host commits a row, GAS writes the table back by position.
 *
 * So while Postgres is the backend, a GAS write also holds the SAME advisory key (session-level here,
 * transaction-level there; the two kinds conflict on the same key, which is the point). Taken after
 * LockService, released in `finally`, waited for as long as tryLock waits (25s) — and a lock that
 * cannot be had is BUSY, exactly like a LockService that cannot be had.
 *
 * Switch off (the live script today): pgEnabled_() is false and this is `return fn()` — nothing else.
 */
function pgWriteLock_(fn, onBusy) {
  if (!pgEnabled_()) return fn();
  var c = pgConn_();
  var lock = c.prepareStatement('select pg_advisory_lock(hashtextextended(?, 0))');
  try {
    var st = c.createStatement(); st.execute("set lock_timeout = '25s'"); st.close();
    lock.setString(1, PG_.tenant); lock.executeQuery();
  } catch (e) {
    try { lock.close(); } catch (x) {}
    if (onBusy) return onBusy();
    throw (typeof apiError_ === 'function') ? apiError_('BUSY', (typeof BUSY_MSG_ !== 'undefined') ? BUSY_MSG_ : 'ระบบกำลังบันทึกข้อมูลอยู่ กรุณาลองใหม่อีกครั้ง') : e;
  }
  try { lock.close(); } catch (x) {}
  try { return fn(); }
  finally {
    try { var u = c.prepareStatement('select pg_advisory_unlock(hashtextextended(?, 0))'); u.setString(1, PG_.tenant); u.executeQuery(); u.close(); } catch (e) {}
  }
}

/** The base type of a declared column: 'numeric(12,2)' → 'numeric', 'timestamptz not null…' → 'timestamptz'. */
function pgBase_(t) { return String(t || 'text').split(/[ (]/)[0]; }
function pgQ_(n) { return '"' + String(n).replace(/"/g, '""') + '"'; }

// ── values ─────────────────────────────────────────────────────────────────────────────────────
var PG_TZ_ = 'Asia/Bangkok';
function pgFmt_(d, f) { return Utilities.formatDate(d, PG_TZ_, f); }

/** A value on its way IN — pg_migrate encode_, reproduced. Returns a string or null (null = empty). */
function pgEncode_(v, type, where) {
  if (v === undefined || v === null || v === '') return null;
  var t = pgBase_(type);
  var isDate = Object.prototype.toString.call(v) === '[object Date]';
  if (typeof v === 'object' && !isDate) return JSON.stringify(v);
  var reject = function () { PG_.rejects.push({ where: where, type: t, value: String(v).slice(0, 40) }); return null; };
  if (t === 'numeric') {
    var n;
    if (typeof v === 'number') n = v;
    else {
      var s = String(v).trim();
      n = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? Number(s.replace(/,/g, '')) : NaN;
    }
    return isFinite(n) ? String(Math.round(n * 100) / 100) : reject();
  }
  if (t === 'boolean') {
    if (v === true) return 'true'; if (v === false) return 'false';
    var b = String(v).trim().toUpperCase();
    return ['YES', 'TRUE', '1', 'Y'].indexOf(b) >= 0 ? 'true' : ['NO', 'FALSE', '0', 'N'].indexOf(b) >= 0 ? 'false' : reject();
  }
  if (t === 'date') {
    if (isDate) return isNaN(v.getTime()) ? reject() : pgFmt_(v, 'yyyy-MM-dd');
    var ds = String(v).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ds) ? ds : reject();
  }
  // timestamp BEFORE time — "timestamptz" starts with "time" (the bug pg_migrate already paid for)
  if (t === 'timestamptz' || t === 'timestamp') {
    if (isDate) return isNaN(v.getTime()) ? reject() : pgFmt_(v, 'yyyy-MM-dd HH:mm:ss');
    var ts = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(ts) ? ts : reject();
  }
  if (t === 'time') {
    if (isDate) return pgFmt_(v, 'HH:mm');               // Sheets hands a time cell back as 1899-12-30 HH:mm
    var tm = String(v).trim();
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(tm) ? tm : reject();
  }
  /* A Date INTO A TEXT COLUMN — SCHOOL_CONFIG.Value holding a time, an EndDate the caller wrote as a
   * Date. Sheets keeps it a date cell; String(date) would store "Thu Dec 31 2026 …", which nothing
   * can read back. Written the way decodeCell_ reads a date cell, so the engine sees the same thing:
   * a time-only cell (Sheets' 1899 epoch) as HH:mm, midnight as the day, anything else in full. */
  if (isDate) {
    if (isNaN(v.getTime())) return null;
    if (v.getFullYear() < 1900) return pgFmt_(v, 'HH:mm');
    var full = pgFmt_(v, 'yyyy-MM-dd HH:mm:ss');
    return /00:00:00$/.test(full) ? full.slice(0, 10) : full;
  }
  return String(v);
}

/** A value on its way OUT — what Sheets would have handed the caller for the same cell. */
function pgDecode_(s, type) {
  if (s === null || s === undefined) return '';
  var t = pgBase_(type);
  if (t === 'numeric') { var n = Number(s); return isFinite(n) ? n : s; }
  if (t === 'boolean') return s === 't' || s === 'true' || s === true;
  if (t === 'date') { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : s; }
  if (t === 'timestamptz' || t === 'timestamp') {
    var x = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(String(s));
    return x ? new Date(+x[1], +x[2] - 1, +x[3], +x[4], +x[5], +(x[6] || 0)) : s;   // session zone = the school's
  }
  if (t === 'time') return String(s).slice(0, 5);
  return String(s);
}
/** `?::type` so every parameter can travel as a string (or null) and Postgres does the converting. */
function pgCast_(type) { var t = pgBase_(type); return t === 'text' ? '?' : '?::' + t; }

function pgSet_(st, i, v) { if (v === null) st.setNull(i, 12 /* java.sql.Types.VARCHAR */); else st.setString(i, v); }

// ── the workbook and its sheets ───────────────────────────────────────────────────────────────
function pgWorkbook_(wb) {
  if (PG_.wb[wb]) return PG_.wb[wb];
  var sheets = {};
  var book = {
    __pg: true,
    getName: function () { return 'pg:' + wb; },
    getId: function () { return 'pg:' + wb; },
    getUrl: function () { return ''; },
    getSheetByName: function (name) {
      if (sheets[name]) return sheets[name];
      var def = PG_SCHEMA_[wb + ':' + name];
      if (!def) { PG_.missing[wb + ':' + name] = 1; return null; }   // a sheet with no table: callers see "no sheet"
      return (sheets[name] = pgSheet_(wb, name, def));
    },
    // a sheet that has a table "exists" from the first moment; one with no table cannot be invented
    insertSheet: function (name) {
      var sh = book.getSheetByName(name);
      if (!sh) throw new Error('ไม่มีตาราง Postgres สำหรับชีต ' + name + ' (' + wb + ')');
      return sh;
    },
    getSheets: function () { return Object.keys(PG_SCHEMA_).filter(function (k) { return k.indexOf(wb + ':') === 0; })
      .map(function (k) { return book.getSheetByName(k.slice(wb.length + 1)); }); }
  };
  return (PG_.wb[wb] = book);
}

function pgSheet_(wb, name, def) {
  var cols = def.c;                                       // [[sheetCol, pgCol, type], …]
  var hdr = cols.map(function (c) { return c[0]; });
  var rows = null;                                        // [{ id, vals: [...] }] in seq order
  var load = function () {
    if (rows && !PG_.noCache) return rows;
    var sql = 'select "id"::text,' + cols.map(function (c) { return pgQ_(c[1]) + '::text'; }).join(',') +
      ' from ' + pgQ_(def.t) + ' where "tenant_id" = ?::uuid order by "seq"';
    var st = pgConn_().prepareStatement(sql); st.setString(1, PG_.tenant);
    var rs = st.executeQuery(); rows = [];
    while (rs.next()) {
      var vals = [];
      for (var i = 0; i < cols.length; i++) vals.push(pgDecode_(rs.getString(i + 2), cols[i][2]));
      rows.push({ id: rs.getString(1), vals: vals });
    }
    rs.close(); st.close();
    return rows;
  };
  var colIdx = function (c) { return c - 1; };            // 1-based sheet column → index into hdr

  var insert = function (vals) {
    var names = [], marks = [], params = [];
    for (var i = 0; i < cols.length; i++) {
      var e = pgEncode_(vals[i], cols[i][2], def.t + '.' + cols[i][1]);
      if (e === null) continue;
      names.push(pgQ_(cols[i][1])); marks.push(pgCast_(cols[i][2])); params.push(e);
    }
    var sql = 'insert into ' + pgQ_(def.t) + ' ("tenant_id"' + (names.length ? ',' + names.join(',') : '') +
      ') values (?::uuid' + (marks.length ? ',' + marks.join(',') : '') + ') returning "id"::text';
    var st = pgConn_().prepareStatement(sql); st.setString(1, PG_.tenant);
    for (var j = 0; j < params.length; j++) pgSet_(st, j + 2, params[j]);
    var rs = st.executeQuery(); rs.next(); var id = rs.getString(1); rs.close(); st.close();
    return id;
  };
  var update = function (row, changed) {                  // changed: [colIndex, …]
    var sets = [], params = [];
    changed.forEach(function (i) {
      sets.push(pgQ_(cols[i][1]) + ' = ' + pgCast_(cols[i][2]));
      params.push(pgEncode_(row.vals[i], cols[i][2], def.t + '.' + cols[i][1]));
    });
    var sql = 'update ' + pgQ_(def.t) + ' set ' + sets.join(', ') + ' where "id" = ?::uuid and "tenant_id" = ?::uuid';
    var st = pgConn_().prepareStatement(sql);
    for (var j = 0; j < params.length; j++) pgSet_(st, j + 1, params[j]);
    st.setString(params.length + 1, row.id); st.setString(params.length + 2, PG_.tenant);
    st.executeUpdate(); st.close();
  };
  var remove = function (row) {
    var st = pgConn_().prepareStatement('delete from ' + pgQ_(def.t) + ' where "id" = ?::uuid and "tenant_id" = ?::uuid');
    st.setString(1, row.id); st.setString(2, PG_.tenant); st.executeUpdate(); st.close();
  };
  var blank = function (v) { return v === '' || v === null || v === undefined; };

  var sheet = {
    __pg: true,
    getName: function () { return name; },
    getSheetName: function () { return name; },
    getLastRow: function () { return load().length ? load().length + 1 : 1; },
    getLastColumn: function () { return hdr.length; },
    getMaxColumns: function () { return hdr.length; },
    getMaxRows: function () { return load().length + 1; },
    getFrozenRows: function () { return 1; },
    setFrozenRows: function () { return sheet; },
    getDataRange: function () { return sheet.getRange(1, 1, sheet.getLastRow(), hdr.length); },
    getRange: function (r, c, nr, nc) { return pgRange_(sheet, r, c, nr || 1, nc || 1); },
    appendRow: function (arr) {
      var vals = hdr.map(function (_, i) { return arr[i] === undefined ? '' : arr[i]; });
      load().push({ id: insert(vals), vals: vals });
      return sheet;
    },
    deleteRow: function (r) {
      var i = r - 2; if (i < 0 || i >= load().length) return sheet;
      remove(rows[i]); rows.splice(i, 1); return sheet;
    },
    deleteRows: function (r, n) { for (var k = 0; k < (n || 1); k++) sheet.deleteRow(r); return sheet; },
    // used by writeRows_/ensureColumns_/backup code paths that are no-ops on a table
    deleteColumns: function () { return sheet; }, clear: function () { return sheet; },
    // ---- the grid, as Sheets presents it -----------------------------------------------------
    _cell: function (r, c) {
      if (r === 1) return hdr[colIdx(c)] === undefined ? '' : hdr[colIdx(c)];
      var row = load()[r - 2]; if (!row) return '';
      var v = row.vals[colIdx(c)]; return v === undefined ? '' : v;
    },
    _write: function (r0, c0, values) {
      for (var i = 0; i < values.length; i++) {
        var r = r0 + i;
        if (r === 1) {                                    // header row: ensureColumns_ adding names
          values[i].forEach(function (name2) {
            if (name2 !== '' && hdr.indexOf(String(name2)) < 0) PG_.unknown[wb + ':' + name + '.' + name2] = 1;
          });
          continue;
        }
        load();
        var idx = r - 2;
        while (rows.length < idx) rows.push({ id: insert(hdr.map(function () { return ''; })), vals: hdr.map(function () { return ''; }) });
        if (idx === rows.length) {                        // writing just past the end = a new row
          var nv = hdr.map(function () { return ''; });
          values[i].forEach(function (v, j) { var k = colIdx(c0 + j); if (k < hdr.length) nv[k] = v; });
          rows.push({ id: insert(nv), vals: nv });
          continue;
        }
        var row = rows[idx], changed = [];
        values[i].forEach(function (v, j) {
          var k = colIdx(c0 + j); if (k >= hdr.length) return;
          if (!pgSame_(row.vals[k], v, cols[k][2])) { row.vals[k] = v; changed.push(k); }
        });
        if (changed.length) update(row, changed);
      }
    },
    _clear: function (r0, c0, nr, nc) {
      // Sheets keeps an emptied row as blank space that getLastRow then ignores; a table has no
      // blank space, so a row emptied entirely is deleted (writeRows_ clears trailing rows this way)
      for (var r = r0 + nr - 1; r >= r0; r--) {
        if (r === 1) continue;
        var row = load()[r - 2]; if (!row) continue;
        var changed = [];
        for (var k = colIdx(c0); k < Math.min(hdr.length, colIdx(c0) + nc); k++) if (!blank(row.vals[k])) { row.vals[k] = ''; changed.push(k); }
        if (row.vals.every(blank)) { remove(row); rows.splice(r - 2, 1); }
        else if (changed.length) update(row, changed);
      }
    }
  };
  return sheet;
}

/** Same value as far as the column is concerned — so rewriting a whole row only touches what changed. */
function pgSame_(a, b, type) {
  return pgEncode_(a, type, null) === pgEncode_(b, type, null);
}

function pgRange_(sh, r, c, nr, nc) {
  var rg = {
    getValues: function () {
      var out = [];
      for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(sh._cell(r + i, c + j)); out.push(row); }
      return out;
    },
    getDisplayValues: function () {
      return rg.getValues().map(function (row) { return row.map(function (v) {
        if (Object.prototype.toString.call(v) === '[object Date]') {
          var s = pgFmt_(v, 'yyyy-MM-dd HH:mm:ss'); return /00:00:00$/.test(s) ? s.slice(0, 10) : s;
        }
        return v === null || v === undefined ? '' : String(v);
      }); });
    },
    getValue: function () { return sh._cell(r, c); },
    setValues: function (v) { sh._write(r, c, v); return rg; },
    setValue: function (v) { sh._write(r, c, [[v]]); return rg; },
    clearContent: function () { sh._clear(r, c, nr, nc); return rg; },
    clear: function () { sh._clear(r, c, nr, nc); return rg; },
    getRow: function () { return r; }, getColumn: function () { return c; },
    getNumRows: function () { return nr; }, getNumColumns: function () { return nc; },
    // formatting has no meaning in a table
    setFontWeight: function () { return rg; }, setBackground: function () { return rg; }, setFontColor: function () { return rg; },
    setVerticalAlignment: function () { return rg; }, setNumberFormat: function () { return rg; }, setWrap: function () { return rg; }
  };
  return rg;
}

/** For the parity run and the admin diagnostic: what this execution could not store. */
function pgReport_() {
  return { rejects: PG_.rejects.slice(0, 50), rejectCount: PG_.rejects.length, unknownColumns: Object.keys(PG_.unknown).sort(),
    missingSheets: Object.keys(PG_.missing).sort() };
}

/**
 * ADMIN-ONLY: how long the door takes from Apps Script — WITHOUT OPENING IT.
 *
 * 🔴 It must not need DB_BACKEND=pg. That switch sends EVERY request of the live app to Postgres, so a
 * probe that required it could only be run by moving the whole school onto staging. It needs only the
 * connection properties (PG_JDBC_URL · PG_USER · PG_PASSWORD · PG_TENANT_ID) and reads through its own
 * connection; the app keeps reading Sheets while it runs.
 *
 * Apps Script runs in the United States; the database is in Singapore. Every query crosses the
 * Pacific, so this is measured before anything is built on it — the speed plan's rule.
 */
function handlePgProbe() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PG_JDBC_URL')) return { ok: false, configured: false, note: 'ยังไม่ได้ตั้ง PG_JDBC_URL — ไม่ได้เชื่อมต่อ' };
  var tenant = String(p.getProperty('PG_TENANT_ID') || '');
  var t0 = Date.now(); var c = pgConn_(); var tConn = Date.now() - t0;
  var ping = function () { var t = Date.now(); var st = c.prepareStatement('select 1'); var rs = st.executeQuery(); rs.next(); rs.close(); st.close(); return Date.now() - t; };
  var pings = [ping(), ping(), ping()];
  var t2 = Date.now(), n = 0;
  if (/^[0-9a-f-]{36}$/i.test(tenant)) {
    var st = c.prepareStatement('select count(*)::text from "students" where "tenant_id" = ?::uuid'); st.setString(1, tenant);
    var rs = st.executeQuery(); rs.next(); n = Number(rs.getString(1)); rs.close(); st.close();
  }
  var tCount = Date.now() - t2;
  return { ok: true, configured: true, doorOpen: pgEnabled_(), connectMs: tConn, pingMs: pings, countStudentsMs: tCount, students: n };
}
