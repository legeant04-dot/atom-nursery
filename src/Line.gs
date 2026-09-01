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
/**
 * WHAT WOULD A MONTH OF NOTIFICATIONS ACTUALLY COST?
 *
 * Asked 2026-09-01: "ถ้าอยากแจ้งใน 1 วันจะใช้ Credit เท่าไหร่ และเดือนนึงจะใช้เท่าไหร่ … ต้องอัพเป็น
 * แพ็คเกจไหน". A guess would be worse than useless — the number decides what the school pays every
 * month — so this COUNTS, from the school's own rows over a real window, and multiplies by the
 * people each kind of message actually goes to under the CURRENT settings.
 *
 * One LINE push to one person = one message. A message to three people costs three.
 *
 * The window is school days only: counting a month that contains eight weekend days as if they were
 * all the same would understate a school-day average by a third. Days with no rows at all are not
 * counted either — a window that reaches back before the app was in use would drag the average down.
 *
 * The quota and the usage-so-far come from LINE itself (the same endpoints handleLineDiag uses), so
 * "will this fit" is answered against the real plan rather than against an assumption about it.
 */
function handleLineUsage(p) {
  p = p || {};
  var days = Math.min(Math.max(parseInt(p.days, 10) || 14, 1), 60);
  var MAIN = getMainSpreadsheet_(), HR = getHrSpreadsheet_();
  var today = dateStr_(new Date());
  var from = (function () { var d = new Date(); d.setDate(d.getDate() - days); return dateStr_(d); })();
  var inWin = function (v) { var s = String(v == null ? '' : v).slice(0, 10); return s >= from && s <= today; };

  // --- who a message of each kind reaches, under the settings as they stand right now ---
  var staffLineOn = String(getConfig_('StaffLineNotify', 'false')) === 'true';
  var adminLineOn = String(getConfig_('AdminLineNotify', 'false')) === 'true';
  var recip = {};
  LINE_TOPICS_.forEach(function (t) { recip[t] = lineRecipientsFor_(t).length; });
  var adminUsers = 0;
  try {
    adminUsers = readObjects_(sheet_(MAIN, 'USERS')).filter(function (u) {
      return String(u.Role) === ROLES.ADMIN && String(u.LineUID || '').trim(); }).length;
  } catch (e) {}
  var adminReach = function (topic) { return recip[topic] + (adminLineOn ? adminUsers : 0); };

  // how many teachers a class notice reaches — the average number covering one class, since a leave
  // or a comment goes to whoever covers THAT child's class, not to all staff
  var staffRows = [];
  try { staffRows = readObjects_(sheet_(HR, 'STAFF')); } catch (e) {}
  var onDuty = staffRows.filter(function (s) {
    return typeof staffOnDuty_ === 'function' ? staffOnDuty_(s) : String(s.Role) === 'Teacher'; });
  var classNames = {};
  try { readObjects_(sheet_(MAIN, 'CLASSES')).forEach(function (c) { if (c.ClassName) classNames[c.ClassName] = 1; }); } catch (e) {}
  var clsList = Object.keys(classNames);
  var perClass = clsList.length ? Math.round(clsList.reduce(function (a, c) {
    return a + onDuty.filter(function (s) { return staffCoversClass_(s, c); }).length; }, 0) / clsList.length * 10) / 10 : 0;
  var teacherReach = staffLineOn ? perClass : 0;

  var count = function (wb, sheet, dateField, filter) {
    try {
      var rows = readObjects_(sheet_(wb === 'HR' ? HR : MAIN, sheet));
      var n = 0, byDay = {};
      rows.forEach(function (r) {
        var d = String(r[dateField] == null ? '' : r[dateField]).slice(0, 10);
        if (!inWin(d)) return;
        if (filter && !filter(r)) return;
        n++; byDay[d] = 1;
      });
      return { n: n, days: Object.keys(byDay).length };
    } catch (e) { return { n: 0, days: 0 }; }
  };

  /* Each line: how many EVENTS, and how many messages ONE event sends today. The two are reported
   * separately so the school can see which half to change — fewer events is a different decision
   * from fewer recipients. */
  var items = [];
  var push = function (key, label, ev, per, note) {
    items.push({ key: key, label: label, events: ev.n, activeDays: ev.days, perEvent: per,
      messages: ev.n * per, note: note || '' });
  };
  // a teacher recording a child in or out messages that child's parent — the school's core promise,
  // and by a distance the biggest number here
  var byStaff = count('MAIN', 'CHECKIN_STUDENT', 'Date', function (r) { return String(r.ByStaffID || ''); });
  push('checkinParent', 'แจ้งผู้ปกครองเมื่อคุณครูบันทึกรับ-ส่ง', byStaff, 1, 'ส่งหาผู้ปกครองของเด็กคนนั้น 1 คน');
  // ...and the covering teachers, when StaffLineNotify is on
  var allCheck = count('MAIN', 'CHECKIN_STUDENT', 'Date');
  push('checkinTeacher', 'แจ้งคุณครูเมื่อเด็กมาถึง / กลับ', allCheck, teacherReach,
    staffLineOn ? ('ส่งหาคุณครูที่ดูแลห้องนั้น ~' + perClass + ' คน') : 'ปิดอยู่ — ไม่เสียโควตา');
  push('leave', 'ผู้ปกครองแจ้งลานักเรียน', count('MAIN', 'LEAVE_REQUEST_STD', 'Date'), teacherReach + adminReach('leave'),
    staffLineOn ? '' : 'ส่วนของคุณครูปิดอยู่');
  push('comment', 'ผู้ปกครองแสดงความคิดเห็นในบันทึก', count('MAIN', 'COMMENTS', 'Date'), teacherReach + adminReach('comment'));
  push('staffLeave', 'พนักงานยื่นใบลา (รออนุมัติ)', count('HR', 'LEAVE_REQUEST', 'StartDate'), adminReach('approval'));
  push('ot', 'OT พนักงาน (รออนุมัติ)', count('HR', 'OT_RECORDS', 'Date'), adminReach('ot'));
  push('payment', 'ผู้ปกครองส่งสลิป', count('MAIN', 'PAYMENT_SLIPS', 'SubmittedDate'), adminReach('payment'));
  push('injury', 'แจ้งอุบัติเหตุ (ส่งเสมอ)', count('MAIN', 'INJURY_REPORTS', 'Date'),
    Math.max(1, recip.injury + adminUsers), 'เหตุฉุกเฉินส่ง LINE ทุกครั้ง ไม่ว่าตั้งค่าอย่างไร');

  // digests are two a day, to whoever subscribes to them, on school days only
  var digestOn = (String(getConfig_('DigestMorning', 'true')) !== 'false' ? 1 : 0) +
                 (String(getConfig_('DigestEvening', 'true')) !== 'false' ? 1 : 0);
  var schoolDaysIn = 0;
  for (var i = 0; i < days; i++) {
    var d = new Date(); d.setDate(d.getDate() - i);
    if (!isSchoolClosed_(d)) schoolDaysIn++;
  }
  items.push({ key: 'digest', label: 'สรุปประจำวัน (เช้า/เย็น)', events: digestOn * schoolDaysIn,
    activeDays: schoolDaysIn, perEvent: adminReach('digest'), messages: digestOn * schoolDaysIn * adminReach('digest'),
    note: digestOn ? (digestOn + ' ครั้ง/วันทำการ') : 'ปิดอยู่' });

  var totalMsgs = items.reduce(function (a, x) { return a + x.messages; }, 0);
  // per SCHOOL DAY, not per calendar day — the number the school can act on
  var perDay = schoolDaysIn ? Math.round(totalMsgs / schoolDaysIn) : 0;
  // ~21 school days in a typical month
  var SCHOOL_DAYS_PER_MONTH = 21;
  var perMonth = perDay * SCHOOL_DAYS_PER_MONTH;

  // what LINE itself says the plan is, and what has been spent — never assumed
  var plan = { checked: false };
  try {
    var d0 = handleLineDiag({});
    plan = { checked: true, quotaType: d0.quotaType, quota: d0.quotaValue, used: d0.totalUsage,
      remaining: d0.remaining, overLimit: !!d0.overLimit, tokenConfigured: !!d0.tokenConfigured };
  } catch (e) { plan = { checked: false, error: String(e) }; }

  return { from: from, to: today, days: days, schoolDays: schoolDaysIn,
    staffLineOn: staffLineOn, adminLineOn: adminLineOn, teachersPerClass: perClass,
    recipients: recip, adminUsers: adminUsers,
    items: items, perDay: perDay, perMonth: perMonth, totalInWindow: totalMsgs, plan: plan };
}

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
