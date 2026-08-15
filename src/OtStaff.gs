/**
 * OtStaff.gs — staff evening-OT approval workflow (teacher → Leader → Admin).
 * ------------------------------------------------------------------
 * OT_RECORDS is the source of truth. A late checkout auto-creates a PENDING_LEADER row
 * (Checkin.gs). The Leader approves/rejects → PENDING_ADMIN; the Admin confirms (optionally
 * editing hours/amount) → APPROVED, or rejects. Admin can also add/edit/delete any OT.
 * Only APPROVED OT counts in payroll (Payroll.gs sumMonthlyOT_).
 *
 * All writes are IN-PLACE (updateRow_/appendObject_/deleteRow) so an edit never rewrites the
 * whole collection. The READS (myOT/teamPendingOT/pendingAdminOT/adminOTList) defer to the
 * engine, which reads the same hydrated OT_RECORDS. Registered in Code.gs.
 * ------------------------------------------------------------------
 */
function otStaffById_(id) {
  return findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) { return String(s.StaffID) === String(id); }) || {};
}
function otSheet_() {
  var sh = sheet_(getHrSpreadsheet_(), 'OT_RECORDS');
  ensureColumns_(sh, ['Status', 'Minutes', 'PlanOut', 'ActualOut', 'Month', 'Step1By', 'Step1Status', 'Step2By', 'Step2Status', 'Note', 'Kind']);
  return sh;
}
function otFindRow_(sh, otId) { return findObject_(sh, function (r) { return String(r.OTRecordID) === String(otId); }); }
function otBust_() { if (typeof cacheDel_ === 'function') { cacheDel_('col:OT_RECORDS'); cacheDel_('rows:OT_RECORDS'); } }
function otIsAdmin_(s) { return s.PositionLevel === 'Admin' || s.Role === 'Admin'; }
// OT วันหยุด is a lump sum with no hours behind it — asked in ONE place so no re-pricing path
// (approval, edit, a rate correction) can quietly turn an agreed amount into hours × rate = 0.
function otIsHoliday_(r) { return String((r && r.Kind) || '').toUpperCase() === 'HOLIDAY'; }
function otIsLeader_(s) { return s.PositionLevel === 'Leader' || otIsAdmin_(s); }

/** Leader step-1 decision. payload: { staffId, otId, decision:'approve'|'reject' } */
function handleApproveOT(p) {
  p = p || {}; var ap = otStaffById_(p.staffId);
  if (!otIsLeader_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะหัวหน้าครู');
  var sh = otSheet_(); var r = otFindRow_(sh, p.otId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบรายการ OT');
  if (String(r.Status).toUpperCase() !== 'PENDING_LEADER') throw apiError_('BAD_STATE', 'รายการนี้ไม่ได้รออนุมัติจากหัวหน้า');
  var yes = p.decision === 'approve';
  updateRow_(sh, r._row, { Step1By: ap.Name, Step1Status: yes ? 'Approved' : 'Rejected', Status: yes ? 'PENDING_ADMIN' : 'REJECTED' });
  otBust_(); return { otId: p.otId, status: yes ? 'PENDING_ADMIN' : 'REJECTED' };
}

/** Admin step-2 confirm (optional edit) or reject. payload: { staffId, otId, decision, hours?, amount?, note? } */
function handleConfirmOT(p) {
  p = p || {}; var ap = otStaffById_(p.staffId);
  if (!otIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = otSheet_(); var r = otFindRow_(sh, p.otId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบรายการ OT');
  var patch;
  if (p.decision === 'reject') { patch = { Step2By: ap.Name, Step2Status: 'Rejected', Status: 'REJECTED' }; }
  else {
    var hours = Number(r.Hours) || 0;
    var rate = otRateForStaff_(otStaffById_(r.StaffID));
    if (p.hours != null) hours = Number(p.hours) || 0;
    // A pending row carries the rate that applied when the check-out created it. Re-price it at
    // approval time so a rate correction (e.g. the 89.38 → 100 fix) reaches everything not yet paid;
    // an explicit amount from the Admin still wins.
    var amount = otIsHoliday_(r) ? (Number(r.Amount) || 0) : Math.round(hours * rate);
    if (otIsHoliday_(r)) rate = Number(r.Rate) || 0;
    if (p.amount != null && p.amount !== '') amount = Number(p.amount) || 0;
    patch = { Hours: hours, Rate: rate, Amount: amount, Step2By: ap.Name, Step2Status: 'Approved', ApprovedBy: ap.Name, Status: 'APPROVED' };
    if (p.note != null) patch.Note = p.note;
  }
  updateRow_(sh, r._row, patch); otBust_(); return { otId: p.otId, status: patch.Status };
}

/** Admin adds an already-approved OT. payload: { staffId, targetStaffId, date?, hours, amount?, note? } */
function handleAdminAddOT(p) {
  p = p || {}; var ap = otStaffById_(p.staffId);
  if (!otIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var target = p.targetStaffId || p.forStaffId; var st = otStaffById_(target);
  if (!st.StaffID) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน');
  var hours = Number(p.hours) || 0; if (hours <= 0) throw apiError_('BAD_INPUT', 'ระบุจำนวนชั่วโมง');
  var rate = otRateForStaff_(st); var amount = (p.amount != null && p.amount !== '') ? (Number(p.amount) || 0) : Math.round(hours * rate);
  var date = p.date || dateStr_(new Date()); var sh = otSheet_();
  appendObject_(sh, {
    OTRecordID: nextId_(sh, 'OTRecordID', 'OTR'), StaffID: target, Date: date, Hours: hours, Rate: rate, Amount: amount,
    ApprovedBy: ap.Name, Status: 'APPROVED', Minutes: hours * 60, PlanOut: '', ActualOut: '', Month: date.slice(0, 7),
    Step1By: ap.Name, Step1Status: 'Approved', Step2By: ap.Name, Step2Status: 'Approved', Note: p.note || ''
  });
  otBust_(); return { status: 'APPROVED' };
}

/**
 * OT วันหยุด — Admin records that staff came in on a day off. payload:
 *   { staffId, staffIds:[..], date, amount, note }
 * Unlike the evening OT there are no hours to count: the Admin agrees an amount per person, writes
 * down WHY (a long comment — that is the only record of what the day was), and it is APPROVED on the
 * spot, because the Admin granting it IS the approval. One row PER staff member so each teacher's own
 * OT history and payslip carry their own line, and so one person can later be edited or removed
 * without touching the rest.
 *
 * It lands in OT_RECORDS, which is what sumMonthlyOT_/otCarryOver_ already read — so holiday OT
 * reaches the salary through the SAME path as daily OT (including the carry-over that pays it late
 * rather than dropping it) instead of a second money pipeline that would have to be kept in step.
 */
function handleAdminAddHolidayOT(p) {
  p = p || {}; var ap = otStaffById_(p.staffId);
  if (!otIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var ids = p.staffIds || p.targetStaffIds || (p.targetStaffId ? [p.targetStaffId] : []);
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; });
  // de-duplicate: ticking the same person twice must not pay them twice
  var seen = {}, targets = [];
  ids.forEach(function (id) { if (!seen[id]) { seen[id] = 1; targets.push(id); } });
  if (!targets.length) throw apiError_('BAD_INPUT', 'เลือกพนักงานอย่างน้อย 1 คน');
  var amount = Number(p.amount) || 0;
  if (amount <= 0) throw apiError_('BAD_INPUT', 'ระบุจำนวนเงิน OT');
  var note = String(p.note == null ? '' : p.note).trim();
  if (!note) throw apiError_('BAD_INPUT', 'ระบุรายละเอียดการทำงานวันหยุด');
  var date = p.date || dateStr_(new Date());
  var sh = otSheet_(), added = [];
  targets.forEach(function (target) {
    var st = otStaffById_(target);
    if (!st.StaffID) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + target);
    appendObject_(sh, {
      OTRecordID: nextId_(sh, 'OTRecordID', 'OTR'), StaffID: target, Date: date, Hours: 0, Rate: 0, Amount: amount,
      ApprovedBy: ap.Name, Status: 'APPROVED', Minutes: 0, PlanOut: '', ActualOut: '', Month: String(date).slice(0, 7),
      Step1By: ap.Name, Step1Status: 'Approved', Step2By: ap.Name, Step2Status: 'Approved', Note: note, Kind: 'HOLIDAY'
    });
    added.push(target);
  });
  otBust_();
  return { count: added.length, date: date, amount: amount, staffIds: added, status: 'APPROVED' };
}

/** Admin edits any OT. payload: { staffId, otId, hours?, amount?, note?, date? } */
function handleAdminEditOT(p) {
  p = p || {}; var ap = otStaffById_(p.staffId);
  if (!otIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = otSheet_(); var r = otFindRow_(sh, p.otId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบรายการ OT');
  var patch = {};
  if (p.hours != null) { patch.Hours = Number(p.hours) || 0;
    if (!otIsHoliday_(r)) patch.Amount = Math.round(patch.Hours * otRateForStaff_(otStaffById_(r.StaffID))); }
  if (p.amount != null && p.amount !== '') patch.Amount = Number(p.amount) || 0;
  if (p.note != null) patch.Note = p.note;
  if (p.date) { patch.Date = p.date; patch.Month = String(p.date).slice(0, 7); }
  updateRow_(sh, r._row, patch); otBust_(); return { otId: p.otId, hours: patch.Hours, amount: patch.Amount };
}

/** Admin deletes an OT. payload: { staffId, otId } */
function handleAdminDeleteOT(p) {
  p = p || {}; var ap = otStaffById_(p.staffId);
  if (!otIsAdmin_(ap)) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  var sh = otSheet_(); var r = otFindRow_(sh, p.otId); if (!r) throw apiError_('NOT_FOUND', 'ไม่พบรายการ OT');
  sh.deleteRow(r._row); otBust_(); return { ok: true };
}
