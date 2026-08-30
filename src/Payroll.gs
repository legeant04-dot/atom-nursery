/**
 * Payroll.gs — Salary calculation (chat spec / Slip Form)
 * ------------------------------------------------------------------
 * Income : BaseSalary + เบี้ยขยัน(มาครบ+โพสต์ FB) + รายได้อื่นๆ(เด็ก#31+, ใบประกาศ)
 *          + ค่าสวงเวลาตอนเย็น(OT) + เงินพิเศษวันพักผ่อน
 * Deduct : ประกันสังคม + เงินสมทบ + อื่นๆ
 * NetPay -> โอนเข้าบัญชี SCB
 * One PAYROLL row per staff per month (re-running updates it).
 * ------------------------------------------------------------------
 */
function num_(v, d) { var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }
function round2_(n) { return Math.round(n * 100) / 100; }
// 'YYYY-MM' written to a Sheets cell is coerced to the DATE 2026-07-01 and reads back as '2026-07-01',
// so every `String(row.Month) === '2026-07'` comparison silently failed: computePayroll never found the
// existing row (appending a DUPLICATE on each press), getPayslip returned null ("ยังไม่มีสลิป"), and the
// finance rollup could not match the payslip to the month. Compare the first 7 characters, always.
function ym7_(v) {
  // readObjects_/findObject_ hand back RAW cell values, so a coerced month cell arrives as a Date
  // object — String(date).slice(0,7) is "Mon Jul", which matched nothing. Format it properly first.
  if (v instanceof Date) { try { return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM'); } catch (e) {} }
  return String(v == null ? '' : v).slice(0, 7);
}
function monthOf_(dateVal) { try { return dateStr_(new Date(dateVal)).slice(0, 7); } catch (e) { return ''; } }

/**
 * Compute (and persist) a staff member's payroll for a month.
 * payload: {
 *   staffId, month:'YYYY-MM',
 *   facebookPosted?:bool, facebookAmount?,        // เบี้ยขยัน FB (Admin ticks)
 *   attendanceOverride?:bool,                     // force attendance bonus on/off
 *   extraChildCount?, trainingCertCount?,         // รายได้อื่นๆ
 *   otEvening?,                                    // override evening OT (else summed from OT_RECORDS)
 *   holidayBonus?, otherIncome?,                  // เงินพิเศษ / อื่นๆ
 *   socialSecurity?, contribution?, otherDeductions?,
 *   generatedBy?
 * }
 */
/**
 * THIS PERSON'S OWN PAY SETTINGS (PAYROLL_CONFIG), or {} — the middle step between what the payroll
 * screen sends and the school-wide defaults.
 *
 * It was missing entirely. computePayroll went straight from `payload.x` to `getConfig_('X')`, so a
 * เบี้ยขยัน of 1,000 set for one teacher was used ONLY if the screen happened to send it in that
 * request — and was silently replaced by the school's 500 in every other path. The admin had set a
 * figure, the app had stored it, and the payslip ignored it. Same for the child rate, the pay type,
 * the daily rate, the social-security tick and the contribution.
 *
 * Reported 2026-08-24: "ใส่ค่าสำหรับครูฟาง 1000 ตอนทำเงินเดือนค่านี้ก็ต้องถูกดึงมาถูกต้อง".
 */
function payrollCfgFor_(staffId) {
  try {
    var sh = getHrSpreadsheet_().getSheetByName('PAYROLL_CONFIG');
    if (!sh) return {};
    var r = findObject_(sh, function (x) { return String(x.StaffID) === String(staffId); });
    return r || {};
  } catch (e) { return {}; }
}
/**
 * A per-staff setting, or null when there isn't one.
 *
 * BLANK IS NOT A SETTING OF ZERO. Clearing the box on the staff form writes '' into the sheet — the
 * way an admin says "go back to the school figure" — and `'' != null` is true, so a plain null-check
 * would take the override and num_('') is 0. Anybody who removed their per-person เบี้ยขยัน would
 * have been paid none at all. Asked in ONE place so no caller can get it wrong.
 */
function pcNum_(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}
/** A per-staff YES/NO setting ('' / undefined → null, i.e. "not set"). */
function pcBool_(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'boolean') return v;
  var s = String(v).trim().toUpperCase();
  if (s === 'TRUE' || s === 'YES' || s === '1') return true;
  if (s === 'FALSE' || s === 'NO' || s === '0') return false;
  return null;
}

function computePayroll(payload) {
  payload = payload || {};
  if (!payload.month) throw apiError_('BAD_INPUT', 'ต้องระบุ month (YYYY-MM)');
  var staff = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'),
    function (s) { return String(s.StaffID) === String(payload.staffId); });
  if (!staff) throw apiError_('STAFF_NOT_FOUND', 'ไม่พบพนักงาน');
  var month = payload.month;

  // Everything the payroll screen sends is honoured here. This route SHADOWS the shared engine, and it
  // used to ignore most of the payload — the per-staff diligence amounts, the child-rate settings, the
  // social-security tick and the signed adjustment lines all did nothing on live, so the slip silently
  // disagreed with what the admin had entered.
  // ...and what the ADMIN set for this person, which sits between the two (see payrollCfgFor_)
  var pc = payrollCfgFor_(payload.staffId);
  var pcDaily = pcNum_(pc.DailyRate);

  var payType = payload.payType || (String(pc.PayType || '').trim() || 'monthly');
  var base = payType === 'daily'
    ? (payload.dailyRate != null ? num_(payload.dailyRate) : (pcDaily != null ? pcDaily : 0)) * num_(payload.daysWorked)
    : (payload.baseSalary != null ? num_(payload.baseSalary) : num_(staff.BaseSalary));

  // --- เบี้ยขยัน --- (unchanged: its own "no leave / no late" rule)
  var attEligible = (payload.attendanceEligible != null) ? !!payload.attendanceEligible
    : (payload.attendanceOverride != null) ? !!payload.attendanceOverride
    : attendanceEligible_(staff.StaffID, month);
  // payload → THIS PERSON'S setting → the school's figure. The middle step was missing.
  var pcAtt = pcNum_(pc.DiligenceAttendanceAmount);
  var attendAmt = (payload.diligenceAttend != null) ? num_(payload.diligenceAttend)
    : (pcAtt != null ? pcAtt : num_(getConfig_('DiligenceAttendanceAmount', '500')));
  var diligenceAttendance = attEligible ? attendAmt : 0;

  // --- กฎการลา: ลาทุกชนิดเกิน limit วัน/เดือน → ไม่คำนวณเรทจำนวนเด็ก ---
  // WARNING only; no field is locked — Admin may still enter a child count to override. Applied below.
  var leaveDays = allLeaveDays_(staff.StaffID, month);
  var leaveLimit = parseInt(getConfig_('DiligenceLeaveMaxDays', '3'), 10) || 3;
  var leaveExceeds = leaveDays > leaveLimit;
  var pcFb = pcNum_(pc.DiligenceFacebookAmount);
  var fbAmt = (payload.diligenceFb != null) ? num_(payload.diligenceFb)
    : (payload.facebookAmount != null && String(payload.facebookAmount) !== '') ? num_(payload.facebookAmount)
    : (pcFb != null ? pcFb : num_(getConfig_('DiligenceFacebookAmount', '500')));
  var diligenceFacebook = payload.facebookPosted ? fbAmt : 0;
  // Big Cleaning Day: attendance on an admin-set cleaning day earns a diligence bonus (เบี้ยขยัน)
  var diligenceBigClean = bigCleaningBonus_(staff.StaffID, month, payload);
  var diligenceTotal = diligenceAttendance + diligenceFacebook + diligenceBigClean;

  // --- รายได้อื่นๆ ---
  // leave over the limit → child-rate not calculated by default (0). If the caller sends an explicit
  // count it is respected (Admin override — no field locked); the client auto-zeroes on leaveExceeds.
  var extraChildCount = (payload.extraChildCount != null)
    ? Math.max(0, parseInt(payload.extraChildCount, 10) || 0)
    : (leaveExceeds ? 0 : 0);
  var pcChild = pcNum_(pc.ChildMultiplier);
  var childMultiplier = (payload.childMultiplier != null) ? num_(payload.childMultiplier)
    : (pcChild != null ? pcChild : num_(getConfig_('ExtraChildRate', '300')));
  var extraChildAmount = extraChildCount * childMultiplier;
  var certCap = parseInt(getConfig_('TrainingCertMaxPerMonth', '2'), 10);
  var trainingCertCount = Math.min(certCap, Math.max(0, parseInt(payload.trainingCertCount, 10) || 0));
  var trainingCertAmount = trainingCertCount * num_(getConfig_('TrainingCertRate', '100'));
  var otherIncomeManual = num_(payload.otherIncome);
  var otherIncome = extraChildAmount + trainingCertAmount + otherIncomeManual;

  // --- OT เย็น ---
  var otEvening = (payload.otEvening != null) ? num_(payload.otEvening) : sumMonthlyOT_(staff.StaffID, month);
  // OT approved too late to make an earlier month's salary is paid here as its own line, so the
  // teacher is never short-paid and the earlier slip stays exactly as it was signed off.
  var carry = otCarryOver_(staff.StaffID, month);
  var otCarry = (payload.otCarry != null) ? num_(payload.otCarry) : carry.total;
  var otCarryDetail = (payload.otCarry != null && !carry.detail.length) ? [] : carry.detail;
  // OT วันหยุด — a day off that was worked. Its own line, so the slip says what the money was for.
  var otHoliday = (payload.otHoliday != null) ? num_(payload.otHoliday) : sumMonthlyHolidayOT_(staff.StaffID, month);
  var holidayBonus = num_(payload.holidayBonus);

  // Signed adjustment lines used to be applied straight to the net, which meant the slip printed an
  // "อื่น ๆ" figure that was NOT inside รวมรายได้ / รวมหัก — the columns disagreed with their own totals.
  // A positive line is income, a negative line is a deduction; fold them in before totalling.
  var adjustments = Array.isArray(payload.adjustments) ? payload.adjustments.filter(function (a) {
    return a && (String(a.label || '').trim() !== '' || num_(a.amount) !== 0); }) : [];
  var adjPlus = 0, adjMinus = 0;
  adjustments.forEach(function (a) { var v = num_(a.amount); if (v > 0) adjPlus += v; else adjMinus += -v; });
  var adjustmentsTotal = round2_(adjPlus - adjMinus);
  otherIncome = round2_(otherIncome + adjPlus);
  var gross = round2_(base + diligenceTotal + otherIncome + otEvening + otCarry + otHoliday + holidayBonus);

  // --- รายการหัก ---
  // the client sends socialSecurityDeduct (the checkbox). Only an explicit socialSecurity NUMBER
  // overrides the calculation; unticking must zero it, which is what was being ignored.
  var pcSS = pcBool_(pc.SocialSecurityDeduct);
  var ssDeduct = (payload.socialSecurityDeduct != null) ? !!payload.socialSecurityDeduct
    : (pcSS != null ? pcSS : true);
  var ss = (payload.socialSecurity != null) ? num_(payload.socialSecurity)
    : (ssDeduct ? Math.min(round2_(base * num_(getConfig_('SocialSecurityRate', '0.05'))), num_(getConfig_('SocialSecurityMax', '750'))) : 0);
  // เงินสมทบ is a SAVINGS fund, not a cost to the teacher: the amount entered here is deducted from
  // their pay AND the school puts in the same again. Only the teacher's half is a deduction; the fund
  // grows by both halves. Entering 200 therefore deducts 200 and adds 400 to the accumulated total.
  var pcContrib = pcNum_(pc.Contribution);
  var contribution = (payload.contribution != null && String(payload.contribution) !== '')
    ? num_(payload.contribution) : (pcContrib != null ? pcContrib : 0);
  var matchRate = num_(getConfig_('ContributionMatchRate', '1'), 1);
  var contributionEmployer = round2_(contribution * matchRate);
  var otherDeductions = round2_(num_(payload.otherDeductions) + adjMinus);
  var totalDeductions = round2_(ss + contribution + otherDeductions);

  var netPay = round2_(gross - totalDeductions);   // adjustments are already inside the two totals

  var sheet = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  // running total of เงินสมทบ across every month on file — the school's slip prints it at the bottom
  // the school carried an accumulated เงินสมทบ before the app existed; that opening balance lives on
  // the staff record and every month's contribution adds on top of it
  // opening balance carried from before the app + every month recorded here (this one included),
  // counting BOTH halves. Rows saved before the employer half was recorded have no
  // ContributionEmployer cell, so their match is reconstructed at the current rate — the school did
  // pay it, the app just never wrote it down. Use recomputeContributions (preview) to review this.
  var contribAccum = num_(staff.ContributionOpening) + contribution + contributionEmployer;
  try {
    readObjects_(sheet).forEach(function (r) {
      if (String(r.StaffID) !== String(staff.StaffID) || ym7_(r.Month) === ym7_(month)) return;
      var own = num_(r.Contribution);
      var emp = (r.ContributionEmployer === '' || r.ContributionEmployer == null)
        ? round2_(own * matchRate) : num_(r.ContributionEmployer);
      contribAccum += own + emp;
    });
  } catch (e) {}
  contribAccum = round2_(contribAccum);
  try { ensureColumns_(sheet, ['PayType', 'DailyRate', 'DaysWorked', 'ChildMultiplier', 'Adjustments',
    'AdjustmentsTotal', 'BankName', 'LeaveDays', 'LeaveLimit', 'LeaveExceeds',
    'ContributionAccum', 'Position', 'StaffName',
    'ContributionEmployer', 'OTCarry', 'OTCarryDetail', 'OTHoliday']); } catch (e) {}
  var existing = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && ym7_(r.Month) === ym7_(month);
  });
  // preview: work the numbers out and hand them back WITHOUT touching the sheet, so "คำนวณ" can show
  // the result while "บันทึก" stays the one action that creates the payable and moves the expense total
  var previewOnly = !!payload.preview;
  var rec = {
    StaffID: staff.StaffID, Month: month, BaseSalary: base,
    DiligenceAttendance: diligenceAttendance, DiligenceFacebook: diligenceFacebook, DiligenceTotal: diligenceTotal,
    ExtraChildCount: extraChildCount, ExtraChildAmount: extraChildAmount,
    TrainingCertCount: trainingCertCount, TrainingCertAmount: trainingCertAmount,
    // the per-evening `days` list is for the SCREEN to show; the row keeps only what the carry-over
    // arithmetic reads back (month + amount + hours), so this cell cannot grow toward the 50,000-char
    // limit on a staff member with years of history behind them
    OTEvening: otEvening, OTCarry: otCarry,
    OTCarryDetail: JSON.stringify((otCarryDetail || []).map(function (d) {
      return { month: d.month, amount: d.amount, hours: d.hours };
    })),
    OTHoliday: otHoliday,
    HolidayBonus: holidayBonus, OtherIncome: otherIncome, GrossIncome: gross,
    SocialSecurity: ss, Contribution: contribution, ContributionEmployer: contributionEmployer,
    OtherDeductions: otherDeductions, TotalDeductions: totalDeductions,
    PayType: payType, DailyRate: num_(payload.dailyRate), DaysWorked: num_(payload.daysWorked),
    ChildMultiplier: childMultiplier,
    Adjustments: JSON.stringify(adjustments), AdjustmentsTotal: adjustmentsTotal,
    NetPay: netPay, BankName: staff.BankName || getConfig_('BankName', 'SCB'),
    ContributionAccum: round2_(contribAccum), Position: staff.Position || '',
    StaffName: staff.Name || staff.NameEN || '',
    BankAccount: staff.BankAccount || '', SlipSent: existing ? existing.SlipSent : 'NO',
    LeaveDays: leaveDays, LeaveLimit: leaveLimit, LeaveExceeds: leaveExceeds,
    GeneratedDate: new Date(), GeneratedBy: payload.generatedBy || 'system'
  };
  if (previewOnly) { rec.PayrollID = existing ? existing.PayrollID : ''; rec.Preview = true; rec.Saved = !!existing; return rec; }
  // mirror the running total onto the staff record so it can be read there too. ContributionOpening
  // (the manual carried-over figure) is NEVER overwritten — otherwise the next calculation would add
  // this month's contribution on top of itself.
  try {
    var stSh = sheet_(getHrSpreadsheet_(), 'STAFF');
    try { ensureColumns_(stSh, ['ContributionOpening', 'ContributionAccum', 'ContributionLocked']); } catch (e) {}
    var stRow = findObject_(stSh, function (x) { return String(x.StaffID) === String(staff.StaffID); });
    if (stRow) { updateRow_(stSh, stRow._row, { ContributionAccum: contribAccum });
      try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF']); } catch (e) {} }
  } catch (e) {}
  if (existing) { rec.PayrollID = existing.PayrollID; updateRow_(sheet, existing._row, rec); }
  else { rec.PayrollID = nextId_(sheet, 'PayrollID', 'PR'); appendObject_(sheet, rec); }
  rec.Saved = true;
  logAuditHr(payload.generatedBy || 'system', existing ? 'PAYROLL_UPDATE' : 'PAYROLL_CREATE', 'PAYROLL', rec.PayrollID);

  return rec;
}

/** Approved leave DAYS of EVERY type (sick + personal + vacation …) taken by a staff member in a month. */
function allLeaveDays_(staffId, month) {
  var total = 0;
  readObjects_(sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST')).forEach(function (r) {
    if (String(r.StaffID) !== String(staffId) || String(r.Status) !== 'APPROVED') return;
    if (monthOf_(r.StartDate) !== month) return;
    total += num_(r.Days, 1) || 1;
  });
  return total;
}

/** Eligible for attendance bonus = no late minutes and no approved leave in the month. */
function attendanceEligible_(staffId, month) {
  var late = readObjects_(sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF')).some(function (r) {
    return String(r.StaffID) === String(staffId) && monthOf_(r.Date) === month && num_(r.LateMinutes) > 0;
  });
  if (late) return false;
  var onLeave = readObjects_(sheet_(getHrSpreadsheet_(), 'LEAVE_REQUEST')).some(function (r) {
    return String(r.StaffID) === String(staffId) && String(r.Status) === 'APPROVED' && monthOf_(r.StartDate) === month;
  });
  return !onLeave;
}

/** Sum OT_RECORDS amounts for the month (falls back to hours*rate). */
/** Big Cleaning bonus = BigCleaningAmount × cleaning days this month the staff actually attended. */
function bigCleaningBonus_(staffId, month, payload) {
  var amt = num_(getConfig_('BigCleaningAmount', '0'));
  if (!amt) return 0;
  if (payload && payload.bigCleaningDays != null) return round2_(amt * (parseInt(payload.bigCleaningDays, 10) || 0));
  var days = bigCleaningDays_().filter(function (d) { return String(d).slice(0, 7) === month; });
  if (!days.length) return 0;
  var att = readObjects_(sheet_(getHrSpreadsheet_(), 'CHECKIN_STAFF'));
  var attended = 0;
  days.forEach(function (d) {
    if (att.some(function (r) { return String(r.StaffID) === String(staffId) && dateStr_(new Date(r.Date)) === d && r.CheckIn; })) attended++;
  });
  return round2_(amt * attended);
}

/**
 * APPROVED OT totalled per month for one staff member → { 'YYYY-MM': amount }.
 *
 * `kind` splits the two things the slip must show APART: 'daily' is the evening late-checkout OT,
 * 'holiday' is a day off that was worked and agreed as a sum. Folding them into one figure was the
 * first version of this and it was wrong on the slip — a teacher saw "ค่าล่วงเวลาตอนเย็น 1,200"
 * on a month where 500 of it was a Sunday they came in for, and nothing said so.
 *
 * It matters beyond the slip: otCarryOver_ compares what a month APPROVED against what its saved
 * payslip PAID into OTEvening. If holiday OT is paid on its own line but still counted here as
 * evening OT, every month would look short-paid and carry the same amount forward for ever.
 */
function otApprovedByMonth_(staffId, kind) {
  var rate = num_(getConfig_('OTEveningRate', '0'));
  var out = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).forEach(function (r) {
    if (String(r.StaffID) !== String(staffId)) return;
    // only APPROVED OT is paid. A blank Status is a legacy pre-workflow row → treat it as approved.
    var st = String(r.Status || '').toUpperCase();
    if (st && st !== 'APPROVED') return;
    var isHol = otIsHoliday_(r);
    if (kind === 'holiday' && !isHol) return;
    if (kind !== 'holiday' && isHol) return;      // default = daily only
    // Month is written as 'YYYY-MM' and comes back from Sheets as a DATE — ym7_ before comparing,
    // or every month bucket lands under the string "Mon Jul" and the totals read 0.
    var m = ym7_(r.Month) || monthOf_(r.Date);
    if (!m) return;
    var amt = (r.Amount !== '' && r.Amount != null) ? num_(r.Amount) : num_(r.Hours) * rate;
    out[m] = round2_((out[m] || 0) + amt);
  });
  return out;
}

function sumMonthlyOT_(staffId, month) {
  return round2_(otApprovedByMonth_(staffId)[ym7_(month)] || 0);
}
/** OT วันหยุด approved for that month — its own line on the slip, never inside OT เย็น. */
function sumMonthlyHolidayOT_(staffId, month) {
  return round2_(otApprovedByMonth_(staffId, 'holiday')[ym7_(month)] || 0);
}

/**
 * OT approved AFTER an earlier month's payroll was already saved, and therefore never paid — e.g. a
 * 31/07 late check-out approved in August once July's salary had gone out. Each earlier month owes
 *     approved(m) − what that month's saved payslip actually paid − what later payslips already carried
 * so nothing is paid twice and nothing is silently dropped. A month with NO saved payslip is not
 * carried: its own payroll run will pay it normally.
 */
function otCarryOver_(staffId, month) {
  var mm = ym7_(month);
  var approved = otApprovedByMonth_(staffId);
  var paidFor = {}, carriedFor = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'PAYROLL')).forEach(function (r) {
    if (String(r.StaffID) !== String(staffId)) return;
    var m = ym7_(r.Month);
    if (!m || m >= mm) return;            // this month's own row (and any later one) must not count
    paidFor[m] = round2_((paidFor[m] || 0) + num_(r.OTEvening));
    var d = r.OTCarryDetail;
    if (typeof d === 'string' && d) { try { d = JSON.parse(d); } catch (e) { d = null; } }
    (Array.isArray(d) ? d : []).forEach(function (c) {
      var cm = ym7_(c && c.month);
      if (cm) carriedFor[cm] = round2_((carriedFor[cm] || 0) + num_(c && c.amount));
    });
  });
  /* HOW MANY HOURS IS THE CARRY-OVER? The teacher's question, and the slip only ever said baht.
   * The carry is an AMOUNT (that is how it is paid), so the hours behind it are that amount's share
   * of the month it came from: fully unpaid month → all of its hours; half of it → half. Reported
   * so a teacher can check "OT ยกมา 300 บาท" against the three evenings they remember working. */
  var approvedHrs = otApprovedHoursByMonth_(staffId);
  var approvedDays = otApprovedDaysByMonth_(staffId);
  var detail = [], total = 0;
  Object.keys(paidFor).forEach(function (m) {
    var unpaid = round2_((approved[m] || 0) - paidFor[m] - (carriedFor[m] || 0));
    if (unpaid > 0.5) {
      var share = (approved[m] > 0) ? (unpaid / approved[m]) : 0;
      // `days` is EVERY approved evening of that month, not "the unpaid ones" — nothing in the data
      // says which evenings the shortfall belongs to (see otApprovedDaysByMonth_). `approved` is the
      // month's full approved total, so the screen can show the shortfall against it honestly.
      detail.push({ month: m, amount: unpaid, hours: round2_((approvedHrs[m] || 0) * share),
        approved: round2_(approved[m] || 0), paid: round2_(paidFor[m] || 0), days: approvedDays[m] || [] });
      total = round2_(total + unpaid);
    }
  });
  detail.sort(function (a, b) { return a.month < b.month ? -1 : (a.month > b.month ? 1 : 0); });
  return { total: total, detail: detail };
}

/**
 * The individual APPROVED daily-OT ENTRIES per month → { 'YYYY-MM': [{date, hours, amount, note}] }.
 *
 * Asked 2026-08-30: "มีรายละเอียด OT ของคุณครูแต่ละคนว่ายกมาจากเดือนก่อนหน้าวันไหน และเดือนนี้ OT
 * วันไหนบ้าง". The carry-over line said "มิถุนายน 2569 ฿300" and nothing else, so the only way to
 * check it was to open the sheet.
 *
 * A WORD ON WHAT THIS CAN HONESTLY SAY. The carry is an AMOUNT — approved(month) minus what that
 * month's payslip actually paid — and there is nothing in the data that attributes the shortfall to
 * particular evenings. So these are every approved evening OF THAT MONTH, presented as what the
 * month was made of, and the screen says so. Guessing which three evenings went unpaid would look
 * more precise and be less true.
 */
function otApprovedDaysByMonth_(staffId) {
  var rate = num_(getConfig_('OTEveningRate', '0'));
  var out = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).forEach(function (r) {
    if (String(r.StaffID) !== String(staffId)) return;
    var st = String(r.Status || '').toUpperCase();
    if (st && st !== 'APPROVED') return;
    if (otIsHoliday_(r)) return;
    var m = ym7_(r.Month) || monthOf_(r.Date);
    if (!m) return;
    (out[m] = out[m] || []).push({
      date: dateStr_(new Date(r.Date)), hours: num_(r.Hours),
      amount: (r.Amount !== '' && r.Amount != null) ? num_(r.Amount) : round2_(num_(r.Hours) * rate),
      note: String(r.Note || '')
    });
  });
  Object.keys(out).forEach(function (m) {
    out[m].sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  });
  return out;
}

/** APPROVED daily-OT HOURS per month — the hours behind otApprovedByMonth_'s amounts. Holiday OT is
 *  a lump sum with no hours and is excluded there, so it is excluded here too. */
function otApprovedHoursByMonth_(staffId) {
  var out = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).forEach(function (r) {
    if (String(r.StaffID) !== String(staffId)) return;
    var st = String(r.Status || '').toUpperCase();
    if (st && st !== 'APPROVED') return;
    if (otIsHoliday_(r)) return;
    var m = ym7_(r.Month) || monthOf_(r.Date);
    if (!m) return;
    out[m] = round2_((out[m] || 0) + num_(r.Hours));
  });
  return out;
}

/**
 * 'สิงหาคม 2569' from a month cell. The notification below goes to a person, not to a log, and
 * "2026-08-01T00:00:00.000Z" is what a Month cell reads back as once Sheets has coerced it — the
 * same trap ym7_ exists for. Falls back to the raw month if it cannot be parsed, never to nothing.
 */
var TH_MONTH_NAMES_ = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                       'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function thMonthLabel_(v) {
  var m7 = ym7_(v);
  var mm = /^(\d{4})-(\d{2})$/.exec(m7);
  if (!mm) return String(v == null ? '' : v);
  var i = parseInt(mm[2], 10) - 1;
  if (i < 0 || i > 11) return m7;
  return TH_MONTH_NAMES_[i] + ' ' + (parseInt(mm[1], 10) + 543);
}

/** Route: { staffId, month } -> unpaid OT carried from earlier months (shown on the payroll screen). */
function handleOtCarryOver(p) {
  p = p || {};
  var c = otCarryOver_(p.staffId, p.month || dateStr_(new Date()).slice(0, 7));
  var hrs = 0;
  (c.detail || []).forEach(function (d) { hrs = round2_(hrs + num_(d.hours)); });
  return { staffId: p.staffId, month: p.month, total: c.total, hours: hrs, detail: c.detail };
}

/** Route: { staffId, month } -> stored payroll (for slip view). */
// Admin records that a salary has actually been transferred: ticks it paid and (optionally) keeps the
// transfer slip. financeSummary already reads SlipSent to decide the ✓ in the salary list.
function handleMarkSalaryPaid(p) {
  p = p || {};
  var sh = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  try { ensureColumns_(sh, ['SlipUrl', 'PaidDate', 'PaidBy']); } catch (e) {}
  var row = findObject_(sh, function (r) {
    return String(r.StaffID) === String(p.staffId) && ym7_(r.Month) === ym7_(p.month);
  });
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีรายการจ่ายของเดือนนี้ — กดบันทึกเงินเดือนก่อน');
  var paid = p.paid !== false;
  var patch = { SlipSent: paid ? 'YES' : 'NO', PaidDate: paid ? dateStr_(new Date()) : '', PaidBy: p.adminId || 'admin' };
  if (p.slipUrl) patch.SlipUrl = p.slipUrl;          // a data: URL is offloaded to Drive by updateRow_
  if (!paid) patch.SlipUrl = '';
  updateRow_(sh, row._row, patch);
  try { logAuditHr(p.adminId || 'admin', paid ? 'SALARY_PAID' : 'SALARY_UNPAID', 'PAYROLL', row.PayrollID); } catch (e) {}
  /* TELL THE PERSON WHOSE PAY IT IS.
   * Asked 2026-08-30: "Role คุณครูและหัวหน้าครู มีการแจ้งเตือนว่า Admin ได้ทำการส่งสลิปให้แล้ว".
   * Until now the slip simply appeared and the only way to find out was to go and look, so teachers
   * checked repeatedly around payday — which is also what was quietly creating payroll rows before
   * v303. The 🔔 bell already serves staff (handleStaffInbox); this addresses a row to them.
   *
   * IN-APP ONLY, deliberately: the school's free LINE quota is exhausted, and a monthly push per
   * staff member is exactly the kind of traffic that exhausted it. Emergencies still go to LINE.
   *
   * Best-effort — a notification that fails must never undo a payment that succeeded. */
  if (paid) {
    try {
      inboxAdd_('payslip',
        '📄 สลิปเงินเดือน ' + thMonthLabel_(row.Month) + ' ออกให้แล้ว · โอนสุทธิ ' +
        Number(row.NetPay || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        ' บาท — เปิดดูได้ที่เมนูสลิปเงินเดือน',
        row.PayrollID, p.staffId);
    } catch (e) { try { Logger.log('payslip notify ' + e.message); } catch (x) {} }
  }
  return { ok: true, staffId: p.staffId, month: p.month, paid: paid };
}

/**
 * The slip, with the accumulated fund WORKED OUT rather than read back.
 *
 * เงินสมทบ is a savings fund: the teacher's half is deducted and the school matches it, so the fund
 * grows by BOTH halves — 200 deducted means 400 added. The running total was written onto the
 * payroll row when it was calculated, so a row saved before the employer half was recorded holds a
 * total short by the school's share for every such month. That is "35,200 where it should say
 * 35,400": one month's matching 200 missing from a figure computed before the app tracked it.
 *
 * The total is derivable — opening balance plus both halves of every month — so it is derived here
 * on every read, and a stale stored figure can no longer reach a payslip. A month whose employer
 * half was never written down has it reconstructed at the current match rate: the school did pay it,
 * the app just did not record it. Mirrors the engine's getPayslip.
 */
function handleGetPayslip(payload) {
  payload = payload || {};
  var sheet = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  var row = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(payload.staffId) && ym7_(r.Month) === ym7_(payload.month);
  });
  // NULL, not an error. "No slip saved for this month yet" is the NORMAL state until the admin runs
  // payroll, and the engine has always answered it with null — but this route shadows the engine and
  // used to throw, so every caller written against null broke on live:
  //   · a teacher unlocking their own payslip screen got nothing at all, instead of the calculated
  //     preview the very next line falls back to;
  //   · printing a month produced one failure per staff member.
  // It is also 21% of all getPayslip calls in the 2026-08-11 report — a normal state counted as a
  // failure, which hides the real ones.
  if (!row) return null;

  var staff = findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'), function (s) {
    return String(s.StaffID) === String(payload.staffId);
  }) || {};
  var matchRate = num_(getConfig_('ContributionMatchRate', '1'), 1);
  var empOf = function (r) {
    var own = num_(r.Contribution);
    return (r.ContributionEmployer === '' || r.ContributionEmployer == null) ? round2_(own * matchRate) : num_(r.ContributionEmployer);
  };
  var accum = num_(staff.ContributionOpening);
  try {
    readObjects_(sheet).forEach(function (r) {
      if (String(r.StaffID) !== String(payload.staffId)) return;
      accum += num_(r.Contribution) + empOf(r);
    });
  } catch (e) { accum = num_(row.ContributionAccum); }   // never fail the slip over a total

  row.ContributionEmployer = empOf(row);
  row.ContributionAccum = round2_(accum);
  return row;
}

/** Route: compute payroll then return it. */
/**
 * SAVING A PAYROLL ROW IS THE ADMIN'S. LOOKING AT ONE IS NOT.
 *
 * Found 2026-08-29 while working out where ครูจอย's four July rows came from. The teacher's own
 * payslip screen falls back to computePayroll when a month has no saved slip — and it asked for the
 * REAL thing, not a preview. computePayroll PERSISTS. So a teacher flipping back through months to
 * find a slip for the bank was writing a payroll row for herself on every month that did not have
 * one, and before ym7_ fixed the month lookup each visit APPENDED ANOTHER.
 *
 * That is a permissions hole and a money bug at the same time: rows nobody approved, counted in the
 * school's salary expense, computed from whatever defaults happened to apply.
 *
 * The client now asks for a preview, and this makes that unnecessary to trust: applyIdentity_ stamps
 * `role` onto every non-admin session and never onto an admin's, so a role that is present and is
 * not Admin is conclusive — those callers get a preview whatever they sent. Nothing is taken away
 * from the teacher: preview returns exactly the same figures, it just does not write them down.
 */
function handleComputePayroll(payload) {
  payload = payload || {};
  if (payload.role && payload.role !== 'Admin') payload.preview = true;
  return computePayroll(payload);
}

/**
 * THE MONTHS THIS PERSON ACTUALLY HAS A PAYSLIP FOR.
 *
 * Asked 2026-08-29: a teacher needs old slips for a loan or an account, and the screen offered a
 * bare month picker — every month since the dawn of time, most of them empty, with no way to know
 * which ones exist without trying them one at a time. (And "trying" is what was writing the rows
 * above.) A list of the real ones is both the answer and the thing that stops the guessing.
 *
 * Read-only, and scoped to the caller: applyIdentity_ forces staffId to the signed-in teacher, so
 * this cannot be used to read somebody else's pay history.
 */
function handleMyPayslipMonths(p) {
  p = p || {};
  var staffId = String(p.staffId || '').trim();
  if (!staffId) throw apiError_('BAD_INPUT', 'ต้องระบุ StaffID');
  var seen = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'PAYROLL')).forEach(function (r) {
    if (String(r.StaffID) !== staffId) return;
    var m = ym7_(r.Month); if (!m) return;
    /* One entry per MONTH, not per row. A duplicate month (see handlePayrollDuplicates) must not
     * appear twice in a teacher's own list — and the one worth showing them is the one that was
     * paid or sent, which is the same order of evidence the duplicate finder uses. */
    var cand = { month: m, netPay: num_(r.NetPay),
      slipSent: String(r.SlipSent || '').toUpperCase() === 'YES',
      paidDate: r.PaidDate ? payDate_(r.PaidDate) : '' };
    var cur = seen[m];
    if (!cur) { seen[m] = cand; return; }
    var better = (!!cand.paidDate && !cur.paidDate) ||
                 (!!cand.paidDate === !!cur.paidDate && cand.slipSent && !cur.slipSent) ||
                 (!!cand.paidDate === !!cur.paidDate && cand.slipSent === cur.slipSent && cand.netPay > cur.netPay);
    if (better) seen[m] = cand;
  });
  var months = Object.keys(seen).sort().reverse().map(function (m) { return seen[m]; });
  return { staffId: staffId, count: months.length, months: months };
}

/**
 * Rebuild every staff member's accumulated เงินสมทบ from source:
 *     ContributionOpening + Σ (each month's own half + the school's matching half)
 * Payslips saved before the employer half existed have no ContributionEmployer cell, so their match
 * is reconstructed at the current rate. ALWAYS runs as a preview first — the caller gets a
 * before/after line per staff member and NOTHING is written until it is called with preview:false.
 * ContributionLocked ('YES') locks the manually-entered OPENING balance, not this derived running
 * total — the total is refreshed on every payroll save too, so it is refreshed here as well. The
 * lock is still reported so the reviewer can see whose opening figure is fixed.
 */
function handleRecomputeContributions(p) {
  p = p || {};
  var preview = p.preview !== false;
  var matchRate = num_(getConfig_('ContributionMatchRate', '1'), 1);
  var stSh = sheet_(getHrSpreadsheet_(), 'STAFF');
  try { ensureColumns_(stSh, ['ContributionOpening', 'ContributionAccum', 'ContributionLocked']); } catch (e) {}
  var rows = readObjects_(sheet_(getHrSpreadsheet_(), 'PAYROLL'));
  var out = [], written = 0;
  readObjects_(stSh).forEach(function (s) {
    var opening = num_(s.ContributionOpening), own = 0, emp = 0, months = 0;
    rows.forEach(function (r) {
      if (String(r.StaffID) !== String(s.StaffID)) return;
      var c = num_(r.Contribution), e = num_(r.ContributionEmployer);
      if (!c && !e) return;
      months++; own += c;
      emp += (r.ContributionEmployer === '' || r.ContributionEmployer == null) ? round2_(c * matchRate) : e;
    });
    var after = round2_(opening + own + emp);
    var before = num_(s.ContributionAccum);
    if (Math.abs(after - before) < 0.005) return;      // only report what actually moves
    var lk = String(s.ContributionLocked || '').toUpperCase();
    var locked = lk === 'YES' || lk === 'TRUE' || s.ContributionLocked === true;
    out.push({ staffId: s.StaffID, name: s.Name || s.NameEN || s.StaffID, opening: opening, months: months,
      employee: round2_(own), employer: round2_(emp), before: before, after: after,
      diff: round2_(after - before), locked: locked });
    if (!preview) { updateRow_(stSh, s._row, { ContributionAccum: after }); written++; }
  });
  if (!preview) {
    try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF']); } catch (e) {}
    try { logAuditHr(p.adminId || 'admin', 'CONTRIB_RECOMPUTE', 'STAFF', String(written)); } catch (e) {}
  }
  return { preview: preview, matchRate: matchRate, changed: out.length, written: written, rows: out };
}

/**
 * WIPE ONE STAFF MEMBER'S PROVIDENT FUND AND START AGAIN.
 *
 * ครูจอย's เงินสมทบ was entered wrong and the school wants to key it in correctly from today
 * (asked 2026-08-29). There is no way to "fix" a running total that was built from wrong monthly
 * figures plus a wrong opening balance: every month compounds the last. So it is reset to zero and
 * re-entered.
 *
 * THIS DELETES REAL MONEY FIGURES, so it is built as two separate calls:
 *
 *   preview (the default)  reads and reports, touches nothing;
 *   apply   (confirm:true) takes a FULL BACKUP OF BOTH WORKBOOKS FIRST, then writes.
 *
 * The backup is not decoration. It is the only way back — dailyBackup() copies the whole of MAIN and
 * HR into the backup folder, so a wrong staff member or a changed mind is a file away rather than
 * gone. It runs before the first cell is touched, and a backup that throws ABORTS the whole thing.
 *
 * WHAT IT CHANGES, and the part that has to be said out loud: zeroing Contribution on a payslip
 * already issued changes that slip's TotalDeductions and NetPay, because เงินสมทบ is a deduction.
 * The recomputed slip will no longer match the paper the teacher was handed. The school chose this
 * knowing it (the alternative — leaving the old slips alone — leaves the running total wrong for
 * ever, since the total is rebuilt from those very rows by recomputeContributions).
 *
 * ONE PERSON AT A TIME, by StaffID, and never all of them: there is no version of this worth
 * running across the whole school by accident.
 */
function handleContributionReset(p) {
  p = p || {};
  var staffId = String(p.staffId || '').trim();
  if (!staffId) throw apiError_('BAD_INPUT', 'ต้องระบุ StaffID');
  var confirm = p.confirm === true || String(p.confirm) === 'true';
  /* ZERO IS THE DEFAULT, NOT THE ONLY ANSWER.
   *
   * The first version could only wipe to nothing, and the live preview showed why that is not enough:
   * ครูจอย's accumulated total was 35,800 while the payslips on file held 400 — so the real fund is a
   * figure the school knows and the sheet cannot derive. Clearing to zero and leaving it there would
   * throw away a balance somebody is owed.
   *
   * So the school types the carried-over figure in and the monthly rows start again from it. Blank
   * still means zero (asked 2026-08-29: "ล้างเงินสมทบให้เป็น 0 หรือเลือกได้ และใส่เข้าไปเพื่อคำนวนใหม่").
   */
  var newOpening = (p.newOpening === undefined || p.newOpening === null || String(p.newOpening).trim() === '')
    ? 0 : Number(p.newOpening);
  if (!isFinite(newOpening) || newOpening < 0) throw apiError_('BAD_INPUT', 'ยอดยกมาต้องเป็นตัวเลขไม่ติดลบ');
  newOpening = round2_(newOpening);

  var stSh = sheet_(getHrSpreadsheet_(), 'STAFF');
  try { ensureColumns_(stSh, ['ContributionOpening', 'ContributionAccum', 'ContributionLocked']); } catch (e) {}
  var st = findObject_(stSh, function (x) { return String(x.StaffID) === String(staffId); });
  if (!st) throw apiError_('NOT_FOUND', 'ไม่พบพนักงาน ' + staffId);

  var paySh = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  var rows = readObjects_(paySh).filter(function (r) { return String(r.StaffID) === String(staffId); })
    .sort(function (a, b) { return String(ym7_(a.Month)).localeCompare(String(ym7_(b.Month))); });

  // what each month looks like now, and what it would look like after — worked out for BOTH calls,
  // so the preview and the write can never describe different arithmetic
  var months = [], sumOwn = 0, sumEmp = 0;
  rows.forEach(function (r) {
    var own = num_(r.Contribution), emp = num_(r.ContributionEmployer);
    var ded = num_(r.TotalDeductions), net = num_(r.NetPay);
    sumOwn += own; sumEmp += emp;
    months.push({
      payrollId: r.PayrollID, month: ym7_(r.Month), status: String(r.Status || ''),
      slipSent: String(r.SlipSent || ''),
      // gross and base travel too: the live preview turned up several rows for ONE month with tiny
      // net figures, and "which of these four is the real July" cannot be answered from the fund
      // column alone. Reported, never auto-merged — deleting somebody's payslip is not this tool's job.
      baseSalary: num_(r.BaseSalary), gross: num_(r.GrossIncome),
      contribution: own, contributionEmployer: emp,
      totalDeductions: ded, netPay: net,
      // เงินสมทบ is a DEDUCTION: removing it lowers the deductions and RAISES the net pay
      newTotalDeductions: round2_(ded - own),
      newNetPay: round2_(net + own),
      netPayChange: round2_(own)
    });
  });

  /* DOES THE STORED TOTAL AGREE WITH THE ROWS IT IS SUPPOSED TO BE MADE OF?
   *
   * accum should be opening + Σ(own + employer). On the live data it was 35,800 against 400 of
   * payslip contributions and an opening of 0 — a difference of 35,400 that exists nowhere the
   * system can see. That is the whole reason "just recompute it" is not an option (it would rebuild
   * 800 and quietly lose the rest), and it is the number the school has to decide about, so it is
   * reported rather than left for somebody to spot in a table. */
  var derived = round2_(num_(st.ContributionOpening) + sumOwn + sumEmp);
  // more than one payslip for the same month is a data problem in its own right — surfaced here
  // because this screen is the one place somebody is already looking at every row for this person
  var seen = {}, dupMonths = [];
  months.forEach(function (m) { if (seen[m.month] && dupMonths.indexOf(m.month) < 0) dupMonths.push(m.month); seen[m.month] = 1; });

  var out = {
    staffId: staffId, name: st.Name || st.NameEN || staffId,
    before: {
      opening: num_(st.ContributionOpening),
      accum: num_(st.ContributionAccum),
      locked: String(st.ContributionLocked || ''),
      payrollRows: months.length,
      sumEmployee: round2_(sumOwn), sumEmployer: round2_(sumEmp),
      // what the stored total WOULD be if it were rebuilt from these rows, and the gap if it is not
      derivedAccum: derived,
      unexplained: round2_(num_(st.ContributionAccum) - derived)
    },
    newOpening: newOpening,
    duplicateMonths: dupMonths,
    months: months,
    // the slips that were already sent — the ones whose paper copy will stop matching
    slipsAlreadySent: months.filter(function (m) { return String(m.slipSent).toUpperCase() === 'YES'; }).length,
    preview: !confirm
  };
  if (!confirm) { out.note = 'PREVIEW ONLY — nothing was written. Call again with confirm:true to apply.'; return out; }

  /* BACK UP BOTH WORKBOOKS BEFORE THE FIRST CELL IS TOUCHED. If this throws, nothing is written:
   * a destructive change with no way back is not one worth making faster. */
  var backup;
  try { backup = dailyBackup(); }
  catch (e) { throw apiError_('BACKUP_FAILED', 'สำรองข้อมูลไม่สำเร็จ จึงยังไม่ได้แก้ไขอะไรเลย: ' + (e && e.message || e)); }
  out.backup = backup;

  months.forEach(function (m) {
    var r = findObject_(paySh, function (x) { return String(x.PayrollID) === String(m.payrollId); });
    if (!r) return;
    updateRow_(paySh, r._row, {
      Contribution: 0, ContributionEmployer: 0,
      TotalDeductions: m.newTotalDeductions, NetPay: m.newNetPay,
      // the running total AS AT that month. Every month's own half is now zero, so each of them
      // stands at the opening balance — not at zero, or an old slip would print a fund of nothing
      // for somebody who is carrying a real balance.
      ContributionAccum: newOpening
    });
  });
  /* Opening AND accum are set to the SAME figure, because every monthly row was just zeroed: with
   * nothing left to add, the running total IS the opening balance. Writing accum from newOpening
   * rather than leaving it to the next payroll run means the number is right on the screen
   * immediately, which matters when payroll is being done the same afternoon. */
  updateRow_(stSh, st._row, { ContributionOpening: newOpening, ContributionAccum: newOpening });
  try { CacheService.getScriptCache().removeAll(['col:STAFF', 'rows:STAFF', 'col:PAYROLL', 'rows:PAYROLL']); } catch (e) {}
  try { logAuditHr(p.adminId || 'admin', 'CONTRIB_RESET', 'STAFF',
    staffId + ' opening ' + out.before.opening + '→' + newOpening +
    ' accum ' + out.before.accum + '→' + newOpening + ' rows ' + months.length); } catch (e) {}

  // read it back rather than assert it — the whole point of the call is the number afterwards
  var st2 = findObject_(stSh, function (x) { return String(x.StaffID) === String(staffId); }) || {};
  var rows2 = readObjects_(paySh).filter(function (r) { return String(r.StaffID) === String(staffId); });
  out.after = {
    opening: num_(st2.ContributionOpening), accum: num_(st2.ContributionAccum),
    payrollRows: rows2.length,
    sumEmployee: round2_(rows2.reduce(function (a, r) { return a + num_(r.Contribution); }, 0)),
    sumEmployer: round2_(rows2.reduce(function (a, r) { return a + num_(r.ContributionEmployer); }, 0))
  };
  return out;
}

/**
 * MORE THAN ONE PAYSLIP FOR ONE PERSON IN ONE MONTH — find them, and say which one to keep.
 *
 * Turned up on live data 2026-08-29: ครูจอย had FOUR rows for กรกฎาคม 2569. computePayroll upserts on
 * StaffID+Month, so it cannot produce these on its own — they predate it, or arrived another way —
 * but whatever made them, THE READERS DISAGREE about what to do with them, and that is the part that
 * matters:
 *
 *   financeSummary   .find()   -> the month's salary expense is whichever row is FIRST in the sheet
 *   getPayslip       .find()   -> the slip printed is that same arbitrary row
 *   markSalaryPaid   .find()   -> so is the row the "paid" tick lands on
 *   the slip list    .filter() -> prints FOUR slips for one teacher for one month
 *   recomputeContributions     -> sums the fund from EVERY duplicate
 *   otCarryOver_               -> sums OT paid across every duplicate, so carry-over is wrong
 *
 * So it is not simply "counted twice": some totals double-count and others are decided by row order.
 * Both are worse than an error, because neither says anything.
 *
 * READ-ONLY. It suggests a keeper and explains why; it deletes nothing (see handleDeletePayrollRow).
 */
/* A date / stamp from a payroll cell, made readable. Local to this file on purpose: Payroll.gs had
 * been reaching for insDate_ and insStamp_, which live in the INSURANCE module — it works on GAS
 * (one shared scope) and breaks the moment anything loads Payroll.gs without Day6.gs, which is
 * exactly what the test harness does. A payroll file should not depend on the insurance file to
 * print a date. */
function payDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return dateStr_(v);
  // \d, not d. These two regexes shipped with their backslashes lost, so they matched the LITERAL
  // letter d and never a date: payDate_ fell through to String(v) and put a raw
  // "Sat Aug 01 2026 00:00:00 GMT+0700 (Indochina Time)" on the duplicate-payslip screen.
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : String(v);
}
function payStamp_(v) {
  if (v === null || v === undefined || v === '') return '';
  var d = (Object.prototype.toString.call(v) === '[object Date]') ? v
        : (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? new Date(String(v)) : null);
  if (!d || isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm');
}
function handlePayrollDuplicates(p) {
  p = p || {};
  var wantStaff = String(p.staffId || '').trim();
  var wantMonth = p.month ? ym7_(p.month) : '';
  var staffById = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'STAFF')).forEach(function (s) { staffById[String(s.StaffID)] = s; });

  /* IT HAS TO SHOW ITS WORKING EVEN WHEN IT FINDS NOTHING.
   *
   * Reported 2026-08-30: "กดตรวจหาสลิปเงินเดือนซ้ำ ไม่ขึ้น มีแค่ข้อความบอกว่าสำเร็จ แต่ไม่มีข้อมูล
   * อะไรขึ้นมาเลย". The tool answered "ไม่พบสลิปซ้ำ" and stopped, which is indistinguishable from
   * the tool not having run — and the admin had every reason to doubt it, because they had been
   * told days earlier that ครูจอย had four rows for July.
   *
   * A diagnostic that reports a clean result without saying WHAT IT LOOKED AT is not evidence. So
   * `scanned` comes back either way: how many rows it read, how many it had to skip and why, the
   * months it covers, and a row count per staff member. If the count is zero and the scan says it
   * read 96 rows across 10 people, that is an answer. If it says it read 0, that is a different
   * answer entirely — and the screen can now tell them apart.
   */
  var scanRows = 0, skippedNoStaff = 0, skippedNoMonth = 0, perStaff = {}, allMonths = {};
  var byKey = {};
  readObjects_(sheet_(getHrSpreadsheet_(), 'PAYROLL')).forEach(function (r) {
    scanRows++;
    var sid = String(r.StaffID || ''), m = ym7_(r.Month);
    // counted, not silently dropped: a row the finder cannot place is a row it cannot vouch for
    if (!sid) { skippedNoStaff++; return; }
    if (!m) { skippedNoMonth++; return; }
    allMonths[m] = 1;
    var ps = perStaff[sid] || (perStaff[sid] = { staffId: sid, rows: 0, months: {} });
    ps.rows++; ps.months[m] = (ps.months[m] || 0) + 1;
    if (wantStaff && sid !== wantStaff) return;
    if (wantMonth && m !== wantMonth) return;
    var k = sid + '|' + m;
    (byKey[k] = byKey[k] || []).push(r);
  });

  var groups = [];
  Object.keys(byKey).forEach(function (k) {
    var rows = byKey[k];
    if (rows.length < 2) return;                       // one row per month is the normal case
    var parts = k.split('|'), sid = parts[0], m = parts[1];
    var st = staffById[sid] || {};
    var mapped = rows.map(function (r) {
      return {
        payrollId: r.PayrollID, month: m,
        baseSalary: num_(r.BaseSalary), gross: num_(r.GrossIncome),
        diligence: num_(r.DiligenceTotal), extraChild: num_(r.ExtraChildAmount),
        otEvening: num_(r.OTEvening), otHoliday: num_(r.OTHoliday),
        otherIncome: num_(r.OtherIncome), adjustments: num_(r.AdjustmentsTotal),
        socialSecurity: num_(r.SocialSecurity), contribution: num_(r.Contribution),
        otherDeductions: num_(r.OtherDeductions), totalDeductions: num_(r.TotalDeductions),
        netPay: num_(r.NetPay),
        slipSent: String(r.SlipSent || '').toUpperCase() === 'YES',
        paidDate: r.PaidDate ? String(payDate_(r.PaidDate)) : '',
        paidBy: String(r.PaidBy || ''),
        slipUrl: String(r.SlipUrl || ''),
        generatedDate: r.GeneratedDate ? String(payStamp_(r.GeneratedDate)) : '',
        generatedBy: String(r.GeneratedBy || ''),
        // a row with no pay in it at all is the easiest kind to be sure about
        empty: !num_(r.GrossIncome) && !num_(r.NetPay)
      };
    });
    /* WHICH ONE TO KEEP, by rules written down rather than by a feeling. In order, first match wins.
     * Money that has actually moved beats everything: a row somebody has been PAID against is the
     * row the bank statement agrees with. Where the rules cannot separate them the answer is an
     * explicit "a person has to look", never a guess dressed up as a recommendation. */
    var reason = '', keep = null;
    var paid = mapped.filter(function (x) { return !!x.paidDate; });
    var sent = mapped.filter(function (x) { return x.slipSent; });
    if (paid.length === 1) { keep = paid[0]; reason = 'PAID'; }
    else if (paid.length > 1) { reason = 'MANY_PAID'; }          // two rows both marked paid — human
    else if (sent.length === 1) { keep = sent[0]; reason = 'SLIP_SENT'; }
    else if (sent.length > 1) { reason = 'MANY_SENT'; }
    else {
      var real = mapped.filter(function (x) { return !x.empty; });
      if (real.length === 1) { keep = real[0]; reason = 'ONLY_REAL'; }
      else if (real.length > 1) {
        var top = real.slice().sort(function (a, b) {
          return (b.gross - a.gross) || String(b.generatedDate).localeCompare(String(a.generatedDate)); })[0];
        // only call it when the biggest is unambiguously biggest; equal pay is a human's decision
        var tied = real.filter(function (x) { return Math.abs(x.gross - top.gross) < 0.005; });
        if (tied.length === 1) { keep = top; reason = 'HIGHEST_GROSS'; }
        else { reason = 'IDENTICAL'; }
      } else { reason = 'ALL_EMPTY'; }
    }
    groups.push({
      staffId: sid, name: st.Name || st.NameEN || sid, nick: st.Nickname || '',
      month: m, count: rows.length, rows: mapped,
      keepId: keep ? keep.payrollId : '', reason: reason,
      // what the sheet-order readers (financeSummary, getPayslip) are using TODAY, which is not
      // necessarily the row anybody would have chosen
      currentlyUsedId: mapped[0].payrollId,
      // ...and the two places that ADD every duplicate together instead of picking one
      sumContribution: round2_(mapped.reduce(function (a, x) { return a + x.contribution; }, 0)),
      sumOtEvening: round2_(mapped.reduce(function (a, x) { return a + x.otEvening; }, 0))
    });
  });
  groups.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name)) || String(a.month).localeCompare(String(b.month));
  });
  var months = Object.keys(allMonths).sort();
  var staffScan = Object.keys(perStaff).map(function (sid) {
    var ps = perStaff[sid], st = staffById[sid] || {};
    var ms = Object.keys(ps.months).sort();
    return { staffId: sid, name: st.Name || st.NameEN || sid, nick: st.Nickname || '',
      rows: ps.rows, months: ms.length,
      // a month this person has more than one row for — the same thing `groups` reports, but present
      // even when a filter narrowed the search, so the summary never contradicts the finding
      dupMonths: ms.filter(function (m) { return ps.months[m] > 1; }) };
  }).sort(function (a, b) { return (b.dupMonths.length - a.dupMonths.length) || String(a.name).localeCompare(String(b.name)); });

  return { scope: wantStaff ? 'staff' : 'school', staffId: wantStaff, month: wantMonth,
           groups: groups, count: groups.length,
           scanned: { rows: scanRows, staff: staffScan.length, months: months.length,
                      from: months[0] || '', to: months[months.length - 1] || '',
                      skippedNoStaff: skippedNoStaff, skippedNoMonth: skippedNoMonth,
                      perStaff: staffScan } };
}

/**
 * Delete ONE payroll row, by its PayrollID.
 *
 * Separate from the finder on purpose, and never driven by it: the finder SUGGESTS a keeper, a person
 * decides, and this removes exactly the id they named. Backed up first, like every destructive route
 * here — and it REFUSES a row marked paid, because money moving against a row is the strongest
 * evidence there is that it is the real one. `force` exists for the MANY_PAID case, where two rows
 * both claim it and somebody has to be wrong.
 */
function handleDeletePayrollRow(p) {
  p = p || {};
  var id = String(p.payrollId || '').trim();
  if (!id) throw apiError_('BAD_INPUT', 'ต้องระบุ PayrollID');
  var sh = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  var r = findObject_(sh, function (x) { return String(x.PayrollID) === id; });
  if (!r) throw apiError_('NOT_FOUND', 'ไม่พบสลิป ' + id);
  var forced = (p.force === true || String(p.force) === 'true');
  if (r.PaidDate && !forced) {
    throw apiError_('ALREADY_PAID', 'สลิปนี้บันทึกว่าจ่ายเงินแล้ว (' + payDate_(r.PaidDate) + ') — ลบไม่ได้');
  }
  if (!(p.confirm === true || String(p.confirm) === 'true')) {
    // the preview shape, so a caller can show exactly what it is about to remove
    return { preview: true, payrollId: id, staffId: r.StaffID, month: ym7_(r.Month),
             netPay: num_(r.NetPay), gross: num_(r.GrossIncome),
             slipSent: String(r.SlipSent || ''), paidDate: r.PaidDate ? String(payDate_(r.PaidDate)) : '' };
  }
  var backup;
  try { backup = dailyBackup(); }
  catch (e) { throw apiError_('BACKUP_FAILED', 'สำรองข้อมูลไม่สำเร็จ จึงยังไม่ได้ลบอะไรเลย: ' + (e && e.message || e)); }
  sh.deleteRow(r._row);
  try { CacheService.getScriptCache().removeAll(['col:PAYROLL', 'rows:PAYROLL']); } catch (e) {}
  try { logAuditHr(p.adminId || 'admin', 'PAYROLL_ROW_DELETE', 'PAYROLL',
    id + ' ' + r.StaffID + ' ' + ym7_(r.Month) + ' net ' + num_(r.NetPay) + (forced ? ' FORCED' : '')); } catch (e) {}
  return { ok: true, payrollId: id, staffId: r.StaffID, month: ym7_(r.Month), backup: backup };
}
