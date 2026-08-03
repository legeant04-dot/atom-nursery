/**
 * PaySlips.gs — payment slips with Drive storage + SlipOK verification + partial payments.
 * ------------------------------------------------------------------
 * Each attached slip becomes ONE PAYMENT_SLIPS row (image saved to the SlipsFolderName Drive
 * folder, shared anyone-with-link so it renders in the app). A bill/OT/prepay can have MANY slips.
 * Admin confirms slips ONE AT A TIME; when the confirmed total ≥ due the target flips to PAID,
 * otherwise it stays PARTIAL and the parent can attach more. All target-row writes are in-place
 * (updateRow_) so nothing rewrites a whole collection.
 */
function paySlipsSheet_() {
  var ss = getMainSpreadsheet_();
  var sh = ss.getSheetByName('PAYMENT_SLIPS');
  if (!sh) {
    sh = ss.insertSheet('PAYMENT_SLIPS');
    sh.appendRow(['SlipID', 'RefKind', 'RefID', 'StudentID', 'Amount', 'Url', 'FileId', 'Verified', 'TransRef', 'Receiver', 'SubmittedDate', 'Status']);
  }
  return sh;
}

function paySlipToDrive_(b64, name) {
  var folderName = getConfig_('SlipsFolderName', 'AtomNursery_Slips');
  var it = DriveApp.getFoldersByName(folderName);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name || ('slip-' + Date.now() + '.jpg'));
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  // thumbnail URL renders reliably in an <img> (the /uc?export=view form often 302s)
  return { fileId: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000' };
}

// normalise SlipOK's transDate (e.g. "2026-07-25" or "25/07/2026" or ISO) to YYYY-MM-DD for the receipt
function paySlipTransDate_(v) {
  var s = String(v || '').trim(); if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  try { var d = new Date(s); if (!isNaN(d)) return Utilities.formatDate(d, getConfig_('Timezone', 'Asia/Bangkok'), 'yyyy-MM-dd'); } catch (e) {}
  return '';
}
function paySlipVerify_(p, due) {
  try {
    var b64 = p.slipData ? (String(p.slipData).indexOf(',') >= 0 ? String(p.slipData).split(',')[1] : String(p.slipData)) : '';
    var v = handleVerifySlip({ qrData: p.qrData, slipBase64: b64, slipUrl: p.slipUrl, amount: (p.slipAmount || due) });
    if (v && v.available) return { verified: v.ok ? 'YES' : ('NO:' + (v.code || v.message || 'unverified')), ref: v.ref || '', receiver: (v.receiver && v.receiver.name) || '', transDate: paySlipTransDate_(v.transDate) };
  } catch (e) {}
  return { verified: '', ref: '', receiver: '', transDate: '' };
}

// Sheets coerces a 'YYYY-MM' cell to date 'YYYY-MM-01', so compare months by first 7 chars.
// An OT row is billable only while it is neither PAID nor CANCELLED (admin can cancel an OT charge).
function pmOtOpen_(status) { var s = String(status || ''); return s !== 'PAID' && s !== 'CANCELLED'; }
function pmYm_(v) { return String(v == null ? '' : v).slice(0, 7); }
// a monthly bill covers TUITION ONLY now — extra charges + OT are each their own payable item.
function paySlipBillDue_(b) { return Number(b.Amount || 0); }

function paySlipTarget_(kind, refId) {
  var ss = getMainSpreadsheet_();
  if (kind === 'bill') { var sb = sheet_(ss, 'BILLING'); var b = findObject_(sb, function (x) { return String(x.BillingID) === String(refId); }); return b ? { sheet: sb, row: b._row, obj: b, due: paySlipBillDue_(b), studentId: b.StudentID } : null; }
  if (kind === 'ot') { var so = sheet_(ss, 'OT_DAILY'); var o = findObject_(so, function (x) { return String(x.OTID) === String(refId); }); return o ? { sheet: so, row: o._row, obj: o, due: Number(o.Amount || 0), studentId: o.StudentID } : null; }
  if (kind === 'charge') { var sc = sheet_(ss, 'STUDENT_CHARGES'); var c = findObject_(sc, function (x) { return String(x.ChargeID) === String(refId); }); return c ? { sheet: sc, row: c._row, obj: c, due: Number(c.Amount || 0), studentId: c.StudentID } : null; }
  if (kind === 'prepay') { var sp = sheet_(ss, 'PREPAYMENTS'); var pp = findObject_(sp, function (x) { return String(x.PrepayID) === String(refId); }); return pp ? { sheet: sp, row: pp._row, obj: pp, due: Number(pp.Amount || 0), studentId: pp.StudentID } : null; }
  return null;
}

function paySlipSum_(kind, refId, statuses) {
  var sum = 0;
  readObjects_(paySlipsSheet_()).forEach(function (s) {
    if (String(s.RefKind) === kind && String(s.RefID) === String(refId) && statuses.indexOf(String(s.Status)) >= 0) sum += Number(s.Amount || 0);
  });
  return sum;
}

function paySlipRecord_(kind, refId, p) {
  var tgt = paySlipTarget_(kind, refId);
  if (!tgt) throw apiError_('NOT_FOUND', 'ไม่พบรายการ');
  var amt = Number(p.slipAmount || 0);
  var drive = { url: '', fileId: '' };
  if (p.slipData) { var b64 = String(p.slipData).indexOf(',') >= 0 ? String(p.slipData).split(',')[1] : String(p.slipData); if (b64) drive = paySlipToDrive_(b64, p.slipName || ('slip-' + refId + '.jpg')); }
  var vr = paySlipVerify_(p, tgt.due);
  var slipId = 'SL-' + Date.now();
  var sh0 = paySlipsSheet_(); ensureColumns_(sh0, ['TransDate']);
  appendObject_(sh0, { SlipID: slipId, RefKind: kind, RefID: refId, StudentID: tgt.studentId, Amount: amt,
    Url: drive.url, FileId: drive.fileId, Verified: vr.verified, TransRef: vr.ref, Receiver: vr.receiver, TransDate: vr.transDate || '', SubmittedDate: nowStr_(), Status: 'SUBMITTED' });
  recCacheBust_('PAYMENT_SLIPS');
  var submitted = paySlipSum_(kind, refId, ['SUBMITTED', 'CONFIRMED']);
  var confirmed = paySlipSum_(kind, refId, ['CONFIRMED']);
  // record the slip's actual transfer date (from SlipOK) as the payment date when we have it
  updateRow_(tgt.sheet, tgt.row, { Status: 'PENDING_VERIFY', SlipAmount: submitted, PaymentMethod: 'transfer', TransactionDate: vr.transDate || nowStr_() });
  paySlipBustTarget_(kind);
  return { ok: true, slipId: slipId, due: tgt.due, paidSoFar: submitted, outstanding: Math.max(0, tgt.due - confirmed), amountMatch: submitted >= tgt.due, verified: vr.verified };
}

// Audit (and optionally repair) bills wrongly marked fully PAID/PREPAID by the OLD prepay logic
// (before prepay was changed to cover TUITION ONLY). {apply:true} resets those bills so the current
// tuition-credit logic takes over (extras become due again). Admin-only. Read-only without apply.
function handlePrepayAudit(p) {
  p = p || {};
  var ss = getMainSpreadsheet_();
  var pps = readObjects_(sheet_(ss, 'PREPAYMENTS')).filter(function (x) { return String(x.Status) === 'PAID'; });
  var billSh = sheet_(ss, 'BILLING');
  var bills = readObjects_(billSh);
  var students = readObjects_(sheet_(ss, 'STUDENTS'));
  function sName(id) { for (var i = 0; i < students.length; i++) if (String(students[i].StudentID) === String(id)) return students[i].Nickname || students[i].Name || id; return id; }
  var flagged = [], repaired = 0;
  pps.forEach(function (pp) {
    var cov = pp.Covered; if (typeof cov === 'string') { try { cov = JSON.parse(cov); } catch (e) { cov = []; } }
    cov = (cov || []).map(function (m) { return String(m).slice(0, 7); });
    bills.forEach(function (b) {
      if (String(b.StudentID) === String(pp.StudentID) && cov.indexOf(String(b.Month).slice(0, 7)) >= 0 &&
          (String(b.VerifiedStatus) === 'PREPAID' || String(b.Status) === 'PAID')) {
        flagged.push({ student: sName(pp.StudentID), prepayId: pp.PrepayID, month: String(b.Month).slice(0, 7),
          billingId: b.BillingID, status: b.Status, verified: b.VerifiedStatus, amount: Number(b.Amount || 0) });
        // repair ONLY the bug's marker (VerifiedStatus PREPAID); never touch a bill the family truly paid.
        if (p.apply && String(b.VerifiedStatus) === 'PREPAID') { updateRow_(billSh, b._row, { Status: 'UNPAID', VerifiedStatus: '', PaidDate: '' }); repaired++; }
      }
    });
  });
  if (p.apply) recCacheBust_('BILLING');
  return { prepaysPaid: pps.length, flaggedBills: flagged.length, repaired: repaired, applied: !!p.apply, items: flagged.slice(0, 200) };
}

/**
 * ONE transfer slip paying several siblings' bills. The ticked bills are summed; the slip amount MUST
 * equal that total, else AMOUNT_MISMATCH (the client shows a red overlay and blocks). The slip image is
 * uploaded to Drive ONCE and every bill gets its own PAYMENT_SLIPS row (its share) sharing a SlipGroup,
 * so Admin sees they are one transfer. Every bill's student must belong to the caller (parentOwnsStudent_).
 * payload: { bills:[billingId…], slipAmount, slipName, slipData, qrData? }  (uid injected by applyIdentity_)
 */
function handlePayCombined(p) {
  p = p || {};
  // items: [{kind:'bill'|'charge'|'ot', id}] (legacy: p.bills = bill ids)
  var list = Array.isArray(p.items) ? p.items : ((p.bills || []).map(function (id) { return { kind: 'bill', id: id }; }));
  list = list.filter(function (x) { return x && x.id; });
  if (!list.length) throw apiError_('BAD_INPUT', 'ยังไม่ได้เลือกรายการ');
  var uid = p.uid || p.lineUID || '';
  var items = list.map(function (it) {
    var kind = it.kind || 'bill';
    var tgt = paySlipTarget_(kind, it.id);
    if (!tgt) throw apiError_('NOT_FOUND', 'ไม่พบรายการ ' + it.id);
    if (uid && !parentOwnsStudent_(uid, tgt.studentId)) throw apiError_('NO_PERMISSION', 'รายการนี้ไม่ใช่ของบุตรหลานท่าน');
    var confirmed = paySlipSum_(kind, it.id, ['CONFIRMED']);
    return { kind: kind, id: it.id, tgt: tgt, out: Math.max(0, tgt.due - confirmed) };
  });
  var total = Math.round(items.reduce(function (a, x) { return a + x.out; }, 0));
  var amt = Math.round(Number(p.slipAmount || 0));
  if (Math.abs(amt - total) > 0.5) throw apiError_('AMOUNT_MISMATCH', 'ยอดชำระ ฿' + amt + ' ไม่ตรงกับยอดรวมในระบบ ฿' + total);

  // upload the slip image ONCE, verify it ONCE against the full total
  var drive = { url: '', fileId: '' };
  if (p.slipData) { var b64 = String(p.slipData).indexOf(',') >= 0 ? String(p.slipData).split(',')[1] : String(p.slipData); if (b64) drive = paySlipToDrive_(b64, p.slipName || ('slip-combined.jpg')); }
  var vr = paySlipVerify_(p, total);
  var groupId = 'SG-' + Date.now();
  var sh = paySlipsSheet_(); ensureColumns_(sh, ['SlipGroup', 'TransDate']);
  var names = [];
  var seen = {};
  items.forEach(function (x, i) {
    appendObject_(sh, { SlipID: 'SL-' + Date.now() + '-' + i, RefKind: x.kind, RefID: x.id, StudentID: x.tgt.studentId, Amount: x.out,
      Url: drive.url, FileId: drive.fileId, Verified: vr.verified, TransRef: vr.ref, Receiver: vr.receiver, TransDate: vr.transDate || '', SubmittedDate: nowStr_(), Status: 'SUBMITTED', SlipGroup: groupId });
    var submitted = paySlipSum_(x.kind, x.id, ['SUBMITTED', 'CONFIRMED']);
    updateRow_(x.tgt.sheet, x.tgt.row, { Status: 'PENDING_VERIFY', SlipAmount: submitted, PaymentMethod: 'transfer', TransactionDate: vr.transDate || nowStr_() });
    if (!seen[x.tgt.studentId]) { seen[x.tgt.studentId] = 1;
      var st = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return String(s.StudentID) === String(x.tgt.studentId); });
      names.push(st ? (st.Nickname || st.Name || x.tgt.studentId) : x.tgt.studentId); }
  });
  recCacheBust_('PAYMENT_SLIPS'); recCacheBust_('BILLING'); recCacheBust_('OT_DAILY'); recCacheBust_('STUDENT_CHARGES');
  try { notifyAdmins_('💳 สลิปรวม ' + names.length + ' คน (' + names.join(', ') + ') · ' + items.length + ' รายการ · ฿' + total + ' — รอตรวจสอบ', { kind: 'combined_slip' }); } catch (e) {}
  return { ok: true, groupId: groupId, total: total, count: items.length };
}

function handleUploadSlip(p) { return paySlipRecord_('bill', p.billingId, p); }
function handlePayOT(p) { return paySlipRecord_('ot', p.otId, p); }
function handlePayCharge(p) { return paySlipRecord_('charge', p.chargeId, p); }
function handlePayPrepay(p) { return paySlipRecord_('prepay', p.prepayId, p); }

/**
 * Admin records money received OUTSIDE the app — cash at the desk, or a transfer already seen in the
 * bank — against any payable. It becomes a CONFIRMED slip row with no image, so the outstanding
 * balance drops at once and it appears in the payment history like every other payment.
 *
 * This is what lets a mixed payment reconcile: the enrolment fee paid in cash is recorded here, so
 * the slip the parent uploads only has to cover what is genuinely left.
 */
function handleRecordCashPayment(p) {
  p = p || {};
  var kind = String(p.kind || '');
  var tgt = paySlipTarget_(kind, p.refId);
  if (!tgt) throw apiError_('NOT_FOUND', 'ไม่พบรายการที่จะรับชำระ');
  var amt = Math.round((Number(p.amount) || 0) * 100) / 100;
  if (!(amt > 0)) throw apiError_('BAD_INPUT', 'ระบุจำนวนเงินที่รับมา');
  var already = paySlipSum_(kind, p.refId, ['CONFIRMED']);
  if (already + amt > tgt.due + 0.5) {
    throw apiError_('OVERPAY', 'รับชำระเกินยอด — ค้างอยู่ ' + Math.max(0, tgt.due - already) + ' บาท');
  }
  var sh = paySlipsSheet_();
  try { ensureColumns_(sh, ['SlipGroup', 'TransDate', 'Method']); } catch (e) {}
  var when = String(p.date || dateStr_(new Date())).slice(0, 10);
  var method = String(p.method || 'cash');
  appendObject_(sh, {
    SlipID: 'SL-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    RefKind: kind, RefID: p.refId, StudentID: tgt.studentId, Amount: amt,
    Url: '', FileId: '', Verified: 'MANUAL', TransRef: p.note || '',
    Receiver: p.adminName || 'admin', SubmittedDate: nowStr_(), TransDate: when,
    Status: 'CONFIRMED', SlipGroup: '', Method: method
  });
  paySlipRecompute_(kind, p.refId, when);
  try { logAudit(p.adminId || 'admin', 'CASH_PAYMENT', String(kind).toUpperCase(), p.refId + ' ' + amt); } catch (e) {}
  var confirmed = paySlipSum_(kind, p.refId, ['CONFIRMED']);
  return { ok: true, kind: kind, refId: p.refId, amount: amt, due: tgt.due,
    paidSoFar: confirmed, outstanding: Math.max(0, tgt.due - confirmed) };
}

function handleConfirmSlip(p) {
  var sh = paySlipsSheet_();
  var sl = findObject_(sh, function (x) { return String(x.SlipID) === String(p.slipId); });
  if (!sl) throw apiError_('NOT_FOUND', 'ไม่พบสลิป');
  updateRow_(sh, sl._row, { Status: 'CONFIRMED' });
  recCacheBust_('PAYMENT_SLIPS');
  paySlipRecompute_(String(sl.RefKind), sl.RefID, p.paidDate);
  var confirmed = paySlipSum_(String(sl.RefKind), sl.RefID, ['CONFIRMED']);
  var tgt = paySlipTarget_(String(sl.RefKind), sl.RefID);
  return { ok: true, confirmed: confirmed, due: tgt ? tgt.due : 0, outstanding: tgt ? Math.max(0, tgt.due - confirmed) : 0 };
}

function handleRejectSlip(p) {
  var sh = paySlipsSheet_();
  var sl = findObject_(sh, function (x) { return String(x.SlipID) === String(p.slipId); });
  if (!sl) throw apiError_('NOT_FOUND', 'ไม่พบสลิป');
  updateRow_(sh, sl._row, { Status: 'REJECTED' });
  recCacheBust_('PAYMENT_SLIPS');
  paySlipRecompute_(String(sl.RefKind), sl.RefID, null);
  return { ok: true };
}

// recompute a target's status from its confirmed/submitted slip totals (in-place, incl. cascades)
function paySlipRecompute_(kind, refId, paidDate) {
  var tgt = paySlipTarget_(kind, refId); if (!tgt) return;
  var confirmed = paySlipSum_(kind, refId, ['CONFIRMED']);
  var submitted = paySlipSum_(kind, refId, ['SUBMITTED', 'CONFIRMED']);
  var ss = getMainSpreadsheet_();
  if (confirmed >= tgt.due && tgt.due > 0) {
    var pd = paidDate || nowStr_().slice(0, 10);
    updateRow_(tgt.sheet, tgt.row, { Status: 'PAID', PaidDate: pd, SlipAmount: confirmed, VerifiedStatus: 'CONFIRMED' });
    // bill now covers TUITION ONLY — do NOT cascade OT/charges to PAID (each is paid on its own).
    // prepay: tuition-only — do NOT flip the covered months' bills to PAID (that would waive the extras).
    // The prepay row itself is PAID here; the engine's `payments` read credits the tuition per month.
    if (kind === 'prepay') { /* covered-bill marking intentionally removed — advance payment covers tuition only */ }
  } else if (confirmed > 0) {
    updateRow_(tgt.sheet, tgt.row, { Status: 'PARTIAL', SlipAmount: submitted });
  } else if (submitted > 0) {
    updateRow_(tgt.sheet, tgt.row, { Status: 'PENDING_VERIFY', SlipAmount: submitted });
  } else {
    updateRow_(tgt.sheet, tgt.row, { Status: 'UNPAID', SlipAmount: 0, VerifiedStatus: 'REJECTED' });
  }
  paySlipBustTarget_(kind);
}

// An in-place updateRow_ does NOT invalidate the GasEngine sheet cache, so the slip list the app
// reads back was served stale for up to CacheTTL after a confirm/reject — the admin approved a slip,
// reopened the bill, and saw the old state (or nothing) until the cache expired. Bust the slip sheet
// itself, not only the thing being paid for. STUDENT_CHARGES was missing from the target map too.
function paySlipBustTarget_(kind) {
  recCacheBust_('PAYMENT_SLIPS');
  recCacheBust_(kind === 'bill' ? 'BILLING' : kind === 'ot' ? 'OT_DAILY' : kind === 'charge' ? 'STUDENT_CHARGES' : 'PREPAYMENTS');
}
