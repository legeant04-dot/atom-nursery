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


/* ── 🔒 A PASSWORD CHECK CANNOT BE GUESSED FOREVER (2026-11-16) ─────────────────────────────────────
 * Signing in is LINE / Google only, so nothing on the open internet takes a password. Two routes still
 * compare one, both behind a session: the salary-slip unlock (checkStaffPassword) and the old-password
 * check of changePassword. Neither counted mistakes — anybody holding a signed-in phone could try
 * passwords until the slip opened. Same rule as the money PIN (Pin.gs): 5 wrong in a row locks that
 * account's check for 15 minutes. The count lives in Script Properties, server-side and durable, so a
 * new tab or a second phone does not reset it (CacheService would: it may evict at any moment).
 * Cleared by the next correct answer. The lock itself is audited and tells the admins' bell. */
var PW_MAX_FAILS_ = 5;
var PW_LOCK_MS_ = 15 * 60 * 1000;
function pwLockKey_(scope, id) { return 'PWFAIL_' + scope + '_' + String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60); }
function pwLockState_(scope, id) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(pwLockKey_(scope, id)) || '{}') || {}; }
  catch (e) { return {}; }
}
/** Throws PW_LOCKED while the lock holds. */
function pwLockCheck_(scope, id) {
  var st = pwLockState_(scope, id), left = Number(st.until || 0) - Date.now();
  if (left > 0) throw apiError_('PW_LOCKED', 'ใส่รหัสผ่านผิดหลายครั้ง — ลองใหม่ในอีก ' + Math.ceil(left / 60000) + ' นาที หรือให้แอดมินรีเซ็ตรหัสผ่านให้');
}
/** One more wrong answer. Returns how many tries are left (0 = now locked). */
function pwLockFail_(scope, id) {
  var sp = PropertiesService.getScriptProperties(), k = pwLockKey_(scope, id);
  var st = pwLockState_(scope, id);
  if (Number(st.until || 0) && Number(st.until) <= Date.now()) st = {};     // an old lock that ran out
  var n = Number(st.n || 0) + 1;
  if (n >= PW_MAX_FAILS_) {
    sp.setProperty(k, JSON.stringify({ n: 0, until: Date.now() + PW_LOCK_MS_ }));
    try { logAudit(String(id), 'PW_LOCKED', scope, String(id)); } catch (e) {}
    try { inboxAdd_('security', '🔒 ใส่รหัสผ่านผิด ' + PW_MAX_FAILS_ + ' ครั้งติดกัน (' + id + ') — ล็อก 15 นาที', ''); } catch (e) {}
    return 0;
  }
  sp.setProperty(k, JSON.stringify({ n: n }));
  return PW_MAX_FAILS_ - n;
}
function pwLockClear_(scope, id) {
  try { PropertiesService.getScriptProperties().deleteProperty(pwLockKey_(scope, id)); } catch (e) {}
}

// slip-unlock check (staffId injected = self) — 5 wrong in a row locks it for 15 minutes
function handleCheckStaffPassword(p) {
  p = p || {};
  pwLockCheck_('slip', p.staffId);
  var r = pwStaffRow_(p.staffId);
  var pw = r.st ? String(r.st.PasswordHash || '1234') : '1234';
  if (pw === String(p.password || '')) { pwLockClear_('slip', p.staffId); return { ok: true }; }
  var left = pwLockFail_('slip', p.staffId);
  if (!left) pwLockCheck_('slip', p.staffId);     // this wrong answer was the fifth: say so now
  return { ok: false, left: left };
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
