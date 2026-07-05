/**
 * Day6.gs — Insurance (PCHI) + SlipOK verification + LIFF wiring
 * ------------------------------------------------------------------
 * Day 6 deploy module. New routes are registered in Code.gs ROUTES.
 * Sheets used (created idempotently by setupAll from Config.gs SCHEMA):
 *   - INSURANCE_PCHI  (Workbook 1) — one row per student; parent fills once, Admin edits.
 * Config keys used (SCHOOL_CONFIG): SlipOK_Url, SlipOK_ApiKey, InsuranceCompanyName, InsurancePolicyNo.
 * ------------------------------------------------------------------
 */

// ---- PCHI insurance ------------------------------------------------

/** Find the single insurance record for a student (by StudentID, else NationalID). */
function insuranceRecord_(studentId) {
  var ins = sheet_(getMainSpreadsheet_(), 'INSURANCE_PCHI');
  var stu = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return s.StudentID === studentId; }) || {};
  return findObject_(ins, function (r) {
    return r.StudentID === studentId || (stu.NationalID && String(r.NationalID) === String(stu.NationalID));
  });
}

/** Status: is the insurance form already filled for this student? */
function handleInsuranceStatus(p) {
  var stu = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return s.StudentID === p.studentId; }) || {};
  var rec = insuranceRecord_(p.studentId);
  return {
    studentId: p.studentId, filled: !!rec, record: rec || null,
    student: { name: stu.Name, nameEN: stu.NameEN, nationalId: stu.NationalID, gender: stu.Gender, dob: stu.DOB }
  };
}

/**
 * Submit the insurance form. ONCE per student (blocked if already filled,
 * unless adminEdit=true). Data is written ONLY to INSURANCE_PCHI.
 */
function handleSubmitInsurance(p) {
  var ss = getMainSpreadsheet_();
  var stu = findObject_(sheet_(ss, 'STUDENTS'), function (s) { return s.StudentID === p.studentId; });
  if (!stu) throw apiError_('NOT_FOUND', 'ไม่พบนักเรียน');
  var ins = sheet_(ss, 'INSURANCE_PCHI');
  var existing = insuranceRecord_(p.studentId);
  if (existing && !p.adminEdit) throw apiError_('ALREADY_FILLED', 'ข้อมูลประกันของนักเรียนคนนี้ถูกกรอกแล้ว');
  var d = p.data || {};
  var by = p.actorName || (p.adminEdit ? 'Admin' : 'Parent');
  var base = {
    StudentID: p.studentId,
    InsuredName: d.InsuredName || stu.NameEN || stu.Name,
    InsuredLastName: d.InsuredLastName || '',
    Gender: d.Gender || (stu.Gender === 'M' ? 'Male' : stu.Gender === 'F' ? 'Female' : ''),
    NationalID: d.NationalID || stu.NationalID,
    DOB: d.DOB || stu.DOB,
    MemberStatus: d.MemberStatus || 'Child',
    CompanyName: getConfig_('InsuranceCompanyName', 'Atom Nursery'),
    PolicyNo: getConfig_('InsurancePolicyNo', '')
  };
  if (existing) {
    var patch = {}; Object.keys(d).forEach(function (k) { patch[k] = d[k]; });
    Object.keys(base).forEach(function (k) { patch[k] = base[k]; });
    patch.UpdatedBy = by; patch.UpdatedDate = new Date();
    updateRow_(ins, existing._row, patch);
    logAudit_('updateInsurance', 'INSURANCE_PCHI', p.studentId);
    return { ok: true, updated: true };
  }
  var rec = { InsuranceID: nextId_(ins, 'InsuranceID', 'INS', 3), FilledBy: by, FilledByRole: p.adminEdit ? 'Admin' : 'Parent', FilledDate: new Date() };
  Object.keys(d).forEach(function (k) { rec[k] = d[k]; });
  Object.keys(base).forEach(function (k) { rec[k] = base[k]; });
  appendObject_(ins, rec);
  notifyAdmin_('🛡️ ผู้ปกครองกรอกข้อมูลประกัน: ' + (stu.Name || p.studentId));
  logAudit_('submitInsurance', 'INSURANCE_PCHI', p.studentId);
  return { ok: true, updated: false };
}

/** Admin: every active student with filled/not-filled flag + record. */
function handleInsuranceList() {
  var ins = readObjects_(sheet_(getMainSpreadsheet_(), 'INSURANCE_PCHI'));
  return readObjects_(sheet_(getMainSpreadsheet_(), 'STUDENTS'))
    .filter(function (s) { return s.Status !== 'EXPORTED' && s.Status !== 'WITHDRAWN'; })
    .map(function (s) {
      var rec = null;
      for (var i = 0; i < ins.length; i++) { if (ins[i].StudentID === s.StudentID) { rec = ins[i]; break; } }
      return { studentId: s.StudentID, name: s.Name, nameEN: s.NameEN, nationalId: s.NationalID, class: s.Class, filled: !!rec, record: rec };
    });
}

/** Admin edit/override (bypasses the once-only rule). */
function handleSaveInsuranceAdmin(p) { p.adminEdit = true; return handleSubmitInsurance(p); }

// ---- SlipOK slip verification -------------------------------------

/**
 * Verify a transfer slip via SlipOK. Send either the decoded QR `data`
 * string or the slip image (base64). Returns { available, ok, amount, ref, raw }.
 * Endpoint + key come from SCHOOL_CONFIG (SlipOK_Url / SlipOK_ApiKey).
 * Adjust the request shape to match the current SlipOK API docs if needed.
 */
function handleVerifySlip(p) {
  var url = getConfig_('SlipOK_Url', '');
  var key = getConfig_('SlipOK_ApiKey', '');
  if (!url || !key) return { available: false, provider: 'SlipOK', note: 'SlipOK not configured' };
  try {
    // log:true → SlipOK stores the slip (dedupe on repeat = code 1012) and checks the receiver
    // account registered in its LIFF (wrong receiver = code 1014). Configurable via SlipOK_Log.
    var payload = { log: String(getConfig_('SlipOK_Log', 'true')) !== 'false' };
    if (p.qrData) payload.data = String(p.qrData);                    // QR string from the slip's verify code
    else if (p.slipBase64) payload.files = p.slipBase64;              // slip image (base64) — JSON body per SlipOK Apps Script example
    else if (p.slipUrl) payload.url = String(p.slipUrl);
    else return { available: false, note: 'no slip data' };
    if (p.amount != null && Number(p.amount) > 0) payload.amount = Number(p.amount); // SlipOK cross-checks the amount → code 1013 if it differs
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-authorization': key }, payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var http = res.getResponseCode();
    var body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
    var d = body.data || {};
    var amount = d.amount != null ? Number(d.amount) : null;
    var receiver = d.receiver ? { name: d.receiver.displayName || d.receiver.name || '',
      account: (d.receiver.account && d.receiver.account.value) || (d.receiver.proxy && d.receiver.proxy.value) || '' } : null;
    return {
      available: true,
      ok: http === 200 && body.success === true,                     // a genuine, matching slip
      code: body.code || null,                                       // 1013 wrong amount · 1014 wrong receiver · 1012 duplicate · 1011 no txn
      message: body.message || d.message || '',
      amount: amount, ref: d.transRef || '',
      transDate: d.transDate || '', transTime: d.transTime || '',
      receiver: receiver, sender: d.sender ? (d.sender.displayName || d.sender.name || '') : '',
      raw: body
    };
  } catch (err) {
    return { available: false, error: String(err) };
  }
}

// ---- small helpers (no-throw best-effort) -------------------------
function logAudit_(action, table, recordId) {
  try { logAudit(action, table, recordId); } catch (e) {}   // Audit.gs provides logAudit; ignore if signature differs
}
function notifyAdmin_(message) {
  try {
    var uid = getConfig_('AdminLineUID', '');
    if (uid && String(uid).indexOf('<FILL') !== 0) linePush_(uid, message);  // Line.gs
  } catch (e) {}
}
