/**
 * PayAdjust.gs — approving a payslip, and changing what somebody is paid.
 *
 * Asked 2026-10-05 with the annual review: "ปรับเงินเดือน/ตำแหน่ง/เบี้ยต่างๆในนี้" and "ให้ Approve
 * ข้อมูลก่อนจะบันทึกให้คุณครู".
 *
 * 🔴 WHY THESE ARE ROUTES AND NOT LEFT TO THE ENGINE.
 *
 * STAFF and PAYROLL are both written by the engine as WHOLE COLLECTIONS, and STAFF is in
 * NO_SHRINK_SHEETS besides. A pay rise that went out through a collection rewrite would carry every
 * other row on the sheet with it, read from whatever the request happened to hydrate — the exact
 * shape of the 2026-07-09 wipe. Every write here is one row, by its own row number.
 *
 * The engine's versions remain the statement of the rules (and are what mock mode and the tests run
 * on); tools/test_pay_adjust.js pins the two sides against each other.
 */

/** The admin's own name, for the trail. A history that says "ADM" is a history nobody can read. */
function adjActorName_(staffId) {
  try {
    var s = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'),
      function (x) { return String(x.StaffID) === String(staffId); });
    return s ? (s.Name || s.NameTH || String(staffId)) : String(staffId || '');
  } catch (e) { return String(staffId || ''); }
}

/**
 * APPROVE (or take back) a month's payslip.
 *
 * Approving is what puts the slip on the teacher's screen — handleGetPayslip refuses an unapproved
 * row to any non-admin caller. Un-approving is deliberately allowed: it is the honest way to correct
 * a mistake, because it takes the slip back off their screen instead of editing a figure underneath
 * somebody who has already read it. Both directions are audited.
 */
function handleApprovePayslip(p) {
  p = p || {};
  var sid = String(p.targetId || p.staffId || '').trim();
  var month = ym7_(p.month || '');
  if (!sid || !month) throw apiError_('BAD_INPUT', 'ต้องระบุพนักงานและเดือน');

  var sh = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  try { ensureColumns_(sh, ['Approved', 'ApprovedBy', 'ApprovedAt']); } catch (e) {}
  var row = findObject_(sh, function (r) {
    return String(r.StaffID) === sid && ym7_(r.Month) === month;
  });
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีสลิปของเดือนนี้ — กดบันทึกก่อน');

  var on = p.approve !== false;
  var at = on ? (dateStr_(new Date()) + ' ' + timeStr_(new Date())) : '';
  // 'NO', not '' — see the note on the engine's approvePayslip. Clearing the field would make a
  // withdrawn slip look like a row from before the column existed, which the gate lets through.
  updateRow_(sh, row._row, { Approved: on ? 'YES' : 'NO', ApprovedBy: on ? String(p.adminId || '') : '', ApprovedAt: at });
  recCacheBust_('PAYROLL');
  try {
    logAuditHr(p.adminId || 'admin', on ? 'PAYSLIP_APPROVE' : 'PAYSLIP_UNAPPROVE', 'PAYROLL',
      String(row.PayrollID || '') + ' ' + sid + ' ' + month);
  } catch (e) {}
  return { ok: true, staffId: sid, month: month, approved: on, approvedAt: at };
}

/**
 * CHANGE WHAT SOMEBODY IS PAID — and write down why.
 *
 * One PAY_ADJUSTMENTS row per FIELD changed. "ขึ้นเงินเดือนและเลื่อนตำแหน่ง" on the same day is two
 * facts that get asked about separately a year later, and one row holding both can only answer one
 * of them. A field whose value did not actually change writes nothing: a history full of
 * "14300 → 14300" is a history nobody reads.
 *
 * The CURRENT figures stay where every other screen already reads them — STAFF for the salary and
 * the position, PAYROLL_CONFIG for the allowances. This adds the trail; it does not become a second
 * source of truth for what somebody is paid.
 */
function handleAdjustStaffPay(p) {
  p = p || {};
  var sid = String(p.targetId || '').trim();
  var reason = String(p.reason || '').trim();
  if (!sid) throw apiError_('BAD_INPUT', 'ต้องระบุพนักงาน');
  if (!reason) throw apiError_('BAD_INPUT', 'กรุณาระบุเหตุผลของการปรับ');

  var stSh = sheet_(getHrSpreadsheet_(), 'STAFF');
  var st = findObject_(stSh, function (x) { return String(x.StaffID) === sid; });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + sid);

  var adjSh = sheet_(getHrSpreadsheet_(), 'PAY_ADJUSTMENTS');
  try { ensureColumns_(adjSh, SCHEMA[WB.HR].PAY_ADJUSTMENTS); } catch (e) {}

  var when = dateStr_(p.date ? new Date(p.date) : new Date());
  var at = dateStr_(new Date()) + ' ' + timeStr_(new Date());
  var byName = adjActorName_(p.adminId || p.staffId);
  var changes = [], rows = [], staffPatch = {};

  var note = function (field, from, to) {
    if (String(from == null ? '' : from) === String(to == null ? '' : to)) return;
    rows.push({ AdjID: 'ADJ-' + Date.now() + '-' + rows.length, StaffID: sid, Date: when, Field: field,
      FromValue: String(from == null ? '' : from), ToValue: String(to == null ? '' : to), Reason: reason,
      ByStaffID: String(p.adminId || p.staffId || ''), ByName: byName, CreatedAt: at });
    changes.push({ field: field, from: from, to: to });
  };

  if (p.baseSalary != null && p.baseSalary !== '') {
    var bs = num_(p.baseSalary);
    if (bs < 0) throw apiError_('BAD_INPUT', 'เงินเดือนต้องไม่ติดลบ');
    note('BaseSalary', num_(st.BaseSalary), bs); staffPatch.BaseSalary = bs;
  }
  if (p.position != null && String(p.position).trim() !== '') {
    var ps = String(p.position).trim();
    note('Position', String(st.Position || ''), ps); staffPatch.Position = ps;
  }
  if (p.positionLevel != null && String(p.positionLevel).trim() !== '') {
    var pl = String(p.positionLevel).trim();
    note('PositionLevel', String(st.PositionLevel || ''), pl); staffPatch.PositionLevel = pl;
  }

  /* The allowances live in PAYROLL_CONFIG, which is where the payroll screen already reads them —
   * one place, not two that can disagree. Read first so the trail records what it is replacing.
   *
   * Read and written DIRECTLY here. payrollConfig/setPayrollConfig are engine routes with no GAS
   * handler, so calling one would mean a full rewrite of the sheet from whatever this request
   * happened to hydrate — see the file header. One row, by its row number, like everything else. */
  var pcSh = sheet_(getHrSpreadsheet_(), 'PAYROLL_CONFIG');
  try { ensureColumns_(pcSh, SCHEMA[WB.HR].PAYROLL_CONFIG); } catch (e) {}
  var pcRow = findObject_(pcSh, function (x) { return String(x.StaffID) === sid; });
  var cfgNow = pcRow || {};
  var CFG = [['diligenceAttend', 'DiligenceAttendanceAmount'], ['diligenceFb', 'DiligenceFacebookAmount'],
             ['childMultiplier', 'ChildMultiplier'], ['childThreshold', 'ChildThreshold'], ['contribution', 'Contribution']];
  var cfgPatch = null;
  CFG.forEach(function (pair) {
    var k = pair[0], col = pair[1];
    if (p[k] == null || p[k] === '') return;
    var v = num_(p[k]);
    if (!(v >= 0)) throw apiError_('BAD_INPUT', 'ค่าของ ' + col + ' ไม่ถูกต้อง');
    var was = (cfgNow[col] == null || cfgNow[col] === '') ? '' : num_(cfgNow[col]);
    note(col, was, v);
    cfgPatch = cfgPatch || {};
    cfgPatch[col] = v;
  });

  if (!changes.length) throw apiError_('NO_CHANGE', 'ไม่มีรายการใดเปลี่ยนแปลง');

  // APPLY — one row at a time, never a collection rewrite (see the file header)
  if (Object.keys(staffPatch).length) { updateRow_(stSh, st._row, staffPatch); staffCacheBust_(); }
  if (cfgPatch) {
    if (pcRow) updateRow_(pcSh, pcRow._row, cfgPatch);
    else { cfgPatch.StaffID = sid; appendObject_(pcSh, cfgPatch); }
    recCacheBust_('PAYROLL_CONFIG');
  }
  rows.forEach(function (r) { appendObject_(adjSh, r); });
  recCacheBust_('PAY_ADJUSTMENTS');

  try {
    logAuditHr(p.adminId || 'admin', 'PAY_ADJUST', 'STAFF', sid + ' — ' +
      changes.map(function (c) { return c.field + ': ' + c.from + ' → ' + c.to; }).join(' · ') + ' · ' + reason);
  } catch (e) {}
  return { ok: true, staffId: sid, date: when, changes: changes, reason: reason };
}

/** The trail, newest first. A teacher may read their own; an admin may read anybody's. */
function handlePayAdjustHistory(p) {
  p = p || {};
  var sid = String(p.targetId || p.staffId || '').trim();
  if (!sid) throw apiError_('BAD_INPUT', 'ต้องระบุพนักงาน');
  /* `role` is stamped by applyIdentity_ on every non-admin session and never on an admin's, so a
   * role that is present and is not Admin is conclusive — and for those, staffId has already been
   * forced to themselves, which is what makes this comparison safe. */
  if (p.role && p.role !== 'Admin' && sid !== String(p.staffId || '')) {
    throw apiError_('NO_PERMISSION', 'ดูข้อมูลของพนักงานคนอื่นไม่ได้');
  }
  var out = [];
  try {
    readObjects_(sheet_(getHrSpreadsheet_(), 'PAY_ADJUSTMENTS')).forEach(function (a) {
      if (String(a.StaffID) !== sid) return;
      out.push({ adjId: String(a.AdjID || ''), date: payDate_(a.Date), field: String(a.Field || ''),
        from: String(a.FromValue == null ? '' : a.FromValue), to: String(a.ToValue == null ? '' : a.ToValue),
        reason: String(a.Reason || ''), by: String(a.ByName || a.ByStaffID || ''), at: String(a.CreatedAt || '') });
    });
  } catch (e) {}
  out.sort(function (x, y) { return String(y.date + y.at).localeCompare(String(x.date + x.at)); });
  return out;
}
