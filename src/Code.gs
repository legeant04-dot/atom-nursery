/**
 * Code.gs — Web App entry point & request router (Proposal §9 Day 2)
 * ------------------------------------------------------------------
 * Deploy: Deploy > New deployment > Web app > Execute as: me >
 * Who has access: Anyone. Copy the /exec URL into the LIFF Endpoint.
 *
 * LIFF calls this endpoint with a JSON body: { action, payload }.
 * doPost routes 'action' to a handler and returns a JSON envelope:
 *   success -> { ok: true,  data: ... }
 *   failure -> { ok: false, error: { code, message } }
 * ------------------------------------------------------------------
 */

// action name -> handler(payload) -> data object
var ROUTES = {
  // ?probe=1 additionally reports how long the two things EVERY request pays for actually take:
  // opening the workbook and reading the config. Both are work a normal request does anyway, and
  // neither returns any school data — just milliseconds — so this is safe on a public action.
  // It is the only way to tell "the server is slow" apart from "the phone's network is slow".
  ping:           function (p)  {
    var out = { pong: true, time: new Date().toISOString() };
    if (p && p.probe) {
      var t0 = Date.now(); try { getMainSpreadsheet_(); } catch (e) {}
      var t1 = Date.now(); try { getMainSpreadsheet_(); } catch (e) {}   // memoised: should be ~0ms
      var t2 = Date.now(); try { hydrateConfig_(); } catch (e) {}
      out.ms = { openFirst: t1 - t0, openAgain: t2 - t1, config: Date.now() - t2 };
      // Opening a workbook turns out to be lazy and free; READING a sheet is what costs. Time the
      // collections a normal screen pulls, so "which sheet is slow" stops being guesswork.
      // Milliseconds only — no rows, no counts, nothing about any child leaves here.
      if (p.probe === 2 || p.probe === '2') {
        out.read = {};
        /* ...AND HOW BIG EACH ONE IS, because the time on its own does not say WHY.
         *
         * Every collection is cached (readCollection_), chunked up to ~1 MB
         * (CACHE_PART_ × CACHE_MAX_PARTS_). Past that cachePut_ gives up and removes the key — so a
         * collection over the limit is read LIVE on every single request, for ever, and nothing
         * anywhere says so. On 2026-09-22 `journals` measured 10.7s against 45-120ms for everything
         * else, which is either a big sheet or an uncacheable one, and those need opposite fixes.
         * Bytes only — no rows, no content, nothing about any child leaves here. */
        out.bytes = {}; out.cacheLimit = (typeof CACHE_PART_ === 'number' ? CACHE_PART_ * CACHE_MAX_PARTS_ : 0);
        /* ...and the NARROW journal read beside the full one, because the whole point of v396 is the
         * difference between the two and it should be measurable from outside rather than argued. */
        try {
          var jd = gasToday_(), js = Date.now();
          var jrows = readJournalsForDate_(jd);
          out.journalDay = { date: jd, ms: Date.now() - js, rows: jrows ? jrows.length : -1,
                             bytes: jrows ? JSON.stringify(jrows).length : -1 };
        } catch (e) { out.journalDay = { error: String(e && e.message || e) }; }
        // the finance ones are here because financeSummary is the slowest action in the report and
        // "the sheets are slow" had to be proved or ruled out. payroll lives in the SECOND workbook,
        // which is the one thing on this list that could cost more than a read.
        ['students', 'staff', 'checkinStudent', 'journals', 'payments', 'otDaily', 'leaves',
         'paymentSlips', 'studentCharges', 'prepayments', 'payroll'].forEach(function (k) {
          var s = Date.now();
          var rows = null;
          try { rows = readCollection_(k); } catch (e) {}
          out.read[k] = Date.now() - s;
          try { out.bytes[k] = rows ? JSON.stringify(rows).length : -1; } catch (e) { out.bytes[k] = -1; }
        });
      }
    }
    return out;
  },
  /* A LINE UID ON ITS OWN IS A CLAIM, NOT A PROOF.
   *
   * handleAuth accepts `lineUid` without a token as a direct-API testing fallback (see its header),
   * and `auth` is public — so anyone who knows somebody's LINE UID could post it here and be handed
   * that person's twelve-hour session. Those ids are not secret: the sign-in screen prints your own
   * for copying, and the admin forms hold everybody's.
   *
   * Found 09/09/26 while building the Google door, whose whole design rests on handleAuth being the
   * one trustworthy place identity is decided. Refused here rather than inside handleAuth, because
   * the setup and diagnostic functions call that directly and are not reachable from the internet;
   * gated on the same flag as the rest of session enforcement, so local testing is unaffected.
   */
  auth:           function (p) {
    if (p && p.lineUid && !p.accessToken && sessionRequired_()) {
      try { logAudit('anon', 'AUTH_UID_ONLY_REFUSED', 'AUTH', String(p.lineUid).slice(0, 40)); } catch (e) {}
      throw apiError_('NO_IDENTITY', 'ต้องเข้าสู่ระบบผ่าน LINE หรือ Google');
    }
    return handleAuth(p);
  },
  // browser-only LINE sign-in (the fallback when the iOS hand-off to the LINE app never returns)
  lineLoginReady: function (p) { return handleLineLoginReady(p); },
  lineExchange:   function (p) { return handleLineExchange(p); },
  googleLoginReady: function (p) { return handleGoogleLoginReady(p); },
  googleExchange: function (p) { return handleGoogleExchange(p); },
  googleLink:     function (p) { return handleGoogleLink(p); },
  changePassword: function (p) { return handleChangePassword(p); },
  // in-place staff CRUD (override the engine's full-collection rewrite, which could wipe other rows)
  saveStaff:      function (p) { return handleSaveStaff(p); },
  saveStaffSelf:  function (p) { return handleSaveStaffSelf(p); },
  setStaffEnd:    function (p) { return handleSetStaffEnd(p); },
  setStaffPause:  function (p) { return handleSetStaffPause(p); }, // admin-only: temporary leave (ลาชั่วคราว) — employed, not here   // admin-only: end (or resume) employment; the record is kept
  setRequireCheckin: function (p) { return handleSetRequireCheckin(p); },
  deleteStaff:    function (p) { return handleDeleteStaff(p); },
  saveStudent:    function (p) { return handleSaveStudent(p); },
  saveParent:     function (p) { return handleSaveParent(p); },
  saveParentSelf: function (p) { return handleSaveParentSelf(p); },
  saveFamilyParent: function (p) { return handleSaveFamilyParent(p); },
  saveStudentSelf:  function (p) { return handleSaveStudentSelf(p); },
  unlinkStudent:    function (p) { return handleUnlinkStudent(p); },   // admin-only: detach a parent from a child (child stays enrolled)
  linkParentAdmin:  function (p) { return handleLinkParentAdmin(p); },   // admin-only: link a parent UID to a student by National ID (bypass)
  claimParent:      function (p) { return handleClaimParent(p); },   // onboarding: a parent the school already has on file claims that record instead of creating a duplicate
  setLeaveQuota:    function (p) { return handleSetLeaveQuota(p); },   // admin-only: writes SCHOOL_CONFIG (the engine only mutated memory, which persist() never saves)
  setConfigVal:     function (p) { return handleSetConfigVal(p); },   // admin-only: one whitelisted SCHOOL_CONFIG value
  /* Certificates (src/Certificate.gs). certStudents is left to the engine — it is a pure read over
   * STUDENTS with no Sheets or Drive call in it — but everything that touches a FILE has to be here,
   * because Drive does not exist in the shared engine. */
  certText:         function (p) { return handleCertText(p); },       // admin-only: the twelve wording lines
  saveCertText:     function (p) { return handleSaveCertText(p); },   // admin-only: all twelve in one write
  certAssets:       function (p) { return handleCertAssets(p); },     // admin-only: artwork + signature, as data URLs
  saveCertAsset:    function (p) { return handleSaveCertAsset(p); },  // admin-only: replace/clear one of them
  markCertIssued:   function (p) { return handleMarkCertIssued(p); }, // admin-only: audit that a certificate was printed
  notifyBills:      function (p) { return handleNotifyBills(p); },   // admin-only: notify parents that bills were issued
  saveQRCodes:      function (p) { return handleSaveQRCodes(p); },   // admin-only: QR-code master + OT binding
  savePlans:        function (p) { return handleSavePlans(p); },       // admin-only: package (Plan) CRUD → SCHOOL_CONFIG JSON
  savePrepayTiers:  function (p) { return handleSavePrepayTiers(p); }, // admin-only: advance-tuition discount tiers → SCHOOL_CONFIG JSON
  setStudentPause:  function (p) { return handleSetStudentPause(p); }, // admin-only: temporary leave (ลาชั่วคราว), in-place
  // admin-only: the child's LAST DAY, recorded in advance. In place, and Status is left alone —
  // studentEnded_ is what acts on the date when it passes (see handleSetStudentEnd).
  setStudentEnd:    function (p) { return handleSetStudentEnd(p); },
  recordCashPayment: function (p) { return handleRecordCashPayment(p); }, // admin-only: money received outside the app
  deleteSlip:       function (p) { return handleDeleteSlip(p); },      // admin-only: remove an empty payment row (no image)
  cancelPrepay:     function (p) { return handleCancelPrepay(p); },    // admin-only: delete an UNPAID advance payment, in place
  editPrepay:       function (p) { return handleEditPrepay(p); },      // admin-only: correct the months an advance payment covers
  slipDiag:         function (p) { return handleSlipDiag(p); },        // admin-only: is SlipOK reachable, and what did it say
  saveSlipOk:       function (p) { return handleSaveSlipOk(p); },      // admin-only: point the app at the right SlipOK branch
  // Phase 0 telemetry (src/Perf.gs). perfLog is PUBLIC on purpose — a user who cannot sign in has
  // no token, and their rows are the ones we most need. See the security fence in Perf.gs.
  perfLog:          function (p) { return handlePerfLog(p); },
  perfSummary:      function (p) { return handlePerfSummary(p); },     // admin-only: the ranked report
  deletePerfLog:    function (p) { return handlePerfClear(p); },       // admin-only: start a fresh measurement window ("delete" prefix => takes the write lock)
  prepayAudit:      function (p) { return handlePrepayAudit(p); },     // admin-only: find/repair bills over-credited by the old prepay logic
  deleteBill:       function (p) { return handleDeleteBill(p); },
  setSchoolConfig:  function (p) { return handleSetSchoolConfig(p); },
  recomputeAttendance: function (p) { return handleRecomputeAttendance(p); },
  diagDay:          function (p) { return handleDiagDay(p); },         // admin-only READ: what the server thinks today is
  /**
   * Changing a holiday changes what TODAY'S hours were, and rows already written keep the lateness
   * they were given at the moment they were tapped. On 2026-08-19 that left four teachers at 250–311
   * minutes late for arriving as the school reopened, and the only cure was a repair tool with no
   * button on it — so nobody could have run it even if they had known it existed.
   *
   * The thing that invalidates those rows is this write, so this write repairs them. No one has to
   * know, and no one has to remember. The three actions still do their real work in the engine;
   * these routes only add the tidy-up afterwards.
   */
  addHoliday:       function (p) { return holidayWrite_('addHoliday', p); },
  editHoliday:      function (p) { return holidayWrite_('editHoliday', p); },
  removeHoliday:    function (p) { return holidayWrite_('removeHoliday', p); },
  /**
   * Correcting a pick-up time can CREATE a charge — a day back-filled as 18:09 owes late-pickup OT
   * exactly as a live tap at 18:09 would. The live tap tells the parent (handleStaffStudentCheckin
   * pushes them a message); the correction told nobody at all, so a charge could appear on a family's
   * bill days later with no word about where it came from. The engine still does the work.
   */
  editStudentAttendance: function (p) { return editAttendanceWrite_(p); },
  listBackups:      function (p) { return handleListBackups(p); },
  restoreSheet:     function (p) { return handleRestoreSheet(p); },
  addDepartment:    function (p) { return handleAddDepartment(p); },
  removeDepartment: function (p) { return handleRemoveDepartment(p); },
  renameDepartment: function (p) { return handleRenameDepartment(p); },
  changeStaffPassword:  function (p) { return handleChangeStaffPassword(p); },
  checkStaffPassword:   function (p) { return handleCheckStaffPassword(p); },
  getStaffPassword:     function (p) { return handleGetStaffPassword(p); },
  adminResetPassword:   function (p) { return handleAdminResetPassword(p); },
  requestPasswordReset: function (p) { return handleRequestPasswordReset(p); },
  uploadSlip:     function (p) { return handleUploadSlip(p); },
  payCombined:    function (p) { return handlePayCombined(p); },
  // the same selection, handed over in cash at the school — no slip, but the same amount rule
  payCombinedCash: function (p) { return handlePayCombinedCash(p); },
  payOT:          function (p) { return handlePayOT(p); },
  payCharge:      function (p) { return handlePayCharge(p); },
  teacherPayOT:   function (p) { return handlePayOT(p); },   // teacher pays a student's OT on behalf (same in-place slip pipeline; read is class-scoped in the engine)
  payPrepay:      function (p) { return handlePayPrepay(p); },
  confirmSlip:    function (p) { return handleConfirmSlip(p); },
  rejectSlip:     function (p) { return handleRejectSlip(p); },
  deleteParent:   function (p) { return handleDeleteParent(p); },
  removeStudent:  function (p) { return handleRemoveStudent(p); },
  // Day 3 — GPS staff attendance
  staffCheckin:   function (p) { return handleStaffCheckin(p); },
  staffStudentCheckin: function (p) { return handleStaffStudentCheckin(p); },
  adminUpdateOT:  function (p) { return handleAdminUpdateOT(p); },
  adminCancelOT:  function (p) { return handleAdminCancelOT(p); },
  adminRestoreOT: function (p) { return handleAdminRestoreOT(p); },
  staffCheckout:  function (p) { return handleStaffCheckout(p); },
  // Day 4 — leave workflow + parent check-in
  submitLeave:    function (p) { return handleSubmitLeave(p); },
  approveLeave:   function (p) { return handleApproveLeave(p); },
  allLeaves:      function (p) { return handleAllLeaves(p); },      // admin list (pending + resolved)
  editLeave:      function (p) { return handleEditLeave(p); },      // admin-only
  cancelLeave:    function (p) { return handleCancelLeave(p); },    // admin-only
  // staff OT approval (in-place). Reads (myOT/teamPendingOT/pendingAdminOT/adminOTList) defer to engine.
  approveOT:      function (p) { return handleApproveOT(p); },
  confirmOT:      function (p) { return handleConfirmOT(p); },
  adminAddOT:     function (p) { return handleAdminAddOT(p); },
  adminAddHolidayOT: function (p) { return handleAdminAddHolidayOT(p); },
  adminEditOT:    function (p) { return handleAdminEditOT(p); },
  adminDeleteOT:  function (p) { return handleAdminDeleteOT(p); },
  // duty roster (กะเวร) — reads via engine (dutyList); writes in-place with LINE notify
  // class-management change requests (ย้ายครูประจำชั้น/แผนก): leader submits → admin approves (applies+logs)
  submitClassChange: function (p) { return handleSubmitClassChange(p); },
  decideClassChange: function (p) { return handleDecideClassChange(p); },   // admin-only, see ADMIN_ONLY
  // manual attendance-time request (ขอลงเวลา): 2-step (leader → admin); final approval writes CHECKIN_STAFF
  submitTimeRequest:  function (p) { return handleSubmitTimeRequest(p); },
  approveTimeRequest: function (p) { return handleApproveTimeRequest(p); },
  confirmTimeRequest: function (p) { return handleConfirmTimeRequest(p); },  // admin-only, see ADMIN_ONLY
  // announcements — in-place + unique AnnID + Priority (admin-only, see ADMIN_ONLY)
  addAnnouncement:    function (p) { return handleAddAnnouncement(p); },
  editAnnouncement:   function (p) { return handleEditAnnouncement(p); },
  deleteAnnouncement: function (p) { return handleDeleteAnnouncement(p); },
  reindexAnnouncements: function (p) { return handleReindexAnnouncements(p); },
  reindexParents:       function (p) { return handleReindexParents(p); },      // admin-only: fix duplicate ParentIDs
  checkDuplicateIds:    function ()  { return handleCheckDuplicateIds(); },     // admin-only: read-only id audit
  // DSPM criteria admin CRUD (in-place). List defers to engine (dspmAllCriteria).
  saveDspmCriteria:     function (p) { return handleSaveDspmCriteria(p); },
  deleteDspmCriteria:   function (p) { return handleDeleteDspmCriteria(p); },
  // admin student-leave CRUD (list defers to engine allStudentLeaves) + duplicate-data cleansing
  editStudentLeave:     function (p) { return handleEditStudentLeave(p); },
  deleteStudentLeave:   function (p) { return handleDeleteStudentLeave(p); },
  deleteStudentLeaves:  function (p) { return handleDeleteStudentLeaves(p); },   // batch, admin-only
  dedupData:            function (p) { return handleDedupData(p); },        // {preview:true} read-only; else applies
  lineDiag:             function (p) { return handleLineDiag(p); },          // admin-only: LINE push quota/token check
  // the four clocks this app reads the time from, side by side — and the button that aligns them
  tzDiag:               function ()  { return handleTzDiag(); },             // admin-only, read-only
  setTimezone:          function (p) { return handleSetTimezone(p); },       // admin-only, writes both workbooks
  /* Sessions are a GAS-only idea — the mock has no tokens — so this route has no engine twin to
   * drift out of step with. That is deliberate: three features shipped dead this week because an
   * engine copy was edited and the live route was not. */
  signOutEverywhere:    function (p) { return handleSignOutEverywhere(p); },  // self: anyone · a target: admin only
  authDiag:             function (p) { return handleAuthDiag(p); },          // admin-only: which record a sign-in lands on, and why
  lineUsage:            function (p) { return handleLineUsage(p); },         // what a month of notifications would cost, counted
  lineRecipients:       function (p) { return handleLineRecipients(p); },    // who gets a LINE push, about what
  saveLineRecipients:   function (p) { return handleSaveLineRecipients(p); },
  // notifications: the 🔔 bell now serves the in-app Admin inbox (cuts LINE admin pushes). Injury is an
  // emergency (always LINE + optional parent). reinstallTriggers refreshes the 10:00/20:00 digest schedule.
  notifications:        function (p) { return handleNotifications(p); },
  markNotifsRead:       function (p) { return handleMarkNotifsRead(p); },
  adminInbox:           function (p) { return handleAdminInbox(p); },
  markInboxRead:        function (p) { return handleMarkInboxRead(p); },
  submitInjury:         function (p) { return handleSubmitInjury(p); },
  // approving is the engine's decision; the wrapper exists to tell the teacher when it is SENT BACK
  approveInjury:        function (p) { return handleApproveInjury(p); },
  // new registrations run via the engine but also drop an in-app notice to Admin
  registerNew:          function (p) { return handleRegisterNew(p); },
  addChildNew:          function (p) { return handleAddChildNew(p); },
  reinstallTriggers:    function (p) { return handleReinstallTriggers(p); },   // admin-only
  // Big Cleaning Day (admin-managed workday, no fixed hours, diligence bonus)
  bigCleaningDays:  function ()  { return handleBigCleaningDays(); },
  addBigCleaning:   function (p) { return handleAddBigCleaning(p); },
  removeBigCleaning:function (p) { return handleRemoveBigCleaning(p); },
  // myLeaves intentionally NOT routed here — the explicit handler returned {staffId,leaves:[]}
  // (camelCase) but the client + engine use a raw-row array; let it fall through to the engine.
  pendingLeaves:  function (p) { return handlePendingLeaves(p); },
  parentCheckin:  function (p) { return handleParentCheckin(p); },
  studentAbsence: function (p) { return handleStudentAbsence(p); },
  // ...and the parent's own two, which are NOT the admin pair above: they refuse a past date and a
  // leave the school filed, and applyIdentity_ has already refused a child that is not theirs.
  parentEditLeave: function (p) { return handleParentEditLeave(p); },
  parentCancelLeave: function (p) { return handleParentCancelLeave(p); },
  teacherStudentLeave: function (p) { return handleTeacherStudentLeave(p); },   // teacher files student leave → notifies parents
  // Day 5 — Daily Journal (submit keeps the GAS handler for LINE notify; reads defer to the engine,
  // which returns null/[] gracefully instead of throwing NOT_FOUND when there is no journal yet)
  submitJournal:  function (p) { return handleSubmitJournal(p); },
  unlockJournal:  function (p) { return handleUnlockJournal(p); },   // admin-only, see ADMIN_ONLY
  saveParentComment: function (p) { return handleSaveParentComment(p); },   // parent comment (parentOwnsStudent_ gates)
  saveTeacherReply:  function (p) { return handleSaveTeacherReply(p); },     // teacher replies to a parent comment → notifies the parent
  // Day 5 — DSPM Assessment + analytics
  dspmCriteria:      function (p) { return handleDspmCriteria(p); },
  submitAssessment:  function (p) { return handleSubmitAssessment(p); },
  studentAssessment: function (p) { return handleStudentAssessment(p); },
  // classAssessment is deliberately NOT routed: it now falls through to the shared engine. The route
  // that used to sit here shadowed the engine and returned a different shape (no nickname, no
  // per-child "assessed" flag, no coverage, and no filtering of withdrawn/paused children), so every
  // improvement made in the engine was invisible on live. See handleClassAssessment in Dspm.gs.
  dspmManual:        function ()  { return handleDspmManual(); },
  // Payroll
  computePayroll: function (p) { return handleComputePayroll(p); },
  getPayslip:     function (p) { return handleGetPayslip(p); },
  // the months this teacher actually HAS a slip for — read-only, and applyIdentity_ pins staffId to
  // the caller, so it can only ever list their own
  myPayslipMonths: function (p) { return handleMyPayslipMonths(p); },
  markSalaryPaid: function (p) { return handleMarkSalaryPaid(p); },   // admin-only: salary transferred (+ slip)
  otCarryOver:    function (p) { return handleOtCarryOver(p); },      // OT approved after an earlier payroll was saved
  recomputeContributions: function (p) { return handleRecomputeContributions(p); },  // admin-only, preview-first
  // wipes ONE staff member's provident fund. Admin-only, preview-first, and it takes a full backup
  // of both workbooks before it writes a single cell — see handleContributionReset.
  contributionReset: function (p) { return handleContributionReset(p); },
  // more than one payslip for one person in one month — the fossils of the ym7_ bug documented at
  // the top of Payroll.gs. Read-only; it suggests a keeper and deletes nothing.
  payrollDuplicates: function (p) { return handlePayrollDuplicates(p); },
  deletePayrollRow:  function (p) { return handleDeletePayrollRow(p); },
  // Day 6 — PCHI insurance (fill-once) + SlipOK slip verification
  insuranceStatus:    function (p) { return handleInsuranceStatus(p); },
  // the whole PCHI sheet in its own column order, for the insurer — admin-only (it is every child's
  // national id, date of birth and bank account in one file)
  insuranceExport:    function ()  { return handleInsuranceExport(); },
  submitInsurance:    function (p) { return handleSubmitInsurance(p); },
  insuranceList:      function ()  { return handleInsuranceList(); },
  saveInsuranceAdmin: function (p) { return handleSaveInsuranceAdmin(p); },
  verifySlip:         function (p) { return handleVerifySlip(p); },
  // seedMock route REMOVED for go-live (PDPA): the test-seed endpoint is disabled. SeedMock.gs
  // is kept in the project so it can be re-enabled for dev by re-adding this route.
  // import/bind/addUser/setConfig routes REMOVED after go-live (they wipe data / grant admin and
  // had no role-check). Import.gs is kept; re-add a route here temporarily if another import is needed.
  // (temp go-live/recovery tooling routes removed; re-add from Import.gs if another run is needed)
  // run many actions in one round-trip (sharing one hydrated M) — front-end micro-batches screen loads
  batch:              function (p) { return handleBatch(p); }
};

function doGet(e) {
  try {
    // HTML views (printable). e.g. ?view=slips&month=YYYY-MM
    var view = e && e.parameter && e.parameter.view;
    if (view === 'slips') return serveSlips_(e);

    // Health check + optional ?action= for read-only calls / quick testing.
    var action = e && e.parameter && e.parameter.action;
    if (!action) {
      // NOT ok:true. This used to answer "the service is up" as if it were a successful reply, and
      // an app POST whose body was lost in transit arrives here — as an action-less GET. The client
      // then treated {service,status,time} as the data it had asked for and the screen crashed on
      // "x.map is not a function". Answering ok:false makes a lost request look like what it is:
      // a failure the client can retry, never data. The JSON body still proves the service is up.
      return jsonOut_({ ok: false, a: 'health', error: { code: 'NO_ACTION',
        service: 'Atom Nursery API', status: 'up', time: new Date().toISOString(),
        message: 'Atom Nursery API พร้อมใช้งาน — คำขอนี้ไม่มี action (คำขออาจสูญหายระหว่างทาง กรุณาลองใหม่)' } });
    }
    return dispatch_(action, e.parameter || {}, (e.parameter || {}).token);
  } catch (fatal) {
    try { Logger.log('doGet fatal: ' + (fatal && fatal.stack || fatal)); } catch (x) {}
    return jsonOut_({ ok: false, error: { code: 'INTERNAL', message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' } });
  }
}

/**
 * EVERY path out of here must be JSON. If an exception escapes, Apps Script replies with its own
 * HTML error page, the client's r.json() dies on "<!DOCTYPE", and the user is told
 * "Unexpected token '<'" — which says nothing and, on the login screen, looks like the app is
 * broken. That is exactly what happened: dispatch_ ran verifySession_ OUTSIDE its try, so a bad
 * stored token could take the whole request down. Catch everything, always answer JSON.
 */
function doPost(e) {
  try {
    var body = {};
    try {
      if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonOut_({ ok: false, error: { code: 'BAD_JSON', message: 'ส่ง JSON ไม่ถูกต้อง' } });
    }
    return dispatch_(body.action, body.payload || {}, body.token);
  } catch (fatal) {
    try { Logger.log('doPost fatal: ' + (fatal && fatal.stack || fatal)); } catch (x) {}
    return jsonOut_({ ok: false, error: { code: 'INTERNAL',
      message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' + (fatal && fatal.message ? (' (' + fatal.message + ')') : '') } });
  }
}

// ---- session enforcement (gated by SCHOOL_CONFIG RequireSessionToken='true') ----
function sessionRequired_() { try { return String(getConfig_('RequireSessionToken', '')) === 'true'; } catch (e) { return false; } }
// perfLog is public because the most valuable telemetry comes from a session that never happened
// (sign-in failing, the shell erroring before auth). It can only write to the isolated PERF_LOG
// sheet and every field is whitelisted + sanitised in Perf.gs. READING it back is admin-only.
/* lineLoginReady/lineExchange are public for the same reason `auth` is: they ARE the sign-in. One
 * says whether the browser-only route is configured (a boolean and a public channel id, never the
 * secret); the other turns an authorization code into the very session this gate would ask for. */
/* googleLoginReady/googleExchange are public for the same reason, and for the same length of time:
 * they run BEFORE there is a session, because producing one is what they do. googleLink is NOT here
 * — it is the opposite action, only ever performed by somebody already signed in, and its whole
 * safety comes from the session deciding whose row is written. */
function publicAction_(a) { return a === 'ping' || a === 'auth' || a === 'perfLog'
  || a === 'lineLoginReady' || a === 'lineExchange'
  || a === 'googleLoginReady' || a === 'googleExchange'; }
/** Ride a renewed session token back on a normal reply, so an active user is never signed out. */
function withRenewal_(env, sess) {
  try { var t = renewSession_(sess); if (t) env.token = t; } catch (e) {}
  return env;
}
/** Inject the caller's trusted identity (from the verified token) into the payload and
 *  block parents from reading a student that isn't theirs. No-op while dormant. */
function applyIdentity_(action, payload, sess) {
  payload = payload || {};
  if (!sessionRequired_() || publicAction_(action)) return payload;       // dormant → current behavior
  if (!sess) throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)');
  if (sess.role === 'guest') {                                            // unregistered LINE user: onboarding only
    var ONBOARD = { registerParent: 1, addChildNew: 1, linkExisting: 1, registerNew: 1, claimParent: 1 };
    if (!ONBOARD[action]) throw apiError_('NEEDS_REGISTRATION', 'กรุณาลงทะเบียนก่อนใช้งาน');
    payload.uid = sess.uid;                                               // link records to the verified LINE id
    return payload;
  }
  // Admin-only destructive/sensitive actions — block non-admins (parent/teacher tokens).
  var ADMIN_ONLY = { deleteBill: 1, adminResetPassword: 1, getStaffPassword: 1, setSchoolConfig: 1, recomputeAttendance: 1, diagDay: 1,
    addDepartment: 1, removeDepartment: 1, renameDepartment: 1, listBackups: 1, restoreSheet: 1, setRequireCheckin: 1,
    adminUpdateOT: 1, adminCancelOT: 1, adminRestoreOT: 1, unlockJournal: 1,
    confirmOT: 1, adminAddOT: 1, adminAddHolidayOT: 1, adminEditOT: 1, adminDeleteOT: 1,
    addBigCleaning: 1, removeBigCleaning: 1, editLeave: 1, cancelLeave: 1,
    // holidayAttendSet REPLACES the whole day's list — admin only. Adding ONE name (holidayAttendAdd)
    // is deliberately not here: a teacher standing in front of a family who turned up must be able
    // to do it, and the engine records who did.
    holidayAttendSet: 1,
    decideClassChange: 1, confirmTimeRequest: 1,
    addAnnouncement: 1, editAnnouncement: 1, deleteAnnouncement: 1, reindexAnnouncements: 1, reindexParents: 1, checkDuplicateIds: 1,
    saveDspmCriteria: 1, deleteDspmCriteria: 1,
    // injury: unlocking a finished report and deleting one are the admin's alone. approveInjury and
    // editInjury are NOT here — a หัวหน้าครู takes the first step and the teacher who filed it may
    // still correct it, and this list cannot see either of those rules. The engine checks them.
    unlockInjury: 1, deleteInjury: 1,
    editStudentLeave: 1, deleteStudentLeave: 1, deleteStudentLeaves: 1, dedupData: 1, lineDiag: 1,
    // tzDiag reads nothing personal, but setTimezone rewrites how every date in both workbooks is
    // interpreted — the pair belongs to the admin, and they are listed together so neither drifts out
    tzDiag: 1, setTimezone: 1,
    // hands back LINE ids and email addresses for the whole school — admin only, and read-only
    authDiag: 1,
    // who the school messages, and what it costs — both admin-only: the list carries LINE user ids
    lineUsage: 1, lineRecipients: 1, saveLineRecipients: 1,
    adminInbox: 1, markInboxRead: 1, reinstallTriggers: 1, unlinkStudent: 1, linkParentAdmin: 1, setLeaveQuota: 1, setConfigVal: 1, markSalaryPaid: 1, notifyBills: 1, issueBillsFor: 1, savePlans: 1, saveQRCodes: 1, prepayAudit: 1, recomputeContributions: 1, contributionReset: 1, payrollDuplicates: 1, deletePayrollRow: 1, savePrepayTiers: 1, editPrepay: 1, setStudentPause: 1, setStudentEnd: 1, endingStudents: 1, setStaffEnd: 1, setStaffPause: 1, staffAttendanceMonth: 1, studentMonthReport: 1, recordCashPayment: 1, pausedStudents: 1, deleteSlip: 1, slipDiag: 1, saveSlipOk: 1, cancelPrepay: 1, perfSummary: 1, deletePerfLog: 1, prepaidStudents: 1, insuranceExport: 1,
    /* CERTIFICATES — admin only, all five.
     * certStudents names every child who has finished, including those long gone, and certAssets
     * hands back the director's signature. Neither is anything a teacher or a parent has business
     * fetching, and the signature in particular is the one image in this system a person could
     * misuse. See src/Certificate.gs. */
    certStudents: 1, certText: 1, saveCertText: 1, certAssets: 1, saveCertAsset: 1, markCertIssued: 1,
    // the whole roster grouped by billing day, with each child's bill state — the same class of answer
    // as prepaidStudents, and money besides
    billingGroups: 1,
    // creates a STUDENT record outright. The parent-facing registerNew/addChildNew are ONBOARDING
    // actions any signed-in family may call for themselves; this one writes a child nobody has
    // claimed, so it belongs to the admin alone.
    addStudentByAdmin: 1,
    /* absenceFollowupLog is deliberately NOT here. It is the teacher's own work — they write these
     * rows and must be able to read back who has already rung a family before ringing them again,
     * which is the entire reason the trail exists. It scopes itself by staffId to the classes that
     * teacher covers (the same rule as absenceReport); a head teacher, Leader and Admin get the lot. */
    // Phase 7. The engine handlers already check the caller's role; listing them here as well means a
    // bug in one of those checks still cannot expose survey results or let anyone rewrite the menu.
    // saveFoodMenu is deliberately NOT here: it is the one action an admin can DELEGATE to a
    // teacher (CanFoodMenu), and this list cannot see that flag — it would refuse the very teacher
    // the admin just put in charge. The engine's canFoodMenu_ is the gate, and it is the same rule
    // that decides whether the button appears at all.
    deleteFoodItem: 1, seedFoodItems: 1, surveys: 1, saveSurvey: 1, setSurveyStatus: 1, deleteSurvey: 1, surveyResults: 1, surveySummary: 1,
    parentKidsMap: 1 };  // every parent's children by name — admin-only (PII)
  // Observer reads these too — the role exists to see the whole school. It cannot write: dispatch_
  // has already refused every mutating action for it before this runs.
  if (ADMIN_ONLY[action] && sess.role !== 'Admin' && sess.role !== ROLES.OBSERVER) throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  /* googleLink is ALWAYS about the caller themselves — that is the entire safety of it. Nobody types
   * an address, so nobody mistypes one onto another family. An Admin session returns below with the
   * payload untouched, which would leave this one action with no identity at all and refuse the
   * admin their own link, so it is stamped here for every role including Admin. */
  /* authDiag asked with nothing means "which record am I on?", so it needs the uid the session was
   * actually resolved by — never one typed in, which is how a day was lost checking the wrong id.
   * Stamped for every role including Admin, who returns below with the payload untouched. */
  if (action === 'authDiag') { payload.__me = sess.uid; return payload; }
  /* SIGNING OUT EVERY DEVICE is two actions sharing a name, and the difference is who may ask — so
   * it takes neither the ADMIN_ONLY route (that would refuse a parent their own button) nor the
   * ordinary stamping below (that would put a parentId on a request that means "myself", making
   * every self sign-out look like an admin targeting someone). The caller's uid and real role go
   * across untouched and handleSignOutEverywhere decides. Everything the client sent about WHO is
   * left in place on purpose: a non-Admin naming a target is refused there, not ignored here. */
  if (action === 'signOutEverywhere') { payload.__me = sess.uid; payload.__role = sess.role; return payload; }
  if (action === 'googleLink') {
    /* The UID, not a role-derived id. handleGoogleLink finds the row the way handleAuth does, so the
     * link always lands on the record a LINE sign-in resolves to — including an Admin-provisioned
     * USERS row, which is neither a parentId nor a staffId. Everything the client sent is thrown
     * away first: this action is only ever about the caller. */
    delete payload.parentId; delete payload.staffId;
    payload.uid = sess.uid;
    return payload;
  }
  // Admin is fully trusted: may target ANY staff/student/parent (manage everyone + "view as" any role).
  // Observer is shaped the same way so it can OPEN any record; it simply cannot change one.
  if (sess.role === 'Admin' || sess.role === ROLES.OBSERVER) return payload;
  payload.uid = sess.uid; payload.role = sess.role;                       // overwrite — never trust client identity
  if (sess.role === ROLES.PARENT) {
    payload.parentId = sess.linkedId;
    // A parent has no staffId at all. Leaving whatever they sent in place let a crafted request carry
    // an Admin's StaffID into any handler that decides permission with staffById(p.staffId) — e.g. the
    // one-off advance-payment rate. Clear it, so a parent can never be mistaken for staff.
    delete payload.staffId;
    if (payload.studentId && !parentOwnsStudent_(sess.uid, payload.studentId)) throw apiError_('NO_ACCESS', 'ไม่มีสิทธิ์เข้าถึงข้อมูลนักเรียนนี้');
  } else {
    payload.staffId = sess.linkedId;                                      // teacher/leader act only as themselves
    /* THE LAST WORKING DAY HAS PASSED — CHECKED ON EVERY REQUEST, not just at the door.
     *
     * v315 refused them in handleAuth and that was the WRONG DOOR: a session token lasts 12 hours
     * and renews itself on use, so somebody already signed in never passes through login again.
     * Reported the same day — a teacher whose last day was yesterday was still on her home screen
     * with the clock-in buttons live.
     *
     * Here instead, which is the one place every non-admin request goes through and where the
     * caller's real identity is already established. It covers check-in, journals, class lists and
     * anything written next, without each of them having to remember.
     *
     * EndDate is a LAST WORKING DAY, so this bites only once it has passed. An ADMIN session never
     * reaches this line (it returned above), so "view as" still works and an admin can still open,
     * correct and close the record of somebody who has left.
     */
    var _me = staffRowById_(sess.linkedId);
    var _end = _me ? String(_me.EndDate || '').slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(_end) && dateStr_(new Date()) > _end) {
      throw apiError_('ENDED', 'สิ้นสุดการทำงานเมื่อ ' + _end + ' — เข้าใช้งานระบบไม่ได้แล้ว · หากกลับเข้าทำงาน กรุณาแจ้งแอดมิน');
    }
    /* THE FIRST WORKING DAY HAS NOT ARRIVED — the mirror of the block above, and it was missing.
     *
     * Reported 2026-09-15 with a screenshot: a teacher whose StartDate is the 21st, signed in on
     * the 15th, looking at "การมาเรียนวันนี้" — three children's nicknames, their check-in times,
     * and the names of three more on leave. Under it: ยื่น/ดูใบลา, ติดตามการขาดเรียน, OT นักเรียน
     * (ติดตามชำระ). Somebody who does not work here yet could read the roll and chase a family for
     * money.
     *
     * Only assertStaffStarted_ existed, and it guards the two clock-in routes. Everything else was
     * open, which is precisely the v315 mistake made the other way round: a rule enforced at one
     * door instead of at the one place every request passes.
     *
     * Asked for as "ไม่ควรเปิดฟังก์ชันใดๆในการทำงาน … ควรจะเปิดระบบในวันที่ระบบระบุวันเริ่มงานเท่านั้น",
     * so the allow-list below is deliberately narrow: it is what somebody needs to SET THEMSELVES UP
     * before day one, and nothing about the school's children, money or timekeeping.
     *
     * Blank StartDate means nobody set one — that must stay open, or a school that leaves the field
     * empty locks its whole staff out.
     */
    var _start = _me ? String(_me.StartDate || '').slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(_start) && dateStr_(new Date()) < _start && !NOT_STARTED_OK_[action]) {
      throw apiError_('NOT_STARTED', 'วันแรกของการทำงานคือ ' + _start + ' — ระบบจะเปิดให้ใช้งานในวันนั้น');
    }
    /* ...AND THE THIRD WAY OF NOT BEING AT WORK, which had no gate at all.
     *
     * Reported 2026-09-22 with a screenshot: ครู Esther, ลาชั่วคราว 22/09–01/12 recorded by the
     * Admin, opening the app on the 22nd with เข้างาน / เลิกงาน live, her class roll on screen, and
     * every button working exactly as before.
     *
     * staffPaused_ EXISTED and was correct — the monthly report, the dashboard and payroll all ask
     * it. What nobody asked it was "may this person use the app today". So a pause was a fact the
     * reports knew and the door did not: the same mistake as the missing NOT_STARTED block above,
     * made a third time, and the reason all three now sit together in this one function rather than
     * being scattered across the handlers that happen to remember.
     *
     * PauseTo is the day they COME BACK (staffPaused_ in webapp/engine.js says so, and the student
     * rule matches), so the test is `< to` and the return date itself is a working day. A pause with
     * no end runs until the Admin clears it.
     *
     * NOT Status='INACTIVE' and deliberately: somebody on maternity leave is still employed, and
     * flipping Status would tell payroll they had left. The dates are the fact; this reads them.
     */
    var _pFrom = _me ? String(_me.PauseFrom || '').slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(_pFrom) && !PAUSED_OK_[action]) {
      var _pTo = _me ? String(_me.PauseTo || '').slice(0, 10) : '';
      var _now = dateStr_(new Date());
      var _onPause = _now >= _pFrom && !(/^\d{4}-\d{2}-\d{2}$/.test(_pTo) && _now >= _pTo);
      if (_onPause) {
        throw apiError_('PAUSED', 'อยู่ระหว่างลาชั่วคราว' +
          (/^\d{4}-\d{2}-\d{2}$/.test(_pTo) ? ' ถึง ' + _pTo + ' — ระบบจะเปิดให้ใช้งานอีกครั้งในวันนั้น'
                                            : ' ตั้งแต่ ' + _pFrom + ' — กรุณาติดต่อแอดมินเมื่อกลับมาทำงาน'));
      }
    }
  }
  return payload;
}
/**
 * The only things a member of staff may do before their first working day.
 *
 * Read it as "my own account", not "my job". Nothing here returns a child's name, an amount of
 * money, or anything about attendance — the point of the rule is that the job starts on the date the
 * school set, and not a day earlier.
 *
 *   staffSelf / myAttendanceToday  the two the app needs to find out it is in this state at all,
 *                                  and to draw the "your first day is …" card. myAttendanceToday
 *                                  already answers { notStarted, startDate } and nothing else when
 *                                  the day has not come.
 *   saveStaffSelf                  fill in your own profile, photo and qualifications beforehand
 *   *Password / requestPasswordReset  the forced first-login password change has to work
 *   notifications / markNotifsRead  the bell is in the header of every screen; refusing it would
 *                                  put an error on a screen whose whole job is to say "not yet"
 *   schoolDay                       the calendar. Public information, and shared header code asks
 *                                  for it — allowed so the wait screen renders cleanly
 *
 * NOT listed and deliberately so: googleLink and signOutEverywhere return from applyIdentity_ before
 * this check is reached, because both are about the caller's own session and neither can touch
 * school data.
 */
var NOT_STARTED_OK_ = {
  staffSelf: 1, myAttendanceToday: 1, saveStaffSelf: 1,
  changeStaffPassword: 1, checkStaffPassword: 1, requestPasswordReset: 1,
  notifications: 1, markNotifsRead: 1, schoolDay: 1
};
/**
 * ...and the same list for somebody on temporary leave. Same shape, same reasoning, kept SEPARATE
 * on purpose: the two states look alike but are not the same person.
 *
 * Somebody who has not started yet has never worked here, so they get only what they need to set
 * themselves up. Somebody on ลาชั่วคราว has a history — a payslip from last month, leave they filed,
 * their own attendance record — and taking that away while they are off would be punishing them for
 * being on leave. So their OWN past is readable and nothing about today is.
 *
 * What is NOT here is everything about the school's children, its money, and its timekeeping:
 * no roll, no journal, no check-in, no approvals. `staffCheckin` and `staffCheckout` are absent
 * precisely because the screenshot that reported this had both buttons live.
 */
var PAUSED_OK_ = {
  staffSelf: 1, myAttendanceToday: 1, saveStaffSelf: 1,
  changeStaffPassword: 1, checkStaffPassword: 1, requestPasswordReset: 1,
  notifications: 1, markNotifsRead: 1, schoolDay: 1,
  // their own record, which exists and is theirs — unlike somebody who has not started
  /* ...their own record, which exists and is theirs — unlike somebody who has not started. These are
   * exactly what the three screens PAUSED_SCREENS lets through actually fetch, checked call by call
   * against each screen rather than guessed:
   *   slip      myOT · myPayslipMonths · otCarryOver
   *   leave     leaveQuota · staffSelf · myLeaves · myTimeRequests
   *   schedule  schedule · myAttendanceMonth · myLeaves · myOT
   * A list short of any one of them leaves a screen the app offers and the server refuses, which is
   * the fault this whole allow-list exists to avoid.
   *
   * The leave screen ALSO fires teamPendingLeaves, teamPendingTimeRequests and pendingInjuries.
   * Those are deliberately absent: they are other people's work, waiting for an approval somebody on
   * leave should not be giving. All three already .catch(()=>[]) on the client, so they come back
   * empty instead of breaking the screen — which is the correct answer for somebody who is away. */
  myLeaves: 1, myAttendanceMonth: 1, myPayslipMonths: 1, getPayslip: 1,
  myOT: 1, otCarryOver: 1, leaveQuota: 1, myTimeRequests: 1, schedule: 1
};

/** One staff row by id, for the identity checks above. Reads go through the cached row store. */
function staffRowById_(staffId) {
  if (!staffId) return null;
  try {
    return findObject_(sheet_(getHrSpreadsheet_(), 'STAFF'),
      function (s) { return String(s.StaffID) === String(staffId); });
  } catch (e) { return null; }    // never let a lookup failure lock the whole school out
}
function parentOwnsStudent_(uid, sid) {
  var links = sheet_(getMainSpreadsheet_(), 'USER_LINKS');
  if (findObject_(links, function (l) { return String(l.UserUID) === String(uid) && String(l.StudentID) === String(sid); })) return true;
  var parents = sheet_(getMainSpreadsheet_(), 'PARENTS');                 // legacy ParentID linkage
  return !!findObject_(parents, function (pr) { return String(pr.LineUID) === String(uid) && String(pr.StudentID) === String(sid); });
}

/** Look up and run a route, converting thrown apiError_ into the envelope. */
function dispatch_(action, payload, token) {
  // Explicit ROUTES win; anything else falls through to the shared engine (Engine.gs via GasEngine.gs)
  // so all ~116 handlers work without re-implementation. Set ENGINE_FALLBACK=false to disable.
  var ENGINE_FALLBACK = true;
  var handler = ROUTES[action];
  if (!handler && ENGINE_FALLBACK && typeof engineDispatch_ === 'function') {
    handler = function (p) { return engineDispatch_(action, p); };
  }
  /**
   * Every reply says WHICH QUESTION it answers.
   *
   * A POST whose body is lost in transit reaches the web app as an action-less GET, and doGet
   * answered that with the health check — ok:true, data {service,status,time}. The client had no way
   * to tell that apart from a real answer, so it handed the health check to the screen, and the
   * screen died on "x.map is not a function". That is the crash we chased from v186 to the
   * batchShape rows in the 2026-08-11 report, which finally named the shape.
   * With the action echoed back, an answer to a DIFFERENT question is recognised and asked again.
   */
  function reply_(o) { o.a = action; return jsonOut_(o); }
  if (!handler) {
    return reply_({ ok: false, error: { code: 'UNKNOWN_ACTION', message: 'ไม่รู้จัก action: ' + action } });
  }
  // A stored token that is corrupt (or a hiccup reading the signing secret) must never take the
  // request down — it used to throw out here, outside the try, and the caller got an HTML error page.
  var sess = null;
  try { sess = verifySession_(token); } catch (se) { sess = null; }
  /* A BATCH IS A TRANSPORT, NOT AN ACTION.
   *
   * `batch` is not in publicAction_, so a batch sent before a session existed was refused whole —
   * even when every call inside it was public. The client micro-batches everything issued in one
   * tick, and the sign-in screen issues exactly two things in one tick: "is the LINE browser route
   * configured" and "is Google configured". Both public, both about the sign-in screen, both asked
   * when by definition there is no session yet.
   *
   * The 07–09/09 report priced it: lineLoginReady failing 27% and googleLoginReady 49%, all
   * NO_SESSION. That is why the fallback buttons so often were not there — the whole saga of "the
   * Google button does not appear" had this underneath it.
   *
   * A batch is allowed through only when EVERY call in it is public; one private passenger and it is
   * refused exactly as before. handleBatch then applies identity per call, so nothing else changes.
   */
  var allPublic = (action === 'batch') && (function () {
    var cs = (payload && payload.calls) || [];
    if (!cs.length) return false;
    for (var i = 0; i < cs.length; i++) { if (!publicAction_(cs[i] && cs[i].action)) return false; }
    return true;
  })();
  if (sessionRequired_() && !publicAction_(action) && !allPublic && !sess) {
    return reply_({ ok: false, error: { code: 'NO_SESSION', message: 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)' } });
  }
  try {
    // Serialize anything that can WRITE. A request hydrates sheets then persists them, so two
    // concurrent writers could interleave (one reading a half-written sheet) — the cause of the
    // 2026-07-09 student wipe. Pure reads stay lock-free so the app remains fast.
    var mutates = (action === 'batch')
      ? ((payload && payload.calls) || []).some(function (c) { return isMutatingAction_(c.action); })
      : isMutatingAction_(action);
    // Observer is read-only. Checked HERE, against the verified session, because it is the one place
    // every request passes through — hiding buttons would leave the rule dependent on the screen a
    // person happens to be on, and on the app being the only way in.
    /* AN OBSERVER MAY STILL CLOSE THEIR OWN SESSIONS. The read-only rule is about the school's
     * records — it was never meant to say "you may not sign your own lost phone out", which is the
     * one write that protects the very data the role is restricted to reading. It cannot touch
     * anyone else: naming a target is refused for every role but Admin, inside the handler. */
    var ownSessionWrite = (action === 'signOutEverywhere');
    if (mutates && !ownSessionWrite && sess && String(sess.role) === 'Observer') {
      // A single action is refused outright. A BATCH is refused call by call in handleBatch, because
      // refusing the whole thing also took down the reads travelling with it — one flagged call and
      // an Observer's home screen failed entirely (READ_ONLY on notifications, 2026-08-11 report).
      if (action !== 'batch') {
        return reply_({ ok: false, error: { code: 'READ_ONLY', message: OBSERVER_READ_ONLY_MSG_ } });
      }
      mutates = false;   // nothing in this batch will be allowed to write, so it needs no write lock
    }
    return withWriteLock_(mutates, function () {
      if (action === 'batch') { (payload = payload || {}).__sess = sess; return reply_(withRenewal_({ ok: true, data: handler(payload) }, sess)); }
      // perfLog records WHICH ROLE was affected. That must come from the verified session, never
      // from the client — otherwise the one report we use to make decisions is trivially poisoned.
      // No session is itself the signal we want (a user who could not sign in), recorded as 'anon'.
      if (action === 'perfLog') { (payload = payload || {}).__sess = sess; return reply_({ ok: true, data: handler(payload) }); }
      payload = applyIdentity_(action, payload, sess);
      return reply_(withRenewal_({ ok: true, data: handler(payload) }, sess));
    });
  } catch (err) {
    var code = (err && err.apiCode) ? err.apiCode : 'INTERNAL';
    var msg = (err && err.message) ? err.message : String(err);
    if (code === 'INTERNAL') Logger.log('Unhandled error in ' + action + ': ' + (err && err.stack || err));
    return reply_({ ok: false, error: { code: code, message: msg } });
  }
}

var OBSERVER_READ_ONLY_MSG_ = 'บัญชีนี้เป็นสิทธิ์ดูอย่างเดียว (Observer) — ดูข้อมูลได้ทุกหน้า แต่แก้ไขไม่ได้';
/** Does this action write anything? (mirrors the client's MUT regex in api.js) */
var MUTATING_RE = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i;
/**
 * Reads whose NAME looks like a write. pay*, check*in, absence* — every one of these only filters
 * and maps; none touches a sheet (verified handler by handler in webapp/engine.js).
 *
 * The client has had this exact list since v198. The server did not, and the disagreement cost real
 * users twice over:
 *   - an Observer opening the home screen was refused outright, because payrollReminderDue counted
 *     as a write and ONE flagged call refuses the WHOLE batch it travelled in;
 *   - these reads queued behind the write lock for no reason, which is where the BUSY failures on
 *     studentCheckinHistory / studentLeaves / getPlans came from.
 * Keep it identical to READ_ONLY in webapp/api.js — tools/test_readonly_sync.js fails if it drifts.
 */
var READ_ONLY_ACTIONS_ = { absenceReport: 1, paymentLog: 1, paymentSlips: 1, payments: 1, payrollConfig: 1,
  payrollReminderDue: 1, prepayTiers: 1, prepayments: 1, staffCheckinLog: 1, studentCheckinHistory: 1,
  // starts with "prepay", so the verb test calls it a write. It only asks which children have
  // already paid for a month; see the note in webapp/api.js READ_ONLY.
  prepaidStudents: 1,
  // "staffMissingCheckout" contains the word "Checkout", so the verb test calls it a write. It only
  // reads the month and reports the days nobody closed — and an unlisted "write" on a teacher's home
  // screen is refused for an Observer and takes the whole batch down with it, which is what these
  // ten are here to prevent.
  staffMissingCheckout: 1 };
/**
 * WRITES whose name does not start with a mutating verb — the mirror of the list above, and the
 * dangerous half. Found by running this very classifier over all 124 routes while fixing the
 * read side, then reading each handler: every one of these calls updateRow_, appendObject_ or
 * deleteRow. adminDeleteOT deletes a row by INDEX, which is exactly the row-shift hazard the
 * write lock exists for (see dedupData below and the 2026-07-09 wipe).
 * Their absence also meant the CLIENT never cleared its read cache after one, so an admin who
 * recorded a cash payment kept seeing the bill as unpaid.
 * Keep identical to WRITES in webapp/api.js — tools/test_lost_reply.js fails if it drifts.
 */
var WRITES_ACTIONS_ = { recordCashPayment: 1, teacherStudentLeave: 1, unlockJournal: 1, unlockInjury: 1,
  commentAssessment: 1,   // writes a note onto an assessment row; "comment" is not a mutating verb
  // A parent correcting or withdrawing their own leave. Both start with "parent", so MUTATING_RE —
  // which is anchored — treats them as reads. That means no write lock on the server and no cache
  // clear on the client, so a family would delete a leave and go on being shown it.
  parentEditLeave: 1, parentCancelLeave: 1,
  // Lending a teacher to another class for a few days. Neither name starts with a mutating verb —
  // "class…" is not in MUTATING_RE — so both would run without the write lock and leave the caller
  // looking at their own stale copy of the cover list.
  classCoverAdd: 1, classCoverRemove: 1,

  adminResetPassword: 1, adminUpdateOT: 1, adminCancelOT: 1, adminRestoreOT: 1,
  adminAddOT: 1, adminAddHolidayOT: 1, adminEditOT: 1, adminDeleteOT: 1, decideClassChange: 1, reinstallTriggers: 1,
  // who is expected on a closed day. None of the three starts with a mutating verb, and all three
  // decide whether a child may be checked in that day — a read lock on any of them is a wrong answer
  // waiting to happen.
  holidayAttendSet: 1, holidayAttendAdd: 1, holidayAttendRemove: 1,
  /* AN AUTHORIZATION CODE CAN ONLY BE SPENT ONCE. Nothing about the name says "write", so it would
   * have counted as retry-safe — and a reply lost on the way back would be retried with a code LINE
   * has already burned, turning a completed sign-in into "เข้าสู่ระบบไม่สำเร็จ". */
  lineExchange: 1,
  // both write a row: googleExchange remembers the permanent account id the first time an email is
  // recognised, and googleLink is the link itself
  googleExchange: 1, googleLink: 1,
  /* Ends every session an account holds, by writing the cut-off instant to SCHOOL_CONFIG. "sign…" is
   * not a mutating verb, so without this it would run with no write lock — and a lost phone is
   * exactly the moment the revoke must not be the one write that interleaves with another. */
  signOutEverywhere: 1 };
/**
 * A holiday write, plus the tidy-up it makes necessary.
 *
 * The engine still does the work — this only asks, afterwards, whether the day that changed is TODAY,
 * and if so rewrites today's late minutes from the day's real hours. A holiday added at noon must not
 * leave the morning's check-ins measured against hours that no longer exist.
 *
 * The repair must never take the write down with it: the holiday IS saved, and a failure to
 * recalculate is a number that can be fixed with the button in Settings, not a reason to tell the
 * admin their holiday did not save.
 */
function holidayWrite_(action, p) {
  var res = engineDispatch_(action, p);
  try {
    var today = dateStr_(new Date());
    var dates = [String((p && p.date) || ''), String((p && p.newDate) || ''), String((res && res.date) || '')];
    var touchesToday = dates.some(function (d) { return d.slice(0, 10) === today; });
    if (touchesToday) {
      var fixed = handleRecomputeAttendance({});
      res = res || {};
      res.recomputed = (fixed && fixed.fixed) ? fixed.fixed.length : 0;
    }
  } catch (e) { try { Logger.log('holidayWrite_ recompute failed: ' + (e && e.stack || e)); } catch (x) {} }
  return res;
}
/**
 * A back-dated attendance correction, and the people it has to reach.
 *
 * If the correction raises a late-pickup charge, the family must be told the same way a live
 * check-out tells them — with the DAY named, because a charge for last Tuesday arriving on Friday
 * with no explanation is how a school loses an argument it should never have had. The admin inbox
 * gets it too, so finance is not the last to know.
 *
 * Notification never breaks the correction: the times ARE saved, and a failed LINE push is a message
 * that did not arrive, not a reason to tell the teacher their correction failed.
 */
function editAttendanceWrite_(p) {
  var res = engineDispatch_('editStudentAttendance', p);
  try {
    var ot = res && res.ot;
    if (!ot || !(Number(ot.amount) > 0)) return res;
    var date = String((res && res.date) || (p && p.date) || '');
    var st = findObject_(sheet_(getMainSpreadsheet_(), 'STUDENTS'),
      function (s) { return String(s.StudentID) === String(res.studentId); }) || {};
    var who = st.Nickname || st.Name || st.NameTH || res.studentId;
    var msg = '⏰ ค่าล่วงเวลา (รับช้า) ย้อนหลัง\n' +
      '👶 ' + who + ' · วันที่ ' + date + '\n' +
      'เวลารับกลับที่บันทึก ' + (res.checkOut || '-') + ' · เลิกเรียน ' + (ot.planEnd || '-') + '\n' +
      'รับช้า ' + ot.lateMinutes + ' นาที · ค่าล่วงเวลา ' + (ot.net != null ? ot.net : ot.amount) + ' บาท (รวมในบิลรายเดือน)\n' +
      'หมายเหตุ: รายการนี้เกิดจากการแก้ไขเวลารับ-ส่งของวันดังกล่าว';
    try {
      var parent = st.ParentID ? findObject_(sheet_(getMainSpreadsheet_(), 'PARENTS'),
        function (pr) { return String(pr.ParentID) === String(st.ParentID); }) : null;
      if (parent && parent.LineUID && typeof linePushText_ === 'function') linePushText_(parent.LineUID, msg);
    } catch (e) {}
    try { if (typeof notifyAdmins_ === 'function') notifyAdmins_(msg); } catch (e) {}
  } catch (e) { try { Logger.log('editAttendanceWrite_ notify failed: ' + (e && e.stack || e)); } catch (x) {} }
  return res;
}
// dedupData/reindex* mutate but don't start with a MUTATING_RE verb — force them to take the write lock
// (they read row indices then delete, so a concurrent append would shift rows and delete the wrong one).
function isMutatingAction_(a) { a = String(a || '');
  if (READ_ONLY_ACTIONS_[a]) return false;
  if (WRITES_ACTIONS_[a]) return true;
  return MUTATING_RE.test(a) || /check(in|out)|absence|^dedup|^reindex|payOT$|^orgMove|^unlink|^claim|^recompute/i.test(a); }

/** Run fn under a script lock when it may write. Reads run unlocked (no queueing). */
function withWriteLock_(needed, fn) {
  if (!needed || typeof LockService === 'undefined') return fn();   // no LockService in the test harness
  var lock;
  try { lock = LockService.getScriptLock(); } catch (e) { return fn(); }
  if (!lock.tryLock(25000)) throw apiError_('BUSY', 'ระบบกำลังบันทึกข้อมูลอยู่ กรุณาลองใหม่อีกครั้ง');
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

/** Build a typed error that dispatch_ maps to { code, message }. */
function apiError_(code, message) {
  var e = new Error(message);
  e.apiCode = code;
  return e;
}

/** Serialize any object to a JSON ContentService response. */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Editor-run smoke tests (no HTTP needed) ----------------------
/** Run from the editor after setupAll() to sanity-check the router. */
function testApi() {
  Logger.log('ping  -> ' + dispatch_('ping', {}).getContent());
  Logger.log('bad   -> ' + dispatch_('nope', {}).getContent());
  Logger.log('authX -> ' + dispatch_('auth', { lineUid: 'U_does_not_exist' }).getContent());
}

/**
 * Create a demo Admin account linked to a LINE UID, then verify login
 * resolves Role=Admin. Pass your own LINE userId to wire up the first
 * real Admin. Returns the created credentials.
 */
function bootstrapAdmin(adminLineUid) {
  adminLineUid = adminLineUid || getConfig_('AdminLineUID', '');
  if (!adminLineUid || String(adminLineUid).indexOf('<FILL') === 0) {
    throw new Error('Set AdminLineUID in SCHOOL_CONFIG, or pass it to bootstrapAdmin("Uxxxx").');
  }
  var staff = sheet_(getHrSpreadsheet_(), 'STAFF');
  var staffId = nextId_(staff, 'StaffID', 'STF');
  appendObject_(staff, {
    StaffID: staffId, Name: 'System Admin', Position: 'Administrator', Role: ROLES.ADMIN,
    Department: '', PositionLevel: 'Admin', ReportsTo: '',
    LineUID: adminLineUid, StartDate: new Date(), BaseSalary: 0, Status: 'ACTIVE'
  });
  var cred = createUserAccount_(ROLES.ADMIN, staffId, adminLineUid, 'bootstrap');
  var login = handleAuth({ lineUid: adminLineUid });
  Logger.log('Created ' + cred.userId + ' (temp pw: ' + cred.defaultPassword + ') -> login role=' + login.role);
  return { staffId: staffId, user: cred, login: login };
}
