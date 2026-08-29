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
    /* The numbers are the message: "too far" alone tells nobody whether to walk 20 steps or whether
     * the fence is set wrong.
     *
     * And the PHONE'S OWN accuracy has to be one of them. The message showed `slack`, which is that
     * figure already capped at 50 m — so a phone that was guessing to the nearest 2 km and a phone
     * with a perfect fix printed the same "· เผื่อความคลาดเคลื่อน GPS 50 ม.", and there was no way
     * to tell "you really are 620 m away" from "your phone does not know where it is". A teacher
     * standing inside the school on 2026-08-24 got 620 m; that number IS the diagnosis, once you can
     * see how sure the phone was when it said it.
     */
    var acc = Number(accuracy);
    var accTxt = (isFinite(acc) && acc > 0) ? (' · ความแม่นยำที่เครื่องแจ้ง ±' + Math.round(acc) + ' ม.' +
      (acc > radius * 3 ? ' (ต่ำมาก — โทรศัพท์อาจส่งตำแหน่งแบบคร่าวๆ)' : '')) : ' · เครื่องไม่แจ้งความแม่นยำ';
    throw apiError_('OUT_OF_RANGE', 'อยู่นอกรัศมีโรงเรียน (' + dist + ' ม. เกินกำหนด ' + radius + ' ม.' +
      (slack ? ' · เผื่อความคลาดเคลื่อน GPS ' + slack + ' ม.' : '') + accTxt + ')');
  }
  return dist;
}

/**
 * Is this child's pick-up exempt from the fence?
 *
 * Granted per child by an admin (STUDENTS.GeoExempt = 'YES') for the case no setting can fix: a
 * handset that reports its own margin of error as kilometres. One phone, on 2026-08-29, put a parent
 * standing at the gate 620 m away. Everyone else stays fenced.
 *
 * Read defensively: the column is appended by ensureColumns_ on the first save, so on a sheet that
 * has not been written since this shipped it is simply absent — which must mean "no", not an error.
 */
function studentGeoExempt_(studentId) {
  try {
    var s = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
      function (x) { return String(x.StudentID) === String(studentId); });
    return !!s && /^(yes|true|1|y)$/i.test(String(s.GeoExempt || '').trim());
  } catch (e) { return false; }
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
/**
 * A SCHOOL_CONFIG value that is a TIME. Always read one through here.
 *
 * Writing '09:15' into a cell makes Sheets store a TIME, which reads back as a Date on the
 * 1899-12-30 epoch. Anything that treats it as a string then gets 'Sat Dec 30 1899…' — the admin
 * screen showed an empty box (an <input type="time"> silently rejects a value it cannot parse, so
 * the setting looked like it had never saved) and hhmmToMin_ returned null, so lateness and OT on a
 * Big Cleaning day were quietly measured against the fallback instead of the time that was set.
 * Nothing that isn't a real HH:mm is returned: a damaged cell falls back to the default rather than
 * silently becoming midnight.
 */
function getConfigTime_(key, dflt) {
  var s = toHHmm_(getConfig_(key, ''));
  return /^\d{2}:\d{2}$/.test(s) ? s : dflt;
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

/**
 * The holiday row for a date, or null — with its times decoded THE SAME WAY THE ENGINE DECODES THEM.
 *
 * This is the whole of the 2026-08-19 incident. A time cell comes back from Sheets as a Date on the
 * 1899 epoch and has to be formatted to 'HH:mm' by somebody. The engine does it in decodeCell_, in
 * the SPREADSHEET's timezone (ssTz_). holTime_ did it in the timezone from SCHOOL_CONFIG (tz_).
 * While those two settings agree, so do the answers; the moment they do not, the same cell is two
 * different times — and the two halves of the app quietly went different ways:
 *
 *   the app said   "เริ่มงาน 12:00 · ลงเวลาได้ตั้งแต่ 11:45"   (engine: window 07:00–12:00)
 *   the server did  late = 12:08 − 07:00 = 308 minutes         (route: no window at all)
 *
 * Four teachers were recorded 250–311 minutes late for arriving as the school reopened, and clocking
 * in at 11:45 was refused by a server that did not know there was anything to reopen.
 *
 * So it is decoded ONCE, by the engine's own decoder. Nothing here formats a date.
 */
function holidayOn_(ds) {
  try {
    var hs = readObjects_(sheet_(getMainSpreadsheet_(), 'HOLIDAYS'));
    var row = hs.filter(function (x) { return dateStr_(new Date(x.Date)) === ds; })[0] || null;
    if (!row) return null;
    if (typeof decodeCell_ === 'function') {
      var o = {}; for (var k in row) o[k] = decodeCell_(row[k]);
      return o;
    }
    return row;
  } catch (e) { return null; }
}

/**
 * THE hours this person works on this day — shift, Big Cleaning, half-day holiday, and the grace.
 *
 * The rule itself is atomStaffHours_ in Engine.gs (generated from webapp/engine.js), which is a GAS
 * global and pure — no sheets. This function only fetches the facts. Everything that used to work
 * lateness out for itself now asks here: check-in, check-out, the recompute tool, and the approval
 * of a back-dated attendance request. Five opinions became one.
 */
function staffDayHours_(staffId, date) {
  date = date || new Date();
  var ds = dateStr_(date);
  var sched = staffSchedule_(staffId, date);
  var h = holidayOn_(ds);
  return atomStaffHours_({
    checkIn: sched.checkIn, checkOut: sched.checkOut,
    bigCleaning: isBigCleaningDay_(ds),
    bigCleanIn: getConfigTime_('BigCleaningIn', '08:30'), bigCleanOut: getConfigTime_('BigCleaningOut', '17:00'),
    holStart: h ? holTime_(h.StartTime) : '', holEnd: h ? holTime_(h.EndTime) : '',
    grace: parseInt(getConfig_('LateGraceMinutes', '0'), 10) || 0,
    window: getConfig_('HolidayReopenWindowMinutes', '15')
  });
}

/**
 * WHAT DOES THE SERVER THINK TODAY IS — the answer, per person, in one call.
 *
 * On 2026-08-19 the app told four teachers "เริ่มงาน 12:00" while the server recorded them 250–311
 * minutes late, and neither of them could say what the other was seeing. Diagnosing it meant reading
 * code and guessing at a spreadsheet nobody could open from here.
 *
 * So the server now says it out loud: the two timezones (whose disagreement caused it), the holiday
 * row exactly as read AND as decoded, and the hours resolved for every member of staff. Admin-only,
 * read-only, no side effects.
 */
function handleDiagDay(p) {
  p = p || {};
  var d = p.date ? new Date(String(p.date) + 'T12:00:00') : new Date();
  var ds = dateStr_(d);
  var raw = null, dec = null;
  try {
    var hs = readObjects_(sheet_(getMainSpreadsheet_(), 'HOLIDAYS'));
    var row = hs.filter(function (x) { return dateStr_(new Date(x.Date)) === ds; })[0] || null;
    if (row) {
      // what TYPE the cell is matters more than its value — a Date is the whole class of bug
      raw = { StartTime: String(row.StartTime), EndTime: String(row.EndTime),
        startIsDate: (row.StartTime instanceof Date), endIsDate: (row.EndTime instanceof Date),
        name: String(row.NameTH || row.NameEN || '') };
    }
  } catch (e) { raw = { error: String((e && e.message) || e) }; }
  var h = holidayOn_(ds);
  if (h) dec = { StartTime: holTime_(h.StartTime), EndTime: holTime_(h.EndTime) };

  var staff = [];
  try {
    readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) {
      if (!s.StaffID || String(s.Status || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
      var sc = staffSchedule_(s.StaffID, d), hh = staffDayHours_(s.StaffID, d);
      staff.push({ staffId: s.StaffID, nick: s.Nickname || s.NameTH || s.Name || '',
        shift: sc.checkIn + '-' + sc.checkOut,
        start: hh.checkIn, end: hh.checkOut, grace: hh.grace,
        openFrom: hh.openFrom, reopened: !!hh.reopened, dayOff: !!hh.dayOff,
        // the answer handleStaffCheckin itself uses — if this is false the buttons stay shut
        holidayOT: staffHasHolidayOT_(s.StaffID, ds) });
    });
  } catch (e) { staff.push({ error: String((e && e.message) || e) }); }

  /* WHO WAS THIS CLOSED DAY OPENED FOR — read from the two sheets that decide it, not from anything
   * a screen believes. On 22/08/2026 an OT วันหยุด and a named child both existed as far as the
   * school knew, and neither could be seen anywhere in the app; there was no way to tell "it was
   * never recorded" from "it was recorded and not displayed". Now the server says which. */
  var holOT = [], holKids = [];
  try {
    readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).forEach(function (r) {
      if (dateStr_(new Date(r.Date)) !== ds) return;
      var st = otStaffById_(r.StaffID);
      holOT.push({ otId: r.OTRecordID, staffId: r.StaffID, nick: st.Nickname || st.NameTH || st.Name || '',
        kind: String(r.Kind || ''), isHoliday: otIsHoliday_(r), status: String(r.Status || ''),
        amount: Number(r.Amount) || 0, hours: Number(r.Hours) || 0, note: String(r.Note || ''),
        // the day only opens for a HOLIDAY-kind row that is not rejected — say so, per row
        opensDay: otIsHoliday_(r) && String(r.Status || '').toUpperCase() !== 'REJECTED' });
    });
  } catch (e) { holOT.push({ error: String((e && e.message) || e) }); }
  try {
    var kidIds = holidayAttendIds_(ds);
    holKids = kidIds.map(function (id) {
      var s = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (x) { return String(x.StudentID) === String(id); }) || {};
      return { studentId: id, nick: s.Nickname || s.NameTH || s.Name || '(ไม่พบในทะเบียน)', class: s.Class || '' };
    });
  } catch (e) { holKids = [{ error: String((e && e.message) || e) }]; }

  return {
    date: ds, now: timeStr_(new Date()),
    closed: isSchoolClosed_(d), isHoliday: isHolidayDate_(ds),
    holidayOT: holOT, holidayStudents: holKids,
    // if these two differ, every time-only cell has two readings — see holidayOn_
    ssTimezone: (typeof ssTz_ === 'function') ? ssTz_() : '?', configTimezone: tz_(),
    holidayRaw: raw, holidayDecoded: dec,
    bigCleaning: isBigCleaningDay_(ds),
    grace: parseInt(getConfig_('LateGraceMinutes', '0'), 10) || 0,
    reopenWindow: getConfig_('HolidayReopenWindowMinutes', '15'),
    staff: staff
  };
}

/**
 * Was this person given OT วันหยุด on this date? If so the day is a working day FOR THEM: they may
 * clock in and out on a day the school is shut, and neither lateness nor hourly OT is computed,
 * because the money for that day was agreed as a lump sum when the OT was recorded.
 */
function staffHasHolidayOT_(staffId, ds) {
  try {
    var rows = readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS'));
    return rows.some(function (r) {
      // otIsHoliday_ (OtStaff.gs) owns "is this the holiday lump sum" on the Apps Script side —
      // writing the Kind test out again here is how a payslip and a calendar start disagreeing
      return String(r.StaffID) === String(staffId) &&
             dateStr_(new Date(r.Date)) === ds &&
             otIsHoliday_(r) &&
             String(r.Status || '').toUpperCase() !== 'REJECTED';
    });
  } catch (e) { return false; }
}

/**
 * IS THIS DATE A HOLIDAY AT ALL? — a weekend, or a day the school put in HOLIDAYS.
 *
 * OT วันหยุด is payment for coming in on a day off. Recording it against an ordinary Tuesday is not
 * a small mistake: it is a lump sum with no hours behind it, approved on the spot, that replaces the
 * hourly OT the day should have produced. Nothing stopped it — the date box took any date at all.
 * A HALF-day holiday counts: the school shut for part of it and asked someone in anyway.
 */
function isHolidayDate_(ds) {
  try { if (holidayOn_(ds)) return true; } catch (e) {}
  var g = new Date(String(ds) + 'T00:00:00').getDay();
  return g === 0 || g === 6;
}
function assertHolidayDate_(ds) {
  ds = String(ds || '').slice(0, 10);
  if (!ds) throw apiError_('BAD_INPUT', 'ระบุวันที่');
  if (isHolidayDate_(ds)) return;
  throw apiError_('NOT_A_HOLIDAY', 'วันที่ ' + ds + ' ไม่ใช่วันหยุด — OT วันหยุดเลือกได้เฉพาะเสาร์-อาทิตย์ ' +
    'หรือวันหยุดที่โรงเรียนกำหนดไว้ · หากเป็นวันทำงานปกติให้ใช้ OT รายชั่วโมงแทน');
}

/**
 * Children NAMED for a closed day — the ones coming in alongside a teacher's OT วันหยุด. For them
 * the day behaves like any other: check in, check out, the journal, the history, and the late-pickup
 * charge if somebody is collected late. For everybody else the school stays shut.
 *
 * An ALLOWLIST, not a plan: a child nobody expected has nobody responsible for them. A teacher can
 * add a name on the spot (holidayAttendAdd) when a family turns up.
 */
function holidayAttendIds_(ds) {
  try {
    var sh = getMainSpreadsheet_().getSheetByName('HOLIDAY_ATTEND');
    if (!sh) return [];
    return readObjects_(sh).filter(function (r) { return dateStr_(new Date(r.Date)) === ds; })
      .map(function (r) { return String(r.StudentID); });
  } catch (e) { return []; }
}
function isHolidayAttendee_(studentId, ds) { return holidayAttendIds_(ds).indexOf(String(studentId)) >= 0; }

/** May THIS CHILD be checked in or out on this date? One door, for the parent's button and the
 *  teacher's on-behalf button alike. */
function assertStudentDayOpen_(studentId, d) {
  d = d || new Date();
  var ds = dateStr_(d);
  /* NOT STARTED YET. A family is entered days or weeks before the first day so the deposit and the
   * first month can be billed — but the child does not come here until EnrollDate, so the button is
   * closed and the refusal names the DAY rather than just saying no. Checked BEFORE the calendar:
   * "the school is shut today" would be the wrong reason and the wrong date to hand somebody. */
  try {
    var st = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
      function (x) { return String(x.StudentID) === String(studentId); });
    var ed = st ? String(decodeCell_(st.EnrollDate) || '').slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(ed) && ds < ed) {
      throw apiError_('NOT_STARTED', 'วันแรกของการมาเรียนคือ ' + ed + ' — ยังลงเวลาไม่ได้จนกว่าจะถึงวันนั้น');
    }
  } catch (e) { if (e && e.apiCode === 'NOT_STARTED') throw e; }
  if (!isSchoolClosed_(d)) return;                                  // an ordinary open day
  if (isHolidayAttendee_(studentId, ds)) return;                    // expected today, by name
  var why = '';
  try { var h = holidayOn_(ds); if (h) why = String(h.NameTH || h.Name || h.NameEN || ''); } catch (e) {}
  if (!why) { var g = d.getDay(); why = (g === 0 || g === 6) ? 'วันหยุดสุดสัปดาห์' : 'วันหยุด'; }
  throw apiError_('SCHOOL_CLOSED', 'วันนี้โรงเรียนหยุด (' + why + ') — ' +
    'นักเรียนคนนี้ไม่ได้อยู่ในรายชื่อที่มาโรงเรียนวันนี้ · หากมาจริง ให้คุณครูเพิ่มชื่อก่อนจึงจะลงเวลาได้');
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
  var today = dateStr_(new Date());
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && today < start) {
    throw apiError_('NOT_STARTED', 'วันแรกของการทำงานคือ ' + start + ' — ยังลงเวลาไม่ได้');
  }
  // ...and the other end of it. EndDate is a LAST WORKING DAY recorded in advance, so it must not
  // block anything until it has passed — the person is still turning up until then.
  var end = String((rec && rec.EndDate) || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(end) && today > end) {
    throw apiError_('ENDED', 'สิ้นสุดการทำงานเมื่อ ' + end + ' — ลงเวลาไม่ได้แล้ว');
  }
}

/**
 * Nobody clocks in on a day the school is shut.
 *
 * The dashboard already greyed the day out and the digests already skipped it, but the BUTTONS
 * still worked — so a holiday could collect check-ins that then had to be explained. One rule
 * (isSchoolClosed_), used by everything, is what keeps the screen and the record agreeing.
 * A Big Cleaning day is a WORKING day that happens to fall at the weekend, so it is not closed.
 */
/**
 * @param {Date} d
 * @param {boolean} forStudents  A BIG CLEANING DAY IS FOR THE STAFF, NOT THE CHILDREN. It is a
 *   working Saturday: teachers clock in and are paid, and nobody's child comes to school. Treating
 *   it as "open" full stop left the children's drop-off / pick-up live on a day the nursery was shut
 *   to them (reported 2026-08-15, a Saturday). This flag is the whole difference.
 */
/** A holiday time as text, or '' for "the whole day". Mirrors cfgTime_ in the engine: anything that
 *  is not a real HH:mm — including the 1899 Date a Sheets time cell decodes to — becomes blank, i.e.
 *  the whole day, never midnight (which would leave the afternoon open on a full-day holiday). */
function holTime_(v) {
  /* A Date still gets formatted in the SPREADSHEET's timezone, exactly as decodeCell_ does — never in
   * the SCHOOL_CONFIG one. Formatting the same cell two ways is what made the server measure a
   * teacher's lateness against a window the app was showing her a different version of (2026-08-19).
   * In practice holidayOn_ has already decoded it and this branch is a belt-and-braces fallback. */
  if (v instanceof Date) {
    try { return Utilities.formatDate(v, (typeof ssTz_ === 'function') ? ssTz_() : tz_(), 'HH:mm'); }
    catch (e) { return ''; }
  }
  var s = String(v == null ? '' : v).trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
}
/**
 * `openFrom` — STAFF only, and only on a day the school reopens partway through (see
 * atomStaffHours_). Clocking in is allowed from that time even though the school is still shut, so a
 * teacher waiting at the gate for noon does not tap at 12:01 and get marked late. Students are never
 * let in early: the school asked for their side to keep the original condition.
 */
function assertSchoolOpen_(d, forStudents, openFrom) {
  d = d || new Date();
  var ds = dateStr_(d);
  if (!forStudents) { try { if (isBigCleaningDay_(ds)) return; } catch (e) {} }
  if (!forStudents && openFrom && ds === dateStr_(new Date()) && timeStr_(d) >= openFrom) return;
  if (!isSchoolClosed_(d)) return;
  var why = '', h = null;
  try {
    h = holidayOn_(ds);
    if (h) why = String(h.NameTH || h.Name || h.NameEN || '');
  } catch (e) {}
  /* A HOLIDAY CAN BE HALF A DAY: "19/08 08:00–12:30" shuts the school for that window and leaves it
   * open around it. Outside the window this is an ordinary working day and the check-in must go
   * through — so the guard lets it past rather than refusing the whole date. isSchoolClosed_ still
   * answers per-DAY (it is what the digests use to skip a day), which is why the window is checked
   * here, where the question is "may this person clock in right now". */
  if (h) {
    var hs2 = holTime_(h.StartTime), he2 = holTime_(h.EndTime);
    if (hs2 || he2) {
      var now = timeStr_(d);
      var inWindow = (!hs2 || now >= hs2) && (!he2 || now <= he2);
      if (!inWindow) return;
      why = why + ' ' + (hs2 || '00:00') + '-' + (he2 || '23:59');
    }
  }
  if (!why) { var g = d.getDay(); why = (g === 0 || g === 6) ? 'วันหยุดสุดสัปดาห์' : 'วันหยุด'; }
  throw apiError_('SCHOOL_CLOSED', forStudents
    ? 'ขณะนี้โรงเรียนหยุด (' + why + ') — ไม่มีการรับ-ส่งนักเรียน'
    : 'ขณะนี้โรงเรียนหยุด (' + why + ') — ไม่ต้องลงเวลา');
}

// ---- Check-in -----------------------------------------------------
/** payload: { staffId|lineUid, lat, lng } */
function handleStaffCheckin(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  assertStaffStarted_(staff);
  var now = new Date(), today = dateStr_(now);
  // The day's real hours decide BOTH questions here: may this person clock in yet, and are they late.
  // On a day the school reopens at noon, clocking in opens 15 minutes early (openFrom) and the same
  // 15 minutes are forgiven after — a teacher at the gate must not lose a month's เบี้ยขยัน to a
  // loading spinner. See atomStaffHours_ in Engine.gs.
  var hrs = staffDayHours_(staff.StaffID, now);
  /* OT วันหยุด opens the day for the person who was given it, and nobody else. The money was agreed
   * as a LUMP SUM, so the punch records WHEN they were here — it is not a second thing to be paid
   * for: no lateness (a holiday has no shift to be late for) and no hourly OT on top. The school's
   * decision, 2026-08-21. */
  var holOT = staffHasHolidayOT_(staff.StaffID, today);
  if (!holOT) {
    if (hrs.dayOff) throw apiError_('SCHOOL_CLOSED', 'วันนี้เป็นวันหยุดของโรงเรียน — ไม่ต้องลงเวลา');
    assertSchoolOpen_(now, false, hrs.openFrom);
  }
  var dist = assertWithinGeofence_(payload.lat, payload.lng, payload.acc);
  var sheet = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');

  var existing = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && dateStr_(new Date(r.Date)) === today;
  });
  if (existing && existing.CheckIn) {
    throw apiError_('ALREADY_CHECKED_IN', 'ลงเวลาเข้างานวันนี้ไปแล้ว (' + toHHmm_(existing.CheckIn) + ')');
  }

  var expectMin = hhmmToMin_(hrs.checkIn); if (expectMin == null) expectMin = hhmmToMin_('08:00');
  var lateMin = holOT ? 0 : Math.max(0, minOfDay_(now) - (expectMin + hrs.grace));

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
  var fixed = [], rows = [];
  readObjects_(sheet).forEach(function (r) {
    if (dateStr_(new Date(r.Date)) !== today || !r.CheckIn) return;
    var ci = toHHmm_(r.CheckIn); var m = /^(\d\d):(\d\d)/.exec(ci); if (!m) return;
    var minOfCI = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    // the SAME hours the check-in used — this tool exists to repair rows, not to introduce a second
    // opinion about what time the day started (it used to ignore Big Cleaning entirely)
    var hrs = staffDayHours_(r.StaffID, new Date());
    var expect = hhmmToMin_(hrs.checkIn); if (expect == null) expect = hhmmToMin_('08:00');
    var late = hrs.dayOff ? 0 : Math.max(0, minOfCI - (expect + hrs.grace));
    var was = Number(r.LateMinutes) || 0;
    /* Every row is reported, changed or not, WITH the hours it was measured against. A repair that
     * says only "3 rows fixed" cannot tell you the difference between "the holiday is now being read
     * correctly" and "the server still cannot see it and has just written the same wrong number
     * again" — which is exactly the question that was open on 2026-08-19. */
    rows.push({ staffId: r.StaffID, checkIn: ci, was: was, late: late,
      start: hrs.checkIn, grace: hrs.grace, reopened: !!hrs.reopened, dayOff: !!hrs.dayOff,
      changed: was !== late });
    if (was !== late) { updateRow_(sheet, r._row, { LateMinutes: late }); fixed.push({ staffId: r.StaffID, checkIn: ci, was: was, late: late }); }
  });
  try { CacheService.getScriptCache().removeAll(['rows:CHECKIN_STAFF', 'col:CHECKIN_STAFF']); } catch (e) {}
  return { ok: true, date: today, fixed: fixed, rows: rows };
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

  // the same door as the parent's button. This path never had the check at all — a teacher could
  // record a child on any closed day — and now that a closed day CAN be open to some children,
  // "who is expected today" has to be asked here too.
  assertStudentDayOpen_(student.StudentID);

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
  // the time RECORDED, not the moment the button was pressed — the two differ whenever a teacher
  // enters the real time, and the confirmation must show what was actually written down
  return { studentId: student.StudentID, type: type, time: timeHM, remark: remark, ot: ot };
}

// ---- Check-out ----------------------------------------------------
/** payload: { staffId|lineUid, lat, lng } */
function handleStaffCheckout(payload) {
  payload = payload || {};
  var staff = resolveStaff_(payload);
  assertStaffStarted_(staff);
  /* Clocking OUT is never refused, on any day. Someone who is here and going home must be able to
   * say so — an afternoon closure (13:00–17:00) trapped every teacher who was already at work and
   * left the day with no end time at all, which is also how a day ends up needing correcting by hand.
   * The school's decision, 2026-08-18. */
  var dist = assertWithinGeofence_(payload.lat, payload.lng, payload.acc);
  var now = new Date(), today = dateStr_(now);
  var sheet = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');

  var row = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && dateStr_(new Date(r.Date)) === today;
  });
  if (!row || !row.CheckIn) throw apiError_('NOT_CHECKED_IN', 'ยังไม่ได้ลงเวลาเข้างานวันนี้');
  if (row.CheckOut) throw apiError_('ALREADY_CHECKED_OUT', 'ลงเวลาออกงานวันนี้ไปแล้ว (' + toHHmm_(row.CheckOut) + ')');

  // OT runs from the person's OWN end time, even on a day the school opened late — the school asked
  // for exactly that: "เลิกงานตามกะเวลาเดิมของตนเอง และ OT ตามกะเวลายังดำเนินอยู่".
  var outHHmm = staffDayHours_(staff.StaffID, now).checkOut;
  var outMin = hhmmToMin_(outHHmm); if (outMin == null) outMin = hhmmToMin_('17:00');
  // ...but a day already paid as a LUMP SUM (OT วันหยุด) produces no hourly OT on top of it
  var otMin = staffHasHolidayOT_(staff.StaffID, today) ? 0 : Math.max(0, minOfDay_(now) - outMin);
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
      // the time they were actually due to leave — on a Big Cleaning day that is the day's own end
      // time, not their group's, or the approver reads OT measured against a shift nobody worked
      PlanOut: outHHmm, ActualOut: timeStr_(now), Month: today.slice(0, 7),
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
function handleBigCleaningDays() {
  return {
    days: bigCleaningDays_(), amount: Number(getConfig_('BigCleaningAmount', '0')) || 0,
    // the day's own hours — check-in/out already measure lateness and OT against these, but there
    // was no way to see or set them, so the school was working to numbers it could not read
    checkIn: getConfigTime_('BigCleaningIn', '08:30'),
    checkOut: getConfigTime_('BigCleaningOut', '17:00')
  };
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
