/**
 * Apply.gs — 📝 ใบสมัครออนไลน์, the half the engine cannot do: TELLING PEOPLE.
 *
 * The decisions (submit, book a visit, approve, decline) are the engine's — webapp/engine.js, the
 * handlers from applyInfo to approveApplication — so the local build and the live one run the same
 * rule. These wrappers run that decision first and only then notify, so a refused request tells
 * nobody anything.
 *
 *   new application   → the admin's 🔔 (always — an application waits for the admin and nobody else)
 *                       + LINE to whoever the school put on the recipient list for 'registration'
 *   visit / declined  → the family's 🔔, keyed by the APPLICATION id (there is no child yet — see
 *                       inboxStudentsForParent_, which counts a family's applications as theirs)
 *   approved          → the family's 🔔, keyed by the new STUDENT id, like every other child notice
 *
 * 🔴 NO LINE TO FAMILIES IN PHASE 1, and therefore no switch for it. The plan's default for the new
 * topic was "app only" (the LINE quota has run out before), and a settings row whose LINE box did
 * nothing would be the very defect atom-line-notifications warns about — a label that over-describes
 * the code. When LINE is wanted it becomes a topic in LINE_TOPIC_KEYS_ like the others.
 */

function handleSubmitApplication(p) {
  var res = engineDispatch_('submitApplication', p);
  if (res && !res.existing) {
    try {
      var c = (p && p.child) || {};
      var nick = c.NicknameEN || c.Nickname || '';
      var text = '📝 ใบสมัครใหม่: ' + (c.NameTH || '') + (nick ? ' (' + nick + ')' : '') + ' — เปิดเมนู ใบสมัคร เพื่อพิจารณา';
      inboxAdd_('registration', text, 'app|' + res.appId);
      applyLineAdmins_(text);
    } catch (e) { try { Logger.log('handleSubmitApplication notify ' + e.message); } catch (x) {} }
  }
  return res;
}

function handleSetApplicationVisit(p) {
  var res = engineDispatch_('setApplicationVisit', p);
  try {
    applyFamilyBell_(res.appId, '🏫 นัดเยี่ยมชมโรงเรียน: ' + applyWhen_(res.visitAt) + ' — ' + applyChild_(res)
      + (res.visitNote ? ('\n' + res.visitNote) : '') + '\nหากต้องการเลื่อนนัด กรุณาโทรติดต่อโรงเรียน');
  } catch (e) { try { Logger.log('handleSetApplicationVisit notify ' + e.message); } catch (x) {} }
  return res;
}

function handleRejectApplication(p) {
  var res = engineDispatch_('rejectApplication', p);
  try {
    applyFamilyBell_(res.appId, 'ใบสมัครของ ' + applyChild_(res) + ' ไม่ได้รับการตอบรับ'
      + (res.parentMessage ? ('\n' + res.parentMessage) : ''));
  } catch (e) { try { Logger.log('handleRejectApplication notify ' + e.message); } catch (x) {} }
  return res;
}

function handleApproveApplication(p) {
  var res = engineDispatch_('approveApplication', p);
  try {
    inboxAddStudent_('parent', '🎉 ' + applyChild_(res) + ' ได้รับการตอบรับเข้าเรียนแล้ว · ชั้น ' + (res.className || '-')
      + ' · เริ่มเรียน ' + applyWhen_(res.startDate) + (res.parentMessage ? ('\n' + res.parentMessage) : ''), '', res.studentId);
  } catch (e) { try { Logger.log('handleApproveApplication notify ' + e.message); } catch (x) {} }
  return res;
}

/* ---- helpers ---------------------------------------------------------------------------------- */
function applyFamilyBell_(appId, text) { if (appId) inboxAddStudent_('parent', text, 'app|' + appId, appId); }
function applyChild_(v) { return (v && (v.nick || v.childName || v.nickEN)) || 'บุตรหลาน'; }
// 'YYYY-MM-DD[ HH:mm]' → 'DD/MM/BBBB[ HH:mm น.]' — the way the school writes a date to a family
function applyWhen_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(s || ''));
  if (!m) return String(s || '');
  return m[3] + '/' + m[2] + '/' + (parseInt(m[1], 10) + 543) + (m[4] ? (' ' + m[4] + ' น.') : '');
}
// the recipient list the school keeps for 'registration' — nobody on it, nobody messaged
function applyLineAdmins_(text) {
  var seen = {};
  try {
    lineRecipientsFor_('registration').forEach(function (r) {
      var uid = String(r.LineUID || '').trim();
      if (uid && !seen[uid]) { seen[uid] = 1; linePushText_(uid, text); }
    });
  } catch (e) {}
}

/** The application ids a family may be told about — used by inboxStudentsForParent_ (Notify.gs) so
 *  a family with no child yet still has a bell. Same ownership rule as the engine's appOwned_. */
function applyIdsForParent_(pid, uid) {
  var out = [];
  try {
    var sh = getMainSpreadsheet_().getSheetByName('APPLICATIONS');
    if (!sh) return out;
    readObjects_(sh).forEach(function (a) {
      if ((pid && String(a.ParentID) === String(pid)) || (uid && String(a.UserUID) === String(uid))) out.push(String(a.AppID));
    });
  } catch (e) {}
  return out;
}
