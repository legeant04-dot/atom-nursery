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
// SlipOK's transTime comes back as 'HH:mm:ss' (or sometimes with the date) — keep 'HH:mm'
function paySlipTransTime_(v) {
  var s = String(v || '').trim(); if (!s) return '';
  var m = /(\d{1,2}):(\d{2})/.exec(s);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}
function paySlipVerify_(p, due) {
  try {
    var b64 = p.slipData ? (String(p.slipData).indexOf(',') >= 0 ? String(p.slipData).split(',')[1] : String(p.slipData)) : '';
    var v = handleVerifySlip({ qrData: p.qrData, slipBase64: b64, slipUrl: p.slipUrl, amount: (p.slipAmount || due) });
    if (v && v.available) return {
      // 'NO:<code>' is a SlipOK VERDICT, not a failure to read the slip — it read it fine (that is
      // where the ref, the receiver and the transfer date come from) and then objected to something:
      // 1011 no such transaction · 1012 this slip was already used · 1013 amount differs · 1014 wrong
      // receiver account. The code is kept so the app can say WHICH, instead of a bare "ตรวจไม่ผ่าน".
      verified: v.ok ? 'YES' : ('NO:' + (v.code || v.message || 'unverified')),
      ref: v.ref || '', receiver: (v.receiver && v.receiver.name) || '',
      transDate: paySlipTransDate_(v.transDate), transTime: paySlipTransTime_(v.transTime),
      sender: v.sender || '', slipAmount: (v.amount != null ? v.amount : '')
    };
  } catch (e) {}
  return { verified: '', ref: '', receiver: '', transDate: '', transTime: '', sender: '', slipAmount: '' };
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
  var sh0 = paySlipsSheet_();
  ensureColumns_(sh0, ['TransDate', 'TransTime', 'Sender', 'Method', 'StatedDate', 'StatedTime']);
  // When the slip cannot be read, all the school could see was when the FILE was attached — which is
  // not when the money moved. The parent states it, and we keep BOTH: the verified time still wins,
  // and the stated one is clearly marked as the family's own word rather than a bank fact.
  var statedDate = paySlipTransDate_(p.statedDate), statedTime = paySlipTransTime_(p.statedTime);
  appendObject_(sh0, { SlipID: slipId, RefKind: kind, RefID: refId, StudentID: tgt.studentId, Amount: amt,
    Url: drive.url, FileId: drive.fileId, Verified: vr.verified, TransRef: vr.ref, Receiver: vr.receiver,
    // the moment the money actually MOVED, read off the slip — not the moment the file was attached
    TransDate: vr.transDate || '', TransTime: vr.transTime || '', Sender: vr.sender || '',
    StatedDate: statedDate, StatedTime: statedTime,
    Method: 'transfer', SubmittedDate: nowStr_(), Status: 'SUBMITTED' });
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
  var sh = paySlipsSheet_();
  ensureColumns_(sh, ['SlipGroup', 'TransDate', 'TransTime', 'StatedDate', 'StatedTime']);
  // what the parent said about when they transferred — the same fields as a single-item slip
  var statedDate = paySlipTransDate_(p.statedDate), statedTime = paySlipTransTime_(p.statedTime);
  var names = [];
  var seen = {};
  items.forEach(function (x, i) {
    appendObject_(sh, { SlipID: 'SL-' + Date.now() + '-' + i, RefKind: x.kind, RefID: x.id, StudentID: x.tgt.studentId, Amount: x.out,
      Url: drive.url, FileId: drive.fileId, Verified: vr.verified, TransRef: vr.ref, Receiver: vr.receiver, TransDate: vr.transDate || '', TransTime: vr.transTime || '',
      StatedDate: statedDate, StatedTime: statedTime,
      SubmittedDate: nowStr_(), Status: 'SUBMITTED', SlipGroup: groupId });
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

/**
 * The same selection, paid in CASH at the school. payload: { items:[{kind,id}], amount, paidDate }
 *
 * Money changes hands at the door as often as it goes through the bank, and a parent had no way to
 * say so — they were shown a QR for something they had already handed over, and the school had to
 * remember it by hand. This records what a slip records, minus the slip: one row per item, the
 * amount, and THE DAY THE MONEY WAS HANDED OVER (a parent may be telling us on Monday about Friday).
 *
 * It is NOT marked paid. It lands as PENDING_VERIFY with Method=cash and waits for someone at the
 * school to confirm they have the money — "paid" on the parent's word alone would leave a hole in
 * the accounts that nobody would notice. The amount must match the total exactly, the same rule a
 * transfer follows, so cash is not a way around it.
 */
function handlePayCombinedCash(p) {
  p = p || {};
  var list = (Array.isArray(p.items) ? p.items : []).filter(function (x) { return x && x.id; });
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
  var amt = Math.round(Number(p.amount || 0));
  if (Math.abs(amt - total) > 0.5) throw apiError_('AMOUNT_MISMATCH', 'ยอดชำระ ฿' + amt + ' ไม่ตรงกับยอดรวมในระบบ ฿' + total);
  var today = dateStr_(new Date());
  var paidOn = paySlipTransDate_(p.paidDate) || today;
  if (paidOn > today) throw apiError_('BAD_INPUT', 'วันที่ชำระต้องไม่เป็นวันในอนาคต');

  var groupId = 'CG-' + Date.now();
  var sh = paySlipsSheet_();
  ensureColumns_(sh, ['SlipGroup', 'TransDate', 'TransTime', 'StatedDate', 'StatedTime', 'Method']);
  var names = [], seen = {};
  items.forEach(function (x, i) {
    appendObject_(sh, { SlipID: 'SL-' + Date.now() + '-' + i, RefKind: x.kind, RefID: x.id, StudentID: x.tgt.studentId, Amount: x.out,
      Url: '', FileId: '', Verified: '', TransRef: '', Receiver: '',
      // no slip to read, so the day the parent names IS the payment date
      TransDate: paidOn, TransTime: '', StatedDate: paidOn, StatedTime: '', Method: 'cash',
      SubmittedDate: nowStr_(), Status: 'SUBMITTED', SlipGroup: groupId });
    var submitted = paySlipSum_(x.kind, x.id, ['SUBMITTED', 'CONFIRMED']);
    updateRow_(x.tgt.sheet, x.tgt.row, { Status: 'PENDING_VERIFY', SlipAmount: submitted, PaymentMethod: 'cash', TransactionDate: paidOn });
    if (!seen[x.tgt.studentId]) { seen[x.tgt.studentId] = 1;
      var st = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return String(s.StudentID) === String(x.tgt.studentId); });
      names.push(st ? (st.Nickname || st.Name || x.tgt.studentId) : x.tgt.studentId); }
  });
  recCacheBust_('PAYMENT_SLIPS'); recCacheBust_('BILLING'); recCacheBust_('OT_DAILY'); recCacheBust_('STUDENT_CHARGES');
  // the admin MUST be told: unlike a transfer, there is no bank record to find this later
  try { notifyAdmins_('💵 แจ้งชำระเงินสด ' + names.length + ' คน (' + names.join(', ') + ') · ' +
    items.length + ' รายการ · ฿' + total + ' · ชำระวันที่ ' + paidOn + ' — รอตรวจสอบ', { kind: 'cash_payment' }); } catch (e) {}
  return { ok: true, groupId: groupId, total: total, count: items.length, paidDate: paidOn, method: 'cash' };
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

/**
 * Admin deletes a payment record that has NO slip image — a double-tap that left an empty entry, or
 * a cash receipt entered by mistake. A row WITH a slip is evidence and is never deleted here; reject
 * it instead, which keeps the image and the audit trail. Recomputes the balance afterwards.
 */
function handleDeleteSlip(p) {
  p = p || {};
  var sh = paySlipsSheet_();
  var sl = findObject_(sh, function (x) { return String(x.SlipID) === String(p.slipId); });
  if (!sl) throw apiError_('NOT_FOUND', 'ไม่พบรายการชำระ');
  if (sl.Url) throw apiError_('HAS_SLIP', 'รายการนี้มีสลิปแนบอยู่ — ใช้ปุ่มปฏิเสธสลิปแทนการลบ');
  var kind = String(sl.RefKind), refId = sl.RefID, amt = Number(sl.Amount || 0);
  sh.deleteRow(sl._row);
  recCacheBust_('PAYMENT_SLIPS');
  paySlipRecompute_(kind, refId);
  try { logAudit(p.adminId || 'admin', 'SLIP_DELETE', 'PAYMENT_SLIPS', p.slipId + ' ' + amt); } catch (e) {}
  return { ok: true, kind: kind, refId: refId };
}

/**
 * Admin corrects an advance payment, IN PLACE.
 *  - not yet paid → months, discount and the start month (the amount is re-quoted)
 *  - already PAID → the START MONTH only. Which months a payment applies to does get entered wrong
 *    (a transfer made on 31 July belongs to August, not July) and is pure bookkeeping; re-pricing
 *    money that has already changed hands is not, and would turn a settled family into a debtor.
 */
function handleEditPrepay(p) {
  p = p || {};
  var ss = getMainSpreadsheet_();
  var sh = sheet_(ss, 'PREPAYMENTS');
  var pp = findObject_(sh, function (x) { return String(x.PrepayID) === String(p.prepayId); });
  if (!pp) throw apiError_('NOT_FOUND', 'ไม่พบรายการชำระล่วงหน้า');
  var paid = String(pp.Status) === 'PAID';
  var curMonths = parseInt(pp.Months, 10) || 0;
  var curDisc = Number(pp.Discount) || 0;
  if (paid && ((p.months != null && (parseInt(p.months, 10) || 0) !== curMonths) ||
               (p.discount != null && p.discount !== '' && (Number(p.discount) || 0) !== curDisc))) {
    throw apiError_('ALREADY_PAID', 'รายการนี้ชำระแล้ว — แก้ได้เฉพาะเดือนที่มีผล ไม่สามารถแก้จำนวนเดือนหรือส่วนลด');
  }
  var months = (!paid && p.months != null) ? Math.max(1, parseInt(p.months, 10) || 0) : curMonths;
  var disc = (!paid && p.discount != null && p.discount !== '') ? Math.max(0, Math.min(100, Number(p.discount) || 0)) : curDisc;

  var cov = pp.Covered; if (typeof cov === 'string') { try { cov = JSON.parse(cov); } catch (e) { cov = []; } }
  var firstCovered = (cov && cov.length) ? String(cov[0]).slice(0, 7) : '';
  var start = String(p.startMonth || firstCovered || dateStr_(new Date())).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start)) throw apiError_('BAD_INPUT', 'ระบุเดือนที่เริ่มมีผล');

  var covered = [], y = parseInt(start.slice(0, 4), 10), mo = parseInt(start.slice(5, 7), 10);
  for (var i = 0; i < months; i++) { covered.push(y + '-' + ('0' + mo).slice(-2)); mo++; if (mo > 12) { mo = 1; y++; } }

  var patch = { Months: months, Discount: disc, Covered: JSON.stringify(covered) };
  if (!paid) {
    var st = findObject_(sheet_(ss, 'STUDENTS'), function (s) { return String(s.StudentID) === String(pp.StudentID); }) || {};
    var plans = []; try { plans = JSON.parse(getConfig_('Plans', '[]')); } catch (e) {}
    var plan = null; for (var j = 0; j < plans.length; j++) if (String(plans[j].id) === String(st.Plan)) plan = plans[j];
    var monthly = Number((plan && plan.price) || 0);
    if (!(monthly > 0)) throw apiError_('NO_PLAN_PRICE', 'นักเรียนคนนี้ยังไม่ได้ตั้งแพ็กเกจ/ราคาต่อเดือน');
    patch.Gross = monthly * months;
    patch.Amount = Math.round(patch.Gross * (100 - disc) / 100);
  }
  updateRow_(sh, pp._row, patch);
  recCacheBust_('PREPAYMENTS');
  try { logAudit(p.adminId || 'admin', 'PREPAY_EDIT', 'PREPAYMENTS', p.prepayId + ' ' + covered[0] + '–' + covered[covered.length - 1]); } catch (e) {}
  return { ok: true, prepayId: p.prepayId, months: months, discount: disc, covered: covered,
    amount: patch.Amount != null ? patch.Amount : Number(pp.Amount || 0) };
}

/**
 * Admin removes an advance-payment entry the parent created twice and never paid. In place — going
 * through the engine would rewrite the whole PREPAYMENTS collection, which this project does not do.
 * Refuses anything already paid, or anything with a slip against it: that is a real payment.
 */
function handleCancelPrepay(p) {
  p = p || {};
  var sh = sheet_(getMainSpreadsheet_(), 'PREPAYMENTS');
  var pp = findObject_(sh, function (x) { return String(x.PrepayID) === String(p.prepayId); });
  if (!pp) throw apiError_('NOT_FOUND', 'ไม่พบรายการชำระล่วงหน้า');
  if (String(pp.Status) === 'PAID') throw apiError_('ALREADY_PAID', 'รายการนี้ชำระแล้ว — ลบไม่ได้');
  var slips = readObjects_(paySlipsSheet_()).filter(function (s) {
    return String(s.RefKind) === 'prepay' && String(s.RefID) === String(p.prepayId) && String(s.Status) !== 'REJECTED';
  });
  if (slips.length) throw apiError_('HAS_SLIP', 'รายการนี้มีสลิปแนบอยู่ — ปฏิเสธสลิปก่อนจึงจะลบได้');
  sh.deleteRow(pp._row);
  recCacheBust_('PREPAYMENTS');
  try { logAudit(p.adminId || 'admin', 'PREPAY_DELETE', 'PREPAYMENTS', p.prepayId + ' ' + (pp.Amount || '')); } catch (e) {}
  return { ok: true, prepayId: p.prepayId };
}

/**
 * Is SlipOK actually reachable, and what does it say about the slips we already hold?
 * Admin-only diagnostic — answers "is verification working?" without uploading anything.
 */
function handleSlipDiag(p) {
  var url = getConfig_('SlipOK_Url', ''), key = getConfig_('SlipOK_ApiKey', '');
  var rows = readObjects_(paySlipsSheet_());
  var counts = { total: rows.length, verified: 0, rejected: 0, unchecked: 0, manual: 0 };
  var byCode = {};
  rows.forEach(function (s) {
    var v = String(s.Verified || '');
    if (v.slice(0, 3) === 'YES') counts.verified++;
    else if (v === 'MANUAL') counts.manual++;
    else if (v.slice(0, 2) === 'NO') { counts.rejected++; var c = v.slice(3) || '?'; byCode[c] = (byCode[c] || 0) + 1; }
    else counts.unchecked++;
  });
  // Having a URL and a key configured is NOT the same as the service working. An expired package or
  // a wrong branch id used to read here as "connected and running normally" while every single slip
  // was being rejected — so actually ask SlipOK, with log:false so the probe consumes nothing.
  var live = { checked: false };
  if (url && key) {
    // SlipOK's own /quota endpoint is the right probe: it consumes nothing, and it answers the two
    // questions the school actually has — is the package still valid (endDate), and how many slips
    // are left. It also separates the failure modes, which a dummy-slip POST cannot: a wrong BRANCH
    // fails at 1001 before auth, a wrong KEY at 1002, an unpaid package at 1003/1015.
    try {
      var res = UrlFetchApp.fetch(String(url).replace(/\/+$/, '') + '/quota', {
        method: 'get', headers: { 'x-authorization': key }, muteHttpExceptions: true
      });
      var http = res.getResponseCode();
      var body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
      var code = body.code || null, msg = String(body.message || '');
      var q = body.data || {};
      var alive = (http === 200 && body.success === true);
      live = { checked: true, http: http, code: code, message: msg, alive: alive,
        // which of the two values is wrong decides what the admin has to go and fetch
        badBranch: code === 1001, badKey: code === 1002, expired: code === 1003 || code === 1004 || code === 1015,
        quota: (q.quota != null ? Number(q.quota) : null),
        overQuota: (q.overQuota != null ? Number(q.overQuota) : null),
        endDate: String(q.endDate || ''),
        // the two things needed to compare against the SlipOK dashboard
        branch: String(url).replace(/\/+$/, '').split('/').pop(),
        keyTail: key.length > 4 ? ('••••' + key.slice(-4)) : '••••' };
    } catch (e) {
      live = { checked: true, alive: false, message: 'ติดต่อ SlipOK ไม่ได้: ' + String(e), branch: '', keyTail: '' };
    }
  }
  /* "Is it checking?" cannot be answered by a total. 49 slips and 0 genuine reads the same whether
   * verification has never run or whether it ran and objected to all 49 — and the quota sitting at
   * its full number says only that nothing has been charged against THIS package, which is also what
   * you would see if simply no one had paid by transfer since it was bought. The last few slips, with
   * the day they arrived and what SlipOK said about each, separate those cases at a glance.
   * A cash row has no verdict by design (there is no slip to read) and is labelled as such. */
  var recent = rows.slice(-6).reverse().map(function (s) {
    var v = String(s.Verified || '');
    return { date: String(s.SubmittedDate || '').slice(0, 16), kind: String(s.RefKind || ''),
      amount: Number(s.Amount || 0), method: String(s.Method || 'transfer'),
      verdict: v.slice(0, 3) === 'YES' ? 'YES' : (v === 'MANUAL' ? 'MANUAL' : (v.slice(0, 2) === 'NO' ? v : '')),
      hasImage: !!s.Url };
  });
  return {
    configured: !!(url && key),
    working: !!live.alive,
    live: live,
    recent: recent,
    // Whether an undo is available at all. The key itself is never returned — only that one exists.
    hasPrevKey: !!getConfig_('SlipOK_ApiKeyPrev', ''),
    url: url ? String(url).replace(/\/[^/]*$/, '/…') : '',
    counts: counts,
    byCode: Object.keys(byCode).map(function (c) { return { code: c, count: byCode[c] }; })
      .sort(function (a, b) { return b.count - a.count; })
  };
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
