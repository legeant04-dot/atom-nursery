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
  ping:           function ()  { return { pong: true, time: new Date().toISOString() }; },
  auth:           function (p) { return handleAuth(p); },
  changePassword: function (p) { return handleChangePassword(p); },
  // in-place staff CRUD (override the engine's full-collection rewrite, which could wipe other rows)
  saveStaff:      function (p) { return handleSaveStaff(p); },
  deleteStaff:    function (p) { return handleDeleteStaff(p); },
  saveStudent:    function (p) { return handleSaveStudent(p); },
  saveParent:     function (p) { return handleSaveParent(p); },
  saveParentSelf: function (p) { return handleSaveParentSelf(p); },
  saveFamilyParent: function (p) { return handleSaveFamilyParent(p); },
  saveStudentSelf:  function (p) { return handleSaveStudentSelf(p); },
  deleteBill:       function (p) { return handleDeleteBill(p); },
  setSchoolConfig:  function (p) { return handleSetSchoolConfig(p); },
  recomputeAttendance: function (p) { return handleRecomputeAttendance(p); },
  addDepartment:    function (p) { return handleAddDepartment(p); },
  removeDepartment: function (p) { return handleRemoveDepartment(p); },
  renameDepartment: function (p) { return handleRenameDepartment(p); },
  changeStaffPassword:  function (p) { return handleChangeStaffPassword(p); },
  checkStaffPassword:   function (p) { return handleCheckStaffPassword(p); },
  getStaffPassword:     function (p) { return handleGetStaffPassword(p); },
  adminResetPassword:   function (p) { return handleAdminResetPassword(p); },
  requestPasswordReset: function (p) { return handleRequestPasswordReset(p); },
  uploadSlip:     function (p) { return handleUploadSlip(p); },
  payOT:          function (p) { return handlePayOT(p); },
  payPrepay:      function (p) { return handlePayPrepay(p); },
  confirmSlip:    function (p) { return handleConfirmSlip(p); },
  rejectSlip:     function (p) { return handleRejectSlip(p); },
  deleteParent:   function (p) { return handleDeleteParent(p); },
  removeStudent:  function (p) { return handleRemoveStudent(p); },
  // Day 3 — GPS staff attendance
  staffCheckin:   function (p) { return handleStaffCheckin(p); },
  staffCheckout:  function (p) { return handleStaffCheckout(p); },
  // Day 4 — leave workflow + parent check-in
  submitLeave:    function (p) { return handleSubmitLeave(p); },
  approveLeave:   function (p) { return handleApproveLeave(p); },
  // myLeaves intentionally NOT routed here — the explicit handler returned {staffId,leaves:[]}
  // (camelCase) but the client + engine use a raw-row array; let it fall through to the engine.
  pendingLeaves:  function (p) { return handlePendingLeaves(p); },
  parentCheckin:  function (p) { return handleParentCheckin(p); },
  studentAbsence: function (p) { return handleStudentAbsence(p); },
  // Day 5 — Daily Journal (submit keeps the GAS handler for LINE notify; reads defer to the engine,
  // which returns null/[] gracefully instead of throwing NOT_FOUND when there is no journal yet)
  submitJournal:  function (p) { return handleSubmitJournal(p); },
  // Day 5 — DSPM Assessment + analytics
  dspmCriteria:      function (p) { return handleDspmCriteria(p); },
  submitAssessment:  function (p) { return handleSubmitAssessment(p); },
  studentAssessment: function (p) { return handleStudentAssessment(p); },
  classAssessment:   function (p) { return handleClassAssessment(p); },
  dspmManual:        function ()  { return handleDspmManual(); },
  // Payroll
  computePayroll: function (p) { return handleComputePayroll(p); },
  getPayslip:     function (p) { return handleGetPayslip(p); },
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
  // HTML views (printable). e.g. ?view=slips&month=YYYY-MM
  var view = e && e.parameter && e.parameter.view;
  if (view === 'slips') return serveSlips_(e);

  // Health check + optional ?action= for read-only calls / quick testing.
  var action = e && e.parameter && e.parameter.action;
  if (!action) {
    return jsonOut_({ ok: true, data: { service: 'Atom Nursery API', status: 'up', time: new Date().toISOString() } });
  }
  return dispatch_(action, e.parameter || {}, (e.parameter || {}).token);
}

function doPost(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: { code: 'BAD_JSON', message: 'ส่ง JSON ไม่ถูกต้อง' } });
  }
  return dispatch_(body.action, body.payload || {}, body.token);
}

// ---- session enforcement (gated by SCHOOL_CONFIG RequireSessionToken='true') ----
function sessionRequired_() { try { return String(getConfig_('RequireSessionToken', '')) === 'true'; } catch (e) { return false; } }
function publicAction_(a) { return a === 'ping' || a === 'auth'; }
/** Inject the caller's trusted identity (from the verified token) into the payload and
 *  block parents from reading a student that isn't theirs. No-op while dormant. */
function applyIdentity_(action, payload, sess) {
  payload = payload || {};
  if (!sessionRequired_() || publicAction_(action)) return payload;       // dormant → current behavior
  if (!sess) throw apiError_('NO_SESSION', 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)');
  if (sess.role === 'guest') {                                            // unregistered LINE user: onboarding only
    var ONBOARD = { registerParent: 1, addChildNew: 1, linkExisting: 1, registerNew: 1 };
    if (!ONBOARD[action]) throw apiError_('NEEDS_REGISTRATION', 'กรุณาลงทะเบียนก่อนใช้งาน');
    payload.uid = sess.uid;                                               // link records to the verified LINE id
    return payload;
  }
  // Admin-only destructive/sensitive actions — block non-admins (parent/teacher tokens).
  var ADMIN_ONLY = { deleteBill: 1, adminResetPassword: 1, getStaffPassword: 1, setSchoolConfig: 1, recomputeAttendance: 1,
    addDepartment: 1, removeDepartment: 1, renameDepartment: 1 };
  if (ADMIN_ONLY[action] && sess.role !== 'Admin') throw apiError_('NO_PERMISSION', 'เฉพาะแอดมิน');
  // Admin is fully trusted: may target ANY staff/student/parent (manage everyone + "view as" any role).
  if (sess.role === 'Admin') return payload;
  payload.uid = sess.uid; payload.role = sess.role;                       // overwrite — never trust client identity
  if (sess.role === ROLES.PARENT) {
    payload.parentId = sess.linkedId;
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
  var sess = verifySession_(token);
  if (sessionRequired_() && !publicAction_(action) && !sess) {
    return jsonOut_({ ok: false, error: { code: 'NO_SESSION', message: 'ต้องเข้าสู่ระบบใหม่ (เซสชันหมดอายุ)' } });
  }
  try {
    if (action === 'batch') { (payload = payload || {}).__sess = sess; return jsonOut_({ ok: true, data: handler(payload) }); }
    payload = applyIdentity_(action, payload, sess);
    return jsonOut_({ ok: true, data: handler(payload) });
  } catch (err) {
    var code = (err && err.apiCode) ? err.apiCode : 'INTERNAL';
    var msg = (err && err.message) ? err.message : String(err);
    if (code === 'INTERNAL') Logger.log('Unhandled error in ' + action + ': ' + (err && err.stack || err));
    return jsonOut_({ ok: false, error: { code: code, message: msg } });
  }
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
