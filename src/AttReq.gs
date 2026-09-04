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
        + (p.reason ? ('\nเหตุผล: ' + p.reason) : ''), 'approval');
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
    try { inboxAdd_('approval', msg, '', String(r.StaffID || '')); } catch (e2) {}
    var st = arStaffById_(r.StaffID);
    if (st && st.LineUID) linePushText_(st.LineUID, msg);
  } catch (e) {}
  return { reqId: p.reqId, status: yes ? 'APPROVED' : 'REJECTED' };
}
