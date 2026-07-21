/**
 * Line.gs — LINE platform helpers
 * ------------------------------------------------------------------
 * - verifyLineAccessToken_: confirm a LIFF-supplied access token is
 *   genuine by calling LINE's profile endpoint. This is how we trust
 *   the caller's userId instead of accepting whatever the client sends.
 * - linePush_: send a push message via the Messaging API.
 *
 * Credentials live in SCHOOL_CONFIG (LineChannelAccessToken).
 * ------------------------------------------------------------------
 */

var LINE_API = 'https://api.line.me/v2/bot/message/push';
var LINE_PROFILE_API = 'https://api.line.me/v2/profile';

/**
 * Verify a LIFF access token and return the authenticated profile
 * { userId, displayName, pictureUrl }, or null if invalid.
 */
function verifyLineAccessToken_(accessToken) {
  if (!accessToken) return null;
  try {
    var res = UrlFetchApp.fetch(LINE_PROFILE_API, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var p = JSON.parse(res.getContentText());
    return { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl };
  } catch (e) {
    Logger.log('verifyLineAccessToken_ error: ' + e.message);
    return null;
  }
}

/**
 * Push a text message to a LINE user. Returns true on success.
 * No-op (returns false) if the channel token is not configured yet.
 */
function linePushText_(toUid, text) {
  return linePush_(toUid, [{ type: 'text', text: String(text) }]);
}

function linePush_(toUid, messages) {
  var token = getConfig_('LineChannelAccessToken', '');
  if (!toUid || !token || String(token).indexOf('<FILL') === 0) {
    Logger.log('linePush_ skipped (no token or recipient)');
    return false;
  }
  try {
    var res = UrlFetchApp.fetch(LINE_API, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: toUid, messages: messages }),
      muteHttpExceptions: true
    });
    var ok = res.getResponseCode() === 200;
    if (!ok) Logger.log('linePush_ failed: ' + res.getResponseCode() + ' ' + res.getContentText());
    return ok;
  } catch (e) {
    Logger.log('linePush_ error: ' + e.message);
    return false;
  }
}

/**
 * Admin diagnostic: is LINE actually able to push right now? Checks the token, the monthly push QUOTA
 * and how much has been CONSUMED this month (this is the usual reason pushes silently stop — the free
 * plan caps push messages per month, and linePush_ just returns false when the cap is hit). Also lets
 * an admin fire a real test push to their own UID. payload: { testUid? }
 */
function handleLineDiag(p) {
  p = p || {};
  var token = getConfig_('LineChannelAccessToken', '');
  var out = { tokenConfigured: !!(token && String(token).indexOf('<FILL') !== 0) };
  if (!out.tokenConfigured) { out.note = 'LineChannelAccessToken ยังไม่ได้ตั้งค่าใน SCHOOL_CONFIG'; return out; }
  var hdr = { Authorization: 'Bearer ' + token };
  function get(url) {
    try { var r = UrlFetchApp.fetch(url, { method: 'get', headers: hdr, muteHttpExceptions: true });
      return { code: r.getResponseCode(), body: r.getContentText() }; }
    catch (e) { return { code: -1, body: String(e) }; }
  }
  // monthly limit
  var q = get('https://api.line.me/v2/bot/message/quota');
  out.quotaHttp = q.code;
  try { var qj = JSON.parse(q.body); out.quotaType = qj.type; out.quotaValue = (qj.type === 'limited') ? qj.value : 'unlimited'; }
  catch (e) { out.quotaRaw = q.body; }
  // consumption this month
  var c = get('https://api.line.me/v2/bot/message/quota/consumption');
  out.consumptionHttp = c.code;
  try { out.totalUsage = JSON.parse(c.body).totalUsage; } catch (e) { out.consumptionRaw = c.body; }
  // a 401 on these = bad/expired token; a valid token but totalUsage>=quotaValue = OUT OF QUOTA
  if (out.quotaType === 'limited' && typeof out.quotaValue === 'number' && typeof out.totalUsage === 'number') {
    out.remaining = out.quotaValue - out.totalUsage;
    out.overLimit = out.remaining <= 0;
  }
  // optional live test push to a given UID (e.g. the admin's own)
  if (p.testUid) {
    var r = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', headers: hdr, muteHttpExceptions: true,
      payload: JSON.stringify({ to: p.testUid, messages: [{ type: 'text', text: '🔔 ทดสอบการแจ้งเตือนจากระบบ Atom (' + nowStr_() + ')' }] })
    });
    out.testPush = { http: r.getResponseCode(), body: r.getContentText().slice(0, 200) };
  }
  return out;
}
