/**
 * Parent.gs — Day 4: Parent GPS Check-in/out + Student Absence
 * ------------------------------------------------------------------
 * Parents drop off / pick up children (GPS geofenced) and can report a
 * child's absence. Both notify the child's class teacher via LINE.
 * ------------------------------------------------------------------
 */

/** Resolve the acting parent from payload (parentId or lineUid). */
function resolveParent_(payload) {
  var parents = sheet_(getMainSpreadsheet_(), 'PARENTS');
  var rec = null;
  if (payload.parentId) rec = findObject_(parents, function (p) { return String(p.ParentID) === String(payload.parentId); });
  else if (payload.lineUid) rec = findObject_(parents, function (p) { return String(p.LineUID) === String(payload.lineUid); });
  if (!rec) throw apiError_('PARENT_NOT_FOUND', 'ไม่พบข้อมูลผู้ปกครอง');
  return rec;
}

/** payload: { parentId|lineUid, studentId, type:'IN'|'OUT', lat, lng } */
function handleParentCheckin(payload) {
  payload = payload || {};
  var parent = resolveParent_(payload);
  if (!payload.studentId) throw apiError_('BAD_INPUT', 'ต้องระบุ studentId');
  var type = String(payload.type || 'IN').toUpperCase();
  if (type !== 'IN' && type !== 'OUT') throw apiError_('BAD_TYPE', 'type ต้องเป็น IN หรือ OUT');
  // Parent CHECK-IN is allowed from anywhere (no geofence); CHECK-OUT still must be within the school radius.
  var dist = (type === 'OUT') ? assertWithinGeofence_(payload.lat, payload.lng) : geoDistanceSafe_(payload.lat, payload.lng);

  var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (s) { return String(s.StudentID) === String(payload.studentId); });
  if (!student) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');

  var now = new Date();
  var ciSheet = sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT');
  // De-dup a rapid double check-in (double-tap / slow network): if the SAME student+type was recorded
  // within CheckinDedupMinutes today, keep only the LATEST time (update the row, don't add a new one,
  // and don't re-notify). Default window 10 minutes.
  var win = parseInt(getConfig_('CheckinDedupMinutes', '10'), 10) || 10;
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var recent = findObject_(ciSheet, function (r) {
    if (String(r.StudentID) !== String(student.StudentID) || String(r.Type).toUpperCase() !== type) return false;
    if (dateStr_(new Date(r.Date)) !== dateStr_(now)) return false;
    var m = hhmmToMin_(toHHmm_(r.Time)); return m != null && Math.abs(nowMin - m) <= win;
  });
  if (recent) {
    updateRow_(ciSheet, recent._row, { Time: timeStr_(now), GPS_Lat: payload.lat, GPS_Lng: payload.lng });
    try { CacheService.getScriptCache().removeAll(['col:CHECKIN_STUDENT', 'rows:CHECKIN_STUDENT']); } catch (e) {}
    logAudit(parent.ParentID, 'STUDENT_CHECK' + type + '_DUP', 'CHECKIN_STUDENT', student.StudentID);
    return { studentId: student.StudentID, type: type, time: timeStr_(now), distance: dist, duplicate: true };
  }
  appendObject_(ciSheet, {
    Date: dateStr_(now), Time: timeStr_(now), StudentID: student.StudentID, ParentID: parent.ParentID,
    Type: type, GPS_Lat: payload.lat, GPS_Lng: payload.lng, Status: 'OK'
  });
  logAudit(parent.ParentID, 'STUDENT_CHECK' + type, 'CHECKIN_STUDENT', student.StudentID);

  var verb = (type === 'IN') ? 'มาถึงโรงเรียนแล้ว' : 'ผู้ปกครองรับกลับแล้ว';
  // routine check-in/out: notify covering teachers only — do NOT fall back to the Admin inbox (avoids flooding it)
  notifyStudentTeacher_(student, '👶 ' + student.Name + ' ' + verb + ' (' + timeStr_(now) + ')', { adminFallback: false });

  // late pickup → create/refresh the OT charge (it then rolls into this month's bill)
  var ot = null;
  if (type === 'OUT') {
    ot = otUpsertForPickup_(student, timeStr_(now), dateStr_(now));
    if (ot && parent.LineUID) {
      try {
        linePushText_(parent.LineUID, '⏰ รับช้า ' + ot.lateMinutes + ' นาที (เลิกเรียน ' + ot.planEnd + ')\n' +
          'ค่าล่วงเวลา ' + ot.hours + ' ชม. × ' + ot.rate + ' = ' + ot.amount + ' บาท\nยอดนี้จะรวมในบิลรายเดือน');
      } catch (e) {}
    }
  }
  return { studentId: student.StudentID, type: type, time: timeStr_(now), distance: dist, ot: ot };
}

/** payload: { parentId|lineUid, studentId, date, reason } */
function handleStudentAbsence(payload) {
  payload = payload || {};
  var parent = resolveParent_(payload);
  if (!payload.studentId || !payload.date) throw apiError_('BAD_INPUT', 'ต้องระบุ studentId และ date');
  var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (s) { return String(s.StudentID) === String(payload.studentId); });
  if (!student) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');

  var sheet = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  ensureColumns_(sheet, ['Type', 'FiledBy']);
  // Idempotent: a double-submit (slow network) for the SAME student+date must not create a duplicate
  // leave — return the existing one and don't re-notify.
  var dup = findObject_(sheet, function (r) { return String(r.StudentID) === String(student.StudentID) && otNormDate_(r.Date) === otNormDate_(payload.date); });
  if (dup) { logAudit(parent.ParentID, 'STUDENT_ABSENCE_DUP', 'LEAVE_REQUEST_STD', dup.LeaveID); return { leaveId: dup.LeaveID, studentId: student.StudentID, teacherNotified: false, duplicate: true }; }
  var leaveId = nextId_(sheet, 'LeaveID', 'LVS');
  var desc = (payload.type || '') + ((payload.type && payload.reason) ? ' — ' : '') + (payload.reason || '');
  var notified = notifyStudentTeacher_(student, '🏠 แจ้งลา: ' + student.Name + ' วันที่ ' + payload.date +
    '\n' + (desc || '-') + '\n(โดยผู้ปกครอง ' + parent.Name + ')');
  appendObject_(sheet, {
    LeaveID: leaveId, StudentID: student.StudentID, Date: payload.date, Type: payload.type || '',
    Reason: payload.reason || '', Status: 'Notified', TeacherNotified: notified ? 'YES' : 'NO'
  });
  logAudit(parent.ParentID, 'STUDENT_ABSENCE', 'LEAVE_REQUEST_STD', leaveId);
  return { leaveId: leaveId, studentId: student.StudentID, teacherNotified: notified };
}

/**
 * A teacher files a leave for a student and the LINKED PARENTS are notified. The leave then shows in
 * those parents' calendar only (studentLeaves). payload: { staffId, studentId, date, reason, type? }
 */
function handleTeacherStudentLeave(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  if (!payload.studentId || !payload.date) throw apiError_('BAD_INPUT', 'ต้องระบุนักเรียนและวันที่');
  var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (s) { return String(s.StudentID) === String(payload.studentId); });
  if (!student) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');
  var sheet = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  ensureColumns_(sheet, ['Type', 'FiledBy']);
  var dup = findObject_(sheet, function (r) { return String(r.StudentID) === String(student.StudentID) && otNormDate_(r.Date) === otNormDate_(payload.date); });
  if (dup) { logAudit(staff.StaffID, 'TEACHER_STUDENT_LEAVE_DUP', 'LEAVE_REQUEST_STD', dup.LeaveID); return { leaveId: dup.LeaveID, studentId: student.StudentID, parentNotified: false, duplicate: true }; }
  var leaveId = nextId_(sheet, 'LeaveID', 'LVS');
  appendObject_(sheet, {
    LeaveID: leaveId, StudentID: student.StudentID, Date: payload.date,
    Reason: payload.reason || '', Type: payload.type || '', Status: 'Notified',
    TeacherNotified: 'YES', FiledBy: staff.StaffID
  });
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  // notify every parent linked to this student
  var msg = '🏠 คุณครูแจ้งลาให้ ' + student.Name + ' วันที่ ' + payload.date + '\nเหตุผล: ' + (payload.reason || '-');
  var sent = notifyStudentParents_(student, msg);
  logAudit(staff.StaffID, 'TEACHER_STUDENT_LEAVE', 'LEAVE_REQUEST_STD', leaveId);
  return { leaveId: leaveId, studentId: student.StudentID, parentNotified: sent };
}

/** LINE-notify every parent linked to a student (USER_LINKS + PARENTS.LineUID). Returns count sent. */
function notifyStudentParents_(student, text) {
  var sent = 0, seen = {};
  var push = function (uid) { if (uid && !seen[uid]) { seen[uid] = 1; try { linePushText_(uid, text); sent++; } catch (e) {} } };
  readObjects_(sheet_(getMainSpreadsheet_(), 'PARENTS')).forEach(function (p) {
    if (String(p.StudentID) === String(student.StudentID) && p.LineUID) push(p.LineUID);
  });
  readObjects_(sheet_(getMainSpreadsheet_(), 'USER_LINKS')).forEach(function (l) {
    if (String(l.StudentID) === String(student.StudentID) && l.UserUID) push(l.UserUID);
  });
  return sent;
}

/** Admin: notify the parents of several students that this month's bill was issued (LINE + inbox fallback). */
function handleNotifyBills(p) {
  p = p || {};
  var ids = (p.studentIds || []).filter(function (x) { return !!x; });
  var month = p.month || dateStr_(new Date()).slice(0, 7);
  var stSheet = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var n = 0;
  ids.forEach(function (sid) {
    var st = findObject_(stSheet, function (s) { return String(s.StudentID) === String(sid); });
    if (!st) return;
    var msg = '🧾 ออกบิลค่าเทอมเดือน ' + month + ' ของ ' + (st.Nickname || st.Name) + ' แล้ว — เปิดแอปเพื่อดู/ชำระเงิน';
    try { if (notifyStudentParents_(st, msg) > 0) n++; } catch (e) {}
  });
  return { ok: true, notified: n, month: month };
}

/** True if a staff member covers a given class (Department/Classes = '*' | comma-list containing it). */
function staffCoversClass_(s, className) {
  var d = String((s && s.Department) || '') + ',' + String((s && s.Classes) || '');
  if (d.indexOf('*') >= 0) return true;
  return d.split(',').map(function (x) { return x.trim(); }).indexOf(String(className)) >= 0;
}
/**
 * Notify the teacher(s) who look after this student's class (+fallback Admins). Covers BOTH the CLASSES
 * homeroom teacher AND any staff whose Department/Classes includes the student's class (so e.g. ครูจอย
 * who looks after Nursery Baby is notified even without a CLASSES row). Dedupes by LineUID.
 */
function notifyStudentTeacher_(student, text, opts) {
  opts = opts || {};
  var seen = {}, sent = false;
  var push = function (uid) { if (uid && !seen[uid]) { seen[uid] = 1; if (linePushText_(uid, text)) sent = true; } };
  // 1) homeroom teacher from CLASSES
  var cls = findObject_(sheet_(getMainSpreadsheet_(), 'CLASSES'),
    function (c) { return String(c.ClassName) === String(student.Class) || String(c.ClassID) === String(student.Class); });
  if (cls && cls.TeacherID) {
    var t = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(cls.TeacherID); });
    if (t && t.LineUID) push(t.LineUID);
  }
  // 2) any active staff whose Department/Classes covers this class
  readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) {
    if (s.LineUID && String(s.Role) !== 'Admin' && String(s.Status || 'ACTIVE') === 'ACTIVE' && staffCoversClass_(s, student.Class)) push(s.LineUID);
  });
  // Fallback to the Admin in-app inbox only when asked. Routine check-in/out pass adminFallback:false so
  // they don't flood the inbox (every drop-off/pickup); leaves keep the fallback so they're never lost.
  if (!sent && opts.adminFallback !== false) notifyAdmins_(text, opts.category, opts.ref);
  return sent;
}

/** Admin edits a student leave in place. payload: { staffId, leaveId, date?, reason?, type? } */
function handleEditStudentLeave(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  var l = findObject_(sh, function (r) { return String(r.LeaveID) === String(p.leaveId); });
  if (!l) throw apiError_('NOT_FOUND', 'ไม่พบการลา');
  var patch = {};
  if (p.date != null) patch.Date = p.date;
  if (p.reason != null) patch.Reason = p.reason;
  if (p.type != null) patch.Type = p.type;
  updateRow_(sh, l._row, patch);
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  return { ok: true, leaveId: l.LeaveID };
}

/** Admin deletes a student leave. payload: { staffId, leaveId } */
function handleDeleteStudentLeave(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  var l = findObject_(sh, function (r) { return String(r.LeaveID) === String(p.leaveId); });
  if (!l) throw apiError_('NOT_FOUND', 'ไม่พบการลา');
  sh.deleteRow(l._row);
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  return { ok: true };
}

/** Admin batch-deletes student leaves. payload: { staffId, leaveIds:[...] } */
function handleDeleteStudentLeaves(p) {
  p = p || {};
  var ids = {}; (p.leaveIds || []).forEach(function (x) { ids[String(x)] = 1; });
  var sh = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  var rows = readObjects_(sh).filter(function (r) { return ids[String(r.LeaveID)]; }).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sh.deleteRow(r); });   // bottom-up so indices stay valid
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  return { ok: true, deleted: rows.length };
}
