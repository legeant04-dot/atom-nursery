/**
 * Import.gs — ONE-TIME real-data import (go-live). Gated by SCHOOL_CONFIG ImportKey.
 * ------------------------------------------------------------------
 * Clears the demo rows, then writes real STUDENTS / PARENTS / STAFF + the Plans rate card.
 * ⚠️ TEMPORARY: remove this file + the ROUTES.importData entry after the import is verified.
 * payload: { key, plans:[], students:[], parents:[], staff:[] }
 * ------------------------------------------------------------------
 */
function handleImport(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'import: bad or missing key');
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  function clear(ss, name) { var sh = sheet_(ss, name); var lr = sh.getLastRow(); if (lr > 1) sh.getRange(2, 1, lr - 1, sh.getLastColumn()).clearContent(); }

  // 1) wipe demo data (idempotent — safe to re-run)
  ['STUDENTS', 'PARENTS', 'USER_LINKS', 'CHECKIN_STUDENT', 'GROWTH_RECORDS', 'DAILY_JOURNAL', 'BILLING', 'DSPM_ASSESSMENT', 'ANNOUNCEMENTS'].forEach(function (n) { clear(MAIN, n); });
  ['STAFF', 'CHECKIN_STAFF', 'WORK_SCHEDULE', 'PAYROLL'].forEach(function (n) { clear(HR, n); });

  // 2) Plans rate card -> SCHOOL_CONFIG (JSON in the Value cell)
  if (p.plans) {
    var cfg = sheet_(MAIN, 'SCHOOL_CONFIG');
    var r = findObject_(cfg, function (x) { return String(x.Key) === 'Plans'; });
    if (r) updateRow_(cfg, r._row, { Value: JSON.stringify(p.plans) });
    else appendObject_(cfg, { Key: 'Plans', Value: JSON.stringify(p.plans) });
  }

  // 3) records (appendObject_ writes only columns that exist in the schema; unknown keys ignored)
  (p.students || []).forEach(function (s) { appendObject_(sheet_(MAIN, 'STUDENTS'), s); });
  (p.parents || []).forEach(function (pr) { appendObject_(sheet_(MAIN, 'PARENTS'), pr); });
  (p.staff || []).forEach(function (st) { appendObject_(sheet_(HR, 'STAFF'), st); });

  // 4) flush read caches so the new data is served immediately
  try {
    var keys = ['cfg'];
    ['STUDENTS', 'PARENTS', 'USER_LINKS', 'STAFF', 'CHECKIN_STAFF', 'GROWTH_RECORDS', 'DAILY_JOURNAL', 'BILLING', 'ANNOUNCEMENTS', 'WORK_SCHEDULE']
      .forEach(function (s) { keys.push('col:' + s, 'rows:' + s); });
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) {}

  return { ok: true, students: (p.students || []).length, parents: (p.parents || []).length, staff: (p.staff || []).length };
}

/** Bind a staff member's LINE userId (and optionally set their Role) so they can log in via LINE.
 *  payload: { key, staffId, lineUid, role? }  — gated by ImportKey. REMOVE with Import.gs at go-live. */
function handleBindStaff(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'bindStaff: bad or missing key');
  if (!p.staffId || !p.lineUid) throw apiError_('BAD_INPUT', 'ต้องระบุ staffId และ lineUid');
  var staff = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(staff, function (s) { return String(s.StaffID) === String(p.staffId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + p.staffId);
  var patch = { LineUID: p.lineUid };
  if (p.role) patch.Role = p.role;
  updateRow_(staff, st._row, patch);
  try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF']); } catch (e) {}
  return { ok: true, staffId: p.staffId, lineUid: p.lineUid, role: p.role || st.Role };
}
