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
  var gross = round2_(base + diligenceTotal + otherIncome + otEvening + holidayBonus);

  // --- รายการหัก ---
  // the client sends socialSecurityDeduct (the checkbox). Only an explicit socialSecurity NUMBER
  // overrides the calculation; unticking must zero it, which is what was being ignored.
  var ssDeduct = (payload.socialSecurityDeduct != null) ? !!payload.socialSecurityDeduct : true;
  var ss = (payload.socialSecurity != null) ? num_(payload.socialSecurity)
    : (ssDeduct ? Math.min(round2_(base * num_(getConfig_('SocialSecurityRate', '0.05'))), num_(getConfig_('SocialSecurityMax', '750'))) : 0);
  var contribution = num_(payload.contribution);
  var otherDeductions = round2_(num_(payload.otherDeductions) + adjMinus);
  var totalDeductions = round2_(ss + contribution + otherDeductions);

  var netPay = round2_(gross - totalDeductions);   // adjustments are already inside the two totals

  var sheet = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  // running total of เงินสมทบ across every month on file — the school's slip prints it at the bottom
  // the school carried an accumulated เงินสมทบ before the app existed; that opening balance lives on
  // the staff record and every month's contribution adds on top of it
  // opening balance carried from before the app + every month recorded here (this one included)
  var contribAccum = num_(staff.ContributionOpening) + contribution;
  try {
    readObjects_(sheet).forEach(function (r) {
      if (String(r.StaffID) === String(staff.StaffID) && ym7_(r.Month) !== ym7_(month)) contribAccum += num_(r.Contribution);
    });
  } catch (e) {}
  contribAccum = round2_(contribAccum);
  try { ensureColumns_(sheet, ['PayType', 'DailyRate', 'DaysWorked', 'ChildMultiplier', 'Adjustments',
    'AdjustmentsTotal', 'BankName', 'LeaveDays', 'LeaveLimit', 'LeaveExceeds',
    'ContributionAccum', 'Position', 'StaffName']); } catch (e) {}
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
    OTEvening: otEvening, HolidayBonus: holidayBonus, OtherIncome: otherIncome, GrossIncome: gross,
    SocialSecurity: ss, Contribution: contribution, OtherDeductions: otherDeductions, TotalDeductions: totalDeductions,
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

function sumMonthlyOT_(staffId, month) {
  var rate = num_(getConfig_('OTEveningRate', '0'));
  var total = 0;
  readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).forEach(function (r) {
    // only APPROVED OT is paid. A blank Status is a legacy pre-workflow row → treat it as approved.
    var st = String(r.Status || '').toUpperCase();
    if (st && st !== 'APPROVED') return;
    var m = String(r.Month || '') || monthOf_(r.Date);
    if (String(r.StaffID) === String(staffId) && String(m).slice(0, 7) === month) {
      total += r.Amount !== '' ? num_(r.Amount) : num_(r.Hours) * rate;
    }
  });
  return round2_(total);
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

function handleGetPayslip(payload) {
  payload = payload || {};
  var row = findObject_(sheet_(getHrSpreadsheet_(), 'PAYROLL'), function (r) {
    return String(r.StaffID) === String(payload.staffId) && ym7_(r.Month) === ym7_(payload.month);
  });
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีสลิปเงินเดือนของเดือนนี้');
  return row;
}

/** Route: compute payroll then return it. */
function handleComputePayroll(payload) { return computePayroll(payload); }
