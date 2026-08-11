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

/**
 * How much slack the phone's own margin of error is allowed to buy, in metres.
 * A phone does not report a POINT, it reports a point AND how sure it is. With Radius=30 and a
 * typical ±30–60 m fix under a roof or beside a building, someone standing at the gate was being
 * told they were "outside the school" — 14% of parent check-outs in the 2026-08-11 report.
 * So the test is "could they be inside?", not "does the dot land inside?". Capped, so a useless
 * fix (±2 km) can never wave through someone who is genuinely at home. 0 restores the old rule.
 */
function gpsSlack_(accuracy) {
  var cap = parseFloat(getConfig_('GpsAccuracySlack', '50'));
  if (!isFinite(cap) || cap < 0) cap = 50;
  var a = Number(accuracy);
  if (!isFinite(a) || a <= 0) return 0;                  // no accuracy reported → old behaviour
  return Math.min(Math.round(a), cap);
}

/** Throw OUT_OF_RANGE unless (lat,lng) could be within the school geofence. */
function assertWithinGeofence_(lat, lng, accuracy) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    throw apiError_('BAD_GPS', 'ไม่พบพิกัด GPS ที่ถูกต้อง');
  }
  var sLat = parseFloat(getConfig_('GPS_Lat')), sLng = parseFloat(getConfig_('GPS_Lng'));
  var radius = parseFloat(getConfig_('Radius', '30'));
  var dist = haversineMeters_(sLat, sLng, lat, lng);
  var slack = gpsSlack_(accuracy);
  if (dist - slack > radius) {
    // the numbers are the message: "too far" alone tells nobody whether to walk 20 steps or
    // whether the fence is set wrong
    throw apiError_('OUT_OF_RANGE', 'อยู่นอกรัศมีโรงเรียน (' + dist + ' ม. เกินกำหนด ' + radius + ' ม.' +
      (slack ? ' · เผื่อความคลาดเคลื่อน GPS ' + slack + ' ม.' : '') + ')');
  }
  return dist;
}

// Distance to school WITHOUT enforcing the fence — for parent CHECK-IN (allowed anywhere). Returns
// the distance for the record, or null if the GPS is missing/invalid (still allowed).
function geoDistanceSafe_(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
  var sLat = parseFloat(getConfig_('GPS_Lat')), sLng = parseFloat(getConfig_('GPS_Lng'));
  return haversineMeters_(sLat, sLng, lat, lng);
}

// ---- Time helpers -------------------------------------------------
function tz_() { return getConfig_('Timezone', 'Asia/Bangkok'); }
function dateStr_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function timeStr_(d) { return Utilities.formatDate(d, tz_(), 'HH:mm'); }
function dayOfWeek_(d) { return Utilities.formatDate(d, tz_(), 'EEEE'); } // Monday, Tuesday, ...
// OT minutes → "X ชม. Y นาที" for the LINE message (drops a zero part)
function hmMinTH_(total) { total = Math.max(0, Math.round(Number(total) || 0)); var h = Math.floor(total / 60), m = total % 60;
  return (h && m) ? (h + ' ชม. ' + m + ' นาที') : (h ? (h + ' ชม.') : (m + ' นาที')); }
// The school pays a FLAT hourly rate for teacher OT — StaffOTHourlyRate (default 100), editable in
// Settings. This used to derive the rate from each salary via the Thai labour-law formula
// (1.5 × salary ÷ 30 ÷ 8), which is why the payroll screen printed "× 89.38" instead of "× 100".
// Setting the config to the word 'auto' restores that derivation for anyone who wants it.
function otRateForStaff_(staff) {
  var cfg = String(getConfig_('StaffOTHourlyRate', '100')).trim();
  if (cfg.toLowerCase() === 'auto') {
    var sal = Number((staff && staff.BaseSalary) || 0);
    if (sal > 0) return Math.round(sal / 30 / 8 * 1.5 * 100) / 100;
  }
  return parseFloat(cfg) || parseFloat(getConfig_('OTRatePerHour', '100')) || 100;
}
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

/**
 * Somebody who has not started yet cannot log time.
 *
 * A teacher due to begin on the 13th is entered in the system days beforehand; without this, the
 * days in between produce attendance rows and count as worked or missed. Before the start date they
 * are simply not part of attendance.
 */
function assertStaffStarted_(rec) {
  var start = String((rec && rec.StartDate) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return;             // no start date recorded → unchanged
  if (dateStr_(new Date()) >= start) return;
  throw apiError_('NOT_STARTED', 'วันแรกของการทำงานคือ ' + start + ' — ยังลงเวลาไม่ได้');
}

// ---- Check-in -----------------------------------------------------
/** payload: { staffId|lineUid, lat, lng } */
function handleStaffCheckin(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  assertStaffStarted_(staff);
  var dist = assertWithinGeofence_(payload.lat, payload.lng, payload.acc);
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
  // a Big Cleaning Day is a special workday with fixed hours 08:30–17:00 → late is measured vs 08:30
  var expectHHmm = isBigCleaningDay_(today) ? getConfig_('BigCleaningIn', '08:30') : sched.checkIn;
  var expectMin = hhmmToMin_(expectHHmm); if (expectMin == null) expectMin = hhmmToMin_('08:00');
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

  // routine staff check-in is NOT pushed to the Admin inbox (it's on the dashboard + the daily digest);
  // this keeps the inbox to things that need attention (approvals / emergencies / new registrations).
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

  // The parent already told us the child is away today. Recording an arrival would contradict the
  // leave and quietly make the attendance figures wrong, so refuse and say why.
  try {
    var lvSh = getMainSpreadsheet_().getSheetByName('LEAVE_REQUEST_STD');
    if (lvSh) {
      var d0 = dateStr_(new Date());
      var lv = findObject_(lvSh, function (l) {
        return String(l.StudentID) === String(p.studentId) && String(l.Date).slice(0, 10) === d0;
      });
      if (lv) throw apiError_('ON_LEAVE', 'นักเรียนแจ้งลาวันนี้แล้ว (' + (lv.Type || 'ลา') +
        (lv.Reason ? ' · ' + lv.Reason : '') + ') — หากมาจริงให้ยกเลิกใบลาก่อน');
    }
  } catch (e) { if (e && e.apiCode === 'ON_LEAVE') throw e; }

  var sh = sheet_(getMainSpreadsheet_(), 'CHECKIN_STUDENT');
  ensureColumns_(sh, ['Remark', 'ByStaffID']);
  var now = new Date(), today = dateStr_(now);
  // the teacher must record the ACTUAL drop-off / pick-up time — a child picked up at 12:57 must not
  // read the wall-clock 17:26 and wrongly trigger OT. Accept an HH:mm override; blank → now.
  var timeHM = /^\d{1,2}:\d{2}$/.test(String(p.time || '').trim()) ? String(p.time).trim() : timeStr_(now);
  // If a same-type record already exists today, UPDATE its time (correct it) rather than blocking —
  // so a teacher can fix a wrong pickup time (e.g. an accidental 07:50 → the real 16:50) and can always
  // check a present child OUT. One drop-off + one pick-up per day, but editable.
  var existing = findObject_(sh, function (r) {
    return String(r.StudentID) === String(student.StudentID) && dateStr_(new Date(r.Date)) === today &&
           String(r.Type).toUpperCase() === type;
  });
  if (existing) {
    updateRow_(sh, existing._row, { Time: timeHM, Remark: remark, ByStaffID: staff.StaffID });
  } else {
    appendObject_(sh, {
      Date: today, Time: timeHM, StudentID: student.StudentID,
      ParentID: student.ParentID || '', Type: type, GPS_Lat: '', GPS_Lng: '', Status: 'OK',
      Remark: remark, ByStaffID: staff.StaffID
    });
  }
  try { CacheService.getScriptCache().removeAll(['col:CHECKIN_STUDENT', 'rows:CHECKIN_STUDENT']); } catch (e) {}
  // audit trail Admin can review: staff, actual time entered, type, and the reason
  try { logAudit(staff.StaffID, 'STUDENT_CHECK' + type + '_BY_STAFF', 'CHECKIN_STUDENT', student.StudentID + ' @' + timeHM + ' — ' + remark); } catch (e) {}

  // late pickup → create/refresh the OT charge (rolls into this month's bill) — uses the ACTUAL time
  var ot = (type === 'OUT') ? otUpsertForPickup_(student, timeHM, today) : null;

  // the parent wasn't the one dropping off / picking up — tell them who was
  var verb = (type === 'IN') ? 'มาถึงโรงเรียนแล้ว' : 'ถูกรับกลับแล้ว';
  var msg = '👶 ' + student.Name + ' ' + verb + ' (' + timeHM + ')\nบันทึกโดยคุณครู ' +
            (staff.Name || staff.StaffID) + '\nหมายเหตุ: ' + remark;
  if (ot) msg += '\n⏰ รับช้า ' + ot.lateMinutes + ' นาที · ค่าล่วงเวลา ' + ot.amount + ' บาท (รวมในบิลรายเดือน)';
  try {
    var parent = student.ParentID ? findObject_(sheet_(getMainSpreadsheet_(), 'PARENTS'),
      function (pr) { return String(pr.ParentID) === String(student.ParentID); }) : null;
    if (parent && parent.LineUID) linePushText_(parent.LineUID, msg); // routine check-in: no Admin-inbox fallback (avoids flooding)
  } catch (e) {}
  return { studentId: student.StudentID, type: type, time: timeStr_(now), remark: remark, ot: ot };
}

// ---- Check-out ----------------------------------------------------
/** payload: { staffId|lineUid, lat, lng } */
function handleStaffCheckout(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  assertStaffStarted_(staff);
  var dist = assertWithinGeofence_(payload.lat, payload.lng, payload.acc);
  var now = new Date(), today = dateStr_(now);
  var sheet = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');

  var row = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && dateStr_(new Date(r.Date)) === today;
  });
  if (!row || !row.CheckIn) throw apiError_('NOT_CHECKED_IN', 'ยังไม่ได้ลงเวลาเข้างานวันนี้');
  if (row.CheckOut) throw apiError_('ALREADY_CHECKED_OUT', 'ลงเวลาออกงานวันนี้ไปแล้ว (' + toHHmm_(row.CheckOut) + ')');

  var sched = staffSchedule_(staff.StaffID, now);
  var outHHmm = isBigCleaningDay_(today) ? getConfig_('BigCleaningOut', '17:00') : sched.checkOut;
  var outMin = hhmmToMin_(outHHmm); if (outMin == null) outMin = hhmmToMin_('17:00');
  var otMin = Math.max(0, minOfDay_(now) - outMin);
  // FULL-hour OT: the last hour rounds up only when ≥ OTRoundUpMinutes (default 50), else it drops.
  // e.g. plan 18:00, out 18:53 → 53 min → 1 hr; out 18:45 → 45 min → 0 hr (not enough).
  var roundUp = parseInt(getConfig_('OTRoundUpMinutes', '50'), 10) || 50;
  var otHours = Math.floor(otMin / 60) + ((otMin % 60) >= roundUp ? 1 : 0);
  // Thai labour law: OT on a normal working day = 1.5 × hourly wage; monthly hourly = salary ÷ 30 ÷ 8.
  var rate = otRateForStaff_(staff);
  var otPay = Math.round(otHours * rate);

  updateRow_(sheet, row._row, { CheckOut: timeStr_(now), OTHours: otHours, Status: 'OUT' });

  if (otHours >= 1) {
    // OT enters the approval workflow. A Leader/Admin's own OT skips straight to Admin (like leave).
    var isLeaderSelf = (staff.PositionLevel === 'Leader' || staff.PositionLevel === 'Admin' || staff.Role === 'Admin');
    var otSheet = sheet_(getHrSpreadsheet_(), 'OT_RECORDS');
    ensureColumns_(otSheet, ['Status', 'Minutes', 'PlanOut', 'ActualOut', 'Month', 'Step1By', 'Step1Status', 'Step2By', 'Step2Status', 'Note']);
    appendObject_(otSheet, {
      OTRecordID: nextId_(otSheet, 'OTRecordID', 'OTR'), StaffID: staff.StaffID, Date: today,
      Hours: otHours, Rate: rate, Amount: otPay, ApprovedBy: '',
      Status: isLeaderSelf ? 'PENDING_ADMIN' : 'PENDING_LEADER', Minutes: otMin,
      PlanOut: sched.checkOut, ActualOut: timeStr_(now), Month: today.slice(0, 7),
      Step1By: '', Step1Status: isLeaderSelf ? 'Skipped' : 'Pending', Step2By: '', Step2Status: 'Pending', Note: ''
    });
    if (typeof cacheDel_ === 'function') { cacheDel_('col:OT_RECORDS'); cacheDel_('rows:OT_RECORDS'); }
  }
  logAuditHr(staff.StaffID, 'STAFF_CHECKOUT', 'CHECKIN_STAFF', today);

  // notify the Admin inbox ONLY when this check-out produced OT that needs approval; a routine check-out
  // is not pushed (keeps the inbox clean — attendance is on the dashboard + the daily digest).
  if (otHours >= 1) {
    notifyAdmins_('🔴 ' + staff.Name + ' ออกงาน ' + timeStr_(now) +
      ' • OT ' + otHours + ' ชม. (' + hmMinTH_(otMin) + ') ≈ ' + otPay + ' บาท · รออนุมัติ');
  }
  return { staffId: staff.StaffID, time: timeStr_(now), otHours: otHours, otMinutes: otMin, otPay: otPay };
}

// ---- Notification helpers ----------------------------------------
/** Push a message to every Admin's LINE (USERS role=Admin with LineUID). */
function notifyAdmins_(text, category, ref) {
  // Always land in the in-app Admin inbox (the 🔔 bell) — this is what the admin actually reads now.
  // category/ref (optional) let the bell deep-link straight to the item (e.g. a journal report).
  if (typeof inboxAdd_ === 'function') inboxAdd_((category && typeof category === 'string') ? category : 'approval', text, ref);
  // LINE push to admins is OFF by default to protect the monthly push quota. Turn it on by setting
  // SCHOOL_CONFIG AdminLineNotify='true'. Emergencies use notifyAdminsUrgent_ and ignore this gate.
  if (String(getConfig_('AdminLineNotify', 'false')) !== 'true') return;
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

// ---- Big Cleaning Day (a monthly mandatory workday with no fixed hours) -----
/** Normalize a config date entry to yyyy-MM-dd (Sheets may have coerced a lone date cell to a Date). */
function otNormDate_(x) {
  x = String(x || '').trim(); if (!x) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  var d = new Date(x); return isNaN(d) ? x : Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}
/** Read the configured Big Cleaning dates (SCHOOL_CONFIG BigCleaningDays, comma-joined). */
function bigCleaningDays_() {
  var v = getConfig_('BigCleaningDays', '');
  return String(v || '').split(',').map(otNormDate_).filter(Boolean);
}
function isBigCleaningDay_(ds) { return bigCleaningDays_().indexOf(String(ds)) >= 0; }
/** Write the list as TEXT so a lone yyyy-MM-dd is not date-coerced by Sheets; busts the config cache. */
function writeBigCleaning_(list) {
  var cfg = sheet_(getMainSpreadsheet_(), 'SCHOOL_CONFIG');
  var valCol = headers_(cfg).indexOf('Value') + 1;
  var r = findObject_(cfg, function (x) { return String(x.Key) === 'BigCleaningDays'; });
  if (!r) { appendObject_(cfg, { Key: 'BigCleaningDays', Value: '' }); r = findObject_(cfg, function (x) { return String(x.Key) === 'BigCleaningDays'; }); }
  var cell = cfg.getRange(r._row, valCol);
  cell.setNumberFormat('@'); cell.setValue(list.join(','));   // '@' = plain text → no date coercion
  try { _configCache = null; } catch (e) {}
  try { CacheService.getScriptCache().remove('cfg'); } catch (e) {}
  return list;
}
/** Admin routes: manage the Big Cleaning date list in SCHOOL_CONFIG (admin-only via ADMIN_ONLY). */
function handleAddBigCleaning(p) {
  p = p || {}; var l = bigCleaningDays_(); var d = otNormDate_(p.date);
  if (d && l.indexOf(d) < 0) l.push(d); l.sort();
  return { ok: true, days: writeBigCleaning_(l) };
}
function handleRemoveBigCleaning(p) {
  p = p || {}; var d = otNormDate_(p.date); var l = bigCleaningDays_().filter(function (x) { return x !== d; });
  return { ok: true, days: writeBigCleaning_(l) };
}
function handleBigCleaningDays() { return { days: bigCleaningDays_(), amount: Number(getConfig_('BigCleaningAmount', '0')) || 0 }; }

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
