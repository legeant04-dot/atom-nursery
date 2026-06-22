/**
 * Auth.gs — authentication, roles & account lifecycle (Proposal §9 Day 2)
 * ------------------------------------------------------------------
 * Flow: LIFF sends the LINE user's access token -> we verify it with
 * LINE -> look up the userId in USERS -> return their Role. Unknown
 * users get a readable error (they must be registered by an Admin).
 *
 * Account creation is Admin-triggered (when adding staff/students):
 * createUserAccount_ generates a UserID + default password (hashed,
 * must be changed on first login) per §6.
 * ------------------------------------------------------------------
 */

var ROLES = { ADMIN: 'Admin', TEACHER: 'Teacher', PARENT: 'Parent' };
var USER_STATUS = { ACTIVE: 'ACTIVE', MUST_CHANGE: 'MUST_CHANGE_PASSWORD', DISABLED: 'DISABLED' };

// ---- Login --------------------------------------------------------
/**
 * payload: { accessToken?, lineUid?, displayName? }
 *  - accessToken (preferred): verified against LINE; its userId is trusted.
 *  - lineUid: dev/testing fallback when no token is supplied.
 * returns: { userId, role, linkedId, status, mustChangePassword, displayName }
 */
function handleAuth(payload) {
  payload = payload || {};
  var uid = null, displayName = payload.displayName || '';

  if (payload.accessToken) {
    var profile = verifyLineAccessToken_(payload.accessToken);
    if (!profile) throw apiError_('INVALID_TOKEN', 'LINE access token ไม่ถูกต้องหรือหมดอายุ');
    uid = profile.userId;
    displayName = profile.displayName || displayName;
  } else if (payload.lineUid) {
    uid = payload.lineUid; // fallback for direct API testing
  }
  if (!uid) throw apiError_('NO_IDENTITY', 'ไม่พบ LINE access token หรือ lineUid ในคำขอ');

  var users = sheet_(getMainSpreadsheet_(), 'USERS');
  var user = findObject_(users, function (u) { return String(u.LineUID) === String(uid); });

  if (!user) {
    logAudit(uid, 'LOGIN_DENIED_UNREGISTERED', 'USERS', '');
    throw apiError_('NOT_REGISTERED', 'บัญชีนี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแล (Admin)');
  }
  if (String(user.Status) === USER_STATUS.DISABLED) {
    logAudit(user.UserID, 'LOGIN_DENIED_DISABLED', 'USERS', user.UserID);
    throw apiError_('DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
  }

  logAudit(user.UserID, 'LOGIN', 'USERS', user.UserID);
  return {
    userId: user.UserID,
    role: user.Role,
    linkedId: user.LinkedID,
    status: user.Status,
    mustChangePassword: String(user.Status) === USER_STATUS.MUST_CHANGE,
    displayName: displayName
  };
}

// ---- Account creation (Admin-triggered) ---------------------------
/**
 * Create a USERS record for a staff/student/parent.
 * role: one of ROLES. linkedId: StaffID/StudentID/ParentID. lineUid optional.
 * Returns { userId, defaultPassword } — show defaultPassword to the Admin once.
 */
function createUserAccount_(role, linkedId, lineUid, actorUserId) {
  if ([ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT].indexOf(role) === -1) {
    throw apiError_('BAD_ROLE', 'Role ไม่ถูกต้อง: ' + role);
  }
  var users = sheet_(getMainSpreadsheet_(), 'USERS');

  // Prevent duplicate account for the same linked entity.
  var dup = findObject_(users, function (u) {
    return String(u.Role) === role && String(u.LinkedID) === String(linkedId);
  });
  if (dup) throw apiError_('USER_EXISTS', 'มีบัญชีสำหรับ ' + role + ' ' + linkedId + ' อยู่แล้ว');

  var userId = nextId_(users, 'UserID', 'U');
  var defaultPassword = randomPassword_(8);
  appendObject_(users, {
    UserID: userId,
    LineUID: lineUid || '',
    Role: role,
    LinkedID: linkedId,
    PasswordHash: hashPassword_(defaultPassword),
    CreatedDate: new Date(),
    Status: USER_STATUS.MUST_CHANGE
  });
  logAudit(actorUserId || 'system', 'CREATE_USER', 'USERS', userId);
  return { userId: userId, defaultPassword: defaultPassword };
}

// ---- Password change (forced on first login) ----------------------
/** payload: { userId, oldPassword, newPassword } */
function handleChangePassword(payload) {
  payload = payload || {};
  if (!payload.userId || !payload.newPassword) {
    throw apiError_('BAD_INPUT', 'ต้องระบุ userId และ newPassword');
  }
  if (String(payload.newPassword).length < 6) {
    throw apiError_('WEAK_PASSWORD', 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
  }
  var users = sheet_(getMainSpreadsheet_(), 'USERS');
  var user = findObject_(users, function (u) { return String(u.UserID) === String(payload.userId); });
  if (!user) throw apiError_('NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');

  // First-time accounts (MUST_CHANGE) may set a password without the old one.
  if (String(user.Status) !== USER_STATUS.MUST_CHANGE) {
    if (!verifyPassword_(payload.oldPassword || '', user.PasswordHash)) {
      throw apiError_('BAD_PASSWORD', 'รหัสผ่านเดิมไม่ถูกต้อง');
    }
  }
  updateRow_(users, user._row, {
    PasswordHash: hashPassword_(payload.newPassword),
    Status: USER_STATUS.ACTIVE
  });
  logAudit(user.UserID, 'CHANGE_PASSWORD', 'USERS', user.UserID);
  return { userId: user.UserID, status: USER_STATUS.ACTIVE };
}

// ---- Password hashing (SHA-256 + per-user salt) -------------------
/** Returns "salt:hexhash". */
function hashPassword_(plain) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  return salt + ':' + sha256Hex_(salt + String(plain));
}

/** Constant-shape verify against "salt:hexhash". */
function verifyPassword_(plain, stored) {
  if (!stored || String(stored).indexOf(':') === -1) return false;
  var parts = String(stored).split(':');
  return sha256Hex_(parts[0] + String(plain)) === parts[1];
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** Readable random password (no ambiguous chars). */
function randomPassword_(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  var out = '';
  for (var i = 0; i < (len || 8); i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
