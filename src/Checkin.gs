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
function hhmmToMin_(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function minOfDay_(d) { return d.getHours() * 60 + d.getMinutes(); }

/** Scheduled {checkIn, checkOut} HH:mm for a staff on a given day. */
function staffSchedule_(staffId, date) {
  var sched = sheet_(getHrSpreadsheet_(), 'WORK_SCHEDULE');
  var dow = dayOfWeek_(date);
  var row = findObject_(sched, function (r) {
    return String(r.StaffID) === String(staffId) && String(r.DayOfWeek) === dow;
  });
  return {
    checkIn:  (row && row.CheckInTime)  ? row.CheckInTime  : getConfig_('DefaultCheckInTime', '08:00'),
    checkOut: (row && row.CheckOutTime) ? row.CheckOutTime : getConfig_('DefaultCheckOutTime', '17:00')
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
    throw apiError_('ALREADY_CHECKED_IN', 'ลงเวลาเข้างานวันนี้ไปแล้ว (' + existing.CheckIn + ')');
  }

  var sched = staffSchedule_(staff.StaffID, now);
  var grace = parseInt(getConfig_('LateGraceMinutes', '0'), 10) || 0;
  var lateMin = Math.max(0, minOfDay_(now) - (hhmmToMin_(sched.checkIn) + grace));

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
  if (row.CheckOut) throw apiError_('ALREADY_CHECKED_OUT', 'ลงเวลาออกงานวันนี้ไปแล้ว (' + row.CheckOut + ')');

  var sched = staffSchedule_(staff.StaffID, now);
  var otMin = Math.max(0, minOfDay_(now) - hhmmToMin_(sched.checkOut));
  var otHours = Math.round((otMin / 60) * 100) / 100;

  updateRow_(sheet, row._row, { CheckOut: timeStr_(now), OTHours: otHours, Status: 'OUT' });

  if (otHours > 0) {
    var otSheet = sheet_(getHrSpreadsheet_(), 'OT_RECORDS');
    var rate = parseFloat(getConfig_('OTEveningRate', '0')) || 0;
    appendObject_(otSheet, {
      OTRecordID: nextId_(otSheet, 'OTRecordID', 'OT'), StaffID: staff.StaffID, Date: today,
      Hours: otHours, Rate: rate, Amount: Math.round(otHours * rate * 100) / 100, ApprovedBy: ''
    });
  }
  logAuditHr(staff.StaffID, 'STAFF_CHECKOUT', 'CHECKIN_STAFF', today);

  var msg = '🔴 ' + staff.Name + ' ออกงาน ' + timeStr_(now) +
            (otHours > 0 ? ' • OT ' + otHours + ' ชม.' : '');
  notifyAdmins_(msg);
  return { staffId: staff.StaffID, time: timeStr_(now), otHours: otHours };
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
