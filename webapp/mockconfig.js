/* mockconfig.js — the SEED CONFIG only, and it ships on every page load.
 *
 * Split out of mockdata.js (which was 12.6 KB gzipped) because ~30 places in app.js read
 * MOCK.config.* as a last-resort fallback when the server hasn't supplied a value yet. The sample
 * ROWS are only ever needed in mock mode, so they now live in mockdata.js and api.js fetches that
 * on demand — production no longer downloads a fake school.
 *
 * The empty arrays below matter: several lookups are written as
 * `(A_CACHE.students||[]).find(...) || (MOCK.students||[]).find(...)`, and leaving the key
 * undefined would throw. Empty is also SAFER than seeded — a seed row whose id happens to match a
 * live one is how "pkg_e32dd4"-style wrong labels used to appear in gas mode.
 */
window.MOCK = {
  config: {
    SchoolName: 'Atom Nursery',
    GPS_Lat: 13.792472, GPS_Lng: 100.646389, Radius: 50, BigCleaningIn: '08:30', BigCleaningOut: '17:00',
    Departments: ['Nursery 0','Nursery 1','Nursery 2','Nursery 3'],
    DiligenceAttendanceAmount: 500, DiligenceFacebookAmount: 500,
    ExtraChildRate: 300, TrainingCertRate: 100, TrainingCertMaxPerMonth: 2,
    SocialSecurityRate: 0.05, SocialSecurityMax: 750, BankName: 'SCB',
    DspmManualUrl: '',
    DefaultCheckInTime: '08:00',
    LeaveQuota: { 'ลาป่วย': 30, 'ลากิจ': 7, 'ลาพักร้อน': 6 },
    // School social links — LINE OA @atomnursery (chat button + home icon deep-link here), Facebook page
    Links: { line: 'https://line.me/R/ti/p/@atomnursery', facebook: 'https://www.facebook.com/AtomNursery1', website: 'https://atomnursery.example', map: 'https://maps.app.goo.gl/jQhGb3KQj59RV2wXA' },
    LineOAId: '@atomnursery',
    // SlipOK — slip/QR verification API (used at GAS deploy to read & verify transfer slips server-side)
    SlipOK_Url: 'https://api.slipok.com/api/line/apikey/69307',
    SlipOK_ApiKey: 'SLIPOKKR8B249',
    PromptPayQR: '',        // legacy alias of the monthly QR
    // --- Service plans (Atom Nursery rate card, update 1/6/2026) ---
    Plans: [
      { id:'p_0717', labelTH:'07:00–17:00 น.',            labelEN:'07:00–17:00',                  start:'07:00', end:'17:00', price:6500 },
      { id:'p_0718', labelTH:'07:00–18:00 น.',            labelEN:'07:00–18:00',                  start:'07:00', end:'18:00', price:7500 },
      { id:'p_inter',labelTH:'Inter Premium 07:30–17:30', labelEN:'Inter Premium 07:30–17:30',    start:'07:30', end:'17:30', price:9500 },
      { id:'p_1518', labelTH:'เรียนเสริม 15:30–18:30',     labelEN:'Extended 15:30–18:30',         start:'15:30', end:'18:30', price:3000 },
    ],
    // --- OT (daily overtime) — charged when pickup is later than the plan end-time ---
    OTRatePerHour: 100,     // baht per started hour beyond the grace window (parent pickup OT)
    OTGraceMinutes: 21,     // free grace; >21 min late starts charging
    StaffOTHourlyRate: 100, // baht/hour for teacher OT, flat (auto-pulled into payroll). 'auto' = 1.5 × salary/30/8
    // เงินสมทบ: the school matches the teacher's deduction 1:1, so 200 deducted grows the fund by 400
    ContributionMatchRate: 1,
    // --- Payment QR images (drop the real QR files in webapp/assets with these names) ---
    QRCode_Monthly: 'assets/qr_scb.jpg',  // SCB PromptPay — monthly tuition
    QRCode_OT: 'assets/qr_ktb.jpg',       // KTB PromptPay — daily OT
    SlipsFolderName: 'AtomNursery_Slips', // Google Drive folder where uploaded slips are stored (GAS deploy)
    RegisterPhotoFolderName: 'New Register Photo', // Drive folder for the mandatory registration ID photo (login security)
    StudentFolderRoot: 'AtomNursery_Students',     // each new student gets a Drive subfolder named after them
    WithdrawReasons: ['graduated','moved','transferred','other'], // standard exit reasons (parent + Admin)
    // PCHI (Pacific Cross) insurance member form — dropdown option lists (from the official xlsx "Setting" sheet)
    Insurance: {
      CompanyName: 'Atom Nursery', PolicyNo: '',
      Titles: ['ด.ช.','ด.ญ.','MSTR.','MISS','MR.','MRS.','MS.','นาย','นาง','นางสาว','คุณ'],
      Genders: ['Male','Female'],
      MemberStatuses: ['Child','Employee','Spouse'],     // the insured here is the child
      Plans: ['1','2','3','4','5','6','7','8','9','10','11','12'],
      MaritalStatuses: ['Single','Married','Divorced','Separated in fact','Widow/Widower'],
      Relationships: ['Father','Mother','Spouse','Child','Brother','Sister','Relative','Others'],
    },
    // --- Growth: months a child's weight/height/photo must be refreshed before assessing ---
    GrowthUpdateMonths: [2,4,6,8,10,12],
    // --- Teacher attendance / OT rules ---
    LateGraceMinutes: 10,       // check-in late ≤10 min counts as on-time (full day + diligence)
    OTRoundUpMinutes: 50,       // ≥50 min within an hour rounds OT up to a full hour
    AbsenceRateExcludeDays: 6,  // children absent ≥6 days are excluded from the teacher child-rate count
  },
  // present-but-empty so the `|| MOCK.x.find(...)` fallbacks keep working in gas mode (see above)
  staffGroups: [], staff: [], students: [], parents: [], classes: [], announcements: [], payroll: [],
};
