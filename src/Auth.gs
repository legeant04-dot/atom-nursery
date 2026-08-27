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

// Observer: sees what an Admin sees on the four whole-school screens and can open any record, but
// cannot change anything. Enforced on the SERVER (see observerBlocked_ in Code.gs) rather than by
// hiding buttons, so it holds however the request is made.
var ROLES = { ADMIN: 'Admin', TEACHER: 'Teacher', PARENT: 'Parent', OBSERVER: 'Observer' };
var USER_STATUS = { ACTIVE: 'ACTIVE', MUST_CHANGE: 'MUST_CHANGE_PASSWORD', DISABLED: 'DISABLED' };

// ---- Session tokens (HMAC-signed) ---------------------------------
// On auth we mint a stateless token = base64url(payload) + "." + base64url(HMAC-SHA256).
// The client sends it with every request; the server verifies it and derives the caller's
// identity FROM THE TOKEN (never trusting client-supplied uid/role), so anonymous callers
// can't read other people's data. Enforced only when SCHOOL_CONFIG RequireSessionToken='true'.
var SESSION_TTL_SEC = 43200; // 12h
function sessionSecret_() {
  var sp = PropertiesService.getScriptProperties();
  var s = sp.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); sp.setProperty('SESSION_SECRET', s); }
  return s;
}
function issueSession_(uid, role, linkedId) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ uid: uid, role: role, linkedId: linkedId, exp: Date.now() + SESSION_TTL_SEC * 1000 }));
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, sessionSecret_()));
  return body + '.' + sig;
}
/**
 * Hand back a fresh token when the one in use is over halfway through its life.
 *
 * The expiry was ABSOLUTE: whatever you were doing, twelve hours after signing in the next tap
 * failed with "ต้องเข้าสู่ระบบใหม่". A teacher who signs in at 07:00 was thrown out at 19:00 —
 * mid check-out, in the middle of the busiest part of the day. Renewing while someone is still
 * working means an active user is never interrupted, while an abandoned token still dies on time.
 */
function renewSession_(sess) {
  if (!sess || !sess.exp) return '';
  var left = sess.exp - Date.now();
  if (left <= 0 || left > (SESSION_TTL_SEC * 1000) / 2) return '';
  return issueSession_(sess.uid, sess.role, sess.linkedId);
}
function verifySession_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.');
  var expSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], sessionSecret_()));
  if (expSig !== parts[1]) return null;                                   // bad signature → forged/tampered
  try {
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (!p.exp || Date.now() > p.exp) return null;                        // expired
    return p;
  } catch (e) { return null; }
}

// ---- Login --------------------------------------------------------
/**
 * payload: { accessToken?, lineUid?, displayName?, pictureUrl? }
 *  - accessToken (preferred): verified against LINE; its userId is trusted.
 *  - lineUid: dev/testing fallback when no token is supplied.
 * returns: { userId, role, linkedId, status, mustChangePassword, displayName, pictureUrl }
 *
 * Identity resolution (first match wins):
 *   1) USERS sheet  — Admin-provisioned accounts (createUserAccount_).
 *   2) PARENTS      — parents who self-registered with their LINE (PARENTS.LineUID).
 *   3) STAFF        — staff/admin who bound their LINE (STAFF.LineUID).
 * This lets self-registered parents log in immediately and keeps Admin-created
 * USERS rows authoritative when both exist.
 */
function handleAuth(payload) {
  payload = payload || {};
  var uid = null, displayName = payload.displayName || '', pictureUrl = payload.pictureUrl || '';

  if (payload.accessToken) {
    var profile = verifyLineAccessToken_(payload.accessToken);
    if (!profile) throw apiError_('INVALID_TOKEN', 'LINE access token ไม่ถูกต้องหรือหมดอายุ');
    uid = profile.userId;
    displayName = profile.displayName || displayName;
    pictureUrl = profile.pictureUrl || pictureUrl;
  } else if (payload.lineUid) {
    uid = payload.lineUid; // fallback for direct API testing
  }
  if (!uid) throw apiError_('NO_IDENTITY', 'ไม่พบ LINE access token หรือ lineUid ในคำขอ');

  // 1) USERS (Admin-provisioned accounts win)
  var users = sheet_(getMainSpreadsheet_(), 'USERS');
  var user = findObject_(users, function (u) { return u.LineUID && String(u.LineUID) === String(uid); });
  if (user) {
    if (String(user.Status) === USER_STATUS.DISABLED) {
      logAudit(user.UserID, 'LOGIN_DENIED_DISABLED', 'USERS', user.UserID);
      throw apiError_('DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
    }
    logAudit(user.UserID, 'LOGIN', 'USERS', user.UserID);
    return {
      userId: user.UserID, role: user.Role, linkedId: user.LinkedID, status: user.Status,
      mustChangePassword: String(user.Status) === USER_STATUS.MUST_CHANGE,
      displayName: displayName, pictureUrl: pictureUrl,
      token: issueSession_(uid, user.Role, user.LinkedID)
    };
  }

  // 2) PARENTS (self-registered via LINE)
  var parents = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var par = findObject_(parents, function (pr) { return pr.LineUID && String(pr.LineUID) === String(uid); });
  if (par) {
    // Keep the parent's LINE profile picture current — it is the photo shown when they haven't
    // uploaded one. Write ONLY when it actually changed, so a normal login stays read-only.
    if (pictureUrl && String(par.LinePictureUrl || '') !== String(pictureUrl)) {
      try {
        ensureColumns_(parents, ['LinePictureUrl']);
        updateRow_(parents, par._row, { LinePictureUrl: pictureUrl });
        if (typeof cacheDel_ === 'function') { cacheDel_('col:PARENTS'); cacheDel_('rows:PARENTS'); }
      } catch (e) {}
    }
    logAudit(uid, 'LOGIN', 'PARENTS', par.ParentID);
    /* THE HOME SCREEN RIDES BACK WITH THE SIGN-IN.
     *
     * Signing in cost the parent TWO Apps Script executions, one after the other: auth, and then the
     * home screen. Apps Script runs one at a time per user, so that is two full waits stacked, and
     * it is most of what "ใช้เวลาสักพักกว่าจะเข้าถึงหน้าหลัก" actually was (2026-08-27).
     *
     * This execution has already hydrated the sheets and already knows who they are, so building the
     * home payload here costs a little CPU and saves an entire round trip — the expensive part is
     * the platform overhead, not the work.
     *
     * It is BEST-EFFORT on purpose: if anything in it throws, the parent must still be signed in.
     * The client falls back to fetching the screen itself when `home` is absent, which is also what
     * happens on every later visit to the home screen.
     */
    var _home = null;
    try {
      if (typeof engineDispatch_ === 'function') {
        _home = engineDispatch_('parentHome', { uid: uid, parentId: par.ParentID, role: ROLES.PARENT });
      }
    } catch (e) { _home = null; }
    return {
      userId: par.ParentID, role: ROLES.PARENT, linkedId: par.ParentID, status: USER_STATUS.ACTIVE,
      mustChangePassword: false,
      displayName: displayName || par.NameEN || par.Name || '', pictureUrl: pictureUrl,
      token: issueSession_(uid, ROLES.PARENT, par.ParentID),
      home: _home
    };
  }

  // 3) STAFF (LINE-bound staff/admin) — role comes from STAFF.Role
  var staff = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(staff, function (s) { return s.LineUID && String(s.LineUID) === String(uid); });
  if (st) {
    if (String(st.Status) && String(st.Status) !== 'ACTIVE') {
      logAudit(st.StaffID, 'LOGIN_DENIED_DISABLED', 'STAFF', st.StaffID);
      throw apiError_('DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
    }
    logAudit(st.StaffID, 'LOGIN', 'STAFF', st.StaffID);
    return {
      userId: st.StaffID, role: st.Role, linkedId: st.StaffID, status: USER_STATUS.ACTIVE,
      mustChangePassword: false,
      displayName: displayName || st.NameEN || st.Name || '', pictureUrl: pictureUrl,
      token: issueSession_(uid, st.Role, st.StaffID)
    };
  }

  // Unknown LINE user → not an error: issue a limited GUEST token so they can self-register / link a
  // child (the only actions a guest may call — see applyIdentity_). After registering, the client
  // re-auths and gets a full Parent token. This keeps onboarding working under token enforcement.
  logAudit(uid, 'LOGIN_GUEST_UNREGISTERED', 'AUTH', '');
  return {
    userId: '', role: 'guest', linkedId: '', status: 'GUEST', mustChangePassword: false,
    needsRegistration: true, displayName: displayName, pictureUrl: pictureUrl,
    token: issueSession_(uid, 'guest', '')
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
