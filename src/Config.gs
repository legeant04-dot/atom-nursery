/**
 * Config.gs — Atom Nursery
 * ------------------------------------------------------------------
 * Single source of truth for:
 *   - Workbook names & Script Property keys
 *   - The full database SCHEMA (every sheet + its column headers)
 *   - Default SCHOOL_CONFIG values
 *
 * Column headers follow Proposal v2.1 §7 "โครงสร้าง Google Sheets
 * Database (2 Workbooks / 1 Gmail)" exactly. Two sheets are inferred
 * to reconcile the §7 list (14 + 7) with the Day-1 task count
 * (15 + 8): COMMENTS (Workbook 1, chat feature from §4) and a second
 * AUDIT_LOG (Workbook 2, PDPA access logging for the sensitive HR
 * data). These are marked INFERRED below — confirm with the school.
 * ------------------------------------------------------------------
 */

// ---- Workbook identity --------------------------------------------
var WB = {
  MAIN: 'AtomNursery_Main',
  HR:   'AtomNursery_HR'
};

// Script Property keys where the created spreadsheet IDs are stored,
// so the rest of the backend can re-open them without hardcoding IDs.
var PROP = {
  MAIN_ID: 'WB_MAIN_ID',
  HR_ID:   'WB_HR_ID'
};

// ---- Database schema ----------------------------------------------
// Key = sheet name (tab). Value = ordered list of column headers.
var SCHEMA = {};

// Workbook 1 — AtomNursery_Main (school data) — 15 sheets
SCHEMA[WB.MAIN] = {
  // 2026 expansion: + NationalID (student code, Admin-only), Nickname/Gender/Plan, Weight/Height/Photo,
  // BloodType/RH, Race/Nationality/Religion, EnrollDate, LastGrowthUpdate, and the insurance block.
  // DriveFolderUrl = the per-student Google Drive folder created on enrollment (holds that child's photos,
  // assessments and all documents). Withdraw* capture an exit from the system (parent self-service or Admin).
  STUDENTS:          ['StudentID', 'NationalID', 'Name', 'NameEN', 'Nickname', 'NicknameEN', 'Gender', 'DOB', 'Class', 'ParentID', 'Plan',
                      'Weight', 'Height', 'Photo', 'BloodType', 'RH', 'Allergy', 'Vaccine', 'MedicalHistory',
                      'Race', 'Nationality', 'Religion', 'EmergencyContact', 'Address', 'EnrollDate', 'LastGrowthUpdate',
                      'InsuranceHas', 'InsurancePolicyNo', 'InsuranceCompany', 'InsuranceExpiry', 'InsuranceCardImage',
                      'DriveFolderUrl', 'WithdrawReason', 'WithdrawDetail', 'WithdrawDate', 'WithdrawBy',
                      'Status', 'CreatedDate',
                      'OTRate'],   // per-student late-pickup OT rate/hour; blank = SCHOOL_CONFIG OTRatePerHour
  CLASSES:           ['ClassID', 'ClassName', 'TeacherID', 'AgeRange', 'Capacity'],
  // Photo / RegisterPhotoUrl = the MANDATORY live-capture photo taken at registration ("New Register Photo"
  // Drive folder), used as an identity/security check when signing in.
  PARENTS:           ['ParentID', 'NationalID', 'Name', 'NameEN', 'Relationship', 'Phone', 'Occupation', 'Workplace', 'OfficePhone', 'LineUID', 'StudentID', 'Address', 'Photo', 'RegisterPhotoUrl'],
  // Pickup persons authorized other than parents (PDPA application form §3)
  PICKUP_PERSONS:    ['StudentID', 'Name', 'Phone', 'Relation'],
  // user <-> student data-access links (data isolation; supports father linking after mother registered)
  USER_LINKS:        ['UserUID', 'StudentID', 'VerifiedBy', 'Date'],
  // Remark + ByStaffID: set when a TEACHER checks a student in/out on behalf of an unregistered
  // pickup person (remark is mandatory). Appended at the END — never insert mid-schema.
  CHECKIN_STUDENT:   ['Date', 'Time', 'StudentID', 'ParentID', 'Type', 'GPS_Lat', 'GPS_Lng', 'Status', 'Remark', 'ByStaffID'],
  // Daily OT (overtime) charges — created on late pickup, settled via the OT (KTB) QR
  // PaymentMethod = transfer | cash; TransactionDate = when the parent notified payment; PaidDate set on Admin confirm.
  OT_DAILY:          ['OTID', 'Date', 'StudentID', 'PickupTime', 'PlanEnd', 'LateMinutes', 'Hours', 'Amount', 'Status', 'SlipRef', 'SlipAmount', 'PaymentMethod', 'TransactionDate', 'PaidDate'],
  // Growth measurement history feeding the development line charts
  GROWTH_RECORDS:    ['Date', 'StudentID', 'AgeMonth', 'Weight', 'Height'],
  // Holiday database (editable per year) merged into the shared calendar
  HOLIDAYS:          ['Date', 'NameTH', 'NameEN', 'Recurring'],
  // HealthDetail..UpdatedAt were appended after go-live — new columns only ever go at the END.
  // Status = DRAFT (teacher keeps editing, parent not notified) | SUBMITTED (sent to the parent, locked).
  // A blank Status is a legacy row from before the draft flow: treat it as SUBMITTED.
  // SubmittedAt = when it was sent; UpdatedAt = last save of either kind.
  DAILY_JOURNAL:     ['Date', 'StudentID', 'TeacherID', 'Mood', 'Health', 'Milk', 'Meals', 'Sleep', 'Toilet', 'Activity', 'Skills', 'Highlight', 'HealthDetail', 'MilkTotal', 'Water', 'Theme', 'SubmittedAt', 'Status', 'UpdatedAt'],
  DSPM_ASSESSMENT:   ['AssessmentID', 'StudentID', 'AgeMonth', 'ItemNo', 'Skill', 'Result', 'Date', 'TeacherID'],
  // PaymentMethod = transfer | cash; TransactionDate = when payment was notified; PaidDate = Admin-confirmed payment date (retro-auditable).
  BILLING:           ['BillingID', 'StudentID', 'Month', 'Amount', 'OTRollover', 'DueDate', 'PaidDate', 'Status', 'SlipAmount', 'VerifiedStatus', 'QRRef', 'PaymentMethod', 'TransactionDate'],
  ANNOUNCEMENTS:     ['AnnID', 'Title', 'TitleEN', 'Content', 'ContentEN', 'Image', 'Date', 'Type', 'TargetGroup', 'Popup', 'StartDate', 'EndDate'],
  // Per-student extra charges merged into the monthly bill
  STUDENT_CHARGES:   ['ChargeID', 'StudentID', 'Month', 'Label', 'Amount'],
  // Advance tuition payments (with discount) + the months they cover
  PREPAYMENTS:       ['PrepayID', 'StudentID', 'Months', 'Discount', 'Gross', 'Amount', 'Covered', 'Status', 'SlipUrl', 'SlipAmount', 'VerifiedStatus', 'Date', 'PaymentMethod', 'TransactionDate', 'PaidDate'],
  // Absence tracking (leave/no-show) + teacher follow-up
  ABSENCE_LOG:       ['StudentID', 'Date', 'Type', 'Reason'],
  ABSENCE_FOLLOWUP:  ['StudentID', 'Note', 'Status', 'Date'],
  // Per-student vaccine records (standard schedule 1mo–6yr)
  VACCINE_RECORDS:   ['StudentID', 'VaccineKey', 'VaccineName', 'DoseDate', 'Note'],
  PAYMENT_SLIPS:     ['SlipID', 'RefKind', 'RefID', 'StudentID', 'Amount', 'Url', 'FileId', 'Verified', 'TransRef', 'Receiver', 'SubmittedDate', 'Status'],
  LEAVE_REQUEST_STD: ['LeaveID', 'StudentID', 'Date', 'Reason', 'Status', 'TeacherNotified'],
  // Withdrawal / cancel-enrolment requests — parent self-service OR Admin direct. Reason is one of the
  // standard codes (graduated / moved / transferred / other) + free-text detail; Admin processes -> removes the student.
  WITHDRAWALS:       ['WithdrawID', 'StudentID', 'RequestedBy', 'RequesterRole', 'Reason', 'Detail', 'EffectiveDate', 'Status', 'ProcessedBy', 'ProcessedDate', 'CreatedDate'],
  USERS:             ['UserID', 'LineUID', 'Role', 'LinkedID', 'PasswordHash', 'CreatedDate', 'Status'],
  // Columns 1-9 match dspm_ocr/DSPM_CRITERIA_draft.csv for direct paste after proofreading.
  // AgeLabelTH = Thai age label from the manual; Track = Teacher (pp.79-81) | HealthPersonnel (pp.82-83)
  DSPM_CRITERIA:     ['AgeFrom', 'AgeTo', 'AgeLabelTH', 'ItemNo', 'Skill', 'Description', 'DescriptionEN', 'Method', 'PassCriteria', 'Track'],
  SCHOOL_CONFIG:     ['Key', 'Value'],
  AUDIT_LOG:         ['Timestamp', 'UserID', 'Action', 'TableName', 'RecordID'],
  BACKUP_LOG:        ['BackupDate', 'WorkbookName', 'DriveFileID', 'Status'],
  // INFERRED — parent <-> school chat (§4 "Comments — สื่อสารกับโรงเรียน")
  COMMENTS:          ['CommentID', 'StudentID', 'ParentID', 'SenderRole', 'Message', 'Timestamp', 'ReadStatus'],
  // Activity log — full who-did-what trail across the app (broader than AUDIT_LOG, which is PDPA data-access only).
  // Every create/update/payment/withdrawal/login-sensitive action appends a row here for retrospective review.
  ACTIVITY_LOG:      ['LogID', 'Timestamp', 'UserRole', 'UserID', 'UserName', 'Action', 'Target', 'Detail'],
  // Individual injury report (แบบบันทึกการบาดเจ็บรายบุคคล) filed by a teacher/leader. InjuryTypes = JSON array of the
  // 17 standard type codes; Place = code + PlaceOther free text; Witness = yes|no|unsure. Surfaces in the Daily Report + notifies Admin.
  INJURY_REPORTS:    ['InjuryID', 'Date', 'Time', 'CenterName', 'AffiliationType', 'AffiliationOther', 'District',
                      'RecorderName', 'StudentID', 'ChildName', 'Sex', 'AgeYears', 'AgeMonths', 'EduStatus', 'EduGrade',
                      'Narrative', 'CauseObject', 'Witness', 'Place', 'PlaceOther', 'InjuryTypes', 'TeacherID', 'CreatedDate'],
  // PCHI (Pacific Cross) insurance member form — columns mirror the official xlsx "Input Data" sheet.
  // ONE record per student (unique by StudentID / NationalID). Parent fills once; Admin reviews/edits. Insurance data
  // is written ONLY to this sheet. (Deploy: this sheet IS the Google Sheet generated from the supplied form file.)
  INSURANCE_PCHI:    ['InsuranceID', 'StudentID', 'Type', 'Title', 'InsuredName', 'InsuredMiddleName', 'InsuredLastName',
                      'Gender', 'NationalID', 'Passport', 'DOB', 'MemberStatus', 'MaritalStatus', 'Occupation',
                      'EffectiveDate', 'Plan', 'Mobile', 'Email', 'BankAccountName', 'BankAccountNumber', 'EmployeeID',
                      'BeneficiaryName', 'BeneficiaryLastName', 'BeneficiaryRelationship', 'Remarks',
                      'CompanyName', 'PolicyNo', 'FilledBy', 'FilledByRole', 'FilledDate', 'UpdatedBy', 'UpdatedDate']
};

// Workbook 2 — AtomNursery_HR (confidential HR data) — 8 sheets
SCHEMA[WB.HR] = {
  // Department/PositionLevel/ReportsTo drive the org hierarchy & leave routing (chat spec)
  STAFF:         ['StaffID', 'NationalID', 'Name', 'NameEN', 'Nickname', 'DOB', 'Position', 'Role', 'Department', 'PositionLevel', 'StaffGroup', 'ReportsTo', 'Phone', 'LineUID', 'StartDate', 'BaseSalary', 'RequireCheckin', 'PasswordHash', 'MustChangePassword', 'Photo', 'Status'],
  // Staff groups with their own (editable) work hours — Admin-managed
  STAFF_GROUPS:  ['GroupName', 'GroupNameEN', 'CheckInTime', 'CheckOutTime'],
  // Per-staff payroll config (Admin-editable). Widened to carry every field the engine's computePayroll uses
  // so it round-trips through the sheet: pay type/daily rate, SS flag, child threshold & multiplier, diligence amounts.
  PAYROLL_CONFIG:['StaffID', 'PayType', 'DailyRate', 'BaseSalary', 'SocialSecurityDeduct', 'ChildThreshold', 'ChildMultiplier', 'DiligenceAttendanceAmount', 'DiligenceFacebookAmount', 'TaxDeduct'],
  CHECKIN_STAFF: ['Date', 'StaffID', 'CheckIn', 'CheckOut', 'LateMinutes', 'OTHours', 'Status'],
  // 2-step approval: Leader (step 1) -> Admin (step 2); cross-dept flagged. (chat spec)
  LEAVE_REQUEST: ['LeaveID', 'StaffID', 'Department', 'Type', 'StartDate', 'EndDate', 'Days', 'Reason', 'Status',
                  'Step1ApproverID', 'Step1ApproverName', 'Step1Status', 'Step1Date', 'Step1CrossDept',
                  'Step2ApproverID', 'Step2ApproverName', 'Step2Status', 'Step2Date', 'CreatedDate'],
  OT_RECORDS:    ['OTRecordID', 'StaffID', 'Date', 'Hours', 'Rate', 'Amount', 'ApprovedBy'],
  // Full salary-slip breakdown (chat spec): income components + deductions + net to SCB
  PAYROLL:       ['PayrollID', 'StaffID', 'Month', 'BaseSalary',
                  'DiligenceAttendance', 'DiligenceFacebook', 'DiligenceTotal',
                  'ExtraChildCount', 'ExtraChildAmount', 'TrainingCertCount', 'TrainingCertAmount',
                  'OTEvening', 'HolidayBonus', 'OtherIncome', 'GrossIncome',
                  'SocialSecurity', 'Contribution', 'OtherDeductions', 'TotalDeductions',
                  'NetPay', 'BankAccount', 'SlipSent', 'GeneratedDate', 'GeneratedBy'],
  TRAINING:      ['TrainingID', 'StaffID', 'CourseName', 'Date', 'Provider', 'Certificate', 'ExpireDate'],
  WORK_SCHEDULE: ['StaffID', 'DayOfWeek', 'CheckInTime', 'CheckOutTime', 'EffectiveDate'],
  // INFERRED — PDPA access log dedicated to the confidential workbook
  AUDIT_LOG:     ['Timestamp', 'UserID', 'Action', 'TableName', 'RecordID']
};

// ---- Default SCHOOL_CONFIG (Key/Value rows) -----------------------
// Seeded into Workbook 1 > SCHOOL_CONFIG. Values marked <FILL ...>
// must be completed by the school before Go Live.
var SCHOOL_CONFIG_DEFAULTS = [
  // --- Identity ---
  ['SchoolName',            'Atom Nursery'],
  ['SchoolSlogan',          'Learn happiness, funny & lively'],
  ['Timezone',              'Asia/Bangkok'],

  // --- GPS / Check-in (Proposal §9 Day 1) ---
  ['GPS_Lat',               '13.792472'],
  ['GPS_Lng',               '100.646389'],
  ['Radius',                '30'],            // §12 recommended 30m to absorb GPS drift (±5–15m). Confirmed by school.
  ['LateGraceMinutes',      '0'],            // grace window before "late" is counted

  // --- Billing ---
  ['QRCode',                '<FILL PromptPay QR payload / image URL>'],   // legacy alias of QRCode_Monthly
  ['QRCode_Monthly',        '<FILL monthly tuition QR image URL (SCB PromptPay)>'],
  ['QRCode_OT',             '<FILL daily OT QR image URL (KTB PromptPay)>'],
  ['SlipsFolderName',       'AtomNursery_Slips'],   // Drive folder where parent-uploaded payment slips are saved
  ['RegisterPhotoFolderName','New Register Photo'],  // Drive folder for the mandatory registration ID photos (login security)
  ['StudentFolderRoot',     'AtomNursery_Students'], // Drive root; each new student gets a subfolder named after them
  // Standard withdrawal/cancel reasons (parent + Admin pick one). 'other' opens a free-text field.
  ['WithdrawReasons',       'graduated,moved,transferred,other'],
  ['PromptPayID',           '<FILL PromptPay phone or tax id>'],
  // --- Service plans (rate card) — JSON array of {id,labelTH,labelEN,start,end,price} ---
  ['Plans',                 '[{"id":"p_0717","labelTH":"07:00–17:00 น.","labelEN":"07:00–17:00","start":"07:00","end":"17:00","price":6500},{"id":"p_0718","labelTH":"07:00–18:00 น.","labelEN":"07:00–18:00","start":"07:00","end":"18:00","price":7500},{"id":"p_inter","labelTH":"Inter Premium 07:30–17:30","labelEN":"Inter Premium 07:30–17:30","start":"07:30","end":"17:30","price":9500},{"id":"p_1518","labelTH":"เรียนเสริม 15:30–18:30","labelEN":"Extended 15:30–18:30","start":"15:30","end":"18:30","price":3000}]'],
  // --- OT (daily overtime) ---
  ['OTRatePerHour',         '100'],          // baht per started hour beyond the grace window (parent pickup OT)
  ['OTGraceMinutes',        '21'],           // free grace; pickup >21 min past plan end starts charging
  ['StaffOTHourlyRate',     '100'],          // baht/hour for teacher OT (auto-pulled into payroll)
  // --- Growth: months a child's weight/height/photo must be refreshed before assessing ---
  ['GrowthUpdateMonths',    '2,4,6,8,10,12'],

  // --- Holidays (comma-separated YYYY-MM-DD, or JSON array) ---
  ['HolidayList',           ''],

  // --- Social links ---
  ['Links_LINE',            'https://line.me/R/ti/p/@atomnursery'],  // LINE OA @atomnursery (chat button + home icon)
  ['LineOAId',              '@atomnursery'],
  ['Links_Facebook',        'https://www.facebook.com/AtomNursery1'],
  ['Links_Website',         ''],

  // --- SlipOK (slip/QR verification API) — GAS posts the slip image here to read & verify the transfer ---
  ['SlipOK_Url',            'https://api.slipok.com/api/line/apikey/69307'],
  ['SlipOK_ApiKey',         'SLIPOKKR8B249'],

  // --- Insurance (PCHI member form) ---
  ['InsuranceCompanyName',  'Atom Nursery'],
  ['InsurancePolicyNo',     ''],   // fill the PCHI policy number before go-live

  // --- LINE OA / LIFF (Proposal §10) ---
  ['LineChannelAccessToken','<FILL Messaging API channel access token>'],
  ['LineChannelSecret',     '<FILL Messaging API channel secret>'],
  ['LiffID',                '<FILL LIFF ID>'],
  ['AdminLineUID',          '<FILL Admin LINE userId for notifications>'],

  // --- HR / Payroll defaults (used by Phase 2) ---
  ['OTRate',                '0'],            // baht per OT hour, or multiplier per HR policy
  ['OTEveningRate',         '0'],           // baht/hour for evening OT (ค่าสวงเวลาตอนเย็น) — set by HR
  ['DefaultCheckInTime',    '08:00'],
  ['DefaultCheckOutTime',   '17:00'],
  ['ForgotCheckInNotify',   '08:00'],       // daily reminder time if no check-in
  ['ForgotCheckOutNotify',  '18:30'],       // daily reminder time if no check-out

  // --- Diligence bonus (เบี้ยขยัน) — chat spec ---
  ['DiligenceAttendanceAmount', '500'],     // no leave + no late
  ['DiligenceFacebookAmount',   '500'],     // Admin ticks if staff posted on Facebook
  // --- Other income (รายได้อื่นๆ) — chat spec ---
  ['ExtraChildThreshold',   '30'],          // children counted from #31 onward
  ['ExtraChildRate',        '300'],         // baht per extra child (full-month attendance)
  ['TrainingCertRate',      '100'],         // baht per training certificate
  ['TrainingCertMaxPerMonth','2'],          // max certs counted per month
  // --- Deductions ---
  ['SocialSecurityRate',    '0.05'],        // 5%
  ['SocialSecurityMax',     '750'],         // monthly cap
  ['BankName',              'SCB'],

  // --- Org hierarchy — chat spec ---
  ['Departments',           'Nursery 0,Nursery 1,Nursery 2,Nursery 3'],
  ['PositionLevels',        'Admin,Leader,Officer,Assistant,Staff'],

  // --- DSPM ---
  // Upload คู่มือเฝ้าระวัง...ป.pdf to the controlling Gmail's Drive, then put its file id here.
  // Teachers download the full manual for assessment details (we don't transcribe Method/PassCriteria).
  ['DspmManualFileId',      '<FILL Google Drive file id of the DSPM manual PDF>'],

  // --- System ---
  ['SeedMockKey',           'atom-seed-2026'],       // gate for the TEST-ONLY seedMock action (remove before go-live)
  ['CacheTTL',              '60'],                   // seconds the engine caches sheet reads (CacheService); writes invalidate
  ['BackupFolderName',      'AtomNursery_Backups'],
  ['BackupRetentionDays',   '14'],          // dailyBackup() keeps copies for this many days, then prunes
  ['SchemaVersion',         '2.1']
];

// ---- Helpers ------------------------------------------------------
function getWorkbookId_(propKey) {
  var id = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!id) throw new Error('Workbook id not set for ' + propKey + '. Run setupAll() first.');
  return id;
}

function getMainSpreadsheet_() { return SpreadsheetApp.openById(getWorkbookId_(PROP.MAIN_ID)); }
function getHrSpreadsheet_()   { return SpreadsheetApp.openById(getWorkbookId_(PROP.HR_ID)); }
