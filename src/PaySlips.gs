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

function paySlipVerify_(p, due) {
  try {
    var b64 = p.slipData ? (String(p.slipData).indexOf(',') >= 0 ? String(p.slipData).split(',')[1] : String(p.slipData)) : '';
    var v = handleVerifySlip({ qrData: p.qrData, slipBase64: b64, slipUrl: p.slipUrl, amount: (p.slipAmount || due) });
    if (v && v.available) return { verified: v.ok ? 'YES' : ('NO:' + (v.code || v.message || 'unverified')), ref: v.ref || '', receiver: (v.receiver && v.receiver.name) || '' };
  } catch (e) {}
  return { verified: '', ref: '', receiver: '' };
}

// Sheets coerces a 'YYYY-MM' cell to date 'YYYY-MM-01', so compare months by first 7 chars.
// An OT row is billable only while it is neither PAID nor CANCELLED (admin can cancel an OT charge).
function pmOtOpen_(status) { var s = String(status || ''); return s !== 'PAID' && s !== 'CANCELLED'; }
function pmYm_(v) { return String(v == null ? '' : v).slice(0, 7); }
function paySlipBillDue_(b) {
  var amount = Number(b.Amount || 0), charges = 0, ot = 0, ss = getMainSpreadsheet_(), bm = pmYm_(b.Month);
  readObjects_(sheet_(ss, 'STUDENT_CHARGES')).forEach(function (c) {
    if (String(c.StudentID) === String(b.StudentID) && pmYm_(c.Month) === bm) charges += Number(c.Amount || 0);
  });
  readObjects_(sheet_(ss, 'OT_DAILY')).forEach(function (o) {
    if (String(o.StudentID) === String(b.StudentID) && pmYm_(o.Date) === bm && pmOtOpen_(o.Status)) ot += Number(o.Amount || 0);
  });
  return amount + charges + ot;
}

function paySlipTarget_(kind, refId) {
  var ss = getMainSpreadsheet_();
  if (kind === 'bill') { var sb = sheet_(ss, 'BILLING'); var b = findObject_(sb, function (x) { return String(x.BillingID) === String(refId); }); return b ? { sheet: sb, row: b._row, obj: b, due: paySlipBillDue_(b), studentId: b.StudentID } : null; }
  if (kind === 'ot') { var so = sheet_(ss, 'OT_DAILY'); var o = findObject_(so, function (x) { return String(x.OTID) === String(refId); }); return o ? { sheet: so, row: o._row, obj: o, due: Number(o.Amount || 0), studentId: o.StudentID } : null; }
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
  appendObject_(paySlipsSheet_(), { SlipID: slipId, RefKind: kind, RefID: refId, StudentID: tgt.studentId, Amount: amt,
    Url: drive.url, FileId: drive.fileId, Verified: vr.verified, TransRef: vr.ref, Receiver: vr.receiver, SubmittedDate: nowStr_(), Status: 'SUBMITTED' });
  recCacheBust_('PAYMENT_SLIPS');
  var submitted = paySlipSum_(kind, refId, ['SUBMITTED', 'CONFIRMED']);
  var confirmed = paySlipSum_(kind, refId, ['CONFIRMED']);
  updateRow_(tgt.sheet, tgt.row, { Status: 'PENDING_VERIFY', SlipAmount: submitted, PaymentMethod: 'transfer', TransactionDate: nowStr_() });
  paySlipBustTarget_(kind);
  return { ok: true, slipId: slipId, due: tgt.due, paidSoFar: submitted, outstanding: Math.max(0, tgt.due - confirmed), amountMatch: submitted >= tgt.due, verified: vr.verified };
}

function handleUploadSlip(p) { return paySlipRecord_('bill', p.billingId, p); }
function handlePayOT(p) { return paySlipRecord_('ot', p.otId, p); }
function handlePayPrepay(p) { return paySlipRecord_('prepay', p.prepayId, p); }

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
    if (kind === 'bill') {
      var so = sheet_(ss, 'OT_DAILY'), bm = pmYm_(tgt.obj.Month);
      readObjects_(so).forEach(function (o) { if (String(o.StudentID) === String(tgt.obj.StudentID) && pmYm_(o.Date) === bm && pmOtOpen_(o.Status)) updateRow_(so, o._row, { Status: 'PAID', PaidDate: pd }); });
      recCacheBust_('OT_DAILY');
    }
    if (kind === 'prepay') {
      var covered = tgt.obj.Covered; if (typeof covered === 'string') { try { covered = JSON.parse(covered); } catch (e) { covered = []; } }
      covered = (covered || []).map(pmYm_);
      var sb = sheet_(ss, 'BILLING');
      readObjects_(sb).forEach(function (b) { if (String(b.StudentID) === String(tgt.obj.StudentID) && covered.indexOf(pmYm_(b.Month)) >= 0) updateRow_(sb, b._row, { Status: 'PAID', PaidDate: pd, VerifiedStatus: 'PREPAID' }); });
      recCacheBust_('BILLING');
    }
  } else if (confirmed > 0) {
    updateRow_(tgt.sheet, tgt.row, { Status: 'PARTIAL', SlipAmount: submitted });
  } else if (submitted > 0) {
    updateRow_(tgt.sheet, tgt.row, { Status: 'PENDING_VERIFY', SlipAmount: submitted });
  } else {
    updateRow_(tgt.sheet, tgt.row, { Status: 'UNPAID', SlipAmount: 0, VerifiedStatus: 'REJECTED' });
  }
  paySlipBustTarget_(kind);
}

function paySlipBustTarget_(kind) { recCacheBust_(kind === 'bill' ? 'BILLING' : kind === 'ot' ? 'OT_DAILY' : 'PREPAYMENTS'); }
