/**
 * GasEngine.gs — the "data connector": run the SHARED engine (Engine.gs) on Google Sheets.
 * ------------------------------------------------------------------
 * Flow per request:  hydrateM_()  →  createAtomAPI(M, null).H[action](payload)  →  persistM_(changed)
 * Code.gs routes any action NOT in its explicit ROUTES to engineDispatch_(action, payload), so all
 * ~116 engine handlers become available without re-implementing them in GAS.
 *
 * Persistence is "changed-collection rewrite" (snapshot before, diff after, rewrite only changed sheets).
 * Fine for nursery-scale data. Object/array cells are JSON-encoded; a few sheet headers are aliased to the
 * engine's field names (e.g. sheet `Name` ↔ engine `NameTH`).
 *
 * NOTE: this is deploy-time code (needs the live Google account). Reference/derived collections that aren't
 * 1:1 sheets are seeded by engineSeed_(); wire them to real sources as the deployment matures.
 * ------------------------------------------------------------------
 */

// M-collection key -> { wb:'MAIN'|'HR', sheet:'SHEET_NAME' }. Only these are read from / written back to Sheets.
var COLLECTION_MAP = {
  students:        { wb: 'MAIN', sheet: 'STUDENTS' },
  classes:         { wb: 'MAIN', sheet: 'CLASSES' },
  parents:         { wb: 'MAIN', sheet: 'PARENTS' },
  pickupPersons:   { wb: 'MAIN', sheet: 'PICKUP_PERSONS' },
  userLinks:       { wb: 'MAIN', sheet: 'USER_LINKS' },
  journals:        { wb: 'MAIN', sheet: 'DAILY_JOURNAL' },
  assessments:     { wb: 'MAIN', sheet: 'DSPM_ASSESSMENT' },
  dspmCriteria:    { wb: 'MAIN', sheet: 'DSPM_CRITERIA' },
  payments:        { wb: 'MAIN', sheet: 'BILLING' },
  studentCharges:  { wb: 'MAIN', sheet: 'STUDENT_CHARGES' },
  prepayments:     { wb: 'MAIN', sheet: 'PREPAYMENTS' },
  otDaily:         { wb: 'MAIN', sheet: 'OT_DAILY' },
  growthRecords:   { wb: 'MAIN', sheet: 'GROWTH_RECORDS' },
  absenceLog:      { wb: 'MAIN', sheet: 'ABSENCE_LOG' },
  absenceFollowups:{ wb: 'MAIN', sheet: 'ABSENCE_FOLLOWUP' },
  vaccineRecords:  { wb: 'MAIN', sheet: 'VACCINE_RECORDS' },
  holidays:        { wb: 'MAIN', sheet: 'HOLIDAYS' },
  announcements:   { wb: 'MAIN', sheet: 'ANNOUNCEMENTS' },
  studentLeaves:   { wb: 'MAIN', sheet: 'LEAVE_REQUEST_STD' },
  comments:        { wb: 'MAIN', sheet: 'COMMENTS' },
  studentCheckins: { wb: 'MAIN', sheet: 'CHECKIN_STUDENT' },
  withdrawals:     { wb: 'MAIN', sheet: 'WITHDRAWALS' },
  injuryReports:   { wb: 'MAIN', sheet: 'INJURY_REPORTS' },
  insurancePCHI:   { wb: 'MAIN', sheet: 'INSURANCE_PCHI' },
  activityLog:     { wb: 'MAIN', sheet: 'ACTIVITY_LOG' },
  staff:           { wb: 'HR',   sheet: 'STAFF' },
  staffGroups:     { wb: 'HR',   sheet: 'STAFF_GROUPS' },
  workSchedule:    { wb: 'HR',   sheet: 'WORK_SCHEDULE' },
  leaves:          { wb: 'HR',   sheet: 'LEAVE_REQUEST' },
  payroll:         { wb: 'HR',   sheet: 'PAYROLL' }
};

// sheet header  <->  engine field, per sheet (only where they differ).
var FIELD_ALIAS = {
  STUDENTS: { Name: 'NameTH' },
  PARENTS:  { Name: 'NameTH' },
  STAFF:    { Name: 'NameTH' }
};

// SCHOOL_CONFIG keys whose value is a comma list the engine expects as an array.
var CONFIG_ARRAY_KEYS = { Departments: 1, GrowthUpdateMonths: 1, PositionLevels: 1 };

/** main entry — called by Code.gs dispatch_ for any non-explicit action. */
function engineDispatch_(action, payload) {
  var M = hydrateM_();
  var before = {};
  for (var k in COLLECTION_MAP) before[k] = JSON.stringify(M[k] || []);
  var api = createAtomAPI(M, null);                 // GROWTH_STD=null -> growth bands null (records still returned)
  var h = api.H[action];
  if (!h) throw apiError_('UNKNOWN_ACTION', 'ไม่รู้จัก action: ' + action);
  var data = h(payload || {});
  // persist only collections that changed
  for (var c in COLLECTION_MAP) {
    if (JSON.stringify(M[c] || []) !== before[c]) writeCollection_(c, M[c] || []);
  }
  return data;
}

/** Build the engine's M object from Sheets + config + seeded reference data. */
function hydrateM_() {
  var M = engineSeed_();             // reference/derived collections (vaccineSchedule, permMatrix, …)
  M.config = hydrateConfig_();
  for (var key in COLLECTION_MAP) M[key] = readCollection_(key);
  // derived: dspmEN map from DSPM_CRITERIA.DescriptionEN
  M.dspmEN = {};
  (M.dspmCriteria || []).forEach(function (c) { if (c.DescriptionEN) M.dspmEN[c.ItemNo] = c.DescriptionEN; });
  return M;
}

function wbOf_(which) { return which === 'HR' ? getHrSpreadsheet_() : getMainSpreadsheet_(); }

/** Read one collection as engine-shaped row objects (alias + JSON decode applied). */
function readCollection_(key) {
  var def = COLLECTION_MAP[key];
  var sh = wbOf_(def.wb).getSheetByName(def.sheet);
  if (!sh) return [];
  var rows = readObjects_(sh);
  var alias = FIELD_ALIAS[def.sheet] || {};
  return rows.map(function (r) {
    var o = {};
    for (var col in r) {
      var field = alias[col] || col;
      o[field] = decodeCell_(r[col]);
    }
    return o;
  });
}

/** Rewrite a collection's sheet from M[key] (header row kept; data rows replaced). */
function writeCollection_(key, list) {
  var def = COLLECTION_MAP[key];
  var sh = wbOf_(def.wb).getSheetByName(def.sheet);
  if (!sh) return;
  var hdr = headers_(sh);
  var alias = FIELD_ALIAS[def.sheet] || {};
  var inv = {}; for (var a in alias) inv[alias[a]] = a;       // engine field -> sheet header
  var values = (list || []).map(function (o) {
    return hdr.map(function (col) {
      var field = (FIELD_ALIAS[def.sheet] && FIELD_ALIAS[def.sheet][col]) ? FIELD_ALIAS[def.sheet][col] : col;
      var v = o[field]; if (v === undefined && inv[col] !== undefined) v = o[col];
      return encodeCell_(v);
    });
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).clearContent();
  if (values.length) sh.getRange(2, 1, values.length, hdr.length).setValues(values);
}

/** Cell decode: parse JSON arrays/objects; leave scalars as-is. */
function decodeCell_(v) {
  if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { return JSON.parse(v); } catch (e) {} }
  return v;
}
/** Cell encode: JSON-stringify arrays/objects; pass scalars through. */
function encodeCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** SCHOOL_CONFIG (Key/Value) -> typed config object the engine expects. */
function hydrateConfig_() {
  var raw = getAllConfig_();
  var cfg = {};
  for (var k in raw) {
    var v = raw[k];
    if (CONFIG_ARRAY_KEYS[k]) cfg[k] = String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    else if (typeof v === 'string' && /^[\[{]/.test(v.trim())) { try { cfg[k] = JSON.parse(v); } catch (e) { cfg[k] = v; } }
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) cfg[k] = Number(v);
    else cfg[k] = v;
  }
  if (typeof cfg.GrowthUpdateMonths !== 'undefined' && cfg.GrowthUpdateMonths.map)
    cfg.GrowthUpdateMonths = cfg.GrowthUpdateMonths.map(Number);
  // structured objects the engine reads as nested values
  cfg.Links = { line: raw.Links_LINE || '', facebook: raw.Links_Facebook || '', website: raw.Links_Website || '' };
  if (!cfg.LeaveQuota) cfg.LeaveQuota = { 'ลาป่วย': 30, 'ลากิจ': 7, 'ลาพักร้อน': 6 };
  if (!cfg.Insurance) cfg.Insurance = ENGINE_REF.Insurance;
  return cfg;
}

/** Reference/derived collections that aren't a 1:1 sheet (seeded so handlers run). */
function engineSeed_() {
  return {
    leaveUsed: {},                       // TODO: derive from LEAVE_REQUEST if needed
    payrollConfig: {},                   // TODO: read from PAYROLL_CONFIG sheet if used
    staffAttendanceToday: [], staffAttendanceHistory: [], studentAttendanceToday: [],
    checkinStudent: [], dutyRoster: [], calendar: [], feed: [],
    vaccineSchedule: ENGINE_REF.vaccineSchedule,
    permMatrix: ENGINE_REF.permMatrix,
    permissions: ENGINE_REF.permissions
  };
}

// Compact reference data (mirror of mockdata reference lists). Keep in sync if these change in mockdata.js.
var ENGINE_REF = {
  Insurance: {
    CompanyName: 'Atom Nursery', PolicyNo: '',
    Titles: ['ด.ช.', 'ด.ญ.', 'MSTR.', 'MISS', 'MR.', 'MRS.', 'MS.', 'นาย', 'นาง', 'นางสาว', 'คุณ'],
    Genders: ['Male', 'Female'], MemberStatuses: ['Child', 'Employee', 'Spouse'],
    Plans: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    MaritalStatuses: ['Single', 'Married', 'Divorced', 'Separated in fact', 'Widow/Widower'],
    Relationships: ['Father', 'Mother', 'Spouse', 'Child', 'Brother', 'Sister', 'Relative', 'Others']
  },
  permMatrix: {
    Admin:   { students: true, staff: true, payroll: true, parentPII: true, edit: true, approve: true },
    Leader:  { students: true, staff: true, payroll: false, parentPII: true, edit: false, approve: true },
    Teacher: { students: true, staff: false, payroll: false, parentPII: false, edit: false, approve: false },
    Parent:  { students: true, staff: false, payroll: false, parentPII: false, edit: false, approve: false }
  },
  permissions: [],
  vaccineSchedule: []   // TODO: move the standard schedule into a sheet or embed the full list
};
