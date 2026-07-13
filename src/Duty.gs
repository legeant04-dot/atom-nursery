/**
 * Duty.gs — duty roster (กะเวร). In-place writes on DUTY_ROSTER; the engine handles the reads (dutyList).
 * An Admin's entries are APPROVED immediately (and the assigned staff is LINE-notified); a Leader's
 * entries are PENDING_ADMIN until an Admin approves (then the staff is notified). Admin can add/edit/
 * delete/approve; a Leader can add/edit/delete (their entries await admin approval).
 */
function dutyStaff_(id) {
  return findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(id); }) || {};
}
function dutySheet_() {
  var ss = getHrSpreadsheet_();
  var sh = ss.getSheetByName('DUTY_ROSTER');
  var cols = ['DutyID', 'Date', 'ClassName', 'StaffID', 'Shift', 'Status', 'Note', 'CreatedBy'];
  if (!sh) { sh = ss.insertSheet('DUTY_ROSTER'); sh.getRange(1, 1, 1, cols.length).setValues([cols]); return sh; }
  ensureColumns_(sh, cols);
  return sh;
}
function dutyBust_() { if (typeof cacheDel_ === 'function') { cacheDel_('col:DUTY_ROSTER'); cacheDel_('rows:DUTY_ROSTER'); } }
function dutyIsAdmin_(s) { return s.PositionLevel === 'Admin' || s.Role === 'Admin'; }
function dutyIsLeader_(s) { return dutyIsAdmin_(s) || s.PositionLevel === 'Leader'; }
function dutyNotify_(staffId, dateStr, className) {
  var s = dutyStaff_(staffId);
  if (s && s.LineUID) linePushText_(s.LineUID, '🧑‍🏫 คุณได้รับมอบหมายเวร ' + (className ? '(' + className + ') ' : '') + 'วันที่ ' + dateStr);
}

/** payload: { staffId, date, forStaffId, className?, shift?, note? } */
function handleAddDuty(p) {
  p = p || {}; var ap = dutyStaff_(p.staffId);
  if (!dutyIsLeader_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้าครูหรือแอดมิน');
  var target = p.forStaffId || p.staffId2;
  if (!p.date || !target) throw apiError_('BAD_INPUT', 'ระบุวันและครู');
  var admin = dutyIsAdmin_(ap);
  var sh = dutySheet_();
  var id = 'DT-' + nextIdNum_(sh);
  appendObject_(sh, {
    DutyID: id, Date: p.date, ClassName: p.className || '', StaffID: target, Shift: p.shift || '',
    Status: admin ? 'APPROVED' : 'PENDING_ADMIN', Note: p.note || '', CreatedBy: p.staffId
  });
  dutyBust_();
  if (admin) dutyNotify_(target, p.date, p.className);   // approved duty → notify the assigned staff now
  return { dutyId: id, status: admin ? 'APPROVED' : 'PENDING_ADMIN' };
}

/** payload: { staffId, dutyId, date?, forStaffId?, className?, shift?, note? } */
function handleEditDuty(p) {
  p = p || {}; var ap = dutyStaff_(p.staffId);
  if (!dutyIsLeader_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้าครูหรือแอดมิน');
  var sh = dutySheet_(); var d = findObject_(sh, function (r) { return String(r.DutyID) === String(p.dutyId); });
  if (!d) throw apiError_('NOT_FOUND', 'ไม่พบกะเวร');
  var patch = {};
  if (p.date) patch.Date = p.date;
  if (p.className != null) patch.ClassName = p.className;
  if (p.forStaffId || p.staffId2) patch.StaffID = p.forStaffId || p.staffId2;
  if (p.shift != null) patch.Shift = p.shift;
  if (p.note != null) patch.Note = p.note;
  updateRow_(sh, d._row, patch); dutyBust_();
  return { ok: true, dutyId: d.DutyID };
}

/** payload: { staffId, dutyId } */
function handleDeleteDuty(p) {
  p = p || {}; var ap = dutyStaff_(p.staffId);
  if (!dutyIsLeader_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้าครูหรือแอดมิน');
  var sh = dutySheet_(); var d = findObject_(sh, function (r) { return String(r.DutyID) === String(p.dutyId); });
  if (!d) throw apiError_('NOT_FOUND', 'ไม่พบกะเวร');
  sh.deleteRow(d._row); dutyBust_();
  return { ok: true };
}

/** Admin approves/rejects a Leader-created duty. payload: { staffId, dutyId, decision } */
function handleApproveDuty(p) {
  p = p || {}; var ap = dutyStaff_(p.staffId);
  if (!dutyIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = dutySheet_(); var d = findObject_(sh, function (r) { return String(r.DutyID) === String(p.dutyId); });
  if (!d) throw apiError_('NOT_FOUND', 'ไม่พบกะเวร');
  var st = p.decision === 'approve' ? 'APPROVED' : 'REJECTED';
  updateRow_(sh, d._row, { Status: st }); dutyBust_();
  if (st === 'APPROVED') dutyNotify_(d.StaffID, dateStr_(new Date(d.Date)), d.ClassName);
  return { dutyId: d.DutyID, status: st };
}

/** DT-<n> sequential id from the existing rows. */
function nextIdNum_(sh) {
  var max = 0;
  readObjects_(sh).forEach(function (r) { var m = /DT-?(\d+)/.exec(String(r.DutyID || '')); if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; } });
  return String(max + 1);
}
