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

  var base = num_(staff.BaseSalary);

  // --- เบี้ยขยัน ---
  var attEligible = (payload.attendanceOverride != null)
    ? !!payload.attendanceOverride : attendanceEligible_(staff.StaffID, month);
  var diligenceAttendance = attEligible ? num_(getConfig_('DiligenceAttendanceAmount', '500')) : 0;
  var diligenceFacebook = payload.facebookPosted
    ? num_(payload.facebookAmount, num_(getConfig_('DiligenceFacebookAmount', '500'))) : 0;
  var diligenceTotal = diligenceAttendance + diligenceFacebook;

  // --- รายได้อื่นๆ ---
  var extraChildCount = Math.max(0, parseInt(payload.extraChildCount, 10) || 0);
  var extraChildAmount = extraChildCount * num_(getConfig_('ExtraChildRate', '300'));
  var certCap = parseInt(getConfig_('TrainingCertMaxPerMonth', '2'), 10);
  var trainingCertCount = Math.min(certCap, Math.max(0, parseInt(payload.trainingCertCount, 10) || 0));
  var trainingCertAmount = trainingCertCount * num_(getConfig_('TrainingCertRate', '100'));
  var otherIncomeManual = num_(payload.otherIncome);
  var otherIncome = extraChildAmount + trainingCertAmount + otherIncomeManual;

  // --- OT เย็น ---
  var otEvening = (payload.otEvening != null) ? num_(payload.otEvening) : sumMonthlyOT_(staff.StaffID, month);
  var holidayBonus = num_(payload.holidayBonus);

  var gross = round2_(base + diligenceTotal + otherIncome + otEvening + holidayBonus);

  // --- รายการหัก ---
  var ss = (payload.socialSecurity != null) ? num_(payload.socialSecurity)
    : Math.min(round2_(base * num_(getConfig_('SocialSecurityRate', '0.05'))), num_(getConfig_('SocialSecurityMax', '750')));
  var contribution = num_(payload.contribution);
  var otherDeductions = num_(payload.otherDeductions);
  var totalDeductions = round2_(ss + contribution + otherDeductions);

  var netPay = round2_(gross - totalDeductions);

  var sheet = sheet_(getHrSpreadsheet_(), 'PAYROLL');
  var existing = findObject_(sheet, function (r) {
    return String(r.StaffID) === String(staff.StaffID) && String(r.Month) === month;
  });
  var rec = {
    StaffID: staff.StaffID, Month: month, BaseSalary: base,
    DiligenceAttendance: diligenceAttendance, DiligenceFacebook: diligenceFacebook, DiligenceTotal: diligenceTotal,
    ExtraChildCount: extraChildCount, ExtraChildAmount: extraChildAmount,
    TrainingCertCount: trainingCertCount, TrainingCertAmount: trainingCertAmount,
    OTEvening: otEvening, HolidayBonus: holidayBonus, OtherIncome: otherIncome, GrossIncome: gross,
    SocialSecurity: ss, Contribution: contribution, OtherDeductions: otherDeductions, TotalDeductions: totalDeductions,
    NetPay: netPay, BankAccount: getConfig_('BankName', 'SCB'), SlipSent: existing ? existing.SlipSent : 'NO',
    GeneratedDate: new Date(), GeneratedBy: payload.generatedBy || 'system'
  };
  if (existing) { rec.PayrollID = existing.PayrollID; updateRow_(sheet, existing._row, rec); }
  else { rec.PayrollID = nextId_(sheet, 'PayrollID', 'PR'); appendObject_(sheet, rec); }
  logAuditHr(payload.generatedBy || 'system', existing ? 'PAYROLL_UPDATE' : 'PAYROLL_CREATE', 'PAYROLL', rec.PayrollID);

  return rec;
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
function sumMonthlyOT_(staffId, month) {
  var rate = num_(getConfig_('OTEveningRate', '0'));
  var total = 0;
  readObjects_(sheet_(getHrSpreadsheet_(), 'OT_RECORDS')).forEach(function (r) {
    if (String(r.StaffID) === String(staffId) && monthOf_(r.Date) === month) {
      total += r.Amount !== '' ? num_(r.Amount) : num_(r.Hours) * rate;
    }
  });
  return round2_(total);
}

/** Route: { staffId, month } -> stored payroll (for slip view). */
function handleGetPayslip(payload) {
  payload = payload || {};
  var row = findObject_(sheet_(getHrSpreadsheet_(), 'PAYROLL'), function (r) {
    return String(r.StaffID) === String(payload.staffId) && String(r.Month) === String(payload.month);
  });
  if (!row) throw apiError_('NOT_FOUND', 'ยังไม่มีสลิปเงินเดือนของเดือนนี้');
  return row;
}

/** Route: compute payroll then return it. */
function handleComputePayroll(payload) { return computePayroll(payload); }
