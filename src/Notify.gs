/**
 * Notify.gs — notification hub: in-app Admin inbox + time-window digests + emergency push.
 * ------------------------------------------------------------------
 * Why: the free LINE push plan caps messages per month (~300). Routine admin approvals used to
 * LINE-push every admin on every event and exhausted the quota. Now those land in an IN-APP inbox
 * (the header 🔔 bell) and only reach LINE when SCHOOL_CONFIG AdminLineNotify='true'. EMERGENCIES
 * (accident/injury) always push LINE regardless, and — when the teacher ticks the box — the parents too.
 * Two daily DIGESTS (10:00 morning, 20:00 evening) summarise the day into ONE message instead of many.
 * ------------------------------------------------------------------
 */

// ---- in-app Admin inbox ---------------------------------------------------------------------------
function inboxSheet_() {
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName('ADMIN_INBOX');
  if (!sh) { sh = ss.insertSheet('ADMIN_INBOX'); sh.appendRow(['InboxID', 'Date', 'Category', 'Text', 'Read']); }
  return sh;
}
function inboxBust_() { try { CacheService.getScriptCache().removeAll(['rows:ADMIN_INBOX', 'col:ADMIN_INBOX']); } catch (e) {} }

/** Append a line to the Admin in-app inbox (best-effort; never throws into the caller). */
function inboxAdd_(category, text) {
  try {
    var sh = inboxSheet_();
    try { ensureColumns_(sh, ['InboxID', 'Date', 'Category', 'Text', 'Read']); } catch (e) {}
    var id = 'IN-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    appendObject_(sh, { InboxID: id, Category: category || '', Text: String(text || ''), Read: '',
      Date: dateStr_(new Date()) + ' ' + timeStr_(new Date()) });
    inboxBust_();
  } catch (e) { try { Logger.log('inboxAdd_ ' + e.message); } catch (x) {} }
}

/** Format an inbox Date cell for display. Sheets often coerces the stored "YYYY-MM-DD HH:mm" text into a
 *  Date object, whose String() is "Thu Jul 22 2026 …" — format it back to a clean "dd/MM HH:mm". */
function inboxFmtDate_(d) {
  if (d instanceof Date) { try { return Utilities.formatDate(d, tz_(), 'dd/MM HH:mm'); } catch (e) { return ''; } }
  return String(d || '').slice(0, 16);
}
/** Admin reads the inbox (newest first). Non-admins get nothing. Sort by InboxID (IN-<ms>-…) so it's
 *  chronological regardless of how the Date cell was stored. */
function handleAdminInbox(p) {
  p = p || {};
  var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
  if (!sh) return { items: [], unread: 0 };
  var rows = readObjects_(sh).map(function (r) {
    // Prefer the epoch ms embedded in InboxID (IN-<ms>-…): an absolute instant, so formatting in tz_()
    // is always correct regardless of the spreadsheet's own timezone (the Date cell can be re-parsed in
    // the wrong TZ → an 11h shift). Fall back to the cell only when the id has no ms.
    var mm = /^IN-(\d+)-/.exec(String(r.InboxID || ''));
    var disp = mm ? Utilities.formatDate(new Date(parseInt(mm[1], 10)), tz_(), 'dd/MM HH:mm') : inboxFmtDate_(r.Date);
    return { id: r.InboxID, date: disp, category: r.Category, text: r.Text, read: String(r.Read) === 'YES' };
  });
  rows.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
  return { items: rows.slice(0, 100), unread: rows.filter(function (r) { return !r.read; }).length };
}
function handleMarkInboxRead(p) {
  p = p || {};
  var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
  if (!sh) return { ok: true };
  readObjects_(sh).forEach(function (r) {
    if (String(r.Read) !== 'YES' && (!p.id || String(r.InboxID) === String(p.id))) updateRow_(sh, r._row, { Read: 'YES' });
  });
  inboxBust_();
  return { ok: true };
}

// The header 🔔 bell reuses the existing `notifications`/`markNotifsRead` actions. For an Admin caller
// they now map to the inbox; for everyone else they keep the engine behavior (empty on GAS today).
// Under RequireSessionToken, applyIdentity_ forces a non-admin's role, so p.role can't be spoofed.
function handleNotifications(p) {
  p = p || {};
  if (String(p.role) !== ROLES.ADMIN) { try { return engineDispatch_('notifications', p); } catch (e) { return []; } }
  return handleAdminInbox(p).items.map(function (it) {
    return { id: it.id, text: it.text, textEN: '', time: String(it.date).slice(5, 16), read: it.read };
  });
}
function handleMarkNotifsRead(p) {
  p = p || {};
  if (String(p.role) === ROLES.ADMIN) return handleMarkInboxRead({});
  try { return engineDispatch_('markNotifsRead', p); } catch (e) { return { ok: true }; }
}

// ---- emergency push (always LINE; bypasses the quota gate) ----------------------------------------
function notifyAdminsUrgent_(text) {
  inboxAdd_('emergency', text);
  var users = readObjects_(sheet_(getMainSpreadsheet_(), 'USERS'));
  var sent = 0;
  users.forEach(function (u) { if (String(u.Role) === ROLES.ADMIN && u.LineUID) { if (linePushText_(u.LineUID, text)) sent++; } });
  if (sent === 0) { var fb = getConfig_('AdminLineUID', ''); if (fb && String(fb).indexOf('<FILL') !== 0) linePushText_(fb, text); }
}

/**
 * Injury/accident report. Records via the shared engine, then ALWAYS pushes an emergency LINE alert to
 * admins + leaders (emergencies never wait for a digest and never get suppressed by the quota gate).
 * When the teacher ticked "notify parent" (p.notifyParent) the child's parents are pushed too.
 */
function handleSubmitInjury(p) {
  p = p || {};
  var res = engineDispatch_('submitInjury', p);
  try {
    var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return String(s.StudentID) === String(p.studentId); }) || {};
    var who = student.Name || p.childName || p.studentId;
    var cls = student.Class ? (' · ' + student.Class) : '';
    var msg = '🚨 อุบัติเหตุ/เหตุฉุกเฉิน: ' + who + cls + '\nเวลา ' + (p.time || timeStr_(new Date())) + (p.narrative ? ('\nเหตุการณ์: ' + p.narrative) : '');
    notifyAdminsUrgent_(msg);
    try { notifyLeaders_(msg); } catch (e) {}
    if (p.notifyParent) { try { notifyStudentParents_(student, '🚨 แจ้งเหตุจากโรงเรียน: ' + who + cls + '\nเวลา ' + (p.time || timeStr_(new Date())) + (p.narrative ? ('\n' + p.narrative) : '') + '\nคุณครูได้ดูแลเบื้องต้นแล้ว หากมีข้อสงสัยติดต่อโรงเรียน'); } catch (e) {} }
  } catch (e) { try { Logger.log('handleSubmitInjury notify ' + e.message); } catch (x) {} }
  return res;
}

// ---- daily digests (skip weekends + holidays) ----------------------------------------------------
function digestEvening_() {
  if (isSchoolClosed_(new Date())) return;
  if (String(getConfig_('DigestEvening', 'true')) !== 'true') return;
  var today = dateStr_(new Date());
  var r = null; try { r = engineDispatch_('dailyReport', {}); } catch (e) {}
  var tot = (r && r.totals) || { in: 0, out: 0, leave: 0, absent: 0, total: 0 };
  var lines = ['📊 สรุปประจำวัน ' + today,
    'นักเรียน: มา ' + (tot.in + tot.out) + '/' + tot.total + ' · ลา ' + tot.leave + ' · ขาด ' + tot.absent,
    'ครูมาสาย: ' + (((r && r.lateStaff) || []).length) + ' คน'];
  try {
    var ot = readObjects_(sheet_(getMainSpreadsheet_(), 'OT_DAILY')).filter(function (o) { return dateStr_(new Date(o.Date)) === today; });
    if (ot.length) lines.push('OT นักเรียนวันนี้: ' + ot.length + ' ราย รวม ' + ot.reduce(function (a, o) { return a + (Number(o.Amount) || 0); }, 0) + ' บาท');
  } catch (e) {}
  try {
    var sor = readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).filter(function (o) { return String(o.Status).toUpperCase() === 'PENDING_ADMIN'; });
    if (sor.length) lines.push('OT ครูรออนุมัติ: ' + sor.length + ' ราย');
  } catch (e) {}
  if (r && r.injuries && r.injuries.length) lines.push('⚠️ อุบัติเหตุวันนี้: ' + r.injuries.length + ' ราย');
  notifyAdmins_(lines.join('\n'));
}
function digestMorning_() {
  if (isSchoolClosed_(new Date())) return;
  if (String(getConfig_('DigestMorning', 'true')) !== 'true') return;
  var today = dateStr_(new Date());
  var lines = ['🌅 สรุปเช้า ' + today];
  if (isBigCleaningDay_(today)) lines.push('🧹 วันนี้เป็นวัน Big Cleaning');
  try {
    var lv = readObjects_(sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST')).filter(function (l) { return String(l.Status).indexOf('PENDING') === 0; });
    if (lv.length) lines.push('⏳ ใบลา (ครู) รออนุมัติ: ' + lv.length);
  } catch (e) {}
  try {
    var sl = readObjects_(sheet_(getMainSpreadsheet_(), 'PAYMENT_SLIPS')).filter(function (s) { return String(s.Status).toUpperCase() === 'SUBMITTED'; });
    if (sl.length) lines.push('💳 สลิปรอตรวจสอบ: ' + sl.length);
  } catch (e) {}
  if (lines.length === 1) lines.push('ไม่มีรายการค้างอนุมัติ');
  notifyAdmins_(lines.join('\n'));
}

/** Admin: re-install time triggers so schedule edits (incl. the 10:00/20:00 digests) take effect. */
function handleReinstallTriggers(p) { installTriggers(); return { ok: true, triggers: ScriptApp.getProjectTriggers().length }; }
