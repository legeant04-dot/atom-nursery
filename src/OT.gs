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

/* ---- goodwill discount (ส่วนลดพิเศษ) --------------------------------------------------------
 * The school sometimes waives part of a late-pickup charge — "200 due, pay 100 and we'll call it
 * even". That used to be done by typing 100 over the amount, which had three problems: the real
 * charge was gone so nobody could tell a discount from a miscalculation, there was no record of who
 * granted it or why, and — worst — ANY later check-out for that child recomputed the row and
 * silently put it back to 200.
 *
 * So the charge and the waiver are stored separately:
 *   FullAmount  what the late pickup actually costs (recomputed freely and safely)
 *   Discount    what the school is waiving
 *   Amount      FullAmount - Discount = what is billed  (unchanged meaning, so billing, slips,
 *               finance totals and the parent's payables all keep working untouched)
 * A recompute now only ever rewrites FullAmount and re-derives Amount; the discount survives.
 */
var OT_DISCOUNT_COLS_ = ['FullAmount', 'Discount', 'DiscountReason', 'DiscountBy', 'DiscountAt'];
function otNum_(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
/** Rows written before discounts existed have no FullAmount — their Amount IS the full charge. */
function otFullOf_(o) { var f = Number(o && o.FullAmount); return (isFinite(f) && f > 0) ? f : otNum_(o && o.Amount); }
/** A discount can never be negative, nor larger than the charge (that would be paying the parent). */
function otDiscOf_(o, full) { return Math.min(otNum_(o && o.Discount), otNum_(full)); }

/**
 * Create/refresh today's OT row for a late pickup. Returns the OT summary, or null when there is
 * nothing to charge (inside grace), or when the existing row is already PAID/CANCELLED.
 */
function otUpsertForPickup_(student, pickupHHMM, dateS) {
  var c = otComputeFor_(student, pickupHHMM);
  if (c.amount <= 0) return null;
  var sh = sheet_(getMainSpreadsheet_(), 'OT_DAILY');
  ensureColumns_(sh, OT_DISCOUNT_COLS_);
  var otId = 'OT-' + String(dateS).replace(/-/g, '') + '-' + student.StudentID;
  var ex = findObject_(sh, function (x) { return String(x.OTID) === otId; });
  if (ex) {
    var st = String(ex.Status || '');
    if (st === 'PAID' || st === 'CANCELLED') return null;          // settled — never re-charge
    // Recompute the charge, but KEEP any discount the admin granted. Overwriting Amount outright
    // is what used to wipe a goodwill discount the moment anyone re-tapped check-out.
    var disc = otDiscOf_(ex, c.amount);
    updateRow_(sh, ex._row, { PickupTime: pickupHHMM, PlanEnd: c.planEnd, LateMinutes: c.late, Hours: c.hours,
      FullAmount: c.amount, Discount: disc, Amount: Math.max(0, c.amount - disc) });
  } else {
    appendObject_(sh, { OTID: otId, Date: dateS, StudentID: student.StudentID, PickupTime: pickupHHMM,
      PlanEnd: c.planEnd, LateMinutes: c.late, Hours: c.hours, FullAmount: c.amount, Discount: 0,
      Amount: c.amount, Status: 'UNPAID', SlipRef: '', SlipAmount: 0 });
  }
  otBust_();
  return { otId: otId, lateMinutes: c.late, hours: c.hours, amount: c.amount, planEnd: c.planEnd, rate: c.rate };
}

/**
 * Re-settle an OT row against its slips after its AMOUNT changed. Returns the new status if it
 * moved, else null.
 *
 * Only called when the row actually has slips: paySlipRecompute_'s "nothing submitted" branch
 * stamps VerifiedStatus='REJECTED', which would be a lie on a row nobody has ever paid towards.
 */
function otResettle_(otId) {
  try {
    if (typeof paySlipRecompute_ !== 'function' || typeof paySlipSum_ !== 'function') return null;
    if (paySlipSum_('ot', otId, ['SUBMITTED', 'CONFIRMED']) <= 0) return null;
    var before = String(otRow_(otId).o.Status || '');
    paySlipRecompute_('ot', otId);
    otBust_();
    var after = String(otRow_(otId).o.Status || '');
    return after === before ? null : after;
  } catch (e) { return null; }
}

// ---- Admin management (admin-only via applyIdentity_ ADMIN_ONLY) ----
function otRow_(otId) {
  var sh = sheet_(getMainSpreadsheet_(), 'OT_DAILY');
  var o = findObject_(sh, function (x) { return String(x.OTID) === String(otId); });
  if (!o) throw apiError_('NOT_FOUND', 'ไม่พบรายการ OT ' + otId);
  return { sh: sh, o: o };
}

/**
 * Correct the pickup time (recomputes) and/or grant a goodwill discount. PAID rows are locked.
 *
 * payload: { otId, pickupTime?, discount?, amount?, discountReason?, staffId? }
 *   discount  — the amount to waive (what the school gives up)
 *   amount    — what the parent should actually pay; the difference from the full charge becomes
 *               the discount. This is how the admin thinks about it ("just pay 100"), and it also
 *               keeps every older client that still sends a plain amount working correctly.
 */
function handleAdminUpdateOT(p) {
  p = p || {};
  var r = otRow_(p.otId);
  if (String(r.o.Status) === 'PAID') throw apiError_('ALREADY_PAID', 'รายการนี้ชำระแล้ว แก้ไขไม่ได้');
  ensureColumns_(r.sh, OT_DISCOUNT_COLS_);

  var patch = {}, touched = false;
  var full = otFullOf_(r.o);
  if (p.pickupTime) {
    var student = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return String(s.StudentID) === String(r.o.StudentID); }) || {};
    var c = otComputeFor_(student, p.pickupTime);
    patch.PickupTime = toHHmm_(p.pickupTime); patch.PlanEnd = c.planEnd;
    patch.LateMinutes = c.late; patch.Hours = c.hours;
    full = c.amount; touched = true;
  }

  var hadStatus = String(r.o.Status || '');
  var had = otDiscOf_(r.o, otFullOf_(r.o));
  var disc = Math.min(had, full);                              // a smaller charge caps an old discount
  if (p.discount !== undefined && p.discount !== null && p.discount !== '') {
    disc = Math.min(otNum_(p.discount), full); touched = true;
  } else if (p.amount !== undefined && p.amount !== null && p.amount !== '') {
    disc = Math.min(Math.max(0, full - otNum_(p.amount)), full); touched = true;
  }
  if (!touched) {
    // Nothing to change — but the row may still be mis-settled against its slips (any discount
    // granted before this fix left the row PARTIAL even though it was fully covered). Pressing save
    // heals it instead of just refusing.
    var healed = otResettle_(p.otId);
    if (healed) return { otId: p.otId, resettled: true, status: healed, amount: otNum_(r.o.Amount) };
    throw apiError_('BAD_INPUT', 'ไม่มีข้อมูลให้แก้ไข');
  }

  patch.FullAmount = full;
  patch.Discount = disc;
  patch.Amount = Math.max(0, full - disc);
  if (disc !== had) {
    // Who granted it and why. Without this a discount is indistinguishable from a mistake, and there
    // is nothing to show if a parent or an auditor ever asks.
    patch.DiscountReason = disc > 0 ? String(p.discountReason || '').slice(0, 200) : '';
    patch.DiscountBy = disc > 0 ? String(p.staffId || p.adminId || 'ADMIN') : '';
    patch.DiscountAt = disc > 0 ? new Date() : '';
  }
  if (String(r.o.Status) === 'CANCELLED') patch.Status = 'UNPAID';    // editing revives a cancelled row
  // Waiving the whole charge leaves nothing to collect, so the row is settled, not "owing 0".
  if (patch.Amount === 0) { patch.Status = 'PAID'; patch.PaidDate = patch.PaidDate || nowStr_().slice(0, 10); }
  updateRow_(r.sh, r.o._row, patch);
  otBust_();
  // A row is only ever re-settled when a SLIP changes — never when the amount does. So a parent who
  // had already paid 100 against a 200 charge stayed PARTIAL after the discount made 100 the full
  // amount owed, and the finance screen kept showing them as still owing. Re-settle against the new
  // amount here, which is what makes the OT screen and the finance screen agree.
  otResettle_(p.otId);
  // The engine logged this; the route that shadows it never did, so on live an amount override left
  // no trace at all. Money changing by admin decision must always be traceable.
  try {
    logAudit(p.staffId || p.adminId || 'ADMIN', disc !== had ? 'OT_DISCOUNT' : 'OT_UPDATE', 'OT_DAILY',
      p.otId + ' full=' + full + ' disc=' + disc + ' net=' + patch.Amount + (patch.DiscountReason ? ' (' + patch.DiscountReason + ')' : ''));
  } catch (e) {}
  return Object.assign({ otId: p.otId, fullAmount: full, discount: disc, amount: patch.Amount }, patch);
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
