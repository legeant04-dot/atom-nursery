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
  p = p || {};
  // 📎 the signature is stored PRIVATELY below, never through the engine's public-link photo path
  var sig = String(p.signature || ''); p.signature = '';
  var res = engineDispatch_('submitApplication', p);
  if (res && !res.existing && sig.indexOf('data:image/') === 0) {
    try { applyStoreDoc_({ appId: res.appId, docType: 'signature', data: sig, name: 'signature.png' }, true); }
    catch (e) { try { Logger.log('signature store ' + e.message); } catch (x) {} }
  }
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
  try { applyMoveDocsToStudent_(res.appId, res.studentId); } catch (e) {}
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

/* ===== 📎 ระยะ 2 — เอกสารแนบ (ผอ. 2026-11-09: รูป + PDF ≤ 5 MB · รับเข้า → โฟลเดอร์นักเรียน ·
 * ไม่รับ/ยกเลิก + 90 วัน → ลบ) =====================================================================
 *
 * 🔴 PRIVATE FILES. Every other picture in this app goes through driveifyImage_, which publishes it
 * "anyone with the link" — fine for a lunch photo, NOT for an ID card or a house registration. These
 * files are created with no sharing at all, so the only way to see one is THIS server reading it for a
 * session the engine has already allowed (appDocAccess_: the owning family or the admin). The finger
 * signature from phase 1 moves here too — it was a public-link image, and a signature is exactly what
 * Certificate.gs refuses to publish for the same reason.
 *
 * The engine owns every rule (who, which state, type, size, how many); this file owns the bytes. A file
 * is written first and the engine asked second — if the engine refuses, the file goes straight to the
 * trash, so a refused upload leaves nothing behind.
 */
var APP_DOC_MAX_BYTES_GS_ = 5 * 1024 * 1024;

function applyDocsRoot_() {
  var name = getConfig_('ApplyDocsFolderName', 'AtomNursery_Applications');
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function applySubFolder_(parent, name) {
  var it = parent.getFoldersByName ? parent.getFoldersByName(name) : null;
  if (it && it.hasNext()) return it.next();
  return parent.createFolder ? parent.createFolder(name) : DriveApp.createFolder(name);
}
function applyAppFolder_(appId) { return applySubFolder_(applyDocsRoot_(), String(appId)); }
// the child's own folder once accepted — named so a person browsing Drive can find them
function applyStudentFolder_(studentId) {
  var name = getConfig_('StudentFolderRoot', 'AtomNursery_Students');
  var it = DriveApp.getFoldersByName(name);
  var root = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  var st = null;
  try { st = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return String(s.StudentID) === String(studentId); }); } catch (e) {}
  return applySubFolder_(root, String(studentId) + (st && st.Name ? ' ' + st.Name : ''));
}
function applyTrash_(fileId) { if (!fileId) return; try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
// 'data:<mime>;base64,<b64>' → { mime, bytes } — or null
function applyParseData_(data) {
  var m = /^data:([^;,]+);base64,(.*)$/.exec(String(data || ''));
  if (!m) return null;
  try { return { mime: m[1].toLowerCase(), bytes: Utilities.base64Decode(m[2]) }; } catch (e) { return null; }
}
// write one private file and register it through the engine's rules; refused → trashed
function applyStoreDoc_(p, internal) {
  var parsed = applyParseData_(p.data);
  if (!parsed) throw apiError_('BAD_INPUT', 'ไม่มีไฟล์ หรือไฟล์อ่านไม่ได้');
  if (parsed.bytes.length > APP_DOC_MAX_BYTES_GS_) throw apiError_('TOO_LARGE', 'ไฟล์ใหญ่เกิน 5 MB — กรุณาย่อหรือสแกนใหม่');
  var ext = parsed.mime === 'application/pdf' ? '.pdf' : parsed.mime === 'image/png' ? '.png' : '.jpg';
  var name = String(p.docType || 'doc') + '-' + Date.now() + ext;
  var file = applyAppFolder_(p.appId).createFile(Utilities.newBlob(parsed.bytes, parsed.mime, name));
  var q = {}; for (var k in p) if (p.hasOwnProperty(k) && k !== 'data') q[k] = p[k];
  q.fileId = file.getId(); q.mime = parsed.mime; q.size = parsed.bytes.length; q.name = p.name || name;
  if (internal) { q.__internal = true; q.__role = 'Admin'; }
  var res;
  try { res = engineDispatch_('uploadApplicationDoc', q); } catch (e) { applyTrash_(q.fileId); throw e; }
  // a paper photographed AFTER acceptance belongs with the child straight away
  if (res && res.studentId) { try { file.moveTo(applyStudentFolder_(res.studentId)); } catch (e) {} }
  return res;
}

function handleUploadApplicationDoc(p) { return applyStoreDoc_(p || {}, false); }

function handleApplicationDocFile(p) {
  var res = engineDispatch_('applicationDocFile', p || {});
  var out = { docId: res.docId, type: res.type, name: res.name, mime: res.mime, size: res.size, data: res.data || '' };
  if (res.fileId) {
    try { var b = DriveApp.getFileById(res.fileId).getBlob();
      out.data = 'data:' + (res.mime || b.getContentType()) + ';base64,' + Utilities.base64Encode(b.getBytes()); }
    catch (e) { throw apiError_('NOT_FOUND', 'เปิดไฟล์ไม่ได้ — ไฟล์อาจถูกลบไปแล้ว'); }
  }
  return out;
}

function handleDeleteApplicationDoc(p) {
  var res = engineDispatch_('deleteApplicationDoc', p || {});
  applyTrash_(res && res.fileId);
  return { docId: res.docId, ok: true };
}

/* Accepted → the papers go to the child's folder (ผอ. answer, 2026-11-09). Kept under the same rule as
 * the rest of the child's record (the PDPA text: 5 years after the child leaves). */
function applyMoveDocsToStudent_(appId, studentId) {
  if (!studentId) return 0;
  var n = 0, folder = null;
  try {
    var sh = getMainSpreadsheet_().getSheetByName('APPLICATION_DOCS');
    if (!sh) return 0;
    readObjects_(sh).forEach(function (d) {
      if (String(d.AppID) !== String(appId) || d.Status === 'DELETED' || !d.FileID) return;
      try { folder = folder || applyStudentFolder_(studentId); DriveApp.getFileById(d.FileID).moveTo(folder); n++; } catch (e) {}
    });
  } catch (e) { try { Logger.log('applyMoveDocsToStudent_ ' + e.message); } catch (x) {} }
  return n;
}

/** Daily (from dailyBackup): declined / withdrawn applications' papers, 90 days after the decision. */
function purgeApplicationDocs_() {
  var res = engineDispatch_('purgeApplicationDocs', {});
  (res.files || []).forEach(function (f) { applyTrash_(f.fileId); });
  if (res.deleted) { try { logAudit('system', 'APP_DOCS_PURGED', 'APPLICATION_DOCS', res.deleted + ' files · ' + res.retentionDays + ' days'); } catch (e) {} }
  return res;
}

/* ===== 🔒 ระยะ 3 — the family's latest answer to one 7.3 item, read straight from CONSENTS ============
 * The LAST row for that child and item wins ('' when there is none = the paper form signed before the
 * app = allowed). Used by Journal.gs, which writes rows in place and never runs the engine. */
function studentConsentValue_(studentId, item) {
  var v = '';
  try {
    var sh = getMainSpreadsheet_().getSheetByName('CONSENTS');
    if (!sh) return '';
    readObjects_(sh).forEach(function (c) {
      if (String(c.StudentID) === String(studentId) && String(c.Item) === String(item)) v = String(c.Value || '');
    });
  } catch (e) {}
  return v;
}
