/**
 * AttReq.gs — manual attendance-time requests (ขอลงเวลา).
 * ------------------------------------------------------------------
 * A staff member asks to record a check-in or check-out at a chosen time (e.g. forgot to clock in,
 * GPS failed). 2-step approval mirrors leave/OT: PENDING_LEADER → PENDING_ADMIN → APPROVED/REJECTED
 * (a Leader/Admin's own request skips straight to PENDING_ADMIN). On final APPROVED the time is
 * written into CHECKIN_STAFF (creating the row if absent) and late/OT are recomputed vs the staff's
 * schedule; the written time is flagged InManual/OutManual='YES' so the app shows it in blue/bold.
 *
 * Writes are IN-PLACE (updateRow_/appendObject_). Reads (myTimeRequests/teamPendingTimeRequests/
 * pendingAdminTimeRequests) defer to the shared engine, which hydrates ATTENDANCE_REQUEST. In Code.gs.
 * ------------------------------------------------------------------
 */
function arStaffById_(id) {
  return findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(id); }) || {};
}
function arSheet_() {
  var ss = getHrSpreadsheet_();
  var sh = ss.getSheetByName('ATTENDANCE_REQUEST');
  /* Step1At/Step2At/DecisionNote: WHEN each signature happened and anything said while refusing.
   * The sheet recorded who, never when — so "อนุมัติไปเมื่อไหร่" had no answer at all, on a request
   * that writes a real check-in and therefore moves late minutes, OT and pay (asked 2026-09-04). */
  var cols = ['ReqID', 'StaffID', 'Date', 'Type', 'RequestTime', 'Reason', 'Status', 'Step1By', 'Step1Status', 'Step1At', 'Step2By', 'Step2Status', 'Step2At', 'DecisionNote', 'CreatedDate'];
  if (!sh) { sh = ss.insertSheet('ATTENDANCE_REQUEST'); sh.getRange(1, 1, 1, cols.length).setValues([cols]); return sh; }
  ensureColumns_(sh, cols);
  return sh;
}
function arBust_() { if (typeof cacheDel_ === 'function') { cacheDel_('col:ATTENDANCE_REQUEST'); cacheDel_('rows:ATTENDANCE_REQUEST'); } }
function arIsAdmin_(s) { return s.PositionLevel === 'Admin' || s.Role === 'Admin'; }
function arIsLeader_(s) { return arIsAdmin_(s) || s.PositionLevel === 'Leader'; }
function arFind_(sh, id) { return findObject_(sh, function (r) { return String(r.ReqID) === String(id); }); }
function arNextId_(sh) {
  var max = 0;
  readObjects_(sh).forEach(function (r) { var m = /ATR-?(\d+)/.exec(String(r.ReqID || '')); if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'ATR-' + ('00' + (max + 1)).slice(-3);
}

/** Write the approved time into CHECKIN_STAFF (create row if absent) + recompute late/OT. */
function arApply_(req) {
  var sh = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');
  ensureColumns_(sh, ['InManual', 'OutManual']);
  var date = String(req.Date).slice(0, 10);
  var time = toHHmm_(req.RequestTime);
  var type = String(req.Type).toUpperCase();
  // the day being approved may have had its own hours — a Big Cleaning day, or a holiday that ran
  // until noon. Asking staffDayHours_ for THAT date is what stops an approval disagreeing with what
  // the check-in would have recorded on the day itself.
  var hrs = staffDayHours_(req.StaffID, new Date(date + 'T00:00:00'));
  var row = findObject_(sh, function (r) { return String(r.StaffID) === String(req.StaffID) && String(r.Date).slice(0, 10) === date; });
  var patch = {};
  if (type === 'IN') {
    var expectMin = hhmmToMin_(hrs.checkIn); if (expectMin == null) expectMin = hhmmToMin_('08:00');
    var reqMin = hhmmToMin_(time); if (reqMin == null) reqMin = expectMin;
    patch.CheckIn = time;
    patch.LateMinutes = hrs.dayOff ? 0 : Math.max(0, reqMin - (expectMin + hrs.grace));
    patch.InManual = 'YES';
    if (!row || !row.Status || String(row.Status) === 'NONE') patch.Status = 'IN';
  } else {
    var outMin = hhmmToMin_(hrs.checkOut); if (outMin == null) outMin = hhmmToMin_('17:00');
    var rMin = hhmmToMin_(time); if (rMin == null) rMin = outMin;
    var otMin = Math.max(0, rMin - outMin);
    var roundUp = parseInt(getConfig_('OTRoundUpMinutes', '50'), 10) || 50;
    patch.CheckOut = time; patch.OTHours = Math.floor(otMin / 60) + ((otMin % 60) >= roundUp ? 1 : 0); patch.OutManual = 'YES'; patch.Status = 'OUT';
  }
  if (row) updateRow_(sh, row._row, patch);
  else appendObject_(sh, Object.assign({ Date: date, StaffID: req.StaffID, CheckIn: '', CheckOut: '', LateMinutes: 0, OTHours: '', Status: '' }, patch));
  try { CacheService.getScriptCache().removeAll(['rows:CHECKIN_STAFF', 'col:CHECKIN_STAFF']); } catch (e) {}
}

/** payload: { staffId, type:'IN'|'OUT', date, time, reason? } */
function handleSubmitTimeRequest(p) {
  p = p || {}; var st = arStaffById_(p.staffId);
  if (!st.StaffID) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน');
  var type = String(p.type || '').toUpperCase();
  if (type !== 'IN' && type !== 'OUT') throw apiError_('BAD_TYPE', 'เลือกเข้างานหรือเลิกงาน');
  if (!p.date || !p.time) throw apiError_('BAD_INPUT', 'ระบุวันและเวลา');
  var lead = arIsLeader_(st);
  var sh = arSheet_(); var id = arNextId_(sh);
  appendObject_(sh, {
    ReqID: id, StaffID: p.staffId, Date: String(p.date).slice(0, 10), Type: type, RequestTime: p.time, Reason: p.reason || '',
    Status: lead ? 'PENDING_ADMIN' : 'PENDING_LEADER', Step1By: '', Step1Status: lead ? 'Skipped' : 'Pending', Step2By: '', Step2Status: 'Pending', CreatedDate: dateStr_(new Date())
  });
  arBust_();
  try { notifyAdmins_('⏰ คำขอลงเวลา: ' + (st.Name || p.staffId) + ' ' + (type === 'IN' ? 'เข้างาน' : 'เลิกงาน') + ' ' + p.date + ' ' + p.time + (lead ? ' · รอแอดมิน' : ' · รอหัวหน้า')); } catch (e) {}
  return { reqId: id, status: lead ? 'PENDING_ADMIN' : 'PENDING_LEADER' };
}

/** Leader step-1. payload: { staffId, reqId, decision } */
function handleApproveTimeRequest(p) {
  p = p || {}; var ap = arStaffById_(p.staffId);
  if (!arIsLeader_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้าครู');
  var sh = arSheet_(); var r = arFind_(sh, p.reqId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบคำขอ');
  if (String(r.Status).toUpperCase() !== 'PENDING_LEADER') throw apiError_('BAD_STATE', 'ไม่ได้รออนุมัติจากหัวหน้า');
  var yes = p.decision === 'approve';
  var patch = { Step1By: ap.Name, Step1Status: yes ? 'Approved' : 'Rejected', Status: yes ? 'PENDING_ADMIN' : 'REJECTED',
    Step1At: nowStr_() };
  if (p.reason) patch.DecisionNote = String(p.reason).slice(0, 200);
  updateRow_(sh, r._row, patch);
  arBust_();
  // A refusal at step 1 ended the request, and the requester was told nothing — only the ADMIN's
  // final decision ever pushed a message (handleConfirmTimeRequest). They waited for an answer that
  // had already been given.
  if (!yes) {
    try {
      notifyStaffMember_(r.StaffID, '⏰ คำขอลงเวลา ' + (String(r.Type).toUpperCase() === 'IN' ? 'เข้างาน' : 'เลิกงาน') + ' '
        + String(r.Date).slice(0, 10) + ' ' + r.RequestTime + ' — ไม่อนุมัติ ❌'
        + (p.reason ? ('\nเหตุผล: ' + p.reason) : ''), 'approval', '', 'staff.approval');
    } catch (e) {}
  }
  return { reqId: p.reqId, status: yes ? 'PENDING_ADMIN' : 'REJECTED' };
}

/** Admin step-2 (final). On approve, writes the time into CHECKIN_STAFF. payload: { staffId, reqId, decision } */
function handleConfirmTimeRequest(p) {
  p = p || {}; var ap = arStaffById_(p.staffId);
  if (!arIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = arSheet_(); var r = arFind_(sh, p.reqId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบคำขอ');
  var done = String(r.Status || '').toUpperCase();
  if (done === 'APPROVED' || done === 'REJECTED') throw apiError_('BAD_STATE', 'คำขอนี้ตัดสินไปแล้ว');
  var yes = p.decision === 'approve';
  if (yes) arApply_(r);
  var patch = { Step2By: ap.Name, Step2Status: yes ? 'Approved' : 'Rejected', Status: yes ? 'APPROVED' : 'REJECTED',
    Step2At: nowStr_() };
  if (p.reason) patch.DecisionNote = String(p.reason).slice(0, 200);
  // The admin list now includes requests still sitting with the head teacher, so an admin can settle
  // one directly. Record that it happened that way — otherwise the sheet would show a step-1 approval
  // by a leader who never saw it.
  if (done === 'PENDING_LEADER') {
    patch.Step1By = ap.Name + ' (แอดมินอนุมัติแทน)';
    patch.Step1Status = yes ? 'Approved' : 'Rejected';
    patch.Step1At = patch.Step2At;
  }
  updateRow_(sh, r._row, patch);
  arBust_();
  // The LINE push here is unconditional by design — it is the answer to a request this person made,
  // not traffic they were subscribed to. The 🔔 inbox row is written too, so the answer survives an
  // exhausted LINE quota.
  try {
    var msg = '⏰ คำขอลงเวลา ' + (String(r.Type).toUpperCase() === 'IN' ? 'เข้างาน' : 'เลิกงาน') + ' ' + String(r.Date).slice(0, 10) + ' ' + r.RequestTime + ' — ' + (yes ? 'อนุมัติแล้ว ✅' : 'ไม่อนุมัติ ❌') + (p.reason ? ('\nเหตุผล: ' + p.reason) : '');
    /* 🔴 THE LINE HALF WAS UNGATED — missed when the per-topic switches shipped (fixed 2026-10-12).
     * The bell was already written here unconditionally, which was right; the push beside it ignored
     * every setting, which is the exact defect v429 existed to end. notifyStaffMember_ does both
     * halves by the house rule, so there is nothing left to forget. */
    notifyStaffMember_(r.StaffID, msg, 'approval', '', 'staff.approval');
  } catch (e) {}
  return { reqId: p.reqId, status: yes ? 'APPROVED' : 'REJECTED' };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ✏️ CORRECTING A STAFF CLOCK TIME — the thing the children's side has had all along.
 *
 * ผอ., 2026-10-20: "ระบบของเรามีฟังก์ชันไหนในการแก้เวลาพนักงานบ้าง หากลงเวลาผิด ที่ไม่ใช่คำขอลงเวลา
 * เหมือนฟังก์ชันของนักเรียนเวลาผู้ปกครองกดผิด".
 *
 * There was none. A child whose parent taps "รับกลับ" by mistake is corrected in ten seconds by any
 * teacher covering their class (editStudentAttendance) — times set or CLEARED, OT recomputed, who
 * did it and why recorded. A teacher who taps the wrong thing had exactly one route: คำขอลงเวลา,
 * two approvals, and it can only ever WRITE a time:
 *
 *   · clocked IN on a day they did not work  → no route on earth could remove that row
 *   · tapped the button twice                → ALREADY_CHECKED_IN, the wrong time frozen on the spot
 *   · a teacher who has left, or cannot open the app → nobody could file on their behalf
 *
 * And staff time IS MONEY: LateMinutes feeds เบี้ยขยัน and OTHours feeds the payslip. So the only
 * repair was editing the Google Sheet by hand — which records nothing about who changed it.
 *
 * 🔴 ADMIN ONLY, AND THE PERSON IS ALWAYS TOLD. The school's decision (2026-10-20). The children's
 * version is deliberately wider (a teacher may fix their own class) because a child's pick-up time
 * is the teacher's own business; a colleague's pay is not.
 *
 * 🔴 AND IT RECOMPUTES RATHER THAN TRUSTING WHAT IS IN THE ROW. Late minutes and OT hours are
 * derived from the hours THAT DAY had (staffDayHours_ for that date — a Big Cleaning Saturday and a
 * half-day holiday have their own), which is the same derivation arApply_ uses. A correction that
 * changed the time and left yesterday's late minutes standing would be a worse lie than the typo.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** payload: { staffId (the ADMIN), targetId, date, checkIn?, checkOut?, remark? } */
function handleEditStaffAttendance(p) {
  p = p || {};
  var ap = arStaffById_(p.staffId);
  if (!arIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var target = arStaffById_(p.targetId);
  if (!target.StaffID) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน');
  var date = String(p.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw apiError_('BAD_INPUT', 'ระบุวันที่');
  /* 🔴 NOT A DAY THAT HAS NOT HAPPENED. Attendance is a record of something that occurred; a clock
   * time typed for next Tuesday is not a correction, it is an invention — and it would sit in the
   * month's totals as a day worked. */
  if (date > dateStr_(new Date())) throw apiError_('FUTURE_DATE', 'แก้เวลาของวันที่ยังมาไม่ถึงไม่ได้');

  var hhmm = function (v) {
    if (v === null || v === undefined) return null;          // not sent → leave this half alone
    var t = String(v).trim();
    if (!t) return '';                                        // sent EMPTY → clear it
    if (!/^\d{1,2}:\d{2}$/.test(t)) throw apiError_('BAD_TIME', 'รูปแบบเวลาต้องเป็น HH:mm');
    return toHHmm_(t);
  };
  var inT = hhmm(p.checkIn), outT = hhmm(p.checkOut);
  if (inT === null && outT === null) throw apiError_('BAD_INPUT', 'ไม่มีอะไรให้แก้');
  var remark = String(p.remark || '').trim();
  if (!remark) throw apiError_('NEED_REASON', 'ใส่เหตุผลของการแก้ไขด้วย — เวลาของพนักงานมีผลกับเงินเดือน');

  var sh = sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF');
  /* EditedBy / EditedAt / EditNote — who typed this, when, and why. The request route records its
   * two signatures in ATTENDANCE_REQUEST; this one writes straight into the attendance row, so the
   * trail has to live on the row itself or it does not exist. */
  ensureColumns_(sh, ['InManual', 'OutManual', 'EditedBy', 'EditedAt', 'EditNote']);
  var row = findObject_(sh, function (r) {
    return String(r.StaffID) === String(target.StaffID) && String(r.Date).slice(0, 10) === date;
  });
  var before = { checkIn: row ? toHHmm_(row.CheckIn) : '', checkOut: row ? toHHmm_(row.CheckOut) : '' };
  var finalIn  = inT  === null ? before.checkIn  : inT;
  var finalOut = outT === null ? before.checkOut : outT;

  /* BOTH TIMES BLANK IS A DAY THAT DID NOT HAPPEN, so the row goes rather than sitting there as a
   * present-but-empty day. This is the half arApply_ could never do, and the reason an accidental
   * clock-in was permanent. */
  if (!finalIn && !finalOut) {
    // in-place, like every other delete in this project — see the DATA-LOSS note in GasEngine.gs
    if (row) { sh.deleteRow(row._row); bustSheetCache_(sh); }
    try { CacheService.getScriptCache().removeAll(['rows:CHECKIN_STAFF', 'col:CHECKIN_STAFF']); } catch (e) {}
    try { logAuditHr(p.staffId || 'admin', 'STAFF_ATT_DELETE', 'CHECKIN_STAFF',
      target.StaffID + ' ' + date + ' (เดิม ' + (before.checkIn || '-') + '/' + (before.checkOut || '-') + ') — ' + remark); } catch (e) {}
    editStaffAttendanceNotify_(target, date, before, { checkIn: '', checkOut: '' }, remark, ap);
    return { staffId: target.StaffID, date: date, checkIn: '', checkOut: '', removed: true, before: before };
  }

  var hrs = staffDayHours_(target.StaffID, new Date(date + 'T00:00:00'));
  var patch = { Date: date, StaffID: target.StaffID, CheckIn: finalIn, CheckOut: finalOut,
    EditedBy: ap.Name || p.staffId, EditedAt: nowStr_(), EditNote: remark.slice(0, 200) };

  // late — only ever against the hours that day actually had, and never on a day off
  var expectMin = hhmmToMin_(hrs.checkIn); if (expectMin == null) expectMin = hhmmToMin_('08:00');
  var inMin = hhmmToMin_(finalIn);
  patch.LateMinutes = (!finalIn || hrs.dayOff || inMin == null) ? 0 : Math.max(0, inMin - (expectMin + hrs.grace));

  // OT — the same arithmetic the clock-out and the approved request both use
  var planOut = hhmmToMin_(hrs.checkOut); if (planOut == null) planOut = hhmmToMin_('17:00');
  var outMin = hhmmToMin_(finalOut);
  if (!finalOut || outMin == null) { patch.OTHours = ''; }
  else {
    var otMin = Math.max(0, outMin - planOut);
    var roundUp = parseInt(getConfig_('OTRoundUpMinutes', '50'), 10) || 50;
    patch.OTHours = Math.floor(otMin / 60) + ((otMin % 60) >= roundUp ? 1 : 0);
  }
  patch.Status = finalOut ? 'OUT' : (finalIn ? 'IN' : 'NONE');
  // a time an admin typed is a manual time, same as one that came through an approved request —
  // the ✍️ on the month calendar means "a person entered this", and that is true either way
  if (inT !== null) patch.InManual = finalIn ? 'YES' : '';
  if (outT !== null) patch.OutManual = finalOut ? 'YES' : '';

  if (row) updateRow_(sh, row._row, patch);
  else appendObject_(sh, patch);
  try { CacheService.getScriptCache().removeAll(['rows:CHECKIN_STAFF', 'col:CHECKIN_STAFF']); } catch (e) {}
  try {
    logAuditHr(p.staffId || 'admin', 'STAFF_ATT_EDIT', 'CHECKIN_STAFF',
      target.StaffID + ' ' + date + ' เข้า ' + (finalIn || '-') + ' ออก ' + (finalOut || '-') +
      ' (เดิม ' + (before.checkIn || '-') + '/' + (before.checkOut || '-') + ') — ' + remark);
  } catch (e) {}
  editStaffAttendanceNotify_(target, date, before, { checkIn: finalIn, checkOut: finalOut }, remark, ap);
  return { staffId: target.StaffID, date: date, checkIn: finalIn, checkOut: finalOut,
    late: patch.LateMinutes, otHours: patch.OTHours, before: before };
}

/* 🔴 THE PERSON WHOSE MONTH THIS IS ALWAYS HEARS ABOUT IT (the school's decision, 2026-10-20).
 *
 * Somebody else changed a number that decides their เบี้ยขยัน and their OT. A silent correction is
 * indistinguishable from a bug in the app, and they would find out — if at all — from the payslip,
 * which is the worst possible place to discover it. The message says what it WAS as well as what it
 * is now, because "your check-in is 08:30" tells them nothing they can check.
 *
 * Never breaks the correction: the times ARE saved, and a push that did not go out is a message
 * that did not arrive, not a reason to tell an admin their correction failed.
 */
function editStaffAttendanceNotify_(target, date, before, after, remark, by) {
  try {
    var fmt = function (v) { return v || '—'; };
    var msg = '✏️ แอดมินแก้ไขเวลาทำงานของคุณ\n' +
      '📅 วันที่ ' + date + '\n' +
      'เข้างาน ' + fmt(before.checkIn) + ' → ' + fmt(after.checkIn) + '\n' +
      'เลิกงาน ' + fmt(before.checkOut) + ' → ' + fmt(after.checkOut) + '\n' +
      (!after.checkIn && !after.checkOut ? 'ลบการลงเวลาของวันนี้ออกทั้งหมด\n' : '') +
      'เหตุผล: ' + remark + '\n' +
      'แก้ไขโดย: ' + ((by && by.Name) || 'แอดมิน') + '\n' +
      'หากไม่ถูกต้อง กรุณาแจ้งแอดมินทันที';
    if (typeof notifyStaffMember_ === 'function') notifyStaffMember_(target.StaffID, msg, 'approval', '', 'staff.approval');
    if (typeof notifyAdmins_ === 'function') notifyAdmins_(msg);
  } catch (e) { try { Logger.log('editStaffAttendanceNotify_ failed: ' + (e && e.stack || e)); } catch (x) {} }
}
