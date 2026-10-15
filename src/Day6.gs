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

/* THE INSURER'S OWN FORM, COLUMN FOR COLUMN.
 *
 * Target: "PCHI Members In-Out Form" -> sheet "Input Data", columns A-X. The school opens the real
 * template and pastes the block in, so the order and the headings have to be theirs, not ours.
 *
 * WHY THESE ARE HARD-CODED, having argued the opposite for our own sheet: this describes SOMEBODY
 * ELSE'S fixed document. Reading it from our sheet would produce our layout, which is the one thing
 * it must not be. If Pacific Cross reissues the form, this is the deliberate place to change — and
 * tools/test_insurance_export.js pins every heading so a silent drift is impossible.
 *
 * Verified against the workbook dated 23/02/2026 on 2026-08-27: all 23 data columns (B-X) map onto
 * a column INSURANCE_PCHI already has, and every dropdown value we offer is one the form accepts.
 */
var PCHI_FORM_ = [
  // [ their Thai heading, their English heading, our column | null = generated ]
  ['ลำดับ (Auto)', 'No.', null],
  ['ประเภท', 'Type', 'Type'],
  ['คำนำหน้า*', 'Title*', 'Title'],
  ['ชื่อผู้เอาประกันภัย*', 'Insured Name*', 'InsuredName'],
  ['ชื่อกลางผู้เอาประกันภัย*', 'Insured Middle Name*', 'InsuredMiddleName'],
  ['นามสกุลผู้เอาประกันภัย*', 'Insured Last Name*', 'InsuredLastName'],
  ['เพศ*', 'Gender*', 'Gender'],
  ['เลขที่บัตรประชาชน*', 'ID No.*', 'NationalID'],
  ['เลขหนังสือเดินทาง*', 'Passport*', 'Passport'],
  ['ว/ด/ป เกิด*', '/DOB D/M/Y*', 'DOB'],
  ['สถาน*', 'Status*', 'MemberStatus'],
  ['สถานภาพการสมรส*', 'Marital Status*', 'MaritalStatus'],
  ['อาชีพ/ตำแหน่ง*', 'Occupation/Duties*', 'Occupation'],
  ['วันมีผลบังคับ*', 'Effective date*', 'EffectiveDate'],
  ['แผนประกัน*', 'Plan*', 'Plan'],
  ['เบอร์โทรศัพท์มือถือ', 'Mobile no.', 'Mobile'],
  ['อีเมล์', 'Email Address', 'Email'],
  ['ชื่อบัญชีธนาคารกรณีเรียกร้องสินไหม', 'Bank Account Name', 'BankAccountName'],
  ['เลขที่ธนาคารกรณีเรียกร้องสินไหม', 'Bank Account Number', 'BankAccountNumber'],
  ['รหัสพนักงาน', 'Employee ID', 'EmployeeID'],
  ['ชื่อผู้รับผลประโยชน์', 'Beneficiary', 'BeneficiaryName'],
  ['นามสกุลผู้รับผลประโยชน์', 'Beneficiary', 'BeneficiaryLastName'],
  ['ความสัมพันธ์', 'Relationship', 'BeneficiaryRelationship'],
  ['หมายเหตุ', 'Remarks', 'Remarks']
];

/**
 * Every filled-in insurance record, laid out as the insurer's form.
 *
 * ONLY ROWS THE FAMILY HAS ACTUALLY FILLED IN (the school's decision): this is an In-Out form, sent
 * in batches, not a register. A row of blanks for a child whose parents have not filled the form
 * would be sent to the insurer as if it were a member.
 *
 * Column A is the running number the form calls "(Auto)", and column B is the movement type —
 * "เข้า", because every row this produces is a member being added.
 */
function handleInsuranceExport() {
  var recs = readObjects_(sheet_(getMainSpreadsheet_(), 'INSURANCE_PCHI'))
    .filter(function (r) { return r && String(r.InsuredName || '').trim(); });
  var thai = [], eng = [];
  PCHI_FORM_.forEach(function (c) { thai.push(c[0]); eng.push(c[1]); });
  var rows = recs.map(function (r, i) {
    return PCHI_FORM_.map(function (c, ci) {
      if (ci === 0) return i + 1;                       // ลำดับ (Auto)
      if (c[2] === 'Type') return String(r.Type || '').trim() || 'เข้า';
      var v = r[c[2]];
      if (c[2] === 'DOB' || c[2] === 'EffectiveDate') return insDate_(v);
      return (v === null || v === undefined) ? '' : String(v);
    });
  });
  var tz = (typeof ssTz_ === 'function') ? ssTz_() : 'Asia/Bangkok';
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return {
    headers: thai, headersEN: eng, rows: rows, count: rows.length,
    filename: 'PCHI_Members_In-Out_' + stamp + '.xlsx',
    sheetName: 'Input Data'
  };
}

/** Status: is the insurance form already filled for this student? */
/**
 * THE POLICY THE SCHOOL BOUGHT — the GAS half of studentPolicy_ in webapp/engine.js.
 *
 * This exists because handleInsuranceStatus SHADOWS the engine's insuranceStatus (see the note just
 * below insDate_). The engine's copy was given a `policy` field on 2026-09-12 and, without this, the
 * parent's card would simply never have appeared on the live school — the same failure as v378's
 * NameTH, found by auditing the 115 shadowed routes rather than by anybody noticing.
 *
 * Keep the field names identical to the engine's: the screen reads one shape.
 */
function insPolicy_(stu) {
  stu = stu || {};
  var g = function (k) { var v = stu[k]; return (v === null || v === undefined) ? '' : String(v).trim(); };
  var pol = {
    plan: g('InsurancePlan'), type: g('InsuranceType'),
    policyNo: g('InsurancePolicyNo'), company: g('InsuranceCompany'),
    insured: g('InsuredName'), owner: g('InsuranceOwner'), status: g('InsuranceStatus'),
    start: insDate_(stu.InsuranceStart), expiry: insDate_(stu.InsuranceExpiry),
    sum: g('InsuranceSum'), benefits: g('InsuranceBenefits'), hotline: g('InsuranceHotline'),
    card: g('InsuranceCardImage')
  };
  /* `has` is NOT the checkbox alone — same rule as the engine. The tick and the details are entered
   * at different times, and a card that hid a real policy number because nobody ticked a box is the
   * exact failure this exists to prevent: a parent at a hospital counter with nothing to show. */
  var tick = String(stu.InsuranceHas == null ? '' : stu.InsuranceHas).toUpperCase();
  pol.onFile = (tick === 'TRUE' || tick === 'YES' || tick === '1' || stu.InsuranceHas === true)
            || !!(pol.policyNo || pol.plan || pol.company || pol.sum || pol.benefits);
  /* 🔴 ...AND A POLICY THAT HAS RUN OUT IS NOT COVER (2026-10-12).
   *
   * THIS is the copy that actually answers a parent on live — the engine's studentPolicy_ is
   * shadowed by this route. `has` was true for ever once any field was filled in, and the expiry
   * date was printed and never consulted, so a card went on reading "มีประกัน" with last year's
   * policy number. Fixing only the engine would have changed the tests and nothing else.
   *
   * `onFile` keeps the details reachable for renewing or querying; `has` is the one anybody may
   * read as "covered today", and it now goes false on the day the policy ends. */
  pol.expired = !!(pol.expiry && insDate_(new Date()) > pol.expiry);
  pol.has = pol.onFile && !pol.expired;
  return pol;
}
function handleInsuranceStatus(p) {
  var stu = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'), function (s) { return s.StudentID === p.studentId; }) || {};
  var rec = insuranceRecord_(p.studentId);
  return {
    studentId: p.studentId, filled: !!rec, record: insReadable_(rec) || null,
    // the school's own policy, read by the parent to make a claim — see insPolicy_ above
    policy: insPolicy_(stu),
    student: { name: stu.Name, nameEN: stu.NameEN, nationalId: stu.NationalID, gender: stu.Gender, dob: insDate_(stu.DOB) }
  };
}

/* A DATE OBJECT IN A CELL COMES BACK AS AN ISO STRING WITH A Z ON IT.
 *
 * Reported 2026-08-27: the filled-in screen printed "2026-08-27T03:19:54.375Z" for กรอกโดย and
 * "2023-12-02T05:00:00.000Z" for the child's date of birth. Both were Date objects written straight
 * into the sheet, read back, and serialised to JSON — and both in UTC, so the timestamp was also
 * seven hours out (03:19Z is 10:19 in Bangkok).
 *
 * The ENGINE version of this handler has always written todayLocal(). This route SHADOWS it, so the
 * two disagreed and the route is what runs on the server — the documented trap in this project.
 *
 * These are function DECLARATIONS, not `var f = function`: they are called from above their own
 * position in the file, and a var assignment would still be undefined at that point.
 */
function insDate_(v) {                               // -> 'yyyy-MM-dd', or '' / passthrough
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return dateStr_(v);
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));    // already ISO-ish: keep the date part
  return m ? m[1] : String(v);
}
/** 'yyyy-MM-dd HH:mm' for a stamp — also repairs a legacy ISO/Date already in the sheet. */
function insStamp_(v) {
  if (v === null || v === undefined || v === '') return '';
  var d = (Object.prototype.toString.call(v) === '[object Date]') ? v
        : (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? new Date(String(v)) : null);
  if (!d || isNaN(d.getTime())) return String(v);     // already a plain local string: leave it alone
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm');
}
/** Every date-ish field of a stored record, made readable. Applied on the way OUT, so rows written
 *  before this fix display correctly without anybody migrating the sheet. */
function insReadable_(rec) {
  if (!rec) return rec;
  var out = {}; Object.keys(rec).forEach(function (k) { out[k] = rec[k]; });
  ['DOB', 'EffectiveDate'].forEach(function (k) { if (out[k] !== undefined) out[k] = insDate_(out[k]); });
  ['FilledDate', 'UpdatedDate'].forEach(function (k) { if (out[k] !== undefined) out[k] = insStamp_(out[k]); });
  return out;
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
  var d = p.data || {};
  /* FILL-ONCE WAS THE WRONG RULE.
   *
   * A family's facts change — a bank account, a mobile, a beneficiary — and a mistyped claim account
   * number was permanent, on the one field where being wrong costs money. The parent may now come
   * back and correct their own submission at any time (asked 2026-08-29).
   *
   * TWO FIELDS STAY THE SCHOOL'S. แผนประกัน and วันมีผลบังคับ are settled between the school and the
   * insurer AFTER the form is handed in, so the parent's form does not render them at all — which
   * means they arrive here ABSENT, not empty, and the patch below leaves them alone. Deleting them
   * defensively as well, because "the client did not send it" is not a thing to stake a real policy
   * number on: a stale cached build that still had the boxes would otherwise blank them.
   */
  if (existing && !p.adminEdit) { delete d.Plan; delete d.EffectiveDate; }
  if (d.EffectiveDate !== undefined) d.EffectiveDate = insDate_(d.EffectiveDate);
  if (d.DOB !== undefined) d.DOB = insDate_(d.DOB);
  var by = p.actorName || (p.adminEdit ? 'Admin' : 'Parent');
  var base = {
    StudentID: p.studentId,
    InsuredName: d.InsuredName || stu.NameEN || stu.Name,
    InsuredLastName: d.InsuredLastName || '',
    Gender: d.Gender || (stu.Gender === 'M' ? 'Male' : stu.Gender === 'F' ? 'Female' : ''),
    NationalID: d.NationalID || stu.NationalID,
    DOB: insDate_(d.DOB || stu.DOB),
    MemberStatus: d.MemberStatus || 'Child',
    CompanyName: getConfig_('InsuranceCompanyName', 'Atom Nursery'),
    PolicyNo: getConfig_('InsurancePolicyNo', '')
  };
  if (existing) {
    var patch = {}; Object.keys(d).forEach(function (k) { patch[k] = d[k]; });
    Object.keys(base).forEach(function (k) { patch[k] = base[k]; });
    patch.UpdatedBy = by; patch.UpdatedDate = nowStr_();   // local 'yyyy-MM-dd HH:mm:ss', not a Date
    updateRow_(ins, existing._row, patch);
    // The school may already have sent this row to the insurer, so a change to it is news, not noise.
    if (!p.adminEdit) notifyAdmin_('🛡️ ผู้ปกครองแก้ไขข้อมูลประกัน: ' + (stu.Name || p.studentId));
    logAudit_('updateInsurance', 'INSURANCE_PCHI', p.studentId);
    return { ok: true, updated: true };
  }
  var rec = { InsuranceID: nextId_(ins, 'InsuranceID', 'INS', 3), FilledBy: by, FilledByRole: p.adminEdit ? 'Admin' : 'Parent', FilledDate: nowStr_() };
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
      // nick/nickEN so the list can lead with the name the school actually uses — this route SHADOWS
      // the engine's insuranceList, so adding them there alone would have changed nothing on live
      return { studentId: s.StudentID, name: s.Name, nameEN: s.NameEN, nick: s.Nickname, nickEN: s.NicknameEN,
               nationalId: s.NationalID, class: s.Class, filled: !!rec, record: insReadable_(rec) };
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
/**
 * IS THE PARENT-SIDE PRE-CHECK ON? — asked in ONE place, by everything.
 *
 * 🔴 DEFAULT OFF (2026-10-15), AND THE TWO WRONG ANSWERS ARE NOT THE SAME SIZE.
 *
 * Every slip costs TWO SlipOK calls — the parent's screen checks it on attach, the server verifies
 * it on submit — so the free Basic package's 100 calls a month is FIFTY SLIPS. The school reached
 * 0/100 and every parent's transfer silently stopped being verified. That is what ON costs when it
 * is wrong.
 *
 * What OFF costs when IT is wrong is that a parent types the amount themselves instead of having it
 * filled in. Nothing goes unverified either way: the check on submit is untouched.
 *
 * So the default takes the small mistake, the same reasoning as social security defaulting to
 * unticked in computePayroll — a school that leaves it alone gets a bit less convenience, rather
 * than discovering months later that verification stopped. A school with quota to spare ticks the
 * box once.
 *
 * 🔴 AND IT IS ASKED HERE, NOT SPELLED OUT AT EACH CALLER. The default briefly lived in three
 * places (this file, PaySlips.gs and the Config.gs seed) — which is how a screen comes to show a
 * ticked box above code that is switched off, and that reads as the app lying about itself.
 */
var SLIPOK_PRECHECK_DEFAULT_ = 'false';
function slipOkPreCheckOn_() {
  return String(getConfig_('SlipOK_PreCheck', SLIPOK_PRECHECK_DEFAULT_)) === 'true';
}

function handleVerifySlip(p) {
  var url = getConfig_('SlipOK_Url', '');
  var key = getConfig_('SlipOK_ApiKey', '');
  if (!url || !key) return { available: false, provider: 'SlipOK', note: 'SlipOK not configured' };
  /* 🔴 TWO CALLS PER SLIP, AND THE QUOTA IS COUNTED IN CALLS (2026-10-15).
   *
   * Every payment makes two: the parent's screen asks with log:false the moment the image is
   * attached (so the amount can be filled in and a wrong slip caught before they submit), and the
   * server asks again with log:true when they actually submit, which is the authoritative one.
   *
   * On the free Basic package that is 100 calls a month — so FIFTY SLIPS, not a hundred. The school
   * reached 0/100 and every parent's transfer stopped being verified, which is how this was found.
   *
   * The pre-check is a CONVENIENCE: it fills the amount in and warns early. The submit-time check is
   * the one that decides anything. So when the quota is the binding constraint, this is the half to
   * give up — and the school can, with one setting, without losing any verification.
   *
   * Default ON: that is today's behaviour, and nothing changes for a school with quota to spare. */
  if (p && p.log === false && !slipOkPreCheckOn_()) {
    return { available: false, provider: 'SlipOK', note: 'pre-check disabled (SlipOK_PreCheck=false)' };
  }
  try {
    // log:true → SlipOK STORES the slip (dedupe on repeat = code 1012) and checks the receiver
    // (wrong receiver = 1014). The parent PRE-CHECK must pass log:false so it doesn't consume the
    // slip — otherwise the authoritative verify at upload sees its own pre-check as a 1012 duplicate.
    var payload = { log: (p.log === false) ? false : (String(getConfig_('SlipOK_Log', 'true')) !== 'false') };
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
    /* 🔴 DID SLIPOK JUDGE THE SLIP, OR DID IT REFUSE *US*? (2026-10-15)
     *
     * `available: true` used to mean "a reply arrived and parsed", and paySlipVerify_ read that as
     * "SlipOK has given a verdict on this slip" — so a refusal aimed at OUR ACCOUNT was written onto
     * the PARENT'S payment as `NO:1002`, and the admin's screen showed it under "⚠️ SlipOK ทักท้วง".
     *
     * A family's genuine transfer, marked as objected-to, because our API key was wrong.
     *
     * It is not theoretical: between 13/10 and 15/10 the school's key was the SlipOK notification
     * reference instead of the branch API key, and every one of the six slips that arrived in those
     * two days was stamped as objected-to. 148 of 159 slips on file carry that mark.
     *
     * DECLARED, not inferred from the number. These are refusals about the ACCOUNT — the branch, the
     * key, the package, the quota — and none of them says anything whatsoever about the slip:
     *   1001 branch not found · 1002 bad key · 1003/1004/1015 package expired or unpaid
     * Plus any HTTP status that never reached SlipOK's slip logic at all (401/403, and 5xx).
     *
     * Everything else IS a verdict and must still be recorded: 1011 no such transaction,
     * 1012 already used, 1013 amount differs, 1014 wrong receiver. Those are about the slip. */
    var ACCOUNT_CODES = { 1001: 1, 1002: 1, 1003: 1, 1004: 1, 1015: 1 };
    var code0 = body.code || null;
    var serviceError = !!(ACCOUNT_CODES[code0] || http === 401 || http === 403 || http >= 500);
    return {
      available: true,
      ok: http === 200 && body.success === true,                     // a genuine, matching slip
      /* 🔴 TRUE = "the answer is about US, not about this slip". The caller must not record a
       * verdict when this is set — see paySlipVerify_ in PaySlips.gs. */
      serviceError: serviceError,
      code: code0,                                                   // 1013 wrong amount · 1014 wrong receiver · 1012 duplicate · 1011 no txn
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
/* 🔴 TWO FAULTS IN ONE LINE, both found 2026-10-09 while taking LINE out of the write lock.
 *
 * 1. IT NEVER WORKED. linePush_ takes an ARRAY of message objects — `[{type:'text', text:'…'}]` —
 *    and this handed it a bare string, so the payload LINE received had no messages in it. Every
 *    one of these went out as a 400 and was swallowed by the try/catch. Three callers, all of them
 *    quiet for as long as they have existed: a parent filling in the insurance form, a parent
 *    editing it, and a member of staff asking for a password reset. Nobody was ever told.
 *
 * 2. IT BYPASSED THE QUEUE. All three callers are mutating actions, so they run inside the write
 *    lock — the exact fault the deferral was written for. Calling linePush_ directly walked straight
 *    past it.
 *
 * Both answered by using linePushText_, which is the only thing that should ever push text: it
 * builds the message array correctly AND defers while a lock is held.
 */
function notifyAdmin_(message) {
  try {
    var uid = getConfig_('AdminLineUID', '');
    if (uid && String(uid).indexOf('<FILL') !== 0) linePushText_(uid, message);  // Line.gs
  } catch (e) {}
}
