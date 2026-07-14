/**
 * ClassOrg.gs — class-management change requests (ย้ายครูประจำชั้น/แผนก).
 * ------------------------------------------------------------------
 * A Leader stages teacher department moves in the app and submits them as ONE request
 * (PENDING_ADMIN). An Admin reviews the Before/After list and approves (applies the moves +
 * logs) or rejects. An Admin's own submission is applied immediately.
 *
 * All writes are IN-PLACE (updateRow_/appendObject_) so applying a move never rewrites the whole
 * STAFF collection (the 2026-07-09 data-loss class of bug). Reads (myClassChanges/pendingClassChanges)
 * defer to the shared engine, which hydrates CLASS_CHANGE_REQ. Registered in Code.gs.
 * ------------------------------------------------------------------
 */
function coStaffById_(id) {
  return findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(id); }) || {};
}
function coSheet_() {
  var ss = getHrSpreadsheet_();
  var sh = ss.getSheetByName('CLASS_CHANGE_REQ');
  var cols = ['ReqID', 'RequestBy', 'RequestByName', 'CreatedDate', 'Status', 'Changes', 'Note', 'Step2By', 'DecidedDate'];
  if (!sh) { sh = ss.insertSheet('CLASS_CHANGE_REQ'); sh.getRange(1, 1, 1, cols.length).setValues([cols]); return sh; }
  ensureColumns_(sh, cols);
  return sh;
}
function coBust_() { if (typeof cacheDel_ === 'function') { cacheDel_('col:CLASS_CHANGE_REQ'); cacheDel_('rows:CLASS_CHANGE_REQ'); } }
function coIsAdmin_(s) { return s.PositionLevel === 'Admin' || s.Role === 'Admin'; }
function coNextId_(sh) {
  var max = 0;
  readObjects_(sh).forEach(function (r) { var m = /CCR-?(\d+)/.exec(String(r.ReqID || '')); if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'CCR-' + ('00' + (max + 1)).slice(-3);
}
function coLog_(actor, target, detail) {
  try {
    var log = sheet_(getMainSpreadsheet_(), 'ACTIVITY_LOG');
    appendObject_(log, { LogID: 'LOG-' + Date.now(), Timestamp: nowStr_(), UserRole: 'Admin', UserID: (actor && actor.StaffID) || '',
      UserName: (actor && actor.Name) || '', Action: 'classChange', Target: target, Detail: detail });
    if (typeof recCacheBust_ === 'function') recCacheBust_('ACTIVITY_LOG');
  } catch (e) {}
}
/** Apply one {staffId,before,after} move: STAFF Department + Classes in place; LINE-notify the teacher. */
function coApply_(changes) {
  var sh = sheet_(getHrSpreadsheet_(), 'STAFF');
  (changes || []).forEach(function (c) {
    var r = findObject_(sh, function (s) { return String(s.StaffID) === String(c.staffId); });
    if (!r) return;
    updateRow_(sh, r._row, { Department: c.after, Classes: c.after });
    try { if (r.LineUID) linePushText_(r.LineUID, '🔁 คุณถูกย้ายแผนก/ชั้นเรียน: ' + (c.before || '—') + ' → ' + (c.after || '—')); } catch (e) {}
  });
  if (typeof cacheDel_ === 'function') { cacheDel_('col:STAFF'); cacheDel_('rows:STAFF'); }
}

/** Leader/Admin submits a batch of teacher moves. payload: { staffId, changes:[{staffId,name,before,after}], note? } */
function handleSubmitClassChange(p) {
  p = p || {}; var ap = coStaffById_(p.staffId);
  var isAdmin = coIsAdmin_(ap);
  if (!isAdmin && ap.PositionLevel !== 'Leader') throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้าครูหรือแอดมิน');
  var changes = (p.changes || []).filter(function (c) { return c && c.staffId && c.after !== c.before; });
  if (!changes.length) throw apiError_('BAD_INPUT', 'ไม่มีการเปลี่ยนแปลง');
  var sh = coSheet_(); var id = coNextId_(sh); var today = dateStr_(new Date());
  appendObject_(sh, {
    ReqID: id, RequestBy: p.staffId, RequestByName: ap.Name || p.staffId, CreatedDate: today,
    Status: isAdmin ? 'APPROVED' : 'PENDING_ADMIN', Changes: changes, Note: p.note || '',
    Step2By: isAdmin ? (ap.Name || p.staffId) : '', DecidedDate: isAdmin ? today : ''
  });
  coBust_();
  if (isAdmin) { coApply_(changes); coLog_(ap, id, changes.map(function (c) { return c.name + ':' + c.before + '→' + c.after; }).join(', ')); }
  return { reqId: id, status: isAdmin ? 'APPROVED' : 'PENDING_ADMIN' };
}

/** Admin approves (applies + logs) or rejects a pending request. payload: { staffId, reqId, decision } */
function handleDecideClassChange(p) {
  p = p || {}; var ap = coStaffById_(p.staffId);
  if (!coIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = coSheet_(); var r = findObject_(sh, function (x) { return String(x.ReqID) === String(p.reqId); });
  if (!r) throw apiError_('NOT_FOUND', 'ไม่พบคำขอ');
  if (String(r.Status).toUpperCase() !== 'PENDING_ADMIN') throw apiError_('ALREADY_RESOLVED', 'คำขอนี้ดำเนินการแล้ว');
  var yes = p.decision === 'approve';
  var changes = r.Changes; if (typeof changes === 'string') { try { changes = JSON.parse(changes); } catch (e) { changes = []; } }
  if (yes) { coApply_(changes || []); coLog_(ap, r.ReqID, (changes || []).map(function (c) { return c.name + ':' + c.before + '→' + c.after; }).join(', ')); }
  updateRow_(sh, r._row, { Status: yes ? 'APPROVED' : 'REJECTED', Step2By: ap.Name || p.staffId, DecidedDate: dateStr_(new Date()) });
  coBust_();
  return { reqId: r.ReqID, status: yes ? 'APPROVED' : 'REJECTED' };
}
