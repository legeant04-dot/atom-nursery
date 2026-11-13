/**
 * Rollback.gs — P4 of docs/ROLLOUT_PLAN.md: Postgres → Sheets, for the night we have to go back
 * ================================================================================================
 *
 * After stage A the school's data lives in Postgres and the spreadsheets are a snapshot of the move
 * night. Switching DB_BACKEND off would put the app back on that snapshot and silently drop every
 * record written since — a payment, a check-in, a leave. This file carries those writes back first.
 *
 * 🔴 RUN FROM THE APPS SCRIPT EDITOR ONLY. Nothing here is a route (Code.gs dispatches by an explicit
 * table, never by function name — tools/test_rollback.js asserts none of these names is in it).
 *
 * THE ORDER, AND WHY EACH STEP IS SEPARATE
 *   1. Freeze writes (WRITE_FREEZE = on — the switch of P6b). A record written while we copy is a
 *      record left behind. rollbackToSheets refuses to start without it.
 *   2. rollbackToSheets()      — COPIES the move-night spreadsheets (Drive makeCopy keeps formats,
 *      validation and the sheets Postgres never had), then fills each copy's tables from Postgres and
 *      READS EVERY CELL BACK to compare. Resumable: it stops before Apps Script's 6-minute limit and
 *      picks up where it left off when run again. The originals are never written.
 *   3. Read the report. Any mismatch = do not activate; the app is still on Postgres and nothing
 *      has changed for anyone.
 *   4. rollbackActivate()      — points WB_MAIN_ID / WB_HR_ID at the copies and turns DB_BACKEND off.
 *      The old ids are kept, so rollbackUndoActivate() returns to Postgres exactly as it was.
 *   5. Unfreeze.
 *
 * WHAT IS WRITTEN: what DbPg hands the app for the same cell (pgDecode_), so the app reads the copy
 * exactly as it read Postgres — the property the 57 parity suites proved for DbPg. Two refinements so
 * a cell is not changed by Sheets' own parsing on the way in:
 *   · a date/timestamp column whose cells on the snapshot were TEXT is written back as text in the
 *     same shape (a Date written into it would change what the app reads);
 *   · a text value that Sheets would turn into a number (0812…, +66…) gets the leading apostrophe
 *     Sheets uses for "this is text" — it is not part of the value.
 * The read-back compares every cell with pgSame_ (the column's own encoding), so anything else Sheets
 * does to a value is a reported mismatch, not a quiet change.
 */

var RB_STATE_KEY_  = 'ROLLBACK_STATE';
var RB_FREEZE_KEY_ = 'WRITE_FREEZE';          // P6b reads the same property — one switch for both
var RB_BUDGET_MS_  = 270000;                  // 4.5 of Apps Script's 6 minutes; the rest is margin
var RB_MAX_LIST_   = 20;                      // mismatches listed per sheet (all are counted)

/** Step 2. Run, read the report, run again until `finished`. */
function rollbackToSheets() { var r = rbRun_({}); Logger.log(JSON.stringify(r, null, 1)); return r; }
/** Step 4 — only after a finished run with no mismatch. */
function rollbackActivate() { var r = rbActivate_(); Logger.log(JSON.stringify(r)); return r; }
/** Undo step 4: back to Postgres and the move-night ids. */
function rollbackUndoActivate() { var r = rbUndoActivate_(); Logger.log(JSON.stringify(r)); return r; }
/** Forget a run (the copies stay in Drive; delete them by hand if unwanted). */
function rollbackReset() { PropertiesService.getScriptProperties().deleteProperty(RB_STATE_KEY_); return { ok: true }; }

function rbProps_() { return PropertiesService.getScriptProperties(); }
function rbState_() { var s = rbProps_().getProperty(RB_STATE_KEY_); return s ? JSON.parse(s) : null; }
function rbSave_(st) { rbProps_().setProperty(RB_STATE_KEY_, JSON.stringify(st)); }

/** opts: { budgetMs, now } — for tests; the editor entry passes {}. */
function rbRun_(opts) {
  opts = opts || {};
  var t0 = Date.now(), budget = opts.budgetMs || RB_BUDGET_MS_;
  var p = rbProps_();
  if (!pgEnabled_()) return { ok: false, code: 'NOT_ON_POSTGRES', note: 'DB_BACKEND ไม่ใช่ pg — ข้อมูลยังอยู่ในชีต ไม่มีอะไรต้องย้ายกลับ' };
  /* both halves of the switch (src/Freeze.gs): Apps Script's property AND the SCHOOL_CONFIG row the
   * Cloud Run host reads — one without the other leaves a writer running while we copy */
  _configCache = null;
  if (String(p.getProperty(RB_FREEZE_KEY_) || '') !== 'on' || String(getConfig_('WriteFreeze', '')).trim().toLowerCase() !== 'on')
    return { ok: false, code: 'NOT_FROZEN', note: 'ต้องปิดรับการเขียนก่อน — รัน freezeWrites() · ไม่งั้นข้อมูลที่เขียนระหว่างคัดลอกจะหาย' };

  var st = rbState_();
  if (!st) {
    var stamp = Utilities.formatDate(opts.now || new Date(), PG_TZ_, 'yyyy-MM-dd HH:mm');
    st = { startedAt: stamp, books: {}, done: {}, finished: false };
    [['MAIN', PROP.MAIN_ID], ['HR', PROP.HR_ID]].forEach(function (b) {
      var src = getWorkbookId_(b[1]);
      var copy = DriveApp.getFileById(src).makeCopy('Atom ' + b[0] + ' · ย้อนจาก Postgres ' + stamp);
      st.books[b[0]] = { prop: b[1], src: src, copy: copy.getId() };
    });
    st.order = Object.keys(PG_SCHEMA_).sort();
    rbSave_(st);
  }
  if (st.finished) return rbReport_(st);

  for (var i = 0; i < st.order.length; i++) {
    var key = st.order[i];
    if (st.done[key]) continue;
    if (Date.now() - t0 > budget) { rbSave_(st); var part = rbReport_(st); part.note = 'ยังไม่ครบ — รัน rollbackToSheets อีกครั้ง'; return part; }
    var wb = key.split(':')[0], name = key.slice(wb.length + 1);
    st.done[key] = rbCopySheet_(wb, name, SpreadsheetApp.openById(st.books[wb].copy));
    rbSave_(st);
  }
  st.finished = true; rbSave_(st);
  return rbReport_(st);
}

function rbReport_(st) {
  var keys = Object.keys(st.done), bad = [], lost = [], rows = 0, mism = 0;
  keys.forEach(function (k) {
    var d = st.done[k]; rows += d.rows; mism += d.mismatchCount;
    if (d.mismatchCount) bad.push(k + ' (' + d.mismatchCount + ')');
    if (d.lostCols.length) lost.push(k + ': ' + d.lostCols.join(','));
  });
  return { ok: mism === 0, finished: !!st.finished, startedAt: st.startedAt, sheets: keys.length + '/' + st.order.length,
    rows: rows, mismatches: mism, mismatchedSheets: bad, columnsNotInPostgres: lost,
    copies: { MAIN: st.books.MAIN && st.books.MAIN.copy, HR: st.books.HR && st.books.HR.copy },
    canActivate: !!st.finished && mism === 0, detail: rbDetail_(st.done) };
}
/** Only the tables worth reading: something was copied, missed, or not in Postgres. */
function rbDetail_(done) {
  var out = {};
  Object.keys(done).forEach(function (k) { var d = done[k];
    if (d.rows || d.mismatchCount || d.lostCols.length) out[k] = { rows: d.rows, mismatchCount: d.mismatchCount, mismatches: d.mismatches, lostCols: d.lostCols }; });
  return out;
}

/** One table → the same-named sheet of the copy, then every cell read back. */
function rbCopySheet_(wb, name, target) {
  var def = PG_SCHEMA_[wb + ':' + name];
  var cols = def.c;                                        // [[sheetCol, pgCol, type], …]
  var src = pgWorkbook_(wb).getSheetByName(name);
  var n = src.getLastRow() - 1;
  var pgVals = n > 0 ? src.getRange(2, 1, n, cols.length).getValues() : [];

  var sh = target.getSheetByName(name) || target.insertSheet(name);
  var oldLast = sh.getLastRow(), oldCols = Math.max(sh.getLastColumn(), 1);
  var head = oldLast >= 1 ? sh.getRange(1, 1, 1, oldCols).getValues()[0].map(function (h) { return String(h); }) : [];
  while (head.length && head[head.length - 1] === '') head.pop();
  var at = {}; cols.forEach(function (c, i) { at[c[0]] = i; });
  var added = [];
  cols.forEach(function (c) { if (head.indexOf(c[0]) < 0) { head.push(c[0]); added.push(c[0]); } });
  var lostCols = head.filter(function (h) { return h !== '' && at[h] === undefined; });

  // how the snapshot held each date-ish column: as Dates, or as text of a given shape
  var sample = oldLast > 1 ? sh.getRange(2, 1, Math.min(oldLast - 1, 200), Math.min(oldCols, head.length)).getValues() : [];
  var style = head.map(function (h, j) {
    var k = at[h]; if (k === undefined) return null;
    var t = pgBase_(cols[k][2]); if (t !== 'date' && t !== 'timestamptz' && t !== 'timestamp') return null;
    for (var r = 0; r < sample.length; r++) {
      var v = sample[r][j]; if (v === '' || v === null || v === undefined) continue;
      if (Object.prototype.toString.call(v) === '[object Date]') return null;
      var s = String(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? 'yyyy-MM-dd' : /T/.test(s) ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd HH:mm:ss';
    }
    return null;
  });

  var out = pgVals.map(function (row) {
    return head.map(function (h, j) {
      var k = at[h]; if (k === undefined) return '';
      return rbCell_(row[k], cols[k][2], style[j]);
    });
  });

  var width = Math.max(head.length, oldCols);
  if (oldLast > 1) sh.getRange(2, 1, oldLast - 1, width).clearContent();
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  if (out.length) {
    if (typeof sh.getMaxRows === 'function' && typeof sh.insertRowsAfter === 'function' && sh.getMaxRows() < out.length + 1)
      sh.insertRowsAfter(sh.getMaxRows(), out.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, out.length, head.length).setValues(out);
  }

  // every cell back, compared the way the column itself compares values
  var back = out.length ? sh.getRange(2, 1, out.length, head.length).getValues() : [];
  var list = [], count = 0;
  if (sh.getLastRow() - 1 !== out.length) { count++; list.push({ row: 0, col: '(rows)', want: out.length, got: sh.getLastRow() - 1 }); }
  for (var r = 0; r < pgVals.length; r++) {
    for (var j = 0; j < head.length; j++) {
      var k = at[head[j]]; if (k === undefined) continue;
      var got = back[r] ? back[r][j] : '';
      if (!pgSame_(got, pgVals[r][k], cols[k][2])) {
        count++;
        if (list.length < RB_MAX_LIST_) list.push({ row: r + 2, col: head[j], want: String(pgEncode_(pgVals[r][k], cols[k][2], null)), got: String(pgEncode_(got, cols[k][2], null)) });
      }
    }
  }
  return { rows: out.length, mismatchCount: count, mismatches: list, lostCols: lostCols, addedCols: added };
}

/** A decoded Postgres value, in the form Sheets will store unchanged. */
function rbCell_(v, type, textStyle) {
  if (v === '' || v === null || v === undefined) return '';
  var isDate = Object.prototype.toString.call(v) === '[object Date]';
  if (isDate && textStyle) return pgFmt_(v, textStyle);
  if (typeof v === 'string' && pgBase_(type) === 'text' && /^(0\d+|\+\d+)$/.test(v)) return "'" + v;
  return v;
}

function rbActivate_() {
  var st = rbState_();
  if (!st || !st.finished) return { ok: false, code: 'NOT_FINISHED', note: 'ยังคัดลอกไม่ครบ — รัน rollbackToSheets ก่อน' };
  var rep = rbReport_(st);
  if (!rep.canActivate) return { ok: false, code: 'MISMATCH', note: 'มีช่องที่ไม่ตรง ' + rep.mismatches + ' ช่อง — ห้ามสลับ', report: rep };
  var p = rbProps_();
  ['MAIN', 'HR'].forEach(function (b) {
    var bk = st.books[b];
    p.setProperty('ROLLBACK_PREV_' + bk.prop, bk.src);
    p.setProperty(bk.prop, bk.copy);
  });
  p.setProperty('ROLLBACK_PREV_DB_BACKEND', String(p.getProperty('DB_BACKEND') || ''));
  p.setProperty('DB_BACKEND', 'sheets');
  if (typeof resetWorkbookCache_ === 'function') resetWorkbookCache_();
  PG_.on = null;
  return { ok: true, note: 'แอปอ่าน/เขียนชีตชุดที่คัดลอกแล้ว · อย่าลืมเปิดรับการเขียน (WRITE_FREEZE) และสลับ Cloud Run กลับ', copies: rep.copies };
}

function rbUndoActivate_() {
  var p = rbProps_(), done = [];
  [PROP.MAIN_ID, PROP.HR_ID].forEach(function (k) {
    var prev = p.getProperty('ROLLBACK_PREV_' + k);
    if (prev) { p.setProperty(k, prev); p.deleteProperty('ROLLBACK_PREV_' + k); done.push(k); }
  });
  var db = p.getProperty('ROLLBACK_PREV_DB_BACKEND');
  if (db !== null && db !== undefined) { p.setProperty('DB_BACKEND', db); p.deleteProperty('ROLLBACK_PREV_DB_BACKEND'); done.push('DB_BACKEND'); }
  if (typeof resetWorkbookCache_ === 'function') resetWorkbookCache_();
  PG_.on = null;
  return { ok: done.length > 0, restored: done };
}
