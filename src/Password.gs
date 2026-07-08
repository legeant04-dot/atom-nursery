/**
 * Password.gs — staff password ops (in-place on the STAFF sheet).
 * ------------------------------------------------------------------
 * The sheet column is PasswordHash (stored as plain text in this build so Admin can view/reset it).
 * These override the engine so writes touch ONLY one row (never rewrite the STAFF collection).
 * Identity is enforced upstream by applyIdentity_: Teacher/Leader act only on themselves; Admin any.
 */
function pwStaffRow_(staffId) {
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(sh, function (s) { return String(s.StaffID) === String(staffId); });
  return { sh: sh, st: st };
}

// teacher changes their own password (staffId injected from session)
function handleChangeStaffPassword(p) {
  p = p || {};
  var pw = String(p.newPassword || '');
  if (!(pw.length >= 8 && pw.length <= 15 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)))
    throw apiError_('WEAK_PW', 'รหัสผ่านต้อง 8-15 ตัว มีพิมพ์เล็ก พิมพ์ใหญ่ และตัวเลข');
  var r = pwStaffRow_(p.staffId);
  if (!r.st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน');
  updateRow_(r.sh, r.st._row, { PasswordHash: pw, MustChangePassword: false });
  staffCacheBust_();
  return { ok: true };
}

// slip-unlock check (staffId injected = self)
function handleCheckStaffPassword(p) {
  p = p || {};
  var r = pwStaffRow_(p.staffId);
  var pw = r.st ? String(r.st.PasswordHash || '1234') : '1234';
  return { ok: pw === String(p.password || '') };
}

// Admin views a staff's current password (plain text by design)
function handleGetStaffPassword(p) {
  p = p || {};
  var r = pwStaffRow_(p.staffId);
  return { password: r.st ? String(r.st.PasswordHash || '1234') : '1234' };
}

// Admin resets a staff's password → temp = last 8 of NationalID (or 1234), forces change on next unlock.
// If p.password is given, sets that instead.
function handleAdminResetPassword(p) {
  p = p || {};
  var r = pwStaffRow_(p.staffId);
  if (!r.st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + p.staffId);
  var tmp = p.password ? String(p.password) : (String(r.st.NationalID || '').slice(-8) || '1234');
  updateRow_(r.sh, r.st._row, { PasswordHash: tmp, MustChangePassword: true });
  staffCacheBust_();
  return { ok: true, tempPassword: tmp };
}

// teacher taps "forgot password" → persist a request in ACTIVITY_LOG (Admin sees it) + LINE-push Admin.
function handleRequestPasswordReset(p) {
  p = p || {};
  var r = pwStaffRow_(p.staffId);
  if (!r.st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน');
  var name = r.st.Name || r.st.NameEN || p.staffId;
  try {
    var log = sheet_(getMainSpreadsheet_(), 'ACTIVITY_LOG');
    appendObject_(log, { LogID: 'PWR-' + Date.now(), Timestamp: nowStr_(), UserRole: 'Staff', UserID: p.staffId,
      UserName: name, Action: 'requestPasswordReset', Target: p.staffId, Detail: 'ขอรีเซ็ตรหัสผ่าน' });
    recCacheBust_('ACTIVITY_LOG');
  } catch (e) {}
  try { notifyAdmin_('🔑 ขอรีเซ็ตรหัสผ่าน: ' + name + ' (' + p.staffId + ')'); } catch (e) {}
  return { ok: true };
}

// nowStr_ fallback (Db/Audit may already define a stamp; keep a local one to be safe)
function nowStr_() {
  try { return Utilities.formatDate(new Date(), getConfig_('Timezone', 'Asia/Bangkok'), 'yyyy-MM-dd HH:mm:ss'); }
  catch (e) { return new Date().toISOString(); }
}
