/**
 * OT.gs — student late-pickup OT: real charging + admin management.
 * ------------------------------------------------------------------
 * Previously the GAS parent-checkin route never created an OT_DAILY row (only the engine's
 * mock path did), so late-pickup OT was never actually charged live. otUpsertForPickup_ is
 * now called on every OUT check-in (parent or teacher-on-behalf).
 *
 * An OT row is "open" (billable) unless it is PAID or CANCELLED. Admin can cancel it, correct
 * the pickup time (recomputes late/hours/amount), or override the amount outright. Each student
 * may carry an OTRate override on their STUDENTS row; otherwise SCHOOL_CONFIG OTRatePerHour.
 */
function otBust_() { try { CacheService.getScriptCache().removeAll(['col:OT_DAILY', 'rows:OT_DAILY']); } catch (e) {} }

/** Plan record for a student's Plan id (falls back to the first plan). */
function otPlanById_(planId) {
  var plans = [];
  try { plans = JSON.parse(getConfig_('Plans', '[]')); } catch (e) { plans = []; }
  for (var i = 0; i < plans.length; i++) if (String(plans[i].id) === String(planId)) return plans[i];
  return plans[0] || { end: '17:00' };
}
function otMinOfDay_(v) { var m = /^(\d{1,2}):(\d{2})/.exec(toHHmm_(v)); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0; }
/** Per-student rate wins when > 0, else the global config rate. */
function otRateFor_(student) {
  var r = Number(student && student.OTRate);
  if (r > 0) return r;
  return Number(getConfig_('OTRatePerHour', '100')) || 100;
}
/** The time a student is scheduled to leave. A per-student EndTime override (individual schedule,
 *  e.g. 07:00–17:00 for one child vs 08:00–18:00 for another) wins; otherwise the plan's end.
 *  This is what OT is measured against — so a child who ends at 18:00 is NOT charged from 17:00. */
function otStudentEnd_(student) {
  // toHHmm_ FIRST: a time-only cell reads back as an 1899-12-30 Date, and testing the regex on
  // String(date) ("Sat Dec 30 1899 18:00:00…") fails — which silently threw the per-student end time
  // away and measured OT from the plan end instead.
  var e = toHHmm_((student && (student.EndTime || student.LeaveTime)) || '');
  if (/^\d{1,2}:\d{2}$/.test(e)) return e;
  return otPlanById_(student && student.Plan).end || '17:00';
}
/** The time OT starts being charged. OTGraceUntil (per-student OT-free cutoff) wins when set — e.g. a
 *  child on the 17:00 rate allowed to be picked up until 18:00 with no OT — else the nominal end. */
function otThreshold_(student) {
  // same trap as otStudentEnd_ — normalise before testing, or "รับได้ถึง 18:00" is ignored and a 18:08
  // pick-up is charged from 17:00 (68 min late -> 2 hours -> 200 baht, which is what happened)
  var g = toHHmm_((student && student.OTGraceUntil) || '');
  if (/^\d{1,2}:\d{2}$/.test(g)) return g;
  return otStudentEnd_(student);
}
/** {late, hours, amount, planEnd, rate} for a pickup time. Nothing charged inside the grace window. */
function otComputeFor_(student, pickupHHMM) {
  var planEnd = otThreshold_(student);
  var rate = otRateFor_(student);
  var late = Math.max(0, otMinOfDay_(pickupHHMM) - otMinOfDay_(planEnd));
  var grace = Number(getConfig_('OTGraceMinutes', '21')) || 21;
  if (late <= grace) return { late: late, hours: 0, amount: 0, planEnd: planEnd, rate: rate };
  var hours = Math.ceil(late / 60);
  return { late: late, hours: hours, amount: hours * rate, planEnd: planEnd, rate: rate };
}

/**
 * Create/refresh today's OT row for a late pickup. Returns the OT summary, or null when there is
 * nothing to charge (inside grace), or when the existing row is already PAID/CANCELLED.
 */
function otUpsertForPickup_(student, pickupHHMM, dateS) {
  var c = otComputeFor_(student, pickupHHMM);
  if (c.amount <= 0) return null;
  var sh = sheet_(getMainSpreadsheet_(), 'OT_DAILY');
  var otId = 'OT-' + String(dateS).replace(/-/g, '') + '-' + student.StudentID;
  var ex = findObject_(sh, function (x) { return String(x.OTID) === otId; });
  if (ex) {
    var st = String(ex.Status || '');
    if (st === 'PAID' || st === 'CANCELLED') return null;          // settled — never re-charge
    updateRow_(sh, ex._row, { PickupTime: pickupHHMM, PlanEnd: c.planEnd, LateMinutes: c.late, Hours: c.hours, Amount: c.amount });
  } else {
    appendObject_(sh, { OTID: otId, Date: dateS, StudentID: student.StudentID, PickupTime: pickupHHMM,
      PlanEnd: c.planEnd, LateMinutes: c.late, Hours: c.hours, Amount: c.amount, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 });
  }
  otBust_();
  return { otId: otId, lateMinutes: c.late, hours: c.hours, amount: c.amount, planEnd: c.planEnd, rate: c.rate };
}

// ---- Admin management (admin-only via applyIdentity_ ADMIN_ONLY) ----
function otRow_(otId) {
  var sh = sheet_(getMainSpreadsheet_(), 'OT_DAILY');
  var o = findObject_(sh, function (x) { return String(x.OTID) === String(otId); });
  if (!o) throw apiError_('NOT_FOUND', 'ไม่พบรายการ OT ' + otId);
  return { sh: sh, o: o };
}

/** Correct the pickup time (recomputes) and/or override the amount. PAID rows are locked. */
function handleAdminUpdateOT(p) {
  p = p || {};
  var r = otRow_(p.otId);
  if (String(r.o.Status) === 'PAID') throw apiError_('ALREADY_PAID', 'รายการนี้ชำระแล้ว แก้ไขไม่ได้');
  var patch = {};
  if (p.pickupTime) {
    var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return String(s.StudentID) === String(r.o.StudentID); }) || {};
    var c = otComputeFor_(student, p.pickupTime);
    patch.PickupTime = toHHmm_(p.pickupTime); patch.PlanEnd = c.planEnd;
    patch.LateMinutes = c.late; patch.Hours = c.hours; patch.Amount = c.amount;
  }
  if (p.amount !== undefined && p.amount !== null && p.amount !== '') patch.Amount = Number(p.amount) || 0;  // manual override wins
  if (!Object.keys(patch).length) throw apiError_('BAD_INPUT', 'ไม่มีข้อมูลให้แก้ไข');
  if (String(r.o.Status) === 'CANCELLED') patch.Status = 'UNPAID';    // editing revives a cancelled row
  updateRow_(r.sh, r.o._row, patch);
  otBust_();
  return Object.assign({ otId: p.otId }, patch);
}

function handleAdminCancelOT(p) {
  p = p || {};
  var r = otRow_(p.otId);
  if (String(r.o.Status) === 'PAID') throw apiError_('ALREADY_PAID', 'รายการนี้ชำระแล้ว ยกเลิกไม่ได้');
  updateRow_(r.sh, r.o._row, { Status: 'CANCELLED' });
  otBust_();
  return { otId: p.otId, status: 'CANCELLED' };
}

function handleAdminRestoreOT(p) {
  p = p || {};
  var r = otRow_(p.otId);
  if (String(r.o.Status) !== 'CANCELLED') throw apiError_('BAD_INPUT', 'รายการนี้ไม่ได้ถูกยกเลิก');
  updateRow_(r.sh, r.o._row, { Status: 'UNPAID' });
  otBust_();
  return { otId: p.otId, status: 'UNPAID' };
}
