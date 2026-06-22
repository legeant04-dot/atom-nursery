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
    var payload;
    if (p.qrData) payload = { data: String(p.qrData) };               // decoded EMVCo QR payload
    else if (p.slipBase64) payload = { files: p.slipBase64 };          // raw slip image (base64)
    else return { available: false, note: 'no slip data' };
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-authorization': key },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
    var data = body.data || body;
    var amount = data.amount != null ? Number(data.amount) : (data.amount_total != null ? Number(data.amount_total) : null);
    return { available: true, ok: !!body.success || res.getResponseCode() === 200, amount: amount, ref: data.transRef || data.ref || '', raw: body };
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
