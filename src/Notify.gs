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

/* ===== WHO GETS A LINE PUSH, BY NAME AND BY TOPIC =================================================
 * Asked 2026-09-01: "ต้องการให้ Line OA แจ้งเตือนไปที่ Admin หรือคนที่ระบบกำหนด … หรือสามารถกำหนดได้ว่า
 * จะแจ้งเตือนไปที่ใครบ้าง ไม่แจ้งใครบ้าง เฉพาะเรื่องไหนที่ระบบจะแจ้งไป".
 *
 * Until now the only control was AdminLineNotify: every Admin-role user, about everything, or
 * nobody. On a plan capped at 300 messages a month that is not a setting anybody can use — the
 * school turned it off and lost the notifications they DID want along with the ones they did not.
 *
 * A row per person, with the topics they asked for. `Topics` is a comma-separated list of the same
 * category names inboxAdd_ files by, or '*' for everything. Nobody on the list, nobody pushed — the
 * list IS the switch, so there is no way to have a recipient configured and silently not reach them.
 *
 * EMERGENCIES IGNORE THE TOPIC FILTER. A child has been hurt; that is not a subscription. Everyone
 * active on the list gets it, whatever they ticked. Removing yourself from the list entirely is the
 * only way out, which is a decision somebody has to make deliberately.
 */
var LINE_TOPICS_ = ['approval', 'leave', 'ot', 'payment', 'registration', 'comment', 'injury', 'digest', 'payslip'];
function lineRecipientsSheet_() {
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName('LINE_RECIPIENTS');
  if (!sh) { sh = ss.insertSheet('LINE_RECIPIENTS'); sh.appendRow(['Name', 'LineUID', 'Topics', 'Active', 'Note']); }
  return sh;
}
/** Everyone who should get a LINE push about `category`. Emergencies reach every active row. */
function lineRecipientsFor_(category) {
  var cat = String(category || '').trim() || 'approval';
  var urgent = (cat === 'emergency' || cat === 'injury');
  try {
    return readObjects_(lineRecipientsSheet_()).filter(function (r) {
      if (!String(r.LineUID || '').trim()) return false;
      if (!/^(yes|true|1|y)$/i.test(String(r.Active == null ? 'YES' : r.Active).trim())) return false;
      if (urgent) return true;                       // see the note above — not a subscription
      /* '*' means every topic; EMPTY MEANS NONE. Those have to be different, or unticking every box
       * would quietly subscribe somebody to everything — the opposite of what the person doing the
       * unticking asked for, on a channel that costs money per message. Fails closed. */
      var t = String(r.Topics == null ? '' : r.Topics).trim();
      if (t === '*') return true;
      if (!t) return false;
      return t.split(/[,\s]+/).map(function (x) { return x.trim(); }).indexOf(cat) >= 0;
    });
  } catch (e) { return []; }
}
/** Route: read the list (admin-only). */
function handleLineRecipients() {
  return { topics: LINE_TOPICS_, rows: readObjects_(lineRecipientsSheet_()).map(function (r) {
    // `|| '*'` here would turn "no topics" back into "all topics" on the way to the screen — the
    // same conflation lineRecipientsFor_ refuses. Report the cell as it is.
    return { name: String(r.Name || ''), uid: String(r.LineUID || ''), topics: String(r.Topics == null ? '' : r.Topics),
      active: !/^(no|false|0|n)$/i.test(String(r.Active == null ? 'YES' : r.Active).trim()),
      note: String(r.Note || '') };
  }) };
}
/** Route: replace the list wholesale (the screen sends all rows). Admin-only. */
function handleSaveLineRecipients(p) {
  p = p || {};
  var rows = Array.isArray(p.rows) ? p.rows : [];
  var clean = rows.map(function (r) {
    // only the topics this app actually files by — a typo here would silently never match anything
    /* Unknown topic names are DROPPED, and an empty result stays empty — it means "none", not
     * "everything". A name this app does not file by would match nothing anyway; keeping it would
     * leave a row that looks configured on screen and never fires. */
    var t = String((r && r.topics) == null ? '' : r.topics).trim();
    if (t !== '*') {
      t = t.split(/[,\s]+/).map(function (x) { return x.trim(); })
           .filter(function (x) { return LINE_TOPICS_.indexOf(x) >= 0; }).join(',');
    }
    return { Name: String((r && r.name) || '').slice(0, 60), LineUID: String((r && r.uid) || '').trim(),
      Topics: t, Active: (r && r.active === false) ? 'NO' : 'YES', Note: String((r && r.note) || '').slice(0, 120) };
  }).filter(function (r) { return r.LineUID; });
  var sh = lineRecipientsSheet_();
  writeRows_('MAIN', 'LINE_RECIPIENTS', clean, {});
  try { CacheService.getScriptCache().removeAll(['rows:LINE_RECIPIENTS', 'col:LINE_RECIPIENTS']); } catch (e) {}
  try { logAudit(p.adminId || 'admin', 'LINE_RECIPIENTS_SAVE', 'LINE_RECIPIENTS', String(clean.length)); } catch (e) {}
  return { ok: true, count: clean.length };
}

// ---- in-app Admin inbox ---------------------------------------------------------------------------
function inboxSheet_() {
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName('ADMIN_INBOX');
  if (!sh) { sh = ss.insertSheet('ADMIN_INBOX'); sh.appendRow(['InboxID', 'Date', 'Category', 'Text', 'Read', 'Ref', 'StaffID']); }
  return sh;
}
function inboxBust_() { try { CacheService.getScriptCache().removeAll(['rows:ADMIN_INBOX', 'col:ADMIN_INBOX']); } catch (e) {} }

/** Append a line to the Admin in-app inbox (best-effort; never throws into the caller).
 *  ref (optional) = a deep-link "kind|studentId|date" so tapping the notification opens that exact item. */
function inboxAdd_(category, text, ref, staffId) {
  try {
    var sh = inboxSheet_();
    try { ensureColumns_(sh, ['InboxID', 'Date', 'Category', 'Text', 'Read', 'Ref', 'StaffID']); } catch (e) {}
    var id = 'IN-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    appendObject_(sh, { InboxID: id, Category: category || '', Text: String(text || ''), Read: '', Ref: ref || '', StaffID: staffId || '',
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
/** Inbox rows for one audience. staffId empty/omitted = the shared Admin inbox (every row that has no
 *  owner, which is exactly what existed before StaffID was introduced). */
function inboxItems_(staffId) {
  var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
  if (!sh) return [];
  var want = String(staffId || '');
  return readObjects_(sh).filter(function (r) { return String(r.StaffID || '') === want; });
}
function handleAdminInbox(p) {
  p = p || {};
  var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
  if (!sh) return { items: [], unread: 0 };
  var rows = inboxItems_('').map(function (r) {
    // Prefer the epoch ms embedded in InboxID (IN-<ms>-…): an absolute instant, so formatting in tz_()
    // is always correct regardless of the spreadsheet's own timezone (the Date cell can be re-parsed in
    // the wrong TZ → an 11h shift). Fall back to the cell only when the id has no ms.
    var mm = /^IN-(\d+)-/.exec(String(r.InboxID || ''));
    var disp = mm ? Utilities.formatDate(new Date(parseInt(mm[1], 10)), tz_(), 'dd/MM HH:mm') : inboxFmtDate_(r.Date);
    return { id: r.InboxID, date: disp, category: r.Category, text: r.Text, read: String(r.Read) === 'YES', ref: r.Ref || '' };
  });
  rows.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
  return { items: rows.slice(0, 100), unread: rows.filter(function (r) { return !r.read; }).length };
}
function handleMarkInboxRead(p) {
  p = p || {};
  var sh = getMainSpreadsheet_().getSheetByName('ADMIN_INBOX');
  if (!sh) return { ok: true };
  var own = String(p.staffId || '');   // only ever clear the caller's own inbox
  readObjects_(sh).forEach(function (r) {
    if (String(r.StaffID || '') !== own) return;
    if (String(r.Read) !== 'YES' && (!p.id || String(r.InboxID) === String(p.id))) updateRow_(sh, r._row, { Read: 'YES' });
  });
  inboxBust_();
  return { ok: true };
}

/** The same inbox, addressed to one staff member. Teachers had no in-app notifications at all:
 *  notifyStudentTeacher_ only ever sent a LINE push, and the school's free LINE quota is exhausted,
 *  so a parent's comment reached nobody. */
function handleStaffInbox(p) {
  p = p || {};
  var staffId = String(p.staffId || '');
  if (!staffId) return { items: [], unread: 0 };
  var rows = inboxItems_(staffId).map(function (r) {
    var mm = /^IN-(\d+)-/.exec(String(r.InboxID || ''));
    var disp = mm ? Utilities.formatDate(new Date(parseInt(mm[1], 10)), tz_(), 'dd/MM HH:mm') : inboxFmtDate_(r.Date);
    return { id: r.InboxID, date: disp, category: r.Category, text: r.Text, read: String(r.Read) === 'YES', ref: r.Ref || '' };
  });
  rows.sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
  return { items: rows.slice(0, 100), unread: rows.filter(function (r) { return !r.read; }).length };
}

// The header 🔔 bell reuses the existing `notifications`/`markNotifsRead` actions. For an Admin caller
// they now map to the inbox; for everyone else they keep the engine behavior (empty on GAS today).
// Under RequireSessionToken, applyIdentity_ forces a non-admin's role, so p.role can't be spoofed.
function handleNotifications(p) {
  p = p || {};
  var shape = function (box) {
    return box.items.map(function (it) {
      return { id: it.id, text: it.text, textEN: '', time: String(it.date).slice(5, 16), read: it.read, category: it.category, ref: it.ref };
    });
  };
  if (String(p.role) === ROLES.ADMIN) return shape(handleAdminInbox(p));
  // staff (teacher / leader) now have their own inbox rows; fall back to the engine for parents
  if (p.staffId) return shape(handleStaffInbox(p));
  try { return engineDispatch_('notifications', p); } catch (e) { return []; }
}
function handleMarkNotifsRead(p) {
  p = p || {};
  if (String(p.role) === ROLES.ADMIN) return handleMarkInboxRead({});
  if (p.staffId) return handleMarkInboxRead({ staffId: p.staffId });
  try { return engineDispatch_('markNotifsRead', p); } catch (e) { return { ok: true }; }
}

// ---- emergency push (always LINE; bypasses the quota gate) ----------------------------------------
function notifyAdminsUrgent_(text, ref) {
  inboxAdd_('emergency', text, ref);
  var seen = {}, sent = 0;
  // everyone on the recipient list, whatever topics they picked — a child has been hurt, and that is
  // not a subscription (see lineRecipientsFor_). Admin-role users are added on top, as before.
  try {
    lineRecipientsFor_('emergency').forEach(function (r) {
      var uid = String(r.LineUID || '').trim();
      if (uid && !seen[uid]) { seen[uid] = 1; if (linePushText_(uid, text)) sent++; }
    });
  } catch (e) {}
  var users = readObjects_(sheet_(getMainSpreadsheet_(), 'USERS'));
  users.forEach(function (u) { var uid = String(u.LineUID || '').trim();
    if (String(u.Role) === ROLES.ADMIN && uid && !seen[uid]) { seen[uid] = 1; if (linePushText_(uid, text)) sent++; } });
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
    // Carry the report id so tapping the notification opens THAT report. Without a ref the admin's
    // notification only knew the category and fell back to the dashboard — which is why an emergency
    // could be announced but not actually read.
    var ref = (res && res.injuryId) ? ('injury|' + res.injuryId) : '';
    notifyAdminsUrgent_(msg, ref);
    try { notifyLeaders_(msg); } catch (e) {}
    if (p.notifyParent) { try { notifyStudentParents_(student, '🚨 แจ้งเหตุจากโรงเรียน: ' + who + cls + '\nเวลา ' + (p.time || timeStr_(new Date())) + (p.narrative ? ('\n' + p.narrative) : '') + '\nคุณครูได้ดูแลเบื้องต้นแล้ว หากมีข้อสงสัยติดต่อโรงเรียน'); } catch (e) {} }
  } catch (e) { try { Logger.log('handleSubmitInjury notify ' + e.message); } catch (x) {} }
  return res;
}

// New-registration notice → Admin in-app inbox (the parent-facing action runs via the shared engine;
// this wrapper records it + then runs the engine). isNewParent flags a brand-new family (registerNew).
function handleRegNotify_(action, p, isNewParent) {
  var res = engineDispatch_(action, p);
  try {
    var st = (p && p.student) || {};
    var who = st.NameTH || st.NameEN || (res && res.studentId) || '';
    var nick = st.NicknameEN || st.Nickname || '';
    inboxAdd_('registration', '🆕 ลงทะเบียนนักเรียนใหม่: ' + who + (nick ? (' (' + nick + ')') : '') + (isNewParent ? ' + ผู้ปกครองใหม่' : ''));
  } catch (e) { try { Logger.log('handleRegNotify_ ' + e.message); } catch (x) {} }
  return res;
}
function handleRegisterNew(p) { return handleRegNotify_('registerNew', p, true); }
function handleAddChildNew(p) { return handleRegNotify_('addChildNew', p, false); }

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
  /* Days somebody clocked IN and never OUT. Nobody was told — not the teacher, not the head teacher,
   * not the admin — and the monthly screen called the month "ครบ" anyway. The teacher sees it on
   * their own home screen; this is how it reaches the people who can chase it. */
  try {
    var mo = engineDispatch_('staffMissingCheckout', {});
    if (mo && mo.count) {
      lines.push('⏳ ยังไม่ได้ลงเวลาออก ' + mo.count + ' วัน (เดือนนี้) — ให้คุณครูส่งคำขอลงเวลา');
      (mo.staff || []).forEach(function (s) {
        lines.push('   • ' + (s.nick || s.name || s.staffId) + ': ' + (s.days || []).join(', '));
      });
    }
  } catch (e) {}
  notifyAdmins_(lines.join('\n'));
}
function digestMorning_() {
  if (isSchoolClosed_(new Date())) return;
  if (String(getConfig_('DigestMorning', 'true')) !== 'true') return;
  var today = dateStr_(new Date());
  var lines = ['🌅 สรุปเช้า ' + today];
  if (isBigCleaningDay_(today)) lines.push('👥 วันนี้เป็นวันประชุม');
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
