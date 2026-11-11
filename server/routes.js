/**
 * server/routes.js — Code.gs ROUTES that the fast host runs itself, as Apps Script's OWN functions
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 180 actions are answered on live by a Code.gs route, not the engine. The host answers those
 * NOT_ON_FAST_HOST and the app re-asks Apps Script (webapp/api.js postFast) — correct, but a screen
 * that holds one of them pays for two trips. `notifications` is on every screen's header.
 *
 * NOT A SECOND COPY. The src/*.gs files are loaded whole into a sandbox, and the handler that runs is
 * the one Apps Script runs. Only what it READS is swapped: each ported route declares the sheets it
 * reads, the host reads exactly those from Postgres (PG.readSheet — sheet column names, the shape
 * readObjects_ returns) before the call, and readObjects_ answers from them.
 *
 * 🔴 READ-ONLY, AND LOUD ABOUT IT. A ported route's sheets are not in M, so the host's "did anything
 * change?" check cannot see a write here. Every write primitive therefore THROWS, and so does a read
 * of a sheet the route did not declare — a missing declaration must fail a test, not answer "nothing".
 * A route that writes is ported only once it has a writer and a staging proof, like the engine's.
 *
 * Synchronous: the shims are set and the handler runs with no await between, so two requests on one
 * instance never see each other's rows.
 *
 * Each entry here has a parity suite: tools/test_fast_routes.js (GAS harness vs this, offline) and
 * tools/test_fast_routes_live.js (GAS harness vs server/host.js through staging Postgres).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const PG = require(path.join(ROOT, 'tools', 'pg_engine.js'));   // the table columns (PG.colsOf) — the sheet headers on Apps Script

/** action → the Apps Script function ROUTES calls, every sheet it reads (incl. via helpers), and —
 *  for a route that writes — the ONLY cells it may change: { SHEET: [columns] }, updates of existing
 *  rows only. Anything else it tries (another column, a new row, a delete, a cache, LINE) fails the call. */
/* W4 3b — what paySlipRecompute_ may touch on each kind of payable (bill · ot · charge · prepay) */
const PAY_READS_ = ['PAYMENT_SLIPS', 'BILLING', 'OT_DAILY', 'STUDENT_CHARGES', 'PREPAYMENTS', 'STUDENTS'];
const PAY_WRITES_ = { BILLING: ['Status', 'PaidDate', 'SlipAmount', 'VerifiedStatus', 'ReceiptDate', 'PaymentMethod', 'TransactionDate'],
  OT_DAILY: ['Status', 'PaidDate', 'SlipAmount', 'PaymentMethod', 'TransactionDate'],
  STUDENT_CHARGES: ['Status'],
  PREPAYMENTS: ['Status', 'PaidDate', 'SlipAmount', 'VerifiedStatus', 'PaymentMethod', 'TransactionDate'] };
const PAY_DROPS_ = { OT_DAILY: ['VerifiedStatus'], STUDENT_CHARGES: ['PaidDate', 'SlipAmount', 'VerifiedStatus', 'PaymentMethod', 'TransactionDate'] };
/* every column computePayroll's one record writes (src/Payroll.gs `rec`) — the whole slip, on save */
const PAYROLL_COLS_ = ['StaffID', 'Month', 'BaseSalary', 'DiligenceAttendance', 'DiligenceFacebook', 'DiligenceTotal',
  'ExtraChildCount', 'ExtraChildAmount', 'ChildThreshold', 'RatedTotal', 'TrainingCertCount', 'TrainingCertAmount',
  'OTEvening', 'OTCarry', 'OTCarryDetail', 'OTHoliday', 'HolidayBonus', 'OtherIncome', 'GrossIncome',
  'SocialSecurity', 'Contribution', 'ContributionEmployer', 'OtherDeductions', 'TotalDeductions',
  'PayType', 'DailyRate', 'DaysWorked', 'ChildMultiplier', 'Adjustments', 'AdjustmentsTotal', 'NetPay', 'BankName',
  'ContributionAccum', 'Position', 'StaffName', 'BankAccount', 'SlipSent', 'PaidDate', 'PaidBy', 'SlipUrl',
  'LeaveDays', 'LeaveLimit', 'LeaveExceeds', 'PauseSalaryMode', 'PauseFrom', 'PauseTo', 'PauseReason',
  'GeneratedDate', 'GeneratedBy', 'Approved', 'ApprovedBy', 'ApprovedAt', 'PayrollID'];
const PORTED = {
  // the 🔔 bell — Admin inbox · a staff member's inbox · a family's inbox (src/Notify.gs)
  notifications: { fn: 'handleNotifications', reads: ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS', 'APPLICATIONS'] },
  // ...and "mark as read": the same three audiences, the same three sheets, one cell (Read = 'YES')
  markNotifsRead: { fn: 'handleMarkNotifsRead', reads: ['ADMIN_INBOX', 'PARENTS', 'USER_LINKS', 'APPLICATIONS'], writes: { ADMIN_INBOX: ['Read'] } },
  // the approver's queue — Admin sees PENDING_ADMIN, a Leader PENDING_LEADER, anyone else NO_PERMISSION (src/Leave.gs)
  pendingLeaves: { fn: 'handlePendingLeaves', reads: ['LEAVE_REQUEST', 'STAFF'] },
  // Big Cleaning: the dates, the allowance and the day's own hours — all from SCHOOL_CONFIG (src/Checkin.gs)
  bigCleaningDays: { fn: 'handleBigCleaningDays', reads: [] },
  // the admin's whole leave list, newest first (src/Leave.gs) — a family is refused it at the gate (NOT_FOR_FAMILIES_)
  allLeaves: { fn: 'handleAllLeaves', reads: ['LEAVE_REQUEST', 'STAFF'] },
  /* 💰 one month's payslip (src/Payroll.gs) — the saved row, the provident-fund running total over
   * every saved month, the school's match rate (SCHOOL_CONFIG), and the "not approved = not there"
   * rule for a teacher. Money: test_fast_routes compares it figure for figure, Sheets types vs text. */
  getPayslip: { fn: 'handleGetPayslip', reads: ['PAYROLL', 'STAFF'] },
  // a child's insurance: the enrolment form (INSURANCE_PCHI, by id or national id) and the school's policy (src/Day6.gs)
  insuranceStatus: { fn: 'handleInsuranceStatus', reads: ['STUDENTS', 'INSURANCE_PCHI'] },
  /* 💰 the rest of the teacher's payslip screen (2026-11-06) — with getPayslip, the whole screen now
   * answers here. myPayslipMonths: the months that HAVE a slip (approved, one per month). otCarryOver:
   * OT approved after an earlier month's payroll was saved — baht, hours and the days behind them,
   * from OT_RECORDS against every saved PAYROLL row and the school's OTEveningRate. */
  myPayslipMonths: { fn: 'handleMyPayslipMonths', reads: ['PAYROLL'] },
  otCarryOver: { fn: 'handleOtCarryOver', reads: ['PAYROLL', 'OT_RECORDS'] },
  // admin: the days OT is waived (SCHOOL_CONFIG.OTWaiveDays) and whether today is one (src/OT.gs)
  otWaiveDays: { fn: 'handleOtWaiveDays', reads: [] },
  // admin: the certificate's wording lines and whether its artwork is uploaded — all SCHOOL_CONFIG (src/Certificate.gs)
  certText: { fn: 'handleCertText', reads: [] },

  /* ═══ W1 · WRITES with no money and no LINE (docs/FAST_HOST_WRITES_PLAN.md, 2026-11-07) ═══════════════
   * Each one proven by tools/test_fast_route_writes.js: run on Apps Script and here from the same rows,
   * then EVERY row of every declared sheet compared — not just the reply — and nothing undeclared moved. */
  // school settings, one key per write (setConfigValue_: the row if it exists, a new row if not)
  addDepartment:    { fn: 'handleAddDepartment', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  removeDepartment: { fn: 'handleRemoveDepartment', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  renameDepartment: { fn: 'handleRenameDepartment', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  setLeaveQuota:    { fn: 'handleSetLeaveQuota', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  saveCertText:     { fn: 'handleSaveCertText', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  saveDocInfo:      { fn: 'handleSaveDocInfo', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  // DSPM criteria (src/DspmAdmin.gs): edit by ItemNo+Track, else a new item numbered max+1; delete by ItemNo+Track
  saveDspmCriteria: { fn: 'handleSaveDspmCriteria', reads: ['DSPM_CRITERIA'], appends: ['DSPM_CRITERIA'],
    writes: { DSPM_CRITERIA: ['AgeFrom', 'AgeTo', 'AgeLabelTH', 'Skill', 'Description', 'DescriptionEN', 'Method', 'PassCriteria', 'Track'] } },
  deleteDspmCriteria: { fn: 'handleDeleteDspmCriteria', reads: ['DSPM_CRITERIA'], deletes: ['DSPM_CRITERIA'] },
  // staff leave (src/Leave.gs) — the admin corrects or cancels; the overlap rule of 2026-11-06 holds here too
  editLeave:   { fn: 'handleEditLeave', reads: ['LEAVE_REQUEST'], writes: { LEAVE_REQUEST: ['Type', 'StartDate', 'EndDate', 'Reason', 'HalfDay', 'Days'] } },
  cancelLeave: { fn: 'handleCancelLeave', reads: ['LEAVE_REQUEST'], deletes: ['LEAVE_REQUEST'] },
  // a child's leave, corrected by the office (src/Parent.gs)
  editStudentLeave: { fn: 'handleEditStudentLeave', reads: ['LEAVE_REQUEST_STD'], writes: { LEAVE_REQUEST_STD: ['Date', 'Reason', 'Type'] } },
  // a sent daily report back to draft (src/Journal.gs) — content untouched, only the two status cells
  unlockJournal: { fn: 'handleUnlockJournal', reads: ['DAILY_JOURNAL', 'STUDENTS'], writes: { DAILY_JOURNAL: ['Status', 'SubmittedAt'] } },
  // announcements (src/Announce.gs) — one WITH an image is refused here (Drive) and goes to Apps Script
  addAnnouncement:    { fn: 'handleAddAnnouncement', reads: ['ANNOUNCEMENTS'], appends: ['ANNOUNCEMENTS'] },
  editAnnouncement:   { fn: 'handleEditAnnouncement', reads: ['ANNOUNCEMENTS'],
    writes: { ANNOUNCEMENTS: ['Title', 'TitleEN', 'Content', 'ContentEN', 'Popup', 'StartDate', 'EndDate', 'Priority', 'StartTime', 'EndTime', 'Image'] } },
  deleteAnnouncement: { fn: 'handleDeleteAnnouncement', reads: ['ANNOUNCEMENTS'], deletes: ['ANNOUNCEMENTS'] },
  /* holidays (Code.gs holidayWrite_): the ENGINE changes M.holidays (the host saves it), and when the date is
   * TODAY Apps Script also recomputes the day's attendance — that path reads sheets these do not declare, so
   * it is refused here (NOT_ON_FAST_HOST) and the request goes to Apps Script whole. */
  addHoliday:    { fn: 'holidayWrite_', args: ['addHoliday'], reads: [], engine: ['holidays'] },
  editHoliday:   { fn: 'holidayWrite_', args: ['editHoliday'], reads: [], engine: ['holidays'] },
  removeHoliday: { fn: 'holidayWrite_', args: ['removeHoliday'], reads: [], engine: ['holidays'] },
  // Big Cleaning days — one SCHOOL_CONFIG cell, written through a range (src/Checkin.gs writeBigCleaning_)
  addBigCleaning:    { fn: 'handleAddBigCleaning', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  removeBigCleaning: { fn: 'handleRemoveBigCleaning', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  /* the head teacher takes sent reports back (src/Journal.gs): two status cells per report, and one 🔔 row in
   * the inbox of each teacher who wrote one (inboxAdd_ → ADMIN_INBOX — the bell, never LINE) */
  recallJournalsMany: { fn: 'handleRecallJournalsMany', reads: ['DAILY_JOURNAL', 'STAFF', 'STUDENTS', 'ADMIN_INBOX'],
    writes: { DAILY_JOURNAL: ['Status', 'SubmittedAt'] }, appends: ['ADMIN_INBOX'] },

  /* ═══ W2 · writes that SEND LINE (docs/FAST_HOST_WRITES_PLAN.md, 2026-11-09) ═══════════════════════════
   * `line: true` — linePush_ is recorded, not called; the host sends after commit (server/line_send.js).
   * Proven by tools/test_fast_route_line.js: the same steps on Apps Script and here, and after each one
   * the reply, every row AND every LINE message (recipient, text, order) compared. */
  // 1 · the teacher answers a parent's comment → the family's 🔔 and LINE (topic parent.journalReply)
  saveTeacherReply: { fn: 'handleSaveTeacherReply', reads: ['STUDENTS', 'STAFF', 'PARENTS', 'USER_LINKS', 'ADMIN_INBOX'],
    writes: { DAILY_JOURNAL: ['TeacherReply'] }, appends: ['ADMIN_INBOX'], line: true },
  /* 2 · a parent comments on the day's report → the class teacher(s): 🔔 always, LINE by topic staff.comment.
   * Nobody reached at all → the admin's bell (notifyAdmins_), which reads the recipient list and USERS. */
  saveParentComment: { fn: 'handleSaveParentComment', reads: ['STUDENTS', 'STAFF', 'CLASSES', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { DAILY_JOURNAL: ['ParentComment'] }, appends: ['ADMIN_INBOX'], line: true },
  /* 3 · a family reports their child away → one LEAVE_REQUEST_STD row per new day (a re-send files nothing)
   * and the class teacher(s): 🔔 always, LINE by topic staff.leave; nobody reached → the admin's bell */
  studentAbsence: { fn: 'handleStudentAbsence', reads: ['HOLIDAYS', 'STUDENTS', 'PARENTS', 'USER_LINKS', 'STAFF', 'CLASSES', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { LEAVE_REQUEST_STD: [] }, appends: ['LEAVE_REQUEST_STD', 'ADMIN_INBOX'], line: true },
  // 4 · a teacher files the leave for the family → the family's 🔔 and LINE (topic parent.leave)
  teacherStudentLeave: { fn: 'handleTeacherStudentLeave', reads: ['HOLIDAYS', 'STUDENTS', 'STAFF', 'PARENTS', 'USER_LINKS', 'ADMIN_INBOX'],
    writes: { LEAVE_REQUEST_STD: [] }, appends: ['LEAVE_REQUEST_STD', 'ADMIN_INBOX'], line: true },
  /* 5 · 🚨 an injury report — LAST, after 1–4 were proven. The report itself is the ENGINE's (injuryReports);
   * the alarm is Notify.gs: admins + the recipient list ALWAYS (no switch can silence it), head teachers by their
   * approval-queue switch (notifyLeaders_), and
   * the family when the teacher ticked "notify parent". A report WITH PHOTOS is refused here (Drive is Apps
   * Script's) and the app sends it there — the emergency is never lost, only slower. */
  submitInjury: { fn: 'handleSubmitInjury', reads: ['STUDENTS', 'STAFF', 'PARENTS', 'USER_LINKS', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    appends: ['ADMIN_INBOX'], engine: ['injuryReports', 'activityLog'], line: true },

  /* ═══ W3 · the day's work that sits next to money (docs/FAST_HOST_WRITES_PLAN.md, 2026-11-10) ═════════
   * Least risk first. STAFF LEAVE (src/Leave.gs): the request and its two approval steps. No baht is written
   * here — payroll reads LEAVE_REQUEST later — but the row decides a deduction, so every cell is compared.
   * Proven by section 5 of tools/test_fast_route_line.js and 1f of test_fast_route_line_live.js.
   *   submitLeave   one LEAVE_REQUEST row (refused when it overlaps a held slot) → head teachers, or the
   *                 admins when the requester is a head teacher/admin. An attachment is a Drive image:
   *                 refused here, the app sends that request to Apps Script.
   *   approveLeave  step 1 (head teacher) or step 2 (admin) on the SAME row → the next approver or the requester */
  submitLeave: { fn: 'handleSubmitLeave', reads: ['STAFF', 'LEAVE_REQUEST', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    appends: ['LEAVE_REQUEST', 'ADMIN_INBOX'], line: true },
  approveLeave: { fn: 'handleApproveLeave', reads: ['STAFF', 'LEAVE_REQUEST', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { LEAVE_REQUEST: ['Step1ApproverID', 'Step1ApproverName', 'Step1Status', 'Step1Date', 'Step1CrossDept',
      'Step2ApproverID', 'Step2ApproverName', 'Step2Status', 'Step2Date', 'Status'] },
    appends: ['ADMIN_INBOX'], line: true },
  /* STAFF CLOCK-IN / CLOCK-OUT (src/Checkin.gs) — 💰 the row decides lateness (เบี้ยขยัน) and OT.
   *   staffCheckin   the day's hours (atomStaffHours_: shift · Big Cleaning · half-day holiday · grace), the
   *                  school-open rule, the geofence, then one CHECKIN_STAFF row with LateMinutes
   *   staffCheckout  never refused for the day being shut; OT in FULL hours from the person's own end time
   *                  (OTRoundUpMinutes), × StaffOTHourlyRate → one OT_RECORDS row into the approval queue and
   *                  the admins told — only when there is at least one hour
   * Every hour here is read on the SCHOOL'S clock (see the guard in run()). Proven by
   * tools/test_fast_route_checkin.js (a fixed clock on both sides) and its _live twin. */
  staffCheckin: { fn: 'handleStaffCheckin', reads: ['STAFF', 'WORK_SCHEDULE', 'STAFF_GROUPS', 'HOLIDAYS', 'OT_RECORDS', 'CHECKIN_STAFF'],
    writes: { CHECKIN_STAFF: ['CheckIn', 'LateMinutes', 'Status'] }, appends: ['CHECKIN_STAFF'] },
  staffCheckout: { fn: 'handleStaffCheckout', reads: ['STAFF', 'WORK_SCHEDULE', 'STAFF_GROUPS', 'HOLIDAYS', 'OT_RECORDS', 'CHECKIN_STAFF', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { CHECKIN_STAFF: ['CheckOut', 'OTHours', 'Status'] }, appends: ['OT_RECORDS', 'ADMIN_INBOX'], line: true },
  /* STAFF OT APPROVAL (src/OtStaff.gs) — 💰 only APPROVED OT reaches the salary (Payroll.gs sumMonthlyOT_).
   *   approveOT  step 1, head teacher/admin: PENDING_LEADER → PENDING_ADMIN or REJECTED. No baht changes.
   *   confirmOT  step 2, admin only: RE-PRICED at today's rate (hours × otRateForStaff_) unless the admin types an
   *              amount; an OT วันหยุด lump sum keeps its amount (never hours × rate = 0). Or REJECTED.
   * Neither tells anybody nor writes the audit log, on Apps Script either. Proven by section 7 of
   * tools/test_fast_route_checkin.js and its _live twin. */
  /* A FAMILY CORRECTS OR WITHDRAWS ITS OWN NOTICE (src/Parent.gs parentOwnLeave_): their child · filed by them, not
   * the school (FiledBy) · today or later — a past day is the register. Cancelling a range cancels its days from
   * today on, past ones stay. The class teacher(s) told: 🔔 always, LINE by staff.leave. Proven by section 11 of
   * tools/test_fast_route_pickup.js and its _live twin. */
  parentEditLeave: { fn: 'handleParentEditLeave', reads: ['PARENTS', 'STUDENTS', 'LEAVE_REQUEST_STD', 'STAFF', 'CLASSES', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { LEAVE_REQUEST_STD: ['Date', 'Reason', 'Type'] }, appends: ['ADMIN_INBOX'], line: true },
  parentCancelLeave: { fn: 'handleParentCancelLeave', reads: ['PARENTS', 'STUDENTS', 'LEAVE_REQUEST_STD', 'STAFF', 'CLASSES', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    deletes: ['LEAVE_REQUEST_STD'], appends: ['ADMIN_INBOX'], line: true },
  /* A TEACHER CORRECTS A CHILD'S DAY (Code.gs editAttendanceWrite_ → the ENGINE's editStudentAttendance) — 💰 a
   * pick-up time decides the late fee. The engine: own classes only (head teacher/admin all) · set or clear IN/OUT
   * (a cleared half deletes its CHECKIN_STUDENT row) · ByAt = when it was typed · otReconcile_ = the same rule as
   * otUpsertForPickup_ (a charge that no longer applies is CANCELLED, kept). Code.gs then tells the family and the
   * admins about a back-dated charge (parent.ot). Proven by section 6 of tools/test_fast_route_pickup_live.js. */
  editStudentAttendance: { fn: 'editAttendanceWrite_', reads: ['STUDENTS', 'PARENTS', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    appends: ['ADMIN_INBOX'], engine: ['checkinStudent', 'otDaily', 'activityLog'], line: true },
  /* TIME REQUESTS — ขอลงเวลา (src/AttReq.gs). A teacher whose GPS failed asks for the real time; nothing reaches
   * CHECKIN_STAFF until the ADMIN's step (confirmTimeRequest, W4), so these two decide no baht yet.
   *   submitTimeRequest   one ATTENDANCE_REQUEST row (a head teacher's own skips to PENDING_ADMIN) → admins' 🔔/list
   *   approveTimeRequest  step 1, head teacher: → PENDING_ADMIN, or REJECTED and the requester is told why
   * Proven by section 9 of tools/test_fast_route_checkin.js and its _live twin. */
  submitTimeRequest: { fn: 'handleSubmitTimeRequest', reads: ['STAFF', 'ATTENDANCE_REQUEST', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    appends: ['ATTENDANCE_REQUEST', 'ADMIN_INBOX'], line: true },
  approveTimeRequest: { fn: 'handleApproveTimeRequest', reads: ['STAFF', 'ATTENDANCE_REQUEST', 'ADMIN_INBOX'],
    writes: { ATTENDANCE_REQUEST: ['Step1By', 'Step1Status', 'Status', 'Step1At', 'DecisionNote'] }, appends: ['ADMIN_INBOX'], line: true },
  /* ═══ W4 · group 1 — the ADMIN's decisions on staff time (docs/FAST_HOST_WRITES_PLAN.md, 2026-11-11) ════════
   * 💰 Both write CHECKIN_STAFF, which decides LateMinutes (เบี้ยขยัน) and OTHours. Admin only (Code.gs ADMIN_ONLY).
   *   confirmTimeRequest   step 2 of ขอลงเวลา: approve → arApply_ writes the requested time into that day's row
   *                        (created if absent), re-measured against THAT day's hours (staffDayHours_), flagged
   *                        In/OutManual; duplicate rows for the day collapsed (deleted bottom-up) · reject → only
   *                        the request · settling one still with the head teacher records "แอดมินอนุมัติแทน"
   *                        · the requester told (staff.approval)
   *   editStaffAttendance  the admin types or CLEARS either half; both cleared deletes the day; late/OT re-derived;
   *                        EditedBy/At/Note on the row, HR audit, the person and the admins told
   * Proven by section 10 of tools/test_fast_route_checkin.js and its _live twin. */
  confirmTimeRequest: { fn: 'handleConfirmTimeRequest',
    reads: ['STAFF', 'ATTENDANCE_REQUEST', 'CHECKIN_STAFF', 'WORK_SCHEDULE', 'STAFF_GROUPS', 'HOLIDAYS', 'OT_RECORDS', 'ADMIN_INBOX'],
    writes: { ATTENDANCE_REQUEST: ['Step1By', 'Step1Status', 'Step1At', 'Step2By', 'Step2Status', 'Step2At', 'Status', 'DecisionNote'],
      CHECKIN_STAFF: ['CheckIn', 'CheckOut', 'LateMinutes', 'OTHours', 'Status', 'InManual', 'OutManual'] },
    appends: ['CHECKIN_STAFF', 'ADMIN_INBOX'], deletes: ['CHECKIN_STAFF'], line: true },
  editStaffAttendance: { fn: 'handleEditStaffAttendance',
    reads: ['STAFF', 'CHECKIN_STAFF', 'WORK_SCHEDULE', 'STAFF_GROUPS', 'HOLIDAYS', 'OT_RECORDS', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { CHECKIN_STAFF: ['Date', 'StaffID', 'CheckIn', 'CheckOut', 'LateMinutes', 'OTHours', 'Status', 'InManual', 'OutManual', 'EditedBy', 'EditedAt', 'EditNote'] },
    appends: ['CHECKIN_STAFF', 'ADMIN_INBOX'], deletes: ['CHECKIN_STAFF'], line: true },
  /* ═══ W4 · group 2 — the ADMIN's OT tools (admin only, Code.gs ADMIN_ONLY) ═══════════════════════════════════
   * 💰 STAFF OT (src/OtStaff.gs) → OT_RECORDS, which only APPROVED rows reach the salary from:
   *   adminAddOT         an already-approved row, hours × otRateForStaff_ unless an amount is typed
   *   adminAddHolidayOT  OT วันหยุด: one APPROVED lump-sum row per person (ticked twice = once), only on a closed
   *                      day (assertHolidayDate_), each person's own 🔔 told
   *   adminEditOT        hours re-priced (a HOLIDAY lump sum never is) · amount · note · date (a holiday row stays
   *                      on a closed day)
   *   adminDeleteOT      the row, in place
   * 💰 A CHILD'S LATE-PICKUP CHARGE (src/OT.gs) → OT_DAILY:
   *   adminUpdateOT      correct the pick-up time (re-computed on the row's OWN day) and/or a goodwill discount
   *                      (FullAmount − Discount = Amount; who/why/when kept; all waived = PAID) · PAID rows locked ·
   *                      audit · a row with slips is re-settled (paySlipRecompute_ — that writes VerifiedStatus,
   *                      not a Postgres column yet: such a call is refused here and runs on Apps Script)
   *   adminCancelOT / adminRestoreOT   CANCELLED ⇄ UNPAID; PAID never
   * Proven by section 11 of tools/test_fast_route_checkin.js · section 13 of test_fast_route_pickup.js · _live twins. */
  adminAddOT: { fn: 'handleAdminAddOT', reads: ['STAFF', 'OT_RECORDS'], appends: ['OT_RECORDS'] },
  adminAddHolidayOT: { fn: 'handleAdminAddHolidayOT', reads: ['STAFF', 'OT_RECORDS', 'HOLIDAYS', 'ADMIN_INBOX'], appends: ['OT_RECORDS', 'ADMIN_INBOX'] },
  adminEditOT: { fn: 'handleAdminEditOT', reads: ['STAFF', 'OT_RECORDS', 'HOLIDAYS'],
    writes: { OT_RECORDS: ['Hours', 'Amount', 'Note', 'Date', 'Month'] } },
  adminDeleteOT: { fn: 'handleAdminDeleteOT', reads: ['STAFF', 'OT_RECORDS'], deletes: ['OT_RECORDS'] },
  adminUpdateOT: { fn: 'handleAdminUpdateOT', reads: ['OT_DAILY', 'STUDENTS', 'PAYMENT_SLIPS'],
    writes: { OT_DAILY: ['PickupTime', 'PlanEnd', 'LateMinutes', 'Hours', 'FullAmount', 'Discount', 'Amount', 'DiscountReason', 'DiscountBy', 'DiscountAt', 'Status', 'PaidDate', 'SlipAmount'] } },
  adminCancelOT: { fn: 'handleAdminCancelOT', reads: ['OT_DAILY'], writes: { OT_DAILY: ['Status'] } },
  adminRestoreOT: { fn: 'handleAdminRestoreOT', reads: ['OT_DAILY'], writes: { OT_DAILY: ['Status'] } },
  /* ═══ W4 · group 3a — BILLS (admin only) ═══════════════════════════════════════════════════════════════════
   * 💰 The bills themselves are ISSUED by the engine (issueBill · issueBillsFor · generateMonthlyBills — already
   * MONEY_PROVEN in server/write_proven.js). These are the Code.gs routes around them:
   *   notifyBills   tell the families of the chosen children that the month's bill is out: 🔔 always, LINE by parent.bill
   *   billRunLast   READ — the latest bulk run: what it made, which bills are untouched (removable) and which a
   *                 family has acted on (slip · paid · partial — kept and named)
   *   undoBillRun   take that run back IN PLACE: only the run the admin looked at (RUN_CHANGED otherwise), only
   *                 with confirm:true, only the untouched bills; the rest skipped and reported · audited
   *   deleteBill    one bill, refused when any slip (confirmed or waiting) is tied to it (BILL_HAS_PAYMENT)
   * BILLING never shrinks on this host — these two are the declared exception, as on Apps Script (host.js shrinkOk).
   * Proven by tools/test_fast_route_bills.js and its _live twin. */
  notifyBills: { fn: 'handleNotifyBills', reads: ['STUDENTS', 'PARENTS', 'USER_LINKS', 'ADMIN_INBOX'], appends: ['ADMIN_INBOX'], line: true },
  billRunLast: { fn: 'handleBillRunLast', reads: ['BILLING', 'PAYMENT_SLIPS', 'STUDENTS'] },
  undoBillRun: { fn: 'handleUndoBillRun', reads: ['BILLING', 'PAYMENT_SLIPS', 'STUDENTS'], deletes: ['BILLING'], shrinks: ['BILLING'] },
  deleteBill: { fn: 'handleDeleteBill', reads: ['BILLING', 'PAYMENT_SLIPS'], deletes: ['BILLING'], shrinks: ['BILLING'] },
  /* ═══ W4 · group 3b — MONEY RECEIVED (src/PaySlips.gs) ═══════════════════════════════════════════════════════
   * 💰 Every path here moves a payable's Status / SlipAmount through paySlipRecompute_ — the one rule that turns the
   * sum of CONFIRMED slips into PAID / PARTIAL / PENDING_VERIFY / UNPAID. Anything that needs Drive (a slip image)
   * or SlipOK (UrlFetch) is refused here and stays on Apps Script: uploadSlip · payOT · payCharge · payPrepay ·
   * payCombined · verifySlip.
   *   recordCashPayment  admin: money taken outside the app → a CONFIRMED slip row, no image; refused over the due
   *   payCombinedCash    a FAMILY says they paid cash for the ticked items → one SUBMITTED row each (amount must
   *                      equal the total · their own children only · not a future date) · admins told
   *   confirmSlip / rejectSlip / rejectSlips   admin decides a slip; the payable re-settled
   *   deleteSlip / deleteSlips                 admin removes a row with NO image (a slip is evidence: reject it)
   * Proven by tools/test_fast_route_payments.js and its _live twin. */
  recordCashPayment: { fn: 'handleRecordCashPayment', reads: PAY_READS_, appends: ['PAYMENT_SLIPS'], writes: PAY_WRITES_, drops: PAY_DROPS_ },
  payCombinedCash: { fn: 'handlePayCombinedCash', reads: PAY_READS_.concat(['PARENTS', 'USER_LINKS', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS']),
    appends: ['PAYMENT_SLIPS', 'ADMIN_INBOX'], writes: PAY_WRITES_, drops: PAY_DROPS_, line: true },
  confirmSlip: { fn: 'handleConfirmSlip', reads: PAY_READS_, writes: Object.assign({ PAYMENT_SLIPS: ['Status'] }, PAY_WRITES_), drops: PAY_DROPS_ },
  rejectSlip: { fn: 'handleRejectSlip', reads: PAY_READS_, writes: Object.assign({ PAYMENT_SLIPS: ['Status'] }, PAY_WRITES_), drops: PAY_DROPS_ },
  rejectSlips: { fn: 'handleRejectSlips', reads: PAY_READS_, writes: Object.assign({ PAYMENT_SLIPS: ['Status'] }, PAY_WRITES_), drops: PAY_DROPS_ },
  deleteSlip: { fn: 'handleDeleteSlip', reads: PAY_READS_, deletes: ['PAYMENT_SLIPS'], writes: PAY_WRITES_, drops: PAY_DROPS_ },
  deleteSlips: { fn: 'handleDeleteSlips', reads: PAY_READS_, deletes: ['PAYMENT_SLIPS'], writes: PAY_WRITES_, drops: PAY_DROPS_ },
  /* ═══ W4 · group 3c — ADVANCE TUITION (ชำระล่วงหน้า · admin only) ═══════════════════════════════════════════
   * 💰 The prepayment itself is created by the engine's `prepay` (MONEY_PROVEN). Prepay covers TUITION ONLY.
   *   savePrepayTiers  the discount tiers (months → %) as JSON in SCHOOL_CONFIG; at least one; 0–100 %; sorted
   *   editPrepay       unpaid → months · discount · start month, re-quoted from the child's plan price (Gross ×
   *                    (100 − %) rounded; NO_PLAN_PRICE without one) · PAID → the start month only (ALREADY_PAID
   *                    for months/discount) · audited
   *   cancelPrepay     delete an UNPAID one with no live slip, in place (ALREADY_PAID · HAS_SLIP) · audited
   *   prepayAudit      READ the bills the OLD prepay logic marked paid; {apply:true} resets ONLY the bug's marker
   *                    (VerifiedStatus PREPAID) — a bill the family truly paid is never touched
   * Proven by tools/test_fast_route_prepay.js and its _live twin. */
  savePrepayTiers: { fn: 'handleSavePrepayTiers', reads: [], writes: { SCHOOL_CONFIG: ['Value'] }, appends: ['SCHOOL_CONFIG'] },
  editPrepay: { fn: 'handleEditPrepay', reads: ['PREPAYMENTS', 'STUDENTS'], writes: { PREPAYMENTS: ['Months', 'Discount', 'Covered', 'Gross', 'Amount'] } },
  cancelPrepay: { fn: 'handleCancelPrepay', reads: ['PREPAYMENTS', 'PAYMENT_SLIPS'], deletes: ['PREPAYMENTS'] },
  prepayAudit: { fn: 'handlePrepayAudit', reads: ['PREPAYMENTS', 'BILLING', 'STUDENTS'], writes: { BILLING: ['Status', 'VerifiedStatus', 'PaidDate'] } },
  /* ═══ W4 · group 3d — PAYROLL (เงินเดือน) ═══════════════════════════════════════════════════════════════════
   * 💰 src/Payroll.gs + src/PayAdjust.gs, untouched.
   *   computePayroll   the slip: base (pay type · temporary-leave rule) + เบี้ยขยัน (attendance · FB · Big Cleaning)
   *                    + child rate (PER TEACHER, blank = ฿0) + certificates + OT เย็น + OT carried from earlier
   *                    months + OT วันหยุด + adjustments − ประกันสังคม − เงินสมทบ − other. Saving upserts ONE row
   *                    per staff per month, UN-approves it, and mirrors the fund total onto STAFF. A non-admin is
   *                    always a preview (nothing written). The child count asks the ENGINE's ratedChildCount —
   *                    on this host the same engine on the same request's data (`engineRead`), read only.
   *   approvePayslip   publish / withdraw a saved slip (Approved YES / NO)
   *   adjustStaffPay   salary · position · allowances, one PAY_ADJUSTMENTS row per field that really changed
   *   payAdjustHistory that trail (a teacher: their own only)
   *   markSalaryPaid   paid / unpaid + the staff member's 🔔 (in-app only). An attached slip IMAGE goes to Apps
   *                    Script (Drive) — the image refusal below sends it there.
   *   recomputeContributions  the provident-fund totals rebuilt from the rows · preview first
   *   payrollDuplicates       find a person's second slip for one month (read only)
   *   contributionReset · deletePayrollRow — the PREVIEW and every refusal answer here; the confirmed write
   *                    takes a full backup of both workbooks first (dailyBackup), which is Apps Script's, so it
   *                    is refused here (NOT_ON_FAST_HOST) and Apps Script does all of it, backup included.
   * Proven by tools/test_fast_route_payroll.js and its _live twin. */
  computePayroll: { fn: 'handleComputePayroll',
    reads: ['STAFF', 'PAYROLL_CONFIG', 'PAYROLL', 'LEAVE_REQUEST', 'CHECKIN_STAFF', 'OT_RECORDS'],
    writes: { PAYROLL: PAYROLL_COLS_, STAFF: ['ContributionAccum'] }, appends: ['PAYROLL'], engineRead: ['ratedChildCount'] },
  approvePayslip: { fn: 'handleApprovePayslip', reads: ['PAYROLL'], writes: { PAYROLL: ['Approved', 'ApprovedBy', 'ApprovedAt'] } },
  adjustStaffPay: { fn: 'handleAdjustStaffPay', reads: ['STAFF', 'PAYROLL_CONFIG'],
    writes: { STAFF: ['BaseSalary', 'Position', 'PositionLevel'],
      PAYROLL_CONFIG: ['DiligenceAttendanceAmount', 'DiligenceFacebookAmount', 'ChildMultiplier', 'ChildThreshold', 'Contribution'] },
    appends: ['PAYROLL_CONFIG', 'PAY_ADJUSTMENTS'] },
  /* nameOnly: the gate's name rule (Code.gs isMutatingAction_ · MUTATING_RE) counts these two as writes, as Apps Script does (an
   * Observer is refused both there too). Neither writes; with no declaration, any write would be refused here. */
  payAdjustHistory: { fn: 'handlePayAdjustHistory', reads: ['PAY_ADJUSTMENTS'], nameOnly: true },
  markSalaryPaid: { fn: 'handleMarkSalaryPaid', reads: ['PAYROLL', 'ADMIN_INBOX'],
    writes: { PAYROLL: ['SlipSent', 'PaidDate', 'PaidBy', 'SlipUrl'] }, appends: ['ADMIN_INBOX'] },
  recomputeContributions: { fn: 'handleRecomputeContributions', reads: ['STAFF', 'PAYROLL'], writes: { STAFF: ['ContributionAccum'] } },
  payrollDuplicates: { fn: 'handlePayrollDuplicates', reads: ['STAFF', 'PAYROLL'], nameOnly: true },
  /* backupFirst: a mutating route whose every write comes after dailyBackup() — so it declares NO write here, and the
   * confirmed call is refused (NOT_ON_FAST_HOST) before anything changes. test_fast_routes.js holds it to that. */
  contributionReset: { fn: 'handleContributionReset', reads: ['STAFF', 'PAYROLL'], backupFirst: true },
  deletePayrollRow: { fn: 'handleDeletePayrollRow', reads: ['PAYROLL'], backupFirst: true },
  approveOT: { fn: 'handleApproveOT', reads: ['STAFF', 'OT_RECORDS'],
    writes: { OT_RECORDS: ['Step1By', 'Step1Status', 'Status'] } },
  confirmOT: { fn: 'handleConfirmOT', reads: ['STAFF', 'OT_RECORDS'],
    writes: { OT_RECORDS: ['Hours', 'Rate', 'Amount', 'Step2By', 'Step2Status', 'ApprovedBy', 'Status', 'Note'] } },
  /* A FAMILY DROPS OFF / PICKS UP (src/Parent.gs) — 💰 a pick-up after the child's own end time is a charge.
   *   IN   from anywhere (distance recorded) · OUT inside the fence unless the child is GeoExempt; a refused
   *        pick-up is audited with metres only. The day gate is assertStudentDayOpen_ (enrolled · not ended ·
   *        not the child's day off · school open or named in HOLIDAY_ATTEND).
   *   A second tap within CheckinDedupMinutes moves the same row's Time, no new row, nobody told again.
   *   OUT → otUpsertForPickup_: OT_DAILY row OT-<date>-<id> (grace · per-child rate/end/grace-until · waived
   *        days · a discount kept · an admin's cancel kept · money received never rewritten — PAYMENT_SLIPS).
   *   The class teachers' 🔔 (LINE by staff.arrival), the family's 🔔 + LINE for a charge (parent.ot).
   * Proven by tools/test_fast_route_pickup.js (a fixed clock on both sides) and its _live twin. */
  parentCheckin: { fn: 'handleParentCheckin',
    reads: ['PARENTS', 'STUDENTS', 'HOLIDAYS', 'HOLIDAY_ATTEND', 'CHECKIN_STUDENT', 'OT_DAILY', 'PAYMENT_SLIPS', 'STAFF', 'CLASSES', 'ADMIN_INBOX', 'USERS', 'LINE_RECIPIENTS'],
    writes: { CHECKIN_STUDENT: ['Time', 'GPS_Lat', 'GPS_Lng'],
      OT_DAILY: ['PickupTime', 'PlanEnd', 'LateMinutes', 'Hours', 'FullAmount', 'Discount', 'Amount', 'Status', 'CancelledBy', 'CancelNote', 'PaidDate'] },
    appends: ['CHECKIN_STUDENT', 'OT_DAILY', 'ADMIN_INBOX'], line: true, keepOnRefusal: ['AUDIT_LOG'] },
  /* A TEACHER RECORDS IT FOR THE FAMILY (src/Checkin.gs handleStaffStudentCheckin) — a grandparent at the gate.
   *   Remark mandatory · only a child of a class this teacher covers (head teacher '*' all) · refused on the
   *   child's leave day and by the same day gate as the parent's button · no fence (the teacher is at school).
   *   `time` HH:mm is the REAL moment (typed later is normal) and is what OT is charged from; ByAt is when
   *   the button was pressed. A second record of the same type today corrects that row's time.
   *   OUT → the same otUpsertForPickup_ as the parent's pick-up. The family's 🔔 + LINE (parent.checkin).
   * Proven by tools/test_fast_route_pickup.js section 9 and its _live twin. */
  staffStudentCheckin: { fn: 'handleStaffStudentCheckin',
    reads: ['STAFF', 'STUDENTS', 'CLASSES', 'LEAVE_REQUEST_STD', 'HOLIDAYS', 'HOLIDAY_ATTEND', 'CHECKIN_STUDENT', 'OT_DAILY', 'PAYMENT_SLIPS', 'PARENTS', 'ADMIN_INBOX'],
    writes: { CHECKIN_STUDENT: ['Time', 'Remark', 'ByStaffID', 'ByAt'],
      OT_DAILY: ['PickupTime', 'PlanEnd', 'LateMinutes', 'Hours', 'FullAmount', 'Discount', 'Amount', 'Status', 'CancelledBy', 'CancelNote', 'PaidDate'] },
    appends: ['CHECKIN_STUDENT', 'OT_DAILY', 'ADMIN_INBOX'], line: true }
};
/* 🔴 SCHOOL_CONFIG is readable by every ported route, as by every line of Apps Script: getConfig_ is
 * Db.gs's own (raw Key/Value rows, cached per execution in _configCache — reset per request here),
 * NOT the engine's M.config, which hydrateConfig_ has already turned into arrays and numbers. The two
 * disagree on purpose; a route must see what Apps Script's getConfig_ sees. */
const ALWAYS_READ = ['SCHOOL_CONFIG'];

/* Config/Auth: constants · Notify/Leave: the handlers · Checkin: resolveStaff_ · Code: apiError_ ·
 * GasEngine: decodeCell_. Loaded whole, as Apps Script loads them. */
const FILES = ['Config', 'Db', 'Audit', 'Line', 'Auth', 'Checkin', 'Code', 'GasEngine', 'Notify', 'Leave', 'Payroll', 'Day6', 'OtStaff', 'OT', 'Certificate',
  'Staff', 'Dspm', 'DspmAdmin', 'Parent', 'Journal', 'Announce',
  'Apply', 'PaySlips', 'AttReq', 'Password', 'BillRun', 'PayAdjust'];   // Apply: applyIdsForParent_ — a family's applications count toward their bell (Notify.gs)   // Dspm: getStudent_
let box = null, pristine = null, ORIG = null;
function load() {
  if (box) return box;
  box = { console: { log() {}, error() {} }, Logger: { log() {} } };
  vm.createContext(box);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.gs'), 'utf8'), box, { filename: f + '.gs' }));
  /* atomStaffHours_ — THE rule for a day's hours and lateness. It lives at the top level of webapp/engine.js
   * and reaches Apps Script through the generated Engine.gs; here it is lifted from the same file (already in
   * the image), so there is still one definition. A top-level function closes with `}` in column 0. */
  { const eng = fs.readFileSync(path.join(ROOT, 'webapp', 'engine.js'), 'utf8').replace(/\r\n/g, '\n');
    const at = eng.search(/^function atomStaffHours_\(/m), end = eng.indexOf('\n}', at);
    if (at < 0 || end < 0) throw new Error('routes: atomStaffHours_ not found in webapp/engine.js');
    vm.runInContext(eng.slice(at, end + 2), box, { filename: 'engine.js#atomStaffHours_' }); }
  Object.keys(PORTED).forEach(a => {
    if (typeof box[PORTED[a].fn] !== 'function') throw new Error('routes: ' + PORTED[a].fn + ' not found in src/*.gs');
    /* 🔴 ONLY A REAL Code.gs ROUTE. An action live answers from the ENGINE (myLeaves, 2026-11-06 — its name
     * is in another Code.gs list, not ROUTES) is already answered on the host by the same engine; running a
     * .gs handler for it instead would answer a different shape from live. Refused at load. */
    if (!box.ROUTES || !Object.prototype.hasOwnProperty.call(box.ROUTES, a)) throw new Error('routes: ' + a + ' is not a Code.gs route — live answers it from the engine');
  });
  /* 🔴 EVERY REQUEST STARTS FROM THE STATE THE FILES LOAD INTO — as every Apps Script execution does.
   * The .gs files keep module-level memos that are safe there only because an execution ends:
   * Leave.gs caches the whole STAFF sheet in _leaveStaffIdx on first use. In one long-lived sandbox
   * that memo would hand the NEXT request — another school, or the same school after a change —
   * this request's staff. So every non-function global is remembered here as it was after loading,
   * and restored (a fresh copy) before each run; globals created at run time are removed. */
  /* the two LINE functions as Apps Script defines them — every run below replaces them (refused, or the
   * recorder), so the originals are kept here or the first run would lose them for good */
  ORIG = { linePush_: box.linePush_, linePushText_: box.linePushText_ };
  pristine = {};
  FN_AT_LOAD = new Set(Object.keys(box).filter(k => typeof box[k] === 'function'));
  Object.keys(box).forEach(k => {
    const v = box[k];
    if (typeof v === 'function') return;
    try { pristine[k] = { v: structuredClone(v) }; } catch (e) { pristine[k] = { ref: v }; }   // holds a function: kept as loaded
  });
  return box;
}
function resetBox(b) {
  Object.keys(b).forEach(k => {
    if (Object.prototype.hasOwnProperty.call(pristine, k)) return;
    if (typeof b[k] === 'function' && FN_AT_LOAD.has(k)) return;
    delete b[k];
  });
  Object.keys(pristine).forEach(k => { const p = pristine[k]; b[k] = 'v' in p ? structuredClone(p.v) : p.ref; });
}
let FN_AT_LOAD = null;

const p2 = n => String(n).padStart(2, '0');
/** Utilities.formatDate, for the one zone and the patterns the ported routes use — anything else throws */
function formatDate(d, tz, fmt) {
  if (tz !== 'Asia/Bangkok') throw new Error('routes: formatDate in ' + tz + ' is not supported');
  const t = new Date(new Date(d).getTime() + 7 * 3600000);
  const parts = { yyyy: t.getUTCFullYear(), MM: p2(t.getUTCMonth() + 1), dd: p2(t.getUTCDate()), HH: p2(t.getUTCHours()), mm: p2(t.getUTCMinutes()), ss: p2(t.getUTCSeconds()),
    EEEE: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][t.getUTCDay()] };   // WORK_SCHEDULE.DayOfWeek
  if (!/^(yyyy|MM|dd|HH|mm|ss|EEEE|[-/: ])+$/.test(fmt)) throw new Error('routes: formatDate pattern ' + fmt + ' is not supported');
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss|EEEE/g, k => String(parts[k]));
}


/** Sheets to read from Postgres before running these actions — with row ids where the route may write */
/* rows are loaded for what a route READS, CHANGES or DELETES (to find them); a sheet it only APPENDS to
 * (the audit log) is never loaded — appendObject_ does not read the sheet */
function needs(actions) {
  const s = new Set();
  actions.forEach(a => { const d = PORTED[a]; if (d) ALWAYS_READ.concat(d.reads || [], Object.keys(d.writes || {}), d.deletes || []).forEach(x => s.add(x)); });
  return [...s];
}
/* ...and with row ids where it may change or delete them */
function writable(actions) {
  const s = new Set();
  actions.forEach(a => { const d = PORTED[a]; if (d) Object.keys(d.writes || {}).concat(d.deletes || [], d.appends || []).forEach(x => s.add(x)); });
  return [...s];
}
const writes = a => { const d = PORTED[a]; return !!(d && (d.writes || d.appends || d.deletes || d.engine)); };
const sendsLine = a => !!(PORTED[a] && PORTED[a].line);
/* the ENGINE collections a route may change through engineDispatch_ (holidayWrite_ → addHoliday) — the host
 * saves those through its own engine path, and only these */
const engineWrites = a => ((PORTED[a] || {}).engine || []).slice();

/**
 * Run the ported route `action` with the payload the gate already stamped (applyIdentity_).
 * raw   { SHEET: rows } — read for this request (needs())
 * H     the engine handlers on this request's M, for routes that fall through (engineDispatch_)
 * sink  array the route's writes are pushed to: { sheet, id, patch } — the host saves them under its
 *       lock (PG.updateSheetRows). The change is ALSO applied to raw, so a later call in the same batch
 *       reads it, exactly as the next call on Apps Script would read the sheet.
 */
/* 🧪 A FIXED CLOCK — FOR THE PROOFS ONLY. Lateness and OT are functions of "now", so the comparison with Apps
 * Script needs both sides to stand at the same minute. setClock(ms) makes `new Date()` inside the sandbox answer
 * that moment for the runs that follow; setClock(null) puts the real clock back. server/host.js never calls
 * it (tools/test_fast_route_clock.js checks that it never appears there). */
let CLOCK_MS = null;
function setClock(ms) { CLOCK_MS = (ms == null) ? null : Number(ms); }
const FAKE_DATE = '(function (ms) { var R = Date; function F(a, b, c, d, e, f, g) { var n = arguments.length;' +
  ' if (!(this instanceof F)) return new R(ms).toString();' +
  ' return n === 0 ? new R(ms) : n === 1 ? new R(a) : new R(a, b, n > 2 ? c : 1, d || 0, e || 0, f || 0, g || 0); }' +
  ' F.prototype = R.prototype; F.now = function () { return ms; }; F.parse = R.parse; F.UTC = R.UTC; Date = F; })';
function run(action, payload, raw, H, config, sink, line) {
  const def = PORTED[action];
  if (!def) throw new Error('routes: ' + action + ' is not ported');
  /* 🔴 Apps Script's code reads the hour and the weekday with Date.getHours()/getDay(), in Asia/Bangkok.
   * On a clock that is not UTC+7 the same code answers differently — lateness, OT and "is the school shut"
   * — and nothing would look wrong. So a host on any other clock does not run a ported route at all: the
   * app re-asks Apps Script (NOT_ON_FAST_HOST). Proven by tools/test_fast_route_clock.js. */
  if (new Date().getTimezoneOffset() !== -420) {
    const e = new Error('routes: the host clock is not Asia/Bangkok (offset ' + new Date().getTimezoneOffset() + ' min) — ' + action + ' is not run here');
    e.apiCode = 'NOT_ON_FAST_HOST'; throw e;
  }
  const b = load();
  resetBox(b);
  if (CLOCK_MS != null) vm.runInContext(FAKE_DATE, b)(CLOCK_MS);   // resetBox removes it again before the next run
  /* WHAT THIS ROUTE MAY TOUCH — all declared, nothing inferred (W0, 2026-11-07):
   *   reads    sheets it reads
   *   writes   { SHEET: [columns] } — cells of EXISTING rows it may change (updateRow_)
   *   appends  [SHEET] — sheets it may add rows to (appendObject_, setConfigValue_ for a new key)
   *   deletes  [SHEET] — sheets it may remove rows from (sheet.deleteRow)
   * A route that writes anything may also add to the audit log (logAudit → AUDIT_LOG, logAuditHr →
   * HR_AUDIT_LOG): that row is part of the write on Apps Script, so it is part of it here. */
  const may = def.writes || {};
  const appends = new Set(def.appends || []), deletes = new Set(def.deletes || []);
  if (def.writes || def.appends || def.deletes || def.engine) { appends.add('AUDIT_LOG'); appends.add('HR_AUDIT_LOG'); }
  const readable = new Set(ALWAYS_READ.concat(def.reads || [], Object.keys(may), [...deletes]));
  /* 🔴 Apps Script's own code wraps reads in try {} catch (e) {} (inboxStudentsForParent_ does), so a
   * throw alone would be swallowed and the answer would quietly be "nothing". The first violation is
   * REMEMBERED and thrown after the handler returns, whatever the handler did with it. */
  let violation = null;
  /* A breach answers NOT_ON_FAST_HOST: nothing was recorded (the call's writes are discarded), and Apps
   * Script — which CAN do the thing (an image to Drive, a path this port never saw) — is asked instead
   * (webapp/api.js FAST_FORWARD). The message keeps the detail for the log and the tests. */
  const breach = msg => { const e = new Error(msg); e.apiCode = 'NOT_ON_FAST_HOST'; if (!violation) violation = e; throw e; };
  const refuseWrite = name => () => breach('routes: a ported route tried to write (' + name + ') — not allowed on the fast host');
  const isImage = v => typeof v === 'string' && /^data:image\//.test(v);
  /* The call works on its OWN copy of each sheet. Only when it finishes cleanly do its writes reach
   * raw (for the next call in the batch) and the sink (for Postgres) — a call that fails halfway leaves
   * nothing behind, where Apps Script would have left the rows it got to. Stricter, never looser. */
  const work = {}, ops = [], touched = new Set();
  let tmpN = 0;
  const clone = x => JSON.parse(JSON.stringify(x));
  const sheetRows = name => (work[name] || (work[name] = clone(raw[name] || [])));
  const view = (r, i) => {
    const o = clone(r); delete o.__id;                                   // Apps Script never sees our row ids
    // NON-enumerable, exactly as Db.gs readObjects_ defines it — so a handler that copies a row with
    // for…in (leaveDecodeEnrich_ does) does not carry _row into the reply
    Object.defineProperty(o, '_row', { value: i + 2, enumerable: false });
    return o;
  };
  const rows = name => {
    if (!readable.has(name)) breach('routes: ' + action + ' read ' + name + ' which it does not declare');
    return sheetRows(name).map(view);
  };
  const cols = name => { const c = PG.colsOf(name); if (!c.length) breach('routes: ' + action + ' touched ' + name + ' which has no table'); return c; };
  const updateRow = (s, rowIndex, patch) => {
    const name = nameOf(s), allowedCols = may[name];
    if (!allowedCols) return breach('routes: ' + action + ' tried to write ' + name + ' which it does not declare');
    /* 🔴 A COLUMN THE SHEET DOES NOT HAVE. Apps Script's updateRow_ writes only the sheet's own headers and drops
     * the rest without a word — paySlipRecompute_ stamps VerifiedStatus on every payable, and OT_DAILY /
     * STUDENT_CHARGES have no such column (Config.gs SCHEMA, and no ensureColumns_ ever adds one), so on Apps
     * Script that half of the patch has never been stored. A route DECLARES each such field (`drops`), and only
     * when it is not a column here; tools/test_fast_route_payments.js asserts every declared drop is absent from
     * the sheet's SCHEMA and from every ensureColumns_ call. Anything undeclared still refuses. */
    const dropHere = ((def.drops || {})[name] || []).filter(k => cols(name).indexOf(k) < 0);
    if (dropHere.length && patch) { patch = Object.assign({}, patch); dropHere.forEach(k => { delete patch[k]; }); }
    const keys = Object.keys(patch || {});
    const bad = keys.filter(k => allowedCols.indexOf(k) < 0);
    if (bad.length) return breach('routes: ' + action + ' tried to write ' + name + '.' + bad.join(',') + ' which it does not declare');
    if (keys.some(k => isImage(patch[k]))) return breach('routes: ' + action + ' wrote an image — Drive is Apps Script\'s (NOT_ON_FAST_HOST)');
    const row = sheetRows(name)[rowIndex - 2];
    if (!row || !row.__id) return breach('routes: ' + action + ' updated row ' + rowIndex + ' of ' + name + ' which has no id (read without withId?)');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const clean = clone(patch);
    Object.assign(row, clean);
    ops.push({ op: 'update', sheet: name, id: row.__id, patch: clean }); touched.add(name);
  };
  /* appendObject_: every header column, '' where the object has none — exactly the row Apps Script appends */
  const appendObject = (s, obj) => {
    const name = nameOf(s);
    if (!appends.has(name)) return breach('routes: ' + action + ' tried to add a row to ' + name + ' which it does not declare');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const row = {};
    cols(name).forEach(h => { const v = (obj || {})[h]; row[h] = (v === undefined || v === null) ? '' : v; });
    if (Object.keys(row).some(k => isImage(row[k]))) return breach('routes: ' + action + ' wrote an image — Drive is Apps Script\'s (NOT_ON_FAST_HOST)');
    const clean = clone(row), tmp = 'new:' + (++tmpN);
    sheetRows(name).push(Object.assign({ __id: tmp }, clean));
    ops.push({ op: 'insert', sheet: name, tmp, row: clean }); touched.add(name);
    return sheetRows(name).length + 1;
  };
  /* sheet.deleteRow: the rows below move up one, as on the sheet — later row numbers mean what they mean there */
  const deleteRow = (name, rowIndex) => {
    if (!deletes.has(name)) return breach('routes: ' + action + ' tried to delete a row of ' + name + ' which it does not declare');
    if (!sink) return breach('routes: ' + action + ' wrote with nowhere to record it');
    const arr = sheetRows(name), row = arr[rowIndex - 2];
    if (!row || !row.__id) return breach('routes: ' + action + ' deleted row ' + rowIndex + ' of ' + name + ' which is not there');
    if (String(row.__id).indexOf('new:') === 0) {                         // added in this call: never reaches Postgres
      const i = ops.findIndex(o => o.op === 'insert' && o.tmp === row.__id); ops.splice(i, 1);
    } else ops.push({ op: 'delete', sheet: name, id: row.__id });
    arr.splice(rowIndex - 2, 1); touched.add(name);
  };
  /* a READ-ONLY range over the sheet as Apps Script would see it (row 1 = headers) — findJournalRow_ reads
   * two columns this way. Writing through a range is not supported: updateRow_ / appendObject_ only. */
  const range = (name, r, c, nr, nc) => ({
    getValues: () => {
      const h = cols(name), data = rows(name), out = [];
      for (let i = 0; i < (nr || 1); i++) {
        const rr = r + i, src = rr === 1 ? null : data[rr - 2];
        if (rr !== 1 && !src) break;
        out.push(h.slice(c - 1, c - 1 + (nc || 1)).map(k => rr === 1 ? k : src[k]));
      }
      return out;
    },
    getValue: () => range(name, r, c, 1, 1).getValues()[0][0],
    /* ONE cell, written like updateRow_ — same declaration, same checks (writeBigCleaning_ writes its value this way) */
    setValue: v => { if ((nr || 1) !== 1 || (nc || 1) !== 1 || r < 2) return breach('routes: ' + action + ' setValue on more than one cell or the header row');
      updateRow({ __sheet: name }, r, { [cols(name)[c - 1]]: v }); },
    setNumberFormat: () => {}, setNumberFormats: () => {},        // a display format; Postgres stores the text as text
    /* W2 (2026-11-09): APPENDING whole rows in one write — inboxAddMany_ (Notify.gs) adds every teacher's 🔔
     * row with one getRange(lastRow+1, 1, n, headers).setValues(). Only that exact shape is allowed: it starts
     * on the first empty row, covers every header column, and goes through appendObject — the same declaration
     * check, the same image refusal. Anything else (overwriting rows, partial columns) is still refused. */
    setValues: vals => {
      const h = cols(name);
      if (r !== rows(name).length + 2 || c !== 1 || (nc || 0) !== h.length || !Array.isArray(vals) || vals.length !== (nr || 0))
        return breach('routes: ' + action + ' Range.setValues — only appending whole rows after the last row is supported');
      vals.forEach(arr => { const o = {}; h.forEach((k, i) => { o[k] = arr[i]; }); appendObject({ __sheet: name }, o); });
    }
  });
  const sheetObj = name => ({
    __sheet: name, getName: () => name,
    getLastRow: () => rows(name).length + 1, getLastColumn: () => cols(name).length,
    getRange: (r, c, nr, nc) => range(name, r, c, nr, nc),
    deleteRow: i => deleteRow(name, i),
    appendRow: refuseWrite('appendRow'), deleteRows: refuseWrite('deleteRows'), sort: refuseWrite('sort'),
    insertRowsAfter: refuseWrite('insertRowsAfter'), clearContents: refuseWrite('clearContents')
  });
  const nameOf = s => (s && s.__sheet) || s;
  /* 🔴 the workbook matters for one sheet: AUDIT_LOG is two logs (MAIN / HR), two tables */
  const inBook = (wb, n) => (wb === 'HR' && n === 'AUDIT_LOG') ? 'HR_AUDIT_LOG' : n;
  const book = wb => ({ __wb: wb, getSheetByName: n => sheetObj(inBook(wb, n)), insertSheet: refuseWrite('insertSheet') });
  b.getMainSpreadsheet_ = () => book('MAIN');
  b.getHrSpreadsheet_ = () => book('HR');
  b.sheet_ = (wb, name) => sheetObj(inBook(wb && wb.__wb, name));
  b.readObjects_ = s => rows(nameOf(s));
  b.findObject_ = (s, pred) => rows(nameOf(s)).find(pred) || null;
  b.headers_ = s => cols(nameOf(s)).slice();
  b.ensureColumns_ = (s, want) => {                                      // the table has the columns it has
    const have = cols(nameOf(s)), missing = (want || []).filter(c => have.indexOf(c) < 0);
    if (missing.length) breach('routes: ' + nameOf(s) + ' has no column ' + missing.join(',') + ' in Postgres');
  };
  b.Utilities = { formatDate };
  /* 🔴 A FULL BACKUP OF BOTH WORKBOOKS (src/Backup.gs) is Apps Script's — contributionReset and deletePayrollRow
   * take one before they change a figure. Refused here, so the whole call goes to Apps Script, backup first. */
  b.dailyBackup = refuseWrite('dailyBackup');
  /* THE ENGINE, READ ONLY (W4 3d) — Payroll.gs ratedChildTotalFor_ asks createAtomAPI(hydrateLazy_().M).H for the
   * month's rated-child count. Here that is the engine the host already built on THIS request's data (H), and only
   * the handlers the route declares (engineRead); persist is never offered. Without a declaration the attempt is a
   * breach — never a silent null, which ratedChildTotalFor_ would turn into a confident ฿0. */
  if (def.engineRead) {
    const allowedH = {};
    def.engineRead.forEach(n => { allowedH[n] = p => { const h = H && H[n]; if (typeof h !== 'function') breach('routes: engine ' + n + ' is not available'); return clone(h(p)); }; });
    b.hydrateLazy_ = () => ({ M: null, persist: refuseWrite('persist') });
    b.createAtomAPI = () => ({ H: allowedH });
  } else {
    b.hydrateLazy_ = refuseWrite('hydrateLazy_');
  }
  b.engineDispatch_ = (a, p) => { const h = H && H[a]; if (typeof h !== 'function') throw new Error('UNKNOWN_ACTION ' + a); return h(p || {}); };
  ['appendRows_', 'deleteRow_', 'writeRows_'].forEach(n => { b[n] = refuseWrite(n); });
  /* ── LINE (W2, 2026-11-09) ─────────────────────────────────────────────────────────────────────
   * A route declared `line: true` runs Apps Script's linePushText_ untouched (LINE_DEFER_ is null here,
   * so it calls linePush_) — and linePush_ is the ONE thing replaced: it writes { to, messages } down
   * instead of calling LINE. Who gets what, under which switch, is still Apps Script's code alone.
   * The host sends the list only after it has committed this call's writes (server/line_send.js).
   * Its answer is linePush_'s: false in demo mode, false with no recipient or no token (line.ready —
   * the host's, never the sandbox's: the token does not enter here), else true.
   * A route NOT declared `line` is refused on its first push, as before: it goes to Apps Script. */
  const lineOps = [];
  if (def.line) {
    if (!line || !Array.isArray(line.out)) breach('routes: ' + action + ' sends LINE with nowhere to record it');
    b.linePushText_ = ORIG.linePushText_;
    b.linePush_ = (toUid, messages) => {
      /* 🔴 demo mode: DemoMode alone is enough here (Apps Script also wants the ATOM_DEMO property) — stricter */
      try { if (String(b.getConfig_('DemoMode', 'false')).toLowerCase() === 'true') return false; } catch (e) { return false; }
      if (!toUid || !line.ready) return false;
      lineOps.push({ to: String(toUid), messages: clone(messages) });
      return true;
    };
  } else {
    b.linePushText_ = refuseWrite('linePushText_');
    b.linePush_ = refuseWrite('linePush_');
  }
  b.updateRow_ = updateRow;
  b.appendObject_ = appendObject;
  /* Apps Script's CacheService copies cannot be cleared from here and need not be: every sheet this call
   * writes gets a new cache VERSION in the same transaction (host → PG.bumpCacheVersions), which retires
   * every key built on it (DbPg.gs pgCacheKey_ — 'cfg' included). So: nothing cached, nothing to clear. */
  ['cacheDel_', 'bustSheetCache_', 'inboxBust_', 'journalCacheBust_'].forEach(n => { b[n] = () => {}; });
  const noCache = { get: () => null, getAll: () => ({}), put() {}, putAll() {}, remove() {}, removeAll() {} };
  b.CacheService = { getScriptCache: () => noCache, getUserCache: () => noCache, getDocumentCache: () => noCache };
  b.LockService = { getScriptLock: refuseWrite('LockService') };
  b.UrlFetchApp = { fetch: refuseWrite('UrlFetchApp') };
  b.DriveApp = new Proxy({}, { get: () => refuseWrite('DriveApp') });
  b.__p = JSON.parse(JSON.stringify(payload || {}));
  let out, thrown = null;
  /* args: fixed leading arguments — holidayWrite_('addHoliday', p) is one function for three routes */
  const call = def.fn + '(' + (def.args || []).map(x => JSON.stringify(x) + ', ').join('') + '__p)';
  try { out = vm.runInContext(call, b); } catch (e) { thrown = e; }
  if (violation) throw violation;
  /* 🔴 A REFUSAL THAT APPS SCRIPT RECORDS. A sheet is not a transaction: when Parent.gs writes the audit
   * row "pick-up refused, 1112 m away" and then throws OUT_OF_RANGE, the row stays — and it is there on
   * purpose, it is how the school tells a fence set too tight from the rule working. A route that declares
   * `keepOnRefusal` keeps ONLY its NEW rows in those sheets when it refuses (an apiCode, never a breach,
   * never a crash); everything else it wrote is discarded and nobody is sent anything. The host commits
   * them with the refusal (server/host.js keptOnRefusal). */
  if (thrown) {
    const keep = new Set(def.keepOnRefusal || []);
    if (keep.size && thrown.apiCode && thrown.apiCode !== 'NOT_ON_FAST_HOST') {
      const kept = ops.filter(o => o.op === 'insert' && keep.has(o.sheet));
      if (kept.length) { kept.forEach(o => sink.push(o)); thrown.keptOnRefusal = kept.length; }
    }
    throw thrown;
  }
  touched.forEach(n => { raw[n] = work[n]; });
  ops.forEach(o => sink.push(o));
  lineOps.forEach(o => line.out.push(o));               // only a call that finished cleanly sends anything
  return out === undefined ? out : JSON.parse(JSON.stringify(out));
}

/* the sheets a route is Apps Script's in-place exception to the shrink guard for (host.js) — must also be in `deletes` */
const shrinks = a => { const d = PORTED[a] || {}; return (d.shrinks || []).filter(x => (d.deletes || []).indexOf(x) >= 0); };
module.exports = { PORTED, has: a => Object.prototype.hasOwnProperty.call(PORTED, a), needs, writable, writes, sendsLine, engineWrites, shrinks, run, formatDate, setClock, FAKE_DATE };
