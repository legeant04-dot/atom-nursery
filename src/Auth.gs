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

/* ---- SIGNING IN WITHOUT HANDING THE PHONE TO THE LINE APP ----------------------------------------
 *
 * liff.login() sends the browser to access.line.me, and on iOS that host is a LINE universal link:
 * Safari gives the URL to the LINE app instead of loading it. When the app cannot complete the
 * hand-off it simply opens on whatever tab it was last on, nothing returns, and the parent is stuck
 * (recorded 08/09/26, twice in a row — see signInStuckScreen in app.js).
 *
 * LINE's own answer to this is a parameter on the authorization URL: disable_auto_login=true, which
 * keeps the whole login inside the browser. It cannot be used through the LIFF SDK — liff.login()
 * builds its own URL and accepts only redirectUri — so this path builds the authorization URL
 * itself and finishes the handshake here.
 *
 * WHY THE SERVER HAS TO BE INVOLVED: exchanging the authorization code for an access token requires
 * the channel SECRET, which must never reach a phone. The client sends the code; this returns the
 * same session payload handleAuth already produces, so everything downstream is unchanged.
 *
 * IT IS A FALLBACK, NOT THE NEW FRONT DOOR. Disabling auto login means the parent signs in to LINE
 * in the browser — QR code from their own LINE app, or email and password. That is a worse first
 * experience than the app hand-off that works for almost everyone, so it is offered only after the
 * hand-off has actually failed.
 *
 * Nothing works until the school sets SCHOOL_CONFIG LineLoginChannelSecret and adds the app's URL
 * to the LINE Login channel's callback list. Missing config fails loudly with what to do; the
 * button that leads here is not even drawn (see the client's lineLoginReady).
 */
function lineLoginCfg_() {
  return { id: String(getConfig_('LineLoginChannelId', '') || '').trim(),
           secret: String(getConfig_('LineLoginChannelSecret', '') || '').trim() };
}
/** Does the browser-only sign-in have what it needs? Public: it says yes/no, never the secret. */
function handleLineLoginReady() {
  var c = lineLoginCfg_();
  return { ready: !!c.secret, channelId: c.id };
}
/**
 * payload: { code, redirectUri, clientId? }
 * Exchanges a LINE Login authorization code for an access token, then signs in exactly as `auth`
 * does. clientId is public (it is the prefix of the LIFF id) and only used when the school has not
 * written LineLoginChannelId; the SECRET is never accepted from the client.
 */
function handleLineExchange(payload) {
  payload = payload || {};
  var code = String(payload.code || '').trim();
  var redirectUri = String(payload.redirectUri || '').trim();
  if (!code || !redirectUri) throw apiError_('BAD_INPUT', 'ข้อมูลเข้าสู่ระบบไม่ครบ');
  var c = lineLoginCfg_();
  var channelId = c.id || String(payload.clientId || '').trim();
  if (!c.secret || !channelId) {
    throw apiError_('LINE_LOGIN_NOT_CONFIGURED',
      'ยังไม่ได้ตั้งค่าเข้าสู่ระบบผ่านเบราว์เซอร์ — แอดมินต้องใส่ LineLoginChannelSecret ใน SCHOOL_CONFIG และเพิ่ม Callback URL ใน LINE Developers Console');
  }
  var res, body;
  try {
    res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'post', muteHttpExceptions: true,
      contentType: 'application/x-www-form-urlencoded',
      payload: { grant_type: 'authorization_code', code: code, redirect_uri: redirectUri,
                 client_id: channelId, client_secret: c.secret }
    });
    body = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    throw apiError_('LINE_UNREACHABLE', 'ติดต่อ LINE ไม่สำเร็จ กรุณาลองใหม่');
  }
  if (res.getResponseCode() !== 200 || !body.access_token) {
    /* The reason travels back. "invalid_grant" is a code already spent (a reload of the callback
     * URL) and "invalid_request" is almost always a redirect_uri that is not in the console's
     * callback list — two completely different things for whoever has to fix it. */
    var why = String(body.error_description || body.error || res.getResponseCode());
    try { logAudit('anon', 'LINE_EXCHANGE_FAIL', 'AUTH', why.slice(0, 120)); } catch (e) {}
    throw apiError_('LINE_EXCHANGE_FAILED', 'เข้าสู่ระบบด้วย LINE ไม่สำเร็จ (' + why.slice(0, 80) + ')');
  }
  return handleAuth({ accessToken: body.access_token });
}

/* ---- GOOGLE: A SECOND KEY TO THE SAME DOOR -------------------------------------------------------
 *
 * Approved 09/09/26, after a parent on iOS could not complete the LINE hand-off for two days and the
 * only way left was "remember your LINE password and wait for a verification code" — which is the
 * worst path in the app. Nearly everyone is already signed in to Google on their phone, so this
 * turns that path into one tap.
 *
 * IT IS NOT A SECOND IDENTITY. Signing in with Google RESOLVES to the LineUID already on the person's
 * row and then calls handleAuth with it, so the account they land on, the role, the DISABLED and
 * ENDED gates, the twelve-hour token and the home payload are all produced by the same code as
 * before. Nothing downstream can tell which door was used, and there is no second place where "who
 * is this" is decided — which is exactly how a second sign-in method goes wrong.
 *
 * A row with no LineUID is refused rather than improvised around: every account in this school was
 * created through LINE, so a blank one means something is wrong with the record, and minting a
 * session on a uid nothing else knows about would quietly break every lookup that reads USER_LINKS.
 *
 * WHY `sub` AND NOT THE EMAIL. Google's `sub` is a permanent account id; an email address is a label
 * that can be changed. The email finds the person ONCE, and that first sign-in writes the `sub` down
 * (linkGoogleSub_); every later sign-in matches on the `sub`, so changing their email address does
 * not lock them out.
 *
 * The token is verified at Google, never decoded here: a JWT read without checking its signature is
 * a sentence the client wrote about itself. tokeninfo does the crypto, and we then check the two
 * things it cannot know for us — that the token was minted for OUR client, and that Google considers
 * the address verified. Google itself asks for neither a client secret nor a redirect URI in this
 * mode, which is also why the `Invalid redirect_uri` trouble the LINE route hit cannot happen here.
 */
/**
 * The client id, and the difference between "switched off" and "never set up".
 *
 * getConfig_ treats a blank cell as absent and hands back the default, which would make it
 * impossible to turn this OFF from the sheet — blanking the row would silently restore it. So the
 * sheet is read directly: a row that EXISTS decides, blank included, and only the absence of a row
 * falls back to the client baked into SCHOOL_CONFIG_DEFAULTS.
 *
 * Falling back at all matters because the live workbook predates this key — it is seeded only on
 * setup — so without it the feature would ship switched off and look broken. A client id is not a
 * secret (every browser drawing the button receives it), it belongs to this one school, and an admin
 * can still override or clear it from Settings.
 */
function googleClientIdDefault_() {
  try {
    for (var i = 0; i < SCHOOL_CONFIG_DEFAULTS.length; i++) {
      if (SCHOOL_CONFIG_DEFAULTS[i][0] === 'GoogleClientId') return String(SCHOOL_CONFIG_DEFAULTS[i][1] || '').trim();
    }
  } catch (e) {}
  return '';
}
function googleClientId_() {
  var v;
  try { v = getAllConfig_()['GoogleClientId']; } catch (e) { v = undefined; }
  if (v !== undefined) return String(v || '').trim();
  return googleClientIdDefault_();
}

/** Public: is the button worth drawing? Says yes/no and the client id, which is not a secret. */
function handleGoogleLoginReady() {
  var id = googleClientId_();
  return { ready: !!id, clientId: id };
}

/**
 * Verify a Google ID token and return the claims we trust.
 * Throws rather than returning null, because every caller would only turn null into the same refusal.
 */
function googleVerify_(credential) {
  var cred = String(credential || '').trim();
  if (!cred) throw apiError_('BAD_INPUT', 'ไม่พบข้อมูลเข้าสู่ระบบจาก Google');
  var clientId = googleClientId_();
  if (!clientId) {
    throw apiError_('GOOGLE_NOT_CONFIGURED',
      'ยังไม่ได้ตั้งค่าเข้าสู่ระบบด้วย Google — แอดมินต้องใส่ GoogleClientId ใน SCHOOL_CONFIG');
  }
  var res, body;
  try {
    res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred),
      { method: 'get', muteHttpExceptions: true });
    body = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    throw apiError_('GOOGLE_UNREACHABLE', 'ติดต่อ Google ไม่สำเร็จ กรุณาลองใหม่');
  }
  if (res.getResponseCode() !== 200 || !body.sub) {
    var why = String(body.error_description || body.error || res.getResponseCode());
    try { logAudit('anon', 'GOOGLE_VERIFY_FAIL', 'AUTH', why.slice(0, 120)); } catch (e) {}
    throw apiError_('GOOGLE_TOKEN_INVALID', 'ข้อมูลจาก Google ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่');
  }
  /* A token minted for SOMEBODY ELSE'S app is a perfectly valid Google token. Without this check any
   * site the person has ever signed in to could hand us one and be let in as them. */
  if (String(body.aud || '') !== clientId) {
    try { logAudit('anon', 'GOOGLE_AUD_MISMATCH', 'AUTH', String(body.aud || '').slice(0, 60)); } catch (e) {}
    throw apiError_('GOOGLE_TOKEN_INVALID', 'ข้อมูลจาก Google ไม่ถูกต้อง (คนละแอป)');
  }
  // an address Google has not confirmed the person owns is not an identity
  if (String(body.email_verified) !== 'true' && body.email_verified !== true) {
    throw apiError_('GOOGLE_EMAIL_UNVERIFIED', 'อีเมล Google นี้ยังไม่ได้รับการยืนยันจาก Google');
  }
  return { sub: String(body.sub), email: normEmail_(body.email), name: String(body.name || ''),
           picture: String(body.picture || '') };
}

/** Find the PARENTS/STAFF row this Google account belongs to. `sub` wins; the email is the fallback
 *  that exists so a FIRST sign-in can happen at all. Returns null when nothing matches. */
function googleFindRow_(g) {
  var parents = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var staff = sheet_(getHrSpreadsheet_(), 'STAFF');
  var bySub = function (r) { return r.GoogleSub && String(r.GoogleSub) === g.sub; };
  var byMail = function (r) { return g.email && normEmail_(r.Email) === g.email; };
  /* PARENTS before STAFF, the order handleAuth itself resolves a LineUID in — so a teacher whose own
   * child attends lands on precisely the account she lands on with LINE today, not a different one. */
  var hit = findObject_(parents, bySub);
  if (hit) return { sheet: parents, row: hit, kind: 'PARENTS', id: hit.ParentID, matched: 'sub' };
  hit = findObject_(staff, bySub);
  if (hit) return { sheet: staff, row: hit, kind: 'STAFF', id: hit.StaffID, matched: 'sub' };
  hit = findObject_(parents, byMail);
  if (hit) return { sheet: parents, row: hit, kind: 'PARENTS', id: hit.ParentID, matched: 'email' };
  hit = findObject_(staff, byMail);
  if (hit) return { sheet: staff, row: hit, kind: 'STAFF', id: hit.StaffID, matched: 'email' };
  return null;
}

/** Write the permanent account id onto a row the first time it is recognised by email alone. */
function linkGoogleSub_(found, g) {
  try {
    ensureColumns_(found.sheet, ['Email', 'GoogleSub']);
    updateRow_(found.sheet, found.row._row, { GoogleSub: g.sub, Email: g.email });
    if (found.kind === 'PARENTS') { recCacheBust_('PARENTS'); } else { staffCacheBust_(); }
    logAudit(found.id, 'GOOGLE_LINK', found.kind, g.email);
  } catch (e) {}   // best effort: failing to remember it must not stop them getting in
}

/**
 * payload: { credential }  — the ID token from Google Identity Services.
 * Returns exactly what `auth` returns, because it IS what `auth` returns.
 */
function handleGoogleExchange(payload) {
  var g = googleVerify_((payload || {}).credential);
  var found = googleFindRow_(g);
  if (!found) {
    logAudit('anon', 'GOOGLE_LOGIN_UNKNOWN', 'AUTH', g.email);
    throw apiError_('GOOGLE_NOT_LINKED',
      'อีเมล ' + g.email + ' ยังไม่ได้ผูกกับบัญชีในระบบ — กรุณาเข้าสู่ระบบด้วย LINE แล้วกด "ผูกบัญชี Google" ที่หน้าข้อมูลของฉัน หรือแจ้งแอดมิน');
  }
  var uid = String(found.row.LineUID || '').trim();
  if (!uid) {
    logAudit(found.id, 'GOOGLE_LOGIN_NO_LINE', found.kind, g.email);
    throw apiError_('GOOGLE_NO_LINE_ACCOUNT',
      'บัญชีนี้ยังไม่ได้ผูกกับ LINE จึงเข้าสู่ระบบด้วย Google ไม่ได้ — กรุณาแจ้งแอดมิน');
  }
  if (found.matched === 'email') linkGoogleSub_(found, g);   // first time: remember the permanent id
  logAudit(found.id, 'LOGIN_GOOGLE', found.kind, g.email);
  // the SAME door: role, gates, token and home payload all come from handleAuth, not from here
  return handleAuth({ lineUid: uid, displayName: g.name, pictureUrl: found.row.LinePictureUrl || '' });
}

/**
 * payload: { credential, parentId?, staffId? } — link/unlink from inside a signed-in session.
 *
 * THE SAFE WAY TO COLLECT AN ADDRESS. The identity is already settled by the session token
 * (applyIdentity_ injects parentId/staffId server-side and the client cannot widen it), so the link
 * is correct by construction: nobody types an email, so nobody mistypes one onto a stranger.
 * An address already on another row is still refused — emailGuard_ is the same guard the forms use.
 */
function handleGoogleLink(payload) {
  var p = payload || {};
  var sh, row, idField, ownId, kind;
  if (p.parentId) {
    sh = sheet_(getMainSpreadsheet_(), 'PARENTS'); idField = 'ParentID'; ownId = p.parentId; kind = 'PARENTS';
    row = findObject_(sh, function (x) { return String(x.ParentID) === String(ownId); });
  } else if (p.staffId) {
    sh = sheet_(getHrSpreadsheet_(), 'STAFF'); idField = 'StaffID'; ownId = p.staffId; kind = 'STAFF';
    row = findObject_(sh, function (x) { return String(x.StaffID) === String(ownId); });
  } else {
    throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่');
  }
  if (!row) throw apiError_('NOT_FOUND', 'ไม่พบข้อมูลของบัญชีนี้');
  try { ensureColumns_(sh, ['Email', 'GoogleSub']); } catch (e) {}

  if (p.unlink) {
    /* BOTH are cleared, not just the sub. The email alone is a way in (it is what a first sign-in
     * matches on), so leaving it behind would leave the door open after somebody asked to close it. */
    updateRow_(sh, row._row, { GoogleSub: '', Email: '' });
    if (kind === 'PARENTS') { recCacheBust_('PARENTS'); } else { staffCacheBust_(); }
    logAudit(ownId, 'GOOGLE_UNLINK', kind, '');
    return { ok: true, linked: false, email: '' };
  }

  var g = googleVerify_(p.credential);
  emailGuard_(sh, g.email, idField, ownId);            // throws EMAIL_TAKEN if it belongs to somebody else
  var other = findObject_(sh, function (x) {
    return x.GoogleSub && String(x.GoogleSub) === g.sub && String(x[idField] || '') !== String(ownId);
  });
  if (other) throw apiError_('EMAIL_TAKEN', 'บัญชี Google นี้ถูกผูกกับผู้ใช้อื่นแล้ว');
  updateRow_(sh, row._row, { GoogleSub: g.sub, Email: g.email });
  if (kind === 'PARENTS') { recCacheBust_('PARENTS'); } else { staffCacheBust_(); }
  logAudit(ownId, 'GOOGLE_LINK_SELF', kind, g.email);
  return { ok: true, linked: true, email: g.email };
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
    /* THE LAST WORKING DAY HAS PASSED. Asked 2026-09-01: "คุณครูที่หมดหน้าที่การทำงานหลังจากวันที่
     * กำหนด ไม่ควรเข้ามาในระบบเพื่อทำกิจกรรมใดๆได้อีก".
     *
     * The check-in handler already refused them (assertStaffStarted_ throws ENDED) and the dashboard
     * no longer counts them, but they still held a working login — able to open class lists, read
     * children's records and file journals. Closing it AT THE DOOR is the only version that covers
     * every screen at once, including the ones written next.
     *
     * EndDate is a LAST working day, so this bites only once it has passed — somebody leaving on the
     * 30th still signs in on the 30th. Nothing is deleted: the record keeps their payroll and
     * attendance history, and clearing EndDate lets them straight back in if they return. */
    var _end = String(st.EndDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(_end) && dateStr_(new Date()) > _end) {
      logAudit(st.StaffID, 'LOGIN_DENIED_ENDED', 'STAFF', st.StaffID + ' end=' + _end);
      throw apiError_('ENDED', 'สิ้นสุดการทำงานเมื่อ ' + _end + ' — เข้าใช้งานระบบไม่ได้แล้ว · หากกลับเข้าทำงาน กรุณาแจ้งแอดมิน');
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
