/**
 * Checkin.gs — Day 3: GPS Staff Check-in/out + LINE Notification
 * ------------------------------------------------------------------
 * - Haversine distance vs SCHOOL_CONFIG GPS + Radius (geofence).
 * - Records CHECKIN_STAFF, computes late minutes (vs WORK_SCHEDULE or
 *   default) and evening OT hours (after scheduled checkout).
 * - Notifies Admin on check-in/out; reminder triggers for forgotten ones.
 * ------------------------------------------------------------------
 */

// ---- Geo ----------------------------------------------------------
/** Great-circle distance in METRES between two lat/lng points. */
function haversineMeters_(lat1, lng1, lat2, lng2) {
  var R = 6371000, toRad = function (d) { return d * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Throw OUT_OF_RANGE unless (lat,lng) is within the school geofence. */
function assertWithinGeofence_(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    throw apiError_('BAD_GPS', 'ไม่พบพิกัด GPS ที่ถูกต้อง');
  }
  var sLat = parseFloat(getConfig_('GPS_Lat')), sLng = parseFloat(getConfig_('GPS_Lng'));
  var radius = parseFloat(getConfig_('Radius', '30'));
  var dist = haversineMeters_(sLat, sLng, lat, lng);
  if (dist > radius) {
    throw apiError_('OUT_OF_RANGE', 'อยู่นอกรัศมีโรงเรียน (' + dist + ' ม. เกินกำหนด ' + radius + ' ม.)');
  }
  return dist;
}

// ---- Time helpers -------------------------------------------------
function tz_() { return getConfig_('Timezone', 'Asia/Bangkok'); }
function dateStr_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function timeStr_(d) { return Utilities.formatDate(d, tz_(), 'HH:mm'); }
function dayOfWeek_(d) { return Utilities.formatDate(d, tz_(), 'EEEE'); } // Monday, Tuesday, ...
// OT minutes → "X ชม. Y นาที" for the LINE message (drops a zero part)
function hmMinTH_(total) { total = Math.max(0, Math.round(Number(total) || 0)); var h = Math.floor(total / 60), m = total % 60;
  return (h && m) ? (h + ' ชม. ' + m + ' นาที') : (h ? (h + ' ชม.') : (m + ' นาที')); }
// Thai labour-law OT hourly rate on a normal working day = 1.5 × (monthly salary ÷ 30 ÷ 8);
// falls back to the flat StaffOTHourlyRate config when the staff has no BaseSalary on file.
function otRateForStaff_(staff) { var sal = Number((staff && staff.BaseSalary) || 0);
  if (sal > 0) return Math.round(sal / 30 / 8 * 1.5 * 100) / 100;
  return parseFloat(getConfig_('StaffOTHourlyRate', getConfig_('OTRatePerHour', '100'))) || 100; }
function hhmmToMin_(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function minOfDay_(d) { return d.getHours() * 60 + d.getMinutes(); }
// Sheets returns a time-only cell (e.g. '07:00') as a Date on the 1899-12-30 epoch — normalize
// ANY time value (Date or string) to 'HH:mm' before parsing/printing, or lateness + messages break.
function toHHmm_(v) {
  if (v == null || v === '') return '';
  // A time-only cell reads back as a 1899-12-30 Date — format it in the SPREADSHEET timezone (same as
  // the engine's decodeCell_, which the app already renders correctly as 'HH:mm'). getHours() is wrong here.
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var z = (typeof ssTz_ === 'function') ? ssTz_() : tz_();
    return Utilities.formatDate(v, z, 'HH:mm');
  }
  var m = /^(\d{1,2}):(\d{2})/.exec(String(v).trim());
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : String(v).trim();
}

/** The staff's group work hours (STAFF_GROUPS) — used when there's no per-day WORK_SCHEDULE row. */
function staffGroupTimes_(staffId) {
  var st = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(staffId); });
  if (!st || !st.StaffGroup) return null;
  var g = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF_GROUPS'), function (x) { return String(x.GroupName) === String(st.StaffGroup); });
  if (!g || (!g.CheckInTime && !g.CheckOutTime)) return null;
  return { checkIn: toHHmm_(g.CheckInTime), checkOut: toHHmm_(g.CheckOutTime) };
}

/** Scheduled {checkIn, checkOut} HH:mm for a staff on a given day: WORK_SCHEDULE → group hours → config default. */
function staffSchedule_(staffId, date) {
  var sched = sheet_(getHrSpreadsheet_(), 'WORK_SCHEDULE');
  var dow = dayOfWeek_(date);
  var row = findObject_(sched, function (r) {
    return String(r.StaffID) === String(staffId) && String(r.DayOfWeek) === dow;
  });
  if (row && row.CheckInTime) return { checkIn: toHHmm_(row.CheckInTime), checkOut: toHHmm_(row.CheckOutTime) };
  var grp = staffGroupTimes_(staffId);
  if (grp) return grp;
  return {
    checkIn:  toHHmm_(getConfig_('DefaultCheckInTime', '08:00')),
    checkOut: toHHmm_(getConfig_('DefaultCheckOutTime', '17:00'))
  };
}

/** Resolve the acting staff record from payload (staffId or lineUid). */
function resolveStaff_(payload) {
  var staff = sheet_(getHrSpreadsheet_(), 'STAFF');
  var rec = null;
  if (payload.staffId) {
    rec = findObject_(staff, function (s) { return String(s.StaffID) === String(payload.staffId); });
  } else if (payload.lineUid) {
    rec = findObject_(staff, function (s) { return String(s.LineUID) === String(payload.lineUid); });
  }
  if (!rec) throw apiError_('STAFF_NOT_FOUND', 'ไม่พบข้อมูลพนักงาน');
  return rec;
}

// ---- Check-in -----------------------------------------------------
/** payload: { staffId|lineUid, lat, lng } */
function handleStaffCheckin(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  var dist = assertWithinGeofence_(payload.lat, payload.lng);
  var now = new Date(), today = dateStr_(now);
  var sheet = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');

  var existing = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && dateStr_(new Date(r.Date)) === today;
  });
  if (existing && existing.CheckIn) {
    throw apiError_('ALREADY_CHECKED_IN', 'ลงเวลาเข้างานวันนี้ไปแล้ว (' + toHHmm_(existing.CheckIn) + ')');
  }

  var sched = staffSchedule_(staff.StaffID, now);
  var grace = parseInt(getConfig_('LateGraceMinutes', '0'), 10) || 0;
  var expectMin = hhmmToMin_(sched.checkIn); if (expectMin == null) expectMin = hhmmToMin_('08:00');
  var lateMin = Math.max(0, minOfDay_(now) - (expectMin + grace));

  if (existing) {
    updateRow_(sheet, existing._row, { CheckIn: timeStr_(now), LateMinutes: lateMin, Status: 'IN' });
  } else {
    appendObject_(sheet, {
      Date: today, StaffID: staff.StaffID, CheckIn: timeStr_(now),
      CheckOut: '', LateMinutes: lateMin, OTHours: '', Status: 'IN'
    });
  }
  logAuditHr(staff.StaffID, 'STAFF_CHECKIN', 'CHECKIN_STAFF', today);

  var msg = '🟢 ' + staff.Name + ' เข้างาน ' + timeStr_(now) +
            (lateMin > 0 ? ' (สาย ' + lateMin + ' นาที)' : ' (ตรงเวลา)') +
            ' • ระยะ ' + dist + ' ม.';
  notifyAdmins_(msg);
  return { staffId: staff.StaffID, time: timeStr_(now), lateMinutes: lateMin, distance: dist };
}

// Recompute LateMinutes for TODAY's staff check-ins from CheckIn time vs the group schedule.
// Fixes rows recorded before the schedule/timezone fix. Admin-only (applyIdentity_ guard).
function handleRecomputeAttendance(p) {
  var sheet = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');
  var today = dateStr_(new Date());
  var grace = parseInt(getConfig_('LateGraceMinutes', '0'), 10) || 0;
  var fixed = [];
  readObjects_(sheet).forEach(function (r) {
    if (dateStr_(new Date(r.Date)) !== today || !r.CheckIn) return;
    var ci = toHHmm_(r.CheckIn); var m = /^(\d\d):(\d\d)/.exec(ci); if (!m) return;
    var minOfCI = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    var sched = staffSchedule_(r.StaffID, new Date());
    var expect = hhmmToMin_(sched.checkIn); if (expect == null) expect = hhmmToMin_('08:00');
    var late = Math.max(0, minOfCI - (expect + grace));
    if (Number(r.LateMinutes) !== late) { updateRow_(sheet, r._row, { LateMinutes: late }); fixed.push({ staffId: r.StaffID, checkIn: ci, was: Number(r.LateMinutes) || 0, late: late }); }
  });
  try { CacheService.getScriptCache().removeAll(['rows:CHECKIN_STAFF', 'col:CHECKIN_STAFF']); } catch (e) {}
  return { ok: true, fixed: fixed };
}

/** Append any missing header columns at the END of a sheet (never reorders existing ones). */
function ensureColumns_(sh, cols) {
  var hdr = headers_(sh);
  var missing = cols.filter(function (c) { return hdr.indexOf(c) < 0; });
  if (missing.length) sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
}

/**
 * Teacher/Leader checks a STUDENT in/out on behalf of someone who isn't a registered parent
 * (e.g. a grandparent drops off). A Remark saying who it was is MANDATORY. No geofence — the
 * staff member is already at school. payload: { staffId, studentId, type:'IN'|'OUT', remark }
 */
function handleStaffStudentCheckin(p) {
  p = p || {};
  var remark = String(p.remark || '').trim();
  if (!remark) throw apiError_('REMARK_REQUIRED', 'ต้องระบุหมายเหตุ (ใครมารับ-ส่ง) ก่อนบันทึก');
  var staff = resolveStaff_(p);
  var type = String(p.type || '').toUpperCase();
  if (type !== 'IN' && type !== 'OUT') throw apiError_('BAD_TYPE', 'type ต้องเป็น IN หรือ OUT');
  var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
    function (s) { return String(s.StudentID) === String(p.studentId); });
  if (!student) throw apiError_('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');

  var sh = sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT');
  ensureColumns_(sh, ['Remark', 'ByStaffID']);
  var now = new Date();
  appendObject_(sh, {
    Date: dateStr_(now), Time: timeStr_(now), StudentID: student.StudentID,
    ParentID: student.ParentID || '', Type: type, GPS_Lat: '', GPS_Lng: '', Status: 'OK',
    Remark: remark, ByStaffID: staff.StaffID
  });
  try { CacheService.getScriptCache().removeAll(['col:CHECKIN_STUDENT', 'rows:CHECKIN_STUDENT']); } catch (e) {}
  try { logAudit(staff.StaffID, 'STUDENT_CHECK' + type + '_BY_STAFF', 'CHECKIN_STUDENT', student.StudentID); } catch (e) {}

  // late pickup → create/refresh the OT charge (rolls into this month's bill)
  var ot = (type === 'OUT') ? otUpsertForPickup_(student, timeStr_(now), dateStr_(now)) : null;

  // the parent wasn't the one dropping off / picking up — tell them who was
  var verb = (type === 'IN') ? 'มาถึงโรงเรียนแล้ว' : 'ถูกรับกลับแล้ว';
  var msg = '👶 ' + student.Name + ' ' + verb + ' (' + timeStr_(now) + ')\nบันทึกโดยคุณครู ' +
            (staff.Name || staff.StaffID) + '\nหมายเหตุ: ' + remark;
  if (ot) msg += '\n⏰ รับช้า ' + ot.lateMinutes + ' นาที · ค่าล่วงเวลา ' + ot.amount + ' บาท (รวมในบิลรายเดือน)';
  try {
    var parent = student.ParentID ? findObject_(sheet_(getMainSpreadsheet_(), 'PARENTS'),
      function (pr) { return String(pr.ParentID) === String(student.ParentID); }) : null;
    if (parent && parent.LineUID) linePushText_(parent.LineUID, msg); else notifyAdmins_(msg);
  } catch (e) {}
  return { studentId: student.StudentID, type: type, time: timeStr_(now), remark: remark, ot: ot };
}

// ---- Check-out ----------------------------------------------------
/** payload: { staffId|lineUid, lat, lng } */
function handleStaffCheckout(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  var dist = assertWithinGeofence_(payload.lat, payload.lng);
  var now = new Date(), today = dateStr_(now);
  var sheet = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');

  var row = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && dateStr_(new Date(r.Date)) === today;
  });
  if (!row || !row.CheckIn) throw apiError_('NOT_CHECKED_IN', 'ยังไม่ได้ลงเวลาเข้างานวันนี้');
  if (row.CheckOut) throw apiError_('ALREADY_CHECKED_OUT', 'ลงเวลาออกงานวันนี้ไปแล้ว (' + toHHmm_(row.CheckOut) + ')');

  var sched = staffSchedule_(staff.StaffID, now);
  var outMin = hhmmToMin_(sched.checkOut); if (outMin == null) outMin = hhmmToMin_('17:00');
  var otMin = Math.max(0, minOfDay_(now) - outMin);
  var otHours = Math.round((otMin / 60) * 100) / 100;
  // Thai labour law: OT on a normal working day = 1.5 × hourly wage; monthly hourly = salary ÷ 30 ÷ 8.
  var rate = otRateForStaff_(staff);
  var otPay = Math.round(otHours * rate);

  updateRow_(sheet, row._row, { CheckOut: timeStr_(now), OTHours: otHours, Status: 'OUT' });

  if (otHours > 0) {
    var otSheet = sheet_(getHrSpreadsheet_(), 'OT_RECORDS');
    appendObject_(otSheet, {
      OTRecordID: nextId_(otSheet, 'OTRecordID', 'OT'), StaffID: staff.StaffID, Date: today,
      Hours: otHours, Rate: rate, Amount: otPay, ApprovedBy: ''
    });
  }
  logAuditHr(staff.StaffID, 'STAFF_CHECKOUT', 'CHECKIN_STAFF', today);

  var msg = '🔴 ' + staff.Name + ' ออกงาน ' + timeStr_(now) +
            (otMin > 0 ? ' • OT ' + hmMinTH_(otMin) + (otPay > 0 ? ' ≈ ' + otPay + ' บาท' : '') : '');
  notifyAdmins_(msg);
  return { staffId: staff.StaffID, time: timeStr_(now), otHours: otHours, otMinutes: otMin, otPay: otPay };
}

// ---- Notification helpers ----------------------------------------
/** Push a message to every Admin's LINE (USERS role=Admin with LineUID). */
function notifyAdmins_(text) {
  var users = readObjects_(sheet_(getMainSpreadsheet_(), 'USERS'));
  var sent = 0;
  users.forEach(function (u) {
    if (String(u.Role) === ROLES.ADMIN && u.LineUID) { if (linePushText_(u.LineUID, text)) sent++; }
  });
  // Fallback to the single AdminLineUID config if no Admin users have UIDs yet.
  if (sent === 0) {
    var fallback = getConfig_('AdminLineUID', '');
    if (fallback && String(fallback).indexOf('<FILL') !== 0) linePushText_(fallback, text);
  }
}

// ---- School-closed detection (weekends + configured holidays) ------
/** true on Sat/Sun or a date listed in SCHOOL_CONFIG HolidayList or the HOLIDAYS sheet. */
function isSchoolClosed_(d) {
  var day = d.getDay();
  if (day === 0 || day === 6) return true;                                 // Sunday / Saturday
  var ds = dateStr_(d);
  try {
    var hl = getConfig_('HolidayList', '');
    if (hl) {
      var arr; try { arr = JSON.parse(hl); } catch (e) { arr = String(hl).split(','); }
      if (arr.some(function (x) { return String(x).trim().slice(0, 10) === ds; })) return true;
    }
  } catch (e) {}
  try {
    var hs = readObjects_(sheet_(getMainSpreadsheet_(), 'HOLIDAYS'));
    if (hs.some(function (h) { return dateStr_(new Date(h.Date)) === ds; })) return true;
  } catch (e) {}
  return false;
}

// ---- Attendance reminder triggers (skip weekends + holidays) -------
/** Run ~06:50: morning reminder for active staff to clock in at 07:00 (skip on closed days). */
function forgotCheckinReminder() {
  if (isSchoolClosed_(new Date())) return;                                 // no work on weekends/holidays
  var today = dateStr_(new Date());
  var checkins = readObjects_(sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF'));
  var checkedIn = {};
  checkins.forEach(function (r) {
    if (dateStr_(new Date(r.Date)) === today && r.CheckIn) checkedIn[String(r.StaffID)] = true;
  });
  readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) {
    if (String(s.Status) !== 'ACTIVE' || !s.LineUID || checkedIn[String(s.StaffID)]) return;
    if (String(s.Role) === 'Admin') return;                                          // admins don't clock in → no reminder
    if (String(s.RequireCheckin).toLowerCase() === 'false') return;                  // respect the "not required" toggle
    linePushText_(s.LineUID, '🌅 อรุณสวัสดิ์ค่ะ อย่าลืมลงเวลาเข้างานเวลา 07:00 นะคะ (' + s.Name + ')');
  });
}

/** Run ~18:30: remind staff who checked in but not out (skip on closed days). */
function forgotCheckoutReminder() {
  if (isSchoolClosed_(new Date())) return;
  var today = dateStr_(new Date());
  readObjects_(sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF')).forEach(function (r) {
    if (dateStr_(new Date(r.Date)) === today && r.CheckIn && !r.CheckOut) {
      var staff = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'),
        function (s) { return String(s.StaffID) === String(r.StaffID); });
      if (staff && staff.LineUID) linePushText_(staff.LineUID, '⏰ อย่าลืมลงเวลาออกงานวันนี้นะคะ (' + staff.Name + ')');
    }
  });
}
