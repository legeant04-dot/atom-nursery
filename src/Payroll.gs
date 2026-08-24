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
  var payType = payload.payType || 'monthly';
  var base = payType === 'daily'
    ? num_(payload.dailyRate) * num_(payload.daysWorked)
    : (payload.baseSalary != null ? num_(payload.baseSalary) : num_(staff.BaseSalary));

  // --- เบี้ยขยัน --- (unchanged: its own "no leave / no late" rule)
  var attEligible = (payload.attendanceEligible != null) ? !!payload.attendanceEligible
    : (payload.attendanceOverride != null) ? !!payload.attendanceOverride
    : attendanceEligible_(staff.StaffID, month);
  var attendAmt = (payload.diligenceAttend != null) ? num_(payload.diligenceAttend)
    : num_(getConfig_('DiligenceAttendanceAmount', '500'));
  var diligenceAttendance = attEligible ? attendAmt : 0;

  // --- กฎการลา: ลาทุกชนิดเกิน limit วัน/เดือน → ไม่คำนวณเรทจำนวนเด็ก ---
  // WARNING only; no field is locked — Admin may still enter a child count to override. Applied below.
  var leaveDays = allLeaveDays_(staff.StaffID, month);
  var leaveLimit = parseInt(getConfig_('DiligenceLeaveMaxDays', '3'), 10) || 3;
  var leaveExceeds = leaveDays > leaveLimit;
  var fbAmt = (payload.diligenceFb != null) ? num_(payload.diligenceFb)
    : num_(payload.facebookAmount, num_(getConfig_('DiligenceFacebookAmount', '500')));
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
  var childMultiplier = (payload.childMultiplier != null) ? num_(payload.childMultiplier)
    : num_(getConfig_('ExtraChildRate', '300'));
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
  var ssDeduct = (payload.socialSecurityDeduct != null) ? !!payload.socialSecurityDeduct : true;
  var ss = (payload.socialSecurity != null) ? num_(payload.socialSecurity)
    : (ssDeduct ? Math.min(round2_(base * num_(getConfig_('SocialSecurityRate', '0.05'))), num_(getConfig_('SocialSecurityMax', '750'))) : 0);
  // เงินสมทบ is a SAVINGS fund, not a cost to the teacher: the amount entered here is deducted from
  // their pay AND the school puts in the same again. Only the teacher's half is a deduction; the fund
  // grows by both halves. Entering 200 therefore deducts 200 and adds 400 to the accumulated total.
  var contribution = num_(payload.contribution);
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
    OTEvening: otEvening, OTCarry: otCarry, OTCarryDetail: JSON.stringify(otCarryDetail),
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
  var detail = [], total = 0;
  Object.keys(paidFor).forEach(function (m) {
    var unpaid = round2_((approved[m] || 0) - paidFor[m] - (carriedFor[m] || 0));
    if (unpaid > 0.5) {
      var share = (approved[m] > 0) ? (unpaid / approved[m]) : 0;
      detail.push({ month: m, amount: unpaid, hours: round2_((approvedHrs[m] || 0) * share) });
      total = round2_(total + unpaid);
    }
  });
  detail.sort(function (a, b) { return a.month < b.month ? -1 : (a.month > b.month ? 1 : 0); });
  return { total: total, detail: detail };
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
function handleComputePayroll(payload) { return computePayroll(payload); }

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
