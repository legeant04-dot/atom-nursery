/**
 * Pin.gs — the admin's 6-digit PIN for money actions (2026-11-14)
 * ================================================================================================
 *
 * The rule is in Code.gs (pinGate_ / PIN_MONEY_*): an admin's money action needs a PIN confirmed in
 * the last 12 hours on that device. This file is the PIN itself:
 *
 *   pinStatus   { hasPin, locked, lockedMinutes, confirmedUntil }       — read
 *   pinSet      { pin, oldPin? } → { token }  first time: no oldPin · a change: oldPin required
 *   pinVerify   { pin }          → { token }  a fresh token carrying pa = now (Auth.gs issueSession_)
 *   pinReset    { targetKey }                 another admin's PIN cleared — never your own
 *   resetPinFromEditor(key)                   run from the Apps Script editor (the owner account) when
 *                                             the only admin who could reset is the one who forgot
 *
 * WHO is never taken from the client: applyIdentity_ stamps __pinKey/__uid/__role/__linkedId from the
 * session before an Admin payload would otherwise be passed through untouched.
 *
 * 🔒 STORED AS HMAC-SHA256(PIN_PEPPER, salt + ':' + pin). A six-digit PIN is a million guesses, so a
 * plain hash in a leaked sheet would fall in a second — the pepper lives in Script Properties, not in
 * the sheet, and is never sent anywhere. 5 wrong in a row locks that PIN for 15 minutes; the lock and
 * the count are server-side, so a fresh tab or a second phone does not reset them.
 *
 * Every set, change, lock and reset is in the HR audit log, and setting / resetting tells the admins'
 * bell — a PIN the school did not expect to exist is the thing to notice.
 */
var PIN_SHEET_ = 'ADMIN_PIN';
var PIN_COLS_ = ['StaffID', 'PinHash', 'Salt', 'Fails', 'LockUntil', 'SetAt', 'SetBy'];
var PIN_MAX_FAILS_ = 5;
var PIN_LOCK_MS_ = 15 * 60 * 1000;

function pinSheet_() {
  var ss = getHrSpreadsheet_();
  var sh = ss.getSheetByName(PIN_SHEET_);
  if (!sh) { sh = ss.insertSheet(PIN_SHEET_); sh.getRange(1, 1, 1, PIN_COLS_.length).setValues([PIN_COLS_]); }
  return sh;
}
function pinPepper_() {
  var sp = PropertiesService.getScriptProperties();
  var s = sp.getProperty('PIN_PEPPER');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); sp.setProperty('PIN_PEPPER', s); }
  return s;
}
function pinHash_(pin, salt) {
  var raw = Utilities.computeHmacSha256Signature(String(salt) + ':' + String(pin), pinPepper_());
  return raw.map(function (b) { var h = (b < 0 ? b + 256 : b).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}
/** 6 digits, and not one a person next to you would guess first. */
function pinCheckNew_(pin) {
  var p = String(pin == null ? '' : pin);
  if (!/^\d{6}$/.test(p)) throw apiError_('BAD_INPUT', 'PIN ต้องเป็นตัวเลข 6 หลัก');
  if (/^(\d)\1{5}$/.test(p)) throw apiError_('BAD_INPUT', 'PIN ห้ามเป็นเลขซ้ำกันทั้งหมด (เช่น 111111)');
  var up = '0123456789', down = '9876543210';
  if (up.indexOf(p) >= 0 || down.indexOf(p) >= 0) throw apiError_('BAD_INPUT', 'PIN ห้ามเป็นเลขเรียง (เช่น 123456)');
  return p;
}
function pinRow_(sh, key) {
  return findObject_(sh, function (r) { return String(r.StaffID) === String(key); });
}
function pinLockedFor_(row) {
  var until = Number(row && row.LockUntil) || 0;
  var left = until - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : 0;
}
function pinNameOf_(key) {
  try {
    var st = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(key); });
    if (st) return String(st.Nickname || st.Name || key);
  } catch (e) {}
  return String(key);
}
/** A token for the caller, now carrying a fresh PIN confirmation. */
function pinToken_(p, at) {
  return issueSession_(p.__uid, p.__role, p.__linkedId, undefined, { pa: at });
}
function pinNeedKey_(p) {
  var key = String((p && p.__pinKey) || '');
  if (!key) throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)');   // only applyIdentity_ sets it
  return key;
}

function handlePinStatus(p) {
  var key = pinNeedKey_(p);
  var row = pinRow_(pinSheet_(), key);
  var pa = Number(p.__pa) || 0;
  var until = pa ? pa + PIN_CONFIRM_MS_ : 0;
  return { hasPin: !!(row && row.PinHash), locked: pinLockedFor_(row) > 0, lockedMinutes: pinLockedFor_(row),
           confirmedUntil: until > Date.now() ? until : 0 };
}

/** Count a wrong PIN; lock after PIN_MAX_FAILS_. Returns the apiError_ to throw. */
function pinFail_(sh, row, key) {
  var fails = (Number(row.Fails) || 0) + 1;
  var patch = { Fails: fails };
  if (fails >= PIN_MAX_FAILS_) { patch.LockUntil = Date.now() + PIN_LOCK_MS_; patch.Fails = 0; }
  updateRow_(sh, row._row, patch);
  try { logAuditHr(key, patch.LockUntil ? 'PIN_LOCKED' : 'PIN_WRONG', PIN_SHEET_, key); } catch (e) {}
  if (patch.LockUntil) return apiError_('PIN_LOCKED', 'ใส่ PIN ผิด ' + PIN_MAX_FAILS_ + ' ครั้ง — ล็อก 15 นาที');
  return apiError_('PIN_WRONG', 'PIN ไม่ถูกต้อง (เหลืออีก ' + (PIN_MAX_FAILS_ - fails) + ' ครั้ง)');
}

function handlePinSet(p) {
  p = p || {};
  var key = pinNeedKey_(p);
  var pin = pinCheckNew_(p.pin);
  var sh = pinSheet_(), row = pinRow_(sh, key), now = Date.now();
  var who = pinNameOf_(key);
  if (row && row.PinHash) {
    var mins = pinLockedFor_(row);
    if (mins) throw apiError_('PIN_LOCKED', 'PIN ถูกล็อก — ลองใหม่ในอีก ' + mins + ' นาที');
    if (pinHash_(String(p.oldPin == null ? '' : p.oldPin), row.Salt) !== String(row.PinHash)) throw pinFail_(sh, row, key);
    var salt2 = Utilities.getUuid();
    updateRow_(sh, row._row, { PinHash: pinHash_(pin, salt2), Salt: salt2, Fails: 0, LockUntil: '', SetAt: new Date(), SetBy: key });
    try { logAuditHr(key, 'PIN_CHANGED', PIN_SHEET_, key); } catch (e) {}
  } else {
    var salt = Utilities.getUuid();
    var obj = { StaffID: key, PinHash: pinHash_(pin, salt), Salt: salt, Fails: 0, LockUntil: '', SetAt: new Date(), SetBy: key };
    if (row) updateRow_(sh, row._row, obj); else appendObject_(sh, obj);
    try { logAuditHr(key, 'PIN_SET', PIN_SHEET_, key); } catch (e) {}
    try { inboxAdd_('security', '🔐 ' + who + ' ตั้งรหัส PIN สำหรับรายการเงินแล้ว — ถ้าไม่ใช่คุณ ให้รีเซ็ต PIN ของบัญชีนี้ทันที', ''); } catch (e) {}
  }
  return { ok: true, token: pinToken_(p, now), confirmedUntil: now + PIN_CONFIRM_MS_ };
}

function handlePinVerify(p) {
  p = p || {};
  var key = pinNeedKey_(p);
  var sh = pinSheet_(), row = pinRow_(sh, key);
  if (!row || !row.PinHash) throw apiError_('PIN_NOT_SET', 'ยังไม่ได้ตั้งรหัส PIN');
  var mins = pinLockedFor_(row);
  if (mins) throw apiError_('PIN_LOCKED', 'PIN ถูกล็อก — ลองใหม่ในอีก ' + mins + ' นาที');
  if (pinHash_(String(p.pin == null ? '' : p.pin), row.Salt) !== String(row.PinHash)) throw pinFail_(sh, row, key);
  if (Number(row.Fails) || row.LockUntil) updateRow_(sh, row._row, { Fails: 0, LockUntil: '' });
  var now = Date.now();
  try { logAuditHr(key, 'PIN_OK', PIN_SHEET_, key); } catch (e) {}
  return { ok: true, token: pinToken_(p, now), confirmedUntil: now + PIN_CONFIRM_MS_ };
}

/** Another admin's PIN, cleared IN PLACE — their next money action asks them to set a new one. */
function handlePinReset(p) {
  p = p || {};
  var me = pinNeedKey_(p);
  var target = String(p.targetKey || p.targetStaffId || '').trim();
  if (!target) throw apiError_('BAD_INPUT', 'ต้องระบุแอดมินที่จะรีเซ็ต PIN');
  if (target === me) throw apiError_('NO_PERMISSION', 'รีเซ็ต PIN ของตัวเองไม่ได้ — เปลี่ยน PIN ได้ที่ ตั้งค่า (ต้องใช้ PIN เดิม) หรือให้แอดมินอีกคนรีเซ็ตให้');
  var sh = pinSheet_(), row = pinRow_(sh, target);
  if (!row || !row.PinHash) return { ok: true, cleared: false };
  updateRow_(sh, row._row, { PinHash: '', Salt: '', Fails: 0, LockUntil: '', SetAt: new Date(), SetBy: me });
  try { logAuditHr(me, 'PIN_RESET', PIN_SHEET_, target); } catch (e) {}
  try { inboxAdd_('security', '🔐 ' + pinNameOf_(me) + ' รีเซ็ต PIN ของ ' + pinNameOf_(target) + ' — ต้องตั้ง PIN ใหม่ก่อนทำรายการเงินครั้งถัดไป', ''); } catch (e) {}
  return { ok: true, cleared: true };
}

/** 🛠️ Editor only (not a route): the owner account clears a PIN when no other admin can. */
function resetPinFromEditor(key) {
  key = String(key || '').trim();
  if (!key) throw new Error('ใส่ StaffID ของแอดมิน เช่น resetPinFromEditor("STF-001")');
  var sh = pinSheet_(), row = pinRow_(sh, key);
  if (!row) { Logger.log('ไม่มี PIN ของ ' + key); return; }
  updateRow_(sh, row._row, { PinHash: '', Salt: '', Fails: 0, LockUntil: '', SetAt: new Date(), SetBy: 'editor' });
  try { logAuditHr('editor', 'PIN_RESET', PIN_SHEET_, key); } catch (e) {}
  Logger.log('รีเซ็ต PIN ของ ' + key + ' แล้ว');
}
