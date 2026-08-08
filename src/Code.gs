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
        ['students', 'staff', 'checkinStudent', 'journals', 'payments', 'otDaily', 'leaves'].forEach(function (k) {
          var s = Date.now();
          try { readCollection_(k); } catch (e) {}
          out.read[k] = Date.now() - s;
        });
      }
    }
    return out;
  },
  auth:           function (p) { return handleAuth(p); },
  changePassword: function (p) { return handleChangePassword(p); },
  // in-place staff CRUD (override the engine's full-collection rewrite, which could wipe other rows)
  saveStaff:      function (p) { return handleSaveStaff(p); },
  saveStaffSelf:  function (p) { return handleSaveStaffSelf(p); },
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
  notifyBills:      function (p) { return handleNotifyBills(p); },   // admin-only: notify parents that bills were issued
  saveQRCodes:      function (p) { return handleSaveQRCodes(p); },   // admin-only: QR-code master + OT binding
  savePlans:        function (p) { return handleSavePlans(p); },       // admin-only: package (Plan) CRUD → SCHOOL_CONFIG JSON
  savePrepayTiers:  function (p) { return handleSavePrepayTiers(p); }, // admin-only: advance-tuition discount tiers → SCHOOL_CONFIG JSON
  setStudentPause:  function (p) { return handleSetStudentPause(p); }, // admin-only: temporary leave (ลาชั่วคราว), in-place
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
  // notifications: the 🔔 bell now serves the in-app Admin inbox (cuts LINE admin pushes). Injury is an
  // emergency (always LINE + optional parent). reinstallTriggers refreshes the 10:00/20:00 digest schedule.
  notifications:        function (p) { return handleNotifications(p); },
  markNotifsRead:       function (p) { return handleMarkNotifsRead(p); },
  adminInbox:           function (p) { return handleAdminInbox(p); },
  markInboxRead:        function (p) { return handleMarkInboxRead(p); },
  submitInjury:         function (p) { return handleSubmitInjury(p); },
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
  markSalaryPaid: function (p) { return handleMarkSalaryPaid(p); },   // admin-only: salary transferred (+ slip)
  otCarryOver:    function (p) { return handleOtCarryOver(p); },      // OT approved after an earlier payroll was saved
  recomputeContributions: function (p) { return handleRecomputeContributions(p); },  // admin-only, preview-first
  // Day 6 — PCHI insurance (fill-once) + SlipOK slip verification
  insuranceStatus:    function (p) { return handleInsuranceStatus(p); },
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
      return jsonOut_({ ok: true, data: { service: 'Atom Nursery API', status: 'up', time: new Date().toISOString() } });
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
function publicAction_(a) { return a === 'ping' || a === 'auth' || a === 'perfLog'; }
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
  var ADMIN_ONLY = { deleteBill: 1, adminResetPassword: 1, getStaffPassword: 1, setSchoolConfig: 1, recomputeAttendance: 1,
    addDepartment: 1, removeDepartment: 1, renameDepartment: 1, listBackups: 1, restoreSheet: 1, setRequireCheckin: 1,
    adminUpdateOT: 1, adminCancelOT: 1, adminRestoreOT: 1, unlockJournal: 1,
    confirmOT: 1, adminAddOT: 1, adminEditOT: 1, adminDeleteOT: 1,
    addBigCleaning: 1, removeBigCleaning: 1, editLeave: 1, cancelLeave: 1,
    decideClassChange: 1, confirmTimeRequest: 1,
    addAnnouncement: 1, editAnnouncement: 1, deleteAnnouncement: 1, reindexAnnouncements: 1, reindexParents: 1, checkDuplicateIds: 1,
    saveDspmCriteria: 1, deleteDspmCriteria: 1,
    editStudentLeave: 1, deleteStudentLeave: 1, deleteStudentLeaves: 1, dedupData: 1, lineDiag: 1,
    adminInbox: 1, markInboxRead: 1, reinstallTriggers: 1, unlinkStudent: 1, linkParentAdmin: 1, setLeaveQuota: 1, setConfigVal: 1, markSalaryPaid: 1, notifyBills: 1, issueBillsFor: 1, savePlans: 1, saveQRCodes: 1, prepayAudit: 1, recomputeContributions: 1, savePrepayTiers: 1, editPrepay: 1, setStudentPause: 1, recordCashPayment: 1, pausedStudents: 1, deleteSlip: 1, slipDiag: 1, saveSlipOk: 1, cancelPrepay: 1, perfSummary: 1, deletePerfLog: 1,
    // Phase 7. The engine handlers already check the caller's role; listing them here as well means a
    // bug in one of those checks still cannot expose survey results or let anyone rewrite the menu.
    saveFoodMenu: 1, deleteFoodItem: 1, seedFoodItems: 1, surveys: 1, saveSurvey: 1, setSurveyStatus: 1, deleteSurvey: 1, surveyResults: 1, surveySummary: 1,
    parentKidsMap: 1 };  // every parent's children by name — admin-only (PII)
  if (ADMIN_ONLY[action] && sess.role !== 'Admin') throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  // Admin is fully trusted: may target ANY staff/student/parent (manage everyone + "view as" any role).
  if (sess.role === 'Admin') return payload;
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
  }
  return payload;
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
  if (!handler) {
    return jsonOut_({ ok: false, error: { code: 'UNKNOWN_ACTION', message: 'ไม่รู้จัก action: ' + action } });
  }
  // A stored token that is corrupt (or a hiccup reading the signing secret) must never take the
  // request down — it used to throw out here, outside the try, and the caller got an HTML error page.
  var sess = null;
  try { sess = verifySession_(token); } catch (se) { sess = null; }
  if (sessionRequired_() && !publicAction_(action) && !sess) {
    return jsonOut_({ ok: false, error: { code: 'NO_SESSION', message: 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)' } });
  }
  try {
    // Serialize anything that can WRITE. A request hydrates sheets then persists them, so two
    // concurrent writers could interleave (one reading a half-written sheet) — the cause of the
    // 2026-07-09 student wipe. Pure reads stay lock-free so the app remains fast.
    var mutates = (action === 'batch')
      ? ((payload && payload.calls) || []).some(function (c) { return isMutatingAction_(c.action); })
      : isMutatingAction_(action);
    return withWriteLock_(mutates, function () {
      if (action === 'batch') { (payload = payload || {}).__sess = sess; return jsonOut_({ ok: true, data: handler(payload) }); }
      // perfLog records WHICH ROLE was affected. That must come from the verified session, never
      // from the client — otherwise the one report we use to make decisions is trivially poisoned.
      // No session is itself the signal we want (a user who could not sign in), recorded as 'anon'.
      if (action === 'perfLog') { (payload = payload || {}).__sess = sess; return jsonOut_({ ok: true, data: handler(payload) }); }
      payload = applyIdentity_(action, payload, sess);
      return jsonOut_({ ok: true, data: handler(payload) });
    });
  } catch (err) {
    var code = (err && err.apiCode) ? err.apiCode : 'INTERNAL';
    var msg = (err && err.message) ? err.message : String(err);
    if (code === 'INTERNAL') Logger.log('Unhandled error in ' + action + ': ' + (err && err.stack || err));
    return jsonOut_({ ok: false, error: { code: code, message: msg } });
  }
}

/** Does this action write anything? (mirrors the client's MUT regex in api.js) */
var MUTATING_RE = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|recompute|restore|bind|provision)/i;
// dedupData/reindex* mutate but don't start with a MUTATING_RE verb — force them to take the write lock
// (they read row indices then delete, so a concurrent append would shift rows and delete the wrong one).
function isMutatingAction_(a) { a = String(a || ''); return MUTATING_RE.test(a) || /check(in|out)|absence|^dedup|^reindex|payOT$|^orgMove|^unlink|^claim|^recompute/i.test(a); }

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
