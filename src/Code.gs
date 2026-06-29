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
  // Day 3 — GPS staff attendance
  staffCheckin:   function (p) { return handleStaffCheckin(p); },
  staffCheckout:  function (p) { return handleStaffCheckout(p); },
  // Day 4 — leave workflow + parent check-in
  submitLeave:    function (p) { return handleSubmitLeave(p); },
  approveLeave:   function (p) { return handleApproveLeave(p); },
  myLeaves:       function (p) { return handleMyLeaves(p); },
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
  // TEST ONLY — seed fake mock data (gated by SeedMockKey). Remove before go-live with real data.
  seedMock:           function (p) { return handleSeedMock(p); },
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
  payload.uid = sess.uid; payload.role = sess.role;                       // overwrite — never trust client identity
  if (sess.role === ROLES.PARENT) {
    payload.parentId = sess.linkedId;
    if (payload.studentId && !parentOwnsStudent_(sess.uid, payload.studentId)) throw apiError_('NO_ACCESS', 'ไม่มีสิทธิ์เข้าถึงข้อมูลนักเรียนนี้');
  } else {
    payload.staffId = sess.linkedId;
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
