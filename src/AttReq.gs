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
  var cols = ['ReqID', 'StaffID', 'Date', 'Type', 'RequestTime', 'Reason', 'Status', 'Step1By', 'Step1Status', 'Step2By', 'Step2Status', 'CreatedDate'];
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
  var sched = staffSchedule_(req.StaffID, new Date(date + 'T00:00:00'));
  var grace = parseInt(getConfig_('LateGraceMinutes', '0'), 10) || 0;
  var row = findObject_(sh, function (r) { return String(r.StaffID) === String(req.StaffID) && String(r.Date).slice(0, 10) === date; });
  var patch = {};
  if (type === 'IN') {
    var expectHHmm = isBigCleaningDay_(date) ? getConfig_('BigCleaningIn', '08:30') : sched.checkIn;
    var expectMin = hhmmToMin_(expectHHmm); if (expectMin == null) expectMin = hhmmToMin_('08:00');
    var reqMin = hhmmToMin_(time); if (reqMin == null) reqMin = expectMin;
    patch.CheckIn = time; patch.LateMinutes = Math.max(0, reqMin - (expectMin + grace)); patch.InManual = 'YES';
    if (!row || !row.Status || String(row.Status) === 'NONE') patch.Status = 'IN';
  } else {
    var outHHmm = isBigCleaningDay_(date) ? getConfig_('BigCleaningOut', '17:00') : sched.checkOut;
    var outMin = hhmmToMin_(outHHmm); if (outMin == null) outMin = hhmmToMin_('17:00');
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
  updateRow_(sh, r._row, { Step1By: ap.Name, Step1Status: yes ? 'Approved' : 'Rejected', Status: yes ? 'PENDING_ADMIN' : 'REJECTED' });
  arBust_();
  return { reqId: p.reqId, status: yes ? 'PENDING_ADMIN' : 'REJECTED' };
}

/** Admin step-2 (final). On approve, writes the time into CHECKIN_STAFF. payload: { staffId, reqId, decision } */
function handleConfirmTimeRequest(p) {
  p = p || {}; var ap = arStaffById_(p.staffId);
  if (!arIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = arSheet_(); var r = arFind_(sh, p.reqId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบคำขอ');
  var yes = p.decision === 'approve';
  if (yes) arApply_(r);
  updateRow_(sh, r._row, { Step2By: ap.Name, Step2Status: yes ? 'Approved' : 'Rejected', Status: yes ? 'APPROVED' : 'REJECTED' });
  arBust_();
  try {
    var st = arStaffById_(r.StaffID);
    if (st && st.LineUID) linePushText_(st.LineUID, '⏰ คำขอลงเวลา ' + (String(r.Type).toUpperCase() === 'IN' ? 'เข้างาน' : 'เลิกงาน') + ' ' + String(r.Date).slice(0, 10) + ' ' + r.RequestTime + ' — ' + (yes ? 'อนุมัติแล้ว ✅' : 'ไม่อนุมัติ ❌'));
  } catch (e) {}
  return { reqId: p.reqId, status: yes ? 'APPROVED' : 'REJECTED' };
}
