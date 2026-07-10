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
  var dist = assertWithinGeofence_(payload.lat, payload.lng);

  var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (s) { return String(s.StudentID) === String(payload.studentId); });
  if (!student) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');

  var now = new Date();
  appendObject_(sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT'), {
    Date: dateStr_(now), Time: timeStr_(now), StudentID: student.StudentID, ParentID: parent.ParentID,
    Type: type, GPS_Lat: payload.lat, GPS_Lng: payload.lng, Status: 'OK'
  });
  logAudit(parent.ParentID, 'STUDENT_CHECK' + type, 'CHECKIN_STUDENT', student.StudentID);

  var verb = (type === 'IN') ? 'มาถึงโรงเรียนแล้ว' : 'ผู้ปกครองรับกลับแล้ว';
  notifyStudentTeacher_(student, '👶 ' + student.Name + ' ' + verb + ' (' + timeStr_(now) + ')');

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
  var leaveId = nextId_(sheet, 'LeaveID', 'LVS');
  var notified = notifyStudentTeacher_(student, '🏠 แจ้งลา: ' + student.Name + ' วันที่ ' + payload.date +
    '\nเหตุผล: ' + (payload.reason || '-') + '\n(โดยผู้ปกครอง ' + parent.Name + ')');
  appendObject_(sheet, {
    LeaveID: leaveId, StudentID: student.StudentID, Date: payload.date,
    Reason: payload.reason || '', Status: 'Notified', TeacherNotified: notified ? 'YES' : 'NO'
  });
  logAudit(parent.ParentID, 'STUDENT_ABSENCE', 'LEAVE_REQUEST_STD', leaveId);
  return { leaveId: leaveId, studentId: student.StudentID, teacherNotified: notified };
}

/** Notify the student's class teacher (+fallback Admins). Returns true if any sent. */
function notifyStudentTeacher_(student, text) {
  var sent = false;
  var cls = findObject_(sheet_(getMainSpreadsheet_(), 'CLASSES'),
    function (c) { return String(c.ClassName) === String(student.Class) || String(c.ClassID) === String(student.Class); });
  if (cls && cls.TeacherID) {
    var teacher = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'),
      function (s) { return String(s.StaffID) === String(cls.TeacherID); });
    if (teacher && teacher.LineUID) sent = linePushText_(teacher.LineUID, text) || sent;
  }
  if (!sent) notifyAdmins_(text); // fallback so the message is never lost
  return sent;
}
