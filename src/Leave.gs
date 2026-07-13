/**
 * Leave.gs — Day 4: Staff Leave workflow (chat spec, 2-step + cross-dept)
 * ------------------------------------------------------------------
 * Flow:
 *   Staff submits -> notify ALL Leaders (they can see lower-level reqs)
 *   A Leader approves/rejects (step 1)
 *     - cross-dept approval -> also notify that dept's Leader + Admins,
 *       tagged "อนุมัติโดย Leader X"
 *   If approved -> notify Admins -> Admin approves/rejects (step 2, final)
 *   If the requester IS a Leader/Admin -> skip step 1, go to Admin.
 *   Result is saved; staff sees Status + each step's approver name.
 *
 * Status: PENDING_LEADER -> PENDING_ADMIN -> APPROVED | REJECTED
 * ------------------------------------------------------------------
 */

var LEAVE_STATUS = {
  PENDING_LEADER: 'PENDING_LEADER',
  PENDING_ADMIN:  'PENDING_ADMIN',
  APPROVED:       'APPROVED',
  REJECTED:       'REJECTED'
};
var STEP = { APPROVED: 'Approved', REJECTED: 'Rejected', PENDING: 'Pending', SKIPPED: 'Skipped' };

// ---- Submit -------------------------------------------------------
/** payload: { staffId|lineUid, type, startDate, endDate, reason } */
function handleSubmitLeave(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  if (!payload.startDate || !payload.endDate) throw apiError_('BAD_INPUT', 'ต้องระบุวันเริ่มและวันสิ้นสุดการลา');
  var days = inclusiveDays_(payload.startDate, payload.endDate);
  if (days < 1) throw apiError_('BAD_DATES', 'ช่วงวันลาไม่ถูกต้อง');

  var sheet = sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST');
  ensureColumns_(sheet, ['Attachment']);
  var leaveId = genLeaveId_(sheet);
  var level = String(staff.PositionLevel || '');
  if (String(staff.Role || '') === 'Admin') level = 'Admin';
  var requesterIsApprover = (level === 'Leader' || level === 'Admin');

  var row = {
    LeaveID: leaveId, StaffID: staff.StaffID, Department: staff.Department || '',
    Type: payload.type || 'ลากิจ', StartDate: payload.startDate, EndDate: payload.endDate,
    Days: days, Reason: payload.reason || '',
    Status: requesterIsApprover ? LEAVE_STATUS.PENDING_ADMIN : LEAVE_STATUS.PENDING_LEADER,
    Step1ApproverID: '', Step1ApproverName: '',
    Step1Status: requesterIsApprover ? STEP.SKIPPED : STEP.PENDING, Step1Date: '', Step1CrossDept: '',
    Step2ApproverID: '', Step2ApproverName: '', Step2Status: STEP.PENDING, Step2Date: '',
    CreatedDate: new Date(), Attachment: payload.attachment || ''   // medical cert / doc → offloaded to Drive
  };
  appendObject_(sheet, row);
  logAuditHr(staff.StaffID, 'LEAVE_SUBMIT', 'LEAVE_REQUEST', leaveId);

  var head = '📩 คำขอลา ' + leaveId + ' • ' + staff.Name + ' (' + (staff.Department || '-') + ')\n' +
             row.Type + ' ' + payload.startDate + ' ถึง ' + payload.endDate + ' (' + days + ' วัน)\nเหตุผล: ' + row.Reason;
  if (requesterIsApprover) notifyAdmins_('[รออนุมัติขั้นสุดท้าย]\n' + head);
  else notifyLeaders_('[รออนุมัติโดยหัวหน้างาน]\n' + head);

  return { leaveId: leaveId, status: row.Status, days: days };
}

// ---- Approve / Reject --------------------------------------------
/** payload: { leaveId, staffId|lineUid (approver), decision: 'approve'|'reject', note? } */
function handleApproveLeave(payload) {
  payload = payload || {};
  var approver = resolveStaff_(payload);
  var level = String(approver.PositionLevel || '');
  if (String(approver.Role || '') === 'Admin') level = 'Admin';   // Admin role → full approval rights regardless of PositionLevel
  var sheet = sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST');
  var leave = findObject_(sheet, function (r) { return String(r.LeaveID) === String(payload.leaveId); });
  if (!leave) throw apiError_('NOT_FOUND', 'ไม่พบคำขอลา ' + payload.leaveId);
  var approve = String(payload.decision) === 'approve';
  var requester = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'),
    function (s) { return String(s.StaffID) === String(leave.StaffID); }) || { Name: leave.StaffID, LineUID: '' };

  // ----- Step 1: Leader -----
  if (String(leave.Status) === LEAVE_STATUS.PENDING_LEADER) {
    if (level !== 'Leader' && level !== 'Admin') throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้างาน (Leader) เท่านั้นที่อนุมัติขั้นแรกได้');
    var crossDept = String(approver.Department || '') !== String(leave.Department || '');
    updateRow_(sheet, leave._row, {
      Step1ApproverID: approver.StaffID, Step1ApproverName: approver.Name,
      Step1Status: approve ? STEP.APPROVED : STEP.REJECTED, Step1Date: new Date(),
      Step1CrossDept: crossDept ? 'YES' : 'NO',
      Status: approve ? LEAVE_STATUS.PENDING_ADMIN : LEAVE_STATUS.REJECTED
    });
    logAuditHr(approver.StaffID, approve ? 'LEAVE_L1_APPROVE' : 'LEAVE_L1_REJECT', 'LEAVE_REQUEST', leave.LeaveID);

    if (!approve) {
      if (requester.LineUID) linePushText_(requester.LineUID, '❌ คำขอลา ' + leave.LeaveID + ' ถูกปฏิเสธโดยหัวหน้างาน ' + approver.Name + (payload.note ? '\nเหตุผล: ' + payload.note : ''));
      return { leaveId: leave.LeaveID, status: LEAVE_STATUS.REJECTED };
    }
    if (crossDept) {
      var tag = '⚠️ อนุมัติข้ามแผนกโดย Leader ' + approver.Name + ' (คำขอ ' + leave.LeaveID + ' ของแผนก ' + leave.Department + ')';
      notifyLeaders_(tag, leave.Department); // notify the owning dept's Leader(s)
      notifyAdmins_(tag);
    }
    notifyAdmins_('[รออนุมัติขั้นสุดท้าย] คำขอลา ' + leave.LeaveID + ' • ' + requester.Name +
                  '\nผ่านหัวหน้างาน ' + approver.Name + (crossDept ? ' (ข้ามแผนก)' : '') + ' แล้ว');
    return { leaveId: leave.LeaveID, status: LEAVE_STATUS.PENDING_ADMIN, crossDept: crossDept };
  }

  // ----- Step 2: Admin -----
  if (String(leave.Status) === LEAVE_STATUS.PENDING_ADMIN) {
    if (level !== 'Admin') throw apiError_('NO_PERMISSION', 'เฉพาะผู้บังคับบัญชา (Admin) เท่านั้นที่อนุมัติขั้นสุดท้ายได้');
    updateRow_(sheet, leave._row, {
      Step2ApproverID: approver.StaffID, Step2ApproverName: approver.Name,
      Step2Status: approve ? STEP.APPROVED : STEP.REJECTED, Step2Date: new Date(),
      Status: approve ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED
    });
    logAuditHr(approver.StaffID, approve ? 'LEAVE_FINAL_APPROVE' : 'LEAVE_FINAL_REJECT', 'LEAVE_REQUEST', leave.LeaveID);
    if (requester.LineUID) {
      linePushText_(requester.LineUID, (approve ? '✅ คำขอลา ' + leave.LeaveID + ' ได้รับอนุมัติแล้ว' :
        '❌ คำขอลา ' + leave.LeaveID + ' ถูกปฏิเสธ') + ' โดยผู้บังคับบัญชา ' + approver.Name +
        (payload.note ? '\nหมายเหตุ: ' + payload.note : ''));
    }
    return { leaveId: leave.LeaveID, status: approve ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED };
  }

  throw apiError_('ALREADY_RESOLVED', 'คำขอลานี้ดำเนินการเสร็จแล้ว (สถานะ ' + leave.Status + ')');
}

// ---- Queries ------------------------------------------------------
/** Staff's own leave history with status + approver names. payload: { staffId|lineUid } */
function handleMyLeaves(payload) {
  var staff = resolveStaff_(payload);
  var rows = readObjects_(sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST'))
    .filter(function (r) { return String(r.StaffID) === String(staff.StaffID); });
  return { staffId: staff.StaffID, leaves: rows.map(leaveView_) };
}

/** Pending requests visible to an approver. payload: { staffId|lineUid } */
function handlePendingLeaves(payload) {
  var approver = resolveStaff_(payload);
  var level = String(approver.PositionLevel || '');
  if (String(approver.Role || '') === 'Admin') level = 'Admin';   // Admin role → full approval rights regardless of PositionLevel
  var rows = readObjects_(sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST'));
  var visible;
  if (level === 'Admin') visible = rows.filter(function (r) { return String(r.Status) === LEAVE_STATUS.PENDING_ADMIN; });
  else if (level === 'Leader') visible = rows.filter(function (r) { return String(r.Status) === LEAVE_STATUS.PENDING_LEADER; }); // all depts (default)
  else throw apiError_('NO_PERMISSION', 'ตำแหน่งนี้ไม่มีสิทธิ์ดูคำขอรออนุมัติ');
  // return a raw-row ARRAY (client + engine contract) with decoded cells — NOT {level,pending:[...]}
  return visible.map(leaveDecodeEnrich_);
}

// decode a raw LEAVE_REQUEST row + attach the requester's names (so lists show a nickname, not STF-xxx)
var _leaveStaffIdx = null;
function leaveStaffName_(id) {
  if (!_leaveStaffIdx) { _leaveStaffIdx = {};
    readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) { _leaveStaffIdx[String(s.StaffID)] = s; }); }
  return _leaveStaffIdx[String(id)] || {};
}
function leaveDecodeEnrich_(r) {
  var o = {}; for (var k in r) o[k] = (typeof decodeCell_ === 'function') ? decodeCell_(r[k]) : r[k];
  var s = leaveStaffName_(o.StaffID);
  o.name = s.Name; o.nameEN = s.NameEN; o.nick = s.Nickname; o.nickEN = s.NicknameEN;
  return o;
}

/** Admin: every leave request (enriched), newest first — for the list split into pending vs resolved. */
function handleAllLeaves(payload) {
  var rows = readObjects_(sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST'));
  return rows.map(leaveDecodeEnrich_).sort(function (a, b) {
    return String(b.CreatedDate || b.StartDate || '').localeCompare(String(a.CreatedDate || a.StartDate || ''));
  });
}

/** Admin edits a leave in place (type/dates/reason); recomputes Days. Admin-only (ADMIN_ONLY guard). */
function handleEditLeave(payload) {
  payload = payload || {};
  var sheet = sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST');
  var leave = findObject_(sheet, function (r) { return String(r.LeaveID) === String(payload.leaveId); });
  if (!leave) throw apiError_('NOT_FOUND', 'ไม่พบคำขอลา');
  var patch = {};
  if (payload.type != null) patch.Type = payload.type;
  if (payload.startDate) patch.StartDate = payload.startDate;
  if (payload.endDate) patch.EndDate = payload.endDate;
  if (payload.reason != null) patch.Reason = payload.reason;
  if (payload.startDate || payload.endDate) {
    var s = new Date(patch.StartDate || leave.StartDate), e = new Date(patch.EndDate || leave.EndDate);
    patch.Days = Math.floor((e - s) / 864e5) + 1;
  }
  updateRow_(sheet, leave._row, patch);
  try { CacheService.getScriptCache().removeAll(['rows:LEAVE_REQUEST', 'col:LEAVE_REQUEST']); } catch (e) {}
  logAuditHr(payload.staffId || 'ADMIN', 'LEAVE_EDIT', 'LEAVE_REQUEST', leave.LeaveID);
  return { ok: true, leaveId: leave.LeaveID };
}

/** Admin cancels/deletes a leave request in place. Admin-only (ADMIN_ONLY guard). */
function handleCancelLeave(payload) {
  payload = payload || {};
  var sheet = sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST');
  var leave = findObject_(sheet, function (r) { return String(r.LeaveID) === String(payload.leaveId); });
  if (!leave) throw apiError_('NOT_FOUND', 'ไม่พบคำขอลา');
  sheet.deleteRow(leave._row);
  try { CacheService.getScriptCache().removeAll(['rows:LEAVE_REQUEST', 'col:LEAVE_REQUEST']); } catch (e) {}
  logAuditHr(payload.staffId || 'ADMIN', 'LEAVE_CANCEL', 'LEAVE_REQUEST', leave.LeaveID);
  return { ok: true };
}

function leaveView_(r) {
  return {
    leaveId: r.LeaveID, staffId: r.StaffID, department: r.Department, type: r.Type,
    startDate: r.StartDate, endDate: r.EndDate, days: r.Days, reason: r.Reason, status: r.Status,
    step1: { by: r.Step1ApproverName, status: r.Step1Status, crossDept: r.Step1CrossDept, date: r.Step1Date },
    step2: { by: r.Step2ApproverName, status: r.Step2Status, date: r.Step2Date }
  };
}

// ---- Helpers ------------------------------------------------------
/** Notify every active Leader's LINE. If dept given, only that dept's Leaders. */
function notifyLeaders_(text, dept) {
  readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) {
    if (String(s.PositionLevel) === 'Leader' && String(s.Status) === 'ACTIVE' && s.LineUID &&
        (!dept || String(s.Department) === String(dept))) {
      linePushText_(s.LineUID, text);
    }
  });
}

function genLeaveId_(sheet) {
  var year = Utilities.formatDate(new Date(), tz_(), 'yyyy');
  var prefix = 'LV' + year + '-';
  var max = 0;
  readObjects_(sheet).forEach(function (r) {
    var m = new RegExp('^' + prefix + '(\\d+)$').exec(String(r.LeaveID || ''));
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  var num = String(max + 1); while (num.length < 3) num = '0' + num;
  return prefix + num;
}

function inclusiveDays_(start, end) {
  var s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.floor((e - s) / 86400000) + 1;
}
