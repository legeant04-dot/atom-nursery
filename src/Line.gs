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
