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

/** Batch-provision staff: bind LineUID + set Role/PositionLevel/ReportsTo for many at once.
 *  payload: { key, list:[{id, lineUid?, role?, positionLevel?, reportsTo?}] }  (uses `id`, NOT
 *  `staffId`, because applyIdentity_ overwrites payload.staffId from the caller's token.)
 *  Gated by ImportKey. REMOVE with Import.gs after provisioning. */
function handleProvisionStaff(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'provisionStaff: bad or missing key');
  var staff = sheet_(getHrSpreadsheet_(), 'STAFF');
  var done = [];
  (p.list || []).forEach(function (it) {
    var st = findObject_(staff, function (s) { return String(s.StaffID) === String(it.id); });
    if (!st) { done.push(it.id + ':NOT_FOUND'); return; }
    var patch = {};
    if (it.lineUid) patch.LineUID = it.lineUid;
    if (it.role) patch.Role = it.role;
    if (it.positionLevel) patch.PositionLevel = it.positionLevel;
    if (it.reportsTo) patch.ReportsTo = it.reportsTo;
    if (it.nickname) patch.Nickname = it.nickname;
    if (it.dob) patch.DOB = it.dob;
    if (it.set) Object.keys(it.set).forEach(function (k) { patch[k] = it.set[k]; }); // full-field realign (writes by header name, no clearing)
    updateRow_(staff, st._row, patch);
    done.push(it.id + ':ok');
  });
  try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF']); } catch (e) {}
  return { ok: true, done: done };
}

/** Run setupAll() (idempotent — adds any missing sheets/columns from SCHEMA, never deletes).
 *  payload: { key }  — gated by ImportKey. REMOVE with Import.gs after use. */
/** Restore/replace the whole STAFF sheet with a provided list (recovery).
 *  payload: { key, staff:[{...}] }  — gated by ImportKey. REMOVE with Import.gs after use. */
function handleSetStaffFull(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'setStaffFull: bad or missing key');
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  var lr = sh.getLastRow(); if (lr > 1) sh.getRange(2, 1, lr - 1, sh.getLastColumn()).clearContent();
  (p.staff || []).forEach(function (s) { appendObject_(sh, s); });
  try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF']); } catch (e) {}
  return { ok: true, count: (p.staff || []).length };
}

function handleRunSetup(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'runSetup: bad or missing key');
  setupAll();
  try { CacheService.getScriptCache().removeAll(['cfg', 'col:STAFF', 'rows:STAFF']); } catch (e) {}
  return { ok: true, ran: 'setupAll' };
}

/** Install the time-based triggers (06:50 check-in reminder, 18:30 checkout, 01:00 backup).
 *  payload: { key }  — gated by ImportKey. REMOVE with Import.gs after use. */
function handleRunTriggers(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'runTriggers: bad or missing key');
  installTriggers();
  return { ok: true, triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) };
}

/** Set a SCHOOL_CONFIG key directly (e.g. flip RequireSessionToken at go-live) + flush the config cache.
 *  payload: { key, cfgKey, cfgValue }  — gated by ImportKey. REMOVE with Import.gs at go-live. */
function handleSetConfig(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'setConfig: bad or missing key');
  if (!p.cfgKey) throw apiError_('BAD_INPUT', 'ต้องระบุ cfgKey');
  var cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  var r = findObject_(cfg, function (x) { return String(x.Key) === String(p.cfgKey); });
  if (r) updateRow_(cfg, r._row, { Value: p.cfgValue });
  else appendObject_(cfg, { Key: p.cfgKey, Value: p.cfgValue });
  try { _configCache = null; } catch (e) {}
  try { CacheService.getScriptCache().remove('cfg'); } catch (e) {}
  return { ok: true, cfgKey: p.cfgKey, cfgValue: p.cfgValue };
}

/** Grant a LINE userId a role via the USERS sheet (e.g. a system/dev admin who isn't school staff).
 *  payload: { key, lineUid, role, linkedId? }  — gated by ImportKey. REMOVE with Import.gs at go-live. */
function handleAddUser(p) {
  var key = getConfig_('ImportKey', 'atom-import-2026');
  if (!p || String(p.key) !== String(key)) throw apiError_('FORBIDDEN', 'addUser: bad or missing key');
  if (!p.lineUid || !p.role) throw apiError_('BAD_INPUT', 'ต้องระบุ lineUid และ role');
  var users = sheet_(getMainSpreadsheet_(), 'USERS');
  var ex = findObject_(users, function (u) { return String(u.LineUID) === String(p.lineUid); });
  if (ex) { updateRow_(users, ex._row, { Role: p.role, LinkedID: p.linkedId || ex.LinkedID, Status: 'ACTIVE' });
    try { CacheService.getScriptCache().removeAll(['col:USERS', 'rows:USERS']); } catch (e) {}
    return { ok: true, updated: ex.UserID, role: p.role }; }
  var uid = nextId_(users, 'UserID', 'U');
  appendObject_(users, { UserID: uid, LineUID: p.lineUid, Role: p.role, LinkedID: p.linkedId || '', PasswordHash: '', CreatedDate: new Date(), Status: 'ACTIVE' });
  try { CacheService.getScriptCache().removeAll(['col:USERS', 'rows:USERS']); } catch (e) {}
  return { ok: true, userId: uid, role: p.role };
}
