/**
 * BillRun.gs — undoing a bulk bill run, in place.
 *
 * Asked 2026-09-30: "หากดำเนินการผิดพลาดจะต้องเรียกการออกบิลทั้งหมดย้อนกลับได้" — after the ผอ.
 * re-ran September to see what the screen looked like and had no way to find out what that had done.
 *
 * 🔴 WHY THIS ROUTE HAS TO EXIST AT ALL, rather than the engine's undoBillRun being the live path.
 *
 * BILLING is in NO_SHRINK_SHEETS (GasEngine.gs). Any full-collection rewrite that makes that sheet
 * SHORTER aborts with WRITE_GUARD — deliberately, because a shrink there is how a stale or partial
 * read destroys a school's billing history. The engine's version removes rows from M.payments, so on
 * GAS it would be refused by the guard and the button would simply never work. Every legitimate
 * deletion from a protected sheet goes through an explicit in-place route; handleDeleteBill is the
 * one that already existed, and this is the batch of it.
 *
 * The engine's undoBillRun is still the statement of the RULE (and what the mock build and the tests
 * run on). This file must keep agreeing with it; tools/test_bill_undo.js pins both.
 *
 * WHAT IT MAY REMOVE — the school's decision, 2026-09-30: "ข้ามใบนั้นไป ลบที่เหลือ แล้วรายงานว่าข้ามใคร".
 * A bill the family has acted on is no longer a row the school created: it is a record of money, and
 * deleting it would delete the evidence. Those are skipped and named, never deleted, and never a
 * reason to refuse the rest.
 */

/** Every field that means "this bill is not untouched any more". */
function billTouched_(b, hasSlip) {
  if (hasSlip) return true;
  if (String(b.Status || '').toUpperCase() !== 'UNPAID') return true;
  if (num_(b.SlipAmount) > 0) return true;
  if (String(b.VerifiedStatus || '').trim()) return true;
  if (String(b.PaidDate || '').trim()) return true;
  return false;
}

/** Bills grouped by the bulk run that created them. Rows with no BillRun are hand-issued and invisible here. */
function billRunsOf_(sh, month) {
  var runs = {};
  readObjects_(sh).forEach(function (b) {
    var r = String(b.BillRun || ''); if (!r) return;
    if (month && ym7_(b.Month) !== ym7_(month)) return;
    (runs[r] = runs[r] || []).push(b);
  });
  return runs;
}

/** Which bills already carry a slip — a slip can sit there unconfirmed and still be a record of money. */
function billsWithSlips_() {
  var out = {};
  try {
    readObjects_(sheet_(getMainSpreadsheet_(), 'PAYMENT_SLIPS')).forEach(function (s) {
      if (String(s.RefKind || '') === 'bill') out[String(s.RefID || '')] = 1;
    });
  } catch (e) {}
  return out;
}

/**
 * THE LAST BULK RUN — what it made, and what could still be taken back.
 * Read-only on purpose: showing what would be removed and removing it are different questions, and
 * an undo that cannot be inspected first is another button somebody presses to find out what it does.
 */
function handleBillRunLast(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'BILLING');
  try { ensureColumns_(sh, ['BillRun']); } catch (e) {}
  var month = p.month ? ym7_(p.month) : '';
  var runs = billRunsOf_(sh, month);
  var ids = Object.keys(runs).sort();          // the id carries its own timestamp, so this sorts by time
  if (!ids.length) return { found: false, month: month || null };

  var runId = ids[ids.length - 1], rows = runs[runId];
  var slips = billsWithSlips_();
  var stuSh = sheet_(getMainSpreadsheet_(), 'STUDENTS');
  var stu = {};
  readObjects_(stuSh).forEach(function (s) { stu[String(s.StudentID)] = s; });

  var view = function (b) {
    var s = stu[String(b.StudentID)] || {};
    return { billingId: b.BillingID, studentId: b.StudentID, nick: s.Nickname || '',
      name: s.NameTH || s.Name || '', className: s.Class || '', amount: num_(b.Amount),
      status: String(b.Status || ''), slipAmount: num_(b.SlipAmount), verified: String(b.VerifiedStatus || '') };
  };
  var removable = [], keep = [];
  rows.forEach(function (b) {
    (billTouched_(b, !!slips[String(b.BillingID)]) ? keep : removable).push(view(b));
  });
  var amount = 0; removable.forEach(function (x) { amount += x.amount; });
  return { found: true, runId: runId, month: ym7_(rows[0].Month),
    when: runId.replace(/^BR-\d{4}-\d{2}-/, ''),
    total: rows.length, removable: removable, keep: keep, amount: round2_(amount) };
}

/**
 * ...and taking it back. Rows are deleted BOTTOM-UP: deleteRow shifts every row below it, so
 * ascending order would delete the wrong rows from the second one onward — the same trap the
 * payslip de-duplicator had to be written around.
 */
function handleUndoBillRun(p) {
  p = p || {};
  var runId = String(p.runId || '').trim();
  if (!runId) throw apiError_('BAD_INPUT', 'ไม่ได้ระบุรอบการออกบิล');
  if (p.confirm !== true) throw apiError_('NEED_CONFIRM', 'ต้องยืนยันก่อนย้อนกลับการออกบิล');

  var info = handleBillRunLast({});
  /* The id is CHECKED, not assumed. The admin may have had this screen open while another run
   * happened — "undo the latest" must never mean a run they have not looked at. */
  if (!info.found || info.runId !== runId) {
    throw apiError_('RUN_CHANGED', 'รอบการออกบิลเปลี่ยนไปแล้ว — กรุณาเปิดหน้านี้ใหม่');
  }

  var sh = sheet_(getMainSpreadsheet_(), 'BILLING');
  var drop = {};
  info.removable.forEach(function (x) { drop[String(x.billingId)] = 1; });

  var rows = readObjects_(sh).filter(function (b) { return drop[String(b.BillingID)]; })
    .map(function (b) { return b._row; })
    .sort(function (a, b) { return b - a; });    // bottom-up — see the note above

  rows.forEach(function (r) { sh.deleteRow(r); });
  recCacheBust_('BILLING');
  // (userId, action, tableName, recordId) — the order logAudit actually takes; getting it backwards
  // files the deletion under a user called "BILL_UNDO", which is worse than not logging it
  try {
    logAudit(p.adminId || p.staffId || 'admin', 'BILL_UNDO', 'BILLING',
      runId + ' — ย้อนกลับ ' + rows.length + ' ใบ เดือน ' + info.month + ' รวม ฿' + info.amount +
      (info.keep.length ? ' (ข้าม ' + info.keep.length + ' ใบที่ชำระ/แนบสลิปแล้ว)' : ''));
  } catch (e) {}
  return { ok: true, runId: runId, month: info.month, removed: rows.length,
    skipped: info.keep, amount: info.amount };
}
