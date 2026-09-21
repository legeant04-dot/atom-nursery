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
  // no attendance on a day the school is shut to the CHILDREN — a Big Cleaning day is a working
  // Saturday for the staff, and no child comes in. A holiday is open to the children NAMED for it
  // (an OT วันหยุด day), and to nobody else — see holidayAttendIds_ in Checkin.gs.
  assertStudentDayOpen_(payload.studentId);
  // Parent CHECK-IN is allowed from anywhere (no geofence); CHECK-OUT still must be within the school
  // radius — a pickup is a safety record and it starts the late-pickup OT clock.
  // A REFUSED pickup is written to the audit log with the distance (metres only — never coordinates),
  // because "14% OUT_OF_RANGE" cannot be judged without knowing whether those parents were 40 m away
  // at the gate or 4 km away at home. One is a fence set too tight; the other is the rule working.
  //
  // ...unless this ONE CHILD has been named as an exception. A phone that reports its own accuracy
  // as ±2000 m cannot be fenced by anything, and no setting on it changes that; the school confirms
  // the family in person and the admin ticks the box (STUDENTS.GeoExempt). It is per-child and
  // recorded, so it is a decision somebody made about somebody, not a rule quietly turned down.
  var dist;
  if (type === 'OUT' && studentGeoExempt_(payload.studentId)) {
    dist = geoDistanceSafe_(payload.lat, payload.lng);
    // the distance is still MEASURED and logged — the exception is about refusing, not about knowing
    try {
      logAudit(parent.ParentID, 'STUDENT_CHECKOUT_GEO_EXEMPT', 'CHECKIN_STUDENT',
        String(payload.studentId) + ' · ' + (dist == null ? 'no fix' : dist + 'm') + ' acc=' + (Number(payload.acc) || 0) + 'm');
    } catch (logErr) {}
  } else if (type === 'OUT') {
    try {
      dist = assertWithinGeofence_(payload.lat, payload.lng, payload.acc);
    } catch (geoErr) {
      if (geoErr && geoErr.apiCode === 'OUT_OF_RANGE') {
        try {
          logAudit(parent.ParentID, 'STUDENT_CHECKOUT_OUT_OF_RANGE', 'CHECKIN_STUDENT',
            String(payload.studentId) + ' · ' + geoDistanceSafe_(payload.lat, payload.lng) + 'm acc=' + (Number(payload.acc) || 0) + 'm');
        } catch (logErr) {}
      }
      throw geoErr;
    }
  } else {
    dist = geoDistanceSafe_(payload.lat, payload.lng);
  }

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

/* ===== A LEAVE THAT LASTS MORE THAN ONE DAY ====================================================
 *
 * Asked 2026-09-21: "พานักเรียนไปต่างจังหวัด 3 วัน 21/09/26-23/09/26 จะมาโรงเรียนในวันที่ 24/09/26".
 * Filing the same form once per day was the only way, and the day somebody forgot was an
 * unexplained absence with a teacher ringing the family to ask where the child was.
 *
 * ONE ROW PER DAY, NOT A ROW WITH A RANGE ON IT. Every reader — the register, the calendar, the
 * absence follow-up, the monthly report, the class list — already answers "is this child on leave on
 * THIS date" by looking for that date's row. Expanding the range here means all of them keep working
 * untouched; storing a span would mean changing every one, and the one that got missed would go on
 * marking a child absent for days the school had been told about. The whole story is in
 * webapp/engine.js (leaveDaysIn_), which this mirrors.
 *
 * SHADOWS the engine handler of the same name: this is the live path on GAS, because it writes one
 * sheet in place and sends the LINE message.
 */
var MAX_LEAVE_SPAN_DAYS_ = 14;   // longer than this is ลาชั่วคราว, which the Admin sets — see below
/**
 * The dates a leave actually covers: every day from..to, minus the days the school is shut.
 * Decided 2026-09-21 — a child is not absent on a Sunday, and a leave row for one would inflate both
 * the absence count and the follow-up that chases it.
 */
function leaveDaysIn_(from, to) {
  var a = otNormDate_(from || ''), b = otNormDate_(to || '') || a;
  if (!a) throw apiError_('BAD_INPUT', 'ระบุวันที่เริ่มลา');
  if (b < a) throw apiError_('BAD_RANGE', 'วันสิ้นสุดการลาต้องไม่ก่อนวันเริ่มลา');
  var span = Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000) + 1;
  if (span > MAX_LEAVE_SPAN_DAYS_) throw apiError_('RANGE_TOO_LONG',
    'แจ้งลาต่อเนื่องได้ครั้งละไม่เกิน ' + MAX_LEAVE_SPAN_DAYS_ + ' วัน (เลือกไว้ ' + span + ' วัน) — ' +
    'หากต้องหยุดยาวกว่านี้ กรุณาติดต่อโรงเรียนเพื่อขอ "ลาชั่วคราว" ซึ่งจะไม่คิดค่าเทอมในช่วงนั้น');
  var out = [], cur = new Date(a + 'T00:00:00');
  for (var i = 0; i < span; i++) {
    if (!isSchoolClosed_(cur)) out.push(dateStr_(cur));
    cur.setDate(cur.getDate() + 1);
  }
  if (!out.length) throw apiError_('NO_OPEN_DAYS', 'ช่วงวันที่เลือกเป็นวันหยุดโรงเรียนทั้งหมด — ไม่ต้องแจ้งลา');
  return out;
}
/** Human span for a LINE message: one day prints as one date, not as "21 – 21". */
function leaveSpanLabel_(dates) {
  return dates.length > 1 ? (dates[0] + ' – ' + dates[dates.length - 1] + ' (' + dates.length + ' วัน)') : dates[0];
}
/**
 * Write one row per open day, skipping days this child is already on leave for, and return what was
 * actually created. ONE LINE MESSAGE FOR THE WHOLE RUN — a teacher told four times that one child is
 * away for four days learns nothing extra and stops reading the fourth one.
 */
function fileLeaveRun_(sheet, student, dates, fields) {
  var existing = {};
  readObjects_(sheet).forEach(function (r) {
    if (String(r.StudentID) === String(student.StudentID)) existing[otNormDate_(r.Date)] = r.LeaveID;
  });
  var to = dates[dates.length - 1], group = 'LVG-' + student.StudentID + '-' + dates[0];
  var made = [], skipped = [];
  dates.forEach(function (d) {
    if (existing[d]) { skipped.push(d); return; }
    var id = nextId_(sheet, 'LeaveID', 'LVS');
    var row = { LeaveID: id, StudentID: student.StudentID, Date: d, DateTo: to, GroupID: group };
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    appendObject_(sheet, row);
    existing[d] = id;                                   // so nextId_ and the dup check see it
    made.push({ date: d, leaveId: id });
  });
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  return { made: made, skipped: skipped, groupId: group, from: dates[0], to: to,
           leaveId: made.length ? made[0].leaveId : existing[skipped[0]] };
}

/** payload: { parentId|lineUid, studentId, date, dateTo?, reason, type? } */
function handleStudentAbsence(payload) {
  payload = payload || {};
  var parent = resolveParent_(payload);
  if (!payload.studentId || !payload.date) throw apiError_('BAD_INPUT', 'ต้องระบุ studentId และ date');
  var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (s) { return String(s.StudentID) === String(payload.studentId); });
  if (!student) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');

  var sheet = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  ensureColumns_(sheet, ['Type', 'FiledBy', 'DateTo', 'GroupID']);
  var dates = leaveDaysIn_(payload.date, payload.dateTo);
  /* Idempotent, and PER DAY rather than all-or-nothing. A double-submit on a slow network re-files
   * the same days and creates nothing; a family extending 21-22 to 21-24 files 21-24 and gets the
   * two new days rather than a refusal naming a day they already told us about. */
  var run = fileLeaveRun_(sheet, student, dates, {
    Type: payload.type || '', Reason: payload.reason || '', Status: 'Notified', TeacherNotified: 'YES'
  });
  if (!run.made.length) {
    logAudit(parent.ParentID, 'STUDENT_ABSENCE_DUP', 'LEAVE_REQUEST_STD', run.leaveId);
    return { leaveId: run.leaveId, studentId: student.StudentID, teacherNotified: false,
             duplicate: true, days: 0, skipped: run.skipped };
  }
  var desc = (payload.type || '') + ((payload.type && payload.reason) ? ' — ' : '') + (payload.reason || '');
  var notified = notifyStudentTeacher_(student, '🏠 แจ้งลา: ' + student.Name + ' วันที่ ' +
    leaveSpanLabel_(run.made.map(function (x) { return x.date; })) +
    '\n' + (desc || '-') + '\n(โดยผู้ปกครอง ' + parent.Name + ')');
  logAudit(parent.ParentID, 'STUDENT_ABSENCE', 'LEAVE_REQUEST_STD',
    run.leaveId + ' ' + run.from + (run.from === run.to ? '' : '–' + run.to));
  return { leaveId: run.leaveId, leaveIds: run.made.map(function (x) { return x.leaveId; }),
           studentId: student.StudentID, groupId: run.groupId, from: run.from, to: run.to,
           days: run.made.length, skipped: run.skipped, teacherNotified: notified };
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
  ensureColumns_(sheet, ['Type', 'FiledBy', 'DateTo', 'GroupID']);
  var dates = leaveDaysIn_(payload.date, payload.dateTo);
  var run = fileLeaveRun_(sheet, student, dates, {
    Reason: payload.reason || '', Type: payload.type || '', Status: 'Notified',
    TeacherNotified: 'YES', FiledBy: staff.StaffID
  });
  if (!run.made.length) {
    logAudit(staff.StaffID, 'TEACHER_STUDENT_LEAVE_DUP', 'LEAVE_REQUEST_STD', run.leaveId);
    return { leaveId: run.leaveId, studentId: student.StudentID, parentNotified: false,
             duplicate: true, days: 0, skipped: run.skipped };
  }
  // notify every parent linked to this student — once for the whole run, not once per day
  var msg = '🏠 คุณครูแจ้งลาให้ ' + student.Name + ' วันที่ ' +
    leaveSpanLabel_(run.made.map(function (x) { return x.date; })) + '\nเหตุผล: ' + (payload.reason || '-');
  var sent = notifyStudentParents_(student, msg);
  logAudit(staff.StaffID, 'TEACHER_STUDENT_LEAVE', 'LEAVE_REQUEST_STD',
    run.leaveId + ' ' + run.from + (run.from === run.to ? '' : '–' + run.to));
  return { leaveId: run.leaveId, leaveIds: run.made.map(function (x) { return x.leaveId; }),
           studentId: student.StudentID, groupId: run.groupId, from: run.from, to: run.to,
           days: run.made.length, skipped: run.skipped, parentNotified: sent };
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
/**
 * IS THIS PERSON ON DUTY TODAY? Asked before anyone is notified about anything.
 *
 * Reported 2026-09-01: an OBSERVER was receiving a LINE push for every leave, every comment and
 * every child arriving all morning. An Observer is a read-only auditor — the role exists to look at
 * the school without touching it — so there is no action for them to take about a child arriving at
 * 07:20, and being sent every one of them is neither useful to them nor affordable: the school's
 * free LINE quota is exhausted and the switch was believed to be off.
 *
 * The filter below excluded Role 'Admin' and nothing else. Observer is not Admin, so it fell
 * straight through. It also never looked at EndDate, so a teacher whose last day was the 31st was
 * still being notified on the 1st — reported in the same message.
 *
 * ENDED IS COMPARED HERE, not read from the engine: this is a .gs handler and the engine's
 * staffEnded_ is not in scope. Same rule, deliberately duplicated in the smallest possible form.
 */
function staffOnDuty_(s) {
  if (!s || !s.StaffID) return false;
  var role = String(s.Role || '');
  // Admin has the 🔔 inbox and the whole dashboard; Observer may not act on anything at all.
  if (role === 'Admin' || role === 'Observer') return false;
  if (String(s.Status || 'ACTIVE').toUpperCase() !== 'ACTIVE') return false;
  // EndDate is a LAST WORKING DAY, so it stops mattering only once it has PASSED
  var end = String(s.EndDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(end) && dateStr_(new Date()) > end) return false;
  /* ...nor anyone whose FIRST day has not come. Found by the test written for v386: a teacher hired
   * for Nursery 1 starting tomorrow was already being sent every arrival, comment and leave for the
   * class — an inbox full of a job she cannot do yet, about children she has not met. The same
   * reasoning as the EndDate line directly above, at the other end of the employment.
   * A blank StartDate is not a date and never refuses anybody. */
  var start = String(s.StartDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && dateStr_(new Date()) < start) return false;
  // ...nor anyone on temporary leave: they are not at the nursery, so there is nothing they can do
  // about a child arriving, and a notification they cannot act on is only a message they have to read
  var pf = String(s.PauseFrom || '').slice(0, 10), pt = String(s.PauseTo || '').slice(0, 10), td = dateStr_(new Date());
  if (/^\d{4}-\d{2}-\d{2}$/.test(pf) && td >= pf && !(/^\d{4}-\d{2}-\d{2}$/.test(pt) && td >= pt)) return false;
  return true;
}

function notifyStudentTeacher_(student, text, opts) {
  opts = opts || {};
  var seenStaff = {}, seenUid = {}, sent = false, inboxed = 0;
  // Every targeted teacher gets an IN-APP inbox row, and a LINE push only if they have a UID. This
  // used to be LINE-only, so with the school's free quota exhausted a parent's comment reached
  // nobody at all — the teacher's bell was simply empty.
  /* THE LINE HALF IS BEHIND THE SAME KIND OF SWITCH THE ADMIN PUSHES ARE. The school's free plan
   * caps messages at ~300/month and the quota is exhausted; notifyAdmins_ has been inbox-only since
   * that happened, but this path kept pushing LINE for every leave, comment and arrival, which is by
   * far the highest-volume traffic in the app. The school believed it was off (2026-09-01).
   *
   * The IN-APP INBOX IS ALWAYS WRITTEN either way — that is the teacher's 🔔 bell, it costs nothing,
   * and it is what makes turning LINE off safe. Emergencies do not come through here at all
   * (notifyAdminsUrgent_ pushes LINE regardless, by design). Default off, like the admin switch. */
  var lineOn = String(getConfig_('StaffLineNotify', 'false')) === 'true';
  var reach = function (staff) {
    if (!staff || !staff.StaffID || seenStaff[staff.StaffID]) return;
    if (!staffOnDuty_(staff)) return;              // observers, admins, and anyone who has left
    seenStaff[staff.StaffID] = 1;
    inboxAdd_(opts.category, text, opts.ref, staff.StaffID); inboxed++;
    var uid = staff.LineUID;
    if (lineOn && uid && !seenUid[uid]) { seenUid[uid] = 1; if (linePushText_(uid, text)) sent = true; }
  };
  var staffRows = readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF'));
  // 1) homeroom teacher from CLASSES
  var cls = findObject_(sheet_(getMainSpreadsheet_(), 'CLASSES'),
    function (c) { return String(c.ClassName) === String(student.Class) || String(c.ClassID) === String(student.Class); });
  if (cls && cls.TeacherID) {
    var t = null;
    staffRows.forEach(function (s) { if (String(s.StaffID) === String(cls.TeacherID)) t = s; });
    reach(t);
  }
  // 2) any staff ON DUTY whose Department/Classes covers this class. staffOnDuty_ (checked inside
  //    reach) is what decides; the role/status test that used to live here let an Observer through.
  staffRows.forEach(function (s) { if (staffCoversClass_(s, student.Class)) reach(s); });
  // Fallback to the Admin in-app inbox only when nobody at all was reached. Routine check-in/out pass
  // adminFallback:false so they don't flood the inbox; leaves keep it so they're never lost.
  if (!inboxed && !sent && opts.adminFallback !== false) notifyAdmins_(text, opts.category, opts.ref);
  return sent || inboxed > 0;
}

/**
 * A PARENT CORRECTS OR WITHDRAWS THEIR OWN NOTICE.
 *
 * Filing a leave was one-way: a family who wrote the wrong date, picked the wrong child, or whose
 * plans changed had to ring the school and ask somebody to go and edit a spreadsheet. Asked
 * 2026-08-29.
 *
 * THREE THINGS ARE CHECKED, in this order, and each refusal says which one it was — "แก้ไขไม่ได้"
 * on its own tells a family nothing about what to do next.
 *
 *   1. IT IS THEIR CHILD. applyIdentity_ already refuses a studentId a parent is not linked to, so
 *      this is the second lock rather than the first — but the leave is found by LeaveID, and an id
 *      is a guess anybody can make, so the row's own StudentID is compared as well.
 *
 *   2. TODAY OR LATER, NEVER THE PAST. A leave for a day that has already happened is not a plan
 *      any more, it is the ATTENDANCE RECORD of a day the school taught: the register, the absence
 *      count, and the teacher's own account of who was there. Editing it afterwards would let a
 *      family quietly rewrite history. The school can still do it (handleEditStudentLeave).
 *
 *   3. ONLY WHAT THE FAMILY THEMSELVES FILED. A leave a TEACHER entered (FiledBy) is the school
 *      saying a child was not here — the school's record to correct, not the family's.
 */
function parentOwnLeave_(p) {
  var sh = sheet_(getMainSpreadsheet_(), 'LEAVE_REQUEST_STD');
  var l = findObject_(sh, function (r) { return String(r.LeaveID) === String(p.leaveId); });
  if (!l) throw apiError_('NOT_FOUND', 'ไม่พบใบลานี้');
  if (String(l.StudentID) !== String(p.studentId)) throw apiError_('NO_ACCESS', 'ใบลานี้ไม่ใช่ของบุตรหลานท่าน');
  if (String(l.FiledBy || '').trim()) throw apiError_('FILED_BY_SCHOOL', 'ใบลานี้คุณครูเป็นผู้บันทึก — กรุณาติดต่อโรงเรียน');
  var d = otNormDate_(l.Date), today = dateStr_(new Date());
  if (d < today) throw apiError_('LEAVE_PAST',
    'ใบลาของวันที่ผ่านมาแล้วแก้ไขไม่ได้ — เป็นบันทึกการมาเรียนของวันนั้น · กรุณาติดต่อโรงเรียน');
  return { sh: sh, row: l, today: today };
}
/** Parent edits their own future/today leave. payload: { studentId, leaveId, date?, reason?, type? } */
function handleParentEditLeave(p) {
  p = p || {};
  var parent = resolveParent_(p);
  var f = parentOwnLeave_(p);
  var patch = {};
  if (p.date != null) {
    var nd = otNormDate_(p.date);
    if (nd < f.today) throw apiError_('LEAVE_PAST', 'เลือกวันที่ย้อนหลังไม่ได้ — กรุณาเลือกวันนี้หรือวันถัดไป');
    // moving it onto a day this child already has a leave for would leave two rows for one day, and
    // the register would then disagree with itself about that morning
    if (nd !== otNormDate_(f.row.Date)) {
      var clash = findObject_(f.sh, function (r) {
        return String(r.StudentID) === String(p.studentId) && otNormDate_(r.Date) === nd &&
               String(r.LeaveID) !== String(p.leaveId); });
      if (clash) throw apiError_('DUPLICATE', 'วันที่นี้แจ้งลาไว้แล้ว');
    }
    patch.Date = nd;
  }
  if (p.reason != null) patch.Reason = p.reason;
  if (p.type != null) patch.Type = p.type;
  updateRow_(f.sh, f.row._row, patch);
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  // the teacher was told about the original; a change to it is news to exactly the same person
  try {
    var stu = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
      function (s) { return String(s.StudentID) === String(p.studentId); }) || {};
    notifyStudentTeacher_(stu, '✏️ แก้ไขใบลา: ' + (stu.Name || p.studentId) + ' → วันที่ ' + (patch.Date || otNormDate_(f.row.Date)) +
      '\n' + ((p.type || f.row.Type || '') + ((p.reason || f.row.Reason) ? ' — ' + (p.reason != null ? p.reason : f.row.Reason) : '') || '-') +
      '\n(โดยผู้ปกครอง ' + parent.Name + ')');
  } catch (e) {}
  logAudit(parent.ParentID, 'PARENT_LEAVE_EDIT', 'LEAVE_REQUEST_STD', String(p.leaveId));
  return { ok: true, leaveId: p.leaveId };
}
/** Parent cancels their own future/today leave. payload: { studentId, leaveId } */
function handleParentCancelLeave(p) {
  p = p || {};
  var parent = resolveParent_(p);
  var f = parentOwnLeave_(p);
  /* CANCELLING A RANGE CANCELS THE RANGE. A family who filed "away 21-24" and came back early means
   * all four days; cancelling one of the four would leave three rows behind with nothing on screen
   * saying they were still there.
   *
   * DAYS ALREADY PAST ARE LEFT ALONE, for the reason parentOwnLeave_ gives above: a day the school
   * has already taught is the register, not a plan. So cancelling 21-24 on the 23rd takes the 23rd
   * and 24th and leaves the 21st and 22nd standing as the record of two days the child was away. */
  var group = String(f.row.GroupID || '').trim();
  var rows = group
    ? readObjects_(f.sh).filter(function (r) { return String(r.GroupID || '').trim() === group; })
    : [f.row];
  rows = rows.filter(function (r) { return otNormDate_(r.Date) >= f.today; });
  if (!rows.length) throw apiError_('LEAVE_PAST',
    'ใบลาของวันที่ผ่านมาแล้วยกเลิกไม่ได้ — เป็นบันทึกการมาเรียนของวันนั้น · กรุณาติดต่อโรงเรียน');
  var dates = rows.map(function (r) { return otNormDate_(r.Date); }).sort();
  var when = leaveSpanLabel_(dates);
  rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
      .forEach(function (n) { f.sh.deleteRow(n); });    // bottom-up so row indices stay valid
  if (typeof cacheDel_ === 'function') { cacheDel_('col:LEAVE_REQUEST_STD'); cacheDel_('rows:LEAVE_REQUEST_STD'); }
  /* THE TEACHER HAS TO BE TOLD. They were told the child was away; if that is withdrawn and nobody
   * says so, the class list still shows a child who is now expected — and on the day itself that is
   * a child nobody is looking for. */
  try {
    var stu = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
      function (s) { return String(s.StudentID) === String(p.studentId); }) || {};
    notifyStudentTeacher_(stu, '↩️ ยกเลิกใบลา: ' + (stu.Name || p.studentId) + ' วันที่ ' + when +
      '\n(โดยผู้ปกครอง ' + parent.Name + ' — นักเรียนจะมาเรียนตามปกติ)');
  } catch (e) {}
  logAudit(parent.ParentID, 'PARENT_LEAVE_CANCEL', 'LEAVE_REQUEST_STD', String(p.leaveId) + ' ' + when);
  return { ok: true, cancelled: dates.length, dates: dates, from: dates[0], to: dates[dates.length - 1] };
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
