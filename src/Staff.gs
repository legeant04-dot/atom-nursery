/**
 * Staff.gs — in-place STAFF writes (Admin CRUD).
 * ------------------------------------------------------------------
 * These override the engine's saveStaff/deleteStaff (which rewrite the WHOLE
 * staff collection on persist — a single short read there wipes every other row).
 * Here each edit touches ONLY its own row (updateRow_ / deleteRow / appendObject_),
 * so an edit can never delete other staff. The form sends NameTH; the sheet column
 * is Name — map it here.
 * ------------------------------------------------------------------
 */
function handleSaveStaff(p) {
  p = p || {};
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  try { ensureColumns_(sh, ['NicknameEN', 'Classes', 'CanClassOrg']); } catch (e) {}
  var d = p.data || {};
  var row = {};
  for (var k in d) { if (d.hasOwnProperty(k)) row[k] = d[k]; }
  if (d.NameTH !== undefined) row.Name = d.NameTH;         // sheet column is Name (engine alias Name->NameTH)
  delete row.NameTH;

  if (p.staffId) {                                          // edit existing — patch one row only
    var st = findObject_(sh, function (s) { return String(s.StaffID) === String(p.staffId); });
    if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + p.staffId);
    updateRow_(sh, st._row, row);
    staffCacheBust_();
    return { ok: true, staffId: p.staffId };
  }
  var id = nextId_(sh, 'StaffID', 'STF', 3);                // new staff
  row.StaffID = id;
  if (!row.Role) row.Role = 'Teacher';
  if (!row.Status) row.Status = 'ACTIVE';
  appendObject_(sh, row);
  staffCacheBust_();
  return { ok: true, staffId: id };
}

// Staff edits their OWN record — whitelisted fields, in-place. staffId is injected by applyIdentity_
// (teacher/leader can only ever be themselves; admin may target another from the manage screen).
function handleSaveStaffSelf(p) {
  p = p || {};
  if (!p.staffId) throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่');
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(sh, function (s) { return String(s.StaffID) === String(p.staffId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + p.staffId);
  var d = p.data || {}, WHITE = ['NameEN', 'Nickname', 'NicknameEN', 'Phone', 'DOB', 'Photo'];
  var row = {};
  WHITE.forEach(function (k) { if (d[k] !== undefined) row[k] = d[k]; });
  updateRow_(sh, st._row, row);
  staffCacheBust_();
  return { ok: true, staffId: p.staffId };
}

// Toggle a staff's check-in requirement in place (the engine version rewrote the whole STAFF sheet).
function handleSetRequireCheckin(p) {
  p = p || {};
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(sh, function (s) { return String(s.StaffID) === String(p.staffId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + p.staffId);
  updateRow_(sh, st._row, { RequireCheckin: !!p.value });
  staffCacheBust_();
  return { staffId: p.staffId, value: !!p.value };
}

function handleDeleteStaff(p) {
  p = p || {};
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(sh, function (s) { return String(s.StaffID) === String(p.staffId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + p.staffId);
  sh.deleteRow(st._row);
  staffCacheBust_();
  return { ok: true };
}

function staffCacheBust_() {
  try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF']); } catch (e) {}
}

// ---- in-place STUDENT / PARENT writes (same wipe-safety as staff) ----
function recCacheBust_(sheetName) { try { CacheService.getScriptCache().removeAll(['col:' + sheetName, 'rows:' + sheetName]); } catch (e) {} }
function mapName_(d) { var row = {}; for (var k in d) { if (d.hasOwnProperty(k)) row[k] = d[k]; } if (d.NameTH !== undefined) { row.Name = d.NameTH; delete row.NameTH; } return row; }

function handleSaveStudent(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  try { ensureColumns_(sh, ['OTRate', 'StartTime', 'EndTime', 'OTGraceUntil', 'RateNote']); } catch (e) {}   // per-student OT rate + individual schedule + OT-free cutoff + parent note
  var row = mapName_(p.data || {});
  var st = findObject_(sh, function (s) { return String(s.StudentID) === String(p.studentId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบนักเรียน ' + p.studentId);
  updateRow_(sh, st._row, row);
  recCacheBust_('STUDENTS');
  return { ok: true, studentId: p.studentId };
}

// Admin: unlink ONE parent from a child WITHOUT withdrawing the child. In-place — USER_LINKS is a
// no-shrink sheet, so deleting rows must go through deleteRow (the engine's full rewrite is blocked).
function handleUnlinkStudent(p) {
  p = p || {};
  if (!p.studentId || (!p.parentId && !p.uid)) throw apiError_('BAD_INPUT', 'ต้องระบุนักเรียนและผู้ปกครอง');
  var uid = p.uid || '';
  var pSheet = sheet_(getMainSpreadsheet_(), 'PARENTS');
  if (!uid && p.parentId) { var pa = findObject_(pSheet, function (x) { return String(x.ParentID) === String(p.parentId); }); if (pa) uid = pa.LineUID; }
  var removed = 0;
  var ul = sheet_(getMainSpreadsheet_(), 'USER_LINKS');
  // delete matching links bottom-up so row indices stay valid
  var links = readObjects_(ul).filter(function (l) { return String(l.StudentID) === String(p.studentId) && uid && String(l.UserUID) === String(uid); });
  links.sort(function (a, b) { return b._row - a._row; }).forEach(function (l) { ul.deleteRow(l._row); removed++; });
  // legacy linkage: if the student's ParentID points to this parent, clear it too
  var stSheet = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var st = findObject_(stSheet, function (s) { return String(s.StudentID) === String(p.studentId); });
  if (st && p.parentId && String(st.ParentID) === String(p.parentId)) { updateRow_(stSheet, st._row, { ParentID: '' }); recCacheBust_('STUDENTS'); }
  try { CacheService.getScriptCache().removeAll(['rows:USER_LINKS', 'col:USER_LINKS']); } catch (e) {}
  try { logAudit(p.adminId || 'admin', 'UNLINK_STUDENT', 'USER_LINKS', String(p.studentId) + ' <-> ' + (p.parentId || uid)); } catch (e) {}
  return { ok: true, removed: removed };
}

function handleSaveParent(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'PARENTS');
  try { ensureColumns_(sh, ['Nickname', 'NicknameEN', 'Title']); } catch (e) {}
  var row = mapName_(p.data || {});
  if (p.parentId) {
    var pa = findObject_(sh, function (x) { return String(x.ParentID) === String(p.parentId); });
    if (!pa) throw apiError_('NOT_FOUND', 'ไม่พบผู้ปกครอง ' + p.parentId);
    updateRow_(sh, pa._row, row);
    recCacheBust_('PARENTS');
    return { ok: true, parentId: p.parentId };
  }
  var id = nextId_(sh, 'ParentID', 'PAR', 3);
  row.ParentID = id;
  appendObject_(sh, row);
  recCacheBust_('PARENTS');
  return { ok: true, parentId: id };
}

// Parent self-service edit: in-place, own row only, whitelisted fields (parentId is injected from the
// session token in applyIdentity_, so a parent can only ever patch themselves; never ID/NationalID/LineUID).
function handleSaveParentSelf(p) {
  p = p || {};
  if (!p.parentId) throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่');
  var sh = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var pa = findObject_(sh, function (x) { return String(x.ParentID) === String(p.parentId); });
  if (!pa) throw apiError_('NOT_FOUND', 'ไม่พบผู้ปกครอง ' + p.parentId);
  try { ensureColumns_(sh, ['Nickname', 'NicknameEN', 'Title']); } catch (e) {}
  var d = p.data || {}, WHITE = ['NameTH', 'NameEN', 'Nickname', 'NicknameEN', 'Title', 'Relationship', 'Phone', 'Occupation', 'Workplace', 'OfficePhone', 'Address'];
  var row = {};
  WHITE.forEach(function (k) { if (d[k] !== undefined) row[k] = d[k]; });
  if (row.NameTH !== undefined) { row.Name = row.NameTH; delete row.NameTH; }  // sheet column is Name
  updateRow_(sh, pa._row, row);
  recCacheBust_('PARENTS');
  return { ok: true, parentId: p.parentId };
}

// ---- Departments master (SCHOOL_CONFIG 'Departments', comma-separated) — persisted CRUD ----
// The engine's add/rename/removeDepartment only mutate in-memory config, so on GAS they never
// persisted; these write SCHOOL_CONFIG so the department list survives + the staff dropdown reflects it.
function departmentsList_() {
  var cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  var r = findObject_(cfg, function (x) { return String(x.Key) === 'Departments'; });
  return String((r && r.Value) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function writeDepartments_(list) {
  var cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  var r = findObject_(cfg, function (x) { return String(x.Key) === 'Departments'; });
  if (r) updateRow_(cfg, r._row, { Value: list.join(',') });
  else appendObject_(cfg, { Key: 'Departments', Value: list.join(',') });
  try { CacheService.getScriptCache().remove('cfg'); } catch (e) {}
  return list;
}
function handleAddDepartment(p) {
  var l = departmentsList_(), n = String((p && p.name) || '').trim();
  if (!n) throw apiError_('MISSING', 'ใส่ชื่อแผนก');
  if (l.indexOf(n) >= 0) throw apiError_('DUP', 'มีแผนกนี้แล้ว');
  l.push(n); return { ok: true, departments: writeDepartments_(l) };
}
function handleRemoveDepartment(p) {
  var l = departmentsList_(), i = l.indexOf((p && p.name) || '');
  if (i >= 0) l.splice(i, 1);
  return { ok: true, departments: writeDepartments_(l) };
}
function handleRenameDepartment(p) {
  var l = departmentsList_(), i = l.indexOf((p && p.old) || '');
  if (i < 0) throw apiError_('NOT_FOUND', 'ไม่พบแผนก');
  l[i] = String((p && p['new']) || '').trim(); return { ok: true, departments: writeDepartments_(l) };
}

// Admin edits whitelisted SCHOOL_CONFIG keys (geofence etc.) in-place. Admin-only (applyIdentity_ guard).
function handleSetSchoolConfig(p) {
  p = p || {};
  var WHITE = { GPS_Lat: 1, GPS_Lng: 1, Radius: 1, LateGraceMinutes: 1, OTRatePerHour: 1, OTGraceMinutes: 1, StaffOTHourlyRate: 1, OTRoundUpMinutes: 1, DefaultCheckInTime: 1, DefaultCheckOutTime: 1, BigCleaningAmount: 1, BigCleaningIn: 1, BigCleaningOut: 1,
    AdminLineNotify: 1, DigestMorning: 1, DigestEvening: 1 };   // notification prefs (in-app inbox vs LINE + daily digests)
  var vals = p.values || {};
  var cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG'), wrote = {};
  Object.keys(vals).forEach(function (k) {
    if (!WHITE[k]) return;
    var r = findObject_(cfg, function (x) { return String(x.Key) === String(k); });
    if (r) updateRow_(cfg, r._row, { Value: vals[k] });
    else appendObject_(cfg, { Key: k, Value: vals[k] });
    wrote[k] = vals[k];
  });
  try { _configCache = null; } catch (e) {}
  try { CacheService.getScriptCache().remove('cfg'); } catch (e) {}
  return { ok: true, wrote: wrote };
}

// Admin package (Plan) CRUD — persist the full Plans array as JSON in SCHOOL_CONFIG (in-place). Admin-only.
// hydrateConfig_ JSON-parses it back into cfg.Plans (an array) on the next request.
function handleSavePlans(p) {
  p = p || {};
  var arr = (p.plans && p.plans.length) ? p.plans : [];
  arr.forEach(function (pl) { if (!pl.id) pl.id = 'pkg_' + Math.random().toString(36).slice(2, 8); pl.price = Number(pl.price || 0); });
  setConfigValue_('Plans', JSON.stringify(arr));
  return { ok: true, plans: arr };
}

// Admin deletes a bill in-place (one BILLING row). Admin-only (guarded in applyIdentity_).
function handleDeleteBill(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'BILLING');
  var b = findObject_(sh, function (x) { return String(x.BillingID) === String(p.billingId); });
  if (!b) throw apiError_('NOT_FOUND', 'ไม่พบบิล ' + p.billingId);
  sh.deleteRow(b._row);
  recCacheBust_('BILLING');
  return { ok: true };
}

// students linked to a LINE uid (USER_LINKS + PARENTS.LineUID) — used to authorize co-parent/child edits.
function familyStudentIds_(uid) {
  var ids = {};
  readObjects_(sheet_(getMainSpreadsheet_(), 'USER_LINKS')).forEach(function (l) { if (String(l.UserUID) === String(uid)) ids[String(l.StudentID)] = 1; });
  readObjects_(sheet_(getMainSpreadsheet_(), 'PARENTS')).forEach(function (pr) { if (String(pr.LineUID) === String(uid) && pr.StudentID) ids[String(pr.StudentID)] = 1; });
  return ids;
}

// edit a parent that is the caller OR a co-parent of the caller's child (share a StudentID). Whitelisted.
function handleSaveFamilyParent(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var tid = p.targetParentId || p.parentId;
  var pa = findObject_(sh, function (x) { return String(x.ParentID) === String(tid); });
  if (!pa) throw apiError_('NOT_FOUND', 'ไม่พบผู้ปกครอง ' + tid);
  var ok = (String(tid) === String(p.parentId));
  if (!ok) { var ids = familyStudentIds_(p.uid); if (pa.StudentID && ids[String(pa.StudentID)]) ok = true; }
  if (!ok) throw apiError_('NO_ACCESS', 'ไม่มีสิทธิ์แก้ไขผู้ปกครองนี้');
  try { ensureColumns_(sh, ['Nickname', 'NicknameEN', 'Title', 'LinePictureUrl']); } catch (e) {}
  // Photo is uploadable by the parent; '' clears it so the display falls back to their LINE picture.
  // (a data: URL is offloaded to Drive by updateRow_ -> driveifyImage_; LinePictureUrl is never written here)
  var d = p.data || {}, WHITE = ['NameTH', 'NameEN', 'Nickname', 'NicknameEN', 'Title', 'Relationship', 'Phone', 'Occupation', 'Workplace', 'OfficePhone', 'Address', 'Photo'];
  var row = {};
  WHITE.forEach(function (k) { if (d[k] !== undefined) row[k] = d[k]; });
  if (row.NameTH !== undefined) { row.Name = row.NameTH; delete row.NameTH; }
  updateRow_(sh, pa._row, row);
  recCacheBust_('PARENTS');
  return { ok: true, parentId: tid };
}

// parent edits their own child's safe fields (studentId ownership enforced upstream by applyIdentity_).
function handleSaveStudentSelf(p) {
  p = p || {};
  if (!p.studentId) throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่');
  var sh = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var st = findObject_(sh, function (x) { return String(x.StudentID) === String(p.studentId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบนักเรียน ' + p.studentId);
  var d = p.data || {}, WHITE = ['Nickname', 'NicknameEN', 'BloodType', 'RH', 'Allergy', 'MedicalHistory', 'EmergencyContact', 'Address', 'Race', 'Nationality', 'Religion', 'Photo'];
  var row = {};
  WHITE.forEach(function (k) { if (d[k] !== undefined) row[k] = d[k]; });
  updateRow_(sh, st._row, row);
  recCacheBust_('STUDENTS');
  return { ok: true, studentId: p.studentId };
}

function handleDeleteParent(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var pa = findObject_(sh, function (x) { return String(x.ParentID) === String(p.parentId); });
  if (!pa) throw apiError_('NOT_FOUND', 'ไม่พบผู้ปกครอง ' + p.parentId);
  sh.deleteRow(pa._row);
  recCacheBust_('PARENTS');
  return { ok: true };
}

function handleRemoveStudent(p) {
  p = p || {};
  if (!p.reason) throw apiError_('MISSING', 'กรุณาเลือกเหตุผลในการนำข้อมูลออก');
  var sh = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var st = findObject_(sh, function (s) { return String(s.StudentID) === String(p.studentId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบนักเรียน ' + p.studentId);
  updateRow_(sh, st._row, { Status: 'WITHDRAWN', WithdrawReason: p.reason, WithdrawDetail: p.detail || '', WithdrawDate: dateStr_(new Date()) });
  recCacheBust_('STUDENTS');
  return { ok: true };
}
