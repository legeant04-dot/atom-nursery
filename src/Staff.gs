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
  try { ensureColumns_(sh, ['NicknameEN', 'Classes', 'CanClassOrg', 'CanFoodMenu', 'BankName', 'BankAccount', 'ContributionOpening']); } catch (e) {}
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
  // per-student OT rate + schedule + OT-free cutoff + parent note + monthly discount, and how the
  // FIRST month is charged when the child starts mid-month (ProrateMode/ProrateAmount)
  try { ensureColumns_(sh, ['OTRate', 'StartTime', 'EndTime', 'OTGraceUntil', 'RateNote', 'DiscountAmount', 'DiscountUnit',
    'ProrateMode', 'ProrateAmount', 'PauseFrom', 'PauseTo', 'PauseReason']); } catch (e) {}
  var row = mapName_(p.data || {});
  var st = findObject_(sh, function (s) { return String(s.StudentID) === String(p.studentId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบนักเรียน ' + p.studentId);
  updateRow_(sh, st._row, row);
  recCacheBust_('STUDENTS');
  return { ok: true, studentId: p.studentId };
}

/**
 * Admin puts a child on temporary leave (ลาชั่วคราว), or brings them back. The child keeps their
 * record, their history and their parent link; while paused they are not billed, not marked absent,
 * and not on any class or activity list. Written IN PLACE — STUDENTS is a no-shrink sheet.
 * { studentId, paused:true, from, to?, reason? } | { studentId, paused:false }
 */
function handleSetStudentPause(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  try { ensureColumns_(sh, ['PauseFrom', 'PauseTo', 'PauseReason']); } catch (e) {}
  var st = findObject_(sh, function (s) { return String(s.StudentID) === String(p.studentId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบนักเรียน ' + p.studentId);
  var cur = String(st.Status || '');
  if (cur === 'WITHDRAWN' || cur === 'EXPORTED') throw apiError_('BAD_STATE', 'นักเรียนคนนี้ออกจากโรงเรียนแล้ว — ใช้เมนูรับกลับเข้าเรียนแทน');
  var patch;
  if (p.paused === false) {
    patch = { Status: 'ACTIVE', PauseFrom: '', PauseTo: '', PauseReason: '' };
  } else {
    var from = String(p.from || '').slice(0, 10);
    var to = String(p.to || '').slice(0, 10);
    if (!from) throw apiError_('BAD_INPUT', 'ระบุวันที่เริ่มลาชั่วคราว');
    if (to && to < from) throw apiError_('BAD_INPUT', 'วันที่กลับมาต้องไม่ก่อนวันที่เริ่มลา');
    patch = { Status: 'PAUSED', PauseFrom: from, PauseTo: to, PauseReason: p.reason || '' };
  }
  updateRow_(sh, st._row, patch);
  recCacheBust_('STUDENTS');
  try { logAudit(p.adminId || 'admin', p.paused === false ? 'STUDENT_RESUME' : 'STUDENT_PAUSE', 'STUDENTS',
    p.studentId + (patch.PauseFrom ? (' ' + patch.PauseFrom + '–' + (patch.PauseTo || '')) : '')); } catch (e) {}
  return { ok: true, studentId: p.studentId, status: patch.Status, from: patch.PauseFrom, to: patch.PauseTo, reason: patch.PauseReason };
}

// Admin bypass: link a parent's LINE UID to a student (found by National ID) when the parent can't
// self-register; optionally fill the parent's info. In-place (USER_LINKS/PARENTS are no-shrink sheets).
// The parent may be identified three ways, in this order: an existing PARENTS row (parentId — what the
// admin picks from a list), a LINE UID, or new info to create a row with. The student likewise by
// studentId or National ID. A parent who has never signed in with LINE has no UID to link, so they get
// the LEGACY linkage (STUDENTS.ParentID / PARENTS.StudentID) that the readers already understand —
// requiring a UID meant the admin could not link a phone-only parent at all.
function handleLinkParentAdmin(p) {
  p = p || {};
  var uid = String(p.uid || '').trim(); var nid = String(p.nationalId || '').trim(); var sid = String(p.studentId || '').trim();
  var stSheet = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var st = sid ? findObject_(stSheet, function (s) { return String(s.StudentID) === sid; })
    : (nid ? findObject_(stSheet, function (s) { return String(s.NationalID || '').trim() === nid; }) : null);
  if (!st) throw apiError_(sid || nid ? 'NOT_FOUND' : 'BAD_INPUT', sid ? 'ไม่พบนักเรียน' : nid ? 'ไม่พบนักเรียนจากเลขบัตรนี้' : 'ต้องเลือกนักเรียน');
  var d = p.data || {}; var hasInfo = !!(d.NameTH || d.NameEN || d.Phone || d.Nickname);
  var pSheet = sheet_(getMainSpreadsheet_(), 'PARENTS');
  try { ensureColumns_(pSheet, ['Nickname', 'NicknameEN', 'Title', 'LineUID']); } catch (e) {}
  // resolve the parent row: picked from the list first, then by LINE UID
  var pa = p.parentId ? findObject_(pSheet, function (x) { return String(x.ParentID) === String(p.parentId); }) : null;
  if (p.parentId && !pa) throw apiError_('NOT_FOUND', 'ไม่พบผู้ปกครอง');
  if (pa && !uid) uid = String(pa.LineUID || '').trim();
  if (!pa && uid) pa = findObject_(pSheet, function (x) { return String(x.LineUID) === uid; });
  if (!pa && !uid && !hasInfo) throw apiError_('BAD_INPUT', 'ต้องเลือกผู้ปกครอง หรือกรอกข้อมูลผู้ปกครองใหม่');
  var pid = pa ? pa.ParentID : '';
  if (!pa && hasInfo) {
    pid = nextId_(pSheet, 'ParentID', 'PAR');
    appendObject_(pSheet, { ParentID: pid, LineUID: uid, NameTH: d.NameTH || '', NameEN: d.NameEN || '', Nickname: d.Nickname || '',
      NicknameEN: d.NicknameEN || '', Phone: d.Phone || '', Relationship: d.Relationship || '', Title: d.Title || '' });
  } else if (pa) {
    var patch = {}; ['NameTH', 'NameEN', 'Nickname', 'NicknameEN', 'Phone', 'Relationship', 'Title'].forEach(function (k) { if (d[k] != null && d[k] !== '') patch[k] = d[k]; });
    if (Object.keys(patch).length) updateRow_(pSheet, pa._row, patch);
  }
  var via = '';
  if (uid) {
    // USER_LINKS: append the link if not already present (append is allowed on a no-shrink sheet)
    var ul = sheet_(getMainSpreadsheet_(), 'USER_LINKS');
    var exists = readObjects_(ul).some(function (l) { return String(l.UserUID) === uid && String(l.StudentID) === String(st.StudentID); });
    if (!exists) appendObject_(ul, { UserUID: uid, StudentID: st.StudentID, VerifiedBy: 'admin', Date: dateStr_(new Date()) });
    try { CacheService.getScriptCache().removeAll(['rows:USER_LINKS', 'col:USER_LINKS']); } catch (e) {}
    via = 'link';
    if (pid && !st.ParentID) updateRow_(stSheet, st._row, { ParentID: pid });
  } else {
    // no LINE account yet — legacy link, on whichever of the two pointers is free
    if (!st.ParentID) updateRow_(stSheet, st._row, { ParentID: pid });
    else if (String(st.ParentID) !== String(pid)) {
      if (pa && !pa.StudentID) updateRow_(pSheet, pa._row, { StudentID: st.StudentID });
      else throw apiError_('LINK_TAKEN', 'นักเรียนคนนี้ผูกกับผู้ปกครองรายอื่นแบบไม่มี LINE อยู่แล้ว — ยกเลิกการผูกเดิมก่อน');
    }
    via = 'legacy';
  }
  recCacheBust_('STUDENTS');
  try { CacheService.getScriptCache().removeAll(['rows:PARENTS', 'col:PARENTS', 'rows:STUDENTS', 'col:STUDENTS']); } catch (e) {}
  try { logAudit(p.adminId || 'admin', 'LINK_PARENT_ADMIN', 'USER_LINKS', st.StudentID + ' <- ' + (pid || uid) + ' (' + via + ')'); } catch (e) {}
  return { ok: true, studentId: st.StudentID, name: st.NameTH, nick: st.Nickname, parentId: pid, via: via, needInfo: !pid };
}

// First LINE sign-in of a parent the school ALREADY has on file (imported, or entered by the admin):
// claim that existing record instead of registering a second one — the gap that produced 84 duplicate
// parents. Verified by the CHILD's National ID plus the parent's own National ID or the phone the school
// recorded; a record with neither field filled cannot be claimed (the admin must link it instead).
// In-place writes only: PARENTS/USER_LINKS are no-shrink sheets.
function handleClaimParent(p) {
  p = p || {};
  var uid = String(p.uid || '').trim();
  if (!uid) throw apiError_('NO_IDENTITY', 'ไม่พบบัญชี LINE — กรุณาเข้าผ่าน LINE อีกครั้ง');
  var dig = function (v) { return String(v == null ? '' : v).replace(/\D/g, ''); };
  var nid = dig(p.nationalId), ver = dig(p.verify);
  if (nid.length !== 13) throw apiError_('BAD_INPUT', 'กรอกเลขบัตรประชาชนนักเรียน 13 หลัก');
  if (ver.length < 9) throw apiError_('BAD_INPUT', 'กรอกเลขบัตรประชาชนของผู้ปกครอง หรือเบอร์โทรที่แจ้งกับโรงเรียน');
  // brute-force guard: 5 wrong attempts per LINE account, then a 15-minute cool-off
  var cache = null, ckey = 'claimfail:' + uid, fails = 0;
  try { cache = CacheService.getScriptCache(); fails = Number(cache.get(ckey) || 0); } catch (e) {}
  if (fails >= 5) throw apiError_('TOO_MANY_TRIES', 'ยืนยันไม่สำเร็จหลายครั้ง — กรุณารอ 15 นาที หรือติดต่อแอดมิน');
  var bump = function () { try { if (cache) cache.put(ckey, String(fails + 1), 900); } catch (e) {} };

  var stSheet = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var st = findObject_(stSheet, function (s) { return dig(s.NationalID) === nid; });
  if (!st) { bump(); throw apiError_('NOT_FOUND', 'ไม่พบนักเรียนจากเลขบัตรนี้ — ตรวจสอบเลขบัตร หรือติดต่อแอดมิน'); }
  var pSheet = sheet_(getMainSpreadsheet_(), 'PARENTS');
  try { ensureColumns_(pSheet, ['LineUID']); } catch (e) {}
  var cands = readObjects_(pSheet).filter(function (x) {
    return String(x.StudentID || '') === String(st.StudentID) || (st.ParentID && String(x.ParentID) === String(st.ParentID));
  });
  if (!cands.length) throw apiError_('NO_RECORD', 'ยังไม่มีข้อมูลผู้ปกครองของนักเรียนคนนี้ในระบบ — กรุณาเลือก "ลงทะเบียนใหม่"');
  var same9 = function (a, b) { return a.length >= 9 && b.length >= 9 && a.slice(-9) === b.slice(-9); };
  var hit = null;
  cands.forEach(function (x) { if (hit) return; var n = dig(x.NationalID), ph = dig(x.Phone);
    if ((n && n === ver) || (ph && same9(ph, ver))) hit = x; });
  if (!hit) { bump(); throw apiError_('VERIFY_FAILED', 'ข้อมูลยืนยันไม่ตรงกับที่โรงเรียนมี — กรุณาติดต่อแอดมิน'); }
  var own = String(hit.LineUID || '').trim();
  if (own && own !== uid) throw apiError_('ALREADY_CLAIMED', 'ข้อมูลผู้ปกครองนี้ผูกกับบัญชี LINE อื่นอยู่แล้ว — กรุณาติดต่อแอดมิน');
  if (own !== uid) updateRow_(pSheet, hit._row, { LineUID: uid });
  // bring along EVERY child on that record, not just the one used to verify
  var kids = readObjects_(stSheet).filter(function (x) { return String(x.ParentID || '') === String(hit.ParentID); });
  if (!kids.some(function (x) { return String(x.StudentID) === String(st.StudentID); })) kids.push(st);
  var ul = sheet_(getMainSpreadsheet_(), 'USER_LINKS');
  var links = readObjects_(ul);
  kids.forEach(function (k) {
    var has = links.some(function (l) { return String(l.UserUID) === uid && String(l.StudentID) === String(k.StudentID); });
    if (!has) appendObject_(ul, { UserUID: uid, StudentID: k.StudentID, VerifiedBy: 'claim', Date: dateStr_(new Date()) });
  });
  try { CacheService.getScriptCache().removeAll(['rows:USER_LINKS', 'col:USER_LINKS', 'rows:PARENTS', 'col:PARENTS']); } catch (e) {}
  try { if (cache) cache.remove(ckey); } catch (e) {}
  try { logAudit(hit.ParentID, 'CLAIM_PARENT', 'PARENTS', hit.ParentID + ' <- ' + uid + ' (' + kids.length + ' kid(s))'); } catch (e) {}
  return { parentId: hit.ParentID, name: hit.NameTH || hit.Name || '', nameEN: hit.NameEN || '', nick: hit.Nickname || '',
    students: kids.map(function (k) { return { studentId: k.StudentID, name: k.NameTH || k.Name || '', nick: k.Nickname || '' }; }) };
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
  if (st && p.parentId && String(st.ParentID) === String(p.parentId)) { updateRow_(stSheet, st._row, { ParentID: '' }); recCacheBust_('STUDENTS'); removed++; }
  // the other legacy pointer: PARENTS.StudentID (set when the child already had a legacy parent)
  if (p.parentId) {
    var pa2 = findObject_(pSheet, function (x) { return String(x.ParentID) === String(p.parentId); });
    if (pa2 && String(pa2.StudentID || '') === String(p.studentId)) { updateRow_(pSheet, pa2._row, { StudentID: '' }); removed++; }
  }
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
    AdminLineNotify: 1, DigestMorning: 1, DigestEvening: 1,     // notification prefs (in-app inbox vs LINE + daily digests)
    ContributionMatchRate: 1 };                                 // เงินสมทบ: school's share ÷ teacher's share
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

// Leave quota + single config values. These USED to fall through to the engine, which only mutates its
// in-memory cfg object — and GasEngine's persist() writes sheet COLLECTIONS, never SCHOOL_CONFIG. So the
// app said "saved" and nothing changed: the quota AND both diligence amounts were silently discarded on
// every save. Both now write the sheet in place and bust the config cache.
// LeaveQuota lives as ONE JSON value so the leave types stay open-ended; hydrateConfig_ parses it back.
function handleSetLeaveQuota(p) {
  p = p || {};
  var type = String(p.type || '').trim();
  if (!type) throw apiError_('BAD_INPUT', 'ต้องระบุประเภทการลา');
  var days = Number(p.days);
  if (!isFinite(days) || days < 0) throw apiError_('BAD_INPUT', 'จำนวนวันต้องเป็นตัวเลข 0 ขึ้นไป');
  var cur = getConfig_('LeaveQuota', '');
  var q = {};
  if (cur && typeof cur === 'object') q = cur;
  else if (cur) { try { q = JSON.parse(String(cur)); } catch (e) { q = {}; } }
  if (!q || typeof q !== 'object') q = {};
  q[type] = days;
  setConfigValue_('LeaveQuota', JSON.stringify(q));
  try { logAudit(p.adminId || 'admin', 'SET_LEAVE_QUOTA', 'SCHOOL_CONFIG', type + '=' + days); } catch (e) {}
  return q;
}

// One config value at a time, whitelisted the same way handleSetSchoolConfig is.
function handleSetConfigVal(p) {
  p = p || {};
  var WHITE = { DiligenceAttendanceAmount: 1, DiligenceFacebookAmount: 1, ExtraChildRate: 1, TrainingCertRate: 1,
    TrainingCertMaxPerMonth: 1, SocialSecurityRate: 1, SocialSecurityMax: 1, OTRatePerHour: 1, OTGraceMinutes: 1,
    StaffOTHourlyRate: 1, LateGraceMinutes: 1, OTRoundUpMinutes: 1, AbsenceRateExcludeDays: 1, DspmManualUrl: 1,
    ContributionMatchRate: 1 };
  var key = String(p.key || '');
  if (!WHITE[key]) throw apiError_('BAD_INPUT', 'ไม่อนุญาตให้แก้ค่านี้: ' + key);
  setConfigValue_(key, p.value);
  try { logAudit(p.adminId || 'admin', 'SET_CONFIG', 'SCHOOL_CONFIG', key + '=' + p.value); } catch (e) {}
  return { key: key, value: p.value };
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

// Advance-tuition discount tiers (ชำระล่วงหน้า). These live in SCHOOL_CONFIG next to Plans because
// they are pricing, not code — the school changes them without a release. GasEngine.persist() only
// writes sheet COLLECTIONS, never SCHOOL_CONFIG, so the engine handler alone would be discarded
// silently on live; this route is what actually saves them.
function handleSavePrepayTiers(p) {
  p = p || {};
  var arr = Array.isArray(p.tiers) ? p.tiers : [];
  var tiers = [];
  arr.forEach(function (t) {
    var m = parseInt(t && t.months, 10) || 0;
    var d = Number(t && t.discount) || 0;
    if (m > 0) tiers.push({ months: m, discount: Math.max(0, Math.min(100, d)) });
  });
  if (!tiers.length) throw apiError_('BAD_INPUT', 'ต้องมีอย่างน้อย 1 ระดับ');
  tiers.sort(function (a, b) { return a.months - b.months; });
  setConfigValue_('PrepayTiers', JSON.stringify(tiers));
  try { logAudit(p.adminId || 'admin', 'SET_CONFIG', 'SCHOOL_CONFIG', 'PrepayTiers'); } catch (e) {}
  return { ok: true, tiers: tiers };
}

// QR-code master (bank QR images) + OT binding, so tuition vs OT can go to different bank accounts.
function handleSaveQRCodes(p) {
  p = p || {};
  var arr = Array.isArray(p.qrs) ? p.qrs : [];
  arr.forEach(function (q) {
    if (!q.id) q.id = 'qr_' + Math.random().toString(36).slice(2, 8);
    // upload a freshly-picked image (data URL) to Drive and keep only the short URL — several base64
    // images in one config cell would blow past the 50k-char cell limit.
    if (q.image && String(q.image).indexOf('data:') === 0) {
      try { var b64 = String(q.image).split(',')[1]; if (b64) q.image = paySlipToDrive_(b64, 'qr-' + q.id + '.png').url; } catch (e) {}
    }
  });
  setConfigValue_('QRCodes', JSON.stringify(arr));
  if (p.otQrId !== undefined) setConfigValue_('OTQRId', String(p.otQrId || ''));
  return { ok: true, qrs: arr, otQrId: getConfig_('OTQRId', '') };
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
  // never store markup in a name/relationship cell: v156-v157 briefly pre-filled the Relationship input
  // with a rendered '<span translate="no">…</span>' label, so a parent saving My-info wrote it back
  WHITE.forEach(function (k) { if (d[k] === undefined) return;
    row[k] = (k === 'Photo' || typeof d[k] !== 'string') ? d[k] : d[k].replace(/<[^>]*>/g, '').trim(); });
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
